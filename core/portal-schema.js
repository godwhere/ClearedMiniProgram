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
 * Read a portal descriptor without mutating its source. Besides canonical
 * A/B fields, `Cells: [a, b]` is accepted as a compact import form.
 */
function readPortal(raw, sourceIndex) {
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

/**
 * Normalize a raw portal array. With no options this preserves the forgiving
 * validator helper contract. Runtime callers may provide a board total and
 * request uniqueness so malformed v1 declarations safely normalize to an
 * unusable set instead of partially enabling portal movement.
 */
function normalizePortalDescriptors(source, options) {
  if (!Array.isArray(source)) return [];
  const opts = isRecord(options) ? options : {};
  const hasTotal = Number.isInteger(opts.total) && opts.total >= 0;
  const requireUnique = opts.requireUnique === true;
  const seenIds = Object.create(null);
  const seenCells = Object.create(null);
  const normalized = [];

  source.forEach((raw, index) => {
    const portal = readPortal(raw, index);
    if (!portal || typeof portal.id !== 'string' || portal.id.trim().length === 0 ||
        !Number.isInteger(portal.A) || !Number.isInteger(portal.B)) return;
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
  return normalizePortalDescriptors(rawPortals(level).value, options);
}

/**
 * Build read-only-style lookup maps from normalized descriptors. The maps
 * use null prototypes so author-controlled IDs cannot alter lookup semantics.
 */
function buildPortalIndex(levelOrPortals) {
  const portals = Array.isArray(levelOrPortals)
    ? levelOrPortals
    : normalizePortals(levelOrPortals);
  const portalByCell = Object.create(null);
  const portalById = Object.create(null);
  portals.forEach(portal => {
    const id = portal.id || portal.Id;
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
      B: descriptor.B
    };
    portalByCell[descriptor.B] = {
      id,
      pairId: id,
      entry: descriptor.B,
      exit: descriptor.A,
      A: descriptor.A,
      B: descriptor.B
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
  normalizePortalDescriptors,
  normalizePortals,
  buildPortalIndex
};
