Page({
  startGame() {
    wx.navigateTo({ url: '/pages/play/play?set=0&level=0' });
  },
  chooseLevel() {
    wx.navigateTo({ url: '/pages/levels/levels' });
  }
});
