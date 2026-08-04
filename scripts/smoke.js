// Local smoke test: exercises every endpoint against the REAL IGDB API.
// Usage:
//   export IGDB_CLIENT_ID=...
//   export IGDB_CLIENT_SECRET=...
//   export API_SECRET=...            (match whatever /api will enforce)
//   node scripts/smoke.js [searchTitle] [gameIdForDetail]
//
// Since the functions need a real HTTP entry point, this script inlines the
// handlers' logic through a tiny fake (req, res) shim so we can verify the
// exact JSON shapes without deploying.

const fs = require('fs');
const path = require('path');

// Tiny .env loader (no deps): reads KEY=value lines from <project root>/.env
// into process.env, but only for keys that aren't already set in the shell.
function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const key = m[1];
    if (process.env[key] !== undefined) continue;
    process.env[key] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadDotEnv();

const { post } = require('../api/lib/igdb');
const cache = require('../api/lib/cache');

// Single catch-all router: all routes go through api/[...path].js; we drive it
// by setting req.query.path to the URL segments after /api.
const router = require('../api/[...path].js');

function invoke(segs, query = {}, opts = {}) {
  return new Promise((resolve) => {
    let body = null;
    const res = {
      setHeader() {},
      statusCode: 200,
      end(json) { body = json == null ? null : JSON.parse(json); },
    };
    const merged = { ...query, path: segs };
    if (!opts.noKey) merged.key = process.env.API_SECRET;
    const req = { method: 'GET', headers: {}, query: merged };
    router(req, res).then(() => resolve({ status: res.statusCode, body })).catch((e) => resolve({ status: 500, body: null, error: e.message }));
  });
}

const log = (label, obj) => {
  console.log(`\n=== ${label} ===`);
  console.log(obj && obj.error ? `ERROR ${obj.status}: ${obj.error}` : JSON.stringify(obj));
};

async function main() {
  const searchTitle = process.argv[2] || 'The Witcher 3';
  if (!process.env.IGDB_CLIENT_ID || !process.env.IGDB_CLIENT_SECRET) {
    console.log('Set IGDB_CLIENT_ID and IGDB_CLIENT_SECRET first (see .env.example).');
    process.exit(1);
  }
  if (!process.env.API_SECRET) console.log('API_SECRET not set - auth check uses empty secret (keep consistent).');

  // 1) health
  log('GET /api/health', (await invoke(['health'])).body);

  // 2) search list
  const list = await invoke(['games'], { search: searchTitle, page: 1, page_size: 5 });
  log('GET /api/games (search)', list.body);
  const firstGame = list.body.results && list.body.results[0];
  const gameId = firstGame && firstGame.id;
  console.log(`\nPicked id=${gameId} for detail/screenshots/series checks`);

  // 3) popular/filters (no search, ordering)
  log('GET /api/games (ordering=-metacritic, page_size=3)', (await invoke(['games'], { ordering: '-metacritic', page_size: 3 })).body);

  // 4) detail
  if (gameId) log('GET /api/games/:id', (await invoke(['games', String(gameId)])).body);

  // 5) screenshots
  if (gameId) log('GET /api/games/:id/screenshots', (await invoke(['games', String(gameId), 'screenshots'])).body);

  // 6) series
  if (gameId) log('GET /api/games/:id/game-series', (await invoke(['games', String(gameId), 'game-series'])).body);

  // 7) match
  log('GET /api/games/match', (await invoke(['games', 'match'], { title: searchTitle, year: '2015' })).body);

  // 8) auth rejection
  const noKey = await invoke(['games'], { search: searchTitle }, { noKey: true });
  log('GET /api/games WITHOUT key (expect 401)', noKey);

  // 9) unknown route (expect 404)
  log('GET /api/bogus (expect 404)', await invoke(['bogus']));
}

main().catch((e) => { console.error(e); process.exit(1); });