/**
 * NETWORK PAGES — one per supported chain, in both languages.
 * ---------------------------------------------------------------------------
 * "Swap on Base", "Arbitrum gas fees", "which chain is cheapest" are real
 * queries with real intent, and a single /networks page answers none of them
 * well. So there is one page per network: 17 chains × 2 languages.
 *
 * THESE ARE GENERATED, AND THAT IS THE POINT. Every hard fact on a network
 * page — chain ID, native gas token, block explorer, the DEX the liquidity is
 * routed through, the size of the built-in token list — is read out of
 * src/lib/chains.js at build time. Nobody can add a chain to the app and leave
 * a page claiming the old count, and nobody can typo a chain ID into a page
 * that tells a user which network to add to their wallet.
 *
 * What is NOT generated is the editorial. PROFILES below carries bespoke prose
 * per chain: what it is, why anyone swaps there, how gas actually behaves, the
 * specific thing that catches people out, and how assets get on and off. Thirty
 * -four pages built from one paragraph of boilerplate would be a doorway-page
 * farm and would deserve everything Google did to it. The structure repeats;
 * the substance does not.
 */

import { EVM_CHAINS, EVM_CHAIN_ORDER, TOKENS, FEE_BPS } from '../../src/lib/chains.js';
import { article } from './schema.mjs';

const FEE_PCT = (FEE_BPS / 100).toFixed(2);

/** Solana is not in EVM_CHAINS — it has no chain ID and a different account model. */
const SOLANA = {
  id: 'solana',
  name: 'Solana',
  short: 'SOL',
  native: { symbol: 'SOL' },
  explorer: 'https://solscan.io',
  dexName: 'Jupiter'
};

/*
 * ─── PER-CHAIN EDITORIAL ─────────────────────────────────────────────────────
 * slug      the URL segment under /networks/
 * what      what this chain is, in one honest sentence
 * why       the reason someone would choose to swap here rather than elsewhere
 * gas       how fees actually behave here, including the unflattering part
 * bridge    how assets arrive, and the risk that carries
 * caution   the specific mistake this chain produces
 */
const PROFILES = {
  56: {
    slug: 'bnb-smart-chain',
    faName: 'بی‌ان‌بی چین',
    en: {
      what: 'BNB Smart Chain is an EVM chain run by a comparatively small validator set, which is the trade that buys it low fees and fast blocks.',
      why: 'It carries deep stablecoin liquidity and the widest retail token coverage of any chain here, so small and mid-size swaps usually fill with less price impact than the same order on a quieter network.',
      gas: 'Gas is paid in BNB and is normally a few cents. It is stable enough that most users stop thinking about it, which is exactly when they forget to keep a BNB balance and a swap fails for want of a fraction of a dollar.',
      bridge: 'Most assets arrive here from a centralised exchange withdrawal rather than a bridge, and that is usually the cheapest route. Withdraw to the BSC network specifically — an exchange that offers several networks for the same ticker will happily send on the wrong one.',
      caution: 'This chain hosts more scam tokens than any other on the list, because listing costs nothing. A token that matches a famous name is not that token. Verify the contract address against a source you trust before you swap into it, never after.'
    },
    fa: {
      what: 'بی‌ان‌بی چین یک شبکهٔ سازگار با EVM است که با مجموعهٔ اعتبارسنج نسبتاً کوچک کار می‌کند و همین معامله است که کارمزد پایین و بلاک سریع را برایش می‌خرد.',
      why: 'نقدینگی استیبل‌کوین عمیقی دارد و گسترده‌ترین پوشش توکن‌های خرد را در میان شبکه‌های این فهرست ارائه می‌کند، بنابراین سواپ‌های کوچک و متوسط معمولاً با اثر قیمتی کمتری نسبت به همان سفارش روی شبکه‌ای خلوت‌تر پر می‌شوند.',
      gas: 'کارمزد با BNB پرداخت می‌شود و معمولاً چند سنت است. آن‌قدر باثبات است که بیشتر کاربران دیگر به آن فکر نمی‌کنند و دقیقاً همان‌جا یادشان می‌رود مقداری BNB نگه دارند و سواپ به‌خاطر کسری کمتر از یک دلار ناموفق می‌شود.',
      bridge: 'بیشتر دارایی‌ها از طریق برداشت از صرافی متمرکز به اینجا می‌رسند، نه از پل، و همین معمولاً ارزان‌ترین مسیر است. حتماً روی شبکهٔ BSC برداشت کن؛ صرافی‌ای که برای یک نماد چند شبکه پیشنهاد می‌دهد، بدون تردید روی شبکهٔ اشتباه هم می‌فرستد.',
      caution: 'این شبکه بیش از هر شبکهٔ دیگری در این فهرست توکن کلاهبرداری دارد، چون ساخت توکن هزینه‌ای ندارد. توکنی که اسمش شبیه یک نام مشهور است، آن توکن نیست. آدرس قرارداد را پیش از سواپ با منبعی که به آن اعتماد داری تطبیق بده، نه بعد از آن.'
    }
  },
  1: {
    slug: 'ethereum',
    faName: 'اتریوم',
    en: {
      what: 'Ethereum is the settlement layer the rest of this list is measured against: the most decentralised validator set, the deepest liquidity, and the highest cost per transaction by a wide margin.',
      why: 'For large orders it is often still the cheapest chain in total, because depth matters more than gas once the trade is big enough. A six-figure swap that costs forty dollars in gas but loses nothing to price impact beats a free swap that moves the pool two percent.',
      gas: 'Gas is paid in ETH and is genuinely volatile — single-digit gwei on a quiet Sunday, many times that during a mint or a liquidation cascade. The fee you are quoted is an estimate of a moving target, and a transaction submitted too cheaply can sit pending for a long time.',
      bridge: 'Ethereum is the hub every rollup on this list bridges back to, so assets usually arrive by withdrawing from a layer 2 or from an exchange. Withdrawals from a rollup to Ethereum carry a challenge delay on optimistic chains, which is a feature of the security model and not a malfunction.',
      caution: 'Old token approvals accumulate here more than anywhere else, because this is where people have been transacting longest. An unlimited approval granted to a contract in 2021 is still live today unless it was revoked, and it is still exactly as dangerous.'
    },
    fa: {
      what: 'اتریوم همان لایهٔ تسویه‌ای است که بقیهٔ این فهرست با آن سنجیده می‌شود: غیرمتمرکزترین مجموعهٔ اعتبارسنج، عمیق‌ترین نقدینگی، و با فاصلهٔ زیاد بالاترین هزینه به ازای هر تراکنش.',
      why: 'برای سفارش‌های بزرگ هنوز هم اغلب در مجموع ارزان‌ترین شبکه است، چون وقتی معامله به‌اندازهٔ کافی بزرگ شود عمق نقدینگی بیشتر از کارمزد شبکه اهمیت پیدا می‌کند. سواپی که چهل دلار کارمزد شبکه می‌دهد اما اثر قیمتی ندارد، از سواپ رایگانی که استخر را دو درصد جابه‌جا می‌کند بهتر است.',
      gas: 'کارمزد با ETH پرداخت می‌شود و واقعاً نوسان دارد — در یک یکشنبهٔ آرام تک‌رقمی برحسب gwei و در زمان عرضه یا آبشار لیکوئید شدن چند برابر. عددی که به تو نشان داده می‌شود تخمینی از یک هدف متحرک است و تراکنشی که با کارمزد خیلی کم ارسال شود می‌تواند مدت‌ها در صف بماند.',
      bridge: 'اتریوم همان مرکزی است که هر رول‌آپ این فهرست به آن برمی‌گردد، پس دارایی‌ها معمولاً با برداشت از یک لایهٔ دو یا از صرافی می‌رسند. برداشت از رول‌آپ خوش‌بینانه به اتریوم تأخیر دورهٔ اعتراض دارد؛ این بخشی از مدل امنیتی است، نه خرابی.',
      caution: 'مجوزهای قدیمی توکن اینجا بیش از هر جای دیگری انباشته می‌شوند، چون مردم از همین‌جا زودتر از همه‌جا شروع به تراکنش کردند. مجوز نامحدودی که در سال ۲۰۲۱ به یک قرارداد داده‌ای، اگر باطل نشده باشد هنوز فعال است و دقیقاً به همان اندازه خطرناک.'
    }
  },
  137: {
    slug: 'polygon',
    faName: 'پالیگان',
    en: {
      what: 'Polygon PoS is a long-running EVM sidechain with its own validator set, which means it does not inherit Ethereum security the way a rollup does.',
      why: 'It has one of the longest-established stablecoin and payments ecosystems outside Ethereum, and fees low enough that routine, small, repeated transfers actually make sense here.',
      gas: 'Gas is paid in POL. Transactions cost a fraction of a cent most of the time, and the practical failure mode is not cost but congestion during popular mints, when a low gas price leaves a transaction stuck behind better-paying ones.',
      bridge: 'Both the official bridge and third-party bridges serve this chain, and exchanges support direct Polygon withdrawals. Check which USDC you are receiving: the native issuer version and the older bridged version both circulate here and they are different tokens.',
      caution: 'The two USDC variants are the single most common source of confusion on this network. A balance that "disappeared" is almost always the other variant sitting at a different contract address, visible in the explorer under your same wallet.'
    },
    fa: {
      what: 'پالیگان PoS یک ساید‌چین قدیمی و سازگار با EVM است که مجموعهٔ اعتبارسنج خودش را دارد؛ یعنی امنیت اتریوم را آن‌طور که یک رول‌آپ به ارث می‌برد، به ارث نمی‌برد.',
      why: 'یکی از جاافتاده‌ترین زیست‌بوم‌های استیبل‌کوین و پرداخت بیرون از اتریوم را دارد و کارمزدش آن‌قدر پایین است که انتقال‌های کوچک و تکرارشونده واقعاً اینجا منطقی باشند.',
      gas: 'کارمزد با POL پرداخت می‌شود. بیشتر اوقات هزینهٔ تراکنش کسری از یک سنت است و مشکل عملی نه هزینه، بلکه شلوغی در زمان عرضه‌های پرطرفدار است که تراکنش با کارمزد پایین پشت تراکنش‌های گران‌تر می‌ماند.',
      bridge: 'هم پل رسمی و هم پل‌های شخص ثالث این شبکه را پوشش می‌دهند و صرافی‌ها برداشت مستقیم پالیگان دارند. حواست باشد کدام USDC را می‌گیری: نسخهٔ بومی ناشر و نسخهٔ قدیمی پل‌شده هر دو اینجا در گردش‌اند و دو توکن متفاوت‌اند.',
      caution: 'همین دو نسخهٔ USDC رایج‌ترین منبع سردرگمی روی این شبکه است. موجودی‌ای که «ناپدید شده» تقریباً همیشه همان نسخهٔ دیگر است که روی آدرس قرارداد متفاوتی نشسته و در کاوشگر، زیر همان کیف پول خودت دیده می‌شود.'
    }
  },
  42161: {
    slug: 'arbitrum',
    faName: 'آربیتروم',
    en: {
      what: 'Arbitrum One is an optimistic rollup: it executes transactions off Ethereum and posts the data back, inheriting Ethereum security with a challenge window attached.',
      why: 'It holds the deepest DeFi liquidity of any layer 2, so derivatives, lending and larger spot swaps all fill here at prices that are usually close to Ethereum without Ethereum gas.',
      gas: 'Gas is paid in ETH and has two components: the small execution cost on Arbitrum and the cost of posting your data to Ethereum. The second one dominates, which is why Arbitrum fees rise when Ethereum is busy even though Arbitrum itself is not.',
      bridge: 'The canonical bridge from Ethereum deposits in minutes. Withdrawing the same way takes about a week — the challenge period that makes an optimistic rollup safe. Third-party bridges and exchange withdrawals skip that wait by taking on the risk themselves and charging for it.',
      caution: 'People bridge in, swap, and then discover they have no ETH left for gas because the whole balance went into the trade. Keep a small ETH reserve on this chain specifically; it is a separate balance from your Ethereum one.'
    },
    fa: {
      what: 'آربیتروم وان یک رول‌آپ خوش‌بینانه است: تراکنش‌ها را بیرون از اتریوم اجرا می‌کند و داده را به اتریوم برمی‌گرداند، پس امنیت اتریوم را با یک دورهٔ اعتراض به ارث می‌برد.',
      why: 'عمیق‌ترین نقدینگی دیفای را در میان لایه‌های دو دارد، بنابراین مشتقات، وام‌دهی و سواپ‌های نقدی بزرگ‌تر همگی اینجا با قیمتی نزدیک به اتریوم پر می‌شوند، بدون کارمزد اتریوم.',
      gas: 'کارمزد با ETH پرداخت می‌شود و دو بخش دارد: هزینهٔ کوچک اجرا روی آربیتروم و هزینهٔ ثبت دادهٔ تو روی اتریوم. بخش دوم غالب است و به همین دلیل وقتی اتریوم شلوغ می‌شود کارمزد آربیتروم بالا می‌رود، حتی اگر خود آربیتروم شلوغ نباشد.',
      bridge: 'پل رسمی از اتریوم در چند دقیقه واریز می‌کند. برداشت از همان مسیر حدود یک هفته طول می‌کشد؛ همان دورهٔ اعتراضی که رول‌آپ خوش‌بینانه را امن می‌کند. پل‌های شخص ثالث و برداشت از صرافی این انتظار را حذف می‌کنند چون ریسک را خودشان می‌پذیرند و بابتش هزینه می‌گیرند.',
      caution: 'کاربران دارایی را پل می‌کنند، سواپ می‌زنند و بعد می‌بینند ETH برای کارمزد ندارند چون کل موجودی وارد معامله شده است. روی همین شبکه مقدار کمی ETH ذخیره نگه دار؛ این موجودی از موجودی اتریوم تو جداست.'
    }
  },
  8453: {
    slug: 'base',
    faName: 'بیس',
    en: {
      what: 'Base is an optimistic rollup built on the OP Stack and operated by Coinbase, which gives it an unusually direct path between an exchange account and an on-chain wallet.',
      why: 'That path is the reason liquidity arrived here quickly. Onboarding is the easiest of any chain on this list for someone whose funds already sit at an exchange, and the stablecoin depth followed the users.',
      gas: 'Gas is paid in ETH and is typically a fraction of a cent, because Base posts its data cheaply. Fees still track Ethereum data costs, so a very busy day on Ethereum is visible here too, just scaled down.',
      bridge: 'Direct withdrawal from Coinbase to Base is the cheapest and fastest route and avoids a bridge entirely. The canonical OP Stack bridge works from Ethereum, with the same multi-day challenge window on the way back out.',
      caution: 'Base attracts a very high volume of newly launched tokens, and most of them are worth nothing within a week. The chain being reputable says nothing at all about the token you are about to buy on it.'
    },
    fa: {
      what: 'بیس یک رول‌آپ خوش‌بینانه بر پایهٔ OP Stack است که کوین‌بیس آن را اداره می‌کند و همین مسیر غیرمعمولِ مستقیمی میان حساب صرافی و کیف پول آن‌چین به آن می‌دهد.',
      why: 'همین مسیر دلیل سرعت ورود نقدینگی به اینجاست. برای کسی که پولش از قبل در صرافی است، ورود به این شبکه ساده‌ترین مورد در کل فهرست است و عمق استیبل‌کوین هم به‌دنبال کاربران آمد.',
      gas: 'کارمزد با ETH پرداخت می‌شود و معمولاً کسری از یک سنت است، چون بیس داده‌اش را ارزان ثبت می‌کند. با این حال کارمزد همچنان هزینهٔ دادهٔ اتریوم را دنبال می‌کند، پس یک روز خیلی شلوغ روی اتریوم اینجا هم دیده می‌شود، فقط کوچک‌تر.',
      bridge: 'برداشت مستقیم از کوین‌بیس به بیس ارزان‌ترین و سریع‌ترین مسیر است و اصلاً نیازی به پل ندارد. پل رسمی OP Stack از اتریوم کار می‌کند و در مسیر برگشت همان دورهٔ اعتراض چندروزه را دارد.',
      caution: 'بیس حجم بسیار بالایی از توکن‌های تازه‌عرضه‌شده را جذب می‌کند و بیشترشان ظرف یک هفته بی‌ارزش می‌شوند. معتبر بودن شبکه هیچ چیزی دربارهٔ توکنی که می‌خواهی روی آن بخری نمی‌گوید.'
    }
  },
  10: {
    slug: 'optimism',
    faName: 'اپتیمیسم',
    en: {
      what: 'Optimism is the optimistic rollup the OP Stack is named after, and the reference implementation several other chains on this list are forks of.',
      why: 'It has a mature DeFi set, reliable stablecoin depth and a governance model that has actually funded public goods rather than only talking about it. For routine swaps it behaves much like Arbitrum at a similar cost.',
      gas: 'Gas is paid in ETH, usually well under a cent. As with every rollup here, the bulk of what you pay is the cost of publishing your transaction data to Ethereum rather than the cost of executing it.',
      bridge: 'The canonical bridge from Ethereum is fast inbound and subject to the standard seven-day challenge period outbound. Most exchanges support direct Optimism withdrawals, which is simpler for a first deposit.',
      caution: 'Optimism and Base share an architecture but are separate chains with separate balances. Tokens sent to an Optimism address expecting Base will not appear on Base, and the matching addresses across both chains make that mistake unusually easy to talk yourself into.'
    },
    fa: {
      what: 'اپتیمیسم همان رول‌آپ خوش‌بینانه‌ای است که OP Stack از نامش گرفته شده و پیاده‌سازی مرجعی است که چند شبکهٔ دیگر این فهرست از روی آن فورک شده‌اند.',
      why: 'مجموعهٔ دیفای پخته، عمق استیبل‌کوین قابل اتکا و مدل حاکمیتی‌ای دارد که واقعاً کالای عمومی تأمین مالی کرده است، نه اینکه فقط دربارهٔ آن حرف بزند. برای سواپ‌های روزمره رفتاری بسیار نزدیک به آربیتروم با هزینه‌ای مشابه دارد.',
      gas: 'کارمزد با ETH پرداخت می‌شود و معمولاً خیلی کمتر از یک سنت است. مثل هر رول‌آپ دیگری در این فهرست، بخش عمدهٔ چیزی که می‌پردازی هزینهٔ انتشار دادهٔ تراکنش روی اتریوم است، نه هزینهٔ اجرای آن.',
      bridge: 'پل رسمی از اتریوم در مسیر ورود سریع است و در مسیر خروج همان دورهٔ اعتراض هفت‌روزهٔ استاندارد را دارد. بیشتر صرافی‌ها برداشت مستقیم اپتیمیسم دارند که برای اولین واریز ساده‌تر است.',
      caution: 'اپتیمیسم و بیس معماری مشترک دارند اما دو شبکهٔ جدا با موجودی‌های جدا هستند. توکنی که به آدرس اپتیمیسم فرستاده شود روی بیس ظاهر نمی‌شود، و یکسان بودن آدرس در هر دو شبکه این اشتباه را به‌شکل غیرعادی آسان می‌کند.'
    }
  },
  43114: {
    slug: 'avalanche',
    faName: 'آوالانچ',
    en: {
      what: 'Avalanche C-Chain is the EVM-compatible chain inside the Avalanche network, with its own validator set and sub-second finality.',
      why: 'Finality here is genuinely fast and genuinely final, which matters more than headline throughput: once a transaction confirms you are not waiting on a reorg or a challenge window before treating it as settled.',
      gas: 'Gas is paid in AVAX and is modest but not negligible — usually cents rather than fractions of a cent. The base fee adjusts with demand, so costs rise during activity spikes the way they do on Ethereum, just from a much lower floor.',
      bridge: 'The official Avalanche bridge and the major third-party bridges all serve the C-Chain, and exchange withdrawals are well supported. Confirm you are withdrawing to C-Chain and not to the X-Chain or P-Chain, which are different address formats in the same ecosystem.',
      caution: 'The three-chain structure is the trap. An exchange that lets you pick X-Chain for an AVAX withdrawal will send it there, and a C-Chain wallet will not show it. Read the chain selector, not just the ticker.'
    },
    fa: {
      what: 'آوالانچ C-Chain همان زنجیرهٔ سازگار با EVM درون شبکهٔ آوالانچ است که مجموعهٔ اعتبارسنج خودش و نهایی‌شدن کمتر از یک ثانیه را دارد.',
      why: 'نهایی‌شدن اینجا واقعاً سریع و واقعاً قطعی است و همین از عدد توان عملیاتی مهم‌تر است: وقتی تراکنش تأیید شد، دیگر منتظر بازآرایی زنجیره یا دورهٔ اعتراض نمی‌مانی تا آن را تسویه‌شده بدانی.',
      gas: 'کارمزد با AVAX پرداخت می‌شود و کم است اما ناچیز نیست — معمولاً در حد چند سنت، نه کسری از سنت. کارمزد پایه با تقاضا تنظیم می‌شود، پس در اوج فعالیت مثل اتریوم بالا می‌رود، فقط از کفی بسیار پایین‌تر.',
      bridge: 'پل رسمی آوالانچ و پل‌های بزرگ شخص ثالث همگی C-Chain را پوشش می‌دهند و برداشت از صرافی‌ها هم به‌خوبی پشتیبانی می‌شود. مطمئن شو که روی C-Chain برداشت می‌کنی، نه X-Chain یا P-Chain که قالب آدرس متفاوتی در همان زیست‌بوم دارند.',
      caution: 'ساختار سه‌زنجیره‌ای همان تله است. صرافی‌ای که اجازه می‌دهد برای برداشت AVAX گزینهٔ X-Chain را انتخاب کنی، واقعاً به همان‌جا می‌فرستد و کیف پول C-Chain آن را نشان نمی‌دهد. انتخابگر شبکه را بخوان، نه فقط نماد را.'
    }
  },
  59144: {
    slug: 'linea',
    faName: 'لینیا',
    en: {
      what: 'Linea is a zkEVM rollup: it proves its execution to Ethereum cryptographically rather than assuming honesty and allowing challenges.',
      why: 'A validity proof means withdrawals back to Ethereum do not need a week-long challenge window, which makes it structurally better suited to moving funds in and out than an optimistic rollup.',
      gas: 'Gas is paid in ETH and is low. Proving costs are real but amortised across everyone in a batch, so per-transaction cost falls as the chain gets busier — the opposite of the relationship most users expect.',
      bridge: 'The official bridge from Ethereum is the main route in, and exchange support has grown steadily. Outbound finalisation depends on proof generation rather than a fixed dispute period, so the wait is shorter but not instant.',
      caution: 'This is a younger chain with thinner pools than Arbitrum or Base. The same order that barely moves the price on a major L2 can take meaningful price impact here, so check the quoted impact rather than assuming the rate.'
    },
    fa: {
      what: 'لینیا یک رول‌آپ zkEVM است: اجرای خود را به‌صورت رمزنگاشتی به اتریوم اثبات می‌کند، به‌جای اینکه صداقت را فرض بگیرد و امکان اعتراض بدهد.',
      why: 'اثبات اعتبار یعنی برداشت به اتریوم نیازی به دورهٔ اعتراض یک‌هفته‌ای ندارد و همین از نظر ساختاری آن را برای جابه‌جایی رفت و برگشت پول مناسب‌تر از رول‌آپ خوش‌بینانه می‌کند.',
      gas: 'کارمزد با ETH پرداخت می‌شود و پایین است. هزینهٔ تولید اثبات واقعی است اما بین همهٔ تراکنش‌های یک دسته تقسیم می‌شود، پس هرچه شبکه شلوغ‌تر شود هزینهٔ هر تراکنش پایین‌تر می‌آید — برعکس چیزی که بیشتر کاربران انتظار دارند.',
      bridge: 'پل رسمی از اتریوم مسیر اصلی ورود است و پشتیبانی صرافی‌ها هم به‌تدریج بیشتر شده. نهایی‌شدن در مسیر خروج به تولید اثبات بستگی دارد نه به یک دورهٔ ثابت اعتراض، پس انتظار کوتاه‌تر است اما فوری نیست.',
      caution: 'این شبکه جوان‌تر است و استخرهایش از آربیتروم و بیس کم‌عمق‌ترند. همان سفارشی که روی یک لایهٔ دو بزرگ تقریباً قیمت را تکان نمی‌دهد، اینجا می‌تواند اثر قیمتی محسوسی بگذارد؛ پس به‌جای فرض‌کردن نرخ، اثر قیمتی اعلام‌شده را ببین.'
    }
  },
  146: {
    slug: 'sonic',
    faName: 'سونیک',
    en: {
      what: 'Sonic is a high-throughput EVM chain and the successor to Fantom, carrying over much of that ecosystem under a new token and a rebuilt execution layer.',
      why: 'It is built around speed and a fee-sharing model that returns part of transaction fees to the applications generating them, which has attracted developers looking for economics other chains do not offer.',
      gas: 'Gas is paid in S and is very cheap with near-instant confirmation. Low cost is the headline; the fine print is that a chain this young has not yet been stress-tested by a genuine market panic.',
      bridge: 'The official Sonic gateway handles migration and bridging from Ethereum, and exchange support exists but is narrower than for the major chains. Confirm your destination supports Sonic before withdrawing anything.',
      caution: 'Liquidity is concentrated in a handful of pools. Depth outside the main stablecoin and native pairs can disappear quickly, so a size that is routine elsewhere may be a large order here. Read the price impact every time.'
    },
    fa: {
      what: 'سونیک یک شبکهٔ EVM با توان عملیاتی بالا و جانشین فانتوم است که بخش بزرگی از آن زیست‌بوم را با توکنی تازه و لایهٔ اجرای بازسازی‌شده منتقل کرده است.',
      why: 'حول سرعت و مدل تقسیم کارمزد ساخته شده که بخشی از کارمزد تراکنش‌ها را به همان برنامه‌هایی برمی‌گرداند که آن‌ها را تولید کرده‌اند، و همین توسعه‌دهندگانی را جذب کرده که دنبال اقتصادی متفاوت با سایر شبکه‌ها هستند.',
      gas: 'کارمزد با S پرداخت می‌شود، بسیار ارزان است و تأیید تقریباً آنی. هزینهٔ پایین تیتر ماجراست؛ نکتهٔ ریز این است که شبکه‌ای به این جوانی هنوز با یک وحشت واقعی بازار آزمون پس نداده است.',
      bridge: 'دروازهٔ رسمی سونیک مهاجرت و پل‌زدن از اتریوم را انجام می‌دهد و پشتیبانی صرافی‌ها وجود دارد اما محدودتر از شبکه‌های بزرگ است. پیش از هر برداشتی مطمئن شو مقصد از سونیک پشتیبانی می‌کند.',
      caution: 'نقدینگی در چند استخر معدود متمرکز است. عمق بازار بیرون از جفت‌های اصلی استیبل‌کوین و توکن بومی می‌تواند سریع تمام شود، پس حجمی که جای دیگر عادی است ممکن است اینجا سفارش بزرگی باشد. هر بار اثر قیمتی را بخوان.'
    }
  },
  5000: {
    slug: 'mantle',
    faName: 'منتل',
    en: {
      what: 'Mantle is an EVM rollup that separates data availability from execution, using a dedicated layer for data rather than posting everything to Ethereum.',
      why: 'That design is what keeps its fees low even when Ethereum data costs spike, and it is backed by one of the largest treasuries in the space, which has funded unusually deep incentives for early liquidity.',
      gas: 'Gas is paid in MNT, not ETH. This catches people out constantly: you can hold a perfectly healthy ETH balance on Mantle and still be unable to transact, because the gas token is the chain native token.',
      bridge: 'The official Mantle bridge connects to Ethereum, and several exchanges support MNT and direct Mantle withdrawals. Bridge a small amount of MNT first, before you need it for gas on a transaction you actually care about.',
      caution: 'The modular data-availability design means the security assumptions are not identical to a rollup that posts everything to Ethereum. That is a reasonable trade, but it is a trade, and it is worth understanding before you park a large balance here.'
    },
    fa: {
      what: 'منتل یک رول‌آپ EVM است که در دسترس بودن داده را از اجرا جدا می‌کند و به‌جای ثبت همه‌چیز روی اتریوم، از لایه‌ای اختصاصی برای داده استفاده می‌کند.',
      why: 'همین طراحی باعث می‌شود کارمزدش حتی وقتی هزینهٔ دادهٔ اتریوم جهش می‌کند پایین بماند، و یکی از بزرگ‌ترین خزانه‌های این فضا پشتش است که مشوق‌های عمیقی برای نقدینگی اولیه تأمین کرده.',
      gas: 'کارمزد با MNT پرداخت می‌شود، نه ETH. این موضوع مدام کاربران را غافلگیر می‌کند: می‌توانی موجودی ETH کاملاً سالمی روی منتل داشته باشی و باز هم نتوانی تراکنش بزنی، چون توکن کارمزد همان توکن بومی شبکه است.',
      bridge: 'پل رسمی منتل به اتریوم وصل می‌شود و چند صرافی از MNT و برداشت مستقیم منتل پشتیبانی می‌کنند. اول مقدار کمی MNT پل بزن، پیش از آنکه برای تراکنشی که واقعاً برایت مهم است به آن نیاز پیدا کنی.',
      caution: 'طراحی ماژولار در دسترس بودن داده یعنی فرض‌های امنیتی دقیقاً با رول‌آپی که همه‌چیز را روی اتریوم ثبت می‌کند یکسان نیست. این معاملهٔ معقولی است، اما بالاخره یک معامله است و بهتر است پیش از پارک‌کردن موجودی بزرگ اینجا آن را بفهمی.'
    }
  },
  80094: {
    slug: 'berachain',
    faName: 'برا‌چین',
    en: {
      what: 'Berachain is an EVM chain built around proof-of-liquidity, a consensus design where securing the chain and providing liquidity to it are the same activity.',
      why: 'That makes its incentive structure genuinely different from every other chain here: liquidity is not a side effect of usage, it is what validators are rewarded for supplying.',
      gas: 'Gas is paid in BERA. Fees are low, but the three-token model — the gas token, the governance token and the staking receipt — takes real effort to understand before any of the yield numbers mean anything.',
      bridge: 'Bridging is handled by third-party bridges and a growing set of exchange listings. This is a newer chain, so verify any bridge you use against the official documentation rather than a search result or a social post.',
      caution: 'High advertised yields here are a function of emissions, not of fees being paid by users. That is not automatically bad, but a yield funded by token issuance behaves very differently from one funded by revenue, and it can end quickly.'
    },
    fa: {
      what: 'برا‌چین یک شبکهٔ EVM است که حول اثبات نقدینگی ساخته شده؛ طراحی اجماعی که در آن تأمین امنیت شبکه و تأمین نقدینگی آن یک کار واحدند.',
      why: 'همین ساختار انگیزشی را واقعاً متفاوت از هر شبکهٔ دیگری در این فهرست می‌کند: نقدینگی اثر جانبی استفاده نیست، بلکه دقیقاً همان چیزی است که اعتبارسنج‌ها بابت تأمینش پاداش می‌گیرند.',
      gas: 'کارمزد با BERA پرداخت می‌شود. هزینه‌ها پایین است، اما مدل سه‌توکنی — توکن کارمزد، توکن حاکمیتی و رسید استیکینگ — پیش از آنکه هیچ‌کدام از اعداد بازدهی معنا پیدا کنند، تلاش واقعی برای فهمیدن می‌خواهد.',
      bridge: 'پل‌زدن از طریق پل‌های شخص ثالث و فهرست رو به رشدی از صرافی‌ها انجام می‌شود. این شبکه تازه‌تر است، پس هر پلی را که استفاده می‌کنی با مستندات رسمی تطبیق بده، نه با نتیجهٔ جست‌وجو یا یک پست شبکهٔ اجتماعی.',
      caution: 'بازدهی‌های بالایی که اینجا تبلیغ می‌شوند نتیجهٔ انتشار توکن‌اند، نه کارمزدی که کاربران می‌پردازند. این خودبه‌خود بد نیست، اما بازدهی‌ای که از انتشار توکن تأمین می‌شود رفتاری کاملاً متفاوت با بازدهی‌ای دارد که از درآمد می‌آید و می‌تواند سریع تمام شود.'
    }
  },
  130: {
    slug: 'unichain',
    faName: 'یونی‌چین',
    en: {
      what: 'Unichain is an OP Stack rollup built by the team behind Uniswap, designed specifically around the needs of decentralised trading rather than general computation.',
      why: 'A chain tuned for swaps can make choices a general-purpose chain cannot, including block-building rules aimed at reducing the value extractable from reordering trades.',
      gas: 'Gas is paid in ETH and is low, in line with other OP Stack chains. Costs follow Ethereum data pricing, so the floor moves with Ethereum even though execution here is cheap.',
      bridge: 'The canonical OP Stack bridge from Ethereum is the main route, with exchange support still developing. Treat a newer chain as a reason to move a test amount first.',
      caution: 'Reduced MEV exposure is a design goal and a real improvement. It is not immunity. A public transaction is still a public transaction, and no chain-level change makes a swap unfrontrunnable in every circumstance.'
    },
    fa: {
      what: 'یونی‌چین یک رول‌آپ OP Stack است که تیم پشت یونی‌سواپ آن را ساخته و به‌طور مشخص حول نیازهای معاملهٔ غیرمتمرکز طراحی شده، نه محاسبات عمومی.',
      why: 'شبکه‌ای که برای سواپ تنظیم شده می‌تواند تصمیم‌هایی بگیرد که یک شبکهٔ همه‌منظوره نمی‌تواند، از جمله قواعد ساخت بلاک با هدف کاهش ارزشی که از بازچینش معاملات قابل استخراج است.',
      gas: 'کارمزد با ETH پرداخت می‌شود و پایین است، هم‌تراز با سایر شبکه‌های OP Stack. هزینه‌ها قیمت دادهٔ اتریوم را دنبال می‌کنند، پس کف هزینه با اتریوم جابه‌جا می‌شود حتی اگر اجرا اینجا ارزان باشد.',
      bridge: 'پل رسمی OP Stack از اتریوم مسیر اصلی است و پشتیبانی صرافی‌ها هنوز در حال شکل‌گیری است. شبکهٔ تازه‌تر یعنی دلیل کافی برای اینکه اول مبلغی آزمایشی بفرستی.',
      caution: 'کاهش قرارگیری در معرض MEV یک هدف طراحی و بهبودی واقعی است، اما مصونیت نیست. تراکنش عمومی همچنان تراکنش عمومی است و هیچ تغییری در سطح شبکه سواپ را در همهٔ شرایط غیرقابل پیش‌دستی نمی‌کند.'
    }
  },
  143: {
    slug: 'monad',
    faName: 'موناد',
    en: {
      what: 'Monad is an EVM chain that re-implements the execution layer for parallel processing, keeping bytecode compatibility while changing how transactions are run underneath.',
      why: 'The goal is Ethereum semantics at throughput Ethereum cannot reach, so existing contracts deploy unchanged while the chain itself handles far more of them at once.',
      gas: 'Gas is paid in MON. Fees are very low by design, which is what parallel execution is for — the constraint it removes is exactly the one that makes blockspace scarce and expensive.',
      bridge: 'Bridging is through third-party routes and a developing set of exchange listings. This is among the newest chains supported here, so verify every address and every bridge against official sources.',
      caution: 'New chain, thin pools, and an ecosystem still forming. Liquidity for anything outside the main pairs can be shallow enough that the price impact on a modest order is larger than every fee on the transaction combined.'
    },
    fa: {
      what: 'موناد یک شبکهٔ EVM است که لایهٔ اجرا را برای پردازش موازی بازنویسی کرده و در عین حفظ سازگاری بایت‌کد، شیوهٔ اجرای تراکنش‌ها را در زیر لایه تغییر داده است.',
      why: 'هدف، معناشناسی اتریوم با توان عملیاتی‌ای است که اتریوم به آن نمی‌رسد، پس قراردادهای موجود بدون تغییر مستقر می‌شوند و خود شبکه تعداد بسیار بیشتری از آن‌ها را هم‌زمان اجرا می‌کند.',
      gas: 'کارمزد با MON پرداخت می‌شود. هزینه‌ها از روی طراحی بسیار پایین‌اند و اجرای موازی دقیقاً برای همین است — محدودیتی که برمی‌دارد همان چیزی است که فضای بلاک را کمیاب و گران می‌کند.',
      bridge: 'پل‌زدن از مسیرهای شخص ثالث و فهرست در حال رشدی از صرافی‌ها انجام می‌شود. این یکی از تازه‌ترین شبکه‌های پشتیبانی‌شده اینجاست، پس هر آدرس و هر پلی را با منابع رسمی تطبیق بده.',
      caution: 'شبکهٔ تازه، استخرهای کم‌عمق و زیست‌بومی که هنوز در حال شکل‌گیری است. نقدینگی هر چیزی بیرون از جفت‌های اصلی می‌تواند آن‌قدر کم باشد که اثر قیمتی یک سفارش متوسط از مجموع همهٔ کارمزدهای تراکنش بیشتر شود.'
    }
  },
  534352: {
    slug: 'scroll',
    faName: 'اسکرول',
    en: {
      what: 'Scroll is a zkEVM rollup that aims for bytecode-level equivalence with Ethereum, so contracts behave the same way without modification.',
      why: 'Equivalence rather than mere compatibility matters for anything security-sensitive: a contract audited for Ethereum carries that audit over far more cleanly than it does to a chain that reimplements the EVM differently.',
      gas: 'Gas is paid in ETH and is low. Like other zk rollups, costs are dominated by data publication and proof generation, both of which are shared across the transactions in a batch.',
      bridge: 'The official Scroll bridge connects to Ethereum, with exchange support growing. Validity proofs mean withdrawals avoid the week-long optimistic challenge window, though finalisation still takes time.',
      caution: 'Liquidity is thinner here than on the largest rollups. The chain is technically sound; that is a separate question from whether a given pool can fill your order at the price you were quoted.'
    },
    fa: {
      what: 'اسکرول یک رول‌آپ zkEVM است که هدفش هم‌ارزی در سطح بایت‌کد با اتریوم است، تا قراردادها بدون تغییر دقیقاً همان‌طور رفتار کنند.',
      why: 'هم‌ارزی به‌جای صرفِ سازگاری برای هر چیز حساس به امنیت اهمیت دارد: قراردادی که برای اتریوم ممیزی شده، اعتبار آن ممیزی را خیلی تمیزتر از شبکه‌ای که EVM را جور دیگری پیاده کرده به اینجا منتقل می‌کند.',
      gas: 'کارمزد با ETH پرداخت می‌شود و پایین است. مثل دیگر رول‌آپ‌های zk، بخش عمدهٔ هزینه مربوط به انتشار داده و تولید اثبات است که هر دو بین تراکنش‌های یک دسته تقسیم می‌شوند.',
      bridge: 'پل رسمی اسکرول به اتریوم وصل می‌شود و پشتیبانی صرافی‌ها در حال رشد است. اثبات اعتبار یعنی برداشت‌ها دورهٔ اعتراض یک‌هفته‌ای خوش‌بینانه را ندارند، هرچند نهایی‌شدن باز هم زمان می‌برد.',
      caution: 'نقدینگی اینجا از بزرگ‌ترین رول‌آپ‌ها کم‌عمق‌تر است. شبکه از نظر فنی سالم است؛ اما این پرسشی جداست از اینکه آیا یک استخر مشخص می‌تواند سفارش تو را با نرخی که اعلام شده پر کند یا نه.'
    }
  },
  324: {
    slug: 'zksync-era',
    faName: 'زدکی‌سینک ارا',
    en: {
      what: 'zkSync Era is a zk rollup with its own compiler and account model, including native account abstraction rather than account abstraction bolted on.',
      why: 'Native account abstraction means smart-contract wallets, sponsored transactions and paying gas in a token other than ETH are first-class features here rather than workarounds.',
      gas: 'Gas is paid in ETH by default, but the account model allows paymasters to cover it or to accept another token. Costs are low and, as with other zk rollups, dominated by proving and data publication.',
      bridge: 'The official bridge from Ethereum is the main inbound route and exchange support is broad. Validity proofs mean no seven-day optimistic wait on the way out.',
      caution: 'Addresses on zkSync Era are not always derived the way they are on other EVM chains, because contract deployment works differently. Do not assume an address you control elsewhere is an address you control here — verify before sending.'
    },
    fa: {
      what: 'زدکی‌سینک ارا یک رول‌آپ zk با کامپایلر و مدل حساب اختصاصی خودش است، از جمله انتزاع حساب بومی به‌جای انتزاع حسابی که بعداً اضافه شده باشد.',
      why: 'انتزاع حساب بومی یعنی کیف پول‌های قراردادی، تراکنش‌های حمایت‌شده و پرداخت کارمزد با توکنی غیر از ETH اینجا امکانات درجه‌یک‌اند، نه راه‌حل‌های دور زدن محدودیت.',
      gas: 'کارمزد به‌صورت پیش‌فرض با ETH پرداخت می‌شود، اما مدل حساب اجازه می‌دهد پرداخت‌یارها آن را بپوشانند یا توکن دیگری را بپذیرند. هزینه‌ها پایین‌اند و مثل دیگر رول‌آپ‌های zk عمدتاً مربوط به اثبات و انتشار داده‌اند.',
      bridge: 'پل رسمی از اتریوم مسیر اصلی ورود است و پشتیبانی صرافی‌ها گسترده است. اثبات اعتبار یعنی در مسیر خروج انتظار هفت‌روزهٔ خوش‌بینانه وجود ندارد.',
      caution: 'آدرس‌ها روی زدکی‌سینک ارا همیشه مثل سایر شبکه‌های EVM مشتق نمی‌شوند، چون استقرار قرارداد اینجا متفاوت کار می‌کند. فرض نکن آدرسی که جای دیگر در اختیار توست اینجا هم در اختیار توست — پیش از ارسال تأیید کن.'
    }
  },
  4663: {
    slug: 'robinhood-chain',
    faName: 'رابین‌هود چین',
    en: {
      what: 'Robinhood Chain is an EVM network built for tokenised real-world assets, with the compliance and issuance machinery that implies built into the chain rather than bolted onto an application.',
      why: 'Tokenised equities and similar instruments have requirements a general-purpose chain does not serve well — transfer restrictions, identified participants, issuer controls — and a purpose-built chain can enforce them at the base layer.',
      gas: 'Gas is paid in ETH. Costs are low, but cost is rarely the deciding factor on a chain where the binding constraints are eligibility and access rather than fees.',
      bridge: 'Access routes here are narrower than on a general-purpose chain by design, and depend on the instrument and your jurisdiction. Check what is actually available to you before planning around it.',
      caution: 'A tokenised share is not a share. You hold a claim against an issuer, settled on-chain. Dividends, voting and what happens in a corporate action are decided by the issuing structure and its legal terms, not by the blockchain.'
    },
    fa: {
      what: 'رابین‌هود چین یک شبکهٔ EVM است که برای دارایی‌های واقعی توکنی‌شده ساخته شده و سازوکار انطباق و انتشار لازم را به‌جای افزودن به یک برنامه، درون خود شبکه دارد.',
      why: 'سهام توکنی‌شده و ابزارهای مشابه الزاماتی دارند که شبکهٔ همه‌منظوره خوب برآورده نمی‌کند — محدودیت انتقال، مشارکت‌کنندگان شناسایی‌شده، کنترل‌های ناشر — و شبکه‌ای که برای همین ساخته شده می‌تواند آن‌ها را در لایهٔ پایه اعمال کند.',
      gas: 'کارمزد با ETH پرداخت می‌شود. هزینه‌ها پایین است، اما روی شبکه‌ای که محدودیت‌های تعیین‌کننده‌اش واجد شرایط بودن و دسترسی است نه کارمزد، هزینه به‌ندرت عامل تصمیم‌گیری است.',
      bridge: 'مسیرهای دسترسی اینجا از روی طراحی محدودتر از یک شبکهٔ همه‌منظوره‌اند و به ابزار مالی و حوزهٔ قضایی تو بستگی دارند. پیش از برنامه‌ریزی، ببین واقعاً چه چیزی برای تو در دسترس است.',
      caution: 'سهم توکنی‌شده، سهم نیست. تو ادعایی علیه یک ناشر در اختیار داری که روی زنجیره تسویه می‌شود. سود نقدی، حق رأی و آنچه در یک رویداد شرکتی اتفاق می‌افتد را ساختار ناشر و شرایط حقوقی‌اش تعیین می‌کند، نه بلاک‌چین.'
    }
  },
  solana: {
    slug: 'solana',
    faName: 'سولانا',
    en: {
      what: 'Solana is not an EVM chain. It uses a different account model, different addresses and different tooling, and nothing about an Ethereum wallet carries over to it.',
      why: 'Fees are a fraction of a cent and confirmation is sub-second, which makes small and frequent swaps viable in a way they are not on most EVM chains. Liquidity across the major pairs is deep.',
      gas: 'Fees are paid in SOL and are tiny, but Solana also requires rent: a small SOL balance locked per token account you hold. Holding ten different tokens means ten accounts, each with its own rent deposit.',
      bridge: 'Assets arrive by exchange withdrawal or through a cross-chain bridge. Because the address format is completely different from an EVM address, a wrong-network send is usually rejected outright rather than silently lost — one of the few places where incompatibility helps.',
      caution: 'Token-2022 extensions can give a token behaviour a plain SPL token does not have, including transfer fees and, in some configurations, the ability to freeze an account. The extension set is a property of the token, not of Solana, and it is worth checking before you buy.'
    },
    fa: {
      what: 'سولانا شبکهٔ EVM نیست. مدل حساب، آدرس‌ها و ابزارهایش متفاوت‌اند و هیچ‌چیز از یک کیف پول اتریومی به آن منتقل نمی‌شود.',
      why: 'کارمزدها کسری از یک سنت‌اند و تأیید کمتر از یک ثانیه طول می‌کشد؛ همین سواپ‌های کوچک و پرتکرار را به‌شکلی ممکن می‌کند که روی بیشتر شبکه‌های EVM ممکن نیست. نقدینگی در جفت‌های اصلی عمیق است.',
      gas: 'کارمزد با SOL پرداخت می‌شود و بسیار ناچیز است، اما سولانا اجاره هم می‌گیرد: مقدار کمی SOL که به ازای هر حساب توکن قفل می‌شود. نگه‌داشتن ده توکن متفاوت یعنی ده حساب، هرکدام با سپردهٔ اجارهٔ خودش.',
      bridge: 'دارایی‌ها با برداشت از صرافی یا از طریق پل بین‌زنجیره‌ای می‌رسند. چون قالب آدرس کاملاً با آدرس EVM فرق دارد، ارسال روی شبکهٔ اشتباه معمولاً به‌کلی رد می‌شود به‌جای اینکه بی‌صدا از بین برود — یکی از معدود جاهایی که ناسازگاری به کمک می‌آید.',
      caution: 'افزونه‌های Token-2022 می‌توانند به یک توکن رفتاری بدهند که توکن SPL ساده ندارد، از جمله کارمزد انتقال و در برخی پیکربندی‌ها امکان مسدودکردن یک حساب. مجموعهٔ افزونه‌ها ویژگی خود توکن است نه سولانا، و ارزش دارد پیش از خرید بررسی‌اش کنی.'
    }
  }
};

/* ─── Composition ──────────────────────────────────────────────────────────── */

const faDigits = (s) => String(s).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);

function buildPage(chain, lang) {
  const profile = PROFILES[chain.id];
  const copy = profile[lang];
  /* Persian pages name the chain in Persian and keep the Latin name beside it:
     people search both, and the Latin form is what their wallet will show. */
  const faName = profile.faName;
  const isFa = lang === 'fa';
  const slug = isFa ? `fa/networks/${profile.slug}` : `networks/${profile.slug}`;
  const sym = chain.native.symbol;
  const evm = chain.id !== 'solana';
  const tokenCount = (TOKENS[chain.id] || []).length;
  const explorerHost = chain.explorer.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const idText = evm ? (isFa ? faDigits(chain.id) : String(chain.id)) : null;

  if (isFa) {
    const facts = [
      ...(evm ? [['شناسهٔ زنجیره', idText]] : [['نوع شبکه', 'غیر EVM، مدل حساب مستقل']]),
      ['توکن کارمزد', sym],
      ['کاوشگر بلاک', explorerHost],
      ['نقدینگی از طریق', chain.dexName],
      ['کارمزد پلتفرم', `${faDigits(FEE_PCT)} درصد از مقدار ورودی`],
      ...(tokenCount ? [['توکن‌های آماده در فهرست', faDigits(tokenCount)]] : [])
    ];

    return article({
      slug,
      cluster: 'chains',
      lang: 'fa',
      icon: 'network',
      route: '/#/swap',
      title: `سواپ روی ${faName} (${chain.short}) | FBT Swap`.slice(0, 70),
      description:
        `سواپ روی شبکهٔ ${faName} (${chain.name}) در اف‌بی‌تی سواپ: توکن کارمزد ${sym}، کاوشگر ${explorerHost}، کارمزد پلتفرم ${faDigits(FEE_PCT)} درصد و آنچه پیش از امضا باید ببینی.`.slice(0, 168),
      h1: `سواپ روی شبکهٔ ${faName} (${chain.name})`,
      intro: [
        `${copy.what} ${copy.why}`,
        `اف‌بی‌تی سواپ روی ${faName} غیرحضانتی است: دارایی در کیف پول خودت می‌ماند، هر تراکنش امضای همان کیف پول را می‌خواهد و پیش از هر امضا شبکهٔ انتخاب‌شده نمایش داده می‌شود. کارمزد پلتفرم ${faDigits(FEE_PCT)} درصد از مقدار ورودی است و پیش از تأیید روی صفحه دیده می‌شود.`
      ],
      sections: [
        [
          `کارمزد روی ${faName} چطور کار می‌کند`,
          [
            copy.gas,
            `هر سواپ سه دریافت‌کنندهٔ جدا دارد و اف‌بی‌تی سواپ فقط یکی از آن‌هاست. کارمزد شبکه با ${sym} به خود شبکه می‌رسد؛ کارمزد استخر داخل قیمت به تأمین‌کنندگان نقدینگی می‌رسد؛ و کارمزد پلتفرم ${faDigits(FEE_PCT)} درصد از ورودی است. هیچ‌کدام از این سه از دل دیگری برداشته نمی‌شود و هیچ‌کدام بعد از امضا تغییر نمی‌کند.`
          ]
        ],
        [
          `رساندن دارایی به ${faName}`,
          [
            copy.bridge,
            `پیش از انتقال مبلغ بزرگ، یک مبلغ کوچک آزمایشی بفرست و در ${explorerHost} ببین که رسیده است. اف‌بی‌تی سواپ غیرحضانتی است و نمی‌تواند انتقالی را که روی شبکهٔ اشتباه انجام شده برگرداند، مسدود کند یا جبران کند — چیزی در اختیار ندارد که برگرداند.`
          ]
        ],
        [
          'پیش از امضا چه چیزی را بررسی کنی',
          [
            copy.caution,
            `سه مورد را هر بار نگاه کن: نام شبکه‌ای که کیف پول نشان می‌دهد${evm ? ` و شناسهٔ زنجیرهٔ ${idText}` : ''}، آدرس قرارداد توکنی که می‌گیری، و مقدار مجوزی که امضا می‌کنی. مجوز نامحدود تا وقتی باطلش نکنی باقی می‌ماند؛ این امضا جداست از خود سواپ و باید جدا هم بررسی شود.`
          ]
        ],
        [
          `این صفحه چه چیزی را قول نمی‌دهد`,
          [
            `نرخی که می‌بینی بهترین مسیر میان همان محل‌هایی است که در آن لحظه پرسیده شده‌اند، نه بهترین قیمت ممکن در کل بازار. مسیریابی از طریق تجمیع‌کننده قرارگیری در معرض حملات ساندویچی را کم می‌کند اما تراکنش را در برابر آن‌ها مصون نمی‌کند، و اف‌بی‌تی سواپ قیمت پیش‌بینی نمی‌کند و معامله پیشنهاد نمی‌دهد.`,
            `اف‌بی‌تی سواپ نمی‌تواند قرارداد توکن‌هایی را که خودت وارد می‌کنی ممیزی کند، عبارت بازیابی گمشده را بازنگرداند یا تراکنش ثبت‌شده را برگرداند. تنها دامنهٔ رسمی fbtswap.ir است و تنها راه تماس fbtswap@gmail.com؛ هیچ‌وقت اول ما با تو تماس نمی‌گیریم.`
          ]
        ]
      ],
      facts,
      faqs: [
        {
          q: `برای سواپ روی ${faName} به چه توکنی برای کارمزد نیاز دارم؟`,
          a: `به ${sym} نیاز داری، چون توکن بومی همین شبکه است. موجودی ${sym} روی شبکهٔ دیگر به کار نمی‌آید؛ باید روی ${faName} باشد و بعد از سواپ هم باید مقداری باقی بماند.`
        },
        {
          q: `کارمزد پلتفرم روی ${faName} چقدر است؟`,
          a: `${faDigits(FEE_PCT)} درصد از مقدار ورودی، همان عددی که روی همهٔ شبکه‌های پشتیبانی‌شده اعمال می‌شود. پیش از امضا نمایش داده می‌شود و کارمزد شبکه و کارمزد استخر از آن جدا هستند.`
        },
        {
          q: `چطور تراکنشم را روی ${faName} بررسی کنم؟`,
          a: `آدرس کیف پول یا شناسهٔ تراکنش را در ${explorerHost} جست‌وجو کن. کاوشگر مرجع مستقل است؛ اگر تراکنش آنجا ثبت شده باشد، انجام شده، حتی اگر هنوز در رابط کاربری دیده نشود.`
        }
      ]
    });
  }

  const facts = [
    ...(evm ? [['Chain ID', idText]] : [['Network type', 'Non-EVM, separate account model']]),
    ['Gas token', sym],
    ['Block explorer', explorerHost],
    ['Liquidity routed via', chain.dexName],
    ['Platform fee', `${FEE_PCT}% of the input amount`],
    ...(tokenCount ? [['Tokens in the built-in list', String(tokenCount)]] : [])
  ];

  return article({
    slug,
    cluster: 'chains',
    lang: 'en',
    icon: 'network',
    route: '/#/swap',
    title: `Swap on ${chain.name} — Fees, Gas and Chain Facts | FBT Swap`.slice(0, 70),
    description:
      `Swapping on ${chain.name} with FBT Swap: ${sym} pays for gas, ${explorerHost} verifies it, the platform fee is ${FEE_PCT}%, and here is what to check first.`.slice(0, 168),
    h1: `Swapping on ${chain.name}`,
    intro: [
      `${copy.what} ${copy.why}`,
      `FBT Swap is non-custodial on ${chain.name}: your assets stay in your own wallet, every transaction needs your signature, and the selected network is displayed before you sign. The platform fee is ${FEE_PCT}% of the input amount and is shown on screen before you confirm.`
    ],
    sections: [
      [
        `What a swap costs on ${chain.name}`,
        [
          copy.gas,
          `Every swap has three separate recipients and FBT Swap is only one of them. Network gas is paid in ${sym} and goes to the chain itself. The pool fee sits inside the price you are quoted and goes to liquidity providers. The platform fee is ${FEE_PCT}% of the input. None of the three is taken out of another, and none of them changes after you sign.`
        ]
      ],
      [
        `Getting assets onto ${chain.name}`,
        [
          copy.bridge,
          `Before moving a large amount, send a small test transfer and confirm it arrived on ${explorerHost}. FBT Swap is non-custodial and cannot reverse, freeze or compensate a transfer sent on the wrong network — it never holds the funds, so there is nothing for it to return.`
        ]
      ],
      [
        'What to check before you sign',
        [
          copy.caution,
          `Check three things every time: the network name your wallet is showing${evm ? ` and chain ID ${idText}` : ''}, the contract address of the token you are receiving, and the size of the approval you are granting. An unlimited approval stays live until you revoke it — it is a separate signature from the swap and deserves separate attention.`
        ]
      ],
      [
        'What this page does not promise',
        [
          `The rate you see is the best route among the venues queried at that moment, which is not the same as the best price available anywhere. Routing through an aggregator reduces exposure to sandwich attacks but does not make a public transaction immune to them, and FBT Swap does not forecast prices or recommend trades.`,
          `FBT Swap cannot audit token contracts you import yourself, cannot restore a lost recovery phrase and cannot reverse a confirmed transaction. The only official domain is fbtswap.ir and the only contact address is fbtswap@gmail.com; we never contact users first.`
        ]
      ]
    ],
    facts,
    faqs: [
      {
        q: `Which token pays for gas on ${chain.name}?`,
        a: `${sym}, because it is this network's native token. A ${sym} balance on a different chain does not help — it has to be on ${chain.name} itself, and you need to leave some after the swap rather than spending the whole balance.`
      },
      {
        q: `Is the platform fee different on ${chain.name}?`,
        a: `No. It is ${FEE_PCT}% of the input amount, the same figure on every supported network. It is shown before you sign, and network gas and the pool fee are separate costs paid to the chain and to liquidity providers.`
      },
      {
        q: `How do I verify a ${chain.name} transaction?`,
        a: `Search your wallet address or the transaction hash on ${explorerHost}. The explorer is the independent record: if the transaction is there, it happened, even if an interface has not caught up yet.`
      }
    ]
  });
}

/* Registry order, then Solana — the same order the app shows in its switcher. */
const CHAIN_LIST = [...EVM_CHAIN_ORDER.map((id) => EVM_CHAINS[id]), SOLANA].filter(Boolean);

for (const chain of CHAIN_LIST) {
  if (!PROFILES[chain.id]) {
    throw new Error(
      `[content] networks.mjs: chain ${chain.id} (${chain.name}) is in the registry but has no editorial profile. ` +
        'Add one to PROFILES rather than letting it publish boilerplate.'
    );
  }
}

export const NETWORK_PAGES = [
  ...CHAIN_LIST.map((c) => buildPage(c, 'en')),
  ...CHAIN_LIST.map((c) => buildPage(c, 'fa'))
];

/** Reciprocal hreflang pairs for the generator's ALTERNATES array. */
export const NETWORK_ALTERNATES = CHAIN_LIST.map((c) => [
  `networks/${PROFILES[c.id].slug}`,
  `fa/networks/${PROFILES[c.id].slug}`
]);

export const NETWORK_COUNT = CHAIN_LIST.length;
