/**
 * Road-name parsing helpers (pure). Browser global + Node-requirable.
 * One road name = one score; section suffix ("N段") is stripped.
 */

// Road-ending tokens used to recognize a street name.
const ROAD_SUFFIX = /(路|街|大道|大街|橋|公路|環|線|道)$/;
const SECTION_SUFFIX = /[一二三四五六七八九十0-9]+段$/;

function normalizeRoadName(name) {
  if (!name) return '';
  let n = String(name).replace(/\s+/g, '').trim();
  n = n.replace(SECTION_SUFFIX, '');
  return n;
}

function _looksLikeRoad(token) {
  return ROAD_SUFFIX.test(token) || SECTION_SUFFIX.test(token);
}

function parseRoadName(instructionsHtml) {
  if (!instructionsHtml) return null;
  const html = String(instructionsHtml);

  // 1. Prefer text inside <b>...</b> blocks (Google bolds the road name).
  const boldMatches = html.match(/<b>(.*?)<\/b>/g) || [];
  for (const raw of boldMatches) {
    const inner = raw.replace(/<\/?b>/g, '').replace(/<[^>]*>/g, '').trim();
    if (_looksLikeRoad(inner)) {
      const norm = normalizeRoadName(inner);
      if (norm) return norm;
    }
  }

  // 2. Fallback: strip all tags, find a Chinese road token in plain text.
  const plain = html.replace(/<[^>]*>/g, '');
  const m = plain.match(/([一-龥]{2})(?:路|街|大道|大街|橋|公路|環|線|道)(?:[一二三四五六七八九十0-9]+段)?/);
  if (m) {
    const norm = normalizeRoadName(m[0]);
    if (norm) return norm;
  }
  return null;
}

function extractRoadNames(route) {
  const names = [];
  const seen = new Set();
  if (!route || !route.legs) return names;
  route.legs.forEach(leg => {
    (leg.steps || []).forEach(step => {
      const name = parseRoadName(step.instructions);
      if (name && !seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    });
  });
  return names;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseRoadName, normalizeRoadName, extractRoadNames };
}
