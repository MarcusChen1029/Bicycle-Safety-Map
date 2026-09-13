const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { I18N } = require('../js/i18n.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const CJK = /[一-鿿]/;
const norm = s => s.replace(/\s+/g, ' ').trim();

const TEXT_EL = /<(\w+)\b([^>]*?)\sdata-i18n="([\w.]+)"[^>]*>([^<]*)<\/\1>/g;
const HTML_EL = /<span\b[^>]*\sdata-i18n-html="([\w.]+)"[^>]*>(.*?)<\/span>/g;
const ATTRS = ['placeholder', 'title', 'aria-label'];

test('the language toggle button is in the search bar', () => {
  assert.match(html, /<button id="lang-toggle-btn"[^>]*\sdata-i18n="lang\.toggle"/);
});

test('data-i18n elements start with their zh dictionary text', () => {
  const found = [...html.matchAll(TEXT_EL)];
  assert.ok(found.length >= 55, `expected >= 55 data-i18n elements, found ${found.length}`);
  for (const m of found) {
    assert.strictEqual(norm(m[4]), I18N.STRINGS.zh[m[3]], `initial text of "${m[3]}"`);
  }
  for (const m of html.matchAll(HTML_EL)) {
    assert.strictEqual(m[2], I18N.STRINGS.zh[m[1]], `initial html of "${m[1]}"`);
  }
});

test('translated attributes start with their zh dictionary text', () => {
  let count = 0;
  for (const tag of html.match(/<\w+\b[^>]*>/g)) {
    for (const attr of ATTRS) {
      const key = (tag.match(new RegExp(`\\sdata-i18n-${attr}="([\\w.]+)"`)) || [])[1];
      if (!key) continue;
      count++;
      const value = (tag.match(new RegExp(`\\s${attr}="([^"]*)"`)) || [])[1];
      assert.strictEqual(value, I18N.STRINGS.zh[key], `${attr} of "${key}"`);
    }
  }
  assert.ok(count >= 14, `expected >= 14 translated attributes, found ${count}`);
});

test('all Chinese text in index.html is managed by i18n attributes', () => {
  const rest = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(TEXT_EL, '')
    .replace(HTML_EL, '')
    .replace(/<\w+\b[^>]*>/g, tag => {
      for (const attr of ATTRS) {
        if (tag.includes(` data-i18n-${attr}="`)) tag = tag.replace(new RegExp(`\\s${attr}="[^"]*"`), '');
      }
      return tag;
    });
  const leftovers = rest.split('\n').filter(line => CJK.test(line)).map(line => line.trim());
  assert.deepStrictEqual(leftovers, []);
});

test('English-only UI labels were given Chinese defaults', () => {
  for (const english of ['>Search<', '>Clear<', '>Map<', '>Favorites<', '>Report<', '>More<', 'Bicycle Safety map']) {
    assert.ok(!html.includes(english), `index.html still contains ${english}`);
  }
});
