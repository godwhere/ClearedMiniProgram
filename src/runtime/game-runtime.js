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

const runtimeContractVersion = 1;

function createLocalServices(platform, options) {
  if (!platform) throw new Error('platform-required');
  const opts = options || {};
  const locale = opts.locale || new LocaleService(platform);
  const progress = opts.progress || new ProgressStore(platform);
  const subpackages = opts.subpackages !== undefined
    ? opts.subpackages
    : (opts.subpackageConfig ? new SubpackageService(platform, opts.subpackageConfig) : null);
  const stamina = opts.stamina || new StaminaService(platform, opts.staminaConfig);
  const dailyStore = opts.dailyStore || new DailyProgressStore(platform, {
    debugUnlimited: opts.dailyDebugUnlimited === true
  });
  const rewardUnlocks = opts.rewardUnlocks || new RewardUnlockService(
    platform,
    opts.rewardConfig || defaultRewardConfig
  );

  return {
    locale,
    subpackages,
    progress,
    stamina,
    dailyStore,
    rewardUnlocks,
    preferences: opts.preferences || new PreferencesService(progress),
    hintAccess: opts.hintAccess || new HintAccessService(platform, {
      timeZone: opts.dailyTimeZone
    })
  };
}

function startGame(platform, options) {
  if (!platform) throw new Error('platform-required');
  const opts = options || {};
  const appOptions = opts.appOptions || {};
  const app = new ClearedApp(platform, appOptions);
  const preferences = appOptions.preferences;
  const authoritativeApplier = appOptions.authoritativeApplier;
  const economy = appOptions.economy;
  const progressSync = appOptions.progressSync;
  const share = appOptions.share;

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
