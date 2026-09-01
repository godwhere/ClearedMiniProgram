'use strict';

const assert = require('assert');
const CanvasRenderer = require('../src/ui/canvas-renderer.js');
const GameRunner = require('../core/game-runner.js');
const classic = require('../src/skins/classic.js');
const portalDemo = require('../data/portal-demo.js');

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
  const originalDrawTile = renderer.drawTile.bind(renderer);
  renderer.drawTile = (lineIndex, x, y, size, options) => {
    const cellIndex = renderer.cellAt(x + size / 2, y + size / 2);
    tileDraws.push({ lineIndex, cellIndex });
    return originalDrawTile(lineIndex, x, y, size, options);
  };

  const demoLevel = portalDemo.Games[0]; // 5x5, A: 21, B: 2
  const runner = new GameRunner(demoLevel, portalDemo.Palette);

  // 1. Initial play scene rendering
  renderer.render({
    scene: 'play',
    set: portalDemo,
    level: demoLevel,
    levelIndex: 0,
    runner,
    levelEnteredAt: Date.now() - 1000,
    clearAnimation: null,
    pressedId: null,
    hint: null,
    hintUntil: 0,
    hintAvailable: true
  }, Date.now());

  assert(renderer.boardLayout, 'board layout should exist');
  assert.strictEqual(imageRequested, 'assets/icons/portal.png', 'portal icon should be requested');
  assert(ctx.calls.some(c => c.method === 'drawImage'), 'drawImage should be called for portal');
  assert(tileDraws.filter(call => call.cellIndex === 2 || call.cellIndex === 21)
    .every(call => call.lineIndex === -1), 'portal cells render only an empty base tile');

  // 2. PORTAL_WAIT rendering: expectedExit highlight & prompt text
  runner.touchStart(0);
  [1, 6, 5, 10, 11, 16, 15, 20, 21].forEach(c => runner.touchMove(c));
  runner.touchEnd(-1);
  assert.strictEqual(runner.portalPhase, 'PORTAL_WAIT');

  ctx.calls.length = 0;
  tileDraws.length = 0;
  renderer.render({
    scene: 'play',
    set: portalDemo,
    level: demoLevel,
    levelIndex: 0,
    runner,
    levelEnteredAt: Date.now() - 1000,
    clearAnimation: null,
    pressedId: null,
    hint: null,
    hintUntil: 0,
    hintAvailable: true,
    expectedExit: 2,
    portalInstruction: '从另一端继续'
  }, Date.now());

  assert(ctx.calls.some(c => c.method === 'fillText' && c.args[0] === '从另一端继续'),
    'instruction text "从另一端继续" must be rendered during PORTAL_WAIT');
  assert(tileDraws.filter(call => call.cellIndex === 2 || call.cellIndex === 21)
    .every(call => call.lineIndex === -1),
  'selected portal entry must not draw a themed line tile under the icon');

  // 3. drawHintPath with segmented hint
  const segmentedHint = {
    lineIndex: 0,
    segments: [
      [0, 1, 6, 5, 10, 11, 16, 15, 20, 21],
      [2, 3, 4, 9, 8, 7, 12, 13, 14, 19, 18, 17, 22, 23, 24]
    ],
    teleports: [{ pairId: 'P1', from: 21, to: 2 }]
  };
  ctx.calls.length = 0;
  tileDraws.length = 0;
  renderer.drawHintPath(segmentedHint, portalDemo.Palette, Date.now(), runner);
  assert.strictEqual(tileDraws.length, 23, 'hint draws every non-portal path cell');
  assert.strictEqual(tileDraws.some(call => call.cellIndex === 2 || call.cellIndex === 21), false,
    'hint never draws a themed tile on either portal cell');

  // 4. During full-path clearing, owned portal cells keep the portal icon and
  // never substitute a themed clear-effect tile.
  const completedRunner = new GameRunner(demoLevel, portalDemo.Palette);
  completedRunner.touchStart(segmentedHint.segments[0][0]);
  segmentedHint.segments[0].slice(1).forEach(cell => completedRunner.touchMove(cell));
  completedRunner.touchEnd(-1);
  completedRunner.touchStart(segmentedHint.segments[1][0]);
  segmentedHint.segments[1].slice(1).forEach(cell => completedRunner.touchMove(cell));
  assert.strictEqual(completedRunner.touchEnd(24), true);
  const clearNow = Date.now();
  ctx.calls.length = 0;
  tileDraws.length = 0;
  renderer.render({
    scene: 'play',
    set: portalDemo,
    level: demoLevel,
    levelIndex: 0,
    runner: completedRunner,
    levelEnteredAt: clearNow - 1000,
    clearAnimation: {
      lineIndex: 0,
      cells: completedRunner.completedPaths[0],
      startedAt: clearNow,
      durationMs: 300,
      type: 'fade',
      params: {}
    },
    pressedId: null,
    hint: null,
    hintUntil: 0,
    hintAvailable: false
  }, clearNow + 10);
  const clearingPortalTiles = tileDraws.filter(call => call.cellIndex === 2 || call.cellIndex === 21);
  assert.strictEqual(clearingPortalTiles.length, 2);
  assert(clearingPortalTiles.every(call => call.lineIndex === -1),
    'clearing portals retain only their empty base tiles');
  assert(ctx.calls.filter(call => call.method === 'drawImage').length >= 2,
    'both owned portals remain visible while their path clears');

  // A non-persistent trial result uses trial/home copy rather than claiming a
  // stored best time or routing to an ordinary level list.
  ctx.calls.length = 0;
  renderer.render({
    scene: 'result',
    set: portalDemo,
    level: demoLevel,
    levelIndex: 4,
    runner: completedRunner,
    levelEnteredAt: clearNow - 1000,
    clearAnimation: null,
    result: {
      elapsedMs: 1234,
      bestMs: 1234,
      newBest: false,
      persisted: false,
      gameplayExtensionId: 'portal'
    },
    resultVisibleAt: 0,
    hasNext: false,
    pressedId: null,
    portalTrial: { icon: 'assets/icons/portal.png' }
  }, clearNow + 400);
  const resultLabels = ctx.calls
    .filter(call => call.method === 'fillText')
    .map(call => call.args[0]);
  assert(resultLabels.indexOf('试玩完成') >= 0);
  assert(resultLabels.indexOf('返回主页') >= 0);
  assert(resultLabels.indexOf('重玩') >= 0);
  assert.strictEqual(resultLabels.indexOf('选关'), -1);
  assert.strictEqual(resultLabels.indexOf('关卡列表'), -1);
  assert.strictEqual(resultLabels.some(label => /^\u672c\u6b21 .* · \u6700\u4f73 /.test(label)), false);
  assert.strictEqual(renderer.hits.some(hit => hit.id === 'result:next'), false);

  // 5. Ordinary play renders Blocked cells, including the two holes in demo 5.
  const blockedLevel = portalDemo.Games[4];
  const blockedRunner = new GameRunner(blockedLevel, portalDemo.Palette);
  const blockedDraws = [];
  const originalDrawBlockedCell = renderer.drawBlockedCell.bind(renderer);
  renderer.drawBlockedCell = (x, y, size, alpha, skin) => {
    blockedDraws.push(renderer.cellAt(x + size / 2, y + size / 2));
    return originalDrawBlockedCell(x, y, size, alpha, skin);
  };
  renderer.render({
    scene: 'play',
    set: portalDemo,
    level: blockedLevel,
    levelIndex: 4,
    runner: blockedRunner,
    levelEnteredAt: Date.now() - 1000,
    clearAnimation: null,
    pressedId: null,
    hint: null,
    hintUntil: 0,
    hintAvailable: true
  }, Date.now());
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
  failRenderer.render({
    scene: 'play',
    set: portalDemo,
    level: demoLevel,
    levelIndex: 0,
    runner: new GameRunner(demoLevel, portalDemo.Palette),
    levelEnteredAt: Date.now() - 1000,
    clearAnimation: null,
    pressedId: null
  }, Date.now());
  assert(failPlatform.context.calls.some(c => c.method === 'arc'), 'vector arc fallback should be drawn');
}

module.exports = run;
