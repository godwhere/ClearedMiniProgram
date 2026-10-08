'use strict';

const assert = require('assert');
const ClearedApp = require('../src/app.js');
const WechatPlatform = require('../src/platform/wechat.js');
const ProgressStore = require('../src/services/progress-store.js');
const PreferencesService = require('../src/services/preferences-service.js');
const timing = require('../src/services/clear-animation-timing.js');
const dailySolutions = require('../data/daily-solutions.js');
const { fakeApi } = require('./account-bootstrap.test.js');
const { allOwnedRewardService } = require('./helpers/reward-fixture.js');

module.exports = function run() {
  const originalNow = Date.now;
  let now = 10000;
  Date.now = () => now;
  const voices = [];
  const raw = fakeApi();
  raw.createInnerAudioContext = () => {
    const voice = { plays: 0, stops: 0, play() { this.plays++; }, stop() { this.stops++; }, seek() {}, pause() {}, destroy() {} };
    voices.push(voice); return voice;
  };
  const app = new ClearedApp(new WechatPlatform(raw), { rewardUnlocks: allOwnedRewardService() });
  const plays = name => voices.filter(voice => voice.src.endsWith(name)).reduce((sum, voice) => sum + voice.plays, 0);
  try {
    assert.strictEqual(app.currentClearMode(), 'simultaneous');
    app.openLevel(0, 0);
    app.runner.touchStart(0); [1, 2, 3, 4].forEach(index => app.runner.touchMove(index)); app.runner.touchEnd(4);
    app.onPathCompleted(0, [0, 1, 2, 3, 4]);
    assert.strictEqual(app.clearAnimation, null, 'default no-effect play clears all cells immediately');
    app.openAccount();
    assert.strictEqual(app.buildModel().clearMode, 'simultaneous');
    assert.strictEqual(app.performAction('account:clearMode:next'), true);
    assert.strictEqual(new ProgressStore(app.platform).getSetting('clearMode'), 'sequential', 'sequential remains selectable and persisted');
    app.audio.unlocked = true;
    app.setClearEffect('starburst'); app.openLevel(0, 0);
    app.runner.touchStart(0); [1, 2, 3, 4].forEach(index => app.runner.touchMove(index)); app.runner.touchEnd(4);
    app.onPathCompleted(0, [0, 1, 2, 3, 4]);
    const animation = app.clearAnimation;
    assert.strictEqual(animation.clearMode, 'sequential');
    assert.strictEqual(timing.duration(animation), 900);
    assert.strictEqual(app.resultVisibleAt, 10900, 'results wait for the final particle tail');
    assert.strictEqual(plays('path-complete.m4a'), 1);
    assert.strictEqual(plays('victory-shimmer.m4a'), 0);
    now = 10119; app.tick(now); assert.strictEqual(plays('path-complete.m4a'), 1);
    for (let index = 1; index < 5; index++) { now = 10000 + index * 120; app.tick(now); }
    assert.strictEqual(plays('path-complete.m4a'), 5, 'each cell gets the same completion clip');
    assert(voices.filter(voice => voice.src.endsWith('path-complete.m4a')).length <= 4);
    app.progress.setSetting('clearMode', 'simultaneous');
    assert.strictEqual(animation.clearMode, 'sequential', 'mode changes cannot alter an active snapshot');
    assert(app.isAnimating(10900));
    now = 10900; app.tick(now); assert.strictEqual(plays('victory-shimmer.m4a'), 1);
    now = 11000; app.tick(now); assert.strictEqual(plays('path-complete.m4a'), 5);

    const layout = { x: 0, y: 0, cols: 5, rows: 1, cell: 40 };
    const tiles = [];
    const drawTile = app.renderer.drawTile;
    app.renderer.drawTile = (line, x, y, size, options) => tiles.push({ x, alpha: options.alpha });
    function draw(snapshot, elapsed) {
      tiles.length = 0;
      app.renderer.boardRenderer.drawClearAnimation(snapshot, ['#f00'], snapshot.startedAt + elapsed, 2, layout, new Set());
      return tiles.slice();
    }
    assert.strictEqual(draw(animation, 119).filter(tile => tile.alpha === 1).length, 4, 'future cells stay intact');
    assert.strictEqual(draw(animation, 180).filter(tile => tile.alpha < 1).length, 2);
    assert.strictEqual(draw(animation, 900).length, 0);
    const none = Object.assign({}, animation, { type: 'none', effectId: 'none', durationMs: 0 });
    assert.deepStrictEqual(draw(none, 0).map(tile => tile.x), [42, 82, 122, 162]);
    assert.deepStrictEqual(draw(none, 120).map(tile => tile.x), [82, 122, 162]);
    assert.strictEqual(draw(none, 480).length, 0, 'no-effect selection still clears in the chosen order');
    app.renderer.drawTile = drawTile;

    now = 12000;
    app.openLevel(0, 0); app.progress.setSetting('clearMode', 'sequential');
    app.onPathCompleted(0, [0, 1, 2, 3, 4]);
    const beforeLag = plays('path-complete.m4a');
    now += 400; app.tick(now);
    assert.strictEqual(plays('path-complete.m4a'), beforeLag + 1, 'a late frame skips old triggers instead of bursting');
    app.performAction('play:back'); now += 120; app.tick(now);
    assert.strictEqual(app.audio.clearSequence, null, 'leaving the board cancels pending sound');
    const afterLeave = plays('path-complete.m4a'); now += 1000; app.tick(now);
    assert.strictEqual(plays('path-complete.m4a'), afterLeave);
    app.openLevel(0, 0); app.onPathCompleted(0, [0, 1, 2]); app.onHide();
    assert.strictEqual(app.audio.clearSequence, null, 'backgrounding cannot replay pending sounds on return');

    app.hidden = false; app.performAction('home:account'); app.openAccount();
    const queued = [];
    app.progressSync = { enqueuePreference(field, value) { queued.push({ field, value }); }, state: () => ({ status: 'idle' }) };
    assert.strictEqual(app.performAction('account:clearMode'), true);
    assert.strictEqual(app.buildModel().clearMode, 'simultaneous');
    assert.deepStrictEqual(queued, [{ field: 'clearMode', value: 'simultaneous' }]);
    assert.strictEqual(new ProgressStore(app.platform).getSetting('clearMode'), 'simultaneous');
    app.tick(now);
    assert(app.renderer.hits.some(hit => hit.id === 'account:clearMode:prev'));
    assert(app.renderer.hits.some(hit => hit.id === 'account:clearMode:next'));
    assert(!app.renderer.hits.some(hit => hit.id === 'account:clearMode'));
    assert.strictEqual(app.performAction('account:clearMode:next'), true);
    assert.strictEqual(new ProgressStore(app.platform).getSetting('clearMode'), 'sequential');
    assert.strictEqual(app.performAction('account:clearMode:prev'), true);
    assert.strictEqual(new ProgressStore(app.platform).getSetting('clearMode'), 'simultaneous');
    assert.deepStrictEqual(queued.map(item => item.value), ['simultaneous', 'sequential', 'simultaneous']);
    app.performAction('account:back');
    assert.strictEqual(app.performAction('account:clearMode:next'), false);
    assert.strictEqual(app.performAction('account:clearMode:prev'), false);
    assert.strictEqual(queued.length, 3, 'account controls cannot change settings from another scene');
    app.openAccount();
    raw.setStorageSync = () => { throw Error('full'); };
    assert.strictEqual(app.performAction('account:clearMode:next'), false);
    assert.strictEqual(app.performAction('account:clearMode:prev'), false);
    assert.strictEqual(app.currentClearMode(), 'simultaneous', 'failed saves keep the last confirmed choice');
    assert.strictEqual(queued.length, 3);
    assert.strictEqual(app.progress.setSetting('clearMode', 'invalid'), false);
    const preferences = new PreferencesService(app.progress);
    assert.strictEqual(preferences.applyAuthoritativeSnapshot({ schemaVersion: 1, skinId: 'classic',
      clearEffectId: 'none', soundEnabled: true, clearMode: 'invalid' }, []).reason, 'invalid-snapshot');
    const long = { cells: Array.from({ length: 80 }, (_, i) => i), durationMs: 500, type: 'petals', clearMode: 'sequential' };
    assert.strictEqual(timing.duration(long), 9980);

    const dailyRaw = fakeApi();
    dailyRaw.createInnerAudioContext = () => ({ play() {}, stop() {}, seek() {}, pause() {}, destroy() {} });
    const dailyApp = new ClearedApp(new WechatPlatform(dailyRaw), {
      rewardUnlocks: allOwnedRewardService(), dailyTestDateKey: '2026-10-08'
    });
    try {
      dailyApp.audio.unlocked = true;
      assert.strictEqual(dailyApp.progress.setSetting('clearMode', 'sequential'), true);
      assert.strictEqual(dailyApp.enterDaily(), true);
      const warmup = dailyApp.daily.runner;
      const paths = dailySolutions.ByChallengeId[dailyApp.daily.challengeId];
      paths.forEach((path, lineIndex) => {
        warmup.touchStart(path[0]); path.slice(1).forEach(index => warmup.touchMove(index));
        assert.strictEqual(warmup.touchEnd(path[path.length - 1]), true);
        dailyApp.onPathCompleted(lineIndex, path);
      });
      const nextAt = dailyApp.daily.nextLevelAt;
      assert.strictEqual(dailyApp.daily.levelIndex, 0, 'warmup stays visible during its final sequence');
      assert(nextAt >= now + (paths[paths.length - 1].length - 1) * 120 + 354, 'transition waits for the last sound');
      now = nextAt - 1; dailyApp.tick(now);
      assert.strictEqual(dailyApp.daily.runner, warmup);
      now = nextAt; dailyApp.tick(now);
      assert.strictEqual(dailyApp.daily.levelIndex, 1);
      assert.notStrictEqual(dailyApp.daily.runner, warmup);
      assert.strictEqual(dailyApp.audio.clearSequence, null);
    } finally { dailyApp.dispose(); }
  } finally { app.progressSync = null; app.dispose(); Date.now = originalNow; }
};
