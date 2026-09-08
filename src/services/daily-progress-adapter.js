'use strict';

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function integer(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

function resultAllowed(result) {
  if (result === false || result === null || result === undefined) return false;
  if (result === true) return true;
  if (!isObject(result)) return !!result;
  if (result.ok === false || result.allowed === false || result.canEnter === false ||
      result.available === false) return false;
  if (result.error || result.reason === 'entry-limit-reached' || result.reason === 'limit-reached') {
    return false;
  }
  return true;
}

function allowedValue(result, fallback) {
  if (typeof result === 'boolean') return result;
  if (isObject(result)) {
    if (result.allowed !== undefined) return !!result.allowed;
    if (result.canEnter !== undefined) return !!result.canEnter;
    if (result.available !== undefined) return !!result.available;
    if (result.ok !== undefined) return result.ok !== false;
  }
  return fallback;
}

/**
 * Read one daily record while preserving the current store's method priority
 * and receiver. A failing preferred method does not fall through to another
 * storage contract.
 */
function readDay(store, dateKey) {
  if (!store || !dateKey) return null;
  try {
    if (typeof store.getDay === 'function') return store.getDay(dateKey);
    if (typeof store.get === 'function') return store.get(dateKey);
  } catch (error) {
    return null;
  }
  return null;
}

/**
 * Adapt the positional canEnter contract and the early single-object host
 * contract without turning an explicit two-argument rejection into a retry.
 */
function canEnter(store, input) {
  const data = input || {};
  const fallback = data.entriesRemaining > 0;
  if (!store || typeof store.canEnter !== 'function') {
    return { allowed: fallback, source: 'fallback' };
  }
  let result;
  try {
    result = store.canEnter(data.dateKey, data.entryLimit);
  } catch (error) {
    result = null;
  }
  if (result === undefined || result === null ||
      (result === false && store.canEnter.length <= 1)) {
    try {
      result = store.canEnter({
        dateKey: data.dateKey,
        dayId: data.dayId,
        entryLimit: data.entryLimit
      });
    } catch (error) {
      result = null;
    }
  }
  return { allowed: allowedValue(result, fallback), source: 'store', raw: result };
}

/**
 * Execute the existing entry write compatibility sequence and preserve the
 * historical field override order in the normalized result. `accepted` is
 * the legacy control decision for later side effects; it is deliberately
 * separate from host-provided fields such as result.ok and result.canEnter.
 */
function recordEntry(store, payload, previousNumbers) {
  const data = payload || {};
  const previous = previousNumbers || {};
  let result;
  try {
    result = store.recordEntry(data);
  } catch (error) {
    result = null;
  }
  if (result === undefined || result === null) {
    try {
      result = store.recordEntry(
        data.dateKey,
        data.entryLimit,
        data.dayId,
        data.levelIds,
        { unlimited: data.unlimited === true }
      );
    } catch (error) {
      result = { ok: false, reason: 'entry-record-error' };
    }
  }
  if (!resultAllowed(result)) {
    return {
      accepted: false,
      result: Object.assign(
        { ok: false, reason: 'entry-limit-reached' },
        isObject(result) ? result : {}
      )
    };
  }
  const used = isObject(result) && result.entriesUsed !== undefined
    ? Math.max(0, integer(result.entriesUsed, previous.entriesUsed + 1))
    : previous.entriesUsed + 1;
  const reportedRemaining = isObject(result)
    ? (result.entriesRemaining === undefined ? result.remainingEntries : result.entriesRemaining)
    : undefined;
  const unlimited = data.unlimited === true ||
    (isObject(result) && (result.unlimited === true || result.debugUnlimited === true));
  const remaining = unlimited ? null : (reportedRemaining !== undefined
    ? Math.max(0, integer(reportedRemaining, Math.max(0, previous.entryLimit - used)))
    : Math.max(0, previous.entryLimit - used));
  return {
    accepted: true,
    result: Object.assign(
      { ok: true, persisted: true, entriesUsed: used, entriesRemaining: remaining },
      isObject(result) ? result : {},
      { unlimited }
    )
  };
}

/**
 * Execute daily completion against the current or legacy store contract.
 * The legacy recordCompletion method retries only when its object call throws.
 */
function recordCompletion(store, payload) {
  const data = payload || {};
  let completion;
  if (store && typeof store.recordLevelCompletion === 'function') {
    try {
      completion = store.recordLevelCompletion(data);
    } catch (error) {
      completion = null;
    }
    if (completion === undefined || completion === null) {
      try {
        completion = store.recordLevelCompletion(
          data.dateKey, data.levelId, data.elapsedMs, data.completedAt
        );
      } catch (error) {
        completion = null;
      }
    }
  } else if (store && typeof store.recordCompletion === 'function') {
    try {
      completion = store.recordCompletion(data);
    } catch (error) {
      try {
        completion = store.recordCompletion(
          data.dateKey, data.levelId, data.elapsedMs, data.completedAt
        );
      } catch (ignored) {
        completion = null;
      }
    }
  } else {
    completion = {
      ok: true,
      firstClear: false,
      newBest: false,
      bestMs: data.elapsedMs,
      persisted: false
    };
  }
  if (!resultAllowed(completion)) return null;
  return Object.assign(
    { ok: true, elapsedMs: data.elapsedMs, levelId: data.levelId, levelIndex: data.levelIndex },
    isObject(completion) ? completion : {}
  );
}

module.exports = {
  readDay,
  canEnter,
  recordEntry,
  recordCompletion
};
