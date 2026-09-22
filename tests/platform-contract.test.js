'use strict';

const assert = require('assert');
const WechatPlatform = require('../src/platform/wechat.js');

function fakeApi(options) {
  const opts = options || {};
  const listeners = Object.create(null);
  const frames = new Map();
  const contextCalls = [];
  let frameSequence = 0;
  const info = Object.assign({
    windowWidth: 390,
    windowHeight: 844,
    pixelRatio: 3,
    safeArea: { top: 20, bottom: 820 }
  }, opts.info || {});
  const context = new Proxy({}, {
    get(target, key) {
      if (key === 'scale') return (x, y) => contextCalls.push(['scale', x, y]);
      return target[key] || function () {};
    }
  });
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    createImage: () => ({}),
    requestAnimationFrame(callback) {
      const id = ++frameSequence;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) { frames.delete(id); }
  };
  const api = {
    info,
    canvas,
    contextCalls,
    createCanvas: () => canvas,
    getWindowInfo: () => info,
    getMenuButtonBoundingClientRect: () => ({ bottom: 44 }),
    emit(name, value) {
      (listeners[name] || []).slice().forEach(callback => callback(value || {}));
    },
    listenerCount(name) { return (listeners[name] || []).length; },
    fireFrame(timestamp) {
      const first = frames.entries().next().value;
      if (!first) return false;
      frames.delete(first[0]);
      first[1](timestamp);
      return true;
    }
  };
  const names = [
    'TouchStart', 'TouchMove', 'TouchEnd', 'TouchCancel',
    'Hide', 'Show', 'WindowResize', 'AudioInterruptionBegin', 'AudioInterruptionEnd'
  ];
  names.forEach(name => {
    const key = name.charAt(0).toLowerCase() + name.slice(1);
    api[`on${name}`] = callback => {
      if (!listeners[key]) listeners[key] = [];
      listeners[key].push(callback);
    };
    if (opts.withOff !== false) {
      api[`off${name}`] = callback => {
        listeners[key] = (listeners[key] || []).filter(item => item !== callback);
      };
    }
  });
  return api;
}

function run() {
  const api = fakeApi();
  const platform = new WechatPlatform(api);
  assert.deepStrictEqual(platform.metrics, {
    width: 390,
    height: 844,
    dpr: 2,
    safeTop: 48,
    safeBottom: 820
  });
  assert.strictEqual(api.canvas.width, 780);
  assert.strictEqual(api.canvas.height, 1688);
  assert.deepStrictEqual(api.contextCalls, [['scale', 2, 2]]);

  const points = [];
  const unbindPointer = platform.bindPointer({
    start: point => points.push(['start', point]),
    move: point => points.push(['move', point]),
    end: point => points.push(['end', point]),
    cancel: point => points.push(['cancel', point])
  });
  api.emit('touchStart', { touches: [
    { clientX: 10, clientY: 20, identifier: 7 },
    { x: 30, y: 40 }
  ] });
  api.emit('touchMove', { touches: [{ clientX: 11, clientY: 21, identifier: 7 }] });
  api.emit('touchEnd', { changedTouches: [{ clientX: 12, clientY: 22, identifier: 7 }] });
  api.emit('touchCancel', { changedTouches: [] });
  assert.deepStrictEqual(points, [
    ['start', { x: 10, y: 20, id: 7 }],
    ['start', { x: 30, y: 40, id: 0 }],
    ['move', { x: 11, y: 21, id: 7 }],
    ['end', { x: 12, y: 22, id: 7 }],
    ['cancel', null]
  ]);
  unbindPointer();
  unbindPointer();
  assert.strictEqual(api.listenerCount('touchStart'), 0);
  api.emit('touchStart', { touches: [{ clientX: 99, clientY: 99, identifier: 1 }] });
  assert.strictEqual(points.length, 5);

  const frameTimes = [];
  const originalNow = Date.now;
  try {
    Date.now = () => 987654321;
    platform.startLoop(now => frameTimes.push(now));
    assert.strictEqual(api.fireFrame(12.5), true);
  } finally {
    Date.now = originalNow;
  }
  assert.deepStrictEqual(frameTimes, [987654321],
    'the runtime receives absolute wall-clock milliseconds, not the RAF-relative timestamp');

  const lifecycle = [];
  const unbindLifecycle = platform.bindLifecycle({
    hide: () => lifecycle.push('hide'),
    show: options => lifecycle.push(['show', options]),
    resize: metrics => lifecycle.push(['resize', Object.assign({}, metrics)]),
    audioInterruptBegin: () => lifecycle.push('audio-begin'),
    audioInterruptEnd: () => lifecycle.push('audio-end')
  });
  api.emit('hide');
  assert.strictEqual(platform.active, false);
  assert.strictEqual(platform.frameId, null);
  Object.assign(api.info, {
    windowWidth: 430,
    windowHeight: 900,
    pixelRatio: 1,
    safeArea: { top: 30, bottom: 880 }
  });
  api.emit('show', { scene: 1007 });
  assert.strictEqual(platform.active, true);
  assert.deepStrictEqual(platform.metrics, {
    width: 430,
    height: 900,
    dpr: 1,
    safeTop: 48,
    safeBottom: 880
  });
  api.emit('windowResize');
  api.emit('audioInterruptionBegin');
  api.emit('audioInterruptionEnd');
  assert.deepStrictEqual(lifecycle, [
    'hide',
    ['show', { scene: 1007 }],
    ['resize', { width: 430, height: 900, dpr: 1, safeTop: 48, safeBottom: 880 }],
    'audio-begin',
    'audio-end'
  ]);
  unbindLifecycle();
  unbindLifecycle();
  for (const name of ['hide', 'show', 'windowResize', 'audioInterruptionBegin', 'audioInterruptionEnd']) {
    assert.strictEqual(api.listenerCount(name), 0);
    api.emit(name);
  }
  assert.strictEqual(lifecycle.length, 5);

  const legacyApi = fakeApi({ withOff: false });
  const legacy = new WechatPlatform(legacyApi);
  let staleShows = 0;
  let currentShows = 0;
  const unbindStale = legacy.bindLifecycle({ show: () => { staleShows++; } });
  unbindStale();
  const unbindCurrent = legacy.bindLifecycle({ show: () => { currentShows++; } });
  legacyApi.emit('show');
  assert.strictEqual(staleShows, 0);
  assert.strictEqual(currentShows, 1);
  unbindCurrent();
  legacyApi.emit('show');
  assert.strictEqual(currentShows, 1,
    'a lightweight host without off* APIs keeps old native callbacks inert after unbind');

  let staleTouches = 0;
  const unbindLegacyPointer = legacy.bindPointer({ start: () => { staleTouches++; } });
  unbindLegacyPointer();
  legacyApi.emit('touchStart', { touches: [{ clientX: 1, clientY: 2, identifier: 3 }] });
  assert.strictEqual(staleTouches, 0);
}

module.exports = run;
