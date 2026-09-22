'use strict';

const assert = require('assert');
const ClearedApp = require('../src/app.js');
const gameRuntime = require('../src/runtime/game-runtime.js');
const rewardConfig = require('../src/config/rewards.js');
const RewardUnlockService = require('../src/services/reward-unlock-service.js');
const StaminaService = require('../src/services/stamina-service.js');
const appProductConfig = require('./fixtures/app-product-policy.js');
const { FakeFullGameStore, snapshot } = require('./helpers/fake-full-game-store.js');

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function productConfig(namespaceId) {
  const config = clone(appProductConfig);
  config.authority.storageNamespaceId = namespaceId;
  return config;
}

function testPlatform(backing, namespaceId, options) {
  const opts = options || {};
  if (!backing[namespaceId]) backing[namespaceId] = {};
  const storage = backing[namespaceId];
  const calls = { namespace: 0, reads: 0, writes: 0, listeners: 0, loops: 0 };
  const failedKeys = new Set();
  const context = new Proxy({}, { get: (target, key) => target[key] || function () {} });
  const platform = {
    context,
    metrics: { width: 390, height: 844, dpr: 2, safeTop: 47, safeBottom: 810 },
    calls,
    storage,
    failedKeys,
    storageNamespace() {
      calls.namespace++;
      if (opts.namespaceThrows) throw new Error('namespace unavailable');
      if (opts.namespacePromise) return Promise.resolve({ id: namespaceId, isolated: true });
      return { id: opts.reportedId || namespaceId, isolated: opts.isolated !== false };
    },
    getSystemLanguage() { return 'en-US'; },
    getStorage(key) {
      calls.reads++;
      return Object.prototype.hasOwnProperty.call(storage, key) ? clone(storage[key]) : null;
    },
    readStorageResult(key) {
      calls.reads++;
      return Object.prototype.hasOwnProperty.call(storage, key)
        ? { ok: true, found: true, value: clone(storage[key]) }
        : { ok: true, found: false };
    },
    setStorage(key, value) {
      calls.writes++;
      if (failedKeys.has(key)) return false;
      storage[key] = clone(value);
      return true;
    },
    bindPointer(handlers) {
      calls.listeners++;
      this.pointerHandlers = handlers;
      return () => { calls.listeners--; this.pointerHandlers = null; };
    },
    bindLifecycle(handlers) {
      calls.listeners++;
      this.lifecycleHandlers = handlers;
      return () => { calls.listeners--; this.lifecycleHandlers = null; };
    },
    startLoop(callback) { calls.loops++; this.frame = callback; },
    stopLoop() { calls.loops--; this.frame = null; },
    createAudioContext() { return null; },
    supportsRewardedVideoAd() { return false; },
    createInterstitialAd() { return null; },
    createImage(source, callback) {
      const image = { src: source, width: 1, height: 1 };
      if (callback) callback(null, image);
      return image;
    },
    triggerHaptic() {},
    getLaunchOptions() { return {}; },
    getEnterOptions() { return {}; },
    openPrivacyContract() { return Promise.resolve({ ok: false, reason: 'not-supported' }); }
  };
  return platform;
}

function createApp(platform, config, fullGameStore) {
  const local = gameRuntime.createLocalServices(platform, {
    productPolicy: config,
    fullGameStore: fullGameStore || null
  });
  const app = gameRuntime.startGame(platform, { appOptions: local });
  return { local, app };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

async function run() {
  const namespace = 'cleared-app-test-v1';
  const config = productConfig(namespace);

  for (const variant of [
    { missing: true, error: /namespace-required/ },
    { options: { reportedId: 'wrong' }, error: /namespace-mismatch/ },
    { options: { isolated: false }, error: /namespace-mismatch/ },
    { options: { namespaceThrows: true }, error: /namespace-unavailable/ },
    { options: { namespacePromise: true }, error: /namespace-mismatch/ }
  ]) {
    const backing = {};
    const platform = testPlatform(backing, namespace, variant.options);
    if (variant.missing) delete platform.storageNamespace;
    assert.throws(() => gameRuntime.createLocalServices(platform, { productPolicy: config }), variant.error);
    assert.deepStrictEqual({ reads: platform.calls.reads, writes: platform.calls.writes,
      listeners: platform.calls.listeners, loops: platform.calls.loops },
    { reads: 0, writes: 0, listeners: 0, loops: 0 },
    'namespace failure occurs before business storage or App side effects');
  }

  {
    const backing = {};
    const platform = testPlatform(backing, namespace);
    assert.throws(() => gameRuntime.createLocalServices(platform, {
      productPolicy: config,
      dailyStore: { forbidden: true }
    }), /forbidden-dependency:dailyStore/);
    assert.deepStrictEqual(platform.calls, {
      namespace: 0, reads: 0, writes: 0, listeners: 0, loops: 0
    });
  }

  {
    const backing = {};
    const platform = testPlatform(backing, namespace);
    const incompleteRewards = clone(rewardConfig);
    incompleteRewards.items = incompleteRewards.items.filter(item => item.id !== 'theme:festival');
    assert.throws(() => gameRuntime.createLocalServices(platform, {
      productPolicy: config,
      rewardConfig: incompleteRewards
    }), /expectedMatches/);
    assert.strictEqual(platform.calls.reads, 0);
    assert.strictEqual(platform.calls.writes, 0);
  }

  {
    const backing = {};
    const platform = testPlatform(backing, namespace);
    const malformedRewards = clone(rewardConfig);
    malformedRewards.items[0].id = 'invalid:classic';
    assert.throws(() => gameRuntime.createLocalServices(platform, {
      productPolicy: config,
      rewardConfig: malformedRewards
    }), /reward-config-mismatch/);
    assert.strictEqual(platform.calls.reads, 0,
      'the complete projected reward schema is checked before any business read');
    assert.strictEqual(platform.calls.writes, 0);
  }

  {
    const backing = {};
    const platform = testPlatform(backing, namespace);
    assert.throws(() => gameRuntime.startGame(platform, {
      productPolicy: config,
      appOptions: {}
    }), /services-required/);
    assert.strictEqual(platform.calls.reads, 0);
    assert.strictEqual(platform.calls.writes, 0);
    assert.strictEqual(platform.calls.listeners, 0);
  }

  {
    const backing = {};
    const platform = testPlatform(backing, namespace);
    const local = gameRuntime.createLocalServices(platform, { productPolicy: config });
    const cheapRewards = clone(local.productPolicy.projectRewardConfig(rewardConfig));
    cheapRewards.items.forEach(item => {
      if (['theme:ocean', 'theme:spring', 'theme:music', 'theme:vehicles',
        'theme:festival'].includes(item.id)) item.unlock.cost = 1;
    });
    const cheapService = new RewardUnlockService(platform, cheapRewards, { authorityMode: 'app-local' });
    assert.throws(() => gameRuntime.startGame(platform, {
      appOptions: Object.assign({}, local, { rewardUnlocks: cheapService })
    }), /reward-projection-missing/);
    assert.strictEqual(platform.calls.listeners, 0);
    assert.strictEqual(platform.calls.loops, 0);
  }

  {
    const backing = {};
    const platform = testPlatform(backing, namespace);
    const local = gameRuntime.createLocalServices(platform, { productPolicy: config });
    const conflicting = productConfig(namespace);
    conflicting.freeLevelKeys = conflicting.freeLevelKeys.slice(0, 1);
    assert.throws(() => gameRuntime.startGame(platform, {
      productPolicy: conflicting,
      appOptions: local
    }), /product-policy-mismatch/);
    assert.strictEqual(platform.calls.listeners, 0);
    assert.strictEqual(platform.calls.loops, 0);
    const extraAuthority = Object.assign({}, local.authority, { unexpected: true });
    assert.throws(() => gameRuntime.startGame(platform, {
      appOptions: Object.assign({}, local, { authority: extraAuthority })
    }), /authority-mismatch/);
  }

  {
    const backing = {};
    const platform = testPlatform(backing, namespace);
    const local = gameRuntime.createLocalServices(platform, { productPolicy: config });
    const store = new FakeFullGameStore(snapshot({ revision: 1 }));
    const app = gameRuntime.startGame(platform, {
      appOptions: Object.assign({}, local, {
        fullGameStore: store,
        contentAccess() { return { allowed: true, reason: 'stale-bypass' }; }
      })
    });
    assert.strictEqual(app.checkContentAccess({ type: 'level', setIndex: 1, levelIndex: 4 }).allowed, false,
      'the normalized product policy remains the only commercial gate');
    app.dispose();
  }

  {
    const noticeNamespace = 'cleared-app-notice-test-v1';
    const backing = {};
    const platform = testPlatform(backing, noticeNamespace);
    const runtime = createApp(platform, productConfig(noticeNamespace));
    const { app } = runtime;
    const rewardId = 'theme:ocean';
    app.rewardUnlocks.state.balance = 10000;
    assert.strictEqual(app.rewardUnlocks.purchase(rewardId).ok, true);
    assert(app.rewardUnlocks.pendingNotices().includes(rewardId));
    assert.strictEqual(app.openRewardDialog(rewardId, 'unlocked'), true);

    app.rewardUnlocks._authorityMode = 'migration-freeze';
    const mismatchDialog = clone(app.rewardDialog);
    const mismatchWrites = platform.calls.writes;
    assert.strictEqual(app.dismissRewardDialog(), false);
    assert.deepStrictEqual(clone(app.rewardDialog), mismatchDialog);
    assert.strictEqual(platform.calls.writes, mismatchWrites);
    assert(app.rewardUnlocks.pendingNotices().includes(rewardId));
    assert.strictEqual(app.dismissedRewardNotices.has(rewardId), false);

    app.rewardUnlocks._authorityMode = 'app-local';
    platform.failedKeys.add(RewardUnlockService.STORAGE_KEY);
    assert.strictEqual(app.dismissRewardDialog(), false);
    assert.strictEqual(app.rewardDialog.state, 'error');
    assert(app.rewardUnlocks.pendingNotices().includes(rewardId));
    assert.strictEqual(app.dismissedRewardNotices.has(rewardId), false);
    platform.failedKeys.delete(RewardUnlockService.STORAGE_KEY);
    assert.strictEqual(app.dismissRewardDialog(), true);
    assert.strictEqual(app.rewardDialog, null);
    assert(!app.rewardUnlocks.pendingNotices().includes(rewardId));
    assert.strictEqual(app.dismissedRewardNotices.has(rewardId), true);
    app.dispose();
  }

  for (const [index, guard] of [
    { mode: 'migration-freeze', pendingBackupRestore: false },
    { mode: 'legacy-local', pendingBackupRestore: true }
  ].entries()) {
    const guardedNamespace = `cleared-app-theme-guard-${index}`;
    const backing = {};
    const platform = testPlatform(backing, guardedNamespace);
    let finishDownload;
    const subpackages = {
      packageForTheme(skinId) { return skinId === 'gem' ? 'theme-gem' : null; },
      isPackageReady() { return false; },
      isAssetReady() { return true; },
      ensureTheme() { return new Promise(resolve => { finishDownload = resolve; }); }
    };
    const local = gameRuntime.createLocalServices(platform, {
      productPolicy: productConfig(guardedNamespace),
      subpackages
    });
    local.rewardUnlocks.state.ownedRewards['theme:gem'] = true;
    const app = gameRuntime.startGame(platform, { appOptions: local });
    assert.strictEqual(app.setSkin('gem'), true);
    app.syncStore = {
      authorityMode() { return guard.mode; },
      currentScope() { return { pendingBackupRestore: guard.pendingBackupRestore }; }
    };
    finishDownload();
    await flush();
    assert.strictEqual(app.skins.current().id, 'classic',
      'an in-flight package cannot save after migration/restore protection activates');
    assert.strictEqual(app.progress.getSetting('skinId', 'classic'), 'classic');
    assert.strictEqual(app.pendingSkinId, null);
    app.dispose();
  }

  {
    const backing = {};
    const platform = testPlatform(backing, namespace);
    const local = gameRuntime.createLocalServices(platform, { productPolicy: config });
    const mutableAuthority = clone(local.authority);
    const app = new ClearedApp(platform, Object.assign({}, local, { authority: mutableAuthority }));
    mutableAuthority.domains.stamina = 'unknown';
    mutableAuthority.storageNamespaceId = 'mutated';
    assert.strictEqual(app.authorityMode(app.stamina, 'stamina'), 'app-local',
      'App retains the normalized frozen construction authority');
    assert.strictEqual(app.localAuthority.storageNamespaceId, namespace);
    app.dispose();
  }

  {
    const backing = {};
    const platform = testPlatform(backing, 'compatibility');
    delete platform.storageNamespace;
    const local = gameRuntime.createLocalServices(platform, {});
    assert.strictEqual(local.authority, null);
    assert.strictEqual(local.rewardUnlocks.authorityMode(), 'legacy-local');
    assert.strictEqual(local.stamina.authorityMode(), 'legacy-local');
  }

  const sharedBacking = {};
  const platform = testPlatform(sharedBacking, namespace);
  const store = new FakeFullGameStore(snapshot({ revision: 1 }));
  const sourceRewardConfig = JSON.stringify(rewardConfig);
  const runtime = createApp(platform, config, store);
  const { local, app } = runtime;
  await flush();
  assert.strictEqual(JSON.stringify(rewardConfig), sourceRewardConfig);
  assert.strictEqual(local.authority.storageNamespaceId, namespace);
  assert.strictEqual(local.rewardUnlocks.authorityMode(), 'app-local');
  assert.strictEqual(local.stamina.authorityMode(), 'app-local');
  assert.strictEqual(app.authorityMode(null, 'progress'), 'app-local');
  assert.strictEqual(app.authorityMode(null, 'daily'), 'disabled');
  assert.strictEqual(app.authorityMode(app.rewardUnlocks, 'economy'), 'app-local');
  assert.strictEqual(app.authorityMode(app.stamina, 'stamina'), 'app-local');
  assert.strictEqual(app.syncStore, null);
  assert.strictEqual(app.progressSync, null);
  assert.strictEqual(app.dailyProgress, null);
  assert.strictEqual(app.ads, null);
  assert.strictEqual(app.share, null);
  assert.strictEqual(app.rewards, null);
  assert.strictEqual(app.hintAccess, null);

  const projectedIds = rewardConfig.items.filter(item =>
    ['rewarded_ad', 'share'].includes(item.unlock.type)).map(item => item.id);
  assert.strictEqual(projectedIds.length, 5);
  projectedIds.forEach(id => {
    const status = app.rewardUnlocks.status(id);
    assert.strictEqual(status.conditionType, 'currency');
    assert.strictEqual(status.cost, 10000);
  });

  const assetsBeforeEntitlement = {
    progress: clone(app.progress.state),
    rewards: clone(app.rewardUnlocks.view()),
    stamina: clone(app.stamina.snapshot()),
    locale: app.locale.current()
  };
  store.publish(snapshot({ status: 'owned_verified', revision: 2,
    transactionId: 'owned-app', verifiedAt: 200 }));
  assert.deepStrictEqual({
    progress: clone(app.progress.state),
    rewards: clone(app.rewardUnlocks.view()),
    stamina: clone(app.stamina.snapshot()),
    locale: app.locale.current()
  }, assetsBeforeEntitlement, 'full-game ownership changes only commercial access');

  const originalCreateRunner = app.createOrdinaryRunner.bind(app);
  let runnerCalls = 0;
  app.createOrdinaryRunner = context => { runnerCalls++; return originalCreateRunner(context); };
  app.stamina._authorityMode = 'migration-freeze';
  const writesBeforeMismatch = platform.calls.writes;
  assert.strictEqual(app.openLevel(0, 0), false);
  assert.strictEqual(runnerCalls, 0, 'authority mismatch fails before Runner construction');
  assert.strictEqual(platform.calls.writes, writesBeforeMismatch);
  assert.strictEqual(app.runner, null);
  app.stamina._authorityMode = 'app-local';
  assert.strictEqual(app.openLevel(0, 0), true);
  assert.strictEqual(app.stamina.snapshot().balance, 4);

  const authorityBeforePreference = app.localAuthority;
  const invalidDomains = Object.assign({}, authorityBeforePreference.domains, { preferences: 'unknown' });
  app.localAuthority = Object.assign({}, authorityBeforePreference, { domains: invalidDomains });
  const soundBefore = app.progress.getSetting('soundEnabled', true);
  const preferenceWrites = platform.calls.writes;
  assert.strictEqual(app.performAction('play:sound'), false);
  assert.strictEqual(app.progress.getSetting('soundEnabled', true), soundBefore);
  assert.strictEqual(platform.calls.writes, preferenceWrites);
  app.localAuthority = authorityBeforePreference;
  const preferencesBefore = app.preferences;
  app.preferences = null;
  assert.strictEqual(app.performAction('play:sound'), false);
  assert.strictEqual(platform.calls.writes, preferenceWrites);
  app.preferences = preferencesBefore;

  assert.strictEqual(app.openRewardDialog(projectedIds[0]), true);
  const dialogBefore = clone(app.rewardDialog);
  app.rewardUnlocks._authorityMode = 'migration-freeze';
  assert.strictEqual(app.requestRewardUnlock(false), false);
  assert.deepStrictEqual(clone(app.rewardDialog), dialogBefore,
    'reward authority mismatch is rejected before dialog state changes');
  app.rewardUnlocks._authorityMode = 'app-local';
  app.dismissRewardDialog();

  const syncStore = { authorityMode() { return 'cloud-authoritative'; } };
  app.syncStore = syncStore;
  assert.strictEqual(app.authorityMode(app.stamina, 'stamina'), 'cloud-authoritative',
    'SyncStore remains authoritative when present');
  app.syncStore = null;

  assert.strictEqual(app.progress.recordCompletion(0, 0, 60001).firstClear, true);
  assert.strictEqual(app.progress.save(), true);
  platform.failedKeys.add(RewardUnlockService.STORAGE_KEY);
  const failedReward = app.recoverRewardUnlocks();
  assert.strictEqual(failedReward.reason, 'persist-failed');
  assert.strictEqual(app.rewardUnlocks.view().balance, 0);
  platform.failedKeys.delete(RewardUnlockService.STORAGE_KEY);
  app.dispose();

  const recoveredPlatform = testPlatform(sharedBacking, namespace);
  const recovered = createApp(recoveredPlatform, config, store);
  assert.strictEqual(recovered.app.rewardUnlocks.view().balance, 100,
    'restart repairs a reward whose progress fact was already persisted');
  recovered.app.dispose();
  const repeatedPlatform = testPlatform(sharedBacking, namespace);
  const repeated = createApp(repeatedPlatform, config, store);
  assert.strictEqual(repeated.app.rewardUnlocks.view().balance, 100);
  const rewardWritesBefore = repeatedPlatform.calls.writes;
  assert.strictEqual(repeated.app.recoverRewardUnlocks().amountDelta, 0);
  assert.strictEqual(repeatedPlatform.calls.writes, rewardWritesBefore,
    'the recovered completion is not granted twice');
  repeated.app.dispose();

  const otherNamespace = 'cleared-app-test-v2';
  const isolatedPlatform = testPlatform(sharedBacking, otherNamespace);
  const isolated = createApp(isolatedPlatform, productConfig(otherNamespace));
  assert.strictEqual(isolated.app.progress.isCompleted(0, 0), false);
  assert.strictEqual(isolated.app.rewardUnlocks.view().balance, 0);
  assert.strictEqual(isolated.app.stamina.snapshot().balance, 5);
  isolated.app.dispose();

  const refundNamespace = 'cleared-app-refund-test-v1';
  const refundPlatform = testPlatform(sharedBacking, refundNamespace);
  const refundRuntime = createApp(refundPlatform, productConfig(refundNamespace));
  assert.strictEqual(refundRuntime.app.openLevel(0, 0), true);
  assert.strictEqual(refundRuntime.app.progress.recordCompletion(0, 0, 1000).firstClear, true);
  assert.strictEqual(refundRuntime.app.progress.save(), true);
  refundPlatform.failedKeys.add(StaminaService.STORAGE_KEY);
  assert.strictEqual(refundRuntime.app.stamina.refundQuickClear('0:0', 1000).reason,
    'refund-persist-failed');
  assert.strictEqual(refundRuntime.app.stamina.snapshot().balance, 4);
  refundRuntime.app.dispose();
  refundPlatform.failedKeys.delete(StaminaService.STORAGE_KEY);
  const refundRecoveredPlatform = testPlatform(sharedBacking, refundNamespace);
  const refundRecovered = createApp(refundRecoveredPlatform, productConfig(refundNamespace));
  assert.strictEqual(refundRecovered.app.stamina.snapshot().balance, 5);
  assert.strictEqual(refundRecovered.app.stamina.quickClearRefundState('0:0').status, 'claimed');
  refundRecovered.app.dispose();
  const refundRepeatedPlatform = testPlatform(sharedBacking, refundNamespace);
  const refundRepeated = createApp(refundRepeatedPlatform, productConfig(refundNamespace));
  assert.strictEqual(refundRepeated.app.stamina.snapshot().balance, 5);
  refundRepeated.app.dispose();

  const startGuardPlatform = testPlatform({}, namespace);
  const startGuardLocal = gameRuntime.createLocalServices(startGuardPlatform, { productPolicy: config });
  const beforeStartGuard = clone(startGuardPlatform.calls);
  assert.throws(() => gameRuntime.startGame(startGuardPlatform, {
    appOptions: Object.assign({}, startGuardLocal, { auth: { forbidden: true } })
  }), /forbidden-dependency:auth/);
  assert.strictEqual(startGuardPlatform.calls.reads, beforeStartGuard.reads);
  assert.strictEqual(startGuardPlatform.calls.writes, beforeStartGuard.writes);
  assert.strictEqual(startGuardPlatform.calls.listeners, 0);
  assert.strictEqual(startGuardPlatform.calls.loops, 0);
}

module.exports = run;
