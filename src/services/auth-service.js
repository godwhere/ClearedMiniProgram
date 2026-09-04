'use strict';

const ApiClient = require('./api-client.js');

class AuthService {
  constructor(platform, api, sessions, syncStore, config) {
    this.platform = platform;
    this.api = api;
    this.sessions = sessions;
    this.syncStore = syncStore;
    this.config = config || {};
    this.mode = this.config.mode || (api.transport ? 'cloud' : 'legacy-http');
    this.status = this.current() ? 'authenticated' : 'anonymous';
    this.inFlight = null;
    this.listeners = [];
    this.generation = 0;
  }

  current() { return this.mode === 'legacy-http' ? this.sessions.current() : null; }
  state() { return this.status === 'authenticated' && !this.current() ? 'anonymous' : this.status; }
  onSessionChanged(listener) {
    if (typeof listener !== 'function') return function () {};
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter(item => item !== listener); };
  }
  notify() { this.listeners.slice().forEach(fn => { try { fn(this.current(), this.status); } catch (error) {} }); }
  clear(reason) { this.generation++; this.sessions.clear(); this.status = reason === 'offline' ? 'offline' : 'anonymous'; this.notify(); }

  ensureSession(options) {
    if (this.inFlight) return this.inFlight;
    const cached = this.current();
    if (cached && !(options && options.force)) return Promise.resolve(this.success(cached));
    if (this.config.enabled !== true || !this.api.isConfigured()) {
      return Promise.resolve({ ok: false, status: 'offline', reason: 'not-configured' });
    }
    // Cloud identity must not activate the legacy single-scope sync path.
    // Phase 2 adds owner scopes; phase 3 supplies the real identity provider.
    if (this.mode !== 'legacy-http') return Promise.resolve({ ok: false, status: 'offline',
      reason: this.mode === 'cloud' ? 'cloud-identity-not-ready' : 'invalid-identity-mode' });
    const generation = this.generation;
    // Publish the flight before notifying observers: a listener may itself
    // ask for a session while rendering the new authenticating state.
    this.inFlight = Promise.resolve().then(() => this.authenticate(generation))
      .catch(() => this.fail('network')).finally(() => { this.inFlight = null; });
    this.status = 'authenticating'; this.notify();
    return this.inFlight;
  }

  async authenticate(generation) {
    let login;
    try { login = await this.platform.login(); } catch (error) {
      return this.fail(error && error.reason === 'timeout' ? 'timeout' : 'wechat-login-failed');
    }
    if (!login || typeof login.code !== 'string' || !login.code) return this.fail('wechat-login-failed');
    if (generation !== this.generation) return { ok: false, status: 'anonymous', reason: 'cancelled' };
    const response = await this.api.request({ method: 'POST', path: ApiClient.PATHS.auth, body: {
      code: login.code, installId: this.syncStore.state.installId,
      clientVersion: this.config.clientVersion || '1.0.0'
    }});
    // login.code is deliberately not retained after this request expression.
    if (!response.ok) return this.fail(response.error.code === 'network' ? 'network' :
      (response.error.code === 'timeout' ? 'timeout' : 'backend-rejected'));
    const data = response.data;
    if (generation !== this.generation) return { ok: false, status: 'anonymous', reason: 'cancelled' };
    const user = data.user;
    const session = data.session && { schemaVersion: 1, userId: user && user.id,
      accessToken: data.session.accessToken, issuedAt: data.session.issuedAt,
      expiresAt: data.session.expiresAt };
    if (!user || typeof user.id !== 'string' || !this.sessions.set(session)) {
      return this.fail(this.sessions.lastError === 'persist-failed' ? 'persist-failed' : 'invalid-response');
    }
    this.status = 'authenticated'; this.notify();
    return { ok: true, status: this.status,
      user: { id: user.id, profileCompleted: user.profileCompleted === true },
      session: { expiresAt: session.expiresAt } };
  }

  success(session) { return { ok: true, status: 'authenticated', user: { id: session.userId }, session: { expiresAt: session.expiresAt } }; }
  fail(reason) { this.status = reason === 'network' || reason === 'timeout' || reason === 'not-configured' ? 'offline' : 'error'; this.notify(); return { ok: false, status: this.status, reason }; }
}

module.exports = AuthService;
