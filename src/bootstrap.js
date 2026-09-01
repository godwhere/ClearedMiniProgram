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

function start() {
  const platform = new WechatPlatform();
  const app = new ClearedApp(platform, {
    skins,
    effects,
    adConfig,
    progressionConfig,
    audioConfig,
    solutionCatalog,
    dailyManifest,
    dailySolutions,
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
