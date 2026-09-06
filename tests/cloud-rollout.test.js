'use strict';

const assert = require('assert');
const ApiClient = require('../src/services/api-client.js');
const SyncStore = require('../src/services/sync-store.js');
const { fixture, envelope, clone } = require('./helpers/cloud-readonly-fixture.js');

// A protocol fixture, not a second implementation of server admission. The
// server's bucket/enforcement and blank migration are integration-tested there.
function server(f) {
  const state = { allowed: true, finalized: false, full: false, source: null,
    completed: [], prepares: 0, pushes: 0, denyPrepare: false, failBootstrap: false, failChunk: false };
  const core = SyncStore.CORE_DOMAINS.slice(); const deferred = ['stamina', 'preferences'];
  const revisions = () => Object.fromEntries(SyncStore.DOMAINS.map(key => [key,
    core.includes(key) ? Number(state.finalized) : Number(state.full)]));
  const importId = 'import_' + f.sync.state.migrationId;
  const projection = value => {
    value.revisions = revisions();
    if (state.finalized) Object.assign(value.player, { migrationState: 'complete', hasCloudState: true,
      completedDomains: state.full ? SyncStore.DOMAINS.slice() : core.slice(), deferredDomains: state.full ? [] : deferred.slice(),
      migrationImportId: importId, migrationReceiptId: 'migration_first' });
    return value;
  };
  const domains = () => {
    const result = Object.fromEntries(core.map(key => [key, Object.assign({ schemaVersion: 1 }, clone(state.source[key]))]));
    Object.assign(result.entitlements.ownedRewards, { 'theme:classic': true, 'effect:none': true });
    return result;
  };
  f.reply = request => {
    const value = envelope(request);
    if (request.action === 'state.read') {
      assert.strictEqual(request.payload.includeMutationAccess, true);
      value.data.mutationAllowed = state.allowed;
      if (state.finalized) Object.assign(value.data, { changedDomains: domains(), hasCloudState: true,
        completedDomains: state.full ? SyncStore.DOMAINS.slice() : core.slice(), deferredDomains: state.full ? [] : deferred.slice(),
        migrationImportId: importId, migrationReceiptId: 'migration_first',
        receiptId: 'read_' + f.calls.length, acceptedOperationIds: [] });
      if (state.full) Object.assign(value.data.changedDomains, clone(state.stage5));
    } else if (request.action === 'migration.prepare') {
      state.prepares++;
      if (state.denyPrepare) return Object.assign(value, { ok: false, code: 'PLAYER_NOT_ALLOWLISTED' });
      const built = f.app.prepareLegacyMigration(); assert(built.ok, JSON.stringify(built));
      state.source = clone(built.snapshot);
      state.required = Object.keys(f.app.progressSync.migrationChunks(built.snapshot));
      value.player.migrationState = 'prepared';
      value.data = { role: 'PRIMARY', status: 'PREPARED', requiredChunks: state.required.slice(),
        completedChunks: [], acceptedDomains: core.slice(), deferredDomains: deferred.slice(),
        economyBaselineExists: false, conflicts: [], prepareReceiptId: 'prepare_first', receiptId: null };
    } else if (request.action === 'migration.commitChunk') {
      if (state.failChunk) return Object.assign(value, { ok: false, code: 'STORE_TEMPORARY', retryable: true });
      state.completed.push(request.payload.chunkId); value.player.migrationState = 'prepared';
      value.data = { chunkId: request.payload.chunkId, serverHash: 'a'.repeat(64),
        chunkReceiptId: 'chunk_' + state.completed.length, completedChunks: state.completed.slice(), conflicts: [] };
    } else if (request.action === 'migration.finalize') {
      state.finalized = true;
      value.data = { receiptId: 'finalize_first', migrationReceiptId: 'migration_first', role: 'PRIMARY',
        completedDomains: core.slice(), deferredDomains: deferred.slice(), conflicts: [], revisions: revisions(),
        domains: domains(), acceptedOperationIds: [] };
    } else if (request.action === 'sync.push') {
      state.pushes++;
      if (state.failBootstrap) return Object.assign(value, { ok: false, code: 'STORE_TEMPORARY', retryable: true });
      const ops = request.payload.operations;
      assert.deepStrictEqual(ops.map(item => item.type), ['STAMINA_BOOTSTRAP', 'PREFERENCES_BOOTSTRAP']);
      state.full = true;
      state.stage5 = Object.fromEntries(ops.map(item => [item.domain, clone(item.payload.snapshot)]));
      const ids = ops.map(item => item.operationId);
      value.data = { receiptId: 'bootstrap_first', results: ids.map(operationId => ({ operationId, status: 'ACKED', code: 'OK' })),
        acceptedOperationIds: ids, revisions: revisions(), domains: clone(state.stage5),
        changedDomains: deferred.slice(), notificationHints: [] };
    } else assert.strictEqual(request.action, 'identity.init');
    return projection(value);
  };
  const reply = f.reply;
  f.reply = request => { try { return reply(request); } catch (error) { state.failure = error.stack; throw error; } };
  return state;
}

module.exports = async function run() {
  for (const scenario of ['blank', 'not-admitted', 'prepare-denied', 'bootstrap-retry', 'cloud-paused',
    'legacy-production', 'migration-paused', 'remote-not-admitted']) {
    const production = scenario === 'legacy-production';
    const f = fixture({ config: {
      migrationEnabled: true, writeEnabled: true, economyEnabled: true,
      staminaEnabled: true, preferencesEnabled: true } });
    const remote = server(f);
    try {
      if (production) {
        // Switch only this in-memory transport and mocked platform lane; the
        // checked-in release config must remain closed throughout the test.
        Object.assign(f.app.progressSync.api.transport.config, { productionOnly: true, testOnly: false });
        f.native.getAccountInfoSync = () => ({ miniProgram: { envVersion: 'release' } });
        const reply = f.reply;
        f.reply = request => { const value = reply(request); if (value.data) delete value.data.mutationAllowed; return value; };
      }
      if (scenario === 'not-admitted') remote.allowed = false;
      if (scenario === 'prepare-denied') remote.denyPrepare = true;
      if (scenario === 'bootstrap-retry') remote.failBootstrap = true;
      if (scenario === 'migration-paused') remote.failChunk = true;
      if (scenario === 'remote-not-admitted') {
        remote.source = clone(f.app.prepareLegacyMigration().snapshot);
        remote.finalized = true; remote.allowed = false;
      }
      let result = await f.app.resumeOnline();
      if (production || scenario === 'remote-not-admitted') {
        assert.strictEqual(result.status, 'local-only', JSON.stringify(result));
        assert.strictEqual(f.sync.state.localOwnerId, null);
        assert(f.calls.every(call => ['identity.init', 'state.read'].includes(call.data.action)));
        assert(f.sync.allowsLocalGameplay());
        continue;
      }
      if (scenario === 'migration-paused') {
        assert.strictEqual(result.reason, 'STORE_TEMPORARY');
        const migration = clone(f.sync.currentScope().migration);
        const snapshot = f.sync.migrationSnapshot(migration.importId, migration.snapshotHash);
        assert(snapshot); remote.allowed = false;
        const count = f.calls.length;
        assert.strictEqual((await f.app.resumeOnline()).status, 'cloud-paused');
        assert.strictEqual(f.sync.authorityMode('economy'), 'migration-freeze');
        assert.deepStrictEqual(f.sync.currentScope().migration, migration);
        assert.deepStrictEqual(f.sync.migrationSnapshot(migration.importId, migration.snapshotHash), snapshot);
        assert(f.calls.slice(count).every(call => ['identity.init', 'state.read'].includes(call.data.action)));
        continue;
      }
      if (['not-admitted', 'prepare-denied'].includes(scenario)) {
        assert.strictEqual(f.sync.authorityMode('progress'), 'legacy-local');
        assert.strictEqual(f.sync.state.localOwnerId, null); assert.strictEqual(f.sync.currentScope().migration, null);
        assert(f.sync.allowsLocalGameplay()); assert(f.app.progress.recordCompletion(0, 0, 900));
        assert(f.app.recoverRewardUnlocks().ok); // A real local reward stays locally usable.
        const balance = f.app.rewardUnlocks.view().balance; assert(balance > 0);
        if (scenario === 'not-admitted') {
          assert.strictEqual(result.status, 'local-only');
          assert(f.calls.every(call => ['identity.init', 'state.read'].includes(call.data.action)));
          assert.match(f.app.cloudAccountMessage(result), /继续本地游玩/);
        } else assert.strictEqual(result.reason, 'PLAYER_NOT_ALLOWLISTED');
        remote.allowed = true; remote.denyPrepare = false;
        result = await f.app.resumeOnline();
        assert.strictEqual(f.app.rewardUnlocks.view().balance, balance, 'admission must not duplicate the local opening balance');
        assert(f.app.progress.isCompleted(0, 0));
      }
      if (scenario === 'bootstrap-retry') {
        assert.strictEqual(result.reason, 'STORE_TEMPORARY');
        assert.strictEqual(f.sync.authorityMode('progress'), 'cloud-authoritative');
        const pending = clone(f.sync.currentScope().pendingOperations);
        assert.strictEqual(pending.length, 2);
        remote.allowed = false;
        assert.strictEqual((await f.app.resumeOnline()).status, 'cloud-paused');
        assert.deepStrictEqual(f.sync.currentScope().pendingOperations, pending);
        remote.allowed = true; remote.failBootstrap = false;
        result = await f.app.resumeOnline();
        assert.strictEqual(remote.prepares, 1);
        const requests = f.calls.filter(call => call.data.action === 'sync.push');
        assert.deepStrictEqual(requests[0].data.payload.operations, requests[1].data.payload.operations);
      }
      assert(result.ok, scenario + ': ' + (remote.failure || JSON.stringify({ result,
        actions: f.calls.map(call => call.data.action), stamina: f.app.stamina.exportAuthoritativeSnapshot(),
        preferences: f.app.preferences.exportAuthoritativeSnapshot(), source: remote.source })));
      assert.strictEqual(result.status, 'cloud-synced');
      assert.strictEqual(f.sync.currentScope().pendingOperations.length, 0);
      for (const domain of SyncStore.DOMAINS) assert.strictEqual(f.sync.authorityMode(domain), 'cloud-authoritative');
      assert.strictEqual(remote.completed.filter(key => key === 'economy:opening-balance').length, 1);
      assert(f.sync.migrationSnapshot('import_' + f.sync.state.migrationId, f.sync.currentScope().migration.snapshotHash));
      if (scenario === 'blank') {
        assert.strictEqual(f.app.rewardUnlocks.view().balance, 0);
        assert.deepStrictEqual(f.app.progress.exportCloudSnapshot().levels, {});
        assert.strictEqual(remote.prepares, 1); assert.strictEqual(remote.pushes, 1);
        assert.strictEqual(f.app.cloudAccountMessage(result), '云存档已同步');
      }
      if (scenario === 'cloud-paused') {
        const saved = clone(f.sync.state); const balance = f.app.rewardUnlocks.view().balance;
        remote.allowed = false; const callCount = f.calls.length;
        result = await f.app.resumeOnline();
        assert.strictEqual(result.status, 'cloud-paused');
        assert.strictEqual(f.sync.state.localOwnerId, saved.localOwnerId);
        assert.strictEqual(f.sync.authorityMode('economy'), 'cloud-authoritative');
        assert.strictEqual(f.app.rewardUnlocks.view().balance, balance);
        assert(f.calls.slice(callCount).every(call => ['identity.init', 'state.read'].includes(call.data.action)));
        f.app.scene = 'account'; assert.strictEqual(f.app.buildModel().accountStatus, 'pending');
      }
    } finally { f.app.dispose(); }
  }

  const request = { action: 'state.read', requestId: 'validate_optional' };
  const value = envelope(request);
  assert(ApiClient.validateStateEnvelope(value, 'test-fixture'), 'legacy server remains compatible');
  for (const allowed of [false, true]) {
    value.data.mutationAllowed = allowed; assert(ApiClient.validateStateEnvelope(value, 'test-fixture'));
  }
  for (const invalid of [null, 0, 1, 'true', {}]) {
    value.data.mutationAllowed = invalid; assert(!ApiClient.validateStateEnvelope(value, 'test-fixture'));
  }
};
