'use strict';

const PORTAL_LOCKED = 'PORTAL_LOCKED';
const PORTAL_WAIT = 'PORTAL_WAIT';
const PORTAL_CONTINUE = 'PORTAL_CONTINUE';
const DRAWING = 'DRAWING';

function validPoint(point) {
  return !!point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y));
}

function eventFromResult(result, action) {
  const value = result && typeof result === 'object' ? result : {
    changed: false,
    status: 'ignored',
    phase: null,
    expectedExit: null,
    commit: null,
    outcome: 'playing'
  };
  const details = {
    action,
    changed: value.changed === true,
    status: value.status || 'ignored',
    phase: value.phase || null,
    expectedExit: Number.isInteger(value.expectedExit) ? value.expectedExit : null,
    outcome: value.outcome || 'playing'
  };

  if (value.commit || value.status === 'completed') {
    return Object.assign({ type: 'path-completed', commit: value.commit || null }, details);
  }
  if (value.status === 'portal-wait' || value.phase === PORTAL_WAIT) {
    return Object.assign({ type: 'portal-wait' }, details);
  }
  if (action === 'cancel') {
    return Object.assign({ type: 'cancelled' }, details);
  }
  // A rejected release is player feedback, while a pointer/lifecycle cancel is
  // an interruption. Keep those event meanings separate even though Runner
  // reports both state transitions with `status: cancelled`.
  if (action === 'end') {
    return Object.assign({ type: 'invalid-selection' }, details);
  }
  if (value.status === 'cancelled') {
    return Object.assign({ type: 'cancelled' }, details);
  }
  if (action === 'start') {
    return Object.assign({
      type: value.changed === true ? 'selection-started' : 'invalid-selection'
    }, details);
  }
  if (action === 'move' && value.changed === true) {
    return Object.assign({ type: 'step' }, details);
  }
  return null;
}

function appendEvent(events, event) {
  if (!event) return;
  if (event.type !== 'step') {
    events.push(event);
    return;
  }
  const existing = events.find(item => item.type === 'step');
  if (!existing) {
    events.push(Object.assign({ count: 1 }, event));
    return;
  }
  const count = existing.count + 1;
  Object.keys(event).forEach(key => { existing[key] = event[key]; });
  existing.count = count;
}

class BoardInputController {
  constructor(runner, locator) {
    this.runner = runner || null;
    this.locator = locator || null;
    this.pointer = null;
  }

  setRunner(runner) {
    this.runner = runner || null;
    this.pointer = null;
  }

  setLocator(locator) {
    this.locator = locator || null;
    this.pointer = null;
  }

  isActive() {
    return !!this.pointer;
  }

  start(point) {
    if (!validPoint(point) || this.pointer || !this.hasRunnerMethod('startGesture')) return [];
    const cell = this.cellAt(point);
    const result = this.runner.startGesture(cell);
    const event = eventFromResult(result, 'start');
    const phase = result && result.phase;
    const status = result && result.status;
    const captures = status === 'drawing' || phase === DRAWING ||
      phase === PORTAL_CONTINUE || phase === PORTAL_LOCKED;
    if (captures) {
      this.pointer = {
        id: point.id,
        last: { x: Number(point.x), y: Number(point.y) },
        lastCell: cell,
        locked: phase === PORTAL_LOCKED
      };
    }
    return event ? [event] : [];
  }

  move(point) {
    if (!this.matchesPointer(point) || !this.hasRunnerMethod('moveGesture')) return [];
    if (this.pointer.locked) {
      this.pointer.last = { x: Number(point.x), y: Number(point.y) };
      return [];
    }
    const traced = this.trace(this.pointer.last, point, this.pointer.lastCell);
    this.pointer.last = { x: Number(point.x), y: Number(point.y) };
    this.pointer.lastCell = traced.lastCell;
    this.pointer.locked = traced.locked;
    return traced.events;
  }

  end(point) {
    if (!this.pointer || (point && !this.matchesPointer(point)) ||
        !this.hasRunnerMethod('endGesture')) return [];
    const active = this.pointer;
    const events = [];
    if (validPoint(point) && !active.locked && this.hasRunnerMethod('moveGesture')) {
      const traced = this.trace(active.last, point, active.lastCell);
      events.push.apply(events, traced.events);
      active.lastCell = traced.lastCell;
      active.locked = traced.locked;
    }
    const cell = validPoint(point) ? this.cellAt(point) : -1;
    const result = this.runner.endGesture(cell);
    const event = eventFromResult(result, 'end');
    if (event) events.push(event);
    this.pointer = null;
    return events;
  }

  cancel(point, reason) {
    if (!this.pointer || (point && !this.matchesPointer(point)) ||
        !this.hasRunnerMethod('cancelGesture')) return [];
    const result = this.runner.cancelGesture(reason || 'pointer-cancel');
    this.pointer = null;
    const event = eventFromResult(result, 'cancel');
    return event ? [event] : [];
  }

  trace(from, to, initialCell) {
    const events = [];
    const layout = this.getBoardLayout();
    if (!layout || !(layout.cell > 0) || !validPoint(from) || !validPoint(to)) {
      return { events, lastCell: initialCell, locked: false };
    }
    const dx = Number(to.x) - Number(from.x);
    const dy = Number(to.y) - Number(from.y);
    const distance = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(1, Math.ceil(distance / (layout.cell * 0.32)));
    let lastCell = initialCell;
    let locked = false;
    for (let step = 1; step <= steps; step++) {
      const point = {
        x: Number(from.x) + dx * step / steps,
        y: Number(from.y) + dy * step / steps
      };
      const cell = this.cellAt(point);
      if (cell < 0 || cell === lastCell) continue;
      lastCell = cell;
      const result = this.runner.moveGesture(cell);
      const event = eventFromResult(result, 'move');
      appendEvent(events, event);
      if (result && result.phase === PORTAL_LOCKED) {
        locked = true;
        break;
      }
    }
    return { events, lastCell, locked };
  }

  hasRunnerMethod(name) {
    return !!this.runner && typeof this.runner[name] === 'function';
  }

  matchesPointer(point) {
    return validPoint(point) && !!this.pointer && point.id === this.pointer.id;
  }

  cellAt(point) {
    if (!this.locator || typeof this.locator.cellAt !== 'function' || !validPoint(point)) return -1;
    return this.locator.cellAt(Number(point.x), Number(point.y));
  }

  getBoardLayout() {
    if (!this.locator || typeof this.locator.getBoardLayout !== 'function') return null;
    return this.locator.getBoardLayout();
  }
}

module.exports = BoardInputController;
