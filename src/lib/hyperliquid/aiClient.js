/**
 * AI ANALYST (BYOK, browser → provider directly, proposals only)
 * ---------------------------------------------------------------------------
 * The user's AI key goes straight from this browser to the provider. It is
 * sent only in the Authorization header and is never logged, stored, or sent
 * anywhere else. The model's answer is parsed as DATA: it can propose intents,
 * never execute them. Every proposal goes through engine.validateProposal,
 * the user's rules, the caps check, and a human approval first.
 */

import { validateProposal } from './engine.js';

export const AI_CLIENT_CODES = Object.freeze({
  NOT_HTTPS: 'AI_NOT_HTTPS',
  NO_KEY: 'AI_NO_KEY',
  NETWORK: 'AI_NETWORK',
  HTTP_ERROR: 'AI_HTTP_ERROR',
  TIMEOUT: 'AI_TIMEOUT',
  BAD_OUTPUT: 'AI_BAD_OUTPUT'
});

export const AI_DEFAULT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
export const AI_MAX_PROPOSALS = 3;

const SYSTEM_PROMPT = [
  'You are a cautious trading analyst for Hyperliquid perpetual markets.',
  'You never promise profit. You never claim certainty. If there is no clear setup, propose nothing.',
  'You do not execute anything. You only propose, and a human approves every proposal.',
  'Reply with ONE JSON object and nothing else, in this shape:',
  '{"proposals":[{"coin":"BTC","side":"long","notionalUsd":100,"leverage":2,"stopLossPct":0.02,"rationale":"..."}]}',
  'Rules: coin must be one of limits.allowedCoins; side is "long" or "short"; leverage is an integer from 1 to the maximum given;',
  'stopLossPct is a decimal between 0.001 and the maximum given (0.02 means 2%); notionalUsd is a positive number, at most the per-order maximum.',
  'Write rationale in Persian, under 200 characters. Return at most the number of proposals requested.'
].join('\n');

/** Builds the messages. The key is never part of them. */
export function buildAnalystMessages({ rules, caps, account, mids, candles, maxProposals = AI_MAX_PROPOSALS }) {
  const context = {
    strategy: rules.strategy,
    userNotes: rules.notes,
    maxProposals: Math.min(maxProposals, AI_MAX_PROPOSALS),
    limits: {
      maxOrderUsd: caps.maxOrderUsd,
      maxLeverage: caps.maxLeverage,
      maxStopLossPct: caps.maxStopLossPct,
      allowedCoins: caps.allowedCoins
    },
    account,
    mids,
    candles1h: candles
  };
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify(context) }
  ];
}

/** Pulls the first JSON object out of a model reply, tolerating code fences. */
export function extractJson(text) {
  if (typeof text !== 'string') return null;
  const cleaned = text.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Parses a model reply into validated intents plus the reasons for any dropped. */
export function parseProposals(text, limits) {
  const obj = extractJson(text);
  if (!obj || !Array.isArray(obj.proposals)) return { ok: false, code: AI_CLIENT_CODES.BAD_OUTPUT, proposals: [], dropped: [] };
  const proposals = [];
  const dropped = [];
  for (const raw of obj.proposals.slice(0, AI_MAX_PROPOSALS)) {
    const res = validateProposal(raw, limits);
    if (res.ok) proposals.push(res.intent);
    else dropped.push(res.code);
  }
  return { ok: true, proposals, dropped };
}

/**
 * One analysis call. Returns validated proposals only.
 * @param {object} args
 * @param {string} args.apiKey     the user's AI key (session memory only)
 * @param {string} args.endpoint   OpenAI-compatible chat completions URL (https only)
 * @param {string} args.model      model name the user chose
 */
export async function requestProposals({
  apiKey, endpoint = AI_DEFAULT_ENDPOINT, model, messages, limits,
  fetchImpl = globalThis.fetch, timeoutMs = 45000
}) {
  if (!apiKey) return { ok: false, code: AI_CLIENT_CODES.NO_KEY };
  let url;
  try { url = new URL(endpoint); } catch { return { ok: false, code: AI_CLIENT_CODES.NOT_HTTPS }; }
  if (url.protocol !== 'https:') return { ok: false, code: AI_CLIENT_CODES.NOT_HTTPS };
  if (typeof fetchImpl !== 'function') return { ok: false, code: AI_CLIENT_CODES.NETWORK };

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(url.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature: 0.2 }),
      signal: controller?.signal
    });
    if (!res.ok) return { ok: false, code: AI_CLIENT_CODES.HTTP_ERROR, status: res.status };
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    return { ok: true, ...parseProposals(text, limits) };
  } catch (cause) {
    if (cause?.name === 'AbortError') return { ok: false, code: AI_CLIENT_CODES.TIMEOUT };
    return { ok: false, code: AI_CLIENT_CODES.NETWORK };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
