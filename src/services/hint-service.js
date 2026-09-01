let defaultPortalSolutions = null;
try {
  defaultPortalSolutions = require('../../data/portal-solutions.js');
} catch (error) {
  defaultPortalSolutions = null;
}

class HintService {
  constructor(solutionCatalog, dailySolutions, portalSolutions) {
    // Keep the original one-argument constructor intact.  A caller may also
    // provide a separate daily solution manifest as the second argument; the
    // daily entry point accepts an explicit manifest too.
    let ordinary = solutionCatalog;
    let daily = dailySolutions;
    let portals = portalSolutions;
    // Also accept a descriptive options object for hosts that construct all
    // hint data in one injection bundle.
    if (solutionCatalog && typeof solutionCatalog === 'object' &&
        (solutionCatalog.solutionCatalog || solutionCatalog.dailySolutions || solutionCatalog.portalSolutions)) {
      ordinary = solutionCatalog.solutionCatalog || solutionCatalog.solutions || null;
      daily = daily || solutionCatalog.dailySolutions;
      portals = portals || solutionCatalog.portalSolutions;
    }
    this.solutionCatalog = ordinary || null;
    this.dailySolutions = daily || null;
    this.portalSolutions = portals !== undefined ? portals : defaultPortalSolutions;
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

  find(runner, setIndex, levelIndex) {
    if (!runner || runner.isGameOver) return null;
    if (runner.portalEnabled) {
      return this.findPortal(runner, setIndex, levelIndex);
    }
    const stored = this.solutionFor(setIndex, levelIndex);
    if (stored) {
      const hint = this.pickStoredPath(stored, runner);
      if (hint) return hint;
    }
    return this.findAvailablePath(runner);
  }

  findPortal(runner, setIndex, levelIndex) {
    const levelId = runner.level && (runner.level.Id || runner.level.id);
    const stored = this.portalSolutionFor(levelId);
    if (stored) {
      const hint = this.pickStoredPortalPath(stored, runner);
      if (hint) return hint;
    }
    return this.findAvailablePortalPath(runner);
  }

  pickStoredPortalPath(paths, runner) {
    const isWait = !!(runner.portalPending && runner.portalPhase === 'PORTAL_WAIT');
    const waitingLine = isWait ? runner.portalPending.lineIndex : -1;

    for (let lineIndex = 0; lineIndex < paths.length; lineIndex++) {
      if (runner.completed && runner.completed[lineIndex]) continue;
      if (isWait && lineIndex !== waitingLine) continue;

      const lineSolution = paths[lineIndex];
      if (!lineSolution || !Array.isArray(lineSolution.Segments) || lineSolution.Segments.length === 0) continue;

      const segments = lineSolution.Segments;
      if (isWait) {
        // If in waiting state, hint shows the remaining segment(s) after portal B
        if (segments.length <= 1) continue;
        const remainingSegments = segments.slice(1).map(s => (s.Cells || s.cells || []).slice());
        const remainingCells = [].concat(...remainingSegments);
        const playable = remainingCells.every(index => this.isPlayable(runner, index));
        if (!playable) continue;
        const clear = remainingCells.every(index => (
          runner.owner[index] < 0 || runner.owner[index] === lineIndex || index === runner.portalPending.exit
        ));
        if (clear) {
          return {
            lineIndex,
            segments: remainingSegments,
            teleports: [],
            path: remainingCells,
            source: 'solution',
            requiresRelease: false
          };
        }
      } else {
        const allCells = [];
        const segmentCells = [];
        const teleports = [];
        segments.forEach(seg => {
          const cells = (seg.Cells || seg.cells || []).slice();
          segmentCells.push(cells);
          allCells.push(...cells);
          const exit = seg.Exit || seg.exit;
          if (exit) {
            teleports.push({
              pairId: exit.PairId || exit.pairId || exit.Id || exit.id,
              from: exit.From !== undefined ? exit.From : exit.from,
              to: exit.To !== undefined ? exit.To : exit.to
            });
          }
        });
        const playable = allCells.every(index => this.isPlayable(runner, index));
        if (!playable) continue;
        const clear = allCells.every(index => (
          runner.owner[index] < 0 || runner.owner[index] === lineIndex
        ));
        if (clear) {
          return {
            lineIndex,
            segments: segmentCells,
            teleports,
            path: allCells,
            source: 'solution',
            requiresRelease: segments.length > 1
          };
        }
      }
    }
    return null;
  }

  findAvailablePortalPath(runner) {
    const lines = runner.level.Lines || [];
    const isWait = !!(runner.portalPending && runner.portalPhase === 'PORTAL_WAIT');
    const candidates = [];

    lines.forEach((line, lineIndex) => {
      if (runner.completed && runner.completed[lineIndex]) return;
      if (isWait && lineIndex !== runner.portalPending.lineIndex) return;

      const start = isWait ? runner.portalPending.exit : line.Start;
      const end = line.End;
      const result = this.shortestPortalPath(runner, lineIndex, start, end, isWait);
      if (result) {
        candidates.push(Object.assign({ lineIndex, source: 'search' }, result));
      }
    });

    candidates.sort((one, two) => one.path.length - two.path.length);
    return candidates[0] || null;
  }

  shortestPortalPath(runner, lineIndex, start, end, isWait) {
    if (!this.isPlayable(runner, start) || !this.isPlayable(runner, end)) return null;
    const total = runner.level.Width * runner.level.Height;
    const previous = new Array(total).fill(null);
    const queue = [start];
    previous[start] = { from: start, edgeType: 'grid' };

    for (let head = 0; head < queue.length; head++) {
      const current = queue[head];
      if (current === end) break;
      const point = runner.indexToXY(current);
      const neighbors = [];
      if (point.x > 0) neighbors.push({ index: current - 1, edgeType: 'grid' });
      if (point.x + 1 < runner.level.Width) neighbors.push({ index: current + 1, edgeType: 'grid' });
      if (point.y > 0) neighbors.push({ index: current - runner.level.Width, edgeType: 'grid' });
      if (point.y + 1 < runner.level.Height) neighbors.push({ index: current + runner.level.Width, edgeType: 'grid' });

      // If current is a portal cell and player hasn't already passed it
      if (!isWait && runner.isPortalCell && runner.isPortalCell(current)) {
        const portal = runner.portalAt(current);
        if (portal && runner.portalExitAvailable(portal, lineIndex)) {
          neighbors.push({
            index: portal.exit,
            edgeType: 'teleport',
            pairId: portal.id,
            from: portal.entry,
            to: portal.exit
          });
        }
      }

      neighbors.forEach(item => {
        const next = item.index;
        if (previous[next]) return;
        if (!this.isPlayable(runner, next)) return;
        const owner = runner.owner[next];
        const fixed = runner.fixedLine[next];
        if (owner >= 0 && owner !== lineIndex) return;
        if (fixed >= 0 && fixed !== lineIndex && next !== end) return;
        previous[next] = { from: current, edgeType: item.edgeType, pairId: item.pairId, fromCell: item.from, toCell: item.to };
        queue.push(next);
      });
    }

    if (!previous[end]) return null;

    // Reconstruct path and segments
    const chain = [];
    for (let current = end; ; current = previous[current].from) {
      chain.push({ cell: current, prevInfo: previous[current] });
      if (current === start) break;
    }
    chain.reverse();

    const segments = [[]];
    const teleports = [];
    const flatPath = [];

    chain.forEach((step, idx) => {
      flatPath.push(step.cell);
      if (idx > 0 && step.prevInfo && step.prevInfo.edgeType === 'teleport') {
        teleports.push({
          pairId: step.prevInfo.pairId,
          from: step.prevInfo.fromCell,
          to: step.prevInfo.toCell
        });
        segments.push([step.cell]);
      } else {
        segments[segments.length - 1].push(step.cell);
      }
    });

    return {
      segments,
      teleports,
      path: flatPath,
      requiresRelease: !isWait && segments.length > 1
    };
  }

  /**
   * Find a hint for a daily challenge by its stable challenge id.
   *
   * Daily solution manifests are intentionally independent from the ordinary
   * set/level catalog.  The optional third argument makes this usable by the
   * app bootstrap without changing existing HintService construction.  When
   * no stored path is available we still provide the same local BFS fallback
   * used by ordinary levels.
   */
  findDaily(runner, challengeId, dailySolutions) {
    if (!runner || runner.isGameOver) return null;
    // Be liberal about a two-argument call where the caller supplies the
    // manifest and the challenge carries its own stable id.  The documented
    // form remains (runner, challengeId, dailySolutions).
    if (challengeId && typeof challengeId === 'object' && dailySolutions === undefined) {
      dailySolutions = challengeId;
      challengeId = runner.challengeId || (runner.level && (runner.level.Id || runner.level.id));
    }
    if (!challengeId && runner) {
      challengeId = runner.challengeId || (runner.level && (runner.level.Id || runner.level.id));
    }
    const stored = this.dailySolutionFor(
      challengeId,
      dailySolutions || this.dailySolutions
    );
    if (stored) {
      // Keep the established `source: 'solution'` shape so renderer and
      // callers that consume ordinary hints do not need a mode-specific
      // branch.  The lookup itself remains daily-id based and isolated from
      // the ordinary set/level catalog.
      const hint = this.pickStoredPath(stored, runner);
      if (hint) return hint;
    }
    return this.findAvailablePath(runner);
  }

  dailySolutionFor(challengeId, dailySolutions) {
    if (!challengeId) return null;
    // If a daily manifest was supplied as the first constructor argument,
    // recognize it without making ordinary `sets` catalogs ambiguous.
    const constructorDaily = this.solutionCatalog && !this.solutionCatalog.sets
      && (this.solutionCatalog.ByChallengeId || this.solutionCatalog.byChallengeId)
      ? this.solutionCatalog
      : null;
    const source = dailySolutions || this.dailySolutions || constructorDaily;
    if (!source) return null;
    const map = source.ByChallengeId || source.byChallengeId || source;
    const paths = map && map[challengeId];
    return Array.isArray(paths) ? paths : null;
  }

  isPlayable(runner, index) {
    if (!runner) return false;
    if (typeof runner.isPlayableCell === 'function') {
      return runner.isPlayableCell(index);
    }
    if (runner.blockedMask && runner.blockedMask[index]) return false;
    // Keep compatibility with lightweight test doubles and older runners.
    return typeof runner.isValidCell === 'function'
      ? runner.isValidCell(index)
      : Number.isInteger(index) && index >= 0;
  }

  pickStoredPath(paths, runner, source) {
    for (let lineIndex = 0; lineIndex < paths.length; lineIndex++) {
      if (runner.completed && runner.completed[lineIndex]) continue;
      const path = paths[lineIndex];
      if (!Array.isArray(path) || path.length < 2) continue;
      // Stored paths are data, not authority.  Reject a path wholesale when
      // it contains a blocked/out-of-range cell rather than leaking a hint
      // that the player cannot actually draw.
      const playable = path.every(index => this.isPlayable(runner, index));
      if (!playable) continue;
      const clear = path.every(index => (
        runner.owner[index] < 0 || runner.owner[index] === lineIndex
      ));
      if (clear) {
        return {
          lineIndex,
          path: path.slice(),
          source: source || 'solution'
        };
      }
    }
    return null;
  }

  findAvailablePath(runner) {
    const lines = runner.level.Lines || [];
    const candidates = [];
    lines.forEach((line, lineIndex) => {
      if (runner.completed && runner.completed[lineIndex]) return;
      const path = this.shortestPath(runner, lineIndex, line.Start, line.End);
      if (path) candidates.push({ lineIndex, path, source: 'search' });
    });
    candidates.sort((one, two) => one.path.length - two.path.length);
    return candidates[0] || null;
  }

  shortestPath(runner, lineIndex, start, end) {
    if (!this.isPlayable(runner, start) || !this.isPlayable(runner, end)) return null;
    const total = runner.level.Width * runner.level.Height;
    const previous = new Array(total).fill(-1);
    const queue = [start];
    previous[start] = start;

    for (let head = 0; head < queue.length; head++) {
      const current = queue[head];
      if (current === end) break;
      const point = runner.indexToXY(current);
      const neighbors = [];
      if (point.x > 0) neighbors.push(current - 1);
      if (point.x + 1 < runner.level.Width) neighbors.push(current + 1);
      if (point.y > 0) neighbors.push(current - runner.level.Width);
      if (point.y + 1 < runner.level.Height) neighbors.push(current + runner.level.Width);

      neighbors.forEach(next => {
        if (previous[next] >= 0) return;
        if (!this.isPlayable(runner, next)) return;
        const owner = runner.owner[next];
        const fixed = runner.fixedLine[next];
        if (owner >= 0 && owner !== lineIndex) return;
        if (fixed >= 0 && fixed !== lineIndex && next !== end) return;
        previous[next] = current;
        queue.push(next);
      });
    }

    if (previous[end] < 0) return null;
    const path = [];
    for (let current = end; ; current = previous[current]) {
      path.push(current);
      if (current === start) break;
    }
    path.reverse();
    return path.length > 1 ? path : null;
  }
}

module.exports = HintService;
