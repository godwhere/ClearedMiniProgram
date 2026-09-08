'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const i18n = require('../src/i18n/index.js');
const catalog = require('../data/catalog-v2.js');
const iceTrial = require('../data/ice-trial.js');
const dailyManifest = require('../data/daily-challenges.js');
const skins = require('../src/skins/index.js');
const effects = require('../src/effects/index.js');
const mechanics = require('../src/mechanics/index.js');
const LocaleService = require('../src/services/locale-service.js');
const CanvasRenderer = require('../src/ui/canvas-renderer.js');
const classic = require('../src/skins/classic.js');
const portalInstructions = require('../src/ui/portal-instructions.js');
const ShareService = require('../src/services/share-service.js');
const ProfileService = require('../src/services/profile-service.js');
const ClearedApp = require('../src/app.js');
const WechatPlatform = require('../src/platform/wechat.js');

const CJK = /[\u3400-\u9fff]/;

function localeHost(language) {
  const storage = {};
  return {
    storage,
    readStorageResult(key) {
      return Object.prototype.hasOwnProperty.call(storage, key)
        ? { ok: true, found: true, value: storage[key] }
        : { ok: true, found: false };
    },
    setStorage(key, value) {
      storage[key] = JSON.parse(JSON.stringify(value));
      return true;
    },
    getSystemLanguage() { return language; }
  };
}

function rendererFixture(locale) {
  const text = [];
  const context = new Proxy({
    fillText(value) { text.push(String(value)); },
    measureText(value) { return { width: String(value).length * 8 }; }
  }, {
    get(target, key) {
      if (!(key in target)) target[key] = function () {};
      return target[key];
    }
  });
  const platform = {
    context,
    metrics: { width: 390, height: 844, safeTop: 44, safeBottom: 810 },
    createImage(source, callback) { callback(new Error('asset unavailable')); }
  };
  const skinService = {
    current() { return classic; },
    get(id) { return id === classic.id ? classic : null; },
    list() { return [classic]; }
  };
  return { renderer: new CanvasRenderer(platform, skinService, null, null, locale), text };
}

function assertDisplayEntry(kind, item, field) {
  const key = `${kind}.${item.id}.${field}`;
  assert.strictEqual(i18n.CATALOGS['zh-CN'][key], item[field], `${key} must preserve current Chinese copy`);
  assert.strictEqual(typeof i18n.CATALOGS['en-US'][key], 'string', `${key} needs an English display name`);
  assert(i18n.CATALOGS['en-US'][key].length > 0, `${key} cannot be empty`);
}

function dailyLevels(manifest) {
  const levels = [];
  (manifest.Days || []).forEach(day => (day.Levels || []).forEach(level => levels.push(level)));
  (manifest.Challenges || []).forEach(level => levels.push(level));
  return levels;
}

function run() {
  assert.deepStrictEqual(i18n.SUPPORTED_LOCALES, ['zh-CN', 'en-US']);
  assert.strictEqual(i18n.DEFAULT_LOCALE, 'en-US');
  assert.strictEqual(i18n.localeDisplayName('zh-CN'), '中文');
  assert.strictEqual(i18n.localeDisplayName('en-US'), 'English');

  [
    ['zh', 'zh-CN'], [' zh_CN ', 'zh-CN'], ['ZH-hans', 'zh-CN'], ['zh-TW', 'zh-CN'],
    ['en', 'en-US'], ['en_US', 'en-US'], ['EN-gb', 'en-US'], ['es-ES', 'en-US'],
    ['', 'en-US'], [null, 'en-US'], [{}, 'en-US']
  ].forEach(([input, expected]) => assert.strictEqual(i18n.resolveLocale(input), expected));
  assert.strictEqual(i18n.normalizeLocaleTag(' EN_us '), 'en-us');

  assert.deepStrictEqual(i18n.catalogValidationErrors(i18n.CATALOGS), []);
  assert.strictEqual(i18n.assertCatalogs(), true);
  const zhKeys = Object.keys(i18n.CATALOGS['zh-CN']).sort();
  const enKeys = Object.keys(i18n.CATALOGS['en-US']).sort();
  assert.deepStrictEqual(enKeys, zhKeys);
  assert(zhKeys.length >= 300, 'the Phase 1 inventory must cover complete UI and stable content copy');
  Object.values(i18n.CATALOGS['en-US']).forEach(message => {
    assert.strictEqual(typeof message, 'string');
    assert(!CJK.test(message), `English catalog contains CJK copy: ${message}`);
  });
  Object.values(i18n.CATALOGS['zh-CN']).forEach(message => assert.strictEqual(typeof message, 'string'));

  assert.strictEqual(i18n.translate('en-US', 'daily.remainingAttempts', { remaining: 2, limit: 3 }),
    'Attempts left 2 / 3');
  assert.strictEqual(i18n.translate('zh-CN', 'daily.remainingAttempts', { remaining: 2, limit: 3 }),
    '剩余次数 2 / 3');
  assert.strictEqual(i18n.translate('en-US', 'daily.remainingAttempts', { remaining: 2 }),
    'Attempts left 2 / {limit}', 'missing parameters remain visible without throwing');
  assert.strictEqual(i18n.translate('en-US', 'missing.key'), 'missing.key');
  assert.strictEqual(i18n.translate('en-US', '__proto__'), '__proto__');
  assert.doesNotThrow(() => i18n.translate(null, null, { value: { toString() { throw new Error('bad'); } } }));
  assert.deepStrictEqual(i18n.placeholders('{b} {a} {b}'), ['a', 'b']);

  const invalid = {
    'zh-CN': { example: '{count}', extra: 'x' },
    'en-US': { example: '{total}' }
  };
  const validationErrors = i18n.catalogValidationErrors(invalid);
  assert(validationErrors.some(error => error.includes('missing key: extra')));
  assert(validationErrors.some(error => error.includes('placeholders differ')));
  assert.throws(() => i18n.assertCatalogs(invalid), /Invalid localization catalogs/);

  skins.forEach(skin => {
    assertDisplayEntry('skin', skin, 'name');
    if (skin.category) assertDisplayEntry('skin', skin, 'category');
  });
  effects.forEach(effect => assertDisplayEntry('effect', effect, 'name'));
  mechanics.all().forEach(mechanic => assertDisplayEntry('mechanic', mechanic, 'name'));
  assert.strictEqual(i18n.CATALOGS['zh-CN']['level.ice-trial.name'], iceTrial.Name);
  assert.strictEqual(typeof i18n.CATALOGS['en-US']['level.ice-trial.name'], 'string');

  const namedLevels = catalog.levels.map(entry => entry.game).filter(level =>
    level && level.Id && CJK.test(level.Name || ''));
  assert(namedLevels.length > 0);
  namedLevels.forEach(level => {
    const key = `level.${level.Id}.name`;
    assert.strictEqual(i18n.CATALOGS['zh-CN'][key], level.Name, `${key} must match source data`);
    assert.strictEqual(typeof i18n.CATALOGS['en-US'][key], 'string', `${key} needs English copy`);
  });
  dailyLevels(dailyManifest).forEach(level => {
    if (!level || !level.Difficulty || !level.DifficultyLabel) return;
    const key = `difficulty.${level.Difficulty}`;
    assert.strictEqual(i18n.CATALOGS['zh-CN'][key], level.DifficultyLabel);
    assert.strictEqual(typeof i18n.CATALOGS['en-US'][key], 'string');
  });

  const enLocale = new LocaleService(localeHost('en-US'));
  const view = rendererFixture(enLocale);
  view.renderer.drawAccount({
    accountProfile: null,
    accountStatus: 'local',
    backupMode: false,
    profilePending: false,
    profileSupported: false,
    syncPending: false
  });
  const previousHit = view.renderer.hits.find(hit => hit.id === 'account:language:prev');
  const nextHit = view.renderer.hits.find(hit => hit.id === 'account:language:next');
  assert.deepStrictEqual(previousHit && previousHit.rect,
    { x: 103, y: 220, w: 44, h: 44 });
  assert.deepStrictEqual(nextHit && nextHit.rect,
    { x: 243, y: 220, w: 44, h: 44 });
  assert(view.text.includes('Account'));
  assert(view.text.includes('English'));
  assert(!view.text.some(value => CJK.test(value)), 'the English account screen cannot leak Chinese UI copy');
  view.renderer.drawHome({
    soundEnabled: true,
    accountProfile: null,
    stamina: { enabled: false },
    currency: { available: true, displayBalance: 0 },
    dailyAvailable: true,
    dailyEntryAvailable: true,
    completedCount: 0,
    totalLevels: 1
  });
  assert(!view.renderer.hits.some(hit => /^home:language:/.test(hit.id)),
    'the language selector belongs only to the account screen');

  assert.strictEqual(portalInstructions.initial(enLocale),
    'The path enters one portal and exits another');
  assert.strictEqual(portalInstructions.continued(enLocale),
    'Release at the portal, then continue from the other one');

  const share = new ShareService(
    { getStorage() { return null; }, setStorage() { return true; } },
    { isConfigured() { return false; } },
    { current() { return null; } },
    {},
    {},
    null,
    enLocale
  );
  assert.strictEqual(share.buildPayload({ scene: 'home' }).title,
    'Can you solve this puzzle?');
  assert.strictEqual(share.buildPayload({ scene: 'ordinary_result' }).title,
    'Can you solve this level?');
  assert.strictEqual(share.buildPayload({ scene: 'daily_result' }).title,
    'Can you solve today\'s Daily Challenge?');

  let nativeButtonOptions = null;
  const nativeButton = {
    onTap() {},
    offTap() {},
    destroy() {},
    show() {},
    hide() {}
  };
  const profile = new ProfileService({
    metrics: { width: 390, safeTop: 44, safeBottom: 810 },
    supportsUserInfoButton() { return true; },
    createUserInfoButton(options) { nativeButtonOptions = options; return nativeButton; }
  }, { isConfigured() { return true; } }, {
    current() { return { userId: 'test-user' }; },
    ensureSession() { return Promise.resolve({ ok: true }); }
  }, { enabled: true }, null, enLocale);
  assert(profile.mount({ rect: { x: 40, y: 300, w: 300, h: 48 } }).ok);
  assert.strictEqual(nativeButtonOptions.text, 'Authorize avatar and nickname');
  assert.strictEqual(nativeButtonOptions.lang, 'en');
  profile.dispose();
  assert(enLocale.select('zh-CN').ok);
  assert.strictEqual(share.buildPayload({ scene: 'home' }).title, '这道题你能解开吗？');

  const fakeApi = require('./account-bootstrap.test.js').fakeApi;
  const actionLocale = new LocaleService(localeHost('en-US'));
  let profileMounts = 0;
  const profileBridge = {
    current() { return null; },
    mount() { profileMounts += 1; return { ok: true }; },
    unmount() {},
    dispose() {}
  };
  const app = new ClearedApp(new WechatPlatform(fakeApi()), {
    locale: actionLocale,
    profile: profileBridge
  });
  app.scene = 'home';
  assert.strictEqual(app.performAction('account:language:next'), false);
  assert.notStrictEqual(app.performAction('home:language:next'), true);
  app.scene = 'account';
  app.dirty = false;
  app.accountMessage = 'stale';
  assert.strictEqual(app.performAction('account:language:next'), true);
  assert.strictEqual(actionLocale.current(), 'zh-CN');
  assert.strictEqual(app.dirty, true);
  assert.strictEqual(app.accountMessage, '');
  assert.strictEqual(profileMounts, 1, 'language switching remounts the native profile button');
  app.dispose();

  const i18nSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'i18n', 'index.js'), 'utf8');
  assert(!/\bwx\b|Storage|Canvas|game-runner/.test(i18nSource),
    'the catalog boundary must stay free of platform, persistence, Canvas and gameplay dependencies');
  ['zh-CN.js', 'en-US.js'].forEach(file => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'i18n', 'locales', file), 'utf8');
    assert(!/require\s*\(|function\b|=>|\bwx\b/.test(source), `${file} must remain a data-only catalog`);
  });
}

module.exports = run;
