// Spring theme manifest.
//
// The sheet is a declarative 5 x 2 sprite sheet. Frames stay in logical
// palette-slot order: deep-green sprout, white daisy, red tulip, orange
// butterfly, yellow sunflower, green four-leaf clover, cyan spring rain,
// sky-blue kite, purple iris, and pink cherry blossom. Rendering owns
// slicing, tile geometry, and interaction behavior.
module.exports = {
  id: 'spring',
  name: '春天',
  category: '春天',
  assets: {
    tileSheet: 'assets/skins/spring/spring-sprite-sheet.png'
  },
  tileVisuals: {
    type: 'spriteSheet',
    asset: 'tileSheet',
    columns: 5,
    rows: 2,
    count: 10,
    // Keep the translucent board tile visible beneath transparent spring art.
    backgroundColor: 'emptyCell',
    backgroundAlpha: 1,
    // Leaves, petals, and the kite tail can approach frame edges; the inset
    // keeps every silhouette inside its logical board cell.
    scale: 0.88,
    // A distinct seasonal palette remains available when the sheet is absent.
    fallbackColors: [
      '#3e8f45',
      '#f5f4e8',
      '#e64c4c',
      '#f59b3d',
      '#f4c542',
      '#65bd67',
      '#63cdd8',
      '#58a8e8',
      '#9569d6',
      '#f28eb3'
    ]
  }
};
