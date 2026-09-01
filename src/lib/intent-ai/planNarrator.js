/**
 * FBT INTENT OS — plan narrator.
 * ---------------------------------------------------------------------------
 * Turns an ActionPlan into what the user actually reads.
 *
 *   ready plan            → ONE confirmation with the real numbers
 *   missing wallet        → connect button (never a retype)
 *   many wallets/assets   → ONE short question with tappable options
 *
 * The generic «جزئیات را آماده کردم» line is gone: a confirmation now always
 * names the asset, the amount, the chain and the wallet it will use.
 */

import { chainName, shortAddress } from './contextResolver.js';

function langOf(locale) {
  const code = String(locale || 'fa').toLowerCase();
  return code.startsWith('en') ? 'en' : 'fa';
}

function money(n) {
  if (!Number.isFinite(Number(n))) return null;
  const abs = Math.abs(Number(n));
  const formatted = abs >= 100
    ? Math.round(abs).toLocaleString('en-US')
    : (Math.round(abs * 100) / 100).toLocaleString('en-US');
  return `$${formatted}`;
}

function qty(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  if (v >= 1000) return Math.round(v).toLocaleString('en-US');
  if (v >= 1) return String(Math.round(v * 1e4) / 1e4);
  return String(Math.round(v * 1e6) / 1e6);
}

function amountLabel(source, lang) {
  if (!source) return '';
  const units = qty(source.amount);
  const usd = money(source.amountUsd);
  if (units && source.token) return `${units} ${source.token}`;
  if (usd) return lang === 'fa' ? `${usd} از ${source.token}` : `${usd} of ${source.token}`;
  return source.token || '';
}

/**
 * The single confirmation for a READY plan (spec §12 / §25).
 */
export function narrateReadyPlan(plan, { locale = 'fa' } = {}) {
  const lang = langOf(locale);
  const source = plan?.source || {};
  const target = plan?.destination?.token || null;
  const amount = amountLabel(source, lang);
  const chain = source.chain || chainName(source.chainId);
  const walletShort = shortAddress(plan?.wallet?.address);
  const fraction = source.fraction != null && source.fraction < 1
    ? `${Math.round(source.fraction * 100)}%`
    : null;

  const lines = [];
  if (lang === 'fa') {
    lines.push('موجودی شما را بررسی کردم.');
    if (source.balanceAmount != null || source.balanceUsd != null) {
      const bal = source.balanceAmount != null
        ? `${qty(source.balanceAmount)} ${source.token}`
        : money(source.balanceUsd);
      lines.push(`${bal}${chain ? ` روی ${chain}` : ''} در کیف پول شما موجود است.`);
    }
    lines.push('');
    lines.push(fraction ? `${fraction} از موجودی، یعنی ${amount}${target ? ` → ${target}` : ''}` : `${amount}${target ? ` → ${target}` : ''}`);
    if (walletShort) lines.push(`کیف پول: ${walletShort}`);
    if (source.amountUsd != null) lines.push(`ارزش تقریبی: ${money(source.amountUsd)}`);
    lines.push('');
    lines.push('اگر تأیید کنید، امضا را از همین کیف پول می‌گیرم.');
  } else {
    lines.push('I checked your balances.');
    if (source.balanceAmount != null || source.balanceUsd != null) {
      const bal = source.balanceAmount != null
        ? `${qty(source.balanceAmount)} ${source.token}`
        : money(source.balanceUsd);
      lines.push(`${bal}${chain ? ` on ${chain}` : ''} is available in your wallet.`);
    }
    lines.push('');
    lines.push(fraction ? `${fraction} of the balance — ${amount}${target ? ` → ${target}` : ''}` : `${amount}${target ? ` → ${target}` : ''}`);
    if (walletShort) lines.push(`Wallet: ${walletShort}`);
    if (source.amountUsd != null) lines.push(`Approx. value: ${money(source.amountUsd)}`);
    lines.push('');
    lines.push('Confirm and I will request the signature from that wallet.');
  }

  return {
    message: lines.filter((l) => l !== null).join('\n'),
    card: {
      title: lang === 'fa' ? '✦ آماده اجرا' : '✦ Ready to run',
      kind: plan?.type || 'SWAP',
      headline: [amount, target ? `→ ${target}` : ''].filter(Boolean).join(' '),
      chain,
      wallet: walletShort,
      amountUsd: source.amountUsd ?? null,
      confirmLabel: lang === 'fa' ? 'تأیید و اجرا' : 'Confirm & run',
      editLabel: lang === 'fa' ? 'ویرایش' : 'Edit'
    }
  };
}

/**
 * Spec §5/§6/§7/§15: ONE short question, only for information the wallet
 * genuinely cannot answer, always with tappable options where options exist.
 */
export function narrateMissingInformation(plan, { locale = 'fa' } = {}) {
  const lang = langOf(locale);
  const status = String(plan?.status || '');

  if (status === 'NEEDS_WALLET') {
    return {
      message: lang === 'fa'
        ? 'برای انجام این عملیات به کیف پول نیاز دارم.'
        : 'I need a wallet connected before I can run this.',
      ui: { type: 'CONNECT_WALLET' },
      choices: []
    };
  }

  if (status === 'NEEDS_WALLET_SELECTION') {
    const wallets = Array.isArray(plan?.options) ? plan.options : [];
    const kindWord = wallets[0]?.kind === 'solana' ? 'Solana' : 'EVM';
    return {
      message: lang === 'fa'
        ? `برای این عملیات ${wallets.length} کیف پول ${kindWord} متصل دارید. کدام را استفاده کنم؟`
        : `You have ${wallets.length} connected ${kindWord} wallets. Which one should I use?`,
      ui: { type: 'CHOICE' },
      choiceKind: 'WALLET',
      choices: wallets.map((w) => ({
        id: w.id,
        label: shortAddress(w.address),
        value: w.address,
        kind: w.kind
      }))
    };
  }

  if (status === 'NEEDS_ASSET_SELECTION') {
    const rows = Array.isArray(plan?.options) ? plan.options : [];
    const listed = rows.map((r) => {
      const usd = money(r.valueUsd);
      return `${r.symbol}${usd ? ` — ${usd}` : ''}${r.chain ? ` — ${r.chain}` : ''}`;
    }).join('\n');
    return {
      message: lang === 'fa'
        ? `${rows.length} موجودی مناسب پیدا کردم:\n\n${listed}\n\nاز کدام استفاده کنم؟`
        : `I found ${rows.length} balances that could fund this:\n\n${listed}\n\nWhich one should I use?`,
      ui: { type: 'CHOICE' },
      choiceKind: 'SOURCE_ASSET',
      choices: rows.map((r) => ({
        id: `${r.symbol}:${r.chainId ?? 'x'}`,
        label: r.chain ? `${r.symbol} · ${r.chain}` : r.symbol,
        value: r.symbol,
        chainId: r.chainId
      }))
    };
  }

  if (status === 'NEEDS_TARGET_ASSET') {
    return {
      message: lang === 'fa'
        ? 'چه دارایی‌ای می‌خواهید دریافت کنید؟'
        : 'Which asset should I buy for you?',
      ui: { type: 'TEXT' },
      choiceKind: 'TARGET_ASSET',
      choices: []
    };
  }

  if (status === 'NEEDS_AMOUNT') {
    const token = plan?.source?.token;
    const bal = plan?.source?.balanceAmount != null
      ? `${qty(plan.source.balanceAmount)} ${token}`
      : money(plan?.source?.balanceUsd);
    return {
      message: lang === 'fa'
        ? `چه مقدار${token ? ` ${token}` : ''} می‌خواهید تبدیل کنم؟${bal ? `\n\nموجودی فعلی: ${bal}` : ''}`
        : `How much${token ? ` ${token}` : ''} should I convert?${bal ? `\n\nAvailable: ${bal}` : ''}`,
      ui: { type: 'CHOICE' },
      choiceKind: 'AMOUNT',
      choices: [
        { id: 'half', label: lang === 'fa' ? 'نصف' : 'Half', value: '50%' },
        { id: 'all', label: lang === 'fa' ? 'همه' : 'All', value: '100%' }
      ]
    };
  }

  if (status === 'NO_BALANCE') {
    if (plan?.missing === 'INSUFFICIENT_BALANCE') {
      return {
        message: lang === 'fa'
          ? 'موجودی کافی برای این مبلغ وجود ندارد. می‌توانم برنامه را با موجودی فعلی تنظیم کنم.'
          : 'That amount is larger than the balance. I can resize the plan to what you hold.',
        ui: { type: 'TEXT' },
        choices: []
      };
    }
    return {
      message: lang === 'fa'
        ? 'در کیف پول‌های متصل موجودی قابل استفاده‌ای برای این عملیات پیدا نکردم.'
        : 'I could not find a usable balance in the connected wallets for this.',
      ui: { type: 'TEXT' },
      choices: []
    };
  }

  return {
    message: lang === 'fa'
      ? 'برای ادامه به یک جزئیات دیگر نیاز دارم.'
      : 'I need one more detail before I can continue.',
    ui: { type: 'TEXT' },
    choices: []
  };
}
