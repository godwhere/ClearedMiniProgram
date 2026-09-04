'use strict';

const assert = require('assert');
const SyncStore = require('../src/services/sync-store.js');
const { clone } = require('./helpers/cloud-readonly-fixture.js');

module.exports = function run() {
  let disk; let fail = false;
  const host = { getStorage: () => disk, setStorage: (key, value) => { if (fail) return false; disk = clone(value); return true; } };
  const store = new SyncStore(host); const payload = { levelKey: '0:0', completedAtClient: 1, elapsedMs: 10 };
  assert(store.enqueue(payload)); const guest = store.scopeFor(null);
  const ids = [store.state.installId, store.state.migrationId, store.state.nextOperationSequence];
  // Emulate a previously persisted phase-2 v2 record, without environment fields.
  delete disk.activeEnvironmentId; delete disk.localEnvironmentId;
  delete disk.scopes.guest.pendingApplication; delete disk.scopes.guest.lastApplication;
  const oldV2 = clone(disk);
  const upgraded = new SyncStore(host); assert.strictEqual(upgraded.blocked, false);
  assert.deepStrictEqual(upgraded.scopeFor(null), guest);
  assert.deepStrictEqual([upgraded.state.installId, upgraded.state.migrationId, upgraded.state.nextOperationSequence], ids);
  assert(upgraded.activateScope('player_A', 1).ok); assert(upgraded.enqueue(payload));
  const oldUnscoped = upgraded.scopeFor('player_A');
  assert(upgraded.activateScope('player_A', 1, 'test-env', true).ok);
  const test = upgraded.context(); assert(upgraded.enqueue(payload)); const testScope = upgraded.scopeFor('player_A', 'test-env');
  assert.strictEqual(testScope.pendingOperations[0].environmentIdAtCreation, 'test-env');
  assert(upgraded.activateScope('player_A', 1, 'future-prod-fixture', true).ok);
  assert.strictEqual(upgraded.matches(test), false); assert.strictEqual(upgraded.acknowledge([testScope.pendingOperations[0].operationId], test), false);
  assert.deepStrictEqual(upgraded.currentScope().pendingOperations, []);
  assert.deepStrictEqual(upgraded.scopeFor('player_A', 'test-env'), testScope);
  assert.deepStrictEqual(upgraded.scopeFor('player_A'), oldUnscoped, 'unknown-environment old scopes are retained, never guessed into test');
  assert.deepStrictEqual(upgraded.scopeFor(null), guest);
  assert(upgraded.allowsLocalGameplay()); assert(upgraded.enqueueLocal(payload));
  assert.strictEqual(upgraded.scopeFor(null).pendingOperations.length, 2);
  assert.strictEqual(upgraded.currentScope().pendingOperations.length, 0);
  const before = clone(disk); fail = true;
  assert.strictEqual(upgraded.activateScope('player_B', 1, 'test-env', true).reason, 'persist-failed');
  assert.deepStrictEqual(disk, before); assert.strictEqual(upgraded.context().ownerId, 'player_A'); fail = false;
  const restarted = new SyncStore(host); assert.strictEqual(restarted.blocked, false);
  assert.deepStrictEqual(restarted.context(), upgraded.context()); assert.deepStrictEqual(restarted.state.scopes, upgraded.state.scopes);
  assert.strictEqual(restarted.activateScope('player_A', 1, '../bad', true).reason, 'invalid-environment');
  assert.strictEqual(restarted.activateScope(null, 0, 'test-env', true).reason, 'invalid-environment');
  assert(restarted.activateScope('player_A', 2, 'test-env', true).ok);
  assert.strictEqual(restarted.activateScope('player_A', 1, 'test-env', true).reason, 'account-mismatch');

  for (const mode of ['migration-freeze', 'cloud-authoritative']) {
    disk = Object.assign(clone(oldV2), { authorityMode: mode }); const protectedDisk = clone(disk);
    assert.strictEqual(new SyncStore(host).blocked, true, 'missing recovery slots cannot be guessed after authority transition');
    assert.deepStrictEqual(disk, protectedDisk);
  }
  disk = clone(oldV2); disk.scopes.guest.pendingApplication = null;
  const incomplete = clone(disk);
  assert.strictEqual(new SyncStore(host).blocked, true, 'one missing slot is not the known old v2 shape');
  assert.deepStrictEqual(disk, incomplete);
};
