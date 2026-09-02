'use strict';
const assert = require('assert');
const SyncStore = require('../src/services/sync-store.js');
module.exports = function run() {
  let saved; let fails = false;
  const platform = { getStorage: () => saved, setStorage(key, value) { if (fails) return false; saved = JSON.parse(JSON.stringify(value)); return true; } };
  const store = new SyncStore(platform);
  const first = store.nextId();
  const reload = new SyncStore(platform);
  assert.strictEqual(reload.state.installId, store.state.installId);
  assert.strictEqual(reload.state.migrationId, store.state.migrationId);
  assert.notStrictEqual(reload.nextId(), first);
  for (let i = 0; i < 201; i++) reload.enqueue({ levelKey: '0:0', elapsedMs: 10, completedAtClient: 1 });
  assert.strictEqual(reload.state.pendingOperations.length, 200);
  assert.strictEqual(reload.state.snapshotRequired, true);
  reload.acknowledge([reload.state.pendingOperations[0].operationId, 'unknown']);
  assert.strictEqual(reload.state.pendingOperations.length, 199);
  fails = true; assert.strictEqual(reload.nextId(), null, 'IDs are not exposed before durable sequence persistence');
};
