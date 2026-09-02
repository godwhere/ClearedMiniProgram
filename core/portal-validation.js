'use strict';

/**
 * Pure validation and normalization helpers for Portal v1 and v2.
 *
 * This module deliberately has no dependency on GameRunner, Canvas, wx, or
 * persistence.  It can be used by catalog/build checks as well as by the
 * daily-content validator. Canonical authoring uses `{ Id, A, B }` for v1
 * pairs and `{ Id, Cells }` for one v2 network. Common level fields retain
 * PascalCase, while lower-case aliases are accepted at import boundaries.
 */

const portalSchema = require('./portal-schema.js');

const {
  isRecord,
  own,
  field,
  first,
  dimensions,
  rawPortals,
  rawMechanic,
  rawRulesVersion,
  readPortal,
  normalizePortals,
  buildPortalIndex
} = portalSchema;

const CODES = Object.freeze({
  MECHANIC_INVALID: 'portal-mechanic-invalid',
  REQUIRED_ARRAY: 'portals-required-array',
  NOT_OBJECT: 'portal-not-object',
  ID_REQUIRED: 'portal-id-required',
  ID_DUPLICATE: 'portal-id-duplicate',
  CELL_INTEGER: 'portal-cell-integer',
  CELL_ARRAY_INVALID: 'portal-cells-array-invalid',
  V2_PAIR_FIELDS_FORBIDDEN: 'portal-v2-pair-fields-forbidden',
  CELL_OUT_OF_RANGE: 'portal-cell-out-of-range',
  CELL_DUPLICATE: 'portal-cell-duplicate',
  CELL_COUNT_INSUFFICIENT: 'portal-cell-count-insufficient',
  ENDPOINT_CONFLICT: 'portal-endpoint-conflict',
  BLOCKED_CONFLICT: 'portal-blocked-conflict',
  BLOCKED_REQUIRED_ARRAY: 'portal-blocked-required-array',
  BLOCKED_INTEGER: 'portal-blocked-integer',
  BLOCKED_OUT_OF_RANGE: 'portal-blocked-out-of-range',
  BLOCKED_DUPLICATE: 'portal-blocked-duplicate',
  PAIR_COUNT_EXCEEDED: 'portal-pair-count-exceeded',
  PAIR_REQUIRED: 'portal-pair-required',
  NETWORK_COUNT_INVALID: 'portal-network-count-invalid',
  RULES_VERSION_INVALID: 'portal-rules-version-invalid',
  BOARD_DIMENSIONS_INVALID: 'portal-board-dimensions-invalid',
  SOLUTION_REQUIRED: 'portal-solution-required',
  SOLUTION_LINE_COUNT: 'solution-line-count',
  SOLUTION_SEGMENT_REQUIRED: 'solution-segment-required',
  SOLUTION_START_MISMATCH: 'solution-start-mismatch',
  SOLUTION_END_MISMATCH: 'solution-end-mismatch',
  SOLUTION_CELL_INTEGER: 'solution-cell-non-integer',
  SOLUTION_CELL_OUT_OF_RANGE: 'solution-cell-out-of-range',
  SOLUTION_THROUGH_BLOCKED: 'solution-through-blocked',
  SOLUTION_PATH_DUPLICATE: 'solution-path-duplicate',
  SOLUTION_OVERLAP: 'solution-overlap',
  SOLUTION_INCOMPLETE: 'solution-incomplete',
  SOLUTION_SEGMENT_NON_ADJACENT: 'solution-segment-non-adjacent',
  SOLUTION_TRANSITION_REQUIRED: 'solution-portal-transition-required',
  SOLUTION_PAIR_INVALID: 'solution-portal-pair-invalid',
  SOLUTION_NETWORK_INVALID: 'solution-portal-network-invalid',
  SOLUTION_REUSE: 'solution-portal-reuse',
  SOLUTION_USE_COUNT_EXCEEDED: 'solution-portal-use-count-exceeded',
  SOLUTION_ORDER: 'solution-portal-order',
  SOLUTION_NOT_OBJECT: 'solution-segment-not-object'
});

function add(errors, code) {
  if (errors.indexOf(code) < 0) errors.push(code);
}

function inspectBlocked(level, board) {
  const errors = [];
  const valid = new Set();
  const seen = new Set();
  const value = field(level, 'Blocked', 'blocked');
  if (value === undefined) return { errors, valid };
  if (!Array.isArray(value)) {
    add(errors, CODES.BLOCKED_REQUIRED_ARRAY);
    return { errors, valid };
  }
  value.forEach(cell => {
    if (!Number.isInteger(cell)) {
      add(errors, CODES.BLOCKED_INTEGER);
      return;
    }
    if (seen.has(cell)) add(errors, CODES.BLOCKED_DUPLICATE);
    else seen.add(cell);
    if (!board.valid || cell < 0 || cell >= board.total) {
      if (board.valid) add(errors, CODES.BLOCKED_OUT_OF_RANGE);
      return;
    }
    valid.add(cell);
  });
  return { errors, valid };
}

function rawLines(level) {
  const value = field(level, 'Lines', 'lines');
  return Array.isArray(value) ? value : [];
}

function lineEndpoint(line, name) {
  if (name === 'start') return field(line, 'Start', 'start');
  return field(line, 'End', 'end');
}

function endpointSet(level) {
  const result = new Set();
  rawLines(level).forEach(line => {
    if (!isRecord(line)) return;
    const start = lineEndpoint(line, 'start');
    const end = lineEndpoint(line, 'end');
    if (Number.isInteger(start)) result.add(start);
    if (Number.isInteger(end)) result.add(end);
  });
  return result;
}

function blockedSet(level, board) {
  return inspectBlocked(level, board || dimensions(level)).valid;
}

function v2PortalCells(raw) {
  return first(raw, ['Cells', 'cells']);
}

function portalCells(portal) {
  if (!portal || typeof portal !== 'object') return [];
  if (Array.isArray(portal.cells)) return portal.cells;
  if (Array.isArray(portal.Cells)) return portal.Cells;
  return [portal.A, portal.B];
}

function structuralResult(errors, level, portals, rulesVersion) {
  const index = buildPortalIndex(portals, { rulesVersion });
  return {
    ok: errors.length === 0,
    errors,
    mechanic: rawMechanic(level),
    rulesVersion,
    portals: index.portals,
    portalByCell: index.portalByCell,
    portalById: index.portalById
  };
}

/**
 * Validate portal declarations on a level.  A level without a Portals field
 * and without `Mechanic: 'portal'` is a valid legacy level and returns `ok`.
 */
function validatePortals(level, options) {
  const opts = isRecord(options) ? options : {};
  const errors = [];
  if (!isRecord(level)) {
    add(errors, CODES.MECHANIC_INVALID);
    return structuralResult(errors, {}, [], 1);
  }

  const source = rawPortals(level);
  const mechanic = rawMechanic(level);
  const isPortal = mechanic === 'portal';
  const explicitVersion = rawRulesVersion(level);
  const rulesVersion = explicitVersion === undefined ? 1 : explicitVersion;

  // An explicit Portals field is not silently treated as ordinary content.
  // This catches authoring mistakes where the mechanic selector was omitted.
  if (!isPortal) {
    if (source.present) add(errors, CODES.MECHANIC_INVALID);
    return structuralResult(errors, level, [], rulesVersion);
  }

  if (!Array.isArray(source.value)) {
    add(errors, CODES.REQUIRED_ARRAY);
    return structuralResult(errors, level, [], rulesVersion);
  }

  if (!Number.isInteger(explicitVersion) || (explicitVersion !== 1 && explicitVersion !== 2)) {
    add(errors, CODES.RULES_VERSION_INVALID);
  }
  const isV2 = explicitVersion === 2;
  if (isV2) {
    if (source.value.length !== 1) add(errors, CODES.NETWORK_COUNT_INVALID);
  } else {
    if (source.value.length === 0) add(errors, CODES.PAIR_REQUIRED);
    if (source.value.length > 1) add(errors, CODES.PAIR_COUNT_EXCEEDED);
  }

  const board = dimensions(level);
  if (!board.valid) add(errors, CODES.BOARD_DIMENSIONS_INVALID);
  const blockedInspection = inspectBlocked(level, board);
  blockedInspection.errors.forEach(code => add(errors, code));
  const blocked = blockedInspection.valid;
  const endpoints = endpointSet(level);
  const seenIds = new Set();
  const seenCells = new Set();
  const validPortals = [];

  for (let sourceIndex = 0; sourceIndex < source.value.length; sourceIndex += 1) {
    if (!Object.prototype.hasOwnProperty.call(source.value, sourceIndex)) {
      add(errors, CODES.NOT_OBJECT);
    }
  }

  source.value.forEach((raw, sourceIndex) => {
    if (!isRecord(raw)) {
      add(errors, CODES.NOT_OBJECT);
      return;
    }
    if (isV2) {
      const id = first(raw, ['Id', 'id']);
      const cells = v2PortalCells(raw);
      const hasPairFields = own(raw, 'A') || own(raw, 'a') || own(raw, 'B') || own(raw, 'b');
      if (hasPairFields) add(errors, CODES.V2_PAIR_FIELDS_FORBIDDEN);
      const validId = typeof id === 'string' && id.trim().length > 0;
      if (!validId) {
        add(errors, CODES.ID_REQUIRED);
      } else if (seenIds.has(id)) {
        add(errors, CODES.ID_DUPLICATE);
      } else {
        seenIds.add(id);
      }
      if (!Array.isArray(cells)) {
        add(errors, CODES.CELL_ARRAY_INVALID);
        return;
      }
      if (cells.length < 2) add(errors, CODES.CELL_COUNT_INSUFFICIENT);
      let descriptorValid = validId && cells.length >= 2 && !hasPairFields;
      const localCells = new Set();
      for (let cellIndex = 0; cellIndex < cells.length; cellIndex += 1) {
        const cell = cells[cellIndex];
        if (!Object.prototype.hasOwnProperty.call(cells, cellIndex)) {
          add(errors, CODES.CELL_INTEGER);
          descriptorValid = false;
          continue;
        }
        if (!Number.isInteger(cell)) {
          add(errors, CODES.CELL_INTEGER);
          descriptorValid = false;
          continue;
        }
        if (!board.valid || cell < 0 || cell >= board.total) {
          add(errors, CODES.CELL_OUT_OF_RANGE);
          descriptorValid = false;
          continue;
        }
        if (localCells.has(cell) || seenCells.has(cell)) {
          add(errors, CODES.CELL_DUPLICATE);
          descriptorValid = false;
        }
        localCells.add(cell);
        seenCells.add(cell);
        if (blocked.has(cell)) {
          add(errors, CODES.BLOCKED_CONFLICT);
          descriptorValid = false;
        }
        if (endpoints.has(cell)) {
          add(errors, CODES.ENDPOINT_CONFLICT);
          descriptorValid = false;
        }
      }
      if (descriptorValid) {
        validPortals.push({
          id,
          Id: id,
          cells: cells.slice(),
          Cells: cells.slice(),
          sourceIndex
        });
      }
      return;
    }

    const portal = readPortal(raw, sourceIndex);
    const compactCells = first(raw, ['Cells', 'cells']);
    // If the compact form is present alongside A/B, A/B remain authoritative;
    // otherwise it must contain exactly the two endpoints of one pair.
    const hasExplicitAB = first(raw, ['A', 'a']) !== undefined ||
      first(raw, ['B', 'b']) !== undefined;
    if (compactCells !== undefined && !hasExplicitAB &&
        (!Array.isArray(compactCells) || compactCells.length !== 2)) {
      add(errors, CODES.CELL_ARRAY_INVALID);
    }
    const validId = typeof portal.id === 'string' && portal.id.trim().length > 0;
    if (!validId) {
      add(errors, CODES.ID_REQUIRED);
    } else if (seenIds.has(portal.id)) {
      add(errors, CODES.ID_DUPLICATE);
    } else {
      seenIds.add(portal.id);
    }

    const cells = [portal.A, portal.B];
    const validCells = [];
    cells.forEach(cell => {
      if (!Number.isInteger(cell)) {
        add(errors, CODES.CELL_INTEGER);
        return;
      }
      if (!board.valid || cell < 0 || cell >= board.total) {
        add(errors, CODES.CELL_OUT_OF_RANGE);
        return;
      }
      validCells.push(cell);
      if (seenCells.has(cell)) add(errors, CODES.CELL_DUPLICATE);
      else seenCells.add(cell);
      if (blocked.has(cell)) add(errors, CODES.BLOCKED_CONFLICT);
      if (endpoints.has(cell)) add(errors, CODES.ENDPOINT_CONFLICT);
    });
    if (validCells.length === 2 && validCells[0] === validCells[1]) {
      add(errors, CODES.CELL_DUPLICATE);
    }

    // Keep only descriptors that can be safely used by a defensive runtime
    // lookup.  Structural errors above still make the overall result invalid.
    if (validId && Number.isInteger(portal.A) && Number.isInteger(portal.B)) {
      validPortals.push({
        id: portal.id,
        Id: portal.id,
        A: portal.A,
        B: portal.B,
        a: portal.A,
        b: portal.B,
        sourceIndex
      });
    }
  });

  // `requireSolution` is opt-in so structural checks can run before a
  // solution catalog is assembled.  validatePortalLevel() exposes the same
  // option and is the preferred authoring/build entry point.
  if (opts.requireSolution && opts.solution === undefined) {
    add(errors, CODES.SOLUTION_REQUIRED);
  }
  return structuralResult(errors, level, validPortals, rulesVersion);
}

function solutionField(value, upper, lower) {
  return field(value, upper, lower);
}

function extractSolutionPaths(level, input) {
  if (Array.isArray(input)) return input;
  if (!isRecord(input)) return null;
  const id = field(level, 'Id', 'id');
  const maps = [
    first(input, ['ByLevelId', 'byLevelId']),
    first(input, ['ByChallengeId', 'byChallengeId'])
  ];
  for (let i = 0; i < maps.length; i += 1) {
    const map = maps[i];
    if (isRecord(map) && id && Array.isArray(map[id])) return map[id];
  }
  // A one-line authoring convenience is useful for fixture files, while the
  // canonical multi-line shape remains an outer array in line order.
  if (Array.isArray(solutionField(input, 'Segments', 'segments')) &&
      rawLines(level).length === 1) return [input];
  return null;
}

function segmentCells(segment) {
  return solutionField(segment, 'Cells', 'cells');
}

function segmentExit(segment) {
  return solutionField(segment, 'Exit', 'exit');
}

function exitField(exit, upper, lower) {
  return solutionField(exit, upper, lower);
}

function exitPortalId(exit) {
  return exitField(exit, 'PortalId', 'portalId') ||
    exitField(exit, 'PairId', 'pairId') || exitField(exit, 'Id', 'id');
}

function canonicalSegments(lineSolution) {
  if (!isRecord(lineSolution)) return null;
  const segments = solutionField(lineSolution, 'Segments', 'segments');
  return Array.isArray(segments) ? segments : null;
}

function adjacent(one, two, width) {
  return Number.isInteger(width) && width > 0 &&
    Math.abs((one % width) - (two % width)) +
    Math.abs(Math.floor(one / width) - Math.floor(two / width)) === 1;
}

/**
 * Validate a portal-aware, segmented solution.  Every segment is contiguous;
 * a non-adjacent move is legal only through an explicit Exit edge on the
 * segment that ends at a portal cell and a following segment that starts at
 * its paired cell.
 */
function validatePortalSolution(level, solution) {
  const structural = validatePortals(level);
  const errors = structural.errors.slice();
  const paths = extractSolutionPaths(level, solution);
  if (!Array.isArray(paths)) {
    add(errors, CODES.SOLUTION_REQUIRED);
    return {
      ok: false,
      errors,
      portals: structural.portals,
      portalByCell: structural.portalByCell,
      portalById: structural.portalById
    };
  }

  const board = dimensions(level);
  // Invalid Blocked entries are diagnosed by structural validation above and
  // never reduce the number of real board cells required for full coverage.
  const blocked = blockedSet(level, board);
  const lines = rawLines(level);
  if (paths.length !== lines.length) add(errors, CODES.SOLUTION_LINE_COUNT);
  const covered = new Set();
  const usedPortalCells = new Set();
  const byId = structural.portalById;
  const isV2 = structural.rulesVersion === 2;
  let portalTransitionCount = 0;

  lines.forEach((line, lineIndex) => {
    const lineSolution = paths[lineIndex];
    const segments = canonicalSegments(lineSolution);
    if (!segments || segments.length === 0) {
      add(errors, CODES.SOLUTION_SEGMENT_REQUIRED);
      return;
    }
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
      if (!Object.prototype.hasOwnProperty.call(segments, segmentIndex)) {
        add(errors, CODES.SOLUTION_SEGMENT_REQUIRED);
        return;
      }
    }
    const start = lineEndpoint(line, 'start');
    const end = lineEndpoint(line, 'end');
    const lineCells = [];
    const local = new Set();
    const transitions = [];
    let previousExit = null;

    segments.forEach((segment, segmentIndex) => {
      if (!isRecord(segment)) {
        add(errors, CODES.SOLUTION_NOT_OBJECT);
        return;
      }
      const cells = segmentCells(segment);
      if (!Array.isArray(cells) || cells.length === 0) {
        add(errors, CODES.SOLUTION_SEGMENT_REQUIRED);
        return;
      }
      for (let cellIndex = 0; cellIndex < cells.length; cellIndex += 1) {
        if (!Object.prototype.hasOwnProperty.call(cells, cellIndex)) {
          add(errors, CODES.SOLUTION_CELL_INTEGER);
        }
      }
      const exit = segmentExit(segment);
      cells.forEach((cell, order) => {
        if (!Number.isInteger(cell)) {
          add(errors, CODES.SOLUTION_CELL_INTEGER);
          return;
        }
        if (!board.valid || cell < 0 || cell >= board.total) {
          add(errors, CODES.SOLUTION_CELL_OUT_OF_RANGE);
          return;
        }
        if (blocked.has(cell)) add(errors, CODES.SOLUTION_THROUGH_BLOCKED);
        if (local.has(cell)) add(errors, CODES.SOLUTION_PATH_DUPLICATE);
        local.add(cell);
        if (covered.has(cell)) add(errors, CODES.SOLUTION_OVERLAP);
        covered.add(cell);
        lineCells.push(cell);
        if (order > 0 && Number.isInteger(cells[order - 1]) &&
            board.valid && !adjacent(cells[order - 1], cell, board.width)) {
          add(errors, CODES.SOLUTION_SEGMENT_NON_ADJACENT);
        }
        if (structural.portalByCell[cell]) usedPortalCells.add(cell);
      });

      const last = cells[cells.length - 1];
      const nextSegment = segments[segmentIndex + 1];
      const nextCells = nextSegment && segmentCells(nextSegment);
      const portalAtLast = Number.isInteger(last) && structural.portalByCell[last];
      if (segmentIndex > 0 && !previousExit) {
        // Multiple segments are meaningful only when the preceding segment
        // ended with an explicit portal edge.  Splitting an ordinary path
        // without that edge would make the release/reconnect boundary
        // impossible to execute.
        add(errors, CODES.SOLUTION_ORDER);
      }
      if (portalAtLast && !exit) {
        // A portal cell cannot be an ordinary dead-end.  It must explicitly
        // describe the release/continue edge to the next segment.
        add(errors, CODES.SOLUTION_TRANSITION_REQUIRED);
      }
      if (exit !== undefined && exit !== null) {
        if (!isRecord(exit)) {
          add(errors, CODES.SOLUTION_PAIR_INVALID);
          return;
        }
        if (!nextSegment || !Array.isArray(nextCells) || nextCells.length === 0) {
          add(errors, CODES.SOLUTION_ORDER);
        }
        const pairId = exitPortalId(exit);
        const from = exitField(exit, 'From', 'from');
        const to = exitField(exit, 'To', 'to');
        const pair = typeof pairId === 'string' ? byId[pairId] : null;
        if (!pair) {
          add(errors, isV2 ? CODES.SOLUTION_NETWORK_INVALID : CODES.SOLUTION_PAIR_INVALID);
        } else {
          if (isV2) {
            const networkCells = portalCells(pair);
            if (from === to || networkCells.indexOf(from) < 0 ||
                networkCells.indexOf(to) < 0 || from !== last || !portalAtLast) {
              add(errors, CODES.SOLUTION_NETWORK_INVALID);
            } else {
              portalTransitionCount += 1;
            }
            if (transitions.length >= 1) add(errors, CODES.SOLUTION_USE_COUNT_EXCEEDED);
            transitions.push(pairId);
          } else {
            const expectedOther = from === pair.A ? pair.B :
              (from === pair.B ? pair.A : null);
            if (expectedOther === null || to !== expectedOther || from !== last ||
                !portalAtLast) {
              add(errors, CODES.SOLUTION_PAIR_INVALID);
            }
            if (transitions.indexOf(pairId) >= 0) add(errors, CODES.SOLUTION_REUSE);
            transitions.push(pairId);
          }
        }
        if (!Array.isArray(nextCells) || nextCells[0] !== to) {
          add(errors, CODES.SOLUTION_ORDER);
        }
        previousExit = exit;
      } else {
        previousExit = null;
        if (nextSegment) {
          add(errors, CODES.SOLUTION_ORDER);
          const nextFirst = Array.isArray(nextCells) ? nextCells[0] : undefined;
          if (Number.isInteger(last) && Number.isInteger(nextFirst) &&
              board.valid && !adjacent(last, nextFirst, board.width)) {
            add(errors, CODES.SOLUTION_SEGMENT_NON_ADJACENT);
          }
        }
      }
      // A portal in the middle of a contiguous segment would mean the path
      // ignored the required lock/release boundary.
      cells.forEach((cell, order) => {
        // The first cell of a segment after an explicit Exit is the paired
        // destination and is therefore intentionally a portal cell.  Any
        // other portal appearing before the segment's last cell would imply
        // that the required release boundary was omitted.
        const isContinuationEntry = segmentIndex > 0 && order === 0;
        if (structural.portalByCell[cell] && order < cells.length - 1 &&
            !isContinuationEntry) {
          add(errors, CODES.SOLUTION_ORDER);
        }
      });
      if (segmentIndex > 0 && structural.portalByCell[cells[0]]) {
        const previous = transitions[segmentIndex - 1];
        // The explicit Exit check above is authoritative; this guard catches
        // a segment that starts at a portal without any preceding edge.
        if (!previous && segmentIndex > 0) add(errors, CODES.SOLUTION_ORDER);
      }
    });

    if (lineCells.length === 0 || lineCells[0] !== start) {
      add(errors, CODES.SOLUTION_START_MISMATCH);
    }
    if (lineCells.length === 0 || lineCells[lineCells.length - 1] !== end) {
      add(errors, CODES.SOLUTION_END_MISMATCH);
    }
  });

  if (isV2) {
    for (let cell = 0; cell < board.total; cell += 1) {
      if (!blocked.has(cell) && !structural.portalByCell[cell] && !covered.has(cell)) {
        add(errors, CODES.SOLUTION_INCOMPLETE);
        break;
      }
    }
    if (portalTransitionCount === 0) add(errors, CODES.SOLUTION_TRANSITION_REQUIRED);
  } else {
    const expected = board.total - blocked.size;
    if (expected > 0 && covered.size !== expected) add(errors, CODES.SOLUTION_INCOMPLETE);
    // v1 pair cells remain mandatory coverable cells.
    structural.portals.forEach(portal => {
      [portal.A, portal.B].forEach(cell => {
        if (!usedPortalCells.has(cell)) add(errors, CODES.SOLUTION_ORDER);
      });
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    portals: structural.portals,
    portalByCell: structural.portalByCell,
    portalById: structural.portalById
  };
}

/**
 * Combined level validator.  The optional second argument may be a solution
 * array or `{ solution, requireSolution }`.  Structural validation remains
 * useful when no solution catalog is present; passing `requireSolution: true`
 * enforces the Portal-level publishing gate from the design document.
 */
function validatePortalLevel(level, solutionOrOptions) {
  let solution;
  let requireSolution = false;
  if (isRecord(solutionOrOptions) &&
      (own(solutionOrOptions, 'solution') || own(solutionOrOptions, 'requireSolution'))) {
    solution = solutionOrOptions.solution;
    requireSolution = solutionOrOptions.requireSolution === true;
  } else {
    solution = solutionOrOptions;
  }
  const structural = validatePortals(level);
  // Keep the legacy catalog path untouched when this helper is applied to a
  // mixed ordinary/portal set.  Ordinary flat cell arrays belong to the
  // existing solutions validator; they must not be forced through the portal
  // segmented schema merely because a caller uses this combined entry point.
  if (rawMechanic(level) !== 'portal' && !rawPortals(level).present) {
    return structural;
  }
  if (solution !== undefined && solution !== null) {
    return validatePortalSolution(level, solution);
  }
  if (requireSolution && rawMechanic(level) === 'portal') {
    const errors = structural.errors.slice();
    add(errors, CODES.SOLUTION_REQUIRED);
    return Object.assign({}, structural, { ok: false, errors });
  }
  return structural;
}

// A data-only canonicalizer for callers that need normalized segments before
// rendering or persistence.  It never claims validity; use the validator for
// diagnostics and publishing gates.
function normalizePortalSolution(level, solution) {
  const paths = extractSolutionPaths(level, solution);
  if (!Array.isArray(paths)) return null;
  const isV2 = rawRulesVersion(level) === 2;
  return paths.map(lineSolution => {
    const segments = canonicalSegments(lineSolution);
    if (!segments) return { Segments: [] };
    return {
      Segments: segments.map(segment => {
        if (!isRecord(segment)) return { Cells: [] };
        const cells = segmentCells(segment);
        const result = { Cells: Array.isArray(cells) ? cells.slice() : [] };
        const exit = segmentExit(segment);
        if (isRecord(exit)) {
          result.Exit = { From: exitField(exit, 'From', 'from'), To: exitField(exit, 'To', 'to') };
          result.Exit[isV2 ? 'PortalId' : 'PairId'] = exitPortalId(exit);
        }
        return result;
      })
    };
  });
}

// Keep the default export callable while exposing named helpers for adapters
// and tests.  This is friendly to both `require(...)(level)` and destructured
// imports used by build tooling.
module.exports = validatePortalLevel;
module.exports.validate = validatePortalLevel;
// Descriptive aliases used by catalog/build adapters.
module.exports.validatePortalData = validatePortalLevel;
module.exports.validatePortal = validatePortalLevel;
module.exports.validateLevel = validatePortalLevel;
module.exports.validatePortalLevel = validatePortalLevel;
module.exports.validatePortals = validatePortals;
module.exports.validatePortalSolution = validatePortalSolution;
module.exports.validateSolution = validatePortalSolution;
module.exports.normalizePortals = normalizePortals;
module.exports.normalizePortalSolution = normalizePortalSolution;
module.exports.buildPortalIndex = buildPortalIndex;
module.exports.codes = CODES;
module.exports.ERROR_CODES = CODES;
