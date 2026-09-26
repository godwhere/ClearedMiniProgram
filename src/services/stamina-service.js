'use strict';

const defaults = require('../config/stamina.js');
const STORAGE_KEY = 'cleared:minigame:stamina:v1';
const MAX_TIMESTAMP = 8640000000000000;
const LOCAL_AUTHORITY_MODES = new Set(['legacy-local', 'local-backup', 'app-local']);

function nonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validTimestamp(value) {
  return nonnegativeInteger(value) && value <= MAX_TIMESTAMP;
}

function record(value) {
  return !!value && typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function validLevelKey(value) {
  return typeof value === 'string' && /^(0|[1-9]\d*):(0|[1-9]\d*)$/.test(value) &&
    value.split(':').every(part => nonnegativeInteger(Number(part)));
}

function normalizeUnlocks(value) {
  return Array.isArray(value) ? Array.from(new Set(value.filter(validLevelKey))).sort() : [];
}

function cloneState(value) {
  return value ? Object.assign({}, value, {
    unlockedLevels: normalizeUnlocks(value.unlockedLevels),
    refundedLevels: normalizeUnlocks(value.refundedLevels)
  }) : null;
}

class StaminaService {
  constructor(platform, options) {
    const opts = options || {};
    if (opts.authorityMode !== undefined && opts.authorityMode !== 'app-local') {
      throw new Error('invalid-authority-mode');
    }
    this.platform = platform;
    this.clock = typeof opts.clock === 'function' ? opts.clock : Date.now;
    this.config = Object.freeze(Object.keys(defaults).reduce((config, key) => {
      const value = opts[key];
      const valid = nonnegativeInteger(value) && (key === 'initialBalance' || value > 0) &&
        (key !== 'recoveryIntervalMs' || value <= MAX_TIMESTAMP);
      config[key] = valid ? value : defaults[key];
      return config;
    }, {}));
    this._state = null;
    this._pending = false;
    this._pendingRefunds = new Set();
    // app-local must be selected while constructing a fresh service. It is
    // intentionally locked in both directions after construction.
    this._authorityMode = opts.authorityMode === 'app-local' ? 'app-local' : 'legacy-local';
    this.appPersistence = opts.appPersistence || null;
    if (this.appPersistence) {
      if (this._authorityMode !== 'app-local') throw new Error('app-local-stamina-authority-required');
      const saved = this.appPersistence.current(STORAGE_KEY);
      if (saved !== null && !this.validateAuthoritativeSnapshot(saved)) throw new Error('app-local-invalid-stamina');
      this._state = saved === null ? this.emptyAppLocalState() : this.validateAuthoritativeSnapshot(saved);
    }
  }

  emptyAppLocalState() {
    return { schemaVersion: 1, balance: this.config.initialBalance,
      nextRecoveryAt: this.config.initialBalance >= this.config.naturalCap ? null :
        this.time() + this.config.recoveryIntervalMs,
      unlockedLevels: [], refundedLevels: [] };
  }

  settledAppLocalState(previous, now) {
    const next = cloneState(previous || this.emptyAppLocalState());
    const { naturalCap, recoveryIntervalMs } = this.config;
    if (next.balance >= naturalCap) next.nextRecoveryAt = null;
    else if (!validTimestamp(next.nextRecoveryAt)) next.nextRecoveryAt = now + recoveryIntervalMs;
    else if (now >= next.nextRecoveryAt) {
      const ticks = 1 + Math.floor((now - next.nextRecoveryAt) / recoveryIntervalMs);
      const recovered = Math.min(ticks, naturalCap - next.balance);
      next.balance += recovered;
      next.nextRecoveryAt = next.balance >= naturalCap
        ? null : next.nextRecoveryAt + recovered * recoveryIntervalMs;
    }
    return next;
  }

  async updateAsync(now, build) {
    if (!this.appPersistence) throw new Error('app-local-persistence-required');
    const timestamp = this.time(now);
    let saved;
    try {
      saved = await this.appPersistence.run(STORAGE_KEY, previous => {
        const base = this.settledAppLocalState(previous, timestamp);
        const change = build(base);
        if (!change || change.candidate === undefined) return null;
        const candidate = change.candidate === null ? base : change.candidate;
        return { candidate: JSON.stringify(candidate) === JSON.stringify(previous) ? null : candidate,
          result: change.result };
      });
    } catch (error) { saved = { ok: false, reason: 'persist-failed' }; }
    if (saved.ok) this._state = this.validateAuthoritativeSnapshot(saved.value);
    return saved;
  }

  async snapshotAsync(now) {
    const saved = await this.updateAsync(now, () => ({ candidate: null }));
    return saved.ok ? this.view(this.time(now)) : Object.assign({}, this.view(this.time(now)), { persisted: false });
  }

  async restoreUnlockedLevelsAsync(levelKeys, now) {
    const saved = await this.updateAsync(now, base => ({ candidate: Object.assign({}, base, {
      unlockedLevels: normalizeUnlocks(base.unlockedLevels.concat(normalizeUnlocks(levelKeys)))
    }) }));
    return saved.ok;
  }

  async unlockOrdinaryLevelAsync(levelKey, now) {
    const timestamp = this.time(now);
    const saved = await this.updateAsync(timestamp, base => {
      if (!validLevelKey(levelKey)) return { candidate: null, result: { ok: false, reason: 'invalid-level' } };
      const before = base.balance;
      if (base.unlockedLevels.includes(levelKey)) return { candidate: null, result: { ok: true, spent: 0, before, after: before } };
      if (before < this.config.ordinaryUnlockCost) return { candidate: null,
        result: { ok: false, reason: 'insufficient-stamina' } };
      const candidate = Object.assign({}, base, { balance: before - this.config.ordinaryUnlockCost,
        unlockedLevels: normalizeUnlocks(base.unlockedLevels.concat(levelKey)) });
      candidate.nextRecoveryAt = candidate.balance >= this.config.naturalCap ? null :
        before >= this.config.naturalCap ? timestamp + this.config.recoveryIntervalMs : base.nextRecoveryAt;
      return { candidate, result: { ok: true, spent: this.config.ordinaryUnlockCost,
        before, after: candidate.balance } };
    });
    return saved.ok ? Object.assign({}, saved.result, { snapshot: this.view(timestamp) }) :
      { ok: false, reason: saved.reason, snapshot: Object.assign({}, this.view(timestamp), { persisted: false }) };
  }

  async refundQuickClearAsync(levelKey, elapsedMs, now) {
    const timestamp = this.time(now);
    const saved = await this.updateAsync(timestamp, base => {
      if (!validLevelKey(levelKey) || !Number.isFinite(elapsedMs) || elapsedMs < 0) return {
        candidate: null, result: { ok: false, reason: 'invalid-completion', refunded: 0 } };
      if (elapsedMs > this.config.quickClearLimitMs || !base.unlockedLevels.includes(levelKey) ||
          base.refundedLevels.includes(levelKey)) return { candidate: null, result: { ok: true, refunded: 0 } };
      const balance = base.balance + this.config.quickClearRefundAmount;
      if (!nonnegativeInteger(balance)) return { candidate: null,
        result: { ok: false, reason: 'balance-overflow', refunded: 0 } };
      return { candidate: Object.assign({}, base, { balance,
        nextRecoveryAt: balance >= this.config.naturalCap ? null : base.nextRecoveryAt,
        refundedLevels: normalizeUnlocks(base.refundedLevels.concat(levelKey)) }),
      result: { ok: true, refunded: this.config.quickClearRefundAmount } };
    });
    return saved.ok ? Object.assign({}, saved.result, { snapshot: this.view(timestamp) }) :
      { ok: false, reason: saved.reason, refunded: 0, snapshot: this.view(timestamp) };
  }

  async flushAsync(now) { return (await this.snapshotAsync(now)).persisted === true; }

  authorityMode() { return this._authorityMode; }
  setAuthorityMode(mode) {
    if (!['legacy-local', 'migration-freeze', 'cloud-authoritative', 'local-backup', 'app-local'].includes(mode)) {
      return false;
    }
    if (mode === this._authorityMode) return true;
    if (mode === 'app-local' || this._authorityMode === 'app-local' ||
        (this._authorityMode !== 'legacy-local' && mode === 'legacy-local')) return false;
    this._authorityMode = mode;
    return true;
  }

  appLocalCheckpoint() {
    return this._authorityMode === 'app-local' ? {
      state: cloneState(this._state),
      pending: this._pending,
      pendingRefunds: new Set(this._pendingRefunds)
    } : null;
  }

  restoreAppLocalCheckpoint(checkpoint) {
    if (!checkpoint) return;
    this._state = checkpoint.state;
    this._pending = checkpoint.pending;
    this._pendingRefunds = checkpoint.pendingRefunds;
  }

  validateAuthoritativeSnapshot(value) {
    if (!record(value) || value.schemaVersion !== 1 ||
        Object.keys(value).some(key => !['schemaVersion', 'balance', 'nextRecoveryAt', 'unlockedLevels', 'refundedLevels'].includes(key)) ||
        !nonnegativeInteger(value.balance) ||
        (value.balance >= this.config.naturalCap ? value.nextRecoveryAt !== null : !validTimestamp(value.nextRecoveryAt)) ||
        !Array.isArray(value.unlockedLevels) || !value.unlockedLevels.every(validLevelKey) ||
        new Set(value.unlockedLevels).size !== value.unlockedLevels.length ||
        !Array.isArray(value.refundedLevels) || !value.refundedLevels.every(key => validLevelKey(key) && value.unlockedLevels.includes(key)) ||
        new Set(value.refundedLevels).size !== value.refundedLevels.length) return null;
    return { schemaVersion: 1, balance: value.balance, nextRecoveryAt: value.nextRecoveryAt,
      unlockedLevels: value.unlockedLevels.slice().sort(), refundedLevels: value.refundedLevels.slice().sort() };
  }

  exportAuthoritativeSnapshot() {
    // Do not settle time or write while building a deterministic migration.
    let value = this._state;
    if (!value) {
      try { value = this.platform.getStorage(STORAGE_KEY); } catch (error) { return { ok: false, reason: 'storage-read-failed' }; }
      if (value == null) value = { schemaVersion: 1, balance: this.config.initialBalance,
        nextRecoveryAt: null, unlockedLevels: [], refundedLevels: [] };
    }
    const snapshot = this.validateAuthoritativeSnapshot(value);
    return snapshot ? { ok: true, snapshot } : { ok: false, reason: 'invalid-snapshot' };
  }

  exportBackupSnapshot() {
    if (!this.platform || typeof this.platform.readStorageResult !== 'function') {
      return { ok: false, reason: 'storage-read-failed' };
    }
    let read;
    try { read = this.platform.readStorageResult(STORAGE_KEY); } catch (error) {}
    if (!read || read.ok !== true || (read.found !== true && read.found !== false)) {
      return { ok: false, reason: 'storage-read-failed' };
    }
    let value = read.found ? read.value : { schemaVersion: 1, balance: this.config.initialBalance,
      nextRecoveryAt: null, unlockedLevels: [], refundedLevels: [] };
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch (error) { return { ok: false, reason: 'invalid-storage' }; }
    }
    if (record(value) && value.schemaVersion === 1 && value.refundedLevels === undefined) {
      value = Object.assign({}, value, { refundedLevels: [] });
    }
    const snapshot = this.validateAuthoritativeSnapshot(value);
    return snapshot ? { ok: true, snapshot } : { ok: false, reason: 'invalid-storage' };
  }

  applyAuthoritativeSnapshot(value, pendingOperations) {
    if (this._authorityMode !== 'cloud-authoritative') return { ok: false, reason: 'authority-mismatch' };
    let candidate = this.validateAuthoritativeSnapshot(value);
    if (!candidate) return { ok: false, reason: 'invalid-snapshot' };
    for (const operation of Array.isArray(pendingOperations) ? pendingOperations : []) {
      if (!operation || operation.domain !== 'stamina' || !record(operation.payload)) continue;
      if (operation.type === 'STAMINA_LEVEL_UNLOCKED') {
        const levelKey = operation.payload.levelKey;
        if (!validLevelKey(levelKey)) return { ok: false, reason: 'invalid-operation-overlay' };
        if (candidate.unlockedLevels.includes(levelKey) || candidate.balance < this.config.ordinaryUnlockCost) continue;
        const before = candidate.balance;
        candidate = Object.assign({}, candidate, { balance: before - this.config.ordinaryUnlockCost,
          unlockedLevels: candidate.unlockedLevels.concat(levelKey).sort() });
        if (candidate.balance >= this.config.naturalCap) candidate.nextRecoveryAt = null;
        else if (before >= this.config.naturalCap) {
          candidate.nextRecoveryAt = this.time(operation.occurredAtClient) + this.config.recoveryIntervalMs;
        }
      } else if (operation.type === 'STAMINA_QUICK_CLEAR_REFUNDED') {
        const levelKey = operation.payload.levelKey; const elapsedMs = operation.payload.elapsedMs;
        if (!validLevelKey(levelKey) || !Number.isSafeInteger(elapsedMs) || elapsedMs <= 0) {
          return { ok: false, reason: 'invalid-operation-overlay' };
        }
        if (elapsedMs > this.config.quickClearLimitMs || !candidate.unlockedLevels.includes(levelKey) ||
            candidate.refundedLevels.includes(levelKey)) continue;
        candidate = Object.assign({}, candidate, { balance: candidate.balance + this.config.quickClearRefundAmount,
          refundedLevels: candidate.refundedLevels.concat(levelKey).sort() });
        if (candidate.balance >= this.config.naturalCap) candidate.nextRecoveryAt = null;
      }
    }
    if (!this.persist(candidate)) return { ok: false, reason: 'persist-failed' };
    this._state = candidate; this._pending = false; this._pendingRefunds.clear();
    return { ok: true };
  }

  applyBackupSnapshot(value) {
    if (this._authorityMode !== 'local-backup') return { ok: false, reason: 'authority-mismatch' };
    const candidate = this.validateAuthoritativeSnapshot(value);
    if (!candidate) return { ok: false, reason: 'invalid-snapshot' };
    if (!this.persist(candidate)) return { ok: false, reason: 'persist-failed' };
    this._state = candidate; this._pending = false; this._pendingRefunds.clear();
    return { ok: true };
  }

  applyPendingUnlock(levelKey, now) {
    const timestamp = this.time(now);
    this.settle(timestamp);
    const before = this._state.balance;
    if (this._authorityMode !== 'cloud-authoritative') return { ok: false, reason: 'authority-mismatch', snapshot: this.view(timestamp) };
    if (!validLevelKey(levelKey)) return { ok: false, reason: 'invalid-level', snapshot: this.view(timestamp) };
    if (this._state.unlockedLevels.includes(levelKey)) {
      return { ok: true, spent: 0, before, after: before, snapshot: this.view(timestamp) };
    }
    if (before < this.config.ordinaryUnlockCost) {
      return { ok: false, reason: 'insufficient-stamina', snapshot: this.view(timestamp) };
    }
    const candidate = Object.assign({}, this._state, { balance: before - this.config.ordinaryUnlockCost,
      unlockedLevels: this._state.unlockedLevels.concat(levelKey).sort() });
    if (candidate.balance >= this.config.naturalCap) candidate.nextRecoveryAt = null;
    else if (before >= this.config.naturalCap) candidate.nextRecoveryAt = timestamp + this.config.recoveryIntervalMs;
    if (!this.persist(candidate)) return { ok: false, reason: 'persist-failed', snapshot: this.view(timestamp) };
    this._state = candidate; this._pending = false;
    return { ok: true, spent: this.config.ordinaryUnlockCost, before, after: candidate.balance,
      snapshot: this.view(timestamp) };
  }

  applyPendingRefund(levelKey, elapsedMs, now) {
    const timestamp = this.time(now);
    this.settle(timestamp);
    if (this._authorityMode !== 'cloud-authoritative') return { ok: false, reason: 'authority-mismatch', refunded: 0,
      snapshot: this.view(timestamp) };
    if (!validLevelKey(levelKey) || !Number.isSafeInteger(elapsedMs) || elapsedMs <= 0) {
      return { ok: false, reason: 'invalid-completion', refunded: 0, snapshot: this.view(timestamp) };
    }
    if (elapsedMs > this.config.quickClearLimitMs || !this._state.unlockedLevels.includes(levelKey) ||
        this._state.refundedLevels.includes(levelKey)) return { ok: true, refunded: 0, snapshot: this.view(timestamp) };
    const candidate = Object.assign({}, this._state, { balance: this._state.balance + this.config.quickClearRefundAmount,
      refundedLevels: this._state.refundedLevels.concat(levelKey).sort() });
    if (candidate.balance >= this.config.naturalCap) candidate.nextRecoveryAt = null;
    if (!this.persist(candidate)) return { ok: false, reason: 'refund-persist-failed', refunded: 0,
      snapshot: this.view(timestamp) };
    this._state = candidate; this._pending = false;
    return { ok: true, refunded: this.config.quickClearRefundAmount, snapshot: this.view(timestamp) };
  }

  time(now) {
    let value = now instanceof Date ? now.getTime() : now;
    if (!validTimestamp(value)) {
      try { value = Number(this.clock()); } catch (error) { value = NaN; }
    }
    if (!validTimestamp(value)) value = Date.now();
    // Leave room for a complete recovery interval even at the Date boundary.
    return Math.min(value, MAX_TIMESTAMP - this.config.recoveryIntervalMs);
  }

  settle(now) {
    if (!LOCAL_AUTHORITY_MODES.has(this._authorityMode)) {
      if (!this._state) {
        const exported = this.exportAuthoritativeSnapshot();
        if (exported.ok) this._state = exported.snapshot;
        else this._state = { schemaVersion: 1, balance: 0, nextRecoveryAt: null, unlockedLevels: [], refundedLevels: [] };
      }
      return false;
    }
    let previous = this._state;
    if (!previous) {
      try { previous = this.platform.getStorage(STORAGE_KEY); } catch (error) {}
    }
    const valid = record(previous) && previous.schemaVersion === 1 && nonnegativeInteger(previous.balance);
    const next = {
      schemaVersion: 1,
      balance: valid ? previous.balance : this.config.initialBalance,
      nextRecoveryAt: valid ? previous.nextRecoveryAt : null,
      unlockedLevels: record(previous) && previous.schemaVersion === 1
        ? normalizeUnlocks(previous.unlockedLevels) : []
    };
    next.refundedLevels = record(previous) && previous.schemaVersion === 1
      ? normalizeUnlocks(previous.refundedLevels).filter(key => next.unlockedLevels.includes(key)) : [];
    const { naturalCap, recoveryIntervalMs } = this.config;
    if (next.balance >= naturalCap) {
      next.nextRecoveryAt = null;
    } else if (!validTimestamp(next.nextRecoveryAt)) {
      next.nextRecoveryAt = now + recoveryIntervalMs;
    } else if (now >= next.nextRecoveryAt) {
      const ticks = 1 + Math.floor((now - next.nextRecoveryAt) / recoveryIntervalMs);
      const recovered = Math.min(ticks, naturalCap - next.balance);
      next.balance += recovered;
      next.nextRecoveryAt = next.balance >= naturalCap
        ? null : next.nextRecoveryAt + recovered * recoveryIntervalMs;
    }
    const changed = !valid || previous.balance !== next.balance ||
      previous.nextRecoveryAt !== next.nextRecoveryAt || !Array.isArray(previous.unlockedLevels) ||
      previous.unlockedLevels.length !== next.unlockedLevels.length ||
      previous.unlockedLevels.some((key, index) => key !== next.unlockedLevels[index]) ||
      !Array.isArray(previous.refundedLevels) || previous.refundedLevels.length !== next.refundedLevels.length ||
      previous.refundedLevels.some((key, index) => key !== next.refundedLevels[index]);
    this._state = next;
    if (changed) this._pending = true;
    return changed;
  }

  persist(candidate) {
    if (this.appPersistence) throw new Error('app-local-sync-stamina-write');
    try {
      return this.platform.setStorage(STORAGE_KEY,
        Object.assign({}, candidate, { unlockedLevels: candidate.unlockedLevels.slice(),
          refundedLevels: candidate.refundedLevels.slice() })) === true;
    } catch (error) {
      return false;
    }
  }

  view(now) {
    const { balance, nextRecoveryAt } = this._state;
    const { naturalCap, ordinaryUnlockCost } = this.config;
    return {
      enabled: true,
      balance,
      naturalCap,
      ordinaryUnlockCost,
      recovering: balance < naturalCap,
      nextRecoveryAt,
      remainingMs: nextRecoveryAt === null ? 0 : Math.max(0, nextRecoveryAt - now),
      overflow: Math.max(0, balance - naturalCap),
      canUnlockOrdinaryLevel: balance >= ordinaryUnlockCost,
      persisted: !this._pending
    };
  }

  // Navigation query only: never settles time, saves, or spends stamina.
  isPermanentlyUnlocked(levelKey) {
    if (!validLevelKey(levelKey)) return false;
    if (this._state) return this._state.unlockedLevels.includes(levelKey);
    const saved = this.exportAuthoritativeSnapshot();
    return saved.ok && saved.snapshot.unlockedLevels.includes(levelKey);
  }

  snapshot(now) {
    const timestamp = this.time(now);
    if (this.appPersistence) return this.view(timestamp);
    const checkpoint = this.appLocalCheckpoint();
    if (this.settle(timestamp)) {
      if (this.persist(this._state)) this._pending = false;
      else {
        this._pending = true;
        if (checkpoint) {
          const failed = Object.assign({}, this.view(timestamp), { persisted: false });
          this.restoreAppLocalCheckpoint(checkpoint);
          return failed;
        }
      }
    }
    return this.view(timestamp);
  }

  restoreUnlockedLevels(levelKeys, now) {
    if (!LOCAL_AUTHORITY_MODES.has(this._authorityMode)) return false;
    const checkpoint = this.appLocalCheckpoint();
    const changed = this.settle(this.time(now));
    const unlockedLevels = normalizeUnlocks(this._state.unlockedLevels.concat(normalizeUnlocks(levelKeys)));
    const added = unlockedLevels.length !== this._state.unlockedLevels.length;
    const candidate = added ? Object.assign({}, this._state, { unlockedLevels }) : this._state;
    if (checkpoint) {
      const needsPersist = this._pending || changed || added;
      if (needsPersist && !this.persist(candidate)) {
        this.restoreAppLocalCheckpoint(checkpoint);
        return false;
      }
      this._state = candidate;
      this._pending = false;
      return true;
    }
    if (added) this._state = candidate;
    // Existing completion/last-played records prove prior access, without a debit.
    if (changed || added) this._pending = !this.persist(this._state);
    return !this._pending;
  }

  unlockOrdinaryLevel(levelKey, now) {
    const timestamp = this.time(now);
    const checkpoint = this.appLocalCheckpoint();
    const changed = this.settle(timestamp);
    const before = this._state.balance;
    if (!validLevelKey(levelKey)) {
      if (changed) {
        this._pending = !this.persist(this._state);
        if (this._pending && checkpoint) {
          const failed = Object.assign({}, this.view(timestamp), { persisted: false });
          this.restoreAppLocalCheckpoint(checkpoint);
          return { ok: false, reason: 'invalid-level', snapshot: failed };
        }
      }
      return { ok: false, reason: 'invalid-level', snapshot: this.view(timestamp) };
    }
    if (this._state.unlockedLevels.includes(levelKey)) {
      if (changed) {
        this._pending = !this.persist(this._state);
        if (this._pending && checkpoint) {
          const failed = Object.assign({}, this.view(timestamp), { persisted: false });
          this.restoreAppLocalCheckpoint(checkpoint);
          return { ok: false, reason: 'persist-failed', spent: 0, before, after: before, snapshot: failed };
        }
      }
      return { ok: true, spent: 0, before, after: before, snapshot: this.view(timestamp) };
    }
    if (!LOCAL_AUTHORITY_MODES.has(this._authorityMode)) return { ok: false, reason: this._authorityMode, snapshot: this.view(timestamp) };
    const { ordinaryUnlockCost, naturalCap, recoveryIntervalMs } = this.config;
    if (before < ordinaryUnlockCost) {
      if (changed) {
        this._pending = !this.persist(this._state);
        if (this._pending && checkpoint) {
          const failed = Object.assign({}, this.view(timestamp), { persisted: false });
          this.restoreAppLocalCheckpoint(checkpoint);
          return { ok: false, reason: 'persist-failed', snapshot: failed };
        }
      }
      return { ok: false, reason: 'insufficient-stamina', snapshot: this.view(timestamp) };
    }
    const candidate = Object.assign({}, this._state, {
      balance: before - ordinaryUnlockCost,
      unlockedLevels: this._state.unlockedLevels.concat(levelKey).sort()
    });
    if (candidate.balance >= naturalCap) candidate.nextRecoveryAt = null;
    else if (before >= naturalCap) candidate.nextRecoveryAt = timestamp + recoveryIntervalMs;
    // The debit and permanent access must commit in the same storage write.
    if (!this.persist(candidate)) {
      const failed = Object.assign({}, this.view(timestamp), { persisted: false });
      this.restoreAppLocalCheckpoint(checkpoint);
      return { ok: false, reason: 'persist-failed', snapshot: failed };
    }
    this._state = candidate;
    this._pending = false;
    return { ok: true, spent: ordinaryUnlockCost, before, after: candidate.balance, snapshot: this.view(timestamp) };
  }

  flush(now) {
    if (!LOCAL_AUTHORITY_MODES.has(this._authorityMode)) return true;
    const checkpoint = this.appLocalCheckpoint();
    this.settle(this.time(now));
    const refundKeys = this._state.unlockedLevels.filter(key =>
      this._pendingRefunds.has(key) && !this._state.refundedLevels.includes(key));
    const balance = this._state.balance + refundKeys.length * this.config.quickClearRefundAmount;
    if (!nonnegativeInteger(balance)) {
      this.restoreAppLocalCheckpoint(checkpoint);
      return false;
    }
    if (!this._pending && !refundKeys.length) return true;
    const candidate = Object.assign({}, this._state, {
      balance,
      nextRecoveryAt: balance >= this.config.naturalCap ? null : this._state.nextRecoveryAt,
      refundedLevels: normalizeUnlocks(this._state.refundedLevels.concat(refundKeys))
    });
    if (!this.persist(candidate)) {
      this.restoreAppLocalCheckpoint(checkpoint);
      return false;
    }
    this._state = candidate;
    this._pending = false;
    this._pendingRefunds.clear();
    return true;
  }

  refundQuickClear(levelKey, elapsedMs, now) {
    const timestamp = this.time(now);
    const snapshot = this.snapshot(timestamp);
    if (this._authorityMode === 'app-local' && snapshot.persisted === false) {
      return { ok: false, reason: 'persist-failed', refunded: 0, snapshot };
    }
    if (!LOCAL_AUTHORITY_MODES.has(this._authorityMode)) return { ok: true, reason: this._authorityMode, refunded: 0, snapshot };
    if (!validLevelKey(levelKey) || !Number.isFinite(elapsedMs) || elapsedMs < 0) {
      return { ok: false, reason: 'invalid-completion', refunded: 0, snapshot };
    }
    if (elapsedMs > this.config.quickClearLimitMs || !this._state.unlockedLevels.includes(levelKey) ||
        this._state.refundedLevels.includes(levelKey)) {
      return { ok: true, refunded: 0, snapshot };
    }
    // Each level can earn this once, on its first qualifying clear, regardless
    // of how many slower clears or attempts came before.
    // Keep failed refunds queued without changing the visible balance.
    const pendingBefore = new Set(this._pendingRefunds);
    this._pendingRefunds.add(levelKey);
    const before = this._state.balance;
    const persisted = this.flush(timestamp);
    if (!persisted && this._authorityMode === 'app-local') this._pendingRefunds = pendingBefore;
    return { ok: persisted, reason: persisted ? null : 'refund-persist-failed',
      refunded: persisted ? this._state.balance - before : 0, snapshot: this.view(timestamp) };
  }

  quickClearRefundState(levelKey) {
    if (!this._state) {
      const snapshot = this.snapshot();
      if (!this._state) return { amount: this.config.quickClearRefundAmount,
        status: 'unavailable', persisted: snapshot.persisted };
    }
    return { amount: this.config.quickClearRefundAmount,
      status: this._pendingRefunds.has(levelKey) ? 'pending'
        : this._state.refundedLevels.includes(levelKey) ? 'claimed'
          : this._state.unlockedLevels.includes(levelKey) ? 'available' : 'unavailable' };
  }
}

StaminaService.STORAGE_KEY = STORAGE_KEY;
module.exports = StaminaService;
