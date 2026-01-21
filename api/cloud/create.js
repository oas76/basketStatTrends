// POST /api/cloud/create - Create a new JSONbin bin

const JSONBIN_API_URL = 'https://api.jsonbin.io/v3/b';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const JSONBIN_API_KEY = process.env.JSONBIN_API_KEY;

  if (!JSONBIN_API_KEY) {
    return res.status(400).json({ error: 'API key not configured' });
  }

  try {
    const response = await fetch(JSONBIN_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': JSONBIN_API_KEY,
        'X-Bin-Name': 'BasketStat Data'
      },
      body: JSON.stringify(req.body)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      return res.status(response.status).json({
        error: error.message || `Cloud create failed: ${response.status}`
      });
    }

    const result = await response.json();
    const newBinId = result.metadata?.id;

    console.log(`New bin created: ${newBinId}`);

    return res.json({
      success: true,
      binId: newBinId,
      message: `Bin created! Add JSONBIN_BIN_ID=${newBinId} to environment variables`
    });
  } catch (error) {
    console.error('Cloud POST error:', error);
    return res.status(500).json({ error: 'Failed to create cloud bin' });
  }
};
