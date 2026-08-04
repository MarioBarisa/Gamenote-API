// GET /api/games/:id -> full GameDetails, RAWG-compatible.
const { handlePreflight, sendJson } = require('../lib/cors');
const { authenticate } = require('../lib/auth');
const igdb = require('../lib/igdb');
const cache = require('../lib/cache');
const { toDetails } = require('../lib/map');

const TTL = 48 * 60 * 60 * 1000; // details: 48h
const FIELDS =
  'name, summary, cover.image_id, first_release_date, aggregated_rating, rating, ' +
  'genres.id, genres.name, involved_companies.publisher, ' +
  'involved_companies.company.id, involved_companies.company.name, ' +
  'platforms.id, platforms.name, websites.category, websites.url, ' +
  'age_ratings.category, age_ratings.rating, screenshots.id, screenshots.image_id, artworks.image_id';

function one(v) {
  return Array.isArray(v) ? v[0] : v;
}

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;
  if (!authenticate(req)) return sendJson(res, { detail: 'Unauthorized' }, 401);

  const id = Number(one(req.query.id) || NaN);
  if (!Number.isInteger(id)) return sendJson(res, { detail: 'Not found' }, 404);

  const cacheKey = `details:${id}`;
  const cached = cache.get(cacheKey);
  if (cached) return sendJson(res, cached);

  try {
    const rows = await igdb.post('games', `fields ${FIELDS}; where id = ${id}; limit 1;`);
    const game = rows && rows[0];
    if (!game) return sendJson(res, { detail: 'Not found' }, 404);

    const payload = toDetails(game);
    cache.set(cacheKey, payload, TTL);
    return sendJson(res, payload);
  } catch (err) {
    return sendJson(res, { detail: 'Not found' }, 404);
  }
};