const assert = require('assert');
const fs = require('fs');
const path = require('path');
const AudioService = require('../src/services/audio-service.js');
const audioConfig = require('../src/config/audio.js');

class FakeContext {
  constructor() { this.playCount = 0; this.pauseCount = 0; this.stopCount = 0; this.seekValues = []; }
  play() { this.playCount++; return Promise.resolve(); }
  pause() { this.pauseCount++; }
  stop() { this.stopCount++; }
  seek(value) { this.seekValues.push(value); }
  destroy() { this.destroyed = true; }
  onError(handler) { this.errorHandler = handler; }
}

function run() {
  assert.strictEqual(audioConfig.sfx.victory.src, 'assets/audio/victory-shimmer.m4a');
  assert.strictEqual(audioConfig.sfx.shimmer, undefined);
  const root = path.resolve(__dirname, '..');
  assert(fs.existsSync(path.join(root, audioConfig.bgm.src)));
  Object.keys(audioConfig.sfx).forEach(name => {
    assert(fs.existsSync(path.join(root, audioConfig.sfx[name].src)), `${name} audio exists`);
  });
  const settings = {};
  const progress = {
    getSetting(name, fallback) { return settings[name] === undefined ? fallback : settings[name]; },
    setSetting(name, value) { settings[name] = value; }
  };
  const contexts = [];
  const service = new AudioService({
    createAudioContext() {
      const context = new FakeContext();
      contexts.push(context);
      return context;
    }
  }, progress, audioConfig);

  assert.strictEqual(service.isEnabled(), true);
  assert.strictEqual(service.playBgm(), false, 'audio waits for a user gesture');
  service.unlock();
  assert.strictEqual(contexts.length, 1);
  assert.strictEqual(contexts[0].loop, true);
  assert.strictEqual(service.playSfx('step'), true);
  assert.strictEqual(contexts.length, 2);
  assert.strictEqual(service.playSfx('step'), true);
  assert.strictEqual(contexts.length, 2, 'a cue reuses its lightweight context');

  service.pauseAll();
  assert(contexts[0].pauseCount > 0);
  service.resumeAll();
  assert(contexts[0].playCount > 1);
  assert.strictEqual(service.toggle(), false);
  assert.strictEqual(settings.soundEnabled, false);
  assert.strictEqual(service.playSfx('click'), false);
  assert.strictEqual(service.toggle(), true);
  service.dispose();
  assert.strictEqual(contexts[0].destroyed, true);
}

module.exports = run;
