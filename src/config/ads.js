// Keep ad unit IDs outside skins and game rules. Empty IDs make AdsService a
// no-op; production IDs can be added after the mini game has traffic access.
// Rewarded video is a global singleton by default, so multiple placement names
// should point at the same rewarded ad unit unless multiton support is added.
module.exports = {
  rewarded: {
    hint: ''
  },
  interstitial: {
    levelComplete: ''
  },
  rules: {
    interstitialEveryClears: 4,
    interstitialMinIntervalMs: 180000
  }
};
