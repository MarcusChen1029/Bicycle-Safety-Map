const { test } = require('node:test');
const assert = require('node:assert');
const { parseRoadName, normalizeRoadName, extractRoadNames } = require('../js/roadName.js');

test('normalizeRoadName strips spaces and section suffix', () => {
  assert.strictEqual(normalizeRoadName(' 仁愛路二段 '), '仁愛路');
  assert.strictEqual(normalizeRoadName('市民大道'), '市民大道');
  assert.strictEqual(normalizeRoadName('信義路五段'), '信義路');
});

test('parseRoadName pulls road name out of <b> tags', () => {
  assert.strictEqual(parseRoadName('向<b>右</b>轉，繼續沿<b>仁愛路二段</b>前進'), '仁愛路');
  assert.strictEqual(parseRoadName('在 <b>市民大道</b> 向左轉'), '市民大道');
});

test('parseRoadName falls back to plain-text road token', () => {
  assert.strictEqual(parseRoadName('繼續直行上信義路五段'), '信義路');
  assert.strictEqual(parseRoadName('右轉進入中山北路'), '中山北路');
  assert.strictEqual(parseRoadName('請沿羅斯福路三段直行'), '羅斯福路');
  assert.strictEqual(parseRoadName('進入忠孝東路四段'), '忠孝東路');
});

test('parseRoadName returns null when no road found', () => {
  assert.strictEqual(parseRoadName('抵達目的地'), null);
  assert.strictEqual(parseRoadName(''), null);
  assert.strictEqual(parseRoadName(null), null);
});

test('extractRoadNames dedupes and preserves order', () => {
  const route = { legs: [{ steps: [
    { instructions: '沿<b>仁愛路二段</b>前進' },
    { instructions: '繼續沿<b>仁愛路三段</b>前進' },
    { instructions: '右轉進入<b>敦化南路</b>' },
    { instructions: '抵達目的地' }
  ] }] };
  assert.deepStrictEqual(extractRoadNames(route), ['仁愛路', '敦化南路']);
});

test('parseRoadName: pedestrian-crossing instructions are not road names', () => {
  assert.strictEqual(parseRoadName('走<b>行人穿越道</b>'), null);
  assert.strictEqual(parseRoadName('走行人穿越道'), null);
  assert.strictEqual(normalizeRoadName('行人穿越道'), '');
});
