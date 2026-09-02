'use strict';

const STORAGE_KEY = 'cleared:minigame:online:v1';
const MAX_OPERATIONS = 200;
const opaqueId = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_:-]{1,180}$/.test(value);

class SyncStore {
  constructor(platform) {
    this.platform = platform;
    let saved;
    try { saved = platform.getStorage(STORAGE_KEY); } catch (error) {}
    const valid = saved && saved.schemaVersion === 1 && validId(saved.installId) && validId(saved.migrationId);
    this.state = {
      schemaVersion: 1,
      installId: valid ? saved.installId : opaqueId('ins'),
      migrationId: valid ? saved.migrationId : opaqueId('mig'),
      // Corrupt installation metadata must not erase an existing account
      // binding and silently upload that account's save to someone else.
      boundUserId: saved && saved.boundUserId
        ? (validId(saved.boundUserId) ? saved.boundUserId : '__invalid_binding__') : null,
      serverRevision: valid && Number.isSafeInteger(saved.serverRevision) && saved.serverRevision >= 0 ? saved.serverRevision : 0,
      nextOperationSequence: valid
        ? (Number.isSafeInteger(saved.nextOperationSequence) && saved.nextOperationSequence > 0 ? saved.nextOperationSequence : Number.MAX_SAFE_INTEGER) : 1,
      pendingOperations: [], snapshotRequired: valid ? saved.snapshotRequired === true : !!saved,
      lastSyncAt: valid && Number.isFinite(saved.lastSyncAt) ? saved.lastSyncAt : 0,
      lastError: null
    };
    if (valid && Array.isArray(saved.pendingOperations)) {
      saved.pendingOperations.slice(0, MAX_OPERATIONS).forEach(item => {
        const p = item && item.payload;
        if (!item || !validId(item.operationId) || item.type !== 'level_completed' ||
            !p || typeof p.levelKey !== 'string' || !/^\d+:\d+$/.test(p.levelKey) ||
            (p.elapsedMs !== undefined && (!Number.isFinite(p.elapsedMs) || p.elapsedMs <= 0)) ||
            !Number.isSafeInteger(p.completedAtClient) || p.completedAtClient < 0) {
          this.state.snapshotRequired = true;
          return;
        }
        this.state.pendingOperations.push({ operationId: item.operationId, type: item.type,
          payload: { levelKey: p.levelKey, elapsedMs: p.elapsedMs, completedAtClient: p.completedAtClient } });
      });
      if (saved.pendingOperations.length > MAX_OPERATIONS) this.state.snapshotRequired = true;
    }
    this.persisted = this.save();
  }

  save() {
    try { return this.platform.setStorage(STORAGE_KEY, this.state) === true; } catch (error) { return false; }
  }

  nextId(prefix) {
    const sequence = this.state.nextOperationSequence;
    if (!Number.isSafeInteger(sequence + 1)) return null;
    this.state.nextOperationSequence++;
    // Never expose a reusable sequence when durable storage is unavailable.
    if (!this.save()) return null;
    this.persisted = true;
    return `${prefix || ''}${this.state.installId}:${sequence}`;
  }

  enqueue(payload) {
    if (!payload || typeof payload.levelKey !== 'string' || !/^(0|[1-9]\d*):(0|[1-9]\d*)$/.test(payload.levelKey) ||
        !Number.isSafeInteger(payload.completedAtClient) || payload.completedAtClient < 0 ||
        (payload.elapsedMs !== undefined && (!Number.isFinite(payload.elapsedMs) || payload.elapsedMs <= 0))) return false;
    const id = this.nextId('');
    if (!id || this.state.pendingOperations.length >= MAX_OPERATIONS) {
      this.state.snapshotRequired = true;
      this.save();
      return false;
    }
    this.state.pendingOperations.push({ operationId: id, type: 'level_completed', payload });
    if (this.save()) return true;
    this.state.snapshotRequired = true;
    return false;
  }

  acknowledge(ids) {
    const accepted = new Set(Array.isArray(ids) ? ids : []);
    this.state.pendingOperations = this.state.pendingOperations.filter(item => !accepted.has(item.operationId));
    return this.save();
  }
}

SyncStore.STORAGE_KEY = STORAGE_KEY;
SyncStore.opaqueId = opaqueId;
module.exports = SyncStore;
