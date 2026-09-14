'use strict';

const contracts = require('./contracts.js');

const ERROR_CODES = Object.freeze({
  CANDIDATE_CELL_OUT_OF_RANGE: 'CANDIDATE_CELL_OUT_OF_RANGE',
  CANDIDATE_CELL_DUPLICATE: 'CANDIDATE_CELL_DUPLICATE',
  CANDIDATE_STEP_NON_ADJACENT: 'CANDIDATE_STEP_NON_ADJACENT',
  CANDIDATE_COVERAGE_MISSING: 'CANDIDATE_COVERAGE_MISSING'
});

function fail(code, details) {
  return { ok: false, error: { code, details: details || null } };
}

function validatePathCover(brief, input) {
  const structure = contracts.validateCandidateStructure(brief, input);
  if (!structure.ok) return structure;
  const area = brief.width * brief.height;
  const owner = new Array(area).fill(-1);
  for (let pathIndex = 0; pathIndex < input.paths.length; pathIndex += 1) {
    const cells = input.paths[pathIndex].cells;
    const local = new Set();
    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index];
      if (!Number.isInteger(cell) || cell < 0 || cell >= area) {
        return fail(ERROR_CODES.CANDIDATE_CELL_OUT_OF_RANGE, { pathIndex, index });
      }
      if (local.has(cell) || owner[cell] >= 0) {
        return fail(ERROR_CODES.CANDIDATE_CELL_DUPLICATE, { pathIndex, cell });
      }
      if (index > 0) {
        const previous = cells[index - 1];
        const distance = Math.abs(cell % brief.width - previous % brief.width) +
          Math.abs(Math.floor(cell / brief.width) - Math.floor(previous / brief.width));
        if (distance !== 1) {
          return fail(ERROR_CODES.CANDIDATE_STEP_NON_ADJACENT, { pathIndex, index });
        }
      }
      local.add(cell);
      owner[cell] = pathIndex;
    }
  }
  const missing = [];
  owner.forEach((pathIndex, cell) => { if (pathIndex < 0) missing.push(cell); });
  if (missing.length) {
    return fail(ERROR_CODES.CANDIDATE_COVERAGE_MISSING, { missingCount: missing.length });
  }
  return { ok: true };
}

function compileCandidate(brief, input) {
  return {
    level: {
      Width: brief.width,
      Height: brief.height,
      Lines: input.paths.map(path => ({
        Start: path.cells[0],
        End: path.cells[path.cells.length - 1]
      }))
    },
    solution: input.paths.map(path => path.cells.slice())
  };
}

function transformCell(cell, size, transform) {
  let x = cell % size;
  let y = Math.floor(cell / size);
  if (transform >= 4) x = size - 1 - x;
  for (let turn = 0; turn < transform % 4; turn += 1) {
    const nextX = size - 1 - y;
    y = x;
    x = nextX;
  }
  return y * size + x;
}

function layoutKey(level) {
  if (!level || !Number.isInteger(level.Width) || level.Width !== level.Height ||
      !Array.isArray(level.Lines)) throw new Error('layoutKey requires a square level');
  const variants = [];
  for (let transform = 0; transform < 8; transform += 1) {
    const pairs = level.Lines.map(line => [
      transformCell(line.Start, level.Width, transform),
      transformCell(line.End, level.Width, transform)
    ].sort((a, b) => a - b).join('-')).sort();
    variants.push(`${level.Width}x${level.Height}:${pairs.join('|')}`);
  }
  variants.sort();
  return variants[0];
}

module.exports = {
  ERROR_CODES,
  validatePathCover,
  compileCandidate,
  layoutKey,
  transformCell
};
