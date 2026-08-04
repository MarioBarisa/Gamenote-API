// GET /api/games/:id/game-series -> related games from the same
// IGDB franchise/collection, shaped for the mobile prequel/sequel UI.
const { handlePreflight, sendJson } = require('../../lib/cors');
const { authenticate } = require('../../lib/auth');
const igdb = require('../../lib/igdb');
const cache = require('../../lib/cache');
const { cover } = require('../../lib/images');
const { dateFromUnix } = require('../../lib/map');

const TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const ENTRIES = 'id, name, cover.image_id, first_release_date';

function one(v) {
  return Array.isArray(v) ? v[0] : v;
}

// Sort: newest first, null release dates last.
function byReleasedDesc(a, b) {
  if (!a.released && !b.released) return 0;
  if (!a.released) return 1;
  if (!b.released) return -1;
  return b.released.localeCompare(a.released);
}

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;
  if (!authenticate(req)) return sendJson(res, { detail: 'Unauthorized' }, 401);

  const id = Number(one(req.query.id) || NaN);
  if (!Number.isInteger(id)) return sendJson(res, { count: 0, results: [] });

  const cacheKey = `series:${id}`;
  const cached = cache.get(cacheKey);
  if (cached) return sendJson(res, cached);

  try {
    // Prefer ONE expanded request: pull games from the game's franchises/collections.
    // NOTE: use flat multi-level expansion (no `(...)`) - parenthesized nested
    // field lists are rejected by IGDB with a 400.
    const SUB = ['id', 'name', 'cover.image_id', 'first_release_date'];
    const flat = (prefix) => SUB.map((s) => `${prefix}.${s}`).join(', ');
    const body = `fields ${flat('franchises.games')}, ${flat('collections.games')}; where id = ${id}; limit 1;`;
    const rows = await igdb.post('games', body);
    const game = rows && rows[0];

    let rels = [];
    if (game) {
      const seen = new Map();
      for (const group of [...(game.franchises || []), ...(game.collections || [])]) {
        for (const g of group.games || []) {
          if (!seen.has(g.id)) seen.set(g.id, g);
        }
      }
      rels = Array.from(seen.values());
    }

    // Fallback: if the expanded call returned nothing, resolve ids in two steps.
    if (rels.length === 0) {
      const g = await igdb.post('games', `fields franchises, collections; where id = ${id}; limit 1;`);
      const ids = [...((g[0] || {}).franchises || []), ...((g[0] || {}).collections || [])];
      if (ids.length) {
        rels = await igdb.post(
          'games',
          `fields ${ENTRIES}; where (franchises = (${ids.join(',')}) | collections = (${ids.join(',')})) & id != ${id}; limit 50;`
        );
      }
    }

    const payload = {
      count: rels.length,
      results: rels.map((g) => ({
        id: g.id,
        name: g.name,
        released: dateFromUnix(g.first_release_date),
        background_image: cover(g.cover && g.cover.image_id),
      })).sort(byReleasedDesc),
    };

    cache.set(cacheKey, payload, TTL);
    return sendJson(res, payload);
  } catch (err) {
    return sendJson(res, { count: 0, results: [] });
  }
};