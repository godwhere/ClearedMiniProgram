'use strict';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function portalCells(definition) {
  if (!definition || typeof definition !== 'object') return [];
  if (Array.isArray(definition.cells)) return definition.cells.slice(0, 2);
  const a = definition.A === undefined ? definition.a : definition.A;
  const b = definition.B === undefined ? definition.b : definition.B;
  return [a, b];
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
    this.text = typeof opts.text === 'function' ? opts.text : function () {};
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

  draw(portal, board, layout, gap, now) {
    if (!portal || !Array.isArray(portal.portals) || !portal.portals.length || !layout) return;
    const ctx = this.getContext();
    if (!ctx) return;
    const skin = this.getSkin() || { colors: {} };
    const image = this.ensureImage(portal.icon);
    const isWaiting = portal.phase === 'PORTAL_WAIT';
    const isLocked = portal.phase === 'PORTAL_LOCKED';
    const expectedExit = isWaiting ? portal.expectedExit : null;
    const lockedEntry = isLocked ? portal.lockedEntry : null;
    const animation = board && board.clearAnimation;
    const clearStartedAt = Number(animation && animation.startedAt);
    const clearDuration = Number(animation && animation.durationMs);
    const clearActive = Number.isFinite(clearStartedAt) &&
      now < clearStartedAt + (Number.isFinite(clearDuration) && clearDuration > 0 ? clearDuration : 300);
    const clearingCells = new Set(clearActive && animation && Array.isArray(animation.cells)
      ? animation.cells : []);
    const cells = board && Array.isArray(board.cells) ? board.cells : [];

    portal.portals.forEach(definition => {
      const id = definition && (definition.id || definition.Id) || 'P1';
      portalCells(definition).forEach(cellIndex => {
        if (!Number.isInteger(cellIndex) || cellIndex < 0) return;
        const state = cells[cellIndex] && cells[cellIndex].index === cellIndex
          ? cells[cellIndex]
          : cells.find(cell => cell && cell.index === cellIndex);
        const owned = !!(state && Number(state.owner) >= 0);
        const clearingOwned = owned && clearingCells.has(cellIndex);
        if (owned && !clearingOwned) return;

        const col = cellIndex % layout.cols;
        const row = Math.floor(cellIndex / layout.cols);
        const x = layout.x + col * layout.cell + gap;
        const y = layout.y + row * layout.cell + gap;
        const size = Math.max(1, layout.cell - gap * 2);

        if (clearingOwned) {
          this.drawTile(-1, x, y, size, {
            color: skin.colors && skin.colors.emptyCell,
            skin
          });
        }
        if (image) {
          this.drawImageContain(image, {
            x: x + 2,
            y: y + 2,
            w: size - 4,
            h: size - 4
          }, { fit: 'contain' });
        } else {
          this.drawFallback(x, y, size, now);
        }

        this.text(String(id), x + size - 6, y + 8, clamp(size * 0.2, 9, 12), {
          color: '#ffffff',
          alpha: 0.85,
          weight: 600,
          align: 'right'
        });

        if (isWaiting && cellIndex === expectedExit) {
          const breath = 0.5 + Math.sin(now / 160) * 0.5;
          ctx.save();
          ctx.strokeStyle = '#ffeb3b';
          ctx.lineWidth = Math.max(2, 2.5 + breath * 1.5);
          ctx.globalAlpha = 0.82 + breath * 0.18;
          this.roundedRect(x - 1, y - 1, size + 2, size + 2, 6);
          ctx.stroke();
          ctx.restore();
        }

        if (isLocked && cellIndex === lockedEntry) {
          const breath = 0.5 + Math.sin(now / 120) * 0.5;
          ctx.save();
          ctx.strokeStyle = '#00e5ff';
          ctx.lineWidth = Math.max(2, 2 + breath * 2);
          ctx.globalAlpha = 0.85 + breath * 0.15;
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
