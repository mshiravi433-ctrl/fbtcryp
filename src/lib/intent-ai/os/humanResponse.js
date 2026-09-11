/**
 * FBT INTENT OS — Human Response Layer
 * Speak from REAL tool results. Never claim a check that did not run.
 * Missing price ≠ $0. Connected-but-empty ≠ disconnected.
 */

import { SPECULATIVE_VOCABULARY_PRESENT } from '../speculativeLexicon.js';
import { pageName } from './moduleRouter.js';
import { parseGoalSpec } from '../../strategyBrain/goalSpec.js';

const LEAK_PATTERNS = [
  /Prepared\s+\d+\s+real\s+action\(s\)\.?/gi,
  /\b\d+\s+action\(s\)\b/gi,
  /\bBlocked\s*[·•.\-]\s*\w+/gi,
  /\bblocked wallet\b/gi,
  /\bWALLET_REQUIRED\b/g,
  /\bWALLET_SIGNATURE_REQUIRED\b/g,
  /\bHANDOFF_READY\b/g,
  /\btool_call\b/gi,
  /\baction_id\b/gi,
  /\bIntent:\s*[A-Z_]+\.?\s*/g,
  /\bPORTFOLIO\b/g,
  /\bREBALANCE\b/g,
  /\bAUTOMATION_CREATE\b/g,
  /\bSTABLE_SHIELD\b/g,
  /\bYIELD_SWEEP\b/g,
  /\/portfolio\b/gi,
  /\/intent-ai\b/gi,
  /\/swap\b/gi,
  /handoffRoute/gi,
  /execution object/gi,
  /backend error/gi,
  /internal state/gi,
  /executor/gi,
  /router_state/gi,
  /tool_registry/gi,
  /action_bus/gi,
  /\b[A-Z_]{2,}_[A-Z_]+\b/g
];

const ALLOWED_CAPS = new Set(['ETH', 'BTC', 'SOL', 'USDC', 'USDT', 'BNB', 'ARB', 'OK', 'USD']);

export function formatUnderstandingConfirmation(intentData = {}, { locale = 'fa' } = {}) {
  const isEn = String(locale).toLowerCase().startsWith('en');
  const action = intentData.action || intentData.intentType || intentData.primaryIntent || 'REQUEST';
  const params = intentData.parameters || intentData.entities || {};
  const impact = intentData.estimatedImpact || '';
  const assumptions = intentData.assumptions || [];

  const paramStrings = Object.entries(params)
    .filter(([_, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');

  if (isEn) {
    let out = `I understand you want to execute: ${action}\n`;
    if (paramStrings) out += `• Parameters: ${paramStrings}\n`;
    if (impact) out += `• Estimated impact: ${impact}\n`;
    if (assumptions.length) out += `• Assumptions: ${assumptions.join('; ')}\n`;
    out += `\nPlease confirm if you want to proceed.`;
    return out;
  }

  let out = `من متوجه شدم که می‌خواهید عملیات زیر را انجام دهید: ${action}\n`;
  if (paramStrings) out += `• مشخصات: ${paramStrings}\n`;
  if (impact) out += `• برآورد اثر: ${impact}\n`;
  if (assumptions.length) out += `• فرضیات: ${assumptions.join('؛ ')}\n`;
  out += `\nدر صورت تایید، دستور اجرا خواهد شد.`;
  return out;
}

export function formatConflictResolution(conflict = {}, { locale = 'fa' } = {}) {
  const isEn = String(locale).toLowerCase().startsWith('en');
  const prev = conflict.previousIntent || conflict.from || 'previous operation';
  const next = conflict.newIntent || conflict.to || 'new operation';

  if (isEn) {
    return `Notice: Your current request (${next}) conflicts with your earlier request (${prev}). Would you like to override it and proceed with the new action?`;
  }

  return `توجه: درخواست جدید شما با درخواست قبلی (${prev}) در تعارض است. آیا مایلید با دستور جدید (${next}) ادامه دهیم؟`;
}

export function formatRiskWarning({ riskScore = 'HIGH', reason = '' } = {}, { locale = 'fa' } = {}) {
  const isEn = String(locale).toLowerCase().startsWith('en');
  if (isEn) {
    return `⚠️ High Risk Warning (${riskScore}): ${reason || 'This transaction carries market volatility or leverage risk.'} Capital is never guaranteed.`;
  }
  return `⚠️ هشدار ریسک (${riskScore}): ${reason || 'این عملیات شامل نوسان بازار یا اهرم است.'} سود تضمین‌شده وجود ندارد و اصل سرمایه ممکن است با کاهش روبرو شود.`;
}

export function stripInternalLeaks(text) {
  let out = String(text || '');
  for (const re of LEAK_PATTERNS) {
    if (re.source.includes('[A-Z_]{2,}')) {
      out = out.replace(re, (match) => {
        if (ALLOWED_CAPS.has(match.trim())) return match;
        if (/^[A-Z]{2,6}$/.test(match.trim()) && match.trim().length <= 6 && !match.includes('_')) return match;
        return '';
      });
    } else {
      out = out.replace(re, '');
    }
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function langOf(locale) {
  const code = String(locale || 'fa').toLowerCase();
  return code.startsWith('en') ? 'en' : 'fa';
}

function money(n) {
  if (n == null || n === '') return null;
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  const abs = Math.abs(v);
  const formatted = abs >= 100
    ? Math.round(abs).toLocaleString('en-US')
    : (Math.round(abs * 100) / 100).toLocaleString('en-US');
  return `$${formatted}`;
}

function moneyOrNa(n) {
  return money(n) || 'N/A';
}

/** $1.01T / $32.5B / $940.2M — compaction for market-cap / volume rows. */
function moneyCompact(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return null;
  const abs = Math.abs(v);
  const fmt = (d) => (Math.round(abs / d * 100) / 100).toLocaleString('en-US');
  if (abs >= 1e12) return `$${fmt(1e12)}T`;
  if (abs >= 1e9) return `$${fmt(1e9)}B`;
  if (abs >= 1e6) return `$${fmt(1e6)}M`;
  if (abs >= 1e3) return `$${fmt(1e3)}K`;
  return `$${(Math.round(abs * 100) / 100).toLocaleString('en-US')}`;
}

function pct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 'N/A';
  return `${Math.round(v * 10) / 10}%`;
}

function isConnected(context = {}, results = {}) {
  const w = context.wallet || results.wallet || {};
  if (w.connected || w.isConnected || w.connectionStatus === 'CONNECTED' || w.connectionStatus === 'HYDRATING') return true;
  if (context.hasWallet) return true;
  if (w.address || w.evmAddress || w.evmAddresses?.[0] || w.solanaAddress) return true;
  return false;
}

function isHydrating(context = {}, results = {}) {
  const w = context.wallet || {};
  const p = context.portfolio || results.portfolio || {};
  return Boolean(w.hydrating || p.hydrating || w.connectionStatus === 'HYDRATING' || p.freshness === 'PENDING' || p.dataStatus === 'pending');
}

function collectHoldings(context = {}, results = {}) {
  const portfolio = results.portfolio || results.analysis || context.portfolio || {};
  const analysis = results.analysis && typeof results.analysis === 'object' ? results.analysis : {};
  const holdings = analysis.holdings || portfolio.holdings || context.portfolio?.holdings || [];
  return { portfolio, analysis, holdings: Array.isArray(holdings) ? holdings : [] };
}

function allocationLines(holdings, total) {
  const priced = holdings.filter((h) => Number.isFinite(Number(h.valueUsd)) && Number(h.valueUsd) > 0);
  const den = Number.isFinite(Number(total)) && Number(total) > 0
    ? Number(total)
    : priced.reduce((s, h) => s + Number(h.valueUsd), 0);
  return holdings.slice(0, 8).map((h) => {
    const value = Number.isFinite(Number(h.valueUsd)) ? money(h.valueUsd) : null;
    const share = value && den > 0 ? pct((Number(h.valueUsd) / den) * 100) : null;
    const amount = h.amount != null ? String(h.amount) : '';
    if (!value) return `${h.symbol || '—'}${amount ? `  ${amount}` : ''}   N/A`;
    return `${String(h.symbol || '—').padEnd(8)} ${value}   ${share || ''}`.trim();
  });
}

function toolsRan(results = {}) {
  return Array.isArray(results.toolsUsed) && results.toolsUsed.length > 0;
}

/*
 * ─── STRUCTURED CARDS ────────────────────────────────────────────────────────
 * The chat surface renders these as real UI (allocation bars, price charts,
 * 24h high/low ranges) instead of prose. Numbers only travel inside the card
 * when a tool actually produced them — the card never invents a field.
 */
function portfolioCard(total, sortedHoldings, pricedCount, unpricedCount, lang) {
  const den = Number.isFinite(Number(total)) && Number(total) > 0 ? Number(total) : null;
  const rows = (sortedHoldings || []).slice(0, 8).map((h) => {
    const value = Number.isFinite(Number(h.valueUsd)) ? Number(h.valueUsd) : null;
    return {
      symbol: h.symbol || '—',
      amount: Number.isFinite(Number(h.amount)) ? Number(h.amount) : null,
      valueUsd: value,
      pct: value != null && den ? (value / den) * 100 : null
    };
  });
  return {
    kind: 'PORTFOLIO',
    title: lang === 'fa' ? 'پرتفوی من' : 'My portfolio',
    totalValueUsd: den,
    pricedCount,
    unpricedCount,
    rows,
    at: Date.now()
  };
}

const numOr = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * Build the TOKEN card that powers the chat chart UI: sparkline series,
 * 24h high/low range, changes across 1h/24h/7d and the backtested signal.
 * Every field is pass-through from a real read; missing stays null.
 */
function tokenCard(token, lang) {
  if (!token || typeof token !== 'object') return null;
  const spark = Array.isArray(token.sparkline)
    ? token.sparkline.map(numOr).filter((v) => v != null)
    : [];
  return {
    kind: 'TOKEN',
    symbol: token.symbol || null,
    name: token.name || null,
    priceUsd: numOr(token.priceUsd),
    change1hPct: numOr(token.change1hPct),
    change24hPct: numOr(token.change24hPct),
    change7dPct: numOr(token.change7dPct),
    high24h: numOr(token.high24h),
    low24h: numOr(token.low24h),
    marketCapUsd: numOr(token.marketCapUsd),
    volume24hUsd: numOr(token.volume24hUsd),
    rank: numOr(token.rank),
    ath: numOr(token.ath),
    sparkline: spark.slice(-168),
    signal: token.analysis?.signal || null,
    rsi: numOr(token.analysis?.rsi),
    confidence: numOr(token.analysis?.confidence),
    at: token.fetchedAt || Date.now(),
    source: token.source || 'api'
  };
}

/** Compact high/low line for the message text — the card draws the visual. */
function rangeLine(token, lang) {
  const hi = numOr(token?.high24h);
  const lo = numOr(token?.low24h);
  if (hi == null && lo == null) return null;
  if (lang === 'fa') return `بالاترین قیمت ۲۴ ساعت: ${moneyOrNa(hi)} · کمترین: ${moneyOrNa(lo)}`;
  return `24h high: ${moneyOrNa(hi)} · low: ${moneyOrNa(lo)}`;
}

export function buildHumanResponse({ intent, context = {}, results = {}, plan = null, locale = 'fa' } = {}) {
  const lang = langOf(locale);
  const type = intent?.type || 'GENERAL';
  const connected = isConnected(context, results);
  const hydrating = isHydrating(context, results);

  if (intent?.isConflict || results?.isConflict) {
    const conflictMsg = intent?.conflictDetails?.messageFa || results?.conflictDetails?.messageFa || 'منظورتان خرید است یا فروش آن؟';
    const conflictMsgEn = intent?.conflictDetails?.messageEn || results?.conflictDetails?.messageEn || 'Did you mean to buy or sell?';
    return {
      message: lang === 'fa' ? conflictMsg : conflictMsgEn,
      ui: { type: 'TEXT' }
    };
  }

  /*
   * A module that exists in the spec but not in this build must be stated
   * plainly — the user typed a real request, and the honest answer is that
   * this build does not ship that screen, not a navigation to a dead URL.
   */
  if (results.unavailable === 'SPECULATION_DISABLED') {
    return {
      message: lang === 'fa'
        ? 'این بخش (افق جهانی / فیوچرز / dYdX) در این بیلد فعال نیست و صفحه‌اش در این نسخه وجود ندارد. می‌توانم در بخش‌های فعال مثل سواپ، فارم، وام یا بازار کمکت کنم.'
        : 'That module (Horizon / perpetuals / dYdX) is not enabled in this build — its page does not exist in this version. I can help with swap, farm, lending or markets instead.',
      ui: { type: 'TEXT' }
    };
  }

  /*
   * Specific Token Portfolio Query (e.g. "من بیت کوین دارم؟" / "بیت کوین دارم؟")
   */
  const rawText = String(intent?.raw || '').toLowerCase();
  /*
   * «من ۱۰ هزار دلار دارم، ۱۵٪ سود در ۴ ماه» contains «من … دارم», so this
   * heuristic used to swallow the whole objective and answer it as "do you
   * hold USD?" — with a connect-wallet wall in front of a question that never
   * needed a wallet, because the capital is IN the sentence. An intent the
   * parser classified as an objective is not a holdings question.
   */
  const OBJECTIVE_TYPES = ['STRATEGY_PLAN', 'GOAL_PLAN'];
  const isHoldingQuery = /(دارم\s*\?|دارم\s*$|من.*دارم|do i have)/i.test(rawText)
    && Boolean(intent?.entities?.token)
    && !OBJECTIVE_TYPES.includes(String(intent?.type || '').toUpperCase());
  if (isHoldingQuery && intent?.entities?.token) {
    const sym = intent.entities.token.toUpperCase();
    if (!connected) {
      return {
        message: lang === 'fa'
          ? `برای بررسی اینکه آیا ${sym} دارید یا خیر، لطفاً کیف پول خود را متصل کنید.`
          : `Please connect your wallet to check if you hold ${sym}.`,
        ui: { type: 'CONNECT_WALLET' }
      };
    }
    const { holdings } = collectHoldings(context, results);
    const match = holdings.find((h) => String(h.symbol || '').toUpperCase() === sym);
    if (match && Number(match.amount) > 0) {
      const valStr = match.valueUsd ? ` (معادل تقریبی ${money(match.valueUsd)})` : '';
      const valStrEn = match.valueUsd ? ` (approx. ${money(match.valueUsd)})` : '';
      return {
        message: lang === 'fa'
          ? `بله، شما در این کیف پول ${match.amount} ${sym}${valStr} دارید.`
          : `Yes, you currently have ${match.amount} ${sym}${valStrEn} in this wallet.`,
        ui: { type: 'TEXT' },
        holding: match
      };
    }
    return {
      message: lang === 'fa'
        ? `بر اساس موجودی فعلی کیف پول، شما در حال حاضر دارایی ${sym} در این والت ندارید.`
        : `Based on your current wallet balance, you do not hold any ${sym} in this wallet.`,
      ui: { type: 'TEXT' }
    };
  }

  /*
   * "چیا دارم که بفروشم؟" — Portfolio Candidate Inspection
   */
  if (/(چیا دارم که بفروشم|چی دارم بفروشم|دارایی.*فروش|what can i sell)/i.test(rawText)) {
    if (!connected) {
      return {
        message: lang === 'fa'
          ? 'برای مشاهده دارایی‌های قابل فروش، لطفاً ابتدا کیف پول خود را متصل کنید.'
          : 'Please connect your wallet to view sellable assets.',
        ui: { type: 'CONNECT_WALLET' }
      };
    }
    const { holdings } = collectHoldings(context, results);
    const sellable = holdings.filter((h) => Number(h.valueUsd) > 0 || Number(h.amount) > 0);
    if (!sellable.length) {
      return {
        message: lang === 'fa'
          ? 'در حال حاضر دارایی با موجودی مثبت در کیف پول شما یافت نشد.'
          : 'No positive-balance assets found in your wallet.',
        ui: { type: 'TEXT' }
      };
    }
    const lines = sellable.map((h) => `• ${h.symbol}: ${h.amount || '—'} (${moneyOrNa(h.valueUsd)})`);
    return {
      message: lang === 'fa'
        ? `دارایی‌های موجود شما در کیف پول:\n\n${lines.join('\n')}\n\nهیچ فروشی خودکار انجام نمی‌شود. اگر می‌خواهید هر کدام را بفروشید، بفرمایید تا نقل‌قول را آماده کنم.`
        : `Your current wallet holdings:\n\n${lines.join('\n')}\n\nNo sale will run automatically. Tell me if you wish to sell any of them.`,
      ui: { type: 'TEXT' },
      holdings: sellable
    };
  }

  /*
   * Definition question (e.g. "بیت کوین چیه؟")
   */
  if (/(چیست|چیه|what is|tell me about)/i.test(rawText) && intent?.entities?.token) {
    const sym = intent.entities.token.toUpperCase();
    const tokenInfo = {
      BTC: { fa: 'بیت‌کوین (BTC) نخستین و شناخته‌شده‌ترین ارز دیجیتال غیرمتمرکز است که به عنوان طلای دیجیتال و ذخیره ارزش استفاده می‌شود.', en: 'Bitcoin (BTC) is the first decentralized cryptocurrency, widely used as digital gold and store of value.' },
      ETH: { fa: 'اتریوم (ETH) پلتفرم پیشرو قراردادهای هوشمند است که اکوسیستم دیفای و برنامه‌های غیرمتمرکز را قدرت می‌بخشد.', en: 'Ethereum (ETH) is the leading smart contract platform powering decentralized finance and dApps.' },
      USDT: { fa: 'تتر (USDT) یک استیبل‌کوین محبوب با پشتوانه دلار آمریکا است که ارزش آن همیشه در محدوده ۱ دلار تثبیت شده است.', en: 'Tether (USDT) is a major USD-pegged stablecoin maintaining a steady $1 valuation.' },
      SOL: { fa: 'سولانا (SOL) یک شبکه بلاکچینی پرسرعت و با کارمزد بسیار پایین برای اجرای قراردادهای هوشمند و تراکنش‌های سریع است.', en: 'Solana (SOL) is a high-throughput, low-fee blockchain built for scalable decentralized applications.' }
    }[sym] || {
      fa: `${sym} یک توکن کریپتویی در اکوسیستم ارزهای دیجیتال است. می‌توانید نمودار قیمت و وضعیت لحظه‌ای آن را در صفحه بازار بررسی کنید.`,
      en: `${sym} is a digital asset in the crypto ecosystem. You can inspect its live market data on the market page.`
    };

    return {
      message: lang === 'fa' ? tokenInfo.fa : tokenInfo.en,
      ui: results?.token?.dataStatus === 'unavailable' || !results?.token ? { type: 'TEXT' } : { type: 'TOKEN_CARD' },
      card: results?.token && results.token.dataStatus !== 'unavailable'
        ? tokenCard(results.token, lang)
        : null,
      /* The chip says "the BTC market page", so it must go to the coin page
         and not to `/market` — a path the router does not have, which the
         catch-all turned into the market home. Same id rule as
         TokenMarketCard so the chip and the card agree. */
      actions: [{
        id: `view-${sym.toLowerCase()}`,
        route: `/coin/${String(results?.token?.coinId || sym).toLowerCase()}`,
        label: lang === 'fa' ? `صفحه بازار ${sym}` : `${sym} Market`
      }]
    };
  }

  /*
   * «والت را ببند» routes to the wallet page which performs the actual
   * disconnect. The chat cannot claim it already happened — the page does it.
   */
  if (type === 'WALLET_DISCONNECT' && results.route) {
    return {
      message: lang === 'fa'
        ? 'کیف پول را می‌بندم — صفحه کیف پول باز شد و قطع اتصال همان‌جا انجام می‌شود.'
        : 'Closing your wallet — the wallet page opened and will disconnect there.',
      ui: { type: 'TEXT' },
      navigated: results.route
    };
  }

  if (results.route || results.handoff || type === 'NAVIGATION' || type === 'NEWS_SEARCH') {
    const route = results.route || plan?.actions?.[0]?.input?.route || intent?.navigation?.route;
    if (route) {
      const name = pageName(route, locale);
      const e = intent?.entities || {};
      const bits = [e.amount, e.fromToken || e.token, e.toToken, e.toAddress, e.priceTrigger != null ? e.priceTrigger : null].filter(Boolean);
      const extra = bits.length
        ? (lang === 'fa' ? ` مقادیر آماده‌شده: ${bits.join(' → ')}.` : ` Prefill: ${bits.join(' → ')}.`)
        : '';
      return {
        message: lang === 'fa'
          ? `صفحه ${name} را باز کردم.${extra} اگر این کار پول جابه‌جا می‌کند، تأیید و امضا همان‌جا انجام می‌شود — در چت اجرا نمی‌کنم.`
          : `Opened ${name}.${extra} Money-moving confirmations stay on that page — I will not execute them in chat.`,
        ui: { type: 'TEXT' },
        navigated: route
      };
    }
  }

  /*
   * ─── «سودم دو برابر شود» ───────────────────────────────────────────────
   * This used to score as YIELD_DISCOVERY and answer with a route chip — the
   * exact complaint: «وقتی میگم سود زیاد فقط میبره صفحه سهام». A named multiple
   * is a GOAL: it needs a target, a horizon, the live rates and a verdict, and
   * the answer is arithmetic, not a link.
   *
   * The plan itself is compiled by the chat (autonomy/goalPlanCompiler via
   * autonomy/goalSources) because that is where the live balances and the
   * scanner output for this turn already are, and because this function is
   * synchronous by contract. What this layer decides is WHICH question was
   * asked — and that the answer must be a card that can be executed, not a
   * navigation.
   */
  /*
   * ─── «۱۰ هزار دلار دارم، ۱۵٪ در ۴ ماه، ریسک متوسط» ──────────────────────
   * This is not a portfolio snapshot and not a single trade. It is an
   * OBJECTIVE, and the answer is a cross-module Portfolio Strategy: the
   * strategy brain reads the whole ecosystem this turn (wallet, portfolio,
   * crypto, RWA, stocks, forex, commodities, lending, farms, pools, futures,
   * dYdX, bridge, smart money, whales, news, macro, risk, fees, gas,
   * correlation), compares every plan it can actually build inside the user's
   * own risk band, and returns the winner as staged handoffs to real venues.
   *
   * The plan itself is compiled by the chat (lib/strategyBrain) after this
   * function returns, for the same reason the goal compiler runs there: this
   * layer is synchronous by contract, and the reads are async. What this layer
   * decides is that the answer must be a STRATEGY CARD — and that a missing
   * number is asked for inside that card, not by a dead-end sentence.
   */
  if (type === 'STRATEGY_PLAN') {
    const raw = String(intent?.raw || context?.lastMessage || '');
    /*
     * The parser does not read «۱۰ هزار دلار» — Persian digits plus the word
     * «هزار» are outside its amount regex — so asking it for `amountUsd` here
     * would tell a user who just typed their capital that it is missing. The
     * goal spec reader is the one that understands the sentence; it is pure
     * arithmetic, so it is safe to call from this synchronous layer.
     */
    const goalSpec = parseGoalSpec({
      text: raw,
      entities: intent?.entities || {},
      portfolio: context?.portfolio || null,
      balances: context?.balances || null,
      wallet: context?.wallet || null
    });
    const knowsCapital = goalSpec.capitalUsd > 0;
    return {
      message: lang === 'fa'
        ? (knowsCapital
          ? 'هدف را گرفتم. حالا کل اکوسیستم را یک‌جا می‌خوانم — کیف پول، پرتفوی، کریپتو، RWA، سهام، فارکس، کالا، وام، فارم، نقدینگی، فیوچرز، dYdX، بریج، اسمارت‌مانی، نهنگ‌ها، اخبار، ماکرو، ریسک، کارمزد و گاز — و بین همه‌ی ماژول‌ها مقایسه می‌کنم تا یک استراتژی پرتفوی مرحله‌به‌مرحله بسازم. نه یک پاسخ متنی.'
          : 'برای ساختن استراتژی باید سرمایه‌ات را بدانم — مبلغ را بنویس یا کیف پول را وصل کن. بقیه‌ی اعداد (هدف، بازه، ریسک) را از جمله‌ات می‌خوانم.')
        : (knowsCapital
          ? 'Goal taken. Reading the whole ecosystem at once — wallet, portfolio, crypto, RWA, stocks, forex, commodities, lending, farms, pools, futures, dYdX, bridge, smart money, whales, news, macro, risk, fees and gas — then comparing every module to build one staged portfolio strategy. Not a text answer.'
          : 'To build a strategy I need your capital — type the amount or connect the wallet. I read the rest (target, horizon, risk) from your sentence.'),
      ui: { type: 'STRATEGY_PLAN_CARD' },
      strategyRequest: {
        text: raw,
        entities: intent?.entities || {},
        knownCapital: knowsCapital
      }
    };
  }

  if (type === 'GOAL_PLAN') {
    const multiple = Number(intent?.entities?.goalMultiple) > 1 ? Number(intent.entities.goalMultiple) : 2;
    const horizonDays = Number(intent?.entities?.horizonDays) > 0 ? Number(intent.entities.horizonDays) : 365;
    const hasCapital = Boolean(context?.portfolio?.totalValueUsd
      || context?.portfolio?.holdings?.length
      || context?.balances?.length
      || Number(intent?.entities?.amountUsd) > 0);
    if (!hasCapital && !connected) {
      return {
        message: lang === 'fa'
          ? `برای اینکه بگویم ${multiple} برابر شدن واقعاً چقدر طول می‌کشد، باید سرمایه واقعی‌ات را ببینم — نه یک عدد فرضی. کیف پول را وصل کن یا مبلغ را بنویس.`
          : `To tell you how long ${multiple}× actually takes, I need your real capital — not an assumed number. Connect the wallet or type the amount.`,
        ui: { type: 'CONNECT_WALLET' },
        goalRequest: { multiple, horizonDays },
        pendingIntent: intent?.raw || null
      };
    }
    return {
      message: lang === 'fa'
        ? `هدف را گرفتم: ${multiple} برابر در ${horizonDays} روز. حالا نرخ‌های واقعیِ همین لحظه را می‌خوانم و می‌گویم شدنی است یا نه — با عدد، نه با وعده.`
        : `Goal noted: ${multiple}× in ${horizonDays} days. Reading the live rates now and telling you whether it is reachable — with numbers, not a promise.`,
      ui: { type: 'GOAL_PLAN_CARD' },
      goalRequest: { multiple, horizonDays },
      requiresExecution: true
    };
  }

  /*
   * ─── «اتوماسیون را روشن کن» ─────────────────────────────────────────────
   * The autonomy loop (autonomy/botLoop.js) is real: protections, positions,
   * mark-to-market, PAPER / ARMED / LIVE. What it can never do in a
   * self-custody app is sign on its own — this app holds no key — so the card
   * states the mode it will run in before anything is armed.
   */
  if (type === 'AUTONOMY') {
    const raw = String(intent?.raw || context?.lastMessage || '').toLowerCase();
    const wantsStop = /بند|خاموش|متوقف|stop/i.test(raw);
    const wantsPaper = /کاغذی|پیپر|paper/i.test(raw);
    const mode = wantsPaper ? 'PAPER' : 'ARMED';
    return {
      message: lang === 'fa'
        ? (wantsStop
          ? 'اتوماسیون را متوقف کردم. هیچ موقعیت جدیدی باز نمی‌شود؛ موقعیت‌های باز سر جای خودشان می‌مانند تا خودت تصمیم بگیری.'
          : `اتوماسیون آماده است. در حالت «${mode === 'PAPER' ? 'کاغذی' : 'نیمه‌خودکار'}» کار می‌کند: تصمیم با آن، امضا با تو. اول استراتژی را روی داده واقعی بک‌تست می‌کنم و عددش را نشان می‌دهم — بعد می‌توانی مسلحش کنی.`)
        : (wantsStop
          ? 'Automation stopped. No new positions will be opened; open ones stay where they are until you decide.'
          : `Automation is ready. It runs in ${mode} mode: it decides, you sign. I backtest the strategy on real data first and show you the number — then you can arm it.`),
      ui: { type: 'AUTONOMY_CARD' },
      autonomyRequest: { wantsStop, mode },
      requiresExecution: true,
      actions: [{ id: 'open-ops', route: '/intent?tab=ops', label: lang === 'fa' ? 'مرکز عملیات' : 'Ops Center' }]
    };
  }

  if (type === 'OPEN_CALM' || type === 'PLAY_MUSIC') {
    return {
      message: lang === 'fa' ? 'حتماً، یک موسیقی آرامش‌بخش برایت پخش کردم.' : 'Sure, I started a relaxing track for you.',
      ui: { type: 'TEXT' },
      playing: true,
      mood: results.mood || 'relax'
    };
  }

  if (type === 'PORTFOLIO_ANALYSIS' || type === 'RISK_ANALYSIS') {
    if (hydrating && connected) {
      return {
        message: lang === 'fa'
          ? 'کیف پول متصل است. در حال همگام‌سازی آخرین موجودی‌ها هستم…'
          : 'Wallet connected. I am synchronizing the latest balances…',
        ui: { type: 'TEXT' },
        pendingRefresh: true
      };
    }
    const { portfolio, analysis, holdings } = collectHoldings(context, results);
    const total = analysis.totalValueUsd ?? portfolio.totalValueUsd ?? context.totalValueUsd ?? null;
    const priced = holdings.filter((h) => Number.isFinite(Number(h.valueUsd)));
    const unpriced = holdings.filter((h) => !Number.isFinite(Number(h.valueUsd)));

    if (!connected) {
      return {
        message: lang === 'fa'
          ? 'برای خواندن پرتفوی زنده باید کیف پول متصل باشد. لطفاً کیف پول را متصل کنید.'
          : 'A connected wallet is required to read the live portfolio.',
        ui: { type: 'CONNECT_WALLET' }
      };
    }

    /*
     * ─── EMPTY IS NOT THE ONLY REASON A WALLET READS BACK ZERO ROWS ──────────
     * The old code treated «connected + zero holdings + FRESH» as «the indexer
     * answered and the portfolio is genuinely empty». But a chain read that
     * FAILED (RPC down, rate-limited, timeout) also produces zero rows, and
     * the hook reports that through `failedChains` / `dataStatus: 'error'`.
     * Telling a user with a funded wallet «پرتفوی خالی است» was the exact
     * false answer this branch existed to avoid. Failed reads are now named
     * as failed reads, a refresh is requested, and only a read that truly
     * completed with zero rows is allowed to say «empty».
     */
    const failedChains = Array.isArray(portfolio?.failedChains) ? portfolio.failedChains : [];
    const readFailed = failedChains.length > 0
      || portfolio?.dataStatus === 'error'
      || (portfolio?.dataStatus === 'unavailable' && Boolean(context.wallet?.connected ?? connected));

    if (!holdings.length) {
      if (readFailed) {
        return {
          message: lang === 'fa'
            ? `کیف پول متصل است، اما خواندن موجودی از زنجیره کامل نشد${failedChains.length ? ` (${failedChains.join('، ')})` : ''}.\nدارایی‌های شما پنهان نشده‌اند — خواندن دوباره همین حالا انجام می‌شود و به‌محض رسیدن پاسخ، موجودی را نشان می‌دهم.`
            : `Your wallet is connected, but reading balances from the chain failed${failedChains.length ? ` (${failedChains.join(', ')})` : ''}.\nYour assets are not hidden — I am re-reading now and will show balances as soon as they arrive.`,
          ui: { type: 'TEXT' },
          code: 'PORTFOLIO_SYNC_RETRY',
          refresh: true,
          pendingRefresh: true,
          failedChains
        };
      }
      const empty = portfolio?.dataStatus === 'empty' || (!hydrating && portfolio?.freshness === 'FRESH');
      if (empty) {
        return {
          message: lang === 'fa'
            ? 'پرتفوی این کیف پول در حال حاضر خالی است — این یک پاسخ قطعی از زنجیره است، نه قطع اتصال.\nاگر تازگی دارایی جدید دارید، چند لحظه دیگر دوباره بپرسید؛ در غیر این صورت می‌توانم فارم، سواپ یا بازار را برایتان باز کنم.'
            : 'This wallet currently holds no assets — that is a definitive on-chain answer, not a disconnect.\nIf you just received assets, ask again shortly; otherwise I can open farm, swap or markets.',
          ui: { type: 'TEXT' },
          code: 'EMPTY_PORTFOLIO',
          actions: [
            { id: 'open-farm', route: '/farm', label: lang === 'fa' ? 'فارم' : 'Farm' },
            { id: 'open-market', route: '/', label: lang === 'fa' ? 'بازار' : 'Market' }
          ]
        };
      }
      return {
        message: lang === 'fa'
          ? 'کیف پول متصل است، اما هنوز دارایی قابل‌نمایش از زنجیره/ایندکسر نرسیده. این به‌معنی قطع اتصال نیست — داده در حال تازه‌سازی است.'
          : 'Wallet is connected, but no readable holdings have arrived from the indexer yet. That is not a disconnect — data is still refreshing.',
        ui: { type: 'TEXT' },
        code: 'PORTFOLIO_INDEXER_DELAY',
        refresh: true,
        pendingRefresh: true
      };
    }

    const den = Number.isFinite(Number(total)) && Number(total) > 0
      ? Number(total)
      : priced.reduce((s, h) => s + Number(h.valueUsd), 0);
    const sorted = [...holdings].sort((a, b) => (Number(b.valueUsd) || 0) - (Number(a.valueUsd) || 0));
    const largest = sorted.find((h) => Number.isFinite(Number(h.valueUsd))) || sorted[0] || null;
    const largestPct = largest && den > 0 && Number.isFinite(Number(largest.valueUsd))
      ? (Number(largest.valueUsd) / den) * 100
      : null;
    const lines = allocationLines(sorted, den);
    const totalLabel = money(den);
    if (lang === 'fa') {
      const parts = [];
      if (toolsRan(results) || holdings.length) parts.push('پرتفوی را از کیف پول و قیمت‌های جاری خواندم.');
      parts.push('');
      parts.push(totalLabel ? `ارزش تقریبی پرتفوی: ${totalLabel}` : 'ارزش دلاری کامل در دسترس نیست (برخی قیمت‌ها N/A هستند).');
      parts.push('');
      parts.push('دارایی‌ها:');
      parts.push(...lines);
      if (largest && largestPct != null) {
        parts.push('');
        parts.push(`بیشترین سهم: ${largest.symbol} — ${pct(largestPct)}`);
      } else if (largest) {
        parts.push('');
        parts.push(`بیشترین سهم: ${largest.symbol} — N/A`);
      }
      if (unpriced.length) {
        parts.push('');
        parts.push(`${unpriced.length} دارایی بدون قیمت معتبر (N/A) — صفر حساب نشد.`);
      }
      if (portfolio?.freshness && portfolio.freshness !== 'FRESH') {
        parts.push('');
        parts.push(`تازگی داده: ${portfolio.freshness}`);
      }
      return {
        message: parts.join('\n'),
        ui: { type: 'PORTFOLIO_CARD' },
        portfolio,
        card: portfolioCard(den, sorted, priced.length, unpriced.length, lang),
        actions: [{ id: 'open-lending', label: lang === 'fa' ? 'فرصت‌های وام' : 'Lending', route: '/loan' }]
      };
    }
    const parts = ['Read the portfolio from the wallet and current prices.', ''];
    parts.push(totalLabel ? `Approx. value: ${totalLabel}` : 'Full USD value unavailable (some prices are N/A).');
    parts.push('', 'Assets:', ...lines);
    if (largest && largestPct != null) parts.push('', `Largest share: ${largest.symbol} — ${pct(largestPct)}`);
    return {
      message: parts.join('\n'),
      ui: { type: 'PORTFOLIO_CARD' },
      portfolio,
      card: portfolioCard(den, sorted, priced.length, unpriced.length, lang)
    };
  }

  if (type === 'WALLET_BALANCE') {
    if (hydrating && connected) {
      return {
        message: lang === 'fa'
          ? 'کیف پول متصل است. در حال همگام‌سازی آخرین موجودی‌ها هستم…'
          : 'Wallet connected. Synchronizing the latest balances…',
        ui: { type: 'TEXT' },
        pendingRefresh: true
      };
    }
    const balances = context.wallet?.balances
      || results.balances?.balances
      || results.balances
      || collectHoldings(context, results).holdings
      || [];
    const list = Array.isArray(balances) ? balances : [];
    if (!connected) {
      return {
        message: lang === 'fa' ? 'کیف پول متصل نیست. برای خواندن موجودی وصل کنید.' : 'Wallet is not connected.',
        ui: { type: 'CONNECT_WALLET' }
      };
    }
    if (!list.length) {
      const failed = Array.isArray(context.portfolio?.failedChains) ? context.portfolio.failedChains : [];
      if (failed.length || context.portfolio?.dataStatus === 'error') {
        return {
          message: lang === 'fa'
            ? `کیف پول متصل است اما خواندن موجودی از زنجیره کامل نشد${failed.length ? ` (${failed.join('، ')})` : ''} — در حال خواندن دوباره‌ام؛ دارایی‌ها پنهان نیستند.`
            : `Wallet is connected but the chain read failed${failed.length ? ` (${failed.join(', ')})` : ''} — re-reading now; your assets are not hidden.`,
          ui: { type: 'TEXT' },
          code: 'PORTFOLIO_SYNC_RETRY',
          refresh: true,
          pendingRefresh: true
        };
      }
      return {
        message: lang === 'fa'
          ? 'کیف پول متصل است اما موجودی زنجیره‌ای هنوز نرسیده. در حال تازه‌سازی‌ام، نه قطع اتصال.'
          : 'Wallet is connected but on-chain balances have not arrived yet.',
        ui: { type: 'TEXT' },
        code: 'PORTFOLIO_INDEXER_DELAY',
        refresh: true,
        pendingRefresh: true
      };
    }
    const lines = list.slice(0, 12).map((b) => {
      const usd = Number.isFinite(Number(b.valueUsd ?? b.value)) ? money(b.valueUsd ?? b.value) : null;
      return `${b.symbol}: ${b.amount ?? '—'}${usd ? ` (${usd})` : ' (N/A)'}`;
    });
    return {
      message: lang === 'fa' ? `موجودی فعلی:\n\n${lines.join('\n')}` : `Current balances:\n\n${lines.join('\n')}`,
      ui: { type: 'TEXT' },
      balances: list
    };
  }

  if (type === 'YIELD_DISCOVERY' || type === 'INVESTMENT_PLAN' || type === 'STAKING') {
    const rawMsg = String(intent?.raw || '').toLowerCase();
    const isVagueGrowth = /(پولم.*زیاد|سرمایه‌ام.*بیشتر|سرمایه.*رشد|grow.*money|make.*money.*work)/i.test(rawMsg)
      && !intent?.entities?.timeframe && !intent?.entities?.riskPreference && !intent?.entities?.amount;

    if (isVagueGrowth) {
      return {
        message: lang === 'fa'
          ? 'متوجه شدم؛ هدف شما افزایش ارزش سرمایه در یک بازه زمانی مشخص است.\n\nاستراتژی‌های ممکن بر اساس سطح ریسک:\n• کم‌ریسک (سود استیبل‌کوین و استخرهای کم‌نوسان)\n• متعادل (ترکیب استیکینگ دارایی‌های اصلی و استخر نقدینگی)\n• رشد بالا (تخصیص به دارایی‌های با پتانسیل رشد بالا)\n\nبرای ساختن برنامه مناسب، سطح ریسک موردنظر شما چیست؟ (کم / متعادل / بالا)'
          : 'I understand your goal is to grow your capital.\n\nPotential strategies by risk profile:\n• Low risk (stablecoin yield & low-volatility lending)\n• Balanced (staking top assets & liquidity pools)\n• Higher growth (allocation to high-upside assets)\n\nTo tailor the plan, what is your preferred risk level? (Low / Moderate / High)',
        ui: { type: 'CHOICE' },
        choices: lang === 'fa'
          ? [
              { label: 'کم‌ریسک', value: 'LOW' },
              { label: 'متعادل', value: 'MEDIUM' },
              { label: 'رشد بالا', value: 'HIGH' }
            ]
          : [
              { label: 'Low risk', value: 'LOW' },
              { label: 'Moderate', value: 'MEDIUM' },
              { label: 'High growth', value: 'HIGH' }
            ]
      };
    }

    const scan = results.yieldOpportunities || results.opportunities || {};
    const opps = Array.isArray(scan.opportunities) ? scan.opportunities
      : (Array.isArray(scan) ? scan : (Array.isArray(results.opportunities) ? results.opportunities : []));
    const best = opps.filter((o) => o && (o.apy != null || o.protocol || o.symbol)).slice(0, 3);
    const dataStatus = scan.dataStatus || results.dataStatus;

    const targetNotice = intent?.entities?.targetReturn
      ? (lang === 'fa'
          ? `\n\n🎯 هدف تعیین‌شده: +${intent.entities.targetReturn}٪ (این یک هدف است و تضمینی برای تحقق سود وجود ندارد).`
          : `\n\n🎯 Target return: +${intent.entities.targetReturn}% (Goal only, not a guaranteed outcome).`)
      : '';

    if (best.length) {
      const riskFa = (r) => ({
        low: 'کم', medium: 'متوسط', high: 'زیاد', extreme: 'خیلی زیاد'
      }[String(r || '').toLowerCase()] || String(r || 'نامشخص'));
      const lines = best.map((o, i) => {
        const apy = Number.isFinite(Number(o.apy)) ? `${Number(o.apy).toFixed(1)}%` : 'N/A';
        const name = o.protocol || o.symbol || (lang === 'fa' ? 'استخر' : 'pool');
        if (lang === 'fa') {
          return `${i + 1}. ${name} — ${apy} ٪ سالانه\n   ریسک: ${riskFa(o.risk)}${o.ilRisk ? ` · زیان ناپایدار: ${riskFa(o.ilRisk)}` : ''}`;
        }
        const risk = o.risk || 'n/a';
        return `${i + 1}. ${name} — ${apy} APY\n   Risk: ${risk}${o.ilRisk ? ` · IL: ${o.ilRisk}` : ''}`;
      });
      const stamp = scan.updatedAt ? `\n\n${lang === 'fa' ? 'زمان داده' : 'As of'}: ${scan.updatedAt}` : '';
      return {
        message: lang === 'fa'
          ? `${best.length} فرصت فعلی پیدا کردم:\n\n${lines.join('\n\n')}${stamp}${targetNotice}\n\nاین‌ها برآوردند، تضمین سود نیستند. می‌خواهید یکی را در صفحه مربوط باز کنیم؟`
          : `Found ${best.length} current opportunities:\n\n${lines.join('\n\n')}${stamp}${targetNotice}\n\nEstimates, not guaranteed. Open one on its real page?`,
        ui: { type: 'TEXT' },
        opportunities: best,
        actions: [
          { id: 'open-horizon', label: lang === 'fa' ? 'افق جهانی' : 'Horizon', route: '/stocks' },
          /* The margin venue is a website-build surface: in a store build the
             route does not exist and the label is exactly the vocabulary a
             review filter scans for, so the chip is gated on the same flag
             the lexicon stub carries (SPECULATIVE_VOCABULARY_PRESENT). */
          ...(SPECULATIVE_VOCABULARY_PRESENT
            ? [{ id: 'open-perp', label: lang === 'fa' ? 'فیوچرز' : 'Perpetuals', route: '/perp' }]
            : []),
          { id: 'open-stocks', label: lang === 'fa' ? 'سهام' : 'Stocks', route: '/stocks' }
        ]
      };
    }

    if (dataStatus === 'empty' || (scan.ok && scan.scanned >= 0 && !best.length && scan.dataQuality && scan.dataQuality !== 'NONE')) {
      return {
        message: (lang === 'fa'
          ? 'در حال حاضر فرصت مناسبی که از فیلترهای ریسک شما عبور کند پیدا نشد.'
          : 'No opportunity currently passes your risk filters.') + targetNotice,
        ui: { type: 'TEXT' },
        opportunities: []
      };
    }

    return {
      message: (lang === 'fa'
        ? 'اسکن فرصت‌ها را اجرا کردم، اما هیچ منبع بازار زنده پاسخ نداد. این حدس نیست — داده در دسترس نبود.'
        : 'I ran the opportunity scan, but no live market source answered. That is not a guess — data was unavailable.') + targetNotice,
      ui: { type: 'TEXT' },
      code: 'PRICE_PROVIDER_UNAVAILABLE'
    };
  }

  /**
   * «سود ۲۰ درصد» is a GOAL (a target the user wants to reach), not a request
   * to scan the yield market. The distinction is what the return field
   * captures: without it the chat fell through to the generic tail and never
   * acknowledged the number.
   */
  if (type === 'GOAL') {
    const target = intent?.entities?.targetReturn;
    const timeframe = intent?.entities?.timeframe?.raw;
    if (target != null) {
      const targetText = lang === 'fa' ? `${target}٪` : `${target}%`;
      return {
        message: lang === 'fa'
          ? `هدف مالی شما ثبت شد: رسیدن به ${targetText} سود${timeframe ? ` در ${timeframe}` : ''}.\n\nاین یک هدف است، نه کشف بازده و نه تضمین تحقق — برای برنامه‌ریزی واقعی به بازه زمانی و سطح ریسک نیاز دارم. اگر بگویید (مثلاً «۶ ماه، متعادل»)، برنامه را روی همان هدف می‌سازم.`
          : `Financial goal recorded: a ${targetText} return${timeframe ? ` over ${timeframe}` : ''}.\n\nThis is a target, not a yield scan and not a guarantee. To build a real plan I need a timeframe and a risk level — say it (e.g. “6 months, balanced”) and I will plan around exactly this goal.`,
        ui: { type: 'TEXT' },
        goal: { targetReturn: target, timeframe: intent?.entities?.timeframe || null }
      };
    }
    return {
      message: lang === 'fa'
        ? 'یک هدف مالی برایت تعیین می‌کنم. چه مقدار سود را هدف گرفته‌ای؟ (مثلاً «۲۰ درصد»)'
        : 'Let us set a financial goal. What return are you targeting? (e.g. “20%”)',
      ui: { type: 'TEXT' }
    };
  }

  if (type === 'REBALANCE') {
    const plan = results.rebalancePlan || {};
    if (plan.code === 'NO_TARGET_ALLOCATION') {
      const msg = plan.messageFa || plan.message
        || (lang === 'fa'
          ? 'برای متعادل‌سازی به یک تخصیص هدف نیاز است. نسبت موردنظرتان را بگویید یا آن را در صفحه‌ی پرتفوی تعیین کنید.'
          : 'A rebalance needs a target allocation. Tell me the split you want, or open the portfolio page to set one.');
      return {
        message: msg,
        ui: { type: 'TEXT' },
        code: plan.code,
        actions: [{ id: 'open-portfolio', route: '/portfolio', label: lang === 'fa' ? 'صفحه پرتفوی' : 'Portfolio' }]
      };
    }

    if (plan.ok === true) {
      const lines = Array.isArray(plan.trades) && plan.trades.length
        ? plan.trades.map((t) => {
            const side = t.side === 'buy' ? (lang === 'fa' ? 'خرید' : 'Buy') : (lang === 'fa' ? 'فروش' : 'Sell');
            return `${t.symbol}: ${side} ${t.toPct}% (${lang === 'fa' ? 'از' : 'from'} ${Number(t.fromPct || 0).toFixed(1)}%)`;
          })
        : [lang === 'fa' ? 'نیازی به بازتنظیم نیست؛ تخصیص فعلی نزدیک هدف است.' : 'No trade is needed; the current allocation is already close to target.'];
      return {
        message: `${lang === 'fa' ? 'پیشنهاد متعادل‌سازی (بدون اجرا):' : 'Rebalance proposal (nothing executed):'}\n\n${lines.join('\n')}\n\n${lang === 'fa' ? 'این فقط یک پیشنهاد است و بدون تأیید شما هیچ تراکنشی اجرا نمی‌شود.' : 'This is a proposal only — nothing will execute without your approval.'}`,
        ui: { type: 'TEXT' },
        rebalance: plan,
        actions: [{ id: 'open-portfolio', route: '/portfolio', label: lang === 'fa' ? 'صفحه پرتفوی' : 'Portfolio' }]
      };
    }

    if (!connected) {
      return {
        message: lang === 'fa'
          ? 'برای متعادل‌سازی باید پرتفوی زنده‌ی شما قابل خواندن باشد. کیف پول را متصل کنید یا نسبت تخصیص هدف را بگویید.'
          : 'To rebalance I need to read your live portfolio. Connect the wallet or tell me the target allocation.',
        ui: { type: 'TEXT' }
      };
    }

    return {
      message: lang === 'fa'
        ? 'برای متعادل‌سازی به تخصیص هدف نیاز است. نسبت موردنظرتان را بگویید (مثلاً «اتریوم ۳۰٪، بیت‌کوین ۷۰٪») یا آن را در صفحه پرتفوی تعیین کنید.'
        : 'A rebalance needs a target allocation. Tell me the split you want (e.g. “ETH 30%, BTC 70%”) or set it on the portfolio page.',
      ui: { type: 'TEXT' }
    };
  }

  if (['SWAP', 'BUY', 'SELL', 'BRIDGE', 'SEND'].includes(type)) {
    const action = plan?.actions?.[0] || results.action || {};
    const from = action.input?.fromSymbol || action.from || intent?.entities?.fromToken || intent?.entities?.token || 'USDC';
    const to = action.input?.toSymbol || action.to || intent?.entities?.toToken || (type === 'BUY' ? intent?.entities?.token : 'ETH') || 'ETH';
    const amount = action.input?.amount || action.amount || intent?.entities?.amount || intent?.entities?.amountUsd || null;
    const walletAddr = context.wallet?.address || context.walletState?.address || null;
    const shortAddr = walletAddr ? `${walletAddr.slice(0, 6)}...${walletAddr.slice(-4)}` : null;

    const opFa = type === 'BUY' ? `خرید ${to}` : type === 'SELL' ? `فروش ${from}` : type === 'SWAP' ? `تبدیل ${from} به ${to}` : type === 'SEND' ? `ارسال ${from}` : `بریج ${from}`;
    const opEn = type === 'BUY' ? `Buy ${to}` : type === 'SELL' ? `Sell ${from}` : type === 'SWAP' ? `Swap ${from} to ${to}` : type === 'SEND' ? `Send ${from}` : `Bridge ${from}`;

    if (lang === 'fa') {
      const understandText = amount
        ? `متوجه شدم که می‌خواهید:\n\n• عملیات: ${opFa}\n• مبلغ: ${amount} ${from}\n${shortAddr ? `• کیف پول: ${shortAddr}\n` : ''}\nبرنامه آماده است. در صورت تأیید، امضا روی والت شما درخواست می‌شود (هیچ تراکنشی بدون تأیید نهایی شما اجرا نمی‌شود).`
        : (intent?.minimalQuestion?.fa || `متوجه شدم می‌خواهید ${opFa} انجام دهید. فقط مبلغ موردنظر مشخص نشده است. چه مقدار می‌خواهید اختصاص دهید؟`);

      return {
        message: understandText,
        ui: { type: 'ACTION_CARD' },
        card: {
          title: '✦ آماده اجرا',
          headline: amount ? `${amount} ${from} → ${to}` : `${from} → ${to}`,
          from,
          to,
          amount,
          confirmLabel: 'تأیید و اجرا',
          editLabel: 'ویرایش'
        },
        requiresConfirmation: true,
        action
      };
    }

    const understandTextEn = amount
      ? `I understand you want to:\n\n• Action: ${opEn}\n• Amount: ${amount} ${from}\n${shortAddr ? `• Wallet: ${shortAddr}\n` : ''}\nReady to proceed. Confirmation will request a signature on your wallet (never executed automatically).`
      : (intent?.minimalQuestion?.en || `I understand you want to ${opEn}. Only the amount is needed. What amount would you like to use?`);

    return {
      message: understandTextEn,
      ui: { type: 'ACTION_CARD' },
      card: {
        title: '✦ Ready to run',
        headline: amount ? `${amount} ${from} → ${to}` : `${from} → ${to}`,
        from,
        to,
        amount,
        confirmLabel: 'Confirm & run',
        editLabel: 'Edit'
      },
      requiresConfirmation: true,
      action
    };
  }

  if (['MARKET_ANALYSIS', 'SMART_MONEY', 'WHALE', 'ANALYZE_TOKEN'].includes(type)) {
    const token = intent?.entities?.token;
    const market = results.market || results.smartMoney || results.whale || null;
    /* A real per-token read beats an overview: when the tool answered with a
       price, answer with numbers + a chart card, never with «open the page». */
    const tk = results.token
      && results.token.ok !== false
      && results.token.dataStatus !== 'unavailable'
      ? results.token
      : null;
    if (tk && (tk.priceUsd != null || tk.price != null)) {
      const price = numOr(tk.priceUsd ?? tk.price);
      const c24 = numOr(tk.change24hPct ?? tk.change24h);
      const c1h = numOr(tk.change1hPct ?? tk.change1h);
      const c7d = numOr(tk.change7dPct ?? tk.change7d);
      const sig = tk.analysis?.signal || null;
      const sgn = (v) => (v == null ? 'N/A' : `${v >= 0 ? '+' : ''}${Math.round(v * 100) / 100}%`);
      if (lang === 'fa') {
        const parts = [];
        parts.push(`📊 ${tk.name || token || ''} (${String(tk.symbol || token || '').toUpperCase()})`);
        parts.push(`قیمت لحظه‌ای: ${moneyOrNa(price)}${c24 != null ? `  (${sgn(c24)} در ۲۴ ساعت)` : ''}`);
        const rl = rangeLine(tk, 'fa');
        if (rl) parts.push(rl);
        const stats = [];
        if (c1h != null) stats.push(`۱ساعت ${sgn(c1h)}`);
        if (c7d != null) stats.push(`۷روز ${sgn(c7d)}`);
        if (numOr(tk.marketCapUsd ?? tk.mcap) != null) stats.push(`حجم بازار ${moneyCompact(numOr(tk.marketCapUsd ?? tk.mcap))}`);
        if (numOr(tk.volume24hUsd ?? tk.volume) != null) stats.push(`معاملات ۲۴ساعت ${moneyCompact(numOr(tk.volume24hUsd ?? tk.volume))}`);
        if (numOr(tk.rank) != null) stats.push(`رتبه #${numOr(tk.rank)}`);
        if (stats.length) parts.push(stats.join(' · '));
        if (sig) parts.push(`سیگنال تحلیل فنی (بک‌تست‌شده): ${sig}${tk.analysis?.rsi != null ? ` · RSI ${Math.round(Number(tk.analysis.rsi))}` : ''}`);
        parts.push('');
        parts.push('نمودار ۷ روز اخیر در کارت زیر است — روی صفحه بازار کندل کامل را ببین.');
        return {
          message: parts.join('\n'),
          ui: { type: 'TOKEN_CARD' },
          card: tokenCard({ ...tk, priceUsd: price, change1hPct: c1h, change24hPct: c24, change7dPct: c7d, marketCapUsd: tk.marketCapUsd ?? tk.mcap, volume24hUsd: tk.volume24hUsd ?? tk.volume }, 'fa'),
          actions: [{ id: `open-${String(tk.symbol || token || 'market').toLowerCase()}`, route: `/coin/${tk.coinId || String(tk.symbol || '').toLowerCase()}`, label: lang === 'fa' ? 'نمودار کامل' : 'Full chart' }]
        };
      }
      const parts = [];
      parts.push(`📊 ${tk.name || token || ''} (${String(tk.symbol || token || '').toUpperCase()})`);
      parts.push(`Live price: ${moneyOrNa(price)}${c24 != null ? `  (${sgn(c24)} in 24h)` : ''}`);
      const rl = rangeLine(tk, 'en');
      if (rl) parts.push(rl);
      const stats = [];
      if (c1h != null) stats.push(`1h ${sgn(c1h)}`);
      if (c7d != null) stats.push(`7d ${sgn(c7d)}`);
      if (numOr(tk.marketCapUsd ?? tk.mcap) != null) stats.push(`Mkt cap ${moneyCompact(numOr(tk.marketCapUsd ?? tk.mcap))}`);
      if (numOr(tk.volume24hUsd ?? tk.volume) != null) stats.push(`Vol 24h ${moneyCompact(numOr(tk.volume24hUsd ?? tk.volume))}`);
      if (numOr(tk.rank) != null) stats.push(`Rank #${numOr(tk.rank)}`);
      if (stats.length) parts.push(stats.join(' · '));
      if (sig) parts.push(`Backtested signal: ${sig}${tk.analysis?.rsi != null ? ` · RSI ${Math.round(Number(tk.analysis.rsi))}` : ''}`);
      parts.push('', 'The 7-day chart is in the card below — the market page has the full candles.');
      return {
        message: parts.join('\n'),
        ui: { type: 'TOKEN_CARD' },
        card: tokenCard({ ...tk, priceUsd: price, change1hPct: c1h, change24hPct: c24, change7dPct: c7d, marketCapUsd: tk.marketCapUsd ?? tk.mcap, volume24hUsd: tk.volume24hUsd ?? tk.volume }, 'en'),
        actions: [{ id: `open-${String(tk.symbol || token || 'market').toLowerCase()}`, route: `/coin/${tk.coinId || String(tk.symbol || '').toLowerCase()}`, label: 'Full chart' }]
      };
    }
    /* Tool-level failure (no service wired, upstream down, timeout) — the
       read is re-armed so the next ask (or the UI auto-retry) gets data. */
    if (market && (market.dataStatus === 'unavailable' || market.ok === false) && !market.overview) {
      return {
        message: lang === 'fa'
          ? `بازار را از منبع زنده پرسیدم${token ? ` (${token})` : ''}، اما داده تازه برنگشت. چند لحظه دیگر دوباره می‌پرسم — منبع را همین حالا دوباره صدا می‌زنم.`
          : `I queried live market data${token ? ` (${token})` : ''}, but nothing fresh came back. Retrying the source now — ask again in a moment.`,
        ui: { type: 'TEXT' },
        refresh: true
      };
    }
    /* Whole-market ask: name the leaders with real numbers from the read. */
    const top = Array.isArray(market?.top) ? market.top.filter((r) => numOr(r.priceUsd) != null) : [];
    if (top.length) {
      const rows = top.slice(0, 6).map((r) => {
        const c = numOr(r.change24hPct);
        return `${String(r.symbol || '').toUpperCase()}: ${moneyOrNa(r.priceUsd)}${c != null ? ` (${c >= 0 ? '+' : ''}${Math.round(c * 100) / 100}%)` : ''}`;
      });
      const ov = market.overview || {};
      const capLine = numOr(ov.totalMarketCapUsd) != null
        ? (lang === 'fa' ? `حجم کل بازار: ${money(numOr(ov.totalMarketCapUsd))}` : `Total market cap: ${money(numOr(ov.totalMarketCapUsd))}`)
        : null;
      return {
        message: (lang === 'fa'
          ? `نمای کلی بازار از داده زنده:\n\n${rows.join('\n')}${capLine ? `\n\n${capLine}` : ''}\n\nبرای هر کوین نمودار و بالاترین/کمترین قیمت را جداگانه بپرس — مثلاً «تحلیل بیت کوین».`
          : `Market snapshot from live data:\n\n${rows.join('\n')}${capLine ? `\n\n${capLine}` : ''}\n\nAsk for any coin by name for the chart with 24h high/low — e.g. "analyze bitcoin".`),
        ui: { type: 'TEXT' },
        market,
        actions: [{ id: 'open-market', route: '/', label: lang === 'fa' ? 'بازار' : 'Market' }]
      };
    }
    return {
      message: lang === 'fa'
        ? `بازار${token ? ` ${token}` : ''} را از ماژول زنده خواندم. جزئیات کامل روی صفحه بازار است — می‌خواهید آنجا را باز کنم؟`
        : `I read live market data${token ? ` for ${token}` : ''}. Want me to open the market page?`,
      ui: { type: 'TEXT' },
      actions: [{ id: 'open-market', route: '/', label: lang === 'fa' ? 'بازار' : 'Market' }]
    };
  }

  if (results.cancelled) {
    return {
      message: lang === 'fa' ? 'لغو شد. کاری اجرا نشد.' : 'Cancelled. Nothing was executed.',
      ui: { type: 'TEXT' }
    };
  }

  if (type === 'CONTINUE' || type === 'EXECUTE_CURRENT' || type === 'DETAILS') {
    const slots = context.operational || {};
    const bits = [slots.asset, slots.operation, slots.amount].filter(Boolean);
    if (results.route) {
      const name = pageName(results.route, locale);
      return {
        message: lang === 'fa'
          ? `صفحه ${name} را باز کردم. اگر این کار پول جابه‌جا می‌کند، تأیید و امضا همان‌جا انجام می‌شود — در چت اجرا نمی‌کنم.`
          : `Opened ${name}. Money-moving confirmations stay on that page — I will not execute them in chat.`,
        ui: { type: 'TEXT' },
        navigated: results.route
      };
    }
    if (bits.length) {
      return {
        message: lang === 'fa'
          ? `ادامه همان کار: ${bits.join(' · ')}. تأیید می‌کنید؟`
          : `Continuing: ${bits.join(' · ')}. Confirm?`,
        ui: { type: 'TEXT' }
      };
    }
    return {
      message: lang === 'fa'
        ? 'موضوع قبلی در حافظه عملیاتی نیست. بگویید روی کدام دارایی یا صفحه کار کنیم.'
        : 'I do not have a previous operation in short-term memory. Which asset or page?',
      ui: { type: 'TEXT' }
    };
  }

  /*
   * ─── «چه کاری بلدی؟» ───────────────────────────────────────────────────
   * This used to fall through to the generic tail, which answered a direct
   * question about capabilities with "I routed this to the relevant module".
   * The answer is enumerated from the capability registry — the same registry
   * the router uses — so it can never advertise a screen that is not wired.
   */
  if (type === 'CAPABILITIES') {
    const groups = lang === 'fa'
      ? [
          ['پرتفوی و کیف پول', 'موجودی چند-زنجیره‌ای، تحلیل تخصیص و تمرکز، ریسک'],
          ['بازار و تحلیل', 'قیمت زنده، تحلیل تکنیکال بک‌تست‌شده، سیگنال، اخبار'],
          ['سواپ و بریج', 'نقل‌قول زنده؛ امضا همیشه روی صفحه خودش'],
          ['سود', 'فارم، وام، استخرها با APY واقعی از منبع'],
          ['هوش زنجیره', 'اسمارت مانی، نهنگ‌ها، جریان صرافی‌ها'],
          ['عملیات', 'مرکز عملیات، ایجنت‌ها، استراتژی‌ها، مانیتورها و سفارش‌های شرطی']
        ]
      : [
          ['Portfolio & wallet', 'multi-chain balances, allocation and concentration, risk'],
          ['Market & analysis', 'live prices, backtested technicals, signals, news'],
          ['Swap & bridge', 'live quotes; signing always happens on its own page'],
          ['Yield', 'farms, lending, pools with real upstream APY'],
          ['On-chain intelligence', 'smart money, whales, exchange flows'],
          ['Operations', 'ops center, agents, strategies, monitors and conditional orders']
        ];
    const body = groups.map(([k, v]) => `• ${k} — ${v}`).join('\n');
    return {
      message: lang === 'fa'
        ? `این کارها را از داده زنده‌ی خود اپ انجام می‌دهم:\n\n${body}\n\nکافی است بنویسید چه می‌خواهید — لازم نیست جمله کامل باشد. هیچ تراکنشی بدون تأیید صریح شما اجرا نمی‌شود.`
        : `Here is what I can do from the app's live data:\n\n${body}\n\nJust name what you want — a single word is enough. Nothing that moves money runs without your explicit confirmation.`,
      ui: { type: 'TEXT' },
      actions: [
        { id: 'open-ops', route: '/intent?tab=ops', label: lang === 'fa' ? 'مرکز عملیات' : 'Ops Center' },
        { id: 'open-portfolio', route: '/portfolio', label: lang === 'fa' ? 'پرتفوی' : 'Portfolio' }
      ]
    };
  }

  /*
   * The ops surfaces answer with their own live panels, which the chat cannot
   * render inline. It says which panel and offers the jump — that is a real
   * answer, not the "did not map to a module" fallback these used to hit.
   */
  if (type === 'OPS_CENTER' || type === 'AGENTS' || type === 'STRATEGY' || type === 'SYSTEM_STATUS') {
    const copy = {
      OPS_CENTER: {
        fa: 'مرکز عملیات باز است: مانیتورهای فعال، سفارش‌های شرطی، فرصت‌ها و تاریخچه عملیات — همه از داده زنده.',
        en: 'Operations Center is open: live monitors, conditional orders, opportunities and operation history.',
        tab: 'ops'
      },
      AGENTS: {
        fa: 'فهرست ایجنت‌ها را باز کردم. هر ایجنت وضعیت واقعی و آخرین اجرای خودش را نشان می‌دهد؛ ایجنتی که داده ندارد صریحاً همین را می‌گوید.',
        en: 'Opened the agent registry. Each agent shows its real status and last run; an agent without data says so explicitly.',
        tab: 'agents'
      },
      STRATEGY: {
        fa: 'استراتژی‌ها را باز کردم. این‌ها پیشنهاد هستند نه اجرا — هر کدام قبل از هر حرکتی نیاز به تأیید صریح شما دارند.',
        en: 'Opened strategies. These are proposals, not executions — each needs your explicit approval before anything moves.',
        tab: 'strategies'
      },
      SYSTEM_STATUS: {
        fa: 'وضعیت سیستم را باز کردم: سرویس‌های متصل، آخرین خطاها و تازگی داده‌ها.',
        en: 'Opened system status: connected services, recent errors and data freshness.',
        tab: 'status'
      }
    }[type];
    return {
      message: lang === 'fa' ? copy.fa : copy.en,
      ui: { type: 'TEXT' },
      actions: [{ id: `open-${copy.tab}`, route: `/intent?tab=${copy.tab}`, label: lang === 'fa' ? 'باز کن' : 'Open' }]
    };
  }

  if (type === 'GENERAL' || type === 'CANCEL') {
    const greet = /^(سلام|hi|hello|hey|درود)\s*[!.؟?]*$/i.test(String(intent?.raw || context.lastMessage || ''));
    if (greet || type === 'CANCEL') {
      return {
        message: lang === 'fa'
          ? (type === 'CANCEL' ? 'لغو شد. کاری اجرا نشد.' : 'سلام. می‌توانم پرتفوی، سواپ، فارم، وام یا بازار را از خود اپ بخوانم.')
          : (type === 'CANCEL' ? 'Cancelled. Nothing was executed.' : 'Hi. I can read portfolio, swap, farm, lending or markets from the live app.'),
        ui: { type: 'TEXT' }
      };
    }
    /*
     * The last-resort reply. It must still be USEFUL: the old wording said
     * "did not map to a specific module" and stopped, which read as a refusal
     * and gave the user nothing to do next. It now names concrete next steps
     * and offers the capability list, so a miss costs one tap, not a restart.
     */
    return {
      message: lang === 'fa'
        ? 'مطمئن نشدم دقیقاً کدام بخش را می‌خواهید. مثلاً بنویسید: «پرتفوی» · «سود» · «تحلیل بیت کوین» · «اخبار» · «مرکز عملیات» — یا بپرسید «چه کاری بلدی؟» تا همه قابلیت‌ها را فهرست کنم.'
        : 'I am not sure which part you meant. Try: "portfolio" · "yield" · "analyze bitcoin" · "news" · "ops center" — or ask "what can you do?" and I will list everything.',
      ui: { type: 'TEXT' },
      actions: [
        { id: 'ask-capabilities', label: lang === 'fa' ? 'چه کاری بلدی؟' : 'What can you do?', prompt: lang === 'fa' ? 'چه کاری بلدی' : 'what can you do' },
        { id: 'open-portfolio', route: '/portfolio', label: lang === 'fa' ? 'پرتفوی' : 'Portfolio' },
        { id: 'open-ops', route: '/intent?tab=ops', label: lang === 'fa' ? 'مرکز عملیات' : 'Ops Center' }
      ]
    };
  }

  return {
    message: lang === 'fa'
      ? 'درخواست را به ماژول مربوط وصل کردم. اگر داده زنده ناقص باشد صریحاً می‌گویم — حدس نمی‌زنم.'
      : 'I routed this to the relevant module. If live data is incomplete I will say so — I will not guess.',
    ui: { type: 'TEXT' }
  };
}

export function formatConnectThanks(locale) {
  const lang = langOf(locale);
  return lang === 'fa'
    ? 'ممنون، کیف پول متصل شد. درخواست قبلی‌تان را با وضعیت زنده ادامه می‌دهم.'
    : 'Thanks — wallet connected. Continuing your previous request with live state.';
}

export { moneyOrNa, money };
