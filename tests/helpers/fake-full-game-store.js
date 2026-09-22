'use strict';

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function immutable(value) {
  if (!value || typeof value !== 'object') return value;
  Object.keys(value).forEach(key => immutable(value[key]));
  return Object.freeze(value);
}

function snapshot(overrides) {
  return immutable(Object.assign({
    productId: 'full_game_v1',
    status: 'not_owned',
    source: 'fake-store',
    transactionId: null,
    verifiedAt: null,
    revision: 1,
    verifiedCache: false,
    price: null
  }, clone(overrides || {})));
}

function result(nextSnapshot, operation) {
  return immutable({
    snapshot: nextSnapshot,
    operation: Object.assign({ status: 'success', retryable: false }, operation || {})
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

class FakeFullGameStore {
  constructor(initialSnapshot) {
    this.snapshot = initialSnapshot || snapshot();
    this.listeners = new Set();
    this.queues = { refresh: [], purchase: [], restore: [] };
    this.calls = [];
    this.subscribeCalls = 0;
    this.unsubscribeCalls = 0;
    this.disposeCalls = 0;
  }

  current() { return this.snapshot; }

  subscribe(listener) {
    this.subscribeCalls++;
    this.listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return false;
      active = false;
      const removed = this.listeners.delete(listener);
      if (removed) this.unsubscribeCalls++;
      return removed;
    };
  }

  listenerCount() { return this.listeners.size; }

  publish(nextSnapshot) {
    this.snapshot = nextSnapshot;
    this.listeners.forEach(listener => listener(nextSnapshot));
    return nextSnapshot;
  }

  enqueue(method, response) {
    this.queues[method].push(response);
    return this;
  }

  run(method, reason) {
    this.calls.push({ method, reason: reason || null });
    const queued = this.queues[method].length
      ? this.queues[method].shift()
      : result(this.snapshot, { type: method, status: 'success' });
    const task = typeof queued === 'function' ? queued(reason) : queued;
    return Promise.resolve(task).then(value => {
      if (value && value.snapshot) this.publish(value.snapshot);
      return value;
    });
  }

  refresh(reason) { return this.run('refresh', reason); }
  purchase() { return this.run('purchase'); }
  restore() { return this.run('restore'); }
  dispose() { this.disposeCalls++; }
}

module.exports = Object.freeze({ FakeFullGameStore, snapshot, result, deferred });
