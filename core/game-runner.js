'use strict';

// The runner deliberately owns portal rules, but never knows about Canvas,
// wx, audio, persistence, or UI copy. A level without a valid `Portals`
// declaration follows the legacy path code exactly.
const PORTAL_PHASE = {
  READY: 'READY',
  DRAWING: 'DRAWING',
  PORTAL_LOCKED: 'PORTAL_LOCKED',
  PORTAL_WAIT: 'PORTAL_WAIT',
  PORTAL_CONTINUE: 'PORTAL_CONTINUE',
  SOLVED: 'SOLVED'
};

function clonePath(path) {
  return Array.isArray(path) ? path.slice() : path;
}

function cloneSegments(segments) {
  if (!Array.isArray(segments)) return segments;
  return segments.map(segment => clonePath(segment));
}

function cloneTeleports(teleports) {
  if (!Array.isArray(teleports)) return teleports;
  return teleports.map(teleport => {
    if (!teleport || typeof teleport !== 'object') return teleport;
    const copy = {};
    Object.keys(teleport).forEach(key => { copy[key] = teleport[key]; });
    return copy;
  });
}

function cloneSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  const copy = {};
  Object.keys(snapshot).forEach(key => {
    if (key === 'completedPaths') {
      copy[key] = Array.isArray(snapshot[key])
        ? snapshot[key].map(clonePath) : snapshot[key];
    } else if (key === 'completedSegments') {
      copy[key] = Array.isArray(snapshot[key])
        ? snapshot[key].map(cloneSegments) : snapshot[key];
    } else if (key === 'completedTeleports') {
      copy[key] = Array.isArray(snapshot[key])
        ? snapshot[key].map(cloneTeleports) : snapshot[key];
    } else {
      copy[key] = snapshot[key];
    }
  });
  return copy;
}

class GameRunner {
  /**
   * Create a rule runner for a level.
   *
   * The fourth argument is intentionally optional so all existing three
   * argument callers continue to behave exactly as before. `blocked` remains
   * a generic board option; `portals` is the analogous optional portal input.
   */
  constructor(level, palette, onChange, options) {
    this.level = level || {};
    this.palette = palette || [];

    // A few integrations omit the callback when supplying options. Accept
    // that shape while preserving the documented signature.
    if (onChange && typeof onChange === 'object' && options === undefined) {
      options = onChange;
      onChange = null;
    }
    this.onChange = typeof onChange === 'function' ? onChange : function () {};
    this.options = options || {};

    const total = this.level.Width * this.level.Height;
    this.blockedMask = new Array(total).fill(false);
    const configuredBlocked = Object.prototype.hasOwnProperty.call(this.options, 'blocked')
      ? this.options.blocked
      : (this.options.blockedCells !== undefined
        ? this.options.blockedCells
        : (this.level.Blocked === undefined ? this.level.blocked : this.level.Blocked));
    if (Array.isArray(configuredBlocked)) {
      configuredBlocked.forEach(index => {
        // Validation belongs to the authoring/data layer. The generic runner
        // ignores malformed entries rather than throwing.
        if (Number.isInteger(index) && index >= 0 && index < total) {
          this.blockedMask[index] = true;
        }
      });
    }
    this.blocked = this.blockedMask.reduce((indices, blocked, index) => {
      if (blocked) indices.push(index);
      return indices;
    }, []);
    this.blockedCells = this.blocked;

    const configuredPortals = Object.prototype.hasOwnProperty.call(this.options, 'portals')
      ? this.options.portals
      : (this.options.portalPairs !== undefined
        ? this.options.portalPairs
        : (this.level.Portals === undefined ? this.level.portals : this.level.Portals));
    this.portalDefinitions = this.normalizePortals(configuredPortals, total);
    this.portalEnabled = this.portalDefinitions.length > 0;
    this.reset();
  }

  normalizePortals(rawPortals, total) {
    if (!Array.isArray(rawPortals)) return [];
    const seenIds = Object.create(null);
    const seenCells = Object.create(null);
    const normalized = [];
    rawPortals.forEach((raw, index) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
      const cells = Array.isArray(raw.Cells) ? raw.Cells
        : (Array.isArray(raw.cells) ? raw.cells : null);
      const first = raw.A === undefined ? raw.a : raw.A;
      const second = raw.B === undefined ? raw.b : raw.B;
      const a = first === undefined && cells ? cells[0] : first;
      const b = second === undefined && cells ? cells[1] : second;
      if (!Number.isInteger(a) || !Number.isInteger(b) || a === b ||
          a < 0 || b < 0 || a >= total || b >= total) return;
      const rawId = raw.Id === undefined ? raw.id : raw.Id;
      const id = rawId === undefined || rawId === null || String(rawId) === ''
        ? `P${index + 1}` : String(rawId);
      if (seenIds[id] || seenCells[a] || seenCells[b]) return;
      seenIds[id] = true;
      seenCells[a] = true;
      seenCells[b] = true;
      normalized.push({
        id,
        A: a,
        B: b,
        cells: [a, b]
      });
    });
    return normalized;
  }

  reset() {
    const lineCount = (this.level.Lines || []).length;
    const total = this.level.Width * this.level.Height;

    this.fixedLine = new Array(total).fill(-1);
    this.owner = new Array(total).fill(-1);
    this.completedPaths = new Array(lineCount).fill(null);
    this.completedSegments = new Array(lineCount).fill(null);
    this.completedTeleports = new Array(lineCount).fill(null);
    this.completed = new Array(lineCount).fill(false);
    this.completedCells = {};
    this.touched = new Array(total).fill(false);
    this.selectedLine = -1;
    this.selectedCells = [];
    this.selectedSegments = [];
    this.selectedTeleports = [];
    this.pendingSnapshot = null;
    this.removedPathOnStart = false;
    this.portalPhase = PORTAL_PHASE.READY;
    this.portalLock = null;
    this.portalPending = null;
    this.portalUsedPairs = new Set();
    this.undoStack = [];

    (this.level.Lines || []).forEach((line, lineIndex) => {
      // A blocked endpoint is invalid challenge data, but never let it turn
      // into a playable/fixed cell if unvalidated data reaches the rule layer.
      if (this.isPlayableCell(line.Start)) this.fixedLine[line.Start] = lineIndex;
      if (this.isPlayableCell(line.End)) this.fixedLine[line.End] = lineIndex;
    });

    this.configurePortalIndex();
    this.startedAt = Date.now();
    this.pausedAt = 0;
    this.finishedAt = 0;
    this.isGameOver = false;
    this.notify();
  }

  configurePortalIndex() {
    this.portals = [];
    this.portalByCell = Object.create(null);
    this.portalById = Object.create(null);
    this.portalDefinitions.forEach(definition => {
      const a = definition.A;
      const b = definition.B;
      // Runtime is deliberately defensive; strict authoring validation is
      // performed by portal-validation.js. Invalid endpoint/blocked conflicts
      // are ignored here so a malformed level cannot make a cell unplayable.
      if (!this.isPlayableCell(a) || !this.isPlayableCell(b) ||
          this.fixedLine[a] >= 0 || this.fixedLine[b] >= 0) return;
      if (this.portalByCell[a] || this.portalByCell[b] || this.portalById[definition.id]) return;
      const portal = {
        id: definition.id,
        A: a,
        B: b,
        cells: [a, b]
      };
      this.portals.push(portal);
      this.portalById[portal.id] = portal;
      this.portalByCell[a] = { id: portal.id, entry: a, exit: b };
      this.portalByCell[b] = { id: portal.id, entry: b, exit: a };
    });
    this.portalEnabled = this.portals.length > 0;
  }

  notify() {
    this.onChange(this);
  }

  elapsedMs() {
    const now = this.isGameOver ? this.finishedAt : (this.pausedAt || Date.now());
    return Math.max(0, now - this.startedAt);
  }

  pause() {
    if (!this.isGameOver && !this.pausedAt) this.pausedAt = Date.now();
  }

  resume() {
    if (!this.pausedAt) return;
    this.startedAt += Date.now() - this.pausedAt;
    this.pausedAt = 0;
  }

  timeText() {
    return GameRunner.formatTime(this.elapsedMs());
  }

  static formatTime(milliseconds) {
    const seconds = Math.max(0, Math.floor((milliseconds || 0) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  indexToXY(index) {
    return { x: index % this.level.Width, y: Math.floor(index / this.level.Width) };
  }

  isValidCell(index) {
    return Number.isInteger(index) && index >= 0 && index < this.fixedLine.length;
  }

  isPlayableCell(index) {
    return this.isValidCell(index) && !this.blockedMask[index];
  }

  isBlockedCell(index) {
    return this.isValidCell(index) && this.blockedMask[index] === true;
  }

  adjacent(oneIndex, twoIndex) {
    const one = this.indexToXY(oneIndex);
    const two = this.indexToXY(twoIndex);
    return Math.abs(one.x - two.x) + Math.abs(one.y - two.y) === 1;
  }

  portalAt(index) {
    if (!this.isValidCell(index)) return null;
    const value = this.portalByCell && this.portalByCell[index];
    if (!value) return null;
    return { id: value.id, entry: value.entry, exit: value.exit };
  }

  portalExit(index) {
    const portal = this.portalAt(index);
    return portal ? portal.exit : -1;
  }

  isPortalCell(index) {
    return !!this.portalAt(index);
  }

  portalStatus() {
    const active = this.selectedLine >= 0 || this.portalPending || this.portalLock;
    if (!active) return null;
    const context = this.portalPending || this.portalLock || {};
    const entrySegments = this.portalPending && this.portalPending.entrySegments
      ? this.portalPending.entrySegments
      : this.selectedSegments;
    return {
      phase: this.portalPhase,
      lineIndex: this.selectedLine >= 0 ? this.selectedLine : (context.lineIndex === undefined ? -1 : context.lineIndex),
      pairId: context.pairId || null,
      entry: context.entry === undefined ? null : context.entry,
      exit: context.exit === undefined ? null : context.exit,
      entryCells: this.flattenSegments(entrySegments),
      usedPairIds: Array.from(this.portalUsedPairs || [])
    };
  }

  flattenSegments(segments) {
    if (!Array.isArray(segments)) return [];
    const cells = [];
    segments.forEach(segment => {
      if (Array.isArray(segment)) segment.forEach(index => cells.push(index));
    });
    return cells;
  }

  snapshot() {
    const snapshot = {
      completedPaths: this.completedPaths.map(path => clonePath(path))
    };
    // Keep the exact legacy snapshot shape for ordinary levels. Portal levels
    // carry parallel metadata so old callers that only know completedPaths do
    // not need to understand non-adjacent jumps.
    if (this.portalEnabled) {
      snapshot.completedSegments = this.completedSegments.map(segments => cloneSegments(segments));
      snapshot.completedTeleports = this.completedTeleports.map(teleports => cloneTeleports(teleports));
    }
    return snapshot;
  }

  restore(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.completedPaths)) return false;

    const hasBlockedCell = snapshot.completedPaths.some(path => (
      Array.isArray(path) && path.some(index => this.isValidCell(index) && this.blockedMask[index])
    ));
    if (hasBlockedCell) return false;

    const lineCount = (this.level.Lines || []).length;
    this.completedPaths = new Array(lineCount).fill(null);
    snapshot.completedPaths.slice(0, lineCount).forEach((path, lineIndex) => {
      this.completedPaths[lineIndex] = Array.isArray(path) ? path.slice() : null;
    });
    this.completedSegments = new Array(lineCount).fill(null);
    if (Array.isArray(snapshot.completedSegments)) {
      snapshot.completedSegments.slice(0, lineCount).forEach((segments, lineIndex) => {
        this.completedSegments[lineIndex] = Array.isArray(segments)
          ? cloneSegments(segments) : null;
      });
    } else if (this.portalEnabled) {
      this.completedPaths.forEach((path, lineIndex) => {
        if (path) this.completedSegments[lineIndex] = [path.slice()];
      });
    }
    this.completedTeleports = new Array(lineCount).fill(null);
    if (Array.isArray(snapshot.completedTeleports)) {
      snapshot.completedTeleports.slice(0, lineCount).forEach((teleports, lineIndex) => {
        this.completedTeleports[lineIndex] = Array.isArray(teleports)
          ? cloneTeleports(teleports) : null;
      });
    }
    this.selectedLine = -1;
    this.selectedCells = [];
    this.selectedSegments = [];
    this.selectedTeleports = [];
    this.pendingSnapshot = null;
    this.removedPathOnStart = false;
    this.portalPhase = PORTAL_PHASE.READY;
    this.portalLock = null;
    this.portalPending = null;
    this.portalUsedPairs = new Set();
    this.isGameOver = false;
    this.finishedAt = 0;
    this.rebuildOwners();
    this.notify();
    return true;
  }

  rebuildOwners() {
    const total = this.level.Width * this.level.Height;
    this.owner = new Array(total).fill(-1);
    this.completedCells = {};
    this.completed = this.completedPaths.map(Boolean);

    this.completedPaths.forEach((path, lineIndex) => {
      if (!path) return;
      path.forEach(cellIndex => {
        if (cellIndex < 0 || cellIndex >= total) return;
        if (this.blockedMask[cellIndex]) return;
        this.owner[cellIndex] = lineIndex;
        this.completedCells[cellIndex] = lineIndex;
      });
    });
    this.touched = this.owner.map(lineIndex => lineIndex >= 0);
  }

  clearLine(lineIndex) {
    if (lineIndex < 0 || !this.completedPaths[lineIndex]) return false;
    this.completedPaths[lineIndex] = null;
    if (this.completedSegments) this.completedSegments[lineIndex] = null;
    if (this.completedTeleports) this.completedTeleports[lineIndex] = null;
    this.rebuildOwners();
    return true;
  }

  selectedContains(index) {
    return this.selectedSegments.some(segment => Array.isArray(segment) && segment.indexOf(index) >= 0);
  }

  cellLine(index) {
    if (!this.isPlayableCell(index)) return -1;
    if (this.selectedContains(index)) return this.selectedLine;
    if (this.owner[index] >= 0) return this.owner[index];
    return this.fixedLine[index];
  }

  setSelectedSegments(segments) {
    this.selectedSegments = Array.isArray(segments) ? segments : [];
    const last = this.selectedSegments[this.selectedSegments.length - 1];
    this.selectedCells = Array.isArray(last) ? last : [];
  }

  currentSegment() {
    if (!this.selectedSegments.length) this.selectedSegments.push([]);
    return this.selectedSegments[this.selectedSegments.length - 1];
  }

  portalExitAvailable(portal, lineIndex) {
    if (!portal || !this.isPlayableCell(portal.exit)) return false;
    if (this.blockedMask[portal.exit]) return false;
    if (this.fixedLine[portal.exit] >= 0 && this.fixedLine[portal.exit] !== lineIndex) return false;
    if (this.owner[portal.exit] >= 0 && this.owner[portal.exit] !== lineIndex) return false;
    if (this.selectedContains(portal.exit)) return false;
    return true;
  }

  canEnterPortal(portal) {
    if (!portal || this.portalUsedPairs.has(portal.id)) return false;
    return this.portalExitAvailable(portal, this.selectedLine);
  }

  touchStart(index) {
    // Waiting is a separate gesture boundary. A wrong press explicitly
    // cancels the A segment; it must not fall through to normal endpoint
    // redraw logic or start the accidentally pressed line.
    if (this.portalPending && this.portalPhase === PORTAL_PHASE.PORTAL_WAIT) {
      if (index !== this.portalPending.exit) {
        this.cancelPortalContinuation();
        return false;
      }
      const portal = this.portalAt(this.portalPending.entry);
      if (!portal || !this.portalExitAvailable({
        id: portal.id,
        entry: this.portalPending.entry,
        exit: this.portalPending.exit
      }, this.portalPending.lineIndex)) return false;

      this.selectedLine = this.portalPending.lineIndex;
      this.setSelectedSegments(cloneSegments(this.portalPending.entrySegments));
      this.selectedSegments.push([index]);
      this.selectedCells = [index];
      this.selectedTeleports = cloneTeleports(this.portalPending.entryTeleports) || [];
      this.selectedTeleports.push({
        pairId: this.portalPending.pairId,
        from: this.portalPending.entry,
        to: this.portalPending.exit
      });
      this.portalUsedPairs = new Set(this.portalPending.usedPairIds || []);
      this.portalUsedPairs.add(this.portalPending.pairId);
      this.portalPending.continuationStarted = true;
      this.portalPhase = PORTAL_PHASE.PORTAL_CONTINUE;
      this.notify();
      return true;
    }

    if (this.isGameOver || !this.isPlayableCell(index) || this.fixedLine[index] < 0) return false;

    if (this.selectedLine >= 0) this.abortSelection();
    const lineIndex = this.fixedLine[index];
    this.pendingSnapshot = this.snapshot();
    this.removedPathOnStart = this.clearLine(lineIndex);
    this.selectedLine = lineIndex;
    this.setSelectedSegments([[index]]);
    this.selectedTeleports = [];
    this.portalPhase = PORTAL_PHASE.DRAWING;
    this.notify();
    return true;
  }

  touchMove(index) {
    if (this.isGameOver || this.selectedLine < 0 || !this.isPlayableCell(index)) return false;
    if (this.portalPhase === PORTAL_PHASE.PORTAL_LOCKED ||
        this.portalPhase === PORTAL_PHASE.PORTAL_WAIT) return false;

    const segment = this.currentSegment();
    const lastIndex = segment[segment.length - 1];
    if (index === lastIndex) return false;

    const existingIndex = segment.indexOf(index);
    if (existingIndex >= 0) {
      segment.splice(existingIndex + 1);
      this.selectedCells = segment.slice();
      this.notify();
      return true;
    }

    // A cell in an earlier segment is separated by a teleport edge and is
    // never a legal ordinary backtrack target.
    if (this.selectedSegments.slice(0, -1).some(previous => previous.indexOf(index) >= 0)) return false;
    if (!this.adjacent(lastIndex, index)) return false;
    if (this.owner[index] >= 0) return false;
    if (this.fixedLine[index] >= 0 && this.fixedLine[index] !== this.selectedLine) return false;

    const portal = this.portalAt(index);
    if (portal) {
      if (!this.canEnterPortal(portal)) return false;
      segment.push(index);
      this.selectedCells = segment.slice();
      this.portalUsedPairs.add(portal.id);
      this.portalLock = {
        pairId: portal.id,
        lineIndex: this.selectedLine,
        entry: portal.entry,
        exit: portal.exit
      };
      this.portalPhase = PORTAL_PHASE.PORTAL_LOCKED;
      this.notify();
      return true;
    }

    segment.push(index);
    this.selectedCells = segment.slice();
    if (this.portalPhase === PORTAL_PHASE.PORTAL_CONTINUE) {
      this.portalPhase = PORTAL_PHASE.DRAWING;
    }
    this.notify();
    return true;
  }

  enterPortalWait() {
    if (!this.portalLock || this.selectedLine < 0) return false;
    const lock = this.portalLock;
    this.portalPending = {
      lineIndex: this.selectedLine,
      pairId: lock.pairId,
      entry: lock.entry,
      exit: lock.exit,
      entrySegments: cloneSegments(this.selectedSegments),
      entryTeleports: cloneTeleports(this.selectedTeleports) || [],
      prePortalSnapshot: cloneSnapshot(this.pendingSnapshot || this.snapshot()),
      usedPairIds: Array.from(this.portalUsedPairs),
      continuationStarted: false
    };
    this.portalLock = null;
    this.portalPhase = PORTAL_PHASE.PORTAL_WAIT;
    this.notify();
    return false;
  }

  rollbackPortalSegment() {
    if (!this.portalPending) return false;
    this.setSelectedSegments(cloneSegments(this.portalPending.entrySegments));
    this.selectedTeleports = cloneTeleports(this.portalPending.entryTeleports) || [];
    this.selectedLine = this.portalPending.lineIndex;
    this.portalUsedPairs = new Set(this.portalPending.usedPairIds || []);
    // The currently pending pair is represented by the lock, not a completed
    // use. It remains retryable from B after an invalid B-side attempt.
    this.portalUsedPairs.add(this.portalPending.pairId);
    this.portalPhase = PORTAL_PHASE.PORTAL_WAIT;
    this.portalLock = null;
    this.portalPending.continuationStarted = false;
    this.notify();
    return true;
  }

  cancelPortalContinuation() {
    if (!this.portalPending && !this.portalLock) return false;
    const pending = this.portalPending;
    const snapshot = pending && pending.prePortalSnapshot
      ? pending.prePortalSnapshot
      : this.pendingSnapshot;
    if (snapshot && Array.isArray(snapshot.completedPaths)) {
      // Restore without touching the ordinary undo stack: an incorrect exit
      // is a reconnect affordance, not an undoable failure.
      this.restore(snapshot);
    } else {
      this.selectedLine = -1;
      this.selectedCells = [];
      this.selectedSegments = [];
      this.selectedTeleports = [];
      this.portalPending = null;
      this.portalLock = null;
      this.portalUsedPairs = new Set();
      this.portalPhase = PORTAL_PHASE.READY;
      this.pendingSnapshot = null;
      this.removedPathOnStart = false;
      this.notify();
    }
    return true;
  }

  touchEnd(index) {
    if (this.isGameOver || this.selectedLine < 0) return false;

    if (this.portalPhase === PORTAL_PHASE.PORTAL_LOCKED) {
      // Once A has been reached, the release coordinate is irrelevant. This
      // prevents a final out-of-board sample from cancelling the A segment.
      return this.enterPortalWait();
    }

    if (this.portalPhase === PORTAL_PHASE.PORTAL_WAIT) return false;

    const portalContinuation = !!this.portalPending &&
      (this.portalPhase === PORTAL_PHASE.PORTAL_CONTINUE ||
       this.portalPhase === PORTAL_PHASE.DRAWING);

    if (portalContinuation) {
      if (index >= 0 && index !== this.selectedCells[this.selectedCells.length - 1]) {
        if (!this.touchMove(index)) {
          this.rollbackPortalSegment();
          return false;
        }
        if (this.portalPhase === PORTAL_PHASE.PORTAL_LOCKED) return this.enterPortalWait();
      }
      if (this.selectedCells.length <= 1) {
        this.rollbackPortalSegment();
        return false;
      }
      return this.commitIfAtTarget();
    }

    if (index !== -1 && !this.isPlayableCell(index)) {
      this.cancelSelection();
      return false;
    }

    if (index >= 0 && index !== this.selectedCells[this.selectedCells.length - 1]) {
      if (!this.touchMove(index)) {
        this.cancelSelection();
        return false;
      }
      if (this.portalPhase === PORTAL_PHASE.PORTAL_LOCKED) return this.enterPortalWait();
    }

    return this.commitIfAtTarget();
  }

  commitIfAtTarget() {
    const lineIndex = this.selectedLine;
    const line = (this.level.Lines || [])[lineIndex];
    if (!line) {
      this.cancelSelection();
      return false;
    }
    const allCells = this.flattenSegments(this.selectedSegments);
    const startIndex = allCells[0];
    const targetIndex = startIndex === line.Start ? line.End : line.Start;
    const lastIndex = this.selectedCells[this.selectedCells.length - 1];
    const valid = allCells.length > 1 && lastIndex === targetIndex;
    if (!valid) {
      if (this.portalPending) this.rollbackPortalSegment();
      else this.cancelSelection();
      return false;
    }

    const previous = this.pendingSnapshot;
    this.completedPaths[lineIndex] = allCells.slice();
    if (this.portalEnabled) {
      this.completedSegments[lineIndex] = cloneSegments(this.selectedSegments);
      this.completedTeleports[lineIndex] = cloneTeleports(this.selectedTeleports);
    }
    this.selectedLine = -1;
    this.selectedCells = [];
    this.selectedSegments = [];
    this.selectedTeleports = [];
    this.pendingSnapshot = null;
    this.removedPathOnStart = false;
    this.portalPhase = PORTAL_PHASE.READY;
    this.portalLock = null;
    this.portalPending = null;
    this.portalUsedPairs = new Set();
    this.rebuildOwners();
    if (previous) this.undoStack.push(previous);

    if (this.isBoardComplete()) {
      this.isGameOver = true;
      this.portalPhase = PORTAL_PHASE.SOLVED;
      this.finishedAt = Date.now();
    }
    this.notify();
    return true;
  }

  cancelSelection() {
    if (this.portalPending || this.portalLock) return this.cancelPortalContinuation();
    if (this.selectedLine < 0) return false;
    const shouldRecordClear = this.removedPathOnStart && this.pendingSnapshot;
    this.selectedLine = -1;
    this.selectedCells = [];
    this.selectedSegments = [];
    this.selectedTeleports = [];
    this.portalPhase = PORTAL_PHASE.READY;
    if (shouldRecordClear) this.undoStack.push(this.pendingSnapshot);
    this.pendingSnapshot = null;
    this.removedPathOnStart = false;
    this.notify();
    return true;
  }

  abortSelection() {
    if (this.portalPending || this.portalLock) return this.cancelPortalContinuation();
    if (this.selectedLine < 0) return false;
    const previous = this.removedPathOnStart ? this.pendingSnapshot : null;
    this.selectedLine = -1;
    this.selectedCells = [];
    this.selectedSegments = [];
    this.selectedTeleports = [];
    this.portalPhase = PORTAL_PHASE.READY;
    this.pendingSnapshot = null;
    this.removedPathOnStart = false;
    if (previous && Array.isArray(previous.completedPaths)) {
      this.completedPaths = previous.completedPaths.map(path => path ? path.slice() : null);
      if (this.portalEnabled && Array.isArray(previous.completedSegments)) {
        this.completedSegments = previous.completedSegments.map(segments => cloneSegments(segments));
      }
      if (this.portalEnabled && Array.isArray(previous.completedTeleports)) {
        this.completedTeleports = previous.completedTeleports.map(teleports => cloneTeleports(teleports));
      }
      this.rebuildOwners();
    }
    this.notify();
    return true;
  }

  undo() {
    if (this.isGameOver) return false;
    if (this.portalPending || this.portalLock) return this.cancelPortalContinuation();
    if (!this.undoStack.length) return false;
    return this.restore(this.undoStack.pop());
  }

  canUndo() {
    return !this.isGameOver && (this.undoStack.length > 0 || !!this.portalPending || !!this.portalLock);
  }

  filledCount() {
    return this.owner.reduce((count, lineIndex, index) => (
      count + (!this.blockedMask[index] && lineIndex >= 0 ? 1 : 0)
    ), 0);
  }

  isBoardComplete() {
    if (this.portalPending || this.portalLock || this.portalPhase === PORTAL_PHASE.PORTAL_CONTINUE) return false;
    return this.owner.every((lineIndex, index) => (
      this.blockedMask[index] || lineIndex >= 0
    ));
  }
}

GameRunner.PORTAL_PHASE = PORTAL_PHASE;

module.exports = GameRunner;
