'use strict';

const assert = require('assert');
const ClearedApp = require('../src/app.js');
const ProgressStore = require('../src/services/progress-store.js');
const DailyProgressStore = require('../src/services/daily-progress-store.js');
const RewardUnlockService = require('../src/services/reward-unlock-service.js');
const WechatPlatform = require('../src/platform/wechat.js');
const dailySolutions = require('../data/daily-solutions.js');
const { createUnlimitedStaminaFixture } = require('./helpers/stamina-fixture.js');

function createPlatform() {
  const storage = {};
  const writeFailures = new Set();
  const context = {};
  ['save', 'restore', 'clearRect', 'fillRect', 'beginPath', 'moveTo', 'lineTo',
    'quadraticCurveTo', 'closePath', 'fill', 'stroke', 'arc', 'translate',
    'drawImage', 'fillText', 'scale', 'strokeRect'].forEach(method => { context[method] = function () {}; });
  const canvas = { getContext: () => context, requestAnimationFrame: () => 1,
    cancelAnimationFrame() {}, createImage() { const image = {}; Object.defineProperty(image, 'src', { set() { if (image.onload) image.onload(); } }); return image; } };
  const api = {
    storage,
    createCanvas: () => canvas,
    getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 2,
      safeArea: { top: 44, bottom: 810 } }),
    getMenuButtonBoundingClientRect: () => ({ bottom: 40 }),
    getStorageSync: key => storage[key] || null,
    getStorageInfoSync: () => ({ keys: Object.keys(storage) }),
    setStorageSync(key, value) {
      if (writeFailures.has(key)) throw new Error('storage unavailable');
      storage[key] = JSON.parse(JSON.stringify(value));
    },
    createInnerAudioContext: () => ({ play: () => Promise.resolve(), pause() {}, stop() {}, seek() {}, destroy() {}, onError() {} }),
    vibrateShort() {}, onTouchStart() {}, onTouchMove() {}, onTouchEnd() {}, onTouchCancel() {}, onHide() {}, onShow() {}, onWindowResize() {}
  };
  return { platform: new WechatPlatform(api), storage,
    failStorage(key, failed) { if (failed) writeFailures.add(key); else writeFailures.delete(key); } };
}

function solveDailyLevel(app) {
  app.tick(Date.now() + 1000);
  const level = app.daily.challenge;
  const board = app.renderer.boardLayout;
  dailySolutions.ByChallengeId[app.daily.challengeId].forEach(path => {
    const point = index => ({ x: board.x + (index % level.Width + 0.5) * board.cell,
      y: board.y + (Math.floor(index / level.Width) + 0.5) * board.cell, id: 11 });
    app.onPointerStart(point(path[0]));
    path.slice(1).forEach(index => app.onPointerMove(point(index)));
    app.onPointerEnd(point(path[path.length - 1]));
  });
}

function completeTraining(app) {
  assert.strictEqual(app.openLevel(0, 0), true);
  const runner = app.runner;
  assert.strictEqual(runner.touchStart(0), true);
  [1, 2, 3, 4].forEach(cell => assert.strictEqual(runner.touchMove(cell), true));
  runner.touchEnd(4);
  app.onPathCompleted(0, [0, 1, 2, 3, 4]);
}

function freshProgress(overrides) {
  return Object.assign({
    schemaVersion: 2,
    completed: {}, bestMs: {}, lastPlayed: null,
    settings: { skinId: 'classic', clearEffectId: 'none', soundEnabled: true },
    stats: { totalClears: 0 }
  }, overrides || {});
}

function testCompletionRewardRetry() {
  const fixture = createPlatform();
  fixture.storage[ProgressStore.STORAGE_KEY] = freshProgress({ completed: { '0:0': false } });
  const app = new ClearedApp(fixture.platform, { stamina: createUnlimitedStaminaFixture() });
  assert(app.progress instanceof ProgressStore);
  assert(app.rewardUnlocks instanceof RewardUnlockService);
  fixture.failStorage(ProgressStore.STORAGE_KEY, true);
  completeTraining(app);
  assert.deepStrictEqual(app.result.currencyReward, { status: 'pending', amount: 0 });
  assert.strictEqual(app.rewardUnlocks.view().balance, 0);
  assert.strictEqual(fixture.storage[ProgressStore.STORAGE_KEY].completed['0:0'], false);

  assert.strictEqual(app.performAction('reward:retry'), false, 'a source save failure keeps retry available');
  assert.deepStrictEqual(app.result.currencyReward, { status: 'pending', amount: 0 });
  assert.strictEqual(app.rewardUnlocks.view().balance, 0);
  assert.strictEqual(fixture.storage[ProgressStore.STORAGE_KEY].completed['0:0'], false);
  app.recoverRewardUnlocks();
  assert.deepStrictEqual(app.result.currencyReward, { status: 'pending', amount: 0 },
    'a successful scan without this saved completion is not proof of an earlier claim');

  fixture.failStorage(ProgressStore.STORAGE_KEY, false);
  assert.strictEqual(app.performAction('reward:retry'), true);
  assert.strictEqual(fixture.storage[ProgressStore.STORAGE_KEY].completed['0:0'], true);
  assert.strictEqual(app.rewardUnlocks.view().balance, 100);
  assert.strictEqual(fixture.storage[RewardUnlockService.STORAGE_KEY].claimedOrdinary['0:0'], true);
  assert.deepStrictEqual(app.result.currencyReward, { status: 'granted', amount: 100 });
  assert.strictEqual(app.performAction('reward:retry'), true);
  assert.strictEqual(app.rewardUnlocks.view().balance, 100);
  completeTraining(app);
  assert.deepStrictEqual(app.result.currencyReward, { status: 'already-claimed', amount: 0 });
  assert.strictEqual(app.rewardUnlocks.view().balance, 100, 'replay cannot repeat the recovered grant');

  const walletFixture = createPlatform();
  const walletApp = new ClearedApp(walletFixture.platform, { stamina: createUnlimitedStaminaFixture() });
  walletFixture.failStorage(RewardUnlockService.STORAGE_KEY, true);
  completeTraining(walletApp);
  assert.strictEqual(walletFixture.storage[ProgressStore.STORAGE_KEY].completed['0:0'], true);
  assert.deepStrictEqual(walletApp.result.currencyReward, { status: 'pending', amount: 0 });
  assert.strictEqual(walletApp.performAction('reward:retry'), false);
  walletFixture.failStorage(RewardUnlockService.STORAGE_KEY, false);
  assert.strictEqual(walletApp.performAction('reward:retry'), true);
  assert.deepStrictEqual(walletApp.result.currencyReward, { status: 'granted', amount: 100 });
  assert.strictEqual(walletApp.rewardUnlocks.view().balance, 100);
  walletApp.result.currencyReward = { status: 'pending', amount: 0 };
  walletApp.recoverRewardUnlocks();
  assert.deepStrictEqual(walletApp.result.currencyReward, { status: 'already-claimed', amount: 0 },
    'saved completion plus an already reconciled wallet is valid claim evidence');
}

function testDailyPendingEvidence() {
  const fixture = createPlatform();
  const app = new ClearedApp(fixture.platform, { clock: () => new Date('2026-08-31T15:00:00.000Z') });
  assert.strictEqual(app.enterDaily(), true);
  solveDailyLevel(app);
  const firstLevelSave = JSON.parse(JSON.stringify(fixture.storage[DailyProgressStore.STORAGE_KEY]));
  fixture.failStorage(RewardUnlockService.STORAGE_KEY, true);
  solveDailyLevel(app);
  const completedSave = fixture.storage[DailyProgressStore.STORAGE_KEY];
  assert.deepStrictEqual(app.daily.result.currencyReward, { status: 'pending', amount: 0 });
  // Keep the real Store's completed memory, but expose only the saved first
  // level to recovery. The top-level result alone cannot prove a daily claim.
  fixture.storage[DailyProgressStore.STORAGE_KEY] = firstLevelSave;
  fixture.failStorage(RewardUnlockService.STORAGE_KEY, false);
  app.recoverRewardUnlocks();
  assert.deepStrictEqual(app.daily.result.currencyReward, { status: 'pending', amount: 0 });
  assert.strictEqual(app.rewardUnlocks.view().balance, 0);
  assert.strictEqual(app.performAction('reward:retry'), false,
    'a daily retry cannot report success without a persisted complete day');
  fixture.storage[DailyProgressStore.STORAGE_KEY] = completedSave;
  assert.strictEqual(app.performAction('reward:retry'), true);
  assert.deepStrictEqual(app.daily.result.currencyReward, { status: 'granted', amount: 500 });
  app.daily.result.currencyReward = { status: 'pending', amount: 0 };
  app.recoverRewardUnlocks();
  assert.deepStrictEqual(app.daily.result.currencyReward, { status: 'already-claimed', amount: 0 });
  assert.strictEqual(app.rewardUnlocks.view().balance, 500);
}

function testCloudCurrencySettlementFeedback() {
  const fixture = createPlatform();
  const app = new ClearedApp(fixture.platform, { stamina: createUnlimitedStaminaFixture() });
  const account = app.captureAccountContext();
  const granted = { currencyReward: { status: 'pending', amount: 0 } };
  assert.strictEqual(app.applyCloudCurrencyResult(granted, account, {
    status: 'ACKED', details: { rewardGranted: true, rewardAmount: 100 }
  }), true);
  assert.deepStrictEqual(granted.currencyReward, { status: 'granted', amount: 100 });

  const repeated = { currencyReward: { status: 'pending', amount: 0 } };
  assert.strictEqual(app.applyCloudCurrencyResult(repeated, account, {
    status: 'ACKED', details: { rewardGranted: false, rewardAmount: 0 }
  }), true);
  assert.deepStrictEqual(repeated.currencyReward, { status: 'already-claimed', amount: 0 });

  const rejected = { currencyReward: { status: 'pending', amount: 0 } };
  assert.strictEqual(app.applyCloudCurrencyResult(rejected, account, {
    status: 'REJECTED', code: 'VALIDATION_FAILED'
  }), true);
  assert.deepStrictEqual(rejected.currencyReward, { status: 'failed', amount: 0 });

  const retryable = { currencyReward: { status: 'pending', amount: 0 } };
  assert.strictEqual(app.applyCloudCurrencyResult(retryable, account, {
    status: 'RETRYABLE', code: 'STORE_TEMPORARY'
  }), false);
  assert.deepStrictEqual(retryable.currencyReward, { status: 'pending', amount: 0 });
}

function run() {
  testCompletionRewardRetry();
  testDailyPendingEvidence();
  testCloudCurrencySettlementFeedback();
  const first = createPlatform();
  const app = new ClearedApp(first.platform, { stamina: createUnlimitedStaminaFixture() });
  assert.deepStrictEqual(app.buildModel().currency, { available: true, balance: 0, error: null });
  assert.strictEqual(app.themeDescriptors().find(item => item.id === 'gem').reward.displayLevel, 5);
  assert.strictEqual(app.effectDescriptors().find(item => item.id === 'fade').reward.displayLevel, 10);
  assert.strictEqual(app.setSkin('gem'), false);
  assert.strictEqual(app.setClearEffect('fade'), false);
  completeTraining(app);
  assert.deepStrictEqual(app.result.currencyReward, { status: 'granted', amount: 100 });
  assert.strictEqual(app.rewardUnlocks.view().balance, 100);
  completeTraining(app);
  assert.deepStrictEqual(app.result.currencyReward, { status: 'already-claimed', amount: 0 });
  assert.strictEqual(app.rewardUnlocks.view().balance, 100);

  // Saved progress is reconciled before selected appearances are restored.
  const restored = createPlatform();
  restored.storage[ProgressStore.STORAGE_KEY] = freshProgress({
    completed: { '1:2': true },
    settings: { skinId: 'gem', clearEffectId: 'fade', soundEnabled: true },
    stats: { totalClears: 1 }
  });
  const rewardApp = new ClearedApp(restored.platform, { stamina: createUnlimitedStaminaFixture() });
  assert.strictEqual(rewardApp.rewardUnlocks.view().balance, 100);
  assert.strictEqual(rewardApp.skins.current().id, 'gem');
  assert.strictEqual(rewardApp.currentEffectId(), 'none', 'a saved but unowned effect cannot be restored');
  rewardApp.start();
  assert.strictEqual(rewardApp.rewardDialog.rewardId, 'theme:gem', 'saved unlock notices survive restart');
  rewardApp.performAction('reward:later');
  assert.strictEqual(rewardApp.rewardDialog, null);
  assert.strictEqual(rewardApp.rewardUnlocks.canUse('theme', 'gem'), true);

  const queued = RewardUnlockService.emptyState();
  queued.ownedRewards['theme:gem'] = true;
  queued.ownedRewards['effect:fade'] = true;
  queued.pendingNotices = ['theme:gem', 'effect:fade'];
  const queueFixture = createPlatform();
  queueFixture.storage[RewardUnlockService.STORAGE_KEY] = queued;
  const queueApp = new ClearedApp(queueFixture.platform, { stamina: createUnlimitedStaminaFixture() });
  queueApp.start();
  assert.strictEqual(queueApp.rewardDialog.rewardId, 'theme:gem');
  queueApp.performAction('reward:later');
  queueApp.tick(Date.now());
  assert.strictEqual(queueApp.rewardDialog.rewardId, 'effect:fade', 'saved notices are presented one at a time');

  // A lock dialog consumes blank drags and never changes the gallery page.
  rewardApp.performAction('home:themes');
  rewardApp.tick(Date.now());
  rewardApp.performAction('theme:desserts');
  assert.strictEqual(rewardApp.rewardDialog.mode, 'condition');
  const page = rewardApp.themePageIndex;
  rewardApp.onPointerStart({ x: 180, y: 180, id: 90 });
  rewardApp.onPointerMove({ x: 20, y: 180, id: 90 });
  rewardApp.onPointerEnd({ x: 20, y: 180, id: 90 });
  assert.strictEqual(rewardApp.themePageIndex, page);
  assert.strictEqual(rewardApp.rewardDialog.rewardId, 'theme:desserts');
  rewardApp.performAction('reward:close');

  // A single atomic purchase unlocks without applying; applying is separate.
  const purchaseFixture = createPlatform();
  const wallet = RewardUnlockService.emptyState(); wallet.balance = 10000;
  purchaseFixture.storage[RewardUnlockService.STORAGE_KEY] = wallet;
  const purchaseApp = new ClearedApp(purchaseFixture.platform, { stamina: createUnlimitedStaminaFixture() });
  purchaseApp.performAction('home:themes');
  purchaseApp.performAction('theme:desserts');
  purchaseApp.tick(Date.now());
  const buyHit = purchaseApp.renderer.hits.find(hit => hit.id === 'reward:unlock');
  const buyPoint = { x: buyHit.rect.x + buyHit.rect.w / 2,
    y: buyHit.rect.y + buyHit.rect.h / 2, id: 92 };
  purchaseApp.onPointerStart(buyPoint);
  purchaseApp.onPointerEnd(buyPoint);
  assert.strictEqual(purchaseApp.rewardUnlocks.view().balance, 0);
  assert.strictEqual(purchaseApp.skins.current().id, 'classic');
  assert.strictEqual(purchaseApp.rewardDialog.mode, 'unlocked');
  assert.strictEqual(purchaseApp.performAction('reward:apply'), true);
  assert.strictEqual(purchaseApp.skins.current().id, 'desserts');
  assert.strictEqual(purchaseApp.rewardDialog, null);

  // Daily payout belongs to the date fixed when the run started, even after midnight.
  const dailyFixture = createPlatform();
  let now = new Date('2026-08-31T15:59:00.000Z');
  const dailyApp = new ClearedApp(dailyFixture.platform, { clock: () => now });
  assert.strictEqual(dailyApp.enterDaily(), true);
  solveDailyLevel(dailyApp);
  now = new Date('2026-08-31T16:01:00.000Z');
  solveDailyLevel(dailyApp);
  assert.strictEqual(dailyApp.daily.result.dateKey, '2026-08-31');
  assert.deepStrictEqual(dailyApp.daily.result.currencyReward, { status: 'granted', amount: 500 });
  assert.strictEqual(dailyApp.rewardUnlocks.view().balance, 500);
}

module.exports = run;
