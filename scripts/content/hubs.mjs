/**
 * CLUSTER HUB COPY
 * ---------------------------------------------------------------------------
 * clusters.mjs owns the identity of each cluster (slug, title, h1, lede). This
 * file owns the rest of the hub page: two more body paragraphs, a fact table
 * and two FAQ entries per hub, per language.
 *
 * Why it is separate: a hub that is only a lede plus a list of links is a
 * category page, and a category page is exactly the kind of thin index Google
 * demotes. A pillar has to be worth reading on its own — it should answer the
 * subject-level question that none of its spokes answer, and state the limits
 * that apply across the whole subject.
 *
 * Keyed by `${clusterId}.${lang}`. A missing key means no hub is emitted for
 * that language, which is how clusters with no Persian spokes (tokenized) stay
 * out of the Persian sitemap instead of shipping an empty directory.
 */

export const HUB_COPY = {
  /* ─── swap ─────────────────────────────────────────────────────────────── */
  'swap.en': {
    body: [
      'The single most useful idea in this cluster is that a swap is not one action. It is a quote, a route, an approval and a signature, and the cost of the whole thing is decided in the parts you do not see. Two people trading the same pair for the same amount on the same day can get materially different results purely from slippage settings, size relative to pool depth and which network they chose.',
      'Nothing here requires you to trust a prediction. Every number that matters — price impact, minimum received, the fee split — is computable before you sign, and the pages below show you where to read each one.'
    ],
    facts: [
      ['What decides your result', 'Route, pool depth and your size — not the headline price'],
      ['Computable before signing', 'Price impact, minimum received, every fee'],
      ['Platform fee', '0.70% of the input, shown in the quote'],
      ['Never guaranteed', 'That a transaction succeeds, or that gas is refunded']
    ],
    faqs: [
      { q: 'What is the one setting most people get wrong?', a: 'Slippage tolerance. Raising it to force a transaction through is the most expensive habit in decentralised trading, because the margin you open up is exactly what can be extracted from you.' },
      { q: 'Does an aggregator guarantee the best price?', a: 'No. It returns the best result among the routes it queried at that moment. That is a real and useful claim, and it is not the same as the best price available anywhere.' }
    ]
  },
  'swap.fa': {
    body: [
      'مهم‌ترین نکتهٔ این مجموعه این است که سواپ یک کار واحد نیست. یک مظنه، یک مسیر، یک مجوز و یک امضاست و هزینهٔ واقعی آن در بخش‌هایی تعیین می‌شود که دیده نمی‌شوند. دو نفر که همان جفت را با همان مبلغ و در همان روز معامله می‌کنند، می‌توانند نتایج کاملاً متفاوتی بگیرند، فقط به دلیل تنظیم لغزش، نسبت حجم به عمق استخر و انتخاب شبکه.',
      'هیچ‌چیز در این صفحات به پیش‌بینی وابسته نیست. هر عددی که اهمیت دارد — تأثیر قیمتی، حداقل دریافتی و تفکیک کارمزدها — پیش از امضا قابل محاسبه است و این راهنماها نشان می‌دهند هرکدام را کجا بخوانید.'
    ],
    facts: [
      ['تعیین‌کنندهٔ نتیجه', 'مسیر، عمق استخر و حجم شما، نه قیمت اعلام‌شده'],
      ['قابل محاسبه پیش از امضا', 'تأثیر قیمتی، حداقل دریافتی و همهٔ کارمزدها'],
      ['کارمزد پلتفرم', '۰٫۷۰ درصد مبلغ ورودی، نمایش در مظنه'],
      ['هرگز تضمین نمی‌شود', 'موفقیت تراکنش یا بازگشت گس']
    ],
    faqs: [
      { q: 'کدام تنظیم را بیشتر از همه اشتباه می‌کنند؟', a: 'تحمل لغزش. بالا بردن آن برای اینکه تراکنش حتماً اجرا شود، پرهزینه‌ترین عادت در معاملهٔ غیرمتمرکز است، چون همان حاشیه‌ای که باز می‌کنید دقیقاً همان چیزی است که قابل برداشت می‌شود.' },
      { q: 'آیا تجمیع‌کننده بهترین قیمت را تضمین می‌کند؟', a: 'خیر. بهترین نتیجه را در میان مسیرهایی که در آن لحظه بررسی کرده برمی‌گرداند. این ادعای واقعی و مفیدی است و با بهترین قیمت موجود در کل بازار یکی نیست.' }
    ]
  },

  /* ─── fees ─────────────────────────────────────────────────────────────── */
  'fees.en': {
    body: [
      'Crypto costs are confusing because they are charged by different parties at different moments and only one of them is labelled as a fee. Network gas goes to validators or is burned. The pool fee goes to liquidity providers and is already inside the price you were quoted. The platform fee goes to the interface. And transaction ordering can take a slice that never appears anywhere at all.',
      'Once you can name each component you can also see which ones you can actually change. Network choice moves the biggest number by an order of magnitude; almost everything else is noise by comparison.'
    ],
    facts: [
      ['Network gas', 'Paid to validators or burned — never to the interface'],
      ['Pool fee', 'Paid to liquidity providers, already inside the quote'],
      ['Platform fee', '0.70% of the input on supported routes'],
      ['Biggest lever', 'Which network you trade on']
    ],
    faqs: [
      { q: 'Why is gas charged on a failed transaction?', a: 'Because gas pays for computation, not for success. Validators executed the code and reached a condition that was not satisfied, so the work was done and the resources were consumed.' },
      { q: 'What is the cheapest way to reduce costs?', a: 'Changing network. The difference between Ethereum mainnet and a low-cost chain is often tens of times the size of any saving available from settings or timing.' }
    ]
  },
  'fees.fa': {
    body: [
      'هزینه‌ها در این فضا گیج‌کننده‌اند چون توسط طرف‌های مختلف و در لحظات مختلف دریافت می‌شوند و فقط یکی از آن‌ها برچسب کارمزد دارد. گس شبکه به اعتبارسنج‌ها می‌رسد یا سوزانده می‌شود. کارمزد استخر به تأمین‌کنندگان نقدینگی می‌رسد و از قبل داخل قیمتی است که به شما نشان داده شده. کارمزد پلتفرم سهم رابط کاربری است و ترتیب تراکنش‌ها هم می‌تواند سهمی بردارد که در هیچ صورتحسابی نمی‌آید.',
      'وقتی بتوانید هر جزء را نام ببرید، می‌بینید کدام‌یک واقعاً در کنترل شماست. انتخاب شبکه بزرگ‌ترین عدد را چند برابر تغییر می‌دهد و بقیهٔ عوامل در مقایسه با آن کم‌اثرند.'
    ],
    facts: [
      ['گس شبکه', 'به اعتبارسنج‌ها یا سوزانده می‌شود، نه به پلتفرم'],
      ['کارمزد استخر', 'به تأمین‌کنندگان نقدینگی، از قبل داخل مظنه'],
      ['کارمزد پلتفرم', '۰٫۷۰ درصد مبلغ ورودی در مسیرهای پشتیبانی‌شده'],
      ['بزرگ‌ترین اهرم', 'انتخاب شبکه‌ای که روی آن معامله می‌کنید']
    ],
    faqs: [
      { q: 'چرا برای تراکنش ناموفق هم گس گرفته می‌شود؟', a: 'چون گس بهای محاسبه است نه بهای موفقیت. اعتبارسنج کد را اجرا کرده و به شرطی رسیده که برقرار نبوده، پس کار انجام شده و منابع مصرف شده است.' },
      { q: 'ارزان‌ترین راه کاهش هزینه چیست؟', a: 'تغییر شبکه. اختلاف میان شبکهٔ اصلی اتریوم و یک شبکهٔ کم‌هزینه معمولاً ده‌ها برابر هر صرفه‌جویی است که از تنظیمات یا زمان‌بندی به دست می‌آید.' }
    ]
  },

  /* ─── wallets ──────────────────────────────────────────────────────────── */
  'wallets.en': {
    body: [
      'A wallet does not hold your coins. It holds a key that proves the coins on-chain are yours, and every property people find surprising about crypto follows from that one fact. There is no password reset because there is no account. There is no support line that can restore access because nobody else ever had the key.',
      'That is also why the threat model is unusual. The realistic risk is not someone breaking cryptography; it is you being persuaded to sign something, or losing the only copy of a phrase that cannot be reissued.'
    ],
    facts: [
      ['What a wallet stores', 'A key, not your assets'],
      ['Recovery phrase', 'Cannot be reset, reissued or recovered by anyone'],
      ['Realistic threat', 'A signature you were persuaded to give'],
      ['FBT Swap never', 'Sees, stores or asks for your recovery phrase']
    ],
    faqs: [
      { q: 'Can anyone restore my wallet if I lose the phrase?', a: 'No. The relationship between phrase and addresses is purely mathematical, and no company holds a copy. Anyone offering to recover it is running a scam.' },
      { q: 'Does a hardware wallet make me safe?', a: 'It protects the key from a compromised computer, which is a real and worthwhile protection. It does not stop you from approving a malicious transaction yourself.' }
    ]
  },
  'wallets.fa': {
    body: [
      'کیف پول دارایی شما را نگه نمی‌دارد. کلیدی را نگه می‌دارد که اثبات می‌کند دارایی روی زنجیره متعلق به شماست و هر ویژگی غافلگیرکننده‌ای که مردم در این حوزه می‌بینند از همین یک واقعیت می‌آید. بازنشانی رمز وجود ندارد چون اصلاً حسابی وجود ندارد و هیچ پشتیبانی نمی‌تواند دسترسی را بازگرداند چون هیچ‌کس دیگری هرگز کلید را نداشته است.',
      'به همین دلیل مدل تهدید هم غیرمعمول است. خطر واقعی شکستن رمزنگاری نیست؛ این است که متقاعد شوید چیزی را امضا کنید، یا تنها نسخهٔ عبارتی را از دست بدهید که دوباره صادر نمی‌شود.'
    ],
    facts: [
      ['محتوای کیف پول', 'یک کلید، نه خود دارایی'],
      ['عبارت بازیابی', 'بازنشانی، صدور مجدد و بازیابی آن ممکن نیست'],
      ['خطر واقعی', 'امضایی که متقاعد شده‌اید انجام دهید'],
      ['اف‌بی‌تی سواپ هرگز', 'عبارت بازیابی را نمی‌بیند، ذخیره نمی‌کند و نمی‌خواهد']
    ],
    faqs: [
      { q: 'اگر عبارت بازیابی را گم کنم کسی می‌تواند بازیابی کند؟', a: 'خیر. رابطهٔ میان عبارت و آدرس‌ها صرفاً ریاضی است و هیچ شرکتی نسخه‌ای از آن ندارد. هر کسی پیشنهاد بازیابی بدهد در حال کلاهبرداری است.' },
      { q: 'آیا کیف پول سخت‌افزاری مرا کاملاً امن می‌کند؟', a: 'کلید را از رایانهٔ آلوده محافظت می‌کند که محافظت واقعی و ارزشمندی است. اما جلوی تأیید یک تراکنش مخرب توسط خودتان را نمی‌گیرد.' }
    ]
  },

  /* ─── security ─────────────────────────────────────────────────────────── */
  'security.en': {
    body: [
      'Almost every large crypto loss follows the same shape: the victim signed something. Not a broken cipher, not a stolen server — an approval, a transfer, a message that looked like a login. Attacks in this space target judgement under time pressure, because that is the cheapest attack surface available.',
      'The defences that work are correspondingly behavioural. Read what you are signing. Navigate from an address you saved yourself. Assume urgency is manufactured. These cost nothing and cover more real-world loss than any tool.'
    ],
    facts: [
      ['Common factor in losses', 'The victim signed something'],
      ['Primary target', 'Judgement under time pressure, not cryptography'],
      ['Highest-value habit', 'Reading the signature request in full'],
      ['Official domain', 'fbtswap.ir only — and we never message you first']
    ],
    faqs: [
      { q: 'What single habit prevents the most loss?', a: 'Reading every signature request before approving: which token, how much, and to which address. Most drains would fail against that one habit.' },
      { q: 'Can a transaction be reversed if I am scammed?', a: 'No. Confirmed on-chain transactions are final, and a non-custodial interface has no mechanism to freeze, reverse or refund anything.' }
    ]
  },
  'security.fa': {
    body: [
      'تقریباً همهٔ زیان‌های بزرگ در این فضا یک شکل دارند: قربانی چیزی را امضا کرده است. نه رمزی شکسته شده و نه سروری هک شده — یک مجوز، یک انتقال یا پیامی که شبیه ورود به سایت به نظر می‌رسید. حملات در این حوزه قضاوت تحت فشار زمان را هدف می‌گیرند، چون ارزان‌ترین سطح حملهٔ موجود همین است.',
      'دفاع‌هایی هم که جواب می‌دهند رفتاری‌اند. آنچه را امضا می‌کنید بخوانید. از نشانی‌ای وارد شوید که خودتان ذخیره کرده‌اید. فرض کنید هر فوریتی ساختگی است. این‌ها هیچ هزینه‌ای ندارند و بیشتر از هر ابزاری جلوی زیان واقعی را می‌گیرند.'
    ],
    facts: [
      ['وجه مشترک زیان‌ها', 'قربانی چیزی را امضا کرده است'],
      ['هدف اصلی حمله', 'قضاوت تحت فشار زمان، نه رمزنگاری'],
      ['باارزش‌ترین عادت', 'خواندن کامل درخواست امضا'],
      ['دامنهٔ رسمی', 'تنها fbtswap.ir — و ما هرگز اول پیام نمی‌دهیم']
    ],
    faqs: [
      { q: 'کدام یک عادت بیشترین زیان را جلوگیری می‌کند؟', a: 'خواندن هر درخواست امضا پیش از تأیید: کدام توکن، چه مقدار و به کدام آدرس. بیشتر حملات خالی‌کنندهٔ کیف پول در برابر همین یک عادت شکست می‌خورند.' },
      { q: 'اگر کلاهبرداری شوم تراکنش قابل برگشت است؟', a: 'خیر. تراکنش تأییدشده روی زنجیره نهایی است و یک رابط غیرحضانتی هیچ سازوکاری برای توقف، بازگرداندن یا جبران آن ندارد.' }
    ]
  },

  /* ─── networks ─────────────────────────────────────────────────────────── */
  'networks.en': {
    body: [
      'Multi-chain is usually sold as more choice. In practice it is mostly more ways to be wrong: the same token exists as several different contracts, liquidity does not aggregate across chains, and an asset sent to the right address on the wrong network can be unrecoverable.',
      'The compensation is real though. Fees differ by orders of magnitude, confirmation times by seconds versus minutes, and the right network for a given trade is usually obvious once you know which questions to ask.'
    ],
    facts: [
      ['Same name, different asset', 'A token on two chains is two contracts'],
      ['Liquidity', 'Does not aggregate across networks'],
      ['Supported here', '16 EVM networks plus Solana'],
      ['Shown before every signature', 'The network you selected']
    ],
    faqs: [
      { q: 'Can I recover funds sent on the wrong network?', a: 'Sometimes. If it went to an address whose key you control on an EVM chain, add the network and the funds are there. If you do not control the key on that chain, it is final.' },
      { q: 'Which network should I use?', a: 'Usually the one your funds are already on, provided the pair has enough depth there. Bridging costs and risk normally outweigh the saving for anything but large or repeated trades.' }
    ]
  },
  'networks.fa': {
    body: [
      'چندزنجیره‌ای بودن معمولاً به‌عنوان انتخاب بیشتر معرفی می‌شود. در عمل بیشتر به معنای راه‌های بیشتر برای اشتباه کردن است: یک توکن روی چند شبکه چند قرارداد متفاوت دارد، نقدینگی میان شبکه‌ها جمع نمی‌شود و دارایی ارسال‌شده به آدرس درست روی شبکهٔ اشتباه می‌تواند غیرقابل بازیابی باشد.',
      'در مقابل، مزیت آن واقعی است. کارمزدها چند برابر با هم تفاوت دارند، زمان تأیید از چند ثانیه تا چند دقیقه متغیر است و انتخاب شبکهٔ درست برای یک معاملهٔ مشخص معمولاً روشن است، به شرطی که بدانید چه پرسش‌هایی باید بپرسید.'
    ],
    facts: [
      ['نام یکسان، دارایی متفاوت', 'یک توکن روی دو شبکه دو قرارداد است'],
      ['نقدینگی', 'میان شبکه‌ها جمع نمی‌شود'],
      ['پشتیبانی', 'شانزده شبکهٔ سازگار با اتریوم به‌علاوهٔ سولانا'],
      ['نمایش پیش از هر امضا', 'شبکه‌ای که انتخاب کرده‌اید']
    ],
    faqs: [
      { q: 'آیا دارایی ارسال‌شده به شبکهٔ اشتباه قابل بازیابی است؟', a: 'گاهی. اگر به آدرسی رفته که کلید آن را روی یک شبکهٔ سازگار دارید، کافی است شبکه را اضافه کنید. اگر کلید آن آدرس را ندارید، وضعیت نهایی است.' },
      { q: 'کدام شبکه را انتخاب کنم؟', a: 'معمولاً همانی که دارایی شما روی آن است، به شرطی که آن جفت همان‌جا عمق کافی داشته باشد. هزینه و ریسک پل معمولاً از صرفه‌جویی بیشتر است مگر برای معاملات بزرگ یا مکرر.' }
    ]
  },

  /* ─── defi ─────────────────────────────────────────────────────────────── */
  'defi.en': {
    body: [
      'Every yield in decentralised finance is someone else paying. Borrowers pay interest, traders pay pool fees, protocols pay incentives from their own treasury. If you cannot identify who is paying and why, the correct assumption is that the yield is temporary, or that the payment is for risk you have not priced.',
      'The arithmetic is visible on-chain, which is the genuine advantage here. The parts that are not visible — governance decisions, oracle behaviour under stress, what the contract does in conditions nobody has tested — are where losses actually occur.'
    ],
    facts: [
      ['Every yield', 'Is someone else paying — identify who'],
      ['Visible on-chain', 'Rates, collateral, reserves, liquidation thresholds'],
      ['Not visible', 'Governance risk, oracle failure, untested conditions'],
      ['FBT Swap', 'Runs no lending or pool contracts of its own']
    ],
    faqs: [
      { q: 'Why are some advertised rates so high?', a: 'Almost always because they annualise a short measurement window, or because they are paid in a reward token whose price falls as farmers sell it. The day-one rate is rarely the week-four rate.' },
      { q: 'Does an audit mean a protocol is safe?', a: 'No. An audit covers specific code at a specific commit within an agreed scope. Many audited protocols have been exploited, usually through logic or economics the scope did not include.' }
    ]
  },
  'defi.fa': {
    body: [
      'هر بازدهی در امور مالی غیرمتمرکز یعنی کسی دیگر دارد می‌پردازد. وام‌گیرندگان بهره می‌دهند، معامله‌گران کارمزد استخر می‌پردازند و پروتکل‌ها از خزانهٔ خودشان مشوق پخش می‌کنند. اگر نمی‌توانید تشخیص دهید چه کسی و چرا پرداخت می‌کند، فرض درست این است که بازدهی موقتی است یا بهای ریسکی است که قیمت‌گذاری نکرده‌اید.',
      'محاسبات روی زنجیره قابل مشاهده است و مزیت واقعی همین است. آنچه قابل مشاهده نیست — تصمیم‌های حاکمیتی، رفتار اوراکل در شرایط فشار و عملکرد قرارداد در وضعیتی که کسی آزمایش نکرده — همان جایی است که زیان‌ها واقعاً رخ می‌دهند.'
    ],
    facts: [
      ['هر بازدهی', 'یعنی کسی دارد می‌پردازد؛ مشخص کنید چه کسی'],
      ['قابل مشاهده روی زنجیره', 'نرخ‌ها، وثیقه، ذخایر و آستانهٔ انحلال'],
      ['غیرقابل مشاهده', 'ریسک حاکمیت، خطای اوراکل، شرایط آزمایش‌نشده'],
      ['اف‌بی‌تی سواپ', 'قرارداد وام‌دهی یا استخر مستقلی ندارد']
    ],
    faqs: [
      { q: 'چرا بعضی نرخ‌های اعلام‌شده این‌قدر بالا هستند؟', a: 'تقریباً همیشه چون بازدهی یک بازهٔ کوتاه را سالانه کرده‌اند، یا چون با توکن پاداشی پرداخت می‌شود که با فروش کشاورزان قیمتش افت می‌کند. نرخ روز اول به‌ندرت نرخ هفتهٔ چهارم است.' },
      { q: 'آیا حسابرسی یعنی پروتکل امن است؟', a: 'خیر. حسابرسی کد مشخصی را در یک نسخهٔ مشخص و در محدودهٔ توافق‌شده بررسی می‌کند. پروتکل‌های حسابرسی‌شدهٔ زیادی مورد سوءاستفاده قرار گرفته‌اند.' }
    ]
  },

  /* ─── markets ──────────────────────────────────────────────────────────── */
  'markets.en': {
    body: [
      'Market data is useful for describing conditions and almost useless for predicting them, and the gap between those two uses is where most trading education goes wrong. An indicator can tell you that recent movement has been unusually one-sided. It cannot tell you what happens next, and no amount of parameter tuning changes that.',
      'What does survive scrutiny is comparison against an asset\'s own history, stated with its window and its source. "Volume is three times its thirty-day median" is checkable. "Volume is surging" is not.'
    ],
    facts: [
      ['Genuinely useful', "Comparison against an asset's own recent history"],
      ['Not predictive', 'Indicators, patterns and crossovers used as timing rules'],
      ['Always required', 'The measurement window and the source'],
      ['Never provided here', 'Price forecasts or trade recommendations']
    ],
    faqs: [
      { q: 'Do technical indicators work?', a: 'They describe what already happened, which is sometimes useful context. As standalone timing rules, published testing is weak and usually fails after transaction costs.' },
      { q: 'Why does FBT Swap show indicators at all?', a: 'Because describing current conditions against an asset\'s own history is informative. Every reading is shown with its window and its source, and none is presented as an instruction to act.' }
    ]
  },
  'markets.fa': {
    body: [
      'داده‌های بازار برای توصیف شرایط مفیدند و برای پیش‌بینی آن تقریباً بی‌فایده، و فاصلهٔ میان این دو کاربرد همان جایی است که بیشتر آموزش‌های معامله‌گری اشتباه می‌کنند. یک اندیکاتور می‌تواند بگوید حرکت اخیر به‌طور غیرعادی یک‌طرفه بوده است. نمی‌تواند بگوید بعد چه می‌شود و هیچ تنظیم پارامتری این را تغییر نمی‌دهد.',
      'آنچه در برابر بررسی دقیق دوام می‌آورد، مقایسه با تاریخچهٔ خود دارایی است، همراه با ذکر بازه و منبع. «حجم سه برابر میانهٔ سی‌روزه است» قابل بررسی است؛ «حجم در حال جهش است» نیست.'
    ],
    facts: [
      ['واقعاً مفید', 'مقایسه با تاریخچهٔ اخیر خود دارایی'],
      ['پیش‌بینی‌کننده نیست', 'اندیکاتور و الگو به‌عنوان قاعدهٔ زمان‌بندی'],
      ['همیشه لازم', 'ذکر بازهٔ اندازه‌گیری و منبع داده'],
      ['هرگز ارائه نمی‌شود', 'پیش‌بینی قیمت یا توصیهٔ معامله']
    ],
    faqs: [
      { q: 'آیا اندیکاتورهای تکنیکال کار می‌کنند؟', a: 'آنچه را رخ داده توصیف می‌کنند که گاهی زمینهٔ مفیدی است. به‌عنوان قاعدهٔ زمان‌بندی مستقل، آزمون‌های منتشرشده ضعیف‌اند و معمولاً پس از کسر هزینه شکست می‌خورند.' },
      { q: 'پس چرا اف‌بی‌تی سواپ اندیکاتور نشان می‌دهد؟', a: 'چون توصیف شرایط فعلی در برابر تاریخچهٔ خود دارایی گویاست. هر سنجه با بازه و منبعش نمایش داده می‌شود و هیچ‌کدام دستور معامله نیست.' }
    ]
  },

  /* ─── solana ───────────────────────────────────────────────────────────── */
  'solana.en': {
    body: [
      'Solana is not an EVM chain with cheaper gas. The account model, the address format, the fee mechanism and the failure modes are all different, and habits carried over from Ethereum produce specific, repeatable confusion — transactions that vanish instead of pending, tokens that need a deposit before they can be received, and a priority fee that decides inclusion rather than speed.',
      'The upside is that the same design makes wallets able to show exactly which balances a transaction will change before you sign it. That is better pre-signature visibility than most EVM tooling offers.'
    ],
    facts: [
      ['Not EVM', 'Different accounts, addresses, fees and failure modes'],
      ['Transactions', 'Expire rather than pend — usually at no cost'],
      ['Token accounts', 'Each holding needs a refundable SOL rent deposit'],
      ['Best habit', "Read the wallet's simulated balance-change preview"]
    ],
    faqs: [
      { q: 'Why did my Solana transaction disappear?', a: 'It expired before inclusion, almost always because the priority fee was below the current rate. Nothing was charged, and rebuilding with a higher fee usually works.' },
      { q: 'Why do I need SOL to receive a token?', a: 'Receiving a new token type may require creating an associated token account, which must hold a small rent-exempt deposit. The deposit is returned when the account is closed.' }
    ]
  },
  'solana.fa': {
    body: [
      'سولانا یک شبکهٔ سازگار با اتریوم با گس ارزان‌تر نیست. مدل حساب، قالب آدرس، سازوکار کارمزد و حالت‌های خرابی همگی متفاوت‌اند و عادت‌هایی که از اتریوم منتقل می‌شوند سردرگمی‌های مشخص و تکرارشونده‌ای می‌سازند: تراکنش‌هایی که به‌جای انتظار ناپدید می‌شوند، توکن‌هایی که پیش از دریافت به ودیعه نیاز دارند، و کارمزد اولویتی که ورود به بلاک را تعیین می‌کند نه سرعت را.',
      'در عوض، همین طراحی باعث می‌شود کیف پول بتواند دقیقاً نشان دهد کدام موجودی‌ها پیش از امضا تغییر می‌کنند. این سطح از شفافیت پیش از امضا از بیشتر ابزارهای شبکه‌های سازگار با اتریوم بهتر است.'
    ],
    facts: [
      ['سازگار با اتریوم نیست', 'حساب، آدرس، کارمزد و حالت خرابی متفاوت'],
      ['تراکنش‌ها', 'به‌جای انتظار منقضی می‌شوند، معمولاً بدون هزینه'],
      ['حساب توکن', 'هر دارایی به ودیعهٔ قابل بازپس‌گیری سولانا نیاز دارد'],
      ['بهترین عادت', 'خواندن پیش‌نمایش شبیه‌سازی‌شدهٔ تغییر موجودی']
    ],
    faqs: [
      { q: 'چرا تراکنش سولانای من ناپدید شد؟', a: 'پیش از ورود به بلاک منقضی شده است، تقریباً همیشه به این دلیل که کارمزد اولویت از نرخ جاری کمتر بوده. هزینه‌ای کسر نشده و ارسال دوباره با کارمزد بالاتر معمولاً جواب می‌دهد.' },
      { q: 'چرا برای دریافت توکن به سولانا نیاز دارم؟', a: 'دریافت یک نوع توکن جدید ممکن است نیازمند ساخت حساب توکن باشد که باید ودیعهٔ کوچکی نگه دارد. این مبلغ با بستن حساب بازمی‌گردد.' }
    ]
  },

  /* ─── ai ───────────────────────────────────────────────────────────────── */
  'ai.en': {
    body: [
      'There are two kinds of AI in crypto products. One does work that is genuinely hard to do by hand: reading contract code against known patterns, summarising long governance documents, monitoring conditions continuously without fatigue. The other asks a language model to predict a price, which is not a capability any model has.',
      'The distinction matters because both are marketed identically. A model asked for a forecast will produce one, fluently and with complete confidence, because generating fluent text is what it does. Fluency is not evidence, and the only defence is requiring every figure to name its source.'
    ],
    facts: [
      ['Genuinely useful', 'Summarising, classifying, extracting, monitoring'],
      ['Not possible', 'Predicting prices — no model has tomorrow\'s information'],
      ['Worst failure mode', 'Fabricated addresses and figures that look real'],
      ['Our standard', 'Named source, stated window, no invented numbers']
    ],
    faqs: [
      { q: 'Can AI predict crypto prices?', a: 'No. Markets are adversarial and driven largely by information that does not yet exist. A confident forecast from a model reflects how it generates text, not what it knows.' },
      { q: 'Should I trust a contract address from an AI answer?', a: 'Never. An address is exactly the kind of specific string a model can fabricate convincingly. Take it from official documentation or an explorer and verify it on-chain.' }
    ]
  },
  'ai.fa': {
    body: [
      'دو نوع هوش مصنوعی در محصولات این حوزه وجود دارد. یکی کاری را انجام می‌دهد که دستی انجام دادنش واقعاً سخت است: خواندن کد قرارداد در برابر الگوهای شناخته‌شده، خلاصه کردن اسناد حاکمیتی طولانی و پایش پیوستهٔ شرایط بدون خستگی. دیگری از یک مدل زبانی می‌خواهد قیمت را پیش‌بینی کند، که اصلاً توانایی هیچ مدلی نیست.',
      'این تفاوت مهم است چون هر دو یکسان تبلیغ می‌شوند. مدلی که از او پیش‌بینی بخواهید، پیش‌بینی تولید می‌کند، روان و کاملاً مطمئن، چون تولید متن روان کار اوست. روانی متن شاهد نیست و تنها دفاع این است که هر عدد منبعش را ذکر کند.'
    ],
    facts: [
      ['واقعاً مفید', 'خلاصه‌سازی، دسته‌بندی، استخراج و پایش'],
      ['ممکن نیست', 'پیش‌بینی قیمت؛ هیچ مدلی اطلاعات فردا را ندارد'],
      ['بدترین حالت خرابی', 'آدرس و عدد ساختگی با ظاهر کاملاً واقعی'],
      ['استاندارد ما', 'ذکر منبع و بازه، بدون ساختن عدد']
    ],
    faqs: [
      { q: 'آیا هوش مصنوعی می‌تواند قیمت را پیش‌بینی کند؟', a: 'خیر. بازارها رقابتی‌اند و عمدتاً با اطلاعاتی حرکت می‌کنند که هنوز وجود ندارد. پاسخ مطمئن یک مدل بازتاب نحوهٔ تولید متن اوست، نه دانش او.' },
      { q: 'آیا به آدرس قراردادی که هوش مصنوعی داده اعتماد کنم؟', a: 'هرگز. آدرس دقیقاً همان نوع رشته‌ای است که مدل می‌تواند به‌شکل باورپذیری بسازد. آن را از مستندات رسمی یا کاوشگر بگیرید و روی زنجیره تأیید کنید.' }
    ]
  },

  /* ─── tokenized (English only — no Persian spokes yet) ─────────────────── */
  'tokenized.en': {
    body: [
      'Tokenizing an asset moves the claim on-chain. It does not move the asset. Settlement gets faster, ownership becomes fractional and the register becomes public — and underneath, a custodian still holds the thing, an issuer still owes you, and a legal structure still decides what happens if either fails.',
      'So the questions worth asking are not about the blockchain. They are about who holds the underlying, who attests to it and how often, which jurisdiction governs the claim, and whether redemption works in practice for someone holding your position size.'
    ],
    facts: [
      ['What moves on-chain', 'The claim, never the underlying asset'],
      ['Decides the real value', 'Custodian, attestation, jurisdiction, redemption'],
      ['Usually not transferred', 'Voting rights and shareholder protections'],
      ['FBT Swap', 'Does not issue, custody or redeem any of these instruments']
    ],
    faqs: [
      { q: 'Do I own the underlying share or asset?', a: 'No. You hold a token issued against a structure. Even when fully backed, the registered holder is a custodian and your claim is against the issuer.' },
      { q: 'What is the most informative thing to check?', a: 'The redemption terms. Minimum size, fees, eligibility and processing time tell you whether the claim is enforceable by someone holding your position size, which is what backs the price link.' }
    ]
  },

  /* ── chains: the per-network directory ─────────────────────────────────── */
  'chains.en': {
    body: [
      'Switching network is not a cosmetic setting. It changes which token pays for gas, which pools your order can touch, how long a confirmation takes, and which explorer can prove the transaction happened. A USDC balance on Base and a USDC balance on Arbitrum are different tokens at different addresses, and no interface can merge them for you.',
      'The pages below exist because the answer to "is this cheap here?" is different on every chain and changes by the hour. What does not change is the structure: gas is paid to the network in its own native token, the pool fee is paid to liquidity providers inside the price, and FBT Swap takes 0.70% of the input, shown before you sign. Three recipients on all seventeen.'
    ],
    facts: [
      ['Networks supported', '16 EVM chains plus Solana'],
      ['Platform fee', '0.70% of the input, identical on every network'],
      ['Gas', 'Always the network native token, never deducted by FBT Swap'],
      ['Shown before every signature', 'The selected network, the rate and the fee']
    ],
    faqs: [
      { q: 'Can FBT Swap recover tokens I sent on the wrong network?', a: 'No. It is non-custodial and never holds your assets, so there is nothing for it to return. Whether anything can be done depends entirely on whether you control the destination address on the other chain.' },
      { q: 'Does the platform fee change between networks?', a: 'No. It is 0.70% of the input amount everywhere. What changes between networks is gas and the pool fee inside the price, and those are paid to validators and liquidity providers rather than to FBT Swap.' }
    ]
  },
  'chains.fa': {
    body: [
      'تعویض شبکه یک تنظیم ظاهری نیست. تعیین می‌کند کدام توکن کارمزد را می‌پردازد، سفارش به کدام استخرها دسترسی دارد، تأیید چقدر طول می‌کشد و کدام کاوشگر می‌تواند ثابت کند تراکنش انجام شده است. موجودی USDC روی بیس و موجودی USDC روی آربیتروم دو توکن متفاوت با دو آدرس متفاوت‌اند و هیچ رابطی نمی‌تواند آن‌ها را یکی کند.',
      'این صفحه‌ها وجود دارند چون پاسخ پرسش «اینجا ارزان است؟» روی هر شبکه فرق می‌کند و ساعت‌به‌ساعت تغییر می‌کند. چیزی که تغییر نمی‌کند ساختار هزینه است: کارمزد شبکه با توکن بومی به خود شبکه می‌رسد، کارمزد استخر داخل قیمت به تأمین‌کنندگان نقدینگی می‌رسد، و اف‌بی‌تی سواپ ۰٫۷۰ درصد از مقدار ورودی را برمی‌دارد که پیش از امضا نمایش داده می‌شود. سه دریافت‌کننده روی هر هفده شبکه.'
    ],
    facts: [
      ['شبکه‌های پشتیبانی‌شده', '۱۶ شبکهٔ EVM به‌همراه سولانا'],
      ['کارمزد پلتفرم', '۰٫۷۰ درصد از ورودی، یکسان روی همهٔ شبکه‌ها'],
      ['کارمزد شبکه', 'همیشه با توکن بومی شبکه، هرگز توسط اف‌بی‌تی سواپ کسر نمی‌شود'],
      ['پیش از هر امضا', 'شبکهٔ انتخاب‌شده، نرخ و کارمزد نمایش داده می‌شود']
    ],
    faqs: [
      { q: 'اگر توکن را روی شبکهٔ اشتباه فرستادم، اف‌بی‌تی سواپ می‌تواند برش گرداند؟', a: 'نه. این سرویس غیرحضانتی است و هرگز دارایی تو را نگه نمی‌دارد، پس چیزی برای بازگرداندن ندارد. اینکه اصلاً کاری ممکن باشد یا نه، فقط به این بستگی دارد که آدرس مقصد روی آن شبکهٔ دیگر در کنترل خودت باشد.' },
      { q: 'کارمزد پلتفرم بین شبکه‌ها فرق می‌کند؟', a: 'نه. همه‌جا ۰٫۷۰ درصد از مقدار ورودی است. چیزی که بین شبکه‌ها فرق می‌کند کارمزد شبکه و کارمزد استخر داخل قیمت است که به اعتبارسنج‌ها و تأمین‌کنندگان نقدینگی می‌رسد، نه به اف‌بی‌تی سواپ.' }
    ]
  }
};
