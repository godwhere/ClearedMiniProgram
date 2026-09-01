const assert = require('assert');
const WechatPlatform = require('../src/platform/wechat.js');
const ClearedApp = require('../src/app.js');
const GameRunner = require('../core/game-runner.js');
const solutions = require('../data/solutions.js');

function fakeContext() {
  const context = {};
  [
    'save', 'restore', 'clearRect', 'fillRect', 'beginPath', 'moveTo', 'lineTo',
    'quadraticCurveTo', 'closePath', 'fill', 'stroke', 'arc', 'translate',
    'drawImage', 'fillText', 'scale'
  ].forEach(method => { context[method] = function () {}; });
  return context;
}

function createWxMock() {
  const storage = {};
  const context = fakeContext();
  const audioContexts = [];
  let frameId = 0;
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
    requestAnimationFrame() { return ++frameId; },
    cancelAnimationFrame() {}
  };
  return {
    storage,
    createCanvas() { return canvas; },
    getWindowInfo() {
      return {
        windowWidth: 390,
        windowHeight: 844,
        pixelRatio: 3,
        safeArea: { top: 44, bottom: 810 }
      };
    },
    getMenuButtonBoundingClientRect() { return { bottom: 40 }; },
    getStorageSync(key) { return storage[key] || null; },
    setStorageSync(key, value) { storage[key] = JSON.parse(JSON.stringify(value)); },
    createInnerAudioContext() {
      const audio = {
        playCount: 0,
        pauseCount: 0,
        play() { this.playCount++; return Promise.resolve(); },
        pause() { this.pauseCount++; },
        stop() {},
        seek() {},
        destroy() { this.destroyed = true; },
        onError() {}
      };
      audioContexts.push(audio);
      return audio;
    },
    onTouchStart(handler) { this.touchStart = handler; },
    onTouchMove(handler) { this.touchMove = handler; },
    onTouchEnd(handler) { this.touchEnd = handler; },
    onTouchCancel(handler) { this.touchCancel = handler; },
    onHide(handler) { this.hide = handler; },
    onShow(handler) { this.show = handler; },
    onWindowResize(handler) { this.windowResize = handler; },
    vibrateShort() {},
    audioContexts
  };
}

function run() {
  const api = createWxMock();
  const platform = new WechatPlatform(api);
  assert.strictEqual(platform.metrics.dpr, 2);
  const movedIds = [];
  platform.bindPointer({ move: point => movedIds.push(point.id) });
  api.touchMove({
    touches: [
      { identifier: 7, clientX: 1, clientY: 1 },
      { identifier: 3, clientX: 2, clientY: 2 }
    ]
  });
  assert.deepStrictEqual(movedIds, [7, 3]);
  const app = new ClearedApp(platform, { solutionCatalog: solutions });
  app.start();
  app.tick(Date.now());
  assert.strictEqual(app.scene, 'home');
  assert(app.renderer.hits.some(hit => hit.id === 'home:start'));

  assert.strictEqual(app.openLevel(0, 1), false, 'locked levels cannot be opened directly');
  assert.strictEqual(app.openLevel(0, 0), true);
  app.tick(Date.now() + 1000);
  assert.strictEqual(app.showHint(), true);
  assert.strictEqual(app.hint.source, 'solution');
  const board = app.renderer.boardLayout;
  const point = index => ({
    x: board.x + (index + 0.5) * board.cell,
    y: board.y + 0.5 * board.cell,
    id: 1
  });
  app.onPointerStart(point(0));
  assert.strictEqual(app.audio.unlocked, true);
  assert(api.audioContexts.length >= 1, 'first touch creates the BGM context');
  [1, 2, 3].forEach(index => app.onPointerMove(point(index)));
  app.onPointerEnd(point(4));
  assert.strictEqual(app.scene, 'result');
  assert.strictEqual(app.runner.isGameOver, true);
  assert.strictEqual(app.progress.completedCount(), 1);

  app.tick(Date.now() + 2000);
  assert(app.renderer.hits.some(hit => hit.id === 'result:next'));
  app.performAction('result:next');
  assert.strictEqual(app.scene, 'play');
  assert.strictEqual(app.levelIndex, 1);

  app.tick(Date.now() + 3000);
  const nextBoard = app.renderer.boardLayout;
  app.onPointerStart({ x: nextBoard.x + nextBoard.cell / 2, y: nextBoard.y + nextBoard.cell / 2, id: 2 });
  assert.strictEqual(app.runner.selectedLine, 0);
  app.onHide();
  assert.strictEqual(app.runner.selectedLine, -1, 'backgrounding aborts an active gesture');
  assert(app.runner.pausedAt > 0);
  app.onShow();
  assert.strictEqual(app.runner.pausedAt, 0);

  app.tick(Date.now() + 4000);
  const trainingBoard = app.renderer.boardLayout;
  const trainingPoint = (index, id) => ({
    x: trainingBoard.x + (index % 5 + 0.5) * trainingBoard.cell,
    y: trainingBoard.y + (Math.floor(index / 5) + 0.5) * trainingBoard.cell,
    id
  });
  app.onPointerStart(trainingPoint(0, 3));
  [1, 2, 3, 4].forEach(index => app.onPointerMove(trainingPoint(index, 3)));
  app.onPointerEnd(trainingPoint(9, 3));
  app.onPointerStart(trainingPoint(8, 4));
  [7, 6].forEach(index => app.onPointerMove(trainingPoint(index, 4)));
  app.onPointerEnd(trainingPoint(5, 4));
  assert.strictEqual(app.scene, 'result');
  app.performAction('result:next');
  assert.strictEqual(app.setIndex, 1, 'next crosses into the newly unlocked set');
  assert.strictEqual(app.levelIndex, 0);

  const failureLevel = {
    Width: 3,
    Height: 2,
    Lines: [{ Start: 0, End: 1 }, { Start: 3, End: 4 }]
  };
  const failureSet = {
    Name: 'Failure fixture',
    Color: '#f472d0',
    Palette: ['#f00', '#0f0'],
    Games: [failureLevel]
  };
  app.currentSet = failureSet;
  app.currentLevel = failureLevel;
  app.levelIndex = 0;
  app.runner = new GameRunner(failureLevel, failureSet.Palette, () => app.invalidate());
  app.scene = 'play';
  app.result = null;
  app.clearAnimation = null;
  const completeLine = (start, end, lineIndex) => {
    assert.strictEqual(app.runner.touchStart(start), true);
    assert.strictEqual(app.runner.touchMove(end), true);
    assert.strictEqual(app.runner.touchEnd(end), true);
    app.onPathCompleted(lineIndex, [start, end]);
  };
  completeLine(0, 1, 0);

  let completionCalls = 0;
  let adCalls = 0;
  const sounds = [];
  const haptics = [];
  app.progress.recordCompletion = () => { completionCalls++; return {}; };
  app.ads.onLevelCompleted = () => { adCalls++; };
  app.audio.playSfx = id => { sounds.push(id); };
  platform.triggerHaptic = strength => { haptics.push(strength); };
  app.resolveClearEffect = () => ({
    id: 'slow-fade',
    type: 'fade',
    durationMs: 500,
    params: {}
  });
  app.renderer.hits = [{ id: 'play:reset', rect: { x: 0, y: 0, w: 390, h: 844 } }];
  const failedAt = Date.now();
  completeLine(3, 4, 1);
  assert.strictEqual(app.runner.outcome, GameRunner.OUTCOME.FAILED);
  assert.strictEqual(app.scene, 'result');
  assert.strictEqual(app.result.outcome, 'failed');
  assert.strictEqual(app.result.reason, 'unfilled-cells');
  assert.strictEqual(app.result.remainingCells, 2);
  assert(app.resultVisibleAt >= failedAt + 500,
    'failure waits for a clear animation longer than the result delay');
  assert.strictEqual(completionCalls, 0);
  assert.strictEqual(adCalls, 0);
  assert.deepStrictEqual(sounds, ['error']);
  assert.deepStrictEqual(haptics, ['medium']);
  assert.deepStrictEqual(app.renderer.hits, [], 'failure clears stale play hits synchronously');
  assert.strictEqual(app.performAction('play:reset'), false,
    'failure action gate rejects a stale reset before the modal frame');
  assert.strictEqual(app.runner.outcome, GameRunner.OUTCOME.FAILED);

  const failedRunner = app.runner;
  assert.strictEqual(app.performAction('failure:retry'), undefined);
  assert.strictEqual(app.scene, 'play');
  assert.strictEqual(app.runner, failedRunner, 'retry resets the current runner in place');
  assert.strictEqual(app.runner.outcome, GameRunner.OUTCOME.PLAYING);
  assert.deepStrictEqual(app.runner.owner, [-1, -1, -1, -1, -1, -1]);
  assert.strictEqual(app.result, null);
  assert.strictEqual(app.clearAnimation, null);
}

module.exports = run;
