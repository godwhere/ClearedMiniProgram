'use strict';

const ApiClient = require('./api-client.js');
const SyncStore = require('./sync-store.js');
const { clone, validId } = require('./sync-payload.js');

const STORAGE_KEY = 'cleared:minigame:economy-requests:v1';
const validOwner = value => typeof value === 'string' && /^player_[A-Za-z0-9_-]{1,120}$/.test(value);
const validEnvironment = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const scopeKey = (session, rewardId) => `${session.environmentId}|${session.ownerId}|${session.bindingEpoch}|${rewardId}`;

class EconomyService {
  constructor(platform, api, auth, syncStore, rewards, applier) {
    this.platform = platform; this.api = api; this.auth = auth; this.store = syncStore;
    this.rewards = rewards; this.applier = applier; this.inFlight = {};
    this.state = this.load(); this.accountGuard = null;
  }

  load() {
    let value;
    try { value = this.platform.getStorage(STORAGE_KEY); } catch (error) {}
    if (!value || value.schemaVersion !== 1 || !value.pending || typeof value.pending !== 'object' || Array.isArray(value.pending)) {
      return { schemaVersion: 1, pending: {} };
    }
    const pending = {};
    Object.keys(value.pending).forEach(key => {
      const item = value.pending[key];
      if (item && /^theme:[a-z0-9-]{1,80}$/.test(item.rewardId) && validId(item.operationId) &&
          validOwner(item.ownerIdAtCreation) && Number.isSafeInteger(item.bindingEpochAtCreation) &&
          item.bindingEpochAtCreation > 0 && validEnvironment(item.environmentIdAtCreation) &&
          Number.isSafeInteger(item.createdAt) && item.createdAt >= 0 &&
          key === scopeKey({ ownerId: item.ownerIdAtCreation, bindingEpoch: item.bindingEpochAtCreation,
            environmentId: item.environmentIdAtCreation }, item.rewardId)) pending[key] = clone(item);
    });
    return { schemaVersion: 1, pending };
  }

  save(candidate) {
    try {
      if (this.platform.setStorage(STORAGE_KEY, clone(candidate)) !== true) return false;
      this.state = candidate; return true;
    } catch (error) { return false; }
  }

  pending(rewardId, session) {
    const current = session || this.auth.current();
    if (!current || current.mode !== 'cloud' || !validOwner(current.ownerId) ||
        !validEnvironment(current.environmentId) || !Number.isSafeInteger(current.bindingEpoch) || current.bindingEpoch <= 0) return undefined;
    const value = this.state.pending[scopeKey(current, rewardId)];
    return value && clone(value);
  }

  hasPendingPurchase(session) {
    const current = session || this.auth.current();
    if (!current || current.mode !== 'cloud') return false;
    const prefix = `${current.environmentId}|${current.ownerId}|${current.bindingEpoch}|`;
    return Object.keys(this.inFlight).some(key => key.startsWith(prefix)) ||
      Object.values(this.state.pending).some(item => item.ownerIdAtCreation === current.ownerId &&
        item.bindingEpochAtCreation === current.bindingEpoch && item.environmentIdAtCreation === current.environmentId);
  }

  async recoverPending(session) {
    const current = session || this.auth.current();
    if (!current || current.mode !== 'cloud' || this.store.authorityMode('economy') !== 'cloud-authoritative') {
      return { ok: false, reason: 'not-ready', results: [] };
    }
    const pending = Object.values(this.state.pending).filter(item => item.ownerIdAtCreation === current.ownerId &&
      item.bindingEpochAtCreation === current.bindingEpoch && item.environmentIdAtCreation === current.environmentId)
      .sort((a, b) => a.createdAt - b.createdAt || a.operationId.localeCompare(b.operationId));
    const results = [];
    for (const item of pending) {
      const active = this.auth.current();
      if (!active || active.ownerId !== current.ownerId || active.bindingEpoch !== current.bindingEpoch ||
          active.environmentId !== current.environmentId) return { ok: false, reason: 'account-mismatch', results };
      const result = await this.purchase(item.rewardId); results.push(result);
      if (!result.ok && result.reason !== 'insufficient-balance') return { ok: false, reason: result.reason, results };
    }
    return { ok: true, results };
  }

  purchase(rewardId) {
    if (this.store.authorityMode('economy') !== 'cloud-authoritative') {
      return Promise.resolve({ ok: false, reason: this.store.authorityMode('economy'), amountDelta: 0, newRewards: [] });
    }
    const item = this.rewards.item(rewardId);
    if (!item || item.unlock.type !== 'currency') return Promise.resolve({ ok: false, reason: 'invalid-reward', amountDelta: 0, newRewards: [] });
    const session = this.auth.current();
    if (!session || session.mode !== 'cloud') return Promise.resolve({ ok: false, reason: 'network-required', amountDelta: 0, newRewards: [] });
    const key = scopeKey(session, rewardId);
    if (this.inFlight[key]) return this.inFlight[key];
    let pending = this.pending(rewardId, session);
    if (!pending) {
      const operationId = this.store.nextId('purchase_');
      if (!operationId) return Promise.resolve({ ok: false, reason: 'persist-failed', amountDelta: 0, newRewards: [] });
      pending = { operationId, rewardId, ownerIdAtCreation: session.ownerId,
        bindingEpochAtCreation: session.bindingEpoch, environmentIdAtCreation: session.environmentId,
        createdAt: Date.now() };
      const candidate = clone(this.state); candidate.pending[key] = pending;
      if (!this.save(candidate)) return Promise.resolve({ ok: false, reason: 'persist-failed', amountDelta: 0, newRewards: [] });
    }
    const account = this.accountGuard && this.accountGuard.capture(); const scope = this.store.context();
    const task = this.api.request(Object.assign({}, ApiClient.OPERATIONS.economyPurchase, {
      requestId: SyncStore.opaqueId('req'), auth: true, operationId: pending.operationId,
      idempotencyKey: 'purchase:' + pending.operationId, payload: { claimedPlayerId: session.ownerId,
        bindingEpoch: session.bindingEpoch, environmentId: session.environmentId,
        kind: item.kind, itemId: item.itemId, catalogVersion: 1 }
    })).then(async response => {
      if ((account && (!this.accountGuard || !this.accountGuard.matches(account))) || !this.store.matches(scope)) {
        return { ok: false, reason: 'account-mismatch', amountDelta: 0, newRewards: [] };
      }
      if (!response.ok) return { ok: false,
        reason: response.error.code === 'network' || response.error.code === 'timeout' ? 'network-required' : response.error.code,
        retryable: response.error.retryable, operationId: pending.operationId, amountDelta: 0, newRewards: [] };
      if (!ApiClient.validatePurchaseEnvelope(response.data, session.environmentId) ||
          response.data.data.purchase.operationId !== pending.operationId ||
          response.data.data.purchase.kind !== item.kind || response.data.data.purchase.itemId !== item.itemId ||
          response.data.data.purchase.cost !== item.unlock.cost ||
          response.data.data.domains.economy.balance !== response.data.data.purchase.balanceAfter) {
        return { ok: false, reason: 'invalid-response', operationId: pending.operationId, amountDelta: 0, newRewards: [] };
      }
      const value = response.data.data;
      if (['PURCHASED', 'ALREADY_OWNED'].includes(value.purchase.status) &&
          (!value.domains.entitlements || !value.domains.entitlements.ownedRewards ||
            value.domains.entitlements.ownedRewards[rewardId] !== true)) {
        return { ok: false, reason: 'invalid-response', operationId: pending.operationId, amountDelta: 0, newRewards: [] };
      }
      const applied = await this.applier.applySyncReceipt({ protocolVersion: 1, environmentId: session.environmentId,
        ownerId: session.ownerId, bindingEpoch: session.bindingEpoch, receiptId: value.receiptId,
        revisions: value.revisions, domains: value.domains, acceptedOperationIds: [],
        notificationHints: value.notificationHints || [], results: [] }, account);
      if (!applied.ok) return { ok: false, reason: applied.reason, operationId: pending.operationId, amountDelta: 0, newRewards: [] };
      const candidate = clone(this.state); delete candidate.pending[key];
      if (!this.save(candidate)) return { ok: false, reason: 'persist-failed', operationId: pending.operationId, amountDelta: 0, newRewards: [] };
      const purchase = value.purchase;
      if (purchase.status === 'INSUFFICIENT_BALANCE') return { ok: false, reason: 'insufficient-balance',
        operationId: pending.operationId, amountDelta: 0, newRewards: [] };
      return { ok: true, reason: purchase.status === 'ALREADY_OWNED' ? 'already-owned' : 'purchased',
        alreadyApplied: purchase.status === 'ALREADY_OWNED', operationId: pending.operationId,
        amountDelta: purchase.status === 'PURCHASED' ? -purchase.cost : 0,
        newRewards: purchase.newEntitlements || [] };
    }).catch(() => ({ ok: false, reason: 'network-required', retryable: true,
      operationId: pending.operationId, amountDelta: 0, newRewards: [] }))
      .finally(() => { delete this.inFlight[key]; });
    this.inFlight[key] = task; return task;
  }
}

EconomyService.STORAGE_KEY = STORAGE_KEY;
module.exports = EconomyService;
