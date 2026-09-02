'use strict';
const assert = require('assert');
const ProgressSyncService = require('../src/services/progress-sync-service.js');
const ProgressStore = require('../src/services/progress-store.js');
const SyncStore = require('../src/services/sync-store.js');
module.exports = async function run() {
  const storage = {};
  const platform = { getStorage: key => storage[key], setStorage(key, value) { storage[key] = JSON.parse(JSON.stringify(value)); return true; } };
  const sync = new ProgressSyncService({ request() { throw Error('disabled network'); } }, new ProgressStore(platform), new SyncStore(platform), { current: () => null }, { enabled: false });
  assert.strictEqual((await sync.bootstrap()).reason, 'not-configured');
  assert(sync.enqueueCompletion({ setIndex: 0, levelIndex: 0, elapsedMs: 5, completedAtClient: 1 }));
  assert.strictEqual(sync.store.state.pendingOperations.length, 1);
  assert.strictEqual((await sync.flush()).reason, 'not-configured');
};
