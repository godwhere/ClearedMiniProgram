'use strict';

const assert = require('assert');
const gameRuntime = require('../src/runtime/game-runtime.js');
const LocaleService = require('../src/services/locale-service.js');

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
  assert.strictEqual(gameRuntime.runtimeContractVersion, 1);

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
}

module.exports = run;
