/**
 * LANDING PAGE 2.0 — ALL HUMAN COPY, BOTH LANGUAGES.
 * ---------------------------------------------------------------------------
 * The page at /صرافی-غیرمتمرکز is now a single bilingual document:
 * English by default, Persian one tap away, both rendered into the HTML at
 * build time so a crawler sees real text in both languages and a JS-less
 * visitor still reads the English default.
 *
 * Rules for anything edited here:
 *
 *   • TRUTH FIRST. No fabricated numbers — no TVL, no user counts, no APY,
 *     no rankings. Anything that looks like a number either comes from the
 *     build-time config (the platform fee) or arrives live from the app's own
 *     public API at runtime. Static copy states facts about features only.
 *
 *   • NO PROFIT PROMISES. The AI is described as analysis and preparation,
 *     never as a guarantee of returns. Several strings exist specifically to
 *     say that («AI does not guarantee profit»). Removing them is worse than
 *     marketing copy; it is a regulatory and a truth problem.
 *
 *   • THE FEE IS A PLACEHOLDER. `{{fee}}` is filled at build time from
 *     VITE_FEE_BPS by scripts/landing-v2/index.mjs so this copy can never
 *     drift away from what the engine actually charges. Do NOT hard-code a
 *     percentage here.
 *
 *   • PERSIAN IS WRITTEN, NOT TRANSLATED. The old Persian page ranked because
 *     it answered a Persian speaker's actual questions in natural Persian.
 *     Keep the same informal «تو» voice and natural phrasing; do not produce
 *     stiff literal translations of the English.
 */

export const COPY = {
  /* ------------------------------------------------------------------ */
  /* Document metadata (dynamic meta is updated on language switch too)  */
  /* ------------------------------------------------------------------ */
  meta: {
    en: {
      lang: 'en',
      dir: 'ltr',
      title: 'FBT Swap | AI-Powered Decentralized Exchange & Financial OS',
      description:
        'Swap crypto, explore DeFi, discover market opportunities and use AI-powered Intent OS across multiple blockchain networks with FBT Swap.',
      ogLocale: 'en_US'
    },
    fa: {
      lang: 'fa',
      dir: 'rtl',
      title: 'FBT Swap | صرافی غیرمتمرکز و هوش مصنوعی مالی',
      description:
        'سواپ ارز دیجیتال، تحلیل بازار، سیگنال‌های هوشمند، دیفای، فارم و Intent OS در یک پلتفرم مالی غیرمتمرکز.',
      ogLocale: 'fa_IR'
    },
    keywords:
      'decentralized exchange, DEX, crypto swap, AI crypto platform, AI trading intelligence, DeFi, cross-chain swap, crypto signals, Solana signals, smart money, whale tracking, crypto farming, yield farming, Intent OS, intent-based trading, crypto wallet, non-custodial exchange, Web3 financial platform, صرافی غیرمتمرکز, سواپ ارز دیجیتال, خرید و فروش ارز دیجیتال, کیف پول غیرامانی, دیفای, فارم ارز دیجیتال, سیگنال ارز دیجیتال, سیگنال سولانا, هوش مصنوعی ارز دیجیتال, هوش مالی, معاملات بین زنجیره‌ای',
    /* H1 for the breadcrumb schema / accessibility. */
    shortName: { en: 'FBT Swap', fa: 'اف‌بی‌تی سواپ' }
  },

  /* ------------------------------------------------------------------ */
  /* Navigation                                                          */
  /* ------------------------------------------------------------------ */
  nav: {
    links: [
      { href: '#showcase', en: 'Product tour', fa: 'گشت محصول' },
      { href: '#intent-os', en: 'Intent OS', fa: 'اینتنت OS' },
      { href: '#tokens', en: 'Markets', fa: 'بازارها' },
      { href: '#signals', en: 'Intelligence', fa: 'هوش مالی' },
      { href: '#networks', en: 'Networks', fa: 'شبکه‌ها' },
      { href: '#ecosystem', en: 'Ecosystem', fa: 'اکوسیستم' },
      { href: '#faq', en: 'FAQ', fa: 'پرسش‌ها' }
    ],
    cta: { en: 'Launch App', fa: 'باز کردن برنامه' },
    langLabel: { en: 'Language', fa: 'زبان' },
    menuOpen: { en: 'Open menu', fa: 'باز کردن منو' },
    menuClose: { en: 'Close menu', fa: 'بستن منو' },
    /* The wordmark next to the logo is gone by request — «فقط لوگو بماند».
       The label survives where it matters: aria-labels, the JSON-LD name and
       the footer, so neither a screen reader nor a crawler loses the brand. */
    brandLabel: { en: 'FBT Swap — home', fa: 'اف‌بی‌تی سواپ — خانه' }
  },

  /* ------------------------------------------------------------------ */
  /* Product tour — the bilingual slideshow                              */
  /* ------------------------------------------------------------------ */
  /* One slide per page of the app the owner asked to feature: swap, stocks,
     futures, gold and precious metals, AI. Every `route` below is a route that
     exists in src/App.jsx, and every bullet is a behaviour that screen
     actually has — the same rule as the rest of this file. */
  showcase: {
    kicker: { en: 'PRODUCT TOUR', fa: 'گشت محصول' },
    h2: { en: 'Five pages. One financial OS.', fa: 'پنج صفحه. یک سیستم‌عامل مالی.' },
    lede: {
      en: 'Swipe through what you can actually do today. Each slide opens straight into that page of the app — nothing here is a mockup.',
      fa: 'با انگشت بکش و ببین امروز واقعاً چه کاری می‌توانی بکنی. هر اسلاید مستقیم همان صفحهٔ برنامه را باز می‌کند؛ هیچ‌چیز اینجا ماکاپ نیست.'
    },
    play: { en: 'Pause slideshow', fa: 'توقف نمایش خودکار' },
    pause: { en: 'Play slideshow', fa: 'پخش خودکار' },
    autoplay: { en: 'Auto', fa: 'خودکار' },
    liveChip: { en: 'Live', fa: 'زنده' },
    slides: [
      {
        key: 'swap',
        icon: 'swap',
        art: '/landing/slide-swap.jpg',
        route: '/#/swap',
        accent: 'violet',
        tag: { en: 'Page 01 · Swap', fa: 'صفحهٔ ۰۱ · سواپ' },
        t: {
          en: 'Swap on ten networks, quote before you sign',
          fa: 'سواپ روی ده شبکه؛ اول قیمت، بعد امضا'
        },
        d: {
          en: 'You say what you want. FBT asks the public aggregators for the best route across the decentralised exchanges on that network, shows the quote, the price impact and the fee, then hands the transaction to your wallet. Nobody else signs for you.',
          fa: 'تو می‌گویی چه می‌خواهی. اف‌بی‌تی بهترین مسیر را بین صرافی‌های غیرمتمرکز همان شبکه از تجمیع‌کننده‌های عمومی می‌گیرد، قیمت، تأثیر بر قیمت و کارمزد را نشان می‌دهد، بعد تراکنش را به کیف پول تو می‌دهد. امضا فقط با توست.'
        },
        bullets: [
          { en: 'Best route across DEXs', fa: 'بهترین مسیر بین صرافی‌های غیرمتمرکز' },
          { en: 'Price impact and fee shown first', fa: 'نمایش تأثیر قیمت و کارمزد از ابتدا' },
          { en: 'Non-custodial — you hold the keys', fa: 'غیرامانی؛ کلیدها دست توئه' }
        ],
        cta: { en: 'Open Swap', fa: 'باز کردن سواپ' },
        live: { kind: 'price', id: 'bitcoin', label: { en: 'BTC price', fa: 'قیمت بیت‌کوین' } }
      },
      {
        key: 'stocks',
        icon: 'stocks',
        art: '/landing/slide-stocks.jpg',
        route: '/#/stocks',
        accent: 'cyan',
        tag: { en: 'Page 02 · Stocks', fa: 'صفحهٔ ۰۲ · سهام' },
        t: {
          en: 'US stocks as tokens, with the fakes filtered out',
          fa: 'سهام آمریکا به‌شکل توکن، با حذف جعلی‌ها'
        },
        d: {
          en: 'Apple, Tesla and Nvidia exposure trades as verified Backed xStocks on Solana. Every mint is checked against the issuer key on each fetch, so a clone with a copied logo never reaches the list, and a pool thinner than the liquidity floor is not listed at all.',
          fa: 'دسترسی به اپل، تسلا و انویدیا به‌شکل xStockهای تأیید‌شدهٔ Backed روی سولانا معامله می‌شود. هر mint در هر بار دریافت با کلید صادرکننده بررسی می‌شود، پس یک توکن جعلی با لوگوی کپی‌شده هرگز به لیست نمی‌رسد؛ استخر کم‌عمق هم اصلاً لیست نمی‌شود.'
        },
        bullets: [
          { en: 'Issuer verification on every fetch', fa: 'اعتبارسنجی صادرکننده در هر دریافت' },
          { en: 'Liquidity floor: thin markets never list', fa: 'کف نقدینگی: بازار کم‌عمق لیست نمی‌شود' },
          { en: 'Live price with a 90-day history', fa: 'قیمت زنده با تاریخچهٔ ۹۰ روزه' }
        ],
        cta: { en: 'Open Stocks', fa: 'باز کردن سهام' },
        live: { kind: 'equity', label: { en: 'Top equity', fa: 'برترین سهام' } }
      },
      {
        key: 'futures',
        icon: 'futures',
        /* Margin vocabulary — «اهرم», «liquidation», the word Futures itself.
           The store build drops this slide whole; see gateSpeculation. */
        speculative: true,
        art: '/landing/slide-futures.jpg',
        route: '/#/perp',
        accent: 'pink',
        tag: { en: 'Page 03 · Futures', fa: 'صفحهٔ ۰۳ · فیوچرز' },
        t: {
          en: 'Futures: leverage, funding and liquidation on one screen',
          fa: 'فیوچرز: اهرم، فاندینگ و لیکوئیدیشن در یک صفحه'
        },
        d: {
          en: 'The on-chain tab lists live markets with funding, open interest and candles, and the confirmation sheet shows the backend breakdown — not a local estimate. Your wallet signs the calldata. This is leverage: it can liquidate the whole position, and FBT is not the counterparty.',
          fa: 'تب آن‌چین بازارهای زنده را با فاندینگ، اوپن‌اینترست و کندل‌ها نشان می‌دهد، و برگهٔ تأیید شکسته‌ای که بک‌اند می‌دهد را می‌نویسد — نه یک محاسبهٔ محلی. تراکنش را کیف پول خودت امضا می‌کند. این اهرم است: می‌تواند کل موقعیت را لیکوئید کند، و اف‌بی‌تی طرف حساب تو نیست.'
        },
        bullets: [
          { en: 'Mark price, funding and OI per market', fa: 'قیمت مارک، فاندینگ و OI برای هر بازار' },
          { en: 'Forex, metals and indices on the RWA venue', fa: 'فارکس، فلزات و شاخص‌ها روی بستر دارایی واقعی' },
          { en: 'Server-priced risk on the confirm sheet', fa: 'ریسک با قیمت‌گذاری سرور در برگهٔ تأیید' }
        ],
        cta: { en: 'Open Futures', fa: 'باز کردن فیوچرز' },
        live: { kind: 'price', id: 'solana', label: { en: 'SOL mark', fa: 'قیمت SOL' } }
      },
      {
        key: 'gold',
        icon: 'gold',
        art: '/landing/slide-gold.jpg',
        route: '/#/stocks',
        accent: 'amber',
        tag: { en: 'Page 04 · Gold & metals', fa: 'صفحهٔ ۰۴ · طلا و فلزات' },
        t: {
          en: 'Gold and precious metals, one ounce per token',
          fa: 'طلا و فلزات گرانبها؛ هر توکن یک اونس'
        },
        d: {
          en: 'PAXG and XAUT are tokenised claims on allocated gold: they swap like any other token, with no dealer premium and no vault rental to arrange. The warning sits above the list instead of in a footnote — the issuer can freeze an address, and that is not the same thing as a bar in a safe.',
          fa: 'PAXG و XAUT ادعای توکنی‌شده روی طلای تخصیص‌یافته‌اند: مثل هر توکن دیگری سواپ می‌شوند، بدون حق‌الزحمهٔ dealer و بدون اجارهٔ گاوصندوق. هشدار بالای لیست ایستاده نه در پانوشت — صادرکننده می‌تواند یک آدرس را فریز کند، و این با یک شمش توی گاوصندوق فرق دارد.'
        },
        bullets: [
          { en: 'One token = one troy ounce', fa: 'هر توکن = یک اونس تروا' },
          { en: 'Issuer freeze risk stated up front', fa: 'ریسک فریز توسط صادرکننده، از ابتدا اعلام‌شده' },
          { en: '90 days of gold price alongside', fa: '۹۰ روز قیمت طلا کنار لیست' }
        ],
        cta: { en: 'Open gold & metals', fa: 'باز کردن طلا و فلزات' },
        live: { kind: 'commodity', label: { en: 'Tokenised gold', fa: 'طلای توکنی‌شده' } }
      },
      {
        key: 'ai',
        icon: 'ai',
        art: '/landing/slide-ai.jpg',
        route: '/#/intent',
        accent: 'lime',
        tag: { en: 'Page 05 · AI · Intent OS', fa: 'صفحهٔ ۰۵ · هوش مصنوعی · اینتنت OS' },
        t: {
          en: 'Intent OS: say it in Persian, get a plan',
          fa: 'اینتنت OS: به فارسی بگو، برنامه بگیر'
        },
        d: {
          en: 'Type what you want in Persian or English. The AI turns the sentence into a plan — market, size, route, risk flags — and stops at the approval screen. It prepares; it does not sign, and it never promises a profit.',
          fa: 'هرچه می‌خواهی را به فارسی یا انگلیسی بنویس. هوش مصنوعی جمله را به برنامه تبدیل می‌کند — بازار، اندازه، مسیر و پرچم‌های ریسک — و سرِ صفحهٔ تأیید می‌ایستد. آماده می‌کند؛ امضا نمی‌کند، و هیچ‌وقت سود تضمین نمی‌کند.'
        },
        bullets: [
          { en: 'Persian and English understood', fa: 'فارسی و انگلیسی را می‌فهمد' },
          { en: 'Plan, risk flags, then your approval', fa: 'برنامه، پرچم ریسک، بعد تأیید تو' },
          { en: 'No trade executes without you', fa: 'بدون تو هیچ معامله‌ای اجرا نمی‌شود' }
        ],
        cta: { en: 'Open Intent OS', fa: 'باز کردن اینتنت OS' },
        live: { kind: 'trending', label: { en: 'Trending now', fa: 'ترند الان' } }
      }
    ]
  },

  /* ------------------------------------------------------------------ */
  /* The floating page dock (the circle at the bottom of the screen)      */
  /* ------------------------------------------------------------------ */
  /* Replaces the burger menu: requested as «منو بازشونده داخل یک دایره پایین
     صفحه» that shows the pages and stays with the reader while scrolling. */
  dock: {
    label: { en: 'Pages', fa: 'صفحه‌ها' },
    open: { en: 'Open the page menu', fa: 'باز کردن منوی صفحه‌ها' },
    close: { en: 'Close the page menu', fa: 'بستن منوی صفحه‌ها' },
    heading: { en: 'Every page, one tap', fa: 'همهٔ صفحه‌ها، یک لمس' },
    hint: {
      en: 'This circle follows you down the page. Tap it for the app pages, the sections of this page, and the language switch.',
      fa: 'این دایره پایینِ صفحه با تو می‌آید. بزن تا صفحه‌های برنامه، بخش‌های همین صفحه و تغییر زبان را ببینی.'
    },
    /* App pages first (they are what the request asked for), then the
       sections of the landing itself. `app: true` entries get the ↗ mark. */
    pages: [
      { icon: 'swap', href: '/#/swap', en: 'Swap', fa: 'سواپ', app: true },
      { icon: 'intent', href: '/#/intent', en: 'Intent OS', fa: 'اینتنت OS', app: true },
      { icon: 'stocks', href: '/#/stocks', en: 'Stocks', fa: 'سهام', app: true },
      { icon: 'futures', href: '/#/perp', en: 'Futures', fa: 'فیوچرز', app: true, speculative: true },
      { icon: 'gold', href: '/#/stocks', en: 'Gold & metals', fa: 'طلا و فلزات', app: true },
      { icon: 'ai', href: '/#/signals', en: 'AI signals', fa: 'سیگنال هوش مصنوعی', app: true },
      { icon: 'wallet', href: '/#/wallet', en: 'Wallet', fa: 'کیف پول', app: true },
      { icon: 'farm', href: '/#/farm', en: 'Farms', fa: 'فارم‌ها', app: true },
      { icon: 'tokens', href: '#tokens', en: 'Markets', fa: 'بازارها' },
      { icon: 'network', href: '#networks', en: 'Networks', fa: 'شبکه‌ها' },
      { icon: 'smartMoney', href: '#smart-money', en: 'Smart money', fa: 'پول هوشمند' },
      { icon: 'doc', href: '#faq', en: 'FAQ', fa: 'پرسش‌ها' }
    ],
    scroll: { en: 'Scroll', fa: 'موقعیت اسکرول' }
  },

  /* ------------------------------------------------------------------ */
  /* Hero                                                                */
  /* ------------------------------------------------------------------ */
  hero: {
    eyebrow: { en: 'AI-Powered Financial OS for Onchain Markets', fa: 'سیستم‌عامل مالی هوشمند برای بازارهای روی‌زنجیره' },
    h1Parts: {
      en: ['The Intelligent', 'Financial Super App', 'for Onchain Markets'],
      fa: ['اپلیکیشن', 'مالی هوشمند', 'برای بازارهای روی‌زنجیره']
    },
    sub: {
      en: 'Swap, trade, invest, earn and manage your assets with AI-powered intent execution — while keeping control of your wallet.',
      fa: 'سواپ کن، معامله کن، سرمایه‌گذاری کن، سود بگیر و دارایی‌هات را مدیریت کن؛ با اجرای هوشمندِ مبتنی بر Intent — در حالی که کنترل کیف پول همیشه دست خودت است.'
    },
    ctaPrimary: { en: 'Launch FBT Swap', fa: 'شروع سواپ' },
    ctaSecondary: { en: 'Explore the Ecosystem', fa: 'آشنایی با اکوسیستم' },
    chips: [
      { en: '10+ Networks', fa: '+۱۰ شبکه' },
      { en: 'AI-Powered Intent OS', fa: 'اینتنت OS با هوش مصنوعی' },
      { en: 'Non-Custodial', fa: 'غیرامانی' },
      { en: 'Crypto • DeFi • RWA • Stocks • Yield', fa: 'کریپتو • دیفای • RWA • سهام • یلد' }
    ],
    /* Hero dashboard mockup — chrome labels only. Every number in it is
       either a placeholder dash or live data from the app's public API. */
    dash: {
      title: 'FBT Financial OS',
      portfolio: { en: 'Portfolio', fa: 'پورتفوی' },
      intent: { en: 'AI Intent', fa: 'اینتنت هوشمند' },
      market: { en: 'Market', fa: 'بازار' },
      signals: { en: 'Signals', fa: 'سیگنال‌ها' },
      smartMoney: { en: 'Smart Money', fa: 'پول هوشمند' },
      yield: { en: 'Yield', fa: 'یلد' },
      sampleIntents: [
        { en: '“Grow my portfolio over 3 months.”', fa: '«پورتفوی من را در ۳ ماه رشد بده.»' },
        { en: '“Get the best execution for 1,000 USDC into SOL.”', fa: '«۱,۰۰۰ دلارم را با بهترین قیمت به SOL تبدیل کن.»' },
        { en: '“I want lower risk this month.”', fa: '«این ماه ریسک کمتری می‌خوام.»' }
      ],
      smartMoneyRows: [
        { en: 'Whale tracking', fa: 'ره‌گیری نهنگ' },
        { en: 'Smart wallets', fa: 'کیف پول‌های هوشمند' },
        { en: 'Wallet alerts', fa: 'هشدار کیف پول' }
      ]
    },
    /* Live pulse strip (⚡ = rendered from /api/global at runtime). */
    pulse: {
      mcap: { en: 'Crypto Market Cap', fa: 'ارزش بازار کریپتو' },
      volume: { en: '24h Volume', fa: 'حجم ۲۴ ساعته' },
      btcDom: { en: 'BTC Dominance', fa: 'تسلط بیت‌کوین' },
      change: { en: 'Market 24h', fa: 'بازار در ۲۴ ساعت' },
      live: { en: 'Live', fa: 'زنده' },
      updated: { en: 'Updated', fa: 'به‌روزرسانی' }
    }
  },

  /* ------------------------------------------------------------------ */
  /* 3. AI Intent OS                                                     */
  /* ------------------------------------------------------------------ */
  intentOS: {
    kicker: 'AI INTENT OS',
    h2: { en: 'Meet FBT Intent OS', fa: 'با اینتنت OS اف‌بی‌تی آشنا شوید' },
    lede: {
      en: 'Tell FBT what you want. Let AI understand the goal, analyze the market, build a strategy and prepare the best execution path.',
      fa: 'به اف‌بی‌تی بگو چی می‌خوای. بذار هوش مصنوعی هدفت را بفهمد، بازار را تحلیل کند، استراتژی بسازد و بهترین مسیر اجرا را آماده کند.'
    },
    exampleLabel: { en: 'You say', fa: 'تو می‌گویی' },
    example: {
      en: '“I want to grow my $5,000 portfolio over the next 3 months.”',
      fa: '«می‌خوام پورتفوی ۵,۰۰۰ دلاری‌ام را طی ۳ ماه آینده رشد بدهم.»'
    },
    steps: [
      { en: 'Understand Intent', fa: 'درک هدف' },
      { en: 'Analyze Portfolio', fa: 'تحلیل پورتفوی' },
      { en: 'Analyze Market', fa: 'تحلیل بازار' },
      { en: 'Build Strategy', fa: 'ساخت استراتژی' },
      { en: 'Evaluate Risk', fa: 'ارزیابی ریسک' },
      { en: 'Find Opportunities', fa: 'یافتن فرصت‌ها' },
      { en: 'Request Approval', fa: 'درخواست تأیید از تو' },
      { en: 'Execute', fa: 'اجرا' },
      { en: 'Monitor', fa: 'پایش مستمر' }
    ],
    tapeTitle: {
      en: 'What the AI is reading right now — the same feed the app prices from',
      fa: 'همین الان هوش مصنوعی چه می‌خواند — همان فیدِ قیمت‌گذاری برنامه'
    },
    approvalNote: {
      en: 'Nothing moves without your approval. Every strategy is prepared and explained first — you sign every transaction yourself, in your own wallet.',
      fa: 'هیچ‌چیز بدون تأیید تو جابه‌جا نمی‌شود. هر استراتژی اول آماده و توضیح داده می‌شود؛ بعد هر تراکنش را خودت، در کیف پول خودت امضا می‌کنی.'
    },
    personalize: {
      h3: { en: 'FBT gets smarter around your intent', fa: 'اف‌بی‌تی دور هدف تو هوشمندتر می‌شود' },
      chips: [
        {
          say: { en: '“I want lower risk.”', fa: '«ریسک کمتری می‌خوام.»' },
          act: { en: 'Adjust strategy', fa: 'تنظیم استراتژی' }
        },
        {
          say: { en: '“I want long-term growth.”', fa: '«رشد بلندمدت می‌خوام.»' },
          act: { en: 'Build a long-term strategy', fa: 'ساخت استراتژی بلندمدت' }
        },
        {
          say: { en: '“Find opportunities on Solana.”', fa: '«روی سولانا فرصت پیدا کن.»' },
          act: { en: 'Scan Solana', fa: 'اسکن سولانا' }
        }
      ]
    },
    cta: { en: 'Try AI Intent', fa: 'امتحان اینتنت هوشمند' }
  },

  /* ------------------------------------------------------------------ */
  /* 4. AI Financial Brain                                               */
  /* ------------------------------------------------------------------ */
  brain: {
    kicker: { en: 'AI FINANCIAL BRAIN', fa: 'مغز مالی هوش مصنوعی' },
    h2: { en: 'Your AI Financial Brain', fa: 'مغز مالی هوش مصنوعی تو' },
    lede: {
      en: 'One intelligence layer watching your portfolio, the market and the chain — so every decision starts from data, not noise.',
      fa: 'یک لایهٔ هوشمند که پورتفوی، بازار و زنجیره را زیر نظر دارد — تا هر تصمیم از داده شروع شود، نه از هیاهو.'
    },
    cards: [
      {
        t: { en: 'Portfolio Intelligence', fa: 'هوشمندی پورتفوی' },
        d: {
          en: 'Understand what you hold, how it is positioned and where the concentration risk sits.',
          fa: 'بفهم دقیقاً چه چیزی داری، چطور چیده شده و ریسک تمرکزت کجاست.'
        }
      },
      {
        t: { en: 'Market Analysis', fa: 'تحلیل بازار' },
        d: {
          en: 'Live prices, volume, momentum and volatility — read together, not as isolated numbers.',
          fa: 'قیمت زنده، حجم، مومنتوم و نوسان — کنار هم خوانده می‌شوند، نه به‌صورت عددهای پراکنده.'
        }
      },
      {
        t: { en: 'Risk Analysis', fa: 'تحلیل ریسک' },
        d: {
          en: 'Drawdowns, exposure and worst-case history are surfaced before you commit to a path.',
          fa: 'افت از سقف، میزان مواجهه و بدترین سناریوهای تاریخی، پیش از هر تصمیم جلوی چشمت می‌آید.'
        }
      },
      {
        t: { en: 'Strategy Generation', fa: 'تولید استراتژی' },
        d: {
          en: 'Goals become concrete, reviewable plans — with steps you approve, not black-box trades.',
          fa: 'اهداف به برنامه‌های مشخص و قابل‌بازبینی تبدیل می‌شوند — با قدم‌هایی که خودت تأیید می‌کنی، نه معاملات جعبه‌سیاه.'
        }
      },
      {
        t: { en: 'Opportunity Detection', fa: 'تشخیص فرصت' },
        d: {
          en: 'Unusual volume, early movement and new yield are ranked and explained in plain language.',
          fa: 'حجم غیرعادی، حرکت‌های اولیه و یلدهای تازه رتبه‌بندی و با زبان ساده توضیح داده می‌شوند.'
        }
      },
      {
        t: { en: 'Personalized Signals', fa: 'سیگنال‌های شخصی‌سازی‌شده' },
        d: {
          en: 'Signals shaped around your assets, timeframe and risk tolerance — not the same feed for everyone.',
          fa: 'سیگنال‌هایی شکل‌گرفته بر اساس دارایی‌ها، افق زمانی و تحمل ریسک خودت — نه یک خوراک یکسان برای همه.'
        }
      },
      {
        t: { en: 'Smart Money Analysis', fa: 'تحلیل پول هوشمند' },
        d: {
          en: 'See what large wallets accumulate or exit — as context for your own research.',
          fa: 'ببین کیف پول‌های بزرگ چه چیزی جمع می‌کنند یا از آن خارج می‌شوند — به‌عنوان زمینه برای تحقیق خودت.'
        }
      },
      {
        t: { en: 'Automated Monitoring', fa: 'پایش خودکار' },
        d: {
          en: 'Once you approve a strategy, FBT keeps watching conditions and tells you when they change.',
          fa: 'وقتی استراتژی را تأیید کردی، اف‌بی‌تی شرایط را زیر نظر می‌گیرد و با تغییر آنها خبرت می‌کند.'
        }
      },
      {
        t: { en: 'Cross-chain Intelligence', fa: 'هوشمندی بین‌زنجیره‌ای' },
        d: {
          en: 'One view across networks: balances, routes and opportunities without chain-hopping yourself.',
          fa: 'یک نمای یکپارچه روی شبکه‌ها: موجودی، مسیرها و فرصت‌ها، بدون اینکه خودت بین زنجیره‌ها بپری.'
        }
      }
    ],
    honesty: {
      en: 'AI analyzes and prepares — it does not predict the future and does not guarantee profit. The decision, and the signature, stay with you.',
      fa: 'هوش مصنوعی تحلیل می‌کند و آماده می‌سازد — نه آینده را پیش‌بینی می‌کند و نه سود را تضمین. تصمیم و امضا، هر دو با تو می‌مانند.'
    }
  },

  /* ------------------------------------------------------------------ */
  /* 5. Top Tokens (dynamic)                                             */
  /* ------------------------------------------------------------------ */
  tokens: {
    kicker: { en: 'LIVE MARKET DATA', fa: 'دادهٔ زندهٔ بازار' },
    h2: { en: 'Top Tokens', fa: 'توکن‌های برتر' },
    lede: {
      en: 'The leaders of the crypto market, with prices streamed from the FBT market data API.',
      fa: 'پیشروهای بازار کریپتو؛ با قیمت‌هایی که مستقیم از API دادهٔ بازار اف‌بی‌تی می‌آید.'
    },
    cols: {
      asset: { en: 'Asset', fa: 'دارایی' },
      price: { en: 'Price', fa: 'قیمت' },
      /* The cell holds an arrow, not a percentage, since the row that carried
         both was overflowing — so the header says what the column means now.
         The exact figure is still on the arrow's title attribute. */
      change: { en: 'Direction · 24h', fa: 'جهت · ۲۴ ساعت' },
      volume: { en: 'Volume (24h)', fa: 'حجم (۲۴ ساعت)' },
      mcap: { en: 'Market Cap', fa: 'ارزش بازار' },
      trend: { en: 'Trend (7d)', fa: 'روند (۷ روز)' }
    },
    loading: { en: 'Loading live market data…', fa: 'در حال دریافت دادهٔ زندهٔ بازار…' },
    unavailable: { en: 'Data unavailable', fa: 'داده در دسترس نیست' },
    retry: { en: 'Retry', fa: 'تلاش دوباره' },
    cta: { en: 'Explore Markets', fa: 'کاوش بازارها' },
    source: { en: 'Live data · FBT market API', fa: 'دادهٔ زنده · API بازار FBT' }
  },

  /* ------------------------------------------------------------------ */
  /* 6. Top Stocks (dynamic, from curated tokenized equities)            */
  /* ------------------------------------------------------------------ */
  stocks: {
    kicker: { en: 'BEYOND CRYPTO', fa: 'فراتر از کریپتو' },
    h2: { en: 'Top Stocks', fa: 'سهام‌های برتر' },
    lede: {
      en: 'FBT is expanding toward every financial market you care about. On Solana, curated tokenized equities are already tracked with live prices — intelligence first, with trading access rolled out carefully as venues and regulations allow.',
      fa: 'اف‌بی‌تی دارد به سمت همهٔ بازارهای مالی که برایت مهم‌اند حرکت می‌کند. روی سولانا، سهام‌های توکنی‌شدهٔ منتخب همین حالا با قیمت زنده ردیابی می‌شوند — اول هوش مالی، و دسترسی به معامله هم به‌مرور و مطابق امکان پلتفرم‌ها و قوانین.'
    },
    tag: { en: 'Market intelligence', fa: 'هوش مالی بازار' },
    comingSoon: { en: 'Direct stock exposure — rollout in progress', fa: 'دسترسی مستقیم به سهام — در حال توسعه' },
    unavailable: { en: 'Data unavailable', fa: 'داده در دسترس نیست' },
    tokenizedNote: {
      en: 'Tokenized equities on Solana, price feed via the FBT API. Not a promise of availability in your region.',
      fa: 'سهام‌های توکنی‌شده روی سولانا؛ فید قیمت از API اف‌بی‌تی. تضمینی برای در دسترس بودن در منطقهٔ تو نیست.'
    },
    cta: { en: 'View Stocks', fa: 'مشاهدهٔ سهام' }
  },

  /* ------------------------------------------------------------------ */
  /* 7. Farms & Yield (dynamic)                                          */
  /* ------------------------------------------------------------------ */
  farms: {
    kicker: { en: 'DEFI YIELD', fa: 'یلد دیفای' },
    h2: { en: 'Top Farms & Yield Opportunities', fa: 'برترین فارم‌ها و فرصت‌های یلد' },
    lede: {
      en: 'Variable-rate yield from established protocols, filtered for sane risk: minimum liquidity, capped headline APY, and incentive-heavy pools flagged.',
      fa: 'یلد با نرخ متغیر از پروتکل‌های معتبار؛ با فیلتر ریسکِ عاقلانه: حداقل نقدینگی، سقف برای APY تبلیغاتی و علامت‌گذاری استخرهای وابسته به پاداش.'
    },
    filters: {
      all: { en: 'All', fa: 'همه' },
      low: { en: 'Low Risk', fa: 'ریسک کم' },
      medium: { en: 'Medium Risk', fa: 'ریسک متوسط' },
      high: { en: 'High Yield', fa: 'یلد بالا' }
    },
    cols: {
      pool: { en: 'Pool', fa: 'استخر' },
      protocol: { en: 'Protocol', fa: 'پروتکل' },
      chain: { en: 'Chain', fa: 'شبکه' },
      apy: { en: 'APY', fa: 'APY' },
      tvl: { en: 'TVL', fa: 'TVL' },
      risk: { en: 'Risk', fa: 'ریسک' }
    },
    riskLabels: {
      low: { en: 'Low', fa: 'کم' },
      medium: { en: 'Medium', fa: 'متوسط' },
      high: { en: 'High', fa: 'زیاد' }
    },
    note: {
      en: 'Rates are variable and set by each protocol, not by FBT. Source: DefiLlama. Not financial advice.',
      fa: 'نرخ‌ها متغیرند و هر پروتکل تعیین‌شان می‌کند، نه اف‌بی‌تی. منبع: DefiLlama. توصیهٔ مالی نیست.'
    },
    unavailable: { en: 'Data unavailable', fa: 'داده در دسترس نیست' },
    cta: { en: 'Explore Farms', fa: 'کاوش فارم‌ها' }
  },

  /* ------------------------------------------------------------------ */
  /* 8. AI Signals                                                        */
  /* ------------------------------------------------------------------ */
  signals: {
    kicker: { en: 'SIGNAL CENTER', fa: 'مرکز سیگنال' },
    h2: { en: 'AI Market Signals', fa: 'سیگنال‌های هوشمند بازار' },
    lede: {
      en: 'Inside the app, every signal is computed from price history, volume and on-chain data — and shown with the reasoning, not just a color.',
      fa: 'داخل برنامه هر سیگنال از تاریخچهٔ قیمت، حجم و دادهٔ روی‌زنجیره محاسبه می‌شود — و با دلیلش نشان داده می‌شود، نه فقط با یک رنگ.'
    },
    tiers: [
      { key: 'strong-buy', en: 'Strong Buy', fa: 'خرید قوی', d: { en: 'Multiple indicators align with strong momentum.', fa: 'چند اندیکاتور با مومنتوم قوی هم‌جهت‌اند.' } },
      { key: 'buy', en: 'Buy', fa: 'خرید', d: { en: 'Momentum leans positive across the window.', fa: 'مومنتوم در بازهٔ انتخابی متمایل به مثبت است.' } },
      { key: 'watch', en: 'Watch', fa: 'زیر نظر', d: { en: 'Mixed readings — worth attention, not action.', fa: 'قرائت‌ها مخلوط‌اند — ارزش توجه دارد، نه اقدام.' } },
      { key: 'sell', en: 'Sell', fa: 'فروش', d: { en: 'Momentum leans negative across the window.', fa: 'مومنتوم در بازهٔ انتخابی متمایل به منفی است.' } },
      { key: 'high-risk', en: 'High Risk', fa: 'پرریسک', d: { en: 'Extreme volatility or thin liquidity — tread carefully.', fa: 'نوسان شدید یا نقدینگی کم — با احتیاط.' } }
    ],
    fields: [
      { en: 'Asset', fa: 'دارایی' },
      { en: 'Confidence', fa: 'اطمینان' },
      { en: 'Risk', fa: 'ریسک' },
      { en: 'Timeframe', fa: 'بازهٔ زمانی' },
      { en: 'Momentum', fa: 'مومنتوم' }
    ],
    honesty: {
      en: 'Signals are measurements of past data — context for research, never advice and never a promise.',
      fa: 'سیگنال‌ها اندازه‌گیری دادهٔ گذشته‌اند — زمینه برای تحقیق؛ نه توصیه و نه وعده.'
    },
    artNote: {
      en: 'This is what the Signals screen looks like with live data on it — tiers, reasoning and the numbers behind each call. Nothing on that screen is written in advance.',
      fa: 'این همان صفحهٔ سیگنال‌ها با دادهٔ زنده است — سطح‌بندی، استدلال و اعدادِ پشت هر نظر. هیچ‌چیز در آن صفحه از پیش نوشته نشده.'
    },
    cta: { en: 'View All Signals', fa: 'مشاهدهٔ همهٔ سیگنال‌ها' }
  },

  /* ------------------------------------------------------------------ */
  /* 9. Solana Intelligence (partially dynamic)                          */
  /* ------------------------------------------------------------------ */
  solana: {
    kicker: { en: 'SOLANA INTELLIGENCE', fa: 'هوشمندی سولانا' },
    h2: { en: 'Solana Intelligence', fa: 'هوشمندی سولانا' },
    lede: {
      en: 'The fastest onchain market, instrumented: early tokens, whale activity, liquidity and live prices on the assets that matter.',
      fa: 'سریع‌ترین بازار روی‌زنجیره، با ابزار دقیق: توکن‌های تازه، فعالیت نهنگ‌ها، نقدینگی و قیمت زندهٔ دارایی‌های مهم.'
    },
    chips: [
      { en: 'SOL', fa: 'SOL' },
      { en: 'Early tokens', fa: 'توکن‌های تازه' },
      { en: 'Meme coins', fa: 'میم‌کوین‌ها' },
      { en: 'Smart money', fa: 'پول هوشمند' },
      { en: 'Whale activity', fa: 'فعالیت نهنگ‌ها' },
      { en: 'Volume spikes', fa: 'جهش حجم' },
      { en: 'Liquidity', fa: 'نقدینگی' },
      { en: 'Holder growth', fa: 'رشد هولدرها' },
      { en: 'Early signals', fa: 'سیگنال‌های زودهنگام' }
    ],
    liveListTitle: { en: 'Curated Solana assets — live', fa: 'دارایی‌های منتخب سولانا — زنده' },
    kindLst: { en: 'Liquid staking', fa: 'استیکینگ مایع' },
    unavailable: { en: 'Data unavailable', fa: 'داده در دسترس نیست' },
    cta: { en: 'Explore Solana Signals', fa: 'کاوش سیگنال‌های سولانا' }
  },

  /* ------------------------------------------------------------------ */
  /* 10. Smart Money                                                     */
  /* ------------------------------------------------------------------ */
  smartMoney: {
    kicker: { en: 'SMART MONEY', fa: 'پول هوشمند' },
    h2: { en: 'Follow Smart Money', fa: 'پول هوشمند را دنبال کن' },
    lede: {
      en: 'See where experienced wallets move — whale transfers, accumulation and smart-wallet behavior — as intelligence for your own decisions.',
      fa: 'ببین کیف پول‌های باتجربه کجا می‌روند — انتقال‌های نهنگی، جمع‌کردن تدریجی و رفتار کیف پول‌های هوشمند — به‌عنوان زمینه برای تصمیم خودت.'
    },
    cards: [
      { t: { en: 'Whale Tracking', fa: 'ره‌گیری نهنگ' }, d: { en: 'Large transfers surfaced as they happen.', fa: 'انتقال‌های بزرگ همان لحظه که رخ می‌دهند دیده می‌شوند.' } },
      { t: { en: 'Smart Wallets', fa: 'کیف پول‌های هوشمند' }, d: { en: 'Wallets with track records, ranked and explorable.', fa: 'کیف پول‌های دارای سابقه، رتبه‌بندی‌شده و قابل‌کاوش.' } },
      { t: { en: 'Wallet Alerts', fa: 'هشدار کیف پول' }, d: { en: 'Watch an address and get told when it moves.', fa: 'یک آدرس را زیر نظر بگیر و با حرکتش باخبر شو.' } },
      { t: { en: 'Wallet P&L', fa: 'سود و زیان کیف پول' }, d: { en: 'See realized performance behind any tracked wallet.', fa: 'عملکرد تحقق‌یافتهٔ پشت هر کیف پول را ببین.' } },
      { t: { en: 'Token Holder Analysis', fa: 'تحلیل هولدرهای توکن' }, d: { en: 'Concentration, growth and the biggest holders, measured.', fa: 'تمرکز، رشد و بزرگ‌ترین هولدرها، به‌صورت اندازه‌گیری‌شده.' } },
      { t: { en: 'Early Accumulation', fa: 'انباشت زودهنگام' }, d: { en: 'Spot quiet buying before it becomes a chart everyone sees.', fa: 'خریدهای تدریجی را ببین؛ پیش از آنکه روی نمودارِ همه‌کس نمایان شود.' } },
      { t: { en: 'Large Transactions', fa: 'تراکنش‌های بزرگ' }, d: { en: 'Exchange inflows, outflows and oversized moves, explained.', fa: 'ورود و خروج صرافی‌ها و جابه‌جایی‌های بزرگ، با توضیح.' } }
    ],
    honesty: {
      en: 'This is market intelligence — context for your research. It is not copy-trading, not a guarantee, and past wallet performance does not predict future results.',
      fa: 'این بخش هوش مالی بازار است — زمینه برای تحقیق خودت. کپی‌تریدینگ نیست، تضمین هم نیست، و عملکرد گذشتهٔ کیف پول‌ها آینده را پیش‌بینی نمی‌کند.'
    },
    cta: { en: 'Open Smart Money', fa: 'باز کردن پول هوشمند' }
  },

  /* ------------------------------------------------------------------ */
  /* 11. Cross-chain                                                     */
  /* ------------------------------------------------------------------ */
  networks: {
    kicker: { en: 'MULTI-CHAIN', fa: 'چندزنجیره‌ای' },
    h2: { en: 'One Experience. Multiple Networks.', fa: 'یک تجربه. چندین شبکه.' },
    lede: {
      en: 'Move through onchain markets without forcing you to think about blockchain complexity.',
      fa: 'در بازارهای روی‌زنجیره حرکت کن؛ بدون اینکه مجبور باشی به پیچیدگی بلاکچین فکر کنی.'
    },
    list: [
      { name: 'BNB Chain', color: '#f0b90b' },
      { name: 'Ethereum', color: '#627eea' },
      { name: 'Polygon', color: '#8247e5' },
      { name: 'Arbitrum', color: '#28a0f0' },
      { name: 'Base', color: '#0052ff' },
      { name: 'Optimism', color: '#ff0420' },
      { name: 'Avalanche', color: '#e84142' },
      { name: 'Linea', color: '#61dfff' },
      { name: 'Sonic', color: '#19e1f5' },
      { name: 'Solana', color: '#9945ff' }
    ]
  },

  /* ------------------------------------------------------------------ */
  /* 12. Intent-based trading                                            */
  /* ------------------------------------------------------------------ */
  intentTrading: {
    kicker: { en: 'INTENT-BASED TRADING', fa: 'معاملهٔ مبتنی بر Intent' },
    h2: { en: "Don't Tell Us HOW. Tell Us WHAT You Want.", fa: 'به ما نگو چطور؛ بگو چی می‌خوای.' },
    oldWayLabel: { en: 'The old way', fa: 'روش قدیمی' },
    oldWay: {
      en: 'Choose Chain → Choose DEX → Choose Route → Set Gas → Swap',
      fa: 'انتخاب شبکه ← انتخاب صرافی ← انتخاب مسیر ← تنظیم گس ← سواپ'
    },
    newWayLabel: { en: 'The FBT way', fa: 'روش اف‌بی‌تی' },
    example: {
      en: '“Get me the best available execution for 1,000 USDC into SOL.”',
      fa: '«۱,۰۰۰ دلارم را با بهترین اجرای ممکن به SOL تبدیل کن.»'
    },
    flow: [
      { en: 'Intent', fa: 'نیت' },
      { en: 'Quote', fa: 'قیمت‌گذاری' },
      { en: 'Route', fa: 'مسیریابی' },
      { en: 'Risk Check', fa: 'بررسی ریسک' },
      { en: 'User Approval', fa: 'تأیید کاربر' },
      { en: 'Execution', fa: 'اجرا' }
    ],
    note: {
      en: 'You state the outcome you want. FBT finds the path — and still asks you to approve before anything executes.',
      fa: 'تو نتیجه‌ای را که می‌خواهی بیان می‌کنی؛ اف‌بی‌تی مسیرش را پیدا می‌کند — و باز هم پیش از هر اجرا از تو تأیید می‌گیرد.'
    }
  },

  /* ------------------------------------------------------------------ */
  /* 13. Product ecosystem                                               */
  /* ------------------------------------------------------------------ */
  ecosystem: {
    kicker: { en: 'PRODUCT ECOSYSTEM', fa: 'اکوسیستم محصول' },
    h2: { en: 'Everything in One Financial OS', fa: 'همه‌چیز در یک سیستم‌عامل مالی' },
    lede: {
      en: 'Every screen below exists in the app today and opens with one tap. No demos, no waitlists.',
      fa: 'هر صفحه‌ای که پایین می‌بینی همین امروز داخل برنامه هست و با یک لمس باز می‌شود. نه دمو، نه لیست انتظار.'
    },
    cards: [
      { icon: 'swap', route: '/#/swap', t: { en: 'Swap', fa: 'سواپ' }, d: { en: 'Cross-chain token swaps with route and fee shown up front.', fa: 'سواپ بین‌زنجیره‌ای توکن‌ها با نمایش مسیر و کارمزد از ابتدا.' } },
      { icon: 'wallet', route: '/#/wallet', t: { en: 'Wallet', fa: 'کیف پول' }, d: { en: 'Manage digital assets from a wallet you control.', fa: 'مدیریت دارایی‌های دیجیتال از کیف پولی که در کنترل توست.' } },
      { icon: 'signals', route: '/#/signals', t: { en: 'Signals', fa: 'سیگنال‌ها' }, d: { en: 'AI-powered market intelligence with shown reasoning.', fa: 'هوش مالی مبتنی بر هوش مصنوعی با دلیلِ شفاف.' } },
      { icon: 'intent', route: '/#/intent', t: { en: 'Intent OS', fa: 'اینتنت OS' }, d: { en: 'Natural-language financial actions, executed with your approval.', fa: 'اقدامات مالی با زبان طبیعی؛ با تأیید خودت اجرا می‌شوند.' } },
      { icon: 'smartMoney', route: '/#/smart-money', t: { en: 'Smart Money', fa: 'پول هوشمند' }, d: { en: 'Whale & smart wallet intelligence.', fa: 'هوشمندی نهنگ‌ها و کیف پول‌های هوشمند.' } },
      { icon: 'farm', route: '/#/farm', t: { en: 'Farms', fa: 'فارم‌ها' }, d: { en: 'Yield & liquidity opportunities with risk flags.', fa: 'فرصت‌های یلد و نقدینگی با پرچم ریسک.' } },
      { icon: 'orders', route: '/#/orders', t: { en: 'Orders', fa: 'سفارش‌ها' }, d: { en: 'Price alerts, targets and recurring-buy reminders.', fa: 'هشدار قیمت، اهداف قیمتی و یادآور خرید پله‌ای.' } },
      { icon: 'lending', route: '/#/loan', t: { en: 'Lending', fa: 'وام‌دهی' }, d: { en: 'Borrow & lend flows, only where supported.', fa: 'جریان‌های قرض و وام، فقط جایی که پشتیبانی می‌شود.' } },
      { icon: 'stocks', route: '/#/stocks', t: { en: 'Stocks', fa: 'سهام' }, d: { en: 'Market intelligence and tokenized exposure where live.', fa: 'هوش مالی بازار و مواجههٔ توکنی‌شده، جایی که فعال است.' } },
      { icon: 'rwa', route: '/#/explore', t: { en: 'RWA', fa: 'RWA' }, d: { en: 'Tokenized real-world assets such as gold, where supported.', fa: 'دارایی‌های واقعی توکنی‌شده مثل طلا، جایی که پشتیبانی می‌شود.' } },
      { icon: 'ai', route: '/#/intent', t: { en: 'AI', fa: 'هوش مصنوعی' }, d: { en: 'Personal financial intelligence around your goals.', fa: 'هوش مالی شخصی، شکل‌گرفته دور اهداف تو.' } },
      { icon: 'explore', route: '/#/explore', t: { en: 'Explore', fa: 'کاوش' }, d: { en: 'Onchain discovery across assets, perps and venues.', fa: 'کشف بازارهای روی‌زنجیره؛ دارایی‌ها و پلتفرم‌ها.' } }
    ]
  },

  /* ------------------------------------------------------------------ */
  /* 14. Non-custodial                                                   */
  /* ------------------------------------------------------------------ */
  nonCustodial: {
    kicker: { en: 'SELF-CUSTODY', fa: 'حضانت شخصی' },
    h2: { en: 'Your Wallet. Your Keys. Your Control.', fa: 'کیف پول تو. کلیدهای تو. کنترل تو.' },
    cards: [
      { t: { en: 'Non-Custodial', fa: 'غیرامانی' }, d: { en: 'FBT never takes deposits and never holds your assets.', fa: 'اف‌بی‌تی هیچ‌وقت واریز نمی‌گیرد و دارایی‌ات را نگه نمی‌دارد.' } },
      { t: { en: 'User-Controlled Signing', fa: 'امضا در کنترل کاربر' }, d: { en: 'Every transaction is signed by you, inside your own wallet.', fa: 'هر تراکنش توسط خودت داخل کیف پول خودت امضا می‌شود.' } },
      { t: { en: 'No Seed Collection', fa: 'بدون درخواست عبارت بازیابی' }, d: { en: 'We never ask for your recovery phrase. Anyone who does is a scammer.', fa: 'ما هرگز عبارت بازیابی‌ات را نمی‌خواهیم. هر کس خواست، کلاهبردار است.' } },
      { t: { en: 'Onchain Execution', fa: 'اجرا روی زنجیره' }, d: { en: 'Swaps settle on-chain between your wallet and the protocol.', fa: 'سواپ‌ها روی زنجیره، مستقیم بین کیف پول تو و پروتکل تسویه می‌شوند.' } },
      { t: { en: 'Transparent Transactions', fa: 'تراکنش‌های شفاف' }, d: { en: 'Route, price impact and fee are shown before you sign.', fa: 'مسیر، اثر قیمتی و کارمزد، پیش از امضا نمایش داده می‌شوند.' } }
    ],
    artNote: {
      en: 'A key made of light, held by a hand, not by us. This is what "non-custodial" looks like from the outside: the approval screen is yours, and so is the responsibility.',
      fa: 'کلیدی از نور، توی دست تو، نه دست ما. «غیرامانی» از بیرون همین شکلی است: صفحهٔ تأیید مال توست و مسئولیتش هم مال توست.'
    },
    feeTitle: { en: 'One honest fee, shown before you sign', fa: 'یک کارمزد صادقانه، پیش از امضا روی صفحه' },
    feeBody: {
      en: 'Platform fee: {{fee}}% of the input amount, shown on screen before you sign, on every supported network. No account, no email, no identity check for using the swap interface.',
      fa: 'کارمزد پلتفرم: {{fee}}٪ از مبلغ ورودی؛ پیش از امضا روی صفحه نمایش داده می‌شود، روی همهٔ شبکه‌های پشتیبانی‌شده. برای استفاده از رابط سواپ نه حساب لازم است، نه ایمیل و نه احراز هویت.'
    }
  },

  /* ------------------------------------------------------------------ */
  /* 15. Security                                                        */
  /* ------------------------------------------------------------------ */
  security: {
    kicker: { en: 'SECURITY MODEL', fa: 'مدل امنیتی' },
    h2: { en: 'Built Around User Control', fa: 'ساخته‌شده بر پایهٔ کنترل کاربر' },
    cards: [
      { t: { en: 'Non-Custodial Architecture', fa: 'معماری غیرامانی' }, d: { en: 'Keys never touch our servers — there is nothing of yours for us to lose.', fa: 'کلیدها هیچ‌وقت به سرور ما نمی‌رسند — چیزی از آن تو نداریم که گمش کنیم.' } },
      { t: { en: 'Secure Wallet Signing', fa: 'امضای امن در کیف پول' }, d: { en: 'Approvals happen in your wallet, under your wallet’s own checks.', fa: 'تأییدها داخل کیف پول و زیر بررسی‌های خودِ کیف پول انجام می‌شود.' } },
      { t: { en: 'Pre-Sign Simulation', fa: 'شبیه‌سازی پیش از امضا' }, d: { en: 'Intent flows simulate the outcome first, so surprises are rare.', fa: 'جریان‌های اینتنت نتیجه را اول شبیه‌سازی می‌کنند تا غافلگیری کمتر شود.' } },
      { t: { en: 'Token Risk Detection', fa: 'تشخیص ریسک توکن' }, d: { en: 'Honeypot, tax and liquidity screens on tokens before you interact.', fa: 'بررسی هانی‌پات، مالیات و نقدینگی توکن‌ها پیش از هر تعامل.' } },
      { t: { en: 'Permission Controls', fa: 'کنترل دسترسی‌ها' }, d: { en: 'No unlimited allowances requested; approvals stay scoped and visible.', fa: 'مجوز نامحدود از تو گرفته نمی‌شود؛ مجوزها محدود و قابل‌مشاهده می‌مانند.' } },
      { t: { en: 'Execution Verification', fa: 'راستی‌آزمایی اجرا' }, d: { en: 'Quotes and routes are checked against what actually executed.', fa: 'قیمت‌ها و مسیرها با چیزی که واقعاً اجرا شده مقایسه می‌شوند.' } },
      { t: { en: 'Onchain Transparency', fa: 'شفافیت روی زنجیره' }, d: { en: 'Every result is a real transaction you can verify on an explorer.', fa: 'هر نتیجه یک تراکنش واقعی است که می‌توانی روی explorer بررسی‌اش کنی.' } }
    ],
    cta: { en: 'Read the Security Model', fa: 'مدل امنیتی را بخوان' }
  },

  /* ------------------------------------------------------------------ */
  /* 16. Market intelligence dashboard (dynamic)                         */
  /* ------------------------------------------------------------------ */
  marketIntel: {
    kicker: { en: 'MARKET INTELLIGENCE', fa: 'هوش مالی بازار' },
    h2: { en: 'Market Overview', fa: 'نمای کلی بازار' },
    lede: {
      en: 'A live snapshot of the whole market and its outliers — refreshed while you watch.',
      fa: 'تصویر زنده از کل بازار و حاشیه‌هایش — همین‌جا جلوی چشمت تازه می‌شود.'
    },
    cards: {
      mcap: { t: { en: 'Crypto Market', fa: 'بازار کریپتو' }, unit: { en: 'total market cap', fa: 'ارزش کل بازار' } },
      volume: { t: { en: '24h Volume', fa: 'حجم ۲۴ ساعته' }, unit: { en: 'across the market', fa: 'در کل بازار' } },
      btcDom: { t: { en: 'BTC Dominance', fa: 'تسلط بیت‌کوین' }, unit: { en: 'share of market cap', fa: 'سهم از ارزش بازار' } },
      gainer: { t: { en: 'Top Gainer', fa: 'بیشترین رشد' }, unit: { en: '24h, among top assets', fa: 'در ۲۴ ساعت، میان دارایی‌های برتر' } },
      loser: { t: { en: 'Top Loser', fa: 'بیشترین افت' }, unit: { en: '24h, among top assets', fa: 'در ۲۴ ساعت، میان دارایی‌های برتر' } },
      trending: { t: { en: 'Trending', fa: 'ترند' }, unit: { en: 'most searched right now', fa: 'پرجست‌وجوترین همین حالا' } }
    },
    unavailable: { en: 'Data unavailable', fa: 'داده در دسترس نیست' }
  },

  /* ------------------------------------------------------------------ */
  /* 17. Opportunities (dynamic + capability)                            */
  /* ------------------------------------------------------------------ */
  opportunities: {
    kicker: { en: 'OPPORTUNITIES', fa: 'فرصت‌ها' },
    h2: { en: 'Opportunities', fa: 'فرصت‌ها' },
    lede: {
      en: 'Three kinds of edge FBT surfaces — always from live data, always with risk next to the reward.',
      fa: 'سه نوع برتری که اف‌بی‌تی جلوی چشمت می‌گذارد — همیشه از دادهٔ زنده و همیشه با ریسکِ کنارِ پاداش.'
    },
    trending: {
      t: { en: 'Trending', fa: 'ترند' },
      d: { en: 'Assets with surging attention and activity, measured live.', fa: 'دارایی‌هایی با جهش توجه و فعالیت، اندازه‌گیری زنده.' }
    },
    early: {
      t: { en: 'Early', fa: 'زودهنگام' },
      d: {
        en: 'Early signals live on Solana and smart money: accumulation, holder growth and volume spikes before the crowd.',
        fa: 'سیگنال‌های زودهنگام در بخش سولانا و پول هوشمند می‌زیستند: انباشت، رشد هولدر و جهش حجم؛ پیش از جمعیت.'
      },
      cta: { en: 'Hunt Early Signals', fa: 'شکار سیگنال‌های زودهنگام' }
    },
    yield: {
      t: { en: 'Yield', fa: 'یلد' },
      d: { en: 'Sustainable, filtered yield — the same data as the farms section above.', fa: 'یلد پایدار و فیلترشده — همان دادهٔ بخش فارم‌ها در بالا.' }
    },
    rankLabel: { en: 'Market rank', fa: 'رتبهٔ بازار' },
    changeLabel: { en: '24h', fa: '۲۴ ساعت' },
    apyLabel: { en: 'APY', fa: 'APY' },
    tvlLabel: { en: 'TVL', fa: 'TVL' },
    unavailable: { en: 'Data unavailable', fa: 'داده در دسترس نیست' }
  },

  /* ------------------------------------------------------------------ */
  /* 18. Why FBT                                                         */
  /* ------------------------------------------------------------------ */
  why: {
    kicker: { en: 'WHY FBT', fa: 'چرا اف‌بی‌تی' },
    h2: { en: 'Why FBT Swap?', fa: 'چرا اف‌بی‌تی سواپ؟' },
    cards: [
      { t: { en: 'Non-Custodial', fa: 'غیرامانی' }, d: { en: 'You maintain control of your wallet, always.', fa: 'کنترل کیف پول همیشه‌ و در هر شرایطی دست توست.' } },
      { t: { en: 'AI-Powered', fa: 'مبتنی بر هوش مصنوعی' }, d: { en: 'AI helps understand intents and analyze opportunities.', fa: 'هوش مصنوعی به درک اهداف و تحلیل فرصت‌ها کمک می‌کند.' } },
      { t: { en: 'Multi-Chain', fa: 'چندزنجیره‌ای' }, d: { en: 'Access multiple networks from one experience.', fa: 'به چندین شبکه از یک تجربهٔ واحد دسترسی داشته باش.' } },
      { t: { en: 'Data-Driven', fa: 'داده‌محور' }, d: { en: 'Live market and onchain data behind every screen.', fa: 'دادهٔ زندهٔ بازار و زنجیره پشت هر صفحه.' } },
      { t: { en: 'Intent-Based', fa: 'مبتنی بر Intent' }, d: { en: 'Focus on the outcome you want, not transaction plumbing.', fa: 'روی نتیجه‌ای که می‌خواهی تمرکز کن، نه پیچیدگی تراکنش.' } },
      { t: { en: 'Transparent', fa: 'شفاف' }, d: { en: 'Routes, fees and details are shown before you confirm.', fa: 'مسیرها، کارمزدها و جزئیات، پیش از تأیید نمایش داده می‌شوند.' } }
    ]
  },

  /* ------------------------------------------------------------------ */
  /* 19. FAQ (both languages, mirrored in the FAQPage schema)            */
  /* ------------------------------------------------------------------ */
  faq: {
    kicker: { en: 'FAQ', fa: 'پرسش‌های رایج' },
    h2: { en: 'Frequently Asked Questions', fa: 'پرسش‌های رایج' },
    items: [
      {
        q: { en: 'What is FBT Swap?', fa: 'اف‌بی‌تی سواپ چیست؟' },
        a: {
          en: 'FBT Swap is an AI-powered financial operating system for onchain markets: a non-custodial swap interface plus signals, Solana intelligence, smart money tracking, farms and portfolio tools — across 10 networks.',
          fa: 'اف‌بی‌تی سواپ یک سیستم‌عامل مالی هوشمند برای بازارهای روی‌زنجیره است: رابط سواپ غیرامانی به‌همراه سیگنال، هوشمندی سولانا، ره‌گیری پول هوشمند، فارم و ابزارهای پورتفوی — روی ۱۰ شبکه.'
        }
      },
      {
        q: { en: 'Is FBT Swap non-custodial?', fa: 'آیا اف‌بی‌تی سواپ غیرامانی است؟' },
        a: {
          en: 'Yes. FBT Swap never takes deposits, never holds your assets and never asks for a recovery phrase. You connect a wallet you control and sign every transaction yourself, inside your own wallet.',
          fa: 'بله. اف‌بی‌تی سواپ هیچ‌وقت واریز نمی‌گیرد، دارایی‌ات را نگه نمی‌دارد و عبارت بازیابی را نمی‌خواهد. کیف پول خودت را وصل می‌کنی و هر تراکنش را خودت، داخل کیف پول خودت امضا می‌کنی.'
        }
      },
      {
        q: { en: 'Which networks are supported?', fa: 'کدام شبکه‌ها پشتیبانی می‌شوند؟' },
        a: {
          en: 'BNB Chain, Ethereum, Polygon, Arbitrum, Base, Optimism, Avalanche, Linea, Sonic and Solana. Always double-check the selected network before signing or sending.',
          fa: 'بی‌ان‌بی چین، اتریوم، پالیگان، آربیتروم، بیس، اپتیمیسم، آوالانچ، لینیا، سونیک و سولانا. پیش از امضا یا ارسال، شبکهٔ انتخاب‌شده را حتماً دوباره بررسی کن.'
        }
      },
      {
        q: { en: 'What is FBT Intent OS?', fa: 'اینتنت OS اف‌بی‌تی چیست؟' },
        a: {
          en: 'Intent OS lets you state an outcome — “grow my portfolio”, “swap 1,000 USDC into SOL at the best available execution” — and the AI understands the goal, builds a strategy and prepares the execution path. Nothing runs until you approve it.',
          fa: 'اینتنت OS اجازه می‌دهد نتیجه‌ای را که می‌خواهی بگویی — «پورتفویم را رشد بده»، «۱,۰۰۰ دلارم را با بهترین اجرا به SOL تبدیل کن» — و هوش مصنوعی هدف را می‌فهمد، استراتژی می‌سازد و مسیر اجرا را آماده می‌کند. تا تو تأیید نکنی، هیچ‌چیز اجرا نمی‌شود.'
        }
      },
      {
        q: { en: 'What can the AI analyze?', fa: 'هوش مصنوعی چه چیزهایی را می‌تواند تحلیل کند؟' },
        a: {
          en: 'Your portfolio composition and risk, live market prices, volume and volatility, yield opportunities, and onchain signals such as whale activity and liquidity — all presented as context you can question, not orders.',
          fa: 'ترکیب و ریسک پورتفوی، قیمت‌های زندهٔ بازار، حجم و نوسان، فرصت‌های یلد و سیگنال‌های روی‌زنجیره مثل فعالیت نهنگ‌ها و نقدینگی — همه به‌عنوان زمینه‌ای ارائه می‌شوند که می‌تواند درباره‌اش سؤال بپرسی، نه دستور.'
        }
      },
      {
        q: { en: 'What are AI Signals?', fa: 'سیگنال‌های هوشمند چیستند؟' },
        a: {
          en: 'Signals are measurements computed from price history, volume and onchain data, labeled by strength — from Watch to Strong Buy — and always shown with reasoning. They are research context, not advice.',
          fa: 'سیگنال‌ها اندازه‌گیری‌هایی هستند که از تاریخچهٔ قیمت، حجم و دادهٔ روی‌زنجیره محاسبه و بر اساس قوت برچسب‌گذاری می‌شوند — از «زیر نظر» تا «خرید قوی» — و همیشه با دلیلشان نمایش داده می‌شوند. زمینهٔ تحقیق‌اند، نه توصیه.'
        }
      },
      {
        q: { en: 'Does FBT guarantee investment returns?', fa: 'آیا اف‌بی‌تی بازده سرمایه‌گذاری را تضمین می‌کند؟' },
        a: {
          en: 'No — and nothing honest in this market can. Crypto assets are volatile and you can lose money, including all of it. FBT provides data, analysis and execution tools; the decisions and the risk remain yours.',
          fa: 'نه — و هیچ چیز صادقانه‌ای هم در این بازار نمی‌تواند چنین کند. دارایی‌های دیجیتال پرنوسان‌اند و ممکن است پول از دست بدهی، حتی همه‌اش را. اف‌بی‌تی داده، تحلیل و ابزار اجرا فراهم می‌کند؛ تصمیم و ریسک با خود توست.'
        }
      },
      {
        q: { en: 'What is Solana Intelligence?', fa: 'هوشمندی سولانا چیست؟' },
        a: {
          en: 'A dedicated view of the Solana market: early tokens, whale activity, liquidity, holder growth and early signals — alongside live prices for curated Solana assets like liquid staking tokens and tokenized equities.',
          fa: 'یک نمای اختصاصی از بازار سولانا: توکن‌های تازه، فعالیت نهنگ‌ها، نقدینگی، رشد هولدرها و سیگنال‌های زودهنگام — در کنار قیمت زندهٔ دارایی‌های منتخب سولانا مثل توکن‌های استیکینگ مایع و سهام توکنی‌شده.'
        }
      }
    ]
  },

  /* ------------------------------------------------------------------ */
  /* 20. Final CTA + risk + footer                                       */
  /* ------------------------------------------------------------------ */
  finalCta: {
    h2: { en: 'Your Keys. Your Market. One Intelligent OS.', fa: 'کلیدهای تو. بازار تو. یک سیستم‌عامل هوشمند.' },
    sub: {
      en: 'Open FBT Swap and see the market the way an analyst would — then act on it from the wallet you already own.',
      fa: 'اف‌بی‌تی سواپ را باز کن و بازار را همان‌طور ببین که یک تحلیل‌گر می‌بیند — بعد از همان کیف پولی که الان داری اقدام کن.'
    },
    primary: { en: 'Launch FBT Swap', fa: 'شروع سواپ' },
    secondary: { en: 'Try AI Intent', fa: 'امتحان اینتنت هوشمند' }
  },

  risk: {
    t: { en: 'Risk notice', fa: 'هشدار ریسک' },
    body: {
      en: 'Crypto assets are volatile and on-chain transactions cannot be reversed. You can lose money, including all of it. Nothing on this page — including market data, signals and AI analysis — is financial advice.',
      fa: 'ارزهای دیجیتال پرنوسان‌اند و تراکنش‌های روی زنجیره برگشت‌ناپذیرند. ممکن است پول از دست بدهی، حتی همه‌اش را. هیچ‌چیز این صفحه — از جمله دادهٔ بازار، سیگنال‌ها و تحلیل هوش مصنوعی — توصیهٔ مالی نیست.'
    }
  },

  footer: {
    tagline: {
      en: 'The intelligent financial super app for onchain markets. Non-custodial by design.',
      fa: 'اپلیکیشن مالی هوشمند برای بازارهای روی‌زنجیره. از بِنیاد غیرامانی.'
    },
    columns: [
      {
        t: { en: 'Product', fa: 'محصول' },
        links: [
          { href: '/#/swap', en: 'Swap', fa: 'سواپ' },
          { href: '/#/wallet', en: 'Wallet', fa: 'کیف پول' },
          { href: '/#/portfolio', en: 'Portfolio', fa: 'پورتفوی' },
          { href: '/#/orders', en: 'Orders & Alerts', fa: 'سفارش‌ها و هشدارها' },
          { href: '/#/farm', en: 'Farms', fa: 'فارم‌ها' },
          { href: '/#/buy', en: 'Buy with Fiat', fa: 'خرید با فیات' }
        ]
      },
      {
        t: { en: 'Intelligence', fa: 'هوش مالی' },
        links: [
          { href: '/#/signals', en: 'AI Signals', fa: 'سیگنال‌های هوشمند' },
          { href: '/#/solana', en: 'Solana Hub', fa: 'هاب سولانا' },
          { href: '/#/smart-money', en: 'Smart Money', fa: 'پول هوشمند' },
          { href: '/#/', en: 'Market', fa: 'بازار' },
          { href: '/#/discover', en: 'Discover', fa: 'کشف بازار' },
          { href: '/#/news', en: 'News', fa: 'اخبار' }
        ]
      },
      {
        t: { en: 'Ecosystem', fa: 'اکوسیستم' },
        links: [
          { href: '/#/ecosystem', en: 'Ecosystem', fa: 'اکوسیستم' },
          { href: '/#/stocks', en: 'Stocks', fa: 'سهام' },
          { href: '/#/explore-hub', en: 'Explore Hub', fa: 'هاب کاوش' },
          { href: '/#/earn', en: 'Earn', fa: 'درآمد' },
          { href: '/#/loan', en: 'Lending', fa: 'وام‌دهی' },
          { href: '/#/rewards', en: 'Rewards', fa: 'پاداش‌ها' }
        ]
      },
      {
        t: { en: 'Resources', fa: 'منابع' },
        links: [
          { href: '/#/security', en: 'Security', fa: 'امنیت' },
          { href: '/#/docs', en: 'Docs', fa: 'مستندات' },
          { href: '/#/help', en: 'Help', fa: 'راهنما' },
          { href: '/#/learn', en: 'Learn', fa: 'آموزش' },
          { href: '/#/developers', en: 'Developers', fa: 'توسعه‌دهندگان' },
          { href: '/#/about', en: 'About', fa: 'دربارهٔ ما' }
        ]
      },
      {
        t: { en: 'Guides', fa: 'راهنماها' },
        links: [
          { href: '/non-custodial-crypto-swap', en: 'Non-Custodial Swap Guide', fa: 'راهنمای سواپ غیرامانی' },
          { href: '/هشدار-قیمت-ارز-دیجیتال', en: 'Price Alerts Guide (Persian)', fa: 'راهنمای هشدار قیمت' },
          { href: '/تحلیل-تکنیکال-ارز-دیجیتال', en: 'Technical Analysis Guide (Persian)', fa: 'راهنمای تحلیل تکنیکال' },
          { href: '/کیف-پول-غیرامانی', en: 'Wallet Security Guide (Persian)', fa: 'راهنمای امنیت کیف پول' }
        ]
      },
      {
        t: { en: 'Legal & Trust', fa: 'حقوقی و اعتماد' },
        links: [
          { href: '/#/legal/privacy', en: 'Privacy Policy', fa: 'حریم خصوصی' },
          { href: '/#/legal/terms', en: 'Terms of Service', fa: 'شرایط استفاده' },
          { href: '/#/business', en: 'Business', fa: 'همکاری تجاری' },
          { href: '/#/contact', en: 'Contact', fa: 'تماس با ما' }
        ]
      }
    ],
    company: { en: 'Fanous Bazaar Pishgam Co., Isfahan, Iran', fa: 'شرکت فانوس بازار پیشگام، اصفهان، ایران' },
    contact: { en: 'Contact', fa: 'تماس' },
    copyright: { en: 'FBT Swap. All rights reserved.', fa: 'اف‌بی‌تی سواپ. کلیهٔ حقوق محفوظ است.' }
  }
};
