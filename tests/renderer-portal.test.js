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

  // 2. PORTAL_WAIT rendering: expectedExit highlight & prompt text
  runner.touchStart(0);
  [1, 6, 5, 10, 11, 16, 15, 20, 21].forEach(c => runner.touchMove(c));
  runner.touchEnd(-1);
  assert.strictEqual(runner.portalPhase, 'PORTAL_WAIT');

  ctx.calls.length = 0;
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
  renderer.drawHintPath(segmentedHint, portalDemo.Palette, Date.now());
  // Verify tiles were drawn for each cell in both segments
  assert(ctx.calls.filter(c => c.method === 'fillRect' || c.method === 'drawImage').length >= 25);

  // 4. Vector fallback when image fails to load
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
