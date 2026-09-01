const catalog = require('../../data/catalog.js');

Page({
  data: { sets: [] },

  onLoad() {
    const sets = catalog.sets.map((set, index) => ({
      index,
      name: set.Name,
      color: set.Color,
      count: (set.Games || []).length,
      levels: (set.Games || []).map((game, levelIndex) => ({
        index: levelIndex,
        label: game.Name || String(levelIndex + 1)
      }))
    }));
    this.setData({ sets });
  },

  openLevel(event) {
    const { set, level } = event.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/play/play?set=${set}&level=${level}` });
  }
});
