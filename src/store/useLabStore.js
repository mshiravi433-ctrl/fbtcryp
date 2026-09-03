/**
 * Lab store — virtual practice environment.
 *
 * ─── WHY A SEPARATE STORE ────────────────────────────────────────────────────
 * The main `useAppStore` already runs a virtual balance (NX) for Predict and
 * Invest. This store is the larger one, because Lab now covers far more than
 * those two screens: paper trading, strategy backtests, DeFi simulations, what-if
 * scenarios and a level/leaderboard system. Putting all of that into the main
 * store would explode its size and mix concerns that are conceptually different
 * (the main store is "your wallet's history"; this one is "your training
 * environment").
 *
 * ─── PERSISTENCE ────────────────────────────────────────────────────────────
 * Everything lives in `localStorage` under a single key. The hosting tier is a
 * free one with a tight quota, so the server must never see a Lab row. The
 * `partialize` selector below trims noisy state (live price caches, transient
 * UI flags) before it hits storage, otherwise the saved blob grows with every
 * polling tick.
 *
 * ─── ALL VALUES ARE VIRTUAL ─────────────────────────────────────────────────
 * Same rule as the main store: no real funds anywhere, no pooled customer
 * money. Numbers that look like USD are play credits. The level/leaderboard
 * is a score, not a payout.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useAppStore } from './useAppStore';
import { POINT_VALUES } from '../lib/ranks';

export const LAB_START_BALANCE = 100000; // $100k virtual — matches the design spec

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/* ─── level thresholds (XP → level) ──────────────────────────────────────────
   Curve: 250, 500, 750, ... The label and badge name follow the spec:
   Beginner → Trader → Analyst → Strategist → Portfolio Manager → Market Master. */
const LEVEL_TABLE = [
  { lvl: 1, name: 'Beginner', nameKey: 'beginner', xp: 0 },
  { lvl: 2, name: 'Beginner', nameKey: 'beginner', xp: 250 },
  { lvl: 3, name: 'Trader', nameKey: 'trader', xp: 600 },
  { lvl: 4, name: 'Trader', nameKey: 'trader', xp: 1100 },
  { lvl: 5, name: 'Trader', nameKey: 'trader', xp: 1800 },
  { lvl: 6, name: 'Analyst', nameKey: 'analyst', xp: 2700 },
  { lvl: 7, name: 'Analyst', nameKey: 'analyst', xp: 3800 },
  { lvl: 8, name: 'Strategist', nameKey: 'strategist', xp: 5200 },
  { lvl: 9, name: 'Strategist', nameKey: 'strategist', xp: 7000 },
  { lvl: 10, name: 'Portfolio Manager', nameKey: 'portfolioManager', xp: 9200 },
  { lvl: 11, name: 'Portfolio Manager', nameKey: 'portfolioManager', xp: 11800 },
  { lvl: 12, name: 'Market Master', nameKey: 'marketMaster', xp: 15000 }
];

export function levelFromXp(xp) {
  let picked = LEVEL_TABLE[0];
  for (const row of LEVEL_TABLE) {
    if (xp >= row.xp) picked = row;
  }
  const next = LEVEL_TABLE.find((r) => r.xp > xp) ?? LEVEL_TABLE[LEVEL_TABLE.length - 1];
  const pct = next.xp === picked.xp ? 100 : Math.round(((xp - picked.xp) / (next.xp - picked.xp)) * 100);
  return { ...picked, nextXp: next.xp, pct };
}

const START_PREDICTIONS = []; // { id, coinId, dir, confidence, entryPrice, expiry, settled, exitPrice, at, accuracy }
const START_PAPER_TRADES = []; // { id, symbol, side, qty, entry, stop, tp, exit, pnl, riskScore, closed, openedAt, closedAt }
const START_PORTFOLIOS = []; // { id, name, allocations: {coin: pct}, startedAt, valueAtStart }
const START_CHALLENGES = []; // { id, scenarioId, choice, outcome, xpAward, at }
const START_LESSONS = { completed: [], scores: {} }; // { completed: [lessonId], scores: { lessonId: pct } }
const START_STRATEGIES = []; // { id, name, rules, backtest: {...}, createdAt }
const START_DEFI = []; // { id, kind, params, result, at }
const START_WHATIFS = []; // { id, scenario, snapshot, impact, at }
const START_LEADERBOARD = [
  { id: 'self', name: 'You', xp: 0, isYou: true },
  { id: 'npc-1', name: 'Satoshi', xp: 28450 },
  { id: 'npc-2', name: 'Nakomoto', xp: 22100 },
  { id: 'npc-3', name: 'Vitalik', xp: 19800 },
  { id: 'npc-4', name: 'CZ', xp: 17400 },
  { id: 'npc-5', name: 'Hayden', xp: 15200 },
  { id: 'npc-6', name: 'Aria', xp: 12100 },
  { id: 'npc-7', name: 'Robin', xp: 9700 },
  { id: 'npc-8', name: 'Pixel', xp: 7400 },
  { id: 'npc-9', name: 'Anon', xp: 5200 }
];

export const useLabStore = create(
  persist(
    (set, get) => ({
      /* ─────── profile / wallet ─────── */
      balance: LAB_START_BALANCE,
      xp: 0,
      lessonsDone: 0,
      predictionsCount: 0,
      correctPredictions: 0,
      tradesCount: 0,
      winningTrades: 0,
      challengeWins: 0,
      bestStrategyReturn: 0,

      /* ─────── ledgers ─────── */
      predictions: START_PREDICTIONS,
      paperTrades: START_PAPER_TRADES,
      portfolios: START_PORTFOLIOS,
      challenges: START_CHALLENGES,
      lessons: START_LESSONS,
      strategies: START_STRATEGIES,
      defi: START_DEFI,
      whatifs: START_WHATIFS,
      leaderboard: START_LEADERBOARD,

      /* ─────── derived ─────── */
      level: () => levelFromXp(get().xp),
      accuracy: () => {
        const p = get().predictions;
        if (p.length === 0) return 0;
        return Math.round((get().correctPredictions / p.length) * 100);
      },
      winRate: () => {
        const t = get().paperTrades.filter((x) => x.closed);
        if (t.length === 0) return 0;
        return Math.round((get().winningTrades / t.length) * 100);
      },

      /* ─────── money ─────── */
      addXp(amount, reason = '') {
        if (!(amount > 0)) return;
        set((s) => ({ xp: s.xp + amount }));
      },
      creditBalance(amount) {
        if (!(amount > 0)) return;
        set((s) => ({ balance: +(s.balance + amount).toFixed(2) }));
      },
      debitBalance(amount) {
        if (!(amount > 0)) return;
        if (get().balance < amount) return false;
        set((s) => ({ balance: +(s.balance - amount).toFixed(2) }));
        return true;
      },

      /* ─────── predictions ─────── */
      recordPrediction(p) {
        const entry = { id: uid(), at: Date.now(), settled: false, ...p };
        set((s) => ({
          predictions: [entry, ...s.predictions].slice(0, 200),
          predictionsCount: s.predictionsCount + 1
        }));
        return entry.id;
      },
      settlePrediction(id, exitPrice) {
        const target = get().predictions.find((p) => p.id === id);
        if (!target || target.settled) return;
        const dir = exitPrice > target.entryPrice ? 'up' : exitPrice < target.entryPrice ? 'down' : 'flat';
        const correct = dir === target.dir;
        const accuracy = correct ? Math.min(100, 60 + target.confidence * 0.4) : Math.max(0, 100 - target.confidence);
        set((s) => ({
          predictions: s.predictions.map((p) =>
            p.id === id ? { ...p, exitPrice, settled: true, accuracy, correct } : p
          ),
          correctPredictions: s.correctPredictions + (correct ? 1 : 0)
        }));
        if (correct) get().addXp(25, 'correct prediction');
        else get().addXp(5, 'prediction made');
      },

      /* ─────── paper trades ─────── */
      openPaperTrade(t) {
        const id = uid();
        const entry = { id, closed: false, openedAt: Date.now(), ...t };
        set((s) => ({ paperTrades: [entry, ...s.paperTrades] }));
        return id;
      },
      closePaperTrade(id, exitPrice) {
        const trade = get().paperTrades.find((t) => t.id === id);
        if (!trade || trade.closed) return;
        const pnl = trade.side === 'buy' ? (exitPrice - trade.entry) * trade.qty : (trade.entry - exitPrice) * trade.qty;
        const pnlPct = ((pnl / (trade.entry * trade.qty)) * 100);
        const won = pnl > 0;
        // Risk Management Score: how disciplined were they?
        // Higher if they used a stop loss AND take profit, lower for oversized positions.
        const plannedRisk = trade.stop ? Math.abs(trade.entry - trade.stop) : 0;
        const plannedReward = trade.tp ? Math.abs(trade.tp - trade.entry) : 0;
        const riskRatio = plannedReward / Math.max(plannedRisk, 0.0001);
        const usedBoth = trade.stop && trade.tp ? 1 : 0;
        const sizeScore = trade.qty * trade.entry < 0.1 * get().balance ? 1 : 0; // <10% of balance
        const riskScore = Math.round(
          40 + usedBoth * 25 + sizeScore * 20 + Math.min(15, riskRatio * 3)
        );
        set((s) => ({
          paperTrades: s.paperTrades.map((t) =>
            t.id === id ? { ...t, exit: exitPrice, pnl, pnlPct, closed: true, closedAt: Date.now(), riskScore } : t
          ),
          tradesCount: s.tradesCount + 1,
          winningTrades: s.winningTrades + (won ? 1 : 0),
          balance: +(s.balance + pnl).toFixed(2)
        }));
        if (won) get().addXp(50, 'winning trade');
        else get().addXp(10, 'closed trade');
      },

      /* ─────── portfolio simulator ─────── */
      openPortfolio(p) {
        const id = uid();
        const entry = { id, startedAt: Date.now(), valueAtStart: get().balance, ...p };
        set((s) => ({ portfolios: [entry, ...s.portfolios] }));
        return id;
      },
      closePortfolio(id) {
        set((s) => ({ portfolios: s.portfolios.filter((p) => p.id !== id) }));
      },

      /* ─────── challenges ─────── */
      completeChallenge(c) {
        const entry = { id: uid(), at: Date.now(), ...c };
        set((s) => ({
          challenges: [entry, ...s.challenges],
          challengeWins: s.challengeWins + (c.outcome === 'win' ? 1 : 0)
        }));
        get().addXp(c.xpAward || 30, 'challenge');
        /*
         * A completed learning scenario is real activity (one reward per
         * scenario — the scenarioId travels as the idempotent reference; no
         * lab balance, portfolio or score ever leaves the device).
         */
        if (c.scenarioId) {
          const st = useAppStore.getState();
          st.awardProduct('lab', POINT_VALUES.lab, { refId: `scenario:${c.scenarioId}` });
        }
      },

      /* ─────── lessons ─────── */
      completeLesson(lessonId, score) {
        set((s) => {
          const completed = s.lessons.completed.includes(lessonId)
            ? s.lessons.completed
            : [...s.lessons.completed, lessonId];
          const scores = { ...s.lessons.scores, [lessonId]: Math.max(s.lessons.scores[lessonId] ?? 0, score) };
          return {
            lessons: { completed, scores },
            lessonsDone: completed.length
          };
        });
        get().addXp(Math.round(score / 4), 'lesson');
      },

      /* ─────── strategy lab ─────── */
      saveStrategy(strat) {
        const entry = { id: uid(), createdAt: Date.now(), ...strat };
        set((s) => ({ strategies: [entry, ...s.strategies] }));
        if (strat.backtest?.returnPct > get().bestStrategyReturn) {
          set({ bestStrategyReturn: strat.backtest.returnPct });
        }
        get().addXp(60, 'strategy backtest');
        return entry.id;
      },

      /* ─────── DeFi sim ─────── */
      runDefi(d) {
        const entry = { id: uid(), at: Date.now(), ...d };
        set((s) => ({ defi: [entry, ...s.defi].slice(0, 50) }));
        get().addXp(20, 'defi sim');
        return entry;
      },

      /* ─────── what-if ─────── */
      recordWhatif(w) {
        const entry = { id: uid(), at: Date.now(), ...w };
        set((s) => ({ whatifs: [entry, ...s.whatifs].slice(0, 50) }));
        get().addXp(15, 'what-if');
        return entry;
      },

      /* ─────── leaderboard (your row only) ─────── */
      syncLeaderboard() {
        const xp = get().xp;
        set((s) => ({
          leaderboard: s.leaderboard.map((r) => (r.isYou ? { ...r, xp } : r)).sort((a, b) => b.xp - a.xp)
        }));
      },

      /* ─────── reset ─────── */
      resetLab() {
        set({
          balance: LAB_START_BALANCE,
          xp: 0,
          lessonsDone: 0,
          predictionsCount: 0,
          correctPredictions: 0,
          tradesCount: 0,
          winningTrades: 0,
          challengeWins: 0,
          bestStrategyReturn: 0,
          predictions: [],
          paperTrades: [],
          portfolios: [],
          challenges: [],
          lessons: { completed: [], scores: {} },
          strategies: [],
          defi: [],
          whatifs: []
        });
      }
    }),
    {
      name: 'fbt-lab-v1',
      partialize: (s) => {
        // Drop derived getters from the persisted blob — they're recomputed on load.
        const { level, accuracy, winRate, ...rest } = s;
        void level;
        void accuracy;
        void winRate;
        return rest;
      }
    }
  )
);
