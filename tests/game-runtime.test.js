'use strict';

const assert = require('assert');
const gameRuntime = require('../src/runtime/game-runtime.js');
const LocaleService = require('../src/services/locale-service.js');
const HintAccessService = require('../src/services/hint-access-service.js');
const solutions = require('../data/solutions.js');
const appProductConfig = require('./fixtures/app-product-policy.js');
const capabilityOnlyPolicy = Object.freeze({
  dailyEnabled: appProductConfig.dailyEnabled,
  adsEnabled: appProductConfig.adsEnabled,
  rewardedShareEnabled: appProductConfig.rewardedShareEnabled,
  resultShareEnabled: appProductConfig.resultShareEnabled,
  hintMode: appProductConfig.hintMode,
  freeLevelKeys: appProductConfig.freeLevelKeys,
  fullGameEntitlementId: appProductConfig.fullGameEntitlementId,
  iceTrialRequiresFullGame: appProductConfig.iceTrialRequiresFullGame
});

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function testPlatform(options) {
  const opts = options || {};
  const storage = clone(opts.storage || {});
  const events = [];
  const context = new Proxy({}, { get: (target, key) => target[key] || function () {} });
  const platform = {
    context,
    metrics: { width: 390, height: 844, dpr: 2, safeTop: 47, safeBottom: 810 },
    storage,
    events,
    getSystemLanguage() { return opts.language || 'en-US'; },
    getStorage(key) { return Object.prototype.hasOwnProperty.call(storage, key) ? clone(storage[key]) : null; },
    readStorageResult(key) {
      return Object.prototype.hasOwnProperty.call(storage, key)
        ? { ok: true, found: true, value: clone(storage[key]) }
        : { ok: true, found: false };
    },
    setStorage(key, value) {
      if (opts.failWrites === true) return false;
      storage[key] = clone(value);
      return true;
    },
    bindPointer(handlers) {
      events.push('pointer-bound');
      this.pointerHandlers = handlers;
      return () => { events.push('pointer-unbound'); this.pointerHandlers = null; };
    },
    bindLifecycle(handlers) {
      events.push('lifecycle-bound');
      this.lifecycleHandlers = handlers;
      return () => { events.push('lifecycle-unbound'); this.lifecycleHandlers = null; };
    },
    startLoop(callback) { events.push('loop-started'); this.frame = callback; },
    stopLoop() { events.push('loop-stopped'); this.frame = null; },
    createAudioContext() { return null; },
    supportsRewardedVideoAd() { return false; },
    createInterstitialAd() { return null; },
    createImage(source, callback) {
      const image = { src: source, width: 1, height: 1 };
      if (callback) callback(null, image);
      return image;
    },
    triggerHaptic() {},
    getLaunchOptions() { return { scene: 1001 }; },
    getEnterOptions() { return {}; },
    openPrivacyContract() { return Promise.resolve({ ok: false, reason: 'not-supported' }); }
  };
  return platform;
}

function run() {
  assert.strictEqual(gameRuntime.runtimeContractVersion, 5);

  const platform = testPlatform({ language: 'zh-Hans' });
  const local = gameRuntime.createLocalServices(platform, {
    dailyTimeZone: 'Asia/Shanghai'
  });
  assert.strictEqual(local.locale.current(), 'zh-CN');
  assert.strictEqual(local.locale.hasExplicitPreference(), false);
  assert.strictEqual(local.subpackages, null);

  const calls = { installed: 0, captured: null, uninstalled: 0 };
  const share = {
    install(context) { calls.installed++; this.context = context; },
    captureEntry(options) { calls.captured = clone(options); },
    uninstall() { calls.uninstalled++; }
  };
  const authoritativeApplier = {};
  const economy = {};
  const progressSync = {};
  const app = gameRuntime.startGame(platform, {
    appOptions: Object.assign({}, local, {
      share,
      authoritativeApplier,
      economy,
      progressSync
    }),
    launchOptions: { scene: 1007, query: { source: 'runtime-test' } }
  });

  assert.strictEqual(app.scene, 'home');
  assert.strictEqual(app.locale, local.locale);
  assert.strictEqual(app.renderer.locale, local.locale);
  assert.strictEqual(local.preferences.bound.skins, app.skins);
  assert.strictEqual(authoritativeApplier.accountGuard, app.accountGuard);
  assert.strictEqual(economy.accountGuard, app.accountGuard);
  assert.strictEqual(typeof progressSync.prepareMigrationSnapshot, 'function');
  assert.deepStrictEqual(calls, {
    installed: 1,
    captured: { scene: 1007, query: { source: 'runtime-test' } },
    uninstalled: 0
  });
  assert.deepStrictEqual(platform.events.slice(0, 3), [
    'pointer-bound', 'lifecycle-bound', 'loop-started'
  ]);
  app.start();
  assert.strictEqual(platform.events.filter(event => event === 'pointer-bound').length, 1,
    'starting an already-mounted App does not add duplicate listeners');

  const selected = local.locale.select('en-US');
  assert.deepStrictEqual(selected, { ok: true, persisted: true, locale: 'en-US' });
  assert.strictEqual(app.t('home.tagline'), 'CLEARED!');
  app.dispose();
  app.dispose();
  assert.strictEqual(calls.uninstalled, 1);
  assert(platform.events.includes('pointer-unbound'));
  assert(platform.events.includes('lifecycle-unbound'));
  assert(platform.events.includes('loop-stopped'));

  const restored = gameRuntime.createLocalServices(testPlatform({
    language: 'zh-Hans',
    storage: platform.storage
  }));
  assert.strictEqual(restored.locale.current(), 'en-US');
  assert.strictEqual(restored.locale.hasExplicitPreference(), true);

  const failedPlatform = testPlatform({ language: 'zh-Hans', failWrites: true });
  const failedLocale = gameRuntime.createLocalServices(failedPlatform).locale;
  assert.deepStrictEqual(failedLocale.select('en-US'), {
    ok: false,
    persisted: false,
    locale: 'en-US',
    reason: 'storage-write-failed'
  });
  assert.strictEqual(failedLocale.current(), 'en-US');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(
    failedPlatform.storage,
    LocaleService.STORAGE_KEY
  ), false);

  const appPlatform = testPlatform({ language: 'en-US' });
  const fullGameStore = {};
  const appLocal = gameRuntime.createLocalServices(appPlatform, {
    productPolicy: capabilityOnlyPolicy,
    fullGameStore,
    dailyStore: { forbidden: true },
    hintAccess: { forbidden: true }
  });
  assert.strictEqual(appLocal.dailyStore, null);
  assert.strictEqual(appLocal.hintAccess, null);
  assert.strictEqual(appLocal.fullGameStore, fullGameStore);
  assert.strictEqual(appLocal.contentAccess({ type: 'level', setIndex: 0, levelIndex: 0 },
    appLocal.productPolicy.defaultEntitlementSnapshot()).allowed, true);
  assert.deepStrictEqual(appLocal.productPolicy.capabilities, {
    dailyEnabled: false,
    adsEnabled: false,
    rewardedShareEnabled: false,
    resultShareEnabled: false,
    hintMode: 'free'
  });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(
    appPlatform.storage,
    HintAccessService.STORAGE_KEY
  ), false, 'free hints do not create a daily hint-access record');

  const forbidden = { daily: 0, ads: 0, share: 0, rewards: 0, engagement: 0 };
  const appMode = gameRuntime.startGame(appPlatform, {
    productPolicy: capabilityOnlyPolicy,
    appOptions: Object.assign({}, appLocal, {
      solutionCatalog: solutions,
      dailyService: { resolve() { forbidden.daily++; return null; } },
      dailyStore: { exportRewardCompletions() { forbidden.daily++; return { ok: true, days: [] }; } },
      ads: { onLevelCompleted() { forbidden.ads++; } },
      share: {
        install() { forbidden.share++; },
        isResultEnabled() { forbidden.share++; return true; }
      },
      rewards: { recover() { forbidden.rewards++; return Promise.resolve({ grants: [] }); } },
      engagement: {
        hintState() { forbidden.engagement++; return { mode: 'share', action: 'share' }; },
        requestHint() { forbidden.engagement++; return { granted: false }; }
      }
    })
  });
  assert.strictEqual(appMode.dailyService, null);
  assert.strictEqual(appMode.fullGameStore, fullGameStore);
  assert.strictEqual(appMode.dailyProgress, null);
  assert.strictEqual(appMode.dailyManifest, null);
  assert.strictEqual(appMode.dailySolutions, null);
  assert.strictEqual(appMode.ads, null);
  assert.strictEqual(appMode.share, null);
  assert.strictEqual(appMode.rewards, null);
  assert.strictEqual(appMode.hintAccess, null);
  assert.strictEqual(appMode.engagement.ads, null);
  assert.strictEqual(appMode.engagement.share, null);
  assert.strictEqual(appMode.engagement.rewards, null);
  assert.strictEqual(appMode.engagement.hintAccess, null);
  assert.deepStrictEqual(forbidden, { daily: 0, ads: 0, share: 0, rewards: 0, engagement: 0 });

  appMode.tick(Date.now());
  const model = appMode.buildModel();
  assert.strictEqual(model.productCapabilities, appMode.productCapabilities);
  assert.strictEqual(model.dailyAvailable, false);
  assert.strictEqual(model.shareAvailable, false);
  assert(!appMode.renderer.hits.some(hit => hit.id === 'home:dailyChallenge'));
  assert(!appMode.renderer.hits.some(hit => hit.id === 'daily:extraEntry'));
  assert.strictEqual(appMode.performAction('home:dailyChallenge'), false);
  assert.strictEqual(appMode.performAction('home:daily'), false);
  assert.strictEqual(appMode.performAction('daily:extraEntry'), false);
  assert.strictEqual(appMode.performAction('result:share'), false);

  assert.strictEqual(appMode.openRewardDialog('theme:ocean'), true);
  assert.strictEqual(appMode.rewardDialog.conditionType, 'rewarded_ad');
  assert.strictEqual(appMode.rewardDialog.primaryAction, null);
  appMode.tick(Date.now() + 1);
  assert(!appMode.renderer.hits.some(hit => hit.id === 'reward:unlock'));
  assert.strictEqual(appMode.performAction('reward:unlock'), false);
  assert.strictEqual(appMode.performAction('reward:close'), true);
  assert.strictEqual(appMode.openRewardDialog('theme:festival'), true);
  assert.strictEqual(appMode.rewardDialog.conditionType, 'share');
  assert.strictEqual(appMode.rewardDialog.primaryAction, null);
  assert.strictEqual(appMode.performAction('reward:unlock'), false);
  assert.strictEqual(appMode.performAction('reward:close'), true);

  assert.strictEqual(appMode.openLevel(0, 0), true);
  appMode.performAction('play:hint');
  assert(appMode.hintPreview,
    'ordinary hints use the local free path without an access ledger');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(
    appPlatform.storage,
    HintAccessService.STORAGE_KEY
  ), false);
  assert.strictEqual(appMode.progress.recordCompletion(0, 0, 1000).firstClear, true);
  assert.strictEqual(appMode.progress.save(), true);
  const recovered = appMode.recoverRewardUnlocks();
  assert.strictEqual(recovered.ok, true);
  assert.strictEqual(appMode.rewardUnlocks.view().balance, 100,
    'the disabled daily completion source does not block ordinary reconciliation');
  assert.deepStrictEqual(forbidden, { daily: 0, ads: 0, share: 0, rewards: 0, engagement: 0 });
  appMode.dispose();
}

module.exports = run;
