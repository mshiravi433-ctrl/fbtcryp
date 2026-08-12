/**
 * THE LATENCY CONTRACT FOR MULTI-AGGREGATOR QUOTING
 * ---------------------------------------------------------------------------
 * The owner's requirement when asking for better prices was explicit: «بدون
 * باگ و کاهش سرعت سایت» — no bugs and no slowdown.
 *
 * Adding a second aggregator CAN halve quoting speed, if the two calls are
 * awaited in sequence. The whole design rests on them running concurrently,
 * so total time is max(A, B) rather than A + B.
 *
 * That is a runtime property. Reading the source and seeing
 * `Promise.allSettled` proves the right function was called; it does not
 * prove nothing awaits in between, which is exactly the kind of change an
 * innocent-looking refactor makes. So this MEASURES it.
 *
 * Lives in its own async probe because test/units.mjs is deliberately
 * synchronous.
 */
import { quoteAllSources } from '../src/lib/bestQuote.js';

export default async function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);

  const q = (out) => ({ amountOutWei: BigInt(out), feeBps: 70, slippage: 0.5 });
  const after = (ms, v) => () => new Promise((res) => setTimeout(() => res(v), ms));
  const boom = () => () => Promise.reject(new Error('upstream down'));

  /* ---- the measurement that matters ---- */
  const t0 = Date.now();
  let r = await quoteAllSources([after(60, q(100)), after(120, q(140))]);
  const elapsed = Date.now() - t0;

  t('both sources are consulted', r.checked === 2);
  t('the better quote wins', r.best.amountOutWei === 140n);
  /*
   * Sequential would be ~180ms, concurrent ~120ms. The bound is loose because
   * CI timers are noisy — it only has to prove the calls overlapped, not hit
   * a precise number. A regression to sequential awaiting blows straight
   * past it.
   */
  t(`sources run concurrently, not in series (${elapsed}ms, sequential would be ~180)`, elapsed < 170);

  /* ---- a second opinion must never be able to break the first ---- */
  r = await quoteAllSources([after(20, q(100)), boom()]);
  t('a failing source does not break the good one', r.best?.amountOutWei === 100n);

  r = await quoteAllSources([boom(), after(20, q(100))]);
  t('order does not matter when one fails', r.best?.amountOutWei === 100n);

  r = await quoteAllSources([boom(), boom()]);
  t('every source failing yields no quote, not a bad one', r.best === null);

  /* ---- THE "NO ROUTE" REGRESSION: a down primary must not kill the swap ---- */
  /*
   * Before OpenOcean became executable, a KyberSwap outage — or a network
   * that cannot reach it, the Iranian case — produced "no route" even when
   * OpenOcean had found one, because a quote that cannot be signed can never
   * win the comparison. The fix: an executable second aggregator must win
   * the moment the primary fails.
   */
  const ooQuote = { ...q(140), source: 'openocean', executable: true, spender: '0x6352a56caadC4F1E25CD6c75970Fa768A3304e64' };
  r = await quoteAllSources([boom(), after(20, ooQuote)]);
  t('an executable OpenOcean quote saves the swap when KyberSwap is down', r.best?.source === 'openocean' && r.best?.amountOutWei === 140n);
  t('...and the failure reason is reported for classification', r.failures.length === 1 && r.answered === 1);

  r = await quoteAllSources([boom(), after(20, { ...ooQuote, executable: false })]);
  t('a quote-only OpenOcean still cannot win (nothing signable)', r.best === null);

  /*
   * A source that returns something unusable (empty pool, error shape) is
   * discarded rather than ranked — otherwise a zero-output quote could win
   * by being "a quote".
   */
  r = await quoteAllSources([after(10, q(100)), after(10, { error: 'NO_ROUTE' })]);
  t('an error result is discarded, not ranked', r.best?.amountOutWei === 100n && r.checked === 1);

  return rows;
}
