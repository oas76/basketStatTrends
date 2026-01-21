// GET/PUT /api/cloud/data - Load or save data from/to JSONbin

const JSONBIN_API_URL = 'https://api.jsonbin.io/v3/b';

module.exports = async (req, res) => {
  const JSONBIN_API_KEY = process.env.JSONBIN_API_KEY;
  const JSONBIN_BIN_ID = process.env.JSONBIN_BIN_ID;

  if (!JSONBIN_API_KEY || !JSONBIN_BIN_ID) {
    return res.status(400).json({ error: 'Cloud not configured' });
  }

  // GET - Load data from cloud
  if (req.method === 'GET') {
    try {
      const response = await fetch(`${JSONBIN_API_URL}/${JSONBIN_BIN_ID}/latest`, {
        method: 'GET',
        headers: {
          'X-Master-Key': JSONBIN_API_KEY
        }
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        return res.status(response.status).json({
          error: error.message || `Cloud fetch failed: ${response.status}`
        });
      }

      const result = await response.json();
      return res.json(result);
    } catch (error) {
      console.error('Cloud GET error:', error);
      return res.status(500).json({ error: 'Failed to fetch from cloud' });
    }
  }

  // PUT - Save data to cloud
  if (req.method === 'PUT') {
    try {
      const response = await fetch(`${JSONBIN_API_URL}/${JSONBIN_BIN_ID}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': JSONBIN_API_KEY
        },
        body: JSON.stringify(req.body)
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        return res.status(response.status).json({
          error: error.message || `Cloud save failed: ${response.status}`
        });
      }

      const result = await response.json();
      console.log('Data synced to cloud');
      return res.json(result);
    } catch (error) {
      console.error('Cloud PUT error:', error);
      return res.status(500).json({ error: 'Failed to save to cloud' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
