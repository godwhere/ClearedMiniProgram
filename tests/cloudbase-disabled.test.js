'use strict';

const assert = require('assert');
const bootstrap = require('../src/bootstrap.js');
const cloudbase = require('../src/config/cloudbase.js');
const backend = require('../src/config/backend.js');
const engagement = require('../src/config/engagement.js');
const rewards = require('../src/services/reward-unlock-service.js');
const { fakeApi } = require('./account-bootstrap.test.js');
const dailySolutions = require('../data/daily-solutions.js');

function completeTraining(app) {
  assert(app.openLevel(0, 0));
  const runner = app.runner;
  assert(runner.touchStart(0));
  [1, 2, 3, 4].forEach(cell => assert(runner.touchMove(cell)));
  runner.touchEnd(4); app.onPathCompleted(0, [0, 1, 2, 3, 4]);
}

function completeDailyLevel(app) {
  const paths = dailySolutions.ByChallengeId[app.daily.challengeId];
  paths.forEach((path, index) => {
    const runner = app.daily.runner;
    assert(runner.touchStart(path[0]));
    path.slice(1).forEach(cell => assert(runner.touchMove(cell)));
    runner.touchEnd(path[path.length - 1]); app.onPathCompleted(index, path);
  });
  if (app.daily.nextLevelAt) app.tick(app.daily.nextLevelAt);
}

module.exports = async function run() {
  assert.strictEqual(cloudbase.enabled, false); assert.strictEqual(cloudbase.env, '');
  assert.strictEqual(backend.enabled, false);
  assert.strictEqual(engagement.auth.enabled, false); assert.strictEqual(engagement.progressSync.enabled, false);
  const oldWx = global.wx;
  try {
    for (const available of [true, false]) {
      const native = fakeApi(); let cloudAccesses = 0; let networkCalls = 0; let app;
      if (available) Object.defineProperty(native, 'cloud', { get() {
        cloudAccesses++; return { init() { throw Error('disabled cloud init'); }, callFunction() { throw Error('disabled cloud request'); } };
      } });
      native.login = native.request = () => { networkCalls++; throw Error('disabled network'); };
      global.wx = native;
      try {
        app = bootstrap.start();
        assert.deepStrictEqual(native.events, ['frame']); assert.strictEqual(app.scene, 'home');
        assert.strictEqual(app.auth.api.transport, null);
        assert.strictEqual(app.stamina.snapshot().balance, 5);
        assert.strictEqual((await app.resumeOnline()).reason, 'not-configured');
        completeTraining(app);
        assert.strictEqual(app.scene, 'result'); assert(app.progress.isCompleted(0, 0));
        assert.strictEqual(app.rewardUnlocks.view().balance, 100);
        assert.strictEqual(app.stamina.snapshot().balance, 5, 'first unlock costs one and quick clear refunds one');
        completeTraining(app);
        assert.strictEqual(app.rewardUnlocks.view().balance, 100);
        assert.strictEqual(app.stamina.snapshot().balance, 5);
        assert(app.openLevel(0, 1)); assert.strictEqual(app.stamina.snapshot().balance, 4);
        assert(app.openLevel(0, 1)); assert.strictEqual(app.stamina.snapshot().balance, 4);

        let now = new Date('2026-08-31T15:59:00.000Z'); app.dailyClock = () => now;
        assert(app.enterDaily()); const dateKey = app.daily.dateKey;
        const entries = app.dailyProgress.getDay(dateKey).entriesUsed;
        const stamina = app.stamina.snapshot(now).balance;
        completeDailyLevel(app);
        assert.strictEqual(app.daily.levelIndex, 1); assert.strictEqual(app.rewardUnlocks.view().balance, 100);
        now = new Date('2026-08-31T16:01:00.000Z');
        completeDailyLevel(app);
        assert.strictEqual(app.scene, 'dailyResult'); assert.strictEqual(app.daily.dateKey, dateKey);
        assert.strictEqual(app.dailyProgress.getDay(dateKey).entriesUsed, entries);
        assert.strictEqual(app.rewardUnlocks.view().balance, 600);
        assert.strictEqual(app.stamina.snapshot(now).balance, stamina, 'daily never spends ordinary stamina');
        app.onHide(); app.onShow(); await app.resumeOnline();
        assert.strictEqual(app.rewardUnlocks.view().balance, 600, 'recovery does not duplicate local claims');
        assert.strictEqual(app.rewardUnlocks.purchase('theme:desserts').reason, 'insufficient-balance');
        assert.strictEqual(cloudAccesses, 0); assert.strictEqual(networkCalls, 0);

        // Existing boundUserId protects a retained A outbox even after a
        // valid replacement HTTP session B is installed. No scope migration.
        const sync = app.progressSync;
        sync.store.state.boundUserId = 'alice'; assert(sync.store.save());
        const pending = JSON.stringify(sync.store.state.pendingOperations); assert.notStrictEqual(pending, '[]');
        app.auth.sessions.set({ schemaVersion: 1, userId: 'bob', accessToken: 'test-only',
          issuedAt: Date.now(), expiresAt: Date.now() + 100000 });
        sync.config = { enabled: true };
        app.auth.api.config = { enabled: true, baseUrl: 'https://example.test' };
        assert.strictEqual((await sync.flush()).reason, 'account-mismatch');
        assert.strictEqual(JSON.stringify(sync.store.state.pendingOperations), pending);
        assert.strictEqual(networkCalls, 0); assert.strictEqual(cloudAccesses, 0);
      } finally { if (app) app.dispose(); }
    }
    const native = fakeApi(); global.wx = native;
    const state = rewards.emptyState(); state.balance = 10000;
    native.storage[rewards.STORAGE_KEY] = state;
    const app = bootstrap.start();
    try {
      assert(app.openRewardDialog('theme:desserts'));
      await app.requestRewardUnlock();
      assert.strictEqual(app.rewardUnlocks.view().balance, 0);
      assert(app.rewardUnlocks.owned('theme:desserts'));
      assert.strictEqual(app.skins.current().id, 'classic', 'ownership is not selection');
      assert.strictEqual(app.rewardUnlocks.purchase('theme:desserts').amountDelta, 0);
      assert.strictEqual(native.storage[rewards.STORAGE_KEY].ownedRewards['theme:desserts'], true);
      await app.resumeOnline(); assert(!native.events.includes('login'));
    } finally { app.dispose(); }
  } finally { global.wx = oldWx; }
};
