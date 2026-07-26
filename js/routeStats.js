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

/**
 * Road-level (single-point, no route) 基礎設施. Same base + weights as
 * computeInfrastructureScore's full-coverage branch, but fed booleans
 * ("is the clicked point near a lane / station?") instead of route-length
 * coverage ratios, since a single click has no route to measure coverage
 * along.
 * = round(30 + 45*(laneNear?1:0) + 25*(stationNear?1:0)).
 * @param {boolean} laneNear - clicked point is within tolerance of a bike lane
 * @param {boolean} stationNear - a YouBike station is within 350m of the point
 * @returns {number} 0-100
 */
function computePointInfraScore(laneNear, stationNear) {
  return Math.round(30 + 45 * (laneNear ? 1 : 0) + 25 * (stationNear ? 1 : 0));
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
 * Road-level (single-click, no Directions request) 交通環境風險. Same idea as
 * computeRiskScore but with no junctionIdx term (a single clicked road has no
 * route of maneuvers to count) — classIdx and trafficIdx are reweighted to
 * fill the gap (60/40 instead of 40/25/35).
 * Score = round(100 - (60*classIdx + 40*trafficIdx)).
 * @param {number} classIdx - 0-1, from classValueForRoadName(name)
 * @param {number} trafficIdx - 0-1, from trafficIdxFallback(date)
 * @returns {number} 0-100
 */
function computeRoadRiskScore(classIdx, trafficIdx) {
  const score = 100 - (60 * classIdx + 40 * trafficIdx);
  return Math.round(score);
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
 * Grade letter/color thresholds: >72 A, >60 B, >48 C, >36 D, else E.
 *
 * Calibrated 2026-07-26 against the real Taipei distribution (all 7,134 roads
 * in data/road_stats.json, evaluated at the typical click scenario: no bike
 * lane, YouBike station within 350 m, daytime traffic). The inherited demo
 * thresholds (>85/>70/>55/>40) assumed component scores centred near 80, but
 * 交通環境風險 and 基礎設施 sit near 51 and 55 for ordinary city streets, so
 * A was mathematically unreachable and every major road collapsed to C/D.
 * Under these thresholds major roads spread B 71% / C 24% / D 5%, quiet
 * alleys with no accident history reach A, and a major road earns A only
 * when it actually has a bike lane (or is ridden off-peak).
 */
function gradeForScore(score) {
  if (score > 72) return { letter: 'A', color: '#28a745' };
  if (score > 60) return { letter: 'B', color: '#daff07' };
  if (score > 48) return { letter: 'C', color: '#dc8e35' };
  if (score > 36) return { letter: 'D', color: '#ff0000' };
  return { letter: 'E', color: '#000' };
}

/**
 * Weighted mean of the four 0-100 bar scores (weights: 事故 0.35, 風險 0.30,
 * 基礎設施 0.20, 民意 0.15). Any component that is missing data has its weight
 * excluded and the remaining weights renormalized to sum to 1 (an excluded
 * bar may still separately display a placeholder score — that's a UI
 * concern, not this function's).
 *
 * `availability` accepts two forms:
 *   - boolean (legacy, route flow): shorthand for opinion-only availability,
 *     i.e. `computeOverallGrade(scores, false)` === opinion missing, all
 *     other components assumed present. Preserved for backward compatibility
 *     with existing call sites and tests.
 *   - object (road-level click flow, where accident data can ALSO be
 *     missing): `{accident?, risk?, infrastructure?, opinion?}`, each
 *     defaulting to true (present) when omitted. Any key explicitly `false`
 *     is excluded and its weight redistributed.
 * @param {{accident:number, risk:number, infrastructure:number, opinion:number}} scores
 * @param {boolean|{accident?:boolean, risk?:boolean, infrastructure?:boolean, opinion?:boolean}} [availability=true]
 * @returns {{overall:number, letter:string, color:string}}
 */
function computeOverallGrade(scores, availability = true, baseWeights = GRADE_WEIGHTS) {
  // Backward-compatible shorthand: a boolean means "opinionHasData".
  const avail = (typeof availability === 'boolean') ? { opinion: availability } : (availability || {});

  let weights = Object.assign({}, baseWeights);
  let excludedWeight = 0;
  Object.keys(baseWeights).forEach(k => {
    if (avail[k] === false) {
      excludedWeight += weights[k];
      delete weights[k];
    }
  });

  if (excludedWeight > 0) {
    const remaining = 1 - excludedWeight;
    Object.keys(weights).forEach(k => { weights[k] = weights[k] / remaining; });
  }

  let overall = 0;
  Object.keys(weights).forEach(k => {
    overall += (scores[k] || 0) * weights[k];
  });

  const grade = gradeForScore(overall);
  return { overall: Math.round(overall), letter: grade.letter, color: grade.color };
}

// ------------------------------------------------------------------
// 路線選擇 (Route SELECTION score) — used only by routePlanner's
// candidate-vs-candidate comparison during route selection; never painted
// to the UI. Traffic is deliberately excluded from the risk term here: the
// parallel DRIVING-mode traffic probe is a single shared value for the
// whole O/D pair, so it's (near-)identical across every candidate between
// the same origin/destination and cannot help differentiate them — it
// stays a display-only refinement of computeRiskScore.
// ------------------------------------------------------------------

/**
 * Route risk WITHOUT the traffic term — the 40/25 (class/junction) pair
 * from computeRiskScore, renormalized to sum to 100 once the 35-weight
 * traffic term is dropped: 40/65*100 = 61.5, 25/65*100 = 38.5.
 * Score = round(100 - (61.5*classIdx + 38.5*junctionIdx)).
 * @param {number} classIdx - 0-1, from computeClassIndex
 * @param {number} junctionIdx - 0-1, from computeJunctionIndex
 * @returns {number} 0-100, higher = safer
 */
function computeSelectionRisk(classIdx, junctionIdx) {
  const score = 100 - (61.5 * classIdx + 38.5 * junctionIdx);
  return Math.round(score);
}

/**
 * Length-penalized score for comparing candidate routes for the same trip.
 * = overall - k*100*max(routeKm/shortestKm - 1, 0)
 * A candidate exactly at the shortest length pays no penalty; a candidate
 * 10% longer than the shortest candidate loses k*100*0.1 points (4 points
 * at the default k=0.4). A candidate SHORTER than shortestKm (shouldn't
 * normally happen since shortestKm is the min over the compared set, but
 * can if a different globalShortestKm is passed in) gets no bonus either —
 * the max(...,0) floors the penalty at zero.
 * @param {number} overall - 0-100 overall friendliness score for this candidate
 * @param {number} routeKm - this candidate's length in km
 * @param {number} shortestKm - the shortest candidate's length in km, among
 *   the routes being compared in this selection round
 * @param {number} [k=0.2] - penalty steepness
 * @returns {number} the length-penalized selection score (not clamped to 0-100)
 */
function computeSelectionScore(overall, routeKm, shortestKm, k = 0.2) {
  const shortest = shortestKm > 0 ? shortestKm : (routeKm > 0 ? routeKm : 0.1);
  const detourRatio = Math.max(routeKm / shortest - 1, 0);
  return overall - k * 100 * detourRatio;
}

// Selection-only component weights: accident avoidance dominates route
// CHOICE (0.60 vs the display grade's 0.35) because "route around the
// accident hotspots" is the product's core promise; risk/infra/opinion
// barely differ between urban candidates and would otherwise dilute it.
// The DISPLAY grade keeps GRADE_WEIGHTS — what we show and what we optimize
// are allowed to weight differently.
const SELECTION_WEIGHTS = { accident: 0.60, risk: 0.20, infrastructure: 0.10, opinion: 0.10 };

/**
 * Extra selection penalty that makes FATAL-accident sites (the blue
 * heatmap dots — the heatmap renders 死亡 only) actively repel routes:
 * −8 points per fatal accident matched along the route, capped at −40.
 * Fatals already weigh 10× inside computeAccidentScore; this term is a
 * deliberate second, targeted repellent so a corridor's flood of light
 * injuries can never mask a fatal hotspot.
 * @param {number} fatalCount - deduped 死亡 accidents matched to the route
 * @returns {number} penalty >= 0 (subtract from the selection score)
 */
function computeFatalPenalty(fatalCount) {
  const n = fatalCount > 0 ? fatalCount : 0;
  return Math.min(8 * n, 40);
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
    computeRoadRiskScore,
    computePointInfraScore,
    computeOpinionScore,
    computeOverallGrade,
    gradeForScore,
    computeSelectionRisk,
    computeSelectionScore,
    computeFatalPenalty,
    SELECTION_WEIGHTS,
    clamp01
  };
}
