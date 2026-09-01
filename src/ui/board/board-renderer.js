'use strict';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const EFFECT_MIN_DURATION_MS = 80;
const EFFECT_MAX_DURATION_MS = 500;
const DEFAULT_FADE_PARAMS = {
  alphaFrom: 1,
  alphaTo: 0,
  scaleFrom: 1,
  scaleTo: 1.14,
  staggerRatio: 0.018
};

class BoardRenderer {
  constructor(options) {
    const opts = options || {};
    this.getSkin = typeof opts.getSkin === 'function'
      ? opts.getSkin : () => opts.skin || { colors: {}, layout: {}, animation: {} };
    this.clearEffects = opts.clearEffects || null;
    this.drawTile = typeof opts.drawTile === 'function' ? opts.drawTile : function () {};
    this.drawBlockedCell = typeof opts.drawBlockedCell === 'function'
      ? opts.drawBlockedCell : function () {};
    this.text = typeof opts.text === 'function' ? opts.text : function () {};
    this.portalOverlay = opts.portalOverlay || null;
    this.renderClearAnimation = typeof opts.renderClearAnimation === 'function'
      ? opts.renderClearAnimation
      : (...args) => this.drawClearAnimation(...args);
  }

  portalCellSet(portal) {
    const indices = new Set();
    if (!portal || !Array.isArray(portal.portals)) return indices;
    portal.portals.forEach(definition => {
      if (!definition || typeof definition !== 'object') return;
      const cells = Array.isArray(definition.cells)
        ? definition.cells
        : [definition.A === undefined ? definition.a : definition.A,
          definition.B === undefined ? definition.b : definition.B];
      cells.forEach(index => {
        if (Number.isInteger(index) && index >= 0) indices.add(index);
      });
    });
    return indices;
  }

  draw(viewModel, layout, palette, now, options) {
    const board = viewModel && viewModel.board;
    if (!board || !layout) return null;
    const portal = viewModel.mechanic && viewModel.mechanic.portal;
    const portalCells = this.portalCellSet(portal);
    const skin = this.getSkin();
    const gap = clamp(
      layout.cell * skin.layout.cellGapRatio,
      skin.layout.minCellGap,
      skin.layout.maxCellGap
    );

    this.drawCells(board, layout, palette, now, gap, portalCells, options);
    this.renderClearAnimation(board.clearAnimation, palette, now, gap, layout, portalCells);
    if (board.hint && (board.hintUntil === undefined || now < board.hintUntil)) {
      this.drawHintPath(board.hint, palette, now, layout, portalCells);
    }
    if (this.portalOverlay) this.portalOverlay.draw(portal, board, layout, gap, now);
    return gap;
  }

  drawCells(board, layout, palette, now, gap, portalCells, options) {
    const opts = options || {};
    const skin = this.getSkin();
    const cells = Array.isArray(board.cells) ? board.cells : [];
    const lines = Array.isArray(board.lines) ? board.lines : [];
    const selection = board.selection || {};
    const selectedLine = Number.isInteger(selection.lineIndex) ? selection.lineIndex : -1;
    const enteredAt = Number(opts.levelEnteredAt) || 0;
    const enterElapsed = now - enteredAt;
    const enterMs = Number(skin.animation.boardEnterMs) || 0;
    const animateBlocked = opts.animateBlocked !== false;
    const colors = Array.isArray(palette) && palette.length ? palette : ['#ffffff'];

    for (let row = 0; row < layout.rows; row++) {
      for (let col = 0; col < layout.cols; col++) {
        const index = row * layout.cols + col;
        const state = cells[index] && cells[index].index === index
          ? cells[index]
          : cells.find(cell => cell && cell.index === index);
        if (!state) continue;
        const stagger = ((row + col) / Math.max(1, layout.cols + layout.rows - 2)) * 120;
        const enter = clamp((enterElapsed - stagger) / Math.max(1, enterMs - 120), 0, 1);
        const x = layout.x + col * layout.cell + gap;
        const yBase = layout.y + row * layout.cell + gap;
        const y = yBase - (1 - enter) * 12;
        const size = Math.max(1, layout.cell - gap * 2);
        if (state.blocked) {
          this.drawBlockedCell(x, animateBlocked ? y : yBase, size, animateBlocked ? enter : 1, skin);
          continue;
        }
        if (Number(state.owner) >= 0) continue;

        const fixedLine = Number.isInteger(state.fixedLine) ? state.fixedLine : -1;
        const portalCell = portalCells.has(index) || state.portal === true;
        const selected = !portalCell && state.selected === true;
        let color = skin.colors.emptyCell;
        if (selected) color = colors[selectedLine % colors.length] || '#ffffff';
        else if (fixedLine >= 0) color = colors[fixedLine % colors.length] || '#ffffff';

        const activePulse = selected ? (0.5 + Math.sin(now / 180) * 0.5) : 0;
        const activeScale = selected
          ? 1 + (skin.layout.activeCellScale - 1) * (0.72 + activePulse * 0.28)
          : 1;
        this.drawTile(portalCell ? -1 : (selected ? selectedLine : fixedLine), x, y, size, {
          color,
          alpha: enter,
          scale: activeScale,
          overlay: selected ? { color: skin.colors.selectedCellOverlay, alpha: 1 } : null
        });

        const line = lines[fixedLine];
        const lineText = line && (line.Text === undefined ? line.text : line.Text);
        if (fixedLine >= 0 && lineText && !selected) {
          this.text('→', x + size / 2, y + size / 2, clamp(size * 0.44, 14, 28), {
            alpha: enter,
            weight: 400
          });
        }
      }
    }
  }

  drawHintPath(hint, palette, now, layout, portalCells) {
    if (!hint || !layout) return;
    const segments = hint.segments || (hint.path && hint.path.length >= 2 ? [hint.path] : null);
    if (!segments || !segments.length) return;
    const skin = this.getSkin();
    const colors = Array.isArray(palette) && palette.length ? palette : ['#ffffff'];
    const color = colors[hint.lineIndex % colors.length] || '#ffffff';
    const breath = 0.5 + Math.sin(now / 320) * 0.5;
    const gap = clamp(layout.cell * 0.085, 2, 5);
    const tileSize = Math.max(1, layout.cell - gap * 2);
    const excluded = portalCells || new Set();

    segments.forEach(segment => {
      if (!Array.isArray(segment) || !segment.length) return;
      segment.forEach((index, order) => {
        if (excluded.has(index)) return;
        const x = layout.x + (index % layout.cols) * layout.cell + gap;
        const y = layout.y + Math.floor(index / layout.cols) * layout.cell + gap;
        const endpointPulse = order === 0 || order === segment.length - 1 ? 1.04 : 1;
        this.drawTile(hint.lineIndex, x, y, tileSize, {
          color,
          alpha: 0.62 + breath * 0.18,
          scale: (1 + breath * 0.035) * endpointPulse,
          overlay: { color, alpha: 0.12 },
          skin
        });
      });
    });
  }

  drawClearAnimation(animation, palette, now, gap, layout, portalCells) {
    if (!animation || !layout || animation.type === 'none') return;
    const skin = this.getSkin();
    let effect = null;
    let effectType = typeof animation.type === 'string' ? animation.type : null;
    let effectDuration = Number(animation.durationMs);
    let params = animation.params && typeof animation.params === 'object'
      ? animation.params : null;
    if (!effectType || !params || !(Number.isFinite(effectDuration) && effectDuration > 0)) {
      if (this.clearEffects) {
        try {
          if (typeof this.clearEffects.resolve === 'function') {
            effect = this.clearEffects.resolve(animation.effectId);
          } else if (typeof this.clearEffects.current === 'function') {
            effect = this.clearEffects.current();
          }
        } catch (error) {
          effect = null;
        }
      }
    }
    if (effect && typeof effect === 'object') {
      if (!effectType && typeof effect.type === 'string') effectType = effect.type;
      if (!(Number.isFinite(effectDuration) && effectDuration > 0)) {
        effectDuration = Number(effect.durationMs);
      }
      if (!params && effect.params && typeof effect.params === 'object') params = effect.params;
    }
    if (effectType === 'none') return;
    const rawDuration = Number(animation.durationMs);
    const legacyDuration = Number(skin.animation && skin.animation.pathClearMs);
    const duration = Number.isFinite(rawDuration) && rawDuration > 0
      ? clamp(rawDuration, EFFECT_MIN_DURATION_MS, EFFECT_MAX_DURATION_MS)
      : Number.isFinite(effectDuration) && effectDuration > 0
        ? clamp(effectDuration, EFFECT_MIN_DURATION_MS, EFFECT_MAX_DURATION_MS)
        : Number.isFinite(legacyDuration) && legacyDuration > 0
          ? clamp(legacyDuration, EFFECT_MIN_DURATION_MS, EFFECT_MAX_DURATION_MS)
          : 300;
    if (!params || typeof params !== 'object') params = DEFAULT_FADE_PARAMS;
    effectType = effectType || (effect && effect.type) || 'fade';
    const type = effectType === 'fade' ? 'fade' : 'fade';
    const timestamp = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const startedAt = Number.isFinite(Number(animation.startedAt))
      ? Number(animation.startedAt) : timestamp;
    const progress = clamp((timestamp - startedAt) / duration, 0, 1);
    if (progress >= 1) return;
    const tileGap = Number(gap) >= 0 ? Number(gap) : clamp(layout.cell * 0.085, 2, 5);
    const colors = Array.isArray(palette) && palette.length ? palette : [];
    const color = colors.length
      ? colors[animation.lineIndex % colors.length]
      : skin.colors.text;
    const alphaFrom = Number.isFinite(Number(params.alphaFrom))
      ? clamp(Number(params.alphaFrom), 0, 1) : 1;
    const alphaTo = Number.isFinite(Number(params.alphaTo))
      ? clamp(Number(params.alphaTo), 0, 1) : 0;
    const scaleFrom = Number.isFinite(Number(params.scaleFrom)) && Number(params.scaleFrom) > 0
      ? Number(params.scaleFrom) : 1;
    const scaleTo = Number.isFinite(Number(params.scaleTo)) && Number(params.scaleTo) > 0
      ? Number(params.scaleTo) : 1.14;
    const staggerRatio = Number.isFinite(Number(params.staggerRatio))
      ? clamp(Number(params.staggerRatio), 0, 0.1) : 0.018;
    const excluded = portalCells || new Set();
    const cells = Array.isArray(animation.cells) ? animation.cells : [];
    cells.forEach((index, order) => {
      if (!Number.isInteger(index) || index < 0 || index >= layout.cols * layout.rows) return;
      if (excluded.has(index)) return;
      const col = index % layout.cols;
      const row = Math.floor(index / layout.cols);
      const local = clamp(progress * (1 + staggerRatio * 10) - order * staggerRatio, 0, 1);
      const alpha = alphaFrom + (alphaTo - alphaFrom) * local;
      const scale = scaleFrom + (scaleTo - scaleFrom) * local;
      const baseSize = layout.cell - tileGap * 2;
      const centerX = layout.x + (col + 0.5) * layout.cell;
      const centerY = layout.y + (row + 0.5) * layout.cell;
      if (type === 'fade') {
        this.drawTile(animation.lineIndex,
          centerX - baseSize / 2,
          centerY - baseSize / 2,
          baseSize,
          { color, alpha, scale, skin });
      }
    });
  }
}

module.exports = BoardRenderer;
