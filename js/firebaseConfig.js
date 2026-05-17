/**
 * Firebase Configuration & Initialization
 * Provides Firestore database for bike_map_opinions collection
 */
const firebaseConfig = {
    apiKey: "AIzaSyARsnFTWt2MSbQc2mL8_5iIXqIoPcg2f70",
    authDomain: "mapcomment-8f128.firebaseapp.com",
    projectId: "mapcomment-8f128",
    storageBucket: "mapcomment-8f128.firebasestorage.app",
    messagingSenderId: "1012223256937",
    appId: "1:1012223256937:web:7cf6c868297622b4fe35f8",
    measurementId: "G-ZXNV4VL9D2"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

console.log('🔥 Firebase initialized');

/**
 * FeedbackDB - Firebase Firestore wrapper for bike_map_opinions
 * Replaces localStorage with cloud-based persistence
 */
class FeedbackDB {
    constructor() {
        this.collection = db.collection('bike_map_opinions');
        this._cache = null;
        this._cacheTimestamp = 0;
        this._cacheTTL = 30000; // 30 second cache
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
        // Use cache if fresh
        const now = Date.now();
        if (this._cache && (now - this._cacheTimestamp) < this._cacheTTL) {
            return this._cache;
        }

        try {
            const snapshot = await this.collection
                .orderBy('createdAt', 'desc')
                .get();

            const data = [];
            snapshot.forEach(doc => {
                data.push({ id: doc.id, ...doc.data() });
            });

            // Update cache
            this._cache = data;
            this._cacheTimestamp = now;

            console.log(`📊 Loaded ${data.length} feedback entries from Firebase`);
            return data;
        } catch (error) {
            console.error('❌ Failed to load feedback from Firebase:', error);
            // Fallback: read from localStorage
            return this._loadFromLocalStorage();
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

            for (const entry of offlineEntries) {
                delete entry._offlineEntry;
                await this.collection.add({
                    ...entry,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                    _syncedFromOffline: true
                });
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

// Try to sync offline entries when page loads
feedbackDB.syncOfflineEntries();
