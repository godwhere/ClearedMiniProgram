const assert = require('assert');
const ClearedApp = require('../src/app.js');
const ClearEffectService = require('../src/services/clear-effect-service.js');
const CanvasRenderer = require('../src/ui/canvas-renderer.js');
const classic = require('../src/skins/classic.js');

function fakeContext() {
  const calls = [];
  const context = { calls, fillStyle: '', globalAlpha: 1 };
  [
    'save', 'restore', 'clearRect', 'fillRect', 'beginPath', 'moveTo', 'lineTo',
    'quadraticCurveTo', 'closePath', 'fill', 'stroke', 'arc', 'translate',
    'drawImage', 'fillText', 'strokeRect', 'scale'
  ].forEach(method => {
    context[method] = function () {
      calls.push({
        op: method,
        args: Array.prototype.slice.call(arguments),
        fillStyle: context.fillStyle,
        globalAlpha: context.globalAlpha
      });
    };
  });
  return context;
}

function createPlatform() {
  const context = fakeContext();
  const storage = {};
  const platform = {
    context,
    metrics: { width: 390, height: 844, safeTop: 44, safeBottom: 810 },
    sources: [],
    getStorage(key) { return storage[key] || null; },
    setStorage(key, value) {
      storage[key] = JSON.parse(JSON.stringify(value));
      return true;
    },
    createImage(source, callback) {
      this.sources.push(source);
      const image = { source, width: 512, height: 384 };
      if (callback) callback(null, image);
      return image;
    },
    createAudioContext() { return null; },
    triggerHaptic() {},
    bindPointer() { return function () {}; },
    bindLifecycle() {},
    startLoop() {}
  };
  platform.storage = storage;
  return platform;
}

function customEffects(count) {
  const effects = [];
  for (let index = 0; index < count; index++) {
    effects.push({
      id: `effect-${index}`,
      name: `效果 ${index}`,
      type: 'fade',
      durationMs: 180 + index,
      preview: null,
      params: { alphaFrom: 1, alphaTo: 0, scaleFrom: 1, scaleTo: 1.02, staggerRatio: 0 }
    });
  }
  return effects;
}

function run() {
  const platform = createPlatform();
  const app = new ClearedApp(platform);
  const now = Date.now();

  // The migration is opt-in: the default build keeps the existing visible
  // theme button, while the opt-in build reuses its rectangle for the corridor.
  app.tick(now);
  assert(app.renderer.hits.some(hit => hit.id === 'home:themes'));
  assert(!app.renderer.hits.some(hit => hit.id === 'home:corridor'));
  const legacyThemeRect = app.renderer.hits.find(hit => hit.id === 'home:themes').rect;
  const migrated = new ClearedApp(createPlatform(), { homeMigration: true });
  migrated.tick(now);
  assert(migrated.renderer.hits.some(hit => hit.id === 'home:corridor'));
  assert(!migrated.renderer.hits.some(hit => hit.id === 'home:themes'));
  const corridorHomeRect = migrated.renderer.hits.find(hit => hit.id === 'home:corridor').rect;
  assert.deepStrictEqual(corridorHomeRect, legacyThemeRect,
    'homepage migration reuses the existing theme button geometry');

  // The internal corridor route is reachable before homepage migration and
  // exposes exactly two live cards plus four inert slots.
  app.performAction('home:corridor');
  app.tick(now + 1);
  assert.strictEqual(app.scene, 'corridor');
  assert.deepStrictEqual(app.buildModel().corridorEntries.map(entry => entry.id), ['themes', 'effects']);
  assert(app.renderer.hits.some(hit => hit.id === 'corridor:home'));
  assert(app.renderer.hits.some(hit => hit.id === 'corridor:themes'));
  assert(app.renderer.hits.some(hit => hit.id === 'corridor:effects'));
  assert.strictEqual(app.renderer.hits.filter(hit => /^corridor:/.test(hit.id)).length, 4,
    'back, sound, and two corridor cards are registered');

  const corridorThemeHit = app.renderer.hits.find(hit => hit.id === 'corridor:themes');
  app.onPointerStart({ x: corridorThemeHit.rect.x + corridorThemeHit.rect.w / 2,
    y: corridorThemeHit.rect.y + corridorThemeHit.rect.h / 2, id: 10 });
  app.onPointerEnd({ x: corridorThemeHit.rect.x + corridorThemeHit.rect.w / 2,
    y: corridorThemeHit.rect.y + corridorThemeHit.rect.h / 2, id: 10 });
  app.tick(now + 2);
  assert.strictEqual(app.scene, 'themes');
  assert.strictEqual(app.buildModel().backAction, 'themes:corridor');
  app.performAction('themes:corridor');
  assert.strictEqual(app.scene, 'corridor');
  app.performAction('corridor:effects');
  app.tick(now + 3);
  assert.strictEqual(app.scene, 'effects');
  assert.strictEqual(app.buildModel().backAction, 'effects:corridor');
  assert.deepStrictEqual(app.buildModel().effects.map(effect => effect.id), ['none', 'fade']);
  assert.strictEqual(app.buildModel().currentEffectId, 'none',
    'a fresh install starts with no clear effect selected');
  assert.deepStrictEqual(
    app.renderer.hits.filter(hit => /^effect:/.test(hit.id)).map(hit => hit.id),
    ['effect:none', 'effect:fade'],
    'the two built-in cards keep registry order and both expose hit targets'
  );
  assert(platform.sources.indexOf('assets/effects/none/preview.png') >= 0,
    'the no-effect preview is loaded after entering the effect gallery');
  assert(platform.sources.indexOf('assets/effects/fade/preview.png') >= 0,
    'the fade preview is loaded after entering the effect gallery');
  const fadeHit = app.renderer.hits.find(hit => hit.id === 'effect:fade');
  app.onPointerStart({ x: fadeHit.rect.x + fadeHit.rect.w / 2,
    y: fadeHit.rect.y + fadeHit.rect.h / 2, id: 11 });
  app.onPointerEnd({ x: fadeHit.rect.x + fadeHit.rect.w / 2,
    y: fadeHit.rect.y + fadeHit.rect.h / 2, id: 11 });
  assert.strictEqual(app.scene, 'effects');
  assert.strictEqual(app.progress.getSetting('clearEffectId'), 'fade');

  const noneHit = app.renderer.hits.find(hit => hit.id === 'effect:none');
  app.onPointerStart({ x: noneHit.rect.x + noneHit.rect.w / 2,
    y: noneHit.rect.y + noneHit.rect.h / 2, id: 12 });
  app.onPointerEnd({ x: noneHit.rect.x + noneHit.rect.w / 2,
    y: noneHit.rect.y + noneHit.rect.h / 2, id: 12 });
  assert.strictEqual(app.progress.getSetting('clearEffectId'), 'none');
  const persistedNone = new ClearedApp(platform);
  assert.strictEqual(persistedNone.currentEffectId(), 'none',
    'selecting no effect survives a fresh app instance');

  // No effect creates no transient snapshot or 80ms clear tail on an ordinary
  // board. Ignore the unrelated board-enter animation for this boundary test.
  assert.strictEqual(persistedNone.openLevel(0, 0), true);
  persistedNone.levelEnteredAt = 0;
  const noneCompletedAt = Date.now();
  persistedNone.onPathCompleted(0, [0, 1, 2]);
  assert.strictEqual(persistedNone.clearAnimation, null);
  assert.strictEqual(persistedNone.buildModel().board.clearAnimation, null);
  assert.strictEqual(persistedNone.isAnimating(noneCompletedAt + 1), false,
    'no-effect completion does not keep the render loop alive for a clear tail');

  // A preview callback that arrives after leaving the page is ignored.
  const deferredCallbacks = {};
  const deferredPlatform = createPlatform();
  deferredPlatform.createImage = function (source, callback) {
    this.sources.push(source);
    deferredCallbacks[source] = callback;
    return { source, width: 512, height: 384 };
  };
  const deferredRenderer = new CanvasRenderer(deferredPlatform, {
    current() { return classic; },
    setStyle(set) { return { background: set.Color, palette: set.Palette }; }
  }, new ClearEffectService({ getSetting() { return 'fade'; }, setSetting() {} }));
  deferredRenderer.render({
    scene: 'effects', effects: [{ id: 'fade', name: '逐渐消失', type: 'fade', preview: 'assets/effects/fade/preview.png' }],
    effectPageIndex: 0, effectPageCount: 1, effectPageSize: 6, currentEffectId: 'fade',
    backAction: 'effects:corridor', soundEnabled: true, pressedId: null
  }, now);
  assert(deferredCallbacks['assets/effects/fade/preview.png']);
  deferredRenderer.render({
    scene: 'corridor', corridorEntries: [], corridorPageIndex: 0, corridorPageCount: 1,
    corridorPageSize: 6, backAction: 'corridor:home', soundEnabled: true, pressedId: null
  }, now + 1);
  deferredCallbacks['assets/effects/fade/preview.png'](null, { source: 'late', width: 512, height: 384 });
  assert(!Object.prototype.hasOwnProperty.call(deferredRenderer.effectPreviewImages, 'fade'));

  // Missing artwork has effect-specific vector fallbacks: no effect is a
  // static tile cluster, while fade keeps the three wind strokes.
  deferredPlatform.context.calls.length = 0;
  deferredRenderer.drawEffectFallbackPreview(
    { x: 0, y: 0, w: 160, h: 100 },
    { id: 'none', type: 'none', preview: null }
  );
  const noneFallbackCalls = deferredPlatform.context.calls.slice();
  assert(noneFallbackCalls.filter(call => call.op === 'fill').length >= 5,
    'no-effect fallback draws a static tile cluster');
  assert.strictEqual(noneFallbackCalls.some(call => call.op === 'stroke'), false,
    'no-effect fallback does not draw fade wind strokes');
  deferredPlatform.context.calls.length = 0;
  deferredRenderer.drawEffectFallbackPreview(
    { x: 0, y: 0, w: 160, h: 100 },
    { id: 'fade', type: 'fade', preview: null }
  );
  assert.strictEqual(
    deferredPlatform.context.calls.filter(call => call.op === 'stroke').length,
    3,
    'fade fallback remains visually distinct with three wind strokes'
  );

  // Effect pagination has its own cursor and does not move the theme cursor.
  const pagedPlatform = createPlatform();
  const paged = new ClearedApp(pagedPlatform, { effects: customEffects(7) });
  paged.themePageIndex = 1;
  paged.effectPageIndex = 1;
  paged.performAction('home:corridor');
  paged.performAction('corridor:effects');
  paged.tick(now + 4);
  const pagedModel = paged.buildModel();
  assert.strictEqual(pagedModel.effectPageCount, 2);
  assert.strictEqual(pagedModel.effectPageIndex, 1);
  assert.strictEqual(paged.themePageIndex, 1);
  assert(paged.renderer.hits.some(hit => hit.id === 'effects:prev'));
  assert(!paged.renderer.hits.some(hit => hit.id === 'effects:next'));
  assert.strictEqual(paged.renderer.hits.filter(hit => /^effect:/.test(hit.id)).length, 3);

  // A completion snapshots the selected effect and its parameters. Mutating a
  // returned manifest after completion cannot rewrite the running animation.
  assert.strictEqual(paged.setClearEffect('fade'), true);
  paged.performAction('home:start');
  paged.openLevel(0, 0);
  paged.tick(now + 1000);
  paged.onPathCompleted(0, [0, 1, 2]);
  assert(paged.clearAnimation);
  assert.strictEqual(paged.clearAnimation.effectId, 'fade');
  assert.strictEqual(paged.clearAnimation.type, 'fade');
  assert.strictEqual(paged.clearAnimation.durationMs, 300);
  const snapshotParams = paged.clearAnimation.params;
  snapshotParams.alphaFrom = 0.25;
  assert.strictEqual(paged.clearEffects.current().params.alphaFrom, 1,
    'animation params are detached from the registry');

  // BoardRenderer owns the fade implementation and performs one tile draw per
  // path cell from the immutable App snapshot.
  const renderer = paged.renderer;
  const boardLayout = { x: 0, y: 0, cell: 40, cols: 3, rows: 3 };
  renderer.boardLayout = boardLayout;
  let tileCalls = 0;
  const originalDrawTile = renderer.drawTile;
  renderer.drawTile = function () {
    tileCalls += 1;
    return originalDrawTile.apply(this, arguments);
  };
  renderer.boardRenderer.drawClearAnimation(
    paged.clearAnimation,
    ['#f00'],
    paged.clearAnimation.startedAt + 40,
    2,
    boardLayout,
    new Set()
  );
  renderer.drawTile = originalDrawTile;
  assert.strictEqual(tileCalls, paged.clearAnimation.cells.length);

  // Daily boards call the same renderer adapter rather than owning a second
  // effect implementation.
  const dailyBoard = {
    width: 3,
    height: 3,
    lines: [{ Start: 0, End: 2 }],
    cells: new Array(9).fill(null).map((unused, index) => ({
      index, blocked: false, owner: -1, fixedLine: -1, selected: false, portal: false
    })),
    selection: { lineIndex: -1, cells: [], segments: [], teleports: [] },
    clearAnimation: paged.clearAnimation,
    hint: null,
    hintUntil: 0
  };
  let dailyAdapterCalls = 0;
  const originalClearAnimation = renderer.drawClearAnimation;
  renderer.drawClearAnimation = function () {
    dailyAdapterCalls += 1;
    return originalClearAnimation.apply(this, arguments);
  };
  renderer.render({
    scene: 'daily',
    challenge: { Width: 3, Height: 3, Palette: ['#f00'], Lines: [{ Start: 0, End: 2 }] },
    board: dailyBoard,
    mechanic: { portal: null },
    elapsedText: '0:00',
    canUndo: false,
    levelEnteredAt: now - 1000,
    clearAnimation: paged.clearAnimation,
    dailyLevelIndex: 0,
    dailyLevelCount: 1,
    dailyEntryLimit: 3,
    dailyEntriesRemaining: 2,
    dailyDateKey: '2026-09-01',
    hintAvailable: false,
    soundEnabled: true,
    pressedId: null
  }, now);
  renderer.drawClearAnimation = originalClearAnimation;
  assert.strictEqual(dailyAdapterCalls, 1);

  const timedPlatform = createPlatform();
  const timed = new ClearedApp(timedPlatform, {
    effects: [{
      id: 'slow', name: '慢速', type: 'fade', durationMs: 480, preview: null,
      params: { alphaFrom: 1, alphaTo: 0, scaleFrom: 1, scaleTo: 1.01, staggerRatio: 0 }
    }]
  });
  timed.setClearEffect('slow');
  const persistedSlow = new ClearedApp(timedPlatform, {
    effects: [{ id: 'slow', name: '慢速', type: 'fade', durationMs: 480, preview: null }]
  });
  assert.strictEqual(persistedSlow.currentEffectId(), 'slow');
  timed.openLevel(0, 0);
  timed.onPathCompleted(0, [0, 1]);
  const animationStarted = timed.clearAnimation.startedAt;
  assert.strictEqual(timed.clearAnimation.durationMs, 480);
  timed.setClearEffect('fade');
  assert.strictEqual(timed.isAnimating(animationStarted + 479), true,
    'snapshot duration remains active after changing the selected effect');
  assert.strictEqual(timed.isAnimating(animationStarted + 561), false,
    'snapshot duration and tail eventually expire');
  const restoredTimed = new ClearedApp(timedPlatform, {
    effects: [{ id: 'slow', name: '慢速', type: 'fade', durationMs: 480, preview: null }]
  });
  assert.strictEqual(restoredTimed.currentEffectId(), 'fade',
    'a later app instance uses the latest persisted selection');

  // The renderer remains usable with only the legacy two-argument constructor
  // and falls back to the classic fade when no effect service is injected.
  const legacyRenderer = new CanvasRenderer({
    context: fakeContext(),
    metrics: { width: 390, height: 844, safeTop: 44, safeBottom: 810 },
    createImage(source, callback) { if (callback) callback(null, { source, width: 1, height: 1 }); }
  }, { current() { return classic; }, setStyle(set) { return { background: set.Color, palette: set.Palette }; } });
  legacyRenderer.boardLayout = { x: 0, y: 0, cell: 40, cols: 2, rows: 2 };
  legacyRenderer.drawClearAnimation({ lineIndex: 0, cells: [0], startedAt: now }, ['#f00'], now + 10, 2);
}

module.exports = run;
