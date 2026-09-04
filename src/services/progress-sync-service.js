'use strict';

const ApiClient = require('./api-client.js');
const SyncStore = require('./sync-store.js');

class ProgressSyncService {
  constructor(api, progress, syncStore, auth, config, behavior) {
    this.api = api;
    this.progress = progress;
    this.store = syncStore;
    this.auth = auth;
    this.config = config || {};
    this.behavior = behavior || null;
    this.inFlight = null;
    this.status = 'idle';
  }

  state() {
    return { status: this.status, pending: this.store.state.pendingOperations.length,
      lastSyncAt: this.store.state.lastSyncAt, lastError: this.store.state.lastError };
  }

  enqueueCompletion(input) {
    if (!input || !Number.isInteger(input.setIndex) || !Number.isInteger(input.levelIndex) ||
        !Number.isFinite(input.elapsedMs) || input.elapsedMs <= 0) return false;
    if (!this.store.ownsLocalState()) return false;
    const session = this.auth.current();
    if (this.store.state.activeOwnerId === null && this.store.state.boundUserId &&
        session && session.userId === this.store.state.boundUserId && !this.store.bindLegacyUser(session.userId)) return false;
    const levelKey = `${input.setIndex}:${input.levelIndex}`;
    const queued = this.store.enqueue({ levelKey, elapsedMs: Math.max(1, Math.round(input.elapsedMs)),
      completedAtClient: Math.max(0, Math.round(Number(input.completedAtClient) || Date.now())) });
    if (this.config.enabled === true) this.flush().catch(function () {});
    return queued;
  }

  bootstrap(session) { return this.flush(session); }

  flush(session) {
    if (this.config.enabled !== true || !this.api.isConfigured()) return Promise.resolve({ ok: false, reason: 'not-configured' });
    if (this.store.blocked) return Promise.resolve({ ok: false, reason: 'storage-blocked' });
    if (this.store.state.authorityMode !== 'legacy-local') return Promise.resolve({ ok: false, reason: this.store.state.authorityMode });
    if (this.inFlight) return this.inFlight;
    const current = session || this.auth.current();
    if (!current) return Promise.resolve({ ok: false, reason: 'unauthorized' });
    this.status = 'syncing';
    const scope = this.store.context();
    this.inFlight = this.run(current.userId).catch(() => this.failed('network', { scope }))
      .finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  matches(token) {
    const current = this.auth.current();
    const bound = this.store.state.boundUserId;
    return !!current && current.userId === token.userId && (!bound || bound === token.userId) &&
      this.store.matches(token.scope) && this.store.ownsLocalState() &&
      (token.scope.ownerId === null || token.scope.ownerId === SyncStore.legacyOwnerId(token.userId)) &&
      (!token.account || this.accountGuard.matches(token.account));
  }

  async request(token, options) {
    if (!this.matches(token)) return ApiClient.failure('account-mismatch');
    let result = await this.api.request(Object.assign({ auth: true }, options));
    if (!result.ok && result.error.code === 'unauthorized') {
      const auth = await this.auth.ensureSession();
      if (!auth.ok) return result;
      if (!this.matches(token)) return ApiClient.failure('account-mismatch');
      result = await this.api.request(Object.assign({ auth: true }, options));
    } else if (!result.ok && result.error.retryable && options.method === 'POST') {
      // Only migrations and operation batches reach this retry; their IDs
      // and payload are retained unchanged. ApiClient never retries a POST.
      if (!this.matches(token)) return ApiClient.failure('account-mismatch');
      result = await this.api.request(Object.assign({ auth: true }, options));
    }
    if (!result.ok && result.error.code === 'unauthorized') return result;
    if (!this.matches(token)) return ApiClient.failure('account-mismatch');
    return result;
  }

  updateMetadata(update, token, acceptedIds) {
    return this.matches(token) && this.store.updateScope(update, token.scope, acceptedIds);
  }

  async run(userId) {
    if (this.store.state.boundUserId === userId && this.store.state.activeOwnerId === null &&
        !this.store.bindLegacyUser(userId)) return this.failed('persist-failed');
    const token = { userId, scope: this.store.context(), account: this.accountGuard && this.accountGuard.capture() };
    if (!this.matches(token)) return this.failed('account-mismatch', token);
    if (this.progress.save() !== true) return this.failed('persist-failed');
    if (!this.store.save()) return this.failed('persist-failed');
    const state = this.store.state;
    const firstBinding = !state.boundUserId;
    const result = await this.request(token, firstBinding
      ? { method: 'POST', path: ApiClient.PATHS.bootstrap, idempotencyKey: state.migrationId,
        body: { migrationId: state.migrationId, installId: state.installId,
          clientRevision: state.serverRevision, snapshot: this.progress.exportCloudSnapshot() } }
      : { method: 'GET', path: ApiClient.PATHS.progress });
    if (!result.ok) return this.failed(result.error.code, token);
    if (!this.matches(token)) return this.failed('account-mismatch', token);
    const remote = result.data;
    if (!Number.isSafeInteger(remote.revision) || remote.revision < state.serverRevision ||
        !remote.snapshot || remote.snapshot.schemaVersion !== 1 || !remote.snapshot.levels ||
        typeof remote.snapshot.levels !== 'object' || Array.isArray(remote.snapshot.levels)) return this.failed('invalid-response');
    // Establish ownership before any remote bytes can reach the local save.
    // Keep this guard after later failures; the same account can pull again
    // with the old revision, while another account must never bootstrap it.
    if (firstBinding) {
      if (!this.matches(token)) return this.failed('account-mismatch', token);
      if (!this.store.bindLegacyUser(userId)) return this.failed('persist-failed', token);
      token.scope = this.store.context();
      token.account = this.accountGuard && this.accountGuard.capture();
    }
    const merged = this.progress.mergeCloudSnapshot(remote.snapshot);
    if (!merged.ok) return this.failed(merged.reason);
    if (!this.updateMetadata({ revisions: Object.assign({}, this.store.currentScope().revisions,
      { progress: remote.revision }) }, token)) return this.failed('persist-failed', token);

    // Recover offline completions, an overflowing outbox, or a crash between
    // saving progress and enqueuing. Only missing/better cloud fields upload.
    const local = this.progress.exportCloudSnapshot().levels;
    let reconciliationPending = false;
    for (const key of Object.keys(local)) {
      const here = local[key];
      const there = Object.prototype.hasOwnProperty.call(remote.snapshot.levels, key) ? remote.snapshot.levels[key] : null;
      const better = typeof here.bestMs === 'number' && (!there || typeof there.bestMs !== 'number' || !Number.isFinite(there.bestMs) || there.bestMs <= 0 || here.bestMs < there.bestMs);
      const missing = here.completed && (!there || there.completed !== true);
      if (!better && !missing) continue;
      const alreadyQueued = this.store.state.pendingOperations.some(item => item.payload.levelKey === key &&
        (here.bestMs === undefined || item.payload.elapsedMs <= here.bestMs));
      // Legacy saves can have completion without a recorded time. Never
      // fabricate a 1ms record; omitted elapsedMs only contributes completion.
      const payload = { levelKey: key, completedAtClient: Date.now() };
      if (here.bestMs !== undefined) payload.elapsedMs = here.bestMs;
      if (!alreadyQueued && !this.store.enqueue(payload)) reconciliationPending = true;
    }
    const batch = this.store.state.pendingOperations.slice(0, 200);
    if (batch.length) {
      if (batch.some(item => item.ownerIdAtCreation !== token.scope.ownerId ||
          item.bindingEpochAtCreation !== token.scope.bindingEpoch || item.domain !== 'progress')) return this.failed('account-mismatch', token);
      const pushed = await this.request(token, { method: 'POST', path: ApiClient.PATHS.operations,
        body: { baseRevision: this.store.state.serverRevision, operations: batch.map(item =>
          ({ operationId: item.operationId, type: item.type, payload: item.payload })) } });
      if (!pushed.ok) return this.failed(pushed.error.code, token);
      const data = pushed.data;
      if (!Array.isArray(data.acceptedOperationIds) || !Number.isSafeInteger(data.revision) || data.revision < this.store.state.serverRevision) return this.failed('invalid-response');
      const sent = new Set(batch.map(item => item.operationId));
      const accepted = new Set(data.acceptedOperationIds.filter(id => sent.has(id)));
      if (!this.updateMetadata({ revisions: Object.assign({}, this.store.currentScope().revisions,
        { progress: data.revision }) }, token, Array.from(accepted))) return this.failed('persist-failed', token);
    }
    if (!this.updateMetadata({ lastSyncAt: Date.now(), lastError: null,
      snapshotRequired: reconciliationPending || this.store.state.pendingOperations.length > 0 }, token)) return this.failed('persist-failed', token);
    this.status = this.store.state.snapshotRequired ? 'pending' : 'synced';
    if (this.behavior) this.behavior.track('progress_sync_succeeded', { reason: this.status });
    return { ok: true, status: this.status };
  }

  failed(reason, token) {
    this.status = reason === 'account-mismatch' ? 'account-mismatch' : 'error';
    if (!token || this.store.matches(token.scope)) this.store.updateScope({ lastError: reason }, token ? token.scope : this.store.context());
    if (this.behavior) this.behavior.track('progress_sync_failed', { reason });
    return { ok: false, reason };
  }
}

module.exports = ProgressSyncService;
