'use strict';

const catalog = require('../../data/catalog-v2.js');
const DailyChallengeService = require('./daily-challenge-service.js');
const STORAGE_KEY = 'cleared:minigame:hint-access:v1';
// One local day only. Raise this bound with the storage contract if a future
// catalog can offer more than 1024 distinct hint unlocks in one day.
const MAX_UNLOCKS = 1024;
const validId = value => typeof value === 'string' && value.length > 0 &&
  value.length <= 180 && !/[\x00-\x1f\x7f]/.test(value);

function validLevelKey(key) {
  if (typeof key !== 'string' || key.length > 4096) return false;
  const ordinary = /^catalog:(0|[1-9]\d*):(0|[1-9]\d*)$/.exec(key);
  if (ordinary) {
    const set = catalog.sets[Number(ordinary[1])];
    return !!(set && set.Games && set.Games[Number(ordinary[2])]);
  }
  const daily = /^daily:([^:]+):([^:]+)$/.exec(key);
  if (!daily) return false;
  try {
    return daily.slice(1).every(part => {
      const id = decodeURIComponent(part);
      return validId(id) && encodeURIComponent(id) === part;
    });
  } catch (error) { return false; }
}

function levelKey(context) {
  if (!context) return null;
  let key;
  if (context.source === 'catalog' && Number.isInteger(context.setIndex) && Number.isInteger(context.levelIndex)) {
    key = `catalog:${context.setIndex}:${context.levelIndex}`;
  } else if (context.source === 'daily' && validId(context.dayId) && validId(context.challengeId)) {
    key = `daily:${encodeURIComponent(context.dayId)}:${encodeURIComponent(context.challengeId)}`;
  }
  return validLevelKey(key) ? key : null;
}

class HintAccessService {
  constructor(platform, options) {
    const opts = options || {};
    this.platform = platform;
    this.clock = opts.clock || (() => new Date());
    this.timeZone = opts.timeZone || 'Asia/Shanghai';
    this.pendingSave = new Set();
    let saved;
    try { saved = platform.getStorage(STORAGE_KEY); } catch (error) {}
    const valid = saved && saved.schemaVersion === 1 && DailyChallengeService.isValidDateKey(saved.dateKey) &&
      Array.isArray(saved.unlockedLevelKeys);
    this.state = { schemaVersion: 1, dateKey: valid ? saved.dateKey : this.dateKey(),
      unlockedLevelKeys: valid ? Array.from(new Set(saved.unlockedLevelKeys.slice(0, MAX_UNLOCKS).filter(validLevelKey))) : [] };
  }

  dateKey() {
    try {
      const value = this.clock();
      const date = value instanceof Date ? value : new Date(value);
      return Number.isFinite(date.getTime()) ? DailyChallengeService.dateKeyFor(date, this.timeZone) : null;
    } catch (error) { return null; }
  }

  save() {
    try { return this.platform.setStorage(STORAGE_KEY, this.state) === true; } catch (error) { return false; }
  }

  status(context) {
    const today = this.dateKey();
    if (!today) return { ok: false, reason: 'invalid-date', unlocked: false, unlockCount: 0 };
    if (this.state.dateKey !== today) {
      // Expired permissions disappear even if storage is temporarily offline.
      // A later successful unlock also replaces the old durable day record.
      this.state = { schemaVersion: 1, dateKey: today, unlockedLevelKeys: [] };
      this.pendingSave.clear();
      this.save();
    }
    if (!context || context.dateKey !== today || !validLevelKey(context.levelKey)) {
      return { ok: false, reason: 'invalid-context', unlocked: false, unlockCount: this.state.unlockedLevelKeys.length };
    }
    const pendingKey = this.pendingSave.values().next().value;
    const unlocked = this.state.unlockedLevelKeys.includes(context.levelKey);
    const pendingSave = this.pendingSave.has(context.levelKey);
    return { ok: true, unlocked, pendingSave,
      pendingSaveContext: pendingKey ? { dateKey: today, levelKey: pendingKey } : null,
      canUnlock: unlocked || pendingSave || this.state.unlockedLevelKeys.length + this.pendingSave.size < MAX_UNLOCKS,
      unlockCount: this.state.unlockedLevelKeys.length };
  }

  retryPendingSave() {
    const key = this.pendingSave.values().next().value;
    if (!key) return { ok: false, reason: 'no-pending-save' };
    const context = { dateKey: this.state.dateKey, levelKey: key };
    // unlock rechecks the current day. A midnight retry cannot carry an old
    // qualification into the new day's free slot.
    return Object.assign({}, this.unlock(context), context);
  }

  unlock(context) {
    const status = this.status(context);
    if (!status.ok) return { ok: false, reason: status.reason };
    if (status.unlocked) return { ok: true, alreadyUnlocked: true };
    if (!status.canUnlock) {
      return { ok: false, reason: 'unlock-limit' };
    }
    // Remember qualification in memory so a failed disk write can be retried
    // without another share. This set never grants access before persistence.
    this.pendingSave.add(context.levelKey);
    const previous = this.state;
    this.state = Object.assign({}, previous, { unlockedLevelKeys: previous.unlockedLevelKeys.concat(context.levelKey) });
    if (!this.save()) {
      this.state = previous;
      return { ok: false, reason: 'persist-failed' };
    }
    this.pendingSave.delete(context.levelKey);
    return { ok: true, alreadyUnlocked: false };
  }
}

HintAccessService.STORAGE_KEY = STORAGE_KEY;
HintAccessService.levelKey = levelKey;
module.exports = HintAccessService;
