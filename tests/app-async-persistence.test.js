'use strict';

const assert = require('assert');
const runtime = require('../src/runtime/game-runtime.js');
const AppLocalPersistence = require('../src/runtime/app-local-persistence.js');
const ProgressStore = require('../src/services/progress-store.js');
const StaminaService = require('../src/services/stamina-service.js');
const RewardUnlockService = require('../src/services/reward-unlock-service.js');
const LocaleService = require('../src/services/locale-service.js');
const fixture = require('./fixtures/app-product-policy.js');

function copy(value) { return JSON.parse(JSON.stringify(value)); }
function fingerprint(input) { return JSON.stringify([input.namespace, input.schemaVersion, input.writes]); }
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function policy() {
  const result = copy(fixture);
  result.authority.storageNamespaceId = AppLocalPersistence.NAMESPACE;
  return result;
}

class FakeNativePort {
  constructor(records) {
    this.records = copy(records || {});
    this.operations = new Map();
    this.faults = [];
    this.calls = [];
    this.lookupAvailable = true;
    this.reportMatch = true;
  }

  async open(request) {
    this.calls.push('open');
    const records = {};
    request.keys.forEach(key => {
      records[key] = Object.prototype.hasOwnProperty.call(this.records, key)
        ? { found: true, value: copy(this.records[key]) } : { found: false };
    });
    return { ok: true, namespace: request.namespace, schemaVersion: 1, records };
  }

  async commit(input) {
    this.calls.push(`commit:${input.writes[0].key}`);
    const fault = this.faults.shift();
    if (fault && fault.kind === 'delay') await fault.gate.promise;
    if (fault && fault.kind === 'reject') return { ok: false, definite: true };
    if (fault && fault.kind === 'unknown-before') return { ok: false };
    const content = fingerprint(input);
    const existing = this.operations.get(input.operationId);
    if (existing && existing !== content) return { ok: false, definite: true };
    if (!existing) {
      input.writes.forEach(write => { this.records[write.key] = copy(write.value); });
      this.operations.set(input.operationId, content);
    }
    if (fault && fault.kind === 'unknown-after') return { ok: false };
    return { ok: true, committed: true };
  }

  async lookupOperation(input) {
    this.calls.push('lookup');
    if (!this.lookupAvailable) return { ok: false };
    const existing = this.operations.get(input.operationId);
    if (!existing) return { ok: true, found: false };
    return this.reportMatch ? { ok: true, committed: true, matches: existing === fingerprint(input) }
      : { ok: true, committed: true };
  }
}

function platform(counters) {
  const calls = counters || { sync: 0, started: 0 };
  const context = new Proxy({}, { get: (target, key) => target[key] || function () {} });
  return {
    calls, context,
    metrics: { width: 390, height: 844, dpr: 2, safeTop: 47, safeBottom: 810 },
    storageNamespace() { return { id: AppLocalPersistence.NAMESPACE, isolated: true }; },
    getSystemLanguage() { return 'en-US'; },
    getStorage() { calls.sync++; throw new Error('sync read forbidden'); },
    readStorageResult() { calls.sync++; throw new Error('sync read forbidden'); },
    setStorage() { calls.sync++; throw new Error('sync write forbidden'); },
    bindPointer() { return () => {}; },
    bindLifecycle() { return () => {}; },
    startLoop() { calls.started++; }, stopLoop() {},
    createAudioContext() { return null; },
    supportsRewardedVideoAd() { return false; },
    createInterstitialAd() { return null; },
    createImage(source, callback) {
      const image = { src: source, width: 1, height: 1 };
      if (callback) callback(null, image);
      return image;
    },
    triggerHaptic() {}, getLaunchOptions() { return {}; }, getEnterOptions() { return {}; },
    openPrivacyContract() { return Promise.resolve({ ok: false, reason: 'not-supported' }); }
  };
}

async function run() {
  assert.strictEqual(runtime.runtimeContractVersion, 5);
  const startPort = new FakeNativePort();
  const startCalls = { sync: 0, started: 0 };
  const host = platform(startCalls);
  const app = await runtime.startAppLocalGameAsync(host, { productPolicy: policy(), persistencePort: startPort });
  assert.strictEqual(startCalls.sync, 0, 'startup cannot fall through to synchronous storage');
  assert.strictEqual(startCalls.started, 1);
  assert.strictEqual(app.progress.completedCount(), 0);
  assert.strictEqual(app.staminaSnapshot.balance, 5);
  assert.strictEqual(app.locale.current(), 'en-US');
  assert.strictEqual(app.rewardUnlocks.view().balance, 0);

  app.scene = 'account';
  const languageGate = deferred();
  startPort.faults.push({ kind: 'delay', gate: languageGate });
  const languageAction = app.performAction('account:language:next');
  await Promise.resolve();
  assert.strictEqual(app.locale.current(), 'en-US');
  languageGate.resolve();
  assert.strictEqual(await languageAction, true);
  assert.strictEqual(app.locale.current(), 'zh-CN');
  app.scene = 'home';
  const soundGate = deferred();
  startPort.faults.push({ kind: 'delay', gate: soundGate });
  const soundAction = app.performAction('home:sound');
  await Promise.resolve();
  assert.strictEqual(app.audio.isEnabled(), true);
  soundGate.resolve();
  assert.strictEqual(await soundAction, false);
  assert.strictEqual(app.audio.isEnabled(), false);
  assert.strictEqual(await app.setSkinAsync('classic'), true);
  assert.strictEqual(await app.setClearEffectAsync('none'), true);
  assert.strictEqual(startCalls.sync, 0);

  const entryGate = deferred();
  startPort.faults.push({ kind: 'delay', gate: entryGate });
  const opening = app.openLevel(0, 0);
  await Promise.resolve();
  await Promise.resolve();
  assert.strictEqual(app.runner, null, 'runner must wait for the stamina transaction');
  entryGate.resolve();
  assert.strictEqual(await opening, true);
  assert.strictEqual(app.staminaSnapshot.balance, 4);
  assert.strictEqual(startPort.records[StaminaService.STORAGE_KEY].unlockedLevels.includes('0:0'), true);
  assert.strictEqual(startPort.records[ProgressStore.STORAGE_KEY].lastPlayed.levelIndex, 0);

  const progressGate = deferred();
  startPort.faults.push({ kind: 'delay', gate: progressGate });
  const completion = app.progress.recordCompletionAsync(0, 0, 1400, 'completion:0:0');
  await Promise.resolve();
  await Promise.resolve();
  assert.strictEqual(app.progress.isCompleted(0, 0), false, 'candidate must stay invisible before commit');
  progressGate.resolve();
  assert.strictEqual((await completion).persisted, true);
  const firstReward = await app.recoverRewardUnlocksAsync();
  assert.strictEqual(firstReward.ok, true);
  assert.strictEqual(firstReward.amountDelta > 0, true);
  assert.strictEqual((await app.recoverRewardUnlocksAsync()).amountDelta, 0);
  assert.strictEqual(startPort.records[RewardUnlockService.STORAGE_KEY].balance,
    app.rewardUnlocks.view().balance);
  const balance = app.rewardUnlocks.view().balance;
  const restored = await runtime.createAppLocalServicesAsync(platform(), {
    productPolicy: policy(), persistencePort: startPort
  });
  assert.strictEqual(restored.progress.isCompleted(0, 0), true);
  assert.strictEqual(restored.rewardUnlocks.view().balance, balance, 'restart cannot grant first-clear twice');
  assert.strictEqual(restored.stamina._state.refundedLevels.includes('0:0'), true);

  assert.strictEqual(await app.openLevel(0, 1), true);
  const rewardBeforeRetry = app.rewardUnlocks.view().balance;
  const staminaBeforeRetry = app.stamina._state.balance;
  app.pendingCompletion = { runner: app.runner, context: app.runContext, elapsedMs: 1200,
    operationId: 'retry:ordinary:0:1' };
  startPort.faults.push({ kind: 'reject' });
  assert.strictEqual(await app.settleAppLocalCompletion(), false);
  assert.strictEqual(app.progress.isCompleted(0, 1), false);
  assert.strictEqual(app.rewardUnlocks.view().balance, rewardBeforeRetry);
  assert.strictEqual(app.result.currencyReward.failureSource, 'local-save');
  assert.strictEqual(app.performAction('result:levels'), false,
    'a failed completion cannot be abandoned while its retry is pending');
  assert.strictEqual(await app.settleAppLocalCompletion(), true);
  assert.strictEqual(app.progress.isCompleted(0, 1), true);
  assert.strictEqual(app.rewardUnlocks.view().balance, rewardBeforeRetry + 100);
  assert.strictEqual(app.stamina._state.balance, staminaBeforeRetry + 1);
  assert.strictEqual((await app.recoverRewardUnlocksAsync()).amountDelta, 0);

  const failurePort = new FakeNativePort();
  const services = await runtime.createAppLocalServicesAsync(platform(), {
    productPolicy: policy(), persistencePort: failurePort
  });
  failurePort.faults.push({ kind: 'reject' });
  const before = services.stamina._state.balance;
  const failedUnlock = await services.stamina.unlockOrdinaryLevelAsync('0:1', Date.now());
  assert.strictEqual(failedUnlock.ok, false);
  assert.strictEqual(services.stamina._state.balance, before);
  assert.strictEqual(services.stamina.isPermanentlyUnlocked('0:1'), false);
  failurePort.faults.push({ kind: 'reject' });
  assert.strictEqual(await services.progress.setSettingAsync('soundEnabled', false), false);
  assert.strictEqual(services.progress.getSetting('soundEnabled'), true);
  failurePort.faults.push({ kind: 'reject' });
  assert.strictEqual(await services.progress.setSettingAsync('soundVolume', 0.3), false);
  assert.strictEqual(services.progress.getSetting('soundVolume'), 1);
  assert.strictEqual(services.progress.getSetting('soundEnabled'), true, 'volume and mute fail atomically');
  assert.strictEqual(await services.progress.setSettingAsync('soundVolume', 0.3), true);
  assert.strictEqual(await services.progress.setSettingAsync('soundVolume', 0), true);
  assert.strictEqual(services.progress.getSetting('soundVolume'), 0.3);
  assert.strictEqual(services.progress.getSetting('soundEnabled'), false);
  assert.strictEqual(await services.progress.setSettingAsync('soundVolume', NaN), false);
  const invalidVolumeSave = copy(services.progress.state);
  invalidVolumeSave.settings.soundVolume = 'invalid';
  const invalidVolumePort = new FakeNativePort({ [ProgressStore.STORAGE_KEY]: invalidVolumeSave });
  const recoveredVolume = await runtime.createAppLocalServicesAsync(platform(), {
    productPolicy: policy(), persistencePort: invalidVolumePort
  });
  assert.strictEqual(await recoveredVolume.progress.setSettingAsync('soundVolume', 0), true);
  assert.strictEqual(invalidVolumePort.records[ProgressStore.STORAGE_KEY].settings.soundVolume, 1,
    'muting an old invalid volume persists the normalized audible fallback');
  failurePort.faults.push({ kind: 'reject' });
  assert.strictEqual((await services.locale.selectAsync('zh-CN')).ok, false);
  assert.strictEqual(services.locale.current(), 'en-US');
  failurePort.faults.push({ kind: 'unknown-after' });
  const saved = await services.progress.recordCompletionAsync(0, 0, 1500, 'lost:completion');
  assert.strictEqual(saved.persisted, true, 'lost callback recovered by operation lookup');
  assert.strictEqual(failurePort.records[ProgressStore.STORAGE_KEY].stats.totalClears, 1);

  const collisionPort = new FakeNativePort();
  const firstSession = await runtime.createAppLocalServicesAsync(platform(), {
    productPolicy: policy(), persistencePort: collisionPort
  });
  assert.strictEqual((await firstSession.progress.recordCompletionAsync(0, 0, 1200,
    'reused-completion-id')).persisted, true);
  const secondSession = await runtime.createAppLocalServicesAsync(platform(), {
    productPolicy: policy(), persistencePort: collisionPort
  });
  collisionPort.faults.push({ kind: 'unknown-before' });
  assert.strictEqual((await secondSession.progress.recordCompletionAsync(0, 1, 1100,
    'reused-completion-id')).persisted, false,
    'a lost callback cannot confirm a different candidate under an existing operation ID');
  assert.strictEqual(secondSession.progress.isCompleted(0, 1), false);
  assert.strictEqual(collisionPort.records[ProgressStore.STORAGE_KEY].stats.totalClears, 1);

  const sameSessionPort = new FakeNativePort();
  const sameSession = await runtime.createAppLocalServicesAsync(platform(), {
    productPolicy: policy(), persistencePort: sameSessionPort
  });
  assert.strictEqual((await sameSession.progress.recordCompletionAsync(0, 0, 1200,
    'same-session-id')).persisted, true);
  assert.strictEqual(await sameSession.progress.setSettingAsync('soundEnabled', false), true);
  assert.strictEqual((await sameSession.progress.recordCompletionAsync(0, 0, 1200,
    'same-session-id')).persisted, true);
  assert.strictEqual(sameSession.progress.getSetting('soundEnabled'), false,
    'a completed operation replay cannot roll back later confirmed progress settings');
  assert.strictEqual((await sameSession.progress.recordCompletionAsync(0, 0, 1100,
    'same-session-id')).persisted, false,
    'the same level with a different elapsed time is a conflicting operation');
  const sameSessionConflict = await sameSession.progress.recordCompletionAsync(0, 1, 1100,
    'same-session-id');
  assert.strictEqual(sameSessionConflict.persisted, false,
    'the in-memory operation cache cannot confirm a different completion');
  assert.strictEqual(sameSession.progress.isCompleted(0, 1), false);

  const pendingConflictPort = new FakeNativePort();
  const pendingConflict = await runtime.createAppLocalServicesAsync(platform(), {
    productPolicy: policy(), persistencePort: pendingConflictPort
  });
  pendingConflictPort.lookupAvailable = false;
  pendingConflictPort.faults.push({ kind: 'unknown-after' });
  assert.strictEqual((await pendingConflict.progress.recordCompletionAsync(0, 0, 1200,
    'pending-id')).persisted, false);
  pendingConflictPort.lookupAvailable = true;
  assert.strictEqual((await pendingConflict.progress.recordCompletionAsync(0, 1, 1100,
    'pending-id')).persisted, false,
    'a pending operation ID cannot be reused for another completion');
  assert.strictEqual(pendingConflict.progress.isCompleted(0, 1), false);
  assert.strictEqual((await pendingConflict.progress.recordCompletionAsync(0, 0, 1200,
    'pending-id')).persisted, true,
    'the original pending completion can still be confirmed after a conflicting retry');

  const unverifiedPort = new FakeNativePort();
  const unverified = await runtime.createAppLocalServicesAsync(platform(), {
    productPolicy: policy(), persistencePort: unverifiedPort
  });
  unverifiedPort.reportMatch = false;
  unverifiedPort.faults.push({ kind: 'unknown-after' });
  assert.strictEqual((await unverified.progress.recordCompletionAsync(0, 0, 1200,
    'unverified-completion')).persisted, false,
    'lookup without an explicit content match cannot confirm the candidate');
  assert.strictEqual(unverified.progress.isCompleted(0, 0), false);
  unverifiedPort.reportMatch = true;
  assert.strictEqual((await unverified.progress.recordCompletionAsync(0, 0, 1200,
    'unverified-completion')).persisted, true);

  const purchasePort = new FakeNativePort({ [RewardUnlockService.STORAGE_KEY]: Object.assign(
    RewardUnlockService.emptyState(), { balance: 10000 }) });
  const purchasing = await runtime.createAppLocalServicesAsync(platform(), {
    productPolicy: policy(), persistencePort: purchasePort
  });
  purchasePort.faults.push({ kind: 'reject' });
  assert.strictEqual((await purchasing.rewardUnlocks.purchaseAsync('theme:desserts')).ok, false);
  assert.strictEqual(purchasing.rewardUnlocks.view().balance, 10000);
  assert.strictEqual(purchasing.rewardUnlocks.owned('theme:desserts'), false);
  const purchases = await Promise.all([
    purchasing.rewardUnlocks.purchaseAsync('theme:desserts'),
    purchasing.rewardUnlocks.purchaseAsync('theme:desserts')
  ]);
  assert.strictEqual(purchases[0].ok, true);
  assert.strictEqual(purchases[1].alreadyApplied, true);
  assert.strictEqual(purchasing.rewardUnlocks.view().balance, 0);
  assert.strictEqual(purchasePort.records[RewardUnlockService.STORAGE_KEY].ownedRewards['theme:desserts'], true);

  const uncertainPort = new FakeNativePort();
  const uncertain = await runtime.createAppLocalServicesAsync(platform(), {
    productPolicy: policy(), persistencePort: uncertainPort
  });
  uncertainPort.lookupAvailable = false;
  uncertainPort.faults.push({ kind: 'unknown-before' }, { kind: 'unknown-before' });
  const uncertainLocale = await uncertain.locale.selectAsync('zh-CN');
  assert.strictEqual(uncertainLocale.ok, false);
  assert.strictEqual(uncertainLocale.reason, 'commit-unconfirmed');
  assert.strictEqual(uncertain.locale.current(), 'en-US');
  assert.strictEqual(uncertainPort.records[LocaleService.STORAGE_KEY], undefined);
  uncertainPort.lookupAvailable = true;
  assert.strictEqual((await uncertain.locale.selectAsync('zh-CN')).ok, true,
    'pending operation retries with its original ID before a later write');

  const latePort = new FakeNativePort();
  const late = await runtime.createAppLocalServicesAsync(platform(), {
    productPolicy: policy(), persistencePort: latePort
  });
  latePort.lookupAvailable = false;
  latePort.faults.push({ kind: 'unknown-after' });
  assert.strictEqual((await late.progress.recordCompletionAsync(0, 0, 1200, 'late:0:0')).persisted, false);
  assert.strictEqual(late.progress.isCompleted(0, 0), false);
  latePort.lookupAvailable = true;
  await late.stamina.snapshotAsync(Date.now());
  assert.strictEqual((await late.progress.recordCompletionAsync(0, 0, 1200, 'late:0:0')).persisted, true);
  assert.strictEqual(late.progress.state.stats.totalClears, 1,
    'resolving a pending operation from another domain cannot count the same clear twice');

  const corruptPort = new FakeNativePort({ [LocaleService.STORAGE_KEY]: { schemaVersion: 2, locale: 'en-US' } });
  const corruptCalls = { sync: 0, started: 0 };
  await assert.rejects(() => runtime.startAppLocalGameAsync(platform(corruptCalls), {
    productPolicy: policy(), persistencePort: corruptPort
  }), /app-local-invalid-locale/);
  assert.strictEqual(corruptCalls.started, 0, 'corrupt save blocks UI startup');
  assert.strictEqual(corruptCalls.sync, 0);
  app.dispose();
}

module.exports = run;
