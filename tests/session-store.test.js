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

  const v1 = { schemaVersion: 1, userId: 'usr_1', accessToken: 'token', issuedAt: 500, expiresAt: 90000 };
  value = JSON.parse(JSON.stringify(v1));
  let writes = 0; let fail = false; let throws = false;
  platform.setStorage = (key, next) => {
    writes++; if (throws) throw Error('disk'); if (fail) return false;
    value = JSON.parse(JSON.stringify(next)); return true;
  };
  const loaded = new SessionStore(platform, () => 1000);
  assert.deepStrictEqual(loaded.current(), v1); assert.deepStrictEqual(value, v1);
  assert.strictEqual(writes, 0, 'reading v1 does not migrate or rewrite a real session');
  const metadata = { schemaVersion: 2, mode: 'legacy-http', ownerId: null, bindingEpoch: 0,
    environmentId: null, migrationState: 'none', migrationImportId: null, migrationReceiptId: null };
  fail = true;
  assert.strictEqual(loaded.set(metadata), false); assert.strictEqual(loaded.lastError, 'persist-failed');
  assert.deepStrictEqual(loaded.current(), v1); assert.deepStrictEqual(value, v1);
  assert.strictEqual(loaded.set(Object.assign({}, v1, { accessToken: 'lost' })), false);
  throws = true;
  assert.strictEqual(loaded.set(metadata), false); assert.deepStrictEqual(loaded.current(), v1);
  fail = false; throws = false;
  assert(loaded.set(metadata)); assert.deepStrictEqual(value.legacySession, v1);
  assert.strictEqual(value.installId, undefined, 'SyncStore is the sole installId authority');
  const upgraded = new SessionStore(platform, () => 1000);
  assert.deepStrictEqual(upgraded.current(), v1);
  upgraded.metadata().legacySession.accessToken = 'changed';
  assert.strictEqual(upgraded.current().accessToken, 'token');
  upgraded.clear(); assert.strictEqual(upgraded.current(), null);
  assert(upgraded.set(v1), 'v2 HTTP metadata supports reauthentication after a 401');
  assert.strictEqual(value.schemaVersion, 2); assert.strictEqual(value.legacySession.accessToken, 'token');

  const cloud = Object.assign({}, metadata, { mode: 'cloud', ownerId: 'player_test', bindingEpoch: 1,
    environmentId: 'test-fixture' });
  for (const bad of [{ ownerId: '../alice' }, { ownerId: '__proto__' }, { ownerId: 'usr_1' }, { ownerId: null },
    { bindingEpoch: 0 }, { bindingEpoch: -1 }, { bindingEpoch: 1.1 }, { environmentId: '' },
    { migrationImportId: '../bad' }, { migrationReceiptId: 'bad id' }, { migrationId: 'unexpected' },
    { migrationState: 'complete' }, { migrationState: 'unknown' }, { legacySession: {} },
    { installId: 'ins_duplicate' }, { accessToken: 'private' }, { openid: 'private' }, { session_key: 'private' }, { AppSecret: 'private' }]) {
    const candidate = Object.assign({}, cloud, bad);
    const before = JSON.stringify(value);
    assert.strictEqual(upgraded.set(candidate), false, JSON.stringify(bad));
    assert.strictEqual(JSON.stringify(value), before);
    const corrupt = new SessionStore({ getStorage: () => candidate, setStorage() { throw Error('must not erase ownership'); } });
    assert.strictEqual(corrupt.current(), null); assert.strictEqual(corrupt.metadata(), null);
    assert.strictEqual(corrupt.set(v1), false); assert.strictEqual(corrupt.clear(), false);
  }
  assert(upgraded.set(cloud)); assert.strictEqual(upgraded.current(), null, 'cloud metadata is not a legacy credential');
  assert.deepStrictEqual(value.legacySession, v1, 'an explicit metadata upgrade preserves the prior token');
  assert.strictEqual(upgraded.clear(), false); assert.strictEqual(upgraded.set(v1), false);
  const complete = Object.assign({}, cloud, { migrationState: 'complete', migrationImportId: 'mig_test', migrationReceiptId: 'receipt_test' });
  fail = true; assert.strictEqual(upgraded.set(complete), false);
  assert.strictEqual(upgraded.metadata().migrationState, 'none');
  fail = false; assert(upgraded.set(complete));
  assert.deepStrictEqual(new SessionStore(platform).metadata(), upgraded.metadata());
  const expired = new SessionStore(platform, () => 100000);
  assert.strictEqual(expired.current(), null); assert.deepStrictEqual(expired.metadata().legacySession, v1);
  value = null;
  const guest = new SessionStore(platform, () => 1000);
  assert(guest.set(Object.assign({}, metadata, { mode: 'guest' })));
  assert.strictEqual(guest.current(), null); assert.strictEqual(guest.metadata().ownerId, null);
};
