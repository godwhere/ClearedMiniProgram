class AdsService {
  constructor(platform, config) {
    this.platform = platform;
    this.config = config || {};
    // Rewarded video is a global singleton by default in WeChat Mini Games.
    this.rewarded = null;
    this.lastInterstitialAt = 0;
  }

  isRewardedConfigured(placement) {
    return !!(this.config.rewarded && this.config.rewarded[placement]);
  }

  showRewarded(placement) {
    const adUnitId = this.config.rewarded && this.config.rewarded[placement];
    if (!adUnitId) return Promise.resolve({ rewarded: false, reason: 'not-configured' });
    if (this.rewarded && this.rewarded.pending) {
      return Promise.resolve({ rewarded: false, reason: 'busy' });
    }
    if (this.rewarded && this.rewarded.adUnitId !== adUnitId) {
      return Promise.resolve({ rewarded: false, reason: 'unit-mismatch' });
    }

    const entry = this.getRewarded(adUnitId);
    if (!entry) return Promise.resolve({ rewarded: false, reason: 'not-supported' });

    entry.pending = new Promise(resolve => {
      entry.resolve = resolve;
      const show = retried => Promise.resolve().then(() => entry.ad.show()).catch(() => {
        if (retried) throw new Error('show-failed');
        return entry.ad.load().then(() => show(true));
      });
      show(false).catch(() => this.finishRewarded(entry, false, 'show-failed'));
    });
    return entry.pending;
  }

  getRewarded(adUnitId) {
    if (this.rewarded) return this.rewarded;
    const ad = this.platform.createRewardedVideoAd({
      adUnitId,
      disableFallbackSharePage: true
    });
    if (!ad) return null;

    const entry = { ad, adUnitId, pending: null, resolve: null };
    entry.onClose = result => {
      const completed = !!(result && result.isEnded === true);
      this.finishRewarded(entry, completed, completed ? 'completed' : 'closed');
    };
    entry.onError = () => this.finishRewarded(entry, false, 'error');
    ad.onClose(entry.onClose);
    ad.onError(entry.onError);
    this.rewarded = entry;
    return entry;
  }

  finishRewarded(entry, rewarded, reason) {
    if (!entry || !entry.resolve) return;
    const resolve = entry.resolve;
    entry.resolve = null;
    entry.pending = null;
    resolve({ rewarded, reason });
  }

  onLevelCompleted(totalClears) {
    const rules = this.config.rules || {};
    const every = Number(rules.interstitialEveryClears) || 0;
    const now = Date.now();
    if (!every || totalClears % every !== 0) return Promise.resolve(false);
    if (now - this.lastInterstitialAt < (Number(rules.interstitialMinIntervalMs) || 0)) {
      return Promise.resolve(false);
    }
    return this.showInterstitial('levelComplete');
  }

  showInterstitial(placement) {
    const adUnitId = this.config.interstitial && this.config.interstitial[placement];
    if (!adUnitId) return Promise.resolve(false);
    const ad = this.platform.createInterstitialAd({ adUnitId });
    if (!ad) return Promise.resolve(false);

    return new Promise(resolve => {
      let finished = false;
      const cleanup = shown => {
        if (finished) return;
        finished = true;
        if (ad.offClose) ad.offClose(onClose);
        if (ad.offError) ad.offError(onError);
        if (ad.destroy) ad.destroy();
        resolve(shown);
      };
      const onClose = () => cleanup(true);
      const onError = () => cleanup(false);
      ad.onClose(onClose);
      ad.onError(onError);
      Promise.resolve().then(() => ad.show())
        .then(() => { this.lastInterstitialAt = Date.now(); })
        .catch(onError);
    });
  }

  showPlacement() {
    return false;
  }

  hidePlacement() {}

  dispose() {
    const entry = this.rewarded;
    if (entry) {
      if (entry.ad.offClose) entry.ad.offClose(entry.onClose);
      if (entry.ad.offError) entry.ad.offError(entry.onError);
      if (entry.ad.destroy) entry.ad.destroy();
    }
    this.rewarded = null;
  }
}

module.exports = AdsService;
