const assert = require('assert');
const { createUnlimitedStaminaFixture } = require('./helpers/stamina-fixture.js');
const WechatPlatform = require('../src/platform/wechat.js');
const ClearedApp = require('../src/app.js');
const GameRunner = require('../core/game-runner.js');
const catalog = require('../data/catalog-v2.js');
const { createCatalogRunContext } = require('../src/gameplay/run-context.js');
const solutions = require('../data/solutions.js');
const portalSolutions = require('../data/portal-solutions.js');
const portalInstructions = require('../src/ui/portal-instructions.js');
const ProgressStore = require('../src/services/progress-store.js');
const RewardUnlockService = require('../src/services/reward-unlock-service.js');
const rewardConfig = require('../src/config/rewards.js');

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

function runnerGameplayState(runner) {
  const state = runner.getViewState();
  delete state.elapsedMs;
  delete state.timeText;
  return state;
}

async function run() {
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
  const app = new ClearedApp(platform, { solutionCatalog: solutions, stamina: createUnlimitedStaminaFixture() });
  app.start();
  app.tick(Date.now());
  assert.strictEqual(app.scene, 'home');
  assert(app.renderer.hits.some(hit => hit.id === 'home:start'));

  assert.strictEqual(app.openLevel(0, 1), false, 'locked levels cannot be opened directly');
  assert.strictEqual(app.openLevel(0, 0), true);
  const backFrameAt = Date.now();
  app.tick(backFrameAt);
  const playBackHit = app.renderer.hits.find(hit => hit.id === 'play:back');
  assert(playBackHit, 'ordinary play exposes the back action');
  const playBackPoint = {
    x: playBackHit.rect.x + playBackHit.rect.w / 2,
    y: playBackHit.rect.y + playBackHit.rect.h / 2,
    id: 40
  };
  app.onPointerStart(playBackPoint);
  app.tick(backFrameAt + 1);
  app.onPointerEnd(playBackPoint);
  assert.strictEqual(app.scene, 'levels');
  assert.doesNotThrow(() => app.tick(backFrameAt + 16),
    'the first selector frame after a real back-button click must render');
  assert(app.renderer.hits.some(hit => hit.id === 'levels:home'));
  assert(app.renderer.hits.some(hit => hit.id === 'level:0:0'));
  assert.strictEqual(app.openLevel(0, 0), true);
  app.ads.onLevelCompleted = () => {
    assert.strictEqual(app.scene, 'result', 'advertising runs after result navigation');
    assert.strictEqual(api.storage['cleared:minigame:progress:v2'].completed['0:0'], true);
    throw new Error('synchronous ad failure');
  };
  app.tick(Date.now() + 1000);
  assert.strictEqual(app.showHint(), true);
  assert.strictEqual(app.hint.source, 'solution');
  const board = app.renderer.boardLayout;
  const point = index => ({
    x: board.x + (index + 0.5) * board.cell,
    y: board.y + 0.5 * board.cell,
    id: 1
  });
  app.resetCurrentLevel();
  assert.deepStrictEqual(app.renderer.getBoardLayout(), board,
    'reset clears stale UI hits without dropping board geometry before the next frame');
  const immediatePoint = Object.assign({}, point(0), { id: 41 });
  app.onPointerStart(immediatePoint);
  assert.strictEqual(app.boardInput.isActive(), true,
    'the first touch immediately after reset still reaches the board');
  app.onPointerCancel(immediatePoint);
  app.onPointerStart(point(0));
  assert.strictEqual(app.audio.unlocked, true);
  assert(api.audioContexts.length >= 1, 'first touch creates the BGM context');
  [1, 2, 3].forEach(index => app.onPointerMove(point(index)));
  app.onPointerEnd(point(4));
  assert.strictEqual(app.scene, 'result');
  assert(app.result, 'an optional ad failure cannot strand a won board without a result');
  assert.strictEqual(app.runner.isGameOver, true);
  assert.strictEqual(app.progress.completedCount(), 1);
  assert(app.buildModel().clearFeedback, 'the last completed gesture also triggers visual shake');

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
  app.runContext = createCatalogRunContext({ sets: [failureSet] }, 0, 0);
  app.setIndex = 0;
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
  assert(app.buildModel().clearFeedback, 'non-final clears trigger visual shake');

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

  // The ordinary selector is one continuous 1-168 catalog, paged independently
  // from the canonical set/level coordinates used by progress and hints.
  app.scene = 'levels';
  app.levelPageIndex = 0;
  let levelModel = app.buildModel();
  assert.strictEqual(levelModel.totalLevels, 168);
  assert.strictEqual(levelModel.levelPageCount, 7);
  assert.strictEqual(levelModel.levelItems.length, 25);
  assert.strictEqual(levelModel.levelItems[0].displayNumber, 1);
  assert.strictEqual(levelModel.levelItems[0].action, 'level:0:0');
  assert.strictEqual(levelModel.levelItems[24].displayNumber, 25);
  assert.strictEqual(levelModel.levelItems[24].action, 'level:3:7');
  assert.deepStrictEqual([0, 1, 2, 3, 4, 5, 6].map(pageIndex => {
    app.levelPageIndex = pageIndex;
    return app.buildModel().levelItems.length;
  }), [25, 25, 25, 25, 25, 25, 18]);

  app.levelPageIndex = 0;
  app.performAction('levels:next');
  levelModel = app.buildModel();
  assert.strictEqual(levelModel.levelRangeStart, 26);
  assert.strictEqual(levelModel.levelItems[0].action, 'level:3:8');
  assert.strictEqual(levelModel.levelItems[6].displayNumber, 32);
  assert.strictEqual(levelModel.levelItems[6].action, 'level:3:14');
  assert.strictEqual(levelModel.levelItems[7].displayNumber, 33);
  assert.strictEqual(levelModel.levelItems[7].action, 'level:4:73',
    'the new gentle opener occupies display 33 without changing its stable identity');
  assert.strictEqual(levelModel.levelItems[7].difficulty, 1);

  app.levelPageIndex = 5;
  levelModel = app.buildModel();
  assert.strictEqual(levelModel.levelRangeStart, 126);
  assert.strictEqual(levelModel.levelRangeEnd, 150);
  assert.strictEqual(levelModel.levelItems.length, 25);
  assert.strictEqual(levelModel.levelItems[11].action, 'level:4:9');
  assert.strictEqual(levelModel.levelItems[12].action, 'level:4:105');
  assert.strictEqual(levelModel.levelItems[22].action, 'level:4:115');
  assert.strictEqual(levelModel.levelItems[24].action, 'level:4:117');
  app.performAction('levels:next');
  levelModel = app.buildModel();
  assert.strictEqual(levelModel.levelRangeStart, 151);
  assert.strictEqual(levelModel.levelRangeEnd, 168);
  assert.strictEqual(levelModel.levelItems.length, 18);
  assert.strictEqual(levelModel.levelItems[0].action, 'level:4:118');
  assert.strictEqual(levelModel.levelItems[17].action, 'level:4:135');

  const activeCompletedBeforeRetiredSave = app.ordinaryCompletedCount();
  app.progress.state.completed['1:5'] = true;
  app.progress.state.completed['2:10'] = true;
  app.progress.state.completed['3:15'] = true;
  app.progress.state.completed['5:0'] = true;
  app.scene = 'home';
  const homeModelWithRetiredSave = app.buildModel();
  assert.strictEqual(homeModelWithRetiredSave.completedCount, activeCompletedBeforeRetiredSave,
    'retired ordinary progress is preserved but excluded from the active 1-168 count');
  assert.strictEqual(homeModelWithRetiredSave.totalLevels, 168);

  app.progress.state.lastPlayed = { setIndex: 2, levelIndex: 10 };
  app.performAction('home:levels');
  assert.strictEqual(app.scene, 'levels');
  assert.strictEqual(app.levelPageIndex, 0,
    'a retired last-played coordinate falls back to the first selector page');

  app.setIndex = 1;
  app.performAction('level:0');
  assert.strictEqual(app.scene, 'play');
  assert.strictEqual(app.setIndex, 1);
  assert.strictEqual(app.levelIndex, 0,
    'the legacy two-part level action still resolves within the current set');
  app.performAction('play:back');

  app.progress.state.completed['4:59'] = true;
  app.performAction('level:4:59');
  assert.strictEqual(app.buildModel().hasNext, true,
    'the former final level 92 must now follow the published display order');
  app.scene = 'result';
  app.result = { outcome: GameRunner.OUTCOME.WON };
  app.performAction('result:next');
  assert.strictEqual(app.scene, 'play');
  assert.strictEqual(app.setIndex, 4);
  const oldFinalPosition = catalog.levels.findIndex(level => level.setIndex === 4 && level.levelIndex === 59);
  assert.strictEqual(app.levelIndex, catalog.levels[oldFinalPosition + 1].levelIndex);
  assert.strictEqual(app.buildModel().ordinaryLevelNumber, oldFinalPosition + 2);
  assert.strictEqual(app.showHint(), true);
  app.performAction('play:back');

  app.progress.state.completed['4:134'] = true;
  app.levelPageIndex = 6;
  assert.strictEqual(app.performAction('level:4:135'), undefined);
  assert.strictEqual(app.scene, 'play');
  assert.strictEqual(app.setIndex, 4);
  assert.strictEqual(app.levelIndex, 135);
  assert.strictEqual(app.runContext.source.kind, 'catalog');
  assert.strictEqual(app.runContext.progressionScope, 'ordinary');
  const finalOrdinaryModel = app.buildModel();
  assert.strictEqual(finalOrdinaryModel.ordinaryLevelNumber, 168);
  assert.strictEqual(finalOrdinaryModel.ordinaryLevelCount, 168);
  assert.strictEqual(finalOrdinaryModel.hasNext, false);
  assert.strictEqual(app.showHint(), true);
  assert.strictEqual(app.hint.source, 'solution');
  app.performAction('play:back');
  assert.strictEqual(app.scene, 'levels');
  assert.strictEqual(app.levelPageIndex, 6,
    'returning from the last ordinary level restores its selector page');

  app.performAction('level:4:135');
  app.scene = 'result';
  app.result = { outcome: GameRunner.OUTCOME.WON };
  app.performAction('result:next');
  assert.strictEqual(app.scene, 'levels');
  assert.strictEqual(app.levelPageIndex, 6,
    'the final ordinary result returns to the page containing level 168');

  // A catalog Portal level still settles through the ordinary progress domain
  // after its segmented answer is completed.
  const portalApp = new ClearedApp(new WechatPlatform(createWxMock()), {
    solutionCatalog: solutions,
    portalSolutions
  });
  const portalPosition = catalog.levels.findIndex(level => level.setIndex === 4 && level.levelIndex === 30);
  const portalPrevious = catalog.levels[portalPosition - 1];
  portalApp.progress.state.completed[`${portalPrevious.setIndex}:${portalPrevious.levelIndex}`] = true;
  assert.strictEqual(portalApp.openLevel(4, 30), true);
  const portalLevel = portalApp.runner.level;
  const portalAnswer = portalSolutions.ByLevelId[portalLevel.Id];
  assert(portalAnswer, 'the first catalog Portal level has a keyed answer');
  portalAnswer.forEach((lineAnswer, lineIndex) => {
    const segments = lineAnswer.Segments || [];
    segments.forEach((segment, segmentIndex) => {
      const cells = segment.Cells || [];
      assert.strictEqual(portalApp.runner.touchStart(cells[0]), true);
      cells.slice(1).forEach(cell => portalApp.runner.touchMove(cell));
      const ended = portalApp.runner.touchEnd(cells[cells.length - 1]);
      if (segmentIndex < segments.length - 1) {
        assert.strictEqual(ended, false);
      } else {
        assert.strictEqual(ended, true);
        const completed = portalApp.runner.getCompletedLine(lineIndex);
        portalApp.onPathCompleted(lineIndex, completed.cells, completed.segments);
      }
    });
  });
  assert.strictEqual(portalApp.scene, 'result');
  assert.strictEqual(portalApp.progress.isCompleted(4, 30), true,
    'ordinary catalog Portal completion writes the ordinary progress key');

  // Complete hints are read-only initial-board previews. They must preserve a
  // partially played Runner (including selection/undo) across toggle and
  // timeout, and must suppress every board/reset/undo input while visible.
  const previewApp = new ClearedApp(new WechatPlatform(createWxMock()), {
    solutionCatalog: solutions,
    portalSolutions
  });
  previewApp.progress.state.completed['0:0'] = true;
  assert.strictEqual(previewApp.openLevel(0, 1), true);
  const previewSolution = solutions.sets[0][1];
  previewApp.runner.touchStart(previewSolution[0][0]);
  previewSolution[0].slice(1).forEach(cell => previewApp.runner.touchMove(cell));
  assert.strictEqual(previewApp.runner.touchEnd(previewSolution[0].slice(-1)[0]), true);
  assert.strictEqual(previewApp.runner.touchStart(previewSolution[1][0]), true);
  const liveBeforePreview = runnerGameplayState(previewApp.runner);
  const progressBeforePreview = JSON.stringify(previewApp.progress.state);
  let resetCalls = 0;
  let undoCalls = 0;
  let pauseCalls = 0;
  let resumeCalls = 0;
  const liveReset = previewApp.runner.reset.bind(previewApp.runner);
  const liveUndo = previewApp.runner.undo.bind(previewApp.runner);
  const livePause = previewApp.runner.pause.bind(previewApp.runner);
  const liveResume = previewApp.runner.resume.bind(previewApp.runner);
  previewApp.runner.reset = () => { resetCalls++; return liveReset(); };
  previewApp.runner.undo = () => { undoCalls++; return liveUndo(); };
  previewApp.runner.pause = () => { pauseCalls++; return livePause(); };
  previewApp.runner.resume = () => { resumeCalls++; return liveResume(); };

  assert.strictEqual(previewApp.showHint(), true);
  assert.strictEqual(previewApp.hint.paths.length, previewApp.runner.level.Lines.length);
  const previewModel = previewApp.buildModel();
  const previewView = previewModel.hintPreview.viewModel;
  assert(previewView.board.cells.every(cell => cell.owner === -1 && cell.selected === false));
  assert(previewView.board.completedPaths.every(path => path === null));
  assert.strictEqual(previewView.board.cells.filter(cell => cell.fixedLine >= 0).length, 4,
    'initial preview preserves every endpoint');
  assert.deepStrictEqual(previewView.board.hint.paths.map(item => item.path), previewSolution);
  assert.deepStrictEqual(runnerGameplayState(previewApp.runner), liveBeforePreview);
  assert.strictEqual(JSON.stringify(previewApp.progress.state), progressBeforePreview);
  assert.strictEqual(previewApp.performAction('play:reset'), false);
  assert.strictEqual(previewApp.performAction('play:undo'), false);
  assert.deepStrictEqual([resetCalls, undoCalls], [0, 0]);

  previewApp.tick(Date.now());
  assert.strictEqual(previewApp.renderer.hits.some(hit => hit.id === 'play:reset'), false);
  assert.strictEqual(previewApp.renderer.hits.some(hit => hit.id === 'play:undo'), false);
  assert.strictEqual(previewApp.renderer.hits.some(hit => hit.id === 'play:hint'), true,
    'the hint button remains available as the hide-preview toggle');
  const previewLayout = previewApp.renderer.getBoardLayout();
  previewApp.onPointerStart({
    x: previewLayout.x + previewLayout.cell / 2,
    y: previewLayout.y + previewLayout.cell / 2,
    id: 70
  });
  assert.strictEqual(previewApp.boardInput.isActive(), false,
    'board input is isolated while the initial-board preview is visible');
  assert.deepStrictEqual(runnerGameplayState(previewApp.runner), liveBeforePreview);

  assert.strictEqual(previewApp.showHint(), true, 'a second hint tap closes immediately');
  assert.strictEqual(previewApp.hintPreview, null);
  assert.deepStrictEqual(runnerGameplayState(previewApp.runner), liveBeforePreview);

  assert.strictEqual(previewApp.showHint(), true);
  const previewUntil = previewApp.hintPreview.until;
  const renderedModels = [];
  const renderPreviewFrame = previewApp.renderer.render.bind(previewApp.renderer);
  previewApp.renderer.render = (model, now) => {
    renderedModels.push(model);
    return renderPreviewFrame(model, now);
  };
  previewApp.tick(previewUntil - 1);
  previewApp.tick(previewUntil + 1);
  assert.strictEqual(previewApp.hintPreview, null);
  assert.strictEqual(renderedModels[renderedModels.length - 1].hintPreview, null,
    'timeout draws a final frame using the real board');
  assert.strictEqual(previewApp.renderer.hits.some(hit => hit.id === 'play:reset'), true);
  assert.strictEqual(previewApp.renderer.hits.some(hit => hit.id === 'play:undo'), true,
    'reset and undo hits return on the final restored frame');
  assert.deepStrictEqual(runnerGameplayState(previewApp.runner), liveBeforePreview);
  assert.strictEqual(JSON.stringify(previewApp.progress.state), progressBeforePreview);
  assert.deepStrictEqual([resetCalls, undoCalls], [0, 0],
    'the entire hint lifecycle never resets or undoes the live Runner');
  assert.deepStrictEqual([pauseCalls, resumeCalls], [0, 0],
    'hint preview keeps the existing timer policy without pausing the Runner');

  previewApp.runner.cancelGesture('test-resume');
  previewApp.tick(previewUntil + 2);
  const restoredLayout = previewApp.renderer.getBoardLayout();
  previewApp.onPointerStart({
    x: restoredLayout.x + (8 % 5 + 0.5) * restoredLayout.cell,
    y: restoredLayout.y + (Math.floor(8 / 5) + 0.5) * restoredLayout.cell,
    id: 71
  });
  assert.strictEqual(previewApp.boardInput.isActive(), true,
    'board input resumes after the preview closes');
  previewApp.onPointerCancel({ id: 71 });

  const dailyLevel = {
    Id: 'daily-preview-test',
    Width: 3,
    Height: 2,
    Blocked: [1],
    Lines: [{ Start: 0, End: 2 }]
  };
  const dailySolutions = { ByChallengeId: { 'daily-preview-test': [[0, 3, 4, 5, 2]] } };
  const dailyPreviewApp = new ClearedApp(new WechatPlatform(createWxMock()), {
    dailySolutions
  });
  dailyPreviewApp.daily = Object.assign(dailyPreviewApp.emptyDailyState(), {
    challenge: dailyLevel,
    challengeId: dailyLevel.Id,
    levels: [dailyLevel],
    runner: new GameRunner(dailyLevel, ['#f00'])
  });
  dailyPreviewApp.boardInput.setRunner(dailyPreviewApp.daily.runner);
  dailyPreviewApp.scene = 'daily';
  assert.strictEqual(dailyPreviewApp.buildModel().firstClearRewardAmount, rewardConfig.currency.dailyFirstComplete);
  const dailyStateBefore = runnerGameplayState(dailyPreviewApp.daily.runner);
  assert.strictEqual(dailyPreviewApp.showDailyHint(), true);
  assert.deepStrictEqual(dailyPreviewApp.hint.paths[0].path, [0, 3, 4, 5, 2]);
  assert.strictEqual(dailyPreviewApp.hintPreview.viewModel.board.cells[1].blocked, true);
  assert.deepStrictEqual(runnerGameplayState(dailyPreviewApp.daily.runner), dailyStateBefore);

  const portalPreviewApp = new ClearedApp(new WechatPlatform(createWxMock()), {
    portalSolutions,
    progressionConfig: { unlockAllLevelsInDevTools: true }
  });
  assert.strictEqual(portalPreviewApp.openLevel(1, 4), true);
  const portalEntry = [0, 1, 6, 5, 10, 11, 16, 15, 20, 21];
  portalPreviewApp.runner.touchStart(portalEntry[0]);
  portalEntry.slice(1).forEach(cell => portalPreviewApp.runner.touchMove(cell));
  portalPreviewApp.runner.touchEnd(-1);
  const portalPendingBefore = runnerGameplayState(portalPreviewApp.runner);
  assert.strictEqual(portalPreviewApp.showHint(), true);
  assert.strictEqual(portalPreviewApp.hint.paths[0].segments.length, 2,
    'Portal preview shows the full preset rather than only the pending exit segment');
  assert.strictEqual(portalPreviewApp.hint.paths[0].teleports.length, 1);
  assert.strictEqual(portalPreviewApp.hintPreview.viewModel.mechanic.portal.phase, 'READY');
  assert.strictEqual(portalPreviewApp.hintPreview.viewModel.mechanic.portal.instruction, portalInstructions.INITIAL);
  assert.strictEqual(
    portalPreviewApp.hintPreview.viewModel.mechanic.portal.portals.length > 0,
    true,
    'initial preview retains Portal definitions'
  );
  assert.deepStrictEqual(runnerGameplayState(portalPreviewApp.runner), portalPendingBefore,
    'Portal pending, selection and canUndo remain untouched');
  let finishHint; let requests = 0;
  const guarded = new ClearedApp(new WechatPlatform(createWxMock()), {
    solutionCatalog: solutions,
    engagement: { requestHint() { requests++; return new Promise(resolve => { finishHint = resolve; }); } }
  });
  guarded.openLevel(0, 0);
  assert.strictEqual(guarded.requestHint(), true);
  assert.strictEqual(guarded.requestHint(), false);
  assert.strictEqual(requests, 1);
  assert.strictEqual(guarded.buildModel().hintAvailable, false);
  guarded.resetCurrentLevel(); finishHint({ granted: true });
  await Promise.resolve(); await Promise.resolve();
  assert.strictEqual(guarded.hintPreview, null, 'late ad cannot affect even a reset of the same Runner');
  guarded.requestHint(); finishHint({ granted: false, reason: 'closed' });
  await Promise.resolve(); await Promise.resolve();
  assert.strictEqual(guarded.hintPreview, null);
  guarded.requestHint(); guarded.openLevel(0, 0); finishHint({ granted: true });
  await Promise.resolve(); await Promise.resolve();
  assert.strictEqual(guarded.hintPreview, null, 'late ad cannot affect a different run');
  const free = new ClearedApp(new WechatPlatform(createWxMock()), {
    solutionCatalog: solutions, adConfig: { rules: { hintMode: 'free' } }
  });
  free.openLevel(0, 0); free.performAction('play:hint');
  assert(free.hintPreview, 'the explicit free rollback policy is still immediate');

  const failedSaveApi = createWxMock();
  const failedSavePlatform = new WechatPlatform(failedSaveApi);
  const failedSaveApp = new ClearedApp(failedSavePlatform, {
    solutionCatalog: solutions, stamina: createUnlimitedStaminaFixture()
  });
  failedSaveApp.authorityMode = () => 'local-backup';
  const write = failedSaveApi.setStorageSync.bind(failedSaveApi);
  failedSaveApi.setStorageSync = (key, value) => {
    if (key === ProgressStore.STORAGE_KEY) throw Error('storage unavailable');
    write(key, value);
  };
  assert(failedSaveApp.openLevel(0, 0));
  failedSaveApp.runner.touchStart(0);
  [1, 2, 3, 4].forEach(cell => failedSaveApp.runner.touchMove(cell));
  failedSaveApp.runner.touchEnd(4);
  failedSaveApp.onPathCompleted(0, [0, 1, 2, 3, 4]);
  assert.strictEqual(failedSaveApp.result.currencyReward.status, 'local-save-failed');
  assert.strictEqual(failedSaveApp.result.currencyReward.failureSource, 'local-save');
  assert.strictEqual(failedSaveApp.buildModel().settlementMode, 'local-backup');
  assert.strictEqual(failedSaveApp.buildModel().firstClearRewardAmount, rewardConfig.currency.ordinaryFirstClear);

  const failedWalletApi = createWxMock();
  failedWalletApi.getStorageInfoSync = () => ({ keys: Object.keys(failedWalletApi.storage) });
  const failedWalletApp = new ClearedApp(new WechatPlatform(failedWalletApi), {
    solutionCatalog: solutions, stamina: createUnlimitedStaminaFixture()
  });
  failedWalletApp.authorityMode = () => 'local-backup';
  failedWalletApp.rewardUnlocks.setAuthorityMode('local-backup');
  const walletWrite = failedWalletApi.setStorageSync.bind(failedWalletApi);
  failedWalletApi.setStorageSync = (key, value) => {
    if (key === RewardUnlockService.STORAGE_KEY) throw Error('storage unavailable');
    walletWrite(key, value);
  };
  assert(failedWalletApp.openLevel(0, 0));
  failedWalletApp.runner.touchStart(0);
  [1, 2, 3, 4].forEach(cell => failedWalletApp.runner.touchMove(cell));
  failedWalletApp.runner.touchEnd(4);
  failedWalletApp.onPathCompleted(0, [0, 1, 2, 3, 4]);
  assert.strictEqual(failedWalletApp.result.currencyReward.status, 'local-save-failed');
  assert.strictEqual(failedWalletApp.result.currencyReward.failureSource, 'reward-reconcile');
  assert.strictEqual(failedWalletApp.rewardUnlocks.view().balance, 0);
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.strictEqual(failedWalletApp.performAction('reward:retry'), false);
    assert.strictEqual(failedWalletApp.result.currencyReward.status, 'local-save-failed',
      'repeated local wallet save failures must not become cloud synchronization waits');
    assert.strictEqual(failedWalletApp.result.currencyReward.failureSource, 'reward-reconcile');
    assert.strictEqual(failedWalletApp.rewardUnlocks.view().balance, 0);
  }
  failedWalletApi.setStorageSync = walletWrite;
  assert.strictEqual(failedWalletApp.performAction('reward:retry'), true);
  assert.strictEqual(failedWalletApp.result.currencyReward.status, 'granted');
  assert.strictEqual(failedWalletApp.result.currencyReward.amount, rewardConfig.currency.ordinaryFirstClear);
  assert.strictEqual(new RewardUnlockService(failedWalletApp.platform, rewardConfig).view().balance,
    rewardConfig.currency.ordinaryFirstClear, 'successful retry persists the reward');
  assert.strictEqual(failedWalletApp.performAction('reward:retry'), true);
  assert.strictEqual(failedWalletApp.rewardUnlocks.view().balance, rewardConfig.currency.ordinaryFirstClear,
    'another retry cannot grant the same first-clear reward twice');

}

module.exports = run;
