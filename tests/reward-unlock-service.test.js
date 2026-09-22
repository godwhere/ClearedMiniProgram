'use strict';

const assert = require('assert');
const config = require('../src/config/rewards.js');
const RewardUnlockService = require('../src/services/reward-unlock-service.js');
const ProductPolicy = require('../src/runtime/product-policy.js');
const appProductConfig = require('./fixtures/app-product-policy.js');
const { RewardPlatform, ownedState } = require('./helpers/reward-fixture.js');

const emptyCompletions = () => ({
  ordinary: { ok: true, levelKeys: [] },
  daily: { ok: true, days: [] }
});

function displayContext(operations, overrides) {
  return Object.assign({
    ownerId: 'player_A', bindingEpoch: 1, activationSequence: 1, environmentId: 'test-env',
    authorityMode: 'cloud-authoritative', storageBlocked: false, ownsLocalState: true,
    readOnlyPhase: false, migrationState: null, applicationPending: false, restorePending: false,
    pendingOperations: operations || []
  }, overrides || {});
}

function pendingOperation(domain, type, payload, overrides) {
  return Object.assign({
    operationId: `operation_${type}`,
    domain,
    type,
    ownerIdAtCreation: 'player_A',
    bindingEpochAtCreation: 1,
    environmentIdAtCreation: 'test-env',
    payload
  }, overrides || {});
}

function testPendingRewardDisplay() {
  const platform = new RewardPlatform({
    [RewardUnlockService.STORAGE_KEY]: ownedState([], 1000)
  });
  const service = new RewardUnlockService(platform, config);
  assert(service.setAuthorityMode('cloud-authoritative'));
  const day = {
    dateKey: '2026-09-08', dayId: 'daily-2026-09-08-v1',
    levelIds: ['daily-intro-v1', 'daily-extreme-v1'], levelCount: 2,
    elapsedMs: 1000, completedAtClient: 1
  };
  const ordinary = pendingOperation('progress', 'MAIN_LEVEL_COMPLETED', {
    levelKey: '0:0', elapsedMs: 1000, rewardAmount: 99999
  });
  const operations = [
    ordinary,
    Object.assign({}, ordinary, { operationId: 'duplicate_ordinary' }),
    pendingOperation('daily', 'DAILY_LEVEL_COMPLETED', Object.assign({}, day, {
      levelId: day.levelIds[0], levelIndex: 0
    })),
    pendingOperation('daily', 'DAILY_LEVEL_COMPLETED', Object.assign({}, day, {
      levelId: day.levelIds[1], levelIndex: 1, rewardAmount: 99999
    })),
    pendingOperation('daily', 'DAILY_LEVEL_COMPLETED', Object.assign({}, day, {
      levelId: day.levelIds[1], levelIndex: 1
    }), { operationId: 'duplicate_daily' }),
    pendingOperation('progress', 'PROGRESS_LAST_PLAYED', { setIndex: 0, levelIndex: 0 }),
    pendingOperation('progress', 'MAIN_LEVEL_COMPLETED', { levelKey: '999:999', elapsedMs: 1 },
      { operationId: 'unknown_level' }),
    pendingOperation('progress', 'MAIN_LEVEL_COMPLETED', { levelKey: '0:1', elapsedMs: 1 }, {
      operationId: 'wrong_account', ownerIdAtCreation: 'player_B'
    }),
    pendingOperation('progress', 'MAIN_LEVEL_COMPLETED', { levelKey: '0:2', elapsedMs: 1 }, {
      operationId: 'wrong_environment', environmentIdAtCreation: 'other-env'
    }),
    pendingOperation('progress', 'MAIN_LEVEL_COMPLETED', { levelKey: '0:3', elapsedMs: 1 }, {
      operationId: 'wrong_binding', bindingEpochAtCreation: 2
    })
  ];
  const writesBefore = platform.writes.length;
  assert.deepStrictEqual(service.view(), { available: true, balance: 1000, error: null },
    'the authoritative wallet query keeps its original contract');
  assert.deepStrictEqual(service.displayView(displayContext(operations)), {
    available: true, balance: 1000, pendingRewardAmount: 600, displayBalance: 1600, error: null
  }, 'pending display derives config rewards, ignores payload amounts and deduplicates stable sources');
  assert.strictEqual(platform.writes.length, writesBefore, 'display queries never persist derived balances');

  service.state.claimedOrdinary['0:0'] = true;
  service.state.claimedDaily['2026-09-08'] = day.dayId;
  assert.deepStrictEqual(service.displayView(displayContext(operations)), {
    available: true, balance: 1000, pendingRewardAmount: 0, displayBalance: 1000, error: null
  }, 'cloud-confirmed claim sources are never counted even if duplicate pending operations remain');
  delete service.state.claimedOrdinary['0:0'];
  delete service.state.claimedDaily['2026-09-08'];

  ['storageBlocked', 'readOnlyPhase', 'applicationPending', 'restorePending'].forEach(flag => {
    const protectedView = service.displayView(displayContext(operations, { [flag]: true }));
    if (flag === 'storageBlocked') {
      assert.deepStrictEqual(protectedView, {
        available: false, balance: null, pendingRewardAmount: 0,
        displayBalance: null, error: 'ownership-unconfirmed'
      }, flag);
    } else {
      assert.strictEqual(protectedView.displayBalance, 1000, flag);
    }
  });
  assert.deepStrictEqual(service.displayView(displayContext(operations, {
    ownerId: 'player_B', ownsLocalState: false
  })), {
    available: false, balance: null, pendingRewardAmount: 0,
    displayBalance: null, error: 'ownership-unconfirmed'
  }, 'an account switch hides both the pending amount and the old owner confirmed balance');
  assert.deepStrictEqual(service.view(), { available: true, balance: 1000, error: null },
    'masking the display does not mutate the authoritative wallet contract');
  assert.strictEqual(service.displayView(displayContext(operations, { migrationState: 'uploading' })).pendingRewardAmount, 0);
  assert.strictEqual(service.displayView(displayContext(operations, { environmentId: null })).displayBalance, null);
  assert.strictEqual(service.displayView(displayContext(operations, { bindingEpoch: 0 })).displayBalance, null);

  const local = new RewardUnlockService(new RewardPlatform({
    [RewardUnlockService.STORAGE_KEY]: ownedState([], 1000)
  }), config);
  assert.strictEqual(local.displayView(displayContext(operations)).displayBalance, 1000,
    'legacy-local never infers a second wallet from cloud operations');
}

function testSameLevelConfigUpgrade() {
  const firstConfig = JSON.parse(JSON.stringify(config));
  firstConfig.items = firstConfig.items.filter(item => item.id !== 'theme:spring');
  const platform = new RewardPlatform();
  const completions = { ordinary: { ok: true, levelKeys: ['1:2'] }, daily: { ok: true, days: [] } };
  const first = new RewardUnlockService(platform, firstConfig);
  const initial = first.reconcile(completions);
  assert.strictEqual(initial.amountDelta, 100);
  assert.deepStrictEqual(initial.newRewards, ['theme:gem']);
  assert.strictEqual(first.acknowledgeNotice('theme:gem').ok, true);

  const nextConfig = JSON.parse(JSON.stringify(firstConfig));
  nextConfig.items.push({ id: 'theme:spring', kind: 'theme', itemId: 'spring',
    unlock: { type: 'ordinary_level', levelKey: '1:2' } });
  const upgraded = new RewardUnlockService(platform, nextConfig);
  const savedBefore = JSON.stringify(platform.storage[RewardUnlockService.STORAGE_KEY]);
  platform.writeFailures[RewardUnlockService.STORAGE_KEY] = true;
  assert.strictEqual(upgraded.reconcile(completions).reason, 'persist-failed');
  assert.strictEqual(upgraded.canUse('theme', 'spring'), false);
  assert.deepStrictEqual(upgraded.pendingNotices(), []);
  assert.strictEqual(upgraded.view().balance, 100);
  assert.strictEqual(JSON.stringify(platform.storage[RewardUnlockService.STORAGE_KEY]), savedBefore,
    'a reward-only upgrade write must remain atomic');

  platform.writeFailures[RewardUnlockService.STORAGE_KEY] = false;
  const recovered = upgraded.reconcile(completions);
  assert.strictEqual(recovered.ok, true);
  assert.strictEqual(recovered.amountDelta, 0);
  assert.deepStrictEqual(recovered.sources, []);
  assert.deepStrictEqual(recovered.newRewards, ['theme:spring']);
  assert.strictEqual(upgraded.canUse('theme', 'spring'), true);
  assert.strictEqual(upgraded.view().balance, 100);
  assert.deepStrictEqual(upgraded.pendingNotices(), ['theme:spring']);
  const restarted = new RewardUnlockService(platform, nextConfig);
  assert.deepStrictEqual(restarted.pendingNotices(), ['theme:spring']);
  const writesBefore = platform.writes.length;
  assert.deepStrictEqual(restarted.reconcile(completions).newRewards, []);
  assert.strictEqual(restarted.view().balance, 100);
  assert.strictEqual(platform.writes.length, writesBefore);
  assert.deepStrictEqual(restarted.pendingNotices(), ['theme:spring']);
  assert.strictEqual(restarted.acknowledgeNotice('theme:spring').ok, true);
  assert.deepStrictEqual(restarted.reconcile(completions).newRewards, []);
  assert.deepStrictEqual(restarted.pendingNotices(), [], 'acknowledged rewards are not notified again');
}

function run() {
  testSameLevelConfigUpgrade();
  testPendingRewardDisplay();
  assert.strictEqual(config.items.length, 13);
  assert.strictEqual(RewardUnlockService.validateConfig(config) !== null, true);

  const appConfig = ProductPolicy.create(appProductConfig).projectRewardConfig(config);
  const defaultAuthority = new RewardUnlockService(new RewardPlatform(), config);
  assert.strictEqual(defaultAuthority.setAuthorityMode('app-local'), false,
    'a legacy service cannot be promoted into App authority');
  assert.strictEqual(defaultAuthority.authorityMode(), 'legacy-local');
  assert.strictEqual(defaultAuthority.setAuthorityMode('unknown'), false);
  const protectedAuthority = new RewardUnlockService(new RewardPlatform(), config);
  assert.strictEqual(protectedAuthority.setAuthorityMode('cloud-authoritative'), true);
  assert.strictEqual(protectedAuthority.setAuthorityMode('app-local'), false);
  const appAuthority = new RewardUnlockService(new RewardPlatform(), appConfig, {
    authorityMode: 'app-local'
  });
  assert.strictEqual(appAuthority.authorityMode(), 'app-local');
  assert.strictEqual(appAuthority.setAuthorityMode('app-local'), true);
  assert.strictEqual(appAuthority.setAuthorityMode('legacy-local'), false);
  assert.strictEqual(appAuthority.setAuthorityMode('cloud-authoritative'), false);
  const writesBeforeDaily = appAuthority.platform.writes.length;
  assert.strictEqual(appAuthority.reconcile({ ordinary: { ok: true, levelKeys: [] },
    daily: { ok: true, days: [{ dateKey: '2026-09-22', dayId: 'day-app', levelIds: ['a', 'b'] }] } }).reason,
  'daily-disabled');
  assert.strictEqual(appAuthority.platform.writes.length, writesBeforeDaily);
  assert.strictEqual(appAuthority.recordAdCompletion({ rewardId: 'theme:ocean', attemptId: 'app:ad' }).reason,
    'app-local');
  assert.strictEqual(appAuthority.recordShareInitiated({ rewardId: 'theme:festival', initiated: true }).reason,
    'app-local');

  const appRewardIds = config.items.filter(item => ['rewarded_ad', 'share'].includes(item.unlock.type))
    .map(item => item.id);
  const fundedAppPlatform = new RewardPlatform({
    [RewardUnlockService.STORAGE_KEY]: ownedState([], 50000)
  });
  const fundedApp = new RewardUnlockService(fundedAppPlatform, appConfig, { authorityMode: 'app-local' });
  appRewardIds.forEach(rewardId => {
    const before = fundedApp.view().balance;
    assert.strictEqual(fundedApp.status(rewardId).conditionType, 'currency');
    assert.strictEqual(fundedApp.status(rewardId).cost, 10000);
    assert.strictEqual(fundedApp.purchase(rewardId).amountDelta, -10000);
    assert.strictEqual(fundedApp.canUse(rewardId.split(':')[0], rewardId.split(':')[1]), true);
    assert.strictEqual(fundedApp.view().balance, before - 10000);
    assert.strictEqual(fundedApp.purchase(rewardId).amountDelta, 0,
      'an App reward cannot charge twice');
  });
  assert.strictEqual(fundedApp.view().balance, 0);

  const failedAppPlatform = new RewardPlatform({
    [RewardUnlockService.STORAGE_KEY]: ownedState([], 10000)
  });
  failedAppPlatform.writeFailures[RewardUnlockService.STORAGE_KEY] = true;
  const failedApp = new RewardUnlockService(failedAppPlatform, appConfig, { authorityMode: 'app-local' });
  assert.strictEqual(failedApp.purchase(appRewardIds[0]).reason, 'persist-failed');
  assert.deepStrictEqual(failedApp.view(), { available: true, balance: 10000, error: null });
  assert.strictEqual(failedApp.owned(appRewardIds[0]), false);

  const recoveryPlatform = new RewardPlatform();
  const failedRecovery = new RewardUnlockService(recoveryPlatform, appConfig, { authorityMode: 'app-local' });
  recoveryPlatform.writeFailures[RewardUnlockService.STORAGE_KEY] = true;
  const persistedFact = { ordinary: { ok: true, levelKeys: ['0:0'] }, daily: { ok: true, days: [] } };
  assert.strictEqual(failedRecovery.reconcile(persistedFact).reason, 'persist-failed');
  assert.strictEqual(failedRecovery.view().balance, 0);
  recoveryPlatform.writeFailures[RewardUnlockService.STORAGE_KEY] = false;
  const recoveredApp = new RewardUnlockService(recoveryPlatform, appConfig, { authorityMode: 'app-local' });
  assert.strictEqual(recoveredApp.reconcile(persistedFact).amountDelta, 100);
  const appWrites = recoveryPlatform.writes.length;
  const restartedApp = new RewardUnlockService(recoveryPlatform, appConfig, { authorityMode: 'app-local' });
  assert.strictEqual(restartedApp.view().balance, 100,
    'a fresh App service may load an existing isolated ledger');
  assert.strictEqual(restartedApp.reconcile(persistedFact).amountDelta, 0);
  assert.strictEqual(recoveryPlatform.writes.length, appWrites);

  const platform = new RewardPlatform();
  const service = new RewardUnlockService(platform, config);
  const writesBeforeQueries = platform.writes.length;
  assert.deepStrictEqual(service.view(), { available: true, balance: 0, error: null });
  assert.strictEqual(service.canUse('theme', 'classic'), true);
  assert.strictEqual(service.canUse('effect', 'none'), true);
  assert.strictEqual(service.canUse('theme', 'gem'), false);
  service.status('theme:gem'); service.view(); service.pendingNotices();
  assert.strictEqual(platform.writes.length, writesBeforeQueries, 'read-only queries never persist');

  const first = service.reconcile({
    ordinary: { ok: true, levelKeys: ['0:0', '1:2', '2:2'] },
    daily: { ok: true, days: [{ dateKey: '2026-09-03', dayId: 'day-a', levelIds: ['intro', 'extreme'] }] }
  });
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.amountDelta, 800);
  assert.deepStrictEqual(first.newRewards.sort(), ['effect:fade', 'theme:gem']);
  assert.strictEqual(service.view().balance, 800);
  assert.strictEqual(service.canUse('theme', 'gem'), true);
  assert.strictEqual(service.canUse('effect', 'fade'), true);
  assert.deepStrictEqual(service.pendingNotices().sort(), ['effect:fade', 'theme:gem']);

  const repeated = service.reconcile({
    ordinary: { ok: true, levelKeys: ['0:0', '1:2', '2:2'] },
    daily: { ok: true, days: [{ dateKey: '2026-09-03', dayId: 'day-b', levelIds: ['different', 'version'] }] }
  });
  assert.strictEqual(repeated.amountDelta, 0);
  assert.strictEqual(service.view().balance, 800);

  const exactMilestones = new RewardUnlockService(new RewardPlatform(), config);
  assert.strictEqual(exactMilestones.reconcile({
    ordinary: { ok: true, levelKeys: ['0:0', '0:1', '1:0', '1:1', '1:3'] },
    daily: { ok: true, days: [] }
  }).newRewards.length, 0, 'five unrelated clears do not unlock the fifth-level reward');
  const animal = exactMilestones.reconcile({
    ordinary: { ok: true, levelKeys: ['4:55'] }, daily: { ok: true, days: [] }
  });
  assert.deepStrictEqual(animal.newRewards, ['theme:animals']);
  assert.strictEqual(exactMilestones.canUse('theme', 'gem'), false,
    'clearing level 88 itself does not imply earlier milestone ownership');
  assert.strictEqual(exactMilestones.canUse('effect', 'fade'), false);
  assert.strictEqual(exactMilestones.canUse('theme', 'fruits'), false);

  const fundedPlatform = new RewardPlatform({
    [RewardUnlockService.STORAGE_KEY]: ownedState([], 20000)
  });
  const funded = new RewardUnlockService(fundedPlatform, config);
  assert.strictEqual(funded.purchase('theme:desserts').amountDelta, -10000);
  assert.strictEqual(funded.purchase('theme:desserts').amountDelta, 0);
  assert.strictEqual(funded.purchase('theme:space').amountDelta, -10000);
  assert.strictEqual(funded.view().balance, 0);
  assert.strictEqual(funded.purchase('theme:gem').reason, 'invalid-reward');

  const poor = new RewardUnlockService(new RewardPlatform({
    [RewardUnlockService.STORAGE_KEY]: ownedState([], 9999)
  }), config);
  assert.strictEqual(poor.purchase('theme:desserts').reason, 'insufficient-balance');
  assert.strictEqual(poor.view().balance, 9999);

  const failingPlatform = new RewardPlatform({
    [RewardUnlockService.STORAGE_KEY]: ownedState([], 10000)
  });
  failingPlatform.writeFailures[RewardUnlockService.STORAGE_KEY] = true;
  const failing = new RewardUnlockService(failingPlatform, config);
  assert.strictEqual(failing.purchase('theme:space').reason, 'persist-failed');
  assert.strictEqual(failing.view().balance, 10000);
  assert.strictEqual(failing.canUse('theme', 'space'), false);

  const ad = new RewardUnlockService(new RewardPlatform(), config);
  assert.deepStrictEqual(ad.recordAdCompletion({ rewardId: 'theme:ocean', attemptId: 'ad:1' }).newRewards, ['theme:ocean']);
  assert.strictEqual(ad.recordAdCompletion({ rewardId: 'theme:spring', attemptId: 'ad:1' }).reason, 'duplicate-attempt');
  assert.strictEqual(ad.canUse('theme', 'spring'), false);
  const multiConfig = JSON.parse(JSON.stringify(config));
  multiConfig.items.find(item => item.id === 'theme:spring').unlock.requiredCount = 2;
  const multi = new RewardUnlockService(new RewardPlatform(), multiConfig);
  assert.strictEqual(multi.recordAdCompletion({ rewardId: 'theme:spring', attemptId: 'ad:a' }).newRewards.length, 0);
  assert.strictEqual(multi.recordAdCompletion({ rewardId: 'theme:spring', attemptId: 'ad:a' }).reason, 'duplicate-attempt');
  assert.deepStrictEqual(multi.recordAdCompletion({ rewardId: 'theme:spring', attemptId: 'ad:b' }).newRewards, ['theme:spring']);

  const externalPlatform = new RewardPlatform();
  const external = new RewardUnlockService(externalPlatform, config);
  externalPlatform.writeFailures[RewardUnlockService.STORAGE_KEY] = true;
  assert.strictEqual(external.recordShareInitiated({ rewardId: 'theme:festival', initiated: true }).reason, 'persist-failed');
  assert.strictEqual(external.hasPendingExternal(), true);
  externalPlatform.writeFailures[RewardUnlockService.STORAGE_KEY] = false;
  assert.deepStrictEqual(external.retryPendingSave().newRewards, ['theme:festival']);
  assert.strictEqual(external.hasPendingExternal(), false);
  assert.strictEqual(external.recordShareInitiated({ rewardId: 'theme:festival', initiated: false }).reason, 'not-initiated');

  const readFailedPlatform = new RewardPlatform();
  readFailedPlatform.readFailures[RewardUnlockService.STORAGE_KEY] = true;
  const unavailable = new RewardUnlockService(readFailedPlatform, config);
  assert.strictEqual(unavailable.view().available, false);
  assert.strictEqual(unavailable.view().balance, null);
  assert.strictEqual(unavailable.canUse('theme', 'classic'), true);
  assert.strictEqual(unavailable.canUse('theme', 'gem'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(readFailedPlatform.storage, RewardUnlockService.STORAGE_KEY), false);
  readFailedPlatform.readFailures[RewardUnlockService.STORAGE_KEY] = false;
  readFailedPlatform.storage[RewardUnlockService.STORAGE_KEY] = ownedState(['theme:gem'], 123);
  assert.strictEqual(unavailable.retryLoad().ok, true);
  assert.strictEqual(unavailable.view().balance, 123);

  const corrupt = new RewardPlatform({
    [RewardUnlockService.STORAGE_KEY]: Object.assign(ownedState([], 0), { balance: -1 })
  });
  const invalid = new RewardUnlockService(corrupt, config);
  assert.strictEqual(invalid.view().available, false);
  assert.strictEqual(invalid.reconcile(emptyCompletions()).reason, 'invalid-storage');
  assert.strictEqual(corrupt.writes.length, 0);

  const recoveredPlatform = new RewardPlatform();
  const initial = new RewardUnlockService(recoveredPlatform, config);
  recoveredPlatform.writeFailures[RewardUnlockService.STORAGE_KEY] = true;
  assert.strictEqual(initial.reconcile({ ordinary: { ok: true, levelKeys: ['3:7'] }, daily: { ok: true, days: [] } }).ok, false);
  assert.strictEqual(initial.view().balance, 0);
  recoveredPlatform.writeFailures[RewardUnlockService.STORAGE_KEY] = false;
  const reloaded = new RewardUnlockService(recoveredPlatform, config);
  assert.strictEqual(reloaded.reconcile({ ordinary: { ok: true, levelKeys: ['3:7'] }, daily: { ok: true, days: [] } }).amountDelta, 100);
  assert.strictEqual(reloaded.canUse('theme', 'fruits'), true);

  assert.strictEqual(service.acknowledgeNotice('theme:gem').ok, true);
  assert.deepStrictEqual(service.pendingNotices(), ['effect:fade']);
}

module.exports = run;
