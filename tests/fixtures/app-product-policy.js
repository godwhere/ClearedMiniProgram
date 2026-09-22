'use strict';

const domains = Object.freeze({
  progress: 'app-local',
  daily: 'disabled',
  economy: 'app-local',
  entitlements: 'app-local',
  stamina: 'app-local',
  preferences: 'app-local'
});

const authority = Object.freeze({
  mode: 'app-local',
  storageNamespaceId: 'cleared-app-test-v1',
  domains
});

const rewardUnlockOverride = Object.freeze({
  sourceTypes: Object.freeze(['rewarded_ad', 'share']),
  replacement: Object.freeze({ type: 'currency', cost: 10000 }),
  expectedMatches: 5
});

module.exports = Object.freeze({
  dailyEnabled: false,
  adsEnabled: false,
  rewardedShareEnabled: false,
  resultShareEnabled: false,
  hintMode: 'free',
  freeLevelKeys: Object.freeze(['0:0', '0:1', '1:0', '1:1', '1:2', '1:3']),
  fullGameEntitlementId: 'full_game_v1',
  iceTrialRequiresFullGame: true,
  authority,
  rewardUnlockOverride
});
