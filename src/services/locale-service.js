'use strict';

const i18n = require('../i18n/index.js');

const STORAGE_KEY = 'cleared:minigame:locale:v1';
const SCHEMA_VERSION = 1;

function validRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    value.schemaVersion === SCHEMA_VERSION && i18n.isSupportedLocale(value.locale);
}

class LocaleService {
  constructor(platform, options) {
    this.platform = platform;
    this.appPersistence = options && options.appPersistence || null;
    this.explicit = false;
    if (this.appPersistence) {
      const saved = this.appPersistence.current(STORAGE_KEY);
      if (saved !== null && !validRecord(saved)) throw new Error('app-local-invalid-locale');
      if (saved) {
        this.locale = saved.locale;
        this.explicit = true;
      } else {
        let language = null;
        try { language = platform.getSystemLanguage(); } catch (error) {}
        this.locale = i18n.resolveLocale(language);
      }
    } else this.locale = this.load();
  }

  loadPreference() {
    try {
      if (this.platform && typeof this.platform.readStorageResult === 'function') {
        const result = this.platform.readStorageResult(STORAGE_KEY);
        return result && result.ok === true && result.found === true ? result.value : null;
      }
      return this.platform && typeof this.platform.getStorage === 'function'
        ? this.platform.getStorage(STORAGE_KEY) : null;
    } catch (error) {
      return null;
    }
  }

  load() {
    const saved = this.loadPreference();
    if (validRecord(saved)) {
      this.explicit = true;
      return saved.locale;
    }
    let language = null;
    try {
      language = this.platform && typeof this.platform.getSystemLanguage === 'function'
        ? this.platform.getSystemLanguage() : null;
    } catch (error) {}
    return i18n.resolveLocale(language);
  }

  current() {
    return this.locale;
  }

  hasExplicitPreference() {
    return this.explicit;
  }

  t(key, params) {
    return i18n.translate(this.locale, key, params);
  }

  displayName(locale) {
    return i18n.localeDisplayName(locale === undefined ? this.locale : locale);
  }

  select(locale) {
    if (this.appPersistence) throw new Error('app-local-sync-locale-write');
    if (!i18n.isSupportedLocale(locale)) {
      return { ok: false, persisted: false, locale: this.locale, reason: 'invalid-locale' };
    }
    this.locale = locale;
    this.explicit = true;
    let persisted = false;
    try {
      persisted = !!(this.platform && typeof this.platform.setStorage === 'function' &&
        this.platform.setStorage(STORAGE_KEY, { schemaVersion: SCHEMA_VERSION, locale }) === true);
    } catch (error) {}
    return persisted
      ? { ok: true, persisted: true, locale }
      : { ok: false, persisted: false, locale, reason: 'storage-write-failed' };
  }

  shift(offset) {
    const currentIndex = Math.max(0, i18n.SUPPORTED_LOCALES.indexOf(this.locale));
    const amount = Number.isFinite(Number(offset)) ? Math.trunc(Number(offset)) : 0;
    const length = i18n.SUPPORTED_LOCALES.length;
    const index = ((currentIndex + amount) % length + length) % length;
    return this.select(i18n.SUPPORTED_LOCALES[index]);
  }

  previous() {
    return this.shift(-1);
  }

  next() {
    return this.shift(1);
  }

  async selectAsync(locale) {
    if (!this.appPersistence) throw new Error('app-local-persistence-required');
    if (!i18n.isSupportedLocale(locale)) return { ok: false, persisted: false,
      locale: this.locale, reason: 'invalid-locale' };
    let saved;
    try { saved = await this.appPersistence.run(STORAGE_KEY, () => ({
      candidate: { schemaVersion: SCHEMA_VERSION, locale }
    })); } catch (error) { saved = { ok: false, reason: 'storage-write-failed' }; }
    if (!saved.ok) return { ok: false, persisted: false, locale: this.locale, reason: saved.reason };
    this.locale = saved.value.locale;
    this.explicit = true;
    return { ok: true, persisted: true, locale: this.locale };
  }

  shiftAsync(offset) {
    const currentIndex = Math.max(0, i18n.SUPPORTED_LOCALES.indexOf(this.locale));
    const length = i18n.SUPPORTED_LOCALES.length;
    const index = ((currentIndex + offset) % length + length) % length;
    return this.selectAsync(i18n.SUPPORTED_LOCALES[index]);
  }

  previousAsync() { return this.shiftAsync(-1); }
  nextAsync() { return this.shiftAsync(1); }
}

LocaleService.STORAGE_KEY = STORAGE_KEY;
LocaleService.SCHEMA_VERSION = SCHEMA_VERSION;
LocaleService.validRecord = validRecord;

module.exports = LocaleService;
