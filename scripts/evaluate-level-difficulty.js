'use strict';

// Offline design estimate, not a player-performance model. Only the current
// mainline boards up to 8x8 are supported, including connected/scattered ice.
const iceRules = require('../core/mechanics/ice-v1.js');
const clamp = value => Math.max(0, Math.min(1, value));
const round = value => Math.round(value * 100) / 100;

function evaluate(level, answer) {
  if (!level || !Number.isInteger(level.Width) || level.Width < 1 || level.Width > 8 ||
      !Number.isInteger(level.Height) || level.Height < 1 || level.Height > 8 ||
      !Array.isArray(level.Lines) || !level.Lines.length || !Array.isArray(answer) ||
      answer.length !== level.Lines.length || (level.Mechanic && !['portal', 'ice'].includes(level.Mechanic)) ||
      (level.IceCells !== undefined && level.Mechanic !== 'ice')) throw new Error('Difficulty v1 requires a mainline ordinary/Portal/ice answer up to 8x8');
  const width = level.Width, area = width * level.Height;
  const ice = new Set(level.Mechanic === 'ice' ? iceRules.normalize(level,
    Array.from({ length: area }, (_, cell) => (level.Blocked || []).includes(cell))) : []);
  if (level.Mechanic === 'ice' && (level.IceRulesVersion !== 1 || !ice.size)) {
    throw new Error('Ice difficulty requires valid two-pass ice cells');
  }
  const groups = answer.map(line => Array.isArray(line) ? [line] : line.Segments.map(segment => segment.Cells));
  const endpoints = new Set(level.Lines.flatMap(line => [line.Start, line.End]));
  const doors = new Set((level.Portals || []).flatMap(network => network.Cells || [network.A, network.B]));
  const blocked = new Set(level.Blocked || []);
  const owner = new Array(area).fill(-1);
  groups.forEach((segments, color) => segments.flat().forEach(cell => { owner[cell] = color; }));
  function adjacent(cell) {
    return [cell - width, cell - 1, cell + 1, cell + width].filter(next => next >= 0 && next < area &&
      Math.abs(cell % width - next % width) + Math.abs(Math.floor(cell / width) - Math.floor(next / width)) === 1);
  }
  function distances(start, allowed) {
    const distance = new Array(area).fill(Infinity);
    distance[start] = 0;
    const queue = [start];
    for (let i = 0; i < queue.length; i += 1) {
      adjacent(queue[i]).forEach(next => {
        if (allowed(next) && distance[next] === Infinity) {
          distance[next] = distance[queue[i]] + 1;
          queue.push(next);
        }
      });
    }
    return distance;
  }
  const icePairs = new Set();
  ice.forEach(cell => {
    const visitors = [];
    groups.forEach((segments, color) => segments.flat().forEach(value => {
      if (value === cell) visitors.push(color);
    }));
    if (visitors.length !== 2 || visitors[0] === visitors[1]) {
      throw new Error('Ice difficulty requires two distinct routes per ice cell');
    }
    icePairs.add(visitors.join(':'));
  });
  const unseenIce = new Set(ice);
  let iceGroups = 0, largestIceGroup = 0;
  while (unseenIce.size) {
    const queue = [unseenIce.values().next().value];
    unseenIce.delete(queue[0]); iceGroups++;
    for (let i = 0; i < queue.length; i++) adjacent(queue[i]).forEach(cell => {
      if (unseenIce.delete(cell)) queue.push(cell);
    });
    largestIceGroup = Math.max(largestIceGroup, queue.length);
  }
  // Preserve the single-cell teaching anchor (6). More cells, disconnected
  // regions and different sharing route-pairs add bounded planning cost.
  // This is a two-pass design estimate, not proof of solution uniqueness.
  const iceCost = ice.size ? 6 + 4 * clamp((ice.size - 1) / 11) +
    3 * clamp((iceGroups - 1) / 3) + 2 * clamp((icePairs.size - 1) / 3) : 0;
  let steps = 0, detours = 0, bends = 0, easyLines = 0, competition = 0;
  const lengths = [];
  const lineMetrics = groups.map((segments, color) => {
    let lineSteps = 0, lineDetours = 0, lineBends = 0;
    const competitors = new Set();
    segments.forEach(path => {
      const start = path[0], end = path[path.length - 1];
      const allowed = cell => cell === start || cell === end ||
        (!endpoints.has(cell) && !doors.has(cell) && !blocked.has(cell));
      const from = distances(start, allowed), to = distances(end, allowed);
      if (!Number.isFinite(from[end])) throw new Error('Stored segment has no legal contiguous route');
      lineSteps += path.length - 1;
      lineDetours += Math.max(0, path.length - 1 - from[end]);
      for (let i = 2; i < path.length; i += 1) {
        if (path[i] - path[i - 1] !== path[i - 1] - path[i - 2]) lineBends += 1;
      }
      // Competing colors on ANY endpoint-legal shortest route, not just the
      // first BFS witness or overlapping bounding boxes. Still answer-relative.
      from.forEach((distance, cell) => {
        if (!ice.has(cell) && distance + to[cell] === from[end] && owner[cell] >= 0 && owner[cell] !== color) {
          competitors.add(owner[cell]);
        }
      });
    });
    const length = segments.flat().length;
    const easy = segments.length === 1 && length <= 8 && lineDetours === 0 && lineBends <= 1;
    lengths.push(length);
    steps += lineSteps; detours += lineDetours; bends += lineBends;
    if (easy) easyLines += 1;
    competition += competitors.size;
    return { length, detours: lineDetours, bends: lineBends, competitors: competitors.size, easy };
  });
  const colors = groups.length;
  const detourRate = steps ? detours / steps : 0;
  const bendsPerLine = bends / colors;
  const competingColors = competition / colors;
  const factors = {
    path: round(30 * clamp(0.6 * detourRate / 0.45 + 0.4 * bendsPerLine / 5)),
    space: round(25 * clamp(competingColors / 3)),
    readability: round(20 * (1 - easyLines / colors)),
    mechanic: round(ice.size ? iceCost : doors.size ? 15 * clamp(0.4 + Math.max(0, doors.size - 2) * 0.25 + competingColors / 15) : 0),
    colors: round(10 * clamp((colors - 4) / 6))
  };
  const score = round(Object.values(factors).reduce((sum, value) => sum + value, 0));
  // Calibrated design anchors: the original 47/64 multi-region Portal boards
  // occupy the challenge tier. Grades remain provisional until device playtest.
  return { score, grade: 1 + [20, 40, 60, 75].filter(boundary => score >= boundary).length, factors,
    colors, doors: doors.size, iceCells: ice.size, iceGroups, largestIceGroup, iceRoutePairs: icePairs.size,
    easyLines, lengths, detourRate: round(detourRate),
    bendsPerLine: round(bendsPerLine), competingColors: round(competingColors), lineMetrics };
}

module.exports = evaluate;

if (require.main === module) {
  const catalog = require('../data/catalog-v2.js');
  const normal = require('../data/solutions.js');
  const portal = require('../data/portal-solutions.js');
  const rows = catalog.levels.map((entry, index) => {
    const level = entry.game;
    const answer = level.Mechanic === 'portal' ? portal.ByLevelId[level.Id] :
      normal.ByLevelId[level.Id] || normal.sets[entry.setIndex][entry.levelIndex];
    return { number: index + 1, key: `${entry.setIndex}:${entry.levelIndex}`, id: level.Id || null,
      name: level.Name, published: level.Difficulty || null, ...evaluate(level, answer) };
  });
  if (process.argv.includes('--markdown')) {
    console.log('| 显示号 | 稳定坐标 | 名称 | 设计难度 | 分数 | 色/门/冰 | 起手候选 | 绕行比 | 每线竞争色 |');
    console.log('| ---: | --- | --- | ---: | ---: | --- | ---: | ---: | ---: |');
    rows.forEach(row => console.log(`| ${row.number} | ${row.key} | ${row.name} | ${row.published || row.grade} | ${row.score} | ${row.colors}/${row.doors}/${row.iceCells} | ${row.easyLines} | ${row.detourRate} | ${row.competingColors} |`));
  } else {
    console.log(JSON.stringify(rows));
  }
}
