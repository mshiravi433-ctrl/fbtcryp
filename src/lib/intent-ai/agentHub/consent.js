/**
 * EXTERNAL AGENT HUB — the consent message, built by ONE function.
 * ---------------------------------------------------------------------------
 * The preview the user reads and the payload the provider receives are produced
 * by this module, on both sides of the wire: the browser calls
 * `composeConsentMessage` to render the preview, and `server/agentHub/consent.js`
 * calls the SAME function to build what it sends (then hashes it). A preview
 * that is a paraphrase of the payload is a lie waiting to happen — this removes
 * the possibility instead of testing for it.
 *
 * Browser-safe on purpose: no `node:crypto`, no Node built-ins. Anything that
 * needs a hash or a secret lives on the server.
 *
 * The rules are the server's rules (§12, §14):
 *   · only the categories below can be shared; an unknown one is REFUSED by
 *     name, because silently dropping `private_key` teaches a caller it was
 *     accepted;
 *   · each value is validated by SHAPE — an address must be an address, a
 *     portfolio must be numbers. Free-form text in a "portfolio" field is how a
 *     seed phrase ends up at a third party by accident;
 *   · every value is capped, and so is the composed message.
 */

export const CONSENT_CATEGORIES = Object.freeze([
  'task_text',
  'wallet_address',
  'portfolio_summary',
  'market_snapshot',
  'conversation_excerpt'
]);

export const CONSENT_LABELS = Object.freeze({
  task_text: { en: 'Your task description', fa: 'متن درخواست شما' },
  wallet_address: { en: 'A public wallet address', fa: 'آدرس عمومی کیف پول' },
  portfolio_summary: { en: 'Portfolio totals you type (values only)', fa: 'جمع‌های پورتفوی که خودتان وارد می‌کنید (فقط عدد)' },
  market_snapshot: { en: 'Market prices you type', fa: 'قیمت‌های بازاری که خودتان وارد می‌کنید' },
  conversation_excerpt: { en: 'An excerpt of this chat', fa: 'بخشی از این گفتگو' }
});

export const MAX_TASK = 2000;
export const MAX_EXCERPT = 1200;
export const MAX_MESSAGE = 6000;

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Same cleaning rules as the server's sanitizer: no control characters, no
 * zero-width/bidi trickery, capped length. Kept here so the preview and the
 * payload are scrubbed identically.
 */
export function sanitizeText(value, max = 8000) {
  if (value === null || value === undefined) return '';
  const raw = typeof value === 'string' ? value : String(value);
  return raw
    .replace(/\u0000/g, '')
    /* eslint-disable-next-line no-control-regex */
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, '')
    .slice(0, max);
}

function numbersOnly(value, { maxKeys = 12, maxAbs = 1e15 } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out = {};
  for (const [k, v] of Object.entries(value).slice(0, maxKeys)) {
    if (!/^[A-Za-z0-9_.-]{1,24}$/.test(k)) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || Math.abs(n) > maxAbs) continue;
    out[k] = Math.round(n * 1e6) / 1e6;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * @returns {{ok:true,text:string,categories:string[],sections:{key:string,label:string,body:string}[],bytes:number}}
 *        | {{ok:false,code:string,field?:string,detail?:string}}
 */
export function composeConsentMessage({ taskText, categories, context = {} } = {}) {
  const task = sanitizeText(taskText, MAX_TASK).trim();
  if (task.length < 4) return { ok: false, code: 'TASK_TEXT_REQUIRED', field: 'taskText' };
  if (task.length > MAX_TASK) return { ok: false, code: 'TASK_TEXT_TOO_LONG', field: 'taskText' };
  if (!Array.isArray(categories) || !categories.length) return { ok: false, code: 'CONTEXT_REQUIRED', field: 'categories' };

  const requested = [...new Set(categories.map((c) => String(c)))];
  const unknown = requested.filter((c) => !CONSENT_CATEGORIES.includes(c));
  if (unknown.length) return { ok: false, code: 'CONTEXT_CATEGORY_UNKNOWN', field: 'categories', detail: unknown.slice(0, 4).join(',') };
  if (!requested.includes('task_text')) return { ok: false, code: 'CONTEXT_TASK_TEXT_NOT_APPROVED', field: 'categories' };

  const sections = [];
  for (const category of requested) {
    if (category === 'task_text') continue;
    if (category === 'wallet_address') {
      const address = sanitizeText(context.walletAddress, 64).trim();
      if (!EVM_ADDRESS.test(address) && !SOLANA_ADDRESS.test(address)) {
        return { ok: false, code: 'CONTEXT_WALLET_INVALID', field: 'context.walletAddress' };
      }
      sections.push({ key: category, label: 'Public wallet address', body: address });
      continue;
    }
    if (category === 'portfolio_summary') {
      const totals = numbersOnly(context.portfolio);
      if (!totals) return { ok: false, code: 'CONTEXT_PORTFOLIO_INVALID', field: 'context.portfolio' };
      sections.push({ key: category, label: 'Portfolio totals (USD)', body: JSON.stringify(totals) });
      continue;
    }
    if (category === 'market_snapshot') {
      const market = numbersOnly(context.market);
      if (!market) return { ok: false, code: 'CONTEXT_MARKET_INVALID', field: 'context.market' };
      sections.push({ key: category, label: 'Market snapshot (USD)', body: JSON.stringify(market) });
      continue;
    }
    if (category === 'conversation_excerpt') {
      const excerpt = sanitizeText(context.excerpt, MAX_EXCERPT).trim();
      if (excerpt.length < 10) return { ok: false, code: 'CONTEXT_EXCERPT_INVALID', field: 'context.excerpt' };
      sections.push({ key: category, label: 'Conversation excerpt', body: excerpt });
    }
  }

  const text = [
    task,
    ...sections.map((s) => `--- ${s.label} ---\n${s.body}`)
  ].join('\n\n').slice(0, MAX_MESSAGE);

  const bytes = typeof TextEncoder !== 'undefined'
    ? new TextEncoder().encode(text).length
    : text.length;

  return { ok: true, text, categories: requested, sections, bytes };
}
