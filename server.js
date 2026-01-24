require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');

// Polyfill fetch for Node.js < 18 (Vercel compatibility)
let fetch;
if (typeof globalThis.fetch === 'function') {
  fetch = globalThis.fetch;
} else {
  fetch = require('node-fetch');
}

const app = express();
const PORT = process.env.PORT || 3000;

// Detect if running on Vercel (read-only filesystem)
const IS_VERCEL = process.env.VERCEL === '1';

// Environment variables (secrets hidden from client)
const JSONBIN_API_KEY = process.env.JSONBIN_API_KEY;
const JSONBIN_BIN_ID = process.env.JSONBIN_BIN_ID;
const APP_PASSWORD = process.env.APP_PASSWORD;

// Session configuration
const SESSION_SECRET = process.env.SESSION_SECRET || APP_PASSWORD || 'basketstat-default-secret';
const SESSION_COOKIE_NAME = 'basketstat_session';
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

// ========================================
// SESSION UTILITIES (Signed Cookie Approach)
// ========================================

/**
 * Create a signed session token
 * Token format: timestamp.signature
 */
function createSessionToken() {
  const timestamp = Date.now();
  const data = `${timestamp}`;
  const signature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(data)
    .digest('hex');
  return `${timestamp}.${signature}`;
}

/**
 * Verify a session token
 * Returns true if valid and not expired
 */
function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return false;
  
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  
  const [timestamp, signature] = parts;
  const timestampNum = parseInt(timestamp, 10);
  
  if (isNaN(timestampNum)) return false;
  
  // Check if expired
  if (Date.now() - timestampNum > SESSION_DURATION_MS) {
    return false;
  }
  
  // Verify signature
  const expectedSignature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(timestamp)
    .digest('hex');
  
  // Timing-safe comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  } catch {
    return false;
  }
}

/**
 * Check if request is authenticated
 */
function isAuthenticated(req) {
  // If no password is configured, allow access
  if (!APP_PASSWORD) return true;
  
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  return verifySessionToken(token);
}

// Cookie parser middleware
app.use(cookieParser());

// Parse JSON body (needed for login endpoint)
app.use(express.json({ limit: '10mb' }));

// ========================================
// AUTHENTICATION ROUTES (Must be before auth middleware)
// ========================================

// Serve login page (public)
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

// API: Login endpoint
app.post('/api/auth/login', (req, res) => {
  const { password } = req.body;
  
  // If no password configured, auto-succeed
  if (!APP_PASSWORD) {
    const token = createSessionToken();
    res.cookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' || IS_VERCEL,
      sameSite: 'lax',
      maxAge: SESSION_DURATION_MS
    });
    return res.json({ success: true });
  }
  
  if (password === APP_PASSWORD) {
    const token = createSessionToken();
    res.cookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' || IS_VERCEL,
      sameSite: 'lax',
      maxAge: SESSION_DURATION_MS
    });
    return res.json({ success: true });
  }
  
  res.status(401).json({ success: false, error: 'Invalid password' });
});

// API: Check if authenticated
app.get('/api/auth/check', (req, res) => {
  res.json({ authenticated: isAuthenticated(req) });
});

// API: Logout endpoint
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE_NAME);
  res.json({ success: true });
});

// Serve static assets (CSS, JS, images) - always public
app.use('/style.css', express.static(path.join(__dirname, 'style.css')));
app.use('/config.js', express.static(path.join(__dirname, 'config.js')));
app.use('/data.js', express.static(path.join(__dirname, 'data.js')));
app.use('/app.js', express.static(path.join(__dirname, 'app.js')));
app.use('/admin.js', express.static(path.join(__dirname, 'admin.js')));
app.use('/reference-stats.js', express.static(path.join(__dirname, 'reference-stats.js')));

// ========================================
// AUTHENTICATION MIDDLEWARE
// ========================================

// Protect all routes except public ones
const authMiddleware = (req, res, next) => {
  // Public paths that don't require authentication
  const publicPaths = [
    '/login',
    '/login.html',
    '/api/auth/login',
    '/api/auth/check',
    '/api/auth/logout',
    '/style.css',
    '/config.js',
    '/data.js',
    '/app.js',
    '/admin.js',
    '/reference-stats.js'
  ];
  
  // Check if path is public
  const isPublicPath = publicPaths.some(p => 
    req.path === p || req.path.startsWith(p + '/')
  );
  
  if (isPublicPath) {
    return next();
  }
  
  // Check if authenticated
  if (isAuthenticated(req)) {
    return next();
  }
  
  // For API requests, return 401
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  // For page requests, redirect to login with return URL
  const returnUrl = encodeURIComponent(req.originalUrl);
  res.redirect(`/login.html?redirect=${returnUrl}`);
};

app.use(authMiddleware);

// Ensure csv directory exists (skip on Vercel - read-only)
const csvDir = path.join(__dirname, 'csv');
if (!IS_VERCEL && !fs.existsSync(csvDir)) {
  fs.mkdirSync(csvDir, { recursive: true });
}

// Configure multer for CSV uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, csvDir);
  },
  filename: (req, file, cb) => {
    // Use original filename, sanitized
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'), false);
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Serve static files
app.use(express.static(__dirname));

// Explicit routes for main pages (ensures they work on Vercel)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/team.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'team.html'));
});

app.get('/bulk-import.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'bulk-import.html'));
});

app.get('/reference-admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'reference-admin.html'));
});

/**
 * Validate that a filename is safe and resolves within the csv directory.
 * Prevents path traversal attacks (e.g., ../../etc/passwd)
 * @param {string} filename - The filename to validate
 * @returns {string|null} - Safe absolute path or null if invalid
 */
function getSafeFilePath(filename) {
  // Reject if filename contains path separators or is empty
  if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    return null;
  }
  
  // Resolve the full path
  const filePath = path.resolve(csvDir, filename);
  
  // Ensure the resolved path is within csvDir
  if (!filePath.startsWith(csvDir + path.sep) && filePath !== csvDir) {
    return null;
  }
  
  return filePath;
}

// API: Upload CSV file (disabled on Vercel - use cloud storage)
app.post('/api/upload-csv', upload.single('csvFile'), (req, res) => {
  if (IS_VERCEL) {
    return res.status(400).json({ 
      error: 'File uploads disabled on Vercel. Use cloud sync instead.',
      hint: 'Import CSV data locally, then sync to cloud'
    });
  }
  
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  res.json({
    success: true,
    filename: req.file.filename,
    path: `/csv/${req.file.filename}`,
    size: req.file.size
  });
});

// API: List CSV files
app.get('/api/csv-files', (req, res) => {
  if (IS_VERCEL) {
    // On Vercel, CSV files are bundled at build time (if any exist)
    // Return empty array - use cloud sync instead
    return res.json([]);
  }
  
  fs.readdir(csvDir, (err, files) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to read csv directory' });
    }
    
    const csvFiles = files
      .filter(f => f.endsWith('.csv'))
      .map(filename => {
        const filePath = path.join(csvDir, filename);
        const stats = fs.statSync(filePath);
        return {
          filename,
          path: `/csv/${filename}`,
          size: stats.size,
          modified: stats.mtime
        };
      })
      .sort((a, b) => new Date(b.modified) - new Date(a.modified));
    
    res.json(csvFiles);
  });
});

// API: Get CSV file content
app.get('/api/csv/:filename', (req, res) => {
  const filePath = getSafeFilePath(req.params.filename);
  
  // Reject path traversal attempts
  if (!filePath) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  res.sendFile(filePath);
});

// Serve csv directory
app.use('/csv', express.static(csvDir));

// ========================================
// DATA PERSISTENCE API
// ========================================
// Stores game data server-side for cross-session persistence

const dataFilePath = path.join(__dirname, 'data', 'basketstat-data.json');
const dataDir = path.dirname(dataFilePath);

// Ensure data directory exists (skip on Vercel - read-only)
if (!IS_VERCEL && !fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// API: Get stored data (server-side file, not available on Vercel)
app.get('/api/data', (req, res) => {
  if (IS_VERCEL) {
    // On Vercel, redirect to cloud storage
    return res.json({ 
      players: {}, 
      games: [],
      _note: 'Server-side storage disabled on Vercel. Use cloud sync.'
    });
  }
  
  if (!fs.existsSync(dataFilePath)) {
    return res.json({ players: {}, games: [] });
  }
  
  try {
    const data = JSON.parse(fs.readFileSync(dataFilePath, 'utf-8'));
    res.json(data);
  } catch (error) {
    console.error('Error reading data file:', error);
    res.status(500).json({ error: 'Failed to read data file' });
  }
});

// API: Save data (server-side file, not available on Vercel)
app.post('/api/data', (req, res) => {
  if (IS_VERCEL) {
    // On Vercel, just acknowledge - data should be saved to cloud
    return res.json({ 
      success: true, 
      _note: 'Server-side storage disabled on Vercel. Use cloud sync.'
    });
  }
  
  try {
    const data = req.body;
    
    // Basic validation
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'Invalid data format' });
    }
    
    // Ensure required structure
    if (!data.players) data.players = {};
    if (!data.games) data.games = [];
    
    // Write with pretty formatting for debugging
    fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 2), 'utf-8');
    
    // Create backup
    const backupPath = path.join(dataDir, `basketstat-backup-${Date.now()}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(data, null, 2), 'utf-8');
    
    // Keep only last 5 backups
    const backups = fs.readdirSync(dataDir)
      .filter(f => f.startsWith('basketstat-backup-'))
      .sort()
      .reverse();
    
    backups.slice(5).forEach(backup => {
      fs.unlinkSync(path.join(dataDir, backup));
    });
    
    console.log(`Data saved: ${data.games.length} games, ${Object.keys(data.players).length} players`);
    res.json({ success: true, games: data.games.length, players: Object.keys(data.players).length });
  } catch (error) {
    console.error('Error saving data:', error);
    res.status(500).json({ error: 'Failed to save data' });
  }
});

// ========================================
// CLOUD PROXY API (Protects API keys)
// ========================================
// These endpoints proxy requests to JSONbin.io, keeping the API key server-side

const JSONBIN_API_URL = 'https://api.jsonbin.io/v3/b';

// Check if cloud is configured
const isCloudConfigured = () => {
  return JSONBIN_API_KEY && JSONBIN_BIN_ID;
};

// API: Get cloud config status (without exposing secrets)
app.get('/api/cloud/status', (req, res) => {
  res.json({
    configured: isCloudConfigured(),
    hasBin: !!JSONBIN_BIN_ID,
    binIdPrefix: JSONBIN_BIN_ID ? JSONBIN_BIN_ID.slice(0, 8) + '...' : null
  });
});

// API: Verify password (legacy endpoint - kept for compatibility)
// New auth flow uses session cookies via /api/auth/login
app.post('/api/auth/verify', (req, res) => {
  // Just check if user has valid session
  if (isAuthenticated(req)) {
    return res.json({ valid: true });
  }
  res.status(401).json({ valid: false, error: 'Not authenticated' });
});

// API: Load data from cloud (proxy to JSONbin GET)
app.get('/api/cloud/data', async (req, res) => {
  if (!isCloudConfigured()) {
    return res.status(400).json({ error: 'Cloud not configured' });
  }
  
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
    res.json(result);
  } catch (error) {
    console.error('Cloud proxy GET error:', error);
    res.status(500).json({ error: 'Failed to fetch from cloud' });
  }
});

// API: Save data to cloud (proxy to JSONbin PUT)
app.put('/api/cloud/data', async (req, res) => {
  if (!isCloudConfigured()) {
    return res.status(400).json({ error: 'Cloud not configured' });
  }
  
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
    res.json(result);
  } catch (error) {
    console.error('Cloud proxy PUT error:', error);
    res.status(500).json({ error: 'Failed to save to cloud' });
  }
});

// API: Create new bin (proxy to JSONbin POST) - for initial setup
app.post('/api/cloud/create', async (req, res) => {
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
    console.log('⚠️  Update JSONBIN_BIN_ID in .env to:', newBinId);
    
    res.json({ 
      success: true, 
      binId: newBinId,
      message: `Bin created! Update JSONBIN_BIN_ID in .env to: ${newBinId}`
    });
  } catch (error) {
    console.error('Cloud proxy POST error:', error);
    res.status(500).json({ error: 'Failed to create cloud bin' });
  }
});

// Only start server if running directly (not imported by Vercel)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`BasketStat server running at http://localhost:${PORT}`);
    console.log(`CSV files stored in: ${csvDir}`);
    console.log(`Data file: ${dataFilePath}`);
    console.log(`Cloud sync: ${isCloudConfigured() ? 'Configured' : 'Not configured (set JSONBIN_API_KEY and JSONBIN_BIN_ID in .env)'}`);
  });
}

// Export for Vercel serverless
module.exports = app;
