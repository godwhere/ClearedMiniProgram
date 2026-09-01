class AudioService {
  constructor(platform, progressStore, config) {
    this.platform = platform;
    this.progressStore = progressStore;
    this.config = config || {};
    this.enabled = progressStore.getSetting(
      'soundEnabled',
      this.config.enabledByDefault !== false
    );
    this.unlocked = false;
    this.bgm = null;
    this.sfx = {};
    this.wasPlaying = false;
  }

  isEnabled() {
    return !!this.enabled;
  }

  unlock() {
    this.unlocked = true;
    if (this.enabled) this.playBgm();
  }

  createContext() {
    try { return this.platform.createAudioContext(); } catch (error) { return null; }
  }

  playBgm() {
    if (!this.enabled || !this.unlocked || !this.config.bgm || !this.config.bgm.src) return false;
    if (!this.bgm) {
      this.bgm = this.createContext();
      if (!this.bgm) return false;
      this.bgm.loop = true;
      this.bgm.src = this.config.bgm.src;
      this.bgm.volume = this.config.bgm.volume === undefined ? 0.28 : this.config.bgm.volume;
      if (this.bgm.onError) this.bgm.onError(() => { this.wasPlaying = false; });
    }
    try {
      const result = this.bgm.play();
      if (result && result.catch) result.catch(() => {});
      this.wasPlaying = true;
      return true;
    } catch (error) {
      return false;
    }
  }

  pauseAll() {
    this.wasPlaying = !!this.bgm && this.enabled && this.unlocked;
    if (this.bgm && this.bgm.pause) {
      try { this.bgm.pause(); } catch (error) {}
    }
    Object.keys(this.sfx).forEach(name => {
      const contexts = this.sfx[name];
      contexts.forEach(context => {
        if (context.pause) {
          try { context.pause(); } catch (error) {}
        }
      });
    });
  }

  resumeAll() {
    if (this.wasPlaying) this.playBgm();
  }

  playSfx(name) {
    if (!this.enabled || !this.unlocked) return false;
    const definition = this.config.sfx && this.config.sfx[name];
    if (!definition || !definition.src) return false;
    const contexts = this.sfx[name] || (this.sfx[name] = []);
    let context = contexts.find(item => item.__available !== false);
    if (!context) {
      context = this.createContext();
      if (!context) return false;
      context.__available = true;
      context.src = definition.src;
      context.volume = definition.volume === undefined ? 0.5 : definition.volume;
      contexts.push(context);
    }
    try {
      if (context.stop) context.stop();
      if (context.seek) context.seek(0);
      const result = context.play();
      if (result && result.catch) result.catch(() => {});
      return true;
    } catch (error) {
      return false;
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    this.progressStore.setSetting('soundEnabled', this.enabled);
    if (this.enabled) {
      this.unlock();
    } else {
      this.pauseAll();
    }
    return this.enabled;
  }

  dispose() {
    this.pauseAll();
    const contexts = this.bgm ? [this.bgm] : [];
    Object.keys(this.sfx).forEach(name => contexts.push(...this.sfx[name]));
    contexts.forEach(context => {
      if (context.destroy) {
        try { context.destroy(); } catch (error) {}
      }
    });
    this.bgm = null;
    this.sfx = {};
  }
}

module.exports = AudioService;
