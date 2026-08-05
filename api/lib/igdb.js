// Minimal IGDB client: OAuth token manager + POST helper.
// - Token cached in module scope, refreshed before it expires.
// - Every data call is an Apicalypse-format POST (NOT JSON).
// - Simple throttle keeps us under IGDB's 4 req/s limit.

let tokenCache = { accessToken: null, expiresAt: 0 };
let lastCallAt = 0; // ms epoch of the last request we sent

const MIN_INTERVAL_MS = 350; // ~3 req/s worst case, safely under the 4/s limit

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Space out outgoing requests so we never burst over IGDB's rate limit.
async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, lastCallAt + MIN_INTERVAL_MS - now);
  if (wait > 0) await delay(wait);
  lastCallAt = Date.now();
}

async function getAccessToken() {
  const { IGDB_CLIENT_ID, IGDB_CLIENT_SECRET } = process.env;
  if (!IGDB_CLIENT_ID || !IGDB_CLIENT_SECRET) {
    throw new Error('IGDB_CLIENT_ID / IGDB_CLIENT_SECRET not configured');
  }

  // Reuse a cached token until it is near expiry (10s buffer).
  if (tokenCache.accessToken && tokenCache.expiresAt > Date.now() + 10_000) {
    return tokenCache.accessToken;
  }

  await throttle();

  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: IGDB_CLIENT_ID,
      client_secret: IGDB_CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
  });

  if (!res.ok) {
    const err = new Error(`IGDB token request failed: ${res.status}`);
    console.error('[igdb]', err.message);
    throw err;
  }

  const data = await res.json();
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 5400) * 1000,
  };
  return tokenCache.accessToken;
}

// POST {endpoint} with an Apicalypse text body. Returns parsed JSON array.
async function post(endpoint, body) {
  const { IGDB_CLIENT_ID } = process.env;
  const token = await getAccessToken();
  await throttle();

  const res = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
    method: 'POST',
    headers: {
      'Client-ID': IGDB_CLIENT_ID,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'text/plain',
      Accept: 'application/json',
    },
    body,
  });

  if (!res.ok) {
    const err = new Error(`IGDB ${endpoint} failed: ${res.status} ${res.statusText}`);
    console.error('[igdb]', err.message);
    throw err;
  }

  return res.json();
}

module.exports = { post };
