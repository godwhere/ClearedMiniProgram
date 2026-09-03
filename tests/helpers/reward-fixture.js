'use strict';

const RewardUnlockService = require('../../src/services/reward-unlock-service.js');

class RewardPlatform {
  constructor(storage) {
    this.storage = JSON.parse(JSON.stringify(storage || {}));
    this.readFailures = Object.create(null);
    this.writeFailures = Object.create(null);
    this.writes = [];
  }

  getStorage(key) {
    return Object.prototype.hasOwnProperty.call(this.storage, key) ? this.storage[key] : null;
  }

  readStorageResult(key) {
    if (this.readFailures[key]) return { ok: false, reason: 'storage-read-failed' };
    return Object.prototype.hasOwnProperty.call(this.storage, key)
      ? { ok: true, found: true, value: JSON.parse(JSON.stringify(this.storage[key])) }
      : { ok: true, found: false };
  }

  setStorage(key, value) {
    if (this.writeFailures[key]) return false;
    this.storage[key] = JSON.parse(JSON.stringify(value));
    this.writes.push({ key, value: JSON.parse(JSON.stringify(value)) });
    return true;
  }
}

function ownedState(ids, balance) {
  const state = RewardUnlockService.emptyState();
  state.balance = balance || 0;
  (ids || []).forEach(id => { state.ownedRewards[id] = true; });
  return state;
}

function allowAll(kind, itemId) {
  return typeof kind === 'string' && typeof itemId === 'string';
}

function allOwnedRewardService() {
  return {
    view: () => ({ available: true, balance: 0, error: null }),
    retryLoad: () => ({ ok: true }),
    reconcile: () => ({ ok: true, amountDelta: 0, newRewards: [], sources: [] }),
    canUse: allowAll,
    owned: () => true,
    item(rewardId) {
      const parts = String(rewardId).split(':');
      return { id: rewardId, kind: parts[0], itemId: parts.slice(1).join(':'), unlock: { type: 'default' } };
    },
    status(rewardId) {
      const item = this.item(rewardId);
      return { ok: true, owned: true, action: 'apply', conditionType: 'default',
        kind: item.kind, itemId: item.itemId };
    },
    pendingNotices: () => [],
    acknowledgeNotice: () => ({ ok: true }),
    hasPendingExternal: () => false
  };
}

module.exports = { RewardPlatform, ownedState, allowAll, allOwnedRewardService };
