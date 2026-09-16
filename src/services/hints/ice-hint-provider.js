'use strict';

class IceHintProvider {
  constructor(ordinaryProvider, portalProvider) {
    this.ordinaryProvider = ordinaryProvider;
    this.portalProvider = portalProvider;
  }

  // Pure preset validation and presentation snapshots, never a live Runner.
  findComplete(context, storedPaths) {
    const primary = context && context.mechanic;
    const mixed = primary && primary.id === 'portal' && primary.rulesVersion === 2;
    const mechanic = mixed ? primary.ice : primary;
    const board = context && context.board;
    if (!board || !mechanic || mechanic.id !== 'ice' || mechanic.rulesVersion !== 1 ||
        !Array.isArray(mechanic.cells) || !mechanic.cells.length) return null;
    const total = board.width * board.height;
    if (!Number.isInteger(total) || total <= 0) return null;
    const remaining = Array.from({ length: total }, (unused, index) =>
      this.ordinaryProvider.isPlayable(context, index) ? 1 : 0);
    const iceCells = new Set();
    for (const cell of mechanic.cells) {
      const index = cell && cell.index;
      if (!Number.isInteger(index) || !this.ordinaryProvider.isPlayable(context, index) ||
          iceCells.has(index) || (board.fixedLine && board.fixedLine[index] >= 0) ||
          (mixed && (!this.portalProvider || this.portalProvider.portalAt(context, index)))) return null;
      iceCells.add(index);
      remaining[index] = 2;
    }
    const provider = mixed ? this.portalProvider : this.ordinaryProvider;
    if (!provider) return null;
    const complete = provider.findComplete(context, storedPaths, remaining);
    if (!complete) return null;
    const steps = complete.paths.map(path => {
      const step = { path, remainingLayers: remaining.slice(),
        breaksIce: path.path.some(index => iceCells.has(index) && remaining[index] === 2),
        clearsIce: path.path.some(index => iceCells.has(index) && remaining[index] === 1) };
      path.path.forEach(index => { remaining[index]--; });
      return step;
    });
    return Object.assign(complete, { steps });
  }
}

module.exports = IceHintProvider;
