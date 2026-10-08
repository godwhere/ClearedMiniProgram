'use strict';

const assert = require('assert');
const ClearedApp = require('../src/app.js');
const audioConfig = require('../src/config/audio.js');
const SubpackageService = require('../src/services/subpackage-service.js');
const i18n = require('../src/i18n/index.js');

function platformFixture(metrics) {
  const text = [];
  const sources = [];
  const storage = {};
  const context = new Proxy({
    fillText(value) { text.push(String(value)); },
    measureText(value) { return { width: String(value).length * 8 }; }
  }, { get(target, key) {
    if (!(key in target)) target[key] = function () {};
    return target[key];
  } });
  return {
    context, text, sources, storage,
    metrics: metrics || { width: 390, height: 844, safeTop: 44, safeBottom: 810 },
    getStorage(key) { return storage[key] || null; },
    readStorageResult(key) {
      return Object.prototype.hasOwnProperty.call(storage, key)
        ? { ok: true, found: true, value: JSON.parse(JSON.stringify(storage[key])) }
        : { ok: true, found: false };
    },
    setStorage(key, value) { storage[key] = JSON.parse(JSON.stringify(value)); return true; },
    createImage(source, callback) { sources.push(source); callback(new Error('asset unavailable')); },
    createAudioContext() { return null; },
    triggerHaptic() {},
    bindPointer() { return function () {}; }, bindLifecycle() {}, startLoop() {}
  };
}

function tap(app, id) {
  const hit = app.renderer.hits.find(item => item.id === id);
  assert(hit, `${id} is reachable`);
  const point = { id: 1, x: hit.rect.x + hit.rect.w / 2, y: hit.rect.y + hit.rect.h / 2 };
  app.onPointerStart(point);
  app.onPointerEnd(point);
}

function draw(app, platform) {
  platform.text.length = 0;
  app.renderer.render(app.buildModel(), Date.now());
}

async function run() {
  assert.strictEqual(audioConfig.tracks[0], audioConfig.bgm, 'the default BGM and gallery share one definition');
  const defaultTrack = audioConfig.tracks[0];
  assert.strictEqual(defaultTrack.name, '格间微光');
  assert.strictEqual(defaultTrack.src, 'assets/audio/bgm/cleared-bgm.m4a');
  audioConfig.tracks.forEach(track => {
    assert.strictEqual(i18n.CATALOGS['zh-CN'][`music.${track.id}.name`], track.name);
    assert(i18n.CATALOGS['en-US'][`music.${track.id}.name`]);
  });

  for (const metrics of [
    { width: 320, height: 568, safeTop: 44, safeBottom: 548 },
    { width: 390, height: 844, safeTop: 44, safeBottom: 810 },
    { width: 430, height: 932, safeTop: 59, safeBottom: 898 }
  ]) {
    const platform = platformFixture(metrics);
    const app = new ClearedApp(platform);
    app.performAction('home:corridor');
    draw(app, platform);
    assert.deepStrictEqual(app.renderer.hits.filter(hit => hit.id.startsWith('corridor:')).map(hit => hit.id),
      ['corridor:home', 'corridor:themes', 'corridor:effects', 'corridor:music']);
    tap(app, 'corridor:music');
    draw(app, platform);
    assert.strictEqual(app.scene, 'music');
    assert.strictEqual(app.buildModel().currentMusicId, defaultTrack.id);
    assert(platform.text.includes('音乐'));
    assert(platform.text.includes('格间微光'));
    assert.strictEqual(platform.text.filter(value => value === '✓').length, 1, 'the only track is checked by default');
    assert.deepStrictEqual(app.renderer.hits.map(hit => hit.id),
      ['music:corridor', `music:${defaultTrack.id}`, 'music:candy-day-stroll'],
      'empty slots and single-page arrows are inactive');
    app.renderer.hits.forEach(hit => {
      assert(hit.rect.x >= 0 && hit.rect.x + hit.rect.w <= metrics.width);
      assert(hit.rect.y >= metrics.safeTop && hit.rect.y + hit.rect.h <= metrics.safeBottom);
    });
    assert(platform.sources.includes('assets/music-previews/candy-day-stroll.png'), 'locked music displays its main-package cover');
    const before = JSON.stringify(app.progress.state);
    tap(app, `music:${defaultTrack.id}`);
    assert.strictEqual(app.scene, 'music');
    assert.strictEqual(JSON.stringify(app.progress.state), before, 'selecting the default leaves gameplay and progress intact');
    assert.strictEqual(app.performAction('music:missing'), false);
    tap(app, 'music:corridor');
    assert.strictEqual(app.scene, 'corridor');
    app.audio.dispose();
  }

  const platform = platformFixture();
  const tracks = Array.from({ length: 7 }, (_, index) => ({
    id: `track-${index}`, name: `Track ${index}`, src: `assets/audio/track-${index}.m4a`, volume: 0.2
  }));
  const config = { bgm: tracks[0], tracks, sfx: {} };
  const app = new ClearedApp(platform, { audioConfig: config });
  app.performAction('home:corridor');
  app.performAction('corridor:music');
  draw(app, platform);
  assert.strictEqual(app.buildModel().musicPageCount, 2);
  tap(app, 'music:next');
  draw(app, platform);
  assert.deepStrictEqual(app.renderer.hits.filter(hit => /^music:track-/.test(hit.id)).map(hit => hit.id),
    ['music:track-6']);
  const unrelated = {
    completed: JSON.stringify(app.progress.state.completed), skinId: app.progress.getSetting('skinId'),
    clearEffectId: app.progress.getSetting('clearEffectId'), levelPageIndex: app.levelPageIndex,
    themePageIndex: app.themePageIndex, effectPageIndex: app.effectPageIndex
  };
  tap(app, 'music:track-6');
  draw(app, platform);
  assert.strictEqual(app.progress.getSetting('musicId'), 'track-6');
  assert.strictEqual(platform.text.filter(value => value === '✓').length, 1);
  assert.strictEqual(new ClearedApp(platform, { audioConfig: config }).audio.currentMusicId(), 'track-6');
  // Swipe from an empty slot: it changes only the music page and never selects a card.
  app.onPointerStart({ id: 3, x: 60, y: 620 });
  app.onPointerEnd({ id: 3, x: 140, y: 620 });
  assert.strictEqual(app.musicPageIndex, 0);
  assert.strictEqual(app.audio.currentMusicId(), 'track-6');
  draw(app, platform);
  assert.strictEqual(platform.text.includes('✓'), false, 'a selected track on another page does not check the visible cards');
  platform.setStorage = () => false;
  assert.strictEqual(app.performAction('music:track-1'), false);
  assert.strictEqual(app.audio.currentMusicId(), 'track-6');
  assert.strictEqual(app.progress.getSetting('musicId'), 'track-6');
  assert.deepStrictEqual({
    completed: JSON.stringify(app.progress.state.completed), skinId: app.progress.getSetting('skinId'),
    clearEffectId: app.progress.getSetting('clearEffectId'), levelPageIndex: app.levelPageIndex,
    themePageIndex: app.themePageIndex, effectPageIndex: app.effectPageIndex
  }, unrelated);
  app.musicPageIndex = 999;
  assert.strictEqual(app.buildModel().musicPageIndex, 1);
  app.changeMusicPage(-999);
  assert.strictEqual(app.musicPageIndex, 0);
  app.audio.dispose();

  const englishPlatform = platformFixture();
  const english = new ClearedApp(englishPlatform, { locale: {
    current() { return 'en-US'; }, t(key, params) { return i18n.translate('en-US', key, params); }
  } });
  english.performAction('corridor:music');
  draw(english, englishPlatform);
  assert(englishPlatform.text.includes('Music'));
  assert(englishPlatform.text.includes('Glimmer Between Tiles'));
  assert(englishPlatform.text.includes('Stroll'));
  english.audio.dispose();
  await testMusicPurchaseAndLoading();
}

async function testMusicPurchaseAndLoading() {
  const id = 'candy-day-stroll';
  const rewardId = `music:${id}`;
  const platform = platformFixture();
  const downloads = [];
  platform.loadSubpackage = (name, callbacks) => downloads.push({ name, callbacks });
  const app = new ClearedApp(platform, { subpackages: new SubpackageService(platform) });
  app.progress.setSetting('soundEnabled', false);
  app.audio.refreshSetting();
  app.performAction('corridor:music');
  assert.strictEqual(app.rewardUnlocks.status(rewardId).cost, 10000);
  assert.strictEqual(app.audio.selectMusic(id), false, 'audio service also rejects locked music');
  assert.strictEqual(await app.audio.selectMusicAsync(id), false);
  app.performAction(`music:${id}`);
  assert.strictEqual(app.rewardDialog.title, '漫步');
  assert.strictEqual(downloads.length, 0, 'browsing and opening a locked card never downloads audio');
  const poor = app.requestRewardUnlock();
  assert.strictEqual(poor.reason, 'insufficient-balance');
  assert.strictEqual(app.rewardUnlocks.view().balance, 0);
  assert.strictEqual(app.rewardUnlocks.owned(rewardId), false);
  app.rewardUnlocks.state.balance = 10000;
  assert(app.rewardUnlocks.write(app.rewardUnlocks.state));
  const bought = app.requestRewardUnlock();
  assert(bought.ok);
  assert.strictEqual(app.rewardUnlocks.view().balance, 0);
  assert.strictEqual(app.rewardDialog.mode, 'unlocked');
  assert.strictEqual(app.audio.currentMusicId(), 'grid-glow', 'purchase and applying are separate');
  assert.strictEqual(downloads.length, 0);
  assert(app.dismissRewardDialog(), 'maybe later acknowledges ownership without playing');
  assert.strictEqual(app.audio.currentMusicId(), 'grid-glow');
  draw(app, platform);
  assert(platform.text.includes('点击下载'), 'owned music uses the shared gallery download status');
  assert(app.openRewardDialog(rewardId, 'unlocked'));
  const failed = app.applyReward();
  draw(app, platform);
  assert(platform.text.includes('下载 0%'));
  assert.strictEqual(downloads[0].name, 'audio-candy-day-stroll');
  assert.strictEqual(app.audio.currentMusicId(), 'grid-glow', 'keep the previous track during download');
  downloads[0].callbacks.fail({ code: 'SUBPACKAGE_LOAD_FAILED' });
  assert.strictEqual(await failed, false);
  draw(app, platform);
  assert(platform.text.includes('加载失败，点击重试'));
  assert.strictEqual(app.audio.currentMusicId(), 'grid-glow');
  assert.strictEqual(app.progress.getSetting('musicId'), undefined);
  assert(app.rewardUnlocks.owned(rewardId), 'failed asset load never removes paid ownership');
  const retry = app.applyReward();
  assert.strictEqual(downloads.length, 2);
  downloads[1].callbacks.success();
  assert.strictEqual(await retry, true);
  assert.strictEqual(app.audio.currentMusicId(), id);
  assert.strictEqual(app.progress.getSetting('musicId'), id);
  assert.strictEqual(app.rewardUnlocks.purchase(rewardId).amountDelta, 0, 'repeat purchase never charges twice');
  const restarted = new ClearedApp(platform, { subpackages: new SubpackageService(platform) });
  assert(restarted.rewardUnlocks.owned(rewardId));
  assert.strictEqual(restarted.audio.currentMusicId(), id);
  assert.strictEqual(restarted.subpackages.isPackageReady('audio-candy-day-stroll'), false,
    'download readiness is not stored across processes');
  assert.strictEqual(downloads.length, 2, 'muted restart does not download music');
  restarted.audio.dispose(); app.audio.dispose();

  const racePlatform = platformFixture();
  const pending = [];
  racePlatform.loadSubpackage = (name, callbacks) => pending.push({ name, callbacks });
  const race = new ClearedApp(racePlatform, { subpackages: new SubpackageService(racePlatform) });
  race.rewardUnlocks.state.balance = 10000;
  assert(race.rewardUnlocks.write(race.rewardUnlocks.state));
  assert(race.rewardUnlocks.purchase(rewardId).ok);
  const stale = race.setMusic(id);
  assert.strictEqual(race.setMusic('grid-glow'), true);
  pending[0].callbacks.success();
  assert.strictEqual(await stale, false, 'late download cannot replace a later choice');
  assert.strictEqual(race.audio.currentMusicId(), 'grid-glow');
  racePlatform.setStorage = () => false;
  assert.strictEqual(race.setMusic(id), false, 'a ready download cannot bypass selection save failure');
  assert.strictEqual(race.audio.currentMusicId(), 'grid-glow');
  race.audio.dispose();

  const cancelPlatform = platformFixture();
  let cancelDownload;
  cancelPlatform.loadSubpackage = (name, callbacks) => { cancelDownload = callbacks; };
  const cancel = new ClearedApp(cancelPlatform, { subpackages: new SubpackageService(cancelPlatform) });
  cancel.rewardUnlocks.state.balance = 10000;
  assert(cancel.rewardUnlocks.write(cancel.rewardUnlocks.state));
  assert(cancel.rewardUnlocks.purchase(rewardId).ok);
  assert(cancel.openRewardDialog(rewardId, 'unlocked'));
  const canceledApply = cancel.applyReward();
  assert(cancel.dismissRewardDialog());
  cancelDownload.success();
  assert.strictEqual(await canceledApply, false, 'closing the applying dialog cancels the late selection');
  assert.strictEqual(cancel.audio.currentMusicId(), 'grid-glow');
  assert(cancel.rewardUnlocks.owned(rewardId), 'canceling application keeps permanent ownership');
  cancel.audio.dispose();

  // A stale paid selection cannot bypass ownership after an account restore.
  const lockedPlatform = platformFixture();
  const locked = new ClearedApp(lockedPlatform);
  locked.progress.setSetting('musicId', id);
  locked.audio.refreshSetting();
  assert.strictEqual(locked.audio.currentMusicId(), 'grid-glow');
  assert.strictEqual(new ClearedApp(lockedPlatform).audio.currentMusicId(), 'grid-glow');
  locked.audio.dispose();
}

module.exports = run;
