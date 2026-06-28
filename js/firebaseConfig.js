/**
 * Firebase Configuration & Initialization
 * Provides Firestore database for bike_map_opinions collection
 */
const firebaseConfig = {
    apiKey: "AIzaSyCe3E6azBZ2NGXTnROpt1gsUKUtKuq6L1Q",
    authDomain: "bycyclesafetymap.firebaseapp.com",
    projectId: "bycyclesafetymap",
    storageBucket: "bycyclesafetymap.firebasestorage.app",
    messagingSenderId: "500061164582",
    appId: "1:500061164582:web:bdbe1e94220c0b0a5382e7",
    measurementId: "G-YVNK7BL60W"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

console.log('🔥 Firebase initialized');

/**
 * FeedbackDB - Firebase Firestore wrapper for bike_map_opinions
 * Replaces localStorage with cloud-based persistence
 */
// DEPRECATED: bike_map_opinions 民眾意見機制已由 road_scores 路名評分取代。
// 此類別暫留供歷史資料讀取，未連接至評分流程。
class FeedbackDB {
    constructor() {
        this.collection = db.collection('bike_map_opinions');
        this._cache = null;
        this._cacheTimestamp = 0;
        this._cacheTTL = 30000; // 30 second in-memory cache

        // Persistent (localStorage) read-cache for cross-reload incremental sync.
        // Returning visitors only fetch docs newer than _lastSync, instead of the
        // whole collection every load. Keeps Firestore reads ~O(new docs) per visit.
        this._persistKey = 'bike_map_opinions_cache';
        this._lastSync = null;           // max createdAt (ISO string) seen so far
        this._readLimit = 1000;          // hard cap on docs pulled in one query
    }

    /**
     * Save a feedback entry to Firestore
     * @param {Object} feedbackData - { steps[], safetyScore, smoothnessScore, timestamp, ... }
     * @returns {Promise<string>} Document ID
     */
    async saveFeedback(feedbackData) {
        try {
            const docRef = await this.collection.add({
                ...feedbackData,
                timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                createdAt: new Date().toISOString()
            });
            // Invalidate cache
            this._cache = null;
            console.log(`📝 Feedback saved to Firebase (ID: ${docRef.id})`);
            return docRef.id;
        } catch (error) {
            console.error('❌ Failed to save feedback to Firebase:', error);
            // Fallback: save to localStorage
            this._saveToLocalStorage(feedbackData);
            return null;
        }
    }

    /**
     * Get all feedback entries from Firestore
     * @returns {Promise<Array>} Array of feedback documents
     */
    async getAllFeedback() {
        // 1. Fresh in-memory cache → return immediately.
        const now = Date.now();
        if (this._cache && (now - this._cacheTimestamp) < this._cacheTTL) {
            return this._cache;
        }

        // 2. Seed from the persistent (localStorage) cache so we know how much we
        //    already have and only need to fetch what's newer.
        const persisted = this._loadPersistedCache();
        const byId = new Map(persisted.data.map(entry => [entry.id, entry]));
        this._lastSync = persisted.lastSync;

        try {
            // Incremental query: only docs created after our last sync. On the very
            // first visit (_lastSync null) this pulls the recent history, capped.
            let query = this.collection.orderBy('createdAt', 'desc').limit(this._readLimit);
            if (this._lastSync) {
                query = this.collection
                    .where('createdAt', '>', this._lastSync)
                    .orderBy('createdAt', 'desc')
                    .limit(this._readLimit);
            }

            const snapshot = await query.get();

            let newCount = 0;
            let maxCreatedAt = this._lastSync;
            snapshot.forEach(doc => {
                const entry = { id: doc.id, ...doc.data() };
                byId.set(entry.id, entry);
                newCount++;
                if (entry.createdAt && (!maxCreatedAt || entry.createdAt > maxCreatedAt)) {
                    maxCreatedAt = entry.createdAt;
                }
            });

            // Merge → sort newest first → bound the persisted size.
            let data = Array.from(byId.values())
                .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
                .slice(0, this._readLimit);

            this._lastSync = maxCreatedAt || this._lastSync;
            this._cache = data;
            this._cacheTimestamp = now;
            this._savePersistedCache(data, this._lastSync);

            console.log(`📊 Feedback: ${newCount} new from Firebase, ${data.length} total cached`);
            return data;
        } catch (error) {
            console.error('❌ Failed to load feedback from Firebase:', error);
            // Fallback: whatever we have persisted, else the offline-entry store.
            if (persisted.data.length > 0) return persisted.data;
            return this._loadFromLocalStorage();
        }
    }

    /**
     * Load the persistent read-cache from localStorage.
     * @returns {{ data: Array, lastSync: string|null }}
     */
    _loadPersistedCache() {
        try {
            const raw = localStorage.getItem(this._persistKey);
            if (!raw) return { data: [], lastSync: null };
            const parsed = JSON.parse(raw);
            return {
                data: Array.isArray(parsed.data) ? parsed.data : [],
                lastSync: parsed.lastSync || null
            };
        } catch (e) {
            return { data: [], lastSync: null };
        }
    }

    /**
     * Persist the merged read-cache. Guarded against quota errors (step arrays can be large).
     */
    _savePersistedCache(data, lastSync) {
        try {
            localStorage.setItem(this._persistKey, JSON.stringify({ data, lastSync }));
        } catch (e) {
            // QuotaExceededError etc. — keep working with the in-memory cache only.
            console.warn('Could not persist feedback cache (quota?), using memory cache only');
        }
    }

    /**
     * Get feedback entries matching specific route coordinates
     * Uses bounding box pre-filter then precise matching
     * @param {Array} stepPoints - Array of {lat, lng} points to match
     * @returns {Promise<Array>} Matching feedback entries
     */
    async getFeedbackForSteps(stepPoints) {
        const allFeedback = await this.getAllFeedback();
        return allFeedback.filter(entry => {
            if (!entry.steps || entry.steps.length === 0) return false;
            return entry.steps.some(savedStep => {
                return stepPoints.some(pt => {
                    const dist = this._haversineDistance(
                        pt.lat, pt.lng,
                        savedStep.lat, savedStep.lng
                    );
                    return dist < 50; // Within 50 meters
                });
            });
        });
    }

    /**
     * Haversine distance in meters between two lat/lng points
     */
    _haversineDistance(lat1, lng1, lat2, lng2) {
        const R = 6371000;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    /**
     * localStorage fallback - save
     */
    _saveToLocalStorage(feedbackData) {
        try {
            const existing = JSON.parse(localStorage.getItem('bike_map_opinions') || '[]');
            existing.push({
                ...feedbackData,
                createdAt: new Date().toISOString(),
                _offlineEntry: true
            });
            localStorage.setItem('bike_map_opinions', JSON.stringify(existing));
            console.log('💾 Feedback saved to localStorage (offline fallback)');
        } catch (e) {
            console.error('Failed to save to localStorage', e);
        }
    }

    /**
     * localStorage fallback - load
     */
    _loadFromLocalStorage() {
        try {
            return JSON.parse(localStorage.getItem('bike_map_opinions') || '[]');
        } catch (e) {
            console.error('Failed to load from localStorage', e);
            return [];
        }
    }

    /**
     * Sync any offline localStorage entries to Firebase
     * Call this when connection is restored
     */
    async syncOfflineEntries() {
        try {
            const offlineData = this._loadFromLocalStorage();
            const offlineEntries = offlineData.filter(e => e._offlineEntry);

            if (offlineEntries.length === 0) return;

            console.log(`🔄 Syncing ${offlineEntries.length} offline entries to Firebase...`);

            // Write in batched commits (max 500 ops/batch) instead of one round-trip per entry.
            for (let i = 0; i < offlineEntries.length; i += 500) {
                const chunk = offlineEntries.slice(i, i + 500);
                const batch = db.batch();
                chunk.forEach(entry => {
                    delete entry._offlineEntry;
                    batch.set(this.collection.doc(), {
                        ...entry,
                        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                        _syncedFromOffline: true
                    });
                });
                await batch.commit();
            }

            // Remove synced entries from localStorage
            const remaining = offlineData.filter(e => !e._offlineEntry);
            localStorage.setItem('bike_map_opinions', JSON.stringify(remaining));
            this._cache = null;

            console.log('✅ Offline sync complete');
        } catch (error) {
            console.error('❌ Offline sync failed:', error);
        }
    }
}

// Global instance
const feedbackDB = new FeedbackDB();
