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
};
