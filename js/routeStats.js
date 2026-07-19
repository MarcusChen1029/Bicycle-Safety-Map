/**
 * Route friendliness stats (pure). Browser global + Node-requirable.
 * Computes the four stats-bar scores (基礎設施 / 交通環境風險 / 歷史事故 / 民眾意見)
 * and the overall 友善等級 (A-E) grade from raw per-step route inputs gathered
 * by routePlanner.js. No Google Maps objects here — keeps this unit-testable
 * in plain Node (see test/routeStats.test.js).
 */

// ------------------------------------------------------------------
// Shared helpers
// ------------------------------------------------------------------

function clamp01(v) {
  if (v == null || isNaN(v)) return 0;
  return Math.min(Math.max(v, 0), 1);
}

// ------------------------------------------------------------------
// 歷史事故 (Accident history)
// ------------------------------------------------------------------

const SEVERITY_WEIGHTS = {
  '死亡': 10,
  '重傷': 5,
  '輕傷': 1,
  '無傷': 0.3
};
const DEFAULT_SEVERITY_WEIGHT = 1; // unrecognized/unknown severity string

function severityWeight(severity) {
  if (Object.prototype.hasOwnProperty.call(SEVERITY_WEIGHTS, severity)) {
    return SEVERITY_WEIGHTS[severity];
  }
  return DEFAULT_SEVERITY_WEIGHT;
}

// Harmonic falloff half-point: a road/route at D = ACCIDENT_D0 weighted
// accidents per km scores 50. Calibrated 2026-07-19 against the real Taipei
// per-road distribution (data/road_stats.json: p50 D≈14 → 68, p90 D≈41 → 42,
// p99 D≈94 → 24) so scores spread instead of collapsing to 0 in the city
// center the way the previous exp(-D/15) curve did. build_road_stats.py must
// use the SAME curve and constant.
const ACCIDENT_D0 = 30;

/**
 * D = (Σ severity weights of accidents near the route) / routeKm.
 * Score = round(100 / (1 + D / ACCIDENT_D0)). No accidents at all → 100
 * regardless of route length.
 * @param {Array<{severity?: string}>} accidents - accidents matched against the route
 * @param {number} routeKm - total route length in km
 * @returns {number} 0-100, higher = safer
 */
function computeAccidentScore(accidents, routeKm) {
  const list = accidents || [];
  if (list.length === 0) return 100;
  const totalWeight = list.reduce((sum, a) => sum + severityWeight(a && a.severity), 0);
  const km = routeKm > 0 ? routeKm : 0.1; // guard divide-by-zero on a degenerate/zero-length route
  const D = totalWeight / km;
  return Math.round(100 / (1 + D / ACCIDENT_D0));
}

// ------------------------------------------------------------------
// 基礎設施 (Infrastructure)
// ------------------------------------------------------------------

/**
 * = round(30 + 45*laneCoverage + 25*youbikeAccess).
 * Out-of-coverage rule: when hasYoubikeCoverage is false (no station within
 * 2km of any route point), the YouBike term is dropped and the lane-coverage
 * weight is renormalized to fill the gap: round(30 + 70*laneCoverage).
 * @param {number} laneCoverage - 0-1, fraction of route length on a bike lane
 * @param {number} youbikeAccess - 0-1, fraction of route length near a YouBike station
 * @param {boolean} hasYoubikeCoverage - false in YouBike-dead areas
 * @returns {number} 0-100
 */
function computeInfrastructureScore(laneCoverage, youbikeAccess, hasYoubikeCoverage = true) {
  const lc = clamp01(laneCoverage);
  if (!hasYoubikeCoverage) {
    return Math.round(30 + 70 * lc);
  }
  const ya = clamp01(youbikeAccess);
  return Math.round(30 + 45 * lc + 25 * ya);
}

// ------------------------------------------------------------------
// 交通環境風險 (Traffic environment risk)
// ------------------------------------------------------------------

// Order matters: more specific suffixes (快速道路/高架) must be tested before
// the generic 路$ / 道$ patterns they would otherwise also match.
const ROAD_CLASS_RULES = [
  { re: /(快速道路|高架)$/, value: 1.0 },
  { re: /大道$/, value: 0.8 },
  { re: /路$/, value: 0.55 },
  { re: /街$/, value: 0.35 },
  { re: /(巷|弄)$/, value: 0.15 }
];
const DEFAULT_CLASS_VALUE = 0.5; // no-name / unrecognized suffix

/**
 * Road-class value (0-1) from a road name's suffix. `name` is whatever
 * parseRoadName() returns (already section-suffix-stripped).
 */
function classValueForRoadName(name) {
  if (!name) return DEFAULT_CLASS_VALUE;
  for (let i = 0; i < ROAD_CLASS_RULES.length; i++) {
    if (ROAD_CLASS_RULES[i].re.test(name)) return ROAD_CLASS_RULES[i].value;
  }
  return DEFAULT_CLASS_VALUE;
}

/**
 * Distance-weighted mean road-class value across the route's steps.
 * @param {Array<{roadName: string|null, distanceM: number}>} steps
 * @returns {number} 0-1
 */
function computeClassIndex(steps) {
  const list = steps || [];
  const totalDist = list.reduce((sum, s) => sum + (s.distanceM || 0), 0);
  if (totalDist <= 0) return DEFAULT_CLASS_VALUE;
  const weighted = list.reduce((sum, s) => sum + classValueForRoadName(s.roadName) * (s.distanceM || 0), 0);
  return weighted / totalDist;
}

/**
 * clamp(maneuverCount / routeKm / 8, 0, 1) — each Google step with a
 * `maneuver` field is treated as ~one junction.
 */
function computeJunctionIndex(maneuverCount, routeKm) {
  const km = routeKm > 0 ? routeKm : 0.1;
  return clamp01((maneuverCount || 0) / km / 8);
}

/**
 * clamp((r - 1) / 0.8, 0, 1), where r = congestion ratio from the parallel
 * DRIVING-mode Directions request (duration_in_traffic / duration).
 */
function computeTrafficIndex(ratio) {
  if (ratio == null || isNaN(ratio)) return 0;
  return clamp01((ratio - 1) / 0.8);
}

/**
 * Time-of-day fallback trafficIdx — used to paint bars immediately (before
 * the parallel driving-mode request resolves) and if that request fails.
 * Weekday 07:00-09:00 & 17:00-19:30 -> 0.7; weekday 09:00-17:00 -> 0.4;
 * all other times (incl. weekends) -> 0.15. Range checks are [start, end).
 * @param {Date} [date] - defaults to now
 */
function trafficIdxFallback(date) {
  const d = date || new Date();
  const day = d.getDay(); // 0=Sun .. 6=Sat
  const isWeekday = day >= 1 && day <= 5;
  if (!isWeekday) return 0.15;

  const minutes = d.getHours() * 60 + d.getMinutes();
  const morningStart = 7 * 60, morningEnd = 9 * 60;
  const eveningStart = 17 * 60, eveningEnd = 19 * 60 + 30;

  if (minutes >= morningStart && minutes < morningEnd) return 0.7;
  if (minutes >= eveningStart && minutes < eveningEnd) return 0.7;
  if (minutes >= morningEnd && minutes < eveningStart) return 0.4;
  return 0.15;
}

/**
 * Score = round(100 - (40*classIdx + 25*junctionIdx + 35*trafficIdx)).
 */
function computeRiskScore(classIdx, junctionIdx, trafficIdx) {
  const score = 100 - (40 * classIdx + 25 * junctionIdx + 35 * trafficIdx);
  return Math.round(score);
}

// ------------------------------------------------------------------
// 民眾意見 (Public opinion) — math unchanged from the old
// RoutePlanner._computePublicOpinionBarScore, centralized here so it's
// covered by the same test suite as the other three bars.
// ------------------------------------------------------------------

/**
 * @param {number} totalScore - sum of per-step road-opinion scores (each 0-1)
 * @param {number} stepCount - number of steps that had road-opinion data
 * @returns {{score:number, hasData:boolean}} score is 0-100; hasData is false
 *   when the route has zero opinion data (score defaults to 70, the B-grade
 *   baseline, but must NOT feed the overall grade in that case).
 */
function computeOpinionScore(totalScore, stepCount) {
  if (!stepCount) {
    return { score: 70, hasData: false };
  }
  const avg = totalScore / stepCount; // 0-1
  return { score: Math.round(avg * 100), hasData: true };
}

// ------------------------------------------------------------------
// 友善等級 (Overall A-E grade)
// ------------------------------------------------------------------

const GRADE_WEIGHTS = { accident: 0.35, risk: 0.30, infrastructure: 0.20, opinion: 0.15 };

/**
 * Grade letter/color thresholds (same as the removed demo updateLevel()):
 * >85 A, >70 B, >55 C, >40 D, else E.
 */
function gradeForScore(score) {
  if (score > 85) return { letter: 'A', color: '#28a745' };
  if (score > 70) return { letter: 'B', color: '#daff07' };
  if (score > 55) return { letter: 'C', color: '#dc8e35' };
  if (score > 40) return { letter: 'D', color: '#ff0000' };
  return { letter: 'E', color: '#000' };
}

/**
 * Weighted mean of the four 0-100 bar scores (weights: 事故 0.35, 風險 0.30,
 * 基礎設施 0.20, 民意 0.15). When the route has zero public-opinion data,
 * `opinionHasData` should be false: the opinion weight is excluded and the
 * remaining three weights are renormalized to sum to 1 (the opinion bar may
 * still separately display its 70-default — that's a UI concern, not this
 * function's).
 * @param {{accident:number, risk:number, infrastructure:number, opinion:number}} scores
 * @param {boolean} [opinionHasData=true]
 * @returns {{overall:number, letter:string, color:string}}
 */
function computeOverallGrade(scores, opinionHasData = true) {
  let weights = Object.assign({}, GRADE_WEIGHTS);
  if (!opinionHasData) {
    const opinionW = weights.opinion;
    delete weights.opinion;
    const remaining = 1 - opinionW;
    Object.keys(weights).forEach(k => { weights[k] = weights[k] / remaining; });
  }

  let overall = 0;
  Object.keys(weights).forEach(k => {
    overall += (scores[k] || 0) * weights[k];
  });

  const grade = gradeForScore(overall);
  return { overall: Math.round(overall), letter: grade.letter, color: grade.color };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    severityWeight,
    computeAccidentScore,
    computeInfrastructureScore,
    classValueForRoadName,
    computeClassIndex,
    computeJunctionIndex,
    computeTrafficIndex,
    trafficIdxFallback,
    computeRiskScore,
    computeOpinionScore,
    computeOverallGrade,
    gradeForScore,
    clamp01
  };
}
