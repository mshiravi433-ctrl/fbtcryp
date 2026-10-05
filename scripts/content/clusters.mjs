/**
 * TOPICAL AUTHORITY — the cluster map.
 * ---------------------------------------------------------------------------
 * Topical authority is not "many pages about crypto". It is a finite subject
 * area covered END TO END, with one page per real question, a hub that owns
 * the subject, and internal links that make the relationship explicit. A
 * hundred unconnected articles is a content farm; a hundred articles arranged
 * as ten complete clusters is a reference work.
 *
 * Each cluster below:
 *   • owns ONE subject this product genuinely does,
 *   • has a hub page (the pillar) that links to every spoke,
 *   • receives a link back from each spoke, and
 *   • names its sibling clusters so the graph is connected, not a star.
 *
 * THE RULE THAT KEEPS IT HONEST: a cluster may only exist if the app really
 * does the thing. There is no "crypto tax" cluster because the app has no tax
 * feature, and no "price prediction" cluster because the app refuses to
 * predict. Covering a subject you do not serve is how a site earns a
 * helpful-content demotion instead of authority.
 */

export const CLUSTERS = [
  {
    id: 'swap',
    icon: 'swap',
    topic: 'swap',
    route: '/#/swap',
    en: {
      slug: 'guides/crypto-swap-and-routing',
      label: 'Swap & routing',
      title: 'Crypto Swap and DEX Routing Guides | FBT Swap',
      h1: 'How a crypto swap is actually routed',
      description:
        'Every part of a decentralised swap explained: quotes, routing across pools, slippage, price impact, approvals, failed transactions and what you sign.',
      intro: [
        'A swap looks like one button. Underneath it is a quote request, a route chosen across several liquidity pools, a token approval, a signature in your own wallet and a transaction that either lands or reverts. Each of those steps can cost you money if you do not know what it does.',
        'This hub covers that chain of events end to end. Every page states what FBT Swap does, what the network does, and what neither can do — a swap that fails, a quote that moves, or a token that cannot be sold are all real outcomes, and a guide that hides them is useless at the moment you need it.'
      ]
    },
    fa: {
      slug: 'fa/guides/crypto-swap-and-routing',
      label: 'سواپ و مسیریابی',
      title: 'راهنمای سواپ ارز دیجیتال و مسیریابی صرافی غیرمتمرکز | FBT Swap',
      h1: 'سواپ ارز دیجیتال واقعاً چطور مسیریابی می‌شود',
      description:
        'هر بخش سواپ غیرمتمرکز: نرخ‌گیری، مسیریابی بین استخرها، لغزش قیمت، اثر قیمتی، مجوز توکن، تراکنش ناموفق و چیزی که امضا می‌کنی.',
      intro: [
        'سواپ از بیرون یک دکمه است. زیر آن یک درخواست نرخ، انتخاب مسیر بین چند استخر نقدینگی، مجوز توکن، امضا در کیف پول خودت و تراکنشی است که یا ثبت می‌شود یا برمی‌گردد. هر کدام از این گام‌ها اگر ندانی چه می‌کند می‌تواند برایت هزینه بسازد.',
        'این مرکز راهنما همین زنجیره را از ابتدا تا انتها توضیح می‌دهد. هر صفحه می‌گوید اف‌بی‌تی سواپ چه می‌کند، شبکه چه می‌کند و هیچ‌کدام چه کاری نمی‌توانند بکنند — تراکنش ناموفق، نرخی که جابه‌جا می‌شود و توکنی که قابل فروش نیست، هر سه واقعی‌اند و راهنمایی که پنهانشان کند دقیقاً در لحظهٔ نیاز بی‌فایده است.'
      ]
    }
  },
  {
    id: 'fees',
    icon: 'receipt',
    topic: 'swap',
    route: '/#/swap',
    en: {
      slug: 'guides/crypto-fees-and-gas',
      label: 'Fees & gas',
      title: 'Crypto Fees and Gas Explained — Every Cost in a Swap | FBT Swap',
      h1: 'Every cost in a crypto transaction',
      description:
        'Network gas, pool fees, the platform fee, bridge costs and MEV. What each one is, who receives it, and how to read it in the quote before you sign.',
      intro: [
        'There is no single "fee" in a crypto transaction. There is gas paid to the network, a liquidity-provider fee baked into the pool price, a platform fee if the interface charges one, and sometimes a loss to transaction ordering that never appears on any invoice.',
        'These pages separate those costs so you can name each one. FBT Swap charges 0.70% of the input amount on supported swap routes and shows it in the quote before you sign; network gas is separate and is paid to the chain, never to us.'
      ]
    },
    fa: {
      slug: 'fa/guides/crypto-fees-and-gas',
      label: 'کارمزد و گس',
      title: 'کارمزد ارز دیجیتال و گس شبکه؛ همهٔ هزینه‌های یک سواپ | FBT Swap',
      h1: 'همهٔ هزینه‌های یک تراکنش ارز دیجیتال',
      description:
        'گس شبکه، کارمزد استخر، کارمزد پلتفرم، هزینهٔ پل و ام‌ای‌وی. هرکدام چیست، به چه کسی می‌رسد و چطور پیش از امضا در نرخ دیده می‌شود.',
      intro: [
        'در یک تراکنش کریپتو یک «کارمزد» واحد وجود ندارد. گسی هست که به شبکه می‌رسد، کارمزد تأمین‌کنندهٔ نقدینگی که داخل قیمت استخر پنهان است، کارمزد پلتفرم اگر رابط کاربری آن را بگیرد، و گاهی زیانی از ترتیب تراکنش‌ها که در هیچ صورت‌حسابی نوشته نمی‌شود.',
        'این صفحه‌ها این هزینه‌ها را از هم جدا می‌کنند تا بتوانی هرکدام را نام ببری. اف‌بی‌تی سواپ ۰٫۷۰٪ از مبلغ ورودی را روی مسیرهای پشتیبانی‌شده می‌گیرد و پیش از امضا در نرخ نشان می‌دهد؛ گس شبکه جداست و به خودِ شبکه پرداخت می‌شود، نه به ما.'
      ]
    }
  },
  {
    id: 'wallets',
    icon: 'wallet',
    topic: 'swap',
    route: '/#/wallet',
    en: {
      slug: 'guides/crypto-wallets-and-custody',
      label: 'Wallets & custody',
      title: 'Crypto Wallets, Keys and Custody Guides | FBT Swap',
      h1: 'Wallets, keys and who really controls your coins',
      description:
        'Seed phrases, hardware wallets, WalletConnect, smart accounts, approvals and recovery. What custody means in practice and what nobody can undo.',
      intro: [
        'Custody is the only question in crypto with a binary answer: either you hold the key that moves the asset, or somebody else does. Everything else — the interface, the brand, the support channel — is decoration on top of that single fact.',
        'This hub covers what a key is, where it can live, how a connection to a site works, and which mistakes are permanent. FBT Swap is non-custodial: it never takes a deposit, never stores a recovery phrase and never signs for you, which also means it can never reverse a transaction you signed.'
      ]
    },
    fa: {
      slug: 'fa/guides/crypto-wallets-and-custody',
      label: 'کیف پول و کلید',
      title: 'راهنمای کیف پول ارز دیجیتال، کلید خصوصی و امانت‌داری | FBT Swap',
      h1: 'کیف پول، کلید و اینکه واقعاً چه کسی دارایی را کنترل می‌کند',
      description:
        'عبارت بازیابی، کیف پول سخت‌افزاری، WalletConnect، حساب هوشمند، مجوزها و بازیابی. امانت‌داری در عمل یعنی چه و چه چیزی برگشت‌ناپذیر است.',
      intro: [
        'امانت‌داری تنها پرسش کریپتو است که پاسخ دوحالته دارد: یا کلیدی که دارایی را جابه‌جا می‌کند دست خودت است، یا دست یکی دیگر. باقی چیزها — ظاهر برنامه، نام برند، کانال پشتیبانی — تزئین روی همین یک واقعیت‌اند.',
        'این مرکز راهنما توضیح می‌دهد کلید چیست، کجا می‌تواند نگهداری شود، اتصال به یک سایت چطور کار می‌کند و کدام اشتباه‌ها دائمی‌اند. اف‌بی‌تی سواپ غیرامانی است: نه سپرده می‌گیرد، نه عبارت بازیابی ذخیره می‌کند و نه به‌جای تو امضا می‌کند — و همین یعنی نمی‌تواند تراکنشی را که امضا کرده‌ای برگرداند.'
      ]
    }
  },
  {
    id: 'security',
    icon: 'shield',
    topic: 'swap',
    route: '/#/security',
    en: {
      slug: 'guides/crypto-security-and-scams',
      label: 'Security & scams',
      title: 'Crypto Security and Scam Defence Guides | FBT Swap',
      h1: 'How crypto money is actually stolen',
      description:
        'Approval drainers, fake tokens, address poisoning, phishing clones, honeypots and support impersonation. The real attacks, and the checks that stop them.',
      intro: [
        'Almost nobody loses crypto to a broken cryptographic primitive. They lose it to a signature they did not read, a token contract they did not check, an address they copied from the wrong place, or a person who claimed to be support.',
        'Every page in this hub describes one real attack, shows what it looks like on screen, and gives the check that defeats it. FBT Swap will never ask for your recovery phrase, never message you first, and cannot recover funds sent to the wrong address — so the defence has to happen before you sign.'
      ]
    },
    fa: {
      slug: 'fa/guides/crypto-security-and-scams',
      label: 'امنیت و کلاهبرداری',
      title: 'راهنمای امنیت ارز دیجیتال و شناخت کلاهبرداری | FBT Swap',
      h1: 'پول کریپتو واقعاً چطور دزدیده می‌شود',
      description:
        'مجوز مخرب، توکن تقلبی، مسموم‌سازی آدرس، سایت جعلی، هانی‌پات و جعل هویت پشتیبانی. حمله‌های واقعی و بررسی‌هایی که جلویشان را می‌گیرد.',
      intro: [
        'تقریباً هیچ‌کس دارایی‌اش را به‌خاطر شکستن رمزنگاری از دست نمی‌دهد. مردم به‌خاطر امضایی که نخوانده‌اند، قرارداد توکنی که بررسی نکرده‌اند، آدرسی که از جای اشتباه کپی شده یا کسی که خودش را پشتیبانی جا زده پولشان را می‌بازند.',
        'هر صفحهٔ این مرکز یک حملهٔ واقعی را توضیح می‌دهد، نشان می‌دهد روی صفحه چه شکلی است و بررسی‌ای را می‌دهد که جلویش را می‌گیرد. اف‌بی‌تی سواپ هرگز عبارت بازیابی نمی‌خواهد، هرگز اول پیام نمی‌دهد و نمی‌تواند دارایی ارسال‌شده به آدرس اشتباه را برگرداند؛ پس دفاع باید پیش از امضا اتفاق بیفتد.'
      ]
    }
  },
  {
    id: 'networks',
    icon: 'network',
    topic: 'market',
    route: '/#/swap',
    en: {
      slug: 'guides/blockchain-networks-and-bridging',
      label: 'Networks & bridging',
      title: 'Blockchain Networks, Layer 2s and Bridging Guides | FBT Swap',
      h1: 'Networks, rollups and moving between them',
      description:
        'What a layer 2 actually is, why the same token has a different address on every chain, how bridges work and how to avoid sending to the wrong network.',
      intro: [
        'A token symbol is not an address and a chain is not a brand. USDT on Ethereum and USDT on Polygon are different contracts with different liquidity, and sending one to a wallet expecting the other is the most common irreversible mistake in crypto.',
        'This hub explains what each supported network is for, how rollups inherit security, what a bridge really does to your tokens, and which checks to run before you press send. FBT Swap supports 17 networks and shows the selected one before every signature.'
      ]
    },
    fa: {
      slug: 'fa/guides/blockchain-networks-and-bridging',
      label: 'شبکه‌ها و پل',
      title: 'راهنمای شبکه‌های بلاکچین، لایه ۲ و پل بین زنجیره‌ای | FBT Swap',
      h1: 'شبکه‌ها، رول‌آپ‌ها و جابه‌جایی بین آن‌ها',
      description:
        'لایه ۲ واقعاً چیست، چرا یک توکن روی هر زنجیره آدرس متفاوتی دارد، پل‌ها چطور کار می‌کنند و چطور به شبکهٔ اشتباه نفرستی.',
      intro: [
        'نماد توکن با آدرس قرارداد یکی نیست و زنجیره یک برند نیست. USDT روی اتریوم و USDT روی پالیگان دو قرارداد جدا با نقدینگی جدا هستند و فرستادن یکی به کیف پولی که منتظر دیگری است، رایج‌ترین اشتباه برگشت‌ناپذیر کریپتو است.',
        'این مرکز توضیح می‌دهد هر شبکهٔ پشتیبانی‌شده به چه درد می‌خورد، رول‌آپ‌ها امنیت را از کجا می‌گیرند، پل واقعاً با توکن تو چه می‌کند و پیش از زدن دکمهٔ ارسال چه چیزهایی را باید بررسی کنی. اف‌بی‌تی سواپ از ۱۷ شبکه پشتیبانی می‌کند و شبکهٔ انتخاب‌شده را پیش از هر امضا نشان می‌دهد.'
      ]
    }
  },
  {
    id: 'defi',
    icon: 'leaf',
    topic: 'invest',
    route: '/#/earn',
    en: {
      slug: 'guides/defi-yield-and-lending',
      label: 'Yield & lending',
      title: 'DeFi Yield, Lending and Liquidity Guides | FBT Swap',
      h1: 'Where DeFi yield comes from — and what it costs',
      description:
        'Lending rates, liquidity provision, impermanent loss, liquidation, staking derivatives and APY versus APR. Honest mechanics, no promised returns.',
      intro: [
        'Yield in DeFi is always somebody paying for something: a borrower paying interest, a trader paying a pool fee, a protocol paying out its own token, or a validator being rewarded for securing a chain. If you cannot name the payer, you cannot judge the risk.',
        'These pages trace each source back to its payer and name the way it can fail — liquidation, impermanent loss, a depeg, a smart-contract bug, or an incentive that simply stops. No page here promises a return and no figure shown in the app is guaranteed.'
      ]
    },
    fa: {
      slug: 'fa/guides/defi-yield-and-lending',
      label: 'سود و وام دیفای',
      title: 'راهنمای سود دیفای، وام و نقدینگی | FBT Swap',
      h1: 'سود دیفای از کجا می‌آید و چه هزینه‌ای دارد',
      description:
        'نرخ وام، تأمین نقدینگی، ضرر ناپایدار، لیکویید شدن، مشتقات استیکینگ و تفاوت APY با APR. مکانیزم صادقانه، بدون وعدهٔ سود.',
      intro: [
        'سود در دیفای همیشه یعنی کسی دارد بابت چیزی پول می‌دهد: وام‌گیرنده‌ای که بهره می‌پردازد، معامله‌گری که کارمزد استخر می‌دهد، پروتکلی که توکن خودش را پخش می‌کند، یا اعتبارسنجی که بابت تأمین امنیت زنجیره پاداش می‌گیرد. اگر نتوانی پرداخت‌کننده را نام ببری، نمی‌توانی ریسک را بسنجی.',
        'این صفحه‌ها هر منبع سود را تا پرداخت‌کننده‌اش دنبال می‌کنند و می‌گویند از چه راهی می‌تواند شکست بخورد: لیکویید شدن، ضرر ناپایدار، از دست رفتن تثبیت قیمت، باگ قرارداد هوشمند، یا مشوقی که ساده بند می‌آید. هیچ صفحه‌ای این‌جا سود وعده نمی‌دهد و هیچ عددی در برنامه تضمین‌شده نیست.'
      ]
    }
  },
  {
    id: 'markets',
    icon: 'chart',
    topic: 'market',
    route: '/#/signals',
    en: {
      slug: 'guides/crypto-market-data',
      label: 'Markets & data',
      title: 'Crypto Market Data, Charts and Indicator Guides | FBT Swap',
      h1: 'Reading crypto market data without fooling yourself',
      description:
        'Candles, volume, liquidity depth, RSI, MACD, funding rates and on-chain flow. What each measurement says about the past and never about the future.',
      intro: [
        'Market data describes what already happened. An indicator is a function of past prices, and no arrangement of past prices is a promise about the next one. That sounds obvious until a chart tool presents a reading as a signal.',
        'Each page here explains one measurement: how it is calculated, what it is genuinely useful for, and the specific way it misleads people. FBT Swap shows these readings with their window and their source, and shows an unavailable state rather than an invented number when the source is down.'
      ]
    },
    fa: {
      slug: 'fa/guides/crypto-market-data',
      label: 'بازار و تحلیل داده',
      title: 'راهنمای دادهٔ بازار کریپتو، نمودار و اندیکاتورها | FBT Swap',
      h1: 'خواندن دادهٔ بازار بدون فریب دادن خودت',
      description:
        'کندل، حجم، عمق نقدینگی، RSI، MACD، نرخ فاندینگ و جریان آن‌چین. هر اندازه‌گیری دربارهٔ گذشته چه می‌گوید و دربارهٔ آینده هیچ.',
      intro: [
        'دادهٔ بازار آنچه را که قبلاً رخ داده توصیف می‌کند. اندیکاتور تابعی از قیمت‌های گذشته است و هیچ چیدمانی از قیمت گذشته وعدهٔ قیمت بعدی نیست. این بدیهی به نظر می‌رسد تا وقتی یک ابزار نموداری همان عدد را به‌عنوان «سیگنال» نشان بدهد.',
        'هر صفحه این‌جا یک اندازه‌گیری را توضیح می‌دهد: چطور محاسبه می‌شود، واقعاً به چه درد می‌خورد و دقیقاً از چه راهی آدم را گمراه می‌کند. اف‌بی‌تی سواپ این خوانش‌ها را همراه با بازه و منبعشان نشان می‌دهد و وقتی منبع در دسترس نیست، به‌جای ساختن عدد، حالت «در دسترس نیست» را نمایش می‌دهد.'
      ]
    }
  },
  {
    id: 'solana',
    icon: 'solana',
    topic: 'swap',
    route: '/#/solana',
    en: {
      slug: 'guides/solana',
      label: 'Solana',
      title: 'Solana Swap, SPL Tokens and Account Guides | FBT Swap',
      h1: 'Solana without the surprises',
      description:
        'Token accounts, rent, priority fees, SPL versus Token-2022, transfer hooks, slippage on Jupiter routes and why a Solana transaction expires.',
      intro: [
        'Solana does not behave like an EVM chain and the differences cost real money. You pay rent to open a token account, transactions expire after a short blockhash window, fees are split between a base lamport cost and a priority bid, and a Token-2022 mint can carry a transfer fee or a hook the sender never sees.',
        'These pages cover the mechanics that actually bite. FBT Swap routes Solana swaps through public aggregators and shows the quote, the route and the fee before your wallet is asked to sign.'
      ]
    },
    fa: {
      slug: 'fa/guides/solana',
      label: 'سولانا',
      title: 'راهنمای سواپ سولانا، توکن‌های SPL و حساب‌ها | FBT Swap',
      h1: 'سولانا بدون سورپرایز',
      description:
        'حساب توکن، اجاره، کارمزد اولویت، تفاوت SPL و Token-2022، هوک انتقال، لغزش در مسیر Jupiter و دلیل منقضی‌شدن تراکنش سولانا.',
      intro: [
        'سولانا مثل زنجیره‌های EVM رفتار نمی‌کند و همین تفاوت‌ها هزینهٔ واقعی دارند. برای باز کردن حساب توکن اجاره می‌دهی، تراکنش بعد از یک پنجرهٔ کوتاه بلاک‌هش منقضی می‌شود، کارمزد بین هزینهٔ پایه و پیشنهاد اولویت تقسیم است و یک مینت Token-2022 می‌تواند کارمزد انتقال یا هوکی داشته باشد که فرستنده اصلاً نمی‌بیند.',
        'این صفحه‌ها همان مکانیزم‌هایی را پوشش می‌دهند که واقعاً گاز می‌گیرند. اف‌بی‌تی سواپ سواپ سولانا را از مسیر تجمیع‌کننده‌های عمومی می‌گیرد و نرخ، مسیر و کارمزد را پیش از درخواست امضا از کیف پول نشان می‌دهد.'
      ]
    }
  },
  {
    id: 'ai',
    icon: 'chat',
    topic: 'invest',
    route: '/#/intent',
    en: {
      slug: 'guides/ai-and-automation',
      label: 'AI & automation',
      title: 'AI Intent, Alerts and Crypto Automation Guides | FBT Swap',
      h1: 'What an AI assistant can and cannot do with your wallet',
      description:
        'Intent-based trading, price monitors, conditional orders, recurring buys and agent safety. Where automation stops and your signature starts.',
      intro: [
        'An assistant that can move your money needs either custody of your funds or a standing allowance over them. FBT Swap takes neither, which fixes the boundary: the AI can read, plan, quote, monitor and prepare — and you sign.',
        'These pages describe exactly which steps are automated, which require a human signature, what a monitor can and cannot deliver, and how to evaluate any agent that claims to trade for you. An automation that silently fails to fire is worse than no automation, so each limit is stated where the feature is described.'
      ]
    },
    fa: {
      slug: 'fa/guides/ai-and-automation',
      label: 'هوش مصنوعی و خودکارسازی',
      title: 'راهنمای هوش مصنوعی، هشدار و خودکارسازی کریپتو | FBT Swap',
      h1: 'دستیار هوش مصنوعی با کیف پول تو چه می‌تواند بکند و چه نمی‌تواند',
      description:
        'معاملهٔ مبتنی بر قصد، پایش قیمت، سفارش شرطی، خرید پله‌ای و ایمنی عامل هوشمند. خودکارسازی کجا تمام می‌شود و امضای تو کجا شروع.',
      intro: [
        'دستیاری که بتواند پول تو را جابه‌جا کند یا باید دارایی را نگه دارد یا مجوز برداشت دائمی داشته باشد. اف‌بی‌تی سواپ هیچ‌کدام را نمی‌گیرد و همین مرز را روشن می‌کند: هوش مصنوعی می‌خواند، نقشه می‌کشد، نرخ می‌گیرد، پایش می‌کند و آماده می‌کند — و امضا با توست.',
        'این صفحه‌ها دقیقاً می‌گویند کدام گام خودکار است، کدام امضای انسان می‌خواهد، یک پایشگر چه چیزی را می‌تواند و چه چیزی را نمی‌تواند برساند، و هر عاملی که ادعا می‌کند به‌جای تو معامله می‌کند را چطور بسنجی. خودکارسازی‌ای که بی‌صدا عمل نکند از نبودنش بدتر است؛ پس هر محدودیت کنار همان قابلیت نوشته شده.'
      ]
    }
  },
  {
    id: 'tokenized',
    icon: 'globe',
    topic: 'invest',
    route: '/#/stocks',
    en: {
      slug: 'guides/tokenized-assets',
      label: 'Tokenised assets',
      title: 'Tokenised Stocks, Gold and Real-World Asset Guides | FBT Swap',
      h1: 'Tokenised stocks and real-world assets, honestly',
      description:
        'What a tokenised share actually gives you, who the issuer is, what happens at a corporate action, and why liquidity and redemption are the real risks.',
      intro: [
        'A tokenised stock is not a share. It is a token whose value is meant to track a share, issued by a company that holds (or claims to hold) the underlying. The difference shows up exactly when it matters: dividends, voting, a split, a delisting, or the issuer failing.',
        'These pages describe the structure rather than the marketing. Access, issuer risk, liquidity depth, trading hours and redemption rights are each covered — and where FBT Swap simply routes to a public market, the page says so instead of implying a brokerage relationship that does not exist.'
      ]
    },
    fa: {
      slug: 'fa/guides/tokenized-assets',
      label: 'دارایی توکنی‌شده',
      title: 'راهنمای سهام توکنی‌شده، طلا و دارایی‌های دنیای واقعی | FBT Swap',
      h1: 'سهام توکنی‌شده و دارایی واقعی، بدون تعارف',
      description:
        'سهم توکنی‌شده واقعاً چه چیزی به تو می‌دهد، ناشر کیست، در رویداد شرکتی چه می‌شود و چرا نقدشوندگی و بازخرید ریسک اصلی‌اند.',
      intro: [
        'سهام توکنی‌شده، سهم نیست. توکنی است که قرار است ارزشش قیمت یک سهم را دنبال کند و شرکتی آن را منتشر کرده که دارایی پایه را نگه می‌دارد — یا ادعا می‌کند نگه می‌دارد. تفاوت دقیقاً همان‌جا خودش را نشان می‌دهد که مهم است: سود نقدی، حق رأی، تقسیم سهم، حذف از بورس، یا ورشکستگی ناشر.',
        'این صفحه‌ها ساختار را توضیح می‌دهند، نه تبلیغ را. دسترسی، ریسک ناشر، عمق نقدینگی، ساعت معامله و حق بازخرید هرکدام پوشش داده شده‌اند؛ و جایی که اف‌بی‌تی سواپ فقط به یک بازار عمومی مسیر می‌دهد، صفحه همین را می‌نویسد به‌جای اینکه رابطهٔ کارگزاری‌ای را القا کند که وجود ندارد.'
      ]
    }
  },
  {
    /*
     * The one cluster whose spokes are generated rather than written by hand:
     * there is exactly one page per network in src/lib/chains.js, and the
     * facts on each come from that registry. See networks.mjs for why that is
     * a feature and not a shortcut.
     */
    id: 'chains',
    icon: 'network',
    topic: 'networks',
    route: '/#/swap',
    en: {
      slug: 'networks',
      label: 'Supported networks',
      title: 'Supported Networks — Swap on 17 Chains | FBT Swap',
      h1: 'Every network FBT Swap supports',
      description:
        'One page per supported network: chain ID, native gas token, block explorer, the DEX liquidity is routed through, and what changes when you switch.',
      intro: [
        'FBT Swap routes swaps on seventeen networks. They are not interchangeable. Each one has its own gas token, its own fee behaviour, its own block explorer and its own set of liquidity venues — and the single most expensive mistake in crypto is sending an asset to an address on the wrong one.',
        'Each page below states the facts a wallet actually needs: the chain ID your wallet will show, the token that pays for gas, where to verify a transaction afterwards, and the honest caveats. The platform fee is 0.70% of the input on every one of them, and the selected network is displayed before every signature.'
      ]
    },
    fa: {
      slug: 'fa/networks',
      label: 'شبکه‌های پشتیبانی‌شده',
      title: 'شبکه‌های پشتیبانی‌شده — سواپ روی ۱۷ شبکه | FBT Swap',
      h1: 'هر شبکه‌ای که اف‌بی‌تی سواپ پشتیبانی می‌کند',
      description:
        'برای هر شبکه یک صفحه: شناسهٔ زنجیره، توکن کارمزد، کاوشگر بلاک، صرافی غیرمتمرکزی که نقدینگی از آن می‌آید و آنچه با تعویض شبکه تغییر می‌کند.',
      intro: [
        'اف‌بی‌تی سواپ روی هفده شبکه مسیریابی می‌کند و این شبکه‌ها جایگزین هم نیستند. هرکدام توکن کارمزد خودش، رفتار هزینه‌ای خودش، کاوشگر بلاک خودش و مجموعهٔ استخرهای خودش را دارد؛ و گران‌ترین اشتباه رایج در کریپتو، فرستادن دارایی به آدرسی روی شبکهٔ اشتباه است.',
        'هر صفحهٔ زیر همان چیزهایی را می‌گوید که کیف پول واقعاً به آن نیاز دارد: شناسهٔ زنجیره‌ای که کیف پول نشان می‌دهد، توکنی که کارمزد را می‌پردازد، جایی که بعداً تراکنش را تأیید کنی، و هشدارهای صادقانه. کارمزد پلتفرم روی همهٔ آن‌ها ۰٫۷۰ درصد از مقدار ورودی است و پیش از هر امضا شبکهٔ انتخاب‌شده نمایش داده می‌شود.'
      ]
    }
  },
  {
    /*
     * E-E-A-T is not a meta tag. For a finance site it is: say who operates
     * this, say how it makes money, say what it cannot do, and make all three
     * easy to find and hard to misread. These pages exist to be checked, by a
     * cautious user and by a quality rater alike.
     */
    id: 'trust',
    icon: 'shield',
    topic: 'security',
    route: '/#/swap',
    en: {
      slug: 'trust',
      label: 'Trust & transparency',
      title: 'Trust and Transparency — Who Runs FBT Swap | FBT Swap',
      h1: 'Who runs FBT Swap, and what it cannot do',
      description:
        'The operator, the revenue model, the security practices, the editorial rules, and an explicit list of the things this product cannot do for you.',
      intro: [
        'Most crypto sites tell you what they can do. The useful information is usually the opposite: who is behind it, how it is paid, and where its power actually ends. A non-custodial product has very specific limits, and a user who learns them after a mistake has learned them too late.',
        'These pages answer those questions directly and in one place. There is one operator, one official domain, one contact address, and one revenue line — a 0.70% platform fee on the input of a swap, displayed before you sign. Everything else below is detail on those four facts.'
      ]
    },
    fa: {
      slug: 'fa/trust',
      label: 'اعتماد و شفافیت',
      title: 'اعتماد و شفافیت — چه کسی اف‌بی‌تی سواپ را اداره می‌کند | FBT Swap',
      h1: 'چه کسی اف‌بی‌تی سواپ را اداره می‌کند و چه کاری از آن برنمی‌آید',
      description:
        'اپراتور، مدل درآمدی، شیوه‌های امنیتی، قواعد تحریریه، و فهرستی صریح از کارهایی که این محصول نمی‌تواند برایت انجام دهد.',
      intro: [
        'بیشتر سایت‌های کریپتو می‌گویند چه کاری می‌توانند بکنند. اطلاعات بهتر معمولاً نقطهٔ مقابل آن است: پشت این سرویس چه کسی است، از کجا پول درمی‌آورد و قدرتش دقیقاً کجا تمام می‌شود. یک محصول غیرحضانتی محدودیت‌های بسیار مشخصی دارد و کاربری که بعد از اشتباه با آن‌ها آشنا شود، دیر آشنا شده است.',
        'این صفحه‌ها به همین پرسش‌ها مستقیم و یکجا پاسخ می‌دهند. یک اپراتور وجود دارد، یک دامنهٔ رسمی، یک نشانی تماس و یک خط درآمد — کارمزد ۰٫۷۰ درصدی پلتفرم روی مقدار ورودی سواپ که پیش از امضا نمایش داده می‌شود. باقی مطالب زیر، جزئیات همین چهار واقعیت است.'
      ]
    }
  }
];

export const CLUSTER_BY_ID = Object.fromEntries(CLUSTERS.map((c) => [c.id, c]));

/** Hub slug for a cluster in a language. */
export const hubSlug = (clusterId, lang) =>
  CLUSTER_BY_ID[clusterId]?.[lang === 'fa' ? 'fa' : 'en']?.slug ?? null;
