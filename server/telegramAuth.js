import crypto from 'node:crypto';

/*
 * Characters that can end up glued to the START or END of a stored bot token
 * without ever being visible in a dashboard: the byte-order mark, the
 * zero-width space family and soft hyphens. String.prototype.trim() already
 * removes Unicode whitespace (including U+FEFF as ZWNBSP and U+00A0), but NOT
 * these format characters — and a single one of them changes the HMAC key and
 * turns every genuine initData into BAD_SIGNATURE.
 */
const EDGE_INVISIBLE_START = /^[\uFEFF\u200B-\u200F\u2060\u00AD]+/;
const EDGE_INVISIBLE_END = /[\uFEFF\u200B-\u200F\u2060\u00AD]+$/;
/* Quote pairs a paste from JSON, a shell echo or a "smart" editor can wrap
 * around the value. Matched PAIRS only — a quote inside a real token body is
 * never touched. */
const QUOTE_PAIR = /^(["'`“”«»])([\s\S]*)\1$/;
const QUOTE_PAIRS_MIXED = [/^“([\s\S]*)”$/, /^”([\s\S]*)“$/, /^‘([\s\S]*)’$/];

/**
 * Normalize ONLY the bot token, never the initData.
 *
 * Environment stores (Vercel, dotenv, copy-paste from BotFather chats, "smart"
 * editors) routinely smuggle a trailing newline, surrounding spaces, wrapping
 * quotes or invisible format characters into secrets. Any such byte changes
 * the HMAC key — producing a BAD_SIGNATURE that is indistinguishable from a
 * forged request — while the numeric bot-id prefix still LOOKS perfect in
 * every diagnostic. Whitespace is handled by trim(); this additionally strips
 * edge BOM/zero-width characters and up to a few layers of surrounding quote
 * pairs. The token BODY is never rewritten: normalization must never turn a
 * wrong token into a right one, only recover the token that was actually
 * pasted. The initData itself stays byte-exact: it is the payload Telegram
 * signed.
 */
export function normalizeBotToken(value) {
  if (typeof value !== 'string') return '';
  let token = value;
  for (let round = 0; round < 5; round += 1) {
    let next = token.replace(EDGE_INVISIBLE_START, '').replace(EDGE_INVISIBLE_END, '').trim();
    const straight = next.match(QUOTE_PAIR);
    if (straight) next = straight[2];
    else {
      for (const re of QUOTE_PAIRS_MIXED) {
        const mixed = next.match(re);
        if (mixed) { next = mixed[1]; break; }
      }
    }
    if (next === token) break;
    token = next;
  }
  return token;
}

/**
 * Verifies Telegram Mini App `initData` (the WebApp login signature).
 *
 * Reference: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Never trust `initDataUnsafe` from the client for anything that matters —
 * it's attacker-controlled. Verify the HMAC server-side like this, and treat
 * the resulting `user.id` as the only authenticated identity.
 */
export function verifyInitData(initData, botToken, { maxAgeSeconds = 86400 } = {}) {
  const token = normalizeBotToken(botToken);
  if (!initData || !token) return { ok: false, reason: 'MISSING_INPUT' };

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'NO_HASH' };

  params.delete('hash');

  /*
   * Telegram's HMAC path covers every received field except `hash`. Newer
   * clients also send an Ed25519 `signature` field; that field remains part of
   * this data-check-string. Only the third-party Ed25519 validation flow drops
   * both `hash` and `signature`.
   */
  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const computed = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  // constant-time compare
  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'BAD_SIGNATURE' };
  }

  const authDate = Number(params.get('auth_date') || 0);
  if (maxAgeSeconds && authDate && Date.now() / 1000 - authDate > maxAgeSeconds) {
    return { ok: false, reason: 'EXPIRED' };
  }

  let user = null;
  try {
    user = JSON.parse(params.get('user') || 'null');
  } catch {
    /* ignore */
  }

  return { ok: true, user, authDate, startParam: params.get('start_param') || null };
}

/**
 * Where a request carries its initData, in priority order.
 *
 *   1. `body.initData` — a JSON body string. JSON.stringify/parse round-trips
 *      any string byte-exactly, so this path is immune to header-size limits,
 *      header re-encoding and non-ASCII header rejection. Preferred when
 *      present for exactly that reason.
 *   2. The `x-telegram-init-data` header — the original transport, kept for
 *      every existing caller.
 *   3. `?initData=` — kept last and only as-is; query values are
 *      percent-DECODED by the parser, so a caller that put the already-encoded
 *      initData into a URL unescaped will not round-trip. It cannot be
 *      recovered here; the diagnose endpoint reports it instead.
 *
 * All three raw copies are returned so a diagnostic can compare the transports
 * byte for byte. The chosen string is passed through untouched: verifyInitData
 * must see the exact bytes Telegram signed, with no extra decode step.
 */
export function extractInitData(req) {
  const header = typeof req.get === 'function' ? req.get('x-telegram-init-data') : '';
  const headerInitData = typeof header === 'string' && header ? header : '';
  const body = req.body;
  const bodyInitData = body && typeof body === 'object' && typeof body.initData === 'string' && body.initData ? body.initData : '';
  const query = req.query;
  const queryInitData = query && typeof query.initData === 'string' && query.initData ? query.initData : '';
  const initData = bodyInitData || headerInitData || queryInitData;
  return {
    initData,
    source: initData ? (bodyInitData ? 'body' : headerInitData ? 'header' : 'query') : 'none',
    headerInitData,
    bodyInitData,
    queryInitData
  };
}

/** Express middleware — attaches `req.tgUser` when a valid initData is present. */
export function telegramAuth(botToken, { required = false } = {}) {
  return (req, res, next) => {
    const extracted = extractInitData(req);
    /*
     * The body credential is CONSUMED here, like an auth header: stripped from
     * req.body so no downstream handler — or anything it persists — ever sees
     * or stores the signed blob. The diagnose route reads the copies kept on
     * req.telegramInitData instead.
     */
    if (extracted.bodyInitData && req.body && typeof req.body === 'object') {
      try { delete req.body.initData; } catch { /* frozen parser output — leave it */ }
    }
    req.telegramInitData = extracted;

    if (!extracted.initData) {
      if (required) return res.status(401).json({ error: 'INIT_DATA_REQUIRED' });
      return next();
    }
    const result = verifyInitData(extracted.initData, botToken);
    if (!result.ok) {
      if (required) return res.status(401).json({ error: result.reason });
      return next();
    }
    req.tgUser = result.user;
    req.tgStartParam = result.startParam;
    return next();
  };
}
