'use strict';

const assert = require('assert');
const CanvasRenderer = require('../src/ui/canvas-renderer.js');
const classic = require('../src/skins/classic.js');

function createRenderer(width, measurement) {
  const context = {};
  ['save', 'restore', 'beginPath', 'moveTo', 'lineTo', 'quadraticCurveTo',
    'closePath', 'fill', 'stroke'].forEach(name => { context[name] = function () {}; });
  if (measurement === 'native') {
    context.measureText = function (value) {
      const size = Number(this.font.match(/([\d.]+)px/)[1]);
      return { width: String(value).length * size * 0.9 };
    };
  } else if (measurement === 'throws') {
    context.measureText = function () { throw new Error('measurement unavailable'); };
  }
  const platform = {
    context,
    metrics: { width, height: 844, safeTop: 44, safeBottom: 810 },
    createImage(source, callback) { callback(null, { source }); return {}; }
  };
  const renderer = new CanvasRenderer(platform, { current() { return classic; } });
  const icons = [];
  const labels = [];
  renderer.drawIcon = (type, x, y, size) => { icons.push({ type, x, y, size }); };
  renderer.text = (value, x, y, size, options) => { labels.push({ value, x, y, size, options }); };
  return { renderer, icons, labels };
}

function assertGroupInsideButton(fixture, action, label, measurement) {
  const hit = fixture.renderer.hits.find(item => item.id === action);
  const icon = fixture.icons.find(item => item.type === 'hint');
  const text = fixture.labels.find(item => item.value === label);
  assert(hit && icon && text, `${action} content and hit must exist`);
  const measuredWidth = label.length * text.size * (measurement === 'native' ? 0.9 : 1);
  const textWidth = Math.min(measuredWidth, text.options.maxWidth || measuredWidth);
  const iconLeft = icon.x - icon.size / 2;
  const iconRight = icon.x + icon.size / 2;
  const textLeft = text.x - textWidth / 2;
  const textRight = text.x + textWidth / 2;
  assert(textLeft - iconRight >= 6,
    `${action} ${label} must leave a visible icon/text gap, got ${textLeft - iconRight}`);
  assert(Math.abs((iconLeft + textRight) / 2 - (hit.rect.x + hit.rect.w / 2)) < 0.001,
    `${action} icon and label must be centered together`);
  assert(iconLeft >= hit.rect.x + 12 - 0.001);
  assert(textRight <= hit.rect.x + hit.rect.w - 12 + 0.001);
  assert.strictEqual(icon.y, hit.rect.y + hit.rect.h / 2);
  assert.strictEqual(text.y, icon.y);
  assert(text.size > 0 && text.size <= 17);
  return hit.rect;
}

function run() {
  const share = createRenderer(320, 'native');
  share.renderer.ctx.fillRect = function () {};
  share.renderer.drawResult({ result: { elapsedMs: 1, bestMs: 1 }, resultVisibleAt: 0, shareAvailable: true }, 1);
  assert(share.renderer.hits.some(hit => hit.id === 'result:share'));
  share.renderer.clearInteractionHits();
  share.renderer.drawResult({ result: { elapsedMs: 1 }, resultVisibleAt: 0, shareAvailable: true, sharePending: true }, 1);
  assert(!share.renderer.hits.some(hit => hit.id === 'result:share'));
  share.renderer.clearInteractionHits();
  share.renderer.drawDailyResult({ result: {}, dailyResultVisibleAt: 0, shareAvailable: true }, 1);
  assert(share.renderer.hits.some(hit => hit.id === 'dailyResult:share'));
  share.renderer.clearInteractionHits();
  share.renderer.drawDailyResult({ result: {}, dailyResultVisibleAt: 0, dailyExtraEntryAvailable: true }, 1);
  assert(share.renderer.hits.some(hit => hit.id === 'daily:extraEntry'));
  assert(!share.renderer.hits.some(hit => /revive/.test(hit.id)));
  share.renderer.clearInteractionHits();
  share.renderer.drawDailyResult({ result: {}, dailyResultVisibleAt: 0, dailyExtraEntryAvailable: true, dailyExtraEntryPending: true }, 1);
  assert(!share.renderer.hits.some(hit => hit.id === 'daily:extraEntry'));
  share.renderer.clearInteractionHits();
  share.renderer.drawResult({ result: { elapsedMs: 1, bestMs: 1 }, resultVisibleAt: 0,
    shareAvailable: true, productCapabilities: { resultShareEnabled: false } }, 1);
  assert(!share.renderer.hits.some(hit => hit.id === 'result:share'));
  share.renderer.clearInteractionHits();
  share.renderer.drawDailyResult({ result: {}, dailyResultVisibleAt: 0,
    shareAvailable: true, dailyExtraEntryAvailable: true,
    productCapabilities: { dailyEnabled: false, adsEnabled: false, resultShareEnabled: false } }, 1);
  assert(!share.renderer.hits.some(hit =>
    hit.id === 'dailyResult:share' || hit.id === 'daily:extraEntry'));
  [280, 320, 390].forEach(width => {
    ['native', 'missing', 'throws'].forEach(measurement => {
      ['play', 'daily'].forEach(scene => {
        let normalRect;
        ['提示', '免费提示', '分享解锁', '广告解锁', '查看提示', '重试广告', '重试保存', '分享不可用', '提示不可用', '处理中', '隐藏提示'].forEach(label => {
          const previewActive = label === '隐藏提示';
          const fixture = createRenderer(width, measurement);
          const model = {
            hintAvailable: true,
            hintLabel: label,
            canUndo: true,
            hintPreview: previewActive ? { until: 2000 } : null
          };
          const method = scene === 'play' ? 'drawPlayActions' : 'drawDailyActions';
          fixture.renderer[method](model, 600, 1000);
          const rect = assertGroupInsideButton(fixture, `${scene}:hint`,
            label, measurement);
          if (!normalRect) normalRect = rect;
          else assert.deepStrictEqual(rect, normalRect,
            'switching the label must not move or resize the touch target');
        });
      });
    });
  });
}

module.exports = run;
