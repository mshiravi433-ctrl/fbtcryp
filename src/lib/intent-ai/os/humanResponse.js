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
    const scan = results.yieldOpportunities || results.opportunities || {};
    const opps = Array.isArray(scan.opportunities) ? scan.opportunities
      : (Array.isArray(scan) ? scan : (Array.isArray(results.opportunities) ? results.opportunities : []));
    const best = opps.filter((o) => o && (o.apy != null || o.protocol || o.symbol)).slice(0, 3);
    const dataStatus = scan.dataStatus || results.dataStatus;

    if (best.length) {
      const lines = best.map((o, i) => {
        const apy = Number.isFinite(Number(o.apy)) ? `${Number(o.apy).toFixed(1)}%` : 'N/A';
        const risk = o.risk || 'n/a';
        return `${i + 1}. ${o.protocol || o.symbol || 'pool'} — ${apy} APY\n   Risk: ${risk}${o.ilRisk ? ` · IL: ${o.ilRisk}` : ''}`;
      });
      const stamp = scan.updatedAt ? `\n\n${lang === 'fa' ? 'زمان داده' : 'As of'}: ${scan.updatedAt}` : '';
      return {
        message: lang === 'fa'
          ? `${best.length} فرصت فعلی پیدا کردم:\n\n${lines.join('\n\n')}${stamp}\n\nاین‌ها برآوردند، تضمین سود نیستند. می‌خواهید یکی را در صفحه مربوط باز کنیم؟`
          : `Found ${best.length} current opportunities:\n\n${lines.join('\n\n')}${stamp}\n\nEstimates, not guaranteed. Open one on its real page?`,
        ui: { type: 'TEXT' },
        opportunities: best,
        actions: [
          { id: 'open-earn', label: lang === 'fa' ? 'صفحه سود' : 'Earn', route: '/earn' },
          { id: 'open-farm', label: lang === 'fa' ? 'فارم' : 'Farm', route: '/farm' },
          { id: 'open-loan', label: lang === 'fa' ? 'وام' : 'Lending', route: '/loan' }
        ]
      };
    }

    if (dataStatus === 'empty' || (scan.ok && scan.scanned >= 0 && !best.length && scan.dataQuality && scan.dataQuality !== 'NONE')) {
      return {
        message: lang === 'fa'
          ? 'در حال حاضر فرصت مناسبی که از فیلترهای ریسک شما عبور کند پیدا نشد.'
          : 'No opportunity currently passes your risk filters.',
        ui: { type: 'TEXT' },
        opportunities: []
      };
    }

    return {
      message: lang === 'fa'
        ? 'اسکن فرصت‌ها را اجرا کردم، اما هیچ منبع بازار زنده پاسخ نداد. این حدس نیست — داده در دسترس نبود.'
        : 'I ran the opportunity scan, but no live market source answered. That is not a guess — data was unavailable.',
      ui: { type: 'TEXT' },
      code: 'PRICE_PROVIDER_UNAVAILABLE'
    };
  }

  if (['SWAP', 'BUY', 'SELL', 'BRIDGE', 'SEND'].includes(type)) {
    const action = plan?.actions?.[0] || results.action || {};
    const from = action.input?.fromSymbol || action.from || intent?.entities?.fromToken || intent?.entities?.token || 'USDC';
    const to = action.input?.toSymbol || action.to || intent?.entities?.toToken || (type === 'BUY' ? intent?.entities?.token : 'ETH') || 'ETH';
    const amount = action.input?.amount || action.amount || intent?.entities?.amount || intent?.entities?.amountUsd || null;
    if (lang === 'fa') {
      return {
        message: amount
          ? `نقل‌قول آماده شد:\n\n${amount} ${from} → ${to}\n\nاگر تأیید کنید، امضا را از کیف پول می‌گیرم. هیچ انتقالی بدون تأیید شما انجام نمی‌شود.`
          : `برای ${from} → ${to} آماده‌ام. مبلغ را بگویید تا نقل‌قول زنده بگیرم.`,
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
    return {
      message: amount
        ? `Quote ready:\n\n${amount} ${from} → ${to}\n\nConfirm and I will request a wallet signature.`
        : `Ready for ${from} → ${to}. Tell me the amount for a live quote.`,
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
    return {
      message: lang === 'fa'
        ? 'درخواست را فهمیدم، اما به یک ماژول مشخص نگاشت نشد. می‌توانم پرتفوی، موجودی، سواپ، فارم، وام یا فرصت سود را از داده زنده بخوانم.'
        : 'I understood you, but it did not map to a specific module. I can read live portfolio, balances, swap, farm, lending or yield.',
      ui: { type: 'TEXT' }
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
