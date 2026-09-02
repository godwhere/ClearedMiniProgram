'use strict';

function record(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function mechanicFor(level) {
  const source = record(level) ? level : {};
  const id = source.Mechanic !== undefined
    ? source.Mechanic
    : source.mechanic;
  const rulesVersion = source.PortalRulesVersion !== undefined
    ? source.PortalRulesVersion
    : source.portalRulesVersion;
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

module.exports = {
  createCatalogRunContext
};
