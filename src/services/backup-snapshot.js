'use strict';

const { fingerprint, clone } = require('./sync-payload.js');
const ProgressStore = require('./progress-store.js');
const DailyProgressStore = require('./daily-progress-store.js');
const RewardUnlockService = require('./reward-unlock-service.js');
const StaminaService = require('./stamina-service.js');

const SNAPSHOT_LIMIT = 256 * 1024;
const DOMAIN_KEYS = ['progress', 'daily', 'economy', 'entitlements', 'stamina', 'preferences'];
const LOCAL_KEYS = [ProgressStore.STORAGE_KEY, DailyProgressStore.STORAGE_KEY,
  RewardUnlockService.STORAGE_KEY, StaminaService.STORAGE_KEY];
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);

function utf8Bytes(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (typeof text !== 'string') return Infinity;
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length &&
        text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4; index++;
    } else bytes += 3;
  }
  return bytes;
}

function validJson(value, depth) {
  if ((depth || 0) > 16) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(item => validJson(item, (depth || 0) + 1));
  return record(value) && Object.keys(value).every(key =>
    !['__proto__', 'constructor', 'prototype'].includes(key) && validJson(value[key], (depth || 0) + 1));
}

function validate(snapshot) {
  if (!record(snapshot) || snapshot.schemaVersion !== 1 ||
      typeof snapshot.createdDateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.createdDateKey) ||
      !record(snapshot.domains) || Object.keys(snapshot.domains).length !== DOMAIN_KEYS.length ||
      !DOMAIN_KEYS.every(key => record(snapshot.domains[key])) || !validJson(snapshot) ||
      utf8Bytes(snapshot) > SNAPSHOT_LIMIT) return { ok: false, reason: 'invalid-snapshot' };
  return { ok: true, snapshot: clone(snapshot), bytes: utf8Bytes(snapshot), snapshotHash: fingerprint(snapshot) };
}

class BackupSnapshot {
  constructor(services, options) {
    this.services = services || {};
    this.dateKey = options && typeof options.dateKey === 'function'
      ? options.dateKey : () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  }

  build() {
    const dateKey = this.dateKey();
    const progress = this.services.progress && this.services.progress.exportBackupSnapshot();
    const daily = this.services.daily && this.services.daily.exportBackupSnapshot(dateKey);
    const rewards = this.services.rewards && this.services.rewards.exportBackupSnapshot();
    const stamina = this.services.stamina && this.services.stamina.exportBackupSnapshot();
    const preferences = this.services.preferences && this.services.preferences.exportBackupSnapshot();
    const results = [progress, daily, rewards, stamina, preferences];
    const failed = results.find(result => !result || result.ok !== true);
    if (failed) return { ok: false, reason: failed && failed.reason || 'snapshot-not-ready' };
    return validate({ schemaVersion: 1, createdDateKey: dateKey, domains: {
      progress: progress.snapshot, daily: daily.snapshot, economy: rewards.economy,
      entitlements: rewards.entitlements, stamina: stamina.snapshot, preferences: preferences.snapshot
    } });
  }

  static localArchiveState(platform) {
    if (!platform || typeof platform.readStorageResult !== 'function') return { known: false, exists: true };
    let exists = false;
    for (const key of LOCAL_KEYS) {
      let result;
      try { result = platform.readStorageResult(key); } catch (error) { return { known: false, exists: true }; }
      if (!result || result.ok !== true || (result.found !== true && result.found !== false)) return { known: false, exists: true };
      exists = exists || result.found === true;
    }
    return { known: true, exists };
  }
}

BackupSnapshot.SNAPSHOT_LIMIT = SNAPSHOT_LIMIT;
BackupSnapshot.REQUEST_LIMIT = 288 * 1024;
BackupSnapshot.utf8Bytes = utf8Bytes;
BackupSnapshot.validate = validate;
module.exports = BackupSnapshot;
