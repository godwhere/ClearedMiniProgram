const assert = require('assert');
const CanvasRenderer = require('../src/ui/canvas-renderer.js');
const GameRunner = require('../core/game-runner.js');
const classic = require('../src/skins/classic.js');
const catalog = require('../data/catalog.js');

function fakeContext() {
  const context = {};
  [
    'save', 'restore', 'clearRect', 'fillRect', 'beginPath', 'moveTo', 'lineTo',
    'quadraticCurveTo', 'closePath', 'fill', 'stroke', 'arc', 'translate',
    'drawImage', 'fillText'
  ].forEach(method => { context[method] = function () {}; });
  return context;
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
  renderer.render({
    scene: 'play', set, level: set.Games[0], levelIndex: 0, runner,
    levelEnteredAt: Date.now() - 1000, clearAnimation: null, pressedId: null,
    hint: { lineIndex: 0, path: [0, 1, 2, 3, 4] }, hintUntil: Date.now() + 1000,
    hintAvailable: true
  }, Date.now());
  assert(renderer.boardLayout);
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

  renderer.render({
    scene: 'result', set, level: set.Games[0], levelIndex: 0, runner,
    levelEnteredAt: Date.now() - 1000, clearAnimation: null, pressedId: null,
    resultVisibleAt: 0, result: { newBest: true, elapsedMs: 1200, bestMs: 1200 },
    hasNext: false
  }, Date.now());
  assert(renderer.hits.some(hit => hit.id === 'result:replay'));

  const tallSet = catalog.sets[5];
  const tallLevel = tallSet.Games[0];
  [
    { width: 320, height: 568, safeTop: 54, safeBottom: 548 },
    { width: 768, height: 1024, safeTop: 30, safeBottom: 1000 }
  ].forEach(metrics => {
    platform.metrics = metrics;
    const tallRunner = new GameRunner(tallLevel, tallSet.Palette);
    renderer.render({
      scene: 'play', set: tallSet, level: tallLevel, levelIndex: 0, runner: tallRunner,
      levelEnteredAt: Date.now() - 1000, clearAnimation: null, pressedId: null
    }, Date.now());
    assert(renderer.boardLayout.cell > 25);
    assert(renderer.boardLayout.x >= 0);
    assert(renderer.boardLayout.y >= metrics.safeTop);
    assert(renderer.boardLayout.y + renderer.boardLayout.cell * tallLevel.Height <= metrics.safeBottom);
  });
}

module.exports = run;
