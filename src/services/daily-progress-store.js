'use strict';

// Daily progress intentionally lives beside, but never inside, the ordinary
// ProgressStore schema. The storage key is kept at v1 for compatibility with
// the first daily-mode rollout; the payload can evolve through schemaVersion.

const STORAGE_KEY = 'cleared:minigame:daily:v1';
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_ENTRY_LIMIT = 3;
const SCHEMA_VERSION = 1;

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (isRecord(value)) {
    const result = {};
    Object.keys(value).forEach(key => {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') return;
      result[key] = clone(value[key]);
    });
    return result;
  }
  return value;
}

function validDateKey(value) {
  if (typeof value !== 'string' || !DATE_KEY_RE.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function finiteNonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && Math.floor(number) === number
    ? number
    : null;
}

function normalizedCount(value, fallback) {
  const number = finiteNonNegativeInteger(value);
  return number === null ? fallback : number;
}

function normalizedLimit(value, fallback) {
  const number = finiteNonNegativeInteger(value);
  return number !== null && number > 0 ? number : fallback;
}

function normalizedElapsed(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.max(1, Math.round(number)) : 1;
}

function normalizedCompletedAt(value, fallback) {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? Math.round(time) : fallback;
  }
  const number = finiteNonNegativeInteger(value);
  return number === null ? fallback : number;
}

function readStorage(platform, key) {
  if (!platform) return null;
  try {
    if (typeof platform.getStorage === 'function') return platform.getStorage(key);
    if (typeof platform.getStorageSync === 'function') return platform.getStorageSync(key);
  } catch (error) {
    return null;
  }
  return null;
}

function writeStorage(platform, key, value) {
  if (!platform) return true;
  try {
    if (typeof platform.setStorage === 'function') {
      return platform.setStorage(key, value) !== false;
    }
    if (typeof platform.setStorageSync === 'function') {
      return platform.setStorageSync(key, value) !== false;
    }
  } catch (error) {
    return false;
  }
  // A lightweight in-memory/test platform may intentionally omit storage. It
  // is still useful to keep the service operational; callers can inspect
  // `state` while a real platform supplies persistence in production.
  return true;
}

function createDefaultState() {
  return { schemaVersion: SCHEMA_VERSION, entries: {}, rewardBaselines: {} };
}

function stringId(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function idFromLevel(raw, key) {
  if (!isRecord(raw)) return stringId(key);
  return stringId(raw.levelId) || stringId(raw.LevelId) ||
    stringId(raw.challengeId) || stringId(raw.ChallengeId) ||
    stringId(raw.Id) || stringId(key);
}

function levelIndexFrom(raw, fallback) {
  if (!isRecord(raw)) return fallback;
  const value = raw.levelIndex !== undefined ? raw.levelIndex : raw.LevelIndex;
  const number = finiteNonNegativeInteger(value);
  return number === null ? fallback : number;
}

function normalizeLevel(raw, key, fallbackIndex) {
  const id = idFromLevel(raw, key);
  if (!id) return null;
  const result = {
    levelIndex: levelIndexFrom(raw, fallbackIndex),
    completed: isRecord(raw) && raw.completed === true,
    bestMs: normalizedCount(isRecord(raw) ? raw.bestMs : 0, 0)
  };
  if (isRecord(raw)) {
    const completedAt = normalizedCompletedAt(raw.completedAt, null);
    if (completedAt !== null) result.completedAt = completedAt;
  }
  return { id, value: result };
}

function normalizeLevels(raw) {
  const levels = {};
  if (!isRecord(raw)) return levels;
  const source = raw.levels !== undefined ? raw.levels : raw.Levels;
  if (Array.isArray(source)) {
    source.forEach((level, index) => {
      const normalized = normalizeLevel(level, null, index);
      if (normalized && !own(levels, normalized.id)) levels[normalized.id] = normalized.value;
    });
  } else if (isRecord(source)) {
    Object.keys(source).forEach((key, index) => {
      const normalized = normalizeLevel(source[key], key, index);
      if (normalized && !own(levels, normalized.id)) levels[normalized.id] = normalized.value;
    });
  }

  // Migration from the original one-challenge record shape.
  if (Object.keys(levels).length === 0) {
    const legacyId = stringId(raw.challengeId) || stringId(raw.ChallengeId);
    if (legacyId) {
      const normalized = normalizeLevel(raw, legacyId, 0);
      if (normalized) levels[normalized.id] = normalized.value;
    }
  }
  return levels;
}

function normalizeIdList(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  value.forEach(item => {
    const id = stringId(item);
    if (id && result.indexOf(id) < 0) result.push(id);
  });
  return result;
}

function normalizeDayRecord(raw, dateKey) {
  const source = isRecord(raw) ? raw : {};
  const levels = normalizeLevels(source);
  const entryHistory = Array.isArray(source.entryHistory)
    ? source.entryHistory.filter(item => isRecord(item)).map(clone)
    : [];
  const keys = normalizeIdList(
    source.idempotencyKeys || source.entryIds || source._entryKeys
  );
  const rawAttempts = source.entriesUsed !== undefined
    ? source.entriesUsed
    : source.attempts;
  const entriesUsed = normalizedCount(rawAttempts, entryHistory.length);
  const explicitCount = source.levelCount !== undefined
    ? normalizedCount(source.levelCount, null)
    : null;
  const levelCount = explicitCount !== null
    ? explicitCount
    : (Object.keys(levels).length || (stringId(source.challengeId) ? 1 : 0));
  const allLevelsCompleted = levelCount > 0 &&
    Object.keys(levels).length >= levelCount &&
    Object.keys(levels).every(id => levels[id].completed === true);
  const result = {
    dayId: stringId(source.dayId) || stringId(source.DayId) || null,
    entryLimit: normalizedLimit(source.entryLimit !== undefined ? source.entryLimit : source.EntryLimit,
      DEFAULT_ENTRY_LIMIT),
    entriesUsed,
    attempts: entriesUsed,
    completed: source.completed === true || source.dayCompleted === true || allLevelsCompleted,
    levels
  };
  result._explicitEntryLimit = source._explicitEntryLimit === true;
  // These fields are implementation metadata. They are stripped from the
  // public getDay() projection but retained in state for idempotency/migration.
  result._levelCount = levelCount;
  result._levelIds = normalizeIdList(source.levelIds || source._levelIds);
  Object.keys(levels).forEach(id => {
    if (result._levelIds.indexOf(id) < 0) result._levelIds.push(id);
  });
  result._entryKeys = keys;
  result._grantIds = normalizeIdList(source._grantIds);
  if (entryHistory.length) result.entryHistory = entryHistory;
  if (validDateKey(dateKey)) result._dateKey = dateKey;
  return result;
}

function publicDay(record) {
  if (!record) {
    return {
      dayId: null,
      entryLimit: DEFAULT_ENTRY_LIMIT,
      entriesUsed: 0,
      attempts: 0,
      entriesRemaining: DEFAULT_ENTRY_LIMIT,
      remainingEntries: DEFAULT_ENTRY_LIMIT,
      completed: false,
      levels: {}
    };
  }
  const storedLimit = normalizedLimit(record.entryLimit, DEFAULT_ENTRY_LIMIT);
  const entryLimit = record._explicitEntryLimit
    ? storedLimit : Math.max(DEFAULT_ENTRY_LIMIT, storedLimit);
  const entriesUsed = normalizedCount(record.entriesUsed, 0);
  return {
    dayId: record.dayId || null,
    entryLimit,
    entriesUsed,
    attempts: normalizedCount(record.attempts, entriesUsed),
    entriesRemaining: Math.max(0, entryLimit - entriesUsed),
    remainingEntries: Math.max(0, entryLimit - entriesUsed),
    completed: record.completed === true,
    levels: clone(record.levels || {})
  };
}

function resultBase(dateKey) {
  return {
    ok: false,
    dateKey: validDateKey(dateKey) ? dateKey : null,
    firstClear: false,
    newBest: false,
    challengeMismatch: false
  };
}

/**
 * Independent persistence for daily entries and level completions. Nothing
 * in this class reads or mutates the ordinary ProgressStore schema.
 */
class DailyProgressStore {
  constructor(platform, options) {
    this.platform = platform || null;
    const opts = options || {};
    this.clock = typeof opts.clock === 'function' ? opts.clock : () => Date.now();
    this.debugUnlimited = opts.debugUnlimited === true || opts.unlimited === true;
    this._memoryState = null;
    this.state = this.load();
  }

  load() {
    let saved = readStorage(this.platform, STORAGE_KEY);
    if (typeof saved === 'string') {
      try { saved = JSON.parse(saved); } catch (error) { saved = null; }
    }
    if (!isRecord(saved)) return createDefaultState();
    return this.normalize(saved);
  }

  normalize(saved) {
    const state = createDefaultState();
    const entries = isRecord(saved.entries) ? saved.entries :
      (isRecord(saved.days) ? saved.days : {});
    Object.keys(entries).forEach(dateKey => {
      if (!validDateKey(dateKey) || !isRecord(entries[dateKey])) return;
      state.entries[dateKey] = normalizeDayRecord(entries[dateKey], dateKey);
    });
    const baselines = isRecord(saved.rewardBaselines) ? saved.rewardBaselines : {};
    Object.keys(baselines).forEach(dateKey => {
      if (validDateKey(dateKey) && stringId(baselines[dateKey])) state.rewardBaselines[dateKey] = baselines[dateKey];
    });
    return state;
  }

  save() {
    const payload = clone(this.state);
    const persisted = writeStorage(this.platform, STORAGE_KEY, payload);
    if (persisted) this._memoryState = payload;
    return persisted;
  }

  exportRewardCompletions() {
    if (!this.platform || typeof this.platform.readStorageResult !== 'function') {
      return { ok: false, reason: 'storage-read-failed' };
    }
    let read;
    try { read = this.platform.readStorageResult(STORAGE_KEY); } catch (error) {}
    if (!read || read.ok !== true) return { ok: false, reason: 'storage-read-failed' };
    if (read.found === false) return { ok: true, days: [] };
    if (read.found !== true) return { ok: false, reason: 'storage-read-failed' };
    let saved = read.value;
    if (typeof saved === 'string') {
      try { saved = JSON.parse(saved); } catch (error) { return { ok: false, reason: 'invalid-storage' }; }
    }
    if (!isRecord(saved) || saved.schemaVersion !== SCHEMA_VERSION || !isRecord(saved.entries) ||
        (saved.rewardBaselines !== undefined && (!isRecord(saved.rewardBaselines) ||
          Object.keys(saved.rewardBaselines).some(dateKey => !validDateKey(dateKey) || !stringId(saved.rewardBaselines[dateKey])))) ||
        Object.keys(saved.entries).some(dateKey => !validDateKey(dateKey) || !isRecord(saved.entries[dateKey]))) {
      return { ok: false, reason: 'invalid-storage' };
    }
    const baselines = saved.rewardBaselines || {};
    const days = [];
    let invalid = false;
    Object.keys(saved.entries).forEach(dateKey => {
      const raw = saved.entries[dateKey];
      if (!validDateKey(dateKey) || !isRecord(raw)) return;
      if (!isRecord(raw.levels)) {
        if (raw.dayId && raw.completed === true) invalid = true;
        return;
      }
      const ids = Array.isArray(raw._levelIds) ? raw._levelIds.slice() : (Array.isArray(raw.levelIds) ? raw.levelIds.slice() : []);
      const expected = raw._levelCount === undefined ? raw.levelCount : raw._levelCount;
      if (!Object.keys(raw.levels).every(id => !['__proto__', 'constructor', 'prototype'].includes(id) &&
          isRecord(raw.levels[id]) && typeof raw.levels[id].completed === 'boolean' &&
          Number.isSafeInteger(raw.levels[id].levelIndex) && raw.levels[id].levelIndex >= 0)) {
        invalid = true; return;
      }
      if (ids.length === 2 && (ids[0] === ids[1] || !ids.every((id, index) =>
          typeof id === 'string' && /^[A-Za-z0-9_:-]{1,200}$/.test(id) && own(raw.levels, id) && raw.levels[id].levelIndex === index))) {
        invalid = true; return;
      }
      if (expected !== 2 || ids.length !== 2 || ids[0] === ids[1] ||
          !stringId(raw.dayId) || !ids.every((id, index) => typeof id === 'string' && /^[A-Za-z0-9_:-]{1,200}$/.test(id) &&
            !['__proto__', 'constructor', 'prototype'].includes(id) && own(raw.levels, id) &&
            isRecord(raw.levels[id]) && raw.levels[id].levelIndex === index && raw.levels[id].completed === true)) return;
      if (baselines[dateKey] !== raw.dayId) days.push({ dateKey, dayId: raw.dayId, levelIds: ids });
    });
    return invalid ? { ok: false, reason: 'invalid-storage' } : { ok: true, days };
  }

  exportBackupSnapshot(dateKey) {
    if (!validDateKey(dateKey)) return { ok: false, reason: 'invalid-date-key' };
    if (!this.platform || typeof this.platform.readStorageResult !== 'function') {
      return { ok: false, reason: 'storage-read-failed' };
    }
    let read;
    try { read = this.platform.readStorageResult(STORAGE_KEY); } catch (error) {}
    if (!read || read.ok !== true || (read.found !== true && read.found !== false)) {
      return { ok: false, reason: 'storage-read-failed' };
    }
    if (read.found === false) return { ok: true, snapshot: { schemaVersion: 1, dateKey, day: null } };
    let saved = read.value;
    if (typeof saved === 'string') {
      try { saved = JSON.parse(saved); } catch (error) { return { ok: false, reason: 'invalid-storage' }; }
    }
    const entries = isRecord(saved) && isRecord(saved.entries) ? saved.entries
      : isRecord(saved) && isRecord(saved.days) ? saved.days : null;
    if (!isRecord(saved) || saved.schemaVersion !== SCHEMA_VERSION || !entries ||
        Object.keys(entries).some(key => !validDateKey(key) || !isRecord(entries[key]))) {
      return { ok: false, reason: 'invalid-storage' };
    }
    const source = entries[dateKey];
    if (!source) return { ok: true, snapshot: { schemaVersion: 1, dateKey, day: null } };
    const day = normalizeDayRecord(source, dateKey);
    const levelIds = Array.isArray(day._levelIds) ? day._levelIds.slice() : Object.keys(day.levels)
      .sort((a, b) => day.levels[a].levelIndex - day.levels[b].levelIndex);
    if (!stringId(day.dayId) || levelIds.length !== 2 || levelIds[0] === levelIds[1] ||
        !levelIds.every((id, index) => stringId(id) && day.levels[id] && day.levels[id].levelIndex === index)) {
      return { ok: false, reason: 'invalid-storage' };
    }
    const snapshot = { schemaVersion: 1, dateKey, day: { dayId: day.dayId,
      entryLimit: normalizedLimit(day.entryLimit, DEFAULT_ENTRY_LIMIT), entriesUsed: normalizedCount(day.entriesUsed, 0),
      completed: day.completed === true, levelIds, levels: clone(day.levels),
      entryKeys: normalizeIdList(day._entryKeys), grantIds: normalizeIdList(day._grantIds) } };
    if (snapshot.day.entriesUsed !== snapshot.day.entryKeys.length || snapshot.day.entriesUsed > snapshot.day.entryLimit) {
      return { ok: false, reason: 'invalid-storage' };
    }
    return { ok: true, snapshot };
  }

  applyBackupSnapshot(snapshot) {
    if (!isRecord(snapshot) || snapshot.schemaVersion !== 1 || !validDateKey(snapshot.dateKey) ||
        (snapshot.day !== null && !isRecord(snapshot.day))) return { ok: false, reason: 'invalid-snapshot' };
    const previous = this.state;
    const rewardBaselines = Object.assign({}, previous.rewardBaselines || {});
    Object.keys(previous.entries).forEach(dateKey => {
      const existing = previous.entries[dateKey];
      if (existing && existing.completed === true && stringId(existing.dayId)) rewardBaselines[dateKey] = existing.dayId;
    });
    if (snapshot.day === null) {
      this.state = { schemaVersion: SCHEMA_VERSION, entries: Object.assign({}, previous.entries), rewardBaselines };
      if (!this.save()) { this.state = previous; return { ok: false, reason: 'persist-failed' }; }
      return { ok: true };
    }
    const day = snapshot.day;
    if (!stringId(day.dayId) || !Number.isSafeInteger(day.entryLimit) || day.entryLimit <= 0 ||
        !Number.isSafeInteger(day.entriesUsed) || day.entriesUsed < 0 || day.entriesUsed > day.entryLimit ||
        typeof day.completed !== 'boolean' || !Array.isArray(day.levelIds) || day.levelIds.length !== 2 ||
        day.levelIds[0] === day.levelIds[1] || !isRecord(day.levels) || !Array.isArray(day.entryKeys) ||
        day.entriesUsed !== day.entryKeys.length || new Set(day.entryKeys).size !== day.entryKeys.length ||
        !day.entryKeys.every(stringId) || !Array.isArray(day.grantIds) || new Set(day.grantIds).size !== day.grantIds.length ||
        !day.grantIds.every(stringId)) return { ok: false, reason: 'invalid-snapshot' };
    const levels = {};
    for (let index = 0; index < day.levelIds.length; index++) {
      const id = day.levelIds[index]; const level = day.levels[id];
      if (!stringId(id) || !isRecord(level) || level.levelIndex !== index || typeof level.completed !== 'boolean' ||
          !Number.isSafeInteger(level.bestMs) || level.bestMs < 0 ||
          (level.completedAt !== undefined && (!Number.isSafeInteger(level.completedAt) || level.completedAt < 0))) {
        return { ok: false, reason: 'invalid-snapshot' };
      }
      levels[id] = clone(level);
    }
    if (Object.keys(day.levels).length !== day.levelIds.length ||
        day.completed !== day.levelIds.every(id => levels[id].completed === true)) return { ok: false, reason: 'invalid-snapshot' };
    const entry = { dayId: day.dayId, entryLimit: day.entryLimit, entriesUsed: day.entriesUsed,
      attempts: day.entriesUsed, completed: day.completed, levels, _explicitEntryLimit: true,
      _levelCount: day.levelIds.length, _levelIds: day.levelIds.slice(), _entryKeys: day.entryKeys.slice(),
      _grantIds: day.grantIds.slice(), _dateKey: snapshot.dateKey };
    if (entry.completed) rewardBaselines[snapshot.dateKey] = entry.dayId;
    else delete rewardBaselines[snapshot.dateKey];
    this.state = { schemaVersion: SCHEMA_VERSION,
      entries: Object.assign({}, previous.entries, { [snapshot.dateKey]: entry }), rewardBaselines };
    if (!this.save()) { this.state = previous; return { ok: false, reason: 'persist-failed' }; }
    return { ok: true };
  }

  /**
   * Return the canonical daily record. A valid but unseen date receives an
   * ephemeral zeroed record; it is not written until recordEntry/completion.
   */
  getDay(dateKey) {
    if (!validDateKey(dateKey)) return null;
    return publicDay(this.state.entries[dateKey]);
  }

  /** Legacy projection retained for one-level callers/tests. */
  get(dateKey) {
    if (!validDateKey(dateKey)) return null;
    const record = this.state.entries[dateKey];
    if (!record) return null;
    const ids = Object.keys(record.levels || {});
    const id = ids.length ? ids.sort((a, b) => {
      const ai = Number(record.levels[a].levelIndex) || 0;
      const bi = Number(record.levels[b].levelIndex) || 0;
      return ai - bi;
    })[0] : null;
    if (!id) return null;
    const level = record.levels[id];
    const result = {
      challengeId: id,
      completed: level.completed === true,
      bestMs: normalizedCount(level.bestMs, 0)
    };
    if (level.completedAt !== undefined) result.completedAt = level.completedAt;
    return result;
  }

  getLevel(dateKey, levelId) {
    if (!validDateKey(dateKey) || !stringId(levelId)) return null;
    const record = this.state.entries[dateKey];
    const level = record && record.levels && record.levels[levelId];
    return level ? clone(level) : null;
  }

  isLevelCompleted(dateKey, levelId) {
    const level = this.getLevel(dateKey, levelId);
    return !!(level && level.completed === true);
  }

  /** Return whether the day (or a legacy level id) has been completed. */
  isCompleted(dateKey, dayId) {
    if (!validDateKey(dateKey)) return false;
    const record = this.state.entries[dateKey];
    if (!record) return false;
    if (dayId === undefined || dayId === null) return record.completed === true;
    if (record.dayId && record.dayId === dayId) return record.completed === true;
    const level = record.levels && record.levels[dayId];
    return !!(level && level.completed === true);
  }

  effectiveEntryLimit(record, requested) {
    const supplied = requested !== undefined && requested !== null
      ? normalizedLimit(requested, null)
      : null;
    const stored = record ? normalizedLimit(record.entryLimit, null) : null;
    // A supplied limit can represent a future bonus; never silently lower a
    // limit already persisted for the day.
    if (supplied !== null && stored !== null) return Math.max(supplied, stored);
    if (supplied !== null) return supplied;
    // Records written by the earlier one-entry rollout are transparently
    // raised to the current three-entry baseline when no explicit limit is
    // supplied. Explicit callers (including tests and future content) may
    // still request a smaller scoped limit.
    if (record && record._explicitEntryLimit === true) return stored || DEFAULT_ENTRY_LIMIT;
    return Math.max(DEFAULT_ENTRY_LIMIT, stored || 0);
  }

  /** Check whether one more complete daily run may be started. */
  canEnter(input, suppliedLimit, suppliedOptions) {
    let dateKey = input;
    let requested = suppliedLimit;
    let requestedDayId = null;
    let unlimited = false;
    if (isRecord(input)) {
      dateKey = input.dateKey === undefined ? input.DateKey : input.dateKey;
      requested = input.entryLimit === undefined ? input.EntryLimit : input.entryLimit;
      requestedDayId = stringId(input.dayId) || stringId(input.DayId);
      unlimited = this.debugUnlimited || input.unlimited === true || input.debugUnlimited === true;
    } else if (isRecord(suppliedLimit)) {
      requested = suppliedLimit.entryLimit === undefined
        ? suppliedLimit.EntryLimit : suppliedLimit.entryLimit;
      requestedDayId = stringId(suppliedLimit.dayId) || stringId(suppliedLimit.DayId);
      unlimited = this.debugUnlimited || suppliedLimit.unlimited === true || suppliedLimit.debugUnlimited === true;
    } else if (isRecord(suppliedOptions)) {
      unlimited = this.debugUnlimited || suppliedOptions.unlimited === true || suppliedOptions.debugUnlimited === true;
    }
    if (!validDateKey(dateKey)) return false;
    const record = this.state.entries[dateKey];
    if (record && requestedDayId && record.dayId && record.dayId !== requestedDayId) return false;
    if (unlimited) return true;
    const used = record ? normalizedCount(record.entriesUsed, 0) : 0;
    return used < this.effectiveEntryLimit(record, requested);
  }

  parseEntryInput(input, suppliedLimit, metadata, legacyLevelIds, legacyOptions) {
    if (isRecord(input)) return Object.assign({}, input);
    const result = { dateKey: input };
    if (isRecord(suppliedLimit)) Object.assign(result, suppliedLimit);
    else if (suppliedLimit !== undefined) result.entryLimit = suppliedLimit;
    if (isRecord(metadata)) Object.assign(result, metadata);
    else if (typeof metadata === 'string' && metadata) result.dayId = metadata;
    if (Array.isArray(legacyLevelIds)) result.levelIds = legacyLevelIds.slice();
    if (isRecord(legacyOptions)) Object.assign(result, legacyOptions);
    return result;
  }

  /**
   * Consume one daily entry. The write is transactional: a failed platform
   * persistence restores the in-memory state and returns persist-failed.
   */
  recordEntry(input, suppliedLimit, metadata, legacyLevelIds, legacyOptions) {
    const data = this.parseEntryInput(
      input, suppliedLimit, metadata, legacyLevelIds, legacyOptions
    );
    const dateKey = data.dateKey === undefined ? data.DateKey : data.dateKey;
    const invalid = resultBase(dateKey);
    if (!validDateKey(dateKey)) {
      invalid.error = 'invalid-date-key';
      invalid.reason = 'invalid-date-key';
      return invalid;
    }

    const previous = this.state.entries[dateKey];
    const dayId = stringId(data.dayId) || stringId(data.DayId);
    if (previous && previous.dayId && dayId && previous.dayId !== dayId) {
      return Object.assign(invalid, {
        error: 'challenge-mismatch',
        reason: 'challenge-mismatch',
        challengeMismatch: true,
        dayId: previous.dayId,
        entriesUsed: normalizedCount(previous.entriesUsed, 0),
        attempts: normalizedCount(previous.attempts, 0),
        entryLimit: this.effectiveEntryLimit(previous)
      });
    }

    const suppliedEntryLimit = data.entryLimit === undefined ? data.EntryLimit : data.entryLimit;
    if (suppliedEntryLimit !== undefined && normalizedLimit(suppliedEntryLimit, null) === null) {
      invalid.error = 'entry-limit-invalid';
      invalid.reason = 'entry-limit-invalid';
      return invalid;
    }
    const entryLimit = this.effectiveEntryLimit(previous, suppliedEntryLimit);
    const unlimited = this.debugUnlimited || data.unlimited === true || data.debugUnlimited === true;
    const token = stringId(data.idempotencyKey) || stringId(data.entryId) || stringId(data.requestId);
    const previousKeys = previous && Array.isArray(previous._entryKeys) ? previous._entryKeys : [];
    if (token && previousKeys.indexOf(token) >= 0) {
      const used = normalizedCount(previous.entriesUsed, 0);
      return {
        ok: true,
        status: 'already-recorded',
        alreadyRecorded: true,
        firstEntry: false,
        dateKey,
        dayId: previous.dayId || dayId || null,
        idempotencyKey: token,
        entryLimit,
        entriesUsed: used,
        attempts: normalizedCount(previous.attempts, used),
        remainingEntries: unlimited ? null : Math.max(0, entryLimit - used),
        entriesRemaining: unlimited ? null : Math.max(0, entryLimit - used),
        canEnter: unlimited || used < entryLimit,
        unlimited,
        persisted: true
      };
    }

    const used = previous ? normalizedCount(previous.entriesUsed, 0) : 0;
    if (!unlimited && used >= entryLimit) {
      return {
        ok: false,
        error: 'entry-limit-reached',
        reason: 'entry-limit-reached',
        dateKey,
        dayId: previous && previous.dayId ? previous.dayId : (dayId || null),
        entryLimit,
        entriesUsed: used,
        attempts: previous ? normalizedCount(previous.attempts, used) : used,
        remainingEntries: 0,
        entriesRemaining: 0,
        canEnter: false,
        firstEntry: false,
        challengeMismatch: false
      };
    }

    const before = clone(this.state);
    const next = previous ? clone(previous) : normalizeDayRecord({}, dateKey);
    next.dayId = previous && previous.dayId ? previous.dayId : (dayId || null);
    next.entryLimit = entryLimit;
    if (suppliedEntryLimit !== undefined) next._explicitEntryLimit = true;
    next.entriesUsed = used + 1;
    next.attempts = next.entriesUsed;
    if (!Array.isArray(next._entryKeys)) next._entryKeys = [];
    if (token && next._entryKeys.indexOf(token) < 0) next._entryKeys.push(token);

    const levelIds = normalizeIdList(data.levelIds || data.LevelIds);
    if (levelIds.length) {
      if (!Array.isArray(next._levelIds)) next._levelIds = [];
      levelIds.forEach((id, index) => {
        if (next._levelIds.indexOf(id) < 0) next._levelIds.push(id);
        if (!own(next.levels, id)) {
          next.levels[id] = { levelIndex: index, completed: false, bestMs: 0 };
        }
      });
      next._levelCount = Math.max(normalizedCount(next._levelCount, 0), levelIds.length);
    }
    if (next._levelCount === undefined) next._levelCount = Object.keys(next.levels).length;
    if (token) {
      if (!Array.isArray(next.entryHistory)) next.entryHistory = [];
      next.entryHistory.push({ idempotencyKey: token });
    }

    this.state.entries[dateKey] = next;
    if (!this.save()) {
      this.state = before;
      return Object.assign(resultBase(dateKey), {
        error: 'persist-failed',
        reason: 'persist-failed',
        challengeMismatch: false
      });
    }

    return {
      ok: true,
      status: 'recorded',
      alreadyRecorded: false,
      firstEntry: used === 0,
      dateKey,
      dayId: next.dayId,
      idempotencyKey: token,
      entryLimit,
      entriesUsed: next.entriesUsed,
      attempts: next.attempts,
      remainingEntries: unlimited ? null : Math.max(0, entryLimit - next.entriesUsed),
      entriesRemaining: unlimited ? null : Math.max(0, entryLimit - next.entriesUsed),
      canEnter: unlimited || next.entriesUsed < entryLimit,
      unlimited,
      persisted: true
    };
  }

  parseCompletionInput(input, args) {
    if (isRecord(input)) return Object.assign({}, input);
    // Original compatibility signature: recordCompletion(dateKey, id,
    // elapsedMs, completedAt). New callers should use the object form.
    return {
      dateKey: input,
      challengeId: args[0],
      elapsedMs: args[1],
      completedAt: args[2]
    };
  }

  completionMismatch(dateKey, record, data, id) {
    const dayId = stringId(data.dayId) || stringId(data.DayId);
    if (record.dayId && dayId && record.dayId !== dayId) return true;
    const configured = Array.isArray(record._levelIds) ? record._levelIds : [];
    if (configured.length && configured.indexOf(id) < 0) {
      // A caller may record levels one at a time without repeating the full
      // levelIds list. If levelCount says the configured list is incomplete,
      // allow the next level id to be appended; once all expected ids are
      // known, an unknown id is a genuine stale-day mismatch.
      const expected = Math.max(1, normalizedCount(record._levelCount, configured.length));
      if (configured.length >= expected) return true;
    }
    // A legacy one-level record must not be overwritten by another challenge.
    if (!configured.length && Object.keys(record.levels || {}).length === 1 &&
        !own(record.levels, id) && normalizedCount(record._levelCount, 1) <= 1 &&
        !dayId) return true;
    return false;
  }

  /**
   * Record completion for one level. A day becomes completed only after all
   * expected levels have completed. Repeating a completion is idempotent for
   * reward qualification while still allowing a faster best time.
   */
  recordLevelCompletion(input, ...args) {
    const data = this.parseCompletionInput(input, args);
    const dateKey = data.dateKey === undefined ? data.DateKey : data.dateKey;
    const id = stringId(data.levelId) || stringId(data.LevelId) ||
      stringId(data.challengeId) || stringId(data.ChallengeId) || stringId(data.Id);
    const invalid = resultBase(dateKey);
    if (!validDateKey(dateKey)) {
      invalid.error = 'invalid-date-key';
      invalid.reason = 'invalid-date-key';
      return invalid;
    }
    if (!id) {
      invalid.error = 'invalid-level-id';
      invalid.reason = 'invalid-level-id';
      return invalid;
    }

    const previous = this.state.entries[dateKey];
    const dayId = stringId(data.dayId) || stringId(data.DayId);
    if (previous && this.completionMismatch(dateKey, previous, data, id)) {
      return Object.assign(invalid, {
        error: 'challenge-mismatch',
        reason: 'challenge-mismatch',
        challengeMismatch: true,
        dayId: previous.dayId || dayId || null,
        levelId: id,
        challengeId: id
      });
    }

    const before = clone(this.state);
    const next = previous ? clone(previous) : normalizeDayRecord({}, dateKey);
    next.dayId = previous && previous.dayId ? previous.dayId : (dayId || null);
    if (!next.entryLimit) next.entryLimit = DEFAULT_ENTRY_LIMIT;

    const suppliedCount = data.levelCount === undefined ? data.LevelCount : data.levelCount;
    if (suppliedCount !== undefined) {
      const count = normalizedCount(suppliedCount, null);
      if (count === null || count < 1) {
        invalid.error = 'level-count-invalid';
        invalid.reason = 'level-count-invalid';
        return invalid;
      }
      next._levelCount = Math.max(normalizedCount(next._levelCount, 0), count);
    }
    const suppliedIds = normalizeIdList(data.levelIds || data.LevelIds);
    if (suppliedIds.length) {
      if (!Array.isArray(next._levelIds)) next._levelIds = [];
      suppliedIds.forEach((levelId, index) => {
        if (next._levelIds.indexOf(levelId) < 0) next._levelIds.push(levelId);
        if (!own(next.levels, levelId)) {
          next.levels[levelId] = { levelIndex: index, completed: false, bestMs: 0 };
        }
      });
      next._levelCount = Math.max(normalizedCount(next._levelCount, 0), suppliedIds.length);
    }
    if (!own(next.levels, id)) {
      const suppliedIndex = data.levelIndex === undefined ? data.LevelIndex : data.levelIndex;
      const index = finiteNonNegativeInteger(suppliedIndex);
      next.levels[id] = {
        levelIndex: index === null ? Object.keys(next.levels).length : index,
        completed: false,
        bestMs: 0
      };
    }
    if (!Array.isArray(next._levelIds)) next._levelIds = [];
    if (next._levelIds.indexOf(id) < 0) next._levelIds.push(id);
    if (!next._levelCount) next._levelCount = Math.max(1, next._levelIds.length);

    const level = next.levels[id];
    const duration = normalizedElapsed(data.elapsedMs === undefined ? data.elapsed : data.elapsedMs);
    const previousBest = normalizedCount(level.bestMs, 0);
    const firstClear = level.completed !== true;
    const newBest = previousBest === 0 || duration < previousBest;
    const now = (() => {
      try {
        const value = this.clock();
        if (value instanceof Date) return value.getTime();
        return Number(value);
      } catch (error) {
        return Date.now();
      }
    })();
    const completionTime = normalizedCompletedAt(
      data.completedAt === undefined ? data.CompletedAt : data.completedAt,
      Number.isFinite(now) ? Math.round(now) : Date.now()
    );
    level.completed = true;
    level.bestMs = newBest ? duration : previousBest;
    if (level.completedAt === undefined || level.completedAt === null) level.completedAt = completionTime;

    const wasDayCompleted = next.completed === true;
    const expectedCount = Math.max(1, normalizedCount(next._levelCount, Object.keys(next.levels).length));
    const knownIds = Array.isArray(next._levelIds) && next._levelIds.length
      ? next._levelIds
      : Object.keys(next.levels);
    const completeCount = knownIds.reduce((count, levelId) => (
      count + (next.levels[levelId] && next.levels[levelId].completed === true ? 1 : 0)
    ), 0);
    const dayCompleted = completeCount >= expectedCount &&
      knownIds.length >= expectedCount;
    next.completed = dayCompleted;

    // Legacy top-level fields are not persisted in the canonical projection,
    // but keeping the target id in `_legacyChallengeId` helps old migrations.
    next._legacyChallengeId = id;
    this.state.entries[dateKey] = next;
    if (!this.save()) {
      this.state = before;
      return Object.assign(resultBase(dateKey), {
        error: 'persist-failed',
        reason: 'persist-failed',
        challengeMismatch: false,
        dateKey,
        levelId: id,
        challengeId: id
      });
    }

    return {
      ok: true,
      status: 'recorded',
      dateKey,
      dayId: next.dayId,
      levelId: id,
      challengeId: id,
      levelIndex: level.levelIndex,
      levelCount: expectedCount,
      firstClear,
      newBest,
      previousBest,
      bestMs: Number(level.bestMs) || duration,
      completedAt: level.completedAt,
      entriesUsed: normalizedCount(next.entriesUsed, 0),
      attempts: normalizedCount(next.attempts, normalizedCount(next.entriesUsed, 0)),
      entryLimit: normalizedLimit(next.entryLimit, DEFAULT_ENTRY_LIMIT),
      entriesRemaining: Math.max(0,
        normalizedLimit(next.entryLimit, DEFAULT_ENTRY_LIMIT) -
        normalizedCount(next.entriesUsed, 0)),
      remainingEntries: Math.max(0,
        normalizedLimit(next.entryLimit, DEFAULT_ENTRY_LIMIT) -
        normalizedCount(next.entriesUsed, 0)),
      completed: true,
      dayCompleted,
      allLevelsCompleted: dayCompleted,
      dayFirstClear: !wasDayCompleted && dayCompleted,
      rewardEligible: !wasDayCompleted && dayCompleted,
      challengeMismatch: false,
      persisted: true
    };
  }

  applyAuthoritativeSnapshot(snapshot, pendingOperations) {
    if (!isRecord(snapshot) || snapshot.schemaVersion !== 1 || !isRecord(snapshot.days)) {
      return { ok: false, reason: 'invalid-snapshot' };
    }
    const entries = {};
    for (const dateKey of Object.keys(snapshot.days)) {
      const day = snapshot.days[dateKey];
      if (!validDateKey(dateKey) || !isRecord(day) || !stringId(day.dayId) || day.entryLimit !== DEFAULT_ENTRY_LIMIT ||
          !Number.isSafeInteger(day.entriesUsed) || day.entriesUsed < 0 || !Array.isArray(day.entryKeys) ||
          day.entriesUsed !== day.entryKeys.length || day.entriesUsed > day.entryLimit ||
          new Set(day.entryKeys).size !== day.entryKeys.length || !day.entryKeys.every(stringId) ||
          typeof day.completed !== 'boolean' || !isRecord(day.levels)) {
        return { ok: false, reason: 'invalid-snapshot' };
      }
      const levelIds = [`${day.dayId}-intro-v1`, `${day.dayId}-extreme-v1`];
      const presentIds = Object.keys(day.levels).sort((a, b) => day.levels[a].levelIndex - day.levels[b].levelIndex);
      const indexes = new Set();
      if (presentIds.length > 2 || presentIds.some(id => {
        const level = day.levels[id];
        if (level && [0, 1].includes(level.levelIndex)) indexes.add(level.levelIndex);
        return !levelIds.includes(id) || !isRecord(level) || level.levelIndex !== levelIds.indexOf(id) || typeof level.completed !== 'boolean' ||
          !Number.isSafeInteger(level.bestMs) || level.bestMs < 0 ||
          (level.completedAt !== undefined && (!Number.isSafeInteger(level.completedAt) || level.completedAt < 0));
      }) || indexes.size !== presentIds.length ||
          day.completed !== levelIds.every(id => day.levels[id] && day.levels[id].completed === true)) {
        return { ok: false, reason: 'invalid-snapshot' };
      }
      entries[dateKey] = { dayId: day.dayId, entryLimit: DEFAULT_ENTRY_LIMIT,
        entriesUsed: day.entryKeys.length, attempts: day.entryKeys.length, completed: day.completed === true,
        levels: clone(day.levels), _explicitEntryLimit: true, _levelCount: 2, _levelIds: levelIds,
        _entryKeys: day.entryKeys.slice(), _grantIds: [], _dateKey: dateKey };
    }
    const pending = Array.isArray(pendingOperations) ? pendingOperations : [];
    for (const operation of pending) {
      if (!operation || operation.domain !== 'daily' || !isRecord(operation.payload)) continue;
      const p = operation.payload;
      if (!validDateKey(p.dateKey) || !stringId(p.dayId) || !Array.isArray(p.levelIds) || p.levelIds.length !== 2) {
        return { ok: false, reason: 'invalid-operation-overlay' };
      }
      const day = entries[p.dateKey] || { dayId: p.dayId, entryLimit: DEFAULT_ENTRY_LIMIT, entriesUsed: 0, attempts: 0,
        completed: false, levels: {}, _explicitEntryLimit: true, _levelCount: 2, _levelIds: p.levelIds.slice(),
        _entryKeys: [], _grantIds: [], _dateKey: p.dateKey };
      if (day.dayId !== p.dayId) return { ok: false, reason: 'invalid-operation-overlay' };
      if (operation.type === 'DAILY_ENTRY_RECORDED') {
        if (!stringId(p.entryKey)) return { ok: false, reason: 'invalid-operation-overlay' };
        if (!day._entryKeys.includes(p.entryKey)) day._entryKeys.push(p.entryKey);
        day.entriesUsed = day._entryKeys.length; day.attempts = day.entriesUsed;
      } else if (operation.type === 'DAILY_LEVEL_COMPLETED') {
        if (!stringId(p.levelId) || ![0, 1].includes(p.levelIndex) || !Number.isSafeInteger(p.elapsedMs) || p.elapsedMs <= 0) {
          return { ok: false, reason: 'invalid-operation-overlay' };
        }
        const before = day.levels[p.levelId];
        day.levels[p.levelId] = { levelIndex: p.levelIndex, completed: true,
          bestMs: before && before.bestMs > 0 ? Math.min(before.bestMs, p.elapsedMs) : p.elapsedMs,
          completedAt: before && before.completedAt !== undefined ? before.completedAt : p.completedAtClient };
        day._levelIds = p.levelIds.slice();
        day.completed = p.levelIds.every(id => day.levels[id] && day.levels[id].completed === true);
      }
      entries[p.dateKey] = day;
    }
    const previous = this.state; this.state = { schemaVersion: SCHEMA_VERSION, entries };
    if (!this.save()) { this.state = previous; return { ok: false, reason: 'persist-failed' }; }
    return { ok: true };
  }

  isBlankCloudCore() { return Object.keys(this.state.entries).length === 0; }

  // Reserved boundary for the future ad/share entitlement flow. It is
  // intentionally a no-op in the current release: no caller can increase the
  // daily budget without a separately implemented, idempotent reward service.
  applyAuthorizedEntryGrant(input) {
    const data = input || {};
    if (!validDateKey(data.dateKey) || !stringId(data.dayId) || !stringId(data.grantId) ||
        data.grantId.length > 180 || data.dayId.length > 180 || /[\x00-\x1f]/.test(data.grantId + data.dayId) || !Number.isSafeInteger(data.entryLimit) || data.entryLimit <= 0 ||
        !Number.isSafeInteger(data.grantedAt) || data.grantedAt < 0) return { ok: false, reason: 'invalid-grant' };
    const previous = this.state.entries[data.dateKey];
    if (Object.keys(this.state.entries).some(key => key !== data.dateKey &&
        (this.state.entries[key]._grantIds || []).includes(data.grantId))) return { ok: false, reason: 'grant-context-mismatch' };
    if (previous && previous.dayId && previous.dayId !== data.dayId) return { ok: false, reason: 'challenge-mismatch' };
    if (previous && Array.isArray(previous._grantIds) && previous._grantIds.includes(data.grantId)) return { ok: true, alreadyApplied: true };
    if (data.entryLimit < this.effectiveEntryLimit(previous)) return { ok: false, reason: 'entry-limit-decreased' };
    const before = this.state;
    const next = previous ? clone(previous) : normalizeDayRecord({}, data.dateKey);
    next.dayId = data.dayId;
    next.entryLimit = data.entryLimit;
    if (!Array.isArray(next._grantIds)) next._grantIds = [];
    next._grantIds.push(data.grantId);
    this.state = Object.assign({}, before, { entries: Object.assign({}, before.entries, { [data.dateKey]: next }) });
    if (!this.save()) { this.state = before; return { ok: false, reason: 'persist-failed' }; }
    return { ok: true, alreadyApplied: false, entryLimit: next.entryLimit };
  }

  requestEntryIncrease(input) {
    const data = isRecord(input) ? input : { source: input };
    return {
      ok: false,
      implemented: false,
      reason: 'entry-increase-not-implemented',
      source: stringId(data.source) || null,
      idempotencyKey: stringId(data.idempotencyKey) || null
    };
  }

  grantExtraEntry(input) {
    return this.requestEntryIncrease(input);
  }

  increaseEntryLimit(input) {
    return this.requestEntryIncrease(input);
  }

  /** Compatibility alias for the original one-challenge API. */
  recordCompletion(input, challengeId, elapsedMs, completedAt) {
    if (isRecord(input)) {
      const data = Object.assign({}, input);
      if (data.levelId === undefined && data.challengeId === undefined && challengeId !== undefined) {
        data.challengeId = challengeId;
      }
      if (data.elapsedMs === undefined && elapsedMs !== undefined) data.elapsedMs = elapsedMs;
      if (data.completedAt === undefined && completedAt !== undefined) data.completedAt = completedAt;
      return this.recordLevelCompletion(data);
    }
    return this.recordLevelCompletion({
      dateKey: input,
      challengeId,
      elapsedMs,
      completedAt
    });
  }
}

DailyProgressStore.STORAGE_KEY = STORAGE_KEY;
DailyProgressStore.DATE_KEY_RE = DATE_KEY_RE;
DailyProgressStore.DEFAULT_ENTRY_LIMIT = DEFAULT_ENTRY_LIMIT;
DailyProgressStore.createDefaultState = createDefaultState;
DailyProgressStore.isValidDateKey = validDateKey;
DailyProgressStore.clone = clone;

module.exports = DailyProgressStore;
