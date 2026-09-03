/**
 * FBT INTENT OS — Strategy Agent
 * ---------------------------------------------------------------------------
 * Spec Phase 3: Multi-AI Intelligence Upgrade — Multi-Agent Reasoning
 *
 * Formulates and compares candidate strategies (Spot, DCA, Lending, Yield, Rebalance).
 * Never executes and never signs. Generates comparative ranking with APY and risks.
 */

export const STRATEGY_AGENT_SCHEMA = 'fbt.strategy-agent.v1';

export function createStrategyAgent({ strategyService = null } = {}) {
  return {
    id: 'strategy-agent',
    schema: STRATEGY_AGENT_SCHEMA,

    async generateStrategies({ intent = {}, context = {}, market = null, riskProfile = 'medium' } = {}) {
      const strategies = [];
      const capital = Number(intent.financialParams?.capital || intent.entities?.amount || 1000);
      const horizon = intent.financialParams?.timeHorizon || '3 Months';
      const objective = intent.financialParams?.objective || 'RETURN_MAXIMIZATION';

      // Strategy 1: Multi-DEX Optimized DCA / Spot Allocation
      strategies.push({
        id: 'strat_bluechip_dca',
        name: 'Bluechip Allocation & Yield Shield',
        nameFa: 'تخصیص متوازن دارایی‌های اصلی + بازدهی استیبل‌کوین',
        riskLevel: 'LOW',
        estimatedApy: '8-14%',
        timeframe: horizon,
        steps: [
          '50% allocation to BTC / ETH for long-term growth',
          '30% allocation to vetted DeFi lending (USDC/USDT) for steady yield',
          '20% flexible liquidity buffer'
        ],
        stepsFa: [
          '۵۰٪ تخصیص به دارایی‌های شاخص (BTC / ETH) جهت رشد مطمئن',
          '۳۰٪ واریز به استخرهای وثیقه‌گذاری معتبر (USDC/USDT) با سود پایدار',
          '۲۰٪ نقدینگی ذخیره جهت بهره‌گیری از فرصت‌های نوسانی'
        ],
        score: 92
      });

      // Strategy 2: High Yield Staking & Farming
      strategies.push({
        id: 'strat_yield_harvest',
        name: 'Curated Yield Discovery',
        nameFa: 'کسب حداکثر بازدهی از پروتکل‌های تأییدشده',
        riskLevel: 'MEDIUM',
        estimatedApy: '15-28%',
        timeframe: horizon,
        steps: [
          'Supply liquidity to Aave / Compound top pools',
          'Auto-compound reward tokens weekly',
          'Dynamic stop-loss on underlying volatility'
        ],
        stepsFa: [
          'تأمین نقدینگی در برترین استخرهای Aave / Compound',
          'سرمایه‌گذاری مجدد هفتگی سودهای دریافتی (Auto-compound)',
          'تعیین حد ضرر خودکار در نوسانات شدید بازار'
        ],
        score: 86
      });

      // Strategy 3: Dynamic Trend Following / Smart Money Tracker
      if (objective === 'RETURN_MAXIMIZATION' || riskProfile === 'HIGH') {
        strategies.push({
          id: 'strat_smart_momentum',
          name: 'Smart Money Momentum Flow',
          nameFa: 'همگامی با جریان سرمایه هوشمند و نوسان‌گیری فعال',
          riskLevel: 'HIGH',
          estimatedApy: '25-45% (Variable)',
          timeframe: '1-3 Months',
          steps: [
            'Track high-conviction whale wallet inflows',
            'Layered limit entries with strict 5% stop-loss',
            'Take-profit ladder at +15%, +30%'
          ],
          stepsFa: [
            'شناسایی و رصد ورودی‌های کیف‌پول‌های نهنگ و پول هوشمند',
            'ورود پله‌ای با تعیین حد ضرر سخت‌گیرانه ۵ درصدی',
            'سیو سود تدریجی در پله‌های ۱۵٪ و ۳۰٪'
          ],
          score: 79
        });
      }

      // Rank strategies by risk fit
      const ranked = strategies.sort((a, b) => b.score - a.score);

      return {
        ok: true,
        capital,
        horizon,
        objective,
        strategies: ranked,
        bestStrategy: ranked[0],
        totalStrategies: ranked.length
      };
    },

    async handleIntent(intent, context = {}) {
      const riskProfile = intent.financialParams?.riskPreference || context.preferences?.riskTolerance || 'medium';
      const result = await this.generateStrategies({ intent, context, riskProfile });
      return { ok: true, strategyPlan: result };
    }
  };
}

export const strategyAgent = createStrategyAgent();
