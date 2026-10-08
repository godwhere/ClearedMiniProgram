'use strict';

const TYPES = ['starburst', 'bubbles', 'petals', 'shatter'];
const PALETTES = [
  ['#ffd166', '#ff97cf', '#91e9ff', '#c4afff'],
  ['#ff9bc8', '#82dfef', '#c3a7ff', '#a7e8a0', '#ffe49a'],
  ['#f785ba', '#cf9afa', '#ffb3c9', '#ad91e5'],
  ['#68d7ff', '#91baff', '#98f0ef', '#bae7ff']
];
const HIGHLIGHTS = ['#fff6d9', '#ffffff', '#ffe8f4', '#f1fcff'];

function supports(type) {
  return TYPES.indexOf(type) >= 0;
}

// Four analytic shapes per cell at most. No random state, timers, images or
// particle objects; the gallery uses the same drawing at a fixed progress.
// Each shape has at most one small gradient, with solid-color fallback.
function draw(ctx, type, x, y, size, progress, seed) {
  if (!ctx || !supports(type) || !Number.isFinite(progress) ||
      progress <= 0 || progress >= 1 || !Number.isFinite(x) || !Number.isFinite(y) ||
      !Number.isFinite(size) || size <= 0) return;
  const t = progress;
  const travel = 1 - Math.pow(1 - t, 3);
  const count = type === 'bubbles' ? 3 : 4;
  const palette = PALETTES[TYPES.indexOf(type)];
  const highlight = HIGHLIGHTS[TYPES.indexOf(type)];
  const cellSeed = Number.isFinite(seed) ? Math.abs(Math.trunc(seed)) : 0;
  ctx.save();
  // Source-over preserves the palette on bright chapter/gallery backgrounds.
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = Math.sin(Math.PI * t) * 0.88;
  ctx.lineWidth = Math.max(1, size * 0.025);
  for (let part = 0; part < count; part++) {
    const angle = (part / count + ((Number.isFinite(seed) ? seed : 0) % 7) * 0.137) * Math.PI * 2;
    const distance = size * (0.14 + travel * (0.32 + part * 0.035));
    let px = x + Math.cos(angle) * distance;
    let py = y + Math.sin(angle) * distance;
    const radius = size * ((type === 'bubbles' ? 0.07 : 0.12) +
      (part % 2) * 0.025) * (1 - t * 0.45);
    if (type === 'bubbles') py = y - size * (0.05 + travel * (0.32 + part * 0.09));
    else if (type === 'petals') py += size * t * t * 0.45;
    const colorIndex = (cellSeed + part) % palette.length;
    let paint = palette[colorIndex];
    if (typeof ctx.createLinearGradient === 'function') {
      const gradient = ctx.createLinearGradient(px - radius, py - radius,
        px + radius, py + radius);
      if (gradient && typeof gradient.addColorStop === 'function') {
        gradient.addColorStop(0, highlight);
        gradient.addColorStop(0.38, paint);
        gradient.addColorStop(1, palette[(colorIndex + 1) % palette.length]);
        paint = gradient;
      }
    }
    ctx.fillStyle = paint;
    ctx.strokeStyle = paint;
    ctx.beginPath();
    if (type === 'bubbles') {
      ctx.arc(px, py, radius * (1 + t), 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = highlight;
      ctx.beginPath();
      ctx.arc(px - radius * 0.2, py - radius * 0.2, radius * 0.45,
        Math.PI, Math.PI * 1.6);
      ctx.stroke();
    } else if (type === 'petals') {
      const dx = Math.cos(angle + t * 2) * radius;
      const dy = Math.sin(angle + t * 2) * radius;
      ctx.moveTo(px - dx, py - dy);
      ctx.quadraticCurveTo(px - dy * 1.5, py + dx * 1.5, px + dx, py + dy);
      ctx.quadraticCurveTo(px + dy * 0.5, py - dx * 0.5, px - dx, py - dy);
      ctx.fill();
    } else {
      const points = type === 'starburst' ? 8 : 4;
      for (let point = 0; point < points; point++) {
        const rotation = angle + t * (type === 'shatter' ? 3 : 0.7) +
          point * Math.PI * 2 / points;
        const r = type === 'starburst' && point % 2 ? radius * 0.28 : radius;
        const dx = Math.cos(rotation) * r;
        const dy = Math.sin(rotation) * r * (type === 'shatter' ? 1.65 : 1);
        if (point === 0) ctx.moveTo(px + dx, py + dy);
        else ctx.lineTo(px + dx, py + dy);
      }
      ctx.closePath();
      ctx.fill();
      if (type === 'shatter') {
        ctx.strokeStyle = highlight;
        ctx.lineWidth = Math.max(0.6, size * 0.012);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

module.exports = { supports, draw };
