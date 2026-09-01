/**
 * LENDING ENGINE — unified error taxonomy (§14 of the production spec).
 * ---------------------------------------------------------------------------
 * Rule zero of lending errors: a raw RPC or wallet error never reaches the
 * user. "execution reverted: 0x12…" teaches nothing; "The collateral value
 * changed before confirmation — try again" tells the user what to do.
 *
 * Every failure in the lending pipeline maps to ONE stable code. Each code
 * carries:
 *   · `retryable` — whether pressing the same button again can help
 *   · `kind`      — who owns the failure (user / wallet / validation / risk /
 *                   protocol / simulation / transaction / infrastructure)
 * The UI renders the code through its own i18n keys (`loan.error.<CODE>`);
 * `describeError` is the server/notification fallback in plain English.
 *
 * The list below is the spec's §14 table plus the codes the engine itself
 * emits (WALLET_NOT_CONNECTED, READ_ONLY_MODE, IDEMPOTENCY_CONFLICT, …).
 */

export const LENDING_ERRORS = Object.freeze({
  USER_REJECTED:          { retryable: true,  kind: 'user' },
  WALLET_NOT_CONNECTED:   { retryable: true,  kind: 'wallet' },
  WRONG_NETWORK:          { retryable: true,  kind: 'wallet' },

  AMOUNT_REQUIRED:        { retryable: false, kind: 'validation' },
  UNSUPPORTED_CHAIN:      { retryable: false, kind: 'validation' },
  NOT_A_RESERVE:          { retryable: false, kind: 'validation' },
  INSUFFICIENT_BALANCE:   { retryable: false, kind: 'validation' },
  INSUFFICIENT_ALLOWANCE: { retryable: true,  kind: 'validation' },

  BORROW_LIMIT_EXCEEDED:  { retryable: false, kind: 'risk' },
  HEALTH_FACTOR_TOO_LOW:  { retryable: false, kind: 'risk' },
  ORACLE_ANOMALY:         { retryable: false, kind: 'risk' },
  SLIPPAGE:               { retryable: true,  kind: 'quote' },

  MARKET_PAUSED:          { retryable: false, kind: 'protocol' },
  PROTOCOL_UNAVAILABLE:   { retryable: true,  kind: 'protocol' },

  RPC_ERROR:              { retryable: true,  kind: 'infrastructure' },
  ORACLE_STALE:           { retryable: true,  kind: 'infrastructure' },
  INDEXER_DELAY:          { retryable: true,  kind: 'infrastructure' },
  READ_ONLY_MODE:         { retryable: true,  kind: 'infrastructure' },

  GAS_ESTIMATION_FAILED:  { retryable: true,  kind: 'simulation' },
  SIMULATION_FAILED:      { retryable: false, kind: 'simulation' },

  TRANSACTION_REVERTED:   { retryable: true,  kind: 'transaction' },
  TRANSACTION_PENDING:    { retryable: false, kind: 'transaction' },
  TRANSACTION_DROPPED:    { retryable: true,  kind: 'transaction' },

  IDEMPOTENCY_CONFLICT:   { retryable: false, kind: 'duplicate' },
  UNKNOWN:                { retryable: true,  kind: 'unknown' }
});

export const ERROR_KINDS = Object.freeze([...new Set(Object.values(LENDING_ERRORS).map((e) => e.kind))]);

/** True when pressing the same button again is a sane next step. */
export const isRetryable = (code) => Boolean(LENDING_ERRORS[code]?.retryable);

/** One short, honest sentence per code — the fallback when no i18n key exists. */
export const describeError = (code, lang = 'en') => {
  const en = {
    USER_REJECTED: 'You rejected the request in your wallet. Nothing was sent.',
    WALLET_NOT_CONNECTED: 'Connect a wallet first.',
    WRONG_NETWORK: 'Switch your wallet to the selected network.',
    AMOUNT_REQUIRED: 'Enter an amount greater than zero.',
    UNSUPPORTED_CHAIN: 'Lending is not available on this network.',
    NOT_A_RESERVE: 'This asset is not a market on the selected protocol.',
    INSUFFICIENT_BALANCE: 'Your wallet balance is too low for this amount.',
    INSUFFICIENT_ALLOWANCE: 'The pool needs approval to use this token.',
    BORROW_LIMIT_EXCEEDED: 'This amount is above your borrowing limit.',
    HEALTH_FACTOR_TOO_LOW: 'This would push your health factor below the safe limit.',
    ORACLE_ANOMALY: 'The price feed looks abnormal. New risky transactions are paused.',
    SLIPPAGE: 'The quote moved before confirmation. Try again.',
    MARKET_PAUSED: 'This market is currently paused by the protocol.',
    PROTOCOL_UNAVAILABLE: 'The lending protocol is not answering right now. Try again.',
    RPC_ERROR: 'The network connection failed. Try again in a moment.',
    ORACLE_STALE: 'The price feed is stale. Try again in a moment.',
    INDEXER_DELAY: 'Position data is still syncing. It will appear shortly.',
    READ_ONLY_MODE: 'Lending is in read-only mode while network data is verified.',
    GAS_ESTIMATION_FAILED: 'The network could not estimate this transaction.',
    SIMULATION_FAILED: 'The transaction would fail on-chain. Check the amount and try again.',
    TRANSACTION_REVERTED: 'The transaction could not be completed. Your position may have changed before confirmation.',
    TRANSACTION_PENDING: 'The transaction is still confirming. Please wait.',
    TRANSACTION_DROPPED: 'The transaction was dropped by the network. Nothing was spent.',
    IDEMPOTENCY_CONFLICT: 'This exact action is already in progress.',
    UNKNOWN: 'Something went wrong. Please try again.'
  };
  const fa = {
    USER_REJECTED: 'درخواست را در کیف پول رد کردید. چیزی ارسال نشد.',
    WALLET_NOT_CONNECTED: 'اول کیف پول را وصل کنید.',
    WRONG_NETWORK: 'کیف پول را به شبکهٔ انتخاب‌شده تغییر دهید.',
    AMOUNT_REQUIRED: 'مبلغی بزرگ‌تر از صفر وارد کنید.',
    UNSUPPORTED_CHAIN: 'وام‌دهی در این شبکه فعال نیست.',
    NOT_A_RESERVE: 'این دارایی در پروتکل انتخابی بازار ندارد.',
    INSUFFICIENT_BALANCE: 'موجودی کیف پول برای این مبلغ کافی نیست.',
    INSUFFICIENT_ALLOWANCE: 'پروتکل برای استفاده از این توکن به تأیید نیاز دارد.',
    BORROW_LIMIT_EXCEEDED: 'این مبلغ بالاتر از سقف وام شماست.',
    HEALTH_FACTOR_TOO_LOW: 'این کار ضریب سلامت را زیر حد امن می‌برد.',
    ORACLE_ANOMALY: 'فید قیمت غیرعادی است. تراکنش‌های پرریسک جدید متوقف شدند.',
    SLIPPAGE: 'قیمت قبل از تأیید تغییر کرد. دوباره تلاش کنید.',
    MARKET_PAUSED: 'این بازار فعلاً توسط پروتکل متوقف است.',
    PROTOCOL_UNAVAILABLE: 'پروتکل وام‌دهی پاسخ نمی‌دهد. دوباره تلاش کنید.',
    RPC_ERROR: 'اتصال شبکه برقرار نشد. لحظاتی بعد دوباره تلاش کنید.',
    ORACLE_STALE: 'فید قیمت قدیمی است. لحظاتی بعد دوباره تلاش کنید.',
    INDEXER_DELAY: 'دادهٔ پوزیشن هنوز در حال همگام‌سازی است و به‌زودی نمایش داده می‌شود.',
    READ_ONLY_MODE: 'وام‌دهی تا تأیید داده‌های شبکه فقط‌خواندنی است.',
    GAS_ESTIMATION_FAILED: 'شبکه نتوانست این تراکنش را برآورد کند.',
    SIMULATION_FAILED: 'این تراکنش روی زنجیره شکست می‌خورد. مبلغ را بررسی و دوباره تلاش کنید.',
    TRANSACTION_REVERTED: 'تراکنش کامل نشد. ممکن است ارزش وثیقه قبل از تأیید تغییر کرده باشد.',
    TRANSACTION_PENDING: 'تراکنش هنوز در حال تأیید است. لطفاً صبر کنید.',
    TRANSACTION_DROPPED: 'تراکنش توسط شبکه رها شد. هزینه‌ای پرداخت نشد.',
    IDEMPOTENCY_CONFLICT: 'همین عملیات در حال انجام است.',
    UNKNOWN: 'مشکلی پیش آمد. لطفاً دوباره تلاش کنید.'
  };
  return (lang === 'fa' ? fa : en)[code] ?? (lang === 'fa' ? fa.UNKNOWN : en.UNKNOWN);
};

/**
 * Map a raw error (wallet/EIP-1193, ethers, JSON-RPC, protocol revert) to one
 * stable code. The raw message is used only for matching, never for display;
 * `rawSanitized` is a short, hex-stripped diagnostic for logs/tests only.
 */
export function mapRawError(error, { fallback = 'UNKNOWN' } = {}) {
  const message = String(error?.message || error?.reason || error || '');
  const code = error?.code;
  const lowered = message.toLowerCase();
  const hex = message.replace(/0x[0-9a-fA-F]+/g, '0x…');

  if (code === 4001 || code === 'ACTION_REJECTED' || error?.action === 'requestAccounts'
    || /user\s*(rejected|denied|cancell?ed|refused)/i.test(lowered)
    || /rejected\s*(the\s*)?(request|transaction|signature)/i.test(lowered)
    || /signature\s*denied/i.test(lowered)) {
    return { code: 'USER_REJECTED', retryable: true, rawSanitized: hex.slice(0, 160) };
  }
  if (/insufficient funds|not enough (funds|balance)|exceeds balance/i.test(lowered)) {
    return { code: 'INSUFFICIENT_BALANCE', retryable: false, rawSanitized: hex.slice(0, 160) };
  }
  if (/allowance|insufficient approval|erc20: transfer amount exceeds allowance/i.test(lowered)) {
    return { code: 'INSUFFICIENT_ALLOWANCE', retryable: true, rawSanitized: hex.slice(0, 160) };
  }
  if (/paused|market.*paused|reserve.*paused|frozen/i.test(lowered)) {
    return { code: 'MARKET_PAUSED', retryable: false, rawSanitized: hex.slice(0, 160) };
  }
  if (/borrow.*(limit|cap)|not enough.*(liquidity|collateral|borrow)|insufficient.*liquidity|collateral.*(insufficient|needed)/i.test(lowered)) {
    return { code: 'BORROW_LIMIT_EXCEEDED', retryable: false, rawSanitized: hex.slice(0, 160) };
  }
  if (/health factor|liq(uidation)?.*(threshold|risk)|h*[fF].*< *1/i.test(lowered)) {
    return { code: 'HEALTH_FACTOR_TOO_LOW', retryable: false, rawSanitized: hex.slice(0, 160) };
  }
  if (/stale|oracle.*(failed|error)|price.*(feed|oracle)/i.test(lowered)) {
    return { code: 'ORACLE_STALE', retryable: true, rawSanitized: hex.slice(0, 160) };
  }
  if (/slippage|min.*(received|amount)|price.*(moved|changed)/i.test(lowered)) {
    return { code: 'SLIPPAGE', retryable: true, rawSanitized: hex.slice(0, 160) };
  }
  if (/gas required exceeds|gas.*limit|max fee|intrinsic gas|cannot estimate gas|estimation/i.test(lowered)) {
    return { code: 'GAS_ESTIMATION_FAILED', retryable: true, rawSanitized: hex.slice(0, 160) };
  }
  if (/execution reverted|reverted|revert\b|vm exception|out of gas/i.test(lowered)) {
    return { code: 'TRANSACTION_REVERTED', retryable: true, rawSanitized: hex.slice(0, 160) };
  }
  if (/nonce.*(too low|already)|replacement transaction underpriced|already known|dropped|replaced/i.test(lowered)) {
    return { code: 'TRANSACTION_DROPPED', retryable: true, rawSanitized: hex.slice(0, 160) };
  }
  if (/network|timeout|timed out|fetch failed|connection|econnreset|enotfound|rate limit|429|too many requests|503/i.test(lowered)) {
    return { code: 'RPC_ERROR', retryable: true, rawSanitized: hex.slice(0, 160) };
  }
  if (code === 4902 || /unsupported chain|wrong network|chain id/i.test(lowered)) {
    return { code: 'WRONG_NETWORK', retryable: true, rawSanitized: hex.slice(0, 160) };
  }

  /* Codes the engine itself already produced pass through untouched. */
  if (typeof code === 'string' && LENDING_ERRORS[code]) {
    return { code, retryable: LENDING_ERRORS[code].retryable, rawSanitized: hex.slice(0, 160) };
  }

  return { code: fallback in LENDING_ERRORS ? fallback : 'UNKNOWN', retryable: LENDING_ERRORS[fallback]?.retryable ?? true, rawSanitized: hex.slice(0, 160) };
}
