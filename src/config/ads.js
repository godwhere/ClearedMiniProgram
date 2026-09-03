// Keep ad unit IDs outside skins and game rules. Empty IDs make AdsService a
// no-op; production IDs can be added after the mini game has traffic access.
// Rewarded video is a global singleton by default, so multiple placement names
// should point at the same rewarded ad unit unless multiton support is added.
module.exports = {
  rewarded: {
    hint: '',
    dailyExtraEntry: '',
    rewardUnlock: ''
  },
  interstitial: {
    levelComplete: ''
  },
  rules: {
    interstitialEveryClears: 4,
    interstitialMinIntervalMs: 180000,
    hintMode: 'tiered',
    // Enable only after platform approval, a real hint ad unit and device QA.
    // Until then, the third and later new daily hint unlocks use sharing.
    hintRewardedEnabled: false,
    rewardUnlockRewardedEnabled: false,
    dailyExtraEntryEnabled: false,
    dailyExtraEntryLimit: 1
  }
};
