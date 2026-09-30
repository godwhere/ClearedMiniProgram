'use strict';
const assert = require('assert');
const ProfileService = require('../src/services/profile-service.js');
const WechatPlatform = require('../src/platform/wechat.js');
const ApiClient = require('../src/services/api-client.js');

function fixture() {
  const buttons = []; const calls = []; const events = [];
  let userId = 'user1'; let loginCalls = 0;
  const platform = { metrics: { width: 390, safeTop: 44, safeBottom: 810 }, supportsUserInfoButton: () => true,
    createUserInfoButton(options) {
      const button = { options, onTap(fn) { this.tap = fn; }, offTap(fn) { assert.strictEqual(fn, this.tap); },
        destroy() { this.destroyed = true; }, show() { this.hidden = false; }, hide() { this.hidden = true; } };
      buttons.push(button); return button;
    } };
  const auth = { current: () => userId ? { userId } : null, ensureSession: async () => { loginCalls++; return { ok: true }; } };
  const api = { isConfigured: () => true, request: async options => { calls.push(options); return { ok: true, data: {} }; } };
  const profile = new ProfileService(platform, api, auth, { enabled: true }, { track: (name, value) => events.push({ name, value }) });
  return { profile, platform, api, auth, buttons, calls, events, loginCalls: () => loginCalls, setUser(value) { userId = value; } };
}
const rect = { x: 40, y: 300, w: 300, h: 48 };
const info = { nickname: '玩家\u0000' + '好'.repeat(50), avatarUrl: 'https://example.test/avatar.png' };

async function run() {
  const f = fixture(); let denied = 0; let success = 0;
  assert.strictEqual(f.buttons.length, 0, 'construction cannot authorize or mount');
  assert(f.profile.mount({ rect, onDenied: () => denied++, onSuccess: () => success++ }).ok);
  const button = f.buttons[0];
  assert.strictEqual(button.options.withCredentials, false);
  button.tap({ profile: null });
  assert.strictEqual(denied, 1); assert.strictEqual(f.loginCalls(), 0); assert.strictEqual(f.auth.current().userId, 'user1');
  button.tap({ profile: info }); const pending = f.profile.pending; button.tap({ profile: info });
  assert.strictEqual(button.hidden, true); await pending;
  assert.strictEqual(f.calls.length, 1); assert.strictEqual(success, 1); assert.strictEqual(button.hidden, false);
  assert.strictEqual(f.calls[0].path, ApiClient.PATHS.profile);
  assert.strictEqual(Array.from(f.calls[0].body.nickname).length, 32);
  assert.deepStrictEqual(Object.keys(f.calls[0].body), ['nickname', 'avatarUrl']);
  assert.strictEqual(JSON.stringify(f.events).includes('avatar'), false);
  assert.strictEqual(f.profile.current().nickname.length, 32);
  f.setUser('user2'); assert.strictEqual(f.profile.current(), null);
  f.profile.handleResize(Object.assign({}, rect, { y: 400 })); assert.strictEqual(button.destroyed, true);
  assert.strictEqual(f.buttons[1].options.style.top, 400);
  const count = f.calls.length; button.tap({ profile: info }); assert.strictEqual(f.calls.length, count);
  f.profile.dispose(); assert.strictEqual(f.buttons[1].destroyed, true);
  assert.strictEqual(f.profile.mount({ rect }).ok, false);

  const delayed = fixture(); let resolve; let callbacks = 0;
  delayed.api.request = () => new Promise(done => { resolve = done; });
  delayed.profile.mount({ rect, onSuccess: () => callbacks++ }); delayed.buttons[0].tap({ profile: info });
  await Promise.resolve(); delayed.profile.unmount(); resolve({ ok: true, data: {} });
  await delayed.profile.pending; assert.strictEqual(callbacks, 0);

  const changed = fixture();
  changed.api.request = async () => { changed.setUser('user2'); return { ok: true, data: {} }; };
  changed.profile.mount({ rect }); changed.buttons[0].tap({ profile: info });
  assert.strictEqual((await changed.profile.pending).reason, 'account-mismatch'); assert.strictEqual(changed.profile.current(), null);
  const unsupported = fixture(); unsupported.platform.supportsUserInfoButton = () => false;
  assert.strictEqual(unsupported.profile.mount({ rect }).ok, false); assert.strictEqual(unsupported.buttons.length, 0);
  const invalid = fixture(); assert.strictEqual(invalid.profile.mount({ rect: { x: 0, y: 0, w: 390, h: 844 } }).ok, false);
  const retry = fixture(); let requests = 0;
  retry.api.request = async () => { requests++; return { ok: false, error: { code: 'unauthorized' } }; };
  retry.profile.mount({ rect }); retry.buttons[0].tap({ profile: info });
  assert.strictEqual((await retry.profile.pending).reason, 'unauthorized');
  assert.strictEqual(requests, 2, 'profile updates reauthenticate at most once');
  assert.strictEqual(retry.profile.current(), null);
  const refresh = fixture(); let finishRead;
  refresh.api.request = options => options.method === 'GET'
    ? new Promise(resolve => { finishRead = resolve; }) : Promise.resolve({ ok: true, data: {} });
  const loading = refresh.profile.refresh(); await Promise.resolve();
  refresh.profile.mount({ rect }); refresh.buttons[0].tap({ profile: info }); await refresh.profile.pending;
  finishRead({ ok: true, data: { profile: { nickname: 'old', avatarUrl: info.avatarUrl } } });
  assert.strictEqual((await loading).reason, 'stale');
  assert.notStrictEqual(refresh.profile.current().nickname, 'old', 'a delayed account read cannot overwrite a just-authorized profile');

  // Actual adapter returns only optional display data, never encrypted data.
  const raw = {}; const native = { onTap(fn) { raw.tap = fn; }, offTap(fn) { raw.off = fn; }, destroy() {}, show() {}, hide() {} };
  const adapter = Object.create(WechatPlatform.prototype);
  adapter.api = { createUserInfoButton(options) { raw.options = options; return native; } };
  const wrapped = adapter.createUserInfoButton({ style: rect, withCredentials: true }); let received;
  wrapped.onTap(result => { received = result; });
  raw.tap({ userInfo: { nickName: '玩家', avatarUrl: info.avatarUrl }, encryptedData: 'private', iv: 'private' });
  assert.deepStrictEqual(received, { profile: { nickname: '玩家', avatarUrl: info.avatarUrl } });
  assert.strictEqual(raw.options.withCredentials, false); wrapped.offTap(); assert.strictEqual(raw.off, raw.tap);
  adapter.api = {}; assert.strictEqual((await adapter.openPrivacyContract()).reason, 'not-supported');

  let userInfoReads = 0;
  adapter.api = {
    getSetting(options) { options.success({ authSetting: { 'scope.userInfo': false } }); },
    getUserInfo() { userInfoReads++; }
  };
  assert.strictEqual((await adapter.getAuthorizedUserInfo()).reason, 'not-authorized');
  assert.strictEqual(userInfoReads, 0, 'a denied permission cannot read user information');
  adapter.api.getSetting = options => options.success({ authSetting: { 'scope.userInfo': true } });
  adapter.api.getUserInfo = options => {
    userInfoReads++;
    assert.strictEqual(options.withCredentials, false);
    options.success({ userInfo: { nickName: '微信玩家', avatarUrl: info.avatarUrl }, encryptedData: 'private' });
  };
  assert.deepStrictEqual(await adapter.getAuthorizedUserInfo(), {
    ok: true, profile: { nickname: '微信玩家', avatarUrl: info.avatarUrl }
  });
  assert.strictEqual(userInfoReads, 1);

  const display = fixture();
  display.profile.config = { displayOnly: true };
  let finishDisplayRead;
  display.platform.getAuthorizedUserInfo = () => new Promise(resolve => { finishDisplayRead = resolve; });
  const oldRead = display.profile.refresh();
  await Promise.resolve();
  assert(display.profile.mount({ rect }).ok);
  display.buttons[0].tap({ profile: info });
  await display.profile.pending;
  finishDisplayRead({ ok: true, profile: { nickname: '旧头像', avatarUrl: info.avatarUrl } });
  assert.strictEqual((await oldRead).reason, 'stale');
  assert.strictEqual(display.profile.current().nickname.length, 32);
  assert.strictEqual(display.calls.length, 0, 'display-only authorization never uploads the profile');
  assert.strictEqual(display.loginCalls(), 0, 'display-only authorization needs no HTTP login');
  display.platform.getAuthorizedUserInfo = async () => ({ ok: false, reason: 'not-authorized' });
  assert.strictEqual((await display.profile.refresh()).reason, 'not-authorized');
  assert.strictEqual(display.profile.current(), null, 'revoked permission removes the displayed profile');
  display.profile.dispose();
}
run.fixture = fixture;
module.exports = run;
