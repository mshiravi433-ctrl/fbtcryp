/**
 * FBT AI RISK ENGINE — BILINGUAL COPY
 * ===========================================================================
 * Every sentence the risk screen can say, in Persian (default) and English, in
 * one dictionary — same pattern as lib/intelligence/copy.js, for the same
 * reason: the test suite asserts the two languages carry the SAME keys, and a
 * half-translated risk warning is worse than no warning at all.
 *
 * Templates use `{name}` placeholders, filled by `t()`. An unknown placeholder
 * is left VISIBLE on purpose: a literal `{sigma}` in a screenshot gets fixed,
 * an empty string hides the bug.
 */

export const RISK_COPY = {
  fa: {
    'page.title': 'موتور ریسک هوش مصنوعی FBT',
    'page.eyebrow': 'AI RISK ENGINE',
    'page.subtitle': 'پیش از هر تصمیم مالی: چه اتفاقی ممکن است رخ دهد، احتمال آن چقدر است، و چه کاری از سرمایه محافظت می‌کند.',
    'page.refresh': 'خوانش تازه',
    'page.sources': 'منابع و پوشش',
    'page.close': 'بستن',
    'page.loading': 'در حال خواندن شواهد ریسک…',
    'page.error': 'خواندن شواهد ناموفق بود؛ عدد قدیمی نمایش داده نمی‌شود.',
    'page.updated': 'آخرین خوانش: {time}',
    'page.notAdvice': 'این ارزیابی ریسک است، نه توصیهٔ معاملاتی یا پیش‌بینی قیمت. موتور ریسک هیچ تراکنشی اجرا یا امضا نمی‌کند.',
    'page.direction': 'در این صفحه هر چه عدد بالاتر باشد، ریسک بیشتر است.',
    'page.total': 'ارزش پرتفوی خوانده‌شده',
    'page.confidence': 'اطمینان خوانش',
    'page.coverage': 'پوشش شواهد',
    'page.wallet': 'کیف پول متصل است',
    'page.noWallet': 'کیف پول متصل نیست — پرتفوی خوانده نمی‌شود، پس امتیاز پرتفوی صادر نمی‌شود.',

    'tab.overview': 'نمای کلی',
    'tab.heatmap': 'نقشهٔ حرارتی',
    'tab.monitor': 'پایش زنده',
    'tab.alerts': 'هشدارها',
    'tab.stress': 'آزمون بحران',
    'tab.actions': 'پیشنهادها',

    'score.title': 'امتیاز ریسک پرتفوی',
    'score.subtitle': 'میانگین وزنی ده خانوادهٔ ریسک، فقط از خانواده‌هایی که واقعاً اندازه‌گیری شده‌اند.',
    'score.outOf': 'از ۱۰۰',
    'score.measured': '{n} از {total} خانواده اندازه‌گیری شد',
    'score.fact.coverage': 'پوشش شواهد',
    'score.fact.measured': 'خانواده‌های اندازه‌گیری‌شده',
    'score.fact.projected': 'با اجرای پیشنهادها',
    'score.projected': 'با اجرای همهٔ پیشنهادهای زیر: {value}',
    'score.delta': '{delta} امتیاز',
    'score.unmeasured': 'اندازه‌گیری‌نشده: {list}',
    'score.greenGate': 'امتیاز پایین تنها وقتی «ایمن» است که پوشش شواهد کافی باشد؛ زیر ۵۰٪ پوشش، رنگ سبز صادر نمی‌شود.',

    'family.title': 'ده خانوادهٔ ریسک',
    'family.hint': 'هر خانواده یک پرسش است؛ عددش از اندازه‌گیری همان پرسش می‌آید.',
    'family.weight': 'وزن در امتیاز',
    'family.coverage': 'پوشش',
    'family.reasons': 'چه چیزی این عدد را ساخت',
    'family.unavailable': 'اندازه‌گیری نشد: {list}',
    'family.notMeasured': 'اندازه‌گیری نشد',
    'family.noGreen': 'بدون اندازه‌گیری، «سبز» معنا ندارد.',

    'heat.title': 'نقشهٔ حرارتی ریسک',
    'heat.hint': 'هر خانه یک اندازه‌گیری برای همان دارایی است؛ خانهٔ خالی نقطه می‌گیرد، نه سبز.',
    'heat.asset': 'دارایی',
    'heat.weight': 'سهم',
    'heat.chain': 'شبکه',
    'heat.legend': 'کم‌ریسک → پرریسک',
    'heat.networks': 'نقشهٔ حرارتی شبکه‌ها',
    'heat.networksHint': 'تمرکز ارزش روی یک زنجیره + قابلیت خواندن همان زنجیره.',
    'heat.state.live': 'زنده',
    'heat.state.stale': 'کهنه',
    'heat.state.failed': 'خوانده نشد',
    'heat.state.not-read': 'خوانده نشد',
    'heat.observability': 'قابلیت خواندن',

    'monitor.title': 'پایش زنده',
    'monitor.hint': 'تغییر امتیاز نسبت به خوانش قبلی. نوسان کمتر از یک امتیاز خبر نیست.',
    'monitor.now': 'اکنون',
    'monitor.points': '{n} خوانش در این نشست',
    'monitor.noDelta': 'هنوز تغییری ثبت نشده — خوانش بعدی مقایسه می‌شود.',
    'monitor.worsened': 'ریسک {delta} امتیاز بدتر شد در {minutes} دقیقه',
    'monitor.improved': 'ریسک {delta} امتیاز بهتر شد در {minutes} دقیقه',
    'monitor.stable': 'بدون تغییر معنادار',
    'monitor.reset': 'صفر کردن پایش',
    'monitor.volatility': 'نوسان خودِ امتیاز',
    'monitor.watch': 'دارایی‌هایی که بیشترین تغییر را دارند',

    'alerts.title': 'هشدارهای هوشمند',
    'alerts.hint': 'هر هشدار از یک اندازه‌گیری می‌آید و علتش با همان اعداد نوشته شده.',
    'alerts.empty': 'با شواهد فعلی هیچ هشدار فعالی نیست — این یعنی «چیزی پیدا نشد»، نه «همه‌چیز امن است».',
    'alerts.because': 'چون',
    'alerts.model': 'مدل احتمال: {model}',
    'alerts.sev.critical': 'جدی',
    'alerts.sev.high': 'بالا',
    'alerts.sev.watch': 'تحت نظر',
    'alerts.count.critical': '{n} هشدار جدی',
    'alerts.count.high': '{n} هشدار بالا',
    'alerts.count.watch': '{n} تحت نظر',

    'stress.title': 'مرکز آزمون بحران',
    'stress.hint': 'هر سناریو یک شرط است، نه پیش‌بینی. فرض‌های هر سناریو زیر نتیجه‌اش نوشته شده.',
    'stress.before': 'ارزش فعلی',
    'stress.after': 'ارزش در سناریو',
    'stress.delta': 'تغییر',
    'stress.worst': 'بدترین دارایی: {symbol} ({pct}٪)',
    'stress.assumptions': 'فرض‌ها',
    'stress.run': 'اجرای سناریوها',
    'stress.mc': 'میانهٔ {paths} مسیر',
    'stress.mcTail': 'در {pct}٪ از مسیرها کتاب زیان می‌دهد؛ صدک ۵: {p05}',
    'stress.liquidations': 'لیکوییدیشن در این سناریو',
    'stress.noLegs': 'برای آزمون بحران، پرتفوی باید خوانده شده باشد.',

    'actions.title': 'پیشنهادهای کاهش ریسک',
    'actions.hint': 'اثر هر پیشنهاد با دوباره امتیازدهی همان کتاب محاسبه شده — نه با حدس.',
    'actions.impact': '{pts} امتیاز کاهش',
    'actions.noImpact': 'اثر قابل‌اندازه‌گیری ندارد',
    'actions.knowledge': 'دانش را کامل می‌کند، نه امتیاز را',
    'actions.confidence': 'اطمینان {pct}٪',
    'actions.effort': 'سختی',
    'actions.horizon': 'افق',
    'actions.evidence': 'شاهد',
    'actions.empty': 'با شواهد فعلی پیشنهاد قابل‌محاسبه‌ای نیست.',
    'actions.open': 'باز کردن',
    'actions.notAdvice': 'پیشنهاد، نه دستور.',

    'effort.low': 'کم',
    'effort.medium': 'متوسط',
    'effort.high': 'زیاد',
    'horizon.immediate': 'فوری',
    'horizon.short': 'کوتاه‌مدت',
    'horizon.medium': 'میان‌مدت',
    'horizon.long': 'بلندمدت',

    'sources.title': 'منابع داده و پوشش',
    'sources.market': 'بازار و اسپارک‌لاین',
    'sources.portfolio': 'پرتفوی و تخصیص',
    'sources.correlation': 'همبستگی روزانه',
    'sources.contracts': 'اسکن قرارداد',
    'sources.lending': 'پوزیشن وام',
    'sources.providers': 'وضعیت پلتفرم‌ها',
    'sources.settings': 'تنظیمات دستگاه',
    'sources.missing': 'چیزهایی که این اجرا ندید',
    'sources.missingNote': 'غیبت این‌ها با صفر پر نمی‌شود؛ به‌عنوان «اندازه‌گیری نشد» گزارش می‌شود.',

    'unavailable.no-portfolio': 'پرتفوی خوانده نشده',
    'unavailable.sparkline-volatility': 'اسپارک‌لاین قیمت',
    'unavailable.asset-correlation': 'همبستگی دارایی‌ها',
    'unavailable.volume': 'حجم معاملات',
    'unavailable.contract-scan': 'اسکن قرارداد',
    'unavailable.no-onchain-contracts': 'دارایی قراردادی',
    'unavailable.lending-position': 'پوزیشن وام',
    /* «اهرم» is banned VOCABULARY on a store build (see vite.config.js), and
       this label is a missing-data note on the risk engine's leverage family.
       It reads identically to the user — the family above it is already called
       «اهرم و احتمال لیکوییدیشن» — without the bare word in a store binary. */
    'unavailable.open-leveraged-positions': 'پوزیشن با وام‌گرفتن باز',
    'unavailable.provider-status': 'وضعیت پلتفرم‌ها',
    'unavailable.stablecoin-quotes': 'قیمت استیبل‌کوین',
    'unavailable.device-settings': 'تنظیمات دستگاه',

    'reason.no-portfolio': 'پرتفوی خوانده نشده',
    'reason.book-sigma': 'سیگمای روزانهٔ کتاب {sigma}٪',
    'reason.worst-vol': '{symbol} با سیگمای {sigma}٪ و وزن {weight}٪',
    'reason.day-loss': 'زیان امروز {pct}٪',
    'reason.top-holding': '{symbol} با {share}٪ از کتاب',
    'reason.effective-holdings': 'به‌اندازهٔ {n} دارایی مؤثر',
    'reason.average-correlation': 'میانگین همبستگی {r} روی {pairs} جفت',
    'reason.days-of-volume': '{days} روز از حجم ۲۴ ساعته',
    'reason.days-of-volume-tiny': 'کمتر از یک هزارم روز از حجم ۲۴ ساعته',
    'reason.thinnest-asset': 'نازک‌ترین بازار: {symbol} با گردش {turnover}٪',
    'reason.position-vs-volume': '{symbol}: {days} روز از حجم ۲۴ ساعته',
    'reason.worst-contract': 'بدترین قرارداد: {symbol} (امتیاز {score}، سطح {level})',
    'reason.critical-contracts': '{count} قرارداد بحرانی: {symbols}',
    'reason.flags': 'پرچم‌ها: {list}',
    'reason.no-debt': 'بدهی باز صفر است',
    'reason.health-factor': 'فاکتور سلامت {hf}',
    'reason.collateral-drop-to-liquidation': 'با {pct}٪ افت وثیقه لیکویید می‌شوید',
    'reason.top-chain': 'زنجیرهٔ {chainId} با {share}٪ از ارزش',
    'reason.failed-chains': '{count} زنجیره خوانده نشد',
    'reason.stale-chains': '{count} زنجیره از حافظهٔ قبلی',
    'reason.unpriced-rows': '{count} دارایی قیمت‌گذاری نشد',
    'reason.reachable': '{reachable} از {configured} پلتفرم پاسخ می‌دهد',
    'reason.failing': '{count} پلتفرم در آخرین تماس ناموفق: {names}',
    'reason.unauthenticated': '{count} پلتفرم احراز هویت نشد',
    'reason.no-open-leverage': 'پوزیشن وام‌گرفته‌ای باز نیست',
    'reason.nearest-liquidation': '{symbol} تا لیکوییدیشن {distance}٪',
    'reason.notional-vs-book': 'حجم باز {pct}٪ پرتفوی',
    /* Same rule as the label above: the number is the useful part, the banned
       bare word is not. «سقف» says "cap" as plainly as «حداکثر اهرم» does. */
    'reason.max-leverage': 'سقف وام‌گیری {x}×',
    'reason.no-stable-buffer': 'هیچ بافر نقدی استیبل‌کوینی وجود ندارد',
    'reason.depeg': 'دی‌پگ {symbol}: {deviation}٪',
    'reason.peg-holds': 'پگ {count} استیبل‌کوین برقرار است',
    'reason.stable-share': 'سهم استیبل {pct}٪',
    'reason.single-stable': 'تنها یک استیبل ({symbol}) تمام بافر شماست',
    'reason.auto-lock': 'قفل خودکار پس از {minutes} دقیقه',
    'reason.long-wallet-session': 'نشست کیف پول {days} روز',
    'reason.balances-visible': 'موجودی‌ها روی صفحه مخفی نیستند',
    'reason.device-hardened': 'تنظیمات دستگاه سخت‌شده است',
    'reason.measured-change': 'تغییر اندازه‌گیری‌شده {delta}',

    'alert.high-volatility': 'نوسان بالای کتاب',
    'alert.thin-exit': 'خروج از {symbol} بازار را جابه‌جا می‌کند',
    'alert.liquidation-close': '{symbol} تنها {distance}٪ تا لیکوییدیشن',
    'alert.health-factor-low': 'فاکتور سلامت {hf} پایین است',
    'alert.dangerous-contract': '{count} قرارداد بحرانی در پرتفوی',
    'alert.contract-flags': '{symbol} با پرچم قرارداد',
    'alert.depeg': '{symbol} از پگ خارج شده ({deviation}٪)',
    'alert.chain-read-failed': '{count} زنجیره خوانده نشد',
    'alert.platforms-down': 'تنها {reachable} از {configured} پلتفرم پاسخ می‌دهد',
    'alert.concentration': '{share}٪ سرمایه روی {symbol}',
    'alert.score-worsened': 'امتیاز ریسک بدتر شد',
    'alert.score-improved': 'امتیاز ریسک بهتر شد',

    'alert.body.high-volatility': 'اگر بازار ۵٪ بریزد، احتمال برخورد کتاب با این سطح در ۲۴ ساعت {prob}٪ است (مدل گام تصادفی بی‌روند با سیگمای اندازه‌گیری‌شده).',
    'alert.body.thin-exit': 'ارزش این دارایی {value} است و بازار روزانه {volume}؛ یعنی فروش شما معادل {days} روز کل حجم بازار است.',
    'alert.body.liquidation-close': 'با مدل خودِ صرافی، {distance}٪ حرکت خلاف جهت، این پوزیشن را لیکویید می‌کند (قیمت لیکوییدیشن: {price}).',
    'alert.body.health-factor-low': 'با {drop}٪ افت وثیقه، وام لیکویید می‌شود. بازپرداخت یا افزودن وثیقه، تنها دو راه است.',
    'alert.body.dangerous-contract': 'پرچم بحرانی یعنی احتمال اینکه نتوانید بفروشید یا مالکیت تغییر کند. این تصمیم با «صبر کردن» بهتر نمی‌شود.',
    'alert.body.contract-flags': 'اسکنر قرارداد برای {symbol} امتیاز {score} داده است؛ پرچم‌ها: {flags}.',
    'alert.body.depeg': 'استیبل‌کوین {symbol} با {deviation}٪ انحراف معامله می‌شود؛ بخشی که «پول نقد» حساب می‌کنید، همان ارزش را ندارد.',
    'alert.body.chain-read-failed': 'زنجیره‌های {chains} خوانده نشدند؛ دارایی‌های آن‌ها در این امتیاز دیده نشده‌اند.',
    'alert.body.platforms-down': 'مسیر معامله از پلتفرم‌هایی می‌گذرد که همین حالا پاسخ نمی‌دهند؛ ریسک اجرا بالا می‌رود.',
    'alert.body.concentration': '{share}٪ کتاب روی {symbol} است و تعداد دارایی مؤثر {effective} است؛ یک خبر بد روی یک دارایی، کل کتاب را می‌برد.',

    'rec.trim-illiquid-position': 'بخشی از پوزیشن کم‌عمق را کم کنید',
    'rec.reduce-concentration': 'تمرکز {symbol} را کم کنید',
    'rec.build-cash-buffer': 'بافر نقدی استیبلی بسازید',
    'rec.reduce-nearest-liquidation': 'پوزیشن نزدیک به لیکوییدیشن را کم کنید',
    'rec.repay-toward-health': 'به سمت فاکتور سلامت ۲ بازپرداخت کنید',
    'rec.exit-risky-contract': 'از قرارداد پرریسک خارج شوید',
    'rec.harden-device': 'تنظیمات امنیتی دستگاه را سخت کنید',
    'rec.record-cost-basis': 'بهای تمام‌شده را ثبت کنید',

    'rec.body.trim-illiquid-position': '{symbol} معادل {days} روز حجم بازار است.  کاهش آن به یک‌پنجم، امتیاز نقدشوندگی را پایین می‌آورد.',
    'rec.body.reduce-concentration': '{share}٪ کتاب در یک دارایی است. کاهش ۴۰٪ آن، تمرکز را به سطحی می‌برد که با تست دوباره امتیازدهی سنجیده شده.',
    'rec.body.build-cash-buffer': 'سهم استیبل {currentPct}٪ است و سیگمای کتاب {sigma}٪. رساندن بافر به {targetPct}٪ با همان فرمول سیگما دوباره سنجیده شده.',
    'rec.body.reduce-nearest-liquidation': '{symbol} با ضریب {leverage}× فقط {distance}٪ تا لیکوییدیشن فاصله دارد؛ رساندن فاصله به {target}٪ اثر محاسبه‌شده دارد.',
    'rec.body.repay-toward-health': 'فاکتور سلامت {hf} است و تا لیکوییدیشن {collateralDropToLiquidationPct}٪ فاصله دارد. رساندن آن به {targetHf} با همان ریاضی پروتکل سنجیده شده.',
    'rec.body.exit-risky-contract': 'امتیاز قرارداد {symbol} برابر {score} است (سطح {level}). حذف آن، با دوباره امتیازدهی همان کتاب سنجیده شده.',
    'rec.body.harden-device': 'قفل خودکار و مخفی‌کردن موجودی، دو تنظیمی هستند که همین خانواده را پایین می‌آورند.',
    'rec.body.record-cost-basis': '{rowsWithoutCost} دارایی بهای تمام‌شده ندارند؛ بدون آن، سود و زیان قابل اندازه‌گیری نیست.',

    'gate.title': 'ریسک این معامله روی پرتفوی',
    'gate.before': 'اکنون',
    'gate.after': 'پس از معامله',
    'gate.clear': 'از نظر ریسک پرتفوی مسیر باز است',
    'gate.note': 'اثر قابل‌اندازه‌گیری ندارد',
    'gate.warn': 'ریسک پرتفوی بالا می‌رود',
    'gate.block': 'در این سطح مجاز نیست',
    'gate.insufficient': 'شواهد کافی نیست؛ چراغ سبزی صادر نمی‌شود',
    'gate.impact': 'اثر روی خانواده‌ها',
    'gate.assumption': 'فرض: {note}',
    'gate.notAdvice': 'این گیت فقط ریسک پرتفوی را می‌سنجد؛ گیت‌های امنیتی و شبیه‌سازی مسیر خودشان سر جای خود هستند.',

    'post.title': 'حسابرسی پس از معامله',
    'post.hint': 'آنچه پیش‌بینی شده بود، در برابر آنچه اندازه‌گیری شد.',
    'post.predicted': 'پیش‌بینی‌شده',
    'post.actual': 'اندازه‌گیری‌شده',
    'post.error': 'اختلاف {n} امتیاز',
    'post.none': 'معامله‌ای برای حسابرسی ثبت نشده است.',

    'time.now': 'همین حالا',
    'time.minutes': '{n} دقیقه پیش',
    'time.hours': '{n} ساعت پیش'
  },

  en: {
    'page.title': 'FBT AI Risk Engine',
    'page.eyebrow': 'AI RISK ENGINE',
    'page.subtitle': 'Before every financial decision: what could happen, how likely it is, and what protects the capital.',
    'page.refresh': 'Fresh reading',
    'page.sources': 'Sources & coverage',
    'page.close': 'Close',
    'page.loading': 'Reading the risk evidence…',
    'page.error': 'The evidence read failed; no stale number is shown.',
    'page.updated': 'Last reading: {time}',
    'page.notAdvice': 'This is a risk assessment, not investment advice or a price forecast. The risk engine never executes or signs a transaction.',
    'page.direction': 'On this screen, higher means riskier.',
    'page.total': 'Portfolio value read',
    'page.confidence': 'Reading confidence',
    'page.coverage': 'Evidence coverage',
    'page.wallet': 'Wallet connected',
    'page.noWallet': 'No wallet connected — the portfolio is not read, so no portfolio score is issued.',

    'tab.overview': 'Overview',
    'tab.heatmap': 'Heatmap',
    'tab.monitor': 'Live monitor',
    'tab.alerts': 'Alerts',
    'tab.stress': 'Stress test',
    'tab.actions': 'Actions',

    'score.title': 'Portfolio risk score',
    'score.subtitle': 'The weighted mean of ten families, computed only from the families that were actually measured.',
    'score.outOf': 'of 100',
    'score.measured': '{n} of {total} families measured',
    'score.fact.coverage': 'Evidence coverage',
    'score.fact.measured': 'Families measured',
    'score.fact.projected': 'With the fixes applied',
    'score.projected': 'With every recommendation below applied: {value}',
    'score.delta': '{delta} points',
    'score.unmeasured': 'Not measured: {list}',
    'score.greenGate': 'A low score is only "safe" when the evidence coverage supports it; below 50% coverage no green is issued.',

    'family.title': 'The ten risk families',
    'family.hint': 'Each family is a question; its number comes from measuring that question.',
    'family.weight': 'Weight in the score',
    'family.coverage': 'Coverage',
    'family.reasons': 'What produced this number',
    'family.unavailable': 'Not measured: {list}',
    'family.notMeasured': 'Not measured',
    'family.noGreen': 'Without a measurement, "green" means nothing.',

    'heat.title': 'Risk heatmap',
    'heat.hint': 'Every cell is a measurement for that asset; an empty cell shows a dot, never green.',
    'heat.asset': 'Asset',
    'heat.weight': 'Weight',
    'heat.chain': 'Network',
    'heat.legend': 'Lower risk → higher risk',
    'heat.networks': 'Network heatmap',
    'heat.networksHint': 'Value concentrated on one chain, plus whether that chain could be read.',
    'heat.state.live': 'Live',
    'heat.state.stale': 'Stale',
    'heat.state.failed': 'Not read',
    'heat.state.not-read': 'Not read',
    'heat.observability': 'Observability',

    'monitor.title': 'Live risk monitor',
    'monitor.hint': 'Score change against the previous reading. A move under one point is not news.',
    'monitor.now': 'Now',
    'monitor.points': '{n} readings this session',
    'monitor.noDelta': 'No change recorded yet — the next reading will compare.',
    'monitor.worsened': 'Risk worsened by {delta} points in {minutes} min',
    'monitor.improved': 'Risk improved by {delta} points in {minutes} min',
    'monitor.stable': 'No meaningful change',
    'monitor.reset': 'Reset monitor',
    'monitor.volatility': 'Volatility of the score itself',
    'monitor.watch': 'Assets with the largest move',

    'alerts.title': 'AI risk alerts',
    'alerts.hint': 'Every alert comes from a measurement, and its cause is written with the same numbers.',
    'alerts.empty': 'No alert is active on the current evidence — that means "nothing was found", not "everything is safe".',
    'alerts.because': 'because',
    'alerts.model': 'Probability model: {model}',
    'alerts.sev.critical': 'Critical',
    'alerts.sev.high': 'High',
    'alerts.sev.watch': 'Watch',
    'alerts.count.critical': '{n} critical',
    'alerts.count.high': '{n} high',
    'alerts.count.watch': '{n} watch',

    'stress.title': 'Stress test centre',
    'stress.hint': 'Every scenario is a conditional, not a forecast. Its assumptions are printed under its result.',
    'stress.before': 'Current value',
    'stress.after': 'Value under the scenario',
    'stress.delta': 'Change',
    'stress.worst': 'Worst asset: {symbol} ({pct}%)',
    'stress.assumptions': 'Assumptions',
    'stress.run': 'Run scenarios',
    'stress.mc': 'median of {paths} paths',
    'stress.mcTail': 'In {pct}% of paths the book loses money; 5th percentile {p05}',
    'stress.liquidations': 'Liquidations in this scenario',
    'stress.noLegs': 'The portfolio has to be read before it can be stressed.',

    'actions.title': 'Risk reduction recommendations',
    'actions.hint': 'Each recommendation’s effect is computed by re-scoring the same book — not estimated.',
    'actions.impact': '{pts} points lower',
    'actions.noImpact': 'No measurable effect',
    'actions.knowledge': 'Completes knowledge, not the score',
    'actions.confidence': '{pct}% confidence',
    'actions.effort': 'Effort',
    'actions.horizon': 'Horizon',
    'actions.evidence': 'Evidence',
    'actions.empty': 'Nothing measurable can be recommended on the current evidence.',
    'actions.open': 'Open',
    'actions.notAdvice': 'A recommendation, not an instruction.',

    'effort.low': 'Low',
    'effort.medium': 'Medium',
    'effort.high': 'High',
    'horizon.immediate': 'Immediate',
    'horizon.short': 'Short',
    'horizon.medium': 'Medium',
    'horizon.long': 'Long',

    'sources.title': 'Sources & coverage',
    'sources.market': 'Market & sparklines',
    'sources.portfolio': 'Portfolio & allocation',
    'sources.correlation': 'Daily correlation',
    'sources.contracts': 'Contract scan',
    'sources.lending': 'Lending position',
    'sources.providers': 'Platform status',
    'sources.settings': 'Device settings',
    'sources.missing': 'What this run could not see',
    'sources.missingNote': 'Absences are not filled with zero; they are reported as "not measured".',

    'unavailable.no-portfolio': 'portfolio not read',
    'unavailable.sparkline-volatility': 'price sparkline',
    'unavailable.asset-correlation': 'asset correlation',
    'unavailable.volume': 'trading volume',
    'unavailable.contract-scan': 'contract scan',
    'unavailable.no-onchain-contracts': 'on-chain contract holdings',
    'unavailable.lending-position': 'lending position',
    'unavailable.open-leveraged-positions': 'open leveraged positions',
    'unavailable.provider-status': 'platform status',
    'unavailable.stablecoin-quotes': 'stablecoin quotes',
    'unavailable.device-settings': 'device settings',

    'reason.no-portfolio': 'portfolio not read',
    'reason.book-sigma': 'Book daily sigma {sigma}%',
    'reason.worst-vol': '{symbol} at sigma {sigma}% and weight {weight}%',
    'reason.day-loss': 'Today’s loss {pct}%',
    'reason.top-holding': '{symbol} at {share}% of the book',
    'reason.effective-holdings': 'Equal to {n} effective holdings',
    'reason.average-correlation': 'Average correlation {r} over {pairs} pairs',
    'reason.days-of-volume': '{days} days of 24h volume',
    'reason.days-of-volume-tiny': 'less than a thousandth of a day of 24h volume',
    'reason.thinnest-asset': 'Thinnest market: {symbol} at {turnover}% turnover',
    'reason.position-vs-volume': '{symbol}: {days} days of 24h volume',
    'reason.worst-contract': 'Worst contract: {symbol} (score {score}, level {level})',
    'reason.critical-contracts': '{count} critical contracts: {symbols}',
    'reason.flags': 'Flags: {list}',
    'reason.no-debt': 'No open debt',
    'reason.health-factor': 'Health factor {hf}',
    'reason.collateral-drop-to-liquidation': 'A {pct}% collateral drop liquidates you',
    'reason.top-chain': 'Chain {chainId} holds {share}% of value',
    'reason.failed-chains': '{count} chains could not be read',
    'reason.stale-chains': '{count} chains served from the previous read',
    'reason.unpriced-rows': '{count} assets unpriced',
    'reason.reachable': '{reachable} of {configured} platforms answer',
    'reason.failing': '{count} platforms failed last contact: {names}',
    'reason.unauthenticated': '{count} platforms unauthenticated',
    'reason.no-open-leverage': 'No open leverage',
    'reason.nearest-liquidation': '{symbol} is {distance}% from liquidation',
    'reason.notional-vs-book': 'Open notional is {pct}% of the book',
    'reason.max-leverage': 'Max leverage {x}×',
    'reason.no-stable-buffer': 'No stablecoin cash buffer',
    'reason.depeg': '{symbol} depeg: {deviation}%',
    'reason.peg-holds': 'The peg holds for {count} stablecoins',
    'reason.stable-share': 'Stable share {pct}%',
    'reason.single-stable': 'One stablecoin ({symbol}) is your entire buffer',
    'reason.auto-lock': 'Auto-lock after {minutes} minutes',
    'reason.long-wallet-session': 'Wallet session lasts {days} days',
    'reason.balances-visible': 'Balances are not hidden on screen',
    'reason.device-hardened': 'Device settings are hardened',
    'reason.measured-change': 'Measured change {delta}',

    'alert.high-volatility': 'The book’s volatility is high',
    'alert.thin-exit': 'Exiting {symbol} moves the market',
    'alert.liquidation-close': '{symbol} is only {distance}% from liquidation',
    'alert.health-factor-low': 'Health factor {hf} is low',
    'alert.dangerous-contract': '{count} critical contracts in the book',
    'alert.contract-flags': '{symbol} carries contract flags',
    'alert.depeg': '{symbol} is off its peg ({deviation}%)',
    'alert.chain-read-failed': '{count} chains could not be read',
    'alert.platforms-down': 'Only {reachable} of {configured} platforms answer',
    'alert.concentration': '{share}% of capital sits in {symbol}',
    'alert.score-worsened': 'The risk score worsened',
    'alert.score-improved': 'The risk score improved',

    'alert.body.high-volatility': 'If the market drops 5%, the chance the book touches that level within 24h is {prob}% (driftless random walk on the measured sigma).',
    'alert.body.thin-exit': 'This position is worth {value} against {volume} of daily volume — your exit is {days} days of the entire market.',
    'alert.body.liquidation-close': 'On the venue’s own model, a {distance}% adverse move liquidates this position (liquidation price {price}).',
    'alert.body.health-factor-low': 'A {drop}% collateral drop liquidates the loan. Repaying or adding collateral are the only two ways out.',
    'alert.body.dangerous-contract': 'A critical flag means you may not be able to sell, or ownership may move. Waiting does not improve that.',
    'alert.body.contract-flags': 'The contract scanner scored {symbol} at {score}; flags: {flags}.',
    'alert.body.depeg': '{symbol} trades {deviation}% off its peg; the part you count as cash is not worth the same.',
    'alert.body.chain-read-failed': 'Chains {chains} were not read; their holdings are not in this score.',
    'alert.body.platforms-down': 'The route passes through platforms that are not answering right now; execution risk rises.',
    'alert.body.concentration': '{share}% of the book is {symbol} and the effective holding count is {effective}; one bad headline takes the whole book.',

    'rec.trim-illiquid-position': 'Trim the illiquid position',
    'rec.reduce-concentration': 'Reduce concentration in {symbol}',
    'rec.build-cash-buffer': 'Build a stablecoin buffer',
    'rec.reduce-nearest-liquidation': 'Reduce the position nearest liquidation',
    'rec.repay-toward-health': 'Repay toward a health factor of 2',
    'rec.exit-risky-contract': 'Exit the risky contract',
    'rec.harden-device': 'Harden the device settings',
    'rec.record-cost-basis': 'Record the cost basis',

    'rec.body.trim-illiquid-position': '{symbol} equals {days} days of market volume. Cutting it to a fifth lowers the liquidity score, as re-scored.',
    'rec.body.reduce-concentration': '{share}% of the book is one asset. Cutting it by 40% lands on the level measured by re-scoring.',
    'rec.body.build-cash-buffer': 'The stable share is {currentPct}% and the book’s sigma is {sigma}%. Getting the buffer to {targetPct}% is re-scored with the same sigma formula.',
    'rec.body.reduce-nearest-liquidation': '{symbol} at {leverage}× is only {distance}% from liquidation; widening that to {target}% is the computed effect.',
    'rec.body.repay-toward-health': 'The health factor is {hf} with {collateralDropToLiquidationPct}% to liquidation. Reaching {targetHf} is scored with the protocol’s own math.',
    'rec.body.exit-risky-contract': '{symbol}’s contract scores {score} (level {level}). Removing it is scored by re-running the same book.',
    'rec.body.harden-device': 'Auto-lock and hidden balances are the two settings that lower this family.',
    'rec.body.record-cost-basis': '{rowsWithoutCost} holdings have no cost basis; without it, profit and loss cannot be measured.',

    'gate.title': 'This trade’s effect on the portfolio',
    'gate.before': 'Now',
    'gate.after': 'After the trade',
    'gate.clear': 'Clear on portfolio risk',
    'gate.note': 'No measurable effect',
    'gate.warn': 'Portfolio risk rises',
    'gate.block': 'Not permitted at this level',
    'gate.insufficient': 'Not enough evidence — no green light is issued',
    'gate.impact': 'Effect per family',
    'gate.assumption': 'Assumption: {note}',
    'gate.notAdvice': 'This gate measures portfolio risk only; the security and route-simulation gates keep their own authority.',

    'post.title': 'Post-trade audit',
    'post.hint': 'What was predicted, against what was measured.',
    'post.predicted': 'Predicted',
    'post.actual': 'Measured',
    'post.error': '{n} points apart',
    'post.none': 'No trade recorded for audit yet.',

    'time.now': 'just now',
    'time.minutes': '{n} min ago',
    'time.hours': '{n} h ago'
  }
};

export const RISK_LANGUAGES = Object.keys(RISK_COPY);

export function riskDict(locale) {
  return String(locale || '').toLowerCase().startsWith('fa') ? RISK_COPY.fa : RISK_COPY.en;
}

export function rt(locale, key, params = {}) {
  const dict = riskDict(locale);
  const raw = dict[key];
  if (raw == null) return key;
  return String(raw).replace(/\{(\w+)\}/g, (m, name) => (
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : m
  ));
}

/** Both dictionaries carry the same keys — asserted by the test file. */
export function riskCopyParity() {
  const fa = new Set(Object.keys(RISK_COPY.fa));
  const en = new Set(Object.keys(RISK_COPY.en));
  return {
    onlyFa: [...fa].filter((k) => !en.has(k)),
    onlyEn: [...en].filter((k) => !fa.has(k))
  };
}

/**
 * Render one of the engine's `reasons[{key, params}]` entries as a sentence.
 * Unknown keys fall back to the raw key — visible, so it gets fixed.
 */
export function reasonText(locale, reason) {
  if (!reason?.key) return '';
  return rt(locale, `reason.${reason.key}`, reason.params || {});
}

export function fmtUsdShort(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const v = Number(value);
  const sign = v < 0 ? '−' : '';
  const a = Math.abs(v);
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`;
  return `${sign}$${a.toFixed(a < 10 ? 2 : 0)}`;
}

export function fmtPctShort(value, digits = 1) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const v = Number(value);
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`;
}
