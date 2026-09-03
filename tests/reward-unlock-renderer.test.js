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
}

module.exports = run;
