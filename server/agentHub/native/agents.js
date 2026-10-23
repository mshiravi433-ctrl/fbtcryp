/**
 * FBT NATIVE AGENTS — eleven first-party crypto analysts.
 * ---------------------------------------------------------------------------
 * These are not wrappers around a model and they are not a chat persona. Each
 * one is a small, auditable computation over data this app already serves:
 *
 *   AI Trading Analyst          price, trend, momentum, volatility, levels
 *   Smart Money Tracker         observed large transfers + per-token flow
 *   Token Research Agent        market identity + protocol fundamentals
 *   Strategy Backtesting Agent  a real SMA/DCA backtest with costs
 *   Yield Optimizer             DefiLlama yields, safety-filtered upstream
 *   Liquidity Pool Analyzer     APY quality, turnover, IL and exit depth
 *   Lending Risk Agent          lending supply rates + protocol incident facts
 *   Cross-chain Swap Assistant  a read-only LI.FI route ESTIMATE
 *   Token Risk Scanner          GoPlus contract flags + DEX liquidity/holders
 *   Wallet Exposure Auditor     a wallet's priced holdings and observed risk
 *   Protocol Security Brief     TVL, audits, age and incident history
 *
 * WHAT EVERY AGENT DOES WHEN IT CANNOT ANSWER
 * It says which input or which source was missing. It never fills a gap with a
 * plausible number, never turns an empty list into "no risk", and never claims
 * a recommendation. The disclaimer is part of the result, not a tooltip.
 *
 * NOTHING HERE HAS EXECUTION AUTHORITY. There is no import of a signer, a swap
 * builder or a payment path; the backtest is arithmetic and the bridge agent
 * reads a quote without ever asking LI.FI to build a transaction.
 */

import {
  CHAINS,
  CHAIN_LABELS,
  GOPLUS_CHAINS,
  extractRequest,
  isEvmAddress,
  isSolanaAddress,
  resolveCoin,
  withDeadline
} from './data.js';

export const NATIVE_AGENT_SCHEMA = 'fbt.agent-hub.native-agent.v1';

/* ────────────────────────────── formatting ─────────────────────────────── */

const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);
const pct = (v, digits = 1) => (isFiniteNum(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%` : '—');
const usd = (v) => {
  if (!isFiniteNum(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  if (abs >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(6)}`;
};
const num = (v, digits = 2) => (isFiniteNum(v) ? v.toFixed(digits) : '—');
const int = (v) => (isFiniteNum(v) ? Math.round(v).toLocaleString('en-US') : '—');
const days = (ms) => (isFiniteNum(ms) ? `${Math.max(0, Math.round(ms / 86_400_000))}d` : '—');
const clock = (at) => new Date(at || Date.now()).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
const yesNo = (v) => (v === true ? 'YES' : v === false ? 'NO' : 'UNKNOWN');
const mentions = (text, needle) => {
  const n = String(needle || '').trim().toLowerCase();
  if (n.length < 3) return false;
  return new RegExp(`(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`, 'i').test(String(text || ''));
};
const projectBase = (project) => String(project || '').split('-')[0].toLowerCase();
const sourceLine = (pairs, fa) => pairs
  .map(([name, status]) => `${name}: ${status}`)
  .join(' · ') + (fa ? ' — فقط مقادیری که خوانده شدند گزارش شده‌اند.' : ' — only values that were actually read are reported.');

export function hasPersian(text) {
  return /[\u0600-\u06FF]/.test(String(text || ''));
}

/* ─────────────────────────────── statistics ────────────────────────────── */

export function closesFromCandles(candles) {
  return (Array.isArray(candles) ? candles : [])
    .map((c) => Number(c?.c ?? c?.p))
    .filter((v) => Number.isFinite(v) && v > 0);
}

export function sma(values, period) {
  const n = Math.max(1, Number(period) || 1);
  return values.map((_, i) => (i + 1 < n ? null : values.slice(i + 1 - n, i + 1).reduce((a, b) => a + b, 0) / n));
}

export function rsi(values, period = 14) {
  if (!Array.isArray(values) || values.length <= period) return null;
  let gain = 0;
  let loss = 0;
  for (let i = values.length - period; i < values.length; i += 1) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  if (loss === 0) return gain === 0 ? 50 : 100;
  const rs = (gain / period) / (loss / period);
  return 100 - 100 / (1 + rs);
}

export function maxDrawdown(values) {
  let peak = -Infinity;
  let worst = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    const dd = peak > 0 ? (v / peak - 1) * 100 : 0;
    if (dd < worst) worst = dd;
  }
  return worst;
}

/** Annualised volatility of daily closes, in percent. */
export function volatility(values) {
  if (!Array.isArray(values) || values.length < 8) return null;
  const rets = [];
  for (let i = 1; i < values.length; i += 1) rets.push(values[i] / values[i - 1] - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(365) * 100;
}

/** Change between the last close and the close `n` bars back, in percent. */
function changeOver(values, n) {
  if (!Array.isArray(values) || values.length < Math.max(2, n + 1)) return null;
  const last = values[values.length - 1];
  const then = values[values.length - 1 - n];
  return then > 0 ? (last / then - 1) * 100 : null;
}

/**
 * Long/flat SMA-cross backtest on daily closes.
 *
 * The signal is read on close `i` and applied to the return of `i → i+1`; this
 * is what prevents the classic look-ahead bug that makes every public backtest
 * look profitable. A round trip pays `feeBps` on both sides. No slippage, no
 * borrow cost, no funding — those are named in the output instead of modelled
 * with invented parameters.
 */
export function backtestSma(closes, { fast = 20, slow = 50, feeBps = 10 } = {}) {
  const values = Array.isArray(closes) ? closes : [];
  if (values.length < slow + 10) return { ok: false, code: 'NOT_ENOUGH_HISTORY', bars: values.length };
  const fastAvg = sma(values, fast);
  const slowAvg = sma(values, slow);
  const fee = Math.max(0, Number(feeBps) || 0) / 10_000;

  let equity = 1;
  let buyHold = 1;
  let position = 0;
  let trades = 0;
  const tradeReturns = [];
  let entry = null;
  const rets = [];

  for (let i = slow; i < values.length - 1; i += 1) {
    const want = fastAvg[i] != null && slowAvg[i] != null && fastAvg[i] > slowAvg[i] ? 1 : 0;
    const dayReturn = values[i + 1] / values[i] - 1;
    buyHold *= 1 + dayReturn;
    if (want !== position) {
      if (want === 1) {
        entry = values[i];
        equity *= 1 - fee;
      } else if (entry != null) {
        equity *= 1 - fee;
        tradeReturns.push(values[i] / entry - 1 - fee);
        trades += 1;
        entry = null;
      }
      position = want;
    }
    const strategyReturn = position === 1 ? dayReturn : 0;
    equity *= 1 + strategyReturn;
    rets.push(strategyReturn);
  }
  if (position === 1 && entry != null) {
    const last = values[values.length - 1];
    equity *= 1 - fee;
    tradeReturns.push(last / entry - 1 - fee);
    trades += 1;
  }

  const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
  const variance = rets.length > 1 ? rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1) : 0;
  const sharpe = variance > 0 ? (mean / Math.sqrt(variance)) * Math.sqrt(365) : null;
  const wins = tradeReturns.filter((r) => r > 0).length;

  let curve = 1;
  const equityCurve = [1];
  for (const r of rets) {
    curve *= 1 + r;
    equityCurve.push(curve);
  }

  return {
    ok: true,
    bars: values.length,
    fast,
    slow,
    feeBps,
    strategyReturnPct: (equity - 1) * 100,
    buyHoldReturnPct: (buyHold - 1) * 100,
    maxDrawdownPct: maxDrawdown(equityCurve),
    trades,
    winRatePct: trades ? (wins / tradeReturns.length) * 100 : null,
    exposurePct: rets.length ? (rets.filter((r) => r !== 0).length / rets.length) * 100 : null,
    sharpe: Number.isFinite(sharpe) ? sharpe : null
  };
}

/** Weekly equal-buy DCA against the same closing series. */
export function backtestDca(closes, { everyBars = 7, feeBps = 10 } = {}) {
  const values = Array.isArray(closes) ? closes : [];
  if (values.length < 30) return { ok: false, code: 'NOT_ENOUGH_HISTORY', bars: values.length };
  const every = Math.max(1, Number(everyBars) || 7);
  const fee = Math.max(0, Number(feeBps) || 0) / 10_000;
  let invested = 0;
  let units = 0;
  let buys = 0;
  for (let i = 0; i < values.length; i += every) {
    invested += 1;
    buys += 1;
    units += (1 * (1 - fee)) / values[i];
  }
  const last = values[values.length - 1];
  const value = units * last;
  return {
    ok: true,
    bars: values.length,
    everyBars: every,
    feeBps,
    buys,
    invested,
    value,
    returnPct: invested ? (value / invested - 1) * 100 : null,
    averageCost: units ? invested / units : null,
    lastPrice: last
  };
}

/* ─────────────────────────────── helpers ───────────────────────────────── */

const disclaimer = (fa) => (fa
  ? 'این خروجی تحلیل داده است، نه توصیهٔ سرمایه‌گذاری و نه دستور معامله. FBT هیچ تراکنشی نمی‌سازد، امضا نمی‌کند یا وجهی جابه‌جا نمی‌کند.'
  : 'This is a data analysis — not investment advice and not an order. FBT builds nothing, broadcasts nothing and cannot move funds.');

const footer = (fa, sources, at) => [
  `## ${fa ? 'داده و زمان' : 'Data and time'}`,
  `- ${sourceLine(sources, fa)}`,
  `- ${fa ? 'زمان خوانش: ' : 'Read at '}${clock(at)}`,
  '',
  disclaimer(fa)
].join('\n');

function needInput(fa, { title, need, examples }) {
  return {
    title,
    text: [
      `## ${fa ? 'ورودی لازم است' : 'An input is needed'}`,
      need,
      '',
      `## ${fa ? 'نمونهٔ درخواست' : 'Example requests'}`,
      ...examples.map((e) => `- ${e}`),
      '',
      disclaimer(fa)
    ].join('\n'),
    citations: [],
    dataStatus: 'awaiting_input'
  };
}

function csv(values) {
  return values.map((v) => String(v).replace(/[,|]/g, ' ')).join(' | ');
}

/* ────────────────────────────────── agents ─────────────────────────────── */

const aiTradingAnalyst = {
  slug: 'ai-trading-analyst',
  name: 'AI Trading Analyst',
  nameFa: 'تحلیل‌گر معامله',
  summary: 'Reads trend, momentum, volatility and support/resistance from live candles. Describes the market, never places an order.',
  summaryFa: 'روند، مومنتوم، نوسان و سطوح حمایت/مقاومت را از کندل‌های واقعی می‌خواند؛ بازار را توصیف می‌کند و هیچ سفارشی نمی‌گذارد.',
  category: 'trading',
  capabilities: ['price-action', 'trend', 'momentum', 'volatility', 'levels'],
  dataSources: ['CoinGecko'],
  examples: ['Analyse ETH on the daily timeframe', 'BTC trend and volatility'],
  examplesFa: ['ETH را در تایم‌فریم روزانه تحلیل کن', 'روند و نوسان BTC'],
  inputHint: null,
  inputHintFa: null,
  dataSources: ['CoinGecko'],
  async run({ request, data, fa, at }) {
    const resolved = await resolveCoin(data, request);
    if (!resolved.ok) {
      return needInput(fa, {
        title: this.name,
        need: fa
          ? 'نماد یا شناسهٔ کوین را بنویسید تا قیمت و تاریخچهٔ واقعی خوانده شود (مثلاً «ETH» یا «bitcoin»).'
          : 'Name a coin symbol or id so the agent can read real prices and history (e.g. “ETH” or “bitcoin”).',
        examples: fa ? this.examplesFa : this.examples
      });
    }
    const coin = resolved.coin;
    const [detail, candles] = await Promise.all([
      withDeadline(data.coinDetail(coin.id)),
      withDeadline(data.candles(coin.id, 180))
    ]);
    const closes = candles.ok ? closesFromCandles(candles.value) : [];
    if (!detail.ok && !closes.length) {
      return {
        title: this.name,
        text: [
          `## ${fa ? 'داده‌ای خوانده نشد' : 'No data was read'}`,
          fa ? 'هر دو منبع قیمت و کندل پاسخ ندادند. عددی ساخته نمی‌شود.' : 'Both the price and candle reads failed. No number is invented.',
          '',
          footer(fa, [['CoinGecko', 'unavailable']], at)
        ].join('\n'),
        citations: [],
        dataStatus: 'unavailable'
      };
    }
    const d = detail.ok ? detail.value || {} : {};
    const last = closes[closes.length - 1] ?? (isFiniteNum(d.price) ? d.price : null);
    const f20 = sma(closes, 20);
    const f50 = sma(closes, 50);
    const r = rsi(closes, 14);
    const vol = volatility(closes.slice(-60));
    const dd = maxDrawdown(closes.slice(-90));
    const win = closes.slice(-30);
    const high30 = win.length ? Math.max(...win) : null;
    const low30 = win.length ? Math.min(...win) : null;
    const trend = (() => {
      if (closes.length < 60 || f20.at(-1) == null || f50.at(-1) == null) return 'UNKNOWN';
      if (last > f50.at(-1) && f20.at(-1) > f50.at(-1)) return fa ? 'صعودی' : 'UPTREND';
      if (last < f50.at(-1) && f20.at(-1) < f50.at(-1)) return fa ? 'نزولی' : 'DOWNTREND';
      return fa ? 'خنثی / بدون روند' : 'RANGE';
    })();
    const momentum = r == null ? 'UNKNOWN' : r > 70 ? (fa ? 'اشباع خرید' : 'OVERBOUGHT') : r < 30 ? (fa ? 'اشباع فروش' : 'OVERSOLD') : (fa ? 'میانه' : 'NEUTRAL');

    const lines = [
      `# ${coin.symbol} · ${coin.name}`,
      '',
      `## ${fa ? 'تصویر لحظه‌ای' : 'Snapshot'}`,
      `- ${fa ? 'قیمت' : 'Price'}: ${usd(d.price ?? last)}`,
      `- ${fa ? 'تغییر ۲۴ ساعت' : '24h change'}: ${pct(d.change24h)}`,
      `- ${fa ? 'تغییر ۷ روز' : '7d change'}: ${pct(d.change7d)}`,
      `- ${fa ? 'ارزش بازار' : 'Market cap'}: ${usd(d.mcap)}`,
      `- ${fa ? 'حجم ۲۴ ساعت' : '24h volume'}: ${usd(d.volume)}`,
      `- ${fa ? 'رتبه' : 'Rank'}: ${d.rank ? `#${d.rank}` : '—'}`,
      '',
      `## ${fa ? 'روند و مومنتوم' : 'Trend and momentum'}`,
      `- ${fa ? 'روند (SMA20/SMA50 روزانه)' : 'Trend (daily SMA20/SMA50)'}: ${trend}`,
      `- SMA20: ${usd(f20.at(-1))} · SMA50: ${usd(f50.at(-1))}`,
      `- RSI14: ${num(r, 1)} (${momentum})`,
      `- ${fa ? 'بازدهی ۳۰ روز (از کندل‌ها)' : '30-day return (candles)'}: ${pct(changeOver(closes, 30))}`,
      `- ${fa ? 'بازدهی ۹۰ روز (از کندل‌ها)' : '90-day return (candles)'}: ${pct(changeOver(closes, 90))}`,
      '',
      `## ${fa ? 'نوسان و ریسک' : 'Volatility and risk'}`,
      `- ${fa ? 'نوسان سالانه‌شده (۶۰ کندل آخر)' : 'Annualised volatility (last 60 bars)'}: ${pct(vol)}`,
      `- ${fa ? 'بیشترین افت از سقف (۹۰ روز)' : 'Max drawdown (90 bars)'}: ${pct(dd)}`,
      `- ${fa ? 'فاصله از سقف تاریخی' : 'Below all-time high'}: ${pct(d.athChange)}`,
      '',
      `## ${fa ? 'سطوح قابل مشاهده' : 'Observable levels'}`,
      `- ${fa ? 'سقف/کف ۳۰ روز' : '30-bar high / low'}: ${usd(high30)} / ${usd(low30)}`,
      `- ${fa ? 'سقف/کف ۲۴ ساعت' : '24h high / low'}: ${usd(d.high24h)} / ${usd(d.low24h)}`,
      '',
      `## ${fa ? 'چطور این را بخوانیم' : 'How to read this'}`,
      fa
        ? '- روند از میانگین‌های متحرک روزانه می‌آید؛ در بازار رِنج، سیگنال‌های میانگین پرنویز هستند.\n- RSI بالا یعنی قیمت در ۱۴ کندل اخیر بیشتر صعود کرده است، نه این‌که «باید بفروشد».\n- نوسان بالا یعنی اندازهٔ حرکت بزرگ است؛ دربارهٔ جهت چیزی نمی‌گوید.'
        : '- Trend comes from daily moving averages; in a range those averages are noisy.\n- A high RSI means the price rose over the last 14 bars, not that it “must fall”.\n- High volatility describes the size of moves, not their direction.',
      '',
      footer(fa, [
        ['CoinGecko', detail.ok ? 'live' : 'unavailable'],
        ['Candles', candles.ok && closes.length ? `${closes.length} bars` : 'unavailable']
      ], at)
    ];
    return {
      title: `${coin.symbol} · ${this.name}`,
      text: lines.join('\n'),
      citations: [`https://www.coingecko.com/en/coins/${coin.id}`],
      dataStatus: detail.ok && closes.length ? 'live' : 'partial'
    };
  }
};

const smartMoneyTracker = {
  slug: 'smart-money-tracker',
  name: 'Smart Money Tracker',
  nameFa: 'ردیاب پول هوشمند',
  summary: 'Observed large-transfer flow, per-token accumulation and holder concentration — measured, not narrated.',
  summaryFa: 'جریان انتقال‌های بزرگ مشاهده‌شده، انباشت به تفکیک توکن و تمرکز هولدرها؛ اندازه‌گیری‌شده، نه روایت‌شده.',
  category: 'trading',
  capabilities: ['whale-flow', 'token-flow', 'holders', 'liquidity'],
  dataSources: ['DEX pairs', 'Holder ledger', 'Smart-money stream'],
  examples: ['Smart money flow for token 0x… on Base', 'Where is large-wallet flow going today?'],
  examplesFa: ['جریان پول هوشمند برای توکن 0x… روی Base', 'امروز جریان کیف‌پول‌های بزرگ کجاست؟'],
  async run({ request, data, fa, at }) {
    if (request.address) {
      const chainId = request.chainId && request.chainId !== 'solana' ? Number(request.chainId) : (request.solanaAddress ? 'solana' : 1);
      const intel = await withDeadline(data.tokenIntel(request.address, chainId));
      if (!intel.ok || !intel.value) {
        return {
          title: this.name,
          text: [
            `## ${fa ? 'داده‌ای خوانده نشد' : 'No data was read'}`,
            fa ? 'منبع دادهٔ آن‌چین برای این توکن پاسخ نداد. عددی ساخته نمی‌شود.' : 'The on-chain source did not answer for this token. No number is invented.',
            '',
            footer(fa, [['DEX / holders', intel.code || 'unavailable']], at)
          ].join('\n'),
          citations: [], dataStatus: 'unavailable'
        };
      }
      const v = intel.value;
      const holders = v.holders || {};
      const lines = [
        `# ${v.symbol || 'Token'} ${fa ? 'روی' : 'on'} ${CHAIN_LABELS[chainId] || chainId}`,
        '',
        `## ${fa ? 'بازار و جریان' : 'Market and flow'}`,
        `- ${fa ? 'قیمت' : 'Price'}: ${usd(v.priceUsd)}`,
        `- ${fa ? 'نقدینگی' : 'Liquidity'}: ${usd(v.liquidityUsd)}`,
        `- ${fa ? 'حجم ۲۴ ساعت' : '24h volume'}: ${usd(v.volume?.h24)}`,
        `- ${fa ? 'خرید / فروش ۲۴ ساعت' : 'Buys / sells 24h'}: ${int(v.txns?.buys24)} / ${int(v.txns?.sells24)}`,
        `- ${fa ? 'جریان خالص برآوردی' : 'Estimated net flow'}: ${usd(v.netFlowUsd)}`,
        `- ${fa ? 'سن بازار' : 'Market age'}: ${days(v.ageMs)}`,
        '',
        `## ${fa ? 'تمرکز و هولدرها' : 'Concentration and holders'}`,
        `- ${fa ? 'تعداد هولدر' : 'Holders'}: ${int(holders.total)}`,
        `- Top-10: ${holders.top10Share != null ? `${num(holders.top10Share, 1)}%` : '—'} (${holders.whaleConcentration || 'UNKNOWN'})`,
        `- ${fa ? 'سهم صرافی‌ها' : 'Exchange-held share'}: ${holders.exchangeSupplyPct != null ? `${num(holders.exchangeSupplyPct, 1)}%` : '—'}`,
        `- ${fa ? 'سیگنال انباشت' : 'Accumulation signal'}: ${v.accumulation?.detected ? `${v.accumulation.confidence}%` : '—'}`,
        `- ${fa ? 'سیگنال توزیع' : 'Distribution signal'}: ${v.distribution?.detected ? `${v.distribution.confidence}%` : '—'}`,
        `- ${fa ? 'ریسک نقدینگی/تمرکز' : 'Liquidity/concentration risk'}: ${v.risk || 'UNKNOWN'}`,
        '',
        `## ${fa ? 'محدودیت' : 'Limits'}`,
        fa
          ? '- این اعداد از انتقال‌های بزرگ مشاهده‌شده و دفتر هولدرها می‌آیند، نه از تاریخ کامل زنجیره. «مشاهده‌نشده» با «صفر» یکی نیست.\n- کیف‌پول‌های برچسب‌نخورده صرافی یا نهنگ حساب نمی‌شوند.'
          : '- These numbers come from observed large transfers and the holder ledger, not from full chain history. “Not observed” is not “zero”.\n- Unlabelled wallets are never counted as an exchange or a whale.',
        '',
        footer(fa, [['DEX pairs', v.dataStatus === 'live' ? 'live' : v.dataStatus || 'unavailable'], [fa ? 'هولدرها' : 'Holders', holders.dataStatus || 'unavailable']], at)
      ];
      return {
        title: `${v.symbol || 'Token'} · ${this.name}`,
        text: lines.join('\n'),
        citations: chainId === 'solana' ? [] : [`https://dexscreener.com/`],
        dataStatus: v.dataStatus || 'live'
      };
    }

    const overview = await withDeadline(data.smartMoneyOverview('24h'), { ms: 8_500 });
    if (!overview.ok || !overview.value) {
      return needInput(fa, {
        title: this.name,
        need: fa
          ? 'برای تحلیل دقیق، آدرس توکن را بدهید (مثلاً «0x… روی Base»). نمای کلی جریان هم در این لحظه خوانده نشد.'
          : 'For a precise read, give a token address (e.g. “0x… on Base”). The overall flow ledger did not answer either right now.',
        examples: fa ? this.examplesFa : this.examples
      });
    }
    const v = overview.value;
    const metrics = v.metrics || {};
    const activity = Array.isArray(v.tokenActivity) ? v.tokenActivity.slice(0, 6) : [];
    const lines = [
      `# ${fa ? 'جریان پول هوشمند · ۲۴ ساعت' : 'Smart money flow · 24h'}`,
      '',
      `- ${fa ? 'وضعیت داده' : 'Data status'}: ${v.dataStatus || 'unknown'}${v.partial ? (fa ? ' (جزئی)' : ' (partial)') : ''}`,
      `- ${fa ? 'رویدادهای در پنجره' : 'Events in window'}: ${int(v.coverage?.inWindow)} · ${fa ? 'پوشش' : 'coverage'} ${v.coverage?.windowCoverage != null ? `${Math.round(v.coverage.windowCoverage * 100)}%` : '—'}`,
      `- ${fa ? 'انباشت' : 'Accumulation'}: ${usd(metrics.accumulation?.valueUsd)} (${pct(metrics.accumulation?.changePct)})`,
      `- ${fa ? 'توزیع' : 'Distribution'}: ${usd(metrics.distribution?.valueUsd)} (${pct(metrics.distribution?.changePct)})`,
      `- ${fa ? 'خروج خالص از صرافی‌ها' : 'Net exchange flow'}: ${usd(metrics.netFlow?.valueUsd ?? metrics.netFlow)}`,
      '',
      `## ${fa ? 'توکن‌های با بیشترین جریان' : 'Tokens with the largest flow'}`
    ];
    if (!activity.length) {
      lines.push(fa ? '- در این پنجره جریان برچسب‌خوردهٔ قابل‌گزارشی ثبت نشده است.' : '- No labelled flow worth reporting was recorded in this window.');
    } else {
      for (const row of activity) {
        lines.push(`- ${row.symbol || row.name || '—'} (${row.chainShort || CHAIN_LABELS[row.chainId] || '—'}): ${row.signal} · ${fa ? 'خالص' : 'net'} ${usd(row.netUsd)} · ${fa ? 'رویداد' : 'events'} ${int(row.events)}`);
      }
    }
    lines.push(
      '',
      `## ${fa ? 'محدودیت' : 'Limits'}`,
      fa
        ? '- این موتور فقط آنچه را در زمان اجرای اسکنر مشاهده شده اندازه می‌گیرد؛ تاریخ کامل زنجیره نیست.\n- اگر پوشش پنجره کمتر از ۱۰۰٪ باشد، مقایسه‌ها با پنجرهٔ قبل نمایش داده نمی‌شوند.'
        : '- This engine measures what the scanner observed while it was running, not full chain history.\n- When window coverage is below 100%, period-over-period comparisons are withheld.',
      '',
      footer(fa, [['Smart-money stream', v.streamStatus || v.dataStatus || 'unavailable']], at)
    );
    return {
      title: this.name,
      text: lines.join('\n'),
      citations: [],
      dataStatus: v.dataStatus || 'partial'
    };
  }
};

const tokenResearchAgent = {
  slug: 'token-research-agent',
  name: 'Token Research Agent',
  nameFa: 'پژوهشگر توکن',
  summary: 'Builds a token brief from market identity, 90-day performance, protocol TVL and contract risk when an address is given.',
  summaryFa: 'خلاصهٔ یک توکن را از هویت بازار، عملکرد ۹۰ روز، TVL پروتکل و ریسک قرارداد (اگر آدرس داده شود) می‌سازد.',
  category: 'research',
  capabilities: ['fundamentals', 'market-data', 'protocol-tvl', 'contract-risk'],
  dataSources: ['CoinGecko', 'DefiLlama', 'GoPlus'],
  examples: ['Research UNI', 'Research 0x… on Arbitrum'],
  examplesFa: ['دربارهٔ UNI تحقیق کن', 'دربارهٔ 0x… روی Arbitrum تحقیق کن'],
  async run({ request, data, fa, at }) {
    const resolved = await resolveCoin(data, request);
    const [detail, candles, protocols] = await Promise.all([
      resolved.ok ? withDeadline(data.coinDetail(resolved.coin.id)) : Promise.resolve({ ok: false, code: 'COIN_NOT_RESOLVED' }),
      resolved.ok ? withDeadline(data.candles(resolved.coin.id, 90)) : Promise.resolve({ ok: false, code: 'COIN_NOT_RESOLVED' }),
      withDeadline(data.protocols(), { ms: 9_000 })
    ]);
    if (!resolved.ok) {
      return needInput(fa, {
        title: this.name,
        need: fa ? 'نماد، نام یا آدرس قرارداد توکن را بدهید تا دادهٔ واقعی خوانده شود.' : 'Give a token symbol, name or contract address so real data can be read.',
        examples: fa ? this.examplesFa : this.examples
      });
    }
    const coin = resolved.coin;
    const d = detail.ok ? detail.value || {} : {};
    const closes = candles.ok ? closesFromCandles(candles.value) : [];
    let protocol = null;
    if (protocols.ok && Array.isArray(protocols.value)) {
      const matches = protocols.value
        .filter((p) => String(p.symbol || '').toUpperCase() === coin.symbol || String(p.name || '').toLowerCase() === String(coin.name || '').toLowerCase())
        .sort((a, b) => (b.tvl || 0) - (a.tvl || 0));
      protocol = matches[0] || null;
    }
    let risk = null;
    if (request.evmAddress && GOPLUS_CHAINS.has(Number(request.chainId) || 1)) {
      const chainId = Number(request.chainId) || 1;
      const out = await withDeadline(data.tokenRisk(chainId, request.evmAddress));
      risk = out.ok ? out.value?.report || null : null;
    }
    const lines = [
      `# ${coin.symbol} · ${coin.name}`,
      '',
      `## ${fa ? 'هویت بازار' : 'Market identity'}`,
      `- ${fa ? 'قیمت' : 'Price'}: ${usd(d.price)}`,
      `- ${fa ? 'ارزش بازار' : 'Market cap'}: ${usd(d.mcap)}`,
      `- ${fa ? 'حجم ۲۴ ساعت' : '24h volume'}: ${usd(d.volume)}`,
      `- ${fa ? 'تغییر ۲۴ ساعت / ۷ روز' : '24h / 7d change'}: ${pct(d.change24h)} / ${pct(d.change7d)}`,
      `- ${fa ? 'رتبه' : 'Rank'}: ${d.rank ? `#${d.rank}` : '—'} · ${fa ? 'عرضهٔ در گردش' : 'Circulating supply'}: ${int(d.supply)}`,
      `- ${fa ? 'فاصله از ATH' : 'Below ATH'}: ${pct(d.athChange)}`,
      '',
      `## ${fa ? 'عملکرد ۹۰ روز (کندل‌ها)' : '90-day performance (candles)'}`,
      `- ${fa ? 'بازدهی' : 'Return'}: ${pct(changeOver(closes, 90))}`,
      `- ${fa ? 'بیشترین افت از سقف' : 'Max drawdown'}: ${pct(maxDrawdown(closes))}`,
      `- ${fa ? 'تعداد کندل' : 'Bars'}: ${closes.length || '—'}`,
      '',
      `## ${fa ? 'فاندامنتال پروتکل' : 'Protocol fundamentals'}`
    ];
    if (protocol) {
      lines.push(
        `- ${protocol.name} · ${protocol.category || '—'} · ${usd(protocol.tvl)} TVL`,
        `- ${fa ? 'تغییر TVL ۲۴ ساعت / ۷ روز' : 'TVL 1d / 7d change'}: ${pct(protocol.change_1d)} / ${pct(protocol.change_7d)}`,
        `- ${fa ? 'زنجیره‌ها' : 'Chains'}: ${(protocol.chains || []).slice(0, 6).join(', ') || '—'}`,
        `- ${fa ? 'بازبینی امنیتی ثبت‌شده' : 'Recorded audits'}: ${protocol.audits ? String(protocol.audits).slice(0, 120) : (fa ? 'ثبت نشده' : 'none recorded')}`
      );
    } else {
      lines.push(fa ? '- این توکن با هیچ پروتکل DefiLlama هم‌نامی قطعی نداشت؛ TVL ادعا نمی‌شود.' : '- No unambiguous DefiLlama protocol match; no TVL is claimed.');
    }
    if (risk) {
      lines.push(
        '',
        `## ${fa ? 'ریسک قرارداد (GoPlus)' : 'Contract risk (GoPlus)'}`,
        `- Honeypot: ${yesNo(risk.honeypot)} · ${fa ? 'قابل‌خرید/فروش' : 'Can buy/sell'}: ${yesNo(!risk.cannotBuy)} / ${yesNo(!risk.cannotSell)}`,
        `- ${fa ? 'مالیات خرید/فروش' : 'Buy/sell tax'}: ${num(risk.buyTax, 1)}% / ${num(risk.sellTax, 1)}%`,
        `- Mintable: ${yesNo(risk.mintable)} · Proxy: ${yesNo(risk.proxy)} · Blacklist: ${yesNo(risk.blacklist)}`,
        `- Top-10: ${risk.top10Share != null ? `${num(risk.top10Share * 100, 1)}%` : '—'}`
      );
    }
    lines.push(
      '',
      `## ${fa ? 'چیزی که این داده ندارد' : 'What this data does not contain'}`,
      fa
        ? '- جدول وستینگ/آنلاک، ترکیب تیم و کیفیت توکنومیک در این منابع نیست. آن‌ها را از مستندات رسمی پروژه بخوانید.'
        : '- Vesting/unlock schedules, team composition and tokenomics quality are not in these sources. Read them from the project’s own documentation.',
      '',
      footer(fa, [
        ['CoinGecko', detail.ok ? 'live' : 'unavailable'],
        ['DefiLlama', protocols.ok ? 'live' : 'unavailable'],
        ['GoPlus', risk ? 'live' : request.evmAddress ? 'unavailable' : 'not requested']
      ], at)
    );
    return {
      title: `${coin.symbol} · ${this.name}`,
      text: lines.join('\n'),
      citations: [
        `https://www.coingecko.com/en/coins/${coin.id}`,
        ...(protocol?.url ? [protocol.url] : [])
      ],
      dataStatus: detail.ok ? 'live' : 'partial'
    };
  }
};

const strategyBacktestingAgent = {
  slug: 'strategy-backtesting-agent',
  name: 'Strategy Backtesting Agent',
  nameFa: 'ایجنت بک‌تست استراتژی',
  summary: 'Runs a real SMA-crossover or weekly-DCA backtest on daily candles, with fees and honest assumptions.',
  summaryFa: 'یک بک‌تست واقعی کراس SMA یا DCA هفتگی را روی کندل‌های روزانه با کارمزد و فرض‌های شفاف اجرا می‌کند.',
  category: 'trading',
  capabilities: ['backtest', 'sma', 'dca', 'risk-metrics'],
  dataSources: ['CoinGecko daily candles'],
  examples: ['Backtest SMA 20/50 on BTC', 'DCA weekly on ETH for a year'],
  examplesFa: ['بک‌تست SMA 20/50 روی BTC', 'DCA هفتگی روی ETH برای یک سال'],
  async run({ request, data, fa, at }) {
    const resolved = await resolveCoin(data, request);
    if (!resolved.ok) {
      return needInput(fa, {
        title: this.name,
        need: fa ? 'نماد کوین را بدهید (و اگر می‌خواهید بنویسید «DCA» برای خرید دوره‌ای).' : 'Give a coin symbol (add “DCA” if you want a recurring-buy test).',
        examples: fa ? this.examplesFa : this.examples
      });
    }
    const coin = resolved.coin;
    const candles = await withDeadline(data.candles(coin.id, 365), { ms: 10_000 });
    const closes = candles.ok ? closesFromCandles(candles.value) : [];
    if (!candles.ok || closes.length < 70) {
      return {
        title: this.name,
        text: [
          `## ${fa ? 'تاریخچهٔ کافی خوانده نشد' : 'Not enough history was read'}`,
          fa ? `برای بک‌تست معتبر حداقل ۷۰ کندل روزانه لازم است؛ این بار ${closes.length} کندل رسید.` : `A valid backtest needs at least 70 daily bars; ${closes.length} arrived.`,
          '',
          footer(fa, [['Candles', candles.code || `${closes.length} bars`]], at)
        ].join('\n'),
        citations: [], dataStatus: 'unavailable'
      };
    }
    const wantDca = /\bdca\b|خرید\s*دوره|پس‌انداز\s*دوره|خرید\s*هفتگی/i.test(request.text);
    const lines = [
      `# ${coin.symbol} · ${this.name}`,
      '',
      `## ${fa ? 'فرض‌ها' : 'Assumptions'}`,
      `- ${fa ? 'داده' : 'Data'}: ${closes.length} ${fa ? 'کندل روزانه از CoinGecko' : 'daily candles from CoinGecko'}`,
      `- ${fa ? 'کارمزد' : 'Fee'}: 0.10% ${fa ? 'در هر سمت (رفت و برگشت ۰٫۲٪)' : 'per side (0.20% round trip)'}`,
      fa ? '- اسلیپیج، هزینهٔ استقراض و فاندینگ مدل نشده‌اند؛ سود وام‌گرفته یا اهرم در این آزمون نیست.' : '- Slippage, borrow cost and funding are not modelled; there is no leverage or borrowed capital here.',
      fa ? '- سیگنال در بستن هر کندل خوانده و روی بازدهٔ کندل بعد اعمال می‌شود (بدون نگاه به آینده).' : '- The signal is read at each close and applied to the next bar’s return (no look-ahead).',
      ''
    ];
    if (wantDca) {
      const dca = backtestDca(closes, { everyBars: 7, feeBps: 10 });
      lines.push(
        `## ${fa ? 'نتیجهٔ DCA هفتگی' : 'Weekly DCA result'}`,
        `- ${fa ? 'تعداد خرید' : 'Buys'}: ${dca.buys} · ${fa ? 'سرمایه' : 'Invested'}: ${num(dca.invested, 0)} × ${fa ? 'واحد' : 'unit'}`,
        `- ${fa ? 'میانگین بهای خرید' : 'Average cost'}: ${usd(dca.averageCost)}`,
        `- ${fa ? 'قیمت پایانی' : 'Last price'}: ${usd(dca.lastPrice)}`,
        `- ${fa ? 'بازدهی' : 'Return'}: ${pct(dca.returnPct)}`,
        '',
        `## ${fa ? 'مقایسه با خرید یک‌باره' : 'Against a single lump sum'}`,
        `- ${fa ? 'بازدهی خرید یک‌باره در همان بازه' : 'Lump-sum return over the same window'}: ${pct((closes.at(-1) / closes[0] - 1) * 100)}`
      );
    } else {
      const bt = backtestSma(closes, { fast: 20, slow: 50, feeBps: 10 });
      if (!bt.ok) {
        lines.push(`## ${fa ? 'داده کافی نبود' : 'Not enough data'}`, `- ${bt.bars} ${fa ? 'کندل' : 'bars'}`);
      } else {
        lines.push(
          `## ${fa ? 'نتیجهٔ کراس SMA 20/50' : 'SMA 20/50 result'}`,
          `- ${fa ? 'بازدهی استراتژی' : 'Strategy return'}: ${pct(bt.strategyReturnPct, 2)}`,
          `- ${fa ? 'بازدهی خرید و نگه‌داری' : 'Buy-and-hold return'}: ${pct(bt.buyHoldReturnPct, 2)}`,
          `- ${fa ? 'بیشترین افت' : 'Max drawdown'}: ${pct(bt.maxDrawdownPct, 2)}`,
          `- ${fa ? 'تعداد معامله (رفت و برگشت)' : 'Trades (round trips)'}: ${bt.trades} · ${fa ? 'نرخ برد' : 'Win rate'}: ${isFiniteNum(bt.winRatePct) ? `${num(bt.winRatePct, 1)}%` : '—'}`,
          `- ${fa ? 'زمان حضور در بازار' : 'Time in market'}: ${isFiniteNum(bt.exposurePct) ? `${num(bt.exposurePct, 1)}%` : '—'} · Sharpe ${num(bt.sharpe, 2)}`
        );
      }
    }
    lines.push(
      '',
      `## ${fa ? 'این بک‌تست چه چیزی را ثابت نمی‌کند' : 'What this backtest does not prove'}`,
      fa
        ? '- عملکرد گذشته تضمین آینده نیست و یک پارامتر خوب روی یک دارایی، روی دارایی دیگر معمولاً خوب نیست.\n- نتیجه به بازهٔ داده حساس است؛ تغییر ۲۰/۵۰ به ۱۰/۳۰ می‌تواند نتیجه را کامل عوض کند.\n- هزینه‌های واقعی (اسلیپیج در بازار کم‌عمق، مالیات، کارمزد شبکه) بیشتر از ۰٫۱٪ هستند.'
        : '- Past performance does not guarantee future results, and a parameter that worked on one asset usually does not transfer.\n- Results are sensitive to the window; 10/30 instead of 20/50 can change the answer completely.\n- Real costs (slippage in thin markets, tax, network fees) are larger than 0.1%.',
      '',
      footer(fa, [['CoinGecko candles', 'live']], at)
    );
    return {
      title: `${coin.symbol} · ${this.name}`,
      text: lines.join('\n'),
      citations: [`https://www.coingecko.com/en/coins/${coin.id}`],
      dataStatus: 'live'
    };
  }
};

const yieldOptimizer = {
  slug: 'yield-optimizer',
  name: 'Yield Optimizer',
  nameFa: 'بهینه‌ساز بازده',
  summary: 'Ranks safety-filtered DefiLlama pools by real yield quality — reward share, TVL and IL risk shown, not hidden.',
  summaryFa: 'استخرهای فیلترشدهٔ DefiLlama را بر اساس کیفیت بازده رتبه‌بندی می‌کند؛ سهم پاداش، TVL و ریسک IL پنهان نمی‌شود.',
  category: 'defi',
  capabilities: ['yield', 'apy', 'risk-band', 'stablecoin'],
  dataSources: ['DefiLlama yields'],
  examples: ['Best stablecoin yields on Arbitrum', 'USDC yield opportunities'],
  examplesFa: ['بهترین بازده استیبل‌کوین روی Arbitrum', 'فرصت‌های بازده USDC'],
  async run({ request, data, fa, at }) {
    const out = await withDeadline(data.yields(), { ms: 12_000 });
    if (!out.ok || !out.value) {
      return {
        title: this.name,
        text: [`## ${fa ? 'دادهٔ بازده خوانده نشد' : 'Yield data was not read'}`,
          fa ? 'منبع DefiLlama پاسخ نداد. هیچ APY‌ای حدس زده نمی‌شود.' : 'The DefiLlama source did not answer. No APY is guessed.',
          '', footer(fa, [['DefiLlama yields', out.code || 'unavailable']], at)].join('\n'),
        citations: [], dataStatus: 'unavailable'
      };
    }
    const pools = Array.isArray(out.value.pools) ? out.value.pools : [];
    const wantsStable = /stable|استیبل|usdc|usdt|dai/i.test(request.text);
    const chainLabel = request.chains.length ? CHAIN_LABELS[request.chains[0]] : null;
    let rows = pools.slice();
    if (chainLabel) rows = rows.filter((p) => String(p.chain || '').toLowerCase() === String(chainLabel).toLowerCase());
    if (wantsStable) rows = rows.filter((p) => p.stablecoin === true);
    const wantedProject = request.protocolQuery
      || pools.map((p) => projectBase(p.project)).find((base) => mentions(request.text, base))
      || null;
    if (wantedProject) rows = rows.filter((p) => String(p.project || '').toLowerCase().includes(String(wantedProject).toLowerCase()));
    rows = rows.slice(0, 6);
    const lines = [
      `# ${this.name}`,
      '',
      fa
        ? `این فهرست از ${int(out.value.considered)} استخر خام DefiLlama ساخته شد و ${int(out.value.passed)} استخر از فیلترهای ایمنی عبور کردند. رتبه‌بندی بر اساس بازدهٔ واقعی، اندازه و ریسک است، نه بالاترین عدد APY.`
        : `Built from ${int(out.value.considered)} raw DefiLlama pools; ${int(out.value.passed)} passed the safety filter. Ranking weighs real yield, size and risk — not the highest APY.`,
      ''
    ];
    if (!rows.length) {
      lines.push(fa ? '## چیزی با این فیلتر پیدا نشد\nاستخر واجدشرطی در مجموعهٔ فیلترشده نبود؛ عدد جایگزین ساخته نمی‌شود.' : '## Nothing matched these filters\nNo eligible pool in the filtered set; no substitute number is produced.');
    } else {
      lines.push(`## ${fa ? 'فرصت‌های برگزیده' : 'Selected opportunities'}`);
      for (const p of rows) {
        lines.push(
          `- **${p.symbol}** · ${p.project} · ${p.chain} — APY ${num(p.apy, 1)}% (${fa ? 'پایه' : 'base'} ${num(p.apyBase, 1)}% / ${fa ? 'پاداش' : 'reward'} ${num(p.apyReward, 1)}%)`,
          `  TVL ${usd(p.tvlUsd)} · ${fa ? 'میانگین ۳۰ روز' : '30d mean'} ${num(p.apyMean30d, 1)}% · ${fa ? 'ریسک' : 'risk'} ${p.risk}${p.ilRisk ? ` · IL ${fa ? 'دارد' : 'yes'}` : ''}`,
          `  ${p.url}`
        );
      }
    }
    lines.push(
      '',
      `## ${fa ? 'قبل از تصمیم' : 'Before deciding'}`,
      fa
        ? '- سهم پاداش را نادیده نگیرید: اگر بیشتر APY از توکن پاداش باشد، با کاهش برنامه یا قیمت آن، بازده می‌تواند سریع پایین بیاید.\n- TVL کم یعنی خروج از استخر می‌تواند روی قیمت اثر بگذارد.\n- «فیلتر ایمنی» یعنی پروتکل‌های بزرگ و قدیمی و استخرهای با TVL حداقلی؛ ضمانت نیست. Aave و Curve هم حادثه داشته‌اند.'
        : '- Do not ignore the reward share: when most of the APY is paid in a reward token, a programme or price change can remove it quickly.\n- Low TVL means an exit can move the price.\n- The safety filter means large, old protocols and a minimum TVL; it is not a guarantee. Aave and Curve have both had incidents.',
      '',
      footer(fa, [['DefiLlama yields', 'live']], at)
    );
    return {
      title: this.name,
      text: lines.join('\n'),
      citations: rows.slice(0, 3).map((p) => p.url),
      dataStatus: 'live'
    };
  }
};

const liquidityPoolAnalyzer = {
  slug: 'liquidity-pool-analyzer',
  name: 'Liquidity Pool Analyzer',
  nameFa: 'تحلیل‌گر استخر نقدینگی',
  summary: 'Examines pool depth, APY quality, turnover and impermanent-loss exposure for a pair you name.',
  summaryFa: 'عمق استخر، کیفیت APY، گردش حجم و ریسک ضرر موقت را برای جفت‌ارز موردنظر بررسی می‌کند.',
  category: 'defi',
  capabilities: ['liquidity', 'apy-quality', 'turnover', 'impermanent-loss'],
  dataSources: ['DefiLlama yields'],
  examples: ['Analyse the ETH/USDC pool', 'Deepest liquidity pools on Base'],
  examplesFa: ['استخر ETH/USDC را تحلیل کن', 'عمیق‌ترین استخرهای نقدینگی روی Base'],
  async run({ request, data, fa, at }) {
    const out = await withDeadline(data.yields(), { ms: 12_000 });
    if (!out.ok || !out.value) {
      return {
        title: this.name,
        text: [`## ${fa ? 'دادهٔ استخر خوانده نشد' : 'Pool data was not read'}`,
          fa ? 'منبع بازده پاسخ نداد؛ عددی ساخته نمی‌شود.' : 'The yield source did not answer; no number is invented.',
          '', footer(fa, [['DefiLlama yields', out.code || 'unavailable']], at)].join('\n'),
        citations: [], dataStatus: 'unavailable'
      };
    }
    const pools = Array.isArray(out.value.pools) ? out.value.pools : [];
    const chainLabel = request.chains.length ? CHAIN_LABELS[request.chains[0]] : null;
    let rows = pools.slice();
    if (chainLabel) rows = rows.filter((p) => String(p.chain || '').toLowerCase() === String(chainLabel).toLowerCase());
    if (request.pair) {
      const [a, b] = request.pair;
      rows = rows.filter((p) => {
        const s = String(p.symbol || '').toUpperCase();
        return s.includes(a.toUpperCase()) && s.includes(b.toUpperCase());
      });
    }
    const turnover = (p) => (p.tvlUsd > 0 && isFiniteNum(p.volumeUsd1d) ? p.volumeUsd1d / p.tvlUsd : null);
    rows = rows.filter((p) => isFiniteNum(p.tvlUsd) && p.tvlUsd > 0)
      .sort((a, b) => (turnover(b) ?? -1) - (turnover(a) ?? -1))
      .slice(0, 6);
    const lines = [`# ${this.name}`, ''];
    if (request.pair) {
      lines.push(fa ? `جست‌وجو برای جفت ${request.pair.join('/')}${chainLabel ? ` روی ${chainLabel}` : ''} در مجموعهٔ فیلترشده انجام شد.` : `Searched the filtered set for ${request.pair.join('/')}${chainLabel ? ` on ${chainLabel}` : ''}.`, '');
    }
    if (!rows.length) {
      lines.push(fa
        ? '## استخری پیدا نشد\nاین جفت در مجموعهٔ فیلترشدهٔ FBT نیست (استخرهای خارج از allow-list و TVL کم حذف شده‌اند). برای دیدن فهرست کلی، نام یک زنجیره یا توکن پایه را بدهید.'
        : '## No pool found\nThat pair is not in FBT’s filtered set (pools outside the allow-list and below the TVL floor are removed). Name a chain or a base token for the general list.');
    } else {
      for (const p of rows) {
        const t = turnover(p);
        lines.push(
          `## ${p.symbol} · ${p.project} · ${p.chain}`,
          `- TVL ${usd(p.tvlUsd)} · ${fa ? 'حجم ۲۴ ساعت' : '24h volume'} ${usd(p.volumeUsd1d)} · ${fa ? 'گردش' : 'turnover'} ${t != null ? `${num(t * 100, 0)}%` : '—'}`,
          `- APY ${num(p.apy, 1)}% (${num(p.apyBase, 1)}% ${fa ? 'پایه' : 'base'} + ${num(p.apyReward, 1)}% ${fa ? 'پاداش' : 'reward'}) · ${fa ? 'ریسک' : 'risk'} ${p.risk}`,
          `- ${fa ? 'ضرر موقت' : 'Impermanent loss'}: ${p.ilRisk ? (fa ? 'در معرض' : 'exposed') : (fa ? 'کم' : 'low')} · ${fa ? 'نوع مواجهه' : 'exposure'} ${p.exposure || '—'}`,
          `- ${p.url}`,
          ''
        );
      }
    }
    lines.push(
      `## ${fa ? 'نکتهٔ اجرایی' : 'Execution note'}`,
      fa
        ? '- گردش بالا یعنی کارمزد بیشتری تولید می‌شود، اما ورود و خروج پول زیاد هم می‌تواند نشانهٔ رفتار فرصت‌طلبانه باشد.\n- APY بالا با پاداش توکنی، در واقعیت به قیمت آن توکن وابسته است.'
        : '- High turnover means more fees, but also rapid money in and out that can be mercenary liquidity.\n- A high APY paid in a reward token is only worth that token’s price.',
      '',
      footer(fa, [['DefiLlama yields', 'live']], at)
    );
    return {
      title: this.name,
      text: lines.join('\n'),
      citations: rows.slice(0, 3).map((p) => p.url),
      dataStatus: 'live'
    };
  }
};

const lendingRiskAgent = {
  slug: 'lending-risk-agent',
  name: 'Lending Risk Agent',
  nameFa: 'ایجنت ریسک وام‌دهی',
  summary: 'Compares lending supply rates on allow-listed protocols and adds protocol TVL and incident facts.',
  summaryFa: 'نرخ تأمین مالی پروتکل‌های تأییدشده را مقایسه می‌کند و TVL و سابقهٔ حادثهٔ پروتکل را کنار آن می‌گذارد.',
  category: 'defi',
  capabilities: ['lending', 'supply-apy', 'protocol-risk', 'incidents'],
  dataSources: ['DefiLlama yields', 'DefiLlama hacks'],
  examples: ['Compare Aave and Compound USDC supply rates', 'Stablecoin lending on Base'],
  examplesFa: ['نرخ تأمین USDC در Aave و Compound را مقایسه کن', 'وام‌دهی استیبل‌کوین روی Base'],
  async run({ request, data, fa, at }) {
    const LENDING = new Set(['aave-v3', 'compound-v3', 'morpho-blue', 'venus-core-pool', 'spark', 'sparklend']);
    const [yieldsOut, incidentsOut] = await Promise.all([
      withDeadline(data.yields(), { ms: 12_000 }),
      withDeadline(data.incidents(), { ms: 9_000 })
    ]);
    if (!yieldsOut.ok || !yieldsOut.value) {
      return {
        title: this.name,
        text: [`## ${fa ? 'دادهٔ وام‌دهی خوانده نشد' : 'Lending data was not read'}`,
          fa ? 'منبع بازده پاسخ نداد؛ نرخی ساخته نمی‌شود.' : 'The yield source did not answer; no rate is invented.',
          '', footer(fa, [['DefiLlama yields', yieldsOut.code || 'unavailable']], at)].join('\n'),
        citations: [], dataStatus: 'unavailable'
      };
    }
    const pools = (yieldsOut.value.pools || []).filter((p) => LENDING.has(String(p.project || '')));
    const chainLabel = request.chains.length ? CHAIN_LABELS[request.chains[0]] : null;
    let rows = chainLabel ? pools.filter((p) => String(p.chain || '').toLowerCase() === String(chainLabel).toLowerCase()) : pools.slice();
    if (/stable|استیبل/i.test(request.text)) rows = rows.filter((p) => p.stablecoin === true);
    const wantedProject = request.protocolQuery
      || pools.map((p) => projectBase(p.project)).find((base) => mentions(request.text, base))
      || null;
    if (wantedProject) rows = rows.filter((p) => String(p.project || '').toLowerCase().includes(String(wantedProject).toLowerCase()));
    rows = rows.sort((a, b) => (b.apy || 0) - (a.apy || 0)).slice(0, 8);
    const incidents = incidentsOut.ok && Array.isArray(incidentsOut.value) ? incidentsOut.value : [];
    const lines = [
      `# ${this.name}`,
      '',
      fa
        ? 'نرخ‌های زیر APY تأمین (سپرده‌گذاری) از استخرهای وام‌دهی فیلترشده‌اند. نرخ استقراض و نرخ استفاده (utilization) در این فید نیست و ادعا نمی‌شود.'
        : 'Rates below are SUPPLY APYs from the filtered lending pools. Borrow rates and utilisation are not in this feed and are not claimed.',
      ''
    ];
    if (!rows.length) {
      lines.push(fa ? 'استخر وام‌دهی واجدشرطی با این فیلتر پیدا نشد.' : 'No eligible lending pool matched these filters.');
    } else {
      lines.push(`## ${fa ? 'نرخ تأمین' : 'Supply rates'}`);
      for (const p of rows) {
        const rewardShare = p.apy > 0 && p.apyReward != null ? (p.apyReward / p.apy) * 100 : null;
        lines.push(
          `- **${p.project} · ${p.symbol} · ${p.chain}** — APY ${num(p.apy, 2)}% (${fa ? 'پایه' : 'base'} ${num(p.apyBase, 2)}%${rewardShare != null ? `, ${fa ? 'سهم پاداش' : 'reward share'} ${num(rewardShare, 0)}%` : ''}) · TVL ${usd(p.tvlUsd)}`,
          `  ${p.url}`
        );
      }
    }
    if (wantedProject) {
      const q = String(wantedProject).toLowerCase();
      const matched = incidents.filter((i) => String(i.protocol || '').toLowerCase().includes(q)).slice(0, 5);
      lines.push('', `## ${fa ? 'سابقهٔ حادثه' : 'Incident history'}`);
      if (matched.length) {
        for (const i of matched) lines.push(`- ${i.dateLabel || '—'} · ${i.protocol} · ${usd(i.amountUsd)} · ${i.category || '—'}`);
      } else {
        lines.push(fa ? '- حادثه‌ای با این نام در فید ثبت نشده است؛ نبود رکورد یعنی «در این فید دیده نشده»، نه «امن است».' : '- No incident under that name is in the feed. Absence of a record means “not seen in this feed”, not “safe”.');
      }
    }
    lines.push(
      '',
      `## ${fa ? 'ریسک‌هایی که عدد ندارند' : 'Risks that have no number here'}`,
      fa
        ? '- نرخ استفادهٔ بالا و وثیقهٔ کم‌عمق می‌تواند باعث صف برداشت یا لیکوییدیشن شود؛ در داشبورد پروتکل بررسی کنید.\n- نرخ متغیر است و APY امروز تضمین فردا نیست.\n- سپرده‌گذاری، وام‌دهی و وثیقه‌گذاری می‌تواند کل اصل را از دست بدهد.'
        : '- High utilisation and thin collateral can cause withdrawal queues or liquidations; check the protocol dashboard.\n- Rates are variable; today’s APY is not tomorrow’s.\n- Supplying, borrowing and collateralising can lose the entire principal.',
      '',
      footer(fa, [
        ['DefiLlama yields', 'live'],
        ['DefiLlama hacks', incidentsOut.ok ? `${incidents.length} records` : 'unavailable']
      ], at)
    );
    return {
      title: this.name,
      text: lines.join('\n'),
      citations: rows.slice(0, 3).map((p) => p.url),
      dataStatus: 'live'
    };
  }
};

const crossChainSwapAssistant = {
  slug: 'cross-chain-swap-assistant',
  name: 'Cross-chain Swap Assistant',
  nameFa: 'دستیار سواپ بین‌زنجیره‌ای',
  summary: 'Returns a read-only LI.FI route estimate for moving an asset across chains: output, fees, duration and bridge used.',
  summaryFa: 'یک برآورد مسیر فقط‌خواندنی از LI.FI برای انتقال دارایی بین زنجیره‌ها می‌دهد: خروجی، کارمزد، زمان و پل استفاده‌شده.',
  category: 'defi',
  capabilities: ['bridge-estimate', 'route', 'fees', 'duration'],
  dataSources: ['LI.FI quote'],
  examples: ['Swap 100 USDC from Arbitrum to Base', 'Route 1 ETH from Ethereum to Arbitrum'],
  examplesFa: ['۱۰۰ USDC را از Arbitrum به Base سواپ کن', '۱ ETH را از Ethereum به Arbitrum مسیریابی کن'],
  async run({ request, data, fa, at }) {
    const fromChain = request.chains[0] || null;
    const toChain = request.chains[1] || null;
    const toMatch = request.text.match(/\bto\s+\$?([A-Za-z][A-Za-z0-9]{1,9})\b/i)?.[1] || null;
    /* A chain name after "to" is a destination chain, not a token. A token
       after "to" is the destination asset. When the sentence names only an
       amount and two chains, the same asset is assumed — and the output says
       so instead of silently choosing something else. */
    const explicitToToken = toMatch && !CHAINS[String(toMatch).toLowerCase()] && !/^(the|a|an)$/i.test(toMatch)
      ? String(toMatch).toUpperCase()
      : null;
    const outToken = explicitToToken || request.amountToken;
    if (!request.amount || !request.amountToken || !fromChain || !toChain) {
      return needInput(fa, {
        title: this.name,
        need: fa
          ? 'برای برآورد مسیر به مقدار، دارایی، زنجیرهٔ مبدأ و مقصد نیاز است — مثلاً «۱۰۰ USDC از Arbitrum به USDC روی Base». بدون مقدار، مسیر ساخته نمی‌شود.'
          : 'A route estimate needs an amount, an asset, a source chain and a destination chain — e.g. “100 USDC from Arbitrum to USDC on Base”. No amount means no route.',
        examples: fa ? this.examplesFa : this.examples
      });
    }
    if (String(fromChain) === String(toChain)) {
      return needInput(fa, {
        title: this.name,
        need: fa ? 'مبدأ و مقصد یکسان است؛ برای سواپ درون‌زنجیره‌ای از بخش Swap خود FBT استفاده کنید. این ایجنت مخصوص مسیر بین‌زنجیره‌ای است.' : 'Source and destination are the same chain. Use FBT’s own Swap for that; this agent is for cross-chain routes.',
        examples: fa ? this.examplesFa : this.examples
      });
    }
    const NATIVE_DECIMALS = { ETH: 18, BNB: 18, MATIC: 18, POL: 18, AVAX: 18, MNT: 18, SOL: 9, USDC: 6, USDT: 6, DAI: 18, WBTC: 8 };
    const fromDecimals = NATIVE_DECIMALS[request.amountToken] ?? 18;
    const atomic = BigInt(Math.round(request.amount * 10 ** fromDecimals)).toString();
    const quoted = await withDeadline(data.bridgeQuote({
      fromChain: String(fromChain),
      toChain: String(toChain),
      fromToken: request.amountToken,
      toToken: outToken,
      fromAmount: atomic,
      slippage: '0.005'
    }), { ms: 12_000 });
    if (!quoted.ok || !quoted.value?.ok) {
      const reason = quoted.value?.body?.message || quoted.value?.body?.error || quoted.code || 'UPSTREAM_FAILED';
      return {
        title: this.name,
        text: [
          `## ${fa ? 'مسیری برنگشت' : 'No route returned'}`,
          fa ? `LI.FI برای این جفت پاسخی نداد: ${String(reason).slice(0, 160)}` : `LI.FI returned no route for that pair: ${String(reason).slice(0, 160)}`,
          fa ? 'هیچ عدد جایگزینی ساخته نشد. زنجیره‌ها، توکن یا مقدار را تغییر دهید.' : 'No substitute number was produced. Try different chains, tokens or an amount.',
          '',
          footer(fa, [['LI.FI quote', 'unavailable']], at)
        ].join('\n'),
        citations: [], dataStatus: 'unavailable'
      };
    }
    const body = quoted.value.value || quoted.value.body || {};
    const est = body.estimate || {};
    const tokenInfo = await withDeadline(data.tokenInfo(toChain, outToken), { ms: 6_000 });
    const toDecimals = NATIVE_DECIMALS[outToken] ?? (Number(tokenInfo.ok ? tokenInfo.value?.decimals : NaN) || 18);
    const outAmount = Number(est.toAmount || 0) / 10 ** toDecimals;
    const fees = Array.isArray(est.feeCosts) ? est.feeCosts : [];
    const gas = Array.isArray(est.gasCosts) ? est.gasCosts : [];
    const feeUsd = fees.reduce((s, f) => s + (Number(f.amountUSD) || 0), 0) + gas.reduce((s, g) => s + (Number(g.amountUSD) || 0), 0);
    const lines = [
      `# ${this.name}`,
      '',
      `## ${fa ? 'مسیر برآوردشده' : 'Estimated route'}`,
      `- ${num(request.amount, 6)} ${request.amountToken} ${fa ? 'روی' : 'on'} ${CHAIN_LABELS[fromChain] || fromChain} → ${num(outAmount, 6)} ${outToken} ${fa ? 'روی' : 'on'} ${CHAIN_LABELS[toChain] || toChain}${explicitToToken ? '' : (fa ? ' (توکن مقصد ذکر نشده؛ همان دارایی مبدأ فرض شد)' : ' (destination token not stated; the source asset was assumed)')}`,
      `- ${fa ? 'ابزار مسیریابی' : 'Routing tool'}: ${est.tool || body.tool || '—'}`,
      `- ${fa ? 'حداقل دریافتی (با اسلیپیج ۰٫۵٪)' : 'Minimum received (0.5% slippage)'}: ${num(Number(est.toAmountMin || 0) / 10 ** toDecimals, 6)} ${outToken}`,
      `- ${fa ? 'زمان تقریبی' : 'Estimated duration'}: ${est.executionDuration != null ? `${Math.max(1, Math.round(Number(est.executionDuration) / 60))} min` : '—'}`,
      `- ${fa ? 'کارمزد + گس برآوردی' : 'Fees + gas estimate'}: ${usd(feeUsd)}`,
      `- ${fa ? 'ارزش ورودی/خروجی' : 'Input/output value'}: ${usd(est.fromAmountUSD)} → ${usd(est.toAmountUSD)}`,
      '',
      `## ${fa ? 'این چیست و چه چیزی نیست' : 'What this is and is not'}`,
      fa
        ? '- این یک «برآورد» از LI.FI است: نرخ و مسیر بین لحظهٔ خواندن و اجرا تغییر می‌کند.\n- هیچ تراکنشی ساخته، امضا یا ارسال نشد. FBT برای این برآورد آدرس کیف‌پول شما را نمی‌خواهد.\n- برای اجرا، مسیر را در بخش Bridge/Swap خود برنامه با کیف‌پول خودتان بررسی و تأیید کنید.'
        : '- This is an ESTIMATE from LI.FI: the rate and route move between this read and any execution.\n- No transaction was built, signed or sent. FBT did not ask for your wallet address for this estimate.\n- To execute, review and confirm the route in the app’s own Bridge/Swap with your wallet.',
      '',
      footer(fa, [['LI.FI quote', 'live']], at)
    ];
    return {
      title: this.name,
      text: lines.join('\n'),
      citations: ['https://li.fi/'],
      dataStatus: 'live'
    };
  }
};

const tokenRiskScanner = {
  slug: 'token-risk-scanner',
  name: 'Token Risk Scanner',
  nameFa: 'اسکنر ریسک توکن',
  summary: 'Checks honeypot, taxes, mintability, proxy, holder concentration and liquidity for a contract — with UNKNOWN kept as UNKNOWN.',
  summaryFa: 'هانی‌پات، مالیات، قابلیت ضرب، پروکسی، تمرکز هولدر و نقدینگی یک قرارداد را بررسی می‌کند — و «نامشخص» را نامشخص نگه می‌دارد.',
  category: 'security',
  capabilities: ['honeypot', 'taxes', 'ownership', 'liquidity', 'holders'],
  dataSources: ['GoPlus', 'DEX pairs'],
  examples: ['Scan 0x… on Base', 'Is this token a honeypot? 0x…'],
  examplesFa: ['قرارداد 0x… روی Base را اسکن کن', 'آیا این توکن هانی‌پات است؟ 0x…'],
  async run({ request, data, fa, at }) {
    if (!request.address) {
      return needInput(fa, {
        title: this.name,
        need: fa ? 'آدرس قرارداد توکن (EVM یا Solana) را بدهید؛ بدون آدرس، اسکنی انجام نمی‌شود.' : 'Give the token contract address (EVM or Solana); without one there is nothing to scan.',
        examples: fa ? this.examplesFa : this.examples
      });
    }
    const isSol = Boolean(request.solanaAddress);
    const chainId = isSol ? 'solana' : (Number(request.chainId) || 1);
    const [intelOut, riskOut] = await Promise.all([
      withDeadline(data.tokenIntel(request.address, chainId)),
      !isSol && GOPLUS_CHAINS.has(Number(chainId))
        ? withDeadline(data.tokenRisk(Number(chainId), request.address))
        : Promise.resolve({ ok: false, code: isSol ? 'GOPLUS_NO_SOLANA' : 'CHAIN_UNSUPPORTED' })
    ]);
    const intel = intelOut.ok ? intelOut.value : null;
    const report = riskOut.ok ? riskOut.value?.report || null : null;
    if (!intel && !report) {
      return {
        title: this.name,
        text: [
          `## ${fa ? 'هیچ داده‌ای خوانده نشد' : 'No data was read'}`,
          fa ? 'هم اسکنر قرارداد و هم منبع بازار پاسخ ندادند. «امن» یا «ناسالم» اعلام نمی‌شود.' : 'Neither the contract scanner nor the market source answered. Nothing is declared safe or unsafe.',
          '',
          footer(fa, [['GoPlus', 'unavailable'], ['DEX', 'unavailable']], at)
        ].join('\n'),
        citations: [], dataStatus: 'unavailable'
      };
    }
    const flags = [];
    /* `isBad` is the risk direction, so a TRUE here is always a flag and a
       FALSE is always a clean check. Passing truthiness instead of direction
       is what produced a green "open source" line labelled HIGH. */
    const add = (label, isBad) => {
      if (isBad === null || isBad === undefined) flags.push({ label, state: 'UNKNOWN' });
      else flags.push({ label, state: isBad ? 'HIGH' : 'LOW' });
    };
    if (report) {
      add(fa ? 'هانی‌پات' : 'Honeypot', report.honeypot);
      add(fa ? 'امکان فروش' : 'Can sell', report.cannotSell == null ? null : report.cannotSell);
      add(fa ? 'قابلیت ضرب' : 'Mintable', report.mintable);
      add(fa ? 'قابل توقف (Pausable)' : 'Pausable', report.pausable);
      add(fa ? 'لیست سیاه' : 'Blacklist', report.blacklist);
      add(fa ? 'قرارداد پروکسی' : 'Proxy contract', report.proxy);
      add(fa ? 'مالک پنهان' : 'Hidden owner', report.hiddenOwner);
      add(fa ? 'تغییر مالکیت' : 'Take-back ownership', report.ownerChangeBalance);
      add(fa ? 'سورس‌باز' : 'Open source', report.openSource == null ? null : !report.openSource);
      add(fa ? 'مالیات خرید > ۱۰٪' : 'Buy tax > 10%', report.buyTax == null ? null : report.buyTax > 10);
      add(fa ? 'مالیات فروش > ۱۰٪' : 'Sell tax > 10%', report.sellTax == null ? null : report.sellTax > 10);
      add(fa ? 'قفل نقدینگی' : 'LP locked', report.lpLocked == null ? null : !report.lpLocked);
    }
    const highs = flags.filter((f) => f.state === 'HIGH').length;
    const unknowns = flags.filter((f) => f.state === 'UNKNOWN').length;
    const lines = [
      `# ${fa ? 'اسکن ریسک' : 'Risk scan'} · ${intel?.symbol || request.address.slice(0, 10)}`,
      '',
      `## ${fa ? 'قرارداد' : 'Contract'}`,
      `- ${fa ? 'آدرس' : 'Address'}: ${request.address}`,
      `- ${fa ? 'زنجیره' : 'Chain'}: ${CHAIN_LABELS[chainId] || chainId}`,
      `- ${fa ? 'وضعیت' : 'Result'}: ${highs ? (fa ? `${highs} پرچم پرخطر` : `${highs} high-risk flag(s)`) : (fa ? 'پرچم پرخطرِ قطعی دیده نشد' : 'No confirmed high-risk flag seen')} · ${unknowns} ${fa ? 'نامشخص' : 'unknown'}`,
      ''
    ];
    if (report) {
      lines.push(
        `## ${fa ? 'پرچم‌های قرارداد (GoPlus)' : 'Contract flags (GoPlus)'}`,
        `- ${fa ? 'مالیات خرید/فروش' : 'Buy/sell tax'}: ${num(report.buyTax, 1)}% / ${num(report.sellTax, 1)}%`,
        `- Top-10 ${fa ? 'هولدر' : 'holders'}: ${report.top10Share != null ? `${num(report.top10Share * 100, 1)}%` : '—'} · ${fa ? 'تعداد هولدر' : 'holders'}: ${int(report.holderCount)}`,
        `- LP locked: ${yesNo(report.lpLocked)} · ${fa ? 'نقدینگی DEX' : 'DEX liquidity'}: ${usd(report.liquidityUsd)}`
      );
      for (const f of flags) lines.push(`- ${f.state === 'HIGH' ? '⛔' : f.state === 'LOW' ? '✅' : '❔'} ${f.label}: ${f.state}`);
    } else {
      lines.push(`## ${fa ? 'اسکنر قرارداد' : 'Contract scanner'}`, fa ? `- در دسترس نبود (${riskOut.code || 'unavailable'}). قضاوت قرارداد انجام نشد.` : `- Unavailable (${riskOut.code || 'unavailable'}). No contract judgement was made.`);
    }
    if (intel) {
      lines.push(
        '',
        `## ${fa ? 'بازار و هولدرها' : 'Market and holders'}`,
        `- ${fa ? 'نقدینگی' : 'Liquidity'}: ${usd(intel.liquidityUsd)} · ${fa ? 'حجم ۲۴ ساعت' : '24h volume'}: ${usd(intel.volume?.h24)}`,
        `- ${fa ? 'سن بازار' : 'Market age'}: ${days(intel.ageMs)} · ${fa ? 'تمرکز' : 'concentration'}: ${intel.holders?.whaleConcentration || 'UNKNOWN'}`,
        `- ${fa ? 'ریسک نقدینگی' : 'Liquidity risk band'}: ${intel.risk || 'UNKNOWN'}`
      );
    }
    lines.push(
      '',
      `## ${fa ? 'مهم' : 'Important'}`,
      fa
        ? '- «هیچ پرچم پرخطری دیده نشد» یعنی اسکنرها چیزی پیدا نکردند، نه این‌که توکن امن است. کلاهبرداری می‌تواند بعد از اسکن شروع شود.\n- داده‌های نامشخص پایین‌آورندهٔ اطمینان‌اند، نه نشانهٔ امنیت.'
        : '- “No high-risk flag seen” means the scanners found nothing, not that the token is safe. A scam can begin after the scan.\n- Unknown data lowers confidence; it is never a sign of safety.',
      '',
      footer(fa, [
        ['GoPlus', report ? 'live' : riskOut.code || 'unavailable'],
        ['DEX / holders', intel?.dataStatus || 'unavailable']
      ], at)
    );
    return {
      title: `${intel?.symbol || 'Token'} · ${this.name}`,
      text: lines.join('\n'),
      citations: isSol ? [] : [`https://gopluslabs.io/`],
      dataStatus: report && intel ? 'live' : 'partial'
    };
  }
};

const walletExposureAuditor = {
  slug: 'wallet-exposure-auditor',
  name: 'Wallet Exposure Auditor',
  nameFa: 'ممیزی مواجههٔ کیف‌پول',
  summary: 'Prices a wallet’s visible holdings, measures concentration and lists observed risk flags — no signing, no connection.',
  summaryFa: 'دارایی‌های قابل‌مشاهدهٔ کیف‌پول را قیمت می‌زند، تمرکز را می‌سنجد و پرچم‌های ریسک مشاهده‌شده را فهرست می‌کند — بدون اتصال و بدون امضا.',
  category: 'security',
  capabilities: ['wallet', 'holdings', 'concentration', 'risk-flags'],
  dataSources: ['Blockscout / explorer', 'DEX prices'],
  examples: ['Audit wallet 0x…', 'What is this wallet exposed to? 0x…'],
  examplesFa: ['کیف‌پول 0x… را بررسی کن', 'این کیف‌پول در معرض چه چیزی است؟ 0x…'],
  async run({ request, data, fa, at }) {
    if (!request.address) {
      return needInput(fa, {
        title: this.name,
        need: fa ? 'آدرس عمومی کیف‌پول را بدهید. FBT کلید خصوصی یا عبارت بازیابی نمی‌خواهد و هرگز آن را نمی‌پرسد.' : 'Give a public wallet address. FBT never asks for a private key or recovery phrase.',
        examples: fa ? this.examplesFa : this.examples
      });
    }
    const chainHint = request.solanaAddress ? 'solana' : (Number(request.chainId) || 1);
    const out = await withDeadline(data.walletIntel(request.address, chainHint), { ms: 12_000 });
    if (!out.ok || !out.value) {
      return {
        title: this.name,
        text: [`## ${fa ? 'داده‌ای خوانده نشد' : 'No data was read'}`,
          fa ? 'منبع آن‌چین برای این کیف‌پول پاسخ نداد؛ ارزش یا ریسکی ساخته نمی‌شود.' : 'The on-chain source did not answer for this wallet; no value or risk is invented.',
          '', footer(fa, [['Wallet intel', out.code || 'unavailable']], at)].join('\n'),
        citations: [], dataStatus: 'unavailable'
      };
    }
    const v = out.value;
    const holdings = Array.isArray(v.holdings) ? v.holdings.filter((h) => (h.valueUsd || 0) > 0).slice(0, 8) : [];
    const total = v.portfolioUsd || 0;
    const lines = [
      `# ${fa ? 'مواجههٔ کیف‌پول' : 'Wallet exposure'}`,
      '',
      `- ${fa ? 'آدرس' : 'Address'}: ${v.address || request.address}`,
      `- ${fa ? 'زنجیره' : 'Chain'}: ${CHAIN_LABELS[chainHint] || chainHint}`,
      `- ${fa ? 'ارزش قابل‌مشاهده' : 'Visible value'}: ${usd(total)} (${v.dataStatus || 'unknown'})`,
      `- ${fa ? 'سن کیف‌پول' : 'Wallet age'}: ${days(v.ageMs)} · ${fa ? 'تعداد تراکنش' : 'transactions'}: ${int(v.txCount)}`,
      ''
    ];
    if (holdings.length) {
      lines.push(`## ${fa ? 'دارایی‌ها' : 'Holdings'}`);
      for (const h of holdings) {
        const share = total > 0 && h.valueUsd ? (h.valueUsd / total) * 100 : null;
        lines.push(`- ${h.symbol || '—'}: ${usd(h.valueUsd)}${share != null ? ` (${num(share, 1)}%)` : ''}`);
      }
      const top = holdings[0];
      const topShare = top && total > 0 && top.valueUsd ? (top.valueUsd / total) * 100 : null;
      if (topShare != null) {
        lines.push('', `## ${fa ? 'تمرکز' : 'Concentration'}`, `- ${fa ? 'بزرگ‌ترین دارایی' : 'Largest asset'}: ${top.symbol} ${num(topShare, 1)}% ${topShare > 60 ? (fa ? '— تمرکز بالا' : '— high concentration') : ''}`);
      }
    } else {
      lines.push(`## ${fa ? 'دارایی' : 'Holdings'}`, fa ? '- دارایی قیمت‌خورده‌ای در این زنجیره دیده نشد.' : '- No priced holding was visible on this chain.');
    }
    const risk = v.risk || null;
    lines.push('', `## ${fa ? 'پرچم‌های ریسک مشاهده‌شده' : 'Observed risk flags'}`);
    if (risk && typeof risk === 'object' && Object.keys(risk).length) {
      for (const [key, value] of Object.entries(risk).slice(0, 8)) {
        lines.push(`- ${key}: ${typeof value === 'object' ? JSON.stringify(value).slice(0, 120) : String(value).slice(0, 120)}`);
      }
    } else {
      lines.push(fa ? '- پرچم صریحی گزارش نشد؛ نبودِ پرچم یعنی دادهٔ کافی برای آن بررسی نبوده است.' : '- No explicit flag was reported; no flag can also mean the check had no data.');
    }
    lines.push(
      '',
      `## ${fa ? 'محدودهٔ این بررسی' : 'Scope'}`,
      fa
        ? `- فقط زنجیرهٔ ${CHAIN_LABELS[chainHint] || chainHint} خوانده شد؛ دارایی روی زنجیره‌های دیگر در این عدد نیست.\n- ارزش‌ها با قیمت بازار لحظهٔ خوانش‌اند و ممکن است برای توکن‌های کم‌عمق دقیق نباشند.\n- این بررسی به کیف‌پول وصل نمی‌شود و هیچ امضا یا تأییدی نمی‌خواهد.`
        : `- Only ${CHAIN_LABELS[chainHint] || chainHint} was read; assets on other chains are not in this number.\n- Values use market prices at read time and can be inaccurate for thin tokens.\n- This audit does not connect to the wallet and asks for no signature or approval.`,
      '',
      footer(fa, [
        ['Balances', v.sources?.balances || 'unavailable'],
        ['Pricing', v.sources?.pricing || 'unavailable'],
        ['History', v.sources?.history || 'unavailable']
      ], at)
    );
    return {
      title: `${String(request.address).slice(0, 10)}… · ${this.name}`,
      text: lines.join('\n'),
      citations: [],
      dataStatus: v.dataStatus || 'partial'
    };
  }
};

const protocolSecurityBrief = {
  slug: 'protocol-security-brief',
  name: 'Protocol Security Brief',
  nameFa: 'گزارش امنیتی پروتکل',
  summary: 'Gathers TVL, chain spread, recorded audits, age and incident history for a DeFi protocol.',
  summaryFa: 'TVL، پراکندگی زنجیره‌ها، بازبینی‌های ثبت‌شده، سن و سابقهٔ حادثهٔ یک پروتکل دیفای را جمع می‌کند.',
  category: 'security',
  capabilities: ['protocol', 'tvl', 'audits', 'incidents'],
  dataSources: ['DefiLlama protocols', 'DefiLlama hacks'],
  examples: ['Security brief for Aave', 'How risky is Curve?'],
  examplesFa: ['گزارش امنیتی Aave', 'ریسک Curve چقدر است؟'],
  async run({ request, data, fa, at }) {
    const protocolsOut = await withDeadline(data.protocols(), { ms: 9_000 });
    const matchedInText = protocolsOut.ok && Array.isArray(protocolsOut.value)
      ? protocolsOut.value
        .filter((p) => mentions(request.text, p.name) || mentions(request.text, p.slug))
        .sort((a, b) => (b.tvl || 0) - (a.tvl || 0))[0]
      : null;
    const query = request.protocolQuery || matchedInText?.name || request.symbol;
    if (!query || !protocolsOut.ok || !Array.isArray(protocolsOut.value)) {
      return needInput(fa, {
        title: this.name,
        need: fa ? 'نام پروتکل را بدهید (مثلاً «Aave» یا «Curve»). بدون نام، هیچ پروتکلی حدس زده نمی‌شود.' : 'Name a protocol (e.g. “Aave” or “Curve”). Without a name, no protocol is guessed.',
        examples: fa ? this.examplesFa : this.examples
      });
    }
    const q = String(query).toLowerCase();
    const match = protocolsOut.value
      .filter((p) => String(p.name || '').toLowerCase().includes(q) || String(p.slug || '').toLowerCase().includes(q))
      .sort((a, b) => (b.tvl || 0) - (a.tvl || 0))[0];
    if (!match) {
      return needInput(fa, {
        title: this.name,
        need: fa ? `پروتکلی با نام «${query}» در فید DefiLlama پیدا نشد. املای نام را بررسی کنید.` : `No protocol named “${query}” was found in the DefiLlama feed. Check the spelling.`,
        examples: fa ? this.examplesFa : this.examples
      });
    }
    const [detailOut, incidentsOut] = await Promise.all([
      withDeadline(data.protocolDetail(match.slug)),
      withDeadline(data.incidents(), { ms: 9_000 })
    ]);
    const detail = detailOut.ok ? detailOut.value : null;
    const incidents = incidentsOut.ok && Array.isArray(incidentsOut.value)
      ? incidentsOut.value.filter((i) => String(i.protocol || '').toLowerCase().includes(String(match.name || '').toLowerCase()))
      : [];
    const first = match.listedAt ? match.listedAt * 1000 : null;
    const ageMs = first ? Date.now() - first : null;
    const lines = [
      `# ${match.name} · ${this.name}`,
      '',
      `## ${fa ? 'اندازه و حضور' : 'Size and footprint'}`,
      `- TVL: ${usd(detail?.tvl ?? match.tvl)} · ${fa ? 'دسته' : 'category'}: ${detail?.category || match.category || '—'}`,
      `- ${fa ? 'تغییر ۱ روز / ۷ روز' : '1d / 7d change'}: ${pct(detail?.change_1d ?? match.change_1d)} / ${pct(detail?.change_7d ?? match.change_7d)}`,
      `- ${fa ? 'زنجیره‌ها' : 'Chains'}: ${(detail?.chains || match.chains || []).slice(0, 8).join(', ') || '—'}`,
      `- ${fa ? 'در فید از' : 'In feed since'}: ${first ? new Date(first).toISOString().slice(0, 10) : '—'} ${ageMs ? `(${days(ageMs)})` : ''}`,
      '',
      `## ${fa ? 'بازبینی' : 'Audits'}`,
      `- ${fa ? 'بازبینی ثبت‌شده' : 'Recorded audits'}: ${detail?.audits || match.audits || (fa ? 'در فید ثبت نشده' : 'none recorded in the feed')}`,
      `- ${fa ? 'پیوندهای گزارش' : 'Report links'}: ${(detail?.auditLinks || match.audit_links || []).length ? (detail?.auditLinks || match.audit_links).slice(0, 3).join(' · ') : '—'}`,
      fa ? '- «بازبینی‌شده» یعنی گزارشی وجود دارد؛ به معنی بی‌ریسک بودن نیست.' : '- “Audited” means a report exists; it does not mean risk-free.',
      '',
      `## ${fa ? 'سابقهٔ حادثه' : 'Incident history'}`
    ];
    if (!incidentsOut.ok) {
      lines.push(fa ? '- فید حادثه‌ها خوانده نشد؛ این بخش نامشخص است.' : '- The incident feed was not read; this section is unknown.');
    } else if (!incidents.length) {
      lines.push(fa ? '- حادثه‌ای با این نام در فید DefiLlama ثبت نشده است. نبودِ رکورد، اثبات نبود حادثه نیست.' : '- No incident under this name is in the DefiLlama feed. Absence of a record is not proof of absence.');
    } else {
      for (const i of incidents.slice(0, 5)) {
        lines.push(`- ${i.dateLabel || '—'} · ${usd(i.amountUsd)} · ${i.category || '—'}${i.link ? ` · ${i.link}` : ''}`);
      }
    }
    lines.push(
      '',
      `## ${fa ? 'جمع‌بندی صادقانه' : 'Honest summary'}`,
      fa
        ? '- بزرگ بودن TVL و قدیمی بودن پروتکل، ریسک قرارداد و حاکمیت را حذف نمی‌کند.\n- این گزارش وضعیت را توصیف می‌کند؛ «امن» یا «ناسالم» اعلام نمی‌کند.'
        : '- Large TVL and age do not remove contract or governance risk.\n- This brief describes facts; it does not declare a protocol safe or unsafe.',
      '',
      footer(fa, [
        ['DefiLlama protocols', 'live'],
        ['DefiLlama hacks', incidentsOut.ok ? `${incidents.length} matching` : 'unavailable']
      ], at)
    );
    return {
      title: `${match.name} · ${this.name}`,
      text: lines.join('\n'),
      citations: [detail?.url || match.url || 'https://defillama.com/'].filter(Boolean),
      dataStatus: 'live'
    };
  }
};

/* ─────────────────────────────── registry ──────────────────────────────── */

export const NATIVE_AGENTS = Object.freeze([
  aiTradingAnalyst,
  smartMoneyTracker,
  tokenResearchAgent,
  strategyBacktestingAgent,
  yieldOptimizer,
  liquidityPoolAnalyzer,
  lendingRiskAgent,
  crossChainSwapAssistant,
  tokenRiskScanner,
  walletExposureAuditor,
  protocolSecurityBrief
].map((agent) => Object.freeze({ ...agent, schema: NATIVE_AGENT_SCHEMA })));

export const NATIVE_AGENT_IDS = Object.freeze(NATIVE_AGENTS.map((a) => a.slug));

export function getNativeAgent(slug) {
  return NATIVE_AGENTS.find((a) => a.slug === String(slug || '')) || null;
}

/**
 * Run one native agent. The result is already the shape the broker stores:
 * `{ ok, text, citations, dataStatus }`. Agent exceptions are converted into a
 * typed failure — a crash must not look like an empty answer.
 */
export async function runNativeAgent(slug, { text = '', context = null } = {}, data, { now = () => Date.now() } = {}) {
  const agent = getNativeAgent(slug);
  if (!agent) return { ok: false, code: 'NATIVE_AGENT_NOT_FOUND' };
  const fa = hasPersian(text);
  const at = now();
  const request = extractRequest(text);
  try {
    const out = await agent.run({ request, text, context, data, fa, at });
    if (!out || !out.text) return { ok: false, code: 'NATIVE_AGENT_EMPTY' };
    /* The card name is localised in the UI, so the RESULT title must be too —
       otherwise a Persian request came back headed "AI Trading Analyst" while
       the card that opened it said «تحلیل‌گر معامله». Only the display title is
       mapped; the agent identity (`agent.slug`) never changes. */
    const rawTitle = out.title || agent.name;
    const title = fa && agent.nameFa ? String(rawTitle).split(agent.name).join(agent.nameFa) : rawTitle;
    const dataStatus = out.dataStatus || 'live';
    return {
      ok: true,
      agent,
      title,
      text: out.text,
      citations: Array.isArray(out.citations) ? out.citations.filter((u) => /^https:\/\//i.test(String(u))).slice(0, 8) : [],
      dataStatus,
      data: {
        agent: agent.slug,
        lang: fa ? 'fa' : 'en',
        dataStatus,
        /* `awaiting_input` is a completed run that needs a better question.
           Saying so explicitly stops the UI from painting it as a failure. */
        needsInput: dataStatus === 'awaiting_input',
        readAt: at,
        request: {
          symbol: request.symbol,
          chainId: request.chainId,
          hasAddress: Boolean(request.address),
          protocol: request.protocolQuery || null
        }
      }
    };
  } catch (error) {
    return {
      ok: false,
      code: 'NATIVE_AGENT_FAILED',
      detail: String(error?.message || error).slice(0, 160),
      agent
    };
  }
}

/** Metadata used by the catalog and by tests. No user data, no network. */
export function nativeAgentCatalog() {
  return NATIVE_AGENTS.map((a) => ({
    slug: a.slug,
    name: a.name,
    nameFa: a.nameFa,
    summary: a.summary,
    summaryFa: a.summaryFa,
    category: a.category,
    capabilities: [...a.capabilities],
    examples: [...a.examples],
    examplesFa: [...a.examplesFa],
    inputHint: a.inputHint || null,
    inputHintFa: a.inputHintFa || null,
    dataSources: [...a.dataSources]
  }));
}
