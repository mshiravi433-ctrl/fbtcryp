/**
 * BEST-PRICE COMPARISON
 * ---------------------------------------------------------------------------
 * Ask every aggregator we support at the same time, and use the best answer.
 *
 * ─── THE TWO RULES THAT MAKE THIS SAFE ──────────────────────────────────────
 *
 * 1. WE ONLY EVER EXECUTE A QUOTE WE CAN EXECUTE.
 *    A quote is only allowed to WIN if it is executable. OpenOcean is quoted
 *    but not executed (see lib/openocean.js), so it can never become the
 *    signed transaction. Showing a user a better price and then signing a
 *    different one would be the worst possible bug on this screen: they
 *    consented to a number that is not what happens.
 *
 *    So a better-but-not-executable quote is used for exactly one thing —
 *    telling the user we checked, and by how much the winner led. It never
 *    reaches the signer.
 *
 * 2. A SLOW OR BROKEN SECOND OPINION MUST COST NOTHING.
 *    `Promise.allSettled`, never `Promise.all`. One rejection would otherwise
 *    take down a quote that was perfectly fine. Total latency is
 *    max(primary, secondary) with the secondary on a shorter leash, so this
 *    can only ever be as slow as the primary alone.
 *
 * ─── WHY NOT JUST TAKE THE BIGGER NUMBER ────────────────────────────────────
 * Because two quotes are only comparable if they charge the same fee and
 * assume the same slippage. An aggregator that silently ignored our fee
 * parameter reports a bigger output for the obvious reason — it is not taking
 * our 0.70% out. Ranking on that would make the fee-free path always "win",
 * which is exactly the mistake `getQuote` already refuses to make. So
 * `comparable()` below rejects any pair that does not agree on fee and
 * slippage before a comparison is even attempted.
 */

/**
 * Is this object a usable quote?
 *
 * Anything with an `error` field, or without a positive output, is not. Being
 * strict here means the ranking function never has to defend itself.
 */
export function isUsableQuote(q) {
  if (!q || typeof q !== 'object') return false;
  if (q.error) return false;
  if (typeof q.amountOutWei !== 'bigint') return false;
  return q.amountOutWei > 0n;
}

/**
 * Can these two quotes be honestly compared?
 *
 * They must charge the same fee and assume the same slippage. Otherwise the
 * "better" one may just be the one taking less money for us, or the one
 * quoting a rosier fill it will not honour.
 */
export function comparable(a, b) {
  if (!isUsableQuote(a) || !isUsableQuote(b)) return false;
  if (Number(a.feeBps ?? 0) !== Number(b.feeBps ?? 0)) return false;
  // Slippage differences change minOut, not amountOut, but a mismatch means
  // one of the callers configured something differently and the comparison is
  // not the like-for-like it appears to be.
  if (Number(a.slippage ?? 0) !== Number(b.slippage ?? 0)) return false;
  return true;
}

/**
 * How much better is `challenger` than `champion`, in basis points?
 * Positive means the challenger returns more of the output token.
 */
export function improvementBps(champion, challenger) {
  if (!isUsableQuote(champion) || !isUsableQuote(challenger)) return 0;
  if (champion.amountOutWei <= 0n) return 0;
  const diff = challenger.amountOutWei - champion.amountOutWei;
  // BigInt maths first so a large 18-decimal amount cannot lose precision by
  // being turned into a float before the subtraction.
  return Number((diff * 10000n) / champion.amountOutWei);
}

/**
 * Pick the quote to use, and describe what the comparison found.
 *
 * @param {Array} quotes  candidates; rejected/failed entries may be present
 * @returns {{ best, alternatives, checked, beatenBy }}
 *   best        the quote to execute — always executable, or null
 *   checked     how many usable quotes were compared (for the UI's "we
 *               checked N routes")
 *   beatenBy    when a NON-executable quote was better, how many bps better.
 *               Reported so we can be honest rather than pretend we won.
 */
export function pickBestQuote(quotes) {
  const usable = (quotes ?? []).filter(isUsableQuote);

  if (!usable.length) {
    return { best: null, alternatives: [], checked: 0, beatenBy: 0 };
  }

  /*
   * Only executable quotes are eligible to win. `executable !== false` rather
   * than `=== true`: the existing KyberSwap quote predates this flag and does
   * not set it, and defaulting a legacy quote to "cannot execute" would break
   * swapping entirely. Opt-out, not opt-in — the only module that opts out is
   * the one that genuinely cannot sign.
   */
  const eligible = usable.filter((q) => q.executable !== false);

  if (!eligible.length) {
    // Every route we found is quote-only. That means we cannot swap, and
    // saying so is far better than handing back something unsignable.
    return { best: null, alternatives: usable, checked: usable.length, beatenBy: 0 };
  }

  const best = eligible.reduce((a, b) => (b.amountOutWei > a.amountOutWei ? b : a));

  /*
   * Did a quote we cannot execute beat the one we can? Worth surfacing to
   * ourselves in logs, and worth NOT hiding from the user — but it must never
   * change what gets signed.
   */
  let beatenBy = 0;
  for (const q of usable) {
    if (q === best) continue;
    if (!comparable(best, q)) continue;
    const delta = improvementBps(best, q);
    if (delta > beatenBy) beatenBy = delta;
  }

  return {
    best,
    alternatives: usable.filter((q) => q !== best),
    checked: usable.length,
    beatenBy
  };
}

/**
 * Run every quote source concurrently and pick a winner.
 *
 * ─── THE LATENCY CONTRACT ───────────────────────────────────────────────────
 * Sources are started together, so the wall-clock cost is the SLOWEST source,
 * not the sum. Each source is expected to enforce its own timeout; this
 * function adds no waiting of its own. A source that rejects is simply absent
 * from the comparison.
 *
 * @param {Array<() => Promise>} sources  thunks, so nothing starts until here
 * @returns {Promise<{best, alternatives, checked, beatenBy, failures, answered}>}
 *   failures  the rejection reasons, so the caller can tell a genuine
 *             "no route on this pair" from "every routing service was
 *             unreachable" — the two need different messages (see
 *             `classifyQuoteFailure` in lib/swap.js).
 *   answered  how many sources returned ANY response (even an unusable one).
 *             A source that answered at all is evidence the network path to
 *             it works, which is what makes the distinction trustworthy.
 */
export async function quoteAllSources(sources) {
  const settled = await Promise.allSettled(sources.map((fn) => fn()));

  const quotes = [];
  const failures = [];
  let answered = 0;
  for (const r of settled) {
    if (r.status === 'fulfilled') {
      answered += 1;
      if (isUsableQuote(r.value)) quotes.push(r.value);
    } else {
      failures.push(r.reason);
    }
  }

  return { ...pickBestQuote(quotes), failures, answered };
}
