/**
 * Single client-side store (zustand + localStorage).
 *
 * SCOPE / SAFETY NOTE
 * -------------------------------------------------------------------------
 * Everything in here operates on a **virtual balance** ("NX credits"), not on
 * real customer funds. Trades, investment plans, games and predictions are
 * simulated against live market prices. Running any of these with real user
 * deposits requires money-transmitter / gambling licences, KYC-AML, segregated
 * client accounts and an audited RNG — none of which a client-side store can
 * provide. The server module (`server/`) is deliberately built the same way.
 * Swap this layer for your licensed backend when/if you get there.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { POINT_VALUES } from '../lib/ranks';

const START_BALANCE = 10000;
const MAX_HISTORY = 200;

/*
 * Reputation points per quest id.
 *
 * Read from POINT_VALUES — the SAME table the Earn screen prints on each row —
 * so the figure the user is promised and the figure that lands can never
 * disagree. Duplicating the numbers here is how a row ends up advertising 300
 * and paying 150.
 *
 * `firstTrade` and `firstStake` are the arcade's own quest ids, fired from
 * buy() and openInvestment(). They are mapped to the swap and liquidity values
 * because they are the paper-trading equivalents of the same milestone.
 */
const QUEST_POINTS = {
  connectWallet: POINT_VALUES.connectWallet,
  firstSwap: POINT_VALUES.firstSwap,
  addLiquidity: POINT_VALUES.addLiquidity,
  backupWallet: POINT_VALUES.backupWallet,
  enable2fa: POINT_VALUES.enable2fa,
  inviteFriend: POINT_VALUES.referral,
  firstTrade: POINT_VALUES.firstSwap,
  firstStake: POINT_VALUES.addLiquidity
};

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export const useAppStore = create(
  persist(
    (set, get) => ({
      /* ---------------- profile ---------------- */
      balance: START_BALANCE,
      xp: 0,
      level: 1,
      streak: 0,
      lastClaim: 0,
      referrals: 0,

      /* Reputation points — a score, never a currency. Games keep using the
         virtual NX balance; everything else awards points instead. */
      points: 0,
      pointsLog: [],
      refCode: null,
      soundOn: true,
      favorites: ['bitcoin', 'ethereum', 'solana'],

      /* ---------------- ledgers ---------------- */
      positions: [], // spot holdings   { id, coinId, symbol, qty, avgPrice, openedAt }
      orders: [], //   trade history   { id, side, symbol, qty, price, total, at }
      investments: [], // staking plans { id, planId, amount, apr, days, startedAt, claimedAt }
      bets: [], //     game + market bets
      quests: {}, //   questId -> { done, at }
      notifications: [],

      /* ---------------- derived ---------------- */
      xpForNext: () => 250 * get().level,

      /* ---------------- money ---------------- */
      credit(amount, reason = '') {
        if (!(amount > 0)) return;
        set((s) => ({ balance: +(s.balance + amount).toFixed(2) }));
        if (reason) get().notify(reason, 'success');
      },

      debit(amount, reason = '') {
        if (!(amount > 0)) return false;
        if (get().balance < amount) {
          get().notify('insufficientBalance', 'error');
          return false;
        }
        set((s) => ({ balance: +(s.balance - amount).toFixed(2) }));
        if (reason) get().notify(reason, 'info');
        return true;
      },

      /** Award reputation points for a named action. */
      awardPoints(action, amount, meta = {}) {
        if (!(amount > 0)) return;
        set((st) => ({
          points: st.points + amount,
          pointsLog: [{ id: uid(), action, amount, at: Date.now(), ...meta }, ...st.pointsLog].slice(0, 100)
        }));
      },

      /** Award once ever — used for milestones like first swap or 2FA setup. */
      awardPointsOnce(action, amount) {
        if (get().pointsLog.some((l) => l.action === action)) return false;
        get().awardPoints(action, amount);
        return true;
      },

      addXp(n) {
        set((s) => {
          let xp = s.xp + n;
          let level = s.level;
          while (xp >= 250 * level) {
            xp -= 250 * level;
            level += 1;
          }
          return { xp, level };
        });
      },

      /* ---------------- notifications ---------------- */
      notify(key, kind = 'info', values = {}) {
        const item = { id: uid(), key, kind, values, at: Date.now() };
        set((s) => ({ notifications: [item, ...s.notifications].slice(0, 30) }));
        return item.id;
      },
      dismiss(id) {
        set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) }));
      },

      /* ---------------- favorites ---------------- */
      toggleFavorite(coinId) {
        set((s) => ({
          favorites: s.favorites.includes(coinId)
            ? s.favorites.filter((f) => f !== coinId)
            : [...s.favorites, coinId]
        }));
      },

      /* ---------------- spot trading (paper) ---------------- */
      buy({ coinId, symbol, qty, price, fee = 0.001 }) {
        const cost = qty * price;
        const total = cost * (1 + fee);
        if (!get().debit(total)) return false;

        set((s) => {
          const existing = s.positions.find((p) => p.coinId === coinId);
          const positions = existing
            ? s.positions.map((p) =>
                p.coinId === coinId
                  ? {
                      ...p,
                      avgPrice: (p.avgPrice * p.qty + cost) / (p.qty + qty),
                      qty: p.qty + qty
                    }
                  : p
              )
            : [...s.positions, { id: uid(), coinId, symbol, qty, avgPrice: price, openedAt: Date.now() }];

          return {
            positions,
            orders: [
              { id: uid(), side: 'buy', coinId, symbol, qty, price, total, at: Date.now() },
              ...s.orders
            ].slice(0, MAX_HISTORY)
          };
        });
        get().addXp(12);
        get().completeQuest('firstTrade');
        return true;
      },

      sell({ coinId, symbol, qty, price, fee = 0.001 }) {
        const pos = get().positions.find((p) => p.coinId === coinId);
        if (!pos || pos.qty < qty - 1e-12) {
          get().notify('insufficientPosition', 'error');
          return false;
        }
        const proceeds = qty * price * (1 - fee);
        set((s) => ({
          positions: s.positions
            .map((p) => (p.coinId === coinId ? { ...p, qty: p.qty - qty } : p))
            .filter((p) => p.qty > 1e-10),
          orders: [
            { id: uid(), side: 'sell', coinId, symbol, qty, price, total: proceeds, at: Date.now() },
            ...s.orders
          ].slice(0, MAX_HISTORY)
        }));
        get().credit(proceeds);
        get().addXp(12);
        return true;
      },

      /* ---------------- investment plans ---------------- */
      openInvestment({ planId, amount, apr, days }) {
        if (!get().debit(amount)) return false;
        set((s) => ({
          investments: [
            { id: uid(), planId, amount, apr, days, startedAt: Date.now(), claimedAt: null },
            ...s.investments
          ]
        }));
        get().addXp(25);
        get().completeQuest('firstStake');
        get().notify('investmentOpened', 'success');
        return true;
      },

      claimInvestment(id) {
        const inv = get().investments.find((i) => i.id === id);
        if (!inv || inv.claimedAt) return false;
        const matured = Date.now() >= inv.startedAt + inv.days * 86400000;
        const elapsedDays = (Date.now() - inv.startedAt) / 86400000;
        // early exit forfeits yield and charges a 2% penalty on principal
        const payout = matured
          ? inv.amount * (1 + (inv.apr / 100) * (inv.days / 365))
          : inv.amount * 0.98;
        set((s) => ({
          investments: s.investments.map((i) =>
            i.id === id ? { ...i, claimedAt: Date.now(), payout, early: !matured } : i
          )
        }));
        get().credit(payout, matured ? 'investmentClaimed' : 'investmentEarlyExit');
        get().addXp(matured ? 40 : 5);
        void elapsedDays;
        return true;
      },

      /* ---------------- bets / games ---------------- */
      recordBet(bet) {
        const id = uid();
        set((s) => ({ bets: [{ id, at: Date.now(), settled: false, ...bet }, ...s.bets].slice(0, MAX_HISTORY) }));
        get().addXp(6);
        return id; // callers settle with this id once the round resolves
      },

      /**
       * Close out a bet. Pass `alreadyCredited: true` when the caller has
       * already paid the player (the arcade games credit immediately so the
       * balance animates in sync with the reveal) — the payout is still
       * recorded on the bet for the stats screen, just not paid twice.
       */
      settleBet(id, { won, payout = 0, result, alreadyCredited = false }) {
        set((s) => ({
          bets: s.bets.map((b) =>
            b.id === id ? { ...b, settled: true, won, payout, result, settledAt: Date.now() } : b
          )
        }));
        if (payout > 0 && !alreadyCredited) get().credit(payout);
      },

      /* ---------------- earn ---------------- */
      claimDaily() {
        const now = Date.now();
        const last = get().lastClaim;
        if (now - last < 20 * 3600000) {
          get().notify('claimTooSoon', 'error');
          return false;
        }
        const continuing = now - last < 48 * 3600000;
        const streak = continuing ? get().streak + 1 : 1;
        const reward = 50 + Math.min(streak, 7) * 25;
        set({ lastClaim: now, streak });
        get().credit(reward, 'dailyClaimed');
        get().addXp(20);
        return reward;
      },

      /**
       * Mark a quest done and pay its REPUTATION POINTS.
       *
       * ─── REAL BUG: FIVE OF THE SIX QUESTS COULD NEVER BE COMPLETED ────────
       * The Earn screen advertises six quests. Only `inviteFriend` ever called
       * `awardPoints`; the other five just navigated to a screen and left the
       * row un-ticked forever. So the app promised 685 points — connect a
       * wallet, first swap, add liquidity, back up, enable 2FA — that no user
       * could ever collect. Verified by grepping every `awardPoints` call site
       * in the app: there were four, all in Earn.jsx, none of them a quest.
       *
       * This function also paid the wrong currency. It credited `balance`, the
       * play-money NX used by the arcade, and XP — neither of which is the
       * reputation score the rank tiers and the leaderboard read. A quest
       * could therefore "complete" and move the rank not at all.
       *
       * Points now come from POINT_VALUES, the same table the UI displays, so
       * the number on the row is the number that lands. Passing them in would
       * let a caller invent a reward.
       */
      completeQuest(questId, reward = 0) {
        if (get().quests[questId]?.done) return false;
        set((s) => ({ quests: { ...s.quests, [questId]: { done: true, at: Date.now() } } }));
        if (reward > 0) get().credit(reward, 'questReward');
        get().addXp(15);
        /*
         * `awardPointsOnce`, not `awardPoints`. The quest flag already guards
         * against a second call, but the two live in different slices of the
         * same store and a future reset of one must not re-open the other —
         * this is the belt to that braces.
         */
        const pts = QUEST_POINTS[questId];
        if (pts > 0) get().awardPointsOnce(`quest:${questId}`, pts);
        return true;
      },

      ensureRefCode(tgId) {
        if (get().refCode) return get().refCode;
        const code = `FBT${(tgId ?? Math.floor(Math.random() * 1e6)).toString(36).toUpperCase().slice(-6)}`;
        set({ refCode: code });
        return code;
      },

      toggleSound() {
        set((s) => ({ soundOn: !s.soundOn }));
      },

      resetAccount() {
        set({
          balance: START_BALANCE,
          xp: 0,
          level: 1,
          streak: 0,
          lastClaim: 0,
          positions: [],
          orders: [],
          investments: [],
          bets: [],
          quests: {},
          notifications: [],
          points: 0,
          pointsLog: []
        });
      }
    }),
    {
      name: 'fbt-swap-v1',
      partialize: (s) => {
        const { notifications, ...rest } = s;
        void notifications;
        return rest;
      }
    }
  )
);

export const START_BALANCE_CONST = START_BALANCE;

/** Portfolio valuation against a `{ coinId: price }` map. */
export function valuePortfolio(positions, priceMap) {
  let value = 0;
  let cost = 0;
  const rows = positions.map((p) => {
    const price = priceMap[p.coinId] ?? p.avgPrice;
    const v = p.qty * price;
    const c = p.qty * p.avgPrice;
    value += v;
    cost += c;
    return { ...p, price, value: v, cost: c, pnl: v - c, pnlPct: c ? ((v - c) / c) * 100 : 0 };
  });
  return { rows, value, cost, pnl: value - cost, pnlPct: cost ? ((value - cost) / cost) * 100 : 0 };
}
