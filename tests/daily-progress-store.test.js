const assert = require('assert');
const DailyProgressStore = require('../src/services/daily-progress-store.js');

class MemoryPlatform {
  constructor() { this.storage = {}; }
  getStorage(key) { return this.storage[key] || null; }
  setStorage(key, value) {
    this.storage[key] = JSON.parse(JSON.stringify(value));
    return true;
  }
  readStorageResult(key) {
    return Object.prototype.hasOwnProperty.call(this.storage, key)
      ? { ok: true, found: true, value: JSON.parse(JSON.stringify(this.storage[key])) }
      : { ok: true, found: false };
  }
}

function run() {
  const platform = new MemoryPlatform();
  const store = new DailyProgressStore(platform, { clock: () => 1780000000000 });
  assert.strictEqual(DailyProgressStore.STORAGE_KEY, 'cleared:minigame:daily:v1');
  assert.strictEqual(DailyProgressStore.DEFAULT_ENTRY_LIMIT, 3);
  assert.strictEqual(store.get('2026-08-31'), null);

  const defaultBudgetEntry = store.recordEntry({
    dateKey: '2026-09-02', dayId: 'daily-2026-09-02-v1'
  });
  assert.strictEqual(defaultBudgetEntry.entryLimit, 3);
  assert.strictEqual(defaultBudgetEntry.entriesRemaining, 2);
  assert.strictEqual(store.canEnter('2026-09-02', 3), true);
  const debugEntry = store.recordEntry({
    dateKey: '2026-09-03', dayId: 'daily-2026-09-03-v1',
    entryLimit: 3, unlimited: true
  });
  assert.strictEqual(debugEntry.ok, true);
  assert.strictEqual(debugEntry.unlimited, true);
  assert.strictEqual(store.recordEntry({
    dateKey: '2026-09-03', dayId: 'daily-2026-09-03-v1',
    entryLimit: 3, unlimited: true
  }).ok, true);
  assert.strictEqual(store.getDay('2026-09-03').entriesUsed, 2);
  assert.strictEqual(store.requestEntryIncrease({ source: 'ad', idempotencyKey: 'ad-1' }).implemented, false);
  assert.strictEqual(store.getDay('2026-09-03').entriesUsed, 2);

  // Canonical two-level entry budget: one attempt starts the whole daily run,
  // and completing level 0 does not consume another entry.
  assert.strictEqual(store.canEnter('2026-09-01', 1), true);
  const entry = store.recordEntry({
    dateKey: '2026-09-01',
    dayId: 'daily-2026-09-01-v1',
    entryLimit: 1,
    levelIds: ['intro', 'extreme'],
    idempotencyKey: 'entry-1'
  });
  assert.strictEqual(entry.ok, true);
  assert.strictEqual(entry.entriesUsed, 1);
  assert.strictEqual(entry.entriesRemaining, 0);
  assert.strictEqual(store.canEnter('2026-09-01', 1), false);
  const duplicateEntry = store.recordEntry({
    dateKey: '2026-09-01', dayId: 'daily-2026-09-01-v1', entryLimit: 1,
    levelIds: ['intro', 'extreme'], idempotencyKey: 'entry-1'
  });
  assert.strictEqual(duplicateEntry.alreadyRecorded, true);
  assert.strictEqual(duplicateEntry.entriesUsed, 1);
  assert.strictEqual(store.recordLevelCompletion({
    dateKey: '2026-09-01', dayId: 'daily-2026-09-01-v1',
    levelId: 'intro', levelIndex: 0, levelCount: 2, elapsedMs: 1000
  }).dayCompleted, false);
  const finalLevel = store.recordLevelCompletion({
    dateKey: '2026-09-01', dayId: 'daily-2026-09-01-v1',
    levelId: 'extreme', levelIndex: 1, levelCount: 2, elapsedMs: 2000
  });
  assert.strictEqual(finalLevel.dayCompleted, true);
  assert.strictEqual(finalLevel.rewardEligible, true);
  assert.strictEqual(store.isCompleted('2026-09-01', 'daily-2026-09-01-v1'), true);
  assert.strictEqual(store.getDay('2026-09-01').entriesUsed, 1);
  assert.deepStrictEqual(store.exportRewardCompletions(), {
    ok: true,
    days: [{ dateKey: '2026-09-01', dayId: 'daily-2026-09-01-v1', levelIds: ['intro', 'extreme'] }]
  });

  const first = store.recordCompletion({
    dateKey: '2026-08-31', challengeId: 'daily-2026-08-31-v1', elapsedMs: 12345
  });
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.firstClear, true);
  assert.strictEqual(first.newBest, true);
  assert.strictEqual(first.bestMs, 12345);
  assert.strictEqual(store.isCompleted('2026-08-31', 'daily-2026-08-31-v1'), true);
  assert.deepStrictEqual(store.get('2026-08-31'), {
    challengeId: 'daily-2026-08-31-v1',
    completed: true,
    bestMs: 12345,
    completedAt: 1780000000000
  });

  const slower = store.recordCompletion({
    dateKey: '2026-08-31', challengeId: 'daily-2026-08-31-v1', elapsedMs: 15000
  });
  assert.strictEqual(slower.firstClear, false);
  assert.strictEqual(slower.newBest, false);
  assert.strictEqual(store.get('2026-08-31').bestMs, 12345);

  const faster = store.recordCompletion({
    dateKey: '2026-08-31', challengeId: 'daily-2026-08-31-v1', elapsedMs: 9000
  });
  assert.strictEqual(faster.firstClear, false);
  assert.strictEqual(faster.newBest, true);
  assert.strictEqual(store.get('2026-08-31').bestMs, 9000);

  const mismatch = store.recordCompletion({
    dateKey: '2026-08-31', challengeId: 'daily-other-v1', elapsedMs: 1
  });
  assert.strictEqual(mismatch.ok, false);
  assert.strictEqual(mismatch.challengeMismatch, true);
  assert.strictEqual(store.get('2026-08-31').challengeId, 'daily-2026-08-31-v1');

  const reloaded = new DailyProgressStore(platform);
  assert.strictEqual(reloaded.isCompleted('2026-08-31', 'daily-2026-08-31-v1'), true);
  assert.strictEqual(reloaded.isCompleted('2026-08-31', 'daily-other-v1'), false);
  assert.strictEqual(reloaded.get('bad-date'), null);

  const corrupt = new MemoryPlatform();
  corrupt.storage[DailyProgressStore.STORAGE_KEY] = {
    schemaVersion: 99,
    entries: {
      '2026-08-31': { challengeId: 'ok', completed: true, bestMs: 10 },
      'not-a-date': { challengeId: 'bad', completed: true, bestMs: 1 },
      '2026-09-01': 'bad'
    }
  };
  const recovered = new DailyProgressStore(corrupt);
  assert.strictEqual(recovered.isCompleted('2026-08-31', 'ok'), true);
  assert.strictEqual(recovered.get('not-a-date'), null);

  const invalid = store.recordCompletion({ dateKey: 'bad-date', challengeId: 'x', elapsedMs: 1 });
  assert.strictEqual(invalid.ok, false);
  assert.strictEqual(invalid.reason, 'invalid-date-key');

  const migratedPlatform = new MemoryPlatform();
  migratedPlatform.storage[DailyProgressStore.STORAGE_KEY] = {
    schemaVersion: 1,
    entries: { '2026-09-04': { dayId: 'd', entryLimit: 1, entriesUsed: 1 } }
  };
  const migratedStore = new DailyProgressStore(migratedPlatform);
  assert.strictEqual(migratedStore.canEnter('2026-09-04'), true,
    'old one-entry records use the new three-entry baseline when no override is supplied');
}

module.exports = run;
