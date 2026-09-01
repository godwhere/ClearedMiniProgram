'use strict';

const portalSchema = require('../portal-schema.js');

module.exports = Object.freeze({
  id: 'portal',
  rulesVersion: 2,
  requiresPortalCoverage: false,
  maxTeleportsPerLine: 1,

  normalize(source, total) {
    return portalSchema.normalizePortalDescriptors(source, {
      total,
      requireUnique: true,
      rulesVersion: 2
    });
  },

  accepts(source, normalized) {
    // v2 deliberately supports one neutral network. Multiple independent
    // networks or chained uses require a separately versioned contract.
    return Array.isArray(source) && source.length === 1 && normalized.length === 1;
  },

  buildIndex(portals) {
    return portalSchema.buildPortalIndex(portals, { rulesVersion: 2 });
  }
});
