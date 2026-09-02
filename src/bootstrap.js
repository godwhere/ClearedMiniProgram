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

function start() {
  const platform = new WechatPlatform();
  const subpackages = new SubpackageService(platform, subpackageConfig);
  const runtimeProgressionConfig = Object.assign({}, progressionConfig, {
    // Only the Developer Tools simulator receives the temporary all-levels
    // override. Real devices and uploaded builds keep the normal gate.
    unlockAllLevelsInDevTools: typeof platform.isDevTools === 'function' &&
      platform.isDevTools() === true
  });
  const app = new ClearedApp(platform, {
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
  return app;
}

module.exports = { start };
