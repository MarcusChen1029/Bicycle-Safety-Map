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
    console.log(`🛣️ Submitted ${entries.length} road votes`);
  }

  async getAll() {
    const now = Date.now();
    if (this._cache && (now - this._cacheTimestamp) < this._cacheTTL) {
      return this._cache;
    }
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
      console.log(`🛣️ Loaded ${map.size} road scores`);
    } catch (e) {
      console.error('❌ Failed to load road scores:', e);
    }
    return map;
  }

  async getScore(roadName) {
    const map = await this.getAll();
    const rec = map.get(roadName);
    if (!rec || rec.count <= 0) return null;
    return rec.sum / rec.count;
  }
}

const roadScoreDB = new RoadScoreDB();
