'use strict';

const ProgressStore = require('../services/progress-store.js');
const RewardUnlockService = require('../services/reward-unlock-service.js');
const StaminaService = require('../services/stamina-service.js');
const LocaleService = require('../services/locale-service.js');

const NAMESPACE = 'com.godwhere.cleared/ordinary/prod/v1';
const SCHEMA_VERSION = 1;
const KEYS = Object.freeze([
  ProgressStore.STORAGE_KEY,
  RewardUnlockService.STORAGE_KEY,
  StaminaService.STORAGE_KEY,
  LocaleService.STORAGE_KEY
]);

function copy(value) { return JSON.parse(JSON.stringify(value)); }
function task(value) { return value && typeof value.then === 'function'; }

// The native port owns the SQLite transaction: the operation row and every
// record replacement commit together. No browser or WeChat storage is used.
class AppLocalPersistence {
  constructor(port) {
    if (!port || typeof port.open !== 'function' || typeof port.commit !== 'function' ||
        typeof port.lookupOperation !== 'function') throw new Error('app-local-async-port-required');
    this.port = port;
    this.records = new Map();
    this.queue = Promise.resolve();
    this.pending = null;
    this.completed = new Map();
    this.sequence = 0;
    this.session = `${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
    this.ready = false;
  }

  async open() {
    if (this.ready) throw new Error('app-local-already-open');
    const call = this.port.open({ namespace: NAMESPACE, schemaVersion: SCHEMA_VERSION, keys: KEYS.slice() });
    if (!task(call)) throw new Error('app-local-open-must-be-async');
    const opened = await call;
    if (!opened || opened.ok !== true || opened.namespace !== NAMESPACE ||
        opened.schemaVersion !== SCHEMA_VERSION ||
        !opened.records || typeof opened.records !== 'object') throw new Error('app-local-open-failed');
    for (const key of KEYS) {
      const row = opened.records[key];
      if (!row || (row.found !== true && row.found !== false) ||
          (row.found === true && (row.value === undefined || row.value === null))) {
        throw new Error(`app-local-read-failed:${key}`);
      }
      let value = row.found ? row.value : null;
      if (typeof value === 'string') {
        try { value = JSON.parse(value); } catch (error) { throw new Error(`app-local-invalid-json:${key}`); }
      }
      this.records.set(key, value === null ? null : copy(value));
    }
    this.ready = true;
    return this;
  }

  current(key) {
    if (!this.ready || !KEYS.includes(key)) throw new Error('app-local-record-unavailable');
    const value = this.records.get(key);
    return value === null ? null : copy(value);
  }

  operationId(kind) {
    this.sequence += 1;
    return `${this.session}:${this.sequence}:${kind}`;
  }

  async confirm(input) {
    let result;
    try {
      const commit = this.port.commit(input);
      if (task(commit)) result = await commit;
    } catch (error) {}
    if (result && result.ok === true && result.committed === true) return true;
    if (result && result.ok === false && result.definite === true) return false;
    // An interrupted callback is ambiguous. The port must compare the full
    // request before confirming an operation ID; an ID alone is insufficient.
    for (let attempt = 0; attempt < 2; attempt++) {
      let found;
      try {
        const lookup = this.port.lookupOperation(input);
        if (!task(lookup)) throw new Error('app-local-lookup-must-be-async');
        found = await lookup;
      } catch (error) {}
      if (found && found.ok === true && found.committed === true) {
        if (found.matches === true) return true;
        if (found.matches === false) return false;
      }
      if (found && found.ok === true && found.found === false && attempt === 0) {
        try {
          const retry = this.port.commit(input);
          if (!task(retry)) throw new Error('app-local-commit-must-be-async');
          result = await retry;
          if (result && result.ok === true && result.committed === true) return true;
          if (result && result.ok === false && result.definite === true) return false;
        } catch (error) {}
      }
    }
    return null;
  }

  async settlePending() {
    if (!this.pending) return 'none';
    const status = await this.confirm(this.pending.input);
    if (status === null) return 'unknown';
    if (status === true) {
      this.records.set(this.pending.key, copy(this.pending.value));
      if (this.pending.explicit) this.completed.set(this.pending.input.operationId, {
        key: this.pending.key, intent: this.pending.intent, result: this.pending.result
      });
    }
    this.pending = null;
    return status ? 'committed' : 'rejected';
  }

  run(key, build, operationId, operationIntent) {
    const execute = async () => {
      if (!this.ready || !KEYS.includes(key)) return { ok: false, reason: 'record-unavailable' };
      if (operationId && (typeof operationIntent !== 'string' || !operationIntent)) {
        return { ok: false, reason: 'operation-intent-required' };
      }
      if (operationId && this.completed.has(operationId)) {
        const completed = this.completed.get(operationId);
        return completed.key === key && completed.intent === operationIntent
          ? { ok: true, result: completed.result, value: this.current(key) }
          : { ok: false, reason: 'operation-id-conflict' };
      }
      if (this.pending && operationId && this.pending.input.operationId === operationId) {
        const previous = this.pending;
        if (previous.key !== key || previous.intent !== operationIntent) {
          return { ok: false, reason: 'operation-id-conflict' };
        }
        const pendingStatus = await this.settlePending();
        if (pendingStatus === 'unknown') return { ok: false, reason: 'commit-unconfirmed' };
        if (pendingStatus === 'committed') {
          return { ok: true, result: previous.result, value: this.current(key) };
        }
      }
      if (await this.settlePending() === 'unknown') return { ok: false, reason: 'commit-unconfirmed' };
      const previous = this.current(key);
      const change = build(previous);
      if (!change || change.candidate === undefined) return { ok: false, reason: 'invalid-candidate' };
      if (change.candidate === null) return { ok: true, result: change.result, value: previous };
      const candidate = copy(change.candidate);
      const input = { namespace: NAMESPACE, schemaVersion: SCHEMA_VERSION,
        operationId: operationId || this.operationId(key), writes: [{ key, value: candidate }] };
      const status = await this.confirm(input);
      if (status === null) {
        this.pending = { input, key, value: candidate, result: change.result,
          explicit: !!operationId, intent: operationIntent };
        return { ok: false, reason: 'commit-unconfirmed' };
      }
      if (status === false) return { ok: false, reason: 'persist-failed' };
      this.records.set(key, candidate);
      if (operationId) this.completed.set(operationId, {
        key, intent: operationIntent, result: change.result
      });
      return { ok: true, result: change.result, value: copy(candidate) };
    };
    const result = this.queue.then(execute, execute);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
}

AppLocalPersistence.NAMESPACE = NAMESPACE;
AppLocalPersistence.SCHEMA_VERSION = SCHEMA_VERSION;
AppLocalPersistence.KEYS = KEYS;
module.exports = AppLocalPersistence;
