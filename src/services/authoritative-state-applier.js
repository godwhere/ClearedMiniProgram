'use strict';

const { record, validId, clone, fingerprint } = require('./sync-payload.js');
const SyncStore = require('./sync-store.js');
const DOMAINS = SyncStore.DOMAINS;

class AuthoritativeStateApplier {
  constructor(services, accountGuard) { this.services = services; this.accountGuard = accountGuard || null; }

  scopeToken(token) {
    return token && { ownerId: token.ownerIdAtStart, bindingEpoch: token.bindingEpochAtStart,
      environmentId: token.environmentIdAtStart, activationSequence: token.activationSequenceAtStart };
  }

  capture() {
    if (this.accountGuard) return this.accountGuard.capture();
    const scope = this.services.syncStore.context();
    return { ownerIdAtStart: scope.ownerId, bindingEpochAtStart: scope.bindingEpoch,
      environmentIdAtStart: scope.environmentId, activationSequenceAtStart: scope.activationSequence,
      accountGenerationAtStart: scope.activationSequence };
  }

  applyMigrationFinalization(input, token, migrationContext) {
    return this.applySyncReceipt(input, token, Object.assign({}, migrationContext, { adoptLocal: true, migration: true }));
  }

  resumePending(token) {
    const scopeToken = this.scopeToken(token);
    if (!scopeToken || !this.services.syncStore.matches(scopeToken) ||
        (this.accountGuard && !this.accountGuard.matches(token))) {
      return Promise.resolve({ ok: false, reason: 'account-mismatch' });
    }
    const recovery = this.services.syncStore.pendingRecovery(scopeToken);
    if (!recovery) return Promise.resolve(this.services.syncStore.currentScope().pendingApplication
      ? { ok: false, reason: 'application-pending' }
      : { ok: true, resumed: false });
    return this.applySyncReceipt(recovery.response, token, recovery.options).then(result =>
      Object.assign({}, result, { resumed: result.ok === true }));
  }

  async applySyncReceipt(input, token, options) {
    const store = this.services.syncStore; const opts = options || {};
    if (!token) return { ok: false, reason: 'account-mismatch' };
    const scopeToken = this.scopeToken(token);
    const current = () => store.matches(scopeToken) && (store.ownsLocalState() || opts.adoptLocal === true) &&
      (!this.accountGuard || this.accountGuard.matches(token));
    if (!current()) return { ok: false, reason: 'account-mismatch' };
    let response;
    try { response = clone(input); } catch (error) { return { ok: false, reason: 'invalid-response' }; }
    const expectedOperationIds = opts.expectedOperationIds;
    if (expectedOperationIds !== undefined && (!Array.isArray(expectedOperationIds) ||
        expectedOperationIds.some(id => !validId(id)) || new Set(expectedOperationIds).size !== expectedOperationIds.length)) {
      return { ok: false, reason: 'invalid-response' };
    }
    const knownRevisions = store.currentScope().revisions;
    if (!record(response) || response.protocolVersion !== 1 || response.environmentId !== scopeToken.environmentId ||
        response.ownerId !== scopeToken.ownerId || response.bindingEpoch !== scopeToken.bindingEpoch ||
        !validId(response.receiptId) || !record(response.domains) || !record(response.revisions) ||
        Object.keys(response.domains).some(key => !DOMAINS.includes(key)) ||
        Object.keys(response.revisions).length !== SyncStore.DOMAINS.length ||
        !SyncStore.DOMAINS.every(key => Number.isSafeInteger(response.revisions[key]) && response.revisions[key] >= knownRevisions[key]) ||
        !Array.isArray(response.acceptedOperationIds) || !response.acceptedOperationIds.every(validId) ||
        new Set(response.acceptedOperationIds).size !== response.acceptedOperationIds.length ||
        !Array.isArray(response.notificationHints || []) || !(response.notificationHints || []).every(validId)) {
      return { ok: false, reason: 'invalid-response' };
    }
    if (response.results !== undefined) {
      if (!Array.isArray(response.results) || response.results.length > 50) return { ok: false, reason: 'invalid-response' };
      const resultIds = new Set();
      for (const item of response.results) {
        if (!record(item) || Object.keys(item).some(key => !['operationId', 'status', 'code', 'details'].includes(key)) ||
            !validId(item.operationId) || resultIds.has(item.operationId) ||
            !['ACKED', 'RETRYABLE', 'REJECTED'].includes(item.status) ||
            typeof item.code !== 'string' || !/^[A-Z0-9_]{1,80}$/.test(item.code) ||
            (item.details !== undefined && !record(item.details))) return { ok: false, reason: 'invalid-response' };
        resultIds.add(item.operationId);
      }
      const acked = response.results.filter(item => item.status === 'ACKED').map(item => item.operationId).sort();
      const acceptedIds = Array.from(new Set(response.acceptedOperationIds)).sort();
      if (acked.length !== acceptedIds.length || acked.some((id, index) => id !== acceptedIds[index])) {
        return { ok: false, reason: 'invalid-response' };
      }
      if (expectedOperationIds !== undefined) {
        const expected = expectedOperationIds.slice().sort(); const actual = Array.from(resultIds).sort();
        if (expected.length !== actual.length || expected.some((id, index) => id !== actual[index])) {
          return { ok: false, reason: 'invalid-response' };
        }
      }
    }
    const steps = DOMAINS.filter(domain => Object.prototype.hasOwnProperty.call(response.domains, domain));
    if (SyncStore.DOMAINS.some(domain => !steps.includes(domain) && response.revisions[domain] !== knownRevisions[domain])) {
      return { ok: false, reason: 'missing-domain' };
    }
    if (steps.includes('economy') !== steps.includes('entitlements')) return { ok: false, reason: 'paired-domain-required' };
    for (const domain of steps) if (!record(response.domains[domain])) return { ok: false, reason: 'invalid-snapshot', domain };
    const scope = store.currentScope(); const knownIds = new Set(scope.pendingOperations.filter(item =>
      item.ownerIdAtCreation === scopeToken.ownerId && item.bindingEpochAtCreation === scopeToken.bindingEpoch &&
      item.environmentIdAtCreation === scopeToken.environmentId).map(item => item.operationId));
    const serverAccepted = response.acceptedOperationIds.slice();
    const accepted = Array.from(new Set(serverAccepted.filter(id => knownIds.has(id))));
    const rejectedIds = new Set((response.results || []).filter(item => item.status === 'REJECTED').map(item => item.operationId));
    const overlay = scope.pendingOperations.filter(item => !accepted.includes(item.operationId) && !rejectedIds.has(item.operationId));
    const receipt = { receiptId: response.receiptId, fingerprint: fingerprint({
      protocolVersion: response.protocolVersion, environmentId: response.environmentId,
      ownerId: response.ownerId, bindingEpoch: response.bindingEpoch, domains: response.domains,
      revisions: response.revisions, acceptedOperationIds: serverAccepted.slice().sort(),
      notificationHints: (response.notificationHints || []).slice().sort(),
      results: (response.results || []).slice().sort((a, b) => a.operationId < b.operationId ? -1 : a.operationId > b.operationId ? 1 : 0)
    }) };
    const recoveryOptions = {};
    if (opts.adoptLocal === true) recoveryOptions.adoptLocal = true;
    if (opts.migration === true) recoveryOptions.migration = true;
    if (opts.importId !== undefined) recoveryOptions.importId = opts.importId;
    if (opts.migrationReceiptId !== undefined) recoveryOptions.migrationReceiptId = opts.migrationReceiptId;
    if (expectedOperationIds !== undefined) recoveryOptions.expectedOperationIds = expectedOperationIds.slice();
    const cloudDomains = steps.filter(domain => ['stamina', 'preferences'].includes(domain));
    if (cloudDomains.length) recoveryOptions.cloudDomains = cloudDomains.slice();
    const begun = store.beginApplication(receipt, scopeToken, { adoptLocal: opts.adoptLocal === true,
      cloudDomains,
      recovery: { schemaVersion: 1, response, options: recoveryOptions } });
    if (!begun.ok) return begun;
    if (this.services.rewards && typeof this.services.rewards.setAuthorityMode === 'function' &&
        !this.services.rewards.setAuthorityMode('cloud-authoritative')) return { ok: false, reason: 'authority-mismatch' };
    if ((steps.includes('stamina') || store.authorityMode('stamina') === 'cloud-authoritative') &&
        this.services.stamina && typeof this.services.stamina.setAuthorityMode === 'function' &&
        !this.services.stamina.setAuthorityMode('cloud-authoritative')) return { ok: false, reason: 'authority-mismatch' };
    if (!begun.alreadyApplied) {
      if (steps.includes('progress')) {
        const result = this.services.progress && this.services.progress.applyAuthoritativeProgressSnapshot
          ? this.services.progress.applyAuthoritativeProgressSnapshot(response.domains.progress, overlay) : null;
        if (!result || !result.ok) return { ok: false, reason: result && result.reason || 'persist-failed', domain: 'progress' };
      }
      if (steps.includes('daily')) {
        const result = this.services.daily && this.services.daily.applyAuthoritativeSnapshot
          ? this.services.daily.applyAuthoritativeSnapshot(response.domains.daily, overlay) : null;
        if (!result || !result.ok) return { ok: false, reason: result && result.reason || 'persist-failed', domain: 'daily' };
      }
      if (steps.includes('economy')) {
        const result = this.services.rewards && this.services.rewards.applyAuthoritativeAssets
          ? this.services.rewards.applyAuthoritativeAssets({ economy: response.domains.economy,
            entitlements: response.domains.entitlements, notificationHints: response.notificationHints || [] }) : null;
        if (!result || !result.ok) return { ok: false, reason: result && result.reason || 'persist-failed', domain: 'economy' };
      }
      if (steps.includes('stamina')) {
        const result = this.services.stamina && this.services.stamina.applyAuthoritativeSnapshot
          ? this.services.stamina.applyAuthoritativeSnapshot(response.domains.stamina, overlay) : null;
        if (!result || !result.ok) return { ok: false, reason: result && result.reason || 'persist-failed', domain: 'stamina' };
      }
      if (steps.includes('preferences')) {
        const result = this.services.preferences && this.services.preferences.applyAuthoritativeSnapshot
          ? this.services.preferences.applyAuthoritativeSnapshot(response.domains.preferences, overlay) : null;
        if (!result || !result.ok) return { ok: false, reason: result && result.reason || 'persist-failed', domain: 'preferences' };
      }
      if (!current()) return { ok: false, reason: 'account-mismatch' };
      if (!store.finishApplication(receipt, response.revisions, accepted, scopeToken,
        { adoptLocal: opts.adoptLocal === true, importId: opts.importId,
          migrationReceiptId: opts.migrationReceiptId || response.receiptId, cloudDomains })) {
        return { ok: false, reason: 'persist-failed' };
      }
    }
    if (Array.isArray(response.results) && !store.quarantineOperations(response.results, store.context())) {
      return { ok: false, reason: 'persist-failed' };
    }
    if (opts.migration && this.services.sessions) {
      const currentMetadata = this.services.sessions.metadata();
      const metadata = { schemaVersion: 2, mode: 'cloud', ownerId: scopeToken.ownerId,
        bindingEpoch: scopeToken.bindingEpoch, environmentId: scopeToken.environmentId, migrationState: 'complete',
        migrationImportId: opts.importId, migrationReceiptId: opts.migrationReceiptId || response.receiptId,
        legacySession: currentMetadata && currentMetadata.legacySession || null };
      if (!validId(metadata.migrationImportId) || !this.services.sessions.set(metadata)) return { ok: false, reason: 'persist-failed', domain: 'session' };
    }
    return { ok: true, alreadyApplied: begun.alreadyApplied === true };
  }

  apply(input, token) { return this.applySyncReceipt(input, token); }
}

module.exports = AuthoritativeStateApplier;
