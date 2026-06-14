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
