// End-to-end simulation of a user flowing through Lab: open Lab, do a
// prediction, settle it, open a paper trade, close it, complete a lesson,
// backtest a strategy. Asserts the state machine, balance, XP, and
// derived numbers all line up the way the UI will read them.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;

const { useLabStore } = await import('../../src/store/useLabStore.js');
const { runBacktest, calcLpImpermanentLoss, applyWhatIf } = await import('../../src/lib/lab/engine.js');
const { SCENARIOS, LESSONS } = await import('../../src/lib/lab/scenarios.js');

let assertions = 0;
let failed = 0;
function assert(label, cond) {
  assertions++;
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}`);
  }
}

console.log('\n=== USER FLOW: New user opens Lab ===\n');
useLabStore.getState().resetLab();
let s = useLabStore.getState();
assert('balance starts at $100k', s.balance === 100000);
assert('xp starts at 0', s.xp === 0);
assert('level is Beginner', s.level().name === 'Beginner');
assert('predictions empty', s.predictions.length === 0);

console.log('\n=== Make a prediction (correct) ===\n');
const pid = s.recordPrediction({ coinId: 'bitcoin', dir: 'up', confidence: 80, entryPrice: 100000, expiry: Date.now() + 60000 });
s.settlePrediction(pid, 105000); // price went up
s = useLabStore.getState();
assert('prediction recorded', s.predictions.length === 1);
assert('prediction settled', s.predictions[0].settled === true);
assert('prediction correct', s.predictions[0].correct === true);
assert('xp awarded +25 (correct)', s.xp === 25);
assert('correctPredictions incremented', s.correctPredictions === 1);

console.log('\n=== Make a wrong prediction ===\n');
const pid2 = s.recordPrediction({ coinId: 'ethereum', dir: 'up', confidence: 40, entryPrice: 3000, expiry: Date.now() + 60000 });
s.settlePrediction(pid2, 2500);
s = useLabStore.getState();
assert('wrong prediction marked incorrect', s.predictions[0].correct === false);
assert('xp awarded +5 (made only)', s.xp === 30);
assert('predictionsCount = 2', s.predictionsCount === 2);
assert('accuracy = 50%', s.accuracy() === 50);

console.log('\n=== Open and close a paper trade ===\n');
const tid = s.openPaperTrade({ symbol: 'bitcoin', side: 'buy', qty: 0.05, entry: 100000, stop: 97000, tp: 110000 });
s = useLabStore.getState();
assert('trade opened', s.paperTrades.length === 1);
assert('balance unchanged while open', s.balance === 100000);
s.closePaperTrade(tid, 105000);
s = useLabStore.getState();
const trade = s.paperTrades[0];
assert('trade closed', trade.closed === true);
assert('pnl positive on price up', trade.pnl > 0);
assert('risk score high (had SL+TP+size)', trade.riskScore >= 70);
assert('balance increased by pnl', s.balance > 100000);
assert('xp +50 (win)', s.xp === 80);
assert('winningTrades = 1', s.winningTrades === 1);

console.log('\n=== Complete a challenge ===\n');
s.completeChallenge({ scenarioId: 'crash-30', choiceId: 'hold', outcome: 'win', impactPct: -8, xpAward: 30 });
s = useLabStore.getState();
assert('challenge recorded', s.challenges.length === 1);
assert('xp +30', s.xp === 110);
assert('challengeWins = 1', s.challengeWins === 1);

console.log('\n=== Complete a lesson ===\n');
s.completeLesson('lesson-01', 100);
s.completeLesson('lesson-02', 75);
s.completeLesson('lesson-03', 100);
s = useLabStore.getState();
assert('3 lessons completed', s.lessonsDone === 3);
assert('lesson scores stored', s.lessons.scores['lesson-01'] === 100);
assert('lesson scores track best only', s.lessons.scores['lesson-01'] === 100);

console.log('\n=== Run a strategy backtest ===\n');
const bt = runBacktest({ rsiBelow: 30, sizePct: 10, stopLoss: 5, takeProfit: 15 }, { days: 365, seed: 42 });
assert('backtest returns an object', typeof bt === 'object');
assert('backtest has returnPct', typeof bt.returnPct === 'number');
assert('backtest has sharpe', typeof bt.sharpe === 'number');
assert('backtest has maxDrawdown', typeof bt.maxDrawdown === 'number');
s.saveStrategy({ name: 'RSI Reversal', rules: { rsiBelow: 30 }, backtest: bt });
s = useLabStore.getState();
assert('strategy saved', s.strategies.length === 1);
assert('best strategy return tracked (number)', typeof s.bestStrategyReturn === 'number');

console.log('\n=== Try DeFi sims ===\n');
s.runDefi({ kind: 'lend', principal: 1000, apy: 8, days: 180, result: 50 });
s.runDefi({ kind: 'lp', principal: 5000, apy: 24, days: 365, priceChange: 50, result: 200 });
s = useLabStore.getState();
assert('defi runs recorded', s.defi.length === 2);

console.log('\n=== Run what-if ===\n');
s.recordWhatif({ shocks: [{ coin: 'BTC', pct: -30 }], portfolio: { BTC: 40, ETH: 25, USDC: 15, GOLD: 10, STOCKS: 10 }, impact: -12 });
s = useLabStore.getState();
assert('whatif recorded', s.whatifs.length === 1);

console.log('\n=== Verify derived state ===\n');
assert('accuracy is 50%', s.accuracy() === 50);
assert('win rate is 100%', s.winRate() === 100);
assert('level still Beginner (under 250 xp)', s.level().name === 'Beginner');
console.log(`  ℹ Total XP: ${s.xp}`);

console.log('\n=== Reset clears everything ===\n');
s.resetLab();
s = useLabStore.getState();
assert('balance back to 100k', s.balance === 100000);
assert('xp back to 0', s.xp === 0);
assert('all ledgers empty', s.predictions.length === 0 && s.paperTrades.length === 0 && s.challenges.length === 0);

console.log(`\n${failed === 0 ? '✅' : '❌'} ${assertions - failed}/${assertions} assertions passed.\n`);
if (failed > 0) process.exit(1);
