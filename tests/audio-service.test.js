'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const AudioService = require('../src/services/audio-service.js');
const audioConfig = require('../src/config/audio.js');
const ProgressStore = require('../src/services/progress-store.js');

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

async function testMusicSelection() {
  const first = { id: 'first', name: 'First', src: 'assets/audio/first.m4a', volume: 0.2 };
  const second = { id: 'second', name: 'Second', src: 'assets/audio/second.m4a', volume: 0.4 };
  const config = { bgm: first, tracks: [first, second], enabledByDefault: true };
  const platform = audioPlatform();
  const progress = progressFixture();
  const service = new AudioService(platform, progress, config);
  assert.strictEqual(service.currentMusicId(), 'first');
  assert.deepStrictEqual(service.listMusic().map(({ id, name }) => ({ id, name })),
    [{ id: 'first', name: 'First' }, { id: 'second', name: 'Second' }]);
  service.listMusic()[0].name = 'Mutated';
  assert.strictEqual(service.listMusic()[0].name, 'First', 'gallery descriptors do not mutate audio definitions');
  service.unlock();
  assert.strictEqual(service.selectMusic('first'), true);
  assert.strictEqual(platform.contexts[0].playCount, 1, 'selecting the current track keeps its playback position');
  assert.strictEqual(service.selectMusic('missing'), false);
  assert.strictEqual(progress.settings.musicId, undefined);
  assert.strictEqual(service.selectMusic('second'), true);
  assert.strictEqual(platform.contexts[0].destroyed, true, 'switching releases the previous BGM');
  assert.strictEqual(platform.contexts[1].src, second.src);
  assert.strictEqual(platform.contexts[1].volume, second.volume);
  assert.strictEqual(progress.settings.musicId, 'second');
  assert.strictEqual(new AudioService(audioPlatform(), progress, config).currentMusicId(), 'second');
  progress.settings.musicId = 'removed';
  assert.strictEqual(new AudioService(audioPlatform(), progress, config).currentMusicId(), 'first',
    'unknown stored tracks safely fall back to the default');
  const originalSave = progress.setSetting;
  progress.setSetting = () => false;
  assert.strictEqual(service.selectMusic('first'), false);
  assert.strictEqual(service.currentMusicId(), 'second', 'failed persistence cannot change the checked track');
  assert.strictEqual(platform.contexts[1].destroyed, undefined);
  progress.setSetting = originalSave;
  service.toggle();
  assert.strictEqual(service.selectMusic('first'), true);
  assert.strictEqual(platform.contexts.length, 2, 'choosing music while muted does not play it');
  assert.strictEqual(service.isEnabled(), false, 'selection does not enable sound');
  service.toggle();
  service.pauseAll('background');
  service.pauseAll('interruption');
  service.selectMusic('second');
  assert.strictEqual(platform.contexts.length, 3, 'selection cannot bypass background/interruption guards');
  service.resumeAll('background');
  assert.strictEqual(platform.contexts.length, 3);
  service.resumeAll('interruption');
  assert.strictEqual(platform.contexts[3].src, second.src);

  const asyncSave = deferred();
  progress.setSettingAsync = () => asyncSave.promise;
  const selection = service.selectMusicAsync('first');
  assert.strictEqual(service.currentMusicId(), 'second', 'async selection waits for persistence');
  asyncSave.resolve(false);
  assert.strictEqual(await selection, false);
  assert.strictEqual(service.currentMusicId(), 'second');
  progress.setSettingAsync = async (key, value) => progress.setSetting(key, value);
  assert.strictEqual(await service.selectMusicAsync('first'), true);
  assert.strictEqual(service.currentMusicId(), 'first');
  const pendingSave = deferred();
  const requests = [];
  let writeQueue = Promise.resolve();
  progress.setSettingAsync = (key, value) => {
    requests.push(value);
    const saved = writeQueue.then(async () => {
      if (value === 'second') await pendingSave.promise;
      return progress.setSetting(key, value);
    });
    writeQueue = saved.then(() => undefined);
    return saved;
  };
  const oldSelection = service.selectMusicAsync('second');
  const latestSelection = service.selectMusicAsync('first');
  assert.strictEqual(service.currentMusicId(), 'first', 'pending saves keep the current selection');
  pendingSave.resolve(true);
  assert.strictEqual(await oldSelection, true);
  assert.strictEqual(await latestSelection, true);
  assert.deepStrictEqual(requests, ['second', 'first'], 'returning to the current track also persists the latest intent');
  assert.strictEqual(service.currentMusicId(), 'first', 'serialized saves preserve the latest selection');
  assert.strictEqual(progress.settings.musicId, 'first', 'the checked track matches the durable preference');
  progress.setSettingAsync = async () => { throw new Error('storage unavailable'); };
  assert.strictEqual(await service.selectMusicAsync('second'), false);
  assert.strictEqual(service.currentMusicId(), 'first');
  service.dispose();
  assert.strictEqual(service.selectMusic('second'), false);

  const loader = subpackageFixture();
  const racePlatform = audioPlatform();
  const race = new AudioService(racePlatform, progressFixture(), {
    bgm: audioConfig.bgm, tracks: [audioConfig.bgm, second]
  }, { subpackages: loader });
  race.unlock();
  const oldRequest = race.bgmLoadPromise;
  race.selectMusic('second');
  loader.requests[0].resolve({ status: 'loaded' });
  await oldRequest;
  assert.deepStrictEqual(racePlatform.contexts.map(context => context.src), [second.src],
    'a late download cannot start the previous track after selection changes');
  race.dispose();

  const rejectedPlay = deferred();
  const stalePlatform = audioPlatform(index => {
    const context = new FakeContext();
    if (index === 0) context.play = () => rejectedPlay.promise;
    return context;
  });
  const stale = new AudioService(stalePlatform, progressFixture(), config);
  stale.unlock();
  stale.selectMusic('second');
  rejectedPlay.reject(new Error('old playback failed'));
  await settle();
  assert.strictEqual(stale.bgm.src, second.src);
  assert.strictEqual(stale.bgm.destroyed, undefined, 'a stale rejection cannot destroy the new track');
  stale.dispose();
}

async function testMasterVolume() {
  const platform = audioPlatform();
  const storage = {};
  platform.getStorage = key => storage[key];
  platform.setStorage = (key, value) => {
    if (platform.failSave) return false;
    storage[key] = JSON.parse(JSON.stringify(value)); return true;
  };
  const progress = new ProgressStore(platform);
  const config = { bgm: { id: 'test', src: 'assets/audio/test.m4a', volume: 0.28 },
    sfx: { complete: { src: 'assets/audio/path-complete.m4a', volume: 0.52, durationMs: 354 } } };
  const service = new AudioService(platform, progress, config);
  const near = (actual, expected) => assert(Math.abs(actual - expected) < 1e-10);
  service.unlock(); service.playSfx('complete', true);
  const bgm = service.bgm;
  service.previewVolume(0.5);
  near(bgm.volume, 0.14);
  near(service.sfx.complete[0].volume, 0.26);
  service.playSfx('complete', true);
  near(service.sfx.complete[1].volume, 0.26, 'new overlapping voices inherit the master volume');
  const plays = bgm.playCount;
  const contextCount = platform.contexts.length;
  for (let step = 1; step <= 20; step++) service.previewVolume(step / 20);
  assert.strictEqual(platform.contexts.length, contextCount, 'drag frames reuse the existing contexts');
  service.previewVolume(0.75);
  assert.strictEqual(bgm.playCount, plays, 'dragging an audible slider does not restart the BGM');
  assert.strictEqual(service.setVolume(0.5), true);
  service.startClearSequence({ cells: [0, 1], startedAt: Date.now(), durationMs: 240, mode: 'sequential' });
  service.previewVolume(0);
  assert.strictEqual(service.clearSequence, null);
  assert(bgm.pauseCount > 0);
  service.refreshSetting();
  near(bgm.volume, 0.14);
  assert.strictEqual(service.setVolume(0), true);
  assert.strictEqual(new AudioService(audioPlatform(), new ProgressStore(platform), config).getVolume(), 0);
  progress.setSetting('soundEnabled', true);
  service.refreshSetting();
  assert.strictEqual(service.getVolume(), 0.5, 'cloud unmute keeps this device’s last audible level');
  platform.failSave = true;
  service.previewVolume(0.1);
  assert.strictEqual(service.setVolume(0.1), false);
  assert.strictEqual(service.getVolume(), 0.5);
  near(bgm.volume, 0.14);
  platform.failSave = false;
  for (const value of [-0.1, 1.1, NaN, Infinity, '0.5']) {
    assert.strictEqual(service.previewVolume(value), false);
    assert.strictEqual(service.setVolume(value), false);
  }
  service.pauseAll('background');
  const backgroundPlays = bgm.playCount;
  service.previewVolume(0); service.previewVolume(0.4);
  assert.strictEqual(bgm.playCount, backgroundPlays, 'adjustments cannot bypass lifecycle suspension');
  progress.setSettingAsync = async () => false;
  assert.strictEqual(await service.setVolumeAsync(0.2), false);
  assert.strictEqual(service.getVolume(), 0.5);
  service.dispose();
}

async function run() {
  await testMasterVolume();
  await testMusicSelection();
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
