'use strict';

function cloneRect(rect) {
  if (!rect || typeof rect !== 'object') return null;
  return {
    x: Number(rect.x),
    y: Number(rect.y),
    w: Number(rect.w),
    h: Number(rect.h)
  };
}

function cloneLayout(layout) {
  if (!layout || typeof layout !== 'object') return null;
  return {
    x: Number(layout.x),
    y: Number(layout.y),
    cell: Number(layout.cell),
    cols: Number(layout.cols),
    rows: Number(layout.rows)
  };
}

class InteractionMap {
  constructor() {
    this.hits = [];
    this.boardLayout = null;
  }

  clear() {
    this.clearHits();
    this.boardLayout = null;
  }

  clearHits() {
    this.hits = [];
  }

  add(id, rect, enabled) {
    if (enabled === false || typeof id !== 'string' || !id) return false;
    const normalized = cloneRect(rect);
    if (!normalized || !Number.isFinite(normalized.x) || !Number.isFinite(normalized.y) ||
        !Number.isFinite(normalized.w) || !Number.isFinite(normalized.h) ||
        normalized.w < 0 || normalized.h < 0) return false;
    this.hits.push({ id, rect: normalized });
    return true;
  }

  hitTest(x, y) {
    for (let index = this.hits.length - 1; index >= 0; index--) {
      const hit = this.hits[index];
      const rect = hit.rect;
      if (x >= rect.x && x <= rect.x + rect.w &&
          y >= rect.y && y <= rect.y + rect.h) return hit.id;
    }
    return null;
  }

  cellAt(x, y) {
    const layout = this.boardLayout;
    if (!layout || !(layout.cell > 0) || !(layout.cols > 0) || !(layout.rows > 0)) return -1;
    const col = Math.floor((x - layout.x) / layout.cell);
    const row = Math.floor((y - layout.y) / layout.cell);
    if (col < 0 || row < 0 || col >= layout.cols || row >= layout.rows) return -1;
    return row * layout.cols + col;
  }

  getBoardLayout() {
    return cloneLayout(this.boardLayout);
  }

  setBoardLayout(layout) {
    const normalized = cloneLayout(layout);
    if (!normalized || !Number.isFinite(normalized.x) || !Number.isFinite(normalized.y) ||
        !(normalized.cell > 0) || !Number.isInteger(normalized.cols) || normalized.cols <= 0 ||
        !Number.isInteger(normalized.rows) || normalized.rows <= 0) {
      this.boardLayout = null;
      return null;
    }
    this.boardLayout = normalized;
    return this.getBoardLayout();
  }
}

module.exports = InteractionMap;
