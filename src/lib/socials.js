/**
 * SOCIAL CHANNELS — one list, real links, one opener policy.
 * ---------------------------------------------------------------------------
 * «در صفحه تماس با ما، به‌جای لینکدین و ایکس متن اینستاگرام افتاده و لینک‌های
 * ایکس و لینکدین هم کار نمی‌کنند»
 *
 * Two separate defects were hiding in that one report.
 *
 * 1 · THE LABELS. Contact rendered `t('contact.social.' + id)` for five ids,
 *     while `en.json` — the fallback for eleven of the twelve locales — only
 *     defined `telegram`, `instagram`, `crunchbase` and `email`. So in English,
 *     Arabic, Hindi… the X and LinkedIn tiles printed their raw key
 *     (`contact.social.x`) while Instagram printed «Instagram»: three tiles with
 *     text, two with a debugging artefact. Persian was the only locale where
 *     all five labels existed, which is why nobody caught it in review.
 *
 * 2 · THE LINKS. The tiles were `<motion.button onClick={() => window.open(url,
 *     '_blank', 'noopener,noreferrer')}>`. A button has no `href`, so:
 *       · in the packaged app (Capacitor WebView) `window.open` returns null and
 *         nothing happens — the tile looks alive and is not;
 *       · inside Telegram the call went to `tg.openLink`, which silently refuses
 *         links it is not allowed to open, and the button has no fallback;
 *       · a link cannot be long-pressed to copy, opened in a new tab, or read by
 *         a screen reader as a link; and `window.open` from an async path loses
 *         the user gesture, which is when pop-up blockers bite.
 *
 * THE RULE THIS MODULE ENFORCES: a channel is an <a href>, and an opener is an
 * enhancement. `openUrl()` (lib/browser) is tried first because inside the
 * packaged app it means a Chrome Custom Tab with a visible URL bar — the right
 * frame for a crypto user — and `preventDefault()` runs ONLY when that opener
 * reports success. Otherwise the browser follows the href itself. A tile can
 * now fail to open beautifully, but it cannot fail to open.
 *
 * Splash.jsx used to keep its own copy of this list, and it had already drifted
 * (no Crunchbase, hardcoded English labels). One list, both screens.
 */
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from './contact.js';

/** @typedef {'x'|'linkedin'|'instagram'|'crunchbase'|'email'} SocialId */

/**
 * `href` is what the anchor gets. `kind` decides whether an in-app opener is
 * even attempted: `openUrl` is https-only by design (a `javascript:` or `data:`
 * URL must never reach an opener), so mail is handed to the OS handler by
 * letting the anchor navigate normally.
 *
 * The LinkedIn URL is stored WITHOUT its utm_source/utm_content/utm_medium
 * parameters — they were on the shared link and would have told LinkedIn every
 * visit came from an Android share sheet, which is both wrong and a needless
 * detail about our users to hand over.
 */
export const SOCIAL_CHANNELS = [
  {
    id: 'x',
    kind: 'link',
    url: 'https://x.com/CompanyFbt',
    grad: 'linear-gradient(135deg,#1a1a1a,#4a4a4a)',
    handle: '@CompanyFbt'
  },
  {
    id: 'linkedin',
    kind: 'link',
    url: 'https://www.linkedin.com/in/mohammad-shiravi-a8891321b',
    grad: 'linear-gradient(135deg,#0a66c2,#004182)',
    handle: 'Mohammad Shiravi'
  },
  {
    id: 'instagram',
    kind: 'link',
    url: 'https://www.instagram.com/fbt_company_',
    grad: 'linear-gradient(135deg,#f9ce34,#ee2a7b 45%,#6228d7)',
    handle: '@fbt_company_'
  },
  {
    id: 'crunchbase',
    kind: 'link',
    url: 'https://www.crunchbase.com/organization/fbt-company',
    grad: 'linear-gradient(135deg,#146aff,#0b47b3)',
    handle: 'FBT Company'
  },
  {
    id: 'email',
    kind: 'mail',
    url: SUPPORT_MAILTO,
    grad: 'linear-gradient(135deg,var(--rgb-5),var(--rgb-6))',
    handle: SUPPORT_EMAIL
  }
];

/** Every channel needs a label key; `wiring.mjs` pins that all 12 locales have
 *  all of them, because a missing one prints a raw key on a live screen. */
export const SOCIAL_LABEL_KEYS = SOCIAL_CHANNELS.map((c) => `contact.social.${c.id}`);

export function isMailChannel(channel) {
  return channel?.kind === 'mail' || String(channel?.href || channel?.url || '').toLowerCase().startsWith('mailto:');
}
