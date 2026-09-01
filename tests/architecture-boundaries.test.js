'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const CORE_DIR = path.join(__dirname, '..', 'core');
const SRC_DIR = path.join(__dirname, '..', 'src');
const MUTABLE_RUNNER_FIELDS = [
  'portalPending', 'portalLock', 'portalPhase', 'completedPaths',
  'completedSegments', 'completedTeleports', 'selectedCells',
  'selectedSegments', 'selectedLine', 'owner', 'fixedLine', 'blockedMask',
  'portalByCell', 'portals', 'completed', 'outcome', 'failureReason',
  'remainingPlayableCells'
];

function dependencies(source) {
  const result = [];
  const patterns = [
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ];
  patterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(source))) result.push(match[1]);
  });
  return result;
}

function forbiddenReason(dependency) {
  const normalized = dependency.replace(/\\/g, '/').toLowerCase();
  const resolved = dependency.startsWith('.')
    ? path.resolve(CORE_DIR, dependency)
    : null;
  if (resolved === SRC_DIR || (resolved && resolved.indexOf(`${SRC_DIR}${path.sep}`) === 0)) {
    return 'src runtime/UI layer';
  }
  if (/(^|\/)(wx|wechat)(\/|$)/.test(normalized)) return 'WeChat API adapter';
  if (/(^|[/_-])canvas([/_-]|$)/.test(normalized)) return 'Canvas dependency';
  if (/(^|\/)(daily-)?progress-store(?:\.js)?$/.test(normalized) ||
      /(^|[/_-])(storage|store)([/_.-]|$)/.test(normalized)) {
    return 'persistence service';
  }
  return null;
}

function run() {
  const files = fs.readdirSync(CORE_DIR)
    .filter(file => file.endsWith('.js'))
    .sort();

  assert(files.length > 0, 'core boundary test must inspect at least one JavaScript module');

  files.forEach(file => {
    const source = fs.readFileSync(path.join(CORE_DIR, file), 'utf8');
    assert(!/\bwx\s*(?:\.|\[)/.test(source), `core/${file} must not access the wx global`);
    assert(!/\bCanvas(?:RenderingContext2D)?\s*[.(]/.test(source),
      `core/${file} must not access Canvas globals`);
    assert(!/\b(?:localStorage|sessionStorage)\s*(?:\.|\[)/.test(source),
      `core/${file} must not access browser storage globals`);
    dependencies(source).forEach(dependency => {
      const reason = forbiddenReason(dependency);
      assert.strictEqual(reason, null,
        `core/${file} must not depend on ${reason}: ${dependency}`);
    });
  });

  const mutableAccess = new RegExp(
    `\\brunner\\s*\\.\\s*(?:${MUTABLE_RUNNER_FIELDS.join('|')})\\b`
  );
  const appSource = fs.readFileSync(path.join(SRC_DIR, 'app.js'), 'utf8');
  assert(!mutableAccess.test(appSource),
    'App must consume Runner commands and read-only queries, not mutable fields');

  const hintFacade = fs.readFileSync(
    path.join(SRC_DIR, 'services', 'hint-service.js'),
    'utf8'
  );
  assert(!mutableAccess.test(hintFacade),
    'HintService must consume getViewState() instead of mutable Runner fields');
  const hintProviderDir = path.join(SRC_DIR, 'services', 'hints');
  fs.readdirSync(hintProviderDir).filter(file => file.endsWith('.js')).forEach(file => {
    const source = fs.readFileSync(path.join(hintProviderDir, file), 'utf8');
    assert(!/\b(?:GameRunner|runner)\b/.test(source),
      `hint provider ${file} must consume only a pure HintContext`);
  });

  const uiFiles = [
    path.join(SRC_DIR, 'ui', 'canvas-renderer.js'),
    path.join(SRC_DIR, 'ui', 'board', 'board-renderer.js'),
    path.join(SRC_DIR, 'ui', 'board', 'portal-overlay.js')
  ];
  uiFiles.forEach(file => {
    const source = fs.readFileSync(file, 'utf8');
    assert(!/\b(?:GameRunner|runner)\b/.test(source),
      `${path.relative(SRC_DIR, file)} must render only a pure ViewModel`);
  });
}

module.exports = run;
