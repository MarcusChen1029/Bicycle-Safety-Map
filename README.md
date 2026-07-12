# Bicycle Safety Map (台北自行車安全地圖)

Static client-side web app: Google Maps + Firebase Firestore. Shows bike lanes,
accident heatmaps, YouBike stations; plans safety-aware routes; collects ride
feedback and road-issue reports (shown as ⚠️ map warnings).

## Run locally
Must be served over http://localhost or HTTPS (Geolocation needs a secure context).

```bash
npx http-server -p 8080
# or use the VS Code "Live Server" extension
```

Open http://localhost:8080.

## Firebase
- Project: `bycyclesafetymap`. Collections: `road_scores` (road-name 0-1 rating, current), `road_stats` (per-road-name accident score, see below), `reports`, `bike_map_opinions` (deprecated, historical data only).
- Deploy security rules: `firebase deploy --only firestore:rules`
  (or paste `firestore.rules` into the Firestore Rules console and Publish).

## Data prep (Python, run manually)
- `transfer.py` — CSV (big5) → `data/accidents.json`
- `dataGain.py` — KML → `data/bike_data.json`
- `inject_low_scores.py` — **dev/testing tool only, mutates the live database.**
  Injects fake low-score feedback into the production Firebase project
  (`bycyclesafetymap` by default) to test route-planner avoidance. Plain
  `python inject_low_scores.py` is a **dry-run** (prints what would be written,
  no network writes). Pass `--apply` to actually write — it prints the target
  project and doc count and requires typing `yes` to confirm (`--yes` skips the
  prompt for scripted use). Use `--project <id>` to target a non-production
  project instead.
- `build_road_stats.py` — computes a per-road-name accident score, the data
  foundation for a future "color every road by score" map feature. For every
  named road (OSM Overpass data, within the bbox of `data/accidents.json`)
  it buckets accidents to the nearest road (within 30m) and computes
  `accidentScore = round(100 * exp(-D / 15))` where `D` is the
  severity-weighted accident count per km — identical math to
  `js/routeStats.js`'s `computeAccidentScore`. Road names are normalized the
  same way as `js/roadName.js` (section suffix like "四段" stripped), so keys
  line up with the existing `road_scores` collection.
  - Plain `python build_road_stats.py` is a **dry-run**: downloads (or reuses
    the cached) OSM road geometry, computes stats, and prints a summary
    (roads found, roads with accidents, top-10 worst). It **always** writes
    `data/road_stats.json` — a static fallback the map-coloring feature can
    read with zero Firestore reads/cost.
  - Pass `--apply` to additionally upload every road doc to the Firestore
    `road_stats` collection (prints target project + doc count, requires
    typing `yes`, or `--yes` to skip the prompt).
  - The raw Overpass response is cached at `data/osm_roads_cache.json`
    (gitignored, re-downloaded automatically if missing/deleted).

See `PROJECT_INDEX.md` for a full file-by-file map.
