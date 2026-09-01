'use strict';

const assert = require('assert');
const WechatPlatform = require('../src/platform/wechat.js');
const ClearedApp = require('../src/app.js');
const GameRunner = require('../core/game-runner.js');
const portalDemo = require('../data/portal-demo.js');
const portalSolutions = require('../data/portal-solutions.js');

function fakeContext() {
  const context = {};
  [
    'save', 'restore', 'clearRect', 'fillRect', 'beginPath', 'moveTo', 'lineTo',
    'quadraticCurveTo', 'closePath', 'fill', 'stroke', 'arc', 'translate',
    'drawImage', 'fillText', 'scale', 'strokeRect'
  ].forEach(method => { context[method] = function () {}; });
  return context;
}

function createWxMock() {
  const storage = {};
  const context = fakeContext();
  const audioContexts = [];
  let frameId = 0;
  const canvas = {
    width: 390,
    height: 844,
    getContext() { return context; },
    createImage() {
      const image = { width: 512, height: 512 };
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
  const app = new ClearedApp(platform, {
    solutionCatalog: null,
    portalSolutions
  });
  app.start();
  let ordinaryCompletionAds = 0;
  app.ads.onLevelCompleted = () => { ordinaryCompletionAds += 1; };
  assert.strictEqual(app.hints.portalSolutions, portalSolutions,
    'App must pass injected portal solutions to HintService');
  assert(app.buildModel().portalTrial, 'home model exposes the gameplay extension definition');
  assert.strictEqual(app.buildModel().portalTrial.action, 'home:portalTrial');
  app.tick(Date.now());
  assert.strictEqual(app.renderer.hitTest(73, 98), 'home:portalTrial',
    'the dedicated gameplay-extension button is reachable on the home screen');

  // Enter demo level 1 through the gameplay-extension entry.
  const level1 = portalDemo.Games[0]; // 5x5, Start: 0, End: 24, Portals: P1, A: 21, B: 2
  assert.strictEqual(app.openPortalTrial(0), true);
  assert.strictEqual(app.activeMechanicId, 'portal');
  assert.strictEqual(app.setIndex, -1, 'trial does not reuse an ordinary catalog index');
  app.tick(Date.now());

  const layout = app.renderer.boardLayout;
  assert(layout, 'board layout must be initialized');

  const cellPoint = (index, id) => {
    const col = index % layout.cols;
    const row = Math.floor(index / layout.cols);
    return {
      x: layout.x + (col + 0.5) * layout.cell,
      y: layout.y + (row + 0.5) * layout.cell,
      id: id || 1
    };
  };

  // 1. Move to A (21) -> locks at A
  app.onPointerStart(cellPoint(0, 1));
  assert.strictEqual(app.runner.selectedLine, 0);
  [1, 6, 5, 10, 11, 16, 15, 20, 21].forEach(c => app.onPointerMove(cellPoint(c, 1)));
  assert.strictEqual(app.runner.portalPhase, 'PORTAL_LOCKED');

  // Move after A is ignored
  app.onPointerMove(cellPoint(22, 1));
  assert.strictEqual(app.runner.portalPhase, 'PORTAL_LOCKED');
  assert.strictEqual(app.runner.selectedCells[app.runner.selectedCells.length - 1], 21);
  app.onPointerCancel(cellPoint(21, 1));
  assert.strictEqual(app.runner.portalPhase, 'PORTAL_WAIT',
    'touchcancel at a locked portal is treated as releasing at the entry');
  assert.strictEqual(app.pointer, null);

  // 2. Fast swipe jump over A: traceBoard stops at A
  app.runner.reset();
  app.onPointerStart(cellPoint(0, 2));
  // Jump from cell 20 directly past 21 to 22:
  app.onPointerMove(cellPoint(20, 2));
  // traceBoard between 20 and 22 crosses 21
  app.traceBoard(cellPoint(20, 2), cellPoint(22, 2));
  assert.strictEqual(app.runner.portalPhase, 'PORTAL_LOCKED');
  assert.strictEqual(app.runner.selectedCells[app.runner.selectedCells.length - 1], 21);

  // 3. Release at A -> enters PORTAL_WAIT (no error sfx)
  app.onPointerEnd(cellPoint(21, 2));
  assert.strictEqual(app.runner.portalPhase, 'PORTAL_WAIT');
  assert.strictEqual(app.pointer, null);

  // Model exposes expectedExit and portalInstruction
  const model = app.buildModel();
  assert.strictEqual(model.expectedExit, 2);
  assert.strictEqual(model.portalInstruction, '从另一端继续');

  // Cancelling an exit-side gesture drops only that side and keeps A waiting.
  app.onPointerStart(cellPoint(2, 30));
  app.onPointerMove(cellPoint(3, 30));
  app.onPointerCancel(cellPoint(3, 30));
  assert.strictEqual(app.runner.portalPhase, 'PORTAL_WAIT');
  assert.strictEqual(app.runner.portalPending.exit, 2);
  assert.strictEqual(app.runner.selectedCells[app.runner.selectedCells.length - 1], 21);
  assert.strictEqual(app.pointer, null);

  // 4. Wrong tap (not on B=2): cancels A segment, does NOT start new line
  app.onPointerStart(cellPoint(10, 3));
  assert.strictEqual(app.runner.portalPhase, 'READY');
  assert.strictEqual(app.runner.selectedLine, -1);
  assert.strictEqual(app.pointer, null, 'wrong tap must not create active board pointer');

  // 5. Correct full sequence: 0 -> A(21) -> release -> B(2) -> 24
  app.onPointerStart(cellPoint(0, 4));
  [1, 6, 5, 10, 11, 16, 15, 20, 21].forEach(c => app.onPointerMove(cellPoint(c, 4)));
  assert.strictEqual(app.runner.portalPhase, 'PORTAL_LOCKED');
  app.onPointerEnd(cellPoint(21, 4));
  assert.strictEqual(app.runner.portalPhase, 'PORTAL_WAIT');

  // Tap on B=2
  app.onPointerStart(cellPoint(2, 5));
  assert.strictEqual(app.runner.portalPhase, 'PORTAL_CONTINUE');
  assert.strictEqual(app.pointer.mode, 'board');

  // Move through remaining cells to End 24
  [3, 4, 9, 8, 7, 12, 13, 14, 19, 18, 17, 22, 23, 24].forEach(c => app.onPointerMove(cellPoint(c, 5)));
  app.onPointerEnd(cellPoint(24, 5));
  assert.strictEqual(app.runner.isGameOver, true);
  assert.strictEqual(app.scene, 'result');
  assert.strictEqual(app.clearAnimation.cells.length, 25,
    'clear animation includes both portal path segments');
  assert.deepStrictEqual(app.clearAnimation.segments.map(segment => segment.length), [10, 15]);
  assert.deepStrictEqual(app.progress.state.completed, {},
    'portal trials must not write ordinary level completion');
  assert.strictEqual(app.progress.state.lastPlayed, null,
    'portal trials must not replace the ordinary resume target');
  assert.strictEqual(app.progress.state.stats.totalClears, 0,
    'portal trials must not increment ordinary clear/ad counters');
  assert.strictEqual(ordinaryCompletionAds, 0,
    'portal trials must not enter the ordinary completion-ad flow');
  assert.strictEqual(app.result.persisted, false);
  assert.strictEqual(app.result.gameplayExtensionId, 'portal');

  // 6. onHide() clears pending portal state
  app.runner.reset();
  app.scene = 'play';
  app.onPointerStart(cellPoint(0, 6));
  [1, 6, 5, 10, 11, 16, 15, 20, 21].forEach(c => app.onPointerMove(cellPoint(c, 6)));
  app.onPointerEnd(cellPoint(21, 6));
  assert.strictEqual(app.runner.portalPhase, 'PORTAL_WAIT');

  app.onHide();
  assert.strictEqual(app.runner.portalStatus(), null, 'onHide must cancel pending portal state');
  assert.strictEqual(app.runner.portalPhase, 'READY');
  assert.strictEqual(app.pointer, null);

  // 7. Test the dedicated home gameplay-extension entry.
  app.scene = 'home';
  app.performAction('home:portalTrial');
  assert.strictEqual(app.scene, 'play');
  assert.strictEqual(app.currentSet, portalDemo);
  assert.strictEqual(app.levelIndex, 0);
  assert.strictEqual(app.runner.level.Id, 'portal-demo-01');

  // Next level navigation through all 5 levels
  for (let i = 0; i < 4; i++) {
    app.performAction('result:next');
    assert.strictEqual(app.levelIndex, i + 1);
    assert.strictEqual(app.runner.level.Id, portalDemo.Games[i + 1].Id);
  }
  // After level 5, next returns home
  app.performAction('result:next');
  assert.strictEqual(app.scene, 'home');
  assert.strictEqual(app.runner, null);

  // Portal is not a corridor/theme/effect entry.
  app.scene = 'corridor';
  assert.deepStrictEqual(app.corridorDescriptors().map(item => item.id), ['themes', 'effects']);
  app.performAction('corridor:portalTrial');
  assert.strictEqual(app.scene, 'play');
  assert.strictEqual(app.currentSet, portalDemo,
    'the hidden legacy action remains compatible without a corridor card');
  // Back button returns home.
  app.performAction('play:back');
  assert.strictEqual(app.scene, 'home');
  assert.strictEqual(app.runner, null);

  // A valid but short portal route can finish the only line while leaving
  // cells empty. It must use the shared failure modal, keep ordinary progress
  // untouched, and label the back action as a return to the home scene.
  app.performAction('home:portalTrial');
  app.tick(Date.now() + 1000);
  const failureLayout = app.renderer.boardLayout;
  const failurePoint = (index, id) => ({
    x: failureLayout.x + (index % failureLayout.cols + 0.5) * failureLayout.cell,
    y: failureLayout.y + (Math.floor(index / failureLayout.cols) + 0.5) * failureLayout.cell,
    id
  });
  const completedBeforeFailure = app.progress.completedCount();
  app.onPointerStart(failurePoint(0, 20));
  [1, 6, 5, 10, 11, 16, 15, 20, 21].forEach(c => app.onPointerMove(failurePoint(c, 20)));
  app.onPointerEnd(failurePoint(21, 20));
  app.onPointerStart(failurePoint(2, 21));
  [3, 4, 9, 14, 19, 24].forEach(c => app.onPointerMove(failurePoint(c, 21)));
  app.onPointerEnd(failurePoint(24, 21));
  assert.strictEqual(app.runner.outcome, GameRunner.OUTCOME.FAILED);
  assert.strictEqual(app.result.remainingCells, 8);
  assert.strictEqual(app.scene, 'result');
  assert.strictEqual(app.progress.completedCount(), completedBeforeFailure);
  app.tick(app.resultVisibleAt + 180);
  assert.deepStrictEqual(app.renderer.hits.map(hit => hit.id), ['result:levels', 'failure:retry']);
  app.performAction('result:levels');
  assert.strictEqual(app.scene, 'home');
  assert.strictEqual(app.runner, null);

  // A custom solution manifest must not be shadowed by the built-in default.
  const customSolutions = { ByLevelId: { custom: [] } };
  const customApp = new ClearedApp(new WechatPlatform(createWxMock()), {
    portalSolutions: customSolutions
  });
  assert.strictEqual(customApp.hints.portalSolutions, customSolutions);

  // Malformed injected definitions never expose/open a trial that could fall
  // through to ordinary ProgressStore keys.
  const invalidDefinitionApp = new ClearedApp(new WechatPlatform(createWxMock()), {
    portalMechanic: {
      enabled: true,
      mechanic: 'portal',
      rulesVersion: 1,
      trial: { action: 'home:portalTrial', set: portalDemo, solutions: portalSolutions }
    },
    portalDemo,
    portalSolutions
  });
  assert.strictEqual(invalidDefinitionApp.portalTrialDescriptor(), null);
  assert.strictEqual(invalidDefinitionApp.openPortalTrial(0), false);
}

module.exports = run;
