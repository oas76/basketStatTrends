const AIInsights = require('../ai-insights');

/**
 * Build a fake fetch Response.
 */
const makeResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  json: () => Promise.resolve(body)
});

const API_KEY = 'test-api-key-1234567890';

describe('AIInsights.PROVIDERS', () => {
  test('exposes the four providers with current model IDs and types', () => {
    const p = AIInsights.PROVIDERS;

    expect(p.groq.model).toBe('openai/gpt-oss-120b');
    expect(p.groq.type).toBe('openai');
    expect(p.groq.url).toBe('https://api.groq.com/openai/v1/chat/completions');

    expect(p.openai.model).toBe('gpt-5.4-nano');
    expect(p.openai.type).toBe('openai');

    expect(p.anthropic.model).toBe('claude-sonnet-4-5');
    expect(p.anthropic.type).toBe('anthropic');

    expect(p.gemini.model).toBe('gemini-3.6-flash');
    expect(p.gemini.type).toBe('gemini');
    expect(p.gemini.urlBase).toBe('https://generativelanguage.googleapis.com/v1beta/models');
  });

  test('no provider references a retired model', () => {
    const serialized = JSON.stringify(AIInsights.PROVIDERS);
    expect(serialized).not.toContain('gemini-2.0-flash');
    expect(serialized).not.toContain('llama-3.3-70b-versatile');
    expect(serialized).not.toContain('gpt-4o-mini');
  });

  test('getActiveModel falls back to the provider default', () => {
    expect(AIInsights.getActiveModel('gemini')).toBe('gemini-3.6-flash');
    expect(AIInsights.getActiveModel('groq')).toBe('openai/gpt-oss-120b');
  });
});

describe('provider network calls', () => {
  afterEach(() => {
    delete global.fetch;
  });

  test('Gemini uses the x-goog-api-key header and no ?key= query param', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      makeResponse(200, { candidates: [{ content: { parts: [{ text: 'hello team' }] } }] })
    );

    const result = await AIInsights.callAi({
      provider: 'gemini',
      apiKey: API_KEY,
      prompt: 'Analyze the team'
    });

    expect(result).toBe('hello team');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent');
    expect(url).not.toContain('?key=');
    expect(opts.headers['x-goog-api-key']).toBe(API_KEY);
    expect(opts.headers.Authorization).toBeUndefined();
  });

  test('OpenAI-compatible providers send a Bearer token', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      makeResponse(200, { choices: [{ message: { content: 'groq says hi' } }] })
    );

    const result = await AIInsights.callAi({
      provider: 'groq',
      apiKey: API_KEY,
      prompt: 'Analyze the player'
    });

    expect(result).toBe('groq says hi');
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(opts.headers.Authorization).toBe('Bearer ' + API_KEY);
    const body = JSON.parse(opts.body);
    expect(body.model).toBe('openai/gpt-oss-120b');
  });

  test('Anthropic sends x-api-key and the version header', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      makeResponse(200, { content: [{ text: 'claude analysis' }] })
    );

    const result = await AIInsights.callAi({
      provider: 'anthropic',
      apiKey: API_KEY,
      prompt: 'Analyze',
      system: 'You are a coach'
    });

    expect(result).toBe('claude analysis');
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(opts.headers['x-api-key']).toBe(API_KEY);
    expect(opts.headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(opts.body);
    expect(body.model).toBe('claude-sonnet-4-5');
    expect(body.system).toBe('You are a coach');
  });
});

describe('dispatcher behaviour', () => {
  afterEach(() => {
    delete global.fetch;
  });

  test('routes to the correct endpoint based on provider type', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      makeResponse(200, { choices: [{ message: { content: 'ok' } }] })
    );
    await AIInsights.callAi({ provider: 'openai', apiKey: API_KEY, prompt: 'x' });
    expect(global.fetch.mock.calls[0][0]).toBe('https://api.openai.com/v1/chat/completions');
  });

  test('applies an explicit model override', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      makeResponse(200, { candidates: [{ content: { parts: [{ text: 'ok' }] } }] })
    );
    await AIInsights.callAi({
      provider: 'gemini',
      apiKey: API_KEY,
      model: 'gemini-9.9-custom',
      prompt: 'x'
    });
    expect(global.fetch.mock.calls[0][0]).toContain('gemini-9.9-custom:generateContent');
  });

  test('throws a clear error when no API key is available', async () => {
    global.fetch = jest.fn();
    await expect(
      AIInsights.callAi({ provider: 'groq', apiKey: '', prompt: 'x' })
    ).rejects.toThrow(/No API key configured/);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('deprecated-model error mapping', () => {
  afterEach(() => {
    delete global.fetch;
  });

  test('maps a 404 from an OpenAI-compatible provider to a deprecation hint', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      makeResponse(404, { error: { message: 'The model does not exist' } })
    );
    await expect(
      AIInsights.callAi({ provider: 'groq', apiKey: API_KEY, prompt: 'x' })
    ).rejects.toThrow(/deprecated/i);
  });

  test('maps a 404 from Gemini to a deprecation hint', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      makeResponse(404, { error: { message: 'model not found' } })
    );
    await expect(
      AIInsights.callAi({ provider: 'gemini', apiKey: API_KEY, prompt: 'x' })
    ).rejects.toThrow(/deprecated/i);
  });

  test('maps a "no longer supported" 400 to a deprecation hint', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      makeResponse(400, { error: { message: 'This model is no longer supported' } })
    );
    await expect(
      AIInsights.callAi({ provider: 'openai', apiKey: API_KEY, prompt: 'x' })
    ).rejects.toThrow(/deprecated/i);
  });
});
