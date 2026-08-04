// GET /api/games  -> list / search / filter, RAWG-compatible.
// Query params: search, page, page_size, dates, metacritic, ordering.
const { handlePreflight, sendJson } = require('./lib/cors');
const { authenticate } = require('./lib/auth');
const igdb = require('./lib/igdb');
const cache = require('./lib/cache');
const { toListItem } = require('./lib/map');

const TTL = 2 * 60 * 60 * 1000; // search: 2h

const FIELDS =
  'name, cover.image_id, first_release_date, aggregated_rating, rating, ' +
  'genres.id, genres.name, screenshots.id, screenshots.image_id';

function one(v) {
  return Array.isArray(v) ? v[0] : v;
}

function toUnix(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : Math.floor(d.getTime() / 1000);
}

// ordering -> IGDB "sort" suffix: [-metacritic|-released|-added|...]
function orderingClause(raw) {
  const desc = raw.startsWith('-');
  const field = raw.replace(/^-/, '');
  const map = { metacritic: 'aggregated_rating', released: 'first_release_date', added: 'hypes' };
  return `${map[field] || 'hypes'} ${desc ? 'desc' : 'asc'}`;
}

function buildWhere(query) {
  const parts = [];

  if (query.dates) {
    const [start, end] = String(query.dates).split(',');
    const s = toUnix(start);
    const e = toUnix(end);
    if (s != null && e != null) {
      parts.push(`first_release_date >= ${Math.min(s, e)} & first_release_date <= ${Math.max(s, e)}`);
    }
  }

  if (query.metacritic) {
    const [min, max] = String(query.metacritic).split(',');
    if (min) parts.push(`aggregated_rating >= ${Number(min)}`);
    if (max) parts.push(`aggregated_rating <= ${Number(max)}`);
  }

  return parts.join(' & ');
}

// Returns the survival body (has both "where" parts and the whole request).
function buildBody({ search, page, pageSize, ordering, where }) {
  const head = search ? `search "${search.replace(/"/g, '\\"')}"; ` : '';
  const body = `${head}fields ${FIELDS}; limit ${pageSize}; offset ${(page - 1) * pageSize};`;
  if (where) return `${body} where ${where};`;
  if (ordering) return `${body} sort ${orderingClause(ordering)};`;
  return body;
}

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;
  if (!authenticate(req)) return sendJson(res, { detail: 'Unauthorized' }, 401);

  const q = req.query || {};
  const search = one(q.search) || '';
  const page = Math.max(1, parseInt(one(q.page), 10) || 1);
  const pageSize = Math.min(40, Math.max(1, parseInt(one(q.page_size), 10) || 20));
  const ordering = one(q.ordering);
  const where = buildWhere({ dates: one(q.dates), metacritic: one(q.metacritic) });

  // Cache key derived from every relevant input.
  const cacheKey = `list:${search}:${page}:${pageSize}:${ordering}:${where}`;
  const cached = cache.get(cacheKey);
  if (cached) return sendJson(res, cached);

  try {
    const body = buildBody({ search, page, pageSize, ordering, where });
    // IGDB's /count endpoint is no longer available, so we return the number
    // returned on this page (clients never paginate via `count`).
    const rows = await igdb.post('games', body);
    const payload = {
      count: (rows || []).length,
      next: null,
      previous: null,
      results: (rows || []).map(toListItem),
    };

    cache.set(cacheKey, payload, TTL);
    return sendJson(res, payload);
  } catch (err) {
    return sendJson(res, { count: 0, next: null, previous: null, results: [] });
  }
};