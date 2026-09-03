'use strict';

const ApiClient = require('./api-client.js');
const STORAGE_KEY = 'cleared:minigame:share-entry:v1';
const SCENES = new Set(['home', 'ordinary_result', 'daily_result']);
const shareIdValid = value => typeof value === 'string' && /^shr_[A-Za-z0-9_-]{1,128}$/.test(value);
const idValid = value => typeof value === 'string' && /^[A-Za-z0-9_:-]{1,200}$/.test(value);

function contextData(input) {
  const scene = input && SCENES.has(input.scene) ? input.scene : 'home';
  const result = { scene, context: {} };
  if (scene === 'ordinary_result' && typeof input.levelKey === 'string' && /^\d+:\d+$/.test(input.levelKey)) result.context.levelKey = input.levelKey;
  if (scene === 'daily_result' && typeof input.dailyDateKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.dailyDateKey)) result.context.dailyDateKey = input.dailyDateKey;
  return result;
}

class ShareService {
  constructor(platform, api, auth, syncStore, config, behavior) {
    this.platform = platform;
    this.api = api;
    this.auth = auth;
    this.store = syncStore;
    this.config = config || {};
    this.behavior = behavior || null;
    this.listener = null;
    this.contextProvider = null;
    this.intent = null;
    this.intentRequest = null;
    this.attributing = null;
    this.pending = [];
    this.seen = [];
    let saved;
    try { saved = platform.getStorage(STORAGE_KEY); } catch (error) {}
    if (saved && saved.schemaVersion === 1) {
      if (Array.isArray(saved.pending)) this.pending = saved.pending.filter(item => item && shareIdValid(item.shareId) && idValid(item.attributionId) &&
        Number.isInteger(item.entryScene) && item.entryScene >= 0 && item.entryScene <= 99999 && (!item.userId || idValid(item.userId)))
        .slice(0, 20).map(item => ({ shareId: item.shareId, attributionId: item.attributionId, entryScene: item.entryScene, userId: item.userId || null }));
      if (Array.isArray(saved.seen)) this.seen = saved.seen.filter(shareIdValid).slice(-50);
    }
  }

  save() {
    try { return this.platform.setStorage(STORAGE_KEY, { schemaVersion: 1, pending: this.pending, seen: this.seen }) === true; } catch (error) { return false; }
  }

  isResultEnabled() { return this.config.resultEnabled === true; }

  intentContext(context) {
    const body = contextData(context);
    // This selects a server campaign; the server still validates eligibility,
    // limits, self-invites and its ledger. It is never a client reward amount.
    if (this.config.rewardsEnabled === true) body.rewardAction = 'daily_extra_entry';
    return body;
  }

  install(contextProvider) {
    if (this.listener || this.config.menuEnabled !== true) return false;
    this.contextProvider = contextProvider;
    const listener = () => {
      let context = { scene: 'home' };
      try { context = this.contextProvider ? this.contextProvider() : context; } catch (error) {}
      if (this.behavior) this.behavior.track('share_initiated', { scene: contextData(context).scene });
      return this.buildPayload(context);
    };
    if (!this.platform.onShareAppMessage || !this.platform.onShareAppMessage(listener)) return false;
    this.listener = listener;
    if (this.platform.showShareMenu) this.platform.showShareMenu();
    return true;
  }

  uninstall() {
    if (this.listener && this.platform.offShareAppMessage) this.platform.offShareAppMessage(this.listener);
    this.listener = null;
    this.contextProvider = null;
    this.intent = null;
    this.intentRequest = null;
  }

  prepareContext(context) {
    if (this.config.attributionEnabled !== true || !this.api.isConfigured()) return Promise.resolve({ ok: false, reason: 'not-configured' });
    const session = this.auth.current();
    if (!session) return Promise.resolve({ ok: false, reason: 'unauthorized' });
    const body = this.intentContext(context);
    const key = JSON.stringify(body);
    // Invalidate an obsolete request even when the new context can reuse a
    // cached intent; its late response must not evict that valid cache.
    if (this.intentRequest && (this.intentRequest.key !== key || this.intentRequest.userId !== session.userId)) this.intentRequest = null;
    if (this.intent && this.intent.key === key && this.intent.userId === session.userId && this.intent.expiresAt > Date.now() + 30000) return Promise.resolve({ ok: true });
    if (this.intentRequest && this.intentRequest.key === key && this.intentRequest.userId === session.userId) return this.intentRequest.promise;
    const token = { key, userId: session.userId };
    this.intentRequest = token;
    token.promise = this.api.request({ method: 'POST', path: ApiClient.PATHS.shareIntents, auth: true, body }).then(result => {
      const current = this.auth.current();
      if (this.intentRequest !== token || !current || current.userId !== session.userId) return { ok: false, reason: 'stale' };
      if (!result.ok) return { ok: false, reason: result.error.code };
      const data = result.data;
      if (!shareIdValid(data.shareId) || !Number.isSafeInteger(data.expiresAt) || data.expiresAt <= Date.now()) return { ok: false, reason: 'invalid-response' };
      this.intent = { key, userId: session.userId, shareId: data.shareId, expiresAt: data.expiresAt };
      return { ok: true };
    }).catch(() => ({ ok: false, reason: 'network' })).finally(() => { if (this.intentRequest === token) this.intentRequest = null; });
    return token.promise;
  }

  buildPayload(context) {
    const body = this.intentContext(context);
    const current = this.auth.current();
    const intent = this.intent;
    const sid = this.config.attributionEnabled === true && current && intent && intent.userId === current.userId &&
      intent.key === JSON.stringify(body) && intent.expiresAt > Date.now() ? intent.shareId : null;
    const query = `sv=1${sid ? `&sid=${encodeURIComponent(sid)}` : ''}&scene=${body.scene}`;
    return { title: body.scene === 'daily_result' ? '今天的每日挑战，你能解开吗？' : '这一关你能解开吗？',
      query: query.length <= 256 ? query : `sv=1&scene=${body.scene}` };
  }

  share(context) {
    if (this.config.resultEnabled !== true || !context || context.completed !== true || !['ordinary_result', 'daily_result'].includes(context.scene)) return Promise.resolve({ initiated: false, reason: 'not-configured' });
    // Use a prepared intent only. Network latency must never delay the native
    // share gesture; an ordinary screenshot card remains available offline.
    return this.initiate(this.buildPayload(context));
  }

  shareHint(context) {
    if (!context || !['play', 'daily'].includes(context.scene)) return Promise.resolve({ initiated: false, reason: 'invalid-context' });
    // Local hint access uses an ordinary screenshot card. It never selects an
    // invitation campaign, changes menu context, or requests a server reward.
    return this.initiate({ title: '这道题你能解开吗？', query: 'sv=1&scene=home' });
  }

  shareReward(context) {
    if (!context || !['themes', 'effects'].includes(context.scene) ||
        typeof context.rewardId !== 'string' || !/^(theme|effect):[a-z0-9-]{1,80}$/.test(context.rewardId)) {
      return Promise.resolve({ initiated: false, reason: 'invalid-context' });
    }
    return this.initiate({ title: '来看看我在 CLEARED! 解锁的新外观', query: 'sv=1&scene=home' });
  }

  initiate(payload) {
    let result;
    try { result = this.platform.shareAppMessage(payload); } catch (error) { result = { initiated: false, reason: 'not-supported' }; }
    return Promise.resolve(result || { initiated: false, reason: 'not-supported' });
  }

  captureEntry(options) {
    if (this.config.attributionEnabled !== true) return false;
    const query = options && options.query;
    if (!query || typeof query !== 'object' || query.sv !== '1' || !shareIdValid(query.sid) || !SCENES.has(query.scene)) return false;
    if (this.seen.includes(query.sid) || this.pending.some(item => item.shareId === query.sid) || this.pending.length >= 20) return false;
    const sequenceId = this.store.nextId();
    if (!sequenceId) return false;
    const current = this.auth.current();
    const entryScene = Number.isInteger(options.scene) && options.scene >= 0 && options.scene <= 99999 ? options.scene : 0;
    this.pending.push({ shareId: query.sid, entryScene, attributionId: sequenceId.replace(/:(\d+)$/, ':share-entry:$1'), userId: current ? current.userId : null });
    this.save();
    if (this.behavior) this.behavior.track('share_entry_detected', { scene: query.scene, entryScene });
    return true;
  }

  consumePendingAttribution(session) {
    if (this.config.attributionEnabled !== true || !this.api.isConfigured() || !session) return Promise.resolve({ ok: false, reason: 'not-configured' });
    if (this.attributing) return this.attributing;
    this.attributing = this.consume(session.userId).catch(() => ({ ok: false, reason: 'network' }))
      .finally(() => { this.attributing = null; });
    return this.attributing;
  }

  async consume(userId) {
    for (const item of this.pending.slice()) {
      const current = this.auth.current();
      if (!current || current.userId !== userId) return { ok: false, reason: 'account-mismatch' };
      if (item.userId && item.userId !== userId) continue;
      item.userId = userId;
      if (!this.save()) return { ok: false, reason: 'persist-failed' };
      const options = { method: 'POST', path: ApiClient.PATHS.attributions, auth: true, idempotencyKey: item.attributionId,
        body: { shareId: item.shareId, entryScene: item.entryScene, attributionId: item.attributionId } };
      let result = await this.api.request(options);
      if (!result.ok && result.error.code === 'unauthorized') {
        const restored = await this.auth.ensureSession();
        const next = this.auth.current();
        if (!restored.ok || !next || next.userId !== userId) return { ok: false, reason: 'account-mismatch' };
        result = await this.api.request(options);
      }
      const after = this.auth.current();
      if (!after || after.userId !== userId) return { ok: false, reason: 'account-mismatch' };
      if (!result.ok) {
        if (['SELF_INVITE', 'SHARE_INTENT_EXPIRED', 'SHARE_INTENT_NOT_FOUND', 'INVITEE_INELIGIBLE', 'CAMPAIGN_CLOSED'].includes(result.error.code)) {
          if (!this.acknowledge(item)) return { ok: false, reason: 'persist-failed' };
          if (this.behavior) this.behavior.track('reward_rejected', { source: 'share_attribution', reason: result.error.code });
          continue;
        }
        return { ok: false, reason: result.error.code };
      }
      if (result.data.attributed !== true && result.data.alreadyAttributed !== true) return { ok: false, reason: 'invalid-response' };
      if ((result.data.attributionId && result.data.attributionId !== item.attributionId) ||
          (result.data.shareId && result.data.shareId !== item.shareId)) return { ok: false, reason: 'invalid-response' };
      if (!this.acknowledge(item)) return { ok: false, reason: 'persist-failed' };
      if (this.behavior) this.behavior.track('share_attributed', { entryScene: item.entryScene });
    }
    return { ok: true };
  }

  acknowledge(item) {
    const previousPending = this.pending;
    const previousSeen = this.seen;
    this.pending = this.pending.filter(entry => entry !== item);
    this.seen = this.seen.concat(item.shareId).slice(-50);
    if (this.save()) return true;
    this.pending = previousPending;
    this.seen = previousSeen;
    return false;
  }
}

ShareService.STORAGE_KEY = STORAGE_KEY;
module.exports = ShareService;
