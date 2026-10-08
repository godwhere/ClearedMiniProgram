// Keep built-in effect registration deterministic.  Effect files are plain
// data manifests; page routing and persistence belong to the app/service.
module.exports = [
  require('./none.js'),
  require('./fade.js'),
  require('./starburst.js'),
  require('./bubbles.js'),
  require('./petals.js'),
  require('./shatter.js')
];
