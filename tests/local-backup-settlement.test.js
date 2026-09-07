'use strict';

const assert = require('assert');
const ProgressStore = require('../src/services/progress-store.js');
const DailyProgressStore = require('../src/services/daily-progress-store.js');
const RewardUnlockService = require('../src/services/reward-unlock-service.js');
const StaminaService = require('../src/services/stamina-service.js');
const PreferencesService = require('../src/services/preferences-service.js');
const BackupSnapshot = require('../src/services/backup-snapshot.js');
const SyncStore = require('../src/services/sync-store.js');
const ProgressSync = require('../src/services/progress-sync-service.js');
const rewardsConfig = require('../src/config/rewards.js');

function host() {
  const storage = {}; let failKey = null; let failReadKey = null;
  return { storage, getStorage: key => storage[key], readStorageResult: key =>
    key === failReadKey ? ({ ok: false, reason: 'storage-read-failed' }) :
      ({ ok: true, found: Object.prototype.hasOwnProperty.call(storage, key), value: storage[key] }),
  setStorage(key, value) { if (key === failKey) return false; storage[key] = JSON.parse(JSON.stringify(value)); return true; },
  fail: key => { failKey = key; }, failRead: key => { failReadKey = key; } };
}

module.exports = async function run() {
  const platform = host();
  platform.storage[RewardUnlockService.STORAGE_KEY] = Object.assign(RewardUnlockService.emptyState(), { balance: 10000 });
  const progress = new ProgressStore(platform); const daily = new DailyProgressStore(platform);
  const rewards = new RewardUnlockService(platform, rewardsConfig); const stamina = new StaminaService(platform);
  const preferences = new PreferencesService(progress);
  const store = new SyncStore(platform);
  assert(store.activateScope('player_local_backup_A', 1, 'test-env', true).ok);
  assert(store.enableLocalBackup(store.context()).ok);
  rewards.setAuthorityMode('local-backup'); stamina.setAuthorityMode('local-backup');
  const auth = { mode: 'cloud', current: () => ({ mode: 'cloud', ownerId: 'player_local_backup_A', bindingEpoch: 1,
    environmentId: 'test-env', generation: 1 }) };
  const calls = [];
  const sync = new ProgressSync({ transport: { config: { writeEnabled: false } }, request: async input => { calls.push(input); } },
    progress, store, auth, { localBackupEnabled: true }, null, { daily, rewards, stamina, preferences });

  const completion = progress.recordCompletion(0, 0, 1000);
  assert(progress.save());
  const granted = rewards.reconcile({ ordinary: progress.exportRewardCompletions(), daily: daily.exportRewardCompletions() });
  assert.strictEqual(completion.firstClear, true);
  assert.strictEqual(granted.amountDelta, rewardsConfig.currency.ordinaryFirstClear);
  assert(sync.enqueueCompletion({ setIndex: 0, levelIndex: 0, elapsedMs: 1000 }));
  assert.strictEqual(calls.length, 0, 'offline first clear never requests cloud settlement');
  const repeated = rewards.reconcile({ ordinary: progress.exportRewardCompletions(), daily: daily.exportRewardCompletions() });
  assert.strictEqual(repeated.amountDelta, 0, 'persisted claim prevents duplicate first-clear currency');

  const beforePurchase = rewards.view().balance;
  const purchase = rewards.purchase('theme:desserts');
  assert(purchase.ok && rewards.owned('theme:desserts'));
  assert.strictEqual(rewards.view().balance, beforePurchase - 10000);
  assert(sync.localChanged());
  assert.strictEqual(store.currentScope().pendingOperations.length, 0, 'local backup mode never creates legacy business operations');
  assert.strictEqual(calls.length, 0, 'offline purchase does not call economy.purchase');

  assert(daily.recordEntry({ dateKey: '2026-09-07', dayId: 'daily-2026-09-07-v1', entryLimit: 1,
    levelIds: ['intro', 'extreme'], idempotencyKey: 'entry-local' }).ok);
  assert(daily.recordLevelCompletion({ dateKey: '2026-09-07', dayId: 'daily-2026-09-07-v1',
    levelId: 'intro', levelIndex: 0, levelCount: 2, elapsedMs: 1000 }).ok);
  assert(daily.recordLevelCompletion({ dateKey: '2026-09-07', dayId: 'daily-2026-09-07-v1',
    levelId: 'extreme', levelIndex: 1, levelCount: 2, elapsedMs: 2000 }).ok);
  const dailyGranted = rewards.reconcile({ ordinary: progress.exportRewardCompletions(), daily: daily.exportRewardCompletions() });
  assert.strictEqual(dailyGranted.amountDelta, rewardsConfig.currency.dailyFirstComplete);
  assert(sync.enqueueDailyCompletion({ dateKey: '2026-09-07' }));
  assert.strictEqual(calls.length, 0, 'daily completion is settled and queued only as a local backup change');

  const staminaSpent = sync.unlockOrdinaryLevel('0:0', 1000);
  assert(staminaSpent.ok && staminaSpent.spent === 1);
  assert.strictEqual(new StaminaService(platform).snapshot(1000).balance, 4, 'local stamina debit survives reload');
  assert(progress.setSetting('soundEnabled', false)); assert(sync.enqueuePreference('soundEnabled', false));
  assert.strictEqual(new ProgressStore(platform).getSetting('soundEnabled', true), false, 'local setting survives reload');
  assert.strictEqual(calls.length, 0, 'stamina and setting writes do not request cloud settlement');

  progress.state.bestMs['0:1'] = 999;
  const snapshot = new BackupSnapshot({ progress, daily, rewards, stamina, preferences },
    { dateKey: () => '2026-09-07' }).build();
  assert(snapshot.ok); assert.strictEqual(snapshot.snapshot.domains.progress.levels['0:1'], undefined,
    'an orphan best time is not promoted into a completed level by backup export');

  const failedPlatform = host();
  failedPlatform.storage[RewardUnlockService.STORAGE_KEY] = Object.assign(RewardUnlockService.emptyState(), { balance: 10000 });
  const failedRewards = new RewardUnlockService(failedPlatform, rewardsConfig);
  failedRewards.setAuthorityMode('local-backup'); failedPlatform.fail(RewardUnlockService.STORAGE_KEY);
  const failed = failedRewards.purchase('theme:desserts');
  assert.strictEqual(failed.reason, 'persist-failed');
  assert.strictEqual(failedRewards.view().balance, 10000);
  assert.strictEqual(failedRewards.owned('theme:desserts'), false, 'failed atomic save reports no purchase or balance change');

  const durableOnly = host();
  const durableProgress = new ProgressStore(durableOnly); const durableDaily = new DailyProgressStore(durableOnly);
  const durableRewards = new RewardUnlockService(durableOnly, rewardsConfig); const durableStamina = new StaminaService(durableOnly);
  const durablePreferences = new PreferencesService(durableProgress);
  assert(durableProgress.setSetting('soundEnabled', false));
  assert(durableProgress.save());
  durableStamina.snapshot(1000);
  assert(durableStamina.unlockOrdinaryLevel('0:0', 1000).ok);
  const durableSnapshots = new BackupSnapshot({ progress: durableProgress, daily: durableDaily,
    rewards: durableRewards, stamina: durableStamina, preferences: durablePreferences },
  { dateKey: () => '2026-09-07' });
  const persisted = durableSnapshots.build(); assert(persisted.ok);

  durableOnly.fail(ProgressStore.STORAGE_KEY);
  durableProgress.recordCompletion(0, 1, 222);
  assert.strictEqual(durableProgress.save(), false);
  const afterFailedProgress = durableSnapshots.build(); assert(afterFailedProgress.ok);
  assert.strictEqual(afterFailedProgress.snapshot.domains.progress.levels['0:1'], undefined,
    'backup excludes an ordinary clear that exists only in memory after save failure');
  durableOnly.fail(null);

  durableProgress.state.settings.soundEnabled = true;
  durableRewards.state.balance = 999;
  durableStamina._state.balance = 99;
  durableDaily.state.entries['2026-09-07'] = { dayId: 'memory-only', completed: true };
  const memoryMutated = durableSnapshots.build(); assert(memoryMutated.ok);
  assert.strictEqual(memoryMutated.snapshot.domains.preferences.soundEnabled, false);
  assert.strictEqual(memoryMutated.snapshot.domains.economy.balance, 0);
  assert.strictEqual(memoryMutated.snapshot.domains.stamina.balance, persisted.snapshot.domains.stamina.balance);
  assert.strictEqual(memoryMutated.snapshot.domains.daily.day, null,
    'all backup domains are exported from persisted data instead of live service state');

  durableOnly.failRead(RewardUnlockService.STORAGE_KEY);
  assert.strictEqual(durableSnapshots.build().reason, 'storage-read-failed',
    'a storage read failure is not treated as an absent save');
  durableOnly.failRead(null);
  durableOnly.storage[RewardUnlockService.STORAGE_KEY] = '{broken';
  assert.strictEqual(durableSnapshots.build().reason, 'invalid-storage',
    'corrupt persisted data blocks backup instead of becoming an initial value');
};
