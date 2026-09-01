/**
 * Lab scenarios, lessons, and challenge content.
 *
 * The numbers and shocks here are all fictional. They are designed to teach a
 * CONCEPT (what a 30% drawdown does, why IL exists, when to size down) — not
 * to be a forecast. Anything that hints at a real future event has been
 * scrubbed to keep the spec clear: "Lab is a simulator, not a tip line".
 */

export const SCENARIOS = [
  {
    id: 'crash-30',
    title: '🚨 Market Crash',
    icon: '🚨',
    teaser: 'BTC drops 18%, ETH -24%, SOL -31%. You have $50,000 virtual.',
    shocks: [
      { coin: 'BTC', pct: -18 },
      { coin: 'ETH', pct: -24 },
      { coin: 'SOL', pct: -31 },
      { coin: 'USDC', pct: 0 }
    ],
    choices: [
      { id: 'sell', label: 'Sell everything', outcome: 'panic', impact: -15, lesson: 'Selling at the bottom locks in losses. You exited at the worst possible moment.' },
      { id: 'hold', label: 'Hold and wait', outcome: 'survive', impact: -8, lesson: 'Holding through the crash preserves capital. If your thesis is intact, the recovery is the reward.' },
      { id: 'buy', label: 'Buy the dip', outcome: 'win', impact: +12, lesson: 'If you had dry powder, buying the dip is what professionals do. Risk only what you can afford to lose.' },
      { id: 'reduce', label: 'Reduce risk, keep core', outcome: 'smart', impact: -3, lesson: 'Trimming leverage and rotating to stables cuts drawdown by 32%. Smart rebalancing beats heroics.' }
    ]
  },
  {
    id: 'bull-25',
    title: '🚀 BTC +25%',
    icon: '🚀',
    teaser: 'BTC just ripped 25% in a week. You have $20,000 virtual.',
    shocks: [
      { coin: 'BTC', pct: +25 },
      { coin: 'ETH', pct: +18 },
      { coin: 'SOL', pct: +40 }
    ],
    choices: [
      { id: 'fomo', label: 'All-in on BTC now', outcome: 'late', impact: -6, lesson: 'Chasing a 25% green candle is the textbook "buy high, sell low" trap.' },
      { id: 'take', label: 'Take 30% profits', outcome: 'disciplined', impact: +7, lesson: 'Taking partial profits locks in gains and leaves the rest to run. This is how professionals derisk.' },
      { id: 'hold', label: 'Hold and add on pullback', outcome: 'patient', impact: +9, lesson: 'Wait for a retest of the breakout level. If it holds, add. If it fails, you saved capital.' },
      { id: 'rotate', label: 'Rotate 50% to alts', outcome: 'risky', impact: +2, lesson: 'Rotation amplifies returns if alts lead, but lag if BTC keeps running. Know your risk.' }
    ]
  },
  {
    id: 'defi-hack',
    title: '🔓 DeFi Protocol Hack',
    icon: '🔓',
    teaser: 'A major protocol you LP into gets exploited. TVL drains 80%.',
    shocks: [
      { coin: 'LP-A', pct: -45 },
      { coin: 'USDC', pct: 0 }
    ],
    choices: [
      { id: 'panic', label: 'Withdraw everything immediately', outcome: 'safe', impact: -1, lesson: 'The right call. Hack or no hack, the lesson is: never LP what you cannot afford to lose entirely.' },
      { id: 'hope', label: 'Wait for recovery', outcome: 'loss', impact: -22, lesson: 'Protocol exploits rarely recover. The treasury is gone. Hope is not a strategy.' },
      { id: 'claim', label: 'Claim the insurance fund', outcome: 'partial', impact: -8, lesson: 'If the protocol had an active cover, you recover some. Always check before you deposit.' }
    ]
  },
  {
    id: 'rates-hike',
    title: '🏛️ Interest Rate Hike',
    icon: '🏛️',
    teaser: 'Central bank raises rates 75bps. Risk-off across the board.',
    shocks: [
      { coin: 'BTC', pct: -8 },
      { coin: 'ETH', pct: -12 },
      { coin: 'GOLD', pct: +2 },
      { coin: 'STOCKS', pct: -5 }
    ],
    choices: [
      { id: 'flight', label: 'Move to gold + stables', outcome: 'safe', impact: +1, lesson: 'Defensive positioning shines in rate-hike cycles. Stables and gold preserve capital.' },
      { id: 'ignore', label: 'Ignore and hold crypto', outcome: 'pain', impact: -7, lesson: 'Macro matters. Ignoring rates is a recipe for drawdown.' },
      { id: 'short', label: 'Short the leaders with leverage', outcome: 'risky', impact: -15, lesson: 'Leverage during a regime change is a fast way to be right and still lose money on the wick.' }
    ]
  },
  {
    id: 'liquidation',
    title: '💥 Cascade Liquidation',
    icon: '💥',
    teaser: 'A whale gets liquidated. $400M in long positions gone in 4 minutes.',
    shocks: [
      { coin: 'BTC', pct: -7 },
      { coin: 'ETH', pct: -11 }
    ],
    choices: [
      { id: 'catch', label: 'Try to catch the falling knife', outcome: 'loss', impact: -9, lesson: 'Cascades accelerate. Wait for the chart to stabilise, THEN act.' },
      { id: 'stable', label: 'Park in stables, wait 24h', outcome: 'patient', impact: 0, lesson: 'In a liquidation cascade, doing nothing is often the best trade. Volatility is the risk.' },
      { id: 'hedge', label: 'Open a hedge short', outcome: 'smart', impact: +4, lesson: 'A small hedge offsets a bigger spot loss. Risk management in practice.' }
    ]
  }
];

/* ─── lessons: "Learning by Doing" — quiz format ──────────────────────────── */

export const LESSONS = [
  {
    id: 'lesson-01',
    title: 'Market Basics',
    icon: '📚',
    question: 'What does "market cap" mean?',
    options: [
      'The price of one coin',
      'Price × circulating supply',
      'The amount of money in the market',
      'The daily volume'
    ],
    correct: 1,
    explanation: 'Market cap = current price × number of coins in circulation. A $2 coin with 10B supply has a $20B cap — same as a $20 coin with 1B supply.'
  },
  {
    id: 'lesson-02',
    title: 'Risk Management',
    icon: '🛡️',
    question: 'What is the "1% rule"?',
    options: [
      'Keep 1% of your portfolio in cash',
      'Never risk more than 1% of capital on a single trade',
      'Take 1% profit every day',
      'Use 1x leverage only'
    ],
    correct: 1,
    explanation: 'Risk 1% (or less) of your capital per trade. Ten losses in a row only costs you 10%. This is how professionals survive bad streaks.'
  },
  {
    id: 'lesson-03',
    title: 'Paper Trading',
    icon: '📈',
    question: 'Why is paper trading useful?',
    options: [
      'It makes real money',
      'It is required by law',
      'It lets you practice without losing real money',
      'It guarantees future profits'
    ],
    correct: 2,
    explanation: 'Paper trading uses virtual money to practice. You learn the mechanics, the emotions, the discipline — without the cost of real mistakes.'
  },
  {
    id: 'lesson-04',
    title: 'What is Liquidation?',
    icon: '💥',
    question: 'You have $10,000 collateral and borrow $6,000. ETH drops 20%. What happens?',
    options: [
      'Nothing — your collateral is fine',
      'Your risk increases, but no liquidation yet',
      'You are liquidated — the loan was overcollateralised but the buffer is gone',
      'You make a profit on the short'
    ],
    correct: 2,
    explanation: 'Collateral: $10,000 → $8,000 (after 20% drop). Debt: $6,000. Health factor: 8/6 = 1.33. Many protocols liquidate below 1.25. You are RIGHT at the edge — one more 5% drop and you are gone.'
  },
  {
    id: 'lesson-05',
    title: 'Impermanent Loss',
    icon: '🌊',
    question: 'You LP into ETH/USDC. ETH goes up 50% while USDC stays flat. What happens?',
    options: [
      'You gain exactly 50% on the ETH side',
      'You end up with LESS ETH than if you had just held it',
      'The pool rebalances for you automatically — no impact',
      'You lose all your USDC'
    ],
    correct: 1,
    explanation: 'Impermanent loss: the pool sells your ETH as it rises (to keep the 50/50 ratio). You end up with less ETH than a simple hold — even though the LP fees may compensate. "Impermanent" because if ETH reverts, the loss disappears. In practice, it rarely fully reverts.'
  },
  {
    id: 'lesson-06',
    title: 'Diversification',
    icon: '🧺',
    question: 'Why hold multiple assets instead of just BTC?',
    options: [
      'It is required by regulation',
      'It reduces single-asset risk and smooths returns',
      'It guarantees profits',
      'It is easier to manage'
    ],
    correct: 1,
    explanation: 'No asset goes up forever. A 60/40 BTC/ETH mix has a lower drawdown than 100% BTC, with most of the upside. Diversification is the only "free lunch" in finance.'
  },
  {
    id: 'lesson-07',
    title: 'Stop Loss',
    icon: '🛑',
    question: 'You enter a long at $100 with a $95 stop. What is your max loss per unit?',
    options: [
      '$95',
      '$5 (5%)',
      '$100',
      'It depends on leverage'
    ],
    correct: 1,
    explanation: 'Stop loss defines your worst case BEFORE you enter. $100 - $95 = $5. The discipline of a pre-set stop is what separates traders from gamblers.'
  },
  {
    id: 'lesson-08',
    title: 'Risk / Reward',
    icon: '⚖️',
    question: 'You risk $100 to make $300. What is your R:R?',
    options: [
      '1:1',
      '1:3',
      '3:1',
      'Depends on win rate'
    ],
    correct: 1,
    explanation: 'Risk $100, reward $300 → 1:3 R:R. You can lose 75% of the time and still break even. This is why professionals wait for high-R:R setups.'
  }
];

/* ─── AI Coach messages — keyed by trigger ────────────────────────────────── */

export const COACH_MESSAGES = {
  predict: {
    lowConfidence: 'Confidence below 50% means you are guessing. Wait for a stronger signal.',
    highConfidence: 'Confidence above 80%? That is conviction — but remember the market does not care.',
    correctStreak: 'Three in a row. You are reading the market well. Stay humble, stay disciplined.',
    wrongStreak: 'Three losses. Pause. Re-read the chart, check the timeframe, check the news.'
  },
  paperTrade: {
    noStop: 'Every trade needs a stop loss. If you cannot define your loss, you do not have a trade — you have a gamble.',
    noTp: 'A trade without a target is a trade that will reverse and give back its gains.',
    overSize: 'Position size above 10% of balance is reckless. Cut it down or skip the trade.',
    goodRr: '3:1 R:R is the floor. Anything below that and you need a 70%+ win rate to break even.',
    win: 'Win logged. Do not let one win convince you the next one is free.',
    loss: 'Loss logged. The only bad loss is the one that broke your rules.'
  },
  strategy: {
    noRules: 'A strategy without entry AND exit rules is a hope, not a plan.',
    overFit: 'Sharpe above 3 on synthetic data is suspicious. In real markets, 1.0 is good, 1.5 is excellent.',
    goodBacktest: 'Win rate above 55% with R:R above 1.5 is the sweet spot. Forward test before you trust it.'
  },
  defi: {
    highIl: 'Impermanent loss above 5% usually means the pair diverged too far. LPs work best in sideways markets.',
    leveraged: 'Leverage in DeFi is a liquidation waiting to happen. Stay under 3x or accept the risk.',
    stableLend: 'Stablecoin lending is the lowest-risk yield. APY 5-10% is the realistic range in normal conditions.'
  }
};
