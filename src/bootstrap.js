const WechatPlatform = require('./platform/wechat.js');
const gameRuntime = require('./runtime/game-runtime.js');
const skins = require('./skins/index.js');
const effects = require('./effects/index.js');
const adConfig = require('./config/ads.js');
const progressionConfig = require('./config/progression.js');
const audioConfig = require('./config/audio.js');
const solutionCatalog = require('../data/solutions.js');
const dailyManifest = require('../data/daily-challenges.js');
const dailySolutions = require('../data/daily-solutions.js');
const dailyConfig = require('./config/daily.js');
const mechanics = require('./mechanics/index.js');
const subpackageConfig = require('./config/subpackages.js');
const staminaConfig = require('./config/stamina.js');
const SessionStore = require('./services/session-store.js');
const SyncStore = require('./services/sync-store.js');
const ApiClient = require('./services/api-client.js');
const AuthService = require('./services/auth-service.js');
const ProgressSyncService = require('./services/progress-sync-service.js');
const AuthoritativeStateApplier = require('./services/authoritative-state-applier.js');
const EconomyService = require('./services/economy-service.js');
const BehaviorService = require('./services/behavior-service.js');
const EngagementService = require('./services/engagement-service.js');
const AdsService = require('./services/ads-service.js');
const backendConfig = require('./config/backend.js');
const cloudbaseConfig = require('./config/cloudbase.js');
const cloudbaseInternalConfig = require('./config/cloudbase.internal.js');
const cloudbaseReleaseConfig = require('./config/cloudbase.release.js');
const CloudFunctionTransport = require('./services/cloud-function-transport.js');
const engagementConfig = require('./config/engagement.js');
const ProfileService = require('./services/profile-service.js');
const ShareService = require('./services/share-service.js');
const RewardService = require('./services/reward-service.js');
const rewardConfig = require('./config/rewards.js');

function cloudConfigForEnvironment(environmentVersion, loadLocalConfig) {
  if (environmentVersion === 'release') {
    // A formal package uses only the checked-in production lane, never the
    // ignored developer override or the preview runtime boundary.
    return Object.assign({}, cloudbaseConfig, cloudbaseReleaseConfig, { localBackupEnabled: false });
  }
  if (environmentVersion === 'trial') {
    // Uploaded previews cannot contain the ignored developer override. The
    // checked-in internal lane stays trial-only; server admission is separate.
    return Object.assign({}, cloudbaseConfig, cloudbaseInternalConfig, { localBackupEnabled: false });
  }
  if (environmentVersion === 'develop') {
    try {
      // Keep a literal path so DevTools' unused-file filter includes it.
      // Missing/invalid local overrides are caught below.
      const local = loadLocalConfig ? loadLocalConfig() : require('./config/cloudbase.local.js');
      return Object.assign({}, cloudbaseConfig, local, { localBackupEnabled: false });
    } catch (error) {
      // A QR preview may report develop even though ignored local files were
      // removed during upload. In that case use the same server-allowlisted
      // internal lane as trial; release can never reach this branch.
      return Object.assign({}, cloudbaseConfig, cloudbaseInternalConfig, { localBackupEnabled: false });
    }
  }
  return Object.assign({}, cloudbaseConfig, { localBackupEnabled: false });
}

function start(options) {
  const loadLocalCloudConfig = options && typeof options.loadLocalCloudConfig === 'function'
    ? options.loadLocalCloudConfig : null;
  const platform = new WechatPlatform();
  const environmentVersion = platform.getMiniProgramEnvironmentVersion();
  const isDeveloperRuntime = ['develop', 'trial'].includes(environmentVersion);
  const cloudConfig = cloudConfigForEnvironment(environmentVersion, loadLocalCloudConfig);
  const local = gameRuntime.createLocalServices(platform, {
    subpackageConfig,
    staminaConfig,
    dailyDebugUnlimited: dailyConfig.debugUnlimitedEntries === true,
    dailyTimeZone: dailyConfig.timeZone,
    rewardConfig
  });
  const { locale, subpackages, progress, stamina, dailyStore, rewardUnlocks, preferences, hintAccess } = local;
  const sessions = new SessionStore(platform);
  const syncStore = new SyncStore(platform);
  const transport = cloudConfig.enabled === true ? new CloudFunctionTransport(platform, cloudConfig) : null;
  const api = new ApiClient(platform, sessions, backendConfig, { transport });
  const auth = new AuthService(platform, api, sessions, syncStore,
    transport ? { mode: 'cloud', enabled: cloudConfig.identityEnabled === true, clientVersion: backendConfig.clientVersion }
      : Object.assign({}, engagementConfig.auth, { mode: 'legacy-http' }));
  const behavior = new BehaviorService(platform, api, syncStore, engagementConfig.behavior);
  const profile = new ProfileService(platform, api, auth, engagementConfig.profile, behavior, locale);
  const authoritativeApplier = new AuthoritativeStateApplier({ progress, daily: dailyStore,
    rewards: rewardUnlocks, stamina, preferences, syncStore, sessions }, null);
  const economy = new EconomyService(platform, api, auth, syncStore, rewardUnlocks, authoritativeApplier);
  const progressSync = new ProgressSyncService(api, progress, syncStore, auth,
    Object.assign({}, engagementConfig.progressSync, { localBackupEnabled: false }), behavior,
    { daily: dailyStore, rewards: rewardUnlocks, stamina, preferences, sessions, economy,
      applier: authoritativeApplier });
  const ads = new AdsService(platform, adConfig, { nextAttemptId: () => syncStore.nextId('adatt_') });
  const rewards = new RewardService(platform, api, auth, syncStore,
    { enabled: engagementConfig.rewards.dailyExtraEntryEnabled === true || engagementConfig.share.rewardsEnabled === true }, behavior);
  const share = new ShareService(platform, api, auth, syncStore, engagementConfig.share, behavior, locale);
  const engagement = new EngagementService({ ads, share, rewards, rewardUnlocks, auth, behavior, hintAccess, config: Object.assign({}, adConfig.rules,
    { dailyExtraEntryEnabled: adConfig.rules.dailyExtraEntryEnabled === true && engagementConfig.rewards.dailyExtraEntryEnabled === true }),
    shareEntitlement: rewardId => syncStore.authorityMode('entitlements') === 'cloud-authoritative'
      ? progressSync.grantShareEntitlement(rewardId)
      : rewardUnlocks.recordShareInitiated({ rewardId, initiated: true }) });
  auth.onSessionChanged((session, state) => {
    if (auth.mode === 'cloud') return; // No HTTP behavior/profile/share rollout in phase 3.
    if (session) behavior.identify(session.userId);
    else behavior.clearUser();
    const event = { authenticating: 'auth_started', authenticated: 'auth_succeeded', offline: 'auth_failed', error: 'auth_failed' }[state];
    if (event) behavior.track(event, { reason: state });
  });
  const runtimeProgressionConfig = Object.assign({}, progressionConfig, {
    // Only the Developer Tools simulator receives the temporary all-levels
    // override. Real devices and uploaded builds keep the normal gate.
    unlockAllLevelsInDevTools: typeof platform.isDevTools === 'function' &&
      platform.isDevTools() === true
  });
  const app = gameRuntime.startGame(platform, { appOptions: {
    stamina, preferences, rewardUnlocks, syncStore, economy, authoritativeApplier,
    progress, dailyStore, auth, progressSync, behavior, ads, engagement, profile, share, rewards, hintAccess, locale,
    subpackages,
    skins,
    effects,
    adConfig,
    progressionConfig: runtimeProgressionConfig,
    audioConfig,
    solutionCatalog,
    dailyManifest,
    dailySolutions,
    portalMechanic: mechanics.get('portal'),
    // The homepage rollout is now approved: the existing theme button slot
    // opens the corridor. `home:themes` remains a compatibility action.
    homeMigration: true,
    dailyEntryLimit: dailyConfig.entryLimit,
    dailyTimeZone: dailyConfig.timeZone,
    dailyDebugUnlimited: dailyConfig.debugUnlimitedEntries === true,
    dailyTestDateKey: isDeveloperRuntime && typeof cloudConfig.dailyTestDateKey === 'string'
      ? cloudConfig.dailyTestDateKey : ''
  } });
  // Local boot is synchronous. Online work is always scheduled afterwards.
  behavior.track('app_launch', { scene: 'home' });
  Promise.resolve().then(() => app.resumeOnline('launch')).then(() => behavior.flush('launch')).catch(function () {});
  return app;
}

module.exports = { cloudConfigForEnvironment, start };
