'use strict';

const ApiClient = require('./api-client.js');
const SyncStore = require('./sync-store.js');

class AuthService {
  constructor(platform, api, sessions, syncStore, config) {
    this.platform = platform;
    this.api = api;
    this.sessions = sessions;
    this.syncStore = syncStore;
    this.config = config || {};
    this.mode = this.config.mode || (api.transport ? 'cloud' : 'legacy-http');
    this.readOnlyPhase = this.mode === 'cloud' && !(api.transport && api.transport.config &&
      (api.transport.config.migrationEnabled || api.transport.config.writeEnabled || api.transport.config.economyEnabled));
    this.cloudReady = null;
    if (this.mode === 'cloud') this.api.cloudSession = () => this.current();
    this.status = this.current() ? 'authenticated' : 'anonymous';
    this.inFlight = null;
    this.listeners = [];
    this.generation = 0;
  }

  current() {
    if (this.mode === 'legacy-http') return this.sessions.current();
    if (!this.cloudReady || this.config.enabled !== true || !this.api.isConfigured()) return null;
    const metadata = this.sessions.metadata(); const scope = this.syncStore.context();
    if (!metadata || metadata.mode !== 'cloud' || metadata.ownerId !== this.cloudReady.ownerId ||
        metadata.environmentId !== this.api.transport.config.env ||
        metadata.environmentId !== this.cloudReady.environmentId || metadata.bindingEpoch !== this.cloudReady.bindingEpoch ||
        scope.ownerId !== metadata.ownerId || scope.bindingEpoch !== metadata.bindingEpoch ||
        scope.environmentId !== metadata.environmentId) return null;
    return Object.assign({}, this.cloudReady, { generation: this.generation });
  }
  state() { return this.status === 'authenticated' && !this.current() ? 'anonymous' : this.status; }
  onSessionChanged(listener) {
    if (typeof listener !== 'function') return function () {};
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter(item => item !== listener); };
  }
  notify() { this.listeners.slice().forEach(fn => { try { fn(this.current(), this.status); } catch (error) {} }); }
  clear(reason) {
    this.generation++; this.cloudReady = null;
    if (this.mode === 'legacy-http') this.sessions.clear();
    this.status = reason === 'offline' ? 'offline' : 'anonymous'; this.notify();
  }

  ensureSession(options) {
    if (this.inFlight) return this.inFlight;
    const cached = this.current();
    if (cached && !(options && options.force)) return Promise.resolve(this.success(cached));
    if (this.config.enabled !== true || !this.api.isConfigured()) {
      return Promise.resolve({ ok: false, status: 'offline', reason: 'not-configured' });
    }
    if (!['legacy-http', 'cloud'].includes(this.mode)) return Promise.resolve({ ok: false, status: 'offline', reason: 'invalid-identity-mode' });
    const generation = this.generation;
    if (this.mode === 'cloud') this.cloudReady = null;
    // Publish the flight before notifying observers: a listener may itself
    // ask for a session while rendering the new authenticating state.
    this.inFlight = Promise.resolve().then(() => this.mode === 'cloud' ? this.authenticateCloud(generation) : this.authenticate(generation))
      .catch(() => generation === this.generation ? this.fail('network') : { ok: false, reason: 'account-mismatch' })
      .finally(() => { this.inFlight = null; });
    this.status = 'authenticating'; this.notify();
    return this.inFlight;
  }

  async authenticateCloud(generation) {
    const transport = this.api.transport;
    if (!transport || !transport.config || transport.config.identityEnabled !== true) return this.fail('not-configured');
    const env = transport.config.env; const previous = this.sessions.metadata();
    if (this.syncStore.blocked) return this.fail('local-state-not-ready');
    const scope = this.syncStore.context();
    const account = this.accountGuard && this.accountGuard.capture();
    const matches = () => generation === this.generation && transport.config.env === env && this.syncStore.matches(scope) &&
      (!account || this.accountGuard.matches(account));
    const local = previous && previous.mode === 'cloud' && previous.environmentId === env ? previous : null;
    const response = await this.api.request(Object.assign({}, ApiClient.OPERATIONS.identity, {
      requestId: SyncStore.opaqueId('req'), auth: false, payload: {
        installId: this.syncStore.state.installId, clientVersion: this.config.clientVersion || '1.0.0',
        localBinding: { claimedPlayerId: local ? local.ownerId : null, bindingEpoch: local ? local.bindingEpoch : 0, environmentId: env }
      }
    }));
    if (!matches()) return { ok: false, reason: 'account-mismatch' };
    if (!response.ok) return this.fail(response.error.code);
    const data = response.data;
    if (!ApiClient.validateCloudIdentity(data, env)) return this.fail('invalid-response');
    if (local && local.ownerId !== data.player.playerId) {
      // Stage 3 has one local gameplay cache. Detect B, retain A, stop reads;
      // never turn this identity response into a gameplay/account migration.
      this.generation++; this.cloudReady = null; return this.fail('account-mismatch');
    }
    const retained = local && local.ownerId === data.player.playerId ? local : null;
    const metadata = { schemaVersion: 2, mode: 'cloud', ownerId: data.player.playerId,
      bindingEpoch: data.player.bindingEpoch, environmentId: env,
      // A new device first persists trusted identity, then state.read and the
      // authoritative applier persist the completed migration receipt.
      migrationState: retained ? retained.migrationState : 'none',
      migrationImportId: retained ? retained.migrationImportId : null,
      migrationReceiptId: retained ? retained.migrationReceiptId : null };
    // Two durable keys are not atomic. If activation fails the saved identity
    // remains unready; a restart revalidates it before publishing any session.
    if (!this.sessions.set(metadata)) return this.fail(this.sessions.lastError === 'persist-failed' ? 'persist-failed' : 'invalid-response');
    const activated = this.syncStore.activateScope(metadata.ownerId, metadata.bindingEpoch, env, true);
    if (!activated.ok) { this.cloudReady = null; return this.fail(activated.reason); }
    this.cloudReady = { mode: 'cloud', ownerId: metadata.ownerId, bindingEpoch: metadata.bindingEpoch, environmentId: env,
      migrationState: data.player.migrationState, hasCloudState: data.player.hasCloudState,
      completedDomains: data.player.completedDomains.slice(), deferredDomains: data.player.deferredDomains.slice(),
      readOnlyPhase: this.readOnlyPhase, readPaused: false };
    this.status = 'authenticated'; this.notify();
    return this.success(this.current());
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

  success(session) {
    if (session && session.mode === 'cloud') return { ok: true, status: 'authenticated', user: { id: session.ownerId },
      session: Object.assign({}, session), readOnlyPhase: this.readOnlyPhase, readPaused: session.readPaused };
    return { ok: true, status: 'authenticated', user: { id: session.userId }, session: { expiresAt: session.expiresAt } };
  }
  fail(reason) { this.status = reason === 'network' || reason === 'timeout' || reason === 'not-configured' ? 'offline' : 'error'; this.notify(); return { ok: false, status: this.status, reason }; }
}

module.exports = AuthService;
