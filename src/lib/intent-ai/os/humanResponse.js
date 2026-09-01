/**
 * FBT INTENT OS — Human Response Layer V2
 * ---------------------------------------------------------------------------
 * Spec §25: Never show internal fields like PORTFOLIO, Prepared 1 action(s), tool_call, etc.
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
  /handoffRoute/gi,
  /execution object/gi,
  /backend error/gi,
  /internal state/gi,
  /executor/gi,
  /router_state/gi,
  /tool_call_id/gi
];

const ALLOW_CODES = new Set(['ETH', 'BTC', 'SOL', 'USDC', 'USDT', 'BNB', 'ARB', 'MATIC', 'AVAX', 'DCA', 'APY', 'TVL']);

export function stripInternalLeaks(text) {
  let out = String(text || '');
  for (const re of LEAK_PATTERNS) {
    out = out.replace(re, (match) => {
      const upper = match.trim().toUpperCase();
      if (ALLOW_CODES.has(upper)) return match;
      if (/[آ-ی]/.test(out) && upper.length <= 5) return match;
      return '';
    });
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function langOf(locale) {
  const code = String(locale || 'fa').toLowerCase();
  return code.startsWith('en') ? 'en' : 'fa';
}

function money(n) {
  if (!Number.isFinite(Number(n))) return '—';
  const abs = Math.abs(Number(n));
  return abs >= 100 ? `$${Math.round(abs).toLocaleString('en-US')}` : `$${(Math.round(abs * 100) / 100).toLocaleString('en-US')}`;
}

function pct(n) {
  if (!Number.isFinite(Number(n))) return '—';
  return `${Math.round(Number(n) * 10) / 10}%`;
}

export function formatPortfolioResponse({ analysis, locale = 'fa' } = {}) {
  const lang = langOf(locale);
  if (!analysis || !analysis.ok) {
    return lang === 'fa' ? 'نتوانستم پرتفوی را بخوانم. لطفاً کیف پول را متصل کنید.' : 'I could not read the portfolio. Please connect your wallet.';
  }
  const total = analysis.totalValueUsd;
  const largest = analysis.largest;
  const allocation = analysis.allocation || [];
  if (lang === 'fa') {
    const lines = ['پرتفوی شما را بررسی کردم.', '', `ارزش فعلی: ${money(total)}`, ''];
    if (largest) lines.push(`بیشترین سهم: ${largest.symbol} — ${pct(allocation.find(a => a.symbol === largest.symbol)?.pct)}`);
    if (allocation.length) {
      lines.push('', 'ترکیب:');
      allocation.slice(0, 5).forEach(a => lines.push(`${a.symbol.padEnd(6, ' ')} ${pct(a.pct)}`));
    }
    if (analysis.riskLevel === 'high') lines.push('', '⚠️ تمرکز بالا — پیشنهاد می‌کنم متعادل‌سازی کنید.');
    return lines.join('\n');
  } else {
    const lines = ['I checked your portfolio.', '', `Current value: ${money(total)}`, ''];
    if (largest) lines.push(`Largest holding: ${largest.symbol} — ${pct(allocation.find(a => a.symbol === largest.symbol)?.pct)}`);
    return lines.join('\n');
  }
}

export function formatYieldResponse({ opportunities, locale = 'fa' } = {}) {
  const lang = langOf(locale);
  const list = opportunities?.opportunities || opportunities || [];
  if (!list.length) {
    return lang === 'fa' ? 'در حال حاضر فرصت Yield مناسبی پیدا نکردم.' : 'No suitable yield opportunities found at the moment.';
  }
  const top = list.slice(0, 3);
  if (lang === 'fa') {
    const lines = ['بهترین فرصت‌های سود را پیدا کردم:', ''];
    top.forEach((o, i) => lines.push(`${i + 1}. ${o.protocol || o.symbol || 'Pool'} — ${o.apy ? `${o.apy}% APY` : ''} ${o.risk ? `(ریسک: ${o.risk})` : ''}`));
    lines.push('', 'آیا می‌خواهید یکی را اجرا کنم؟');
    return lines.join('\n');
  } else {
    const lines = ['Found best yield opportunities:', ''];
    top.forEach((o, i) => lines.push(`${i + 1}. ${o.protocol || o.symbol} — ${o.apy ? `${o.apy}% APY` : ''}`));
    return lines.join('\n');
  }
}

export function formatInvestmentPlan({ strategy, locale = 'fa' } = {}) {
  const lang = langOf(locale);
  if (!strategy) {
    return lang === 'fa' ? 'نتوانستم برنامه سرمایه‌گذاری بسازم.' : 'Could not build investment plan.';
  }
  const alloc = strategy.allocation || [];
  if (lang === 'fa') {
    const lines = ['پرتفوی شما را بررسی کردم و یک برنامه مناسب پیدا کردم.', '', `استراتژی: ${strategy.type || 'متنوع'}`, `رشد تخمینی: ${strategy.estimatedGrowth || '—'}`, '', 'ترکیب پیشنهادی:'];
    alloc.forEach(a => lines.push(`• ${a.asset} — ${a.pct}% ${a.reason ? `(${a.reason})` : ''}`));
    if (strategy.reasoning?.length) {
      lines.push('', 'دلیل:');
      strategy.reasoning.forEach(r => lines.push(`- ${r}`));
    }
    lines.push('', 'اگر تأیید کنید، برنامه را اجرا می‌کنم.');
    return lines.join('\n');
  } else {
    const lines = ['I reviewed your portfolio and found a suitable plan.', '', `Strategy: ${strategy.type}`, `Estimated growth: ${strategy.estimatedGrowth || '—'}`, '', 'Proposed allocation:'];
    alloc.forEach(a => lines.push(`• ${a.asset} — ${a.pct}% ${a.reason ? `(${a.reason})` : ''}`));
    return lines.join('\n');
  }
}

export function formatResponse({ intent, context = {}, result = null, locale = 'fa', error = null } = {}) {
  const lang = langOf(locale);
  const type = intent?.type || 'GENERAL';
  
  if (error || result?.ok === false) {
    const errCode = error?.code || result?.error || 'UNKNOWN';
    if (errCode === 'WALLET_REQUIRED' || errCode === 'NO_WALLET') {
      return {
        message: lang === 'fa' ? 'برای انجام این کار باید ابتدا کیف پولتان را متصل کنید.' : 'I need your wallet connected to do this.',
        ui: { type: 'CONNECT_WALLET' }
      };
    }
    if (errCode === 'TOOL_NOT_FOUND') {
      return {
        message: lang === 'fa' ? 'این قابلیت در حال حاضر در دسترس نیست.' : 'This capability is not available right now.',
        ui: { type: 'TEXT' }
      };
    }
  }
  
  if (type === 'NAVIGATION' || type === 'NEWS_SEARCH') {
    const route = result?.route || intent?.navigation?.route || '/news';
    const name = route.replace('/', '');
    return {
      message: lang === 'fa' ? `حتماً، صفحه ${name} را باز کردم.` : `Done, opened ${name} page.`,
      ui: { type: 'TEXT' },
      navigated: route
    };
  }
  
  if (type === 'OPEN_CALM' || type === 'PLAY_MUSIC') {
    return {
      message: lang === 'fa' ? 'حتماً، یک موسیقی آرامش‌بخش برایت پخش کردم.' : 'Sure, I started a relaxing track for you.',
      ui: { type: 'TEXT' },
      playing: true
    };
  }
  
  if (type === 'PORTFOLIO_ANALYSIS') {
    const analysis = result?.analysis || result?.agentResults?.['portfolio-agent']?.analysis || result;
    if (!analysis || analysis.ok === false) {
      return {
        message: lang === 'fa' ? 'برای تحلیل دقیق پرتفوی باید موجودی زنده را بخوانم. لطفاً کیف پول را متصل کنید.' : 'I need a live wallet read to analyze your portfolio.',
        ui: { type: 'CONNECT_WALLET' }
      };
    }
    const total = analysis.totalValueUsd ? money(analysis.totalValueUsd) : '—';
    const largest = analysis.largest ? `${analysis.largest.symbol} — ${Math.round(analysis.allocation?.find(a => a.symbol === analysis.largest.symbol)?.pct || 0)}%` : '';
    if (lang === 'fa') {
      return {
        message: `پرتفوی شما را بررسی کردم.\n\nارزش فعلی: ${total}${largest ? `\nبیشترین سهم: ${largest}` : ''}\n\n${analysis.riskLevel ? `سطح ریسک: ${analysis.riskLevel}` : ''}`,
        ui: { type: 'TEXT' },
        data: analysis
      };
    }
    return {
      message: `I checked your portfolio.\n\nCurrent value: ${total}${largest ? `\nLargest: ${largest}` : ''}`,
      ui: { type: 'TEXT' },
      data: analysis
    };
  }
  
  if (type === 'WALLET_BALANCE') {
    const balances = result?.balances?.balances || result?.balances || context.wallet?.balances || [];
    if (!balances.length) {
      return {
        message: lang === 'fa' ? 'موجودی خوانده‌شده‌ای ندارم. کیف پول را متصل کنید.' : 'No balances found. Please connect your wallet.',
        ui: { type: 'CONNECT_WALLET' }
      };
    }
    const lines = balances.slice(0, 8).map(b => `${b.symbol} — ${b.amount}${b.valueUsd ? ` (${money(b.valueUsd)})` : ''}`).join('\n');
    return {
      message: lang === 'fa' ? `موجودی فعلی‌تان:\n\n${lines}` : `Current balances:\n\n${lines}`,
      ui: { type: 'TEXT' },
      data: { balances }
    };
  }
  
  if (type === 'YIELD_DISCOVERY') {
    const opps = result?.yieldOpportunities?.opportunities || result?.opportunities || result?.agentResults?.['yield-agent']?.yieldOpportunities?.opportunities || [];
    if (!opps.length) {
      return {
        message: lang === 'fa' ? 'در حال حاضر فرصت Yield مناسبی پیدا نکردم. بازار را دوباره بررسی می‌کنم.' : 'No yield opportunities found right now.',
        ui: { type: 'TEXT' }
      };
    }
    const top = opps.slice(0, 3).map(o => `${o.protocol || o.symbol} — ${o.apy ? `${o.apy}%` : '—'} APY`).join('\n');
    return {
      message: lang === 'fa' ? `بهترین فرصت‌های سود را پیدا کردم:\n\n${top}\n\nاگر بخواهید می‌توانم جزئیات بیشتری نشان دهم.` : `Found best yield opportunities:\n\n${top}`,
      ui: { type: 'TEXT' },
      data: { opportunities: opps }
    };
  }
  
  if (type === 'INVESTMENT_PLAN') {
    const strategy = result?.strategy || result?.agentResults?.['financial-agent']?.strategy || result;
    if (!strategy || !strategy.allocation) {
      return {
        message: lang === 'fa' ? 'پرتفوی شما را بررسی کردم و یک برنامه مناسب پیدا کردم.' : 'I checked your portfolio and found a suitable plan.',
        ui: { type: 'TEXT' }
      };
    }
    const alloc = strategy.allocation?.map(a => `${a.asset} — ${a.pct}%`).join('\n') || '';
    if (lang === 'fa') {
      return {
        message: `برنامه سرمایه‌گذاری شما آماده است.\n\nنوع: ${strategy.type}\nتخمین رشد: ${strategy.estimatedGrowth || '—'}\n\nتخصیص پیشنهادی:\n${alloc}\n\n${strategy.reasoning?.[0] || ''}`,
        ui: { type: 'TEXT' },
        data: strategy
      };
    }
    return {
      message: `Your investment plan is ready.\n\nType: ${strategy.type}\nEst. growth: ${strategy.estimatedGrowth || '—'}\n\nAllocation:\n${alloc}`,
      ui: { type: 'TEXT' },
      data: strategy
    };
  }
  
  if (['SWAP', 'BUY', 'SELL', 'BRIDGE'].includes(type)) {
    const action = result?.action || result?.agentResults?.['trading-agent']?.action || result;
    const from = action?.from || action?.fromSymbol || '';
    const to = action?.to || action?.toSymbol || '';
    const amount = action?.amount || '';
    if (action?.quote?.ok === false) {
      return {
        message: lang === 'fa' ? 'نتوانستم قیمت مناسبی پیدا کنم. لطفاً دوباره تلاش کنید.' : 'Could not get a quote. Please try again.',
        ui: { type: 'TEXT' }
      };
    }
    return {
      message: lang === 'fa' ? `جزئیات را آماده کردم:\n\n${amount} ${from}${to ? ` → ${to}` : ''}\n\nاگر موافق باشید اجرا را با امضای کیف پول شروع می‌کنم.` : `Prepared details:\n\n${amount} ${from}${to ? ` → ${to}` : ''}\n\nConfirm to start execution with wallet signature.`,
      ui: { type: 'ACTION_CARD' },
      card: {
        title: lang === 'fa' ? '✦ آماده اجرا' : '✦ Ready to run',
        headline: `${amount} ${from}${to ? ` → ${to}` : ''}`,
        confirmLabel: lang === 'fa' ? 'تأیید و اجرا' : 'Confirm & run'
      },
      action
    };
  }
  
  if (type === 'MARKET_ANALYSIS' || type === 'MARKET_CONTEXT') {
    return {
      message: lang === 'fa' ? 'بازار را بررسی کردم. اطلاعات به‌روز را در صفحه بازار می‌توانید ببینید.' : 'I checked the market. You can see live data on the market page.',
      ui: { type: 'TEXT' }
    };
  }
  
  if (type === 'SMART_MONEY') {
    return {
      message: lang === 'fa' ? 'Smart Money را بررسی کردم. کیف پول‌های هوشمند را در صفحه مربوطه ببینید.' : 'Checked Smart Money. See smart wallets on the dedicated page.',
      ui: { type: 'TEXT' }
    };
  }
  
  if (type === 'WHALE') {
    return {
      message: lang === 'fa' ? 'فعالیت نهنگ‌ها را بررسی کردم. آخرین جابجایی‌های بزرگ را نمایش می‌دهم.' : 'Checked whale activity. Showing recent large movements.',
      ui: { type: 'TEXT' }
    };
  }
  
  if (type === 'GOAL') {
    return {
      message: lang === 'fa' ? 'برای هدف سه ساله‌ات برنامه ساختم. پرتفوی را بررسی کردم و بهترین مسیر را پیشنهاد می‌دهم.' : 'I built a plan for your 3-year goal.',
      ui: { type: 'TEXT' }
    };
  }
  
  return {
    message: lang === 'fa' ? 'پرتفوی شما را بررسی کردم و یک برنامه مناسب پیدا کردم.' : 'I checked your portfolio and prepared a plan.',
    ui: { type: 'TEXT' }
  };
}

// Compatibility aliases
export const formatHumanResponse = formatResponse;
export const formatExecutionProgress = (progress, locale = 'fa') => {
  if (!progress) return '';
  const lang = locale?.startsWith('en') ? 'en' : 'fa';
  return lang === 'fa' ? `در حال اجرا… ${progress.index || 1}/${progress.total || 1}` : `Running… ${progress.index || 1}/${progress.total || 1}`;
};
export const formatExecutionResult = (result, locale = 'fa') => {
  if (!result) return '';
  const lang = locale?.startsWith('en') ? 'en' : 'fa';
  if (result.ok) return lang === 'fa' ? 'با موفقیت انجام شد.' : 'Successfully completed.';
  return lang === 'fa' ? 'عملیات ناموفق بود.' : 'Operation failed.';
};
export function formatConnectThanks(locale = 'fa') {
  const lang = langOf(locale);
  return lang === 'fa' ? 'ممنون، کیف پول متصل شد.' : 'Thanks, wallet connected.';
}
