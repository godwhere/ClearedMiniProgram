'use strict';
const assert = require('assert');
const EngagementService = require('../src/services/engagement-service.js');
const RewardUnlockService = require('../src/services/reward-unlock-service.js');
const rewardConfig = require('../src/config/rewards.js');
const { RewardPlatform } = require('./helpers/reward-fixture.js');
module.exports = async function run() {
  let calls = 0;
  const service = new EngagementService({ ads: { onLevelCompleted(n) { calls++; assert.strictEqual(n, 4); throw Error('ads unavailable'); }, showRewarded() { throw Error('free hint must not request ad'); } } });
  assert.strictEqual((await service.requestHint({})).granted, true);
  assert.strictEqual(await service.onOrdinaryCompleted({ totalClears: 4 }), false);
  assert.strictEqual(calls, 1);
  assert.strictEqual((await service.requestDailyExtraEntry()).ok, false);
  const rewarded = new EngagementService({ config: { hintMode: 'rewarded' }, ads: {
    showRewarded: async () => ({ rewarded: false, reason: 'closed', attemptId: 'adatt_1' })
  } });
  assert.strictEqual((await rewarded.requestHint({ scene: 'play' })).granted, false);
  rewarded.ads.showRewarded = async () => ({ rewarded: true, reason: 'completed', attemptId: 'adatt_2' });
  assert.strictEqual((await rewarded.requestHint({ scene: 'play' })).attemptId, 'adatt_2');
  service.config.hintMode = 'unknown-mode';
  assert.strictEqual((await service.requestHint({})).reason, 'invalid-mode');
  assert.strictEqual(service.hintState({}).action, 'unavailable');

  const unlockCalls = [];
  const unlocks = {
    pending: false,
    status(id) { return { ok: true, id, kind: 'theme', itemId: id.split(':')[1], owned: false,
      conditionType: id === 'theme:festival' ? 'share' : 'rewarded_ad', action: id === 'theme:festival' ? 'share' : 'rewarded_ad' }; },
    hasPendingExternal() { return this.pending; },
    retryPendingSave() { unlockCalls.push(['retry']); this.pending = false; return { ok: true, newRewards: ['theme:ocean'] }; },
    recordAdCompletion(input) { unlockCalls.push(['ad', input]); return { ok: true, newRewards: [input.rewardId] }; },
    recordShareInitiated(input) { unlockCalls.push(['share', input]); return { ok: true, newRewards: [input.rewardId] }; }
  };
  const ads = {
    isRewardedConfigured: () => true,
    isRewardedSupported: () => true,
    showRewarded: async () => ({ rewarded: true, placement: 'rewardUnlock', attemptId: 'reward:1' })
  };
  const unlockEngagement = new EngagementService({ rewardUnlocks: unlocks, ads,
    share: { shareReward: async () => ({ initiated: true }) },
    config: { rewardUnlockRewardedEnabled: true } });
  assert.deepStrictEqual((await unlockEngagement.requestRewardUnlock({ rewardId: 'theme:ocean', scene: 'themes' })).newRewards, ['theme:ocean']);
  assert.deepStrictEqual(unlockCalls[0], ['ad', { rewardId: 'theme:ocean', attemptId: 'reward:1' }]);
  assert.deepStrictEqual((await unlockEngagement.requestRewardUnlock({ rewardId: 'theme:festival', scene: 'themes' })).newRewards, ['theme:festival']);
  unlocks.pending = true;
  await unlockEngagement.requestRewardUnlock({ rewardId: 'theme:spring', scene: 'themes' });
  assert.deepStrictEqual(unlockCalls[2], ['retry']);

  const disabled = new EngagementService({ rewardUnlocks: unlocks, ads, config: {} });
  unlocks.pending = false;
  assert.strictEqual(disabled.rewardUnlockState('theme:ocean').reason, 'ads-not-enabled');
  assert.strictEqual((await disabled.requestRewardUnlock({ rewardId: 'theme:ocean', scene: 'themes' })).reason, 'ads-not-enabled');

  let resolveLate;
  const lateCalls = [];
  const late = new EngagementService({ rewardUnlocks: Object.assign({}, unlocks, {
    recordAdCompletion(input) { lateCalls.push(input); return { ok: true, newRewards: [input.rewardId] }; }
  }), ads: Object.assign({}, ads, { showRewarded: () => new Promise(resolve => { resolveLate = resolve; }) }),
  config: { rewardUnlockRewardedEnabled: true } });
  const lateTask = late.requestRewardUnlock({ rewardId: 'theme:ocean', scene: 'themes' });
  late.cancelRewardUnlocks();
  resolveLate({ rewarded: true, placement: 'rewardUnlock', attemptId: 'reward:late' });
  assert.strictEqual((await lateTask).reason, 'stale');
  assert.strictEqual(lateCalls.length, 0, 'disposed generations cannot commit late external results');

  const racePlatform = new RewardPlatform();
  const raceUnlocks = new RewardUnlockService(racePlatform, rewardConfig);
  let finishAd;
  const race = new EngagementService({ rewardUnlocks: raceUnlocks, ads: {
    isRewardedConfigured: () => true,
    isRewardedSupported: () => true,
    showRewarded: () => new Promise(resolve => { finishAd = resolve; })
  }, config: { rewardUnlockRewardedEnabled: true } });
  const raceTask = race.requestRewardUnlock({ rewardId: 'theme:ocean', scene: 'themes' });
  raceUnlocks.reconcile({ ordinary: { ok: true, levelKeys: ['0:0'] }, daily: { ok: true, days: [] } });
  finishAd({ rewarded: true, placement: 'rewardUnlock', attemptId: 'race:1' });
  assert.strictEqual((await raceTask).ok, true);
  assert.strictEqual(raceUnlocks.view().balance, 100,
    'the external result commits against the latest wallet state');
};
