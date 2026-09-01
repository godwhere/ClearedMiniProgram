// Fruit avatar theme manifest.
//
// The sheet is a declarative 5 x 2 sprite sheet. Frames are kept in the
// logical palette-slot order used by the generated art: apple, orange,
// strawberry, watermelon, lemon, grape, blueberry, kiwi, peach, and banana.
// Rendering owns slicing, tile geometry, and interaction behavior.
module.exports = {
  id: 'fruits',
  name: '水果',
  category: '水果',
  assets: {
    tileSheet: 'assets/skins/fruits/fruit-sprite-sheet.png'
  },
  tileVisuals: {
    type: 'spriteSheet',
    asset: 'tileSheet',
    columns: 5,
    rows: 2,
    count: 10,
    // Preserve the translucent square board tile beneath transparent fruit.
    backgroundColor: 'emptyCell',
    backgroundAlpha: 1,
    // Source cells carry a 24px transparent safety edge for stems and leaves.
    scale: 1,
    // If the image cannot be loaded, retain a recognizable fruit palette
    // instead of falling all the way back to an unrelated classic color.
    fallbackColors: [
      '#ef3d3d',
      '#ff9418',
      '#e83e4d',
      '#42a85f',
      '#f6c945',
      '#7e57c2',
      '#2f6fde',
      '#78b943',
      '#f28aa2',
      '#f6d34a'
    ]
  }
};
