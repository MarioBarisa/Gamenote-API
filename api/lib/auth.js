// Shared-api-secret auth.
// The Gamenote clients already send `key=<API key>` on every request and read
// the value from their own env var. We simply use that query param (or an
// Authorization: Bearer header) as our shared secret, compared in constant
// time to avoid timing attacks.

const crypto = require('crypto');

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function authenticate(req) {
  const secret = process.env.API_SECRET;
  if (!secret) return true; // not configured -> open (dev only)

  const q = req.query || {};
  const header = (req.headers || {}).authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';

  const candidate = q.key || bearer;
  return safeEqual(candidate, secret);
}

module.exports = { authenticate };