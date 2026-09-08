'use strict';

const assert = require('assert');
const ProgressSyncService = require('../src/services/progress-sync-service.js');
const ProgressStore = require('../src/services/progress-store.js');
const RewardUnlockService = require('../src/services/reward-unlock-service.js');
const SyncStore = require('../src/services/sync-store.js');
const CloudBackupTest = require('./cloud-backup-service.test.js');
const { core } = require('./helpers/cloud-stage4-services.js');
const { fixture: cloudFixture, envelope, clone, tick } = require('./helpers/cloud-readonly-fixture.js');
const { fakeApi } = require('./account-bootstrap.test.js');
const rewardConfig = require('../src/config/rewards.js');
const dailySolutions = require('../data/daily-solutions.js');

const CLOUD_CONFIG = {
  migrationEnabled: true,
  writeEnabled: true,
  economyEnabled: true,
  staminaEnabled: true,
  preferencesEnabled: true,
  localBackupEnabled: false,
  dailyTestDateKey: '2026-09-07'
};

function withControlledClock(run) {
  const realNow = Date.now;
  let now = Date.parse('2026-09-07T04:00:00.000Z');
  Date.now = () => now;
  return Promise.resolve().then(() => run({
    now: () => now,
    advance: milliseconds => { now += milliseconds; return now; }
  })).finally(() => { Date.now = realNow; });
}

function attachClock(f, clock) {
  f.app.dailyClock = () => new Date(clock.now());
  f.app.dailyService.clock = f.app.dailyClock;
  f.app.progressSync.services.now = clock.now;
}

function authoritativeReply(request) {
  const value = envelope(request);
  const domains = SyncStore.DOMAINS.slice();
  Object.assign(value.player, {
    migrationState: 'complete',
    hasCloudState: true,
    completedDomains: domains,
    deferredDomains: [],
    migrationImportId: 'import_existing',
    migrationReceiptId: 'migration_existing'
  });
  domains.forEach(domain => { value.revisions[domain] = 1; });
  value.bindingStatus = 'MATCHED';
  if (request.action === 'state.read') {
    const changedDomains = core(0);
    changedDomains.stamina = { schemaVersion: 1, balance: 5, nextRecoveryAt: null,
      unlockedLevels: [], refundedLevels: [] };
    changedDomains.preferences = { schemaVersion: 1, skinId: 'classic',
      clearEffectId: 'none', soundEnabled: true };
    value.data = {
      changedDomains,
      hasCloudState: true,
      readOnlyPhase: false,
      completedDomains: domains,
      deferredDomains: [],
      migrationImportId: 'import_existing',
      migrationReceiptId: 'migration_existing',
      receiptId: 'state_existing',
      acceptedOperationIds: [],
      mutationAllowed: true
    };
  }
  return value;
}

function offlineReply(request) {
  return Object.assign(envelope(request), {
    ok: false,
    code: 'STORE_TEMPORARY',
    retryable: true
  });
}

async function establishedCloudFixture(clock, native) {
  const f = cloudFixture({ native, config: CLOUD_CONFIG });
  try {
    attachClock(f, clock);
    f.reply = authoritativeReply;
    const result = await f.app.resumeOnline();
    await tick();
    assert.deepStrictEqual(result, { ok: true, status: 'cloud-synced', pending: 0 });
    assert.deepStrictEqual(f.calls.map(call => call.data.action), ['identity.init', 'state.read']);
    assert.deepStrictEqual(f.sync.authorityModes(), Object.fromEntries(
      SyncStore.DOMAINS.map(domain => [domain, 'cloud-authoritative'])
    ));
    assert.strictEqual(f.app.auth.current().hasCloudState, true);
    assert.deepStrictEqual(f.app.auth.current().completedDomains, SyncStore.DOMAINS);
    return f;
  } catch (error) {
    f.app.dispose();
    throw error;
  }
}

function accountSnapshot(f) {
  const scope = f.sync.context();
  const session = f.sessions.metadata();
  return {
    scope,
    localOwnerId: f.sync.state.localOwnerId,
    localEnvironmentId: f.sync.state.localEnvironmentId,
    session: {
      mode: session.mode,
      ownerId: session.ownerId,
      bindingEpoch: session.bindingEpoch,
      environmentId: session.environmentId,
      migrationState: session.migrationState,
      migrationImportId: session.migrationImportId,
      migrationReceiptId: session.migrationReceiptId
    }
  };
}

function rewardSnapshot(f) {
  return {
    balance: f.app.rewardUnlocks.view().balance,
    claimedOrdinary: clone(f.app.rewardUnlocks.state.claimedOrdinary),
    claimedDaily: clone(f.app.rewardUnlocks.state.claimedDaily),
    persisted: clone(f.native.storage[RewardUnlockService.STORAGE_KEY])
  };
}

function matchingOperations(f, type, match) {
  return f.sync.currentScope().pendingOperations.filter(operation =>
    operation.type === type && match(operation.payload)
  );
}

function completeTraining(app) {
  assert.strictEqual(app.openLevel(0, 0), true);
  const runner = app.runner;
  assert.strictEqual(runner.touchStart(0), true);
  [1, 2, 3, 4].forEach(cell => assert.strictEqual(runner.touchMove(cell), true));
  runner.touchEnd(4);
  app.onPathCompleted(0, [0, 1, 2, 3, 4]);
}

function solveDailyLevel(app, clock) {
  clock.advance(1000);
  app.tick(clock.now());
  const level = app.daily.challenge;
  const board = app.renderer.boardLayout;
  dailySolutions.ByChallengeId[app.daily.challengeId].forEach(path => {
    const point = index => ({
      x: board.x + (index % level.Width + 0.5) * board.cell,
      y: board.y + (Math.floor(index / level.Width) + 0.5) * board.cell,
      id: 11
    });
    app.onPointerStart(point(path[0]));
    path.slice(1).forEach(index => app.onPointerMove(point(index)));
    app.onPointerEnd(point(path[path.length - 1]));
  });
}

function routingFixture(options) {
  const opts = options || {};
  const session = { mode: 'cloud', ownerId: 'player_route', bindingEpoch: 1,
    environmentId: 'test-env', generation: 1, readPaused: false };
  const scope = { ownerId: session.ownerId, bindingEpoch: session.bindingEpoch,
    environmentId: session.environmentId, activationSequence: 1 };
  const routeState = {
    pendingApplication: opts.pendingApplication || null,
    pendingOperations: opts.pendingOperations ? opts.pendingOperations.slice() : [],
    progressAuthority: opts.progressAuthority || 'cloud-authoritative',
    pendingPurchase: opts.pendingPurchase === true,
    scopeMatches: opts.scopeMatches !== false
  };
  const calls = { cloud: 0, backup: 0 };
  let cloudRun = opts.cloudRun || (() => Promise.resolve({ ok: true, status: 'cloud-synced' }));
  let backupRun = opts.backupRun || (() => Promise.resolve({ ok: true, status: 'backup-pending' }));
  const store = {
    context: () => scope,
    matches: token => routeState.scopeMatches && token === scope,
    currentScope: () => routeState,
    authorityMode: domain => domain === 'progress' ? routeState.progressAuthority : 'cloud-authoritative'
  };
  const services = {
    economy: { hasPendingPurchase: () => routeState.pendingPurchase }
  };
  if (opts.injectBackup !== false) {
    services.backup = { bootstrap: current => {
      calls.backup++;
      return backupRun(current);
    } };
  }
  const api = { transport: { config: { readEnabled: true } }, isConfigured: () => opts.configured !== false };
  const auth = { mode: 'cloud', current: () => session };
  const service = new ProgressSyncService(api, null, store, auth,
    { localBackupEnabled: opts.backupEnabled === true }, null, services);
  service.runCloud = (current, currentScope, account) => {
    calls.cloud++;
    return cloudRun(current, currentScope, account);
  };
  return { service, session, scope, routeState, calls,
    setCloudRun: run => { cloudRun = run; }, setBackupRun: run => { backupRun = run; } };
}

async function configuredRoutesAndBlockers() {
  const disabled = routingFixture({ backupEnabled: false });
  assert.deepStrictEqual(await disabled.service.bootstrapCloud(disabled.session), { ok: true, status: 'cloud-synced' });
  assert.deepStrictEqual(disabled.calls, { cloud: 1, backup: 0 });

  const missing = routingFixture({ backupEnabled: true, injectBackup: false });
  assert.deepStrictEqual(await missing.service.bootstrapCloud(missing.session), { ok: true, status: 'cloud-synced' });
  assert.deepStrictEqual(missing.calls, { cloud: 1, backup: 0 });

  const available = routingFixture({ backupEnabled: true });
  assert.deepStrictEqual(await available.service.bootstrapCloud(available.session), { ok: true, status: 'backup-pending' });
  assert.deepStrictEqual(available.calls, { cloud: 0, backup: 1 });

  const blockers = [
    { pendingPurchase: true },
    { pendingApplication: { receiptId: 'receipt_pending' } },
    { pendingOperations: [{ operationId: 'operation_pending' }] },
    { progressAuthority: 'migration-freeze' }
  ];
  for (const blocker of blockers) {
    const blocked = routingFixture(Object.assign({ backupEnabled: true }, blocker));
    const before = JSON.parse(JSON.stringify(blocked.routeState));
    assert.deepStrictEqual(await blocked.service.bootstrapCloud(blocked.session), { ok: true, status: 'cloud-synced' });
    assert.deepStrictEqual(blocked.calls, { cloud: 1, backup: 0 });
    assert.deepStrictEqual(blocked.routeState, before, 'route selection never deletes a blocker');
  }

  const combined = routingFixture({ backupEnabled: true, pendingPurchase: true,
    pendingApplication: { receiptId: 'receipt_pending' },
    pendingOperations: [{ operationId: 'operation_pending' }], progressAuthority: 'migration-freeze' });
  await combined.service.bootstrapCloud(combined.session);
  assert.deepStrictEqual(combined.calls, { cloud: 1, backup: 0 });
  combined.routeState.pendingPurchase = false;
  combined.routeState.pendingApplication = null;
  combined.routeState.pendingOperations = [];
  combined.routeState.progressAuthority = 'cloud-authoritative';
  assert.deepStrictEqual(await combined.service.bootstrapCloud(combined.session), { ok: true, status: 'backup-pending' });
  assert.deepStrictEqual(combined.calls, { cloud: 1, backup: 1 },
    'the next bootstrap re-evaluates cleared blockers instead of caching a route');

  const incompatible = routingFixture({ backupEnabled: false, progressAuthority: 'local-backup',
    pendingPurchase: true, pendingApplication: { receiptId: 'receipt_pending' },
    pendingOperations: [{ operationId: 'operation_pending' }] });
  const incompatibleBefore = JSON.parse(JSON.stringify(incompatible.routeState));
  assert.deepStrictEqual(await incompatible.service.bootstrapCloud(incompatible.session),
    { ok: false, reason: 'not-configured' });
  assert.deepStrictEqual(incompatible.calls, { cloud: 0, backup: 0 },
    'an incompatible persisted authority fails closed before every legacy blocker');
  assert.strictEqual(incompatible.service.status, 'error');
  assert.deepStrictEqual(incompatible.routeState, incompatibleBefore, 'failure closing never clears old tasks');
}

async function entryGuardsAndFlights() {
  const unconfigured = routingFixture({ backupEnabled: true, configured: false });
  assert.deepStrictEqual(await unconfigured.service.bootstrapCloud(unconfigured.session),
    { ok: false, reason: 'not-configured' });
  assert.deepStrictEqual(unconfigured.calls, { cloud: 0, backup: 0 });

  const stale = routingFixture({ backupEnabled: true, scopeMatches: false });
  assert.deepStrictEqual(await stale.service.bootstrapCloud(stale.session),
    { ok: false, reason: 'account-mismatch' });
  assert.deepStrictEqual(stale.calls, { cloud: 0, backup: 0 });

  let finishCloud;
  const shared = routingFixture({ backupEnabled: false,
    cloudRun: () => new Promise(resolve => { finishCloud = resolve; }) });
  const first = shared.service.bootstrapCloud(shared.session);
  assert.strictEqual(shared.service.bootstrapCloud(shared.session), first,
    'concurrent bootstraps reuse the same cloud promise');
  assert.deepStrictEqual(shared.calls, { cloud: 1, backup: 0 });
  finishCloud({ ok: true, status: 'cloud-synced' });
  await first;
  shared.setCloudRun(() => Promise.resolve({ ok: true, status: 'cloud-synced' }));
  await shared.service.bootstrapCloud(shared.session);
  assert.deepStrictEqual(shared.calls, { cloud: 2, backup: 0 }, 'success clears the in-flight task');

  const retry = routingFixture({ backupEnabled: true,
    backupRun: () => Promise.reject(new Error('temporary backup failure')) });
  await assert.rejects(retry.service.bootstrapCloud(retry.session), /temporary backup failure/);
  retry.setBackupRun(() => Promise.resolve({ ok: true, status: 'backup-pending' }));
  assert.deepStrictEqual(await retry.service.bootstrapCloud(retry.session), { ok: true, status: 'backup-pending' });
  assert.deepStrictEqual(retry.calls, { cloud: 0, backup: 2 }, 'failure also clears the in-flight task');
}

async function incompatibleArchiveScenario(options) {
  const opts = options || {};
  const local = CloudBackupTest.setup();
  assert((await local.service.bootstrap(local.session)).ok);
  assert(local.progress.recordCompletion(0, 0, 1000));
  assert(local.progress.save());
  const granted = local.rewards.reconcile({ ordinary: local.progress.exportRewardCompletions(),
    daily: local.daily.exportRewardCompletions() });
  assert.strictEqual(granted.amountDelta, 100);

  const snapshot = () => {
    const store = new SyncStore(local.host);
    const progress = new ProgressStore(local.host);
    const rewards = new RewardUnlockService(local.host, rewardConfig);
    const pending = store.currentScope().pendingApplication;
    return { authority: store.authorityMode('progress'), authorities: store.authorityModes(),
      pendingApplication: pending && pending.receiptId || null,
      progress: progress.exportCloudSnapshot(), balance: rewards.view().balance };
  };
  const before = snapshot(); const requests = [];
  const remote = core(0);
  remote.stamina = { schemaVersion: 1, balance: 5, nextRecoveryAt: null,
    unlockedLevels: [], refundedLevels: [] };
  remote.preferences = { schemaVersion: 1, skinId: 'classic', clearEffectId: 'none', soundEnabled: true };
  const revisions = Object.fromEntries(SyncStore.DOMAINS.map(domain => [domain, 1]));
  const api = {
    transport: { config: { readEnabled: true, writeEnabled: true, migrationEnabled: true,
      staminaEnabled: false, preferencesEnabled: false } },
    isConfigured: () => true,
    request: async request => {
      requests.push(request.action);
      const response = local.envelope(request.requestId, {
        changedDomains: remote, hasCloudState: true, readOnlyPhase: false,
        completedDomains: SyncStore.DOMAINS.slice(), deferredDomains: [],
        receiptId: 'receipt_remote', migrationImportId: 'import_remote',
        migrationReceiptId: 'migration_remote', acceptedOperationIds: [], mutationAllowed: true
      });
      response.revisions = revisions;
      response.player = { playerId: local.session.ownerId, bindingEpoch: 1, migrationState: 'complete',
        hasCloudState: true, completedDomains: SyncStore.DOMAINS.slice(),
        deferredDomains: [], migrationImportId: 'import_remote',
        migrationReceiptId: 'migration_remote' };
      return { ok: true, data: response };
    }
  };
  const services = { daily: local.daily, rewards: local.rewards, stamina: local.stamina,
    preferences: local.preferences, applier: local.applier };
  let backupCalls = 0;
  if (opts.injectBackup) services.backup = { bootstrap: session => {
    backupCalls++;
    return local.service.bootstrap(session);
  } };
  const sync = new ProgressSyncService(api, local.progress, local.store,
    { mode: 'cloud', current: () => local.session },
    { localBackupEnabled: opts.backupEnabled === true }, null, services);
  sync.accountGuard = local.guard;
  const result = await sync.bootstrapCloud(local.session);
  const after = snapshot();
  return { scenario: opts.scenario, requests, backupCalls, result,
    serviceState: sync.state(), before, after };
}

async function localBackupArchiveCannotFallThroughToCloud() {
  const evidence = [];
  evidence.push(await incompatibleArchiveScenario({
    scenario: 'flag-disabled', backupEnabled: false, injectBackup: true
  }));
  evidence.push(await incompatibleArchiveScenario({
    scenario: 'service-missing', backupEnabled: true, injectBackup: false
  }));
  evidence.push(await incompatibleArchiveScenario({
    scenario: 'flag-disabled-and-service-missing', backupEnabled: false, injectBackup: false
  }));
  const violations = evidence.filter(item => item.requests.length > 0 || item.backupCalls > 0 ||
    item.result.ok !== false || item.result.reason !== 'not-configured' ||
    item.serviceState.status !== 'error' || JSON.stringify(item.after) !== JSON.stringify(item.before));
  assert.deepStrictEqual(violations, [],
    `persisted local-backup archives must fail closed without either required capability: ${JSON.stringify(evidence)}`);
}

async function cloudAuthoritativeOfflineCompletionSurvivesRestart() {
  await withControlledClock(async clock => {
    let first = null;
    let restarted = null;
    try {
      first = await establishedCloudFixture(clock);
      const accountBefore = accountSnapshot(first);
      const progressBefore = clone(first.native.storage[ProgressStore.STORAGE_KEY]);
      const rewardsBefore = rewardSnapshot(first);
      assert.strictEqual(first.app.progress.isCompleted(0, 0), false,
        'the ordinary first-clear reward must be unclaimed before the offline completion');
      assert.strictEqual(rewardsBefore.claimedOrdinary['0:0'], undefined);
      assert.deepStrictEqual(matchingOperations(first, 'MAIN_LEVEL_COMPLETED',
        payload => payload.levelKey === '0:0'), [], 'the completion is not already pending');

      first.calls.length = 0;
      first.reply = offlineReply;
      clock.advance(1000);
      completeTraining(first.app);
      await tick();

      const storedProgress = first.native.storage[ProgressStore.STORAGE_KEY];
      assert.strictEqual(progressBefore.completed['0:0'], undefined);
      assert.strictEqual(storedProgress.completed['0:0'], true,
        'ordinary progress is durably saved before cloud settlement');
      assert.strictEqual(Number.isFinite(storedProgress.bestMs['0:0']), true);
      assert.deepStrictEqual(storedProgress.lastPlayed, { setIndex: 0, levelIndex: 0 });
      assert.strictEqual(storedProgress.stats.totalClears, progressBefore.stats.totalClears + 1);
      assert.deepStrictEqual(first.app.result.currencyReward, { status: 'pending', amount: 0 });
      assert.deepStrictEqual(rewardSnapshot(first), rewardsBefore,
        'offline completion must not change the cloud-authoritative balance or claim markers');
      assert.deepStrictEqual(accountSnapshot(first), accountBefore);
      assert.deepStrictEqual(first.sync.authorityModes(), Object.fromEntries(
        SyncStore.DOMAINS.map(domain => [domain, 'cloud-authoritative'])
      ));
      const completion = matchingOperations(first, 'MAIN_LEVEL_COMPLETED',
        payload => payload.levelKey === '0:0');
      assert.strictEqual(completion.length, 1, 'one durable completion operation is queued');
      const completionBeforeRestart = clone(completion[0]);
      assert.strictEqual(completionBeforeRestart.ownerIdAtCreation, accountBefore.scope.ownerId);
      assert.strictEqual(completionBeforeRestart.bindingEpochAtCreation, accountBefore.scope.bindingEpoch);
      assert.strictEqual(completionBeforeRestart.environmentIdAtCreation, accountBefore.scope.environmentId);
      assert.strictEqual(first.calls.some(call =>
        ['backup.read', 'backup.commit'].includes(call.data.action)), false);
      assert.deepStrictEqual(first.app.buildModel().currency, {
        available: true, balance: 0, pendingRewardAmount: 100, displayBalance: 100, error: null
      }, 'a durably queued ordinary first clear is shown immediately without changing the confirmed wallet');

      const savedStorage = clone(first.native.storage);
      const firstApp = first.app;
      const firstServices = { progress: first.app.progress, rewards: first.app.rewardUnlocks,
        sync: first.app.syncStore, progressSync: first.app.progressSync };
      first.app.dispose();
      first = null;

      const restartedNative = fakeApi();
      Object.assign(restartedNative.storage, savedStorage);
      clock.advance(1000);
      restarted = cloudFixture({ native: restartedNative, config: CLOUD_CONFIG });
      attachClock(restarted, clock);
      restarted.reply = offlineReply;
      await tick();

      assert.notStrictEqual(restarted.app, firstApp);
      assert.notStrictEqual(restarted.app.progress, firstServices.progress);
      assert.notStrictEqual(restarted.app.rewardUnlocks, firstServices.rewards);
      assert.notStrictEqual(restarted.app.syncStore, firstServices.sync);
      assert.notStrictEqual(restarted.app.progressSync, firstServices.progressSync);
      assert.strictEqual(restarted.app.auth.current(), null,
        'the restarted process cannot reuse the old in-memory cloud session while offline');
      assert.deepStrictEqual(accountSnapshot(restarted), accountBefore,
        'persisted account, environment and binding ownership survive restart');
      assert.deepStrictEqual(restarted.sync.authorityModes(), Object.fromEntries(
        SyncStore.DOMAINS.map(domain => [domain, 'cloud-authoritative'])
      ));
      assert.strictEqual(restarted.app.progress.isCompleted(0, 0), true);
      assert.deepStrictEqual(restarted.native.storage[ProgressStore.STORAGE_KEY], storedProgress);
      const completionAfterRestart = matchingOperations(restarted, 'MAIN_LEVEL_COMPLETED',
        payload => payload.levelKey === '0:0');
      assert.deepStrictEqual(completionAfterRestart, [completionBeforeRestart],
        'restart preserves the exact pending operation instead of creating an equivalent duplicate');
      assert.deepStrictEqual(rewardSnapshot(restarted), rewardsBefore);
      assert.deepStrictEqual(restarted.app.buildModel().currency, {
        available: true, balance: 0, pendingRewardAmount: 100, displayBalance: 100, error: null
      }, 'offline restart rebuilds the display total from the same persisted operation');

      const retry = await restarted.app.resumeOnline();
      assert.strictEqual(retry.reason, 'STORE_TEMPORARY');
      assert.deepStrictEqual(matchingOperations(restarted, 'MAIN_LEVEL_COMPLETED',
        payload => payload.levelKey === '0:0'), [completionBeforeRestart]);
      const firstRecovery = restarted.app.recoverRewardUnlocks();
      const secondRecovery = restarted.app.recoverRewardUnlocks();
      assert.strictEqual(firstRecovery.reason, 'cloud-authoritative');
      assert.strictEqual(secondRecovery.reason, 'cloud-authoritative');
      assert.deepStrictEqual(rewardSnapshot(restarted), rewardsBefore,
        'startup retry and repeated recovery cannot mint an unconfirmed first-clear reward');
      assert.strictEqual(restarted.calls.every(call => call.data.action === 'identity.init'), true,
        'offline restart retries only identity and never falls through to another settlement protocol');
      assert.strictEqual(restarted.calls.some(call =>
        ['backup.read', 'backup.commit'].includes(call.data.action)), false);
    } finally {
      if (first) first.app.dispose();
      if (restarted) restarted.app.dispose();
    }
  });
}

async function cloudAuthoritativeDailyCompletionKeepsRewardsPending() {
  await withControlledClock(async clock => {
    let f = null;
    try {
      f = await establishedCloudFixture(clock);
      const dateKey = '2026-09-07';
      const rewardsBefore = rewardSnapshot(f);
      const accountBefore = accountSnapshot(f);
      assert.strictEqual(rewardsBefore.claimedDaily[dateKey], undefined);
      f.calls.length = 0;
      f.reply = offlineReply;

      assert.strictEqual(f.app.enterDaily(), true,
        'the real daily entry gate must accept the configured two-level challenge');
      const dayId = f.app.daily.dayId;
      assert.strictEqual(f.app.daily.levels.length, 2);
      solveDailyLevel(f.app, clock);
      assert.strictEqual(f.app.daily.levelIndex, 1,
        'the first solved board advances to the second board rather than granting the daily reward');
      assert.strictEqual(f.app.buildModel().currency.displayBalance, 0,
        'the first daily level is not a complete-day reward source');
      solveDailyLevel(f.app, clock);
      await tick();

      assert.strictEqual(f.app.scene, 'dailyResult');
      assert.strictEqual(f.app.daily.completionRecorded, true);
      assert.strictEqual(f.app.daily.result.dayFirstClear, true,
        'the completed two-level day satisfies the actual first-completion reward condition');
      assert.deepStrictEqual(f.app.daily.result.currencyReward, { status: 'pending', amount: 0 });
      const savedDays = f.app.dailyProgress.exportRewardCompletions();
      assert.strictEqual(savedDays.ok, true);
      assert.strictEqual(savedDays.days.some(day => day.dateKey === dateKey), true,
        'the real daily store persists the completed reward source');
      const entryOperations = matchingOperations(f, 'DAILY_ENTRY_RECORDED',
        payload => payload.dateKey === dateKey && payload.dayId === dayId);
      assert.strictEqual(entryOperations.length, 1, 'daily completion starts from a persisted legal entry');
      const completionOperations = matchingOperations(f, 'DAILY_LEVEL_COMPLETED',
        payload => payload.dateKey === dateKey && payload.dayId === dayId);
      assert.deepStrictEqual(completionOperations.map(operation => operation.payload.levelIndex), [0, 1]);
      assert.strictEqual(new Set(completionOperations.map(operation => operation.operationId)).size, 2);
      assert(completionOperations.every(operation =>
        operation.ownerIdAtCreation === accountBefore.scope.ownerId &&
        operation.bindingEpochAtCreation === accountBefore.scope.bindingEpoch &&
        operation.environmentIdAtCreation === accountBefore.scope.environmentId));
      assert.deepStrictEqual(f.app.buildModel().currency, {
        available: true, balance: 0, pendingRewardAmount: 500, displayBalance: 500, error: null
      }, 'only the final daily level contributes one pending daily reward');
      const pendingDailyBeforeRetry = clone(entryOperations.concat(completionOperations));
      assert.deepStrictEqual(rewardSnapshot(f), rewardsBefore,
        'daily completion must not change the cloud-authoritative balance or claim marker');
      assert.deepStrictEqual(accountSnapshot(f), accountBefore);
      assert.deepStrictEqual(f.sync.authorityModes(), Object.fromEntries(
        SyncStore.DOMAINS.map(domain => [domain, 'cloud-authoritative'])
      ));

      assert.strictEqual(f.app.performAction('reward:retry'), true,
        'the retry action can be handled while cloud authority still refuses local settlement');
      const recovery = f.app.recoverRewardUnlocks();
      assert.strictEqual(recovery.reason, 'cloud-authoritative');
      const retry = await f.app.resumeOnline();
      assert.strictEqual(retry.reason, 'STORE_TEMPORARY');
      assert.deepStrictEqual(
        matchingOperations(f, 'DAILY_ENTRY_RECORDED', payload =>
          payload.dateKey === dateKey && payload.dayId === dayId
        ).concat(matchingOperations(f, 'DAILY_LEVEL_COMPLETED', payload =>
          payload.dateKey === dateKey && payload.dayId === dayId
        )),
        pendingDailyBeforeRetry,
        'failed retry preserves each daily operation identity'
      );
      assert.deepStrictEqual(rewardSnapshot(f), rewardsBefore,
        'reward retry, recovery and offline cloud retry cannot pre-claim the daily reward');
      assert.strictEqual(f.calls.every(call =>
        ['identity.init', 'state.read', 'sync.push'].includes(call.data.action)), true,
        `daily offline requests must stay inside the cloud settlement protocol: ${JSON.stringify(
          f.calls.map(call => call.data.action)
        )}`);
      assert.strictEqual(f.calls.some(call =>
        ['backup.read', 'backup.commit'].includes(call.data.action)), false);
    } finally {
      if (f) f.app.dispose();
    }
  });
}

async function failedLocalCompletionSaveHasNoPendingDisplay() {
  await withControlledClock(async clock => {
    let f = null;
    try {
      f = await establishedCloudFixture(clock);
      f.reply = offlineReply;
      const write = f.native.setStorageSync.bind(f.native);
      f.native.setStorageSync = (key, value) => {
        if (key === ProgressStore.STORAGE_KEY) throw Error('progress storage unavailable');
        return write(key, value);
      };
      completeTraining(f.app);
      await tick();
      assert.deepStrictEqual(matchingOperations(f, 'MAIN_LEVEL_COMPLETED',
        payload => payload.levelKey === '0:0'), [],
      'a completion that was not durably saved cannot become a pending reward source');
      assert.deepStrictEqual(f.app.buildModel().currency, {
        available: true, balance: 0, pendingRewardAmount: 0, displayBalance: 0, error: null
      });
      assert.deepStrictEqual(f.app.result.currencyReward, { status: 'pending', amount: 0 });
    } finally {
      if (f) f.app.dispose();
    }
  });
}

module.exports = async function run() {
  await configuredRoutesAndBlockers();
  await entryGuardsAndFlights();
  await localBackupArchiveCannotFallThroughToCloud();
  await cloudAuthoritativeOfflineCompletionSurvivesRestart();
  await cloudAuthoritativeDailyCompletionKeepsRewardsPending();
  await failedLocalCompletionSaveHasNoPendingDisplay();
};
