'use strict';

function flattenPortalSegments(segments) {
  const cells = [];
  (Array.isArray(segments) ? segments : []).forEach(segment => {
    (Array.isArray(segment) ? segment : []).forEach(index => cells.push(index));
  });
  return cells;
}

function isDenseArray(value) {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) return false;
  }
  return true;
}

function teleportPortalId(teleport) {
  if (!teleport || typeof teleport !== 'object') return null;
  return teleport.portalId || teleport.PortalId ||
    teleport.pairId || teleport.PairId || teleport.id || teleport.Id || null;
}

function normalizeStoredPortalLine(lineSolution) {
  if (!lineSolution || typeof lineSolution !== 'object') return null;
  const rawSegments = lineSolution.Segments || lineSolution.segments;
  if (!isDenseArray(rawSegments) || rawSegments.length === 0) return null;

  const segments = rawSegments.map(segment => {
    const cells = segment && (segment.Cells || segment.cells);
    return isDenseArray(cells) ? cells.slice() : [];
  });
  if (segments.some(segment => segment.length === 0)) return null;

  const teleports = [];
  for (let index = 0; index + 1 < rawSegments.length; index++) {
    const rawExit = rawSegments[index] && (rawSegments[index].Exit || rawSegments[index].exit);
    if (!rawExit || typeof rawExit !== 'object') return null;
    const from = rawExit.From !== undefined ? rawExit.From : rawExit.from;
    const to = rawExit.To !== undefined ? rawExit.To : rawExit.to;
    const teleport = {
      from: from === undefined ? segments[index][segments[index].length - 1] : from,
      to: to === undefined ? segments[index + 1][0] : to
    };
    const portalId = rawExit.PortalId || rawExit.portalId;
    if (portalId) teleport.portalId = portalId;
    else teleport.pairId = rawExit.PairId || rawExit.pairId || rawExit.Id || rawExit.id;
    teleports.push(teleport);
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
  const teleports = stored.teleports.slice().reverse().map(teleport => {
    const reversed = {
      from: teleport && teleport.to,
      to: teleport && teleport.from
    };
    if (teleport && teleport.portalId) reversed.portalId = teleport.portalId;
    else reversed.pairId = teleport && teleport.pairId;
    return reversed;
  });
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
  reverseStoredPortalLine,
  teleportPortalId
};
