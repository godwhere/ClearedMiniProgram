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
    let previous = this._state;
    if (!previous) {
      try { previous = this.platform.getStorage(STORAGE_KEY); } catch (error) {}
    }
    const valid = record(previous) && previous.schemaVersion === 1 && nonnegativeInteger(previous.balance);
    const next = {
      schemaVersion: 1,
      balance: valid ? previous.balance : this.config.initialBalance,
      nextRecoveryAt: valid ? previous.nextRecoveryAt : null
    };
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
      previous.nextRecoveryAt !== next.nextRecoveryAt;
    this._state = next;
    if (changed) this._pending = true;
    return changed;
  }

  persist(candidate) {
    try {
      return this.platform.setStorage(STORAGE_KEY, Object.assign({}, candidate)) === true;
    } catch (error) {
      return false;
    }
  }

  view(now) {
    const { balance, nextRecoveryAt } = this._state;
    const { naturalCap, ordinaryAttemptCost } = this.config;
    return {
      enabled: true,
      balance,
      naturalCap,
      ordinaryAttemptCost,
      recovering: balance < naturalCap,
      nextRecoveryAt,
      remainingMs: nextRecoveryAt === null ? 0 : Math.max(0, nextRecoveryAt - now),
      overflow: Math.max(0, balance - naturalCap),
      canStartOrdinaryAttempt: balance >= ordinaryAttemptCost,
      persisted: !this._pending
    };
  }

  snapshot(now) {
    const timestamp = this.time(now);
    if (this.settle(timestamp)) this._pending = !this.persist(this._state);
    return this.view(timestamp);
  }

  consumeOrdinaryAttempt(now) {
    const timestamp = this.time(now);
    const changed = this.settle(timestamp);
    const before = this._state.balance;
    const { ordinaryAttemptCost, naturalCap, recoveryIntervalMs } = this.config;
    if (before < ordinaryAttemptCost) {
      if (changed) this._pending = !this.persist(this._state);
      return { ok: false, reason: 'insufficient-stamina', snapshot: this.view(timestamp) };
    }
    const candidate = Object.assign({}, this._state, { balance: before - ordinaryAttemptCost });
    if (candidate.balance >= naturalCap) candidate.nextRecoveryAt = null;
    else if (before >= naturalCap) candidate.nextRecoveryAt = timestamp + recoveryIntervalMs;
    // A failed write never commits the debit or its new recovery anchor.
    if (!this.persist(candidate)) {
      return { ok: false, reason: 'persist-failed', snapshot: this.view(timestamp) };
    }
    this._state = candidate;
    this._pending = false;
    return { ok: true, spent: ordinaryAttemptCost, before, after: candidate.balance, snapshot: this.view(timestamp) };
  }

  flush(now) {
    this.settle(this.time(now));
    if (this._pending) this._pending = !this.persist(this._state);
    return !this._pending;
  }
}

module.exports = StaminaService;
