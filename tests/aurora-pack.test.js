'use strict';

const verifyPack = require('./helpers/mixed-mainline-pack-fixture.js');

const GRADES = [1, 2, 3, 2, 3, 2, 3, 2, 5, 1, 2, 3, 2, 4, 1, 2, 3, 2, 5, 1,
  1, 2, 3, 2, 3, 2, 3, 2, 5, 1, 2, 3, 2, 4, 1, 2, 3, 2, 5, 1, 1, 2, 3, 2, 4, 1, 3, 2, 5, 1];
const PORTAL_SLOTS = new Set([5, 8, 11, 18, 25, 28, 31, 38, 41, 48]);
const ICE_SLOTS = new Map([[2, [8, 2]], [13, [12, 3]], [16, [8, 2]], [22, [8, 2]], [26, [8, 2]],
  [33, [8, 2]], [36, [8, 2]], [42, [8, 2]], [44, [12, 3]], [46, [8, 2]]]);

module.exports = function run() {
  verifyPack({ start: 250, idPrefix: 'aurora-8x8-', grades: GRADES,
    portalSlots: PORTAL_SLOTS, iceSlots: ICE_SLOTS,
    previousHash: '07e7e8524a4254ea8e4dba5e58abe00398511d2ab0ab035942687ea36c56575c',
    fivePositions: [259, 269, 279, 289, 299] });
};
