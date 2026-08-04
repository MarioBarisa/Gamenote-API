// GET /api/health -> { "status": "ok" }
const { handlePreflight, sendJson } = require('./lib/cors');
const { authenticate } = require('./lib/auth');

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;
  if (!authenticate(req)) return sendJson(res, { detail: 'Unauthorized' }, 401);
  sendJson(res, { status: 'ok' });
};
