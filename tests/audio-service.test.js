'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const AudioService = require('../src/services/audio-service.js');
const audioConfig = require('../src/config/audio.js');

class FakeContext {
  constructor(options) {
    this.options = options || {};
    this.playCount = 0;
    this.pauseCount = 0;
    this.stopCount = 0;
    this.seekValues = [];
  }

  play() {
    this.playCount++;
    if (this.options.throwPlay) throw new Error('play failed');
    if (this.options.rejectPlay) return Promise.reject(new Error('play rejected'));
    return Promise.resolve();
  }

  pause() { this.pauseCount++; }
  stop() { this.stopCount++; }
  seek(value) { this.seekValues.push(value); }
  destroy() { this.destroyed = true; }
  onError(handler) { this.errorHandler = handler; }
}

function progressFixture(initial) {
  const settings = {};
  if (initial !== undefined) settings.soundEnabled = initial;
  return {
    settings,
    getSetting(name, fallback) { return settings[name] === undefined ? fallback : settings[name]; },
    setSetting(name, value) { settings[name] = value; return true; }
  };
}

function audioPlatform(factory) {
  const contexts = [];
  return {
    contexts,
    createAudioContext() {
      const context = factory ? factory(contexts.length) : new FakeContext();
      contexts.push(context);
      return context;
    }
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}

function subpackageFixture() {
  const requests = [];
  let ready = false;
  return {
    requests,
    packageForAsset(source) {
      return source.startsWith('assets/audio/bgm/') ? 'audio-bgm' : null;
    },
    isPackageReady(name) { return name === 'audio-bgm' && ready; },
    ensurePackage(name) {
      assert.strictEqual(name, 'audio-bgm');
      const request = deferred();
      request.promise.then(() => { ready = true; }, () => {});
      requests.push(request);
      return request.promise;
    }
  };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

function bgmContexts(platform) {
  return platform.contexts.filter(context => context.src === audioConfig.bgm.src);
}

async function run() {
  const root = path.resolve(__dirname, '..');
  assert.strictEqual(audioConfig.bgm.src, 'assets/audio/bgm/cleared-bgm.m4a');
  assert.strictEqual(audioConfig.bgm.volume, 0.28);
  assert.strictEqual(audioConfig.sfx.victory.src, 'assets/audio/victory-shimmer.m4a');
  assert.strictEqual(audioConfig.sfx.shimmer, undefined);
  assert(fs.existsSync(path.join(root, audioConfig.bgm.src)));
  assert.strictEqual(fs.existsSync(path.join(root, 'assets/audio/cleared-bgm.m4a')), false);
  Object.keys(audioConfig.sfx).forEach(name => {
    assert(fs.existsSync(path.join(root, audioConfig.sfx[name].src)), `${name} audio exists`);
  });

  const mainConfig = {
    enabledByDefault: true,
    bgm: { src: 'assets/audio/main-fixture.m4a', volume: 0.28 },
    sfx: audioConfig.sfx
  };
  const mainPlatform = audioPlatform();
  const mainProgress = progressFixture();
  const mainService = new AudioService(mainPlatform, mainProgress, mainConfig);
  assert.strictEqual(mainService.playBgm(), false, 'audio waits for a user gesture');
  assert.strictEqual(mainService.unlock(), true);
  assert.strictEqual(mainPlatform.contexts.length, 1, 'three-argument main-package callers remain compatible');
  assert.strictEqual(mainPlatform.contexts[0].loop, true);
  assert.strictEqual(mainService.playSfx('step'), true);
  assert.strictEqual(mainService.playSfx('step'), true);
  assert.strictEqual(mainPlatform.contexts.length, 2, 'a cue reuses its lightweight context');
  mainService.pauseAll();
  mainService.resumeAll();
  assert(mainPlatform.contexts[0].playCount > 1);
  mainService.dispose();
  assert.strictEqual(mainPlatform.contexts[0].destroyed, true);

  const mutedLoader = subpackageFixture();
  const muted = new AudioService(audioPlatform(), progressFixture(false), audioConfig, { subpackages: mutedLoader });
  muted.unlock();
  assert.strictEqual(mutedLoader.requests.length, 0, 'muted startup never downloads BGM');

  const loader = subpackageFixture();
  const platform = audioPlatform();
  const progress = progressFixture();
  const service = new AudioService(platform, progress, audioConfig, { subpackages: loader });
  service.unlock();
  service.unlock();
  service.playBgm();
  assert.strictEqual(loader.requests.length, 1, 'repeated gestures share one BGM download');
  assert.strictEqual(bgmContexts(platform).length, 0, 'BGM context is not created before its package is ready');
  assert.strictEqual(service.playSfx('step'), true, 'short effects remain available during BGM download');
  assert.strictEqual(service.playSfx('step'), true);
  assert.strictEqual(platform.contexts.length, 1, 'a pending BGM does not duplicate SFX contexts');
  assert.strictEqual(service.toggle(), false);
  loader.requests[0].resolve({ status: 'loaded' });
  await settle();
  assert.strictEqual(bgmContexts(platform).length, 0, 'a late success cannot play after sound is disabled');
  assert.strictEqual(service.toggle(), true);
  assert.strictEqual(loader.requests.length, 1, 'off-on during the same completed request does not redownload');
  assert.strictEqual(bgmContexts(platform).length, 1);
  assert.strictEqual(bgmContexts(platform)[0].playCount, 1);
  service.unlock();
  service.playBgm();
  assert.strictEqual(bgmContexts(platform)[0].playCount, 1,
    'ordinary gestures do not restart an already playing BGM context');

  service.pauseAll('background');
  service.pauseAll('interruption');
  const beforeResume = bgmContexts(platform)[0].playCount;
  service.resumeAll('interruption');
  assert.strictEqual(bgmContexts(platform)[0].playCount, beforeResume,
    'ending an interruption cannot cross the background suspension');
  service.resumeAll('background');
  assert.strictEqual(bgmContexts(platform)[0].playCount, beforeResume + 1);

  const hiddenLoader = subpackageFixture();
  const hiddenPlatform = audioPlatform();
  const hidden = new AudioService(hiddenPlatform, progressFixture(), audioConfig, { subpackages: hiddenLoader });
  hidden.unlock();
  hidden.pauseAll('background');
  hiddenLoader.requests[0].resolve({ status: 'loaded' });
  await settle();
  assert.strictEqual(bgmContexts(hiddenPlatform).length, 0, 'download completion stays silent in background');
  hidden.resumeAll('background');
  assert.strictEqual(bgmContexts(hiddenPlatform).length, 1, 'foregrounding restores the pending play intent');

  const pendingLoader = subpackageFixture();
  const pendingPlatform = audioPlatform();
  const pending = new AudioService(pendingPlatform, progressFixture(), audioConfig, { subpackages: pendingLoader });
  pending.unlock();
  pending.toggle();
  pending.toggle();
  assert.strictEqual(pendingLoader.requests.length, 1, 'off-on while pending never starts a parallel download');
  pendingLoader.requests[0].resolve({ status: 'loaded' });
  await settle();
  assert.strictEqual(bgmContexts(pendingPlatform).length, 1);

  const disposeLoader = subpackageFixture();
  const disposePlatform = audioPlatform();
  const disposed = new AudioService(disposePlatform, progressFixture(), audioConfig, { subpackages: disposeLoader });
  disposed.unlock();
  disposed.dispose();
  disposed.dispose();
  disposeLoader.requests[0].resolve({ status: 'loaded' });
  await settle();
  assert.strictEqual(disposePlatform.contexts.length, 0, 'dispose invalidates late package callbacks');
  assert.strictEqual(disposed.unlock(), false);
  assert.strictEqual(disposed.resumeAll('background'), false);

  const retryLoader = subpackageFixture();
  const retryPlatform = audioPlatform();
  const retry = new AudioService(retryPlatform, progressFixture(), audioConfig, { subpackages: retryLoader });
  retry.unlock();
  retryLoader.requests[0].reject(new Error('network'));
  await settle();
  retry.unlock();
  retry.playBgm();
  retry.playSfx('click');
  assert.strictEqual(retryLoader.requests.length, 1, 'ordinary gestures do not create a retry storm');
  retry.toggle();
  retry.toggle();
  assert.strictEqual(retryLoader.requests.length, 2, 'off-on explicitly permits one retry');
  retryLoader.requests[1].resolve({ status: 'loaded' });
  await settle();
  assert.strictEqual(bgmContexts(retryPlatform).length, 1);

  for (const subpackages of [
    { packageForAsset: () => 'audio-bgm' },
    { packageForAsset: () => 'audio-bgm', ensurePackage() { throw new Error('host failed'); } },
    { packageForAsset: () => 'audio-bgm', ensurePackage() { return Promise.reject(new Error('unsupported')); } }
  ]) {
    const unavailablePlatform = audioPlatform();
    const unavailable = new AudioService(unavailablePlatform, progressFixture(), audioConfig, { subpackages });
    assert.doesNotThrow(() => unavailable.unlock());
    await settle();
    assert.strictEqual(unavailablePlatform.contexts.length, 0,
      'a configured package path is never accessed when package loading is unavailable');
    assert.strictEqual(unavailable.playSfx('click'), true, 'loader failure does not disable main-package SFX');
  }
  const missingInjectionPlatform = audioPlatform();
  const missingInjection = new AudioService(missingInjectionPlatform, progressFixture(), audioConfig);
  missingInjection.unlock();
  assert.strictEqual(missingInjectionPlatform.contexts.length, 0,
    'the configured BGM package path is not mistaken for a main-package file without loader injection');

  let createAttempts = 0;
  const flakyCreatePlatform = audioPlatform(() => {
    createAttempts++;
    if (createAttempts === 1) throw new Error('decode unavailable');
    return new FakeContext();
  });
  const readyPackages = {
    packageForAsset: () => 'audio-bgm',
    isPackageReady: () => true,
    ensurePackage() { throw new Error('already ready'); }
  };
  const flakyCreate = new AudioService(flakyCreatePlatform, progressFixture(), audioConfig,
    { subpackages: readyPackages });
  assert.strictEqual(flakyCreate.unlock(), false);
  assert.strictEqual(createAttempts, 1);
  flakyCreate.unlock();
  assert.strictEqual(createAttempts, 1, 'context failure does not retry on ordinary gestures');
  flakyCreate.toggle();
  flakyCreate.toggle();
  assert.strictEqual(createAttempts, 2, 'explicit off-on can recover a context creation failure');

  let throwPlayAttempts = 0;
  const throwPlayPlatform = audioPlatform(() => new FakeContext({ throwPlay: throwPlayAttempts++ === 0 }));
  const throwPlay = new AudioService(throwPlayPlatform, progressFixture(), audioConfig,
    { subpackages: readyPackages });
  assert.strictEqual(throwPlay.unlock(), false);
  assert.strictEqual(throwPlayPlatform.contexts[0].destroyed, true);
  throwPlay.toggle();
  throwPlay.toggle();
  assert.strictEqual(bgmContexts(throwPlayPlatform).length, 2);
  assert.strictEqual(bgmContexts(throwPlayPlatform)[1].playCount, 1);

  let rejectPlayAttempts = 0;
  const rejectPlayPlatform = audioPlatform(() => new FakeContext({ rejectPlay: rejectPlayAttempts++ === 0 }));
  const rejectPlay = new AudioService(rejectPlayPlatform, progressFixture(), audioConfig,
    { subpackages: readyPackages });
  assert.strictEqual(rejectPlay.unlock(), true);
  await settle();
  assert.strictEqual(rejectPlayPlatform.contexts[0].destroyed, true,
    'an asynchronous play rejection is contained and releases its context');
  rejectPlay.toggle();
  rejectPlay.toggle();
  assert.strictEqual(bgmContexts(rejectPlayPlatform).length, 2);

  const sfxConfig = {
    enabledByDefault: true,
    sfx: { click: { src: 'assets/audio/ui-click.m4a', volume: 0.48 } }
  };
  const failingSfxPlatform = audioPlatform(() => new FakeContext({ throwPlay: true }));
  const failingSfx = new AudioService(failingSfxPlatform, progressFixture(), sfxConfig);
  failingSfx.unlock();
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.strictEqual(failingSfx.playSfx('click'), false);
    assert.strictEqual(failingSfx.sfx.click, undefined,
      'a synchronously failed SFX context is removed from the reuse pool');
  }
  assert.strictEqual(failingSfxPlatform.contexts.length, 3);
  assert(failingSfxPlatform.contexts.every(context => context.destroyed),
    'repeated synchronous SFX failures do not accumulate live audio contexts');

  const rejectingSfxPlatform = audioPlatform(() => new FakeContext({ rejectPlay: true }));
  const rejectingSfx = new AudioService(rejectingSfxPlatform, progressFixture(), sfxConfig);
  rejectingSfx.unlock();
  assert.strictEqual(rejectingSfx.playSfx('click'), true);
  await settle();
  assert.strictEqual(rejectingSfx.sfx.click, undefined,
    'an asynchronously failed SFX context is removed from the reuse pool');
  assert.strictEqual(rejectingSfxPlatform.contexts[0].destroyed, true);

  const stalePlay = deferred();
  const staleSfxPlatform = audioPlatform(() => {
    const context = new FakeContext();
    context.play = function play() {
      this.playCount++;
      return this.playCount === 1 ? stalePlay.promise : Promise.resolve();
    };
    return context;
  });
  const staleSfx = new AudioService(staleSfxPlatform, progressFixture(), sfxConfig);
  staleSfx.unlock();
  assert.strictEqual(staleSfx.playSfx('click'), true);
  assert.strictEqual(staleSfx.playSfx('click'), true);
  stalePlay.reject(new Error('superseded play failed'));
  await settle();
  assert.strictEqual(staleSfxPlatform.contexts[0].destroyed, undefined,
    'an obsolete rejection cannot destroy a context reused by a newer play');
  assert.strictEqual(staleSfx.sfx.click.length, 1);

  const errorPlatform = audioPlatform();
  const contextError = new AudioService(errorPlatform, progressFixture(), audioConfig,
    { subpackages: readyPackages });
  contextError.unlock();
  const failedContext = bgmContexts(errorPlatform)[0];
  failedContext.errorHandler(new Error('decode failed'));
  assert.strictEqual(failedContext.destroyed, true);
  contextError.unlock();
  assert.strictEqual(bgmContexts(errorPlatform).length, 1, 'onError waits for explicit retry');
  contextError.toggle();
  contextError.toggle();
  assert.strictEqual(bgmContexts(errorPlatform).length, 2);

  const newProcessLoader = subpackageFixture();
  const newProcess = new AudioService(audioPlatform(), progressFixture(), audioConfig,
    { subpackages: newProcessLoader });
  newProcess.unlock();
  assert.strictEqual(newProcessLoader.requests.length, 1,
    'a rebuilt service asks the host again instead of trusting persistent download state');
}

module.exports = run;
