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

  setStorage(key, value) {
    try {
      this.api.setStorageSync(key, value);
      return true;
    } catch (error) {
      return false;
    }
  }

  createRewardedVideoAd(options) {
    return this.api.createRewardedVideoAd ? this.api.createRewardedVideoAd(options) : null;
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
