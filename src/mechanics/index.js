'use strict';

const portal = require('./portal.js');
const ice = require('./ice.js');

const definitions = Object.freeze([portal, ice]);
const byId = Object.freeze(definitions.reduce((result, definition) => {
  if (definition && typeof definition.id === 'string' && definition.id) {
    result[definition.id] = definition;
  }
  return result;
}, Object.create(null)));

module.exports = Object.freeze({
  all() {
    return definitions.slice();
  },

  get(id) {
    return typeof id === 'string' ? (byId[id] || null) : null;
  }
});
