'use strict';

const portalSchema = require('../portal-schema.js');

module.exports = Object.freeze({
  id: 'portal',
  rulesVersion: 1,
  requiresPortalCoverage: true,
  maxTeleportsPerLine: 1,

  normalize(source, total) {
    return portalSchema.normalizePortalDescriptors(source, {
      total,
      requireUnique: true,
      rulesVersion: 1
    });
  },

  accepts(source, normalized) {
    return Array.isArray(source) && source.length === 1 && normalized.length === 1;
  },

  buildIndex(portals) {
    return portalSchema.buildPortalIndex(portals, { rulesVersion: 1 });
  }
});
