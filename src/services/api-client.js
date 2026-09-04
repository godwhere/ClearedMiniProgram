'use strict';

// HTTP paths live here; business services consume named contracts.
const PATHS = Object.freeze({
  auth: '/v1/auth/wechat', me: '/v1/me', profile: '/v1/me/profile',
  bootstrap: '/v1/progress/bootstrap', progress: '/v1/progress',
  operations: '/v1/progress/operations:batch', shareIntents: '/v1/share-intents',
  attributions: '/v1/share-attributions', rewards: '/v1/reward-claims',
  entitlements: '/v1/daily-entitlements/', events: '/v1/events:batch'
});
const OPERATIONS = Object.freeze({
  identity: Object.freeze({ service: 'identity', action: 'identity.init' }),
  readOnlyState: Object.freeze({ service: 'playerState', action: 'state.read' })
});
const failure = (code, statusCode, retryable) => ({ ok: false, statusCode: statusCode || 0,
  error: { code, retryable: retryable === true } });
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const FIELDS = ['progress', 'daily', 'economy', 'entitlements', 'stamina', 'preferences'];
const validPlayerId = value => typeof value === 'string' && /^player_[A-Za-z0-9_-]{1,120}$/.test(value);
const validEnvironmentId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const zeroRevisions = value => record(value) && Object.keys(value).length === FIELDS.length && FIELDS.every(key => value[key] === 0);

function cloudEnvelope(data, env) {
  if (!record(data) || data.ok !== true || data.code !== 'OK' || data.protocolVersion !== 1 || data.retryable !== false ||
      data.environmentId !== env || !validEnvironmentId(env) || !zeroRevisions(data.revisions) ||
      Object.keys(data).some(key => !['ok', 'code', 'requestId', 'protocolVersion', 'retryable', 'environmentId',
        'serverTimeMs', 'serverDateKey', 'player', 'revisions', 'data', 'bindingStatus'].includes(key)) ||
      !Number.isSafeInteger(data.serverTimeMs) || data.serverTimeMs < 0 || data.serverTimeMs > 8640000000000000 - 28800000 ||
      new Date(data.serverTimeMs + 28800000).toISOString().slice(0, 10) !== data.serverDateKey) return false;
  const player = data.player;
  return record(player) && Object.keys(player).every(key => ['playerId', 'bindingEpoch', 'migrationState', 'hasCloudState'].includes(key)) &&
    validPlayerId(player.playerId) && Number.isSafeInteger(player.bindingEpoch) && player.bindingEpoch > 0 &&
    player.migrationState === 'none';
}

function validateCloudIdentity(data, env) {
  return cloudEnvelope(data, env) && data.player.hasCloudState === false &&
    ['UNBOUND', 'MATCHED', 'CLIENT_STALE'].includes(data.bindingStatus) && data.data === undefined;
}

function validateReadOnlyEnvelope(data, env) {
  return cloudEnvelope(data, env) && record(data.data) && Object.keys(data.data).length === 3 &&
    data.data.readOnlyPhase === true && data.data.hasCloudState === false &&
    record(data.data.changedDomains) && Object.keys(data.data.changedDomains).length === 0;
}

class ApiClient {
  constructor(platform, sessions, config, options) {
    this.platform = platform;
    this.sessions = sessions;
    this.config = config || {};
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
      if (typeof opts.idempotencyKey !== 'string' || !/^[A-Za-z0-9_:-]{1,200}$/.test(opts.idempotencyKey)) return failure('invalid-request');
      header['Idempotency-Key'] = opts.idempotencyKey;
    }
    let response;
    try {
      response = await this.platform.request({
        url: this.config.baseUrl.replace(/\/$/, '') + opts.path,
        method: opts.method || 'GET', data: opts.body, header,
        timeout: opts.timeoutMs || this.config.timeoutMs || 8000
      });
    } catch (error) { return account && !this.accountGuard.matches(account) ? failure('account-mismatch') : failure('network', 0, true); }
    if (account && !this.accountGuard.matches(account)) return failure('account-mismatch');
    if (!response || response.ok === false) return failure(response && response.reason === 'timeout' ? 'timeout' : 'network', 0, true);
    const status = response.statusCode;
    if (status === 401) {
      // A late 401 from an older request must not erase a replacement session.
      const current = this.sessions.current();
      if (session && current && current.accessToken === session.accessToken) this.sessions.clear();
      return failure('unauthorized', status);
    }
    let data = response.data;
    try { if (typeof data === 'string') data = JSON.parse(data); } catch (error) { return failure('invalid-json', status); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return failure('invalid-json', status);
    const requestId = typeof data.requestId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(data.requestId) ? data.requestId : null;
    if (!(status >= 200 && status < 300)) {
      const code = data.error && typeof data.error.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(data.error.code)
        ? data.error.code : 'backend-rejected';
      return Object.assign(failure(code, status, status >= 500), { requestId });
    }
    return { ok: true, statusCode: status, requestId, data };
  }

  async requestCloud(opts) {
    // No implicit HTTP-path conversion: old profile/reward/sync services are
    // not Cloud services. Phase 3 exposes only these two named operations.
    const identity = opts.service === 'identity' && opts.action === 'identity.init';
    const read = opts.service === 'playerState' && opts.action === 'state.read';
    if ((!identity && !read) || opts.path || opts.method || opts.operationId || opts.idempotencyKey) return failure('not-configured');
    if (!record(opts.payload)) return failure('invalid-request');
    const session = read && this.cloudSession ? this.cloudSession() : null;
    if (read && (!session || session.environmentId !== this.transport.config.env ||
        session.ownerId !== opts.payload.claimedPlayerId || session.bindingEpoch !== opts.payload.bindingEpoch)) return failure('account-mismatch');
    const source = opts.payload;
    const payload = identity ? { installId: source.installId, clientVersion: source.clientVersion,
      localBinding: source.localBinding && { claimedPlayerId: source.localBinding.claimedPlayerId,
        bindingEpoch: source.localBinding.bindingEpoch, environmentId: source.localBinding.environmentId } }
      : { claimedPlayerId: source.claimedPlayerId, bindingEpoch: source.bindingEpoch,
        environmentId: source.environmentId, knownRevisions: source.knownRevisions };
    try {
      const result = await this.transport.request({ service: opts.service, action: opts.action,
        requestId: opts.requestId, protocolVersion: 1, timeoutMs: opts.timeoutMs, payload });
      if (read) {
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
ApiClient.validateCloudIdentity = validateCloudIdentity;
ApiClient.validateReadOnlyEnvelope = validateReadOnlyEnvelope;
module.exports = ApiClient;
