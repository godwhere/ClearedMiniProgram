'use strict';

const packages = [
  'gem', 'animals', 'fruits', 'desserts', 'space',
  'ocean', 'spring', 'festival', 'music', 'vehicles'
].map(themeId => Object.freeze({
  name: `theme-${themeId}`,
  root: `assets/skins/${themeId}/`,
  themeIds: Object.freeze([themeId]),
  assetPrefixes: Object.freeze([`assets/skins/${themeId}/`])
}));

module.exports = Object.freeze({ packages: Object.freeze(packages) });
