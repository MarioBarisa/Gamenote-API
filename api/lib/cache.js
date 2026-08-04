// Simple best-effort in-memory cache (Map + TTL).
// On Vercel this survives only while the same warm function instance
// is alive, which is exactly what we want for our modest load.

const store = new Map();

function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

function set(key, value, ttlMs) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

module.exports = { get, set };
