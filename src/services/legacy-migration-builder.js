'use strict';

const { record, validId, clone, freeze, fingerprint } = require('./sync-payload.js');
const integer = value => Number.isSafeInteger(value) && value >= 0;
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function ids(value) {
  if (!Array.isArray(value) || !value.every(validId) || new Set(value).size !== value.length) throw Error('invalid-ids');
  return value.slice().sort();
}

class LegacyMigrationBuilder {
  constructor(services) { this.services = services; }

  buildSnapshot() {
    const { progress, daily, rewards, stamina, syncStore } = this.services;
    try {
      if (syncStore.blocked || !validId(syncStore.state.installId) || !validId(syncStore.state.migrationId)) throw Error('invalid-source');
      const wallet = rewards.exportMigrationSnapshot();
      const energy = stamina.exportAuthoritativeSnapshot();
      if (!wallet.ok || !energy.ok) throw Error('unavailable-domain');
      const ordinary = progress.exportCloudSnapshot();
      const last = progress.state.lastPlayed;
      if (last !== null && (!record(last) || !integer(last.setIndex) || !integer(last.levelIndex))) throw Error('invalid-resume');
      ordinary.lastPlayed = last && { setIndex: last.setIndex, levelIndex: last.levelIndex };
      if (!record(daily.state.entries)) throw Error('invalid-daily');
      const days = {};
      for (const dateKey of Object.keys(daily.state.entries).sort()) {
        const raw = daily.state.entries[dateKey];
        const day = daily.getDay(dateKey);
        if (!validDate(dateKey) || !record(raw) || !day || (day.dayId !== null && !validId(day.dayId)) ||
            !integer(day.entryLimit) || day.entryLimit < 1 || !integer(day.entriesUsed) || !record(day.levels)) throw Error('invalid-day');
        const levels = {};
        for (const id of Object.keys(day.levels).sort()) {
          const value = day.levels[id];
          if (!validId(id) || !record(value) || !integer(value.levelIndex) || typeof value.completed !== 'boolean' ||
              !integer(value.bestMs) || (value.completedAt !== undefined && !integer(value.completedAt))) throw Error('invalid-level');
          levels[id] = { levelIndex: value.levelIndex, completed: value.completed, bestMs: value.bestMs };
          if (value.completedAt !== undefined) levels[id].completedAt = value.completedAt;
        }
        const levelIds = ids(raw._levelIds || []);
        if (levelIds.some(id => !Object.prototype.hasOwnProperty.call(levels, id))) throw Error('invalid-level-ids');
        levelIds.sort((a, b) => levels[a].levelIndex - levels[b].levelIndex || (a < b ? -1 : a > b ? 1 : 0));
        const entryKeys = ids(raw._entryKeys || []);
        if (day.entryLimit !== 3 || day.entriesUsed > day.entryLimit || entryKeys.length > day.entriesUsed) {
          throw Error('invalid-entry-state');
        }
        for (let index = entryKeys.length; index < day.entriesUsed; index++) {
          entryKeys.push(`migration-entry:${dateKey}:${index}`);
        }
        days[dateKey] = { dayId: day.dayId, entryLimit: day.entryLimit, entriesUsed: day.entriesUsed,
          completed: day.completed, levels, levelIds,
          levelCount: raw._levelCount, entryKeys };
        if (!integer(days[dateKey].levelCount)) throw Error('invalid-level-count');
      }
      const preferences = { skinId: progress.getSetting('skinId', 'classic'),
        clearEffectId: progress.getSetting('clearEffectId', 'none'), soundEnabled: progress.getSetting('soundEnabled', true) };
      if (!validId(preferences.skinId) || !validId(preferences.clearEffectId) || typeof preferences.soundEnabled !== 'boolean') throw Error('invalid-preferences');
      const snapshot = clone({ schemaVersion: 1, policyVersion: 'LEGACY_PRIMARY_SNAPSHOT_V1',
        source: { installId: syncStore.state.installId, migrationId: syncStore.state.migrationId },
        progress: ordinary, daily: { schemaVersion: 1, days }, economy: wallet.economy,
        entitlements: wallet.entitlements, stamina: energy.snapshot, preferences });
      return { ok: true, snapshot: freeze(snapshot), snapshotHash: fingerprint(snapshot) };
    } catch (error) { return { ok: false, reason: 'invalid-migration-source' }; }
  }
}

module.exports = LegacyMigrationBuilder;
