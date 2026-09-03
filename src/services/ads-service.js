class AdsService {
  constructor(platform, config, options) {
    this.platform = platform;
    this.config = config || {};
    // Rewarded video is a global singleton by default in WeChat Mini Games.
    this.rewarded = null;
    this.lastInterstitialAt = 0;
    this.sequence = 0;
    this.nextAttemptId = options && options.nextAttemptId;
    this.disposed = false;
    this.interstitialPending = null;
  }

  isRewardedConfigured(placement) {
    return !!(this.config.rewarded && this.config.rewarded[placement]);
  }

  showRewarded(placement) {
    const attempt = { placement, attemptId: this.nextAttemptId ? this.nextAttemptId()
      : `adatt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${++this.sequence}`, startedAt: Date.now() };
    const denied = reason => Promise.resolve(this.rewardedResult(attempt, false, reason));
    const adUnitId = this.config.rewarded && this.config.rewarded[placement];
    if (!adUnitId) return denied('not-configured');
    if (this.disposed || !attempt.attemptId) return denied('not-supported');
    if (this.interstitialPending || (this.rewarded && this.rewarded.pending)) {
      return denied('busy');
    }
    if (this.rewarded && this.rewarded.adUnitId !== adUnitId) {
      return denied('unit-mismatch');
    }

    let entry;
    try { entry = this.getRewarded(adUnitId); } catch (error) { return denied('not-supported'); }
    if (!entry) return denied('not-supported');
    entry.attempt = attempt;

    entry.pending = new Promise(resolve => {
      entry.resolve = resolve;
      const current = () => entry.attempt === attempt && !!entry.resolve && !this.disposed;
      const show = retried => Promise.resolve().then(() => current() ? entry.ad.show() : undefined).catch(() => {
        if (!current()) return;
        if (retried) throw new Error('show-failed');
        return Promise.resolve(entry.ad.load()).then(() => show(true));
      });
      show(false).catch(error => { if (current()) this.finishRewarded(entry, false, 'show-failed', error); });
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
    entry.onError = error => this.finishRewarded(entry, false, 'error', error);
    ad.onClose(entry.onClose);
    ad.onError(entry.onError);
    this.rewarded = entry;
    return entry;
  }

  rewardedResult(attempt, rewarded, reason, error) {
    const code = error && error.errCode;
    const errCode = Number.isFinite(code) || (typeof code === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(code)) ? code : null;
    return Object.assign({}, attempt, { rewarded, reason, errCode, finishedAt: Date.now() });
  }

  finishRewarded(entry, rewarded, reason, error) {
    if (!entry || !entry.resolve) return;
    const resolve = entry.resolve;
    entry.resolve = null;
    entry.pending = null;
    resolve(this.rewardedResult(entry.attempt, rewarded, reason, error));
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
    if (this.disposed || this.interstitialPending || (this.rewarded && this.rewarded.pending)) return Promise.resolve(false);
    const adUnitId = this.config.interstitial && this.config.interstitial[placement];
    if (!adUnitId) return Promise.resolve(false);
    let ad;
    try { ad = this.platform.createInterstitialAd({ adUnitId }); } catch (error) { return Promise.resolve(false); }
    if (!ad) return Promise.resolve(false);

    const pending = new Promise(resolve => {
      let finished = false;
      const cleanup = shown => {
        if (finished) return;
        finished = true;
        try { if (ad.offClose) ad.offClose(onClose); } catch (error) {}
        try { if (ad.offError) ad.offError(onError); } catch (error) {}
        try { if (ad.destroy) ad.destroy(); } catch (error) {}
        resolve(shown);
      };
      const onClose = () => cleanup(true);
      const onError = () => cleanup(false);
      this.cancelInterstitial = onError;
      try { ad.onClose(onClose); ad.onError(onError); } catch (error) { onError(); return; }
      Promise.resolve().then(() => !finished ? ad.show() : undefined)
        .then(() => { this.lastInterstitialAt = Date.now(); })
        .catch(onError);
    });
    this.interstitialPending = pending.finally(() => { this.interstitialPending = null; this.cancelInterstitial = null; });
    return this.interstitialPending;
  }

  showPlacement() {
    return false;
  }

  hidePlacement() {}

  dispose() {
    this.disposed = true;
    if (this.cancelInterstitial) this.cancelInterstitial();
    const entry = this.rewarded;
    if (entry) {
      this.finishRewarded(entry, false, 'error');
      try { if (entry.ad.offClose) entry.ad.offClose(entry.onClose); } catch (error) {}
      try { if (entry.ad.offError) entry.ad.offError(entry.onError); } catch (error) {}
      try { if (entry.ad.destroy) entry.ad.destroy(); } catch (error) {}
    }
    this.rewarded = null;
  }
}

module.exports = AdsService;
