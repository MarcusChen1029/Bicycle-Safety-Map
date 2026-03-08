class RoutePlanner {
    constructor(map, accidentLayer, youbikeLayer, bikeLaneLayer) {
        this.map = map;
        this.accidentLayer = accidentLayer;
        this.youbikeLayer = youbikeLayer;
        this.bikeLaneLayer = bikeLaneLayer;
        this.directionsService = new google.maps.DirectionsService();
        this.directionsRenderer = new google.maps.DirectionsRenderer({
            map: this.map,
            // Custom styling for the route line if needed, can use config values
            // Start with default, will be overridden by safety style
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

        console.log('✅ RoutePlanner initialized');
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
                    const badStep = analysis.dangerousStep;
                    const A = badStep.start_location;
                    const B = badStep.end_location;

                    const midpoint = new google.maps.LatLng(
                        (A.lat() + B.lat()) / 2,
                        (A.lng() + B.lng()) / 2
                    );

                    const heading = google.maps.geometry.spherical.computeHeading(A, B);
                    // Create waypoints 200 meters to the left and right of the dangerous segment's midpoint
                    const detourLeft = google.maps.geometry.spherical.computeOffset(midpoint, 200, heading - 90);
                    const detourRight = google.maps.geometry.spherical.computeOffset(midpoint, 200, heading + 90);

                    const requestLeft = { ...request, waypoints: [{ location: detourLeft, stopover: false }], provideRouteAlternatives: true };
                    const requestRight = { ...request, waypoints: [{ location: detourRight, stopover: false }], provideRouteAlternatives: true };

                    try {
                        const [resLeft, resRight] = await Promise.all([
                            this.calculateRoute(requestLeft).catch(e => null),
                            this.calculateRoute(requestRight).catch(e => null)
                        ]);

                        let allResults = [];
                        allResults.push({ name: 'Original', result: result, analysis: analysis });
                        if (resLeft) {
                            const lAnalysis = this.analyzeRoutes(resLeft, analysis.shortestDistance);
                            console.log(`[Pass 2: Left Detour] Found ${resLeft.routes.length} routes. Max score: ${lAnalysis.maxScore}`);
                            allResults.push({ name: 'Detour Left', result: resLeft, analysis: lAnalysis });
                        }
                        if (resRight) {
                            const rAnalysis = this.analyzeRoutes(resRight, analysis.shortestDistance);
                            console.log(`[Pass 2: Right Detour] Found ${resRight.routes.length} routes. Max score: ${rAnalysis.maxScore}`);
                            allResults.push({ name: 'Detour Right', result: resRight, analysis: rAnalysis });
                        }

                        let bestDetourScore = maxScore;
                        allResults.forEach(resItem => {
                            if (resItem.analysis.maxScore > bestDetourScore) {
                                bestDetourScore = resItem.analysis.maxScore;
                                finalResult = resItem.result;
                                selectedRouteIndex = resItem.analysis.bestRouteIndex;
                                maxScore = bestDetourScore;
                                console.log(`👉 Better route found via ${resItem.name} pass (Score: ${bestDetourScore})`);
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

            // Inform user about the safety choice
            // You might want to update a UI element here instead of alert/log
            // alert(`Selected safest route (Risk: ${minRiskScore})`);

        } catch (error) {
            console.error('❌ Direction request failed due to ' + error);
            alert('Could not find a route. Please check the addresses and try again.\nError: ' + error.message);
        }
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
     * Calculate safety score for a given route based on segment analysis
     * @param {Object} route - Google Maps DirectionRoute object
     * @param {boolean} isShortest - Whether this route is the shortest among alternatives
     * @returns {number} Safety score
     */
    calculateRouteScore(route, isShortest) {
        let totalScore = 0;
        let stepEvaluations = [];

        const accidents = (this.accidentLayer && this.accidentLayer.data) ? this.accidentLayer.data : [];
        const bikeLanesPolys = (this.bikeLaneLayer && this.bikeLaneLayer.polylines) ? this.bikeLaneLayer.polylines : [];
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

                let hasBikeLane = false;
                if (bikeLanesPolys.length > 0) {
                    const samplePoints = [step.start_location, step.end_location];
                    const midIndex = Math.floor(stepPath.length / 2);
                    if (stepPath[midIndex]) samplePoints.push(stepPath[midIndex]);

                    hasBikeLane = bikeLanesPolys.some(poly => {
                        return samplePoints.some(pt => google.maps.geometry.poly.isLocationOnEdge(pt, poly, 0.0005));
                    });
                }
                if (hasBikeLane) {
                    stepScore += 1;
                    reasons.push('Bike lane (+1)');
                }

                let accidentCount = 0;
                relevantAccidents.forEach(acc => {
                    if (google.maps.geometry.poly.isLocationOnEdge(acc.position, stepPolyline, 0.0003)) { // ~30m tolerance
                        accidentCount++;
                    }
                });

                if (accidentCount > 50) {
                    stepScore -= 2;
                    reasons.push(`Accidents x${accidentCount} (-2)`);
                    isDangerous = true;
                } else if (accidentCount > 30) {
                    stepScore -= 1;
                    reasons.push(`Accidents x${accidentCount} (-1)`);
                    isDangerous = true;
                }

                console.log(`  - Step ${index + 1}: Score = ${stepScore} [${reasons.join(', ') || 'No points'}] | Dist: ${step.distance.text}`);

                stepEvaluations.push({ step, score: stepScore, reasons, accidentCount, isDangerous });
                totalScore += stepScore;
            });
        });

        return { totalScore, stepEvaluations };
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
        this.directionsRenderer.setMap(null); // Remove from map
        // Re-bind to map to be ready for next route, or just setMap(null) creates a detached renderer, 
        // usually safer to just setDirections({routes: []}) or re-instantiate, or setMap(map) again when needed.
        // Standard way to clear is setDirections to null, but DirectionsRenderer behavior varies.
        // Simplest:
        this.directionsRenderer.setDirections({ routes: [] });

        if (this.youbikeLayer) {
            this.youbikeLayer.setRoutePath(null); // Clear active route
        }

        // Also clear inputs?
        document.getElementById('start-point').value = '';
        document.getElementById('end-point').value = '';

        console.log('🗑️ Route cleared');
    }
}
