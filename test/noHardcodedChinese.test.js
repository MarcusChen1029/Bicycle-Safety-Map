const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CJK = /[一-鿿]/;

// Files whose user-visible text must come from js/i18n.js. Each value lists
// code fragments that are allowed to contain Chinese because the code matches
// them against data (not text shown to users). Add a file once it is converted.
// js/routeStats.js and js/roadName.js are pure data-matching modules and are
// intentionally not listed.
const CHECKED_FILES = {
  'js/accidentLayer.js': ["accident.severity === '死亡'", "description: '示範事故'"],
  'js/map_init.js': [],
  'js/dangerZones.js': [],
  'js/config.js': [],
  'js/script.js': ['throw new Error(', 'reject(new Error(']
};

// Blank out // and /* */ comments; keep string/template literals and line numbers.
function stripComments(src) {
  let out = '';
  let state = 'code';
  let quote = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];
    if (state === 'code') {
      if (c === '/' && next === '/') { state = 'line'; out += '  '; i++; continue; }
      if (c === '/' && next === '*') { state = 'block'; out += '  '; i++; continue; }
      if (c === '\'' || c === '"' || c === '`') { state = 'str'; quote = c; }
      out += c;
    } else if (state === 'str') {
      out += c;
      if (c === '\\') { out += next || ''; i++; continue; }
      if (c === quote) state = 'code';
    } else if (state === 'line') {
      if (c === '\n') { state = 'code'; out += c; } else out += ' ';
    } else {
      if (c === '*' && next === '/') { state = 'code'; out += '  '; i++; continue; }
      out += c === '\n' ? c : ' ';
    }
  }
  return out;
}

function hardcodedChineseLines(src, allow) {
  return stripComments(src)
    .split(/\r?\n/)
    .map((code, i) => `${i + 1}: ${code.trim()}`)
    .filter(line => CJK.test(line))
    .filter(line => !/\bconsole\.(log|info|warn|error|debug)\(/.test(line))
    .filter(line => !allow.some(fragment => line.includes(fragment)));
}

test('stripComments removes comments but keeps strings', () => {
  const src = "const a = '中文'; // 註解\n/* 區塊\n註解 */ const b = `x // 不是註解`;";
  const lines = hardcodedChineseLines(src, []);
  assert.deepStrictEqual(lines, ["1: const a = '中文';", '3: const b = `x // 不是註解`;']);
});

test('console lines and allowed fragments are ignored', () => {
  const src = "console.log('載入中');\nif (x === '死亡') {}\nalert('錯誤');";
  assert.deepStrictEqual(hardcodedChineseLines(src, ["=== '死亡'"]), ["3: alert('錯誤');"]);
});

for (const [rel, allow] of Object.entries(CHECKED_FILES)) {
  test(`${rel} has no hardcoded Chinese UI text`, () => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.deepStrictEqual(hardcodedChineseLines(src, allow), []);
  });
}
