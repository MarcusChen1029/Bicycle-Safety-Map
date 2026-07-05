const { test } = require('node:test');
const assert = require('node:assert');
const { roadScoreAdjustment } = require('../js/roadScore.js');

test('no votes is neutral', () => {
  assert.strictEqual(roadScoreAdjustment(null, 0), 0);
  assert.strictEqual(roadScoreAdjustment(1, 0), 0);
  assert.strictEqual(roadScoreAdjustment(1, -1), 0);
});

test('score 0.5 is neutral regardless of count', () => {
  assert.strictEqual(roadScoreAdjustment(0.5, 5), 0);
});

test('all-good single vote gives +1', () => {
  // (1-0.5)*2*log2(2)*1 = 1*1*1 = 1
  assert.strictEqual(roadScoreAdjustment(1, 1), 1);
});

test('all-bad single vote gives -1', () => {
  assert.strictEqual(roadScoreAdjustment(0, 1), -1);
});

test('confidence caps at 3 (count 7 -> log2(8)=3)', () => {
  // (1-0.5)*2*3*1 = 3
  assert.strictEqual(roadScoreAdjustment(1, 7), 3);
  // even with huge count, capped
  assert.strictEqual(roadScoreAdjustment(1, 1000), 3);
});

test('K scales the adjustment', () => {
  assert.strictEqual(roadScoreAdjustment(1, 1, 2), 2);
});
