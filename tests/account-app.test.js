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
  assert.strictEqual(f.buttons.length, 0, 'legacy profile loading cannot mount a home authorization button');
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

async function wechatProfileDisplay() {
  const oldWx = global.wx;
  const raw = fakeApi();
  const buttons = [];
  let authorized = false;
  let gameClubButtons = 0;
  const userInfo = { nickName: '微信玩家', avatarUrl: 'https://example.test/wechat.png' };
  raw.getAccountInfoSync = () => ({ miniProgram: { envVersion: 'release' } });
  raw.onWindowResize = function (callback) { this.resize = callback; };
  raw.getSetting = options => options.success({ authSetting: { 'scope.userInfo': authorized } });
  raw.getUserInfo = options => options.success({ userInfo });
  raw.createGameClubButton = () => { gameClubButtons++; return {}; };
  raw.createUserInfoButton = options => {
    const button = { options, onTap(listener) { this.tap = listener; }, offTap() {},
      show() {}, hide() {}, destroy() { this.destroyed = true; } };
    buttons.push(button);
    return button;
  };
  try {
    global.wx = raw;
    const app = require('../src/bootstrap.js').start();
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(app.buildModel().accountProfile, null);
    assert.strictEqual(app.profile.isSupported(), true);
    assert(app.buildModel().updateDialog, 'the release notice precedes native profile authorization');
    assert.strictEqual(buttons.length, 0, 'the native authorization button cannot cover the update panel');
    app.performAction('update:confirm');
    assert.strictEqual(buttons.length, 1, 'an unapproved player sees a native home authorization button');
    assert.strictEqual(buttons[0].options.type, 'text');
    assert.strictEqual(buttons[0].options.text, '使用微信资料');
    assert.strictEqual(buttons[0].options.style.left, app.homeProfileButtonRect().x);
    assert.strictEqual(buttons[0].options.style.top, app.homeProfileButtonRect().y);
    app.tick(Date.now());
    assert.strictEqual(app.buildModel().profilePrompt, undefined, 'the game does not draw its own consent dialog');
    assert(!app.renderer.hits.some(hit => hit.id === 'profilePrompt:later'));
    assert.strictEqual(gameClubButtons, 0, 'home does not create the Game Club image');
    authorized = true;
    buttons[0].tap({ userInfo });
    await app.profile.pending;
    assert.strictEqual(buttons[0].destroyed, true);
    assert.strictEqual(app.buildModel().accountProfile.nickname, '微信玩家');
    app.performAction('home:account');
    assert.strictEqual(app.buildModel().accountProfile.nickname, '微信玩家',
      'account and home use the same approved profile');
    app.tick(Date.now());
    assert(!app.renderer.hits.some(hit => hit.id === 'account:authorizeProfile'),
      'the account page does not show an authorization button');
    assert.strictEqual(buttons.length, 1, 'the account page creates no second native button');
    app.performAction('account:back');
    assert.strictEqual(app.buildModel().accountProfile.avatarUrl, userInfo.avatarUrl);
    app.dispose();

    const reopened = require('../src/bootstrap.js').start();
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(reopened.buildModel().accountProfile.nickname, '微信玩家',
      'an existing WeChat grant refreshes the homepage without another tap');
    assert.strictEqual(buttons.length, 1, 'an existing grant does not show the home button');
    reopened.dispose();

    authorized = false;
    const unapproved = require('../src/bootstrap.js').start();
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(buttons.length, 2);
    raw.getWindowInfo = () => ({ windowWidth: 320, windowHeight: 568,
      safeArea: { top: 54, bottom: 548 } });
    raw.resize();
    assert.strictEqual(buttons[1].destroyed, true);
    assert.strictEqual(buttons.length, 3, 'resize repositions the native home button');
    assert.strictEqual(buttons[2].options.style.left, unapproved.homeProfileButtonRect().x);
    assert.strictEqual(buttons[2].options.style.top, unapproved.homeProfileButtonRect().y);
    assert(buttons[2].options.style.top + buttons[2].options.style.height <= unapproved.platform.metrics.safeBottom);
    buttons[2].tap({ userInfo: null });
    unapproved.tick(Date.now());
    assert.strictEqual(unapproved.buildModel().accountProfile, null);
    assert.strictEqual(buttons.length, 3, 'refusing authorization does not interrupt play or remount a dialog');
    unapproved.performAction('home:account');
    assert.strictEqual(unapproved.scene, 'account', 'home navigation remains available');
    assert.strictEqual(buttons[2].destroyed, true, 'the home button is removed on scene change');
    unapproved.tick(Date.now());
    assert(!unapproved.renderer.hits.some(hit => hit.id === 'account:authorizeProfile'));
    assert.strictEqual(unapproved.performAction('account:language:next'), true);
    unapproved.performAction('account:back');
    unapproved.tick(Date.now());
    assert.strictEqual(buttons.length, 4, 'returning home restores the native button');
    assert.strictEqual(buttons[3].options.text, 'Use WeChat profile');
    unapproved.onHide();
    assert.strictEqual(buttons[3].destroyed, true, 'backgrounding removes the native button');
    unapproved.onShow();
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(buttons.length, 5, 'foreground permission check restores the native button');
    unapproved.dispose();
  } finally { global.wx = oldWx; }
}

module.exports = async function run() {
  await homeProfileRefresh();
  await wechatProfileDisplay();
  const previousWx = global.wx;
  try {
    global.wx = fakeApi();
    const composed = require('../src/bootstrap.js').start();
    assert(composed.profile instanceof require('../src/services/profile-service.js'));
    assert.strictEqual(composed.profile.isSupported(), false, 'a missing native button keeps profile authorization hidden');
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
  assert.deepStrictEqual(app.renderer.hits.find(hit => hit.id === 'account:retrySync').rect, layout.retryButton);
  assert(!app.renderer.hits.some(hit => hit.id === 'account:authorizeProfile'));
  assert.strictEqual(f.buttons.length, 0, 'account page never mounts profile authorization');
  raw.getWindowInfo = () => ({ windowWidth: 320, windowHeight: 568 }); raw.resize();
  f.platform.metrics = platform.metrics;
  app.tick(Date.now());
  assert.deepStrictEqual(app.renderer.hits.find(hit => hit.id === 'account:retrySync').rect,
    accountLayout(platform.metrics).retryButton);
  assert.strictEqual(f.buttons.length, 0);
  app.performAction('account:back'); assert.strictEqual(app.scene, 'home');
  app.performAction('home:account'); app.onHide();
  app.onShow(); assert.strictEqual(f.buttons.length, 0);
  app.performAction('account:back'); app.openLevel(0, 0); assert.strictEqual(app.scene, 'play');
  app.scene = 'home'; app.performAction('home:account'); app.openLevel(0, 0);
  assert.strictEqual(f.buttons.length, 0);
  app.scene = 'home'; app.performAction('home:account'); app.dispose();
  const count = f.buttons.length; app.onShow(); assert.strictEqual(f.buttons.length, count);

  const offline = new ClearedApp(new WechatPlatform(fakeApi()));
  offline.performAction('home:account'); offline.tick(Date.now());
  assert(!offline.renderer.hits.some(hit => hit.id === 'account:authorizeProfile'));
  offline.performAction('account:back'); assert.strictEqual(offline.openLevel(0, 0), true);

  let cloudStatus = 'cloud-reading';
  const cloud = new ClearedApp(new WechatPlatform(fakeApi()), {
    auth: { state: () => 'authenticated', readOnlyPhase: false },
    progressSync: { state: () => ({ status: cloudStatus }) }
  });
  cloud.performAction('home:account');
  assert.strictEqual(cloud.buildModel().accountStatus, 'syncing');
  cloudStatus = 'migration-uploading'; assert.strictEqual(cloud.buildModel().accountStatus, 'syncing');
  cloudStatus = 'cloud-pending'; assert.strictEqual(cloud.buildModel().accountStatus, 'pending');
  cloudStatus = 'cloud-synced'; assert.strictEqual(cloud.buildModel().accountStatus, 'synced');
  cloudStatus = 'storage-blocked'; assert.strictEqual(cloud.buildModel().accountStatus, 'error');
  cloudStatus = 'migration-snapshot-missing'; assert.strictEqual(cloud.buildModel().accountStatus, 'error');
  cloud.dispose();

  const backupAccount = new ClearedApp(new WechatPlatform(fakeApi()), {
    auth: { state: () => 'authenticated', readOnlyPhase: true },
    progressSync: { state: () => ({ status: 'backed-up' }) },
    cloudBackup: { enabled: () => true, state: () => ({ status: 'backed-up', dirty: false }) }
  });
  backupAccount.performAction('home:account');
  assert.strictEqual(backupAccount.buildModel().accountStatus, 'synced',
    'the dedicated backup mode is not mislabeled as the old identity-only lane');
  backupAccount.dispose();

  const cloudRetry = new ClearedApp(new WechatPlatform(fakeApi()), {
    auth: { mode: 'cloud', readOnlyPhase: false, state: () => 'authenticated',
      ensureSession: async () => ({ ok: true }), current: () => ({ mode: 'cloud', ownerId: 'player_A',
        bindingEpoch: 1, environmentId: 'test-env' }) },
    progressSync: { state: () => ({ status: 'cloud-pending' }),
      bootstrapCloud: async () => ({ ok: true, status: 'cloud-pending', pending: 1 }) }
  });
  cloudRetry.performAction('home:account');
  assert.strictEqual(cloudRetry.retryAccountSync(), true);
  for (let attempts = 0; attempts < 5 && cloudRetry.accountSyncPending; attempts++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.strictEqual(cloudRetry.accountMessage, '云存档待同步，本地进度已保留',
    'account retry keeps the specific cloud result instead of replacing it with a generic success');
  cloudRetry.dispose();

  let resolve;
  const pending = new ClearedApp(new WechatPlatform(fakeApi()), { auth: { state: () => 'authenticating',
    ensureSession: () => new Promise(done => { resolve = done; }) } });
  pending.performAction('home:account'); pending.performAction('account:retrySync'); pending.tick(Date.now());
  assert.strictEqual(pending.buildModel().syncPending, true);
  assert(!pending.renderer.hits.some(hit => hit.id === 'account:retrySync'));
  pending.performAction('account:back'); resolve({ ok: false, reason: 'network' });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.strictEqual(pending.scene, 'home'); assert.strictEqual(pending.accountSyncPending, null);

  const feedbackNow = 1700000000000;
  const privacyPlatform = new WechatPlatform(fakeApi());
  privacyPlatform.openPrivacyContract = () => Promise.resolve({ ok: false, reason: 'not-supported' });
  const privacy = new ClearedApp(privacyPlatform, { clock: () => new Date(feedbackNow) });
  privacy.performAction('home:account');
  privacy.performAction('account:privacy');
  await Promise.resolve(); await Promise.resolve();
  assert.strictEqual(privacy.accountMessage, '',
    'privacy failures do not overwrite the player identity area');
  assert.deepStrictEqual(privacy.buildModel().accountFeedback,
    { reason: 'privacy-open-failed', until: feedbackNow + 2200 });
  privacy.tick(feedbackNow + 2199);
  assert(privacy.buildModel().accountFeedback, 'privacy feedback remains visible before its deadline');
  privacy.tick(feedbackNow + 2200);
  assert.strictEqual(privacy.buildModel().accountFeedback, null,
    'privacy feedback clears itself after the same short interval as stamina feedback');
  privacy.dispose();
};
