'use strict';

const assert = require('assert');
const SyncStore = require('../src/services/sync-store.js');
const Progress = require('../src/services/progress-store.js');
const Daily = require('../src/services/daily-progress-store.js');
const Rewards = require('../src/services/reward-unlock-service.js');
const Stamina = require('../src/services/stamina-service.js');
const Sessions = require('../src/services/session-store.js');
const Applier = require('../src/services/authoritative-state-applier.js');
const Economy = require('../src/services/economy-service.js');
const rewardConfig = require('../src/config/rewards.js');
const { RewardPlatform } = require('./helpers/reward-fixture.js');
const { fakeApi } = require('./account-bootstrap.test.js');
const { fixture: cloudFixture, envelope, revisions } = require('./helpers/cloud-readonly-fixture.js');
const { core } = require('./helpers/cloud-stage4-services.js');

module.exports = async function run() {
  const platform = new RewardPlatform(); const store = new SyncStore(platform);
  const progress = new Progress(platform); progress.setSetting('soundEnabled', false);
  const daily = new Daily(platform); const rewards = new Rewards(platform, rewardConfig);
  const stamina = new Stamina(platform); const staminaBefore = stamina.exportAuthoritativeSnapshot();
  const sessions = new Sessions(platform); assert(store.activateScope('player_A', 1, 'test-env', true).ok);
  const guard = { capture: () => { const scope = store.context(); return { ownerIdAtStart: scope.ownerId,
    bindingEpochAtStart: scope.bindingEpoch, environmentIdAtStart: scope.environmentId,
    activationSequenceAtStart: scope.activationSequence, accountGenerationAtStart: 1 }; },
  matches: token => token.ownerIdAtStart === store.context().ownerId && token.activationSequenceAtStart === store.context().activationSequence };
  const applier = new Applier({ progress, daily, rewards, stamina, syncStore: store, sessions }, guard);
  const response = { protocolVersion: 1, environmentId: 'test-env', ownerId: 'player_A', bindingEpoch: 1,
    receiptId: 'restore_receipt', revisions: { progress: 2, daily: 1, economy: 3, entitlements: 2, stamina: 0, preferences: 0 },
    domains: { progress: { schemaVersion: 1, levels: { '0:1': { completed: true, bestMs: 800 } },
      lastPlayed: { setIndex: 0, levelIndex: 1 } }, daily: { schemaVersion: 1, days: {} },
      economy: { schemaVersion: 1, balance: 250, claimedOrdinary: { '0:1': true }, claimedDaily: {} },
      entitlements: { schemaVersion: 1, ownedRewards: { 'theme:classic': true, 'effect:none': true, 'theme:desserts': true } } },
    acceptedOperationIds: [], notificationHints: [], results: [] };
  const applied = await applier.applySyncReceipt(response, guard.capture(), { adoptLocal: true, migration: true,
    importId: 'import_restore', migrationReceiptId: 'migration_restore' });
  assert(applied.ok); assert(progress.isCompleted(0, 1)); assert.strictEqual(progress.getSetting('soundEnabled'), false);
  assert.strictEqual(rewards.view().balance, 250); assert(rewards.owned('theme:desserts'));
  assert.deepStrictEqual(stamina.exportAuthoritativeSnapshot(), staminaBefore);
  assert.strictEqual(stamina.authorityMode(), 'legacy-local'); assert.strictEqual(store.authorityMode('stamina'), 'legacy-local');
  assert.strictEqual(store.state.localOwnerId, 'player_A'); assert.strictEqual(sessions.metadata().migrationState, 'complete');

  const native = fakeApi(); const pendingKey = 'test-fixture|player_A|1|theme:desserts';
  native.storage[Economy.STORAGE_KEY] = { schemaVersion: 1, pending: {
    [pendingKey]: { operationId: 'purchase_pending_restore', rewardId: 'theme:desserts',
      ownerIdAtCreation: 'player_A', bindingEpochAtCreation: 1,
      environmentIdAtCreation: 'test-fixture', createdAt: 1 }
  } };
  const guarded = cloudFixture({ native, config: { migrationEnabled: false } });
  try {
    guarded.reply = request => {
      const value = envelope(request); const core = ['progress', 'daily', 'economy', 'entitlements'];
      value.player = { playerId: 'player_A', bindingEpoch: 1, migrationState: 'complete', hasCloudState: true,
        completedDomains: core, deferredDomains: ['stamina', 'preferences'],
        migrationImportId: 'import_existing', migrationReceiptId: 'migration_existing' };
      value.revisions = revisions();
      if (request.action !== 'identity.init') {
        value.data = { changedDomains: {}, hasCloudState: true, readOnlyPhase: false,
          completedDomains: core, deferredDomains: ['stamina', 'preferences'],
          migrationImportId: 'import_existing', migrationReceiptId: 'migration_existing',
          receiptId: 'state_existing', acceptedOperationIds: [] };
      }
      return value;
    };
    const blocked = await guarded.app.resumeOnline();
    assert.strictEqual(blocked.reason, 'migration-required',
      'a durable unresolved purchase makes the local core non-blank');
    assert.strictEqual(guarded.sync.state.localOwnerId, null,
      'cloud restore cannot silently adopt over the pending purchase');
    assert(guarded.app.economy.pending('theme:desserts'), 'the pending purchase remains recoverable');
  } finally { guarded.app.dispose(); }

  // Unbound, progress-only devices need no migration if the cloud already
  // covers their records. A navigation cursor alone must not block restore.
  for (const scenario of ['cursor', 'covered', 'new-clear', 'better-best', 'missing-cloud-best',
    'missing-progress-domain', 'balance', 'daily', 'purchase', 'guest-outbox', 'active-outbox', 'bound-owner', 'persist-failed']) {
    const f = cloudFixture({ config: { migrationEnabled: false, writeEnabled: true,
      staminaEnabled: false, preferencesEnabled: false } });
    let failProgressWrite = scenario === 'persist-failed';
    try {
      f.reply = request => {
        const value = envelope(request); const domains = ['progress', 'daily', 'economy', 'entitlements'];
        Object.assign(value.player, { hasCloudState: true, migrationState: 'complete', completedDomains: domains,
          migrationImportId: 'import_existing', migrationReceiptId: 'migration_existing' });
        domains.forEach(domain => { value.revisions[domain] = 1; });
        if (request.action === 'state.read') {
          const remote = core(250, { '0:0': { completed: true, bestMs: 800 } });
          remote.progress.lastPlayed = { setIndex: 0, levelIndex: 1 };
          if (scenario === 'missing-cloud-best') delete remote.progress.levels['0:0'].bestMs;
          if (scenario === 'missing-progress-domain') delete remote.progress;
          value.data = { changedDomains: remote, hasCloudState: true, readOnlyPhase: false,
            completedDomains: domains, deferredDomains: ['stamina', 'preferences'],
            migrationImportId: 'import_existing', migrationReceiptId: 'migration_existing',
            receiptId: 'state_existing', acceptedOperationIds: [] };
        }
        return value;
      };
      f.app.progress.markOpened(0, 0);
      if (['covered', 'new-clear', 'better-best', 'missing-cloud-best', 'missing-progress-domain'].includes(scenario)) {
        const key = scenario === 'new-clear' ? '0:1' : '0:0';
        f.app.progress.state.completed[key] = true;
        f.app.progress.state.bestMs[key] = scenario === 'better-best' ? 500 : 1000;
      }
      assert(f.app.progress.save());
      if (scenario === 'balance') {
        assert(f.app.rewardUnlocks.write(Object.assign({}, f.app.rewardUnlocks.state, { balance: 17 })));
      }
      if (scenario === 'daily') f.app.dailyProgress.state.entries['2026-09-04'] = 1;
      if (scenario === 'purchase') assert(f.app.economy.save({ schemaVersion: 1, pending: {
        'test-fixture|player_A|1|theme:desserts': { operationId: 'purchase_restore_guard', rewardId: 'theme:desserts',
          ownerIdAtCreation: 'player_A', bindingEpochAtCreation: 1, environmentIdAtCreation: 'test-fixture', createdAt: 1 }
      } }));
      if (scenario === 'guest-outbox') assert(f.sync.enqueue({ levelKey: '0:0', elapsedMs: 1000, completedAtClient: 1 }));
      if (scenario === 'bound-owner') {
        assert(f.sync.activateScope('player_other_fixture', 1, 'test-fixture', true).ok);
        f.sync.state.localOwnerId = 'player_other_fixture'; f.sync.state.localEnvironmentId = 'test-fixture';
        assert(f.sync.save());
      }
      if (scenario === 'active-outbox') {
        assert(f.sync.activateScope('player_A', 1, 'test-fixture', true).ok);
        assert(f.sync.enqueueOperation({ domain: 'progress', type: 'PROGRESS_LAST_PLAYED', occurredAtClient: 1,
          payload: { setIndex: 0, levelIndex: 0 } }).ok);
      }
      const beforeProgress = JSON.stringify(f.app.progress.state);
      const beforeRewards = JSON.stringify(f.app.rewardUnlocks.state);
      const save = f.native.setStorageSync;
      f.native.setStorageSync = function (key, value) {
        if (key === Progress.STORAGE_KEY && failProgressWrite) throw Error('fixture storage unavailable');
        return save.call(this, key, value);
      };
      let result = await f.app.resumeOnline();
      if (scenario === 'persist-failed') {
        assert.strictEqual(result.reason, 'persist-failed');
        assert.strictEqual(JSON.stringify(f.app.progress.state), beforeProgress);
        assert.strictEqual(JSON.stringify(f.app.rewardUnlocks.state), beforeRewards);
        assert.strictEqual(f.sync.state.localOwnerId, null);
        assert(f.sync.currentScope().pendingApplication, 'restore remains recoverable after a failed write');
        failProgressWrite = false;
        result = await f.app.resumeOnline();
      }
      if (['cursor', 'covered', 'persist-failed'].includes(scenario)) {
        assert.strictEqual(result.ok, true, scenario);
        assert.strictEqual(result.status, 'cloud-synced');
        assert.strictEqual(f.app.progress.bestTime(0, 0), 800);
        assert.deepStrictEqual(f.app.progress.state.lastPlayed, { setIndex: 0, levelIndex: 1 });
        assert.strictEqual(f.app.rewardUnlocks.view().balance, 250, 'restore exact cloud balance without adding local rewards');
        assert.strictEqual(f.sync.state.localOwnerId, 'player_A');
        assert.strictEqual(f.app.auth.sessions.metadata().migrationState, 'complete');
        assert((await f.app.resumeOnline()).ok, 'repeated restoration is idempotent');
        assert.strictEqual(f.app.rewardUnlocks.view().balance, 250);
      } else {
        assert.strictEqual(result.reason, 'migration-required', scenario);
        assert.strictEqual(JSON.stringify(f.app.progress.state), beforeProgress, scenario);
        assert.strictEqual(JSON.stringify(f.app.rewardUnlocks.state), beforeRewards, scenario);
        assert.strictEqual(f.sync.state.localOwnerId, scenario === 'bound-owner' ? 'player_other_fixture' : null);
      }
      assert(f.calls.every(call => ['identity.init', 'state.read'].includes(call.data.action)),
        'restore must not issue migration, purchase, synthetic clear, or sync mutations');
    } finally { f.app.dispose(); }
  }
};
