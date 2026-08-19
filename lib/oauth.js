// ========================================
// OAUTH / OIDC (Google, Apple, Vipps)
// ========================================
// All three providers are OpenID Connect compliant, so a single code path with
// per-provider configuration handles them. Uses openid-client (Authorization
// Code flow + PKCE + state + nonce). Apple's client_secret is a short-lived
// ES256 JWT signed from its .p8 key.

const { Issuer, generators } = require('openid-client');
const { SignJWT, importPKCS8 } = require('jose');

const PROVIDERS = ['google', 'apple', 'vipps'];

function vippsBaseUrl() {
  // Default to production; set VIPPS_TEST=1 to use the test environment.
  return process.env.VIPPS_TEST === '1'
    ? 'https://apitest.vipps.no/access-management-1.0/access'
    : 'https://api.vipps.no/access-management-1.0/access';
}

function providerConfig(provider) {
  switch (provider) {
    case 'google':
      return {
        discovery: 'https://accounts.google.com/.well-known/openid-configuration',
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        scope: 'openid email profile',
        authMethod: 'client_secret_basic'
      };
    case 'vipps':
      return {
        discovery: `${vippsBaseUrl()}/.well-known/openid-configuration`,
        clientId: process.env.VIPPS_CLIENT_ID,
        clientSecret: process.env.VIPPS_CLIENT_SECRET,
        scope: 'openid email name',
        authMethod: 'client_secret_post'
      };
    case 'apple':
      return {
        discovery: 'https://appleid.apple.com/.well-known/openid-configuration',
        clientId: process.env.APPLE_SERVICES_ID,
        scope: 'openid email name',
        authMethod: 'client_secret_post',
        teamId: process.env.APPLE_TEAM_ID,
        keyId: process.env.APPLE_KEY_ID,
        privateKey: process.env.APPLE_PRIVATE_KEY
      };
    default:
      return null;
  }
}

function isProviderConfigured(provider) {
  const cfg = providerConfig(provider);
  if (!cfg) return false;
  if (provider === 'apple') {
    return !!(cfg.clientId && cfg.teamId && cfg.keyId && cfg.privateKey);
  }
  return !!(cfg.clientId && cfg.clientSecret);
}

function getConfiguredProviders() {
  return PROVIDERS.reduce((acc, p) => {
    acc[p] = isProviderConfigured(p);
    return acc;
  }, {});
}

// Cache discovered issuers (their metadata rarely changes).
const issuerCache = {};

async function getIssuer(provider) {
  if (issuerCache[provider]) return issuerCache[provider];
  const cfg = providerConfig(provider);
  const issuer = await Issuer.discover(cfg.discovery);
  issuerCache[provider] = issuer;
  return issuer;
}

/** Generate Apple's short-lived (5 min) ES256 client-secret JWT. */
async function appleClientSecret(cfg) {
  const pem = String(cfg.privateKey).replace(/\\n/g, '\n');
  const key = await importPKCS8(pem, 'ES256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: cfg.keyId })
    .setIssuer(cfg.teamId)
    .setIssuedAt()
    .setExpirationTime('5m')
    .setAudience('https://appleid.apple.com')
    .setSubject(cfg.clientId)
    .sign(key);
}

async function getClient(provider, redirectUri) {
  const cfg = providerConfig(provider);
  const issuer = await getIssuer(provider);
  const clientSecret =
    provider === 'apple' ? await appleClientSecret(cfg) : cfg.clientSecret;
  return new issuer.Client({
    client_id: cfg.clientId,
    client_secret: clientSecret,
    redirect_uris: [redirectUri],
    response_types: ['code'],
    token_endpoint_auth_method: cfg.authMethod
  });
}

/**
 * Build the authorization redirect URL and the anti-forgery values that must be
 * stored server-side (in a signed cookie) until the callback.
 * @returns {Promise<{url:string, state:string, nonce:string, codeVerifier:string}>}
 */
async function buildAuthRequest(provider, redirectUri) {
  const cfg = providerConfig(provider);
  const client = await getClient(provider, redirectUri);

  const codeVerifier = generators.codeVerifier();
  const codeChallenge = generators.codeChallenge(codeVerifier);
  const state = generators.state();
  const nonce = generators.nonce();

  const params = {
    scope: cfg.scope,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  };
  // Apple requires form_post when email/name scopes are requested.
  if (provider === 'apple') params.response_mode = 'form_post';

  const url = client.authorizationUrl(params);
  return { url, state, nonce, codeVerifier };
}

/**
 * Complete the OAuth callback: validate state/nonce/PKCE, exchange the code,
 * verify the id_token, and return the normalized identity.
 * @param {string} provider
 * @param {string} redirectUri
 * @param {object} params - raw query (GET) or body (POST form_post) params
 * @param {{state:string, nonce:string, codeVerifier:string}} checks
 * @returns {Promise<{sub:string, email:string|null, name:string}>}
 */
async function handleCallback(provider, redirectUri, params, checks) {
  const client = await getClient(provider, redirectUri);
  const tokenSet = await client.callback(redirectUri, params, {
    state: checks.state,
    nonce: checks.nonce,
    code_verifier: checks.codeVerifier,
    response_type: 'code'
  });

  const claims = tokenSet.claims();
  let email = claims.email || null;
  let name = claims.name || '';

  // Apple returns the user's name only on first consent, in a `user` field.
  if (provider === 'apple' && params && params.user) {
    try {
      const u = typeof params.user === 'string' ? JSON.parse(params.user) : params.user;
      if (u && u.name) name = [u.name.firstName, u.name.lastName].filter(Boolean).join(' ');
    } catch {
      /* ignore malformed user field */
    }
  }

  // Fall back to userinfo (Vipps delivers email/name there) when needed.
  if ((!email || !name) && client.issuer.metadata.userinfo_endpoint) {
    try {
      const ui = await client.userinfo(tokenSet);
      email = email || ui.email || null;
      name = name || ui.name || [ui.given_name, ui.family_name].filter(Boolean).join(' ');
    } catch {
      /* userinfo optional */
    }
  }

  return {
    sub: claims.sub,
    email: email ? String(email).trim().toLowerCase() : null,
    name: String(name || '').trim()
  };
}

module.exports = {
  PROVIDERS,
  isProviderConfigured,
  getConfiguredProviders,
  buildAuthRequest,
  handleCallback
};
