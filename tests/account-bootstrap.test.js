'use strict';
const assert = require('assert');
const bootstrap = require('../src/bootstrap.js');
const backend = require('../src/config/backend.js');
const engagement = require('../src/config/engagement.js');
const cloudbase = require('../src/config/cloudbase.js');
const WechatPlatform = require('../src/platform/wechat.js');

function fakeApi() {
  const storage = {}; const events = [];
  const ctx = new Proxy({}, { get: (target, key) => target[key] || (() => {}) });
  const canvas = { getContext: () => ctx, requestAnimationFrame() { events.push('frame'); return 1; }, cancelAnimationFrame() {}, createImage: () => ({}) };
  return { storage, events, createCanvas: () => canvas, getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844 }),
    getStorageSync: key => storage[key], setStorageSync(key, value) { storage[key] = JSON.parse(JSON.stringify(value)); },
    getStorageInfoSync: () => ({ keys: Object.keys(storage) }),
    onTouchStart() {}, onTouchMove() {}, onTouchEnd() {}, onShow(fn) { this.show = fn; }, onHide() {},
    login(opts) { events.push('login'); opts.fail({}); }, request() { throw Error('login failed'); } };
}

async function run() {
  const oldWx = global.wx; const oldBackend = Object.assign({}, backend); const oldAuth = engagement.auth.enabled;
  try {
    Object.assign(backend, { enabled: true, baseUrl: 'https://example.test' }); engagement.auth.enabled = true;
    const api = fakeApi(); global.wx = api;
    api.cloud = { init() { throw Error('cloud disabled during HTTP auth'); },
      callFunction() { throw Error('cloud disabled during HTTP auth'); } };
    const app = bootstrap.start();
    assert.strictEqual(app.scene, 'home'); assert.deepStrictEqual(api.events, ['frame']);
    assert.deepStrictEqual(app.productCapabilities, {
      dailyEnabled: true,
      adsEnabled: true,
      rewardedShareEnabled: true,
      resultShareEnabled: true,
      hintMode: 'tiered'
    });
    assert(app.dailyService && app.dailyProgress && app.ads && app.share && app.hintAccess,
      'the WeChat bootstrap explicitly retains its existing daily, ad, share and hint services');
    assert.strictEqual(app.rewardUnlocks.view().balance, 0);
    await app.resumeOnline();
    assert.strictEqual(api.events.filter(e => e === 'login').length, 1);
    assert.strictEqual(app.openLevel(0, 0), true);
    const runner = app.runner;
    runner.touchStart(0); [1, 2, 3, 4].forEach(cell => runner.touchMove(cell)); runner.touchEnd(4);
    app.onPathCompleted(0, [0, 1, 2, 3, 4]);
    assert.strictEqual(app.scene, 'result'); assert.strictEqual(app.progress.isCompleted(0, 0), true);
    assert.strictEqual(app.progressSync.store.state.pendingOperations.length, 1);
    app.platform.stopLoop();
    const platform = new WechatPlatform(fakeApi()); platform.api.login = () => {};
    await assert.rejects(platform.login(1), error => error.reason === 'timeout');
    platform.api.request = () => {};
    assert.strictEqual((await platform.request({ timeout: 1 })).reason, 'timeout');
  } finally {
    global.wx = oldWx; Object.assign(backend, oldBackend); engagement.auth.enabled = oldAuth;
  }
  const AuthService = require('../src/services/auth-service.js');
  const SessionStore = require('../src/services/session-store.js');
  let loginCount = 0; let nested; let entered = false;
  const host = { getStorage: () => null, setStorage: () => true, login: async () => { loginCount++; return { code: 'temporary' }; } };
  const sessions = new SessionStore(host);
  const api = { isConfigured: () => true, request: async () => ({ ok: true, data: { user: { id: 'u1' },
    session: { accessToken: 'test', issuedAt: Date.now(), expiresAt: Date.now() + 90000 } } }) };
  const auth = new AuthService(host, api, sessions, { state: { installId: 'ins_test' } }, { enabled: true });
  auth.onSessionChanged(() => { if (!entered) { entered = true; nested = auth.ensureSession(); } });
  const parent = auth.ensureSession();
  assert.strictEqual(parent, nested, 'session observers share the already-published authentication flight');
  await parent; assert.strictEqual(loginCount, 1);

  // Cloud opt-in alone cannot bypass the separate identity/read rollout.
  const savedCloud = Object.assign({}, cloudbase); const savedAuth = engagement.auth.enabled;
  let cloudApp;
  try {
    Object.assign(cloudbase, { enabled: true, env: 'test-fixture' }); engagement.auth.enabled = true;
    const native = fakeApi(); let calls = 0;
    native.cloud = { init() { calls++; }, callFunction() { calls++; } };
    global.wx = native; cloudApp = bootstrap.start();
    assert.strictEqual(cloudApp.scene, 'home'); assert.deepStrictEqual(native.events, ['frame']);
    assert.strictEqual((await cloudApp.resumeOnline()).reason, 'not-configured');
    assert.strictEqual(calls, 0); assert.strictEqual(cloudApp.auth.current(), null);
    assert(cloudApp.openLevel(0, 0));
  } finally {
    if (cloudApp) cloudApp.dispose();
    Object.assign(cloudbase, savedCloud); engagement.auth.enabled = savedAuth; global.wx = oldWx;
  }

  // Clean checkouts do not contain the ignored develop override. Tests must be
  // able to inject one explicitly instead of depending on a machine-local file.
  let injectedApp; let loadCount = 0;
  try {
    const native = fakeApi();
    native.getAccountInfoSync = () => ({ miniProgram: { envVersion: 'develop' } });
    global.wx = native;
    injectedApp = bootstrap.start({ loadLocalCloudConfig: () => {
      loadCount++;
      return Object.assign({}, cloudbase, { enabled: true, env: 'injected-test-fixture' });
    } });
    assert.strictEqual(loadCount, 1);
    assert.strictEqual(injectedApp.auth.api.transport.config.env, 'injected-test-fixture');
  } finally {
    if (injectedApp) injectedApp.dispose();
    global.wx = oldWx;
  }
}
run.fakeApi = fakeApi;
module.exports = run;
