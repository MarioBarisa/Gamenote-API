// GET /api/games/match?title=...&year=2015
// Migration helper: best IGDB id for a (title, year) pair -> { id, name, released, score }.
// Used later to rewrite old RAWG game_api_id values to IGDB ids.
const { handlePreflight, sendJson } = require('../lib/cors');
const { authenticate } = require('../lib/auth');
const igdb = require('../lib/igdb');

const FIELDS = 'name, cover.image_id, first_release_date, aggregated_rating, rating';

function one(v) {
  return Array.isArray(v) ? v[0] : v;
}

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;
  if (!authenticate(req)) return sendJson(res, { detail: 'Unauthorized' }, 401);

  const title = one(req.query.title);
  const year = one(req.query.year);
  if (!title) return sendJson(res, { detail: 'title query param required' }, 400);

  try {
    const rows = await igdb.post('games', `search "${String(title).replace(/"/g, '\\"')}"; fields ${FIELDS}; limit 20;`);

    const target = normalize(title);
    const scored = (rows || []).map((g) => {
      let score = 0;
      const name = normalize(g.name);
      if (name === target) score += 3;
      else if (name.includes(target) || target.includes(name)) score += 1;

      const released = g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null;
      if (year && released === Number(year)) score += 1;

      // Penalize expansions/editions and titles that stray far from the queried
      // name, so "The Witcher 3" prefers the base game over DLC like "Hearts of Stone".
      score -= Math.abs(name.length - target.length) * 0.05;
      if (/\b(dlc|expansion|edition|bundle|collection|remaster|game of the year|season pass)\b/i.test(name)) score -= 0.4;

      const rating = (g.aggregated_rating ?? g.rating) || 0;
      score += rating / 100; // small tie-break toward better-rated games
      return { g, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];

    if (!best || best.score <= 0) {
      return sendJson(res, { id: null, name: null, released: null, score: 0 });
    }

    return sendJson(res, {
      id: best.g.id,
      name: best.g.name,
      released: best.g.first_release_date
        ? new Date(best.g.first_release_date * 1000).toISOString().slice(0, 10)
        : null,
      score: Number(best.score.toFixed(2)),
    });
  } catch (err) {
    return sendJson(res, { id: null, name: null, released: null, score: 0 });
  }
};