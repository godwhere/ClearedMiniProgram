// Animal avatar theme manifest.
//
// The sheet is a declarative 5 x 2 sprite sheet.  Frames are kept in the
// palette-slot order used by the generated art: panda, rabbit, fox, lion,
// tiger, elephant, giraffe, monkey, hippo, and pig.  The renderer owns all
// slicing, tile geometry, and interaction behavior.
module.exports = {
  id: 'animals',
  name: '动物',
  category: '动物',
  assets: {
    tileSheet: 'assets/skins/animals/animal-sprite-sheet.png'
  },
  tileVisuals: {
    type: 'spriteSheet',
    asset: 'tileSheet',
    columns: 5,
    rows: 2,
    count: 10,
    // Preserve the translucent square board tile beneath transparent art.
    backgroundColor: 'emptyCell',
    backgroundAlpha: 1,
    // The normalized 400px source cell already includes a 24px transparent
    // safety edge for ears, manes, and other silhouettes.
    scale: 1
  }
};
