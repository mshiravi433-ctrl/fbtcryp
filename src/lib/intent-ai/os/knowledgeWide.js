/**
 * FBT KNOWLEDGE EXPANSION — THE WIDE CORPUS
 * ---------------------------------------------------------------------------
 * The audit (docs/AI-COGNITION-AUDIT-2026-11-11.md) measured the ceiling on
 * how much the assistant can KNOW: the knowledge base held 27 items. That is
 * the hard limit on grounding, no matter how many providers answer and no
 * matter how deep the multi-stage reasoning goes.
 *
 * This file is the expansion of that base. It follows the same truth rules as
 * the seed corpus (src/lib/intent-ai/os/knowledgeCenter.js):
 *
 *   - Only STABLE knowledge lives here. Prices, balances, APYs, rates and
 *     news NEVER do — those come from live tools at answer time.
 *   - `status: 'verified'` items may be stated as fact; `unverified` items
 *     must be hedged; `deprecated` items are never retrieved.
 *   - Every item carries version/source/status/confidence metadata.
 *   - Nothing may claim a product feature that does not exist. Where the
 *     product has no such feature, the item says so plainly.
 *
 * The corpus is deliberately organised so that every one of the twelve
 * KNOWLEDGE_CATEGORIES carries several items — the audit found `FAQ` empty
 * and the rest of the categories carrying one or two items each, which meant a
 * question in a thin area simply had nothing to ground itself on.
 *
 * `tags` are load-bearing: the retriever scores a title-and-tag match at 1.6
 * and a body match at 1.0, so the tag list is how a colloquial question finds
 * its item. Tags are written in the same vocabulary the user types.
 */

const now = () => Date.now();

export const FBT_KNOWLEDGE_WIDE = Object.freeze([
  /* ======================================================================== */
  /*  FAQ — the entry-level questions a real user asks first                 */
  /* ======================================================================== */
  {
    id: 'kb.faq.what-is-fbt', version: 1, category: 'FAQ', status: 'verified', confidence: 95,
    source: 'fbt-app',
    titleFa: 'FBT در یک جمله چه کاری انجام می‌دهد؟', titleEn: 'What does FBT do, in one sentence?',
    tags: ['فبت', 'چیست', 'کاربرد', 'پلتفرم', 'امکانات', 'what is fbt', 'features'],
    bodyFa: 'FBT یک پلتفرم غیرامانی برای کریپتو است: مبادله (سواپ) درجا، بریج بین شبکه‌ها، فارم و کسب سود، بازارهای مشتقه، سیگنال، ردیابی اسمارت مانی و یک دستیار هوش مصنوعی (Intent AI) که سؤال شما را با داده زنده و تحلیل چندمرحله‌ای پاسخ می‌دهد. هیچ بخشی از دارایی شما نزد FBT نگهداری نمی‌شود.',
    bodyEn: 'FBT is a non-custodial crypto platform: spot swaps, cross-chain bridging, farming and yield, derivatives, signals, smart-money tracking, and an AI assistant (Intent AI) that answers questions with live data and multi-stage analysis. None of your assets are held by FBT.',
    updatedAt: now()
  },
  {
    id: 'kb.faq.who-can-use', version: 1, category: 'FAQ', status: 'verified', confidence: 92,
    source: 'fbt-app',
    titleFa: 'چه کسانی می‌توانند از FBT استفاده کنند؟', titleEn: 'Who can use FBT?',
    tags: ['چه کسی', 'کاربر', 'ثبت نام', 'حساب', 'محدودیت', 'کشور', 'who can use', 'eligibility', 'sign up'],
    bodyFa: 'هر کسی که کیف پول سازگار با شبکه‌های پشتیبانی‌شده دارد می‌تواند بدون ثبت‌نام و بدون احراز هویت استفاده کند؛ کیف پول به‌عنوان حساب کاربری عمل می‌کند. FBT حساب و کلید خصوصی شما را نمی‌گیرد و هیچ وجهی نزد خود نگه نمی‌دارد. محدودیت‌های شبکه و کارمزدهای زنجیره در خود بلاک‌چین اعمال می‌شوند، نه توسط FBT.',
    bodyEn: 'Anyone with a wallet compatible with the supported networks can use FBT with no signup and no KYC; the wallet acts as the account. FBT never takes your account or private key and holds no funds. Network and on-chain gas costs are enforced by the blockchain itself, not by FBT.',
    updatedAt: now()
  },
  {
    id: 'kb.faq.no-account', version: 1, category: 'FAQ', status: 'verified', confidence: 94,
    source: 'fbt-security-policy',
    titleFa: 'آیا برای استفاده از FBT باید ثبت‌نام کنم؟', titleEn: 'Do I need an account to use FBT?',
    tags: ['ثبت نام', 'ورود', 'حساب کاربری', 'کیف پول', 'تایید هویت', 'sign up', 'login', 'account', 'kyc'],
    bodyFa: 'خیر. FBT حساب کاربری جداگانه ندارد و هیچ فرم احراز هویتی نمی‌خواهد. کیف پول شما خودش هویت است و امضای تراکنش با همان انجام می‌شود. تنها جایی که ممکن است داده‌ای ذخیره شود، تنظیمات و تاریخچه گفتگو روی دستگاه خودتان است تا حافظه و پیشنهادها بهتر کار کنند.',
    bodyEn: 'No. FBT has no separate account and asks for no identity verification. Your wallet is the identity and it signs the transaction. The only data that may be stored is settings and chat history on your own device, so that memory and suggestions work better.',
    updatedAt: now()
  },
  {
    id: 'kb.faq.get-started', version: 1, category: 'FAQ', status: 'verified', confidence: 91,
    source: 'fbt-app',
    titleFa: 'از کجا شروع کنم؟', titleEn: 'How do I get started?',
    tags: ['شروع', 'راهنما', 'اولین', 'آموزش', 'مراحل', 'get started', 'begin', 'how to start', 'tutorial'],
    bodyFa: 'نقاط شروع معمول این‌هاست: بخش «سواپ» برای مبادلهٔ ساده، «بریج» برای انتقال بین شبکه‌ها، «فارم» برای کسب سود، «پرتفوی» برای دیدن دارایی‌ها، و «Intent AI» برای پرسیدن سؤال به‌صورت طبیعی. اگر تازه‌وارد هستید، ابتدا یک مقدار کوچک را در یک دارایی نقدشونده مثل تتر امتحان کنید تا مسیر شبکه و کارمزد را از نزدیک ببینید.',
    bodyEn: 'Common entry points are: Swap for a simple trade, Bridge to move between networks, Farm for yield, Portfolio to see what you hold, and Intent AI to ask questions in plain language. If you are new, try a small amount in a liquid asset like USDT first so you can see the network path and the fees up close.',
    updatedAt: now()
  },
  {
    id: 'kb.faq.support', version: 1, category: 'FAQ', status: 'verified', confidence: 90,
    source: 'fbt-app',
    titleFa: 'اگر مشکلی پیش آمد چه کنم؟', titleEn: 'What do I do if something goes wrong?',
    tags: ['مشکل', 'پشتیبانی', 'کمک', 'خطا', 'اشکال', 'support', 'help', 'problem', 'error'],
    bodyFa: 'اول تراکنش را در همان بلاک‌چین بررسی کنید: اگر تراکنش در explorer ثبت شده باشد، اجرا شده و مشکل از نمایش در رابط کاربری است. اگر تراکنش ثبت نشده، معمولاً کارمزد شبکه کم بوده یا اسلوییچ (Slippage) خیلی تنگ تنظیم شده است. برای مسائل حساب و گزارش خطا از بخش تماس و پشتیبانی در سایت استفاده کنید. هیچ‌کس در FBT کلید شما را ندارد، پس بازیابی از طریق عبارت بازیابی خودتان انجام می‌شود.',
    bodyEn: 'Check the transaction on the chain first: if it is recorded on the explorer it executed, and the problem is in the interface. If it is not recorded, the network fee was usually too low or the slippage was set too tight. For account issues and error reports use the contact and support section of the site. Nobody at FBT holds your key, so recovery goes through your own recovery phrase.',
    updatedAt: now()
  },

  /* ======================================================================== */
  /*  WALLET — the security questions the assistant must answer precisely    */
  /* ======================================================================== */
  {
    id: 'kb.wallet.connect', version: 1, category: 'WALLET', status: 'verified', confidence: 93,
    source: 'fbt-app',
    titleFa: 'چطور کیف پول را وصل کنم؟', titleEn: 'How do I connect my wallet?',
    tags: ['اتصال', 'وصل', 'کیف پول', 'متامسک', 'امضا', 'connect wallet', 'connect', 'metamask', 'sign'],
    bodyFa: 'از دکمهٔ اتصال کیف پول در بالای صفحه استفاده کنید و یکی از کیف پول‌های سازگار را انتخاب کنید. اتصال فقط یعنی FBT آدرس عمومی شما را می‌بیند تا موجودی و تراکنش‌ها را نمایش دهد. هیچ دسترسی‌ای به دارایی داده نمی‌شود؛ برداشت یا معامله فقط وقتی انجام می‌شود که خودتان در کیف پول امضا کنید.',
    bodyEn: 'Use the connect-wallet button and pick a compatible wallet. Connecting only means FBT can see your public address to display balances and transactions. No access to funds is granted; a withdrawal or trade only happens when you sign it yourself in your wallet.',
    updatedAt: now()
  },
  {
    id: 'kb.wallet.recover', version: 1, category: 'WALLET', status: 'verified', confidence: 95,
    source: 'fbt-security-policy',
    titleFa: 'اگر گوشی یا مرورگرم را گم کردم چه کنم؟', titleEn: 'What if I lose my phone or browser?',
    tags: ['بازیابی', 'بازیاب', 'عبارت', 'گم شده', 'گم کردم', 'دستگاه', 'رمز', 'lost', 'recover', 'recovery', 'restore', 'seed phrase', 'back up', 'how do i recover'],
    bodyFa: 'تا وقتی عبارت بازیابی خود را در جای امن نگه داشته باشید، مشکلی نیست: کیف پول خود را روی دستگاه یا مرورگر جدید بازیابی کنید و همان عبارت را وارد کنید. FBT هیچ نسخهٔ پشتیبانی از عبارت شما ندارد و نمی‌تواند آن را بازیابی کند — به همین دلیل است که هرگز آن را از شما نمی‌خواهد. عبارت بازیابی را در هیچ سایت، فرم یا چتی وارد نکنید.',
    bodyEn: 'As long as you kept your own recovery phrase somewhere safe, nothing is lost: restore the wallet on a new device or browser and enter it. FBT has no backup copy of your phrase and cannot recover it — which is exactly why it never asks for it. Never enter your recovery phrase into any site, form or chat.',
    updatedAt: now()
  },
  {
    id: 'kb.wallet.phishing', version: 1, category: 'WALLET', status: 'verified', confidence: 96,
    source: 'fbt-security-policy',
    titleFa: 'چطور جلوی فیشینگ را بگیرم؟', titleEn: 'How do I protect myself from phishing?',
    tags: ['فیشینگ', 'کلاهبرداری', 'امنیت', 'جعل', 'شباهت', 'phishing', 'scam', 'security', 'fake'],
    bodyFa: 'قانون ساده: هیچ‌کس — حتی پشتیبانی — هرگز عبارت بازیابی یا کلید خصوصی شما را نمی‌خواهد. قبل از امضا، آدرس مقصد را با دقت بخوانید؛ یک حرف یا رقم متفاوت یعنی دارایی به کیف پول دیگری می‌رود. امضای «Approve» یا «Set Approval» برای یک قرارداد، به آن قرارداد اجازهٔ برداشت از توکن شما می‌دهد — پیش از امضا آن را بخوانید. آدرس سایت را خودتان تایپ کنید و از لینک‌های پیامکی و دایرکتوری وارد نشوید.',
    bodyEn: 'The simple rule: nobody — not even support — ever needs your recovery phrase or private key. Read the destination address carefully before signing; a single different letter or digit sends the funds to a different wallet. An "Approve" or "Set Approval" signature lets a contract pull your tokens, so read it before signing. Type the site address yourself and do not enter through links in SMS or direct messages.',
    updatedAt: now()
  },
  {
    id: 'kb.wallet.permissions', version: 1, category: 'WALLET', status: 'verified', confidence: 92,
    source: 'fbt-security-policy',
    titleFa: 'دسترسی‌های کیف پول چه هستند و چه کار می‌کنند؟', titleEn: 'What are wallet approvals and what do they allow?',
    tags: ['دسترسی', 'مجوز', 'تایید', 'اسپند', 'سپرده', 'approval', 'allowance', 'permit', 'revoke', 'approval', 'allowance', 'permit', 'revoke', 'spend'],
    bodyFa: 'وقتی یک قرارداد اجازهٔ برداشت توکن می‌گیرد، آن اجازه «Spend Allowance» نام دارد: یعنی آن قرارداد می‌تواند تا سقف تعیین‌شده از توکن شما برداشت کند، بدون اینکه دوباره از شما امضا بگیرد. این دسترسی در سمت بلاک‌چین ثبت می‌شود و در بسیاری از کیف پول‌ها می‌توانید آن را لغو (Revoke) کنید. پیش از امضای یک دسترسی، نام قرارداد و سقف آن را ببینید.',
    bodyEn: 'When a contract is allowed to pull a token, it is a "spend allowance": the contract may withdraw up to the stated limit without asking you again. That permission is recorded on-chain and in most wallets you can revoke it. Before signing any approval, look at the contract name and its limit.',
    updatedAt: now()
  },

  /* ======================================================================== */
  /*  SWAP — execution mechanics, the questions that come with every trade    */
  /* ======================================================================== */
  {
    id: 'kb.swap.slippage', version: 1, category: 'SWAP', status: 'verified', confidence: 94,
    source: 'fbt-app',
    titleFa: 'اسلیپیج (Slippage) چیست و چه تنظیمی بگذارم؟', titleEn: 'What is slippage and what should I set?',
    tags: ['اسلیپیج', 'slippage', 'لغزش', 'حد', 'تنظیم', 'قیمت', 'difference', 'spread'],
    bodyFa: 'اسلیپیج یعنی اختلاف قیمتی که واقعاً اجرا می‌شود با قیمتی که در لحظهٔ ثبت سفارش دیدید. علت رایج آن، جابه‌جایی قیمت در چند ثانیهٔ بین محاسبه و ثبت تراکنش است. برای بازارهای نقدشونده و مبالغ کوچک، اسلیپیج پایین‌تر (مثلاً ۰٫۵٪) معمولاً امن‌تر است چون جلوی معامله‌ای که با قیمت بسیار بد انجام می‌شود را می‌گیرد؛ در بازار کم‌عمق یا برای مبالغ بزرگ، اسلیپیج بیشتری لازم است وگرنه تراکنش با خطا رد می‌شود.',
    bodyEn: 'Slippage is the gap between the price you saw and the price the trade actually executes at, usually caused by price movement between quoting and on-chain confirmation. For liquid markets and small amounts a tighter setting (say 0.5%) is usually safer because it blocks a trade at a much worse price; in thin markets or for large amounts you need more slack or the transaction simply reverts.',
    updatedAt: now()
  },
  {
    id: 'kb.swap.price-impact', version: 1, category: 'SWAP', status: 'verified', confidence: 92,
    source: 'fbt-app',
    titleFa: 'تأثیر قیمت (Price Impact) چیست؟', titleEn: 'What is price impact?',
    tags: ['تأثیر', 'اثر قیمت', 'price impact', 'عمق', 'لیکوییدیتی', 'slippage cost', 'depth'],
    bodyFa: 'تأثیر قیمت یعنی اینکه سفارش شما چقدر قیمت بازار را جابه‌جا می‌کند. هرچه سفارش بزرگ‌تر نسبت به عمق همان بازار باشد، تأثیر بیشتر است و معامله گران‌تر تمام می‌شود. این عدد با اسلیپیج فرق دارد: اسلیپیج نوسان لحظه‌ای است، تأثیر قیمت نتیجهٔ اندازهٔ سفارش شما در برابر عمق بازار. برای مبالغ بزرگ، تقسیم سفارش به چند بخش معمولاً هزینه را کم می‌کند.',
    bodyEn: 'Price impact is how much your order moves the market. The larger your order relative to the pool depth, the larger the impact and the more expensive the trade. It differs from slippage: slippage is moment-to-moment movement, while price impact is a function of your order size against market depth. For large amounts, splitting the order into several pieces usually reduces the cost.',
    updatedAt: now()
  },
  {
    id: 'kb.swap.fees', version: 1, category: 'SWAP', status: 'verified', confidence: 91,
    source: 'src/lib/feeBps.js',
    titleFa: 'در یک سواپ چه کارمزدی پرداخت می‌کنم؟', titleEn: 'What fees do I pay on a swap?',
    tags: ['کارمزد', 'هزینه', 'gas', 'گس', 'کارمزد شبکه', 'سواپ', 'سوآپ', 'fee', 'cost', 'gas fee', 'network fee', 'swap fees', 'fee on swaps', 'charged'],
    bodyFa: 'یک سواپ معمولاً سه جزء هزینه دارد: (۱) کارمزد شبکه یا گس که به بلاک‌چین می‌رود و به شلوغی شبکه بستگی دارد، (۲) کارمزد پلتفرم FBT که در همان صفحهٔ معامله به‌صورت درصدی نمایش داده می‌شود، و (۳) اختلاف قیمت خرید و فروش در استخر (AMM) که به عمق بازار بستگی دارد. قبل از تأیید، جمع کارمزد در همان صفحه نشان داده می‌شود.',
    bodyEn: 'A swap usually has three cost components: (1) the network or gas fee, which goes to the blockchain and depends on network congestion; (2) the FBT platform fee, shown as a percentage on the same trade screen; and (3) the bid-ask spread inside the pool, which depends on market depth. The total is displayed before you confirm.',
    updatedAt: now()
  },
  {
    id: 'kb.swap.receipt', version: 1, category: 'SWAP', status: 'verified', confidence: 90,
    source: 'fbt-app',
    titleFa: 'بعد از سواپ چطور مطمئن شوم انجام شد؟', titleEn: 'How do I confirm a swap went through?',
    tags: ['رسید', 'تایید', 'تراکنش', 'بررسی', 'انجام شد', 'explorer', 'receipt', 'confirm', 'transaction hash', 'status'],
    bodyFa: 'پس از تأیید در کیف پول، تراکنش یک شناسه (Transaction Hash) می‌گیرد. آن شناسه را در explorer همان شبکه باز کنید تا وضعیت آن را ببینید: صفحهٔ تراکنش، تعداد تأییدها و مقدار جابه‌جا شده را نشان می‌دهد. در FBT هم همان شناسه در تاریخچهٔ تراکنش‌ها نگه داشته می‌شود. اگر تراکنش در explorer وجود نداشت، یعنی اصلاً ثبت نشده و معمولاً کارمزد شبکه کم بوده است.',
    bodyEn: 'After you confirm in your wallet the transaction gets a transaction hash. Open that hash in the explorer of the same network to see its status, the confirmation count and the amount moved. FBT also keeps the hash in the transaction history. If the transaction does not exist in the explorer it was never recorded, which usually means the network fee was too low.',
    updatedAt: now()
  },
  {
    id: 'kb.swap.approval-flow', version: 1, category: 'SWAP', status: 'verified', confidence: 91,
    source: 'fbt-app',
    titleFa: 'چرا یک سواپ دو بار تأیید می‌خواهد؟', titleEn: 'Why does a swap ask me to sign twice?',
    tags: ['دو بار', 'تایید', 'امضا', 'مجوز', 'approve', 'sign twice', 'two signatures', 'allowance'],
    bodyFa: 'برای اینکه قرارداد بتواند توکن شما را جابه‌جا کند، ابتدا یک امضای «تأیید دسترسی» لازم است (Spend Approval) و سپس خودِ تراکنش. امضای اول فقط اجازه می‌دهد آن قرارداد تا یک سقف مشخص از توکن را برداشت کند؛ امضای دوم همان معامله را با قیمت و مقدار نهایی اجرا می‌کند. این دو امضا از دو بخش متفاوت کیف پول می‌آیند و لازم است. پیش از امضای اول، نام قرارداد و سقف دسترسی را بررسی کنید.',
    bodyEn: 'For a contract to move your token, it first needs a spend-approval signature, then the trade itself. The first signature only allows that contract to pull up to a stated limit; the second executes the trade at the final price and amount. The two signatures come from two different parts of your wallet and both are needed. Check the contract name and the allowance limit before the first one.',
    updatedAt: now()
  },
  {
    id: 'kb.swap.quote-expiry', version: 1, category: 'SWAP', status: 'verified', confidence: 89,
    source: 'fbt-app',
    titleFa: 'چرا قیمت سواپ منقضی می‌شود؟', titleEn: 'Why does the swap quote expire?',
    tags: ['منقضی', 'انقضا', 'قیمت', 'تایمر', 'refresh', 'expire', 'quote expiry', 'stale', 'countdown'],
    bodyFa: 'قیمت پیشنهادی فقط برای مدت کوتاهی معتبر است، چون در همان لحظه هم بازار حرکت می‌کند. اگر زمان آن تمام شود، FBT قیمت را دوباره محاسبه می‌کند و پیش از اجرا مقدار و قیمت نهایی را نشان می‌دهد. اگر قیمت نهایی از چیزی که انتظار داشتید بدتر بود، می‌توانید معامله را لغو کنید و بعداً دوباره تلاش کنید.',
    bodyEn: 'A quoted price is only valid for a short time because the market keeps moving while it sits. When it expires FBT recalculates and shows the final amount and price before anything executes. If the final price is worse than you expected you can cancel and try again later.',
    updatedAt: now()
  },

  {
    id: 'kb.product.fee-where', version: 1, category: 'PRODUCT', status: 'verified', confidence: 94,
    source: 'src/lib/feeBps.js',
    titleFa: 'کارمزد پلتفرم چطور محاسبه و دریافت می‌شود؟', titleEn: 'How is the platform fee calculated and collected?',
    tags: ['کارمزد', 'هزینه', 'پولیدی', 'دریافت', 'محاسبه', 'کجا میره', 'fee', 'charge', 'charged', 'cost', 'price', 'costs', 'pricing'],
    bodyFa: 'کارمزد FBT به‌صورت درصدی از حجم معامله محاسبه می‌شود و در همان صفحهٔ تأیید، پیش از اجرا، به‌صورت مبلغ و درصد نشان داده می‌شود. این کارمزد روی خودِ تراکنش اعمال می‌شود و جدا از کارمزد شبکه (گس) است که به بلاک‌چین می‌رود. اگر یک تراکنش ناموفق باشد و برگردد، بسته به مسیر اجرا ممکن است کارمزد شبکه مصرف‌شده باقی بماند ولی معامله انجام نشود.',
    bodyEn: 'The FBT fee is a percentage of the trade amount and is shown in both money and percent on the confirmation screen before anything executes. It applies to the transaction itself and is separate from the network fee (gas) that goes to the blockchain. If a transaction fails and reverts, the spent network fee may still be deducted even though the trade did not happen.',
    updatedAt: now()
  },

  /* ======================================================================== */
  /*  DEFI / YIELD — the highest-risk area to get right                        */
  /* ======================================================================== */
  {
    id: 'kb.defi.apr-vs-real', version: 1, category: 'DEFI', status: 'verified', confidence: 93,
    source: 'fbt-risk-policy',
    titleFa: 'APR و APY چه فرقی دارند و چرا سود واقعی کمتر است؟', titleEn: 'What is the difference between APR and APY, and why is real yield lower?',
    tags: ['apr', 'apy', 'سود', 'بهره', 'سالانه', 'درصد', 'compound', 'ترکیبی', 'yield', 'interest rate'],
    bodyFa: 'APR نرخ سالانهٔ ساده است و APY نرخ سالانهٔ ترکیبی؛ برای همین APY معمولاً کمی بالاتر از APR نمایش داده می‌شود. نرخ اعلام‌شده در پروتکل «بازده تضمینی» نیست: بخشی از آن پاداش توکن است که قیمتش با بازار تغییر می‌کند، و بخشی کاملاً به تعداد کاربران و ورود پول وابسته است. اگر همه دارایی از استخر خارج شود، سود شما هم می‌تواند از بین برود. همیشه به ریسک‌های بخش «ریسک» در همان صفحهٔ استخر نگاه کنید.',
    bodyEn: 'APR is the simple annual rate and APY the compounded one, so APY is normally shown slightly higher. The advertised rate is not guaranteed: part of it is token rewards whose price moves with the market, and part depends entirely on how much liquidity is in the pool and how many users compete for it. If the pool empties, your yield can disappear too. Always read the risk section on the pool page.',
    updatedAt: now()
  },
  {
    id: 'kb.defi.il-loss', version: 1, category: 'DEFI', status: 'verified', confidence: 95,
    source: 'fbt-risk-policy',
    titleFa: 'ریسک ضرر غیرخطی (Impermanent Loss) چیست؟', titleEn: 'What is impermanent loss?',
    tags: ['ضرر', 'غیرخطی', 'impermanent', 'il', 'استخر', 'نقدینگی', 'loss', 'liquidity provider'],
    bodyFa: 'وقتی نقدینگی یک استخر خودکار (AMM) را می‌دهید و قیمت دارایی‌ها تغییر می‌کند، استخر ترکیب دارایی‌هایش را طوری بازتنظیم می‌کند که در عمل بیشترِ داراییِ در حال رشد را به داراییِ افتاده تبدیل کند. اگر خودتان به‌جای نگه‌داشتن، دارایی را در یک جای دیگر نگه می‌داشتید، سود بیشتری می‌کردید؛ به این فاصله «ضرر غیرخطی» می‌گویند. ضرر فقط وقتی «واقعی» می‌شود که از استخر خارج شوید، و در بازار نزولی شدید می‌تواند بزرگ شود. برای دارایی‌های نوسانی، نگه‌داشتن ساده اغلب کم‌ریسک‌تر است.',
    bodyEn: 'When you provide liquidity to an automated pool and prices move, the pool rebalances its holdings so that it effectively sells the rising asset into the falling one. If you had simply held the asset elsewhere you would have done better; that gap is impermanent loss. It only becomes real when you withdraw, and in a sharp downturn it can be large. For volatile assets, simply holding is often the lower-risk choice.',
    updatedAt: now()
  },
  {
    id: 'kb.defi.stablecoin-risk', version: 1, category: 'DEFI', status: 'verified', confidence: 94,
    source: 'fbt-risk-policy',
    titleFa: 'ریسک استیبل‌کوین‌ها چیست؟', titleEn: 'What are the risks of stablecoins?',
    tags: ['استیبل', 'استیبلکوین', 'دلار', 'peg', 'تتر', 'usdt', 'usdc', 'depeg', 'پگ'],
    bodyFa: 'استیبل‌کوین یعنی توکنی که قیمت آن به یک دارایی پایه مثل دلار وابسته است. «پگ» یعنی همین وابستگی؛ اگر قیمت از دلار فاصله بگیرد، شما با دارایی‌ای روبه‌رو هستید که بازار آن انتظار ندارد. ریسک‌ها شامل ریسک ناشر (پشتوانه و نحوهٔ نگهداری دارایی)، ریسک ذخیره‌سازی و ریسک نقدشوندگی در شرایط بحران است. در بازارهای پرنوسان، نقدشوندگی همهٔ استیبل‌کوین‌ها هم‌زمان از بین می‌رود و خروج گران می‌شود. با اهرم و در استخر، این ریسک‌ها چند برابر می‌شوند.',
    bodyEn: 'A stablecoin is a token priced against a reference asset such as the dollar; that link is the peg, and if the price drifts from the dollar you hold an asset the market does not expect to be worth that. The risks are issuer risk (the backing and how it is held), custody risk, and liquidity risk in a crisis. In a volatile market, liquidity across all stablecoins can vanish at once and exiting becomes expensive. Leveraged or pooled positions multiply these risks.',
    updatedAt: now()
  },
  {
    id: 'kb.defi.smart-contract-risk', version: 1, category: 'DEFI', status: 'verified', confidence: 94,
    source: 'fbt-risk-policy',
    titleFa: 'ریسک قرارداد هوشمند چیست؟', titleEn: 'What is smart-contract risk?',
    tags: ['قرارداد', 'هوشمند', 'باگ', 'هک', 'smart contract', 'audit', 'بررسی', 'خطر'],
    bodyFa: 'قرارداد هوشمند کدی است که روی بلاک‌چین اجرا می‌شود و اگر اشتباهی در آن باشد، آن اشتباه دائمی و برگشت‌ناپذیر است. اگر قرارداد حساب خود را قفل کند یا منطق برداشت را اشتباه پیاده کند، دارایی شما می‌تواند برای همیشه گرفتار بماند و هیچ پشتیبانی مرکزی هم نمی‌تواند کاری کند. نشانه‌های احتیاط: ممکن بودن گزارش بررسی امنیتی (audit)، سابقهٔ تیم و مدت فعالیت پروژه، و قفل‌کردن دارایی‌های بزرگ در قرارداد.',
    bodyEn: 'A smart contract is code running on the blockchain, so a mistake in it is permanent and irreversible. If the contract locks its own account or implements withdrawal logic wrongly, assets can stay trapped forever and no central support can undo it. Warning signs to weigh: whether a security audit exists, the team history and how long the project has run, and whether large amounts of value are locked in the contract.',
    updatedAt: now()
  },
  {
    id: 'kb.defi.apy-checklist', version: 1, category: 'DEFI', status: 'verified', confidence: 92,
    source: 'fbt-risk-policy',
    titleFa: 'قبل از واریز به استخر چه چیزهایی را بررسی کنم؟', titleEn: 'What should I check before depositing into a pool?',
    tags: ['استخر', 'واریز', 'بررسی', 'چک', 'before deposit', 'pool', 'checklist', 'due diligence'],
    bodyFa: 'پیش از واریز این پنج چیز را ببینید: نرخ واقعی و روش تولید آن (توکن یا کارمزد)، ریسک‌های اعلام‌شده در صفحهٔ استخر، مدت فعالیت و سابقهٔ پروژه، وجود گزارش بررسی امنیتی، و عمق کل استخر (استخر کم‌عمق یعنی تأثیر قیمت و ریسک خروج بیشتر). اگر نرخ سود به‌طور غیرعادی بالا و پایدار است، معمولاً یک ریسک پنهان دارد که توضیح داده نشده.',
    bodyEn: 'Before depositing, look at five things: the real rate and how it is produced (token emissions or fees), the risks listed on the pool page, how long the project has been running, whether a security audit exists, and the total pool depth (a shallow pool means more price impact and more exit risk). If a yield looks unusually high and stable, it usually hides a risk that has not been explained.',
    updatedAt: now()
  },

  /* ======================================================================== */
  /*  RISK — the discipline the assistant must never soften                    */
  /* ======================================================================== */
  {
    id: 'kb.risk.leverage', version: 1, category: 'RISK', status: 'verified', confidence: 96,
    source: 'fbt-risk-policy',
    titleFa: 'اهرم چگونه کار می‌کند و چرا خطرناک است؟', titleEn: 'How does leverage work, and why is it dangerous?',
    tags: ['اهرم', 'لوریج', 'futures', 'مارجین', 'liquidate', 'leverage', 'leveraged', 'margin', 'liquidation', 'risk', 'risks', 'dangerous', 'خطر'],
    bodyFa: 'اهرم یعنی با سرمایهٔ کوچک‌تر، موقعیت بزرگ‌تری باز کنید. دقیقاً به همین دلیل، سود هم چند برابر می‌شود و زیان هم. نکتهٔ کلیدی: در اکثر بازارهای مشتقه، **نگه‌داشتن موقعیت باز به معنی پرداخت کارمزد تاموینگ برای هر دو طرف است** — چه در سود باشید چه در زیان. اگر آن را در نظر نگیرید، سود ظاهری شما می‌تواند در واقع زیان باشد. در نهایت، اگر زیان به حد لیکوییدشدن برسد، موقعیت به‌صورت خودکار بسته می‌شود و سرمایهٔ باقی‌مانده از دست می‌رود.',
    bodyEn: 'Leverage means opening a larger position with less capital — which is exactly why both gains and losses multiply. The key point: on most derivatives venues, *holding a position open means paying the funding fee on both sides*, whether you are in profit or in loss. Ignore that and an apparent profit can be an actual loss. If the loss reaches the liquidation threshold, the position is closed automatically and the remaining margin is lost.',
    updatedAt: now()
  },
  {
    id: 'kb.risk.stop-loss', version: 1, category: 'RISK', status: 'verified', confidence: 93,
    source: 'fbt-risk-discipline',
    titleFa: 'حد ضرر (Stop Loss) چگونه تنظیم می‌شود؟', titleEn: 'How should a stop loss be set?',
    tags: ['حد ضرر', 'stop', 'خروج', 'بستن', 'stop loss', 'exit', 'take profit'],
    bodyFa: 'حد ضرر روی قیمتی تنظیم می‌شود که اگر بازار خلاف جهت شما رفت، موقعیت به‌صورت خودکار بسته شود. محل درست آن معمولاً جایی است که **تحلیل شما باطل می‌شود**، نه یک درصد دلخواه. زیر سطح حمایتی معتبر یا زیر میانگین متحرک بلندتر قرار دهید تا یک نوسان عادی شما را خارج نکند. نکته: در بازارهای بی‌وقفه، حد ضرر ممکن است با قیمتِ بعدی کمی متفاوت اجرا شود.',
    bodyEn: 'A stop loss is a price at which the position closes automatically if the market moves against you. The right place is usually where *your analysis is invalidated*, not an arbitrary percentage. Place it below a valid support level or below the relevant moving average so that ordinary noise does not eject you. Note that in always-on markets a stop may fill at a slightly different price than the trigger.',
    updatedAt: now()
  },
  {
    id: 'kb.risk.diversification', version: 1, category: 'RISK', status: 'verified', confidence: 93,
    source: 'fbt-risk-discipline',
    titleFa: 'تنوع‌بخشی چقدر اهمیت دارد؟', titleEn: 'How much does diversification matter?',
    tags: ['تنوع', 'تنوع بخشی', 'پورتفوی', 'همبستگی', 'diversification', 'correlation', 'portfolio', 'allocation'],
    bodyFa: 'تنوع‌بخشی وقتی کار می‌کند که دارایی‌های انتخابی همبستگی کمی داشته باشند. داشتن ده تا آلت‌کوین که همه با بیت‌کوین بالا و پایین می‌روند، تنوع نیست؛ یک موقعیت بزرگ روی بیت‌کوین با ریسک بیشتر است. تنوع واقعی یعنی ترکیب دارایی‌هایی که در شرایط مختلف به شکل متفاوتی عمل می‌کنند، و در کنار آن نگه‌داشتن بخشی در دارایی‌های بی‌ریسک‌تر برای نقدشوندگی و آرامش.',
    bodyEn: 'Diversification only works when the assets you pick are not highly correlated. Holding ten altcoins that all move with Bitcoin is not diversification; it is a bigger Bitcoin position with more fees. Real diversification mixes assets that behave differently under different conditions, alongside holding some in lower-risk assets for liquidity and calm.',
    updatedAt: now()
  },
  {
    id: 'kb.risk.custody-vs-balance', version: 1, category: 'RISK', status: 'verified', confidence: 92,
    source: 'fbt-risk-policy',
    titleFa: 'ریسک نگهداری در صرافی چقدر است؟', titleEn: 'How much risk is there in leaving funds on an exchange?',
    tags: ['صرافی', 'کاستودی', 'نگهداری', 'exchange', 'custody', 'withdrawal', 'برداشت'],
    bodyFa: 'دارایی در صرافی میان‌افزاری است: تا وقتی برداشت نکرده‌اید، کلید نزد صرافی است و صرافی می‌تواند به دلایل فنی، قانونی یا اقتصادی دسترسی را محدود کند. این ریسک برای همه صرافی‌ها و در هر دوره‌ای وجود دارد. راهکار عملی: بخشی که به آن نیاز ندارید را در کیف پول خودتان نگه دارید و فقط مبالغ لازم برای معامله را در صرافی بگذارید. این توصیه عمومی است و به انتخاب صرافی خاصی اشاره ندارد.',
    bodyEn: 'Funds on an exchange are custodial: until you withdraw, the keys sit with the exchange, which can restrict access for technical, legal or economic reasons. That risk exists at every exchange and in every period. The practical answer is to keep the portion you do not need in your own wallet and leave only what you actually trade with on the exchange. This is general guidance and does not endorse any particular venue.',
    updatedAt: now()
  },
  {
    id: 'kb.risk.dca-vs-lump', version: 1, category: 'RISK', status: 'verified', confidence: 91,
    source: 'fbt-risk-discipline',
    titleFa: 'ورود پله‌ای بهتر است یا ورود یکجا؟', titleEn: 'Is dollar-cost averaging better than entering all at once?',
    tags: ['پله ای', 'dca', 'تقسیم', 'ورود', 'average', 'staged', '一次性'],
    bodyFa: 'ورود پله‌ای نوسان قیمت را برای شما هموار می‌کند و فشار روانیِ «الان یا هیچ‌وقت» را برمی‌دارد؛ در عوض اگر بازار یک‌طرفه بالا برود، میانگین ورود شما بدتر از یک ورود کامل می‌شود. ورود یکجا در بازار صعودیِ قطعی بهتر است اما ریسک زمان‌بندی را کامل به شما منتقل می‌کند. راه عملی: اگر مبلغ برای شما بزرگ است و نمی‌خواهید زمان‌بندی را حدس بزنید، تقسیم در چند نوبت بازهٔ زمانی معقول گزینهٔ منطقی‌تری است.',
    bodyEn: 'Staged entry smooths price noise and removes the pressure of an all-or-nothing decision; the trade-off is that if the market rises in one direction your average entry ends up worse than a single entry. A single entry is better in a clearly rising market but pushes all timing risk onto you. Practically: if the amount is large for you and you do not want to guess the timing, splitting it over several rounds across a sensible window is the more reasonable choice.',
    updatedAt: now()
  },
  {
    id: 'kb.risk.why-losses', version: 1, category: 'RISK', status: 'verified', confidence: 94,
    source: 'fbt-risk-policy',
    titleFa: 'چرا اکثر معامله‌گران ضرر می‌کنند؟', titleEn: 'Why do most traders lose money?',
    tags: ['چرا ضرر', 'معامله گر', 'زیاد', 'ضرر می کند', 'why traders lose', 'losses', 'profitable', 'سودده'],
    bodyFa: 'دلایل رایج و قابل‌مشاهده‌اند: اهرم و اندازهٔ موقعیت بیش از حد، نبودِ حد ضرر، ورود در نقطهٔ بد بعد از جهش، هزینه‌های تکرارشونده در بازار پرنوسان، و مهم‌تر از همه **نبودِ پلن خروج پیش از ورود**. بیشتر ضررها نه از بدبختی، بلکه از نداشتن یک قاعدهٔ از پیش تعیین‌شده می‌آید. هیچ استراتژی نوبت‌برند در همهٔ بازارها وجود ندارد و هیچ رباتی نمی‌تواند آینده را بداند.',
    bodyEn: 'The common causes are observable: leverage and oversized positions, no stop loss, entering badly after a move, repeated costs in a volatile market, and above all *no exit plan set before entry*. Most losses come from a missing pre-set rule rather than from bad luck. No strategy wins in every market and no bot can know the future.',
    updatedAt: now()
  },
  {
    id: 'kb.risk.emergency-fund', version: 1, category: 'RISK', status: 'verified', confidence: 90,
    source: 'fbt-risk-discipline',
    titleFa: 'قبل از سرمایه‌گذاری چه ذخیره‌ای داشته باشم؟', titleEn: 'What should I have in reserve before investing?',
    tags: ['ذخیره', 'اضافه', 'صندوق', 'emergency', 'reserve', 'کار', 'هزینه زندگی', 'income'],
    bodyFa: 'پیش از اینکه پولی را وارد بازار کریپتو کنید، هزینه‌های چند ماه آیندهٔ زندگی‌تان باید پشتوانهٔ جداگانه‌ای داشته باشد که به این بازار وابسته نباشد. اگر نوسان بازار مجبورتان کند بفروشید، آن‌وقت دارید در بدترین زمان و با فشار روانی تصمیم گرفته‌اید. پولی را که در کوتاه‌مدت به آن نیاز دارید وارد بازار نکنید.',
    bodyEn: 'Before putting money into the crypto market, the next few months of your living costs should sit in a separate reserve that does not depend on this market. If a market swing forces you to sell, you will be deciding at the worst possible moment under pressure. Do not put money you need in the short term into the market.',
    updatedAt: now()
  },

  /* ======================================================================== */
  /*  TRADING — mechanics of the derivative desks the product actually runs   */
  /* ======================================================================== */
  {
    id: 'kb.trading.funding-rate', version: 1, category: 'TRADING', status: 'verified', confidence: 94,
    source: 'derivatives-onchain-handbook',
    titleFa: 'نرخ تاموینگ (Funding Rate) چیست؟', titleEn: 'What is the funding rate?',
    tags: ['تاموینگ', 'فاندینگ', 'funding', 'نرخ', 'پریمیوم', 'long', 'short', 'کارمزد', 'rate', 'funding rate', 'نرخ تاموینگ', 'perpetual funding'],
    bodyFa: 'نرخ تاموینگ هزینهٔ جبران اختلاف قیمت بین قراردادهای آتی دائمی و قیمت spot است و هر چند ساعت یک‌بار بین خریداران و فروشندگان دائمی جابه‌جا می‌شود. اگر نرخ مثبت باشد، خریداران دائمی بیشتر پرداخت می‌کنند و فروشندگان دریافت؛ اگر منفی باشد، برعکس. پس نگه‌داشتن یک موقعیت در یک سمت، هزینهٔ مستمر دارد — و این هزینه در محاسبهٔ سود شما باید لحاظ شود.',
    bodyEn: 'The funding rate is the cost that equalises perpetual futures with spot, and it moves between long and short holders every few hours. A positive rate means longs pay shorts; a negative rate means the reverse. Holding a position on one side therefore carries a running cost, and that cost belongs in any profit calculation.',
    updatedAt: now()
  },
  {
    id: 'kb.trading.perpetual-vs-spot', version: 1, category: 'TRADING', status: 'verified', confidence: 92,
    source: 'derivatives-onchain-handbook',
    titleFa: 'تفاوت بازار spot و بازار مشتقه (پرپیوال) چیست؟', titleEn: 'What is the difference between spot and perpetual futures?',
    tags: ['spot', 'اسپات', 'پرپیوال', 'پرپریوال', 'فیوچرز', 'مشتقه', 'قرارداد', 'فرق', 'difference', 'perpetual', 'futures', 'derivatives', 'perps', 'futures trading'],
    bodyFa: 'در بازار spot، دارایی را واقعاً می‌خرید و نگه می‌دارید؛ مالکیت و ریسک نگهداری با خودتان است. در قرارداد پرپیوال، شما روی قیمت آینده شرط می‌بندید: مالکیت دارایی منتقل نمی‌شود، اما اهرم، امکان سود و زیان بزرگ، کارمزد تاموینگ و خطر لیکوییدشدن هم اضافه می‌شود. اگر هدف شما نگهداری بلندمدت دارایی است، spot متناسب‌تر است؛ اگر معاملهٔ کوتاه‌مدت با اهرم مدنظر دارید، مشتقه ابزار آن است.',
    bodyEn: 'On spot you actually buy and hold the asset: ownership and holding risk are yours. A perpetual contract is a position on the future price — ownership does not transfer, but leverage, amplified gains and losses, the funding fee and liquidation risk come with it. If your goal is long-term holding, spot fits; if you intend short-term leveraged trading, derivatives are the tool.',
    updatedAt: now()
  },
  {
    id: 'kb.trading.liquidation', version: 1, category: 'TRADING', status: 'verified', confidence: 94,
    source: 'derivatives-onchain-handbook',
    titleFa: 'لیکوییدشدن (Liquidation) چیست و چطور جلویش را بگیرم؟', titleEn: 'What is liquidation and how do you avoid it?',
    tags: ['لیکویید', 'تصفیه', '.margin call', 'liquidation', 'liquidated', 'liquidate', 'margin', 'بسته شدن', 'خودکار'],
    bodyFa: 'وقتی زیان یک موقعیت اهرمی از حد مارجین شما بیشتر شود، صرافی آن را می‌بندد و مارجین باقی‌مانده از دست می‌رود. سه کار بیشترین اثر را دارد: اهرم کمتر، مارجین آزاد کافی، و حد ضرر پیش از رسیدن به نقطهٔ لیکویید. بدانید که نقطهٔ لیکویید با تغییر قیمت و افزایش کارمزد تغییر می‌کند، پس نقطه‌ای را انتخاب نکنید که فقط چند درصد با قیمت فعلی فاصله دارد.',
    bodyEn: 'When the loss on a leveraged position exceeds your margin, the venue closes it and the remaining margin is lost. Three things matter most: lower leverage, enough free margin, and a stop loss placed before the liquidation point is reached. Remember the liquidation point moves with price and with funding costs, so do not pick one that sits only a few percent away.',
    updatedAt: now()
  },
  {
    id: 'kb.trading.open-interest', version: 1, category: 'TRADING', status: 'verified', confidence: 91,
    source: 'derivatives-onchain-handbook',
    titleFa: 'Open Interest و Funding Rate چه می‌گویند؟', titleEn: 'What do open interest and funding rate tell you?',
    tags: ['open interest', 'oi', 'موقعیت باز', 'بازار', 'sentiment', 'crowded', 'تجمع'],
    bodyFa: 'Open Interest تعداد کل قراردادهای باز در بازار است، نه حجم معامله. وقتی قیمت بالا می‌رود و هم‌زمان Open Interest هم بالا می‌رود، پول تازه وارد شده و حرکت پشتوانه دارد. وقتی قیمت بالا می‌رود ولی Open Intelligence کم می‌شود، بیشتر موقعیت‌ها بسته شده‌اند و حرکت می‌تواند نازک‌تر باشد. ترکیب این دو با نرخ تاموینگ، تصویری از این می‌دهد که یک سمت از بازار شلوغ‌تر است — و بازار شلوغ یعنی احتمال شتاب یا اصلاح تند.',
    bodyEn: 'Open interest is the total number of open contracts, not traded volume. When price rises while open interest also rises, fresh money is entering and the move has fuel. When price rises but open interest falls, positions are being closed and the move can be thinner. Read together with funding, these two tell you which side of the market is crowded — and a crowded side means a sharper impulse or a sharper snap-back.',
    updatedAt: now()
  },
  {
    id: 'kb.trading.order-types', version: 1, category: 'TRADING', status: 'verified', confidence: 90,
    source: 'fbt-app',
    titleFa: 'انواع سفارش: بازار، حدی و توقفی چه تفاوتی دارند؟', titleEn: 'How do market, limit and stop orders differ?',
    tags: ['سفارش', 'حدی', 'بازار', 'توقفی', 'limit', 'market order', 'stop', 'order type'],
    bodyFa: 'سفارش بازار فوراً با بهترین قیمت‌های موجود اجرا می‌شود — سریع است ولی قیمت نهایی را شما تعیین نمی‌کنید و ممکن است بدتر از انتظار باشد. سفارش حدی قیمت و مقدار مشخص شما را ثبت می‌کند و فقط وقتی بازار به آن قیمت برسد اجرا می‌شود؛ اگر بازار آن را رد کند، سفارش باز می‌ماند. سفارش توقفی وقتی قیمت از یک آستانه عبور کند فعال می‌شود و برای حد ضرر استفاده می‌شود.',
    bodyEn: 'A market order fills immediately at the best available prices — fast, but you do not set the final price and it can be worse than expected. A limit order records your price and size and only fills if the market reaches it; if the market moves through, the order stays open. A stop order activates once price crosses a threshold and is what a stop loss uses.',
    updatedAt: now()
  },
  {
    id: 'kb.trading.time-in-force', version: 1, category: 'TRADING', status: 'verified', confidence: 88,
    source: 'fbt-app',
    titleFa: 'یک سفارش باز چه مدت باقی می‌ماند؟', titleEn: 'How long does an open order stay valid?',
    tags: ['مدت', 'اعتبار', 'باز', 'سفارش', 'good till', 'gtc', 'ioc', 'expires'],
    bodyFa: 'بستگی به نوع سفارش دارد. «Immediately Or Cancel» فقط در همان لحظه‌ای که ثبت می‌شود معتبر است و هر مقدار باقی‌مانده لغو می‌شود. «Good Till Cancelled» تا وقتی خودتان لغو کنید باز می‌ماند — و در بازارهای کم‌عمق می‌تواند روزها باقی بماند و در نهایت با قیمتی اجرا شود که دیگر منطقی نیست. «Good Till Time» تا یک ساعت مشخص اعتبار دارد.',
    bodyEn: 'It depends on the order type. "Immediately Or Cancel" is only valid at the moment it is placed and the unfilled remainder is cancelled. "Good Till Cancelled" stays open until you cancel it — in thin markets it can sit for days and eventually fill at a price that no longer makes sense. "Good Till Time" stays valid until a set hour.',
    updatedAt: now()
  },

  /* ======================================================================== */
  /*  GENERAL_CRYPTO — the vocabulary the assistant must own                  */
  /* ======================================================================== */
  {
    id: 'kb.general.wallet-vs-account', version: 1, category: 'GENERAL_CRYPTO', status: 'verified', confidence: 94,
    source: 'general-crypto',
    titleFa: 'کیف پول کریپتو دقیقاً چیست؟', titleEn: 'What exactly is a crypto wallet?',
    tags: ['کیف پول', 'wallet', 'آدرس', 'کلید', 'امضا', 'ساخت', 'create wallet', 'address'],
    bodyFa: 'کیف پول یک برنامه نیست که دارایی را نگه دارد؛ مجموعه‌ای از کلیدهای خصوصی است که به آن‌ها آدرس‌های عمومی مربوط است. آدرس عمومی مثل شمارهٔ حساب است: می‌توانید آن را به دیگران بدهید تا برایتان واریز کنند. کلید خصوصی مثل کلید خانه است: هر کسی آن را داشته باشد، اختیار کامل بر پول را دارد. امضای تراکنش با همان کلید خصوصی انجام می‌شود و برای همین است که دارایی شما «در بلاک‌چین» است، نه «در کیف پول».',
    bodyEn: 'A crypto wallet is not an app that holds assets; it is a set of private keys with matching public addresses. A public address is like an account number: you can share it so others can send you funds. A private key is like a house key: whoever holds it has full control of the money. Transaction signing happens with that private key, which is why your assets live "on the blockchain", not "in the wallet".',
    updatedAt: now()
  },
  {
    id: 'kb.general.seed-phrase', version: 1, category: 'GENERAL_CRYPTO', status: 'verified', confidence: 96,
    source: 'fbt-security-policy',
    titleFa: 'عبارت بازیابی ۱۲ یا ۲۴ کلمه‌ای چیست؟', titleEn: 'What is a 12 or 24 word recovery phrase?',
    tags: ['عبارت بازیابی', 'seed', 'mnemonic', 'کلمات', 'بازیابی', 'recovery phrase', '12 words', '24 words'],
    bodyFa: 'این عبارت، همهٔ کلیدهای کیف پول شما را از روی یک کد کوتاه بازسازی می‌کند. به همین دلیل «انسانی‌خوان» است: به‌جای ده‌ها کد طولانی، دوازده کلمهٔ معنادار می‌نویسید که پشتیبان‌گیری و بازیابی را برای انسان ممکن می‌کند. هر کسی که این کلمات را داشته باشد، مالک دارایی است. آن را در هیچ فرم آنلاین، هیچ پشتیبانی و هیچ چتی وارد نکنید.',
    bodyEn: 'That phrase reconstructs every key in your wallet from one short code. That is why it is human-readable: instead of dozens of long codes, you write twelve meaningful words, which makes backup and recovery possible for a person. Whoever holds those words owns the assets. Never enter them into any online form, any support chat, or any chat window.',
    updatedAt: now()
  },
  {
    id: 'kb.general.gas', version: 1, category: 'GENERAL_CRYPTO', status: 'verified', confidence: 93,
    source: 'general-crypto',
    titleFa: 'گس (Gas) چیست و چرا تغییر می‌کند؟', titleEn: 'What is gas, and why does it change?',
    tags: ['گس', 'gas', 'کارمزد شبکه', 'تراکنش', 'سریع', 'ارزان', 'priority', 'fee'],
    bodyFa: 'گس هزینهٔ پردازش تراکنش روی بلاک‌چین است؛ پرداخت آن به اعتبارسنجان شبکه می‌رسد و مستقیماً به حجم ترافیک بستگی دارد. وقتی شبکه شلوغ است، گس بالا می‌رود. کارمزد نهایی از «گس پایه» ضرب در «مقدار گس» به دست می‌آید و خودِ کیف پول یا صرافی معمولاً این دو را جدا نشان می‌دهد. برای تراکنش‌های غیرضروری، ارسال با گس پایین و انتظار برای گنجانده‌شدن در بلاک بعدی می‌تواند بسیار ارزان‌تر باشد.',
    bodyEn: 'Gas is the cost of processing a transaction on the blockchain; it goes to the network validators and rises and falls with traffic. The final fee is the base gas multiplied by the gas amount, and wallets and exchanges usually show those two separately. For non-urgent transactions, sending at a low base fee and waiting for the next block can be far cheaper.',
    updatedAt: now()
  },
  {
    id: 'kb.general.blockchain-why', version: 1, category: 'GENERAL_CRYPTO', status: 'verified', confidence: 93,
    source: 'general-crypto',
    titleFa: 'بلاک‌چین چه چیزی را حل می‌کند؟', titleEn: 'What problem does a blockchain actually solve?',
    tags: ['بلاک چین', 'blockchain', 'دفتر', 'توزیع', 'غیرامانی', 'شفاف', 'ledger', 'decentralized'],
    bodyFa: 'بلاک‌چین یک دفتر کتاب مشترک است که هیچ مرکزی آن را کنترل نمی‌کند. هر تراکنش در بلوکی ثبت می‌شود و زنجیرهٔ بلوک‌ها با رمزنگاری به هم متصل است، پس تغییر یک رکورد قدیمی نیازمند بازسازی همهٔ بلوک‌های بعدی است و عملاً ناممکن می‌شود. نتیجه: دو طرف می‌توانند بدون اعتماد به یک واسطهٔ مرکزی روی یک دفتر مشترک توافق کنند. بهای این توافق، هزینهٔ اجرا (گس) و سرعت نهایی‌شدن است.',
    bodyEn: 'A blockchain is a shared ledger that no single party controls. Each transaction is written into a block and the blocks are linked cryptographically, so altering an old record would mean rebuilding every block after it — practically impossible. The result: two parties can agree on a shared ledger without trusting a central intermediary. The price of that agreement is execution cost (gas) and finality delay.',
    updatedAt: now()
  },
  {
    id: 'kb.general.token-approval', version: 1, category: 'GENERAL_CRYPTO', status: 'verified', confidence: 92,
    source: 'general-crypto',
    titleFa: 'توکن چیست و با دارایی چه فرقی دارد؟', titleEn: 'What is a token, and how is it different from a coin?',
    tags: ['توکن', 'کوین', 'erc20', 'spl', 'token', 'coin', 'asset', 'دارایی'],
    bodyFa: '«کوین» بومی همان بلاک‌چین است: بیت‌کوین روی بیت‌کوین، سول روی سولانا. «توکن» روی یک بلاک‌چین موجود دیگر ساخته می‌شود و ارزشش از دو منبع می‌آید: یا پشتوانه‌ای دارد (مثل استیبل‌کوین) یا کاربردی که تقاضا برایش می‌سازد. هر دو روی یک بلاک‌چین «دفتر» یکسان دارند، ولی قوانین، ابزار و ریسکشان متفاوت است.',
    bodyEn: 'A "coin" is native to its own chain: Bitcoin on Bitcoin, SOL on Solana. A "token" is issued on top of someone else\'s chain and derives its value from one of two sources: it is backed by something (like a stablecoin), or it has a use that creates demand for it. Both live on the same kind of ledger, but their rules, tooling and risks differ.',
    updatedAt: now()
  },
  {
    id: 'kb.general.nft', version: 1, category: 'GENERAL_CRYPTO', status: 'verified', confidence: 90,
    source: 'general-crypto',
    titleFa: 'NFT چیست و چه چیزی را نشان می‌دهد؟', titleEn: 'What is an NFT, and what does it actually represent?',
    tags: ['nft', 'توکن', 'غیرقابل', 'مالکیت', 'هنر', 'unique', 'erc721', 'erc1155'],
    bodyFa: 'NFT یک توکن یکتا (یا نیمه‌یکتا) روی بلاک‌چین است که به یک آیتم اشاره می‌کند. آنچه در خود توکن ثبت می‌شود مالکیتِ آن رکورد است، نه فایل تصویر. نکتهٔ مهم: خرید NFT معمولاً حق استفاده از محتوا را منتقل نمی‌کند و حق‌های copyright هم‌چنان نزد سازنده می‌ماند، مگر آنکه در شرایط پروژه خلافش نوشته شده باشد. پس «داشتن NFT» با «مالکیت اثر» یکی نیست.',
    bodyEn: 'An NFT is a unique (or semi-unique) token on a blockchain that points at an item. What is recorded in the token is ownership of that record, not the image file. An important detail: buying an NFT usually does not transfer copyright or usage rights — those stay with the creator unless the project says otherwise. So "owning an NFT" and "owning the work" are not the same thing.',
    updatedAt: now()
  },
  {
    id: 'kb.general.bridges', version: 1, category: 'GENERAL_CRYPTO', status: 'verified', confidence: 91,
    source: 'general-crypto',
    titleFa: 'پل (Bridge) بین شبکه‌ها چیست؟ چگونه کار می‌کند؟', titleEn: 'What is a bridge? How bridges between chains work',
    tags: ['پل', 'بریج', 'bridge', 'bridges', 'شبکه', 'zksync', 'پولش', 'lock', 'mint', 'what is a bridge', 'cross chain', 'پل چیست', 'cross-chain bridge'],
    bodyFa: 'پل دارایی را در شبکهٔ مبدأ قفل یا می‌سوزاند و معادلش را در شبکهٔ مقصد ضرب (mint) می‌کند. دو مدل اصلی وجود دارد: پل‌های اعتمادی که به یک مجموعه یا نگهبان بستگی دارند، و پل‌های بدون اعتماد که با رمزنگاری و اثبات خود کار می‌کنند. ریسک اصلی هر دو یکی است: اگر دارایی در یک سمت قفل شود ولی در سمت دیگر ضرب نشود (یا برعکس)، ارزش از بین می‌رود. پل‌های بدون اعتماد این ریسک را با قراردادهای هوشمند و proofs کم می‌کنند ولی آن را صفر نمی‌کنند.',
    bodyEn: 'A bridge locks or burns the asset on the source chain and mints the equivalent on the destination chain. Two main designs exist: trusted bridges that depend on a set or a custodian, and trustless bridges that rely on cryptography and proofs. The core risk is the same for both — if the asset is locked on one side but not minted on the other (or vice versa), value disappears. Trustless bridges reduce that risk with smart contracts and proofs, but do not eliminate it.',
    updatedAt: now()
  },
  {
    id: 'kb.general.erc20-vs-native', version: 1, category: 'GENERAL_CRYPTO', status: 'verified', confidence: 90,
    source: 'general-crypto',
    titleFa: 'توکن ERC-20 و کوین بومی چه تفاوتی دارند؟', titleEn: 'How do ERC-20 tokens differ from native coins?',
    tags: ['erc20', 'erc-721', 'بومی', 'native', 'اتریوم', 'استاندارد', 'contract'],
    bodyFa: 'کوین بومی مثل ETH خودش پروتکل بلاک‌چین است و برای کارمزد شبکه لازم است. توکن ERC-20 یک قرارداد هوشمند روی همان بلاک‌چین است؛ برای انتقالش همان ETH به‌عنوان گس لازم است، ولی خودش ارزش مستقلی دارد که از بازار می‌آید. نتیجهٔ عملی: «داشتن توکن» و «داشتن ارز شبکه» دو چیز جدا هستند و برای یک تراکنش معمولاً هر دو لازم‌اند.',
    bodyEn: 'A native coin like ETH is the protocol itself and is what pays network fees. An ERC-20 token is a smart contract on that same chain; moving it still requires ETH for gas, but its own value comes from the market. The practical consequence: "holding the token" and "holding the network asset" are two separate things, and an ordinary transaction generally needs both.',
    updatedAt: now()
  },
  {
    id: 'kb.general.mvrv-usage', version: 1, category: 'GENERAL_CRYPTO', status: 'verified', confidence: 92,
    source: 'onchain-valuation-standard',
    titleFa: 'MVRV را چگونه در عمل استفاده کنم؟', titleEn: 'How do I actually use MVRV?',
    tags: ['mvrv', 'نسبت', 'ارزش بازار', 'واقعی', 'ratio', 'market value', 'realized', 'تحلیل'],
    bodyFa: 'MVRV نسبت ارزش کل بازار به ارزش واقعی (میانگین بهای پول‌های جابه‌جا‌شده) است. وقتی این نسبت بالاست، یعنی قیمت‌ها نسبت به میانگین بهایی که دارندگان فعلی پرداخته‌اند گران‌اند؛ تاریخاً این نواحی با اصلاح‌های عمیق همراه بوده‌اند. وقتی نزدیک ۱ است، یعنی بازار تقریباً هم‌قیمت میانگین بهای دارندگان است. نکتهٔ مهم: MVRV یک شاخص توصیفی است، نه سیگنال ورود و خروج؛ همیشه در کنار ساختار بازار و نقدینگی خوانده می‌شود.',
    bodyEn: 'MVRV is total market value divided by realised value (the average price of coins that have moved). When the ratio is high, price is expensive relative to what current holders paid; historically those zones have come with deep drawdowns. Near 1, the market trades roughly at the average cost of holders. Importantly, MVRV is a descriptive ratio, not an entry or exit signal; read it alongside market structure and liquidity.',
    updatedAt: now()
  },
  {
    id: 'kb.general.exchange-types', version: 1, category: 'GENERAL_CRYPTO', status: 'verified', confidence: 91,
    source: 'general-crypto',
    titleFa: 'صرافی متمرکز و غیرامانی چه تفاوتی دارند؟', titleEn: 'How do centralised and decentralised exchanges differ?',
    tags: ['صرافی', 'متمرکز', 'cex', 'dex', 'غیرامانی', 'centralised', 'decentralised', 'order book'],
    bodyFa: 'صرافی متمرکز (CEX) سفارش‌های شما را در یک دفتر سفارش نگه می‌دارد و خودش طرف مقابل معامله می‌شود؛ سرعت و عمق بیشتر، ریسک نگهداری دارایی نزد صرافی. صرافی غیرامانی (DEX) با قرارداد هوشمند کار می‌کند: دارایی نزد شما می‌ماند و شما خودتان امضا می‌کنید، در عوض هزینهٔ گس، ریسک قرارداد و گاهی تأخیر. انتخاب بین این دو یک بده‌بستان بین راحتی و کنترل است.',
    bodyEn: 'A centralised exchange keeps your orders in its own order book and is the counterparty itself: more speed and depth, with the custody risk of leaving assets on the venue. A decentralised exchange runs through smart contracts: assets stay with you and you sign yourself, at the cost of gas, contract risk and sometimes latency. Choosing between them trades convenience against control.',
    updatedAt: now()
  },
  {
    id: 'kb.general.dusting', version: 1, category: 'GENERAL_CRYPTO', status: 'verified', confidence: 88,
    source: 'general-crypto',
    titleFa: 'پیام‌های تراکنش جعلی (Dusting) چیست؟', titleEn: 'What is dusting, and why is my wallet full of tiny transactions?',
    tags: ['dusting', 'غبار', 'تراکنش', 'جعل', 'small', 'spam', 'پیام'],
    bodyFa: 'گاهی کیف پول شما تراکنش‌های بسیار کوچک ناشناس می‌بیند. این کار معمولاً برای آن است که آدرس شما را ردیابی کنند و شما را به یک وب‌سایت مخرب هدایت کنند. این تراکنش‌ها بی‌خطرند تا وقتی خودتان آن‌ها را امضا نکنید. خطر در همین‌جاست: هرگز برای «بررسی» یا «پاک‌کردن» یکی از این تراکنش‌ها را امضا نکنید.',
    bodyEn: 'Sometimes your wallet shows tiny anonymous transactions. This is usually an attempt to fingerprint your address and lure you to a malicious site. The transactions themselves are harmless until you sign them. That is exactly the danger: never sign one of these, even to "check" or "clear" it.',
    updatedAt: now()
  },

  /* ======================================================================== */
  /*  SOLANA — chain-specific questions the assistant keeps getting          */
  /* ======================================================================== */
  {
    id: 'kb.solana.fees', version: 1, category: 'SOLANA', status: 'verified', confidence: 93,
    source: 'general-crypto',
    titleFa: 'کارمزد تراکنش در سولانا چقدر است؟', titleEn: 'How much do Solana transactions cost?',
    tags: ['سولانا', 'کارمزد', 'گس', 'ارزان', 'sol', 'lamport', 'fee', 'cheap'],
    bodyFa: 'سولانا به‌خاطر معماری موازی، کارمزد بسیار پایینی دارد: کارمزد پایهٔ هر تراکنش تقریباً ۰٫۰۰۰۰۰۵ دلار است و با افزایش اولویت (Priority Fee) بالا می‌رود. برای کاربر معمولی یعنی چند سِنت یا کمتر. همین ترکیبِ ارزانی و سرعت بالا باعث شده تعداد تراکنش‌ها روی سولانا به‌مراتب بیشتر از شبکه‌های نسل اول باشد، و همین تعداد زیاد هم هزینهٔ واقعی پنهان را بالا می‌برد.',
    bodyEn: 'Because of its parallel architecture, Solana carries very low fees: the base fee is roughly $0.000005 per transaction and rises with the priority fee. For an ordinary user that means cents or less. This combination of cheapness and speed is why Solana carries far more transactions than first-generation chains — and that transaction volume is itself a hidden real cost.',
    updatedAt: now()
  },
  {
    id: 'kb.solana.speed', version: 1, category: 'SOLANA', status: 'verified', confidence: 92,
    source: 'general-crypto',
    titleFa: 'چرا سولانا سریع است؟', titleEn: 'Why is Solana fast?',
    tags: ['سولانا', 'سرعت', 'blocktime', 'معماری', 'pda', 'parallel', 'fast', 'throughput'],
    bodyFa: 'سولانا تراکنش‌ها را موازی پردازش می‌کند: اعتبارسنجی به‌جای پردازش همه به ترتیب، می‌توانند بخش‌های مستقل یک بلوک را هم‌زمان اجرا کنند. به همین دلیل زمان نهایی‌شدن یک بلوک حدود ۴۰۰ میلی‌ثانیه است، در حالی که زمان تولید بلوک لزوماً کوتاه نیست. این سرعت برای کاربردهایی مثل معاملات پرFrequncy و بازی ضروری است، اما در مقابل یعنی ازدحام هم سریع‌تر رخ می‌دهد.',
    bodyEn: 'Solana processes transactions in parallel: validators can execute independent parts of a block at the same time rather than strictly in sequence. That is why finality lands around 400 milliseconds, even though the block time itself is not short. That speed matters for high-frequency trading and gaming — and it also means congestion arrives just as fast.',
    updatedAt: now()
  },
  {
    id: 'kb.solana.jito-priority', version: 1, category: 'SOLANA', status: 'verified', confidence: 89,
    source: 'general-crypto',
    titleFa: 'چرا تراکنش سولانا من گاهی رد می‌شود؟', titleEn: 'Why does my Solana transaction sometimes fail?',
    tags: ['سولانا', 'رد', 'شکست', 'blockhash', 'جیتو', 'first', 'failed', 'priority'],
    bodyFa: 'رایج‌ترین دلیل، منقضی‌شدن «Blockhash» است: سولانا تراکنش تا مدت کوتاهی معتبر است و اگر در آن پنجره زنجیره جلو نرود، تراکنش رد می‌شود. راه‌حل ساده این است که تراکنش را در لحظهٔ آخر بسازید و بلافاصله ارسال کنید، نه اینکه از قبل آماده و ذخیره شده باشد. اگر تراکنش شما اولویت پایینی دارد، ارسال آن با کارمزد اولویت (Priority Fee) کمک می‌کند زودتر در یک بلوک جا بگیرد.',
    bodyEn: 'The most common cause is the blockhash going stale: a Solana transaction is valid only for a short window, and if the chain does not advance in time it is rejected. The practical fix is to build the transaction at the last moment and submit it immediately rather than preparing and storing it in advance. If your transaction has a low priority, paying a priority fee helps it get included sooner.',
    updatedAt: now()
  },
  {
    id: 'kb.solana.dex-vs-cex', version: 1, category: 'SOLANA', status: 'verified', confidence: 90,
    source: 'general-crypto',
    titleFa: 'جیتو (Jito) و فرستندهٔ تراکنش چیست؟', titleEn: 'What are Jito and transaction senders on Solana?',
    tags: ['جیتو', 'jito', 'ارسال', 'فرستنده', 'rpc', 'sender', 'tip', 'بسته'],
    bodyFa: 'در سولانا تراکنش‌ها از طریق یک RPC یا «فرستنده» ثبت می‌شوند. فرستنده‌هایی مثل Jito تراکنش‌ها را در «بسته» (bundle) گروه‌بندی می‌کنند و با پرداخت انگیزه (tip) به اعتبارسنجی‌ها، احتمال گنجانده‌شدن در بلوک بعدی را بالا می‌برند. این کار روی کاربردهایی مثل معاملات سریع اهمیت دارد، چون در غیر این صورت تراکنش ممکن است چند بلوک معطل بماند یا اصلاً اجرا نشود.',
    bodyEn: 'On Solana transactions are submitted through an RPC or a "sender". Senders such as Jito group transactions into bundles and tip validators, which raises the chance of inclusion in the next block. This matters for time-sensitive applications: otherwise a transaction can sit for several blocks or never land at all.',
    updatedAt: now()
  },
  {
    id: 'kb.solana.pda', version: 1, category: 'SOLANA', status: 'verified', confidence: 88,
    source: 'general-crypto',
    titleFa: 'PDA در سولانا چیست؟', titleEn: 'What is a PDA on Solana?',
    tags: ['pda', 'برنامه', 'امضا', 'حساب', 'program derived', 'authority', 'دسترسی'],
    bodyFa: 'PDA یا «حساب مشتق‌شده از برنامه» یک آدرس است که روی بلاک‌چین وجود ندارد ولی توسط یک برنامه کنترل می‌شود و هیچ کلید خصوصی ندارد. کاربرد آن این است که برنامه‌ها بتوانند حساب‌هایی بسازند که فقط خودِ برنامه می‌تواند امضا کند — بدون نیاز به کلید کاربر. به همین دلیل وقتی با یک برنامهٔ ناشناخته کار می‌کنید، امضاهای PDA را با دقت بخوانید؛ آن امضا اجازهٔ کنترل آن حساب را به برنامه می‌دهد.',
    bodyEn: 'A PDA — a program-derived address — is an address that does not exist on-chain in the normal sense but is controlled by a program and has no private key. It lets programs own accounts only they can sign for, without needing a user key. That is why you should read PDA signatures carefully when interacting with an unfamiliar program: such a signature hands that account’s control to the program.',
    updatedAt: now()
  },

  /* ======================================================================== */
  /*  SIGNALS / SMART_MONEY — how the product's own features are described     */
  /* ======================================================================== */
  {
    id: 'kb.signals.not-advice', version: 1, category: 'SIGNALS', status: 'verified', confidence: 94,
    source: 'fbt-app',
    titleFa: 'سیگنال‌ها چقدر قابل اتکا هستند؟', titleEn: 'How reliable are the signals?',
    tags: ['سیگنال', 'دقت', 'قابل', 'اعتماد', 'برنده', 'signal', 'accuracy', 'hit rate', 'reliability'],
    bodyFa: 'سیگنال‌ها یک دید محاسباتی از داده‌های بازار و آن‌چین هستند، نه پیش‌بینی. FBT نرخ موفقیت گذشتهٔ هر سیگنال را نشان می‌دهد تا خودتان قضاوت کنید، و سیگنال‌های تازه با سابقهٔ کوتاه ممکن است در ابتدا نرخ موفقیت ظاهری بالایی داشته باشند که با گذشت زمان و نمونهٔ بزرگ‌تر واقعی می‌شود. هیچ سیگنالی جای تصمیم خودتان را نمی‌گیرد؛ همان قاعدهٔ همیشگی: تصمیم با شماست.',
    bodyEn: 'Signals are a computational view of market and on-chain data, not a prediction. FBT shows each signal\'s historical hit rate so you can judge it yourself, and a new signal may start with a flattering short-sample record that settles down as the sample grows. No signal replaces your own decision; the standing rule holds — the decision is yours.',
    updatedAt: now()
  },
  {
    id: 'kb.signals.how-generated', version: 1, category: 'SIGNALS', status: 'verified', confidence: 91,
    source: 'fbt-app',
    titleFa: 'سیگنال‌ها چطور ساخته می‌شوند؟', titleEn: 'How are the signals generated?',
    tags: ['ساخت', 'روش', 'محاسبه', 'منبع', 'generate', 'method', 'data', 'indicator', 'signal source'],
    bodyFa: 'هر سیگنال از یک مجموعه دادهٔ مشخص (قیمت، حجم، داده‌های آن‌چین، جریان شبکه) و یک قاعدهٔ محاسباتی مشخص ساخته می‌شود و همیشه شرط ورود و شرط خروج و بازهٔ زمانی خود را همراه دارد. یعنی سیگنال یک «ایدهٔ مبهم» نیست: اگر شرط‌ها را نپسندید، همان‌جا ردش کنید. مهم‌تر اینکه سیگنال‌ها بر پایهٔ داده‌های تاریخی ساخته شده‌اند، نه بر پایهٔ آینده.',
    bodyEn: 'Each signal is built from a defined data set (price, volume, on-chain data, network flow) and a defined computational rule, and it always carries its entry condition, exit condition and time window. A signal is not a vague idea: if you do not like the conditions, reject it right there. More importantly, signals are built on historical data, not on the future.',
    updatedAt: now()
  },
  {
    id: 'kb.smartmoney.what-tracked', version: 1, category: 'SMART_MONEY', status: 'verified', confidence: 91,
    source: 'fbt-app',
    titleFa: 'اسمارت مانی دقیقاً چه چیزی را دنبال می‌کند؟', titleEn: 'What exactly does smart money track?',
    tags: ['اسمارت مانی', 'کیف پول', 'ردیابی', 'smart money', 'whale', 'نهنگ', 'wallet tracking'],
    bodyFa: 'اسمارت مانی کیف پول‌هایی را دنبال می‌کند که در تاریخچهٔ آن‌ها رفتار موفقی دیده شده — مثلاً ورودهای به‌موقع در بازارهای صعودی یا خروج‌های درست. این «برچسب» بر پایهٔ رفتار تاریخی همان کیف پول زده می‌شود، نه بر پایهٔ هویت. محدودیت مهم: یک کیف پول برچسب‌خورده هم می‌تواند اشتباه کند، و همهٔ کیف پول‌های موفق برچسب نمی‌گیرند. اسمارت مانی یک ورودی تحلیل است، نه یک سیگنال معامله.',
    bodyEn: 'Smart money follows wallets whose history shows success — for example entries that were well timed in rising markets or exits that were well timed. The label is applied from that wallet\'s behavioural history, not from an identity. Two important limits: a labelled wallet can still be wrong, and not every successful wallet gets labelled. Smart money is an analytical input, not a trade signal.',
    updatedAt: now()
  },
  {
    id: 'kb.smartmoney.limitations', version: 1, category: 'SMART_MONEY', status: 'verified', confidence: 90,
    source: 'fbt-app',
    titleFa: 'اسمارت مانی چه محدودیت‌هایی دارد؟', titleEn: 'What are the limits of smart-money tracking?',
    tags: ['محدودیت', 'خطا', 'تایم', 'همبستگی', 'limitations', 'lag', 'correlation', 'copy'],
    bodyFa: 'سه محدودیت را باید بدانید: (۱) تأخیر — وقتی یک کیف پول بزرگ وارد می‌شود، شما معمولاً بعد از حرکت قیمت خبردار می‌شوید؛ (۲) هم‌بستگی — چند کیف پول برچسب‌خورده ممکن است در واقع یک سرمایه‌گذار باشند، پس «همه موافق‌اند» معنیِ استقلال رأی ندارد؛ (۳) تغییر رفتار — کیف پولی که تا امروز خوب بوده ممکن است استراتژی‌اش را عوض کند. به همین دلیل اسمارت مانی را به‌عنوان یک ورودی در کنار بقیهٔ تحلیل استفاده کنید.',
    bodyEn: 'Three limits matter: (1) lag — by the time a large wallet enters, price has usually already moved; (2) correlation — several labelled wallets may really be one investor, so "they all agree" does not mean independent opinions; (3) behaviour change — a wallet that has been good until today may switch strategy. Treat smart money as one input alongside the rest of your analysis.',
    updatedAt: now()
  },

  /* ======================================================================== */
  /*  INTENT_OS — how the assistant itself works                               */
  /* ======================================================================== */
  {
    id: 'kb.intentos.data-sources', version: 1, category: 'INTENT_OS', status: 'verified', confidence: 92,
    source: 'fbt-ai-upgrade5',
    titleFa: 'دستیار هوشمند با چه داده‌ای کار می‌کند؟', titleEn: 'What data does the AI assistant work from?',
    tags: ['داده', 'منبع', 'زنده', 'دقت', 'data', 'live', 'source', 'accuracy', 'grounding'],
    bodyFa: 'دستیار Intent AI روی چهار لایه کار می‌کند: دادهٔ زندهٔ بازار (قیمت و تغییرات در لحظه، که بر حافظهٔ مدل اولویت دارد)، دادهٔ آن‌چین، دانش داخلیِ تأییدشدهٔ FBT، و در صورت نیاز جست‌وجوی وب. قیمت‌ها همیشه از ابزار زنده می‌آیند، نه از حافظهٔ مدل — به همین دلیل اگر قیمت لحظه‌ای در دسترس نباشد، دستیار صریح می‌گوید که دادهٔ زنده ندارد، به‌جای اینکه عددی را از حفظ بگوید.',
    bodyEn: 'The Intent AI assistant works on four layers: live market data (prices and moves in the moment, which take priority over model memory), on-chain data, FBT\'s own verified internal knowledge, and web search when needed. Prices always come from the live tool rather than the model\'s memory — which is why, when live data is unavailable, the assistant says so explicitly instead of quoting a remembered number.',
    updatedAt: now()
  },
  {
    id: 'kb.intentos.honesty', version: 1, category: 'INTENT_OS', status: 'verified', confidence: 96,
    source: 'fbt-ai-upgrade5',
    titleFa: 'دستیار چطور از ساختن عدد مطمئن می‌شود؟', titleEn: 'How does the assistant avoid inventing numbers?',
    tags: ['دقت', 'صداقت', 'جعل', 'عدد', 'تخیل', 'hallucination', 'honest', 'fabricate', 'made up'],
    bodyFa: 'چند سد وجود دارد: هر عددی که در پاسخ می‌آید باید در دادهٔ ارائه‌شده (بازار، ابزار، دانش) قابل ردیابی باشد؛ اگر عددی در شواهد نباشد، یک مرحلهٔ بررسی آن را علامت می‌زند؛ و یک نقش «تأییدکننده» سعی می‌کند پاسخ را نقض کند. نتیجهٔ عملی: اگر دستیار عددی ندارد، باید صریح بگوید که ندارد — و این رفتار عمدی است، نه ضعف.',
    bodyEn: 'Several barriers stand in the way: every number in an answer must be traceable to the supplied evidence (market, tools, knowledge); a number that is not in the evidence is flagged by a review pass; and a dedicated verification role tries to break the answer. The practical result: when the assistant does not have a number it must say so plainly — that behaviour is deliberate, not a weakness.',
    updatedAt: now()
  },
  {
    id: 'kb.intentos.uncertainty', version: 1, category: 'INTENT_OS', status: 'verified', confidence: 92,
    source: 'fbt-ai-upgrade5',
    titleFa: 'چرا دستیار می‌گوید «قطعی نیست»؟', titleEn: 'Why does the assistant say it cannot be certain?',
    tags: ['قطعیت', 'اطمینان', 'عدم قطعیت', 'uncertainty', 'certainty', 'محتاط', 'conservative'],
    bodyFa: 'بازار کریپتو ذاتاً پیش‌بینی‌ناپذیر است و هیچ مدل زبانی — هرچقدر هم قوی — توان دیدن آینده را ندارد. دستیار برای هر بخش از پاسخ میزان اطمینان را جداگانه گزارش می‌کند و جایی که پیش‌بینی است، آن را صریحاً به‌عنوان پیش‌بینی علامت می‌زند. این سخت‌گیری عمدی است: یک پاسخِ «با اطمینان ولی غلط» از یک پاسخِ «محتاط ولی صادق» بدتر است، چون اولی اعتماد شما را خرج یک عدد غلط می‌کند.',
    bodyEn: 'The crypto market is inherently unpredictable and no language model — however strong — can see the future. The assistant reports confidence per section of the answer and explicitly labels anything forward-looking as a forecast. That strictness is deliberate: a confident wrong answer is worse than a cautious honest one, because the first spends your trust on a bad number.',
    updatedAt: now()
  },
  {
    id: 'kb.intentos.limitations', version: 1, category: 'INTENT_OS', status: 'verified', confidence: 93,
    source: 'fbt-ai-upgrade5',
    titleFa: 'دستیار هوشمند چه کارهایی را از پس درمی‌آورد؟', titleEn: 'What can the AI assistant actually not do?',
    tags: ['محدودیت', 'نمیتواند', 'توانایی', 'unable', 'cannot', 'limitation', 'capability'],
    bodyFa: 'دستیار نمی‌تواند به کیف پول شما دسترسی بگیرد، به‌جای شما معامله نکند، قیمت آینده را پیش‌بینی نکند، یا در داده‌ای که در دسترس ندارد عددی نسازد. همچنین در بازارهای تازه یا توکن‌هایی که هنوز دادهٔ کافی ندارند، تحلیل او ضعیف‌تر از یک دارایی شناخته‌شده است. اگر پاسخی در این حالت بدهید، کم‌اطمینانی‌اش در خودِ پاسخ مشخص است.',
    bodyEn: 'The assistant cannot access your wallet, cannot trade on your behalf, cannot forecast future prices, and cannot manufacture a number it does not have. It is also weaker on brand-new markets or tokens without enough data than on well-known assets. When that is the case, the reduced confidence is visible in the answer itself.',
    updatedAt: now()
  },

  /* ======================================================================== */
  /*  PRODUCT — the product's own surfaces, kept truthful                      */
  /* ======================================================================== */
  {
    id: 'kb.product.portfolio', version: 1, category: 'PRODUCT', status: 'verified', confidence: 92,
    source: 'fbt-app',
    titleFa: 'پرتفوی چه چیزی را نشان می‌دهد؟', titleEn: 'What does the portfolio show?',
    tags: ['پرتفوی', 'دارایی', 'موجودی', 'portfolio', 'balance', 'holdings', 'ارزش'],
    bodyFa: 'پرتفوی دارایی‌هایی را که در کیف پول متصل خود دارید نشان می‌دهد: موجودی هر دارایی، ارزش آن به دلار یا ارزش فیات، و سهم هر دارایی از کل. این داده‌ها از روی زنجیره خوانده می‌شود، بنابراین منبع حقیقت خود بلاک‌چین است. اگر اتصال کیف پول قطع شود، پرتفوی خالی نشان داده می‌شود، نه دادهٔ ذخیره‌شدهٔ قدیمی.',
    bodyEn: 'The portfolio shows the assets in your connected wallet: the balance of each asset, its fiat value, and each asset\'s share of the total. The data is read from chain, so the blockchain itself is the source of truth. If the wallet connection drops, the portfolio shows empty rather than stale cached data.',
    updatedAt: now()
  },
  {
    id: 'kb.product.earn', version: 1, category: 'PRODUCT', status: 'verified', confidence: 90,
    source: 'fbt-app',
    titleFa: 'بخش کسب درآمد چیست؟ استیکینگ و فارم', titleEn: 'What is the earn section? Staking and farming',
    tags: ['درآمد', 'Earn', 'استیک', 'staking', 'سود', 'yield', 'استیکینگ', '-passive', 'farming', 'farm', 'apy', 'apr', 'passive income', 'کسب سود', 'درآمدزایی', 'فارم', 'فارمینگ', 'استخر', 'سرمایه گذاری در فارم', 'درآمد غیرفعال', 'how to stake', 'staking works', 'earn section', 'بخش درآمد', 'how does staking work', 'staking', 'چطور استیک کنم', 'استیک چیست'],
    bodyFa: 'بخش Earn جاهایی را نشان می‌دهد که می‌توانید دارایی را در آن بگذارید تا سود بگیرید — مانند استیکینگ یا استخرهای نقدینگی. برای هر گزینه، نرخ، نوع ریسک و مدت زمان قفل‌شدن نمایش داده می‌شود. پیش از واریز، بخش ریسک همان صفحه را بخوانید؛ سود بالا معمولاً دلیل ریسک بالا هم هست.',
    bodyEn: 'The Earn section lists places where you can place assets to earn — such as staking or liquidity pools. Each option shows its rate, its risk type and any lock-up period. Read the risk section on that page before depositing: high yield usually means high risk too.',
    updatedAt: now()
  },
  {
    id: 'kb.product.signals-page', version: 1, category: 'PRODUCT', status: 'verified', confidence: 89,
    source: 'fbt-app',
    titleFa: 'بخش سیگنال‌ها چه چیزی را نشان می‌دهد؟', titleEn: 'What does the signals page show?',
    tags: ['سیگنال', 'صفحه', 'فهرست', 'نرخ موفقیت', 'signal', 'list', 'hit rate', 'باز', 'فعال'],
    bodyFa: 'فهرست سیگنال‌های فعال با نوع دارایی، جهت، نرخ موفقیت تاریخی و زمان ثبت. سیگنال‌هایی که تازه فعال شده‌اند سابقهٔ کوتاهی دارند و نرخ موفقیتشان با نمونهٔ بزرگ‌تر تغییر می‌کند؛ بنابراین آن‌ها را با احتیاط بیشتری وزن بدهید. هر سیگنال شرط ورود و خروج خودش را دارد.',
    bodyEn: 'A list of active signals with the asset, the direction, the historical hit rate and when it was logged. Newly activated signals have a short record and their hit rate moves as the sample grows, so weight them more cautiously. Every signal carries its own entry and exit conditions.',
    updatedAt: now()
  },
  {
    id: 'kb.product.security-page', version: 1, category: 'PRODUCT', status: 'verified', confidence: 93,
    source: 'fbt-app',
    titleFa: 'چه چیزی دربارهٔ امنیت FBT می‌توانم بدانم؟', titleEn: 'What do I know about FBT security?',
    tags: ['امنیت', 'تضمین', 'بیمه', 'audit', 'security', 'insured', 'safeguard', 'bug bounty'],
    bodyFa: 'بخش امنیت سایت وضعیت اقدامات امنیتی FBT را توضیح می‌دهد: کیف پول غیرامانی، بررسی کد، و هر پوشش بیمه‌ای یا برنامهٔ شکار باگی که وجود دارد. توجه کنید که این‌ها دربارهٔ خودِ پلتفرم و زیرساخت آن است و هیچ‌کدام ریسک بازار یا ریسک قراردادهای هوشمندی که خودتان واردشان می‌شوید را حذف نمی‌کند. امنیت یک فرایند است، نه یک وضعیت دائمی.',
    bodyEn: 'The site\'s security section explains FBT\'s security posture: a non-custodial wallet, code review, and any insurance cover or bug-bounty programme that exists. Note that these concern the platform and its own infrastructure, and none of them remove market risk or the risk of the smart contracts you enter yourself. Security is a process, not a permanent state.',
    updatedAt: now()
  },
  {
    id: 'kb.product.derivatives', version: 1, category: 'PRODUCT', status: 'verified', confidence: 91,
    source: 'fbt-app',
    titleFa: 'بخش مشتقه‌ها چه بازارهایی دارد؟', titleEn: 'Which markets are in the derivatives section?',
    tags: ['مشتقه', 'futures', 'پرپیوال', 'اهرم', 'derivatives', 'perps', 'بازار', 'desk'],
    bodyFa: 'بخش مشتقه‌ها بازارهای آتی دائمی را برای دارایی‌های اصلی نمایش می‌دهد و امکان باز کردن موقعیت با اهرم را می‌دهد. هر موقعیت یک نقطهٔ لیکوییدشدن، نرخ تاموینگ و کارمزد صرافی دارد که پیش از تأیید نمایش داده می‌شود. این ابزار برای معامله‌گر است، نه برای نگهداری؛ برای نگهداری بلندمدت، spot ابزار متناسب‌تری است.',
    bodyEn: 'The derivatives section lists perpetual futures for major assets and allows opening a leveraged position. Every position shows a liquidation point, a funding rate and the venue fee before you confirm. This is a tool for traders, not for holding; for long-term holding, spot is the more appropriate instrument.',
    updatedAt: now()
  },
  {
    id: 'kb.product.insurance', version: 1, category: 'PRODUCT', status: 'verified', confidence: 89,
    source: 'fbt-app',
    titleFa: 'بخش بیمه چه پوششی می‌دهد؟', titleEn: 'What does the insurance section cover?',
    tags: ['بیمه', 'insurance', 'پوشش', 'خطر', 'cover', 'protect', 'shield'],
    bodyFa: 'بخش بیمه فهرستی از پوشش‌های موجود برای دارایی‌های دیجیتال و شرایط آن‌هاست: کدام دارایی پوشش دارد، تا چه سقفی، و در چه شرایطی پرداخت انجام می‌شود. بیمهٔ دارایی دیجیتال معمولاً استثناهای مهمی دارد (مثلاً هک پروتکل یا مشکل صرافی) و همیشه باید متن شرایط را بخوانید. پوشش بیمه یک لایهٔ کمکی است، نه جایگزین مدیریت ریسک.',
    bodyEn: 'The insurance section lists available covers for digital assets and their conditions: which asset is covered, up to what limit, and in what circumstances a payout is made. Crypto insurance usually carries important exclusions (a protocol hack or an exchange problem, for instance), so always read the terms. A cover is a helpful layer, not a replacement for risk management.',
    updatedAt: now()
  },
  {
    id: 'kb.product.support-contact', version: 1, category: 'PRODUCT', status: 'verified', confidence: 91,
    source: 'fbt-app',
    titleFa: 'چطور با پشتیبانی FBT تماس بگیرم؟', titleEn: 'How do I contact FBT support?',
    tags: ['پشتیبانی', 'تماس', 'کمک', 'support', 'contact', 'help', 'تیکت', 'ticket'],
    bodyFa: 'از صفحهٔ تماس در سایت می‌توانید پیام بگذارید و تیکت ثبت کنید؛ برای گزارش مشکل فنی، شناسهٔ تراکنش (Transaction Hash) را همراه داشته باشید تا سریع‌تر پیگیری شود. پشتیبانی هرگز عبارت بازیابی، کلید خصوصی یا رمز عبور شما را نمی‌خواهد؛ اگر کسی با ادعای پشتیبانی این‌ها را خواست، آن را گزارش کنید و از طریق آدرس رسمی سایت ادامه دهید.',
    bodyEn: 'You can leave a message and open a ticket from the contact page; for a technical problem include the transaction hash so it can be traced faster. Support will never ask for your recovery phrase, private key or password. If someone claiming to be support asks for those, report it and continue only through the site\'s official address.',
    updatedAt: now()
  },
  {
    id: 'kb.product.roadmap', version: 1, category: 'PRODUCT', status: 'verified', confidence: 88,
    source: 'fbt-app',
    titleFa: 'کدام قابلیت‌ها هنوز عرضه نشده‌اند؟', titleEn: 'Which features are not available yet?',
    tags: ['قابلیت', 'کامینگ', 'به زودی', 'yet', 'coming soon', 'roadmap', 'not available', 'در دسترس نیست'],
    bodyFa: 'اگر قابلیتی در FBT وجود نداشته باشد، دستیار باید صریح بگوید که وجود ندارد و به‌جای توصیف ساختگی، در صورت لزوم «به‌زودی» یا «در حال ساخت» اعلام می‌کند. بخش «چه‌جدید» و صفحهٔ تغییرات (Changelog) فهرست قابلیت‌های عرضه‌شده را نشان می‌دهند. اگر جایی ادعایی دربارهٔ قابلیت ناموجود دیدید، آن را گزارش کنید.',
    bodyEn: 'If a feature does not exist in FBT, the assistant says so plainly and, where relevant, states "coming soon" or "in progress" rather than describing something invented. The "What\'s New" section and the changelog page list what has actually shipped. If you spot a claim about a feature that does not exist, report it.',
    updatedAt: now()
  },

  /* ======================================================================== */
  /*  ECONOMICS / MACRO — how macro reaches a crypto price                     */
  /* ======================================================================== */
  {
    id: 'kb.economics.liquidity', version: 1, category: 'TRADING', status: 'verified', confidence: 93,
    source: 'macro-transmission-framework',
    titleFa: 'نقدینگی جهانی چگونه روی بازار کریپتو اثر می‌گذارد؟', titleEn: 'How does global liquidity affect the crypto market?',
    tags: ['نقدینگی', 'liquidity', 'central bank', 'بانک مرکزی', 'پول', 'dxy', 'fiat', 'نقدینگی جهانی'],
    bodyFa: 'بازار کریپتو با دلار قیمت‌گذاری می‌شود، پس وقتی نقدینگی جهانی (پولی که بانک‌های مرکزی در چرخه می‌سازند) کم می‌شود، دارایی‌های ریسکی اول از همه تحت فشار قرار می‌گیرند: نقدینگی کمتر یعنی خریدار کمتر، یعنی افت قیمت و گاهی نقدشوندگی نازک. وقتی نقدینگی برمی‌گردد، معمولاً بازار کریپتو زودتر از بقیهٔ بازارها واکنش نشان می‌دهد. شاخص دلار (DXY) یکی از نشانگرهای رایج این وضعیت است.',
    bodyEn: 'Crypto is priced in dollars, so when global liquidity — the money central banks create through the cycle — shrinks, risky assets come under pressure first: less liquidity means fewer buyers, which means lower prices and sometimes thin liquidity. When liquidity returns, crypto often reacts ahead of other markets. The dollar index (DXY) is a common indicator of this regime.',
    updatedAt: now()
  },
  {
    id: 'kb.economics.real-rates', version: 1, category: 'TRADING', status: 'verified', confidence: 92,
    source: 'monetary-economics-principles',
    titleFa: 'نرخ بهرهٔ واقعی چرا برای بیت‌کوین مهم است؟', titleEn: 'Why do real interest rates matter for Bitcoin?',
    tags: ['نرخ واقعی', 'real rate', 'بهره', 'inflacja', 'تورم', 'فرصت', 'yield', 'نرخ سیاستی'],
    bodyFa: 'نرخ بهرهٔ واقعی یعنی نرخ اسمی منهای تورم انتظاری. وقتی نرخ واقعی بالا و مثبت است، نگه‌داشتن دارایی بدون جریان نقدی (مثل بیت‌کوین) پرهزینه می‌شود، چون اوراق دولتی بازده واقعی می‌دهند. نتیجه معمولاً فشار قیمتی است. برعکس، نرخ واقعی منفی یا نزدیک صفر، دارایی‌های کمیاب را جذاب‌تر می‌کند. این یک رابطهٔ تاریخی است، نه یک قانون قطعی.',
    bodyEn: 'The real rate is the nominal rate minus expected inflation. When the real rate is high and positive, holding a non-yielding asset like Bitcoin is expensive because government bonds pay a real return, which usually produces price pressure. Conversely, a negative or near-zero real rate makes scarce assets more attractive. This is a historical relationship, not a hard law.',
    updatedAt: now()
  },
  {
    id: 'kb.economics.safe-haven', version: 1, category: 'RISK', status: 'verified', confidence: 90,
    source: 'monetary-economics-principles',
    titleFa: 'بیت‌کوین یک دارایی امن (Safe Haven) است؟', titleEn: 'Is Bitcoin a safe haven?',
    tags: ['امن', 'پناه', 'safe haven', 'بحران', 'طلا', 'gold', 'همبستگی', 'correlation'],
    bodyFa: 'پاسخ کوتاه: گاهی بله، ولی نه همیشه و نه در هر بازه. در بعضی بحران‌ها بیت‌کوین هم‌زمان با بقیهٔ ریسک‌ها فروخته می‌شود، چون در آن لحظه نقدینگی در اولویت است نه دارایی‌های کمیاب. همبستگی آن با سهام در دوره‌های مختلف تغییر کرده و در بعضی سال‌ها حتی مثبت بوده است. بنابراین نباید فرض کرد در هر بحرانی مثل طلا عمل می‌کند.',
    bodyEn: 'The short answer: sometimes yes, but not always and not in every regime. In some crises Bitcoin sells off alongside other risk assets, because at that moment liquidity matters more than scarce assets. Its correlation with equities has changed over time and has even been positive in some years. So it should not be assumed to behave like gold in every crisis.',
    updatedAt: now()
  },
  {
    id: 'kb.economics.etf-flows', version: 1, category: 'TRADING', status: 'verified', confidence: 91,
    source: 'derivatives-onchain-handbook',
    titleFa: 'ورود و خروج صندوق‌های ETF چه اثری دارد؟', titleEn: 'What effect do ETF flows have?',
    tags: ['etf', 'صندوق', 'ورود', 'خروج', 'جریان', 'inflow', 'outflow', 'grayscale', 'blackrock'],
    bodyFa: 'صندوق‌های ETF نقدشوندگی را به بازار می‌آورند: وقتی سرمایه‌گذار پول وارد می‌کند، در عمل خرید می‌شود و آن خرید می‌تواند روی قیمت اثر بگذارد؛ هنگام خروج هم برعکس. برای همین «جریان خالص» (ورود منهای خروج) به‌عنوان یکی از شاخص‌های کوتاه‌مدت قیمت بیت‌کوین دنبال می‌شود. اما رابطه‌اش با قیمت پایدار نیست و به‌تنهایی سیگنال خرید یا فروش نیست.',
    bodyEn: 'ETFs bring liquidity to the market: when an investor puts money in, it has to be bought, and that buying can move the price; on the way out, the reverse happens. Net flow (inflows minus outflows) is therefore tracked as a short-term indicator for Bitcoin. Its relationship with price is not stable, though, and on its own it is not a buy or sell signal.',
    updatedAt: now()
  },

  /* ======================================================================== */
  /*  ANALYTICS — the metrics the assistant reads out                          */
  /* ======================================================================== */
  {
    id: 'kb.analytics.sopr', version: 1, category: 'TRADING', status: 'verified', confidence: 92,
    source: 'derivatives-onchain-handbook',
    titleFa: 'SOPR چیست و چطور خوانده می‌شود؟', titleEn: 'What is SOPR and how do you read it?',
    tags: ['sopr', 'خروجی', 'سود', 'واقعی', 'realized profit', 'spent output', 'onchain', '指标'],
    bodyFa: 'SOPR نسبت ارزش واقعیِ کوین‌های خرج‌شده به ارزش واقعیِ کوین‌های دریافت‌شده است. بالای ۱ یعنی کسانی که سکه را خرج می‌کنند در سود هستند؛ زیر ۱ یعنی در زیان. این شاخص برای تشخیص «فشار فروش واقعی» در بازار استفاده می‌شود، ولی باید با بافت بازار (مثلاً در دوره‌های افت شدید) خوانده شود و به‌تنهایی سیگنال نیست.',
    bodyEn: 'SOPR is the ratio of the realised value of coins spent to the realised value of coins received. Above 1 means spenders are in profit; below 1 means they are at a loss. It is used to identify real selling pressure, but it has to be read in market context — during sharp drawdowns, for example — and it is not a signal on its own.',
    updatedAt: now()
  },
  {
    id: 'kb.analytics.sopr-read', version: 1, category: 'TRADING', status: 'verified', confidence: 90,
    source: 'derivatives-onchain-handbook',
    titleFa: 'قاعدهٔ SOPR چگونه در بازار واقعی به‌کار می‌رود؟', titleEn: 'How is the SOPR rule used in a real market?',
    tags: ['قاعده', 'استراتژی', 'sopr', 'buy', 'sell', 'rule', 'historical', 'بیت کوین'],
    bodyFa: 'یک قاعدهٔ تاریخی رایج این است: در بازارهای صعودیِ سالم، خروجِ زیان‌ده («SOPR زیر ۱») معمولاً با کف‌های بزرگ هم‌زمان می‌شود و نشانهٔ تسلیم‌شدن دارندگان در ضرر است. اما این قاعده همیشه کار نمی‌کند: در ریزش‌های شدید، خروج در زیان می‌تواند ادامه پیدا کند و کف را عمیق‌تر کند. به همین دلیل همیشه باید با نقدینگی، ساختار بازار و احساسات ترکیب شود، نه به‌تنهایی.',
    bodyEn: 'One common historical rule: in healthy uptrends, spending at a loss (SOPR below 1) often coincides with major bottoms and signals capitulation by holders. But the rule does not always work: during severe drawdowns, losses can keep being realised and the bottom can go deeper. That is why it has to be combined with liquidity, market structure and sentiment rather than used alone.',
    updatedAt: now()
  },
  {
    id: 'kb.analytics.dormancy', version: 1, category: 'TRADING', status: 'verified', confidence: 90,
    source: 'onchain-valuation-standard',
    titleFa: 'آیا حجم معاملهٔ بالا همیشه خوب است؟', titleEn: 'Is high trading volume always good?',
    tags: ['حجم', 'volume', 'نقدینگی', 'کف', 'bottom', 'وایت‌ویک', 'real volume', 'حجم واقعی'],
    bodyFa: 'نه لزوماً. حجم معاملهٔ بالا می‌تواند نشانهٔ ورود پول تازه باشد یا نشانهٔ فشار فروش سنگین. آنچه تفسیر را عوض می‌کند، قیمت است: حجم بالا همراه با قیمت صعودی و تثبیت یا بالا رفتن قیمت، الگوی انباشت است؛ حجم بالا همراه با قیمت نزولی، توزیع است. «حجم واقعی» که بیت‌کوین در آن دیده می‌شود هم می‌تواند نشانهٔ حرکت بین کیف پول‌های خودکار (صرافی به صرافی) باشد تا معاملهٔ واقعی.',
    bodyEn: 'Not necessarily. High volume can mean fresh money entering or heavy selling pressure. What changes the interpretation is price: high volume with a rising and stabilising price is accumulation; high volume with a falling price is distribution. "Real volume" that only exchanges send to each other can also reflect wallet shuffling rather than genuine trading.',
    updatedAt: now()
  },
  {
    id: 'kb.analytics.onchain-vs-price', version: 1, category: 'TRADING', status: 'verified', confidence: 91,
    source: 'onchain-valuation-standard',
    titleFa: 'چرا شاخص‌های آن‌چین و قیمت می‌توانند خلاف هم باشند؟', titleEn: 'Why can on-chain metrics and price disagree?',
    tags: ['آنچین', 'onchain', 'قیمت', 'تناقض', 'واگرایی', 'divergence', 'whale', 'صرافی'],
    bodyFa: 'چون این دو چیز متفاوتی را می‌سنجند. قیمت نتیجهٔ معامله در بازارهای جهانی است و شامل دارایی‌هایی می‌شود که خارج از آن‌چین هم نگهداری می‌شوند (صرافی‌های متمرکز، ETFها، پایگاه‌های نگهداری). دادهٔ آن‌چین فقط رفتارِ کیف پول‌های روی بلاک‌چین را می‌بیند. بنابراین واگرایی طبیعی است و به‌تنهایی سیگنال ورود یا خروج نیست؛ بلکه سؤالی است که باید بررسی شود.',
    bodyEn: 'Because they measure different things. Price is the outcome of trading in global markets and includes assets held outside the chain (centralised exchanges, ETFs, custodians). On-chain data only sees the behaviour of on-chain wallets. So divergence is natural and is not by itself an entry or exit signal; it is a question worth investigating.',
    updatedAt: now()
  },
  {
    id: 'kb.analytics.risk-score', version: 1, category: 'RISK', status: 'verified', confidence: 91,
    source: 'fbt-app',
    titleFa: 'امتیاز ریسک FBT چطور محاسبه می‌شود؟', titleEn: 'How is the FBT risk score computed?',
    tags: ['امتیاز', 'ریسک', 'نمره', 'risk score', 'حرارت', 'نوسان', 'رتبه', 'rank', 'ریسک پورتفوی'],
    bodyFa: 'امتیاز ریسک از ترکیبی از نوسان، شرایط بازار و ساختار موقعیت شما ساخته می‌شود و در بازهٔ عددی خلاصه می‌شود. این عدد یک **توصیف** است، نه یک پیش‌بینی: یعنی می‌گوید شرایط فعلی چقدر پرریسک به نظر می‌رسد، نه اینکه چه اتفاقی خواهد افتاد. اگر امتیاز پایین است، به این معنا نیست که بازار بالا نمی‌رود — فقط یعنی ریسکِ اندازه‌گیری‌شدهٔ فعلی کم است.',
    bodyEn: 'The risk score combines volatility, market conditions and the structure of your position into a single number. That number is a *description*, not a forecast: it says how risky current conditions look, not what will happen. A low score does not mean the market will not rise — only that the currently measured risk is low.',
    updatedAt: now()
  },
  {
    id: 'kb.analytics.scenario', version: 1, category: 'TRADING', status: 'verified', confidence: 90,
    source: 'fbt-app',
    titleFa: 'سناریوی صعودی و نزولی چطور ساخته می‌شود؟', titleEn: 'How are the bull and bear scenarios constructed?',
    tags: ['سناریو', 'صعودی', 'نزولی', 'bull', 'bear', 'بازه', 'scenario', 'horizon'],
    bodyFa: 'سناریوها مجموعه‌ای از شرایط ممکن در یک بازهٔ زمانی مشخص‌اند، نه پیش‌بینی نقطهٔ دقیق. هر سناریو شرط‌هایی دارد که اگر برقرار بمانند، آن مسیر محتمل می‌شود؛ و اگر بشکنند، سناریو ضعیف می‌شود. به همین دلیل سناریو را باید به‌عنوان چارچوب تصمیم خواند (چه چیزی را زیر نظر بگیرم) نه به‌عنوان عددی که در آینده ثبت می‌شود.',
    bodyEn: 'Scenarios are sets of conditions that could hold over a defined horizon, not predictions of an exact price. Each scenario carries conditions that, if they remain in place, make that path plausible; if they break, the scenario weakens. Read a scenario as a decision framework — what to watch — rather than as a number that will be recorded in the future.',
    updatedAt: now()
  }
]);
