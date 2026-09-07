'use strict';

const portalV1 = require('./portal-v1.js');
const portalV2 = require('./portal-v2.js');
const iceV1 = require('./ice-v1.js');

const policies = Object.freeze({
  'portal@1': portalV1,
  'portal@2': portalV2,
  'ice@1': iceV1
});

function resolve(id, rulesVersion) {
  if (typeof id !== 'string' || !Number.isInteger(rulesVersion)) return null;
  return policies[`${id}@${rulesVersion}`] || null;
}

module.exports = Object.freeze({
  resolve,
  supported(id, rulesVersion) {
    return !!resolve(id, rulesVersion);
  }
});
