"""
Offline pipeline: per-road-name accident score, computed from data/accidents.json
and OpenStreetMap road geometry (Overpass API).

Output:
  - data/road_stats.json   ALWAYS written (dry-run or --apply). Static fallback
    the map-coloring feature can read with zero Firestore reads.
  - Firestore collection `road_stats` (doc id = road name, '/' -> '_', same
    convention as js/roadScoreDB.js) — ONLY written with --apply.

Scoring math mirrors js/routeStats.js (computeAccidentScore) exactly:
  severity weights: 死亡=10, 重傷=5, 輕傷=1, 無傷=0.3, unknown=1
  D = weightedCount / roadKm
  accidentScore = round(100 * exp(-D / 15))

Road-name normalization mirrors js/roadName.js normalizeRoadName(): the
trailing section suffix ("N段") is stripped so this collection's keys line
up with js/roadScoreDB.js's road_scores keys (both ultimately keyed by the
same "one road name = one score" convention the app already uses). Without
this, road_stats would be keyed by raw OSM section names (e.g. "忠孝東路四段")
which nothing else in the app produces.

Safety pattern (same as inject_low_scores.py): DRY-RUN by default. Only
--apply + typed "yes" (or --yes) writes to Firestore. --project overrides
the target project (default: bycyclesafetymap).
"""

import argparse
import json
import math
import os
import re
import sys
import time
from datetime import datetime, timezone

import requests

# Windows console default codepage (cp950) can't print emoji/CJK reliably.
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# ---------------------------------------------------------------------------
# Config (must match js/firebaseConfig.js / inject_low_scores.py)
# ---------------------------------------------------------------------------
DEFAULT_PROJECT_ID = "bycyclesafetymap"
API_KEY = "AIzaSyCe3E6azBZ2NGXTnROpt1gsUKUtKuq6L1Q"

ACCIDENTS_PATH = os.path.join("data", "accidents.json")
CACHE_PATH = os.path.join("data", "osm_roads_cache.json")
OUTPUT_PATH = os.path.join("data", "road_stats.json")

OVERPASS_PRIMARY = "https://overpass-api.de/api/interpreter"
OVERPASS_MIRROR = "https://overpass.kumi.systems/api/interpreter"

HIGHWAY_CLASSES = [
    "motorway", "trunk", "primary", "secondary", "tertiary",
    "unclassified", "residential", "living_street",
]

BBOX_MARGIN_DEG = 0.02
MATCH_THRESHOLD_M = 30.0
GRID_CELL_DEG = 0.001  # ~100-110m at Taipei's latitude; > match threshold so a
                        # 3x3 neighbor search around a point's own cell always
                        # covers the full 30m radius.

EARTH_RADIUS_M = 6371000.0

# Severity weights — identical to js/routeStats.js SEVERITY_WEIGHTS.
SEVERITY_WEIGHTS = {
    "死亡": 10,
    "重傷": 5,
    "輕傷": 1,
    "無傷": 0.3,
}
DEFAULT_SEVERITY_WEIGHT = 1  # unrecognized/unknown severity string (e.g. "不明")

# Mirrors js/roadName.js normalizeRoadName(): strip a trailing section suffix
# ("一段".."十段", "1段".."99段", ...) so road_stats keys align with the app's
# existing road-name convention (road_scores / parseRoadName).
SECTION_SUFFIX_RE = re.compile(r"[一二三四五六七八九十0-9]+段$")


def severity_weight(severity):
    return SEVERITY_WEIGHTS.get(severity, DEFAULT_SEVERITY_WEIGHT)


def normalize_road_name(name):
    if not name:
        return ""
    n = re.sub(r"\s+", "", str(name)).strip()
    n = SECTION_SUFFIX_RE.sub("", n)
    return n


def doc_id_for(road_name):
    """Firestore doc IDs cannot contain '/'. Same convention as js/roadScoreDB.js."""
    return str(road_name).replace("/", "_")


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------
def haversine_m(lat1, lng1, lat2, lng2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(min(1.0, a)))


def project(lat, lng, lat0_rad, cos_lat0):
    """Small-area equirectangular projection to local meters. Good enough for
    a metro-area bbox; used only for the cheap point-to-segment distance
    check, not for the authoritative road-length totals (those use haversine)."""
    x = math.radians(lng) * EARTH_RADIUS_M * cos_lat0
    y = math.radians(lat) * EARTH_RADIUS_M
    return x, y


def point_segment_dist_m(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    cx, cy = ax + t * dx, ay + t * dy
    return math.hypot(px - cx, py - cy)


def grid_cell(lat, lng):
    return (int(math.floor(lat / GRID_CELL_DEG)), int(math.floor(lng / GRID_CELL_DEG)))


# ---------------------------------------------------------------------------
# Step 1: accidents + bbox
# ---------------------------------------------------------------------------
def load_accidents(path=ACCIDENTS_PATH):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def compute_bbox(accidents, margin=BBOX_MARGIN_DEG):
    lats = [a["lat"] for a in accidents]
    lngs = [a["lng"] for a in accidents]
    south, north = min(lats) - margin, max(lats) + margin
    west, east = min(lngs) - margin, max(lngs) + margin
    return south, west, north, east


# ---------------------------------------------------------------------------
# Step 2: OSM roads via Overpass (cached)
# ---------------------------------------------------------------------------
def build_overpass_query(bbox):
    south, west, north, east = bbox
    highway_pattern = "^(" + "|".join(HIGHWAY_CLASSES) + ")$"
    return (
        f"[out:json][timeout:180];\n"
        f"way({south},{west},{north},{east})"
        f'[highway~"{highway_pattern}"][name];\n'
        f"out geom;"
    )


def fetch_overpass(query, attempts=3, sleep_s=5):
    urls = [OVERPASS_PRIMARY, OVERPASS_MIRROR]
    last_err = None
    for url in urls:
        for i in range(attempts):
            try:
                print(f"Querying Overpass ({url}), attempt {i + 1}/{attempts}...")
                r = requests.post(
                    url,
                    data={"data": query},
                    timeout=240,
                    headers={"User-Agent": "road-stats-pipeline/1.0 (bycyclesafetymap)"},
                )
                if r.status_code == 200:
                    return r.json()
                print(f"  HTTP {r.status_code}: {r.text[:200]}")
                last_err = f"HTTP {r.status_code}"
            except Exception as e:
                print(f"  error: {e}")
                last_err = str(e)
            time.sleep(sleep_s)
        print(f"Giving up on {url}, trying next mirror if any...")
    raise RuntimeError(f"Overpass query failed on all endpoints: {last_err}")


def get_osm_roads(bbox, cache_path=CACHE_PATH, force_refresh=False):
    if os.path.exists(cache_path) and not force_refresh:
        print(f"Reusing cached OSM data: {cache_path}")
        with open(cache_path, encoding="utf-8") as f:
            return json.load(f)

    query = build_overpass_query(bbox)
    data = fetch_overpass(query)
    os.makedirs(os.path.dirname(cache_path), exist_ok=True)
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(data, f)
    print(f"Cached raw Overpass response to {cache_path}")
    return data


def parse_roads(osm_json):
    """Returns:
      roads: dict normalized_name -> {"km": float, "raw_names": set}
      segments: list of (ax, ay, bx, by, road_name)  [projected meters, filled in later]
      raw_segments: list of (alat, alng, blat, blng, road_name)  [for projection + length]
    """
    roads_km = {}
    raw_names_by_road = {}
    raw_segments = []

    for el in osm_json.get("elements", []):
        if el.get("type") != "way":
            continue
        tags = el.get("tags", {})
        raw_name = tags.get("name")
        if not raw_name:
            continue
        road_name = normalize_road_name(raw_name)
        if not road_name:
            continue
        geometry = el.get("geometry") or []
        if len(geometry) < 2:
            continue

        raw_names_by_road.setdefault(road_name, set()).add(raw_name)

        way_km = 0.0
        for i in range(len(geometry) - 1):
            p1, p2 = geometry[i], geometry[i + 1]
            if p1 is None or p2 is None:
                continue  # Overpass can emit null nodes for missing geometry
            seg_len_m = haversine_m(p1["lat"], p1["lon"], p2["lat"], p2["lon"])
            way_km += seg_len_m / 1000.0
            raw_segments.append((p1["lat"], p1["lon"], p2["lat"], p2["lon"], road_name))

        roads_km[road_name] = roads_km.get(road_name, 0.0) + way_km

    return roads_km, raw_names_by_road, raw_segments


# ---------------------------------------------------------------------------
# Step 3: bucket accidents to nearest road segment within 30m
# ---------------------------------------------------------------------------
def build_grid_index(raw_segments, lat0_rad, cos_lat0):
    """Projects segment endpoints to meters and indexes each segment into the
    grid cells of both its (lat/lng-space) endpoints."""
    projected = []
    grid = {}
    for idx, (alat, alng, blat, blng, road_name) in enumerate(raw_segments):
        ax, ay = project(alat, alng, lat0_rad, cos_lat0)
        bx, by = project(blat, blng, lat0_rad, cos_lat0)
        projected.append((ax, ay, bx, by, road_name))
        for (lat, lng) in ((alat, alng), (blat, blng)):
            cell = grid_cell(lat, lng)
            grid.setdefault(cell, []).append(idx)
    # de-dup segment indices per cell (endpoints can land in the same cell)
    for cell, idxs in grid.items():
        grid[cell] = list(set(idxs))
    return projected, grid


def match_accidents(accidents, projected, grid, lat0_rad, cos_lat0, threshold_m=MATCH_THRESHOLD_M):
    counts = {}
    weighted = {}
    matched = 0
    for a in accidents:
        lat, lng, severity = a["lat"], a["lng"], a.get("severity")
        px, py = project(lat, lng, lat0_rad, cos_lat0)
        gx, gy = grid_cell(lat, lng)

        best_dist = None
        best_road = None
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for seg_idx in grid.get((gx + dx, gy + dy), ()):
                    ax, ay, bx, by, road_name = projected[seg_idx]
                    d = point_segment_dist_m(px, py, ax, ay, bx, by)
                    if best_dist is None or d < best_dist:
                        best_dist = d
                        best_road = road_name

        if best_dist is not None and best_dist <= threshold_m:
            matched += 1
            counts[best_road] = counts.get(best_road, 0) + 1
            weighted[best_road] = weighted.get(best_road, 0.0) + severity_weight(severity)

    return counts, weighted, matched


# ---------------------------------------------------------------------------
# Step 4: per-road accidentScore
# ---------------------------------------------------------------------------
def compute_road_stats(roads_km, counts, weighted):
    now_iso = datetime.now(timezone.utc).isoformat()
    stats = {}
    for road_name, km in roads_km.items():
        count = counts.get(road_name, 0)
        wcount = weighted.get(road_name, 0.0)
        km_guard = km if km > 0 else 0.1  # guard divide-by-zero, mirrors js/routeStats.js
        d = wcount / km_guard
        score = round(100 * math.exp(-d / 15))
        stats[road_name] = {
            "roadName": road_name,
            "accidentCount": count,
            "weightedCount": round(wcount, 4),
            "roadKm": round(km, 4),
            "accidentScore": score,
            "updatedAt": now_iso,
        }
    return stats


# ---------------------------------------------------------------------------
# Step 5: output
# ---------------------------------------------------------------------------
def write_output(stats, path=OUTPUT_PATH):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "roadCount": len(stats),
        "roads": stats,
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    return path


def print_summary(stats, total_accidents, matched_accidents):
    roads_with_accidents = [s for s in stats.values() if s["accidentCount"] > 0]
    print()
    print("=" * 60)
    print("DRY-RUN SUMMARY")
    print("=" * 60)
    print(f"Roads found (named, in accident bbox): {len(stats)}")
    print(f"Roads with >= 1 matched accident:       {len(roads_with_accidents)}")
    pct = (matched_accidents / total_accidents * 100) if total_accidents else 0
    print(f"Accidents matched to a road (<= {MATCH_THRESHOLD_M:.0f}m): "
          f"{matched_accidents} / {total_accidents} ({pct:.1f}%)")
    print()
    print("Top 10 worst roads (lowest accidentScore, >=1 accident):")
    worst = sorted(
        roads_with_accidents,
        key=lambda s: (s["accidentScore"], -s["accidentCount"]),
    )[:10]
    for s in worst:
        print(
            f"  {s['roadName']:<12}  score={s['accidentScore']:>3}  "
            f"accidents={s['accidentCount']:>4}  weighted={s['weightedCount']:>7.2f}  "
            f"roadKm={s['roadKm']:>7.3f}"
        )
    print("=" * 60)


# ---------------------------------------------------------------------------
# Step 6: Firestore upload (--apply only)
# ---------------------------------------------------------------------------
def to_firestore_fields(stat):
    return {
        "fields": {
            "roadName": {"stringValue": stat["roadName"]},
            "accidentCount": {"integerValue": str(stat["accidentCount"])},
            "weightedCount": {"doubleValue": stat["weightedCount"]},
            "roadKm": {"doubleValue": stat["roadKm"]},
            "accidentScore": {"integerValue": str(stat["accidentScore"])},
            "updatedAt": {"stringValue": stat["updatedAt"]},
        }
    }


def upload_to_firestore(stats, project_id, skip_confirm=False, batch_size=400):
    docs = list(stats.values())
    print()
    print(f"Target project: {project_id}")
    print(f"Firestore collection: road_stats")
    print(f"Documents to write: {len(docs)}")

    if not skip_confirm:
        answer = input(
            f'Really write {len(docs)} docs to project "{project_id}"? Type yes to continue: '
        )
        if answer.strip().lower() != "yes":
            print("Cancelled. Nothing was written.")
            return

    base_url = (
        f"https://firestore.googleapis.com/v1/projects/{project_id}"
        f"/databases/(default)/documents:batchWrite"
    )

    success = 0
    fail = 0
    for i in range(0, len(docs), batch_size):
        chunk = docs[i:i + batch_size]
        writes = []
        for stat in chunk:
            doc_id = doc_id_for(stat["roadName"])
            name = (
                f"projects/{project_id}/databases/(default)/documents/"
                f"road_stats/{doc_id}"
            )
            body = to_firestore_fields(stat)
            body["name"] = name
            writes.append({"update": body})

        try:
            resp = requests.post(
                f"{base_url}?key={API_KEY}",
                json={"writes": writes},
                headers={"Content-Type": "application/json"},
                timeout=60,
            )
            if resp.status_code == 200:
                success += len(chunk)
                print(f"  batch {i // batch_size + 1}: wrote {len(chunk)} docs (OK)")
            else:
                fail += len(chunk)
                print(f"  batch {i // batch_size + 1}: HTTP {resp.status_code}: {resp.text[:200]}")
        except Exception as e:
            fail += len(chunk)
            print(f"  batch {i // batch_size + 1}: error {e}")
        time.sleep(0.5)

    print()
    print(f"Done. {success} docs written, {fail} failed.")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description=(
            "Compute per-road-name accident scores from data/accidents.json + OSM "
            "roads and (optionally) upload to Firestore road_stats. Dry-run by "
            "default: computes and writes data/road_stats.json only."
        )
    )
    parser.add_argument("--project", default=DEFAULT_PROJECT_ID,
                         help=f"Target Firebase project id (default: {DEFAULT_PROJECT_ID})")
    parser.add_argument("--apply", action="store_true",
                         help="Actually upload to Firestore. Without this flag: dry-run only.")
    parser.add_argument("--yes", action="store_true",
                         help="Used with --apply: skip the interactive yes/no confirmation.")
    parser.add_argument("--refresh-cache", action="store_true",
                         help="Ignore data/osm_roads_cache.json and re-download from Overpass.")
    parser.add_argument("--accidents", default=ACCIDENTS_PATH, help=argparse.SUPPRESS)
    parser.add_argument("--cache", default=CACHE_PATH, help=argparse.SUPPRESS)
    parser.add_argument("--output", default=OUTPUT_PATH, help=argparse.SUPPRESS)
    args = parser.parse_args()

    if args.yes and not args.apply:
        print("Error: --yes requires --apply.", file=sys.stderr)
        sys.exit(1)

    t0 = time.time()

    print(f"Loading accidents from {args.accidents}...")
    accidents = load_accidents(args.accidents)
    print(f"  {len(accidents)} accident records loaded")

    bbox = compute_bbox(accidents)
    print(f"Bounding box (+{BBOX_MARGIN_DEG} deg margin): south={bbox[0]:.5f} "
          f"west={bbox[1]:.5f} north={bbox[2]:.5f} east={bbox[3]:.5f}")

    osm_json = get_osm_roads(bbox, cache_path=args.cache, force_refresh=args.refresh_cache)
    roads_km, raw_names_by_road, raw_segments = parse_roads(osm_json)
    print(f"  {len(osm_json.get('elements', []))} named ways -> "
          f"{len(roads_km)} logical roads (section-suffix-normalized) -> "
          f"{len(raw_segments)} segments")

    mean_lat = sum(a["lat"] for a in accidents) / len(accidents)
    lat0_rad = math.radians(mean_lat)
    cos_lat0 = math.cos(lat0_rad)

    print("Building spatial grid index...")
    projected, grid = build_grid_index(raw_segments, lat0_rad, cos_lat0)

    print(f"Matching {len(accidents)} accidents to nearest road "
          f"(<= {MATCH_THRESHOLD_M:.0f}m)...")
    counts, weighted, matched = match_accidents(accidents, projected, grid, lat0_rad, cos_lat0)

    stats = compute_road_stats(roads_km, counts, weighted)
    out_path = write_output(stats, path=args.output)
    print(f"Wrote {out_path}")

    print_summary(stats, total_accidents=len(accidents), matched_accidents=matched)
    print(f"Elapsed: {time.time() - t0:.1f}s")

    if args.apply:
        upload_to_firestore(stats, project_id=args.project, skip_confirm=args.yes)
    else:
        print()
        print("This was a DRY-RUN (no Firestore writes). Pass --apply to upload "
              "(requires typing yes, or --yes to skip the prompt).")


if __name__ == "__main__":
    main()
