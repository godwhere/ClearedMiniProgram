'use strict';

class EngagementService {
  constructor(options) {
    const opts = options || {};
    this.ads = opts.ads || null; this.share = opts.share || null;
    this.rewards = opts.rewards || null; this.behavior = opts.behavior || null;
    this.config = opts.config || {};
  }
  requestHint(context) {
    const mode = this.config.hintMode || 'free';
    if (mode === 'free') return Promise.resolve({ granted: true, mode: 'free' });
    if (!this.ads) return Promise.resolve({ granted: false, reason: 'not-configured' });
    return this.ads.showRewarded('hint').then(result => result.rewarded
      ? { granted: true, mode: 'rewarded', attemptId: result.attemptId }
      : { granted: false, mode: 'rewarded', reason: result.reason });
  }
  requestDailyExtraEntry() { return Promise.resolve({ ok: false, reason: 'not-configured' }); }
  shareResult(context) {
    if (!this.share) return Promise.resolve({ initiated: false, reason: 'not-configured' });
    return this.share.share(context).then(result => { if (result.initiated && this.behavior) this.behavior.track('share_initiated', context); return result; });
  }
  onOrdinaryCompleted(context) {
    if (!this.ads || typeof this.ads.onLevelCompleted !== 'function') return Promise.resolve(false);
    try { return Promise.resolve(this.ads.onLevelCompleted(context.totalClears)).catch(() => false); } catch (error) { return Promise.resolve(false); }
  }
}

module.exports = EngagementService;
