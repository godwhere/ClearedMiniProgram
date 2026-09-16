'use strict';

const mechanicPack = require('./daily-mechanic-pack.js');

// Versioned local manifest for the Daily Challenge mode. The ordinary
// catalog (data/catalog-v2.js) deliberately remains independent from this
// table. A day is a package containing exactly two levels: a tiny intro board
// and an 8x10 challenge with optional blocked cells and declared mechanics.

const introLevel = (dateKey, dayId) => ({
  Id: `${dayId}-intro-v1`,
  DateKey: dateKey,
  LevelIndex: 0,
  Difficulty: 'intro',
  DifficultyLabel: '入门',
  PieceCount: 2,
  ContentVersion: 1,
  Width: 3,
  Height: 3,
  Blocked: [],
  Lines: [
    { Start: 0, End: 2 },
    { Start: 3, End: 6 }
  ],
  Palette: ['#f7df3e', '#82c341']
});

const extremeLevel = (dateKey, dayId) => ({
  Id: `${dayId}-extreme-v1`,
  DateKey: dateKey,
  LevelIndex: 1,
  Difficulty: 'extreme',
  DifficultyLabel: '极难',
  PieceCount: 10,
  ChallengeStyle: 'sheep-sheep',
  ContentVersion: 1,
  Width: 8,
  Height: 10,
  // Row-major indexes. These cells are intentionally unavailable.
  Blocked: [3, 4, 27],
  Lines: [
    { Start: 0, End: 2 },
    { Start: 5, End: 11 },
    { Start: 10, End: 20 },
    { Start: 21, End: 28 },
    { Start: 26, End: 37 },
    { Start: 38, End: 41 },
    { Start: 40, End: 55 },
    { Start: 63, End: 56 },
    { Start: 64, End: 71 },
    { Start: 79, End: 72 }
  ],
  Palette: ['#f7df3e', '#82c341', '#13a4a5', '#03a9f4', '#673ab7',
    '#f44336', '#ff9800', '#8bc34a', '#009688', '#9c27b0']
});

// 2026-09-07: a central courtyard leaves 72 playable cells around eight holes.
// Keep the standard day/level IDs so existing daily cloud contracts still apply.
const courtyardLevel = (dateKey, dayId) => Object.assign(extremeLevel(dateKey, dayId), {
  Blocked: [27, 28, 35, 36, 43, 44, 51, 52],
  Lines: [
    { Start: 0, End: 3 },
    { Start: 4, End: 20 },
    { Start: 21, End: 23 },
    { Start: 24, End: 40 },
    { Start: 41, End: 48 },
    { Start: 29, End: 47 },
    { Start: 46, End: 39 },
    { Start: 56, End: 58 },
    { Start: 59, End: 76 },
    { Start: 77, End: 79 }
  ]
});

const day = (dateKey, hardLevel = extremeLevel) => {
  const dayId = `daily-${dateKey}-v1`;
  return {
    Id: dayId,
    DateKey: dateKey,
    EntryLimit: 3,
    Levels: [introLevel(dateKey, dayId), hardLevel(dateKey, dayId)]
  };
};

// `Challenges` is retained as a migration input for older hosts that only
// understand one challenge per date. DailyChallengeService prefers `Days`
// whenever it is present, so these entries are never used by the canonical
// two-level flow. Keeping the old 8x10 snapshots avoids breaking imports and
// older focused callers during rollout.
const legacyChallenge = dateKey => ({
  Id: `daily-${dateKey}-v1`,
  DateKey: dateKey,
  ContentVersion: 1,
  Width: 8,
  Height: 10,
  Blocked: [3, 4, 27],
  Lines: [
    { Start: 0, End: 2 },
    { Start: 5, End: 28 },
    { Start: 26, End: 72 }
  ],
  Palette: ['#f7df3e', '#82c341', '#13a4a5']
});

module.exports = {
  SchemaVersion: 2,
  TimeZone: 'Asia/Shanghai',
  EntryLimit: 3,
  Days: [
    day('2026-08-31'),
    day('2026-09-01'),
    day('2026-09-07', courtyardLevel),
    ...mechanicPack.map(level => day(level.DateKey, () => level))
  ],
  Challenges: [
    legacyChallenge('2026-08-31'),
    legacyChallenge('2026-09-01')
  ]
};
