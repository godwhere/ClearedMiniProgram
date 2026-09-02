'use strict';

const ApiClient = require('./api-client.js');
const STORAGE_KEY = 'cleared:minigame:events:v1';
const ALLOWED = new Set(['app_launch', 'auth_started', 'auth_succeeded', 'auth_failed',
  'progress_sync_succeeded', 'progress_sync_failed', 'profile_authorized', 'profile_denied',
  'share_initiated', 'share_entry_detected', 'share_attributed', 'ad_requested',
  'ad_completed', 'ad_closed_early', 'ad_error', 'reward_granted', 'reward_rejected']);
const PROPERTY_KEYS = new Set(['placement', 'levelKey', 'dailyDateKey', 'dateKey', 'dayId',
  'scene', 'reason', 'action', 'source', 'statusCode', 'entryScene', 'granted', 'alreadyGranted']);

class BehaviorService {
  constructor(platform, api, syncStore, config) {
    this.platform = platform; this.api = api; this.syncStore = syncStore; this.config = config || {};
    this.userId = null; this.sessionId = `appses_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    const saved = platform.getStorage(STORAGE_KEY);
    this.events = saved && saved.schemaVersion === 1 && Array.isArray(saved.events)
      ? saved.events.filter(this.validEvent).slice(-200) : [];
    this.inFlight = null;
  }
  validEvent(event) { return !!event && typeof event.eventId === 'string' && ALLOWED.has(event.name) && Number.isSafeInteger(event.occurredAtClient); }
  identify(userId) { this.userId = typeof userId === 'string' ? userId : null; }
  clearUser() { this.userId = null; }
  save() { try { return this.platform.setStorage(STORAGE_KEY, { schemaVersion: 1, events: this.events }) === true; } catch (error) { return false; } }
  track(name, properties) {
    if (!ALLOWED.has(name)) return false;
    const eventId = this.syncStore.nextId('evt_');
    if (!eventId) return false;
    const safe = {};
    const input = properties && typeof properties === 'object' ? properties : {};
    Object.keys(input).forEach(key => {
      if (!PROPERTY_KEYS.has(key)) return;
      const value = input[key];
      if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) ||
          (typeof value === 'string' && value.length <= 160 && !/[\x00-\x1f]/.test(value))) safe[key] = value;
    });
    this.events.push({ eventId, name, version: 1, occurredAtClient: Date.now(),
      installId: this.syncStore.state.installId, userId: this.userId,
      sessionId: this.sessionId, scene: typeof safe.scene === 'string' ? safe.scene : null,
      properties: safe });
    if (this.events.length > 200) this.events.splice(0, this.events.length - 200);
    this.save(); return true;
  }
  flush() {
    if (this.config.uploadEnabled !== true || !this.api.isConfigured()) return Promise.resolve({ ok: false, reason: 'not-configured' });
    if (this.inFlight) return this.inFlight;
    const batch = this.events.slice(0, 50);
    if (!batch.length) return Promise.resolve({ ok: true, accepted: [] });
    this.inFlight = this.api.request({ method: 'POST', path: ApiClient.PATHS.events, auth: !!this.api.sessions.current(), body: { events: batch } })
      .then(result => {
        if (!result.ok) return { ok: false, reason: result.error.code };
        const known = new Set(batch.map(event => event.eventId));
        const accepted = Array.isArray(result.data.acceptedEventIds) ? result.data.acceptedEventIds.filter(id => known.has(id)) : [];
        const ack = new Set(accepted); this.events = this.events.filter(event => !ack.has(event.eventId)); this.save();
        return { ok: true, accepted };
      }).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }
}

BehaviorService.STORAGE_KEY = STORAGE_KEY;
module.exports = BehaviorService;
