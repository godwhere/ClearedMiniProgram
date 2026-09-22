'use strict';

const assert = require('assert');
const CanvasRenderer = require('../src/ui/canvas-renderer.js');
const classic = require('../src/skins/classic.js');

function context() {
  const calls = [];
  const ctx = { calls, fillStyle: '', globalAlpha: 1 };
  ['save', 'restore', 'clearRect', 'fillRect', 'beginPath', 'moveTo', 'lineTo',
    'quadraticCurveTo', 'closePath', 'fill', 'stroke', 'arc', 'translate',
    'drawImage', 'fillText', 'strokeRect', 'scale'].forEach(method => {
    ctx[method] = function () { calls.push({ op: method, args: Array.prototype.slice.call(arguments) }); };
  });
  return ctx;
}

function renderer(width) {
  const ctx = context();
  const platform = {
    context: ctx,
    metrics: { width, height: 720, safeTop: 32, safeBottom: 700 },
    createImage() { return null; }
  };
  const skins = { current: () => classic, get: id => id === 'classic' ? classic : null };
  return { renderer: new CanvasRenderer(platform, skins), ctx };
}

function homeModel(balance) {
  return {
    scene: 'home', soundEnabled: true, pressedId: null, accountProfile: null,
    currency: { available: balance !== null, balance },
    stamina: { enabled: true, balance: 5, naturalCap: 5, recovering: false },
    completedCount: 0, totalLevels: 92, dailyAvailable: true, dailyEntryAvailable: true,
    dailyEntriesRemaining: 3, dailyEntryLimit: 3, homeMigration: true
  };
}

function run() {
  const bareCurrency = renderer(390);
  let currencyPanels = 0;
  let currencyFontSize = null;
  bareCurrency.renderer.roundedRect = () => { currencyPanels++; };
  const drawText = bareCurrency.renderer.text.bind(bareCurrency.renderer);
  bareCurrency.renderer.text = (value, x, y, size, options) => {
    currencyFontSize = size;
    drawText(value, x, y, size, options);
  };
  bareCurrency.renderer.drawCurrency({ available: true, balance: 2400 }, { x: 100, y: 40, w: 78, h: 44 });
  assert.strictEqual(currencyPanels, 0, 'home currency has no gray backing panel');
  assert.strictEqual(currencyFontSize, 17, 'currency amount matches the compact stamina font size');
  assert(bareCurrency.ctx.calls.some(call => call.op === 'fillText' && call.args[0] === '2400'));

  const derivedCurrency = renderer(390);
  derivedCurrency.renderer.drawCurrency({ available: true, balance: 2400,
    pendingRewardAmount: 100, displayBalance: 2500 }, { x: 100, y: 40, w: 78, h: 44 });
  assert(derivedCurrency.ctx.calls.some(call => call.op === 'fillText' && call.args[0] === '2500'),
    'home currency prefers the derived display balance');
  const fallbackCurrency = renderer(390);
  fallbackCurrency.renderer.drawCurrency({ available: true, balance: 2400,
    displayBalance: -1 }, { x: 100, y: 40, w: 78, h: 44 });
  assert(fallbackCurrency.ctx.calls.some(call => call.op === 'fillText' && call.args[0] === '2400'),
    'invalid or absent derived values fall back to the confirmed balance');

  [[320, 0, '0'], [375, 9999, '9999'], [390, 10000, '1万'], [390, 100000, '10万']].forEach(entry => {
    const test = renderer(entry[0]);
    test.renderer.render(homeModel(entry[1]), 1);
    const sound = test.renderer.hits.find(hit => hit.id === 'home:sound');
    const stamina = test.renderer.hits.find(hit => hit.id === 'home:stamina');
    const currencyText = test.ctx.calls.find(call => call.op === 'fillText' && call.args[0] === entry[2]);
    assert(sound && stamina && currencyText, `${entry[0]}/${entry[1]} exposes the top-row controls`);
    assert(sound.rect.x + sound.rect.w < currencyText.args[1]);
    assert(currencyText.args[1] < stamina.rect.x + stamina.rect.w);
    assert(sound.rect.x > 62, 'narrow layout clears the avatar region');
  });

  const appHome = renderer(390);
  const appHomeModel = Object.assign(homeModel(0), {
    dailyExtraEntryAvailable: true,
    productCapabilities: {
      dailyEnabled: false,
      adsEnabled: false,
      rewardedShareEnabled: false,
      resultShareEnabled: false,
      hintMode: 'free'
    }
  });
  appHome.renderer.render(appHomeModel, 1);
  assert(!appHome.renderer.hits.some(hit =>
    hit.id === 'home:dailyChallenge' || hit.id === 'daily:extraEntry'));
  const appGallery = appHome.renderer.hits.find(hit => hit.id === 'home:corridor');
  const appStart = appHome.renderer.hits.find(hit => hit.id === 'home:start');
  assert(appGallery && appStart);
  assert.strictEqual(appGallery.rect.w, appStart.rect.w,
    'removing the daily entry leaves the existing gallery action as the full first row');

  const gallery = renderer(390);
  const model = {
    scene: 'themes', soundEnabled: true, pressedId: null, currentThemeId: 'classic',
    themePageCount: 1, themePageIndex: 0, backAction: 'themes:home',
    themes: [{ id: 'classic', name: '经典', reward: { owned: true } }, {
      id: 'gem', name: '宝石', preview: 'assets/theme-previews/gem.png',
      reward: { owned: false, conditionType: 'ordinary_level', displayLevel: 5 }
    }]
  };
  const before = JSON.stringify(model);
  gallery.renderer.render(model, 1);
  assert(gallery.ctx.calls.some(call => call.op === 'fillText' && call.args[0] === '通关第 5 关解锁'));
  assert.strictEqual(JSON.stringify(model), before, 'gallery drawing remains read-only');

  const dialog = Object.assign({}, model, {
    rewardDialog: {
      dialogId: 1, rewardId: 'theme:gem', mode: 'unlocked', state: 'idle',
      title: '宝石', message: '已永久解锁', primaryAction: 'reward:apply',
      primaryLabel: '立即应用', primaryEnabled: true,
      secondaryAction: 'reward:later', secondaryLabel: '稍后再说'
    }
  });
  gallery.renderer.render(dialog, 2);
  assert.deepStrictEqual(gallery.renderer.hits.map(hit => hit.id).sort(), ['reward:apply', 'reward:later']);
  assert.strictEqual(JSON.stringify(dialog), JSON.stringify(Object.assign({}, model, { rewardDialog: dialog.rewardDialog })),
    'dialog drawing does not write reward state');

  const disabledExternal = Object.assign({}, model, {
    productCapabilities: { adsEnabled: false, rewardedShareEnabled: false },
    rewardDialog: {
      dialogId: 2, rewardId: 'theme:festival', mode: 'condition', state: 'idle',
      conditionType: 'share', title: '节日', message: '不可用',
      primaryAction: 'reward:unlock', primaryLabel: '分享', primaryEnabled: true,
      secondaryAction: 'reward:close', secondaryLabel: '关闭'
    }
  });
  gallery.renderer.render(disabledExternal, 3);
  assert.deepStrictEqual(gallery.renderer.hits.map(hit => hit.id), ['reward:close'],
    'a disabled external reward cannot regain an actionable hit through a stale ViewModel');
}

module.exports = run;
