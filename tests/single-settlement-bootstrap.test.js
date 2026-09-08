'use strict';

const assert = require('assert');
const WechatPlatform = require('../src/platform/wechat.js');
const ProgressStore = require('../src/services/progress-store.js');
const DailyProgressStore = require('../src/services/daily-progress-store.js');
const RewardUnlockService = require('../src/services/reward-unlock-service.js');
const StaminaService = require('../src/services/stamina-service.js');
const PreferencesService = require('../src/services/preferences-service.js');
const SyncStore = require('../src/services/sync-store.js');
const BackupSnapshot = require('../src/services/backup-snapshot.js');
const rewardConfig = require('../src/config/rewards.js');
const { fakeApi } = require('./account-bootstrap.test.js');
const { fixture: cloudFixture, envelope, clone, tick } = require('./helpers/cloud-readonly-fixture.js');
const { core } = require('./helpers/cloud-stage4-services.js');

const CLOUD_CONFIG = {
  migrationEnabled: true,
  writeEnabled: true,
  economyEnabled: true,
  staminaEnabled: true,
  preferencesEnabled: true,
  localBackupEnabled: true
};

const BUSINESS_KEYS = [ProgressStore.STORAGE_KEY, DailyProgressStore.STORAGE_KEY,
  RewardUnlockService.STORAGE_KEY, StaminaService.STORAGE_KEY];

function businessStorage(native) {
  const result = {};
  BUSINESS_KEYS.forEach(key => {
    if (Object.prototype.hasOwnProperty.call(native.storage, key)) result[key] = clone(native.storage[key]);
  });
  return result;
}

function assertNoBackupRequests(calls) {
  assert.strictEqual(calls.some(call =>
    ['backup.read', 'backup.commit'].includes(call.data.action)), false);
}

function authoritativeReply(request) {
  const value = envelope(request);
  const domains = SyncStore.DOMAINS.slice();
  Object.assign(value.player, {
    migrationState: 'complete',
    hasCloudState: true,
    completedDomains: domains,
    deferredDomains: [],
    migrationImportId: 'import_existing',
    migrationReceiptId: 'migration_existing'
  });
  domains.forEach(domain => { value.revisions[domain] = 1; });
  value.bindingStatus = 'MATCHED';
  if (request.action === 'state.read') {
    const changedDomains = core(0);
    changedDomains.stamina = { schemaVersion: 1, balance: 5, nextRecoveryAt: null,
      unlockedLevels: [], refundedLevels: [] };
    changedDomains.preferences = { schemaVersion: 1, skinId: 'classic',
      clearEffectId: 'none', soundEnabled: true };
    value.data = {
      changedDomains,
      hasCloudState: true,
      readOnlyPhase: false,
      completedDomains: domains,
      deferredDomains: [],
      migrationImportId: 'import_existing',
      migrationReceiptId: 'migration_existing',
      receiptId: 'state_existing',
      acceptedOperationIds: [],
      mutationAllowed: true
    };
  }
  return value;
}

async function normalCloudBootstrapHasNoBackupDependency() {
  const f = cloudFixture({ config: CLOUD_CONFIG });
  try {
    f.reply = authoritativeReply;
    const result = await f.app.resumeOnline();
    await tick();
    assert.deepStrictEqual(result, { ok: true, status: 'cloud-synced', pending: 0 });
    assert.strictEqual(f.app.cloudBackup, null);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(f.app.progressSync.services, 'backup'), false);
    assert.strictEqual(f.app.progressSync.config.localBackupEnabled, false);
    assert.strictEqual(f.app.progressSync.accountGuard, f.app.accountGuard);
    assert.strictEqual(f.app.authoritativeApplier.accountGuard, f.app.accountGuard);
    assert.strictEqual(f.app.economy.accountGuard, f.app.accountGuard);
    assert.strictEqual(typeof f.app.progressSync.prepareMigrationSnapshot, 'function');
    assert.deepStrictEqual(f.calls.map(call => call.data.action), ['identity.init', 'state.read']);
    assertNoBackupRequests(f.calls);
    assert.deepStrictEqual(f.sync.authorityModes(), Object.fromEntries(
      SyncStore.DOMAINS.map(domain => [domain, 'cloud-authoritative'])
    ));

    f.app.openAccount();
    await tick();
    assert.strictEqual(f.app.buildModel().backupMode, false);
    f.calls.length = 0;
    const storageBeforeAction = clone(f.native.storage);
    assert.strictEqual(f.app.runAccountBackupAction('restore'), false,
      'a retained compatibility action is inert when bootstrap injects no backup service');
    assert.deepStrictEqual(f.native.storage, storageBeforeAction);
    assert.deepStrictEqual(f.calls, []);

    assert.strictEqual(f.app.retryAccountSync(), true, 'the normal cloud retry remains available');
    await tick();
    await tick();
    assert.strictEqual(f.app.accountSyncPending, null);
    assert.deepStrictEqual(f.calls.map(call => call.data.action), ['identity.init', 'state.read']);
    assertNoBackupRequests(f.calls);
  } finally {
    f.app.dispose();
  }
}

async function bootstrapDoesNotLoadOrConstructBackupServices() {
  const bootstrapPath = require.resolve('../src/bootstrap.js');
  const snapshotPath = require.resolve('../src/services/backup-snapshot.js');
  const servicePath = require.resolve('../src/services/cloud-backup-service.js');
  const saved = new Map([bootstrapPath, snapshotPath, servicePath].map(path => [path, require.cache[path]]));
  const calls = { archiveRead: 0, snapshotConstructed: 0, serviceConstructed: 0 };
  class SnapshotTrap {
    constructor() { calls.snapshotConstructed++; }
    static localArchiveState() { calls.archiveRead++; return { known: true, exists: true }; }
  }
  class ServiceTrap {
    constructor() { calls.serviceConstructed++; }
  }
  let app = null;
  const oldWx = global.wx;
  try {
    require.cache[snapshotPath] = { id: snapshotPath, filename: snapshotPath,
      loaded: true, exports: SnapshotTrap };
    require.cache[servicePath] = { id: servicePath, filename: servicePath,
      loaded: true, exports: ServiceTrap };
    delete require.cache[bootstrapPath];
    const isolatedBootstrap = require(bootstrapPath);
    const native = fakeApi();
    native.getAccountInfoSync = () => ({ miniProgram: { envVersion: 'unknown' } });
    native.cloud = { init() { throw Error('cloud is disabled for an unknown runtime'); },
      callFunction() { throw Error('cloud is disabled for an unknown runtime'); } };
    global.wx = native;
    app = isolatedBootstrap.start();
    assert.strictEqual(app.scene, 'home');
    assert.deepStrictEqual(native.events, ['frame']);
    assert.strictEqual(app.auth.mode, 'legacy-http');
    assert.strictEqual(app.syncStore.authorityMode('progress'), 'legacy-local');
    assert.strictEqual(app.cloudBackup, null);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(app.progressSync.services, 'backup'), false);
    assert.strictEqual(app.progressSync.config.localBackupEnabled, false);
    const loadedDependencies = require.cache[bootstrapPath].children.map(child => child.filename);
    assert.strictEqual(loadedDependencies.includes(snapshotPath), false);
    assert.strictEqual(loadedDependencies.includes(servicePath), false);
    assert.deepStrictEqual(calls, { archiveRead: 0, snapshotConstructed: 0, serviceConstructed: 0 },
      'the real startup composition cannot even load or construct the retired normal-entry dependencies');
    assert.strictEqual(app.openLevel(0, 0), true,
      'a cloud-disabled local profile keeps the existing pre-takeover gameplay path');
    await tick();
  } finally {
    if (app) app.dispose();
    global.wx = oldWx;
    for (const [path, entry] of saved) {
      if (entry) require.cache[path] = entry;
      else delete require.cache[path];
    }
  }
}

function seedHistoricalBackup(pendingRestore) {
  const native = fakeApi();
  const platform = new WechatPlatform(native);
  const progress = new ProgressStore(platform);
  const daily = new DailyProgressStore(platform);
  const rewards = new RewardUnlockService(platform, rewardConfig);
  const stamina = new StaminaService(platform);
  const preferences = new PreferencesService(progress);
  const sync = new SyncStore(platform);
  assert(sync.activateScope('player_A', 1, 'test-fixture', true).ok);
  assert(sync.enableLocalBackup(sync.context()).ok);
  assert(progress.recordCompletion(0, 0, 1000));
  assert(progress.save());
  assert(rewards.setAuthorityMode('local-backup'));
  assert(stamina.setAuthorityMode('local-backup'));
  const granted = rewards.reconcile({ ordinary: progress.exportRewardCompletions(),
    daily: daily.exportRewardCompletions() });
  assert.strictEqual(granted.amountDelta, 100);
  stamina.restoreUnlockedLevels(['0:0'], Date.parse('2026-09-08T00:00:00.000Z'));
  const built = new BackupSnapshot({ progress, daily, rewards, stamina, preferences },
    { dateKey: () => '2026-09-08' }).build();
  assert(built.ok);
  if (pendingRestore) {
    const scope = sync.currentScope();
    assert(sync.beginBackupRestore({
      schemaVersion: 1,
      restoreId: 'restore_pending_test',
      cloudVersion: 2,
      localVersionAtConfirmation: scope.backup.localVersion,
      snapshotHash: built.snapshotHash,
      snapshot: built.snapshot
    }, sync.context()).ok);
  }
  return {
    native,
    business: businessStorage(native),
    authority: sync.authorityModes(),
    pendingOperations: sync.currentScope().pendingOperations,
    pendingRestore: sync.currentScope().pendingBackupRestore
  };
}

async function historicalBackupArchiveRemainsFailClosed(pendingRestore) {
  const seeded = seedHistoricalBackup(pendingRestore);
  const f = cloudFixture({ native: seeded.native, config: CLOUD_CONFIG });
  try {
    f.owner = 'player_A';
    f.reply = request => envelope(request, f.owner, 1);
    const result = await f.app.resumeOnline();
    await tick();
    assert.deepStrictEqual(result, { ok: false, reason: 'not-configured' });
    assert.strictEqual(f.app.cloudBackup, null);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(f.app.progressSync.services, 'backup'), false);
    assert.strictEqual(f.app.progressSync.config.localBackupEnabled, false);
    assert(f.calls.length > 0);
    assert.strictEqual(f.calls.every(call => call.data.action === 'identity.init'), true,
      'an unsupported historical archive may authenticate but cannot enter either settlement protocol');
    assertNoBackupRequests(f.calls);
    assert.deepStrictEqual(f.sync.authorityModes(), seeded.authority);
    assert.strictEqual(Object.values(f.sync.authorityModes()).every(mode => mode === 'local-backup'), true);
    assert.deepStrictEqual(f.sync.currentScope().pendingOperations, seeded.pendingOperations);
    assert.deepStrictEqual(f.sync.currentScope().pendingBackupRestore, seeded.pendingRestore);
    assert.deepStrictEqual(businessStorage(f.native), seeded.business,
      'removing bootstrap composition adds no business-data change to the prior disabled-config behavior');
    assert.strictEqual(f.app.progress.isCompleted(0, 0), true);
    assert.strictEqual(f.app.rewardUnlocks.view().balance, 100);
    assert.strictEqual(f.app.rewardUnlocks.state.claimedOrdinary['0:0'], true);
    assert.strictEqual(f.app.cloudAccountMessage(result), '云连接未完成，本地进度已保留');

    if (pendingRestore) {
      assert.strictEqual(f.app.openLevel(0, 0), false);
      assert.strictEqual(f.app.scene, 'account');
      assert.strictEqual(f.app.accountMessage, '云备份恢复尚未完整保存，完成前不能继续游玩');
      assert.deepStrictEqual(f.sync.currentScope().pendingBackupRestore, seeded.pendingRestore);
    }
    f.calls.length = 0;
    const beforeAction = clone(f.native.storage);
    assert.strictEqual(f.app.runAccountBackupAction('restore'), false);
    assert.deepStrictEqual(f.calls, []);
    assert.deepStrictEqual(f.native.storage, beforeAction);
  } finally {
    f.app.dispose();
  }
}

module.exports = async function run() {
  await bootstrapDoesNotLoadOrConstructBackupServices();
  await normalCloudBootstrapHasNoBackupDependency();
  await historicalBackupArchiveRemainsFailClosed(false);
  await historicalBackupArchiveRemainsFailClosed(true);
};
