'use strict';

const CAPABILITY_KEYS = [
  'dailyEnabled',
  'adsEnabled',
  'rewardedShareEnabled',
  'resultShareEnabled'
];
const HINT_MODES = new Set(['free', 'rewarded', 'share', 'tiered']);
const KNOWN_KEYS = new Set(CAPABILITY_KEYS.concat([
  'hintMode',
  'freeLevelKeys',
  'fullGameEntitlementId',
  'iceTrialRequiresFullGame'
]));
const LEVEL_KEY = /^(0|[1-9]\d*):(0|[1-9]\d*)$/;
const LOGICAL_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const EMPTY_DAILY_COMPLETIONS = Object.freeze({
  ok: true,
  days: Object.freeze([])
});
const instances = new WeakSet();

function plainObject(value) {
  if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function booleanValue(source, fallback, key) {
  if (!Object.prototype.hasOwnProperty.call(source, key)) return fallback;
  if (typeof source[key] !== 'boolean') throw new Error(`invalid-product-policy:${key}`);
  return source[key];
}

function normalize(input, compatibility) {
  const source = input === undefined ? {} : input;
  const fallback = compatibility === undefined ? {} : compatibility;
  if (!plainObject(source) || !plainObject(fallback)) {
    throw new Error('invalid-product-policy');
  }
  Object.keys(source).forEach(key => {
    if (!KNOWN_KEYS.has(key)) throw new Error(`unknown-product-policy-key:${key}`);
  });

  const config = {};
  CAPABILITY_KEYS.forEach(key => {
    config[key] = booleanValue(source,
      booleanValue(fallback, true, key), key);
  });
  const hintMode = Object.prototype.hasOwnProperty.call(source, 'hintMode')
    ? source.hintMode
    : (Object.prototype.hasOwnProperty.call(fallback, 'hintMode') ? fallback.hintMode : 'tiered');
  if (typeof hintMode !== 'string' || !HINT_MODES.has(hintMode)) {
    throw new Error('invalid-product-policy:hintMode');
  }
  if (hintMode === 'rewarded' && !config.adsEnabled) {
    throw new Error('invalid-product-policy:rewarded-hint-requires-ads');
  }
  if ((hintMode === 'share' || hintMode === 'tiered') && !config.rewardedShareEnabled) {
    throw new Error('invalid-product-policy:shared-hint-requires-rewarded-share');
  }
  config.hintMode = hintMode;

  const freeLevelKeys = Object.prototype.hasOwnProperty.call(source, 'freeLevelKeys')
    ? source.freeLevelKeys
    : (Object.prototype.hasOwnProperty.call(fallback, 'freeLevelKeys') ? fallback.freeLevelKeys : []);
  if (!Array.isArray(freeLevelKeys) || freeLevelKeys.length > 512 ||
      !freeLevelKeys.every(key => typeof key === 'string' && LEVEL_KEY.test(key)) ||
      new Set(freeLevelKeys).size !== freeLevelKeys.length) {
    throw new Error('invalid-product-policy:freeLevelKeys');
  }
  config.freeLevelKeys = Object.freeze(freeLevelKeys.slice());

  const entitlementId = Object.prototype.hasOwnProperty.call(source, 'fullGameEntitlementId')
    ? source.fullGameEntitlementId
    : (Object.prototype.hasOwnProperty.call(fallback, 'fullGameEntitlementId')
      ? fallback.fullGameEntitlementId : null);
  if (entitlementId !== null && (typeof entitlementId !== 'string' || !LOGICAL_ID.test(entitlementId))) {
    throw new Error('invalid-product-policy:fullGameEntitlementId');
  }
  config.fullGameEntitlementId = entitlementId;
  config.iceTrialRequiresFullGame = booleanValue(source,
    booleanValue(fallback, false, 'iceTrialRequiresFullGame'), 'iceTrialRequiresFullGame');
  return Object.freeze(config);
}

function create(input, compatibility) {
  if (input && typeof input === 'object' && instances.has(input)) return input;
  const config = normalize(input, compatibility);
  const capabilities = Object.freeze({
    dailyEnabled: config.dailyEnabled,
    adsEnabled: config.adsEnabled,
    rewardedShareEnabled: config.rewardedShareEnabled,
    resultShareEnabled: config.resultShareEnabled,
    hintMode: config.hintMode
  });
  const policy = Object.freeze({
    config,
    capabilities,
    isEnabled(name) {
      const key = `${name}Enabled`;
      return CAPABILITY_KEYS.includes(key) && capabilities[key] === true;
    },
    hintMode() { return capabilities.hintMode; },
    dailyCompletionSource() {
      return capabilities.dailyEnabled ? null : EMPTY_DAILY_COMPLETIONS;
    }
  });
  instances.add(policy);
  return policy;
}

module.exports = Object.freeze({
  create,
  normalize,
  EMPTY_DAILY_COMPLETIONS
});
