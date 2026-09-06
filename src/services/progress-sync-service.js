'use strict';

const ApiClient = require('./api-client.js');
const SyncStore = require('./sync-store.js');

class ProgressSyncService {
  constructor(api, progress, syncStore, auth, config, behavior, services) {
    this.api = api;
    this.progress = progress;
    this.store = syncStore;
    this.auth = auth;
    this.config = config || {};
    this.behavior = behavior || null;
    this.services = services || {};
    this.applier = this.services.applier || null;
    this.prepareMigrationSnapshot = this.services.prepareMigrationSnapshot || null;
    this.inFlight = null;
    this.status = 'idle';
    // Result-screen feedback is process-local UI state. Keep observers out of
    // SyncStore while allowing a later retry to settle the original screen.
    this.operationObservers = new Map();
  }

  state() {
    return { status: this.status, pending: this.store.state.pendingOperations.length,
      lastSyncAt: this.store.state.lastSyncAt, lastError: this.store.state.lastError };
  }

  observeOperation(operationId, observer) {
    if (typeof operationId !== 'string' || typeof observer !== 'function') return;
    this.operationObservers.set(operationId, observer);
  }

  settleOperationObservers(results) {
    if (!Array.isArray(results)) return;
    results.forEach(result => {
      if (!result || result.status === 'RETRYABLE') return;
      const observer = this.operationObservers.get(result.operationId);
      if (!observer) return;
      this.operationObservers.delete(result.operationId);
      try { observer(result); } catch (error) {}
    });
  }

  enqueueCompletion(input, observer) {
    if (!input || !Number.isInteger(input.setIndex) || !Number.isInteger(input.levelIndex) ||
        !Number.isFinite(input.elapsedMs) || input.elapsedMs <= 0) return false;
    const mode = this.store.authorityMode ? this.store.authorityMode('progress') : this.store.state.authorityMode;
    if (mode === 'migration-freeze' || !this.store.allowsLocalGameplay()) return false;
    const session = this.auth.current();
    if (this.store.state.activeOwnerId === null && this.store.state.boundUserId &&
        session && session.userId === this.store.state.boundUserId && !this.store.bindLegacyUser(session.userId)) return false;
    const levelKey = `${input.setIndex}:${input.levelIndex}`;
    const occurredAtClient = Math.max(0, Math.round(Number(input.completedAtClient) || Date.now()));
    if (mode === 'cloud-authoritative') {
      const queued = this.store.enqueueOperation({ domain: 'progress', type: 'MAIN_LEVEL_COMPLETED', occurredAtClient,
        payload: { levelKey, elapsedMs: Math.max(1, Math.round(input.elapsedMs)) } });
      if (queued.ok) {
        this.observeOperation(queued.operationId, observer);
        this.flush().catch(function () {});
      }
      return queued.ok;
    }
    const payload = { levelKey, elapsedMs: Math.max(1, Math.round(input.elapsedMs)), completedAtClient: occurredAtClient };
    const queued = this.store.isReadOnlyIdentityScope() ? this.store.enqueueLocal(payload) : this.store.enqueue(payload);
    if (this.config.enabled === true) this.flush().catch(function () {});
    return queued;
  }

  enqueueLastPlayed(input) {
    if (!input || !Number.isInteger(input.setIndex) || input.setIndex < 0 ||
        !Number.isInteger(input.levelIndex) || input.levelIndex < 0 ||
        (this.store.authorityMode && this.store.authorityMode('progress') !== 'cloud-authoritative')) return false;
    const queued = this.store.enqueueOperation({ domain: 'progress', type: 'PROGRESS_LAST_PLAYED',
      occurredAtClient: Math.max(0, Math.round(Number(input.occurredAtClient) || Date.now())),
      payload: { setIndex: input.setIndex, levelIndex: input.levelIndex } });
    if (queued.ok) this.flush().catch(function () {});
    return queued.ok;
  }

  enqueueDailyEntry(input) {
    if (!input || (this.store.authorityMode && this.store.authorityMode('daily') !== 'cloud-authoritative')) return false;
    const queued = this.store.enqueueOperation({ domain: 'daily', type: 'DAILY_ENTRY_RECORDED', occurredAtClient: Date.now(),
      payload: { dateKey: input.dateKey, dayId: input.dayId, entryKey: input.entryKey,
        entryLimit: input.entryLimit, levelIds: input.levelIds } });
    if (queued.ok) this.flush().catch(function () {});
    return queued.ok;
  }

  enqueueDailyCompletion(input, observer) {
    if (!input || (this.store.authorityMode && this.store.authorityMode('daily') !== 'cloud-authoritative')) return false;
    const queued = this.store.enqueueOperation({ domain: 'daily', type: 'DAILY_LEVEL_COMPLETED',
      occurredAtClient: input.completedAtClient, payload: input });
    if (queued.ok) {
      this.observeOperation(queued.operationId, observer);
      this.flush().catch(function () {});
    }
    return queued.ok;
  }

  enqueueShareEntitlement(rewardId) {
    if (rewardId !== 'theme:festival' || (this.store.authorityMode && this.store.authorityMode('entitlements') !== 'cloud-authoritative')) return false;
    const queued = this.store.enqueueOperation({ domain: 'entitlements', type: 'CLIENT_POLICY_SHARE_GRANTED',
      occurredAtClient: Date.now(), payload: { rewardId } });
    if (queued.ok) this.flush().catch(function () {});
    return queued.ok;
  }

  stage5Enabled(domain) {
    const transport = this.api && this.api.transport;
    return !!(transport && transport.config && transport.config.writeEnabled === true &&
      transport.config[domain === 'stamina' ? 'staminaEnabled' : 'preferencesEnabled'] === true);
  }

  unlockOrdinaryLevel(levelKey, now) {
    const stamina = this.services.stamina;
    if (!stamina) return { ok: false, reason: 'not-configured' };
    if (this.store.authorityMode('stamina') !== 'cloud-authoritative') return stamina.unlockOrdinaryLevel(levelKey, now);
    const exported = stamina.exportAuthoritativeSnapshot();
    if (!exported.ok) return { ok: false, reason: exported.reason };
    if (exported.snapshot.unlockedLevels.includes(levelKey) ||
        exported.snapshot.balance < stamina.config.ordinaryUnlockCost) return stamina.applyPendingUnlock(levelKey, now);
    if (!this.stage5Enabled('stamina')) return { ok: false, reason: 'network-required', snapshot: stamina.snapshot(now) };
    const occurredAtClient = Math.max(0, Math.round(Number(now) || Date.now()));
    const queued = this.store.enqueueOperation({ domain: 'stamina', type: 'STAMINA_LEVEL_UNLOCKED', occurredAtClient,
      payload: { levelKey } });
    if (!queued.ok) return { ok: false, reason: queued.reason, snapshot: stamina.snapshot(now) };
    const applied = stamina.applyPendingUnlock(levelKey, occurredAtClient);
    if (applied.ok) this.flush().catch(function () {});
    return applied;
  }

  refundQuickClear(levelKey, elapsedMs, now) {
    const stamina = this.services.stamina;
    if (!stamina) return { ok: false, reason: 'not-configured', refunded: 0 };
    if (this.store.authorityMode('stamina') !== 'cloud-authoritative') {
      return stamina.refundQuickClear(levelKey, elapsedMs, now);
    }
    const exported = stamina.exportAuthoritativeSnapshot();
    if (!exported.ok) return { ok: false, reason: exported.reason, refunded: 0 };
    if (!Number.isSafeInteger(elapsedMs) || elapsedMs <= 0 || elapsedMs > stamina.config.quickClearLimitMs ||
        !exported.snapshot.unlockedLevels.includes(levelKey) || exported.snapshot.refundedLevels.includes(levelKey)) {
      return stamina.applyPendingRefund(levelKey, elapsedMs, now);
    }
    if (!this.stage5Enabled('stamina')) return { ok: false, reason: 'network-required', refunded: 0,
      snapshot: stamina.snapshot(now) };
    const occurredAtClient = Math.max(0, Math.round(Number(now) || Date.now()));
    const queued = this.store.enqueueOperation({ domain: 'stamina', type: 'STAMINA_QUICK_CLEAR_REFUNDED', occurredAtClient,
      payload: { levelKey, elapsedMs: Math.round(elapsedMs) } });
    if (!queued.ok) return { ok: false, reason: queued.reason, refunded: 0, snapshot: stamina.snapshot(now) };
    const applied = stamina.applyPendingRefund(levelKey, Math.round(elapsedMs), occurredAtClient);
    if (applied.ok) this.flush().catch(function () {});
    return applied;
  }

  enqueuePreference(field, value) {
    if (this.store.authorityMode('preferences') !== 'cloud-authoritative' || !this.stage5Enabled('preferences')) return false;
    const queued = this.store.enqueueOperation({ domain: 'preferences', type: 'PREFERENCE_FIELD_SET',
      occurredAtClient: Date.now(), payload: { field, value } });
    if (queued.ok) this.flush().catch(function () {});
    return queued.ok;
  }

  async grantShareEntitlement(rewardId) {
    if (!this.enqueueShareEntitlement(rewardId)) return { ok: false, reason: 'network-required', newRewards: [] };
    const result = await this.flush();
    if (!result.ok) return { ok: false, reason: result.reason, newRewards: [] };
    return this.services.rewards && this.services.rewards.owned(rewardId)
      ? { ok: true, reason: 'client-policy-share', newRewards: [rewardId], amountDelta: 0 }
      : { ok: false, reason: 'sync-pending', newRewards: [] };
  }

  bootstrap(session) { return this.flush(session); }

  flush(session) {
    if (this.auth.mode === 'cloud') return this.bootstrapCloud(session);
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

  bootstrapReadOnly(session) {
    const transport = this.api.transport;
    if (!this.auth.readOnlyPhase || !transport || transport.config.readEnabled !== true || !this.api.isConfigured()) return Promise.resolve({ ok: false, reason: 'not-configured' });
    const current = session || this.auth.current();
    if (!current || current.mode !== 'cloud' || current.readPaused) return Promise.resolve({ ok: false, reason: 'account-mismatch' });
    if (this.inFlight) return this.inFlight;
    const scope = this.store.context(); const account = this.accountGuard && this.accountGuard.capture();
    const matches = () => {
      const active = this.auth.current();
      return active && active.ownerId === current.ownerId && active.bindingEpoch === current.bindingEpoch &&
        active.environmentId === current.environmentId && active.generation === current.generation && this.store.matches(scope) &&
        (!account || this.accountGuard.matches(account));
    };
    if (!matches()) return Promise.resolve({ ok: false, reason: 'account-mismatch' });
    this.status = 'cloud-reading';
    this.inFlight = Promise.resolve().then(async () => {
      const response = await this.api.request(Object.assign({}, ApiClient.OPERATIONS.readOnlyState, {
        requestId: SyncStore.opaqueId('req'), auth: true, payload: {
          claimedPlayerId: current.ownerId, bindingEpoch: current.bindingEpoch, environmentId: current.environmentId,
          knownRevisions: this.store.currentScope().revisions
        }
      }));
      if (!matches()) return { ok: false, reason: 'account-mismatch' };
      if (!response.ok) { this.status = 'error'; return { ok: false, reason: response.error.code }; }
      const data = response.data;
      if (!ApiClient.validateReadOnlyEnvelope(data, current.environmentId) || data.player.playerId !== current.ownerId ||
          data.player.bindingEpoch !== current.bindingEpoch) { this.status = 'error'; return { ok: false, reason: 'invalid-response' }; }
      // Native SDK results may belong to another JS realm. Persist a local,
      // allowlisted summary, not the foreign envelope or any business fields.
      const summary = { serverTimeMs: data.serverTimeMs, serverDateKey: data.serverDateKey,
        revisions: Object.assign({}, data.revisions) };
      if (!this.store.recordReadOnlySummary(summary, scope)) { this.status = 'error'; return { ok: false, reason: 'persist-failed' }; }
      this.status = 'cloud-readonly';
      return { ok: true, status: this.status, readOnlyPhase: true };
    }).catch(() => { if (matches()) this.status = 'error'; return { ok: false, reason: 'network' }; })
      .finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  cloudMatches(current, scope, account) {
    const active = this.auth.current();
    return active && active.ownerId === current.ownerId && active.bindingEpoch === current.bindingEpoch &&
      active.environmentId === current.environmentId && active.generation === current.generation &&
      this.store.matches(scope) && (!account || !this.accountGuard || this.accountGuard.matches(account));
  }

  cloudRequest(operation, current, scope, account, payload, extra) {
    if (!this.cloudMatches(current, scope, account)) return Promise.resolve(ApiClient.failure('account-mismatch'));
    return this.api.request(Object.assign({}, operation, extra || {}, { requestId: SyncStore.opaqueId('req'), auth: true,
      payload: Object.assign({ claimedPlayerId: current.ownerId, bindingEpoch: current.bindingEpoch,
        environmentId: current.environmentId }, payload) }));
  }

  localCoreBlank() {
    return !!(this.progress && this.progress.isBlankCloudCore && this.progress.isBlankCloudCore() &&
      this.services.daily && this.services.daily.isBlankCloudCore && this.services.daily.isBlankCloudCore() &&
      this.services.rewards && this.services.rewards.isBlankCloudCore && this.services.rewards.isBlankCloudCore() &&
      (!this.services.economy || !this.services.economy.hasPendingPurchase ||
        !this.services.economy.hasPendingPurchase(this.auth.current())) &&
      this.store.currentScope().pendingOperations.length === 0);
  }

  normalizeReceipt(data, current, value) {
    return { protocolVersion: 1, environmentId: current.environmentId, ownerId: current.ownerId,
      bindingEpoch: current.bindingEpoch, receiptId: value.receiptId, revisions: value.revisions || data.revisions,
      domains: value.domains || value.changedDomains || {}, acceptedOperationIds: value.acceptedOperationIds || [],
      notificationHints: value.notificationHints || [], results: value.results || [] };
  }

  bootstrapCloud(session) {
    const transport = this.api.transport;
    if (!transport || transport.config.readEnabled !== true || !this.api.isConfigured()) {
      return Promise.resolve({ ok: false, reason: 'not-configured' });
    }
    const current = session || this.auth.current();
    if (!current || current.mode !== 'cloud' || current.readPaused) return Promise.resolve({ ok: false, reason: 'account-mismatch' });
    if (this.inFlight) return this.inFlight;
    const scope = this.store.context(); const account = this.accountGuard && this.accountGuard.capture();
    if (!this.cloudMatches(current, scope, account)) return Promise.resolve({ ok: false, reason: 'account-mismatch' });
    this.status = 'cloud-reading';
    this.inFlight = this.runCloud(current, scope, account).catch(() => this.cloudFailed('network', current, scope, account))
      .finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  async runCloud(current, scope, account) {
    if (this.applier && typeof this.applier.resumePending === 'function') {
      const recovered = await this.applier.resumePending(account);
      if (!recovered.ok) return this.cloudFailed(recovered.reason, current, scope, account);
      if (recovered.resumed) {
        scope = this.store.context(); account = this.accountGuard && this.accountGuard.capture();
        if (!this.cloudMatches(current, scope, account)) {
          return this.cloudFailed('account-mismatch', current, scope, account);
        }
      }
    }
    const read = await this.cloudRequest(ApiClient.OPERATIONS.stateRead, current, scope, account,
      { knownRevisions: this.store.currentScope().revisions });
    if (!this.cloudMatches(current, scope, account)) return this.cloudFailed('account-mismatch', current, scope, account);
    if (!read.ok) return this.cloudFailed(read.error.code, current, scope, account);
    if (!ApiClient.validateStateEnvelope(read.data, current.environmentId) ||
        read.data.player.playerId !== current.ownerId || read.data.player.bindingEpoch !== current.bindingEpoch) {
      return this.cloudFailed('invalid-response', current, scope, account);
    }
    if (read.data.data.hasCloudState === true) {
      if (!this.store.ownsLocalState()) {
        if (!this.localCoreBlank()) {
          if (this.api.transport.config.migrationEnabled !== true) {
            this.status = 'migration-required'; return { ok: false, reason: 'migration-required' };
          }
          return this.runMigration(current, scope, account);
        }
      }
      const receipt = this.normalizeReceipt(read.data, current, {
        receiptId: read.data.data.receiptId, revisions: read.data.revisions,
        domains: read.data.data.changedDomains, acceptedOperationIds: []
      });
      const adopting = !this.store.ownsLocalState();
      const applied = await this.applier.applySyncReceipt(receipt, account,
        { adoptLocal: adopting, migration: adopting, importId: read.data.data.migrationImportId,
          migrationReceiptId: read.data.data.migrationReceiptId });
      if (!applied.ok) return this.cloudFailed(applied.reason, current, scope, account);
      const stage5 = this.ensureStage5Bootstrap(read.data.data.deferredDomains);
      if (!stage5.ok) return this.cloudFailed(stage5.reason, current, this.store.context(),
        this.accountGuard && this.accountGuard.capture());
      return this.pushCloud(current, this.store.context(), this.accountGuard && this.accountGuard.capture());
    }
    if (this.auth.readOnlyPhase || this.api.transport.config.migrationEnabled !== true) {
      const summary = { serverTimeMs: read.data.serverTimeMs, serverDateKey: read.data.serverDateKey,
        revisions: Object.assign({}, read.data.revisions) };
      if (!this.store.recordReadOnlySummary(summary, scope)) return this.cloudFailed('persist-failed', current, scope, account);
      this.status = this.auth.readOnlyPhase ? 'cloud-readonly' : 'migration-required';
      return { ok: true, status: this.status, readOnlyPhase: this.auth.readOnlyPhase };
    }
    return this.runMigration(current, scope, account);
  }

  ensureStage5Bootstrap(deferredDomains) {
    const deferred = Array.isArray(deferredDomains) ? deferredDomains : [];
    const pending = this.store.currentScope().pendingOperations;
    const definitions = [
      ['stamina', 'STAMINA_BOOTSTRAP', this.services.stamina],
      ['preferences', 'PREFERENCES_BOOTSTRAP', this.services.preferences]
    ];
    for (const [domain, type, service] of definitions) {
      if (!deferred.includes(domain) || !this.stage5Enabled(domain) ||
          pending.some(operation => operation.domain === domain && operation.type === type)) continue;
      const exported = service && service.exportAuthoritativeSnapshot && service.exportAuthoritativeSnapshot();
      if (!exported || !exported.ok) return { ok: false, reason: exported && exported.reason || 'invalid-snapshot' };
      const queued = this.store.enqueueOperation({ domain, type, occurredAtClient: Date.now(),
        payload: { snapshot: exported.snapshot } });
      if (!queued.ok) return queued;
    }
    return { ok: true };
  }

  migrationSummary(snapshot) {
    const progress = Object.keys(snapshot.progress.levels).filter(key => snapshot.progress.levels[key].completed === true);
    const days = Object.keys(snapshot.daily.days);
    return { completedCount: progress.length, dailyCount: days.length, balance: snapshot.economy.balance,
      ordinaryClaimCount: Object.keys(snapshot.economy.claimedOrdinary).length,
      dailyClaimCount: Object.keys(snapshot.economy.claimedDaily).length,
      entitlementCount: Object.keys(snapshot.entitlements.ownedRewards)
        .filter(key => !['theme:classic', 'effect:none'].includes(key)).length };
  }

  migrationChunks(snapshot) {
    const groups = {
      progress: Object.keys(snapshot.progress.levels).filter(key => snapshot.progress.levels[key].completed === true).sort().map(levelKey => {
        const value = snapshot.progress.levels[levelKey]; const result = { levelKey };
        if (Number.isFinite(value.bestMs) && value.bestMs > 0) result.bestMs = Math.round(value.bestMs);
        return result;
      }),
      daily: Object.keys(snapshot.daily.days).sort().map(dateKey => {
        const day = snapshot.daily.days[dateKey];
        return { dateKey, dayId: day.dayId, entryLimit: day.entryLimit, entriesUsed: day.entriesUsed,
          completed: day.completed, levels: day.levels, levelIds: day.levelIds,
          levelCount: day.levelCount, entryKeys: day.entryKeys };
      }),
      'economy:ordinary-claims': Object.keys(snapshot.economy.claimedOrdinary).filter(key => snapshot.economy.claimedOrdinary[key] === true)
        .sort().map(levelKey => ({ levelKey })),
      'economy:daily-claims': Object.keys(snapshot.economy.claimedDaily).sort().map(dateKey =>
        ({ dateKey, dayId: snapshot.economy.claimedDaily[dateKey] })),
      entitlements: Object.keys(snapshot.entitlements.ownedRewards).filter(key =>
        snapshot.entitlements.ownedRewards[key] === true && !['theme:classic', 'effect:none'].includes(key)).sort().map(rewardId => ({ rewardId }))
    };
    const result = { 'progress:resume': [{ lastPlayed: snapshot.progress.lastPlayed || null }],
      'economy:opening-balance': [{ balance: snapshot.economy.balance }] };
    Object.keys(groups).forEach(prefix => {
      for (let index = 0; index < Math.ceil(groups[prefix].length / 50); index++) {
        result[`${prefix}:${index}`] = groups[prefix].slice(index * 50, index * 50 + 50);
      }
    });
    return result;
  }

  migrationManifestMatches(value, snapshot, existing) {
    if (!value || !['PRIMARY', 'SUPPLEMENTAL'].includes(value.role)) return false;
    const expected = Object.keys(this.migrationChunks(snapshot)).filter(chunkId =>
      value.role === 'PRIMARY' || !chunkId.startsWith('economy:')).sort();
    const actual = value.requiredChunks.slice().sort();
    if (expected.length !== actual.length || expected.some((chunkId, index) => chunkId !== actual[index])) return false;
    return !existing || (existing.role === value.role && existing.prepareReceiptId === value.prepareReceiptId &&
      existing.requiredChunks.slice().sort().every((chunkId, index) => chunkId === actual[index]) &&
      existing.requiredChunks.length === actual.length);
  }

  async runMigration(current, scope, account) {
    this.status = 'migration-preparing';
    const existing = this.store.currentScope().migration;
    const archived = existing && this.store.migrationSnapshot &&
      this.store.migrationSnapshot(existing.importId, existing.snapshotHash);
    if (existing && !archived) return this.cloudFailed('migration-snapshot-missing', current, scope, account);
    const built = existing
      ? archived && { ok: true, snapshot: archived, snapshotHash: existing.snapshotHash }
      : this.prepareMigrationSnapshot && this.prepareMigrationSnapshot();
    if (!built || !built.ok) return this.cloudFailed(built && built.reason || 'migration-not-ready', current, scope, account);
    const importId = existing ? existing.importId : `import_${this.store.state.migrationId}`;
    let prepared;
    if (existing) {
      const status = await this.cloudRequest(ApiClient.OPERATIONS.migrationStatus, current, scope, account, { importId });
      if (!status.ok || !ApiClient.validateMigrationEnvelope(status.data, current.environmentId, 'migration.status')) {
        return this.cloudFailed(status.ok ? 'invalid-response' : status.error.code, current, scope, account);
      }
      prepared = status.data.data;
    } else {
      const response = await this.cloudRequest(ApiClient.OPERATIONS.migrationPrepare, current, scope, account, {
        importId, policyVersion: built.snapshot.policyVersion, snapshotHash: built.snapshotHash,
        source: built.snapshot.source, summary: this.migrationSummary(built.snapshot)
      });
      if (!response.ok || !ApiClient.validateMigrationEnvelope(response.data, current.environmentId, 'migration.prepare')) {
        return this.cloudFailed(response.ok ? 'invalid-response' : response.error.code, current, scope, account);
      }
      prepared = response.data.data;
      // The prepare round trip occurs before the local freeze by design. Build
      // the candidate once more and refuse to freeze if any source domain
      // changed while the request was in flight.
      const rechecked = this.prepareMigrationSnapshot && this.prepareMigrationSnapshot();
      if (!rechecked || !rechecked.ok || rechecked.snapshotHash !== built.snapshotHash) {
        return this.cloudFailed(rechecked && rechecked.reason || 'snapshot-changed', current, scope, account);
      }
      if (!this.migrationManifestMatches(prepared, built.snapshot, null)) {
        return this.cloudFailed('invalid-response', current, scope, account);
      }
      const recorded = this.store.recordServerMigration({ importId, policyVersion: built.snapshot.policyVersion,
        snapshotHash: built.snapshotHash, prepareReceiptId: prepared.prepareReceiptId, role: prepared.role,
        requiredChunks: prepared.requiredChunks, completedChunks: prepared.completedChunks,
        snapshot: built.snapshot }, scope);
      if (!recorded.ok || !this.services.rewards.setAuthorityMode('migration-freeze')) {
        return this.cloudFailed(recorded.reason || 'persist-failed', current, scope, account);
      }
    }
    if (!this.migrationManifestMatches(prepared, built.snapshot, existing)) {
      return this.cloudFailed('invalid-response', current, scope, account);
    }
    const chunks = this.migrationChunks(built.snapshot); this.status = 'migration-uploading';
    for (const chunkId of prepared.requiredChunks) {
      if (prepared.completedChunks.includes(chunkId)) continue;
      const records = chunks[chunkId];
      if (!Array.isArray(records)) return this.cloudFailed('invalid-migration-chunk', current, scope, account);
      const response = await this.cloudRequest(ApiClient.OPERATIONS.migrationCommitChunk, current, scope, account, {
        importId, prepareReceiptId: prepared.prepareReceiptId, chunkId,
        domain: chunkId.startsWith('economy:') ? 'economy' : chunkId.split(':')[0],
        clientChunkHash: require('./sync-payload.js').fingerprint(records), records
      });
      if (!response.ok || !ApiClient.validateMigrationEnvelope(response.data, current.environmentId, 'migration.commitChunk')) {
        return this.cloudFailed(response.ok ? 'invalid-response' : response.error.code, current, scope, account);
      }
      const chunkResult = response.data.data;
      if (chunkResult.chunkId !== chunkId || !chunkResult.completedChunks.includes(chunkId) ||
          prepared.completedChunks.some(id => !chunkResult.completedChunks.includes(id)) ||
          chunkResult.completedChunks.some(id => !prepared.requiredChunks.includes(id))) {
        return this.cloudFailed('invalid-response', current, scope, account);
      }
      prepared.completedChunks = chunkResult.completedChunks;
      if (!this.store.markMigrationChunks(prepared.completedChunks, this.store.context())) {
        return this.cloudFailed('persist-failed', current, scope, account);
      }
      scope = this.store.context(); account = this.accountGuard && this.accountGuard.capture();
    }
    const finalized = await this.cloudRequest(ApiClient.OPERATIONS.migrationFinalize, current, scope, account, {
      importId, prepareReceiptId: prepared.prepareReceiptId, policyVersion: built.snapshot.policyVersion
    });
    if (!finalized.ok || !ApiClient.validateMigrationEnvelope(finalized.data, current.environmentId, 'migration.finalize')) {
      return this.cloudFailed(finalized.ok ? 'invalid-response' : finalized.error.code, current, scope, account);
    }
    this.status = 'migration-applying';
    const value = finalized.data.data;
    if (value.role !== prepared.role) return this.cloudFailed('invalid-response', current, scope, account);
    const receipt = this.normalizeReceipt(finalized.data, current, value);
    const applied = await this.applier.applyMigrationFinalization(receipt, account,
      { importId, migrationReceiptId: value.migrationReceiptId });
    if (!applied.ok) return this.cloudFailed(applied.reason, current, scope, account);
    if (this.auth.cloudReady) { this.auth.cloudReady.migrationState = 'complete'; this.auth.cloudReady.hasCloudState = true; }
    this.status = 'cloud-synced'; return { ok: true, status: this.status, migrated: true,
      role: value.role, conflicts: value.conflicts.slice(), localSnapshotPreserved: true };
  }

  async pushCloud(current, scope, account) {
    if (!this.cloudMatches(current, scope, account)) return this.cloudFailed('account-mismatch', current, scope, account);
    const allPending = this.store.currentScope().pendingOperations;
    const pending = allPending.filter(item => SyncStore.CORE_DOMAINS.includes(item.domain) ||
      (item.domain === 'stamina' && this.stage5Enabled('stamina')) ||
      (item.domain === 'preferences' && this.stage5Enabled('preferences'))).slice(0, 50);
    if (!pending.length || this.api.transport.config.writeEnabled !== true) {
      this.status = allPending.length ? 'cloud-pending' : 'cloud-synced';
      return { ok: true, status: this.status, pending: allPending.length };
    }
    if (pending.some(item => item.ownerIdAtCreation !== current.ownerId || item.bindingEpochAtCreation !== current.bindingEpoch ||
        item.environmentIdAtCreation !== current.environmentId ||
        !(SyncStore.CORE_DOMAINS.includes(item.domain) || ['stamina', 'preferences'].includes(item.domain)))) {
      return this.cloudFailed('account-mismatch', current, scope, account);
    }
    const sentIds = pending.map(item => item.operationId);
    if (!this.store.markOperationsInFlight(sentIds, scope)) return this.cloudFailed('operation-in-flight', current, scope, account);
    try {
      const response = await this.cloudRequest(ApiClient.OPERATIONS.syncPush, current, scope, account, {
        knownRevisions: this.store.currentScope().revisions,
        operations: pending.map(item => ({ operationId: item.operationId, domain: item.domain, type: item.type,
          ownerIdAtCreation: item.ownerIdAtCreation, bindingEpochAtCreation: item.bindingEpochAtCreation,
          environmentIdAtCreation: item.environmentIdAtCreation, occurredAtClient: item.occurredAtClient,
          clientPayloadHash: item.payloadHash, payload: item.payload }))
      });
      if (!response.ok || !ApiClient.validateSyncEnvelope(response.data, current.environmentId)) {
        return this.cloudFailed(response.ok ? 'invalid-response' : response.error.code, current, scope, account);
      }
      const applied = await this.applier.applySyncReceipt(this.normalizeReceipt(response.data, current, response.data.data),
        account, { expectedOperationIds: sentIds });
      if (!applied.ok) return this.cloudFailed(applied.reason, current, scope, account);
      this.settleOperationObservers(response.data.data.results);
      const remaining = this.store.currentScope().pendingOperations.length;
      this.status = remaining ? 'cloud-pending' : 'cloud-synced';
      return { ok: true, status: this.status, pending: remaining, results: response.data.data.results };
    } finally { this.store.clearOperationsInFlight(sentIds); }
  }

  cloudFailed(reason, current, scope, account) {
    const stillCurrent = this.cloudMatches(current, scope, account);
    if (stillCurrent && ['network', 'timeout', 'STORE_TEMPORARY'].includes(reason)) {
      this.store.updateScope({ lastError: reason }, scope);
    }
    if (!stillCurrent && reason === 'account-mismatch') return { ok: false, reason };
    this.status = reason === 'account-mismatch' ? 'account-mismatch' :
      reason === 'persist-failed' ? 'storage-blocked' :
        ['migration-required', 'migration-snapshot-missing'].includes(reason) ? reason : 'error';
    return { ok: false, reason };
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
