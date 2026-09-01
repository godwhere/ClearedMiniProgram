// The first clear effect is deliberately data-only.  Keep this module free of
// platform, renderer, and game-runner dependencies so it can be safely used by
// the gallery as well as the runtime animation adapter.
module.exports = {
  id: 'fade',
  name: '逐渐消失',
  type: 'fade',
  preview: 'assets/effects/fade/preview.png',
  durationMs: 300,
  params: {
    alphaFrom: 1,
    alphaTo: 0,
    scaleFrom: 1,
    scaleTo: 1.14,
    staggerRatio: 0.018
  }
};
