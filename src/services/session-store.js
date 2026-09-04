'use strict';

const STORAGE_KEY = 'cleared:minigame:session:v1';
const record = value => !!value && typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_:-]{1,180}$/.test(value) &&
  !['__proto__', 'constructor', 'prototype'].includes(value);
const V2_FIELDS = ['schemaVersion', 'mode', 'ownerId', 'bindingEpoch', 'environmentId',
  'migrationState', 'migrationImportId', 'migrationReceiptId', 'legacySession'];

function normalize(value) {
  if (!value || value.schemaVersion !== 1 ||
      typeof value.userId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.userId) ||
      typeof value.accessToken !== 'string' || !value.accessToken || value.accessToken.length > 4096 ||
      /[\s\x00-\x1f]/.test(value.accessToken) ||
      !Number.isSafeInteger(value.issuedAt) || value.issuedAt < 0 ||
      !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= value.issuedAt) return null;
  return { schemaVersion: 1, userId: value.userId, accessToken: value.accessToken,
    issuedAt: value.issuedAt, expiresAt: value.expiresAt };
}

function normalizeMetadata(value) {
  if (!record(value) || value.schemaVersion !== 2 || Object.keys(value).some(key => !V2_FIELDS.includes(key)) ||
      !['legacy-http', 'guest', 'cloud'].includes(value.mode) ||
      !Number.isSafeInteger(value.bindingEpoch) || value.bindingEpoch < 0 ||
      !['none', 'pending', 'prepared', 'uploading', 'complete', 'blocked'].includes(value.migrationState) ||
      (value.migrationImportId !== null && !validId(value.migrationImportId)) ||
      (value.migrationReceiptId !== null && !validId(value.migrationReceiptId))) return null;
  const legacy = value.legacySession === null ? null :
    (record(value.legacySession) ? normalize(Object.assign({}, value.legacySession, { schemaVersion: 1 })) : null);
  if (value.legacySession !== null && !legacy) return null;
  if (value.mode === 'cloud') {
    if (typeof value.ownerId !== 'string' || !/^player_[A-Za-z0-9_-]{1,120}$/.test(value.ownerId) ||
        value.bindingEpoch < 1 || typeof value.environmentId !== 'string' ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(value.environmentId)) return null;
  } else if (value.ownerId !== null || value.bindingEpoch !== 0 || value.environmentId !== null ||
      value.migrationState !== 'none') return null;
  if (value.migrationState === 'none') {
    if (value.migrationImportId !== null || value.migrationReceiptId !== null) return null;
  } else if (!value.migrationImportId ||
      (value.migrationState === 'complete' ? !value.migrationReceiptId : value.migrationReceiptId !== null)) return null;
  return { schemaVersion: 2, mode: value.mode, ownerId: value.ownerId,
    bindingEpoch: value.bindingEpoch, environmentId: value.environmentId,
    migrationState: value.migrationState, migrationImportId: value.migrationImportId,
    migrationReceiptId: value.migrationReceiptId, legacySession: legacy };
}

class SessionStore {
  constructor(platform, clock) {
    this.platform = platform;
    this.clock = clock || Date.now;
    let saved = null;
    try { saved = platform.getStorage(STORAGE_KEY); } catch (error) {}
    this.value = saved && saved.schemaVersion === 2 ? normalizeMetadata(saved) : normalize(saved);
    // Unknown/corrupt metadata may contain ownership: fail closed without
    // erasing durable bytes or replacing them with an anonymous HTTP session.
    this.metadataBlocked = !!(saved && saved.schemaVersion !== undefined && saved.schemaVersion !== 1 && !this.value);
    this.lastError = this.metadataBlocked ? 'invalid-metadata' : null;
    if (saved && !this.value && !this.metadataBlocked) this.clear();
  }

  current() {
    const session = this.value && this.value.schemaVersion === 2
      ? (this.value.mode === 'legacy-http' ? this.value.legacySession : null) : this.value;
    if (!session || session.expiresAt <= this.clock() + 30000) return null;
    return Object.assign({}, session);
  }

  metadata() { return this.value ? JSON.parse(JSON.stringify(this.value)) : null; }

  set(value) {
    this.lastError = 'invalid-session';
    if (this.metadataBlocked) { this.lastError = 'invalid-metadata'; return false; }
    let session;
    if (value && value.schemaVersion === 2) {
      if (value.legacySession != null && (!record(value.legacySession) ||
          !normalize(Object.assign({}, value.legacySession, { schemaVersion: 1 })))) return false;
      const legacy = this.value && (this.value.schemaVersion === 1 ? this.value : this.value.legacySession);
      // Phase 1 cannot retire an existing token, including an expired one.
      const candidate = Object.assign({}, value);
      if (legacy) candidate.legacySession = legacy;
      else if (candidate.legacySession === undefined) candidate.legacySession = null;
      session = normalizeMetadata(candidate);
    } else {
      session = normalize(value);
      if (!session || session.expiresAt <= this.clock() + 30000) return false;
      if (this.value && this.value.schemaVersion === 2) {
        if (this.value.mode !== 'legacy-http') return false;
        session = Object.assign({}, this.value, { legacySession: session });
      }
    }
    if (!session) return false;
    try {
      if (this.platform.setStorage(STORAGE_KEY, JSON.parse(JSON.stringify(session))) !== true) {
        this.lastError = 'persist-failed'; return false;
      }
    } catch (error) { this.lastError = 'persist-failed'; return false; }
    this.value = session;
    this.lastError = null;
    return true;
  }

  clear() {
    if (this.metadataBlocked) return false;
    if (this.value && this.value.schemaVersion === 2) {
      // A legacy HTTP 401/sign-out must not erase future Cloud ownership.
      if (this.value.mode !== 'legacy-http') return false;
      const candidate = Object.assign({}, this.value, { legacySession: null });
      // Revoke the in-memory credential even if disk is unavailable, as v1
      // does. Keep metadata in its HTTP mode so reauthentication still works.
      this.value = candidate;
      try { return this.platform.setStorage(STORAGE_KEY, candidate) === true; } catch (error) { return false; }
    }
    this.value = null;
    try { this.platform.setStorage(STORAGE_KEY, null); } catch (error) {}
  }
}

SessionStore.STORAGE_KEY = STORAGE_KEY;
module.exports = SessionStore;
