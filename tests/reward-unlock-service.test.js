'use strict';

const assert = require('assert');
const config = require('../src/config/rewards.js');
const RewardUnlockService = require('../src/services/reward-unlock-service.js');
const { RewardPlatform, ownedState } = require('./helpers/reward-fixture.js');

const emptyCompletions = () => ({
  ordinary: { ok: true, levelKeys: [] },
  daily: { ok: true, days: [] }
});

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
  assert.strictEqual(config.items.length, 13);
  assert.strictEqual(RewardUnlockService.validateConfig(config) !== null, true);

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
