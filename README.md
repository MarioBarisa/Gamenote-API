# Gamenote API

A **drop-in replacement for the RAWG API**, backed by [IGDB](https://api.igdb.com/v4)).
It returns the exact JSON shapes the two Gamenote clients ( or any other app ) already expect, so both apps keep
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
vercel                       # link to a Vercel project
vercel env add API_SECRET production
vercel env add API_SECRET preview
vercel env add IGDB_CLIENT_ID production
vercel env add IGDB_CLIENT_SECRET production
vercel env add IGDB_CLIENT_ID preview
vercel env add IGDB_CLIENT_SECRET preview
vercel --prod
```

`vercel.json` routes every `/api/*` request to the single `api/index.js` function,
so the API lives at:

```
https://<your-project>.vercel.app/api
```

---

## Project layout

```
api/
  index.js                      single catch-all router (all endpoints)
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

Routing is done inside `api/index.js` from the URL path (no reliance on Vercel's
dynamic-route param injection). `vercel.json` points one explicit route at it:
`^/api(/.*)?$` -> `api/index.js`.