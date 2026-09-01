const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', 'data');
const names = [
  'clearedset_train',
  'clearedset5',
  'clearedset6',
  'clearedset7',
  'clearedset8'
];

names.forEach(name => {
  const jsonPath = path.join(root, `${name}.json`);
  const modulePath = path.join(root, `${name}.js`);
  const source = fs.readFileSync(jsonPath, 'utf8').replace(/^\uFEFF/, '');
  const data = JSON.parse(source);
  const output = [
    '// Generated from the adjacent JSON source. Do not edit by hand.',
    `'use strict';`,
    `module.exports = ${JSON.stringify(data)};`,
    ''
  ].join('\n');
  fs.writeFileSync(modulePath, output, 'utf8');
});
