// Shared CORS helpers for every Vercel function.
// The web client (Vue) calls cross-origin in production, so these headers
// are mandatory. OPTIONS preflight requests must NOT require auth.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function applyCors(res) {
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    res.setHeader(k, v);
  }
}

// Returns true if this is a preflight we already handled (caller should stop).
function handlePreflight(req, res) {
  if (req.method === 'OPTIONS') {
    applyCors(res);
    res.statusCode = 204;
    res.end();
    return true;
  }
  applyCors(res);
  return false;
}

// Shared response helpers.
function sendJson(res, body, status = 200) {
  applyCors(res);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

module.exports = { applyCors, handlePreflight, sendJson };