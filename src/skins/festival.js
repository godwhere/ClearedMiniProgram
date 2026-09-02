// Festival-limited theme manifest.
//
// The sheet is a declarative 5 x 2 sprite sheet. Frames stay in logical
// palette-slot order: deep-blue gold-edged festival drum, white tangyuan,
// red lantern, orange fireworks, gold mooncake, green zongzi, cyan dragon
// boat, blue folding fan, purple paper-cut ornament, and pink peach blossom.
// Rendering owns slicing, tile geometry, and interaction behavior.
module.exports = {
  id: 'festival',
  preview: 'assets/theme-previews/festival.png',
  name: '节日限定',
  category: '节日',
  assets: {
    tileSheet: 'assets/skins/festival/festival-sprite-sheet.png'
  },
  tileVisuals: {
    type: 'spriteSheet',
    asset: 'tileSheet',
    columns: 5,
    rows: 2,
    count: 10,
    // Keep the translucent board tile visible beneath transparent festival art.
    backgroundColor: 'emptyCell',
    backgroundAlpha: 1,
    // Source cells carry a 24px transparent safety edge around tassels and sparks.
    scale: 1,
    // The first drum artwork is deep blue with a gold edge. A brighter
    // fallback preserves contrast when the sheet is unavailable and can also
    // serve as an accent outline in hosts that render strokes.
    fallbackColors: [
      '#f2c14e',
      '#fff3d6',
      '#e43d4b',
      '#ff8a3d',
      '#f2c94c',
      '#63b96b',
      '#26c6c8',
      '#4f8edc',
      '#9a63d3',
      '#f28cae'
    ]
  }
};
