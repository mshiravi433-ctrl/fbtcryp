/**
 * NOTIFICATION DESIGN PROBE — the shade, the artwork and the in-app bar agree
 * ---------------------------------------------------------------------------
 * «دیزاین باید مثل نوار نوتیفیکیشن اندروید/آیفون باشد … پس‌زمینه‌اش هم‌گام با سود
 * و ضرر رنگ عوض کند» — and, from the owner: «چند بار درست شد و بعد دوباره خراب
 * شد».
 *
 * That history is the reason this file exists. Every previous attempt broke in
 * the same way: the colour, the copy and the destination lived in THREE modules
 * (server/orderAlerts.js, server/push.js, server/fcm.js) and each was edited on a
 * different day, so a change to one left the others behind. Nothing threw. The
 * notification simply arrived looking like a different product.
 *
 * So the invariants asserted here are structural, not cosmetic:
 *
 *   1. ONE palette, and the same six tones everywhere — the design system, the
 *      service worker's fallbacks, and the in-app card's CSS defaults.
 *   2. The tone FOLLOWS THE MONEY: a positive P&L or a take-profit is `profit`,
 *      a negative P&L or a stop-loss is `loss`, and the two are never the same
 *      colour.
 *   3. Both transports build their payloads from that palette — no literals left
 *      in server/push.js or server/fcm.js to drift.
 *   4. ONE card per order, not one per stage: the notification tag cannot carry
 *      the stage, or a three-stage order stacks three rows in the shade.
 *   5. The artwork really is generated, really is a PNG at the platform's 2:1
 *      crop, is deterministic (so a deploy cannot silently change every past
 *      card), and its colours actually change with the tone.
 *   6. The banner route validates its input, is immutable-cacheable at the edge
 *      and answers a revalidation with a 304.
 *   7. The sound is not forgotten in the one case the web can control: a live
 *      page is told to ring.
 *   8. The in-app bar is mounted, is not persisted, and is what Settings shows.
 *
 * No device, no network, no browser: everything here is source, pixels and pure
 * functions.
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';

import {
  TONES,
  TONE_KEYS,
  STAGE_TONE,
  VIBRATE,
  normalizeTone,
  toneSpec,
  resolveTone,
  channelForTone,
  vibrateForTone,
  sanitizeBannerText,
  normalizeProgress,
  parseBannerParams,
  bannerPath,
  bannerUrl,
  webPresentation,
  androidPresentation,
  progressFrom,
  formatValue,
  kickerFor
} from '../src/lib/notificationDesign.js';
import { buildStageAlert, STAGE_STYLE } from '../server/orderAlerts.js';
import { shouldPruneToken } from '../server/fcm.js';
import { renderBannerPng, renderBannerCached, bannerResponse, BANNER_WIDTH, BANNER_HEIGHT } from '../server/notificationBanner.js';

const root = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

let step = 0;
const ok = (name, condition) => {
  step += 1;
  assert.ok(condition, `#${step} ${name}`);
};

/* -------------------------------------------------------------------------- */
/* 1. one palette                                                             */
/* -------------------------------------------------------------------------- */
{
  ok('the design system defines exactly six tones', TONE_KEYS.length === 6);
  for (const key of ['profit', 'loss', 'pending', 'ready', 'alert', 'info']) {
    ok(`'${key}' is a tone`, TONE_KEYS.includes(key));
  }

  /* Six DISTINCT accents: two tones that render the same colour make the whole
     colour language useless, and it is invisible in code review (both are
     hex strings). */
  const accents = TONE_KEYS.map((k) => TONES[k].accent.toLowerCase());
  ok('every tone has its own accent colour', new Set(accents).size === 6);
  ok('every tone has an aurora (from ≠ to)', TONE_KEYS.every((k) => TONES[k].from !== TONES[k].to));
  ok('every tone has a label in the app language',
    TONE_KEYS.every((k) => Boolean(TONES[k].label.fa && TONES[k].label.en)));

  /* The legacy stage colours are kept, re-aimed: pending amber, ready green,
     closed red — now meaning "lost money" rather than "closed". */
  ok('pending is still the amber the app already used', TONES.pending.accent === '#FFB300');
  ok('ready is still the green the app already used', TONES.ready.accent === '#00C853');
  ok('a loss is the red the app already used', TONES.loss.accent === '#FF1744');
  /* …and profit is NOT the ready green: "you made money" and "the app is ready"
     must not be the same colour. */
  ok('profit has its own colour, distinct from ready', TONES.profit.accent !== TONES.ready.accent);

  ok('an unknown tone falls back to info instead of a blank card',
    normalizeTone('nonsense') === 'info' && normalizeTone(undefined) === 'info');
  ok('tone lookup is case-insensitive', toneSpec('PROFIT').key === 'profit');
}

/* -------------------------------------------------------------------------- */
/* 2. the tone follows the money                                              */
/* -------------------------------------------------------------------------- */
{
  ok('a positive P&L is profit', resolveTone({ pnlPct: 12.4 }) === 'profit');
  ok('a negative P&L is loss', resolveTone({ pnlPct: -3.75 }) === 'loss');
  ok('zero P&L claims nothing', resolveTone({ pnlPct: 0, stage: 'pending' }) === 'pending');
  ok('a take-profit side is profit', resolveTone({ side: 'takeProfit' }) === 'profit');
  ok('a stop-loss side is loss', resolveTone({ side: 'stopLoss' }) === 'loss');
  ok('an explicit tone outranks the stage', resolveTone({ tone: 'alert', stage: 'ready' }) === 'alert');
  ok('P&L outranks the stage but not an explicit tone',
    resolveTone({ pnlPct: -9, stage: 'ready' }) === 'loss'
    && resolveTone({ tone: 'info', pnlPct: -9 }) === 'info');

  ok('pending stays amber', STAGE_TONE.pending === 'pending');
  ok('ready is green', STAGE_TONE.ready === 'ready');
  /* Plain `closed` is information, not bad news: closing at the user's own
     request must not be painted as a loss. */
  ok('a closed position with no P&L is neutral, not red', STAGE_TONE.closed === 'info');
  ok('a keeper fill is money that moved', STAGE_TONE.filled === 'profit');
  ok('a failure is a loss', STAGE_TONE.failed === 'loss');

  /* Haptics: the pocket has to be able to tell a win from a loss without the
     screen being looked at. */
  ok('profit and loss buzz differently',
    JSON.stringify(VIBRATE.profit) !== JSON.stringify(VIBRATE.loss));
  ok('pending is the quietest pattern', VIBRATE.pending.length === 3);
  ok('the digest pattern is distinct from every event pattern',
    new Set(Object.values(VIBRATE).map((v) => v.join(','))).size === Object.keys(VIBRATE).length);
  ok('vibrateForTone never returns undefined', TONE_KEYS.every((k) => Array.isArray(vibrateForTone(k))));

  /* Channels: money news interrupts, the digest does not. */
  ok('alert tones use the interrupting channel',
    ['profit', 'loss', 'ready', 'pending', 'alert'].every((t) => channelForTone(t) === 'fbt_alerts_v1'));
  ok('the digest uses the quiet channel', channelForTone('info') === 'fbt_updates_v1');
}

/* -------------------------------------------------------------------------- */
/* 3. the artwork's input alphabet is the ONLY thing that reaches pixels       */
/* -------------------------------------------------------------------------- */
{
  /* Persian digits become the Latin digits the renderer can actually draw — the
     NUMBER stays true, only the glyph changes. */
  ok('Persian digits are transliterated, not dropped', sanitizeBannerText('۱۲.۴٪') === '12.4%');
  ok('Arabic-Indic digits too', sanitizeBannerText('٥٪') === '5%');
  ok('Persian letters are dropped rather than drawn as boxes',
    sanitizeBannerText('سود زیاد') === '');
  /* Injection: nothing that could become markup, a shell word or a fetch. */
  const hostile = '<script>alert(1)</script> a&b "c" \'d\' `e` \\f\\ {g}';
  const clean = sanitizeBannerText(hostile, 40);
  /* `>` survives ON PURPOSE — it is the arrow in a pair label («BTC > USDT»)
     and the renderer draws it as three strokes, never as markup. `<` must never
     survive: that is the half a tag would need. */
  ok('the opening bracket can never survive', !clean.includes('<'));
  ok('the only angle character possible is the pair arrow', /^[^<]*>?[^<]*$/.test(clean));
  ok('no quotes survive', !/["'`]/.test(clean));
  ok('no ampersand survives', !/&/.test(clean));
  ok('no backslash or braces survive', !/[\\{}]/.test(clean));
  ok('only the allowed alphabet survives', /^[A-Z0-9 .,:/+\-%°$>×]*$/.test(clean));
  ok('it is uppercased', clean === clean.toUpperCase());
  ok('length is bounded', sanitizeBannerText('A'.repeat(500), 24).length === 24);

  ok('progress is clamped to 0–100', normalizeProgress(140) === 100 && normalizeProgress(-4) === 0);
  ok('absent progress stays absent (no rail rather than a frozen 0)',
    normalizeProgress(null) === null && normalizeProgress('') === null && normalizeProgress('nope') === null);

  const parsed = parseBannerParams({ t: 'profit', v: '+12.4%', l: 'BTC > USDT', k: 'ready', p: '68' });
  ok('the URL parser reads every field', parsed.tone === 'profit' && parsed.value === '+12.4%'
    && parsed.label === 'BTC > USDT' && parsed.kicker === 'READY' && parsed.progress === 68);
  ok('the cache key is content, not order', parseBannerParams({ v: 'A', t: 'loss' }).key
    === parseBannerParams({ t: 'loss', v: 'A' }).key);

  const path = bannerPath({ tone: 'loss', value: '-3.75%', label: 'ETH > USDT', progress: 100 });
  ok('the URL builder emits the tone', path.includes('t=loss'));
  ok('the URL builder encodes a percentage safely', path.includes('v=-3.75%25'));
  ok('the absolute form prefixes the origin', bannerUrl({ tone: 'profit' }, 'https://fbtswap.ir/')
    === 'https://fbtswap.ir/api/notif/banner.png?t=profit');
}

/* -------------------------------------------------------------------------- */
/* 4. the payloads both transports send                                        */
/* -------------------------------------------------------------------------- */
{
  const web = webPresentation({ title: 'T', body: 'B', stage: 'ready', tone: 'profit', value: '+12%' }, 'fa', {
    origin: 'https://fbtswap.ir'
  });
  ok('the web payload carries the artwork', web.image.startsWith('https://fbtswap.ir/api/notif/banner.png?'));
  ok('the artwork URL carries the tone', web.image.includes('t=profit'));
  ok('the web payload is RTL for Persian', web.dir === 'rtl' && web.lang === 'fa');
  ok('the web payload tints the row with the tone', web.color === TONES.profit.accent);
  ok('money news pins itself on screen', web.requireInteraction === true);
  ok('the digest does not pin itself',
    webPresentation({ title: 'T', tone: 'info' }, 'fa').requireInteraction === false);
  ok('the badge is the monochrome mark, not the colour artwork',
    web.badge === '/notification/badge-96.png' && web.icon === '/notification/icon-color-192.png');
  ok('the deep link survives into the click data', webPresentation({ url: '/#/orders' }).data.url === '/#/orders');
  ok('a ready alert offers one action', web.actions.length >= 1 && Boolean(web.actions[0].action));

  const android = androidPresentation({ title: 'T', body: 'B', stage: 'ready', tone: 'loss', progress: 40 }, 'fa', {
    origin: 'https://fbtswap.ir'
  });
  ok('the Android payload carries the big picture', android.notification.image.startsWith('https://'));
  ok('the Android payload shows on the lock screen', android.notification.visibility === 'PUBLIC');
  ok('the Android payload is a heads-up for money news',
    android.notification.notification_priority === 'PRIORITY_MAX');
  ok('the Android payload names our small icon', android.notification.icon === 'ic_stat_notification');
  ok('the Android payload posts to the alert channel', android.notification.channel_id === 'fbt_alerts_v1');
  ok('the Android payload names our tone', android.notification.sound === 'fbt_notification');
  ok('the Android data payload is all strings (FCM rejects anything else)',
    Object.values(android.data).every((v) => typeof v === 'string'));
  ok('the Android tag is the shared de-dupe key', android.notification.tag === android.data.tag);

  ok('progress from a ladder rung', progressFrom({ rung: 3, ofRungs: 4 }) === 75);
  ok('progress from runs left', progressFrom({ runsLeft: 1, totalRuns: 5 }) === 80);
  ok('an explicit progress wins', progressFrom({ progress: 12, rung: 3, ofRungs: 4 }) === 12);
  ok('formatValue prefers an explicit value', formatValue({ value: 'POSTPONED', pnlPct: 5 }) === 'POSTPONED');
  ok('formatValue signs a percentage', formatValue({ pnlPct: 12.41 }) === '+12.4%');
  ok('formatValue marks a loss with a minus', formatValue({ pnlPct: -3.7 }).startsWith('−'));
  ok('kicker names the event', kickerFor({ tone: 'profit', stage: 'ready' }) === 'PROFIT'
    && kickerFor({ stage: 'pending' }) === 'PENDING'
    && kickerFor({ scheduled: true }) === 'SCHEDULED');
}

/* -------------------------------------------------------------------------- */
/* 5. one card per order, not one per stage                                    */
/* -------------------------------------------------------------------------- */
{
  const pending = buildStageAlert({ stage: 'pending', id: 'order-42' });
  const ready = buildStageAlert({ stage: 'ready', id: 'order-42' });
  const closed = buildStageAlert({ stage: 'closed', id: 'order-42' });
  ok('all three stages of one order share ONE tag',
    pending.tag === ready.tag && ready.tag === closed.tag);
  ok('and that tag carries no stage', !/pending|ready|closed/.test(ready.tag));
  ok('different orders get different tags',
    buildStageAlert({ stage: 'ready', id: 'a' }).tag !== buildStageAlert({ stage: 'ready', id: 'b' }).tag);
  ok('web and FCM de-duplicate on the same key', (() => {
    const a = webPresentation(ready, 'fa');
    const b = androidPresentation(ready, 'fa');
    return a.tag === b.notification.tag && a.data.tag === b.data.tag;
  })());

  /* The three stages are still three distinct colours (they now come from the
     palette rather than being retyped here). */
  const colours = [STAGE_STYLE.pending.color, STAGE_STYLE.ready.color, STAGE_STYLE.closed.color];
  ok('the three stages remain three distinct colours', new Set(colours).size === 3);
  ok('the ready colour is the palette green', STAGE_STYLE.ready.color === TONES.ready.accent);

  /* Profit/loss drives the stage card's tone end to end. */
  const win = buildStageAlert({ stage: 'ready', side: 'takeProfit', base: 'BTC', quote: 'USDT', rate: '65240' });
  const lose = buildStageAlert({ stage: 'ready', side: 'stopLoss', base: 'BTC', quote: 'USDT' });
  ok('a bracket that hits its target is a profit card', win.tone === 'profit' && win.color === TONES.profit.accent);
  ok('a bracket that hits its stop is a loss card', lose.tone === 'loss' && lose.color === TONES.loss.accent);
  ok('both carry the artwork values the renderer needs',
    /* Thousands-separated for the big number — a raw «65240» at 150px is a
       wall of digits nobody parses. */
    win.value === '65,240' && win.label === 'BTC > USDT' && Boolean(win.kicker));
  ok('a keeper fill reads as profit', buildStageAlert({ stage: 'closed', filled: true }).tone === 'profit');
  ok('a scheduled run never claims a price',
    buildStageAlert({ stage: 'ready', scheduled: true, rate: '99999' }).kicker === 'SCHEDULED');
}

/* -------------------------------------------------------------------------- */
/* 6. the artwork is generated, deterministic and tone-aware                   */
/* -------------------------------------------------------------------------- */
{
  const profit = renderBannerPng({ tone: 'profit', value: '+12.4%', label: 'BTC > USDT', kicker: 'READY', progress: 68 });
  ok('the artwork is a PNG', profit.toString('ascii', 1, 4) === 'PNG');
  ok('it is 1024×512 — the 2:1 box Chrome and Android crop to',
    profit.readUInt32BE(16) === BANNER_WIDTH && profit.readUInt32BE(20) === BANNER_HEIGHT);
  ok('it is truecolour with no alpha (the OS composites it)',
    profit[24] === 8 && profit[25] === 2);
  ok('it is small enough to push to a phone over mobile data', profit.length < 400 * 1024);

  ok('the render is deterministic — a deploy cannot rewrite history',
    createHash('sha256').update(profit).digest('hex')
    === createHash('sha256').update(renderBannerPng({ tone: 'profit', value: '+12.4%', label: 'BTC > USDT', kicker: 'READY', progress: 68 })).digest('hex'));

  const cachedA = renderBannerCached({ tone: 'loss', value: '-3.75%' });
  const cachedB = renderBannerCached({ tone: 'loss', value: '-3.75%' });
  ok('a repeated card is served from memory, not re-rendered', cachedA === cachedB);

  /*
   * ─── THE TONE MUST BE VISIBLE IN THE PIXELS ──────────────────────────────
   * A card whose colour lives only in the query string is a card that renders
   * grey. So the PNG the PHONE would receive is decoded here — not the encoder's
   * intermediate buffer — and its corners are measured. `renderBannerPng` writes
   * filter 0 on every row, so decoding is one inflate and a stride.
   */
  const decode = (png) => {
    const parts = [];
    let at = 8;
    while (at < png.length) {
      const len = png.readUInt32BE(at);
      const type = png.toString('ascii', at + 4, at + 8);
      if (type === 'IDAT') parts.push(png.subarray(at + 8, at + 8 + len));
      if (type === 'IEND') break;
      at += 12 + len;
    }
    const raw = inflateSync(Buffer.concat(parts));
    const w = BANNER_WIDTH;
    const h = BANNER_HEIGHT;
    const rgb = (x, y) => {
      const rowStart = y * (w * 3 + 1) + 1;
      const i = rowStart + x * 3;
      return [raw[i], raw[i + 1], raw[i + 2]];
    };
    return { w, h, rgb };
  };

  /** Mean (green − red) and (red − blue) over a box — the tone's fingerprint. */
  const fingerprint = (img, x0, y0, x1, y1) => {
    let gr = 0;
    let rb = 0;
    let n = 0;
    for (let y = y0; y < y1; y += 2) {
      for (let x = x0; x < x1; x += 2) {
        const [r, g, b] = img.rgb(x, y);
        gr += g - r;
        rb += r - b;
        n += 1;
      }
    }
    return { gr: gr / n, rb: rb / n };
  };

  const pImg = decode(profit);
  const lImg = decode(renderBannerPng({ tone: 'loss', value: '-3.75%', label: 'ETH > USDT' }));

  /* The bottom-left glow is the tone's PRIMARY colour: mint for a win, crimson
     for a loss. */
  const pBl = fingerprint(pImg, 0, 400, 240, 512);
  const lBl = fingerprint(lImg, 0, 400, 240, 512);
  ok('a profit card glows green in its primary corner', pBl.gr > 40);
  ok('a loss card glows red in the same corner', lBl.gr < 0 && lBl.rb > 25);
  ok('the two cards are not the same picture', Math.abs(pBl.gr - lBl.gr) > 60);

  /* The top-right glow is the secondary colour: cyan for profit, violet for a
     loss — i.e. red-dominant, so `r − b` separates them. */
  const pTr = fingerprint(pImg, 780, 0, 1024, 160);
  const lTr = fingerprint(lImg, 780, 0, 1024, 160);
  ok('a profit card has a cyan secondary glow', pTr.gr > 20);
  ok('a loss card has a violet secondary glow', lTr.gr < 0);

  /* The big number is drawn in white on the left; a card whose text layer
     failed would be a plain gradient. */
  const brightText = (() => {
    let n = 0;
    for (let y = 150; y < 330; y += 1) {
      for (let x = 56; x < 640; x += 1) {
        const [r, g, b] = pImg.rgb(x, y);
        if (r > 235 && g > 235 && b > 235) n += 1;
      }
    }
    return n;
  })();
  ok('the big number really is drawn', brightText > 2500);

  /* A card with no number must still be a designed card, not an empty frame. */
  const plain = decode(renderBannerPng({ tone: 'info', label: 'DAILY DIGEST' }));
  const labelInk = (() => {
    let n = 0;
    for (let y = 255; y < 320; y += 1) {
      for (let x = 56; x < 640; x += 1) {
        const [r, g, b] = plain.rgb(x, y);
        if (b > 120) n += 1;
      }
    }
    return n;
  })();
  const railInk = (() => {
    let n = 0;
    for (let y = 436; y < 448; y += 1) {
      for (let x = 100; x < 900; x += 1) {
        if (plain.rgb(x, y)[2] > 20) n += 1;
      }
    }
    return n;
  })();
  ok('a card with no value still paints its label', labelInk > 500);
  /* No progress → a hairline in the tone instead of a rail: still a frame. */
  ok('a card with no progress still paints a framed baseline', railInk > 1500);

  const res = bannerResponse({ tone: 'profit', value: '+12.4%' });
  ok('the response carries a strong ETag', /^"fbt-/.test(res.etag) && res.etag.endsWith(`-${res.png.length}"`));
  ok('the ETag changes with the content',
    bannerResponse({ tone: 'loss', value: '+12.4%' }).etag !== res.etag);
  ok('the response reports the tone it drew', res.tone === 'profit');
}

/* -------------------------------------------------------------------------- */
/* 7. the shipped surfaces all read that one palette                          */
/* -------------------------------------------------------------------------- */
{
  const sw = read('public/sw.js');
  const toneBlock = /const TONE_COLOR = \{[\s\S]*?\};/.exec(sw)?.[0] ?? '';
  ok('the service worker keeps a tone fallback table', toneBlock.length > 0);
  for (const key of TONE_KEYS) {
    ok(`the service worker's ${key} fallback is the design colour`,
      toneBlock.includes(`'${TONES[key].accent}'`) || toneBlock.includes(`${key}: '${TONES[key].accent}'`));
  }
  ok('the service worker draws the artwork', /image,|\bimage\b/.test(sw) && /banner\.png/.test(sw));
  ok('the service worker replaces a card instead of stacking stages', /renotify/.test(sw));
  ok('the service worker rings a live page (the only sound the web allows)',
    /fbt-push-tone/.test(sw) && /ringOpenClients/.test(sw));
  ok('the service worker tells the app when a card is swiped away', /fbt-push-dismissed/.test(sw));
  ok('the preview message goes through the same builder', /fbt-preview-notification/.test(sw) && /buildNotification/.test(sw));

  const css = read('src/styles/notification-bar.css');
  ok('the in-app card exists', css.includes('.nbar__card'));
  /* A stale CSS fallback flashes the wrong colour for a loss; these are the
     `info` defaults the component overrides inline. */
  ok('the CSS fallbacks match the info tone',
    css.includes('#5b8cff') && css.includes('#00e5ff'));
  ok('the card respects the notch and the island',
    /safe-area-inset-top/.test(css));
  ok('the card stops moving under prefers-reduced-motion', /prefers-reduced-motion/.test(css));
  /* The APK repaints backdrop-filter per frame; the repo forbids it on surfaces. */
  ok('the card uses no backdrop-filter (the APK would repaint it per frame)',
    !/backdrop-filter/.test(css));

  const bar = read('src/components/NotificationBar.jsx');
  ok('the bar is driven by the design system, not by its own colours',
    /toneSpec\(/.test(bar) && !/#[0-9a-fA-F]{6}/.test(bar.replace(/\/\*[\s\S]*?\*\//g, '')));
  ok('the bar renders the same tone labels the pusher uses', /TONES/.test(bar));
  ok('the Settings preview reuses the real card', /export function NotificationPreview/.test(bar));

  const app = read('src/App.jsx');
  ok('the bar is mounted in the app shell', /<NotificationBar \/>/.test(app));
  ok('the push bridge is installed at boot', /installPushBridge\(\)/.test(app));

  const store = read('src/store/useAppStore.js');
  ok('the store has the bar and its show/dismiss actions',
    /notifBar: \[\]/.test(store) && /showNotifBar\(/.test(store) && /dismissNotifBar\(/.test(store));
  ok('the bar is never persisted (a reload must not replay dismissed alerts)',
    /const \{ notifications, notifBar, \.\.\.rest \}/.test(store));

  const notify = read('src/lib/notify.js');
  ok('notify.js feeds the bar from the one path every alert already uses',
    /showNotifBar\(/.test(notify));
  /*
   * The APK's LOCAL card cannot carry remote artwork: the plugin's `largeIcon`
   * is a drawable resource id and `attachments` is iOS-only (both asserted in
   * the comment this pins). So the local card carries the tone's channel,
   * colour and sound, and the ARTWORK reaches the tray on the FCM path.
   */
  ok('the APK\'s local card carries the tone\'s channel and colour',
    /channelId: channelForTone\(tone\)/.test(notify) && /iconColor: spec\.accent/.test(notify));
  ok('it does not pretend a drawable resource id is a URL',
    !/largeIcon: present\.image/.test(notify));
  ok('the artwork reaches the tray through FCM, where `image` is supported',
    /image: spec\.notification\.image/.test(read('server/fcm.js')));
  ok('notify.js maps tones to chimes so a loss cannot sound like a win',
    /TONE_SOUND/.test(notify) && /loss: 'error'/.test(notify) && /profit: 'success'/.test(notify));
  ok('notify.js can preview a tone', /export async function previewNotification/.test(notify));

  const settings = read('src/pages/Settings.jsx');
  ok('Settings shows the design before asking for permission',
    /NotificationPreview/.test(settings) && /previewNotification\(/.test(settings));

  const push = read('server/push.js');
  ok('server/push.js delegates presentation instead of retyping it',
    /webPresentation\(/.test(push));
  ok('server/push.js resolves an absolute origin for the artwork', /publicOrigin\(/.test(push));

  const fcm = read('server/fcm.js');
  ok('server/fcm.js delegates presentation instead of retyping it',
    /androidPresentation\(/.test(fcm));
  ok('the Android payload asks for the big picture', /image: spec\.notification\.image/.test(fcm));

  const alerts = read('server/orderAlerts.js');
  ok('orderAlerts derives its stage styles from the palette',
    /toneSpec\('pending'\)/.test(alerts) && /toneSpec\('ready'\)/.test(alerts));
  ok('orderAlerts no longer owns a palette of its own',
    !/color: '#FFB300'/.test(alerts));
}

/* -------------------------------------------------------------------------- */
/* 8. the route that serves it                                                 */
/* -------------------------------------------------------------------------- */
{
  const app = read('server/app.js');
  const route = /app\.get\('\/api\/notif\/banner\.png'[\s\S]*?\n\}\);/.exec(app)?.[0] ?? '';
  ok('the banner route exists', route.length > 0);
  ok('it serves a PNG', route.includes("'image/png'"));
  ok('it is immutable at the edge (the query string IS the content)',
    /s-maxage=\d+/.test(route) && /immutable/.test(route));
  ok('it answers a revalidation with a 304', /if-none-match/.test(route) && /304/.test(route));
  ok('it degrades to the plain branded card instead of a broken image',
    /renderBannerCached\(\{ tone: 'info' \}\)/.test(route));
  ok('it validates its input through the shared parser', /bannerResponse\(req\.query\)/.test(route));
  ok('its fallback cache header is CDN-cacheable too (a bare max-age is a cold start per user)',
    !/'public, max-age=\d+'/.test(app));
  ok('the tone table is published for the app (public brand colours only)',
    /app\.get\('\/api\/notif\/tones'/.test(app));
  ok('the renderer exists where the route expects it', existsSync(new URL('server/notificationBanner.js', root)));
}

/* -------------------------------------------------------------------------- */
/* 9. the FCM envelope is the ONE the REST API accepts                        */
/* -------------------------------------------------------------------------- */
{
  const fcm = read('server/fcm.js');

  /*
   * ─── `channelId` IS NOT A FIELD, AND SENDING IT DELETED TOKENS ────────────
   * AndroidNotification spells it `channel_id`. The old sender used `channelId`,
   * so every targeted message was rejected as INVALID_ARGUMENT — and the old
   * error handler treated ANY 400 as "this device is gone" and pruned the token.
   * One wrong field name therefore unsubscribed the user it was meant to reach,
   * and the report («نوتیفیکیشن نمی‌رسد») became permanent.
   *
   * These assertions are about field SPELLING because that is what broke.
   */
  ok('the channel is sent as channel_id, the name the REST API accepts',
    /channel_id:/.test(fcm) && !/\bchannelId:\s*spec/.test(fcm));
  ok('the priority enum is one FCM defines',
    ['PRIORITY_MIN', 'PRIORITY_LOW', 'PRIORITY_DEFAULT', 'PRIORITY_HIGH', 'PRIORITY_MAX']
      .includes(androidPresentation({ tone: 'profit' }).notification.notification_priority));
  ok('visibility is one FCM defines', ['PUBLIC', 'PRIVATE', 'SECRET']
    .includes(androidPresentation({ tone: 'profit' }).notification.visibility));
  /* An unknown field is a 400 for the whole message, so the payload is checked
     against the documented key list rather than "it looks right". */
  const allowed = new Set(['title', 'body', 'icon', 'color', 'sound', 'tag', 'click_action',
    'body_loc_key', 'body_loc_args', 'title_loc_key', 'title_loc_args', 'channel_id', 'ticker',
    'sticky', 'event_time', 'local_only', 'notification_priority', 'default_sound',
    'default_vibrate_timings', 'default_light_settings', 'vibrate_timings', 'visibility',
    'notification_count', 'light_settings', 'image', 'proxy']);
  const sent = Object.keys(androidPresentation({ tone: 'profit', title: 't' }).notification);
  ok(`every Android notification key is documented (unknown: ${sent.filter((k) => !allowed.has(k)).join(', ') || 'none'})`,
    sent.every((k) => allowed.has(k)));
  ok('no invented `notify_details` field is sent', !/notify_details/.test(fcm));

  /* Pruning is token-level, never payload-level. */
  ok('a 404 prunes the token', shouldPruneToken(404, ''));
  ok('a malformed payload does NOT prune a healthy device', !shouldPruneToken(400,
    JSON.stringify({ error: { code: 400, message: 'Invalid JSON payload received. Unknown name "channelId"' } })));
  ok('an UNREGISTERED token is pruned', shouldPruneToken(400,
    JSON.stringify({ error: { details: [{ errorCode: 'UNREGISTERED' }] } })));
  ok('a transient 5xx never prunes', !shouldPruneToken(503, 'unavailable'));
  ok('the sender uses the token-level rule on both paths',
    (fcm.match(/shouldPruneToken\(/g) || []).length >= 3);
}

/* -------------------------------------------------------------------------- */
/* 9. the watch cycle feeds the colour                                        */
/* -------------------------------------------------------------------------- */
{
  const app = read('server/app.js');
  ok('the watch alert passes the bracket side through',
    /side: payload\.side/.test(app));
  ok('the watch alert passes a P&L through', /pnlPct:/.test(app));
  ok('the watch alert passes ladder progress through',
    /rung: payload\.rung/.test(app) && /ofRungs: payload\.ofRungs/.test(app));
  ok('the client can send a tone with an event', /tone: typeof req\.body\?\.tone/.test(app));
  ok('the monitor push is not left with a bare title/body',
    /const message = \{[\s\S]*?tone: 'ready'/.test(app));
}

console.log(`\n✓ notification-design-probe: ${step} assertions passed (no device, no network)\n`);
