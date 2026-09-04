'use strict';

const assert = require('assert');
const SessionStore = require('../src/services/session-store.js');
const SyncStore = require('../src/services/sync-store.js');
const { fakeApi } = require('./account-bootstrap.test.js');
const { fixture, envelope, business, tick, clone } = require('./helpers/cloud-readonly-fixture.js');

module.exports = async function run() {
  const f = fixture({ paused: new Set(['identity.init']) });
  try {
    assert.deepStrictEqual(f.native.events, ['frame']);
    assert.strictEqual(f.app.scene, 'home');
    const legacy = { schemaVersion: 1, userId: 'legacy_A', accessToken: 'private-old-token',
      issuedAt: Date.now(), expiresAt: Date.now() + 90000 };
    assert(f.sessions.set(legacy));
    assert(f.sync.enqueue({ levelKey: '0:0', elapsedMs: 20, completedAtClient: 1 }));
    const guest = clone(f.sync.scopeFor(null)); const before = business(f); const sequence = f.sync.state.nextOperationSequence;
    const order = []; const write = f.native.setStorageSync;
    f.native.setStorageSync = (key, value) => { order.push(key); write(key, value); };
    let notifications = 0;
    f.auth.onSessionChanged((session, status) => {
      if (status !== 'authenticated') return;
      notifications++;
      assert.strictEqual(f.native.storage[SessionStore.STORAGE_KEY].ownerId, session.ownerId);
      assert.strictEqual(f.native.storage[SyncStore.STORAGE_KEY].activeOwnerId, session.ownerId);
      assert.strictEqual(f.sync.context().environmentId, 'test-fixture');
    });
    const run = f.app.resumeOnline(); await tick();
    assert.strictEqual(f.calls.length, 1);
    assert.strictEqual(f.auth.ensureSession(), f.auth.inFlight);
    assert.strictEqual((await f.app.progressSync.bootstrapReadOnly()).reason, 'account-mismatch');
    assert.strictEqual(f.calls.length, 1, 'state.read cannot precede identity persistence');
    const call = f.waits.shift();
    assert.strictEqual(JSON.stringify(call.data).includes('private-old-token'), false);
    assert.strictEqual(JSON.stringify(call.data).includes('legacy_A'), false);
    assert(!call.data.requestId.includes(f.sync.state.installId));
    call.success({ result: f.reply(call.data) });
    assert((await run).ok);
    assert.deepStrictEqual(order.slice(0, 2), [SessionStore.STORAGE_KEY, SyncStore.STORAGE_KEY]);
    assert.strictEqual(notifications, 1);
    assert.strictEqual(f.auth.current().ownerId, 'player_A');
    assert.strictEqual(f.auth.current().userId, undefined); assert.strictEqual(f.auth.current().accessToken, undefined);
    assert.deepStrictEqual(f.sessions.metadata().legacySession, legacy);
    assert.strictEqual(f.sessions.metadata().migrationState, 'none');
    assert.deepStrictEqual(f.sync.scopeFor(null), guest); assert.strictEqual(f.sync.state.nextOperationSequence, sequence);
    assert.strictEqual(business(f), before);
    f.paused.clear(); const stored = clone(f.native.storage);
    const restartedNative = fakeApi(); Object.assign(restartedNative.storage, stored);
    const restarted = fixture({ native: restartedNative });
    try { assert.strictEqual(restarted.auth.current(), null); assert((await restarted.app.resumeOnline()).ok);
      assert.strictEqual(restarted.auth.current().ownerId, 'player_A');
      assert.strictEqual(restarted.sync.state.installId, f.sync.state.installId);
    } finally { restarted.app.dispose(); }
  } finally { f.app.dispose(); }

  for (const failingKey of [SessionStore.STORAGE_KEY, SyncStore.STORAGE_KEY]) {
    const g = fixture({ paused: new Set(['identity.init']) });
    try {
      const before = business(g); const guest = clone(g.sync.scopeFor(null)); const original = g.native.setStorageSync;
      g.native.setStorageSync = (key, value) => { if (key === failingKey) throw Error('disk full'); original(key, value); };
      const pending = g.app.resumeOnline(); await tick();
      const call = g.waits.shift(); call.success({ result: g.reply(call.data) });
      assert.strictEqual((await pending).reason, 'persist-failed');
      assert.strictEqual(g.auth.current(), null); assert.notStrictEqual(g.auth.state(), 'authenticated');
      assert.strictEqual(g.sync.context().ownerId, null); assert.deepStrictEqual(g.sync.scopeFor(null), guest);
      assert.deepStrictEqual(g.calls.map(x => x.data.action), ['identity.init']); assert.strictEqual(business(g), before);
      const disk = clone(g.native.storage); const next = fakeApi(); Object.assign(next.storage, disk);
      const recovered = fixture({ native: next });
      try { assert.strictEqual(recovered.auth.current(), null); assert((await recovered.app.resumeOnline()).ok);
        assert.strictEqual(recovered.auth.current().ownerId, 'player_A');
        assert.deepStrictEqual(recovered.sync.scopeFor(null), guest);
      } finally { recovered.app.dispose(); }
    } finally { g.app.dispose(); }
  }

  for (const kind of ['owner', 'epoch', 'environment', 'generation', 'app-generation']) {
    const g = fixture({ paused: new Set(['identity.init']) });
    try {
      const pending = g.app.resumeOnline(); await tick(); const call = g.waits.shift();
      if (kind === 'generation') g.auth.clear();
      else if (kind === 'app-generation') g.app.accountGeneration++;
      else assert(g.sync.activateScope(kind === 'owner' ? 'player_B' : 'player_A', kind === 'epoch' ? 2 : 1,
        kind === 'environment' ? 'other-test' : 'test-fixture', true).ok);
      const before = JSON.stringify(g.native.storage); g.app.accountMessage = 'new-account-message';
      call.success({ result: envelope(call.data) });
      assert.strictEqual((await pending).reason, 'account-mismatch');
      assert.strictEqual(JSON.stringify(g.native.storage), before);
      assert.strictEqual(g.app.accountMessage, 'new-account-message'); assert.strictEqual(g.calls.length, 1);
    } finally { g.app.dispose(); }
  }

  const g = fixture();
  try {
    assert((await g.app.resumeOnline()).ok); const before = JSON.stringify(g.native.storage); const generation = g.auth.generation;
    g.owner = 'player_B';
    assert.strictEqual((await g.app.resumeOnline()).reason, 'account-mismatch');
    assert(g.auth.generation > generation); assert.strictEqual(g.auth.current(), null);
    assert.strictEqual(JSON.stringify(g.native.storage), before, 'detect B without replacing or uploading A');
    assert.strictEqual(g.calls.filter(x => x.data.action === 'state.read').length, 1);
    assert(g.app.openLevel(0, 0));
  } finally { g.app.dispose(); }

  for (const mutate of [value => { value.environmentId = 'other-env'; }, value => { value.player.playerId = 'bad'; },
    value => { value.player.bindingEpoch = 0; }, value => { value.player.hasCloudState = true; },
    value => { value.player.migrationState = 'NONE'; }, value => { value.revisions.economy = 1; },
    value => { value.bindingStatus = 'unknown'; }, value => { value.progress = {}; },
    value => { value.data = { balance: 123 }; }]) {
    const h = fixture({ paused: new Set(['identity.init']) });
    try {
      const task = h.app.resumeOnline(); await tick(); const call = h.waits.shift();
      const response = h.reply(call.data); mutate(response); const disk = JSON.stringify(h.native.storage);
      call.success({ result: response }); assert.strictEqual((await task).reason, 'invalid-response');
      assert.strictEqual(JSON.stringify(h.native.storage), disk); assert.strictEqual(h.auth.current(), null);
      assert.strictEqual(h.calls.length, 1); assert(h.app.openLevel(0, 0));
    } finally { h.app.dispose(); }
  }
};
