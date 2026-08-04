# Gamenote API

A **drop-in replacement for the RAWG API**, backed by [IGDB](https://api.igdb.com/v4)).
It returns the exact JSON shapes the two Gamenote clients already expect, so both apps keep
working with **only a `BASE_URL` (and API-key) change** — no logic edits.

- Plain Vercel Node serverless functions, CommonJS, **zero npm dependencies** (native `fetch`).
- Best-effort in-memory cache (warm function instances) keeps us far under Vercel Hobby limits.
- Simple shared-secret auth so only your clients can call it.

---

## Endpoints (all RAWG-compatible)

Every endpoint ignores the `key` query param **and repurposes it as your API secret**.

| Method & path | What it returns |
|---|---|
| `GET /api/health` | `{ "status": "ok" }` |
| `GET /api/games` | list/search with `search`, `page`, `page_size`, `dates`, `metacritic`, `ordering` |
| `GET /api/games/:id` | full game details |
| `GET /api/games/:id/screenshots` | `{ count, results: [{ id, image }] }` |
| `GET /api/games/:id/game-series` | `{ count, results: [{ id, name, released, background_image }] }` |
| `GET /api/games/match?title=…&year=2015` | migration helper → best IGDB id (optional) |

Ignored/mapped query params on `/api/games`:

- `ordering=-metacritic \| -released \| -added \| metacritic \| released \| added`
- `dates=YYYY-MM-DD,YYYY-MM-DD`
- `metacritic=min,max` (min and/or max)

---

## Setup

### 1. Get IGDB credentials
1. Create a Twitch app at <https://dev.twitch.tv/console/apps> (set a localhost redirect).
2. The app gives you a **Client ID** and **Client Secret**; grant it the **IGDB API** access.

### 2. Environment variables
```
IGDB_CLIENT_ID=
IGDB_CLIENT_SECRET=
API_SECRET=<openssl rand -hex 32>
```

`API_SECRET` is the shared secret your clients will send as their API key.

---

## Local dev & smoke test

```bash
export IGDB_CLIENT_ID=...
export IGDB_CLIENT_SECRET=...
export API_SECRET=...
node scripts/smoke.js "The Witcher 3"
```

This hits the real IGDB API and prints the exact JSON for every endpoint so you can
verify the contract before deploying.

---

## Deploy to Vercel

```bash
npm i -g vercel   # if needed
vercel
vercel env add IGDB_CLIENT_ID production
vercel env add IGDB_CLIENT_SECRET production
vercel env add API_SECRET production
vercel env add IGDB_CLIENT_ID preview
vercel env add IGDB_CLIENT_SECRET preview
vercel env add API_SECRET preview
vercel --prod      # deploy
```

Functions in `api/` are automatically exposed under `/api`, so your URL becomes:

```
https://<your-project>.vercel.app/api
```

---

## Point the clients at the new API

Generate one shared secret and put the **same value** in all three places.

### Web — https://github.com/MarioBarisa/Gamenote
`.env`:
```
VITE_RAWG_API_KEY=<same as API_SECRET>
```
`src/services/gamesApi.js`:
```js
const BASE_URL = 'https://<your-project>.vercel.app/api';
```

### Mobile — https://github.com/MarioBarisa/GamenoteMobile
`Gamenote/services/gamesApi.ts`:
```ts
const BASE_URL = 'https://<your-project>.vercel.app/api'
```
and set `RAWG_API_KEY` (in `constants/env`) to the same secret.

That's it — search, details, screenshots, and series all keep working.

---

## Migrating existing library (optional)

Old `game_api_id` rows in Supabase still hold **RAWG** ids, which this API cannot serve
(IGDB ids are stable and used for new adds, so "already in library" keeps working for
everything added after the switch).

To migrate old rows to IGDB ids, use the web export/import flow and rewrite each
`game_api_id` via:

```
GET /api/games/match?title=<game name>&year=<release year>
→ { "id": <IGDB id>, "name": ..., "released": ..., "score": ... }
```

Import the rewritten backup. Series ids are stored as IGDB ids, so future ownership
checks stay consistent.

---

## Notes & tradeoffs

- **Auth**: a single shared bearer secret compared in constant time (`api/lib/auth.js`).
  Preflight `OPTIONS` requests still pass (CORS), real requests require `key`.
- **Errors**: IGDB failures return `200` with empty `results` on list endpoints so the UIs
  never crash; unknown game ids return `404` (clients already degrade to `null`/empty).
- **Rate limit**: a simple throttle keeps us under IGDB's 4 req/s; caching makes this a non-issue.
- **CORS**: `Access-Control-Allow-Origin: *` is set on every response for the web client.

## Project layout

```
api/
  games.js                      list + search + filters
  health.js
  games/[id].js                 details
  games/[id]/screenshots.js
  games/[id]/game-series.js
  games/match.js                migration helper
  lib/
    igdb.js                     IGDB token manager + POST helper
    map.js                      IGDB object -> RAWG shape
    cache.js                    Map + TTL
    images.js                   IGDB CDN URL builders
    cors.js                     CORS + response helpers
    auth.js                     shared-secret auth
scripts/
  smoke.js                      live endpoint test harness
```