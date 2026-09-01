const assert = require('assert');
const GameRunner = require('../core/game-runner.js');
const ClearedApp = require('../src/app.js');
const CanvasRenderer = require('../src/ui/canvas-renderer.js');
const SkinService = require('../src/services/skin-service.js');
const gem = require('../src/skins/gem.js');
const animals = require('../src/skins/animals.js');
const fruits = require('../src/skins/fruits.js');
const desserts = require('../src/skins/desserts.js');
const space = require('../src/skins/space.js');
const ocean = require('../src/skins/ocean.js');
const spring = require('../src/skins/spring.js');
const festival = require('../src/skins/festival.js');
const music = require('../src/skins/music.js');
const vehicles = require('../src/skins/vehicles.js');

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

function imageFor(source) {
  if (source.indexOf('preview') >= 0) return { source, width: 1448, height: 1086 };
  if (source.indexOf('sprite-sheet') >= 0) return { source, width: 2000, height: 800 };
  return { source, width: 96, height: 96 };
}

function createPlatform() {
  const context = fakeContext();
  const storage = {};
  const platform = {
    context,
    metrics: { width: 390, height: 844, safeTop: 44, safeBottom: 810 },
    sources: [],
    getStorage(key) { return storage[key] || null; },
    setStorage(key, value) { storage[key] = JSON.parse(JSON.stringify(value)); return true; },
    createImage(source, callback) {
      this.sources.push(source);
      const image = imageFor(source);
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

function progressStub(settings) {
  return {
    getSetting(name, fallback) {
      return settings[name] === undefined ? fallback : settings[name];
    },
    setSetting(name, value) { settings[name] = value; }
  };
}

function runServiceChecks() {
  const settings = {};
  const service = new SkinService(progressStub(settings), [gem, animals, fruits, desserts, space, ocean, spring, festival, music, vehicles]);
  const list = service.list();
  assert.deepStrictEqual(list.map(item => item.id),
    ['classic', 'gem', 'animals', 'fruits', 'desserts', 'space', 'ocean', 'spring', 'festival', 'music', 'vehicles']);
  const gemItem = list.find(item => item.id === 'gem');
  assert.strictEqual(gemItem.name, '宝石');
  assert.strictEqual(gemItem.preview, undefined);
  const animalItem = list.find(item => item.id === 'animals');
  assert.strictEqual(animalItem.name, '动物');
  assert.strictEqual(animalItem.preview, undefined);
  const fruitItem = list.find(item => item.id === 'fruits');
  assert.strictEqual(fruitItem.name, '水果');
  assert.strictEqual(fruitItem.preview, undefined);
  const dessertItem = list.find(item => item.id === 'desserts');
  assert.strictEqual(dessertItem.name, '甜点');
  assert.strictEqual(dessertItem.category, '甜点');
  assert.strictEqual(dessertItem.preview, undefined);
  const spaceItem = list.find(item => item.id === 'space');
  assert.strictEqual(spaceItem.name, '太空');
  assert.strictEqual(spaceItem.category, '太空');
  assert.strictEqual(spaceItem.preview, undefined);
  assert.strictEqual(service.select('animals'), true);
  assert.strictEqual(settings.skinId, 'animals');
  assert.strictEqual(service.current().assets.tileSheet,
    'assets/skins/animals/animal-sprite-sheet.png');
  assert.strictEqual(service.current().assets.preview, undefined);
  assert.strictEqual(service.current().tileVisuals.count, 10);
  assert.strictEqual(service.current().tileVisuals.columns, 5);
  assert.strictEqual(service.current().tileVisuals.rows, 2);
  assert.strictEqual(service.select('fruits'), true);
  assert.strictEqual(settings.skinId, 'fruits');
  assert.strictEqual(service.current().assets.tileSheet,
    'assets/skins/fruits/fruit-sprite-sheet.png');
  assert.strictEqual(service.current().tileVisuals.count, 10);
  assert.strictEqual(service.current().tileVisuals.columns, 5);
  assert.strictEqual(service.current().tileVisuals.rows, 2);
  assert.strictEqual(service.current().tileVisuals.fallbackColors.length, 10);
  assert.strictEqual(service.select('desserts'), true);
  assert.strictEqual(settings.skinId, 'desserts');
  assert.strictEqual(service.current().assets.tileSheet,
    'assets/skins/desserts/dessert-sprite-sheet.png');
  assert.strictEqual(service.current().tileVisuals.count, 10);
  assert.strictEqual(service.current().tileVisuals.columns, 5);
  assert.strictEqual(service.current().tileVisuals.rows, 2);
  assert.strictEqual(service.current().tileVisuals.fallbackColors.length, 10);
  assert.strictEqual(service.select('space'), true);
  assert.strictEqual(settings.skinId, 'space');
  assert.strictEqual(service.current().assets.tileSheet,
    'assets/skins/space/space-sprite-sheet.png');
  assert.strictEqual(service.current().tileVisuals.count, 10);
  assert.strictEqual(service.current().tileVisuals.columns, 5);
  assert.strictEqual(service.current().tileVisuals.rows, 2);
  assert.strictEqual(service.current().tileVisuals.fallbackColors.length, 10);
  assert.notStrictEqual(service.current().tileVisuals.fallbackColors[0], '#000000',
    'black-hole fallback must remain visible on a dark board');
  const oceanItem = list.find(item => item.id === 'ocean');
  assert.strictEqual(oceanItem.name, '海洋');
  assert.strictEqual(oceanItem.category, '海洋');
  assert.strictEqual(oceanItem.preview, undefined);
  assert.strictEqual(service.select('ocean'), true);
  assert.strictEqual(settings.skinId, 'ocean');
  assert.strictEqual(service.current().assets.tileSheet,
    'assets/skins/ocean/ocean-sprite-sheet.png');
  assert.strictEqual(service.current().tileVisuals.count, 10);
  assert.strictEqual(service.current().tileVisuals.columns, 5);
  assert.strictEqual(service.current().tileVisuals.rows, 2);
  assert.strictEqual(service.current().tileVisuals.scale, 1);
  assert.strictEqual(service.current().tileVisuals.fallbackColors.length, 10);
  const springItem = list.find(item => item.id === 'spring');
  assert.strictEqual(springItem.name, '春天');
  assert.strictEqual(springItem.category, '春天');
  assert.strictEqual(springItem.preview, undefined);
  assert.strictEqual(service.select('spring'), true);
  assert.strictEqual(settings.skinId, 'spring');
  assert.strictEqual(service.current().assets.tileSheet,
    'assets/skins/spring/spring-sprite-sheet.png');
  assert.strictEqual(service.current().tileVisuals.count, 10);
  assert.strictEqual(service.current().tileVisuals.columns, 5);
  assert.strictEqual(service.current().tileVisuals.rows, 2);
  assert.strictEqual(service.current().tileVisuals.scale, 1);
  assert.strictEqual(service.current().tileVisuals.fallbackColors.length, 10);
  const festivalItem = list.find(item => item.id === 'festival');
  assert.strictEqual(festivalItem.name, '节日限定');
  assert.strictEqual(festivalItem.category, '节日');
  assert.strictEqual(festivalItem.preview, undefined);
  assert.strictEqual(service.select('festival'), true);
  assert.strictEqual(settings.skinId, 'festival');
  assert.strictEqual(service.current().assets.tileSheet,
    'assets/skins/festival/festival-sprite-sheet.png');
  assert.strictEqual(service.current().tileVisuals.count, 10);
  assert.strictEqual(service.current().tileVisuals.columns, 5);
  assert.strictEqual(service.current().tileVisuals.rows, 2);
  assert.strictEqual(service.current().tileVisuals.scale, 1);
  assert.strictEqual(service.current().tileVisuals.fallbackColors.length, 10);
  const musicItem = list.find(item => item.id === 'music');
  assert.strictEqual(musicItem.name, '音乐');
  assert.strictEqual(musicItem.category, '音乐');
  assert.strictEqual(musicItem.preview, undefined);
  assert.strictEqual(service.select('music'), true);
  assert.strictEqual(settings.skinId, 'music');
  assert.strictEqual(service.current().assets.tileSheet,
    'assets/skins/music/music-sprite-sheet.png');
  assert.strictEqual(service.current().tileVisuals.count, 10);
  assert.strictEqual(service.current().tileVisuals.columns, 5);
  assert.strictEqual(service.current().tileVisuals.rows, 2);
  assert.strictEqual(service.current().tileVisuals.scale, 1);
  assert.strictEqual(service.current().tileVisuals.fallbackColors.length, 10);
  const vehiclesItem = list.find(item => item.id === 'vehicles');
  assert.strictEqual(vehiclesItem.name, '交通工具');
  assert.strictEqual(vehiclesItem.category, '交通');
  assert.strictEqual(vehiclesItem.preview, undefined);
  assert.strictEqual(service.select('vehicles'), true);
  assert.strictEqual(settings.skinId, 'vehicles');
  assert.strictEqual(service.current().assets.tileSheet,
    'assets/skins/vehicles/vehicle-sprite-sheet.png');
  assert.strictEqual(service.current().tileVisuals.count, 10);
  assert.strictEqual(service.current().tileVisuals.columns, 5);
  assert.strictEqual(service.current().tileVisuals.rows, 2);
  assert.strictEqual(service.current().tileVisuals.scale, 1);
  assert.strictEqual(service.current().tileVisuals.fallbackColors.length, 10);
  assert.strictEqual(service.select('missing'), false);
}

function runRendererChecks() {
  const platform = createPlatform();
  const service = new SkinService(progressStub({}), [gem, animals, fruits, desserts, space, ocean, spring, festival, music, vehicles]);
  const renderer = new CanvasRenderer(platform, service);
  const now = Date.now();

  renderer.render({
    scene: 'home', completedCount: 0, totalLevels: 92, soundEnabled: true, pressedId: null
  }, now);
  const homeIds = renderer.hits.map(hit => hit.id);
  assert(homeIds.indexOf('home:start') >= 0);
  assert(homeIds.indexOf('home:themes') >= 0);
  assert(homeIds.indexOf('home:dailyChallenge') >= 0);
  assert.strictEqual(homeIds.indexOf('home:portalTrial'), -1,
    'portal trial is not exposed as a visible home action');
  assert.strictEqual(homeIds.indexOf('home:levels'), -1, 'level picker is no longer a home button');
  const homeButtons = renderer.hits.filter(hit => /^home:(dailyChallenge|themes|start)$/.test(hit.id));
  assert.deepStrictEqual(homeButtons.map(hit => hit.id), [
    'home:dailyChallenge', 'home:themes', 'home:start'
  ]);
  assert.strictEqual(homeButtons.length, 3);
  assert.strictEqual(homeButtons[1].rect.y, homeButtons[0].rect.y,
    'daily challenge and themes share the first row');
  assert(homeButtons[1].rect.x > homeButtons[0].rect.x,
    'themes sits to the right of daily challenge');
  assert.strictEqual(homeButtons[2].rect.y - homeButtons[1].rect.y, 66,
    'start follows the first row by one button and one gap');
  assert(homeButtons[2].rect.w > homeButtons[0].rect.w,
    'start spans the full button width');

  // The debug status is a compact annotation inside the daily button, and
  // all three home actions share the primary button surface.
  platform.context.calls.length = 0;
  renderer.render({
    scene: 'home', completedCount: 84, totalLevels: 92, soundEnabled: true,
    pressedId: null, dailyAvailable: true, dailyEntryAvailable: true,
    dailyDebugUnlimited: true, dailyEntriesRemaining: null, dailyEntryLimit: 3
  }, now);
  const debugDaily = renderer.hits.find(hit => hit.id === 'home:dailyChallenge');
  const unlimitedText = platform.context.calls.find(call =>
    call.op === 'fillText' && call.args[0] === '次数不限');
  assert(debugDaily && unlimitedText, 'debug entry status is rendered');
  assert(unlimitedText.args[1] > debugDaily.rect.x + debugDaily.rect.w / 2,
    'debug status is aligned to the daily button right side');
  assert(unlimitedText.args[2] > debugDaily.rect.y + debugDaily.rect.h / 2 &&
    unlimitedText.args[2] < debugDaily.rect.y + debugDaily.rect.h,
  'debug status is aligned to the daily button bottom');
  assert.strictEqual(platform.context.calls.filter(call =>
    call.op === 'fill' && call.fillStyle === service.current().colors.primaryButton).length, 3,
  'all home buttons use the primary surface');

  const themes = [
    { id: 'classic', name: '经典' },
    { id: 'gem', name: '宝石', category: '宝石' },
    { id: 'animals', name: '动物', category: '动物' },
    { id: 'fruits', name: '水果', category: '水果' },
    { id: 'desserts', name: '甜点', category: '甜点' },
    { id: 'space', name: '太空', category: '太空' }
  ];
  renderer.render({
    scene: 'themes', themes, themePageIndex: 0, themePageCount: 1,
    currentThemeId: 'classic', soundEnabled: true, pressedId: null
  }, now);
  assert(renderer.hits.some(hit => hit.id === 'themes:home'));
  const themeHomeHit = renderer.hits.find(hit => hit.id === 'themes:home');
  assert.strictEqual(themeHomeHit.rect.y,
    platform.metrics.safeTop + 4 + 8 + 16, 'theme top UI is lowered by its layout offset');
  assert(renderer.hits.some(hit => hit.id === 'theme:classic'));
  assert(renderer.hits.some(hit => hit.id === 'theme:gem'));
  assert(renderer.hits.some(hit => hit.id === 'theme:animals'));
  assert(renderer.hits.some(hit => hit.id === 'theme:fruits'));
  assert(renderer.hits.some(hit => hit.id === 'theme:desserts'));
  assert(renderer.hits.some(hit => hit.id === 'theme:space'));
  assert.strictEqual(renderer.hits.filter(hit => /^theme:/.test(hit.id)).length, 6);
  assert.strictEqual(platform.context.calls.filter(call =>
    call.op === 'fillText' && call.args[0] === '宝石').length, 1,
  'theme card renders only its name');
  assert(!renderer.hits.some(hit => hit.id === 'themes:prev'));
  assert(!renderer.hits.some(hit => hit.id === 'themes:next'));
  assert(platform.sources.indexOf('assets/skins/gem/gem-sprite-sheet.png') >= 0,
    'theme card preview loads the gem tile sheet');
  assert(platform.sources.indexOf('assets/skins/animals/animal-sprite-sheet.png') >= 0,
    'theme card preview loads the animal tile sheet');
  assert(platform.sources.indexOf('assets/skins/fruits/fruit-sprite-sheet.png') >= 0,
    'theme card preview loads the fruit tile sheet');
  assert(platform.sources.indexOf('assets/skins/desserts/dessert-sprite-sheet.png') >= 0,
    'theme card preview loads the dessert tile sheet');
  assert(platform.sources.indexOf('assets/skins/space/space-sprite-sheet.png') >= 0,
    'theme card preview loads the space tile sheet');
  assert.strictEqual(platform.context.calls.filter(call => call.op === 'drawImage' &&
    call.args[0] && call.args[0].source === 'assets/skins/gem/gem-sprite-sheet.png').length, 4,
  'gem card preview uses exactly the first four tile elements');
  assert.strictEqual(platform.context.calls.filter(call => call.op === 'drawImage' &&
    call.args[0] && call.args[0].source === 'assets/skins/animals/animal-sprite-sheet.png').length, 4,
  'animal card preview uses exactly the first four tile elements');
  assert.strictEqual(platform.context.calls.filter(call => call.op === 'drawImage' &&
    call.args[0] && call.args[0].source === 'assets/skins/fruits/fruit-sprite-sheet.png').length, 4,
  'fruit card preview uses exactly the first four tile elements');
  assert.strictEqual(platform.context.calls.filter(call => call.op === 'drawImage' &&
    call.args[0] && call.args[0].source === 'assets/skins/desserts/dessert-sprite-sheet.png').length, 4,
  'dessert card preview uses exactly the first four tile elements');
  assert.strictEqual(platform.context.calls.filter(call => call.op === 'drawImage' &&
    call.args[0] && call.args[0].source === 'assets/skins/space/space-sprite-sheet.png').length, 4,
  'space card preview uses exactly the first four tile elements');
  assert.strictEqual(platform.sources.some(source => source.indexOf('/preview.png') >= 0), false,
    'theme card preview does not request generated preview images');

  // Eleven registered themes span two gallery pages; the second page contains
  // ocean, spring, festival, music, and vehicles in five populated slots.
  const elevenThemes = themes.concat([
    { id: 'ocean', name: '海洋', category: '海洋' },
    { id: 'spring', name: '春天', category: '春天' },
    { id: 'festival', name: '节日限定', category: '节日' },
    { id: 'music', name: '音乐', category: '音乐' },
    { id: 'vehicles', name: '交通工具', category: '交通' }
  ]);
  renderer.render({
    scene: 'themes', themes: elevenThemes, themePageIndex: 1, themePageCount: 2,
    currentThemeId: 'vehicles', soundEnabled: true, pressedId: null
  }, now);
  assert(renderer.hits.some(hit => hit.id === 'theme:ocean'));
  assert(renderer.hits.some(hit => hit.id === 'theme:spring'));
  assert(renderer.hits.some(hit => hit.id === 'theme:festival'));
  assert(renderer.hits.some(hit => hit.id === 'theme:music'));
  assert(renderer.hits.some(hit => hit.id === 'theme:vehicles'));
  assert.strictEqual(renderer.hits.filter(hit => /^theme:/.test(hit.id)).length, 5);
  assert(!renderer.hits.some(hit => hit.id === 'theme:undefined'),
    'the sixth slot on a partial page stays empty and has no hit');
  assert(renderer.hits.some(hit => hit.id === 'themes:prev'));
  assert(!renderer.hits.some(hit => hit.id === 'themes:next'));
  assert(platform.sources.indexOf('assets/skins/ocean/ocean-sprite-sheet.png') >= 0,
    'second-page gallery preview loads the ocean tile sheet');
  assert(platform.sources.indexOf('assets/skins/spring/spring-sprite-sheet.png') >= 0,
    'second-page gallery preview loads the spring tile sheet');
  assert(platform.sources.indexOf('assets/skins/festival/festival-sprite-sheet.png') >= 0,
    'second-page gallery preview loads the festival tile sheet');
  assert(platform.sources.indexOf('assets/skins/music/music-sprite-sheet.png') >= 0,
    'second-page gallery preview loads the music tile sheet');
  assert(platform.sources.indexOf('assets/skins/vehicles/vehicle-sprite-sheet.png') >= 0,
    'second-page gallery preview loads the vehicles tile sheet');
  assert.strictEqual(platform.context.calls.filter(call => call.op === 'drawImage' &&
    call.args[0] && call.args[0].source === 'assets/skins/ocean/ocean-sprite-sheet.png').length, 4,
  'ocean card preview uses exactly the first four tile elements');
  assert.strictEqual(platform.context.calls.filter(call => call.op === 'drawImage' &&
    call.args[0] && call.args[0].source === 'assets/skins/spring/spring-sprite-sheet.png').length, 4,
  'spring card preview uses exactly the first four tile elements');
  assert.strictEqual(platform.context.calls.filter(call => call.op === 'drawImage' &&
    call.args[0] && call.args[0].source === 'assets/skins/festival/festival-sprite-sheet.png').length, 4,
  'festival card preview uses exactly the first four tile elements');
  assert.strictEqual(platform.context.calls.filter(call => call.op === 'drawImage' &&
    call.args[0] && call.args[0].source === 'assets/skins/music/music-sprite-sheet.png').length, 4,
  'music card preview uses exactly the first four tile elements');
  assert.strictEqual(platform.context.calls.filter(call => call.op === 'drawImage' &&
    call.args[0] && call.args[0].source === 'assets/skins/vehicles/vehicle-sprite-sheet.png').length, 4,
  'vehicles card preview uses exactly the first four tile elements');

  service.select('gem');
  renderer.loadSkinAssets();
  const level = { Width: 5, Height: 1, Name: '1', Lines: [{ Start: 0, End: 4 }] };
  const runner = new GameRunner(level, ['#f00']);
  renderer.render({
    scene: 'play', set: { Color: '#00aba9', Palette: ['#f00'], Games: [level] },
    level, levelIndex: 0, runner, levelEnteredAt: now - 1000,
    clearAnimation: null, pressedId: null, hintAvailable: true
  }, now);
  assert(platform.sources.indexOf('assets/skins/gem/gem-sprite-sheet.png') >= 0);
  assert(platform.context.calls.some(call => call.op === 'drawImage' &&
    call.args[0] && call.args[0].source === 'assets/skins/gem/gem-sprite-sheet.png' &&
    call.args.length >= 9));

  // The animal theme uses the same declarative sheet contract as gems.
  service.select('animals');
  renderer.loadSkinAssets();
  platform.context.calls.length = 0;
  renderer.render({
    scene: 'play',
    set: { Color: '#00aba9', Palette: ['#f00'], Games: [level] },
    level, levelIndex: 0, runner, levelEnteredAt: now - 1000,
    clearAnimation: null, pressedId: null, hintAvailable: true
  }, now);
  assert(platform.sources.indexOf('assets/skins/animals/animal-sprite-sheet.png') >= 0);
  assert(platform.context.calls.some(call => call.op === 'drawImage' &&
    call.args[0] && call.args[0].source === 'assets/skins/animals/animal-sprite-sheet.png' &&
    call.args.length >= 9));

  // The fruit theme uses the same declarative sheet contract as gems and
  // animals, including a palette fallback when its image is unavailable.
  service.select('fruits');
  renderer.loadSkinAssets();
  platform.context.calls.length = 0;
  renderer.render({
    scene: 'play',
    set: { Color: '#00aba9', Palette: ['#f00'], Games: [level] },
    level, levelIndex: 0, runner, levelEnteredAt: now - 1000,
    clearAnimation: null, pressedId: null, hintAvailable: true
  }, now);
  assert(platform.sources.indexOf('assets/skins/fruits/fruit-sprite-sheet.png') >= 0);
  assert(platform.context.calls.some(call => call.op === 'drawImage' &&
    call.args[0] && call.args[0].source === 'assets/skins/fruits/fruit-sprite-sheet.png' &&
    call.args.length >= 9));
  platform.context.calls.length = 0;
  renderer.drawTile(0, 10, 20, 100, {
    skin: service.current(), images: {}, alpha: 1
  });
  assert(platform.context.calls.some(call => call.op === 'fillRect' &&
    call.args[0] === 10 && call.args[1] === 20 &&
    call.fillStyle === fruits.tileVisuals.fallbackColors[0]),
  'fruit tiles fall back to the fruit palette when the sheet is unavailable');

  // The dessert theme follows the same sheet contract and has its own
  // recognizable fallback palette when image loading is unavailable.
  service.select('desserts');
  renderer.loadSkinAssets();
  platform.context.calls.length = 0;
  renderer.render({
    scene: 'play',
    set: { Color: '#00aba9', Palette: ['#f00'], Games: [level] },
    level, levelIndex: 0, runner, levelEnteredAt: now - 1000,
    clearAnimation: null, pressedId: null, hintAvailable: true
  }, now);
  assert(platform.sources.indexOf('assets/skins/desserts/dessert-sprite-sheet.png') >= 0);
  assert(platform.context.calls.some(call => call.op === 'drawImage' &&
    call.args[0] && call.args[0].source === 'assets/skins/desserts/dessert-sprite-sheet.png' &&
    call.args.length >= 9));
  platform.context.calls.length = 0;
  renderer.drawTile(0, 10, 20, 100, {
    skin: service.current(), images: {}, alpha: 1
  });
  assert(platform.context.calls.some(call => call.op === 'fillRect' &&
    call.args[0] === 10 && call.args[1] === 20 &&
    call.fillStyle === desserts.tileVisuals.fallbackColors[0]),
  'dessert tiles fall back to the dessert palette when the sheet is unavailable');

  // The space theme follows the same sheet contract. Its bright first
  // fallback keeps the dark black-hole slot visible without the image.
  service.select('space');
  renderer.loadSkinAssets();
  platform.context.calls.length = 0;
  renderer.render({
    scene: 'play',
    set: { Color: '#00aba9', Palette: ['#f00'], Games: [level] },
    level, levelIndex: 0, runner, levelEnteredAt: now - 1000,
    clearAnimation: null, pressedId: null, hintAvailable: true
  }, now);
  assert(platform.sources.indexOf('assets/skins/space/space-sprite-sheet.png') >= 0);
  assert(platform.context.calls.some(call => call.op === 'drawImage' &&
    call.args[0] && call.args[0].source === 'assets/skins/space/space-sprite-sheet.png' &&
    call.args.length >= 9));
  platform.context.calls.length = 0;
  renderer.drawTile(0, 10, 20, 100, {
    skin: service.current(), images: {}, alpha: 1
  });
  assert(platform.context.calls.some(call => call.op === 'fillRect' &&
    call.args[0] === 10 && call.args[1] === 20 &&
    call.fillStyle === space.tileVisuals.fallbackColors[0]),
  'space black-hole tile falls back to its bright accent color when unavailable');

  // The ocean theme follows the same sheet contract and palette fallback.
  service.select('ocean');
  renderer.loadSkinAssets();
  platform.context.calls.length = 0;
  renderer.render({
    scene: 'play',
    set: { Color: '#00aba9', Palette: ['#f00'], Games: [level] },
    level, levelIndex: 0, runner, levelEnteredAt: now - 1000,
    clearAnimation: null, pressedId: null, hintAvailable: true
  }, now);
  assert(platform.sources.indexOf('assets/skins/ocean/ocean-sprite-sheet.png') >= 0);
  assert(platform.context.calls.some(call => call.op === 'drawImage' &&
    call.args[0] && call.args[0].source === 'assets/skins/ocean/ocean-sprite-sheet.png' &&
    call.args.length >= 9));
  platform.context.calls.length = 0;
  renderer.drawTile(0, 10, 20, 100, {
    skin: service.current(), images: {}, alpha: 1
  });
  assert(platform.context.calls.some(call => call.op === 'fillRect' &&
    call.args[0] === 10 && call.args[1] === 20 &&
    call.fillStyle === ocean.tileVisuals.fallbackColors[0]),
  'ocean anglerfish tile falls back to its luminous color when unavailable');

  // The spring theme follows the same sheet contract and seasonal fallback
  // palette.
  service.select('spring');
  renderer.loadSkinAssets();
  platform.context.calls.length = 0;
  renderer.render({
    scene: 'play',
    set: { Color: '#00aba9', Palette: ['#f00'], Games: [level] },
    level, levelIndex: 0, runner, levelEnteredAt: now - 1000,
    clearAnimation: null, pressedId: null, hintAvailable: true
  }, now);
  assert(platform.sources.indexOf('assets/skins/spring/spring-sprite-sheet.png') >= 0);
  assert(platform.context.calls.some(call => call.op === 'drawImage' &&
    call.args[0] && call.args[0].source === 'assets/skins/spring/spring-sprite-sheet.png' &&
    call.args.length >= 9));
  platform.context.calls.length = 0;
  renderer.drawTile(0, 10, 20, 100, {
    skin: service.current(), images: {}, alpha: 1
  });
  assert(platform.context.calls.some(call => call.op === 'fillRect' &&
    call.args[0] === 10 && call.args[1] === 20 &&
    call.fillStyle === spring.tileVisuals.fallbackColors[0]),
  'spring sprout tile falls back to its seasonal palette when unavailable');

  // The festival theme follows the same sheet contract and keeps a bright
  // first fallback for the dark gold drum/knot slot.
  service.select('festival');
  renderer.loadSkinAssets();
  platform.context.calls.length = 0;
  renderer.render({
    scene: 'play',
    set: { Color: '#00aba9', Palette: ['#f00'], Games: [level] },
    level, levelIndex: 0, runner, levelEnteredAt: now - 1000,
    clearAnimation: null, pressedId: null, hintAvailable: true
  }, now);
  assert(platform.sources.indexOf('assets/skins/festival/festival-sprite-sheet.png') >= 0);
  assert(platform.context.calls.some(call => call.op === 'drawImage' &&
    call.args[0] && call.args[0].source === 'assets/skins/festival/festival-sprite-sheet.png' &&
    call.args.length >= 9));
  platform.context.calls.length = 0;
  renderer.drawTile(0, 10, 20, 100, {
    skin: service.current(), images: {}, alpha: 1
  });
  assert(platform.context.calls.some(call => call.op === 'fillRect' &&
    call.args[0] === 10 && call.args[1] === 20 &&
    call.fillStyle === festival.tileVisuals.fallbackColors[0]),
  'festival drum tile falls back to its bright accent color when unavailable');

  // The music theme follows the same sheet contract and keeps a bright first
  // fallback for the dark vinyl/turntable slot.
  service.select('music');
  renderer.loadSkinAssets();
  platform.context.calls.length = 0;
  renderer.render({
    scene: 'play',
    set: { Color: '#00aba9', Palette: ['#f00'], Games: [level] },
    level, levelIndex: 0, runner, levelEnteredAt: now - 1000,
    clearAnimation: null, pressedId: null, hintAvailable: true
  }, now);
  assert(platform.sources.indexOf('assets/skins/music/music-sprite-sheet.png') >= 0);
  assert(platform.context.calls.some(call => call.op === 'drawImage' &&
    call.args[0] && call.args[0].source === 'assets/skins/music/music-sprite-sheet.png' &&
    call.args.length >= 9));
  platform.context.calls.length = 0;
  renderer.drawTile(0, 10, 20, 100, {
    skin: service.current(), images: {}, alpha: 1
  });
  assert(platform.context.calls.some(call => call.op === 'fillRect' &&
    call.args[0] === 10 && call.args[1] === 20 &&
    call.fillStyle === music.tileVisuals.fallbackColors[0]),
  'music vinyl tile falls back to its bright accent color when unavailable');

  // The transportation theme follows the same sheet contract and keeps a
  // recognizable vehicle palette when the image is unavailable.
  service.select('vehicles');
  renderer.loadSkinAssets();
  platform.context.calls.length = 0;
  renderer.render({
    scene: 'play',
    set: { Color: '#00aba9', Palette: ['#f00'], Games: [level] },
    level, levelIndex: 0, runner, levelEnteredAt: now - 1000,
    clearAnimation: null, pressedId: null, hintAvailable: true
  }, now);
  assert(platform.sources.indexOf('assets/skins/vehicles/vehicle-sprite-sheet.png') >= 0);
  assert(platform.context.calls.some(call => call.op === 'drawImage' &&
    call.args[0] && call.args[0].source === 'assets/skins/vehicles/vehicle-sprite-sheet.png' &&
    call.args.length >= 9));
  platform.context.calls.length = 0;
  renderer.drawTile(0, 10, 20, 100, {
    skin: service.current(), images: {}, alpha: 1
  });
  assert(platform.context.calls.some(call => call.op === 'fillRect' &&
    call.args[0] === 10 && call.args[1] === 20 &&
    call.fillStyle === vehicles.tileVisuals.fallbackColors[0]),
  'vehicle tiles fall back to the transportation palette when unavailable');

  // Keep the existing animal background/scale regression focused on the
  // animal manifest after exercising the fruit manifest above.
  service.select('animals');
  renderer.loadSkinAssets();

  // Image-backed animal tiles retain the translucent square tile underneath
  // the transparent avatar. The normalized source owns its safety edge, so
  // the runtime manifest uses a neutral visual scale.
  platform.context.calls.length = 0;
  renderer.drawTile(0, 10, 20, 100, { skin: service.current(), color: '#f00', alpha: 0.8 });
  const backgroundIndex = platform.context.calls.findIndex(call =>
    call.op === 'fillRect' && call.args[0] === 10 && call.args[1] === 20 &&
    call.args[2] === 100 && call.args[3] === 100);
  const imageIndex = platform.context.calls.findIndex(call =>
    call.op === 'drawImage' && call.args[0] &&
    call.args[0].source === 'assets/skins/animals/animal-sprite-sheet.png');
  assert(backgroundIndex >= 0 && imageIndex > backgroundIndex);
  assert.strictEqual(platform.context.calls[backgroundIndex].fillStyle, 'rgba(255,255,255,0.31)');
  assert.strictEqual(platform.context.calls[backgroundIndex].globalAlpha, 0.8);
  assert.strictEqual(platform.context.calls[imageIndex].args[7], 100,
    'normalized animal art uses the full logical tile draw area');

  service.select('classic');
  renderer.loadSkinAssets();
  platform.context.calls.length = 0;
  renderer.drawTile(0, 10, 20, 100, { skin: service.current(), color: '#f00', alpha: 0.8 });
  assert(!platform.context.calls.some(call => call.op === 'drawImage'));
  assert(platform.context.calls.some(call => call.op === 'fillRect' && call.fillStyle === '#f00'));
}

function runAppChecks() {
  const platform = createPlatform();
  const app = new ClearedApp(platform);
  const now = Date.now();
  app.tick(now);
  assert(app.renderer.hits.some(hit => hit.id === 'home:themes'));
  app.performAction('home:themes');
  app.tick(now + 1);
  assert.strictEqual(app.scene, 'themes');
  assert.deepStrictEqual(app.buildModel().themes.map(item => item.id),
    ['classic', 'gem', 'animals', 'fruits', 'desserts', 'space', 'ocean', 'spring', 'festival', 'music', 'vehicles']);
  assert.strictEqual(app.buildModel().themePageCount, 2);
  const dessertHit = app.renderer.hits.find(hit => hit.id === 'theme:desserts');
  assert(dessertHit);
  const center = {
    x: dessertHit.rect.x + dessertHit.rect.w / 2,
    y: dessertHit.rect.y + dessertHit.rect.h / 2,
    id: 1
  };
  app.onPointerStart(center);
  app.onPointerEnd(center);
  assert.strictEqual(app.skins.current().id, 'desserts');
  assert.strictEqual(app.progress.getSetting('skinId', 'classic'), 'desserts');
  assert.strictEqual(app.scene, 'themes');
  assert.strictEqual(platform.sources.some(source => source.indexOf('/preview.png') >= 0), false,
    'selected theme does not load unused generated previews');

  const restored = new ClearedApp(platform);
  assert.strictEqual(restored.skins.current().id, 'desserts', 'selected theme survives a new app instance');

  const spaceHit = app.renderer.hits.find(hit => hit.id === 'theme:space');
  assert(spaceHit);
  const spaceCenter = {
    x: spaceHit.rect.x + spaceHit.rect.w / 2,
    y: spaceHit.rect.y + spaceHit.rect.h / 2,
    id: 2
  };
  app.onPointerStart(spaceCenter);
  app.onPointerEnd(spaceCenter);
  assert.strictEqual(app.skins.current().id, 'space');
  assert.strictEqual(app.progress.getSetting('skinId', 'classic'), 'space');
  const restoredSpace = new ClearedApp(platform);
  assert.strictEqual(restoredSpace.skins.current().id, 'space', 'space selection survives a new app instance');

  // The seventh through eleventh themes occupy the second gallery page and
  // can be selected and restored just like the first-page themes.
  app.performAction('themes:next');
  app.tick(now + 2);
  assert.strictEqual(app.buildModel().themePageIndex, 1);
  assert.strictEqual(app.buildModel().themePageCount, 2);
  const oceanHit = app.renderer.hits.find(hit => hit.id === 'theme:ocean');
  assert(oceanHit);
  const oceanCenter = {
    x: oceanHit.rect.x + oceanHit.rect.w / 2,
    y: oceanHit.rect.y + oceanHit.rect.h / 2,
    id: 3
  };
  app.onPointerStart(oceanCenter);
  app.onPointerEnd(oceanCenter);
  assert.strictEqual(app.skins.current().id, 'ocean');
  assert.strictEqual(app.progress.getSetting('skinId', 'classic'), 'ocean');
  const restoredOcean = new ClearedApp(platform);
  assert.strictEqual(restoredOcean.skins.current().id, 'ocean', 'ocean selection survives a new app instance');

  const springHit = app.renderer.hits.find(hit => hit.id === 'theme:spring');
  assert(springHit);
  const springCenter = {
    x: springHit.rect.x + springHit.rect.w / 2,
    y: springHit.rect.y + springHit.rect.h / 2,
    id: 4
  };
  app.onPointerStart(springCenter);
  app.onPointerEnd(springCenter);
  assert.strictEqual(app.skins.current().id, 'spring');
  assert.strictEqual(app.progress.getSetting('skinId', 'classic'), 'spring');
  const restoredSpring = new ClearedApp(platform);
  assert.strictEqual(restoredSpring.skins.current().id, 'spring', 'spring selection survives a new app instance');

  const festivalHit = app.renderer.hits.find(hit => hit.id === 'theme:festival');
  assert(festivalHit);
  const festivalCenter = {
    x: festivalHit.rect.x + festivalHit.rect.w / 2,
    y: festivalHit.rect.y + festivalHit.rect.h / 2,
    id: 5
  };
  app.onPointerStart(festivalCenter);
  app.onPointerEnd(festivalCenter);
  assert.strictEqual(app.skins.current().id, 'festival');
  assert.strictEqual(app.progress.getSetting('skinId', 'classic'), 'festival');
  const restoredFestival = new ClearedApp(platform);
  assert.strictEqual(restoredFestival.skins.current().id, 'festival', 'festival selection survives a new app instance');

  const musicHit = app.renderer.hits.find(hit => hit.id === 'theme:music');
  assert(musicHit);
  const musicCenter = {
    x: musicHit.rect.x + musicHit.rect.w / 2,
    y: musicHit.rect.y + musicHit.rect.h / 2,
    id: 6
  };
  app.onPointerStart(musicCenter);
  app.onPointerEnd(musicCenter);
  assert.strictEqual(app.skins.current().id, 'music');
  assert.strictEqual(app.progress.getSetting('skinId', 'classic'), 'music');
  const restoredMusic = new ClearedApp(platform);
  assert.strictEqual(restoredMusic.skins.current().id, 'music', 'music selection survives a new app instance');

  const vehiclesHit = app.renderer.hits.find(hit => hit.id === 'theme:vehicles');
  assert(vehiclesHit);
  const vehiclesCenter = {
    x: vehiclesHit.rect.x + vehiclesHit.rect.w / 2,
    y: vehiclesHit.rect.y + vehiclesHit.rect.h / 2,
    id: 8
  };
  app.onPointerStart(vehiclesCenter);
  app.onPointerEnd(vehiclesCenter);
  assert.strictEqual(app.skins.current().id, 'vehicles');
  assert.strictEqual(app.progress.getSetting('skinId', 'classic'), 'vehicles');
  const restoredVehicles = new ClearedApp(platform);
  assert.strictEqual(restoredVehicles.skins.current().id, 'vehicles',
    'vehicle selection survives a new app instance');

  app.onPointerStart({ x: 200, y: 300, id: 7 });
  app.onPointerEnd({ x: 300, y: 300, id: 7 });
  assert.strictEqual(app.themePageIndex, 0, 'gallery swipe navigates back from the second page');
}

function run() {
  runServiceChecks();
  runRendererChecks();
  runAppChecks();
}

module.exports = run;
