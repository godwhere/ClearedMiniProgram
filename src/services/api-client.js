'use strict';

// HTTP paths live here; business services consume named contracts.
const PATHS = Object.freeze({
  auth: '/v1/auth/wechat', me: '/v1/me', profile: '/v1/me/profile',
  bootstrap: '/v1/progress/bootstrap', progress: '/v1/progress',
  operations: '/v1/progress/operations:batch', shareIntents: '/v1/share-intents',
  attributions: '/v1/share-attributions', rewards: '/v1/reward-claims',
  entitlements: '/v1/daily-entitlements/', events: '/v1/events:batch'
});
const failure = (code, statusCode, retryable) => ({ ok: false, statusCode: statusCode || 0,
  error: { code, retryable: retryable === true } });

class ApiClient {
  constructor(platform, sessions, config) {
    this.platform = platform;
    this.sessions = sessions;
    this.config = config || {};
  }

  isConfigured() {
    return this.config.enabled === true && typeof this.config.baseUrl === 'string' &&
      /^https:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[a-z0-9_-]+)*\/?$/i.test(this.config.baseUrl);
  }

  async request(input) {
    const opts = input || {};
    if (!this.isConfigured()) return failure('not-configured');
    if (typeof opts.path !== 'string' || !/^\/v1\/[A-Za-z0-9/:-]+$/.test(opts.path) ||
        !['GET', 'POST', 'PATCH', 'DELETE'].includes(opts.method || 'GET')) return failure('invalid-request');
    const session = this.sessions.current();
    if (opts.auth && !session) return failure('unauthorized', 401);
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
    } catch (error) { return failure('network', 0, true); }
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
}

ApiClient.PATHS = PATHS;
ApiClient.failure = failure;
module.exports = ApiClient;
