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

  const oldCloud = JSON.parse(JSON.stringify(saved));
  delete oldCloud.domainAuthority; oldCloud.authorityMode = 'cloud-authoritative';
  const preserved = new SyncStore({ getStorage: () => oldCloud, setStorage: () => true });
  assert.strictEqual(preserved.blocked, false);
  assert.strictEqual(preserved.authorityMode('stamina'), 'cloud-authoritative',
    'historical global cloud authority is preserved fail-closed, never silently downgraded');
  assert.strictEqual(preserved.authorityMode('preferences'), 'cloud-authoritative');
  assert.deepStrictEqual(preserved.authorityModes(), {
    progress: 'cloud-authoritative', daily: 'cloud-authoritative', economy: 'cloud-authoritative',
    entitlements: 'cloud-authoritative', stamina: 'cloud-authoritative', preferences: 'cloud-authoritative'
  });

  const uncertainFreeze = JSON.parse(JSON.stringify(saved));
  delete uncertainFreeze.domainAuthority; uncertainFreeze.authorityMode = 'migration-freeze';
  assert.strictEqual(new SyncStore({ getStorage: () => uncertainFreeze, setStorage: () => true }).blocked, true,
    'an old global freeze with unknown target domains fails closed');

  const corruptQuarantine = JSON.parse(JSON.stringify(saved));
  corruptQuarantine.scopes.guest.quarantinedOperations = [{ operationId: 'op_1', code: 'BAD', quarantinedAt: -1 }];
  assert.strictEqual(new SyncStore({ getStorage: () => corruptQuarantine, setStorage: () => true }).blocked, true);

  const resumeOne = reload.enqueueOperation({ domain: 'progress', type: 'PROGRESS_LAST_PLAYED', occurredAtClient: 10,
    payload: { setIndex: 0, levelIndex: 0 } });
  const resumeTwo = reload.enqueueOperation({ domain: 'progress', type: 'PROGRESS_LAST_PLAYED', occurredAtClient: 20,
    payload: { setIndex: 1, levelIndex: 2 } });
  assert(resumeOne.ok && resumeTwo.ok); assert.notStrictEqual(resumeTwo.operationId, resumeOne.operationId);
  assert.strictEqual(reload.state.pendingOperations.filter(item => item.type === 'PROGRESS_LAST_PLAYED').length, 1);
  assert.deepStrictEqual(reload.state.pendingOperations.find(item => item.type === 'PROGRESS_LAST_PLAYED').payload,
    { setIndex: 1, levelIndex: 2 });
  assert(reload.markOperationsInFlight([resumeTwo.operationId], reload.context()));
  const resumeWhileSent = reload.enqueueOperation({ domain: 'progress', type: 'PROGRESS_LAST_PLAYED', occurredAtClient: 30,
    payload: { setIndex: 2, levelIndex: 2 } });
  assert(resumeWhileSent.ok);
  assert.strictEqual(reload.state.pendingOperations.filter(item => item.type === 'PROGRESS_LAST_PLAYED').length, 2,
    'an in-flight position is not treated as unsent coalescing input');
  reload.clearOperationsInFlight([resumeTwo.operationId]);
  const finalResume = reload.enqueueOperation({ domain: 'progress', type: 'PROGRESS_LAST_PLAYED', occurredAtClient: 40,
    payload: { setIndex: 3, levelIndex: 2 } });
  assert(finalResume.ok);
  assert.strictEqual(reload.state.pendingOperations.filter(item => item.type === 'PROGRESS_LAST_PLAYED').length, 1);

  for (let i = 0; i < 201; i++) reload.enqueue({ levelKey: '0:0', elapsedMs: 10, completedAtClient: 1 });
  assert.strictEqual(reload.state.pendingOperations.length, 200);
  assert.strictEqual(reload.state.snapshotRequired, true);
  reload.acknowledge([reload.state.pendingOperations[0].operationId, 'unknown']);
  assert.strictEqual(reload.state.pendingOperations.length, 199);
  fails = true; assert.strictEqual(reload.nextId(), null, 'IDs are not exposed before durable sequence persistence');
};
