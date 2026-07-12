const ROAD_OPINION_K = 1; // 路名民眾分數權重（可微調）

class RoutePlanner {
    constructor(map, accidentLayer, youbikeLayer, bikeLaneLayer) {
        this.map = map;
        this.accidentLayer = accidentLayer;
        this.youbikeLayer = youbikeLayer;
        this.bikeLaneLayer = bikeLaneLayer;
        this.directionsService = new google.maps.DirectionsService();
        this.directionsRenderer = new google.maps.DirectionsRenderer({
            map: this.map,
            polylineOptions: {
                strokeColor: '#4285f4',
                strokeWeight: 6,
                strokeOpacity: 0.8
            }
        });

        this.geocoder = new google.maps.Geocoder();
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
     * Set the destination input from a LatLng object (e.g. map click)
     * @param {google.maps.LatLng} latLng 
     */
    setDestination(latLng) {
        // Reverse geocode to get address
        this.geocoder.geocode({ location: latLng }, (results, status) => {
            if (status === 'OK' && results[0]) {
                const address = results[0].formatted_address;
                const input = document.getElementById('end-point');
                if (input) {
                    input.value = address;
                    // Trigger input event if any listeners are watching
                    input.dispatchEvent(new Event('input'));
                }
                console.log(`📍 Destination set to: ${address}`);
            } else {
                console.warn('Geocoder failed due to: ' + status);
                // Fallback to coordinates if address fails
                const input = document.getElementById('end-point');
                if (input) {
                    input.value = `${latLng.lat().toFixed(5)}, ${latLng.lng().toFixed(5)}`;
                }
            }
        });
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
                    console.log('⚠️ Dangerous segments detected in the best initial route. Attempting to find a safer detour...');

                    // Use the route's actual origin & destination to calculate waypoint
                    // This avoids loops caused by placing waypoints near dangerous steps close to start/end
                    const bestRoute = result.routes[analysis.bestRouteIndex];
                    const routeOrigin = bestRoute.legs[0].start_location;
                    const routeDestination = bestRoute.legs[bestRoute.legs.length - 1].end_location;

                    // Midpoint of the overall journey (not the dangerous step)
                    const routeMidpoint = new google.maps.LatLng(
                        (routeOrigin.lat() + routeDestination.lat()) / 2,
                        (routeOrigin.lng() + routeDestination.lng()) / 2
                    );

                    // Direction from origin to destination
                    const routeHeading = google.maps.geometry.spherical.computeHeading(routeOrigin, routeDestination);

                    console.log(`📐 Route heading: ${routeHeading.toFixed(0)}°, placing waypoints perpendicular at route midpoint`);

                    // Try multiple detour distances perpendicular to overall travel direction
                    const detourDistances = [500, 1000];

                    try {
                        const detourPromises = [];
                        const detourLabels = [];
                        for (const dist of detourDistances) {
                            // Offset perpendicular to the travel direction (left = heading-90, right = heading+90)
                            const dLeft = google.maps.geometry.spherical.computeOffset(routeMidpoint, dist, routeHeading - 90);
                            const dRight = google.maps.geometry.spherical.computeOffset(routeMidpoint, dist, routeHeading + 90);
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
                                const dAnalysis = this.analyzeRoutes(res, analysis.shortestDistance);
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
     * Analyze a DirectionsResult to find the best route and identify dangerous steps
     */
    analyzeRoutes(result, globalShortestDistance = null) {
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
                validRoutes.push({ route, index, isShortest: totalDist === shortestDistance });
            }
        });

        if (validRoutes.length === 0) validRoutes = [{ route: result.routes[0], index: 0, isShortest: true }];

        let maxScore = -Infinity;
        let bestRouteIndex = validRoutes[0].index;
        let bestRouteDangerousStep = null;

        validRoutes.forEach((item) => {
            const evalResult = this.calculateRouteScore(item.route, item.isShortest);
            item.route.safetyScore = evalResult.totalScore;

            if (evalResult.totalScore > maxScore) {
                maxScore = evalResult.totalScore;
                bestRouteIndex = item.index;

                const dangerousSteps = evalResult.stepEvaluations.filter(s => s.isDangerous);
                if (dangerousSteps.length > 0) {
                    bestRouteDangerousStep = dangerousSteps[0].step;
                } else {
                    bestRouteDangerousStep = null;
                }
            }
        });

        return {
            bestRouteIndex,
            maxScore,
            shortestDistance,
            dangerousStep: bestRouteDangerousStep,
            hasDangerousSteps: bestRouteDangerousStep !== null
        };
    }

    /**
     * Calculate safety score for a given route based on segment analysis.
     * Also gathers the raw per-step inputs (rawStats) that routeStats.js
     * turns into the four friendliness stats bars — but does NOT paint any
     * UI itself. This runs once per CANDIDATE route during route selection;
     * only _renderFriendlinessStats (called once, on the final SELECTED
     * route) is allowed to touch the DOM, so the bars never reflect a
     * losing candidate.
     * @param {Object} route - Google Maps DirectionRoute object
     * @param {boolean} isShortest - Whether this route is the shortest among alternatives
     * @returns {{totalScore:number, stepEvaluations:Array, rawStats:Object}}
     */
    calculateRouteScore(route, isShortest) {
        let totalScore = 0;
        let stepEvaluations = [];
        let publicOpinionTotalScore = 0;
        let publicOpinionStepCount = 0;

        // Raw aggregates for the four friendliness stats (pure math lives in routeStats.js)
        let laneCoverageDistanceM = 0;
        let youbikeAccessDistanceM = 0;
        let totalDistanceM = 0;
        let maneuverCount = 0;
        const matchedAccidents = [];
        const classIndexSteps = [];

        const accidents = (this.accidentLayer && this.accidentLayer.data) ? this.accidentLayer.data : [];
        const bikeLanesPolys = (this.bikeLaneLayer && this.bikeLaneLayer.polylines) ? this.bikeLaneLayer.polylines : [];
        const stations = (this.youbikeLayer && this.youbikeLayer.allStations) ? this.youbikeLayer.allStations : [];
        const bounds = route.bounds;

        const relevantAccidents = accidents.filter(acc => bounds.contains(acc.position));

        route.legs.forEach(leg => {
            leg.steps.forEach((step, index) => {
                let stepScore = 0;
                let reasons = [];
                let isDangerous = false;

                if (isShortest) {
                    stepScore += 1;
                    reasons.push('Shortest (+1)');
                }

                const stepPath = step.path;
                let stepPolyline = new google.maps.Polyline({ path: stepPath });
                const stepDistM = step.distance ? step.distance.value : 0;
                totalDistanceM += stepDistM;

                // TIGHTENED bike-lane test (was tolerance 0.0005 / any-of-3 points):
                // tolerance 0.00025 (~25m) and require >=2 of the 3 sample points to
                // actually land on a lane. This also tightens the existing "+1" step
                // bonus below — intended, see commit message.
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
                    stepScore += 1;
                    reasons.push('Bike lane (+1)');
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

                let accidentCount = 0;
                relevantAccidents.forEach(acc => {
                    if (google.maps.geometry.poly.isLocationOnEdge(acc.position, stepPolyline, 0.0003)) {
                        accidentCount++;
                        matchedAccidents.push(acc);
                    }
                });

                if (accidentCount > 0) {
                    // Scale penalty proportionally: every 15 accidents = -1 point
                    // Also factor in density (accidents per km) for fairness
                    const stepDistKm = (step.distance ? step.distance.value : 500) / 1000;
                    const density = accidentCount / Math.max(stepDistKm, 0.1); // accidents per km
                    const accidentPenalty = -(accidentCount / 15);
                    stepScore += accidentPenalty;
                    reasons.push(`Accidents x${accidentCount} (${accidentPenalty.toFixed(1)}, density:${density.toFixed(0)}/km)`);

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
                        const adj = roadScoreAdjustment(s, rec.count, ROAD_OPINION_K);
                        stepScore += adj;
                        reasons.push(`Road "${roadName}" ${s.toFixed(2)} (n:${rec.count}, ${adj >= 0 ? '+' : ''}${adj.toFixed(2)})`);
                        if (s < 0.5) {
                            isDangerous = true;
                        }
                        publicOpinionTotalScore += s;     // 0-1，後面換算 bar
                        publicOpinionStepCount++;
                    }
                }

                console.log(`  - Step ${index + 1}: Score = ${stepScore.toFixed(2)} [${reasons.join(', ') || 'No points'}] | Dist: ${step.distance.text}`);

                stepEvaluations.push({ step, score: stepScore, reasons, accidentCount, isDangerous });
                totalScore += stepScore;
            });
        });

        const rawStats = {
            routeKm: totalDistanceM / 1000,
            matchedAccidents,
            laneCoverageRatio: totalDistanceM > 0 ? laneCoverageDistanceM / totalDistanceM : 0,
            youbikeAccessRatio: totalDistanceM > 0 ? youbikeAccessDistanceM / totalDistanceM : 0,
            hasYoubikeCoverage: this._routeHasYoubikeCoverage(route, stations, 2000),
            classIndexSteps,
            maneuverCount,
            publicOpinionTotalScore,
            publicOpinionStepCount
        };

        return { totalScore, stepEvaluations, rawStats };
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

        const evalResult = this.calculateRouteScore(route, false);
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
