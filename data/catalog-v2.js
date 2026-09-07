// Runtime catalog for WeChat Mini Games. Level data must be JavaScript
// modules because the game CommonJS loader cannot import JSON modules.
const sets = [
  require('./clearedset_train.js'),
  require('./clearedset5.js'),
  require('./clearedset6.js'),
  require('./clearedset7.js'),
  require('./clearedset8.js')
];

const canonicalLevels = [];
sets.forEach((set, setIndex) => {
  (set.Games || []).forEach((game, levelIndex) => {
    canonicalLevels.push({
      setIndex,
      levelIndex,
      setName: set.Name,
      setColor: set.Color,
      palette: set.Palette || [],
      game
    });
  });
});

const order = require('./level-order.js') || {};
const indices = order.eightByLevelIndex;
const eightLevels = canonicalLevels.filter(entry => entry.setIndex === 4);
const orderValid = order.version === 1 && Array.isArray(indices) && indices.length === eightLevels.length &&
  new Set(indices).size === indices.length && indices.every(index =>
    Number.isInteger(index) && index >= 0 && index < eightLevels.length);
// Broken packaged metadata must not hide levels or destroy access. Publishing
// tests reject the fallback; the runtime retains the complete canonical list.
const levels = orderValid
  ? canonicalLevels.filter(entry => entry.setIndex !== 4).concat(indices.map(index => eightLevels[index]))
  : canonicalLevels;

module.exports = { sets, levels, orderValid, orderVersion: orderValid ? order.version : 0 };
