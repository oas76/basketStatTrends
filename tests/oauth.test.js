/**
 * @jest-environment node
 */
// Runs in the Node environment: under jsdom, `jose` (a transitive dep of
// openid-client) resolves to its browser ESM build, which Jest can't parse.

describe('oauth provider configuration', () => {
  const ENV_KEYS = [
    'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
    'VIPPS_CLIENT_ID', 'VIPPS_CLIENT_SECRET',
    'APPLE_SERVICES_ID', 'APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY'
  ];

  let saved;
  beforeEach(() => {
    saved = {};
    ENV_KEYS.forEach((k) => { saved[k] = process.env[k]; delete process.env[k]; });
    jest.resetModules();
  });
  afterEach(() => {
    ENV_KEYS.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
  });

  test('reports all providers unconfigured by default', () => {
    const oauth = require('../lib/oauth');
    expect(oauth.getConfiguredProviders()).toEqual({ google: false, apple: false, vipps: false });
  });

  test('detects a configured Google provider', () => {
    process.env.GOOGLE_CLIENT_ID = 'id';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    const oauth = require('../lib/oauth');
    expect(oauth.isProviderConfigured('google')).toBe(true);
    expect(oauth.isProviderConfigured('vipps')).toBe(false);
  });

  test('Apple requires services id, team id, key id and private key', () => {
    process.env.APPLE_SERVICES_ID = 'com.x.web';
    process.env.APPLE_TEAM_ID = 'TEAMID1234';
    process.env.APPLE_KEY_ID = 'KEYID12345';
    let oauth = require('../lib/oauth');
    expect(oauth.isProviderConfigured('apple')).toBe(false); // missing private key

    jest.resetModules();
    process.env.APPLE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----';
    oauth = require('../lib/oauth');
    expect(oauth.isProviderConfigured('apple')).toBe(true);
  });
});
