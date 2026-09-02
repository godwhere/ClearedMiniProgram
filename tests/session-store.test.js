'use strict';
const assert = require('assert');
const SessionStore = require('../src/services/session-store.js');
module.exports = function run() {
  let value = '{bad';
  const platform = { getStorage: () => value, setStorage: (key, next) => { value = next; return true; } };
  const store = new SessionStore(platform, () => 1000);
  assert.strictEqual(value, null);
  assert.strictEqual(store.current(), null);
  assert.strictEqual(store.set({ schemaVersion: 1, userId: 'usr_1', accessToken: 'token', issuedAt: 500, expiresAt: 31000 }), false);
  assert(store.set({ schemaVersion: 1, userId: 'usr_1', accessToken: 'token', issuedAt: 500, expiresAt: 32000, openid: 'discard' }));
  assert.strictEqual(value.openid, undefined);
  assert.strictEqual(store.current().userId, 'usr_1');
  store.current().userId = 'other'; assert.strictEqual(store.current().userId, 'usr_1');
  store.clear(); assert.strictEqual(store.current(), null);
};
