'use strict';

const STEP_MS = 120;
const DEFAULT_MODE = 'simultaneous';
// Published boards contain at most 80 cells. Revisit this bound with larger boards.
const MAX_CELLS = 80;
const validMode = value => value === 'sequential' || value === 'simultaneous';

function duration(animation) {
  if (!animation) return 0;
  const value = Number(animation.durationMs);
  const cellMs = animation.type === 'none' ? 0
    : Number.isFinite(value) && value > 0 ? Math.max(80, Math.min(500, value)) : 300;
  const count = Array.isArray(animation.cells) ? Math.min(MAX_CELLS, animation.cells.length) : 0;
  return cellMs + (animation.clearMode === 'sequential' ? Math.max(0, count - 1) * STEP_MS : 0);
}

module.exports = { STEP_MS, DEFAULT_MODE, MAX_CELLS, validMode, duration };
