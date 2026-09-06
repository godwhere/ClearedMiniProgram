'use strict';

const { record, validId, canonical, fingerprint, clone, freeze } = require('./sync-payload.js');
const staminaDomain = require('./sync-domains/stamina-domain.js');
const preferencesDomain = require('./sync-domains/preferences-domain.js');
const STORAGE_KEY = 'cleared:minigame:online:v1';
const MIGRATION_ARCHIVE_KEY = 'cleared:minigame:migration-archives:v1';
const MAX_MIGRATION_ARCHIVES = 4;
const MAX_OPERATIONS = 200;
const opaqueId = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
const DOMAINS = ['progress', 'daily', 'economy', 'entitlements', 'stamina', 'preferences'];
const MODES = ['legacy-local', 'migration-freeze', 'cloud-authoritative'];
const CORE_DOMAINS = ['progress', 'daily', 'economy', 'entitlements'];
const domainAuthority = mode => DOMAINS.reduce((result, domain) => {
  result[domain] = CORE_DOMAINS.includes(domain) ? mode : 'legacy-local'; return result;
}, {});
const legacyGlobalAuthority = mode => DOMAINS.reduce((result, domain) => {
  result[domain] = mode; return result;
}, {});
const nextCoreAuthority = (mode, current) => DOMAINS.reduce((result, domain) => {
  result[domain] = CORE_DOMAINS.includes(domain) ? mode : current[domain]; return result;
}, {});
const withCloudDomains = (current, domains) => DOMAINS.reduce((result, domain) => {
  result[domain] = (domains || []).includes(domain) ? 'cloud-authoritative' : current[domain]; return result;
}, {});
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
const validRecoveryOptions = value => record(value) && Object.keys(value).every(key =>
  ['adoptLocal', 'migration', 'importId', 'migrationReceiptId', 'expectedOperationIds', 'cloudDomains'].includes(key)) &&
  (value.adoptLocal === undefined || typeof value.adoptLocal === 'boolean') &&
  (value.migration === undefined || typeof value.migration === 'boolean') &&
  (value.importId === undefined || validId(value.importId)) &&
  (value.migrationReceiptId === undefined || validId(value.migrationReceiptId)) &&
  (value.expectedOperationIds === undefined || (Array.isArray(value.expectedOperationIds) &&
    value.expectedOperationIds.every(validId) && new Set(value.expectedOperationIds).size === value.expectedOperationIds.length)) &&
  (value.cloudDomains === undefined || (Array.isArray(value.cloudDomains) &&
    value.cloudDomains.every(domain => ['stamina', 'preferences'].includes(domain)) &&
    new Set(value.cloudDomains).size === value.cloudDomains.length));
const validRecovery = value => record(value) && Object.keys(value).length === 3 && value.schemaVersion === 1 &&
  record(value.response) && validRecoveryOptions(value.options);
const validApplicationReceipt = (value, pending) => {
  if (value === null) return true;
  if (!record(value) || !validId(value.receiptId) || typeof value.fingerprint !== 'string' ||
      !/^local-fnv1a32:[a-f0-9]{8}:\d+$/.test(value.fingerprint)) return false;
  const keys = Object.keys(value);
  if (!pending) return keys.length === 2;
  return (keys.length === 2 || (keys.length === 3 && validRecovery(value.recovery)));
};
const emptyScope = (ownerId, bindingEpoch) => ({ ownerId, bindingEpoch, revisions: revisions(),
  pendingOperations: [], snapshotRequired: false, lastSyncAt: 0, lastError: null, migration: null,
  pendingApplication: null, lastApplication: null, quarantinedOperations: [] });

function normalizeMigrationArchive(saved) {
  if (saved == null) return { schemaVersion: 1, imports: {} };
  if (typeof saved === 'string') saved = JSON.parse(saved);
  if (!record(saved) || Object.keys(saved).length !== 2 || saved.schemaVersion !== 1 || !record(saved.imports) ||
      Object.keys(saved.imports).length > MAX_MIGRATION_ARCHIVES) return null;
  const imports = {};
  for (const importId of Object.keys(saved.imports)) {
    const item = saved.imports[importId];
    if (!validId(importId) || !record(item) || Object.keys(item).length !== 2 ||
        typeof item.snapshotHash !== 'string' || !/^local-fnv1a32:[a-f0-9]{8}:\d+$/.test(item.snapshotHash) ||
        !record(item.snapshot) || fingerprint(item.snapshot) !== item.snapshotHash) return null;
    imports[importId] = { snapshotHash: item.snapshotHash, snapshot: clone(item.snapshot) };
  }
  return { schemaVersion: 1, imports };
}

function validProgress(payload) {
  return record(payload) && typeof payload.levelKey === 'string' && /^(0|[1-9]\d*):(0|[1-9]\d*)$/.test(payload.levelKey) &&
    integer(payload.completedAtClient) && (payload.elapsedMs === undefined || (Number.isFinite(payload.elapsedMs) && payload.elapsedMs > 0));
}

function validStage4Progress(type, payload) {
  if (type === 'MAIN_LEVEL_COMPLETED') return record(payload) &&
    typeof payload.levelKey === 'string' && /^(0|[1-9]\d*):(0|[1-9]\d*)$/.test(payload.levelKey) &&
    Number.isSafeInteger(payload.elapsedMs) && payload.elapsedMs > 0;
  return type === 'PROGRESS_LAST_PLAYED' && record(payload) &&
    Number.isSafeInteger(payload.setIndex) && payload.setIndex >= 0 &&
    Number.isSafeInteger(payload.levelIndex) && payload.levelIndex >= 0;
}

function validDaily(type, payload) {
  if (!record(payload) || typeof payload.dateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(payload.dateKey) ||
      !validId(payload.dayId) || !Array.isArray(payload.levelIds) || payload.levelIds.length !== 2 ||
      payload.levelIds[0] === payload.levelIds[1] || !payload.levelIds.every(validId)) return false;
  if (type === 'DAILY_ENTRY_RECORDED') return validId(payload.entryKey) && payload.entryLimit === 3;
  return type === 'DAILY_LEVEL_COMPLETED' && validId(payload.levelId) && [0, 1].includes(payload.levelIndex) &&
    payload.levelCount === 2 && payload.levelId === payload.levelIds[payload.levelIndex] &&
    Number.isSafeInteger(payload.elapsedMs) && payload.elapsedMs > 0 && integer(payload.completedAtClient);
}

function validStage5(type, domain, payload) {
  return domain === 'stamina' ? staminaDomain.valid(type, payload)
    : domain === 'preferences' && preferencesDomain.valid(type, payload);
}

function operation(input, ownerId, bindingEpoch, env = null) {
  if (!record(input) || !validId(input.operationId) || !DOMAINS.includes(input.domain) ||
      typeof input.type !== 'string' || !/^[A-Za-z0-9_:-]{1,80}$/.test(input.type) ||
      !record(input.payload) || !integer(input.occurredAtClient) ||
      input.ownerIdAtCreation !== ownerId || environment(input.environmentIdAtCreation) !== env || !validEpoch(ownerId, input.bindingEpochAtCreation) ||
      input.bindingEpochAtCreation > bindingEpoch ||
      !['progress', 'daily', 'entitlements', 'stamina', 'preferences'].includes(input.domain) ||
      (input.domain === 'progress' && !((input.type === 'level_completed' && validProgress(input.payload)) ||
        validStage4Progress(input.type, input.payload))) ||
      (input.domain === 'daily' && !validDaily(input.type, input.payload)) ||
      (input.domain === 'entitlements' && (input.type !== 'CLIENT_POLICY_SHARE_GRANTED' ||
        !record(input.payload) || input.payload.rewardId !== 'theme:festival')) ||
      (['stamina', 'preferences'].includes(input.domain) && !validStage5(input.type, input.domain, input.payload))) return null;
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
    authorityMode: 'legacy-local', domainAuthority: domainAuthority('legacy-local'), scopes: { [scopeKey(ownerId)]: scope },
    // Immutable recovery evidence only, never a sendable queue or live state.
    legacyBackup: clone(saved) };
}

function normalize(saved) {
  if (record(saved) && saved.schemaVersion === 2 && !saved.domainAuthority &&
      ['legacy-local', 'cloud-authoritative'].includes(saved.authorityMode)) {
    // A historical global cloud-authoritative value cannot be silently
    // downgraded. It remains fail-closed for deferred domains until a later
    // product phase supplies their cloud implementations.
    saved = Object.assign({}, saved, { domainAuthority: saved.authorityMode === 'cloud-authoritative'
      ? legacyGlobalAuthority('cloud-authoritative') : domainAuthority('legacy-local') });
  }
  if (!record(saved) || saved.schemaVersion !== 2 || !validId(saved.installId) || !validId(saved.migrationId) ||
      !validOwner(saved.activeOwnerId) || !validOwner(saved.localOwnerId) || !integer(saved.activationSequence) ||
      !MODES.includes(saved.authorityMode) || !record(saved.domainAuthority) ||
      Object.keys(saved.domainAuthority).length !== DOMAINS.length ||
      DOMAINS.some(domain => !MODES.includes(saved.domainAuthority[domain])) ||
      CORE_DOMAINS.some(domain => saved.domainAuthority[domain] !== saved.authorityMode) ||
      (saved.authorityMode !== 'cloud-authoritative' &&
        (saved.domainAuthority['stamina'] !== 'legacy-local' || saved.domainAuthority.preferences !== 'legacy-local')) ||
      (saved.authorityMode === 'cloud-authoritative' &&
        [saved.domainAuthority['stamina'], saved.domainAuthority.preferences].some(mode =>
          !['legacy-local', 'cloud-authoritative'].includes(mode))) || !record(saved.scopes) ||
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
      scope = Object.assign({}, scope, { pendingApplication: null, lastApplication: null, quarantinedOperations: [] });
    }
    if (record(scope) && !Object.prototype.hasOwnProperty.call(scope, 'quarantinedOperations')) {
      scope = Object.assign({}, scope, { quarantinedOperations: [] });
    }
    const env = scope && environment(scope.environmentId);
    if (!record(scope) || !validOwner(scope.ownerId) || !validEnvironment(env) ||
        (env !== null && !String(scope.ownerId).startsWith('player_')) || key !== scopeKey(scope.ownerId, env) ||
        !validEpoch(scope.ownerId, scope.bindingEpoch) || !validRevisions(scope.revisions) ||
        !Array.isArray(scope.pendingOperations) || !integer(scope.lastSyncAt) ||
        typeof scope.snapshotRequired !== 'boolean' || (scope.lastError !== null && !validId(scope.lastError)) ||
        !Array.isArray(scope.quarantinedOperations) || scope.quarantinedOperations.length > 50) return null;
    if (scope.quarantinedOperations.some(item => !record(item) || Object.keys(item).length !== 3 ||
        !validId(item.operationId) || !validId(item.code) || !integer(item.quarantinedAt))) return null;
    const pending = [];
    for (const input of scope.pendingOperations) {
      const item = operation(input, scope.ownerId, scope.bindingEpoch, env);
      if (!item || ids.has(item.operationId)) return null;
      ids.add(item.operationId); pending.push(item);
    }
    const migration = scope.migration;
    if (migration !== null && (!record(migration) || !['prepared', 'uploading', 'finalized'].includes(migration.state) ||
        !validId(migration.importId) || typeof migration.snapshotHash !== 'string' ||
        !/^local-fnv1a32:[a-f0-9]{8}:\d+$/.test(migration.snapshotHash) || migration.policyVersion !== 'LEGACY_PRIMARY_SNAPSHOT_V1' ||
        (migration.prepareReceiptId !== undefined && !validId(migration.prepareReceiptId)) ||
        (migration.role !== undefined && !['PRIMARY', 'SUPPLEMENTAL'].includes(migration.role)) ||
        (Object.prototype.hasOwnProperty.call(migration, 'sourceOwnerId') !==
          Object.prototype.hasOwnProperty.call(migration, 'sourceEnvironmentId')) ||
        (Object.prototype.hasOwnProperty.call(migration, 'sourceOwnerId') &&
          (!validOwner(migration.sourceOwnerId) || !validEnvironment(environment(migration.sourceEnvironmentId)))) ||
        (migration.finalizedReceiptId !== undefined && !validId(migration.finalizedReceiptId)) ||
        (migration.requiredChunks !== undefined && (!Array.isArray(migration.requiredChunks) || !migration.requiredChunks.every(validId))) ||
        (migration.completedChunks !== undefined && (!Array.isArray(migration.completedChunks) || !migration.completedChunks.every(validId))))) return null;
    const hasSealed = Object.prototype.hasOwnProperty.call(scope, 'sealed');
    if (hasSealed && (scope.sealed !== true || !integer(scope.sealedAt) ||
        !validId(scope.supersededByMigrationReceipt) ||
        (scope.supersededByImportId !== undefined && !validId(scope.supersededByImportId)))) return null;
    if (!validApplicationReceipt(scope.pendingApplication, true) ||
        !validApplicationReceipt(scope.lastApplication, false)) return null;
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
          authorityMode: 'legacy-local', domainAuthority: domainAuthority('legacy-local'), scopes: { guest: emptyScope(null, 0) }, legacyBackup: null };
      } else state = normalize(saved.schemaVersion === 1 ? upgrade(saved) : saved);
    } catch (error) {}
    this.blocked = !state;
    this.state = state || { schemaVersion: 2, installId: saved && saved.installId || null,
      migrationId: saved && saved.migrationId || null, boundUserId: saved && saved.boundUserId || '__invalid_binding__',
      nextOperationSequence: null, activeOwnerId: null, localOwnerId: null, activationSequence: 0,
      activeEnvironmentId: null, localEnvironmentId: null,
      authorityMode: saved && saved.schemaVersion === 1 ? 'legacy-local' : 'migration-freeze',
      domainAuthority: domainAuthority(saved && saved.schemaVersion === 1 ? 'legacy-local' : 'migration-freeze'),
      scopes: { guest: emptyScope(null, 0) } };
    let archive;
    try {
      let stored;
      if (typeof platform.readStorageResult === 'function') {
        const read = platform.readStorageResult(MIGRATION_ARCHIVE_KEY);
        if (!read || !read.ok || (read.found !== true && read.found !== false)) throw Error('archive-read-failed');
        stored = read.found ? read.value : null;
      } else stored = platform.getStorage(MIGRATION_ARCHIVE_KEY);
      archive = normalizeMigrationArchive(stored);
    } catch (error) {}
    this.archiveBlocked = !archive;
    this.migrationArchive = archive || { schemaVersion: 1, imports: {} };
    this.inFlightOperationIds = new Set();
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
  authorityMode(domain) { return this.state.domainAuthority[domain || 'progress']; }
  authorityModes() { return clone(this.state.domainAuthority); }
  allowsLocalGameplay() { return this.ownsLocalState() || (this.isReadOnlyIdentityScope() && this.authorityMode('progress') === 'legacy-local'); }
  localContext() {
    const scope = this.scopeFor(this.state.localOwnerId, this.state.localEnvironmentId);
    return { ownerId: scope.ownerId, bindingEpoch: scope.bindingEpoch, environmentId: environment(this.state.localEnvironmentId),
      activationSequence: this.state.activationSequence };
  }
  matchesLocal(token) {
    const local = this.localContext();
    return this.allowsLocalGameplay() && token && Object.keys(local).every(key => environment(local[key]) === environment(token[key]));
  }
  markOperationsInFlight(operationIds, token) {
    if (!this.matches(token) || !Array.isArray(operationIds) || !operationIds.length ||
        operationIds.some(id => !validId(id)) || new Set(operationIds).size !== operationIds.length) return false;
    const pending = new Set(this.currentScope().pendingOperations.map(item => item.operationId));
    if (operationIds.some(id => !pending.has(id) || this.inFlightOperationIds.has(id))) return false;
    operationIds.forEach(id => this.inFlightOperationIds.add(id));
    return true;
  }
  clearOperationsInFlight(operationIds) {
    if (!Array.isArray(operationIds)) return;
    operationIds.forEach(id => this.inFlightOperationIds.delete(id));
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
  archiveMigrationSnapshot(importId, snapshotHash, snapshot) {
    if (this.archiveBlocked || !validId(importId) || typeof snapshotHash !== 'string' ||
        !/^local-fnv1a32:[a-f0-9]{8}:\d+$/.test(snapshotHash) || !record(snapshot)) {
      return { ok: false, reason: this.archiveBlocked ? 'storage-blocked' : 'invalid-migration' };
    }
    let frozen;
    try {
      frozen = clone(snapshot);
      if (fingerprint(frozen) !== snapshotHash) return { ok: false, reason: 'snapshot-changed' };
    } catch (error) { return { ok: false, reason: 'invalid-migration' }; }
    const existing = this.migrationArchive.imports[importId];
    if (existing) return existing.snapshotHash === snapshotHash && canonical(existing.snapshot) === canonical(frozen)
      ? { ok: true, alreadyArchived: true } : { ok: false, reason: 'migration-conflict' };
    if (Object.keys(this.migrationArchive.imports).length >= MAX_MIGRATION_ARCHIVES) {
      return { ok: false, reason: 'migration-archive-full' };
    }
    const candidate = clone(this.migrationArchive);
    candidate.imports[importId] = { snapshotHash, snapshot: frozen };
    try {
      if (this.platform.setStorage(MIGRATION_ARCHIVE_KEY, candidate) !== true) return { ok: false, reason: 'persist-failed' };
    } catch (error) { return { ok: false, reason: 'persist-failed' }; }
    this.migrationArchive = candidate;
    return { ok: true };
  }
  migrationSnapshot(importId, snapshotHash) {
    if (this.archiveBlocked || !validId(importId)) return null;
    const value = this.migrationArchive.imports[importId];
    if (!value || value.snapshotHash !== snapshotHash) return null;
    try { return freeze(clone(value.snapshot)); } catch (error) { return null; }
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
    const target = candidate.scopes[scopeKey(token.ownerId, token.environmentId)];
    if (candidateOperation.domain === 'progress' && candidateOperation.type === 'PROGRESS_LAST_PLAYED') {
      // Coalesce only unsent local intent and keep the newly allocated ID.
      // An older in-flight ID may still be ACKed safely by server-side LWW.
      target.pendingOperations = target.pendingOperations.filter(item =>
        item.domain !== 'progress' || item.type !== 'PROGRESS_LAST_PLAYED' ||
          this.inFlightOperationIds.has(item.operationId));
    }
    target.pendingOperations.push(candidateOperation);
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
    candidate.domainAuthority = nextCoreAuthority(mode, candidate.domainAuthority);
    return this.commit(candidate);
  }
  recordServerMigration(input, token) {
    if (!this.matches(token) || !this.isReadOnlyIdentityScope() || !record(input) ||
        !validId(input.importId) || !validId(input.prepareReceiptId) ||
        !['PRIMARY', 'SUPPLEMENTAL'].includes(input.role) || input.policyVersion !== 'LEGACY_PRIMARY_SNAPSHOT_V1' ||
        typeof input.snapshotHash !== 'string' || !/^local-fnv1a32:[a-f0-9]{8}:\d+$/.test(input.snapshotHash) ||
        !Array.isArray(input.requiredChunks) || !input.requiredChunks.every(validId) || !record(input.snapshot) ||
        !Array.isArray(input.completedChunks) || !input.completedChunks.every(validId)) return { ok: false, reason: 'invalid-migration' };
    const existing = this.currentScope().migration;
    if (existing) {
      if (existing.importId !== input.importId || existing.snapshotHash !== input.snapshotHash ||
          existing.prepareReceiptId !== input.prepareReceiptId) return { ok: false, reason: 'migration-conflict' };
      const archived = this.archiveMigrationSnapshot(input.importId, input.snapshotHash, input.snapshot);
      return archived.ok ? { ok: true, migration: existing, alreadyPrepared: true } : archived;
    }
    const archived = this.archiveMigrationSnapshot(input.importId, input.snapshotHash, input.snapshot);
    if (!archived.ok) return archived;
    if (this.authorityMode('progress') !== 'legacy-local') return { ok: false, reason: 'authority-mismatch' };
    const candidate = clone(this.state);
    const migration = { state: 'prepared', importId: input.importId, snapshotHash: input.snapshotHash,
      policyVersion: input.policyVersion, prepareReceiptId: input.prepareReceiptId, role: input.role,
      requiredChunks: input.requiredChunks.slice(), completedChunks: input.completedChunks.slice(),
      sourceOwnerId: candidate.localOwnerId, sourceEnvironmentId: environment(candidate.localEnvironmentId) };
    candidate.scopes[scopeKey(token.ownerId, token.environmentId)].migration = migration;
    candidate.authorityMode = 'migration-freeze'; candidate.domainAuthority = domainAuthority('migration-freeze');
    return this.commit(candidate) ? { ok: true, migration: clone(migration) } : { ok: false, reason: 'persist-failed' };
  }
  markMigrationChunks(completedChunks, token) {
    if (!this.matches(token) || !Array.isArray(completedChunks) || !completedChunks.every(validId)) return false;
    const scope = this.currentScope();
    if (!scope.migration || completedChunks.some(id => !scope.migration.requiredChunks.includes(id))) return false;
    const candidate = clone(this.state); const migration = candidate.scopes[scopeKey(token.ownerId, token.environmentId)].migration;
    migration.state = 'uploading';
    migration.completedChunks = Array.from(new Set(migration.completedChunks.concat(completedChunks))).sort();
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
    candidate.authorityMode = 'migration-freeze'; candidate.domainAuthority = domainAuthority('migration-freeze');
    return this.commit(candidate) ? { ok: true, migration: clone(migration) } : { ok: false, reason: 'persist-failed' };
  }

  beginApplication(receipt, token, options) {
    const adopting = options && options.adoptLocal === true;
    const cloudDomains = options && Array.isArray(options.cloudDomains) ? options.cloudDomains : [];
    if (!this.matches(token) || (!this.ownsLocalState() && !adopting)) return { ok: false, reason: 'account-mismatch' };
    const scope = this.currentScope();
    const prior = scope.pendingApplication || scope.lastApplication;
    if (prior && prior.receiptId === receipt.receiptId) {
      if (prior.fingerprint !== receipt.fingerprint) return { ok: false, reason: 'idempotency-conflict' };
      return { ok: true, alreadyApplied: !scope.pendingApplication };
    }
    if (scope.pendingApplication) return { ok: false, reason: 'application-pending' };
    if (!validId(receipt.receiptId) || typeof receipt.fingerprint !== 'string') return { ok: false, reason: 'invalid-receipt' };
    const recovery = options && options.recovery;
    if (!validRecovery(recovery)) return { ok: false, reason: 'invalid-recovery' };
    const candidate = clone(this.state);
    candidate.scopes[scopeKey(token.ownerId, token.environmentId)].pendingApplication = Object.assign(clone(receipt),
      { recovery: clone(recovery) });
    // Persist the recovery gate BEFORE any domain write. A crash cannot
    // restart in legacy-local and award money from partially applied progress.
    candidate.authorityMode = 'cloud-authoritative';
    candidate.domainAuthority = withCloudDomains(
      nextCoreAuthority('cloud-authoritative', candidate.domainAuthority), cloudDomains);
    return this.commit(candidate) ? { ok: true } : { ok: false, reason: 'persist-failed' };
  }

  finishApplication(receipt, nextRevisions, ids, token, options) {
    const adopting = options && options.adoptLocal === true;
    const cloudDomains = options && Array.isArray(options.cloudDomains) ? options.cloudDomains : [];
    const migrationReceiptId = options && options.migrationReceiptId;
    const importId = options && options.importId;
    if (!this.matches(token) || (!this.ownsLocalState() && !adopting) || !validRevisions(nextRevisions)) return false;
    if (adopting && (!validId(migrationReceiptId) || (importId !== undefined && !validId(importId)))) return false;
    const scope = this.currentScope();
    if (!scope.pendingApplication || scope.pendingApplication.receiptId !== receipt.receiptId ||
        scope.pendingApplication.fingerprint !== receipt.fingerprint ||
        DOMAINS.some(key => nextRevisions[key] < scope.revisions[key])) return false;
    const accepted = new Set(ids);
    if (scope.pendingOperations.some(item => accepted.has(item.operationId) && item.bindingEpochAtCreation !== token.bindingEpoch)) return false;
    const candidate = clone(this.state);
    candidate.scopes[scopeKey(token.ownerId, token.environmentId)] = Object.assign(scope, { revisions: clone(nextRevisions),
      pendingOperations: scope.pendingOperations.filter(item => !accepted.has(item.operationId)),
      pendingApplication: null, lastApplication: { receiptId: receipt.receiptId, fingerprint: receipt.fingerprint },
      lastSyncAt: Date.now(), lastError: null });
    if (adopting) {
      const sourceKey = scopeKey(candidate.localOwnerId, candidate.localEnvironmentId);
      const targetKey = scopeKey(token.ownerId, token.environmentId);
      if (sourceKey !== targetKey) {
        const source = candidate.scopes[sourceKey];
        source.sealed = true; source.sealedAt = Date.now();
        source.supersededByMigrationReceipt = migrationReceiptId;
        if (importId !== undefined) source.supersededByImportId = importId;
      }
      candidate.localOwnerId = token.ownerId; candidate.localEnvironmentId = token.environmentId;
      const target = candidate.scopes[targetKey];
      delete target.readOnlyPhase; delete target.readOnlySummary;
      if (target.migration && (importId === undefined || target.migration.importId === importId)) {
        target.migration.state = 'finalized'; target.migration.finalizedReceiptId = migrationReceiptId;
      }
    }
    candidate.authorityMode = 'cloud-authoritative';
    candidate.domainAuthority = withCloudDomains(
      nextCoreAuthority('cloud-authoritative', candidate.domainAuthority), cloudDomains);
    return this.commit(candidate);
  }

  pendingRecovery(token) {
    if (!this.matches(token)) return null;
    const pending = this.currentScope().pendingApplication;
    return pending && validRecovery(pending.recovery) ? clone(pending.recovery) : null;
  }

  quarantineOperations(results, token) {
    if (!this.matches(token) || !Array.isArray(results)) return false;
    const rejected = results.filter(item => record(item) && validId(item.operationId) && item.status === 'REJECTED' && validId(item.code));
    if (!rejected.length) return true;
    const scope = this.currentScope(); const rejectedIds = new Set(rejected.map(item => item.operationId));
    const already = item => scope.quarantinedOperations.some(operation =>
      operation.operationId === item.operationId && operation.code === item.code);
    if (rejected.some(item => !scope.pendingOperations.some(operation => operation.operationId === item.operationId) && !already(item))) return false;
    const fresh = rejected.filter(item => !already(item));
    if (!fresh.length) return true;
    const candidate = clone(this.state); const target = candidate.scopes[scopeKey(token.ownerId, token.environmentId)];
    target.pendingOperations = target.pendingOperations.filter(item => !rejectedIds.has(item.operationId));
    target.quarantinedOperations = target.quarantinedOperations.concat(fresh.map(item => ({
      operationId: item.operationId, code: item.code, quarantinedAt: Date.now()
    }))).slice(-50);
    target.lastError = 'operation-rejected';
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
SyncStore.MIGRATION_ARCHIVE_KEY = MIGRATION_ARCHIVE_KEY;
SyncStore.opaqueId = opaqueId;
SyncStore.legacyOwnerId = legacyOwnerId;
SyncStore.DOMAINS = DOMAINS;
SyncStore.CORE_DOMAINS = CORE_DOMAINS;
module.exports = SyncStore;
