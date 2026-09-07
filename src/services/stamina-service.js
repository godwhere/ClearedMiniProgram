'use strict';

const defaults = require('../config/stamina.js');
const STORAGE_KEY = 'cleared:minigame:stamina:v1';
const MAX_TIMESTAMP = 8640000000000000;

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

class StaminaService {
  constructor(platform, options) {
    const opts = options || {};
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
    this._authorityMode = 'legacy-local';
  }

  authorityMode() { return this._authorityMode; }
  setAuthorityMode(mode) {
    if (!['legacy-local', 'migration-freeze', 'cloud-authoritative'].includes(mode) ||
        (this._authorityMode !== 'legacy-local' && mode === 'legacy-local')) return false;
    this._authorityMode = mode;
    return true;
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
    if (this._authorityMode !== 'legacy-local') {
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
    if (this.settle(timestamp)) this._pending = !this.persist(this._state);
    return this.view(timestamp);
  }

  restoreUnlockedLevels(levelKeys, now) {
    if (this._authorityMode !== 'legacy-local') return false;
    const changed = this.settle(this.time(now));
    const unlockedLevels = normalizeUnlocks(this._state.unlockedLevels.concat(normalizeUnlocks(levelKeys)));
    const added = unlockedLevels.length !== this._state.unlockedLevels.length;
    if (added) this._state = Object.assign({}, this._state, { unlockedLevels });
    // Existing completion/last-played records prove prior access, without a debit.
    if (changed || added) this._pending = !this.persist(this._state);
    return !this._pending;
  }

  unlockOrdinaryLevel(levelKey, now) {
    const timestamp = this.time(now);
    const changed = this.settle(timestamp);
    const before = this._state.balance;
    if (!validLevelKey(levelKey)) {
      if (changed) this._pending = !this.persist(this._state);
      return { ok: false, reason: 'invalid-level', snapshot: this.view(timestamp) };
    }
    if (this._state.unlockedLevels.includes(levelKey)) {
      if (changed) this._pending = !this.persist(this._state);
      return { ok: true, spent: 0, before, after: before, snapshot: this.view(timestamp) };
    }
    if (this._authorityMode !== 'legacy-local') return { ok: false, reason: this._authorityMode, snapshot: this.view(timestamp) };
    const { ordinaryUnlockCost, naturalCap, recoveryIntervalMs } = this.config;
    if (before < ordinaryUnlockCost) {
      if (changed) this._pending = !this.persist(this._state);
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
      return { ok: false, reason: 'persist-failed', snapshot: this.view(timestamp) };
    }
    this._state = candidate;
    this._pending = false;
    return { ok: true, spent: ordinaryUnlockCost, before, after: candidate.balance, snapshot: this.view(timestamp) };
  }

  flush(now) {
    if (this._authorityMode !== 'legacy-local') return true;
    this.settle(this.time(now));
    const refundKeys = this._state.unlockedLevels.filter(key =>
      this._pendingRefunds.has(key) && !this._state.refundedLevels.includes(key));
    const balance = this._state.balance + refundKeys.length * this.config.quickClearRefundAmount;
    if (!nonnegativeInteger(balance)) return false;
    if (!this._pending && !refundKeys.length) return true;
    const candidate = Object.assign({}, this._state, {
      balance,
      nextRecoveryAt: balance >= this.config.naturalCap ? null : this._state.nextRecoveryAt,
      refundedLevels: normalizeUnlocks(this._state.refundedLevels.concat(refundKeys))
    });
    if (!this.persist(candidate)) return false;
    this._state = candidate;
    this._pending = false;
    this._pendingRefunds.clear();
    return true;
  }

  refundQuickClear(levelKey, elapsedMs, now) {
    const timestamp = this.time(now);
    const snapshot = this.snapshot(timestamp);
    if (this._authorityMode !== 'legacy-local') return { ok: true, reason: this._authorityMode, refunded: 0, snapshot };
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
    this._pendingRefunds.add(levelKey);
    const before = this._state.balance;
    const persisted = this.flush(timestamp);
    return { ok: persisted, reason: persisted ? null : 'refund-persist-failed',
      refunded: persisted ? this._state.balance - before : 0, snapshot: this.view(timestamp) };
  }

  quickClearRefundState(levelKey) {
    if (!this._state) this.snapshot();
    return { amount: this.config.quickClearRefundAmount,
      status: this._pendingRefunds.has(levelKey) ? 'pending'
        : this._state.refundedLevels.includes(levelKey) ? 'claimed'
          : this._state.unlockedLevels.includes(levelKey) ? 'available' : 'unavailable' };
  }
}

module.exports = StaminaService;
