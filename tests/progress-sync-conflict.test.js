'use strict';
const assert = require('assert');
const Sync = require('../src/services/progress-sync-service.js');
const Store = require('../src/services/sync-store.js');
const Progress = require('../src/services/progress-store.js');
const ApiClient = require('../src/services/api-client.js');
const Sessions = require('../src/services/session-store.js');
const Auth = require('../src/services/auth-service.js');

function fixture() {
  const storage = {}; const calls = []; let failStorage = false;
  const platform = { getStorage: key => storage[key], setStorage(key, value) { if (failStorage) return false; storage[key] = JSON.parse(JSON.stringify(value)); return true; } };
  const progress = new Progress(platform); const store = new Store(platform);
  let userId = 'u1'; let reauth = 0;
  const auth = { current: () => userId ? { userId } : null, ensureSession: async () => { reauth++; userId = 'u1'; return { ok: true }; } };
  const remote = { revision: 1, snapshot: { schemaVersion: 1, levels: {} } };
  const api = { isConfigured: () => true, async request(opts) {
    calls.push(JSON.parse(JSON.stringify(opts)));
    if (opts.path === ApiClient.PATHS.operations) return { ok: true, data: { revision: 2, acceptedOperationIds: opts.body.operations.map(item => item.operationId) } };
    return { ok: true, data: remote };
  } };
  return { platform, progress, store, auth, remote, api, calls,
    service: new Sync(api, progress, store, auth, { enabled: true }),
    user: value => { userId = value; }, reauth: () => reauth, failStorage: value => { failStorage = value; } };
}

module.exports = async function run() {
  const f = fixture(); f.progress.recordCompletion(0, 0, 200);
  f.remote.snapshot.levels = { '0:0': { completed: false, bestMs: 100 }, '0:1': { completed: true, bestMs: 300 } };
  const before = JSON.stringify({ settings: f.progress.state.settings, stats: f.progress.state.stats, last: f.progress.state.lastPlayed });
  const first = f.service.bootstrap(f.auth.current()); assert.strictEqual(first, f.service.flush()); assert((await first).ok);
  assert.strictEqual(f.progress.isCompleted(0, 0), true); assert.strictEqual(f.progress.bestTime(0, 0), 100);
  assert.strictEqual(f.progress.isCompleted(0, 1), true);
  assert.strictEqual(JSON.stringify({ settings: f.progress.state.settings, stats: f.progress.state.stats, last: f.progress.state.lastPlayed }), before);
  assert.strictEqual(f.store.state.boundUserId, 'u1');
  await f.service.flush(); assert.strictEqual(f.calls.filter(c => c.path === ApiClient.PATHS.bootstrap).length, 1);
  const count = f.calls.length; f.user('u2'); assert.strictEqual((await f.service.flush()).reason, 'account-mismatch'); assert.strictEqual(f.calls.length, count);

  const retry = fixture(); let attempts = 0; const request = retry.api.request;
  retry.api.request = async options => { if (!attempts++) { retry.calls.push(JSON.parse(JSON.stringify(options))); return ApiClient.failure('timeout', 0, true); } return request(options); };
  assert((await retry.service.flush()).ok);
  assert.deepStrictEqual(retry.calls[0].body, retry.calls[1].body);
  assert.strictEqual(new Store(retry.platform).state.migrationId, retry.store.state.migrationId);

  const changed = fixture(); changed.api.request = async () => { changed.user('u2'); return { ok: true, data: { revision: 5, snapshot: { schemaVersion: 1, levels: { '0:0': { completed: true } } } } }; };
  assert.strictEqual((await changed.service.flush()).reason, 'account-mismatch'); assert.strictEqual(changed.progress.isCompleted(0, 0), false);

  const unauthorized = fixture(); unauthorized.api.request = async options => { unauthorized.calls.push(options); unauthorized.user(null); return ApiClient.failure('unauthorized', 401); };
  assert.strictEqual((await unauthorized.service.flush()).reason, 'unauthorized');
  assert.strictEqual(unauthorized.reauth(), 1); assert.strictEqual(unauthorized.calls.length, 2);

  const partial = fixture(); partial.store.state.boundUserId = 'u1';
  partial.service.enqueueCompletion({ setIndex: 0, levelIndex: 0, elapsedMs: 100 });
  await partial.service.inFlight;
  partial.service.config.enabled = false;
  partial.service.enqueueCompletion({ setIndex: 0, levelIndex: 0, elapsedMs: 90 });
  partial.service.enqueueCompletion({ setIndex: 0, levelIndex: 1, elapsedMs: 80 });
  partial.api.request = async opts => opts.path === ApiClient.PATHS.operations
    ? { ok: true, data: { revision: 3, acceptedOperationIds: [opts.body.operations[0].operationId, 'unknown'] } }
    : { ok: true, data: { revision: 2, snapshot: { schemaVersion: 1, levels: {} } } };
  partial.service.config.enabled = true; await partial.service.flush();
  assert.strictEqual(partial.store.state.pendingOperations.length, 1);

  const invalid = fixture(); invalid.remote.revision = '1';
  assert.strictEqual((await invalid.service.flush()).reason, 'invalid-response');
  assert.strictEqual(invalid.store.state.boundUserId, null);
  const disk = fixture(); disk.failStorage(true);
  assert.strictEqual((await disk.service.flush()).reason, 'persist-failed'); assert.strictEqual(disk.calls.length, 0);
  const legacy = fixture(); legacy.store.state.boundUserId = 'u1'; legacy.progress.state.completed['0:0'] = true;
  await legacy.service.flush();
  const legacyOperation = legacy.calls.find(call => call.path === ApiClient.PATHS.operations).body.operations[0];
  assert.strictEqual(legacyOperation.payload.elapsedMs, undefined, 'completion-only legacy saves never fabricate a best time');

  const overflow = fixture(); overflow.service.config.enabled = false;
  for (let i = 0; i < 201; i++) overflow.service.enqueueCompletion({ setIndex: 0, levelIndex: 0, elapsedMs: 100 + i });
  overflow.progress.recordCompletion(0, 1, 80); overflow.service.config.enabled = true;
  assert((await overflow.service.flush()).ok); assert.strictEqual(overflow.store.state.snapshotRequired, true);
  overflow.remote.revision = 2;
  assert((await overflow.service.flush()).ok);
  assert(overflow.calls.some(call => call.path === ApiClient.PATHS.operations && call.body.operations.some(item => item.payload.levelKey === '0:1')));
  const corrupt = fixture();
  corrupt.platform.setStorage(Store.STORAGE_KEY, { schemaVersion: 1, installId: null, migrationId: null, boundUserId: 'previous_user' });
  assert.strictEqual(new Store(corrupt.platform).state.boundUserId, 'previous_user');
  const brokenSequence = fixture(); brokenSequence.store.state.nextOperationSequence = null; brokenSequence.store.save();
  assert.strictEqual(new Store(brokenSequence.platform).nextId(), null, 'corrupt sequences never reuse an already exposed operation ID');

  // Real ApiClient 401 clears the token; one replacement session is acquired.
  const s = fixture(); const sessions = new Sessions(s.platform); let logins = 0; let reads = 0;
  const loginResponse = () => ({ user: { id: 'u1' }, session: { accessToken: `t${logins}`, issuedAt: Date.now(), expiresAt: Date.now() + 90000 } });
  s.platform.login = async () => { logins++; return { code: 'ephemeral' }; };
  s.platform.request = async opts => ({ ok: true, statusCode: opts.url.endsWith('/progress/bootstrap') && reads++ === 0 ? 401 : 200,
    data: opts.url.endsWith('/auth/wechat') ? loginResponse() : s.remote });
  const api = new ApiClient(s.platform, sessions, { enabled: true, baseUrl: 'https://example.test' });
  const auth = new Auth(s.platform, api, sessions, s.store, { enabled: true });
  await auth.ensureSession(); const sync = new Sync(api, s.progress, s.store, auth, { enabled: true });
  assert((await sync.flush()).ok); assert.strictEqual(logins, 2);
};
