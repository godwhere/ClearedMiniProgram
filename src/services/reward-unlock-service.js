'use strict';

const STORAGE_KEY = 'cleared:minigame:reward-unlocks:v1';
const SCHEMA_VERSION = 1;
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const LEVEL_KEY_RE = /^(0|[1-9]\d*):(0|[1-9]\d*)$/;
const REWARD_ID_RE = /^(theme|effect):[a-z0-9-]{1,80}$/;
const ATTEMPT_ID_RE = /^[A-Za-z0-9_:-]{1,200}$/;
const BLOCKED = new Set(['__proto__', 'constructor', 'prototype']);
const registered = {
  theme: new Set(require('../skins/index.js').map(item => item.id)),
  effect: new Set(require('../effects/index.js').map(item => item.id))
};
const levelKeys = new Set(require('../../data/catalog-v2.js').levels.map(item => `${item.setIndex}:${item.levelIndex}`));
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_:-]{1,200}$/.test(value) && !BLOCKED.has(value);
const validRewardId = value => typeof value === 'string' && REWARD_ID_RE.test(value) && !BLOCKED.has(value.split(':')[1]);

function record(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function safeInteger(value, positive) {
  return Number.isSafeInteger(value) && (positive ? value > 0 : value >= 0);
}

function validDateKey(value) {
  if (typeof value !== 'string' || !DATE_KEY_RE.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (record(value)) {
    const result = {};
    Object.keys(value).forEach(key => {
      if (!BLOCKED.has(key)) result[key] = clone(value[key]);
    });
    return result;
  }
  return value;
}

function emptyState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    balance: 0,
    claimedOrdinary: {},
    claimedDaily: {},
    ownedRewards: {},
    adAttempts: {},
    pendingNotices: []
  };
}

function validBooleanMap(value, keyCheck) {
  if (!record(value)) return false;
  return Object.keys(value).every(key => !BLOCKED.has(key) && keyCheck(key) && value[key] === true);
}

function normalizeState(value) {
  if (record(value) && Object.keys(value).some(key => BLOCKED.has(key))) return null;
  if (!record(value) || value.schemaVersion !== SCHEMA_VERSION || !safeInteger(value.balance, false)) return null;
  if (!validBooleanMap(value.claimedOrdinary, key => LEVEL_KEY_RE.test(key))) return null;
  if (!record(value.claimedDaily) || !Object.keys(value.claimedDaily).every(key =>
    !BLOCKED.has(key) && validDateKey(key) && validId(value.claimedDaily[key]))) return null;
  if (!validBooleanMap(value.ownedRewards, validRewardId)) return null;
  if (!record(value.adAttempts)) return null;
  const adAttempts = {};
  const globallyUsed = new Set();
  for (const rewardId of Object.keys(value.adAttempts)) {
    const attempts = value.adAttempts[rewardId];
    if (!validRewardId(rewardId) || !Array.isArray(attempts)) return null;
    adAttempts[rewardId] = [];
    for (const attemptId of attempts) {
      if (typeof attemptId !== 'string' || !ATTEMPT_ID_RE.test(attemptId) || globallyUsed.has(attemptId)) return null;
      globallyUsed.add(attemptId);
      adAttempts[rewardId].push(attemptId);
    }
  }
  if (!Array.isArray(value.pendingNotices)) return null;
  const noticeSet = new Set();
  for (const rewardId of value.pendingNotices) {
    if (!validRewardId(rewardId) || ['theme:classic', 'effect:none'].includes(rewardId) || noticeSet.has(rewardId) || value.ownedRewards[rewardId] !== true) return null;
    noticeSet.add(rewardId);
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    balance: value.balance,
    claimedOrdinary: clone(value.claimedOrdinary),
    claimedDaily: clone(value.claimedDaily),
    ownedRewards: clone(value.ownedRewards),
    adAttempts,
    pendingNotices: Array.from(noticeSet)
  };
}

function validateConfig(config) {
  if (!record(config) || config.schemaVersion !== 1 || !record(config.currency) ||
      !safeInteger(config.currency.ordinaryFirstClear, true) ||
      !safeInteger(config.currency.dailyFirstComplete, true) || !Array.isArray(config.items)) return null;
  const items = Object.create(null);
  const byItem = Object.create(null);
  const byLevel = Object.create(null);
  for (const source of config.items) {
    if (!record(source) || !validRewardId(source.id) || !['theme', 'effect'].includes(source.kind) ||
        typeof source.itemId !== 'string' || source.id !== `${source.kind}:${source.itemId}` ||
        BLOCKED.has(source.itemId) || !registered[source.kind].has(source.itemId) || !record(source.unlock) || items[source.id]) return null;
    const unlock = clone(source.unlock);
    if (!['default', 'ordinary_level', 'currency', 'rewarded_ad', 'share'].includes(unlock.type)) return null;
    if (unlock.type === 'ordinary_level' && !levelKeys.has(unlock.levelKey)) return null;
    if (unlock.type === 'default' && !['theme:classic', 'effect:none'].includes(source.id)) return null;
    if (unlock.type === 'currency' && !safeInteger(unlock.cost, true)) return null;
    if (unlock.type === 'rewarded_ad' && !safeInteger(unlock.requiredCount, true)) return null;
    const item = { id: source.id, kind: source.kind, itemId: source.itemId, unlock };
    items[item.id] = item;
    byItem[`${item.kind}:${item.itemId}`] = item.id;
    if (unlock.type === 'ordinary_level') {
      if (!byLevel[unlock.levelKey]) byLevel[unlock.levelKey] = [];
      byLevel[unlock.levelKey].push(item.id);
    }
  }
  if (!items['theme:classic'] || items['theme:classic'].unlock.type !== 'default' ||
      !items['effect:none'] || items['effect:none'].unlock.type !== 'default') return null;
  return { currency: clone(config.currency), items, byItem, byLevel };
}

class RewardUnlockService {
  constructor(platform, config) {
    this.platform = platform || null;
    this.catalog = validateConfig(config);
    this.state = null;
    this.loadError = null;
    this.pendingExternal = null;
    this._authorityMode = 'legacy-local';
    this.load();
  }

  authorityMode() { return this._authorityMode; }
  setAuthorityMode(mode) {
    if (!['legacy-local', 'migration-freeze', 'cloud-authoritative', 'local-backup'].includes(mode) ||
        (this._authorityMode !== 'legacy-local' && mode === 'legacy-local')) return false;
    this._authorityMode = mode;
    return true;
  }
  authorityBlocked() {
    return { ok: false, reason: this._authorityMode, amountDelta: 0, newRewards: [], sources: [] };
  }
  exportMigrationSnapshot() {
    if (!this.state) return { ok: false, reason: this.loadError };
    if (!normalizeState(this.state)) return { ok: false, reason: 'invalid-storage' };
    return { ok: true, economy: { balance: this.state.balance, claimedOrdinary: clone(this.state.claimedOrdinary),
      claimedDaily: clone(this.state.claimedDaily) }, entitlements: { ownedRewards: clone(this.state.ownedRewards) } };
  }
  exportBackupSnapshot() {
    const read = this.readResult();
    if (!read || read.ok !== true || (read.found !== true && read.found !== false)) {
      return { ok: false, reason: 'storage-read-failed' };
    }
    let persisted = read.found ? read.value : emptyState();
    if (typeof persisted === 'string') {
      try { persisted = JSON.parse(persisted); } catch (error) { return { ok: false, reason: 'invalid-storage' }; }
    }
    const state = normalizeState(persisted);
    if (!state) return { ok: false, reason: 'invalid-storage' };
    return { ok: true,
      economy: { schemaVersion: 1, balance: state.balance,
        claimedOrdinary: clone(state.claimedOrdinary), claimedDaily: clone(state.claimedDaily) },
      entitlements: { schemaVersion: 1, ownedRewards: clone(state.ownedRewards),
        adAttempts: clone(state.adAttempts) } };
  }
  applyBackupSnapshot(input) {
    const economy = input && input.economy; const entitlements = input && input.entitlements;
    if (this._authorityMode !== 'local-backup' || !this.state || !record(economy) || economy.schemaVersion !== 1 ||
        !safeInteger(economy.balance, false) || !validBooleanMap(economy.claimedOrdinary, key => levelKeys.has(key)) ||
        !record(economy.claimedDaily) || !Object.keys(economy.claimedDaily).every(key => validDateKey(key) && validId(economy.claimedDaily[key])) ||
        !record(entitlements) || entitlements.schemaVersion !== 1 ||
        !validBooleanMap(entitlements.ownedRewards, key => !!this.item(key)) || !record(entitlements.adAttempts)) {
      return { ok: false, reason: 'invalid-snapshot' };
    }
    const candidate = clone(this.state);
    candidate.balance = economy.balance; candidate.claimedOrdinary = clone(economy.claimedOrdinary);
    candidate.claimedDaily = clone(economy.claimedDaily); candidate.ownedRewards = clone(entitlements.ownedRewards);
    candidate.adAttempts = clone(entitlements.adAttempts);
    const normalized = normalizeState(candidate);
    if (!normalized) return { ok: false, reason: 'invalid-snapshot' };
    normalized.pendingNotices = candidate.pendingNotices.filter(id => normalized.ownedRewards[id] === true);
    return this.write(normalized) ? { ok: true } : { ok: false, reason: 'persist-failed' };
  }

  readResult() {
    try {
      if (this.platform && typeof this.platform.readStorageResult === 'function') {
        return this.platform.readStorageResult(STORAGE_KEY);
      }
    } catch (error) {}
    return { ok: false, reason: 'storage-read-failed' };
  }

  load() {
    if (!this.catalog) {
      this.state = null; this.loadError = 'invalid-config'; return false;
    }
    const read = this.readResult();
    if (!read || read.ok !== true) {
      this.state = null; this.loadError = 'storage-read-failed'; return false;
    }
    if (read.found === false) {
      this.state = emptyState(); this.loadError = null; return true;
    }
    if (read.found !== true) { this.state = null; this.loadError = 'storage-read-failed'; return false; }
    let value = read.value;
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch (error) { value = null; }
    }
    const normalized = normalizeState(value);
    if (!normalized) {
      this.state = null; this.loadError = 'invalid-storage'; return false;
    }
    this.state = normalized; this.loadError = null; return true;
  }

  retryLoad() {
    if (this.state) return { ok: true, reason: 'already-loaded' };
    return this.load() ? { ok: true } : { ok: false, reason: this.loadError };
  }

  view() {
    return this.state ? { available: true, balance: this.state.balance, error: null }
      : { available: false, balance: null, error: this.loadError || 'unavailable' };
  }

  item(rewardId) {
    return this.catalog && this.catalog.items[rewardId] || null;
  }

  owned(rewardId) {
    if (rewardId === 'theme:classic' || rewardId === 'effect:none') return true;
    const item = this.item(rewardId);
    return !!(item && (item.unlock.type === 'default' || (this.state && this.state.ownedRewards[rewardId] === true)));
  }

  canUse(kind, itemId) {
    if ((kind === 'theme' && itemId === 'classic') || (kind === 'effect' && itemId === 'none')) return true;
    if (!this.state || !this.catalog) return false;
    const rewardId = this.catalog.byItem[`${kind}:${itemId}`];
    return !!(rewardId && this.state.ownedRewards[rewardId] === true);
  }

  status(rewardId) {
    const item = this.item(rewardId);
    if (!item && (rewardId === 'theme:classic' || rewardId === 'effect:none')) {
      const parts = rewardId.split(':');
      return { ok: true, id: rewardId, kind: parts[0], itemId: parts[1], owned: true, conditionType: 'default', action: 'apply' };
    }
    if (!item) return { ok: false, owned: false, action: 'unavailable', reason: 'invalid-reward' };
    const unlock = clone(item.unlock);
    const result = Object.assign({ ok: !!this.state, id: item.id, kind: item.kind, itemId: item.itemId,
      owned: this.owned(item.id), conditionType: unlock.type }, unlock);
    if (!this.state && unlock.type !== 'default') return Object.assign(result, { action: 'unavailable', reason: this.loadError });
    if (result.owned) return Object.assign(result, { action: 'apply' });
    if (unlock.type === 'currency') return Object.assign(result, { action: 'purchase' });
    if (unlock.type === 'rewarded_ad') {
      const progress = (this.state.adAttempts[item.id] || []).length;
      return Object.assign(result, { progress, action: 'rewarded_ad' });
    }
    if (unlock.type === 'share') return Object.assign(result, { action: 'share' });
    return Object.assign(result, { action: 'locked' });
  }

  write(candidate) {
    try {
      if (this.platform && typeof this.platform.setStorage === 'function' &&
          this.platform.setStorage(STORAGE_KEY, clone(candidate)) === true) {
        this.state = candidate;
        return true;
      }
    } catch (error) {}
    return false;
  }

  grant(candidate, rewardId, newRewards) {
    const item = this.item(rewardId);
    if (!item || item.unlock.type === 'default' || candidate.ownedRewards[rewardId] === true) return false;
    candidate.ownedRewards[rewardId] = true;
    if (candidate.pendingNotices.indexOf(rewardId) < 0) candidate.pendingNotices.push(rewardId);
    newRewards.push(rewardId);
    return true;
  }

  reconcile(input) {
    if (!['legacy-local', 'local-backup'].includes(this._authorityMode)) return this.authorityBlocked();
    if (!this.state) return { ok: false, reason: this.loadError, amountDelta: 0, newRewards: [] };
    const ordinary = input && input.ordinary;
    const daily = input && input.daily;
    if (!ordinary || ordinary.ok !== true || !Array.isArray(ordinary.levelKeys) ||
        !daily || daily.ok !== true || !Array.isArray(daily.days)) {
      return { ok: false, reason: 'invalid-completions', amountDelta: 0, newRewards: [] };
    }
    const candidate = clone(this.state);
    const newRewards = [];
    const sources = [];
    let amountDelta = 0;
    if (!ordinary.levelKeys.every(key => levelKeys.has(key)) || !daily.days.every(day => record(day) &&
        validDateKey(day.dateKey) && validId(day.dayId) && Array.isArray(day.levelIds) && day.levelIds.length === 2 &&
        day.levelIds.every(validId) && day.levelIds[0] !== day.levelIds[1])) {
      return { ok: false, reason: 'invalid-completions', amountDelta: 0, newRewards: [] };
    }
    const completedKeys = Array.from(new Set(ordinary.levelKeys));
    completedKeys.forEach(levelKey => {
      if (candidate.claimedOrdinary[levelKey] !== true) {
        candidate.claimedOrdinary[levelKey] = true;
        amountDelta += this.catalog.currency.ordinaryFirstClear;
        sources.push(`ordinary:${levelKey}`);
      }
      // Ownership conditions can be added in a later catalog version. They
      // remain eligible even when this level's first-clear currency was
      // already claimed under an older configuration.
      (this.catalog.byLevel[levelKey] || []).forEach(rewardId => this.grant(candidate, rewardId, newRewards));
    });
    const seenDays = new Set();
    daily.days.forEach(day => {
      if (!record(day) || !validDateKey(day.dateKey) || seenDays.has(day.dateKey) ||
          typeof day.dayId !== 'string' || !day.dayId || !Array.isArray(day.levelIds) || day.levelIds.length !== 2 || day.levelIds[0] === day.levelIds[1]) return;
      seenDays.add(day.dateKey);
      if (Object.prototype.hasOwnProperty.call(candidate.claimedDaily, day.dateKey)) return;
      candidate.claimedDaily[day.dateKey] = day.dayId;
      amountDelta += this.catalog.currency.dailyFirstComplete;
      sources.push(`daily:${day.dateKey}`);
    });
    if (!amountDelta && !newRewards.length) return { ok: true, reason: 'already-applied', amountDelta: 0, newRewards: [], sources: [] };
    if (!safeInteger(candidate.balance + amountDelta, false)) return { ok: false, reason: 'balance-overflow', amountDelta: 0, newRewards: [] };
    candidate.balance += amountDelta;
    if (!this.write(candidate)) return { ok: false, reason: 'persist-failed', amountDelta: 0, newRewards: [] };
    return { ok: true, amountDelta, newRewards, sources };
  }

  purchase(rewardId) {
    if (!['legacy-local', 'local-backup'].includes(this._authorityMode)) return this.authorityBlocked();
    if (!this.state) return { ok: false, reason: this.loadError, amountDelta: 0, newRewards: [] };
    const item = this.item(rewardId);
    if (!item || item.unlock.type !== 'currency') return { ok: false, reason: 'invalid-reward', amountDelta: 0, newRewards: [] };
    if (this.owned(rewardId)) return { ok: true, reason: 'already-owned', alreadyApplied: true, amountDelta: 0, newRewards: [] };
    if (this.state.balance < item.unlock.cost) return { ok: false, reason: 'insufficient-balance', amountDelta: 0, newRewards: [] };
    const candidate = clone(this.state);
    const newRewards = [];
    candidate.balance -= item.unlock.cost;
    this.grant(candidate, rewardId, newRewards);
    if (!this.write(candidate)) return { ok: false, reason: 'persist-failed', amountDelta: 0, newRewards: [] };
    return { ok: true, amountDelta: -item.unlock.cost, newRewards };
  }

  applyAuthoritativeAssets(input) {
    const economy = input && input.economy;
    const entitlements = input && input.entitlements;
    const hints = input && input.notificationHints || [];
    if (this._authorityMode !== 'cloud-authoritative') return this.authorityBlocked();
    if (!this.state || !record(economy) || economy.schemaVersion !== 1 || !safeInteger(economy.balance, false) ||
        !validBooleanMap(economy.claimedOrdinary, key => levelKeys.has(key)) ||
        !record(economy.claimedDaily) || !Object.keys(economy.claimedDaily).every(key =>
          validDateKey(key) && validId(economy.claimedDaily[key])) ||
        !record(entitlements) || entitlements.schemaVersion !== 1 ||
        !validBooleanMap(entitlements.ownedRewards, key => !!this.item(key)) ||
        !Array.isArray(hints) || !hints.every(validRewardId)) return { ok: false, reason: 'invalid-snapshot' };
    const candidate = clone(this.state);
    candidate.balance = economy.balance;
    candidate.claimedOrdinary = clone(economy.claimedOrdinary);
    candidate.claimedDaily = clone(economy.claimedDaily);
    candidate.ownedRewards = clone(entitlements.ownedRewards);
    const owned = rewardId => ['theme:classic', 'effect:none'].includes(rewardId) || candidate.ownedRewards[rewardId] === true;
    candidate.pendingNotices = candidate.pendingNotices.filter(rewardId => owned(rewardId));
    hints.forEach(rewardId => {
      if (!['theme:classic', 'effect:none'].includes(rewardId) && owned(rewardId) &&
          !this.owned(rewardId) && !candidate.pendingNotices.includes(rewardId)) candidate.pendingNotices.push(rewardId);
    });
    if (!this.write(candidate)) return { ok: false, reason: 'persist-failed' };
    return { ok: true };
  }

  isBlankCloudCore() {
    return !!this.state && this.state.balance === 0 && Object.keys(this.state.claimedOrdinary).length === 0 &&
      Object.keys(this.state.claimedDaily).length === 0 &&
      Object.keys(this.state.ownedRewards).filter(key => !['theme:classic', 'effect:none'].includes(key)).length === 0 &&
      Object.keys(this.state.adAttempts).length === 0 && this.state.pendingNotices.length === 0 && !this.pendingExternal;
  }

  globallyUsedAttempt(attemptId) {
    return Object.keys(this.state.adAttempts).some(rewardId => this.state.adAttempts[rewardId].indexOf(attemptId) >= 0);
  }

  recordAdCompletion(input, fromRetry) {
    if (!['legacy-local', 'local-backup'].includes(this._authorityMode)) return this.authorityBlocked();
    if (this.pendingExternal && !fromRetry) return { ok: false, reason: 'pending-save', amountDelta: 0, newRewards: [] };
    if (!this.state) return { ok: false, reason: this.loadError, amountDelta: 0, newRewards: [] };
    const rewardId = input && input.rewardId;
    const attemptId = input && input.attemptId;
    const item = this.item(rewardId);
    if (!item || item.unlock.type !== 'rewarded_ad' || typeof attemptId !== 'string' || !ATTEMPT_ID_RE.test(attemptId)) return { ok: false, reason: 'invalid-result', amountDelta: 0, newRewards: [] };
    if (this.owned(rewardId)) return { ok: true, reason: 'already-owned', alreadyApplied: true, amountDelta: 0, newRewards: [] };
    if (this.globallyUsedAttempt(attemptId)) return { ok: true, reason: 'duplicate-attempt', alreadyApplied: true, amountDelta: 0, newRewards: [] };
    const candidate = clone(this.state);
    if (!candidate.adAttempts[rewardId]) candidate.adAttempts[rewardId] = [];
    candidate.adAttempts[rewardId].push(attemptId);
    candidate.adAttempts[rewardId] = candidate.adAttempts[rewardId].slice(0, item.unlock.requiredCount);
    const newRewards = [];
    if (candidate.adAttempts[rewardId].length >= item.unlock.requiredCount) this.grant(candidate, rewardId, newRewards);
    if (!this.write(candidate)) {
      if (!fromRetry) this.pendingExternal = { type: 'ad', rewardId, attemptId };
      return { ok: false, reason: 'persist-failed', rewardId, amountDelta: 0, newRewards: [] };
    }
    this.pendingExternal = null;
    return { ok: true, rewardId, amountDelta: 0, newRewards, progress: candidate.adAttempts[rewardId].length };
  }

  recordShareInitiated(input, fromRetry) {
    if (!['legacy-local', 'local-backup'].includes(this._authorityMode)) return this.authorityBlocked();
    if (this.pendingExternal && !fromRetry) return { ok: false, reason: 'pending-save', amountDelta: 0, newRewards: [] };
    const rewardId = input && input.rewardId;
    const item = this.item(rewardId);
    if (!this.state) return { ok: false, reason: this.loadError, amountDelta: 0, newRewards: [] };
    if (!item || item.unlock.type !== 'share' || input.initiated !== true) return { ok: false, reason: 'not-initiated', amountDelta: 0, newRewards: [] };
    if (this.owned(rewardId)) return { ok: true, reason: 'already-owned', alreadyApplied: true, amountDelta: 0, newRewards: [] };
    const candidate = clone(this.state);
    const newRewards = [];
    this.grant(candidate, rewardId, newRewards);
    if (!this.write(candidate)) {
      if (!fromRetry) this.pendingExternal = { type: 'share', rewardId, initiated: true };
      return { ok: false, reason: 'persist-failed', rewardId, amountDelta: 0, newRewards: [] };
    }
    this.pendingExternal = null;
    return { ok: true, rewardId, amountDelta: 0, newRewards };
  }

  retryPendingSave() {
    const pending = this.pendingExternal && clone(this.pendingExternal);
    if (!pending) return { ok: false, reason: 'no-pending', amountDelta: 0, newRewards: [] };
    return pending.type === 'ad'
      ? this.recordAdCompletion(pending, true)
      : this.recordShareInitiated(pending, true);
  }

  hasPendingExternal() { return !!this.pendingExternal; }

  pendingNotices() {
    return this.state ? this.state.pendingNotices.slice() : [];
  }

  acknowledgeNotice(rewardId) {
    if (!this.state) return { ok: false, reason: this.loadError };
    const index = this.state.pendingNotices.indexOf(rewardId);
    if (index < 0) return { ok: true, reason: 'already-acknowledged' };
    const candidate = clone(this.state);
    candidate.pendingNotices.splice(index, 1);
    return this.write(candidate) ? { ok: true } : { ok: false, reason: 'persist-failed' };
  }
}

RewardUnlockService.STORAGE_KEY = STORAGE_KEY;
RewardUnlockService.emptyState = emptyState;
RewardUnlockService.validateConfig = validateConfig;

module.exports = RewardUnlockService;
