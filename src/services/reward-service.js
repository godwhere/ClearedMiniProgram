'use strict';

const ApiClient = require('./api-client.js');
const STORAGE_KEY = 'cleared:minigame:rewards:v1';
const idValid = value => typeof value === 'string' && /^[A-Za-z0-9_:-]{1,180}$/.test(value);
const copy = value => JSON.parse(JSON.stringify(value));
function validContext(value) {
  if (!value || typeof value.dateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.dateKey) || !idValid(value.dayId)) return false;
  const date = new Date(`${value.dateKey}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value.dateKey;
}
function claimInput(input) {
  if (!input || input.source !== 'rewarded_ad' || input.action !== 'daily_extra_entry' || input.placement !== 'dailyExtraEntry' ||
      !idValid(input.idempotencyKey) || !input.idempotencyKey.startsWith('adatt_') || !validContext(input.context) ||
      Object.keys(input).some(key => !['source', 'action', 'placement', 'idempotencyKey', 'context'].includes(key)) ||
      Object.keys(input.context).some(key => !['dateKey', 'dayId'].includes(key))) return null;
  return { source: input.source, action: input.action, placement: input.placement, idempotencyKey: input.idempotencyKey,
    context: { dateKey: input.context.dateKey, dayId: input.context.dayId } };
}
function grantData(data, context) {
  const e = data && data.entitlement;
  if (!validContext(context) || !data || data.ok !== true || data.granted !== true || data.action !== 'daily_extra_entry' ||
      !idValid(data.grantId) || !Number.isSafeInteger(data.stateVersion) || data.stateVersion < 0 ||
      !e || e.dateKey !== context.dateKey || !Number.isSafeInteger(e.entryLimit) || e.entryLimit <= 0 ||
      !Number.isSafeInteger(e.entriesUsed) || e.entriesUsed < 0 || !Number.isSafeInteger(e.entriesRemaining) ||
      e.entriesRemaining !== Math.max(0, e.entryLimit - e.entriesUsed)) return null;
  return { ok: true, granted: true, alreadyGranted: data.alreadyGranted === true,
    grantId: data.grantId, action: data.action, stateVersion: data.stateVersion,
    entitlement: { dateKey: e.dateKey, entryLimit: e.entryLimit, entriesUsed: e.entriesUsed, entriesRemaining: e.entriesRemaining } };
}

class RewardService {
  constructor(platform, api, auth, syncStore, config, behavior) {
    this.platform = platform;
    this.api = api;
    this.auth = auth;
    this.store = syncStore;
    this.config = config || {};
    this.behavior = behavior || null;
    this.pending = [];
    this.grants = [];
    this.inFlight = new Map();
    this.recovering = new Map();
    let saved;
    try { saved = platform.getStorage(STORAGE_KEY); } catch (error) {}
    if (saved && saved.schemaVersion === 1) {
      if (Array.isArray(saved.pending)) this.pending = saved.pending.slice(0, 20).filter(item => item && idValid(item.userId) && claimInput(item.input))
        .map(item => ({ userId: item.userId, input: claimInput(item.input) }));
      if (Array.isArray(saved.grants)) this.grants = saved.grants.slice(-64).filter(item => item && idValid(item.userId) && validContext(item.context) && grantData(item.grant, item.context))
        .map(item => ({ userId: item.userId, context: { dateKey: item.context.dateKey, dayId: item.context.dayId }, input: claimInput(item.input), grant: grantData(item.grant, item.context) }));
    }
  }

  enabled() { return this.config.enabled === true && this.api.isConfigured(); }
  matches(userId) {
    const current = this.auth.current();
    return !!current && current.userId === userId && (!this.store.state.boundUserId || this.store.state.boundUserId === userId);
  }
  save() {
    try { return this.platform.setStorage(STORAGE_KEY, { schemaVersion: 1, pending: this.pending, grants: this.grants }) === true; } catch (error) { return false; }
  }
  cached(context, userId) {
    return this.grants.filter(item => item.userId === userId && item.context.dateKey === context.dateKey && item.context.dayId === context.dayId)
      .sort((a, b) => a.grant.stateVersion - b.grant.stateVersion).map(item => Object.assign(copy(item.grant), { userId, context: copy(item.context) }));
  }
  pendingFor(context) {
    const current = this.auth.current();
    const item = current && this.pending.find(item => item.userId === current.userId && item.input.context.dateKey === context.dateKey && item.input.context.dayId === context.dayId);
    return item ? copy(item.input) : null;
  }
  claimedCount(context) {
    const current = this.auth.current();
    return current ? this.grants.filter(item => item.userId === current.userId && item.input && item.context.dateKey === context.dateKey && item.context.dayId === context.dayId).length : 0;
  }

  claim(input) {
    const normalized = claimInput(input);
    if (!this.enabled()) return Promise.resolve({ ok: false, reason: 'not-configured' });
    if (!normalized) return Promise.resolve({ ok: false, reason: 'invalid-claim' });
    const current = this.auth.current();
    if (!current || !this.matches(current.userId)) return Promise.resolve({ ok: false, reason: 'account-mismatch' });
    const userId = current.userId;
    const key = `${userId}|${normalized.idempotencyKey}`;
    const previous = this.grants.find(item => item.userId === userId && item.input && item.input.idempotencyKey === normalized.idempotencyKey);
    const pending = this.pending.find(item => item.userId === userId && item.input.idempotencyKey === normalized.idempotencyKey);
    if ((previous || pending) && JSON.stringify((previous || pending).input) !== JSON.stringify(normalized)) return Promise.resolve({ ok: false, reason: 'idempotency-conflict' });
    if (previous) return Promise.resolve(Object.assign(copy(previous.grant), { alreadyGranted: true, userId, context: copy(previous.context) }));
    if (this.inFlight.has(key)) return this.inFlight.get(key);
    if (!pending) {
      if (this.pending.length >= 20) return Promise.resolve({ ok: false, reason: 'pending-limit' });
      this.pending.push({ userId, input: normalized });
    }
    if (!this.save()) return Promise.resolve({ ok: false, reason: 'persist-failed' });
    const promise = this.send(userId, { method: 'POST', path: ApiClient.PATHS.rewards, auth: true,
      idempotencyKey: normalized.idempotencyKey, body: normalized }).then(result => {
      if (!result.ok) {
        if (this.behavior) this.behavior.track('reward_rejected', { action: normalized.action, reason: result.error.code });
        // Only explicit permanent server rejections may drop a pending claim.
        if (['DAILY_REWARD_LIMIT_REACHED', 'INVALID_REWARD_ACTION', 'REWARD_DISABLED'].includes(result.error.code)) {
          this.pending = this.pending.filter(item => item.userId !== userId || item.input.idempotencyKey !== normalized.idempotencyKey); this.save();
        }
        return { ok: false, reason: result.error.code };
      }
      const grant = grantData(result.data, normalized.context);
      if (!grant) return { ok: false, reason: 'invalid-response' };
      if (!this.remember(userId, normalized.context, grant, normalized)) return { ok: false, reason: 'persist-failed' };
      if (this.behavior) this.behavior.track('reward_granted', { action: grant.action, alreadyGranted: grant.alreadyGranted });
      return Object.assign(copy(grant), { userId, context: copy(normalized.context) });
    }).catch(() => ({ ok: false, reason: 'network' })).finally(() => { this.inFlight.delete(key); });
    this.inFlight.set(key, promise);
    return promise;
  }

  async send(userId, options) {
    if (!this.matches(userId)) return ApiClient.failure('account-mismatch');
    let result = await this.api.request(options);
    if (!result.ok && result.error.code === 'unauthorized') {
      const auth = await this.auth.ensureSession();
      if (!auth.ok || !this.matches(userId)) return ApiClient.failure('account-mismatch');
      result = await this.api.request(options);
    }
    return this.matches(userId) ? result : ApiClient.failure('account-mismatch');
  }

  remember(userId, context, grant, input) {
    const existing = this.grants.find(item => item.userId === userId && item.grant.grantId === grant.grantId);
    if (existing && (existing.context.dateKey !== context.dateKey || existing.context.dayId !== context.dayId ||
        existing.grant.entitlement.entryLimit !== grant.entitlement.entryLimit || existing.grant.stateVersion !== grant.stateVersion)) return false;
    const previousGrants = this.grants;
    const previousPending = this.pending;
    this.grants = this.grants.filter(item => item.userId !== userId || item.grant.grantId !== grant.grantId)
      .concat({ userId, context: copy(context), input: input || (existing && existing.input) || null, grant: copy(grant) }).slice(-64);
    if (input) this.pending = this.pending.filter(item => item.userId !== userId || item.input.idempotencyKey !== input.idempotencyKey);
    if (this.save()) return true;
    this.grants = previousGrants; this.pending = previousPending; return false;
  }

  recover(context) {
    if (!validContext(context) || !this.enabled()) return Promise.resolve({ ok: false, reason: 'not-configured', grants: [] });
    const current = this.auth.current();
    if (!current || !this.matches(current.userId)) return Promise.resolve({ ok: false, reason: 'account-mismatch', grants: [] });
    const userId = current.userId;
    const key = `${userId}|${context.dateKey}|${context.dayId}`;
    if (this.recovering.has(key)) return this.recovering.get(key);
    const promise = this.restore(userId, context).catch(() => ({ ok: false, reason: 'network', grants: this.matches(userId) ? this.cached(context, userId) : [] }))
      .finally(() => { this.recovering.delete(key); });
    this.recovering.set(key, promise);
    return promise;
  }

  async restore(userId, context) {
    for (const item of this.pending.slice()) {
      if (item.userId === userId && item.input.context.dateKey === context.dateKey && item.input.context.dayId === context.dayId) await this.claim(item.input);
    }
    const response = await this.send(userId, { method: 'GET', path: ApiClient.PATHS.entitlements + context.dateKey, auth: true });
    if (!response.ok) return { ok: false, reason: response.error.code, grants: this.matches(userId) ? this.cached(context, userId) : [] };
    const data = response.data;
    if (data.dayId !== context.dayId || !Array.isArray(data.grants) || data.grants.length > 50) return { ok: false, reason: 'invalid-response', grants: [] };
    const grants = data.grants.map(item => grantData(item, context));
    if (grants.some(item => !item)) return { ok: false, reason: 'invalid-response', grants: [] };
    for (const grant of grants) if (!this.remember(userId, context, grant)) return { ok: false, reason: 'persist-failed', grants: [] };
    return { ok: true, grants: this.cached(context, userId) };
  }
}

RewardService.STORAGE_KEY = STORAGE_KEY;
module.exports = RewardService;
