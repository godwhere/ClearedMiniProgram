const STORAGE_KEY = 'cleared:minigame:progress:v2';
const LEGACY_KEY = 'cleared:progress:v1';
const cloudCatalog = require('../../data/catalog-v2.js');

function validCloudKey(key) {
  if (!/^(0|[1-9]\d*):(0|[1-9]\d*)$/.test(key)) return false;
  const parts = key.split(':').map(Number);
  const set = cloudCatalog.sets[parts[0]];
  return !!(set && set.Games && set.Games[parts[1]]);
}

function validBest(value) { return typeof value === 'number' && Number.isFinite(value) && value > 0; }

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// Stored data can come from an older build or a manually corrupted save. Do
// not let a prototype-related key in that data mutate the object receiving
// defaults while adding the new clear-effect setting.
const BLOCKED_KEYS = Object.create(null);
BLOCKED_KEYS.__proto__ = true;
BLOCKED_KEYS.constructor = true;
BLOCKED_KEYS.prototype = true;

function mergeRecord(defaults, value) {
  const result = Object.assign({}, defaults || {});
  if (!isRecord(value)) return result;
  Object.keys(value).forEach(key => {
    if (BLOCKED_KEYS[key]) return;
    result[key] = value[key];
  });
  return result;
}

function createDefaultState(clearEffectId) {
  const effectId = clearEffectId === 'fade' ? 'fade' : 'none';
  return {
    schemaVersion: 2,
    completed: {},
    bestMs: {},
    lastPlayed: null,
    settings: {
      skinId: 'classic',
      clearEffectId: effectId,
      soundEnabled: true
    },
    stats: {
      totalClears: 0
    }
  };
}

function normalizeTarget(target) {
  if (!isRecord(target)) return null;
  const setIndex = target.setIndex === undefined ? target.set : target.setIndex;
  const levelIndex = target.levelIndex === undefined ? target.level : target.levelIndex;
  if (!Number.isInteger(Number(setIndex)) || !Number.isInteger(Number(levelIndex))) return null;
  return { setIndex: Number(setIndex), levelIndex: Number(levelIndex) };
}

class ProgressStore {
  constructor(platform) {
    this.platform = platform;
    this.state = this.load();
  }

  load() {
    const saved = this.platform.getStorage(STORAGE_KEY);
    if (isRecord(saved)) return this.normalize(saved);

    const legacy = this.platform.getStorage(LEGACY_KEY);
    if (isRecord(legacy)) {
      // Existing installs keep the pre-selector fade behavior unless they
      // explicitly choose another effect after migration.
      const migrated = createDefaultState('fade');
      migrated.completed = mergeRecord({}, legacy.completed);
      migrated.lastPlayed = normalizeTarget(legacy.last);
      this.platform.setStorage(STORAGE_KEY, migrated);
      return migrated;
    }
    // A genuinely new install starts from the original no-effect experience.
    return createDefaultState('none');
  }

  normalize(saved) {
    // A v2 save without clearEffectId predates the selector. Preserve its
    // visible fade behavior rather than changing it silently on upgrade.
    const defaults = createDefaultState('fade');
    return {
      schemaVersion: 2,
      completed: mergeRecord({}, saved.completed),
      bestMs: mergeRecord({}, saved.bestMs),
      lastPlayed: normalizeTarget(saved.lastPlayed || saved.last),
      settings: mergeRecord(defaults.settings, saved.settings),
      stats: mergeRecord(defaults.stats, saved.stats)
    };
  }

  save() {
    return this.platform.setStorage(STORAGE_KEY, this.state);
  }

  exportCloudSnapshot() {
    const levels = {};
    const keys = new Set(Object.keys(this.state.completed).concat(Object.keys(this.state.bestMs)));
    keys.forEach(key => {
      if (!validCloudKey(key)) return;
      const completed = this.state.completed[key] === true;
      const bestMs = this.state.bestMs[key];
      if (completed || validBest(bestMs)) {
        levels[key] = { completed };
        if (validBest(bestMs)) levels[key].bestMs = bestMs;
      }
    });
    return { schemaVersion: 1, levels };
  }

  exportRewardCompletions() {
    if (!this.platform || typeof this.platform.readStorageResult !== 'function') {
      return { ok: false, reason: 'storage-read-failed' };
    }
    let read;
    try { read = this.platform.readStorageResult(STORAGE_KEY); } catch (error) {}
    if (!read || read.ok !== true) return { ok: false, reason: 'storage-read-failed' };
    if (read.found === false) return { ok: true, levelKeys: [] };
    if (read.found !== true) return { ok: false, reason: 'storage-read-failed' };
    let saved = read.value;
    if (typeof saved === 'string') {
      try { saved = JSON.parse(saved); } catch (error) { return { ok: false, reason: 'invalid-storage' }; }
    }
    if (!isRecord(saved) || saved.schemaVersion !== 2 || !isRecord(saved.completed) ||
        Object.keys(saved.completed).some(key => BLOCKED_KEYS[key] || typeof saved.completed[key] !== 'boolean')) {
      return { ok: false, reason: 'invalid-storage' };
    }
    return { ok: true, levelKeys: Object.keys(saved.completed)
      .filter(key => validCloudKey(key) && saved.completed[key] === true) };
  }

  mergeCloudSnapshot(snapshot) {
    if (!snapshot || snapshot.schemaVersion !== 1 || !isRecord(snapshot.levels)) return { ok: false, reason: 'invalid-snapshot' };
    const previous = this.state;
    const completed = mergeRecord({}, previous.completed);
    const bestMs = mergeRecord({}, previous.bestMs);
    Object.keys(snapshot.levels).forEach(key => {
      const value = snapshot.levels[key];
      if (!validCloudKey(key) || !isRecord(value)) return;
      if (value.completed === true) completed[key] = true;
      if (validBest(value.bestMs) && (!validBest(bestMs[key]) || value.bestMs < bestMs[key])) bestMs[key] = value.bestMs;
    });
    this.state = Object.assign({}, previous, { completed, bestMs });
    let saved = false;
    try { saved = this.save() === true; } catch (error) {}
    if (!saved) { this.state = previous; return { ok: false, reason: 'persist-failed' }; }
    return { ok: true };
  }

  applyAuthoritativeProgressSnapshot(snapshot, pendingOperations) {
    if (!snapshot || snapshot.schemaVersion !== 1 || !isRecord(snapshot.levels) ||
        (snapshot.lastPlayed !== null && snapshot.lastPlayed !== undefined &&
          (!normalizeTarget(snapshot.lastPlayed) || !validCloudKey(`${snapshot.lastPlayed.setIndex}:${snapshot.lastPlayed.levelIndex}`)))) {
      return { ok: false, reason: 'invalid-snapshot' };
    }
    const completed = {}; const bestMs = {};
    for (const key of Object.keys(snapshot.levels)) {
      const value = snapshot.levels[key];
      if (!validCloudKey(key) || !isRecord(value) || value.completed !== true ||
          (value.bestMs !== undefined && !validBest(value.bestMs))) {
        return { ok: false, reason: 'invalid-snapshot' };
      }
      completed[key] = true;
      if (value.bestMs !== undefined) bestMs[key] = value.bestMs;
    }
    let lastPlayed = snapshot.lastPlayed ? normalizeTarget(snapshot.lastPlayed) : null;
    const pending = Array.isArray(pendingOperations) ? pendingOperations : [];
    for (const operation of pending) {
      if (!operation || operation.domain !== 'progress' || !isRecord(operation.payload)) continue;
      if (operation.type === 'MAIN_LEVEL_COMPLETED') {
        const key = operation.payload.levelKey; const elapsed = operation.payload.elapsedMs;
        if (!validCloudKey(key) || !validBest(elapsed)) return { ok: false, reason: 'invalid-operation-overlay' };
        completed[key] = true;
        if (!validBest(bestMs[key]) || elapsed < bestMs[key]) bestMs[key] = elapsed;
      } else if (operation.type === 'PROGRESS_LAST_PLAYED') {
        const target = normalizeTarget(operation.payload);
        if (!target || !validCloudKey(`${target.setIndex}:${target.levelIndex}`)) return { ok: false, reason: 'invalid-operation-overlay' };
        lastPlayed = target;
      }
    }
    const previous = this.state;
    this.state = Object.assign({}, previous, { completed, bestMs, lastPlayed });
    let saved = false;
    try { saved = this.save() === true; } catch (error) {}
    if (!saved) { this.state = previous; return { ok: false, reason: 'persist-failed' }; }
    return { ok: true };
  }

  isBlankCloudCore() {
    return Object.keys(this.exportCloudSnapshot().levels).length === 0 && this.state.lastPlayed === null;
  }

  key(setIndex, levelIndex) {
    return `${setIndex}:${levelIndex}`;
  }

  markOpened(setIndex, levelIndex) {
    this.state.lastPlayed = { setIndex, levelIndex };
  }

  recordCompletion(setIndex, levelIndex, elapsedMs) {
    const key = this.key(setIndex, levelIndex);
    const previousBest = Number(this.state.bestMs[key]) || 0;
    const completedMs = Math.max(1, Math.round(Number(elapsedMs) || 1));
    const firstClear = !this.state.completed[key];
    const newBest = previousBest === 0 || completedMs < previousBest;

    this.state.completed[key] = true;
    if (newBest) this.state.bestMs[key] = completedMs;
    this.state.lastPlayed = { setIndex, levelIndex };
    this.state.stats.totalClears = (Number(this.state.stats.totalClears) || 0) + 1;
    this.save();

    return {
      firstClear,
      newBest,
      previousBest,
      bestMs: Number(this.state.bestMs[key]) || completedMs
    };
  }

  isCompleted(setIndex, levelIndex) {
    return !!this.state.completed[this.key(setIndex, levelIndex)];
  }

  bestTime(setIndex, levelIndex) {
    return Number(this.state.bestMs[this.key(setIndex, levelIndex)]) || 0;
  }

  completedCount() {
    return Object.keys(this.state.completed).reduce(
      (count, key) => count + (this.state.completed[key] ? 1 : 0),
      0
    );
  }

  getSetting(name, fallback) {
    const value = this.state.settings[name];
    return value === undefined ? fallback : value;
  }

  setSetting(name, value) {
    const previous = this.state;
    const next = Object.assign({}, previous, {
      settings: Object.assign({}, previous.settings, { [name]: value })
    });
    this.state = next;
    let saved = false;
    try { saved = this.save() === true; } catch (error) {}
    if (!saved) this.state = previous;
    return saved;
  }

  resumeTarget(sets) {
    const levels = [];
    sets.forEach((set, setIndex) => {
      (set.Games || []).forEach((game, levelIndex) => levels.push({ setIndex, levelIndex }));
    });

    const last = this.state.lastPlayed;
    const lastIndex = last
      ? levels.findIndex(item => item.setIndex === last.setIndex && item.levelIndex === last.levelIndex)
      : -1;
    if (lastIndex >= 0 && !this.isCompleted(last.setIndex, last.levelIndex)) return last;

    for (let offset = 1; offset <= levels.length; offset++) {
      const index = lastIndex >= 0 ? (lastIndex + offset) % levels.length : offset - 1;
      const candidate = levels[index];
      if (!this.isCompleted(candidate.setIndex, candidate.levelIndex)) return candidate;
    }

    return lastIndex >= 0 ? last : (levels[0] || { setIndex: 0, levelIndex: 0 });
  }
}

ProgressStore.STORAGE_KEY = STORAGE_KEY;

module.exports = ProgressStore;
