'use strict';

const assert = require('assert');
const validator = require('../scripts/level-copilot/validator.js');

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

function dependencies(overrides) {
  return Object.assign({ catalog: { levels: [] } }, overrides);
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
}

module.exports = run;
