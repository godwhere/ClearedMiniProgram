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

function compatible(result) {
  assert.strictEqual(typeof result.attemptId, 'string');
  assert(result.attemptId.startsWith('adatt_'));
  assert(Number.isFinite(result.startedAt) && result.finishedAt >= result.startedAt);
  assert(Object.prototype.hasOwnProperty.call(result, 'errCode'));
  return { rewarded: result.rewarded, reason: result.reason };
}

async function run() {
  const noAds = new AdsService({
    createRewardedVideoAd() { throw new Error('must remain a no-op'); }
  }, { rewarded: {}, interstitial: {}, rules: {} });
  assert.deepStrictEqual(compatible(await noAds.showRewarded('hint')), {
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
  assert.deepStrictEqual(compatible(await service.showRewarded('revive')), { rewarded: false, reason: 'busy' });
  ad.closeHandler({ isEnded: true });
  assert.deepStrictEqual(compatible(await resultPromise), { rewarded: true, reason: 'completed' });
  assert.deepStrictEqual(compatible(await service.showRewarded('revive')), {
    rewarded: false,
    reason: 'unit-mismatch'
  });

  const closedPromise = service.showRewarded('hint');
  ad.closeHandler({ isEnded: false });
  assert.deepStrictEqual(compatible(await closedPromise), { rewarded: false, reason: 'closed' });
  assert.strictEqual(rewardedCreates, 1, 'rewarded video must remain a singleton');
  service.dispose();

  const retryAd = new RetryRewardedAd();
  const retryService = new AdsService({
    createRewardedVideoAd() { return retryAd; }
  }, { rewarded: { hint: 'retry-unit' }, interstitial: {}, rules: {} });
  const retryPromise = retryService.showRewarded('hint');
  const retryAttempt = retryService.rewarded.attempt.attemptId;
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.strictEqual(retryAd.loadCount, 1);
  assert.strictEqual(retryAd.showCount, 2);
  retryAd.closeHandler({ isEnded: true });
  const retried = await retryPromise;
  assert.strictEqual(retried.rewarded, true);
  assert.strictEqual(retried.attemptId, retryAttempt);


  const incomplete = new FakeRewardedAd();
  const interrupted = new AdsService({ createRewardedVideoAd: () => incomplete }, { rewarded: { hint: 'unit' } });
  const absent = interrupted.showRewarded('hint'); incomplete.closeHandler();
  assert.strictEqual((await absent).rewarded, false, 'absent isEnded never grants a reward');
  const errorResult = interrupted.showRewarded('hint'); incomplete.errorHandler({ errCode: 1004, secret: 'not retained' });
  assert.strictEqual((await errorResult).errCode, 1004);
  const abandoned = interrupted.showRewarded('hint'); interrupted.dispose();
  assert.strictEqual((await abandoned).rewarded, false, 'dispose settles pending callers');

  const WechatPlatform = require('../src/platform/wechat.js');
  let capabilityCreates = 0; let capabilityAttempts = 0;
  const capabilityPlatform = Object.create(WechatPlatform.prototype);
  capabilityPlatform.api = { createRewardedVideoAd() { capabilityCreates++; return {}; } };
  const capability = new AdsService(capabilityPlatform, { rewarded: { hint: 'test-unit' } },
    { nextAttemptId: () => `adatt_cap_${++capabilityAttempts}` });
  assert.strictEqual(capability.isRewardedSupported(), true);
  assert.strictEqual(capability.isRewardedConfigured('hint'), true);
  assert.strictEqual(capabilityCreates + capabilityAttempts, 0, 'capability checks never create ads or allocate attempts');
  for (const value of ['', ' ', ' unit', 'unit ', 123, {}]) {
    capability.config.rewarded.hint = value;
    assert.strictEqual(capability.isRewardedConfigured('hint'), false);
    assert.strictEqual((await capability.showRewarded('hint')).reason, 'not-configured');
  }
  assert.strictEqual(capabilityCreates, 0);
  capabilityPlatform.api = {};
  assert.strictEqual(capability.isRewardedSupported(), false);
  const options = Object.freeze({ adUnitId: 'unit', disableFallbackSharePage: true });
  for (const version of ['3.7.6', '3.7.7', '3.8.21', 'invalid']) {
    let received; const adapter = Object.create(WechatPlatform.prototype);
    adapter.api = { getSystemInfoSync: () => ({ SDKVersion: version }), createRewardedVideoAd: value => { received = value; return {}; } };
    adapter.createRewardedVideoAd(options);
    assert.strictEqual(received.disableFallbackSharePage, ['3.7.7', '3.8.21'].includes(version) ? true : undefined);
  }
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
