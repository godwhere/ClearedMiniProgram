'use strict';

function record(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function mechanicFor(level, definition) {
  const source = record(level) ? level : {};
  const fallback = record(definition) ? definition : {};
  const id = source.Mechanic !== undefined
    ? source.Mechanic
    : (source.mechanic !== undefined ? source.mechanic : fallback.mechanic);
  const rulesVersion = source.PortalRulesVersion !== undefined
    ? source.PortalRulesVersion
    : (source.portalRulesVersion !== undefined
      ? source.portalRulesVersion
      : fallback.rulesVersion);
  return Object.freeze({
    id: typeof id === 'string' && id ? id : null,
    rulesVersion: Number.isInteger(rulesVersion) ? rulesVersion : null
  });
}

function freezeContext(value) {
  value.source = Object.freeze(value.source);
  value.mechanic = Object.freeze(value.mechanic);
  return Object.freeze(value);
}

function createCatalogRunContext(catalog, setIndex, levelIndex) {
  const sets = catalog && Array.isArray(catalog.sets) ? catalog.sets : [];
  if (!Number.isInteger(setIndex) || setIndex < 0 || !sets[setIndex]) return null;
  const set = sets[setIndex];
  const games = set && Array.isArray(set.Games) ? set.Games : [];
  if (!Number.isInteger(levelIndex) || levelIndex < 0 || !games[levelIndex]) return null;
  const level = games[levelIndex];
  return freezeContext({
    source: { kind: 'catalog', id: 'ordinary' },
    progressionScope: 'ordinary',
    mechanic: mechanicFor(level),
    setIndex,
    levelIndex,
    set,
    level
  });
}

function createMechanicTrialRunContext(definition, levelIndex, setOverride) {
  const trial = record(definition) && record(definition.trial) ? definition.trial : null;
  const set = setOverride || (trial && trial.set);
  const games = set && Array.isArray(set.Games) ? set.Games : [];
  if (!trial || !games.length) return null;
  const requestedIndex = Number.isInteger(levelIndex) ? levelIndex : 0;
  const safeIndex = Math.max(0, Math.min(requestedIndex, games.length - 1));
  const level = games[safeIndex];
  if (!level) return null;
  const stableId = typeof definition.id === 'string' && definition.id
    ? definition.id
    : definition.mechanic;
  if (typeof stableId !== 'string' || !stableId) return null;
  return freezeContext({
    source: { kind: 'mechanic-trial', id: `${stableId}-trial` },
    progressionScope: 'none',
    mechanic: mechanicFor(level, definition),
    setIndex: null,
    levelIndex: safeIndex,
    set,
    level
  });
}

module.exports = {
  createCatalogRunContext,
  createMechanicTrialRunContext
};
