'use strict';

const ApiClient = require('./api-client.js');
const i18n = require('../i18n/index.js');

function normalizeProfile(value) {
  if (!value || typeof value.nickname !== 'string' || typeof value.avatarUrl !== 'string') return null;
  const nickname = Array.from(value.nickname.replace(/[\x00-\x1f\x7f]/g, '').trim()).slice(0, 32).join('');
  const avatarUrl = value.avatarUrl;
  if (!nickname || avatarUrl.length > 2048 || !/^https:\/\/[^\s/?#@]+(?:[/?#][^\s]*)?$/.test(avatarUrl)) return null;
  return { nickname, avatarUrl };
}

class ProfileService {
  constructor(platform, api, auth, config, behavior, locale) {
    this.platform = platform;
    this.api = api;
    this.auth = auth;
    this.config = config || {};
    this.behavior = behavior || null;
    this.locale = locale || null;
    this.button = null;
    this.mountOptions = null;
    this.pending = null;
    this.refreshing = null;
    this.profileGeneration = 0;
    this.profile = null;
    this.profileUserId = null;
    this.disposed = false;
  }

  isSupported() {
    return !this.disposed && this.config.enabled === true && this.api.isConfigured() &&
      typeof this.platform.supportsUserInfoButton === 'function' && this.platform.supportsUserInfoButton();
  }

  current() {
    const session = this.auth.current();
    return session && session.userId === this.profileUserId && this.profile
      ? Object.assign({}, this.profile) : null;
  }

  localeId() {
    try {
      if (this.locale && typeof this.locale.current === 'function') return this.locale.current();
    } catch (error) {}
    return 'zh-CN';
  }

  t(key, params) {
    try {
      if (this.locale && typeof this.locale.t === 'function') return this.locale.t(key, params);
    } catch (error) {}
    return i18n.translate('zh-CN', key, params);
  }

  mount(options) {
    this.unmount();
    if (!this.isSupported()) return { ok: false, reason: 'not-supported' };
    const rect = options && options.rect;
    const metrics = this.platform.metrics;
    if (!rect || !['x', 'y', 'w', 'h'].every(key => Number.isFinite(rect[key])) ||
        rect.w <= 0 || rect.h < 24 || rect.h > 64 || rect.x < 0 || rect.y < metrics.safeTop ||
        rect.x + rect.w > metrics.width || rect.y + rect.h > metrics.safeBottom) return { ok: false, reason: 'invalid-layout' };
    this.mountOptions = options;
    const style = options.style || {};
    const button = this.platform.createUserInfoButton({
      type: 'text', text: this.t('profile.authorizeButton'),
      lang: this.localeId() === 'zh-CN' ? 'zh_CN' : 'en', withCredentials: false,
      style: { left: rect.x, top: rect.y, width: rect.w, height: rect.h,
        lineHeight: rect.h, borderRadius: 12, fontSize: 17, textAlign: 'center',
        color: style.color || '#333333', backgroundColor: style.backgroundColor || '#ffffff' }
    });
    if (!button) { this.mountOptions = null; return { ok: false, reason: 'not-supported' }; }
    this.button = button;
    this.tapListener = result => {
      if (this.button !== button || this.pending || this.disposed) return;
      const profile = normalizeProfile(result && result.profile);
      if (!profile) {
        if (this.behavior) this.behavior.track('profile_denied', { scene: 'account' });
        this.emit('onDenied', { ok: false, reason: 'denied' });
        return;
      }
      this.submit(profile);
    };
    try {
      button.onTap(this.tapListener);
      if (this.pending) button.hide();
    } catch (error) { this.unmount(); return { ok: false, reason: 'not-supported' }; }
    return { ok: true };
  }

  emit(name, value) {
    const callback = this.mountOptions && this.mountOptions[name];
    if (typeof callback === 'function') { try { callback(value); } catch (error) {} }
  }

  submit(profile) {
    if (this.pending) return this.pending;
    if (!this.isSupported() || !this.mountOptions || !normalizeProfile(profile)) return Promise.resolve({ ok: false, reason: 'not-supported' });
    this.profileGeneration++;
    const mount = this.mountOptions;
    const origin = this.auth.current();
    if (this.button) this.button.hide();
    this.emit('onPending', true);
    this.pending = this.saveProfile(profile, origin && origin.userId).catch(() => ({ ok: false, reason: 'network' }))
      .then(result => {
        if (mount === this.mountOptions && !this.disposed) this.emit(result.ok ? 'onSuccess' : 'onDenied', result);
        return result;
      }).finally(() => {
        this.pending = null;
        if (this.button) this.button.show();
        this.emit('onPending', false);
      });
    return this.pending;
  }

  async saveProfile(profile, originUserId) {
    const authenticated = await this.auth.ensureSession();
    if (!authenticated.ok) return { ok: false, reason: authenticated.reason };
    const session = this.auth.current();
    if (!session || (originUserId && originUserId !== session.userId)) return { ok: false, reason: 'account-mismatch' };
    const userId = session.userId;
    const options = { method: 'PATCH', path: ApiClient.PATHS.profile, auth: true, body: profile };
    let result = await this.api.request(options);
    if (!result.ok && result.error.code === 'unauthorized') {
      const next = await this.auth.ensureSession();
      const current = this.auth.current();
      if (!next.ok || !current || current.userId !== userId) return { ok: false, reason: 'account-mismatch' };
      result = await this.api.request(options);
    }
    const current = this.auth.current();
    if (!current || current.userId !== userId) return { ok: false, reason: 'account-mismatch' };
    if (!result.ok) return { ok: false, reason: result.error.code };
    this.profileUserId = userId;
    this.profile = profile;
    if (this.behavior) this.behavior.track('profile_authorized', { scene: 'account' });
    return { ok: true, profile: Object.assign({}, profile) };
  }

  refresh() {
    if (this.disposed || this.config.enabled !== true || !this.api.isConfigured()) return Promise.resolve({ ok: false, reason: 'not-configured' });
    if (this.refreshing) return this.refreshing;
    const generation = this.profileGeneration;
    this.refreshing = this.auth.ensureSession().then(async result => {
      const session = this.auth.current();
      if (!result.ok || !session) return { ok: false, reason: 'unauthorized' };
      const response = await this.api.request({ method: 'GET', path: ApiClient.PATHS.me, auth: true });
      const current = this.auth.current();
      if (this.disposed || !current || current.userId !== session.userId || this.profileGeneration !== generation) return { ok: false, reason: 'stale' };
      if (!response.ok) return { ok: false, reason: response.error.code };
      this.profile = normalizeProfile(response.data.profile);
      this.profileUserId = session.userId;
      return { ok: true };
    }).catch(() => ({ ok: false, reason: 'network' })).finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  handleResize(rect) {
    const options = this.mountOptions;
    return options ? this.mount(Object.assign({}, options, { rect })) : { ok: false, reason: 'not-mounted' };
  }

  unmount() {
    const button = this.button;
    this.button = null;
    this.mountOptions = null;
    if (button) {
      try { button.offTap(this.tapListener); } catch (error) {}
      try { button.destroy(); } catch (error) {}
    }
    this.tapListener = null;
  }

  dispose() { this.disposed = true; this.unmount(); }
}

module.exports = ProfileService;
