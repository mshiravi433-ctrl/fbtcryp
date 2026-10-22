/**
 * EXTERNAL AGENT HUB — rendering provider text WITHOUT trusting it.
 * ---------------------------------------------------------------------------
 * A provider result is untrusted content produced by a third party. The rules:
 *
 *   · NO HTML, EVER. There is no `dangerouslySetInnerHTML` anywhere in this
 *     feature; the result is parsed into plain blocks and rendered as React
 *     text nodes. A provider that returns `<img onerror=...>` gets those
 *     characters printed, not executed.
 *   · LINKS ARE LINKS. URLs become anchors with `rel="noopener noreferrer
 *     nofollow"`, `target="_blank"`, and only for `https:` — a `javascript:`
 *     or `data:` URL stays as text.
 *   · INSTRUCTION-SHAPED TEXT IS FLAGGED. The provider output cannot call a
 *     tool, start a payment or change a policy; the most it can do is *look*
 *     like an instruction. `scanForInjection` on the server and `warnings` in
 *     the result model make that visible instead of authoritative.
 *
 * The parser is a deliberately small Markdown subset (headings, lists, fenced
 * code, paragraphs). Supporting more Markdown would only widen the surface; the
 * value of the result is its text and its citations, not its formatting.
 */

const SAFE_HREF = /^https:\/\/[^\s<>"'`]+$/i;

/** Is this URL safe to place in an href? https only, no credentials, no spaces. */
export function safeHref(value) {
  const url = String(value || '').trim();
  if (!SAFE_HREF.test(url) || url.length > 300) return null;
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return null;
    if (/^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.)/i.test(parsed.hostname)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Split one line into text and link segments. A link keeps its trailing
 * punctuation outside the anchor so a sentence still reads as a sentence.
 */
export function splitLinks(line) {
  const text = String(line ?? '');
  const segments = [];
  const re = /https?:\/\/[^\s<>()"'`]+/gi;
  let last = 0;
  let match;
  while ((match = re.exec(text)) !== null) {
    const raw = match[0];
    const trailing = raw.match(/[.,;:!?]+$/)?.[0] || '';
    const candidate = trailing ? raw.slice(0, -trailing.length) : raw;
    if (match.index > last) segments.push({ type: 'text', text: text.slice(last, match.index) });
    const href = safeHref(candidate);
    if (href) segments.push({ type: 'link', text: candidate, href });
    else segments.push({ type: 'text', text: candidate });
    if (trailing) segments.push({ type: 'text', text: trailing });
    last = match.index + raw.length;
  }
  if (last < text.length) segments.push({ type: 'text', text: text.slice(last) });
  return segments.length ? segments : [{ type: 'text', text }];
}

/**
 * Provider Markdown subset → blocks.
 * @returns {Array<{type:'heading'|'paragraph'|'list'|'code', level?:number, items?:string[], text?:string, segments?:object[]}>}
 */
export function parseResultBlocks(input, { maxBlocks = 80, maxChars = 20000 } = {}) {
  const source = String(input ?? '').slice(0, maxChars);
  const blocks = [];
  let paragraph = [];
  let list = [];
  let code = null;

  const flushParagraph = () => {
    const text = paragraph.join(' ').trim();
    if (text) blocks.push({ type: 'paragraph', text, segments: splitLinks(text) });
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ type: 'list', items: list.map((item) => ({ text: item, segments: splitLinks(item) })) });
    list = [];
  };

  for (const line of source.split(/\r?\n/)) {
    if (code !== null) {
      if (/^\s*```/.test(line)) {
        blocks.push({ type: 'code', text: code.join('\n').slice(0, 4000) });
        code = null;
      } else {
        code.push(line);
      }
      continue;
    }
    if (/^\s*```/.test(line)) {
      flushParagraph();
      flushList();
      code = [];
      continue;
    }
    const heading = line.match(/^\s{0,3}(#{1,3})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim(), segments: splitLinks(heading[2].trim()) });
      continue;
    }
    const item = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (item) {
      flushParagraph();
      list.push(item[1].trim());
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    flushList();
    paragraph.push(line.trim());
    if (blocks.length >= maxBlocks) break;
  }
  if (code !== null) blocks.push({ type: 'code', text: code.join('\n').slice(0, 4000) });
  flushParagraph();
  flushList();
  return blocks.slice(0, maxBlocks);
}

/** Copy for the states the Hub can be in — shared by the panel and its tests. */
export const HUB_STATUS_COPY = Object.freeze({
  DISABLED: {
    en: 'External agents are not enabled on this deployment.',
    fa: 'ایجنت‌های خارجی روی این نسخه فعال نیستند.'
  },
  EMPTY: {
    en: 'No external agent has passed review yet. This page stays empty until one does — it is not a catalogue of links.',
    fa: 'هنوز هیچ ایجنت خارجی از بازبینی عبور نکرده است. این صفحه تا آن زمان خالی می‌ماند — فهرستی از لینک نیست.'
  },
  UNAVAILABLE: {
    en: 'The provider is not answering right now.',
    fa: 'ارائه‌دهنده در این لحظه پاسخ نمی‌دهد.'
  }
});

export const STATE_LABELS = Object.freeze({
  queued: { en: 'Queued at provider', fa: 'در صف ارائه‌دهنده' },
  running: { en: 'Running at provider', fa: 'در حال اجرا نزد ارائه‌دهنده' },
  input_required: { en: 'Provider needs more input', fa: 'ارائه‌دهنده ورودی بیشتری می‌خواهد' },
  reconciling: { en: 'Checking with provider', fa: 'در حال بررسی با ارائه‌دهنده' },
  completed: { en: 'Completed', fa: 'کامل شد' },
  failed: { en: 'Failed', fa: 'ناموفق' },
  canceled: { en: 'Canceled', fa: 'لغو شد' },
  expired: { en: 'Expired', fa: 'منقضی' },
  auth_required: { en: 'Account required', fa: 'نیازمند حساب' },
  payment_required: { en: 'Payment required', fa: 'نیازمند پرداخت' },
  consent_required: { en: 'Consent required', fa: 'نیازمند رضایت' },
  draft: { en: 'Draft', fa: 'پیش‌نویس' }
});

export function stateLabel(state, fa = false) {
  const entry = STATE_LABELS[state];
  if (!entry) return state || '—';
  return fa ? entry.fa : entry.en;
}
