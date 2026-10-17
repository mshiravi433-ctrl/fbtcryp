/**
 * LEARN-TO-EARN — short, honest lessons about assets this app actually lists.
 * ---------------------------------------------------------------------------
 * Every topic here maps to a real surface:
 *   · BTC  — tradable on the swap
 *   · ETH  — stETH / rETH are in the audited YIELD list (lib/earnProducts.js)
 *   · SOL  — the Solana swap and the Solana staking row
 *   · PAXG — tokenized gold, one of the two gold instruments in YIELD
 *
 * Rules for the copy:
 *   1. NO yield number, no price, no forecast. The live rate lives on Farm,
 *      measured there; a number typed into this file would be stale instantly.
 *   2. A wrong answer is not punished and never locks the topic — the user can
 *      retry. Points are paid once per topic, after every question is right.
 *   3. The reward is the same for every topic (LEARN_POINT_VALUE), so nobody
 *      is nudged toward the lesson that pays best.
 *
 * Question/answer text lives in i18n under rewards.v2.learn.<topic>.q<n>.* so
 * all twelve locales can carry it without touching this file.
 */
export const LEARN_TOPICS = Object.freeze([
  {
    id: 'btc',
    symbol: 'BTC',
    color: '#f7931a',
    route: '/coin/bitcoin',
    questions: [
      { id: 'q1', correct: 0, answers: 4 },
      { id: 'q2', correct: 0, answers: 4 }
    ]
  },
  {
    id: 'eth',
    symbol: 'ETH',
    color: '#8a9cff',
    route: '/farm?tab=inapp&focus=eth',
    questions: [
      { id: 'q1', correct: 0, answers: 4 },
      { id: 'q2', correct: 0, answers: 4 }
    ]
  },
  {
    id: 'sol',
    symbol: 'SOL',
    color: '#00ff9d',
    route: '/farm?tab=inapp&focus=sol',
    questions: [
      { id: 'q1', correct: 0, answers: 4 },
      { id: 'q2', correct: 0, answers: 4 }
    ]
  },
  {
    id: 'paxg',
    symbol: 'PAXG',
    color: '#ffc93c',
    route: '/swap?chain=1&from=USDT&to=PAXG',
    questions: [
      { id: 'q1', correct: 0, answers: 4 },
      { id: 'q2', correct: 0, answers: 4 }
    ]
  }
]);

/** A user has finished a topic when its one-time points row exists. */
export function learnDone(pointsLog, topicId) {
  return (Array.isArray(pointsLog) ? pointsLog : []).some(
    (row) => row?.action === `learn:${topicId}`
  );
}
