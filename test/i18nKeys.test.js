const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { I18N } = require('../js/i18n.js');

const ROOT = path.join(__dirname, '..');
const SOURCES = [
  'index.html',
  ...fs.readdirSync(path.join(ROOT, 'js'))
    .filter(f => f.endsWith('.js') && f !== 'i18n.js')
    .map(f => `js/${f}`)
];

// Literal key references only; computed keys ('feedback.score' + n) are not checked here.
const KEY_PATTERNS = [
  /\sdata-i18n(?:-html|-placeholder|-title|-aria-label)?="([\w.]+)"/g,
  /I18N\.t\(\s*'([\w.]+)'/g,
  /I18N\.setText\([^,()]+,\s*'([\w.]+)'/g,
  /\b(?:showLoadingSpinner|showFeedbackToast|_setNavInstruction)\(\s*'([\w.]+)'/g,
  /\b(?:titleKey|textKey):\s*'([\w.]+)'/g
];

test('every literal i18n key referenced by the app exists in the dictionary', () => {
  const missing = [];
  for (const rel of SOURCES) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const re of KEY_PATTERNS) {
      for (const m of src.matchAll(re)) {
        if (!(m[1] in I18N.STRINGS.zh)) missing.push(`${rel}: ${m[1]}`);
      }
    }
  }
  assert.deepStrictEqual(missing, []);
});
