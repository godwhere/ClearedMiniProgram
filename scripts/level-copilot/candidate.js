'use strict';

const contracts = require('./contracts.js');

const ERROR_CODES = Object.freeze({
  CANDIDATE_CELL_OUT_OF_RANGE: 'CANDIDATE_CELL_OUT_OF_RANGE',
  CANDIDATE_CELL_DUPLICATE: 'CANDIDATE_CELL_DUPLICATE',
  CANDIDATE_STEP_NON_ADJACENT: 'CANDIDATE_STEP_NON_ADJACENT',
  CANDIDATE_COVERAGE_MISSING: 'CANDIDATE_COVERAGE_MISSING',
  CANDIDATE_PORTAL_CELLS_INVALID: 'CANDIDATE_PORTAL_CELLS_INVALID',
  CANDIDATE_PORTAL_SEGMENTS_INVALID: 'CANDIDATE_PORTAL_SEGMENTS_INVALID',
  CANDIDATE_PORTAL_TRANSITION_INVALID: 'CANDIDATE_PORTAL_TRANSITION_INVALID',
  CANDIDATE_PORTAL_ENDPOINT_ADJACENT: 'CANDIDATE_PORTAL_ENDPOINT_ADJACENT',
  CANDIDATE_PORTAL_PATH_LENGTH_INVALID: 'CANDIDATE_PORTAL_PATH_LENGTH_INVALID',
  CANDIDATE_PORTAL_SEED_UNSPLITTABLE: 'CANDIDATE_PORTAL_SEED_UNSPLITTABLE'
});

function fail(code, details) {
  return { ok: false, error: { code, details: details || null } };
}

function adjacent(one, two, width) {
  return Math.abs(one % width - two % width) +
    Math.abs(Math.floor(one / width) - Math.floor(two / width)) === 1;
}

function segmentsOf(brief, path) {
  return brief.mechanic === 'portal' ? path.segments : [{ cells: path.cells }];
}

function flattenedPath(brief, path) {
  return segmentsOf(brief, path).reduce((cells, segment) => cells.concat(segment.cells), []);
}

function validatePathCover(brief, input) {
  const structure = contracts.validateCandidateStructure(brief, input);
  if (!structure.ok) return structure;
  const area = brief.width * brief.height;
  const owner = new Array(area).fill(-1);
  const portal = brief.mechanic === 'portal';
  const portalCells = portal ? input.portalCells : [];
  if (portal && (portalCells.some(cell => !Number.isInteger(cell) || cell < 0 || cell >= area) ||
      portalCells[0] === portalCells[1])) {
    return fail(ERROR_CODES.CANDIDATE_PORTAL_CELLS_INVALID);
  }
  let splitPathIndex = -1;
  for (let pathIndex = 0; pathIndex < input.paths.length; pathIndex += 1) {
    const segments = segmentsOf(brief, input.paths[pathIndex]);
    if (portal && segments.length === 2) {
      if (splitPathIndex >= 0) {
        return fail(ERROR_CODES.CANDIDATE_PORTAL_SEGMENTS_INVALID,
          { reason: 'multiple_split_paths' });
      }
      splitPathIndex = pathIndex;
    }
    const local = new Set();
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
      const cells = segments[segmentIndex].cells;
      for (let index = 0; index < cells.length; index += 1) {
        const cell = cells[index];
        if (!Number.isInteger(cell) || cell < 0 || cell >= area) {
          return fail(ERROR_CODES.CANDIDATE_CELL_OUT_OF_RANGE,
            { pathIndex, segmentIndex, index });
        }
        if (local.has(cell) || owner[cell] >= 0) {
          return fail(ERROR_CODES.CANDIDATE_CELL_DUPLICATE, { pathIndex, cell });
        }
        if (index > 0 && !adjacent(cells[index - 1], cell, brief.width)) {
          return fail(ERROR_CODES.CANDIDATE_STEP_NON_ADJACENT,
            { pathIndex, segmentIndex, index });
        }
        local.add(cell);
        owner[cell] = pathIndex;
      }
    }
    if (portal) {
      const flattened = flattenedPath(brief, input.paths[pathIndex]);
      const maximumLength = Math.floor(area * 0.35);
      if (flattened.length < 4 || flattened.length > maximumLength) {
        return fail(ERROR_CODES.CANDIDATE_PORTAL_PATH_LENGTH_INVALID,
          { pathIndex, length: flattened.length, minimum: 4, maximum: maximumLength });
      }
      if (adjacent(flattened[0], flattened[flattened.length - 1], brief.width)) {
        return fail(ERROR_CODES.CANDIDATE_PORTAL_ENDPOINT_ADJACENT, { pathIndex });
      }
    }
  }
  const missing = [];
  owner.forEach((pathIndex, cell) => { if (pathIndex < 0) missing.push(cell); });
  if (missing.length) {
    return fail(ERROR_CODES.CANDIDATE_COVERAGE_MISSING, { missingCount: missing.length });
  }
  if (portal) {
    if (splitPathIndex < 0) {
      return fail(ERROR_CODES.CANDIDATE_PORTAL_SEGMENTS_INVALID,
        { reason: 'split_path_required' });
    }
    const segments = input.paths[splitPathIndex].segments;
    const from = segments[0].cells[segments[0].cells.length - 1];
    const to = segments[1].cells[0];
    if (portalCells.indexOf(from) < 0 || portalCells.indexOf(to) < 0 || from === to ||
        adjacent(from, to, brief.width)) {
      return fail(ERROR_CODES.CANDIDATE_PORTAL_TRANSITION_INVALID,
        { pathIndex: splitPathIndex });
    }
    for (let pathIndex = 0; pathIndex < input.paths.length; pathIndex += 1) {
      const segmentsForPath = input.paths[pathIndex].segments;
      for (let segmentIndex = 0; segmentIndex < segmentsForPath.length; segmentIndex += 1) {
        const cells = segmentsForPath[segmentIndex].cells;
        for (let index = 0; index < cells.length; index += 1) {
          const isTransitionCell = pathIndex === splitPathIndex &&
            ((segmentIndex === 0 && index === cells.length - 1) ||
             (segmentIndex === 1 && index === 0));
          if (portalCells.indexOf(cells[index]) >= 0 && !isTransitionCell) {
            return fail(ERROR_CODES.CANDIDATE_PORTAL_TRANSITION_INVALID,
              { pathIndex, segmentIndex, index });
          }
        }
      }
    }
  }
  return { ok: true };
}

function portalSeedBrief(brief) {
  return Object.assign({}, brief, { mechanic: 'ordinary', colorCount: brief.colorCount - 1 });
}

function portalSeedCuts(cells, width, maximumLength) {
  const result = [];
  for (let first = 1; first < cells.length - 6; first += 1) {
    for (let second = first + 5; second < cells.length - 1; second += 1) {
      const portalLength = first + 1 + cells.length - second;
      const middleLength = second - first - 1;
      if (portalLength < 4 || portalLength > maximumLength ||
          middleLength < 4 || middleLength > maximumLength ||
          adjacent(cells[first], cells[second], width) ||
          adjacent(cells[first + 1], cells[second - 1], width)) continue;
      result.push({ first, second });
    }
  }
  return result;
}

function validatePortalSeed(brief, input) {
  const structure = contracts.validatePortalSeedStructure(brief, input);
  if (!structure.ok) return structure;
  const seedBrief = portalSeedBrief(brief);
  const cover = validatePathCover(seedBrief, input);
  if (!cover.ok) return cover;
  const maximumLength = Math.floor(brief.width * brief.height * 0.35);
  const cutsByPath = [];
  for (let pathIndex = 0; pathIndex < input.paths.length; pathIndex += 1) {
    const cells = input.paths[pathIndex].cells;
    if (cells.length < 4) {
      return fail(ERROR_CODES.CANDIDATE_PORTAL_PATH_LENGTH_INVALID,
        { pathIndex, length: cells.length, minimum: 4 });
    }
    if (adjacent(cells[0], cells[cells.length - 1], brief.width)) {
      return fail(ERROR_CODES.CANDIDATE_PORTAL_ENDPOINT_ADJACENT, { pathIndex });
    }
    cutsByPath.push(portalSeedCuts(cells, brief.width, maximumLength));
  }
  const splittable = cutsByPath.some((cuts, pathIndex) => cuts.length &&
    input.paths.every((path, otherIndex) =>
      otherIndex === pathIndex || path.cells.length <= maximumLength));
  return splittable ? { ok: true } :
    fail(ERROR_CODES.CANDIDATE_PORTAL_SEED_UNSPLITTABLE);
}

function expandPortalSeedCandidates(brief, input) {
  const checked = validatePortalSeed(brief, input);
  if (!checked.ok) return { ok: false, error: checked.error, candidates: [] };
  const maximumLength = Math.floor(brief.width * brief.height * 0.35);
  const candidates = [];
  input.paths.forEach((path, pathIndex) => {
    if (input.paths.some((otherPath, otherIndex) =>
      otherIndex !== pathIndex && otherPath.cells.length > maximumLength)) return;
    portalSeedCuts(path.cells, brief.width, maximumLength).forEach(cut => {
      const portalPath = {
        segments: [
          { cells: path.cells.slice(0, cut.first + 1) },
          { cells: path.cells.slice(cut.second) }
        ]
      };
      const middlePath = {
        segments: [{ cells: path.cells.slice(cut.first + 1, cut.second) }]
      };
      const paths = [];
      input.paths.forEach((seedPath, seedIndex) => {
        if (seedIndex === pathIndex) {
          paths.push(portalPath, middlePath);
        } else {
          paths.push({ segments: [{ cells: seedPath.cells.slice() }] });
        }
      });
      candidates.push({
        schemaVersion: 1,
        portalCells: [path.cells[cut.first], path.cells[cut.second]],
        paths,
        designSummary: input.designSummary
      });
    });
  });
  return { ok: true, candidates };
}

function portalSeedKey(input) {
  return input.paths.map(path => {
    const forward = path.cells.join(',');
    const reverse = path.cells.slice().reverse().join(',');
    return forward < reverse ? forward : reverse;
  }).sort().join('|');
}

function portalSeedNeighbors(brief, input) {
  const result = [];
  const seen = new Set();
  for (let firstPath = 0; firstPath < input.paths.length; firstPath += 1) {
    for (let secondPath = firstPath + 1; secondPath < input.paths.length; secondPath += 1) {
      for (const reverseFirst of [false, true]) {
        for (const reverseSecond of [false, true]) {
          const first = reverseFirst
            ? input.paths[firstPath].cells.slice().reverse() : input.paths[firstPath].cells;
          const second = reverseSecond
            ? input.paths[secondPath].cells.slice().reverse() : input.paths[secondPath].cells;
          for (let firstCut = 0; firstCut < first.length - 1; firstCut += 1) {
            for (let secondCut = 1; secondCut < second.length; secondCut += 1) {
              if (!adjacent(first[firstCut], second[secondCut], brief.width) ||
                  !adjacent(second[secondCut - 1], first[firstCut + 1], brief.width)) continue;
              const paths = input.paths.map(path => ({ cells: path.cells.slice() }));
              paths[firstPath] = {
                cells: first.slice(0, firstCut + 1).concat(second.slice(secondCut))
              };
              paths[secondPath] = {
                cells: second.slice(0, secondCut).concat(first.slice(firstCut + 1))
              };
              const candidate = {
                schemaVersion: 1,
                paths,
                designSummary: input.designSummary
              };
              const key = portalSeedKey(candidate);
              if (seen.has(key)) continue;
              seen.add(key);
              if (validatePortalSeed(brief, candidate).ok) result.push(candidate);
            }
          }
        }
      }
    }
  }
  return result;
}

function compileCandidate(brief, input) {
  if (brief.mechanic === 'portal') {
    const paths = input.paths.map(path => path.segments);
    return {
      level: {
        Mechanic: 'portal',
        PortalRulesVersion: 2,
        Width: brief.width,
        Height: brief.height,
        Lines: paths.map(segments => ({
          Start: segments[0].cells[0],
          End: segments[segments.length - 1].cells[
            segments[segments.length - 1].cells.length - 1]
        })),
        Portals: [{ Id: 'P1', Cells: input.portalCells.slice() }]
      },
      solution: paths.map(segments => ({
        Segments: segments.map((segment, segmentIndex) => {
          const compiled = { Cells: segment.cells.slice() };
          if (segmentIndex + 1 < segments.length) {
            compiled.Exit = {
              PortalId: 'P1',
              From: segment.cells[segment.cells.length - 1],
              To: segments[segmentIndex + 1].cells[0]
            };
          }
          return compiled;
        })
      }))
    };
  }
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

function transformCell(cell, width, height, transform) {
  // Preserve the original square-only helper call shape:
  // transformCell(cell, size, transform).
  if (transform === undefined) {
    transform = height;
    height = width;
  }
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1 ||
      !Number.isInteger(cell) || cell < 0 || cell >= width * height ||
      !Number.isInteger(transform)) throw new Error('Invalid cell transform');
  let x = cell % width;
  let y = Math.floor(cell / width);
  if (width !== height) {
    if (transform < 0 || transform > 3) throw new Error('Invalid rectangular transform');
    if (transform === 1 || transform === 3) x = width - 1 - x;
    if (transform === 2 || transform === 3) y = height - 1 - y;
    return y * width + x;
  }
  if (transform < 0 || transform > 7) throw new Error('Invalid square transform');
  if (transform >= 4) x = width - 1 - x;
  for (let turn = 0; turn < transform % 4; turn += 1) {
    const nextX = width - 1 - y;
    y = x;
    x = nextX;
  }
  return y * width + x;
}

function layoutKey(level) {
  if (!level || !Number.isInteger(level.Width) || level.Width < 1 ||
      !Number.isInteger(level.Height) || level.Height < 1 || !Array.isArray(level.Lines) ||
      level.Lines.some(line => !line || !Number.isInteger(line.Start) ||
        !Number.isInteger(line.End) || line.Start < 0 || line.End < 0 ||
        line.Start >= level.Width * level.Height || line.End >= level.Width * level.Height)) {
    throw new Error('layoutKey requires a valid rectangular level');
  }
  const portalCells = level.Mechanic === 'portal' && Array.isArray(level.Portals) &&
    level.Portals.length === 1 && Array.isArray(level.Portals[0].Cells)
    ? level.Portals[0].Cells : null;
  if (level.Mechanic === 'portal' && (!portalCells || portalCells.length < 2 ||
      portalCells.some(cell => !Number.isInteger(cell) || cell < 0 ||
        cell >= level.Width * level.Height))) {
    throw new Error('layoutKey requires valid Portal cells');
  }
  const variants = [];
  const transformCount = level.Width === level.Height ? 8 : 4;
  for (let transform = 0; transform < transformCount; transform += 1) {
    const pairs = level.Lines.map(line => [
      transformCell(line.Start, level.Width, level.Height, transform),
      transformCell(line.End, level.Width, level.Height, transform)
    ].sort((a, b) => a - b).join('-')).sort();
    const portals = portalCells ? portalCells.map(cell =>
      transformCell(cell, level.Width, level.Height, transform)).sort((a, b) => a - b) : null;
    variants.push(`${level.Width}x${level.Height}:${pairs.join('|')}${
      portals ? `@${portals.join(',')}` : ''}`);
  }
  variants.sort();
  return variants[0];
}

module.exports = {
  ERROR_CODES,
  validatePathCover,
  validatePortalSeed,
  expandPortalSeedCandidates,
  portalSeedKey,
  portalSeedNeighbors,
  compileCandidate,
  layoutKey,
  transformCell,
  flattenedPath
};
