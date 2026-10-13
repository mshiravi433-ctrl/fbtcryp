/**
 * Three distinct search intents, each with a real Persian/English counterpart.
 * Brand identification, net-profit arithmetic and access limitations are
 * different questions; none is a doorway, a return promise or sanctions advice.
 */
import { article } from './schema.mjs';

const DATE = '2026-10-13';

export const SEARCH_INTENT_PAGES = [
  article({
    slug: 'fbt-swap', cluster: 'trust', date: DATE, icon: 'grid', route: '/#/swap',
    title: 'FBT Swap (FBTSwap) — Crypto Swap and Official Site Guide',
    description: 'Meet FBT Swap, also called FBTSwap or FBT: a non-custodial crypto swap interface. Verify the official site, wallet controls, fees and product limits.',
    h1: 'What is FBT Swap (FBTSwap)?',
    intro: [
      'FBT Swap is a non-custodial interface for swapping crypto assets through third-party decentralised exchanges. FBTSwap is the same product written without a space, and FBT is a short form used on this site. In Persian the name is اف بی تی سواپ or اف‌بی‌تی سواپ. The official domain is fbtswap.ir.',
      'This guide answers a brand question, not a price prediction: what the product is, what the words swap and crypto mean, and how to recognise the genuine service. The operator is Fanous Bazaar Pishgam Co., based in Isfahan, Iran. A matching name on another domain or a token ticker is not proof of any relationship with this product.'
    ],
    sections: [
      ['FBT, FBTSwap, swap and crypto mean different things', [
        'FBT Swap and FBTSwap identify this application. Swap describes the action of exchanging one token for another using a quoted on-chain route. Crypto is a broad term for digital assets on blockchains. Neither generic term identifies one particular company, and neither means an investment will be profitable.',
        'A token can have any symbol its issuer chooses. Seeing FBT in a token list does not establish that it is issued, endorsed or supported by FBT Swap. Check the network and full contract address rather than relying on the name, logo or ticker; this page is not an offer to buy an FBT token.'
      ]],
      ['What happens when you use the swap interface', [
        'You connect a wallet you control, choose the network and token pair, and request a quote. The interface compares routes available from the providers it queries. You review the input, expected output, minimum received, platform fee and network gas before approving anything in your wallet.',
        'There is no FBT customer deposit balance or FBT order book. A signature authorises an interaction with the contracts in the route; non-custodial does not mean the transaction is risk-free. Incorrect networks, malicious tokens, excessive approvals, price changes and contract failures can all cause a loss. A quote can expire before you sign.'
      ]],
      ['Accounts, fees and platforms', [
        'The on-chain swap interface does not require an FBT account, email or identity document. This statement is limited to that interface. A wallet, payment provider, fiat-purchase service or external protocol may have different requirements, jurisdictional limits or eligibility checks.',
        'The published platform fee is 0.70% of the swap input and is shown before signing. Network gas is a separate cost paid to the chain, while liquidity-pool costs can already be reflected in the quoted output. Read the actual quote instead of treating a headline fee as the total cost. The application has web, installable web, Android and Telegram Mini App entry points; there is no native iOS build.'
      ]],
      ['How to verify the official FBT Swap', [
        'Read the complete domain in the address bar: fbtswap.ir. HTTPS is necessary for transport security but is not proof that a lookalike site is genuine. Use the contact-and-verification page on this domain and the linked official profile, rather than contact details supplied by a stranger in a message.',
        'FBT Swap never needs your recovery phrase or private key. Do not paste either into a website or send them to anyone claiming to provide support. A request to send assets to unlock a withdrawal, recover a loss or receive guaranteed daily income is not part of this interface. The published contact is fbtswap@gmail.com.'
      ]],
      ['Where to go next', [
        'Use the swap guide for the transaction steps, the fees guide for cost components, and the access guide for the difference between no FBT KYC and unrestricted availability. The profit-and-risk guide shows why a rising asset price can still leave a negative net result after costs.',
        'The pages linked below state the operator, editorial policy and contact rules in more detail. They are first-party product documentation, not independent certification of an investment or a security audit. Keep the keys, understand each approval and decline any transaction whose route or costs you cannot explain.'
      ]]
    ],
    facts: [
      ['Product name', 'FBT Swap; also written FBTSwap or shortened to FBT on this site'],
      ['Official domain', 'https://fbtswap.ir/'],
      ['Product type', 'Non-custodial interface to third-party DEX routes, not a deposit-taking exchange'],
      ['Swap account', 'No FBT account or KYC for the on-chain swap interface; external requirements can differ'],
      ['Return promise', 'None; neither the swap interface nor AI analysis guarantees profit']
    ],
    faqs: [
      { q: 'Are FBT Swap and FBTSwap the same product?', a: 'Yes. FBT Swap is the product name; FBTSwap is the spelling without a space. On this site FBT is a short form. The Persian name is اف بی تی سواپ. The official domain is fbtswap.ir.' },
      { q: 'What does crypto swap mean?', a: 'It means exchanging one crypto asset for another through a quoted route. In FBT Swap you approve the on-chain transaction in your own wallet; a swap is not a promise of profit.' },
      { q: 'Does an FBT token ticker prove a connection to FBT Swap?', a: 'No. A symbol, logo or display name can be copied. This brand guide does not endorse any token with that ticker; verify the network and full contract address independently.' },
      { q: 'Does FBT Swap keep my funds or recovery phrase?', a: 'No. There is no FBT deposit account. You control your wallet and approve transactions yourself. Never give a website or support contact your recovery phrase or private key.' }
    ],
    relatedSlugs: ['about', 'trust/contact-and-verification', 'trust/press-kit', 'crypto-swap-without-kyc', 'crypto-access-and-restrictions', 'crypto-profit-and-risk'],
    risk: 'This is first-party product information, not financial advice, an independent security certification or an endorsement of any token. On-chain transactions and losses cannot be reversed by FBT Swap.'
  }),

  article({
    slug: 'fa/fbt-swap', cluster: 'trust', lang: 'fa', date: DATE, icon: 'grid', route: '/#/swap',
    title: 'FBT Swap و FBTSwap چیست؟ معرفی اف بی تی سواپ',
    description: 'اف بی تی سواپ، FBT Swap یا FBTSwap، رابط سواپ غیرامانی ارز دیجیتال است. دامنهٔ رسمی، کارمزد، کنترل کیف پول و محدودیت‌های محصول را بشناس.',
    h1: 'اف بی تی سواپ یا FBT Swap چیست؟',
    intro: [
      'اف بی تی سواپ یک رابط غیرامانی برای تبدیل ارز دیجیتال از مسیر صرافی‌های غیرمتمرکز دیگر است. FBT Swap نام انگلیسی محصول است، FBTSwap همان نام بدون فاصله و FBT شکل کوتاهی است که در این سایت می‌بینی. نام فارسی با نیم‌فاصله «اف‌بی‌تی سواپ» هم نوشته می‌شود. دامنهٔ رسمی محصول fbtswap.ir است.',
      'این راهنما برای شناخت برند است، نه پیش‌بینی قیمت: محصول چه کاری می‌کند، Swap و Crypto چه معنی دارند و چطور سایت اصلی را تشخیص بدهی. گردانندهٔ محصول شرکت فانوس بازار پیشگام در اصفهان ایران است. نام مشابه روی دامنه‌ای دیگر یا نماد یک توکن، به‌تنهایی ارتباط آن با این محصول را ثابت نمی‌کند.'
    ],
    sections: [
      ['فرق FBT، سواپ و کریپتو چیست؟', [
        'FBT Swap و FBTSwap نام این برنامه‌اند. سواپ یا Swap یعنی تبدیل یک توکن به توکنی دیگر با یک نرخ و مسیر روی زنجیره. کریپتو یا Crypto اصطلاح عمومی دارایی‌های دیجیتال روی بلاکچین است. این دو واژهٔ عمومی نام یک شرکت مشخص نیستند و هیچ‌کدام به معنی سودآور بودن معامله نیستند.',
        'سازندهٔ یک توکن می‌تواند نماد دلخواهش را انتخاب کند. دیدن نماد FBT در فهرست توکن‌ها ثابت نمی‌کند که اف بی تی سواپ آن را منتشر یا تأیید کرده است. به‌جای اعتماد به اسم و لوگو، شبکه و نشانی کامل قرارداد را بررسی کن. این صفحه پیشنهاد خرید توکن FBT نیست.'
      ]],
      ['در رابط سواپ چه اتفاقی می‌افتد؟', [
        'کیف پولی را که کنترلش دست خودت است وصل می‌کنی، شبکه و جفت توکن را انتخاب می‌کنی و نرخ می‌گیری. رابط مسیرهای در دسترس از ارائه‌دهندگانی را که از آن‌ها نرخ گرفته مقایسه می‌کند. قبل از هر تأیید، ورودی، خروجی مورد انتظار، حداقل دریافتی، کارمزد پلتفرم و گس را در همان نرخ می‌بینی.',
        'اینجا حساب سپرده یا دفتر سفارش اف بی تی وجود ندارد. امضای تو اجازهٔ تعامل با قراردادهای مسیر را می‌دهد؛ غیرامانی بودن به معنی بی‌خطر بودن تراکنش نیست. شبکهٔ اشتباه، توکن مخرب، مجوز نامحدود، تغییر قیمت یا خرابی قرارداد می‌تواند زیان بسازد. نرخ هم ممکن است پیش از امضا منقضی شود.'
      ]],
      ['حساب، هزینه و پلتفرم‌های محصول', [
        'برای رابط سواپ روی زنجیره، حساب اف بی تی، ایمیل یا مدرک شناسایی لازم نیست. این جمله فقط دربارهٔ همین رابط است. کیف پول، سرویس پرداخت، خرید با پول بانکی و پروتکل‌های بیرونی ممکن است شرایط احراز هویت، محدودیت منطقه‌ای یا بررسی صلاحیت جدا داشته باشند.',
        'کارمزد اعلام‌شدهٔ پلتفرم ۰٫۷۰٪ از ورودی سواپ است و پیش از امضا نمایش داده می‌شود. گس هزینه‌ای جداست که به شبکه می‌رسد و هزینهٔ استخر ممکن است از قبل در خروجی نرخ لحاظ شده باشد. مبلغ واقعی را از نرخ بخوان، نه فقط از یک درصد تبلیغاتی. محصول روی وب، وب قابل نصب، اندروید و مینی‌اپ تلگرام در دسترس است؛ نسخهٔ بومی آی‌او‌اس ندارد.'
      ]],
      ['چطور سایت اصلی اف بی تی را تشخیص بدهم؟', [
        'نشانی کامل نوار آدرس را بخوان: fbtswap.ir. داشتن HTTPS برای امنیت ارتباط لازم است، اما واقعی بودن یک دامنهٔ شبیه را ثابت نمی‌کند. از صفحهٔ تماس و تأیید هویت روی همین دامنه و حساب رسمی پیوندشده استفاده کن، نه نشانی‌ای که یک فرد ناشناس در پیام خصوصی می‌فرستد.',
        'اف بی تی سواپ هیچ‌وقت به عبارت بازیابی یا کلید خصوصی تو نیاز ندارد. آن‌ها را در سایت وارد نکن و برای کسی که ادعای پشتیبانی دارد نفرست. درخواست واریز برای باز کردن برداشت، جبران زیان یا گرفتن سود روزانهٔ تضمینی جزو این رابط نیست. ایمیل منتشرشدهٔ تماس fbtswap@gmail.com است.'
      ]],
      ['از کدام راهنما ادامه بدهم؟', [
        'راهنمای سواپ مراحل تراکنش را توضیح می‌دهد و راهنمای کارمزد اجزای هزینه را جدا می‌کند. برای تفاوت «بدون احراز هویت اف بی تی» با «دسترسی بدون محدودیت»، راهنمای دسترسی را بخوان. راهنمای سود و ریسک هم نشان می‌دهد چطور رشد قیمت می‌تواند بعد از هزینه‌ها هنوز نتیجهٔ خالص منفی بدهد.',
        'صفحه‌های پیوندشده در پایین، اپراتور، سیاست محتوا و قواعد تماس را دقیق‌تر معرفی می‌کنند. این‌ها مستندات خود محصول‌اند، نه تأیید مستقل امنیت یا توصیهٔ سرمایه‌گذاری. کلیدها را نزد خودت نگه دار، معنی هر مجوز را بفهم و تراکنشی را که مسیر یا هزینه‌اش برایت روشن نیست تأیید نکن.'
      ]]
    ],
    facts: [
      ['نام محصول', 'اف بی تی سواپ / اف‌بی‌تی سواپ / FBT Swap / FBTSwap'],
      ['دامنهٔ رسمی', 'https://fbtswap.ir/'],
      ['نوع محصول', 'رابط غیرامانی مسیرهای صرافی غیرمتمرکز، نه صرافی سپرده‌پذیر'],
      ['حساب سواپ', 'برای رابط روی زنجیره حساب یا احراز هویت اف بی تی لازم نیست؛ شرایط بیرونی ممکن است فرق کند'],
      ['وعدهٔ بازده', 'هیچ؛ سواپ و تحلیل هوشمند سود را تضمین نمی‌کنند']
    ],
    faqs: [
      { q: 'آیا FBT Swap، FBTSwap و اف بی تی یک محصول‌اند؟', a: 'در این سایت بله. FBT Swap نام محصول، FBTSwap شکل بدون فاصله و FBT نام کوتاه است. نام فارسی اف بی تی سواپ یا اف‌بی‌تی سواپ است و دامنهٔ رسمی fbtswap.ir است.' },
      { q: 'Swap و Crypto به چه معنی‌اند؟', a: 'Swap یا سواپ یعنی تبدیل یک دارایی دیجیتال به دارایی دیگر با یک مسیر و نرخ. Crypto یا کریپتو اصطلاح عمومی ارز دیجیتال است. در اف بی تی تراکنش را در کیف پول خودت تأیید می‌کنی؛ این کار وعدهٔ سود نیست.' },
      { q: 'آیا نماد توکن FBT ارتباط با اف بی تی سواپ را ثابت می‌کند؟', a: 'نه. نماد، لوگو و نام قابل کپی هستند. این راهنمای برند هیچ توکنی با آن نماد را تأیید نمی‌کند؛ شبکه و نشانی کامل قرارداد را مستقل بررسی کن.' },
      { q: 'آیا اف بی تی دارایی یا عبارت بازیابی را نگه می‌دارد؟', a: 'نه. حساب سپردهٔ اف بی تی وجود ندارد. کیف پول را خودت کنترل و تراکنش را خودت تأیید می‌کنی. هیچ سایت یا پشتیبانی‌ای نباید عبارت بازیابی یا کلید خصوصی تو را بگیرد.' }
    ],
    relatedSlugs: ['fa/about', 'fa/trust/contact-and-verification', 'fa/trust/press-kit', 'fa/crypto-swap-without-kyc', 'fa/crypto-access-and-restrictions', 'fa/crypto-profit-and-risk'],
    risk: 'این متن اطلاعات خود محصول است، نه توصیهٔ مالی، تأیید مستقل امنیت یا تأیید یک توکن. اف بی تی سواپ نمی‌تواند تراکنش یا زیان روی زنجیره را برگرداند.'
  }),

  article({
    slug: 'crypto-profit-and-risk', cluster: 'defi', date: DATE, icon: 'leaf', route: '/#/farm',
    title: 'Crypto Profit and Risk: Calculate Net Returns | FBT Swap',
    description: 'Can you profit with crypto? Learn net-return arithmetic, swap costs, variable DeFi yield and loss risks. FBT Swap offers tools, not guaranteed income.',
    h1: 'Crypto profit starts with net returns, not promises',
    intro: [
      'Profit with crypto is possible, but it is never guaranteed. You can lose part or all of the capital you put at risk. The useful question is not which app promises income; it is whether a realised result remains positive after trading costs, network fees, asset-price changes and protocol risks.',
      'FBT Swap provides a non-custodial swap interface, market information and DeFi-related tools. It does not pay a fixed return or make an AI forecast reliable. This guide explains the arithmetic of a result and the limitations of yield figures, not which asset or strategy you should buy.'
    ],
    sections: [
      ['What counts as a net crypto profit?', [
        'Use a consistent unit such as the same fiat currency at the entry and exit times. Net result equals the realised exit value plus realised rewards, minus the acquisition cost and costs not already included in those values. An unrealised balance on a screen is not cash you have received, and a token reward must have a usable market before its displayed price can be treated as exit value.',
        'Write down network gas, swap fees, approval costs and any bridge or withdrawal charges that actually apply. Avoid subtracting a fee twice: a liquidity-provider fee or price impact may already be reflected in the executed output. Record the actual wallet receipts and timestamps instead of estimating the result from a chart alone.'
      ]],
      ['A worked example: the price rises but the trade loses', [
        'This is a hypothetical, simplified illustration, not a quote or a forecast. Assume an asset costs $1,000 before fees and its reference exit value rises to $1,010. At an assumed 0.70% platform fee, the entry fee is $7 and the exit fee on that reference amount is $7.07. Assume another $8 of total network costs and a $4 deduction from pool pricing and execution.',
        'The gross price gain is $10. In this model the net result is $10 minus $7 minus $7.07 minus $8 minus $4, or a $16.07 loss. Real quotes and fee bases can differ; if the exit value you use already includes a deduction, do not subtract it again. The example shows why a positive price move alone does not prove profit.'
      ]],
      ['Trading gains and DeFi yield are not the same thing', [
        'A trading gain comes from the difference between acquisition and disposal values. Lending yield can come from interest paid by borrowers, staking rewards from network rules, and liquidity-provider returns from pool trading fees or incentives. Each has a different source of revenue and a different failure mode. A token incentive can lose value faster than rewards accumulate.',
        'APR is an annualised rate without an assumed compounding schedule. APY includes a compounding assumption and is not a fixed promise. A quoted dollar APY can change when utilisation, incentives or token prices change. Yield over a shorter period is not automatically the annual figure divided by the number of periods, especially when rates move or rewards cannot be reinvested.'
      ]],
      ['Risks that a yield percentage does not explain', [
        'A pool can be exposed to smart-contract exploits, liquidity shortages, oracle failures, stablecoin depegs or a reward token becoming difficult to sell. Providing two assets can also create impermanent loss relative to holding them separately. Borrowing against collateral introduces liquidation risk, which is distinct from earning lending interest.',
        'Non-custodial execution removes an FBT deposit account but does not remove these risks. FBT Swap cannot reverse a settled transaction or compensate an on-chain loss. The absence of an advertised risk score, audit or fresh data is missing evidence, not evidence that the activity is safe.'
      ]],
      ['How to read the FBT Swap tools without a profit promise', [
        'Check the source, observation time, network and unit attached to each market or yield figure. If data is unavailable or old, pause rather than turning a missing value into an assumed zero or a favourable rate. Compare an executed transaction with the quote, since a chart indicator or an AI explanation does not settle a trade.',
        'The linked fees, APR/APY and yield-risk guides explain the components separately. A sensible record contains the quoted output, executed output, gas spent, reward asset and any withdrawal conditions. This information supports your own evaluation; it does not establish suitability for your finances, remove tax or legal obligations, or guarantee that a position can be closed at the displayed value.'
      ]]
    ],
    facts: [
      ['Guaranteed crypto profit', 'None; losses can include the entire capital at risk'],
      ['Net result', 'Realised exit value and rewards minus acquisition cost and costs not already deducted'],
      ['Example', 'Hypothetical $10 gross gain becomes a $16.07 net loss under the stated assumptions'],
      ['DeFi APY', 'A variable annualised estimate with a compounding assumption, not fixed income'],
      ['Role of AI', 'Analysis and explanation, not a return guarantee']
    ],
    faqs: [
      { q: 'Can I make a profit with crypto using FBT Swap?', a: 'A crypto activity may produce a gain or a loss. FBT Swap provides tools and routes, not guaranteed income. Calculate the realised net result after applicable costs and consider price, liquidity and contract risks.' },
      { q: 'Does a high DeFi APY mean guaranteed dollar profit?', a: 'No. APY is annualised and may assume compounding. Rates, token prices, incentives and liquidity can change; a dollar-denominated figure is not a fixed dollar income promise.' },
      { q: 'Can a rising price still produce a losing trade?', a: 'Yes. In the explicitly hypothetical example on this page, a $10 gross price gain minus $14.07 in platform fees, $8 in gas and $4 in execution deductions gives a $16.07 net loss. Do not subtract costs twice when using actual receipts.' },
      { q: 'Does AI analysis remove crypto trading risk?', a: 'No. AI can explain information or prepare an action for review, but it does not guarantee execution, predict prices reliably or protect against market and protocol losses.' }
    ],
    relatedSlugs: ['how-crypto-swap-fees-work', 'apy-vs-apr-in-defi', 'yield-farming-risks', 'impermanent-loss-explained', 'crypto-investing-yield-and-lending', 'trust/what-we-cannot-do'],
    risk: 'Educational arithmetic only, not financial, tax or legal advice. Every number in the worked example is an explicit assumption, not a live quote, past performance or promised return. Crypto and DeFi can lose the entire capital at risk.'
  }),

  article({
    slug: 'fa/crypto-profit-and-risk', cluster: 'defi', lang: 'fa', date: DATE, icon: 'leaf', route: '/#/farm',
    title: 'سود با کریپتو؛ محاسبهٔ بازده خالص و ریسک | FBT Swap',
    description: 'سود با کریپتو تضمینی نیست. محاسبهٔ سود خالص پس از کارمزد و گس، تفاوت معامله با بازده دیفای و ریسک زیان را در راهنمای اف بی تی سواپ بخوان.',
    h1: 'سود با کریپتو؛ از بازده خالص شروع کن، نه وعده',
    intro: [
      'سود با کریپتو ممکن است، اما تضمینی نیست و ممکن است بخشی یا تمام سرمایه‌ای را که در معرض ریسک می‌گذاری از دست بدهی. سؤال مفید این نیست که کدام برنامه وعدهٔ درآمد می‌دهد؛ سؤال این است که نتیجهٔ واقعی بعد از کارمزد معامله، گس شبکه، تغییر قیمت دارایی و ریسک پروتکل هنوز مثبت می‌ماند یا نه.',
      'اف بی تی سواپ رابط سواپ غیرامانی، دادهٔ بازار و ابزارهای مرتبط با دیفای ارائه می‌کند؛ سود ثابت نمی‌پردازد و پیش‌بینی هوش مصنوعی را قطعی نمی‌کند. این راهنما حساب کردن نتیجه و محدودیت نرخ‌های بازده را توضیح می‌دهد، نه اینکه کدام دارایی یا راهبرد را بخری.'
    ],
    sections: [
      ['سود خالص ارز دیجیتال را چطور حساب کنیم؟', [
        'ورود و خروج را با یک واحد ثابت، مثلاً همان ارز پولی در زمان هر تراکنش، ثبت کن. نتیجهٔ خالص برابر ارزش خروجِ محقق‌شده به‌اضافهٔ پاداش‌های محقق‌شده، منهای هزینهٔ خرید و هزینه‌هایی است که قبلاً در این اعداد کم نشده‌اند. عدد موجودی روی صفحه هنوز پول دریافت‌شده نیست و پاداش توکنی هم باید بازار قابل استفاده داشته باشد تا ارزش خروجش واقعی باشد.',
        'گس شبکه، کارمزد سواپ، هزینهٔ مجوز و هزینهٔ پل یا برداشتِ مربوط به همان فعالیت را بنویس. یک هزینه را دوبار کم نکن: کارمزد استخر یا اثر قیمتی ممکن است از قبل در خروجی اجراشده لحاظ شده باشد. به‌جای حدس از روی نمودار، رسید واقعی کیف پول و زمان معامله را ثبت کن.'
      ]],
      ['مثال عددی: قیمت بالا می‌رود، اما معامله زیان می‌دهد', [
        'این مثال فرضی و ساده‌شده است، نه نرخ زنده و نه پیش‌بینی. فرض کن ارزش خرید دارایی پیش از هزینه‌ها ۱۰۰۰ دلار و ارزش مرجع خروج ۱۰۱۰ دلار باشد. با فرض کارمزد پلتفرم ۰٫۷۰٪، هزینهٔ ورود ۷ دلار و هزینهٔ خروج از آن ارزش مرجع ۷٫۰۷ دلار است. جمع هزینهٔ شبکه را ۸ دلار و کسر ناشی از قیمت استخر و اجرا را ۴ دلار فرض می‌کنیم.',
        'رشد ناخالص قیمت ۱۰ دلار است. در این مدل، ۱۰ منهای ۷ منهای ۷٫۰۷ منهای ۸ منهای ۴ برابر منفی ۱۶٫۰۷ دلار می‌شود؛ یعنی با وجود رشد قیمت، زیان خالص داریم. نرخ و مبنای کارمزد واقعی می‌تواند فرق کند. اگر ارزش خروجی که ثبت کرده‌ای قبلاً یک هزینه را کم کرده، دوباره کمش نکن. مثبت بودن نمودار به‌تنهایی سود را ثابت نمی‌کند.'
      ]],
      ['سود معامله با بازده دیفای فرق دارد', [
        'سود معامله از تفاوت ارزش خرید و فروش می‌آید. بازده وام‌دهی می‌تواند از بهرهٔ پرداختی وام‌گیرنده، پاداش استیکینگ از قواعد شبکه و درآمد تأمین نقدینگی از کارمزد استخر یا مشوق‌ها باشد. منبع هرکدام و روش شکستش متفاوت است. ارزش توکن پاداش ممکن است سریع‌تر از جمع شدن پاداش‌ها کاهش پیدا کند.',
        'APR نرخ سالانه‌شده بدون فرض برنامهٔ سود مرکب است. APY فرضی دربارهٔ ترکیب دوبارهٔ بازده دارد و قول ثابت نیست. APY دلاری ممکن است با تغییر تقاضای وام، مشوق یا قیمت توکن عوض شود. بازده یک دورهٔ کوتاه هم لزوماً نرخ سالانه تقسیم بر تعداد دوره‌ها نیست؛ به‌خصوص وقتی نرخ تغییر کند یا نتوانی پاداش را دوباره وارد فعالیت کنی.'
      ]],
      ['ریسک‌هایی که درصد بازده توضیح نمی‌دهد', [
        'یک استخر می‌تواند در معرض آسیب قرارداد هوشمند، کمبود نقدینگی، اختلال اوراکل، جدا شدن قیمت استیبل‌کوین از قیمت هدف یا غیرقابل فروش شدن توکن پاداش باشد. تأمین دو دارایی می‌تواند نسبت به نگهداری جداگانهٔ آن‌ها زیان ناپایدار بسازد. وام گرفتن با وثیقه هم ریسک لیکویید شدن دارد که با دریافت بهرهٔ وام‌دهی یکی نیست.',
        'اجرای غیرامانی حساب سپردهٔ اف بی تی را حذف می‌کند، نه این ریسک‌ها را. اف بی تی سواپ نمی‌تواند تراکنش ثبت‌شده یا زیان روی زنجیره را برگرداند. نبود امتیاز ریسک، حسابرسی منتشرشده یا دادهٔ تازه، نشانهٔ کمبود اطلاعات است؛ نه مدرک امن بودن فعالیت.'
      ]],
      ['ابزارهای اف بی تی را بدون وعدهٔ سود بخوان', [
        'برای هر عدد بازار یا بازده، منبع، زمان مشاهده، شبکه و واحدش را بررسی کن. وقتی داده در دسترس نیست یا قدیمی است، مکث کن؛ عدد ناموجود را صفر یا یک نرخ مطلوب فرض نکن. تراکنش اجراشده را با نرخ مقایسه کن، چون اندیکاتور نمودار یا توضیح هوش مصنوعی خودش معامله را تسویه نمی‌کند.',
        'راهنماهای کارمزد، نرخ ساده و مرکب و ریسک فارم در پایین هر بخش را جدا توضیح می‌دهند. یک سابقهٔ قابل استفاده شامل خروجی نرخ، خروجی واقعی، گس پرداخت‌شده، دارایی پاداش و شرط برداشت است. این اطلاعات برای بررسی خودت مفید است؛ مناسب بودن فعالیت برای شرایط مالی تو را ثابت نمی‌کند، تکلیف مالیاتی یا قانونی را حذف نمی‌کند و فروش در ارزش نمایشی را تضمین نمی‌کند.'
      ]]
    ],
    facts: [
      ['سود تضمینی کریپتو', 'وجود ندارد؛ زیان می‌تواند تمام سرمایهٔ در معرض ریسک باشد'],
      ['نتیجهٔ خالص', 'ارزش خروج و پاداش واقعی، منهای هزینهٔ خرید و هزینه‌هایی که قبلاً کم نشده‌اند'],
      ['مثال', 'رشد فرضی ۱۰ دلاری، با فرض‌های همین صفحه به زیان خالص ۱۶٫۰۷ دلاری می‌رسد'],
      ['APY دیفای', 'برآورد سالانهٔ متغیر با فرض سود مرکب، نه درآمد ثابت'],
      ['نقش هوش مصنوعی', 'تحلیل و توضیح، نه تضمین بازده']
    ],
    faqs: [
      { q: 'آیا با اف بی تی سواپ می‌توانم سود با کریپتو داشته باشم؟', a: 'فعالیت کریپتو ممکن است سود یا زیان بسازد. اف بی تی ابزار و مسیر ارائه می‌کند، نه درآمد تضمینی. نتیجهٔ واقعی را بعد از هزینه‌های مربوط حساب کن و ریسک قیمت، نقدینگی و قرارداد را در نظر بگیر.' },
      { q: 'آیا APY بالای دیفای یعنی سود دلاری تضمینی؟', a: 'نه. APY سالانه‌شده است و ممکن است ترکیب دوبارهٔ بازده را فرض کند. نرخ، قیمت توکن، مشوق و نقدینگی می‌توانند تغییر کنند؛ نمایش یک عدد دلاری وعدهٔ درآمد ثابت دلاری نیست.' },
      { q: 'آیا با رشد قیمت هم ممکن است ضرر کنم؟', a: 'بله. در مثال کاملاً فرضی این صفحه، رشد ناخالص ۱۰ دلار پس از ۱۴٫۰۷ دلار کارمزد پلتفرم، ۸ دلار گس و ۴ دلار کسر اجرا به زیان خالص ۱۶٫۰۷ دلار می‌رسد. هنگام استفاده از رسید واقعی، هزینه‌ای را دوبار کم نکن.' },
      { q: 'آیا تحلیل هوش مصنوعی ریسک معامله را حذف می‌کند؟', a: 'نه. هوش مصنوعی می‌تواند اطلاعات را توضیح بدهد یا اقدامی برای بررسی آماده کند؛ اما اجرا، پیش‌بینی معتبر قیمت و محافظت در برابر زیان بازار یا پروتکل را تضمین نمی‌کند.' }
    ],
    relatedSlugs: ['fa/how-crypto-swap-fees-work', 'fa/apy-vs-apr-in-defi', 'fa/yield-farming-risks', 'fa/impermanent-loss-explained', 'fa/crypto-investing-yield-and-lending', 'fa/trust/what-we-cannot-do'],
    risk: 'این متن فقط آموزش محاسبه است، نه توصیهٔ مالی، مالیاتی یا حقوقی. تمام عددهای مثال فرض هستند، نه نرخ زنده، سابقهٔ عملکرد یا وعدهٔ بازده. کریپتو و دیفای می‌توانند تمام سرمایهٔ در معرض ریسک را از بین ببرند.'
  }),

  article({
    slug: 'crypto-access-and-restrictions', cluster: 'security', date: DATE, icon: 'shield', route: '/#/swap',
    title: 'Crypto Access, Sanctions and Non-Custodial Swaps | FBT Swap',
    description: 'Does no KYC mean no restrictions? Understand crypto access, sanctions, provider rules and token controls before using a non-custodial swap interface.',
    h1: 'No FBT account does not mean unrestricted crypto access',
    intro: [
      'A search for an exchange without sanctions or restrictions asks more than a product can safely promise. FBT Swap does not require an FBT account or identity document for its on-chain swap interface, but it does not guarantee availability in every country or immunity from sanctions, provider restrictions or token-issuer controls.',
      'No KYC, non-custodial execution and lawful access are three different issues. This guide explains those boundaries so you can evaluate a service without mistaking a marketing phrase for legal permission or asset protection. It is not legal advice and does not provide instructions for bypassing restrictions.'
    ],
    sections: [
      ['What no KYC actually describes', [
        'KYC describes an identity-check process. The absence of an FBT identity check means that you do not create a customer account or submit documents to this on-chain interface. It says nothing about what a wallet, an external payment provider, a token issuer or a particular protocol requires.',
        'The claim does not extend to fiat purchases or withdrawals through payment services. Eligibility may depend on the provider and jurisdiction. No KYC is not anonymity either: public blockchain transfers can be observed, and service providers may process connection metadata. Check the applicable terms instead of assuming that an empty signup form removes other obligations.'
      ]],
      ['The access layers in a decentralised swap', [
        'You depend on more than one website: a wallet, an RPC endpoint, a quote provider, the selected blockchain and the smart contracts in the route. A webpage can load while the quote provider refuses a request. A quote can appear while a contract rejects a transfer. A working internet connection therefore does not establish that a transaction is available to you.',
        'Those components may have regional rules, outages or compliance controls. FBT Swap cannot promise that a third-party service will remain available or approve a request. If a provider states that you are ineligible, respect that rule; the interface is not a permission to disguise eligibility or bypass legal restrictions.'
      ]],
      ['What non-custodial execution does and does not protect', [
        'FBT Swap does not hold a customer deposit and cannot freeze an FBT balance because there is no such balance. You hold your wallet keys and approve interactions yourself. This removes the custody relationship with FBT, not every control that can exist inside an asset or contract.',
        'Some tokens can include issuer-administered pause or address-blocking functions. A stablecoin or other token can therefore be restricted even while you control the private key. Contracts can also have governance controls and liquidity can disappear. Self-custody is not immunity from those asset-level conditions, price losses or smart-contract vulnerabilities.'
      ]],
      ['How to assess an access claim responsibly', [
        'Identify the actual provider and read its current terms for your jurisdiction and the exact service you plan to use. Distinguish on-chain swaps from banking, fiat purchases, tokenised stocks and other products with separate eligibility conditions. This site cannot determine your legal status or replace qualified advice.',
        'Check the official domain, selected network, complete token contract address and wallet approval request. Read the fee, minimum received and source of the quote. If the provider declines the request, the data is stale or you do not understand a restriction, stop instead of signing repeatedly or sending assets to someone who promises an exemption.'
      ]],
      ['What FBT Swap can honestly say', [
        'The accurate product description is a non-custodial crypto swap interface with no FBT account requirement for on-chain swaps. It is not a sanctions-free exchange, a bank account or a service that guarantees uninterrupted access. The platform fee is displayed before signing, and network gas remains separate.',
        'The related pages explain custody, privacy, operator limitations and the official contact. Anyone claiming that support can unlock a restricted token, reverse a transaction or sell guaranteed exemption from a provider rule is making a claim this product does not support. Never give that person a recovery phrase, private key or payment.'
      ]]
    ],
    facts: [
      ['FBT KYC', 'Not required for the on-chain swap interface; third-party requirements can differ'],
      ['Access everywhere', 'Not guaranteed; provider rules and applicable law still matter'],
      ['Custody', 'FBT Swap holds no deposit balance and no wallet keys'],
      ['Token restrictions', 'Issuer or contract controls can still apply to a self-custodied token'],
      ['Legal scope', 'Information only, not a legal opinion or a method to evade restrictions']
    ],
    faqs: [
      { q: 'Is FBT Swap an exchange without sanctions?', a: 'FBT Swap is a non-custodial swap interface, not a deposit-taking exchange. It does not require FBT KYC for on-chain swaps, but it does not guarantee sanctions-free or unrestricted access. Applicable law and third-party provider rules still apply.' },
      { q: 'Does no KYC mean I can use every crypto service?', a: 'No. No FBT identity check describes this interface only. Wallets, payment providers, protocols and token issuers can impose their own eligibility checks and access restrictions.' },
      { q: 'Can a token be restricted in my own wallet?', a: 'Yes. Depending on the token and contract, an issuer can have pause or address-blocking controls. Holding your private key does not remove these controls. FBT Swap cannot override them.' },
      { q: 'Does this guide explain how to bypass provider restrictions?', a: 'No. It explains the boundaries of product claims. Follow applicable law and provider terms, stop when a provider says you are ineligible and seek qualified advice when needed.' }
    ],
    relatedSlugs: ['crypto-swap-without-kyc', 'what-stays-private-without-kyc', 'custodial-vs-non-custodial-wallets', 'trust/what-we-cannot-do', 'trust/contact-and-verification', 'crypto-security-checklist'],
    risk: 'General product and access information, not legal advice. Availability, laws and provider terms can change. No guarantee of unrestricted access, sanctions immunity, transaction success or protection against token-level restrictions is made.'
  }),

  article({
    slug: 'fa/crypto-access-and-restrictions', cluster: 'security', lang: 'fa', date: DATE, icon: 'shield', route: '/#/swap',
    title: 'صرافی بدون تحریم؟ محدودیت سواپ غیرامانی | FBT Swap',
    description: 'صرافی بدون تحریم یعنی چه؟ تفاوت نبود احراز هویت با نبود محدودیت، شرایط ارائه‌دهندگان و کنترل توکن را پیش از سواپ غیرامانی در اف بی تی بشناس.',
    h1: 'صرافی بدون تحریم؟ فرق نبود حساب با نبود محدودیت',
    intro: [
      'جست‌وجوی «صرافی بدون تحریم» دنبال وعده‌ای است که یک محصول نمی‌تواند با اطمینان بدهد. اف بی تی سواپ برای رابط سواپ روی زنجیره حساب یا مدرک شناسایی اف بی تی نمی‌خواهد؛ اما دسترسی در همهٔ کشورها یا مصونیت از تحریم، محدودیت ارائه‌دهندگان و کنترل صادرکنندهٔ توکن را تضمین نمی‌کند.',
      'بدون احراز هویت بودن، اجرای غیرامانی و دسترسی قانونی سه موضوع جدا هستند. این راهنما مرز آن‌ها را روشن می‌کند تا یک عبارت تبلیغاتی را اجازهٔ قانونی یا محافظت قطعی از دارایی فرض نکنی. متن توصیهٔ حقوقی نیست و روش دور زدن محدودیت‌ها ارائه نمی‌دهد.'
    ],
    sections: [
      ['بدون احراز هویت دقیقاً چه چیزی را می‌گوید؟', [
        'احراز هویت یا KYC یک فرایند بررسی هویت است. نبود بررسی هویت اف بی تی یعنی برای این رابط روی زنجیره حساب مشتری نمی‌سازی و مدرک به اف بی تی نمی‌دهی. این جمله دربارهٔ شرایط کیف پول، ارائه‌دهندهٔ پرداخت، صادرکنندهٔ توکن یا یک پروتکل خاص چیزی را تضمین نمی‌کند.',
        'این ادعا به خرید یا برداشت پول بانکی از سرویس‌های پرداخت گسترش پیدا نمی‌کند. صلاحیت استفاده ممکن است به ارائه‌دهنده و حوزهٔ قضایی وابسته باشد. نبود KYC ناشناس بودن هم نیست: انتقال‌های بلاکچین عمومی قابل مشاهده‌اند و سرویس‌ها ممکن است اطلاعات ارتباطی را پردازش کنند. شرایط مربوط را بخوان؛ نبود فرم ثبت‌نام، تکالیف دیگر را حذف نمی‌کند.'
      ]],
      ['لایه‌های دسترسی در سواپ غیرمتمرکز', [
        'فقط به یک سایت وابسته نیستی: کیف پول، نقطهٔ اتصال RPC، ارائه‌دهندهٔ نرخ، بلاکچین انتخابی و قراردادهای مسیر هم نقش دارند. ممکن است صفحه باز شود اما ارائه‌دهنده نرخ ندهد؛ یا نرخ ببینی ولی قرارداد انتقال را رد کند. اتصال اینترنت به‌تنهایی در دسترس بودن تراکنش برای تو را ثابت نمی‌کند.',
        'این اجزا ممکن است قواعد منطقه‌ای، قطعی یا کنترل‌های انطباق داشته باشند. اف بی تی سواپ نمی‌تواند در دسترس ماندن یک سرویس دیگر یا تأیید درخواست را قول بدهد. اگر ارائه‌دهنده گفته صلاحیت استفاده نداری، همان شرط را رعایت کن؛ رابط مجوز پنهان کردن وضعیت یا عبور از محدودیت قانونی نیست.'
      ]],
      ['غیرامانی بودن چه چیزی را محافظت می‌کند و چه چیزی را نه؟', [
        'اف بی تی سواپ سپردهٔ مشتری نگه نمی‌دارد و موجودی حساب اف بی تی برای مسدود کردن ندارد، چون چنین حسابی وجود ندارد. کلیدهای کیف پول نزد خودت هستند و تعامل‌ها را خودت تأیید می‌کنی. این موضوع رابطهٔ امانی با اف بی تی را حذف می‌کند، نه هر کنترلی را که ممکن است داخل دارایی یا قرارداد باشد.',
        'بعضی توکن‌ها امکان توقف یا مسدود کردن نشانی توسط صادرکننده دارند. پس یک استیبل‌کوین یا توکن دیگر ممکن است حتی در کیف پولی که کلیدش دست توست محدود شود. قراردادها می‌توانند کنترل حاکمیتی داشته باشند و نقدینگی هم ممکن است از بین برود. نگهداری شخصی مصونیت از این شرایط، زیان قیمت یا آسیب قرارداد نیست.'
      ]],
      ['چطور یک ادعای دسترسی را مسئولانه بررسی کنیم؟', [
        'ارائه‌دهندهٔ واقعی را شناسایی کن و شرایط فعلی‌اش را برای محل زندگی و همان خدمت مورد نظر بخوان. سواپ روی زنجیره را از بانکداری، خرید با پول بانکی، سهام توکنی‌شده و محصولات دیگری که شرایط جدا دارند تفکیک کن. این سایت وضعیت قانونی تو را تعیین نمی‌کند و جای مشاورهٔ تخصصی را نمی‌گیرد.',
        'دامنهٔ رسمی، شبکهٔ انتخابی، نشانی کامل قرارداد توکن و درخواست مجوز کیف پول را بررسی کن. کارمزد، حداقل دریافتی و منبع نرخ را بخوان. اگر سرویس درخواست را رد کرد، داده قدیمی بود یا معنی یک محدودیت را نمی‌فهمیدی، توقف کن؛ امضای مکرر یا پرداخت به فردی که وعدهٔ معافیت می‌دهد راه‌حل معتبر نیست.'
      ]],
      ['اف بی تی سواپ چه ادعایی می‌تواند بکند؟', [
        'توصیف دقیق محصول «رابط سواپ غیرامانی ارز دیجیتال، بدون نیاز به حساب اف بی تی برای سواپ روی زنجیره» است. محصول صرافی بدون تحریم، حساب بانکی یا سرویس با تضمین دسترسی همیشگی نیست. کارمزد پلتفرم پیش از امضا نمایش داده می‌شود و گس شبکه جدا می‌ماند.',
        'صفحه‌های مرتبط پایین، نگهداری دارایی، حریم خصوصی، محدودیت اپراتور و راه تماس رسمی را توضیح می‌دهند. کسی که می‌گوید پشتیبانی می‌تواند توکن محدودشده را آزاد کند، تراکنش را برگرداند یا معافیت تضمینی از شرط سرویس بفروشد، ادعایی بیرون از توان این محصول دارد. عبارت بازیابی، کلید خصوصی یا پولت را به او نده.'
      ]]
    ],
    facts: [
      ['احراز هویت اف بی تی', 'برای رابط سواپ روی زنجیره لازم نیست؛ شرایط سرویس‌های دیگر می‌تواند متفاوت باشد'],
      ['دسترسی از همه‌جا', 'تضمین ندارد؛ قواعد ارائه‌دهنده و قانون مرتبط همچنان مهم‌اند'],
      ['نگهداری دارایی', 'اف بی تی سواپ سپرده یا کلید کیف پول را نگه نمی‌دارد'],
      ['محدودیت توکن', 'کنترل صادرکننده یا قرارداد ممکن است روی توکن داخل کیف پول شخصی هم اعمال شود'],
      ['دامنهٔ حقوقی متن', 'فقط اطلاعات، نه نظر حقوقی یا روش فرار از محدودیت']
    ],
    faqs: [
      { q: 'آیا اف بی تی سواپ صرافی بدون تحریم است؟', a: 'اف بی تی سواپ رابط سواپ غیرامانی است، نه صرافی سپرده‌پذیر. برای سواپ روی زنجیره احراز هویت اف بی تی لازم نیست، اما دسترسی بدون تحریم یا بدون محدودیت تضمین نمی‌شود. قانون مرتبط و شرایط ارائه‌دهندگان دیگر همچنان اعمال می‌شوند.' },
      { q: 'آیا بدون احراز هویت یعنی استفاده از همهٔ سرویس‌های کریپتو؟', a: 'نه. نبود بررسی هویت اف بی تی فقط همین رابط را توصیف می‌کند. کیف پول، پرداخت، پروتکل و صادرکنندهٔ توکن می‌توانند بررسی صلاحیت و محدودیت جدا داشته باشند.' },
      { q: 'آیا توکن در کیف پول شخصی هم می‌تواند محدود شود؟', a: 'بله. بسته به توکن و قرارداد، صادرکننده ممکن است کنترل توقف یا مسدود کردن نشانی داشته باشد. داشتن کلید خصوصی این کنترل‌ها را حذف نمی‌کند و اف بی تی سواپ نمی‌تواند آن‌ها را خنثی کند.' },
      { q: 'آیا این راهنما روش دور زدن محدودیت سرویس را می‌گوید؟', a: 'نه. راهنما مرز ادعاهای محصول را توضیح می‌دهد. قانون و شرایط ارائه‌دهنده را رعایت کن، اگر ارائه‌دهنده گفته صلاحیت نداری توقف کن و در صورت نیاز مشاورهٔ تخصصی بگیر.' }
    ],
    relatedSlugs: ['fa/crypto-swap-without-kyc', 'fa/what-stays-private-without-kyc', 'fa/custodial-vs-non-custodial-wallets', 'fa/trust/what-we-cannot-do', 'fa/trust/contact-and-verification', 'fa/crypto-security-checklist'],
    risk: 'اطلاعات عمومی محصول و دسترسی است، نه توصیهٔ حقوقی. دسترس‌پذیری، قانون و شرایط ارائه‌دهندگان ممکن است تغییر کنند. هیچ تضمینی دربارهٔ دسترسی بی‌محدودیت، مصونیت از تحریم، موفقیت تراکنش یا حفاظت در برابر محدودیت خود توکن داده نمی‌شود.'
  })
];
