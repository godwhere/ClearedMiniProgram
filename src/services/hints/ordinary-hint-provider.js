'use strict';

function boardOf(context) {
  return context && context.board && typeof context.board === 'object'
    ? context.board : {};
}

function linesOf(context) {
  const lines = boardOf(context).lines;
  return Array.isArray(lines) ? lines : [];
}

function endpoint(line, upper, lower) {
  if (!line || typeof line !== 'object') return undefined;
  return line[upper] === undefined ? line[lower] : line[upper];
}

function isCompleted(context, lineIndex) {
  const completed = context && context.completedLines;
  return !!(Array.isArray(completed) && completed[lineIndex]);
}

class OrdinaryHintProvider {
  find(context, storedPaths) {
    if (!context || (context.outcome && context.outcome !== 'playing')) return null;
    if (storedPaths) {
      const hint = this.pickStoredPath(storedPaths, context);
      if (hint) return hint;
    }
    return this.findAvailablePath(context);
  }

  isPlayable(context, index) {
    const board = boardOf(context);
    const width = Number(board.width);
    const height = Number(board.height);
    const total = width * height;
    if (!Number.isInteger(index) || !Number.isFinite(total) || total <= 0 ||
        index < 0 || index >= total) return false;
    if (Array.isArray(board.blockedMask) && board.blockedMask[index]) return false;
    if (Array.isArray(board.blocked) && board.blocked.indexOf(index) >= 0) return false;
    return true;
  }

  pickStoredPath(paths, context, source) {
    if (!Array.isArray(paths) || !context) return null;
    const owner = Array.isArray(boardOf(context).owner) ? boardOf(context).owner : [];
    for (let lineIndex = 0; lineIndex < paths.length; lineIndex++) {
      if (isCompleted(context, lineIndex)) continue;
      const path = paths[lineIndex];
      if (!Array.isArray(path) || path.length < 2) continue;
      const playable = path.every(index => this.isPlayable(context, index));
      if (!playable) continue;
      const clear = path.every(index => {
        const cellOwner = Number.isInteger(owner[index]) ? owner[index] : -1;
        return cellOwner < 0 || cellOwner === lineIndex;
      });
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

  findAvailablePath(context) {
    if (!context) return null;
    const candidates = [];
    linesOf(context).forEach((line, lineIndex) => {
      if (isCompleted(context, lineIndex)) return;
      const start = endpoint(line, 'Start', 'start');
      const end = endpoint(line, 'End', 'end');
      const path = this.shortestPath(context, lineIndex, start, end);
      if (path) candidates.push({ lineIndex, path, source: 'search' });
    });
    candidates.sort((one, two) => one.path.length - two.path.length);
    return candidates[0] || null;
  }

  shortestPath(context, lineIndex, start, end) {
    if (!this.isPlayable(context, start) || !this.isPlayable(context, end)) return null;
    const board = boardOf(context);
    const width = Number(board.width);
    const height = Number(board.height);
    const total = width * height;
    const owner = Array.isArray(board.owner) ? board.owner : [];
    const fixedLine = Array.isArray(board.fixedLine) ? board.fixedLine : [];
    const previous = new Array(total).fill(-1);
    const queue = [start];
    previous[start] = start;

    for (let head = 0; head < queue.length; head++) {
      const current = queue[head];
      if (current === end) break;
      const x = current % width;
      const y = Math.floor(current / width);
      const neighbors = [];
      if (x > 0) neighbors.push(current - 1);
      if (x + 1 < width) neighbors.push(current + 1);
      if (y > 0) neighbors.push(current - width);
      if (y + 1 < height) neighbors.push(current + width);

      neighbors.forEach(next => {
        if (previous[next] >= 0 || !this.isPlayable(context, next)) return;
        const nextOwner = Number.isInteger(owner[next]) ? owner[next] : -1;
        const nextFixedLine = Number.isInteger(fixedLine[next]) ? fixedLine[next] : -1;
        if (nextOwner >= 0 && nextOwner !== lineIndex) return;
        if (nextFixedLine >= 0 && nextFixedLine !== lineIndex && next !== end) return;
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

OrdinaryHintProvider.boardOf = boardOf;
OrdinaryHintProvider.linesOf = linesOf;
OrdinaryHintProvider.endpoint = endpoint;
OrdinaryHintProvider.isCompleted = isCompleted;

module.exports = OrdinaryHintProvider;
