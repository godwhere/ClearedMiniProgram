'use strict';

const assert = require('assert');
const App = require('../src/app.js');
const WechatPlatform = require('../src/platform/wechat.js');
const HintAccess = require('../src/services/hint-access-service.js');
const ShareService = require('../src/services/share-service.js');
const Engagement = require('../src/services/engagement-service.js');
const catalog = require('../data/catalog-v2.js');
const solutions = require('../data/solutions.js');
const dailySolutions = require('../data/daily-solutions.js');
const { fakeApi } = require('./account-bootstrap.test.js');
const settle = () => new Promise(resolve => setImmediate(resolve));
const copy = value => JSON.parse(JSON.stringify(value));

function fixture(options) {
  const opts = options || {};
  const raw = fakeApi(); const shares = []; const storage = opts.storage || {};
  let now = new Date('2026-08-31T00:00:00Z'); let diskFailure = false;
  raw.getStorageSync = key => storage[key];
  raw.setStorageSync = (key, value) => {
    if (diskFailure && key === HintAccess.STORAGE_KEY) throw new Error('storage unavailable');
    storage[key] = copy(value);
  };
  // The native API has no send/cancel result. A user may cancel after this
  // invocation; the accepted product rule still qualifies the local hint.
  raw.shareAppMessage = payload => { shares.push(payload); };
  const platform = new WechatPlatform(raw);
  const forbidden = () => { throw new Error('hint sharing cannot require auth, backend, ads or reward claims'); };
  const share = new ShareService(platform, { isConfigured: () => false, request: forbidden },
    { current: forbidden, ensureSession: forbidden }, {}, { attributionEnabled: true, rewardsEnabled: true });
  const hintAccess = new HintAccess(platform, { clock: () => now });
  const engagement = new Engagement({ share, hintAccess, config: { hintMode: 'share' },
    ads: { showRewarded: forbidden }, rewards: { claim: forbidden } });
  const app = new App(platform, { share, hintAccess, engagement, clock: () => now,
    solutionCatalog: solutions, progressionConfig: { unlockAllLevelsInDevTools: true } });
  return { app, raw, platform, share, hintAccess, shares, storage, engagement,
    failStorage: value => { diskFailure = value; }, setNow: value => { now = new Date(value); } };
}

function gameplayState(runner) {
  const state = runner.getViewState(); delete state.elapsedMs; delete state.timeText; return state;
}

function finishDailyLevel(app) {
  app.tick(Date.now() + 1000);
  const board = app.renderer.getBoardLayout(); const width = app.daily.challenge.Width;
  const paths = dailySolutions.ByChallengeId[app.daily.challengeId];
  for (const path of paths) {
    const point = index => ({ x: board.x + (index % width + 0.5) * board.cell,
      y: board.y + (Math.floor(index / width) + 0.5) * board.cell, id: 1 });
    app.onPointerStart(point(path[0]));
    path.slice(1).forEach(index => app.onPointerMove(point(index)));
    app.onPointerEnd(point(path[path.length - 1]));
  }
}

module.exports = async function run() {
  const f = fixture(); const app = f.app;
  app.openLevel(0, 0); app.tick(Date.now());
  const context = app.hintContext(); const before = gameplayState(app.runner);
  const progress = copy(app.progress.state);
  assert.strictEqual(app.buildModel().hintLabel, '分享解锁');
  const hit = app.renderer.hits.find(item => item.id === 'play:hint');
  const point = { x: hit.rect.x + hit.rect.w / 2, y: hit.rect.y + hit.rect.h / 2, id: 1 };
  app.onPointerStart(point); app.onPointerEnd(point);
  assert.strictEqual(f.shares.length, 1, 'the native share call remains synchronous with the touch gesture');
  assert.strictEqual(app.buildModel().hintAvailable, false);
  assert.strictEqual(app.buildModel().hintLabel, '处理中');
  assert.strictEqual(app.requestHint(), false);
  assert.strictEqual(app.hintPreview, null);
  await settle();
  assert.deepStrictEqual(f.shares[0], { title: '这道题你能解开吗？', query: 'sv=1&scene=home' });
  assert.strictEqual(app.hintPreview, null, 'unlocking cannot start the ten-second timer beneath the share panel');
  assert.strictEqual(app.buildModel().hintLabel, '查看提示');
  assert.strictEqual(f.hintAccess.status(context).unlockCount, 1);
  app.onHide(); app.onShow(); await settle();
  assert.strictEqual(f.hintAccess.status(context).unlockCount, 1, 'foreground callbacks are not extra unlock proofs');
  for (let i = 0; i < 3; i++) {
    app.performAction('play:hint');
    assert(app.hintPreview);
    assert(app.hintPreview.until - Date.now() > 9000);
    assert.deepStrictEqual(gameplayState(app.runner), before);
    app.performAction('play:hint'); assert.strictEqual(app.hintPreview, null);
  }
  app.performAction('play:reset'); app.openLevel(0, 0); app.performAction('play:hint');
  assert(app.hintPreview); assert.strictEqual(f.shares.length, 1);
  assert.deepStrictEqual(app.progress.state, progress);
  app.clearHintPreview();

  const portal = catalog.levels.find(entry => entry.game.Mechanic === 'portal');
  app.openLevel(portal.setIndex, portal.levelIndex); app.performAction('play:hint'); await settle();
  assert.strictEqual(app.hintPreview, null); app.performAction('play:hint');
  assert(app.hintPreview && app.hintPreview.viewModel.mechanic.portal);
  assert.strictEqual(f.hintAccess.status(app.hintContext()).unlockCount, 2);
  app.clearHintPreview(); app.performAction('play:back'); app.performAction('levels:home');
  app.performAction('home:dailyChallenge');
  const dailyContext = app.hintContext(); const dailyBefore = copy(app.dailyProgress.state);
  app.performAction('daily:hint'); await settle();
  assert.strictEqual(app.hintPreview, null); app.performAction('daily:hint'); assert(app.hintPreview);
  assert.deepStrictEqual(app.dailyProgress.state, dailyBefore, 'hint access never adds or consumes daily entries');
  app.performAction('daily:hint'); finishDailyLevel(app);
  assert.notStrictEqual(app.hintContext().levelKey, dailyContext.levelKey);
  assert.strictEqual(app.buildModel().hintLabel, '分享解锁', 'daily sublevels unlock independently');
  app.performAction('daily:hint'); await settle();
  assert.strictEqual(f.hintAccess.status(app.hintContext()).unlockCount, 4);
  assert.strictEqual(f.shares.length, 4);
  app.dispose();

  const restarted = fixture({ storage: f.storage });
  restarted.app.openLevel(0, 0); restarted.app.performAction('play:hint');
  assert(restarted.app.hintPreview); assert.strictEqual(restarted.shares.length, 0);
  restarted.app.clearHintPreview(); restarted.setNow('2026-08-31T16:00:00Z');
  assert.strictEqual(restarted.app.buildModel().hintLabel, '分享解锁');
  assert.strictEqual(restarted.hintAccess.status(restarted.app.hintContext()).unlockCount, 0);
  restarted.app.dispose();

  const disk = fixture(); disk.app.openLevel(0, 0); disk.failStorage(true);
  disk.app.performAction('play:hint'); await settle();
  assert.strictEqual(disk.app.buildModel().hintLabel, '重试保存');
  assert.strictEqual(disk.hintAccess.status(disk.app.hintContext()).unlockCount, 0);
  disk.failStorage(false); disk.app.performAction('play:hint'); await settle();
  assert.strictEqual(disk.shares.length, 1, 'disk retry must not require another share');
  assert.strictEqual(disk.app.hintPreview, null); disk.app.performAction('play:hint'); assert(disk.app.hintPreview);
  disk.app.dispose();

  const missing = fixture(); missing.app.openLevel(0, 0); delete missing.raw.shareAppMessage;
  missing.app.performAction('play:hint'); await settle();
  assert.strictEqual(missing.app.buildModel().hintLabel, '分享不可用');
  assert.strictEqual(missing.hintAccess.status(missing.app.hintContext()).unlockCount, 0);
  missing.app.onHide(); missing.app.onShow(); await settle();
  assert.strictEqual(missing.hintAccess.status(missing.app.hintContext()).unlockCount, 0);
  missing.app.hints.findComplete = () => null;
  missing.app.performAction('play:hint');
  assert.strictEqual(missing.shares.length, 0); assert.strictEqual(missing.app.buildModel().hintLabel, '暂无提示');
  missing.app.dispose();

  for (const change of ['level', 'date', 'dispose']) {
    const late = fixture(); let finish;
    late.share.shareHint = () => new Promise(resolve => { finish = resolve; });
    late.app.openLevel(0, 0); const original = late.app.hintContext();
    late.app.performAction('play:hint');
    if (change === 'level') {
      late.app.openLevel(0, 1); late.app.performAction('play:hint');
      assert.strictEqual(late.hintAccess.status(late.app.hintContext()).unlocked, false);
    } else if (change === 'date') late.setNow('2026-08-31T16:00:00Z');
    else late.app.dispose();
    finish({ initiated: true }); await settle();
    assert.strictEqual(late.app.hintPreview, null);
    if (change === 'level') {
      assert.strictEqual(late.hintAccess.status(original).unlocked, true);
      assert.strictEqual(late.hintAccess.status(late.app.hintContext()).unlocked, false);
    } else if (change === 'date') assert.strictEqual(late.hintAccess.status(late.app.hintContext()).unlockCount, 0);
    if (change !== 'dispose') late.app.dispose();
  }

  const previousWx = global.wx;
  try {
    const raw = fakeApi(); let shares = 0;
    raw.shareAppMessage = () => { shares++; }; global.wx = raw;
    const booted = require('../src/bootstrap.js').start();
    assert.strictEqual(booted.engagement.config.hintMode, 'share', 'production bootstrap enables the approved share policy');
    assert.strictEqual(booted.engagement.hintAccess, booted.hintAccess);
    booted.openLevel(0, 0); booted.performAction('play:hint');
    assert.strictEqual(shares, 1); await settle();
    assert.strictEqual(booted.hintPreview, null); booted.performAction('play:hint'); assert(booted.hintPreview);
    assert(!raw.events.includes('login'), 'hint sharing works with backend authentication disabled');
    booted.dispose();
  } finally { global.wx = previousWx; }
};
