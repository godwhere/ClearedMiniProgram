'use strict';

const assert = require('assert');
const CloudBackupTest = require('./cloud-backup-service.test.js');
const ProgressStore = require('../src/services/progress-store.js');
const DailyProgressStore = require('../src/services/daily-progress-store.js');
const ProgressSyncService = require('../src/services/progress-sync-service.js');
const SyncStore = require('../src/services/sync-store.js');

function completeDay(store, dateKey, dayId) {
  assert(store.recordEntry({ dateKey, dayId, entryLimit: 1,
    levelIds: [`${dayId}-a`, `${dayId}-b`], idempotencyKey: `entry-${dayId}` }).ok);
  assert(store.recordLevelCompletion({ dateKey, dayId, levelId: `${dayId}-a`, levelIndex: 0,
    levelCount: 2, levelIds: [`${dayId}-a`, `${dayId}-b`], elapsedMs: 100 }).ok);
  assert(store.recordLevelCompletion({ dateKey, dayId, levelId: `${dayId}-b`, levelIndex: 1,
    levelCount: 2, levelIds: [`${dayId}-a`, `${dayId}-b`], elapsedMs: 200 }).ok);
}

module.exports = async function run() {
  const source = CloudBackupTest.setup(); await source.service.bootstrap(source.session);
  source.progress.recordCompletion(0, 0, 321); assert(source.progress.save());
  const built = source.snapshots.build(); assert(built.ok);

  const empty = CloudBackupTest.setup({ initialArchive: { known: true, exists: false } });
  empty.respond(async request => ({ ok: true, data: empty.envelope(request.requestId,
    { found: true, cloudVersion: 4, savedAt: 100, snapshotHash: built.snapshotHash, snapshot: built.snapshot }) }));
  const restored = await empty.service.bootstrap(empty.session);
  assert(restored.ok && restored.restored);
  assert(empty.progress.isCompleted(0, 0), 'a genuinely empty install restores the latest cloud backup once');
  assert.strictEqual(empty.store.currentScope().backup.cloudVersion, 4);
  assert.strictEqual(empty.store.currentScope().backup.dirty, false);

  const readFailure = CloudBackupTest.setup({ initialArchive: { known: true, exists: false } });
  readFailure.respond(async () => ({ ok: false, error: { code: 'network' } }));
  assert.strictEqual((await readFailure.service.bootstrap(readFailure.session)).reason, 'network');
  assert.strictEqual(readFailure.store.currentScope().backup.lastError, 'backup-read-failed');
  assert.strictEqual((await readFailure.service.atCheckpoint('home')).reason, 'cloud-state-unknown',
    'an unreadable cloud state is never treated as an empty backup that may be overwritten');

  const raced = CloudBackupTest.setup({ initialArchive: { known: true, exists: false } });
  let finishRead;
  raced.respond(request => new Promise(resolve => { finishRead = () => resolve({ ok: true, data: raced.envelope(request.requestId,
    { found: true, cloudVersion: 4, savedAt: 100, snapshotHash: built.snapshotHash, snapshot: built.snapshot }) }); }));
  const booting = raced.service.bootstrap(raced.session);
  await Promise.resolve();
  raced.progress.recordCompletion(0, 1, 222); assert(raced.progress.save());
  assert(raced.store.markBackupDirty(raced.store.context()));
  finishRead();
  assert.strictEqual((await booting).reason, 'restore-confirmation-stale');
  assert(raced.progress.isCompleted(0, 1), 'local progress made while the cloud read is pending is preserved');

  const interrupted = CloudBackupTest.setup(); await interrupted.service.bootstrap(interrupted.session);
  interrupted.respond(async request => ({ ok: true, data: interrupted.envelope(request.requestId,
    { found: true, cloudVersion: 2, savedAt: 100, snapshotHash: built.snapshotHash, snapshot: built.snapshot }) }));
  assert((await interrupted.service.requestRestore()).found);
  interrupted.host.fail(ProgressStore.STORAGE_KEY);
  const failed = await interrupted.service.confirmRestore();
  assert.strictEqual(failed.reason, 'persist-failed');
  assert(interrupted.store.currentScope().pendingBackupRestore, 'restore intent is durable before applying any domain');
  interrupted.host.fail(null);
  const resumed = await interrupted.applier.resumeBackupRestore(interrupted.guard.capture());
  assert(resumed.ok && resumed.resumed);
  assert.strictEqual(interrupted.store.currentScope().pendingBackupRestore, null);

  const conflict = CloudBackupTest.setup(); await conflict.service.bootstrap(conflict.session);
  conflict.progress.recordCompletion(0, 0, 100); assert(conflict.progress.save()); assert(conflict.store.markBackupDirty(conflict.store.context()));
  conflict.respond(async request => ({ ok: true, data: conflict.envelope(request.requestId,
    { status: 'CONFLICT', cloudVersion: 7, requestId: request.requestId, snapshotHash: built.snapshotHash }) }));
  const denied = await conflict.service.atCheckpoint('manual');
  assert.strictEqual(denied.reason, 'backup-version-conflict');
  assert.strictEqual(conflict.store.currentScope().backup.dirty, true);
  assert.strictEqual(conflict.store.currentScope().backup.cloudVersion, 0,
    'a conflict does not advance the accepted commit base');
  const conflictedCalls = conflict.calls.length;
  conflict.advance(180000);
  assert.strictEqual((await conflict.service.atCheckpoint('home')).reason, 'backup-version-conflict');
  assert.strictEqual(conflict.calls.length, conflictedCalls,
    'an unconfirmed conflict blocks later automatic backup without another request');
  conflict.service.cancelConfirmation();
  assert.strictEqual((await conflict.service.atCheckpoint('manual')).reason, 'backup-version-conflict');
  assert.strictEqual(conflict.calls.length, conflictedCalls,
    'cancelling the prompt does not authorize a manual overwrite');

  const restarted = CloudBackupTest.setup({ host: conflict.host, initialArchive: { known: true, exists: true } });
  assert.strictEqual((await restarted.service.bootstrap(restarted.session)).status, 'backup-conflict');
  assert.strictEqual((await restarted.service.atCheckpoint('home')).reason, 'backup-version-conflict');
  assert.strictEqual(restarted.calls.length, 0,
    'restart keeps the conflict blocked and never turns it into overwrite permission');
  restarted.respond(async request => {
    assert.strictEqual(request.payload.baseVersion, 7, 'explicit overwrite uses the version just confirmed by the player');
    return { ok: true, data: restarted.envelope(request.requestId,
      { status: 'CONFLICT', cloudVersion: 9, requestId: request.requestId, snapshotHash: request.payload.snapshotHash }) };
  });
  assert.strictEqual((await restarted.service.confirmBackup()).reason, 'backup-version-conflict');
  const secondConflictCalls = restarted.calls.length;
  assert.strictEqual((await restarted.service.atCheckpoint('home')).reason, 'backup-version-conflict');
  assert.strictEqual(restarted.calls.length, secondConflictCalls,
    'a second conflict stops after one confirmed request instead of force-pushing in a loop');

  const oldWriter = CloudBackupTest.setup(); await oldWriter.service.bootstrap(oldWriter.session);
  const oldScopeKey = 'cloud:test-env|player_backup_A';
  const oldBackup = oldWriter.host.storage[SyncStore.STORAGE_KEY].scopes[oldScopeKey].backup;
  delete oldBackup.conflictVersion; oldBackup.cloudVersion = 7; oldBackup.dirty = true;
  oldBackup.lastError = 'backup-version-conflict';
  const upgradedConflict = CloudBackupTest.setup({ host: oldWriter.host });
  assert.strictEqual(upgradedConflict.store.currentScope().backup.conflictVersion, 7,
    'the initial buggy conflict shape upgrades into a durable blocked conflict');
  assert.strictEqual((await upgradedConflict.service.bootstrap(upgradedConflict.session)).status, 'backup-conflict');

  const readCandidate = CloudBackupTest.setup(); await readCandidate.service.bootstrap(readCandidate.session);
  readCandidate.progress.recordCompletion(0, 0, 100); assert(readCandidate.progress.save());
  assert(readCandidate.store.markBackupDirty(readCandidate.store.context()));
  assert((await readCandidate.service.atCheckpoint('manual')).ok);
  const accepted = readCandidate.store.currentScope().backup;
  readCandidate.progress.recordCompletion(0, 1, 200); assert(readCandidate.progress.save());
  assert(readCandidate.store.markBackupDirty(readCandidate.store.context()));
  readCandidate.respond(async request => ({ ok: true, data: readCandidate.envelope(request.requestId,
    request.action === 'backup.read'
      ? { found: true, cloudVersion: 7, savedAt: 100, snapshotHash: built.snapshotHash, snapshot: built.snapshot }
      : { status: 'CONFLICT', cloudVersion: 7, requestId: request.requestId, snapshotHash: request.payload.snapshotHash }) }));
  assert((await readCandidate.service.requestRestore()).found);
  assert.strictEqual(readCandidate.store.currentScope().backup.cloudVersion, accepted.cloudVersion);
  assert.strictEqual(readCandidate.store.currentScope().backup.lastSnapshotHash, accepted.lastSnapshotHash,
    'reading then cancelling a restore does not accept the remote version or fingerprint');
  readCandidate.service.cancelConfirmation(); readCandidate.advance(180000);
  const afterCancelledRead = await readCandidate.service.atCheckpoint('home');
  assert.strictEqual(afterCancelledRead.reason, 'backup-version-conflict');
  assert.strictEqual(readCandidate.calls[readCandidate.calls.length - 1].payload.baseVersion, accepted.cloudVersion);

  const restoreRewards = CloudBackupTest.setup(); await restoreRewards.service.bootstrap(restoreRewards.session);
  const blankSource = CloudBackupTest.setup(); await blankSource.service.bootstrap(blankSource.session);
  const blankBuilt = blankSource.snapshots.build(); assert(blankBuilt.ok);
  completeDay(restoreRewards.daily, '2026-09-06', 'daily-old-cross');
  completeDay(restoreRewards.daily, '2026-09-07', 'daily-old-same');
  const preRestoreGrant = restoreRewards.rewards.reconcile({ ordinary: restoreRewards.progress.exportRewardCompletions(),
    daily: restoreRewards.daily.exportRewardCompletions() });
  assert(preRestoreGrant.amountDelta > 0);
  restoreRewards.respond(async request => ({ ok: true, data: restoreRewards.envelope(request.requestId,
    { found: true, cloudVersion: 4, savedAt: 100, snapshotHash: blankBuilt.snapshotHash, snapshot: blankBuilt.snapshot }) }));
  assert((await restoreRewards.service.requestRestore()).found);
  assert((await restoreRewards.service.confirmRestore()).ok);
  assert.strictEqual(restoreRewards.rewards.view().balance, 0, 'restore keeps the selected snapshot balance exact');
  let afterRestore = restoreRewards.rewards.reconcile({ ordinary: restoreRewards.progress.exportRewardCompletions(),
    daily: restoreRewards.daily.exportRewardCompletions() });
  assert.strictEqual(afterRestore.amountDelta, 0,
    'same-day and cross-day local history cannot issue rewards after a day:null restore');
  const reloadedDaily = new DailyProgressStore(restoreRewards.host);
  afterRestore = restoreRewards.rewards.reconcile({ ordinary: restoreRewards.progress.exportRewardCompletions(),
    daily: reloadedDaily.exportRewardCompletions() });
  assert.strictEqual(afterRestore.amountDelta, 0, 'reward suppression survives restart');
  completeDay(reloadedDaily, '2026-09-08', 'daily-new-after-restore');
  afterRestore = restoreRewards.rewards.reconcile({ ordinary: restoreRewards.progress.exportRewardCompletions(),
    daily: reloadedDaily.exportRewardCompletions() });
  assert(afterRestore.amountDelta > 0, 'a new legitimate daily completion after restore still grants exactly once');
  assert.strictEqual(restoreRewards.rewards.reconcile({ ordinary: restoreRewards.progress.exportRewardCompletions(),
    daily: reloadedDaily.exportRewardCompletions() }).amountDelta, 0);

  const session = { mode: 'cloud', ownerId: 'player_pending_purchase', bindingEpoch: 1,
    environmentId: 'test-env', generation: 1 };
  const scope = { ownerId: session.ownerId, bindingEpoch: 1, environmentId: 'test-env', activationSequence: 1 };
  let backupBootstraps = 0; let cloudReads = 0; let pendingPurchase = true;
  const mockStore = { context: () => scope, matches: token => token === scope,
    currentScope: () => ({ pendingApplication: null, pendingOperations: [] }),
    authorityMode: () => 'cloud-authoritative' };
  const sync = new ProgressSyncService({ transport: { config: { readEnabled: true } }, isConfigured: () => true },
    null, mockStore, { current: () => session }, { localBackupEnabled: true }, null,
    { economy: { hasPendingPurchase: () => pendingPurchase },
      backup: { bootstrap: async () => { backupBootstraps++; return { ok: true, status: 'backup-pending' }; } } });
  sync.runCloud = async () => { cloudReads++; return { ok: true, status: 'cloud-synced' }; };
  assert((await sync.bootstrapCloud(session)).ok);
  assert.strictEqual(cloudReads, 1); assert.strictEqual(backupBootstraps, 0,
    'a durable or in-flight purchase stays on the existing recovery path before mode switch');
  assert((await sync.bootstrapCloud(session)).ok);
  assert.strictEqual(cloudReads, 2); assert.strictEqual(backupBootstraps, 0,
    'an unresolved or failed purchase recovery remains in the old mode on later resumes');
  pendingPurchase = false;
  assert((await sync.bootstrapCloud(session)).ok);
  assert.strictEqual(backupBootstraps, 1, 'local backup mode starts only after purchase recovery is no longer pending');
};
