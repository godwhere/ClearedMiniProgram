const assert = require('assert');
const WechatPlatform = require('../src/platform/wechat.js');
const ClearedApp = require('../src/app.js');
const dailySolutions = require('../data/daily-solutions.js');

function fakeContext() {
  const context = {};
  [
    'save', 'restore', 'clearRect', 'fillRect', 'beginPath', 'moveTo', 'lineTo',
    'quadraticCurveTo', 'closePath', 'fill', 'stroke', 'arc', 'translate',
    'drawImage', 'fillText', 'scale', 'strokeRect'
  ].forEach(method => { context[method] = function () {}; });
  return context;
}

function createPlatform() {
  const storage = {};
  const context = fakeContext();
  const canvas = {
    width: 0,
    height: 0,
    getContext() { return context; },
    createImage() {
      const image = {};
      Object.defineProperty(image, 'src', {
        set() { if (image.onload) image.onload(); }
      });
      return image;
    },
    requestAnimationFrame() { return 1; },
    cancelAnimationFrame() {}
  };
  const api = {
    storage,
    createCanvas() { return canvas; },
    getWindowInfo() {
      return {
        windowWidth: 390,
        windowHeight: 844,
        pixelRatio: 2,
        safeArea: { top: 44, bottom: 810 }
      };
    },
    getMenuButtonBoundingClientRect() { return { bottom: 40 }; },
    getStorageSync(key) { return storage[key] || null; },
    setStorageSync(key, value) {
      storage[key] = JSON.parse(JSON.stringify(value));
    },
    createInnerAudioContext() {
      return {
        play() { return Promise.resolve(); },
        pause() {},
        stop() {},
        seek() {},
        destroy() {},
        onError() {}
      };
    },
    vibrateShort() {},
    onTouchStart() {},
    onTouchMove() {},
    onTouchEnd() {},
    onTouchCancel() {},
    onHide() {},
    onShow() {},
    onWindowResize() {}
  };
  return { platform: new WechatPlatform(api), storage };
}

function playCurrentLevelPaths(app, paths) {
  app.tick(Date.now() + 1000);
  const level = app.daily.challenge;
  const board = app.renderer.boardLayout;
  assert(level && board && paths, 'daily level must have a board and solution');
  paths.forEach(path => {
    const point = index => ({
      x: board.x + (index % level.Width + 0.5) * board.cell,
      y: board.y + (Math.floor(index / level.Width) + 0.5) * board.cell,
      id: 11
    });
    app.onPointerStart(point(path[0]));
    path.slice(1).forEach(index => app.onPointerMove(point(index)));
    app.onPointerEnd(point(path[path.length - 1]));
    if (app.scene !== 'daily') return;
  });
}

function solveCurrentLevel(app) {
  playCurrentLevelPaths(app, dailySolutions.ByChallengeId[app.daily.challengeId]);
}

function testDailyFailureFlow() {
  const { platform, storage } = createPlatform();
  const callbackEvents = [];
  const app = new ClearedApp(platform, {
    clock: () => new Date('2026-08-31T15:00:00.000Z'),
    onDailyCompleted(event) { callbackEvents.push(event); }
  });

  assert.strictEqual(app.enterDaily(), true);
  const storageKey = 'cleared:minigame:daily:v1';
  const dateKey = app.daily.dateKey;
  const introId = app.daily.levels[0].Id;
  const extremeId = app.daily.levels[1].Id;

  // Both lines are valid, but their shortest paths leave four playable cells
  // empty. This must fail the first level without persisting completion or
  // advancing to the extreme level.
  playCurrentLevelPaths(app, [
    [0, 1, 2],
    [3, 6]
  ]);
  assert.strictEqual(app.scene, 'dailyResult');
  assert.strictEqual(app.daily.result.outcome, 'failed');
  assert.strictEqual(app.daily.result.reason, 'unfilled-cells');
  assert.strictEqual(app.daily.result.remainingCells, 4);
  assert.strictEqual(app.currentEffectId(), 'none');
  assert.strictEqual(app.daily.clearAnimation, null,
    'daily boards share the no-effect snapshot semantics');
  assert.strictEqual(app.buildModel().board.clearAnimation, null);
  assert.strictEqual(app.daily.levelIndex, 0);
  assert.deepStrictEqual(app.daily.levelResults, []);
  assert.strictEqual(app.daily.elapsedBeforeLevel, 0);
  assert.strictEqual(app.daily.completionRecorded, false);
  assert.strictEqual(callbackEvents.length, 0);
  assert.strictEqual(storage[storageKey].entries[dateKey].levels[introId].completed, false);
  assert.strictEqual(storage[storageKey].entries[dateKey].levels[extremeId].completed, false);

  const entriesUsed = app.daily.entriesUsed;
  const entriesRemaining = app.daily.entriesRemaining;
  const storedEntriesUsed = storage[storageKey].entries[dateKey].entriesUsed;
  const failedRunner = app.daily.runner;
  app.performAction('dailyFailure:retry');
  assert.strictEqual(app.scene, 'daily');
  assert.strictEqual(app.daily.runner, failedRunner);
  assert.strictEqual(app.daily.runner.outcome, 'playing');
  assert.strictEqual(app.daily.runner.completed.every(completed => !completed), true);
  assert.strictEqual(app.daily.result, null);
  assert.strictEqual(app.daily.levelIndex, 0);
  assert.strictEqual(app.daily.entriesUsed, entriesUsed);
  assert.strictEqual(app.daily.entriesRemaining, entriesRemaining);
  assert.strictEqual(storage[storageKey].entries[dateKey].entriesUsed, storedEntriesUsed);

  // A retry can complete level one normally. Failing level two must retain
  // that first-level result while still avoiding a day completion write.
  solveCurrentLevel(app);
  assert.strictEqual(app.scene, 'daily');
  assert.strictEqual(app.daily.levelIndex, 1);
  assert.strictEqual(app.daily.levelResults.length, 1);
  const firstLevelResult = JSON.parse(JSON.stringify(app.daily.levelResults[0]));
  const elapsedBeforeLevel = app.daily.elapsedBeforeLevel;

  const incompleteExtremePaths = dailySolutions.ByChallengeId[app.daily.challengeId]
    .map(path => path.slice());
  incompleteExtremePaths[1] = [5, 6, 14, 13, 12, 11];
  playCurrentLevelPaths(app, incompleteExtremePaths);
  assert.strictEqual(app.scene, 'dailyResult');
  assert.strictEqual(app.daily.result.outcome, 'failed');
  assert.strictEqual(app.daily.result.remainingCells, 2);
  assert.strictEqual(app.daily.levelIndex, 1);
  assert.strictEqual(app.daily.levelResults.length, 1);
  assert.deepStrictEqual(app.daily.levelResults[0], firstLevelResult);
  assert.strictEqual(app.daily.elapsedBeforeLevel, elapsedBeforeLevel);
  assert.strictEqual(app.daily.completionRecorded, false);
  assert.strictEqual(callbackEvents.length, 0);
  assert.strictEqual(storage[storageKey].entries[dateKey].levels[introId].completed, true);
  assert.strictEqual(storage[storageKey].entries[dateKey].levels[extremeId].completed, false);
  assert.strictEqual(storage[storageKey].entries[dateKey].completed, false);

  app.performAction('dailyFailure:retry');
  assert.strictEqual(app.scene, 'daily');
  assert.strictEqual(app.daily.levelIndex, 1);
  assert.strictEqual(app.daily.result, null);
  assert.strictEqual(app.daily.runner.outcome, 'playing');
  assert.deepStrictEqual(app.daily.levelResults[0], firstLevelResult);
  assert.strictEqual(app.daily.elapsedBeforeLevel, elapsedBeforeLevel);
  assert.strictEqual(app.daily.entriesUsed, entriesUsed);
  assert.strictEqual(app.daily.entriesRemaining, entriesRemaining);
  assert.strictEqual(storage[storageKey].entries[dateKey].entriesUsed, storedEntriesUsed);
}

function run() {
  testDailyFailureFlow();

  const { platform, storage } = createPlatform();
  const callbackEvents = [];
  const app = new ClearedApp(platform, {
    clock: () => new Date('2026-08-31T15:00:00.000Z'),
    onDailyCompleted(event) { callbackEvents.push(event); }
  });

  app.tick(Date.now());
  const mainHits = app.renderer.hits.filter(hit =>
    /^home:(dailyChallenge|themes|start)$/.test(hit.id)
  );
  assert.deepStrictEqual(mainHits.map(hit => hit.id), [
    'home:dailyChallenge', 'home:themes', 'home:start'
  ]);
  assert.strictEqual(mainHits[1].rect.y, mainHits[0].rect.y);
  assert.strictEqual(mainHits[1].rect.x > mainHits[0].rect.x, true);
  assert.strictEqual(mainHits[2].rect.y - mainHits[1].rect.y, 66);
  assert.strictEqual(mainHits[2].rect.w > mainHits[1].rect.w, true);
  assert.strictEqual(app.buildModel().dailyEntryLimit, 3);
  assert.strictEqual(app.buildModel().dailyEntriesRemaining, 3);

  assert.strictEqual(app.enterDaily(), true);
  assert.strictEqual(app.scene, 'daily');
  assert.strictEqual(app.daily.levelIndex, 0);
  assert.strictEqual(app.daily.challenge.Width, 3);
  assert.strictEqual(app.daily.challenge.Height, 3);
  assert.strictEqual(app.daily.challenge.Lines.length, 2);
  assert.strictEqual(app.daily.entriesUsed, 1);
  assert.strictEqual(app.daily.entriesRemaining, 2);

  app.tick(Date.now() + 1000);
  const introBoard = app.renderer.boardLayout;
  assert.strictEqual(introBoard.cols, 3);
  assert.strictEqual(introBoard.rows, 3);
  solveCurrentLevel(app);
  assert.strictEqual(app.scene, 'daily');
  assert.strictEqual(app.daily.levelIndex, 1);
  assert.strictEqual(app.daily.challenge.Width, 8);
  assert.strictEqual(app.daily.challenge.Height, 10);
  assert.strictEqual(app.daily.entriesUsed, 1);
  assert.strictEqual(app.daily.entriesRemaining, 2);

  app.tick(Date.now() + 2000);
  const hardBoard = app.renderer.boardLayout;
  assert.strictEqual(hardBoard.cols, 8);
  assert.strictEqual(hardBoard.rows, 10);
  const holePoint = {
    x: hardBoard.x + (3 % 8 + 0.5) * hardBoard.cell,
    y: hardBoard.y + (Math.floor(3 / 8) + 0.5) * hardBoard.cell,
    id: 12
  };
  assert.strictEqual(app.daily.runner.isPlayableCell(3), false);
  assert.strictEqual(app.daily.runner.touchStart(3), false);
  app.onPointerStart(holePoint);
  assert.strictEqual(app.daily.runner.selectedLine, -1);

  solveCurrentLevel(app);
  assert.strictEqual(app.scene, 'dailyResult');
  assert.strictEqual(app.daily.result.levelResults.length, 2);
  assert.strictEqual(app.daily.result.levelResults[0].completed, true);
  assert.strictEqual(app.daily.result.levelResults[1].completed, true);
  assert.strictEqual(app.daily.result.elapsedMs >= 1, true);
  assert.strictEqual(callbackEvents.length, 1);
  assert.strictEqual(callbackEvents[0].firstClear, true);
  assert.strictEqual(app.progress.completedCount(), 0);
  assert.strictEqual(app.progress.state.stats.totalClears, 0);
  assert.strictEqual(storage['cleared:minigame:daily:v1'].entries['2026-08-31'].entriesUsed, 1);

  // Three entries per day: consume the remaining two entries via fresh runs.
  app.tick(Date.now() + 5000);
  assert.strictEqual(app.renderer.hits.some(hit => hit.id === 'dailyResult:replay'), true);
  assert.strictEqual(app.renderer.hits.filter(hit => hit.id === 'dailyResult:home').length, 1);
  assert.strictEqual(app.renderer.hits.some(hit => hit.id === 'dailyResult:back'), true);
  app.performAction('dailyResult:replay');
  assert.strictEqual(app.scene, 'daily');
  for (let attempt = 3; attempt <= 3; attempt++) {
    app.performAction('daily:home');
    app.tick(Date.now() + attempt * 1000);
    assert.strictEqual(app.enterDaily(), true, `entry ${attempt} should be available`);
  }
  assert.strictEqual(app.daily.entriesUsed, 3);
  assert.strictEqual(app.daily.entriesRemaining, 0);
  app.performAction('daily:home');
  app.tick(Date.now() + 7000);
  assert.strictEqual(app.buildModel().dailyEntryAvailable, false);
  assert.strictEqual(app.renderer.hits.some(hit => hit.id === 'home:dailyChallenge'), false);
  assert.strictEqual(app.enterDaily(), false);

  // Development/debug mode deliberately bypasses the finite budget while
  // retaining the same persisted attempt counter.
  const debugApp = new ClearedApp(platform, {
    clock: () => new Date('2026-08-31T15:00:00.000Z'),
    dailyDebugUnlimited: true
  });
  assert.strictEqual(debugApp.dailyProgress.debugUnlimited, true);
  debugApp.tick(Date.now());
  assert.strictEqual(debugApp.buildModel().dailyDebugUnlimited, true);
  assert.strictEqual(debugApp.buildModel().dailyEntryAvailable, true);
  assert.strictEqual(debugApp.enterDaily(), true);
  debugApp.performAction('daily:home');
  debugApp.tick(Date.now());
  assert.strictEqual(debugApp.enterDaily(), true, 'debug mode remains unlimited after the third entry');
  const revive = debugApp.requestDailyRevive('ad', 'ad-test-1');
  assert.strictEqual(revive.implemented, false);
}

module.exports = run;
