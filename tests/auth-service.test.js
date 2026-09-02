'use strict';
const assert = require('assert');
const AuthService = require('../src/services/auth-service.js');
const ApiClient = require('../src/services/api-client.js');
const SessionStore = require('../src/services/session-store.js');
const SyncStore = require('../src/services/sync-store.js');
module.exports = async function run() {
  const storage = {}; let logins = 0;
  const platform = { getStorage: key => storage[key], setStorage(key, value) { storage[key] = value; return true; },
    login: async () => { logins++; return { code: 'one-time' }; },
    request: async () => ({ ok: true, statusCode: 200, data: { user: { id: 'usr_1' }, session: { accessToken: 'token', issuedAt: Date.now(), expiresAt: Date.now() + 100000 } } }) };
  const sessions = new SessionStore(platform);
  const api = new ApiClient(platform, sessions, { enabled: true, baseUrl: 'https://example.test' });
  const auth = new AuthService(platform, api, sessions, new SyncStore(platform), { enabled: true });
  const a = auth.ensureSession(); const b = auth.ensureSession();
  assert.strictEqual(a, b); assert((await a).ok); await b;
  assert.strictEqual(logins, 1); assert.strictEqual(auth.current().userId, 'usr_1');
  assert.strictEqual(JSON.stringify(storage).includes('one-time'), false);
  await auth.ensureSession(); assert.strictEqual(logins, 1);
  auth.clear(); platform.login = async () => { throw { reason: 'timeout' }; };
  assert.strictEqual((await auth.ensureSession()).reason, 'timeout');
  assert.strictEqual(auth.state(), 'offline');
};
