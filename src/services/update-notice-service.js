'use strict';

const STORAGE_KEY = 'cleared:minigame:update-notice:v1';

class UpdateNoticeService {
  constructor(platform, notice) {
    this.platform = platform;
    this.notice = notice;
    this.confirmed = false;
    this.seenId = null;
    try {
      const result = typeof platform.readStorageResult === 'function'
        ? platform.readStorageResult(STORAGE_KEY) : null;
      const saved = result
        ? (result.ok === true && result.found === true ? result.value : null)
        : platform.getStorage(STORAGE_KEY);
      if (saved && saved.schemaVersion === 1 && typeof saved.releaseId === 'string') {
        this.seenId = saved.releaseId;
      }
    } catch (error) {}
  }

  current() {
    return this.notice;
  }

  shouldShow() {
    return !this.confirmed && this.seenId !== this.notice.id;
  }

  acknowledge() {
    this.confirmed = true;
    let persisted = false;
    try {
      persisted = this.platform.setStorage(STORAGE_KEY,
        { schemaVersion: 1, releaseId: this.notice.id }) === true;
    } catch (error) {}
    return { ok: persisted, persisted };
  }
}

UpdateNoticeService.STORAGE_KEY = STORAGE_KEY;
module.exports = UpdateNoticeService;
