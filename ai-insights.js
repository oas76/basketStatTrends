/**
 * ai-insights.js
 *
 * Shared, bring-your-own-key (BYOK) AI client used by both the player insights
 * page (app.js / index.html) and the team coaching panel (team.html).
 *
 * Design / security notes:
 * - Keys are provided by the end user and live ONLY in the browser. By default
 *   they are kept in sessionStorage (cleared when the tab closes); an opt-in
 *   "remember" flag persists them in localStorage instead. Requests go directly
 *   from the browser to the chosen provider, so keys are never sent to our
 *   server. This is the accepted pattern for a client-only integration.
 * - Provider model IDs rotate over time and calling a retired model returns an
 *   error. Each provider has a sensible current default, and the user can set a
 *   per-provider model override in the AI settings if a default is deprecated.
 *
 * Exposed as `window.AIInsights` in the browser and via `module.exports` for
 * Node-based unit tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.AIInsights = api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  const STORAGE_KEY = 'basketstat-ai-key';
  const PROVIDER_KEY = 'basketstat-ai-provider';
  const MODEL_KEY = 'basketstat-ai-model';
  const REMEMBERED_FLAG = STORAGE_KEY + '-remembered';
  const DEFAULT_PROVIDER = 'groq';

  const MAX_RETRIES = 3;
  const BASE_DELAY = 2000;

  // Current provider configurations. Model IDs verified current; if a provider
  // retires a model, the per-provider override lets a user fix it without a
  // code change.
  const PROVIDERS = {
    groq: {
      name: 'Groq',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      model: 'openai/gpt-oss-120b',
      helpUrl: 'https://console.groq.com/keys',
      helpText: 'Get free key at console.groq.com',
      type: 'openai'
    },
    openai: {
      name: 'OpenAI',
      url: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-5.4-nano',
      helpUrl: 'https://platform.openai.com/api-keys',
      helpText: 'Get key at platform.openai.com',
      type: 'openai'
    },
    anthropic: {
      name: 'Anthropic',
      url: 'https://api.anthropic.com/v1/messages',
      model: 'claude-sonnet-4-5',
      helpUrl: 'https://console.anthropic.com/settings/keys',
      helpText: 'Get key at console.anthropic.com',
      type: 'anthropic'
    },
    gemini: {
      name: 'Google Gemini',
      // Gemini's endpoint embeds the model in the path, so we keep a base and
      // build the full URL from the active model at call time.
      urlBase: 'https://generativelanguage.googleapis.com/v1beta/models',
      model: 'gemini-3.6-flash',
      helpUrl: 'https://aistudio.google.com/app/apikey',
      helpText: 'Get free key at aistudio.google.com',
      type: 'gemini'
    }
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Storage access that no-ops gracefully outside the browser (Node tests).
  const safeStore = (kind) => {
    try {
      const store = kind === 'local'
        ? (typeof localStorage !== 'undefined' ? localStorage : null)
        : (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
      return store;
    } catch (e) {
      return null;
    }
  };
  const local = () => safeStore('local');
  const session = () => safeStore('session');

  const validProvider = (p) => (p && PROVIDERS[p]) ? p : DEFAULT_PROVIDER;

  const getProvider = () => {
    const ls = local();
    const ss = session();
    return validProvider(
      (ls && ls.getItem(PROVIDER_KEY)) ||
      (ss && ss.getItem(PROVIDER_KEY)) ||
      DEFAULT_PROVIDER
    );
  };

  const isRememberedFlag = () => {
    const ls = local();
    return !!(ls && ls.getItem(REMEMBERED_FLAG));
  };

  /**
   * Persist the active provider. If `remember` is omitted, mirror the existing
   * remembered state so the caller doesn't have to know about it.
   */
  const setProvider = (provider, remember) => {
    const p = validProvider(provider);
    const ss = session();
    if (ss) ss.setItem(PROVIDER_KEY, p);
    const shouldRemember = (remember === undefined) ? isRememberedFlag() : !!remember;
    const ls = local();
    if (ls && shouldRemember) ls.setItem(PROVIDER_KEY, p);
  };

  const keyName = (provider) => STORAGE_KEY + '-' + validProvider(provider);
  const modelName = (provider) => MODEL_KEY + '-' + validProvider(provider);

  const isApiKeyRemembered = (provider) => {
    const ls = local();
    return !!(ls && ls.getItem(keyName(provider || getProvider())));
  };

  const loadApiKey = (provider) => {
    const p = provider || getProvider();
    const ls = local();
    const ss = session();
    return (ls && ls.getItem(keyName(p))) ||
           (ss && ss.getItem(keyName(p))) || '';
  };

  const saveApiKey = (key, remember, provider) => {
    const p = provider || getProvider();
    const ls = local();
    const ss = session();
    if (key) {
      if (remember) {
        if (ls) {
          ls.setItem(keyName(p), key);
          ls.setItem(REMEMBERED_FLAG, 'true');
          ls.setItem(PROVIDER_KEY, p);
        }
        if (ss) ss.removeItem(keyName(p));
      } else {
        if (ss) ss.setItem(keyName(p), key);
        if (ls) ls.removeItem(keyName(p));
      }
    } else {
      if (ss) ss.removeItem(keyName(p));
      if (ls) ls.removeItem(keyName(p));
    }
  };

  const forgetApiKey = (provider) => {
    const p = provider || getProvider();
    const ls = local();
    if (ls) {
      ls.removeItem(keyName(p));
      ls.removeItem(REMEMBERED_FLAG);
      ls.removeItem(PROVIDER_KEY);
    }
  };

  /** Read the user's per-provider model override (empty string if none). */
  const getModelOverride = (provider) => {
    const p = provider || getProvider();
    const ls = local();
    const ss = session();
    return ((ls && ls.getItem(modelName(p))) ||
            (ss && ss.getItem(modelName(p))) || '').trim();
  };

  /**
   * Save a per-provider model override. Empty/blank clears it. Mirrors the
   * key's remember behaviour so it persists alongside a remembered key.
   */
  const setModelOverride = (model, remember, provider) => {
    const p = provider || getProvider();
    const ls = local();
    const ss = session();
    const value = (model || '').trim();
    const shouldRemember = (remember === undefined) ? isApiKeyRemembered(p) : !!remember;
    if (value) {
      if (shouldRemember) {
        if (ls) ls.setItem(modelName(p), value);
        if (ss) ss.removeItem(modelName(p));
      } else {
        if (ss) ss.setItem(modelName(p), value);
        if (ls) ls.removeItem(modelName(p));
      }
    } else {
      if (ss) ss.removeItem(modelName(p));
      if (ls) ls.removeItem(modelName(p));
    }
  };

  /** Resolve the model to use: explicit override, else provider default. */
  const getActiveModel = (provider) => {
    const p = validProvider(provider || getProvider());
    return getModelOverride(p) || PROVIDERS[p].model;
  };

  const deprecatedModelError = (providerName, model) =>
    new Error('[' + providerName + '] Model "' + model + '" is unavailable ' +
      '(it may have been deprecated). Open AI settings and set a current model, ' +
      'or switch providers.');

  const looksLikeModelError = (msg) => {
    const m = (msg || '').toLowerCase();
    return m.includes('model') && (
      m.includes('not found') || m.includes('does not exist') ||
      m.includes('deprecated') || m.includes('decommission') ||
      m.includes('unsupported') || m.includes('no longer')
    );
  };

  /**
   * Call an OpenAI-compatible chat completions endpoint (Groq, OpenAI).
   */
  const callOpenAiCompatible = async (prompt, apiKey, config, opts, retryCount = 0) => {
    const options = opts || {};
    const model = options.model || config.model;
    try {
      const response = await fetch(config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: options.system || 'You are a helpful basketball coach. Be encouraging, specific, and concise.' },
            { role: 'user', content: prompt }
          ],
          temperature: options.temperature != null ? options.temperature : 0.7,
          max_tokens: options.maxTokens || 1024
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const errorMsg = (error.error && error.error.message) || error.message || '';
        console.error('[AI] ' + config.name + ' error:', response.status, errorMsg);

        if (response.status === 429 && retryCount < MAX_RETRIES) {
          const retryAfter = parseInt(response.headers.get('retry-after') || '0', 10) * 1000;
          const delay = Math.max(retryAfter, BASE_DELAY * Math.pow(2, retryCount));
          console.log('[AI] Rate limited. Retrying in ' + (delay / 1000) + 's (attempt ' + (retryCount + 1) + '/' + MAX_RETRIES + ')');
          await sleep(delay);
          return callOpenAiCompatible(prompt, apiKey, config, options, retryCount + 1);
        }

        if (response.status === 404 || looksLikeModelError(errorMsg)) {
          throw deprecatedModelError(config.name, model);
        }
        if (response.status === 401) {
          throw new Error('[' + config.name + '] Invalid API key. Please check your API key.');
        }
        if (response.status === 429) {
          throw new Error('[' + config.name + '] Rate limit exceeded. Please wait 1-2 minutes or switch to Groq (more generous limits).');
        }
        if (response.status === 402 || errorMsg.includes('billing') || errorMsg.includes('quota')) {
          throw new Error('[' + config.name + '] Billing/quota issue. Check your account balance or try Groq (free tier).');
        }
        throw new Error('[' + config.name + '] ' + (errorMsg || ('API error: ' + response.status)));
      }

      const data = await response.json();
      return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || 'No response generated';
    } catch (error) {
      if (error.name === 'TypeError' && retryCount < MAX_RETRIES) {
        const delay = BASE_DELAY * Math.pow(2, retryCount);
        console.log('[AI] Network error. Retrying in ' + (delay / 1000) + 's...');
        await sleep(delay);
        return callOpenAiCompatible(prompt, apiKey, config, options, retryCount + 1);
      }
      throw error;
    }
  };

  /**
   * Call the Google Gemini generateContent endpoint. Uses the x-goog-api-key
   * header (Google's recommended method) rather than a ?key= query param.
   */
  const callGemini = async (prompt, apiKey, config, opts, retryCount = 0) => {
    const options = opts || {};
    const model = options.model || config.model;
    const url = config.urlBase + '/' + model + ':generateContent';
    // Gemini has no dedicated system role; prepend any system guidance.
    const text = options.system ? (options.system + '\n\n' + prompt) : prompt;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: text }] }],
          generationConfig: {
            temperature: options.temperature != null ? options.temperature : 0.7,
            maxOutputTokens: options.maxTokens || 1024
          }
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const errorMsg = (error.error && error.error.message) || error.message || '';
        console.error('[AI] Gemini error:', response.status, errorMsg);

        if (response.status === 429 && retryCount < MAX_RETRIES) {
          const delay = BASE_DELAY * Math.pow(2, retryCount);
          console.log('[AI] Rate limited. Retrying in ' + (delay / 1000) + 's (attempt ' + (retryCount + 1) + '/' + MAX_RETRIES + ')');
          await sleep(delay);
          return callGemini(prompt, apiKey, config, options, retryCount + 1);
        }

        if (response.status === 404 || looksLikeModelError(errorMsg)) {
          throw deprecatedModelError('Gemini', model);
        }
        if (response.status === 400) {
          if (errorMsg.toLowerCase().includes('api key')) {
            throw new Error('[Gemini] Invalid API key. Please check your API key.');
          }
          throw new Error('[Gemini] Request error: ' + (errorMsg || 'Bad request'));
        }
        if (response.status === 403) {
          throw new Error('[Gemini] Access denied. Your API key may not have access to this model.');
        }
        if (response.status === 429) {
          throw new Error('[Gemini] Rate limit exceeded. Please wait 1-2 minutes or switch to Groq (more generous limits).');
        }
        throw new Error('[Gemini] ' + (errorMsg || ('API error: ' + response.status)));
      }

      const data = await response.json();
      return (data.candidates && data.candidates[0] && data.candidates[0].content &&
              data.candidates[0].content.parts && data.candidates[0].content.parts[0] &&
              data.candidates[0].content.parts[0].text) || 'No response generated';
    } catch (error) {
      if (error.name === 'TypeError' && retryCount < MAX_RETRIES) {
        const delay = BASE_DELAY * Math.pow(2, retryCount);
        console.log('[AI] Network error. Retrying in ' + (delay / 1000) + 's...');
        await sleep(delay);
        return callGemini(prompt, apiKey, config, options, retryCount + 1);
      }
      throw error;
    }
  };

  /**
   * Call the Anthropic Messages API.
   */
  const callAnthropic = async (prompt, apiKey, config, opts, retryCount = 0) => {
    const options = opts || {};
    const model = options.model || config.model;
    try {
      const body = {
        model: model,
        max_tokens: options.maxTokens || 1024,
        temperature: options.temperature != null ? options.temperature : 0.7,
        messages: [{ role: 'user', content: prompt }]
      };
      if (options.system) body.system = options.system;

      const response = await fetch(config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          // Required for browser-based (CORS) calls to the Anthropic API.
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const errorMsg = (error.error && error.error.message) || error.message || '';
        console.error('[AI] Anthropic error:', response.status, errorMsg);

        if (response.status === 429 && retryCount < MAX_RETRIES) {
          const retryAfter = parseInt(response.headers.get('retry-after') || '0', 10) * 1000;
          const delay = Math.max(retryAfter, BASE_DELAY * Math.pow(2, retryCount));
          console.log('[AI] Rate limited. Retrying in ' + (delay / 1000) + 's (attempt ' + (retryCount + 1) + '/' + MAX_RETRIES + ')');
          await sleep(delay);
          return callAnthropic(prompt, apiKey, config, options, retryCount + 1);
        }

        if (response.status === 404 || looksLikeModelError(errorMsg)) {
          throw deprecatedModelError('Anthropic', model);
        }
        if (response.status === 401) {
          throw new Error('[Anthropic] Invalid API key. Please check your API key.');
        }
        if (response.status === 403) {
          throw new Error('[Anthropic] Access denied. Check workspace access and API key permissions.');
        }
        if (response.status === 429) {
          throw new Error('[Anthropic] Rate limit exceeded. Please wait a minute and try again.');
        }
        if (errorMsg.toLowerCase().includes('credit') || errorMsg.toLowerCase().includes('billing')) {
          throw new Error('[Anthropic] Billing/quota issue. ' + errorMsg);
        }
        throw new Error('[Anthropic] ' + (errorMsg || ('API error: ' + response.status)));
      }

      const data = await response.json();
      return (data.content && data.content.map((part) => part.text || '').join('\n').trim()) || 'No response generated';
    } catch (error) {
      if (error.name === 'TypeError' && retryCount < MAX_RETRIES) {
        const delay = BASE_DELAY * Math.pow(2, retryCount);
        console.log('[AI] Network error. Retrying in ' + (delay / 1000) + 's...');
        await sleep(delay);
        return callAnthropic(prompt, apiKey, config, options, retryCount + 1);
      }
      throw error;
    }
  };

  /**
   * High-level dispatcher. Resolves provider, key, and model from storage
   * unless explicitly provided, then routes to the correct provider client.
   *
   * @param {Object} params
   * @param {string} params.prompt      - The user prompt (required).
   * @param {string} [params.system]    - Optional system/persona instruction.
   * @param {number} [params.maxTokens] - Optional max output tokens.
   * @param {number} [params.temperature]
   * @param {string} [params.provider]  - Override the stored provider.
   * @param {string} [params.apiKey]    - Override the stored API key.
   * @param {string} [params.model]     - Override the resolved model.
   * @returns {Promise<string>}
   */
  const callAi = async (params) => {
    const p = params || {};
    const providerKey = validProvider(p.provider || getProvider());
    const config = PROVIDERS[providerKey];
    const apiKey = p.apiKey || loadApiKey(providerKey);
    const model = p.model || getActiveModel(providerKey);

    if (!apiKey) {
      throw new Error('[' + config.name + '] No API key configured. Open AI settings to add your key.');
    }
    if (apiKey.length < 10) {
      throw new Error('[' + config.name + '] Invalid API key format. Please re-enter your API key.');
    }
    if (!p.prompt) {
      throw new Error('[' + config.name + '] No prompt provided.');
    }

    const opts = {
      system: p.system,
      maxTokens: p.maxTokens,
      temperature: p.temperature,
      model: model
    };

    console.log('[AI] Calling ' + config.name + ' (' + model + ')...');

    if (config.type === 'openai') {
      return callOpenAiCompatible(p.prompt, apiKey, config, opts);
    } else if (config.type === 'anthropic') {
      return callAnthropic(p.prompt, apiKey, config, opts);
    } else if (config.type === 'gemini') {
      return callGemini(p.prompt, apiKey, config, opts);
    }
    throw new Error('Unknown provider type: ' + config.type);
  };

  return {
    PROVIDERS: PROVIDERS,
    STORAGE_KEY: STORAGE_KEY,
    PROVIDER_KEY: PROVIDER_KEY,
    MODEL_KEY: MODEL_KEY,
    DEFAULT_PROVIDER: DEFAULT_PROVIDER,
    // storage
    getProvider: getProvider,
    setProvider: setProvider,
    isApiKeyRemembered: isApiKeyRemembered,
    loadApiKey: loadApiKey,
    saveApiKey: saveApiKey,
    forgetApiKey: forgetApiKey,
    getModelOverride: getModelOverride,
    setModelOverride: setModelOverride,
    getActiveModel: getActiveModel,
    // network
    callOpenAiCompatible: callOpenAiCompatible,
    callGemini: callGemini,
    callAnthropic: callAnthropic,
    callAi: callAi
  };
});
