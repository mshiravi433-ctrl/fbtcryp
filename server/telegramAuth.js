import crypto from 'node:crypto';

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
  if (!initData || !botToken) return { ok: false, reason: 'MISSING_INPUT' };

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'NO_HASH' };

  params.delete('hash');
  params.delete('signature'); // Ed25519 field, not part of the HMAC payload

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
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

/** Express middleware — attaches `req.tgUser` when a valid initData is present. */
export function telegramAuth(botToken, { required = false } = {}) {
  return (req, res, next) => {
    const initData = req.get('x-telegram-init-data') || req.query.initData;
    if (!initData) {
      if (required) return res.status(401).json({ error: 'INIT_DATA_REQUIRED' });
      return next();
    }
    const result = verifyInitData(initData, botToken);
    if (!result.ok) {
      if (required) return res.status(401).json({ error: result.reason });
      return next();
    }
    req.tgUser = result.user;
    req.tgStartParam = result.startParam;
    return next();
  };
}
