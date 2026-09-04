'use strict';

const { record, validId, canonical, fingerprint, clone, freeze } = require('./sync-payload.js');
const STORAGE_KEY = 'cleared:minigame:online:v1';
const MAX_OPERATIONS = 200;
const opaqueId = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
const DOMAINS = ['progress', 'daily', 'economy', 'entitlements', 'stamina', 'preferences'];
const MODES = ['legacy-local', 'migration-freeze', 'cloud-authoritative'];
const integer = value => Number.isSafeInteger(value) && value >= 0;
const environment = value => value === undefined ? null : value;
const validEnvironment = value => value === null || (typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value));
const scopeKey = (ownerId, env) => env ? `cloud:${env}|${ownerId}` : ownerId === null ? 'guest' : ownerId;
const legacyOwnerId = userId => validId(userId) ? `legacy-http:${userId}` : null;
const validOwner = ownerId => ownerId === null || (typeof ownerId === 'string' &&
  (/^player_[A-Za-z0-9_-]{1,120}$/.test(ownerId) ||
    (ownerId.startsWith('legacy-http:') && validId(ownerId.slice(12)))));
const validEpoch = (ownerId, epoch) => integer(epoch) &&
  (ownerId === null || ownerId.startsWith('legacy-http:') ? epoch === 0 : epoch > 0);
const revisions = () => DOMAINS.reduce((result, domain) => { result[domain] = 0; return result; }, {});
const validRevisions = value => record(value) && Object.keys(value).length === DOMAINS.length && DOMAINS.every(key => integer(value[key]));
const emptyScope = (ownerId, bindingEpoch) => ({ ownerId, bindingEpoch, revisions: revisions(),
  pendingOperations: [], snapshotRequired: false, lastSyncAt: 0, lastError: null, migration: null,
  pendingApplication: null, lastApplication: null });

function validProgress(payload) {
  return record(payload) && typeof payload.levelKey === 'string' && /^(0|[1-9]\d*):(0|[1-9]\d*)$/.test(payload.levelKey) &&
    integer(payload.completedAtClient) && (payload.elapsedMs === undefined || (Number.isFinite(payload.elapsedMs) && payload.elapsedMs > 0));
}

function operation(input, ownerId, bindingEpoch, env = null) {
  if (!record(input) || !validId(input.operationId) || !DOMAINS.includes(input.domain) ||
      typeof input.type !== 'string' || !/^[A-Za-z0-9_:-]{1,80}$/.test(input.type) ||
      !record(input.payload) || !integer(input.occurredAtClient) ||
      input.ownerIdAtCreation !== ownerId || environment(input.environmentIdAtCreation) !== env || !validEpoch(ownerId, input.bindingEpochAtCreation) ||
      input.bindingEpochAtCreation > bindingEpoch ||
      (input.domain === 'progress' && (input.type !== 'level_completed' || !validProgress(input.payload)))) return null;
  const payload = clone(input.payload);
  if (input.payloadHash !== fingerprint(payload)) return null;
  const result = { operationId: input.operationId, domain: input.domain, type: input.type,
    ownerIdAtCreation: ownerId, bindingEpochAtCreation: input.bindingEpochAtCreation,
    payloadHash: input.payloadHash, payload, occurredAtClient: input.occurredAtClient };
  if (env !== null) result.environmentIdAtCreation = env;
  return result;
}

function upgrade(saved) {
  if (!record(saved) || saved.schemaVersion !== 1 || !validId(saved.installId) || !validId(saved.migrationId) ||
      (saved.boundUserId != null && !validId(saved.boundUserId)) || !integer(saved.serverRevision) ||
      !Array.isArray(saved.pendingOperations)) return null;
  const ownerId = saved.boundUserId ? legacyOwnerId(saved.boundUserId) : null;
  const scope = emptyScope(ownerId, 0);
  scope.revisions.progress = saved.serverRevision;
  scope.snapshotRequired = saved.snapshotRequired === true;
  scope.lastSyncAt = integer(saved.lastSyncAt) ? saved.lastSyncAt : 0;
  scope.lastError = validId(saved.lastError) ? saved.lastError : null;
  scope.pendingOperations = saved.pendingOperations.map(item => {
    if (!item || !validId(item.operationId) || item.type !== 'level_completed' || !validProgress(item.payload)) throw Error('invalid-operation');
    const payload = clone(item.payload);
    return { operationId: item.operationId, domain: 'progress', type: item.type,
      ownerIdAtCreation: ownerId, bindingEpochAtCreation: 0, payloadHash: fingerprint(payload),
      payload, occurredAtClient: payload.completedAtClient };
  });
  return { schemaVersion: 2, installId: saved.installId, migrationId: saved.migrationId,
    boundUserId: saved.boundUserId || null, nextOperationSequence: saved.nextOperationSequence,
    activeOwnerId: ownerId, localOwnerId: ownerId, activationSequence: 0,
    authorityMode: 'legacy-local', scopes: { [scopeKey(ownerId)]: scope },
    // Immutable recovery evidence only, never a sendable queue or live state.
    legacyBackup: clone(saved) };
}

function normalize(saved) {
  if (!record(saved) || saved.schemaVersion !== 2 || !validId(saved.installId) || !validId(saved.migrationId) ||
      !validOwner(saved.activeOwnerId) || !validOwner(saved.localOwnerId) || !integer(saved.activationSequence) ||
      !MODES.includes(saved.authorityMode) || !record(saved.scopes) ||
      (saved.boundUserId !== null && !validId(saved.boundUserId)) ||
      !validEnvironment(environment(saved.activeEnvironmentId)) || !validEnvironment(environment(saved.localEnvironmentId))) return null;
  const scopes = {}; const ids = new Set();
  for (const key of Object.keys(saved.scopes)) {
    let scope = saved.scopes[key];
    // An earlier local-only v2 writer predates the two application-recovery
    // slots. Only that exact additive shape is safe to upgrade; never infer
    // a missing recovery receipt during migration/authoritative application.
    if (record(scope) && saved.authorityMode === 'legacy-local' && scope.migration === null &&
        !Object.prototype.hasOwnProperty.call(scope, 'pendingApplication') &&
        !Object.prototype.hasOwnProperty.call(scope, 'lastApplication')) {
      scope = Object.assign({}, scope, { pendingApplication: null, lastApplication: null });
    }
    const env = scope && environment(scope.environmentId);
    if (!record(scope) || !validOwner(scope.ownerId) || !validEnvironment(env) ||
        (env !== null && !String(scope.ownerId).startsWith('player_')) || key !== scopeKey(scope.ownerId, env) ||
        !validEpoch(scope.ownerId, scope.bindingEpoch) || !validRevisions(scope.revisions) ||
        !Array.isArray(scope.pendingOperations) || !integer(scope.lastSyncAt) ||
        typeof scope.snapshotRequired !== 'boolean' || (scope.lastError !== null && !validId(scope.lastError))) return null;
    const pending = [];
    for (const input of scope.pendingOperations) {
      const item = operation(input, scope.ownerId, scope.bindingEpoch, env);
      if (!item || ids.has(item.operationId)) return null;
      ids.add(item.operationId); pending.push(item);
    }
    const migration = scope.migration;
    if (migration !== null && (!record(migration) || migration.state !== 'prepared' ||
        !validId(migration.importId) || typeof migration.snapshotHash !== 'string' ||
        !/^local-fnv1a32:[a-f0-9]{8}:\d+$/.test(migration.snapshotHash) || migration.policyVersion !== 'LEGACY_PRIMARY_SNAPSHOT_V1')) return null;
    for (const receipt of [scope.pendingApplication, scope.lastApplication]) {
      if (receipt !== null && (!record(receipt) || Object.keys(receipt).length !== 2 ||
          !validId(receipt.receiptId) || typeof receipt.fingerprint !== 'string' ||
          !/^local-fnv1a32:[a-f0-9]{8}:\d+$/.test(receipt.fingerprint))) return null;
    }
    if (scope.readOnlyPhase !== undefined && (scope.readOnlyPhase !== true || env === null)) return null;
    if (scope.readOnlySummary !== undefined && (!record(scope.readOnlySummary) || !integer(scope.readOnlySummary.lastReadAt) ||
        !integer(scope.readOnlySummary.serverTimeMs) || !validRevisions(scope.readOnlySummary.revisions) ||
        DOMAINS.some(key => scope.readOnlySummary.revisions[key] !== 0))) return null;
    scopes[key] = Object.assign({}, scope, { pendingOperations: pending });
  }
  if (!Object.prototype.hasOwnProperty.call(scopes, scopeKey(saved.activeOwnerId, saved.activeEnvironmentId)) ||
      !Object.prototype.hasOwnProperty.call(scopes, scopeKey(saved.localOwnerId, saved.localEnvironmentId))) return null;
  return Object.assign({}, clone(saved), { scopes, activeEnvironmentId: environment(saved.activeEnvironmentId),
    localEnvironmentId: environment(saved.localEnvironmentId) });
}

class SyncStore {
  constructor(platform) {
    this.platform = platform;
    this.scopeListeners = [];
    let saved; let state;
    try {
      if (typeof platform.readStorageResult === 'function') {
        const read = platform.readStorageResult(STORAGE_KEY);
        if (!read || !read.ok || (read.found !== true && read.found !== false)) throw Error('storage-read-failed');
        saved = read.found ? read.value : null;
      } else saved = platform.getStorage(STORAGE_KEY);
      if (typeof saved === 'string') saved = JSON.parse(saved);
      if (saved == null) {
        state = { schemaVersion: 2, installId: opaqueId('ins'), migrationId: opaqueId('mig'),
          boundUserId: null, nextOperationSequence: 1, activeOwnerId: null, localOwnerId: null,
          activationSequence: 0, activeEnvironmentId: null, localEnvironmentId: null,
          authorityMode: 'legacy-local', scopes: { guest: emptyScope(null, 0) }, legacyBackup: null };
      } else state = normalize(saved.schemaVersion === 1 ? upgrade(saved) : saved);
    } catch (error) {}
    this.blocked = !state;
    this.state = state || { schemaVersion: 2, installId: saved && saved.installId || null,
      migrationId: saved && saved.migrationId || null, boundUserId: saved && saved.boundUserId || '__invalid_binding__',
      nextOperationSequence: null, activeOwnerId: null, localOwnerId: null, activationSequence: 0,
      activeEnvironmentId: null, localEnvironmentId: null,
      authorityMode: saved && saved.schemaVersion === 1 ? 'legacy-local' : 'migration-freeze',
      scopes: { guest: emptyScope(null, 0) } };
    this.installAliases();
    this.persisted = this.save();
  }

  installAliases() {
    freeze(this.state.scopes);
    if (this.state.legacyBackup) freeze(this.state.legacyBackup);
    // Read-only compatibility projections, not duplicate persisted authority.
    ['pendingOperations', 'snapshotRequired', 'lastSyncAt', 'lastError', 'serverRevision'].forEach(key => {
      Object.defineProperty(this.state, key, { configurable: true, get: () => {
        const scope = this.currentScope();
        return key === 'serverRevision' ? scope.revisions.progress : scope[key];
      } });
    });
  }

  currentScope() { return this.scopeFor(this.state.activeOwnerId, this.state.activeEnvironmentId); }
  scopeFor(ownerId, env) {
    if (!validOwner(ownerId) || !validEnvironment(environment(env))) return null;
    const scope = this.state.scopes[scopeKey(ownerId, env)];
    return scope ? clone(scope) : null;
  }
  context() {
    const scope = this.currentScope();
    return { ownerId: scope.ownerId, bindingEpoch: scope.bindingEpoch, activationSequence: this.state.activationSequence,
      environmentId: environment(this.state.activeEnvironmentId) };
  }
  matches(token) {
    const current = this.context();
    return !this.blocked && !!token && token.ownerId === current.ownerId && token.bindingEpoch === current.bindingEpoch &&
      token.activationSequence === current.activationSequence && environment(token.environmentId) === current.environmentId;
  }
  ownsLocalState() { return !this.blocked && this.state.localOwnerId === this.state.activeOwnerId &&
    environment(this.state.localEnvironmentId) === environment(this.state.activeEnvironmentId); }
  isReadOnlyIdentityScope() { return !this.blocked && this.currentScope().readOnlyPhase === true; }
  allowsLocalGameplay() { return this.ownsLocalState() || (this.isReadOnlyIdentityScope() && this.state.authorityMode === 'legacy-local'); }
  localContext() {
    const scope = this.scopeFor(this.state.localOwnerId, this.state.localEnvironmentId);
    return { ownerId: scope.ownerId, bindingEpoch: scope.bindingEpoch, environmentId: environment(this.state.localEnvironmentId),
      activationSequence: this.state.activationSequence };
  }
  matchesLocal(token) {
    const local = this.localContext();
    return this.allowsLocalGameplay() && token && Object.keys(local).every(key => environment(local[key]) === environment(token[key]));
  }
  onScopeChanged(listener) {
    if (typeof listener !== 'function') return function () {};
    this.scopeListeners.push(listener);
    return () => { this.scopeListeners = this.scopeListeners.filter(item => item !== listener); };
  }

  save() {
    if (this.blocked) return false;
    try { return this.platform.setStorage(STORAGE_KEY, clone(this.state)) === true; } catch (error) { return false; }
  }
  commit(candidate) {
    if (this.blocked) return false;
    const previous = this.context();
    try { if (this.platform.setStorage(STORAGE_KEY, clone(candidate)) !== true) return false; } catch (error) { return false; }
    this.state = candidate; this.installAliases(); this.persisted = true;
    if (!this.matches(previous)) this.scopeListeners.slice().forEach(listener => { try { listener(this.context()); } catch (error) {} });
    return true;
  }
  activateScope(ownerId, bindingEpoch, environmentId, readOnlyPhase) {
    const env = environment(environmentId);
    if (!validOwner(ownerId) || !validEpoch(ownerId, bindingEpoch)) return { ok: false, reason: 'invalid-owner' };
    if (!validEnvironment(env) || (env !== null && !String(ownerId).startsWith('player_')) ||
        (readOnlyPhase && env === null)) return { ok: false, reason: 'invalid-environment' };
    if (this.blocked) return { ok: false, reason: 'storage-blocked' };
    const prior = this.scopeFor(ownerId, env);
    if (prior && bindingEpoch < prior.bindingEpoch) return { ok: false, reason: 'account-mismatch' };
    if (ownerId === this.state.activeOwnerId && env === environment(this.state.activeEnvironmentId) && prior.bindingEpoch === bindingEpoch &&
        (!readOnlyPhase || prior.readOnlyPhase === true)) return { ok: true };
    if (!integer(this.state.activationSequence + 1)) return { ok: false, reason: 'sequence-exhausted' };
    const candidate = clone(this.state);
    const scope = Object.assign(prior || emptyScope(ownerId, bindingEpoch), { bindingEpoch });
    if (env !== null) scope.environmentId = env;
    if (readOnlyPhase === true) scope.readOnlyPhase = true;
    candidate.scopes[scopeKey(ownerId, env)] = scope;
    candidate.activeEnvironmentId = env;
    candidate.activeOwnerId = ownerId; candidate.activationSequence++;
    return this.commit(candidate) ? { ok: true } : { ok: false, reason: 'persist-failed' };
  }

  bindLegacyUser(userId) {
    const ownerId = legacyOwnerId(userId);
    if (!ownerId || this.blocked || this.state.activeEnvironmentId || this.state.localEnvironmentId ||
        this.state.authorityMode !== 'legacy-local' || (this.state.boundUserId && this.state.boundUserId !== userId) ||
        (this.state.localOwnerId !== null && this.state.localOwnerId !== ownerId) ||
        (this.state.activeOwnerId !== null && this.state.activeOwnerId !== ownerId)) return false;
    if (this.state.boundUserId === userId && this.state.activeOwnerId === ownerId) return true;
    if (!integer(this.state.activationSequence + 1)) return false;
    const candidate = clone(this.state);
    candidate.boundUserId = userId; candidate.localOwnerId = ownerId; candidate.activeOwnerId = ownerId;
    candidate.activationSequence++;
    if (!candidate.scopes[ownerId]) candidate.scopes[ownerId] = emptyScope(ownerId, 0);
    // Existing HTTP snapshot bootstrap stays compatible, but guest operations
    // remain in guest. Never relabel their immutable creation identity.
    return this.commit(candidate);
  }

  nextId(prefix) {
    const sequence = this.state.nextOperationSequence;
    if (!integer(sequence) || sequence < 1 || !integer(sequence + 1)) return null;
    if (Object.values(this.state.scopes).some(scope => scope.pendingOperations.some(item =>
      item.operationId.startsWith(`${this.state.installId}:`) &&
      Number(item.operationId.slice(this.state.installId.length + 1)) >= sequence))) return null;
    const candidate = clone(this.state); candidate.nextOperationSequence++;
    // Never expose a reusable sequence when durable storage is unavailable.
    if (!this.commit(candidate)) return null;
    return `${prefix || ''}${this.state.installId}:${sequence}`;
  }

  enqueue(payload) {
    return this.enqueueOperation({ domain: 'progress', type: 'level_completed', payload,
      occurredAtClient: payload && payload.completedAtClient }).ok;
  }
  enqueueLocal(payload) {
    return this.enqueueOperation({ domain: 'progress', type: 'level_completed', payload,
      occurredAtClient: payload && payload.completedAtClient }, true).ok;
  }
  enqueueOperation(input, local) {
    if (this.blocked) return { ok: false, reason: 'storage-blocked' };
    if (local && !this.allowsLocalGameplay()) return { ok: false, reason: 'account-mismatch' };
    const token = local ? this.localContext() : this.context(); let payload; let hash;
    if (!record(input)) return { ok: false, reason: 'invalid-operation' };
    if ((Object.prototype.hasOwnProperty.call(input, 'ownerIdAtCreation') && input.ownerIdAtCreation !== token.ownerId) ||
        (input.bindingEpochAtCreation !== undefined && input.bindingEpochAtCreation !== token.bindingEpoch) ||
        (input.environmentIdAtCreation !== undefined && input.environmentIdAtCreation !== token.environmentId)) return { ok: false, reason: 'account-mismatch' };
    try { payload = clone(input.payload); hash = fingerprint(payload); } catch (error) { return { ok: false, reason: 'invalid-operation' }; }
    if (input.operationId !== undefined) {
      let existing;
      Object.values(this.state.scopes).some(scope => {
        existing = scope.pendingOperations.find(item => item.operationId === input.operationId);
        return !!existing;
      });
      if (!existing) return { ok: false, reason: 'unknown-operation' };
      if (existing.ownerIdAtCreation !== token.ownerId || existing.bindingEpochAtCreation !== token.bindingEpoch ||
          environment(existing.environmentIdAtCreation) !== token.environmentId) return { ok: false, reason: 'account-mismatch' };
      const same = existing.domain === input.domain && existing.type === input.type && existing.occurredAtClient === input.occurredAtClient &&
        existing.payloadHash === hash && canonical(existing.payload) === canonical(payload);
      return same ? { ok: true, operationId: existing.operationId, alreadyQueued: true } : { ok: false, reason: 'idempotency-conflict' };
    }
    const candidateOperation = { operationId: 'validation', domain: input.domain, type: input.type, payload, payloadHash: hash,
      occurredAtClient: input.occurredAtClient, ownerIdAtCreation: token.ownerId, bindingEpochAtCreation: token.bindingEpoch };
    if (token.environmentId !== null) candidateOperation.environmentIdAtCreation = token.environmentId;
    if (!operation(candidateOperation, token.ownerId, token.bindingEpoch, token.environmentId)) return { ok: false, reason: 'invalid-operation' };
    if (this.scopeFor(token.ownerId, token.environmentId).pendingOperations.length >= MAX_OPERATIONS) {
      this.updateScope({ snapshotRequired: true }, token, undefined, local);
      return { ok: false, reason: 'pending-limit' };
    }
    const id = this.nextId('');
    if (!id) return { ok: false, reason: 'persist-failed' };
    candidateOperation.operationId = id;
    const candidate = clone(this.state);
    candidate.scopes[scopeKey(token.ownerId, token.environmentId)].pendingOperations.push(candidateOperation);
    if (!this.commit(candidate)) { this.updateScope({ snapshotRequired: true }, token, undefined, local); return { ok: false, reason: 'persist-failed' }; }
    return { ok: true, operationId: id };
  }

  updateScope(update, token, ids, local) {
    if (local ? !this.matchesLocal(token) || ids !== undefined : !this.matches(token)) return false;
    const scope = this.scopeFor(token.ownerId, token.environmentId);
    if (!record(update)) return false;
    const has = key => Object.prototype.hasOwnProperty.call(update, key);
    if ((has('snapshotRequired') && typeof update.snapshotRequired !== 'boolean') ||
        (has('lastSyncAt') && !integer(update.lastSyncAt)) ||
        (has('lastError') && update.lastError !== null && !validId(update.lastError))) return false;
    if (has('revisions') && (!validRevisions(update.revisions) || DOMAINS.some(key => update.revisions[key] < scope.revisions[key]))) return false;
    if (Object.keys(update).some(key => !['revisions', 'snapshotRequired', 'lastSyncAt', 'lastError'].includes(key))) return false;
    const accepted = new Set(Array.isArray(ids) ? ids : []);
    if (scope.pendingOperations.some(item => accepted.has(item.operationId) &&
        (item.ownerIdAtCreation !== token.ownerId || item.bindingEpochAtCreation !== token.bindingEpoch))) return false;
    const candidate = clone(this.state);
    candidate.scopes[scopeKey(token.ownerId, token.environmentId)] = Object.assign(scope, update, {
      pendingOperations: scope.pendingOperations.filter(item => !accepted.has(item.operationId)) });
    return this.commit(candidate);
  }
  acknowledge(ids, token) { return this.updateScope({}, token || this.context(), ids); }
  setAuthorityMode(mode, token) {
    if (!MODES.includes(mode) || !this.matches(token) || !this.ownsLocalState() ||
        (this.state.authorityMode !== 'legacy-local' && mode === 'legacy-local')) return false;
    if (this.state.authorityMode === mode) return true;
    const candidate = clone(this.state); candidate.authorityMode = mode;
    return this.commit(candidate);
  }
  prepareMigration(input, token) {
    if (!this.matches(token) || !this.ownsLocalState()) return { ok: false, reason: 'account-mismatch' };
    if (!input || input.policyVersion !== 'LEGACY_PRIMARY_SNAPSHOT_V1' || typeof input.snapshotHash !== 'string' ||
        !/^local-fnv1a32:[a-f0-9]{8}:\d+$/.test(input.snapshotHash)) return { ok: false, reason: 'invalid-snapshot' };
    const existing = this.currentScope().migration;
    if (existing) return existing.snapshotHash === input.snapshotHash
      ? { ok: true, migration: existing, alreadyPrepared: true } : { ok: false, reason: 'snapshot-changed' };
    if (this.state.authorityMode !== 'legacy-local') return { ok: false, reason: 'authority-mismatch' };
    const importId = this.nextId('import_');
    if (!importId) return { ok: false, reason: 'persist-failed' };
    const candidate = clone(this.state);
    const migration = { state: 'prepared', importId, snapshotHash: input.snapshotHash, policyVersion: input.policyVersion };
    candidate.scopes[scopeKey(token.ownerId, token.environmentId)].migration = migration;
    candidate.authorityMode = 'migration-freeze';
    return this.commit(candidate) ? { ok: true, migration: clone(migration) } : { ok: false, reason: 'persist-failed' };
  }

  beginApplication(receipt, token) {
    if (!this.matches(token) || !this.ownsLocalState()) return { ok: false, reason: 'account-mismatch' };
    const scope = this.currentScope();
    const prior = scope.pendingApplication || scope.lastApplication;
    if (prior && prior.receiptId === receipt.receiptId) {
      if (prior.fingerprint !== receipt.fingerprint) return { ok: false, reason: 'idempotency-conflict' };
      return { ok: true, alreadyApplied: !scope.pendingApplication };
    }
    if (scope.pendingApplication) return { ok: false, reason: 'application-pending' };
    if (!validId(receipt.receiptId) || typeof receipt.fingerprint !== 'string') return { ok: false, reason: 'invalid-receipt' };
    const candidate = clone(this.state);
    candidate.scopes[scopeKey(token.ownerId, token.environmentId)].pendingApplication = clone(receipt);
    // Persist the recovery gate BEFORE any domain write. A crash cannot
    // restart in legacy-local and award money from partially applied progress.
    candidate.authorityMode = 'cloud-authoritative';
    return this.commit(candidate) ? { ok: true } : { ok: false, reason: 'persist-failed' };
  }

  finishApplication(receipt, nextRevisions, ids, token) {
    if (!this.matches(token) || !this.ownsLocalState() || !validRevisions(nextRevisions)) return false;
    const scope = this.currentScope();
    if (!scope.pendingApplication || scope.pendingApplication.receiptId !== receipt.receiptId ||
        scope.pendingApplication.fingerprint !== receipt.fingerprint ||
        DOMAINS.some(key => nextRevisions[key] < scope.revisions[key])) return false;
    const accepted = new Set(ids);
    if (scope.pendingOperations.some(item => accepted.has(item.operationId) && item.bindingEpochAtCreation !== token.bindingEpoch)) return false;
    const candidate = clone(this.state);
    candidate.scopes[scopeKey(token.ownerId, token.environmentId)] = Object.assign(scope, { revisions: clone(nextRevisions),
      pendingOperations: scope.pendingOperations.filter(item => !accepted.has(item.operationId)),
      pendingApplication: null, lastApplication: clone(receipt) });
    return this.commit(candidate);
  }

  recordReadOnlySummary(input, token) {
    if (!this.matches(token) || !this.isReadOnlyIdentityScope() || !record(input) || !integer(input.serverTimeMs) ||
        typeof input.serverDateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.serverDateKey) ||
        !validRevisions(input.revisions) || DOMAINS.some(key => input.revisions[key] !== 0)) return false;
    const candidate = clone(this.state);
    candidate.scopes[scopeKey(token.ownerId, token.environmentId)].readOnlySummary = {
      lastReadAt: Date.now(), serverTimeMs: input.serverTimeMs, serverDateKey: input.serverDateKey, revisions: clone(input.revisions)
    };
    return this.commit(candidate);
  }
}

SyncStore.STORAGE_KEY = STORAGE_KEY;
SyncStore.opaqueId = opaqueId;
SyncStore.legacyOwnerId = legacyOwnerId;
SyncStore.DOMAINS = DOMAINS;
module.exports = SyncStore;
