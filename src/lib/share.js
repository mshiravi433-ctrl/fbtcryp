/**
 * SHARING — everywhere, not just Telegram.
 * ---------------------------------------------------------------------------
 * ─── THE BUG THIS REPLACES ──────────────────────────────────────────────────
 * `TelegramContext.share()` built exactly one URL:
 *
 *     https://t.me/share/url?url=…&text=…
 *
 * …and that was the ONLY share path in the app. So every invite, on every
 * platform, went through Telegram:
 *
 *   • Outside Telegram it called `window.open()` on t.me — which on a phone
 *     without Telegram installed lands on a web page asking you to install
 *     Telegram, and in Iran t.me is blocked outright on most networks, so the
 *     tab simply hung. The user tapped "share invite" and nothing happened.
 *   • Inside the packaged Android app `window.open` to an external host is
 *     handled by the WebView, not the OS, so it could open a blank in-app tab.
 *   • Users on WhatsApp, X, Instagram, iMessage or plain SMS — which is most
 *     of them — had no way to send the link at all.
 *
 * Sharing is the ONLY zero-cost growth channel this project has. A share button
 * that fails silently is the single most expensive bug in the app: every tap is
 * a user who tried to bring us a new user and could not.
 *
 * ─── THE LADDER ─────────────────────────────────────────────────────────────
 * Four rungs, best first, each one a genuine fallback for the one above:
 *
 *   1. Capacitor Share  — inside the APK. Opens the real Android share sheet,
 *                         so every messenger on the phone is offered.
 *   2. navigator.share  — Web Share API. Works on Safari iOS, Chrome Android,
 *                         Edge and Samsung Internet, and opens the same native
 *                         sheet. This is the rung that makes iPhones work.
 *   3. Telegram WebApp  — only when we are genuinely running inside Telegram,
 *                         where openTelegramLink is the correct native action.
 *   4. In-app sheet     — desktop browsers and anything else: a list of
 *                         destinations the caller renders (see shareTargets).
 *
 * Every function returns a RESULT rather than throwing, because "the user
 * dismissed the share sheet" is not an error and must not surface a red toast.
 */

import { isNativeShell } from './nativeShell';

/** True only when the page is really running as a Telegram Mini App. */
export function inTelegram() {
  return typeof window !== 'undefined' && Boolean(window.Telegram?.WebApp?.initData);
}

/** Does this browser have the Web Share API? (Safari iOS: yes.) */
export function canWebShare() {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

/**
 * Can we hand off to the operating system at all?
 *
 * The UI uses this to decide between "Share" (one tap, native sheet) and
 * "Share via…" (our own list). Getting it wrong in either direction is bad:
 * showing our list when the OS sheet exists is a worse experience, and
 * promising a native sheet that does not exist does nothing at all.
 */
export function canSystemShare() {
  return isNativeShell() || canWebShare() || inTelegram();
}

/**
 * Share a link through the best channel available.
 *
 * @param {object}  opts
 * @param {string}  opts.url    the link (required)
 * @param {string} [opts.text]  message shown before the link
 * @param {string} [opts.title] sheet title, used by some targets
 * @returns {Promise<{ok:boolean, via:string, reason?:string}>}
 *          `via` is one of: native | web | telegram | none
 *          `ok:false, reason:'DISMISSED'` means the user closed the sheet —
 *          the caller must NOT treat that as a failure.
 */
export async function shareLink({ url, text = '', title = 'FBT Swap' }) {
  if (typeof url !== 'string' || !url) return { ok: false, via: 'none', reason: 'NO_URL' };

  /* 1 ─ packaged app: the real Android share sheet. */
  if (isNativeShell()) {
    try {
      const { Share } = await import('@capacitor/share');
      await Share.share({ title, text, url, dialogTitle: title });
      return { ok: true, via: 'native' };
    } catch (e) {
      // A cancelled Android sheet rejects with "Share canceled". That is a
      // user decision, not a bug, and must not fall through to opening a
      // browser tab behind their back.
      if (/cancel/i.test(String(e?.message ?? ''))) {
        return { ok: false, via: 'native', reason: 'DISMISSED' };
      }
      /* fall through to the next rung */
    }
  }

  /* 2 ─ Web Share API: iOS Safari, Chrome Android, Samsung Internet, Edge. */
  if (canWebShare()) {
    try {
      /*
       * `text` and `url` are passed separately rather than concatenated.
       * Targets that understand a URL (iMessage, WhatsApp) then render a
       * proper link preview instead of a wall of text — and the preview is
       * what makes someone tap it.
       */
      await navigator.share({ title, text, url });
      return { ok: true, via: 'web' };
    } catch (e) {
      const name = String(e?.name ?? '');
      if (name === 'AbortError') return { ok: false, via: 'web', reason: 'DISMISSED' };
      /*
       * NotAllowedError happens when the call did not come from a user
       * gesture, and on some in-app browsers navigator.share exists but
       * throws immediately. Both cases still have the manual list below.
       */
    }
  }

  /* 3 ─ genuinely inside Telegram: its own share dialog is the right answer. */
  if (inTelegram()) {
    try {
      window.Telegram.WebApp.openTelegramLink(telegramShareUrl(url, text));
      return { ok: true, via: 'telegram' };
    } catch {
      /* fall through */
    }
  }

  /* 4 ─ nothing native: the caller shows shareTargets(). */
  return { ok: false, via: 'none', reason: 'NO_NATIVE' };
}

/* -------------------------------------------------------------------------- */
/* per-network links                                                          */
/* -------------------------------------------------------------------------- */

const enc = encodeURIComponent;

export const telegramShareUrl = (url, text = '') =>
  `https://t.me/share/url?url=${enc(url)}&text=${enc(text)}`;

/**
 * Destinations for the manual sheet.
 *
 * Ordered by who actually forwards crypto links: WhatsApp and Telegram first,
 * then X, then the generic rails (SMS / email) that need no account at all.
 *
 * ─── WHY EVERY LINK IS A PLAIN https URL ────────────────────────────────────
 * Not `whatsapp://` or `tg://`. Custom schemes fail with an ugly "cannot open"
 * dialog when the app is absent, while the https form redirects to the web
 * version — worse, but never a dead end. The one exception is SMS, which has
 * no web equivalent.
 *
 * WhatsApp, X and Telegram do not read a `url` field: they take one text blob,
 * so the link is appended to the message. Email and LinkedIn take them apart.
 *
 * @param {string} url
 * @param {string} text
 * @returns {Array<{id:string,label:string,href:string,color:string}>}
 */
export function shareTargets(url, text = '') {
  const both = text ? `${text}\n${url}` : url;
  return [
    {
      id: 'whatsapp',
      label: 'WhatsApp',
      href: `https://wa.me/?text=${enc(both)}`,
      color: '#25D366'
    },
    {
      id: 'telegram',
      label: 'Telegram',
      href: telegramShareUrl(url, text),
      color: '#2AABEE'
    },
    {
      id: 'x',
      label: 'X',
      href: `https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}`,
      color: '#ffffff'
    },
    {
      id: 'linkedin',
      label: 'LinkedIn',
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}`,
      color: '#0A66C2'
    },
    {
      id: 'email',
      label: 'Email',
      href: `mailto:?subject=${enc('FBT Swap')}&body=${enc(both)}`,
      color: '#9aa4bf'
    },
    {
      /*
       * `sms:?&body=` — the `?&` is not a typo. iOS needs the ampersand after
       * the question mark or it drops the body entirely; Android accepts both
       * forms. This single character is the difference between a pre-filled
       * message and an empty one.
       */
      id: 'sms',
      label: 'SMS',
      href: `sms:?&body=${enc(both)}`,
      color: '#00ff9d'
    }
  ];
}

/**
 * Copy to clipboard, with a fallback for the WebViews that have no
 * `navigator.clipboard` (it requires a secure context, and Capacitor serves
 * from https://localhost which *is* secure — but Android WebView below 66 and
 * some in-app browsers still lack it).
 */
export async function copyText(value) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    // Off-screen but focusable; `display:none` would make execCommand a no-op.
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.setAttribute('readonly', '');
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
