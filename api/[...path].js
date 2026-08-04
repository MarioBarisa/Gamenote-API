// Single catch-all Vercel function: routes /api/* internally.
// This avoids Vercel's nested-dynamic-route auto-routing entirely and parses
// the game id from the URL ourselves (req.query.path), so no reliance on
// Vercel's query-param injection.
//
// Routed paths:
//   /api/health
//   /api/games                           list + search + filter
//   /api/games/:id                       details
//   /api/games/:id/screenshots
//   /api/games/:id/game-series
//   /api/games/match                     migration helper
const { handlePreflight, sendJson } = require('./lib/cors');
const { authenticate } = require('./lib/auth');
const igdb = require('./lib/igdb');
const cache = require('./lib/cache');
const { cover, screenshot } = require('./lib/images');
const { toListItem, toDetails, dateFromUnix } = require('./lib/map');

function one(v) {
  return Array.isArray(v) ? v[0] : v;
}

function toUnix(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : Math.floor(d.getTime() / 1000);
}

// ---------- list / search / filters ----------

const LIST_FIELDS =
  'name, cover.image_id, first_release_date, aggregated_rating, rating, ' +
  'genres.id, genres.name, screenshots.id, screenshots.image_id';
const LIST_TTL = 2 * 60 * 60 * 1000;

function orderingClause(raw) {
  const desc = raw.startsWith('-');
  const field = raw.replace(/^-/, '');
  const map = { metacritic: 'aggregated_rating', released: 'first_release_date', added: 'hypes' };
  return `${map[field] || 'hypes'} ${desc ? 'desc' : 'asc'}`;
}

function buildWhere(q) {
  const parts = [];
  if (q.dates) {
    const [start, end] = String(q.dates).split(',');
    const s = toUnix(start);
    const e = toUnix(end);
    if (s != null && e != null) {
      parts.push(`first_release_date >= ${Math.min(s, e)} & first_release_date <= ${Math.max(s, e)}`);
    }
  }
  if (q.metacritic) {
    const [min, max] = String(q.metacritic).split(',');
    if (min) parts.push(`aggregated_rating >= ${Number(min)}`);
    if (max) parts.push(`aggregated_rating <= ${Number(max)}`);
  }
  return parts.join(' & ');
}

async function handleGames(req, res) {
  const q = req.query || {};
  const search = one(q.search) || '';
  const page = Math.max(1, parseInt(one(q.page), 10) || 1);
  const pageSize = Math.min(40, Math.max(1, parseInt(one(q.page_size), 10) || 20));
  const ordering = one(q.ordering);
  const where = buildWhere(q);

  const cacheKey = `list:${search}:${page}:${pageSize}:${ordering}:${where}`;
  const cached = cache.get(cacheKey);
  if (cached) return sendJson(res, cached);

  try {
    const head = search ? `search "${search.replace(/"/g, '\\"')}"; ` : '';
    let body = `${head}fields ${LIST_FIELDS}; limit ${pageSize}; offset ${(page - 1) * pageSize};`;
    if (where) body += ` where ${where};`;
    if (ordering) body += ` sort ${orderingClause(ordering)};`;

    const rows = await igdb.post('games', body);
    // IGDB's /count endpoint is gone, so report the page size as count.
    const payload = {
      count: (rows || []).length,
      next: null,
      previous: null,
      results: (rows || []).map(toListItem),
    };
    cache.set(cacheKey, payload, LIST_TTL);
    return sendJson(res, payload);
  } catch (err) {
    return sendJson(res, { count: 0, next: null, previous: null, results: [] });
  }
}

// ---------- details ----------

const DETAIL_FIELDS =
  'name, summary, cover.image_id, first_release_date, aggregated_rating, rating, ' +
  'genres.id, genres.name, involved_companies.publisher, ' +
  'involved_companies.company.id, involved_companies.company.name, ' +
  'platforms.id, platforms.name, websites.category, websites.url, ' +
  'age_ratings.category, age_ratings.rating, screenshots.id, screenshots.image_id, artworks.image_id';
const DETAIL_TTL = 48 * 60 * 60 * 1000;

async function handleGame(req, res, id) {
  const cacheKey = `details:${id}`;
  const cached = cache.get(cacheKey);
  if (cached) return sendJson(res, cached);

  try {
    const rows = await igdb.post('games', `fields ${DETAIL_FIELDS}; where id = ${id}; limit 1;`);
    const game = rows && rows[0];
    if (!game) return sendJson(res, { detail: 'Not found' }, 404);
    const payload = toDetails(game);
    cache.set(cacheKey, payload, DETAIL_TTL);
    return sendJson(res, payload);
  } catch (err) {
    return sendJson(res, { detail: 'Not found' }, 404);
  }
}

// ---------- screenshots ----------

const SHOT_TTL = 7 * 24 * 60 * 60 * 1000;

async function handleScreenshots(req, res, id) {
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
    cache.set(cacheKey, payload, SHOT_TTL);
    return sendJson(res, payload);
  } catch (err) {
    return sendJson(res, { count: 0, results: [] });
  }
}

// ---------- series ----------

const SERIES_TTL = 7 * 24 * 60 * 60 * 1000;
const SERIES_FIELDS = 'id, name, cover.image_id, first_release_date';

function byReleasedDesc(a, b) {
  if (!a.released && !b.released) return 0;
  if (!a.released) return 1;
  if (!b.released) return -1;
  return b.released.localeCompare(a.released);
}

async function handleSeries(req, res, id) {
  const cacheKey = `series:${id}`;
  const cached = cache.get(cacheKey);
  if (cached) return sendJson(res, cached);

  try {
    // Flat multi-level expansion (NO `(...)`) - parenthesized nested field lists
    // are rejected by IGDB with a 400.
    const flat = (prefix) => SERIES_FIELDS.split(', ').map((s) => `${prefix}.${s}`).join(', ');
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

    // Fallback: resolve franchise/collection ids in two steps.
    if (rels.length === 0) {
      const g = await igdb.post('games', `fields franchises, collections; where id = ${id}; limit 1;`);
      const ids = [...((g[0] || {}).franchises || []), ...((g[0] || {}).collections || [])];
      if (ids.length) {
        rels = await igdb.post(
          'games',
          `fields ${SERIES_FIELDS}; where (franchises = (${ids.join(',')}) | collections = (${ids.join(',')})) & id != ${id}; limit 50;`
        );
      }
    }

    const payload = {
      count: rels.length,
      results: rels
        .map((g) => ({
          id: g.id,
          name: g.name,
          released: dateFromUnix(g.first_release_date),
          background_image: cover(g.cover && g.cover.image_id),
        }))
        .sort(byReleasedDesc),
    };
    cache.set(cacheKey, payload, SERIES_TTL);
    return sendJson(res, payload);
  } catch (err) {
    return sendJson(res, { count: 0, results: [] });
  }
}

// ---------- match (migration helper) ----------

const MATCH_FIELDS = 'name, first_release_date, aggregated_rating, rating';

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

async function handleMatch(req, res) {
  const q = req.query || {};
  const title = one(q.title);
  const year = one(q.year);
  if (!title) return sendJson(res, { detail: 'title query param required' }, 400);

  try {
    const rows = await igdb.post('games', `search "${String(title).replace(/"/g, '\\"')}"; fields ${MATCH_FIELDS}; limit 20;`);
    const target = normalize(title);
    const scored = (rows || []).map((g) => {
      let score = 0;
      const name = normalize(g.name);
      if (name === target) score += 3;
      else if (name.includes(target) || target.includes(name)) score += 1;

      const released = g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null;
      if (year && released === Number(year)) score += 1;

      score -= Math.abs(name.length - target.length) * 0.05;
      if (/\b(dlc|expansion|edition|bundle|collection|remaster|game of the year|season pass)\b/i.test(name)) score -= 0.4;

      const rating = (g.aggregated_rating ?? g.rating) || 0;
      score += rating / 100;
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
      released: best.g.first_release_date ? new Date(best.g.first_release_date * 1000).toISOString().slice(0, 10) : null,
      score: Number(best.score.toFixed(2)),
    });
  } catch (err) {
    return sendJson(res, { id: null, name: null, released: null, score: 0 });
  }
}

// ---------- router ----------

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;
  if (!authenticate(req)) return sendJson(res, { detail: 'Unauthorized' }, 401);

  const raw = req.query.path;
  const segs = (Array.isArray(raw) ? raw : [raw]).filter(Boolean);
  const [a, b, c] = segs;

  if (a === 'health') return handleHealth(req, res);
  if (a === 'games') {
    if (b === 'match' && !c) return handleMatch(req, res);
    if (b && c === 'screenshots') return handleScreenshots(req, res, Number(b));
    if (b && c === 'game-series') return handleSeries(req, res, Number(b));
    if (b) return handleGame(req, res, Number(b));
    return handleGames(req, res);
  }
  return sendJson(res, { detail: 'Not found' }, 404);
};

function handleHealth(req, res) {
  return sendJson(res, { status: 'ok' });
}