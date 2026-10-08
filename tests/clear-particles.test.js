'use strict';

const assert = require('assert');
const BoardRenderer = require('../src/ui/board/board-renderer.js');
const particles = require('../src/ui/board/clear-particles.js');
const effects = require('../src/effects/index.js').slice(2);
const classic = require('../src/skins/classic.js');

function context(gradients) {
  const calls = [];
  const stack = [];
  const ctx = { calls, globalAlpha: 1, fillStyle: '#123', strokeStyle: '#456',
    lineWidth: 2, globalCompositeOperation: 'source-over' };
  ctx.save = () => stack.push({ globalAlpha: ctx.globalAlpha, fillStyle: ctx.fillStyle,
    strokeStyle: ctx.strokeStyle, lineWidth: ctx.lineWidth,
    globalCompositeOperation: ctx.globalCompositeOperation });
  ctx.restore = () => Object.assign(ctx, stack.pop());
  if (gradients !== false) ctx.createLinearGradient = (...args) => {
    const gradient = { stops: [], addColorStop(offset, color) { this.stops.push([offset, color]); } };
    calls.push({ op: 'createLinearGradient', args, alpha: ctx.globalAlpha });
    return gradient;
  };
  ['beginPath', 'moveTo', 'lineTo', 'closePath', 'arc', 'quadraticCurveTo', 'fill', 'stroke'].forEach(op => {
    ctx[op] = (...args) => calls.push({ op, args, alpha: ctx.globalAlpha,
      paint: op === 'fill' ? ctx.fillStyle : op === 'stroke' ? ctx.strokeStyle : undefined,
      composite: ctx.globalCompositeOperation });
  });
  return ctx;
}

function run() {
  const ctx = context();
  const tileCalls = [];
  const renderer = new BoardRenderer({
    context: ctx, skin: classic,
    drawTile: (...args) => tileCalls.push(args)
  });
  const layout = { x: 10, y: 20, cols: 8, rows: 10, cell: 30 };
  const draw = (effect, extra, elapsed) => {
    ctx.calls.length = 0;
    tileCalls.length = 0;
    renderer.drawClearAnimation(Object.assign({
      lineIndex: 0, cells: [0, 1, 2], startedAt: 1000,
      type: effect.type, durationMs: effect.durationMs, params: effect.params
    }, extra), ['#f0c'], 1000 + (elapsed === undefined ? effect.durationMs * 0.5 : elapsed),
    2, layout, new Set([2]));
  };
  const paletteSignatures = new Set();
  effects.forEach(effect => {
    draw(effect);
    assert.strictEqual(tileCalls.length, 2, 'Portal cells never get a shrinking tile');
    assert(ctx.calls.length > 0, `${effect.id} must draw particles, not just fade tiles`);
    assert(tileCalls.every(call => call[4].color === '#f0c'), 'tiles retain their line color');
    const paints = ctx.calls.filter(call => call.paint && call.paint.stops).map(call => call.paint);
    const colors = new Set(paints.flatMap(paint => paint.stops.map(stop => stop[1])));
    assert(colors.size >= 4, 'one line must emit several colors, including a highlight');
    assert(paints.every(paint => paint.stops.length === 3), 'shapes have a highlight-to-color gradient');
    assert(ctx.calls.every(call => call.composite === 'source-over' || !call.composite),
      'colors remain visible on bright backgrounds instead of additive white');
    paletteSignatures.add(Array.from(colors).sort().join(','));
    if (effect.id === 'bubbles') assert(ctx.calls.some(call => call.op === 'arc'));
    if (effect.id === 'petals') assert(ctx.calls.some(call => call.op === 'quadraticCurveTo'));
    if (effect.id === 'starburst' || effect.id === 'shatter') {
      assert(ctx.calls.some(call => call.op === 'lineTo'));
    }
    ctx.calls.forEach(call => {
      assert(call.args.every(value => typeof value !== 'number' || Number.isFinite(value)));
      assert(call.alpha >= 0 && call.alpha <= 1);
    });
    assert.strictEqual(ctx.globalAlpha, 1, 'particle drawing restores Canvas state');
    assert.strictEqual(ctx.fillStyle, '#123');
    assert.strictEqual(ctx.strokeStyle, '#456');
    assert.strictEqual(ctx.lineWidth, 2);
    assert.strictEqual(ctx.globalCompositeOperation, 'source-over');
    const firstFrame = JSON.stringify(ctx.calls);
    draw(effect);
    assert.strictEqual(JSON.stringify(ctx.calls), firstFrame, 'redrawing the same time is deterministic');

    draw(effect, { cells: [-1, 1.5, 80, 2] });
    assert.strictEqual(tileCalls.length, 0);
    assert.strictEqual(ctx.calls.length, 0, 'invalid and Portal cells emit no particles');

    draw(effect, { cells: Array.from({ length: 80 }, (unused, index) => index) }, effect.durationMs - 0.1);
    assert(tileCalls.every(call => call[4].alpha < 0.002),
      'the whole long path finishes within its immutable duration');
    draw(effect, null, effect.durationMs);
    assert.strictEqual(tileCalls.length, 0);
    assert.strictEqual(ctx.calls.length, 0, 'no particles remain at or after the end');

    // Still-frozen cells keep the separate ice-breaking overlay, without a
    // disappearing floor tile or cosmetic particles over the retained floor.
    draw(effect, { cells: [0], iceBrokenCells: [0] });
    assert.strictEqual(tileCalls.length, 0);
    assert(ctx.calls.some(call => call.op === 'stroke'), 'ice overlay remains visible');

    const fallback = context(false);
    particles.draw(fallback, effect.type, 15, 15, 30, 0.5, 0);
    const solidColors = new Set(fallback.calls.filter(call => call.paint).map(call => call.paint));
    assert(solidColors.size >= 3, 'without gradients the effect still has several colors');
    assert.strictEqual(fallback.globalAlpha, 1);
    fallback.createLinearGradient = () => undefined;
    assert.doesNotThrow(() => particles.draw(fallback, effect.type, 15, 15, 30, 0.5, 0),
      'an unavailable gradient falls back to the same solid palette');
  });
  assert.strictEqual(paletteSignatures.size, effects.length, 'each effect has its own color identity');
  draw({ type: 'unknown', durationMs: 300, params: {} });
  assert.strictEqual(tileCalls.length, 2);
  assert.strictEqual(ctx.calls.length, 0, 'unknown types fall back to ordinary fade');
  ['none', 'fade', '__proto__'].forEach(type => assert.strictEqual(particles.supports(type), false));
  ctx.calls.length = 0;
  [NaN, Infinity, -1, 0, 1].forEach(progress => {
    particles.draw(ctx, 'starburst', 0, 0, 30, progress, 0);
  });
  assert.strictEqual(ctx.calls.length, 0);
}

module.exports = run;
