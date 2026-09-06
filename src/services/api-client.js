'use strict';

const PATHS = Object.freeze({
  auth: '/v1/auth/wechat', me: '/v1/me', profile: '/v1/me/profile',
  bootstrap: '/v1/progress/bootstrap', progress: '/v1/progress',
  operations: '/v1/progress/operations:batch', shareIntents: '/v1/share-intents',
  attributions: '/v1/share-attributions', rewards: '/v1/reward-claims',
  entitlements: '/v1/daily-entitlements/', events: '/v1/events:batch'
});
const OPERATIONS = Object.freeze({
  identity: Object.freeze({ service: 'identity', action: 'identity.init' }),
  stateRead: Object.freeze({ service: 'playerState', action: 'state.read' }),
  readOnlyState: Object.freeze({ service: 'playerState', action: 'state.read' }),
  migrationPrepare: Object.freeze({ service: 'playerState', action: 'migration.prepare' }),
  migrationStatus: Object.freeze({ service: 'playerState', action: 'migration.status' }),
  migrationCommitChunk: Object.freeze({ service: 'playerState', action: 'migration.commitChunk' }),
  migrationFinalize: Object.freeze({ service: 'playerState', action: 'migration.finalize' }),
  syncPush: Object.freeze({ service: 'playerState', action: 'sync.push' }),
  economyPurchase: Object.freeze({ service: 'economy', action: 'economy.purchase' })
});
const failure = (code, statusCode, retryable) => ({ ok: false, statusCode: statusCode || 0,
  error: { code, retryable: retryable === true } });
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const FIELDS = ['progress', 'daily', 'economy', 'entitlements', 'stamina', 'preferences'];
const CORE = ['progress', 'daily', 'economy', 'entitlements'];
const DEFERRED = ['stamina', 'preferences'];
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_:-]{1,200}$/.test(value) &&
  !['__proto__', 'constructor', 'prototype'].includes(value);
const validPlayerId = value => typeof value === 'string' && /^player_[A-Za-z0-9_-]{1,120}$/.test(value);
const validEnvironmentId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const validRevisions = value => record(value) && Object.keys(value).length === FIELDS.length &&
  FIELDS.every(key => Number.isSafeInteger(value[key]) && value[key] >= 0);
const validDomains = value => record(value) && Object.keys(value).every(key => FIELDS.includes(key) && record(value[key]));
const clone = value => JSON.parse(JSON.stringify(value));
const exactKeys = (value, keys) => record(value) && Object.keys(value).length === keys.length &&
  keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
const sameSet = (left, right) => Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
  left.slice().sort().every((value, index) => value === right.slice().sort()[index]);

function cloudEnvelope(data, env) {
  if (!record(data) || data.ok !== true || data.code !== 'OK' || data.protocolVersion !== 1 || data.retryable !== false ||
      data.environmentId !== env || !validEnvironmentId(env) || !validRevisions(data.revisions) ||
      Object.keys(data).some(key => !['ok', 'code', 'requestId', 'protocolVersion', 'retryable', 'environmentId',
        'serverTimeMs', 'serverDateKey', 'player', 'revisions', 'data', 'bindingStatus'].includes(key)) ||
      !validId(data.requestId) || !Number.isSafeInteger(data.serverTimeMs) || data.serverTimeMs < 0 ||
      data.serverTimeMs > 8640000000000000 - 28800000 ||
      new Date(data.serverTimeMs + 28800000).toISOString().slice(0, 10) !== data.serverDateKey) return false;
  const player = data.player;
  return record(player) && Object.keys(player).every(key => ['playerId', 'bindingEpoch', 'migrationState', 'hasCloudState',
    'completedDomains', 'deferredDomains', 'migrationImportId', 'migrationReceiptId'].includes(key)) && validPlayerId(player.playerId) &&
    Number.isSafeInteger(player.bindingEpoch) && player.bindingEpoch > 0 &&
    ['none', 'prepared', 'uploading', 'complete', 'blocked'].includes(player.migrationState) &&
    typeof player.hasCloudState === 'boolean' && Array.isArray(player.completedDomains) &&
    player.completedDomains.every(key => FIELDS.includes(key)) &&
    new Set(player.completedDomains).size === player.completedDomains.length && Array.isArray(player.deferredDomains) &&
    player.deferredDomains.every(key => DEFERRED.includes(key)) &&
    new Set(player.deferredDomains).size === player.deferredDomains.length &&
    (player.migrationImportId === null || validId(player.migrationImportId)) &&
    (player.migrationReceiptId === null || validId(player.migrationReceiptId)) &&
    player.hasCloudState === (player.migrationState === 'complete') &&
    (player.hasCloudState ? CORE.every(key => player.completedDomains.includes(key)) &&
      sameSet(player.completedDomains.concat(player.deferredDomains), FIELDS) &&
      !player.completedDomains.some(key => player.deferredDomains.includes(key))
      : player.completedDomains.length === 0 && sameSet(player.deferredDomains, DEFERRED)) &&
    (player.migrationState === 'complete' || FIELDS.every(key => data.revisions[key] === 0));
}

function validateCloudIdentity(data, env) {
  return cloudEnvelope(data, env) && ['UNBOUND', 'MATCHED', 'CLIENT_STALE'].includes(data.bindingStatus) && data.data === undefined;
}

function validateStateEnvelope(data, env) {
  if (!cloudEnvelope(data, env) || !record(data.data) || !record(data.data.changedDomains) ||
      typeof data.data.hasCloudState !== 'boolean' || data.data.readOnlyPhase !== false ||
      !Array.isArray(data.data.completedDomains) || !Array.isArray(data.data.deferredDomains) ||
      !sameSet(data.data.completedDomains, data.player.completedDomains) ||
      !sameSet(data.data.deferredDomains, data.player.deferredDomains) ||
      !validDomains(data.data.changedDomains)) return false;
  if (Object.prototype.hasOwnProperty.call(data.data, 'mutationAllowed') &&
      typeof data.data.mutationAllowed !== 'boolean') return false;
  const keys = Object.keys(data.data).filter(key => key !== 'mutationAllowed');
  if (!data.data.hasCloudState) return keys.length === 5 &&
    ['changedDomains', 'hasCloudState', 'readOnlyPhase', 'completedDomains', 'deferredDomains'].every(key => keys.includes(key)) &&
    data.player.migrationState !== 'complete' &&
    Object.keys(data.data.changedDomains).length === 0 && data.data.completedDomains.length === 0;
  return keys.length === 9 && ['changedDomains', 'hasCloudState', 'readOnlyPhase', 'completedDomains', 'deferredDomains',
    'migrationImportId', 'migrationReceiptId', 'receiptId', 'acceptedOperationIds'].every(key => keys.includes(key)) &&
    data.player.migrationState === 'complete' &&
    validId(data.data.receiptId) && Array.isArray(data.data.acceptedOperationIds) &&
    data.data.acceptedOperationIds.length === 0 && validId(data.data.migrationImportId) &&
    validId(data.data.migrationReceiptId);
}

// Kept as a compatibility export for phase-3 tests. It now recognizes only
// the empty phase-4 state envelope and never permits business bytes.
function validateReadOnlyEnvelope(data, env) {
  return validateStateEnvelope(data, env) && data.data.hasCloudState === false &&
    Object.keys(data.data.changedDomains).length === 0;
}

function validateMigrationEnvelope(data, env, action) {
  if (!cloudEnvelope(data, env) || !record(data.data)) return false;
  const value = data.data;
  if (action === 'migration.prepare' || action === 'migration.status') {
    return exactKeys(value, ['role', 'status', 'requiredChunks', 'completedChunks', 'acceptedDomains', 'deferredDomains',
      'economyBaselineExists', 'conflicts', 'prepareReceiptId', 'receiptId']) &&
      ['PRIMARY', 'SUPPLEMENTAL'].includes(value.role) && ['PREPARED', 'UPLOADING', 'FINALIZED'].includes(value.status) &&
      Array.isArray(value.requiredChunks) && value.requiredChunks.every(validId) && new Set(value.requiredChunks).size === value.requiredChunks.length &&
      Array.isArray(value.completedChunks) && value.completedChunks.every(validId) && new Set(value.completedChunks).size === value.completedChunks.length &&
      value.completedChunks.every(key => value.requiredChunks.includes(key)) &&
      Array.isArray(value.acceptedDomains) && sameSet(value.acceptedDomains, CORE) &&
      Array.isArray(value.deferredDomains) && value.deferredDomains.length === 2 &&
      value.deferredDomains[0] === 'stamina' && value.deferredDomains[1] === 'preferences' &&
      value.economyBaselineExists === (value.role === 'SUPPLEMENTAL') && Array.isArray(value.conflicts) &&
      value.conflicts.every(validId) && validId(value.prepareReceiptId) &&
      (value.status === 'FINALIZED' ? validId(value.receiptId) : value.receiptId === null);
  }
  if (action === 'migration.commitChunk') return exactKeys(value,
    ['chunkId', 'serverHash', 'chunkReceiptId', 'completedChunks', 'conflicts']) && validId(value.chunkId) &&
    /^[a-f0-9]{64}$/.test(value.serverHash) && validId(value.chunkReceiptId) &&
    Array.isArray(value.completedChunks) && value.completedChunks.every(validId) &&
    new Set(value.completedChunks).size === value.completedChunks.length &&
    Array.isArray(value.conflicts) && value.conflicts.every(validId) &&
    new Set(value.conflicts).size === value.conflicts.length;
  return exactKeys(value, ['receiptId', 'migrationReceiptId', 'role', 'completedDomains', 'deferredDomains',
    'conflicts', 'revisions', 'domains', 'acceptedOperationIds']) && validId(value.receiptId) &&
    validId(value.migrationReceiptId) &&
    ['PRIMARY', 'SUPPLEMENTAL'].includes(value.role) && validRevisions(value.revisions) && validDomains(value.domains) &&
    Object.keys(value.domains).length === CORE.length &&
    CORE.every(key => Object.prototype.hasOwnProperty.call(value.domains, key)) && sameSet(value.completedDomains, CORE) &&
    Array.isArray(value.deferredDomains) && value.deferredDomains.length === 2 &&
    value.deferredDomains[0] === 'stamina' && value.deferredDomains[1] === 'preferences' &&
    Array.isArray(value.conflicts) && value.conflicts.every(validId) &&
    Array.isArray(value.acceptedOperationIds) && value.acceptedOperationIds.length === 0;
}

function validateSyncEnvelope(data, env) {
  if (!cloudEnvelope(data, env) || !record(data.data)) return false;
  const value = data.data;
  if (!exactKeys(value, ['receiptId', 'results', 'acceptedOperationIds', 'revisions', 'domains',
    'changedDomains', 'notificationHints']) || !validId(value.receiptId) || !validRevisions(value.revisions) ||
      !validDomains(value.domains) || !Array.isArray(value.results) || value.results.length > 50 ||
      !value.results.every(item => record(item) && Object.keys(item).every(key => ['operationId', 'status', 'code', 'details'].includes(key)) &&
      validId(item.operationId) &&
      ['ACKED', 'RETRYABLE', 'REJECTED'].includes(item.status) && /^[A-Z0-9_]{1,80}$/.test(item.code)) &&
    Array.isArray(value.acceptedOperationIds) && value.acceptedOperationIds.every(validId) &&
    Array.isArray(value.changedDomains) && value.changedDomains.every(key => FIELDS.includes(key)) && new Set(value.changedDomains).size === value.changedDomains.length &&
    Array.isArray(value.notificationHints) && value.notificationHints.every(validId)) return false;
  const resultIds = value.results.map(item => item.operationId);
  const acked = value.results.filter(item => item.status === 'ACKED').map(item => item.operationId);
  return new Set(resultIds).size === resultIds.length && new Set(value.acceptedOperationIds).size === value.acceptedOperationIds.length &&
    sameSet(acked, value.acceptedOperationIds) && sameSet(value.changedDomains, Object.keys(value.domains)) &&
    (Object.hasOwn(value.domains, 'economy') === Object.hasOwn(value.domains, 'entitlements'));
}

function validatePurchaseEnvelope(data, env) {
  if (!cloudEnvelope(data, env) || !record(data.data) || !record(data.data.purchase)) return false;
  const value = data.data; const purchase = value.purchase;
  if (!exactKeys(value, ['receiptId', 'purchase', 'revisions', 'domains', 'acceptedOperationIds', 'notificationHints']) ||
      !exactKeys(purchase, ['operationId', 'status', 'kind', 'itemId', 'cost', 'balanceBefore', 'balanceAfter', 'newEntitlements'])) return false;
  const base = validId(value.receiptId) && validRevisions(value.revisions) && validDomains(value.domains) &&
    Object.keys(value.domains).length === 2 && record(value.domains.economy) && record(value.domains.entitlements) &&
    validId(purchase.operationId) && ['PURCHASED', 'ALREADY_OWNED', 'INSUFFICIENT_BALANCE'].includes(purchase.status) &&
    purchase.kind === 'theme' && validId(purchase.itemId) && Number.isSafeInteger(purchase.cost) && purchase.cost > 0 &&
    Number.isSafeInteger(purchase.balanceBefore) && purchase.balanceBefore >= 0 &&
    Number.isSafeInteger(purchase.balanceAfter) && purchase.balanceAfter >= 0 && Array.isArray(purchase.newEntitlements) &&
    purchase.newEntitlements.every(validId) && Array.isArray(value.notificationHints) && value.notificationHints.every(validId) &&
    Array.isArray(value.acceptedOperationIds) && value.acceptedOperationIds.length === 0 && sameSet(value.notificationHints, purchase.newEntitlements);
  if (!base) return false;
  if (purchase.status === 'PURCHASED') return purchase.balanceBefore - purchase.balanceAfter === purchase.cost &&
    purchase.newEntitlements.length === 1 && purchase.newEntitlements[0] === `${purchase.kind}:${purchase.itemId}`;
  if (purchase.status === 'INSUFFICIENT_BALANCE') return purchase.balanceBefore === purchase.balanceAfter &&
    purchase.balanceBefore < purchase.cost && purchase.newEntitlements.length === 0;
  return purchase.balanceBefore === purchase.balanceAfter && purchase.newEntitlements.length === 0;
}

function cloudPayload(action, source) {
  if (!record(source)) return null;
  const binding = { claimedPlayerId: source.claimedPlayerId, bindingEpoch: source.bindingEpoch, environmentId: source.environmentId };
  if (action === 'identity.init') return { installId: source.installId, clientVersion: source.clientVersion,
    localBinding: source.localBinding && { claimedPlayerId: source.localBinding.claimedPlayerId,
      bindingEpoch: source.localBinding.bindingEpoch, environmentId: source.localBinding.environmentId } };
  if (action === 'state.read') {
    if (source.includeMutationAccess !== undefined) {
      if (typeof source.includeMutationAccess !== 'boolean') return null;
      binding.includeMutationAccess = source.includeMutationAccess;
    }
    return Object.assign(binding, { knownRevisions: clone(source.knownRevisions) });
  }
  if (action === 'migration.prepare') return Object.assign(binding, { importId: source.importId,
    policyVersion: source.policyVersion, snapshotHash: source.snapshotHash, source: clone(source.source), summary: clone(source.summary) });
  if (action === 'migration.status') return Object.assign(binding, { importId: source.importId });
  if (action === 'migration.commitChunk') return Object.assign(binding, { importId: source.importId,
    prepareReceiptId: source.prepareReceiptId, chunkId: source.chunkId, domain: source.domain,
    clientChunkHash: source.clientChunkHash, records: clone(source.records) });
  if (action === 'migration.finalize') return Object.assign(binding, { importId: source.importId,
    prepareReceiptId: source.prepareReceiptId, policyVersion: source.policyVersion });
  if (action === 'sync.push') return Object.assign(binding, { knownRevisions: clone(source.knownRevisions), operations: clone(source.operations) });
  if (action === 'economy.purchase') return Object.assign(binding, { kind: source.kind, itemId: source.itemId,
    catalogVersion: source.catalogVersion });
  return null;
}

class ApiClient {
  constructor(platform, sessions, config, options) {
    this.platform = platform; this.sessions = sessions; this.config = config || {};
    this.transport = options && options.transport || null;
  }

  isConfigured() {
    if (this.transport) return this.transport.isConfigured();
    return this.config.enabled === true && typeof this.config.baseUrl === 'string' &&
      /^https:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[a-z0-9_-]+)*\/?$/i.test(this.config.baseUrl);
  }

  async request(input) {
    const opts = input || {};
    if (!this.isConfigured()) return failure('not-configured');
    if (this.transport) return this.requestCloud(opts);
    if (typeof opts.path !== 'string' || !/^\/v1\/[A-Za-z0-9/:-]+$/.test(opts.path) ||
        !['GET', 'POST', 'PATCH', 'DELETE'].includes(opts.method || 'GET')) return failure('invalid-request');
    const session = this.sessions.current();
    if (opts.auth && !session) return failure('unauthorized', 401);
    const account = opts.auth && this.accountGuard ? this.accountGuard.capture() : null;
    if (account && !this.accountGuard.matches(account)) return failure('account-mismatch');
    const header = { 'content-type': 'application/json' };
    if (opts.auth) header.Authorization = `Bearer ${session.accessToken}`;
    if (opts.idempotencyKey) {
      if (!validId(opts.idempotencyKey)) return failure('invalid-request');
      header['Idempotency-Key'] = opts.idempotencyKey;
    }
    let response;
    try {
      response = await this.platform.request({ url: this.config.baseUrl.replace(/\/$/, '') + opts.path,
        method: opts.method || 'GET', data: opts.body, header, timeout: opts.timeoutMs || this.config.timeoutMs || 8000 });
    } catch (error) { return account && !this.accountGuard.matches(account) ? failure('account-mismatch') : failure('network', 0, true); }
    if (account && !this.accountGuard.matches(account)) return failure('account-mismatch');
    if (!response || response.ok === false) return failure(response && response.reason === 'timeout' ? 'timeout' : 'network', 0, true);
    const status = response.statusCode;
    if (status === 401) {
      const current = this.sessions.current();
      if (session && current && current.accessToken === session.accessToken) this.sessions.clear();
      return failure('unauthorized', status);
    }
    let data = response.data;
    try { if (typeof data === 'string') data = JSON.parse(data); } catch (error) { return failure('invalid-json', status); }
    if (!record(data)) return failure('invalid-json', status);
    const requestId = validId(data.requestId) ? data.requestId : null;
    if (!(status >= 200 && status < 300)) {
      const code = data.error && typeof data.error.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(data.error.code)
        ? data.error.code : 'backend-rejected';
      return Object.assign(failure(code, status, status >= 500), { requestId });
    }
    return { ok: true, statusCode: status, requestId, data };
  }

  async requestCloud(opts) {
    const operation = Object.values(OPERATIONS).find(item => item.service === opts.service && item.action === opts.action);
    if (!operation || opts.path || opts.method) return failure('not-configured');
    let payload;
    try { payload = cloudPayload(opts.action, opts.payload); } catch (error) { return failure('invalid-request'); }
    if (!payload) return failure('invalid-request');
    const identity = opts.action === 'identity.init';
    const session = !identity && this.cloudSession ? this.cloudSession() : null;
    if (!identity && (!session || session.environmentId !== this.transport.config.env ||
        session.ownerId !== payload.claimedPlayerId || session.bindingEpoch !== payload.bindingEpoch)) return failure('account-mismatch');
    if ((opts.operationId !== undefined && !validId(opts.operationId)) ||
        (opts.idempotencyKey !== undefined && !validId(opts.idempotencyKey))) return failure('invalid-request');
    try {
      const request = { service: opts.service, action: opts.action,
        requestId: opts.requestId, protocolVersion: 1, timeoutMs: opts.timeoutMs, payload };
      if (opts.operationId !== undefined) request.operationId = opts.operationId;
      if (opts.idempotencyKey !== undefined) request.idempotencyKey = opts.idempotencyKey;
      const result = await this.transport.request(request);
      if (!identity) {
        const current = this.cloudSession && this.cloudSession();
        if (!current || current.ownerId !== session.ownerId || current.bindingEpoch !== session.bindingEpoch ||
            current.environmentId !== session.environmentId || current.generation !== session.generation) return failure('account-mismatch');
      }
      return result;
    } catch (error) { return failure('network', 0, true); }
  }
}

ApiClient.PATHS = PATHS;
ApiClient.failure = failure;
ApiClient.OPERATIONS = OPERATIONS;
ApiClient.CORE_DOMAINS = CORE;
ApiClient.validRevisions = validRevisions;
ApiClient.validateCloudIdentity = validateCloudIdentity;
ApiClient.validateStateEnvelope = validateStateEnvelope;
ApiClient.validateReadOnlyEnvelope = validateReadOnlyEnvelope;
ApiClient.validateMigrationEnvelope = validateMigrationEnvelope;
ApiClient.validateSyncEnvelope = validateSyncEnvelope;
ApiClient.validatePurchaseEnvelope = validatePurchaseEnvelope;
module.exports = ApiClient;
