/**
 * FBT AI INTELLIGENCE — BILINGUAL COPY
 * ---------------------------------------------------------------------------
 * The analysis screen speaks two languages: Persian (default) and English.
 * Every sentence that can be generated from a number is a template here, so
 * the narrative engine has no hard-coded prose and the test file can assert
 * that the two languages carry the SAME keys (a missing Persian string used to
 * be the most common way a new panel shipped half-translated).
 *
 * Placeholders use `{name}` and are filled by `interpolate`. Unknown
 * placeholders are left visible on purpose — a silent empty string hides the
 * bug, a literal `{value}` in a screenshot gets it fixed.
 */
export const COPY = {
  fa: {
    'page.title': 'هوش بازار FBT',
    'page.subtitle': 'تحلیل بازار، پرتفوی، توکن و فرصت‌ها — از داده واقعی، با منبع و زمان به‌روزرسانی',
    'page.live': 'زنده',
    'page.stale': 'داده کهنه',
    'page.offline': 'حالت آفلاین',
    'page.unknown': 'منبع نامشخص',
    'page.refresh': 'به‌روزرسانی',
    'page.updated': 'آخرین به‌روزرسانی: {time}',
    'page.usdNote': 'همه مبالغ به دلار آمریکا (USD)',
    'page.sources': 'منابع داده و پوشش',
    'page.confidence': 'درجه اطمینان',
    'page.notAdvice': 'این تحلیل اطلاع‌رسانی است، نه توصیه معاملاتی یا پیش‌بینی.',
    'page.insufficient': 'داده کافی برای این تحلیل موجود نیست',
    'page.loading': 'در حال خواندن داده بازار…',
    'page.error': 'دریافت داده بازار ناموفق بود. مقدار قدیمی نمایش داده نمی‌شود.',
    'page.rowsCounted': '{counted} از {total} توکن دارای داده تغییر ۲۴ ساعته',
    'page.close': 'بستن',

    'tab.overview': 'نمای بازار',
    'tab.screener': 'اسکرینر توکن‌ها',
    'tab.token': 'تحلیل توکن',
    'tab.portfolio': 'پرتفوی',
    'tab.opportunities': 'فرصت‌ها',
    'tab.compare': 'مقایسه',
    'tab.report': 'گزارش روزانه',

    'kpi.marketCap': 'ارزش کل بازار',
    'kpi.volume': 'حجم ۲۴ ساعته',
    'kpi.btcDominance': 'سهم بیت‌کوین',
    'kpi.ethDominance': 'سهم اتریوم',
    'kpi.breadth': 'توکن‌های صعودی',
    'kpi.medianChange': 'میانه تغییر ۲۴ ساعته',
    'kpi.turnover': 'گردش معاملات بازار',
    'kpi.regime': 'وضعیت بازار',
    'kpi.trendStrength': 'قدرت روند',
    'kpi.volatility': 'نوسان روزانه',
    'kpi.liquidity': 'نقدشوندگی',
    'kpi.rangePosition': 'میانه موقعیت در بازه روز',
    'kpi.coverage': 'پوشش داده',

    'regime.bullish': 'صعودی',
    'regime.mildly-bullish': 'صعودی ملایم',
    'regime.neutral': 'خنثی',
    'regime.mildly-bearish': 'نزولی ملایم',
    'regime.bearish': 'نزولی',
    'regime.unknown': 'نامشخص',

    'vol.low': 'کم',
    'vol.normal': 'معمولی',
    'vol.high': 'بالا',
    'vol.extreme': 'بسیار بالا',
    'vol.unknown': 'نامشخص',

    'liq.very-liquid': 'بسیار عمیق',
    'liq.liquid': 'عمیق',
    'liq.normal': 'معمولی',
    'liq.thin': 'نازک',
    'liq.unknown': 'نامشخص',

    'driver.breadth': 'گستردگی صعود',
    'driver.median-change': 'میانه تغییر ۲۴ ساعته',
    'driver.market-cap-change': 'تغییر ارزش کل بازار',
    'driver.volume-confirmation': 'تأیید حجم',
    'driver.available': 'در دسترس',
    'driver.missing': 'داده نداشت',

    'movers.gainers': 'بیشترین رشد',
    'movers.losers': 'بیشترین افت',
    'movers.surges': 'جهش غیرعادی حجم',
    'movers.surgeBasis': 'پایه: میانه گردش {value}٪ — هر ردیف چند برابر آن',
    'movers.volume': 'بیشترین حجم',
    'movers.empty': 'با داده فعلی، فهرستی برای نمایش نیست',

    'unavailable.title': 'این بخش‌ها هنوز متصل نشده‌اند',
    'unavailable.fear-greed': 'شاخص ترس و طمع',
    'unavailable.open-interest': 'Open Interest مشتقات',
    'unavailable.funding-rates': 'نرخ بهره فیوچرز (Funding)',
    'unavailable.liquidations': 'داده لیکوییدیشن',
    'unavailable.net-exchange-flow': 'جریان خالص ورود/خروج صرافی',
    'unavailable.note': 'برای این موارد هیچ عددی ساخته نشده است؛ منبع اتصال ندارد و جای آن خالی می‌ماند.',

    'screener.search': 'جستجوی نام یا نماد…',
    'screener.filter.all': 'همه',
    'screener.filter.gainers': 'صعودی',
    'screener.filter.losers': 'نزولی',
    'screener.filter.volume': 'حجم بالا',
    'screener.filter.nearHigh': 'نزدیک سقف روز',
    'screener.filter.deepAth': 'دور از ATH',
    'screener.filter.stable': 'استیبل',
    'screener.col.token': 'توکن',
    'screener.col.price': 'قیمت',
    'screener.col.ch1h': '۱ ساعت',
    'screener.col.ch24h': '۲۴ ساعت',
    'screener.col.ch7d': '۷ روز',
    'screener.col.volume': 'حجم',
    'screener.col.mcap': 'ارزش بازار',
    'screener.col.ath': 'فاصله تا ATH',
    'screener.col.action': 'تحلیل',
    'screener.showing': '{shown} ردیف از {scanned} اسکن‌شده',
    'screener.empty': 'هیچ توکنی با این فیلتر پیدا نشد',
    'screener.analyze': 'باز کردن پرونده',

    'token.pick': 'انتخاب توکن',
    'token.history': 'بازه نمودار',
    'token.days.30': '۳۰ روز',
    'token.days.90': '۹۰ روز',
    'token.days.180': '۱۸۰ روز',
    'token.score': 'امتیاز ترکیبی',
    'token.scoreCoverage': 'پوشش امتیاز: {value}٪ از وزن‌ها',
    'token.scoreMissing': 'امتیاز محاسبه نشد — شواهد کافی نیست',
    'token.technical': 'تحلیل تکنیکال',
    'token.indicators': 'اندیکاتورها',
    'token.levels': 'حمایت و مقاومت',
    'token.support': 'حمایت نزدیک',
    'token.resistance': 'مقاومت نزدیک',
    'token.rsi': 'RSI (۱۴)',
    'token.macd': 'هیستوگرام MACD',
    'token.sma20': 'میانگین ۲۰',
    'token.sma50': 'میانگین ۵۰',
    'token.sma200': 'میانگین ۲۰۰',
    'token.bollinger': 'باند بولینگر (%B)',
    'token.atr': 'ATR نسبی',
    'token.trend': 'روند',
    'token.trend.uptrend': 'صعودی',
    'token.trend.downtrend': 'نزولی',
    'token.trend.sideways': 'خنثی',
    'token.trend.unknown': 'نامشخص',
    'token.fib': 'فیبوناچی',
    'token.evidence': 'شواهد و اعداد',
    'token.noCandles': 'کندل کافی برای این توکن دریافت نشد؛ تحلیل تکنیکال نمایش داده نمی‌شود.',
    'token.openFull': 'صفحه کامل توکن',
    'token.about': 'درباره این امتیاز',
    'token.weights': 'وزن‌ها',

    'band.strong': 'قوی',
    'band.constructive': 'سازنده',
    'band.neutral': 'خنثی',
    'band.cautious': 'با احتیاط',
    'band.weak': 'ضعیف',

    'caveat.not-a-recommendation': 'توصیه معاملاتی نیست',
    'caveat.not-a-signal': 'سیگنال قطعی نیست',
    'caveat.insufficient-coverage': 'پوشش داده کم',
    'caveat.short-history': 'تاریخچه کوتاه‌تر از ۲۰۰ کندل',
    'caveat.offline-data': 'داده آفلاین',
    'caveat.stale-data': 'داده کهنه',
    'caveat.snapshot-only': 'فقط از عکس لحظه‌ای بازار',
    'caveat.not-advice': 'توصیه سرمایه‌گذاری نیست',
    'caveat.cost-basis-unknown': 'قیمت خرید ثبت نشده',
    'caveat.cost-basis-partial': 'قیمت خرید ناقص',

    'port.connect': 'برای تحلیل پرتفوی، کیف پول را وصل کنید',
    'port.connectHint': 'سود و ضرر فقط با تاریخچه خرید و فروش واقعی محاسبه می‌شود؛ تا آن زمان «نامشخص» می‌ماند.',
    'port.value': 'ارزش کل',
    'port.cost': 'بهای تمام‌شده ثبت‌شده',
    'port.realised': 'سود/ضرر تحقق‌یافته',
    'port.unrealised': 'سود/ضرر تحقق‌نیافته',
    'port.unknown': 'نامشخص',
    'port.allocation': 'تخصیص دارایی',
    'port.risk': 'ریسک پرتفوی',
    'port.riskHigh': 'بالا',
    'port.riskMedium': 'متوسط',
    'port.riskLow': 'پایین',
    'port.concentration': 'تمرکز',
    'port.effectiveHoldings': 'تعداد مؤثر دارایی',
    'port.correlation': 'همبستگی بازده روزانه',
    'port.correlationMissing': 'برای همبستگی، تاریخچه روزانه دست‌کم دو دارایی لازم است',
    'port.suggestions': 'پیشنهادهای مبتنی بر داده',
    'port.noSuggestions': 'با داده فعلی، تغییر مشخصی پیشنهاد نمی‌شود',
    'port.pairs': '{count} جفت، میانگین {avg}',
    'port.horizon': 'افق',
    'port.riskLevel': 'ریسک',
    'port.evidence': 'شواهد',
    'port.horizon.immediate': 'فوری',
    'port.horizon.short': 'کوتاه‌مدت',
    'port.horizon.medium': 'میان‌مدت',
    'port.horizon.long': 'بلندمدت',

    'sugg.reduce-concentration': '{symbol} بیش از {topShare}٪ پرتفوی است؛ کاهش تمرکز روی یک دارایی',
    'sugg.improve-diversification': 'میانگین همبستگی {avgCorrelation} است؛ تنوع‌بخشی واقعی کم است',
    'sugg.spread-network-risk': '{weight}٪ سرمایه روی یک شبکه است؛ تقسیم ریسک شبکه',
    'sugg.review-cash-buffer': 'سهم استیبل‌کوین {stablePct}٪ است؛ بازبینی ذخیره نقدی',
    'sugg.record-cost-basis': '{rowsWithoutCost} دارایی قیمت خرید ثبت‌شده ندارد؛ ثبت آن برای سود/ضرر واقعی',

    'opp.title': 'اسکنر فرصت',
    'opp.subtitle': 'روی {scanned} توکن؛ هر کارت دلیل عددی خودش را دارد',
    'opp.confidence': 'اطمینان',
    'opp.empty': 'در این چرخه فرصتی با معیارهای تعیین‌شده پیدا نشد',
    'opp.open': 'بررسی',
    'opp.kind.breakout': 'شکست سقف روزانه',
    'opp.kind.momentum': 'مومنتوم قوی',
    'opp.kind.volume-spike': 'جهش حجم',
    'opp.kind.recovery': 'بازگشت از افت هفتگی',
    'opp.kind.distribution': 'فشار فروش',
    'opp.kind.relative-strength': 'قدرت نسبی',
    'opp.all': 'همه',
    'opp.reason.range-position': 'قیمت در {value}٪ بالای بازه ۲۴ ساعته',
    'opp.reason.change-24h': 'تغییر ۲۴ ساعته {value}٪',
    'opp.reason.change-7d': 'تغییر ۷ روزه {value}٪',
    'opp.reason.turnover-vs-median': 'گردش {ratio} برابر میانه بازار',
    'opp.reason.market-breadth': 'در بازاری که فقط {advRatio}٪ توکن‌ها صعودی‌اند',

    'cmp.pick': '۲ تا ۴ توکن انتخاب کنید',
    'cmp.metric': 'شاخص',
    'cmp.best': 'بهتر',
    'cmp.change24h': 'بازده ۲۴ ساعت',
    'cmp.change7d': 'بازده ۷ روز',
    'cmp.volume': 'حجم',
    'cmp.mcap': 'ارزش بازار',
    'cmp.rank': 'رتبه',
    'cmp.ath': 'فاصله تا ATH',
    'cmp.range': 'موقعیت در بازه روز',
    'cmp.note': 'برنده هر ردیف فقط بر پایه همان شاخص است؛ هیچ برنده کلی اعلام نمی‌شود.',

    'report.title': 'گزارش روزانه بازار',
    'report.generate': 'ساخت گزارش',
    'report.copy': 'کپی متن',
    'report.copied': 'کپی شد',
    'report.download': 'دانلود',
    'report.generatedAt': 'ساخته‌شده در {time}',
    'report.section.market': 'وضعیت کلی بازار',
    'report.section.movers': 'بیشترین رشد و افت',
    'report.section.volume': 'حجم غیرعادی',
    'report.section.opportunities': 'فرصت‌های قابل بررسی',
    'report.section.risks': 'ریسک‌های تازه',
    'report.section.watch': 'در ۲۴ ساعت آینده چه چیزی را رصد کنیم',
    'report.sourceLine': 'منبع: {source} · {counted} از {total} توکن · {time}',

    'market.sentence': 'بازار در وضعیت {regime} است: {adv} از {total} توکن صعودی‌اند و میانه تغییر ۲۴ ساعته {median}٪ است.',
    'market.sentence.volume': 'حجم کل {volume} و {volumeDir} {volumeChange}٪ نسبت به روز قبل است.',
    'market.sentence.volumeUp': 'بیشتر',
    'market.sentence.volumeDown': 'کمتر',
    'market.sentence.dom': 'سهم بیت‌کوین {btc}٪ از بازار است.',
    'market.sentence.vol': 'نوسان روزانه (میانه دامنه) {vol}٪ و نقدشوندگی {liq} است.',
    'market.sentence.missing': 'برای {missing} داده‌ای در دسترس نیست، پس عددی برایش ساخته نشده است.',
    'market.why': 'چرا این برچسب؟',
    'market.drivers': 'اجزای محاسبه',

    'time.now': 'همین حالا',
    'time.minutes': '{n} دقیقه پیش',
    'time.hours': '{n} ساعت پیش'
  },

  en: {
    'page.title': 'FBT AI Intelligence',
    'page.subtitle': 'Market, portfolio, token and opportunity analysis — from real data, with source and freshness',
    'page.live': 'Live',
    'page.stale': 'Stale data',
    'page.offline': 'Offline mode',
    'page.unknown': 'Unknown source',
    'page.refresh': 'Refresh',
    'page.updated': 'Last updated: {time}',
    'page.usdNote': 'All amounts in US dollars (USD)',
    'page.sources': 'Data sources & coverage',
    'page.confidence': 'Confidence',
    'page.notAdvice': 'This is information, not trading advice or a forecast.',
    'page.insufficient': 'Not enough data for this analysis',
    'page.loading': 'Reading market data…',
    'page.error': 'The market feed failed. No stale numbers are shown in its place.',
    'page.rowsCounted': '{counted} of {total} tokens carry a 24h change',
    'page.close': 'Close',

    'tab.overview': 'Overview',
    'tab.screener': 'Token screener',
    'tab.token': 'Token analysis',
    'tab.portfolio': 'Portfolio',
    'tab.opportunities': 'Opportunities',
    'tab.compare': 'Compare',
    'tab.report': 'Daily report',

    'kpi.marketCap': 'Total market cap',
    'kpi.volume': '24h volume',
    'kpi.btcDominance': 'BTC dominance',
    'kpi.ethDominance': 'ETH dominance',
    'kpi.breadth': 'Advancing tokens',
    'kpi.medianChange': 'Median 24h change',
    'kpi.turnover': 'Market turnover',
    'kpi.regime': 'Market regime',
    'kpi.trendStrength': 'Trend strength',
    'kpi.volatility': 'Daily volatility',
    'kpi.liquidity': 'Liquidity',
    'kpi.rangePosition': 'Median position in day range',
    'kpi.coverage': 'Data coverage',

    'regime.bullish': 'Bullish',
    'regime.mildly-bullish': 'Mildly bullish',
    'regime.neutral': 'Neutral',
    'regime.mildly-bearish': 'Mildly bearish',
    'regime.bearish': 'Bearish',
    'regime.unknown': 'Unknown',

    'vol.low': 'Low',
    'vol.normal': 'Normal',
    'vol.high': 'High',
    'vol.extreme': 'Extreme',
    'vol.unknown': 'Unknown',

    'liq.very-liquid': 'Very deep',
    'liq.liquid': 'Deep',
    'liq.normal': 'Normal',
    'liq.thin': 'Thin',
    'liq.unknown': 'Unknown',

    'driver.breadth': 'Breadth',
    'driver.median-change': 'Median 24h change',
    'driver.market-cap-change': 'Market-cap change',
    'driver.volume-confirmation': 'Volume confirmation',
    'driver.available': 'available',
    'driver.missing': 'no data',

    'movers.gainers': 'Top gainers',
    'movers.losers': 'Top losers',
    'movers.surges': 'Unusual volume',
    'movers.surgeBasis': 'Baseline: median turnover {value}% — each row is a multiple of it',
    'movers.volume': 'Highest volume',
    'movers.empty': 'Nothing to list from the current data',

    'unavailable.title': 'Not connected yet',
    'unavailable.fear-greed': 'Fear & Greed index',
    'unavailable.open-interest': 'Derivatives open interest',
    'unavailable.funding-rates': 'Futures funding rates',
    'unavailable.liquidations': 'Liquidation data',
    'unavailable.net-exchange-flow': 'Net exchange flow',
    'unavailable.note': 'No number is invented for these; the source is not connected and the slot stays empty.',

    'screener.search': 'Search name or symbol…',
    'screener.filter.all': 'All',
    'screener.filter.gainers': 'Gainers',
    'screener.filter.losers': 'Losers',
    'screener.filter.volume': 'High volume',
    'screener.filter.nearHigh': 'Near day high',
    'screener.filter.deepAth': 'Far from ATH',
    'screener.filter.stable': 'Stablecoins',
    'screener.col.token': 'Token',
    'screener.col.price': 'Price',
    'screener.col.ch1h': '1h',
    'screener.col.ch24h': '24h',
    'screener.col.ch7d': '7d',
    'screener.col.volume': 'Volume',
    'screener.col.mcap': 'Market cap',
    'screener.col.ath': 'From ATH',
    'screener.col.action': 'Analyse',
    'screener.showing': '{shown} of {scanned} scanned',
    'screener.empty': 'No token matches this filter',
    'screener.analyze': 'Open file',

    'token.pick': 'Pick a token',
    'token.history': 'Chart range',
    'token.days.30': '30 days',
    'token.days.90': '90 days',
    'token.days.180': '180 days',
    'token.score': 'Composite score',
    'token.scoreCoverage': 'Score coverage: {value}% of the weights',
    'token.scoreMissing': 'No score — the evidence is not there',
    'token.technical': 'Technical analysis',
    'token.indicators': 'Indicators',
    'token.levels': 'Support & resistance',
    'token.support': 'Nearest support',
    'token.resistance': 'Nearest resistance',
    'token.rsi': 'RSI (14)',
    'token.macd': 'MACD histogram',
    'token.sma20': 'SMA 20',
    'token.sma50': 'SMA 50',
    'token.sma200': 'SMA 200',
    'token.bollinger': 'Bollinger (%B)',
    'token.atr': 'Relative ATR',
    'token.trend': 'Trend',
    'token.trend.uptrend': 'Uptrend',
    'token.trend.downtrend': 'Downtrend',
    'token.trend.sideways': 'Sideways',
    'token.trend.unknown': 'Unknown',
    'token.fib': 'Fibonacci',
    'token.evidence': 'Evidence',
    'token.noCandles': 'No candles were returned for this token; the technical read is withheld.',
    'token.openFull': 'Full token page',
    'token.about': 'About this score',
    'token.weights': 'Weights',

    'band.strong': 'Strong',
    'band.constructive': 'Constructive',
    'band.neutral': 'Neutral',
    'band.cautious': 'Cautious',
    'band.weak': 'Weak',

    'caveat.not-a-recommendation': 'Not a recommendation',
    'caveat.not-a-signal': 'Not a signal',
    'caveat.insufficient-coverage': 'Low data coverage',
    'caveat.short-history': 'History shorter than 200 bars',
    'caveat.offline-data': 'Offline data',
    'caveat.stale-data': 'Stale data',
    'caveat.snapshot-only': 'Market snapshot only',
    'caveat.not-advice': 'Not investment advice',
    'caveat.cost-basis-unknown': 'No recorded cost basis',
    'caveat.cost-basis-partial': 'Partial cost basis',

    'port.connect': 'Connect a wallet to analyse the portfolio',
    'port.connectHint': 'P&L needs a real buy/sell history; until then it stays "unknown".',
    'port.value': 'Total value',
    'port.cost': 'Recorded cost basis',
    'port.realised': 'Realised P&L',
    'port.unrealised': 'Unrealised P&L',
    'port.unknown': 'Unknown',
    'port.allocation': 'Asset allocation',
    'port.risk': 'Portfolio risk',
    'port.riskHigh': 'High',
    'port.riskMedium': 'Medium',
    'port.riskLow': 'Low',
    'port.concentration': 'Concentration',
    'port.effectiveHoldings': 'Effective holdings',
    'port.correlation': 'Daily return correlation',
    'port.correlationMissing': 'Correlation needs daily history for at least two assets',
    'port.suggestions': 'Data-driven suggestions',
    'port.noSuggestions': 'Nothing specific to change on the current data',
    'port.pairs': '{count} pairs, average {avg}',
    'port.horizon': 'Horizon',
    'port.riskLevel': 'Risk',
    'port.evidence': 'Evidence',
    'port.horizon.immediate': 'Immediate',
    'port.horizon.short': 'Short',
    'port.horizon.medium': 'Medium',
    'port.horizon.long': 'Long',

    'sugg.reduce-concentration': '{symbol} is {topShare}% of the portfolio; reduce single-asset concentration',
    'sugg.improve-diversification': 'Average correlation is {avgCorrelation}; the diversification is thinner than the list suggests',
    'sugg.spread-network-risk': '{weight}% of the capital sits on one network; spread the network risk',
    'sugg.review-cash-buffer': 'Stablecoin share is {stablePct}%; review the cash buffer',
    'sugg.record-cost-basis': '{rowsWithoutCost} holdings have no recorded buy price; add it for real P&L',

    'opp.title': 'Opportunity scanner',
    'opp.subtitle': 'Across {scanned} tokens; every card shows its own arithmetic',
    'opp.confidence': 'Confidence',
    'opp.empty': 'No opportunity matched the criteria in this cycle',
    'opp.open': 'Inspect',
    'opp.kind.breakout': 'Daily breakout',
    'opp.kind.momentum': 'Strong momentum',
    'opp.kind.volume-spike': 'Volume spike',
    'opp.kind.recovery': 'Weekly recovery',
    'opp.kind.distribution': 'Distribution',
    'opp.kind.relative-strength': 'Relative strength',
    'opp.all': 'All',
    'opp.reason.range-position': 'Price at {value}% of the 24h range',
    'opp.reason.change-24h': '24h change {value}%',
    'opp.reason.change-7d': '7d change {value}%',
    'opp.reason.turnover-vs-median': 'Turnover {ratio}× the market median',
    'opp.reason.market-breadth': 'In a market where only {advRatio}% of tokens are up',

    'cmp.pick': 'Pick 2 to 4 tokens',
    'cmp.metric': 'Metric',
    'cmp.best': 'Best',
    'cmp.change24h': '24h return',
    'cmp.change7d': '7d return',
    'cmp.volume': 'Volume',
    'cmp.mcap': 'Market cap',
    'cmp.rank': 'Rank',
    'cmp.ath': 'From ATH',
    'cmp.range': 'Position in day range',
    'cmp.note': 'The winner of each row is per that metric only; no overall winner is declared.',

    'report.title': 'Daily market report',
    'report.generate': 'Build report',
    'report.copy': 'Copy text',
    'report.copied': 'Copied',
    'report.download': 'Download',
    'report.generatedAt': 'Built at {time}',
    'report.section.market': 'Market overview',
    'report.section.movers': 'Top gainers and losers',
    'report.section.volume': 'Unusual volume',
    'report.section.opportunities': 'Candidates to review',
    'report.section.risks': 'New risks',
    'report.section.watch': 'What to watch over the next 24h',
    'report.sourceLine': 'Source: {source} · {counted} of {total} tokens · {time}',

    'market.sentence': 'The market is {regime}: {adv} of {total} tokens are up and the median 24h change is {median}%.',
    'market.sentence.volume': 'Total volume is {volume}, {volumeDir} {volumeChange}% versus the previous day.',
    'market.sentence.volumeUp': 'up',
    'market.sentence.volumeDown': 'down',
    'market.sentence.dom': 'Bitcoin holds {btc}% of the market.',
    'market.sentence.vol': 'Daily volatility (median range) is {vol}% and liquidity is {liq}.',
    'market.sentence.missing': 'There is no feed for {missing}, so no number is shown for it.',
    'market.why': 'Why this label?',
    'market.drivers': 'Inputs to the label',

    'time.now': 'just now',
    'time.minutes': '{n} min ago',
    'time.hours': '{n} h ago'
  }
};

export const LANGUAGES = Object.keys(COPY);

/** Locale → copy dictionary ('fa' gets Persian, everything else English). */
export function dictFor(locale) {
  return String(locale || '').toLowerCase().startsWith('fa') ? COPY.fa : COPY.en;
}

export function t(locale, key, params = {}) {
  const dict = dictFor(locale);
  const raw = dict[key];
  if (raw == null) return key;
  return interpolate(raw, params);
}

export function interpolate(template, params = {}) {
  return String(template).replace(/\{(\w+)\}/g, (m, name) => (
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : m
  ));
}

/** Both dictionaries carry the same keys — asserted by the test file. */
export function copyKeyParity() {
  const fa = new Set(Object.keys(COPY.fa));
  const en = new Set(Object.keys(COPY.en));
  return {
    onlyFa: [...fa].filter((k) => !en.has(k)),
    onlyEn: [...en].filter((k) => !fa.has(k))
  };
}

const NUM_LOCALE = { fa: 'en-US', en: 'en-US' }; // Latin digits read better in tables

export function fmtPct(value, { digits = 2, signed = true, locale = 'fa' } = {}) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const v = Number(value);
  const sign = signed && v > 0 ? '+' : '';
  return `${sign}${v.toFixed(digits)}%`;
}

export function fmtMoney(value, locale = 'fa') {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const v = Number(value);
  const tag = NUM_LOCALE[locale] || 'en-US';
  if (Math.abs(v) >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return new Intl.NumberFormat(tag, { maximumFractionDigits: 4 }).format(v).replace(/^/, '$');
}

export function fmtPrice(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const v = Number(value);
  if (v >= 1000) return `$${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toPrecision(4)}`;
}

export function fmtNumber(value, digits = 0) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: digits });
}

export function fmtTimeAgo(ts, locale) {
  if (!ts || !Number.isFinite(Number(ts))) return '—';
  const diff = Date.now() - Number(ts);
  if (diff < 60_000) return t(locale, 'time.now');
  if (diff < 3_600_000) return t(locale, 'time.minutes', { n: Math.floor(diff / 60_000) });
  return t(locale, 'time.hours', { n: Math.floor(diff / 3_600_000) });
}
