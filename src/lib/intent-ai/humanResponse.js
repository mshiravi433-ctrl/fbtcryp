/**
 * FBT INTENT OS — Human Response Layer.
 * ---------------------------------------------------------------------------
 * The only module allowed to turn an orchestrator result into chat text.
 *
 *   User → Intent Parser → Tool/Execution → Result → HERE → Chat UI
 *
 * Internal fields (PORTFOLIO, "Prepared 1 real action(s)", "blocked wallet",
 * action_id, /portfolio, tool_call, verdict.reason) stay in the log. The
 * user sees a person talking.
 */

import { classifyUserIntent, intentIsExecutable, intentRequiresWallet } from './intentKinds.js';
import { planRebalance, change24hFromMarket } from './rebalanceEngine.js';
import { humanizeError } from './errorHumanizer.js';
import { createPendingIntent } from './pendingIntent.js';

export const AI_RESPONSE_SCHEMA = 'fbt.ai-response.v1';

export const UI_TYPES = Object.freeze(['TEXT', 'ACTION_CARD', 'RESULT_CARD', 'CONNECT_WALLET']);

const LEAK = [
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
  /internal state/gi
];

export function stripInternalLeaks(text) {
  let out = String(text || '');
  for (const re of LEAK) out = out.replace(re, '');
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function langOf(locale) {
  const code = String(locale || 'fa').toLowerCase();
  return code.startsWith('en') ? 'en' : 'fa';
}

function money(n, lang) {
  if (!Number.isFinite(Number(n))) return lang === 'fa' ? '—' : '—';
  const abs = Math.abs(Number(n));
  const formatted = abs >= 100
    ? Math.round(abs).toLocaleString('en-US')
    : (Math.round(abs * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return `$${formatted}`;
}

function pct(n) {
  if (!Number.isFinite(Number(n))) return '—';
  const v = Math.round(Number(n) * 10) / 10;
  return `${v}%`;
}

function signedPct(n) {
  if (!Number.isFinite(Number(n))) return '—';
  const v = Math.round(Number(n) * 10) / 10;
  const sign = v > 0 ? '+' : '';
  return `${sign}${v}%`;
}

function linesForAllocation(rows, lang) {
  if (!Array.isArray(rows) || !rows.length) return lang === 'fa' ? 'هنوز سهمی خوانده نشده است.' : 'No holdings have been read yet.';
  return rows.slice(0, 8).map((r) => `${r.symbol.padEnd(6, ' ')}  ${pct(r.pct)}`).join('\n');
}

function connectCopy(lang) {
  return lang === 'fa'
    ? 'برای انجام این کار باید ابتدا کیف پولتان را متصل کنید.\n\nکیف پولی برای حساب شما پیدا نکردم.'
    : 'To do this I first need your wallet connected.\n\nI could not find a wallet on this account.';
}

function thanksConnected(lang) {
  return lang === 'fa'
    ? 'ممنون، کیف پول متصل شد. درخواست قبلی‌تان را ادامه می‌دهم.'
    : 'Thanks — the wallet is connected. I will continue with your previous request.';
}

function formatPortfolioAnalysis({ context, locale }) {
  const lang = langOf(locale);
  const plan = planRebalance({
    holdings: context?.portfolio?.holdings || [],
    balances: context?.balances || []
  });
  if (!plan.ok) {
    if (context?.wallet?.connected) {
      return { message: humanizeError(plan.code || 'EMPTY_PORTFOLIO', { locale: lang }).message, ui: 'TEXT' };
    }
    return {
      message: lang === 'fa'
        ? 'حتماً. برای تحلیل دقیق پرتفوی باید موجودی زنده را بخوانم. لطفاً کیف پول را متصل کنید تا اعداد واقعی را ببینیم.'
        : 'Of course. I need a live wallet read before I can analyse the portfolio honestly.',
      ui: 'CONNECT_WALLET'
    };
  }
  const change = change24hFromMarket(context?.market);
  const largest = plan.largest;
  const riskiest = plan.riskiest;
  if (lang === 'fa') {
    const parts = [
      'تحلیل پرتفوی شما آماده است.',
      '',
      `ارزش فعلی پرتفوی: ${money(plan.totalValueUsd, lang)}`
    ];
    if (change != null) parts.push(`تغییر ۲۴ ساعت اخیر: ${signedPct(change)}`);
    if (largest) parts.push('', 'بیشترین سهم:', `${largest.symbol} — ${pct(largest.pct)}`);
    if (riskiest && riskiest.symbol !== largest?.symbol) {
      parts.push('', 'بیشترین ریسک:', `${riskiest.symbol} — ${pct(riskiest.pct)}`);
    }
    parts.push('', 'اگر بخواهید، می‌توانم ترکیب پرتفوی را هم بررسی و پیشنهاد اصلاح بدهم.');
    return { message: parts.join('\n'), ui: 'TEXT', rebalance: plan };
  }
  const parts = [
    'Your portfolio analysis is ready.',
    '',
    `Current value: ${money(plan.totalValueUsd, lang)}`
  ];
  if (change != null) parts.push(`24h change: ${signedPct(change)}`);
  if (largest) parts.push('', 'Largest holding:', `${largest.symbol} — ${pct(largest.pct)}`);
  if (riskiest && riskiest.symbol !== largest?.symbol) {
    parts.push('', 'Highest risk:', `${riskiest.symbol} — ${pct(riskiest.pct)}`);
  }
  parts.push('', 'If you like, I can review the mix and suggest a rebalance.');
  return { message: parts.join('\n'), ui: 'TEXT', rebalance: plan };
}

function formatRebalanceCard(plan, lang) {
  if (!plan?.ok) return null;
  const rows = (plan.current || []).map((c) => {
    const target = (plan.target || []).find((t) => t.symbol === c.symbol);
    return { symbol: c.symbol, fromPct: c.pct, toPct: target ? target.pct : c.pct };
  });
  for (const t of plan.target || []) {
    if (!rows.some((r) => r.symbol === t.symbol)) rows.push({ symbol: t.symbol, fromPct: 0, toPct: t.pct });
  }
  return {
    title: lang === 'fa' ? '✦ برنامه متعادل‌سازی آماده است' : '✦ Rebalance plan is ready',
    kind: 'REBALANCE',
    rows,
    tradeCount: plan.tradeCount,
    estimatedFeeUsd: plan.estimatedFeeUsd,
    confirmLabel: lang === 'fa' ? 'تأیید و اجرا' : 'Confirm & run',
    editLabel: lang === 'fa' ? 'تغییر برنامه' : 'Change plan'
  };
}

function formatRebalanceMessage(plan, lang) {
  if (!plan?.ok) {
    return lang === 'fa'
      ? 'برای متعادل‌سازی باید پرتفوی زنده را بخوانم. کیف پول را متصل کنید تا برنامه را با اعداد واقعی بسازم.'
      : 'To rebalance I need a live portfolio read. Connect the wallet and I will build the plan from real numbers.';
  }
  const current = linesForAllocation(plan.current, lang);
  const target = linesForAllocation(plan.target.map((t) => ({ symbol: t.symbol, pct: t.pct })), lang);
  const fee = plan.estimatedFeeUsd != null ? money(plan.estimatedFeeUsd, lang) : '—';
  if (plan.tradeCount === 0) {
    return lang === 'fa'
      ? `حتماً. پرتفوی فعلی‌تان را بررسی کردم.\n\nپرتفوی فعلی:\n${current}\n\nترکیب فعلی با هدف هم‌خوان است؛ معامله‌ای لازم نیست.`
      : `I looked at the live book.\n\nCurrent:\n${current}\n\nIt already matches the target; no trades are needed.`;
  }
  const sample = (plan.trades || []).slice(0, 3).map((t) => (
    lang === 'fa'
      ? `${t.side === 'sell' ? 'فروش' : 'خرید'} ${t.side === 'sell' ? t.from : t.to}: ${money(t.amountUsd, lang)}`
      : `${t.side === 'sell' ? 'Sell' : 'Buy'} ${t.side === 'sell' ? t.from : t.to}: ${money(t.amountUsd, lang)}`
  )).join('\n');
  if (lang === 'fa') {
    return [
      'حتماً. پرتفوی فعلی‌تان را بررسی کردم.',
      '',
      'برنامه متعادل‌سازی آماده است.',
      '',
      'پرتفوی فعلی:',
      current,
      '',
      'پیشنهاد:',
      target,
      '',
      `برای رسیدن به این ترکیب، ${plan.tradeCount} معامله لازم است.`,
      '',
      'تقریباً:',
      sample,
      '',
      `کارمزد تخمینی: ${fee}`
    ].join('\n');
  }
  return [
    'I looked at the live book and prepared a rebalance.',
    '',
    'Current:',
    current,
    '',
    'Target:',
    target,
    '',
    `${plan.tradeCount} trade(s) to get there.`,
    '',
    sample,
    '',
    `Estimated fee: ${fee}`
  ].join('\n');
}

function formatBalance(context, lang) {
  const rows = Array.isArray(context?.balances) ? context.balances.filter((b) => Number(b.amount) > 0) : [];
  if (!rows.length) {
    return lang === 'fa'
      ? 'موجودی خوانده‌شده‌ای ندارم. اگر کیف پول همین الان متصل شده، چند لحظه صبر کنید تا زنجیره جواب بدهد.'
      : 'I do not have a balance read yet. If the wallet just connected, give the chain a moment.';
  }
  const lines = rows.slice(0, 12).map((b) => {
    const usd = Number.isFinite(Number(b.valueUsd)) ? ` (${money(b.valueUsd, lang)})` : '';
    return `${b.symbol} — ${b.amount}${usd}`;
  });
  return lang === 'fa'
    ? `موجودی فعلی‌تان:\n\n${lines.join('\n')}`
    : `Current balances:\n\n${lines.join('\n')}`;
}

function formatSwapCard(action, lang) {
  if (!action) return null;
  const from = action.from || action.fromSymbol || action.asset || '';
  const to = action.to || action.toSymbol || '';
  const amount = action.amount || action.amountUsd || '';
  return {
    title: lang === 'fa' ? '✦ آماده اجرا' : '✦ Ready to run',
    kind: action.type || 'SWAP',
    headline: [amount, from, to ? `→ ${to}` : ''].filter(Boolean).join(' '),
    confirmLabel: lang === 'fa' ? 'تأیید و اجرا' : 'Confirm & run',
    editLabel: lang === 'fa' ? 'ویرایش' : 'Edit'
  };
}

function actionFromPlan(plan, kind) {
  const first = plan?.actions?.[0] || null;
  if (!first) return null;
  return {
    ...first,
    type: kind === 'REBALANCE_PORTFOLIO' ? 'REBALANCE' : (first.type || kind)
  };
}

function suggestionLabels(suggestions, lang) {
  if (!Array.isArray(suggestions)) return [];
  return suggestions.slice(0, 4).map((s) => ({
    id: s.id,
    label: s.label,
    prompt: s.prompt
  }));
}

/**
 * Build the structured AIResponse the frontend is allowed to render.
 *
 * Only `message` and `ui` (plus card payloads) reach the bubble. Internal
 * fields travel alongside for the execution runtime and the log.
 */
export function formatHumanResponse({
  message = '',
  classification = null,
  orchestrateOut = null,
  context = {},
  locale = 'fa',
  resumed = false,
  suggestions = []
} = {}) {
  const lang = langOf(locale);
  const userIntent = classifyUserIntent(message, classification || orchestrateOut?.classification);
  const kind = userIntent.type;
  const wallet = context?.wallet || {};
  const connected = wallet.connected === true;
  const canSign = wallet.canSign !== false && connected;

  if (resumed && connected) {
    /* Fall through and produce the real answer; the UI prepends the thanks. */
  }

  const needsWallet = intentRequiresWallet(kind) || (userIntent.prefersWallet && kind === 'ANALYZE_PORTFOLIO' && !connected);
  if (needsWallet && !connected) {
    const pending = createPendingIntent({
      originalMessage: message,
      intentType: kind,
      status: 'WAITING_FOR_WALLET',
      locale
    });
    return finalize({
      message: connectCopy(lang),
      intent: { type: kind, status: 'WAITING_FOR_WALLET' },
      ui: { type: 'CONNECT_WALLET' },
      pendingIntent: pending.ok ? pending.intent : null,
      suggestions: suggestionLabels(suggestions, lang)
    });
  }

  if (kind === 'ANALYZE_PORTFOLIO') {
    const analysis = formatPortfolioAnalysis({ context, locale: lang });
    return finalize({
      message: analysis.message,
      intent: { type: kind, status: 'READY' },
      ui: { type: analysis.ui === 'CONNECT_WALLET' ? 'CONNECT_WALLET' : 'TEXT' },
      suggestions: suggestionLabels(suggestions, lang)
    });
  }

  if (kind === 'GET_BALANCE') {
    return finalize({
      message: formatBalance(context, lang),
      intent: { type: kind, status: 'READY' },
      ui: { type: 'TEXT' },
      suggestions: suggestionLabels(suggestions, lang)
    });
  }

  if (kind === 'REBALANCE_PORTFOLIO') {
    const plan = planRebalance({
      holdings: context?.portfolio?.holdings || [],
      balances: context?.balances || [],
      target: orchestrateOut?.plan?.allocation
    });
    const card = formatRebalanceCard(plan, lang);
    const executable = plan.ok && plan.tradeCount > 0 && canSign;
    return finalize({
      message: formatRebalanceMessage(plan, lang),
      intent: { type: kind, status: executable ? 'READY' : (plan.ok ? 'READY' : 'FAILED') },
      ui: { type: executable ? 'ACTION_CARD' : 'TEXT' },
      card,
      actions: plan.ok ? plan.trades : [],
      rebalance: plan,
      suggestions: suggestionLabels(suggestions, lang)
    });
  }

  if (kind === 'INVESTMENT_PLAN' || kind === 'GOAL') {
    const capital = context?.portfolio?.totalValueUsd;
    const body = lang === 'fa'
      ? (capital
        ? `حتماً. با سرمایه فعلی حدود ${money(capital, lang)} یک برنامه می‌چینم — بدون وعده سود تضمینی.\n\nاگر بخواهید آن را به هدف مالی تبدیل می‌کنم تا پیشرفت را دنبال کنیم.`
        : 'حتماً. یک برنامه سرمایه‌گذاری می‌چینم. اگر کیف پول متصل باشد اعداد را روی موجودی واقعی‌تان سوار می‌کنم.')
      : (capital
        ? `I can draft a plan around the ${money(capital, lang)} currently in the book — estimates, not promises.\n\nSay the word and I will turn it into a tracked financial goal.`
        : 'I can draft an investment plan. Connecting a wallet lets me size it to what you actually hold.');
    return finalize({
      message: body,
      intent: { type: kind, status: 'READY' },
      ui: { type: kind === 'GOAL' ? 'ACTION_CARD' : 'TEXT' },
      card: kind === 'GOAL' ? {
        title: lang === 'fa' ? '✦ هدف مالی' : '✦ Financial goal',
        kind: 'GOAL',
        confirmLabel: lang === 'fa' ? 'ثبت هدف' : 'Save goal',
        editLabel: lang === 'fa' ? 'ویرایش' : 'Edit'
      } : null,
      actions: kind === 'GOAL' ? [{ type: 'GOAL' }] : [],
      suggestions: suggestionLabels(suggestions, lang)
    });
  }

  if (intentIsExecutable(kind)) {
    const action = actionFromPlan(orchestrateOut?.plan, kind) || {
      type: kind,
      asset: orchestrateOut?.classification?.utterance?.assets?.[0]?.symbol || null,
      amount: orchestrateOut?.plan?.capitalUsd ?? null
    };
    const intro = lang === 'fa'
      ? (kind === 'DCA'
        ? 'برنامه خرید دوره‌ای را آماده کردم. اگر تأیید کنید، به‌عنوان خودکار ثبت می‌شود — هر اجرا همچنان به امضای شما نیاز دارد.'
        : 'جزئیات را آماده کردم. اگر موافق باشید اجرا را با امضای کیف پول شروع می‌کنم.')
      : (kind === 'DCA'
        ? 'I prepared a recurring buy. Confirming records the schedule — every run still needs your signature.'
        : 'I prepared the details. Confirm and I will start with a wallet signature.');
    return finalize({
      message: intro,
      intent: { type: kind, status: 'READY' },
      ui: { type: 'ACTION_CARD' },
      card: formatSwapCard(action, lang),
      actions: [action],
      suggestions: suggestionLabels(suggestions, lang)
    });
  }

  const fallback = lang === 'fa'
    ? 'در خدمتم. درباره پرتفوی، خرید، تبدیل یا هدف مالی‌تان بگویید تا با اعداد واقعی کمکتان کنم.'
    : 'I am here. Tell me about the portfolio, a trade, or a goal and I will work from real numbers.';
  return finalize({
    message: fallback,
    intent: { type: kind, status: 'READY' },
    ui: { type: 'TEXT' },
    suggestions: suggestionLabels(suggestions, lang)
  });
}

export function formatConnectThanks(locale = 'fa') {
  return thanksConnected(langOf(locale));
}

export function formatExecutionProgress({ index, total, status, from, to, locale = 'fa' } = {}) {
  const lang = langOf(locale);
  const n = Number(index) || 1;
  const of = Number(total) || n;
  const pair = [from, to].filter(Boolean).join(' → ');
  if (lang === 'fa') {
    if (status === 'CONFIRMED') return `✓ معامله ${n} از ${of}${pair ? ` (${pair})` : ''} تأیید شد`;
    if (status === 'CONFIRMING') return `⏳ معامله ${n} از ${of} در حال تأیید زنجیره است`;
    if (status === 'AWAITING_SIGNATURE') return `کیف پول را برای امضای معامله ${n} از ${of} باز می‌کنم.`;
    return `در حال اجرای برنامه هستم… (${n}/${of})`;
  }
  if (status === 'CONFIRMED') return `✓ Trade ${n} of ${of}${pair ? ` (${pair})` : ''} confirmed`;
  if (status === 'CONFIRMING') return `⏳ Trade ${n} of ${of} is confirming on-chain`;
  if (status === 'AWAITING_SIGNATURE') return `Opening the wallet to sign trade ${n} of ${of}.`;
  return `Running the plan… (${n}/${of})`;
}

export function formatExecutionResult({ result, rebalance = null, locale = 'fa' } = {}) {
  const lang = langOf(locale);
  if (!result) {
    return finalize({
      message: humanizeError('UNKNOWN', { locale: lang }).message,
      ui: { type: 'TEXT' },
      execution: { success: false, status: 'FAILED' }
    });
  }
  if (result.success === true && result.status === 'CONFIRMED') {
    const rows = (rebalance?.current || []).map((c) => {
      const target = (rebalance?.target || []).find((t) => t.symbol === c.symbol);
      return target ? `${c.symbol}\n${pct(c.pct)} → ${pct(target.pct)}` : `${c.symbol}  ${pct(c.pct)}`;
    });
    const hashes = result.txHashes || (result.txHash ? [result.txHash] : []);
    const body = lang === 'fa'
      ? [
        '✓ انجام شد',
        '',
        rebalance ? 'پرتفوی شما با موفقیت متعادل شد.' : 'تراکنش با موفقیت تأیید شد.',
        '',
        ...rows,
        '',
        hashes.length ? `تراکنش‌ها:\n${hashes.length} confirmed` : '',
        hashes[0] ? `\n${hashes[0]}` : ''
      ].filter(Boolean).join('\n')
      : [
        '✓ Done',
        '',
        rebalance ? 'The portfolio rebalance confirmed on-chain.' : 'The transaction confirmed on-chain.',
        '',
        ...rows,
        '',
        hashes.length ? `Transactions:\n${hashes.length} confirmed` : '',
        hashes[0] ? `\n${hashes[0]}` : ''
      ].filter(Boolean).join('\n');
    return finalize({
      message: body,
      ui: { type: 'RESULT_CARD' },
      card: {
        title: lang === 'fa' ? '✓ انجام شد' : '✓ Done',
        kind: 'RESULT',
        txHash: hashes[0] || null,
        txHashes: hashes
      },
      execution: result
    });
  }

  if (result.status === 'USER_REJECTED') {
    const human = humanizeError('USER_REJECTED', { locale: lang });
    return finalize({ message: human.message, ui: { type: 'TEXT' }, execution: result, retry: true });
  }

  const plan = result.plan;
  if (plan && plan.completedActions > 0 && plan.failedActions > 0) {
    const done = (plan.actions || []).filter((a) => a.status === 'CONFIRMED');
    const fail = (plan.actions || []).filter((a) => a.status !== 'CONFIRMED');
    const detail = lang === 'fa'
      ? [
        ...done.map((a) => `✓ ${a.from || a.asset || ''} → ${a.to || ''} انجام شد.`),
        ...fail.map((a) => `✕ ${a.from || a.asset || ''} → ${a.to || ''} انجام نشد.`),
        fail[0]?.error ? `\nدلیل:\n${fail[0].error}` : ''
      ].filter(Boolean).join('\n')
      : [
        ...done.map((a) => `✓ ${a.from || a.asset || ''} → ${a.to || ''} confirmed.`),
        ...fail.map((a) => `✕ ${a.from || a.asset || ''} → ${a.to || ''} did not go through.`),
        fail[0]?.error ? `\nReason:\n${fail[0].error}` : ''
      ].filter(Boolean).join('\n');
    const human = humanizeError('PARTIAL', { locale: lang, detail });
    return finalize({
      message: human.message,
      ui: { type: 'RESULT_CARD' },
      execution: { ...result, success: false, status: 'FAILED' },
      retry: true
    });
  }

  const code = result.error?.code || result.status || 'UNKNOWN';
  const human = humanizeError(code, { locale: lang, detail: result.error?.message });
  return finalize({
    message: human.message,
    ui: { type: human.ui === 'CONNECT_WALLET' ? 'CONNECT_WALLET' : 'TEXT' },
    execution: { ...result, success: false },
    retry: human.retry
  });
}

function finalize(payload) {
  const message = stripInternalLeaks(payload.message || '');
  const uiType = UI_TYPES.includes(payload.ui?.type || payload.ui) ? (payload.ui?.type || payload.ui) : 'TEXT';
  return {
    schema: AI_RESPONSE_SCHEMA,
    message: message || (payload.intent?.type === 'GENERAL' ? payload.message : message),
    intent: payload.intent || null,
    actions: Array.isArray(payload.actions) ? payload.actions : [],
    suggestions: Array.isArray(payload.suggestions) ? payload.suggestions : [],
    execution: payload.execution || null,
    ui: { type: uiType },
    card: payload.card || null,
    rebalance: payload.rebalance || null,
    pendingIntent: payload.pendingIntent || null,
    retry: payload.retry === true
  };
}

export { formatHumanResponse as formatChatReply };
