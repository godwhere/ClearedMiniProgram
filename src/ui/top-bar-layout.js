'use strict';

const CONTROL_SIZE = 48;
const SIDE_INSET = 16;
const TOP_INSET = 12;

function item(metrics, x, width) {
  return {
    x,
    y: (Number(metrics.safeTop) || 0) + TOP_INSET,
    w: width === undefined ? CONTROL_SIZE : width,
    h: CONTROL_SIZE
  };
}

function leading(metrics) {
  return item(metrics, SIDE_INSET);
}

function trailing(metrics, width) {
  const itemWidth = width === undefined ? CONTROL_SIZE : width;
  return item(metrics, metrics.width - SIDE_INSET - itemWidth, itemWidth);
}

function centerY(metrics) {
  return (Number(metrics.safeTop) || 0) + TOP_INSET + CONTROL_SIZE / 2;
}

module.exports = { CONTROL_SIZE, SIDE_INSET, item, leading, trailing, centerY };
