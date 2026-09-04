'use strict';

const { record, validId, clone, fingerprint } = require('./sync-payload.js');
const SyncStore = require('./sync-store.js');
const ORDER = SyncStore.DOMAINS;

class AuthoritativeStateApplier {
  constructor(services, accountGuard) { this.services = services; this.accountGuard = accountGuard || null; }

  capture() {
    if (this.accountGuard) return this.accountGuard.capture();
    const scope = this.services.syncStore.context();
    return { ownerIdAtStart: scope.ownerId, bindingEpochAtStart: scope.bindingEpoch,
      activationSequenceAtStart: scope.activationSequence, accountGenerationAtStart: scope.activationSequence };
  }

  async apply(input, token) {
    const store = this.services.syncStore;
    // The caller must capture BEFORE starting async work, not after a late
    // response arrives. An implicit fresh token would allow an A-B-A replay.
    if (!token) return { ok: false, reason: 'account-mismatch' };
    const context = token;
    const scopeToken = { ownerId: context.ownerIdAtStart, bindingEpoch: context.bindingEpochAtStart,
      activationSequence: context.activationSequenceAtStart };
    const current = () => store.matches(scopeToken) && store.ownsLocalState() &&
      (!this.accountGuard || this.accountGuard.matches(context));
    if (!current()) return { ok: false, reason: 'account-mismatch' };
    let response;
    try { response = clone(input); } catch (error) { return { ok: false, reason: 'invalid-response' }; }
    if (!record(response) || response.schemaVersion !== 1 || response.protocolVersion !== 1 ||
        response.ownerId !== scopeToken.ownerId || response.bindingEpoch !== scopeToken.bindingEpoch ||
        !validId(response.receiptId) || !record(response.domains) || !record(response.revisions) ||
        Object.keys(response.domains).some(key => !ORDER.includes(key)) ||
        Object.keys(response.revisions).length !== ORDER.length || !ORDER.every(key => Number.isSafeInteger(response.revisions[key]) &&
          response.revisions[key] >= store.currentScope().revisions[key]) ||
        !Array.isArray(response.acceptedOperationIds) || !response.acceptedOperationIds.every(validId)) return { ok: false, reason: 'invalid-response' };
    const targets = { progress: this.services.progress, daily: this.services.daily, economy: this.services.rewards,
      entitlements: this.services.rewards, stamina: this.services.stamina, preferences: this.services.progress };
    const steps = ORDER.filter(domain => Object.prototype.hasOwnProperty.call(response.domains, domain));
    if (!steps.length) return { ok: false, reason: 'invalid-response' };
    if (ORDER.some(domain => !steps.includes(domain) && response.revisions[domain] !== store.currentScope().revisions[domain])) return { ok: false, reason: 'missing-domain' };
    if (store.currentScope().pendingOperations.some(item => response.acceptedOperationIds.includes(item.operationId) &&
        !steps.includes(item.domain))) return { ok: false, reason: 'missing-domain' };
    for (const domain of steps) {
      const target = targets[domain];
      const method = domain === 'progress' ? 'mergeCloudSnapshot' : 'applyAuthoritativeSnapshot';
      if (!record(response.domains[domain]) || !target || typeof target[method] !== 'function') return { ok: false, reason: 'domain-not-supported', domain };
      if (domain === 'progress' && (response.domains.progress.schemaVersion !== 1 || !record(response.domains.progress.levels))) return { ok: false, reason: 'invalid-response' };
      if (domain === 'stamina' && target.validateAuthoritativeSnapshot && !target.validateAuthoritativeSnapshot(response.domains.stamina)) return { ok: false, reason: 'invalid-snapshot' };
    }
    const known = new Set(store.currentScope().pendingOperations.filter(item =>
      item.ownerIdAtCreation === scopeToken.ownerId && item.bindingEpochAtCreation === scopeToken.bindingEpoch).map(item => item.operationId));
    const accepted = response.acceptedOperationIds.filter(id => known.has(id));
    // Request IDs/server observation times can change on a safe retry; hash
    // only canonical state and ACK content, with ACK IDs treated as a set.
    const receipt = { receiptId: response.receiptId, fingerprint: fingerprint({
      schemaVersion: response.schemaVersion, protocolVersion: response.protocolVersion,
      ownerId: response.ownerId, bindingEpoch: response.bindingEpoch, domains: response.domains,
      revisions: response.revisions, acceptedOperationIds: Array.from(new Set(response.acceptedOperationIds)).sort()
    }) };
    const begun = store.beginApplication(receipt, scopeToken);
    if (!begun.ok) return begun;
    for (const service of [this.services.rewards, this.services.stamina]) {
      if (service && typeof service.setAuthorityMode === 'function' && !service.setAuthorityMode('cloud-authoritative')) return { ok: false, reason: 'authority-mismatch' };
    }
    if (begun.alreadyApplied) return begun;
    // This is replayable, not a transaction across independent storage keys.
    // Keep receipt identity, queue and revisions until EVERY write succeeds.
    for (const domain of steps) {
      if (!current()) return { ok: false, reason: 'account-mismatch' };
      const target = targets[domain];
      let result;
      try { result = await (domain === 'progress' ? target.mergeCloudSnapshot(response.domains[domain])
        : target.applyAuthoritativeSnapshot(response.domains[domain])); }
      catch (error) { return { ok: false, reason: 'persist-failed', domain }; }
      if (!result || result.ok !== true) return { ok: false, reason: result && result.reason || 'persist-failed', domain };
    }
    if (!current()) return { ok: false, reason: 'account-mismatch' };
    return store.finishApplication(receipt, response.revisions, accepted, scopeToken)
      ? { ok: true } : { ok: false, reason: 'persist-failed' };
  }
}

module.exports = AuthoritativeStateApplier;
