'use strict';

const candidateTools = require('./candidate.js');
const catalog = require('../../data/catalog-v2.js');
const GameRunner = require('../../core/game-runner.js');
const solveWithoutPortals = require('../solve-no-portal.js');
const evaluateDifficulty = require('../evaluate-level-difficulty.js');

const ERROR_CODES = Object.freeze({
  CANDIDATE_REPEAT: 'CANDIDATE_REPEAT',
  LAYOUT_DUPLICATE: 'LAYOUT_DUPLICATE',
  RUNTIME_REPLAY_REJECTED: 'RUNTIME_REPLAY_REJECTED',
  RUNTIME_NOT_WON: 'RUNTIME_NOT_WON',
  RUNTIME_VALIDATOR_FAILED: 'RUNTIME_VALIDATOR_FAILED',
  SOLVER_INVALID: 'SOLVER_INVALID',
  SOLVER_CONTRADICTION: 'SOLVER_CONTRADICTION',
  SOLVER_INCONCLUSIVE: 'SOLVER_INCONCLUSIVE',
  DIFFICULTY_TOO_LOW: 'DIFFICULTY_TOO_LOW',
  DIFFICULTY_TOO_HIGH: 'DIFFICULTY_TOO_HIGH',
  DIFFICULTY_EVALUATION_FAILED: 'DIFFICULTY_EVALUATION_FAILED'
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseReport(targetGrade) {
  return {
    schemaVersion: 1,
    status: 'rejected',
    retryable: true,
    errorCodes: [],
    warnings: [],
    checks: {
      schema: 'pending',
      staticRules: 'pending',
      duplicate: 'pending',
      runtime: 'pending',
      solver: 'pending',
      difficulty: 'pending'
    },
    difficulty: { targetGrade, actualGrade: null, score: null }
  };
}

function reject(report, code, check, retryable, details) {
  report.status = retryable === false ? 'failed' : 'rejected';
  report.retryable = retryable !== false;
  report.errorCodes.push(code);
  if (check) report.checks[check] = 'failed';
  if (details) report.details = details;
  return { status: report.status, report };
}

function ordinaryCatalogEntries(inputCatalog) {
  return (inputCatalog.levels || []).filter(entry => {
    const game = entry && entry.game;
    return game && !game.Mechanic && game.IceCells === undefined;
  });
}

function findDuplicate(level, inputCatalog) {
  const key = candidateTools.layoutKey(level);
  const match = ordinaryCatalogEntries(inputCatalog).find(entry =>
    entry.game.Width === level.Width && entry.game.Height === level.Height &&
    candidateTools.layoutKey(entry.game) === key);
  return {
    layoutKey: key,
    match: match ? {
      setIndex: match.setIndex,
      levelIndex: match.levelIndex,
      id: match.game.Id || null,
      name: match.game.Name || null
    } : null
  };
}

function replay(level, solution, Runner) {
  const runner = new Runner(clone(level), []);
  for (let pathIndex = 0; pathIndex < solution.length; pathIndex += 1) {
    const path = solution[pathIndex];
    if (!runner.touchStart(path[0])) return { ok: false, pathIndex, action: 'start', cell: path[0] };
    for (let index = 1; index < path.length; index += 1) {
      if (!runner.touchMove(path[index])) return { ok: false, pathIndex, action: 'move', cell: path[index] };
    }
    if (!runner.touchEnd(path[path.length - 1])) {
      return { ok: false, pathIndex, action: 'end', cell: path[path.length - 1] };
    }
  }
  return {
    ok: runner.outcome === Runner.OUTCOME.WON && runner.remainingCellCount() === 0,
    outcome: runner.outcome,
    remainingCellCount: runner.remainingCellCount()
  };
}

function validateCandidate(brief, input, options) {
  const deps = Object.assign({
    catalog,
    GameRunner,
    solveWithoutPortals,
    evaluateDifficulty
  }, options && options.dependencies);
  const report = baseReport(brief.targetGrade);
  const staticResult = candidateTools.validatePathCover(brief, input);
  if (!staticResult.ok) {
    report.checks.schema = staticResult.error.code.indexOf('SCHEMA') >= 0 ||
      staticResult.error.code.indexOf('PATH_COUNT') >= 0 ? 'failed' : 'passed';
    report.checks.staticRules = report.checks.schema === 'failed' ? 'skipped' : 'failed';
    return Object.assign(reject(report, staticResult.error.code,
      report.checks.schema === 'failed' ? 'schema' : 'staticRules', true,
      staticResult.error.details), { compiled: null, solution: null, layoutKey: null });
  }
  report.checks.schema = 'passed';
  report.checks.staticRules = 'passed';
  const compiled = candidateTools.compileCandidate(brief, input);
  const duplicate = findDuplicate(compiled.level, deps.catalog);
  if (options && Array.isArray(options.previousLayoutKeys) &&
      options.previousLayoutKeys.indexOf(duplicate.layoutKey) >= 0) {
    return Object.assign(reject(report, ERROR_CODES.CANDIDATE_REPEAT, 'duplicate', true,
      { layoutKey: duplicate.layoutKey }), compiled, { layoutKey: duplicate.layoutKey });
  }
  if (duplicate.match) {
    return Object.assign(reject(report, ERROR_CODES.LAYOUT_DUPLICATE, 'duplicate', true,
      { layoutKey: duplicate.layoutKey, existing: duplicate.match }), compiled,
    { layoutKey: duplicate.layoutKey });
  }
  report.checks.duplicate = 'passed';
  let runtime;
  try {
    runtime = replay(compiled.level, compiled.solution, deps.GameRunner);
  } catch (error) {
    return Object.assign(reject(report, ERROR_CODES.RUNTIME_VALIDATOR_FAILED,
      'runtime', false), compiled, { layoutKey: duplicate.layoutKey });
  }
  if (!runtime.ok) {
    const code = runtime.action ? ERROR_CODES.RUNTIME_REPLAY_REJECTED : ERROR_CODES.RUNTIME_NOT_WON;
    return Object.assign(reject(report, code, 'runtime', true, runtime), compiled,
      { layoutKey: duplicate.layoutKey });
  }
  report.checks.runtime = 'passed';
  let solver;
  try {
    solver = deps.solveWithoutPortals(clone(compiled.level), { maxStates: 250000 });
  } catch (error) {
    return Object.assign(reject(report, ERROR_CODES.SOLVER_INVALID, 'solver', false), compiled,
      { layoutKey: duplicate.layoutKey });
  }
  report.solver = clone(solver);
  if (!solver || solver.status === 'invalid') {
    return Object.assign(reject(report, ERROR_CODES.SOLVER_INVALID, 'solver', false), compiled,
      { layoutKey: duplicate.layoutKey });
  }
  if (solver.status === 'unsatisfiable') {
    return Object.assign(reject(report, ERROR_CODES.SOLVER_CONTRADICTION, 'solver', false), compiled,
      { layoutKey: duplicate.layoutKey });
  }
  if (solver.status === 'limit') {
    report.checks.solver = 'limit';
    report.warnings.push(ERROR_CODES.SOLVER_INCONCLUSIVE);
  } else if (solver.status === 'solved' && Array.isArray(solver.paths)) {
    report.checks.solver = 'solved';
  } else {
    return Object.assign(reject(report, ERROR_CODES.SOLVER_INVALID, 'solver', false), compiled,
      { layoutKey: duplicate.layoutKey });
  }
  let difficulty;
  try {
    difficulty = deps.evaluateDifficulty(clone(compiled.level), clone(compiled.solution));
  } catch (error) {
    return Object.assign(reject(report, ERROR_CODES.DIFFICULTY_EVALUATION_FAILED,
      'difficulty', false), compiled, { layoutKey: duplicate.layoutKey });
  }
  if (!difficulty || !Number.isInteger(difficulty.grade) || difficulty.grade < 1 || difficulty.grade > 5 ||
      !Number.isFinite(difficulty.score)) {
    return Object.assign(reject(report, ERROR_CODES.DIFFICULTY_EVALUATION_FAILED,
      'difficulty', false), compiled, { layoutKey: duplicate.layoutKey });
  }
  report.difficulty = Object.assign({}, clone(difficulty), {
    targetGrade: brief.targetGrade,
    actualGrade: difficulty.grade
  });
  if (difficulty.grade !== brief.targetGrade) {
    const code = difficulty.grade < brief.targetGrade
      ? ERROR_CODES.DIFFICULTY_TOO_LOW : ERROR_CODES.DIFFICULTY_TOO_HIGH;
    return Object.assign(reject(report, code, 'difficulty', true,
      { layoutKey: duplicate.layoutKey }), compiled,
      { layoutKey: duplicate.layoutKey });
  }
  report.checks.difficulty = 'passed';
  report.status = 'reviewable';
  report.retryable = false;
  return {
    status: 'reviewable',
    report,
    level: compiled.level,
    solution: compiled.solution,
    layoutKey: duplicate.layoutKey
  };
}

module.exports = {
  ERROR_CODES,
  validateCandidate,
  findDuplicate,
  replay
};
