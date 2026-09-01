// Runtime catalog for WeChat Mini Games. Level data must be JavaScript
// modules because the game CommonJS loader cannot import JSON modules.
const sets = [
  require('./clearedset_train.js'),
  require('./clearedset5.js'),
  require('./clearedset6.js'),
  require('./clearedset7.js'),
  require('./clearedset8.js'),
  require('./clearedset9.js')
];

const levels = [];
sets.forEach((set, setIndex) => {
  (set.Games || []).forEach((game, levelIndex) => {
    levels.push({
      setIndex,
      levelIndex,
      setName: set.Name,
      setColor: set.Color,
      palette: set.Palette || [],
      game
    });
  });
});

module.exports = { sets, levels };
