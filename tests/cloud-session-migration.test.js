'use strict';

const assert = require('assert');
const SyncStore = require('../src/services/sync-store.js');
const ProgressStore = require('../src/services/progress-store.js');
const DailyStore = require('../src/services/daily-progress-store.js');
const Rewards = require('../src/services/reward-unlock-service.js');
const Stamina = require('../src/services/stamina-service.js');
const Builder = require('../src/services/legacy-migration-builder.js');
const Applier = require('../src/services/authoritative-state-applier.js');
const App = require('../src/app.js');
const Platform = require('../src/platform/wechat.js');
const { RewardPlatform } = require('./helpers/reward-fixture.js');
const { fakeApi } = require('./account-bootstrap.test.js');
const { operation } = require('./cloud-account-scope.test.js');
const { clone, canonical } = require('../src/services/sync-payload.js');
const rewardConfig = require('../src/config/rewards.js');
const NOW = Date.parse('2026-09-04T00:00:00Z');
const applyCurrent = (app, reply) => app.applyAuthoritativeState(reply, app.captureAccountContext());

function v1(userId) {
  return { schemaVersion: 1, installId: 'ins_original', migrationId: 'mig_original', boundUserId: userId,
    serverRevision: 9, nextOperationSequence: 42, pendingOperations: [
      { operationId: 'ins_original:40', type: 'level_completed', payload: operation().payload },
      { operationId: 'ins_original:41', type: 'level_completed', payload: { levelKey: '0:1', completedAtClient: 10 } }
    ], snapshotRequired: true, lastSyncAt: 1000, lastError: 'timeout' };
}
function fixture(seed) {
  const native = fakeApi(); Object.assign(native.storage, clone(seed || {}));
  const platform = new Platform(native); const syncStore = new SyncStore(platform);
  const app = new App(platform, { syncStore, clock: () => new Date(NOW) });
  return { native, platform, syncStore, app };
}
function response(store, extra) {
  return Object.assign({ schemaVersion: 1, protocolVersion: 1, ownerId: store.context().ownerId,
    bindingEpoch: store.context().bindingEpoch, receiptId: 'receipt_1', revisions: Object.assign({}, store.currentScope().revisions, { progress: 1, stamina: 1 }),
    domains: { progress: { schemaVersion: 1, levels: { '0:0': { completed: true, bestMs: 1000 } } },
      stamina: { schemaVersion: 1, balance: 3, nextRecoveryAt: NOW + 300000, unlockedLevels: ['0:0'], refundedLevels: ['0:0'] } },
    acceptedOperationIds: store.currentScope().pendingOperations.map(item => item.operationId) }, extra);
}

async function run() {
  const completions = { ordinary: { ok: true, levelKeys: ['0:0'] }, daily: { ok: true,
    days: [{ dateKey: '2026-09-04', dayId: 'daily-test', levelIds: ['intro', 'extreme'] }] } };
  for (const mode of ['legacy-local', 'migration-freeze', 'cloud-authoritative']) {
    const wallet = new Rewards(new RewardPlatform(), rewardConfig); assert(wallet.setAuthorityMode(mode));
    const result = wallet.reconcile(completions);
    assert.strictEqual(result.amountDelta, mode === 'legacy-local' ? 600 : 0);
    assert.strictEqual(wallet.view().balance, mode === 'legacy-local' ? 600 : 0);
  }
  for (const owner of [null, 'alice']) {
    const source = v1(owner); const host = new RewardPlatform({ [SyncStore.STORAGE_KEY]: source });
    const store = new SyncStore(host);
    assert.strictEqual(store.state.schemaVersion, 2); assert(store.persisted);
    assert.strictEqual(store.state.activeOwnerId, owner ? SyncStore.legacyOwnerId(owner) : null);
    assert.strictEqual(store.state.installId, source.installId); assert.strictEqual(store.state.migrationId, source.migrationId);
    assert.strictEqual(store.state.nextOperationSequence, 42); assert.strictEqual(store.state.boundUserId, owner);
    assert.strictEqual(store.currentScope().revisions.progress, 9);
    assert.deepStrictEqual(store.currentScope().pendingOperations.map(item => ({ operationId: item.operationId, type: item.type, payload: item.payload })), source.pendingOperations);
    assert(store.currentScope().pendingOperations.every(item => item.ownerIdAtCreation === store.state.activeOwnerId && item.bindingEpochAtCreation === 0));
    assert.deepStrictEqual(store.state.legacyBackup, source);
    const again = new SyncStore(host); assert.deepStrictEqual(again.state, store.state);
    assert.strictEqual(again.nextId(), 'ins_original:42');
    assert.deepStrictEqual(again.state.legacyBackup, source, 'backup is immutable history, never the active queue');
    const failing = new RewardPlatform({ [SyncStore.STORAGE_KEY]: source }); failing.writeFailures[SyncStore.STORAGE_KEY] = true;
    const pending = new SyncStore(failing); assert.strictEqual(pending.persisted, false);
    assert.deepStrictEqual(failing.storage[SyncStore.STORAGE_KEY], source);
    assert.strictEqual(pending.activateScope('player_B', 1).ok, false);
    failing.writeFailures[SyncStore.STORAGE_KEY] = false;
    assert.deepStrictEqual(new SyncStore(failing).state.legacyBackup, source);
  }
  for (const bad of [{ boundUserId: '../bad' }, { installId: null }, { migrationId: null },
    { pendingOperations: [Object.assign({}, v1('alice').pendingOperations[0], { payload: {} })] }]) {
    const source = Object.assign(v1('alice'), bad); const host = new RewardPlatform({ [SyncStore.STORAGE_KEY]: source });
    const store = new SyncStore(host); assert(store.blocked); assert.strictEqual(store.nextId(), null);
    assert.strictEqual(store.activateScope('player_B', 1).ok, false);
    assert.deepStrictEqual(host.storage[SyncStore.STORAGE_KEY], source, 'corrupt bound data is not rewritten as guest');
  }

  const f = fixture(); const { app, syncStore } = f;
  app.progress.recordCompletion(0, 0, 61000);
  const prepared = app.prepareLegacyMigration(); assert(prepared.ok);
  assert.strictEqual(prepared.snapshot.economy.balance, 100, 'last legacy recovery occurs before freeze');
  assert.strictEqual(syncStore.state.authorityMode, 'migration-freeze');
  assert.strictEqual(app.rewardUnlocks.authorityMode(), 'migration-freeze');
  assert.strictEqual(app.recoverRewardUnlocks().amountDelta, 0);
  assert.strictEqual(app.rewardUnlocks.reconcile({}).amountDelta, 0);
  assert.strictEqual(app.rewardUnlocks.purchase('theme:desserts').reason, 'migration-freeze');
  const services = { progress: app.progress, daily: app.dailyProgress, rewards: app.rewardUnlocks, stamina: app.stamina, syncStore };
  const builder = new Builder(services); const disk = canonical(f.native.storage);
  assert.deepStrictEqual(builder.buildSnapshot(), builder.buildSnapshot());
  assert.strictEqual(canonical(f.native.storage), disk, 'builder never writes or settles time');
  const second = app.prepareLegacyMigration(); assert(second.alreadyPrepared);
  assert.strictEqual(second.migration.importId, prepared.migration.importId);
  assert.strictEqual(second.snapshotHash, prepared.snapshotHash);
  const reboot = fixture(f.native.storage);
  assert.strictEqual(reboot.app.rewardUnlocks.authorityMode(), 'migration-freeze');
  assert.strictEqual(reboot.app.prepareLegacyMigration().snapshotHash, prepared.snapshotHash);
  app.progress.recordCompletion(0, 1, 62000);
  assert.strictEqual(app.prepareLegacyMigration().reason, 'snapshot-changed');
  assert.strictEqual(app.rewardUnlocks.view().balance, 100, 'new local clears are not mistaken for frozen historical income');
  app.dispose(); reboot.app.dispose();

  const pureHost = new RewardPlatform(); const progress = new ProgressStore(pureHost);
  const daily = new DailyStore(pureHost); const rewards = new Rewards(pureHost, rewardConfig);
  const stamina = new Stamina(pureHost); stamina.snapshot(NOW);
  const queue = new SyncStore(pureHost);
  rewards.state.ownedRewards['theme:space'] = true;
  rewards.state.pendingNotices.push('theme:space'); rewards.state.secret = 'exclude-me';
  progress.state.settings.skinId = 'classic'; progress.state.settings.accessToken = 'exclude-me';
  progress.state.settings.soundEnabled = false;
  pureHost.setStorage('session-test', { openid: 'exclude-me', session_key: 'exclude-me' });
  assert(daily.recordEntry({ dateKey: '2026-09-04', dayId: 'daily-test', entryLimit: 3,
    levelIds: ['intro', 'extreme'], idempotencyKey: 'entry_1' }).ok);
  const clean = new Builder({ progress, daily, rewards, stamina, syncStore: queue }).buildSnapshot(); assert(clean.ok);
  assert.deepStrictEqual(clean.snapshot.daily.days['2026-09-04'].levelIds, ['intro', 'extreme'], 'daily order is levelIndex order, not alphabetic ID order');
  assert(clean.snapshot.entitlements.ownedRewards['theme:space']);
  assert.strictEqual(clean.snapshot.preferences.skinId, 'classic');
  assert.strictEqual(clean.snapshot.preferences.soundEnabled, false);
  assert(!canonical(clean.snapshot).includes('exclude-me')); assert(!canonical(clean.snapshot).includes('pendingNotices'));
  assert(!canonical(clean.snapshot).includes('legacyBackup'));
  for (const field of ['accessToken', 'session_key', 'openid', 'AppSecret', 'pendingNotices',
    'adAttempts', 'pendingOperations', 'assetState', 'shareQuery', 'pointer']) assert(!canonical(clean.snapshot).includes(field));
  assert(Object.isFrozen(clean.snapshot));

  // Real stores, partial persistence, process restart, then replay the SAME
  // canonical receipt. No multi-key atomicity is claimed.
  const apply = fixture(); assert(apply.syncStore.enqueue(operation().payload));
  const canonicalResponse = response(apply.syncStore);
  const write = apply.native.setStorageSync;
  apply.native.setStorageSync = (key, value) => { if (key === 'cleared:minigame:stamina:v1') throw Error('stamina disk'); write(key, value); };
  const failed = await apply.app.applyAuthoritativeState(canonicalResponse, apply.app.captureAccountContext());
  assert.strictEqual(failed.reason, 'persist-failed'); assert(apply.app.progress.isCompleted(0, 0));
  assert.strictEqual(apply.syncStore.currentScope().revisions.progress, 0);
  assert.strictEqual(apply.syncStore.currentScope().pendingOperations.length, 1);
  assert.strictEqual(apply.app.recoverRewardUnlocks().amountDelta, 0);
  assert.strictEqual(apply.app.rewardUnlocks.view().balance, 0, 'cloud completed must not grant +100');
  const resumed = fixture(apply.native.storage);
  assert.strictEqual(resumed.app.rewardUnlocks.view().balance, 0, 'partial cloud application cannot reboot into legacy recovery');
  assert((await applyCurrent(resumed.app, canonicalResponse)).ok);
  assert.strictEqual(resumed.syncStore.currentScope().pendingOperations.length, 0);
  assert.strictEqual(resumed.syncStore.currentScope().revisions.progress, 1);
  assert.strictEqual(resumed.app.stamina.snapshot(NOW).balance, 3);
  let recovered = 0;
  resumed.app.rewardUnlocks.reconcile = () => { recovered++; return { ok: true, amountDelta: 100, newRewards: [] }; };
  resumed.app.stamina.refundQuickClear = () => { recovered++; return { ok: true, refunded: 1 }; };
  assert.strictEqual(resumed.app.recoverRewardUnlocks().amountDelta, 0);
  resumed.app.recoverStaminaRefunds(NOW); assert.strictEqual(recovered, 0, 'App recovery gates run before domain calls');
  resumed.app.recoverStaminaRefunds(NOW);
  assert.strictEqual(resumed.app.stamina.snapshot(NOW).balance, 3);
  assert((await applyCurrent(resumed.app, canonicalResponse)).alreadyApplied);
  assert((await applyCurrent(resumed.app, Object.assign({}, canonicalResponse,
    { requestId: 'req_retry', serverTimeMs: NOW + 1000 }))).alreadyApplied, 'transport metadata cannot turn a receipt replay into a conflict');
  const conflicting = clone(canonicalResponse); conflicting.domains.stamina.balance = 2;
  assert.strictEqual((await applyCurrent(resumed.app, conflicting)).reason, 'idempotency-conflict');
  assert.strictEqual(resumed.app.rewardUnlocks.setAuthorityMode('legacy-local'), false);
  assert.strictEqual(resumed.syncStore.setAuthorityMode('legacy-local', resumed.syncStore.context()), false);
  apply.app.dispose(); resumed.app.dispose();

  for (const failure of [1, 2, 3, 4]) {
    const checkpoint = fixture(); assert(checkpoint.syncStore.enqueue(operation().payload));
    const receipt = response(checkpoint.syncStore); const persist = checkpoint.native.setStorageSync; let writes = 0;
    checkpoint.native.setStorageSync = (key, value) => { if (++writes === failure) throw Error('checkpoint'); persist(key, value); };
    assert.strictEqual((await applyCurrent(checkpoint.app, receipt)).reason, 'persist-failed');
    assert.strictEqual(checkpoint.syncStore.currentScope().revisions.progress, 0);
    assert.strictEqual(checkpoint.syncStore.currentScope().pendingOperations.length, 1);
    const restarted = fixture(checkpoint.native.storage);
    assert.strictEqual(restarted.app.rewardUnlocks.view().balance, 0);
    assert((await applyCurrent(restarted.app, receipt)).ok);
    assert.strictEqual(restarted.syncStore.currentScope().revisions.progress, 1);
    assert.strictEqual(restarted.syncStore.currentScope().pendingOperations.length, 0);
    assert.strictEqual(restarted.app.rewardUnlocks.view().balance, 0);
    checkpoint.app.dispose(); restarted.app.dispose();
  }

  const invalidApply = fixture(); const invalidBefore = canonical(invalidApply.native.storage);
  const invalidState = response(invalidApply.syncStore); invalidState.domains.stamina.balance = -1;
  assert.strictEqual((await applyCurrent(invalidApply.app, invalidState)).reason, 'invalid-snapshot');
  assert.strictEqual(canonical(invalidApply.native.storage), invalidBefore, 'invalid later domain rejected before the first write');
  const missing = response(invalidApply.syncStore); missing.revisions.economy = 1;
  assert.strictEqual((await applyCurrent(invalidApply.app, missing)).reason, 'missing-domain');
  const unsupported = response(invalidApply.syncStore); unsupported.domains.economy = { balance: 10 }; unsupported.revisions.economy = 1;
  assert.strictEqual((await applyCurrent(invalidApply.app, unsupported)).reason, 'domain-not-supported');
  assert.strictEqual(canonical(invalidApply.native.storage), invalidBefore);
  invalidApply.app.dispose();
  const missingDomain = fixture();
  assert(missingDomain.syncStore.enqueueOperation({ domain: 'economy', type: 'future_purchase', payload: {}, occurredAtClient: 100 }).ok);
  const missingBefore = canonical(missingDomain.native.storage);
  assert.strictEqual((await applyCurrent(missingDomain.app, response(missingDomain.syncStore))).reason, 'missing-domain');
  assert.strictEqual(canonical(missingDomain.native.storage), missingBefore); missingDomain.app.dispose();

  const order = fixture(); assert(order.syncStore.enqueue(operation().payload)); const steps = [];
  const applyDomain = value => { steps.push(value.name); return { ok: true }; };
  const fake = { mergeCloudSnapshot: applyDomain, applyAuthoritativeSnapshot: applyDomain, setAuthorityMode: () => true };
  const orderedResponse = response(order.syncStore, { domains: Object.fromEntries(SyncStore.DOMAINS.slice().reverse().map(name => [name, name === 'progress'
    ? { schemaVersion: 1, levels: {}, name } : { name }])), revisions: Object.fromEntries(SyncStore.DOMAINS.map(name => [name, 1])) });
  const ordered = new Applier({ syncStore: order.syncStore, progress: fake, daily: fake, rewards: fake, stamina: fake });
  assert((await ordered.apply(orderedResponse, ordered.capture())).ok); assert.deepStrictEqual(steps, SyncStore.DOMAINS);
  order.app.dispose();

  const futureAck = fixture(); const queued = futureAck.syncStore.enqueueOperation(operation()); assert(queued.ok);
  const futureId = `${futureAck.syncStore.state.installId}:${futureAck.syncStore.state.nextOperationSequence}`;
  const futureResponse = response(futureAck.syncStore, { acceptedOperationIds: [queued.operationId, futureId] });
  const merge = futureAck.app.progress.mergeCloudSnapshot.bind(futureAck.app.progress);
  futureAck.app.progress.mergeCloudSnapshot = value => {
    const applied = merge(value); assert(futureAck.syncStore.enqueue(operation(900).payload)); return applied;
  };
  assert((await applyCurrent(futureAck.app, futureResponse)).ok);
  assert.deepStrictEqual(futureAck.syncStore.currentScope().pendingOperations.map(item => item.operationId), [futureId], 'unsent operations created during application are never ACKed');
  futureAck.app.dispose();

  const energyHost = new RewardPlatform(); const energy = new Stamina(energyHost); energy.snapshot(NOW);
  energy.setAuthorityMode('cloud-authoritative');
  const overflow = { schemaVersion: 1, balance: 8, nextRecoveryAt: null, unlockedLevels: ['0:0'], refundedLevels: [] };
  assert(energy.applyAuthoritativeSnapshot(overflow).ok); assert.strictEqual(energy.snapshot(NOW).balance, 8);
  for (const bad of [{ balance: -1 }, { balance: 1.5 }, { balance: Number.MAX_SAFE_INTEGER + 1 },
    { schemaVersion: 2 }, { balance: 3, nextRecoveryAt: null }, { nextRecoveryAt: NOW },
    { unlockedLevels: ['bad'] }, { unlockedLevels: ['0:0', '0:0'] }, { refundedLevels: ['0:1'] }, { refundedLevels: ['0:0', '0:0'] }]) {
    assert.strictEqual(energy.applyAuthoritativeSnapshot(Object.assign({}, overflow, bad)).ok, false);
    assert.strictEqual(energy.snapshot(NOW).balance, 8);
  }
  energyHost.writeFailures['cleared:minigame:stamina:v1'] = true;
  assert.strictEqual(energy.applyAuthoritativeSnapshot(Object.assign({}, overflow, { balance: 7 })).reason, 'persist-failed');
  assert.strictEqual(energy.snapshot(NOW).balance, 8);
  energyHost.writeFailures['cleared:minigame:stamina:v1'] = false;
  assert(energy.applyAuthoritativeSnapshot({ schemaVersion: 1, balance: 3, nextRecoveryAt: NOW + 300000,
    unlockedLevels: ['0:0'], refundedLevels: [] }).ok);
  assert.strictEqual(energy.refundQuickClear('0:0', 1000, NOW).refunded, 0, 'mode gate works even without a refund marker');
  assert.strictEqual(energy.snapshot(NOW + 900000).balance, 3, 'fake cloud state is not locally re-materialized');

  // Daily is not a production apply domain in phase 2. Inject a fake domain
  // writer using the existing real daily store to prove the application order
  // and the +500 recovery gate against persisted two-level completion facts.
  const d = fixture();
  const day = { dateKey: '2026-09-04', dayId: 'daily-test', entryLimit: 3, levelIds: ['intro', 'extreme'], idempotencyKey: 'entry_1' };
  const dailyAdapter = { applyAuthoritativeSnapshot() {
    assert(d.app.dailyProgress.recordEntry(day).ok);
    day.levelIds.forEach((levelId, levelIndex) => assert(d.app.dailyProgress.recordLevelCompletion(Object.assign({}, day,
      { levelId, levelIndex, levelCount: 2, elapsedMs: 1000, completedAt: NOW })).ok));
    return { ok: true };
  } };
  const dailyResponse = response(d.syncStore, { domains: { daily: { schemaVersion: 1 } },
    revisions: Object.assign({}, d.syncStore.currentScope().revisions, { daily: 1 }) });
  const applier = new Applier({ progress: d.app.progress, daily: dailyAdapter, rewards: d.app.rewardUnlocks, stamina: d.app.stamina, syncStore: d.syncStore }, d.app.accountGuard);
  assert((await applier.apply(dailyResponse, applier.capture())).ok);
  assert(d.app.dailyProgress.getDay(day.dateKey).completed);
  assert.strictEqual(d.app.recoverRewardUnlocks().amountDelta, 0);
  assert.strictEqual(d.app.rewardUnlocks.view().balance, 0, 'cloud daily completion must not grant +500');
  d.app.dispose();
}

run.fixture = fixture; run.response = response; run.NOW = NOW;
module.exports = run;
