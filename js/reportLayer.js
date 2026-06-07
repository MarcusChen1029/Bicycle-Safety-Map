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
    }

    // Map stored report type codes to their Chinese labels (same wording as the form).
    static TYPE_LABELS = {
        pothole: '路面坑洞',
        illegal_parking: '違規停車',
        obstacle: '道路障礙物',
        faded_lines: '標線模糊或毀損',
        accident: '事故發生',
        other: '其他'
    };

    /**
     * Attach the real-time listener. Reconciles markers on every snapshot:
     * added/modified docs create or move a marker; removed docs drop theirs.
     */
    listen() {
        if (typeof db === 'undefined') {
            console.warn('⚠️ ReportLayer: Firestore (db) not available, skipping');
            return;
        }

        this.unsubscribe = db.collection('reports').onSnapshot(
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
            title: '⚠️ ' + (ReportLayer.TYPE_LABELS[report.type] || '回報問題'),
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
        const label = ReportLayer.TYPE_LABELS[report.type] || '回報問題';
        const desc = report.description ? this._escapeHtml(report.description) : '（無描述）';
        const place = report.address || report.location || '';
        let dateStr = '';
        if (report.timestamp && typeof report.timestamp.toDate === 'function') {
            dateStr = report.timestamp.toDate().toLocaleString('zh-TW');
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
