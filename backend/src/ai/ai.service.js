/**
 * AI provider service — BACKEND ONLY. API keys never reach the frontend.
 *
 * Provider abstraction (env-driven, no hard-coded provider):
 *   1. OPENAI_API_KEY  -> OpenAI Chat Completions (OPENAI_MODEL).
 *   2. GOOGLE_API_KEY  -> Google Generative Language API (GOOGLE_MODEL).
 *   3. Neither         -> deterministic OFFLINE mode ({offline:true}) so the
 *                         app stays fully functional without any provider.
 *
 * All requests carry a hard timeout; failures fail closed to offline mode
 * (never throw) so chat/agent flows degrade gracefully.
 */
const config = require('../config/env');

const TIMEOUT_MS = 30000;

async function openaiChat({ systemPrompt, messages, maxTokens }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.openai.apiKey}`,
    },
    body: JSON.stringify({
      model: config.openai.model,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      max_tokens: maxTokens,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function googleChat({ systemPrompt, messages, maxTokens }) {
  const model = config.google.model;
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(m.content || '') }],
  }));
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.google.apiKey,
      },
      body: JSON.stringify({
        ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
        contents,
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }
  );
  if (!res.ok) throw new Error(`Google HTTP ${res.status}`);
  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || '').join('').trim();
}

/** Which provider would handle the next call (for diagnostics; no secrets). */
function activeProvider() {
  if (config.openai.apiKey) return { provider: 'openai', model: config.openai.model };
  if (config.google.apiKey) return { provider: 'google', model: config.google.model };
  return { provider: 'offline', model: '' };
}

async function chatCompletion({ systemPrompt, messages, maxTokens = 800 }) {
  const target = activeProvider();
  if (target.provider === 'offline') return { offline: true, content: null, provider: 'offline' };
  try {
    const content = target.provider === 'openai'
      ? await openaiChat({ systemPrompt, messages, maxTokens })
      : await googleChat({ systemPrompt, messages, maxTokens });
    return { offline: false, content, provider: target.provider };
  } catch {
    // Fail closed to offline on any provider error (never throw, never leak).
    return { offline: true, content: null, provider: target.provider };
  }
}

module.exports = { chatCompletion, activeProvider };
