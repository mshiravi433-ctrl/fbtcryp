/**
 * WATCH-ONLY BITCOIN ADDRESSES — public data, and nothing else. Ever.
 * ---------------------------------------------------------------------------
 * A user asked to see the balance of a bitcoin address they hold somewhere
 * else (a hardware wallet, an exchange deposit address, a paper wallet) from
 * inside this app, without moving it here.
 *
 * ─── THE ZERO LAW, RESTATED FOR THIS FILE ───────────────────────────────────
 * This module stores a LABEL and an ADDRESS. That is the whole record.
 *
 * There is no key here, no xpub, no mnemonic, no derivation path and no
 * signing entry point — not "not yet", but structurally: a bitcoin address is
 * a hash of a public key, so nothing recorded by this file can authorise a
 * spend even in principle. The internal wallet's own secrets keep living
 * exclusively in memory inside lib/btcWallet.js and never touch storage; this
 * file's existence must not become the precedent that erodes that, so the
 * shape it persists is deliberately the narrowest one that can work.
 *
 * That is also why the UI built on it has no Send button and is labelled
 * "view only" in every language: an address the app cannot spend from must
 * never be presented next to controls implying it can.
 *
 * ─── WHY THE VALIDATION IS THE REAL VALIDATOR ───────────────────────────────
 * `btcAddressInfo` (lib/btcAddress.js) is the same mainnet-only bech32 /
 * base58check decoder the SEND path uses. Reusing it means a testnet address
 * (tb1…, m…, n…, 2…) is rejected here for exactly the reason it is rejected
 * there, and the two can never drift apart. A regex would accept tb1 strings
 * and then show a permanently empty balance with no explanation.
 *
 * ─── WHY FIVE, AND WHY DEDUPED ──────────────────────────────────────────────
 * Every entry costs one request to our own /api/btc/address proxy whenever the
 * list is opened, and that proxy is rate-limited per IP. Five is enough for
 * the stated use and small enough that the whole list is one screen and one
 * burst. Duplicates are refused rather than silently merged so the user is
 * told why their paste did nothing.
 */

import { btcAddressInfo } from './btcAddress';

/** Namespaced, versioned — the convention every other store here follows. */
export const BTC_WATCH_KEY = 'fbt-btc-watch-v1';

export const MAX_WATCH = 5;
export const MAX_LABEL = 24;

/**
 * Validate a candidate entry.
 *
 * @returns {{ ok: true, entry: {address: string, label: string} }
 *          | { ok: false, code: string }}
 *
 * Codes are stable and translated by the caller:
 *   EMPTY      — nothing typed
 *   INVALID    — not a valid MAINNET bitcoin address (covers testnet)
 *   DUPLICATE  — already in the list
 *   FULL       — the list is at MAX_WATCH
 */
export function validateWatch(address, label, existing = []) {
  const addr = String(address ?? '').trim();
  if (!addr) return { ok: false, code: 'EMPTY' };

  /* The real checksum, mainnet only — see the header. */
  if (!btcAddressInfo(addr).valid) return { ok: false, code: 'INVALID' };

  const list = Array.isArray(existing) ? existing : [];
  /*
   * Case-sensitive compare on purpose. bech32 is defined lower-case and our
   * decoder already normalises it, while base58 IS case-significant — lower-
   * casing a 1… address to compare it would make two different addresses look
   * like the same one.
   */
  if (list.some((e) => e?.address === addr)) return { ok: false, code: 'DUPLICATE' };
  if (list.length >= MAX_WATCH) return { ok: false, code: 'FULL' };

  /* A label is a convenience, never required. Trimmed and capped so one paste
     of a whole paragraph cannot break the row layout. */
  const name = String(label ?? '').trim().slice(0, MAX_LABEL);

  return { ok: true, entry: { address: addr, label: name } };
}

/**
 * Read the saved list.
 *
 * Re-validates on every read rather than trusting what is on disk: storage is
 * user-writable, shared with older builds, and one hand-edited testnet address
 * would otherwise be fetched forever. Anything that fails is dropped silently —
 * there is no honest way to surface "your localStorage was edited".
 */
export function loadWatch() {
  try {
    const raw = localStorage.getItem(BTC_WATCH_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out = [];
    for (const row of parsed) {
      const addr = String(row?.address ?? '').trim();
      if (!addr || !btcAddressInfo(addr).valid) continue;
      if (out.some((e) => e.address === addr)) continue;
      out.push({ address: addr, label: String(row?.label ?? '').trim().slice(0, MAX_LABEL) });
      if (out.length >= MAX_WATCH) break;
    }
    return out;
  } catch {
    /* Private mode, quota, or corrupt JSON — an empty list is the safe answer
       and the user can simply add the address again. */
    return [];
  }
}

/** Persist a list. Returns the list actually written (capped + deduped). */
export function saveWatch(list) {
  const safe = (Array.isArray(list) ? list : []).slice(0, MAX_WATCH).map((e) => ({
    address: String(e?.address ?? '').trim(),
    label: String(e?.label ?? '').trim().slice(0, MAX_LABEL)
  }));
  try {
    localStorage.setItem(BTC_WATCH_KEY, JSON.stringify(safe));
  } catch {
    /* Storage refused (quota / private mode). The in-memory list still works
       for this session, which is better than throwing out of a click handler. */
  }
  return safe;
}

/**
 * Add an entry. Pure with respect to its input: returns a NEW list plus the
 * outcome, so the caller decides whether to persist and what to say.
 */
export function addWatch(list, address, label) {
  const existing = Array.isArray(list) ? list : [];
  const res = validateWatch(address, label, existing);
  if (!res.ok) return { ok: false, code: res.code, list: existing };
  return { ok: true, list: [...existing, res.entry] };
}

/** Remove by address. Returns a new list; unknown addresses are a no-op. */
export function removeWatch(list, address) {
  const addr = String(address ?? '').trim();
  return (Array.isArray(list) ? list : []).filter((e) => e?.address !== addr);
}
