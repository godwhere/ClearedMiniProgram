// Ocean theme manifest.
//
// The sheet is a declarative 5 x 2 sprite sheet. Frames stay in logical
// palette-slot order: deep-sea anglerfish, white pearl shell, red crab,
// orange clownfish, golden seahorse, green turtle, cyan jellyfish, blue
// whale, purple octopus, and pink starfish. Rendering owns slicing, tile
// geometry, and interaction behavior.
module.exports = {
  id: 'ocean',
  preview: 'assets/theme-previews/ocean.png',
  name: '海洋',
  category: '海洋',
  assets: {
    tileSheet: 'assets/skins/ocean/ocean-sprite-sheet.png'
  },
  tileVisuals: {
    type: 'spriteSheet',
    asset: 'tileSheet',
    columns: 5,
    rows: 2,
    count: 10,
    // Keep the translucent board tile visible beneath transparent ocean art.
    backgroundColor: 'emptyCell',
    backgroundAlpha: 1,
    // Source cells carry a 24px transparent safety edge around fins and tentacles.
    scale: 1,
    // The anglerfish slot can be very dark in the source art. A luminous
    // fallback keeps it visible when the sheet is unavailable.
    fallbackColors: [
      '#63e6d9',
      '#f5f8ff',
      '#ef4b4b',
      '#f39a3e',
      '#f3c84b',
      '#68c46b',
      '#55d8e8',
      '#3e86d8',
      '#9a63d3',
      '#f18bb1'
    ]
  }
};
