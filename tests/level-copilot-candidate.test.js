'use strict';

const assert = require('assert');
const tools = require('../scripts/level-copilot/candidate.js');
const catalog = require('../data/catalog-v2.js');
const portalSolutions = require('../data/portal-solutions.js');

const brief = {
  schemaVersion: 1,
  mechanic: 'ordinary',
  width: 5,
  height: 5,
  colorCount: 5,
  targetGrade: 1,
  designIntent: 'Fixture.'
};

function cover() {
  return {
    schemaVersion: 1,
    designSummary: null,
    paths: Array.from({ length: 5 }, (_, row) => ({
      cells: Array.from({ length: 5 }, (_, column) => row * 5 + (row % 2 ? 4 - column : column))
    }))
  };
}

function changed(mutator) {
  const value = cover();
  mutator(value);
  return value;
}

function code(value) {
  const result = tools.validatePathCover(brief, value);
  return result.error && result.error.code;
}

function transformed(level, transform) {
  const result = {
    Width: level.Width,
    Height: level.Height,
    Lines: level.Lines.slice().reverse().map(line => ({
      Start: tools.transformCell(line.End, level.Width, level.Height, transform),
      End: tools.transformCell(line.Start, level.Width, level.Height, transform)
    }))
  };
  if (level.Mechanic === 'portal') {
    result.Mechanic = 'portal';
    result.PortalRulesVersion = 2;
    result.Portals = [{ Id: 'renamed-network', Cells: level.Portals[0].Cells.map(cell =>
      tools.transformCell(cell, level.Width, level.Height, transform)).reverse() }];
  }
  return result;
}

function portalFixture(id) {
  const level = catalog.levels.find(entry => entry.game.Id === id).game;
  const answer = portalSolutions.ByLevelId[id];
  return {
    brief: {
      schemaVersion: 1,
      mechanic: 'portal',
      width: level.Width,
      height: level.Height,
      colorCount: level.Lines.length,
      targetGrade: level.Difficulty,
      designIntent: 'Portal fixture.'
    },
    candidate: {
      schemaVersion: 1,
      portalCells: level.Portals[0].Cells.slice(),
      paths: answer.map(line => ({
        segments: line.Segments.map(segment => ({ cells: segment.Cells.slice() }))
      })),
      designSummary: null
    }
  };
}

function portalSeed() {
  return {
    brief: {
      schemaVersion: 1,
      mechanic: 'portal',
      width: 8,
      height: 8,
      colorCount: 9,
      targetGrade: 2,
      designIntent: 'Portal seed fixture.'
    },
    candidate: {
      schemaVersion: 1,
      paths: Array.from({ length: 8 }, (_, row) => ({
        cells: Array.from({ length: 8 }, (_, column) => row * 8 + column)
      })),
      designSummary: 'Eight continuous seed rows.'
    }
  };
}

function longPortalSeed() {
  return {
    brief: {
      schemaVersion: 1,
      mechanic: 'portal',
      width: 8,
      height: 8,
      colorCount: 5,
      targetGrade: 5,
      designIntent: 'Long splittable Portal seed fixture.'
    },
    candidate: {
      schemaVersion: 1,
      paths: [
        { cells: [26, 25, 24, 32, 40, 48, 56, 57, 49, 50, 42, 43,
          51, 52, 53, 54, 46, 38, 30, 29, 37, 36, 44, 45] },
        { cells: [17, 16, 8, 9, 10, 18, 19, 11, 3, 2, 1, 0] },
        { cells: [12, 4, 5, 6, 7, 15, 14, 13, 21, 20, 28, 27, 35, 34, 33, 41] },
        { cells: [58, 59, 60, 61, 62, 63, 55, 47, 39, 31, 23, 22] }
      ],
      designSummary: 'One long seed reversibly merges a Portal path and an ordinary path.'
    }
  };
}

function fourGatePortalSeed() {
  return {
    brief: {
      schemaVersion: 1,
      mechanic: 'portal',
      width: 8,
      height: 10,
      colorCount: 10,
      targetGrade: 3,
      designIntent: 'Eight by ten four-gate Portal seed fixture.',
      portalCellCount: 4
    },
    candidate: {
      schemaVersion: 1,
      paths: [
        { cells: [0, 8, 9, 1, 2, 10, 11, 3, 4, 12, 13, 5, 6, 14, 15, 7] },
        { cells: [16, 24, 25, 17, 18, 26, 27, 19, 20, 28, 29, 21, 22, 30, 31, 23] }
      ].concat(Array.from({ length: 6 }, (_, row) => ({
        cells: Array.from({ length: 8 }, (_, column) => (row + 4) * 8 + column)
      }))),
      designSummary: 'Two paths are split into two independent jumps in one network.'
    }
  };
}

function run() {
  assert.strictEqual(tools.validatePathCover(brief, cover()).ok, true);
  assert.strictEqual(code(changed(value => { value.paths[0].cells[1] = 1.5; })),
    'CANDIDATE_CELL_OUT_OF_RANGE');
  assert.strictEqual(code(changed(value => { value.paths[0].cells[1] = 25; })),
    'CANDIDATE_CELL_OUT_OF_RANGE');
  assert.strictEqual(code(changed(value => { value.paths[0].cells[2] = 1; })),
    'CANDIDATE_CELL_DUPLICATE');
  assert.strictEqual(code(changed(value => { value.paths[1].cells[0] = 0; })),
    'CANDIDATE_CELL_DUPLICATE');
  assert.strictEqual(code(changed(value => { [value.paths[0].cells[1], value.paths[0].cells[2]] =
    [value.paths[0].cells[2], value.paths[0].cells[1]]; })), 'CANDIDATE_STEP_NON_ADJACENT');
  assert.strictEqual(code(changed(value => { value.paths[4].cells.pop(); })),
    'CANDIDATE_COVERAGE_MISSING');

  const compiled = tools.compileCandidate(brief, cover());
  assert.deepStrictEqual(compiled.level.Lines[0], { Start: 0, End: 4 });
  assert.deepStrictEqual(compiled.level.Lines[1], { Start: 9, End: 5 });
  assert.deepStrictEqual(compiled.solution[2], [10, 11, 12, 13, 14]);
  const originalKey = tools.layoutKey(compiled.level);
  for (let transform = 0; transform < 8; transform += 1) {
    assert.strictEqual(tools.layoutKey(transformed(compiled.level, transform)), originalKey);
  }
  assert.strictEqual(tools.transformCell(4, 5, 1),
    tools.transformCell(4, 5, 5, 1), 'the square helper shorthand remains compatible');
  const different = JSON.parse(JSON.stringify(compiled.level));
  different.Lines[0].End = 3;
  assert.notStrictEqual(tools.layoutKey(different), originalKey);

  const rectangular = {
    Width: 8,
    Height: 10,
    Lines: Array.from({ length: 10 }, (_, row) => ({
      Start: row * 8,
      End: row * 8 + 7
    }))
  };
  const rectangularKey = tools.layoutKey(rectangular);
  for (let transform = 0; transform < 4; transform += 1) {
    assert.strictEqual(tools.layoutKey(transformed(rectangular, transform)), rectangularKey);
  }
  assert(rectangularKey.startsWith('8x10:'));
  assert.throws(() => tools.transformCell(0, 8, 10, 4), /rectangular transform/);
  assert.throws(() => tools.layoutKey({ Width: 8, Height: 10,
    Lines: [{ Start: 0, End: 80 }] }), /rectangular level/);

  const portal = portalFixture('recovery-8x8-40');
  assert.strictEqual(tools.validatePathCover(portal.brief, portal.candidate).ok, true);
  const portalCompiled = tools.compileCandidate(portal.brief, portal.candidate);
  assert.strictEqual(portalCompiled.level.Mechanic, 'portal');
  assert.strictEqual(portalCompiled.level.PortalRulesVersion, 2);
  assert.deepStrictEqual(portalCompiled.level.Portals,
    [{ Id: 'P1', Cells: portal.candidate.portalCells }]);
  const split = portalCompiled.solution.find(line => line.Segments.length === 2);
  assert(split.Segments[0].Exit);
  assert.strictEqual(split.Segments[0].Exit.PortalId, 'P1');
  const portalKey = tools.layoutKey(portalCompiled.level);
  assert(portalKey.includes('@'));
  for (let transform = 0; transform < 8; transform += 1) {
    assert.strictEqual(tools.layoutKey(transformed(portalCompiled.level, transform)), portalKey);
  }
  const movedPortal = JSON.parse(JSON.stringify(portalCompiled.level));
  movedPortal.Portals[0].Cells = [0, 63];
  assert.notStrictEqual(tools.layoutKey(movedPortal), portalKey);

  const duplicateGate = JSON.parse(JSON.stringify(portal.candidate));
  duplicateGate.portalCells[1] = duplicateGate.portalCells[0];
  assert.strictEqual(tools.validatePathCover(portal.brief, duplicateGate).error.code,
    'CANDIDATE_PORTAL_CELLS_INVALID');
  const wrongGates = JSON.parse(JSON.stringify(portal.candidate));
  wrongGates.portalCells = [0, 63];
  assert.strictEqual(tools.validatePathCover(portal.brief, wrongGates).error.code,
    'CANDIDATE_PORTAL_TRANSITION_INVALID');
  const multipleSplits = JSON.parse(JSON.stringify(portal.candidate));
  const ordinaryPath = multipleSplits.paths.find(path => path.segments.length === 1 &&
    path.segments[0].cells.length >= 4);
  const ordinaryCells = ordinaryPath.segments[0].cells;
  ordinaryPath.segments = [
    { cells: ordinaryCells.slice(0, 2) },
    { cells: ordinaryCells.slice(2) }
  ];
  assert.strictEqual(tools.validatePathCover(portal.brief, multipleSplits).error.code,
    'CANDIDATE_PORTAL_SEGMENTS_INVALID');

  const seed = portalSeed();
  assert.strictEqual(tools.validatePortalSeed(seed.brief, seed.candidate).ok, true);
  const expanded = tools.expandPortalSeedCandidates(seed.brief, seed.candidate);
  assert.strictEqual(expanded.ok, true);
  assert.strictEqual(expanded.candidates.length, 8);
  expanded.candidates.forEach(candidate => {
    assert.strictEqual(candidate.paths.length, 9);
    assert.strictEqual(candidate.paths.filter(path => path.segments.length === 2).length, 1);
    assert.strictEqual(tools.validatePathCover(seed.brief, candidate).ok, true);
  });
  const wrongSeedCount = JSON.parse(JSON.stringify(seed.candidate));
  wrongSeedCount.paths.pop();
  assert.strictEqual(tools.validatePortalSeed(seed.brief, wrongSeedCount).error.code,
    'CANDIDATE_PATH_COUNT_MISMATCH');

  const longSeed = longPortalSeed();
  assert.strictEqual(longSeed.candidate.paths[0].cells.length > Math.floor(64 * 0.35), true);
  assert.strictEqual(tools.validatePortalSeed(longSeed.brief, longSeed.candidate).ok, true);
  const longExpanded = tools.expandPortalSeedCandidates(longSeed.brief, longSeed.candidate);
  const reversible = longExpanded.candidates.find(candidate =>
    candidate.portalCells[0] === 48 && candidate.portalCells[1] === 30);
  assert(reversible, 'the host must allow a long seed when both resulting paths fit the final cap');
  assert.deepStrictEqual(reversible.paths[0].segments.map(segment => segment.cells.length), [6, 6]);
  assert.strictEqual(reversible.paths[1].segments[0].cells.length, 12);
  assert.strictEqual(tools.validatePathCover(longSeed.brief, reversible).ok, true);
  const neighbors = tools.portalSeedNeighbors(longSeed.brief, longSeed.candidate);
  assert(neighbors.length > 0);
  assert.strictEqual(new Set(neighbors.map(tools.portalSeedKey)).size, neighbors.length);
  neighbors.forEach(neighbor => {
    assert.strictEqual(tools.validatePortalSeed(longSeed.brief, neighbor).ok, true);
  });

  const fourGate = fourGatePortalSeed();
  assert.strictEqual(tools.validatePortalSeed(fourGate.brief, fourGate.candidate).ok, true);
  const fourGateExpanded = tools.expandPortalSeedCandidates(
    fourGate.brief, fourGate.candidate);
  assert.strictEqual(fourGateExpanded.ok, true);
  assert(fourGateExpanded.candidates.length > 0);
  assert(fourGateExpanded.candidates.length <= tools.MAX_EXPANDED_PORTAL_CANDIDATES);
  const fourGateCandidate = fourGateExpanded.candidates[0];
  assert.strictEqual(fourGateCandidate.portalCells.length, 4);
  assert.strictEqual(new Set(fourGateCandidate.portalCells).size, 4);
  assert.strictEqual(fourGateCandidate.paths.length, 10);
  assert.strictEqual(fourGateCandidate.paths.filter(path => path.segments.length === 2).length, 2);
  assert.strictEqual(tools.validatePathCover(fourGate.brief, fourGateCandidate).ok, true);
  const compiledFourGate = tools.compileCandidate(fourGate.brief, fourGateCandidate);
  assert.deepStrictEqual(compiledFourGate.level.Portals,
    [{ Id: 'P1', Cells: fourGateCandidate.portalCells }]);
  assert.strictEqual(compiledFourGate.solution.filter(line =>
    line.Segments.some(segment => segment.Exit)).length, 2);
  const fourGateKey = tools.layoutKey(compiledFourGate.level);
  assert(fourGateKey.startsWith('8x10:'));
  assert(fourGateKey.split('@')[1].split(',').length === 4);
}

module.exports = run;
