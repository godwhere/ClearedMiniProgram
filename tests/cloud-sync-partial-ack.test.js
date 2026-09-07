'use strict';

const assert = require('assert');
const ProgressSync = require('../src/services/progress-sync-service.js');
const SyncStore = require('../src/services/sync-store.js');
const App = require('../src/app.js');
const { setup, revisions, envelope, core } = require('./helpers/cloud-stage4-services.js');

module.exports = async function run() {
  const queued = setup();
  const queuedService = new ProgressSync({ transport: { config: { writeEnabled: false } }, isConfigured: () => true },
    queued.progress, queued.store, queued.auth, {}, null,
    { daily: queued.daily, rewards: queued.rewards, stamina: queued.stamina,
      sessions: queued.sessions, applier: queued.applier });
  queuedService.accountGuard = queued.guard;
  queuedService.flush = () => Promise.resolve({ ok: true });
  assert(queuedService.enqueueLastPlayed({ setIndex: 0, levelIndex: 1, occurredAtClient: 123 }));
  assert.deepStrictEqual(queued.store.currentScope().pendingOperations.map(item => ({
    type: item.type, occurredAtClient: item.occurredAtClient, payload: item.payload
  })), [{ type: 'PROGRESS_LAST_PLAYED', occurredAtClient: 123, payload: { setIndex: 0, levelIndex: 1 } }]);
  assert.strictEqual(queuedService.enqueueLastPlayed({ setIndex: -1, levelIndex: 0 }), false);

  const f = setup(); const calls = []; let attempt = 0;
  const api = { transport: { config: { writeEnabled: true } }, isConfigured: () => true,
    request: async request => {
      calls.push(request); attempt++;
      const operations = request.payload.operations; const first = operations[0]; const second = operations[1] || operations[0];
      const levels = attempt === 1 ? { '0:0': { completed: true, bestMs: 1000 } }
        : { '0:0': { completed: true, bestMs: 1000 }, '0:1': { completed: true, bestMs: 900 } };
      const domains = core(attempt === 1 ? 100 : 200, levels);
      delete domains.daily;
      domains.economy.claimedOrdinary = attempt === 1 ? { '0:0': true } : { '0:0': true, '0:1': true };
      return { ok: true, data: envelope(request.requestId, { receiptId: `sync_${attempt}`,
        results: attempt === 1 ? [{ operationId: first.operationId, status: 'ACKED', code: 'OK' },
          { operationId: second.operationId, status: 'RETRYABLE', code: 'STORE_TEMPORARY' },
          { operationId: operations[2].operationId, status: 'REJECTED', code: 'VALIDATION_FAILED' }]
          : [{ operationId: first.operationId, status: 'ACKED', code: 'OK' }],
        acceptedOperationIds: [first.operationId], revisions: revisions({ progress: attempt, economy: attempt }),
        domains, changedDomains: ['progress', 'economy', 'entitlements'], notificationHints: [] },
      { progress: attempt, economy: attempt }) };
    } };
  const service = new ProgressSync(api, f.progress, f.store, f.auth, {}, null,
    { daily: f.daily, rewards: f.rewards, stamina: f.stamina, sessions: f.sessions, applier: f.applier });
  service.accountGuard = f.guard;
  const a = f.store.enqueueOperation({ domain: 'progress', type: 'MAIN_LEVEL_COMPLETED', occurredAtClient: 1,
    payload: { levelKey: '0:0', elapsedMs: 1000 } });
  const b = f.store.enqueueOperation({ domain: 'progress', type: 'MAIN_LEVEL_COMPLETED', occurredAtClient: 2,
    payload: { levelKey: '0:1', elapsedMs: 900 } });
  const c = f.store.enqueueOperation({ domain: 'progress', type: 'MAIN_LEVEL_COMPLETED', occurredAtClient: 3,
    payload: { levelKey: '0:2', elapsedMs: 800 } });
  assert(a.ok && b.ok && c.ok);
  const settled = [];
  [a, b, c].forEach(item => service.observeOperation(item.operationId, result => {
    settled.push({ operationId: result.operationId, status: result.status });
  }));
  const first = await service.pushCloud(f.auth.current(), f.store.context(), f.guard.capture());
  assert(first.ok); assert.strictEqual(f.store.currentScope().pendingOperations.length, 1);
  assert.strictEqual(f.store.currentScope().pendingOperations[0].operationId, b.operationId);
  assert.deepStrictEqual(f.store.currentScope().quarantinedOperations.map(item => ({ operationId: item.operationId, code: item.code })),
    [{ operationId: c.operationId, code: 'VALIDATION_FAILED' }]);
  assert(f.progress.isCompleted(0, 0)); assert(f.progress.isCompleted(0, 1), 'retryable local overlay remains visible');
  assert.strictEqual(f.progress.isCompleted(0, 2), false, 'rejected operation is removed from the optimistic overlay');
  assert.strictEqual(f.rewards.view().balance, 100);
  assert.deepStrictEqual(settled, [
    { operationId: a.operationId, status: 'ACKED' },
    { operationId: c.operationId, status: 'REJECTED' }
  ], 'terminal results settle their UI observers while retryable work stays attached');
  const second = await service.pushCloud(f.auth.current(), f.store.context(), f.guard.capture());
  assert(second.ok); assert.strictEqual(f.store.currentScope().pendingOperations.length, 0);
  assert.strictEqual(f.rewards.view().balance, 200); assert.strictEqual(calls.length, 2);
  assert.deepStrictEqual(settled, [
    { operationId: a.operationId, status: 'ACKED' },
    { operationId: c.operationId, status: 'REJECTED' },
    { operationId: b.operationId, status: 'ACKED' }
  ], 'a later retry settles the original observer exactly once');

  const g = setup();
  const injectedApi = { transport: { config: { writeEnabled: true } }, isConfigured: () => true,
    request: async request => {
      const sent = request.payload.operations[0]; const domains = core(100,
        { '0:0': { completed: true, bestMs: 1000 } });
      delete domains.daily; domains.economy.claimedOrdinary = { '0:0': true };
      return { ok: true, data: envelope(request.requestId, { receiptId: 'sync_injected',
        results: [{ operationId: sent.operationId, status: 'ACKED', code: 'OK' },
          { operationId: 'not_sent_by_client', status: 'RETRYABLE', code: 'STORE_TEMPORARY' }],
        acceptedOperationIds: [sent.operationId], revisions: revisions({ progress: 1, economy: 1 }),
        domains, changedDomains: ['progress', 'economy', 'entitlements'], notificationHints: [] },
      { progress: 1, economy: 1 }) };
    } };
  const strict = new ProgressSync(injectedApi, g.progress, g.store, g.auth, {}, null,
    { daily: g.daily, rewards: g.rewards, stamina: g.stamina, sessions: g.sessions, applier: g.applier });
  strict.accountGuard = g.guard;
  const pending = g.store.enqueueOperation({ domain: 'progress', type: 'MAIN_LEVEL_COMPLETED', occurredAtClient: 1,
    payload: { levelKey: '0:0', elapsedMs: 1000 } });
  assert(pending.ok);
  const rejectedEnvelope = await strict.pushCloud(g.auth.current(), g.store.context(), g.guard.capture());
  assert.strictEqual(rejectedEnvelope.reason, 'invalid-response');
  assert.strictEqual(g.store.currentScope().pendingOperations.length, 1);
  assert.strictEqual(g.store.currentScope().revisions.progress, 0);
  assert.strictEqual(g.progress.isCompleted(0, 0), false);

  const h = setup(); const dateKey = '2026-09-03'; const dayId = `daily-${dateKey}-v1`;
  const levelIds = [`${dayId}-intro-v1`, `${dayId}-extreme-v1`];
  assert(h.daily.recordEntry({ dateKey, dayId, entryLimit: 3, levelIds,
    idempotencyKey: 'local_rejected_entry' }).ok);
  const rejectedEntry = h.store.enqueueOperation({ domain: 'daily', type: 'DAILY_ENTRY_RECORDED',
    occurredAtClient: 10, payload: { dateKey, dayId, entryKey: 'local_rejected_entry', entryLimit: 3, levelIds } });
  assert(rejectedEntry.ok);
  const rejectionApi = { transport: { config: { writeEnabled: true } }, isConfigured: () => true,
    request: async request => ({ ok: true, data: envelope(request.requestId, {
      receiptId: 'sync_rejected_entry',
      results: [{ operationId: rejectedEntry.operationId, status: 'REJECTED', code: 'DAILY_ENTRY_LIMIT_REACHED' }],
      acceptedOperationIds: [], revisions: revisions(), domains: { daily: { schemaVersion: 1, days: {
        [dateKey]: { dayId, entryLimit: 3, entriesUsed: 3,
          entryKeys: ['server_entry_1', 'server_entry_2', 'server_entry_3'], levels: {}, completed: false }
      } } }, changedDomains: ['daily'], notificationHints: []
    }, {}) }) };
  const rejecting = new ProgressSync(rejectionApi, h.progress, h.store, h.auth, {}, null,
    { daily: h.daily, rewards: h.rewards, stamina: h.stamina, sessions: h.sessions, applier: h.applier });
  rejecting.accountGuard = h.guard;
  assert((await rejecting.pushCloud(h.auth.current(), h.store.context(), h.guard.capture())).ok);
  assert.deepStrictEqual(h.daily.state.entries[dateKey]._entryKeys,
    ['server_entry_1', 'server_entry_2', 'server_entry_3']);
  assert.strictEqual(h.store.currentScope().pendingOperations.length, 0);
  assert.deepStrictEqual(h.store.currentScope().quarantinedOperations.map(item => item.operationId),
    [rejectedEntry.operationId]);

  const share = setup(); let shareCalls = 0;
  const shareApi = { transport: { config: { writeEnabled: true } }, isConfigured: () => true,
    request: async request => {
      shareCalls++;
      const sent = request.payload.operations[0];
      assert.strictEqual(sent.domain, 'entitlements');
      assert.strictEqual(sent.type, 'CLIENT_POLICY_SHARE_GRANTED');
      assert.deepStrictEqual(sent.payload, { rewardId: 'theme:festival' });
      const nextRevisions = revisions({ entitlements: 1 });
      return { ok: true, data: envelope(request.requestId, {
        receiptId: 'sync_share_entitlement',
        results: [{ operationId: sent.operationId, status: 'ACKED', code: 'OK' }],
        acceptedOperationIds: [sent.operationId], revisions: nextRevisions,
        domains: {
          economy: { schemaVersion: 1, balance: 0, claimedOrdinary: {}, claimedDaily: {} },
          entitlements: { schemaVersion: 1, ownedRewards: {
            'theme:classic': true, 'effect:none': true, 'theme:festival': true
          } }
        },
        changedDomains: ['economy', 'entitlements'], notificationHints: ['theme:festival']
      }, { entitlements: 1 }) };
    } };
  const shareService = new ProgressSync(shareApi, share.progress, share.store, share.auth, {}, null,
    { daily: share.daily, rewards: share.rewards, stamina: share.stamina,
      sessions: share.sessions, applier: share.applier });
  shareService.accountGuard = share.guard;
  let shareFlight = null;
  shareService.flush = () => {
    if (!shareFlight) {
      shareFlight = shareService.pushCloud(share.auth.current(), share.store.context(), share.guard.capture())
        .finally(() => { shareFlight = null; });
    }
    return shareFlight;
  };
  const shareResult = await shareService.grantShareEntitlement('theme:festival');
  assert(shareResult.ok); assert.deepStrictEqual(shareResult.newRewards, ['theme:festival']);
  assert.strictEqual(share.rewards.view().balance, 0, 'share entitlement never changes currency');
  assert.strictEqual(share.rewards.owned('theme:festival'), true);
  assert.strictEqual(share.store.currentScope().pendingOperations.length, 0);
  assert.strictEqual(shareCalls, 1);

  const failedWrite = setup();
  const acknowledged = failedWrite.store.enqueueOperation({ domain: 'progress', type: 'MAIN_LEVEL_COMPLETED',
    occurredAtClient: 20, payload: { levelKey: '0:0', elapsedMs: 1000 } });
  assert(acknowledged.ok);
  const recoveryCalls = [];
  const failedWriteApi = { transport: { config: { readEnabled: true, writeEnabled: true } }, isConfigured: () => true,
    request: async request => {
      recoveryCalls.push(request.action);
      const domains = core(100, { '0:0': { completed: true, bestMs: 1000 } });
      delete domains.daily; domains.economy.claimedOrdinary = { '0:0': true };
      if (request.action === 'state.read') return { ok: true, data: envelope(request.requestId, {
        changedDomains: domains, hasCloudState: true, readOnlyPhase: false,
        completedDomains: SyncStore.CORE_DOMAINS.slice(), deferredDomains: ['stamina', 'preferences'],
        receiptId: 'read_after_recovery', migrationImportId: 'import_one', migrationReceiptId: 'migration_one',
        acceptedOperationIds: []
      }, { progress: 1, economy: 1 }) };
      const sent = request.payload.operations[0];
      return { ok: true, data: envelope(request.requestId, {
        receiptId: 'sync_finish_write_failed',
        results: [{ operationId: sent.operationId, status: 'ACKED', code: 'OK',
          details: { rewardGranted: true, rewardAmount: 100 } }],
        acceptedOperationIds: [sent.operationId], revisions: revisions({ progress: 1, economy: 1 }),
        domains, changedDomains: ['progress', 'economy', 'entitlements'], notificationHints: []
      }, { progress: 1, economy: 1 }) };
    } };
  const failedWriteService = new ProgressSync(failedWriteApi, failedWrite.progress, failedWrite.store,
    failedWrite.auth, {}, null, { daily: failedWrite.daily, rewards: failedWrite.rewards,
      stamina: failedWrite.stamina, sessions: failedWrite.sessions, applier: failedWrite.applier });
  failedWriteService.accountGuard = failedWrite.guard;
  const resultScreen = { currencyReward: { status: 'pending', amount: 0 } };
  const resultAccount = failedWrite.guard.capture(); let feedbackCount = 0; let redraws = 0;
  failedWriteService.observeOperation(acknowledged.operationId, result => {
    feedbackCount++;
    App.prototype.applyCloudCurrencyResult.call({ isCurrentAccount: token => failedWrite.guard.matches(token),
      invalidate() { redraws++; } }, resultScreen, resultAccount, result);
  });
  const write = failedWrite.platform.setStorage.bind(failedWrite.platform); let syncWrites = 0;
  failedWrite.platform.setStorage = (key, value) => {
    if (key === SyncStore.STORAGE_KEY && ++syncWrites === 2) return false;
    return write(key, value);
  };
  const notCommitted = await failedWriteService.pushCloud(failedWrite.auth.current(),
    failedWrite.store.context(), failedWrite.guard.capture());
  assert.strictEqual(notCommitted.reason, 'persist-failed');
  assert.strictEqual(failedWrite.store.currentScope().revisions.progress, 0,
    'a failed receipt write cannot advance the server revision');
  assert.deepStrictEqual(failedWrite.store.currentScope().pendingOperations.map(item => item.operationId),
    [acknowledged.operationId], 'a failed receipt write cannot delete an ACKed operation');
  assert(failedWrite.store.currentScope().pendingApplication,
    'the stable receipt remains available for crash recovery');
  assert.strictEqual(failedWrite.rewards.view().balance, 100, 'wallet can be saved before the receipt commit fails');
  assert.strictEqual(resultScreen.currencyReward.status, 'pending');
  assert.strictEqual(feedbackCount, 0, 'incomplete local application must not announce a settled reward');

  const finishApplication = failedWrite.store.finishApplication.bind(failedWrite.store);
  failedWrite.store.finishApplication = () => false;
  assert.strictEqual((await failedWriteService.bootstrapCloud(failedWrite.auth.current())).reason, 'persist-failed');
  assert.strictEqual(feedbackCount, 0, 'a recovery that still cannot persist must keep the observer pending');
  failedWrite.store.finishApplication = finishApplication;
  const recoveredReward = await failedWriteService.bootstrapCloud(failedWrite.auth.current());
  assert.strictEqual(recoveredReward.status, 'cloud-synced');
  assert.strictEqual(failedWrite.store.currentScope().pendingOperations.length, 0);
  assert.strictEqual(failedWrite.rewards.view().balance, 100, 'recovery must not grant the same coins twice');
  assert.deepStrictEqual(resultScreen.currencyReward, { status: 'granted', amount: 100 },
    'the recovered receipt must update the real result-screen feedback, not just the wallet');
  assert.strictEqual(feedbackCount, 1); assert.strictEqual(redraws, 1);
  assert.strictEqual(failedWriteService.operationObservers.size, 0);
  assert.deepStrictEqual(recoveryCalls, ['sync.push', 'state.read'], 'feedback recovery adds no network request or duplicate push');
  await failedWriteService.bootstrapCloud(failedWrite.auth.current());
  assert.strictEqual(feedbackCount, 1, 'later syncs cannot announce the recovered reward again');
  assert.strictEqual(failedWrite.rewards.view().balance, 100);

  const capped = setup(); let sentCount = 0;
  for (let index = 0; index < 51; index++) {
    assert(capped.store.enqueueOperation({ domain: 'progress', type: 'MAIN_LEVEL_COMPLETED',
      occurredAtClient: index, payload: { levelKey: '0:0', elapsedMs: index + 1 } }).ok);
  }
  const cappedApi = { transport: { config: { writeEnabled: true } }, isConfigured: () => true,
    request: async request => {
      sentCount = request.payload.operations.length;
      const results = request.payload.operations.map(item => ({ operationId: item.operationId,
        status: 'RETRYABLE', code: 'STORE_TEMPORARY' }));
      return { ok: true, data: envelope(request.requestId, {
        receiptId: 'sync_batch_cap', results, acceptedOperationIds: [], revisions: revisions(),
        domains: {}, changedDomains: [], notificationHints: []
      }, {}) };
    } };
  const cappedService = new ProgressSync(cappedApi, capped.progress, capped.store, capped.auth, {}, null,
    { daily: capped.daily, rewards: capped.rewards, stamina: capped.stamina,
      sessions: capped.sessions, applier: capped.applier });
  cappedService.accountGuard = capped.guard;
  const cappedResult = await cappedService.pushCloud(capped.auth.current(), capped.store.context(), capped.guard.capture());
  assert(cappedResult.ok); assert.strictEqual(sentCount, 50, 'one sync.push request never exceeds 50 operations');
  assert.strictEqual(capped.store.currentScope().pendingOperations.length, 51,
    'retryable results retain both the sent batch and the unsent tail');
};
