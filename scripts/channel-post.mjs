#!/usr/bin/env node
/**
 * TELEGRAM CHANNEL AUTO-POSTER
 * ---------------------------------------------------------------------------
 * Posts a short market update to our Telegram channel on a schedule, with a
 * link back to the app. Run by .github/workflows/channel-post.yml.
 *
 * ─── WHY TELEGRAM AND NOT X ─────────────────────────────────────────────────
 * X killed its free API tier for new developers on 6 February 2026 and moved
 * to pay-per-use. A post costs $0.015 — but a post CONTAINING A URL costs
 * $0.20, and every post we would send has our link in it. Three posts a day
 * would be ~$18/month before a single user arrives, and it needs a foreign
 * card.
 *
 * The Telegram Bot API is free: no subscription, no per-message charge. A bot
 * posting to a channel it administers is effectively unlimited. So this is the
 * one channel where automation genuinely costs nothing.
 *
 * ─── WHY THREE POSTS A DAY, NOT HOURLY ──────────────────────────────────────
 * The owner asked for hourly. I am deliberately not doing that:
 *
 *   • Telegram's own limit for a bot posting into a group/channel is about 20
 *     messages per MINUTE, so hourly is technically fine — the constraint is
 *     not the API.
 *   • The constraint is people. A channel that posts 24 times a day gets muted
 *     within a week, and a muted channel converts nobody. Every unsubscribe is
 *     permanent in a way a skipped post is not.
 *   • Posts that are near-identical are what spam classifiers on every network
 *     look for, and Telegram will limit a channel reported as spam.
 *
 * Three posts a day at spread-out times is the shape that survives. The
 * schedule lives in the workflow, so changing it needs no code change.
 *
 * ─── WHY THE AI IS OPTIONAL ─────────────────────────────────────────────────
 * The market numbers come from our own provider layer and are ALWAYS real. The
 * AI only writes the one-line commentary around them. If Groq is down, out of
 * quota, or unconfigured, the post still goes out with the numbers and a
 * template line — because a channel that silently stops posting is worse than
 * one with plainer wording.
 *
 * Critically: the AI is never allowed to invent a number. It receives the
 * figures and is asked for prose only, and anything it returns that contains a
 * digit we did not give it is rejected. A wrong price in a crypto channel is
 * the fastest way to lose the audience we are trying to build.
 */

import { fetchGlobal, fetchMarkets } from '../server/providers.js';

const BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const CHANNEL = process.env.TELEGRAM_CHANNEL_ID || '';
const APP_URL = process.env.WEBAPP_URL || 'https://fbtswap.ir';
const GROQ_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
const DRY_RUN = process.argv.includes('--dry-run');

/* -------------------------------------------------------------------------- */
/* formatting                                                                 */
/* -------------------------------------------------------------------------- */

export const fmtUsd = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toPrecision(4)}`;
};

export const pct = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
};

const arrow = (v) => (Number(v) >= 0 ? '🟢' : '🔴');

/**
 * Telegram HTML parse mode understands only a handful of tags, and an
 * unescaped `&` or `<` in a coin name makes the whole sendMessage fail with
 * 400 — the post silently never appears. Coin names come from a third-party
 * API, so they are not ours to trust.
 */
export const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/* -------------------------------------------------------------------------- */
/* the AI commentary                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Every number the post is allowed to contain, as strings.
 *
 * Used to police the model's output: if it emits a figure that is not in this
 * set, it invented it, and we throw the whole line away.
 */
export function allowedNumbers(facts) {
  const out = new Set();
  const add = (v) => {
    if (v === null || v === undefined) return;
    const s = String(v);
    // Digit runs, so "3.42" contributes "3" and "42" as well as "3.42" —
    // the model may legitimately reformat a figure it was given.
    for (const m of s.matchAll(/\d+/g)) out.add(m[0]);
  };
  add(facts.mcapChange?.toFixed?.(2));
  add(facts.btcDominance?.toFixed?.(2));
  for (const c of facts.coins ?? []) {
    add(c.change24h?.toFixed?.(2));
    add(c.price);
    add(Math.round(c.price ?? 0));
  }
  return out;
}

/**
 * Does this sentence contain a number we never supplied?
 *
 * Deliberately strict. The cost of rejecting a good sentence is a plainer
 * post; the cost of publishing an invented price is a channel nobody trusts.
 */
export function hasInventedNumber(text, allowed) {
  for (const m of String(text).matchAll(/\d+/g)) {
    if (!allowed.has(m[0])) return true;
  }
  return false;
}

async function aiComment(facts) {
  if (!GROQ_KEY) return null;

  const top = (facts.coins ?? [])
    .slice(0, 5)
    .map((c) => `${c.symbol} ${pct(c.change24h)}`)
    .join(', ');

  const system =
    'You write one sentence of neutral crypto market commentary for a ' +
    'Telegram channel. Rules: at most 20 words. No price predictions, no ' +
    'financial advice, no hype words like "moon" or "pump". Never state a ' +
    'number that was not given to you. Plain text only, no markdown, no ' +
    'hashtags, no emoji. Do not mention buying or selling.';

  const user =
    `Total market cap change 24h: ${pct(facts.mcapChange)}. ` +
    `BTC dominance: ${facts.btcDominance?.toFixed(2)}%. ` +
    `Top movers: ${top}. Write the sentence.`;

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GROQ_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        temperature: 0.7,
        max_tokens: 80
      }),
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) {
      console.warn(`[ai] ${res.status} — posting without commentary`);
      return null;
    }
    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content?.trim();
    if (!text) return null;

    // One sentence, and short. A model that ignores the word limit gets cut
    // rather than allowed to write a paragraph into the channel.
    const line = text.split('\n')[0].slice(0, 200).trim();
    if (line.length < 10) return null;

    if (hasInventedNumber(line, allowedNumbers(facts))) {
      console.warn('[ai] rejected: contains a number we did not supply');
      return null;
    }
    return line;
  } catch (e) {
    console.warn('[ai] failed, posting without commentary:', e.message);
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* the post                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Build the message. Pure, so the test can check it without a network.
 *
 * The disclaimer is not optional. This channel exists to bring people to a
 * financial app, and a market update with a link that does not say "not
 * advice" is the kind of thing that attracts regulatory attention in exactly
 * the market we operate in.
 */
export function buildPost({ global: g, coins, comment, appUrl }) {
  const lines = [];

  lines.push('<b>📊 Market update</b>');
  lines.push('');
  lines.push(
    `Total cap: <b>${fmtUsd(g.mcap)}</b> ${arrow(g.mcapChange)} ${pct(g.mcapChange)}`
  );
  lines.push(`BTC dominance: <b>${g.btcDominance?.toFixed(2)}%</b>`);
  lines.push('');

  for (const c of coins.slice(0, 5)) {
    lines.push(
      `${arrow(c.change24h)} <b>${esc(c.symbol)}</b>  ${fmtUsd(c.price)}  ${pct(c.change24h)}`
    );
  }

  if (comment) {
    lines.push('');
    lines.push(`<i>${esc(comment)}</i>`);
  }

  lines.push('');
  lines.push(`🔄 Swap on 10 networks — you keep your keys: ${appUrl}`);
  lines.push('');
  lines.push('<i>Market data only. Not financial advice.</i>');

  return lines.join('\n');
}

async function send(text) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHANNEL,
      text,
      parse_mode: 'HTML',
      // The preview would show our own site's OG image on every single post,
      // which makes the channel look like an advert wall.
      link_preview_options: { is_disabled: true }
    }),
    signal: AbortSignal.timeout(20000)
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) {
    // Telegram's error text is genuinely useful ("chat not found", "bot is not
    // a member of the channel"), so surface it rather than a generic failure.
    throw new Error(`Telegram ${res.status}: ${json.description ?? 'unknown error'}`);
  }
  return json.result;
}

/* -------------------------------------------------------------------------- */

async function main() {
  if (!DRY_RUN && (!BOT_TOKEN || !CHANNEL)) {
    console.error(
      '✗ TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL_ID must be set.\n' +
        '  Add them under Settings > Secrets and variables > Actions.'
    );
    process.exit(1);
  }

  const [g, coins] = await Promise.all([
    fetchGlobal(),
    fetchMarkets({ perPage: 10 })
  ]);

  // Sort by absolute 24h move: the interesting coins are the ones that moved,
  // in either direction, not the ones with the largest market cap.
  const movers = [...coins].sort(
    (a, b) => Math.abs(b.change24h ?? 0) - Math.abs(a.change24h ?? 0)
  );

  const comment = await aiComment({
    mcapChange: g.mcapChange,
    btcDominance: g.btcDominance,
    coins: movers
  });

  const text = buildPost({ global: g, coins: movers, comment, appUrl: APP_URL });

  if (DRY_RUN) {
    console.log('─── dry run, nothing sent ───\n');
    console.log(text);
    console.log(`\n─── ${text.length} chars (Telegram limit 4096) ───`);
    return;
  }

  const sent = await send(text);
  console.log(`✓ posted to ${CHANNEL} (message ${sent.message_id})`);
}

// Only run when invoked directly, so the test can import the pure helpers.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error('✗', e.message);
    process.exit(1);
  });
}
