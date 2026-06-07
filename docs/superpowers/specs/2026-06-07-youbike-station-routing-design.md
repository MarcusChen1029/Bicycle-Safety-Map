# YouBike Station-to-Station Navigation Mode — Design

**Date:** 2026-06-07
**Status:** Approved (design)

## Goal
Add a user-selectable **YouBike mode** that reroutes a planned trip to go
**station → station**: from the YouBike station nearest the start to the YouBike station
nearest the destination — modelling picking up and dropping off a shared bike.

## Decisions (confirmed with user)
- **Route scope:** station-to-station (both ends snapped to a station).
- **Station pick:** nearest with real-time availability — start = nearest with
  `available_rent_bikes > 0`; end = nearest with `available_return_bikes > 0`.
- **UI control:** a new toggle button in the map's top-right controls.
- **Approach:** resolve endpoints → swap to station coords → reuse the existing `planRoute`
  pipeline (scoring, detour, nav). Least duplication; composes with "避開危險區域".

## Design

### 1. Station finder — `YoubikeLayer.findNearestStation(latLng, type)`
`type` ∈ `'rent' | 'return' | 'any'`. Iterates `this.allStations`, skips invalid coords,
applies the availability filter (`rent` → bikes>0, `return` → docks>0), returns the nearest
`{ station, lat, lng, distance }` by spherical distance, or `null` if data is empty / nothing
matches.

### 2. Routing — `RoutePlanner`
- New state `this.youbikeRouteMode = false` (constructor).
- New helper `_resolveToLatLng(text)` → `Promise<google.maps.LatLng>`: parse `"lat, lng"`
  directly, else geocode via `this.geocoder`; reject on failure.
- In `planRoute(origin, destination)`, before building the request, if `youbikeRouteMode`:
  1. resolve `origin` and `destination` to LatLng;
  2. `start = youbikeLayer.findNearestStation(originLatLng, 'rent')`,
     `end = youbikeLayer.findNearestStation(destLatLng, 'return')`;
  3. if YouBike data unavailable or either is `null` → `alert` + **fall back** to the normal
     origin/destination (no hard fail);
  4. otherwise replace `origin`/`destination` with the station coordinates
     (`"lat,lng"` strings) and continue the existing pipeline unchanged. Console-log the
     chosen stations.

### 3. UI — toggle button (`index.html` + `main.js`)
- Add `🚲 單車模式` button (`#toggle-youbike-route-btn`) to `#map-controls-container`,
  styled like the existing control buttons.
- In `main.js bindEvents()`: click flips `this.routePlanner.youbikeRouteMode`, updates the
  button's active background, and ensures the YouBike layer is visible when the mode is on.

## Interactions / fallbacks
- Works with or without "避開危險區域".
- The existing nav-time "3 nearest stations near start & end" behavior is unchanged; since the
  route now starts/ends at stations, those stations appear naturally.
- Missing data / geocode failure / no available station → alert + normal route.

## Testing (manual — no test framework)
1. Mode **off** → routing is unchanged.
2. Mode **on**, plan a route → route starts and ends at YouBike stations (not the exact
   typed points); console names the chosen stations.
3. Mode on + start station has no bikes nearby → next-nearest station **with** bikes is used.
4. Toggle button background reflects on/off state.
5. With YouBike data not yet loaded → alert + normal route (no crash).

## Out of scope (YAGNI)
- Walking legs between the real start/end and the stations.
- Preferring stations by capacity/predicted availability beyond the >0 check.
- Persisting the mode across reloads.
