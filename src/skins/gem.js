// Gem theme manifest. The current art pass uses a 2D anime/cel-shaded icon
// treatment while keeping the same declarative sheet contract.
//
// The image is a declarative 5 x 2 sprite sheet: each logical palette slot
// occupies one square frame, in row-major order.  Rendering and interaction
// code remain responsible for slicing the sheet and applying state effects.
module.exports = {
  id: 'gem',
  name: '宝石',
  category: '宝石',
  assets: {
    tileSheet: 'assets/skins/gem/gem-sprite-sheet.png'
  },
  tileVisuals: {
    type: 'spriteSheet',
    asset: 'tileSheet',
    columns: 5,
    rows: 2,
    count: 10,
    // Keep the translucent board tile visible underneath the transparent gem
    // artwork, and give the artwork a little more visual weight than v1.
    backgroundColor: 'emptyCell',
    backgroundAlpha: 1,
    scale: 1.05
  }
};
