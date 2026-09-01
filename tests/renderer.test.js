const assert = require('assert');
const CanvasRenderer = require('../src/ui/canvas-renderer.js');
const GameRunner = require('../core/game-runner.js');
const classic = require('../src/skins/classic.js');
const catalog = require('../data/catalog.js');

function fakeContext() {
  const calls = [];
  const context = { calls };
  [
    'save', 'restore', 'clearRect', 'fillRect', 'beginPath', 'moveTo', 'lineTo',
    'quadraticCurveTo', 'closePath', 'fill', 'stroke', 'arc', 'translate',
    'drawImage', 'fillText'
  ].forEach(method => {
    context[method] = function () {
      calls.push({ method, args: Array.prototype.slice.call(arguments) });
    };
  });
  return context;
}

function textCalls(context, value) {
  return context.calls.filter(call => call.method === 'fillText' && call.args[0] === value);
}

function assertHitsInsideSafeArea(hits, metrics) {
  hits.forEach(hit => {
    assert(hit.rect.x >= 0 && hit.rect.x + hit.rect.w <= metrics.width,
      `${hit.id} stays inside the horizontal viewport`);
    assert(hit.rect.y >= metrics.safeTop && hit.rect.y + hit.rect.h <= metrics.safeBottom,
      `${hit.id} stays inside the vertical safe area`);
  });
}

function assertRectInsideSafeArea(rect, metrics, label) {
  assert(rect, `${label} is rendered`);
  assert(rect.x >= 0 && rect.x + rect.w <= metrics.width,
    `${label} stays inside the horizontal viewport`);
  assert(rect.y >= metrics.safeTop && rect.y + rect.h <= metrics.safeBottom,
    `${label} stays inside the vertical safe area`);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.keys(value).forEach(key => deepFreeze(value[key]));
  return Object.freeze(value);
}

function renderState(runner, options) {
  const opts = options || {};
  const state = runner.getViewState();
  const selected = new Set();
  (state.selection.segments || []).forEach(segment => {
    (segment || []).forEach(index => selected.add(index));
  });
  const portalCells = new Set();
  (state.mechanic.portals || []).forEach(portal => {
    (portal.cells || [portal.A, portal.B]).forEach(index => portalCells.add(index));
  });
  const portal = state.mechanic.id === 'portal' ? {
    icon: 'assets/icons/portal.png',
    portals: state.mechanic.portals,
    phase: state.mechanic.phase,
    expectedExit: state.mechanic.pending ? state.mechanic.pending.exit : null,
    lockedEntry: state.mechanic.locked ? state.mechanic.locked.entry : null
  } : null;
  return {
    board: {
      width: state.board.width,
      height: state.board.height,
      lines: state.board.lines,
      cells: state.board.owner.map((owner, index) => ({
        index,
        blocked: state.board.blockedMask[index] === true,
        owner,
        fixedLine: state.board.fixedLine[index],
        selected: selected.has(index),
        portal: portalCells.has(index)
      })),
      completedPaths: state.completedPaths,
      selection: state.selection,
      clearAnimation: opts.clearAnimation || null,
      hint: opts.hint || null,
      hintUntil: opts.hintUntil
    },
    mechanic: { portal },
    elapsedText: state.timeText,
    canUndo: state.canUndo,
    clearAnimation: opts.clearAnimation || null,
    hint: opts.hint || null,
    hintUntil: opts.hintUntil
  };
}

function run() {
  const platform = {
    context: fakeContext(),
    metrics: { width: 390, height: 844, safeTop: 44, safeBottom: 810 },
    createImage(source, callback) { callback(null, { source }); return {}; }
  };
  const skins = {
    current() { return classic; },
    setStyle(set) { return { background: set.Color, palette: set.Palette }; }
  };
  const renderer = new CanvasRenderer(platform, skins);
  const boardScenes = [];
  const sharedBoardDraw = renderer.boardRenderer.draw.bind(renderer.boardRenderer);
  renderer.boardRenderer.draw = function (viewModel) {
    boardScenes.push(viewModel && viewModel.scene);
    return sharedBoardDraw.apply(null, arguments);
  };
  assert(renderer.interactionMap, 'renderer exposes the shared interaction map during migration');
  const roundedRects = [];
  const drawRoundedRect = renderer.roundedRect.bind(renderer);
  renderer.roundedRect = function (x, y, w, h, radius) {
    roundedRects.push({ x, y, w, h, radius });
    return drawRoundedRect(x, y, w, h, radius);
  };
  renderer.render({ scene: 'home', completedCount: 0, totalLevels: 122, pressedId: null }, Date.now());
  assert(renderer.hitTest(110, 640), 'daily challenge is hit on the left side of the first row');
  assert(renderer.hitTest(280, 640), 'themes is hit on the right side of the first row');
  const soundHit = renderer.hits.find(hit => hit.id === 'home:sound');
  assert.strictEqual(soundHit.rect.y, platform.metrics.safeTop + classic.layout.homeTopUiOffset + 8);

  const set = {
    Name: '5 x 5',
    Color: '#00aba9',
    Palette: ['#f00'],
    Games: [{ Width: 5, Height: 1, Name: '1', Lines: [{ Start: 0, End: 4 }] }]
  };
  renderer.render({
    scene: 'levels', set, setIndex: 0, setCount: 1, pressedId: null,
    isCompleted() { return false; }
  }, Date.now());
  assert(renderer.hits.some(hit => hit.id === 'level:0'));

  renderer.render({
    scene: 'levels', set, setIndex: 0, setCount: 1, setUnlocked: false, pressedId: null,
    isCompleted() { return false; },
    isUnlocked() { return false; }
  }, Date.now());
  assert.strictEqual(renderer.hits.some(hit => hit.id === 'level:0'), false);

  const runner = new GameRunner(set.Games[0], set.Palette);
  runner.undoStack.push({});
  const hint = { lineIndex: 0, path: [0, 1, 2, 3, 4] };
  const hintUntil = Date.now() + 1000;
  const playModel = Object.assign({
    scene: 'play', set, level: set.Games[0], levelIndex: 0,
    levelEnteredAt: Date.now() - 1000, pressedId: null,
    hintAvailable: true
  }, renderState(runner, { hint, hintUntil }));
  deepFreeze(playModel.board);
  deepFreeze(playModel.mechanic);
  const frozenViewBefore = JSON.stringify({ board: playModel.board, mechanic: playModel.mechanic });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(playModel, 'runner'), false,
    'play render model is pure data and does not expose Runner');
  renderer.render(playModel, Date.now());
  assert.strictEqual(JSON.stringify({ board: playModel.board, mechanic: playModel.mechanic }), frozenViewBefore,
    'renderer does not mutate a frozen board ViewModel');
  assert(renderer.boardLayout);
  assert.deepStrictEqual(renderer.getBoardLayout(), renderer.boardLayout,
    'legacy boardLayout access and the locator API share one layout');
  const backHit = renderer.hits.find(hit => hit.id === 'play:back');
  assert.strictEqual(backHit.rect.y, platform.metrics.safeTop + classic.layout.playTopUiOffset + 12);
  const soundTopHit = renderer.hits.find(hit => hit.id === 'play:sound');
  const resetTopHit = renderer.hits.find(hit => hit.id === 'play:reset');
  assert(soundTopHit.rect.x > backHit.rect.x);
  assert.strictEqual(resetTopHit.rect.x, platform.metrics.width - 100 + classic.layout.playRightShift);
  assert.strictEqual(resetTopHit.rect.x - soundTopHit.rect.x - 42, 6);
  const hintHit = renderer.hits.find(hit => hit.id === 'play:hint');
  const undoHit = renderer.hits.find(hit => hit.id === 'play:undo');
  assert(hintHit && undoHit);
  assert.strictEqual(renderer.hits.filter(hit => hit.id === 'play:undo').length, 1);
  assert(renderer.hits.some(hit => hit.id === 'play:reset'));
  assert(hintHit.rect.x < undoHit.rect.x, 'hint and undo are split left/right');
  assert.strictEqual(renderer.cellAt(renderer.boardLayout.x + 1, renderer.boardLayout.y + 1), 0);
  assert.strictEqual(renderer.interactionMap.cellAt(renderer.boardLayout.x + 1, renderer.boardLayout.y + 1), 0);

  renderer.render(Object.assign({
    scene: 'result', set, level: set.Games[0], levelIndex: 0,
    levelEnteredAt: Date.now() - 1000, pressedId: null,
    resultVisibleAt: 0, result: { newBest: true, elapsedMs: 1200, bestMs: 1200 },
    hasNext: false
  }, renderState(runner)), Date.now());
  assert(renderer.hits.some(hit => hit.id === 'result:replay'));

  const failureVisibleAt = 5000;
  const failureResult = {
    outcome: 'failed',
    reason: 'unfilled-cells',
    remainingCells: 3,
    elapsedMs: 1200
  };
  const failureModel = Object.assign({
    scene: 'result', set, level: set.Games[0], levelIndex: 0,
    levelEnteredAt: 0, pressedId: null,
    resultVisibleAt: failureVisibleAt, result: failureResult,
    hintAvailable: true, hasNext: false
  }, renderState(runner));

  platform.context.calls.length = 0;
  renderer.render(failureModel, failureVisibleAt - 1);
  assert.deepStrictEqual(renderer.hits, [],
    'ordinary failure is modal during the result-delay animation');
  assert.strictEqual(textCalls(platform.context, '挑战失败').length, 0,
    'ordinary failure dialog stays hidden before resultVisibleAt');

  platform.context.calls.length = 0;
  roundedRects.length = 0;
  renderer.render(failureModel, failureVisibleAt + 180);
  assert.deepStrictEqual(renderer.hits.map(hit => hit.id), [
    'result:levels',
    'failure:retry'
  ], 'ordinary failure exposes exactly the level-list and retry actions');
  [
    '挑战失败',
    '还有 3 个空格未消除',
    '连接棋子的同时，需要经过全部格子',
    '返回选关',
    '重新开始'
  ].forEach(label => {
    assert.strictEqual(textCalls(platform.context, label).length, 1,
      `ordinary failure renders "${label}" exactly once`);
  });
  assertRectInsideSafeArea(
    roundedRects.find(rect => rect.w === 342 && rect.h === 238),
    platform.metrics,
    'ordinary failure panel'
  );
  assert.strictEqual(textCalls(platform.context, '重试当前关不会额外消耗次数').length, 0,
    'ordinary failure does not render the daily retry notice');
  assertHitsInsideSafeArea(renderer.hits, platform.metrics);
  platform.context.calls.filter(call => call.method === 'fillText' && [
    '挑战失败',
    '还有 3 个空格未消除',
    '连接棋子的同时，需要经过全部格子',
    '返回选关',
    '重新开始'
  ].indexOf(call.args[0]) >= 0).forEach(call => {
    assert(call.args[2] >= platform.metrics.safeTop && call.args[2] <= platform.metrics.safeBottom,
      `ordinary failure text "${call.args[0]}" stays inside the vertical safe area`);
  });

  platform.context.calls.length = 0;
  renderer.render(Object.assign({}, failureModel, { isPortalTrial: true }), failureVisibleAt + 180);
  assert.strictEqual(textCalls(platform.context, '返回主页').length, 1,
    'portal trial failure returns to the home scene');
  assert.strictEqual(textCalls(platform.context, '返回选关').length, 0,
    'portal trial failure does not expose the ordinary level-list label');

  const dailyChallenge = Object.assign({
    Color: set.Color,
    Palette: set.Palette
  }, set.Games[0]);
  const dailyFailureModel = Object.assign({
    scene: 'dailyResult', challenge: dailyChallenge,
    dailyLevelIndex: 1, dailyLevelCount: 2, dailyDateKey: '2026-09-01',
    levelEnteredAt: 0, pressedId: null,
    dailyResultVisibleAt: failureVisibleAt,
    result: {
      outcome: 'failed',
      reason: 'unfilled-cells',
      remainingCells: 4,
      elapsedMs: 1200
    },
    hintAvailable: true,
    dailyEntriesRemaining: 2,
    dailyEntryLimit: 3
  }, renderState(runner));

  platform.context.calls.length = 0;
  renderer.render(dailyFailureModel, failureVisibleAt - 1);
  assert.deepStrictEqual(renderer.hits, [],
    'daily failure is modal during the result-delay animation');
  assert.strictEqual(textCalls(platform.context, '挑战失败').length, 0,
    'daily failure dialog stays hidden before dailyResultVisibleAt');

  platform.context.calls.length = 0;
  roundedRects.length = 0;
  renderer.render(dailyFailureModel, failureVisibleAt + 180);
  assert.deepStrictEqual(renderer.hits.map(hit => hit.id), [
    'dailyResult:home',
    'dailyFailure:retry'
  ], 'daily failure exposes exactly the home and retry-current-level actions');
  [
    '挑战失败',
    '还有 4 个空格未消除',
    '连接棋子的同时，需要经过全部格子',
    '重试当前关不会额外消耗次数',
    '返回主页',
    '重试本关'
  ].forEach(label => {
    assert.strictEqual(textCalls(platform.context, label).length, 1,
      `daily failure renders "${label}" exactly once`);
  });
  assertRectInsideSafeArea(
    roundedRects.find(rect => rect.w === 342 && rect.h === 254),
    platform.metrics,
    'daily failure panel'
  );
  assertHitsInsideSafeArea(renderer.hits, platform.metrics);
  platform.context.calls.filter(call => call.method === 'fillText' && [
    '挑战失败',
    '还有 4 个空格未消除',
    '连接棋子的同时，需要经过全部格子',
    '重试当前关不会额外消耗次数',
    '返回主页',
    '重试本关'
  ].indexOf(call.args[0]) >= 0).forEach(call => {
    assert(call.args[2] >= platform.metrics.safeTop && call.args[2] <= platform.metrics.safeBottom,
      `daily failure text "${call.args[0]}" stays inside the vertical safe area`);
  });

  [
    { width: 320, height: 568, safeTop: 54, safeBottom: 548 },
    { width: 768, height: 1024, safeTop: 30, safeBottom: 1000 }
  ].forEach(metrics => {
    platform.metrics = metrics;
    roundedRects.length = 0;
    renderer.render(failureModel, failureVisibleAt + 180);
    const ordinaryPanel = roundedRects.find(rect => rect.radius === 16 && rect.h === 238);
    assertRectInsideSafeArea(ordinaryPanel, metrics, `ordinary failure panel at ${metrics.width}`);
    assertHitsInsideSafeArea(renderer.hits, metrics);
    renderer.hits.forEach(hit => {
      assert(hit.rect.h >= 44, `${hit.id} keeps a 44px touch target at ${metrics.width}`);
    });

    roundedRects.length = 0;
    renderer.render(dailyFailureModel, failureVisibleAt + 180);
    const dailyPanel = roundedRects.find(rect => rect.radius === 16 && rect.h === 254);
    assertRectInsideSafeArea(dailyPanel, metrics, `daily failure panel at ${metrics.width}`);
    assertHitsInsideSafeArea(renderer.hits, metrics);
  });

  platform.metrics = { width: 390, height: 844, safeTop: 44, safeBottom: 810 };

  const tallSet = catalog.sets[5];
  const tallLevel = tallSet.Games[0];
  [
    { width: 320, height: 568, safeTop: 54, safeBottom: 548 },
    { width: 768, height: 1024, safeTop: 30, safeBottom: 1000 }
  ].forEach(metrics => {
    platform.metrics = metrics;
    const tallRunner = new GameRunner(tallLevel, tallSet.Palette);
    renderer.render(Object.assign({
      scene: 'play', set: tallSet, level: tallLevel, levelIndex: 0,
      levelEnteredAt: Date.now() - 1000, pressedId: null
    }, renderState(tallRunner)), Date.now());
    assert(renderer.boardLayout.cell > 25);
    assert(renderer.boardLayout.x >= 0);
    assert(renderer.boardLayout.y >= metrics.safeTop);
    assert(renderer.boardLayout.y + renderer.boardLayout.cell * tallLevel.Height <= metrics.safeBottom);
  });
  assert(boardScenes.indexOf('play') >= 0 && boardScenes.indexOf('dailyResult') >= 0,
    'ordinary and daily scenes share the same BoardRenderer instance');
}

module.exports = run;
