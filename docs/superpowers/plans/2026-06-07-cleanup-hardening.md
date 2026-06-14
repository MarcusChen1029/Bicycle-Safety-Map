# Project Cleanup & Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the correctness bugs, dead code, and payload bloat found in an audit of the Bicycle Safety Map app, leaving a cleaner, lighter, more maintainable codebase.

**Architecture:** Static client-side app (vanilla JS globals, Google Maps + Firebase Firestore, no build/test framework). Changes are surgical edits to existing files plus a few removals; no architectural rewrite.

**Tech Stack:** HTML/CSS/vanilla JS, Google Maps JS API v3.64, Firebase compat SDK 12.12.0 (Firestore), Python 3 (data prep scripts).

---

## Context

Why this work: across this session's feature work, an audit surfaced several real defects and cruft that will bite under real use:

- **Correctness:** the accident heatmap silently drops all injury data (filters a severity value the data never contains); the test-data script writes to the *old* Firebase project; a feedback-save code path is dead.
- **Dead code / invalid DOM:** an unused `initMap()`, a mock location handler that's overridden at runtime, a duplicate `.details` panel with a **duplicate element id**, a hidden button with no handler, and orphan `.route-planner` CSS driving no-op `open()/close()` calls.
- **Payload:** ~21 MB of `data/*.json` is shipped but never loaded; the one large file that *is* loaded carries fields the app discards.
- **Hygiene:** no `.gitignore`; run/deploy steps undocumented for humans.

**Deferred (per user):** tightening the open Firestore security rules (`allow read, write: if true`) is **not a priority right now** and is intentionally excluded from this plan. See "Out of scope."

Intended outcome: same features, but correct, smaller, and easier to maintain. No test framework exists, so verification is `node --check` (syntax) + manual browser/console checks.

**Testing note:** There is no JS test harness in this repo and adding one is out of scope (YAGNI for a static class app). Each task is verified by `node --check` for syntax and explicit manual steps. Do not fabricate `pytest`/`jest` commands.

**Execution note:** Work on a branch (`git checkout -b cleanup-hardening`) — `main` is the default branch. Commit after each task.

---

## File overview

| File | Responsibility | Change type |
|---|---|---|
| `js/accidentLayer.js` | accident heatmap | fix severity filter (A2) |
| `inject_low_scores.py` | Firestore test-data injector | repoint to current project (A1) |
| `js/script.js` | UI: stats, tabs, report, feedback modal | remove dead branch/fn/mock (A3, B1, B2) |
| `index.html` | page shell | remove duplicate `.details`, dead button (B3, B4) |
| `css/style.css` | styling | remove orphan `.route-planner` rules (B4) |
| `js/routePlanner.js` | routing | remove no-op `open()/close()` calls (B4) |
| `js/main.js` | orchestrator | drop overridden mock handler + dead `open()` call (B2, B4) |
| `transfer.py` | CSV→accidents.json | emit slimmer docs (C2) |
| `data/output.json`, `data/bike_data_organized.json` | unused dumps | stop tracking (C1) |
| `.gitignore` (new) | repo hygiene | create (D1) |
| `README.md` (new) | run/deploy docs | create (D2) |
| `PROJECT_INDEX.md` | repo map | keep in sync (final step) |

---

## GROUP A — Correctness bugs (do first)

### Task A1: Repoint `inject_low_scores.py` to the current Firebase project

**Files:**
- Modify: `inject_low_scores.py:14-15`

- [ ] **Step 1: Update the project id and API key**

In `inject_low_scores.py`, replace lines 14-15:

```python
# Firebase 設定
PROJECT_ID = "mapcomment-8f128"
API_KEY = "AIzaSyARsnFTWt2MSbQc2mL8_5iIXqIoPcg2f70"
```

with the values the app now uses (from `js/firebaseConfig.js`):

```python
# Firebase 設定 (must match js/firebaseConfig.js)
PROJECT_ID = "bycyclesafetymap"
API_KEY = "AIzaSyCe3E6azBZ2NGXTnROpt1gsUKUtKuq6L1Q"
```

- [ ] **Step 2: Verify it parses**

Run: `python -c "import ast; ast.parse(open('inject_low_scores.py', encoding='utf-8').read()); print('OK')"`
Expected: `OK`

- [ ] **Step 3: (Manual, optional) dry-check the target URL**

Confirm `FIRESTORE_URL` (line 16) now interpolates `bycyclesafetymap`. Do **not** run the injector unless you actually want 30 test docs; if you do, run `python inject_low_scores.py` and expect `成功 30 筆` (current open rules already permit the writes).

- [ ] **Step 4: Commit**

```bash
git add inject_low_scores.py
git commit -m "fix: point inject_low_scores.py at current Firebase project (bycyclesafetymap)"
```

---

### Task A2: Fix accident heatmap dropping all injury data

**Background:** `transfer.py` writes `severity` ∈ {`死亡`,`輕傷`,`無傷`,`不明`}. `js/accidentLayer.js:71` filters for `死亡` **or `重傷`** — but `重傷` is never produced, so every non-fatal accident is excluded and the `index % 10` sampling branch is dead. Intended behavior: show fatalities at full weight and a downsampled set of injuries at low weight.

**Files:**
- Modify: `js/accidentLayer.js:65-98`

- [ ] **Step 1: Replace the filter + weighting in `createHeatmap()`**

Replace this block (lines ~68-79):

```javascript
        const severeAccidents = this.data.filter((accident, index) =>
            // 只顯示死亡，或是重傷且抽樣比例更低 (1/20) 來減少渲染壓力
            accident.severity === '死亡' || (accident.severity === '重傷' && index % 10 === 0)
        );

        const heatmapData = severeAccidents.map(accident => {
            return {
                location: new google.maps.LatLng(accident.position.lat, accident.position.lng),
                weight: accident.severity === '死亡' ? 50 : 10
            };
        });
```

with (uses the severities the data actually contains):

```javascript
        // 顯示死亡(全部) 與 輕傷(抽樣 1/10) 以兼顧資訊量與效能
        const severeAccidents = this.data.filter((accident, index) =>
            accident.severity === '死亡' || (accident.severity === '輕傷' && index % 10 === 0)
        );

        const heatmapData = severeAccidents.map(accident => {
            return {
                location: new google.maps.LatLng(accident.position.lat, accident.position.lng),
                weight: accident.severity === '死亡' ? 50 : 10
            };
        });
```

- [ ] **Step 2: Syntax check**

Run: `node --check js/accidentLayer.js`
Expected: no output (success).

- [ ] **Step 3: Manual verify in browser**

Serve the app (`npx http-server -p 8080` or Live Server), open the Map tab, open DevTools console. Expected log: `✅ Google Maps 熱力圖建立完成 (顯示 N 件事故)` where **N is now larger than the deaths-only count** (injuries are included). Heatmap shows more coverage than before.

- [ ] **Step 4: Commit**

```bash
git add js/accidentLayer.js
git commit -m "fix: accident heatmap was excluding all injuries (filtered nonexistent severity)"
```

---

### Task A3: Remove dead feedback-save branch in `script.js`

**Background:** `js/script.js:436` checks `window.initMapApp._appInstance`, which is never assigned (`main.js` sets `window._routePlannerRef` and `window.initMapApp` as a *function*). The branch is always false; the real save goes through `window._routePlannerRef`. Removing the dead branch clarifies the flow without changing behavior.

**Files:**
- Modify: `js/script.js:434-460` (the feedback submit try-block)

- [ ] **Step 1: Replace the nested branch**

Replace:

```javascript
            try {
                // Access the global app's routePlanner to save feedback
                if (window.initMapApp && window.initMapApp._appInstance) {
                    await window.initMapApp._appInstance.routePlanner.saveFeedbackToFirebase(
                        _feedbackRatings.safety,
                        _feedbackRatings.smoothness
                    );
                } else {
                    // Fallback: try to find routePlanner from global scope
                    // The planRoute button handler in main.js creates the instance
                    // We need a reference - store it on window when created
                    if (window._routePlannerRef) {
                        await window._routePlannerRef.saveFeedbackToFirebase(
                            _feedbackRatings.safety,
                            _feedbackRatings.smoothness
                        );
                    } else {
                        console.warn('No routePlanner reference found, saving directly to Firebase');
                        await feedbackDB.saveFeedback({
                            safetyScore: _feedbackRatings.safety,
                            smoothnessScore: _feedbackRatings.smoothness,
                            averageScore: (_feedbackRatings.safety + _feedbackRatings.smoothness) / 2,
                            steps: [],
                            overviewPath: []
                        });
                    }
                }

                hideFeedbackModal();
```

with:

```javascript
            try {
                // Save via the live RoutePlanner (set on window by main.js) so the route's
                // path is attached; fall back to a bare feedback doc if it's unavailable.
                if (window._routePlannerRef) {
                    await window._routePlannerRef.saveFeedbackToFirebase(
                        _feedbackRatings.safety,
                        _feedbackRatings.smoothness
                    );
                } else {
                    console.warn('No routePlanner reference found, saving directly to Firebase');
                    await feedbackDB.saveFeedback({
                        safetyScore: _feedbackRatings.safety,
                        smoothnessScore: _feedbackRatings.smoothness,
                        averageScore: (_feedbackRatings.safety + _feedbackRatings.smoothness) / 2,
                        steps: [],
                        overviewPath: []
                    });
                }

                hideFeedbackModal();
```

- [ ] **Step 2: Syntax check** — Run: `node --check js/script.js` → success.

- [ ] **Step 3: Manual verify** — Plan a route, click 清除路線, rate both dimensions, 送出回饋 → toast `✅ 感謝您的回饋！`, and a new doc appears in the `bike_map_opinions` collection (Firestore console).

- [ ] **Step 4: Commit**

```bash
git add js/script.js
git commit -m "refactor: drop always-false _appInstance branch in feedback submit"
```

---

## GROUP B — Dead code & DOM cleanup

### Task B1: Remove unused `initMap()` from `script.js`

**Background:** `js/script.js:226` defines `initMap()`, but the Google Maps callback is `initMapApp` (`index.html` script src). `initMap` is never called.

**Files:**
- Modify: `js/script.js:225-234`

- [ ] **Step 1: Delete the dead function**

Remove:

```javascript
// Initialize and add the map
function initMap() {
    // The location of Taipei
    const taipei = { lat: 25.0330, lng: 121.5654 };
    // The map, centered at Taipei
    const map = new google.maps.Map(document.getElementById("map"), {
        zoom: 14,
        center: taipei,
    });
}
```

- [ ] **Step 2: Syntax check** — Run: `node --check js/script.js` → success.

- [ ] **Step 3: Manual verify** — Reload app; map still initializes (via `initMapApp`); no console error about `initMap`.

- [ ] **Step 4: Commit**

```bash
git add js/script.js
git commit -m "chore: remove unused initMap() (map loads via initMapApp)"
```

---

### Task B2: Remove the mock get-location handler that `main.js` overrides

**Background:** `js/script.js:160-166` adds a click handler that fills `report-location` with a hardcoded address. `js/main.js` then `cloneNode`-replaces `#get-location-btn` and binds the *real* GPS handler, discarding the mock. The mock is dead and the clone-replace dance is a smell, but the safe minimal change is to delete the mock so `main.js` can bind directly.

**Files:**
- Modify: `js/script.js:160-166`
- Modify: `js/main.js` report get-location handler (remove the now-unnecessary `cloneNode` replace)

- [ ] **Step 1: Delete the mock handler in `script.js`**

Remove:

```javascript
    // "Get Location" Button Logic (Mock feature)
    const getLocBtn = document.getElementById('get-location-btn');
    if (getLocBtn) {
        getLocBtn.addEventListener('click', () => {
            document.getElementById('report-location').value = '台北市羅斯福路四段1號 (自動定位)';
        });
    }
```

- [ ] **Step 2: Simplify the `main.js` handler** (no longer needs to strip a prior listener)

Replace the block starting `// 回報頁面的定位按鈕 → 使用真實 GPS`:

```javascript
    const getLocBtn = document.getElementById('get-location-btn');
    if (getLocBtn) {
      // 移除 script.js 中的 mock handler，改用真實 GPS
      getLocBtn.replaceWith(getLocBtn.cloneNode(true));
      const newGetLocBtn = document.getElementById('get-location-btn');
      newGetLocBtn.addEventListener('click', () => {
```

with:

```javascript
    const getLocBtn = document.getElementById('get-location-btn');
    if (getLocBtn) {
      getLocBtn.addEventListener('click', () => {
```

Then, within that same handler body, rename the remaining `newGetLocBtn` references (if any) to `getLocBtn`. The geocode-lookup body that fills `report-location` is unchanged.

- [ ] **Step 3: Syntax check** — Run: `node --check js/script.js && node --check js/main.js` → success.

- [ ] **Step 4: Manual verify** — Report tab → tap 📍 → field fills with real GPS coords/address (not the hardcoded 羅斯福路 string).

- [ ] **Step 5: Commit**

```bash
git add js/script.js js/main.js
git commit -m "refactor: drop mock report-location handler; bind real GPS directly"
```

---

### Task B3: Remove the duplicate `.details` panel and duplicate element id

**Background:** `index.html` has two `class="details"` blocks (lines ~85 inside `#view-map`, and ~217 standalone) and therefore **two `id="close-details"`** (lines 86 and 218) — invalid HTML; `getElementById`/`#close-details` only ever resolves the first. The standalone block at 217-260 sits outside the view panes and is leftover.

**Files:**
- Modify: `index.html` (remove the standalone `.details` block, ~lines 213-260)

- [ ] **Step 1: Confirm it's not the active panel (do before deleting)**

Serve the app, open DevTools, run in console:
`document.querySelectorAll('.details').length` → expect `2`; then
`document.querySelectorAll('#close-details').length` → expect `2` (the bug).
Click on the map: the panel that gets the `active` class is the **first** `.details` (inside `#view-map`). The second is the redundant one.

- [ ] **Step 2: Delete the standalone block**

Remove the entire second `.details` block — it begins at `index.html:213`:

```html
        <div class="details">
            <span id="close-details" style="float: right; cursor: pointer; font-size: 20px; color: #888;">&times;</span>
```

…through its closing `</div>` at line ~260 (the block ending just before `<!-- Feedback Modal -->`). Keep the first `.details` block inside `#view-map` intact.

- [ ] **Step 3: Verify ids are now unique**

Reload, console: `document.querySelectorAll('#close-details').length` → expect `1`; `document.querySelectorAll('.details').length` → expect `1`.

- [ ] **Step 4: Manual verify** — Map click still opens the details panel; the × still closes it (handler in `main.js` `close-details`).

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "fix: remove duplicate .details panel and duplicate close-details id"
```

---

### Task B4: Remove dead route-planner toggle button, no-op open()/close(), and orphan CSS

**Background:** `#toggle-route-planner-btn` (`index.html:28`, `display:none`) has no JS handler. `routePlanner.open()/close()` query `.route-planner`, a class that exists only in CSS (`css/style.css:423-506`) — no DOM element uses it, so both methods are no-ops. The route planner UI is `.route-planner-page` / `#view-route`.

**Files:**
- Modify: `index.html:28-30` (remove hidden button)
- Modify: `js/routePlanner.js` (remove no-op `open()`/`close()`)
- Modify: `js/main.js` (remove the `this.routePlanner.open()` call)
- Modify: `css/style.css:423-506` (remove orphan `.route-planner ...` rules)

- [ ] **Step 1: Remove the hidden button in `index.html`**

Remove:

```html
                <button id="toggle-route-planner-btn" class="map-control-btn" style="display: none;">
                    <span>🗺️</span> 路線規劃
                </button>
```

- [ ] **Step 2: Remove the no-op methods in `js/routePlanner.js`**

Delete both methods (lines ~182-197):

```javascript
    /**
     * Open the route planner panel
     */
    open() {
        const panel = document.querySelector('.route-planner');
        if (panel) {
            panel.classList.add('active');
        }
    }

    /**
     * Close the route planner panel
     */
    close() {
        const panel = document.querySelector('.route-planner');
        if (panel) {
            panel.classList.remove('active');
        }
    }
```

- [ ] **Step 3: Remove the `this.routePlanner.open()` call site in `js/main.js`**

In the map-click listener, replace:

```javascript
        // Check if route planner is initialized
        if (this.routePlanner) {
          this.routePlanner.open();
          this.routePlanner.setDestination(e.latLng);
        }
```

with:

```javascript
        // Check if route planner is initialized
        if (this.routePlanner) {
          this.routePlanner.setDestination(e.latLng);
        }
```

- [ ] **Step 4: Remove orphan CSS** — delete the `.route-planner` rule blocks in `css/style.css` (lines ~423-506: `.route-planner h3`, `.route-planner input...`, `.route-planner button...`, etc.). Keep all `.route-planner-page` rules.

- [ ] **Step 5: Syntax check** — Run: `node --check js/routePlanner.js && node --check js/main.js` → success.

- [ ] **Step 6: Manual verify** — Map click still reverse-geocodes into the destination field; Route tab still styled correctly (it uses `.route-planner-page`); no console errors.

- [ ] **Step 7: Commit**

```bash
git add index.html js/routePlanner.js js/main.js css/style.css
git commit -m "chore: remove dead route-planner toggle, no-op open/close, orphan CSS"
```

---

## GROUP C — Payload / performance

### Task C1: Stop tracking the two large unused data files

**Background:** `data/output.json` (~9.9 MB, intermediate accident dump) and `data/bike_data_organized.json` (~11.4 MB, English-key copy) are committed but **never loaded** by the app (`accidentLayer` loads `accidents.json`; `bikeLane` loads `bike_data.json`). They bloat the repo and risk accidental shipping.

**Files:**
- Modify/create: `.gitignore` (see Task D1 for the full file; this task only adds the data lines)
- Remove from tracking: `data/output.json`, `data/bike_data_organized.json`

- [ ] **Step 1: Confirm they are unreferenced by app code**

Run: `git grep -n "output.json\|bike_data_organized" -- ':!PROJECT_INDEX.md' ':!docs'`
Expected: no hits in `js/` or `index.html` (only docs/index mentions). If any app code references them, STOP and revisit.

- [ ] **Step 2: Untrack (keep the local files on disk)**

```bash
git rm --cached data/output.json data/bike_data_organized.json
```

- [ ] **Step 3: Ensure they are ignored** — append to `.gitignore` (create the file if it does not exist yet; Task D1 establishes the rest of it):

```
# Large intermediate data dumps (not loaded by the app)
data/output.json
data/bike_data_organized.json
```

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore: stop tracking unused 21MB data dumps (output.json, bike_data_organized.json)"
```

---

### Task C2: Slim `accidents.json` to the fields the app uses

**Background:** `js/accidentLayer.js` `parseAccidentData()` keeps only `{position(lat,lng), severity}` and discards `date`, `location`, `description`. Yet `transfer.py` writes all of those, inflating `accidents.json` (~7.9 MB) and the client download. Emit only the used fields.

**Files:**
- Modify: `transfer.py:51-65` (the item dict)
- Regenerate: `data/accidents.json`

- [ ] **Step 1: Reduce the emitted record in `transfer.py`**

Replace:

```python
                # accidents.json format: lat, lng, severity, date, location, description
                item = {
                    "lat": lat,
                    "lng": lng,
                    "severity": severity,
                    "date": date_str,
                    "location": row.get("肇事地點", ""),
                    "description": row.get("事故類型及型態", "")
                }

                # Validation
                if not item["date"]:
                     pass
```

with:

```python
                # accidents.json: only fields the app consumes (accidentLayer keeps lat/lng/severity)
                item = {
                    "lat": lat,
                    "lng": lng,
                    "severity": severity
                }
```

(The `date_str` computation above it is now unused; leaving or removing it is harmless.)

- [ ] **Step 2: Regenerate the data file**

Run: `python transfer.py`
Expected: `轉換成功！已輸出至 data/accidents.json，共 N 筆資料。`

- [ ] **Step 3: Confirm the file shrank and shape is right**

Run: `python -c "import json; d=json.load(open('data/accidents.json',encoding='utf-8')); print(len(d), list(d[0].keys()))"`
Expected: a count, and keys exactly `['lat', 'lng', 'severity']`.

- [ ] **Step 4: Manual verify in browser** — heatmap still renders (Task A2 log line); no parse errors.

- [ ] **Step 5: Commit**

```bash
git add transfer.py data/accidents.json
git commit -m "perf: slim accidents.json to lat/lng/severity (drop unused fields)"
```

> Note: `check_fatal.py` reads `severity` only, so it still works (its `其他` line will read 0 — acceptable for a one-off diagnostic).

---

## GROUP D — Repo hygiene & docs

### Task D1: Add a `.gitignore`

**Files:**
- Create/extend: `.gitignore`

- [ ] **Step 1: Create `.gitignore`** (if Task C1 already added the data-dump lines, keep them and add the rest so the final file reads):

```
# Dependencies
node_modules/

# Firebase
.firebase/
firebase-debug.log
*-debug.log

# OS / editor
.DS_Store
Thumbs.db

# Large intermediate data dumps (not loaded by the app)
data/output.json
data/bike_data_organized.json
```

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: add .gitignore"
```

---

### Task D2: Add a `README.md` with run + data-prep instructions

**Background:** New contributors have no run/deploy docs. `CLAUDE.md`/`PROJECT_INDEX.md` serve the agent; a human-facing README is missing.

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

```markdown
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
- Project: `bycyclesafetymap`. Collections: `bike_map_opinions`, `reports`.
- Deploy security rules: `firebase deploy --only firestore:rules`
  (or paste `firestore.rules` into the Firestore Rules console and Publish).

## Data prep (Python, run manually)
- `transfer.py` — CSV (big5) → `data/accidents.json`
- `dataGain.py` — KML → `data/bike_data.json`
- `inject_low_scores.py` — inject test feedback (targets `bycyclesafetymap`)

See `PROJECT_INDEX.md` for a full file-by-file map.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with run, deploy, and data-prep steps"
```

---

## Final step: sync the index & wrap up

- [ ] **Update `PROJECT_INDEX.md`** to reflect: slimmer `accidents.json` shape (`lat/lng/severity`); removed `initMap`/mock handler/duplicate `.details`/route-planner dead code; untracked data dumps; new `README.md`/`.gitignore`. Update the "Gotchas" list (the `inject_low_scores.py` mismatch and the dead-code notes are now resolved).
- [ ] **Commit:** `git add PROJECT_INDEX.md && git commit -m "docs: sync PROJECT_INDEX after cleanup"`
- [ ] **Copy this plan** to `docs/superpowers/plans/2026-06-07-cleanup-hardening.md` and commit (the canonical location once out of plan mode).

---

## End-to-end verification (after all tasks)

1. `node --check` passes for every modified JS file:
   `for f in js/*.js; do node --check "$f" || echo "FAIL $f"; done` → no FAIL lines.
2. Serve the app; DevTools console has **no errors**.
3. Heatmap shows fatalities + sampled injuries (count higher than deaths-only).
4. Plan a route → works; clear route → feedback modal → submit → doc in `bike_map_opinions`.
5. Submit a report (📍 real GPS) → ⚠️ marker appears live; reload → marker persists; click → info.
6. `git status` clean; repo no longer tracks the two large dumps; `accidents.json` noticeably smaller.

## Out of scope (deliberately not doing)
- **Tightening the Firestore security rules** (currently `allow read, write: if true`). The user has deprioritized this; revisit before any public/production launch.
- Migrating to ES modules / a bundler / a JS test framework (large rewrite; YAGNI for this app).
- Geo-bounded/paginated Firestore queries beyond the limits already added this session.
- Storing/displaying the report photo upload (feature, not a fix).
- Restyling: moving the many inline styles in `index.html` into CSS (cosmetic; large diff, low value now).
