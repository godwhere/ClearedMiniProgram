'use strict';
const assert = require('assert');
const ApiClient = require('../src/services/api-client.js');
const SessionStore = require('../src/services/session-store.js');
module.exports = async function run() {
  let calls = 0; let reply = { ok: true, statusCode: 200, data: '{}' }; let request;
  const platform = { getStorage: () => null, setStorage: () => true,
    request: async options => { calls++; request = options; return reply; } };
  const sessions = new SessionStore(platform);
  const api = new ApiClient(platform, sessions, { enabled: false, baseUrl: '' });
  assert.strictEqual((await api.request({ path: ApiClient.PATHS.me })).error.code, 'not-configured');
  assert.strictEqual(calls, 0);
  api.config = { enabled: true, baseUrl: 'https://example.test', timeoutMs: 10 };
  assert.strictEqual((await api.request({ path: 'https://evil.test' })).error.code, 'invalid-request');
  assert.strictEqual((await api.request({ path: '/v1/../private' })).ok, false);
  assert.strictEqual((await api.request({ path: ApiClient.PATHS.me, auth: true })).error.code, 'unauthorized');
  sessions.set({ schemaVersion: 1, userId: 'u1', accessToken: 'secret', issuedAt: Date.now(), expiresAt: Date.now() + 90000 });
  assert((await api.request({ path: ApiClient.PATHS.me, auth: true })).ok);
  assert.strictEqual(request.header.Authorization, 'Bearer secret');
  reply = { ok: true, statusCode: 401, data: {} };
  const before = calls;
  assert.strictEqual((await api.request({ path: ApiClient.PATHS.me, auth: true })).error.code, 'unauthorized');
  assert.strictEqual(calls, before + 1); assert.strictEqual(sessions.current(), null);
  reply = { ok: true, statusCode: 200, data: '{bad' };
  assert.strictEqual((await api.request({ path: ApiClient.PATHS.me })).error.code, 'invalid-json');
  reply = { ok: false, reason: 'timeout' };
  assert.strictEqual((await api.request({ path: ApiClient.PATHS.me })).error.code, 'timeout');

  reply = { ok: true, statusCode: 201, data: { requestId: 'req_1', value: true } };
  const body = { operations: [] };
  assert.deepStrictEqual(await api.request({ method: 'POST', path: ApiClient.PATHS.operations,
    body, idempotencyKey: 'op:test_1', timeoutMs: 123 }),
  { ok: true, statusCode: 201, requestId: 'req_1', data: reply.data });
  assert.deepStrictEqual(request, { url: 'https://example.test/v1/progress/operations:batch',
    method: 'POST', data: body, timeout: 123,
    header: { 'content-type': 'application/json', 'Idempotency-Key': 'op:test_1' } });
  assert.strictEqual((await api.request({ path: ApiClient.PATHS.me, idempotencyKey: 'bad key' })).error.code, 'invalid-request');
  for (const statusCode of [400, 403, 429, 500, 503]) {
    reply = { ok: true, statusCode, data: { requestId: 'req_server', error: { code: 'SERVER_ERROR', message: 'private' } } };
    assert.deepStrictEqual(await api.request({ path: ApiClient.PATHS.me }), { ok: false, statusCode,
      requestId: 'req_server', error: { code: 'SERVER_ERROR', retryable: statusCode >= 500 } });
  }
  reply = { ok: true, statusCode: 302, data: { requestId: 'unsafe id', error: { code: 'raw details' } } };
  assert.deepStrictEqual(await api.request({ path: ApiClient.PATHS.me }), { ok: false, statusCode: 302,
    requestId: null, error: { code: 'backend-rejected', retryable: false } });
  for (const data of ['invalid', '[]', 'null', null, []]) {
    reply = { ok: true, statusCode: 200, data };
    assert.strictEqual((await api.request({ path: ApiClient.PATHS.me })).error.code, 'invalid-json');
  }
  for (const response of [null, { ok: false, reason: 'network' }]) {
    reply = response; const count = calls;
    assert.deepStrictEqual((await api.request({ method: 'POST', path: ApiClient.PATHS.auth })).error,
      { code: 'network', retryable: true });
    assert.strictEqual(calls, count + 1, 'ApiClient never retries POST');
  }
  platform.request = async () => { throw Error('private exception'); };
  assert.strictEqual((await api.request({ path: ApiClient.PATHS.me })).error.code, 'network');
  const v1 = accessToken => ({ schemaVersion: 1, userId: 'u1', accessToken, issuedAt: Date.now(), expiresAt: Date.now() + 90000 });
  sessions.set(v1('old')); let finish;
  platform.request = () => new Promise(resolve => { finish = resolve; });
  const late = api.request({ path: ApiClient.PATHS.me, auth: true });
  sessions.set(v1('replacement')); finish({ ok: true, statusCode: 401, data: {} });
  assert.strictEqual((await late).error.code, 'unauthorized');
  assert.strictEqual(sessions.current().accessToken, 'replacement');

  // Cloud transport consumes only a named protocol message, never HTTP
  // credentials. Phase 3 rejects every old HTTP route in Cloud mode.
  let cloudRequest; let cloudCalls = 0;
  const cloud = new ApiClient(platform, sessions, {}, { transport: {
    isConfigured: () => true, request: async opts => { cloudRequest = opts; cloudCalls++; return { ok: true, data: { player: {} } }; }
  } });
  assert((await cloud.request({ service: 'identity', action: 'identity.init', requestId: 'req_identity',
    payload: { installId: 'ins_test', clientVersion: '1.0.0', code: 'must-not-send', legacySession: v1('private') } })).ok);
  assert.deepStrictEqual(cloudRequest, { service: 'identity', action: 'identity.init', requestId: 'req_identity',
    protocolVersion: 1, timeoutMs: undefined,
    payload: { installId: 'ins_test', clientVersion: '1.0.0', localBinding: undefined } });
  assert.strictEqual((await cloud.request({ path: ApiClient.PATHS.progress, auth: true })).error.code, 'not-configured');
  for (const [method, path] of [['GET', ApiClient.PATHS.progress], ['POST', ApiClient.PATHS.bootstrap],
    ['POST', ApiClient.PATHS.operations], ['POST', ApiClient.PATHS.rewards]]) {
    assert.strictEqual((await cloud.request({ method, path })).error.code, 'not-configured');
  }
  assert.strictEqual((await cloud.request({ path: ApiClient.PATHS.me })).error.code, 'not-configured');
  assert.strictEqual((await cloud.request({ method: 'POST', path: ApiClient.PATHS.auth, body: {} })).error.code, 'not-configured');
  assert.strictEqual((await cloud.request({ service: 'identity', action: 'identity.init' })).error.code, 'invalid-request');
  assert.strictEqual(cloudCalls, 1);
  assert.strictEqual(sessions.current().accessToken, 'replacement', 'cloud failures do not clear legacy tokens');

  const owner = { ownerId: 'player_test', environmentId: 'env_test', bindingEpoch: 1, generation: 1 };
  cloud.cloudSession = () => owner;
  cloud.transport.config = { env: owner.environmentId };
  const knownRevisions = { progress: 3, daily: 0, economy: 1, entitlements: 1, stamina: 2, preferences: 7 };
  assert((await cloud.request({ service: 'playerState', action: 'state.read', requestId: 'req_preferences_upgrade',
    payload: { claimedPlayerId: owner.ownerId, environmentId: owner.environmentId, bindingEpoch: 1, knownRevisions } })).ok);
  assert.strictEqual(cloudRequest.payload.includeClearMode, true);
  assert.deepStrictEqual(cloudRequest.payload.knownRevisions, Object.assign({}, knownRevisions, { preferences: 0 }),
    'upgrade reads restore clearMode even if a legacy snapshot already used the same revision');
  assert.strictEqual(knownRevisions.preferences, 7, 'request projection cannot reset persisted sync revisions');
};
