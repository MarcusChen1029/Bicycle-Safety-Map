const { test } = require('node:test');
const assert = require('node:assert');
const {
  severityWeight,
  computeAccidentScore,
  computeInfrastructureScore,
  classValueForRoadName,
  computeClassIndex,
  computeJunctionIndex,
  computeTrafficIndex,
  trafficIdxFallback,
  computeRiskScore,
  computeRoadRiskScore,
  computePointInfraScore,
  computeOpinionScore,
  computeOverallGrade,
  gradeForScore,
  computeSelectionRisk,
  computeSelectionScore,
  computeFatalPenalty,
  SELECTION_WEIGHTS
} = require('../js/routeStats.js');

// ------------------------------------------------------------------
// 歷史事故 (accident score)
// ------------------------------------------------------------------

test('severityWeight maps known Chinese severities, unknown -> 1', () => {
  assert.strictEqual(severityWeight('死亡'), 10);
  assert.strictEqual(severityWeight('重傷'), 5);
  assert.strictEqual(severityWeight('輕傷'), 1);
  assert.strictEqual(severityWeight('無傷'), 0.3);
  assert.strictEqual(severityWeight('something-else'), 1);
  assert.strictEqual(severityWeight(undefined), 1);
});

test('computeAccidentScore: no accidents -> 100 regardless of route length', () => {
  assert.strictEqual(computeAccidentScore([], 5), 100);
  assert.strictEqual(computeAccidentScore([], 0), 100);
  assert.strictEqual(computeAccidentScore(null, 5), 100);
});

test('computeAccidentScore: known D gives the harmonic-falloff score', () => {
  // 2x 輕傷 (weight 1 each) over 1km -> D = 2/1 = 2
  // score = round(100 / (1 + 2/30))
  const expected = Math.round(100 / (1 + 2 / 30));
  assert.strictEqual(computeAccidentScore([{ severity: '輕傷' }, { severity: '輕傷' }], 1), expected);
  // Half-point anchor: D = 30 -> exactly 50
  const thirty = Array.from({ length: 30 }, () => ({ severity: '輕傷' }));
  assert.strictEqual(computeAccidentScore(thirty, 1), 50);
});

test('computeAccidentScore: severe accidents weigh far more heavily', () => {
  // 1x 死亡 (weight 10) over 2km -> D = 5
  const expected = Math.round(100 / (1 + 5 / 30));
  assert.strictEqual(computeAccidentScore([{ severity: '死亡' }], 2), expected);
  // Sanity: a fatal accident scores much worse than light ones over the same distance
  const lightScore = computeAccidentScore([{ severity: '輕傷' }], 2);
  const fatalScore = computeAccidentScore([{ severity: '死亡' }], 2);
  assert.ok(fatalScore < lightScore);
});

// ------------------------------------------------------------------
// 基礎設施 (infrastructure score)
// ------------------------------------------------------------------

test('computeInfrastructureScore: full coverage both terms -> 100', () => {
  assert.strictEqual(computeInfrastructureScore(1, 1, true), 100);
});

test('computeInfrastructureScore: zero coverage -> base 30', () => {
  assert.strictEqual(computeInfrastructureScore(0, 0, true), 30);
});

test('computeInfrastructureScore: partial coverage matches the weighted formula', () => {
  // 30 + 45*0.5 + 25*0.4 = 30 + 22.5 + 10 = 62.5 -> round 63 (round-half-up via Math.round)
  assert.strictEqual(computeInfrastructureScore(0.5, 0.4, true), Math.round(30 + 45 * 0.5 + 25 * 0.4));
});

test('computeInfrastructureScore: out-of-coverage drops the YouBike term and renormalizes', () => {
  // No station within 2km -> 30 + 70*laneCoverage, youbikeAccess argument ignored
  assert.strictEqual(computeInfrastructureScore(1, 0.9, false), 100);
  assert.strictEqual(computeInfrastructureScore(0, 0.9, false), 30);
  assert.strictEqual(computeInfrastructureScore(0.5, 0, false), Math.round(30 + 70 * 0.5));
});

// ------------------------------------------------------------------
// 交通環境風險 (risk score) — classIdx, junctionIdx, trafficIdx, overall
// ------------------------------------------------------------------

test('classValueForRoadName: suffix mapping incl. 高架/巷/unknown', () => {
  assert.strictEqual(classValueForRoadName('環河快速道路'), 1.0);
  assert.strictEqual(classValueForRoadName('建國南路高架'), 1.0);
  assert.strictEqual(classValueForRoadName('市民大道'), 0.8);
  assert.strictEqual(classValueForRoadName('仁愛路'), 0.55);
  assert.strictEqual(classValueForRoadName('永康街'), 0.35);
  assert.strictEqual(classValueForRoadName('赤峰巷'), 0.15);
  assert.strictEqual(classValueForRoadName('青田弄'), 0.15);
  assert.strictEqual(classValueForRoadName(null), 0.5);
  assert.strictEqual(classValueForRoadName(''), 0.5);
  assert.strictEqual(classValueForRoadName('無名小徑'), 0.5);
});

test('computeClassIndex: distance-weighted mean across steps', () => {
  // 600m 路 (0.55) + 400m 街 (0.35) -> (600*0.55 + 400*0.35) / 1000 = (330+140)/1000 = 0.47
  const idx = computeClassIndex([
    { roadName: '仁愛路', distanceM: 600 },
    { roadName: '永康街', distanceM: 400 }
  ]);
  assert.ok(Math.abs(idx - 0.47) < 1e-9);
});

test('computeClassIndex: empty/zero-distance steps fall back to the 0.5 default', () => {
  assert.strictEqual(computeClassIndex([]), 0.5);
  assert.strictEqual(computeClassIndex(null), 0.5);
  assert.strictEqual(computeClassIndex([{ roadName: '仁愛路', distanceM: 0 }]), 0.5);
});

test('computeJunctionIndex: clamps to [0,1]', () => {
  assert.strictEqual(computeJunctionIndex(0, 5), 0);
  // 8 maneuvers / 2km / 8 = 0.5
  assert.strictEqual(computeJunctionIndex(8, 2), 0.5);
  // way more maneuvers than distance supports -> clamp to 1
  assert.strictEqual(computeJunctionIndex(100, 1), 1);
});

test('computeTrafficIndex: r=1 -> 0, r=1.4 -> 0.5, r>=1.8 -> 1 (clamped)', () => {
  assert.strictEqual(computeTrafficIndex(1), 0);
  assert.ok(Math.abs(computeTrafficIndex(1.4) - 0.5) < 1e-9);
  assert.strictEqual(computeTrafficIndex(1.8), 1);
  assert.strictEqual(computeTrafficIndex(2.5), 1);
  assert.strictEqual(computeTrafficIndex(0.5), 0); // less congested than free-flow -> clamped to 0
});

test('trafficIdxFallback: weekday time-of-day boundaries', () => {
  // Monday 2024-01-08
  const mon = (h, m) => new Date(2024, 0, 8, h, m);
  assert.strictEqual(trafficIdxFallback(mon(6, 59)), 0.15); // just before morning peak
  assert.strictEqual(trafficIdxFallback(mon(7, 0)), 0.7);   // morning peak starts
  assert.strictEqual(trafficIdxFallback(mon(8, 59)), 0.7);  // still morning peak
  assert.strictEqual(trafficIdxFallback(mon(9, 0)), 0.4);   // midday starts
  assert.strictEqual(trafficIdxFallback(mon(16, 59)), 0.4); // still midday
  assert.strictEqual(trafficIdxFallback(mon(17, 0)), 0.7);  // evening peak starts
  assert.strictEqual(trafficIdxFallback(mon(19, 29)), 0.7); // still evening peak
  assert.strictEqual(trafficIdxFallback(mon(19, 30)), 0.15); // evening peak ends
  assert.strictEqual(trafficIdxFallback(mon(23, 0)), 0.15);
});

test('trafficIdxFallback: weekends are always the off-peak default', () => {
  // Saturday 2024-01-06, during what would be a weekday morning peak
  const sat = new Date(2024, 0, 6, 8, 0);
  assert.strictEqual(trafficIdxFallback(sat), 0.15);
  const sun = new Date(2024, 0, 7, 18, 0);
  assert.strictEqual(trafficIdxFallback(sun), 0.15);
});

test('computeRiskScore matches the weighted formula', () => {
  assert.strictEqual(computeRiskScore(0, 0, 0), 100);
  assert.strictEqual(computeRiskScore(1, 1, 1), Math.round(100 - (40 + 25 + 35)));
  assert.strictEqual(computeRiskScore(0.5, 0.5, 0.5), Math.round(100 - (20 + 12.5 + 17.5)));
});

test('computeRoadRiskScore (road-level, no junctionIdx) matches the 60/40 formula', () => {
  assert.strictEqual(computeRoadRiskScore(0, 0), 100);
  assert.strictEqual(computeRoadRiskScore(1, 1), Math.round(100 - (60 + 40)));
  assert.strictEqual(computeRoadRiskScore(0.5, 0.5), Math.round(100 - (30 + 20)));
  // A fast-road-class name at peak traffic scores worse than a quiet lane off-peak
  assert.ok(computeRoadRiskScore(1.0, 0.7) < computeRoadRiskScore(0.15, 0.15));
});

// ------------------------------------------------------------------
// 基礎設施 (road-level point infrastructure score)
// ------------------------------------------------------------------

test('computePointInfraScore: neither lane nor station nearby -> base 30', () => {
  assert.strictEqual(computePointInfraScore(false, false), 30);
});

test('computePointInfraScore: lane-only, station-only, and both', () => {
  assert.strictEqual(computePointInfraScore(true, false), 75);
  assert.strictEqual(computePointInfraScore(false, true), 55);
  assert.strictEqual(computePointInfraScore(true, true), 100);
});

// ------------------------------------------------------------------
// 民眾意見 (opinion score)
// ------------------------------------------------------------------

test('computeOpinionScore: no data -> default 70, flagged hasData=false', () => {
  assert.deepStrictEqual(computeOpinionScore(0, 0), { score: 70, hasData: false });
});

test('computeOpinionScore: averages per-step scores onto a 0-100 scale', () => {
  assert.deepStrictEqual(computeOpinionScore(1.5, 2), { score: 75, hasData: true });
  assert.deepStrictEqual(computeOpinionScore(4, 4), { score: 100, hasData: true });
});

// ------------------------------------------------------------------
// 友善等級 (overall grade + thresholds)
// ------------------------------------------------------------------

test('gradeForScore: boundary values', () => {
  assert.deepStrictEqual(gradeForScore(85), { letter: 'B', color: '#daff07' });
  assert.deepStrictEqual(gradeForScore(85.01), { letter: 'A', color: '#28a745' });
  assert.deepStrictEqual(gradeForScore(70), { letter: 'C', color: '#dc8e35' });
  assert.deepStrictEqual(gradeForScore(55), { letter: 'D', color: '#ff0000' });
  assert.deepStrictEqual(gradeForScore(40), { letter: 'E', color: '#000' });
  assert.deepStrictEqual(gradeForScore(0), { letter: 'E', color: '#000' });
});

test('computeOverallGrade: full weighting when opinion has data', () => {
  const scores = { accident: 100, risk: 100, infrastructure: 100, opinion: 100 };
  const result = computeOverallGrade(scores, true);
  assert.strictEqual(result.overall, 100);
  assert.strictEqual(result.letter, 'A');
});

test('computeOverallGrade: opinion excluded and remaining weights renormalized', () => {
  // accident=100, risk=100, infra=100, opinion excluded (e.g. default 70 would drag it down
  // if it were wrongly included) -> overall should still be 100, not ~95.5
  const scores = { accident: 100, risk: 100, infrastructure: 100, opinion: 70 };
  const result = computeOverallGrade(scores, false);
  assert.strictEqual(result.overall, 100);
});

test('computeOverallGrade: weighted mean matches manual computation', () => {
  const scores = { accident: 80, risk: 60, infrastructure: 50, opinion: 90 };
  // 0.35*80 + 0.30*60 + 0.20*50 + 0.15*90 = 28 + 18 + 10 + 13.5 = 69.5 -> round 70 -> 'C'
  const result = computeOverallGrade(scores, true);
  assert.strictEqual(result.overall, Math.round(0.35 * 80 + 0.30 * 60 + 0.20 * 50 + 0.15 * 90));
  assert.strictEqual(result.letter, 'C');
});

test('computeOverallGrade: opinion-excluded renormalization matches manual computation', () => {
  const scores = { accident: 80, risk: 60, infrastructure: 50, opinion: 70 };
  const remaining = 1 - 0.15; // 0.85
  const expectedOverall = Math.round((0.35 * 80 + 0.30 * 60 + 0.20 * 50) / remaining);
  const result = computeOverallGrade(scores, false);
  assert.strictEqual(result.overall, expectedOverall);
});

// ------------------------------------------------------------------
// 友善等級 — extended availability (object form: road-level click flow,
// where 歷史事故 can ALSO be missing, unlike the route flow which only
// ever loses 民眾意見).
// ------------------------------------------------------------------

test('computeOverallGrade: object-form availability with everything present matches the boolean-true default', () => {
  const scores = { accident: 80, risk: 60, infrastructure: 50, opinion: 90 };
  const bool = computeOverallGrade(scores, true);
  const obj = computeOverallGrade(scores, {});
  assert.strictEqual(obj.overall, bool.overall);
  assert.strictEqual(obj.letter, bool.letter);
});

test('computeOverallGrade: accident missing (road-level, no road_stats entry) excluded and renormalized', () => {
  // accident's placeholder value (0) must NOT drag the grade down once excluded
  const scores = { accident: 0, risk: 100, infrastructure: 100, opinion: 100 };
  const result = computeOverallGrade(scores, { accident: false });
  assert.strictEqual(result.overall, 100);
});

test('computeOverallGrade: accident-excluded renormalization matches manual computation', () => {
  const scores = { accident: 0, risk: 60, infrastructure: 50, opinion: 90 };
  const remaining = 1 - 0.35; // 0.65
  const expectedOverall = Math.round((0.30 * 60 + 0.20 * 50 + 0.15 * 90) / remaining);
  const result = computeOverallGrade(scores, { accident: false });
  assert.strictEqual(result.overall, expectedOverall);
});

test('computeOverallGrade: both accident AND opinion missing (road-level click, brand-new road with no votes) renormalize together', () => {
  const scores = { accident: 0, risk: 60, infrastructure: 50, opinion: 0 };
  const remaining = 1 - 0.35 - 0.15; // 0.50
  const expectedOverall = Math.round((0.30 * 60 + 0.20 * 50) / remaining);
  const result = computeOverallGrade(scores, { accident: false, opinion: false });
  assert.strictEqual(result.overall, expectedOverall);
});

// ------------------------------------------------------------------
// 路線選擇 (selection-only score) — computeSelectionRisk, computeSelectionScore
// ------------------------------------------------------------------

test('computeSelectionRisk: boundary values match the renormalized 61.5/38.5 formula', () => {
  assert.strictEqual(computeSelectionRisk(0, 0), 100);
  assert.strictEqual(computeSelectionRisk(1, 1), Math.round(100 - (61.5 + 38.5)));
  assert.strictEqual(computeSelectionRisk(1, 1), 0);
  assert.strictEqual(computeSelectionRisk(1, 0), Math.round(100 - 61.5));
  assert.strictEqual(computeSelectionRisk(0, 1), Math.round(100 - 38.5));
  assert.strictEqual(computeSelectionRisk(0.5, 0.5), Math.round(100 - (30.75 + 19.25)));
});

test('computeSelectionScore: equal length -> no penalty', () => {
  assert.strictEqual(computeSelectionScore(80, 5, 5), 80);
  assert.strictEqual(computeSelectionScore(80, 3.2, 3.2), 80);
});

test('computeSelectionScore: +10% length costs 2 points at default k=0.2', () => {
  const result = computeSelectionScore(80, 5.5, 5); // 5.5/5 = 1.1 -> 10% longer
  assert.ok(Math.abs(result - 78) < 1e-9);
});

test('computeFatalPenalty: 8 points per fatal, capped at 40', () => {
  assert.strictEqual(computeFatalPenalty(0), 0);
  assert.strictEqual(computeFatalPenalty(1), 8);
  assert.strictEqual(computeFatalPenalty(3), 24);
  assert.strictEqual(computeFatalPenalty(5), 40);
  assert.strictEqual(computeFatalPenalty(20), 40); // capped
  assert.strictEqual(computeFatalPenalty(-1), 0);  // garbage in, zero out
});

test('computeOverallGrade: custom selection weights make accident dominate', () => {
  // accident 0 vs 100 with all other bars fixed at 50:
  // GRADE_WEIGHTS   (0.35): swing = 35 points
  // SELECTION_WEIGHTS (0.60): swing = 60 points
  const others = { risk: 50, infrastructure: 50, opinion: 50 };
  const lowSel = computeOverallGrade({ accident: 0, ...others }, true, SELECTION_WEIGHTS).overall;
  const highSel = computeOverallGrade({ accident: 100, ...others }, true, SELECTION_WEIGHTS).overall;
  assert.strictEqual(highSel - lowSel, 60);
  // Renormalization still works with custom weights (opinion excluded):
  const noOpinion = computeOverallGrade({ accident: 100, risk: 0, infrastructure: 0 }, { opinion: false }, SELECTION_WEIGHTS).overall;
  assert.strictEqual(noOpinion, Math.round(100 * (0.60 / 0.90)));
});

test('computeSelectionScore: shorter than shortestKm gets no bonus (penalty floors at 0)', () => {
  // routeKm < shortestKm shouldn't normally happen (shortestKm is the min of
  // the compared set) but must never turn into a positive bonus if it does.
  assert.strictEqual(computeSelectionScore(80, 4, 5), 80);
});

test('computeSelectionScore: custom k scales the penalty', () => {
  // +20% length at k=0.5 -> 0.5*100*0.2 = 10 points off
  const result = computeSelectionScore(90, 6, 5, 0.5);
  assert.ok(Math.abs(result - 80) < 1e-9);
});
