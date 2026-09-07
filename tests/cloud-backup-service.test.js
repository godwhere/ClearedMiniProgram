'use strict';

const assert = require('assert');
const ProgressStore = require('../src/services/progress-store.js');
const DailyProgressStore = require('../src/services/daily-progress-store.js');
const RewardUnlockService = require('../src/services/reward-unlock-service.js');
const StaminaService = require('../src/services/stamina-service.js');
const PreferencesService = require('../src/services/preferences-service.js');
const SyncStore = require('../src/services/sync-store.js');
const BackupSnapshot = require('../src/services/backup-snapshot.js');
const CloudBackupService = require('../src/services/cloud-backup-service.js');
const AuthoritativeStateApplier = require('../src/services/authoritative-state-applier.js');
const rewardConfig = require('../src/config/rewards.js');

function platform() {
  const storage = {}; let failKey = null;
  return { storage, getStorage: key => storage[key], readStorageResult: key =>
    ({ ok: true, found: Object.prototype.hasOwnProperty.call(storage, key), value: storage[key] }),
  setStorage(key, value) { if (key === failKey) return false; storage[key] = JSON.parse(JSON.stringify(value)); return true; },
  fail: key => { failKey = key; } };
}

function envelope(requestId, data) {
  return { ok: true, code: 'OK', requestId, protocolVersion: 1, retryable: false,
    environmentId: 'test-env', serverTimeMs: Date.parse('2026-09-07T00:00:00Z'), serverDateKey: '2026-09-07',
    player: { playerId: 'player_backup_A', bindingEpoch: 1, migrationState: 'none', hasCloudState: false,
      completedDomains: [], deferredDomains: ['stamina', 'preferences'], migrationImportId: null, migrationReceiptId: null },
    revisions: { progress: 0, daily: 0, economy: 0, entitlements: 0, stamina: 0, preferences: 0 }, data };
}

function setup(options) {
  const opts = options || {}; const host = opts.host || platform(); let now = 1000000; const calls = [];
  const progress = new ProgressStore(host); const daily = new DailyProgressStore(host);
  const rewards = new RewardUnlockService(host, rewardConfig); const stamina = new StaminaService(host);
  const preferences = new PreferencesService(progress); const store = new SyncStore(host);
  assert(store.activateScope('player_backup_A', 1, 'test-env', true).ok);
  const session = { mode: 'cloud', ownerId: 'player_backup_A', bindingEpoch: 1, environmentId: 'test-env', generation: 1 };
  const auth = { current: () => session };
  const account = () => ({ ownerIdAtStart: session.ownerId, bindingEpochAtStart: session.bindingEpoch,
    environmentIdAtStart: session.environmentId, activationSequenceAtStart: store.context().activationSequence,
    accountGenerationAtStart: session.generation, identityAtStart: `cloud:${session.environmentId}:${session.ownerId}:1` });
  const guard = { capture: account, matches: token => token && token.ownerIdAtStart === session.ownerId &&
    token.bindingEpochAtStart === session.bindingEpoch && token.environmentIdAtStart === session.environmentId &&
    token.activationSequenceAtStart === store.context().activationSequence };
  const applier = new AuthoritativeStateApplier({ progress, daily, rewards, stamina, preferences, syncStore: store }, guard);
  const snapshots = new BackupSnapshot({ progress, daily, rewards, stamina, preferences }, { dateKey: () => '2026-09-07' });
  let responder = async request => ({ ok: true, data: envelope(request.requestId,
    request.action === 'backup.read' ? { found: false, cloudVersion: 0 }
      : { status: 'COMMITTED', cloudVersion: request.payload.baseVersion + 1,
        requestId: request.requestId, snapshotHash: request.payload.snapshotHash }) });
  const api = { request: request => { calls.push(request); return responder(request); } };
  const service = new CloudBackupService(api, auth, store, snapshots, applier,
    { localBackupEnabled: true }, { now: () => now, initialArchive: opts.initialArchive || { known: true, exists: true } });
  service.accountGuard = guard;
  return { host, progress, daily, rewards, stamina, preferences, store, session, guard, applier, snapshots,
    service, calls, envelope, advance: ms => { now += ms; }, respond: fn => { responder = fn; } };
}

async function run() {
  const f = setup(); assert((await f.service.bootstrap(f.session)).ok);
  assert.strictEqual(f.store.authorityMode('economy'), 'local-backup');
  f.calls.length = 0;
  f.progress.recordCompletion(0, 0, 1000); assert(f.progress.save()); assert(f.store.markBackupDirty(f.store.context()));
  assert.strictEqual(f.calls.length, 0, 'gameplay changes do not request backup or settlement');
  const first = await f.service.atCheckpoint('home');
  assert(first.ok); assert.deepStrictEqual(f.calls.map(call => call.action), ['backup.commit']);
  assert.strictEqual(f.store.currentScope().backup.dirty, false);
  assert((await f.service.atCheckpoint('account')).skipped, 'no local change means no request');
  f.progress.recordCompletion(0, 1, 900); assert(f.progress.save()); assert(f.store.markBackupDirty(f.store.context()));
  assert((await f.service.atCheckpoint('home')).skipped, 'automatic backup respects the three-minute attempt cooldown');
  assert.strictEqual(f.calls.length, 1);
  await f.service.atCheckpoint('manual');
  assert.strictEqual(f.calls.length, 2, 'manual backup bypasses cooldown');

  let finish;
  f.respond(request => new Promise(resolve => { finish = () => resolve({ ok: true, data: f.envelope(request.requestId,
    { status: 'COMMITTED', cloudVersion: 3, requestId: request.requestId, snapshotHash: request.payload.snapshotHash }) }); }));
  f.advance(180000); f.progress.recordCompletion(1, 0, 800); assert(f.progress.save()); assert(f.store.markBackupDirty(f.store.context()));
  const flight = f.service.atCheckpoint('home');
  assert.strictEqual(f.service.atCheckpoint('account'), flight, 'repeated triggers reuse the in-flight snapshot');
  f.progress.recordCompletion(1, 1, 700); assert(f.progress.save()); assert(f.store.markBackupDirty(f.store.context()));
  const balance = f.rewards.view().balance; finish(); const result = await flight;
  assert(result.ok && result.newerLocalChanges, 'old acknowledgement cannot clear changes made during upload');
  assert.strictEqual(f.store.currentScope().backup.dirty, true);
  assert.strictEqual(f.rewards.view().balance, balance, 'backup acknowledgement never writes wallet state back locally');
}

run.setup = setup;
module.exports = run;
