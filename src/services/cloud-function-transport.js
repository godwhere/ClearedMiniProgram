'use strict';

const { failure } = require('./api-client.js');
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_:-]{1,200}$/.test(value) &&
  !['__proto__', 'constructor', 'prototype'].includes(value);
const unsafeKey = key => ['__proto__', 'constructor', 'prototype'].includes(key);

function localize(value, depth, budget) {
  const level = depth || 0;
  const remaining = budget || { nodes: 50000 };
  if (--remaining.nodes < 0 || level > 32) throw Error('invalid-response');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw Error('invalid-response');
    return value;
  }
  if (Array.isArray(value)) return Array.from(value, item => localize(item, level + 1, remaining));
  if (!value || typeof value !== 'object') throw Error('invalid-response');
  const result = {};
  for (const key of Object.keys(value)) {
    if (unsafeKey(key)) throw Error('invalid-response');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw Error('invalid-response');
    result[key] = localize(descriptor.value, level + 1, remaining);
  }
  return result;
}
const ACTIONS = Object.freeze({
  identity: ['identity.init'],
  playerState: ['state.read', 'migration.prepare', 'migration.status', 'migration.commitChunk', 'migration.finalize', 'sync.push'],
  economy: ['economy.purchase']
});

class CloudFunctionTransport {
  constructor(platform, config) {
    this.platform = platform;
    this.config = Object.assign({}, config, { functions: Object.assign({}, config && config.functions) });
    this.initialization = null;
  }

  isConfigured() {
    return this.config.enabled === true && typeof this.config.env === 'string' &&
      /^[A-Za-z0-9_-]{1,128}$/.test(this.config.env) && this.config.testOnly === true &&
      ['identityEnabled', 'readEnabled', 'writeEnabled', 'migrationEnabled', 'economyEnabled',
        'staminaEnabled', 'preferencesEnabled'].every(key => typeof this.config[key] === 'boolean') &&
      this.config.staminaEnabled === false && this.config.preferencesEnabled === false;
  }

  async request(input) {
    if (!this.isConfigured()) return failure('not-configured');
    const opts = input || {};
    const gate = opts.action === 'identity.init' ? 'identityEnabled' : opts.action === 'state.read' ? 'readEnabled'
      : opts.action && opts.action.startsWith('migration.') ? 'migrationEnabled'
        : opts.action === 'sync.push' ? 'writeEnabled' : opts.action === 'economy.purchase' ? 'economyEnabled' : null;
    if (!gate || this.config[gate] !== true) return failure('not-configured');
    const actions = Object.prototype.hasOwnProperty.call(ACTIONS, opts.service) && ACTIONS[opts.service];
    const name = this.config.functions[opts.service];
    const timeout = opts.timeoutMs === undefined ? this.config.timeoutMs : opts.timeoutMs;
    if (!actions || !actions.includes(opts.action) || typeof name !== 'string' ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(name) || !validId(opts.requestId) ||
        opts.protocolVersion !== 1 || !record(opts.payload) ||
        !Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 60000 ||
        (opts.operationId != null && !validId(opts.operationId)) ||
        (opts.idempotencyKey != null && !validId(opts.idempotencyKey))) return failure('invalid-request');
    const data = { action: opts.action, requestId: opts.requestId,
      protocolVersion: opts.protocolVersion, payload: opts.payload };
    if (opts.operationId != null) data.operationId = opts.operationId;
    if (opts.idempotencyKey != null) data.idempotencyKey = opts.idempotencyKey;
    try {
      if (!this.platform || typeof this.platform.supportsCloud !== 'function' ||
          !this.platform.supportsCloud()) return failure('not-supported');
      if (typeof this.platform.getMiniProgramEnvironmentVersion !== 'function' ||
          !['develop', 'trial'].includes(this.platform.getMiniProgramEnvironmentVersion())) return failure('not-configured');
      // Lazy initialization cannot block local bootstrap. Concurrent requests
      // share initialization; a failed initialization may be retried later.
      if (!this.initialization) {
        this.initialization = Promise.resolve().then(() => this.platform.initCloud({ env: this.config.env, traceUser: false }))
          .catch(() => ({ ok: false, reason: 'cloud-init-failed' }));
      }
      const initialized = await this.initialization;
      if (!initialized || initialized.ok !== true) {
        this.initialization = null;
        return failure(initialized && initialized.reason === 'not-supported' ? 'not-supported' : 'cloud-init-failed');
      }
      const response = await this.platform.callCloudFunction({ name, data, timeout, env: this.config.env });
      if (!response || response.ok !== true) {
        const reason = response && response.reason;
        const code = ['timeout', 'not-supported', 'invalid-request'].includes(reason) ? reason : 'network';
        return failure(code, 0, code === 'timeout' || code === 'network');
      }
      // Cloud SDK values can belong to a native/foreign JS realm. Convert
      // data-only own properties at the platform boundary so downstream
      // strict plain-object checks do not reject otherwise valid receipts.
      let result;
      try { result = localize(response.result); } catch (error) { return failure('invalid-response'); }
      if (!record(result) || typeof result.ok !== 'boolean' ||
          typeof result.code !== 'string' || !/^[A-Z0-9_]{1,80}$/.test(result.code) ||
          result.requestId !== opts.requestId || (result.ok && result.code !== 'OK') ||
          (!result.ok && result.code === 'OK') ||
          (result.retryable !== undefined && typeof result.retryable !== 'boolean')) return failure('invalid-response');
      if (!result.ok) {
        const failed = Object.assign(failure(result.code, 0, result.retryable), { requestId: result.requestId });
        if (Number.isSafeInteger(result.retryAfterMs) && result.retryAfterMs >= 0) failed.error.retryAfterMs = result.retryAfterMs;
        return failed;
      }
      // Keep the protocol envelope (player/revisions/receipts) intact. Do not
      // interpret it as a legacy HTTP progress response or apply any state.
      return { ok: true, statusCode: 0, requestId: result.requestId, data: result };
    } catch (error) { return failure('network', 0, true); }
  }
}

module.exports = CloudFunctionTransport;
