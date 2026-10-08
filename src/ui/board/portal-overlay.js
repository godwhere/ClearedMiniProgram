'use strict';
const clearTiming = require('../../services/clear-animation-timing.js');

function portalCells(definition) {
  if (!definition || typeof definition !== 'object') return [];
  const cells = definition.cells === undefined ? definition.Cells : definition.cells;
  if (Array.isArray(cells)) return cells.slice();
  const a = definition.A === undefined ? definition.a : definition.A;
  const b = definition.B === undefined ? definition.b : definition.B;
  return [a, b];
}

function expectedExitCells(portal) {
  const raw = portal && Array.isArray(portal.expectedExits)
    ? portal.expectedExits
    : (portal && Number.isInteger(portal.expectedExit) ? [portal.expectedExit] : []);
  return new Set(raw.filter(Number.isInteger));
}

class PortalOverlay {
  constructor(options) {
    const opts = options || {};
    this.platform = opts.platform || null;
    this.getContext = typeof opts.getContext === 'function'
      ? opts.getContext : () => opts.context;
    this.getSkin = typeof opts.getSkin === 'function'
      ? opts.getSkin : () => opts.skin || { colors: {} };
    this.drawTile = typeof opts.drawTile === 'function' ? opts.drawTile : function () {};
    this.drawImageContain = typeof opts.drawImageContain === 'function'
      ? opts.drawImageContain : function () {};
    this.roundedRect = typeof opts.roundedRect === 'function' ? opts.roundedRect : function () {};
    this.invalidate = typeof opts.invalidate === 'function' ? opts.invalidate : function () {};
    this.image = null;
    this.imageLoading = false;
    this.imageSource = null;
  }

  ensureImage(source) {
    const requestedSource = typeof source === 'string' && source
      ? source : 'assets/icons/portal.png';
    if (this.image && this.imageSource === requestedSource) return this.image;
    if (this.imageLoading && this.imageSource === requestedSource) return null;
    this.image = null;
    this.imageSource = requestedSource;
    this.imageLoading = true;
    try {
      if (!this.platform || typeof this.platform.createImage !== 'function') {
        this.imageLoading = false;
        return null;
      }
      this.platform.createImage(requestedSource, (error, image) => {
        if (this.imageSource !== requestedSource) return;
        this.imageLoading = false;
        if (!error && image) {
          this.image = image;
          this.invalidate();
        }
      });
    } catch (error) {
      this.imageLoading = false;
    }
    return this.image;
  }

  drawFallback(x, y, size, now) {
    const ctx = this.getContext();
    if (!ctx) return;
    const cx = x + size / 2;
    const cy = y + size / 2;
    const radius = size * 0.42;
    const pulse = 0.5 + Math.sin(now / 240) * 0.5;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#0a1d37';
    ctx.fill();
    ctx.strokeStyle = '#f5a623';
    ctx.lineWidth = Math.max(2, size * 0.08);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.72, 0, Math.PI * 2);
    ctx.fillStyle = '#00a8ff';
    ctx.globalAlpha = 0.85 + pulse * 0.15;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, radius * (0.32 + pulse * 0.08), 0, Math.PI * 2);
    ctx.fillStyle = '#e0f7fa';
    ctx.fill();
    ctx.restore();
  }

  draw(portal, board, layout, gap, now, palette) {
    if (!portal || !Array.isArray(portal.portals) || !portal.portals.length || !layout) return;
    const ctx = this.getContext();
    if (!ctx) return;
    const skin = this.getSkin() || { colors: {} };
    const image = this.ensureImage(portal.icon);
    const isWaiting = portal.phase === 'PORTAL_WAIT';
    const isLocked = portal.phase === 'PORTAL_LOCKED';
    const expectedExits = isWaiting ? expectedExitCells(portal) : new Set();
    const lockedEntry = isLocked ? portal.lockedEntry : null;
    const animation = board && board.clearAnimation;
    const clearStartedAt = Number(animation && animation.startedAt);
    const clearActive = !!animation && (animation.type !== 'none' || animation.clearMode === 'sequential') &&
      Number.isFinite(clearStartedAt) &&
      now < clearStartedAt + clearTiming.duration(animation);
    const clearingCells = new Set(clearActive && animation && Array.isArray(animation.cells)
      ? animation.cells : []);
    const cells = board && Array.isArray(board.cells) ? board.cells : [];
    const selection = board && board.selection || {};
    const colors = Array.isArray(palette) && palette.length ? palette : ['#ffffff'];

    portal.portals.forEach(definition => {
      portalCells(definition).forEach(cellIndex => {
        if (!Number.isInteger(cellIndex) || cellIndex < 0) return;
        const state = cells[cellIndex] && cells[cellIndex].index === cellIndex
          ? cells[cellIndex]
          : cells.find(cell => cell && cell.index === cellIndex);
        const owned = !!(state && Number(state.owner) >= 0);
        const clearingOwned = owned && clearingCells.has(cellIndex);
        if (owned && !clearingOwned) return;
        const pathLine = clearingOwned ? state.owner
          : (state && state.selected ? selection.lineIndex : -1);
        const pathColor = Number.isInteger(pathLine) && pathLine >= 0
          ? colors[pathLine % colors.length] || '#ffffff' : null;

        const col = cellIndex % layout.cols;
        const row = Math.floor(cellIndex / layout.cols);
        const x = layout.x + col * layout.cell + gap;
        const y = layout.y + row * layout.cell + gap;
        const size = Math.max(1, layout.cell - gap * 2);
        const lockedSelected = isLocked && cellIndex === lockedEntry;
        const pathSelected = !owned && state && state.selected === true &&
          Number.isInteger(selection.lineIndex) && selection.lineIndex >= 0;
        const selectedBreath = pathSelected
          ? 0.5 + Math.sin(now / 160) * 0.5
          : 0;

        if (clearingOwned) {
          this.drawTile(-1, x, y, size, {
            color: skin.colors && skin.colors.emptyCell,
            skin
          });
        }

        if (lockedSelected) {
          ctx.save();
          this.roundedRect(x - 2, y - 2, size + 4, size + 4, 7);
          ctx.fillStyle = '#00e5ff';
          ctx.globalAlpha = 0.14 + selectedBreath * 0.12;
          ctx.fill();
          ctx.strokeStyle = '#00e5ff';
          ctx.lineWidth = Math.max(2.5, 3 + selectedBreath * 1.5);
          ctx.globalAlpha = 0.88 + selectedBreath * 0.12;
          ctx.stroke();
          ctx.restore();
        }

        const iconScale = pathSelected ? 1.1 + selectedBreath * 0.06 : 1;
        if (image) {
          // Compensate for the portal PNG's transparent margin; keep its center fixed.
          const iconSize = Math.max(1, (size - 4) * 1.25 * iconScale);
          this.drawImageContain(image, {
            x: x + size / 2 - iconSize / 2,
            y: y + size / 2 - iconSize / 2,
            w: iconSize,
            h: iconSize
          }, { fit: 'contain' });
        } else {
          const fallbackSize = size * iconScale;
          this.drawFallback(
            x + size / 2 - fallbackSize / 2,
            y + size / 2 - fallbackSize / 2,
            fallbackSize,
            now
          );
        }

        // Only actual path cells receive a path-colored frame, never candidate exits.
        if (pathColor) {
          ctx.save();
          ctx.strokeStyle = pathColor;
          ctx.lineWidth = Math.max(2, size * 0.055);
          ctx.globalAlpha = 1;
          const inset = ctx.lineWidth / 2;
          this.roundedRect(x + inset, y + inset, size - inset * 2, size - inset * 2, 6);
          ctx.stroke();
          ctx.restore();
        }

        if (isWaiting && expectedExits.has(cellIndex) && !pathColor) {
          const breath = 0.5 + Math.sin(now / 160) * 0.5;
          ctx.save();
          ctx.strokeStyle = '#ffeb3b';
          ctx.lineWidth = Math.max(2, 2.5 + breath * 1.5);
          ctx.globalAlpha = 0.82 + breath * 0.18;
          this.roundedRect(x - 1, y - 1, size + 2, size + 2, 6);
          ctx.stroke();
          ctx.restore();
        }

      });
    });
  }
}

PortalOverlay.portalCells = portalCells;

module.exports = PortalOverlay;
