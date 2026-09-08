'use strict';

const subpackageConfig = require('../config/subpackages.js');

class AudioService {
  constructor(platform, progressStore, config, options) {
    const opts = options || {};
    this.platform = platform;
    this.progressStore = progressStore;
    this.config = config || {};
    this.subpackages = opts.subpackages || null;
    this.enabled = progressStore.getSetting(
      'soundEnabled',
      this.config.enabledByDefault !== false
    );
    this.unlocked = false;
    this.bgm = null;
    this.sfx = {};
    this.suspensions = new Set();
    this.destroyed = false;
    this.bgmLoadStatus = 'idle';
    this.bgmLoadPromise = null;
    this.bgmLoadGeneration = 0;
    this.bgmPlaybackFailed = false;
    this.bgmPlaying = false;
    this.bgmPlayGeneration = 0;
  }

  isEnabled() {
    return !!this.enabled;
  }

  refreshSetting() {
    const enabled = this.progressStore.getSetting('soundEnabled', this.config.enabledByDefault !== false) === true;
    if (this.enabled === enabled) return true;
    this.enabled = enabled;
    if (enabled) {
      this.allowExplicitBgmRetry();
      if (this.unlocked) this.playBgm();
    } else {
      this.pauseContexts();
    }
    return true;
  }

  unlock() {
    if (this.destroyed) return false;
    this.unlocked = true;
    return this.enabled ? this.playBgm() : false;
  }

  createContext() {
    if (this.destroyed) return null;
    try { return this.platform.createAudioContext(); } catch (error) { return null; }
  }

  bgmDefinition() {
    const definition = this.config.bgm;
    return definition && typeof definition.src === 'string' && definition.src
      ? definition : null;
  }

  bgmPackage(source) {
    // Three-argument callers with ordinary main-package fixtures remain valid.
    if (!this.subpackages) {
      const configured = subpackageConfig.packages.some(item =>
        item.assetPrefixes.some(prefix => source.startsWith(prefix)));
      if (configured) throw new Error('SUBPACKAGE_UNSUPPORTED');
      return null;
    }
    if (typeof this.subpackages.packageForAsset !== 'function') throw new Error('SUBPACKAGE_UNSUPPORTED');
    return this.subpackages.packageForAsset(source);
  }

  canPlayBgm() {
    return !this.destroyed && this.enabled && this.unlocked && this.suspensions.size === 0;
  }

  destroyContext(context) {
    if (context && context.destroy) {
      try { context.destroy(); } catch (error) {}
    }
  }

  releaseSfxContext(name, context) {
    const contexts = this.sfx[name];
    if (context) {
      context.__available = false;
      context.__playGeneration = (context.__playGeneration || 0) + 1;
      this.destroyContext(context);
    }
    if (!Array.isArray(contexts)) return;
    const index = contexts.indexOf(context);
    if (index >= 0) contexts.splice(index, 1);
    if (contexts.length === 0 && this.sfx[name] === contexts) delete this.sfx[name];
  }

  failBgmContext(context) {
    if (context && context !== this.bgm) return;
    this.bgmPlayGeneration++;
    this.bgmPlaying = false;
    if (this.bgm) this.destroyContext(this.bgm);
    this.bgm = null;
    if (!this.destroyed) this.bgmPlaybackFailed = true;
  }

  playReadyBgm(definition) {
    if (!this.canPlayBgm() || this.bgmPlaybackFailed) return false;
    if (this.bgm && this.bgmPlaying) return true;
    if (!this.bgm) {
      const context = this.createContext();
      if (!context) {
        this.bgmPlaybackFailed = true;
        return false;
      }
      this.bgm = context;
      try {
        context.loop = true;
        context.src = definition.src;
        context.volume = definition.volume === undefined ? 0.28 : definition.volume;
        if (context.onError) context.onError(() => this.failBgmContext(context));
      } catch (error) {
        this.failBgmContext(context);
        return false;
      }
    }
    const context = this.bgm;
    const generation = ++this.bgmPlayGeneration;
    try {
      const result = context.play();
      this.bgmPlaying = true;
      if (result && result.catch) result.catch(() => {
        if (generation === this.bgmPlayGeneration) this.failBgmContext(context);
      });
      return true;
    } catch (error) {
      this.failBgmContext(context);
      return false;
    }
  }

  requestBgmPackage(name, definition) {
    if (this.bgmLoadStatus === 'loading' || this.bgmLoadStatus === 'failed') return false;
    if (!this.subpackages || typeof this.subpackages.ensurePackage !== 'function') {
      this.bgmLoadStatus = 'failed';
      return false;
    }
    if (typeof this.subpackages.isPackageReady === 'function' && this.subpackages.isPackageReady(name)) {
      this.bgmLoadStatus = 'loaded';
      return this.playReadyBgm(definition);
    }

    const generation = ++this.bgmLoadGeneration;
    this.bgmLoadStatus = 'loading';
    let request;
    try {
      request = this.subpackages.ensurePackage(name);
    } catch (error) {
      this.bgmLoadStatus = 'failed';
      return false;
    }
    this.bgmLoadPromise = Promise.resolve(request).then(() => {
      if (this.destroyed || generation !== this.bgmLoadGeneration) return false;
      this.bgmLoadPromise = null;
      this.bgmLoadStatus = 'loaded';
      return this.canPlayBgm() ? this.playReadyBgm(definition) : false;
    }, () => {
      if (!this.destroyed && generation === this.bgmLoadGeneration) {
        this.bgmLoadPromise = null;
        this.bgmLoadStatus = 'failed';
      }
      return false;
    });
    return false;
  }

  playBgm() {
    const definition = this.bgmDefinition();
    if (!definition || !this.canPlayBgm()) return false;
    let packageName;
    try { packageName = this.bgmPackage(definition.src); } catch (error) {
      this.bgmLoadStatus = 'failed';
      return false;
    }
    if (!packageName) return this.playReadyBgm(definition);
    if (this.bgmLoadStatus === 'loaded') return this.playReadyBgm(definition);
    return this.requestBgmPackage(packageName, definition);
  }

  pauseContexts() {
    this.bgmPlayGeneration++;
    this.bgmPlaying = false;
    if (this.bgm && this.bgm.pause) {
      try { this.bgm.pause(); } catch (error) {}
    }
    Object.keys(this.sfx).forEach(name => {
      this.sfx[name].forEach(context => {
        if (context.pause) {
          try { context.pause(); } catch (error) {}
        }
      });
    });
  }

  pauseAll(reason) {
    if (this.destroyed) return false;
    this.suspensions.add(reason || 'default');
    this.pauseContexts();
    return true;
  }

  resumeAll(reason) {
    if (this.destroyed) return false;
    this.suspensions.delete(reason || 'default');
    return this.suspensions.size === 0 ? this.playBgm() : false;
  }

  playSfx(name) {
    if (this.destroyed || !this.enabled || !this.unlocked) return false;
    const definition = this.config.sfx && this.config.sfx[name];
    if (!definition || !definition.src) return false;
    const contexts = this.sfx[name] || (this.sfx[name] = []);
    let context = contexts.find(item => item.__available !== false);
    if (!context) {
      context = this.createContext();
      if (!context) {
        if (contexts.length === 0) delete this.sfx[name];
        return false;
      }
      try {
        context.__available = true;
        context.src = definition.src;
        context.volume = definition.volume === undefined ? 0.5 : definition.volume;
        contexts.push(context);
      } catch (error) {
        this.releaseSfxContext(name, context);
        return false;
      }
    }
    const generation = (context.__playGeneration || 0) + 1;
    context.__playGeneration = generation;
    try {
      if (context.stop) context.stop();
      if (context.seek) context.seek(0);
      const result = context.play();
      if (result && result.catch) result.catch(() => {
        if (!this.destroyed && generation === context.__playGeneration) {
          this.releaseSfxContext(name, context);
        }
      });
      return true;
    } catch (error) {
      this.releaseSfxContext(name, context);
      return false;
    }
  }

  allowExplicitBgmRetry() {
    this.bgmPlaybackFailed = false;
    if (this.bgmLoadStatus === 'failed') {
      this.bgmLoadGeneration++;
      this.bgmLoadPromise = null;
      this.bgmLoadStatus = 'idle';
    }
  }

  toggle() {
    if (this.destroyed) return false;
    this.enabled = !this.enabled;
    this.progressStore.setSetting('soundEnabled', this.enabled);
    if (this.enabled) {
      this.allowExplicitBgmRetry();
      this.unlock();
    } else {
      this.pauseContexts();
    }
    return this.enabled;
  }

  dispose() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.bgmLoadGeneration++;
    this.bgmLoadPromise = null;
    this.pauseContexts();
    const contexts = this.bgm ? [this.bgm] : [];
    Object.keys(this.sfx).forEach(name => contexts.push(...this.sfx[name]));
    contexts.forEach(context => this.destroyContext(context));
    this.bgm = null;
    this.bgmPlaying = false;
    this.sfx = {};
    this.suspensions.clear();
  }
}

module.exports = AudioService;
