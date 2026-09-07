'use strict';

module.exports = Object.freeze({
  id: 'ice',
  rulesVersion: 1,

  // v1 is one removable ice layer on empty floor only. No endpoint ice,
  // Portal combination, or more-than-two-layer cells; progression is separate.
  normalize(level, blockedMask) {
    const cells = level.IceCells;
    const total = level.Width * level.Height;
    const endpoints = new Set();
    (level.Lines || []).forEach(line => {
      endpoints.add(line.Start);
      endpoints.add(line.End);
    });
    if (!Array.isArray(cells) || !cells.length || new Set(cells).size !== cells.length ||
        level.Portals !== undefined || level.portals !== undefined ||
        cells.some(index => !Number.isInteger(index) || index < 0 || index >= total ||
          blockedMask[index] || endpoints.has(index))) return [];
    return cells.slice();
  }
});
