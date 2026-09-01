// Dessert theme manifest.
//
// The sheet is a declarative 5 x 2 sprite sheet. Frames stay in logical
// palette-slot order: chocolate cookie, vanilla macaron, red-velvet cupcake,
// orange doughnut, lemon pudding, mint ice cream, blue jelly cup, blueberry
// cheesecake, purple macaron, and pink marshmallow. Rendering owns slicing,
// tile geometry, and interaction behavior.
module.exports = {
  id: 'desserts',
  name: '甜点',
  category: '甜点',
  assets: {
    tileSheet: 'assets/skins/desserts/dessert-sprite-sheet.png'
  },
  tileVisuals: {
    type: 'spriteSheet',
    asset: 'tileSheet',
    columns: 5,
    rows: 2,
    count: 10,
    // Keep the translucent board tile visible beneath transparent dessert art.
    backgroundColor: 'emptyCell',
    backgroundAlpha: 1,
    // Source cells carry a 24px transparent safety edge around every dessert.
    scale: 1,
    // If the sheet cannot be loaded, retain a recognizable dessert palette
    // instead of falling back to an unrelated classic color.
    fallbackColors: [
      '#7b4b35',
      '#f6dfc5',
      '#c94b55',
      '#f39a3e',
      '#f4d35e',
      '#8bd8c0',
      '#5ab8e6',
      '#6d76c9',
      '#9a6bd3',
      '#f59ab7'
    ]
  }
};
