class YoubikeLayer {
    constructor(map, infoWindow) {
        this.map = map;
        this.infoWindow = infoWindow;
        this.markers = new Map(); // Use Map to store marker instances by station id (sno)
        this.visible = true; // Default visible
        this.allStations = []; // Store all fetched data
        this.updateTimeout = null;

        // Listen to map movements to refresh visible stations, but debounce it
        this.map.addListener('idle', () => {
            if (this.visible && this.allStations.length > 0) {
                // Debounce to prevent too many updates during rapid movement
                if (this.updateTimeout) {
                    clearTimeout(this.updateTimeout);
                }
                this.updateTimeout = setTimeout(() => {
                    this.updateVisibleStations();
                }, 500); // 1000ms delay (1s)
            }
        });
    }

    async loadData() {
        try {
            console.log('Loading YouBike data...');
            const response = await fetch('https://tcgbusfs.blob.core.windows.net/dotapp/youbike/v2/youbike_immediate.json');
            this.allStations = await response.json();
            console.log(`Loaded ${this.allStations.length} YouBike stations`);

            if (this.visible) {
                this.updateVisibleStations();
            }
        } catch (error) {
            console.error('Failed to load YouBike data:', error);
        }
    }

    // Refresh stations based on current map center and an 8km radius (or 100m from route if routing)
    updateVisibleStations() {
        if (!this.map || this.allStations.length === 0) return;

        console.log('Updating YouBike visibility...');
        const center = this.map.getCenter();
        const radiusInMeters = 1000; // 1km default
        const routeRadiusInMeters = 100; // 100m when routing

        // Keep track of which stations are in range
        const inRangeStationIds = new Set();

        if (this.routePath && this.routePath.length > 0) {
            // When navigating, find the nearest 3 stations within 300m for both start and end
            const startPoint = this.routePath[0];
            const endPoint = this.routePath[this.routePath.length - 1];
            const maxRouteRadiusInMeters = 300;

            // Arrays to hold all stations with their distances
            const startStations = [];
            const endStations = [];

            this.allStations.forEach(station => {
                const lat = parseFloat(station.latitude);
                const lng = parseFloat(station.longitude);
                if (isNaN(lat) || isNaN(lng)) return;

                const stationLatLng = new google.maps.LatLng(lat, lng);
                const distToStart = google.maps.geometry.spherical.computeDistanceBetween(startPoint, stationLatLng);
                const distToEnd = google.maps.geometry.spherical.computeDistanceBetween(endPoint, stationLatLng);

                if (distToStart <= maxRouteRadiusInMeters) {
                    startStations.push({ station, lat, lng, distance: distToStart });
                }
                if (distToEnd <= maxRouteRadiusInMeters) {
                    endStations.push({ station, lat, lng, distance: distToEnd });
                }
            });

            // Sort by distance and take top 3
            startStations.sort((a, b) => a.distance - b.distance);
            endStations.sort((a, b) => a.distance - b.distance);

            const topStartStations = startStations.slice(0, 3);
            const topEndStations = endStations.slice(0, 3);

            // Combine and render
            const combined = [...topStartStations, ...topEndStations];
            combined.forEach(item => {
                inRangeStationIds.add(item.station.sno);

                // If marker doesn't exist, create it. If it exists, ensure it's on the map.
                if (!this.markers.has(item.station.sno)) {
                    this.createMarker(item.station, item.lat, item.lng);
                } else if (this.markers.get(item.station.sno).getMap() !== this.map) {
                    this.markers.get(item.station.sno).setMap(this.map);
                }
            });

        } else if (center) {
            // Fallback to center radius if no route
            this.allStations.forEach(station => {
                const lat = parseFloat(station.latitude);
                const lng = parseFloat(station.longitude);
                if (isNaN(lat) || isNaN(lng)) return;

                const stationLatLng = new google.maps.LatLng(lat, lng);
                const distance = google.maps.geometry.spherical.computeDistanceBetween(center, stationLatLng);
                if (distance <= radiusInMeters) {
                    inRangeStationIds.add(station.sno);

                    // If marker doesn't exist, create it. If it exists, ensure it's on the map.
                    if (!this.markers.has(station.sno)) {
                        this.createMarker(station, lat, lng);
                    } else if (this.markers.get(station.sno).getMap() !== this.map) {
                        this.markers.get(station.sno).setMap(this.map);
                    }
                }
            });
        }

        // Hide markers that are no longer in range
        for (const [sno, marker] of this.markers.entries()) {
            if (!inRangeStationIds.has(sno) && marker.getMap() !== null) {
                marker.setMap(null);
            }
        }
    }

    /**
     * Find the nearest station to a point, optionally filtered by real-time availability.
     * @param {google.maps.LatLng} latLng - Reference point.
     * @param {'rent'|'return'|'any'} type - 'rent' requires bikes available,
     *        'return' requires open docks, 'any' ignores availability.
     * @returns {{station:Object, lat:number, lng:number, distance:number}|null}
     */
    findNearestStation(latLng, type = 'any') {
        if (!this.allStations || this.allStations.length === 0 || !latLng) {
            return null;
        }

        let best = null;
        let bestDistance = Infinity;

        this.allStations.forEach(station => {
            const lat = parseFloat(station.latitude);
            const lng = parseFloat(station.longitude);
            if (isNaN(lat) || isNaN(lng)) return;

            // Availability filter
            if (type === 'rent' && !(station.available_rent_bikes > 0)) return;
            if (type === 'return' && !(station.available_return_bikes > 0)) return;

            const distance = google.maps.geometry.spherical.computeDistanceBetween(
                latLng,
                new google.maps.LatLng(lat, lng)
            );
            if (distance < bestDistance) {
                bestDistance = distance;
                best = { station, lat, lng, distance };
            }
        });

        return best;
    }

    setRoutePath(pathArray) {
        this.routePath = pathArray;
        if (this.visible) {
            this.updateVisibleStations();
        }
    }

    createMarker(station, lat, lng) {
        // Determine color based on availability
        let markerColor = '#F6A800'; // Default YouBike Orange

        if (station.available_rent_bikes === 0) {
            markerColor = '#d9534f'; // Red (no bikes)
        } else if (station.available_return_bikes === 0) {
            markerColor = '#808080'; // Gray (no return spots)
        }

        const marker = new google.maps.Marker({
            position: { lat: lat, lng: lng },
            map: this.map,
            title: station.sna,
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                fillColor: markerColor,
                fillOpacity: 0.9,
                strokeWeight: 1,
                strokeColor: '#FFFFFF',
                scale: 6
            }
        });

        marker.addListener('click', () => {
            this.infoWindow.setContent(this.createInfoWindowContent(station));
            this.infoWindow.open({
                anchor: marker,
                map: this.map,
            });
        });

        this.markers.set(station.sno, marker);
    }

    createInfoWindowContent(station) {
        return `
      <div style="padding: 4px; max-width: 200px; font-family: sans-serif;">
        <h4 style="color: #F6A800; margin: 0 0 6px 0; font-size: 15px;">🚲 ${station.sna.replace('YouBike2.0_', '')}</h4>
        <p style="margin: 2px 0; font-size: 13px;"><strong>可借：</strong><span style="font-size: 14px; color: #d9534f; font-weight: bold;">${station.available_rent_bikes}</span> &nbsp; <strong>可還：</strong><span style="font-size: 14px; color: #5cb85c; font-weight: bold;">${station.available_return_bikes}</span></p>
        <p style="margin: 2px 0; font-size: 11px; color: #888;">更新：${station.srcUpdateTime.substring(11)}</p>
      </div>
    `;
    }

    toggle() {
        this.visible = !this.visible;
        if (this.visible) {
            this.updateVisibleStations();
        } else {
            // Hide all markers
            for (const marker of this.markers.values()) {
                marker.setMap(null);
            }
        }
        console.log(`YouBike Layer visibility: ${this.visible}`);
    }
}
