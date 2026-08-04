// GET /api/games/:id/screenshots -> { count, results:[{id, image}] }.
const { handlePreflight, sendJson } = require('../../lib/cors');
const { authenticate } = require('../../lib/auth');
const igdb = require('../../lib/igdb');
const cache = require('../../lib/cache');
const { screenshot } = require('../../lib/images');

const TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

function one(v) {
  return Array.isArray(v) ? v[0] : v;
}

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;
  if (!authenticate(req)) return sendJson(res, { detail: 'Unauthorized' }, 401);

  const id = Number(one(req.query.id) || NaN);
  if (!Number.isInteger(id)) return sendJson(res, { count: 0, results: [] });

  const cacheKey = `shots:${id}`;
  const cached = cache.get(cacheKey);
  if (cached) return sendJson(res, cached);

  try {
    const rows = await igdb.post('games', `fields screenshots.id, screenshots.image_id; where id = ${id}; limit 1;`);
    const shots = (rows && rows[0] && rows[0].screenshots) || [];
    const payload = {
      count: shots.length,
      results: shots.map((s) => ({ id: s.id, image: screenshot(s.image_id) })),
    };
    cache.set(cacheKey, payload, TTL);
    return sendJson(res, payload);
  } catch (err) {
    return sendJson(res, { count: 0, results: [] });
  }
};