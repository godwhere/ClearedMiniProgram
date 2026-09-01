'use strict';

function flattenPortalSegments(segments) {
  const cells = [];
  (Array.isArray(segments) ? segments : []).forEach(segment => {
    (Array.isArray(segment) ? segment : []).forEach(index => cells.push(index));
  });
  return cells;
}

function normalizeStoredPortalLine(lineSolution) {
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

  const path = flattenPortalSegments(segments);
  return {
    segments,
    teleports,
    path,
    start: path[0],
    end: path[path.length - 1]
  };
}

function reverseStoredPortalLine(stored) {
  if (!stored || !Array.isArray(stored.segments) || !Array.isArray(stored.teleports)) return null;
  const segments = stored.segments.slice().reverse().map(segment => (
    Array.isArray(segment) ? segment.slice().reverse() : []
  ));
  if (!segments.length || segments.some(segment => segment.length === 0)) return null;
  const teleports = stored.teleports.slice().reverse().map(teleport => ({
    pairId: teleport && teleport.pairId,
    from: teleport && teleport.to,
    to: teleport && teleport.from
  }));
  if (teleports.length !== segments.length - 1) return null;
  const path = flattenPortalSegments(segments);
  return {
    segments,
    teleports,
    path,
    start: path[0],
    end: path[path.length - 1]
  };
}

module.exports = {
  flattenPortalSegments,
  normalizeStoredPortalLine,
  reverseStoredPortalLine
};
