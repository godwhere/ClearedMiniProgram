'use strict';

const assert = require('assert');
const ProgressSync = require('../src/services/progress-sync-service.js');
const { setup, revisions, envelope, core } = require('./helpers/cloud-stage4-services.js');

function completePlayer(value) {
  value.player.completedDomains = ['progress', 'daily', 'economy', 'entitlements', 'stamina', 'preferences'];
  value.player.deferredDomains = [];
  return value;
}

module.exports = async function run() {
  const f = setup(); const sent = []; let syncIndex = 0;
  const transport = { config: { readEnabled: true, writeEnabled: true, staminaEnabled: true, preferencesEnabled: true } };
  const api = { transport, isConfigured: () => true, request: async request => {
    if (request.action === 'state.read') {
      return { ok: true, data: envelope(request.requestId, {
        changedDomains: core(0), hasCloudState: true, readOnlyPhase: false,
        completedDomains: ['progress', 'daily', 'economy', 'entitlements'],
        deferredDomains: ['stamina', 'preferences'], migrationImportId: 'import_one',
        migrationReceiptId: 'migration_one', receiptId: 'stage5_read', acceptedOperationIds: []
      }, { progress: 1, daily: 1, economy: 1, entitlements: 1 }) };
    }
    const operations = request.payload.operations; sent.push(operations);
    assert.deepStrictEqual(operations.map(item => item.type), ['STAMINA_BOOTSTRAP', 'PREFERENCES_BOOTSTRAP']);
    const data = { receiptId: 'stage5_bootstrap',
      results: operations.map(item => ({ operationId: item.operationId, status: 'ACKED', code: 'OK' })),
      acceptedOperationIds: operations.map(item => item.operationId),
      revisions: revisions({ progress: 1, daily: 1, economy: 1, entitlements: 1, stamina: 1, preferences: 1 }),
      domains: {
        stamina: { schemaVersion: 1, balance: 5, nextRecoveryAt: null, unlockedLevels: [], refundedLevels: [] },
        preferences: { schemaVersion: 1, skinId: 'classic', clearEffectId: 'none', soundEnabled: true }
      }, changedDomains: ['stamina', 'preferences'], notificationHints: [] };
    return { ok: true, data: completePlayer(envelope(request.requestId, data, data.revisions)) };
  } };
  const service = new ProgressSync(api, f.progress, f.store, f.auth, {}, null,
    { daily: f.daily, rewards: f.rewards, stamina: f.stamina, preferences: f.preferences,
      sessions: f.sessions, applier: f.applier });
  service.accountGuard = f.guard;
  const bootstrapped = await service.bootstrapCloud(f.auth.current());
  assert(bootstrapped.ok, JSON.stringify(bootstrapped)); assert.strictEqual(sent.length, 1);
  assert.strictEqual(f.store.authorityMode('stamina'), 'cloud-authoritative');
  assert.strictEqual(f.store.authorityMode('preferences'), 'cloud-authoritative');
  assert.strictEqual(f.stamina.authorityMode(), 'cloud-authoritative');
  assert.strictEqual(f.store.currentScope().pendingOperations.length, 0);

  service.flush = () => Promise.resolve({ ok: true });
  const unlocked = service.unlockOrdinaryLevel('0:0', 1000);
  assert(unlocked.ok); assert.strictEqual(unlocked.spent, 1); assert.strictEqual(f.stamina.snapshot(1000).balance, 4);
  assert.strictEqual(f.store.currentScope().pendingOperations[0].type, 'STAMINA_LEVEL_UNLOCKED');
  assert(f.progress.setSetting('soundEnabled', false));
  assert(service.enqueuePreference('soundEnabled', false));
  assert.deepStrictEqual(f.store.currentScope().pendingOperations.map(item => item.domain), ['stamina', 'preferences']);

  const queued = f.store.currentScope().pendingOperations; api.request = async request => {
    syncIndex++;
    const data = { receiptId: `stage5_mutation_${syncIndex}`,
      results: request.payload.operations.map(item => ({ operationId: item.operationId, status: 'ACKED', code: 'OK' })),
      acceptedOperationIds: request.payload.operations.map(item => item.operationId),
      revisions: revisions({ progress: 1, daily: 1, economy: 1, entitlements: 1, stamina: 2, preferences: 2 }),
      domains: {
        stamina: { schemaVersion: 1, balance: 4, nextRecoveryAt: 301000, unlockedLevels: ['0:0'], refundedLevels: [] },
        preferences: { schemaVersion: 1, skinId: 'classic', clearEffectId: 'none', soundEnabled: false }
      }, changedDomains: ['stamina', 'preferences'], notificationHints: [] };
    return { ok: true, data: completePlayer(envelope(request.requestId, data, data.revisions)) };
  };
  const applied = await service.pushCloud(f.auth.current(), f.store.context(), f.guard.capture());
  assert(applied.ok); assert.strictEqual(f.store.currentScope().pendingOperations.length, 0);
  assert.strictEqual(f.progress.getSetting('soundEnabled'), false);
  assert.deepStrictEqual(queued.map(item => item.type), ['STAMINA_LEVEL_UNLOCKED', 'PREFERENCE_FIELD_SET']);

  service.unlockOrdinaryLevel('0:1', 2000);
  const rejected = f.store.currentScope().pendingOperations[0];
  api.request = async request => {
    const data = { receiptId: 'stage5_conflict', results: [{ operationId: rejected.operationId,
      status: 'REJECTED', code: 'STAMINA_INSUFFICIENT' }], acceptedOperationIds: [],
    revisions: revisions({ progress: 1, daily: 1, economy: 1, entitlements: 1, stamina: 2, preferences: 2 }),
    domains: { stamina: { schemaVersion: 1, balance: 0, nextRecoveryAt: 302000,
      unlockedLevels: ['0:0'], refundedLevels: [] } }, changedDomains: ['stamina'], notificationHints: [] };
    return { ok: true, data: completePlayer(envelope(request.requestId, data, data.revisions)) };
  };
  assert((await service.pushCloud(f.auth.current(), f.store.context(), f.guard.capture())).ok);
  assert.strictEqual(f.stamina.snapshot(2000).balance, 0, 'server state wins a rare offline stamina conflict');
  assert.strictEqual(f.store.currentScope().pendingOperations.length, 0);
};
