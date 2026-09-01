'use strict';

const OrdinaryHintProvider = require('./ordinary-hint-provider.js');
const {
  flattenPortalSegments,
  normalizeStoredPortalLine,
  reverseStoredPortalLine
} = require('../../../core/portal-solution.js');

const boardOf = OrdinaryHintProvider.boardOf;
const linesOf = OrdinaryHintProvider.linesOf;
const endpoint = OrdinaryHintProvider.endpoint;
const isCompleted = OrdinaryHintProvider.isCompleted;

function mechanicOf(context) {
  return context && context.mechanic && typeof context.mechanic === 'object'
    ? context.mechanic : {};
}

class PortalHintProvider {
  constructor(ordinaryProvider) {
    this.ordinary = ordinaryProvider || new OrdinaryHintProvider();
  }

  find(context, storedPaths) {
    if (!context || (context.outcome && context.outcome !== 'playing')) return null;
    if (storedPaths) {
      const hint = this.pickStoredPortalPath(storedPaths, context);
      if (hint) return hint;
    }
    return this.findAvailablePortalPath(context);
  }

  selectedContains(context, index) {
    const selection = context && context.selection;
    if (!selection || typeof selection !== 'object') return false;
    if (Array.isArray(selection.segments) && selection.segments.some(segment => (
      Array.isArray(segment) && segment.indexOf(index) >= 0
    ))) return true;
    return Array.isArray(selection.cells) && selection.cells.indexOf(index) >= 0;
  }

  portalAt(context, index) {
    if (!this.ordinary.isPlayable(context, index)) return null;
    const portals = mechanicOf(context).portals;
    if (!Array.isArray(portals)) return null;
    for (let portalIndex = 0; portalIndex < portals.length; portalIndex++) {
      const definition = portals[portalIndex];
      if (!definition || typeof definition !== 'object') continue;
      const cells = Array.isArray(definition.cells) ? definition.cells : null;
      const a = definition.A === undefined
        ? (definition.a === undefined && cells ? cells[0] : definition.a)
        : definition.A;
      const b = definition.B === undefined
        ? (definition.b === undefined && cells ? cells[1] : definition.b)
        : definition.B;
      const id = definition.id === undefined ? definition.Id : definition.id;
      if (index === a) return { id, entry: a, exit: b };
      if (index === b) return { id, entry: b, exit: a };
    }
    return null;
  }

  portalExitAvailable(context, portal, lineIndex) {
    if (!portal || !this.ordinary.isPlayable(context, portal.exit)) return false;
    const board = boardOf(context);
    const owner = Array.isArray(board.owner) ? board.owner : [];
    const fixedLine = Array.isArray(board.fixedLine) ? board.fixedLine : [];
    const exitOwner = Number.isInteger(owner[portal.exit]) ? owner[portal.exit] : -1;
    const exitFixedLine = Number.isInteger(fixedLine[portal.exit]) ? fixedLine[portal.exit] : -1;
    if (exitFixedLine >= 0 && exitFixedLine !== lineIndex) return false;
    if (exitOwner >= 0 && exitOwner !== lineIndex) return false;
    return !this.selectedContains(context, portal.exit);
  }

  pickStoredPortalPath(paths, context) {
    if (!Array.isArray(paths) || !context) return null;
    const mechanic = mechanicOf(context);
    const pending = mechanic.pending;
    const isWait = !!(pending && mechanic.phase === 'PORTAL_WAIT');
    const waitingLine = isWait ? pending.lineIndex : -1;

    for (let lineIndex = 0; lineIndex < paths.length; lineIndex++) {
      if (isCompleted(context, lineIndex)) continue;
      if (isWait && lineIndex !== waitingLine) continue;

      const stored = normalizeStoredPortalLine(paths[lineIndex]);
      if (!stored) continue;

      if (isWait) {
        const waitContext = this.portalWaitContext(context, lineIndex);
        if (!waitContext) continue;
        const reversed = reverseStoredPortalLine(stored);
        const directions = reversed ? [stored, reversed] : [stored];

        for (let directionIndex = 0; directionIndex < directions.length; directionIndex++) {
          const direction = directions[directionIndex];
          if (direction.start !== waitContext.origin || direction.end !== waitContext.target) continue;

          const transitionIndex = direction.teleports.findIndex(teleport => (
            teleport.from === pending.entry &&
            teleport.to === pending.exit &&
            (!pending.pairId || !teleport.pairId || teleport.pairId === pending.pairId)
          ));
          if (transitionIndex < 0) continue;

          const remaining = {
            segments: direction.segments.slice(transitionIndex + 1).map(segment => segment.slice()),
            teleports: direction.teleports.slice(transitionIndex + 1).map(teleport => Object.assign({}, teleport))
          };
          remaining.path = flattenPortalSegments(remaining.segments);
          remaining.start = remaining.path[0];
          remaining.end = remaining.path[remaining.path.length - 1];

          const usedPairIds = pending.usedPairIds || mechanic.usedPairIds || [];
          if (remaining.start !== pending.exit || remaining.end !== waitContext.target) continue;
          if (!this.isStoredPortalPathUsable(context, lineIndex, remaining, {
            forbiddenCells: waitContext.entryCells,
            initialPortalExit: pending.exit,
            usedPairIds: usedPairIds.concat(pending.pairId || [])
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
        const line = linesOf(context)[lineIndex];
        if (!line) continue;
        const reversed = reverseStoredPortalLine(stored);
        const directions = reversed ? [stored, reversed] : [stored];
        const start = endpoint(line, 'Start', 'start');
        const end = endpoint(line, 'End', 'end');
        const direction = directions.find(candidate => (
          candidate.start === start && candidate.end === end
        ));
        if (direction && this.isStoredPortalPathUsable(context, lineIndex, direction)) {
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

  portalWaitContext(context, lineIndex) {
    const pending = mechanicOf(context).pending;
    const line = linesOf(context)[lineIndex];
    if (!pending || !line) return null;
    const entryCells = Array.isArray(pending.entryCells)
      ? pending.entryCells.slice()
      : flattenPortalSegments(pending.entrySegments || []);
    const origin = entryCells[0];
    const start = endpoint(line, 'Start', 'start');
    const end = endpoint(line, 'End', 'end');
    let target = null;
    if (origin === start) target = end;
    else if (origin === end) target = start;
    if (target === null) return null;
    return { origin, target, entryCells };
  }

  isStoredPortalPathUsable(context, lineIndex, candidate, options) {
    options = options || {};
    if (!candidate || !Array.isArray(candidate.segments) || candidate.segments.length === 0) return false;
    if (!Array.isArray(candidate.teleports) || candidate.teleports.length !== candidate.segments.length - 1) return false;

    const board = boardOf(context);
    const width = Number(board.width);
    const owner = Array.isArray(board.owner) ? board.owner : [];
    const fixedLine = Array.isArray(board.fixedLine) ? board.fixedLine : [];
    const forbidden = new Set(options.forbiddenCells || []);
    const usedPairs = new Set((options.usedPairIds || []).filter(Boolean));
    const seenCells = new Set();

    for (let segmentIndex = 0; segmentIndex < candidate.segments.length; segmentIndex++) {
      const segment = candidate.segments[segmentIndex];
      if (!Array.isArray(segment) || segment.length === 0) return false;
      for (let cellIndex = 0; cellIndex < segment.length; cellIndex++) {
        const cell = segment[cellIndex];
        if (!this.ordinary.isPlayable(context, cell) || forbidden.has(cell) || seenCells.has(cell)) return false;
        const cellOwner = Number.isInteger(owner[cell]) ? owner[cell] : -1;
        const cellFixedLine = Number.isInteger(fixedLine[cell]) ? fixedLine[cell] : -1;
        if (cellOwner >= 0 && cellOwner !== lineIndex) return false;
        if (cellFixedLine >= 0 && cellFixedLine !== lineIndex) return false;
        if (cellIndex > 0) {
          const previous = segment[cellIndex - 1];
          const adjacent = Math.abs((previous % width) - (cell % width)) +
            Math.abs(Math.floor(previous / width) - Math.floor(cell / width)) === 1;
          if (!adjacent) return false;
        }

        const isInitialExit = segmentIndex === 0 && cellIndex === 0 &&
          options.initialPortalExit === cell;
        const isTeleportArrival = segmentIndex > 0 && cellIndex === 0 &&
          candidate.teleports[segmentIndex - 1].to === cell;
        const isTeleportEntry = segmentIndex + 1 < candidate.segments.length &&
          cellIndex === segment.length - 1 && candidate.teleports[segmentIndex].from === cell;
        if (this.portalAt(context, cell) && !isInitialExit && !isTeleportArrival && !isTeleportEntry) return false;
        seenCells.add(cell);
      }

      if (segmentIndex + 1 < candidate.segments.length) {
        const teleport = candidate.teleports[segmentIndex];
        const from = segment[segment.length - 1];
        const to = candidate.segments[segmentIndex + 1][0];
        if (teleport.from !== from || teleport.to !== to) return false;
        const portal = this.portalAt(context, from);
        if (!portal || portal.exit !== to) return false;
        if (teleport.pairId && portal.id !== teleport.pairId) return false;
        if (usedPairs.has(portal.id)) return false;
        usedPairs.add(portal.id);
      }
    }
    return true;
  }

  findAvailablePortalPath(context) {
    if (!context) return null;
    const mechanic = mechanicOf(context);
    const pending = mechanic.pending;
    const isWait = !!(pending && mechanic.phase === 'PORTAL_WAIT');
    const candidates = [];

    linesOf(context).forEach((line, lineIndex) => {
      if (isCompleted(context, lineIndex)) return;
      if (isWait && lineIndex !== pending.lineIndex) return;

      const waitContext = isWait ? this.portalWaitContext(context, lineIndex) : null;
      if (isWait && !waitContext) return;
      const start = isWait ? pending.exit : endpoint(line, 'Start', 'start');
      const end = isWait ? waitContext.target : endpoint(line, 'End', 'end');
      const result = this.shortestPortalPath(context, lineIndex, start, end, isWait);
      if (result) candidates.push(Object.assign({ lineIndex, source: 'search' }, result));
    });

    candidates.sort((one, two) => one.path.length - two.path.length);
    return candidates[0] || null;
  }

  shortestPortalPath(context, lineIndex, start, end, isWait) {
    if (!this.ordinary.isPlayable(context, start) || !this.ordinary.isPlayable(context, end)) return null;
    const board = boardOf(context);
    const width = Number(board.width);
    const height = Number(board.height);
    const owner = Array.isArray(board.owner) ? board.owner : [];
    const fixedLine = Array.isArray(board.fixedLine) ? board.fixedLine : [];
    const mechanic = mechanicOf(context);
    const pending = isWait ? mechanic.pending : null;
    const waitContext = isWait ? this.portalWaitContext(context, lineIndex) : null;
    const forbidden = new Set(waitContext ? waitContext.entryCells : []);
    const initialUsedPairs = new Set();
    if (pending) {
      (pending.usedPairIds || mechanic.usedPairIds || []).forEach(pairId => initialUsedPairs.add(pairId));
      if (pending.pairId) initialUsedPairs.add(pending.pairId);
    }

    const canUseCell = (index, state) => {
      if (!this.ordinary.isPlayable(context, index)) return false;
      if (forbidden.has(index) || (state && state.visited.has(index))) return false;
      if (this.selectedContains(context, index)) return false;
      const cellOwner = Number.isInteger(owner[index]) ? owner[index] : -1;
      const cellFixedLine = Number.isInteger(fixedLine[index]) ? fixedLine[index] : -1;
      if (cellOwner >= 0 && cellOwner !== lineIndex) return false;
      if (cellFixedLine >= 0 && cellFixedLine !== lineIndex && index !== end) return false;
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

      const portal = this.portalAt(context, current);
      if (portal && !state.arrivedViaTeleport) {
        if (state.usedPairs.has(portal.id)) continue;
        if (!this.portalExitAvailable(context, portal, lineIndex)) continue;
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

      const x = current % width;
      const y = Math.floor(current / width);
      const neighbors = [];
      if (x > 0) neighbors.push(current - 1);
      if (x + 1 < width) neighbors.push(current + 1);
      if (y > 0) neighbors.push(current - width);
      if (y + 1 < height) neighbors.push(current + width);

      neighbors.forEach(next => {
        if (!canUseCell(next, state)) return;
        const nextPortal = this.portalAt(context, next);
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
    const path = [];
    chain.forEach((state, index) => {
      path.push(state.cell);
      if (index > 0 && state.edgeType === 'teleport') {
        teleports.push({ pairId: state.pairId, from: state.fromCell, to: state.toCell });
        segments.push([state.cell]);
      } else {
        segments[segments.length - 1].push(state.cell);
      }
    });

    return {
      segments,
      teleports,
      path,
      requiresRelease: segments.length > 1
    };
  }
}

module.exports = PortalHintProvider;
