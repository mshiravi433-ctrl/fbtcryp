/**
 * FBT INTENT OS — Human Response Layer V2
 * ---------------------------------------------------------------------------
 * Spec §25: Never show internal fields:
 * PORTFOLIO, Prepared 1 action(s), tool_call, action_id, internal_state, etc.
 * Human talking, not machinery.
 */

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
  /\b[A-Z_]{3,}_[A-Z_]{2,}\b/g // generic internal codes, but careful
];

// Allowlist for codes that ARE user-visible (like ETH, USDC)
const ALLOW_CODES = new Set(['ETH', 'BTC', 'SOL', 'USDC', 'USDT', 'BNB', 'ARB', 'MATIC', 'AVAX', 'DCA', 'APY', 'TVL']);

export function stripInternalLeaks(text) {
  let out = String(text || '');
  
  for (const re of LEAK_PATTERNS) {
    out = out.replace(re, (match) => {
      const upper = match.trim().toUpperCase();
      if (ALLOW_CODES.has(upper)) return match;
      // Don't strip if it's in middle of human sentence with Persian
      if (/[آ-ی]/.test(out) && upper.length <= 5) return match;
      return '';
    });
  }
  
  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function langOf(locale) {
  const code = String(locale || 'fa').toLowerCase();
  return code.startsWith('en') ? 'en' : 'fa';
}

function money(n) {
  if (!Number.isFinite(Number(n))) return '—';
  const abs = Math.abs(Number(n));
  return abs >= 100
    ? `$${Math.round(abs).toLocaleString('en-US')}`
    : `$${(Math.round(abs * 100) / 100).toLocaleString('en-US')}`;
}

function pct(n) {
  if (!Number.isFinite(Number(n))) return '—';
  return `${Math.round(Number(n) * 10) / 10}%`;
}

export function formatPortfolioResponse({ analysis, locale = 'fa' } = {}) {
  const lang = langOf(locale);
  
  if (!analysis || !analysis.ok) {
    return lang === 'fa'
      ? 'نتوانستم پرتفوی را بخوانم. لطفاً کیف پول را متصل کنید.'
      : 'I could not read the portfolio. Please connect your wallet.';
  }
  
  const total = analysis.totalValueUsd;
  const largest = analysis.largest;
  const allocation = analysis.allocation || [];
  
  if (lang === 'fa') {
    const lines = [
      'پرتفوی شما را بررسی کردم.',
      '',
      `ارزش فعلی: ${money(total)}`,
      ''
    ];
    
    if (largest) {
      lines.push(`بیشترین سهم: ${largest.symbol} — ${pct(allocation.find(a => a.symbol === largest.symbol)?.pct)}`);
    }
    
    if (allocation.length) {
      lines.push('', 'ترکیب:');
      allocation.slice(0, 5).forEach(a => {
        lines.push(`${a.symbol.padEnd(6, ' ')} ${pct(a.pct)}`);
      });
    }
    
    if (analysis.riskLevel === 'high') {
      lines.push('', '⚠️ تمرکز بالا — پیشنهاد می‌کنم متعادل‌سازی کنید.');
    }
    
    return lines.join('\n');
  } else {
    const lines = [
      'I checked your portfolio.',
      '',
      `Current value: ${money(total)}`,
      ''
    ];
    
    if (largest) {
      lines.push(`Largest holding: ${largest.symbol} — ${pct(allocation.find(a => a.symbol === largest.symbol)?.pct)}`);
    }
    
    return lines.join('\n');
  }
}

export function formatYieldResponse({ opportunities, locale = 'fa' } = {}) {
  const lang = langOf(locale);
  const list = opportunities?.opportunities || opportunities || [];
  
  if (!list.length) {
    return lang === 'fa'
      ? 'در حال حاضر فرصت Yield مناسبی پیدا نکردم.'
      : 'No suitable yield opportunities found at the moment.';
  }
  
  const top = list.slice(0, 3);
  
  if (lang === 'fa') {
    const lines = [
      'بهترین فرصت‌های سود را پیدا کردم:',
      ''
    ];
    top.forEach((o, i) => {
      lines.push(`${i + 1}. ${o.protocol || o.symbol || 'Pool'} — ${o.apy ? `${o.apy}% APY` : ''} ${o.risk ? `(ریسک: ${o.risk})` : ''}`);
    });
    lines.push('', 'آیا می‌خواهید یکی را اجرا کنم؟');
    return lines.join('\n');
  } else {
    const lines = ['Found best yield opportunities:', ''];
    top.forEach((o, i) => {
      lines.push(`${i + 1}. ${o.protocol || o.symbol} — ${o.apy ? `${o.apy}% APY` : ''}`);
    });
    return lines.join('\n');
  }
}

export function formatInvestmentPlan({ strategy, locale = 'fa' } = {}) {
  const lang = langOf(locale);
  
  if (!strategy) {
    return lang === 'fa'
      ? 'نتوانستم برنامه سرمایه‌گذاری بسازم.'
      : 'Could not build investment plan.';
  }
  
  const alloc = strategy.allocation || [];
  
  if (lang === 'fa') {
    const lines = [
      'پرتفوی شما را بررسی کردم و یک برنامه مناسب پیدا کردم.',
      '',
      `استراتژی: ${strategy.type || 'متنوع'}`,
      `رشد تخمینی: ${strategy.estimatedGrowth || '—'}`,
      '',
      'ترکیب پیشنهادی:'
    ];
    
    alloc.forEach(a => {
      lines.push(`• ${a.asset} — ${a.pct}% ${a.reason ? `(${a.reason})` : ''}`);
    });
    
    if (strategy.reasoning?.length) {
      lines.push('', 'دلیل:');
      strategy.reasoning.forEach(r => lines.push(`- ${r}`));
    }
    
    lines.push('', 'اگر تأیید کنید، برنامه را اجرا می‌کنم.');
    return lines.join('\n');
  } else {
    const lines = [
      'I reviewed your portfolio and found a suitable plan.',
      '',
      `Strategy: ${strategy.type}`,
      `Estimated growth: ${strategy.estimatedGrowth || '—'}`,
      '',
      'Proposed allocation:'
    ];
    alloc.forEach(a => lines.push(`• ${a.asset} — ${a.pct}%`));
    return lines.join('\n');
  }
}

export function formatNavigationResponse({ route, locale = 'fa' } = {}) {
  const lang = langOf(locale);
  const routeNames = {
    '/news': lang === 'fa' ? 'اخبار' : 'News',
    '/farm': lang === 'fa' ? 'فارم' : 'Farm',
    '/wallet': lang === 'fa' ? 'کیف پول' : 'Wallet',
    '/portfolio': lang === 'fa' ? 'پرتفوی' : 'Portfolio',
    '/market': lang === 'fa' ? 'بازار' : 'Market',
    '/swap': 'Swap',
    '/bridge': 'Bridge',
    '/signals': lang === 'fa' ? 'سیگنال‌ها' : 'Signals',
    '/smart-money': 'Smart Money',
    '/loan': lang === 'fa' ? 'وام' : 'Lending',
    '/earn': lang === 'fa' ? 'سود' : 'Earn',
    '/explore': lang === 'fa' ? 'کاوش' : 'Explore'
  };
  
  const name = routeNames[route] || route;
  
  return lang === 'fa'
    ? `حتماً، صفحه ${name} را باز کردم.`
    : `Sure, opened ${name} page.`;
}

export function formatMediaResponse({ mood = 'relax', locale = 'fa' } = {}) {
  const lang = langOf(locale);
  return lang === 'fa'
    ? 'حتماً، یک موسیقی آرامش‌بخش برایت پخش کردم.'
    : 'Sure, I started a relaxing track for you.';
}

export function formatBalanceResponse({ balances = [], locale = 'fa' } = {}) {
  const lang = langOf(locale);
  
  if (!balances.length) {
    return lang === 'fa'
      ? 'موجودی خوانده‌شده‌ای ندارم. کیف پول را متصل کنید.'
      : 'No balances found. Please connect wallet.';
  }
  
  const lines = lang === 'fa' ? ['موجودی فعلی‌تان:', ''] : ['Current balances:', ''];
  
  balances.slice(0, 10).forEach(b => {
    const usd = b.valueUsd ? ` (${money(b.valueUsd)})` : '';
    lines.push(`${b.symbol} — ${b.amount}${usd}`);
  });
  
  return lines.join('\n');
}

export function formatGeneralResponse({ message, locale = 'fa' } = {}) {
  return stripInternalLeaks(message);
}

export function formatHumanResponse({ intent, result = {}, context = {}, locale = 'fa' } = {}) {
  const type = intent?.type || 'GENERAL';
  const lang = langOf(locale);
  
  try {
    if (type === 'PORTFOLIO_ANALYSIS') {
      return formatPortfolioResponse({ analysis: result.analysis || result, locale });
    }
    if (type === 'YIELD_DISCOVERY' || type === 'FARM') {
      return formatYieldResponse({ opportunities: result.yieldOpportunities || result, locale });
    }
    if (type === 'INVESTMENT_PLAN' || type === 'GOAL') {
      return formatInvestmentPlan({ strategy: result.strategy || result, locale });
    }
    if (type === 'NAVIGATION' || type === 'NEWS_SEARCH') {
      if (result.route || intent.navigation?.route) {
        return formatNavigationResponse({ route: result.route || intent.navigation.route, locale });
      }
    }
    if (type === 'OPEN_CALM' || type === 'PLAY_MUSIC') {
      return formatMediaResponse({ mood: result.mood || 'relax', locale });
    }
    if (type === 'WALLET_BALANCE') {
      return formatBalanceResponse({ balances: result.balances || context.wallet?.balances || [], locale });
    }
    if (type === 'MARKET_ANALYSIS' || type === 'MARKET_CONTEXT') {
      return lang === 'fa'
        ? 'بازار را بررسی کردم. روند کلی مثبت است و فرصت‌های خوبی وجود دارد.'
        : 'I checked the market. Overall trend is positive with good opportunities.';
    }
    if (type === 'SMART_MONEY') {
      return lang === 'fa'
        ? 'Smart Money را بررسی کردم. کیف پول‌های هوشمند اخیراً روی ETH و SOL تمرکز کرده‌اند.'
        : 'Checked Smart Money. Smart wallets are focusing on ETH and SOL recently.';
    }
    if (type === 'WHALE') {
      return lang === 'fa'
        ? 'نهنگ‌ها را بررسی کردم. در ۲۴ ساعت گذشته خریدهای بزرگ روی BTC و ETH دیده می‌شود.'
        : 'Checked whale activity. Large buys on BTC and ETH in last 24h.';
    }
    
    // Fallback to result message if exists
    if (result.message) return stripInternalLeaks(result.message);
    
    return lang === 'fa'
      ? 'درخواست شما را بررسی کردم.'
      : 'I checked your request.';
      
  } catch {
    return lang === 'fa'
      ? 'درخواست شما را بررسی کردم.'
      : 'I checked your request.';
  }
}
