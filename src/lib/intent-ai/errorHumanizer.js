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
  BRIDGE_EXECUTE_UNAVAILABLE: {
    fa: 'اجرای بریج در گفت‌وگو پشتیبانی نمی‌شود؛ مسیر عمومی سواپ برای بریج استفاده نشد و هیچ تراکنشی ساخته یا ارسال نشد. می‌توانید فقط صفحهٔ بریج را برای بررسی جداگانه باز کنید.',
    en: 'Bridge execution is not available in chat. The generic swap route was not used, and no transaction was built or sent. You can open the bridge page for a separate review.'
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
  PORTFOLIO_SYNC_RETRY: {
    fa: 'کیف پول متصل است اما خواندن موجودی از زنجیره کامل نشد — در حال تلاش دوباره‌ام؛ دارایی‌ها پنهان نیستند.',
    en: 'The wallet is connected but the chain read failed — retrying now; your assets are not hidden.'
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
  ALLOWANCE_READ_FAILED: {
    fa: 'نتوانستم مجوز خرج‌کردن توکن را از شبکه بررسی کنم؛ برای ایمنی هیچ تراکنشی ساخته نشد.',
    en: 'I could not verify the token allowance on-chain, so no transaction was built.'
  },
  QUOTE_REVIEW_REQUIRED: {
    fa: 'پیش‌نمایش نرخ این معامله موجود نیست. لطفاً درخواست را دوباره بفرستید تا نرخ زنده را ببینید.',
    en: 'This trade has no attached quote review. Send the request again to obtain a live quote.'
  },
  QUOTE_REVIEW_EXPIRED: {
    fa: 'زمان اعتبار پیش‌نمایش نرخ تمام شد. برای ادامه، نرخ تازه را دوباره بررسی و تأیید کنید.',
    en: 'The reviewed quote expired. Fetch and review a fresh quote before continuing.'
  },
  QUOTE_CHANGED: {
    fa: 'شرایط نرخ یا مسیر پس از بررسی شما تغییر کرد. هیچ تراکنشی امضا نشد؛ نرخ تازه را دوباره بررسی کنید.',
    en: 'The route or quote terms changed after your review. Nothing was signed; review a fresh quote.'
  },
  BALANCE_UNVERIFIED: {
    fa: 'موجودی توکن روی شبکهٔ مبدأ را نتوانستم دوباره تأیید کنم؛ برای ایمنی متوقف شدم.',
    en: 'I could not re-verify the source-token balance on-chain, so I stopped for safety.'
  },
  AMOUNT_UNIT_REQUIRED: {
    fa: 'واحد مبلغ مشخص نیست. لطفاً مبلغ را با نماد توکن یا به‌صورت دلار مشخص کنید.',
    en: 'The amount unit is ambiguous. Specify the token unit or an explicit USD amount.'
  },
  CHAIN_MISMATCH: {
    fa: 'کیف پول روی شبکهٔ انتخاب‌شده نیست. تراکنش امضا نشد.',
    en: 'The wallet is not connected to the selected network. Nothing was signed.'
  },
  CHAIN_SWITCH_FAILED: {
    fa: 'تعویض شبکه در کیف پول انجام نشد. هیچ تراکنشی ارسال نشد.',
    en: 'The wallet could not switch to the selected network. Nothing was sent.'
  },
  UNSUPPORTED_CHAIN: {
    fa: 'این شبکه در مسیر اجرای امن این معامله پشتیبانی نمی‌شود.',
    en: 'This network is not supported by the reviewed swap execution path.'
  },
  TOKEN_NOT_LISTED: {
    fa: 'آدرس توکن روی این شبکه در فهرست معتبر این مسیر نیست؛ از نماد مشابه حدس نمی‌زنم.',
    en: 'This token is not in the verified token list for the selected network; I will not guess from its ticker.'
  },
  LENDING_REVIEW_REQUIRED: {
    fa: 'برای این سپرده‌گذاری یا وام‌گیری، بررسی زندهٔ مبلغ، نرخ و قیمتِ تأییدشده همراه درخواست نیست. چیزی امضا نشد؛ دارایی، شبکه و مبلغ دقیق را در چت بنویسید تا بررسی تازه ساخته شود.',
    en: 'This supply or borrow has no confirmed live review of the exact amount, rate and price attached. Nothing was signed; ask in chat with the asset, network and exact amount to get a fresh review.'
  },
  LENDING_REVIEW_EXPIRED: {
    fa: 'مهلت بررسی نرخ و قیمت تمام شد. چیزی امضا نشد؛ درخواست را دوباره بفرستید تا بررسی تازه ساخته شود.',
    en: 'The rate-and-price review expired. Nothing was signed; send the request again to get a fresh review.'
  },
  LENDING_MARKET_UNAVAILABLE: {
    fa: 'وضعیت زندهٔ این بازار قابل‌تأیید نیست (reserve متوقف یا منجمد، قیمت اوراکل یا نرخ کهنه/ناقص، یا سقف و نقدینگی نامشخص). برای ایمنی چیزی امضا نشد.',
    en: 'The live state of this market could not be verified (a paused or frozen reserve, a stale or partial rate or oracle price, or unknown caps and liquidity). Nothing was signed, to be safe.'
  },
  BORROW_LIMIT_EXCEEDED: {
    fa: 'مبلغ وام از ظرفیت وام‌گیری، نقدینگی یا سقف قابل‌تأییدِ این بازار بیشتر است. چیزی امضا نشد؛ مبلغ کمتری را بررسی کنید.',
    en: 'The borrow amount exceeds the verified borrowing capacity, pool liquidity or cap. Nothing was signed; review a smaller amount.'
  },
  HEALTH_FACTOR_TOO_LOW: {
    fa: 'Health Factor پس از این وام از حداقل ایمن این بررسی (۱٫۲۰) کمتر می‌شود و ریسک لیکوییدیشن بالاست. چیزی امضا نشد.',
    en: 'The health factor after this borrow would fall below this review’s safety minimum (1.20), which raises liquidation risk. Nothing was signed.'
  },
  BORROW_POSITION_UNAVAILABLE: {
    fa: 'وثیقه، بدهی و ظرفیت وام‌گیری حساب شما از pool قابل‌تأیید نیست؛ ظرفیت را حدس نمی‌زنم و چیزی امضا نشد.',
    en: 'Your collateral, debt and borrowing capacity could not be verified from the pool. I will not guess capacity; nothing was signed.'
  },
  AMOUNT_PRECISION_INVALID: {
    fa: 'مبلغ بیش از دقت اعشاری مجاز این توکن رقم دارد. چیزی گرد یا امضا نشد؛ مبلغ را با دقت معتبر دوباره بنویسید.',
    en: 'The amount has more decimal places than this token supports. Nothing was rounded or signed; re-enter it with valid precision.'
  },
  LENDING_PARTIAL: {
    fa: 'مرحلهٔ مجوز انجام شد اما مرحلهٔ اصلی کامل نشد؛ سپرده یا وامی ثبت‌شده اعلام نمی‌شود. ممکن است مجوز هم‌اندازهٔ همان مبلغ روی توکن باقی بماند؛ می‌توانید آن را از صفحهٔ مجوزها لغو کنید.',
    en: 'The approval step went through but the main step did not complete, so no deposit or loan is reported. An exact-amount token allowance may remain; you can revoke it from the approvals screen.'
  },
  WALLET_ACCOUNT_CHANGED: {
    fa: 'حساب فعال کیف پول با حسابی که این بررسی برایش ساخته شد یکی نیست. چیزی امضا نشد؛ حساب را برگردانید یا درخواست را دوباره بفرستید.',
    en: 'The active wallet account is not the account this review was built for. Nothing was signed; switch back or send the request again.'
  },
  PLAN_MISMATCH: {
    fa: 'برنامه‌ای که ساخته شد با مبلغ و شرایطی که تأیید کردید یکی نیست. چیزی امضا نشد.',
    en: 'The plan that was built does not match the amount and terms you confirmed. Nothing was signed.'
  },
  FARM_EXECUTOR_UNAVAILABLE: {
    fa: 'اجرای فارم/LP در چت پشتیبانی نمی‌شود و سپردهٔ Aave جایگزین فارم نیست. هیچ تراکنشی ساخته یا ارسال نشد. صفحهٔ فارم را فقط برای بررسی گزینه‌ها باز کنید.',
    en: 'Farm/LP execution is not available in chat, and an Aave deposit is not a substitute for it. No transaction was built or sent. Open the farm page only to inspect options.'
  },
  LENDING_VENUE_UNAVAILABLE: {
    fa: 'برای این عملیات وام یا سپرده مسیر اجرای تأییدشده‌ای وجود ندارد؛ مسیر سواپ جایگزین نمی‌شود و چیزی ساخته یا ارسال نشد.',
    en: 'There is no verified execution path for this lending action. The swap route is not substituted; nothing was built or sent.'
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
  EXECUTION_FAILED: 'UNKNOWN',
  /* Lending venue codes (executor → plain language). The executor keeps
     granular codes for logs and tests; the chat speaks in a few honest ones. */
  RATE_STALE: 'LENDING_MARKET_UNAVAILABLE',
  ORACLE_PRICE_UNAVAILABLE: 'LENDING_MARKET_UNAVAILABLE',
  RESERVE_UNAVAILABLE: 'LENDING_MARKET_UNAVAILABLE',
  RESERVE_PAUSED: 'LENDING_MARKET_UNAVAILABLE',
  RESERVE_NOT_ACTIVE: 'LENDING_MARKET_UNAVAILABLE',
  RESERVE_DATA_PARTIAL: 'LENDING_MARKET_UNAVAILABLE',
  DECIMALS_UNVERIFIED: 'LENDING_MARKET_UNAVAILABLE',
  LENDING_RATE_UNAVAILABLE: 'LENDING_MARKET_UNAVAILABLE',
  BORROW_DISABLED: 'LENDING_MARKET_UNAVAILABLE',
  SUPPLY_CAP_EXCEEDED: 'LENDING_MARKET_UNAVAILABLE',
  SUPPLY_CAP_UNVERIFIED: 'LENDING_MARKET_UNAVAILABLE',
  BORROW_CAP_UNVERIFIED: 'LENDING_MARKET_UNAVAILABLE',
  BORROW_LIQUIDITY_UNAVAILABLE: 'LENDING_MARKET_UNAVAILABLE',
  ASSET_MISMATCH: 'LENDING_MARKET_UNAVAILABLE',
  VENUE_UNSUPPORTED_CHAIN: 'LENDING_MARKET_UNAVAILABLE',
  ASSET_NOT_LISTED: 'TOKEN_NOT_LISTED',
  BORROW_LIQUIDITY_EXCEEDED: 'BORROW_LIMIT_EXCEEDED',
  BORROW_CAP_EXCEEDED: 'BORROW_LIMIT_EXCEEDED',
  BORROW_CAPACITY_UNAVAILABLE: 'BORROW_POSITION_UNAVAILABLE',
  AAVE_INSUFFICIENT_BALANCE: 'INSUFFICIENT_FUNDS',
  AAVE_NATIVE_GAS_FLOOR: 'INSUFFICIENT_GAS',
  AAVE_NATIVE_BALANCE_UNKNOWN: 'BALANCE_UNVERIFIED',
  AAVE_GAS_FLOOR_UNKNOWN: 'BALANCE_UNVERIFIED',
  AAVE_BALANCE_UNREADABLE: 'BALANCE_UNVERIFIED',
  AAVE_RESERVE_INACTIVE: 'LENDING_MARKET_UNAVAILABLE',
  AAVE_RESERVE_PAUSED: 'LENDING_MARKET_UNAVAILABLE',
  AAVE_RESERVE_FROZEN: 'LENDING_MARKET_UNAVAILABLE',
  AAVE_RESERVE_UNREADABLE: 'LENDING_MARKET_UNAVAILABLE',
  AAVE_SUPPLY_CAP_UNKNOWN: 'LENDING_MARKET_UNAVAILABLE',
  AAVE_SUPPLY_CAP_EXCEEDED: 'LENDING_MARKET_UNAVAILABLE',
  AAVE_INVALID_AMOUNT: 'AMOUNT_PRECISION_INVALID',
  AAVE_BAD_AMOUNT: 'AMOUNT_PRECISION_INVALID',
  CHAIN_UNVERIFIED: 'CHAIN_MISMATCH',
  NO_TX_HASH: 'CONFIRMATION_FAILED',
  NO_SIGNER: 'PROVIDER_FAILED',
  NO_PLAN: 'PROVIDER_FAILED',
  VENUE_DRIVER_MISSING: 'PROVIDER_FAILED',
  NO_LENDING_DRIVER: 'PROVIDER_FAILED',
  NO_AAVE_BASE_DRIVER: 'PROVIDER_FAILED',
  LENDING_FAILED: 'BROADCAST_FAILED',
  AAVE_BASE_TX_FAILED: 'BROADCAST_FAILED'
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
