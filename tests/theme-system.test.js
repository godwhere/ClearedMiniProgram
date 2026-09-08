const assert = require('assert');
const { createUnlimitedStaminaFixture } = require('./helpers/stamina-fixture.js');
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
const SubpackageService = require('../src/services/subpackage-service.js');
const { controlledPlatform } = require('./subpackage-service.test.js');
const bootstrap = require('../src/bootstrap.js');
const RewardUnlockService = require('../src/services/reward-unlock-service.js');
const rewardConfig = require('../src/config/rewards.js');
const { ownedState } = require('./helpers/reward-fixture.js');

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
  if (source.indexOf('preview') >= 0) return { source, width: 128, height: 128 };
  if (source.indexOf('sprite-sheet') >= 0) return { source, width: 2000, height: 800 };
  return { source, width: 96, height: 96 };
}

function createPlatform() {
  const context = fakeContext();
  const allOwned = rewardConfig.items.filter(item => item.unlock.type !== 'default').map(item => item.id);
  const storage = { [RewardUnlockService.STORAGE_KEY]: ownedState(allOwned, 0) };
  const platform = {
    context,
    metrics: { width: 390, height: 844, safeTop: 44, safeBottom: 810 },
    sources: [],
    getStorage(key) { return storage[key] || null; },
    readStorageResult(key) {
      return Object.prototype.hasOwnProperty.call(storage, key)
        ? { ok: true, found: true, value: JSON.parse(JSON.stringify(storage[key])) }
        : { ok: true, found: false };
    },
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
    startLoop() {},
    stopLoop() {}
  };
  platform.storage = storage;
  return platform;
}

function progressStub(settings) {
  return {
    getSetting(name, fallback) {
      return settings[name] === undefined ? fallback : settings[name];
    },
    setSetting(name, value) { settings[name] = value; return true; }
  };
}

function runServiceChecks() {
  const settings = {};
  const service = new SkinService(progressStub(settings), [gem, animals, fruits, desserts, space, ocean, spring, festival, music, vehicles], () => true);
  const list = service.list();
  assert.deepStrictEqual(list.map(item => item.id),
    ['classic', 'gem', 'animals', 'fruits', 'desserts', 'space', 'ocean', 'spring', 'festival', 'music', 'vehicles']);
  const gemItem = list.find(item => item.id === 'gem');
  assert.strictEqual(gemItem.name, '宝石');
  assert.strictEqual(gemItem.preview, 'assets/theme-previews/gem.png');
  const animalItem = list.find(item => item.id === 'animals');
  assert.strictEqual(animalItem.name, '动物');
  assert.strictEqual(animalItem.preview, 'assets/theme-previews/animals.png');
  const fruitItem = list.find(item => item.id === 'fruits');
  assert.strictEqual(fruitItem.name, '水果');
  assert.strictEqual(fruitItem.preview, 'assets/theme-previews/fruits.png');
  const dessertItem = list.find(item => item.id === 'desserts');
  assert.strictEqual(dessertItem.name, '甜点');
  assert.strictEqual(dessertItem.category, '甜点');
  assert.strictEqual(dessertItem.preview, 'assets/theme-previews/desserts.png');
  const spaceItem = list.find(item => item.id === 'space');
  assert.strictEqual(spaceItem.name, '太空');
  assert.strictEqual(spaceItem.category, '太空');
  assert.strictEqual(spaceItem.preview, 'assets/theme-previews/space.png');
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
  assert.strictEqual(oceanItem.preview, 'assets/theme-previews/ocean.png');
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
  assert.strictEqual(springItem.preview, 'assets/theme-previews/spring.png');
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
  assert.strictEqual(festivalItem.preview, 'assets/theme-previews/festival.png');
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
  assert.strictEqual(musicItem.preview, 'assets/theme-previews/music.png');
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
  assert.strictEqual(vehiclesItem.preview, 'assets/theme-previews/vehicles.png');
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
  const service = new SkinService(progressStub({}), [gem, animals, fruits, desserts, space, ocean, spring, festival, music, vehicles], () => true);
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

  [3, 2, 0].forEach(remaining => {
    platform.context.calls.length = 0;
    renderer.render({
      scene: 'home', completedCount: 0, totalLevels: 92, soundEnabled: true,
      dailyAvailable: true, dailyEntryAvailable: remaining > 0,
      dailyEntriesRemaining: remaining, dailyEntryLimit: 3
    }, now);
    const labels = platform.context.calls.filter(call => call.op === 'fillText').map(call => call.args[0]);
    assert(labels.includes(`每日挑战（${remaining}/3）`), 'home label includes live remaining entries');
    assert(!labels.some(label => /剩余次数|高难关卡/.test(label)), 'home does not duplicate the count or old label');
    assert.strictEqual(renderer.hits.some(hit => hit.id === 'home:dailyChallenge'), remaining > 0,
      'exhausted daily entry stays disabled');
  });

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
  assert.strictEqual(themeHomeHit.rect.y + themeHomeHit.rect.h / 2,
    platform.metrics.safeTop + 4 + 8 + 16 + 22, 'enlarged back button retains the original toolbar center');
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
  function assertPreviewFrames(theme) {
    assert(platform.sources.includes(theme.preview), `${theme.id}: loads the main-package preview`);
    const calls = platform.context.calls.filter(call => call.op === 'drawImage' &&
      call.args[0] && call.args[0].source === theme.preview);
    assert.deepStrictEqual(calls.map(call => call.args.slice(1, 5)), [
      [0, 0, 64, 64], [64, 0, 64, 64], [0, 64, 64, 64], [64, 64, 64, 64]
    ], `${theme.id}: uses the four 64px preview slots in row-major order`);
    assert.strictEqual(service.get(theme.id).tileVisuals.columns, 5);
    assert.strictEqual(service.get(theme.id).tileVisuals.count, 10,
      'drawing a preview never changes the registered board manifest');
  }
  [gem, animals, fruits, desserts, space].forEach(assertPreviewFrames);
  assert.strictEqual(platform.sources.some(source => source.startsWith('assets/skins/')), false,
    'gallery previews do not decode full sheets even on a host without subpackage gating');
  assert.strictEqual(platform.sources.some(source => source === ocean.preview), false,
    'the next page is not loaded before it is visible');

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
  [ocean, spring, festival, music, vehicles].forEach(assertPreviewFrames);

  service.select('gem');
  renderer.loadSkinAssets();
  platform.context.calls.length = 0;
  renderer.drawTile(9, 0, 0, 64, { skin: service.current() });
  const tenthTile = platform.context.calls.find(call => call.op === 'drawImage');
  assert.strictEqual(tenthTile.args[0].source, gem.assets.tileSheet);
  assert.deepStrictEqual(tenthTile.args.slice(1, 5), [1600, 400, 400, 400],
    'the board still draws its tenth slot from the full sheet after gallery rendering');
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

function runPreviewChecks() {
  const rect = { x: 0, y: 0, w: 132, h: 132 };
  const service = new SkinService(progressStub({ skinId: 'gem' }), [gem], () => true);
  const coldPlatform = createPlatform();
  new CanvasRenderer(coldPlatform, service);
  assert(coldPlatform.sources.includes(gem.assets.tileSheet));
  assert(!coldPlatform.sources.includes(gem.preview),
    'preparing a saved theme for gameplay does not load its gallery preview');

  ['error', 'zero', 'wrong-size', 'throw', 'missing'].forEach(mode => {
    const platform = createPlatform();
    platform.createImage = function (source, callback) {
      this.sources.push(source);
      if (source === gem.preview) {
        if (mode === 'throw') throw new Error('decode failed');
        if (mode === 'error') { callback(new Error('missing image')); return null; }
        const image = { source, width: mode === 'zero' ? 0 : 128, height: 96 };
        callback(null, image);
        return image;
      }
      const image = imageFor(source);
      callback(null, image);
      return image;
    };
    const manifest = mode === 'missing' ? Object.assign({}, gem, { preview: undefined }) : gem;
    const skins = new SkinService(progressStub({}), [manifest], () => true);
    const renderer = new CanvasRenderer(platform, skins, null, new SubpackageService({}));
    for (let frame = 0; frame < 3; frame++) {
      assert.doesNotThrow(() => renderer.drawThemeElementsPreview(manifest, rect, skins.current()));
    }
    assert(!platform.sources.includes(gem.assets.tileSheet), `${mode}: never reads an unloaded sheet`);
    assert.strictEqual(platform.sources.filter(source => source === gem.preview).length,
      mode === 'missing' ? 0 : 1, `${mode}: no per-frame preview retries`);
    assert(!platform.context.calls.some(call => call.op === 'drawImage'));
    assert(platform.context.calls.some(call => call.op === 'fillRect'), `${mode}: retains color fallback`);
  });

  const readyPlatform = createPlatform();
  const readyCreate = readyPlatform.createImage;
  readyPlatform.createImage = function (source, callback) {
    if (source === gem.preview) { this.sources.push(source); callback(new Error('missing preview')); return null; }
    return readyCreate.call(this, source, callback);
  };
  const readyRenderer = new CanvasRenderer(readyPlatform, service);
  readyRenderer.drawThemeElementsPreview(gem, rect, service.current());
  assert.strictEqual(readyPlatform.context.calls.filter(call => call.op === 'drawImage' &&
    call.args[0].source === gem.assets.tileSheet).length, 4,
  'a ready full sheet can still supply the preview fallback');

  const callbacks = {};
  const delayedPlatform = createPlatform();
  delayedPlatform.createImage = function (source, callback) {
    this.sources.push(source);
    callbacks[source] = callback;
    return imageFor(source);
  };
  const delayedRenderer = new CanvasRenderer(delayedPlatform, service);
  const oldSource = 'assets/theme-previews/old.png';
  const newSource = 'assets/theme-previews/new.png';
  delayedRenderer.ensurePreviewImage({ id: 'gem', preview: oldSource });
  delayedRenderer.ensurePreviewImage({ id: 'gem', preview: newSource });
  const newImage = imageFor(newSource);
  callbacks[newSource](null, newImage);
  callbacks[oldSource](null, imageFor(oldSource));
  assert.strictEqual(delayedRenderer.previewImages.gem, newImage, 'late old-source completion is ignored');
  delayedRenderer.invalidateThemeAssets('gem');
  assert.strictEqual(delayedRenderer.previewImages.gem, newImage, 'board invalidation preserves the preview');
  assert.strictEqual(delayedRenderer.ensurePreviewImage({ id: 'gem', preview: newSource }), newImage);
  assert.strictEqual(delayedPlatform.sources.filter(source => source === newSource).length, 1);
  delayedRenderer.ensurePreviewImage({ id: 'gem', preview: oldSource });
  const abandonedCallback = callbacks[oldSource];
  assert.strictEqual(delayedRenderer.ensurePreviewImage({ id: 'gem', preview: newSource }), newImage);
  abandonedCallback(null, imageFor(oldSource));
  assert.strictEqual(delayedRenderer.previewImages.gem, newImage,
    'switching back to a cached source cancels ownership of a pending different source');
  ['https://example.com/preview.png', 'data:image/png;base64,AA', '//example.com/preview.png'].forEach(source => {
    assert.strictEqual(delayedRenderer.ensurePreviewImage({ id: 'remote', preview: source }), null);
    assert(!delayedPlatform.sources.includes(source), 'gallery preview cannot start a network request');
  });
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
  assert(platform.sources.includes(desserts.preview), 'the selected card already has its small preview');

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

async function flushThemeCallbacks() {
  await Promise.resolve();
  await Promise.resolve();
}

async function runSubpackageChecks() {
  const platform = Object.assign(createPlatform(), controlledPlatform());
  const subpackages = new SubpackageService(platform);
  const app = new ClearedApp(platform, {
    subpackages,
    stamina: createUnlimitedStaminaFixture(),
    audioConfig: { enabledByDefault: false, sfx: {} }
  });
  app.start();
  app.tick(1000);
  assert.strictEqual(platform.calls.length, 0, 'classic cold start never downloads');
  assert(!platform.sources.some(source => source.startsWith('assets/theme-previews/')),
    'classic cold start does not load gallery previews');
  app.performAction('home:themes');
  app.tick(1001);
  assert.deepStrictEqual(platform.sources.filter(source => source.startsWith('assets/theme-previews/')),
    [gem, animals, fruits, desserts, space].map(theme => theme.preview),
    'only visible first-page previews are read without downloading a subpackage');
  app.changeThemePage(1);
  app.tick(1002);
  assert.strictEqual(platform.calls.length, 0, 'gallery browsing never starts a theme download');
  [gem, animals, fruits, desserts, space, ocean, spring, festival, music, vehicles].forEach(theme => {
    assert(platform.context.calls.some(call => call.op === 'drawImage' && call.args[0].source === theme.preview),
      `${theme.id}: preview is visible while every subpackage is idle`);
  });
  assert(!platform.sources.some(source => source.startsWith('assets/skins/')),
    'neither gallery page reads an unloaded sheet');
  ['themeTileImages', 'themeTileSources', 'themeTileLoads'].forEach(key => {
    assert.deepStrictEqual(Object.keys(app.renderer[key]), [], 'unloaded images are not memoized');
  });
  assert(platform.context.calls.some(call => call.op === 'fillText' && call.args[0] === '点击下载'));
  const savedBefore = JSON.stringify(platform.storage);
  const idBefore = app.skinLoadRequestId;
  assert.strictEqual(app.setSkin('__proto__'), false);
  assert.strictEqual(app.setSkin({}), false);
  assert.strictEqual(app.skinLoadRequestId, idBefore);
  assert.strictEqual(app.setSkin('gem'), true);
  assert.strictEqual(app.pendingSkinId, 'gem');
  assert.strictEqual(app.skins.current().id, 'classic');
  assert.strictEqual(JSON.stringify(platform.storage), savedBefore);
  assert.strictEqual(platform.calls[0].name, 'theme-gem');
  app.setSkin('gem');
  assert.strictEqual(platform.calls.length, 1, 'repeat clicks share the download');
  platform.calls[0].progress({ progress: 37, totalBytesWritten: 37, totalBytesExpectedToWrite: 100 });
  const descriptor = app.themeDescriptors().find(theme => theme.id === 'gem');
  assert.strictEqual(descriptor.assetState, 'loading');
  assert.strictEqual(descriptor.assetProgress, 37);
  assert.strictEqual(descriptor.pending, true);
  assert(!Object.keys(descriptor).some(key => /promise|task|error/i.test(key)));
  app.changeThemePage(-1);
  app.tick(1003);
  assert(platform.context.calls.some(call => call.op === 'fillText' && call.args[0] === '下载 37%'));
  assert(!platform.sources.some(source => source.startsWith('assets/skins/')));
  const cachedGemPreview = app.renderer.previewImages.gem;
  assert.strictEqual(cachedGemPreview.source, gem.preview);
  // Seed previous failed image records to prove success explicitly invalidates them.
  app.renderer.themeTileImages.gem = null;
  app.renderer.themeTileSources.gem = gem.assets.tileSheet;
  app.renderer.themeTileLoads.gem = { source: gem.assets.tileSheet };
  platform.calls[0].success();
  assert.strictEqual(app.skins.current().id, 'classic', 'commit waits for the promise');
  await flushThemeCallbacks();
  assert.strictEqual(app.skins.current().id, 'gem');
  assert.strictEqual(app.progress.getSetting('skinId'), 'gem');
  assert.strictEqual(app.pendingSkinId, null);
  assert(platform.sources.includes(gem.assets.tileSheet));
  assert.strictEqual(app.renderer.themeTileLoads.gem, undefined);
  assert.strictEqual(app.renderer.previewSources.gem, gem.preview);
  assert.strictEqual(app.renderer.previewImages.gem, cachedGemPreview,
    'download completion keeps the small card image cached');
  assert.strictEqual(app.scene, 'themes');

  const beforeFail = JSON.stringify(platform.storage);
  app.setSkin('animals');
  platform.calls[1].fail({ errMsg: 'offline' });
  await flushThemeCallbacks();
  assert.strictEqual(app.skins.current().id, 'gem');
  assert.strictEqual(JSON.stringify(platform.storage), beforeFail);
  assert.strictEqual(app.pendingSkinId, null);
  app.tick(1004);
  assert(platform.context.calls.some(call => call.op === 'fillText' && call.args[0] === '加载失败，点击重试'));
  assert.strictEqual(app.renderer.previewImages.animals.source, animals.preview,
    'failed downloads do not remove their main-package preview');
  assert.strictEqual(platform.sources.filter(source => source === animals.preview).length, 1,
    'progress, failure, and repeated gallery frames reuse the preview');
  app.setSkin('animals');
  assert.strictEqual(platform.calls.length, 3);
  platform.calls[2].success();
  await flushThemeCallbacks();
  assert.strictEqual(app.skins.current().id, 'animals');

  // The last valid click wins, including already-loaded and main-package themes.
  app.setSkin('fruits');
  app.setSkin('space');
  platform.calls[4].success();
  await flushThemeCallbacks();
  platform.calls[3].success();
  await flushThemeCallbacks();
  assert.strictEqual(app.skins.current().id, 'space');
  assert.strictEqual(app.progress.getSetting('skinId'), 'space');
  app.setSkin('ocean');
  app.setSkin('gem');
  platform.calls[5].success();
  await flushThemeCallbacks();
  assert.strictEqual(app.skins.current().id, 'gem');
  app.setSkin('spring');
  app.setSkin('classic');
  assert.strictEqual(platform.calls.length, 7, 'classic itself never requests a package');
  platform.calls[6].success();
  await flushThemeCallbacks();
  assert.strictEqual(app.skins.current().id, 'classic');
  app.setSkin('music');
  app.setSkin('vehicles');
  platform.calls[7].fail();
  await flushThemeCallbacks();
  assert.strictEqual(app.pendingSkinId, 'vehicles', 'stale failure cannot clear the latest pending');
  assert.strictEqual(app.setSkin('unknown'), false);
  platform.calls[8].success();
  await flushThemeCallbacks();
  assert.strictEqual(app.skins.current().id, 'vehicles');
  assert.strictEqual(app.openLevel(0, 0), true);

  // Restart with saved theme: fresh service must load again; the first frame
  // and a playable board exist while the package request is unresolved.
  platform.sources.length = 0;
  const restored = new ClearedApp(platform, { subpackages: new SubpackageService(platform), stamina: createUnlimitedStaminaFixture() });
  const saved = JSON.stringify(platform.storage);
  restored.start();
  restored.tick(2000);
  assert(restored.renderer.hits.length > 0);
  assert.strictEqual(restored.skins.current().id, 'vehicles');
  assert.strictEqual(platform.calls.length, 10);
  assert(!platform.sources.includes(vehicles.assets.tileSheet));
  assert(platform.sources.includes('assets/logo.png'), 'inherited main-package logo remains accessible');
  assert.strictEqual(restored.openLevel(0, 0), true);
  platform.calls[9].success();
  await flushThemeCallbacks();
  assert(platform.sources.includes(vehicles.assets.tileSheet));
  assert.strictEqual(JSON.stringify(platform.storage), saved, 'restoration does not rewrite settings');

  const restoreFail = new ClearedApp(platform, { subpackages: new SubpackageService(platform), stamina: createUnlimitedStaminaFixture() });
  restoreFail.start();
  platform.calls[10].fail();
  await flushThemeCallbacks();
  assert.strictEqual(restoreFail.skins.current().id, 'vehicles');
  assert.strictEqual(restoreFail.progress.getSetting('skinId'), 'vehicles');
  assert.strictEqual(restoreFail.pendingSkinId, null);
  assert.strictEqual(restoreFail.openLevel(0, 0), true);
  const restoreRace = new ClearedApp(platform, { subpackages: new SubpackageService(platform), stamina: createUnlimitedStaminaFixture() });
  restoreRace.start();
  restoreRace.setSkin('classic');
  platform.calls[11].success();
  await flushThemeCallbacks();
  assert.strictEqual(restoreRace.skins.current().id, 'classic');

  const unsupportedPlatform = createPlatform();
  const unsupported = new ClearedApp(unsupportedPlatform, {
    subpackages: new SubpackageService(unsupportedPlatform)
  });
  unsupported.setSkin('gem');
  await flushThemeCallbacks();
  assert.strictEqual(unsupported.skins.current().id, 'classic');
  assert.strictEqual(unsupported.pendingSkinId, null);
  assert.strictEqual(unsupported.themeDescriptors()[1].assetState, 'failed');
  assert.strictEqual(unsupported.openLevel(0, 0), true);

  const revokedPlatform = Object.assign(createPlatform(), controlledPlatform());
  const revoked = new ClearedApp(revokedPlatform, {
    subpackages: new SubpackageService(revokedPlatform), stamina: createUnlimitedStaminaFixture()
  });
  assert.strictEqual(revoked.setSkin('gem'), true);
  assert.strictEqual(revoked.pendingSkinId, 'gem');
  delete revoked.rewardUnlocks.state.ownedRewards['theme:gem'];
  revokedPlatform.calls[0].success();
  await flushThemeCallbacks();
  assert.strictEqual(revoked.pendingSkinId, null, 'revoked ownership clears a completed download indicator');
  assert.strictEqual(revoked.skins.current().id, 'classic');
  assert.strictEqual(revoked.progress.getSetting('skinId'), 'classic');
  revoked.dispose();

  // Even thrown image decode errors cannot prevent a successful package from
  // selecting its palette or making the game playable.
  platform.createImage = () => { throw new Error('decode failed'); };
  assert.doesNotThrow(() => app.setSkin('gem'));
  app.performAction('home:themes');
  assert.doesNotThrow(() => app.tick(3000));
  assert.strictEqual(app.renderer.images.tileSheet, undefined);
  assert.strictEqual(app.renderer.ensureThemeTileImage(gem).image, null);

  // Optional preview paths use the same gate and do not poison their cache.
  const gated = new CanvasRenderer(createPlatform(), app.skins, null, new SubpackageService({}));
  assert.strictEqual(gated.ensurePreviewImage({ id: 'gem', preview: gem.assets.tileSheet }), null);
  assert.strictEqual(gated.previewSources.gem, undefined);
  assert.strictEqual(gated.previewLoads.gem, undefined);
}

async function runBootstrapSubpackageChecks() {
  const platform = Object.assign(createPlatform(), controlledPlatform());
  const canvas = {
    getContext() { return platform.context; },
    requestAnimationFrame() { return 1; },
    cancelAnimationFrame() {}
  };
  const previousWx = global.wx;
  try {
    global.wx = {
      createCanvas() { return canvas; },
      getWindowInfo() { return { windowWidth: 390, windowHeight: 844 }; },
      getStorageSync: key => platform.getStorage(key),
      getStorageInfoSync: () => ({ keys: Object.keys(platform.storage) }),
      setStorageSync: (key, value) => platform.setStorage(key, value),
      createImage() {
        const image = { width: 2000, height: 800 };
        Object.defineProperty(image, 'src', { set(source) {
          platform.sources.push(source);
          Object.assign(image, imageFor(source));
          image.onload();
        } });
        return image;
      },
      onTouchStart() {}, onTouchMove() {}, onTouchEnd() {},
      loadSubpackage(handlers) { platform.calls.push(handlers); return {}; }
    };
    const app = bootstrap.start();
    assert(app.subpackages instanceof SubpackageService);
    assert.strictEqual(app.renderer.subpackages, app.subpackages);
    assert.strictEqual(platform.calls.length, 0);
    app.setSkin('gem');
    platform.calls[0].success();
    await flushThemeCallbacks();
    app.platform.stopLoop();
    platform.sources.length = 0;
    const restored = bootstrap.start();
    assert.strictEqual(platform.calls.length, 2);
    restored.tick(1000);
    assert(restored.renderer.hits.length > 0);
    assert(!platform.sources.includes(gem.assets.tileSheet));
    platform.calls[1].success();
    await flushThemeCallbacks();
    assert(platform.sources.includes(gem.assets.tileSheet));
    restored.platform.stopLoop();
  } finally {
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
  }
}

async function run() {
  runServiceChecks();
  runRendererChecks();
  runPreviewChecks();
  runAppChecks();
  await runSubpackageChecks();
  await runBootstrapSubpackageChecks();
}

module.exports = run;
