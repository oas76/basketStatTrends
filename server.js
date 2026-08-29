require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

// Auth libraries
const userStore = require('./lib/userStore');
const teamStore = require('./lib/teamStore');
const { hashPassword, verifyPassword, generatePassword } = require('./lib/passwords');
const oauth = require('./lib/oauth');

// Polyfill fetch for Node.js < 18 (Vercel compatibility)
let fetch;
if (typeof globalThis.fetch === 'function') {
  fetch = globalThis.fetch;
} else {
  fetch = require('node-fetch');
}

const app = express();
const PORT = process.env.PORT || 3000;

// Behind Vercel's single proxy: trust it so req.ip / req.protocol reflect the
// client (needed for accurate audit IPs, rate limiting, and OAuth redirect URLs).
app.set('trust proxy', 1);

// Detect if running on Vercel (read-only filesystem)
const IS_VERCEL = process.env.VERCEL === '1';

// Environment variables (secrets hidden from client)
const JSONBIN_API_KEY = process.env.JSONBIN_API_KEY;
const JSONBIN_BIN_ID = process.env.JSONBIN_BIN_ID;
const APP_PASSWORD = process.env.APP_PASSWORD;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'BasketAdmin';

// Session configuration
const SESSION_SECRET = process.env.SESSION_SECRET || APP_PASSWORD || 'basketstat-default-secret';
const SESSION_COOKIE_NAME = 'basketstat_session';
const OAUTH_COOKIE_NAME = 'basketstat_oauth';
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Rate limiter for authentication endpoints (per-IP). On serverless this is
// per-instance, but still raises the cost of credential stuffing / brute force.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many attempts. Please try again later.' }
});

// Audit log storage (in-memory + file for local, Vercel Blob for production)
const auditLogPath = path.join(__dirname, 'data', 'audit-log.json');
const AUDIT_BLOB_NAME = 'audit/basketstat-audit-log.json';
let auditLog = [];
let auditLogInitialized = false;

// Vercel Blob functions (loaded dynamically for ES module compatibility)
let blobPut, blobList;

/**
 * Load Vercel Blob module (ES module via dynamic import)
 */
async function loadBlobModule() {
  if (!IS_VERCEL) return false;
  if (blobPut && blobList) return true;
  
  try {
    const blobModule = await import('@vercel/blob');
    blobPut = blobModule.put;
    blobList = blobModule.list;
    return true;
  } catch (e) {
    console.error('Failed to load @vercel/blob:', e);
    return false;
  }
}

/**
 * Initialize audit log from storage
 */
async function initAuditLog() {
  if (auditLogInitialized) return;
  
  if (IS_VERCEL) {
    // Load from Vercel Blob
    try {
      const blobLoaded = await loadBlobModule();
      if (blobLoaded && blobList) {
        const { blobs } = await blobList({ prefix: 'audit/' });
        const auditBlob = blobs.find(b => b.pathname === AUDIT_BLOB_NAME);
        if (auditBlob) {
          const response = await fetch(auditBlob.url);
          if (response.ok) {
            auditLog = await response.json();
            console.log(`Loaded ${auditLog.length} audit entries from Vercel Blob`);
          }
        } else {
          console.log('No existing audit log in Vercel Blob, starting fresh');
        }
      }
    } catch (e) {
      console.error('Failed to load audit log from Vercel Blob:', e);
    }
  } else if (fs.existsSync(auditLogPath)) {
    // Load from local file
    try {
      auditLog = JSON.parse(fs.readFileSync(auditLogPath, 'utf-8'));
      console.log(`Loaded ${auditLog.length} audit entries from local file`);
    } catch (e) {
      console.error('Failed to load audit log:', e);
      auditLog = [];
    }
  }
  
  auditLogInitialized = true;
}

/**
 * Save audit log to storage
 */
async function saveAuditLog() {
  if (IS_VERCEL) {
    // Save to Vercel Blob
    try {
      const blobLoaded = await loadBlobModule();
      if (blobLoaded && blobPut) {
        await blobPut(AUDIT_BLOB_NAME, JSON.stringify(auditLog, null, 2), {
          access: 'public',
          contentType: 'application/json',
          addRandomSuffix: false
        });
        console.log('Audit log saved to Vercel Blob');
      }
    } catch (e) {
      console.error('Failed to save audit log to Vercel Blob:', e);
    }
  } else {
    // Save to local file
    try {
      const dir = path.dirname(auditLogPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(auditLogPath, JSON.stringify(auditLog, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to save audit log:', e);
    }
  }
}

/**
 * Add entry to audit log
 */
async function logAudit(entry) {
  // Ensure log is initialized
  if (!auditLogInitialized) {
    await initAuditLog();
  }
  
  const logEntry = {
    timestamp: new Date().toISOString(),
    ...entry
  };
  
  auditLog.push(logEntry);
  
  // Keep only last 1000 entries
  if (auditLog.length > 1000) {
    auditLog = auditLog.slice(-1000);
  }
  
  // Save to storage (async, don't block)
  saveAuditLog().catch(e => console.error('Failed to save audit log:', e));
  
  console.log(`[AUDIT] ${logEntry.timestamp} | ${entry.action} | ${entry.email || 'unknown'} | ${entry.success ? 'SUCCESS' : 'FAILED'}`);
}

// Initialize audit log on startup
initAuditLog().catch(e => console.error('Failed to initialize audit log:', e));

// ========================================
// SESSION UTILITIES (Signed Cookie Approach)
// ========================================

/**
 * Create a signed session token.
 * Token format: v2.timestamp.userId.role.signature
 * The userId lets the server re-check the account on every request, so disabling
 * a user or changing their role takes effect immediately.
 */
function createSessionToken(userId, role = 'user') {
  const timestamp = Date.now();
  const data = `v2.${timestamp}.${userId}.${role}`;
  const signature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(data)
    .digest('hex');
  return `${data}.${signature}`;
}

/**
 * Verify a session token and extract userId/role.
 * Returns { valid: boolean, userId: string | null, role: string | null }
 */
function verifySessionToken(token) {
  const fail = { valid: false, userId: null, role: null };
  if (!token || typeof token !== 'string') return fail;

  const parts = token.split('.');
  if (parts.length !== 5 || parts[0] !== 'v2') return fail;

  const [, timestamp, userId, role, signature] = parts;
  const timestampNum = parseInt(timestamp, 10);
  if (isNaN(timestampNum)) return fail;

  // Check if expired
  if (Date.now() - timestampNum > SESSION_DURATION_MS) return fail;

  // Verify signature
  const data = `v2.${timestamp}.${userId}.${role}`;
  const expectedSignature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(data)
    .digest('hex');

  try {
    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
    return isValid ? { valid: true, userId, role } : fail;
  } catch {
    return fail;
  }
}

/** Set the session cookie with hardened flags. */
function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' || IS_VERCEL,
    sameSite: 'lax',
    maxAge: SESSION_DURATION_MS
  });
}

/**
 * Resolve the authenticated user for a request.
 * Returns { authenticated, role, user }.
 */
async function getAuthStatus(req) {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  const { valid, userId } = verifySessionToken(token);

  if (!valid) {
    // First-run/dev bypass: if no password is configured AND no accounts exist
    // yet, treat the request as admin so the app is usable before setup. Once
    // any account exists, real authentication is enforced.
    if (!APP_PASSWORD && (await userStore.isEmpty())) {
      return { authenticated: true, role: 'admin', user: null };
    }
    return { authenticated: false, role: null, user: null };
  }

  const user = await userStore.findById(userId);
  if (!user || user.status !== 'active') {
    return { authenticated: false, role: null, user: null };
  }
  return { authenticated: true, role: user.role, user };
}

/** Check if request is authenticated. */
async function isAuthenticated(req) {
  return (await getAuthStatus(req)).authenticated;
}

/** Check if request has admin access. */
async function isAdmin(req) {
  const { authenticated, role } = await getAuthStatus(req);
  return authenticated && role === 'admin';
}

/**
 * Basic CSRF defense for state-changing API calls: if a browser sends an Origin
 * header, it must match the request host. Combined with the SameSite=Lax session
 * cookie this blocks cross-site forgery.
 */
function sameOrigin(req) {
  const origin = req.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === req.get('host');
  } catch {
    return false;
  }
}

// ---------- OAuth state (signed cookie) ----------

function signOAuthState(obj) {
  const payload = Buffer.from(JSON.stringify(obj)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyOAuthState(token) {
  if (!token || typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  try {
    const obj = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (obj.exp && Date.now() > obj.exp) return null;
    return obj;
  } catch {
    return null;
  }
}

/** Resolve the public base URL for building OAuth redirect URIs. */
function baseUrl(req) {
  return process.env.OAUTH_REDIRECT_BASE_URL || `${req.protocol}://${req.get('host')}`;
}

// Cookie parser middleware
app.use(cookieParser());

// Parse JSON body (needed for login endpoint)
app.use(express.json({ limit: '10mb' }));

// Parse urlencoded bodies (needed for Apple's form_post OAuth callback)
app.use(express.urlencoded({ extended: false }));

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

// API: Login endpoint (email + password against the user store)
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';

  // Validate email
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    logAudit({
      action: 'LOGIN_ATTEMPT',
      email: email || 'missing',
      ip: clientIp,
      userAgent,
      success: false,
      reason: 'Invalid email'
    });
    return res.status(400).json({ success: false, error: 'Valid email address is required' });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const invalid = () => res.status(401).json({ success: false, error: 'Invalid email or password' });

  try {
    // Bootstrap: when the store is empty, the env passwords create the first
    // account (admin via ADMIN_PASSWORD, user via APP_PASSWORD).
    if (await userStore.isEmpty()) {
      let role = null;
      if (typeof password === 'string' && password && ADMIN_PASSWORD && password === ADMIN_PASSWORD) {
        role = 'admin';
      } else if (typeof password === 'string' && password && APP_PASSWORD && password === APP_PASSWORD) {
        role = 'user';
      }
      if (!role) {
        logAudit({ action: 'LOGIN_FAILED', email: normalizedEmail, ip: clientIp, userAgent, success: false, reason: 'Bootstrap password mismatch' });
        return invalid();
      }
      const passwordHash = await hashPassword(password);
      const user = await userStore.createUser({ email: normalizedEmail, role, passwordHash });
      setSessionCookie(res, createSessionToken(user.id, user.role));
      logAudit({ action: 'LOGIN_SUCCESS', email: normalizedEmail, ip: clientIp, userAgent, success: true, role: user.role, reason: 'Bootstrap account created' });
      return res.json({ success: true, role: user.role });
    }

    const user = await userStore.findByEmail(normalizedEmail);
    // Always run a verify (dummy hash when no user) to equalize timing.
    const passwordOk = await verifyPassword(user ? user.passwordHash : null, typeof password === 'string' ? password : '');

    if (!user || !passwordOk || user.status !== 'active') {
      logAudit({ action: 'LOGIN_FAILED', email: normalizedEmail, ip: clientIp, userAgent, success: false, reason: !user ? 'No such user' : (user.status !== 'active' ? 'Disabled' : 'Bad password') });
      return invalid();
    }

    await userStore.touchLogin(user.id);
    setSessionCookie(res, createSessionToken(user.id, user.role));
    logAudit({ action: 'LOGIN_SUCCESS', email: normalizedEmail, ip: clientIp, userAgent, success: true, role: user.role });
    return res.json({ success: true, role: user.role, mustChange: !!user.mustChange });
  } catch (e) {
    console.error('Login error:', e);
    return res.status(500).json({ success: false, error: 'Login failed. Please try again.' });
  }
});

// API: Check if authenticated (also returns the teams the caller can access so
// the client can render a team switcher without a second round-trip).
app.get('/api/auth/check', async (req, res) => {
  const { authenticated, role, user } = await getAuthStatus(req);
  let teams = [];
  try {
    if (authenticated) {
      const all = await teamStore.listTeams();
      if (role === 'admin') {
        // Platform admin (real or bootstrap) can access every team.
        teams = all.map(t => ({ id: t.id, name: t.name, roles: ['admin'], role: 'admin' }));
      } else if (user) {
        const map = new Map((user.teams || []).map(m => [m.teamId, membershipRolesOf(m)]));
        teams = all
          .filter(t => map.has(t.id))
          .map(t => {
            const roles = map.get(t.id);
            return {
              id: t.id, name: t.name, roles,
              role: roles.includes('admin') ? 'admin' : (roles[0] || 'member')
            };
          });
      }
    }
  } catch (e) {
    console.error('Failed to resolve teams for /api/auth/check:', e);
  }
  res.json({
    authenticated,
    role,
    email: user ? user.email : null,
    name: user ? user.name : null,
    mustChange: user ? !!user.mustChange : false,
    teams
  });
});

// API: Logout endpoint
app.post('/api/auth/logout', (req, res) => {
  const { userId, role } = verifySessionToken(req.cookies?.[SESSION_COOKIE_NAME]);
  const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';

  if (userId) {
    logAudit({ action: 'LOGOUT', emailHash: userId, ip: clientIp, success: true, role });
  }

  res.clearCookie(SESSION_COOKIE_NAME);
  res.json({ success: true });
});

// API: Which OAuth providers are configured (public - drives login buttons)
app.get('/api/auth/providers', (req, res) => {
  res.json(oauth.getConfiguredProviders());
});

// API: Start an OAuth login (redirects to the provider)
app.get('/api/auth/oauth/:provider/start', async (req, res) => {
  const provider = req.params.provider;
  if (!oauth.PROVIDERS.includes(provider) || !oauth.isProviderConfigured(provider)) {
    return res.redirect('/login.html?error=oauth_unavailable');
  }
  try {
    const redirectUri = `${baseUrl(req)}/api/auth/oauth/${provider}/callback`;
    const { url, state, nonce, codeVerifier } = await oauth.buildAuthRequest(provider, redirectUri);
    // Only allow relative in-app redirect targets (prevents open redirect).
    const wanted = typeof req.query.redirect === 'string' ? req.query.redirect : '';
    const safeRedirect = wanted.startsWith('/') && !wanted.startsWith('//') ? wanted : '/';
    const stateToken = signOAuthState({ provider, state, nonce, codeVerifier, redirect: safeRedirect, exp: Date.now() + OAUTH_STATE_TTL_MS });
    res.cookie(OAUTH_COOKIE_NAME, stateToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' || IS_VERCEL,
      // Apple posts the callback cross-site (form_post) -> requires SameSite=None.
      sameSite: provider === 'apple' ? 'none' : 'lax',
      maxAge: OAUTH_STATE_TTL_MS
    });
    return res.redirect(url);
  } catch (e) {
    console.error(`OAuth start error (${provider}):`, e);
    return res.redirect('/login.html?error=oauth_error');
  }
});

// API: OAuth callback (GET for Google/Vipps, POST form_post for Apple)
const oauthCallback = async (req, res) => {
  const provider = req.params.provider;
  const clientIp = req.ip || 'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';

  const stateToken = req.cookies?.[OAUTH_COOKIE_NAME];
  res.clearCookie(OAUTH_COOKIE_NAME);
  const saved = verifyOAuthState(stateToken);
  if (!saved || saved.provider !== provider) {
    return res.redirect('/login.html?error=oauth_state');
  }

  const params = req.method === 'POST' ? (req.body || {}) : (req.query || {});
  if (params.error) {
    return res.redirect('/login.html?error=oauth_denied');
  }

  try {
    const redirectUri = `${baseUrl(req)}/api/auth/oauth/${provider}/callback`;
    const identity = await oauth.handleCallback(provider, redirectUri, params, {
      state: saved.state,
      nonce: saved.nonce,
      codeVerifier: saved.codeVerifier
    });

    if (!identity.email) {
      logAudit({ action: 'OAUTH_LOGIN', email: 'unknown', ip: clientIp, userAgent, success: false, reason: `${provider}: no email`, role: null });
      return res.redirect('/login.html?error=oauth_no_email');
    }

    // Find by linked identity first, then fall back to matching an invited email.
    let user = await userStore.findByIdentity(provider, identity.sub);
    if (!user) {
      user = await userStore.findByEmail(identity.email);
      if (!user) {
        // Invite-only: unknown emails are rejected.
        logAudit({ action: 'OAUTH_LOGIN', email: identity.email, ip: clientIp, userAgent, success: false, reason: `${provider}: not invited`, role: null });
        return res.redirect('/login.html?error=not_invited');
      }
      await userStore.addIdentity(user.id, provider, identity.sub);
    }

    if (user.status !== 'active') {
      logAudit({ action: 'OAUTH_LOGIN', email: user.email, ip: clientIp, userAgent, success: false, reason: `${provider}: disabled`, role: user.role });
      return res.redirect('/login.html?error=account_disabled');
    }

    await userStore.touchLogin(user.id);
    setSessionCookie(res, createSessionToken(user.id, user.role));
    logAudit({ action: 'OAUTH_LOGIN', email: user.email, ip: clientIp, userAgent, success: true, role: user.role, reason: provider });
    const dest = typeof saved.redirect === 'string' && saved.redirect.startsWith('/') && !saved.redirect.startsWith('//') ? saved.redirect : '/';
    return res.redirect(dest);
  } catch (e) {
    console.error(`OAuth callback error (${provider}):`, e);
    return res.redirect('/login.html?error=oauth_error');
  }
};
app.get('/api/auth/oauth/:provider/callback', oauthCallback);
app.post('/api/auth/oauth/:provider/callback', oauthCallback);

// API: Change own password (authenticated). Also used to satisfy mustChange.
app.post('/api/auth/change-password', async (req, res) => {
  const status = await getAuthStatus(req);
  if (!status.authenticated || !status.user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  if (!sameOrigin(req)) {
    return res.status(403).json({ success: false, error: 'Invalid request origin' });
  }
  const { newPassword } = req.body || {};
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
  }
  try {
    const passwordHash = await hashPassword(newPassword);
    await userStore.setPassword(status.user.id, passwordHash, { mustChange: false });
    logAudit({ action: 'PASSWORD_CHANGE', email: status.user.email, ip: req.ip || 'unknown', success: true, role: status.user.role });
    return res.json({ success: true });
  } catch (e) {
    console.error('Change password error:', e);
    return res.status(500).json({ success: false, error: 'Failed to change password' });
  }
});

// API: Get audit log (admin only)
app.get('/api/audit-log', async (req, res) => {
  if (!(await isAdmin(req))) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  // Ensure log is initialized
  if (!auditLogInitialized) {
    await initAuditLog();
  }
  
  // Return last 100 entries by default, or specified limit
  const limit = Math.min(parseInt(req.query.limit) || 100, 1000);
  const entries = auditLog.slice(-limit).reverse(); // Most recent first
  
  res.json({
    total: auditLog.length,
    returned: entries.length,
    storage: IS_VERCEL ? 'vercel-blob' : 'local-file',
    entries
  });
});

// Serve static assets (CSS, JS, images) - always public
app.use('/style.css', express.static(path.join(__dirname, 'style.css')));
app.use('/config.js', express.static(path.join(__dirname, 'config.js')));
app.use('/data.js', express.static(path.join(__dirname, 'data.js')));
app.use('/ai-insights.js', express.static(path.join(__dirname, 'ai-insights.js')));
app.use('/app.js', express.static(path.join(__dirname, 'app.js')));
app.use('/admin.js', express.static(path.join(__dirname, 'admin.js')));
app.use('/platform-admin.js', express.static(path.join(__dirname, 'platform-admin.js')));
app.use('/reference-stats.js', express.static(path.join(__dirname, 'reference-stats.js')));
app.use('/team-builder.js', express.static(path.join(__dirname, 'team-builder.js')));
app.use('/recorder.css', express.static(path.join(__dirname, 'recorder.css')));
app.use('/recorder.js', express.static(path.join(__dirname, 'recorder.js')));
app.use('/recorder-aggregator.js', express.static(path.join(__dirname, 'recorder-aggregator.js')));
app.use('/recorder-clock.js', express.static(path.join(__dirname, 'recorder-clock.js')));

// ========================================
// AUTHENTICATION MIDDLEWARE
// ========================================

// Protect all routes except public ones
const authMiddleware = async (req, res, next) => {
  // Public paths that don't require authentication
  const publicPaths = [
    '/login',
    '/login.html',
    '/api/auth/login',
    '/api/auth/check',
    '/api/auth/logout',
    '/api/auth/providers',
    '/api/auth/oauth',
    '/style.css',
    '/config.js',
    '/data.js',
    '/ai-insights.js',
    '/app.js',
    '/admin.js',
    '/platform-admin.js',
    '/reference-stats.js',
    '/team-builder.js',
    '/recorder.css',
    '/recorder.js',
    '/recorder-aggregator.js',
    '/recorder-clock.js'
  ];

  // Admin-only paths (require admin role)
  const adminPaths = [
    '/admin.html',
    '/admin',
    '/platform-admin.html',
    '/platform-admin',
    '/bulk-import.html',
    '/bulk-import',
    '/reference-admin.html',
    '/reference-admin',
    '/api/users'
  ];

  // Check if path is public
  const isPublicPath = publicPaths.some(p =>
    req.path === p || req.path.startsWith(p + '/')
  );

  if (isPublicPath) {
    return next();
  }

  try {
    // Get authentication status
    const { authenticated, role } = await getAuthStatus(req);

    // Check if path requires admin access
    const requiresAdmin = adminPaths.some(p =>
      req.path === p || req.path.startsWith(p + '/')
    );

    if (requiresAdmin) {
      if (!authenticated) {
        // Not logged in at all - redirect to login
        if (req.path.startsWith('/api/')) {
          return res.status(401).json({ error: 'Authentication required' });
        }
        const returnUrl = encodeURIComponent(req.originalUrl);
        return res.redirect(`/login.html?redirect=${returnUrl}`);
      }

      if (role !== 'admin') {
        // Logged in but not admin - show access denied
        if (req.path.startsWith('/api/')) {
          return res.status(403).json({ error: 'Admin access required' });
        }
        return res.redirect(`/login.html?redirect=${encodeURIComponent(req.originalUrl)}&error=admin_required`);
      }

      // Admin authenticated - allow access
      return next();
    }

    // Regular protected path - just needs authentication
    if (authenticated) {
      return next();
    }

    // For API requests, return 401
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // For page requests, redirect to login with return URL
    const returnUrl = encodeURIComponent(req.originalUrl);
    return res.redirect(`/login.html?redirect=${returnUrl}`);
  } catch (e) {
    console.error('Auth middleware error:', e);
    return res.status(500).json({ error: 'Authentication error' });
  }
};

app.use(authMiddleware);

// ========================================
// USER MANAGEMENT API (admin only)
// ========================================
// Access control is enforced by authMiddleware (adminPaths includes /api/users).
// Mutations additionally require a same-origin request (CSRF defense).

// Reject cross-site state-changing requests.
function requireSameOrigin(req, res, next) {
  if (!sameOrigin(req)) {
    return res.status(403).json({ error: 'Invalid request origin' });
  }
  next();
}

// List all users (never exposes password hashes). Includes storage diagnostics
// so the admin UI can warn when persistence isn't configured.
app.get('/api/users', async (req, res) => {
  try {
    const users = await userStore.listUsers();
    res.json({ users, storage: userStore.getStorageInfo() });
  } catch (e) {
    console.error('List users error:', e);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

// Create a user; returns a generated one-time password for the admin to share
app.post('/api/users', requireSameOrigin, async (req, res) => {
  const { email, name, role } = req.body || {};
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'A valid email is required' });
  }
  try {
    const password = generatePassword();
    const passwordHash = await hashPassword(password);
    const user = await userStore.createUser({
      email,
      name: typeof name === 'string' ? name : '',
      role: role === 'admin' ? 'admin' : 'user',
      passwordHash
    });
    logAudit({ action: 'USER_CREATED', email: user.email, ip: req.ip || 'unknown', success: true, role: user.role });
    res.status(201).json({ user: userStore.toPublic(user), password });
  } catch (e) {
    if (e.code === 'EMAIL_EXISTS') {
      return res.status(409).json({ error: 'A user with that email already exists' });
    }
    if (e.code === 'INVALID_EMAIL') {
      return res.status(400).json({ error: 'A valid email is required' });
    }
    console.error('Create user error:', e);
    // Surface persistence-configuration problems so they aren't mistaken for
    // "it didn't save" — e.g. missing Vercel Blob store.
    if (/cannot persist/i.test(e.message || '')) {
      return res.status(503).json({ error: e.message });
    }
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Regenerate a user's password; returns the new one-time password
app.post('/api/users/:id/regenerate-password', requireSameOrigin, async (req, res) => {
  try {
    const target = await userStore.findById(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    const password = generatePassword();
    const passwordHash = await hashPassword(password);
    await userStore.setPassword(target.id, passwordHash, { mustChange: false });
    logAudit({ action: 'PASSWORD_REGENERATED', email: target.email, ip: req.ip || 'unknown', success: true, role: target.role });
    res.json({ password });
  } catch (e) {
    console.error('Regenerate password error:', e);
    res.status(500).json({ error: 'Failed to regenerate password' });
  }
});

// Update a user's name/role/status
app.patch('/api/users/:id', requireSameOrigin, async (req, res) => {
  try {
    const target = await userStore.findById(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });

    const { name, role, status } = req.body || {};

    // Prevent locking everyone out: don't demote/disable the last active admin.
    const demotingAdmin = target.role === 'admin' && role === 'user';
    const disablingAdmin = target.role === 'admin' && status === 'disabled';
    if (demotingAdmin || disablingAdmin) {
      const activeAdmins = await userStore.countActiveAdmins();
      if (activeAdmins <= 1) {
        return res.status(400).json({ error: 'Cannot demote or disable the last active admin' });
      }
    }

    const updated = await userStore.updateUser(target.id, { name, role, status });
    logAudit({ action: 'USER_UPDATED', email: updated.email, ip: req.ip || 'unknown', success: true, role: updated.role });
    res.json({ user: userStore.toPublic(updated) });
  } catch (e) {
    console.error('Update user error:', e);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Delete a user
app.delete('/api/users/:id', requireSameOrigin, async (req, res) => {
  try {
    const target = await userStore.findById(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });

    const { user: actingUser } = await getAuthStatus(req);
    if (actingUser && actingUser.id === target.id) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }
    if (target.role === 'admin' && (await userStore.countActiveAdmins()) <= 1 && target.status === 'active') {
      return res.status(400).json({ error: 'Cannot delete the last active admin' });
    }

    await userStore.deleteUser(target.id);
    logAudit({ action: 'USER_DELETED', email: target.email, ip: req.ip || 'unknown', success: true, role: target.role });
    res.json({ success: true });
  } catch (e) {
    console.error('Delete user error:', e);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Unlink an OAuth identity from a user
app.delete('/api/users/:id/identities/:provider', requireSameOrigin, async (req, res) => {
  try {
    const target = await userStore.findById(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    const updated = await userStore.removeIdentity(target.id, req.params.provider);
    logAudit({ action: 'IDENTITY_UNLINKED', email: target.email, ip: req.ip || 'unknown', success: true, role: target.role, reason: req.params.provider });
    res.json({ user: userStore.toPublic(updated) });
  } catch (e) {
    console.error('Unlink identity error:', e);
    res.status(500).json({ error: 'Failed to unlink identity' });
  }
});

// ========================================
// TEAM MANAGEMENT API
// ========================================
// Teams are the top-level tenant. Platform admins (global role=admin) manage the
// set of teams and can access all of them. Regular users get per-team roles
// ('admin' = manage members + edit data, 'member' = view-only). Every
// team-scoped request is authorized against membership to prevent IDOR.

/** Roles for a single membership entry, tolerant of legacy { role } shape. */
function membershipRolesOf(m) {
  if (!m) return [];
  if (Array.isArray(m.roles)) return m.roles.filter(Boolean);
  if (m.role) return [m.role];
  return [];
}

/** Resolve a user's roles[] within a specific team ([] if not a member). */
function teamRolesOf(user, teamId) {
  if (!user || !Array.isArray(user.teams)) return [];
  const m = user.teams.find(t => t.teamId === teamId);
  return membershipRolesOf(m);
}

/** Normalize a roles[]/role value from a request body into a lowercased array. */
function rolesFromBody(body) {
  let raw = body && body.roles !== undefined ? body.roles : (body ? body.role : undefined);
  if (!Array.isArray(raw)) raw = raw ? [raw] : [];
  return raw.map(r => String(r || '').trim().toLowerCase()).filter(Boolean);
}

/**
 * Authorize access to a team-scoped resource. Deny-by-default.
 * Returns { ok, code, error, status, platformAdmin, teamRoles }.
 */
async function resolveTeamAccess(req, teamId, { write = false } = {}) {
  const status = await getAuthStatus(req);
  if (!status.authenticated) {
    return { ok: false, code: 401, error: 'Authentication required' };
  }
  if (status.role === 'admin') {
    return { ok: true, status, platformAdmin: true, teamRoles: ['admin'] };
  }
  const roles = teamRolesOf(status.user, teamId);
  if (!roles.length) {
    return { ok: false, code: 403, error: 'You do not have access to this team' };
  }
  if (write && !roles.includes('admin')) {
    return { ok: false, code: 403, error: 'Team admin access required' };
  }
  return { ok: true, status, platformAdmin: false, teamRoles: roles };
}

// List teams accessible to the caller (platform admin sees all).
app.get('/api/teams', async (req, res) => {
  try {
    const status = await getAuthStatus(req);
    if (!status.authenticated) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const all = await teamStore.listTeams();
    let teams;
    if (status.role === 'admin') {
      teams = all.map(t => ({ ...t, roles: ['admin'], role: 'admin' }));
    } else {
      const map = new Map((status.user?.teams || []).map(m => [m.teamId, membershipRolesOf(m)]));
      teams = all.filter(t => map.has(t.id)).map(t => {
        const roles = map.get(t.id);
        return { ...t, roles, role: roles.includes('admin') ? 'admin' : (roles[0] || 'member') };
      });
    }
    res.json({
      teams,
      isPlatformAdmin: status.role === 'admin',
      storage: teamStore.getStorageInfo()
    });
  } catch (e) {
    console.error('List teams error:', e);
    res.status(500).json({ error: 'Failed to list teams' });
  }
});

// Create a team (platform admin only).
app.post('/api/teams', requireSameOrigin, async (req, res) => {
  const status = await getAuthStatus(req);
  if (!status.authenticated || status.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  try {
    const team = await teamStore.createTeam({
      name: req.body?.name,
      createdBy: status.user ? status.user.id : null
    });
    logAudit({ action: 'TEAM_CREATED', email: status.user ? status.user.email : 'bootstrap', ip: req.ip || 'unknown', success: true, reason: team.name });
    res.status(201).json({ team });
  } catch (e) {
    if (e.code === 'INVALID_NAME') return res.status(400).json({ error: 'Team name is required' });
    if (e.code === 'NAME_EXISTS') return res.status(409).json({ error: 'A team with that name already exists' });
    console.error('Create team error:', e);
    if (/cannot persist/i.test(e.message || '')) return res.status(503).json({ error: e.message });
    res.status(500).json({ error: 'Failed to create team' });
  }
});

// Rename a team (platform admin only).
app.patch('/api/teams/:teamId', requireSameOrigin, async (req, res) => {
  if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin access required' });
  try {
    const team = await teamStore.updateTeam(req.params.teamId, { name: req.body?.name });
    if (!team) return res.status(404).json({ error: 'Team not found' });
    logAudit({ action: 'TEAM_UPDATED', email: 'admin', ip: req.ip || 'unknown', success: true, reason: team.name });
    res.json({ team });
  } catch (e) {
    console.error('Update team error:', e);
    res.status(500).json({ error: 'Failed to update team' });
  }
});

// Delete a team, its data document, and all memberships (platform admin only).
app.delete('/api/teams/:teamId', requireSameOrigin, async (req, res) => {
  if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin access required' });
  try {
    const team = await teamStore.getTeam(req.params.teamId);
    if (!team) return res.status(404).json({ error: 'Team not found' });
    await teamStore.deleteTeam(team.id);
    await userStore.removeTeamFromAll(team.id);
    logAudit({ action: 'TEAM_DELETED', email: 'admin', ip: req.ip || 'unknown', success: true, reason: team.name });
    res.json({ success: true });
  } catch (e) {
    console.error('Delete team error:', e);
    res.status(500).json({ error: 'Failed to delete team' });
  }
});

// List members of a team (team admin or platform admin).
app.get('/api/teams/:teamId/members', async (req, res) => {
  const access = await resolveTeamAccess(req, req.params.teamId, { write: true });
  if (!access.ok) return res.status(access.code).json({ error: access.error });
  try {
    const members = await userStore.listByTeam(req.params.teamId);
    res.json({ members });
  } catch (e) {
    console.error('List members error:', e);
    res.status(500).json({ error: 'Failed to list members' });
  }
});

// List platform users that can be added to a team (team admin or platform admin).
// Team-admin-safe: returns only minimal { id, name, email } for active users who
// are not already members, so team admins never see the full admin-only user list.
app.get('/api/teams/:teamId/assignable-users', async (req, res) => {
  const access = await resolveTeamAccess(req, req.params.teamId, { write: true });
  if (!access.ok) return res.status(access.code).json({ error: access.error });
  try {
    const team = await teamStore.getTeam(req.params.teamId);
    if (!team) return res.status(404).json({ error: 'Team not found' });
    const all = await userStore.listUsers();
    const users = all
      .filter(u => u.status === 'active' &&
        !(u.teams || []).some(t => t.teamId === req.params.teamId))
      .map(u => ({ id: u.id, name: u.name || '', email: u.email }));
    res.json({ users });
  } catch (e) {
    console.error('List assignable users error:', e);
    res.status(500).json({ error: 'Failed to list assignable users' });
  }
});

// Add an existing user to a team with one or more roles (team admin or platform admin).
app.post('/api/teams/:teamId/members', requireSameOrigin, async (req, res) => {
  const access = await resolveTeamAccess(req, req.params.teamId, { write: true });
  if (!access.ok) return res.status(access.code).json({ error: access.error });
  const { userId, email } = req.body || {};
  let roles = rolesFromBody(req.body);
  if (!roles.length) roles = ['member'];
  try {
    const team = await teamStore.getTeam(req.params.teamId);
    if (!team) return res.status(404).json({ error: 'Team not found' });
    const target = userId
      ? await userStore.findById(userId)
      : await userStore.findByEmail(email);
    if (!target) {
      return res.status(404).json({ error: 'No such user. Create the account first on the Platform Admin page.' });
    }
    const saved = await userStore.setMembership(target.id, team.id, roles);
    logAudit({ action: 'MEMBER_ADDED', email: target.email, ip: req.ip || 'unknown', success: true, reason: `${team.name}:${saved.roles.join('+')}` });
    const updated = await userStore.findById(target.id);
    res.status(201).json({ member: { ...userStore.toPublic(updated), teamRoles: saved.roles } });
  } catch (e) {
    console.error('Add member error:', e);
    if (/cannot persist/i.test(e.message || '')) return res.status(503).json({ error: e.message });
    res.status(500).json({ error: 'Failed to add member' });
  }
});

// Change a member's team roles (team admin or platform admin).
app.patch('/api/teams/:teamId/members/:userId', requireSameOrigin, async (req, res) => {
  const access = await resolveTeamAccess(req, req.params.teamId, { write: true });
  if (!access.ok) return res.status(access.code).json({ error: access.error });
  let roles = rolesFromBody(req.body);
  if (!roles.length) roles = ['member'];
  try {
    const target = await userStore.findById(req.params.userId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    // Don't strip the last team admin by removing the admin role.
    const currentRoles = teamRolesOf(target, req.params.teamId);
    if (currentRoles.includes('admin') && !roles.includes('admin')) {
      if ((await userStore.countTeamRole(req.params.teamId, 'admin')) <= 1) {
        return res.status(400).json({ error: 'Cannot demote the last team admin' });
      }
    }
    const saved = await userStore.setMembership(target.id, req.params.teamId, roles);
    const updated = await userStore.findById(target.id);
    res.json({ member: { ...userStore.toPublic(updated), teamRoles: saved.roles } });
  } catch (e) {
    console.error('Update member error:', e);
    res.status(500).json({ error: 'Failed to update member' });
  }
});

// Remove a member from a team (team admin or platform admin).
app.delete('/api/teams/:teamId/members/:userId', requireSameOrigin, async (req, res) => {
  const access = await resolveTeamAccess(req, req.params.teamId, { write: true });
  if (!access.ok) return res.status(access.code).json({ error: access.error });
  try {
    const target = await userStore.findById(req.params.userId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (teamRolesOf(target, req.params.teamId).includes('admin') &&
        (await userStore.countTeamRole(req.params.teamId, 'admin')) <= 1) {
      return res.status(400).json({ error: 'Cannot remove the last team admin' });
    }
    await userStore.removeMembership(target.id, req.params.teamId);
    logAudit({ action: 'MEMBER_REMOVED', email: target.email, ip: req.ip || 'unknown', success: true, reason: req.params.teamId });
    res.json({ success: true });
  } catch (e) {
    console.error('Remove member error:', e);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

// Get a team's stats document (any member or platform admin).
app.get('/api/teams/:teamId/data', async (req, res) => {
  const access = await resolveTeamAccess(req, req.params.teamId, { write: false });
  if (!access.ok) return res.status(access.code).json({ error: access.error });
  try {
    const data = await teamStore.getTeamData(req.params.teamId);
    res.json(data);
  } catch (e) {
    console.error('Get team data error:', e);
    res.status(500).json({ error: 'Failed to load team data' });
  }
});

// Save a team's stats document (team admin or platform admin).
app.put('/api/teams/:teamId/data', requireSameOrigin, async (req, res) => {
  const access = await resolveTeamAccess(req, req.params.teamId, { write: true });
  if (!access.ok) return res.status(access.code).json({ error: access.error });
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Invalid data format' });
  }
  try {
    const team = await teamStore.getTeam(req.params.teamId);
    if (!team) return res.status(404).json({ error: 'Team not found' });
    const saved = await teamStore.saveTeamData(req.params.teamId, {
      players: body.players || {},
      games: Array.isArray(body.games) ? body.games : []
    });
    res.json({ success: true, games: saved.games.length, players: Object.keys(saved.players).length });
  } catch (e) {
    console.error('Save team data error:', e);
    if (/cannot persist/i.test(e.message || '')) return res.status(503).json({ error: e.message });
    res.status(500).json({ error: 'Failed to save team data' });
  }
});

// ---------- Recorder drafts (pending games) ----------
// Drafts are the mobile recorder's work-in-progress / completed games. They are
// stored separately from the live { players, games } document and are NOT part
// of the stats until a platform admin imports them from the Settings portal.
// Any team member (including the `recorder` platform role, who is added as a
// team member) may read/write drafts; only platform admins import them into
// live data via the existing admin-only PUT /api/teams/:teamId/data route.

// List a team's drafts (any team member).
app.get('/api/teams/:teamId/drafts', async (req, res) => {
  const access = await resolveTeamAccess(req, req.params.teamId, { write: false });
  if (!access.ok) return res.status(access.code).json({ error: access.error });
  try {
    const drafts = await teamStore.getDrafts(req.params.teamId);
    res.json({ drafts });
  } catch (e) {
    console.error('List drafts error:', e);
    res.status(500).json({ error: 'Failed to load drafts' });
  }
});

// Get a single draft (any team member).
app.get('/api/teams/:teamId/drafts/:draftId', async (req, res) => {
  const access = await resolveTeamAccess(req, req.params.teamId, { write: false });
  if (!access.ok) return res.status(access.code).json({ error: access.error });
  try {
    const draft = await teamStore.getDraft(req.params.teamId, req.params.draftId);
    if (!draft) return res.status(404).json({ error: 'Draft not found' });
    res.json({ draft });
  } catch (e) {
    console.error('Get draft error:', e);
    res.status(500).json({ error: 'Failed to load draft' });
  }
});

// Create or upsert a draft (any team member).
app.post('/api/teams/:teamId/drafts', requireSameOrigin, async (req, res) => {
  const access = await resolveTeamAccess(req, req.params.teamId, { write: false });
  if (!access.ok) return res.status(access.code).json({ error: access.error });
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Invalid draft format' });
  }
  try {
    const draft = await teamStore.saveDraft(req.params.teamId, body, {
      createdBy: access.status.user ? access.status.user.id : null
    });
    res.status(201).json({ draft });
  } catch (e) {
    console.error('Create draft error:', e);
    if (/cannot persist/i.test(e.message || '')) return res.status(503).json({ error: e.message });
    res.status(500).json({ error: 'Failed to save draft' });
  }
});

// Update an existing draft (any team member).
app.put('/api/teams/:teamId/drafts/:draftId', requireSameOrigin, async (req, res) => {
  const access = await resolveTeamAccess(req, req.params.teamId, { write: false });
  if (!access.ok) return res.status(access.code).json({ error: access.error });
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Invalid draft format' });
  }
  try {
    const draft = await teamStore.saveDraft(
      req.params.teamId,
      { ...body, id: req.params.draftId },
      { createdBy: access.status.user ? access.status.user.id : null }
    );
    res.json({ draft });
  } catch (e) {
    console.error('Update draft error:', e);
    if (/cannot persist/i.test(e.message || '')) return res.status(503).json({ error: e.message });
    res.status(500).json({ error: 'Failed to save draft' });
  }
});

// Delete a draft (any team member).
app.delete('/api/teams/:teamId/drafts/:draftId', requireSameOrigin, async (req, res) => {
  const access = await resolveTeamAccess(req, req.params.teamId, { write: false });
  if (!access.ok) return res.status(access.code).json({ error: access.error });
  try {
    const removed = await teamStore.deleteDraft(req.params.teamId, req.params.draftId);
    if (!removed) return res.status(404).json({ error: 'Draft not found' });
    res.json({ success: true });
  } catch (e) {
    console.error('Delete draft error:', e);
    res.status(500).json({ error: 'Failed to delete draft' });
  }
});

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

app.get('/platform-admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'platform-admin.html'));
});
app.get('/platform-admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'platform-admin.html'));
});

app.get('/team.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'team.html'));
});

// Mobile game recorder (any authenticated user; recorders are routed here on login).
app.get('/recorder.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'recorder.html'));
});
app.get('/recorder', (req, res) => {
  res.sendFile(path.join(__dirname, 'recorder.html'));
});

app.get('/team-builder.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'team-builder.html'));
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
app.post('/api/auth/verify', async (req, res) => {
  // Just check if user has valid session
  if (await isAuthenticated(req)) {
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

// ========================================
// ONE-TIME MULTI-TEAM MIGRATION
// ========================================
// On first run (no teams yet), create a "Default" team, import any pre-existing
// single dataset (JSONbin cloud or the local data file) into it, and grant all
// active platform admins team-admin on it. Idempotent: does nothing once a team
// exists. Runs on startup / cold start.
async function ensureTeamMigration() {
  try {
    if (!(await teamStore.isEmpty())) return;

    // Best-effort import of the legacy single dataset.
    let importData = { players: {}, games: [] };
    try {
      if (isCloudConfigured()) {
        const resp = await fetch(`${JSONBIN_API_URL}/${JSONBIN_BIN_ID}/latest`, {
          headers: { 'X-Master-Key': JSONBIN_API_KEY }
        });
        if (resp.ok) {
          const result = await resp.json();
          const record = result.record || {};
          if (record && Array.isArray(record.games)) {
            importData = { players: record.players || {}, games: record.games };
          }
        }
      } else if (!IS_VERCEL && fs.existsSync(dataFilePath)) {
        const parsed = JSON.parse(fs.readFileSync(dataFilePath, 'utf-8'));
        if (parsed && Array.isArray(parsed.games)) {
          importData = { players: parsed.players || {}, games: parsed.games };
        }
      }
    } catch (e) {
      console.error('Migration: failed to read legacy dataset (continuing empty):', e.message);
    }

    const team = await teamStore.createDefaultIfEmpty({ createdBy: 'system', importData });
    if (!team) return; // Another instance created it first.

    // Grant existing active admins team-admin on the default team.
    try {
      const users = await userStore.listUsers();
      for (const u of users) {
        if (u.role === 'admin' && u.status === 'active') {
          await userStore.setMembership(u.id, team.id, 'admin');
        }
      }
    } catch (e) {
      console.error('Migration: failed to seed admin memberships:', e.message);
    }
    console.log(`Migration: created Default team ${team.id} with ${importData.games.length} games`);
  } catch (e) {
    console.error('Team migration error:', e);
  }
}

// Kick off migration (non-blocking).
ensureTeamMigration();

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
