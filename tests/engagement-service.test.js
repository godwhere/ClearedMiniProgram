'use strict';
const assert = require('assert');
const EngagementService = require('../src/services/engagement-service.js');
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
};
