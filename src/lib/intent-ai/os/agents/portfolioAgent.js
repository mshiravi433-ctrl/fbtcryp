/**
 * FBT INTENT OS — Portfolio Agent
 * ---------------------------------------------------------------------------
 * Reads the connected portfolio and describes it. It does not advise.
 *
 * ─── TWO THINGS THAT WERE WRONG ─────────────────────────────────────────────
 *
 * 1. UNPRICED HOLDINGS WERE COUNTED AS ZERO.
 *    `(Number(h.valueUsd) || 0)` turns "we could not price this token" into
 *    "this token is worth nothing", and then divides by the resulting total.
 *    A wallet where half the value sits in an unpriced token reported the
 *    other half as 100% of the portfolio — a concentration warning about a
 *    concentration that does not exist. Unpriced holdings are now excluded
 *    from the denominator and REPORTED, so the user knows the read is partial.
 *
 * 2. IT GAVE ADVICE IT HAD NO BASIS FOR.
 *    `suggestions: ['Consider rebalancing to reduce concentration']` fired on
 *    a concentration number alone. Concentration is not risk on its own: a
 *    wallet that is 70% ETH because the user is deliberately long ETH is not
 *    misallocated, and the agent cannot know which it is. It now states the
 *    OBSERVATION ("70% of priced value is in ETH") and leaves the conclusion
 *    to the user, which is also the only defensible thing for software with
 *    no knowledge of someone's goals or their off-app assets to do.
 *
 * The equal-weight rebalance default was removed for the same reason: an
 * equal split across whatever happens to be in the wallet is not a target
 * anybody chose. planRebalance now requires an explicit target.
 */

export const PORTFOLIO_AGENT_SCHEMA = 'fbt.portfolio-agent.v2';

/** Split holdings into what we can price and what we cannot. */
function priceSplit(holdings = []) {
  const priced = [];
  const unpriced = [];
  for (const h of holdings) {
    const v = Number(h?.valueUsd);
    if (Number.isFinite(v) && v > 0) priced.push({ ...h, valueUsd: v });
    else unpriced.push(h);
  }
  return { priced, unpriced };
}

export function createPortfolioAgent({ portfolioService = null, riskService = null, marketService = null, eventBus = null } = {}) {
  return {
    id: 'portfolio-agent',
    schema: PORTFOLIO_AGENT_SCHEMA,
    
    async analyze({ wallet, holdings = null, detailed = true } = {}) {
      const portfolio = holdings ? { holdings } : (wallet?.portfolio || null);
      
      if (!portfolio || !portfolio.holdings?.length) {
        return {
          ok: false,
          error: 'EMPTY_PORTFOLIO',
          dataStatus: 'unavailable',
          message: 'پرتفوی خالی است یا خوانده نشده'
        };
      }
      
      try {
        // Real service if available
        if (portfolioService?.analyze) {
          const result = await portfolioService.analyze({ holdings: portfolio.holdings, detailed });
          if (result?.ok !== false) return result;
        }
        
        // Fallback local analysis — priced holdings only.
        const { priced, unpriced } = priceSplit(portfolio.holdings);

        if (!priced.length) {
          // Every holding is unpriced. There is no allocation to report and
          // no percentage that would mean anything.
          return {
            ok: true,
            totalValueUsd: null,
            holdings: portfolio.holdings,
            allocation: [],
            unpricedCount: unpriced.length,
            unpricedSymbols: unpriced.map((h) => h.symbol).filter(Boolean),
            dataStatus: 'unavailable',
            reason: 'NO_PRICED_HOLDINGS'
          };
        }

        const total = priced.reduce((s, h) => s + h.valueUsd, 0);
        const sorted = [...priced].sort((a, b) => b.valueUsd - a.valueUsd);
        const largest = sorted[0];
        const allocation = sorted.map((h) => ({
          symbol: h.symbol,
          pct: (h.valueUsd / total) * 100,
          valueUsd: h.valueUsd
        }));

        const concentration = (largest.valueUsd / total) * 100;

        return {
          ok: true,
          totalValueUsd: total,
          holdings: portfolio.holdings,
          allocation,
          largest,
          concentration,
          /* A band on the concentration measurement, named for what it is.
             It is NOT a judgement that the portfolio is badly built. */
          concentrationBand: concentration > 60 ? 'high' : concentration > 40 ? 'medium' : 'low',
          riskLevel: concentration > 60 ? 'high' : concentration > 40 ? 'medium' : 'low',
          /* Stated so no caller can present a partial read as a complete one. */
          pricedCount: priced.length,
          unpricedCount: unpriced.length,
          unpricedSymbols: unpriced.map((h) => h.symbol).filter(Boolean),
          coverage: portfolio.holdings.length ? priced.length / portfolio.holdings.length : 0,
          dataStatus: unpriced.length ? 'partial' : 'live',
          /* Observations, not recommendations. The agent does not know the
             user's goals, horizon or off-app holdings, so it describes what
             it measured and stops there. */
          observations: [
            {
              id: 'concentration',
              metric: 'largest_position_pct',
              value: Math.round(concentration * 10) / 10,
              symbol: largest.symbol
            },
            ...(unpriced.length
              ? [{ id: 'coverage', metric: 'unpriced_holdings', value: unpriced.length }]
              : [])
          ]
        };
      } catch (err) {
        return { ok: false, error: err.message, dataStatus: 'unavailable' };
      }
    },
    
    async planRebalance({ holdings = [], target = null, riskTolerance = 'medium' } = {}) {
      try {
        // The real engine (lib/intent-ai/rebalanceEngine) is fail-closed and
        // handles unpriced holdings properly. Prefer it whenever it is wired.
        if (portfolioService?.planRebalance) {
          return await portfolioService.planRebalance({ holdings, target, riskTolerance });
        }
        if (portfolioService?.rebalance) {
          return await portfolioService.rebalance({ holdings, target });
        }

        /*
         * No target, no plan. The old code defaulted to equal weight across
         * whatever was in the wallet and emitted BUY/SELL trades from it —
         * a set of trades toward an allocation the user never chose, produced
         * by dividing 100 by however many tokens happened to be present.
         * Refusing is the correct answer: a rebalance needs a destination.
         */
        if (!Array.isArray(target) || !target.length) {
          return {
            ok: false,
            code: 'NO_TARGET_ALLOCATION',
            requiresConfirmation: true,
            trades: [],
            message: 'A rebalance needs a target allocation. Tell me the split you want, or open the portfolio page to set one.',
            messageFa: 'برای متعادل‌سازی به یک تخصیص هدف نیاز است. نسبت مورد نظرتان را بگویید یا آن را در صفحه‌ی پرتفوی تعیین کنید.'
          };
        }

        const { priced, unpriced } = priceSplit(holdings);
        const total = priced.reduce((s, h) => s + h.valueUsd, 0);
        if (!(total > 0)) {
          return { ok: false, code: 'UNPRICED_HOLDINGS', trades: [], unpricedCount: unpriced.length };
        }

        const trades = [];
        for (const t of target) {
          const current = priced.find((h) => h.symbol === t.symbol);
          const currentPct = current ? (current.valueUsd / total) * 100 : 0;
          const diff = Number(t.pct) - currentPct;
          // 5 points of drift is the threshold below which the trade's cost
          // outweighs the correction. Kept from the original.
          if (Math.abs(diff) > 5) {
            trades.push({
              symbol: t.symbol,
              side: diff > 0 ? 'buy' : 'sell',
              amountUsd: (Math.abs(diff) * total) / 100,
              fromPct: currentPct,
              toPct: Number(t.pct)
            });
          }
        }

        return {
          ok: true,
          current: priced.map((h) => ({ symbol: h.symbol, pct: (h.valueUsd / total) * 100 })),
          target,
          trades,
          tradeCount: trades.length,
          totalValueUsd: total,
          unpricedCount: unpriced.length,
          // Nothing here executes. The trades are a proposal.
          requiresConfirmation: true,
          executes: false
        };
      } catch (err) {
        return { ok: false, error: err.message, trades: [] };
      }
    },
    
    async handleIntent(intent, context = {}) {
      const wallet = context.wallet;
      const portfolio = context.portfolio;
      const svc = context.services?.portfolioService || portfolioService;
      
      if (intent.type === 'PORTFOLIO_ANALYSIS') {
        if (svc?.analyze && portfolio?.holdings?.length) {
          try {
            const analysis = await svc.analyze({ holdings: portfolio.holdings, detailed: true });
            return { ok: true, analysis, portfolio };
          } catch { /* fall through to local */ }
        }
        const analysis = await this.analyze({ wallet, holdings: portfolio?.holdings });
        return { ok: true, analysis, portfolio };
      }
      
      if (intent.type === 'REBALANCE') {
        const plan = await this.planRebalance({ holdings: portfolio?.holdings || [], riskTolerance: intent.entities?.riskTolerance || 'medium' });
        return { ok: true, rebalancePlan: plan };
      }
      
      return { ok: true, portfolio };
    }
  };
}

export const portfolioAgent = createPortfolioAgent();
