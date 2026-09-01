/**
 * FBT INTENT OS — natural-language error handler.
 * ---------------------------------------------------------------------------
 * Backend codes stay in the log. The chat speaks like a person.
 *
 *   INSUFFICIENT_FUNDS  → «موجودی کافی برای اجرای این برنامه وجود ندارد.»
 *   SLIPPAGE_EXCEEDED   → «قیمت هنگام اجرا تغییر کرد…»
 *   USER_REJECTED       → «امضای تراکنش توسط کیف پول انجام نشد.»
 *
 * Never: "Execution failed." / "blocked wallet" / a raw code.
 */

export const ERROR_HUMANIZER_SCHEMA = 'fbt.ai-error-human.v1';

const COPY = Object.freeze({
  WALLET_REQUIRED: {
    fa: 'برای انجام این کار باید ابتدا کیف پولتان را متصل کنید.\n\nکیف پولی برای حساب شما پیدا نکردم.',
    en: 'To do this I first need your wallet connected.\n\nI could not find a wallet on this account.'
  },
  WALLET_SIGNATURE_REQUIRED: {
    fa: 'کیف پول متصل است اما برای امضا قفل است. لطفاً آن را باز کنید و دوباره تلاش کنیم.',
    en: 'The wallet is connected but locked for signing. Unlock it and we can continue.'
  },
  USER_REJECTED: {
    fa: 'امضای تراکنش توسط کیف پول انجام نشد.\n\nاگر انصراف داده‌اید اشکالی ندارد؛ هر وقت آماده بودید دوباره تلاش می‌کنیم.',
    en: 'The wallet did not sign the transaction.\n\nIf you cancelled, that is fine — we can try again whenever you are ready.'
  },
  INSUFFICIENT_FUNDS: {
    fa: 'موجودی کافی برای اجرای این برنامه وجود ندارد.',
    en: 'There is not enough balance to run this plan.'
  },
  INSUFFICIENT_GAS: {
    fa: 'برای پرداخت کارمزد شبکه موجودی کافی نیست. مقدار کمی از ارز بومی زنجیره لازم است.',
    en: 'There is not enough native gas to pay the network fee.'
  },
  SLIPPAGE_EXCEEDED: {
    fa: 'قیمت هنگام اجرا تغییر کرد و Slippage از حد مجاز عبور کرد.\n\nتراکنش اجرا نشد و دارایی شما منتقل نشده است.',
    en: 'The price moved while executing and slipped past the limit you accepted.\n\nNothing was transferred.'
  },
  SIMULATION_FAILED: {
    fa: 'شبیه‌سازی تراکنش رد شد؛ اگر امضا می‌کردید روی زنجیره هم برمی‌گشت. دارایی‌تان جابه‌جا نشده است.',
    en: 'The transaction simulation reverted, so it would have failed on-chain too. Nothing moved.'
  },
  CONFIRMATION_FAILED: {
    fa: 'تراکنش به شبکه ارسال شد اما تأیید زنجیره را نگرفتیم. موفقیت اعلام نمی‌شود تا زمان دریافت رسید.',
    en: 'The transaction was submitted but the chain has not confirmed it. I will not call it done without a receipt.'
  },
  BROADCAST_FAILED: {
    fa: 'ارسال تراکنش به شبکه انجام نشد. دارایی شما جابه‌جا نشده است.',
    en: 'Broadcasting the transaction failed. Nothing moved.'
  },
  PROVIDER_FAILED: {
    fa: 'ارائه‌دهنده قیمت یا مسیر در دسترس نبود. هیچ تراکنشی ساخته نشد.',
    en: 'The quote or routing provider was unavailable. No transaction was built.'
  },
  NETWORK_FAILED: {
    fa: 'ارتباط با شبکه برقرار نشد. لطفاً اتصال را بررسی کنید و دوباره تلاش کنیم.',
    en: 'The network could not be reached. Check the connection and we can try again.'
  },
  NO_ROUTE: {
    fa: 'برای این جفت دارایی مسیر قابل اجرایی پیدا نکردم.',
    en: 'I could not find an executable route for this pair.'
  },
  EMPTY_PORTFOLIO: {
    fa: 'پرتفوی شما خالی به نظر می‌رسد — یا هنوز موجودی خوانده نشده است.',
    en: 'The portfolio looks empty — or the balances have not been read yet.'
  },
  UNPRICED_HOLDINGS: {
    fa: 'دارایی‌هایی در کیف پول هست اما قیمت زنده‌ای برایشان ندارم، بنابراین نمی‌توانم سهم‌ها را به‌درستی حساب کنم.',
    en: 'There are holdings in the wallet but I do not have live prices, so I cannot compute honest weights.'
  },
  EXPIRED: {
    fa: 'نقل‌قول منقضی شد. یک قیمت تازه می‌گیرم.',
    en: 'The quote expired. I will fetch a fresh price.'
  },
  PARTIAL: {
    fa: 'متوجه شدم؛ بخشی از برنامه انجام شد و بخشی انجام نشد.',
    en: 'Part of the plan went through and part did not.'
  },
  VALIDATION_FAILED: {
    fa: 'جزئیات این درخواست برای اجرا کامل نیست. لطفاً دارایی و مبلغ را مشخص کنید.',
    en: 'This request is missing details I need before anything can be signed.'
  },
  ALLOWANCE_REQUIRED: {
    fa: 'قبل از این معامله باید مجوز خرج‌کردن توکن را در کیف پول تأیید کنید.',
    en: 'The wallet still needs to approve spending this token before the trade can run.'
  },
  UNKNOWN: {
    fa: 'نتوانستم این کار را کامل کنم. دارایی شما جابه‌جا نشده است.',
    en: 'I could not complete this. Nothing moved.'
  }
});

const CODE_ALIASES = Object.freeze({
  WALLET_REQUIRED: 'WALLET_REQUIRED',
  WALLET_SIGNATURE_REQUIRED: 'WALLET_SIGNATURE_REQUIRED',
  USER_REJECTED: 'USER_REJECTED',
  WALLET_REJECTED: 'USER_REJECTED',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  BALANCE_INSUFFICIENT: 'INSUFFICIENT_FUNDS',
  INSUFFICIENT_GAS: 'INSUFFICIENT_GAS',
  SLIPPAGE_EXCEEDED: 'SLIPPAGE_EXCEEDED',
  SLIPPAGE_MOVED: 'SLIPPAGE_EXCEEDED',
  TERMS_CHANGED: 'SLIPPAGE_EXCEEDED',
  SIMULATION_FAILED: 'SIMULATION_FAILED',
  SIMULATION_REVERT: 'SIMULATION_FAILED',
  CONFIRMATION_FAILED: 'CONFIRMATION_FAILED',
  NO_RECEIPT: 'CONFIRMATION_FAILED',
  BROADCAST_FAILED: 'BROADCAST_FAILED',
  SUBMIT_REJECTED: 'BROADCAST_FAILED',
  NO_BROADCASTER: 'BROADCAST_FAILED',
  PROVIDER_FAILED: 'PROVIDER_FAILED',
  PROVIDER_ERROR: 'PROVIDER_FAILED',
  NO_QUOTE: 'PROVIDER_FAILED',
  NO_PROVIDER: 'PROVIDER_FAILED',
  NETWORK_FAILED: 'NETWORK_FAILED',
  NETWORK_UNAVAILABLE: 'NETWORK_FAILED',
  QUOTE_NETWORK: 'NETWORK_FAILED',
  TIMEOUT: 'NETWORK_FAILED',
  NO_ROUTE: 'NO_ROUTE',
  EMPTY_PORTFOLIO: 'EMPTY_PORTFOLIO',
  UNPRICED_HOLDINGS: 'UNPRICED_HOLDINGS',
  EXPIRED: 'EXPIRED',
  DEADLINE_PASSED: 'EXPIRED',
  QUOTE_STALE: 'EXPIRED',
  PARTIAL: 'PARTIAL',
  PARTIAL_FILL: 'PARTIAL',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INVALID_ACTION: 'VALIDATION_FAILED',
  AMOUNT_INVALID: 'VALIDATION_FAILED',
  UNSUPPORTED_ACTION: 'VALIDATION_FAILED',
  ALLOWANCE_REQUIRED: 'ALLOWANCE_REQUIRED',
  EXECUTION_FAILED: 'UNKNOWN'
});

function langOf(locale) {
  const code = String(locale || 'fa').toLowerCase();
  return code.startsWith('fa') || code.startsWith('ar') ? 'fa' : 'en';
}

export function normalizeErrorCode(code) {
  const raw = String(code || 'UNKNOWN').toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  return CODE_ALIASES[raw] || (COPY[raw] ? raw : 'UNKNOWN');
}

/**
 * Human message for a backend / wallet / chain error.
 *
 * Extra numbers (haveUsd, needUsd, reason) are appended when present so the
 * user can act, not just read a mood.
 */
export function humanizeError(code, { locale = 'fa', haveUsd = null, needUsd = null, detail = null, retry = true } = {}) {
  const key = normalizeErrorCode(code);
  const lang = langOf(locale);
  let message = COPY[key]?.[lang] || COPY.UNKNOWN[lang];
  if (key === 'INSUFFICIENT_FUNDS') {
    const have = Number.isFinite(Number(haveUsd)) ? Number(haveUsd) : null;
    const need = Number.isFinite(Number(needUsd)) ? Number(needUsd) : null;
    if (lang === 'fa') {
      if (have != null) message += `\n\nموجودی فعلی:\n$${Math.round(have).toLocaleString('en-US')}`;
      if (need != null) message += `\nمبلغ مورد نیاز:\n$${Math.round(need).toLocaleString('en-US')}`;
      message += '\n\nمی‌توانم برنامه را با موجودی فعلی دوباره تنظیم کنم.';
    } else {
      if (have != null) message += `\n\nCurrent balance:\n$${Math.round(have).toLocaleString('en-US')}`;
      if (need != null) message += `\nAmount needed:\n$${Math.round(need).toLocaleString('en-US')}`;
      message += '\n\nI can rebuild the plan around the balance you have.';
    }
  }
  if (key === 'PARTIAL' && detail) {
    message += `\n\n${String(detail).slice(0, 400)}`;
  }
  return {
    schema: ERROR_HUMANIZER_SCHEMA,
    code: key,
    message,
    retry: retry !== false && !['VALIDATION_FAILED', 'EMPTY_PORTFOLIO'].includes(key),
    ui: key === 'WALLET_REQUIRED' ? 'CONNECT_WALLET' : 'TEXT'
  };
}
