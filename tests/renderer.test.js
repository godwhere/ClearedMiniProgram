const assert = require('assert');
const CanvasRenderer = require('../src/ui/canvas-renderer.js');
const GameRunner = require('../core/game-runner.js');
const classic = require('../src/skins/classic.js');
const catalog = require('../data/catalog.js');
const dailyChallenges = require('../data/daily-challenges.js');

function fakeContext() {
  const calls = [];
  const context = { calls };
  [
    'save', 'restore', 'clearRect', 'fillRect', 'beginPath', 'moveTo', 'lineTo',
    'quadraticCurveTo', 'closePath', 'fill', 'stroke', 'arc', 'translate',
    'drawImage', 'fillText', 'clip'
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

function resultPanelRect(context, metrics, height) {
  const call = context.calls.find(item => item.method === 'fillRect' &&
    item.args[0] === 0 && item.args[2] === metrics.width && item.args[3] === height);
  return call && { x: call.args[0], y: call.args[1], w: call.args[2], h: call.args[3] };
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

function testHomeAvatar() {
  const context = fakeContext();
  const loads = [];
  const platform = { context, metrics: { width: 320, height: 568, safeTop: 44, safeBottom: 548 },
    createImage(source, callback) {
      if (source.startsWith('https://')) loads.push({ source, callback });
      else callback(null, { source });
    } };
  const renderer = new CanvasRenderer(platform, { current: () => classic });
  const first = { nickname: 'First', avatarUrl: 'https://example.test/a.png' };
  const second = { nickname: 'Second', avatarUrl: 'https://example.test/b.png' };
  renderer.drawHome({ accountProfile: first });
  const target = renderer.hits.find(hit => hit.id === 'home:account');
  assert.deepStrictEqual(target.rect, { x: 18, y: 44 + (classic.layout.homeTopUiOffset || 0) + 8, w: 44, h: 44 });
  assert.strictEqual(textCalls(context, '账号').length, 0, 'the home entry no longer draws the account text');
  assert(context.calls.some(call => call.method === 'arc' && call.args[0] === target.rect.x + 22), 'loading uses a visible default portrait');
  assert.strictEqual(loads.length, 1);
  const image = { width: 80, height: 120 };
  loads[0].callback(null, image);
  context.calls.length = 0;
  renderer.drawHome({ accountProfile: first });
  const drawn = context.calls.find(call => call.method === 'drawImage' && call.args[0] === image);
  assert(drawn, 'the home entry renders the player image after it loads');
  assert.strictEqual(drawn.args[3] / drawn.args[4], image.width / image.height, 'non-square avatars retain their proportions');
  assert(context.calls.some(call => call.method === 'clip'), 'the image stays inside the circular avatar');
  renderer.drawAccount({ accountProfile: first, accountStatus: 'local' });
  assert.strictEqual(loads.length, 1, 'home and account scenes share the same avatar request');
  renderer.drawHome({ accountProfile: second });
  assert.strictEqual(loads.length, 2);
  loads[0].callback(null, image);
  context.calls.length = 0;
  renderer.drawHome({ accountProfile: second });
  assert(!context.calls.some(call => call.method === 'drawImage' && call.args[0] === image), 'late old-account images cannot replace the new avatar');
  loads[1].callback(new Error('offline'));
  context.calls.length = 0;
  renderer.drawHome({ accountProfile: second });
  assert.strictEqual(loads.length, 2, 'image failures do not retry on every frame');
  assert(context.calls.some(call => call.method === 'arc' && call.args[0] === target.rect.x + 22));
  renderer.drawHome({ accountProfile: null });
  loads[1].callback(null, image);
  context.calls.length = 0;
  renderer.drawHome({ accountProfile: null });
  assert(!context.calls.some(call => call.method === 'drawImage' && call.args[0] === image), 'cleared profile data invalidates pending avatar loads');
}

function testClearFeedback() {
  let offset = 0;
  const stack = [];
  const clears = [];
  const context = fakeContext();
  context.save = () => { stack.push(offset); };
  context.restore = () => { offset = stack.pop(); };
  context.translate = x => { offset += x; };
  context.clearRect = () => { clears.push(offset); };
  const platform = {
    context,
    metrics: { width: 390, height: 844, safeTop: 44, safeBottom: 810 },
    createImage(source, callback) { callback(null, { source }); return {}; }
  };
  const renderer = new CanvasRenderer(platform, { current: () => classic });
  const positions = [];
  renderer.renderScene = () => {
    renderer.begin('#fff');
    positions.push(offset);
    renderer.addHit('play:reset', { x: 20, y: 50, w: 44, h: 44 }, true);
  };
  const feedback = { startedAt: 1000, durationMs: 180 };
  for (const width of [320, 390, 430]) {
    platform.metrics.width = width;
    for (const scene of ['play', 'result', 'daily', 'dailyResult']) {
      renderer.render({ scene, clearFeedback: feedback }, 1000);
      const initial = positions[positions.length - 1];
      assert(initial > 0 && initial <= 3, 'clear feedback is visible and bounded in logical pixels');
      renderer.render({ scene, clearFeedback: feedback }, 1030);
      assert(positions[positions.length - 1] < 0, 'feedback changes direction');
      renderer.render({ scene, clearFeedback: feedback }, 1150);
      assert(Math.abs(positions[positions.length - 1]) < initial, 'feedback decays');
      renderer.render({ scene, clearFeedback: feedback }, 1180);
      assert.strictEqual(positions[positions.length - 1], 0, 'feedback finishes at the original position');
      assert.strictEqual(renderer.hitTest(42, 72), 'play:reset', 'touch geometry stays stable');
      assert.strictEqual(offset, 0, 'canvas transforms do not leak across frames');
    }
  }
  renderer.render({ scene: 'home', clearFeedback: feedback }, 1000);
  assert.strictEqual(positions[positions.length - 1], 0, 'feedback never shakes another scene');
  assert(clears.every(value => value === 0), 'the full viewport is cleared without shifted edge trails');
}

function run() {
  testClearFeedback();
  testHomeAvatar();
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
  renderer.render({ scene: 'account', accountStatus: 'local', profileSupported: false }, Date.now());
  assertHitsInsideSafeArea(renderer.hits, platform.metrics);
  assert(renderer.hits.some(hit => hit.id === 'account:back'));
  assert(!renderer.hits.some(hit => hit.id === 'account:authorizeProfile'));
  platform.context.calls.length = 0;
  renderer.render({ scene: 'account', accountStatus: 'pending', profileSupported: false }, Date.now());
  assert.strictEqual(textCalls(platform.context, '等待同步').length, 1);
  renderer.render({ scene: 'account', accountStatus: 'syncing', profileSupported: true, profilePending: true, syncPending: true }, Date.now());
  assert(!renderer.hits.some(hit => hit.id === 'account:retrySync'));
  assert(!renderer.hits.some(hit => hit.id === 'account:authorizeProfile'));
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
  renderer.render({ scene: 'home', completedCount: 0, totalLevels: 92, pressedId: null }, Date.now());
  assert(renderer.hitTest(110, 640), 'daily challenge is hit on the left side of the first row');
  assert(renderer.hitTest(280, 640), 'themes is hit on the right side of the first row');
  const soundHit = renderer.hits.find(hit => hit.id === 'home:sound');
  assert.strictEqual(soundHit.rect.y, platform.metrics.safeTop + classic.layout.homeTopUiOffset + 8);

  for (const width of [320, 390]) {
    platform.metrics.width = width;
    platform.context.calls.length = 0;
    renderer.render({ scene: 'home', completedCount: 23, totalLevels: 92 }, Date.now());
    const title = textCalls(platform.context, '清空每一格');
    assert.strictEqual(title.length, 1, 'home displays the Chinese title');
    assert.strictEqual(title[0].args[1], width / 2, 'home title remains centered');
    assert.strictEqual(textCalls(platform.context, 'CLEARED!').length, 0, 'home no longer displays the old title');
    const start = renderer.hits.find(hit => hit.id === 'home:start').rect;
    const label = textCalls(platform.context, '继续游戏')[0].args;
    const progress = textCalls(platform.context, '23/92');
    assert.strictEqual(label[1], start.x + start.w / 2, 'continue label keeps its horizontal center');
    assert.strictEqual(label[2], start.y + start.h / 2, 'continue label keeps its vertical center');
    assert.strictEqual(start.h, 54);
    assert.strictEqual(progress.length, 1, 'progress is no longer repeated below the logo');
    assert(progress[0].args[1] > label[1] && progress[0].args[1] < start.x + start.w);
    assert.strictEqual(progress[0].args[2], label[2]);
    assert.strictEqual(renderer.hitTest(progress[0].args[1] - 1, progress[0].args[2]), 'home:start');
    assert(!platform.context.calls.some(call => call.method === 'fillText' && String(call.args[0]).startsWith('已完成')));
  }

  const set = {
    Name: '5 x 5',
    Color: '#00aba9',
    Palette: ['#f00'],
    Games: [{ Width: 5, Height: 1, Name: '1', Lines: [{ Start: 0, End: 4 }] }]
  };
  const firstPageItems = catalog.levels.slice(0, 25).map((entry, index) => ({
    action: `level:${entry.setIndex}:${entry.levelIndex}`,
    displayNumber: index + 1,
    completed: index === 0,
    unlocked: index === 0
  }));
  platform.context.calls.length = 0;
  renderer.render({
    scene: 'levels', levelItems: firstPageItems,
    levelPageIndex: 0, levelPageCount: 4,
    levelRangeStart: 1, levelRangeEnd: 25,
    totalLevels: 92, pressedId: null
  }, Date.now());
  assert.strictEqual(textCalls(platform.context, '选择关卡').length, 1);
  assert.strictEqual(textCalls(platform.context, '1–25 / 92').length, 1);
  assert(renderer.hits.some(hit => hit.id === 'level:0:0'));
  assert.strictEqual(renderer.hits.some(hit => hit.id === 'level:0:1'), false,
    'locked continuous levels do not register a hit');
  assert(renderer.hits.some(hit => hit.id === 'levels:next'));
  assert.strictEqual(renderer.hits.some(hit => hit.id === 'levels:prev'), false);

  const lastPageItems = catalog.levels.slice(125).map((entry, index) => ({
    action: `level:${entry.setIndex}:${entry.levelIndex}`,
    displayNumber: 126 + index,
    completed: false,
    unlocked: true
  }));
  renderer.render({
    scene: 'levels', levelItems: lastPageItems,
    levelPageIndex: 5, levelPageCount: 6,
    levelRangeStart: 126, levelRangeEnd: 137,
    totalLevels: 137, pressedId: null
  }, Date.now());
  assert.strictEqual(renderer.hits.filter(hit => hit.id.indexOf('level:') === 0).length, 12);
  assert.strictEqual(textCalls(platform.context, '126–137 / 137').length, 1);
  assert(renderer.hits.some(hit => hit.id === lastPageItems[0].action));
  assert(renderer.hits.some(hit => hit.id === lastPageItems[11].action));
  assert(renderer.hits.some(hit => hit.id === 'levels:prev'));
  assert.strictEqual(renderer.hits.some(hit => hit.id === 'levels:next'), false);

  const runner = new GameRunner(set.Games[0], set.Palette);
  runner.undoStack.push({});
  const hint = { lineIndex: 0, path: [0, 1, 2, 3, 4] };
  const hintUntil = Date.now() + 1000;
  const playModel = Object.assign({
    scene: 'play', set, level: set.Games[0], levelIndex: 0,
    ordinaryLevelNumber: 33, ordinaryLevelCount: 92,
    levelEnteredAt: Date.now() - 1000, pressedId: null,
    hintAvailable: true
  }, renderState(runner, { hint, hintUntil }));
  deepFreeze(playModel.board);
  deepFreeze(playModel.mechanic);
  const frozenViewBefore = JSON.stringify({ board: playModel.board, mechanic: playModel.mechanic });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(playModel, 'runner'), false,
    'play render model is pure data and does not expose Runner');
  platform.context.calls.length = 0;
  renderer.render(playModel, Date.now());
  assert.strictEqual(textCalls(platform.context, '33 / 92').length, 1,
    'ordinary play uses the continuous catalog number');
  assert.strictEqual(JSON.stringify({ board: playModel.board, mechanic: playModel.mechanic }), frozenViewBefore,
    'renderer does not mutate a frozen board ViewModel');
  assert(renderer.boardLayout);
  assert.deepStrictEqual(renderer.getBoardLayout(), renderer.boardLayout,
    'legacy boardLayout access and the locator API share one layout');
  const backHit = renderer.hits.find(hit => hit.id === 'play:back');
  assert.strictEqual(backHit.rect.y + backHit.rect.h / 2, platform.metrics.safeTop + classic.layout.playTopUiOffset + 27);
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

  platform.context.calls.length = 0;
  renderer.render(Object.assign({
    scene: 'result', set, level: set.Games[0], levelIndex: 0,
    levelEnteredAt: 0, pressedId: null, resultVisibleAt: 0, settlementMode: 'local-backup',
    result: { newBest: true, elapsedMs: 1200, bestMs: 1200, persisted: false,
      currencyReward: { status: 'local-save-failed', failureSource: 'local-save', amount: 0 } }, hasNext: false
  }, renderState(runner)), Date.now());
  assert.strictEqual(textCalls(platform.context, '本地保存未成功，点击重试').length, 1);
  assert(renderer.hits.some(hit => hit.id === 'reward:retry'));

  platform.context.calls.length = 0;
  renderer.render(Object.assign({
    scene: 'dailyResult', challenge: set.Games[0], dailyLevelIndex: 1, dailyLevelCount: 2,
    dailyDateKey: '2026-09-07', dailyResultVisibleAt: 0, resultVisibleAt: 0,
    dailyEntriesRemaining: 1, dailyEntryLimit: 3, settlementMode: 'local-backup',
    result: { elapsedMs: 2200, persisted: false,
      currencyReward: { status: 'local-save-failed', failureSource: 'local-save', amount: 0 } }
  }, renderState(runner)), Date.now());
  assert.strictEqual(textCalls(platform.context, '本地保存未成功，点击重试').length, 1);
  assert(renderer.hits.some(hit => hit.id === 'reward:retry'));

  platform.context.calls.length = 0;
  renderer.render(Object.assign({
    scene: 'result', set, level: set.Games[0], levelIndex: 0,
    levelEnteredAt: 0, pressedId: null, resultVisibleAt: 0, settlementMode: 'cloud-authoritative',
    firstClearRewardAmount: 100,
    result: { newBest: true, elapsedMs: 1200, bestMs: 1200,
      currencyReward: { status: 'pending', amount: 0 } }, hasNext: false
  }, renderState(runner)), Date.now());
  assert.strictEqual(textCalls(platform.context, '首通奖励 100 货币').length, 1,
    'cloud settlement shows the reward amount without asking the player to synchronize it');
  assert.strictEqual(textCalls(platform.context, '奖励待同步').length, 0);
  assert.strictEqual(textCalls(platform.context, '获得 100 货币').length, 0,
    'a displayed first-clear amount is not a claim that the wallet has already been credited');
  assert.strictEqual(renderer.hits.some(hit => hit.id === 'reward:retry'), false);
  assert.strictEqual(textCalls(platform.context, '本地保存未成功，点击重试').length, 0);

  for (const scene of ['result', 'dailyResult']) {
    const amount = scene === 'dailyResult' ? 500 : 100;
    const claimed = scene === 'dailyResult' ? '今日奖励已领取' : '本关奖励已领取';
    for (const [status, persisted, expected, retry] of [
      ['pending', true, `首通奖励 ${amount} 货币`, false],
      ['granted', true, `获得 ${amount} 货币`, false],
      ['already-claimed', true, claimed, false],
      ['pending', false, '本地保存未成功，点击重试', true],
      ['failed', true, '奖励未到账', false]
    ]) {
      platform.context.calls.length = 0;
      renderer.render(Object.assign({ scene, set, level: set.Games[0], challenge: set.Games[0], levelIndex: 0,
        levelEnteredAt: 0, pressedId: null, resultVisibleAt: 0, dailyResultVisibleAt: 0,
        dailyLevelIndex: 1, dailyLevelCount: 2, dailyEntriesRemaining: 1, dailyEntryLimit: 3,
        settlementMode: 'cloud-authoritative', firstClearRewardAmount: amount, hasNext: false,
        result: { elapsedMs: 1200, bestMs: 1200, persisted,
          currencyReward: { status, amount: status === 'granted' ? amount : 0 } }
      }, renderState(runner)), Date.now());
      assert.strictEqual(textCalls(platform.context, expected).length, 1, `${scene}: ${status}, persisted=${persisted}`);
      assert.strictEqual(textCalls(platform.context, '奖励待同步').length, 0);
      assert.strictEqual(textCalls(platform.context, '奖励同步失败').length, 0);
      assert.strictEqual(renderer.hits.some(hit => hit.id === 'reward:retry'), retry);
    }
  }

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
    resultPanelRect(platform.context, platform.metrics, 246),
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
    resultPanelRect(platform.context, platform.metrics, 268),
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
    platform.context.calls.length = 0;
    renderer.render(failureModel, failureVisibleAt + 180);
    const ordinaryPanel = resultPanelRect(platform.context, metrics, 246);
    assertRectInsideSafeArea(ordinaryPanel, metrics, `ordinary failure panel at ${metrics.width}`);
    assertHitsInsideSafeArea(renderer.hits, metrics);
    renderer.hits.forEach(hit => {
      assert(hit.rect.h >= 44, `${hit.id} keeps a 44px touch target at ${metrics.width}`);
    });

    roundedRects.length = 0;
    platform.context.calls.length = 0;
    renderer.render(dailyFailureModel, failureVisibleAt + 180);
    const dailyPanel = resultPanelRect(platform.context, metrics, 268);
    assertRectInsideSafeArea(dailyPanel, metrics, `daily failure panel at ${metrics.width}`);
    assertHitsInsideSafeArea(renderer.hits, metrics);
  });

  platform.metrics = { width: 390, height: 844, safeTop: 44, safeBottom: 810 };

  const tallLevel = dailyChallenges.Days[0].Levels[1];
  const tallSet = {
    Name: 'High Difficulty',
    Color: '#a4c400',
    Palette: tallLevel.Palette,
    Games: [tallLevel]
  };
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
