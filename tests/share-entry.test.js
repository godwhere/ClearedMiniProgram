'use strict';
const assert = require('assert');
const { fixture } = require('./share-service.test.js');
const ShareService = require('../src/services/share-service.js');
const WechatPlatform = require('../src/platform/wechat.js');
const ClearedApp = require('../src/app.js');
const Engagement = require('../src/services/engagement-service.js');
const { fakeApi } = require('./account-bootstrap.test.js');

function solveForShare(app, paths) {
  app.tick(Date.now() + 1000);
  const board = app.renderer.getBoardLayout();
  const width = app.activeRunner().level.Width;
  for (const path of paths) {
    const point = index => ({ x: board.x + (index % width + 0.5) * board.cell,
      y: board.y + (Math.floor(index / width) + 0.5) * board.cell, id: 1 });
    app.onPointerStart(point(path[0]));
    path.slice(1).forEach(index => app.onPointerMove(point(index)));
    app.onPointerEnd(point(path[path.length - 1]));
  }
  if (app.daily.nextLevelAt) app.tick(app.daily.nextLevelAt);
}

async function menuAfterNavigation() {
  for (const exit of ['result:levels', 'dailyResult:home', 'dailyResult:back']) {
    const f = fixture();
    const app = new ClearedApp(new WechatPlatform(fakeApi()), { share: f.service, auth: f.auth,
      clock: () => new Date('2026-08-31T00:00:00Z'), engagement: new Engagement({ share: f.service }) });
    f.service.install(() => app.shareContext());
    await app.resumeOnline();
    assert(f.menu().query.includes('sid='));
    if (exit === 'result:levels') {
      app.performAction('home:start'); solveForShare(app, [[0, 1, 2, 3, 4]]);
      assert.strictEqual(app.scene, 'result');
    } else {
      const solutions = require('../data/daily-solutions.js').ByChallengeId;
      app.performAction('home:dailyChallenge');
      solveForShare(app, solutions[app.daily.challengeId]);
      solveForShare(app, solutions[app.daily.challengeId]);
      assert.strictEqual(app.scene, 'dailyResult');
    }
    await f.service.intentRequest.promise;
    assert(f.menu().query.includes('sid='));
    app.performAction(exit);
    if (exit === 'result:levels') app.performAction('levels:home');
    if (f.service.intentRequest) await f.service.intentRequest.promise;
    assert.strictEqual(app.scene, 'home');
    assert(f.menu().query.includes('sid='), `${exit} must refresh the home intent through App actions`);
    assert(f.menu().query.includes('scene=home'));
    assert.strictEqual(f.installs(), 1);
    // Expiry and account checks still govern navigation-triggered prefetch.
    f.service.intent.expiresAt = Date.now() - 1;
    assert(!f.menu().query.includes('sid='));
    app.performAction('home:levels'); app.performAction('levels:home');
    if (f.service.intentRequest) await f.service.intentRequest.promise;
    assert(f.menu().query.includes('sid='));
    f.user('another'); assert(!f.menu().query.includes('sid='));
    app.performAction('home:levels'); app.performAction('levels:home');
    if (f.service.intentRequest) await f.service.intentRequest.promise;
    assert(f.menu().query.includes('sid='));
    f.user(null); assert(!f.menu().query.includes('sid='));
    app.dispose();
  }

  const f = fixture();
  const app = new ClearedApp(new WechatPlatform(fakeApi()), { share: f.service, auth: f.auth,
    engagement: new Engagement({ share: f.service }) });
  f.service.install(() => app.shareContext()); await app.resumeOnline();
  let finish;
  f.api.request = () => new Promise(resolve => { finish = resolve; });
  app.performAction('home:start'); solveForShare(app, [[0, 1, 2, 3, 4]]);
  const obsolete = f.service.intentRequest.promise;
  assert.strictEqual((await f.service.share(app.shareContext())).initiated, true, 'a pending intent cannot delay the share panel');
  assert(!f.shares[0].query.includes('sid='), 'a home sid is never reused for a result');
  app.performAction('result:levels'); app.performAction('levels:home');
  finish({ ok: true, data: { shareId: 'shr_late_result', expiresAt: Date.now() + 60000 } }); await obsolete;
  assert(f.menu().query.includes('sid=') && !f.menu().query.includes('shr_late_result'), 'a late result intent cannot evict the reused home intent');
  app.dispose();
}

module.exports = async function run() {
  await menuAfterNavigation();
  const config = require('../src/config/engagement.js').share;
  const originalConfig = Object.assign({}, config); const previousWx = global.wx;
  try {
    Object.assign(config, { menuEnabled: true, attributionEnabled: true });
    const raw = fakeApi(); let registered = 0;
    raw.onShareAppMessage = () => { registered++; }; raw.showShareMenu = () => {};
    raw.getLaunchOptionsSync = () => ({ scene: 1007, query: { sv: '1', sid: 'shr_cold', scene: 'home' } });
    global.wx = raw;
    const composed = require('../src/bootstrap.js').start();
    assert.strictEqual(composed.share.pending[0].shareId, 'shr_cold');
    raw.show({ scene: 1007, query: { sv: '1', sid: 'shr_hot', scene: 'home' } });
    assert.strictEqual(composed.share.pending.length, 2); assert.strictEqual(registered, 1);
    composed.dispose();
  } finally { Object.assign(config, originalConfig); global.wx = previousWx; }
  const f = fixture(); const entry = { scene: 1007, query: { sv: '1', sid: 'shr_invite', scene: 'home', userId: 'never-store', token: 'never-store' } };
  assert(f.service.captureEntry(entry)); assert.strictEqual(f.service.captureEntry(entry), false);
  assert.strictEqual(JSON.stringify(f.storage).includes('never-store'), false);
  const restored = new ShareService(f.platform, f.api, f.auth, f.store, f.config, f.behavior);
  const id = restored.pending[0].attributionId;
  assert((await restored.consumePendingAttribution(f.auth.current())).ok);
  assert.strictEqual(f.requests[0].body.attributionId, id); assert.strictEqual(restored.pending.length, 0);
  assert.strictEqual(restored.captureEntry(entry), false);
  assert.strictEqual(f.events.filter(event => event.name === 'reward_granted').length, 0);
  assert.strictEqual(restored.captureEntry({ query: { sv: '1', sid: 'bad', scene: 'home' } }), false);
  f.service.pending[0].userId = 'old-user'; const count = f.requests.length;
  await f.service.consumePendingAttribution(f.auth.current()); assert.strictEqual(f.requests.length, count);

  const retry = fixture(); retry.service.captureEntry(entry); const originalId = retry.service.pending[0].attributionId;
  retry.api.request = async () => ({ ok: false, error: { code: 'network' } });
  await retry.service.consumePendingAttribution(retry.auth.current());
  assert.strictEqual(retry.service.pending[0].attributionId, originalId);
  retry.api.request = async options => { assert.strictEqual(options.body.attributionId, originalId); return { ok: true, data: { alreadyAttributed: true } }; };
  assert((await retry.service.consumePendingAttribution(retry.auth.current())).ok);

  const raw = fakeApi(); const platform = new WechatPlatform(raw); const entries = [];
  raw.getLaunchOptionsSync = () => entry; raw.getEnterOptionsSync = () => entry;
  assert.strictEqual(platform.getLaunchOptions(), entry); assert.strictEqual(platform.getEnterOptions(), entry);
  const capture = fixture(); const originalCapture = capture.service.captureEntry.bind(capture.service);
  capture.service.captureEntry = value => { entries.push(value); return originalCapture(value); };
  const app = new ClearedApp(platform, { share: capture.service, auth: capture.auth, engagement: new Engagement({ share: capture.service }) });
  app.start(); raw.show(entry); assert.strictEqual(entries[0], entry, 'hot-start options reach the share service unchanged');
  await app.resumeOnline();
  app.openLevel(0, 0); app.scene = 'result'; app.result = { elapsedMs: 100, bestMs: 100 }; app.resultVisibleAt = 0;
  const progress = JSON.stringify(app.progress.state); app.performAction('result:share'); app.performAction('result:share');
  assert.strictEqual(capture.shares.length, 1);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.strictEqual(JSON.stringify(app.progress.state), progress);
  app.dispose();
};
