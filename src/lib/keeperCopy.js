/**
 * The copy for the two execution modes of a limit order.
 *
 * Kept in one module rather than in the twelve locale files on purpose: the
 * Persian mode labels are product wording that was specified exactly, and the
 * locale files are checked for key gaps across all twelve languages. Every
 * string here is reachable from the sheet, and any language without its own
 * entry falls back to English, never to a raw key.
 *
 * Wording rules that are enforced by tests (test/keeper-orders-units.mjs):
 *   · no sentence promises a guaranteed fee or a guaranteed fill;
 *   · the fill notice says what happened, not what it earned.
 */

const FA = {
  mode1Title: '⚡ اجرای خودکار روی زنجیره (On-Chain Keeper)',
  mode1Body:
    'سفارش روی زنجیره ثبت می‌شود و شبکهٔ solver (CoW Protocol) یا Jupiter آن را، وقتی قیمت به حداقل تعیین‌شده رسید، بدون نیاز به باز بودن برنامه اجرا می‌کند. امضای شما فقط برای ثبت سفارش است؛ کلید خصوصی شما هرگز از کیف پول خارج نمی‌شود و تأیید بی‌نهایت (Unlimited Approval) داده نمی‌شود.',
  mode1Note:
    'فقط توکن‌های ERC-20 و SPL روی Ethereum، Arbitrum، Base، Polygon، BNB Chain، Avalanche و Solana. کارمزد ۰٫۷٪ پلتفرم در سفارش ثبت می‌شود، اما اعمال آن به قوانین شبکهٔ solver بستگی دارد و برای سفارش‌های حد ممکن است اعمال نشود.',
  mode2Title: '🔔 رصد قیمت + تأیید یک‌لمسی با اعلان',
  mode2Body:
    'قیمت روی سرور رصد می‌شود و وقتی به هدف رسید برای شما اعلان می‌فرستیم. سپس با یک لمس و امضای خودتان سواپ انجام می‌شود؛ تا قبل از تأیید شما هیچ تراکنشی ارسال نمی‌شود. این حالت برای هر ۱۶ شبکهٔ EVM و توکن‌های بومی (ETH، BNB، POL، AVAX) در دسترس است.',
  badgeKeeper: 'اجرای خودکار (Solver)',
  badgeWatch: 'نیازمند امضا پس از اعلان',
  minRateLabel: 'حداقل نرخ دریافتی (TO به‌ازای ۱ FROM)',
  nativeWarn:
    'توکن بومی را solver مستقیماً نمی‌فروشد. با تأیید شما ابتدا به توکن wrapped (مثلاً WETH) تبدیل می‌شود؛ این یک تراکنش جداگانه و قابل‌مشاهده است.',
  wrapAndPlace: 'تبدیل و ثبت سفارش خودکار',
  placeKeeper: 'ثبت سفارش خودکار',
  stageApprove: 'تأیید مجوز برای مقدار دقیق سفارش…',
  stageSign: 'امضا در کیف پول شما…',
  stageSubmit: 'ارسال سفارش به شبکهٔ solver…',
  stageWrap: 'تبدیل توکن بومی…',
  viewOnExplorer: 'مشاهده در CoW Explorer',
  viewOnSolscan: 'مشاهده در Solscan',
  uidLabel: 'شناسه سفارش',
  stateOpen: 'باز — منتظر قیمت',
  stateFilled: 'پر شد',
  stateCancelled: 'لغو شد',
  stateExpired: 'منقضی شد',
  stateNotOpen: 'دیگر در لیست باز نیست — در Solscan بررسی کنید',
  solanaNote:
    'Solana از طریق Jupiter Trigger اجرا می‌شود. سفارش با امضای کیف پول شما روی زنجیره ثبت می‌شود و دارایی‌ها تا لحظهٔ اجرا در کیف پول شما می‌مانند.',
  modeUnavailable: 'این توکن یا شبکه برای اجرای خودکار پشتیبانی نمی‌شود؛ از رصد قیمت استفاده کنید.',
  err: {
    NATIVE_NOT_WRAPPED: 'برای فروش توکن بومی ابتدا آن را تبدیل کنید.',
    WALLET_REQUIRED: 'ابتدا کیف پول را متصل کنید.',
    WRONG_NETWORK: 'کیف پول روی شبکهٔ سفارش نیست. شبکه را در کیف پول عوض کنید و دوباره تلاش کنید.',
    REJECTED: 'درخواست در کیف پول رد شد. چیزی ثبت نشد.',
    SIGN_OR_APPROVE_FAILED: 'تأیید یا امضا کامل نشد. چیزی روی زنجیره ارسال نشده است، می‌توانید دوباره تلاش کنید.',
    RELAY_FAILED: 'سفارش امضا شد اما به شبکهٔ solver نرسید. دوباره تلاش کنید؛ امضای قبلی را استفاده نمی‌شود.',
    UNSUPPORTED_CHAIN: 'این شبکه برای اجرای خودکار پشتیبانی نمی‌شود.',
    BAD_AMOUNT: 'مقدار فروش معتبر نیست یا بیش از دقت توکن است.',
    BAD_RATE: 'حداقل نرخ معتبر نیست.',
    BAD_EXPIRY: 'مدت اعتبار سفارش معتبر نیست.',
    NOT_CONFIGURED: 'اجرای خودکار روی Solana در این سرور فعال نیست.'
  },
  errGeneric: 'ثبت سفارش خودکار انجام نشد. چیزی روی زنجیره ارسال نشده است.'
};

const EN = {
  mode1Title: '⚡ Automatic on-chain execution (On-Chain Keeper)',
  mode1Body:
    'The order is placed on-chain and the CoW solver network (or Jupiter) executes it once the price reaches your minimum, without the app being open. Your signature only places the order: the private key never leaves your wallet, and no unlimited approval is given.',
  mode1Note:
    'ERC-20 and SPL tokens only, on Ethereum, Arbitrum, Base, Polygon, BNB Chain, Avalanche and Solana. The 0.7% platform fee is recorded in the order, but whether the solver applies it to a limit order depends on its rules and may not apply.',
  mode2Title: '🔔 Price watch + one-tap confirm with a notification',
  mode2Body:
    'We watch the price on the server and notify you when it reaches the target. You then confirm with one tap and sign the swap yourself; no transaction is sent before your confirmation. Available on all 16 EVM networks and native tokens (ETH, BNB, POL, AVAX).',
  badgeKeeper: 'Automatic (Solver)',
  badgeWatch: 'Needs your signature after the alert',
  minRateLabel: 'Minimum received (TO per 1 FROM)',
  nativeWarn:
    'A solver cannot sell a native token directly. With your confirmation it is first wrapped (for example to WETH); this is a separate, visible transaction.',
  wrapAndPlace: 'Wrap and place automatic order',
  placeKeeper: 'Place automatic order',
  stageApprove: 'Approving the exact order amount…',
  stageSign: 'Signing in your wallet…',
  stageSubmit: 'Sending the order to the solver network…',
  stageWrap: 'Wrapping the native token…',
  viewOnExplorer: 'View on CoW Explorer',
  viewOnSolscan: 'View on Solscan',
  uidLabel: 'Order ID',
  stateOpen: 'Open — waiting for price',
  stateFilled: 'Filled',
  stateCancelled: 'Cancelled',
  stateExpired: 'Expired',
  stateNotOpen: 'No longer open — check Solscan',
  solanaNote:
    'Solana runs through Jupiter Trigger. The order is placed on-chain with your wallet signature, and your funds stay in your wallet until it executes.',
  modeUnavailable: 'This token or network does not support automatic execution; use price watch instead.',
  err: {
    NATIVE_NOT_WRAPPED: 'Wrap the native token first to sell it.',
    WALLET_REQUIRED: 'Connect your wallet first.',
    WRONG_NETWORK: 'Your wallet is not on the order network. Switch networks and try again.',
    REJECTED: 'The request was rejected in your wallet. Nothing was placed.',
    SIGN_OR_APPROVE_FAILED: 'Approval or signing did not complete. Nothing was sent on-chain; you can try again.',
    RELAY_FAILED: 'The order was signed but did not reach the solver network. Try again; the old signature is not reused.',
    UNSUPPORTED_CHAIN: 'This network does not support automatic execution.',
    BAD_AMOUNT: 'The sell amount is not valid or has more decimals than the token allows.',
    BAD_RATE: 'The minimum rate is not valid.',
    BAD_EXPIRY: 'The order expiry is not valid.',
    NOT_CONFIGURED: 'Automatic Solana execution is not enabled on this server.'
  },
  errGeneric: 'The automatic order was not placed. Nothing was sent on-chain.'
};

const AR = {
  ...EN,
  mode1Title: '⚡ التنفيذ التلقائي على السلسلة (On-Chain Keeper)',
  mode2Title: '🔔 مراقبة السعر + تأكيد بلمسة واحدة مع إشعار',
  badgeKeeper: 'تنفيذ تلقائي (Solver)',
  badgeWatch: 'يحتاج توقيعك بعد الإشعار'
};

const BY_LANG = { fa: FA, en: EN, ar: AR };

/** The copy for a language code. Unknown languages fall back to English. */
export function keeperCopyFor(lang) {
  const code = String(lang || '').split('-')[0].toLowerCase();
  return BY_LANG[code] || EN;
}
