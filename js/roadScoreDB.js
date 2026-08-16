/**
 * RoadScoreDB - Firestore wrapper for per-road 0-1 ratings.
 * Collection: road_scores/{roadName} = { roadName, sum, count }
 * score = sum / count (computed on read).
 */
class RoadScoreDB {
  constructor() {
    this.collection = db.collection('road_scores');
    this._cache = null;            // Map<name, {sum,count}>
    this._cacheTimestamp = 0;
    this._cacheTTL = 30000;        // 30s in-memory cache

    // localStorage mirror of _cache so a fresh page load doesn't have to wait
    // on Firestore before the first route can be scored.
    this._storageKey = 'road_scores_cache_v1';
    this._persistTTL = 24 * 60 * 60 * 1000; // 1 day
  }

  // Firestore doc IDs cannot contain '/'.
  _docId(name) {
    return String(name).replace(/\//g, '_');
  }

  /**
   * @param {Record<string, 0|1>} votes  map of roadName -> 0|1
   */
  async submitVotes(votes) {
    const entries = Object.entries(votes || {});
    if (entries.length === 0) return;
    const batch = db.batch();
    entries.forEach(([name, vote]) => {
      const ref = this.collection.doc(this._docId(name));
      batch.set(ref, {
        roadName: name,
        sum: firebase.firestore.FieldValue.increment(vote ? 1 : 0),
        count: firebase.firestore.FieldValue.increment(1)
      }, { merge: true });
    });
    await batch.commit();
    this._cache = null; // invalidate
    try {
      localStorage.removeItem(this._storageKey);
    } catch (e) {
      // non-fatal
    }
    console.log(`🛣️ Submitted ${entries.length} road votes`);
  }

  async getAll() {
    const now = Date.now();
    if (this._cache && (now - this._cacheTimestamp) < this._cacheTTL) {
      return this._cache;
    }

    // Stale-while-revalidate: a persisted copy lets the very first getAll()
    // of a page load return instantly instead of blocking on Firestore.
    const persisted = this._loadPersisted();
    if (persisted) {
      this._cache = persisted.map;
      this._cacheTimestamp = now;
      if ((now - persisted.ts) < this._persistTTL) {
        return this._cache; // fresh enough — skip the Firestore round trip
      }
      this._refreshFromFirestore(now); // stale — refresh in the background
      return this._cache;
    }

    return this._refreshFromFirestore(now);
  }

  async _refreshFromFirestore(now) {
    const map = new Map();
    try {
      const snap = await this.collection.get();
      snap.forEach(doc => {
        const d = doc.data();
        map.set(d.roadName || doc.id, {
          sum: d.sum || 0,
          count: d.count || 0
        });
      });
      this._cache = map;
      this._cacheTimestamp = now;
      this._savePersisted(map, now);
      console.log(`🛣️ Loaded ${map.size} road scores`);
    } catch (e) {
      console.error('❌ Failed to load road scores:', e);
    }
    return this._cache || map;
  }

  _loadPersisted() {
    try {
      const raw = localStorage.getItem(this._storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return { map: new Map(parsed.entries), ts: parsed.ts };
    } catch (e) {
      return null;
    }
  }

  _savePersisted(map, ts) {
    try {
      localStorage.setItem(this._storageKey, JSON.stringify({ ts, entries: Array.from(map.entries()) }));
    } catch (e) {
      // Storage full/unavailable — non-fatal, in-memory cache still works.
    }
  }

  async getScore(roadName) {
    const map = await this.getAll();
    const rec = map.get(roadName);
    if (!rec || rec.count <= 0) return null;
    return rec.sum / rec.count;
  }
}

const roadScoreDB = new RoadScoreDB();
