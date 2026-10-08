'use strict';

const clearTiming = require('./clear-animation-timing.js');
const FIELDS = Object.freeze(['skinId', 'clearEffectId', 'clearMode', 'soundEnabled']);

function record(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validSnapshot(value) {
  return record(value) && value.schemaVersion === 1 &&
    Object.keys(value).length === (value.clearMode === undefined ? 4 : 5) &&
    (value.clearMode === undefined || clearTiming.validMode(value.clearMode)) &&
    typeof value.skinId === 'string' && value.skinId.length > 0 &&
    typeof value.clearEffectId === 'string' && value.clearEffectId.length > 0 &&
    typeof value.soundEnabled === 'boolean';
}

class PreferencesService {
  constructor(progress) {
    this.progress = progress;
    this.bound = null;
  }

  bind(services) {
    this.bound = services || null;
    this.refreshRuntime();
  }

  exportAuthoritativeSnapshot() {
    const snapshot = { schemaVersion: 1,
      skinId: this.progress.getSetting('skinId', 'classic'),
      clearEffectId: this.progress.getSetting('clearEffectId', 'none'),
      clearMode: this.progress.getSetting('clearMode', clearTiming.DEFAULT_MODE),
      soundEnabled: this.progress.getSetting('soundEnabled', true) };
    return validSnapshot(snapshot) ? { ok: true, snapshot } : { ok: false, reason: 'invalid-snapshot' };
  }

  exportBackupSnapshot() {
    if (!this.progress || typeof this.progress.exportPersistedPreferencesSnapshot !== 'function') {
      return { ok: false, reason: 'storage-read-failed' };
    }
    const result = this.progress.exportPersistedPreferencesSnapshot();
    return result.ok && validSnapshot(result.snapshot) ? result
      : { ok: false, reason: result.reason || 'invalid-storage' };
  }

  normalizeForOwnership(snapshot) {
    const value = Object.assign({}, snapshot);
    const bound = this.bound;
    if (!bound) return value;
    if (!bound.skins || !bound.skins.get(value.skinId) || !bound.canUse('theme', value.skinId)) value.skinId = 'classic';
    if (!bound.clearEffects || !bound.clearEffects.get(value.clearEffectId) ||
        !bound.canUse('effect', value.clearEffectId)) value.clearEffectId = 'none';
    return value;
  }

  applyAuthoritativeSnapshot(value, pendingOperations) {
    if (!validSnapshot(value)) return { ok: false, reason: 'invalid-snapshot' };
    let snapshot = Object.assign({ clearMode: clearTiming.DEFAULT_MODE }, value);
    for (const operation of Array.isArray(pendingOperations) ? pendingOperations : []) {
      if (!operation || operation.domain !== 'preferences' || operation.type !== 'PREFERENCE_FIELD_SET' ||
          !record(operation.payload) || !FIELDS.includes(operation.payload.field)) continue;
      const { field, value: fieldValue } = operation.payload;
      if (field === 'clearMode' && !clearTiming.validMode(fieldValue)) return { ok: false, reason: 'invalid-operation-overlay' };
      if ((field === 'soundEnabled' && typeof fieldValue !== 'boolean') ||
          (field !== 'soundEnabled' && (typeof fieldValue !== 'string' || !fieldValue))) {
        return { ok: false, reason: 'invalid-operation-overlay' };
      }
      snapshot[field] = fieldValue;
    }
    snapshot = this.normalizeForOwnership(snapshot);
    const result = this.progress.applyAuthoritativePreferencesSnapshot(snapshot);
    if (!result.ok) return result;
    this.refreshRuntime();
    return { ok: true };
  }

  applyBackupSnapshot(value) { return this.applyAuthoritativeSnapshot(value, []); }

  refreshRuntime() {
    if (!this.bound) return;
    for (const service of [this.bound.skins, this.bound.clearEffects, this.bound.audio]) {
      try { if (service && typeof service.refreshSetting === 'function') service.refreshSetting(); } catch (error) {}
    }
  }
}

PreferencesService.FIELDS = FIELDS;
module.exports = PreferencesService;
