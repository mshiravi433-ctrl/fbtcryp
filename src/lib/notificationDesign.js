/**
 * NOTIFICATION DESIGN SYSTEM — one source of truth for every surface
 * ---------------------------------------------------------------------------
 * «دیزاین باید مثل همین نوتیفیکیشن بار در اندروید یا آیفون باشد … با لوگو و
 *  رنگ و فاصلهٔ درست … پس‌زمینهٔ نوتیفیکیشن‌ها هم هم‌گام با سود بالا رفتن یا
 *  ضرر رنگش تغییر کند.»
 *
 * A notification in this product appears in FOUR places that must look like one
 * design, not four:
 *
 *   1. the Android/PWA shade (web push, rendered by public/sw.js),
 *   2. the Android shade via FCM (rendered by the Firebase SDK from a payload),
 *   3. the iPhone/PWA banner (same web push payload, iOS presentation),
 *   4. the in-app status bar (src/components/NotificationBar.jsx), which is the
 *      only one of the four we can draw pixel-for-pixel ourselves.
 *
 * The previous attempts broke in exactly one way each time: the colour, the
 * sound and the deep link were decided in THREE different modules (orderAlerts
 * for copy, push.js for web presentation, fcm.js for Android), so a change to
 * one of them silently left the others behind and «دوباره خراب شد». This module
 * is the single place those decisions live. It is deliberately free of DOM and
 * node APIs so BOTH the browser bundle and the server can import it — the
 * server already imports from src/lib (see server/watch.js).
 *
 * ─── WHAT IS ACTUALLY CONTROLLABLE IN A SYSTEM SHADE ───────────────────────
 * No web/app payload can restyle Android's notification layout: the OS owns the
 * corner radii, the row order and the fonts. What a payload CAN decide is:
 *
 *   icon / badge / color   the brand mark and its tint
 *   image                  the BIG PICTURE — the wide artwork under the text
 *                          (this is the gradient card in the reference designs)
 *   title / body           the two lines of copy
 *   sound / channel        our own tone (native) or the system chime (web)
 *   visibility / priority  whether it shows on the LOCK SCREEN and whether it
 *                          drops in from the top
 *   tag                    whether a stage update REPLACES the previous card
 *                          or stacks a second one
 *   progress               rendered in the artwork, because neither platform
 *                          exposes a progress bar to a push payload
 *
 * So the design is carried by the ARTWORK (`image`), and the fields above are
 * chosen to make the OS frame it correctly. That is the honest ceiling, and it
 * is high: done properly the shade shows a wide gradient card with our mark,
 * the big number, a progress rail and our copy — which is precisely the
 * reference the owner sent.
 */

/* -------------------------------------------------------------------------- */
/* palette                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One tone per emotional outcome, and the tone is what drives the colour of
 * EVERY surface: the shade artwork, the accent tint, the in-app bar gradient.
 *
 * `accent` is the colour the OS is given (`color` / `iconColor` / channel LED);
 * `from`/`to` are the two ends of the artwork's aurora. They are duplicated in
 * `src/styles/notification-bar.css` ONLY as CSS custom-property fallbacks — the
 * component writes the live values from here, and the design probe asserts the
 * CSS defaults still match this table so the two can never drift.
 */
export const TONES = {
  /* Money made. Mint → cyan: the same family as the app's "up" colour. */
  profit: {
    key: 'profit',
    accent: '#00E58A',
    from: '#00E58A',
    to: '#00B4FF',
    ink: '#00160F',
    glyph: '▲',
    label: { fa: 'سود', en: 'PROFIT', ar: 'ربح' }
  },
  /* Money lost. Crimson → violet: unmistakably "down", never confused with the
     amber of "waiting". */
  loss: {
    key: 'loss',
    /*
     * The legacy «closed» red (#FF1744) lives on, re-aimed at what it should
     * have always meant: a position that LOST money. Closing at the user's own
     * request is not bad news, so the plain `closed` stage is `info` blue —
     * only a negative P&L earns the crimson.
     */
    accent: '#FF1744',
    from: '#FF1744',
    to: '#7C1FFF',
    ink: '#1A0208',
    glyph: '▼',
    label: { fa: 'ضرر', en: 'LOSS', ar: 'خسارة' }
  },
  /* A plan that is set and waiting. Amber → orange. */
  pending: {
    key: 'pending',
    accent: '#FFB300',
    from: '#FFB300',
    to: '#FF6A3D',
    ink: '#1A1000',
    glyph: '◷',
    label: { fa: 'در انتظار', en: 'PENDING', ar: 'بالانتظار' }
  },
  /* The target was reached / an automation is running. Brand cyan → violet. */
  ready: {
    key: 'ready',
    accent: '#00C853',
    from: '#00C853',
    to: '#00E5FF',
    ink: '#00131A',
    glyph: '⚡',
    label: { fa: 'آماده', en: 'READY', ar: 'جاهز' }
  },
  /* Something needs a decision (a security or risk prompt). Pink → violet. */
  alert: {
    key: 'alert',
    accent: '#FF6BD6',
    from: '#FF6BD6',
    to: '#7C4DFF',
    ink: '#1A0016',
    glyph: '!',
    label: { fa: 'هشدار', en: 'ALERT', ar: 'تنبيه' }
  },
  /* Neutral news / digest / completed. Blue → cyan. */
  info: {
    key: 'info',
    accent: '#5B8CFF',
    from: '#5B8CFF',
    to: '#00E5FF',
    ink: '#000F1A',
    glyph: 'ℹ',
    label: { fa: 'اطلاع', en: 'INFO', ar: 'معلومة' }
  }
};

export const TONE_KEYS = Object.keys(TONES);

/** Anything unknown becomes `info`: a payload must never produce a blank card. */
export function normalizeTone(value) {
  const t = String(value || '').trim().toLowerCase();
  return TONES[t] ? t : 'info';
}

export const toneSpec = (value) => TONES[normalizeTone(value)];

/**
 * Which tone a STAGE means, before profit/loss is known.
 *
 * `closed` is deliberately `info` and not `loss`: closing a position at the
 * user's own request is not bad news. When the payload carries a signed
 * percentage the caller uses `resolveTone`, which overrides this with
 * profit/loss — that is the part the owner asked to be colour-synced.
 */
export const STAGE_TONE = {
  pending: 'pending',
  ready: 'ready',
  closed: 'info',
  filled: 'profit',
  failed: 'loss',
  info: 'info',
  alert: 'alert'
};

/**
 * The tone for one event, profit/loss aware.
 *
 * Order of authority:
 *   1. an explicit `tone` from the caller (a pricing engine that already knows),
 *   2. a signed `pnlPct` — the "background follows profit or loss" rule,
 *   3. the meaning of a bracket's `side` (takeProfit / stopLoss),
 *   4. the stage.
 */
export function resolveTone({ tone, stage, side, pnlPct, scheduled } = {}) {
  if (tone && TONES[String(tone).toLowerCase()]) return normalizeTone(tone);

  const pnl = Number(pnlPct);
  if (Number.isFinite(pnl) && pnl !== 0) return pnl > 0 ? 'profit' : 'loss';

  const s = String(side || '').toLowerCase();
  if (s === 'takeprofit' || s === 'take_profit') return 'profit';
  if (s === 'stoploss' || s === 'stop_loss') return 'loss';

  const st = String(stage || '').toLowerCase();
  if (st === 'ready') {
    /*
     * A DCA/TWAP run is not "the target was hit" — the price is wherever it is.
     * Cyan (brand) says "your plan is due", which is exactly what happened and
     * claims nothing about money. Only a level trigger earns the profit tone.
     */
    return scheduled ? 'ready' : 'ready';
  }
  return STAGE_TONE[st] || 'info';
}

/** Android channel per tone — must match MainActivity.createNotificationChannels(). */
export function channelForTone(tone) {
  const t = normalizeTone(tone);
  return t === 'info' ? 'fbt_updates_v1' : 'fbt_alerts_v1';
}

/**
 * Vibration pattern per tone.
 *
 * The patterns differ by STAGE because the phone is in a pocket: pending is a
 * single short tap, profit/loss are the two unmistakable ones. They are also
 * different from the daily digest (`[40,60,40]`), so a price event is never
 * mistaken for marketing.
 */
export const VIBRATE = {
  profit: [70, 50, 40, 50, 140],
  loss: [160, 80, 160, 80, 220],
  pending: [30, 40, 30],
  ready: [80, 50, 80, 50, 160],
  alert: [120, 60, 120],
  info: [40, 60, 40]
};

export const vibrateForTone = (tone) => VIBRATE[normalizeTone(tone)];

/* Keep the three-stage API (`pending` / `ready` / `closed`) working exactly as
   it did for every existing caller. */
export const vibrateForStage = (stage) => vibrateForTone(STAGE_TONE[stage] || 'ready');

/* -------------------------------------------------------------------------- */
/* the artwork (big picture)                                                   */
/* -------------------------------------------------------------------------- */

/*
 * The shade artwork is generated by the SERVER (server/notificationBanner.js)
 * from a small, strictly validated query string. Validation lives HERE, next to
 * the URL builder, because the two must accept the same alphabet: a builder
 * that emits a character the renderer strips produces a banner with a missing
 * digit, and that is invisible until somebody screenshots it.
 *
 * The character set is intentionally tiny — uppercase Latin, digits, and the
 * handful of symbols an amount/percentage needs. Persian/Arabic shaping is not
 * something a dependency-free rasteriser can do honestly, so those languages
 * speak in the TITLE and BODY (which the OS shapes natively) and the artwork
 * carries numbers and the pair, e.g. «BTC → USDT» + «+۱۲٪» rendered as "+12%".
 */
const ALLOWED_BANNER_CHARS = /[^A-Z0-9 .,:/+\-%°$>×]/g;

/** Uppercase, strip anything the renderer cannot draw, collapse spaces. */
export function sanitizeBannerText(raw, max = 24) {
  return String(raw == null ? '' : raw)
    .toUpperCase()
    /* Persian/Arabic digits and the Persian percent sign become the Latin ones
       the renderer can actually draw — the number stays true, the glyph is the
       only thing that changes. */
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/٪/g, '%')
    .replace(/[–—−]/g, '-')
    .replace(ALLOWED_BANNER_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * Progress as an integer percentage 0–100, or null.
 *
 * `null` is meaningful: it means "this event has no progress", and the artwork
 * draws no rail at all rather than a rail frozen at 0% (which reads as "nothing
 * has happened" even for a completed order).
 */
export function normalizeProgress(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** The validated parameters of one artwork request. */
export function parseBannerParams(input) {
  const get = (k) => {
    if (!input) return null;
    if (typeof input.get === 'function') return input.get(k);
    return input[k];
  };
  const tone = normalizeTone(get('tone') ?? get('t'));
  return {
    tone,
    value: sanitizeBannerText(get('value') ?? get('v'), 14),
    label: sanitizeBannerText(get('label') ?? get('l'), 22),
    kicker: sanitizeBannerText(get('kicker') ?? get('k'), 16),
    progress: normalizeProgress(get('progress') ?? get('p')),
    /* A stable cache key: same inputs, same bytes, same URL. */
    key: [
      tone,
      sanitizeBannerText(get('value') ?? get('v'), 14),
      sanitizeBannerText(get('label') ?? get('l'), 22),
      sanitizeBannerText(get('kicker') ?? get('k'), 16),
      normalizeProgress(get('progress') ?? get('p')) ?? ''
    ].join('|')
  };
}

/** Where the server renders it. Absolute on Vercel; relative works in the SW. */
export const BANNER_PATH = '/api/notif/banner.png';

/**
 * The artwork URL for one notification.
 *
 * Every parameter is optional; the renderer draws the plain branded card when
 * there is nothing to say, so an image is ALWAYS available. That matters: a
 * payload with no `image` gets the old thin text-only row, which is the exact
 * design the owner rejected.
 */
export function bannerPath({ tone, value, label, kicker, progress } = {}) {
  const params = parseBannerParams({ tone, value, label, kicker, progress });
  const qs = new URLSearchParams();
  qs.set('t', params.tone);
  if (params.value) qs.set('v', params.value);
  if (params.label) qs.set('l', params.label);
  if (params.kicker) qs.set('k', params.kicker);
  if (params.progress != null) qs.set('p', String(params.progress));
  return `${BANNER_PATH}?${qs.toString()}`;
}

/**
 * …and the same thing as an absolute URL.
 *
 * `image` is fetched by the DEVICE (or by Firebase's image loader on Android),
 * never by the page, so it must be absolute in a native payload. `origin` comes
 * from the environment on the server and from `location.origin` in the browser.
 */
export function bannerUrl(options = {}, origin = '') {
  const path = bannerPath(options);
  const base = String(origin || '').replace(/\/+$/, '');
  return base ? `${base}${path}` : path;
}

/* -------------------------------------------------------------------------- */
/* presentation payloads                                                       */
/* -------------------------------------------------------------------------- */

const RTL = ['fa', 'ar', 'ur', 'he', 'ckb', 'sd', 'ps'];

export function directionFor(lang) {
  return RTL.includes(String(lang || 'fa').split('-')[0]) ? 'rtl' : 'ltr';
}

/**
 * Everything the WEB PUSH payload must carry, filled in once.
 *
 * `public/sw.js` re-applies the same defaults so a payload that skipped this
 * helper still presents correctly, and the design probe asserts both agree.
 */
export function webPresentation(payload = {}, lang = 'fa', { origin = '' } = {}) {
  const tone = resolveTone(payload);
  const spec = toneSpec(tone);
  const stage = String(payload.stage || '');
  const progress = normalizeProgress(payload.progress);
  const image = payload.image || bannerUrl({
    tone,
    value: payload.value,
    label: payload.label,
    kicker: payload.kicker || (stage || spec.label.en),
    progress
  }, origin);

  return {
    /* OS-level shaping: the shade is where the app cannot translate anything. */
    lang: String(lang || 'fa').split('-')[0],
    dir: directionFor(lang),
    title: payload.title || 'FBT Swap',
    body: payload.body || '',
    /* Brand: colour mark in the icon slot, monochrome in the badge slot (the OS
       silhouettes the badge, so a colour picture there is a white blob). */
    icon: payload.icon || '/notification/icon-color-192.png',
    badge: payload.badge || '/notification/badge-96.png',
    /* The design itself. */
    image,
    color: spec.accent,
    tone,
    progress,
    /* Sound + haptics. Web cannot ship a custom tone; the service worker asks an
       OPEN client to play ours (see sw.js) and the OS chime covers the closed
       case. Vibration is honoured by Android Chrome. */
    vibrate: payload.vibrate || vibrateForTone(tone),
    silent: payload.silent === true ? true : false,
    renotify: payload.renotify !== false,
    timestamp: Number(payload.timestamp) || Date.now(),
    /*
     * `requireInteraction` keeps the card pinned until the user deals with it.
     * ON for money news (profit/loss/ready) — a target hit that slides away in
     * four seconds while the phone is face-down is a missed trade. OFF for the
     * digest, where pinning is an imposition.
     */
    requireInteraction: payload.requireInteraction ?? ['profit', 'loss', 'ready', 'alert'].includes(tone),
    actions: Array.isArray(payload.actions) ? payload.actions : defaultActions(tone, lang),
    tag: payload.tag || (stage ? `fbt-${stage}` : 'fbt'),
    data: {
      ...(payload.data || {}),
      url: payload.url || '/',
      /* The tag rides along in `data` as well as at the top level: the service
         worker's `notificationclose` handler reports `data`, and Android's
         replacement semantics read the top-level `tag`. One key, two readers. */
      tag: payload.tag || (stage ? `fbt-${stage}` : 'fbt'),
      stage,
      tone,
      progress,
      value: payload.value || '',
      color: spec.accent
    }
  };
}

/**
 * Buttons under the notification.
 *
 * Android shows at most three and iOS ignores them entirely, so they are an
 * enhancement: the notification is always actionable by tapping it. The action
 * ids match the `notificationclick` handler in public/sw.js.
 */
export function defaultActions(tone, lang = 'fa') {
  const L = String(lang || 'fa').split('-')[0];
  const open = L === 'fa' ? 'باز کردن' : L === 'ar' ? 'فتح' : 'Open';
  if (tone === 'profit' || tone === 'ready') {
    return [{ action: 'execute', title: L === 'fa' ? '⚡ سواپ و امضا' : '⚡ Swap & Sign' }];
  }
  if (tone === 'loss') {
    return [{ action: 'open', title: L === 'fa' ? 'مشاهدهٔ سفارش' : 'View order' }];
  }
  return [{ action: 'open', title: open }];
}

/**
 * The Android half of an FCM message.
 *
 * Split out because FCM's `android.notification` object is where the fields
 * that make a notification look and behave right live — `image` (big picture),
 * `visibility` (lock screen), `notificationPriority` (drop-in vs silent), and
 * `channelId` (our tone). `server/fcm.js` must not re-decide any of them.
 */
export function androidPresentation(payload = {}, lang = 'fa', { origin = '' } = {}) {
  const tone = resolveTone(payload);
  const spec = toneSpec(tone);
  const stage = String(payload.stage || '');
  const progress = normalizeProgress(payload.progress);
  const urgent = ['profit', 'loss', 'ready', 'alert'].includes(tone);
  const image = bannerUrl({
    tone,
    value: payload.value,
    label: payload.label,
    kicker: payload.kicker || (stage || spec.label.en),
    progress
  }, origin);

  /*
   * ─── THE KEYS ARE FCM'S, SPELLED EXACTLY AS THE REST API SPELLS THEM ──────
   * AndroidNotification is `channel_id`, not `channelId`; `notification_priority`,
   * not `notificationPriority`. This object used to speak camelCase and the
   * sender translated it — and that translation had the channel field wrong, so
   * every targeted message was rejected as INVALID_ARGUMENT and the sender, which
   * treated any 400 as "device gone", deleted the token it had failed to reach.
   *
   * Emitting the wire names HERE means there is no translation layer left to get
   * wrong: `server/fcm.js` spreads this object into the request. The design
   * probe validates every key against the documented field list.
   */
  return {
    notification: {
      title: payload.title || 'FBT Swap',
      body: payload.body || '',
      /* Same drawable the manifest defaults to; Android silhouettes it. */
      icon: 'ic_stat_notification',
      color: spec.accent,
      /* THE DESIGN: the wide gradient card under the two lines of copy. */
      image,
      /*
       * LOCK SCREEN. `PUBLIC` shows the full title, body and artwork on the
       * lock screen; the OS setting is the user's, but a payload that asked for
       * `private` would hide the alert they asked for. Nothing sensitive is put
       * in a notification body (no amounts, no addresses), so this is safe.
       */
      visibility: 'PUBLIC',
      /*
       * ONE CARD PER ORDER, NOT ONE PER STAGE. Android replaces a notification
       * with the same `tag`, so `pending → ready → closed` evolves a single row
       * in the shade instead of stacking three.
       */
      tag: payload.tag || (stage ? `fbt-${stage}` : 'fbt'),
      /* Drop in from the top for money news; stay quiet for the digest. */
      notification_priority: urgent ? 'PRIORITY_MAX' : 'PRIORITY_DEFAULT',
      /* Our tone, from the channel that carries it (Android 8+ owns sound). */
      sound: 'fbt_notification',
      channel_id: channelForTone(tone),
      /* The status line a wearable and TalkBack read. */
      ticker: payload.ticker || payload.title || 'FBT Swap',
      /* The progress rail lives in `image`, so the OS never has to know about
         it — but the time matters, so the shade sorts the card correctly. */
      event_time: new Date(Number(payload.timestamp) || Date.now()).toISOString()
    },
    data: {
      url: payload.url || '/',
      tag: payload.tag || (stage ? `fbt-${stage}` : 'fbt'),
      stage,
      tone,
      progress: progress == null ? '' : String(progress),
      value: payload.value == null ? '' : String(payload.value),
      color: spec.accent
    }
  };
}

/* -------------------------------------------------------------------------- */
/* display helpers (in-app bar + settings preview)                             */
/* -------------------------------------------------------------------------- */

/**
 * The big number a notification shows, in the card's own voice.
 *
 * A rate alone ("۱ BTC = ۶۵٬۰۰۰ USDT") is more useful than a percentage when we
 * have one, but a signed percentage is what makes the card's colour legible at a
 * glance. Both may be present; the artwork shows `value` and the copy shows the
 * sentence.
 */
export function formatValue({ pnlPct, rate, value } = {}) {
  if (value != null && String(value).trim() !== '') return String(value).trim().slice(0, 14);
  const pnl = Number(pnlPct);
  if (Number.isFinite(pnl) && pnl !== 0) {
    const sign = pnl > 0 ? '+' : '−';
    const abs = Math.abs(pnl);
    return `${sign}${abs >= 100 ? Math.round(abs) : abs.toFixed(abs >= 10 ? 1 : 2)}%`;
  }
  const r = Number(rate);
  if (Number.isFinite(r) && r > 0) {
    return r >= 1000 ? Math.round(r).toLocaleString('en-US') : String(Number(r.toFixed(4)));
  }
  return '';
}

/** Progress from whatever the caller has: percent, rung/ofRungs, runsLeft. */
export function progressFrom({ progress, rung, ofRungs, runsLeft, totalRuns } = {}) {
  const explicit = normalizeProgress(progress);
  if (explicit != null) return explicit;
  const r = Number(rung);
  const of = Number(ofRungs);
  if (Number.isFinite(r) && Number.isFinite(of) && of > 1) {
    return normalizeProgress((r / of) * 100);
  }
  const left = Number(runsLeft);
  const total = Number(totalRuns);
  if (Number.isFinite(left) && Number.isFinite(total) && total > 0) {
    return normalizeProgress(((total - left) / total) * 100);
  }
  return null;
}

/** The kicker line above the big number: what KIND of event this is. */
export function kickerFor({ tone, stage, kind, scheduled } = {}) {
  const t = normalizeTone(tone);
  if (stage === 'pending') return 'PENDING';
  if (stage === 'closed') return 'CLOSED';
  if (scheduled) return 'SCHEDULED';
  if (kind === 'intent') return 'INTENT';
  if (t === 'profit') return 'PROFIT';
  if (t === 'loss') return 'LOSS';
  if (t === 'alert') return 'ALERT';
  return 'FBT SWAP';
}
