'use strict';

const assert = require('assert');
const ProductPolicy = require('../src/runtime/product-policy.js');
const appProductConfig = require('./fixtures/app-product-policy.js');

function run() {
  const compatibility = ProductPolicy.create();
  assert.deepStrictEqual(compatibility.capabilities, {
    dailyEnabled: true,
    adsEnabled: true,
    rewardedShareEnabled: true,
    resultShareEnabled: true,
    hintMode: 'tiered'
  });
  assert.strictEqual(compatibility.dailyCompletionSource(), null);

  const app = ProductPolicy.create(appProductConfig);
  assert.strictEqual(ProductPolicy.create(app), app, 'normalizing an existing policy is idempotent');
  assert.deepStrictEqual(app.capabilities, {
    dailyEnabled: false,
    adsEnabled: false,
    rewardedShareEnabled: false,
    resultShareEnabled: false,
    hintMode: 'free'
  });
  assert.deepStrictEqual(app.config.freeLevelKeys, appProductConfig.freeLevelKeys);
  assert.strictEqual(app.config.fullGameEntitlementId, 'full_game_v1');
  assert.strictEqual(app.config.iceTrialRequiresFullGame, true);
  assert.strictEqual(app.isEnabled('daily'), false);
  assert.strictEqual(app.isEnabled('unknown'), false);
  assert.strictEqual(Object.isFrozen(app), true);
  assert.strictEqual(Object.isFrozen(app.config), true);
  assert.strictEqual(Object.isFrozen(app.capabilities), true);
  assert.strictEqual(Object.isFrozen(app.config.freeLevelKeys), true);
  assert.strictEqual(app.dailyCompletionSource(), ProductPolicy.EMPTY_DAILY_COMPLETIONS);
  assert.deepStrictEqual(app.dailyCompletionSource(), { ok: true, days: [] });
  assert.strictEqual(Object.isFrozen(app.dailyCompletionSource()), true);
  assert.strictEqual(Object.isFrozen(app.dailyCompletionSource().days), true);

  const freeCompatibility = ProductPolicy.create(undefined, { hintMode: 'free' });
  assert.strictEqual(freeCompatibility.hintMode(), 'free');
  assert.throws(() => ProductPolicy.create(null), /invalid-product-policy/);
  assert.throws(() => ProductPolicy.create({ adsEnabled: 'no' }), /adsEnabled/);
  assert.throws(() => ProductPolicy.create({ hintMode: 'unknown' }), /hintMode/);
  assert.throws(() => ProductPolicy.create({ adsEnabled: false, hintMode: 'rewarded' }),
    /requires-ads/);
  assert.throws(() => ProductPolicy.create({ rewardedShareEnabled: false, hintMode: 'share' }),
    /requires-rewarded-share/);
  assert.throws(() => ProductPolicy.create({ freeLevelKeys: ['0:0', '0:0'] }),
    /freeLevelKeys/);
  assert.throws(() => ProductPolicy.create({ fullGameEntitlementId: 'bad id' }),
    /fullGameEntitlementId/);
  assert.throws(() => ProductPolicy.create({ futureCapability: true }),
    /unknown-product-policy-key/);
}

module.exports = run;
