'use strict';

const assert = require('assert');
const adapter = require('../src/services/daily-progress-adapter.js');

function testReadDay() {
  const calls = [];
  const preferred = {
    getDay(dateKey) { calls.push(['getDay', this, dateKey]); return { dateKey }; },
    get(dateKey) { calls.push(['get', this, dateKey]); return { fallback: dateKey }; }
  };
  assert.deepStrictEqual(adapter.readDay(preferred, '2026-09-08'), { dateKey: '2026-09-08' });
  assert.deepStrictEqual(calls.map(call => [call[0], call[2]]), [['getDay', '2026-09-08']]);
  assert.strictEqual(calls[0][1], preferred);

  const legacy = { get(dateKey) { assert.strictEqual(this, legacy); return `legacy:${dateKey}`; } };
  assert.strictEqual(adapter.readDay(legacy, '2026-09-09'), 'legacy:2026-09-09');

  let fallbackCalled = false;
  const failing = {
    getDay() { throw new Error('read failed'); },
    get() { fallbackCalled = true; return {}; }
  };
  assert.strictEqual(adapter.readDay(failing, '2026-09-08'), null);
  assert.strictEqual(fallbackCalled, false);
  assert.strictEqual(adapter.readDay(null, '2026-09-08'), null);
  assert.strictEqual(adapter.readDay(preferred, ''), null);

  const nextStore = { getDay() { return { store: 'next' }; } };
  assert.deepStrictEqual(adapter.readDay(nextStore, '2026-09-08'), { store: 'next' },
    'the adapter must use the store supplied for each call');
}

function testCanEnterCompatibility() {
  assert.deepStrictEqual(adapter.canEnter(null, { entriesRemaining: 2 }), {
    allowed: true,
    source: 'fallback'
  });

  const explicitCalls = [];
  const explicit = {
    canEnter(dateKey, entryLimit) {
      explicitCalls.push([this, dateKey, entryLimit]);
      return false;
    }
  };
  assert.deepStrictEqual(adapter.canEnter(explicit, {
    dateKey: '2026-09-08', dayId: 'day-a', entryLimit: 3, entriesRemaining: 2
  }), { allowed: false, source: 'store', raw: false });
  assert.strictEqual(explicitCalls.length, 1);
  assert.strictEqual(explicitCalls[0][0], explicit);

  const objectCalls = [];
  const objectFirst = {
    canEnter(input) {
      objectCalls.push([this, ...arguments]);
      return typeof input === 'object' ? { canEnter: true, extra: 'kept' } : false;
    }
  };
  const objectResult = adapter.canEnter(objectFirst, {
    dateKey: '2026-09-08', dayId: 'day-a', entryLimit: 3, entriesRemaining: 0
  });
  assert.strictEqual(objectResult.allowed, true);
  assert.strictEqual(objectResult.raw.extra, 'kept');
  assert.deepStrictEqual(objectCalls.map(call => call.slice(1)), [
    ['2026-09-08', 3],
    [{ dateKey: '2026-09-08', dayId: 'day-a', entryLimit: 3 }]
  ]);
  objectCalls.forEach(call => assert.strictEqual(call[0], objectFirst));

  let attempts = 0;
  const failing = { canEnter() { attempts++; throw new Error('unavailable'); } };
  assert.deepStrictEqual(adapter.canEnter(failing, {
    dateKey: '2026-09-08', entryLimit: 3, entriesRemaining: 1
  }), { allowed: true, source: 'store', raw: null });
  assert.strictEqual(attempts, 2);
}

function testRecordEntryCompatibility() {
  const calls = [];
  const store = {
    recordEntry(input) {
      calls.push([this, ...arguments]);
      if (typeof input === 'object') return undefined;
      return {
        ok: true,
        persisted: false,
        entriesUsed: '2',
        remainingEntries: '1',
        debugUnlimited: true,
        extra: 'kept'
      };
    }
  };
  const payload = {
    dateKey: '2026-09-08',
    dayId: 'day-a',
    entryLimit: 3,
    levelIds: ['first', 'second'],
    idempotencyKey: 'entry-key',
    unlimited: false
  };
  const result = adapter.recordEntry(store, payload, {
    entryLimit: 3, entriesUsed: 1, entriesRemaining: 2
  });
  assert.deepStrictEqual(calls.map(call => call.slice(1)), [
    [payload],
    ['2026-09-08', 3, 'day-a', ['first', 'second'], { unlimited: false }]
  ]);
  calls.forEach(call => assert.strictEqual(call[0], store));
  assert.deepStrictEqual(result, {
    accepted: true,
    result: {
      ok: true,
      persisted: false,
      entriesUsed: '2',
      entriesRemaining: null,
      remainingEntries: '1',
      debugUnlimited: true,
      extra: 'kept',
      unlimited: true
    }
  });

  const rejected = adapter.recordEntry({
    recordEntry() { return { ok: false, reason: 'custom-denial', detail: 7 }; }
  }, payload, { entryLimit: 3, entriesUsed: 0 });
  assert.deepStrictEqual(rejected, {
    accepted: false,
    result: { ok: false, reason: 'custom-denial', detail: 7 }
  });

  const rawAllowedFalse = adapter.recordEntry({
    recordEntry() { return { ok: true, allowed: false }; }
  }, payload, { entryLimit: 3, entriesUsed: 0 });
  assert.deepStrictEqual(rawAllowedFalse, {
    accepted: false,
    result: { ok: true, reason: 'entry-limit-reached', allowed: false }
  }, 'the control decision must not be overwritten by the original ok field');

  const rawError = adapter.recordEntry({
    recordEntry() { return { ok: true, error: 'persist-failed', persisted: false }; }
  }, payload, { entryLimit: 3, entriesUsed: 0 });
  assert.deepStrictEqual(rawError, {
    accepted: false,
    result: {
      ok: true,
      reason: 'entry-limit-reached',
      error: 'persist-failed',
      persisted: false
    }
  }, 'an error field remains a rejected control result even when ok is true');

  const errors = adapter.recordEntry({ recordEntry() { throw new Error('write failed'); } },
    payload, { entryLimit: 3, entriesUsed: 0 });
  assert.deepStrictEqual(errors, {
    accepted: false,
    result: { ok: false, reason: 'entry-record-error' }
  });

  const nextStore = { recordEntry() { return true; } };
  assert.deepStrictEqual(adapter.recordEntry(nextStore, Object.assign({}, payload, { unlimited: true }), {
    entryLimit: 3, entriesUsed: 2
  }), {
    accepted: true,
    result: { ok: true, persisted: true, entriesUsed: 3, entriesRemaining: null, unlimited: true }
  });
}

function testRecordCompletionCompatibility() {
  const payload = {
    dateKey: '2026-09-08',
    dayId: 'day-a',
    levelId: 'second',
    challengeId: 'second',
    levelIndex: 1,
    levelCount: 2,
    levelIds: ['first', 'second'],
    elapsedMs: 1234.6,
    completedAt: 1788832984005
  };
  const calls = [];
  const current = {
    recordLevelCompletion(input) {
      calls.push([this, ...arguments]);
      if (typeof input === 'object') return null;
      return { ok: true, persisted: true, elapsedMs: 1200, extra: 'kept' };
    }
  };
  assert.deepStrictEqual(adapter.recordCompletion(current, payload), {
    ok: true,
    elapsedMs: 1200,
    levelId: 'second',
    levelIndex: 1,
    persisted: true,
    extra: 'kept'
  });
  assert.deepStrictEqual(calls.map(call => call.slice(1)), [
    [payload],
    ['2026-09-08', 'second', 1234.6, 1788832984005]
  ]);
  calls.forEach(call => assert.strictEqual(call[0], current));

  let legacyEmptyCalls = 0;
  const legacyEmpty = { recordCompletion() { legacyEmptyCalls++; return undefined; } };
  assert.strictEqual(adapter.recordCompletion(legacyEmpty, payload), null);
  assert.strictEqual(legacyEmptyCalls, 1,
    'an empty legacy result must not trigger the positional retry reserved for exceptions');

  const legacyCalls = [];
  const legacyThrow = {
    recordCompletion(input) {
      legacyCalls.push([this, ...arguments]);
      if (typeof input === 'object') throw new Error('object form unsupported');
      return { ok: true, persisted: true, firstClear: true };
    }
  };
  assert.strictEqual(adapter.recordCompletion(legacyThrow, payload).firstClear, true);
  assert.deepStrictEqual(legacyCalls.map(call => call.slice(1)), [
    [payload],
    ['2026-09-08', 'second', 1234.6, 1788832984005]
  ]);
  legacyCalls.forEach(call => assert.strictEqual(call[0], legacyThrow));

  assert.deepStrictEqual(adapter.recordCompletion(null, payload), {
    ok: true,
    elapsedMs: 1234.6,
    levelId: 'second',
    levelIndex: 1,
    firstClear: false,
    newBest: false,
    bestMs: 1234.6,
    persisted: false
  });
  assert.strictEqual(adapter.recordCompletion({ recordLevelCompletion() { return false; } }, payload), null);
  assert.strictEqual(adapter.recordCompletion({ recordLevelCompletion() { return { error: 'bad-write' }; } }, payload), null);
}

function run() {
  testReadDay();
  testCanEnterCompatibility();
  testRecordEntryCompatibility();
  testRecordCompletionCompatibility();
}

module.exports = run;
