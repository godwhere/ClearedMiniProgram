'use strict';

const candidateTools = require('./candidate.js');
const catalog = require('../../data/catalog-v2.js');
const GameRunner = require('../../core/game-runner.js');
const portalValidation = require('../../core/portal-validation.js');
const solveWithoutPortals = require('../solve-no-portal.js');
const evaluateDifficulty = require('../evaluate-level-difficulty.js');

const PORTAL_SEED_SEARCH_LIMITS = Object.freeze({
  maxDepth: 5,
  beamWidth: 100,
  maxSeeds: 1600,
  maxExactValidations: 12,
  maxDurationMs: 20000
});

const ERROR_CODES = Object.freeze({
  CANDIDATE_REPEAT: 'CANDIDATE_REPEAT',
  LAYOUT_DUPLICATE: 'LAYOUT_DUPLICATE',
  RUNTIME_REPLAY_REJECTED: 'RUNTIME_REPLAY_REJECTED',
  RUNTIME_NOT_WON: 'RUNTIME_NOT_WON',
  RUNTIME_VALIDATOR_FAILED: 'RUNTIME_VALIDATOR_FAILED',
  PORTAL_VALIDATION_FAILED: 'PORTAL_VALIDATION_FAILED',
  PORTAL_BYPASS_TOO_CHEAP: 'PORTAL_BYPASS_TOO_CHEAP',
  PORTAL_BYPASS_INCONCLUSIVE: 'PORTAL_BYPASS_INCONCLUSIVE',
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

function catalogEntries(level, inputCatalog) {
  const portal = level.Mechanic === 'portal';
  return (inputCatalog.levels || []).filter(entry => {
    const game = entry && entry.game;
    return game && (portal ? game.Mechanic === 'portal' :
      !game.Mechanic && game.IceCells === undefined && game.Portals === undefined);
  });
}

function findDuplicate(level, inputCatalog) {
  const key = candidateTools.layoutKey(level);
  const match = catalogEntries(level, inputCatalog).find(entry =>
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
    const segments = Array.isArray(solution[pathIndex])
      ? [{ Cells: solution[pathIndex] }] : solution[pathIndex].Segments;
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
      const path = segments[segmentIndex].Cells;
      if (!runner.touchStart(path[0])) {
        return { ok: false, pathIndex, segmentIndex, action: 'start', cell: path[0] };
      }
      for (let index = 1; index < path.length; index += 1) {
        if (!runner.touchMove(path[index])) {
          return { ok: false, pathIndex, segmentIndex, action: 'move', cell: path[index] };
        }
      }
      const expected = segmentIndex === segments.length - 1;
      if (runner.touchEnd(path[path.length - 1]) !== expected) {
        return { ok: false, pathIndex, segmentIndex, action: 'end', cell: path[path.length - 1] };
      }
    }
  }
  return {
    ok: runner.outcome === Runner.OUTCOME.WON && runner.remainingCellCount() === 0,
    outcome: runner.outcome,
    remainingCellCount: runner.remainingCellCount()
  };
}

function flattenedSolutionLine(line) {
  if (Array.isArray(line)) return line.slice();
  return line.Segments.reduce((cells, segment) => cells.concat(segment.Cells), []);
}

function portalBypassAudit(level, solution, solver) {
  const solve = target => solver(clone(target), { maxStates: 250000 });
  const base = solve(level);
  if (!base || base.status === 'invalid' ||
      (base.status === 'solved' && !Array.isArray(base.paths))) {
    return { status: 'failed', errorCode: ERROR_CODES.SOLVER_INVALID, base };
  }
  if (base.status === 'limit') {
    return {
      status: 'rejected',
      errorCode: ERROR_CODES.PORTAL_BYPASS_INCONCLUSIVE,
      classification: 'unknown',
      base
    };
  }
  if (base.status === 'unsatisfiable') {
    return { status: 'passed', classification: 'required', base, localChecks: [] };
  }
  if (base.status !== 'solved') {
    return { status: 'failed', errorCode: ERROR_CODES.SOLVER_INVALID, base };
  }

  const portalLine = solution.findIndex(line =>
    line && Array.isArray(line.Segments) && line.Segments.some(segment => segment.Exit));
  if (portalLine < 0) {
    return { status: 'failed', errorCode: ERROR_CODES.SOLVER_INVALID, base };
  }
  const paths = solution.map(flattenedSolutionLine);
  const localChecks = [];
  for (let other = -1; other < level.Lines.length; other += 1) {
    if (other === portalLine) continue;
    const moving = other < 0 ? [portalLine] : [portalLine, other];
    const movingSet = new Set(moving);
    const fixedCells = paths.reduce((cells, path, index) =>
      movingSet.has(index) ? cells : cells.concat(path), []);
    const reduced = Object.assign({}, level, {
      Lines: moving.map(index => level.Lines[index]),
      Blocked: fixedCells
    });
    const result = solve(reduced);
    localChecks.push({ movingLines: moving, status: result && result.status || 'invalid',
      states: result && Number.isInteger(result.states) ? result.states : null });
    if (!result || result.status === 'invalid' ||
        (result.status === 'solved' && !Array.isArray(result.paths))) {
      return { status: 'failed', errorCode: ERROR_CODES.SOLVER_INVALID,
        classification: 'unknown', base, localChecks };
    }
    if (result.status === 'limit') {
      return { status: 'rejected', errorCode: ERROR_CODES.PORTAL_BYPASS_INCONCLUSIVE,
        classification: 'unknown', base, localChecks };
    }
    if (result.status === 'solved') {
      return { status: 'rejected', errorCode: ERROR_CODES.PORTAL_BYPASS_TOO_CHEAP,
        classification: 'cheap_bypass', base, localChecks, witness: result.paths };
    }
    if (result.status !== 'unsatisfiable') {
      return { status: 'failed', errorCode: ERROR_CODES.SOLVER_INVALID,
        classification: 'unknown', base, localChecks };
    }
  }
  return { status: 'passed', classification: 'optional_complex', base, localChecks };
}

function validateDirectCandidate(brief, input, options) {
  const deps = Object.assign({
    catalog,
    GameRunner,
    portalValidation,
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
  if (brief.mechanic === 'portal') {
    let portalResult;
    try {
      portalResult = deps.portalValidation.validatePortalLevel(compiled.level, {
        solution: compiled.solution,
        requireSolution: true
      });
    } catch (error) {
      return Object.assign(reject(report, ERROR_CODES.RUNTIME_VALIDATOR_FAILED,
        'staticRules', false), compiled, { layoutKey: null });
    }
    if (!portalResult || !portalResult.ok) {
      return Object.assign(reject(report, ERROR_CODES.PORTAL_VALIDATION_FAILED,
        'staticRules', true, { errors: portalResult && portalResult.errors || [] }),
      compiled, { layoutKey: null });
    }
  }
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
    solver = brief.mechanic === 'portal'
      ? portalBypassAudit(compiled.level, compiled.solution, deps.solveWithoutPortals)
      : deps.solveWithoutPortals(clone(compiled.level), { maxStates: 250000 });
  } catch (error) {
    return Object.assign(reject(report, ERROR_CODES.SOLVER_INVALID, 'solver', false), compiled,
      { layoutKey: duplicate.layoutKey });
  }
  report.solver = clone(solver);
  if (brief.mechanic === 'portal') {
    if (!solver || solver.status === 'failed') {
      return Object.assign(reject(report, solver && solver.errorCode || ERROR_CODES.SOLVER_INVALID,
        'solver', false), compiled, { layoutKey: duplicate.layoutKey });
    }
    if (solver.status === 'rejected') {
      return Object.assign(reject(report, solver.errorCode, 'solver', true,
        { layoutKey: duplicate.layoutKey, classification: solver.classification }), compiled,
      { layoutKey: duplicate.layoutKey });
    }
    if (solver.status !== 'passed' ||
        (solver.classification !== 'required' && solver.classification !== 'optional_complex')) {
      return Object.assign(reject(report, ERROR_CODES.SOLVER_INVALID, 'solver', false), compiled,
        { layoutKey: duplicate.layoutKey });
    }
    report.checks.solver = 'solved';
  } else {
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

function invalidSeedResult(brief, error) {
  const report = baseReport(brief.targetGrade);
  report.checks.schema = error.code.indexOf('SCHEMA') >= 0 ||
    error.code.indexOf('PATH_COUNT') >= 0 ? 'failed' : 'passed';
  report.checks.staticRules = report.checks.schema === 'failed' ? 'skipped' : 'failed';
  return Object.assign(reject(report, error.code,
    report.checks.schema === 'failed' ? 'schema' : 'staticRules', true, error.details), {
    compiled: null,
    solution: null,
    layoutKey: null
  });
}

function scorePortalSeed(brief, input, score) {
  const expanded = candidateTools.expandPortalSeedCandidates(brief, input);
  if (!expanded.ok) return { error: expanded.error, ranked: [] };
  const centers = { 2: 30, 3: 50, 4: 66.5, 5: 81 };
  const ranked = expanded.candidates.map((candidate, index) => {
    try {
      const compiled = candidateTools.compileCandidate(brief, candidate);
      const difficulty = score(compiled.level, compiled.solution);
      return { candidate, index, difficulty };
    } catch (error) {
      return { candidate, index, difficulty: null };
    }
  }).sort((one, two) => {
    const oneGrade = one.difficulty && one.difficulty.grade;
    const twoGrade = two.difficulty && two.difficulty.grade;
    const oneDistance = Number.isInteger(oneGrade) ? Math.abs(oneGrade - brief.targetGrade) : 99;
    const twoDistance = Number.isInteger(twoGrade) ? Math.abs(twoGrade - brief.targetGrade) : 99;
    if (oneDistance !== twoDistance) return oneDistance - twoDistance;
    const center = centers[brief.targetGrade];
    const oneScore = one.difficulty && Number.isFinite(one.difficulty.score)
      ? Math.abs(one.difficulty.score - center) : Infinity;
    const twoScore = two.difficulty && Number.isFinite(two.difficulty.score)
      ? Math.abs(two.difficulty.score - center) : Infinity;
    return oneScore !== twoScore ? oneScore - twoScore : one.index - two.index;
  });
  return { error: null, ranked };
}

function validateRankedPortalCandidates(brief, ranked, options, budget) {
  const exact = ranked.filter(item => item.difficulty &&
    item.difficulty.grade === brief.targetGrade);
  let last = null;
  for (const item of exact) {
    if (budget.count >= budget.maximum) break;
    budget.count += 1;
    const result = validateDirectCandidate(brief, item.candidate, options);
    if (result.status === 'reviewable' ||
        (result.status === 'failed' && result.report && result.report.retryable === false)) {
      return { terminal: result, last };
    }
    last = result;
  }
  return { terminal: null, last };
}

function highestPortalScore(ranked) {
  return ranked.reduce((best, item) => {
    const value = item.difficulty && item.difficulty.score;
    return Number.isFinite(value) && (!best || value > best.difficulty.score) ? item : best;
  }, null);
}

function validatePortalSeedCandidate(brief, input, options) {
  const score = options && options.dependencies && options.dependencies.evaluateDifficulty ||
    evaluateDifficulty;
  const initial = scorePortalSeed(brief, input, score);
  if (initial.error) return invalidSeedResult(brief, initial.error);
  if (!initial.ranked.length) {
    return invalidSeedResult(brief, {
      code: candidateTools.ERROR_CODES.CANDIDATE_PORTAL_SEED_UNSPLITTABLE,
      details: null
    });
  }
  if (brief.targetGrade !== 5) {
    const exact = initial.ranked.filter(item => item.difficulty &&
      item.difficulty.grade === brief.targetGrade);
    const attempts = (exact.length ? exact : initial.ranked.slice(0, 1)).slice(0, 12);
    let best = null;
    for (const item of attempts) {
      const result = validateDirectCandidate(brief, item.candidate, options);
      if (result.status === 'reviewable') return result;
      if (!best) best = result;
      if (result.status === 'failed' && result.report && result.report.retryable === false) {
        return result;
      }
    }
    return best;
  }

  const validationBudget = {
    count: 0,
    maximum: PORTAL_SEED_SEARCH_LIMITS.maxExactValidations
  };
  let checked = validateRankedPortalCandidates(
    brief, initial.ranked, options, validationBudget);
  if (checked.terminal) return checked.terminal;
  let bestRejected = checked.last;
  let bestScored = highestPortalScore(initial.ranked);
  const seen = new Set([candidateTools.portalSeedKey(input)]);
  let frontier = [{ seed: input, best: bestScored }];
  const now = options && typeof options.clock === 'function' ? options.clock : Date.now;
  const requestedDuration = options && Number.isInteger(options.maxOptimizationDurationMs)
    ? options.maxOptimizationDurationMs : PORTAL_SEED_SEARCH_LIMITS.maxDurationMs;
  const duration = Math.max(0, Math.min(
    requestedDuration, PORTAL_SEED_SEARCH_LIMITS.maxDurationMs));
  const deadline = now() + duration;

  search:
  for (let depth = 1; depth <= PORTAL_SEED_SEARCH_LIMITS.maxDepth &&
      seen.size < PORTAL_SEED_SEARCH_LIMITS.maxSeeds && now() < deadline; depth += 1) {
    const next = [];
    for (const parent of frontier) {
      for (const seed of candidateTools.portalSeedNeighbors(brief, parent.seed)) {
        if (seen.size >= PORTAL_SEED_SEARCH_LIMITS.maxSeeds || now() >= deadline) break search;
        const key = candidateTools.portalSeedKey(seed);
        if (seen.has(key)) continue;
        seen.add(key);
        const scored = scorePortalSeed(brief, seed, score);
        if (scored.error || !scored.ranked.length) continue;
        const best = highestPortalScore(scored.ranked);
        if (best && (!bestScored || best.difficulty.score > bestScored.difficulty.score)) {
          bestScored = best;
        }
        checked = validateRankedPortalCandidates(
          brief, scored.ranked, options, validationBudget);
        if (checked.terminal) {
          checked.terminal.report.portalSeedOptimization = {
            applied: true,
            method: 'bounded_tail_exchange',
            depth,
            evaluatedSeedCount: seen.size
          };
          return checked.terminal;
        }
        if (checked.last) bestRejected = checked.last;
        if (validationBudget.count >= validationBudget.maximum) break search;
        if (best) next.push({ seed, best, key });
      }
    }
    next.sort((one, two) => two.best.difficulty.score - one.best.difficulty.score);
    frontier = next.slice(0, PORTAL_SEED_SEARCH_LIMITS.beamWidth);
    if (!frontier.length) break;
  }
  if (bestRejected) return bestRejected;
  return bestScored
    ? validateDirectCandidate(brief, bestScored.candidate, options)
    : invalidSeedResult(brief, {
      code: candidateTools.ERROR_CODES.CANDIDATE_PORTAL_SEED_UNSPLITTABLE,
      details: null
    });
}

function validateCandidate(brief, input, options) {
  if (brief && brief.mechanic === 'portal' &&
      (!input || !Object.prototype.hasOwnProperty.call(input, 'portalCells'))) {
    return validatePortalSeedCandidate(brief, input, options);
  }
  return validateDirectCandidate(brief, input, options);
}

module.exports = {
  ERROR_CODES,
  PORTAL_SEED_SEARCH_LIMITS,
  validateCandidate,
  validateDirectCandidate,
  validatePortalSeedCandidate,
  findDuplicate,
  replay,
  portalBypassAudit
};
