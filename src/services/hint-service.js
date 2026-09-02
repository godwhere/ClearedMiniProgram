'use strict';

const OrdinaryHintProvider = require('./hints/ordinary-hint-provider.js');
const PortalHintProvider = require('./hints/portal-hint-provider.js');
const portalSolution = require('../../core/portal-solution.js');

let defaultPortalSolutions = null;
try {
  defaultPortalSolutions = require('../../data/portal-solutions.js');
} catch (error) {
  defaultPortalSolutions = null;
}

function cloneData(value) {
  if (Array.isArray(value)) return value.map(cloneData);
  if (!value || typeof value !== 'object') return value;
  const copy = {};
  Object.keys(value).forEach(key => {
    if (typeof value[key] !== 'function') copy[key] = cloneData(value[key]);
  });
  return copy;
}

function normalizeFlatContext(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const hasFlatBoard = Number.isFinite(Number(raw.width)) &&
    Number.isFinite(Number(raw.height)) && Array.isArray(raw.lines);
  if (!hasFlatBoard) return null;
  let mechanic = raw.mechanic;
  if ((!mechanic || typeof mechanic !== 'object') && raw.portal && typeof raw.portal === 'object') {
    mechanic = Object.assign({ id: 'portal' }, raw.portal);
  }
  return {
    outcome: raw.outcome || 'playing',
    levelId: raw.levelId || null,
    board: {
      width: Number(raw.width),
      height: Number(raw.height),
      lines: raw.lines,
      blocked: raw.blocked,
      blockedMask: raw.blockedMask,
      owner: raw.owner,
      fixedLine: raw.fixedLine
    },
    completedLines: raw.completedLines,
    completedPaths: raw.completedPaths,
    selection: raw.selection,
    mechanic: mechanic || { id: null }
  };
}

function toHintContext(source) {
  if (!source || typeof source !== 'object') return null;
  let raw = source;
  if (typeof source.getViewState === 'function') {
    try {
      raw = source.getViewState();
    } catch (error) {
      return null;
    }
  }
  if (!raw || typeof raw !== 'object') return null;
  const normalized = raw.board && typeof raw.board === 'object'
    ? raw : normalizeFlatContext(raw);
  if (!normalized || !normalized.board) return null;
  return cloneData(normalized);
}

class HintService {
  constructor(solutionCatalog, dailySolutions, portalSolutions) {
    let ordinary = solutionCatalog;
    let daily = dailySolutions;
    let portals = portalSolutions;
    if (solutionCatalog && typeof solutionCatalog === 'object' &&
        (solutionCatalog.solutionCatalog || solutionCatalog.dailySolutions || solutionCatalog.portalSolutions)) {
      ordinary = solutionCatalog.solutionCatalog || solutionCatalog.solutions || null;
      daily = daily || solutionCatalog.dailySolutions;
      portals = portals || solutionCatalog.portalSolutions;
    }
    this.solutionCatalog = ordinary || null;
    this.dailySolutions = daily || null;
    this.portalSolutions = portals !== undefined ? portals : defaultPortalSolutions;
    this.ordinaryProvider = new OrdinaryHintProvider();
    this.portalProvider = new PortalHintProvider(this.ordinaryProvider);
  }

  solutionFor(setIndex, levelIndex) {
    if (!this.solutionCatalog) return null;
    const sets = this.solutionCatalog.sets || this.solutionCatalog;
    const levels = sets && sets[setIndex];
    const solution = levels && levels[levelIndex];
    return Array.isArray(solution) ? solution : null;
  }

  portalSolutionFor(levelId) {
    if (!this.portalSolutions || !levelId) return null;
    const byId = this.portalSolutions.ByLevelId || this.portalSolutions.byLevelId || this.portalSolutions;
    const solution = byId && byId[levelId];
    return Array.isArray(solution) ? solution : null;
  }

  find(source, setIndex, levelIndex) {
    const context = toHintContext(source);
    if (!context || (context.outcome && context.outcome !== 'playing')) return null;
    if (context.mechanic && context.mechanic.id === 'portal') {
      return this.portalProvider.find(context, this.portalSolutionFor(context.levelId));
    }
    return this.ordinaryProvider.find(context, this.solutionFor(setIndex, levelIndex));
  }

  findComplete(source, setIndex, levelIndex) {
    const context = toHintContext(source);
    if (!context || (context.outcome && context.outcome !== 'playing')) return null;
    if (context.mechanic && context.mechanic.id === 'portal') {
      return this.portalProvider.findComplete(
        context,
        this.portalSolutionFor(context.levelId)
      );
    }
    return this.ordinaryProvider.findComplete(
      context,
      this.solutionFor(setIndex, levelIndex)
    );
  }

  findPortalComplete(source) {
    const context = toHintContext(source);
    if (!context || (context.outcome && context.outcome !== 'playing')) return null;
    return this.portalProvider.findComplete(
      context,
      this.portalSolutionFor(context.levelId)
    );
  }

  findPortal(source) {
    const context = toHintContext(source);
    if (!context || (context.outcome && context.outcome !== 'playing')) return null;
    return this.portalProvider.find(context, this.portalSolutionFor(context.levelId));
  }

  pickStoredPortalPath(paths, source) {
    const context = toHintContext(source);
    return context ? this.portalProvider.pickStoredPortalPath(paths, context) : null;
  }

  normalizeStoredPortalLine(lineSolution) {
    return portalSolution.normalizeStoredPortalLine(lineSolution);
  }

  reverseStoredPortalLine(stored) {
    return portalSolution.reverseStoredPortalLine(stored);
  }

  flattenPortalSegments(segments) {
    return portalSolution.flattenPortalSegments(segments);
  }

  portalWaitContext(source, lineIndex) {
    const context = toHintContext(source);
    return context ? this.portalProvider.portalWaitContext(context, lineIndex) : null;
  }

  isStoredPortalPathUsable(source, lineIndex, candidate, options) {
    const context = toHintContext(source);
    return context
      ? this.portalProvider.isStoredPortalPathUsable(context, lineIndex, candidate, options)
      : false;
  }

  findAvailablePortalPath(source) {
    const context = toHintContext(source);
    return context ? this.portalProvider.findAvailablePortalPath(context) : null;
  }

  shortestPortalPath(source, lineIndex, start, end, isWait) {
    const context = toHintContext(source);
    return context
      ? this.portalProvider.shortestPortalPath(context, lineIndex, start, end, isWait)
      : null;
  }

  findDaily(source, challengeId, dailySolutions) {
    const context = toHintContext(source);
    if (!context || (context.outcome && context.outcome !== 'playing')) return null;
    if (challengeId && typeof challengeId === 'object' && dailySolutions === undefined) {
      dailySolutions = challengeId;
      challengeId = context.levelId;
    }
    if (!challengeId) challengeId = context.levelId;
    const stored = this.dailySolutionFor(
      challengeId,
      dailySolutions || this.dailySolutions
    );
    return this.ordinaryProvider.find(context, stored);
  }

  findDailyComplete(source, challengeId, dailySolutions) {
    const context = toHintContext(source);
    if (!context || (context.outcome && context.outcome !== 'playing')) return null;
    if (challengeId && typeof challengeId === 'object' && dailySolutions === undefined) {
      dailySolutions = challengeId;
      challengeId = context.levelId;
    }
    if (!challengeId) challengeId = context.levelId;
    const stored = this.dailySolutionFor(
      challengeId,
      dailySolutions || this.dailySolutions
    );
    if (context.mechanic && context.mechanic.id === 'portal') {
      return this.portalProvider.findComplete(context, stored);
    }
    return this.ordinaryProvider.findComplete(context, stored);
  }

  dailySolutionFor(challengeId, dailySolutions) {
    if (!challengeId) return null;
    const constructorDaily = this.solutionCatalog && !this.solutionCatalog.sets &&
      (this.solutionCatalog.ByChallengeId || this.solutionCatalog.byChallengeId)
      ? this.solutionCatalog
      : null;
    const source = dailySolutions || this.dailySolutions || constructorDaily;
    if (!source) return null;
    const map = source.ByChallengeId || source.byChallengeId || source;
    const paths = map && map[challengeId];
    return Array.isArray(paths) ? paths : null;
  }

  isPlayable(source, index) {
    const context = toHintContext(source);
    return !!context && this.ordinaryProvider.isPlayable(context, index);
  }

  pickStoredPath(paths, source, hintSource) {
    const context = toHintContext(source);
    return context
      ? this.ordinaryProvider.pickStoredPath(paths, context, hintSource)
      : null;
  }

  findAvailablePath(source) {
    const context = toHintContext(source);
    return context ? this.ordinaryProvider.findAvailablePath(context) : null;
  }

  shortestPath(source, lineIndex, start, end) {
    const context = toHintContext(source);
    return context
      ? this.ordinaryProvider.shortestPath(context, lineIndex, start, end)
      : null;
  }
}

HintService.toHintContext = toHintContext;

module.exports = HintService;
