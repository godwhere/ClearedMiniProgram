'use strict';

const assert = require('assert');
const LocaleService = require('../src/services/locale-service.js');
const WechatPlatform = require('../src/platform/wechat.js');

function host(options) {
  const opts = options || {};
  const storage = Object.assign({}, opts.storage);
  const writes = [];
  return {
    storage,
    writes,
    readStorageResult(key) {
      if (opts.readFails) return { ok: false, reason: 'storage-read-failed' };
      return Object.prototype.hasOwnProperty.call(storage, key)
        ? { ok: true, found: true, value: storage[key] }
        : { ok: true, found: false };
    },
    setStorage(key, value) {
      writes.push({ key, value });
      if (opts.writeFails) return false;
      storage[key] = JSON.parse(JSON.stringify(value));
      return true;
    },
    getSystemLanguage() {
      if (opts.languageThrows) throw new Error('unreadable');
      return opts.language;
    }
  };
}

function run() {
  const key = LocaleService.STORAGE_KEY;
  const stored = host({ language: 'en-US', storage: { [key]: { schemaVersion: 1, locale: 'zh-CN' } } });
  const preferred = new LocaleService(stored);
  assert.strictEqual(preferred.current(), 'zh-CN');
  assert.strictEqual(preferred.hasExplicitPreference(), true);
  assert.deepStrictEqual(stored.writes, [], 'startup cannot rewrite an explicit preference');

  ['zh', 'zh_CN', 'zh-Hans', 'zh-TW'].forEach(language => {
    const platform = host({ language }); const service = new LocaleService(platform);
    assert.strictEqual(service.current(), 'zh-CN'); assert.strictEqual(service.hasExplicitPreference(), false);
    assert.deepStrictEqual(platform.writes, [], 'automatic resolution is never persisted');
  });
  ['en', 'en_US', 'en-GB', 'es-ES', '', null].forEach(language => {
    const service = new LocaleService(host({ language }));
    assert.strictEqual(service.current(), 'en-US'); assert.strictEqual(service.hasExplicitPreference(), false);
  });
  assert.strictEqual(new LocaleService(host({ languageThrows: true })).current(), 'en-US');
  assert.strictEqual(new LocaleService(host({ readFails: true, language: 'zh-CN' })).current(), 'zh-CN');
  [null, {}, { schemaVersion: 2, locale: 'zh-CN' }, { schemaVersion: 1, locale: 'fr-FR' }].forEach(record => {
    const service = new LocaleService(host({ language: 'en-US', storage: { [key]: record } }));
    assert.strictEqual(service.current(), 'en-US'); assert.strictEqual(service.hasExplicitPreference(), false);
  });

  const manualHost = host({ language: 'en-US' }); const manual = new LocaleService(manualHost);
  assert.deepStrictEqual(manual.previous(), { ok: true, persisted: true, locale: 'zh-CN' });
  assert.deepStrictEqual(manualHost.storage[key], { schemaVersion: 1, locale: 'zh-CN' });
  assert.strictEqual(new LocaleService(manualHost).current(), 'zh-CN', 'manual selection survives relaunch');
  assert.strictEqual(manual.next().locale, 'en-US');
  assert.strictEqual(manual.next().locale, 'zh-CN', 'next wraps');
  assert.strictEqual(manual.previous().locale, 'en-US', 'previous wraps');
  assert.strictEqual(manual.t('home.play'), 'Play');
  assert.strictEqual(manual.displayName(), 'English');
  assert.strictEqual(manual.select('fr-FR').reason, 'invalid-locale');

  const failedHost = host({ language: 'zh-CN', writeFails: true }); const failed = new LocaleService(failedHost);
  const result = failed.next();
  assert.deepStrictEqual(result, { ok: false, persisted: false, locale: 'en-US', reason: 'storage-write-failed' });
  assert.strictEqual(failed.current(), 'en-US', 'a write failure cannot roll back the active session locale');
  assert.strictEqual(new LocaleService(host({ language: 'zh-CN' })).current(), 'zh-CN');

  const base = Object.create(WechatPlatform.prototype);
  base.api = { getAppBaseInfo: () => ({ language: 'en_GB' }), getSystemInfoSync: () => ({ language: 'zh_CN' }) };
  assert.strictEqual(base.getSystemLanguage(), 'en_GB');
  base.api.getAppBaseInfo = () => ({});
  assert.strictEqual(base.getSystemLanguage(), 'zh_CN');
  base.api.getAppBaseInfo = () => { throw new Error('old SDK'); };
  assert.strictEqual(base.getSystemLanguage(), 'zh_CN');
  base.api.getSystemInfoSync = () => { throw new Error('unavailable'); };
  assert.strictEqual(base.getSystemLanguage(), null);
}

module.exports = run;
