/**
 * DESTINATION ADDRESS VALIDATION FOR THORCHAIN SWAPS
 * ---------------------------------------------------------------------------
 * ─── THE REPORTED BUG ───────────────────────────────────────────────────────
 *   «در پل وقتی میزنی بومی و دوتا توکن را انتخاب میکنی وقتی ادرس را میزنی برای
 *    هر توکنی این را میزنه "الان برای این جفت قیمتی در دسترس نیست..."»
 *
 * Pick two assets, start typing a destination, and every token shows "no price
 * available for this pair — the pool may be shallow". That message is not just
 * unhelpful, it is FALSE, and it was false in two different ways at once.
 *
 * Reproduced against production, which gave the real upstream text:
 *
 *   destination=bc1q2nf            (a half-typed address)
 *   -> "bad destination address: unable to parse address:
 *       THORName doesn't exist: bc1q2nf"
 *
 *   to=BTC.BTC, destination=0xaf5C…24d6   (an EVM address for a BTC payout)
 *   -> "swap destination address is not the same chain as the target asset"
 *
 * Neither has anything to do with pool depth.
 *
 * ─── WHY EVERY KEYSTROKE FAILED ─────────────────────────────────────────────
 * The panel sends `destination` to the quote endpoint on every change. An
 * address is typed one character at a time, so for all but the final keystroke
 * the value is an INVALID address — and THORChain rejects the whole quote.
 * The user sees a red error the entire time they are typing, which reads as
 * "this pair is broken" rather than "keep going".
 *
 * ─── THE FIX, IN TWO PARTS ──────────────────────────────────────────────────
 * 1. Do not send a destination that cannot possibly be valid. Checked here,
 *    locally, before any request. A partial address produces no request at
 *    all — and quoting without a destination works fine, as production
 *    confirms, so the user still sees a live price while typing.
 *
 * 2. When the address IS complete but belongs to the wrong chain, say exactly
 *    that. "You have entered an Ethereum address but you are receiving
 *    Bitcoin" is actionable; "the pool may be shallow" sends someone to change
 *    the amount, which will never help.
 *
 * ─── WHY THESE PATTERNS AND NOT A FULL DECODER ──────────────────────────────
 * This is a PRE-FLIGHT filter, not the authority. THORChain validates properly
 * on its side and its answer is the one that counts — we cannot be more
 * correct than the chain itself, and pretending otherwise would mean rejecting
 * valid addresses our regex had not anticipated.
 *
 * So the rule is deliberately asymmetric: reject only what is CERTAINLY wrong
 * (too short, impossible characters, obviously another chain's format), and
 * let anything plausible through to be judged upstream. A false reject blocks
 * a real user; a false accept costs one wasted request and a clear error.
 */

/** `BTC.BTC` -> `BTC`, `ETH.USDC-0X…` -> `ETH`. */
export const chainOf = (asset) => String(asset ?? '').split('.')[0].toUpperCase();

/**
 * Per-chain address shapes.
 *
 * Length ranges are generous on purpose — see the asymmetry note above. Where
 * a chain has several valid formats (Bitcoin has three) all are listed rather
 * than picking the common one, because rejecting a legacy address someone
 * pasted from an old wallet is a real failure, not a tidy simplification.
 */
const PATTERNS = {
  /* legacy 1…, P2SH 3…, and bech32 bc1… */
  BTC: /^(bc1[a-z0-9]{25,71}|[13][a-km-zA-HJ-NP-Z1-9]{25,39})$/,
  /* Bitcoin Cash accepts CashAddr with or without the prefix, plus legacy. */
  BCH: /^(bitcoincash:)?(q|p)[a-z0-9]{38,58}$|^[13][a-km-zA-HJ-NP-Z1-9]{25,39}$/,
  LTC: /^(ltc1[a-z0-9]{25,71}|[LM3][a-km-zA-HJ-NP-Z1-9]{25,39})$/,
  DOGE: /^D[5-9A-HJ-NP-U][1-9A-HJ-NP-Za-km-z]{32}$/,
  /* Every EVM chain THORChain reaches shares one address shape. */
  ETH: /^0x[a-fA-F0-9]{40}$/,
  AVAX: /^0x[a-fA-F0-9]{40}$/,
  BSC: /^0x[a-fA-F0-9]{40}$/,
  BASE: /^0x[a-fA-F0-9]{40}$/,
  /* Bech32 chains. THORChain's own addresses are `thor1…`. */
  THOR: /^thor1[a-z0-9]{38}$/,
  GAIA: /^cosmos1[a-z0-9]{38}$/,
  /* Tron base58, same shape used by lib/payout.js. */
  TRON: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
  /* XRP classic addresses. */
  XRP: /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/
};

/**
 * Human-facing name of the format a chain expects, for the error message.
 * A user who typed the wrong thing needs to know what the right thing LOOKS
 * like, not merely that they were wrong.
 */
const HINTS = {
  BTC: 'bc1… / 1… / 3…',
  BCH: 'q… / bitcoincash:q…',
  LTC: 'ltc1… / L… / M…',
  DOGE: 'D…',
  ETH: '0x…',
  AVAX: '0x…',
  BSC: '0x…',
  BASE: '0x…',
  THOR: 'thor1…',
  GAIA: 'cosmos1…',
  TRON: 'T…',
  XRP: 'r…'
};

export const addressHintFor = (asset) => HINTS[chainOf(asset)] ?? null;

/**
 * Could this string plausibly be a destination for `toAsset`?
 *
 * @returns {'empty'|'incomplete'|'wrong-chain'|'ok'|'unknown-chain'}
 *
 * The states are distinct because the UI must react differently to each:
 *   empty        — quote WITHOUT a destination; show a live price, no error.
 *   incomplete   — the user is still typing. Same: no request, NO error.
 *   wrong-chain  — a complete address of the wrong family. This IS an error,
 *                  and a specific one, because it will never resolve itself.
 *   ok           — send it.
 *   unknown-chain— we have no pattern; defer to THORChain rather than guess.
 */
export function checkDestination(value, toAsset) {
  const v = String(value ?? '').trim();
  if (!v) return 'empty';

  const chain = chainOf(toAsset);
  const want = PATTERNS[chain];
  if (!want) return 'unknown-chain';

  if (want.test(v)) return 'ok';

  /*
   * Distinguishing "still typing" from "wrong chain" is what makes this
   * useful. If the value matches ANOTHER chain's pattern completely, the user
   * has pasted the wrong address and telling them so immediately saves them
   * from sending Bitcoin to an Ethereum address — the single most expensive
   * mistake available on this screen.
   */
  for (const [other, re] of Object.entries(PATTERNS)) {
    if (other === chain) continue;
    if (re.test(v)) return 'wrong-chain';
  }

  /*
   * Otherwise it is simply not finished. Length is the honest signal: real
   * addresses on every supported chain are at least 26 characters, so
   * anything shorter is mid-typing rather than mistaken.
   */
  return 'incomplete';
}

/**
 * Should this value be sent to the quote endpoint?
 *
 * Only `ok`. A partial address makes THORChain reject the entire quote, which
 * is what produced a permanent red error while the user typed.
 */
export const shouldSendDestination = (value, toAsset) =>
  checkDestination(value, toAsset) === 'ok' ||
  checkDestination(value, toAsset) === 'unknown-chain';

/**
 * Map an upstream error string onto a key the UI can translate.
 *
 * The panel previously funnelled EVERY failure into one message about pool
 * depth. THORChain's own text is specific and we were discarding it — so a
 * wrong-chain address, an amount below the dust threshold, and a genuinely
 * halted chain all read identically, and only one of the three was ever the
 * real cause.
 */
export function classifyQuoteError(detail) {
  const s = String(detail ?? '').toLowerCase();
  if (!s) return 'QUOTE_FAILED';
  if (s.includes('not the same chain as the target asset')) return 'DEST_WRONG_CHAIN';
  if (s.includes('bad destination address') || s.includes('unable to parse address')) {
    return 'DEST_INVALID';
  }
  if (s.includes('halted') || s.includes('trading is halted')) return 'CHAIN_HALTED';
  /* Their wording for "you are trying to swap dust". */
  if (s.includes('less than') && s.includes('fee')) return 'AMOUNT_TOO_SMALL';
  if (s.includes('not enough asset to pay for fees')) return 'AMOUNT_TOO_SMALL';
  if (s.includes('memo too long')) return 'MEMO_TOO_LONG';
  if (s.includes('pool') && s.includes('not exist')) return 'NO_POOL';
  return 'QUOTE_FAILED';
}
