'use strict';

const subpackageConfig = require('../config/subpackages.js');
const clearTiming = require('./clear-animation-timing.js');

class AudioService {
  constructor(platform, progressStore, config, options) {
    const opts = options || {};
    this.platform = platform;
    this.progressStore = progressStore;
    this.config = config || {};
    this.subpackages = opts.subpackages || null;
    this.canUse = typeof opts.canUse === 'function' ? opts.canUse : () => true;
    const tracks = Array.isArray(this.config.tracks) ? this.config.tracks : [this.config.bgm];
    const ids = new Set();
    this.musicTracks = tracks.reduce((result, track) => {
      if (!track || typeof track.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(track.id) ||
          typeof track.src !== 'string' || !track.src || ids.has(track.id)) return result;
      ids.add(track.id);
      const item = { id: track.id, name: typeof track.name === 'string' ? track.name : track.id,
        src: track.src, volume: track.volume };
      if (typeof track.preview === 'string') item.preview = track.preview;
      result.push(item);
      return result;
    }, []);
    const defaultId = this.config.bgm && this.config.bgm.id;
    const savedId = progressStore.getSetting('musicId', defaultId);
    const selected = this.musicTracks.find(track => track.id === savedId && this.canUse('music', track.id)) ||
      this.musicTracks.find(track => track.id === defaultId && this.canUse('music', track.id)) ||
      this.musicTracks.find(track => this.canUse('music', track.id));
    this.musicId = selected ? selected.id : null;
    this.enabled = progressStore.getSetting(
      'soundEnabled',
      this.config.enabledByDefault !== false
    );
    this.volume = progressStore.getSetting('soundVolume', 1);
    if (!(Number.isFinite(this.volume) && this.volume > 0 && this.volume <= 1)) this.volume = 1;
    this.unlocked = false;
    this.bgm = null;
    this.sfx = {};
    this.clearSequence = null;
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

  getVolume() {
    return this.enabled ? this.volume : 0;
  }

  previewVolume(value) {
    if (this.destroyed || !(Number.isFinite(value) && value >= 0 && value <= 1)) return false;
    const wasEnabled = this.enabled;
    this.enabled = value > 0;
    if (this.enabled) this.volume = value;
    const adjust = (context, definition, fallback) => {
      try { context.volume = (definition.volume === undefined ? fallback : definition.volume) * this.getVolume(); } catch (error) {}
    };
    if (this.bgm) adjust(this.bgm, this.bgmDefinition(), 0.28);
    Object.keys(this.sfx).forEach(name => this.sfx[name].forEach(context => adjust(context, this.config.sfx[name], 0.5)));
    if (!this.enabled) this.pauseContexts();
    else if (!wasEnabled) { this.allowExplicitBgmRetry(); if (this.unlocked) this.playBgm(); }
    return true;
  }

  setVolume(value) {
    if (this.destroyed) return false;
    const saved = this.progressStore.setSetting('soundVolume', value) === true;
    this.refreshSetting();
    return saved;
  }

  async setVolumeAsync(value) {
    if (this.destroyed) return false;
    let saved = false;
    try { saved = await this.progressStore.setSettingAsync('soundVolume', value) === true; } catch (error) {}
    this.refreshSetting();
    return saved;
  }

  refreshSetting() {
    const enabled = this.progressStore.getSetting('soundEnabled', this.config.enabledByDefault !== false) === true;
    this.volume = this.progressStore.getSetting('soundVolume', 1);
    if (!(Number.isFinite(this.volume) && this.volume > 0 && this.volume <= 1)) this.volume = 1;
    this.previewVolume(enabled ? this.volume : 0);
    const savedId = this.progressStore.getSetting('musicId', this.config.bgm && this.config.bgm.id);
    const defaultId = this.config.bgm && this.config.bgm.id;
    const selected = this.musicTracks.find(track => track.id === savedId && this.canUse('music', track.id)) ||
      this.musicTracks.find(track => track.id === defaultId && this.canUse('music', track.id));
    if (selected && selected.id !== this.musicId) this.applyMusicSelection(selected.id);
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
    const definition = this.musicTracks.find(track => track.id === this.musicId) || this.config.bgm;
    return definition && typeof definition.src === 'string' && definition.src
      ? definition : null;
  }

  listMusic() {
    return this.musicTracks.map(track => Object.assign({}, track));
  }

  currentMusicId() {
    return this.musicId;
  }

  selectMusic(id) {
    if (this.destroyed || !this.canUse('music', id) || !this.musicTracks.some(track => track.id === id)) return false;
    if (id !== this.musicId && this.progressStore.setSetting('musicId', id) !== true) return false;
    return this.applyMusicSelection(id);
  }

  async selectMusicAsync(id) {
    if (this.destroyed || !this.canUse('music', id) || !this.musicTracks.some(track => track.id === id)) return false;
    if (typeof this.progressStore.setSettingAsync !== 'function') return false;
    // Persist every valid request, including a return to the current track
    // while an earlier choice is pending. ProgressStore serializes App writes.
    try {
      if (!await this.progressStore.setSettingAsync('musicId', id)) return false;
    } catch (error) { return false; }
    return this.destroyed ? false : this.applyMusicSelection(id);
  }

  applyMusicSelection(id) {
    if (!this.canUse('music', id)) return false;
    if (id !== this.musicId) {
      this.musicId = id;
      // A download or play callback for the previous track cannot restart it.
      this.bgmLoadGeneration++;
      this.bgmLoadPromise = null;
      this.bgmLoadStatus = 'idle';
      this.bgmPlayGeneration++;
      this.bgmPlaying = false;
      this.destroyContext(this.bgm);
      this.bgm = null;
    }
    this.allowExplicitBgmRetry();
    this.playBgm();
    return true;
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
    return !this.destroyed && this.enabled && this.unlocked && this.suspensions.size === 0 &&
      (!this.musicId || this.canUse('music', this.musicId));
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
        context.volume = (definition.volume === undefined ? 0.28 : definition.volume) * this.getVolume();
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
    this.cancelClearSequence();
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

  playSfx(name, overlap) {
    if (this.destroyed || !this.enabled || !this.unlocked || this.suspensions.size) return false;
    const definition = this.config.sfx && this.config.sfx[name];
    if (!definition || !definition.src) return false;
    const contexts = this.sfx[name] || (this.sfx[name] = []);
    const now = Date.now();
    let context = contexts.find(item => item.__available !== false && (!overlap || !(item.__busyUntil > now)));
    // A 354ms clip at 120ms intervals needs three voices; keep a fourth for jitter.
    if (!context && contexts.length >= 4) context = contexts.reduce((first, item) =>
      (item.__busyUntil || 0) < (first.__busyUntil || 0) ? item : first);
    if (!context) {
      context = this.createContext();
      if (!context) {
        if (contexts.length === 0) delete this.sfx[name];
        return false;
      }
      try {
        context.__available = true;
        context.src = definition.src;
        context.volume = (definition.volume === undefined ? 0.5 : definition.volume) * this.getVolume();
        contexts.push(context);
      } catch (error) {
        this.releaseSfxContext(name, context);
        return false;
      }
    }
    const generation = (context.__playGeneration || 0) + 1;
    context.__playGeneration = generation;
    context.__busyUntil = now + (Number(definition.durationMs) || 0);
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

  startClearSequence(animation, terminalSound) {
    this.cancelClearSequence();
    if (!animation || !Array.isArray(animation.cells) || !animation.cells.length) return;
    this.clearSequence = { animation, nextIndex: 0, terminalSound,
      endsAt: animation.startedAt + Math.max(clearTiming.duration(animation),
        (animation.cells.length - 1) * clearTiming.STEP_MS + 354) };
    this.updateClearSequence(animation, animation.startedAt);
  }

  updateClearSequence(animation, now) {
    const sequence = this.clearSequence;
    if (!sequence) return;
    if (sequence.animation !== animation || this.destroyed || !this.enabled ||
        !this.unlocked || this.suspensions.size) { this.cancelClearSequence(); return; }
    const index = Math.floor((now - animation.startedAt) / clearTiming.STEP_MS);
    // A late frame plays only the latest due cell, never a burst of missed sounds.
    if (index >= sequence.nextIndex && index < animation.cells.length) {
      this.playSfx('complete', true);
      sequence.nextIndex = index + 1;
    }
    if (now >= sequence.endsAt) {
      this.clearSequence = null;
      if (sequence.terminalSound) this.playSfx(sequence.terminalSound);
    }
  }

  cancelClearSequence() {
    if (!this.clearSequence) return;
    this.clearSequence = null;
    for (const context of this.sfx.complete || []) {
      try { if (context.stop) context.stop(); else if (context.pause) context.pause(); } catch (error) {}
      context.__busyUntil = 0;
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
    if (this.progressStore.setSetting('soundEnabled', !this.enabled) !== true) return this.enabled;
    this.refreshSetting();
    if (this.enabled) this.unlock();
    return this.enabled;
  }

  async toggleAsync() {
    if (this.destroyed || typeof this.progressStore.setSettingAsync !== 'function') return false;
    const enabled = !this.enabled;
    if (!await this.progressStore.setSettingAsync('soundEnabled', enabled)) return false;
    this.refreshSetting();
    if (enabled) this.unlock();
    return enabled;
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
