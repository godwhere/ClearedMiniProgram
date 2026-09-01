const assert = require('assert');
const AdsService = require('../src/services/ads-service.js');

class FakeRewardedAd {
  onClose(handler) { this.closeHandler = handler; }
  onError(handler) { this.errorHandler = handler; }
  offClose() {}
  offError() {}
  show() { return Promise.resolve(); }
  load() { return Promise.resolve(); }
  destroy() {}
}

class RetryRewardedAd extends FakeRewardedAd {
  constructor() { super(); this.showCount = 0; this.loadCount = 0; }
  show() {
    this.showCount++;
    return this.showCount === 1 ? Promise.reject(new Error('not loaded')) : Promise.resolve();
  }
  load() { this.loadCount++; return Promise.resolve(); }
}

class FakeInterstitialAd {
  onClose(handler) { this.closeHandler = handler; }
  onError(handler) { this.errorHandler = handler; }
  offClose() { this.closeRemoved = true; }
  offError() { this.errorRemoved = true; }
  show() { return Promise.resolve(); }
  destroy() { this.destroyed = true; }
}

async function run() {
  const noAds = new AdsService({
    createRewardedVideoAd() { throw new Error('must remain a no-op'); }
  }, { rewarded: {}, interstitial: {}, rules: {} });
  assert.deepStrictEqual(await noAds.showRewarded('hint'), {
    rewarded: false,
    reason: 'not-configured'
  });

  const ad = new FakeRewardedAd();
  let rewardedCreates = 0;
  const service = new AdsService({
    createRewardedVideoAd() { rewardedCreates++; return ad; },
    createInterstitialAd() { return null; }
  }, {
    rewarded: { hint: 'test-unit', revive: 'another-unit' },
    interstitial: {},
    rules: {}
  });
  const resultPromise = service.showRewarded('hint');
  assert.deepStrictEqual(await service.showRewarded('revive'), { rewarded: false, reason: 'busy' });
  ad.closeHandler({ isEnded: true });
  assert.deepStrictEqual(await resultPromise, { rewarded: true, reason: 'completed' });
  assert.deepStrictEqual(await service.showRewarded('revive'), {
    rewarded: false,
    reason: 'unit-mismatch'
  });

  const closedPromise = service.showRewarded('hint');
  ad.closeHandler({ isEnded: false });
  assert.deepStrictEqual(await closedPromise, { rewarded: false, reason: 'closed' });
  assert.strictEqual(rewardedCreates, 1, 'rewarded video must remain a singleton');
  service.dispose();

  const retryAd = new RetryRewardedAd();
  const retryService = new AdsService({
    createRewardedVideoAd() { return retryAd; }
  }, { rewarded: { hint: 'retry-unit' }, interstitial: {}, rules: {} });
  const retryPromise = retryService.showRewarded('hint');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.strictEqual(retryAd.loadCount, 1);
  assert.strictEqual(retryAd.showCount, 2);
  retryAd.closeHandler({ isEnded: true });
  assert.strictEqual((await retryPromise).rewarded, true);

  const interstitial = new FakeInterstitialAd();
  const interstitialService = new AdsService({
    createInterstitialAd() { return interstitial; }
  }, {
    rewarded: {},
    interstitial: { levelComplete: 'interstitial-unit' },
    rules: { interstitialEveryClears: 2, interstitialMinIntervalMs: 0 }
  });
  assert.strictEqual(await interstitialService.onLevelCompleted(1), false);
  const interstitialPromise = interstitialService.onLevelCompleted(2);
  await new Promise(resolve => setTimeout(resolve, 0));
  interstitial.closeHandler();
  assert.strictEqual(await interstitialPromise, true);
  assert.strictEqual(interstitial.destroyed, true);
  assert.strictEqual(interstitial.closeRemoved, true);
  assert.strictEqual(interstitial.errorRemoved, true);
}

module.exports = run;
