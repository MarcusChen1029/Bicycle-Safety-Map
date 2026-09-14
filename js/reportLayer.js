/**
 * ReportLayer - shows user-submitted road issue reports as ⚠️ warning markers.
 *
 * Uses a Firestore real-time listener (onSnapshot) on the `reports` collection so that:
 *  - all existing reports load on startup (visible to everyone, persistent), and
 *  - newly submitted reports appear instantly without a page refresh (live).
 *
 * Depends on the global `db` (Firestore) from firebaseConfig.js and Google Maps.
 */
class ReportLayer {
    constructor(map, infoWindow) {
        this.map = map;
        this.infoWindow = infoWindow;
        this.markers = new Map(); // Firestore doc id -> google.maps.Marker
        this.unsubscribe = null;
        this.visible = true;
        this.maxReports = 300; // cap live listener to most-recent N reports

        window.addEventListener('langchange', () => {
            for (const marker of this.markers.values()) {
                marker.setTitle('⚠️ ' + ReportLayer.typeLabel(marker._reportData.type));
            }
        });
    }

    // Map stored report type codes to dictionary keys (same wording as the form).
    static TYPE_KEYS = {
        pothole: 'report.type.pothole',
        illegal_parking: 'report.type.illegalParking',
        obstacle: 'report.type.obstacle',
        faded_lines: 'report.type.fadedLines',
        accident: 'report.type.accident',
        other: 'report.type.other'
    };

    static typeLabel(type) {
        const key = ReportLayer.TYPE_KEYS[type];
        return I18N.t(key || 'report.typeFallback');
    }

    /**
     * Attach the real-time listener. Reconciles markers on every snapshot:
     * added/modified docs create or move a marker; removed docs drop theirs.
     */
    listen() {
        if (typeof db === 'undefined') {
            console.warn('⚠️ ReportLayer: Firestore (db) not available, skipping');
            return;
        }

        // Cap the live listener to the most recent reports so reads stay bounded
        // no matter how large the collection grows (cost = limit, not whole collection).
        this.unsubscribe = db.collection('reports')
            .orderBy('timestamp', 'desc')
            .limit(this.maxReports)
            .onSnapshot(
            snapshot => {
                snapshot.docChanges().forEach(change => {
                    const id = change.doc.id;
                    const data = change.doc.data();

                    if (change.type === 'removed') {
                        this._removeMarker(id);
                        return;
                    }

                    // Skip reports without usable coordinates.
                    if (typeof data.lat !== 'number' || typeof data.lng !== 'number') {
                        return;
                    }

                    if (this.markers.has(id)) {
                        // Modified: update position (and refresh stored data for the InfoWindow).
                        const marker = this.markers.get(id);
                        marker.setPosition({ lat: data.lat, lng: data.lng });
                        marker._reportData = data;
                    } else {
                        this._createMarker(id, data);
                    }
                });
                console.log(`⚠️ ReportLayer: ${this.markers.size} warning marker(s) on map`);
            },
            error => {
                console.error('❌ ReportLayer listener failed:', error);
            }
        );
    }

    _createMarker(id, report) {
        const marker = new google.maps.Marker({
            position: { lat: report.lat, lng: report.lng },
            map: this.visible ? this.map : null,
            title: '⚠️ ' + ReportLayer.typeLabel(report.type),
            label: {
                text: '⚠️',
                fontSize: '20px'
            },
            // Transparent base icon so only the emoji label shows.
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 12,
                fillOpacity: 0,
                strokeOpacity: 0
            },
            zIndex: 500
        });
        marker._reportData = report;

        marker.addListener('click', () => {
            this.infoWindow.setContent(this._createInfoWindowContent(marker._reportData));
            this.infoWindow.open({ anchor: marker, map: this.map });
        });

        this.markers.set(id, marker);
    }

    _removeMarker(id) {
        const marker = this.markers.get(id);
        if (marker) {
            marker.setMap(null);
            this.markers.delete(id);
        }
    }

    _createInfoWindowContent(report) {
        const label = ReportLayer.typeLabel(report.type);
        const desc = report.description ? this._escapeHtml(report.description) : I18N.t('report.noDescription');
        const place = report.address || report.location || '';
        let dateStr = '';
        if (report.timestamp && typeof report.timestamp.toDate === 'function') {
            dateStr = report.timestamp.toDate().toLocaleString(I18N.getLang() === 'en' ? 'en-US' : 'zh-TW');
        }

        return `
      <div style="padding: 4px; max-width: 220px; font-family: sans-serif;">
        <h4 style="color: #dc3545; margin: 0 0 6px 0; font-size: 15px;">⚠️ ${label}</h4>
        <p style="margin: 2px 0; font-size: 13px;">${desc}</p>
        ${place ? `<p style="margin: 4px 0 2px 0; font-size: 12px; color: #666;">📍 ${this._escapeHtml(place)}</p>` : ''}
        ${dateStr ? `<p style="margin: 2px 0; font-size: 11px; color: #888;">${dateStr}</p>` : ''}
      </div>
    `;
    }

    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    toggle() {
        this.visible = !this.visible;
        for (const marker of this.markers.values()) {
            marker.setMap(this.visible ? this.map : null);
        }
        console.log(`ReportLayer visibility: ${this.visible}`);
    }
}
