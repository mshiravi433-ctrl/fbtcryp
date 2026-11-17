/**
 * FBT AI RISK ENGINE — STRESS TEST CENTRE
 * ===========================================================================
 * «Stress Test Center: آزمایش پرتفوی در شرایط بحرانی.»
 *
 * A stress test is only worth the assumptions it declares. So every scenario
 * here is a NAMED, PARAMETERISED shock with:
 *
 *   shock        what happens to the market, in percent, and to which part
 *   transmission how that reaches THIS book (beta per asset, stablecoin peg,
 *                liquidity haircut, liquidation rule)
 *   result       the dollar outcome, the worst asset, and — where the scenario
 *                can trigger one — the liquidation it would cause
 *
 * ─── THE FIVE SCENARIOS (each one is a real mechanism, not a mood) ──────────
 *   1. crash            a broad sell-off. High-beta assets fall more; stable
 *                       legs do not move. This is the beta model the heat map
 *                       already uses, so the two cannot disagree.
 *   2. liquidity-freeze spreads widen and exits slip. Modelled as a haircut on
 *                       the value of everything that is NOT a stablecoin, with
 *                       the haircut scaled by the asset's own measured volume
 *                       ratio (thin assets lose more).
 *   3. stable-depeg     a stable leg trades below the peg. Applied only to the
 *                       stable holdings, at the user's chosen depth.
 *   4. leverage-cascade volatility doubles and the nearest perp/loan is
 *                       liquidated at its own venue rule — the loss is the
 *                       collateral behind it, not a guess.
 *   5. correlation-one  diversification stops working: every risky leg moves
 *                       with the market shock at beta 1 and the book's own
 *                       measured sigma. The difference from scenario 1 IS the
 *                       value of the diversification being relied on.
 *
 * Each returns `assumptions[]` — the plain sentences the UI prints under the
 * result — and `notAForecast: true`. A stress test is a conditional, and the
 * panel says so.
 */
import { clamp, isNum, num, round, simulateBook, sigmaFromSparkline } from './riskMath.js';

export const STRESS_VERSION = 'fbt.risk-stress.1';

/** Coefficients of the beta model, by bucket. Documented, fixed, not tuned. */
export const BETA_BY_BUCKET = Object.freeze({
  btc: 1.0,
  eth: 1.25,
  l1: 1.35,
  l2: 1.5,
  defi: 1.55,
  ai: 1.7,
  meme: 2.1,
  other: 1.2,
  stable: 0.0
});

const STABLES = new Set(['USDT', 'USDC', 'DAI', 'FDUSD', 'TUSD', 'USDE', 'USDD', 'BUSD', 'PYUSD']);

/* The peg each one is measured against. Mirrors STABLE_PEGS in riskEngine.js —
   two copies would drift, so the test asserts they agree. */
const PEG_USD = Object.freeze({
  USDT: 1, USDC: 1, DAI: 1, FDUSD: 1, TUSD: 1, BUSD: 1, PYUSD: 1,
  /* Stablecoins that are NOT meant to hold $1 exactly. */
  USDE: 1, USDD: 1
});

const BUCKET_OF = (() => {
  const map = {
    BTC: 'btc', WBTC: 'btc', CBBTC: 'btc',
    ETH: 'eth', WETH: 'eth', STETH: 'eth', WSTETH: 'eth', RETH: 'eth',
    SOL: 'l1', ADA: 'l1', AVAX: 'l1', DOT: 'l1', NEAR: 'l1', TRX: 'l1', TON: 'l1', SUI: 'l1', APT: 'l1', SEI: 'l1', BNB: 'l1', ATOM: 'l1', XRP: 'l1', LTC: 'l1',
    ARB: 'l2', OP: 'l2', MATIC: 'l2', POL: 'l2', IMX: 'l2', STRK: 'l2', ZK: 'l2', MNT: 'l2', BLAST: 'l2',
    UNI: 'defi', AAVE: 'defi', MKR: 'defi', CRV: 'defi', LDO: 'defi', GMX: 'defi', SUSHI: 'defi', COMP: 'defi', SNX: 'defi', PENDLE: 'defi', CAKE: 'defi',
    FET: 'ai', TAO: 'ai', RNDR: 'ai', RENDER: 'ai', AGIX: 'ai', OCEAN: 'ai', WLD: 'ai', GRT: 'ai', VIRTUAL: 'ai',
    DOGE: 'meme', SHIB: 'meme', PEPE: 'meme', WIF: 'meme', BONK: 'meme', FLOKI: 'meme', TRUMP: 'meme', MOG: 'meme'
  };
  for (const s of STABLES) map[s] = 'stable';
  return map;
})();

export const bucketOf = (symbol) => BUCKET_OF[String(symbol || '').toUpperCase()] || 'other';

/**
 * Build the leg list one time for every scenario. A leg carries everything the
 * five mechanisms need, computed from measurement:
 *   beta        from the bucket table above
 *   sigmaPct    the asset's own measured daily sigma (sparkline), or the book's
 *   volumeRatio position ÷ 24h volume — how much of a day's trading the exit is
 */
export function buildStressLegs({ holdings = [], markets = [], total = 0, bookSigmaPct = null } = {}) {
  const bySym = new Map();
  for (const m of markets) bySym.set(String(m.symbol || '').toUpperCase(), m);
  return holdings
    .map((h) => {
      const sym = String(h.symbol || '').toUpperCase();
      const valueUsd = num(h.value) ?? 0;
      const m = bySym.get(sym);
      const bucket = bucketOf(sym);
      const sigma = m ? sigmaFromSparkline(m.sparkline) : null;
      const vol24 = num(m?.volume);
      const peg = PEG_USD[sym] ?? 1;
      const price = num(m?.price);
      return {
        symbol: sym,
        bucket,
        valueUsd,
        weightPct: total > 0 ? round((valueUsd / total) * 100, 2) : null,
        beta: BETA_BY_BUCKET[bucket] ?? 1.2,
        sigmaPct: sigma ? round(sigma.sigmaPct, 3) : num(bookSigmaPct),
        sigmaMeasured: Boolean(sigma),
        volumeRatio: vol24 && vol24 > 0 ? round(valueUsd / vol24, 4) : null,
        stable: STABLES.has(sym),
        /* Measured distance from the peg, in percent, signed (below peg = negative).
           Null when the stablecoin has no quote — unmeasured, not "on peg". */
        pegDeviationPct: price == null || price <= 0 ? null : round(((price - peg) / peg) * 100, 3)
      };
    })
    .filter((l) => l.valueUsd > 0)
    .sort((a, b) => b.valueUsd - a.valueUsd);
}

const valueOf = (legs) => legs.reduce((s, l) => s + l.valueUsd, 0);

function summarise(before, afterRows, extra = {}) {
  const beforeUsd = valueOf(before.map((l) => ({ valueUsd: l.valueUsd })));
  /* Rows carry `afterUsd`; reading `valueUsd` here silently summed to zero and
     every scenario reported a −100% book. Caught by the probe, pinned by the
     test suite. */
  const afterUsd = afterRows.reduce((s, l) => s + (num(l.afterUsd) ?? num(l.valueUsd) ?? 0), 0);
  const deltaUsd = afterUsd - beforeUsd;
  /* Losses are NEGATIVE, so the worst row is the SMALLEST `lossUsd`, not the
     largest — comparing `>` picked the best-performing asset and labelled it
     the worst. Fixed after the probe showed `worst: undefined` on every
     scenario. */
  const worst = afterRows.length
    ? afterRows.reduce((a, b) => ((num(b.lossUsd) ?? 0) < (num(a.lossUsd) ?? 0) ? b : a))
    : null;
  return {
    beforeUsd: round(beforeUsd, 2),
    afterUsd: round(afterUsd, 2),
    deltaUsd: round(deltaUsd, 2),
    deltaPct: beforeUsd > 0 ? round((deltaUsd / beforeUsd) * 100, 2) : null,
    worst: worst && (num(worst.lossUsd) ?? 0) < 0
      ? { symbol: worst.symbol, lossUsd: round(worst.lossUsd, 2), lossPct: worst.lossPct }
      : null,
    rows: afterRows,
    ...extra
  };
}

/* ── 1 · crash ─────────────────────────────────────────────────────────────── */

export function runCrash({ legs = [], dropPct = -20, id = null } = {}) {
  const rows = legs.map((l) => {
    const move = l.stable ? 0 : clamp(dropPct * l.beta, -100, 0);
    const after = l.valueUsd * (1 + move / 100);
    return {
      symbol: l.symbol, beta: l.beta, movePct: round(move, 2),
      beforeUsd: round(l.valueUsd, 2), afterUsd: round(after, 2),
      lossUsd: round(after - l.valueUsd, 2),
      lossPct: l.valueUsd > 0 ? round(((after - l.valueUsd) / l.valueUsd) * 100, 2) : null
    };
  });
  return {
    id: id || 'crash',
    version: STRESS_VERSION,
    titleFa: `سقوط بازار ${Math.abs(dropPct)}٪`,
    titleEn: `Market crash ${Math.abs(dropPct)}%`,
    descriptionFa: 'همه دارایی‌های پرریسک با ضریب بتای خودشان سقوط می‌کنند؛ بخش استیبل تکان نمی‌خورد.',
    descriptionEn: 'Every risky asset falls by its own beta; stable legs do not move.',
    severity: Math.abs(dropPct) >= 30 ? 'critical' : Math.abs(dropPct) >= 20 ? 'high' : 'watch',
    notAForecast: true,
    assumptions: [
      { fa: `شوک بازار ${dropPct}٪ و انتقال آن با بتای طبقهٔ هر دارایی (بیت‌کوین ۱٬ میم ۲.۱).`, en: `A ${dropPct}% market shock transmitted through each asset bucket's beta (BTC 1, meme 2.1).` },
      { fa: 'بتا از طبقهٔ دارایی می‌آید، نه از همبستگی اندازه‌گیری‌شدهٔ همان دارایی.', en: 'Beta comes from the asset bucket, not from that asset’s own measured correlation.' },
      { fa: 'استیبل‌کوین‌ها صفر حرکت می‌کنند؛ ریسک دی‌پگ سناریوی جداگانه دارد.', en: 'Stablecoins are held flat; depeg risk has its own scenario.' }
    ],
    ...summarise(legs, rows)
  };
}

/* ── 2 · liquidity freeze ──────────────────────────────────────────────────── */

export function runLiquidityFreeze({ legs = [], spreadBps = 400 } = {}) {
  const rows = legs.map((l) => {
    /*
     * The haircut is the WIDENED SPREAD you must cross to exit, scaled by how
     * much of a day's volume the position is. `volumeRatio` is position ÷ 24h
     * volume, so 1.0 (a position as big as a whole day's trading) pays the
     * full 6× penalty; a position 0.1% of a day's volume pays the base 1×.
     * Capped at 45% so the output stays a haircut and not a fantasy.
     */
    const thin = l.volumeRatio == null ? 2 : clamp(1 + l.volumeRatio * 12, 1, 6);
    const haircutPct = l.stable ? 0 : clamp((spreadBps / 100) * thin, 0, 45);
    const after = l.valueUsd * (1 - haircutPct / 100);
    return {
      symbol: l.symbol, spreadBps,
      volumeRatio: l.volumeRatio,
      movePct: round(-haircutPct, 2),
      beforeUsd: round(l.valueUsd, 2), afterUsd: round(after, 2),
      lossUsd: round(after - l.valueUsd, 2),
      lossPct: round(-haircutPct, 2)
    };
  });
  return {
    id: 'liquidity-freeze',
    version: STRESS_VERSION,
    titleFa: `قفل نقدشوندگی (اسپرد ${spreadBps} bps)`,
    titleEn: `Liquidity freeze (${spreadBps} bps spread)`,
    descriptionFa: 'اسپرد باز می‌شود و هر دارایی به اندازهٔ ریزی بازارش برای خروج جریمه می‌دهد.',
    descriptionEn: 'Spreads widen and each asset is charged for its own market thinness on the way out.',
    severity: 'high',
    notAForecast: true,
    assumptions: [
      { fa: `جریمهٔ پایه برابر خودِ اسپرد اعلام‌شده (${spreadBps / 100}٪) است.`, en: `The base charge equals the quoted spread (${spreadBps / 100}%).` },
      { fa: 'ضریب نازکی = ۱ + ۱۲ × (ارزش دارایی ÷ حجم ۲۴ ساعته)، سقف ۶ برابر.', en: 'The thinness multiplier = 1 + 12 × (position ÷ 24h volume), capped at 6×.' },
      { fa: 'استیبل‌کوین‌ها جریمه نمی‌دهند چون خروج آن‌ها مسیر نقد دارد.', en: 'Stablecoins are not charged: their exit has a liquid path.' }
    ],
    ...summarise(legs, rows)
  };
}

/* ── 3 · stablecoin depeg ──────────────────────────────────────────────────── */

export function runStableDepeg({ legs = [], depthPct = -3 } = {}) {
  /*
   * ─── ONE RULE, AND IT HAS TO AGREE WITH THE STABLECOIN GRADER ───────────
   * A stress test is a hypothetical, so "every stable leg loses 3%" is not
   * dishonest by itself. What WAS dishonest is the version this replaces: it
   * charged a full −3% to a leg that had ALREADY fallen to −3%, and it said a
   * book of pegged USDC loses $150 in the same breath as the stablecoin family
   * reporting those same positions as fine. Two panels, one screen, opposite
   * stories.
   *
   * So the depth is the END STATE, not an increment. Each stable leg moves only
   * the distance from where it is measured to TODAY to where the scenario puts
   * it: `|depth| + deviation`, floored at zero (a leg already past the depth
   * loses nothing more) and capped at the depth. Every leg's starting point is
   * the deviation measured from its own quote — an unmeasured stablecoin is
   * treated as on peg and pays the full depth, because assuming it is already
   * broken would be inventing a measurement.
   */
  const stables = legs.filter((l) => l.stable);
  const stableValue = stables.reduce((s, l) => s + l.valueUsd, 0);
  const depth = Math.abs(depthPct);

  const rows = legs.map((l) => {
    let move = 0;
    if (l.stable) {
      const dev = l.pegDeviationPct == null ? 0 : Math.min(0, l.pegDeviationPct);
      move = -clamp(depth + dev, 0, depth);
    }
    const after = l.valueUsd * (1 + move / 100);
    return {
      symbol: l.symbol, movePct: round(move, 2),
      pegDeviationPct: l.pegDeviationPct ?? null,
      beforeUsd: round(l.valueUsd, 2), afterUsd: round(after, 2),
      lossUsd: round(after - l.valueUsd, 2),
      lossPct: round(move, 2)
    };
  });

  const offPeg = stables.filter((l) => l.pegDeviationPct != null && Math.abs(l.pegDeviationPct) >= 0.05);

  return {
    id: 'stable-depeg',
    version: STRESS_VERSION,
    titleFa: `دی‌پگ استیبل‌کوین (${depthPct}٪)`,
    titleEn: `Stablecoin depeg (${depthPct}%)`,
    descriptionFa: 'بخشی که «پول نقد» حساب می‌کنید تا عمق انتخابی دوباره ارزش‌گذاری می‌شود؛ هر استیبل فقط فاصلهٔ انحراف امروزش تا همان عمق را می‌بازد.',
    descriptionEn: 'The part counted as cash is revalued to the chosen depth; each stablecoin only loses the distance from its measured deviation today to that depth.',
    severity: depth >= 3 ? 'high' : 'watch',
    notAForecast: true,
    assumptions: [
      { fa: `عمق ${depthPct}٪ یک «وضعیت نهایی» است، نه کاهش اضافه؛ استیبلی که همین حالا از پگ خارج شده، دوباره تنبیه نمی‌شود.`, en: `The ${depthPct}% depth is an END STATE, not an increment; a stablecoin that is already off peg is not charged twice.` },
      { fa: `ارزش استیبل شما ${round(stableValue, 2)} دلار است.`, en: `Your stable value is $${round(stableValue, 2)}.` },
      { fa: offPeg.length
        ? `همین حالا ${offPeg.length} استیبل انحراف اندازه‌گیری‌شده دارد: ${offPeg.map((l) => `${l.symbol} ${l.pegDeviationPct}%`).join('، ')}.`
        : 'همین حالا همهٔ استیبل‌های شما با انحراف کمتر از ۰.۰۵٪ روی پگ معامله می‌شوند.',
        en: offPeg.length
          ? `${offPeg.length} stablecoin(s) already carry a measured deviation: ${offPeg.map((l) => `${l.symbol} ${l.pegDeviationPct}%`).join(', ')}.`
          : 'Every stablecoin you hold trades within 0.05% of its peg right now.' },
      { fa: 'این سناریو پیش‌بینی دی‌پگ نیست؛ یک شرط است.', en: 'This is not a depeg forecast; it is a conditional.' }
    ],
    stableValueUsd: round(stableValue, 2),
    ...summarise(legs, rows)
  };
}

/* ── 4 · leverage cascade ──────────────────────────────────────────────────── */

export function runLeverageCascade({ legs = [], positions = [], volMultiplier = 2 } = {}) {
  const rows = legs.map((l) => {
    const move = l.stable ? 0 : clamp(-Math.abs((l.sigmaPct ?? 4) * volMultiplier) * l.beta, -100, 0);
    const after = l.valueUsd * (1 + move / 100);
    return {
      symbol: l.symbol, movePct: round(move, 2), beta: l.beta,
      beforeUsd: round(l.valueUsd, 2), afterUsd: round(after, 2),
      lossUsd: round(after - l.valueUsd, 2), lossPct: round(move, 2)
    };
  });

  /* A position is liquidated when the shock exceeds its own distance to the
     liquidation price — the distance the venue's own model reported. */
  const liquidations = (positions || []).map((p) => {
    const distance = num(p.liquidationDistancePct);
    const moveAbs = clamp(Math.abs((num(p.sigmaPct) ?? 4) * volMultiplier) * (num(p.beta) ?? 1.3), 0, 100);
    const liquidated = distance != null && moveAbs >= distance;
    return {
      symbol: p.symbol ?? null,
      leverage: num(p.leverage),
      collateralUsd: num(p.collateralUsd),
      distancePct: distance,
      shockPct: round(moveAbs, 2),
      liquidated,
      lossUsd: liquidated ? round(num(p.collateralUsd) ?? 0, 2) : 0
    };
  });
  const forcedLoss = liquidations.reduce((s, l) => s + (l.lossUsd || 0), 0);
  const base = summarise(legs, rows);
  return {
    id: 'leverage-cascade',
    version: STRESS_VERSION,
    titleFa: `آبشار وام‌گیری (نوسان ${volMultiplier}×)`,
    titleEn: `Leverage cascade (volatility ${volMultiplier}×)`,
    descriptionFa: 'نوسان چند برابر می‌شود؛ هر پوزیشنی که فاصله‌اش از قیمت لیکوییدیشن کمتر از شوک باشد، لیکویید می‌شود.',
    descriptionEn: 'Volatility multiplies; any position whose liquidation distance is smaller than the shock is liquidated.',
    severity: forcedLoss > 0 ? 'critical' : 'high',
    notAForecast: true,
    assumptions: [
      { fa: `شوک هر دارایی = سیگمای روزانهٔ اندازه‌گیری‌شده × ${volMultiplier} × بتا.`, en: `Each asset's shock = its measured daily sigma × ${volMultiplier} × beta.` },
      { fa: 'لیکوییدیشن با همان فاصله‌ای سنجیده می‌شود که مدل خودِ صرافی گزارش کرده است.', en: 'Liquidation is judged against the distance the venue’s own model reported.' },
      { fa: 'زیان لیکوییدیشن برابر کل وثیقهٔ همان پوزیشن گرفته می‌شود.', en: 'A liquidated position loses its whole collateral.' }
    ],
    liquidations,
    forcedLossUsd: round(forcedLoss, 2),
    ...base,
    afterUsd: round((base.afterUsd ?? 0) - forcedLoss, 2),
    deltaUsd: round((base.deltaUsd ?? 0) - forcedLoss, 2),
    deltaPct: base.beforeUsd > 0 ? round((((base.deltaUsd ?? 0) - forcedLoss) / base.beforeUsd) * 100, 2) : null
  };
}

/* ── 5 · correlation one ───────────────────────────────────────────────────── */

/**
 * «همبستگی ۱» — what a book is paying for diversifying, measured.
 *
 * ─── THE VERSION THIS REPLACES WAS WRONG IN A SUBTLE WAY ───────────────────
 * It ran the crash model at one flat depth and called the gap to the beta model
 * "the value of diversification". For a book of high-beta alts the gap came out
 * NEGATIVE — because a −15% crash at beta 1.9 is worse than −15% flat — so the
 * panel reported that diversification was worth minus three thousand dollars.
 * That is not what correlation-to-one means.
 *
 * Correlation-to-one means: the legs stop cancelling. So the honest number is a
 * SIGMA, not a directional shock. Under perfect correlation a book's daily
 * sigma is the WEIGHTED SUM of its legs' sigmas; with the correlations actually
 * measured it is smaller. The gap between the two, priced at one day and 95%,
 * is what diversification is currently buying — and it is zero or positive by
 * construction, because a covariance matrix cannot beat its own ρ=1 corner.
 */
export function runCorrelationOne({ legs = [], dropPct = -15, bookSigmaPct = null, var95Usd = null, z = 1.6449 } = {}) {
  const risky = legs.filter((l) => !l.stable && l.sigmaPct != null && l.valueUsd > 0);
  const totalRisky = risky.reduce((s, l) => s + l.valueUsd, 0);

  /* σ at ρ = 1 is the value-weighted SUM of the leg sigmas. */
  const sigmaRhoOnePct = totalRisky > 0
    ? round(risky.reduce((s, l) => s + (l.valueUsd / totalRisky) * l.sigmaPct, 0), 3)
    : null;

  const bookTotal = legs.reduce((s, l) => s + l.valueUsd, 0);
  /* The loss is the 95% one-day move under that sigma — the same arithmetic the
     volatility family uses for VaR, so the two cards cannot disagree. */
  const lossPct = sigmaRhoOnePct == null ? null : round(sigmaRhoOnePct * z, 2);

  const rows = legs.map((l) => {
    const move = l.stable || lossPct == null ? 0 : -lossPct;
    const after = l.valueUsd * (1 + move / 100);
    return {
      symbol: l.symbol, movePct: round(move, 2),
      beforeUsd: round(l.valueUsd, 2), afterUsd: round(after, 2),
      lossUsd: round(after - l.valueUsd, 2), lossPct: round(move, 2)
    };
  });

  const base = summarise(legs, rows);
  const varRhoOneUsd = totalRisky > 0 && sigmaRhoOnePct != null
    ? round(totalRisky * (sigmaRhoOnePct / 100) * z, 2)
    : null;
  /* With fewer than two risky legs there is nothing to diversify, so the
     answer is a measured zero rather than an unknown. */
  const nothingToDiversify = risky.length < 2;
  const measuredVar = num(var95Usd);

  return {
    id: 'correlation-one',
    version: STRESS_VERSION,
    titleFa: 'همبستگی ۱ (تنوع از کار می‌افتد)',
    titleEn: 'Correlation goes to one (diversification stops working)',
    descriptionFa: 'اگر همهٔ دارایی‌ها هم‌زمان با هم حرکت کنند، سیگمای کتاب برابر جمع وزن‌دار سیگماها می‌شود — عددی که با همبستگی امروز همیشه کوچک‌تر است.',
    descriptionEn: 'If every asset moves as one, the book’s sigma becomes the weighted sum of the leg sigmas — always larger than the same book with today’s measured correlations.',
    severity: 'high',
    notAForecast: true,
    assumptions: [
      { fa: 'ریسک به‌صورت سیگما سنجیده می‌شود، نه به‌صورت یک شوک جهت‌دار؛ «تنوع» یعنی سیگما کوچک‌تر از جمع اجزاست.', en: 'Risk is measured as sigma, not as a directional shock: "diversification" means the book sigma is smaller than the sum of its parts.' },
      { fa: `سیگما با همبستگی ۱ برابر ${sigmaRhoOnePct == null ? '—' : `${sigmaRhoOnePct}%`} روزانه است و با z=95٪ به زیان تبدیل می‌شود.`, en: `Under correlation 1 the daily sigma is ${sigmaRhoOnePct == null ? '—' : `${sigmaRhoOnePct}%`}, priced at 95% (z).` },
      { fa: 'استیبل‌کوین‌ها در این سناریو حرکت نمی‌کنند.', en: 'Stablecoins do not move in this scenario.' },
      { fa: 'ماتریس کوواریانس نمی‌تواند از گوشهٔ ρ=۱ خودش بهتر باشد؛ پس این کران بالا است، نه پیش‌بینی.', en: 'A covariance matrix cannot beat its own ρ=1 corner, so this is an upper bound, not a forecast.' }
    ],
    sigmaRhoOnePct,
    sigmaMeasuredPct: num(bookSigmaPct),
    varRhoOneUsd,
    /* What diversification is worth RIGHT NOW, in dollars. Never negative. */
    diversificationValueUsd: nothingToDiversify
      ? 0
      : measuredVar != null && varRhoOneUsd != null
        ? round(Math.max(0, varRhoOneUsd - measuredVar), 2)
        : null,
    bookTotalUsd: round(bookTotal, 2),
    dropPct,
    ...base
  };
}

/* ── 6 · monte-carlo on the same book (distribution, not a single path) ───── */

export function runMonteCarlo({ legs = [], paths = 4000, horizonDays = 1, seed = 0x5eed1234 } = {}) {
  const sim = simulateBook({
    legs: legs.map((l) => ({
      symbol: l.symbol,
      valueUsd: l.valueUsd,
      beta: l.beta,
      sigmaPct: l.sigmaPct ?? 4,
      idioPct: l.stable ? 0 : (l.sigmaPct ?? 4) * 0.3
    })),
    paths,
    horizonDays,
    seed
  });
  const totalBefore = legs.reduce((sum, l) => sum + l.valueUsd, 0);
  return {
    id: 'monte-carlo',
    version: STRESS_VERSION,
    titleFa: 'شبیه‌سازی مونت‌کارلو',
    titleEn: 'Monte Carlo simulation',
    descriptionFa: 'چهار هزار مسیر هم‌توزیع از روی سیگماهای اندازه‌گیری‌شده؛ نتیجه یک توزیع است، نه پیش‌بینی.',
    descriptionEn: 'Four thousand paths drawn from the measured sigmas; the output is a distribution, not a forecast.',
    severity: 'watch',
    notAForecast: true,
    assumptions: [
      { fa: 'بازده‌ها گاوسی و مستقل در طول افق هستند (فرض مدل، نه مشاهده).', en: 'Returns are Gaussian and independent across the horizon (a model assumption, not an observation).' },
      { fa: 'سیگمای هر دارایی از اسپارک‌لاین واقعی همان دارایی می‌آید؛ دارایی بدون اندازه‌گیری حذف می‌شود.', en: 'Each sigma comes from that asset’s real sparkline; unmeasured assets are excluded.' },
      { fa: 'بذر شبیه‌سازی ثابت است، پس اجرای دوباره همان اعداد را می‌دهد.', en: 'The seed is fixed, so re-running reproduces the same numbers.' }
    ],
    ...sim,
    /* Same shape as the deterministic scenarios: value in, median value out.
       The DISTRIBUTION fields (p05/p95/lossProb) stay beside it, unrounded by
       this summary. */
    beforeUsd: round(totalBefore, 2),
    afterUsd: sim.p50Usd ?? null,
    deltaUsd: sim.p50Usd != null ? round(sim.p50Usd - totalBefore, 2) : null,
    deltaPct: sim.p50Usd != null && totalBefore > 0 ? round(((sim.p50Usd - totalBefore) / totalBefore) * 100, 2) : null,
    worst: sim.p05Usd != null && totalBefore > 0
      ? { symbol: null, lossUsd: round(sim.p05Usd - totalBefore, 2), lossPct: round(((sim.p05Usd - totalBefore) / totalBefore) * 100, 2), label: 'p05' }
      : null
  };
}

/** The scenario shelf the UI renders. Order = how a user should read it. */
export function runAllScenarios({ legs = [], positions = [], bookSigmaPct = null, var95Usd = null } = {}) {
  return [
    runCrash({ legs, dropPct: -10, id: 'crash-10' }),
    runCrash({ legs, dropPct: -25, id: 'crash-25' }),
    runCrash({ legs, dropPct: -40, id: 'crash-40' }),
    runLiquidityFreeze({ legs, spreadBps: 400 }),
    runStableDepeg({ legs, depthPct: -3 }),
    runLeverageCascade({ legs, positions, volMultiplier: 2 }),
    runCorrelationOne({ legs, dropPct: -15, bookSigmaPct, var95Usd }),
    runMonteCarlo({ legs })
  ];
}

export { isNum };
