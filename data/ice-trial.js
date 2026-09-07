'use strict';

// Deliberately outside catalog-v2: this sample never acquires a save coordinate.
const level = Object.freeze({
  Id: 'ice-trial-5x5-1',
  Width: 5,
  Height: 5,
  Mechanic: 'ice',
  IceRulesVersion: 1,
  IceCells: Object.freeze([12]),
  Lines: Object.freeze([
    Object.freeze({ Start: 10, End: 14 }),
    Object.freeze({ Start: 2, End: 22 }),
    Object.freeze({ Start: 3, End: 8 }),
    Object.freeze({ Start: 18, End: 23 })
  ])
});

module.exports = Object.freeze({
  Id: 'ice-trial',
  Name: '冰封试玩',
  Color: '#00ABA9',
  Palette: Object.freeze(['#ff1d23', '#0A71c7', '#f0ca4d', '#96ca2d']),
  Games: Object.freeze([level]),
  // Four simple routes; only the centre is shared, by red and blue.
  solution: Object.freeze([
    Object.freeze([10, 11, 12, 13, 14]),
    Object.freeze([2, 1, 0, 5, 6, 7, 12, 17, 16, 15, 20, 21, 22]),
    Object.freeze([3, 4, 9, 8]),
    Object.freeze([18, 19, 24, 23])
  ])
});
