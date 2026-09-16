'use strict';

module.exports = Object.freeze({
  id: 'ice',
  rulesVersion: 1,

  // Ice stays on ordinary floor. A validated Portal v2 network may coexist,
  // but its cells and endpoints can never be iced; progression is separate.
  normalize(level, blockedMask, portalCells) {
    const cells = level.IceCells;
    const total = level.Width * level.Height;
    const endpoints = new Set();
    (level.Lines || []).forEach(line => {
      endpoints.add(line.Start);
      endpoints.add(line.End);
    });
    const portals = Array.isArray(portalCells) ? new Set(portalCells) : null;
    const hasPortals = level.Portals !== undefined || level.portals !== undefined;
    if (level.IceRulesVersion !== 1 || !Array.isArray(cells) || !cells.length ||
        Array.from(cells).some(index => !Number.isInteger(index)) ||
        new Set(cells).size !== cells.length ||
        (hasPortals && (!portals || !portals.size ||
          (level.PortalRulesVersion === undefined ? level.portalRulesVersion : level.PortalRulesVersion) !== 2)) ||
        cells.some(index => index < 0 || index >= total || blockedMask[index] ||
          endpoints.has(index) || (portals && portals.has(index)))) return [];
    return cells.slice();
  }
});
