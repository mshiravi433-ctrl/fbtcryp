/**
 * THE NEW-WALLET ENGINE — «کیف پول‌های تازه», read rather than listed.
 * ===========================================================================
 * The fresh-wallet feed has one job: turn «a wallet with few transactions moved
 * a lot of money» into a statement a reader can weigh. A list cannot do that,
 * because the three facts that decide its meaning live in three different
 * fields:
 *
 *   1. HOW YOUNG — a wallet whose counters were never read is not fresh, it is
 *      unverified. The server already refuses to star the unverifiable ones;
 *      this module repeats that rule so a row without `txCount` can never come
 *      out labelled.
 *   2. HOW CONCENTRATED — twelve fresh wallets each moving $1M is a story;
 *      one fresh wallet moving $12M is a single actor, and the read says which.
 *   3. WHAT IT RECEIVED VS MOVED — fresh capital that ARRIVED and stayed is a
 *      different observation from the same dollars bouncing through, and only
 *      the received/moved pair tells them apart.
 *
 * It also makes the "smart" label honest. `interesting` on the wire means «this
 * fresh wallet received a lot». That is a fact about money, not about skill — a
 * wallet created yesterday cannot have a track record — so the strongest label
 * this module will produce is `watch` ("early and funded"), never "smart".
 *
 * Pure arithmetic over the payload the page already fetched.
 */

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** The activity ceiling the server applies; a wallet over it is not "fresh". */
export const FRESH_ACTIVITY_CEILING = 20;
/** One wallet holding this much of the observed capital is a single actor. */
export const CONCENTRATION_WARN = 0.55;

/**
 * @param {object} input
 * @param {Array}  input.wallets  `/api/v1/smart-money/fresh-wallets` rows
 * @param {number} [input.now]
 */
export function readFreshWallets({ wallets = [], now = Date.now() } = {}) {
  const rows = (Array.isArray(wallets) ? wallets : []).filter((w) => w && w.address);
  if (!rows.length) {
    return {
      measured: false, count: 0, capitalUsd: null, chains: [], rows: [],
      concentration: null, dominant: null, note: 'no-fresh-wallet-observed'
    };
  }

  const scored = rows.map((w) => {
    const activity = (num(w.txCount) ?? 0) + (num(w.tokenTransfersCount) ?? 0);
    const capital = num(w.capitalUsd);
    const received = num(w.receivedUsd);
    /* A wallet with no counter reading is unverified: the server should have
       dropped it, and if a payload ever carries one this module still refuses
       to label it. */
    const verifiedFresh = num(w.txCount) !== null && activity <= FRESH_ACTIVITY_CEILING;
    /* Share of the money that ARRIVED over the money that MOVED. Near 1 means
       the capital came in and stayed; low means it passed through. */
    const arrivalShare = capital && received !== null ? clamp(received / capital, 0, 1) : null;
    return {
      address: w.address,
      short: w.short || null,
      chainId: w.chainId ?? null,
      chainShort: w.chainShort || null,
      capitalUsd: capital,
      receivedUsd: received,
      txCount: num(w.txCount),
      activity,
      verifiedFresh,
      /* The strongest honest label: young, verified, and funded from outside. */
      label: !verifiedFresh ? 'unverified'
        : (received !== null && capital !== null && received >= capital * 0.5) ? 'watch'
          : 'passThrough',
      arrivalShare: arrivalShare === null ? null : Math.round(arrivalShare * 100) / 100,
      firstSeen: num(w.firstSeen)
    };
  }).filter((w) => !w.firstSeen || w.firstSeen <= now);

  const verified = scored.filter((w) => w.verifiedFresh);
  const capital = verified.reduce((s, w) => s + (w.capitalUsd ?? 0), 0);
  const largest = verified.sort((a, b) => (b.capitalUsd ?? 0) - (a.capitalUsd ?? 0))[0] || null;
  const concentration = capital > 0 && largest ? (largest.capitalUsd ?? 0) / capital : null;

  return {
    measured: true,
    count: verified.length,
    /* Only verified-fresh capital is summed: adding an unverifiable row would
       inflate the number with money nobody could confirm. */
    capitalUsd: verified.length ? Math.round(capital) : null,
    chains: [...new Set(verified.map((w) => w.chainShort).filter(Boolean))],
    rows: verified,
    concentration: concentration === null ? null : Math.round(concentration * 100) / 100,
    dominant: concentration !== null && concentration >= CONCENTRATION_WARN && largest
      ? { address: largest.address, short: largest.short, sharePct: Math.round(concentration * 100) }
      : null,
    watch: verified.filter((w) => w.label === 'watch').length,
    passThrough: verified.filter((w) => w.label === 'passThrough').length,
    unverified: scored.length - verified.length,
    /* «Nothing verifiable in the feed» is its own sentence: with zero verified
       rows the list is not broad-based, it is unread. */
    note: !verified.length ? 'no-verified-fresh-wallet'
      : concentration !== null && concentration >= CONCENTRATION_WARN
        ? 'single-actor-dominated'
        : 'broad-based'
  };
}

export default readFreshWallets;
