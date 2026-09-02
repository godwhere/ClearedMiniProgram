// Space theme manifest.
//
// The sheet is a declarative 5 x 2 sprite sheet. Frames stay in logical
// palette-slot order: black hole, silver crescent moon, red rocket, orange
// comet, gold star, green alien, cyan satellite, blue ringed planet, purple
// flying saucer, and pink astronaut helmet. Rendering owns slicing, tile
// geometry, and interaction behavior.
module.exports = {
  id: 'space',
  preview: 'assets/theme-previews/space.png',
  name: '太空',
  category: '太空',
  assets: {
    tileSheet: 'assets/skins/space/space-sprite-sheet.png'
  },
  tileVisuals: {
    type: 'spriteSheet',
    asset: 'tileSheet',
    columns: 5,
    rows: 2,
    count: 10,
    // Keep the translucent board tile visible beneath transparent space art.
    backgroundColor: 'emptyCell',
    backgroundAlpha: 1,
    // Source cells carry a 24px transparent safety edge around every silhouette.
    scale: 1,
    // The black-hole artwork is intentionally dark. Its bright cyan fallback
    // keeps the first slot visible when the sheet is unavailable; the same
    // bright accent can be used as an outline by hosts that render strokes.
    fallbackColors: [
      '#66d9ff',
      '#d9e2f2',
      '#ef3c38',
      '#ff8a24',
      '#ffd53f',
      '#8fe23e',
      '#2ecdf2',
      '#2f7df6',
      '#9b4bea',
      '#f58bb5'
    ]
  }
};
