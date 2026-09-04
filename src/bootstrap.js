const WechatPlatform = require('./platform/wechat.js');
const ClearedApp = require('./app.js');
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
const SubpackageService = require('./services/subpackage-service.js');
const subpackageConfig = require('./config/subpackages.js');
const ProgressStore = require('./services/progress-store.js');
const StaminaService = require('./services/stamina-service.js');
const staminaConfig = require('./config/stamina.js');
const DailyProgressStore = require('./services/daily-progress-store.js');
const SessionStore = require('./services/session-store.js');
const SyncStore = require('./services/sync-store.js');
const ApiClient = require('./services/api-client.js');
const AuthService = require('./services/auth-service.js');
const ProgressSyncService = require('./services/progress-sync-service.js');
const BehaviorService = require('./services/behavior-service.js');
const EngagementService = require('./services/engagement-service.js');
const AdsService = require('./services/ads-service.js');
const backendConfig = require('./config/backend.js');
const cloudbaseConfig = require('./config/cloudbase.js');
const CloudFunctionTransport = require('./services/cloud-function-transport.js');
const engagementConfig = require('./config/engagement.js');
const ProfileService = require('./services/profile-service.js');
const ShareService = require('./services/share-service.js');
const RewardService = require('./services/reward-service.js');
const HintAccessService = require('./services/hint-access-service.js');
const RewardUnlockService = require('./services/reward-unlock-service.js');
const rewardConfig = require('./config/rewards.js');

function start() {
  const platform = new WechatPlatform();
  const subpackages = new SubpackageService(platform, subpackageConfig);
  const progress = new ProgressStore(platform);
  const stamina = new StaminaService(platform, staminaConfig);
  const dailyStore = new DailyProgressStore(platform, { debugUnlimited: dailyConfig.debugUnlimitedEntries === true });
  const rewardUnlocks = new RewardUnlockService(platform, rewardConfig);
  const sessions = new SessionStore(platform);
  const syncStore = new SyncStore(platform);
  const transport = cloudbaseConfig.enabled === true ? new CloudFunctionTransport(platform, cloudbaseConfig) : null;
  const api = new ApiClient(platform, sessions, backendConfig, { transport });
  const auth = new AuthService(platform, api, sessions, syncStore,
    Object.assign({}, engagementConfig.auth, { mode: transport ? 'cloud' : 'legacy-http' }));
  const behavior = new BehaviorService(platform, api, syncStore, engagementConfig.behavior);
  const profile = new ProfileService(platform, api, auth, engagementConfig.profile, behavior);
  const progressSync = new ProgressSyncService(api, progress, syncStore, auth, engagementConfig.progressSync, behavior);
  const ads = new AdsService(platform, adConfig, { nextAttemptId: () => syncStore.nextId('adatt_') });
  const rewards = new RewardService(platform, api, auth, syncStore,
    { enabled: engagementConfig.rewards.dailyExtraEntryEnabled === true || engagementConfig.share.rewardsEnabled === true }, behavior);
  const share = new ShareService(platform, api, auth, syncStore, engagementConfig.share, behavior);
  const hintAccess = new HintAccessService(platform, { timeZone: dailyConfig.timeZone });
  const engagement = new EngagementService({ ads, share, rewards, rewardUnlocks, auth, behavior, hintAccess, config: Object.assign({}, adConfig.rules,
    { dailyExtraEntryEnabled: adConfig.rules.dailyExtraEntryEnabled === true && engagementConfig.rewards.dailyExtraEntryEnabled === true }) });
  auth.onSessionChanged((session, state) => {
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
  const app = new ClearedApp(platform, {
    stamina, rewardUnlocks,
    progress, dailyStore, auth, progressSync, behavior, ads, engagement, profile, share, rewards, hintAccess,
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
    // Development builds intentionally bypass the daily entry budget so the
    // two challenge levels can be exercised repeatedly. Set to false for a
    // production package.
    dailyTimeZone: dailyConfig.timeZone,
    dailyDebugUnlimited: dailyConfig.debugUnlimitedEntries === true
  });
  app.start();
  share.install(() => app.shareContext());
  share.captureEntry(platform.getLaunchOptions());
  // Local boot is synchronous. Online work is always scheduled afterwards.
  behavior.track('app_launch', { scene: 'home' });
  Promise.resolve().then(() => app.resumeOnline()).then(() => behavior.flush('launch')).catch(function () {});
  return app;
}

module.exports = { start };
