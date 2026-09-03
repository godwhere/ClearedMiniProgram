'use strict';

const ApiClient = require('./api-client.js');
const STORAGE_KEY = 'cleared:minigame:events:v1';
const ALLOWED = new Set(['app_launch', 'auth_started', 'auth_succeeded', 'auth_failed',
  'progress_sync_succeeded', 'progress_sync_failed', 'profile_authorized', 'profile_denied',
  'share_initiated', 'share_entry_detected', 'share_attributed', 'ad_requested',
  'ad_completed', 'ad_closed_early', 'ad_error', 'reward_granted', 'reward_rejected']);
const PRIORITY = new Set(['auth_failed', 'ad_error', 'reward_rejected']);
const TEXT_KEYS = new Set(['placement', 'levelKey', 'dailyDateKey', 'dateKey', 'dayId', 'scene', 'reason', 'action', 'source']);
const idValid = value => typeof value === 'string' && /^[A-Za-z0-9_:-]{1,180}$/.test(value);

function properties(input) {
  const result = {};
  if (!input || typeof input !== 'object') return result;
  Object.keys(input).forEach(key => {
    const value = input[key];
    if (TEXT_KEYS.has(key) && typeof value === 'string' && /^[A-Za-z0-9_:-]{1,160}$/.test(value)) result[key] = value;
    if (['statusCode', 'entryScene'].includes(key) && Number.isSafeInteger(value) && value >= 0 && value <= 99999) result[key] = value;
    if (['granted', 'alreadyGranted'].includes(key) && typeof value === 'boolean') result[key] = value;
  });
  return result;
}
function normalize(event) {
  if (!event || !idValid(event.eventId) || !ALLOWED.has(event.name) || !idValid(event.installId) ||
      !idValid(event.sessionId) || !Number.isSafeInteger(event.occurredAtClient) || event.occurredAtClient < 0 ||
      (event.userId !== null && event.userId !== undefined && !idValid(event.userId))) return null;
  const safe = properties(event.properties);
  return { eventId: event.eventId, name: event.name, version: 1, occurredAtClient: event.occurredAtClient,
    installId: event.installId, userId: event.userId || null, sessionId: event.sessionId,
    scene: typeof safe.scene === 'string' ? safe.scene : null, properties: safe };
}

class BehaviorService {
  constructor(platform, api, syncStore, config) {
    this.platform = platform;
    this.api = api;
    this.syncStore = syncStore;
    this.config = config || {};
    this.userId = null;
    this.sessionId = `appses_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    let saved;
    try { saved = platform.getStorage(STORAGE_KEY); } catch (error) {}
    this.events = saved && saved.schemaVersion === 1 && Array.isArray(saved.events)
      ? saved.events.slice(-200).map(normalize).filter(Boolean) : [];
    this.inFlight = null;
  }

  identify(userId) { this.userId = idValid(userId) ? userId : null; }
  clearUser() { this.userId = null; }
  save() {
    try { return this.platform.setStorage(STORAGE_KEY, { schemaVersion: 1, events: this.events }) === true; } catch (error) { return false; }
  }

  track(name, input) {
    if (!ALLOWED.has(name)) return false;
    const eventId = this.syncStore.nextId('evt_');
    if (!eventId) return false;
    const safe = properties(input);
    const session = this.api.sessions && this.api.sessions.current();
    const userId = this.api.sessions ? (session && session.userId) || null : this.userId;
    this.events.push({ eventId, name, version: 1, occurredAtClient: Date.now(),
      installId: this.syncStore.state.installId, userId,
      sessionId: this.sessionId, scene: safe.scene || null, properties: safe });
    if (this.events.length > 200) {
      const oldest = this.events.findIndex(event => !PRIORITY.has(event.name));
      this.events.splice(oldest < 0 ? 0 : oldest, 1);
    }
    this.save();
    return true;
  }

  flush() {
    if (this.config.uploadEnabled !== true || !this.api.isConfigured()) return Promise.resolve({ ok: false, reason: 'not-configured' });
    if (this.inFlight) return this.inFlight;
    const session = this.api.sessions.current();
    const batch = this.events.map(normalize).filter(event => event && (!event.userId || (session && event.userId === session.userId))).slice(0, 50);
    if (!batch.length) return Promise.resolve({ ok: true, accepted: [] });
    this.inFlight = Promise.resolve().then(() => {
      const current = this.api.sessions.current();
      if ((session && (!current || current.userId !== session.userId)) || (!session && current)) return ApiClient.failure('account-mismatch');
      return this.api.request({ method: 'POST', path: ApiClient.PATHS.events, auth: !!session, body: { events: batch } });
    }).then(result => {
      if (!result.ok) return { ok: false, reason: result.error.code };
      const known = new Set(batch.map(event => event.eventId));
      const accepted = Array.isArray(result.data.acceptedEventIds) ? result.data.acceptedEventIds.filter(id => known.has(id)) : [];
      const ack = new Set(accepted);
      const previous = this.events;
      this.events = this.events.filter(event => !ack.has(event.eventId));
      if (!this.save()) { this.events = previous; return { ok: false, reason: 'persist-failed' }; }
      return { ok: true, accepted };
    }).catch(() => ({ ok: false, reason: 'network' })).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }
}

BehaviorService.STORAGE_KEY = STORAGE_KEY;
module.exports = BehaviorService;
