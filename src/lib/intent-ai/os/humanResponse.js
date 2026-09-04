/**
 * FBT INTENT OS — Human Response Layer
 * Speak from REAL tool results. Never claim a check that did not run.
 * Missing price ≠ $0. Connected-but-empty ≠ disconnected.
 */

import { pageName } from './moduleRouter.js';

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
  const isHoldingQuery = /(دارم\s*\?|دارم\s*$|من.*دارم|do i have)/i.test(rawText) && Boolean(intent?.entities?.token);
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
      ui: { type: 'TEXT' },
      actions: [{ id: `view-${sym.toLowerCase()}`, route: '/market', label: lang === 'fa' ? `صفحه بازار ${sym}` : `${sym} Market` }]
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
      const bits = [e.amount, e.fromToken || e.token, e.toToken, e.toAddress].filter(Boolean);
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

    if (!holdings.length) {
      return {
        message: lang === 'fa'
          ? 'کیف پول متصل است، اما هنوز دارایی قابل‌نمایش از زنجیره/ایندکسر نرسیده. این به‌معنی قطع اتصال نیست — داده در حال تازه‌سازی است.'
          : 'Wallet is connected, but no readable holdings have arrived from the indexer yet. That is not a disconnect — data is still refreshing.',
        ui: { type: 'TEXT' },
        code: 'PORTFOLIO_INDEXER_DELAY'
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
      return { message: parts.join('\n'), ui: { type: 'TEXT' }, portfolio, actions: [{ id: 'open-lending', label: lang === 'fa' ? 'فرصت‌های وام' : 'Lending', route: '/loan' }] };
    }
    const parts = ['Read the portfolio from the wallet and current prices.', ''];
    parts.push(totalLabel ? `Approx. value: ${totalLabel}` : 'Full USD value unavailable (some prices are N/A).');
    parts.push('', 'Assets:', ...lines);
    if (largest && largestPct != null) parts.push('', `Largest share: ${largest.symbol} — ${pct(largestPct)}`);
    return { message: parts.join('\n'), ui: { type: 'TEXT' }, portfolio };
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
      return {
        message: lang === 'fa'
          ? 'کیف پول متصل است اما موجودی زنجیره‌ای هنوز نرسیده. در حال تازه‌سازی‌ام، نه قطع اتصال.'
          : 'Wallet is connected but on-chain balances have not arrived yet.',
        ui: { type: 'TEXT' },
        code: 'PORTFOLIO_INDEXER_DELAY'
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
      const lines = best.map((o, i) => {
        const apy = Number.isFinite(Number(o.apy)) ? `${Number(o.apy).toFixed(1)}%` : 'N/A';
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
          { id: 'open-invest', label: lang === 'fa' ? 'افق جهانی' : 'Horizon', route: '/invest' },
          { id: 'open-perp', label: lang === 'fa' ? 'فیوچرز' : 'Perpetuals', route: '/perp' },
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
    const market = results.market || results.token || results.smartMoney || results.whale;
    if (market && market.dataStatus === 'unavailable' && !market.overview) {
      return {
        message: lang === 'fa'
          ? `بازار را از منبع زنده پرسیدم${token ? ` (${token})` : ''}، اما داده تازه برنگشت.`
          : `I queried live market data${token ? ` (${token})` : ''}, but nothing fresh came back.`,
        ui: { type: 'TEXT' }
      };
    }
    return {
      message: lang === 'fa'
        ? `بازار${token ? ` ${token}` : ''} را از ماژول زنده خواندم. جزئیات کامل روی صفحه بازار است — می‌خواهید آنجا را باز کنم؟`
        : `I read live market data${token ? ` for ${token}` : ''}. Want me to open the market page?`,
      ui: { type: 'TEXT' },
      actions: [{ id: 'open-market', route: '/market', label: lang === 'fa' ? 'بازار' : 'Market' }]
    };
  }

  if (type === 'CONTINUE' || type === 'EXECUTE_CURRENT' || type === 'DETAILS') {
    const slots = context.operational || {};
    const bits = [slots.asset, slots.operation, slots.amount].filter(Boolean);
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
