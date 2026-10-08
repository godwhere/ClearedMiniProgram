'use strict';

const verifyPack = require('./helpers/mixed-mainline-pack-fixture.js');

const GRADES = [1, 2, 3, 2, 3, 2, 3, 2, 5, 1, 2, 3, 2, 4, 1, 2, 3, 2, 5, 1,
  1, 2, 3, 2, 3, 2, 3, 2, 5, 1, 2, 3, 2, 4, 1, 2, 3, 2, 5, 1, 1, 2, 3, 2, 4, 1, 3, 2, 5, 1];
const PORTAL_SLOTS = new Set([5, 8, 11, 18, 25, 28, 31, 38, 41, 48]);
const ICE_SLOTS = new Map([[2, [8, 2]], [13, [12, 3]], [16, [8, 2]], [22, [8, 2]], [26, [8, 2]],
  [33, [12, 3]], [36, [8, 2]], [42, [8, 3]], [44, [12, 3]], [46, [8, 2]]]);

module.exports = function run() {
  verifyPack({ start: 200, idPrefix: 'stellar-8x8-', grades: GRADES,
    portalSlots: PORTAL_SLOTS, iceSlots: ICE_SLOTS,
    previousHash: 'a424c026633e5367652b7efb54a583eb6cd8ab67cf8200f35f12e72ab491aeb6',
    fivePositions: [209, 219, 229, 239, 249] });
};
