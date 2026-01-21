// GET /api/cloud/status - Check cloud configuration status

module.exports = (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const JSONBIN_API_KEY = process.env.JSONBIN_API_KEY;
  const JSONBIN_BIN_ID = process.env.JSONBIN_BIN_ID;

  const configured = !!(JSONBIN_API_KEY && JSONBIN_BIN_ID);

  res.json({
    configured,
    hasBin: !!JSONBIN_BIN_ID,
    binIdPrefix: JSONBIN_BIN_ID ? JSONBIN_BIN_ID.slice(0, 8) + '...' : null
  });
};
