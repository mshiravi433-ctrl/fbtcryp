/**
 * FBT INTENT OS — Human Response Layer
 * Speak from REAL tool results. Never claim a check that did not run.
 * Missing price ≠ $0. Connected-but-empty ≠ disconnected.
 */

import { SPECULATIVE_VOCABULARY_PRESENT } from '../speculativeLexicon.js';
import { pageName } from './moduleRouter.js';
import { resolveChatRoute } from '../autonomy/chatRoutes.js';
import { parseGoalSpec } from '../../strategyBrain/goalSpec.js';
import { portfolioRiskScore } from '../commandCenter.js';
import { normalizeChainId } from '../contextResolver.js';

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

/* Human name for an in-place /intent* destination (the user is already here). */
function inPlaceName(route, lang) {
  const tab = (() => {
    try {
      const qi = String(route || '').indexOf('?');
      if (qi < 0) return '';
      return new URLSearchParams(String(route).slice(qi + 1)).get('tab') || '';
    } catch { return ''; }
  })().toLowerCase();
  const names = {
    ops: { fa: 'مرکز عملیات', en: 'the Operations Center' },
    operations: { fa: 'مرکز عملیات', en: 'the Operations Center' },
    agents: { fa: 'ایجنت‌ها', en: 'Agents' },
    strategies: { fa: 'استراتژی‌ها', en: 'Strategies' },
    status: { fa: 'وضعیت سیستم', en: 'System Status' },
    history: { fa: 'تاریخچه', en: 'History' },
    intelligence: { fa: 'هوش چندمدلی', en: 'Multi-AI Intelligence' },
    activity: { fa: 'فعالیت‌ها', en: 'Activity' },
    chat: { fa: 'چت', en: 'the chat' }
  };
  const hit = names[tab];
  if (hit) return lang === 'fa' ? hit.fa : hit.en;
  return lang === 'fa' ? 'همین صفحه' : 'this page';
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
  if (!hasNumber(n)) return 'N/A';
  const v = Number(n);
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

const hasNumber = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const positiveUsd = (value) => hasNumber(value) && Number(value) > 0;

function hasPortfolioHolding(row) {
  if (!row || typeof row !== 'object') return false;
  if (positiveUsd(row.valueUsd)) return true;
  if (!hasNumber(row.amount)) return true;
  return Number(row.amount) > 1e-9;
}

function allocationLines(holdings, total) {
  const priced = holdings.filter((h) => positiveUsd(h.valueUsd));
  const pricedTotal = priced.reduce((s, h) => s + Number(h.valueUsd), 0);
  const den = pricedTotal > 0 ? pricedTotal : (positiveUsd(total) ? Number(total) : 0);
  return holdings.slice(0, 8).map((h) => {
    const value = positiveUsd(h.valueUsd) ? money(h.valueUsd) : null;
    const share = value && den > 0 ? pct((Number(h.valueUsd) / den) * 100) : null;
    const amount = hasNumber(h.amount) ? String(h.amount) : '';
    const network = h.chainName || h.network || (h.chainId != null ? String(h.chainId) : '');
    if (!value) return `${h.symbol || '—'}${network ? ` (${network})` : ''}${amount ? `  ${amount}` : ''}   N/A`;
    return `${String(h.symbol || '—')}${network ? ` (${network})` : ''} ${value}   ${share || ''}`.trim();
  });
}

function toolsRan(results = {}) {
  return Array.isArray(results.toolsUsed) && results.toolsUsed.length > 0;
}

function amountUnits(amount, decimals) {
  const dec = Number(decimals);
  const text = String(amount ?? '').trim().replace(/,/g, '');
  if (!/^\d+(?:\.\d+)?$/.test(text) || !Number.isInteger(dec) || dec < 0 || dec > 36) return null;
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > dec) return null;
  try { return BigInt(`${whole}${(fraction + '0'.repeat(dec)).slice(0, dec)}`); }
  catch { return null; }
}

function formatAmountUnits(raw, decimals) {
  const dec = Number(decimals);
  if (!Number.isInteger(dec) || dec < 0 || dec > 36) return null;
  let value;
  try { value = BigInt(raw); } catch { return null; }
  const base = 10n ** BigInt(dec);
  const whole = (value / base).toString();
  const fraction = dec ? (value % base).toString().padStart(dec, '0').replace(/0+$/, '') : '';
  return fraction ? `${whole}.${fraction}` : whole;
}

function decimalScaled(value, decimals = 8) {
  const text = String(value ?? '').trim().replace(/,/g, '');
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > decimals) return null;
  try { return BigInt(`${whole}${(fraction + '0'.repeat(decimals)).slice(0, decimals)}`); }
  catch { return null; }
}

function usdToTokenAmount(usd, priceUsd, decimals) {
  const usdScaled = decimalScaled(usd, 8);
  const priceScaled = decimalScaled(Number(priceUsd).toFixed(8), 8);
  const dec = Number(decimals);
  if (usdScaled == null || priceScaled == null || priceScaled <= 0n
    || !Number.isInteger(dec) || dec < 0 || dec > 36) return null;
  const raw = (usdScaled * (10n ** BigInt(dec))) / priceScaled;
  return raw > 0n ? formatAmountUnits(raw, dec) : null;
}

function lendingChainId(intent = {}, context = {}, scan = {}) {
  const entities = intent?.entities || {};
  return normalizeChainId(
    entities.chainIds?.[0]
      ?? entities.network
      ?? entities.chainId
      ?? scan.chainId
      ?? context.wallet?.chainId
  );
}

function lendingReviewResponse({ type, intent = {}, context = {}, results = {}, lang = 'fa' } = {}) {
  const fa = lang === 'fa';
  const scan = results.yieldOpportunities || {};
  const side = type === 'BORROW' ? 'borrow' : 'supply';
  const entities = intent.entities || {};
  const chainId = lendingChainId(intent, context, scan);
  const rawAssetUnit = String(entities.amountSymbol || '').toUpperCase();
  const asset = rawAssetUnit && !['USD', '$', 'TOMAN'].includes(rawAssetUnit)
    ? rawAssetUnit
    : String(entities.token || entities.asset || '').toUpperCase() || null;
  const rows = (Array.isArray(scan.lendingMarkets) ? scan.lendingMarkets : [])
    .filter((row) => chainId == null || Number(row?.chainId) === Number(chainId));
  const supportedMarkets = (Array.isArray(scan.supportedLendingMarkets) ? scan.supportedLendingMarkets : [])
    .filter((row) => chainId == null || Number(row?.chainId) === Number(chainId));
  const displayData = {
    status: scan.lendingDataStatus || scan.dataStatus || 'unavailable',
    operation: side,
    chainId,
    source: scan.lendingSource || 'aave-rpc',
    fetchedAt: scan.lendingFetchedAt || scan.updatedAt || null,
    markets: rows,
    supportedMarkets
  };
  const raw = String(intent.raw || context.lastMessage || '').trim();
  const questionMark = /[?؟]\s*$/.test(raw);
  const questionType = String(intent.questionType || '').toUpperCase();
  const command = side === 'supply'
    ? /(\bsupply\b|\blend\b|\bdeposit\b|سپرده[‌\s]*(?:کن|بگذار|بذار|گذار|گذاری)|وام[‌\s]*بده|لند[‌\s]*کن|واریز[‌\s]*کن)/i.test(raw)
    : /(\bborrow\b|\btake\s+out\s+(?:a\s+)?loan\b|وام[‌\s]*بگیر|قرض[‌\s]*بگیر|اعتبار[‌\s]*بگیر)/i.test(raw);
  const questionOnly = questionMark || ['RECOMMENDATION', 'INFORMATION', 'MARKET_QUERY', 'BALANCE_QUERY'].includes(questionType);
  const actionRequested = !questionOnly && (intent.executionRequested === true || command);
  const noAction = (message, code, missingInfo = null, ui = { type: 'TEXT' }) => ({
    message,
    ui,
    code,
    handledLocally: true,
    missingInfo,
    yieldMarkets: displayData,
    requiresConfirmation: false,
    actions: []
  });

  if (type === 'FARM') {
    const farmRows = (Array.isArray(scan.opportunities) ? scan.opportunities : [])
      .filter((row) => row?.kind === 'farm' && ['live', 'partial'].includes(String(row.rateStatus || row.dataStatus || '').toLowerCase()));
    const observed = farmRows.length
      ? (fa
        ? `\n\nدادهٔ قابل‌خواندن برای ${farmRows.length} فرصت فارم/LP در کارت فرصت‌ها آمده است؛ این نرخ‌ها مشاهده‌شده‌اند و تضمین سود نیستند.`
        : `\n\n${farmRows.length} readable farm/LP opportunity row(s) are shown below; observed rates are not guaranteed returns.`)
      : '';
    return {
      message: (fa
        ? 'برای FARM، اتصال زنده و قابل‌تأییدِ استخر LP/فارم در این چت موجود نیست. سپردهٔ تک‌دارایی Aave با فارم LP یکی نیست؛ نرخ Aave را به‌عنوان فارم معرفی نمی‌کنم. هیچ کارت اجرا یا تراکنشی ساخته نشده است. صفحهٔ فارم را فقط برای بررسی گزینه‌های موجود می‌توانی باز کنی.'
        : 'This chat has no verified live LP/farm execution adapter. A single-asset Aave supply is not LP farming, so I will not label an Aave rate as farm yield. No execution card or transaction was created. Open the farm page only to inspect available options.') + observed,
      ui: { type: 'TEXT' },
      code: farmRows.length ? 'FARM_EXECUTOR_UNAVAILABLE' : 'FARM_DATA_UNAVAILABLE',
      handledLocally: true,
      opportunities: farmRows,
      requiresConfirmation: false,
      actions: [{ id: 'inspect-farm', route: '/farm', label: fa ? 'بررسی صفحهٔ فارم' : 'Inspect farm page' }]
    };
  }

  if (!actionRequested) {
    const relevant = rows.filter((row) => {
      const rate = side === 'borrow' ? row.borrowApyPct : row.supplyApyPct;
      const status = side === 'borrow' ? row.borrowRateStatus : row.rateStatus;
      return rate != null || ['stale', 'unavailable', 'partial'].includes(String(status || '').toLowerCase());
    });
    const live = relevant.filter((row) => ['live', 'partial'].includes(String(side === 'borrow' ? row.borrowRateStatus : row.rateStatus).toLowerCase())
      && (side === 'borrow' ? row.borrowApyPct : row.supplyApyPct) != null);
    let message;
    if (live.length) {
      message = fa
        ? `نرخ‌های ${side === 'borrow' ? 'هزینهٔ وام‌گیری' : 'تأمین نقدینگی'} را از خواندن مستقیم reserveهای Aave V3 روی زنجیره می‌بینی. مقادیر APY متغیرند، تضمین سود نیستند و به‌تنهایی دستور اجرا نیستند؛ برای هر عملیات مالی، بررسی تازه، تأیید و امضای کیف پول لازم است.`
        : `These ${side === 'borrow' ? 'borrowing-cost' : 'supply'} rates come from direct Aave V3 reserve reads on the selected chain. APY is variable, not guaranteed, and not an execution instruction; any financial action needs a fresh review, your confirmation and a wallet signature.`;
    } else if (relevant.some((row) => row.rateStatus === 'stale' || row.borrowRateStatus === 'stale')) {
      message = fa
        ? 'نرخ‌های قابل‌نمایش تازه نیستند؛ به همین دلیل هیچ APY فعالی اعلام نمی‌کنم. فهرست دارایی‌های پشتیبانی‌شده، اگر باشد، فقط رجیستری است و نرخ زنده نیست.'
        : 'The available rates are stale, so I am not presenting an active APY. Any supported-asset list is only a registry, not a live rate.';
    } else if (supportedMarkets.length) {
      message = fa
        ? 'رجیستری این شبکه دارایی‌های پشتیبانی‌شده را نشان می‌دهد، اما خواندن زندهٔ نرخ reserve در دسترس نیست. فهرست پشتیبانی را نرخ زنده حساب نکن.'
        : 'The registry lists supported assets on this network, but a live reserve-rate read is unavailable. The supported list is not a live rate.';
    } else {
      message = fa
        ? 'برای این درخواست، شبکهٔ مشخصی همراه کیف پول یا متن پیام پیدا نشد. شبکه را مشخص کن یا کیف پول EVM را وصل کن؛ شبکه‌ای را حدس نمی‌زنم.'
        : 'No chain was specified or available from the connected wallet. Name a network or connect an EVM wallet; I will not guess one.';
    }
    return {
      message,
      ui: { type: 'TEXT' },
      handledLocally: true,
      yieldMarkets: displayData,
      requiresConfirmation: false,
      actions: []
    };
  }

  if (!asset) {
    const question = fa ? 'کدام دارایی و نماد دقیق را می‌خواهی؟ (مثلاً USDC)' : 'Which exact asset symbol do you want to use? (for example, USDC)';
    return noAction(`${fa ? 'برای ساختن بررسی وام، نماد دارایی را حدس نمی‌زنم.' : 'I will not guess the asset for a lending action.'}\n\n${question}`, 'LENDING_ASSET_REQUIRED', question);
  }
  if (chainId == null) {
    const question = fa ? 'روی کدام شبکه؟ (مثلاً Base یا Arbitrum)' : 'Which network? (for example, Base or Arbitrum)';
    return noAction(`${fa ? 'شبکهٔ پیش‌فرضی انتخاب نمی‌کنم.' : 'I will not choose a default chain.'}\n\n${question}`, 'LENDING_CHAIN_REQUIRED', question);
  }
  if (!isConnected(context, results) || !(context.wallet?.address || context.wallet?.evmAddresses?.[0])) {
    const message = fa
      ? 'برای ادامهٔ این بررسی باید کیف پول EVM وصل باشد تا موجودی یا ظرفیت وام‌گیری روی همان شبکه خوانده شود. هنوز هیچ عملیات یا امضایی انجام نشده است.'
      : 'Connect an EVM wallet so I can read the token balance or borrowing capacity on that chain. Nothing has been submitted or signed.';
    return noAction(message, 'WALLET_REQUIRED', null, { type: 'CONNECT_WALLET' });
  }

  const amountRaw = entities.amountUsd ?? entities.amount ?? null;
  const amountNumber = Number(amountRaw);
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    const question = fa ? 'مبلغ دقیق را با واحدش بنویس (مثلاً «100 USDC» یا «$100 USDC»).' : 'Give an exact amount and unit (for example, “100 USDC” or “$100 USDC”).';
    return noAction(`${fa ? 'برای بررسی قابل‌تأیید، مبلغ لازم است.' : 'An exact amount is needed for a verifiable review.'}\n\n${question}`, 'LENDING_AMOUNT_REQUIRED', question);
  }

  const market = rows.find((row) => String(row.symbol || '').toUpperCase() === asset
    && Number(row.chainId) === Number(chainId));
  const supported = supportedMarkets.some((row) => String(row.symbol || '').toUpperCase() === asset
    && Number(row.chainId) === Number(chainId));
  if (!market) {
    const message = supported
      ? (fa
        ? `دارایی ${asset} در رجیستری این شبکه هست، اما reserve زنده برای بررسی نرخ و اجرا دریافت نشد. کارت اجرا ساخته نشد.`
        : `${asset} is in the supported-asset registry for this chain, but no live reserve was read for a rate and execution review. No action card was created.`)
      : (fa
        ? `${asset} در رجیستری دارایی‌های پشتیبانی‌شدهٔ این شبکه نیست؛ عملیات را متوقف می‌کنم.`
        : `${asset} is not in the supported-asset registry on this chain; the action is withheld.`);
    return noAction(message, supported ? 'LENDING_RATE_UNAVAILABLE' : 'ASSET_NOT_LISTED');
  }

  const rateStatus = side === 'borrow' ? market.borrowRateStatus : market.rateStatus;
  const rate = side === 'borrow' ? market.borrowApyPct : market.supplyApyPct;
  const active = market.reserveStatus === 'active';
  const available = side === 'borrow' ? market.borrowAvailable === true : market.available === true;
  if (rateStatus !== 'live' || !hasNumber(rate) || !active || !available) {
    const stale = rateStatus === 'stale';
    const message = fa
      ? `${asset} در این reserve نرخ ${side === 'borrow' ? 'وام‌گیری' : 'سپرده‌گذاری'} تازه و قابل‌تأیید ندارد${stale ? '؛ آخرین نرخ stale است' : ''}. کارت اجرا ساخته نشد.`
      : `${asset} has no fresh, verifiable ${side} rate in this reserve${stale ? '; the last rate is stale' : ''}. No action card was created.`;
    return noAction(message, stale ? 'LENDING_RATE_STALE' : 'LENDING_RATE_UNAVAILABLE');
  }
  if (market.priceStatus !== 'live' || !hasNumber(market.priceUsd) || Number(market.priceUsd) <= 0) {
    const message = fa
      ? 'قیمت معتبر Aave Oracle برای تبدیل و ارزیابی دلاری در دسترس نیست. مقدار را به دلار یا دارایی تبدیل نمی‌کنم و کارت اجرا نمی‌سازم.'
      : 'A valid Aave protocol-oracle price is unavailable. I will not convert or value the amount in USD, and no execution card is created.';
    return noAction(message, 'ORACLE_PRICE_UNAVAILABLE');
  }

  const decimals = Number(market.decimals);
  const amountUnit = String(entities.amountUnit || rawAssetUnit || '').toUpperCase();
  /* "100 USDC" is 100 token units. The parser fills `amountUsd` (and a generic
     USD `amountUnit`) for any stablecoin amount, so those fields are NOT proof
     that the user wrote dollars — only a written dollar marker ("$100",
     "100 dollars", "100 USD", "۱۰۰ دلار") or the absence of any token symbol
     is. Treating a typed token amount as USD silently re-scaled it through the
     oracle price and then truncated it. */
  const writtenAsDollars = /\$\s*[\d۰-۹]|[\d۰-۹][\d۰-۹.,]*\s*(?:dollars?|usd\b|دلار)/i.test(raw);
  const writtenAsToken = Boolean(rawAssetUnit) && !['USD', '$', 'TOMAN'].includes(rawAssetUnit);
  const usdInput = writtenAsDollars
    || (!writtenAsToken && (amountUnit === 'USD' || amountUnit === '$' || entities.amountUsd != null));
  const tokenAmount = usdInput
    ? usdToTokenAmount(amountNumber, market.priceUsd, decimals)
    : String(entities.amount ?? '').trim().replace(/,/g, '');
  const amountWei = amountUnits(tokenAmount, decimals);
  if (!tokenAmount || amountWei == null || amountWei <= 0n) {
    const message = fa
      ? `مبلغ با دقت ${decimals} رقم اعشار ${asset} قابل‌نمایش نیست. مقدار را با دقت معتبر توکن دوباره بنویس؛ آن را بی‌صدا گرد نمی‌کنم.`
      : `The amount cannot be represented at ${decimals} decimal places for ${asset}. Re-enter it with supported token precision; I will not silently round it.`;
    return noAction(message, 'AMOUNT_PRECISION_INVALID');
  }

  const normalizedAmount = formatAmountUnits(amountWei, decimals);
  const priceUsd = Number(market.priceUsd);
  const amountUsd = Number(normalizedAmount) * priceUsd;
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return noAction(
    fa ? 'ارزش‌گذاری مبلغ از روی Aave Oracle معتبر نیست؛ کارت اجرا ساخته نشد.' : 'The amount could not be valued from the Aave oracle; no action card was created.',
    'ORACLE_PRICE_UNAVAILABLE'
  );

  const fetchedAt = Number(market.fetchedAt || scan.lendingFetchedAt || scan.updatedAt);
  if (!Number.isFinite(fetchedAt) || Date.now() - fetchedAt > 120_000 || fetchedAt > Date.now() + 60_000) {
    return noAction(
      fa ? 'خواندن نرخ یا قیمت قدیمی است؛ برای تأیید مالی باید درخواست را دوباره بفرستی تا بررسی تازه شود.'
        : 'The rate or price read is too old for financial confirmation. Send the request again for a fresh review.',
      'LENDING_REVIEW_EXPIRED'
    );
  }

  let projectedHealthFactor = null;
  let availableBorrowsUsd = null;
  let walletBalance = null;
  const lendingPosition = results.lendingPosition || null;
  if (side === 'supply') {
    const assetPosition = results.lendingAssetPosition || null;
    let balanceWei = null;
    try { balanceWei = assetPosition?.walletWei != null ? BigInt(assetPosition.walletWei) : null; } catch { balanceWei = null; }
    if (assetPosition?.ok !== true || assetPosition?.dataStatus !== 'live' || balanceWei == null) {
      return noAction(
        fa ? `موجودی ${asset} از زنجیره تأیید نشد؛ سپرده‌گذاری بررسی یا آماده نمی‌شود.`
          : `The ${asset} balance could not be verified from the chain; supply is not prepared.`,
        'BALANCE_UNVERIFIED'
      );
    }
    if (balanceWei < amountWei) {
      return noAction(
        fa ? `موجودی زنجیره‌ای ${asset} برای ${normalizedAmount} کافی نیست؛ هیچ تراکنشی آماده نشده است.`
          : `The on-chain ${asset} balance is below ${normalizedAmount}; no transaction was prepared.`,
        'INSUFFICIENT_FUNDS'
      );
    }
    walletBalance = formatAmountUnits(balanceWei, decimals);
  } else {
    if (lendingPosition?.ok !== true || lendingPosition?.dataStatus !== 'live') {
      return noAction(
        fa ? 'دادهٔ وثیقه و بدهی Aave از کیف پول خوانده نشد؛ ظرفیت وام را حدس نمی‌زنم و کارت اجرا نمی‌سازم.'
          : 'Aave collateral and debt data could not be read for this wallet. I will not guess borrowing capacity or prepare an action.',
        'RISK_DATA_UNAVAILABLE'
      );
    }
    const collateralUsd = Number(lendingPosition.totalCollateralUsd);
    const debtUsd = Number(lendingPosition.totalDebtUsd);
    const available = Number(lendingPosition.availableBorrowsUsd);
    const liquidationThresholdPct = Number(lendingPosition.liquidationThresholdPct);
    if (![collateralUsd, debtUsd, available, liquidationThresholdPct].every(Number.isFinite)
      || collateralUsd <= 0 || available <= 0 || liquidationThresholdPct <= 0) {
      return noAction(
        fa ? 'وثیقه، بدهی یا ظرفیت وام‌گیری از pool قابل‌تأیید نیست؛ هیچ کارت اجرایی ساخته نشد.'
          : 'Collateral, debt, or available borrowing capacity is not verifiable from the pool; no action card was created.',
        'BORROW_CAPACITY_UNAVAILABLE'
      );
    }
    availableBorrowsUsd = available;
    if (amountUsd > available * 0.99) {
      return noAction(
        fa ? `مبلغ تقریبی ${moneyOrNa(amountUsd)} از ظرفیت امنِ فعلی بیشتر است. ظرفیت خوانده‌شده ${moneyOrNa(available)} است؛ از حاشیهٔ ۱٪ برای تغییرات تا ثبت تراکنش استفاده می‌کنم.`
          : `The estimated amount ${moneyOrNa(amountUsd)} exceeds 99% of current capacity (${moneyOrNa(available)}). I keep a 1% margin for changes before inclusion.`,
        'BORROW_LIMIT_EXCEEDED'
      );
    }
    projectedHealthFactor = (collateralUsd * (liquidationThresholdPct / 100)) / (debtUsd + amountUsd);
    if (!Number.isFinite(projectedHealthFactor) || projectedHealthFactor < 1.2) {
      return noAction(
        fa ? `برآورد محافظه‌کارانهٔ Health Factor پس از وام ${Number.isFinite(projectedHealthFactor) ? projectedHealthFactor.toFixed(2) : 'نامعلوم'} است؛ حداقل این بررسی 1.20 است. هیچ کارت اجرا ساخته نشد.`
          : `The conservative projected health factor after borrowing is ${Number.isFinite(projectedHealthFactor) ? projectedHealthFactor.toFixed(2) : 'unknown'}; this review requires at least 1.20. No action card was created.`,
        'HEALTH_FACTOR_TOO_LOW'
      );
    }
  }

  const parameters = {
    requireLiveRateReview: true,
    reviewedAt: fetchedAt,
    reviewedPriceUsd: priceUsd,
    reviewedSupplyApyPct: side === 'supply' ? Number(rate) : null,
    reviewedBorrowApyPct: side === 'borrow' ? Number(rate) : null,
    reviewedProjectedHealthFactor: projectedHealthFactor,
    reviewedAvailableBorrowsUsd: availableBorrowsUsd
  };
  const action = {
    type,
    asset,
    amount: normalizedAmount,
    amountUnit: asset,
    amountUsd,
    chainId: Number(chainId),
    venue: side === 'supply' ? (market.venue || 'lend-aave') : 'lend-aave',
    protocol: market.protocol || 'Aave V3',
    market: market.reserveAddress || market.id,
    parameters
  };
  const review = {
    schema: 'fbt.ai-lending-review.v1',
    side,
    symbol: asset,
    amount: normalizedAmount,
    amountUsd,
    priceUsd,
    priceSource: market.priceSource || 'protocol-oracle',
    ratePct: Number(rate),
    rateStatus,
    rateSource: market.source || 'aave-rpc',
    protocol: market.protocol || 'Aave V3',
    chainId: Number(chainId),
    chainName: market.chainName || market.chain || String(chainId),
    reserveAddress: market.reserveAddress || null,
    fetchedAt,
    decimals,
    walletBalance,
    availableBorrowsUsd,
    projectedHealthFactor
  };
  const message = fa
    ? `بررسی زندهٔ ${side === 'borrow' ? 'وام‌گیری' : 'سپرده‌گذاری'} ${normalizedAmount} ${asset} در ${review.protocol} روی ${review.chainName} آماده است. نرخ APY متغیر است، تضمین نیست؛ در صورت تأیید، ابتدا برنامه و نرخ دوباره بررسی می‌شوند و سپس کیف پول برای امضای تو باز می‌شود. هیچ چیزی بدون تأیید تو امضا یا ارسال نمی‌شود.`
    : `A live review for ${side === 'borrow' ? 'borrowing' : 'supplying'} ${normalizedAmount} ${asset} on ${review.protocol} (${review.chainName}) is ready. APY is variable, not guaranteed; the plan and rate are revalidated before the wallet requests your signature. Nothing is signed or sent without your confirmation.`;
  return {
    message,
    ui: { type: 'ACTION_CARD' },
    card: {
      kind: 'LENDING_REVIEW',
      title: fa ? '✦ بررسی نهایی وام' : '✦ Lending review',
      headline: `${normalizedAmount} ${asset} · ${review.protocol} · ${review.chainName}`,
      confirmLabel: fa ? 'تأیید و امضا با کیف پول' : 'Confirm & sign with wallet',
      editLabel: fa ? 'ویرایش' : 'Edit',
      review
    },
    actions: [action],
    handledLocally: true,
    yieldMarkets: displayData,
    requiresConfirmation: true
  };
}

/*
 * ─── STRUCTURED CARDS ────────────────────────────────────────────────────────
 * The chat surface renders these as real UI. Portfolio values are deliberately
 * calculated from priced, non-zero holdings only: `Number(null) === 0` is not
 * evidence that an unpriced token is worthless. The card exposes the known
 * stablecoin and concentration measurements; a separate wallet-mix heuristic
 * is shown only on a complete live snapshot. It never presents that heuristic
 * as an overall risk score, and P&L stays unavailable without cost basis.
 */
function portfolioCard(sortedHoldings, lang, portfolio = {}, analysis = {}) {
  const sourceRows = (sortedHoldings || []).filter(hasPortfolioHolding);
  const readRows = Array.isArray(portfolio.chains) ? portfolio.chains : [];
  const readByChain = new Map(readRows.map((read) => [String(read?.chainId ?? ''), read]));
  const rows = sourceRows.map((h, index) => {
    const chainId = h.chainId ?? h.chain ?? null;
    const read = readByChain.get(String(chainId ?? '')) || null;
    const amount = hasNumber(h.amount) ? Number(h.amount) : null;
    const value = positiveUsd(h.valueUsd) ? Number(h.valueUsd) : null;
    return {
      key: `${chainId ?? 'unknown'}:${String(h.address || h.symbol || 'asset').toLowerCase()}:${index}`,
      symbol: h.symbol || '—',
      name: h.name || null,
      address: h.address || null,
      amount,
      valueUsd: value,
      chainId,
      chainName: h.chainName || null,
      allocationPct: null,
      networkStatus: read?.failed ? 'failed' : read?.stale ? 'stale'
        : read?.partial || (!read && portfolio.partial === true) ? 'partial' : 'live',
      networkStale: Boolean(read?.stale || (read?.failed && Number(read?.rows) > 0))
    };
  });

  const pricedRows = rows.filter((row) => positiveUsd(row.valueUsd));
  const knownValue = pricedRows.reduce((sum, row) => sum + Number(row.valueUsd), 0);
  for (const row of rows) {
    row.allocationPct = positiveUsd(row.valueUsd) && knownValue > 0
      ? (Number(row.valueUsd) / knownValue) * 100
      : null;
  }

  const tokenTotals = new Map();
  const networkTotals = new Map();
  const stablecoins = new Set([
    'USDC', 'USDT', 'DAI', 'BUSD', 'FDUSD', 'TUSD', 'USDE', 'USDS',
    'PYUSD', 'GUSD', 'USDP', 'LUSD', 'FRAX', 'USDD'
  ]);
  for (const row of rows) {
    const networkKey = String(row.chainId ?? 'unknown');
    const network = networkTotals.get(networkKey) || {
      chainId: row.chainId,
      valueUsd: 0,
      pricedCount: 0,
      unpricedCount: 0,
      holdingCount: 0,
      failed: row.networkStatus === 'failed',
      stale: row.networkStale,
      status: row.networkStatus
    };
    network.holdingCount += 1;
    if (positiveUsd(row.valueUsd)) {
      network.valueUsd += Number(row.valueUsd);
      network.pricedCount += 1;
    } else {
      network.unpricedCount += 1;
    }
    if (row.networkStatus === 'failed') network.status = 'failed';
    else if (row.networkStatus === 'stale' && network.status !== 'failed') network.status = 'stale';
    network.failed = Boolean(network.failed || row.networkStatus === 'failed');
    network.stale = Boolean(network.stale || row.networkStale);
    networkTotals.set(networkKey, network);

    if (positiveUsd(row.valueUsd)) {
      const symbol = String(row.symbol || '—').toUpperCase();
      tokenTotals.set(symbol, (tokenTotals.get(symbol) || 0) + Number(row.valueUsd));
    }
  }

  /* A failed/stale network with no rows is still evidence. Include it as
     unavailable rather than fabricating a zero balance for that chain. */
  for (const read of readRows) {
    const chainId = read?.chainId ?? null;
    const key = String(chainId ?? 'unknown');
    if (networkTotals.has(key) || (!read?.failed && !read?.stale
      && !(Number(read?.unpriced) > 0) && read?.partial !== true)) continue;
    networkTotals.set(key, {
      chainId,
      valueUsd: null,
      pricedCount: 0,
      unpricedCount: Number(read?.unpriced) || 0,
      holdingCount: Number(read?.rows) > 0 ? Number(read.rows) : 0,
      failed: Boolean(read?.failed),
      stale: Boolean(read?.stale || (read?.failed && Number(read?.rows) > 0)),
      status: read?.failed ? 'failed' : read?.stale ? 'stale' : read?.partial ? 'partial' : 'live'
    });
  }
  // Detailed chainReads already represent the same failures by chainId; the
  // short-name lists are only a fallback for adapters without per-chain data.
  if (!readRows.length) {
    for (const [list, status] of [
      [portfolio.failedChains, 'failed'],
      [portfolio.staleChains, 'stale']
    ]) {
      for (const networkLabel of Array.isArray(list) ? list : []) {
        const key = String(networkLabel || '').trim();
        if (!key || networkTotals.has(key)) continue;
        networkTotals.set(key, {
          chainId: key,
          valueUsd: null,
          pricedCount: 0,
          unpricedCount: 0,
          holdingCount: 0,
          failed: status === 'failed',
          stale: status === 'stale',
          status
        });
      }
    }
  }

  const networks = [...networkTotals.values()].map((network) => ({
    ...network,
    valueUsd: network.pricedCount > 0 ? network.valueUsd : null,
    allocationPct: network.pricedCount > 0 && knownValue > 0
      ? (network.valueUsd / knownValue) * 100
      : null
  })).sort((a, b) => {
    if (a.valueUsd == null && b.valueUsd == null) return String(a.chainId).localeCompare(String(b.chainId));
    if (a.valueUsd == null) return 1;
    if (b.valueUsd == null) return -1;
    return b.valueUsd - a.valueUsd;
  });

  const unpricedCount = rows.filter((row) => !positiveUsd(row.valueUsd)).length;
  const stablecoinValueUsd = pricedRows.reduce((sum, row) => (
    stablecoins.has(String(row.symbol || '').toUpperCase()) ? sum + Number(row.valueUsd) : sum
  ), 0);
  const biggestToken = [...tokenTotals.entries()].sort((a, b) => b[1] - a[1])[0] || null;
  const concentrationPct = biggestToken && knownValue > 0 ? (biggestToken[1] / knownValue) * 100 : null;
  const priceDataStatus = String(portfolio.priceDataStatus || '').toLowerCase();
  const anyStaleNetwork = networks.some((network) => network.stale === true);
  const hasFailedNetwork = networks.some((network) => network.failed === true || network.status === 'failed');
  const hasPartialNetwork = readRows.some((read) => read?.partial === true);
  const sourceStatus = String(portfolio.dataStatus || '').toLowerCase();
  const verifiedEmpty = sourceStatus === 'empty' && rows.length === 0 && !portfolio.partial
    && !portfolio.fromSnapshot && !anyStaleNetwork && !hasFailedNetwork && !hasPartialNetwork;
  const status = sourceStatus === 'pending' || portfolio.hydrating
    ? 'pending'
    : verifiedEmpty
      ? 'empty'
      : (priceDataStatus === 'stale' || anyStaleNetwork || portfolio.fromSnapshot === true)
        ? 'stale'
        : (sourceStatus === 'live' && priceDataStatus === 'live' && !portfolio.partial
          && !hasPartialNetwork && unpricedCount === 0 && !hasFailedNetwork)
          ? 'live'
          : 'partial';
  // The mix model is shown only when both balances and prices are verified
  // current and complete. It is a wallet-composition heuristic, not an
  // all-in risk score (market volatility, liabilities, and off-wallet assets
  // are not inputs here).
  const portfolioMix = status === 'live'
    ? portfolioRiskScore({ holdings: pricedRows, stablecoinSymbols: stablecoins })
    : null;
  const portfolioMixScore = portfolioMix?.dataStatus === 'computed'
    && portfolioMix.score != null && Number.isFinite(Number(portfolioMix.score))
    ? Number(portfolioMix.score)
    : null;

  return {
    kind: 'PORTFOLIO',
    title: lang === 'fa' ? 'هوش پرتفوی' : 'Portfolio intelligence',
    totalValueUsd: knownValue > 0 ? knownValue : verifiedEmpty ? 0 : null,
    displayedValueKind: status === 'live' || verifiedEmpty ? 'total' : 'priced-subtotal',
    status,
    priceDataStatus: priceDataStatus || 'unavailable',
    pricedCount: pricedRows.length,
    unpricedCount,
    stablecoinValueUsd: knownValue > 0 ? stablecoinValueUsd : verifiedEmpty ? 0 : null,
    stablecoinPct: knownValue > 0 ? (stablecoinValueUsd / knownValue) * 100 : verifiedEmpty ? 0 : null,
    concentrationSymbol: biggestToken?.[0] || null,
    concentrationPct,
    /* Cost basis / transaction lots and a full risk model are not part of this
       wallet snapshot. Null is intentional: it means unknown, not zero. The
       separate composition heuristic is available only on a complete live read. */
    pnlUsd: null,
    overallRiskScore: null,
    portfolioMixScore,
    portfolioMixBand: portfolioMixScore == null ? null : (portfolioMix?.label || null),
    portfolioMixModel: portfolioMixScore == null ? null : 'wallet-composition-heuristic-v1',
    networks,
    failedNetworks: networks.filter((network) => network.failed === true || network.status === 'failed').length,
    staleNetworks: networks.filter((network) => network.stale === true || network.status === 'stale').length,
    rows,
    fetchedAt: hasNumber(portfolio.fetchedAt) ? Number(portfolio.fetchedAt)
      : hasNumber(analysis.fetchedAt) ? Number(analysis.fetchedAt) : null,
    source: portfolio.source || analysis.source || null,
    at: Date.now()
  };
}

const numOr = (v) => (hasNumber(v) ? Number(v) : null);

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

  if (['FARM', 'LEND', 'BORROW'].includes(type)) {
    return lendingReviewResponse({ type, intent, context, results, lang });
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

  /*
   * ─── IN-PLACE: the destination is this same surface ──────────────────────
   * The chat IS the Intent OS (/intent). When the OS cancelled a navigation
   * to /intent* because the user is already there (os/index.js in-place
   * guard), the answer is \"here\" — never «صفحه Intent OS را باز کردم».
   * The client auto-shows the tab/panel from `openTab`/`openPanel`, so the
   * user lands on the destination with zero taps.
   */
  const inPlaceRoute = intent?.inPlaceRoute || results?.inPlace || null;
  if (inPlaceRoute) {
    const target = resolveChatRoute(inPlaceRoute, { currentPathname: '/intent' });
    const show = target.kind === 'panel'
      ? { openPanel: target.panel }
      : target.kind === 'ecosystem'
        ? { openEcosystem: target.ecoKind }
        : target.kind === 'tab'
          ? { openTab: target.tab }
          : {};
    const destName = inPlaceName(inPlaceRoute, lang);
    return {
      message: lang === 'fa'
        ? `تو الان داخل Intent OS هستی — همین چت، مغز اصلی اپ. ${destName} را همین‌جا نشان می‌دهم؛ لازم نیست جایی بروی.`
        : `You are already inside the Intent OS — this chat is the app's main brain. Showing ${destName} right here; nowhere to go.`,
      ui: { type: 'TEXT' },
      inPlace: true,
      ...show
    };
  }

  /*
   * ─── «intent os» as a TOPIC (not a navigation) ───────────────────────────
   * Reaching here means no navigation happened: either the user asked ABOUT
   * the assistant (\"intent os چیست\") or named it without an open verb from a
   * surface where staying put is correct. Either way the answer describes the
   * brain and offers its live panels — it never claims a page opened.
   */
  if (type === 'INTENT_OS') {
    /* A real navigation happened (user asked from another page): say so. */
    if (results.route) {
      return {
        message: lang === 'fa'
          ? 'چت Intent OS را باز کردم — همان مغز اصلی اپ: پرتفوی، بازار، سواپ، فارم، وام و استراتژی را از داده زنده همان‌جا بخوان و اجرا کن.'
          : 'Opened the Intent OS chat — the app\'s main brain: read and run portfolio, markets, swap, farm, lending and strategies from live data there.',
        ui: { type: 'TEXT' },
        navigated: results.route
      };
    }
    return {
      message: lang === 'fa'
        ? 'من Intent OS هستم — همین چت، مغز اصلی اپ. پرتفوی، بازار، سواپ، فارم، وام، اسمارت‌مانی و استراتژی را از داده زنده همین‌جا می‌خوانم و اجرا می‌کنم؛ امضا همیشه با کیف پول توست. مرکز عملیات، ایجنت‌ها و استراتژی‌ها هم تب‌های همین صفحه‌اند.'
        : 'I am the Intent OS — this chat, the app\'s main brain. I read and run portfolio, markets, swap, farm, lending, smart money and strategies from live data right here; signing is always your wallet\'s. Ops, agents and strategies are tabs of this same page.',
      ui: { type: 'TEXT' },
      inPlace: String(context?.currentPage || '').startsWith('/intent'),
      actions: [
        { id: 'open-ops', route: '/intent?tab=ops', label: lang === 'fa' ? 'مرکز عملیات' : 'Ops Center' },
        { id: 'open-agents', route: '/intent?tab=agents', label: lang === 'fa' ? 'ایجنت‌ها' : 'Agents' },
        { id: 'open-strategies', route: '/intent?tab=strategies', label: lang === 'fa' ? 'استراتژی‌ها' : 'Strategies' }
      ]
    };
  }

  /*
   * A bridge is not a single-chain swap. Until this build has a verifiable
   * bridge adapter, keep a bridge request text-only and in chat. The optional
   * route is a user-chosen inspection link, not an execution or quote handoff.
   */
  if (type === 'BRIDGE' && !results.route && !results.handoff) {
    return {
      message: lang === 'fa'
        ? 'مسیریاب سواپ تک‌زنجیره‌ای این چت برای بریج کافی نیست و اتصال اجرای بریجِ قابل‌تأیید فعال نیست. هیچ نرخ یا تراکنش ساختگی نشان نمی‌دهم و چیزی اجرا نمی‌شود. می‌توانید صفحهٔ بریج را برای بررسی گزینه‌های در دسترس باز کنید.'
        : 'This chat’s single-chain swap router is not a bridge, and no verifiable bridge executor is connected. I will not invent a route or transaction; nothing is executed. You can open the bridge page to inspect currently available options.',
      ui: { type: 'TEXT' },
      code: 'BRIDGE_EXECUTE_UNAVAILABLE',
      requiresConfirmation: false,
      actions: [{
        id: 'open-bridge-page',
        route: '/bridge',
        label: lang === 'fa' ? 'بررسی صفحهٔ بریج' : 'Inspect bridge options'
      }]
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
          ? 'هدف را گرفتم. داده‌های قابل‌دسترس این لحظه را بررسی و گزینه‌های دارای منبع معتبر را مقایسه می‌کنم؛ موارد بی‌داده یا غیرقابل‌اجرا و مراحل نیازمند تأیید کیف پول را در کارت مشخص می‌کنم.'
          : 'برای ساختن استراتژی باید سرمایه‌ات را بدانم — مبلغ را بنویس یا کیف پول را وصل کن. بقیه‌ی اعداد (هدف، بازه، ریسک) را از جمله‌ات می‌خوانم.')
        : (knowsCapital
          ? 'Goal taken. Checking currently available data and comparing sourced opportunities. Missing feeds, execution limits and steps needing your wallet approval will be shown in the card.'
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
    const { portfolio, analysis, holdings: rawHoldings } = collectHoldings(context, results);
    /* Native-token rows with a zero balance are not holdings. Keeping them in
       this answer made an empty wallet look like a portfolio full of $0 rows.
       Positive amounts remain visible even when their USD price is unknown. */
    const holdings = rawHoldings.filter(hasPortfolioHolding);
    const unpriced = holdings.filter((h) => !positiveUsd(h.valueUsd));

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
    const failedReadRows = Array.isArray(portfolio?.chains)
      ? portfolio.chains.filter((read) => read?.failed === true)
      : [];
    const reportedFailedChains = Array.isArray(portfolio?.failedChains) ? portfolio.failedChains : [];
    const failedChains = reportedFailedChains.length
      ? reportedFailedChains
      : failedReadRows.map((read) => read.chainId).filter((chainId) => chainId != null);
    const reportedStaleChains = Array.isArray(portfolio?.staleChains) ? portfolio.staleChains : [];
    const staleReadRows = Array.isArray(portfolio?.chains)
      ? portfolio.chains.filter((read) => read?.stale === true)
      : [];
    const staleChains = reportedStaleChains.length
      ? reportedStaleChains
      : staleReadRows.map((read) => read.chainId).filter((chainId) => chainId != null);
    const readFailed = failedChains.length > 0 || failedReadRows.length > 0
      || portfolio?.dataStatus === 'error'
      || (portfolio?.dataStatus === 'unavailable' && Boolean(context.wallet?.connected ?? connected));
    const sourceStatus = String(portfolio?.dataStatus || '').toLowerCase();
    const readIncomplete = staleChains.length > 0 || staleReadRows.length > 0
      || portfolio?.fromSnapshot === true || portfolio?.freshness === 'STALE'
      || sourceStatus === 'partial' || sourceStatus === 'stale'
      || (portfolio?.partial === true && sourceStatus !== 'empty');

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
      if (readIncomplete) {
        return {
          message: lang === 'fa'
            ? 'خواندن پرتفوی کامل و به‌روز نیست، بنابراین خالی‌بودن کیف پول را تأیید نمی‌کنم. بخشی از پوشش زنجیره یا داده‌ها ناقص/قدیمی است؛ خواندن دوباره انجام می‌شود و تا تأیید کامل، موجودی نامعلوم می‌ماند.'
            : 'The portfolio read is stale or incomplete, so I cannot confirm that the wallet is empty. Some chain coverage or data is missing or out of date; I am refreshing the read, and the balance remains unknown until it is verified.',
          ui: { type: 'TEXT' },
          code: 'PORTFOLIO_READ_INCOMPLETE',
          refresh: true,
          pendingRefresh: true,
          staleChains
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

    const sorted = [...holdings].sort((a, b) => {
      const av = positiveUsd(a.valueUsd) ? Number(a.valueUsd) : -1;
      const bv = positiveUsd(b.valueUsd) ? Number(b.valueUsd) : -1;
      return bv - av;
    });
    const card = portfolioCard(sorted, lang, portfolio, analysis);
    const knownValue = card.totalValueUsd;
    const lines = allocationLines(sorted, knownValue);
    const totalLabel = money(knownValue);
    const failedNetworkNames = Array.isArray(portfolio.failedChains) && portfolio.failedChains.length
      ? portfolio.failedChains
      : card.networks
        .filter((network) => network.status === 'failed')
        .map((network) => network.chainId)
        .filter((chainId) => chainId != null);
    if (lang === 'fa') {
      const parts = [];
      if (toolsRan(results) || holdings.length) parts.push('موجودی‌های قابل‌خواندن کیف پول را با قیمت‌های موجود بررسی کردم.');
      parts.push('');
      parts.push(totalLabel
        ? (card.status === 'live'
          ? `ارزش تقریبی دارایی‌های قیمت‌گذاری‌شده: ${totalLabel}`
          : `جمعِ دارایی‌های قیمت‌گذاری‌شده (ناقص): ${totalLabel}`)
        : 'ارزش دلاریِ دارایی‌های قیمت‌گذاری‌شده در دسترس نیست.');
      parts.push('');
      parts.push('دارایی‌ها (موجودی و شبکه در کارت):');
      parts.push(...lines);
      if (card.concentrationSymbol && card.concentrationPct != null) {
        parts.push('');
        parts.push(`تمرکز روی بزرگ‌ترین داراییِ قیمت‌گذاری‌شده: ${card.concentrationSymbol} — ${pct(card.concentrationPct)} از ارزش قیمت‌گذاری‌شده.`);
      }
      if (unpriced.length) {
        parts.push('');
        parts.push(`${unpriced.length} دارایی قیمت معتبر ندارد؛ در جمع ارزش، صفر فرض نشده است.`);
      }
      if (card.status === 'partial' || card.status === 'stale') {
        parts.push('');
        parts.push(card.status === 'stale'
          ? 'برخی موجودی‌ها یا قیمت‌ها ممکن است از آخرین خواندن باشند؛ مبلغ بالا فقط جمع دارایی‌های قیمت‌گذاری‌شده است.'
          : 'این خواندن کامل نیست؛ مبلغ بالا فقط جمع دارایی‌های قیمت‌گذاری‌شده را نشان می‌دهد.');
      }
      if (failedNetworkNames.length) {
        parts.push('');
        parts.push(`خواندن این شبکه‌ها تأیید نشد: ${failedNetworkNames.join('، ')}.`);
      }
      parts.push('');
      if (card.portfolioMixScore == null) {
        parts.push('امتیاز ترکیب کیف پول نمایش داده نشد؛ همه موجودی‌ها و قیمت‌ها به‌صورت زنده و کامل تأیید نشده‌اند.');
      } else {
        parts.push(`امتیاز ترکیب کیف پول (مدل اکتشافی): ${card.portfolioMixScore} از ۱۰۰؛ بر پایه تمرکز دارایی‌های قیمت‌گذاری‌شده، سهم استیبل‌کوین‌های شناخته‌شده و تعداد دارایی‌ها و شبکه‌هاست. امتیاز بالاتر یعنی مواجهه بیشتر در این مدل، نه ارزیابی جامع ریسک. نوسان بازار، بدهی و دارایی‌های خارج از این کیف را پوشش نمی‌دهد.`);
      }
      parts.push('سود/زیان به‌دلیل نبود بهای تمام‌شده و تاریخچه خرید محاسبه نشده است.');
      return {
        message: parts.join('\n'),
        ui: { type: 'PORTFOLIO_CARD' },
        portfolio,
        card,
        actions: [{ id: 'open-lending', label: lang === 'fa' ? 'فرصت‌های وام' : 'Lending', route: '/loan' }]
      };
    }
    const parts = ['I read the wallet balances and the prices currently available.', ''];
    parts.push(totalLabel
      ? (card.status === 'live'
        ? `Approximate priced portfolio value: ${totalLabel}`
        : `Priced holdings subtotal (partial): ${totalLabel}`)
      : 'USD value for the priced holdings is unavailable.');
    parts.push('', 'Holdings (balance and network are shown in the card):', ...lines);
    if (card.concentrationSymbol && card.concentrationPct != null) {
      parts.push('', `Largest priced-token concentration: ${card.concentrationSymbol} — ${pct(card.concentrationPct)} of priced value.`);
    }
    if (unpriced.length) {
      parts.push('', `${unpriced.length} holding(s) have no valid price; they were not counted as zero.`);
    }
    if (card.status === 'partial' || card.status === 'stale') {
      parts.push('', card.status === 'stale'
        ? 'Some balances or prices may be from the last available read; the figure above is only the sum of priced holdings.'
        : 'This read is partial; the figure above is only the sum of priced holdings.');
    }
    if (failedNetworkNames.length) parts.push('', `Reads for these networks were not confirmed: ${failedNetworkNames.join(', ')}.`);
    if (card.portfolioMixScore == null) {
      parts.push('', 'The wallet-mix score is withheld because a complete live balance-and-price read was not verified.');
    } else {
      parts.push('', `Wallet-mix heuristic: ${card.portfolioMixScore}/100. It reflects priced-token concentration, recognized stablecoin share, holding rows, and supported networks; a higher score means more exposure under this model, not a comprehensive risk score. It excludes market volatility, liabilities, and assets outside this wallet.`);
    }
    parts.push('', 'P&L is not calculated without cost basis and purchase history.');
    return {
      message: parts.join('\n'),
      ui: { type: 'PORTFOLIO_CARD' },
      portfolio,
      card
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
      const usd = hasNumber(b.valueUsd ?? b.value) ? money(b.valueUsd ?? b.value) : null;
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
      const lines = best.map((o, i) => {
        const apy = hasNumber(o.apy) ? `${Number(o.apy).toFixed(1)}%` : 'N/A';
        const risk = o.risk || 'n/a';
        return `${i + 1}. ${o.protocol || o.symbol || 'pool'} — ${apy} APY\n   Risk: ${risk}${o.ilRisk ? ` · IL: ${o.ilRisk}` : ''}`;
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
    /*
     * On /intent these panels live INSIDE this same surface: the client shows
     * the tab/panel immediately (openTab/openPanel) and the copy says
     * \"here\", not \"opened\". From any other page the chip navigates there.
     */
    const onIntent = String(context?.currentPage || '').startsWith('/intent');
    if (onIntent) {
      const target = resolveChatRoute(`/intent?tab=${copy.tab}`, { currentPathname: '/intent' });
      const show = target.kind === 'panel'
        ? { openPanel: target.panel }
        : target.kind === 'ecosystem'
          ? { openEcosystem: target.ecoKind }
          : target.kind === 'tab'
            ? { openTab: target.tab }
            : {};
      const here = lang === 'fa'
        ? `${copy.fa} همین‌جا، در همین صفحه نشانش می‌دهم.`
        : `${copy.en} Showing it right here, on this same page.`;
      return {
        message: here,
        ui: { type: 'TEXT' },
        inPlace: true,
        ...show,
        actions: [{ id: `open-${copy.tab}`, route: `/intent?tab=${copy.tab}`, label: lang === 'fa' ? 'نمایش' : 'Show' }]
      };
    }
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
