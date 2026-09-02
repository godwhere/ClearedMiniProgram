'use strict';

const ApiClient = require('./api-client.js');

class ProgressSyncService {
  constructor(api, progress, syncStore, auth, config, behavior) {
    this.api = api; this.progress = progress; this.store = syncStore; this.auth = auth;
    this.config = config || {}; this.behavior = behavior || null; this.inFlight = null;
  }
  state() {
    return { status: this.status || 'idle', boundUserId: this.store.state.boundUserId,
      pending: this.store.state.pendingOperations.length, lastError: this.store.state.lastError };
  }
  enqueueCompletion(input) {
    if (!input || !Number.isInteger(input.setIndex) || !Number.isInteger(input.levelIndex)) return false;
    const payload = { levelKey: `${input.setIndex}:${input.levelIndex}`,
      elapsedMs: Math.max(1, Math.round(Number(input.elapsedMs) || 1)),
      completedAtClient: Math.max(0, Math.round(Number(input.completedAtClient) || Date.now())) };
    const queued = this.store.enqueue(payload);
    if (queued && this.config.enabled === true) this.flush().catch(function () {});
    return queued;
  }
  bootstrap(session) {
    if (this.config.enabled !== true || !session) return Promise.resolve({ ok: false, reason: 'not-configured' });
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.run(session).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }
  async run(session) {
    const state = this.store.state;
    if (state.boundUserId && state.boundUserId !== session.userId) {
      this.status = 'account-mismatch'; state.lastError = 'account-mismatch'; this.store.save();
      return { ok: false, reason: 'account-mismatch' };
    }
    if (!state.boundUserId) {
      const result = await this.authorizedRequest({ method: 'POST', path: ApiClient.PATHS.bootstrap,
        idempotencyKey: state.migrationId, body: { migrationId: state.migrationId,
          installId: state.installId, clientRevision: state.serverRevision,
          snapshot: this.progress.exportCloudSnapshot() } });
      if (!result.ok) return this.failed(result);
      const revision = result.data.revision;
      const merged = this.progress.mergeCloudSnapshot(result.data.snapshot);
      if (!merged.ok || !Number.isSafeInteger(revision) || revision < 0) return this.failed({ error: { code: merged.reason || 'invalid-response' } });
      state.boundUserId = session.userId; state.serverRevision = revision;
      state.snapshotRequired = false; state.lastSyncAt = Date.now(); state.lastError = null;
      if (!this.store.save()) return this.failed({ error: { code: 'persist-failed' } });
    }
    return this.flush();
  }
  async authorizedRequest(options) {
    const first = await this.api.request(Object.assign({ auth: true }, options));
    if (!first.ok && first.error.code === 'unauthorized') {
      // Exactly one business-level reauthentication attempt.
      const auth = await this.auth.ensureSession({ force: true });
      if (!auth.ok) return first;
      return this.api.request(Object.assign({ auth: true }, options));
    }
    return first;
  }
  async flush() {
    if (this.config.enabled !== true) return { ok: false, reason: 'not-configured' };
    const session = this.auth.current();
    if (!session) return { ok: false, reason: 'unauthorized' };
    if (this.store.state.boundUserId && this.store.state.boundUserId !== session.userId) return { ok: false, reason: 'account-mismatch' };
    if (!this.store.state.boundUserId || this.store.state.snapshotRequired) return this.bootstrap(session);
    const operations = this.store.state.pendingOperations.slice(0, 20);
    if (!operations.length) { this.status = 'synced'; return { ok: true, accepted: [] }; }
    const result = await this.authorizedRequest({ method: 'POST', path: ApiClient.PATHS.operations,
      body: { baseRevision: this.store.state.serverRevision, operations } });
    if (!result.ok) return this.failed(result);
    const accepted = Array.isArray(result.data.acceptedOperationIds) ? result.data.acceptedOperationIds : [];
    const known = new Set(operations.map(item => item.operationId));
    const safeAccepted = accepted.filter(id => known.has(id));
    if (Number.isSafeInteger(result.data.revision) && result.data.revision >= this.store.state.serverRevision) this.store.state.serverRevision = result.data.revision;
    this.store.acknowledge(safeAccepted); this.store.state.lastSyncAt = Date.now(); this.store.state.lastError = null; this.store.save();
    this.status = 'synced'; return { ok: true, accepted: safeAccepted };
  }
  failed(result) { const reason = result && result.error ? result.error.code : 'sync-failed'; this.status = 'error'; this.store.state.lastError = reason; this.store.save(); return { ok: false, reason }; }
}

module.exports = ProgressSyncService;
