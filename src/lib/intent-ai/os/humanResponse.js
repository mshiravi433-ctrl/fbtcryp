/**
 * FBT INTENT OS — Human Response Layer V2
 * Spec §25 + §37 Security
 * Never show internal fields: PORTFOLIO, Prepared 1 action(s), tool_call, etc.
 * Human-friendly, no private keys, no internal state
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
  /tool_registry/gi,
  /action_bus/gi,
  /\b[A-Z_]{2,}_[A-Z_]+\b/g, // ALL_CAPS internal codes but allow common words
];

const ALLOWED_CAPS = new Set(['ETH', 'BTC', 'SOL', 'USDC', 'USDT', 'BNB', 'ARB', 'OK', 'USD']);

export function stripInternalLeaks(text) {
  let out = String(text || '');
  
  for (const re of LEAK_PATTERNS) {
    // Skip allowed caps
    if (re.source.includes('[A-Z_]{2,}')) {
      out = out.replace(re, (match) => {
        if (ALLOWED_CAPS.has(match.trim())) return match;
        // Keep if it's a token symbol in context
        if (/^[A-Z]{2,6}$/.test(match.trim()) && match.trim().length <= 6) {
          // Check if it's likely a token vs internal code (internal codes have underscore)
          if (!match.includes('_')) return match;
        }
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
  if (!Number.isFinite(Number(n))) return '—';
  const abs = Math.abs(Number(n));
  const formatted = abs >= 100
    ? Math.round(abs).toLocaleString('en-US')
    : (Math.round(abs * 100) / 100).toLocaleString('en-US');
  return `$${formatted}`;
}

/**
 * Build human response from agent results
 * Spec §25: Show person talking, not machinery
 */
export function buildHumanResponse({ intent, context = {}, results = {}, plan = null, locale = 'fa' } = {}) {
  const lang = langOf(locale);
  const type = intent?.type || 'GENERAL';
  
  // Navigation responses — direct, no confirmation
  if (type === 'NAVIGATION' || type === 'NEWS_SEARCH') {
    const route = results.route || plan?.actions?.[0]?.input?.route || '/news';
    const routeNames = {
      '/news': lang === 'fa' ? 'اخبار' : 'News',
      '/farm': lang === 'fa' ? 'فارم' : 'Farm',
      '/wallet': lang === 'fa' ? 'کیف پول' : 'Wallet',
      '/portfolio': lang === 'fa' ? 'پرتفوی' : 'Portfolio',
      '/market': lang === 'fa' ? 'بازار' : 'Market',
      '/swap': lang === 'fa' ? 'سواپ' : 'Swap',
      '/bridge': lang === 'fa' ? 'بریج' : 'Bridge'
    };
    const name = routeNames[route] || route;
    
    if (lang === 'fa') {
      return {
        message: `حتماً، صفحه ${name} را باز کردم.`,
        ui: { type: 'TEXT' },
        navigated: route
      };
    } else {
      return {
        message: `Sure, opened ${name} page.`,
        ui: { type: 'TEXT' },
        navigated: route
      };
    }
  }
  
  // Media responses
  if (type === 'OPEN_CALM' || type === 'PLAY_MUSIC') {
    if (lang === 'fa') {
      return {
        message: 'حتماً، یک موسیقی آرامش‌بخش برایت پخش کردم.',
        ui: { type: 'TEXT' },
        playing: true,
        mood: results.mood || 'relax'
      };
    } else {
      return {
        message: 'Sure, I started a relaxing track for you.',
        ui: { type: 'TEXT' },
        playing: true,
        mood: results.mood || 'relax'
      };
    }
  }
  
  // Portfolio analysis
  if (type === 'PORTFOLIO_ANALYSIS') {
    const portfolio = context.portfolio || results.portfolio || results.analysis;
    const total = portfolio?.totalValueUsd || context.totalValueUsd || null;
    const holdings = portfolio?.holdings || [];
    
    if (!total && !holdings.length) {
      if (lang === 'fa') {
        return {
          message: 'پرتفوی شما را بررسی کردم اما موجودی خوانده‌شده‌ای ندارم. لطفاً کیف پول را متصل کنید تا تحلیل دقیق ببینیم.',
          ui: { type: 'CONNECT_WALLET' }
        };
      } else {
        return {
          message: 'I checked your portfolio but have no balances yet. Connect wallet for detailed analysis.',
          ui: { type: 'CONNECT_WALLET' }
        };
      }
    }
    
    const largest = holdings.length ? [...holdings].sort((a, b) => (b.valueUsd || 0) - (a.valueUsd || 0))[0] : null;
    
    if (lang === 'fa') {
      const parts = ['پرتفوی شما را بررسی کردم.'];
      if (total) parts.push(`\n\nارزش فعلی: ${money(total)}`);
      if (largest) parts.push(`\nبیشترین سهم: ${largest.symbol} — ${money(largest.valueUsd)}`);
      if (portfolio?.concentration && portfolio.concentration > 50) {
        parts.push(`\n\n⚠️ تمرکز بالا روی ${largest?.symbol}: ${portfolio.concentration.toFixed(1)}% — پیشنهاد می‌کنم متعادل کنید.`);
      }
      parts.push('\n\nاگر بخواهید می‌توانم برنامه بهینه‌سازی پیشنهاد بدهم.');
      return {
        message: parts.join(''),
        ui: { type: 'TEXT' },
        portfolio
      };
    } else {
      const parts = ['I reviewed your portfolio.'];
      if (total) parts.push(`\n\nCurrent value: ${money(total)}`);
      if (largest) parts.push(`\nLargest: ${largest.symbol} — ${money(largest.valueUsd)}`);
      parts.push('\n\nI can suggest optimization if you want.');
      return {
        message: parts.join(''),
        ui: { type: 'TEXT' },
        portfolio
      };
    }
  }
  
  // Wallet balance
  if (type === 'WALLET_BALANCE') {
    const balances = context.wallet?.balances || results.balances?.balances || [];
    if (!balances.length) {
      return {
        message: lang === 'fa' ? 'موجودی خوانده‌شده‌ای ندارم. کیف پول متصل است؟' : 'No balances read yet. Is wallet connected?',
        ui: { type: 'TEXT' }
      };
    }
    
    const lines = balances.slice(0, 10).map(b => `${b.symbol}: ${b.amount} ${b.valueUsd ? `(${money(b.valueUsd)})` : ''}`);
    return {
      message: lang === 'fa' ? `موجودی فعلی:\n\n${lines.join('\n')}` : `Current balances:\n\n${lines.join('\n')}`,
      ui: { type: 'TEXT' },
      balances
    };
  }
  
  // Yield discovery
  if (type === 'YIELD_DISCOVERY' || type === 'FARM' || type === 'INVESTMENT_PLAN') {
    const opps = results.yieldOpportunities?.opportunities || results.yieldOpportunities || [];
    const best = Array.isArray(opps) ? opps.slice(0, 3) : [];
    
    if (!best.length) {
      return {
        message: lang === 'fa'
          ? 'فرصت‌های سود را بررسی کردم. در حال حاضر داده زنده در دسترس نیست، اما می‌توانم پرتفوی شما را تحلیل کنم و پیشنهاد بدهم.'
          : 'I checked yield opportunities. Live data unavailable, but I can analyze your portfolio and suggest.',
        ui: { type: 'TEXT' }
      };
    }
    
    if (lang === 'fa') {
      const lines = best.map(o => `${o.protocol || o.symbol}: ${o.apy ? `${o.apy.toFixed(2)}% APY` : ''} ${o.risk ? `(${o.risk})` : ''}`);
      return {
        message: `بهترین فرصت‌های سود:\n\n${lines.join('\n')}\n\nمی‌خواهید یکی را اجرا کنیم؟`,
        ui: { type: 'TEXT' },
        opportunities: best
      };
    } else {
      const lines = best.map(o => `${o.protocol || o.symbol}: ${o.apy ? `${o.apy.toFixed(2)}% APY` : ''}`);
      return {
        message: `Best yield opportunities:\n\n${lines.join('\n')}\n\nWant to execute one?`,
        ui: { type: 'TEXT' },
        opportunities: best
      };
    }
  }
  
  // Swap / Buy / Sell / Bridge — needs confirmation
  if (['SWAP', 'BUY', 'SELL', 'BRIDGE', 'SEND'].includes(type)) {
    const action = plan?.actions?.[0] || results.action || {};
    const from = action.input?.fromSymbol || action.from || 'USDC';
    const to = action.input?.toSymbol || action.to || 'ETH';
    const amount = action.input?.amount || '100';
    
    if (lang === 'fa') {
      return {
        message: `بررسی کردم:\n\n${amount} ${from} → ${to}\n\nاگر تأیید کنید، امضا را از کیف پول می‌گیرم و اجرا می‌کنم.`,
        ui: { type: 'ACTION_CARD' },
        card: {
          title: '✦ آماده اجرا',
          headline: `${amount} ${from} → ${to}`,
          from,
          to,
          amount,
          confirmLabel: 'تأیید و اجرا',
          editLabel: 'ویرایش'
        },
        requiresConfirmation: true,
        action
      };
    } else {
      return {
        message: `Checked:\n\n${amount} ${from} → ${to}\n\nConfirm and I'll request wallet signature.`,
        ui: { type: 'ACTION_CARD' },
        card: {
          title: '✦ Ready to run',
          headline: `${amount} ${from} → ${to}`,
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
  }
  
  // Market, Smart Money, Whale
  if (['MARKET_ANALYSIS', 'SMART_MONEY', 'WHALE'].includes(type)) {
    if (lang === 'fa') {
      return {
        message: 'بازار را بررسی کردم. داده‌های زنده را در صفحه مربوطه می‌توانید ببینید. می‌خواهید تحلیل عمیق‌تری بدهم؟',
        ui: { type: 'TEXT' }
      };
    } else {
      return {
        message: 'I checked the market. You can see live data on the relevant page. Want deeper analysis?',
        ui: { type: 'TEXT' }
      };
    }
  }
  
  // Default general
  if (lang === 'fa') {
    return {
      message: 'متوجه شدم. پرتفوی و بازار را بررسی کردم. چطور می‌توانم کمکت کنم؟',
      ui: { type: 'TEXT' }
    };
  } else {
    return {
      message: 'Got it. I checked portfolio and market. How can I help?',
      ui: { type: 'TEXT' }
    };
  }
}

export function formatConnectThanks(locale) {
  const lang = langOf(locale);
  return lang === 'fa'
    ? 'ممنون، کیف پول متصل شد. درخواست قبلی‌تان را ادامه می‌دهم.'
    : 'Thanks — wallet connected. Continuing your previous request.';
}
