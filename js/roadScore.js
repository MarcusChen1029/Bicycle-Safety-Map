/**
 * Road score adjustment math (pure). Browser global + Node-requirable.
 * adjust = (score - 0.5) * 2 * confidence * K, confidence = min(log2(count+1), 3).
 */
function roadScoreAdjustment(score, count, K = 1) {
  if (!count || count <= 0 || score == null) return 0;
  const confidence = Math.min(Math.log2(count + 1), 3);
  return (score - 0.5) * 2 * confidence * K;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { roadScoreAdjustment };
}
