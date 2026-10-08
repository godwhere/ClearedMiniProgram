#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const MIB = 1024 * 1024;
const BUDGETS = Object.freeze({
  main: Math.floor(1.63 * MIB), subpackage: Math.floor(3.5 * MIB),
  total: 18 * MIB, platformHardLimit: 4 * MIB
});

function relativePath(value) {
  return typeof value === 'string' && value.length > 0 &&
    !/[\\:]/.test(value) && !value.startsWith('/') &&
    value.replace(/\/$/, '').split('/').every(part => part && part !== '.' && part !== '..');
}

function validateSubpackages(packages) {
  if (!Array.isArray(packages)) throw new Error('game.json.subpackages must be an array');
  const names = new Set(['main', 'total', '__proto__', 'constructor', 'prototype']);
  const roots = [];
  packages.forEach(item => {
    if (!item || typeof item.name !== 'string' || !/^[\w-]+$/.test(item.name) || names.has(item.name)) {
      throw new Error('Invalid or duplicate subpackage name');
    }
    if (!relativePath(item.root) || !item.root.endsWith('/')) {
      throw new Error(`Invalid subpackage root: ${item.root}`);
    }
    if (item.independent !== undefined) throw new Error('Only ordinary subpackages are supported');
    if (roots.some(root => root.startsWith(item.root) || item.root.startsWith(root))) {
      throw new Error(`Duplicate or nested subpackage root: ${item.root}`);
    }
    names.add(item.name);
    roots.push(item.root);
  });
}

function validateIgnore(ignore) {
  if (!Array.isArray(ignore)) throw new Error('packOptions.ignore must be an array');
  ignore.forEach(item => {
    // The project currently uses only exact files and directory prefixes.
    // Fail closed if another DevTools rule type is introduced; implement its
    // semantics and fixtures before relying on a potentially smaller count.
    if (!item || !['file', 'folder'].includes(item.type) || !relativePath(item.value)) {
      throw new Error('Unsupported packOptions.ignore rule');
    }
  });
}

function isIgnored(source, ignore) {
  if (source === '.git' || source.startsWith('.git/')) return true;
  return ignore.some(item => {
    const value = item.value.replace(/\/$/, '');
    return source === value || (item.type === 'folder' && source.startsWith(`${value}/`));
  });
}

function packageForFile(source, packages) {
  const match = packages.filter(item => source.startsWith(item.root))
    .sort((a, b) => b.root.length - a.root.length)[0];
  return match ? match.name : 'main';
}

// Pure analysis accepts source byte sizes, so edge cases need no real large
// files or network. Files ignored by the upload configuration are excluded.
function analyzePackageBudget(files, packages, ignore, budgets = BUDGETS) {
  validateSubpackages(packages);
  validateIgnore(ignore);
  const published = files.filter(file => !isIgnored(file.path, ignore));
  const paths = new Set();
  published.forEach(file => {
    if (!relativePath(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || paths.has(file.path)) {
      throw new Error(`Invalid or duplicate file: ${file.path}`);
    }
    paths.add(file.path);
  });
  packages.forEach(item => {
    if (!paths.has(`${item.root}game.js`)) throw new Error(`Missing published entry: ${item.root}game.js`);
  });
  // WeChat accepts an adjacent JS sourcemap for upload but exempts it from
  // code-package size. An orphan map remains counted rather than assumed safe.
  const counted = published.filter(file =>
    !file.path.endsWith('.js.map') || !paths.has(file.path.slice(0, -4)));
  const rows = [{ name: 'main', root: '', budget: budgets.main }]
    .concat(packages.map(item => ({ name: item.name, root: item.root, budget: budgets.subpackage })))
    .map(item => {
      const contents = counted.filter(file => packageForFile(file.path, packages) === item.name);
      const bytes = contents.reduce((sum, file) => sum + file.bytes, 0);
      return Object.assign({}, item, {
        bytes, fileCount: contents.length,
        largestFiles: contents.slice().sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path))
          .slice(0, 5).map(file => Object.assign({}, file)),
        passed: bytes <= item.budget && bytes < budgets.platformHardLimit
      });
    });
  const total = {
    name: 'total', bytes: rows.reduce((sum, row) => sum + row.bytes, 0),
    budget: budgets.total, fileCount: counted.length
  };
  total.passed = total.bytes <= total.budget;
  const errors = rows.flatMap(row => {
    const messages = [];
    if (row.bytes > row.budget) messages.push(`${row.name} exceeds project budget`);
    if (row.bytes >= budgets.platformHardLimit) messages.push(`${row.name} must be strictly below 4 MiB`);
    return messages;
  });
  if (!total.passed) errors.push('total exceeds project budget');
  return { packages: rows, total, errors };
}

function checkProject(projectRoot) {
  const readJSON = source => JSON.parse(fs.readFileSync(path.join(projectRoot, source), 'utf8'));
  const game = readJSON('game.json');
  const project = readJSON('project.config.json');
  const ignore = project.packOptions.ignore;
  validateSubpackages(game.subpackages);
  validateIgnore(ignore);
  if (project.packOptions.include && project.packOptions.include.length) {
    throw new Error('Nonempty packOptions.include requires explicit budget support');
  }
  const files = [];
  function walk(directory) {
    fs.readdirSync(path.join(projectRoot, directory), { withFileTypes: true }).forEach(entry => {
      const source = directory ? `${directory}/${entry.name}` : entry.name;
      if (isIgnored(source, ignore)) return;
      if (entry.isSymbolicLink()) throw new Error(`Unsupported publish symlink: ${source}`);
      if (entry.isDirectory()) walk(source);
      else if (entry.isFile()) files.push({ path: source, bytes: fs.statSync(path.join(projectRoot, source)).size });
    });
  }
  walk('');
  return analyzePackageBudget(files, game.subpackages, ignore);
}

function formatReport(report) {
  const lines = ['Source-byte estimate only; verify final packages in WeChat Developer Tools.'];
  report.packages.concat([report.total]).forEach(row => {
    lines.push(`${row.passed ? 'PASS' : 'FAIL'} ${row.name.padEnd(16)} ${row.bytes} bytes ` +
      `(${(row.bytes / MIB).toFixed(3)} MiB) / ${(row.budget / MIB).toFixed(2)} MiB; ${row.fileCount} files`);
    (row.largestFiles || []).forEach(file => lines.push(`  ${file.bytes}  ${file.path}`));
  });
  return lines.concat(report.errors).join('\n');
}

if (require.main === module) {
  try {
    const report = checkProject(path.resolve(process.argv[2] || path.join(__dirname, '..')));
    console.log(formatReport(report));
    process.exitCode = report.errors.length ? 1 : 0;
  } catch (error) {
    console.error(`FAIL ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { BUDGETS, validateSubpackages, isIgnored, packageForFile, analyzePackageBudget, checkProject, formatReport };
