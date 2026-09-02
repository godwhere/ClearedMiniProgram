'use strict';

const assert = require('assert');
const CanvasRenderer = require('../src/ui/canvas-renderer.js');
const BoardRenderer = require('../src/ui/board/board-renderer.js');
const PortalOverlay = require('../src/ui/board/portal-overlay.js');
const GameRunner = require('../core/game-runner.js');
const classic = require('../src/skins/classic.js');
const catalog = require('../data/catalog-v2.js');
const portalSet = catalog.sets[1];
const portalInstructions = require('../src/ui/portal-instructions.js');

function createMockContext() {
  const calls = [];
  const context = {
    calls
  };
  [
    'save', 'restore', 'clearRect', 'fillRect', 'beginPath', 'moveTo', 'lineTo',
    'quadraticCurveTo', 'closePath', 'fill', 'stroke', 'arc', 'translate',
    'drawImage', 'fillText', 'strokeRect'
  ].forEach(method => {
    context[method] = function (...args) {
      calls.push({ method, args });
    };
  });
  return context;
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
    (portal.cells || portal.Cells || [portal.A, portal.B]).forEach(index => portalCells.add(index));
  });
  const pending = state.mechanic.pending;
  const expectedExits = pending && Array.isArray(pending.eligibleExits)
    ? pending.eligibleExits
    : (pending && Array.isArray(pending.expectedExits)
      ? pending.expectedExits
      : (pending && Number.isInteger(pending.exit) ? [pending.exit] : []));
  const portal = state.mechanic.id === 'portal' ? {
    icon: 'assets/icons/portal.png',
    rulesVersion: state.mechanic.rulesVersion,
    portals: state.mechanic.portals,
    phase: state.mechanic.phase,
    expectedExits,
    expectedExit: state.mechanic.rulesVersion === 1 && expectedExits.length === 1
      ? expectedExits[0] : null,
    instruction: opts.portalInstruction === undefined
      ? portalInstructions.forState(state.mechanic) : opts.portalInstruction,
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
  const ctx = createMockContext();
  let imageRequested = null;
  const platform = {
    context: ctx,
    metrics: { width: 390, height: 844, safeTop: 44, safeBottom: 810 },
    createImage(source, callback) {
      imageRequested = source;
      callback(null, { source, width: 512, height: 512 });
      return {};
    }
  };
  const skins = {
    current() { return classic; },
    setStyle(set) { return { background: set.Color, palette: set.Palette }; }
  };

  const renderer = new CanvasRenderer(platform, skins);
  const tileDraws = [];
  const textDraws = [];
  const originalDrawTile = renderer.drawTile.bind(renderer);
  const originalText = renderer.text.bind(renderer);
  renderer.drawTile = (lineIndex, x, y, size, options) => {
    const cellIndex = renderer.cellAt(x + size / 2, y + size / 2);
    tileDraws.push({ lineIndex, cellIndex, color: options && options.color });
    return originalDrawTile(lineIndex, x, y, size, options);
  };
  renderer.text = (value, x, y, size, options) => {
    textDraws.push({ value, x, y, size, options: options || {} });
    return originalText(value, x, y, size, options);
  };

  const portalLevel = portalSet.Games[4]; // 5x5, A: 21, B: 2
  const runner = new GameRunner(portalLevel, portalSet.Palette);
  const fallbackState = renderer.fallbackBoardViewModel({
    portalStatus: { phase: 'READY', icon: 'assets/icons/portal.png' }
  }, Object.assign({}, portalLevel, { Instructions: '旧关卡说明应被忽略' }));
  assert.deepStrictEqual(fallbackState.mechanic.portal.portals[0].cells, [21, 2],
    'raw Portal v2 Cells are normalized for the renderer compatibility path');
  assert.strictEqual(fallbackState.mechanic.portal.instruction, portalInstructions.INITIAL,
    'renderer compatibility path uses the shared initial prompt, not per-level copy');
  const continuingFallbackState = renderer.fallbackBoardViewModel({
    portalStatus: { phase: 'PORTAL_CONTINUE', icon: 'assets/icons/portal.png' }
  }, portalLevel);
  assert.strictEqual(continuingFallbackState.mechanic.portal.instruction, null,
    'renderer compatibility path hides static instructions after portal continuation starts');
  assert.strictEqual(renderer.fallbackBoardViewModel({
    portalStatus: { phase: 'DRAWING', usedPairIds: ['P1'] }
  }, portalLevel).mechanic.portal.instruction, null,
  'the fallback also keeps the prompt hidden after leaving the exit');

  // 1. Initial play scene rendering
  const initialState = renderState(runner);
  deepFreeze(initialState.board);
  deepFreeze(initialState.mechanic);
  const initialBefore = JSON.stringify(initialState);
  const initialModel = Object.assign({
    scene: 'play',
    set: portalSet,
    level: portalLevel,
    levelIndex: 4,
    ordinaryLevelNumber: 7,
    ordinaryLevelCount: 92,
    levelEnteredAt: Date.now() - 1000,
    pressedId: null,
    hintAvailable: true,
  }, initialState);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(initialModel, 'runner'), false,
    'portal render model never exposes Runner');
  renderer.render(initialModel, Date.now());
  assert.strictEqual(JSON.stringify(initialState), initialBefore,
    'renderer does not mutate a frozen portal ViewModel');

  assert(renderer.boardLayout, 'board layout should exist');
  assert.strictEqual(imageRequested, 'assets/icons/portal.png', 'portal icon should be requested');
  assert(ctx.calls.some(c => c.method === 'drawImage'), 'drawImage should be called for portal');
  assert(textDraws.some(call => call.value === '7 / 92'),
    'Portal levels keep the numeric mainline title');
  assert.strictEqual(textDraws.some(call => call.value === portalLevel.Name), false,
    'level names are not drawn in the title');
  assert(textDraws.some(call => call.value === portalInstructions.INITIAL),
    'initial Portal prompt is shown above the board');
  assert.strictEqual(textDraws.some(call => call.value === 'P1'), false,
    'portal ids remain internal and are never drawn');
  const initialLayout = Object.assign({}, renderer.boardLayout);
  assert(tileDraws.filter(call => call.cellIndex === 2 || call.cellIndex === 21)
    .every(call => call.lineIndex === -1), 'portal cells render only an empty base tile');

  // 2. Portal instructions use a stable band above the board and breathe.
  runner.touchStart(0);
  [1, 6, 5, 10, 11, 16, 15, 20, 21].forEach(c => runner.touchMove(c));
  assert.strictEqual(runner.portalPhase, 'PORTAL_LOCKED');

  const lockedModel = Object.assign({
    scene: 'play',
    set: portalSet,
    level: portalLevel,
    levelIndex: 4,
    ordinaryLevelNumber: 7,
    ordinaryLevelCount: 92,
    levelEnteredAt: 0,
    pressedId: null,
    hintAvailable: true,
    portalInstruction: portalInstructions.CONTINUE
  }, renderState(runner, { portalInstruction: portalInstructions.CONTINUE }));
  textDraws.length = 0;
  renderer.render(lockedModel, 1800);
  const lockedPromptA = textDraws.find(call => call.value === portalInstructions.CONTINUE);
  assert(lockedPromptA, 'PORTAL_LOCKED draws the release instruction');
  assert.deepStrictEqual(renderer.boardLayout, initialLayout,
    'reserving the portal prompt band keeps the board stationary');
  const headerBottom = platform.metrics.safeTop + classic.layout.playTopUiOffset + 70;
  assert(lockedPromptA.y > headerBottom && lockedPromptA.y < renderer.boardLayout.y,
    'portal instructions sit between the header and board');
  assert(renderer.boardLayout.y - lockedPromptA.y >= 8,
    'portal instructions keep clear space above the board');

  textDraws.length = 0;
  renderer.render(lockedModel, 2250);
  const lockedPromptB = textDraws.find(call => call.value === portalInstructions.CONTINUE);
  assert(lockedPromptB.size > lockedPromptA.size,
    'portal instruction font size changes gently across the breathing cycle');
  assert(lockedPromptB.options.alpha > lockedPromptA.options.alpha,
    'portal instruction opacity changes gently across the breathing cycle');
  assert.strictEqual(lockedPromptB.y, lockedPromptA.y,
    'breathing never moves the instruction band');

  runner.touchEnd(-1);
  assert.strictEqual(runner.portalPhase, 'PORTAL_WAIT');

  ctx.calls.length = 0;
  tileDraws.length = 0;
  textDraws.length = 0;
  renderer.render(Object.assign({
    scene: 'play',
    set: portalSet,
    level: portalLevel,
    levelIndex: 4,
    ordinaryLevelNumber: 7,
    ordinaryLevelCount: 92,
    levelEnteredAt: Date.now() - 1000,
    pressedId: null,
    hintAvailable: true,
    expectedExit: 2,
    expectedExits: [2],
    portalInstruction: portalInstructions.CONTINUE
  }, renderState(runner, {
    portalInstruction: portalInstructions.CONTINUE
  })), Date.now());

  assert(textDraws.some(call => call.value === portalInstructions.CONTINUE),
    'PORTAL_WAIT draws the continuation instruction');
  assert(textDraws.some(call => call.value === '7 / 92'),
    'portal phase changes never replace the numeric header title');
  assert.deepStrictEqual(renderer.boardLayout, initialLayout,
    'LOCKED and WAIT share the same board layout');
  assert(tileDraws.filter(call => call.cellIndex === 2 || call.cellIndex === 21)
    .every(call => call.lineIndex === -1),
  'selected portal entry must not draw a themed line tile under the icon');

  runner.touchStart(2);
  assert.strictEqual(runner.portalPhase, 'PORTAL_CONTINUE');
  textDraws.length = 0;
  renderer.render(Object.assign({
    scene: 'play',
    set: portalSet,
    level: portalLevel,
    levelIndex: 4,
    ordinaryLevelNumber: 7,
    ordinaryLevelCount: 92,
    levelEnteredAt: 0,
    pressedId: null,
    hintAvailable: true,
  }, renderState(runner)), 2300);
  assert.strictEqual(textDraws.some(call =>
    call.value === portalInstructions.INITIAL || call.value === portalInstructions.CONTINUE), false,
  'portal instruction disappears once continuation begins');
  assert.deepStrictEqual(renderer.boardLayout, initialLayout,
    'hiding the portal instruction does not move the board');

  // 3. drawHintPath with segmented hint
  const segmentedHint = {
    lineIndex: 0,
    segments: [
      [0, 1, 6, 5, 10, 11, 16, 15, 20, 21],
      [2, 3, 4, 9, 8, 7, 12, 13, 14, 19, 18, 17, 22, 23, 24]
    ],
    teleports: [{ portalId: 'P1', from: 21, to: 2 }]
  };
  ctx.calls.length = 0;
  tileDraws.length = 0;
  renderer.drawHintPath(segmentedHint, portalSet.Palette, Date.now(), [2, 21]);
  assert.strictEqual(tileDraws.length, 23, 'hint draws every non-portal path cell');
  assert.strictEqual(tileDraws.some(call => call.cellIndex === 2 || call.cellIndex === 21), false,
    'hint never draws a themed tile on either portal cell');

  const vectorStrokes = [];
  const vectorContext = createMockContext();
  vectorContext.stroke = function () {
    vectorStrokes.push({ color: this.strokeStyle, width: this.lineWidth });
    this.calls.push({ method: 'stroke', args: [] });
  };
  const vectorTiles = [];
  const vectorBoard = new BoardRenderer({
    getSkin() { return classic; },
    getContext() { return vectorContext; },
    drawTile(lineIndex, x, y, size, options) {
      vectorTiles.push({ lineIndex, color: options.color });
    }
  });
  const completeHint = {
    paths: [
      segmentedHint,
      { lineIndex: 1, path: [5, 6, 7] }
    ]
  };
  vectorBoard.drawHintPaths(
    completeHint,
    ['#f00', '#0f0'],
    100,
    { x: 0, y: 0, cell: 40, cols: 5, rows: 5 },
    new Set([2, 21])
  );
  assert(vectorTiles.some(tile => tile.lineIndex === 0 && tile.color === '#f00'));
  assert(vectorTiles.some(tile => tile.lineIndex === 1 && tile.color === '#0f0'),
    'every complete-solution route uses its matching palette color');
  assert.strictEqual(vectorStrokes.filter(stroke => stroke.color === '#f00').length, 4,
    'two Portal segments draw two independent center lines and two arrows');
  assert.strictEqual(vectorStrokes.filter(stroke => stroke.color === '#0f0').length, 2,
    'an ordinary route draws its center line and direction arrow');
  assert.strictEqual(vectorContext.calls.some((call, index, calls) => (
    call.method === 'moveTo' && call.args[0] === 60 && call.args[1] === 180 &&
    calls[index + 1] && calls[index + 1].method === 'lineTo'
  )), true, 'the entry-segment arrow is anchored at and points into the entry portal');
  assert.strictEqual(vectorContext.calls.some((call, index, calls) => (
    call.method === 'lineTo' && call.args[0] === 140 && call.args[1] === 20 &&
    index > 0 && calls[index - 1].method === 'moveTo' &&
    calls[index - 1].args[0] === 100 && calls[index - 1].args[1] === 20
  )), true, 'the exit segment begins at the exit portal and points outward');
  assert.strictEqual(vectorContext.calls.some((call, index, calls) => (
    call.method === 'lineTo' && call.args[0] === 100 && call.args[1] === 20 &&
    index > 0 && calls[index - 1].method === 'moveTo' &&
    calls[index - 1].args[0] === 60 && calls[index - 1].args[1] === 180
  )), false, 'no continuous line is drawn between teleport endpoints');

  vectorStrokes.length = 0;
  vectorBoard.drawHintPath(
    { lineIndex: 0, path: [0, 1] },
    ['#f00'],
    100,
    { x: 0, y: 0, cell: 20, cols: 2, rows: 1 },
    new Set()
  );
  const narrowWidth = vectorStrokes[0].width;
  vectorStrokes.length = 0;
  vectorBoard.drawHintPath(
    { lineIndex: 0, path: [0, 1] },
    ['#f00'],
    100,
    { x: 0, y: 0, cell: 70, cols: 2, rows: 1 },
    new Set()
  );
  assert(vectorStrokes[0].width > narrowWidth,
    'hint line and arrow width scale with the board cell size');

  // 4. During full-path clearing, owned portal cells keep the portal icon and
  // never substitute a themed clear-effect tile.
  const completedRunner = new GameRunner(portalLevel, portalSet.Palette);
  completedRunner.touchStart(segmentedHint.segments[0][0]);
  segmentedHint.segments[0].slice(1).forEach(cell => completedRunner.touchMove(cell));
  completedRunner.touchEnd(-1);
  completedRunner.touchStart(segmentedHint.segments[1][0]);
  segmentedHint.segments[1].slice(1).forEach(cell => completedRunner.touchMove(cell));
  assert.strictEqual(completedRunner.touchEnd(24), true);
  const clearNow = Date.now();
  const clearAnimation = {
    lineIndex: 0,
    cells: completedRunner.getCompletedLine(0).cells,
    startedAt: clearNow,
    durationMs: 300,
    type: 'fade',
    params: {}
  };
  ctx.calls.length = 0;
  tileDraws.length = 0;
  renderer.render(Object.assign({
    scene: 'play',
    set: portalSet,
    level: portalLevel,
    levelIndex: 4,
    ordinaryLevelNumber: 7,
    ordinaryLevelCount: 92,
    levelEnteredAt: clearNow - 1000,
    pressedId: null,
    hintAvailable: false
  }, renderState(completedRunner, { clearAnimation })), clearNow + 10);
  const clearingPortalTiles = tileDraws.filter(call => call.cellIndex === 2 || call.cellIndex === 21);
  assert.strictEqual(clearingPortalTiles.length, 2);
  assert(clearingPortalTiles.every(call => call.lineIndex === -1),
    'clearing portals retain only their empty base tiles');
  assert(ctx.calls.filter(call => call.method === 'drawImage').length >= 2,
    'both owned portals remain visible while their path clears');

  // Explicit no-effect snapshots are defensive no-ops at the BoardRenderer
  // boundary, even if an older caller supplies cells and a timestamp.
  tileDraws.length = 0;
  renderer.boardRenderer.drawClearAnimation({
    lineIndex: 0,
    cells: [0, 1, 2],
    startedAt: clearNow,
    durationMs: 0,
    type: 'none',
    params: {}
  }, portalSet.Palette, clearNow + 10, 3, renderer.boardLayout, new Set());
  assert.strictEqual(tileDraws.length, 0,
    'BoardRenderer never turns an explicit no-effect snapshot into fade tiles');

  // Portal completion uses the same persisted result actions as ordinary play.
  ctx.calls.length = 0;
  renderer.render(Object.assign({
    scene: 'result',
    set: portalSet,
    level: portalLevel,
    levelIndex: 4,
    ordinaryLevelNumber: 7,
    ordinaryLevelCount: 92,
    levelEnteredAt: clearNow - 1000,
    result: { elapsedMs: 1234, bestMs: 1234, newBest: false, persisted: true },
    resultVisibleAt: 0,
    hasNext: false,
    pressedId: null
  }, renderState(completedRunner)), clearNow + 400);
  const resultLabels = ctx.calls.filter(call => call.method === 'fillText').map(call => call.args[0]);
  ['完成', '选关', '重玩', '关卡列表'].forEach(label => assert(resultLabels.includes(label)));
  assert.strictEqual(resultLabels.some(label => label.includes('试玩')), false);
  assert.strictEqual(renderer.hits.some(hit => hit.id === 'result:next'), true);

  // 5. A test-only Portal fixture keeps generic Blocked rendering coverage.
  const blockedLevel = {
    Id: 'renderer-blocked-portal-fixture',
    Mechanic: 'portal',
    PortalRulesVersion: 2,
    Width: 6,
    Height: 6,
    Blocked: [14, 20],
    Lines: [{ Start: 0, End: 35 }, { Start: 12, End: 15 }],
    Portals: [{ Id: 'P1', Cells: [6, 30] }]
  };
  const blockedRunner = new GameRunner(blockedLevel, portalSet.Palette);
  const blockedDraws = [];
  const originalDrawBlockedCell = renderer.drawBlockedCell.bind(renderer);
  renderer.drawBlockedCell = (x, y, size, alpha, skin) => {
    blockedDraws.push(renderer.cellAt(x + size / 2, y + size / 2));
    return originalDrawBlockedCell(x, y, size, alpha, skin);
  };
  renderer.render(Object.assign({
    scene: 'play',
    set: portalSet,
    level: blockedLevel,
    levelIndex: 4,
    levelEnteredAt: Date.now() - 1000,
    pressedId: null,
    hintAvailable: true
  }, renderState(blockedRunner)), Date.now());
  assert.deepStrictEqual(blockedDraws.sort((one, two) => one - two), [14, 20]);

  // 6. Vector fallback when image fails to load
  const failPlatform = {
    context: createMockContext(),
    metrics: { width: 390, height: 844, safeTop: 44, safeBottom: 810 },
    createImage(source, callback) {
      callback(new Error('load failed'), null);
      return {};
    }
  };
  const failRenderer = new CanvasRenderer(failPlatform, skins);
  const failRunner = new GameRunner(portalLevel, portalSet.Palette);
  failRenderer.render(Object.assign({
    scene: 'play',
    set: portalSet,
    level: portalLevel,
    levelIndex: 4,
    ordinaryLevelNumber: 7,
    ordinaryLevelCount: 92,
    levelEnteredAt: Date.now() - 1000,
    pressedId: null
  }, renderState(failRunner)), Date.now());
  assert(failPlatform.context.calls.some(c => c.method === 'arc'), 'vector arc fallback should be drawn');
  const failLayout = failRenderer.getBoardLayout();
  assert.strictEqual(
    failRenderer.cellAt(
      failLayout.x + (2 % failLayout.cols + 0.5) * failLayout.cell,
      failLayout.y + (Math.floor(2 / failLayout.cols) + 0.5) * failLayout.cell
    ),
    2,
    'missing portal art never removes the portal cell from input mapping'
  );

  // 7. BoardRenderer owns the fixed semantic draw order and always places the
  // portal overlay last.
  const order = [];
  const orderedBoard = new BoardRenderer({
    getSkin() { return classic; },
    drawTile() {},
    drawBlockedCell() {},
    text() {},
    renderClearAnimation() { order.push('clear'); },
    portalOverlay: { draw() { order.push('portal'); } }
  });
  orderedBoard.drawCells = () => { order.push('cells'); };
  orderedBoard.drawHintPath = () => { order.push('hint'); };
  const orderedView = deepFreeze({
    board: {
      width: 1,
      height: 1,
      lines: [],
      cells: [{ index: 0, blocked: false, owner: -1, fixedLine: -1, selected: false, portal: true }],
      selection: { lineIndex: -1, cells: [], segments: [], teleports: [] },
      clearAnimation: { lineIndex: 0, cells: [0], startedAt: 0, durationMs: 300 },
      hint: { lineIndex: 0, path: [0, 0] },
      hintUntil: 1000
    },
    mechanic: {
      portal: { portals: [{ id: 'P1', A: 0, B: 0 }], phase: 'READY' }
    }
  });
  orderedBoard.draw(orderedView, { x: 0, y: 0, cell: 40, cols: 1, rows: 1 }, ['#f00'], 10);
  assert.deepStrictEqual(order, ['cells', 'clear', 'hint', 'portal']);

  // 8. PortalOverlay consumes only frozen portal/board data and independently
  // renders both waiting and locked rings.
  const overlayContext = createMockContext();
  const ringCalls = [];
  const overlayTileCalls = [];
  const overlayImageCalls = [];
  const overlay = new PortalOverlay({
    platform: {
      createImage(source, callback) {
        callback(null, { source, width: 64, height: 64 });
        return {};
      }
    },
    getContext() { return overlayContext; },
    getSkin() { return classic; },
    drawTile() { overlayTileCalls.push(Array.prototype.slice.call(arguments)); },
    drawImageContain() { overlayImageCalls.push(Array.prototype.slice.call(arguments)); },
    roundedRect() { ringCalls.push(Array.prototype.slice.call(arguments)); }
  });
  const overlayBoard = deepFreeze({
    cells: new Array(25).fill(null).map((unused, index) => ({ index, owner: -1 })),
    clearAnimation: null
  });
  const overlayLayout = { x: 0, y: 0, cell: 40, cols: 5, rows: 5 };
  const readyPortal = deepFreeze({
    icon: 'assets/icons/portal.png',
    portals: [{ id: 'P1', A: 21, B: 2 }],
    phase: 'READY',
    expectedExits: [],
    expectedExit: null,
    lockedEntry: null
  });
  const noneOverlayBoard = deepFreeze({
    cells: new Array(25).fill(null).map((unused, index) => ({
      index,
      owner: index === 2 || index === 21 ? 0 : -1
    })),
    clearAnimation: {
      lineIndex: 0,
      cells: [2, 21],
      startedAt: 100,
      durationMs: 0,
      type: 'none'
    }
  });
  overlay.draw(readyPortal, noneOverlayBoard, overlayLayout, 3, 100);
  assert.strictEqual(overlayTileCalls.length, 0,
    'PortalOverlay does not restore an empty base tile for no effect');
  assert.strictEqual(overlayImageCalls.length, 0,
    'owned portal icons disappear immediately when no effect is selected');

  overlayImageCalls.length = 0;
  const waitingPortal = deepFreeze({
    icon: 'assets/icons/portal.png',
    portals: [{ id: 'portal-network', Cells: [21, 2, 10] }],
    phase: 'PORTAL_WAIT',
    expectedExits: [2, 10],
    expectedExit: null,
    lockedEntry: null
  });
  const waitingBefore = JSON.stringify(waitingPortal);
  overlay.draw(waitingPortal, overlayBoard, overlayLayout, 3, 100);
  assert.deepStrictEqual(PortalOverlay.portalCells(waitingPortal.portals[0]), [21, 2, 10],
    'PortalOverlay keeps every cell in a portal network');
  assert.strictEqual(overlayImageCalls.length, 3,
    'PortalOverlay draws every portal in a network');
  assert.strictEqual(ringCalls.length, 2,
    'PORTAL_WAIT draws a ring around every eligible exit');
  assert.strictEqual(JSON.stringify(waitingPortal), waitingBefore,
    'PortalOverlay does not mutate its frozen ViewModel');

  ringCalls.length = 0;
  overlay.draw(deepFreeze({
    icon: 'assets/icons/portal.png',
    portals: [{ id: 'legacy-pair', A: 21, B: 2 }],
    phase: 'PORTAL_WAIT',
    expectedExit: 2,
    lockedEntry: null
  }), overlayBoard, overlayLayout, 3, 100);
  assert.strictEqual(ringCalls.length, 1,
    'PortalOverlay retains the singular expectedExit compatibility path');

  overlayImageCalls.length = 0;
  ringCalls.length = 0;
  overlay.draw(readyPortal, overlayBoard, overlayLayout, 3, 100);
  const normalPortalRects = overlayImageCalls.map(call => call[1]);
  assert.strictEqual(normalPortalRects.length, 2);

  overlayContext.calls.length = 0;
  overlayImageCalls.length = 0;
  ringCalls.length = 0;
  const lockedPortal = deepFreeze({
    icon: 'assets/icons/portal.png',
    portals: [{ id: 'portal-network', Cells: [21, 2, 10] }],
    phase: 'PORTAL_LOCKED',
    expectedExits: [],
    expectedExit: null,
    lockedEntry: 21
  });
  overlay.draw(lockedPortal, overlayBoard, overlayLayout, 3, 100);
  const lockedPortalRects = overlayImageCalls.map(call => call[1]);
  assert.strictEqual(ringCalls.length, 1,
    'PORTAL_LOCKED draws exactly one selected-entry highlight');
  assert(lockedPortalRects[0].w > normalPortalRects[0].w,
    'the locked entry portal grows while selected');
  assert.strictEqual(lockedPortalRects[1].w, normalPortalRects[1].w,
    'unselected portals keep their normal size');
  assert.strictEqual(
    lockedPortalRects[0].x + lockedPortalRects[0].w / 2,
    normalPortalRects[0].x + normalPortalRects[0].w / 2,
    'the selected portal scales around its center without shifting cells'
  );
  assert(overlayContext.calls.some(call => call.method === 'fill'),
    'the locked entry receives a filled cyan selection halo');
  assert(overlayContext.calls.some(call => call.method === 'stroke'),
    'the locked entry receives a visible selection outline');

  // 9. Every mainline title is numeric, regardless of mechanic or metadata name.
  const ordinaryPortalModel = {
    scene: 'play',
    set: { Name: '8 x 8', Palette: ['#f00'] },
    level: { Name: '双岸交织', Mechanic: 'portal', Width: 8, Height: 8, Lines: [] },
    levelIndex: 30,
    ordinaryLevelNumber: 63,
    ordinaryLevelCount: 92,
    mechanic: { portal: readyPortal },
    board: { width: 8, height: 8, cells: [] }
  };
  textDraws.length = 0;
  renderer.render(ordinaryPortalModel, Date.now());
  assert(textDraws.some(call => call.value === '63 / 92'),
    'Portal level title must contain only numeric progress');
  assert.strictEqual(textDraws.some(call => String(call.value).includes('双岸交织')), false);
  assert.strictEqual(textDraws.some(call => /^\d+\.\s/.test(call.value)), false,
    'must not display legacy 1.-30. numeric prefix in title');

  const mixedOrdinaryModel = Object.assign({}, ordinaryPortalModel, {
    level: { Id: 'portal-8x8-06', Name: '错层回廊', Width: 8, Height: 8, Lines: [] },
    levelIndex: 35,
    ordinaryLevelNumber: 68,
    mechanic: { portal: null }
  });
  textDraws.length = 0;
  renderer.render(mixedOrdinaryModel, Date.now());
  assert(textDraws.some(call => call.value === '68 / 92'),
    'named ordinary levels in the mixed chapter also use numeric progress');
  textDraws.length = 0;
  renderer.render(Object.assign({}, mixedOrdinaryModel, {
    level: { Name: '36', Instructions: '旧关卡说明', Width: 8, Height: 8, Lines: [] }
  }), Date.now());
  assert(textDraws.some(call => call.value === '68 / 92'),
    'legacy numeric ordinary names keep the numbered title');
  assert.strictEqual(textDraws.some(call => String(call.value).includes('旧关卡说明')), false,
    'per-level Instructions cannot replace the numeric header');

  // Milestone level 7 title
  const milestone7Model = {
    scene: 'play',
    set: { Name: '5 x 5', Palette: ['#f00'] },
    level: { Name: '传送初识', Mechanic: 'portal', Width: 5, Height: 5, Lines: [] },
    levelIndex: 4,
    ordinaryLevelNumber: 7,
    ordinaryLevelCount: 92,
    mechanic: { portal: readyPortal },
    board: { width: 5, height: 5, cells: [] }
  };
  textDraws.length = 0;
  renderer.render(milestone7Model, Date.now());
  assert(textDraws.some(call => call.value === '7 / 92'),
    'milestone level 7 must display 7 / 92 without its name');

  // 10. Level select keeps Portal levels visually consistent with ordinary levels.
  const levelSelectModel = {
    scene: 'levels',
    levelPageIndex: 0,
    levelPageCount: 4,
    levelItems: [
      { action: 'level:0:0', displayNumber: 1, unlocked: true, completed: false, mechanicId: null },
      { action: 'level:1:4', displayNumber: 7, unlocked: true, completed: false, mechanicId: 'portal' }
    ]
  };
  ctx.calls.length = 0;
  renderer.render(levelSelectModel, Date.now());
  assert.strictEqual(ctx.calls.some(c => c.method === 'drawImage'), false,
    'portal level cell must not draw a portal indicator icon in level select');

  // The longer shared copy stays within the prompt band on narrow screens.
  [280, 320, 390].forEach(width => {
    platform.metrics.width = width;
    textDraws.length = 0;
    renderer.render(initialModel, 1800);
    const before = Object.assign({}, renderer.boardLayout);
    const initialPrompt = textDraws.find(call => call.value === portalInstructions.INITIAL);
    assert(initialPrompt && initialPrompt.options.maxWidth <= width - 48);
    assert.strictEqual(initialPrompt.x, width / 2);
    textDraws.length = 0;
    renderer.render(lockedModel, 1800);
    const entryPrompt = textDraws.find(call => call.value === portalInstructions.CONTINUE);
    assert(entryPrompt && entryPrompt.options.maxWidth <= width - 48);
    assert.strictEqual(entryPrompt.x, width / 2);
    assert.deepStrictEqual(renderer.boardLayout, before, 'changing the prompt never shifts the board');
    assert(textDraws.some(call => call.value === '7 / 92'));
  });
  platform.metrics.width = 390;
}

module.exports = run;
