'use strict';

const portalValidation = require('../core/portal-validation.js');

// Authoring-only exact path-cover search. The frontier is at most eight cells
// wide; larger boards or new movement rules require a different content tool.
// A state cap returns "limit", never a false claim that a level has no bypass.
function solveWithoutPortals(level, options) {
  const width = level && level.Width;
  const height = level && level.Height;
  const lines = level && level.Lines;
  const maxStates = options && Number.isInteger(options.maxStates)
    ? Math.max(1, options.maxStates) : 250000;
  if (!Number.isInteger(width) || !Number.isInteger(height) ||
      width < 1 || height < 1 || width > 8 || height > 8 ||
      !Array.isArray(lines) || !lines.length ||
      lines.some(line => !line || typeof line !== 'object') ||
      (level.Blocked !== undefined && !Array.isArray(level.Blocked))) {
    return { status: 'invalid', paths: null, states: 0 };
  }
  const validation = portalValidation.validatePortalLevel(level);
  if (!validation.ok || (level.Mechanic === 'portal' && level.PortalRulesVersion !== 2)) {
    return { status: 'invalid', paths: null, states: 0 };
  }

  const total = width * height;
  if ((level.Blocked || []).some(cell => !Number.isInteger(cell) || cell < 0 || cell >= total)) {
    return { status: 'invalid', paths: null, states: 0 };
  }
  const playable = new Array(total).fill(true);
  (level.Blocked || []).forEach(cell => { playable[cell] = false; });
  Object.keys(validation.portalByCell || {}).forEach(cell => {
    playable[Number(cell)] = false;
  });
  const endpoint = new Array(total).fill(-1);
  for (let color = 0; color < lines.length; color += 1) {
    const line = lines[color];
    for (const cell of [line.Start, line.End]) {
      if (!Number.isInteger(cell) || cell < 0 || cell >= total ||
          !playable[cell] || endpoint[cell] >= 0) {
        return { status: 'invalid', paths: null, states: 0 };
      }
      endpoint[cell] = color;
    }
  }

  const memo = new Set();
  const decisions = [];
  let answer = null;
  let states = 0;
  let limited = false;

  function canonical(state) {
    const remap = new Map();
    let nextId = 1;
    [state.left].concat(state.frontier).forEach(id => {
      if (id && !remap.has(id)) remap.set(id, nextId++);
    });
    const result = {
      left: state.left ? remap.get(state.left) : 0,
      frontier: state.frontier.map(id => id ? remap.get(id) : 0),
      components: {}
    };
    remap.forEach((id, oldId) => { result.components[id] = state.components[oldId]; });
    return result;
  }

  function stateKey(index, state) {
    let key = `${index}|${state.left},${state.frontier.join(',')}|`;
    Object.keys(state.components).forEach(id => {
      const component = state.components[id];
      key += `${id}:${component.color}:${component.count},`;
    });
    return key;
  }

  function referenceCount(state, id) {
    let count = state.left === id ? 1 : 0;
    state.frontier.forEach(value => { if (value === id) count += 1; });
    return count;
  }

  function visit(index, input) {
    states += 1;
    if (states > maxStates) {
      limited = true;
      return false;
    }
    if (index === total) {
      if (input.left || input.frontier.some(Boolean) || Object.keys(input.components).length) return false;
      answer = decisions.slice();
      return true;
    }

    const state = canonical(input);
    const key = stateKey(index, state);
    if (memo.has(key)) return false;
    memo.add(key);
    const col = index % width;
    const row = Math.floor(index / width);
    if (!playable[index]) {
      if (state.left || state.frontier[col]) return false;
      return visit(index + 1, {
        left: 0,
        frontier: state.frontier.slice(),
        components: Object.assign({}, state.components)
      });
    }

    const incoming = [];
    if (state.left) incoming.push(state.left);
    if (state.frontier[col]) incoming.push(state.frontier[col]);
    // Joining the two loose ends of one component would close a cycle.
    if (incoming.length === 2 && incoming[0] === incoming[1]) return false;
    const needed = (endpoint[index] >= 0 ? 1 : 2) - incoming.length;
    if (needed < 0 || needed > 2) return false;
    const rightAvailable = col + 1 < width && playable[index + 1];
    const downAvailable = row + 1 < height && playable[index + width];
    const choices = [];
    if (needed === 0) choices.push([false, false]);
    if (needed === 1) {
      if (rightAvailable) choices.push([true, false]);
      if (downAvailable) choices.push([false, true]);
    }
    if (needed === 2 && rightAvailable && downAvailable) choices.push([true, true]);

    for (const [right, down] of choices) {
      const next = { left: 0, frontier: state.frontier.slice(), components: {} };
      Object.keys(state.components).forEach(id => {
        next.components[id] = Object.assign({}, state.components[id]);
      });
      next.frontier[col] = 0;
      let id;
      if (!incoming.length) {
        id = Math.max(0, ...Object.keys(next.components).map(Number)) + 1;
        next.components[id] = { color: -1, count: 0 };
      } else {
        id = incoming[0];
        if (incoming.length === 2) {
          const other = incoming[1];
          const one = next.components[id];
          const two = next.components[other];
          if (one.color >= 0 && two.color >= 0 && one.color !== two.color) continue;
          const merged = {
            color: one.color >= 0 ? one.color : two.color,
            count: one.count + two.count
          };
          if (merged.count > 2) continue;
          next.frontier = next.frontier.map(value => value === other ? id : value);
          delete next.components[other];
          next.components[id] = merged;
        }
      }

      if (endpoint[index] >= 0) {
        const component = next.components[id];
        if (component.color >= 0 && component.color !== endpoint[index]) continue;
        component.color = endpoint[index];
        component.count += 1;
      }
      if (right) next.left = id;
      if (down) next.frontier[col] = id;
      const references = referenceCount(next, id);
      const component = next.components[id];
      if (!references) {
        // A component may leave the frontier only after joining its own pair.
        if (component.count !== 2) continue;
        delete next.components[id];
      } else if (component.count >= 2) {
        continue;
      }

      decisions.push([index, right ? index + 1 : -1, down ? index + width : -1]);
      if (visit(index + 1, next)) return true;
      decisions.pop();
      if (limited) return false;
    }
    return false;
  }

  const solved = visit(0, {
    left: 0,
    frontier: new Array(width).fill(0),
    components: {}
  });
  if (!solved) return { status: limited ? 'limit' : 'unsatisfiable', paths: null, states };

  const graph = Array.from({ length: total }, () => []);
  answer.forEach(([cell, right, down]) => {
    [right, down].forEach(next => {
      if (next < 0) return;
      graph[cell].push(next);
      graph[next].push(cell);
    });
  });
  const paths = lines.map(line => {
    const cells = [line.Start];
    let previous = -1;
    let current = line.Start;
    while (current !== line.End) {
      const next = graph[current].find(cell => cell !== previous);
      if (!Number.isInteger(next) || cells.length >= total) throw new Error('Invalid path-cover result');
      cells.push(next);
      previous = current;
      current = next;
    }
    return cells;
  });
  return { status: 'solved', paths, states };
}

module.exports = solveWithoutPortals;

if (require.main === module) {
  const catalog = require('../data/catalog-v2.js');
  const target = process.argv[2];
  const entries = catalog.levels.map((entry, index) => ({ number: index + 1, setIndex: entry.setIndex, game: entry.game }))
    .filter(entry => target
      ? String(entry.number) === target || entry.game.Id === target
      : entry.setIndex === 4 && entry.game.Mechanic === 'portal');
  if (!entries.length) {
    console.error('No matching level. Pass a display number or stable level ID.');
    process.exitCode = 1;
  }
  entries.forEach(entry => {
    const result = solveWithoutPortals(entry.game);
    const lengths = result.paths ? result.paths.map(cells => cells.length).join('/') : '-';
    console.log(`${entry.number}\t${entry.game.Id}\t${result.status}\t${lengths}\tstates=${result.states}`);
    if (result.status === 'invalid' || result.status === 'limit') process.exitCode = 1;
  });
}
