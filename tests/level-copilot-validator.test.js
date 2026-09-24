'use strict';

const assert = require('assert');
const validator = require('../scripts/level-copilot/validator.js');
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

function gradeOneSixBySixCover() {
  return {
    schemaVersion: 1,
    designSummary: 'Three straight easy lines and one remainder path.',
    paths: [
      { cells: [0, 6, 12, 18, 24, 30] },
      { cells: [31, 25, 19, 13, 7, 1, 2, 8, 14, 20, 26, 32, 33, 27, 21, 15, 9, 3] },
      { cells: [4, 10, 16, 22, 28, 34] },
      { cells: [5, 11, 17, 23, 29, 35] }
    ]
  };
}

function rowCover(width, height) {
  return {
    schemaVersion: 1,
    designSummary: `${width} by ${height} row cover.`,
    paths: Array.from({ length: height }, (_, row) => ({
      cells: Array.from({ length: width }, (_, column) => row * width + column)
    }))
  };
}

function dependencies(overrides) {
  return Object.assign({ catalog: { levels: [] } }, overrides);
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
      designIntent: 'Portal validation fixture.'
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
    schemaVersion: 1,
    paths: Array.from({ length: 8 }, (_, row) => ({
      cells: Array.from({ length: 8 }, (_, column) => row * 8 + column)
    })),
    designSummary: 'Continuous rows for deterministic host splitting.'
  };
}

function longGradeFivePortalSeed() {
  const fixture = portalFixture('portal-8x8-02');
  const portalSegments = fixture.candidate.paths[0].segments;
  const bridge = fixture.candidate.paths[3].segments[0].cells;
  return {
    brief: fixture.brief,
    candidate: {
      schemaVersion: 1,
      paths: [
        { cells: portalSegments[0].cells.concat(bridge, portalSegments[1].cells) },
        { cells: fixture.candidate.paths[1].segments[0].cells.slice() },
        { cells: fixture.candidate.paths[2].segments[0].cells.slice() },
        { cells: fixture.candidate.paths[4].segments[0].cells.slice() }
      ],
      designSummary: 'Long grade-five seed fixture.'
    }
  };
}

function optimizableGradeFivePortalSeed() {
  return {
    schemaVersion: 1,
    paths: [
      { cells: [19, 18, 17, 9, 10, 11, 3, 2, 1, 0, 8, 16, 24, 25, 26, 27,
        35, 34, 33, 32, 40, 41, 42, 43] },
      { cells: [4, 5, 6, 7, 15, 14, 13, 12, 20, 21, 22, 23, 31, 30] },
      { cells: [28, 29, 37, 36, 44, 45, 46, 38, 39, 47, 55, 54, 53] },
      { cells: [63, 62, 61, 60, 52, 51, 50, 49, 48, 56, 57, 58, 59] }
    ],
    designSummary: 'Valid seed that needs bounded tail exchange to reach grade five.'
  };
}

function fourGatePortalSeed() {
  return {
    schemaVersion: 1,
    paths: [
      { cells: [0, 8, 9, 1, 2, 10, 11, 3, 4, 12, 13, 5, 6, 14, 15, 7] },
      { cells: [16, 24, 25, 17, 18, 26, 27, 19, 20, 28, 29, 21, 22, 30, 31, 23] }
    ].concat(Array.from({ length: 6 }, (_, row) => ({
      cells: Array.from({ length: 8 }, (_, column) => (row + 4) * 8 + column)
    }))),
    designSummary: 'Eight by ten seed with two deterministic Portal splits.'
  };
}

function run() {
  const input = cover();
  const before = JSON.stringify(input);
  const result = validator.validateCandidate(brief, input, { dependencies: dependencies() });
  assert.strictEqual(result.status, 'reviewable');
  assert.strictEqual(result.report.checks.runtime, 'passed');
  assert.strictEqual(result.report.checks.solver, 'solved');
  assert.strictEqual(result.report.difficulty.grade, 1);
  assert.strictEqual(JSON.stringify(input), before, 'validator must not mutate candidate input');

  const capacityResult = validator.validateCandidate({
    schemaVersion: 1,
    mechanic: 'ordinary',
    width: 6,
    height: 6,
    colorCount: 4,
    targetGrade: 1,
    designIntent: 'Capacity feasibility fixture.'
  }, gradeOneSixBySixCover(), { dependencies: dependencies() });
  assert.strictEqual(capacityResult.status, 'reviewable');
  assert.strictEqual(capacityResult.report.difficulty.score, 19.9);
  assert.strictEqual(capacityResult.report.difficulty.easyLines, 3);
  assert.strictEqual(capacityResult.report.difficulty.competingColors, 0);

  for (const dimensions of [
    { width: 7, height: 7 },
    { width: 8, height: 8 },
    { width: 8, height: 10 }
  ]) {
    const large = validator.validateCandidate({
      schemaVersion: 1,
      mechanic: 'ordinary',
      width: dimensions.width,
      height: dimensions.height,
      colorCount: dimensions.height,
      targetGrade: 1,
      designIntent: 'Large-board deterministic validation fixture.'
    }, rowCover(dimensions.width, dimensions.height), { dependencies: dependencies() });
    assert.strictEqual(large.status, 'reviewable', `${dimensions.width}x${dimensions.height}`);
    assert.strictEqual(large.report.checks.runtime, 'passed');
    assert.strictEqual(large.report.checks.solver, 'solved');
    assert.strictEqual(large.report.difficulty.grade, 1);
    assert(large.layoutKey.startsWith(`${dimensions.width}x${dimensions.height}:`));
  }

  const duplicateCatalog = { levels: [{ setIndex: 1, levelIndex: 2, game: Object.assign({
    Id: 'existing-5x5', Name: 'Existing'
  }, result.level) }] };
  const duplicate = validator.validateCandidate(brief, cover(), {
    dependencies: dependencies({ catalog: duplicateCatalog })
  });
  assert.strictEqual(duplicate.report.errorCodes[0], 'LAYOUT_DUPLICATE');
  assert.deepStrictEqual(duplicate.report.details.existing, {
    setIndex: 1, levelIndex: 2, id: 'existing-5x5', name: 'Existing'
  });
  const repeat = validator.validateCandidate(brief, cover(), {
    dependencies: dependencies(), previousLayoutKeys: [result.layoutKey]
  });
  assert.strictEqual(repeat.report.errorCodes[0], 'CANDIDATE_REPEAT');

  const limited = validator.validateCandidate(brief, cover(), {
    dependencies: dependencies({ solveWithoutPortals: () => ({ status: 'limit', paths: null, states: 250001 }) })
  });
  assert.strictEqual(limited.status, 'reviewable');
  assert.strictEqual(limited.report.checks.solver, 'limit');
  assert.deepStrictEqual(limited.report.warnings, ['SOLVER_INCONCLUSIVE']);
  for (const status of ['invalid', 'unsatisfiable']) {
    const failed = validator.validateCandidate(brief, cover(), {
      dependencies: dependencies({ solveWithoutPortals: () => ({ status, paths: null, states: 1 }) })
    });
    assert.strictEqual(failed.status, 'failed');
    assert.strictEqual(failed.report.retryable, false);
    assert.strictEqual(failed.report.errorCodes[0], status === 'invalid' ? 'SOLVER_INVALID' : 'SOLVER_CONTRADICTION');
  }
  const malformedSolved = validator.validateCandidate(brief, cover(), {
    dependencies: dependencies({ solveWithoutPortals: () => ({ status: 'solved', paths: null, states: 1 }) })
  });
  assert.strictEqual(malformedSolved.report.errorCodes[0], 'SOLVER_INVALID');
  const solverThrows = validator.validateCandidate(brief, cover(), {
    dependencies: dependencies({ solveWithoutPortals: () => { throw new Error('internal'); } })
  });
  assert.strictEqual(solverThrows.status, 'failed');
  assert.strictEqual(solverThrows.report.errorCodes[0], 'SOLVER_INVALID');

  const low = validator.validateCandidate(Object.assign({}, brief, { targetGrade: 2 }), cover(), {
    dependencies: dependencies({ evaluateDifficulty: () => ({ grade: 1, score: 10 }) })
  });
  assert.strictEqual(low.report.errorCodes[0], 'DIFFICULTY_TOO_LOW');
  assert.strictEqual(low.report.details.layoutKey, low.layoutKey);
  const high = validator.validateCandidate(brief, cover(), {
    dependencies: dependencies({ evaluateDifficulty: () => ({ grade: 2, score: 25 }) })
  });
  assert.strictEqual(high.report.errorCodes[0], 'DIFFICULTY_TOO_HIGH');
  assert.strictEqual(high.report.details.layoutKey, high.layoutKey);
  const malformedDifficulty = validator.validateCandidate(brief, cover(), {
    dependencies: dependencies({ evaluateDifficulty: () => ({ grade: 1, score: NaN }) })
  });
  assert.strictEqual(malformedDifficulty.status, 'failed');
  assert.strictEqual(malformedDifficulty.report.errorCodes[0], 'DIFFICULTY_EVALUATION_FAILED');

  class ThrowingRunner {
    constructor() { throw new Error('internal'); }
  }
  ThrowingRunner.OUTCOME = { WON: 'won' };
  const runtimeThrows = validator.validateCandidate(brief, cover(), {
    dependencies: dependencies({ GameRunner: ThrowingRunner })
  });
  assert.strictEqual(runtimeThrows.status, 'failed');
  assert.strictEqual(runtimeThrows.report.errorCodes[0], 'RUNTIME_VALIDATOR_FAILED');

  class RejectingRunner {
    touchStart() { return false; }
    remainingCellCount() { return 25; }
  }
  RejectingRunner.OUTCOME = { WON: 'won' };
  const runtime = validator.validateCandidate(brief, cover(), {
    dependencies: dependencies({ GameRunner: RejectingRunner })
  });
  assert.strictEqual(runtime.report.errorCodes[0], 'RUNTIME_REPLAY_REJECTED');
  assert.strictEqual(runtime.report.checks.solver, 'pending');

  const bad = cover(); bad.paths[0].cells.pop();
  const staticFailure = validator.validateCandidate(brief, bad, { dependencies: dependencies() });
  assert.strictEqual(staticFailure.report.errorCodes[0], 'CANDIDATE_COVERAGE_MISSING');
  assert.strictEqual(staticFailure.report.checks.runtime, 'pending');

  for (const [id, classification, grade] of [
    ['recovery-8x8-40', 'required', 2],
    ['portal-8x8-01', 'required', 4],
    ['portal-8x8-02', 'optional_complex', 5]
  ]) {
    const fixture = portalFixture(id);
    const portalResult = validator.validateCandidate(fixture.brief, fixture.candidate, {
      dependencies: dependencies()
    });
    assert.strictEqual(portalResult.status, 'reviewable', id);
    assert.strictEqual(portalResult.report.checks.runtime, 'passed');
    assert.strictEqual(portalResult.report.checks.solver, 'solved');
    assert.strictEqual(portalResult.report.solver.classification, classification);
    assert.strictEqual(portalResult.report.difficulty.grade, grade);
    assert(portalResult.layoutKey.includes('@'));
  }

  const portal = portalFixture('recovery-8x8-40');
  const acceptedPortal = validator.validateCandidate(portal.brief, portal.candidate, {
    dependencies: dependencies()
  });
  const portalDuplicate = validator.validateCandidate(portal.brief, portal.candidate, {
    dependencies: dependencies({ catalog: { levels: [{
      setIndex: 4,
      levelIndex: 0,
      game: Object.assign({ Id: 'existing-portal', Name: 'Existing Portal' },
        acceptedPortal.level)
    }] } })
  });
  assert.strictEqual(portalDuplicate.report.errorCodes[0], 'LAYOUT_DUPLICATE');

  const portalValidationFailure = validator.validateCandidate(portal.brief, portal.candidate, {
    dependencies: dependencies({
      portalValidation: { validatePortalLevel: () => ({ ok: false, errors: ['fixture-error'] }) }
    })
  });
  assert.strictEqual(portalValidationFailure.report.errorCodes[0], 'PORTAL_VALIDATION_FAILED');
  assert.deepStrictEqual(portalValidationFailure.report.details.errors, ['fixture-error']);

  const solved = { status: 'solved', paths: [[0, 1]], states: 1 };
  const cheapBypass = validator.validateCandidate(portal.brief, portal.candidate, {
    dependencies: dependencies({ solveWithoutPortals: () => solved })
  });
  assert.strictEqual(cheapBypass.status, 'rejected');
  assert.strictEqual(cheapBypass.report.errorCodes[0], 'PORTAL_BYPASS_TOO_CHEAP');
  assert.strictEqual(cheapBypass.report.retryable, true);

  const inconclusivePortal = validator.validateCandidate(portal.brief, portal.candidate, {
    dependencies: dependencies({
      solveWithoutPortals: () => ({ status: 'limit', paths: null, states: 250001 })
    })
  });
  assert.strictEqual(inconclusivePortal.status, 'rejected');
  assert.strictEqual(inconclusivePortal.report.errorCodes[0], 'PORTAL_BYPASS_INCONCLUSIVE');

  const invalidPortalSolver = validator.validateCandidate(portal.brief, portal.candidate, {
    dependencies: dependencies({
      solveWithoutPortals: () => ({ status: 'invalid', paths: null, states: 0 })
    })
  });
  assert.strictEqual(invalidPortalSolver.status, 'failed');
  assert.strictEqual(invalidPortalSolver.report.errorCodes[0], 'SOLVER_INVALID');

  const seedBrief = {
    schemaVersion: 1,
    mechanic: 'portal',
    width: 8,
    height: 8,
    colorCount: 9,
    targetGrade: 2,
    designIntent: 'Portal seed expansion fixture.'
  };
  const expandedSeed = validator.validateCandidate(seedBrief, portalSeed(), {
    dependencies: dependencies({
      solveWithoutPortals: () => ({ status: 'unsatisfiable', paths: null, states: 10 }),
      evaluateDifficulty: () => ({ grade: 2, score: 30 })
    })
  });
  assert.strictEqual(expandedSeed.status, 'reviewable');
  assert.strictEqual(expandedSeed.level.Mechanic, 'portal');
  assert.strictEqual(expandedSeed.level.Lines.length, 9);
  assert.strictEqual(expandedSeed.solution.filter(line => line.Segments.length === 2).length, 1);
  assert.strictEqual(expandedSeed.report.solver.classification, 'required');

  const longSeed = longGradeFivePortalSeed();
  assert(longSeed.candidate.paths[0].cells.length > Math.floor(64 * 0.35));
  const expandedLongSeed = validator.validateCandidate(longSeed.brief, longSeed.candidate, {
    dependencies: dependencies()
  });
  assert.strictEqual(expandedLongSeed.status, 'reviewable');
  assert.strictEqual(expandedLongSeed.report.difficulty.grade, 5);
  assert.strictEqual(expandedLongSeed.report.solver.classification, 'optional_complex');

  // Keep the search fixture independent of host CPU speed; seed bounds are
  // asserted below and wall-clock cutoff belongs to the runtime limit.
  const optimizedSeed = validator.validateCandidate({
    schemaVersion: 1,
    mechanic: 'portal',
    width: 8,
    height: 8,
    colorCount: 5,
    targetGrade: 5,
    designIntent: 'Optimizer fixture.'
  }, optimizableGradeFivePortalSeed(), { clock: () => 0 });
  assert.strictEqual(optimizedSeed.status, 'reviewable');
  assert.strictEqual(optimizedSeed.report.difficulty.grade, 5);
  assert.strictEqual(optimizedSeed.report.solver.classification, 'required');
  assert.strictEqual(optimizedSeed.report.portalSeedOptimization.method, 'bounded_tail_exchange');
  assert.strictEqual(optimizedSeed.report.portalSeedOptimization.depth, 5);
  assert(optimizedSeed.report.portalSeedOptimization.evaluatedSeedCount <=
    validator.PORTAL_SEED_SEARCH_LIMITS.maxSeeds);

  const fourGateBrief = {
    schemaVersion: 1,
    mechanic: 'portal',
    width: 8,
    height: 10,
    colorCount: 10,
    targetGrade: 3,
    designIntent: 'Four-gate eight by ten validation fixture.',
    portalCellCount: 4
  };
  const fourGateResult = validator.validateCandidate(fourGateBrief, fourGatePortalSeed(), {
    dependencies: dependencies({
      solveWithoutPortals: () => ({ status: 'unsatisfiable', paths: null, states: 10 }),
      evaluateDifficulty: () => ({ grade: 3, score: 50 })
    })
  });
  assert.strictEqual(fourGateResult.status, 'reviewable');
  assert.strictEqual(fourGateResult.level.Width, 8);
  assert.strictEqual(fourGateResult.level.Height, 10);
  assert.strictEqual(fourGateResult.level.Portals[0].Cells.length, 4);
  assert.strictEqual(fourGateResult.solution.filter(line =>
    line.Segments.some(segment => segment.Exit)).length, 2);
  assert.strictEqual(fourGateResult.report.checks.runtime, 'passed');
  assert.strictEqual(fourGateResult.report.solver.classification, 'required');

  const bypassCalls = [];
  const bypass = validator.portalBypassAudit(
    fourGateResult.level, fourGateResult.solution, level => {
      bypassCalls.push(level);
      return bypassCalls.length === 1
        ? { status: 'solved', paths: [[0, 1]], states: 1 }
        : { status: 'unsatisfiable', paths: null, states: 1 };
    });
  assert.strictEqual(bypass.status, 'passed');
  assert.strictEqual(bypass.classification, 'optional_complex');
  assert(bypass.localChecks.some(check => check.movingLines.length === 2 &&
    fourGateResult.solution.every((line, lineIndex) =>
      !line.Segments.some(segment => segment.Exit) || check.movingLines.includes(lineIndex))));
  const gates = new Set(fourGateResult.level.Portals[0].Cells);
  bypassCalls.slice(1).forEach(level => {
    assert((level.Blocked || []).every(cell => !gates.has(cell)));
  });
}

module.exports = run;
