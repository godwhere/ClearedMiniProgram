'use strict';

const portalSchema = require('./portal-schema.js');
const mechanicPolicies = require('./mechanics/index.js');

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

const OUTCOME = {
  PLAYING: 'playing',
  WON: 'won',
  FAILED: 'failed'
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

function cloneRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const copy = {};
  Object.keys(value).forEach(key => {
    copy[key] = Array.isArray(value[key]) ? value[key].slice() : value[key];
  });
  return copy;
}

function cloneLines(lines) {
  return Array.isArray(lines) ? lines.map(line => cloneRecord(line)) : [];
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
    this._revision = 0;

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
    const mechanic = portalSchema.rawMechanic(this.level);
    const rulesVersion = portalSchema.rawRulesVersion(this.level);
    const portalPolicy = mechanicPolicies.resolve(mechanic, rulesVersion);
    // Portal fields on legacy, malformed, or future-version levels must not
    // silently change movement semantics. Strict diagnostics remain the
    // authoring validator's responsibility; runtime falls back to ordinary
    // four-direction movement for every contract outside the local allowlist.
    const normalizedPortals = portalPolicy
      ? portalPolicy.normalize(configuredPortals, total)
      : [];
    // Unknown versions and malformed declarations retain ordinary movement
    // semantics. Publishing validation remains strict and reports diagnostics.
    this.portalDefinitions = portalPolicy &&
      portalPolicy.accepts(configuredPortals, normalizedPortals)
      ? normalizedPortals : [];
    this.portalPolicy = this.portalDefinitions.length ? portalPolicy : null;
    this.portalRulesVersion = this.portalPolicy ? this.portalPolicy.rulesVersion : null;
    this.portalEnabled = this.portalDefinitions.length > 0;
    this.reset();
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
    // Keep isGameOver as the legacy "won" flag.  Terminal input/timer guards
    // use outcome so a failed board can stop cleanly without being mistaken
    // for a completed level by older application code.
    this.outcome = OUTCOME.PLAYING;
    this.failureReason = null;
    this.remainingPlayableCells = 0;
    this.notify();
  }

  configurePortalIndex() {
    const portals = [];
    const seenCells = Object.create(null);
    const seenIds = Object.create(null);
    this.portalDefinitions.forEach(definition => {
      const cells = Array.isArray(definition.cells)
        ? definition.cells.slice()
        : [definition.A, definition.B];
      // Runtime is deliberately defensive; strict authoring validation is
      // performed by portal-validation.js. Invalid endpoint/blocked conflicts
      // are ignored here so a malformed level cannot make a cell unplayable.
      if (cells.length < 2 || cells.some(cell => (
        !this.isPlayableCell(cell) || this.fixedLine[cell] >= 0 || seenCells[cell]
      )) || seenIds[definition.id]) return;
      const portal = { id: definition.id, cells };
      if (this.portalRulesVersion === 1) {
        portal.A = cells[0];
        portal.B = cells[1];
      }
      portals.push(portal);
      seenIds[portal.id] = true;
      cells.forEach(cell => { seenCells[cell] = true; });
    });
    const index = this.portalPolicy
      ? this.portalPolicy.buildIndex(portals)
      : portalSchema.buildPortalIndex([]);
    this.portals = index.portals;
    this.portalByCell = index.portalByCell;
    this.portalById = index.portalById;
    this.portalEnabled = this.portals.length > 0;
  }

  notify() {
    this._revision += 1;
    this.onChange(this);
  }

  elapsedMs() {
    const now = this.isTerminal() ? this.finishedAt : (this.pausedAt || Date.now());
    return Math.max(0, now - this.startedAt);
  }

  pause() {
    if (!this.isTerminal() && !this.pausedAt) this.pausedAt = Date.now();
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
    if (this.portalRulesVersion === 1 && Number.isInteger(value.exit)) {
      return { id: value.id, entry: value.entry, exit: value.exit };
    }
    return {
      id: value.id,
      portalId: value.portalId || value.id,
      entry: value.entry,
      exits: Array.isArray(value.exits) ? value.exits.slice() : []
    };
  }

  portalExits(index) {
    const portal = this.portalAt(index);
    if (!portal) return [];
    if (Array.isArray(portal.exits)) return portal.exits.slice();
    return Number.isInteger(portal.exit) ? [portal.exit] : [];
  }

  portalExit(index) {
    if (this.portalRulesVersion !== 1) return -1;
    const portal = this.portalAt(index);
    return portal ? portal.exit : -1;
  }

  isPortalCell(index) {
    return !!this.portalAt(index);
  }

  getBoardState() {
    return {
      width: Number(this.level.Width) || 0,
      height: Number(this.level.Height) || 0,
      lines: cloneLines(this.level.Lines),
      blocked: this.blocked.slice(),
      blockedMask: this.blockedMask.slice(),
      owner: this.owner.slice(),
      fixedLine: this.fixedLine.slice()
    };
  }

  getSelectionState() {
    return {
      lineIndex: this.selectedLine,
      cells: clonePath(this.selectedCells) || [],
      segments: cloneSegments(this.selectedSegments) || [],
      teleports: cloneTeleports(this.selectedTeleports) || []
    };
  }

  getMechanicState() {
    const pending = this.portalPending ? {
      lineIndex: this.portalPending.lineIndex,
      pairId: this.portalPending.pairId || null,
      portalId: this.portalPending.portalId || this.portalPending.pairId || null,
      entry: this.portalPending.entry,
      exit: Number.isInteger(this.portalPending.exit) ? this.portalPending.exit : null,
      eligibleExits: Array.isArray(this.portalPending.eligibleExits)
        ? this.portalPending.eligibleExits.slice()
        : (Number.isInteger(this.portalPending.exit) ? [this.portalPending.exit] : []),
      selectedExit: Number.isInteger(this.portalPending.selectedExit)
        ? this.portalPending.selectedExit : null,
      entryCells: this.flattenSegments(this.portalPending.entrySegments),
      entrySegments: cloneSegments(this.portalPending.entrySegments) || [],
      entryTeleports: cloneTeleports(this.portalPending.entryTeleports) || [],
      usedPairIds: Array.isArray(this.portalPending.usedPairIds)
        ? this.portalPending.usedPairIds.slice()
        : [],
      continuationStarted: this.portalPending.continuationStarted === true
    } : null;
    const locked = this.portalLock ? cloneRecord(this.portalLock) : null;
    return {
      id: this.portalEnabled ? 'portal' : null,
      rulesVersion: this.portalEnabled ? this.portalRulesVersion : null,
      phase: this.portalPhase,
      portals: this.portals.map(portal => {
        const result = {
          id: portal.id,
          cells: Array.isArray(portal.cells) ? portal.cells.slice() : [portal.A, portal.B]
        };
        if (this.portalRulesVersion === 1) {
          result.A = portal.A;
          result.B = portal.B;
        }
        return result;
      }),
      pending,
      locked,
      usedPairIds: Array.from(this.portalUsedPairs || [])
    };
  }

  getCompletedLine(lineIndex) {
    if (!Number.isInteger(lineIndex) || lineIndex < 0 ||
        !Array.isArray(this.completedPaths[lineIndex])) return null;
    return {
      lineIndex,
      cells: this.completedPaths[lineIndex].slice(),
      segments: Array.isArray(this.completedSegments[lineIndex])
        ? cloneSegments(this.completedSegments[lineIndex])
        : null,
      teleports: Array.isArray(this.completedTeleports[lineIndex])
        ? cloneTeleports(this.completedTeleports[lineIndex])
        : null
    };
  }

  getViewState() {
    return {
      outcome: this.outcome,
      failureReason: this.failureReason,
      remainingPlayableCells: this.remainingCellCount(),
      terminal: this.isTerminal(),
      elapsedMs: this.elapsedMs(),
      timeText: this.timeText(),
      canUndo: this.canUndo(),
      levelId: this.level.Id || this.level.id || null,
      board: this.getBoardState(),
      completedLines: this.completed.slice(),
      completedPaths: this.completedPaths.map(path => clonePath(path)),
      completedSegments: this.completedSegments.map(segments => cloneSegments(segments)),
      completedTeleports: this.completedTeleports.map(teleports => cloneTeleports(teleports)),
      selection: this.getSelectionState(),
      mechanic: this.getMechanicState()
    };
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
      portalId: context.portalId || context.pairId || null,
      entry: context.entry === undefined ? null : context.entry,
      exit: Number.isInteger(context.exit) ? context.exit : null,
      eligibleExits: Array.isArray(context.eligibleExits)
        ? context.eligibleExits.slice()
        : (Number.isInteger(context.exit) ? [context.exit] : []),
      selectedExit: Number.isInteger(context.selectedExit) ? context.selectedExit : null,
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
    this.outcome = OUTCOME.PLAYING;
    this.failureReason = null;
    this.remainingPlayableCells = 0;
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

  portalExitAvailableAt(exit, lineIndex) {
    if (!this.isPlayableCell(exit)) return false;
    if (this.blockedMask[exit]) return false;
    if (this.fixedLine[exit] >= 0 && this.fixedLine[exit] !== lineIndex) return false;
    if (this.owner[exit] >= 0 && this.owner[exit] !== lineIndex) return false;
    if (this.selectedContains(exit)) return false;
    return true;
  }

  portalExitAvailable(portal, lineIndex) {
    return !!portal && Number.isInteger(portal.exit) &&
      this.portalExitAvailableAt(portal.exit, lineIndex);
  }

  eligiblePortalExits(portal, lineIndex) {
    if (!portal) return [];
    const exits = Array.isArray(portal.exits)
      ? portal.exits
      : (Number.isInteger(portal.exit) ? [portal.exit] : []);
    return exits.filter(exit => this.portalExitAvailableAt(exit, lineIndex));
  }

  canEnterPortal(portal) {
    if (!portal || this.portalUsedPairs.has(portal.id)) return false;
    const maxTeleports = this.portalPolicy && this.portalPolicy.maxTeleportsPerLine;
    if (Number.isInteger(maxTeleports) && this.selectedTeleports.length >= maxTeleports) return false;
    return this.eligiblePortalExits(portal, this.selectedLine).length > 0;
  }

  gestureResult(action, before, legacyValue, commit) {
    const changed = this._revision !== before.revision;
    let status = 'ignored';
    if (commit) {
      status = 'completed';
    } else if (changed && this.portalPhase === PORTAL_PHASE.PORTAL_WAIT) {
      status = 'portal-wait';
    } else if (changed && this.selectedLine >= 0) {
      status = 'drawing';
    } else if (changed) {
      status = 'cancelled';
    } else if (this.selectedLine >= 0 &&
        (this.portalPhase === PORTAL_PHASE.DRAWING ||
         this.portalPhase === PORTAL_PHASE.PORTAL_CONTINUE ||
         this.portalPhase === PORTAL_PHASE.PORTAL_LOCKED)) {
      status = 'drawing';
    }
    const mechanic = this.getMechanicState();
    const activePortal = mechanic.pending || mechanic.locked;
    const expectedExits = activePortal && Array.isArray(activePortal.eligibleExits)
      ? activePortal.eligibleExits.slice()
      : (activePortal && Number.isInteger(activePortal.exit) ? [activePortal.exit] : []);
    const expectedExit = this.portalRulesVersion === 1 && expectedExits.length === 1
      ? expectedExits[0] : null;
    const result = {
      changed,
      status,
      phase: this.portalPhase,
      expectedExit: Number.isInteger(expectedExit) ? expectedExit : null,
      expectedExits,
      commit: commit || null,
      outcome: this.outcome
    };
    Object.defineProperty(result, 'legacyValue', {
      configurable: false,
      enumerable: false,
      value: legacyValue === true,
      writable: false
    });
    return result;
  }

  startGesture(index) {
    const before = { revision: this._revision, phase: this.portalPhase };
    const legacyValue = this._touchStart(index);
    return this.gestureResult('start', before, legacyValue, null);
  }

  moveGesture(index) {
    const before = { revision: this._revision, phase: this.portalPhase };
    const legacyValue = this._touchMove(index);
    return this.gestureResult('move', before, legacyValue, null);
  }

  endGesture(index) {
    const before = {
      revision: this._revision,
      phase: this.portalPhase,
      lineIndex: this.selectedLine
    };
    const legacyValue = this._touchEnd(index);
    const commit = legacyValue ? this.getCompletedLine(before.lineIndex) : null;
    return this.gestureResult('end', before, legacyValue, commit);
  }

  cancelGesture(reason) {
    const before = { revision: this._revision, phase: this.portalPhase };
    let legacyValue = false;
    if (reason === 'reset') {
      this.reset();
      legacyValue = true;
    } else if (reason === 'pointer-cancel') {
      legacyValue = this._handlePointerCancel();
    } else {
      legacyValue = this.abortSelection();
    }
    return this.gestureResult('cancel', before, legacyValue, null);
  }

  touchStart(index) {
    return this.startGesture(index).legacyValue;
  }

  touchMove(index) {
    return this.moveGesture(index).legacyValue;
  }

  touchEnd(index) {
    return this.endGesture(index).legacyValue;
  }

  handlePointerCancel() {
    return this.cancelGesture('pointer-cancel').legacyValue;
  }

  _touchStart(index) {
    // Waiting is a separate gesture boundary. A wrong press explicitly
    // cancels the A segment; it must not fall through to normal endpoint
    // redraw logic or start the accidentally pressed line.
    if (this.portalPending && this.portalPhase === PORTAL_PHASE.PORTAL_WAIT) {
      const eligibleExits = Array.isArray(this.portalPending.eligibleExits)
        ? this.portalPending.eligibleExits
        : (Number.isInteger(this.portalPending.exit) ? [this.portalPending.exit] : []);
      if (eligibleExits.indexOf(index) < 0) {
        this.cancelPortalContinuation();
        return false;
      }
      const portal = this.portalAt(this.portalPending.entry);
      const currentExits = this.eligiblePortalExits(portal, this.portalPending.lineIndex);
      if (!portal || currentExits.indexOf(index) < 0) return false;

      this.selectedLine = this.portalPending.lineIndex;
      this.setSelectedSegments(cloneSegments(this.portalPending.entrySegments));
      this.selectedSegments.push([index]);
      this.selectedCells = [index];
      this.selectedTeleports = cloneTeleports(this.portalPending.entryTeleports) || [];
      const teleport = {
        from: this.portalPending.entry,
        to: index
      };
      const portalId = this.portalPending.portalId || this.portalPending.pairId;
      if (this.portalRulesVersion === 1) teleport.pairId = portalId;
      else teleport.portalId = portalId;
      this.selectedTeleports.push(teleport);
      this.portalUsedPairs = new Set(this.portalPending.usedPairIds || []);
      this.portalUsedPairs.add(portalId);
      this.portalPending.selectedExit = index;
      this.portalPending.continuationStarted = true;
      this.portalPhase = PORTAL_PHASE.PORTAL_CONTINUE;
      this.notify();
      return true;
    }

    if (this.isTerminal() || !this.isPlayableCell(index) || this.fixedLine[index] < 0) return false;

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

  _touchMove(index) {
    if (this.isTerminal() || this.selectedLine < 0 || !this.isPlayableCell(index)) return false;
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
      const eligibleExits = this.eligiblePortalExits(portal, this.selectedLine);
      segment.push(index);
      this.selectedCells = segment.slice();
      this.portalUsedPairs.add(portal.id);
      this.portalLock = {
        pairId: this.portalRulesVersion === 1 ? portal.id : null,
        portalId: portal.id,
        lineIndex: this.selectedLine,
        entry: portal.entry,
        exit: this.portalRulesVersion === 1 ? eligibleExits[0] : null,
        eligibleExits
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
      portalId: lock.portalId || lock.pairId,
      entry: lock.entry,
      exit: lock.exit,
      eligibleExits: Array.isArray(lock.eligibleExits)
        ? lock.eligibleExits.slice()
        : (Number.isInteger(lock.exit) ? [lock.exit] : []),
      selectedExit: null,
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
    this.portalUsedPairs.add(this.portalPending.portalId || this.portalPending.pairId);
    this.portalPhase = PORTAL_PHASE.PORTAL_WAIT;
    this.portalLock = null;
    this.portalPending.continuationStarted = false;
    this.portalPending.selectedExit = null;
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

  /**
   * Handle an operating-system pointer cancellation without conflating it
   * with the player's explicit reset/undo/leave actions.
   *
   * - cancellation at a locked entry is equivalent to releasing there;
   * - cancellation while continuing from the exit drops only that exit
   *   segment and preserves the entry segment in PORTAL_WAIT;
   * - ordinary drawing keeps the legacy abort/restore behavior.
   */
  _handlePointerCancel() {
    if (this.portalPhase === PORTAL_PHASE.PORTAL_LOCKED && this.portalLock) {
      this.enterPortalWait();
      return true;
    }
    if (this.portalPending &&
        (this.portalPhase === PORTAL_PHASE.PORTAL_CONTINUE ||
         this.portalPhase === PORTAL_PHASE.DRAWING)) {
      return this.rollbackPortalSegment();
    }
    if (this.portalPending && this.portalPhase === PORTAL_PHASE.PORTAL_WAIT) {
      // There is no active pointer in the waiting state. A late cancellation
      // from the entry gesture is therefore inert and must not erase A.
      return false;
    }
    return this.abortSelection();
  }

  _touchEnd(index) {
    if (this.isTerminal() || this.selectedLine < 0) return false;

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
        if (!this._touchMove(index)) {
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
      if (!this._touchMove(index)) {
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

    this.evaluateOutcome();
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
    if (this.isTerminal()) return false;
    if (this.portalPending || this.portalLock) return this.cancelPortalContinuation();
    if (!this.undoStack.length) return false;
    return this.restore(this.undoStack.pop());
  }

  canUndo() {
    return !this.isTerminal() && (this.undoStack.length > 0 || !!this.portalPending || !!this.portalLock);
  }

  isTerminal() {
    return this.outcome !== OUTCOME.PLAYING;
  }

  allLinesCompleted() {
    return this.completed.length > 0 && this.completed.every(Boolean);
  }

  isRequiredCoverageCell(index) {
    if (!this.isValidCell(index) || this.blockedMask[index]) return false;
    if (this.portalPolicy && this.portalPolicy.requiresPortalCoverage === false &&
        this.isPortalCell(index)) return false;
    return true;
  }

  remainingCellCount() {
    return this.owner.reduce((count, lineIndex, index) => (
      count + (this.isRequiredCoverageCell(index) && lineIndex < 0 ? 1 : 0)
    ), 0);
  }

  finishOutcome(outcome, reason) {
    if (this.isTerminal()) return this.outcome;
    this.outcome = outcome;
    this.failureReason = reason || null;
    this.remainingPlayableCells = this.remainingCellCount();
    this.finishedAt = Date.now();
    this.isGameOver = outcome === OUTCOME.WON;
    if (outcome === OUTCOME.WON) this.portalPhase = PORTAL_PHASE.SOLVED;
    return this.outcome;
  }

  evaluateOutcome() {
    if (!this.allLinesCompleted()) return this.outcome;
    if (this.isBoardComplete()) {
      return this.finishOutcome(OUTCOME.WON);
    }
    return this.finishOutcome(OUTCOME.FAILED, 'unfilled-cells');
  }

  filledCount() {
    return this.owner.reduce((count, lineIndex, index) => (
      count + (!this.blockedMask[index] && lineIndex >= 0 ? 1 : 0)
    ), 0);
  }

  isBoardComplete() {
    if (!this.allLinesCompleted()) return false;
    if (this.portalPending || this.portalLock || this.portalPhase === PORTAL_PHASE.PORTAL_CONTINUE) return false;
    return this.owner.every((lineIndex, index) => (
      !this.isRequiredCoverageCell(index) || lineIndex >= 0
    ));
  }
}

GameRunner.PORTAL_PHASE = PORTAL_PHASE;
GameRunner.OUTCOME = OUTCOME;

module.exports = GameRunner;
