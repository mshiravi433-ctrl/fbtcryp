/**
 * ─── WHAT THIS TOKEN IS, AS NUMBERS RATHER THAN ADJECTIVES ──────────────────
 *
 * The coin screen could tell a reader the price, the chart and the order book,
 * and nothing about the asset itself: how far it has come from its low, how far
 * it has fallen from its high, whether its supply is capped, how much of its
 * market cap actually trades in a day, and how much of the whole market it is.
 * Every one of those is arithmetic over fields the payload ALREADY carries —
 * `ath`, `athChange`, `atl`, `supply`, `mcap`, `volume` — so this module is pure
 * and needs no request, no effect and no timer.
 *
 * That is the whole reason it is a separate file rather than JSX: it is the
 * part that can be wrong, so it is the part that gets tested without a browser.
 *
 * ─── THE RULE EVERY FUNCTION HERE FOLLOWS ──────────────────────────────────
 * A MISSING NUMBER IS NOT ZERO. The CoinLore backup sends no `ath`, no `atl`
 * and no supply figures, and `?? 0` on any of them would turn "the feed did not
 * say" into "this token has fallen 100% from its high" — the single most
 * misleading sentence this screen could print. So every function returns null
 * for an unmeasured value and the UI renders an em dash with a reason.
 */

/** Coerce to a usable, strictly positive number, or null. */
const pos = (v) => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Coerce to a finite number including zero, or null. */
const finite = (v) => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * How far the price has fallen from its all-time high — a POSITIVE percentage,
 * because the screen labels it «از سقف تاریخی» and a reader should not have to
 * reason about a sign to understand a drawdown.
 *
 * Prefers the upstream's own `athChange` (which is signed and negative for a
 * drawdown) and falls back to computing it from `ath` and `price`. Going
 * through two sources is deliberate: the CoinGecko detail endpoint sends both,
 * the markets endpoint sends only `ath`, and computing it from a rounded price
 * is only safe when the high is a real number.
 *
 * Returns null when the token is AT its high (a drawdown of 0 is not a
 * measurement worth a card) or when neither source is usable.
 */
export function drawdownFromAth(coin) {
  if (!coin) return null;
  const reported = finite(coin.athChange);
  if (reported != null && reported < 0) return Math.abs(reported);
  const ath = pos(coin.ath);
  const price = pos(coin.price);
  if (ath == null || price == null || price >= ath) return null;
  return ((ath - price) / ath) * 100;
}

/**
 * How far the price has risen above its all-time low — a POSITIVE percentage
 * under the label «از کف تاریخی».
 *
 * `atlChange` is signed and positive for a rise, and is preferred for the same
 * reason as above. Computed from `atl` and `price` when it is absent.
 */
export function riseFromAtl(coin) {
  if (!coin) return null;
  const reported = finite(coin.atlChange);
  if (reported != null && reported > 0) return reported;
  const atl = pos(coin.atl);
  const price = pos(coin.price);
  if (atl == null || price == null || price <= atl) return null;
  return ((price - atl) / atl) * 100;
}

/**
 * Position of the price inside its 24-hour range, 0..1 — the same number the
 * market list's range bar draws, exposed as a value so this panel can state it
 * in words as well as in a bar.
 *
 * Null for the three cases where a position is meaningless rather than zero: no
 * high/low, a non-positive low, and a high at or below the low (a feed glitch —
 * drawing that would put the marker outside its own track).
 */
export function dayPosition(coin) {
  const low = pos(coin?.low24h);
  const high = pos(coin?.high24h);
  const price = pos(coin?.price);
  if (low == null || high == null || price == null) return null;
  if (high <= low) return null;
  return Math.min(1, Math.max(0, (price - low) / (high - low)));
}

/**
 * Volume divided by market cap — how much of the asset's value changes hands in
 * a day. This is the honest "liquidity" figure: 0.02 is a thin market where a
 * position of size cannot be exited quietly, 0.5 is a market in motion.
 *
 * Null when either side is missing or the cap is zero, because a ratio with a
 * zero denominator is not a small number, it is a missing one.
 */
export function turnoverRatio(coin) {
  const volume = pos(coin?.volume);
  const mcap = pos(coin?.mcap);
  if (volume == null || mcap == null) return null;
  return volume / mcap;
}

/**
 * Share of the whole market this token represents, as a percentage.
 * Null when either side is missing — a token with no global reading is not 0%
 * of the market, it is unmeasured.
 */
export function marketShare(coin, global) {
  const mcap = pos(coin?.mcap);
  const total = pos(global?.mcap);
  if (mcap == null || total == null) return null;
  const share = (mcap / total) * 100;
  /* A share above 100% is a feed inconsistency, not a fact. */
  return share > 0 && share <= 100 ? share : null;
}

/**
 * Supply structure: how much of the maximum is already circulating.
 *
 * Returns { circulating, max, total, capped, unlocked } or nulls — the three
 * need different sentences. A token with NO maximum supply (ETH, SOL, DOGE) is
 * not "0% unlocked": it is uncapped, which is a different and equally important
 * fact. That is why `capped` is reported separately rather than inferred from a
 * percentage of zero.
 *
 * `capped` therefore has THREE states, and collapsing the last two would be the
 * same mistake as `?? 0`:
 *   true   — the feed sent a positive maximum, so a ceiling exists.
 *   false  — the feed sent a `maxSupply` field that is null/0, which is how
 *            CoinGecko says "this asset has no ceiling".
 *   null   — the feed sent no `maxSupply` key AT ALL (our own backend and the
 *            CoinLore backup both omit it), so the ceiling is UNKNOWN. Calling
 *            that "uncapped" would state a fact the payload never contained.
 *
 * `unlocked` is null unless a real ceiling AND a circulating figure exist. A
 * circulating count above its own ceiling is a feed inconsistency, not a
 * token 143% unlocked, so it also returns null instead of clamping.
 */
export function supplyStructure(coin) {
  const circulating = pos(coin?.supply);
  const max = pos(coin?.maxSupply);
  const total = pos(coin?.totalSupply);
  const hasMaxField = coin != null && Object.prototype.hasOwnProperty.call(coin, 'maxSupply');
  const capped = max != null ? true : hasMaxField ? false : null;
  const ratio = capped === true && circulating != null ? circulating / max : null;
  /* A hair over 100% is rounding upstream; a third over is contradictory data. */
  const unlocked = ratio != null && ratio <= 1 + 1e-6 ? Math.min(1, ratio) : null;
  return { circulating, max, total, capped, unlocked };
}

/**
 * ─── HOW THE WIDER MARKET HAS PUSHED THIS TOKEN AROUND ─────────────────────
 *
 * The honest answer to "what do global moves do to this token" is a
 * CO-MOVEMENT, not a story: did this token move the same way as the market over
 * the windows both are measured on, and by how much relative to it.
 *
 * `beta` is the simple ratio of the token's move to the market's move over the
 * same window (|token| / |market|). It is NOT a regression — a proper beta
 * needs a return series and this screen has three data points — so the panel
 * must present it as "amplification over this window", never as "this token's
 * beta". Calling it a beta would be the kind of precision-shaped lie this
 * codebase keeps deleting.
 *
 * Null when the market barely moved (|market| < 0.25%): dividing by a number
 * that is nearly zero produces an enormous ratio that describes arithmetic
 * rather than the token.
 */
export function marketAmplification(coin, global) {
  const token = finite(coin?.change24h);
  const market = finite(global?.avgChange);
  if (token == null || market == null) return null;
  if (Math.abs(market) < 0.25) return null;
  return token / market;
}

/**
 * Did this token move with the market or against it over 24 h?
 *
 * 'with' / 'against' / 'flat' (one side barely moved) / null (unmeasured).
 * A token that fell while the market rose is the interesting case and is the
 * one a single coloured percentage cannot show.
 */
export function marketAgreement(coin, global) {
  const token = finite(coin?.change24h);
  const market = finite(global?.avgChange);
  if (token == null || market == null) return null;
  if (Math.abs(token) < 0.1 || Math.abs(market) < 0.1) return 'flat';
  return (token >= 0) === (market >= 0) ? 'with' : 'against';
}

/**
 * How this token compares with Bitcoin over the same window — the one
 * benchmark every crypto reader already holds in their head.
 *
 * Returns the DIFFERENCE in percentage points (token 24h − BTC 24h), which is
 * what "beat the market" actually means, rather than a ratio that would be
 * meaningless when BTC is flat.
 */
export function versusBitcoin(coin, bitcoin) {
  const token = finite(coin?.change24h);
  const btc = finite(bitcoin?.change24h);
  if (token == null || btc == null) return null;
  return token - btc;
}

/**
 * Everything the identity panel needs, computed once per coin rather than on
 * every render — and safe to call with a coin that carries almost nothing,
 * which is what the backup feed sends.
 */
export function tokenIdentity(coin, { global = null, bitcoin = null } = {}) {
  return {
    drawdown: drawdownFromAth(coin),
    rise: riseFromAtl(coin),
    dayPosition: dayPosition(coin),
    turnover: turnoverRatio(coin),
    share: marketShare(coin, global),
    supply: supplyStructure(coin),
    amplification: marketAmplification(coin, global),
    agreement: marketAgreement(coin, global),
    versusBtc: versusBitcoin(coin, bitcoin),
    /* What the panel should say when it has nothing: which fields the feed
       actually omitted, so «—» comes with a reason instead of a shrug. */
    missing: [
      pos(coin?.ath) == null && finite(coin?.athChange) == null ? 'ath' : null,
      pos(coin?.atl) == null && finite(coin?.atlChange) == null ? 'atl' : null,
      pos(coin?.supply) == null && pos(coin?.totalSupply) == null ? 'supply' : null,
      pos(coin?.mcap) == null ? 'mcap' : null
    ].filter(Boolean)
  };
}
