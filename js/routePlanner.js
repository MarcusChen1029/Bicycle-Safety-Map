class RoutePlanner {
    constructor(map, accidentLayer, youbikeLayer, bikeLaneLayer) {
        this.map = map;
        this.accidentLayer = accidentLayer;
        this.youbikeLayer = youbikeLayer;
        this.bikeLaneLayer = bikeLaneLayer;
        this.directionsService = new google.maps.DirectionsService();
        this.directionsRenderer = new google.maps.DirectionsRenderer({
            map: this.map,
            // Don't draw Google's default A/B endpoint markers — they'd
            // overlay (and steal drag events from) our own draggable
            // origin/destination pins.
            suppressMarkers: true,
            polylineOptions: {
                strokeColor: '#4285f4',
                strokeWeight: 6,
                strokeOpacity: 0.8
            }
        });

        this.geocoder = new google.maps.Geocoder();
        this.initAutocomplete();

        this.favorites = this.loadFavorites();
        this.bindFavoriteEvents();
        this.renderFavorites();

        // Feedback: store last planned route for post-ride feedback
        this.lastRoute = null;
        this.lastFinalResult = null;

        // YouBike mode: when on, routes are snapped station-to-station (toggled from the map UI)
        this.youbikeRouteMode = false;

        // Pre-load Firebase road scores cache
        this._roadScores = new Map();
        this._loadRoadScores();

        // Pre-load per-road accident stats (data/road_stats.json) for the
        // instant ROAD-LEVEL evaluation on map click — zero Directions requests.
        this.roadStats = new Map();
        this._loadRoadStats();

        // Set by setDestination() on every map click; consumed by the
        // 開始導航 button handler (js/main.js) to run the full route pipeline
        // on demand, only when the user actually asks to navigate.
        this.pendingDestination = null;

        // Stale-click guard: bumped on every setDestination() call so a
        // slow/older geocode can never overwrite a newer click's render.
        this._destinationToken = 0;

        // Pin marking the spot the user clicked to inspect; recolored with
        // the 友善等級 once the road-level evaluation resolves.
        this.clickMarker = null;

        // Committed origin: set via setOrigin() (設為起點 button, GPS
        // "使用目前位置" button, or autocomplete/drag). Distinct from
        // pendingDestination/clickMarker, which track the INSPECT flow.
        this.originLatLng = null;
        this.originMarker = null;

        // Most recently INSPECTED spot (map click / search / autocomplete on
        // the destination side) — this is what the 設為起點/設為終點 panel
        // buttons commit when pressed.
        this.lastInspectedLatLng = null;
        this.lastInspectedName = null;

        console.log('✅ RoutePlanner initialized');
    }

    /**
     * Pre-load per-road scores from Firebase into local cache for scoring
     */
    async _loadRoadScores() {
        try {
            if (typeof roadScoreDB !== 'undefined') {
                this._roadScores = await roadScoreDB.getAll();
                console.log(`🛣️ Loaded ${this._roadScores.size} road scores for routing`);
            }
        } catch (e) {
            console.error('Failed to load road scores:', e);
            this._roadScores = new Map();
        }
    }

    /**
     * Pre-load per-road accident stats from data/road_stats.json into a
     * name -> entry map, keyed the same way as roadStats' own generator
     * (normalizeRoadName: section suffix stripped). Non-fatal on failure —
     * the road-level 歷史事故 bar just falls back to "no data" for every road.
     */
    async _loadRoadStats() {
        try {
            const response = await fetch('data/road_stats.json');
            const json = await response.json();
            const map = new Map();
            if (json && json.roads) {
                Object.keys(json.roads).forEach(key => map.set(key, json.roads[key]));
            }
            this.roadStats = map;
            console.log(`🛣️ Loaded ${this.roadStats.size} road stats for road-level evaluation`);
        } catch (e) {
            console.error('Failed to load road stats:', e);
            this.roadStats = new Map();
        }
    }

    /**
     * Load favorites from localStorage
     */
    loadFavorites() {
        const saved = localStorage.getItem('bike_map_favorites');
        if (saved) {
            try {
                return JSON.parse(saved);
            } catch (e) {
                console.error('Failed to parse favorites', e);
                return [];
            }
        }
        return [];
    }

    /**
     * Save favorites to localStorage
     */
    saveFavorites() {
        localStorage.setItem('bike_map_favorites', JSON.stringify(this.favorites));
        this.renderFavorites(); // Update UI
    }

    /**
     * Add a new favorite
     */
    addFavorite(name, address) {
        if (!name.trim() || !address.trim()) {
            alert('請輸入名稱及完整地址');
            return;
        }

        // Prevent exact duplicates
        const exists = this.favorites.some(f => f.name === name || f.address === address);
        if (exists && !confirm('此名稱或地址已存在，確定要加入嗎？')) return;

        this.favorites.push({
            id: Date.now().toString(),
            name: name,
            address: address
        });

        this.saveFavorites();
    }

    /**
     * Delete a favorite by ID
     */
    deleteFavorite(id, event) {
        // Stop event from bubbling up to the list item click
        if (event) event.stopPropagation();

        this.favorites = this.favorites.filter(f => f.id !== id);
        this.saveFavorites();
    }

    /**
     * Render the favorites list to the DOM
     */
    renderFavorites() {
        const listEl = document.getElementById('favorites-list');
        if (!listEl) return;

        listEl.innerHTML = '';

        if (this.favorites.length === 0) {
            listEl.innerHTML = '<li style="justify-content: center; color: #888; font-size: 13px;">尚未加入常用地址</li>';
            return;
        }

        this.favorites.forEach(fav => {
            const li = document.createElement('li');

            // Text container
            const infoDiv = document.createElement('div');
            infoDiv.className = 'fav-info';
            infoDiv.innerHTML = `<span class="fav-name">${fav.name}</span><span class="fav-addr" title="${fav.address}">${fav.address}</span>`;

            // Delete button
            const delBtn = document.createElement('button');
            delBtn.className = 'fav-delete';
            delBtn.innerHTML = '🗑️';
            delBtn.title = '刪除此地址';
            delBtn.onclick = (e) => this.deleteFavorite(fav.id, e);

            // Click to use address
            li.onclick = () => this.useFavoriteAddress(fav.address);

            li.appendChild(infoDiv);
            li.appendChild(delBtn);
            listEl.appendChild(li);
        });
    }

    /**
     * Fill the end-point input with the clicked favorite address
     */
    useFavoriteAddress(address) {
        const endInput = document.getElementById('end-point');
        if (endInput) {
            endInput.value = address;
            // Focus on the start input since they probably need to type that next, or just let them hit plan
            const startInput = document.getElementById('start-point');
            if (startInput && !startInput.value) {
                startInput.focus();
            }
        }
    }

    /**
     * Bind events for the favorite address UI
     */
    bindFavoriteEvents() {
        // Event delegator might run before DOM is fully ready if called too early, 
        // rely on document or ensuring this runs after DOMContentLoaded
        const addBtn = document.getElementById('add-favorite-btn');
        if (addBtn) {
            addBtn.addEventListener('click', () => {
                const nameInput = document.getElementById('new-favorite-name');
                const addrInput = document.getElementById('new-favorite-addr');

                if (nameInput && addrInput) {
                    this.addFavorite(nameInput.value, addrInput.value);
                    nameInput.value = '';
                    addrInput.value = '';
                }
            });
        }
    }

    /**
     * Set the destination input from a LatLng object (e.g. map click).
     * Fast path: this does NOT plan a route (zero Directions requests) — it
     * reverse-geocodes just enough to paint an instant ROAD-LEVEL evaluation
     * from already-loaded data (this.roadStats, this._roadScores,
     * bikeLaneLayer, youbikeLayer). The full ROUTE-level pipeline only runs
     * when the user presses 開始導航 (js/main.js), via planRoute().
     * @param {google.maps.LatLng} latLng
     */
    /**
     * Geocode a place name / address from the search bar, pan+zoom the map to
     * it, then run the same road-level inspection a map click does (opens the
     * details panel, drops the graded pin, sets it as the pending destination
     * so 開始導航 can route there). Region-biased to Taiwan so bare road names
     * resolve locally.
     * @param {string} query
     * @returns {Promise<void>}
     */
    searchAndInspect(query) {
        const q = (query || '').trim();
        if (!q) return Promise.resolve();

        return new Promise((resolve) => {
            this.geocoder.geocode(
                { address: q, region: 'TW', bounds: this.map ? this.map.getBounds() : undefined },
                (results, status) => {
                    if (status === 'OK' && results && results[0]) {
                        const loc = results[0].geometry.location;
                        if (this.map) {
                            this.map.panTo(loc);
                            this.map.setZoom(17);
                        }
                        const details = document.querySelector('.details');
                        if (details) details.classList.add('active');
                        // Reuse the whole click pipeline: pin + road-level grade.
                        this.setDestination(loc);
                    } else {
                        console.warn(`🔍 Search failed for "${q}": ${status}`);
                        alert(`找不到「${q}」，請換個關鍵字或更完整的地址。`);
                    }
                    resolve();
                }
            );
        });
    }

    setDestination(latLng) {
        this.pendingDestination = latLng;
        this.lastInspectedLatLng = latLng;
        this.lastInspectedName = null; // filled in once the reverse geocode below resolves

        // Drop the pin right away so the click has an immediate anchor on the
        // map; it stays grey until the evaluation below resolves into a grade.
        this._showClickMarker(latLng, null);

        // Show 開始導航 immediately — the user can ask to navigate from a
        // road-level click alone, before any route has been planned.
        const navBtn = document.getElementById('start-navigation-btn');
        if (navBtn) navBtn.style.display = 'flex';

        // Stale-click guard: if another click starts a newer geocode before
        // this one resolves, this callback must not paint over it.
        const myToken = ++this._destinationToken;

        // Reverse geocode to get address (shared helper — also used by the
        // origin/destination marker dragend handlers below).
        this._reverseGeocodeRoadName(latLng).then(({ displayName, normalizedName, formattedAddress }) => {
            if (myToken !== this._destinationToken) return; // superseded by a newer click

            const input = document.getElementById('end-point');
            if (input) {
                input.value = formattedAddress || displayName;
                if (formattedAddress) input.dispatchEvent(new Event('input'));
            }
            if (formattedAddress) {
                console.log(`📍 Destination set to: ${formattedAddress}`);
            }

            // Only record this as "the currently inspected spot" if a newer
            // click/search hasn't already superseded it (same guard as the
            // paint call below).
            this.lastInspectedLatLng = latLng;
            this.lastInspectedName = displayName;

            this._renderRoadLevelEvaluation(latLng, displayName, normalizedName);
        });
    }

    /**
     * Reverse-geocode `latLng` into a road/address label, using the same
     * extraction rules the original map-click inspect flow always used:
     * prefer the first result's 'route' address_component (un-normalized
     * long_name for display, normalizeRoadName()'d for data lookups),
     * falling back to a trimmed formatted_address, and finally to a
     * "lat, lng" string if the geocode itself fails. Shared by
     * setDestination() and the origin/destination marker dragend handlers
     * so this extraction logic lives in exactly one place.
     * @param {google.maps.LatLng} latLng
     * @returns {Promise<{displayName:string, normalizedName:string|null, formattedAddress:string|null}>}
     */
    _reverseGeocodeRoadName(latLng) {
        return new Promise((resolve) => {
            this.geocoder.geocode({ location: latLng }, (results, status) => {
                let displayName = null;
                let normalizedName = null;
                let formattedAddress = null;

                if (status === 'OK' && results && results.length > 0) {
                    formattedAddress = results[0].formatted_address;

                    // Road name = first result with an address_component of
                    // type 'route'; use its long_name (un-normalized for display).
                    for (const result of results) {
                        const routeComponent = (result.address_components || [])
                            .find(c => c.types && c.types.includes('route'));
                        if (routeComponent) {
                            displayName = routeComponent.long_name;
                            normalizedName = normalizeRoadName(displayName);
                            break;
                        }
                    }

                    // Fallback: no 'route' component in any result — trim the
                    // formatted address down to something header-sized.
                    if (!displayName) {
                        displayName = this._trimAddress(formattedAddress);
                        normalizedName = displayName ? normalizeRoadName(displayName) : null;
                    }
                } else {
                    console.warn('Geocoder failed due to: ' + status);
                    // Fallback to coordinates if address fails
                    displayName = `${latLng.lat().toFixed(5)}, ${latLng.lng().toFixed(5)}`;
                }

                resolve({ displayName, normalizedName, formattedAddress });
            });
        });
    }

    /**
     * Instant ROAD-LEVEL evaluation for a map click — zero Directions
     * requests. Mirrors _renderFriendlinessStats/_paintFriendlinessStats'
     * shape (compute four bar scores + overall grade, then paint) but reads
     * point-level data instead of route-level aggregates:
     *   - 歷史事故: data/road_stats.json entry for the normalized road name
     *     (this.roadStats). Miss -> no data, excluded from the grade.
     *   - 民眾意見: this._roadScores lookup — identical convention to the
     *     route flow (no votes -> bar shows 70, excluded from the grade).
     *   - 交通環境風險: computeRoadRiskScore(classIdx, trafficIdx) — no
     *     Directions request, so no live-traffic refine step here (that only
     *     happens once a full route exists, via _refineTrafficRisk).
     *   - 基礎設施: computePointInfraScore — is the clicked point itself near
     *     a bike lane / YouBike station.
     * @param {google.maps.LatLng} latLng - the clicked point
     * @param {string} displayName - un-normalized road/address label for .header
     * @param {string|null} normalizedName - normalizeRoadName()'d, for data lookups
     */
    _renderRoadLevelEvaluation(latLng, displayName, normalizedName) {
        if (typeof updateRouteHeader === 'function') {
            updateRouteHeader(displayName);
        }

        // 歷史事故
        const statsEntry = normalizedName ? this.roadStats.get(normalizedName) : null;
        const accidentHasData = !!statsEntry;
        // No entry in road_stats.json: excluded from the grade below, so the
        // displayed value doesn't affect it — 70 keeps the bar's "no data yet"
        // look consistent with 民眾意見's own no-data placeholder.
        const accidentScore = accidentHasData ? statsEntry.accidentScore : 70;

        // 民眾意見 — same convention as the route flow's per-step lookup
        const rec = normalizedName ? this._roadScores.get(normalizedName) : null;
        const opinion = (rec && rec.count > 0)
            ? computeOpinionScore(rec.sum / rec.count, 1)
            : computeOpinionScore(0, 0);

        // 交通環境風險 — no route/Directions request; road-class + time-of-day only
        const classIdx = classValueForRoadName(normalizedName);
        const trafficIdx = trafficIdxFallback(new Date());
        const riskScore = computeRoadRiskScore(classIdx, trafficIdx);

        // 基礎設施 — is the clicked point itself near a lane / station
        const laneNear = this._isPointNearBikeLane(latLng);
        const stations = (this.youbikeLayer && this.youbikeLayer.allStations) ? this.youbikeLayer.allStations : [];
        const stationNear = this._isNearAnyStation(latLng, stations, 350);
        const infraScore = computePointInfraScore(laneNear, stationNear);

        const scores = { accident: accidentScore, risk: riskScore, infrastructure: infraScore, opinion: opinion.score };
        const grade = computeOverallGrade(scores, { accident: accidentHasData, opinion: opinion.hasData });

        if (typeof updateFriendlinessBars === 'function') {
            updateFriendlinessBars(scores);
        }
        if (typeof updateFriendlinessGrade === 'function') {
            updateFriendlinessGrade(grade);
        }

        // Recolor the pin dropped at click time with the resolved grade.
        this._showClickMarker(latLng, grade, displayName);
    }

    /**
     * Place (or move) the pin marking the inspected spot. Reuses one marker
     * instance so rapid clicks don't litter the map.
     * @param {google.maps.LatLng} latLng
     * @param {{letter: string, color: string}|null} grade - null = still
     *   evaluating, drawn grey with no letter
     * @param {string} [title] - road name, shown as the hover tooltip
     */
    _showClickMarker(latLng, grade, title) {
        if (!this.map) return;

        const fill = grade ? grade.color : '#9e9e9e';
        // B's bright yellow-green needs dark text to stay legible.
        const labelColor = (fill.toLowerCase() === '#daff07') ? '#333' : '#fff';

        const icon = {
            path: 'M 0,0 C -2,-19 -9,-21 -9,-28 A 9,9 0 1,1 9,-28 C 9,-21 2,-19 0,0 z',
            fillColor: fill,
            fillOpacity: 1,
            strokeColor: '#fff',
            strokeWeight: 2,
            scale: 1.1,
            labelOrigin: new google.maps.Point(0, -28)
        };
        const label = grade
            ? { text: grade.letter, color: labelColor, fontSize: '13px', fontWeight: 'bold' }
            : null;

        if (!this.clickMarker) {
            this.clickMarker = new google.maps.Marker({
                map: this.map,
                position: latLng,
                icon,
                label,
                draggable: true,
                zIndex: 999, // above the heatmap, YouBike and report markers
                title: title || ''
            });
            this.clickMarker.addListener('dragend', () => this._handleDestinationDragend());
            return;
        }

        this.clickMarker.setPosition(latLng);
        this.clickMarker.setIcon(icon);
        this.clickMarker.setLabel(label);
        if (title) this.clickMarker.setTitle(title);
        this.clickMarker.setMap(this.map);
    }

    /**
     * Normalize a google.maps.LatLng OR a plain {lat,lng} literal (e.g. the
     * GPS currentPosition object main.js tracks) into a real
     * google.maps.LatLng, so every caller below can rely on .lat()/.lng().
     * @param {google.maps.LatLng|{lat:number,lng:number}} latLng
     * @returns {google.maps.LatLng}
     */
    _toLatLng(latLng) {
        if (latLng && typeof latLng.lat === 'function') return latLng;
        return new google.maps.LatLng(latLng.lat, latLng.lng);
    }

    /**
     * Commit `latLng` as the real ROUTING origin — distinct from the
     * INSPECT-only flow (setDestination/clickMarker). Drops/moves a GREEN
     * "起" pin so the origin is never visually confused with the
     * grade-colored destination pin. Auto-plans the route once both
     * endpoints are set (see _maybeAutoPlan).
     * @param {google.maps.LatLng|{lat:number,lng:number}} latLng
     * @param {string} [label] - text to fill #start-point with; falls back
     *   to a formatted "lat, lng" string when omitted (e.g. GPS fix with no
     *   reverse-geocoded address yet).
     */
    setOrigin(latLng, label) {
        const normalized = this._toLatLng(latLng);
        this.originLatLng = normalized;

        const icon = {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 12,
            fillColor: '#28a745',
            fillOpacity: 1,
            strokeColor: '#fff',
            strokeWeight: 2
        };
        const markerLabel = { text: '起', color: '#fff', fontSize: '12px', fontWeight: 'bold' };

        if (!this.originMarker) {
            this.originMarker = new google.maps.Marker({
                map: this.map,
                position: normalized,
                icon,
                label: markerLabel,
                draggable: true,
                zIndex: 998, // below clickMarker (999), above layers
                title: '起點'
            });
            this.originMarker.addListener('dragend', () => this._handleOriginDragend());
        } else {
            this.originMarker.setPosition(normalized);
            this.originMarker.setMap(this.map);
        }

        const input = document.getElementById('start-point');
        if (input) {
            input.value = label || `${normalized.lat().toFixed(6)}, ${normalized.lng().toFixed(6)}`;
        }

        if (this.originLatLng && this.pendingDestination) {
            this._maybeAutoPlan();
        }
    }

    /**
     * Commit `latLng` as the real ROUTING destination. Reuses the existing
     * INSPECT pipeline (setDestination -> reverse geocode -> road-level
     * grade -> _showClickMarker) so the destination pin keeps showing the
     * road's 友善等級 color rather than introducing a second, plain marker
     * type — this is the "reuse the grading pin" choice called out in the
     * commit body. `label`, when given (panel button using the
     * already-inspected name, or an autocomplete place name), pre-fills
     * #end-point immediately for instant feedback; the reverse geocode
     * inside setDestination then confirms/refines it moments later.
     * @param {google.maps.LatLng|{lat:number,lng:number}} latLng
     * @param {string} [label]
     */
    setDestinationCommitted(latLng, label) {
        const normalized = this._toLatLng(latLng);

        if (label) {
            const input = document.getElementById('end-point');
            if (input) input.value = label;
        }

        this.setDestination(normalized);

        // clickMarker is created draggable (see _showClickMarker) with its
        // dragend handler wired at creation time, so nothing extra is
        // needed here beyond making sure it stays draggable across reuse.
        if (this.clickMarker) this.clickMarker.setDraggable(true);

        if (this.originLatLng && this.pendingDestination) {
            this._maybeAutoPlan();
        }
    }

    /**
     * Auto-trigger the full route pipeline once BOTH endpoints are
     * committed. setOrigin/setDestinationCommitted can land in either
     * order (map click, panel button, GPS, autocomplete, drag), so both
     * call this after updating their own half of the pair; it's a no-op
     * until the other half is also set. Reuses planRoute's existing
     * "lat,lng" string argument format so the whole scoring/detour/render
     * pipeline repaints exactly as if 規劃路線 had been pressed.
     */
    _maybeAutoPlan() {
        if (!this.originLatLng || !this.pendingDestination) return;
        const originStr = `${this.originLatLng.lat()},${this.originLatLng.lng()}`;
        const destStr = `${this.pendingDestination.lat()},${this.pendingDestination.lng()}`;
        this.planRoute(originStr, destStr);
    }

    /**
     * originMarker's dragend handler. Re-plans immediately from the new
     * position (routing doesn't need to wait on the reverse geocode, which
     * is only for the #start-point display text) and separately refreshes
     * the input text once _reverseGeocodeRoadName resolves.
     */
    _handleOriginDragend() {
        const newPos = this.originMarker.getPosition();
        this.originLatLng = newPos;
        this._maybeAutoPlan();

        this._reverseGeocodeRoadName(newPos).then(({ displayName, formattedAddress }) => {
            const input = document.getElementById('start-point');
            if (input) input.value = formattedAddress || displayName;
        });
    }

    /**
     * clickMarker's dragend handler, for the case where it represents a
     * COMMITTED destination (as opposed to a not-yet-committed inspect
     * pin — dragging either is harmless, this just keeps pendingDestination
     * and the road-level grade in sync with wherever the pin ends up).
     * Re-plans immediately (if origin is also set) using the new position,
     * then refreshes #end-point's text and the 友善等級 grade once the
     * reverse geocode resolves.
     */
    _handleDestinationDragend() {
        const newPos = this.clickMarker.getPosition();
        this.pendingDestination = newPos;
        this.lastInspectedLatLng = newPos;

        // If origin is already set, this drag re-plans a full ROUTE, whose
        // own _renderFriendlinessStats becomes the authoritative panel
        // repaint. Remember that BEFORE the geocode resolves, so the point-
        // level re-grade below doesn't race it and overwrite the route
        // grade with a point-only one.
        const willAutoPlan = !!this.originLatLng;
        this._maybeAutoPlan();

        this._reverseGeocodeRoadName(newPos).then(({ displayName, normalizedName, formattedAddress }) => {
            const input = document.getElementById('end-point');
            if (input) input.value = formattedAddress || displayName;
            this.lastInspectedName = displayName;

            if (!willAutoPlan) {
                this._renderRoadLevelEvaluation(newPos, displayName, normalizedName);
            }
        });
    }

    /**
     * Attach classic google.maps.places.Autocomplete to #start-point and
     * #end-point so an address can be picked from a dropdown instead of a
     * full map click / search round trip. Guarded by `google.maps.places`
     * existing — the `places` library can be missing (e.g. the Maps script
     * tag loaded without it, or a headless context without the real Maps
     * API at all), and this must not throw in that case.
     */
    initAutocomplete() {
        if (!google.maps.places) return;

        const attach = (input, onPlaceChosen) => {
            if (!input) return;
            const autocomplete = new google.maps.places.Autocomplete(input, {
                componentRestrictions: { country: 'tw' },
                fields: ['geometry', 'name', 'formatted_address']
            });
            if (this.map) autocomplete.bindTo('bounds', this.map);

            autocomplete.addListener('place_changed', () => {
                const place = autocomplete.getPlace();
                if (!place || !place.geometry || !place.geometry.location) {
                    console.warn('⚠️ Autocomplete: no geometry for the selected place, ignoring');
                    return;
                }
                const loc = place.geometry.location;
                const label = place.name || place.formatted_address || '';
                if (this.map) this.map.panTo(loc);
                onPlaceChosen(loc, label);
            });
        };

        attach(document.getElementById('start-point'), (loc, label) => this.setOrigin(loc, label));
        attach(document.getElementById('end-point'), (loc, label) => this.setDestinationCommitted(loc, label));
    }

    /**
     * Whether a single point is within tolerance of any bike-lane polyline —
     * one isLocationOnEdge sweep per lane, for the ONE clicked point (unlike
     * the route flow's per-step multi-sample-point sweep, which has no single
     * point to test).
     * @param {google.maps.LatLng} latLng
     * @returns {boolean}
     */
    _isPointNearBikeLane(latLng) {
        const polys = (this.bikeLaneLayer && this.bikeLaneLayer.polylines) ? this.bikeLaneLayer.polylines : [];
        if (polys.length === 0) return false;
        return polys.some(poly => google.maps.geometry.poly.isLocationOnEdge(latLng, poly, 0.00025));
    }

    /**
     * Plan a route between origin and destination
     * @param {string} origin - Starting point address or coordinates
     * @param {string} destination - Ending point address or coordinates
     */
    async planRoute(origin, destination) {
        if (!origin || !destination) {
            alert('Please enter both start and end locations.');
            return;
        }

        console.log(`🗺️ Planning route from "${origin}" to "${destination}"...`);

        // YouBike mode: snap origin/destination to the nearest usable stations.
        if (this.youbikeRouteMode) {
            const snapped = await this._snapToYoubikeStations(origin, destination);
            if (snapped) {
                origin = snapped.origin;
                destination = snapped.destination;
            }
            // If snapping failed it already alerted; fall through with the original points.
        }

        const request = {
            origin: origin,
            destination: destination,
            travelMode: google.maps.TravelMode.BICYCLING,
            provideRouteAlternatives: true, // Request multiple routes
            avoidHighways: true,
            avoidTolls: true
        };

        showLoadingSpinner('規劃路線中…');
        try {
            const result = await this.calculateRoute(request);

            const avoidDangerous = document.getElementById('avoid-dangerous');
            const isAvoidDangerous = avoidDangerous ? avoidDangerous.checked : false;

            let selectedRouteIndex = 0;
            let finalResult = result;

            if (isAvoidDangerous) {
                console.log(`🔍 [Pass 1] Analyzing initial ${result.routes.length} routes...`);
                let analysis = this.analyzeRoutes(result);
                selectedRouteIndex = analysis.bestRouteIndex;
                let maxScore = analysis.maxScore;

                if (analysis.hasDangerousSteps) {
                    if (analysis.anyRouteWithoutDanger) {
                        // A Pass-1 alternative that Google already offered has zero
                        // dangerous steps — no need to spend extra Directions API
                        // calls forcing a detour via artificial waypoints.
                        console.log('✅ [Pass 2] Skipped — a Pass-1 alternative with zero dangerous steps already exists among the initial candidates.');
                    } else {
                        console.log('⚠️ Dangerous segments detected in every initial candidate. Attempting to find a safer detour...');

                        // Place detour waypoints at the midpoint of the DANGEROUS STEP
                        // itself (not the whole-journey midpoint) — a journey-midpoint
                        // detour is useless when the dangerous segment sits near an
                        // endpoint, since the perpendicular offset lands nowhere near it.
                        const dangerousStep = analysis.dangerousStep;
                        const stepPath = dangerousStep.path;
                        const stepMidpoint = (stepPath && stepPath.length > 0)
                            ? stepPath[Math.floor(stepPath.length / 2)]
                            : google.maps.geometry.spherical.interpolate(dangerousStep.start_location, dangerousStep.end_location, 0.5);

                        // Local heading of the dangerous step (start -> end), not the overall journey heading
                        const stepHeading = google.maps.geometry.spherical.computeHeading(
                            dangerousStep.start_location, dangerousStep.end_location
                        );

                        console.log(`📐 Dangerous step heading: ${stepHeading.toFixed(0)}°, placing waypoints perpendicular at its midpoint`);

                        // Try multiple detour distances perpendicular to the dangerous step's local direction
                        const detourDistances = [500, 1000];

                        try {
                            const detourPromises = [];
                            const detourLabels = [];
                            for (const dist of detourDistances) {
                                // Offset perpendicular to the step's local heading (left = heading-90, right = heading+90)
                                const dLeft = google.maps.geometry.spherical.computeOffset(stepMidpoint, dist, stepHeading - 90);
                                const dRight = google.maps.geometry.spherical.computeOffset(stepMidpoint, dist, stepHeading + 90);
                                detourPromises.push(
                                    this.calculateRoute({ ...request, waypoints: [{ location: dLeft, stopover: false }], provideRouteAlternatives: true }).catch(e => null),
                                    this.calculateRoute({ ...request, waypoints: [{ location: dRight, stopover: false }], provideRouteAlternatives: true }).catch(e => null)
                                );
                                detourLabels.push(`Detour Left ${dist}m`, `Detour Right ${dist}m`);
                            }
                            const detourResults = await Promise.all(detourPromises);

                            let allResults = [];
                            allResults.push({ name: 'Original', result: result, analysis: analysis });
                            detourResults.forEach((res, i) => {
                                if (res) {
                                    // Same shortestDistance (meters, caps candidate validity) AND
                                    // shortestKm (keeps the length-penalty term comparable across
                                    // Pass 1 and every Pass 2 detour analysis) as Pass 1 used.
                                    const dAnalysis = this.analyzeRoutes(res, analysis.shortestDistance, analysis.shortestKm);
                                    console.log(`[Pass 2: ${detourLabels[i]}] Found ${res.routes.length} routes. Max score: ${dAnalysis.maxScore.toFixed(2)}`);
                                    allResults.push({ name: detourLabels[i], result: res, analysis: dAnalysis });
                                }
                            });

                            let bestDetourScore = maxScore;
                            allResults.forEach(resItem => {
                                if (resItem.analysis.maxScore > bestDetourScore) {
                                    bestDetourScore = resItem.analysis.maxScore;
                                    finalResult = resItem.result;
                                    selectedRouteIndex = resItem.analysis.bestRouteIndex;
                                    maxScore = bestDetourScore;
                                    console.log(`👉 Better route found via ${resItem.name} pass (Score: ${bestDetourScore.toFixed(2)})`);
                                }
                            });
                        } catch (detourError) {
                            console.error("Detour attempts failed, falling back to original", detourError);
                        }
                    }
                }

                console.log(`✅ Final Selected Route ${selectedRouteIndex + 1} with score ${maxScore}`);

                this.directionsRenderer.setOptions({
                    polylineOptions: {
                        strokeColor: '#00FF00', // Bright Safety Green
                        strokeWeight: 8,
                        strokeOpacity: 1.0,
                        zIndex: 100
                    }
                });
            } else {
                selectedRouteIndex = 0;
                finalResult = result;
                this.directionsRenderer.setOptions({
                    polylineOptions: {
                        strokeColor: '#4285f4', // Default Blue
                        strokeWeight: 6,
                        strokeOpacity: 0.8,
                        zIndex: 1
                    }
                });
            }

            // Set the safest/best route index
            this.directionsRenderer.setRouteIndex(selectedRouteIndex);
            this.directionsRenderer.setDirections(finalResult);

            // Notify YoubikeLayer if it exists
            if (this.youbikeLayer) {
                const safestRoute = finalResult.routes[selectedRouteIndex];
                if (safestRoute && safestRoute.overview_path) {
                    this.youbikeLayer.setRoutePath(safestRoute.overview_path);
                }
            }

            // Auto-switch back to the Map tab on success
            const navItems = document.querySelectorAll('.nav-item');
            const viewPanes = document.querySelectorAll('.view-pane');

            navItems.forEach(nav => nav.classList.remove('active'));
            viewPanes.forEach(pane => pane.classList.remove('active'));

            if (navItems[0]) navItems[0].classList.add('active');
            if (document.getElementById('view-map')) document.getElementById('view-map').classList.add('active');

            // Optional: Get distance and duration of the selected route
            const routeLeg = finalResult.routes[selectedRouteIndex].legs[0];
            console.log(`📏 Distance: ${routeLeg.distance.text}, ⏱️ Duration: ${routeLeg.duration.text}`);

            // ✅ Store last route for post-ride feedback
            this.lastRoute = finalResult.routes[selectedRouteIndex];
            this.lastFinalResult = finalResult;
            console.log('📌 Last route stored for feedback');

            // 友善等級 + 四項統計：只針對「最終選定」的這一條路線計算與渲染
            // (origin/destination here are the post-YouBike-snap values actually routed)
            const headerText = this._arrivalRoadName(this.lastRoute)
                || this._trimAddress(routeLeg.end_address)
                || destination;
            this._renderFriendlinessStats(this.lastRoute, origin, destination, headerText);

            // Show start navigation button
            const navBtn = document.getElementById('start-navigation-btn');
            if (navBtn) navBtn.style.display = 'flex';

        } catch (error) {
            console.error('❌ Direction request failed due to ' + error);
            alert('Could not find a route. Please check the addresses and try again.\nError: ' + error.message);
        } finally {
            hideLoadingSpinner();
        }
    }

    /**
     * YouBike mode: resolve origin/destination to coordinates, then replace each with the
     * nearest usable station (start needs bikes, end needs open docks).
     * @returns {Promise<{origin:string, destination:string}|null>} station "lat,lng" strings,
     *          or null if it couldn't snap (an alert was shown; caller uses the original points).
     */
    async _snapToYoubikeStations(origin, destination) {
        if (!this.youbikeLayer || !this.youbikeLayer.allStations || this.youbikeLayer.allStations.length === 0) {
            alert('YouBike 站點資料尚未載入，將使用一般路線。');
            return null;
        }

        let originLatLng, destLatLng;
        try {
            [originLatLng, destLatLng] = await Promise.all([
                this._resolveToLatLng(origin),
                this._resolveToLatLng(destination)
            ]);
        } catch (e) {
            console.warn('YouBike mode: could not resolve start/end to coordinates', e);
            alert('無法定位起點或終點，將使用一般路線。');
            return null;
        }

        const startStation = this.youbikeLayer.findNearestStation(originLatLng, 'rent');
        const endStation = this.youbikeLayer.findNearestStation(destLatLng, 'return');

        if (!startStation || !endStation) {
            alert('附近找不到可借/可還的 YouBike 站點，將使用一般路線。');
            return null;
        }

        const startName = (startStation.station.sna || '').replace('YouBike2.0_', '');
        const endName = (endStation.station.sna || '').replace('YouBike2.0_', '');
        console.log(`🚲 YouBike mode: ${startName} (可借 ${startStation.station.available_rent_bikes}) → ${endName} (可還 ${endStation.station.available_return_bikes})`);

        return {
            origin: `${startStation.lat},${startStation.lng}`,
            destination: `${endStation.lat},${endStation.lng}`
        };
    }

    /**
     * Resolve a "lat, lng" string or an address into a google.maps.LatLng.
     * @returns {Promise<google.maps.LatLng>}
     */
    _resolveToLatLng(text) {
        const raw = (text || '').trim();
        const coordMatch = raw.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
        if (coordMatch) {
            const lat = parseFloat(coordMatch[1]);
            const lng = parseFloat(coordMatch[2]);
            if (!isNaN(lat) && !isNaN(lng)) {
                return Promise.resolve(new google.maps.LatLng(lat, lng));
            }
        }
        return new Promise((resolve, reject) => {
            this.geocoder.geocode({ address: raw }, (results, status) => {
                if (status === 'OK' && results[0]) {
                    resolve(results[0].geometry.location);
                } else {
                    reject(new Error('Geocode failed: ' + status));
                }
            });
        });
    }

    /**
     * Analyze a DirectionsResult to find the best route and identify dangerous steps.
     * Selection score per candidate = computeSelectionScore(overall, routeKm, shortestKm),
     * where `overall` is the SAME weighted-mean-of-four-bars math as the display grade
     * (computeOverallGrade) but with 交通環境風險 computed WITHOUT the traffic term
     * (computeSelectionRisk) since traffic can't differentiate candidates for the same
     * O/D pair. `shortestKm` is the min routeKm across the candidates being compared in
     * THIS call (or `globalShortestKm` when the caller wants penalties comparable across
     * multiple analyzeRoutes() calls — see planRoute's Pass 2 detour comparisons).
     * @param {Object} result - google.maps.DirectionsResult
     * @param {number|null} globalShortestDistance - meters; caps candidate validity (existing behavior)
     * @param {number|null} globalShortestKm - km; if provided, used instead of this call's own min
     */
    analyzeRoutes(result, globalShortestDistance = null, globalShortestKm = null) {
        let shortestDistance = Infinity;
        result.routes.forEach(route => {
            let totalDist = 0;
            route.legs.forEach(leg => totalDist += leg.distance.value);
            if (totalDist < shortestDistance) shortestDistance = totalDist;
        });

        const maxAllowedDistance = (globalShortestDistance || shortestDistance) * 1.5;

        let validRoutes = [];
        result.routes.forEach((route, index) => {
            let totalDist = 0;
            route.legs.forEach(leg => totalDist += leg.distance.value);
            if (totalDist <= maxAllowedDistance) {
                validRoutes.push({ route, index });
            }
        });

        if (validRoutes.length === 0) validRoutes = [{ route: result.routes[0], index: 0 }];

        // Gather rawStats + per-step dangerous flags for every candidate up front so
        // shortestKm and the "does a danger-free alternative already exist" check can
        // look across the whole comparison set, not just the eventual winner.
        validRoutes.forEach(item => {
            const evalResult = this.calculateRouteScore(item.route);
            item.rawStats = evalResult.rawStats;
            item.stepEvaluations = evalResult.stepEvaluations;
        });

        const shortestKm = (globalShortestKm != null)
            ? globalShortestKm
            : Math.min(...validRoutes.map(item => item.rawStats.routeKm));

        let maxScore = -Infinity;
        let bestRouteIndex = validRoutes[0].index;
        let bestRouteDangerousStep = null;

        validRoutes.forEach((item) => {
            const rs = item.rawStats;
            const accidentScore = computeAccidentScore(rs.matchedAccidents, rs.routeKm);
            const classIdx = computeClassIndex(rs.classIndexSteps);
            const junctionIdx = computeJunctionIndex(rs.maneuverCount, rs.routeKm);
            const riskScore = computeSelectionRisk(classIdx, junctionIdx);
            const infraScore = computeInfrastructureScore(rs.laneCoverageRatio, rs.youbikeAccessRatio, rs.hasYoubikeCoverage);
            const opinion = computeOpinionScore(rs.publicOpinionTotalScore, rs.publicOpinionStepCount);

            const scores = { accident: accidentScore, risk: riskScore, infrastructure: infraScore, opinion: opinion.score };
            // Selection-only weights (accident 0.60) — the display grade keeps its own.
            const grade = computeOverallGrade(scores, { opinion: opinion.hasData }, SELECTION_WEIGHTS);
            // Fatal-hotspot repellent: the heatmap's blue dots are 死亡-only;
            // repel routes from them explicitly so mass light-injury corridors
            // can't drown them out.
            const fatalCount = rs.matchedAccidents.filter(a => a && a.severity === '死亡').length;
            const fatalPenalty = computeFatalPenalty(fatalCount);
            const selectionScore = computeSelectionScore(grade.overall, rs.routeKm, shortestKm) - fatalPenalty;

            item.route.safetyScore = selectionScore;
            item.isDangerous = item.stepEvaluations.some(s => s.isDangerous);

            console.log(`  route ${item.index + 1}: overall=${grade.overall} km=${rs.routeKm.toFixed(2)} lenPenalty=${(grade.overall - fatalPenalty - selectionScore).toFixed(1)} fatals=${fatalCount} (-${fatalPenalty}) final=${selectionScore.toFixed(1)}`);

            if (selectionScore > maxScore) {
                maxScore = selectionScore;
                bestRouteIndex = item.index;

                const dangerousSteps = item.stepEvaluations.filter(s => s.isDangerous);
                bestRouteDangerousStep = dangerousSteps.length > 0 ? dangerousSteps[0].step : null;
            }
        });

        const anyRouteWithoutDanger = validRoutes.some(item => !item.isDangerous);

        return {
            bestRouteIndex,
            maxScore,
            shortestDistance,
            shortestKm,
            dangerousStep: bestRouteDangerousStep,
            hasDangerousSteps: bestRouteDangerousStep !== null,
            anyRouteWithoutDanger
        };
    }

    /**
     * Gather the raw per-step inputs (rawStats) that routeStats.js turns into
     * the four friendliness stats bars AND the selection score, plus a
     * per-step isDangerous flag list — but does NOT paint any UI itself and
     * does NOT compute a final score itself (analyzeRoutes does that, once
     * it has rawStats for every candidate and knows shortestKm across the
     * comparison set). This runs once per CANDIDATE route during route
     * selection; only _renderFriendlinessStats (called once, on the final
     * SELECTED route) is allowed to touch the DOM, so the bars never reflect
     * a losing candidate.
     * @param {Object} route - Google Maps DirectionRoute object
     * @returns {{stepEvaluations:Array<{step:Object, isDangerous:boolean}>, rawStats:Object}}
     */
    calculateRouteScore(route) {
        let stepEvaluations = [];
        let publicOpinionTotalScore = 0;
        let publicOpinionStepCount = 0;

        // Raw aggregates for the four friendliness stats (pure math lives in routeStats.js)
        let laneCoverageDistanceM = 0;
        let youbikeAccessDistanceM = 0;
        let totalDistanceM = 0;
        let maneuverCount = 0;
        // Accidents are matched per-step against a per-step polyline, so an
        // accident that sits near a step boundary can satisfy isLocationOnEdge
        // for more than one neighboring step. Dedupe via a Set of the actual
        // accident objects (shared references from accidentLayer.data) so a
        // route's 歷史事故 total isn't inflated by intersection double-counting.
        const matchedAccidentsSet = new Set();
        const classIndexSteps = [];

        const accidents = (this.accidentLayer && this.accidentLayer.data) ? this.accidentLayer.data : [];
        const bikeLanesPolys = (this.bikeLaneLayer && this.bikeLaneLayer.polylines) ? this.bikeLaneLayer.polylines : [];
        const stations = (this.youbikeLayer && this.youbikeLayer.allStations) ? this.youbikeLayer.allStations : [];
        const bounds = route.bounds;

        const relevantAccidents = accidents.filter(acc => bounds.contains(acc.position));

        route.legs.forEach(leg => {
            leg.steps.forEach((step) => {
                let isDangerous = false;

                const stepPath = step.path;
                let stepPolyline = new google.maps.Polyline({ path: stepPath });
                const stepDistM = step.distance ? step.distance.value : 0;
                totalDistanceM += stepDistM;

                // TIGHTENED bike-lane test (was tolerance 0.0005 / any-of-3 points):
                // tolerance 0.00025 (~25m) and require >=2 of the 3 sample points to
                // actually land on a lane.
                let hasBikeLane = false;
                if (bikeLanesPolys.length > 0) {
                    const samplePoints = [step.start_location, step.end_location];
                    const midIndex = Math.floor(stepPath.length / 2);
                    if (stepPath[midIndex]) samplePoints.push(stepPath[midIndex]);

                    hasBikeLane = bikeLanesPolys.some(poly => {
                        const hitCount = samplePoints.filter(pt =>
                            google.maps.geometry.poly.isLocationOnEdge(pt, poly, 0.00025)
                        ).length;
                        return hitCount >= 2;
                    });
                }
                if (hasBikeLane) {
                    laneCoverageDistanceM += stepDistM;
                }

                // 基礎設施: YouBike access — start or end point within 350m of any station
                if (stations.length > 0) {
                    const nearStart = this._isNearAnyStation(step.start_location, stations, 350);
                    const nearEnd = this._isNearAnyStation(step.end_location, stations, 350);
                    if (nearStart || nearEnd) {
                        youbikeAccessDistanceM += stepDistM;
                    }
                }

                // Per-step (undeduped) accident count/density still drives the
                // isDangerous flag: a step surrounded by a lot of accidents is
                // dangerous regardless of whether a neighboring step also
                // touches the same accident object. Only the aggregated
                // matchedAccidentsSet (used for scoring) needs dedup.
                let accidentCount = 0;
                relevantAccidents.forEach(acc => {
                    if (google.maps.geometry.poly.isLocationOnEdge(acc.position, stepPolyline, 0.0003)) {
                        accidentCount++;
                        matchedAccidentsSet.add(acc);
                    }
                });

                if (accidentCount > 0) {
                    const stepDistKm = (step.distance ? step.distance.value : 500) / 1000;
                    const density = accidentCount / Math.max(stepDistKm, 0.1); // accidents per km

                    // Mark as dangerous if high density (>30/km) or high raw count (>15)
                    if (density > 30 || accidentCount > 15) {
                        isDangerous = true;
                    }
                }

                // ========================================================
                // 民眾意見 (Public Opinion) — 路名 0-1 分數
                // 交通環境風險 — 路名 suffix (classIdx) + maneuver 計數 (junctionIdx)
                // ========================================================
                const roadName = parseRoadName(step.instructions);
                classIndexSteps.push({ roadName, distanceM: stepDistM });
                if (step.maneuver) {
                    maneuverCount++;
                }

                if (roadName) {
                    const rec = this._roadScores.get(roadName);
                    if (rec && rec.count > 0) {
                        const s = rec.sum / rec.count; // 0-1
                        if (s < 0.5) {
                            isDangerous = true;
                        }
                        publicOpinionTotalScore += s;     // 0-1，後面換算 bar
                        publicOpinionStepCount++;
                    }
                }

                stepEvaluations.push({ step, isDangerous });
            });
        });

        const rawStats = {
            routeKm: totalDistanceM / 1000,
            matchedAccidents: Array.from(matchedAccidentsSet),
            laneCoverageRatio: totalDistanceM > 0 ? laneCoverageDistanceM / totalDistanceM : 0,
            youbikeAccessRatio: totalDistanceM > 0 ? youbikeAccessDistanceM / totalDistanceM : 0,
            hasYoubikeCoverage: this._routeHasYoubikeCoverage(route, stations, 2000),
            classIndexSteps,
            maneuverCount,
            publicOpinionTotalScore,
            publicOpinionStepCount
        };

        return { stepEvaluations, rawStats };
    }

    /**
     * Whether `latLng` has any YouBike station within `radiusM`.
     * @param {google.maps.LatLng} latLng
     * @param {Array} stations - youbikeLayer.allStations entries
     * @param {number} radiusM
     * @returns {boolean}
     */
    _isNearAnyStation(latLng, stations, radiusM) {
        if (!latLng || !stations || stations.length === 0) return false;
        return stations.some(station => {
            const lat = parseFloat(station.latitude);
            const lng = parseFloat(station.longitude);
            if (isNaN(lat) || isNaN(lng)) return false;
            const dist = google.maps.geometry.spherical.computeDistanceBetween(
                latLng, new google.maps.LatLng(lat, lng)
            );
            return dist <= radiusM;
        });
    }

    /**
     * Out-of-coverage check for 基礎設施: is ANY station within `radiusM` of
     * ANY point along the route? Sampled along route.overview_path.
     * @param {Object} route - Google Maps DirectionRoute object
     * @param {Array} stations
     * @param {number} radiusM
     * @returns {boolean}
     */
    _routeHasYoubikeCoverage(route, stations, radiusM) {
        if (!stations || stations.length === 0) return false;
        const points = (route.overview_path && route.overview_path.length > 0) ? route.overview_path : [];
        if (points.length === 0) return false;
        return points.some(pt => this._isNearAnyStation(pt, stations, radiusM));
    }

    /**
     * Road name the route ARRIVES on (= the road the user clicked), parsed
     * from the last parsable step instruction. One road → one name, wherever
     * along it the user clicks; section suffixes are already stripped by
     * parseRoadName.
     */
    _arrivalRoadName(route) {
        if (!route || !route.legs || !route.legs.length) return null;
        const steps = route.legs[route.legs.length - 1].steps || [];
        for (let i = steps.length - 1; i >= 0; i--) {
            const name = parseRoadName(steps[i].instructions);
            if (name) return name;
        }
        return null;
    }

    /**
     * Fallback header: strip postal code / country / district prefix and the
     * trailing house number from a geocoded address so the label stays short
     * (e.g. "100台灣台北市中正區北平西路3號" → "北平西路").
     */
    _trimAddress(address) {
        if (!address) return null;
        let a = String(address);
        // Drop everything through the last 縣/市/區/鄉/鎮 that precedes more text.
        a = a.replace(/^.*[縣市區鄉鎮](?=.)/u, '');
        // Drop a trailing house number ("3號", "3-1號").
        a = a.replace(/[0-9０-９\-之]+號?$/u, '').trim();
        return a || String(address);
    }

    /**
     * Compute + paint the 友善等級 grade and the four stats bars for the ONE
     * route that was actually selected for display — never for a losing
     * candidate evaluated during route selection. Renders immediately using
     * the time-of-day trafficIdx fallback (routeStats.trafficIdxFallback),
     * then kicks off a single parallel DRIVING-mode Directions request; when
     * (if) it resolves, 交通環境風險 + 友善等級 are recomputed and repainted
     * (progressive update — this never blocks route planning).
     * @param {Object} route - the selected google.maps.DirectionsRoute
     * @param {string} origin - same origin used for the route request
     * @param {string} destination - same destination used for the route request
     * @param {string} headerText - human-readable destination label for .header
     */
    _renderFriendlinessStats(route, origin, destination, headerText) {
        if (typeof updateRouteHeader === 'function') {
            updateRouteHeader(headerText);
        }

        const evalResult = this.calculateRouteScore(route);
        const rs = evalResult.rawStats;

        const accidentScore = computeAccidentScore(rs.matchedAccidents, rs.routeKm);
        const infraScore = computeInfrastructureScore(rs.laneCoverageRatio, rs.youbikeAccessRatio, rs.hasYoubikeCoverage);
        const classIdx = computeClassIndex(rs.classIndexSteps);
        const junctionIdx = computeJunctionIndex(rs.maneuverCount, rs.routeKm);
        const opinion = computeOpinionScore(rs.publicOpinionTotalScore, rs.publicOpinionStepCount);

        const baseScores = { accident: accidentScore, infrastructure: infraScore, opinion: opinion.score };

        const fallbackTrafficIdx = trafficIdxFallback(new Date());
        const fallbackRisk = computeRiskScore(classIdx, junctionIdx, fallbackTrafficIdx);

        this._paintFriendlinessStats(Object.assign({}, baseScores, { risk: fallbackRisk }), opinion.hasData);

        // Progressive refine: exactly ONE parallel driving-mode request per route-planning action.
        this._refineTrafficRisk(origin, destination, classIdx, junctionIdx, baseScores, opinion.hasData);
    }

    /**
     * Paint the four bars + overall grade from a finished {accident, risk,
     * infrastructure, opinion} score set.
     */
    _paintFriendlinessStats(scores, opinionHasData) {
        const grade = computeOverallGrade(scores, opinionHasData);
        if (typeof updateFriendlinessBars === 'function') {
            updateFriendlinessBars(scores);
        }
        if (typeof updateFriendlinessGrade === 'function') {
            updateFriendlinessGrade(grade);
        }
    }

    /**
     * Fire a single parallel DRIVING-mode Directions request (with live
     * traffic) for the same origin/destination as the planned bike route,
     * purely to read its congestion ratio (duration_in_traffic / duration)
     * as a proxy for 交通環境風險's trafficIdx. On any failure (or if the
     * API doesn't return duration_in_traffic), the time-of-day fallback
     * already painted by _renderFriendlinessStats is left standing.
     * Implemented per Google Maps Directions API docs — not exercised
     * against a live key in this environment.
     */
    async _refineTrafficRisk(origin, destination, classIdx, junctionIdx, baseScores, opinionHasData) {
        try {
            const drivingResult = await this.calculateRoute({
                origin,
                destination,
                travelMode: google.maps.TravelMode.DRIVING,
                drivingOptions: {
                    departureTime: new Date(),
                    trafficModel: 'bestguess'
                }
            });

            const leg = drivingResult.routes[0].legs[0];
            if (!leg.duration_in_traffic || !leg.duration) return; // no live traffic data available

            const ratio = leg.duration_in_traffic.value / leg.duration.value;
            const trafficIdx = computeTrafficIndex(ratio);
            const risk = computeRiskScore(classIdx, junctionIdx, trafficIdx);

            console.log(`🚦 Live traffic ratio r=${ratio.toFixed(2)} → 交通環境風險 refined to ${risk}`);
            this._paintFriendlinessStats(Object.assign({}, baseScores, { risk }), opinionHasData);
        } catch (e) {
            console.warn('⚠️ Parallel driving-mode traffic request failed; keeping time-of-day fallback for 交通環境風險', e);
        }
    }

    /**
     * Helper to wrap callback-based direction service in a Promise
     */
    calculateRoute(request) {
        return new Promise((resolve, reject) => {
            this.directionsService.route(request, (result, status) => {
                if (status === google.maps.DirectionsStatus.OK) {
                    resolve(result);
                } else {
                    reject(new Error(status));
                }
            });
        });
    }

    /**
     * Clear the current route from the map
     */
    clearRoute() {
        // Trigger feedback modal if a route was planned
        if (this.lastRoute) {
            console.log('📋 Route exists, showing feedback modal...');
            if (typeof showFeedbackModal === 'function') {
                showFeedbackModal();
            }
        }

        this.directionsRenderer.setMap(null);
        this.directionsRenderer.setDirections({ routes: [] });

        if (this.youbikeLayer) {
            this.youbikeLayer.setRoutePath(null);
        }

        document.getElementById('start-point').value = '';
        document.getElementById('end-point').value = '';

        const navBtn = document.getElementById('start-navigation-btn');
        if (navBtn) navBtn.style.display = 'none';

        if (this.clickMarker) {
            this.clickMarker.setMap(null);
        }
        this.pendingDestination = null;

        if (this.originMarker) {
            this.originMarker.setMap(null);
        }
        this.originLatLng = null;

        console.log('🗑️ Route cleared');
    }

    /**
     * Road names of the just-finished route (for the feedback checklist).
     */
    getRouteRoadNames() {
        if (!this.lastRoute) return [];
        return extractRoadNames(this.lastRoute);
    }

    /**
     * Reload the road-score cache after votes are submitted; clear the route.
     */
    async refreshRoadScores() {
        await this._loadRoadScores();
        this.lastRoute = null;
        this.lastFinalResult = null;
    }
}
