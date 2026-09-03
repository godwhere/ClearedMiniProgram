'use strict';
const assert = require('assert');
const ClearedApp = require('../src/app.js');
const WechatPlatform = require('../src/platform/wechat.js');
const accountLayout = require('../src/ui/account-layout.js');
const { fakeApi } = require('./account-bootstrap.test.js');
const { fixture } = require('./profile-service.test.js');

async function homeProfileRefresh() {
  const f = fixture();
  const profile = { nickname: '玩家', avatarUrl: 'https://example.test/player.png' };
  let finish; let requests = 0;
  f.api.request = options => {
    assert.strictEqual(options.method, 'GET');
    requests++;
    return new Promise(resolve => { finish = resolve; });
  };
  const app = new ClearedApp(new WechatPlatform(fakeApi()), { profile: f.profile, auth: f.auth });
  app.start(); app.tick(Date.now());
  assert.strictEqual(app.scene, 'home');
  assert.strictEqual(app.buildModel().accountProfile, null);
  let onlineFinished = false;
  app.resumeOnline().then(() => { onlineFinished = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert(onlineFinished, 'profile loading cannot hold up the normal online resume flow');
  assert.strictEqual(requests, 1);
  assert.strictEqual(f.buttons.length, 0, 'the homepage never mounts a native authorization button');
  app.dirty = false;
  finish({ ok: true, data: { profile } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepStrictEqual(app.buildModel().accountProfile, profile);
  assert.strictEqual(app.dirty, true, 'loaded profile data refreshes the home avatar');
  f.setUser('other');
  assert.strictEqual(app.buildModel().accountProfile, null, 'the previous account avatar cannot remain in the home model');
  assert.strictEqual(f.buttons.length, 0);
  app.dispose();
}

module.exports = async function run() {
  await homeProfileRefresh();
  const previousWx = global.wx;
  try {
    global.wx = fakeApi();
    const composed = require('../src/bootstrap.js').start();
    assert(composed.profile instanceof require('../src/services/profile-service.js'));
    assert.strictEqual(composed.profile.isSupported(), false, 'profile remains disabled by default');
    composed.dispose();
  } finally { global.wx = previousWx; }
  const raw = fakeApi(); raw.onWindowResize = function (callback) { this.resize = callback; };
  const platform = new WechatPlatform(raw);
  const f = fixture(); f.platform.metrics = platform.metrics;
  const app = new ClearedApp(platform, { profile: f.profile, auth: Object.assign(f.auth, { state: () => 'authenticated' }) });
  app.start(); app.tick(Date.now()); assert.strictEqual(f.buttons.length, 0);
  assert(app.renderer.hits.some(hit => hit.id === 'home:account'));
  app.performAction('home:account'); app.tick(Date.now());
  const layout = accountLayout(platform.metrics);
  assert.deepStrictEqual(app.renderer.hits.find(hit => hit.id === 'account:authorizeProfile').rect, layout.profileButton);
  assert.strictEqual(f.buttons[0].options.style.left, layout.profileButton.x);
  assert.strictEqual(f.buttons[0].options.style.top, layout.profileButton.y);
  raw.getWindowInfo = () => ({ windowWidth: 320, windowHeight: 568 }); raw.resize();
  f.platform.metrics = platform.metrics;
  app.tick(Date.now());
  assert.strictEqual(f.buttons[0].destroyed, true);
  assert.strictEqual(f.buttons[1].options.style.left, accountLayout(platform.metrics).profileButton.x);
  // Continue with the latest mounted button after resizing.
  f.buttons.shift();
  f.buttons[0].tap({ profile: null });
  assert.strictEqual(app.buildModel().accountMessage, '未授权，仍可继续游玩');
  app.performAction('account:back'); assert.strictEqual(f.buttons[0].destroyed, true); assert.strictEqual(app.scene, 'home');
  app.performAction('home:account'); app.onHide(); assert.strictEqual(f.buttons[1].destroyed, true);
  app.onShow(); assert.strictEqual(f.buttons.length, 3);
  app.performAction('account:back'); app.openLevel(0, 0); assert.strictEqual(app.scene, 'play');
  app.scene = 'home'; app.performAction('home:account'); app.openLevel(0, 0);
  assert.strictEqual(f.buttons[3].destroyed, true, 'direct level navigation also unmounts the overlay');
  app.scene = 'home'; app.performAction('home:account'); app.dispose(); assert.strictEqual(f.buttons[4].destroyed, true);
  const count = f.buttons.length; app.onShow(); assert.strictEqual(f.buttons.length, count);

  const offline = new ClearedApp(new WechatPlatform(fakeApi()));
  offline.performAction('home:account'); offline.tick(Date.now());
  assert.strictEqual(offline.buildModel().profileSupported, false);
  assert(!offline.renderer.hits.some(hit => hit.id === 'account:authorizeProfile'));
  offline.performAction('account:back'); assert.strictEqual(offline.openLevel(0, 0), true);

  let resolve;
  const pending = new ClearedApp(new WechatPlatform(fakeApi()), { auth: { state: () => 'authenticating',
    ensureSession: () => new Promise(done => { resolve = done; }) } });
  pending.performAction('home:account'); pending.performAction('account:retrySync'); pending.tick(Date.now());
  assert.strictEqual(pending.buildModel().syncPending, true);
  assert(!pending.renderer.hits.some(hit => hit.id === 'account:retrySync'));
  pending.performAction('account:back'); resolve({ ok: false, reason: 'network' });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.strictEqual(pending.scene, 'home'); assert.strictEqual(pending.accountSyncPending, null);
};
