'use strict';

const zhCN = require('./locales/zh-CN.js');
const enUS = require('./locales/en-US.js');

const SUPPORTED_LOCALES = Object.freeze(['zh-CN', 'en-US']);
const DEFAULT_LOCALE = 'en-US';
const LOCALE_DISPLAY_NAMES = Object.freeze({
  'zh-CN': '中文',
  'en-US': 'English'
});
const CATALOGS = Object.freeze({
  'zh-CN': zhCN,
  'en-US': enUS
});
const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

function hasOwn(value, key) {
  return !!value && Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeLocaleTag(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/_/g, '-').toLowerCase();
}

function resolveLocale(value) {
  const normalized = normalizeLocaleTag(value);
  if (normalized === 'zh' || normalized.startsWith('zh-')) return 'zh-CN';
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en-US';
  return DEFAULT_LOCALE;
}

function isSupportedLocale(value) {
  return SUPPORTED_LOCALES.includes(value);
}

function localeDisplayName(value) {
  const locale = isSupportedLocale(value) ? value : resolveLocale(value);
  return LOCALE_DISPLAY_NAMES[locale];
}

function placeholders(message) {
  if (typeof message !== 'string') return [];
  const found = new Set();
  let match;
  PLACEHOLDER.lastIndex = 0;
  while ((match = PLACEHOLDER.exec(message))) found.add(match[1]);
  return Array.from(found).sort();
}

function interpolate(message, params) {
  if (typeof message !== 'string') return '';
  const values = params && typeof params === 'object' ? params : null;
  PLACEHOLDER.lastIndex = 0;
  return message.replace(PLACEHOLDER, (token, name) => {
    if (!values || !hasOwn(values, name) || values[name] === null || values[name] === undefined) return token;
    try {
      return String(values[name]);
    } catch (error) {
      return token;
    }
  });
}

function translate(locale, key, params) {
  try {
    const resolved = isSupportedLocale(locale) ? locale : resolveLocale(locale);
    const catalog = CATALOGS[resolved] || CATALOGS[DEFAULT_LOCALE];
    const safeKey = typeof key === 'string' ? key : '';
    const message = hasOwn(catalog, safeKey) && typeof catalog[safeKey] === 'string'
      ? catalog[safeKey]
      : safeKey;
    return interpolate(message, params);
  } catch (error) {
    return typeof key === 'string' ? key : '';
  }
}

function catalogValidationErrors(inputCatalogs, locales) {
  const source = inputCatalogs && typeof inputCatalogs === 'object' ? inputCatalogs : {};
  const checkedLocales = Array.isArray(locales) && locales.length ? locales.slice() : SUPPORTED_LOCALES.slice();
  const errors = [];
  const referenceLocale = checkedLocales[0];
  const reference = source[referenceLocale];
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
    errors.push(`Missing catalog: ${referenceLocale}`);
    return errors;
  }
  const referenceKeys = Object.keys(reference).sort();
  referenceKeys.forEach(key => {
    if (typeof reference[key] !== 'string') errors.push(`${referenceLocale}.${key} must be a string`);
  });
  checkedLocales.slice(1).forEach(locale => {
    const catalog = source[locale];
    if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
      errors.push(`Missing catalog: ${locale}`);
      return;
    }
    const keys = Object.keys(catalog).sort();
    referenceKeys.filter(key => !hasOwn(catalog, key)).forEach(key => errors.push(`${locale} missing key: ${key}`));
    keys.filter(key => !hasOwn(reference, key)).forEach(key => errors.push(`${locale} has extra key: ${key}`));
    keys.forEach(key => {
      if (typeof catalog[key] !== 'string') {
        errors.push(`${locale}.${key} must be a string`);
        return;
      }
      if (!hasOwn(reference, key)) return;
      const expected = placeholders(reference[key]);
      const actual = placeholders(catalog[key]);
      if (expected.join('\n') !== actual.join('\n')) {
        errors.push(`${locale}.${key} placeholders differ: ${actual.join(',')} != ${expected.join(',')}`);
      }
    });
  });
  return errors;
}

function assertCatalogs(inputCatalogs, locales) {
  const errors = catalogValidationErrors(inputCatalogs || CATALOGS, locales);
  if (errors.length) throw new Error(`Invalid localization catalogs:\n${errors.join('\n')}`);
  return true;
}

module.exports = Object.freeze({
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  LOCALE_DISPLAY_NAMES,
  CATALOGS,
  normalizeLocaleTag,
  resolveLocale,
  isSupportedLocale,
  localeDisplayName,
  placeholders,
  interpolate,
  translate,
  catalogValidationErrors,
  assertCatalogs
});
