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
      const stored = this.normalizeStoredPortalLine(lineSolution);
      if (!stored) continue;

      if (isWait) {
        const context = this.portalWaitContext(runner, lineIndex);
        if (!context) continue;
        const directions = [stored, this.reverseStoredPortalLine(stored)];

        for (let directionIndex = 0; directionIndex < directions.length; directionIndex++) {
          const direction = directions[directionIndex];
          if (direction.start !== context.origin || direction.end !== context.target) continue;

          const transitionIndex = direction.teleports.findIndex(teleport => (
            teleport.from === runner.portalPending.entry &&
            teleport.to === runner.portalPending.exit &&
            (!runner.portalPending.pairId || !teleport.pairId ||
              teleport.pairId === runner.portalPending.pairId)
          ));
          if (transitionIndex < 0) continue;

          const remaining = {
            segments: direction.segments.slice(transitionIndex + 1).map(segment => segment.slice()),
            teleports: direction.teleports.slice(transitionIndex + 1).map(teleport => Object.assign({}, teleport))
          };
          remaining.path = this.flattenPortalSegments(remaining.segments);
          remaining.start = remaining.path[0];
          remaining.end = remaining.path[remaining.path.length - 1];

          if (remaining.start !== runner.portalPending.exit || remaining.end !== context.target) continue;
          if (!this.isStoredPortalPathUsable(runner, lineIndex, remaining, {
            forbiddenCells: context.entryCells,
            initialPortalExit: runner.portalPending.exit,
            usedPairIds: (runner.portalPending.usedPairIds || []).concat(runner.portalPending.pairId || [])
          })) continue;

          return {
            lineIndex,
            segments: remaining.segments,
            teleports: remaining.teleports,
            path: remaining.path,
            source: 'solution',
            requiresRelease: remaining.segments.length > 1
          };
        }
      } else {
        const line = (runner.level.Lines || [])[lineIndex];
        if (!line) continue;
        const directions = [stored, this.reverseStoredPortalLine(stored)];
        const direction = directions.find(candidate => (
          candidate.start === line.Start && candidate.end === line.End
        ));
        if (direction && this.isStoredPortalPathUsable(runner, lineIndex, direction)) {
          return {
            lineIndex,
            segments: direction.segments.map(segment => segment.slice()),
            teleports: direction.teleports.map(teleport => Object.assign({}, teleport)),
            path: direction.path.slice(),
            source: 'solution',
            requiresRelease: direction.segments.length > 1
          };
        }
      }
    }
    return null;
  }

  normalizeStoredPortalLine(lineSolution) {
    if (!lineSolution || typeof lineSolution !== 'object') return null;
    const rawSegments = lineSolution.Segments || lineSolution.segments;
    if (!Array.isArray(rawSegments) || rawSegments.length === 0) return null;

    const segments = rawSegments.map(segment => {
      const cells = segment && (segment.Cells || segment.cells);
      return Array.isArray(cells) ? cells.slice() : [];
    });
    if (segments.some(segment => segment.length === 0)) return null;

    const teleports = [];
    for (let index = 0; index + 1 < rawSegments.length; index++) {
      const rawExit = rawSegments[index] && (rawSegments[index].Exit || rawSegments[index].exit);
      if (!rawExit || typeof rawExit !== 'object') return null;
      const from = rawExit.From !== undefined ? rawExit.From : rawExit.from;
      const to = rawExit.To !== undefined ? rawExit.To : rawExit.to;
      teleports.push({
        pairId: rawExit.PairId || rawExit.pairId || rawExit.Id || rawExit.id,
        from: from === undefined ? segments[index][segments[index].length - 1] : from,
        to: to === undefined ? segments[index + 1][0] : to
      });
    }

    const path = this.flattenPortalSegments(segments);
    return {
      segments,
      teleports,
      path,
      start: path[0],
      end: path[path.length - 1]
    };
  }

  reverseStoredPortalLine(stored) {
    const segments = stored.segments.slice().reverse().map(segment => segment.slice().reverse());
    const teleports = stored.teleports.slice().reverse().map(teleport => ({
      pairId: teleport.pairId,
      from: teleport.to,
      to: teleport.from
    }));
    const path = this.flattenPortalSegments(segments);
    return {
      segments,
      teleports,
      path,
      start: path[0],
      end: path[path.length - 1]
    };
  }

  flattenPortalSegments(segments) {
    const cells = [];
    (segments || []).forEach(segment => {
      (segment || []).forEach(index => cells.push(index));
    });
    return cells;
  }

  portalWaitContext(runner, lineIndex) {
    const pending = runner.portalPending;
    const line = (runner.level.Lines || [])[lineIndex];
    if (!pending || !line) return null;
    const entryCells = this.flattenPortalSegments(pending.entrySegments || []);
    const origin = entryCells[0];
    let target = null;
    if (origin === line.Start) target = line.End;
    else if (origin === line.End) target = line.Start;
    if (target === null) return null;
    return { origin, target, entryCells };
  }

  isStoredPortalPathUsable(runner, lineIndex, candidate, options) {
    options = options || {};
    if (!candidate || !Array.isArray(candidate.segments) || candidate.segments.length === 0) return false;
    if (!Array.isArray(candidate.teleports) || candidate.teleports.length !== candidate.segments.length - 1) return false;

    const forbidden = new Set(options.forbiddenCells || []);
    const usedPairs = new Set((options.usedPairIds || []).filter(Boolean));
    const seenCells = new Set();

    for (let segmentIndex = 0; segmentIndex < candidate.segments.length; segmentIndex++) {
      const segment = candidate.segments[segmentIndex];
      if (!Array.isArray(segment) || segment.length === 0) return false;
      for (let cellIndex = 0; cellIndex < segment.length; cellIndex++) {
        const cell = segment[cellIndex];
        if (!this.isPlayable(runner, cell) || forbidden.has(cell) || seenCells.has(cell)) return false;
        const owner = runner.owner[cell];
        const fixed = runner.fixedLine[cell];
        if (owner >= 0 && owner !== lineIndex) return false;
        if (fixed >= 0 && fixed !== lineIndex) return false;
        if (cellIndex > 0 && !runner.adjacent(segment[cellIndex - 1], cell)) return false;

        const isInitialExit = segmentIndex === 0 && cellIndex === 0 &&
          options.initialPortalExit === cell;
        const isTeleportArrival = segmentIndex > 0 && cellIndex === 0 &&
          candidate.teleports[segmentIndex - 1].to === cell;
        const isTeleportEntry = segmentIndex + 1 < candidate.segments.length &&
          cellIndex === segment.length - 1 && candidate.teleports[segmentIndex].from === cell;
        if (runner.isPortalCell && runner.isPortalCell(cell) &&
            !isInitialExit && !isTeleportArrival && !isTeleportEntry) return false;
        seenCells.add(cell);
      }

      if (segmentIndex + 1 < candidate.segments.length) {
        const teleport = candidate.teleports[segmentIndex];
        const from = segment[segment.length - 1];
        const to = candidate.segments[segmentIndex + 1][0];
        if (teleport.from !== from || teleport.to !== to) return false;
        const portal = runner.portalAt && runner.portalAt(from);
        if (!portal || portal.exit !== to) return false;
        if (teleport.pairId && portal.id !== teleport.pairId) return false;
        if (usedPairs.has(portal.id)) return false;
        usedPairs.add(portal.id);
      }
    }
    return true;
  }

  findAvailablePortalPath(runner) {
    const lines = runner.level.Lines || [];
    const isWait = !!(runner.portalPending && runner.portalPhase === 'PORTAL_WAIT');
    const candidates = [];

    lines.forEach((line, lineIndex) => {
      if (runner.completed && runner.completed[lineIndex]) return;
      if (isWait && lineIndex !== runner.portalPending.lineIndex) return;

      const context = isWait ? this.portalWaitContext(runner, lineIndex) : null;
      if (isWait && !context) return;
      const start = isWait ? runner.portalPending.exit : line.Start;
      const end = isWait ? context.target : line.End;
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
    const pending = isWait ? runner.portalPending : null;
    const context = isWait ? this.portalWaitContext(runner, lineIndex) : null;
    const forbidden = new Set(context ? context.entryCells : []);
    const initialUsedPairs = new Set();
    if (pending) {
      (pending.usedPairIds || []).forEach(pairId => initialUsedPairs.add(pairId));
      if (pending.pairId) initialUsedPairs.add(pending.pairId);
    }

    const canUseCell = (index, state) => {
      if (!this.isPlayable(runner, index)) return false;
      if (forbidden.has(index) || (state && state.visited.has(index))) return false;
      if (runner.selectedContains && runner.selectedContains(index)) return false;
      const owner = runner.owner[index];
      const fixed = runner.fixedLine[index];
      if (owner >= 0 && owner !== lineIndex) return false;
      if (fixed >= 0 && fixed !== lineIndex && index !== end) return false;
      return true;
    };

    const keyFor = state => {
      const pairs = Array.from(state.usedPairs).sort().join(',');
      return `${state.cell}|${state.arrivedViaTeleport ? 1 : 0}|${pairs}`;
    };
    const startState = {
      cell: start,
      parent: null,
      edgeType: 'grid',
      pairId: null,
      fromCell: null,
      toCell: null,
      arrivedViaTeleport: !!isWait,
      usedPairs: initialUsedPairs,
      visited: new Set([start])
    };
    const queue = [startState];
    const visitedStates = new Set([keyFor(startState)]);
    let found = null;

    for (let head = 0; head < queue.length; head++) {
      const state = queue[head];
      const current = state.cell;
      if (current === end) {
        found = state;
        break;
      }

      const portal = runner.portalAt && runner.portalAt(current);
      if (portal && !state.arrivedViaTeleport) {
        if (state.usedPairs.has(portal.id)) continue;
        if (runner.portalExitAvailable && !runner.portalExitAvailable(portal, lineIndex)) continue;
        if (!canUseCell(portal.exit, state)) continue;

        const usedPairs = new Set(state.usedPairs);
        usedPairs.add(portal.id);
        const visited = new Set(state.visited);
        visited.add(portal.exit);
        const nextState = {
          cell: portal.exit,
          parent: state,
          edgeType: 'teleport',
          pairId: portal.id,
          fromCell: portal.entry,
          toCell: portal.exit,
          arrivedViaTeleport: true,
          usedPairs,
          visited
        };
        const key = keyFor(nextState);
        if (!visitedStates.has(key)) {
          visitedStates.add(key);
          queue.push(nextState);
        }
        continue;
      }

      const point = runner.indexToXY(current);
      const neighbors = [];
      if (point.x > 0) neighbors.push(current - 1);
      if (point.x + 1 < runner.level.Width) neighbors.push(current + 1);
      if (point.y > 0) neighbors.push(current - runner.level.Width);
      if (point.y + 1 < runner.level.Height) neighbors.push(current + runner.level.Width);

      neighbors.forEach(next => {
        if (!canUseCell(next, state)) return;
        const nextPortal = runner.portalAt && runner.portalAt(next);
        if (nextPortal && state.usedPairs.has(nextPortal.id)) return;
        const visited = new Set(state.visited);
        visited.add(next);
        const nextState = {
          cell: next,
          parent: state,
          edgeType: 'grid',
          pairId: null,
          fromCell: current,
          toCell: next,
          arrivedViaTeleport: false,
          usedPairs: new Set(state.usedPairs),
          visited
        };
        const key = keyFor(nextState);
        if (visitedStates.has(key)) return;
        visitedStates.add(key);
        queue.push(nextState);
      });
    }

    if (!found) return null;

    const chain = [];
    for (let state = found; state; state = state.parent) chain.push(state);
    chain.reverse();

    const segments = [[]];
    const teleports = [];
    const flatPath = [];

    chain.forEach((state, idx) => {
      flatPath.push(state.cell);
      if (idx > 0 && state.edgeType === 'teleport') {
        teleports.push({
          pairId: state.pairId,
          from: state.fromCell,
          to: state.toCell
        });
        segments.push([state.cell]);
      } else {
        segments[segments.length - 1].push(state.cell);
      }
    });

    return {
      segments,
      teleports,
      path: flatPath,
      requiresRelease: segments.length > 1
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
