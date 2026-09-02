'use strict';

const STORAGE_KEY = 'cleared:minigame:session:v1';

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

class SessionStore {
  constructor(platform, clock) {
    this.platform = platform;
    this.clock = clock || Date.now;
    let saved = null;
    try { saved = platform.getStorage(STORAGE_KEY); } catch (error) {}
    this.value = normalize(saved);
    if (saved && !this.value) this.clear();
  }

  current() {
    if (!this.value || this.value.expiresAt <= this.clock() + 30000) return null;
    return Object.assign({}, this.value);
  }

  set(value) {
    const session = normalize(value);
    if (!session || session.expiresAt <= this.clock() + 30000) return false;
    // A storage outage may lose the session on restart, never the local save.
    this.value = session;
    try { this.platform.setStorage(STORAGE_KEY, session); } catch (error) {}
    return true;
  }

  clear() {
    this.value = null;
    try { this.platform.setStorage(STORAGE_KEY, null); } catch (error) {}
  }
}

SessionStore.STORAGE_KEY = STORAGE_KEY;
module.exports = SessionStore;
