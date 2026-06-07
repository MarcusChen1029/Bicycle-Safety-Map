# PROJECT INDEX — Bicycle Safety Map (台北自行車安全地圖)

> Reference map of every file so work can start without re-reading the whole repo.
> Keep this updated when files are added/moved or responsibilities change.

## What this is
A **client-side (no build step) web app** for Taipei cyclists. Google Maps shows bike
lanes, accident heatmaps, and YouBike stations; users plan safety-aware bike routes,
get in-app turn-by-turn navigation, submit road-issue reports, and rate routes.
Crowd feedback + accident data feed a route safety scorer. Persistence is **Firebase
Firestore** (with localStorage fallback). UI text is Traditional Chinese.

- **Stack:** vanilla JS (global classes, no modules/bundler), Google Maps JS API v3.64, Firebase compat SDK 12.12.0.
- **Run it:** must be served over `http://localhost` or HTTPS (Geolocation requires a secure context) — use Live Server / `http-server`. Opening `index.html` via `file://` breaks GPS.
- **Load order matters:** all JS files are plain `<script>` globals; order is fixed in `index.html`.

## External services / keys (all client-side, public)
- **Google Maps API key:** `AIzaSyB6COopYm0cbtzicd_o3CsCjNSS0AUnJiA` — in `index.html` script src (libs: visualization, geometry; callback `initMapApp`).
- **Firebase project:** `bycyclesafetymap` (in `js/firebaseConfig.js`). Collections: `bike_map_opinions` (ride feedback), `reports` (issue reports — docs include numeric `lat`/`lng`, rendered as live ⚠️ markers by `ReportLayer`).
- **YouBike live feed:** `https://tcgbusfs.blob.core.windows.net/dotapp/youbike/v2/youbike_immediate.json`.
- ⚠️ Firestore needs open security rules or reads/writes 403. Rules live in `firestore.rules`; deploy via Firebase Console or `firebase deploy --only firestore:rules`.

---

## JS source — `js/` (load order = the order below)

### `js/firebaseConfig.js` (195 lines) — Firebase init + feedback DAO
- Initializes Firebase, exposes globals **`db`** (Firestore) and **`feedbackDB`**.
- Class **`FeedbackDB`** → collection `bike_map_opinions`, with 30s in-memory cache:
  - `saveFeedback(data)` — adds doc + serverTimestamp; on failure falls back to localStorage.
  - `getAllFeedback()` — cached read, ordered by `createdAt desc`; localStorage fallback.
  - `getFeedbackForSteps(stepPoints)` — haversine match within 50 m.
  - `_saveToLocalStorage` / `_loadFromLocalStorage` / `syncOfflineEntries()` (runs on load).
- Note: `db` is also used directly in `script.js` for the `reports` collection.

### `js/config.js` (73 lines) — `CONFIG` global constants
Map center (Taipei 25.033,121.5654)/zoom/styles, accident heatmap gradient + marker icon,
bike-lane colors by type, directions defaults (BICYCLING), TWD97↔WGS84 proj4 strings.

### `js/main.js` (724 lines) — `BikeMapApp`, the app orchestrator
- `window.initMapApp` (Maps callback) → `new BikeMapApp().init()`.
- `init()` builds map + all layers + `RoutePlanner`, sets `window._routePlannerRef`, binds events, starts GPS.
- `bindEvents()` — wires plan/clear route, start/end navigation, **GPS spoofer** (WASD + virtual joystick, fake `handlePositionUpdate`), swap start/end, layer toggles, map-click→set destination, "use my location", report-page real-GPS button (overrides script.js mock).
- **GPS tracking:** `startLocationTracking()` (getCurrentPosition→watchPosition, high→low accuracy fallback), `handlePositionUpdate()`, `_updateUserMarker()` (blue dot + accuracy circle).
- **In-app navigation:** `_updateNavBanner()`, `_checkNavProgress()` (advances steps by distance-to-turn), `_checkRouteDeviation()` (>300 m), `_handleReroute()`.
- Holds `currentPosition`, `isNavigating`, `currentNavStepIndex`, `isSpooferActive`.

### `js/map_init.js` (63 lines) — `MapInitializer`
Thin wrapper: `init()` creates `google.maps.Map` (UI chrome disabled), plus `getMap/setCenter/setZoom/fitBounds`.

### `js/bikeLane.js` (175 lines) — `BikeLaneLayer`
Loads `data/bike_data.json` (GeoJSON FeatureCollection), parses LineString/MultiLineString
(also legacy + TWD97 via proj4), draws colored polylines w/ click InfoWindows. `toggle()`,
color by type (專用/共用/normal). `polylines[]` is read by the route scorer.

### `js/accidentLayer.js` (106 lines) — `AccidentLayer`
Loads `data/accidents.json` (`[{lat,lng,severity,...}]`), `parseAccidentData()` keeps only
`{position, severity}`. `createHeatmap()` downsamples to 死亡 + every-10th 重傷 for perf,
weights 死亡=50/重傷=10. `data[]` is read by the route scorer.

### `js/reportLayer.js` — `ReportLayer` (live road-issue warnings)
Shows user-submitted reports as ⚠️ markers. `listen()` attaches a Firestore `onSnapshot`
listener on the `reports` collection → loads all existing reports on startup (persistent,
everyone) and adds/moves/removes markers live as reports change. `markers` is a Map keyed by
doc id; docs without numeric `lat`/`lng` are skipped. Click → shared InfoWindow with type
label (`TYPE_LABELS` code→Chinese), description, place, date. `toggle()` for visibility.
Depends on global `db` + Google Maps. Instantiated in `main.js init()`.

### `js/youbikeLayer.js` (192 lines) — `YoubikeLayer`
Fetches live YouBike JSON. Renders markers only near map center (1 km) or, when a route is
set via `setRoutePath()`, the nearest 3 stations within 300 m of start & end. Debounced on
map `idle`. Marker color by availability. `toggle()`, InfoWindow with rent/return counts.
`findNearestStation(latLng, type)` (`'rent'`/`'return'`/`'any'`) → nearest station, optionally
filtered by availability; used by RoutePlanner's YouBike mode.

### `js/routePlanner.js` (734 lines) — `RoutePlanner` (route brain)
- Uses Google DirectionsService (BICYCLING, alternatives). `planRoute(origin, dest)`.
- **Favorites** (localStorage `bike_map_favorites`): add/delete/render/use.
- **Safety scoring** (when "避開危險區域" checked):
  - `analyzeRoutes()` filters routes ≤1.5× shortest, picks max score.
  - `calculateRouteScore()` per step: +1 shortest, +1 bike lane, −accidents/15 (dangerous if >30/km or >15), and **public-opinion penalty** from `_opinionsCache` (Firebase): `W=(3−avg)*log2(n+1)` capped 3×, extra −2 "hidden danger zone" if avg<2.5.
  - If best route has dangerous steps → tries perpendicular detour waypoints (±500/±1000 m) and keeps the best.
  - Safe route drawn bright green; default blue otherwise.
- `setDestination(latLng)` reverse-geocodes into end-point input.
- `clearRoute()` → triggers `showFeedbackModal()` if a route existed.
- `saveFeedbackToFirebase(safety, smoothness)` → builds step/overview points → `feedbackDB.saveFeedback` → reloads cache. Stores `lastRoute` for feedback/nav.
- `_loadOpinionsCache()` preloads `feedbackDB.getAllFeedback()`.
- **YouBike mode** (`youbikeRouteMode`, toggled by the map's 🚲 單車模式 button): when on, `planRoute` calls `_snapToYoubikeStations()` → `_resolveToLatLng()` (parse `"lat,lng"` or geocode) → `youbikeLayer.findNearestStation` for start (rentable) & end (open docks), and routes station→station. Falls back to a normal route + alert if data missing / no station.

### `js/script.js` (438 lines) — UI: stats bars, tabs, report form, feedback modal
- `updateStats()` / `updateLevel()` — progress bars + A–E grade in `.details` panel.
- `DOMContentLoaded`: seeds sample stats; **tab switching** (Map/Route/Report nav-items↔view-panes); **report submit** → resolves location via `resolveReportLocation()` (parse `"lat,lng"` or geocode) then `db.collection('reports').add({...lat, lng})`; blocks submit if location can't be resolved; mock get-location (later overridden by main.js).
- `resolveReportLocation(text)` — top-level helper: parses `"lat, lng"` or geocodes an address → `{lat, lng, address?}`; throws if unresolvable.
- **Feedback modal logic:** `showFeedbackModal/hideFeedbackModal`, star rating state `_feedbackRatings`, `_setStars`, `updatePublicOpinionStat()` (updates 4th stats bar 民眾意見), `showFeedbackToast()`. Submit button calls `saveFeedbackToFirebase` via `_routePlannerRef` (3-tier fallback to `feedbackDB.saveFeedback`).
- ⚠️ Contains a stale unused `initMap()` and a mock get-location handler that main.js replaces.

---

## Frontend shell
- **`index.html`** (324 lines) — single page. Loads Firebase compat SDK (app + firestore) in `<head>`; body has search bar, 3 view-panes (Map / Route / Report), map controls (spoofer/YouBike-layer/單車模式/bike-lane toggles), virtual joystick, nav banner, start-nav button, feedback modal, bottom nav-bar. Script load order at bottom: firebaseConfig → config → script → main → map_init → bikeLane → accidentLayer → youbikeLayer → reportLayer → routePlanner, then Google Maps (async, callback `initMapApp`).
- **`css/style.css`** (895 lines) — all styling (container, panes, details panel, stats bars, joystick, nav banner, feedback modal/toast, favorites).

## Data files — `data/`
- **`accidents.json`** (~7.9 MB) — `[{lat,lng,severity,date,location,description}]`; consumed by AccidentLayer. severity values: 死亡/輕傷/無傷/不明.
- **`bike_data.json`** (~11.9 MB) — GeoJSON FeatureCollection of bike lanes (Chinese property keys); consumed by BikeLaneLayer.
- **`bike_data_organized.json`** (~11.4 MB) — same data, English property keys (county/township/start/end…). **Not currently loaded** by the app.
- **`output.json`** (~9.9 MB) — intermediate accident dump (Chinese keys, x/y座標). Not loaded by app.

## Python utilities (data prep / testing — run manually, not part of the web app)
- **`transfer.py`** — `data.csv` (big5) → `data/accidents.json`. Filters vehicle types C/F/H, maps 受傷程度→severity, ROC year→AD date.
- **`dataGain.py`** — KML (`台灣本島自行車道.kml`) → `bike_data.json` GeoJSON.
- **`check_fatal.py`** — counts severities in accidents.json → `fatal_count.txt`.
- **`check_headers.py`** — prints `data.csv` header row.
- **`inject_low_scores.py`** — test tool: injects 30 low-score feedback docs onto 忠孝東路 via Firestore REST to verify route avoidance. ⚠️ **Still points at the OLD project `mapcomment-8f128` + old API key** — out of sync with the app's `bycyclesafetymap`.

## Raw source data (repo root)
- `data.csv`, `bike_stop.csv` — source CSVs. `台灣本島自行車道.kml` / `_organized.kml` — bike-lane KML. `事故標誌.pdf` — reference doc. `headers.txt`, `fatal_count.txt` — generated text.

## Firebase config files (repo root, untracked)
- `firestore.rules` — open read/write rules for `bike_map_opinions` + `reports`.
- `firebase.json` — points Firestore rules at `firestore.rules`.
- `.firebaserc` — default project `bycyclesafetymap`.

---

## Gotchas / things to remember
- No build/test framework — it's static files served directly; "tests" are manual browser checks (and the Python inject script).
- Two write paths to Firestore: feedback via `feedbackDB` (`bike_map_opinions`), reports via raw `db` (`reports`).
- `feedbackDB` and `db` are globals from `firebaseConfig.js`; `RoutePlanner` reached via `window._routePlannerRef`.
- Firestore failures are silent (fall back to localStorage / show alert) — check Console + network if data "doesn't save".
- Big JSON data files (~30 MB total) — avoid reading them whole; sample with head/limits.
- `inject_low_scores.py` project mismatch is a known follow-up.
