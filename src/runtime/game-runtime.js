'use strict';

const ClearedApp = require('../app.js');
const SubpackageService = require('../services/subpackage-service.js');
const ProgressStore = require('../services/progress-store.js');
const StaminaService = require('../services/stamina-service.js');
const DailyProgressStore = require('../services/daily-progress-store.js');
const PreferencesService = require('../services/preferences-service.js');
const RewardUnlockService = require('../services/reward-unlock-service.js');
const HintAccessService = require('../services/hint-access-service.js');
const LocaleService = require('../services/locale-service.js');
const defaultRewardConfig = require('../config/rewards.js');
const ProductPolicy = require('./product-policy.js');

const runtimeContractVersion = 3;
const APP_LOCAL_FORBIDDEN_DEPENDENCIES = Object.freeze([
  'syncStore',
  'progressSync',
  'economy',
  'authoritativeApplier',
  'auth',
  'behavior',
  'profile',
  'share',
  'rewards',
  'engagement',
  'ads',
  'cloudBackup',
  'dailyService',
  'dailyChallengeService',
  'dailyStore',
  'dailyProgressStore',
  'dailyManifest',
  'dailySolutions',
  'hintAccess'
]);
const APP_LOCAL_PREBUILT_SERVICES = Object.freeze([
  'locale',
  'progress',
  'stamina',
  'rewardUnlocks',
  'preferences'
]);

function plainObject(value) {
  if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function activeDependency(value) {
  return value !== undefined && value !== null && value !== false;
}

function authorityMatches(left, right) {
  let normalized;
  try { normalized = ProductPolicy.normalizeAuthority(left); } catch (error) { return false; }
  if (!normalized || !right || normalized.mode !== right.mode ||
      normalized.storageNamespaceId !== right.storageNamespaceId) return false;
  return ProductPolicy.AUTHORITY_DOMAIN_KEYS.every(key =>
    normalized.domains && right.domains && normalized.domains[key] === right.domains[key]);
}

function policyMatches(left, right) {
  return !!(left && right && JSON.stringify(left.config) === JSON.stringify(right.config));
}

function assertNoActiveAppLocalDependencies(options, includeLocalServices) {
  const opts = options || {};
  const keys = includeLocalServices
    ? APP_LOCAL_FORBIDDEN_DEPENDENCIES.concat(APP_LOCAL_PREBUILT_SERVICES)
    : APP_LOCAL_FORBIDDEN_DEPENDENCIES;
  const found = keys.find(key => activeDependency(opts[key]));
  if (found) throw new Error(`app-local-forbidden-dependency:${found}`);
}

function validateAppLocalHost(platform, authority) {
  if (!platform || typeof platform.storageNamespace !== 'function') {
    throw new Error('app-local-storage-namespace-required');
  }
  let namespace;
  try { namespace = platform.storageNamespace(); } catch (error) {
    throw new Error('app-local-storage-namespace-unavailable');
  }
  if (!plainObject(namespace) || namespace.id !== authority.storageNamespaceId ||
      namespace.isolated !== true || (namespace && typeof namespace.then === 'function')) {
    throw new Error('app-local-storage-namespace-mismatch');
  }
  return authority;
}

function validateAppLocalServices(options, authority, expectedRewardConfig) {
  const opts = options || {};
  if (opts.authority && !authorityMatches(opts.authority, authority)) {
    throw new Error('app-local-authority-mismatch');
  }
  if (!opts.locale || !opts.progress || !opts.stamina || !opts.rewardUnlocks || !opts.preferences) {
    throw new Error('app-local-services-required');
  }
  if (typeof opts.stamina.authorityMode !== 'function' || opts.stamina.authorityMode() !== 'app-local' ||
      typeof opts.rewardUnlocks.authorityMode !== 'function' || opts.rewardUnlocks.authorityMode() !== 'app-local') {
    throw new Error('app-local-service-authority-mismatch');
  }
  if (!RewardUnlockService.catalogMatchesConfig(opts.rewardUnlocks.catalog, expectedRewardConfig)) {
    throw new Error('app-local-reward-projection-missing');
  }
}

function createLocalServices(platform, options) {
  if (!platform) throw new Error('platform-required');
  const opts = options || {};
  const productPolicy = ProductPolicy.create(opts.productPolicy);
  const authority = productPolicy.authority();
  let resolvedRewardConfig = opts.rewardConfig || defaultRewardConfig;
  if (authority) {
    assertNoActiveAppLocalDependencies(opts, true);
    validateAppLocalHost(platform, authority);
    const canonicalRewardConfig = productPolicy.projectRewardConfig(defaultRewardConfig);
    resolvedRewardConfig = productPolicy.projectRewardConfig(resolvedRewardConfig);
    if (!RewardUnlockService.configsMatch(resolvedRewardConfig, canonicalRewardConfig)) {
      throw new Error('app-local-reward-config-mismatch');
    }
  }
  const contentAccess = (target, snapshot) => productPolicy.contentAccess(target, snapshot);
  const locale = opts.locale || new LocaleService(platform);
  const progress = opts.progress || new ProgressStore(platform);
  const subpackages = opts.subpackages !== undefined
    ? opts.subpackages
    : (opts.subpackageConfig ? new SubpackageService(platform, opts.subpackageConfig) : null);
  const staminaOptions = authority
    ? Object.assign({}, opts.staminaConfig || {}, { authorityMode: 'app-local' })
    : opts.staminaConfig;
  const stamina = opts.stamina || new StaminaService(platform, staminaOptions);
  const dailyStore = productPolicy.isEnabled('daily')
    ? (Object.prototype.hasOwnProperty.call(opts, 'dailyStore')
      ? (opts.dailyStore || null)
      : new DailyProgressStore(platform, {
        debugUnlimited: opts.dailyDebugUnlimited === true
      }))
    : null;
  const rewardUnlocks = opts.rewardUnlocks || new RewardUnlockService(platform, resolvedRewardConfig,
    authority ? { authorityMode: 'app-local' } : undefined);
  const hintNeedsDailyAccess = ['share', 'tiered'].includes(productPolicy.hintMode());
  const hintAccess = hintNeedsDailyAccess
    ? (Object.prototype.hasOwnProperty.call(opts, 'hintAccess')
      ? (opts.hintAccess || null)
      : new HintAccessService(platform, { timeZone: opts.dailyTimeZone }))
    : null;

  return {
    productPolicy,
    authority,
    contentAccess,
    fullGameStore: opts.fullGameStore || null,
    locale,
    subpackages,
    progress,
    stamina,
    dailyStore,
    rewardUnlocks,
    preferences: opts.preferences || new PreferencesService(progress),
    hintAccess
  };
}

function startGame(platform, options) {
  if (!platform) throw new Error('platform-required');
  const opts = options || {};
  const appOptions = opts.appOptions || {};
  const configuredRules = (appOptions.adConfig && appOptions.adConfig.rules) || {};
  const policyInput = Object.prototype.hasOwnProperty.call(opts, 'productPolicy')
    ? opts.productPolicy
    : appOptions.productPolicy;
  const productPolicy = ProductPolicy.create(policyInput, {
    hintMode: configuredRules.hintMode || 'tiered'
  });
  if (Object.prototype.hasOwnProperty.call(opts, 'productPolicy') && appOptions.productPolicy) {
    const appOptionsPolicy = ProductPolicy.create(appOptions.productPolicy, {
      hintMode: configuredRules.hintMode || 'tiered'
    });
    if (!policyMatches(productPolicy, appOptionsPolicy)) throw new Error('product-policy-mismatch');
  }
  const authority = productPolicy.authority();
  if (authority) {
    assertNoActiveAppLocalDependencies(appOptions, false);
    validateAppLocalHost(platform, authority);
    const expectedRewardConfig = productPolicy.projectRewardConfig(defaultRewardConfig);
    validateAppLocalServices(appOptions, authority, expectedRewardConfig);
  }
  const contentAccess = (target, snapshot) => productPolicy.contentAccess(target, snapshot);
  const fullGameStore = Object.prototype.hasOwnProperty.call(opts, 'fullGameStore')
    ? opts.fullGameStore : appOptions.fullGameStore;
  const resolvedAppOptions = Object.assign({}, appOptions, {
    productPolicy,
    contentAccess,
    fullGameStore: fullGameStore || null,
    authority: authority || null
  });
  const app = new ClearedApp(platform, resolvedAppOptions);
  const preferences = resolvedAppOptions.preferences;
  const authoritativeApplier = resolvedAppOptions.authoritativeApplier;
  const economy = resolvedAppOptions.economy;
  const progressSync = resolvedAppOptions.progressSync;
  const share = app.share;

  if (preferences && typeof preferences.bind === 'function') {
    preferences.bind({
      skins: app.skins,
      clearEffects: app.clearEffects,
      audio: app.audio,
      canUse: (kind, itemId) => app.rewardUnlocks.canUse(kind, itemId)
    });
  }
  if (authoritativeApplier) authoritativeApplier.accountGuard = app.accountGuard;
  if (economy) economy.accountGuard = app.accountGuard;
  if (progressSync) progressSync.prepareMigrationSnapshot = () => app.prepareLegacyMigration();

  app.start();
  if (share) {
    share.install(() => app.shareContext());
    const launchOptions = Object.prototype.hasOwnProperty.call(opts, 'launchOptions')
      ? opts.launchOptions
      : (typeof platform.getLaunchOptions === 'function' ? platform.getLaunchOptions() : {});
    share.captureEntry(launchOptions || {});
  }
  return app;
}

module.exports = Object.freeze({
  runtimeContractVersion,
  createLocalServices,
  startGame,
  validateAppLocalHost,
  assertNoActiveAppLocalDependencies
});
