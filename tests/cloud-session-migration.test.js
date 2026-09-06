'use strict';

const assert = require('assert');
const vm = require('vm');
const App = require('../src/app.js');
const Platform = require('../src/platform/wechat.js');
const SyncStore = require('../src/services/sync-store.js');
const SessionStore = require('../src/services/session-store.js');
const Applier = require('../src/services/authoritative-state-applier.js');
const Builder = require('../src/services/legacy-migration-builder.js');
const { fakeApi } = require('./account-bootstrap.test.js');
const { clone, canonical } = require('../src/services/sync-payload.js');
const { fixture: cloudFixture, envelope: cloudEnvelope, tick } = require('./helpers/cloud-readonly-fixture.js');

const NOW = Date.parse('2026-09-04T00:00:00Z');

function fixture(seed) {
  const native = fakeApi(); Object.assign(native.storage, clone(seed || {}));
  const platform = new Platform(native); const syncStore = new SyncStore(platform);
  const sessions = new SessionStore(platform); const app = new App(platform, { syncStore, clock: () => new Date(NOW) });
  return { native, platform, syncStore, sessions, app };
}

function response(store, extra) {
  return Object.assign({ protocolVersion: 1, environmentId: store.context().environmentId,
    ownerId: store.context().ownerId, bindingEpoch: store.context().bindingEpoch, receiptId: 'receipt_1',
    revisions: { progress: 1, daily: 1, economy: 1, entitlements: 1, stamina: 0, preferences: 0 },
    domains: { progress: { schemaVersion: 1, levels: { '0:0': { completed: true, bestMs: 1000 } }, lastPlayed: { setIndex: 0, levelIndex: 0 } },
      daily: { schemaVersion: 1, days: {} },
      economy: { schemaVersion: 1, balance: 100, claimedOrdinary: { '0:0': true }, claimedDaily: {} },
      entitlements: { schemaVersion: 1, ownedRewards: { 'theme:classic': true, 'effect:none': true } } },
    acceptedOperationIds: [], notificationHints: [], results: [] }, extra);
}

async function run() {
  const f = fixture(); f.app.progress.recordCompletion(0, 0, 1000);
  f.app.scene = 'play';
  assert.strictEqual(f.app.prepareLegacyMigration().reason, 'migration-not-ready', 'an active run cannot start migration');
  f.app.scene = 'home';
  const built = f.app.prepareLegacyMigration(); assert(built.ok);
  const migrationChunks = Object.create(require('../src/services/progress-sync-service.js').prototype)
    .migrationChunks(built.snapshot);
  assert.deepStrictEqual(migrationChunks['progress:resume'], [{ lastPlayed: { setIndex: 0, levelIndex: 0 } }],
    'the frozen legacy resume target has its own required migration record');
  assert.strictEqual(f.syncStore.state.authorityMode, 'legacy-local', 'building cannot freeze before server prepare');
  assert.strictEqual(f.app.stamina.authorityMode(), 'legacy-local');
  assert(f.syncStore.activateScope('player_A', 1, 'test-env', true).ok);
  const scope = f.syncStore.context(); const prepared = f.syncStore.recordServerMigration({ importId: 'import_one',
    policyVersion: built.snapshot.policyVersion, snapshotHash: built.snapshotHash, prepareReceiptId: 'prep_one',
    role: 'PRIMARY', requiredChunks: ['progress:resume', 'progress:0', 'economy:opening-balance', 'economy:ordinary-claims:0'],
    completedChunks: [], snapshot: built.snapshot }, scope);
  assert(prepared.ok); assert.strictEqual(f.syncStore.authorityMode('progress'), 'migration-freeze');
  assert(f.syncStore.updateScope({ lastError: 'timeout' }, scope));
  assert.strictEqual(f.syncStore.authorityMode('economy'), 'migration-freeze');
  assert.strictEqual(f.syncStore.authorityMode('stamina'), 'legacy-local');
  assert.deepStrictEqual(f.syncStore.migrationSnapshot('import_one', built.snapshotHash), built.snapshot,
    'the exact frozen source snapshot remains available for restart and supplemental conflict recovery');
  const archiveReload = new SyncStore(f.platform);
  assert.deepStrictEqual(archiveReload.migrationSnapshot('import_one', built.snapshotHash), built.snapshot,
    'a process restart reloads the same frozen snapshot instead of rebuilding it from time-varying stores');
  assert(f.app.rewardUnlocks.setAuthorityMode('migration-freeze'));
  assert.strictEqual(f.app.recoverRewardUnlocks().amountDelta, 0);
  assert.strictEqual(f.app.rewardUnlocks.purchase('theme:desserts').reason, 'migration-freeze');
  const progressBeforeBlockedOpen = canonical(f.app.progress.state);
  const dailyBeforeBlockedOpen = canonical(f.app.dailyProgress.state);
  f.app.scene = 'home';
  assert.strictEqual(f.app.openLevel(0, 0), false, 'freeze blocks a new ordinary run');
  assert.strictEqual(f.app.scene, 'account');
  assert.strictEqual(f.app.accountMessage, '正在迁移本地存档，完成前不能开始新关卡或领取资产');
  assert.strictEqual(canonical(f.app.progress.state), progressBeforeBlockedOpen);
  f.app.scene = 'home';
  assert.strictEqual(f.app.enterDaily(), false, 'freeze blocks a new daily run');
  assert.strictEqual(f.app.scene, 'account');
  assert.strictEqual(canonical(f.app.dailyProgress.state), dailyBeforeBlockedOpen);
  assert.strictEqual(f.app.stamina.refundQuickClear('0:0', 1000, NOW).reason === 'already-refunded' ||
    f.app.stamina.authorityMode() === 'legacy-local', true);

  const snapshot = new Builder({ progress: f.app.progress, daily: f.app.dailyProgress,
    rewards: f.app.rewardUnlocks, stamina: f.app.stamina, syncStore: f.syncStore }).buildSnapshot();
  assert(snapshot.ok); assert.strictEqual(snapshot.snapshotHash, built.snapshotHash);
  assert(!canonical(snapshot.snapshot).includes('pendingNotices'));

  const applier = new Applier({ progress: f.app.progress, daily: f.app.dailyProgress,
    rewards: f.app.rewardUnlocks, stamina: f.app.stamina, syncStore: f.syncStore, sessions: f.sessions }, f.app.accountGuard);
  const token = f.app.captureAccountContext(); const staminaBefore = f.app.stamina.exportAuthoritativeSnapshot();
  const applied = await applier.applyMigrationFinalization(response(f.syncStore), token,
    { importId: 'import_one', migrationReceiptId: 'receipt_1' });
  assert(applied.ok); assert.strictEqual(f.syncStore.authorityMode('progress'), 'cloud-authoritative');
  assert.strictEqual(f.syncStore.currentScope().lastError, null);
  assert(Number.isSafeInteger(f.syncStore.currentScope().lastSyncAt));
  assert.strictEqual(f.syncStore.authorityMode('daily'), 'cloud-authoritative');
  assert.strictEqual(f.syncStore.authorityMode('economy'), 'cloud-authoritative');
  assert.strictEqual(f.syncStore.authorityMode('entitlements'), 'cloud-authoritative');
  assert.strictEqual(f.syncStore.authorityMode('stamina'), 'legacy-local');
  assert.strictEqual(f.app.stamina.authorityMode(), 'legacy-local');
  assert.deepStrictEqual(f.app.stamina.exportAuthoritativeSnapshot(), staminaBefore);
  assert.strictEqual(f.app.rewardUnlocks.view().balance, 100);
  assert.strictEqual(f.syncStore.state.localOwnerId, 'player_A');
  const sealedGuest = f.syncStore.scopeFor(null, null);
  assert.strictEqual(sealedGuest.sealed, true);
  assert.strictEqual(sealedGuest.supersededByMigrationReceipt, 'receipt_1');
  assert.strictEqual(sealedGuest.supersededByImportId, 'import_one');
  assert.strictEqual(f.syncStore.currentScope().migration.state, 'finalized');
  assert.deepStrictEqual(f.syncStore.migrationSnapshot('import_one', built.snapshotHash), built.snapshot,
    'finalization keeps the local source archive');
  assert.strictEqual(f.sessions.metadata().migrationState, 'complete');
  assert((await applier.applyMigrationFinalization(response(f.syncStore), f.app.captureAccountContext(),
    { importId: 'import_one', migrationReceiptId: 'receipt_1' })).alreadyApplied);
  const conflict = response(f.syncStore); conflict.domains.economy.balance = 101;
  assert.strictEqual((await applier.applySyncReceipt(conflict, f.app.captureAccountContext())).reason, 'idempotency-conflict');
  f.app.dispose();

  // A failed domain write leaves the stable pending receipt, every ACK and
  // the already-validated canonical response. Restart recovery must not rely
  // on the server returning byte-identical state after another device writes.
  const p = fixture(); p.app.progress.recordCompletion(0, 0, 1000);
  const initial = p.app.prepareLegacyMigration(); assert(initial.ok);
  assert(p.syncStore.activateScope('player_A', 1, 'test-env', true).ok);
  assert(p.syncStore.recordServerMigration({ importId: 'import_retry', policyVersion: initial.snapshot.policyVersion,
    snapshotHash: initial.snapshotHash, prepareReceiptId: 'prep_retry', role: 'PRIMARY', requiredChunks: [], completedChunks: [],
    snapshot: initial.snapshot }, p.syncStore.context()).ok);
  p.app.rewardUnlocks.setAuthorityMode('migration-freeze');
  const pApplier = new Applier({ progress: p.app.progress, daily: p.app.dailyProgress,
    rewards: p.app.rewardUnlocks, stamina: p.app.stamina, syncStore: p.syncStore, sessions: p.sessions }, p.app.accountGuard);
  const write = p.native.setStorageSync;
  p.native.setStorageSync = (key, value) => { if (key === 'cleared:minigame:reward-unlocks:v1') throw Error('disk'); write(key, value); };
  assert.strictEqual((await pApplier.applyMigrationFinalization(response(p.syncStore), p.app.captureAccountContext(),
    { importId: 'import_retry', migrationReceiptId: 'receipt_1' })).reason, 'persist-failed');
  assert(p.syncStore.currentScope().pendingApplication); assert.strictEqual(p.syncStore.currentScope().revisions.progress, 0);
  const disk = clone(p.native.storage); p.app.dispose();
  const resumed = fixture(disk);
  const resumedApplier = new Applier({ progress: resumed.app.progress, daily: resumed.app.dailyProgress,
    rewards: resumed.app.rewardUnlocks, stamina: resumed.app.stamina, syncStore: resumed.syncStore, sessions: resumed.sessions }, resumed.app.accountGuard);
  const recovered = await resumedApplier.resumePending(resumed.app.captureAccountContext());
  assert(recovered.ok); assert(recovered.resumed);
  assert.strictEqual(resumed.syncStore.currentScope().pendingApplication, null);
  assert.strictEqual(resumed.app.rewardUnlocks.view().balance, 100);
  resumed.app.dispose();

  // If the final SyncStore write fails after all domain stores were written,
  // revisions and ACK removal remain behind the durable pending application.
  // A restart replays the stored response and completes the same receipt.
  const q = fixture(); q.app.progress.recordCompletion(0, 0, 1000);
  const qBuilt = q.app.prepareLegacyMigration(); assert(qBuilt.ok);
  assert(q.syncStore.activateScope('player_A', 1, 'test-env', true).ok);
  assert(q.syncStore.recordServerMigration({ importId: 'import_finish_retry', policyVersion: qBuilt.snapshot.policyVersion,
    snapshotHash: qBuilt.snapshotHash, prepareReceiptId: 'prep_finish_retry', role: 'PRIMARY',
    requiredChunks: [], completedChunks: [], snapshot: qBuilt.snapshot }, q.syncStore.context()).ok);
  q.app.rewardUnlocks.setAuthorityMode('migration-freeze');
  const qApplier = new Applier({ progress: q.app.progress, daily: q.app.dailyProgress,
    rewards: q.app.rewardUnlocks, stamina: q.app.stamina, syncStore: q.syncStore, sessions: q.sessions }, q.app.accountGuard);
  const qWrite = q.native.setStorageSync; let onlineWrites = 0;
  q.native.setStorageSync = (key, value) => {
    if (key === SyncStore.STORAGE_KEY && ++onlineWrites === 2) throw Error('disk');
    return qWrite(key, value);
  };
  assert.strictEqual((await qApplier.applyMigrationFinalization(response(q.syncStore, { receiptId: 'receipt_finish_retry' }),
    q.app.captureAccountContext(), { importId: 'import_finish_retry', migrationReceiptId: 'migration_finish_retry' })).reason,
  'persist-failed');
  assert(q.syncStore.currentScope().pendingApplication);
  assert.strictEqual(q.syncStore.currentScope().revisions.progress, 0);
  const qDisk = clone(q.native.storage); q.app.dispose();
  const qRestart = fixture(qDisk);
  const qRestartApplier = new Applier({ progress: qRestart.app.progress, daily: qRestart.app.dailyProgress,
    rewards: qRestart.app.rewardUnlocks, stamina: qRestart.app.stamina,
    syncStore: qRestart.syncStore, sessions: qRestart.sessions }, qRestart.app.accountGuard);
  assert((await qRestartApplier.resumePending(qRestart.app.captureAccountContext())).ok);
  assert.strictEqual(qRestart.syncStore.currentScope().pendingApplication, null);
  assert.strictEqual(qRestart.syncStore.currentScope().revisions.progress, 1);
  qRestart.app.dispose();

  // Session metadata is the last migration checkpoint. Its failure cannot
  // undo the already-applied domains; replay repairs only the missing session.
  const s = fixture(); s.app.progress.recordCompletion(0, 0, 1000);
  const sBuilt = s.app.prepareLegacyMigration(); assert(sBuilt.ok);
  assert(s.syncStore.activateScope('player_A', 1, 'test-env', true).ok);
  assert(s.syncStore.recordServerMigration({ importId: 'import_session_retry', policyVersion: sBuilt.snapshot.policyVersion,
    snapshotHash: sBuilt.snapshotHash, prepareReceiptId: 'prep_session_retry', role: 'PRIMARY',
    requiredChunks: [], completedChunks: [], snapshot: sBuilt.snapshot }, s.syncStore.context()).ok);
  s.app.rewardUnlocks.setAuthorityMode('migration-freeze');
  const sApplier = new Applier({ progress: s.app.progress, daily: s.app.dailyProgress,
    rewards: s.app.rewardUnlocks, stamina: s.app.stamina, syncStore: s.syncStore, sessions: s.sessions }, s.app.accountGuard);
  const sWrite = s.native.setStorageSync; let failSession = true;
  s.native.setStorageSync = (key, value) => {
    if (key === SessionStore.STORAGE_KEY && failSession) { failSession = false; throw Error('disk'); }
    return sWrite(key, value);
  };
  const sResponse = response(s.syncStore, { receiptId: 'receipt_session_retry' });
  const sessionFailed = await sApplier.applyMigrationFinalization(sResponse, s.app.captureAccountContext(),
    { importId: 'import_session_retry', migrationReceiptId: 'migration_session_retry' });
  assert.strictEqual(sessionFailed.reason, 'persist-failed');
  assert.strictEqual(sessionFailed.domain, 'session');
  assert.strictEqual(s.syncStore.currentScope().pendingApplication, null);
  assert(s.syncStore.currentScope().lastApplication);
  const sessionRecovered = await sApplier.applyMigrationFinalization(sResponse, s.app.captureAccountContext(),
    { importId: 'import_session_retry', migrationReceiptId: 'migration_session_retry' });
  assert(sessionRecovered.ok); assert(sessionRecovered.alreadyApplied);
  assert.strictEqual(s.sessions.metadata().migrationState, 'complete');
  s.app.dispose();

  // The client must persist the frozen source before it changes authority.
  // If the separate archive write fails, no migration metadata or freeze is committed.
  const blockedArchive = fixture(); blockedArchive.app.progress.recordCompletion(0, 0, 1000);
  const blockedBuilt = blockedArchive.app.prepareLegacyMigration(); assert(blockedBuilt.ok);
  assert(blockedArchive.syncStore.activateScope('player_A', 1, 'test-env', true).ok);
  const originalWrite = blockedArchive.platform.setStorage.bind(blockedArchive.platform);
  blockedArchive.platform.setStorage = (key, value) => key === SyncStore.MIGRATION_ARCHIVE_KEY ? false : originalWrite(key, value);
  const blocked = blockedArchive.syncStore.recordServerMigration({ importId: 'import_archive_fail',
    policyVersion: blockedBuilt.snapshot.policyVersion, snapshotHash: blockedBuilt.snapshotHash,
    prepareReceiptId: 'prep_archive_fail', role: 'PRIMARY', requiredChunks: [], completedChunks: [],
    snapshot: blockedBuilt.snapshot }, blockedArchive.syncStore.context());
  assert.strictEqual(blocked.reason, 'persist-failed');
  assert.strictEqual(blockedArchive.syncStore.currentScope().migration, null);
  assert.strictEqual(blockedArchive.syncStore.authorityMode('progress'), 'legacy-local');
  blockedArchive.app.dispose();

  // A local mutation during the server prepare round trip must not be hidden
  // inside the older prepared import. The client remains local and unfrozen.
  const race = cloudFixture({ config: { migrationEnabled: true }, paused: new Set(['migration.prepare']) });
  try {
    assert(race.app.progress.recordCompletion(0, 0, 1000));
    race.reply = request => {
      const value = cloudEnvelope(request);
      if (request.action !== 'migration.prepare') return value;
      value.player.migrationState = 'prepared';
      value.data = { role: 'PRIMARY', status: 'PREPARED',
        requiredChunks: ['progress:resume', 'progress:0', 'economy:opening-balance', 'economy:ordinary-claims:0'],
        completedChunks: [], acceptedDomains: ['progress', 'daily', 'economy', 'entitlements'],
        deferredDomains: ['stamina', 'preferences'], economyBaselineExists: false, conflicts: [],
        prepareReceiptId: 'prep_race', receiptId: null };
      return value;
    };
    const running = race.app.resumeOnline(); await tick();
    const call = race.waits.shift(); assert(call); assert.strictEqual(call.data.action, 'migration.prepare');
    assert(race.app.progress.recordCompletion(0, 1, 900));
    call.success({ result: race.reply(call.data) });
    const raced = await running;
    assert.strictEqual(raced.reason, 'snapshot-changed');
    assert.strictEqual(race.sync.authorityMode('progress'), 'legacy-local');
    assert.strictEqual(race.sync.currentScope().migration, null);
  } finally { race.app.dispose(); }

  // The server may commit finalize while its response is lost. A retry must
  // resume the same import through migration.status and replay finalize,
  // rather than creating a second migration or rebuilding the snapshot.
  const lostFinalize = cloudFixture({ config: { migrationEnabled: true },
    paused: new Set(['migration.finalize']) });
  try {
    assert(lostFinalize.app.progress.recordCompletion(0, 0, 900));
    const importId = `import_${lostFinalize.sync.state.migrationId}`;
    const requiredChunks = ['progress:resume', 'progress:0', 'economy:opening-balance',
      'economy:ordinary-claims:0'];
    const core = ['progress', 'daily', 'economy', 'entitlements'];
    const revisions = { progress: 1, daily: 1, economy: 1, entitlements: 1, stamina: 0, preferences: 0 };
    const domains = { progress: { schemaVersion: 1,
      levels: { '0:0': { completed: true, bestMs: 900 } }, lastPlayed: null },
    daily: { schemaVersion: 1, days: {} },
    economy: { schemaVersion: 1, balance: 100, claimedOrdinary: { '0:0': true }, claimedDaily: {} },
    entitlements: { schemaVersion: 1, ownedRewards: { 'theme:classic': true, 'effect:none': true } } };
    let finalized = false; const completedChunks = [];
    lostFinalize.reply = request => {
      const value = cloudEnvelope(request); value.revisions = finalized ? clone(revisions) : value.revisions;
      if (finalized) value.player = { playerId: 'player_A', bindingEpoch: 1, migrationState: 'complete',
        hasCloudState: true, completedDomains: core.slice(), deferredDomains: ['stamina', 'preferences'],
        migrationImportId: importId, migrationReceiptId: 'migration_lost_finalize' };
      if (request.action === 'identity.init') { delete value.data; return value; }
      if (request.action === 'state.read' && finalized) {
        value.data = { changedDomains: clone(domains), hasCloudState: true, readOnlyPhase: false,
          completedDomains: core.slice(), deferredDomains: ['stamina', 'preferences'],
          migrationImportId: importId, migrationReceiptId: 'migration_lost_finalize',
          receiptId: 'state_after_lost_finalize', acceptedOperationIds: [] };
      } else if (request.action === 'migration.prepare') {
        value.player.migrationState = 'prepared';
        value.data = { role: 'PRIMARY', status: 'PREPARED', requiredChunks: requiredChunks.slice(),
          completedChunks: [], acceptedDomains: core.slice(), deferredDomains: ['stamina', 'preferences'],
          economyBaselineExists: false, conflicts: [], prepareReceiptId: 'prep_lost_finalize', receiptId: null };
      } else if (request.action === 'migration.commitChunk') {
        value.player.migrationState = 'prepared'; completedChunks.push(request.payload.chunkId);
        value.data = { chunkId: request.payload.chunkId, serverHash: 'a'.repeat(64),
          chunkReceiptId: `chunk_lost_${completedChunks.length}`, completedChunks: completedChunks.slice(), conflicts: [] };
      } else if (request.action === 'migration.status') {
        value.data = { role: 'PRIMARY', status: 'FINALIZED', requiredChunks: requiredChunks.slice(),
          completedChunks: requiredChunks.slice(), acceptedDomains: core.slice(),
          deferredDomains: ['stamina', 'preferences'], economyBaselineExists: false, conflicts: [],
          prepareReceiptId: 'prep_lost_finalize', receiptId: 'migration_lost_finalize' };
      } else if (request.action === 'migration.finalize') {
        value.data = { receiptId: 'migration_response_lost_finalize',
          migrationReceiptId: 'migration_lost_finalize', role: 'PRIMARY', completedDomains: core.slice(),
          deferredDomains: ['stamina', 'preferences'], conflicts: [], revisions: clone(revisions),
          domains: clone(domains), acceptedOperationIds: [] };
      }
      return value;
    };
    const localReply = lostFinalize.reply;
    lostFinalize.reply = request => vm.runInNewContext('JSON.parse(payload)', {
      payload: JSON.stringify(localReply(request))
    });
    const firstRun = lostFinalize.app.resumeOnline();
    for (let index = 0; index < 20 && !lostFinalize.waits.length; index++) await tick();
    const lostCall = lostFinalize.waits.shift(); assert(lostCall);
    assert.strictEqual(lostCall.data.action, 'migration.finalize'); finalized = true;
    lostFinalize.paused.delete('migration.finalize'); lostCall.fail({ errMsg: 'timeout' });
    assert.strictEqual((await firstRun).reason, 'timeout');
    assert.strictEqual(lostFinalize.sync.authorityMode('progress'), 'migration-freeze');
    assert.deepStrictEqual(lostFinalize.sync.currentScope().migration.completedChunks.slice().sort(),
      requiredChunks.slice().sort());

    const recovered = await lostFinalize.app.resumeOnline();
    assert(recovered.ok); assert(recovered.migrated);
    assert.strictEqual(lostFinalize.sync.state.localOwnerId, 'player_A');
    assert.strictEqual(lostFinalize.app.rewardUnlocks.view().balance, 100);
    assert.strictEqual(lostFinalize.sync.currentScope().migration.importId, importId);
    assert.deepStrictEqual(lostFinalize.calls.filter(call => call.data.action === 'migration.prepare').length, 1);
    assert.deepStrictEqual(lostFinalize.calls.filter(call => call.data.action === 'migration.finalize').length, 2);
  } finally { lostFinalize.app.dispose(); }

  // The client derives the complete chunk manifest from the frozen snapshot.
  // A server response that omits a required resume record cannot trigger the
  // local freeze or silently finalize a partial migration.
  const badManifest = cloudFixture({ config: { migrationEnabled: true } });
  try {
    assert(badManifest.app.progress.recordCompletion(0, 0, 1000));
    badManifest.reply = request => {
      const value = cloudEnvelope(request);
      if (request.action === 'migration.prepare') {
        value.player.migrationState = 'prepared';
        value.data = { role: 'PRIMARY', status: 'PREPARED',
          requiredChunks: ['progress:0', 'economy:opening-balance', 'economy:ordinary-claims:0'],
          completedChunks: [], acceptedDomains: ['progress', 'daily', 'economy', 'entitlements'],
          deferredDomains: ['stamina', 'preferences'], economyBaselineExists: false, conflicts: [],
          prepareReceiptId: 'prep_bad_manifest', receiptId: null };
      }
      return value;
    };
    const rejected = await badManifest.app.resumeOnline();
    assert.strictEqual(rejected.reason, 'invalid-response');
    assert.strictEqual(badManifest.sync.authorityMode('progress'), 'legacy-local');
    assert.strictEqual(badManifest.sync.currentScope().migration, null);
  } finally { badManifest.app.dispose(); }

  // Completed chunk IDs are monotonic. Losing an earlier server receipt in a
  // later response stops the retryable migration without advancing locally.
  const shrinkingChunks = cloudFixture({ config: { migrationEnabled: true } });
  try {
    shrinkingChunks.reply = request => {
      const value = cloudEnvelope(request);
      if (request.action === 'migration.prepare') {
        value.player.migrationState = 'prepared';
        value.data = { role: 'PRIMARY', status: 'PREPARED',
          requiredChunks: ['progress:resume', 'economy:opening-balance'], completedChunks: [],
          acceptedDomains: ['progress', 'daily', 'economy', 'entitlements'],
          deferredDomains: ['stamina', 'preferences'], economyBaselineExists: false, conflicts: [],
          prepareReceiptId: 'prep_shrinking', receiptId: null };
      } else if (request.action === 'migration.commitChunk') {
        const chunkId = request.payload.chunkId;
        value.player.migrationState = 'uploading';
        value.data = { chunkId, serverHash: 'a'.repeat(64),
          chunkReceiptId: `chunk_${chunkId.replace(':', '_')}`,
          completedChunks: [chunkId], conflicts: [] };
      }
      return value;
    };
    const rejected = await shrinkingChunks.app.resumeOnline();
    assert.strictEqual(rejected.reason, 'invalid-response');
    assert.strictEqual(shrinkingChunks.sync.authorityMode('progress'), 'migration-freeze');
    assert.deepStrictEqual(shrinkingChunks.sync.currentScope().migration.completedChunks, ['progress:resume']);
  } finally { shrinkingChunks.app.dispose(); }

  // A real supplemental client flow exposes the server conflict summary and
  // keeps the exact rejected local economy snapshot in the separate archive.
  const supplemental = cloudFixture({ config: { migrationEnabled: true } });
  try {
    assert(supplemental.app.progress.recordCompletion(0, 0, 900));
    const core = ['progress', 'daily', 'economy', 'entitlements'];
    const revisions = { progress: 2, daily: 2, economy: 2, entitlements: 2, stamina: 0, preferences: 0 };
    const domains = { progress: { schemaVersion: 1, levels: {
      '0:0': { completed: true, bestMs: 900 }, '0:1': { completed: true, bestMs: 800 }
    }, lastPlayed: null }, daily: { schemaVersion: 1, days: {} },
    economy: { schemaVersion: 1, balance: 500, claimedOrdinary: { '0:1': true }, claimedDaily: {} },
    entitlements: { schemaVersion: 1, ownedRewards: { 'theme:classic': true, 'effect:none': true } } };
    const conflicts = ['economy:balance', 'economy:ordinary-claims'];
    supplemental.reply = request => {
      const value = cloudEnvelope(request); value.revisions = clone(revisions);
      value.player = { playerId: 'player_A', bindingEpoch: 1, migrationState: 'complete', hasCloudState: true,
        completedDomains: core.slice(), deferredDomains: ['stamina', 'preferences'],
        migrationImportId: 'import_primary', migrationReceiptId: 'migration_primary' };
      if (request.action === 'identity.init') { value.bindingStatus = 'UNBOUND'; delete value.data; return value; }
      if (request.action === 'state.read') {
        value.data = { changedDomains: clone(domains), hasCloudState: true, readOnlyPhase: false,
          completedDomains: core.slice(), deferredDomains: ['stamina', 'preferences'],
          migrationImportId: 'import_primary', migrationReceiptId: 'migration_primary',
          receiptId: 'state_existing', acceptedOperationIds: [] };
      } else if (request.action === 'migration.prepare') {
        value.data = { role: 'SUPPLEMENTAL', status: 'PREPARED', requiredChunks: ['progress:resume', 'progress:0'],
          completedChunks: [], acceptedDomains: core.slice(), deferredDomains: ['stamina', 'preferences'],
          economyBaselineExists: true, conflicts: conflicts.slice(), prepareReceiptId: 'prep_supplemental', receiptId: null };
      } else if (request.action === 'migration.commitChunk') {
        const chunkId = request.payload.chunkId;
        value.data = { chunkId, serverHash: 'a'.repeat(64), chunkReceiptId: `chunk_supplemental_${chunkId.replace(':', '_')}`,
          completedChunks: chunkId === 'progress:resume' ? ['progress:resume'] : ['progress:resume', 'progress:0'],
          conflicts: conflicts.slice() };
      } else if (request.action === 'migration.finalize') {
        value.data = { receiptId: 'migration_supplemental', migrationReceiptId: 'migration_supplemental',
          role: 'SUPPLEMENTAL', completedDomains: core.slice(), deferredDomains: ['stamina', 'preferences'],
          conflicts: conflicts.slice(), revisions: clone(revisions), domains: clone(domains), acceptedOperationIds: [] };
      }
      return value;
    };
    const result = await supplemental.app.resumeOnline();
    assert(result.ok); assert.strictEqual(result.role, 'SUPPLEMENTAL');
    assert.deepStrictEqual(result.conflicts, conflicts); assert.strictEqual(result.localSnapshotPreserved, true);
    assert.strictEqual(supplemental.app.accountMessage, '补充存档已合并，2项冲突未导入；原本地存档已保留');
    assert.strictEqual(supplemental.app.rewardUnlocks.view().balance, 500, 'server economy remains authoritative');
    const migration = supplemental.sync.currentScope().migration;
    const preserved = supplemental.sync.migrationSnapshot(migration.importId, migration.snapshotHash);
    assert(preserved); assert.strictEqual(preserved.economy.balance, 100,
      'the rejected secondary-device balance remains locally recoverable and is not added to the server wallet');
  } finally { supplemental.app.dispose(); }
}

run.fixture = fixture; run.response = response; run.NOW = NOW;
module.exports = run;
