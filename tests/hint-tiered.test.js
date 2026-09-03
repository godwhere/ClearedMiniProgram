'use strict';

const assert = require('assert');
const App = require('../src/app.js');
const Platform = require('../src/platform/wechat.js');
const HintAccess = require('../src/services/hint-access-service.js');
const Engagement = require('../src/services/engagement-service.js');
const Share = require('../src/services/share-service.js');
const Ads = require('../src/services/ads-service.js');
const catalog = require('../data/catalog-v2.js');
const solutions = require('../data/solutions.js');
const { fakeApi } = require('./account-bootstrap.test.js');
const { finishDailyLevel } = require('./hint-share.test.js');
const settle = () => new Promise(resolve => setImmediate(resolve));
const clone = value => JSON.parse(JSON.stringify(value));
const levels = catalog.levels.slice(0, 4);

function fixture(options) {
  const opts = options || {};
  const storage = opts.storage || {};
  const counts = { shares: 0, created: 0, shown: 0, loaded: 0, attempts: 0 };
  let now = new Date('2026-08-31T00:00:00Z'); let failStorage = false;
  const raw = fakeApi();
  raw.getStorageSync = key => storage[key];
  raw.setStorageSync = (key, value) => {
    if (failStorage && key === HintAccess.STORAGE_KEY) throw new Error('disk unavailable');
    storage[key] = clone(value);
  };
  raw.shareAppMessage = payload => {
    counts.shares++;
    assert.deepStrictEqual(Object.keys(payload).sort(), ['query', 'title']);
    assert.strictEqual(payload.query, 'sv=1&scene=home');
  };
  const video = { onClose(fn) { this.close = fn; }, onError(fn) { this.error = fn; },
    offClose() {}, offError() {}, destroy() {},
    show() { counts.shown++; return Promise.resolve(); }, load() { counts.loaded++; return Promise.resolve(); } };
  const interstitial = { onClose(fn) { this.close = fn; }, onError() {}, offClose() {}, offError() {}, destroy() {}, show: async () => {} };
  if (opts.supported !== false) raw.createRewardedVideoAd = () => { counts.created++; return video; };
  raw.createInterstitialAd = () => interstitial;
  const platform = new Platform(raw);
  const config = { rewarded: { hint: opts.unit === undefined ? 'test-hint-unit' : opts.unit, dailyExtraEntry: 'test-daily-unit' },
    interstitial: { levelComplete: 'test-interstitial' }, rules: { hintMode: opts.mode || 'tiered', hintRewardedEnabled: opts.enabled === true } };
  const access = new HintAccess(platform, { clock: () => now });
  const ads = new Ads(platform, config, { nextAttemptId: () => `adatt_hint_${++counts.attempts}` });
  const forbidden = () => { throw new Error('local hint access cannot depend on a backend or reward ledger'); };
  const share = new Share(platform, { isConfigured: () => false, request: forbidden }, { current: () => null }, {}, {});
  const engagement = new Engagement({ ads, share, hintAccess: access, config: config.rules, rewards: { claim: forbidden },
    behavior: opts.behavior });
  const app = new App(platform, { ads, share, hintAccess: access, engagement, clock: () => now, solutionCatalog: solutions,
    progressionConfig: { unlockAllLevelsInDevTools: true } });
  const context = index => ({ scene: 'play', dateKey: access.dateKey(), levelKey: HintAccess.levelKey({ source: 'catalog',
    setIndex: levels[index].setIndex, levelIndex: levels[index].levelIndex }) });
  return { app, access, ads, video, interstitial, share, engagement, config, counts, storage, context,
    open(index) { assert(app.openLevel(levels[index].setIndex, levels[index].levelIndex)); },
    tap() { app.performAction(app.scene === 'daily' ? 'daily:hint' : 'play:hint'); },
    count: () => access.status(context(0)).unlockCount,
    seed(n) { for (let i = 0; i < n; i++) assert(access.unlock(context(i)).ok); },
    failStorage(value) { failStorage = value; }, setNow(value) { now = new Date(value); } };
}

async function tierSequence() {
  for (const enabled of [false, true]) {
    const f = fixture({ enabled }); f.open(0);
    const before = clone(f.app.progress.state);
    assert.strictEqual(f.app.buildModel().hintLabel, '免费提示');
    f.tap(); assert(f.app.hintPreview, 'the first new hint is saved and shown on its first tap');
    assert.strictEqual(f.count(), 1); assert.deepStrictEqual(f.counts, { shares: 0, created: 0, shown: 0, loaded: 0, attempts: 0 });
    assert.deepStrictEqual(f.app.progress.state, before);
    for (let i = 0; i < 3; i++) { f.tap(); assert.strictEqual(f.app.hintPreview, null); f.tap(); assert(f.app.hintPreview); }
    assert.strictEqual(f.count(), 1);
    f.app.clearHintPreview(); f.app.performAction('play:reset'); f.tap(); assert(f.app.hintPreview);

    f.open(1); assert.strictEqual(f.app.buildModel().hintLabel, '分享解锁');
    f.tap(); assert.strictEqual(f.counts.shares, 1, 'share invocation stays inside the touch/action turn');
    assert.strictEqual(f.app.hintPreview, null); assert.strictEqual(f.app.buildModel().hintAvailable, false);
    await settle(); assert.strictEqual(f.count(), 2); assert.strictEqual(f.app.hintPreview, null);
    f.tap(); assert(f.app.hintPreview);

    f.open(2); const state = f.engagement.hintState(f.app.hintContext());
    assert.strictEqual(state.requiredAction, 'rewarded');
    assert.strictEqual(state.action, enabled ? 'rewarded' : 'share');
    f.tap(); await settle();
    if (enabled) {
      assert.strictEqual(f.count(), 2, 'show success alone cannot grant a hint');
      assert.strictEqual(f.counts.shown, 1);
      f.video.close({ isEnded: true }); f.video.close({ isEnded: true }); await settle();
    }
    assert.strictEqual(f.count(), 3); assert.strictEqual(f.app.hintPreview, null);
    f.tap(); assert(f.app.hintPreview);
    assert.strictEqual(f.counts.shares, enabled ? 1 : 2);
    assert.strictEqual(f.counts.attempts, enabled ? 1 : 0);
    assert.strictEqual(f.counts.created, enabled ? 1 : 0);
    f.app.dispose();
    const restarted = fixture({ enabled, storage: f.storage }); restarted.open(2); restarted.tap();
    assert(restarted.app.hintPreview); assert.strictEqual(restarted.count(), 3);
    assert.strictEqual(restarted.counts.shares + restarted.counts.attempts, 0);
    restarted.app.dispose();
  }
}

async function capabilityAndFailureMatrix() {
  const available = fixture({ enabled: true }); available.seed(2); available.open(2);
  for (let i = 0; i < 3; i++) {
    assert.strictEqual(available.app.buildModel().hintLabel, '广告解锁');
    available.app.renderer.render(available.app.buildModel(), Date.now());
  }
  assert.deepStrictEqual(available.counts, { shares: 0, created: 0, shown: 0, loaded: 0, attempts: 0 });
  available.app.dispose();
  for (const options of [{ enabled: false }, { enabled: true, unit: '' }, { enabled: true, unit: ' unit ' },
    { enabled: true, unit: 10 }, { enabled: true, supported: false }]) {
    const f = fixture(options); f.seed(2); f.open(2);
    const before = clone(f.counts);
    for (let i = 0; i < 3; i++) { assert.strictEqual(f.app.buildModel().hintLabel, '分享解锁'); f.app.renderer.render(f.app.buildModel(), Date.now()); }
    assert.deepStrictEqual(f.counts, before, 'capability queries/rendering cannot allocate ad IDs or show a channel');
    f.tap(); assert.strictEqual(f.counts.shares, 1); await settle();
    assert.strictEqual(f.count(), 3); assert.strictEqual(f.counts.created + f.counts.attempts, 0);
    f.app.dispose();
  }
  for (const failure of ['closed', 'missing', 'inventory', 'load', 'invalid-response']) {
    const f = fixture({ enabled: true }); f.seed(2); f.open(2);
    if (failure === 'load') {
      f.video.show = () => { f.counts.shown++; return Promise.reject(new Error('show failed')); };
      f.video.load = () => Promise.reject(new Error('load failed'));
    }
    if (failure === 'invalid-response') f.ads.showRewarded = async () => ({ rewarded: true, reason: 'completed' });
    f.tap(); await settle();
    if (failure === 'closed') f.video.close({ isEnded: false });
    if (failure === 'missing') f.video.close();
    if (failure === 'inventory') f.video.error({ errCode: 1004 });
    await settle();
    assert.strictEqual(f.count(), 2, failure); assert.strictEqual(f.counts.shares, 0, 'ad failures never auto-share');
    assert.strictEqual(f.access.status(f.app.hintContext()).pendingSaveContext, null);
    assert.strictEqual(f.engagement.hintState(f.app.hintContext()).action, 'rewarded');
    assert.strictEqual(f.app.hintPreview, null); f.app.dispose();
  }
  const busy = fixture({ enabled: true }); busy.seed(2); busy.open(2);
  const otherAd = busy.ads.showInterstitial('levelComplete'); await settle();
  busy.tap(); await settle(); assert.strictEqual(busy.count(), 2); assert.strictEqual(busy.counts.shares + busy.counts.created, 0);
  busy.interstitial.close(); await otherAd; busy.app.dispose();

  const mismatch = fixture({ enabled: true }); mismatch.seed(2);
  const priorAd = mismatch.ads.showRewarded('dailyExtraEntry'); await settle(); mismatch.video.close({ isEnded: true }); await priorAd;
  mismatch.open(2); mismatch.tap(); await settle();
  assert.strictEqual(mismatch.count(), 2); assert.strictEqual(mismatch.counts.shown, 1); assert.strictEqual(mismatch.counts.shares, 0);
  mismatch.app.dispose();
}

async function saveRecovery() {
  const free = fixture(); free.open(0); free.failStorage(true); free.tap();
  assert.strictEqual(free.count(), 0); assert.strictEqual(free.app.hintPreview, null);
  const original = free.context(0);
  const copyOfPending = free.access.status(original).pendingSaveContext;
  copyOfPending.levelKey = free.context(1).levelKey;
  assert.strictEqual(free.access.status(original).pendingSaveContext.levelKey, original.levelKey);
  free.open(1); const resolve = free.app.hints.findComplete;
  free.app.hints.findComplete = () => { throw new Error('retrying A cannot require a solution for B'); };
  assert.strictEqual(free.app.buildModel().hintLabel, '重试保存');
  free.tap(); assert.strictEqual(free.count(), 0);
  free.failStorage(false); free.tap();
  assert.strictEqual(free.count(), 1); assert(free.access.status(original).unlocked);
  assert(!free.access.status(free.context(1)).unlocked); assert.strictEqual(free.app.hintPreview, null);
  assert.strictEqual(free.counts.shares + free.counts.attempts, 0);
  free.app.hints.findComplete = resolve;
  assert.strictEqual(free.app.buildModel().hintLabel, '分享解锁'); free.tap(); await settle(); assert.strictEqual(free.count(), 2);
  free.app.dispose();

  const ad = fixture({ enabled: true }); ad.seed(2); ad.open(2); ad.tap(); await settle();
  ad.failStorage(true); ad.video.close({ isEnded: true }); await settle();
  assert.strictEqual(ad.count(), 2); assert.strictEqual(ad.app.buildModel().hintLabel, '重试保存');
  ad.open(3); ad.failStorage(false); ad.tap();
  assert.strictEqual(ad.count(), 3); assert(ad.access.status(ad.context(2)).unlocked);
  assert(!ad.access.status(ad.context(3)).unlocked); assert.strictEqual(ad.app.hintPreview, null);
  assert.strictEqual(ad.counts.shown, 1); assert.strictEqual(ad.counts.shares, 0); ad.app.dispose();

  const old = fixture({ mode: 'share' }); old.failStorage(true);
  old.open(0); old.tap(); await settle(); old.open(1); old.tap(); await settle();
  old.config.rules.hintMode = 'tiered'; old.open(2); old.failStorage(false);
  old.tap(); assert(old.access.status(old.context(0)).unlocked); assert.strictEqual(old.count(), 1);
  old.tap(); assert(old.access.status(old.context(1)).unlocked); assert.strictEqual(old.count(), 2);
  assert(!old.access.status(old.context(2)).unlocked); assert.strictEqual(old.counts.shares, 2); old.app.dispose();
}

async function lifecycleAndSharedScope() {
  for (const change of ['level', 'reset', 'date', 'dispose']) {
    const f = fixture({ enabled: true }); f.seed(2); f.open(2); const original = f.app.hintContext();
    f.tap(); await settle(); assert.strictEqual(f.app.requestHint(), false);
    if (change === 'level') {
      f.open(3); assert.strictEqual(f.app.buildModel().hintAvailable, false);
      assert.strictEqual(f.app.requestHint(), false); f.app.dirty = false;
    } else if (change === 'reset') f.app.resetCurrentLevel();
    else if (change === 'date') f.setNow('2026-08-31T16:00:00Z');
    else f.app.dispose();
    f.video.close({ isEnded: true }); await settle();
    assert.strictEqual(f.app.hintPreview, null, change);
    if (change === 'date') {
      assert.strictEqual(f.count(), 0); assert.strictEqual(f.app.buildModel().hintLabel, '免费提示');
      f.tap(); assert(f.app.hintPreview); assert.strictEqual(f.count(), 1);
    } else if (change === 'dispose') assert.strictEqual(f.count(), 2);
    else { assert(f.access.status(original).unlocked); assert.strictEqual(f.count(), 3); }
    if (change === 'level') {
      assert(!f.access.status(f.context(3)).unlocked); assert.strictEqual(f.app.dirty, true);
      assert.strictEqual(f.app.buildModel().hintAvailable, true);
    }
    if (change !== 'dispose') f.app.dispose();
  }
  const day = fixture(); day.open(0); day.tap(); const preview = day.app.hintPreview;
  day.setNow('2026-08-31T16:00:00Z'); day.app.buildModel();
  assert.strictEqual(day.app.hintPreview, preview, 'an existing preview may finish normally at midnight');
  day.tap(); assert.strictEqual(day.app.hintPreview, null); assert.strictEqual(day.count(), 0);
  day.tap(); assert(day.app.hintPreview); assert.strictEqual(day.count(), 1); day.app.dispose();

  const shared = fixture(); shared.open(0); shared.tap();
  const portal = catalog.levels.find(item => item.game.Mechanic === 'portal');
  shared.app.openLevel(portal.setIndex, portal.levelIndex); shared.tap(); await settle();
  shared.tap(); assert(shared.app.hintPreview && shared.app.hintPreview.viewModel.mechanic.portal);
  shared.app.clearHintPreview(); shared.app.performAction('play:back'); shared.app.performAction('levels:home');
  shared.app.performAction('home:dailyChallenge');
  const before = clone(shared.app.dailyProgress.state);
  assert.strictEqual(shared.app.buildModel().hintLabel, '分享解锁'); shared.tap(); await settle();
  assert.strictEqual(shared.count(), 3); assert.deepStrictEqual(shared.app.dailyProgress.state, before);
  const firstDaily = shared.app.hintContext().levelKey;
  finishDailyLevel(shared.app);
  assert.notStrictEqual(shared.app.hintContext().levelKey, firstDaily);
  const secondBefore = clone(shared.app.dailyProgress.state);
  shared.tap(); await settle();
  assert.strictEqual(shared.count(), 4); assert.strictEqual(shared.counts.shares, 3);
  assert.deepStrictEqual(shared.app.dailyProgress.state, secondBefore);
  shared.app.dispose();
}

async function validationAndSwitches() {
  const noSolution = fixture(); noSolution.open(0); noSolution.app.hints.findComplete = () => null;
  assert.strictEqual(noSolution.app.requestHint(), false); assert.strictEqual(noSolution.count(), 0);
  assert.strictEqual(noSolution.counts.shares + noSolution.counts.attempts, 0); noSolution.app.dispose();
  const gesture = fixture(); gesture.open(0); gesture.app.boardInput.isActive = () => true;
  assert.strictEqual(gesture.app.requestHint(), false); assert.strictEqual(gesture.count(), 0);
  gesture.app.boardInput.isActive = () => false; gesture.app.dispose();
  const full = fixture({ storage: { [HintAccess.STORAGE_KEY]: { schemaVersion: 1, dateKey: '2026-08-31',
    unlockedLevelKeys: Array.from({ length: 1024 }, (_, i) => `daily:day:level${i}`) } }, enabled: true });
  full.open(0); assert.strictEqual(full.app.buildModel().hintAvailable, false);
  assert.strictEqual(full.app.requestHint(), false); assert.strictEqual(full.counts.shares + full.counts.attempts, 0); full.app.dispose();

  const switcher = fixture({ behavior: { track() { throw new Error('analytics unavailable'); } } }); switcher.seed(2); switcher.open(2);
  switcher.share.shareHint = async () => ({ initiated: false, reason: 'not-supported' });
  switcher.tap(); await settle(); assert.strictEqual(switcher.app.buildModel().hintLabel, '分享不可用');
  switcher.config.rules.hintRewardedEnabled = true;
  assert.strictEqual(switcher.app.buildModel().hintLabel, '广告解锁', 'stale share feedback cannot label an ad request');
  switcher.tap(); await settle(); switcher.video.close({ isEnded: true }); await settle();
  assert.strictEqual(switcher.count(), 3, 'analytics cannot block confirmed local access');
  switcher.config.rules.hintRewardedEnabled = false; switcher.open(3);
  assert.strictEqual(switcher.app.buildModel().hintLabel, '分享解锁'); assert.strictEqual(switcher.count(), 3); switcher.app.dispose();
}

async function bootstrapDefaults() {
  const previous = global.wx;
  try {
    const raw = fakeApi(); let shares = 0; let adCreates = 0;
    raw.getSystemInfoSync = () => ({ platform: 'devtools' });
    raw.shareAppMessage = () => { shares++; };
    raw.createRewardedVideoAd = () => { adCreates++; throw new Error('ads are not enabled'); };
    global.wx = raw;
    const app = require('../src/bootstrap.js').start();
    assert.strictEqual(app.engagement.config.hintMode, 'tiered');
    assert.strictEqual(app.engagement.config.hintRewardedEnabled, false);
    assert.strictEqual(app.engagement.hintAccess, app.hintAccess);
    for (let i = 0; i < 3; i++) {
      assert(app.openLevel(levels[i].setIndex, levels[i].levelIndex)); app.performAction('play:hint');
      if (i === 0) assert(app.hintPreview); else assert.strictEqual(app.hintPreview, null);
      await settle();
    }
    assert.strictEqual(shares, 2); assert.strictEqual(adCreates, 0);
    assert.strictEqual(app.hintAccess.status(app.hintContext()).unlockCount, 3);
    assert(!raw.events.includes('login')); app.dispose();
  } finally { global.wx = previous; }
}

module.exports = async function run() {
  await tierSequence();
  await capabilityAndFailureMatrix();
  await saveRecovery();
  await lifecycleAndSharedScope();
  await validationAndSwitches();
  await bootstrapDefaults();
};
