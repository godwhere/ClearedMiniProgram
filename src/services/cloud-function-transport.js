'use strict';

const { failure } = require('./api-client.js');
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_:-]{1,200}$/.test(value) &&
  !['__proto__', 'constructor', 'prototype'].includes(value);
const ACTIONS = Object.freeze({
  identity: ['identity.init', 'identity.status'],
  playerState: ['state.read', 'migration.prepare', 'migration.commitChunk', 'migration.finalize', 'sync.push'],
  economy: ['economy.read', 'economy.purchase']
});

class CloudFunctionTransport {
  constructor(platform, config) {
    this.platform = platform;
    this.config = Object.assign({}, config, { functions: Object.assign({}, config && config.functions) });
    this.initialization = null;
  }

  isConfigured() {
    return this.config.enabled === true && typeof this.config.env === 'string' &&
      /^[A-Za-z0-9_-]{1,128}$/.test(this.config.env);
  }

  async request(input) {
    if (!this.isConfigured()) return failure('not-configured');
    const opts = input || {};
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
      const result = response.result;
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
