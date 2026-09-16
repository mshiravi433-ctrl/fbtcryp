/**
 * WALLET DEEP-LINK DELIVERY — owning the last metre
 * ---------------------------------------------------------------------------
 * A wallet application opening is not proof that a WalletConnect hand-off
 * worked. Universal-link redirectors can launch Trust/Uniswap/MetaMask after
 * losing the `uri=wc:…` payload, leaving the wallet home screen with no
 * proposal. WalletConnect's current mobile-linking guidance prefers a native
 * deep link and keeps the universal link as a fallback.
 *
 * AppKit still sends mobile links through `window.open()`. For the duration of
 * a pairing this module narrowly wraps that call and gives browser.js all
 * three useful forms:
 *
 *   • the wallet's native deep link (primary in an ordinary mobile browser),
 *   • its HTTPS universal link (Telegram / fallback), and
 *   • the decoded raw `wc:` pairing URI (Android ACTION_VIEW intent).
 *
 * Ordinary pages, auth popups, store links and unknown HTTPS origins pass
 * through untouched. Pure helpers and the idempotent wrapper are exercised by
 * test/wc-deeplink-probe.mjs.
 */

import {
  lastTappedWallet,
  looksLikePairingUri,
  repairPairingUri,
  walletDeepLinks,
  walletForUrl,
  walletLinkBase
} from './wcWallets.js';

/** Split a URL into `{ scheme, rest }`, preserving everything after the scheme. */
export function splitUrl(raw) {
  const text = String(raw || '').trim();
  const m = /^([a-z][a-z0-9+.-]*):\/\/([\s\S]*)$/i.exec(text);
  if (m) return { scheme: m[1].toLowerCase(), rest: m[2] };
  /* Android and some wallets also accept `trust:wc?uri=…` (without slashes). */
  const loose = /^([a-z][a-z0-9+.-]*):([\s\S]*)$/i.exec(text);
  if (loose) return { scheme: loose[1].toLowerCase(), rest: loose[2].replace(/^\/+/, '') };
  return null;
}

export function isHttpsUrl(raw) {
  return /^https:\/\//i.test(String(raw || '').trim());
}

export function carriesPairingUri(raw) {
  return /(?:^|[?&])uri=/i.test(String(raw || ''));
}

/**
 * Repair a deep link whose pairing payload was HTML-escaped (`&amp;`).
 *
 * A healthy link is returned byte-for-byte unchanged. When the payload is
 * damaged, it is decoded, repaired and encoded exactly once. Without this,
 * WalletConnect parses `amp;relay-protocol` instead of `relay-protocol` and
 * rejects the pairing before a proposal can exist.
 */
export function repairPairingInUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) return text;
  const m = /([?&]uri=)([\s\S]*)$/i.exec(text);
  if (!m) return text;
  const payload = m[2];
  let decoded = payload;
  try {
    decoded = decodeURIComponent(payload);
  } catch {
    /* Invalid percent encoding: repair the raw form, then encode it once. */
  }
  const repaired = repairPairingUri(decoded);
  if (repaired === decoded) return text;
  return `${text.slice(0, m.index + m[1].length)}${encodeURIComponent(repaired)}`;
}

/**
 * Decode and validate the `uri=` payload carried by a wallet link.
 *
 * ONE DECODE IS NOT ENOUGH ANYWHERE TELEGRAM-ANDROID TOUCHES THE URL.
 * WalletConnect's own SDK double-encodes the payload there
 * (`isTelegram() && isAndroid()` → `encodeURIComponent(wcUri)` before the
 * usual `encodeURIComponent`), because Telegram's client decodes the deep
 * link once while handing it to the OS. A single decode here therefore
 * returns `wc%3A…` — still encoded, failing `looksLikePairingUri` — and the
 * caller used to conclude the link carried no pairing at all: a Trust tap
 * inside Telegram-Android fell through to the unknown-wallet branch and
 * opened NOTHING (no wallet, no fallback). Decode in passes, validating
 * after each, up to a small cap that still gives up on genuinely bad input.
 */
export function pairingUriFromWalletLink(raw) {
  const text = String(raw || '').trim();
  if (looksLikePairingUri(text)) return repairPairingUri(text);
  const match = /(?:^|[?&])uri=([\s\S]*)$/i.exec(text);
  if (!match) return '';
  let decoded = match[1];
  for (let pass = 0; pass < 4; pass += 1) {
    decoded = repairPairingUri(decoded);
    if (looksLikePairingUri(decoded)) return decoded;
    let next;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      /* Invalid percent encoding: a few wallets accept an unencoded URI.
         Validate what we hold, never guess. */
      return looksLikePairingUri(decoded) ? decoded : '';
    }
    if (next === decoded) return '';
    decoded = next;
  }
  return '';
}

/**
 * Return the HTTPS equivalent of a known native wallet link. This helper is a
 * fallback builder only; decideWalletOpen deliberately prefers native links.
 */
export function universalForWalletLink(raw) {
  const text = String(raw || '').trim();
  if (!text || isHttpsUrl(text)) return '';
  const wallet = walletForUrl(text);
  if (!wallet) return '';
  const base = walletLinkBase(wallet.universal);
  const parts = splitUrl(text);
  if (!base || !parts) return '';
  return `${base}${parts.rest}`;
}

function knownWalletDecision({ wallet, pairingUri, originalUrl, repaired }) {
  const links = walletDeepLinks(wallet.key, pairingUri);
  if (!links.native) return null;
  /* Rebuild from the validated raw pairing URI. This canonicalizes rare
     unencoded `uri=wc:…&symKey=…` inputs and cannot double-encode because
     walletLink receives the decoded URI, never the incoming query bytes. */
  const nativeUrl = links.native;
  return {
    action: 'open',
    url: nativeUrl,
    fallbackUrl: links.universal || '',
    pairingUri,
    wallet,
    rewritten: nativeUrl !== originalUrl,
    repaired
  };
}

/**
 * Decide whether a URL AppKit asked to open belongs to the pairing hand-off.
 *
 * Open decisions always use a native URL as `url`, with `fallbackUrl` and the
 * raw `pairingUri` alongside it. The delivery layer may choose differently for
 * Telegram, but universal HTTPS is never silently promoted to the primary path.
 */
export function decideWalletOpen(raw) {
  const incoming = String(raw || '').trim();
  const text = repairPairingInUrl(incoming);
  const repaired = text !== incoming;
  if (!text) return { action: 'pass', url: null };

  const parts = splitUrl(text);
  const scheme = parts?.scheme || '';

  /* Known HTTPS wallet hand-offs are normalized back to the native route. */
  if (scheme === 'http' || scheme === 'https') {
    const wallet = walletForUrl(text);
    const pairingUri = pairingUriFromWalletLink(text);
    if (wallet && isHttpsUrl(text) && pairingUri) {
      return knownWalletDecision({ wallet, pairingUri, originalUrl: text, repaired });
    }
    return { action: 'pass', url: null };
  }

  /* In-page schemes used by the SDK are not wallet hand-offs. */
  if (!scheme || scheme === 'about' || scheme === 'blob' || scheme === 'data' || scheme === 'javascript') {
    return { action: 'pass', url: null };
  }

  /* A bare `wc:` URI names no app. Complete it only after AppKit recorded the
     wallet the user tapped; otherwise preserve the original browser behavior. */
  if (scheme === 'wc' && looksLikePairingUri(text)) {
    const pairingUri = repairPairingUri(text);
    const wallet = lastTappedWallet();
    if (!wallet) return { action: 'pass', url: null };
    return knownWalletDecision({
      wallet,
      pairingUri,
      originalUrl: text,
      repaired: repaired || pairingUri !== text
    });
  }

  /* Store/home links have no pairing payload and must pass through untouched. */
  if (!carriesPairingUri(text)) return { action: 'pass', url: null };

  const wallet = walletForUrl(text);
  const pairingUri = pairingUriFromWalletLink(text);
  if (wallet && pairingUri) {
    return knownWalletDecision({ wallet, pairingUri, originalUrl: text, repaired });
  }

  /* Unknown custom wallet: a real browser may still understand its scheme.
     There is no package-safe Android or Telegram fallback we can invent. */
  return {
    action: 'open',
    url: text,
    fallbackUrl: '',
    pairingUri,
    wallet: null,
    rewritten: false,
    repaired
  };
}

/**
 * Install the narrow wallet hand-off bridge on `window.open`.
 *
 * FAIL-OPEN BY CONSTRUCTION: unsupported URLs, a throwing delivery channel,
 * and missing browser APIs all fall back to the original `window.open` call.
 */
export function installWalletOpenBridge({ win, openWallet } = {}) {
  const target = win ?? (typeof window !== 'undefined' ? window : null);
  if (!target || typeof target.open !== 'function' || typeof openWallet !== 'function') {
    return () => {};
  }
  const original = target.open;
  const bridge = function walletOpenBridge(url, name, features) {
    let decision;
    try {
      decision = decideWalletOpen(url);
    } catch {
      decision = { action: 'pass', url: null };
    }
    if (decision.action !== 'open') return original.call(target, url, name, features);
    try {
      openWallet(decision.url, {
        target: name || '_self',
        features: features || 'noreferrer noopener',
        wallet: decision.wallet ?? null,
        walletPackage: decision.wallet?.androidPackage || '',
        fallbackUrl: decision.fallbackUrl || '',
        pairingUri: decision.pairingUri || '',
        rewritten: decision.rewritten,
        repaired: Boolean(decision.repaired),
        /* The live window.open is this bridge; using the original prevents a
           fallback from recursing into itself forever. */
        openWindow: original.bind(target)
      });
      return null;
    } catch {
      return original.call(target, decision.url, name, features);
    }
  };
  target.open = bridge;
  return function uninstall() {
    if (target.open === bridge) target.open = original;
  };
}
