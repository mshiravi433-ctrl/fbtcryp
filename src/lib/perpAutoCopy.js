/**
 * The copy for auto-orders that rest on a perpetual venue.
 *
 * Kept in one module rather than in the twelve locale files for the same
 * reason src/lib/keeperCopy.js is: the Persian wording here is product copy
 * that was specified exactly, and the locale files are checked for key gaps
 * across all twelve languages. Every string is reachable from the sheet, and a
 * language without its own entry falls back to English — never to a raw key.
 *
 * ─── WORDING RULES, ENFORCED BY test/perp-auto-orders-units.mjs ──────────────
 *   · nothing promises a profit, a guaranteed return, or a fill. The words
 *     «سود تضمینی», «درآمد قطعی» and «ربات پرسود» must not appear in any
 *     string in this file, in any language;
 *   · every risk line states that loss is possible and that the user signs;
 *   · the fee line says what WE earn, because a venue order that pays us and
 *     does not say so is the exact thing this repo refuses to ship;
 *   · a state we could not read says so, instead of showing a stale list as
 *     current.
 */

const FA = {
  sectionTitle: 'سفارش خودکار روی ونووهای پرپتوال',
  sectionBody:
    'این سفارش‌ها روی خودِ ونوو (dYdX یا Ostium) ثبت می‌شوند و همان‌جا اجرا می‌شوند؛ حتی وقتی برنامه بسته است. کلید خصوصی شما از کیف پول خارج نمی‌شود، دارایی شما نزد ما امانت نیست و هیچ سفارشی بدون امضای شما ارسال نمی‌شود.',
  openSheet: 'سفارش روی ونوو پرپتوال',
  cardSub: 'اجرا روی خودِ ونوو',
  heroChip1: 'اجرا روی خودِ ونوو',
  heroChip2: 'حتی وقتی برنامه بسته است',
  heroChip3: 'فقط با امضای شما',
  venueLabel: 'ونوو',
  venueSubDydx: 'زنجیرهٔ dYdX · لیمیت، تریگر، حد سود/ضرر',
  venueSubOstium: 'Arbitrum One · لیمیت، استاپ، حد سود/ضرر پروتکل',
  kindLabel: 'نوع سفارش',
  kinds: {
    'entry-limit': 'حد خرید/فروش (Limit) — باز شدن پوزیشن',
    'entry-stop': 'استاپ ورود (Stop) — باز شدن پوزیشن',
    'take-profit': 'حد سود (Take Profit) — بستن پوزیشن',
    'stop-loss': 'حد ضرر (Stop Loss) — بستن پوزیشن'
  },
  kindShort: {
    'entry-limit': 'لیمیت',
    'entry-stop': 'استاپ ورود',
    'take-profit': 'حد سود',
    'stop-loss': 'حد ضرر'
  },
  kindSub: {
    'entry-limit': 'باز شدن پوزیشن',
    'entry-stop': 'باز شدن پوزیشن',
    'take-profit': 'بستن پوزیشن',
    'stop-loss': 'بستن پوزیشن'
  },
  kindHelp: {
    dydxLimit:
      'سفارش روی دفتر سفارش‌های dYdX می‌نشیند و وقتی قیمت به عدد شما رسید پر می‌شود. اعتبار آن تا زمانی است که تعیین می‌کنید (حداکثر ۹۰ روز).',
    dydxTrigger:
      'سفارش شرطی روی خود dYdX ثبت می‌شود و وقتی قیمت اوراکل به عدد تریگر رسید، بدون نیاز به باز بودن برنامه اجرا می‌شود.',
    ostiumLimit:
      'سفارش لیمیت روی زنجیرهٔ Arbitrum ثبت می‌شود و شبکهٔ Ostium آن را وقتی قیمت رسید اجرا می‌کند. حد سود و حد ضرر هم در همان یک امضا ثبت می‌شوند و توسط پروتکل اعمال می‌شوند.',
    ostiumStop:
      'سفارش استاپ وقتی قیمت از عدد تریگر عبور کرد به‌صورت مارکت اجرا می‌شود. حد سود و حد ضرر در همان یک امضا ثبت و توسط پروتکل اعمال می‌شوند.'
    },
  marketLabel: 'بازار',
  marketsUnread: 'فهرست بازارها از ونوو خوانده نشد؛ بدون قیمت زنده سفارشی ثبت نمی‌شود.',
  sideLabel: 'جهت',
  sideBuy: 'خرید (Long)',
  sideSell: 'فروش (Short)',
  sideLong: 'لانگ',
  sideShort: 'شورت',
  detailsLabel: 'جزئیات سفارش',
  sizeLabel: 'اندازهٔ سفارش',
  sizeHint: 'واحد پایهٔ بازار (مثلاً ۰٫۰۰۱ برای BTC-USD)',
  priceLabel: 'قیمت',
  triggerLabel: 'قیمت تریگر',
  currentPriceLabel: 'قیمت فعلی',
  collateralLabel: 'وجه تضمین (USDC)',
  leverageLabel: 'اهرم',
  tpLabel: 'حد سود (اختیاری)',
  slLabel: 'حد ضرر (اختیاری)',
  expiryLabel: 'اعتبار سفارش',
  expiryOptions: {
    '1d': '۱ روز',
    '7d': '۷ روز',
    '28d': '۲۸ روز',
    '90d': '۹۰ روز'
  },
  expiryHint: 'تا پایان این مدت، سفارش روی خودِ ونوو منتظر قیمت می‌ماند.',
  slippageNote:
    'برای سفارش لیمیت و استاپ در Ostium مقدار اسلیپیج باید صفر باشد؛ این یک قاعدهٔ خودِ پروتکل است و مقدار غیرصفر باعث برگشت تراکنش می‌شود. به همین دلیل این فرم فیلد اسلیپیج ندارد.',
  reviewTitle: 'مرور سفارش',
  reviewVenue: 'ونوو',
  reviewKind: 'نوع',
  reviewMarket: 'بازار',
  reviewSide: 'جهت',
  reviewSize: 'اندازه',
  reviewPrice: 'قیمت',
  reviewTrigger: 'تریگر',
  reviewCollateral: 'وجه تضمین',
  reviewLeverage: 'اهرم',
  reviewNotional: 'ارزش اسمی پوزیشن',
  reviewTp: 'حد سود',
  reviewSl: 'حد ضرر',
  reviewExpiry: 'اعتبار تا',
  reviewFeeOurs: 'سهم پلتفرم',
  reviewFeeVenue: 'کارمزد ونوو',
  reviewFeeOracle: 'کارمزد اوراکل',
  reviewFeeTotal: 'مجموع هزینه',
  reviewFeeUnknown: 'کارمزد خودِ ونوو جداگانه و بر اساس قوانین آن محاسبه می‌شود.',
  feePctOfCollateral: 'معادل {{pct}}٪ از وجه تضمین شما',
  roundedNote: 'قیمت و اندازه به پلهٔ معاملاتی بازار گرد شدند؛ عددی که می‌بینید همان چیزی است که امضا می‌شود.',
  cancelCostNote:
    'لغو این سفارش کارمزد ثبت را برنمی‌گرداند: Ostium هنگام ثبت سفارش لیمیت/استاپ کارمزد اوراکل را از وجه تضمین کسر می‌کند.',
  warnTitle: 'هشدار',
  warnSub: 'ریسک، فرایند اجرا و نکته‌های قبل از امضا',
  howTitle: 'فرایند انجام کار',
  howStep1: 'عددها را شما تعیین می‌کنید و سفارش فقط با امضای کیف پول شما ساخته می‌شود.',
  howStep2: 'سفارش روی خودِ ونوو (dYdX یا Ostium) ثبت می‌شود، نه روی سرور ما.',
  howStep3: 'وقتی قیمت به عدد شما برسد، ونوو آن را اجرا می‌کند؛ حتی اگر برنامه بسته باشد.',
  riskTitle: 'قبل از امضا بدانید',
  riskBody:
    'معاملهٔ اهرم‌دار می‌تواند بخشی یا تمام وجه تضمین شما را از بین ببرد. هیچ سودی تضمین نمی‌شود و هیچ سیگنال یا پیشنهاد خرید و فروشی در این فرم وجود ندارد. عددی که وارد می‌کنید تصمیم خود شماست و اجرا بر عهدهٔ ونوو است.',
  nonCustodyBody:
    'ما هیچ کلیدی از شما نگه نمی‌داریم و به دارایی شما دسترسی نداریم. سفارش با امضای شما روی ونوو ثبت می‌شود و فقط همان ونوو می‌تواند آن را اجرا یا لغو کند.',
  place: 'امضا و ثبت سفارش روی ونوو',
  placing: 'در حال امضا و ثبت…',
  backLabel: 'بازگشت',
  placedTitle: 'سفارش روی ونوو ثبت شد',
  placedBody:
    'سفارش شما روی خودِ ونوو قرار گرفت و همان‌جا منتظر قیمت می‌ماند. وضعیت آن را از فهرست سفارش‌های همین پنجره یا در خودِ ونوو می‌بینید.',
  placedNew: 'سفارش جدید',
  placedClose: 'بستن',
  stageConnectDydx: 'اتصال به dYdX (یک امضای کیف پول)…',
  stageSwitchChain: 'تغییر شبکهٔ کیف پول به Arbitrum One…',
  stageApprove: 'تأیید مجوز USDC برای مقدار دقیق سفارش…',
  stageSign: 'امضا در کیف پول شما…',
  stageSubmit: 'ارسال به ونوو…',
  connectDydxFirst: 'برای ثبت سفارش، ابتدا اتصال dYdX را در همان برگه کامل کنید.',
  connectWalletFirst: 'ابتدا کیف پول را متصل کنید.',
  switchNetwork: 'کیف پول را روی Arbitrum One ببرید و دوباره تلاش کنید.',
  approveFirst: 'ابتدا مجوز USDC را برای مقدار دقیق این سفارش تأیید کنید.',
  viewOnExplorer: 'مشاهده در مرورگر بلاک‌چین',
  listTitle: 'سفارش‌های ثبت‌شده روی ونوو',
  listDone: 'سفارش‌های پایان‌یافته',
  listEmpty: 'هنوز سفارش پرپتوالی ثبت نکرده‌اید.',
  stateOpen: 'باز — روی ونوو منتظر قیمت',
  stateFilled: 'پر شد',
  stateCancelled: 'لغو شد',
  stateExpired: 'منقضی شد',
  stateUnknown: 'وضعیت از ونوو خوانده نشد — در خودِ ونوو بررسی کنید',
  stateStale: 'آخرین خوانش وضعیت',
  refreshState: 'خواندن وضعیت از ونوو',
  cancel: 'لغو سفارش',
  cancelling: 'در حال لغو…',
  cancelConfirm: 'لغو این سفارش یک امضای جدید در کیف پول شما می‌خواهد و قابل بازگشت نیست.',
  feedDown: 'خوانش وضعیت از ونوو ممکن نشد؛ list زیر وضعیت لحظه‌ای نیست.',
  err: {
    NO_VENUE: 'ونوو را انتخاب کنید.',
    VENUE_UNSUPPORTED: 'این ونوو برای سفارش خودکار پشتیبانی نمی‌شود.',
    KIND_UNSUPPORTED: 'این نوع سفارش روی این ونوو پشتیبانی نمی‌شود.',
    NO_MARKET: 'بازار را انتخاب کنید.',
    MARKET_INACTIVE: 'این بازار در dYdX فعال نیست.',
    MARKET_CLOSED: 'این بازار در Ostium بسته است.',
    BAD_SIDE: 'جهت سفارش معتبر نیست.',
    NO_SIZE: 'اندازهٔ سفارش را وارد کنید.',
    SIZE_BELOW_MIN: 'اندازهٔ سفارش از حداقل پلهٔ معاملاتی این بازار کمتر است.',
    NO_PRICE: 'قیمت را وارد کنید.',
    BAD_PRICE: 'قیمت معتبر نیست.',
    TICK_UNKNOWN: 'اندازهٔ پلهٔ قیمتی این بازار در دسترس نیست؛ بدون آن سفارش ثبت نمی‌شود.',
    NO_CURRENT_PRICE: 'قیمت فعلی بازار در دسترس نیست؛ بدون آن سمت درست تریگر بررسی نمی‌شود.',
    LIMIT_CROSSES_MARKET: 'این قیمت از بازار عبور می‌کند و سفارش به‌جای ماندن، بلافاصله پر می‌شد. عدد را دورتر از بازار بگذارید.',
    TRIGGER_WRONG_SIDE: 'این قیمت سمت اشتباه بازار است و سفارش بلافاصله اجرا می‌شد.',
    NO_COLLATERAL: 'مقدار وجه تضمین را وارد کنید.',
    BELOW_MIN_COLLATERAL: 'حداقل وجه تضمین در Ostium پنج دلار است.',
    NO_LEVERAGE: 'اهرم را وارد کنید.',
    LEVERAGE_TOO_HIGH: 'اهرم از حداکثر مجاز این بازار بیشتر است.',
    BAD_EXPIRY: 'مدت اعتبار سفارش معتبر نیست.',
    NO_POSITION: 'برای حد سود و حد ضرر باید پوزیشن باز داشته باشید و سفارش فقط کاهش‌دهنده باشد.',
    BAD_POSITION_SIDE: 'جهت سفارش با سمت پوزیشن نمی‌خواند؛ پوزیشن لانگ با فروش بسته می‌شود و شورت با خرید.',
    BAD_TPSL: 'حد سود یا حد ضرر سمت اشتباهی از قیمت ورود است.',
    NOT_CONNECTED: 'اتصال ونوو برقرار نیست.',
    WRONG_CHAIN: 'کیف پول روی شبکهٔ درست نیست؛ ابتدا شبکه را عوض کنید.',
    NO_SIGNER: 'امضاکننده در دسترس نیست؛ کیف پول را دوباره متصل کنید.',
    REJECTED: 'درخواست در کیف پول رد شد. چیزی ثبت نشد.',
    SUBMIT_FAILED: 'سفارش به ونوو نرسید. چیزی ثبت نشده است؛ می‌توانید دوباره تلاش کنید.',
    CANCEL_FAILED: 'لغو انجام نشد. سفارش ممکن است هنوز روی ونوو باز باشد؛ در خودِ ونوو بررسی کنید.',
    VALIDATOR_UNREACHABLE: 'اعتبارسنج dYdX در دسترس نیست. چیزی ارسال نشد.'
  },
  errGeneric: 'ثبت سفارش انجام نشد. چیزی روی ونوو ارسال نشده است.'
};

const EN = {
  sectionTitle: 'Auto orders on perpetual venues',
  sectionBody:
    'These orders are placed on the venue itself (dYdX or Ostium) and execute there, even while the app is closed. Your private key never leaves your wallet, we never hold your funds, and nothing is sent without your signature.',
  openSheet: 'Order on a perp venue',
  cardSub: 'Executes on the venue',
  heroChip1: 'Executes on the venue',
  heroChip2: 'Even while the app is closed',
  heroChip3: 'Only with your signature',
  venueLabel: 'Venue',
  venueSubDydx: 'dYdX Chain · limit, trigger, TP/SL',
  venueSubOstium: 'Arbitrum One · limit, stop, protocol TP/SL',
  kindLabel: 'Order type',
  kinds: {
    'entry-limit': 'Limit — open a position',
    'entry-stop': 'Stop entry — open a position',
    'take-profit': 'Take profit — close a position',
    'stop-loss': 'Stop loss — close a position'
  },
  kindShort: {
    'entry-limit': 'Limit',
    'entry-stop': 'Stop entry',
    'take-profit': 'Take profit',
    'stop-loss': 'Stop loss'
  },
  kindSub: {
    'entry-limit': 'Open a position',
    'entry-stop': 'Open a position',
    'take-profit': 'Close a position',
    'stop-loss': 'Close a position'
  },
  kindHelp: {
    dydxLimit:
      'The order rests on the dYdX order book and fills when the price reaches your level. It stays valid for as long as you choose (up to 90 days).',
    dydxTrigger:
      'The conditional order is registered on dYdX itself and fires on the oracle price without the app being open.',
    ostiumLimit:
      'The limit order is registered on Arbitrum One and Ostium\'s network executes it when the price arrives. Take profit and stop loss are set in the same signature and enforced by the protocol.',
    ostiumStop:
      'The stop order executes as a market order once the price crosses your trigger. Take profit and stop loss are set in the same signature and enforced by the protocol.'
  },
  marketLabel: 'Market',
  marketsUnread: 'The market list could not be read from the venue. Nothing is placed without a live price.',
  sideLabel: 'Side',
  sideBuy: 'Buy (long)',
  sideSell: 'Sell (short)',
  sideLong: 'Long',
  sideShort: 'Short',
  detailsLabel: 'Order details',
  sizeLabel: 'Order size',
  sizeHint: 'In the market\'s base unit (for example 0.001 for BTC-USD)',
  priceLabel: 'Price',
  triggerLabel: 'Trigger price',
  currentPriceLabel: 'Current price',
  collateralLabel: 'Collateral (USDC)',
  leverageLabel: 'Leverage',
  tpLabel: 'Take profit (optional)',
  slLabel: 'Stop loss (optional)',
  expiryLabel: 'Order lifetime',
  expiryOptions: {
    '1d': '1 day',
    '7d': '7 days',
    '28d': '28 days',
    '90d': '90 days'
  },
  expiryHint: 'The order rests on the venue itself until this lifetime ends.',
  slippageNote:
    'For Ostium limit and stop orders the slippage value must be zero. That is a protocol rule: a non-zero value makes the transaction revert, which is why this form has no slippage field.',
  reviewTitle: 'Review order',
  reviewVenue: 'Venue',
  reviewKind: 'Type',
  reviewMarket: 'Market',
  reviewSide: 'Side',
  reviewSize: 'Size',
  reviewPrice: 'Price',
  reviewTrigger: 'Trigger',
  reviewCollateral: 'Collateral',
  reviewLeverage: 'Leverage',
  reviewNotional: 'Position notional',
  reviewTp: 'Take profit',
  reviewSl: 'Stop loss',
  reviewExpiry: 'Valid until',
  reviewFeeOurs: 'Platform share',
  reviewFeeVenue: 'Venue fee',
  reviewFeeOracle: 'Oracle fee',
  reviewFeeTotal: 'Total cost',
  reviewFeeUnknown: 'The venue\'s own fee is charged separately under its own rules.',
  feePctOfCollateral: 'Equal to {{pct}}% of your collateral',
  roundedNote: 'Price and size were rounded to the market\'s step. What you see is what gets signed.',
  cancelCostNote:
    'Cancelling does not refund the placement fee: Ostium deducts the oracle fee from your collateral when a limit or stop order is placed.',
  warnTitle: 'Warning',
  warnSub: 'Risk, how execution works, and what to know before signing',
  howTitle: 'How it works',
  howStep1: 'You set every number, and the order is only created with your wallet signature.',
  howStep2: 'The order is registered on the venue itself (dYdX or Ostium), not on our server.',
  howStep3: 'When the price reaches your level, the venue executes it — even if the app is closed.',
  riskTitle: 'Before you sign',
  riskBody:
    'Leveraged trading can lose part or all of your collateral. No profit is guaranteed and nothing in this form is a signal or a recommendation to buy or sell. The numbers are yours, and execution belongs to the venue.',
  nonCustodyBody:
    'We hold no key and have no access to your funds. The order is placed on the venue with your signature, and only that venue can execute or cancel it.',
  place: 'Sign and place on the venue',
  placing: 'Signing and placing…',
  backLabel: 'Back',
  placedTitle: 'Order placed on the venue',
  placedBody:
    'Your order now rests on the venue itself, waiting for your price. You can track it in the order list in this window or on the venue.',
  placedNew: 'New order',
  placedClose: 'Close',
  stageConnectDydx: 'Connecting to dYdX (one wallet signature)…',
  stageSwitchChain: 'Switching your wallet to Arbitrum One…',
  stageApprove: 'Approving USDC for the exact order amount…',
  stageSign: 'Signing in your wallet…',
  stageSubmit: 'Sending to the venue…',
  connectDydxFirst: 'To place an order, complete the dYdX connection on that screen first.',
  connectWalletFirst: 'Connect your wallet first.',
  switchNetwork: 'Switch your wallet to Arbitrum One and try again.',
  approveFirst: 'Approve USDC for the exact amount of this order first.',
  viewOnExplorer: 'View on explorer',
  listTitle: 'Orders placed on venues',
  listDone: 'Finished orders',
  listEmpty: 'You have not placed a perp auto order yet.',
  stateOpen: 'Open — resting on the venue',
  stateFilled: 'Filled',
  stateCancelled: 'Cancelled',
  stateExpired: 'Expired',
  stateUnknown: 'State could not be read from the venue — check it on the venue itself',
  stateStale: 'Last state read',
  refreshState: 'Read state from the venue',
  cancel: 'Cancel order',
  cancelling: 'Cancelling…',
  cancelConfirm: 'Cancelling asks for a new signature in your wallet and cannot be undone.',
  feedDown: 'The venue state read failed; the list below is not live.',
  err: {
    NO_VENUE: 'Choose a venue.',
    VENUE_UNSUPPORTED: 'This venue does not support auto orders.',
    KIND_UNSUPPORTED: 'This venue does not support that order type.',
    NO_MARKET: 'Choose a market.',
    MARKET_INACTIVE: 'That market is not active on dYdX.',
    MARKET_CLOSED: 'That market is closed on Ostium.',
    BAD_SIDE: 'The order side is not valid.',
    NO_SIZE: 'Enter an order size.',
    SIZE_BELOW_MIN: 'The size is below this market\'s minimum step.',
    NO_PRICE: 'Enter a price.',
    BAD_PRICE: 'The price is not valid.',
    TICK_UNKNOWN: 'This market\'s tick size is unavailable; the order cannot be placed without it.',
    NO_CURRENT_PRICE: 'The market price is unavailable, so the trigger side cannot be checked.',
    LIMIT_CROSSES_MARKET: 'That price crosses the market, so the order would fill immediately instead of resting. Move it further from the market.',
    TRIGGER_WRONG_SIDE: 'That price is on the wrong side of the market and would fill immediately.',
    NO_COLLATERAL: 'Enter a collateral amount.',
    BELOW_MIN_COLLATERAL: 'The minimum collateral on Ostium is five dollars.',
    NO_LEVERAGE: 'Enter a leverage.',
    LEVERAGE_TOO_HIGH: 'The leverage is above this market\'s maximum.',
    BAD_EXPIRY: 'The order lifetime is not valid.',
    NO_POSITION: 'Take profit and stop loss need an open position and must be reduce-only.',
    BAD_POSITION_SIDE: 'The side does not match the position: a long closes with a sell, a short with a buy.',
    BAD_TPSL: 'The take profit or stop loss is on the wrong side of the entry price.',
    NOT_CONNECTED: 'The venue is not connected.',
    WRONG_CHAIN: 'Your wallet is on the wrong network; switch it first.',
    NO_SIGNER: 'No signer available; reconnect your wallet.',
    REJECTED: 'The request was rejected in your wallet. Nothing was placed.',
    SUBMIT_FAILED: 'The order did not reach the venue. Nothing was placed; you can try again.',
    CANCEL_FAILED: 'The cancel did not complete. The order may still be open on the venue — check it there.',
    VALIDATOR_UNREACHABLE: 'The dYdX validator is unreachable. Nothing was sent.'
  },
  errGeneric: 'The order was not placed. Nothing was sent to the venue.'
};

/**
 * Copy for one language. Anything other than Persian falls back to English,
 * which is the same rule the rest of the app's in-module copy follows.
 */
export function perpAutoCopyFor(lang) {
  return /^fa\b/i.test(String(lang || 'fa')) ? FA : EN;
}

export const PERP_AUTO_COPY_FA = FA;
export const PERP_AUTO_COPY_EN = EN;
