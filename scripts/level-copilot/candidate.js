'use strict';

const contracts = require('./contracts.js');

// Four-gate expansion crosses cut choices from two seed paths. Keep that
// deterministic authoring search bounded; raise only after eval evidence shows
// valid layouts are being missed rather than spending unbounded local time.
const MAX_PORTAL_CUTS_PER_PATH = 32;
const MAX_EXPANDED_PORTAL_CANDIDATES = 1024;

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
      new Set(portalCells).size !== portalCells.length)) {
    return fail(ERROR_CODES.CANDIDATE_PORTAL_CELLS_INVALID);
  }
  const splitPathIndexes = [];
  for (let pathIndex = 0; pathIndex < input.paths.length; pathIndex += 1) {
    const segments = segmentsOf(brief, input.paths[pathIndex]);
    if (portal && segments.length === 2) {
      splitPathIndexes.push(pathIndex);
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
    const expectedSplitPaths = contracts.portalSplitPathCount(brief);
    if (splitPathIndexes.length !== expectedSplitPaths) {
      return fail(ERROR_CODES.CANDIDATE_PORTAL_SEGMENTS_INVALID,
        { reason: 'split_path_count', expected: expectedSplitPaths,
          actual: splitPathIndexes.length });
    }
    const transitionCells = new Set();
    for (const pathIndex of splitPathIndexes) {
      const segments = input.paths[pathIndex].segments;
      const from = segments[0].cells[segments[0].cells.length - 1];
      const to = segments[1].cells[0];
      if (portalCells.indexOf(from) < 0 || portalCells.indexOf(to) < 0 || from === to ||
          adjacent(from, to, brief.width)) {
        return fail(ERROR_CODES.CANDIDATE_PORTAL_TRANSITION_INVALID, { pathIndex });
      }
      transitionCells.add(from);
      transitionCells.add(to);
    }
    if (transitionCells.size !== portalCells.length ||
        portalCells.some(cell => !transitionCells.has(cell))) {
      return fail(ERROR_CODES.CANDIDATE_PORTAL_TRANSITION_INVALID,
        { reason: 'portal_cells_must_all_be_used' });
    }
    const splitPathSet = new Set(splitPathIndexes);
    for (let pathIndex = 0; pathIndex < input.paths.length; pathIndex += 1) {
      const segmentsForPath = input.paths[pathIndex].segments;
      for (let segmentIndex = 0; segmentIndex < segmentsForPath.length; segmentIndex += 1) {
        const cells = segmentsForPath[segmentIndex].cells;
        for (let index = 0; index < cells.length; index += 1) {
          const isTransitionCell = splitPathSet.has(pathIndex) &&
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
  return Object.assign({}, brief, {
    mechanic: 'ordinary',
    colorCount: brief.colorCount - contracts.portalSplitPathCount(brief),
    portalCellCount: undefined
  });
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

function portalSeedPlans(brief, input, maximumLength) {
  const cutsByPath = input.paths.map(path =>
    portalSeedCuts(path.cells, brief.width, maximumLength));
  const splitPathCount = contracts.portalSplitPathCount(brief);
  const selections = [];
  function choose(start, selected) {
    if (selected.length === splitPathCount) {
      const selectedSet = new Set(selected);
      if (input.paths.every((path, pathIndex) =>
        selectedSet.has(pathIndex) || path.cells.length <= maximumLength)) {
        selections.push(selected.slice());
      }
      return;
    }
    for (let pathIndex = start; pathIndex < cutsByPath.length; pathIndex += 1) {
      if (!cutsByPath[pathIndex].length) continue;
      selected.push(pathIndex);
      choose(pathIndex + 1, selected);
      selected.pop();
    }
  }
  choose(0, []);
  return { cutsByPath, selections };
}

function representativeCuts(cuts) {
  if (cuts.length <= MAX_PORTAL_CUTS_PER_PATH) return cuts;
  const selected = [];
  for (let index = 0; index < MAX_PORTAL_CUTS_PER_PATH; index += 1) {
    const sourceIndex = Math.floor(index * (cuts.length - 1) /
      (MAX_PORTAL_CUTS_PER_PATH - 1));
    selected.push(cuts[sourceIndex]);
  }
  return selected;
}

function validatePortalSeed(brief, input) {
  const structure = contracts.validatePortalSeedStructure(brief, input);
  if (!structure.ok) return structure;
  const seedBrief = portalSeedBrief(brief);
  const cover = validatePathCover(seedBrief, input);
  if (!cover.ok) return cover;
  const maximumLength = Math.floor(brief.width * brief.height * 0.35);
  for (let pathIndex = 0; pathIndex < input.paths.length; pathIndex += 1) {
    const cells = input.paths[pathIndex].cells;
    if (cells.length < 4) {
      return fail(ERROR_CODES.CANDIDATE_PORTAL_PATH_LENGTH_INVALID,
        { pathIndex, length: cells.length, minimum: 4 });
    }
    if (adjacent(cells[0], cells[cells.length - 1], brief.width)) {
      return fail(ERROR_CODES.CANDIDATE_PORTAL_ENDPOINT_ADJACENT, { pathIndex });
    }
  }
  const plans = portalSeedPlans(brief, input, maximumLength);
  return plans.selections.length ? { ok: true } :
    fail(ERROR_CODES.CANDIDATE_PORTAL_SEED_UNSPLITTABLE);
}

function expandPortalSeedCandidates(brief, input) {
  const checked = validatePortalSeed(brief, input);
  if (!checked.ok) return { ok: false, error: checked.error, candidates: [] };
  const maximumLength = Math.floor(brief.width * brief.height * 0.35);
  const candidates = [];
  const plans = portalSeedPlans(brief, input, maximumLength);
  for (const selectedPathIndexes of plans.selections) {
    const cutOptions = selectedPathIndexes.map(pathIndex =>
      selectedPathIndexes.length === 1
        ? plans.cutsByPath[pathIndex]
        : representativeCuts(plans.cutsByPath[pathIndex]));
    function chooseCuts(index, selectedCuts) {
      if (candidates.length >= MAX_EXPANDED_PORTAL_CANDIDATES) return;
      if (index < cutOptions.length) {
        for (const cut of cutOptions[index]) {
          selectedCuts.push(cut);
          chooseCuts(index + 1, selectedCuts);
          selectedCuts.pop();
          if (candidates.length >= MAX_EXPANDED_PORTAL_CANDIDATES) break;
        }
        return;
      }
      const selected = new Map(selectedPathIndexes.map((pathIndex, selectionIndex) =>
        [pathIndex, selectedCuts[selectionIndex]]));
      const paths = [];
      const portalCells = [];
      input.paths.forEach((seedPath, seedIndex) => {
        const cut = selected.get(seedIndex);
        if (!cut) {
          paths.push({ segments: [{ cells: seedPath.cells.slice() }] });
          return;
        }
        paths.push({
          segments: [
            { cells: seedPath.cells.slice(0, cut.first + 1) },
            { cells: seedPath.cells.slice(cut.second) }
          ]
        }, {
          segments: [{ cells: seedPath.cells.slice(cut.first + 1, cut.second) }]
        });
        portalCells.push(seedPath.cells[cut.first], seedPath.cells[cut.second]);
      });
      candidates.push({
        schemaVersion: 1,
        portalCells,
        paths,
        designSummary: input.designSummary
      });
    }
    chooseCuts(0, []);
    if (candidates.length >= MAX_EXPANDED_PORTAL_CANDIDATES) break;
  }
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
  MAX_PORTAL_CUTS_PER_PATH,
  MAX_EXPANDED_PORTAL_CANDIDATES,
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
