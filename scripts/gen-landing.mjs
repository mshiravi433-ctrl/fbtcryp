#!/usr/bin/env node
/**
 * CRAWLABLE LANDING PAGES
 * ---------------------------------------------------------------------------
 * ─── THE PROBLEM, MEASURED ──────────────────────────────────────────────────
 * The app has 33 routes. Google has indexed ONE page.
 *
 * That is not bad luck, it is arithmetic: every route is behind a hash
 * (`/#/swap`), and everything after the `#` is never sent to the server. A
 * crawler asking for `/#/swap` receives the identical HTML it got for `/`, so
 * there is exactly one indexable document no matter how many screens exist.
 *
 * Verified against the live site: `site:lawpoetics.ir` returns a single
 * result, and `sitemap.xml` honestly lists one URL because inventing hash
 * entries would just 404 on inspection.
 *
 * Meanwhile `/api/orders/watch/status` still reports `watches: 0`. Zero real
 * users. Everything else built recently — the history engine, the second
 * aggregator, the wallet redesign — is worth nothing until somebody arrives,
 * and search is the only arrival channel that costs no money and keeps
 * working while nobody is watching it.
 *
 * ─── WHY STATIC HTML AND NOT SSR ────────────────────────────────────────────
 * Server-side rendering would mean a rendering server, a second code path for
 * every screen, and a per-request cost. The owner's constraint is explicit:
 * «فعلا پول نمیشه خرج کرد» — no money to spend.
 *
 * These pages cost nothing. They are generated at build time, served as plain
 * files by the hosting we already pay nothing for, and each one immediately
 * hands the visitor into the real app. No server, no runtime, no maintenance
 * beyond the table below.
 *
 * ─── WHY THIS IS NOT CLOAKING ───────────────────────────────────────────────
 * Worth stating plainly, because generated pages for crawlers can be exactly
 * that and Google penalises it hard.
 *
 * A crawler and a person are served the SAME file. There is no user-agent
 * sniffing anywhere. The content is genuine, human-written prose describing a
 * real feature that really exists, and the link into the app is a normal
 * anchor a person is meant to click. That is a landing page, which is
 * ordinary and allowed. Cloaking is showing different content to the crawler
 * than to the user, and nothing here does that.
 *
 * ─── THE HONESTY RULE FOR THE COPY ──────────────────────────────────────────
 * Every claim below has to be true of the shipped app. The old <title>
 * advertised "9 Chains" and Tron support that does not exist — that text was
 * what Google had indexed, so the one thing search engines knew about us was
 * partly false. Anyone arriving to swap on Tron would find nothing and leave.
 * Do not add a page here for a feature until it works.
 */

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * ─── THE CANONICAL HOME IS NOW fbtswap.ir ───────────────────────────────────
 * The site ran on `www.lawpoetics.ir`, a domain whose name has nothing to do
 * with the product. That is not merely untidy — for search it is actively
 * expensive:
 *
 *   • EXACT-MATCH SIGNAL. Somebody searching "FBT Swap" sees a result on
 *     "lawpoetics.ir" and has no reason to believe it is the same thing. The
 *     click-through rate on a mismatched domain is measurably worse, and
 *     click-through feeds back into ranking.
 *   • TRUST. On a money app, a domain that does not match the brand is the
 *     single most common shape of a phishing clone. We were training our own
 *     users to ignore the one check that protects them.
 *   • BRAND SEARCH. Every mention of the app anywhere sends people to a name
 *     they then cannot find.
 *
 * `fbtswap.ir` matches the app name, the APK id (`ir.fbt.swap`) and the X
 * handle. Overridable by env so a preview deploy does not claim to be
 * production — a canonical tag pointing at production from a staging build
 * tells Google to index production instead of the page it is looking at,
 * which is how preview URLs quietly vanish from the index.
 */
const SITE = (process.env.VITE_PUBLIC_URL || 'https://fbtswap.ir').replace(/\/+$/, '');
const OUT = 'dist';

/**
 * One entry per page.
 *
 * Kept deliberately short. A handful of pages about things people actually
 * search for beats thirty thin pages, which search engines treat as a quality
 * signal against the whole domain.
 *
 * `route` is the in-app hash destination the visitor is sent to.
 */
const PAGES = [
  {
    slug: 'non-custodial-crypto-swap',
    lang: 'en',
    route: '/#/swap',
    title: 'Non-Custodial Crypto Swap — Keep Your Own Keys | FBT Swap',
    description:
      'Swap tokens across 10 supported networks without giving up your private keys. No account, no email, no identity check. You sign every trade from your own wallet.',
    h1: 'Swap crypto without giving up your keys',
    body: [
      'FBT Swap is a non-custodial exchange interface. You connect a wallet you already own, you swap, and your assets never leave your control. There is no account to create, no email to hand over and no identity check to pass.',
      'It does not run an order book and holds no liquidity of its own. It asks public aggregators for the best route across the decentralised exchanges on the network you chose, shows you the quote, the price impact and the fee, then hands the transaction to your wallet. You are the one who signs it, and the swap settles on-chain directly between your wallet and the protocol.',
      'Because nobody here holds your keys, this also means what you would expect: we cannot reverse a transaction, freeze funds, or recover a lost recovery phrase. Nobody can.'
    ],
    facts: [
      ['Networks', 'BNB Chain, Ethereum, Polygon, Arbitrum, Base, Optimism, Avalanche, Linea, Sonic, Solana'],
      ['Platform fee', '0.70% of the input amount, shown on screen before you sign, on every supported network'],
      ['Custody', 'None. Your keys stay in your wallet'],
      ['Signup', 'Not required']
    ],
    faqs: [
      {
        q: 'Do I need an account or identity check to swap?',
        a: 'No FBT Swap account is required for the on-chain swap interface. You connect a wallet you control and sign the transaction there. Your wallet or a third-party protocol can still show its own security checks.'
      },
      {
        q: 'Does FBT Swap hold my crypto or recovery phrase?',
        a: 'No. FBT Swap does not take deposits, hold a recovery phrase, or sign in place of a user. Assets remain in the connected wallet and each transaction requires the wallet holder’s approval.'
      },
      {
        q: 'Which networks can I use?',
        a: 'The supported networks are BNB Chain, Ethereum, Polygon, Arbitrum, Base, Optimism, Avalanche, Linea, Sonic and Solana. Check the selected network carefully before sending or signing.'
      }
    ]
  },
  {
    slug: 'crypto-price-alerts-and-dca',
    lang: 'en',
    route: '/#/orders',
    title: 'Crypto Price Alerts and Recurring Buys | FBT Swap',
    description:
      'Set a crypto price target, trailing stop or recurring-buy reminder without granting custody. You decide whether to sign every swap.',
    h1: 'Price alerts and recurring buys',
    body: [
      'Set a target price on a supported pair and FBT Swap keeps the condition with your order. When notification delivery is enabled and available, a price-triggered alert can reach your device; otherwise the order remains visible when you next open the app.',
      'Recurring buys work as reminders: choose an amount and an interval, then review and sign each swap yourself. Spreading entries over time is what most people mean by dollar-cost averaging, and it removes the pressure to choose one exact entry point.',
      'These are alerts, not automatic trades, and the difference is deliberate. Filling an order while you sleep requires somebody to hold your funds or an unlimited spending allowance over them. This app does neither, so nothing can move money without you signing for it. A limit order that silently does not fill would be worse than no feature at all, so the limitation is stated on the screen itself.'
    ],
    facts: [
      ['Order types', 'Price target, trailing stop, take-profit/stop-loss, ladder and recurring-buy reminder'],
      ['Alerts', 'Delivered when notifications are enabled and available; otherwise retained in the app'],
      ['Execution', 'You sign every swap — nothing is automatic'],
      ['Custody', 'None. No spending allowance is requested']
    ],
    faqs: [
      {
        q: 'Will FBT Swap trade automatically when my target is reached?',
        a: 'No. It records and watches a condition, then asks you to review and sign the swap. The service does not hold funds or keep an allowance that could move them without your approval.'
      },
      {
        q: 'Can a price alert reach me when the app is closed?',
        a: 'A price-triggered alert can be delivered outside the app when notifications are enabled and the delivery service is available. Delivery depends on device settings and connectivity, so it is a reminder rather than a guaranteed execution service.'
      },
      {
        q: 'What does recurring buy mean here?',
        a: 'It is a scheduled reminder to review a planned purchase at your chosen interval. Each swap remains a separate transaction that you approve in your own wallet.'
      }
    ]
  },
  {
    slug: 'crypto-market-history-analysis',
    lang: 'en',
    route: '/#/signals',
    title: 'Crypto Chart History — What the Past Actually Says | FBT Swap',
    description:
      'See how often a price level has held, the worst drawdown in the window, and how today’s volume compares to normal. Measurements from real data, not predictions.',
    h1: 'What the past actually says',
    body: [
      'Most chart tools give you a snapshot: an RSI reading, a moving average, one support line. None of that answers the question people actually ask before setting a target price — has the market been here before, and what happened?',
      'This app measures repeated behaviour across the whole series. It finds the levels price keeps returning to and counts the touches, reports how often each one held versus broke, shows the worst peak-to-trough fall in the window, and compares today’s volume to this coin’s own median rather than to some absolute number.',
      'Nothing here forecasts anything, and that is the point. "This level was tested four times and held three" is a fact about data that already exists. "This level will hold" is a guess. A level that held four times can break on the fifth, and the app says so on the same screen.'
    ],
    facts: [
      ['Levels', 'Counted touches, with a held-versus-broke record'],
      ['Drawdown', 'Worst peak-to-trough fall in the window'],
      ['Volume', 'Compared to this coin’s own median, not an absolute figure'],
      ['Forecasts', 'None. Every figure describes data that already happened']
    ],
    faqs: [
      {
        q: 'Does this chart analysis predict the next price?',
        a: 'No. It summarizes measurements from past price and volume data. A support level that held before can still break, and no historical indicator guarantees a future result.'
      },
      {
        q: 'What does a held-versus-broke level show?',
        a: 'It counts how often price returned to a level in the selected history and whether it held or moved through it. It is context for research, not a trading instruction.'
      },
      {
        q: 'Is this financial advice?',
        a: 'No. Crypto assets are volatile and on-chain transactions are irreversible. Make your own decision and never trade money you cannot afford to lose.'
      }
    ]
  },

  /*
   * ═══════════════════════════════════════════════════════════════════════
   * THE PERSIAN PAGE — the highest-value single page on this list.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * ─── WHY IT WAS MISSING AND WHY THAT COST US ────────────────────────────
   * The app is Persian-first. The interface defaults to Persian, the owner is
   * in Isfahan, and the domain is now a `.ir`. Every crawlable page we had
   * was in English.
   *
   * That is a straightforward mismatch of supply and demand. The English
   * queries these pages target — "non-custodial crypto swap", "crypto price
   * alerts" — are among the most contested phrases on the web, competing
   * with Uniswap, MetaMask and Trust Wallet, all of whom have a decade of
   * domain authority. We will not rank for them for years.
   *
   * The Persian equivalents («صرافی غیرمتمرکز», «سواپ ارز دیجیتال بدون
   * احراز هویت») have a fraction of the competition and a far higher
   * proportion of searchers who would actually use this app. It is the one
   * place where being small is not a disadvantage.
   *
   * ─── WHY IT IS NOT A TRANSLATION OF THE ENGLISH PAGE ────────────────────
   * A translated page ranks badly and deserves to: it answers the questions
   * an English speaker asks. A Persian speaker searching for this arrives
   * with different questions — can I use it without ID, does it work without
   * a foreign bank card, is my money held by anyone — and the copy answers
   * those instead. It is written, not translated.
   *
   * ─── AND WHY IT DOES NOT OVERSELL ───────────────────────────────────────
   * It does not claim the fiat on-ramp works from Iran, because it does not:
   * the card networks are disconnected at network level. Claiming otherwise
   * would rank us for a query we cannot satisfy, and a visitor who bounces
   * immediately is a ranking signal against the whole domain — as well as
   * being a lie.
   */
  {
    slug: 'صرافی-غیرمتمرکز',
    lang: 'fa',
    dir: 'rtl',
    route: '/#/swap',
    title: 'صرافی غیرمتمرکز و سواپ ارز دیجیتال بدون احراز هویت | اف‌بی‌تی سواپ',
    description:
      'سواپ ارز دیجیتال روی ۱۰ شبکه، از کیف پول خودت. بدون ثبت‌نام، بدون احراز هویت و بدون اینکه دارایی‌ات دست کسی بیفتد. کلیدها پیش خودت می‌مانند.',
    h1: 'سواپ ارز دیجیتال، بدون اینکه کلیدهایت را به کسی بدهی',
    body: [
      'اف‌بی‌تی سواپ یک رابط صرافی غیرمتمرکز است. کیف پولی را که خودت داری وصل می‌کنی، معامله می‌کنی، و دارایی‌ات هیچ‌وقت از کنترل تو خارج نمی‌شود. حسابی برای ساختن نیست، ایمیلی برای دادن نیست و احراز هویتی برای گذراندن نیست.',
      'این برنامه دفتر سفارش ندارد و نقدینگی خودش را هم نگه نمی‌دارد. از تجمیع‌کننده‌های عمومی می‌پرسد بهترین مسیر روی شبکه‌ای که انتخاب کرده‌ای کدام است، قیمت و اثر قیمتی و کارمزد را نشانت می‌دهد، و بعد تراکنش را به کیف پول خودت می‌سپارد. امضا با توست و معامله مستقیم روی زنجیره بین کیف پول تو و پروتکل تسویه می‌شود.',
      'چون هیچ‌کس اینجا کلید تو را ندارد، نتیجه‌اش هم همان است که انتظار داری: ما نمی‌توانیم تراکنشی را برگردانیم، دارایی‌ای را مسدود کنیم، یا عبارت بازیابی گم‌شده‌ای را پس بدهیم. هیچ‌کس نمی‌تواند. این هزینه‌ی غیرامانی بودن است و پیش از هر معامله روی همان صفحه نوشته شده.',
      'برای استفاده از سواپ، کیف پول، نمودارها و هشدارهای قیمت به هیچ حسابی در هیچ‌جا نیاز نداری و هیچ محدودیت کشوری هم اعمال نمی‌شود — این‌ها روی خودِ بلاکچین اجرا می‌شوند. تنها بخشی که محدودیت دارد خرید با پول نقد است، چون آن یکی از طریق یک شریک پرداخت دارای مجوز انجام می‌شود و شبکه‌های کارت بین‌المللی از سال ۲۰۱۲ به سیستم بانکی ایران متصل نیستند. این را همان‌جا صریح نوشته‌ایم تا کسی وقتش را تلف نکند.'
    ],
    facts: [
      ['شبکه‌ها', 'بی‌ان‌بی چین، اتریوم، پالیگان، آربیتروم، بیس، اپتیمیسم، آوالانچ، لینیا، سونیک، سولانا'],
      ['کارمزد پلتفرم', '۰٫۷۰٪ از مقدار ورودی، پیش از امضا روی صفحه نمایش داده می‌شود؛ روی همهٔ شبکه‌های پشتیبانی‌شده'],
      ['امانت‌داری', 'هیچ. کلیدها داخل کیف پول خودت می‌مانند'],
      ['ثبت‌نام', 'لازم نیست'],
      ['احراز هویت', 'برای رابط سواپ لازم نیست']
    ],
    faqs: [
      {
        q: 'آیا برای سواپ در اف‌بی‌تی سواپ احراز هویت لازم است؟',
        a: 'برای استفاده از رابط سواپ روی زنجیره، حساب اف‌بی‌تی سواپ یا احراز هویت لازم نیست؛ کیف پول خودت را وصل می‌کنی و همان‌جا تراکنش را امضا می‌کنی. ممکن است خودِ کیف پول یا پروتکلِ ثالث بررسی امنیتی جداگانه داشته باشد.'
      },
      {
        q: 'آیا اف‌بی‌تی سواپ دارایی یا عبارت بازیابی من را نگه می‌دارد؟',
        a: 'نه. اف‌بی‌تی سواپ واریز نمی‌گیرد، عبارت بازیابی را نمی‌خواهد و به‌جای کاربر امضا نمی‌کند. دارایی داخل کیف پول متصل می‌ماند و هر تراکنش تأیید صاحب کیف پول را می‌خواهد.'
      },
      {
        q: 'کدام شبکه‌ها پشتیبانی می‌شوند؟',
        a: 'بی‌ان‌بی چین، اتریوم، پالیگان، آربیتروم، بیس، اپتیمیسم، آوالانچ، لینیا، سونیک و سولانا پشتیبانی می‌شوند. قبل از ارسال یا امضا، شبکهٔ انتخاب‌شده را با دقت بررسی کن.'
      }
    ],
    ctaLabel: 'باز کردن برنامه',
    glanceLabel: 'یک نگاه کلی',
    riskText:
      'ارزهای دیجیتال پرنوسان‌اند و تراکنش روی زنجیره برگشت‌ناپذیر است. ممکن است پول از دست بدهی، حتی همه‌اش را. هیچ‌چیز اینجا توصیه مالی نیست.'
  },

  /*
   * Persian search intent pages. These are deliberately feature pages, not
   * token-pair templates: each answers a distinct question a real visitor has
   * and points to the screen that performs the described task.
   */
  {
    slug: 'هشدار-قیمت-ارز-دیجیتال',
    lang: 'fa',
    dir: 'rtl',
    route: '/#/orders',
    title: 'هشدار قیمت ارز دیجیتال و خرید پله‌ای | اف‌بی‌تی سواپ',
    description:
      'برای قیمت هدف، حد ضرر متحرک یا خرید پله‌ای ارز دیجیتال یادآور بگذار. دارایی پیش خودت می‌ماند و هیچ سواپی بدون امضای تو انجام نمی‌شود.',
    h1: 'هشدار قیمت ارز دیجیتال و خرید پله‌ای، بدون سپردن دارایی',
    body: [
      'اگر نمی‌خواهی تمام روز نمودار را نگاه کنی، برای یک جفت‌ارز قیمت هدف بگذار تا وقتی بازار به آن رسید، بتوانی دوباره بررسی‌اش کنی. اف‌بی‌تی سواپ قیمت هدف، حد ضرر متحرک، حد سود همراه با حد ضرر و فروش پله‌ای را به‌عنوان شرط نگه می‌دارد؛ نه به‌عنوان اجازه‌ای برای جابه‌جا کردن پول تو.',
      'برای خرید پله‌ای هم مبلغ و فاصلهٔ زمانی را انتخاب می‌کنی و برنامه سرِ هر نوبت یادآور می‌شود. این یعنی فرصت بررسی دوباره پیش از هر خرید؛ خریدها روی یک حساب یا موجودیِ امانی جمع نمی‌شوند.',
      'این تفاوت مهم است: هشدار با سفارش خودکار یکی نیست. برای معاملهٔ خودکار، یک سرویس باید دارایی تو را نگه دارد یا اجازهٔ برداشت از کیف پولت داشته باشد. اف‌بی‌تی سواپ هیچ‌کدام را نمی‌گیرد؛ وقتی شرط برقرار شد، خودت نرخ را می‌بینی و تراکنش را در کیف پول خودت امضا می‌کنی.',
      'اگر اعلان‌ها را فعال کرده باشی و سرویس ارسال در دسترس باشد، هشدارِ قیمت می‌تواند بیرون از برنامه هم برسد. تنظیمات گوشی، اینترنت و سرویس اعلان روی رسیدن آن اثر می‌گذارند؛ پس هشدار جای تضمین انجام معامله نیست و شرط ثبت‌شده در برنامه هم باقی می‌ماند.'
    ],
    facts: [
      ['نوع‌ها', 'قیمت هدف، حد ضرر متحرک، حد سود + حد ضرر، فروش پله‌ای و یادآور خرید پله‌ای'],
      ['اجرا', 'هر سواپ با امضای خودت انجام می‌شود؛ هیچ‌چیز خودکار نیست'],
      ['اعلان', 'با فعال‌بودن اعلان و در دسترس بودن سرویس ارسال می‌شود؛ در غیر این صورت داخل برنامه می‌ماند'],
      ['امانت‌داری', 'هیچ. مجوز برداشت یا دارایی تو در اختیار سرویس نیست']
    ],
    faqs: [
      {
        q: 'آیا وقتی قیمت به هدف برسد اف‌بی‌تی سواپ خودش معامله می‌کند؟',
        a: 'نه. برنامه شرط را نگه می‌دارد و وقتی برقرار شد از تو می‌خواهد سواپ را بررسی و امضا کنی. سرویس نه دارایی را نگه می‌دارد و نه مجوزی دارد که بدون تأیید تو آن را جابه‌جا کند.'
      },
      {
        q: 'آیا هشدار قیمت وقتی برنامه بسته است هم می‌رسد؟',
        a: 'اگر اعلان‌ها فعال باشند و سرویس ارسال و اینترنت در دسترس باشد، هشدارِ قیمت می‌تواند بیرون از برنامه هم برسد. دریافت اعلان به تنظیمات دستگاه و اتصال وابسته است؛ بنابراین یادآور است، نه تضمین اجرا.'
      },
      {
        q: 'خرید پله‌ای در اینجا یعنی چه؟',
        a: 'خرید پله‌ای یک یادآور زمان‌بندی‌شده برای بررسی خرید در فاصله‌های انتخابی توست. هر خرید یک تراکنش جداست که در کیف پول خودت تأیید می‌کنی.'
      }
    ],
    ctaLabel: 'تنظیم هشدار و خرید پله‌ای',
    glanceLabel: 'یک نگاه کلی',
    riskText:
      'هشدار، پیشنهاد خرید یا فروش نیست و رسیدن اعلان تضمین نمی‌شود. ارزهای دیجیتال پرنوسان‌اند و تراکنش روی زنجیره برگشت‌ناپذیر است؛ ممکن است همهٔ پولت را از دست بدهی.'
  },
  {
    slug: 'تحلیل-تکنیکال-ارز-دیجیتال',
    lang: 'fa',
    dir: 'rtl',
    route: '/#/signals',
    title: 'تحلیل تکنیکال ارز دیجیتال | RSI، MACD و حمایت مقاومت | اف‌بی‌تی سواپ',
    description:
      'تاریخچهٔ قیمت ارز دیجیتال را با RSI، MACD، میانگین متحرک، نوسان، حمایت و مقاومت بخوان. دادهٔ گذشته است، نه پیش‌بینی قیمت.',
    h1: 'تحلیل تکنیکال ارز دیجیتال؛ خواندن داده، نه وعدهٔ پیش‌بینی',
    body: [
      'تحلیل تکنیکال وقتی مفید است که بدانی چه می‌گوید و چه نمی‌گوید. در اف‌بی‌تی سواپ، RSI، MACD، باند بولینگر، میانگین‌های متحرک، نوسان و سطح‌های حمایت و مقاومت از تاریخچهٔ واقعی قیمت محاسبه می‌شوند تا بتوانی وضعیت فعلی نمودار را در کنار هم ببینی.',
      'به‌جای اینکه یک عدد را «سیگنال قطعی» بدانی، می‌توانی ببینی اندیکاتورها چقدر با هم هم‌نظرند، قیمت چند بار به یک سطح برگشته و آن سطح چند بار نگه داشته یا شکسته شده است. حجم هم با میانهٔ همان دارایی مقایسه می‌شود، نه با یک عدد دل‌بخواهی برای همهٔ کوین‌ها.',
      'هیچ‌کدام از این اندازه‌گیری‌ها آینده را تضمین نمی‌کنند. سطح حمایتی که چند بار دوام آورده ممکن است دفعهٔ بعد بشکند و بازارِ پرنوسان می‌تواند در چند دقیقه نتیجه را عوض کند. این صفحه برای تحقیق و فهم بهتر داده است، نه توصیهٔ مالی یا فرمان خرید و فروش.'
    ],
    facts: [
      ['اندیکاتورها', 'RSI، MACD، باند بولینگر و میانگین‌های متحرک'],
      ['سطح‌ها', 'تعداد برخوردها و سابقهٔ نگه‌داشتن یا شکستن قیمت'],
      ['ریسک', 'بدترین افت از سقف تا کف در بازهٔ انتخاب‌شده'],
      ['پیش‌بینی', 'ندارد؛ همهٔ عددها دربارهٔ داده‌ای هستند که قبلاً رخ داده است']
    ],
    faqs: [
      {
        q: 'آیا تحلیل تکنیکال این صفحه قیمت بعدی را پیش‌بینی می‌کند؟',
        a: 'نه. این صفحه اندازه‌گیری‌هایی از قیمت و حجم گذشته را خلاصه می‌کند. هیچ اندیکاتور یا سطحی نتیجهٔ آینده را تضمین نمی‌کند.'
      },
      {
        q: 'نگه‌داشتن یا شکستن یک سطح یعنی چه؟',
        a: 'برنامه می‌شمارد قیمت در تاریخچهٔ انتخاب‌شده چند بار به یک سطح برگشته و آن سطح چند بار حفظ شده یا از آن عبور کرده است. این فقط زمینه‌ای برای تحقیق است، نه دستور معامله.'
      },
      {
        q: 'آیا این محتوا توصیهٔ مالی است؟',
        a: 'نه. ارزهای دیجیتال پرنوسان‌اند و تراکنش‌های روی زنجیره برگشت‌ناپذیرند. تصمیم و مسئولیت معامله با خود توست.'
      }
    ],
    ctaLabel: 'باز کردن تحلیل بازار',
    glanceLabel: 'یک نگاه کلی',
    riskText:
      'اندیکاتورهای تکنیکال دربارهٔ دادهٔ گذشته‌اند، نه تضمین آینده. این صفحه توصیهٔ مالی نیست و ممکن است در ارزهای دیجیتال همهٔ پولت را از دست بدهی.'
  },
  {
    slug: 'کیف-پول-غیرامانی',
    lang: 'fa',
    dir: 'rtl',
    route: '/#/wallet',
    title: 'کیف پول غیرامانی ارز دیجیتال | کلید خصوصی در کنترل تو | اف‌بی‌تی سواپ',
    description:
      'کیف پول خودت را با WalletConnect وصل کن یا یک کیف پول داخلیِ رمزنگاری‌شده روی دستگاه بساز. کلید خصوصی به سرور اف‌بی‌تی سواپ فرستاده نمی‌شود.',
    h1: 'کیف پول غیرامانی؛ کلید خصوصی و دارایی در کنترل تو',
    body: [
      'کیف پول غیرامانی یعنی کلید خصوصی یا عبارت بازیابی در اختیار خودت است، نه یک صرافی یا وب‌سایت. می‌توانی کیف پول موجودت را با WalletConnect یا مرورگرِ کیف پول متصل کنی، موجودی را ببینی و هر تراکنش را در همان کیف پول تأیید کنی.',
      'برای شبکه‌های سازگار با EVM، برنامه امکان ساخت یا واردکردن یک کیف پول داخلیِ ۱۲ کلمه‌ای هم دارد. عبارت آن روی همان دستگاه و با رمز عبور رمزنگاری می‌شود و به سرور فرستاده نمی‌شود. با این حال، کیف پول داخلی داخل فضای مرورگر یا WebView است و به‌اندازهٔ کیف پول سخت‌افزاری یا یک کیف پول خارجیِ معتبر برای مبلغ مهم امن نیست.',
      'عبارت بازیابی را فقط خودت می‌توانی نگه داری و بازیابی کنی. اگر آن را گم کنی، هیچ تیم پشتیبانی، صرافی یا اپلیکیشنی نمی‌تواند دارایی را برگرداند. اگر کسی در پیام، تماس یا فرم وب این عبارت یا رمز را خواست، کلاهبردار است؛ حتی اگر نام اف‌بی‌تی سواپ را نوشته باشد.'
    ],
    facts: [
      ['روش اتصال', 'WalletConnect، کیف پول مرورگر و کیف پول داخلیِ EVM'],
      ['کلید خصوصی', 'در کیف پول خارجی می‌ماند؛ کیف پول داخلی فقط به‌صورت رمزنگاری‌شده روی دستگاه ذخیره می‌شود'],
      ['توصیهٔ امنیتی', 'برای مبلغ مهم از کیف پول خارجی معتبر یا سخت‌افزاری استفاده کن'],
      ['بازیابی', 'عبارت بازیابی فقط نزد خودت است؛ گم‌شدن آن قابل جبران نیست']
    ],
    faqs: [
      {
        q: 'آیا اف‌بی‌تی سواپ عبارت بازیابی کیف پول خارجی من را می‌بیند؟',
        a: 'نه. هنگام اتصال کیف پول خارجی، عبارت بازیابی و کلید خصوصی داخل همان کیف پول باقی می‌ماند. اف‌بی‌تی سواپ هرگز نباید عبارت بازیابی یا رمز کیف پول تو را در پیام، ایمیل یا فرم درخواست کند.'
      },
      {
        q: 'کیف پول داخلی برای چه چیزی مناسب است؟',
        a: 'کیف پول داخلی برای مبالغ کم و آشنایی با برنامه طراحی شده است؛ عبارت ۱۲ کلمه‌ای آن روی دستگاه با رمز عبور رمزنگاری می‌شود و به سرور فرستاده نمی‌شود. برای مبلغ مهم، کیف پول خارجی معتبر یا سخت‌افزاری انتخاب امن‌تری است.'
      },
      {
        q: 'اگر عبارت بازیابی را گم کنم چه می‌شود؟',
        a: 'راهی برای بازیابی آن از سمت اف‌بی‌تی سواپ وجود ندارد. عبارت را روی کاغذ و دور از اینترنت نگه دار و آن را با هیچ‌کس به اشتراک نگذار.'
      }
    ],
    ctaLabel: 'باز کردن کیف پول',
    glanceLabel: 'یک نگاه کلی',
    riskText:
      'عبارت بازیابی و کلید خصوصی را با هیچ‌کس به اشتراک نگذار. دارایی دیجیتال و تراکنش‌های روی زنجیره برگشت‌ناپذیرند و ممکن است همهٔ پولت را از دست بدهی.'
  }
];

/**
 * Pages that are the SAME CONTENT in different languages.
 *
 * Kept as an explicit list rather than inferred, because an incorrect
 * hreflang pairing is worse than none: it tells Google two unrelated pages
 * are translations of each other, and it will then serve the wrong one to
 * half the audience.
 */
const ALTERNATES = [
  ['non-custodial-crypto-swap', 'صرافی-غیرمتمرکز'],
  ['crypto-price-alerts-and-dca', 'هشدار-قیمت-ارز-دیجیتال'],
  ['crypto-market-history-analysis', 'تحلیل-تکنیکال-ارز-دیجیتال']
];

const SOCIAL_CARD = `${SITE}/social-card.png`;
const SOCIAL_CARD_ALT = 'FBT Swap — Non-custodial crypto swap';

/** Escape anything that goes into HTML text or an attribute. */
const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Escape a JSON-LD payload so a content edit can never close its script tag. */
const jsonForScript = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

function copyFor(lang) {
  return lang === 'fa'
    ? { home: 'صفحهٔ اصلی', breadcrumb: 'مسیر صفحه', faq: 'پرسش‌های رایج' }
    : { home: 'Home', breadcrumb: 'Breadcrumb', faq: 'Frequently asked questions' };
}

/**
 * The FAQ JSON-LD mirrors visible `<details>` content below. That matters:
 * structured data is useful only when a visitor can read the same answer; a
 * hidden keyword block would be spam, not documentation.
 */
function landingStructuredData(page, url) {
  const ui = copyFor(page.lang);
  const pageId = `${url}#webpage`;
  const faqId = `${url}#faq`;
  const organizationId = `${SITE}/#organization`;
  const websiteId = `${SITE}/#website`;
  const graph = [
    {
      '@type': 'Organization',
      '@id': organizationId,
      name: 'FBT Swap',
      legalName: 'Fanous Bazaar Pishgam Co.',
      url: `${SITE}/`,
      email: 'fbtswap@gmail.com',
      logo: { '@type': 'ImageObject', url: `${SITE}/icon-512.png`, width: 512, height: 512 }
    },
    {
      '@type': 'WebSite',
      '@id': websiteId,
      url: `${SITE}/`,
      name: 'FBT Swap',
      inLanguage: ['fa', 'en'],
      publisher: { '@id': organizationId }
    },
    {
      '@type': 'WebPage',
      '@id': pageId,
      url,
      name: page.title,
      description: page.description,
      inLanguage: page.lang === 'fa' ? 'fa-IR' : 'en',
      isPartOf: { '@id': websiteId },
      publisher: { '@id': organizationId },
      primaryImageOfPage: {
        '@type': 'ImageObject',
        url: SOCIAL_CARD,
        width: 1024,
        height: 500,
        caption: SOCIAL_CARD_ALT
      },
      ...(page.faqs?.length ? { mainEntity: { '@id': faqId } } : {})
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: ui.home, item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: page.h1, item: url }
      ]
    }
  ];

  if (page.faqs?.length) {
    graph.push({
      '@type': 'FAQPage',
      '@id': faqId,
      mainEntity: page.faqs.map(({ q, a }) => ({
        '@type': 'Question',
        name: q,
        acceptedAnswer: { '@type': 'Answer', text: a }
      }))
    });
  }

  return jsonForScript({ '@context': 'https://schema.org', '@graph': graph });
}

function render(page) {
  /*
   * The Persian slug contains Arabic-script characters, which are legal in a
   * URL path but MUST be percent-encoded before they go into `<link
   * rel="canonical">` or a sitemap. An unencoded non-ASCII character makes a
   * sitemap invalid per the spec, and an invalid sitemap is rejected whole —
   * taking the English pages down with it.
   *
   * `encodeURIComponent` and not `encodeURI`: the latter leaves `/` alone,
   * which is right for a whole path and wrong for a single segment.
   */
  const url = `${SITE}/${encodeURIComponent(page.slug)}`;
  const appUrl = `${SITE}${page.route}`;
  const lang = page.lang || 'en';
  const dir = page.dir || 'ltr';

  /*
   * hreflang, and specifically the RECIPROCAL pair.
   *
   * Google ignores an hreflang annotation unless each page in the set points
   * at every other one INCLUDING itself. A one-way link is silently dropped,
   * which is the usual reason people conclude "hreflang does not work".
   *
   * Only same-topic pages are paired. The Persian swap, alert and analysis
   * pages each have an English counterpart. The wallet page is intentionally
   * Persian-only because it has no equivalent English long-form page yet —
   * claiming an alternate that does not exist is worse than claiming none.
   */
  const altGroup = ALTERNATES.find((g) => g.includes(page.slug));
  const hreflang = altGroup
    ? (() => {
        const pages = altGroup.map((slug) => PAGES.find((x) => x.slug === slug));
        const defaultPage = pages.find((p) => p.lang === 'en') ?? pages[0];
        return [
          ...pages.map(
            (other) =>
              `<link rel="alternate" hreflang="${other.lang || 'en'}" href="${esc(
                `${SITE}/${encodeURIComponent(other.slug)}`
              )}">`
          ),
          `<link rel="alternate" hreflang="x-default" href="${esc(
            `${SITE}/${encodeURIComponent(defaultPage.slug)}`
          )}">`
        ].join('\n');
      })()
    : '';
  const ui = copyFor(lang);
  const faqMarkup = page.faqs?.length
    ? `<section class="faq" aria-labelledby="faq-heading">
    <h2 id="faq-heading">${esc(ui.faq)}</h2>
    ${page.faqs
      .map(
        ({ q, a }) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`
      )
      .join('\n    ')}
  </section>`
    : '';
  const structuredData = landingStructuredData(page, url);

  /*
   * The redirect is a <link rel="canonical"> plus a normal link, NOT a
   * meta-refresh or a JS redirect.
   *
   * An instant redirect on a landing page is treated as a doorway page and is
   * penalised. More practically, a bounced visitor who never saw the content
   * learns nothing about what the app does — the page has to be worth reading
   * on its own or it should not exist.
   */
  return `<!doctype html>
<html lang="${esc(lang)}" dir="${esc(dir)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.description)}">
<link rel="canonical" href="${esc(url)}">
${hreflang}
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#06070c">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">

<meta property="og:type" content="website">
<meta property="og:site_name" content="FBT Swap">
<meta property="og:locale" content="${lang === 'fa' ? 'fa_IR' : 'en_US'}">
<meta property="og:locale:alternate" content="${lang === 'fa' ? 'en_US' : 'fa_IR'}">
<meta property="og:title" content="${esc(page.title)}">
<meta property="og:description" content="${esc(page.description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(SOCIAL_CARD)}">
<meta property="og:image:secure_url" content="${esc(SOCIAL_CARD)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1024">
<meta property="og:image:height" content="500">
<meta property="og:image:alt" content="${esc(SOCIAL_CARD_ALT)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@CompanyFbt">
<meta name="twitter:title" content="${esc(page.title)}">
<meta name="twitter:description" content="${esc(page.description)}">
<meta name="twitter:image" content="${esc(SOCIAL_CARD)}">
<meta name="twitter:image:alt" content="${esc(SOCIAL_CARD_ALT)}">
<script type="application/ld+json">${structuredData}</script>

${
  dir === 'rtl'
    ? `<link rel="preload" href="/fonts/Vazirmatn-var.woff2" as="font" type="font/woff2" crossorigin>
<style>@font-face{font-family:'Vazirmatn';src:url('/fonts/Vazirmatn-var.woff2') format('woff2-variations');font-weight:100 900;font-display:swap}</style>`
    : ''
}
<style>
  /* Inlined, because a landing page that waits on a stylesheet is a landing
     page people leave. It is small enough that a second request would cost
     more than the bytes. */
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #06070c;
    color: #e8ecf6;
    /*
     * The Persian page needs Vazirmatn, which the app already self-hosts.
     * Falling back to system-ui renders Persian in whatever the device has —
     * on many Android builds that is Noto Naskh, whose line height is wrong
     * enough that the RTL paragraphs overlap. Named FIRST so it wins, and
     * the Latin stack stays behind it so the English pages are unaffected.
     *
     * No @font-face here on purpose: the font is preloaded below only when
     * the page is actually Persian, so English visitors do not download a
     * 70 KB Arabic-script font they will never render a glyph from.
     */
    font: 16px/${dir === 'rtl' ? '1.95' : '1.75'} ${
      dir === 'rtl' ? "'Vazirmatn', " : ''
    }system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    padding: 32px 20px 64px;
  }
  main { max-width: 680px; margin: 0 auto; }
  a { color: #00e5ff; }
  h1 { font-size: clamp(26px, 6vw, 38px); line-height: 1.2; margin: 0 0 18px; letter-spacing: -0.02em; }
  h2 { font-size: 17px; margin: 34px 0 10px; }
  p { color: #b9c2d8; margin: 0 0 16px; }
  .crumb { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; color: #8e98b3; font-size: 12px; margin-bottom: 22px; }
  .crumb span[aria-current] { color: #b9c2d8; }
  .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 30px; font-weight: 700; }
  .brand img { width: 30px; height: 30px; border-radius: 9px; }
  .cta {
    display: inline-block;
    margin: 10px 0 8px;
    padding: 14px 26px;
    border-radius: 14px;
    background: linear-gradient(135deg, #00e5ff, #7c4dff);
    color: #05060b;
    font-weight: 700;
    text-decoration: none;
  }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 18px; }
  th, td { text-align: start; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,.09); font-size: 14.5px; vertical-align: top; }
  th { color: #8e98b3; font-weight: 600; width: 38%; }
  .faq details { border-bottom: 1px solid rgba(255,255,255,.09); padding: 13px 0; }
  .faq summary { cursor: pointer; color: #e8ecf6; font-weight: 650; line-height: 1.5; }
  .faq summary::marker { color: #00e5ff; }
  .faq details p { margin: 10px 0 0; font-size: 14.5px; }
  footer { margin-top: 40px; font-size: 13px; color: #7a839c; }
  footer a { color: #8e98b3; }
  .risk { font-size: 13px; color: #8e98b3; border-inline-start: 2px solid #ffb300; padding-inline-start: 12px; margin-top: 26px; }
</style>
</head>
<body>
<main>
  <nav class="crumb" aria-label="${esc(ui.breadcrumb)}">
    <a href="${esc(SITE)}/">${esc(ui.home)}</a>
    <span aria-hidden="true">/</span>
    <span aria-current="page">${esc(page.h1)}</span>
  </nav>

  <div class="brand">
    <img src="/icon-192.png" alt="" width="30" height="30">
    <span>FBT Swap</span>
  </div>

  <h1>${esc(page.h1)}</h1>

  ${page.body.map((p) => `<p>${esc(p)}</p>`).join('\n  ')}

  <a class="cta" href="${esc(appUrl)}">${esc(page.ctaLabel || 'Open the app')}</a>

  <h2>${esc(page.glanceLabel || 'At a glance')}</h2>
  <table>
    <tbody>
      ${page.facts.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('\n      ')}
    </tbody>
  </table>

  ${faqMarkup}

  <p class="risk">${esc(
    page.riskText ||
      'Crypto assets are volatile and on-chain transactions cannot be reversed. You can lose money, including all of it. Nothing here is financial advice.'
  )}</p>

  <footer>
    <p>
      ${/*
         Same-language siblings only. A Persian page footer full of English
         links sends the reader somewhere they cannot read, and gives the
         crawler a mixed-language cluster that muddies which page belongs to
         which audience.
      */ ''}${PAGES.filter((p) => p.slug !== page.slug && (p.lang || 'en') === lang)
        .map((p) => `<a href="/${encodeURIComponent(p.slug)}">${esc(p.h1)}</a>`)
        .join(' &middot; ')}
    </p>
    <p>
      <a href="${esc(SITE)}/">FBT Swap</a> &middot;
      <a href="${esc(SITE)}/#/legal/privacy">Privacy</a> &middot;
      <a href="${esc(SITE)}/#/legal/terms">Terms</a><br>
      Fanous Bazaar Pishgam Co., Isfahan, Iran
    </p>
  </footer>
</main>
</body>
</html>
`;
}

/* -------------------------------------------------------------------------- */

function main() {
  for (const page of PAGES) {
    /*
     * A DIRECTORY with index.html, not `slug.html`. Static hosts serve
     * `/slug/` from `/slug/index.html`, giving a clean URL with no extension
     * — and a URL that ends in `.html` looks abandoned in 2026.
     */
    const dir = join(OUT, page.slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), render(page), 'utf8');
  }

  /*
   * Rewrite the sitemap so the new pages are actually discoverable. Submitting
   * a sitemap that omits them would leave the whole exercise depending on
   * Google finding the links on its own.
   */
  /*
   * Do not manufacture a <lastmod> date here. This generator runs on every
   * deployment, including deployments that only change JavaScript or server
   * code; stamping every landing page with "today" would tell crawlers its
   * editorial content changed when it did not. Omission is more honest than
   * stale or synthetic metadata, and new URLs are still discoverable through
   * this sitemap, robots.txt, internal links and IndexNow.
   */
  const urls = [
    `  <url>\n    <loc>${SITE}/</loc>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>`,
    ...PAGES.map(
      (p) =>
        `  <url>\n    <loc>${SITE}/${encodeURIComponent(p.slug)}</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.8</priority>\n  </url>`
    )
  ];

  writeFileSync(
    join(OUT, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Generated by scripts/gen-landing.mjs — do not edit by hand.

  Only real, server-rendered URLs are listed. In-app routes are hash-based
  (/#/swap) and a crawler never sees anything after the '#', so listing them
  would add entries that resolve to the same single document.
-->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`,
    'utf8'
  );

  // Sanity check: the app's own index must still be there. A generator that
  // overwrote it would take the whole site down.
  readFileSync(join(OUT, 'index.html'), 'utf8');

  console.log(`▸ generated ${PAGES.length} landing pages + sitemap`);
  for (const p of PAGES) console.log(`  /${p.slug}`);
}

main();
