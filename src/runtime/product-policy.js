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
const ENTITLEMENT_STATUSES = Object.freeze([
  'unknown',
  'not_owned',
  'pending',
  'owned_verified',
  'temporarily_unavailable',
  'revoked'
]);
const ENTITLEMENT_STATUS_SET = new Set(ENTITLEMENT_STATUSES);
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

function nullableString(value) {
  return value === undefined || value === null || value === '' ? null
    : (typeof value === 'string' ? value : undefined);
}

function defaultEntitlementSnapshot(productId) {
  return Object.freeze({
    productId: productId || null,
    status: 'unknown',
    source: null,
    transactionId: null,
    verifiedAt: null,
    revision: 0,
    verifiedCache: false,
    price: null
  });
}

function normalizePrice(value) {
  if (value === undefined || value === null) return null;
  if (!plainObject(value)) return undefined;
  const localized = nullableString(value.localized);
  const currencyCode = nullableString(value.currencyCode);
  if (localized === undefined || currencyCode === undefined) return undefined;
  if (localized === null && currencyCode === null) return null;
  return Object.freeze({ localized, currencyCode });
}

function normalizeEntitlementSnapshot(input, productId) {
  const fallback = defaultEntitlementSnapshot(productId);
  if (!plainObject(input)) {
    return Object.freeze({ ok: false, reason: 'invalid-entitlement-snapshot', snapshot: fallback });
  }
  const candidateProductId = nullableString(input.productId);
  const source = nullableString(input.source);
  const transactionId = nullableString(input.transactionId);
  const status = input.status;
  const revision = input.revision;
  const verifiedAt = input.verifiedAt === undefined || input.verifiedAt === null
    ? null : Number(input.verifiedAt);
  const price = normalizePrice(input.price);
  const statusFieldsValid = status !== 'owned_verified' ||
    (verifiedAt !== null && source !== null);
  const cacheFieldsValid = !(status === 'temporarily_unavailable' && input.verifiedCache === true) ||
    (verifiedAt !== null && source !== null);
  const valid = candidateProductId !== undefined && source !== undefined &&
    transactionId !== undefined && ENTITLEMENT_STATUS_SET.has(status) &&
    Number.isSafeInteger(revision) && revision >= 0 &&
    (verifiedAt === null || (Number.isFinite(verifiedAt) && verifiedAt >= 0)) &&
    (input.verifiedCache === undefined || typeof input.verifiedCache === 'boolean') &&
    price !== undefined && statusFieldsValid && cacheFieldsValid &&
    (!productId || candidateProductId === productId);
  if (!valid) {
    return Object.freeze({ ok: false, reason: 'invalid-entitlement-snapshot', snapshot: fallback });
  }
  const snapshot = Object.freeze({
    productId: candidateProductId,
    status,
    source,
    transactionId,
    verifiedAt,
    revision,
    verifiedCache: input.verifiedCache === true,
    price
  });
  return Object.freeze({ ok: true, snapshot });
}

function targetKey(target) {
  if (!plainObject(target) || target.type !== 'level' ||
      !Number.isInteger(target.setIndex) || target.setIndex < 0 ||
      !Number.isInteger(target.levelIndex) || target.levelIndex < 0) return null;
  return `${target.setIndex}:${target.levelIndex}`;
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
    },
    hasFullGameGate() {
      return config.fullGameEntitlementId !== null;
    },
    defaultEntitlementSnapshot() {
      return defaultEntitlementSnapshot(config.fullGameEntitlementId);
    },
    normalizeEntitlementSnapshot(input) {
      return normalizeEntitlementSnapshot(input, config.fullGameEntitlementId);
    },
    contentAccess(target, inputSnapshot) {
      if (!config.fullGameEntitlementId) {
        return Object.freeze({ allowed: true, reason: 'not_gated', entitlementStatus: 'unknown' });
      }
      const levelKey = targetKey(target);
      const isIceTrial = plainObject(target) && target.type === 'iceTrial';
      if (!levelKey && !isIceTrial) {
        return Object.freeze({ allowed: false, reason: 'invalid_content_target', entitlementStatus: 'unknown' });
      }
      if (levelKey && config.freeLevelKeys.includes(levelKey)) {
        return Object.freeze({ allowed: true, reason: 'free_preview', entitlementStatus: 'unknown' });
      }
      if (isIceTrial && !config.iceTrialRequiresFullGame) {
        return Object.freeze({ allowed: true, reason: 'not_gated', entitlementStatus: 'unknown' });
      }
      const normalized = normalizeEntitlementSnapshot(inputSnapshot, config.fullGameEntitlementId);
      const snapshot = normalized.ok ? normalized.snapshot : defaultEntitlementSnapshot(config.fullGameEntitlementId);
      const verified = snapshot.status === 'owned_verified' ||
        (snapshot.status === 'temporarily_unavailable' && snapshot.verifiedCache === true);
      return Object.freeze({
        allowed: verified,
        reason: verified
          ? (snapshot.status === 'owned_verified' ? 'owned_verified' : 'verified_cache')
          : 'requires_full_game',
        entitlementStatus: snapshot.status
      });
    }
  });
  instances.add(policy);
  return policy;
}

module.exports = Object.freeze({
  create,
  normalize,
  normalizeEntitlementSnapshot,
  ENTITLEMENT_STATUSES,
  EMPTY_DAILY_COMPLETIONS
});
