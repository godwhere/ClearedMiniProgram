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

const runtimeContractVersion = 2;

function createLocalServices(platform, options) {
  if (!platform) throw new Error('platform-required');
  const opts = options || {};
  const productPolicy = ProductPolicy.create(opts.productPolicy);
  const contentAccess = typeof opts.contentAccess === 'function'
    ? opts.contentAccess
    : (target, snapshot) => productPolicy.contentAccess(target, snapshot);
  const locale = opts.locale || new LocaleService(platform);
  const progress = opts.progress || new ProgressStore(platform);
  const subpackages = opts.subpackages !== undefined
    ? opts.subpackages
    : (opts.subpackageConfig ? new SubpackageService(platform, opts.subpackageConfig) : null);
  const stamina = opts.stamina || new StaminaService(platform, opts.staminaConfig);
  const dailyStore = productPolicy.isEnabled('daily')
    ? (Object.prototype.hasOwnProperty.call(opts, 'dailyStore')
      ? (opts.dailyStore || null)
      : new DailyProgressStore(platform, {
        debugUnlimited: opts.dailyDebugUnlimited === true
      }))
    : null;
  const rewardUnlocks = opts.rewardUnlocks || new RewardUnlockService(
    platform,
    opts.rewardConfig || defaultRewardConfig
  );
  const hintNeedsDailyAccess = ['share', 'tiered'].includes(productPolicy.hintMode());
  const hintAccess = hintNeedsDailyAccess
    ? (Object.prototype.hasOwnProperty.call(opts, 'hintAccess')
      ? (opts.hintAccess || null)
      : new HintAccessService(platform, { timeZone: opts.dailyTimeZone }))
    : null;

  return {
    productPolicy,
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
  const contentAccess = typeof opts.contentAccess === 'function'
    ? opts.contentAccess
    : (typeof appOptions.contentAccess === 'function'
      ? appOptions.contentAccess
      : (target, snapshot) => productPolicy.contentAccess(target, snapshot));
  const fullGameStore = Object.prototype.hasOwnProperty.call(opts, 'fullGameStore')
    ? opts.fullGameStore : appOptions.fullGameStore;
  const resolvedAppOptions = Object.assign({}, appOptions, {
    productPolicy,
    contentAccess,
    fullGameStore: fullGameStore || null
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
  startGame
});
