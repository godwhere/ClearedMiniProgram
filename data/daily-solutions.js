'use strict';

// Hint paths are indexed by immutable level id, never by an ordinary
// setIndex/levelIndex pair. Ordinary paths are contiguous; Portal routes use
// explicit segments/exits. Ice cells require two distinct routes; other
// required cells are covered once (unused v2 portal squares are optional).

const introPaths = [
  [0, 1, 2],
  [3, 4, 5, 8, 7, 6]
];

const extremePaths = [
  [0, 1, 2],
  [
    5, 6, 7, 15, 14, 13, 12, 11
  ],
  [
    10, 9, 8, 16, 17, 18, 19, 20
  ],
  [
    21, 22, 23, 31, 30, 29, 28
  ],
  [
    26, 25, 24, 32, 33, 34, 35, 36, 37
  ],
  [
    38, 39, 47, 46, 45, 44, 43, 42, 41
  ],
  [
    40, 48, 49, 50, 51, 52, 53, 54, 55
  ],
  [
    63, 62, 61, 60, 59, 58, 57, 56
  ],
  [
    64, 65, 66, 67, 68, 69, 70, 71
  ],
  [
    79, 78, 77, 76, 75, 74, 73, 72
  ]
];

const courtyardPaths = [
  [0, 8, 16, 17, 9, 1, 2, 3],
  [4, 12, 11, 10, 18, 19, 20],
  [21, 13, 5, 6, 7, 15, 14, 22, 23],
  [24, 25, 26, 34, 33, 32, 40],
  [41, 42, 50, 49, 48],
  [29, 37, 45, 53, 54, 55, 47],
  [46, 38, 30, 31, 39],
  [56, 64, 72, 73, 65, 57, 58],
  [59, 60, 68, 67, 66, 74, 75, 76],
  [77, 69, 61, 62, 63, 71, 70, 78, 79]
];

// Compatibility solutions for the deprecated flat Challenges entries, which
// still contain the original three-line 8×10 shape. Canonical Days use the
// more granular ten-line extreme puzzle above.
const legacyExtremePaths = [
  [0, 1, 2],
  [
    5, 6, 7,
    15, 14, 13, 12, 11, 10, 9, 8,
    16, 17, 18, 19, 20, 21, 22, 23,
    31, 30, 29, 28
  ],
  [
    26, 25, 24,
    32, 33, 34, 35, 36, 37, 38, 39,
    47, 46, 45, 44, 43, 42, 41, 40,
    48, 49, 50, 51, 52, 53, 54, 55,
    63, 62, 61, 60, 59, 58, 57, 56,
    64, 65, 66, 67, 68, 69, 70, 71,
    79, 78, 77, 76, 75, 74, 73, 72
  ]
];

const mechanicSolutions = require('./daily-mechanic-solutions.js');
const newIntroSolutions = {};
require('./daily-mechanic-pack.js').forEach(level => {
  newIntroSolutions[`daily-${level.DateKey}-v1-intro-v1`] = introPaths;
});

module.exports = {
  SchemaVersion: 2,
  ByChallengeId: {
    ...newIntroSolutions,
    ...mechanicSolutions,
    'daily-2026-08-31-v1-intro-v1': introPaths,
    'daily-2026-08-31-v1-extreme-v1': extremePaths,
    'daily-2026-09-01-v1-intro-v1': introPaths,
    'daily-2026-09-01-v1-extreme-v1': extremePaths,
    'daily-2026-09-07-v1-intro-v1': introPaths,
    'daily-2026-09-07-v1-extreme-v1': courtyardPaths,

    // Legacy aliases for hosts that still resolve the old one-level
    // Challenges entries. They intentionally point at the 8x10 solution.
    'daily-2026-08-31-v1': legacyExtremePaths,
    'daily-2026-09-01-v1': legacyExtremePaths
  }
};
