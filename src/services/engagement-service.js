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
  }
  hintState(context) {
    const mode = this.config.hintMode || 'free';
    if (mode !== 'share') return { mode, unlocked: mode === 'free' };
    return Object.assign({ mode }, this.hintAccess ? this.hintAccess.status(context)
      : { ok: false, reason: 'not-configured', unlocked: false });
  }
  requestHint(context) {
    const mode = this.config.hintMode || 'free';
    if (mode === 'free') return { granted: true, mode: 'free' };
    if (mode === 'share') return this.requestHintShare(context);
    if (!this.ads) return Promise.resolve({ granted: false, reason: 'not-configured' });
    if (this.behavior) this.behavior.track('ad_requested', { placement: 'hint', scene: context && context.scene });
    return this.ads.showRewarded('hint').then(result => {
      if (this.behavior) this.behavior.track(result.rewarded ? 'ad_completed' : result.reason === 'closed' ? 'ad_closed_early' : 'ad_error', { placement: 'hint', reason: result.reason });
      return result.rewarded ? { granted: true, mode: 'rewarded', attemptId: result.attemptId }
        : { granted: false, mode: 'rewarded', reason: result.reason };
    }).catch(() => ({ granted: false, mode: 'rewarded', reason: 'error' }));
  }
  requestHintShare(context) {
    const state = this.hintState(context);
    const denied = reason => ({ granted: false, mode: 'share', reason });
    if (!state.ok) return denied(state.reason);
    if (state.unlocked) return { granted: true, mode: 'share', alreadyUnlocked: true };
    if (this.hintPending) return denied('busy');
    const finish = () => {
      const saved = this.hintAccess.unlock(context);
      // Newly unlocked hints require a second tap; the preview timer must not
      // run while the native share interface covers the game.
      return saved.ok ? { granted: false, mode: 'share', unlocked: true } : denied(saved.reason);
    };
    if (state.pendingSave) return finish();
    if (!this.share || typeof this.share.shareHint !== 'function') return denied('not-configured');
    const token = { dateKey: context.dateKey, levelKey: context.levelKey, scene: context.scene };
    context = token;
    this.hintPending = token;
    let task;
    // Keep the native call in the user's gesture, before any Promise await.
    try { task = this.share.shareHint(token); } catch (error) { task = { initiated: false, reason: 'not-supported' }; }
    return Promise.resolve(task).then(result => {
      if (!result || result.initiated !== true) return denied((result && result.reason) || 'unavailable');
      if (this.behavior) this.behavior.track('share_initiated', { scene: token.scene, source: 'hint' });
      return finish();
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
  async dailyExtraEntry(context) {
    const session = await this.auth.ensureSession();
    if (!session.ok) return { ok: false, reason: session.reason };
    const current = this.auth.current();
    const userId = current && current.userId;
    if (!userId) return { ok: false, reason: 'unauthorized' };
    const pending = this.rewards.pendingFor(context);
    if (pending) return this.rewards.claim(pending, userId);
    if (this.rewards.claimedCount(context) >= (this.config.dailyExtraEntryLimit || 1)) return { ok: false, reason: 'DAILY_REWARD_LIMIT_REACHED' };
    if (this.behavior) this.behavior.track('ad_requested', { placement: 'dailyExtraEntry' });
    const result = await this.ads.showRewarded('dailyExtraEntry');
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
