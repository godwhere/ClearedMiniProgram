'use strict';

class EngagementService {
  constructor(options) {
    const opts = options || {};
    this.ads = opts.ads || null; this.share = opts.share || null;
    this.rewards = opts.rewards || null; this.behavior = opts.behavior || null;
    this.config = opts.config || {};
    this.auth = opts.auth || null;
    this.dailyPending = null;
    this.hintAccess = opts.hintAccess || null;
    this.hintPending = null;
    this.rewardUnlocks = opts.rewardUnlocks || null;
    this.rewardUnlockPending = null;
    this.rewardUnlockGeneration = 0;
  }
  hintState(context) {
    const mode = this.config.hintMode || 'free';
    if (mode === 'free') return { ok: true, mode, unlocked: true, action: 'view' };
    if (mode === 'rewarded') return { ok: true, mode, unlocked: false, action: 'rewarded' };
    if (mode !== 'share' && mode !== 'tiered') return { ok: false, mode, unlocked: false, action: 'unavailable', reason: 'invalid-mode' };
    const state = Object.assign({ mode }, this.hintAccess ? this.hintAccess.status(context)
      : { ok: false, reason: 'not-configured', unlocked: false });
    if (!state.ok) return Object.assign(state, { action: 'unavailable' });
    if (state.unlocked) return Object.assign(state, { action: 'view' });
    if ((mode === 'tiered' && state.pendingSaveContext) || (mode === 'share' && state.pendingSave)) {
      return Object.assign(state, { action: 'retry-save' });
    }
    if (this.hintPending) return Object.assign(state, { action: 'busy', reason: 'busy' });
    if (!state.canUnlock) return Object.assign(state, { action: 'unavailable', reason: 'unlock-limit' });
    const requiredAction = mode === 'share' ? 'share' : state.unlockCount === 0 ? 'free' : state.unlockCount === 1 ? 'share' : 'rewarded';
    let fallbackReason = null;
    if (requiredAction === 'rewarded') {
      if (this.config.hintRewardedEnabled !== true) fallbackReason = 'ads-not-enabled';
      else if (!this.ads || !this.ads.isRewardedConfigured('hint')) fallbackReason = 'ads-not-configured';
      else if (typeof this.ads.isRewardedSupported !== 'function' || !this.ads.isRewardedSupported()) fallbackReason = 'ads-not-supported';
    }
    return Object.assign(state, { requiredAction, action: fallbackReason ? 'share' : requiredAction, fallbackReason });
  }
  requestHint(context) {
    const mode = this.config.hintMode || 'free';
    if (mode === 'free') return { granted: true, mode: 'free' };
    if (mode === 'share' || mode === 'tiered') return this.requestHintUnlock(context);
    if (mode !== 'rewarded') return { ok: false, granted: false, mode, reason: 'invalid-mode' };
    if (!this.ads) return Promise.resolve({ granted: false, reason: 'not-configured' });
    if (this.behavior) this.behavior.track('ad_requested', { placement: 'hint', scene: context && context.scene });
    return this.ads.showRewarded('hint').then(result => {
      if (this.behavior) this.behavior.track(result.rewarded ? 'ad_completed' : result.reason === 'closed' ? 'ad_closed_early' : 'ad_error', { placement: 'hint', reason: result.reason });
      return result.rewarded ? { granted: true, mode: 'rewarded', attemptId: result.attemptId }
        : { granted: false, mode: 'rewarded', reason: result.reason };
    }).catch(() => ({ granted: false, mode: 'rewarded', reason: 'error' }));
  }
  requestHintUnlock(context) {
    const account = this.accountGuard && this.accountGuard.capture();
    const state = this.hintState(context);
    const token = { mode: state.mode, action: state.action, dateKey: context && context.dateKey,
      levelKey: context && context.levelKey, scene: context && context.scene };
    const result = extra => Object.assign({ ok: false, granted: false, unlocked: false,
      mode: token.mode, action: token.action, dateKey: token.dateKey, levelKey: token.levelKey }, extra);
    const denied = reason => result({ reason });
    if (!state.ok || state.action === 'unavailable') return denied(state.reason);
    if (state.action === 'view') return result({ ok: true, granted: true, unlocked: true, alreadyUnlocked: true });
    if (this.hintPending || state.action === 'busy') return denied('busy');
    const commit = show => {
      if (account && !this.accountGuard.matches(account)) return denied('stale-account-context');
      const saved = token.action === 'retry-save' && token.mode === 'tiered'
        ? this.hintAccess.retryPendingSave() : this.hintAccess.unlock(token);
      return result({ ok: saved.ok, granted: saved.ok && show, unlocked: saved.ok,
        dateKey: saved.dateKey || token.dateKey, levelKey: saved.levelKey || token.levelKey,
        reason: saved.reason });
    };
    // The single flight includes local commits. After a disk failure the
    // access service's pending target reserves the slot across navigation.
    this.hintPending = token;
    if (token.action === 'free' || token.action === 'retry-save') {
      try { return commit(token.action === 'free'); }
      finally { if (this.hintPending === token) this.hintPending = null; }
    }
    const track = (name, properties) => {
      try { if (this.behavior) this.behavior.track(name, properties); } catch (error) {}
    };
    let task;
    try {
      if (token.action === 'share') {
        if (!this.share || typeof this.share.shareHint !== 'function') {
          this.hintPending = null; return denied('not-configured');
        }
        // Sharing stays in the user's gesture; eligibility never awaits a
        // network call or a deliberately failing advertisement first.
        task = this.share.shareHint(token);
      } else {
        track('ad_requested', { placement: 'hint', scene: token.scene });
        task = this.ads.showRewarded('hint');
      }
    } catch (error) { this.hintPending = null; return denied('not-supported'); }
    return Promise.resolve(task).then(outcome => {
      if (token.action === 'share') {
        if (!outcome || outcome.initiated !== true) return denied((outcome && outcome.reason) || 'unavailable');
        track('share_initiated', { scene: token.scene, source: 'hint' });
      } else {
        const granted = outcome && outcome.rewarded === true;
        track(granted ? 'ad_completed' : outcome && outcome.reason === 'closed' ? 'ad_closed_early' : 'ad_error',
          { placement: 'hint', reason: outcome && outcome.reason });
        if (!granted) return denied((outcome && outcome.reason) || 'error');
        if (typeof outcome.attemptId !== 'string' || !/^[A-Za-z0-9_:-]{1,200}$/.test(outcome.attemptId)) return denied('invalid-response');
      }
      // Only the admission-time target receives the permission; the App
      // decides whether that target still belongs to its visible run.
      return commit(false);
    }).catch(() => denied('unavailable')).finally(() => {
      if (this.hintPending === token) this.hintPending = null;
    });
  }
  canRequestDailyExtraEntry() {
    return this.config.dailyExtraEntryEnabled === true && !!this.rewards && this.rewards.enabled() &&
      !!this.auth && !!this.ads && this.ads.isRewardedConfigured('dailyExtraEntry');
  }
  requestDailyExtraEntry(context) {
    if (!this.canRequestDailyExtraEntry()) return Promise.resolve({ ok: false, reason: 'not-configured' });
    if (this.dailyPending) return Promise.resolve({ ok: false, reason: 'busy' });
    this.dailyPending = this.dailyExtraEntry(context).catch(() => ({ ok: false, reason: 'error' }))
      .finally(() => { this.dailyPending = null; });
    return this.dailyPending;
  }
  rewardUnlockState(rewardId) {
    const state = this.rewardUnlocks && this.rewardUnlocks.status
      ? this.rewardUnlocks.status(rewardId)
      : { ok: false, owned: false, action: 'unavailable', reason: 'not-configured' };
    if (this.rewardUnlockPending) {
      return Object.assign({}, state, { action: 'busy', actionEnabled: false, reason: 'busy' });
    }
    if (this.rewardUnlocks && this.rewardUnlocks.hasPendingExternal && this.rewardUnlocks.hasPendingExternal()) {
      return Object.assign({}, state, { action: 'retry-save', actionEnabled: true, reason: 'pending-save' });
    }
    if (state.action === 'rewarded_ad') {
      if (this.config.rewardUnlockRewardedEnabled !== true) return Object.assign({}, state, { actionEnabled: false, reason: 'ads-not-enabled' });
      if (!this.ads || !this.ads.isRewardedConfigured('rewardUnlock')) return Object.assign({}, state, { actionEnabled: false, reason: 'ads-not-configured' });
      if (typeof this.ads.isRewardedSupported !== 'function' || !this.ads.isRewardedSupported()) return Object.assign({}, state, { actionEnabled: false, reason: 'ads-not-supported' });
    }
    return Object.assign({}, state, { actionEnabled: state.action !== 'locked' && state.action !== 'unavailable' });
  }
  requestRewardUnlock(context) {
    const account = this.accountGuard && this.accountGuard.capture();
    if (account && !this.accountGuard.matches(account)) return Promise.resolve({ ok: false, reason: 'stale-account-context', newRewards: [] });
    const rewardId = context && context.rewardId;
    if (!this.rewardUnlocks) return Promise.resolve({ ok: false, reason: 'not-configured', newRewards: [] });
    if (this.rewardUnlocks.hasPendingExternal && this.rewardUnlocks.hasPendingExternal()) {
      return Promise.resolve(this.rewardUnlocks.retryPendingSave());
    }
    const state = this.rewardUnlockState(rewardId);
    if (!state.ok || state.owned || !state.actionEnabled || !['rewarded_ad', 'share'].includes(state.action)) {
      return Promise.resolve({ ok: false, reason: state.reason || (state.owned ? 'already-owned' : 'unavailable'), newRewards: [] });
    }
    if (this.rewardUnlockPending) return Promise.resolve({ ok: false, reason: 'busy', newRewards: [] });
    const token = { generation: this.rewardUnlockGeneration, rewardId, action: state.action,
      scene: context && context.scene };
    this.rewardUnlockPending = token;
    let task;
    try {
      if (token.action === 'share') {
        task = this.share && this.share.shareReward ? this.share.shareReward(token) : { initiated: false, reason: 'not-configured' };
      } else {
        if (this.behavior) this.behavior.track('ad_requested', { placement: 'rewardUnlock', rewardId });
        task = this.ads.showRewarded('rewardUnlock');
      }
    } catch (error) { task = { ok: false, reason: 'unavailable' }; }
    return Promise.resolve(task).then(outcome => {
      if (account && !this.accountGuard.matches(account)) return { ok: false, reason: 'stale-account-context', newRewards: [] };
      if (token.generation !== this.rewardUnlockGeneration) return { ok: false, reason: 'stale', newRewards: [] };
      if (token.action === 'share') {
        if (!outcome || outcome.initiated !== true) return { ok: false, reason: outcome && outcome.reason || 'unavailable', newRewards: [] };
        if (this.behavior) this.behavior.track('share_initiated', { scene: token.scene, source: 'reward_unlock' });
        return this.rewardUnlocks.recordShareInitiated({ rewardId: token.rewardId, initiated: true });
      }
      if (!outcome || outcome.rewarded !== true || outcome.placement !== 'rewardUnlock' ||
          typeof outcome.attemptId !== 'string' || !/^[A-Za-z0-9_:-]{1,200}$/.test(outcome.attemptId)) {
        return { ok: false, reason: outcome && outcome.reason || 'invalid-response', newRewards: [] };
      }
      if (this.behavior) this.behavior.track('ad_completed', { placement: 'rewardUnlock', rewardId });
      return this.rewardUnlocks.recordAdCompletion({ rewardId: token.rewardId, attemptId: outcome.attemptId });
    }).catch(() => ({ ok: false, reason: 'unavailable', newRewards: [] })).finally(() => {
      if (this.rewardUnlockPending === token) this.rewardUnlockPending = null;
    });
  }
  cancelRewardUnlocks() {
    this.rewardUnlockGeneration += 1;
    this.rewardUnlockPending = null;
  }
  async dailyExtraEntry(context) {
    let account = this.accountGuard && this.accountGuard.capture();
    const session = await this.auth.ensureSession();
    if (!session.ok) return { ok: false, reason: session.reason };
    if (account && account.identityAtStart && !this.accountGuard.matches(account)) return { ok: false, reason: 'stale-account-context' };
    account = this.accountGuard && this.accountGuard.capture();
    const current = this.auth.current();
    const userId = current && current.userId;
    if (!userId) return { ok: false, reason: 'unauthorized' };
    const pending = this.rewards.pendingFor(context);
    if (pending) return this.rewards.claim(pending, userId);
    if (this.rewards.claimedCount(context) >= (this.config.dailyExtraEntryLimit || 1)) return { ok: false, reason: 'DAILY_REWARD_LIMIT_REACHED' };
    if (this.behavior) this.behavior.track('ad_requested', { placement: 'dailyExtraEntry' });
    const result = await this.ads.showRewarded('dailyExtraEntry');
    if (account && !this.accountGuard.matches(account)) return { ok: false, reason: 'stale-account-context' };
    if (this.behavior) this.behavior.track(result.rewarded ? 'ad_completed' : result.reason === 'closed' ? 'ad_closed_early' : 'ad_error', { placement: 'dailyExtraEntry', reason: result.reason });
    if (!result.rewarded) return { ok: false, reason: result.reason };
    // The session may expire while the video is open. RewardService persists
    // the completed attempt for its original account before reauthentication.
    return this.rewards.claim({ source: 'rewarded_ad', action: 'daily_extra_entry', placement: 'dailyExtraEntry',
      idempotencyKey: result.attemptId, context: { dateKey: context.dateKey, dayId: context.dayId } }, userId);
  }
  shareResult(context) {
    if (!this.share) return Promise.resolve({ initiated: false, reason: 'not-configured' });
    return this.share.share(context).then(result => { if (result.initiated && this.behavior) this.behavior.track('share_initiated', context); return result; });
  }
  onOrdinaryCompleted(context) {
    if (!this.ads || typeof this.ads.onLevelCompleted !== 'function') return Promise.resolve(false);
    try { return Promise.resolve(this.ads.onLevelCompleted(context.totalClears)).catch(() => false); } catch (error) { return Promise.resolve(false); }
  }
}

module.exports = EngagementService;
