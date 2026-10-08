'use strict';

const assert = require('assert');
const App = require('../src/app.js');
const Platform = require('../src/platform/wechat.js');
const ProgressStore = require('../src/services/progress-store.js');
const layoutFor = require('../src/ui/account-layout.js');
const { fakeApi } = require('./account-bootstrap.test.js');
const { allOwnedRewardService } = require('./helpers/reward-fixture.js');

module.exports = async function run() {
  const raw = fakeApi();
  raw.onWindowResize = fn => { raw.resize = fn; };
  const app = new App(new Platform(raw), { rewardUnlocks: allOwnedRewardService() });
  const queued = [];
  app.progressSync = { enqueuePreference: (field, value) => queued.push({ field, value }),
    state: () => ({ status: 'idle' }), atCheckpoint: () => Promise.resolve() };
  app.start();
  const render = () => app.renderer.render(app.buildModel(), Date.now());
  const point = (value, id = 1) => {
    const track = layoutFor(app.platform.metrics).volumeTrack;
    return { x: track.x + track.w * value, y: track.y + track.h / 2, id };
  };
  const start = value => { render(); app.onPointerStart(point(value)); };
  try {
    app.openAccount();
    assert.strictEqual(app.buildModel().soundVolume, 1);
    start(0.25);
    assert.strictEqual(app.pointer.mode, 'volume');
    assert.strictEqual(app.audio.getVolume(), 0.25, 'a tap previews immediately');
    assert.strictEqual(app.progress.getSetting('soundVolume'), 1, 'preview does not write the save');
    app.onPointerMove(point(0.6));
    app.onPointerMove(point(0.1, 2));
    app.onPointerEnd(point(0, 2));
    assert.strictEqual(app.audio.getVolume(), 0.6, 'only the owning touch can move or end a drag');
    app.onPointerEnd(point(0.4));
    assert.strictEqual(app.audio.getVolume(), 0.4);
    assert.strictEqual(new ProgressStore(app.platform).getSetting('soundVolume'), 0.4);
    assert.deepStrictEqual(queued, [], 'ordinary volume adjustments do not enqueue cloud mute operations');

    start(0.2);
    app.onPointerEnd(point(-2));
    assert.strictEqual(app.audio.getVolume(), 0, 'release outside the track clamps to mute');
    assert.strictEqual(app.progress.getSetting('soundEnabled'), false);
    assert.strictEqual(app.progress.getSetting('soundVolume'), 0.4, 'mute retains the last audible level');
    start(0.2);
    app.onPointerEnd(point(0.2));
    assert.deepStrictEqual(queued, [{ field: 'soundEnabled', value: false }, { field: 'soundEnabled', value: true }]);

    start(0.9);
    app.onPointerCancel({ id: 2 });
    assert.strictEqual(app.audio.getVolume(), 0.9);
    app.onPointerCancel({ id: 1 });
    assert.strictEqual(app.audio.getVolume(), 0.2);
    start(0.8);
    raw.resize({});
    assert.strictEqual(app.audio.getVolume(), 0.2, 'resizing cancels the preview geometry');
    assert.strictEqual(app.pointer, null);
    start(0);
    app.onHide();
    assert.strictEqual(app.audio.getVolume(), 0.2, 'backgrounding discards an unfinished drag');
    assert.strictEqual(app.pointer, null);
    app.hidden = false;
    app.openAccount();
    start(0.75);
    app.performAction('account:back');
    assert.strictEqual(app.audio.getVolume(), 0.2, 'leaving Account discards an unfinished drag');
    render();
    assert(!app.renderer.hits.some(hit => hit.id === 'home:sound'));

    app.openAccount();
    start(0.8);
    const write = raw.setStorageSync;
    raw.setStorageSync = () => { throw Error('storage full'); };
    assert.strictEqual(app.onPointerEnd(point(1.5)), false);
    assert.strictEqual(app.audio.getVolume(), 0.2, 'failed saving restores the confirmed level');
    assert.strictEqual(app.progress.getSetting('soundVolume'), 0.2);
    assert.strictEqual(app.accountMessage, app.t('account.saveFailed'));
    assert.strictEqual(queued.length, 2);
    raw.setStorageSync = write;

    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const originalWrite = app.progress.setSetting.bind(app.progress);
    app.progress.setSettingAsync = async (name, value) => { await gate; return originalWrite(name, value); };
    app.appPersistence = {};
    start(0.7);
    const pending = app.onPointerEnd(point(1.5));
    assert.strictEqual(app.buildModel().volumePending, true);
    render();
    assert(!app.renderer.hits.some(hit => hit.id === 'account:volume'));
    app.onPointerStart(point(0.1));
    assert.strictEqual(app.audio.getVolume(), 1, 'pending persistence blocks a second preview');
    release();
    assert.strictEqual(await pending, true);
    assert.strictEqual(app.buildModel().volumePending, false);
    assert.strictEqual(app.progress.getSetting('soundVolume'), 1);
    app.progress.setSettingAsync = async () => false;
    start(0.1);
    assert.strictEqual(await app.onPointerEnd(point(0)), false);
    assert.strictEqual(app.audio.getVolume(), 1, 'asynchronous failure restores the confirmed level');
    assert.strictEqual(app.progress.getSetting('soundEnabled'), true);
    assert.strictEqual(app.buildModel().volumePending, false);
    assert.strictEqual(queued.length, 2);
    app.appPersistence = null;
  } finally { app.dispose(); }
};
