'use strict';

const assert = require('assert');
const ProgressSync = require('../src/services/progress-sync-service.js');
const SyncStore = require('../src/services/sync-store.js');
const { setup, revisions, envelope, core } = require('./helpers/cloud-stage4-services.js');
const { fixture, tick } = require('./helpers/cloud-readonly-fixture.js');

function client() {
  const f = setup(); const calls = []; let now = 1000000; let revision = 0;
  const domains = core(0);
  domains.stamina = { schemaVersion: 1, balance: 5, nextRecoveryAt: null, unlockedLevels: [], refundedLevels: [] };
  domains.preferences = { schemaVersion: 1, skinId: 'classic', clearEffectId: 'none', soundEnabled: true };
  const api = { transport: { config: { readEnabled: true, writeEnabled: true, staminaEnabled: true, preferencesEnabled: true } },
    isConfigured: () => true, request: async request => {
      calls.push(request);
      if (f.offline) return { ok: false, error: { code: 'network' } };
      const rev = () => revisions(Object.fromEntries(SyncStore.DOMAINS.map(key => [key, revision])));
      let data;
      if (request.action === 'state.read') {
        data = { changedDomains: domains, hasCloudState: true, readOnlyPhase: false, mutationAllowed: true,
          completedDomains: SyncStore.DOMAINS, deferredDomains: [], receiptId: `read_${calls.length}`,
          migrationImportId: 'import_one', migrationReceiptId: 'migration_one', acceptedOperationIds: [] };
      } else {
        assert.strictEqual(request.action, 'sync.push');
        const operations = request.payload.operations;
        operations.forEach(item => {
          if (item.type === 'MAIN_LEVEL_COMPLETED') {
            domains.progress.levels[item.payload.levelKey] = { completed: true, bestMs: item.payload.elapsedMs };
          } else if (item.type === 'PROGRESS_LAST_PLAYED') domains.progress.lastPlayed = item.payload;
          else if (item.type === 'PREFERENCE_FIELD_SET') domains.preferences[item.payload.field] = item.payload.value;
        });
        revision++;
        data = { receiptId: `push_${calls.length}`, revisions: rev(), domains, changedDomains: SyncStore.DOMAINS,
          results: operations.map(item => ({ operationId: item.operationId, status: f.retryable ? 'RETRYABLE' : 'ACKED',
            code: f.retryable ? 'STORE_TEMPORARY' : 'OK' })),
          acceptedOperationIds: f.retryable ? [] : operations.map(item => item.operationId), notificationHints: [] };
      }
      const value = envelope(request.requestId, data, rev());
      value.player.completedDomains = SyncStore.DOMAINS.slice(); value.player.deferredDomains = [];
      return { ok: true, data: JSON.parse(JSON.stringify(value)) };
    } };
  const service = new ProgressSync(api, f.progress, f.store, f.auth, {}, null,
    { daily: f.daily, rewards: f.rewards, stamina: f.stamina, preferences: f.preferences,
      sessions: f.sessions, applier: f.applier, now: () => now });
  service.accountGuard = f.guard;
  return Object.assign(f, { service, calls, advance: ms => { now += ms; } });
}

function complete(f, levelIndex) {
  f.progress.recordCompletion(1, levelIndex, 1000);
  assert(f.progress.save());
  assert(f.service.enqueueCompletion({ setIndex: 1, levelIndex, elapsedMs: 1000 }));
}

async function cadenceAndPersistence() {
  const f = client();
  const launched = await f.service.atCheckpoint('launch');
  assert(launched.ok, JSON.stringify(launched));
  assert.deepStrictEqual(f.calls.map(item => item.action), ['state.read']);
  f.calls.length = 0;
  f.advance(60000);
  for (let index = 0; index < 4; index++) {
    assert(f.service.enqueueLastPlayed({ setIndex: 1, levelIndex: index }));
    complete(f, index);
    await tick();
  }
  assert.strictEqual(f.calls.length, 0, 'individual level entry and completion do not contact the server');
  assert.strictEqual(f.service.state().status, 'cloud-pending');
  assert.strictEqual(new SyncStore(f.platform).state.pendingOperations.length, 5, 'changes survive a restart before a checkpoint');
  complete(f, 4); const fifth = await f.service.checkpointFlight;
  assert(fifth.ok, JSON.stringify(fifth));
  assert.deepStrictEqual(f.calls.map(item => item.action), ['state.read', 'sync.push']);
  assert.strictEqual(f.calls[1].payload.operations.length, 6, 'five clears and the latest resume position share one push');
  assert.strictEqual(f.store.state.pendingOperations.length, 0);
  assert(f.progress.isCompleted(1, 4));
  f.calls.length = 0;
  for (const reason of ['home', 'account', 'show', 'hide']) assert((await f.service.atCheckpoint(reason)).skipped);
  f.advance(300000);
  assert((await f.service.atCheckpoint('hide')).skipped, 'hiding without changes never causes a refresh');
  await f.service.atCheckpoint('show');
  assert.deepStrictEqual(f.calls.map(item => item.action), ['state.read'], 'stale foreground refresh needs no empty push');
  f.calls.length = 0;
  assert(f.service.enqueuePreference('soundEnabled', false));
  f.advance(180000);
  assert(f.service.enqueuePreference('soundEnabled', true));
  await f.service.checkpointFlight;
  assert.deepStrictEqual(f.calls.map(item => item.action), ['state.read', 'sync.push'], 'later gameplay writes check the three-minute age');
  assert.strictEqual(f.calls[1].payload.operations.length, 1);
}

async function retriesAndBatches() {
  const f = client(); await f.service.atCheckpoint('launch'); f.calls.length = 0;
  complete(f, 0); f.advance(60000); f.offline = true;
  assert.strictEqual((await f.service.atCheckpoint('home')).ok, false);
  const originalId = f.store.state.pendingOperations[0].operationId;
  assert((await f.service.atCheckpoint('account')).skipped);
  assert((await f.service.atCheckpoint('show')).skipped);
  assert.strictEqual(f.calls.length, 1, 'offline scene changes do not repeatedly retry');
  f.advance(60000); await f.service.atCheckpoint('home');
  f.advance(60000); assert((await f.service.atCheckpoint('home')).skipped, 'second failure backs off for two minutes');
  assert.strictEqual(f.store.state.pendingOperations[0].operationId, originalId);
  f.offline = false; await f.service.atCheckpoint('manual');
  assert.strictEqual(f.store.state.pendingOperations.length, 0, 'manual retry bypasses cooldown and reuses durable IDs');

  const b = client();
  for (let index = 0; index < 101; index++) assert(b.store.enqueueOperation({ domain: 'progress',
    type: 'MAIN_LEVEL_COMPLETED', occurredAtClient: index, payload: { levelKey: '0:0', elapsedMs: 1000 } }).ok);
  const outcome = await b.service.atCheckpoint('manual');
  assert(outcome.ok, JSON.stringify(outcome));
  assert.deepStrictEqual(b.calls.map(item => item.action), ['state.read', 'sync.push', 'sync.push', 'sync.push']);
  assert.deepStrictEqual(b.calls.slice(1).map(item => item.payload.operations.length), [50, 50, 1]);
  assert.strictEqual(b.store.state.pendingOperations.length, 0);

  const partial = client(); partial.retryable = true;
  for (let index = 0; index < 51; index++) assert(partial.store.enqueueOperation({ domain: 'progress',
    type: 'MAIN_LEVEL_COMPLETED', occurredAtClient: index, payload: { levelKey: '0:0', elapsedMs: 1000 } }).ok);
  await partial.service.atCheckpoint('manual');
  assert.deepStrictEqual(partial.calls.map(item => item.action), ['state.read', 'sync.push']);
  assert.strictEqual(partial.store.state.pendingOperations.length, 51, 'partial ACK never spins or loses the unsent tail');

  const shared = client(); let finish;
  const flight = shared.service.atCheckpoint('manual', () => new Promise(resolve => { finish = resolve; }));
  assert.strictEqual(shared.service.atCheckpoint('home'), flight, 'checkpoints share the identity/read/write flight');
  await tick();
  assert(shared.store.activateScope('player_B', 1, 'test-env', true).ok);
  finish({ ok: false, reason: 'account-mismatch' }); await flight;
  let newScopeCalls = 0;
  await shared.service.atCheckpoint('launch', async () => { newScopeCalls++; return { ok: true, status: 'cloud-readonly' }; });
  assert.strictEqual(newScopeCalls, 1, 'another account never inherits the old cooldown');
}

function coalescing() {
  const f = setup();
  const enqueue = (field, value) => f.store.enqueueOperation({ domain: 'preferences', type: 'PREFERENCE_FIELD_SET',
    occurredAtClient: 1000, payload: { field, value } });
  const one = enqueue('soundEnabled', false); assert(one.ok);
  assert(f.store.markOperationsInFlight([one.operationId], f.store.context()));
  const two = enqueue('soundEnabled', true); assert(two.ok);
  const three = enqueue('soundEnabled', false); assert(three.ok);
  assert.deepStrictEqual(f.store.state.pendingOperations.map(item => item.operationId), [one.operationId, three.operationId]);
  assert(enqueue('skinId', 'classic').ok, 'separate preference fields are not merged');
  f.store.clearOperationsInFlight([one.operationId]);
  assert(enqueue('soundEnabled', true).ok);
  assert.strictEqual(f.store.state.pendingOperations.length, 2);
  for (let index = 0; index < 198; index++) assert(f.store.enqueueOperation({ domain: 'progress',
    type: 'MAIN_LEVEL_COMPLETED', occurredAtClient: index, payload: { levelKey: '0:0', elapsedMs: 1000 } }).ok);
  assert(enqueue('soundEnabled', false).ok, 'replacing an unsent preference still works at the outbox limit');
  assert.strictEqual(f.store.state.pendingOperations.length, 200);
}

async function lifecycle() {
  const f = fixture(); let now = 1000000;
  f.app.progressSync.services.now = () => now;
  try {
    await f.app.resumeOnline(); await tick();
    assert.deepStrictEqual(f.calls.map(item => item.data.action), ['identity.init', 'state.read']);
    f.calls.length = 0;
    f.app.onHide(); f.app.onShow(); f.app.openAccount(); f.app.performAction('account:back'); await tick();
    assert.strictEqual(f.calls.length, 0, 'rapid foreground and account/home visits reuse a fresh cloud state');
    now += 300000;
    f.app.onShow(); await f.app.progressSync.checkpointFlight;
    assert.deepStrictEqual(f.calls.map(item => item.data.action), ['identity.init', 'state.read']);
    f.calls.length = 0;
    await f.app.resumeOnline();
    assert.deepStrictEqual(f.calls.map(item => item.data.action), ['identity.init', 'state.read'], 'explicit account retry remains immediate');
  } finally { f.app.dispose(); }
}

async function purchaseCheckpoint() {
  for (const scenario of ['pending', 'empty', 'offline', 'account-changed']) {
    const f = fixture();
    try {
      await f.app.resumeOnline(); await tick();
      const order = [];
      // Exercise the real App purchase orchestration without purchasing an
      // actual asset; the existing economy suite owns receipt/balance tests.
      f.app.authorityMode = () => 'cloud-authoritative';
      assert(f.app.openRewardDialog('theme:desserts'));
      if (scenario !== 'empty') assert(f.sync.enqueueOperation({ domain: 'progress', type: 'MAIN_LEVEL_COMPLETED',
        occurredAtClient: 1, payload: { levelKey: '0:0', elapsedMs: 1000 } }).ok);
      f.app.progressSync.flush = async () => {
        order.push('sync');
        if (scenario === 'account-changed') f.auth.clear('offline');
        if (scenario === 'offline') return { ok: false, reason: 'network' };
        f.sync.acknowledge(f.sync.currentScope().pendingOperations.map(item => item.operationId));
        return { ok: true };
      };
      f.app.economy.purchase = async () => {
        order.push('purchase'); return { ok: false, reason: 'insufficient-balance', newRewards: [] };
      };
      await f.app.requestRewardUnlock();
      assert.deepStrictEqual(order, scenario === 'pending' ? ['sync', 'purchase']
        : scenario === 'empty' ? ['purchase'] : ['sync'], scenario);
      if (scenario === 'offline') assert.strictEqual(f.sync.currentScope().pendingOperations.length, 1);
    } finally { f.app.dispose(); }
  }
}

module.exports = async function run() {
  await cadenceAndPersistence();
  await retriesAndBatches();
  coalescing();
  await lifecycle();
  await purchaseCheckpoint();
};
