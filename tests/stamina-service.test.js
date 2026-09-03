'use strict';

const assert = require('assert');
const StaminaService = require('../src/services/stamina-service.js');
const config = require('../src/config/stamina.js');
const { createStaminaFixture, STORAGE_KEY, NOW, INTERVAL, clone } = require('./helpers/stamina-fixture.js');
const saved = (balance, nextRecoveryAt) => ({ schemaVersion: 1, balance, nextRecoveryAt });

function run() {
  assert.deepStrictEqual(config, { initialBalance: 5, naturalCap: 5, recoveryIntervalMs: INTERVAL, ordinaryAttemptCost: 1 });
  assert(Object.isFrozen(config));
  const f = createStaminaFixture();
  assert.deepStrictEqual(f.service.snapshot(), { enabled: true, balance: 5, naturalCap: 5,
    ordinaryAttemptCost: 1, recovering: false, nextRecoveryAt: null, remainingMs: 0,
    overflow: 0, canStartOrdinaryAttempt: true, persisted: true });
  assert.deepStrictEqual(f.raw.storage[STORAGE_KEY], saved(5, null));
  f.setNow(NOW + 30 * INTERVAL);
  assert.strictEqual(f.service.snapshot().balance, 5);
  assert.strictEqual(f.writes.length, 1, 'full stamina does not bank time or write on reads');
  f.setNow(NOW);
  const first = f.service.consumeOrdinaryAttempt();
  assert.deepStrictEqual([first.ok, first.spent, first.before, first.after], [true, 1, 5, 4]);
  assert.strictEqual(first.snapshot.nextRecoveryAt, NOW + INTERVAL);
  f.setNow(NOW + 120000);
  const second = f.service.consumeOrdinaryAttempt();
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
  assert.strictEqual(f.service.consumeOrdinaryAttempt(NOW + 100 * INTERVAL).snapshot.nextRecoveryAt, NOW + 101 * INTERVAL);

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
  assert.strictEqual(extra.service.consumeOrdinaryAttempt(NOW).snapshot.nextRecoveryAt, null);
  assert.strictEqual(extra.service.consumeOrdinaryAttempt(NOW + INTERVAL).snapshot.nextRecoveryAt, null);
  const crossing = extra.service.consumeOrdinaryAttempt(NOW + 2 * INTERVAL);
  assert.strictEqual(crossing.after, 4);
  assert.strictEqual(crossing.snapshot.nextRecoveryAt, NOW + 3 * INTERVAL);

  const zero = createStaminaFixture(saved(0, NOW + INTERVAL));
  assert.strictEqual(zero.service.consumeOrdinaryAttempt().reason, 'insufficient-stamina');
  assert.strictEqual(zero.writes.length, 0);
  assert.strictEqual(zero.service.snapshot().canStartOrdinaryAttempt, false);

  const disk = createStaminaFixture(saved(5, null));
  disk.service.snapshot(); disk.failStorage(true);
  assert.strictEqual(disk.service.consumeOrdinaryAttempt().reason, 'persist-failed');
  assert.strictEqual(disk.service.snapshot().balance, 5);
  assert.strictEqual(disk.service.snapshot().nextRecoveryAt, null);
  assert.deepStrictEqual(disk.raw.storage[STORAGE_KEY], saved(5, null));
  disk.failStorage(false);
  assert.strictEqual(disk.service.consumeOrdinaryAttempt().after, 4);

  const pending = createStaminaFixture(saved(2, NOW + INTERVAL));
  pending.failStorage(true);
  const unpersisted = pending.service.snapshot(NOW + 720000);
  assert.strictEqual(unpersisted.balance, 4);
  assert.strictEqual(unpersisted.persisted, false);
  assert.strictEqual(pending.service.consumeOrdinaryAttempt(NOW + 720000).reason, 'persist-failed');
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
  backwards.service.consumeOrdinaryAttempt(NOW - INTERVAL);
  assert.strictEqual(backwards.service.snapshot(NOW).nextRecoveryAt, NOW + INTERVAL);

  const independent = createStaminaFixture(saved(4, NOW + INTERVAL));
  const view = independent.service.snapshot(); view.balance = 999; view.nextRecoveryAt = 0;
  assert.strictEqual(independent.service.snapshot().balance, 4);
  independent.service.consumeOrdinaryAttempt().snapshot.balance = 100;
  assert.strictEqual(independent.service.snapshot().balance, 3);
  const storageCopy = clone(independent.raw.storage[STORAGE_KEY]);
  independent.raw.storage[STORAGE_KEY].balance = 100;
  assert.strictEqual(independent.service.snapshot().balance, storageCopy.balance);

  for (const value of [-1, 1.5, Infinity, NaN, '5', Number.MAX_SAFE_INTEGER + 1]) {
    const invalidConfig = createStaminaFixture(undefined, { initialBalance: value, naturalCap: value,
      ordinaryAttemptCost: value, recoveryIntervalMs: value });
    assert.deepStrictEqual(invalidConfig.service.config, config);
  }
  const nearLimit = createStaminaFixture(saved(5, null));
  const edge = nearLimit.service.consumeOrdinaryAttempt(8640000000000000);
  assert.strictEqual(edge.snapshot.nextRecoveryAt, 8640000000000000);
  assert(Number.isSafeInteger(edge.snapshot.nextRecoveryAt));
  assert.strictEqual(nearLimit.service.snapshot(NaN).balance, 4);
  const initialFailure = createStaminaFixture(); initialFailure.failStorage(true);
  assert.strictEqual(initialFailure.service.snapshot().persisted, false);
  assert.strictEqual(initialFailure.service.consumeOrdinaryAttempt().ok, false);
  initialFailure.failStorage(false); assert(initialFailure.service.flush());
}

module.exports = run;
