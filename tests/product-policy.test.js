'use strict';

const assert = require('assert');
const ProductPolicy = require('../src/runtime/product-policy.js');
const rewardConfig = require('../src/config/rewards.js');
const appProductConfig = require('./fixtures/app-product-policy.js');

function clone(value) { return JSON.parse(JSON.stringify(value)); }

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
  assert.deepStrictEqual(app.authority(), appProductConfig.authority);
  assert.deepStrictEqual(app.rewardUnlockOverride(), appProductConfig.rewardUnlockOverride);
  assert.strictEqual(Object.isFrozen(app.authority()), true);
  assert.strictEqual(Object.isFrozen(app.authority().domains), true);
  assert.strictEqual(Object.isFrozen(app.rewardUnlockOverride()), true);
  assert.strictEqual(Object.isFrozen(app.rewardUnlockOverride().sourceTypes), true);
  assert.strictEqual(Object.isFrozen(app.rewardUnlockOverride().replacement), true);
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
  assert.strictEqual(app.hasFullGameGate(), true);
  const initial = app.defaultEntitlementSnapshot();
  assert.deepStrictEqual(initial, {
    productId: 'full_game_v1', status: 'unknown', source: null,
    transactionId: null, verifiedAt: null, revision: 0,
    verifiedCache: false, price: null
  });
  assert.strictEqual(Object.isFrozen(initial), true);
  assert.deepStrictEqual(app.contentAccess({ type: 'level', setIndex: 0, levelIndex: 0 }, initial), {
    allowed: true, reason: 'free_preview', entitlementStatus: 'unknown'
  });
  assert.deepStrictEqual(app.contentAccess({ type: 'level', setIndex: 1, levelIndex: 4 }, initial), {
    allowed: false, reason: 'requires_full_game', entitlementStatus: 'unknown'
  });
  assert.deepStrictEqual(app.contentAccess({ type: 'iceTrial' }, initial), {
    allowed: false, reason: 'requires_full_game', entitlementStatus: 'unknown'
  });
  const owned = app.normalizeEntitlementSnapshot({
    productId: 'full_game_v1', status: 'owned_verified', source: 'fake',
    transactionId: 'tx-1', verifiedAt: 100, revision: 2,
    price: { localized: '$1.99', currencyCode: 'USD' }
  });
  assert.strictEqual(owned.ok, true);
  assert.strictEqual(Object.isFrozen(owned.snapshot), true);
  assert.strictEqual(Object.isFrozen(owned.snapshot.price), true);
  assert.strictEqual(app.contentAccess({ type: 'level', setIndex: 1, levelIndex: 4 }, owned.snapshot).allowed, true);
  const cached = app.normalizeEntitlementSnapshot({
    productId: 'full_game_v1', status: 'temporarily_unavailable', source: 'cache',
    transactionId: 'tx-1', verifiedAt: 100, revision: 3, verifiedCache: true
  });
  assert.strictEqual(app.contentAccess({ type: 'iceTrial' }, cached.snapshot).allowed, true);
  const unavailable = app.normalizeEntitlementSnapshot(Object.assign({}, cached.snapshot, {
    revision: 4, verifiedCache: false
  }));
  assert.strictEqual(app.contentAccess({ type: 'iceTrial' }, unavailable.snapshot).allowed, false);
  assert.strictEqual(app.normalizeEntitlementSnapshot({
    productId: 'wrong', status: 'owned_verified', revision: 99
  }).ok, false, 'a different logical product cannot grant access');
  assert.strictEqual(app.normalizeEntitlementSnapshot({
    productId: 'full_game_v1', status: 'owned_verified', source: 'fake', revision: 99
  }).ok, false, 'verified ownership requires a successful verification timestamp');
  assert.strictEqual(app.contentAccess({ type: 'unknown' }, owned.snapshot).reason, 'invalid_content_target');
  assert.strictEqual(compatibility.hasFullGameGate(), false);
  assert.strictEqual(compatibility.contentAccess({ type: 'unknown' }, null).allowed, true);
  assert.strictEqual(compatibility.contentAccess({
    type: 'level', setIndex: 1, levelIndex: 4
  }, null).allowed, true, 'the compatibility/WeChat policy adds no seventh-level commercial gate');
  assert.strictEqual(compatibility.authority(), null);
  assert.strictEqual(compatibility.rewardUnlockOverride(), null);
  assert.strictEqual(compatibility.projectRewardConfig(rewardConfig), rewardConfig,
    'the compatibility policy does not clone or freeze the shared catalog');

  const sourceBefore = JSON.stringify(rewardConfig);
  const projected = app.projectRewardConfig(rewardConfig);
  assert.strictEqual(JSON.stringify(rewardConfig), sourceBefore,
    'App projection never mutates the shared require-cache object');
  assert.deepStrictEqual(projected.items.map(item => [item.id, item.kind, item.itemId]),
    rewardConfig.items.map(item => [item.id, item.kind, item.itemId]));
  const projectedExternal = projected.items.filter((item, index) =>
    ['rewarded_ad', 'share'].includes(rewardConfig.items[index].unlock.type));
  assert.strictEqual(projectedExternal.length, 5);
  projectedExternal.forEach(item => assert.deepStrictEqual(item.unlock, {
    type: 'currency', cost: 10000
  }));
  assert.strictEqual(projected.items.some(item =>
    ['rewarded_ad', 'share'].includes(item.unlock.type)), false);
  assert.strictEqual(Object.isFrozen(projected), true);
  assert.strictEqual(Object.isFrozen(projected.currency), true);
  assert.strictEqual(Object.isFrozen(projected.items), true);
  assert.strictEqual(Object.isFrozen(projected.items[0]), true);
  assert.strictEqual(Object.isFrozen(projected.items[0].unlock), true);
  assert.throws(() => { projected.items[0].id = 'changed'; }, TypeError);

  for (const expectedMatches of [4, 6]) {
    const mismatch = clone(appProductConfig);
    mismatch.rewardUnlockOverride.expectedMatches = expectedMatches;
    assert.throws(() => ProductPolicy.create(mismatch).projectRewardConfig(rewardConfig),
      /expectedMatches/);
  }

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

  const missingOverride = clone(appProductConfig); delete missingOverride.rewardUnlockOverride;
  assert.throws(() => ProductPolicy.create(missingOverride), /app-local-contract/);
  const missingAuthority = clone(appProductConfig); delete missingAuthority.authority;
  assert.throws(() => ProductPolicy.create(missingAuthority), /app-local-contract/);

  for (const mutate of [
    config => { delete config.authority.domains.preferences; },
    config => { config.authority.domains.extra = 'app-local'; },
    config => { config.authority.domains.daily = 'app-local'; },
    config => { config.authority.storageNamespaceId = '   '; },
    config => { config.authority.extra = true; }
  ]) {
    const invalid = clone(appProductConfig); mutate(invalid);
    assert.throws(() => ProductPolicy.create(invalid), /authority/);
  }
  for (const mutate of [
    config => { config.rewardUnlockOverride.sourceTypes.push('share'); },
    config => { config.rewardUnlockOverride.sourceTypes = ['unknown']; },
    config => { config.rewardUnlockOverride.replacement.type = 'share'; },
    config => { config.rewardUnlockOverride.replacement.cost = 0; },
    config => { config.rewardUnlockOverride.expectedMatches = 0; },
    config => { config.rewardUnlockOverride.extra = true; }
  ]) {
    const invalid = clone(appProductConfig); mutate(invalid);
    assert.throws(() => ProductPolicy.create(invalid), /rewardUnlockOverride/);
  }
  const uncovered = clone(appProductConfig);
  uncovered.rewardUnlockOverride.sourceTypes = ['share'];
  uncovered.rewardUnlockOverride.expectedMatches = 1;
  assert.throws(() => ProductPolicy.create(uncovered).projectRewardConfig(rewardConfig), /uncovered/);
  for (const key of ['dailyEnabled', 'adsEnabled', 'rewardedShareEnabled', 'resultShareEnabled']) {
    const conflict = clone(appProductConfig); conflict[key] = true;
    assert.throws(() => ProductPolicy.create(conflict), /app-local-capabilities/);
  }
  const hintConflict = clone(appProductConfig); hintConflict.hintMode = 'tiered';
  assert.throws(() => ProductPolicy.create(hintConflict), /app-local-capabilities|requires-rewarded-share/);
  const noAuthorityFallback = ProductPolicy.create({}, {
    authority: appProductConfig.authority,
    rewardUnlockOverride: appProductConfig.rewardUnlockOverride
  });
  assert.strictEqual(noAuthorityFallback.authority(), null,
    'compatibility fallback cannot activate host authority');
}

module.exports = run;
