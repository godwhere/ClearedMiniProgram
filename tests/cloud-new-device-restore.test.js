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
};
