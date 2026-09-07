'use strict';

const ApiClient = require('./api-client.js');
const SyncStore = require('./sync-store.js');
const BackupSnapshot = require('./backup-snapshot.js');

const COOLDOWN_MS = 3 * 60 * 1000;

class CloudBackupService {
  constructor(api, auth, store, snapshots, applier, config, options) {
    this.api = api; this.auth = auth; this.store = store; this.snapshots = snapshots; this.applier = applier;
    this.config = config || {}; this.now = options && options.now || Date.now;
    this.initialArchive = options && options.initialArchive || { known: false, exists: true };
    this.initialReadAttempted = false; this.inFlight = null; this.readFlight = null;
    this.remoteCandidate = null; this.conflict = null; this.status = 'local'; this.lastError = null;
    this.accountGuard = null;
  }

  enabled() { return this.config.localBackupEnabled === true; }
  state() {
    const scope = this.store && this.store.currentScope(); const backup = scope && scope.backup;
    return { status: this.status, dirty: !!(backup && backup.dirty), cloudVersion: backup ? backup.cloudVersion : 0,
      localVersion: backup ? backup.localVersion : 0, lastSuccessAt: backup ? backup.lastSuccessAt : 0,
      lastError: this.lastError || backup && backup.lastError || null, inFlight: !!(this.inFlight || this.readFlight),
      confirmRestore: !!this.remoteCandidate, confirmBackup: !!this.conflict };
  }

  capture() {
    const session = this.auth && this.auth.current(); const scope = this.store && this.store.context();
    const account = this.accountGuard && this.accountGuard.capture();
    return session && scope && { session, scope, account };
  }
  matches(token) {
    const current = this.auth && this.auth.current();
    return !!token && !!current && current.ownerId === token.session.ownerId &&
      current.bindingEpoch === token.session.bindingEpoch && current.environmentId === token.session.environmentId &&
      current.generation === token.session.generation && this.store.matches(token.scope) &&
      (!token.account || !this.accountGuard || this.accountGuard.matches(token.account));
  }

  activate(token) {
    if (!this.matches(token)) return { ok: false, reason: 'account-mismatch' };
    const activated = this.store.enableLocalBackup(token.scope);
    if (!activated.ok) return activated;
    const services = this.applier && this.applier.services || {};
    if (services.rewards && !services.rewards.setAuthorityMode('local-backup')) return { ok: false, reason: 'authority-mismatch' };
    if (services.stamina && !services.stamina.setAuthorityMode('local-backup')) return { ok: false, reason: 'authority-mismatch' };
    return { ok: true };
  }

  async bootstrap(session) {
    if (!this.enabled() || !session || session.mode !== 'cloud') return { ok: false, reason: 'not-configured' };
    const token = this.capture();
    if (!token || !this.matches(token)) return { ok: false, reason: 'account-mismatch' };
    const activated = this.activate(token);
    if (!activated.ok) return activated;
    const active = this.capture();
    const resumed = this.applier && this.applier.resumeBackupRestore
      ? await this.applier.resumeBackupRestore(active.account || this.applier.capture()) : { ok: true, resumed: false };
    if (!resumed.ok) { this.status = 'restore-pending'; this.lastError = resumed.reason; return resumed; }
    const restoredBackup = this.store.currentScope().backup;
    if (restoredBackup.conflictVersion !== null) {
      this.conflict = { cloudVersion: restoredBackup.conflictVersion };
      this.status = 'backup-conflict'; this.lastError = 'backup-version-conflict';
    }
    if (this.initialArchive.known === true && this.initialArchive.exists === false && !this.initialReadAttempted) {
      this.initialReadAttempted = true;
      const read = await this.read({ automatic: true });
      if (!read.ok) return read;
      if (read.found) return this.applyCandidate(true);
    }
    const backup = this.store.currentScope().backup;
    this.status = backup.conflictVersion !== null ? 'backup-conflict'
      : backup.dirty ? 'backup-pending' : 'backed-up';
    this.lastError = backup.conflictVersion !== null ? 'backup-version-conflict' : null;
    return { ok: true, status: this.status };
  }

  request(action, token, payload, requestId) {
    return this.api.request(Object.assign({}, action, { requestId, auth: true, payload: Object.assign({
      claimedPlayerId: token.session.ownerId, bindingEpoch: token.session.bindingEpoch,
      environmentId: token.session.environmentId
    }, payload || {}) }));
  }

  read(options) {
    if (this.readFlight) return this.readFlight;
    const token = this.capture();
    if (!token || !this.matches(token)) return Promise.resolve({ ok: false, reason: 'account-mismatch' });
    const now = this.now(); const requestId = SyncStore.opaqueId('req');
    const localVersionAtRead = this.store.currentScope().backup.localVersion;
    if (!this.store.updateBackup({ lastAttemptAt: now }, token.scope)) return Promise.resolve({ ok: false, reason: 'persist-failed' });
    this.status = 'reading';
    this.readFlight = this.request(ApiClient.OPERATIONS.backupRead, token, {}, requestId).then(response => {
      if (!this.matches(token)) return { ok: false, reason: 'account-mismatch' };
      if (!response.ok) {
        this.status = 'error'; this.lastError = response.error.code;
        this.store.updateBackup({ lastError: options && options.automatic ? 'backup-read-failed' : response.error.code }, token.scope);
        return { ok: false, reason: response.error.code };
      }
      if (!ApiClient.validateBackupReadEnvelope(response.data, token.session.environmentId)) {
        this.status = 'error'; this.lastError = 'invalid-response'; return { ok: false, reason: 'invalid-response' };
      }
      const data = response.data.data;
      this.lastError = null;
      if (!data.found) {
        this.store.updateBackup({ remoteKnown: true, cloudVersion: 0, conflictVersion: null,
          lastError: null, lastSnapshotHash: null }, token.scope);
        this.remoteCandidate = null; this.conflict = null; this.status = 'no-cloud-backup';
        return { ok: true, found: false, cloudVersion: 0 };
      }
      // A read is only a restore candidate. It must not become an accepted
      // commit base until the player confirms and the restore fully persists.
      this.store.updateBackup({ remoteKnown: true, lastError: null }, token.scope);
      this.remoteCandidate = { token, cloudVersion: data.cloudVersion, snapshotHash: data.snapshotHash,
        snapshot: data.snapshot, localVersionAtRead };
      this.status = 'restore-confirmation';
      return { ok: true, found: true, cloudVersion: data.cloudVersion };
    }).catch(() => {
      if (this.matches(token)) {
        this.status = 'error'; this.lastError = 'network';
        this.store.updateBackup({ lastError: options && options.automatic ? 'backup-read-failed' : 'network' }, token.scope);
      }
      return { ok: false, reason: 'network' };
    }).finally(() => { this.readFlight = null; });
    return this.readFlight;
  }

  requestRestore() { return this.read({ automatic: false }); }

  async applyCandidate(automatic) {
    const candidate = this.remoteCandidate;
    if (!candidate || !this.matches(candidate.token)) return { ok: false, reason: 'account-mismatch' };
    const currentVersion = this.store.currentScope().backup.localVersion;
    if (currentVersion !== candidate.localVersionAtRead) {
      this.remoteCandidate = null; this.status = 'restore-confirmation-stale';
      return { ok: false, reason: 'restore-confirmation-stale' };
    }
    const account = candidate.token.account || this.applier.capture();
    const result = await this.applier.applyBackupRestore({ schemaVersion: 1,
      restoreId: SyncStore.opaqueId('restore'), cloudVersion: candidate.cloudVersion,
      localVersionAtConfirmation: currentVersion, snapshotHash: candidate.snapshotHash,
      snapshot: candidate.snapshot }, account);
    if (result.ok) { this.remoteCandidate = null; this.conflict = null; this.status = 'backed-up'; this.lastError = null; }
    else { this.status = 'restore-pending'; this.lastError = result.reason; }
    return result;
  }

  confirmRestore() { return this.applyCandidate(false); }

  ensureDirty(token, built) {
    const backup = this.store.currentScope().backup;
    if (backup.dirty || backup.lastSnapshotHash === built.snapshotHash) return true;
    return this.store.markBackupDirty(token.scope);
  }

  commit(options) {
    if (this.inFlight) return this.inFlight;
    const token = this.capture();
    if (!token || !this.matches(token)) return Promise.resolve({ ok: false, reason: 'account-mismatch' });
    const beforeBuild = this.store.currentScope().backup;
    const confirmedVersion = options && options.confirmConflict ? options.confirmedCloudVersion : null;
    if (beforeBuild.conflictVersion !== null &&
        (!Number.isSafeInteger(confirmedVersion) || confirmedVersion !== beforeBuild.conflictVersion)) {
      return Promise.resolve({ ok: false, reason: 'backup-version-conflict',
        cloudVersion: beforeBuild.conflictVersion });
    }
    const built = this.snapshots.build();
    if (!built.ok) return Promise.resolve(built);
    if (!this.ensureDirty(token, built)) return Promise.resolve({ ok: false, reason: 'persist-failed' });
    const backup = this.store.currentScope().backup;
    if (!backup.dirty) return Promise.resolve({ ok: true, status: 'backed-up', skipped: true });
    if (!backup.remoteKnown && backup.lastError === 'backup-read-failed' && !(options && options.confirmConflict)) {
      return Promise.resolve({ ok: false, reason: 'cloud-state-unknown' });
    }
    const now = this.now();
    if (!(options && options.manual) && now >= backup.lastAttemptAt && now - backup.lastAttemptAt < COOLDOWN_MS) {
      return Promise.resolve({ ok: true, status: 'backup-pending', skipped: true, reason: 'cooldown' });
    }
    if (!this.store.updateBackup({ lastAttemptAt: now, lastError: null }, token.scope)) {
      return Promise.resolve({ ok: false, reason: 'persist-failed' });
    }
    const baseVersion = confirmedVersion === null ? backup.cloudVersion : confirmedVersion;
    const capturedVersion = backup.localVersion; const requestId = SyncStore.opaqueId('backup');
    this.status = 'backing-up';
    this.inFlight = this.request(ApiClient.OPERATIONS.backupCommit, token, { baseVersion,
      localVersion: capturedVersion, snapshotHash: built.snapshotHash, snapshot: built.snapshot }, requestId).then(response => {
      if (!this.matches(token)) return { ok: false, reason: 'account-mismatch' };
      if (!response.ok) { this.status = 'error'; this.lastError = response.error.code;
        this.store.updateBackup({ lastError: response.error.code }, token.scope); return { ok: false, reason: response.error.code }; }
      if (!ApiClient.validateBackupCommitEnvelope(response.data, token.session.environmentId, requestId,
        built.snapshotHash, baseVersion)) {
        this.status = 'error'; this.lastError = 'invalid-response'; return { ok: false, reason: 'invalid-response' };
      }
      const data = response.data.data;
      if (data.status === 'CONFLICT') {
        this.conflict = { cloudVersion: data.cloudVersion };
        this.store.updateBackup({ remoteKnown: true, conflictVersion: data.cloudVersion,
          lastError: 'backup-version-conflict' }, token.scope);
        this.status = 'backup-conflict'; return { ok: false, reason: 'backup-version-conflict', cloudVersion: data.cloudVersion };
      }
      const latest = this.store.currentScope().backup;
      const clean = latest.localVersion === capturedVersion;
      this.store.updateBackup({ remoteKnown: true, cloudVersion: data.cloudVersion, dirty: clean ? false : latest.dirty,
        lastSuccessAt: this.now(), lastError: null, conflictVersion: null,
        lastSnapshotHash: clean ? built.snapshotHash : latest.lastSnapshotHash }, token.scope);
      this.conflict = null; this.status = clean ? 'backed-up' : 'backup-pending'; this.lastError = null;
      return { ok: true, status: this.status, cloudVersion: data.cloudVersion, newerLocalChanges: !clean };
    }).catch(() => {
      if (this.matches(token)) {
        this.status = 'error'; this.lastError = 'network';
        this.store.updateBackup({ lastError: 'network' }, token.scope);
      }
      return { ok: false, reason: 'network' };
    }).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  atCheckpoint(reason) {
    if (!['home', 'account', 'manual'].includes(reason)) return Promise.resolve({ ok: true, skipped: true, status: this.status });
    return this.commit({ manual: reason === 'manual' });
  }
  confirmBackup() {
    const backup = this.store.currentScope().backup;
    if (!this.conflict || backup.conflictVersion === null ||
        this.conflict.cloudVersion !== backup.conflictVersion) return Promise.resolve({ ok: false, reason: 'no-conflict' });
    return this.commit({ manual: true, confirmConflict: true, confirmedCloudVersion: backup.conflictVersion });
  }
  cancelConfirmation() { this.remoteCandidate = null; this.conflict = null; this.status = this.store.currentScope().backup.dirty ? 'backup-pending' : 'backed-up'; }
}

CloudBackupService.COOLDOWN_MS = COOLDOWN_MS;
module.exports = CloudBackupService;
