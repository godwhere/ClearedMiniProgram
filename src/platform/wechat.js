class WechatPlatform {
  constructor(api) {
    this.api = api || wx;
    // In a mini game, the first canvas created is the on-screen canvas.
    this.canvas = this.api.createCanvas();
    this.context = this.canvas.getContext('2d');
    this.active = true;
    this.frameId = null;
    this.resize();
  }

  getWindowInfo() {
    if (this.api.getWindowInfo) return this.api.getWindowInfo();
    return this.api.getSystemInfoSync();
  }

  getSystemLanguage() {
    const hasBaseInfo = !!(this.api && typeof this.api.getAppBaseInfo === 'function');
    const hasSystemInfo = !!(this.api && typeof this.api.getSystemInfoSync === 'function');
    try {
      const info = hasBaseInfo
        ? this.api.getAppBaseInfo() : null;
      if (info && typeof info.language === 'string') return info.language;
    } catch (error) {}
    try {
      const info = hasSystemInfo
        ? this.api.getSystemInfoSync() : null;
      if (info && typeof info.language === 'string') return info.language;
    } catch (error) {
      return null;
    }
    // Lightweight legacy hosts used before localization expose neither
    // official language API. Preserve their established Chinese presentation;
    // supported WeChat runtimes with an empty/invalid language still return
    // null and follow the product fallback to English.
    return hasBaseInfo || hasSystemInfo ? null : 'zh-CN';
  }

  // The Developer Tools simulator identifies itself through the same system
  // information field used by WeChat's official debug flows. Keep detection
  // behind the platform adapter so game rules never read `wx` directly.
  isDevTools() {
    let info = null;
    try {
      info = this.api.getSystemInfoSync
        ? this.api.getSystemInfoSync()
        : this.getWindowInfo();
    } catch (error) {}
    if ((!info || typeof info.platform !== 'string') && this.api.getWindowInfo) {
      try { info = this.api.getWindowInfo(); } catch (error) {}
    }
    return !!(info && typeof info.platform === 'string' &&
      info.platform.toLowerCase() === 'devtools');
  }

  resize() {
    const info = this.getWindowInfo();
    const width = info.windowWidth || info.screenWidth;
    const height = info.windowHeight || info.screenHeight;
    // DPR 2 is sharp enough for this flat UI while keeping fill-rate and
    // canvas memory low on high-density phones.
    const dpr = Math.max(1, Math.min(2, info.pixelRatio || 1));
    const safeArea = info.safeArea || { top: 0, bottom: height };
    let menuBottom = 0;
    if (this.api.getMenuButtonBoundingClientRect) {
      try {
        const menu = this.api.getMenuButtonBoundingClientRect();
        menuBottom = menu && menu.bottom ? menu.bottom + 4 : 0;
      } catch (error) {}
    }

    this.metrics = {
      width,
      height,
      dpr,
      safeTop: Math.max(0, safeArea.top || 0, menuBottom),
      safeBottom: Math.min(height, safeArea.bottom || height)
    };
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.context.scale(dpr, dpr);
    return this.metrics;
  }

  createImage(source, onReady) {
    const image = this.canvas.createImage ? this.canvas.createImage() : this.api.createImage();
    image.onload = () => onReady && onReady(null, image);
    image.onerror = error => onReady && onReady(error || new Error(`Unable to load ${source}`));
    image.src = source;
    return image;
  }

  loadSubpackage(name, handlers) {
    const callbacks = handlers || {};
    if (!this.api || typeof this.api.loadSubpackage !== 'function') {
      const error = { code: 'SUBPACKAGE_UNSUPPORTED' };
      if (callbacks.fail) callbacks.fail(error);
      if (callbacks.complete) callbacks.complete(error);
      return null;
    }
    try {
      const task = this.api.loadSubpackage({
        name,
        success: result => callbacks.success && callbacks.success(result || {}),
        fail: error => callbacks.fail && callbacks.fail(error),
        complete: result => callbacks.complete && callbacks.complete(result)
      });
      if (task && typeof task.onProgressUpdate === 'function' && callbacks.progress) {
        task.onProgressUpdate(result => callbacks.progress(result || {}));
      }
      return task;
    } catch (error) {
      if (callbacks.fail) callbacks.fail(error);
      if (callbacks.complete) callbacks.complete(error);
      return null;
    }
  }

  login(timeoutMs) {
    if (!this.api || typeof this.api.login !== 'function') return Promise.reject({ reason: 'not-supported' });
    return new Promise((resolve, reject) => {
      let finished = false;
      const timer = setTimeout(() => { if (!finished) { finished = true; reject({ reason: 'timeout' }); } }, timeoutMs || 8000);
      const done = (callback, value) => { if (finished) return; finished = true; clearTimeout(timer); callback(value); };
      try {
        this.api.login({ success: result => done(resolve, { code: result && result.code }),
          fail: () => done(reject, { reason: 'wechat-login-failed' }) });
      } catch (error) { done(reject, { reason: 'wechat-login-failed' }); }
    });
  }

  request(options) {
    if (!this.api || typeof this.api.request !== 'function') return Promise.resolve({ ok: false, reason: 'not-supported' });
    return new Promise(resolve => {
      let finished = false;
      const timer = setTimeout(() => { if (!finished) { finished = true; resolve({ ok: false, reason: 'timeout' }); } }, options.timeout || 8000);
      const done = result => { if (finished) return; finished = true; clearTimeout(timer); resolve(result); };
      try {
        this.api.request({ url: options.url, method: options.method, data: options.data, header: options.header,
          timeout: options.timeout, success: result => done({ ok: true, statusCode: result.statusCode, data: result.data, header: result.header || {} }),
          fail: () => done({ ok: false, reason: 'network' }) });
      } catch (error) { done({ ok: false, reason: 'network' }); }
    });
  }

  supportsCloud() {
    return !!(this.api && this.api.cloud && typeof this.api.cloud.init === 'function' &&
      typeof this.api.cloud.callFunction === 'function');
  }

  getMiniProgramEnvironmentVersion() {
    try {
      const info = this.api.getAccountInfoSync && this.api.getAccountInfoSync();
      const version = info && info.miniProgram && info.miniProgram.envVersion;
      return ['develop', 'trial', 'release'].includes(version) ? version : 'unknown';
    } catch (error) { return 'unknown'; }
  }

  async initCloud(options) {
    if (!this.supportsCloud()) return { ok: false, reason: 'not-supported' };
    const opts = options || {};
    if (typeof opts.env !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(opts.env)) {
      return { ok: false, reason: 'invalid-request' };
    }
    try {
      await this.api.cloud.init({ env: opts.env, traceUser: opts.traceUser === true });
      return { ok: true };
    } catch (error) { return { ok: false, reason: 'cloud-init-failed' }; }
  }

  callCloudFunction(options) {
    if (!this.supportsCloud()) return Promise.resolve({ ok: false, reason: 'not-supported' });
    const opts = options || {};
    const timeout = opts.timeout === undefined ? 8000 : opts.timeout;
    if (typeof opts.name !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(opts.name) ||
        !opts.data || typeof opts.data !== 'object' || Array.isArray(opts.data) ||
        !Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 60000 ||
        (opts.env !== undefined && (typeof opts.env !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(opts.env)))) {
      return Promise.resolve({ ok: false, reason: 'invalid-request' });
    }
    return new Promise(resolve => {
      let finished = false;
      const done = result => { if (finished) return; finished = true; clearTimeout(timer); resolve(result); };
      // Native ordinary callFunction has no HTTP timeout option. This local
      // watchdog ignores late callbacks; it cannot cancel server execution.
      const timer = setTimeout(() => done({ ok: false, reason: 'timeout' }), timeout);
      const success = result => done({ ok: true, result: result && result.result });
      const fail = error => done({ ok: false, reason: error && typeof error.errMsg === 'string' &&
        /timeout|timed out/i.test(error.errMsg) ? 'timeout' : 'network' });
      try {
        const nativeOptions = { name: opts.name, data: opts.data, success, fail };
        if (opts.env !== undefined) nativeOptions.config = { env: opts.env };
        const task = this.api.cloud.callFunction(nativeOptions);
        if (task && typeof task.then === 'function') task.then(success, fail);
      } catch (error) { fail(error); }
    });
  }

  bindPointer(handlers) {
    const points = (event, ended) => {
      const list = ended ? event.changedTouches : event.touches;
      if (!list || !list.length) return [];
      return Array.prototype.map.call(list, touch => ({
        x: touch.clientX !== undefined ? touch.clientX : touch.x,
        y: touch.clientY !== undefined ? touch.clientY : touch.y,
        id: touch.identifier === undefined ? 0 : touch.identifier
      }));
    };
    const dispatch = (handler, event, ended) => {
      if (!handler) return;
      const eventPoints = points(event, ended);
      if (!eventPoints.length) handler(null, event);
      else eventPoints.forEach(point => handler(point, event));
    };
    const callbacks = {
      start: event => dispatch(handlers.start, event, false),
      move: event => dispatch(handlers.move, event, false),
      end: event => dispatch(handlers.end, event, true),
      cancel: event => dispatch(handlers.cancel, event, true)
    };

    this.api.onTouchStart(callbacks.start);
    this.api.onTouchMove(callbacks.move);
    this.api.onTouchEnd(callbacks.end);
    if (this.api.onTouchCancel) this.api.onTouchCancel(callbacks.cancel);

    return () => {
      if (this.api.offTouchStart) this.api.offTouchStart(callbacks.start);
      if (this.api.offTouchMove) this.api.offTouchMove(callbacks.move);
      if (this.api.offTouchEnd) this.api.offTouchEnd(callbacks.end);
      if (this.api.offTouchCancel) this.api.offTouchCancel(callbacks.cancel);
    };
  }

  bindLifecycle(handlers) {
    if (this.api.onHide) {
      this.api.onHide(() => {
        this.active = false;
        this.stopLoop();
        if (handlers.hide) handlers.hide();
      });
    }
    if (this.api.onShow) {
      this.api.onShow(options => {
        this.active = true;
        this.resize();
        if (handlers.show) handlers.show(options);
      });
    }
    if (this.api.onWindowResize) {
      this.api.onWindowResize(() => {
        this.resize();
        if (handlers.resize) handlers.resize(this.metrics);
      });
    }
    if (this.api.onAudioInterruptionBegin) {
      this.api.onAudioInterruptionBegin(() => handlers.audioInterruptBegin && handlers.audioInterruptBegin());
    }
    if (this.api.onAudioInterruptionEnd) {
      this.api.onAudioInterruptionEnd(() => handlers.audioInterruptEnd && handlers.audioInterruptEnd());
    }
  }

  startLoop(callback) {
    this.stopLoop();
    this.active = true;
    let request;
    if (this.canvas.requestAnimationFrame) {
      request = this.canvas.requestAnimationFrame.bind(this.canvas);
      this.cancelFrame = this.canvas.cancelAnimationFrame
        ? this.canvas.cancelAnimationFrame.bind(this.canvas)
        : null;
    } else if (typeof requestAnimationFrame === 'function') {
      request = requestAnimationFrame;
      this.cancelFrame = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : null;
    } else {
      request = frame => setTimeout(() => frame(Date.now()), 33);
      this.cancelFrame = clearTimeout;
    }
    const frame = timestamp => {
      if (!this.active) return;
      callback(Date.now());
      this.frameId = request(frame);
    };
    this.frameId = request(frame);
  }

  stopLoop() {
    if (this.frameId === null) return;
    if (this.cancelFrame) this.cancelFrame(this.frameId);
    this.frameId = null;
  }

  getStorage(key) {
    try {
      return this.api.getStorageSync(key);
    } catch (error) {
      return null;
    }
  }

  readStorageResult(key) {
    try {
      if (!this.api || typeof this.api.getStorageInfoSync !== 'function' ||
          typeof this.api.getStorageSync !== 'function') {
        return { ok: false, reason: 'storage-read-failed' };
      }
      const info = this.api.getStorageInfoSync();
      if (!info || !Array.isArray(info.keys) || !info.keys.every(item => typeof item === 'string')) {
        return { ok: false, reason: 'storage-read-failed' };
      }
      if (info.keys.indexOf(key) < 0) return { ok: true, found: false };
      return { ok: true, found: true, value: this.api.getStorageSync(key) };
    } catch (error) {
      return { ok: false, reason: 'storage-read-failed' };
    }
  }

  setStorage(key, value) {
    try {
      this.api.setStorageSync(key, value);
      return true;
    } catch (error) {
      return false;
    }
  }

  supportsRewardedVideoAd() {
    return !!(this.api && typeof this.api.createRewardedVideoAd === 'function');
  }

  createRewardedVideoAd(options) {
    if (!this.supportsRewardedVideoAd()) return null;
    const safe = { adUnitId: options.adUnitId };
    try {
      const info = this.api.getAppBaseInfo ? this.api.getAppBaseInfo() : this.api.getSystemInfoSync();
      const version = info && info.SDKVersion;
      if (typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version)) {
        const parts = version.split('.').map(Number);
        if (parts[0] > 3 || (parts[0] === 3 && (parts[1] > 7 || (parts[1] === 7 && parts[2] >= 7)))) {
          if (options.disableFallbackSharePage === true) safe.disableFallbackSharePage = true;
        }
      }
    } catch (error) {}
    try { return this.api.createRewardedVideoAd(safe); } catch (error) { return null; }
  }

  supportsUserInfoButton() {
    return !!(this.api && typeof this.api.createUserInfoButton === 'function');
  }

  getLaunchOptions() {
    try { return this.api.getLaunchOptionsSync ? this.api.getLaunchOptionsSync() : {}; } catch (error) { return {}; }
  }

  getEnterOptions() {
    try { return this.api.getEnterOptionsSync ? this.api.getEnterOptionsSync() : {}; } catch (error) { return {}; }
  }

  showShareMenu() {
    if (!this.api.showShareMenu) return false;
    try { this.api.showShareMenu({ menus: ['shareAppMessage'], withShareTicket: false, fail: function () {} }); return true; } catch (error) { return false; }
  }

  onShareAppMessage(listener) {
    if (!this.api.onShareAppMessage) return false;
    try { this.api.onShareAppMessage(listener); return true; } catch (error) { return false; }
  }

  offShareAppMessage(listener) {
    try { if (this.api.offShareAppMessage) this.api.offShareAppMessage(listener); } catch (error) {}
  }

  shareAppMessage(payload) {
    if (!this.api.shareAppMessage) return { initiated: false, reason: 'not-supported' };
    try {
      this.api.shareAppMessage({ title: payload.title, query: payload.query });
      return { initiated: true, reason: 'initiated' };
    } catch (error) { return { initiated: false, reason: 'unavailable' }; }
  }

  createUserInfoButton(options) {
    if (!this.supportsUserInfoButton()) return null;
    try {
      const native = this.api.createUserInfoButton(Object.assign({}, options, {
        withCredentials: false, style: Object.assign({}, options.style)
      }));
      if (!native) return null;
      let listener = null;
      return {
        onTap(callback) {
          listener = result => {
            const info = result && result.userInfo;
            callback({ profile: info ? { nickname: info.nickName, avatarUrl: info.avatarUrl } : null });
          };
          native.onTap(listener);
        },
        offTap() { if (listener && native.offTap) native.offTap(listener); listener = null; },
        show() { try { if (native.show) native.show(); } catch (error) {} },
        hide() { try { if (native.hide) native.hide(); } catch (error) {} },
        destroy() { if (native.destroy) native.destroy(); }
      };
    } catch (error) { return null; }
  }

  openPrivacyContract() {
    if (!this.api || typeof this.api.openPrivacyContract !== 'function') return Promise.resolve({ ok: false, reason: 'not-supported' });
    return new Promise(resolve => {
      try {
        this.api.openPrivacyContract({ success: () => resolve({ ok: true }),
          fail: () => resolve({ ok: false, reason: 'unavailable' }) });
      } catch (error) { resolve({ ok: false, reason: 'unavailable' }); }
    });
  }

  createInterstitialAd(options) {
    return this.api.createInterstitialAd ? this.api.createInterstitialAd(options) : null;
  }

  createAudioContext() {
    return this.api.createInnerAudioContext ? this.api.createInnerAudioContext() : null;
  }

  triggerHaptic(kind) {
    if (!this.api.vibrateShort) return;
    try {
      this.api.vibrateShort({ type: kind || 'light' });
    } catch (error) {}
  }
}

module.exports = WechatPlatform;
