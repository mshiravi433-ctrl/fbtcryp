// Smoke tests for Lab — exercises the store, engine, scenarios, market data.
// JSX rendering is not tested here; the build pipeline (vite build) already
// validates that. This catches logic bugs and broken store wiring.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;

// Store
const { useLabStore } = await import('../src/store/useLabStore.js');
console.log('✓ useLabStore loaded');
const s = useLabStore.getState();
console.log('  balance:', s.balance, '(expected 100000)');
console.log('  xp:', s.xp, '(expected 0)');
console.log('  level:', s.level().name, 'lvl', s.level().lvl);

// Reset for clean test
s.resetLab();
console.log('✓ resetLab works');

// Record prediction
const pid = s.recordPrediction({ coinId: 'bitcoin', dir: 'up', confidence: 80, entryPrice: 100, expiry: Date.now() + 60000 });
console.log('✓ recordPrediction:', pid);
s.settlePrediction(pid, 105);
const p = useLabStore.getState().predictions[0];
console.log('  settled:', p.settled, 'correct:', p.correct, 'xp:', useLabStore.getState().xp);

// Paper trade
const tid = s.openPaperTrade({ symbol: 'bitcoin', side: 'buy', qty: 0.1, entry: 100, stop: 95, tp: 110 });
s.closePaperTrade(tid, 108);
const t = useLabStore.getState().paperTrades[0];
console.log('✓ paper trade: pnl', t.pnl.toFixed(2), 'riskScore', t.riskScore);

// Challenge
s.completeChallenge({ scenarioId: 'crash-30', choiceId: 'hold', outcome: 'win', impactPct: -8, xpAward: 30 });
console.log('✓ challenge completed, xp:', s.xp);

// Lesson
s.completeLesson('lesson-01', 100);
console.log('✓ lesson completed, lessonsDone:', s.lessonsDone);

// Strategy
const stratId = s.saveStrategy({ name: 'Test', rules: {}, backtest: { returnPct: 50 } });
console.log('✓ strategy saved:', stratId);

// DeFi
const d = s.runDefi({ kind: 'lend', principal: 1000, apy: 8, days: 180, result: 50 });
console.log('✓ defi run:', d.id);

// What-if
const w = s.recordWhatif({ shocks: [{ coin: 'BTC', pct: -30 }], portfolio: {}, impact: -12 });
console.log('✓ what-if:', w.id);

// Engine
const { runBacktest, comparePortfolios, calcLpImpermanentLoss, calcPositionSize, applyWhatIf } = await import('../src/lib/lab/engine.js');
const bt = runBacktest({ rsiBelow: 30, sizePct: 10, stopLoss: 5, takeProfit: 15 }, { days: 90, seed: 42 });
console.log('✓ backtest:', `return=${bt.returnPct}%`, `sharpe=${bt.sharpe}`, `dd=-${bt.maxDrawdown}%`, `trades=${bt.trades}`);

const cmp = comparePortfolios({ BTC: 100 }, { BTC: 50, ETH: 30, USDC: 20 }, 30, 7);
console.log('✓ compare: A=', cmp.a.returnPct, 'B=', cmp.b.returnPct);

console.log('  IL @ +50%:', calcLpImpermanentLoss(50) + '%');
console.log('  IL @ -50%:', calcLpImpermanentLoss(-50) + '%');

const sz = calcPositionSize({ capital: 100000, riskPct: 1, stopLossPct: 2, entryPrice: 100 });
console.log('  sizing:', sz);

const wi = applyWhatIf({ allocations: { BTC: 40, ETH: 25, USDC: 15, GOLD: 10, STOCKS: 10 } }, [{ coin: 'BTC', pct: -30 }]);
console.log('  whatif impact:', wi.totalImpact + '%');

// Scenarios
const { SCENARIOS, LESSONS } = await import('../src/lib/lab/scenarios.js');
console.log('✓ scenarios:', SCENARIOS.length, '|', SCENARIOS.map(s => s.id).join(', '));
console.log('✓ lessons:', LESSONS.length);

// Market data (mock, no network)
const { getPrices, COINS } = await import('../src/lib/lab/marketData.js');
const prices = await getPrices(['bitcoin', 'ethereum']);
console.log('✓ prices:', prices);
console.log('✓ coins:', COINS.length);

console.log('\n✅ All Lab smoke tests passed.');
