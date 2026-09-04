'use strict';

const assert = require('assert');
const vm = require('vm');
const SyncStore = require('../src/services/sync-store.js');
const Rewards = require('../src/services/reward-unlock-service.js');
const ApiClient = require('../src/services/api-client.js');
const { fakeApi } = require('./account-bootstrap.test.js');
const { fixture, envelope, business, tick, clone } = require('./helpers/cloud-readonly-fixture.js');

module.exports = async function run() {
  const native = fakeApi(); const rewards = Rewards.emptyState(); rewards.balance = 10000;
  native.storage[Rewards.STORAGE_KEY] = rewards;
  const f = fixture({ native, paused: new Set(['state.read']) });
  try {
    const before = business(f);
    assert(f.sync.enqueue({ levelKey: '0:0', completedAtClient: 1, elapsedMs: 10 }));
    const guest = clone(f.sync.scopeFor(null)); const run = f.app.resumeOnline(); await tick();
    assert.strictEqual(f.auth.state(), 'authenticated'); assert.strictEqual(f.app.progressSync.status, 'cloud-reading');
    assert.strictEqual(business(f), before); assert.deepStrictEqual(f.sync.scopeFor(null), guest);
    const call = f.waits.shift();
    assert.deepStrictEqual(Object.keys(call.data.payload).sort(), ['bindingEpoch', 'claimedPlayerId', 'environmentId', 'knownRevisions']);
    call.success({ result: f.reply(call.data) }); assert((await run).ok);
    assert.strictEqual(f.app.progressSync.status, 'cloud-readonly'); assert.strictEqual(business(f), before);
    assert.deepStrictEqual(f.sync.scopeFor(null), guest); assert(f.sync.currentScope().readOnlySummary);
    assert.deepStrictEqual(f.sync.currentScope().revisions, call.data.payload.knownRevisions);
    assert.strictEqual(f.app.accountMessage, '云身份／只读测试，本地存档未上传');
    assert.strictEqual(f.app.rewardUnlocks.authorityMode(), 'legacy-local'); assert.strictEqual(f.app.stamina.authorityMode(), 'legacy-local');
    assert(f.app.openRewardDialog('theme:desserts')); assert((await f.app.requestRewardUnlock()).ok);
    assert.strictEqual(f.app.rewardUnlocks.view().balance, 0); assert(f.app.rewardUnlocks.owned('theme:desserts'));
    assert(f.app.openLevel(0, 0)); const runner = f.app.runner;
    runner.touchStart(0); [1, 2, 3, 4].forEach(cell => runner.touchMove(cell)); runner.touchEnd(4);
    f.app.onPathCompleted(0, [0, 1, 2, 3, 4]);
    assert(f.app.progress.isCompleted(0, 0)); assert.strictEqual(f.app.rewardUnlocks.view().balance, 100);
    assert.strictEqual(f.app.stamina.snapshot().balance, 5);
    assert.strictEqual(f.sync.scopeFor(null).pendingOperations.length, 2, 'new local play stays in the original local outbox');
    assert.strictEqual(f.sync.currentScope().pendingOperations.length, 0);
    assert.deepStrictEqual(f.calls.map(x => x.data.action), ['identity.init', 'state.read']);
  } finally { f.app.dispose(); }

  const mutations = [
    value => { value.data.changedDomains.progress = { completed: ['0:0'] }; },
    value => { value.balance = 10000; },
    value => { value.player.balance = 10000; },
    value => { value.data.stamina = 999; },
    value => { value.revisions.progress = 1; },
    value => { value.player.migrationState = 'complete'; },
    value => { value.player.playerId = 'player_B'; },
    value => { value.player.bindingEpoch = 2; },
    value => { value.environmentId = 'other-test'; },
    value => { value.serverDateKey = '2026-09-03'; },
    value => { value.protocolVersion = 2; },
    value => { value.data.hasCloudState = true; },
    value => { value.acceptedOperationIds = ['fake']; }
  ];
  for (const mutate of mutations) {
    const g = fixture({ paused: new Set(['state.read']) });
    try {
      const task = g.app.resumeOnline(); await tick(); const call = g.waits.shift();
      const before = business(g); const disk = JSON.stringify(g.native.storage); const response = g.reply(call.data); mutate(response);
      call.success({ result: response }); assert.strictEqual((await task).reason, 'invalid-response');
      assert.strictEqual(business(g), before); assert.strictEqual(JSON.stringify(g.native.storage), disk);
      assert.strictEqual(g.sync.currentScope().readOnlySummary, undefined); assert(g.app.openLevel(0, 0));
    } finally { g.app.dispose(); }
  }

  for (const kind of ['owner', 'epoch', 'environment', 'generation']) {
    const g = fixture({ paused: new Set(['state.read']) });
    try {
      const task = g.app.resumeOnline(); await tick(); const call = g.waits.shift();
      if (kind === 'generation') g.auth.clear();
      else assert(g.sync.activateScope(kind === 'owner' ? 'player_B' : 'player_A', kind === 'epoch' ? 2 : 1,
        kind === 'environment' ? 'other-test' : 'test-fixture', true).ok);
      const disk = JSON.stringify(g.native.storage); g.app.progressSync.status = 'new-account-state'; g.app.accountMessage = 'new-account-ui';
      call.success({ result: envelope(call.data) }); assert.strictEqual((await task).reason, 'account-mismatch');
      assert.strictEqual(JSON.stringify(g.native.storage), disk); assert.strictEqual(g.app.progressSync.status, 'new-account-state');
      assert.strictEqual(g.app.accountMessage, 'new-account-ui');
    } finally { g.app.dispose(); }
  }

  const g = fixture({ paused: new Set(['state.read']) });
  try {
    const task = g.app.resumeOnline(); await tick(); const call = g.waits.shift(); const before = clone(g.sync.currentScope());
    const write = g.native.setStorageSync;
    g.native.setStorageSync = (key, value) => { if (key === SyncStore.STORAGE_KEY) throw Error('full'); write(key, value); };
    call.success({ result: g.reply(call.data) }); assert.strictEqual((await task).reason, 'persist-failed');
    assert.notStrictEqual(g.app.progressSync.status, 'cloud-readonly'); assert.deepStrictEqual(g.sync.currentScope(), before);
  } finally { g.app.dispose(); }

  for (const version of ['release', 'unknown']) {
    const h = fixture({ version });
    try { assert.strictEqual((await h.app.resumeOnline()).reason, 'not-configured'); assert.strictEqual(h.calls.length, 0);
      assert.deepStrictEqual(h.native.events, ['frame']); assert(h.app.openLevel(0, 0));
    } finally { h.app.dispose(); }
  }
  for (const flag of ['writeEnabled', 'migrationEnabled', 'economyEnabled', 'staminaEnabled', 'preferencesEnabled']) {
    const h = fixture({ config: { [flag]: true } });
    try { assert.strictEqual((await h.app.resumeOnline()).reason, 'not-configured'); assert.strictEqual(h.calls.length, 0); }
    finally { h.app.dispose(); }
  }
  for (const action of ['identity.init', 'state.read']) {
    for (const failure of ['network', 'timeout', 'invalid-response', 'ACCOUNT_BINDING_MISMATCH']) {
      const h = fixture({ paused: new Set([action]) });
      try {
        const task = h.app.resumeOnline(); await tick(); const call = h.waits.shift(); const before = business(h);
        if (failure === 'network' || failure === 'timeout') call.fail({ errMsg: failure === 'timeout' ? 'timeout' : 'unavailable' });
        else call.success({ result: failure === 'invalid-response' ? {} : { ok: false, code: failure, requestId: call.data.requestId } });
        assert.strictEqual((await task).reason, failure); assert.strictEqual(business(h), before); assert(h.app.openLevel(0, 0));
      } finally { h.app.dispose(); }
    }
  }
  const h = fixture({ initFail: true });
  try { assert.strictEqual((await h.app.resumeOnline()).reason, 'cloud-init-failed'); assert(h.app.openLevel(0, 0)); }
  finally { h.app.dispose(); }
  const crossRealm = fixture();
  try {
    crossRealm.reply = request => vm.runInNewContext('JSON.parse(payload)', { payload: JSON.stringify(envelope(request)) });
    const before = business(crossRealm);
    assert.notStrictEqual(Object.getPrototypeOf(crossRealm.reply({ action: 'state.read', requestId: 'req_test' })), Object.prototype);
    assert((await crossRealm.app.resumeOnline()).ok, 'native SDK foreign-realm envelopes must persist only local diagnostic projections');
    assert(crossRealm.sync.currentScope().readOnlySummary); assert.strictEqual(business(crossRealm), before);
  } finally { crossRealm.app.dispose(); }
  assert.strictEqual(ApiClient.validateReadOnlyEnvelope({}, 'test-fixture'), false);
};
