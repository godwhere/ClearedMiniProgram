'use strict';

/**
 * Pure field readers and lookup builders shared by portal runtime and
 * authoring validation. Diagnostics remain in portal-validation.js; this
 * module only canonicalizes data without mutating its source.
 */

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function own(value, key) {
  return isRecord(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function field(value, upper, lower) {
  if (!isRecord(value)) return undefined;
  if (value[upper] !== undefined) return value[upper];
  return lower ? value[lower] : undefined;
}

function first(value, keys) {
  if (!isRecord(value)) return undefined;
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (value[key] !== undefined) return value[key];
  }
  return undefined;
}

function dimensions(level) {
  const width = field(level, 'Width', 'width');
  const height = field(level, 'Height', 'height');
  const valid = Number.isInteger(width) && width > 0 &&
    Number.isInteger(height) && height > 0;
  return {
    width,
    height,
    total: valid ? width * height : 0,
    valid
  };
}

function rawPortals(level) {
  if (!isRecord(level)) return { present: false, value: undefined };
  if (own(level, 'Portals')) return { present: true, value: level.Portals };
  if (own(level, 'portals')) return { present: true, value: level.portals };
  return { present: false, value: undefined };
}

function rawMechanic(level) {
  return field(level, 'Mechanic', 'mechanic');
}

function rawRulesVersion(level) {
  return field(level, 'PortalRulesVersion', 'portalRulesVersion');
}

/**
 * Read a v1 portal pair without mutating its source. Besides canonical A/B
 * fields, `Cells: [a, b]` is accepted as a compact import form.
 */
function readPortalV1(raw, sourceIndex) {
  if (!isRecord(raw)) return null;
  const cells = first(raw, ['Cells', 'cells']);
  const firstCell = first(raw, ['A', 'a']);
  const secondCell = first(raw, ['B', 'b']);
  const a = firstCell !== undefined
    ? firstCell
    : (Array.isArray(cells) ? cells[0] : undefined);
  const b = secondCell !== undefined
    ? secondCell
    : (Array.isArray(cells) ? cells[1] : undefined);
  return {
    id: first(raw, ['Id', 'id']),
    A: a,
    B: b,
    sourceIndex
  };
}

/**
 * Read one v2 neutral portal network. Every declared cell belongs to the same
 * network; runtime policy decides which of the other cells are eligible exits.
 */
function readPortalV2(raw, sourceIndex) {
  if (!isRecord(raw)) return null;
  if (own(raw, 'A') || own(raw, 'a') || own(raw, 'B') || own(raw, 'b')) return null;
  const cells = first(raw, ['Cells', 'cells']);
  return {
    id: first(raw, ['Id', 'id']),
    cells: Array.isArray(cells) ? cells.slice() : cells,
    sourceIndex
  };
}

// Preserve the public v1 helper used by existing validators and tests.
function readPortal(raw, sourceIndex) {
  return readPortalV1(raw, sourceIndex);
}

function canonicalPortal(portal) {
  return {
    id: portal.id,
    Id: portal.id,
    A: portal.A,
    B: portal.B,
    a: portal.A,
    b: portal.B,
    sourceIndex: portal.sourceIndex
  };
}

function canonicalPortalNetwork(portal) {
  return {
    id: portal.id,
    Id: portal.id,
    cells: portal.cells.slice(),
    Cells: portal.cells.slice(),
    sourceIndex: portal.sourceIndex
  };
}

/**
 * Normalize a raw portal array. With no options this preserves the forgiving
 * validator helper contract. Runtime callers may provide a board total and
 * request uniqueness so malformed v1 declarations safely normalize to an
 * unusable set instead of partially enabling portal movement.
 */
function normalizePortalDescriptors(source, options) {
  if (!Array.isArray(source)) return [];
  const opts = isRecord(options) ? options : {};
  const rulesVersion = opts.rulesVersion === 2 ? 2 : 1;
  const hasTotal = Number.isInteger(opts.total) && opts.total >= 0;
  const requireUnique = opts.requireUnique === true;
  const seenIds = Object.create(null);
  const seenCells = Object.create(null);
  const normalized = [];

  source.forEach((raw, index) => {
    const portal = rulesVersion === 2
      ? readPortalV2(raw, index)
      : readPortalV1(raw, index);
    if (!portal || typeof portal.id !== 'string' || portal.id.trim().length === 0) return;

    if (rulesVersion === 2) {
      if (!Array.isArray(portal.cells) || portal.cells.length < 2) return;
      for (let cellIndex = 0; cellIndex < portal.cells.length; cellIndex += 1) {
        if (!Object.prototype.hasOwnProperty.call(portal.cells, cellIndex) ||
            !Number.isInteger(portal.cells[cellIndex])) return;
      }
      const localCells = new Set(portal.cells);
      if (localCells.size !== portal.cells.length) return;
      if (hasTotal) {
        for (let cellIndex = 0; cellIndex < portal.cells.length; cellIndex += 1) {
          const cell = portal.cells[cellIndex];
          if (cell < 0 || cell >= opts.total) return;
        }
      }
      if (requireUnique && (seenIds[portal.id] || portal.cells.some(cell => seenCells[cell]))) return;
      if (requireUnique) {
        seenIds[portal.id] = true;
        portal.cells.forEach(cell => { seenCells[cell] = true; });
      }
      normalized.push(canonicalPortalNetwork(portal));
      return;
    }

    if (!Number.isInteger(portal.A) || !Number.isInteger(portal.B)) return;
    if (hasTotal && (portal.A === portal.B || portal.A < 0 || portal.B < 0 ||
        portal.A >= opts.total || portal.B >= opts.total)) return;
    if (requireUnique &&
        (seenIds[portal.id] || seenCells[portal.A] || seenCells[portal.B])) return;
    if (requireUnique) {
      seenIds[portal.id] = true;
      seenCells[portal.A] = true;
      seenCells[portal.B] = true;
    }
    normalized.push(canonicalPortal(portal));
  });
  return normalized;
}

/**
 * Return structurally readable portal descriptors from a level. Invalid
 * descriptors are omitted; use portal-validation.js when diagnostics matter.
 */
function normalizePortals(level, options) {
  const opts = isRecord(options) ? Object.assign({}, options) : {};
  if (opts.rulesVersion === undefined) opts.rulesVersion = rawRulesVersion(level);
  return normalizePortalDescriptors(rawPortals(level).value, opts);
}

/**
 * Build read-only-style lookup maps from normalized descriptors. The maps
 * use null prototypes so author-controlled IDs cannot alter lookup semantics.
 */
function buildPortalIndex(levelOrPortals, options) {
  const opts = isRecord(options) ? options : {};
  const inferredVersion = Array.isArray(levelOrPortals)
    ? opts.rulesVersion
    : rawRulesVersion(levelOrPortals);
  const rulesVersion = inferredVersion === 2 ? 2 : 1;
  const portals = Array.isArray(levelOrPortals)
    ? levelOrPortals
    : normalizePortals(levelOrPortals, { rulesVersion });
  const portalByCell = Object.create(null);
  const portalById = Object.create(null);
  portals.forEach(portal => {
    const id = portal.id || portal.Id;
    if (rulesVersion === 2) {
      const cells = Array.isArray(portal.cells)
        ? portal.cells.slice()
        : (Array.isArray(portal.Cells) ? portal.Cells.slice() : []);
      const descriptor = { id, portalId: id, cells };
      portalById[id] = descriptor;
      cells.forEach(entry => {
        portalByCell[entry] = {
          id,
          portalId: id,
          entry,
          exits: cells.filter(cell => cell !== entry)
        };
      });
      return;
    }
    const descriptor = {
      id,
      pairId: id,
      A: portal.A,
      B: portal.B,
      a: portal.A,
      b: portal.B
    };
    if (Array.isArray(portal.cells)) descriptor.cells = portal.cells.slice();
    portalById[id] = descriptor;
    portalByCell[descriptor.A] = {
      id,
      pairId: id,
      entry: descriptor.A,
      exit: descriptor.B,
      A: descriptor.A,
      B: descriptor.B,
      exits: [descriptor.B]
    };
    portalByCell[descriptor.B] = {
      id,
      pairId: id,
      entry: descriptor.B,
      exit: descriptor.A,
      A: descriptor.A,
      B: descriptor.B,
      exits: [descriptor.A]
    };
  });
  return { portals, portalByCell, portalById };
}

module.exports = {
  isRecord,
  own,
  field,
  first,
  dimensions,
  rawPortals,
  rawMechanic,
  rawRulesVersion,
  readPortal,
  readPortalV1,
  readPortalV2,
  normalizePortalDescriptors,
  normalizePortals,
  buildPortalIndex
};
