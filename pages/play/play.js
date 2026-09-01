const catalog = require('../../data/catalog.js');
const GameRunner = require('../../core/game-runner.js');

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

Page({
  data: {
    title: '', setName: '', time: '0:00', boardWidth: 320, boardHeight: 320,
    canUndo: false, canNext: false, isGameOver: false
  },

  onLoad(options) {
    this.setIndex = Number(options.set || 0);
    this.levelIndex = Number(options.level || 0);
    this.loadLevel();
    this.clock = setInterval(() => {
      if (this.runner) this.setData({ time: this.runner.timeText() });
    }, 500);
  },

  onUnload() { if (this.clock) clearInterval(this.clock); },

  loadLevel() {
    const set = catalog.sets[this.setIndex] || catalog.sets[0];
    const game = (set.Games || [])[this.levelIndex] || set.Games[0];
    this.set = set;
    this.level = game;
    // Construct first, then attach the callback. GameRunner.reset() notifies during
    // construction, before `this.runner` has been assigned on the page.
    this.runner = new GameRunner(game, set.Palette || []);
    this.runner.onChange = () => this.refresh();
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const width = clamp(info.windowWidth - 48, 280, 680);
    const height = Math.round(width * game.Height / game.Width);
    this.setData({
      title: `第 ${this.levelIndex + 1} 关`, setName: set.Name,
      boardWidth: width, boardHeight: height, time: this.runner.timeText()
    }, () => wx.nextTick(() => this.initCanvas()));
  },

  initCanvas() {
    wx.createSelectorQuery().select('#board').fields({ node: true, size: true, rect: true }).exec(result => {
      const item = result && result[0];
      if (!item || !item.node) return;
      this.canvas = item.node;
      this.ctx = this.canvas.getContext('2d');
      this.rect = item;
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const dpr = info.pixelRatio || 1;
      this.canvas.width = item.width * dpr;
      this.canvas.height = item.height * dpr;
      this.ctx.scale(dpr, dpr);
      this.draw();
    });
  },

  refresh() {
    this.setData({
      time: this.runner.timeText(),
      canUndo: this.runner.canUndo(),
      isGameOver: this.runner.isGameOver
    });
    this.draw();
  },

  geometry() {
    const width = this.data.boardWidth;
    const height = this.data.boardHeight;
    const cell = Math.min((width - 20) / this.level.Width, (height - 20) / this.level.Height);
    return { cell, ox: (width - cell * this.level.Width) / 2, oy: (height - cell * this.level.Height) / 2 };
  },

  center(index) {
    const g = this.geometry();
    const p = this.runner.indexToXY(index);
    return { x: g.ox + (p.x + .5) * g.cell, y: g.oy + (p.y + .5) * g.cell };
  },

  draw() {
    if (!this.ctx || !this.runner) return;
    const ctx = this.ctx;
    const width = this.data.boardWidth;
    const height = this.data.boardHeight;
    const g = this.geometry();
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#fbfcfd';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = '#dce5e9';
    ctx.lineWidth = 1;
    for (let x = 0; x <= this.level.Width; x++) {
      ctx.beginPath(); ctx.moveTo(g.ox + x * g.cell, g.oy); ctx.lineTo(g.ox + x * g.cell, g.oy + this.level.Height * g.cell); ctx.stroke();
    }
    for (let y = 0; y <= this.level.Height; y++) {
      ctx.beginPath(); ctx.moveTo(g.ox, g.oy + y * g.cell); ctx.lineTo(g.ox + this.level.Width * g.cell, g.oy + y * g.cell); ctx.stroke();
    }

    const drawPath = (cells, color) => {
      if (!cells || cells.length < 2) return;
      ctx.strokeStyle = color; ctx.lineWidth = Math.max(8, g.cell * .42); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      cells.forEach((index, i) => { const p = this.center(index); if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
      ctx.stroke();
    };

    (this.level.Lines || []).forEach((line, lineIndex) => {
      const cells = [];
      if (this.runner.completed[lineIndex]) {
        Object.keys(this.runner.completedCells || {}).forEach(index => { if (this.runner.completedCells[index] === lineIndex) cells.push(Number(index)); });
        cells.sort((a, b) => a - b);
      }
      if (this.runner.selectedLine === lineIndex) cells.push(...this.runner.selectedCells);
      drawPath(cells, this.runner.palette[lineIndex % this.runner.palette.length] || '#1976a8');
    });

    (this.level.Lines || []).forEach((line, lineIndex) => {
      const color = this.runner.palette[lineIndex % this.runner.palette.length] || '#1976a8';
      [line.Start, line.End].forEach(index => {
        const p = this.center(index);
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(9, g.cell * .2), 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(3, g.cell * .07), 0, Math.PI * 2); ctx.fill();
      });
    });
  },

  touchIndex(touch) {
    if (!touch) return -1;
    const rect = this.rect || { left: 0, top: 0 };
    const g = this.geometry();
    const x = touch.x - (rect.left || 0) - g.ox;
    const y = touch.y - (rect.top || 0) - g.oy;
    const col = Math.floor(x / g.cell);
    const row = Math.floor(y / g.cell);
    if (col < 0 || row < 0 || col >= this.level.Width || row >= this.level.Height) return -1;
    return row * this.level.Width + col;
  },

  onTouchStart(event) {
    const index = this.touchIndex((event.touches || [])[0]);
    if (this.runner.touchStart(index)) this.draw();
  },
  onTouchMove(event) {
    const index = this.touchIndex((event.touches || [])[0]);
    if (this.runner.touchMove(index)) this.draw();
  },
  onTouchEnd(event) {
    const touch = (event.changedTouches || event.touches || [])[0];
    this.runner.touchEnd(this.touchIndex(touch));
    this.refresh();
  },
  undo() { if (this.runner.undo()) this.refresh(); },
  reset() { this.runner.reset(); this.refresh(); },
  next() {
    if (!this.runner.isGameOver) return;
    if (this.levelIndex + 1 < (this.set.Games || []).length) this.levelIndex += 1;
    else if (this.setIndex + 1 < catalog.sets.length) { this.setIndex += 1; this.levelIndex = 0; }
    else return;
    this.loadLevel();
  }
});
