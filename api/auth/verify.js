// POST /api/auth/verify - Verify password for protected pages

module.exports = (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const APP_PASSWORD = process.env.APP_PASSWORD;
  const { password } = req.body;

  // No password configured = allow access
  if (!APP_PASSWORD) {
    return res.json({ valid: true });
  }

  if (password === APP_PASSWORD) {
    return res.json({ valid: true });
  }

  return res.status(401).json({ valid: false, error: 'Invalid password' });
};
