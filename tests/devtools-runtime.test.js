'use strict';

const assert = require('assert');
const WechatPlatform = require('../src/platform/wechat.js');
const ProgressionService = require('../src/services/progression-service.js');
const bootstrap = require('../src/bootstrap.js');

function context() {
  const value = {};
  ['save', 'restore', 'clearRect', 'fillRect', 'scale'].forEach(name => {
    value[name] = function () {};
  });
  return value;
}

function api(platform, withSystemInfo) {
  const canvas = {
    width: 0,
    height: 0,
    getContext() { return context(); }
  };
  const result = {
    createCanvas() { return canvas; },
    getWindowInfo() {
      return {
        windowWidth: 390,
        windowHeight: 844,
        safeArea: { top: 0, bottom: 844 },
        platform
      };
    }
  };
  if (withSystemInfo) result.getSystemInfoSync = () => ({ platform });
  return result;
}

function bootstrapApi(platform) {
  const storage = Object.create(null);
  const drawContext = context();
  drawContext.drawImage = function () {};
  drawContext.beginPath = function () {};
  drawContext.moveTo = function () {};
  drawContext.lineTo = function () {};
  drawContext.quadraticCurveTo = function () {};
  drawContext.closePath = function () {};
  drawContext.fill = function () {};
  drawContext.stroke = function () {};
  drawContext.arc = function () {};
  drawContext.translate = function () {};
  drawContext.fillText = function () {};
  drawContext.clearRect = function () {};
  drawContext.fillRect = function () {};
  drawContext.save = function () {};
  drawContext.restore = function () {};
  drawContext.scale = function () {};
  let frameId = 0;
  const canvas = {
    width: 0,
    height: 0,
    getContext() { return drawContext; },
    createImage() {
      const image = { width: 96, height: 96 };
      Object.defineProperty(image, 'src', {
        set() { if (image.onload) image.onload(); }
      });
      return image;
    },
    requestAnimationFrame() { return ++frameId; },
    cancelAnimationFrame() {}
  };
  const result = {
    createCanvas() { return canvas; },
    getSystemInfoSync() {
      return {
        windowWidth: 390,
        windowHeight: 844,
        pixelRatio: 2,
        safeArea: { top: 0, bottom: 844 },
        platform
      };
    },
    getWindowInfo() {
      return {
        windowWidth: 390,
        windowHeight: 844,
        safeArea: { top: 0, bottom: 844 },
        platform
      };
    },
    getMenuButtonBoundingClientRect() { return { bottom: 40 }; },
    getStorageSync(key) { return storage[key] || null; },
    setStorageSync(key, value) { storage[key] = JSON.parse(JSON.stringify(value)); },
    onTouchStart() {},
    onTouchMove() {},
    onTouchEnd() {},
    onTouchCancel() {},
    onHide() {},
    onShow() {},
    onWindowResize() {},
    onAudioInterruptionBegin() {},
    onAudioInterruptionEnd() {},
    vibrateShort() {}
  };
  return result;
}

function run() {
  assert.strictEqual(new WechatPlatform(api('devtools', true)).isDevTools(), true);
  assert.strictEqual(new WechatPlatform(api('DEVTOOLS', true)).isDevTools(), true);
  assert.strictEqual(new WechatPlatform(api('ios', true)).isDevTools(), false);
  // Older/lightweight hosts can omit getSystemInfoSync; the adapter safely
  // falls back to its window-info provider.
  assert.strictEqual(new WechatPlatform(api('devtools', false)).isDevTools(), true);
  const mixedApi = api('devtools', true);
  mixedApi.getSystemInfoSync = () => ({ windowWidth: 390 });
  assert.strictEqual(new WechatPlatform(mixedApi).isDevTools(), true);

  const progress = {
    isCompleted() { return false; }
  };
  const sets = [{ Games: [{}, {}] }, { Games: [{}] }];
  const devtoolsRun = new ProgressionService(progress, sets, {
    unlockAcrossSets: true,
    unlockAllLevelsInDevTools: true
  });
  assert.strictEqual(devtoolsRun.isUnlocked(0, 0), true);
  assert.strictEqual(devtoolsRun.isUnlocked(0, 1), true);
  assert.strictEqual(devtoolsRun.isUnlocked(1, 0), true);

  const releaseRun = new ProgressionService(progress, sets, {
    unlockAcrossSets: true,
    unlockAllLevelsInDevTools: false
  });
  assert.strictEqual(releaseRun.isUnlocked(0, 0), true);
  assert.strictEqual(releaseRun.isUnlocked(0, 1), false);
  assert.strictEqual(releaseRun.isUnlocked(1, 0), false);

  // Exercise the actual bootstrap path: the same source package unlocks only
  // when the host reports the Developer Tools platform.
  const previousWx = global.wx;
  try {
    global.wx = bootstrapApi('devtools');
    const devApp = bootstrap.start();
    devApp.platform.stopLoop();
    assert.strictEqual(devApp.progression.config.unlockAllLevelsInDevTools, true);
    assert.strictEqual(devApp.openLevel(0, 1), true);

    global.wx = bootstrapApi('ios');
    const releaseApp = bootstrap.start();
    releaseApp.platform.stopLoop();
    assert.strictEqual(releaseApp.progression.config.unlockAllLevelsInDevTools, false);
    assert.strictEqual(releaseApp.openLevel(0, 1), false);
  } finally {
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
  }
}

module.exports = run;
