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

        // Pre-load Firebase opinions cache
        this._opinionsCache = null;
        this._loadOpinionsCache();

        console.log('✅ RoutePlanner initialized');
    }

    /**
     * Pre-load opinions from Firebase into local cache for scoring
     */
    async _loadOpinionsCache() {
        try {
            if (typeof feedbackDB !== 'undefined') {
                this._opinionsCache = await feedbackDB.getAllFeedback();
                console.log(`📊 Loaded ${this._opinionsCache.length} opinion entries for scoring`);
            }
        } catch (e) {
            console.warn('Could not pre-load opinions cache:', e);
            this._opinionsCache = [];
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
        let publicOpinionTotalScore = 0;
        let publicOpinionStepCount = 0;

        const accidents = (this.accidentLayer && this.accidentLayer.data) ? this.accidentLayer.data : [];
        const bikeLanesPolys = (this.bikeLaneLayer && this.bikeLaneLayer.polylines) ? this.bikeLaneLayer.polylines : [];
        const bounds = route.bounds;
        const opinions = this._opinionsCache || [];

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
                    if (google.maps.geometry.poly.isLocationOnEdge(acc.position, stepPolyline, 0.0003)) {
                        accidentCount++;
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
                // 民眾意見 (Public Opinion) Evaluation - Firebase data
                // ========================================================
                if (opinions.length > 0) {
                    // Find overlapping feedback for this step
                    const matchingOpinions = opinions.filter(entry => {
                        if (!entry.steps || entry.steps.length === 0) return false;
                        return entry.steps.some(savedStep => {
                            const savedLatLng = new google.maps.LatLng(savedStep.lat, savedStep.lng);
                            return google.maps.geometry.poly.isLocationOnEdge(savedLatLng, stepPolyline, 0.0005);
                        });
                    });

                    if (matchingOpinions.length > 0) {
                        // Calculate average score from safety + smoothness
                        let totalOpinionScore = 0;
                        matchingOpinions.forEach(op => {
                            const avg = ((op.safetyScore || 3) + (op.smoothnessScore || 3)) / 2;
                            totalOpinionScore += avg;
                        });
                        const averageScore = totalOpinionScore / matchingOpinions.length;
                        const sampleSize = matchingOpinions.length;

                        // Track for stats display
                        publicOpinionTotalScore += averageScore;
                        publicOpinionStepCount++;

                        // Apply penalty W formula: more reports = higher confidence = stronger penalty
                        // W = (3 - avg_score) * confidence_multiplier
                        // confidence grows with sample size using log scale, capped at 3x
                        if (averageScore < 3) {
                            const confidence = Math.min(Math.log2(sampleSize + 1), 3);
                            const W = (3 - averageScore) * confidence;
                            stepScore -= W;
                            reasons.push(`Public Opinion W=-${W.toFixed(2)} (avg:${averageScore.toFixed(1)}, n:${sampleSize}, conf:${confidence.toFixed(1)})`);
                        }

                        // Hidden danger zone: average < 2.5 → extra -2
                        if (averageScore < 2.5) {
                            stepScore -= 2;
                            isDangerous = true;
                            reasons.push(`Hidden Danger Zone (avg:${averageScore.toFixed(1)} < 2.5, -2)`);
                        }
                    }
                }

                console.log(`  - Step ${index + 1}: Score = ${stepScore.toFixed(2)} [${reasons.join(', ') || 'No points'}] | Dist: ${step.distance.text}`);

                stepEvaluations.push({ step, score: stepScore, reasons, accidentCount, isDangerous });
                totalScore += stepScore;
            });
        });

        // Update Public Opinion stats bar
        const opinionBarScore = this._computePublicOpinionBarScore(publicOpinionTotalScore, publicOpinionStepCount, opinions.length);
        if (typeof updatePublicOpinionStat === 'function') {
            updatePublicOpinionStat(opinionBarScore);
        }

        return { totalScore, stepEvaluations, publicOpinionScore: opinionBarScore };
    }

    /**
     * Compute the public opinion bar score (0-100 scale)
     * Default: 70 (B grade) if no data exists
     */
    _computePublicOpinionBarScore(totalScore, stepCount, totalOpinions) {
        if (totalOpinions === 0 || stepCount === 0) {
            return 70; // Default B-grade baseline
        }
        const avgStepScore = totalScore / stepCount; // 1-5 scale
        // Convert 1-5 scale to 0-100: ((score - 1) / 4) * 100
        return Math.round(((avgStepScore - 1) / 4) * 100);
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

        console.log('🗑️ Route cleared');
    }

    /**
     * Save user feedback to Firebase via FeedbackDB
     * Extracts key path segments from lastRoute and stores with ratings
     * @param {number} safetyScore - 1-5 star rating for safety
     * @param {number} smoothnessScore - 1-5 star rating for smoothness
     */
    async saveFeedbackToFirebase(safetyScore, smoothnessScore) {
        if (!this.lastRoute) {
            console.warn('No lastRoute to save feedback for');
            return;
        }

        // Extract key path points from each step for coordinate matching
        const steps = [];
        this.lastRoute.legs.forEach(leg => {
            leg.steps.forEach(step => {
                // Save start, end, and midpoint of each step
                steps.push({
                    lat: step.start_location.lat(),
                    lng: step.start_location.lng()
                });
                steps.push({
                    lat: step.end_location.lat(),
                    lng: step.end_location.lng()
                });
                // Add midpoint for better matching density
                const midIdx = Math.floor(step.path.length / 2);
                if (step.path[midIdx]) {
                    steps.push({
                        lat: step.path[midIdx].lat(),
                        lng: step.path[midIdx].lng()
                    });
                }
            });
        });

        // Build the overview path for broader matching
        const overviewPath = this.lastRoute.overview_path
            ? this.lastRoute.overview_path.map(p => ({ lat: p.lat(), lng: p.lng() }))
            : [];

        const feedbackData = {
            safetyScore: safetyScore,
            smoothnessScore: smoothnessScore,
            averageScore: (safetyScore + smoothnessScore) / 2,
            steps: steps,
            overviewPath: overviewPath,
            routeSummary: this.lastRoute.summary || '',
            distance: this.lastRoute.legs[0] ? this.lastRoute.legs[0].distance.text : '',
            duration: this.lastRoute.legs[0] ? this.lastRoute.legs[0].duration.text : ''
        };

        // Save to Firebase
        const docId = await feedbackDB.saveFeedback(feedbackData);

        // Refresh opinions cache for future scoring
        await this._loadOpinionsCache();

        // Clear lastRoute after saving
        this.lastRoute = null;
        this.lastFinalResult = null;

        return docId;
    }

    /**
     * Get the current public opinion score for the last planned route
     * Returns 70 (B-grade) if no data or no route
     */
    async getPublicOpinionScore() {
        if (!this.lastRoute) return 70;

        const opinions = this._opinionsCache || [];
        if (opinions.length === 0) return 70;

        let totalOpinionScore = 0;
        let matchedCount = 0;

        this.lastRoute.legs.forEach(leg => {
            leg.steps.forEach(step => {
                const stepPolyline = new google.maps.Polyline({ path: step.path });
                const matched = opinions.filter(entry => {
                    if (!entry.steps || entry.steps.length === 0) return false;
                    return entry.steps.some(savedStep => {
                        const savedLatLng = new google.maps.LatLng(savedStep.lat, savedStep.lng);
                        return google.maps.geometry.poly.isLocationOnEdge(savedLatLng, stepPolyline, 0.0005);
                    });
                });

                if (matched.length > 0) {
                    let stepAvg = 0;
                    matched.forEach(op => {
                        stepAvg += ((op.safetyScore || 3) + (op.smoothnessScore || 3)) / 2;
                    });
                    totalOpinionScore += stepAvg / matched.length;
                    matchedCount++;
                }
            });
        });

        return this._computePublicOpinionBarScore(totalOpinionScore, matchedCount, opinions.length);
    }
}
