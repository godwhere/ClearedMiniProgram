'use strict';

const assert = require('assert');
const SyncStore = require('../src/services/sync-store.js');
const ProgressStore = require('../src/services/progress-store.js');
const ProgressSync = require('../src/services/progress-sync-service.js');
const { RewardPlatform } = require('./helpers/reward-fixture.js');
const { canonical, fingerprint } = require('../src/services/sync-payload.js');
const operation = value => ({ domain: 'progress', type: 'level_completed', occurredAtClient: 100,
  payload: { levelKey: '0:0', elapsedMs: value || 1000, completedAtClient: 100 } });

async function run() {
  const platform = new RewardPlatform(); const store = new SyncStore(platform);
  const installId = store.state.installId; const migrationId = store.state.migrationId;
  const guest = store.enqueueOperation(operation()); assert(guest.ok);
  const guestBefore = store.scopeFor(null);
  assert(store.activateScope('player_A', 1).ok);
  assert.deepStrictEqual(store.scopeFor(null), guestBefore, 'activation never moves guest operations');
  const a = store.enqueueOperation(operation()); assert(a.ok); const aToken = store.context();
  const aBefore = store.currentScope();
  assert.strictEqual(aBefore.pendingOperations[0].ownerIdAtCreation, 'player_A');
  assert.strictEqual(aBefore.pendingOperations[0].bindingEpochAtCreation, 1);
  assert.strictEqual(aBefore.pendingOperations[0].payloadHash, fingerprint(operation().payload));
  const leaked = store.currentScope(); leaked.pendingOperations[0].payload.elapsedMs = 1;
  assert.strictEqual(store.currentScope().pendingOperations[0].payload.elapsedMs, 1000);
  assert.throws(() => { store.state.scopes.player_A.pendingOperations[0].ownerIdAtCreation = 'player_B'; });
  assert(store.enqueueOperation(Object.assign(operation(), { operationId: a.operationId })).alreadyQueued);
  const sequence = store.state.nextOperationSequence;
  assert.strictEqual(store.enqueueOperation(Object.assign(operation(999), { operationId: a.operationId })).reason, 'idempotency-conflict');
  assert.strictEqual(store.state.nextOperationSequence, sequence);
  assert.strictEqual(store.enqueueOperation(Object.assign(operation(), { operationId: 'unknown' })).reason, 'unknown-operation');
  assert.strictEqual(store.enqueueOperation(Object.assign(operation(), { ownerIdAtCreation: 'player_B' })).reason, 'account-mismatch');

  assert(store.activateScope('player_B', 1).ok);
  const b = store.enqueueOperation(operation(900)); assert(b.ok);
  assert.deepStrictEqual(store.scopeFor('player_A'), aBefore);
  assert.strictEqual(store.acknowledge([a.operationId], aToken), false);
  assert.strictEqual(store.enqueueOperation(Object.assign(operation(), { operationId: a.operationId })).reason, 'account-mismatch');
  assert(store.acknowledge([a.operationId, 'unknown'], store.context()));
  assert.strictEqual(store.scopeFor('player_A').pendingOperations.length, 1);
  assert.strictEqual(store.scopeFor('player_B').pendingOperations.length, 1);
  const diskBefore = JSON.stringify(platform.storage); const stateBefore = canonical(store.state);
  platform.writeFailures[SyncStore.STORAGE_KEY] = true;
  assert.strictEqual(store.activateScope('player_A', 1).reason, 'persist-failed');
  assert.strictEqual(canonical(store.state), stateBefore); assert.strictEqual(JSON.stringify(platform.storage), diskBefore);
  platform.writeFailures[SyncStore.STORAGE_KEY] = false;
  assert(store.activateScope('player_A', 1).ok); assert.strictEqual(store.matches(aToken), false, 'A-B-A invalidates old activation tokens');
  assert.deepStrictEqual(store.currentScope(), aBefore);
  const reloaded = new SyncStore(platform);
  assert.strictEqual(reloaded.state.schemaVersion, 2); assert.strictEqual(reloaded.state.activeOwnerId, 'player_A');
  assert.strictEqual(reloaded.state.installId, installId); assert.strictEqual(reloaded.state.migrationId, migrationId);
  assert.strictEqual(reloaded.state.nextOperationSequence, store.state.nextOperationSequence);
  assert.deepStrictEqual(reloaded.state.scopes, store.state.scopes);
  assert.strictEqual(new Set([guest.operationId, a.operationId, b.operationId]).size, 3);
  const second = reloaded.enqueueOperation(operation(800)); assert(second.ok);
  const current = reloaded.context();
  const beforeAck = canonical(reloaded.state);
  platform.writeFailures[SyncStore.STORAGE_KEY] = true;
  assert.strictEqual(reloaded.acknowledge([a.operationId], current), false);
  assert.strictEqual(canonical(reloaded.state), beforeAck);
  platform.writeFailures[SyncStore.STORAGE_KEY] = false;
  assert(reloaded.acknowledge([a.operationId, b.operationId, 'unknown'], current));
  assert.deepStrictEqual(reloaded.currentScope().pendingOperations.map(item => item.operationId), [second.operationId]);
  assert.deepStrictEqual(reloaded.scopeFor('player_B').pendingOperations.map(item => item.operationId), [b.operationId]);
  assert(reloaded.activateScope('player_A', 2).ok);
  assert.strictEqual(reloaded.acknowledge([second.operationId], reloaded.context()), false, 'old epoch operations remain quarantined');
  assert.strictEqual(reloaded.activateScope('player_A', 1).reason, 'account-mismatch');
  for (const owner of ['__proto__', 'usr_1', '../A', 'player:fake', undefined]) assert.strictEqual(reloaded.activateScope(owner, 1).ok, false);
  assert.strictEqual(reloaded.activateScope(null, 1).ok, false);
  const metadataBefore = canonical(reloaded.state);
  for (const invalid of [{ revisions: null }, { revisions: undefined }, { lastSyncAt: undefined },
    { lastError: undefined }, { snapshotRequired: undefined }]) assert.strictEqual(reloaded.updateScope(invalid, reloaded.context()), false);
  assert.strictEqual(canonical(reloaded.state), metadataBefore);
  assert.strictEqual(fingerprint({ b: 2, a: { z: true, x: null } }), fingerprint({ a: { x: null, z: true }, b: 2 }));
  for (const payload of [NaN, Infinity, { f() {} }, JSON.parse('{"__proto__":{}}')]) assert.throws(() => canonical(payload));
  const circular = {}; circular.self = circular; assert.throws(() => canonical(circular));
  for (const domain of SyncStore.DOMAINS.filter(item => item !== 'progress')) {
    assert(reloaded.enqueueOperation({ domain, type: 'future_operation', payload: { value: 1 }, occurredAtClient: 100 }).ok);
  }
  assert.strictEqual(reloaded.enqueueOperation({ domain: 'bad', type: 'future', payload: {}, occurredAtClient: 100 }).ok, false);

  // A shared gameplay cache is not B's cache. No automatic clearing,
  // snapshot upload, operation send or ACK is allowed after switching to B.
  const host = new RewardPlatform(); const queue = new SyncStore(host); const progress = new ProgressStore(host);
  assert(queue.bindLegacyUser('alice')); progress.recordCompletion(0, 0, 100);
  assert(queue.enqueue(operation().payload)); const aliceQueue = queue.currentScope();
  assert(queue.activateScope(SyncStore.legacyOwnerId('bob'), 0).ok);
  let calls = 0;
  const sync = new ProgressSync({ isConfigured: () => true, request: async () => { calls++; return {}; } },
    progress, queue, { current: () => ({ userId: 'bob' }) }, { enabled: true });
  assert.strictEqual((await sync.flush()).reason, 'account-mismatch'); assert.strictEqual(calls, 0);
  assert.deepStrictEqual(queue.scopeFor(SyncStore.legacyOwnerId('alice')), aliceQueue);
  assert(progress.isCompleted(0, 0));
}

run.operation = operation;
module.exports = run;
