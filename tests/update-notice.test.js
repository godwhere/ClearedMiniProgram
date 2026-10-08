'use strict';

const assert = require('assert');
const ClearedApp = require('../src/app.js');
const LocaleService = require('../src/services/locale-service.js');
const UpdateNoticeService = require('../src/services/update-notice-service.js');
const notice = require('../src/config/update-notice.js');
const topBarLayout = require('../src/ui/top-bar-layout.js');
const { RewardPlatform, allOwnedRewardService } = require('./helpers/reward-fixture.js');
const { fakeApi } = require('./account-bootstrap.test.js');

function fixture(metrics, saved, config) {
  const platform = new RewardPlatform(saved);
  const text = [];
  const panels = [];
  const states = [];
  const icons = [];
  let font = '';
  platform.context = new Proxy({
    globalAlpha: 1,
    fillStyle: '',
    save() { states.push({ font, alpha: this.globalAlpha, fillStyle: this.fillStyle }); },
    restore() {
      const state = states.pop();
      font = state.font;
      this.globalAlpha = state.alpha;
      this.fillStyle = state.fillStyle;
    },
    set font(value) { font = value; },
    measureText(value) {
      const size = Number(/([\d.]+)px/.exec(font)[1]);
      return { width: Array.from(value).reduce((sum, char) =>
        sum + size * (/[^\x00-\x7f]/.test(char) ? 1 : 0.6), 0) };
    },
    fillText(value, x, y) { text.push({ value: String(value), x, y }); },
    fillRect(x, y, w, h) { panels.push({ x, y, w, h, fill: this.fillStyle, alpha: this.globalAlpha }); }
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });
  Object.assign(platform, {
    metrics: metrics || { width: 390, height: 844, safeTop: 44, safeBottom: 810 },
    createAudioContext: () => null, createImage: () => null,
    triggerHaptic() {}, bindPointer: () => () => {},
    bindLifecycle(handlers) { this.lifecycle = handlers; return () => {}; },
    startLoop() {}, stopLoop() {}
  });
  const locale = new LocaleService(platform);
  const updateNotice = new UpdateNoticeService(platform, config || notice);
  const app = new ClearedApp(platform, { locale, updateNotice, rewardUnlocks: allOwnedRewardService() });
  const drawIcon = app.renderer.drawIcon;
  app.renderer.drawIcon = function (type, x, y, size) {
    icons.push({ type, x, y, size });
    return drawIcon.call(this, type, x, y, size);
  };
  return { app, platform, text, panels, icons };
}

function draw(f) {
  f.text.length = 0;
  f.panels.length = 0;
  f.icons.length = 0;
  f.app.tick(Date.now());
}

function pointFor(app, id) {
  const hit = app.renderer.hits.find(item => item.id === id);
  assert(hit, `${id} is reachable`);
  return { id: 1, x: hit.rect.x + hit.rect.w / 2, y: hit.rect.y + hit.rect.h / 2 };
}

function tap(app, id) {
  const point = pointFor(app, id);
  app.onPointerStart(point);
  app.onPointerEnd(point);
}

async function run() {
  const f = fixture();
  f.app.start(); draw(f);
  assert(f.app.buildModel().updateDialog, 'the first launch shows this release');
  assert.deepStrictEqual(f.app.renderer.hits.map(hit => hit.id), ['update:confirm'],
    'the modal removes every underlying home hit');
  assert.strictEqual(f.app.showNextRewardNotice(), false, 'reward notices wait for the update panel');
  assert.strictEqual(f.app.performAction('home:start'), false);
  assert.strictEqual(f.app.scene, 'home');
  assert.strictEqual(f.platform.storage[UpdateNoticeService.STORAGE_KEY], undefined,
    'viewing the notes alone does not acknowledge the release');
  const confirm = pointFor(f.app, 'update:confirm');
  f.app.onPointerStart(confirm);
  f.app.onPointerEnd(Object.assign({}, confirm, { id: 2 }));
  assert(f.app.updateDialog, 'a different finger cannot confirm');
  f.app.onPointerCancel(confirm);
  assert(f.app.updateDialog, 'cancelling the touch does not confirm');
  const outside = Object.assign({}, confirm, { y: confirm.y + 100 });
  f.app.onPointerStart(confirm); f.app.onPointerMove(outside); f.app.onPointerEnd(outside);
  assert(f.app.updateDialog, 'dragging away from confirm leaves the notice unread');
  tap(f.app, 'update:confirm'); draw(f);
  assert.strictEqual(f.app.updateDialog, null);
  assert.deepStrictEqual(f.platform.storage[UpdateNoticeService.STORAGE_KEY],
    { schemaVersion: 1, releaseId: notice.id });
  assert(f.app.renderer.hits.some(hit => hit.id === 'home:start'));
  tap(f.app, 'home:updates'); draw(f);
  assert(f.app.updateDialog, 'the home entry can reopen acknowledged notes');
  tap(f.app, 'update:confirm');
  f.platform.lifecycle.hide(); f.platform.lifecycle.show({});
  assert.strictEqual(f.app.updateDialog, null, 'foregrounding the same session does not reopen the panel');

  const reopened = fixture(undefined, f.platform.storage);
  reopened.app.start(); draw(reopened);
  assert.strictEqual(reopened.app.updateDialog, null, 'the same release stays acknowledged after restart');
  const upgraded = fixture(undefined, f.platform.storage, Object.assign({}, notice, { id: 'next-release' }));
  upgraded.app.start();
  assert(upgraded.app.updateDialog, 'a new release ID shows its notes again');

  for (const failure of ['false', 'throw']) {
    const failed = fixture();
    const previous = JSON.stringify(failed.platform.storage);
    if (failure === 'false') failed.platform.writeFailures[UpdateNoticeService.STORAGE_KEY] = true;
    else {
      const save = failed.platform.setStorage.bind(failed.platform);
      failed.platform.setStorage = (key, value) => {
        if (key === UpdateNoticeService.STORAGE_KEY) throw Error('storage unavailable');
        return save(key, value);
      };
    }
    failed.app.start(); draw(failed); tap(failed.app, 'update:confirm'); draw(failed);
    assert.strictEqual(failed.app.updateDialog, null, 'a failed save must never trap the player');
    assert.strictEqual(failed.app.openUpdateDialog(true), false, 'a failed save still suppresses this session');
    assert.strictEqual(JSON.stringify(failed.platform.storage), previous, 'game saves stay untouched');
    const retry = fixture(undefined, failed.platform.storage);
    retry.app.start();
    assert(retry.app.updateDialog, 'unsaved acknowledgement is retried on the next launch');
  }

  for (const value of [null, 'invalid', { schemaVersion: 2, releaseId: notice.id }]) {
    const invalid = fixture(undefined, { [UpdateNoticeService.STORAGE_KEY]: value });
    invalid.app.start();
    assert(invalid.app.updateDialog, 'an invalid marker cannot hide release notes');
  }
  const unreadable = new RewardPlatform(f.platform.storage);
  unreadable.readFailures[UpdateNoticeService.STORAGE_KEY] = true;
  assert(new UpdateNoticeService(unreadable, notice).shouldShow(), 'read failures allow viewing the notes');
  assert.strictEqual(new UpdateNoticeService({
    getStorage: key => f.platform.getStorage(key), setStorage: () => true
  }, notice).shouldShow(), false, 'older hosts can still restore the confirmed marker');

  for (const locale of ['zh-CN', 'en-US']) {
    for (const metrics of [
      { width: 240, height: 568, safeTop: 54, safeBottom: 548 },
      { width: 280, height: 568, safeTop: 72, safeBottom: 548 },
      { width: 320, height: 568, safeTop: 54, safeBottom: 548 },
      { width: 390, height: 844, safeTop: 44, safeBottom: 810 },
      { width: 844, height: 390, safeTop: 20, safeBottom: 370 }
    ]) {
      const view = fixture(metrics);
      view.app.locale.select(locale);
      view.app.start(); draw(view);
      const colors = view.app.skins.current().colors;
      assert(view.panels.some(rect => rect.x === 0 && rect.y === 0 &&
        rect.w === metrics.width && rect.h === metrics.height &&
        rect.fill === colors.strongPanel && rect.alpha === 1),
      'the notice dims the whole viewport, including both safe areas');
      assert(!view.text.some(item => item.value === view.app.t('home.continue') ||
        item.value === view.app.t('home.corridor')), 'home actions stay visually hidden while reading');
      const button = view.app.renderer.hits[0].rect;
      const panel = view.panels.find(rect => rect.x === 0 && rect.w === metrics.width &&
        rect.y > 0 && rect.h < metrics.height);
      assert(panel, 'the update panel is visible');
      assert(panel.y >= metrics.safeTop && panel.y + panel.h <= metrics.safeBottom);
      assert(button.h >= 44 && button.y >= metrics.safeTop && button.y + button.h <= metrics.safeBottom);
      const title = view.app.t('home.updates');
      const headingIndex = view.text.map(item => item.value).lastIndexOf(title);
      const content = view.text.slice(headingIndex + 2, -1);
      for (const entry of view.app.buildModel().updateDialog.entries) {
        assert(content.some(item => item.value === entry.title));
        assert(content.map(item => item.value.replace(/ /g, '')).join('').includes(entry.body.replace(/ /g, '')),
        'every release note stays visible after wrapping');
      }
      assert(content.every(item => item.y >= panel.y && item.y < button.y - 8),
        `${locale} ${metrics.width}×${metrics.height}: text stays above the confirm button`);
      assert(!view.text.some(item => /^update\./.test(item.value)), 'both locales resolve every update key');
      tap(view.app, 'update:confirm'); draw(view);
      const entry = view.app.renderer.hits.find(hit => hit.id === 'home:updates').rect;
      const status = topBarLayout.homeStatus(metrics);
      assert.strictEqual(entry.w, topBarLayout.CONTROL_SIZE);
      assert.strictEqual(entry.h, topBarLayout.CONTROL_SIZE);
      if (entry.y === status.currency.y) {
        assert(entry.x >= status.avatar.x + status.avatar.w && entry.x + entry.w <= status.currency.x - 6);
        assert.strictEqual(entry.y + entry.h / 2, topBarLayout.centerY(metrics));
      } else {
        assert.strictEqual(entry.x, status.currency.x);
        assert.strictEqual(entry.y, status.currency.y + status.currency.h + 6);
      }
      assert(!view.text.some(item => item.value === title), 'the entry uses a symbol without a text button');
      const icon = view.icons.find(item => item.type === 'info');
      assert(icon, 'the announcement information symbol is drawn');
      assert.deepStrictEqual([icon.x, icon.y], [entry.x + entry.w / 2, entry.y + entry.h / 2]);
      assert.strictEqual(icon.size, topBarLayout.CONTROL_SIZE * 0.48);
      tap(view.app, 'home:updates'); draw(view);
      assert(view.app.updateDialog, 'the icon reopens the notice at every supported viewport');
    }
  }

  const oldWx = global.wx;
  let boot;
  try {
    const native = fakeApi(); global.wx = native;
    boot = require('../src/bootstrap.js').start();
    boot.tick(Date.now());
    assert(boot.buildModel().updateDialog, 'the real WeChat composition enables release notes');
    assert.strictEqual(boot.renderer.hits.length, 1);
    tap(boot, 'update:confirm'); boot.tick(Date.now());
    tap(boot, 'home:updates');
    assert(boot.buildModel().updateDialog);
  } finally {
    if (boot) boot.dispose();
    global.wx = oldWx;
  }
}

module.exports = run;
