module.exports = {
  // true: ordinary levels unlock continuously as display numbers 1-92 across
  // Training 1-2, 5x5 3-7, 6x6 8-17, 7x7 18-32, and 8x8 33-92.
  // The maximum ordinary board size is 8x8; 8x10 remains daily/high-difficulty only.
  // false: every legacy data set starts with its first level unlocked independently.
  unlockAcrossSets: true,
  // Bootstrap turns this on only for the local WeChat Developer Tools
  // simulator. It is never persisted and must remain false for release.
  unlockAllLevelsInDevTools: false
};
