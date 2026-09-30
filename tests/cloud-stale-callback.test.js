'use strict';

const assert = require('assert');
const App = require('../src/app.js');
const Platform = require('../src/platform/wechat.js');
const SyncStore = require('../src/services/sync-store.js');
const Progress = require('../src/services/progress-store.js');
const ProgressSync = require('../src/services/progress-sync-service.js');
const ApiClient = require('../src/services/api-client.js');
const Sessions = require('../src/services/session-store.js');
const Auth = require('../src/services/auth-service.js');
const { fakeApi } = require('./account-bootstrap.test.js');
const { RewardPlatform } = require('./helpers/reward-fixture.js');
const { fixture, response } = require('./cloud-session-migration.test.js');
const { operation } = require('./cloud-account-scope.test.js');
const { canonical } = require('../src/services/sync-payload.js');
const tick = () => new Promise(resolve => setImmediate(resolve));

function knownCloudCache(f) {
  // A future already-bound local cache fixture, not a production migration.
  assert(f.syncStore.activateScope('player_A', 1).ok);
  f.syncStore.state.localOwnerId = 'player_A'; assert(f.syncStore.save());
  f.app.captureAccountContext();
  return f;
}

async function run() {
  const noToken = fixture();
  assert.strictEqual((await noToken.app.applyAuthoritativeState(response(noToken.syncStore))).reason, 'account-mismatch');
  assert.strictEqual(noToken.app.progress.isCompleted(0, 0), false); noToken.app.dispose();
  for (const phase of ['read', 'ack']) {
    const platform = new RewardPlatform(); const store = new SyncStore(platform); const progress = new Progress(platform);
    assert(store.bindLegacyUser('alice')); let user = 'alice'; let finish; let batch;
    const api = { isConfigured: () => true, request: options => {
      if (options.path === ApiClient.PATHS.operations) batch = options.body.operations;
      if ((phase === 'read' && options.path === ApiClient.PATHS.progress) ||
          (phase === 'ack' && options.path === ApiClient.PATHS.operations)) return new Promise(resolve => { finish = resolve; });
      return Promise.resolve({ ok: true, data: { revision: 1, snapshot: { schemaVersion: 1, levels: {} } } });
    } };
    const service = new ProgressSync(api, progress, store, { current: () => ({ userId: user }) }, { enabled: false });
    progress.recordCompletion(0, 1, 100); assert(store.enqueue(operation().payload));
    service.config.enabled = true; const pending = service.flush(); await tick(); assert(finish);
    user = 'bob'; assert(store.activateScope(SyncStore.legacyOwnerId('bob'), 0).ok);
    const before = canonical(platform.storage); const a = store.scopeFor(SyncStore.legacyOwnerId('alice'));
    finish({ ok: true, data: phase === 'read' ? { revision: 1, snapshot: { schemaVersion: 1,
      levels: { '0:0': { completed: true, bestMs: 1 } } } } : { revision: 2, acceptedOperationIds: batch.map(item => item.operationId) } });
    assert.strictEqual((await pending).reason, 'account-mismatch');
    assert.strictEqual(canonical(platform.storage), before, 'late response/ACK cannot write B metadata or any domain');
    assert.deepStrictEqual(store.scopeFor(SyncStore.legacyOwnerId('alice')), a);
    assert.strictEqual(progress.isCompleted(0, 0), false);
  }

  for (const kind of ['owner', 'epoch', 'generation', 'current']) {
    const f = knownCloudCache(fixture());
    let token = f.app.captureAccountContext(); const reply = response(f.syncStore);
    if (kind === 'owner') assert(f.syncStore.activateScope('player_B', 1).ok);
    if (kind === 'epoch') {
      assert(f.syncStore.activateScope('player_A', 2).ok);
      // Isolate the epoch check from the activation/generation checks.
      token = Object.assign(f.app.captureAccountContext(), { bindingEpochAtStart: 1 });
    }
    if (kind === 'generation') f.app.accountGeneration++;
    const before = canonical(f.native.storage);
    const result = await f.app.applyAuthoritativeState(reply, token);
    if (kind === 'current') {
      assert(result.ok); assert(f.app.progress.isCompleted(0, 0));
    } else {
      assert.strictEqual(result.reason, 'account-mismatch'); assert.strictEqual(canonical(f.native.storage), before);
      assert.strictEqual(f.app.progress.isCompleted(0, 0), false);
    }
    f.app.dispose();
  }

  // Actual AdsService close callback -> actual EngagementService commit
  // boundary -> actual RewardUnlockService. An App-only UI check is too late.
  for (const kind of ['owner', 'epoch', 'generation', 'current']) {
    const native = fakeApi(); let close;
    native.createRewardedVideoAd = () => ({ onClose(fn) { close = fn; }, onError() {},
      show: () => Promise.resolve(), load: () => Promise.resolve(), offClose() {}, offError() {}, destroy() {} });
    const platform = new Platform(native); const syncStore = new SyncStore(platform);
    assert(syncStore.activateScope('player_A', 1).ok); syncStore.state.localOwnerId = 'player_A'; assert(syncStore.save());
    const app = new App(platform, { syncStore, adConfig: { rewarded: { rewardUnlock: 'test-ad' },
      rules: { rewardUnlockRewardedEnabled: true, hintMode: 'free' } } });
    app.scene = 'themes'; assert(app.openRewardDialog('theme:ocean'));
    const task = app.requestRewardUnlock(); await tick(); assert(close);
    if (kind === 'owner') assert(syncStore.activateScope('player_B', 1).ok);
    if (kind === 'epoch') assert(syncStore.activateScope('player_A', 2).ok);
    if (kind === 'generation') app.accountGeneration++;
    const before = canonical(app.rewardUnlocks.state);
    close({ isEnded: true }); const result = await task;
    if (kind === 'current') { assert(result.ok); assert(app.rewardUnlocks.owned('theme:ocean')); }
    else {
      assert.strictEqual(result.ok, false); assert.strictEqual(app.rewardUnlocks.owned('theme:ocean'), false);
      assert.strictEqual(canonical(app.rewardUnlocks.state), before);
    }
    app.dispose();
  }

  const migration = knownCloudCache(fixture());
  const prepared = migration.app.prepareLegacyMigration(); assert(prepared.ok);
  const token = migration.app.captureAccountContext(); const reply = response(migration.syncStore);
  let finish;
  const pending = new Promise(resolve => { finish = resolve; }).then(value => migration.app.applyAuthoritativeState(value, token));
  assert(migration.syncStore.activateScope('player_B', 1).ok);
  const before = canonical(migration.native.storage);
  finish(reply); assert.strictEqual((await pending).reason, 'account-mismatch');
  assert.strictEqual(migration.syncStore.state.activeOwnerId, 'player_B');
  assert.strictEqual(canonical(migration.native.storage), before);
  assert.strictEqual(migration.syncStore.scopeFor('player_A').migration, null,
    'building a migration snapshot never freezes or assigns an import before the server accepts prepare');
  migration.app.dispose();

  const network = knownCloudCache(fixture()); const sessions = new Sessions(network.platform);
  assert(sessions.set({ schemaVersion: 1, userId: 'alice', accessToken: 'test-token', issuedAt: Date.now(), expiresAt: Date.now() + 90000 }));
  const api = new ApiClient(network.platform, sessions, { enabled: true, baseUrl: 'https://example.test' });
  api.accountGuard = network.app.accountGuard;
  network.platform.request = () => new Promise(resolve => { finish = resolve; });
  const reading = api.request({ path: ApiClient.PATHS.me, auth: true });
  assert(network.syncStore.activateScope('player_B', 1).ok);
  finish({ ok: true, statusCode: 200, data: { profile: { nickname: 'A' } } });
  assert.strictEqual((await reading).error.code, 'account-mismatch');
  assert.strictEqual(sessions.current().userId, 'alice', 'rejecting stale output does not erase old credentials');
  network.app.dispose();

  const changedIdentity = fixture(); assert(changedIdentity.syncStore.bindLegacyUser('alice'));
  let identity = 'alice';
  changedIdentity.app.auth = { current: () => ({ userId: identity }) };
  changedIdentity.app.captureAccountContext();
  identity = 'bob';
  assert.strictEqual(changedIdentity.app.accountGuard.matches(changedIdentity.app.captureAccountContext()), false,
    'a new identity cannot use A data even if the active scope has not yet changed');
  const blockedApi = new ApiClient(changedIdentity.platform, { current: () => ({ userId: 'bob', accessToken: 'test' }) },
    { enabled: true, baseUrl: 'https://example.test' });
  blockedApi.accountGuard = changedIdentity.app.accountGuard;
  let sent = 0; changedIdentity.platform.request = async () => { sent++; return {}; };
  assert.strictEqual((await blockedApi.request({ method: 'PATCH', path: ApiClient.PATHS.profile, auth: true, body: {} })).error.code, 'account-mismatch');
  assert.strictEqual(sent, 0); changedIdentity.app.dispose();

  const metadataChange = knownCloudCache(fixture());
  const metadataSessions = new Sessions(metadataChange.platform);
  const metadata = { schemaVersion: 2, mode: 'cloud', ownerId: 'player_A', bindingEpoch: 1,
    environmentId: 'test-fixture', migrationState: 'none', migrationImportId: null, migrationReceiptId: null };
  assert(metadataSessions.set(metadata));
  metadataChange.app.auth = { sessions: metadataSessions, mode: 'cloud', current: () => null };
  const oldIdentity = metadataChange.app.captureAccountContext();
  assert(metadataSessions.set(Object.assign({}, metadata, { bindingEpoch: 2 })));
  assert.strictEqual((await metadataChange.app.applyAuthoritativeState(response(metadataChange.syncStore), oldIdentity)).reason, 'account-mismatch',
    'new Cloud identity metadata invalidates old callbacks before the scope is reactivated');
  assert.strictEqual(metadataChange.app.progress.isCompleted(0, 0), false); metadataChange.app.dispose();

  // A normal same-user HTTP 401 retry is not an account switch. Exercise the
  // real App + ApiClient + AuthService + scoped ProgressSync composition.
  const native = fakeApi(); const platform = new Platform(native);
  const queue = new SyncStore(platform); const local = new Progress(platform); const sessions2 = new Sessions(platform);
  const http = new ApiClient(platform, sessions2, { enabled: true, baseUrl: 'https://example.test' });
  let logins = 0; let reads = 0;
  platform.login = async () => { logins++; return { code: 'fixture-code' }; };
  platform.request = async options => {
    if (options.url.endsWith(ApiClient.PATHS.auth)) return { ok: true, statusCode: 200,
      data: { user: { id: 'alice' }, session: { accessToken: 'test-' + logins, issuedAt: Date.now(), expiresAt: Date.now() + 90000 } } };
    if (reads++ === 0) return { ok: true, statusCode: 401, data: {} };
    return { ok: true, statusCode: 200, data: options.url.endsWith(ApiClient.PATHS.operations)
      ? { revision: 2, acceptedOperationIds: options.data.operations.map(item => item.operationId) }
      : { revision: 1, snapshot: { schemaVersion: 1, levels: {} } } };
  };
  const auth = new Auth(platform, http, sessions2, queue, { enabled: true });
  const sync = new ProgressSync(http, local, queue, auth, { enabled: true });
  const composed = new App(platform, { auth, progressSync: sync, syncStore: queue, progress: local });
  assert((await composed.resumeOnline()).ok); assert.strictEqual(logins, 2);
  assert.strictEqual(queue.state.boundUserId, 'alice'); composed.dispose();

  // A scope commit revokes the mounted home profile button immediately,
  // before its old callback can apply stale player information.
  const profileFixture = require('./profile-service.test.js').fixture();
  const profilePlatform = new Platform(fakeApi()); const profileQueue = new SyncStore(profilePlatform);
  assert(profileQueue.bindLegacyUser('user1')); profileFixture.platform.metrics = profilePlatform.metrics;
  profileFixture.profile.config = { displayOnly: true };
  profileFixture.auth.mode = 'cloud';
  const profileApp = new App(profilePlatform, { auth: profileFixture.auth, profile: profileFixture.profile, syncStore: profileQueue });
  profileApp.homeProfileButtonNeeded = true;
  assert(profileApp.syncHomeProfileButton());
  const button = profileFixture.buttons[0]; assert(button);
  profileFixture.setUser('user2'); assert(profileQueue.activateScope(SyncStore.legacyOwnerId('user2'), 0).ok);
  assert(button.destroyed);
  assert.strictEqual(profileApp.homeProfileButtonMounted, false);
  button.tap({ profile: { nickname: 'old A', avatarUrl: 'https://example.test/a.png' } });
  await tick(); assert.strictEqual(profileFixture.profile.current(), null); profileApp.dispose();
}

module.exports = run;
