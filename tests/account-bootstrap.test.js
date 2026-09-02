'use strict';
const assert = require('assert');
const bootstrap = require('../src/bootstrap.js');
const backend = require('../src/config/backend.js');
const engagement = require('../src/config/engagement.js');
const WechatPlatform = require('../src/platform/wechat.js');

function fakeApi() {
  const storage = {}; const events = [];
  const ctx = new Proxy({}, { get: (target, key) => target[key] || (() => {}) });
  const canvas = { getContext: () => ctx, requestAnimationFrame() { events.push('frame'); return 1; }, cancelAnimationFrame() {}, createImage: () => ({}) };
  return { storage, events, createCanvas: () => canvas, getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844 }),
    getStorageSync: key => storage[key], setStorageSync(key, value) { storage[key] = JSON.parse(JSON.stringify(value)); },
    onTouchStart() {}, onTouchMove() {}, onTouchEnd() {}, onShow(fn) { this.show = fn; }, onHide() {},
    login(opts) { events.push('login'); opts.fail({}); }, request() { throw Error('login failed'); } };
}

async function run() {
  const oldWx = global.wx; const oldBackend = Object.assign({}, backend); const oldAuth = engagement.auth.enabled;
  try {
    Object.assign(backend, { enabled: true, baseUrl: 'https://example.test' }); engagement.auth.enabled = true;
    const api = fakeApi(); global.wx = api;
    const app = bootstrap.start();
    assert.strictEqual(app.scene, 'home'); assert.deepStrictEqual(api.events, ['frame']);
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
}
run.fakeApi = fakeApi;
module.exports = run;
