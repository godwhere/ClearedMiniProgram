'use strict';

// Small, deterministic Canvas overlay: no texture downloads and no rule state.
function drawIce(ctx, x, y, size, options) {
  if (!ctx || size <= 0) return;
  const opts = options || {};
  const progress = Number(opts.breakProgress) || 0;
  ctx.save();
  ctx.globalAlpha = opts.alpha === undefined ? 1 : opts.alpha;
  ctx.lineWidth = Math.max(1, size * 0.025);
  ctx.strokeStyle = 'rgba(233,252,255,0.95)';
  ctx.fillStyle = opts.selected ? 'rgba(180,231,249,0.12)' : 'rgba(170,225,248,0.38)';
  const polygon = (points, dx, dy) => {
    ctx.beginPath();
    points.forEach((point, index) => {
      const px = x + (point[0] + (dx || 0)) * size;
      const py = y + (point[1] + (dy || 0)) * size;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  };
  if (progress > 0) {
    // Three short-lived shards expose the ordinary floor underneath.
    polygon([[0.06, 0.1], [0.48, 0.12], [0.43, 0.52], [0.08, 0.72]], -progress * 0.1, -progress * 0.1);
    polygon([[0.53, 0.09], [0.92, 0.08], [0.93, 0.63], [0.5, 0.46]], progress * 0.1, -progress * 0.06);
    polygon([[0.16, 0.81], [0.48, 0.54], [0.89, 0.75], [0.83, 0.93], [0.17, 0.94]], 0, progress * 0.1);
  } else {
    polygon([[0.1, 0.025], [0.87, 0.025], [0.975, 0.13], [0.975, 0.86],
      [0.88, 0.975], [0.13, 0.975], [0.025, 0.87], [0.025, 0.13]]);
    ctx.beginPath();
    // Keep most of the centre transparent so the selected colour stays legible.
    [[0.12, 0.08], [0.3, 0.22], [0.24, 0.36], [0.38, 0.43]].forEach((point, index) => {
      if (index === 0) ctx.moveTo(x + point[0] * size, y + point[1] * size);
      else ctx.lineTo(x + point[0] * size, y + point[1] * size);
    });
    ctx.moveTo(x + size * 0.3, y + size * 0.22);
    ctx.lineTo(x + size * 0.45, y + size * 0.16);
    ctx.moveTo(x + size * 0.9, y + size * 0.92);
    ctx.lineTo(x + size * 0.74, y + size * 0.76);
    ctx.lineTo(x + size * 0.79, y + size * 0.62);
    ctx.stroke();
  }
  ctx.restore();
}

module.exports = drawIce;
