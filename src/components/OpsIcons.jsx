/**
 * OPERATIONS CENTER ICON MAP.
 * ---------------------------------------------------------------------------
 * ─── THE COMPLAINT ──────────────────────────────────────────────────────────
 *   «آیکون‌ها زشت هستند»
 *
 * Every one of the 15 categories and 80 cards in opsCatalog.js carried an
 * emoji in an `icon` field, and OperationsPanel rendered it raw. That was the
 * same mistake `Icons.jsx` was originally written to undo for the nav bar:
 *
 *   · an emoji is a FONT glyph, so it is a different picture on iOS, Android,
 *     Windows and Linux — the grid never looks like one designed set
 *   · it cannot take `currentColor`, so it stays fully saturated when the card
 *     is disabled and the text beside it has gone grey. A bright icon on dead
 *     text reads as a rendering fault
 *   · it has its own baseline and advance width, so 80 of them in a grid do
 *     not line up with each other or with their labels
 *   · several used here (⚔️ 🕵️ 🥧 🧾 🛰️) have no glyph in the default Android
 *     emoji font and render as a box
 *
 * ─── WHY A MAP AND NOT AN EDIT TO opsCatalog.js ────────────────────────────
 * opsCatalog.js is imported by Node probes that have no JSX pipeline. Putting
 * React components in it would break every one of them. The catalog keeps its
 * `icon` string as a stable data key; this file — which only the UI imports —
 * turns that key into a component.
 *
 * The emoji field is therefore still the fallback: an unmapped card renders
 * its emoji rather than nothing, so adding a card can never produce a hole in
 * the grid. `missingOpsIcons()` reports the gap for a probe to fail on.
 */

/* Shared with the nav — already in the app's icon set. */
import {
  IconMarket, IconSwap, IconWallet, IconShield, IconActivity, IconSmartMoney,
  IconTrend, IconGlobe, IconNews, IconBell, IconClock, IconTrophy, IconGift,
  IconCoins, IconCash, IconBank, IconCard, IconSearch, IconDoc, IconLock,
  IconPlus, IconArrowDown, IconCheck, IconSparkle, IconKey, IconBriefcase
} from './Icons.jsx';
/* Ops-only, kept out of the first-paint chunk — see OpsIconSet.jsx. */
import {
  IconBridge, IconLeaf, IconDroplet, IconBolt, IconTarget, IconScale, IconPie,
  IconEye, IconBars, IconWhale, IconRobot, IconCalendar, IconArrowUp,
  IconMinus, IconRepeat, IconStar, IconUsers, IconRadar, IconSwords,
  IconLayers, IconReceipt, IconChip, IconCrystal, IconCalculator, IconMedal
} from './OpsIconSet.jsx';

/** Category id → icon component. */
export const CATEGORY_ICONS = Object.freeze({
  portfolio: IconPie,
  wallet: IconWallet,
  swap: IconSwap,
  bridge: IconBridge,
  lending: IconBank,
  farm: IconLeaf,
  liquidity: IconDroplet,
  futures: IconBolt,
  dydx: IconSwords,
  markets: IconGlobe,
  intelligence: IconRadar,
  goals: IconTarget,
  automation: IconClock,
  monitoring: IconEye,
  rewards: IconTrophy
});

/**
 * Card id → icon component.
 *
 * Mapped per card rather than per category on purpose: within one category the
 * icon is the only thing distinguishing "Deposit" from "Withdraw" at a glance,
 * so a shared category icon would make the grid harder to scan, not easier.
 */
export const CARD_ICONS = Object.freeze({
  /* Portfolio */
  portfolio_analysis: IconBars,
  portfolio_rebalance: IconScale,
  portfolio_risk: IconShield,
  portfolio_allocation: IconPie,

  /* Wallet */
  wallet_analysis: IconSearch,
  wallet_balances: IconCard,
  wallet_transactions: IconReceipt,
  wallet_evm: IconLayers,
  wallet_solana: IconChip,

  /* Swap */
  swap_token: IconSwap,
  swap_crosschain: IconRepeat,
  swap_quote: IconCash,
  swap_execute: IconCheck,

  /* Bridge */
  bridge_run: IconBridge,
  bridge_crosschain: IconRepeat,
  bridge_quote: IconCash,
  bridge_execute: IconCheck,

  /* Lending */
  lending_lend: IconBank,
  lending_borrow: IconCoins,
  lending_repay: IconArrowUp,
  lending_withdraw: IconArrowDown,
  lending_analysis: IconTrend,

  /* Farm */
  farm_analysis: IconBars,
  farm_recommend: IconTarget,
  farm_deposit: IconArrowDown,
  farm_withdraw: IconArrowUp,
  farm_claim: IconGift,
  farm_compound: IconRepeat,

  /* Liquidity */
  lp_analysis: IconDroplet,
  lp_add: IconPlus,
  lp_remove: IconMinus,
  lp_stake: IconLock,
  lp_unstake: IconKey,

  /* Futures */
  futures_analysis: IconBars,
  futures_position: IconTarget,
  futures_open: IconPlus,
  futures_close: IconMinus,
  futures_reduce: IconArrowDown,
  futures_risk: IconShield,

  /* dYdX */
  dydx_market: IconMarket,
  dydx_position: IconTarget,
  dydx_open: IconPlus,
  dydx_close: IconMinus,
  dydx_risk: IconShield,

  /* Global markets */
  markets_stocks: IconTrend,
  markets_etf: IconLayers,
  markets_funds: IconBriefcase,
  markets_forex: IconCash,
  markets_commodities: IconCoins,
  markets_rwa: IconBank,
  markets_tokenized: IconChip,

  /* Intelligence */
  intel_marketscan: IconRadar,
  intel_smartmoney: IconSmartMoney,
  intel_whales: IconWhale,
  intel_signals: IconActivity,
  intel_news: IconNews,
  intel_events: IconCalendar,
  intel_token: IconSearch,
  intel_contract: IconDoc,

  /* Goals */
  goals_create: IconTarget,
  goals_profit: IconTrend,
  goals_forecast: IconCrystal,
  goals_whatif: IconCalculator,
  goals_progress: IconBars,
  goals_rebalance: IconScale,

  /* Automation */
  auto_watchmarket: IconEye,
  auto_pricealert: IconBell,
  auto_condition: IconRadar,
  auto_strategy: IconRobot,
  auto_scheduled: IconCalendar,
  auto_recurring: IconRepeat,
  auto_conditional: IconTarget,

  /* Monitoring */
  monitor_list: IconEye,
  monitor_opportunity: IconSparkle,
  monitor_portfolio: IconBars,

  /* Rewards */
  rewards_dashboard: IconTrophy,
  rewards_missions: IconMedal,
  rewards_points: IconStar,
  rewards_referral: IconUsers
});

/**
 * Render a card's icon.
 *
 * Falls back to the catalog emoji rather than to nothing: a new card with no
 * mapping shows something recognisable instead of a blank square, and the
 * probe below is what actually flags it.
 */
export function OpsCardIcon({ card, size = 20, ...rest }) {
  const Icon = CARD_ICONS[card?.id];
  if (!Icon) return <span aria-hidden="true">{card?.icon || '•'}</span>;
  return <Icon width={size} height={size} aria-hidden="true" focusable="false" {...rest} />;
}

export function OpsCategoryIcon({ category, size = 16, ...rest }) {
  const Icon = CATEGORY_ICONS[category?.id];
  if (!Icon) return <span aria-hidden="true">{category?.icon || '•'}</span>;
  return <Icon width={size} height={size} aria-hidden="true" focusable="false" {...rest} />;
}

/** Ids with no mapped icon — for a probe to fail on when a card is added. */
export function missingOpsIcons({ cards = [], categories = [] } = {}) {
  return {
    cards: cards.filter((c) => !CARD_ICONS[c.id]).map((c) => c.id),
    categories: categories.filter((c) => !CATEGORY_ICONS[c.id]).map((c) => c.id)
  };
}
