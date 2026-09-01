/**
 * Lab scenarios, lessons, and challenge content.
 *
 * The numbers and shocks here are all fictional. They are designed to teach a
 * CONCEPT (what a 30% drawdown does, why IL exists, when to size down) — not
 * to be a forecast. Anything that hints at a real future event has been
 * scrubbed to keep the spec clear: "Lab is a simulator, not a tip line".
 *
 * ─── WHY THE TEXT LIVES IN i18n, NOT HERE ──────────────────────────────────
 * This file only holds the *structure* (ids, outcomes, impacts, correct
 * answers, icons). Every user-facing string — titles, teasers, choice labels,
 * lessons, questions, options, explanations — is fetched at render time via
 * `t('lab2.scenarios.<id>…')` / `t('lab2.lessons.<id>…')`. The previous
 * version hardcoded English sentences here, which left the Lab permanently
 * English even when the rest of the app was in Persian.
 */

export const SCENARIOS = [
  {
    id: 'crash-30',
    icon: '🚨',
    shocks: [
      { coin: 'BTC', pct: -18 },
      { coin: 'ETH', pct: -24 },
      { coin: 'SOL', pct: -31 },
      { coin: 'USDC', pct: 0 }
    ],
    choices: [
      { id: 'sell', outcome: 'panic', impact: -15 },
      { id: 'hold', outcome: 'survive', impact: -8 },
      { id: 'buy', outcome: 'win', impact: +12 },
      { id: 'reduce', outcome: 'smart', impact: -3 }
    ]
  },
  {
    id: 'bull-25',
    icon: '🚀',
    shocks: [
      { coin: 'BTC', pct: +25 },
      { coin: 'ETH', pct: +18 },
      { coin: 'SOL', pct: +40 }
    ],
    choices: [
      { id: 'fomo', outcome: 'late', impact: -6 },
      { id: 'take', outcome: 'disciplined', impact: +7 },
      { id: 'hold', outcome: 'patient', impact: +9 },
      { id: 'rotate', outcome: 'risky', impact: +2 }
    ]
  },
  {
    id: 'defi-hack',
    icon: '🔓',
    shocks: [
      { coin: 'LP-A', pct: -45 },
      { coin: 'USDC', pct: 0 }
    ],
    choices: [
      { id: 'panic', outcome: 'safe', impact: -1 },
      { id: 'hope', outcome: 'loss', impact: -22 },
      { id: 'claim', outcome: 'partial', impact: -8 }
    ]
  },
  {
    id: 'rates-hike',
    icon: '🏛️',
    shocks: [
      { coin: 'BTC', pct: -8 },
      { coin: 'ETH', pct: -12 },
      { coin: 'GOLD', pct: +2 },
      { coin: 'STOCKS', pct: -5 }
    ],
    choices: [
      { id: 'flight', outcome: 'safe', impact: +1 },
      { id: 'ignore', outcome: 'pain', impact: -7 },
      { id: 'short', outcome: 'risky', impact: -15 }
    ]
  },
  {
    id: 'liquidation',
    icon: '💥',
    shocks: [
      { coin: 'BTC', pct: -7 },
      { coin: 'ETH', pct: -11 }
    ],
    choices: [
      { id: 'catch', outcome: 'loss', impact: -9 },
      { id: 'stable', outcome: 'patient', impact: 0 },
      { id: 'hedge', outcome: 'smart', impact: +4 }
    ]
  }
];

/* ─── lessons: "Learning by Doing" — quiz format ──────────────────────────── */

export const LESSONS = [
  { id: 'lesson-01', icon: '📚', correct: 1 },
  { id: 'lesson-02', icon: '🛡️', correct: 1 },
  { id: 'lesson-03', icon: '📈', correct: 2 },
  { id: 'lesson-04', icon: '💥', correct: 2 },
  { id: 'lesson-05', icon: '🌊', correct: 1 },
  { id: 'lesson-06', icon: '🧺', correct: 1 },
  { id: 'lesson-07', icon: '🛑', correct: 1 },
  { id: 'lesson-08', icon: '⚖️', correct: 1 }
];
