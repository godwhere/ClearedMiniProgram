'use strict';

const assert = require('assert');
const StaminaService = require('../src/services/stamina-service.js');
const config = require('../src/config/stamina.js');
const { createStaminaFixture, STORAGE_KEY, NOW, INTERVAL, clone } = require('./helpers/stamina-fixture.js');
const saved = (balance, nextRecoveryAt, unlockedLevels = [], refundedLevels = []) =>
  ({ schemaVersion: 1, balance, nextRecoveryAt, unlockedLevels, refundedLevels });

function run() {
  assert.deepStrictEqual(config, { initialBalance: 5, naturalCap: 5, recoveryIntervalMs: INTERVAL,
    ordinaryUnlockCost: 1, quickClearLimitMs: 60000, quickClearRefundAmount: 1 });
  assert(Object.isFrozen(config));
  const f = createStaminaFixture();
  assert.deepStrictEqual(f.service.snapshot(), { enabled: true, balance: 5, naturalCap: 5,
    ordinaryUnlockCost: 1, recovering: false, nextRecoveryAt: null, remainingMs: 0,
    overflow: 0, canUnlockOrdinaryLevel: true, persisted: true });
  assert.deepStrictEqual(f.raw.storage[STORAGE_KEY], saved(5, null));
  f.setNow(NOW + 30 * INTERVAL);
  assert.strictEqual(f.service.snapshot().balance, 5);
  assert.strictEqual(f.writes.length, 1, 'full stamina does not bank time or write on reads');
  f.setNow(NOW);
  const first = f.service.unlockOrdinaryLevel('0:0');
  assert.deepStrictEqual([first.ok, first.spent, first.before, first.after], [true, 1, 5, 4]);
  assert.strictEqual(first.snapshot.nextRecoveryAt, NOW + INTERVAL);
  f.setNow(NOW + 120000);
  const second = f.service.unlockOrdinaryLevel('0:1');
  assert.strictEqual(second.after, 3);
  assert.strictEqual(second.snapshot.nextRecoveryAt, NOW + INTERVAL);
  assert.strictEqual(f.service.snapshot(NOW + INTERVAL - 1).balance, 3);
  assert.strictEqual(f.service.snapshot(NOW + INTERVAL).balance, 4);
  assert.strictEqual(f.service.snapshot(NOW + INTERVAL).nextRecoveryAt, NOW + 2 * INTERVAL);
  const beforeReads = f.writes.length;
  for (let i = 0; i < 10000; i++) f.service.snapshot(NOW + INTERVAL + i);
  assert.strictEqual(f.writes.length, beforeReads, 'frame/second reads do not persist');
  assert.strictEqual(f.service.snapshot(NOW + 2 * INTERVAL).nextRecoveryAt, null);
  assert.strictEqual(f.service.snapshot(NOW + 100 * INTERVAL).balance, 5);
  assert.strictEqual(f.service.unlockOrdinaryLevel('0:2', NOW + 100 * INTERVAL).snapshot.nextRecoveryAt, NOW + 101 * INTERVAL);

  const offline = createStaminaFixture(saved(2, NOW + INTERVAL));
  const recovered = offline.service.snapshot(NOW + 720000);
  assert.strictEqual(recovered.balance, 4);
  assert.strictEqual(recovered.remainingMs, 180000);
  assert.strictEqual(offline.writes.length, 1, 'multiple offline ticks commit once');
  assert.deepStrictEqual(offline.raw.storage[STORAGE_KEY], saved(4, NOW + 3 * INTERVAL));
  assert.strictEqual(offline.service.snapshot(NOW + 1800000).balance, 5);
  assert.strictEqual(offline.service.snapshot(NOW + 1800000).nextRecoveryAt, null);

  for (const balance of [6, 7, 8, Number.MAX_SAFE_INTEGER]) {
    const overflow = createStaminaFixture(saved(balance, 'broken'));
    const snapshot = overflow.service.snapshot();
    assert.strictEqual(snapshot.balance, balance);
    assert.strictEqual(snapshot.overflow, balance - 5);
    assert.strictEqual(snapshot.nextRecoveryAt, null);
  }
  const extra = createStaminaFixture(saved(7, NOW + 1));
  assert.strictEqual(extra.service.unlockOrdinaryLevel('0:0', NOW).snapshot.nextRecoveryAt, null);
  assert.strictEqual(extra.service.unlockOrdinaryLevel('0:1', NOW + INTERVAL).snapshot.nextRecoveryAt, null);
  const crossing = extra.service.unlockOrdinaryLevel('0:2', NOW + 2 * INTERVAL);
  assert.strictEqual(crossing.after, 4);
  assert.strictEqual(crossing.snapshot.nextRecoveryAt, NOW + 3 * INTERVAL);

  const zero = createStaminaFixture(saved(0, NOW + INTERVAL));
  assert.strictEqual(zero.service.unlockOrdinaryLevel('0:0').reason, 'insufficient-stamina');
  assert.strictEqual(zero.writes.length, 0);
  assert.strictEqual(zero.service.snapshot().canUnlockOrdinaryLevel, false);

  const disk = createStaminaFixture(saved(5, null));
  disk.service.snapshot(); disk.failStorage(true);
  assert.strictEqual(disk.service.unlockOrdinaryLevel('0:0').reason, 'persist-failed');
  assert.strictEqual(disk.service.snapshot().balance, 5);
  assert.strictEqual(disk.service.snapshot().nextRecoveryAt, null);
  assert.deepStrictEqual(disk.raw.storage[STORAGE_KEY], saved(5, null));
  disk.failStorage(false);
  assert.strictEqual(disk.service.unlockOrdinaryLevel('0:0').after, 4);

  const pending = createStaminaFixture(saved(2, NOW + INTERVAL));
  pending.failStorage(true);
  const unpersisted = pending.service.snapshot(NOW + 720000);
  assert.strictEqual(unpersisted.balance, 4);
  assert.strictEqual(unpersisted.persisted, false);
  assert.strictEqual(pending.service.unlockOrdinaryLevel('0:0', NOW + 720000).reason, 'persist-failed');
  assert.strictEqual(pending.service.snapshot(NOW + 720000).balance, 4, 'failed spending preserves recovered stamina');
  const attempts = pending.writes.length;
  for (let i = 0; i < 100; i++) pending.service.snapshot(NOW + 720000 + i);
  assert.strictEqual(pending.writes.length, attempts, 'failed writes are not retried each frame');
  pending.failStorage(false); pending.setNow(NOW + 720000);
  assert.strictEqual(pending.service.flush(), true);
  assert.strictEqual(pending.writes.length, attempts + 1);
  assert.strictEqual(pending.service.snapshot().persisted, true);
  assert.strictEqual(pending.service.flush(), true);
  assert.strictEqual(pending.writes.length, attempts + 1, 'clean flush is a no-op');
  const restarted = new StaminaService(pending.platform, { clock: pending.clock });
  assert.deepStrictEqual(restarted.snapshot(), pending.service.snapshot());

  for (const invalid of [null, [], 'invalid', 7, {}, { schemaVersion: 2, balance: 8 },
    ...[-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '4'].map(balance => saved(balance, null))]) {
    const repair = createStaminaFixture(invalid);
    assert.strictEqual(repair.service.snapshot().balance, 5);
    assert.deepStrictEqual(repair.raw.storage[STORAGE_KEY], saved(5, null));
  }
  for (const invalid of [null, undefined, -1, 1.5, Infinity, NaN, '123', 8640000000000001]) {
    const repair = createStaminaFixture(saved(4, invalid));
    assert.strictEqual(repair.service.snapshot().nextRecoveryAt, NOW + INTERVAL);
  }
  const backwards = createStaminaFixture(saved(2, NOW + INTERVAL));
  assert.strictEqual(backwards.service.snapshot(NOW - INTERVAL).balance, 2);
  assert.strictEqual(backwards.service.snapshot(NOW - INTERVAL).remainingMs, 2 * INTERVAL);
  backwards.service.unlockOrdinaryLevel('0:0', NOW - INTERVAL);
  assert.strictEqual(backwards.service.snapshot(NOW).nextRecoveryAt, NOW + INTERVAL);

  const independent = createStaminaFixture(saved(4, NOW + INTERVAL));
  const view = independent.service.snapshot(); view.balance = 999; view.nextRecoveryAt = 0;
  assert.strictEqual(independent.service.snapshot().balance, 4);
  independent.service.unlockOrdinaryLevel('0:0').snapshot.balance = 100;
  assert.strictEqual(independent.service.snapshot().balance, 3);
  const storageCopy = clone(independent.raw.storage[STORAGE_KEY]);
  independent.raw.storage[STORAGE_KEY].balance = 100;
  assert.strictEqual(independent.service.snapshot().balance, storageCopy.balance);

  for (const value of [-1, 1.5, Infinity, NaN, '5', Number.MAX_SAFE_INTEGER + 1]) {
    const invalidConfig = createStaminaFixture(undefined, { initialBalance: value, naturalCap: value,
      ordinaryUnlockCost: value, recoveryIntervalMs: value });
    assert.deepStrictEqual(invalidConfig.service.config, config);
  }
  const nearLimit = createStaminaFixture(saved(5, null));
  const edge = nearLimit.service.unlockOrdinaryLevel('0:0', 8640000000000000);
  assert.strictEqual(edge.snapshot.nextRecoveryAt, 8640000000000000);
  assert(Number.isSafeInteger(edge.snapshot.nextRecoveryAt));
  assert.strictEqual(nearLimit.service.snapshot(NaN).balance, 4);
  const initialFailure = createStaminaFixture(); initialFailure.failStorage(true);
  assert.strictEqual(initialFailure.service.snapshot().persisted, false);
  assert.strictEqual(initialFailure.service.unlockOrdinaryLevel('0:0').ok, false);
  initialFailure.failStorage(false); assert(initialFailure.service.flush());

  const access = createStaminaFixture(saved(1, NOW + INTERVAL));
  assert.strictEqual(access.service.unlockOrdinaryLevel('1:4').spent, 1);
  assert.deepStrictEqual(access.raw.storage[STORAGE_KEY], saved(0, NOW + INTERVAL, ['1:4']));
  access.failStorage(true);
  assert.strictEqual(access.service.unlockOrdinaryLevel('1:4').spent, 0, 'unlocked levels work at zero even when storage is unavailable');
  assert.strictEqual(access.service.unlockOrdinaryLevel('1:3').reason, 'insufficient-stamina');
  assert.strictEqual(access.writes.length, 1, 'free reentry does not write storage');
  const reloaded = new StaminaService(access.platform, { clock: access.clock });
  assert.strictEqual(reloaded.unlockOrdinaryLevel('1:4').spent, 0, 'unlocks survive process restarts');
  assert.strictEqual(reloaded.snapshot().balance, 0);

  const transaction = createStaminaFixture(saved(5, null));
  transaction.failStorage(true);
  assert.strictEqual(transaction.service.unlockOrdinaryLevel('0:1').reason, 'persist-failed');
  assert.deepStrictEqual(transaction.raw.storage[STORAGE_KEY], saved(5, null));
  transaction.failStorage(false);
  assert.strictEqual(transaction.service.unlockOrdinaryLevel('0:1').spent, 1, 'a failed debit never grants access');
  assert.strictEqual(transaction.service.unlockOrdinaryLevel('0:1').spent, 0);
  transaction.raw.storage[STORAGE_KEY].unlockedLevels.push('0:2');
  assert.strictEqual(transaction.service.unlockOrdinaryLevel('0:2').spent, 1, 'storage objects cannot mutate in-memory unlocks');
  for (const key of [null, '', '__proto__', '01:2', '-1:0', '1.5:2', '0:9007199254740992']) {
    const balance = transaction.service.snapshot().balance;
    assert.strictEqual(transaction.service.unlockOrdinaryLevel(key).reason, 'invalid-level');
    assert.strictEqual(transaction.service.snapshot().balance, balance);
  }

  const migrated = createStaminaFixture({ schemaVersion: 1, balance: 0, nextRecoveryAt: NOW + INTERVAL });
  assert(migrated.service.restoreUnlockedLevels(['0:0', '0:1', '0:0', '__proto__']));
  assert.deepStrictEqual(migrated.raw.storage[STORAGE_KEY], saved(0, NOW + INTERVAL, ['0:0', '0:1']));
  assert.strictEqual(migrated.writes.length, 1, 'migration preserves balance and commits unlocks together');
  assert.strictEqual(migrated.service.unlockOrdinaryLevel('0:1').spent, 0);
  migrated.service.restoreUnlockedLevels(['0:0']);
  assert.strictEqual(migrated.writes.length, 1);
  const repairUnlocks = createStaminaFixture(saved(4, NOW + INTERVAL, ['0:1', '0:1', {}, '__proto__']));
  repairUnlocks.service.snapshot();
  assert.deepStrictEqual(repairUnlocks.raw.storage[STORAGE_KEY].unlockedLevels, ['0:1']);

  for (const elapsedMs of [0, 59999, 60000, 60001]) {
    const quick = createStaminaFixture(saved(5, null));
    quick.service.unlockOrdinaryLevel('0:0');
    const refund = quick.service.refundQuickClear('0:0', elapsedMs);
    assert.strictEqual(refund.refunded, elapsedMs <= 60000 ? 1 : 0);
    assert.strictEqual(quick.service.snapshot().balance, elapsedMs <= 60000 ? 5 : 4);
    if (elapsedMs > 60000) {
      assert.strictEqual(quick.service.quickClearRefundState('0:0').status, 'available');
      assert.strictEqual(quick.service.refundQuickClear('0:0', 30000).refunded, 1,
        'a later first fast clear earns the refund even after an earlier slow clear');
    }
    assert.strictEqual(quick.service.snapshot().nextRecoveryAt, null, 'refund reaching the cap clears recovery');
    assert.strictEqual(quick.service.quickClearRefundState('0:0').status, 'claimed');
    const writes = quick.writes.length;
    assert.strictEqual(quick.service.refundQuickClear('0:0', 1000).refunded, 0);
    assert.strictEqual(quick.service.unlockOrdinaryLevel('0:0').spent, 0);
    assert.strictEqual(quick.service.refundQuickClear('0:0', 1000).refunded, 0, 'free replays never re-arm a refund');
    const restart = new StaminaService(quick.platform, { clock: quick.clock });
    assert.strictEqual(restart.refundQuickClear('0:0', 1000).refunded, 0);
    assert.strictEqual(quick.writes.length, writes, 'duplicate and restarted completions do not write');
  }

  const invalidRefund = createStaminaFixture(saved(4, NOW + INTERVAL, ['0:0']));
  for (const elapsedMs of [-1, NaN, Infinity, '1000']) {
    assert.strictEqual(invalidRefund.service.refundQuickClear('0:0', elapsedMs).ok, false);
  }
  assert.strictEqual(invalidRefund.service.refundQuickClear('__proto__', 1000).ok, false);
  assert.strictEqual(invalidRefund.service.snapshot().balance, 4);
  invalidRefund.setNow(NOW + 10000);
  assert.strictEqual(invalidRefund.service.refundQuickClear('0:0', 10000).refunded, 1);
  const recovering = createStaminaFixture(saved(1, NOW + INTERVAL, ['0:0']));
  recovering.service.refundQuickClear('0:0', 10000);
  assert.strictEqual(recovering.service.snapshot().balance, 2);
  assert.strictEqual(recovering.service.snapshot().nextRecoveryAt, NOW + INTERVAL);
  for (const balance of [5, 8]) {
    const overflowRefund = createStaminaFixture(saved(balance, null, ['0:0']));
    overflowRefund.service.refundQuickClear('0:0', 1000);
    assert.strictEqual(overflowRefund.service.snapshot().balance, balance + 1);
    assert.strictEqual(overflowRefund.service.snapshot().nextRecoveryAt, null);
  }

  const refundDisk = createStaminaFixture(saved(3, NOW + INTERVAL, ['0:0', '0:1']));
  refundDisk.failStorage(true);
  assert.strictEqual(refundDisk.service.refundQuickClear('0:0', 1000).reason, 'refund-persist-failed');
  assert.strictEqual(refundDisk.service.refundQuickClear('0:1', 1000).ok, false);
  assert.strictEqual(refundDisk.service.snapshot().balance, 3, 'failed refund does not secretly credit memory');
  assert.deepStrictEqual(refundDisk.raw.storage[STORAGE_KEY].refundedLevels, []);
  assert.strictEqual(refundDisk.service.quickClearRefundState('0:0').status, 'pending');
  const pendingWrites = refundDisk.writes.length;
  for (let i = 0; i < 100; i++) refundDisk.service.snapshot(NOW + i);
  assert.strictEqual(refundDisk.writes.length, pendingWrites);
  refundDisk.failStorage(false); assert(refundDisk.service.flush());
  assert.strictEqual(refundDisk.writes.length, pendingWrites + 1, 'pending refunds flush together');
  assert.deepStrictEqual(refundDisk.raw.storage[STORAGE_KEY], saved(5, null, ['0:0', '0:1'], ['0:0', '0:1']));
  const grandfathered = createStaminaFixture(saved(5, null, ['0:0']));
  assert.strictEqual(grandfathered.service.refundQuickClear('0:0', 1000).refunded, 1, 'legacy unlocked levels also qualify once');
  const limit = createStaminaFixture(saved(Number.MAX_SAFE_INTEGER, null, ['0:0']));
  assert.strictEqual(limit.service.refundQuickClear('0:0', 1000).ok, false);
  assert.strictEqual(limit.service.snapshot().balance, Number.MAX_SAFE_INTEGER);

  const defaultAuthority = createStaminaFixture();
  assert.strictEqual(defaultAuthority.service.setAuthorityMode('app-local'), false,
    'a default/WeChat stamina instance cannot be promoted to App authority');
  assert.strictEqual(defaultAuthority.service.authorityMode(), 'legacy-local');
  assert.strictEqual(defaultAuthority.service.setAuthorityMode('unknown'), false);
  const protectedAuthority = createStaminaFixture();
  assert.strictEqual(protectedAuthority.service.setAuthorityMode('cloud-authoritative'), true);
  assert.strictEqual(protectedAuthority.service.setAuthorityMode('app-local'), false);

  const appAuthority = createStaminaFixture(saved(5, null), { authorityMode: 'app-local' });
  assert.strictEqual(appAuthority.service.authorityMode(), 'app-local');
  assert.strictEqual(appAuthority.service.setAuthorityMode('app-local'), true);
  assert.strictEqual(appAuthority.service.setAuthorityMode('legacy-local'), false);
  assert.strictEqual(appAuthority.service.setAuthorityMode('local-backup'), false);
  assert.strictEqual(appAuthority.service.snapshot().balance, 5);
  assert.strictEqual(appAuthority.service.restoreUnlockedLevels(['0:0']), true);
  assert.strictEqual(appAuthority.service.unlockOrdinaryLevel('0:0').spent, 0);
  assert.strictEqual(appAuthority.service.unlockOrdinaryLevel('0:1').spent, 1);
  assert.strictEqual(appAuthority.service.refundQuickClear('0:1', 1000).refunded, 1);
  assert.strictEqual(appAuthority.service.refundQuickClear('0:1', 1000).refunded, 0);
  assert.strictEqual(appAuthority.service.flush(), true);
  const appRestart = new StaminaService(appAuthority.platform, {
    clock: appAuthority.clock, authorityMode: 'app-local'
  });
  assert.strictEqual(appRestart.authorityMode(), 'app-local');
  assert.strictEqual(appRestart.snapshot().balance, 5);
  assert.strictEqual(appRestart.unlockOrdinaryLevel('0:1').spent, 0,
    'a fresh App service loads an existing isolated ledger without charging again');
  assert.strictEqual(appRestart.refundQuickClear('0:1', 1000).refunded, 0);

  const appPendingRecovery = createStaminaFixture(saved(2, NOW), { authorityMode: 'app-local' });
  assert.strictEqual(appPendingRecovery.service.settle(NOW), true);
  assert.strictEqual(appPendingRecovery.writes.length, 0);
  assert.strictEqual(appPendingRecovery.service.restoreUnlockedLevels([], NOW), true);
  assert.deepStrictEqual(appPendingRecovery.raw.storage[STORAGE_KEY],
    saved(3, NOW + INTERVAL), 'restore commits a previously pending App-local recovery');
  assert.strictEqual(appPendingRecovery.service.snapshot(NOW).persisted, true);

  const appRestoreFailure = createStaminaFixture(saved(5, null), { authorityMode: 'app-local' });
  appRestoreFailure.failStorage(true);
  assert.strictEqual(appRestoreFailure.service.restoreUnlockedLevels(['0:2']), false);
  assert.strictEqual(appRestoreFailure.service.isPermanentlyUnlocked('0:2'), false,
    'a failed App restore cannot grant an in-memory permanent unlock');
  assert.deepStrictEqual(appRestoreFailure.raw.storage[STORAGE_KEY], saved(5, null));

  const appUnlockFailure = createStaminaFixture(saved(5, null), { authorityMode: 'app-local' });
  appUnlockFailure.failStorage(true);
  const rejectedUnlock = appUnlockFailure.service.unlockOrdinaryLevel('0:3');
  assert.strictEqual(rejectedUnlock.reason, 'persist-failed');
  assert.strictEqual(rejectedUnlock.snapshot.balance, 5);
  assert.strictEqual(appUnlockFailure.service.isPermanentlyUnlocked('0:3'), false);
  assert.deepStrictEqual(appUnlockFailure.raw.storage[STORAGE_KEY], saved(5, null));

  const appRefundFailure = createStaminaFixture(saved(4, NOW + INTERVAL, ['0:4']), {
    authorityMode: 'app-local'
  });
  appRefundFailure.failStorage(true);
  assert.strictEqual(appRefundFailure.service.refundQuickClear('0:4', 1000).reason,
    'refund-persist-failed');
  assert.strictEqual(appRefundFailure.service.snapshot().balance, 4);
  assert.strictEqual(appRefundFailure.service.quickClearRefundState('0:4').status, 'available',
    'an App write failure does not confirm or retain a hidden refund');
  assert.deepStrictEqual(appRefundFailure.raw.storage[STORAGE_KEY],
    saved(4, NOW + INTERVAL, ['0:4']));
  appRefundFailure.failStorage(false);
  assert.strictEqual(appRefundFailure.service.refundQuickClear('0:4', 1000).refunded, 1);
  const refundRestart = new StaminaService(appRefundFailure.platform, {
    clock: appRefundFailure.clock, authorityMode: 'app-local'
  });
  assert.strictEqual(refundRestart.refundQuickClear('0:4', 1000).refunded, 0);
}

module.exports = run;
