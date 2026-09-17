/**
 * PAIRING URI HYGIENE
 * ---------------------------------------------------------------------------
 * A WalletConnect v2 pairing URI is `wc:<topic>@2?relay-protocol=irn&symKey=<64
 * hex>`. It travels through HTML surfaces, Telegram's WebView, wallet redirectors
 * and `window.open`, and every hop is a chance to arrive one encoding level off.
 *
 * Two failure modes this module exists to make impossible:
 *
 *   1. `&amp;` — a URI serialized into HTML and read back as a string. Fed to
 *      the SDK's `pair()` it fails with `Missing or invalid. pair() uri:
 *      relay-protocol`, because `amp;relay-protocol` is glued onto the previous
 *      value. This is the wallet-side «Invalid Url:wc:…» report.
 *   2. double-encoding — Telegram's Android client decodes a deep link once in
 *      transit, so the SDK encodes the payload twice there. Decoding once hands
 *      the wallet `wc%3A…`, which cannot pair.
 *
 * Repairing is safe by construction: the values in a pairing URI are hex, a
 * decimal version and a numeric expiry, so a literal `&amp;` can never be a
 * legitimate part of one.
 */

const ENTITY_AMP = /&amp;/g;

/**
 * Tolerant shape test: the parts a pairing URI can be recognised by even when
 * its separators are damaged.
 *
 * Deliberately looser than `isPairingUri` — it must RECOGNISE
 * `wc:…@2?…&amp;symKey=…` as a URI needing repair, which the strict form
 * rejects.
 */
export function looksLikePairingUri(raw) {
  const text = String(raw ?? '').trim();
  return /^wc:[0-9a-f]{8,}@\d/i.test(text) && /symKey=/i.test(text);
}

/**
 * Strict shape test: a URI that is ready to pair AS-IS.
 *
 * The `&amp;` exclusion is the point of it. A lookahead for `relay-protocol=`
 * happily matches inside `amp;relay-protocol=`, so without this a damaged URI
 * passes the strict test and is handed to a wallet (or to `pair()`) as though
 * it were healthy — the exact «Invalid Url:wc:…» report.
 *
 * @returns {boolean} true only for a URI that needs no repair.
 */
export function isPairingUri(raw) {
  const text = String(raw ?? '').trim();
  if (!text || text.includes('&amp;')) return false;
  return /^wc:[A-Za-z0-9_-]+@2\?(?=[^#\s]*relay-protocol=)(?=[^#\s]*symKey=)[^#\s]+$/i.test(text);
}

/**
 * Turn an HTML-damaged URI into a pairable one.
 *
 * @returns {string} the repaired URI, or the input unchanged when there is
 *   nothing to repair (never a re-encoding).
 */
export function repairPairingUri(raw) {
  const text = String(raw ?? '').trim();
  if (!text || !looksLikePairingUri(text)) return String(raw ?? '');
  const repaired = text.replace(ENTITY_AMP, '&');
  return repaired === text ? String(raw ?? '') : repaired;
}

/** Percent-decode, tolerating input that is not valid percent-encoding. */
function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * Decode a `uri=` payload until it looks like a pairing URI.
 *
 * Multiple passes are not paranoia: the SDK double-encodes on Telegram-Android
 * because that client decodes once in transit, and some wallet redirectors add
 * a third. The cap gives up on genuinely bad input instead of looping.
 *
 * @returns {string} the decoded, repaired URI — '' when there isn't one.
 */
export function decodePairingPayload(raw) {
  let value = String(raw ?? '').trim();
  if (!value) return '';
  if (looksLikePairingUri(value)) return repairPairingUri(value);
  for (let pass = 0; pass < 4; pass += 1) {
    const repaired = repairPairingUri(value);
    if (looksLikePairingUri(repaired)) return repaired;
    const next = safeDecode(repaired);
    if (next == null || next === repaired) return '';
    value = next;
  }
  return '';
}

/** Pull the `uri=` payload out of a wallet link. '' when it carries none. */
export function pairingUriFromLink(raw) {
  const text = String(raw ?? '').trim();
  if (looksLikePairingUri(text)) return repairPairingUri(text);
  const match = /(?:^|[?&])uri=([\s\S]*)$/i.exec(text);
  if (!match) return '';
  return decodePairingPayload(match[1]);
}

/**
 * Repair a deep link whose `uri=` payload arrived HTML-escaped, keeping the
 * link itself intact and re-encoding the payload exactly once.
 */
export function repairPairingInLink(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return text;
  const match = /([?&]uri=)([\s\S]*)$/i.exec(text);
  if (!match) return text;
  const decoded = safeDecode(match[2]) ?? match[2];
  const repaired = repairPairingUri(decoded);
  if (repaired === decoded) return text;
  return `${text.slice(0, match.index + match[1].length)}${encodeURIComponent(repaired)}`;
}

/** Does this URL carry a `uri=` parameter at all? */
export function carriesPairingUri(raw) {
  return /(?:^|[?&])uri=/i.test(String(raw ?? ''));
}

/**
 * A pairing URI must survive one encode/decode round trip byte for byte.
 *
 * The «Invalid Url» report is what a double-encoded `uri=` parameter looks
 * like from the wallet's side; this is the check the report is made of.
 */
export function uriRoundTrips(uri) {
  if (typeof uri !== 'string' || !uri.startsWith('wc:')) return false;
  try {
    return encodeURIComponent(decodeURIComponent(uri)) === encodeURIComponent(uri);
  } catch {
    return false;
  }
}
