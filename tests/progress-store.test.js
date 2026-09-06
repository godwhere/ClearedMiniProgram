const assert = require('assert');
const ProgressStore = require('../src/services/progress-store.js');

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
  const store = new ProgressStore(platform);
  assert.strictEqual(store.state.schemaVersion, 2);
  assert.strictEqual(store.state.settings.clearEffectId, 'none');
  const first = store.recordCompletion(1, 2, 8000);
  assert.strictEqual(first.firstClear, true);
  assert.strictEqual(first.newBest, true);
  assert.strictEqual(store.bestTime(1, 2), 8000);

  const slower = store.recordCompletion(1, 2, 10000);
  assert.strictEqual(slower.firstClear, false);
  assert.strictEqual(slower.newBest, false);
  assert.strictEqual(store.bestTime(1, 2), 8000);

  const faster = store.recordCompletion(1, 2, 6000);
  assert.strictEqual(faster.newBest, true);
  assert.strictEqual(store.bestTime(1, 2), 6000);
  assert.strictEqual(store.completedCount(), 1);

  store.setSetting('skinId', 'classic');
  const reloaded = new ProgressStore(platform);
  assert.strictEqual(reloaded.isCompleted(1, 2), true);
  assert.strictEqual(reloaded.bestTime(1, 2), 6000);
  assert.strictEqual(reloaded.getSetting('skinId'), 'classic');
  assert.strictEqual(reloaded.getSetting('clearEffectId'), 'none');
  assert.deepStrictEqual(reloaded.exportRewardCompletions(), { ok: true, levelKeys: ['1:2'] });

  // Existing v2 saves may predate the effect setting. Normalization adds only
  // the new default and leaves the other settings/progress fields intact.
  const oldV2Platform = new MemoryPlatform();
  oldV2Platform.storage[ProgressStore.STORAGE_KEY] = {
    schemaVersion: 2,
    completed: { '2:3': true },
    bestMs: { '2:3': 1234 },
    lastPlayed: { setIndex: 2, levelIndex: 3 },
    settings: { skinId: 'classic', soundEnabled: false },
    stats: { totalClears: 9 }
  };
  const oldV2 = new ProgressStore(oldV2Platform);
  assert.strictEqual(oldV2.getSetting('clearEffectId'), 'fade');
  assert.strictEqual(oldV2.getSetting('soundEnabled'), false);
  assert.strictEqual(oldV2.isCompleted(2, 3), true);

  const sets = [
    { Games: [{}, {}] },
    { Games: [{}] }
  ];
  assert.deepStrictEqual(reloaded.resumeTarget(sets), { setIndex: 0, levelIndex: 0 });
  reloaded.recordCompletion(0, 0, 1000);
  assert.deepStrictEqual(reloaded.resumeTarget(sets), { setIndex: 0, levelIndex: 1 });

  const legacyPlatform = new MemoryPlatform();
  legacyPlatform.storage['cleared:progress:v1'] = {
    completed: { '0:0': true },
    last: { set: 0, level: 1 }
  };
  const migrated = new ProgressStore(legacyPlatform);
  assert.strictEqual(migrated.isCompleted(0, 0), true);
  assert.deepStrictEqual(migrated.state.lastPlayed, { setIndex: 0, levelIndex: 1 });
  assert.strictEqual(migrated.getSetting('clearEffectId'), 'fade');

  const explicitSelectionPlatform = new MemoryPlatform();
  explicitSelectionPlatform.storage[ProgressStore.STORAGE_KEY] = {
    schemaVersion: 2,
    completed: {},
    bestMs: {},
    settings: { skinId: 'classic', clearEffectId: 'none', soundEnabled: true },
    stats: { totalClears: 0 }
  };
  assert.strictEqual(new ProgressStore(explicitSelectionPlatform).getSetting('clearEffectId'), 'none',
    'an existing explicit no-effect selection is preserved');

  const corruptPlatform = new MemoryPlatform();
  corruptPlatform.storage[ProgressStore.STORAGE_KEY] = {
    completed: 'broken',
    bestMs: [],
    settings: 7,
    stats: null,
    lastPlayed: 'bad'
  };
  const recovered = new ProgressStore(corruptPlatform);
  assert.strictEqual(recovered.completedCount(), 0);
  assert.strictEqual(recovered.getSetting('skinId'), 'classic');
  assert.strictEqual(recovered.getSetting('clearEffectId'), 'fade',
    'an existing corrupt settings record keeps the compatibility fallback');
  assert.strictEqual(recovered.state.lastPlayed, null);

  const before = JSON.stringify({ settings: store.state.settings, stats: store.state.stats, lastPlayed: store.state.lastPlayed });
  const hostile = JSON.parse('{"schemaVersion":1,"levels":{"__proto__":{"completed":true},"999:0":{"completed":true},"0:0":{"completed":true,"bestMs":100},"1:2":{"completed":false,"bestMs":9000}}}');
  assert(store.mergeCloudSnapshot(hostile).ok);
  assert.strictEqual(store.isCompleted(1, 2), true);
  assert.strictEqual(store.bestTime(1, 2), 6000);
  assert.strictEqual(store.bestTime(0, 0), 100);
  assert.strictEqual(store.state.completed['999:0'], undefined);
  assert.strictEqual(JSON.stringify({ settings: store.state.settings, stats: store.state.stats, lastPlayed: store.state.lastPlayed }), before);
  assert.deepStrictEqual(Object.keys(store.exportCloudSnapshot()), ['schemaVersion', 'levels']);
  assert.strictEqual(store.mergeCloudSnapshot({ schemaVersion: 9, levels: {} }).ok, false);

  const authoritativePlatform = new MemoryPlatform();
  const authoritative = new ProgressStore(authoritativePlatform);
  assert(authoritative.setSetting('soundEnabled', false));
  assert(authoritative.applyAuthoritativeProgressSnapshot({ schemaVersion: 1,
    levels: { '0:0': { completed: true } }, lastPlayed: null }, []).ok,
  'historical completed levels without a recorded best time remain restorable');
  assert.strictEqual(authoritative.isCompleted(0, 0), true);
  assert.strictEqual(authoritative.bestTime(0, 0), 0);
  assert.strictEqual(authoritative.getSetting('soundEnabled'), false);

  const retained = store.state; platform.setStorage = () => false;
  assert.strictEqual(store.mergeCloudSnapshot({ schemaVersion: 1, levels: { '0:1': { completed: true } } }).reason, 'persist-failed');
  assert.strictEqual(store.state, retained);
  const previousSkin = store.getSetting('skinId');
  assert.strictEqual(store.setSetting('skinId', 'gem'), false);
  assert.strictEqual(store.getSetting('skinId'), previousSkin);
  platform.readStorageResult = () => ({ ok: false, reason: 'storage-read-failed' });
  assert.deepStrictEqual(store.exportRewardCompletions(), { ok: false, reason: 'storage-read-failed' });
}

module.exports = run;
