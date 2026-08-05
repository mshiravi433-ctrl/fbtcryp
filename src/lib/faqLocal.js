/**
 * OFFLINE ASSISTANT
 * ---------------------------------------------------------------------------
 * "Ask the AI" used to be dead whenever no backend was deployed and no Gemini
 * key was configured — which is the default state of a fresh build. A help
 * feature that answers nothing is worse than no help feature at all, so this
 * module makes the assistant work with zero configuration:
 *
 *   • First choice is still the real model (server, then direct Gemini). It
 *     handles open-ended questions far better than anything local can.
 *   • When neither is reachable, this retrieval engine answers from a curated
 *     knowledge base written by us about THIS app. For the questions users
 *     actually ask — fees, gas, why a swap failed, what slippage is, how to
 *     recover a wallet — a hand-written answer is more accurate than a model
 *     guessing anyway.
 *
 * The matcher is a small BM25-ish keyword scorer: no dependencies, instant,
 * works offline, and every answer is one we can stand behind. Answers are
 * returned in the UI language and always labelled with their source so nobody
 * mistakes a canned answer for a live model.
 */

/**
 * Each entry: id, keyword sets per language, and the answer per language.
 * `k` are match terms (lowercased, accent-free); `a` are the answers.
 */
import { feePercentString, toEasternDigits } from './feeBps';

/**
 * Resolve the `{{fee}}` placeholder inside a canned answer.
 *
 * These answers are plain strings, not i18next resources, so they never pass
 * through the interpolator that handles the locale files. Before this existed
 * they hard-coded "0.5%" while the swap engine charged 0.70% — the offline
 * assistant confidently quoted the wrong price, which is worse than the
 * assistant saying nothing at all.
 */
const FEE_DIGITS = { fa: '۰۱۲۳۴۵۶۷۸۹', ur: '۰۱۲۳۴۵۶۷۸۹', ar: '٠١٢٣٤٥٦٧٨٩' };

function fillFee(text, lang) {
  if (typeof text !== 'string' || !text.includes('{{fee}}')) return text;
  const digits = FEE_DIGITS[lang];
  const value = digits
    ? toEasternDigits(feePercentString(), digits).replace('.', '٫')
    : feePercentString();
  return text.replaceAll('{{fee}}', value);
}

const KB = [
  {
    id: 'deposit',
    k: {
      en: ['deposit', 'how do i add money', 'fund', 'top up', 'receive', 'send coins to', 'buy crypto', 'no deposit button', 'where is deposit'],
      fa: ['واریز', 'شارژ', 'پول بریزم', 'دریافت', 'چطور پول اضافه کنم', 'دکمه واریز', 'خرید ارز', 'کجا واریز کنم'],
      ar: ['إيداع', 'شحن', 'كيف أضيف أموال', 'استلام']
    },
    a: {
      en: 'There is no deposit button, and that is deliberate — this app never holds your money, so there is nothing to deposit INTO. Your coins live in your own wallet and you swap them straight from there.\n\nSo "funding" means funding your wallet, not this app:\n\n1. Open your wallet (MetaMask, Trust, or the in-app wallet) and copy YOUR address.\n2. Send coins to that address from wherever you already hold them — an exchange, or another person.\n3. Pick the right network when you send. An address that looks identical exists on BNB Chain, Ethereum and Polygon; sending on the wrong network can lose the funds permanently.\n4. Also send a little of the network\'s own coin for gas (BNB on BNB Chain, ETH on Ethereum). Without it you will hold tokens you cannot move.\n5. Come back, connect the wallet, and the balance appears by itself.',
      fa: 'دکمه واریز وجود ندارد و این عمدی است — این اپ هیچ‌وقت پول تو را نگه نمی‌دارد، پس جایی نیست که «به آن» واریز کنی. کوین‌ها در کیف پول خودت می‌مانند و مستقیم از همان‌جا سواپ می‌شوند.\n\nپس «شارژ کردن» یعنی شارژ کیف پول خودت، نه این اپ:\n\n۱. کیف پولت را باز کن (متامسک، تراست، یا کیف پول داخل اپ) و آدرس خودت را کپی کن.\n۲. از هرجا که ارز داری — صرافی یا شخص دیگر — به همان آدرس بفرست.\n۳. موقع ارسال حتماً شبکه درست را انتخاب کن. یک آدرس با ظاهر کاملاً یکسان روی BNB Chain و اتریوم و پالیگان وجود دارد؛ ارسال روی شبکه اشتباه می‌تواند دارایی را برای همیشه از بین ببرد.\n۴. کمی هم از کوین بومی شبکه برای گس بفرست (BNB روی BNB Chain، ETH روی اتریوم). بدون آن توکن داری ولی نمی‌توانی جابه‌جایش کنی.\n۵. برگرد، کیف پول را وصل کن، موجودی خودش ظاهر می‌شود.',
      ar: 'لا يوجد زر إيداع، وهذا مقصود: التطبيق لا يحتفظ بأموالك أبداً. أرسل عملاتك إلى عنوان محفظتك أنت، على الشبكة الصحيحة، مع القليل من عملة الشبكة للغاز، ثم اربط المحفظة وسيظهر الرصيد تلقائياً.'
    }
  },
  {
    id: 'howToSwap',
    k: {
      en: ['how to swap', 'how do i swap', 'first swap', 'steps to swap', 'exchange tokens', 'trade tokens', 'how does it work'],
      fa: ['چطور سواپ کنم', 'چگونه معامله', 'اولین سواپ', 'مراحل سواپ', 'تبدیل ارز', 'چطور کار میکند'],
      ar: ['كيف أبادل', 'خطوات التبادل', 'أول عملية']
    },
    a: {
      en: 'Six steps:\n\n1. Connect a wallet (Wallet tab). Nothing works until this is done.\n2. Choose the network at the top of the Swap screen. Both tokens must be on the SAME network here — to move between networks, use the Bridge screen.\n3. Pick the token you are paying with, and the one you want. If a token is missing, paste its contract address to import it.\n4. Type an amount. MAX leaves a little native coin behind on purpose, so you can still afford gas.\n5. Read the quote: the rate, the price impact, the {{fee}}% platform fee, and the estimated gas. Everything is shown BEFORE you sign, never after.\n6. Press Swap and approve in your wallet. For a non-native token there are two prompts — first Approve (permission for the router to move that token), then the swap itself. Two prompts is normal, not a bug.\n\nOnce signed it is on-chain and irreversible. Nobody — not us, not the wallet — can cancel or reverse it.',
      fa: 'شش قدم:\n\n۱. یک کیف پول وصل کن (تب کیف پول). تا این کار انجام نشود هیچ‌چیز کار نمی‌کند.\n۲. شبکه را از بالای صفحه سواپ انتخاب کن. هر دو توکن باید روی **یک شبکه** باشند — برای جابه‌جایی بین شبکه‌ها از صفحه «پل» استفاده کن.\n۳. توکنی که می‌دهی و توکنی که می‌خواهی را انتخاب کن. اگر توکنی نبود، آدرس قراردادش را جای‌گذاری کن تا اضافه شود.\n۴. مقدار را بنویس. دکمه MAX عمداً کمی کوین بومی باقی می‌گذارد تا گس داشته باشی.\n۵. قیمت را بخوان: نرخ، اثر قیمتی، کارمزد {{fee}}٪ پلتفرم و گس تخمینی. همه‌چیز **قبل** از امضا نشان داده می‌شود، نه بعدش.\n۶. Swap را بزن و در کیف پولت تأیید کن. برای توکن غیربومی دو بار تأیید می‌خواهد — اول Approve (اجازه جابه‌جایی آن توکن به روتر) و بعد خود سواپ. دو تأیید طبیعی است، باگ نیست.\n\nبعد از امضا تراکنش روی زنجیره ثبت و برگشت‌ناپذیر است. هیچ‌کس — نه ما، نه کیف پول — نمی‌تواند لغو یا برگردانش کند.',
      ar: 'اربط محفظتك، اختر الشبكة (يجب أن يكون كلا الرمزين على نفس الشبكة)، اختر الرمزين، أدخل المبلغ، راجع السعر والرسوم قبل التوقيع، ثم وقّع. للرموز غير الأصلية ستظهر موافقتان: Approve ثم التبادل. بعد التوقيع تصبح المعاملة نهائية ولا يمكن التراجع عنها.'
    }
  },
  {
    id: 'fees',
    k: {
      en: ['fee', 'fees', 'commission', 'cost', 'charge', 'how much', '0.5', 'percent'],
      fa: ['کارمزد', 'هزینه', 'درصد', 'کمیسیون', 'چقدر', 'نیم درصد', '۰.۵'],
      ar: ['رسوم', 'عمولة', 'تكلفة', 'كم']
    },
    a: {
      en: 'Every swap carries two separate costs. (1) The platform fee: {{fee}}% of the amount you send in, taken on-chain in the same transaction and shown to you before you sign. (2) The network fee (gas), paid in the chain\'s own coin — BNB on BNB Chain, ETH on Ethereum/Arbitrum/Base/Optimism, POL on Polygon, AVAX on Avalanche, TRX on Tron, SOL on Solana. Gas goes to the blockchain validators, not to us, and we cannot reduce or refund it.',
      fa: 'هر سواپ دو هزینه جدا دارد. ۱) کارمزد پلتفرم: {{fee}}٪ از مبلغ ورودی که روی زنجیره و در همان تراکنش برداشته می‌شود و قبل از امضا به تو نشان داده می‌شود. ۲) کارمزد شبکه (گس) که با کوین بومی همان شبکه پرداخت می‌شود — BNB روی BNB Chain، ETH روی اتریوم/آربیتروم/بیس/اپتیمیسم، POL روی پالیگان، AVAX روی آوالانچ، TRX روی ترون و SOL روی سولانا. گس به اعتبارسنج‌های بلاکچین می‌رسد نه به ما، و نه می‌توانیم کمش کنیم نه برگردانیم.',
      ar: 'كل عملية تبادل لها تكلفتان: رسوم المنصة {{fee}}٪ من المبلغ المُدخل تُخصم على السلسلة في نفس المعاملة، ورسوم الشبكة (الغاز) تُدفع بعملة الشبكة نفسها وتذهب للمُدققين وليس لنا.'
    }
  },
  {
    id: 'gas',
    k: {
      en: ['gas', 'network fee', 'bnb for gas', 'not enough', 'insufficient funds', 'which coin pays'],
      fa: ['گس', 'کارمزد شبکه', 'بنزین', 'موجودی کافی', 'کم بودن موجودی', 'کدام کوین'],
      ar: ['غاز', 'رسوم الشبكة', 'رصيد غير كاف']
    },
    a: {
      en: 'Gas is always paid in the native coin of the network you are on, and it must be in the same wallet. On BNB Chain you need a little BNB; on Ethereum, Arbitrum, Base and Optimism you need ETH; on Polygon, POL; on Avalanche, AVAX; on Tron, TRX (or energy); on Solana, SOL. You cannot pay Ethereum gas with BNB. If a swap fails with "insufficient funds", the missing amount is almost always gas, not the token you are swapping — top up a few dollars of the native coin and retry.',
      fa: 'گس همیشه با کوین بومی همان شبکه و از همان کیف پول پرداخت می‌شود. روی BNB Chain کمی BNB لازم داری؛ روی اتریوم، آربیتروم، بیس و اپتیمیسم اتر (ETH)؛ روی پالیگان POL؛ روی آوالانچ AVAX؛ روی ترون TRX یا Energy؛ روی سولانا SOL. با BNB نمی‌توانی گس اتریوم را بدهی. اگر سواپ با خطای «موجودی کافی نیست» شکست خورد، تقریباً همیشه کمبود گس است نه توکنی که می‌فروشی — چند دلار از کوین بومی شبکه شارژ کن و دوباره امتحان کن.',
      ar: 'يُدفع الغاز دائماً بعملة الشبكة الأصلية ومن نفس المحفظة: BNB على BNB Chain، وETH على إيثريوم وأربيتروم وبيس وأوبتيميزم، وPOL على بوليجون، وAVAX على أفالانش، وTRX على ترون، وSOL على سولانا.'
    }
  },
  {
    id: 'custody',
    k: {
      en: ['custody', 'hold my funds', 'deposit', 'do you keep', 'safe', 'non-custodial'],
      fa: ['نگهداری', 'واریز', 'پول من', 'امن', 'غیرحضانتی', 'دارایی من کجاست'],
      ar: ['حفظ', 'إيداع', 'أموالي', 'آمن']
    },
    a: {
      en: 'We never hold your funds and there is no deposit address anywhere in this app. Every transaction is signed by your own wallet and broadcast from it; your assets move from your address straight to the DEX contract. The flip side is that nobody — including us — can reverse a transaction or recover a lost recovery phrase.',
      fa: 'ما هرگز دارایی تو را نگه نمی‌داریم و هیچ آدرس واریزی در این اپ وجود ندارد. هر تراکنش را کیف پول خودت امضا و ارسال می‌کند و دارایی مستقیم از آدرس تو به قرارداد صرافی غیرمتمرکز می‌رود. روی دیگر سکه این است که هیچ‌کس — از جمله ما — نمی‌تواند تراکنشی را برگرداند یا عبارت بازیابی گم‌شده را بازیابی کند.',
      ar: 'نحن لا نحتفظ بأموالك ولا يوجد أي عنوان إيداع في التطبيق. كل معاملة توقّعها محفظتك وتُرسل منها مباشرة.'
    }
  },
  {
    id: 'slippage',
    k: {
      en: ['slippage', 'price impact', 'got less', 'different amount', 'minimum received'],
      fa: ['لغزش', 'اسلیپیج', 'تاثیر قیمت', 'کمتر گرفتم', 'حداقل دریافتی'],
      ar: ['انزلاق', 'تأثير السعر', 'أقل']
    },
    a: {
      en: 'Slippage is the gap between the price you were quoted and the price you actually get, because other trades land between your quote and your transaction. Your slippage setting is a limit, not a target: at 0.5% the swap simply reverts if you would receive more than 0.5% less than quoted. Raise it for thin, volatile tokens; keep it low for large stablecoin swaps. Anything above 3% is dangerous on an illiquid pair — that is the window a sandwich bot trades in.',
      fa: 'لغزش (اسلیپیج) فاصله بین قیمتی است که به تو نشان داده شده و قیمتی که واقعاً می‌گیری، چون بین لحظه قیمت‌گیری و اجرای تراکنش، معامله‌های دیگری ثبت می‌شوند. تنظیم اسلیپیج یک سقف است نه هدف: با ۰.۵٪ اگر قرار باشد بیش از ۰.۵٪ کمتر بگیری، تراکنش برمی‌گردد و انجام نمی‌شود. برای توکن‌های کم‌عمق و پرنوسان بالاترش ببر و برای سواپ‌های بزرگ استیبل‌کوین پایین نگهش دار. بالای ۳٪ روی جفت‌های کم‌نقدینگی خطرناک است — دقیقاً همان پنجره‌ای که ربات‌های ساندویچ در آن سود می‌کنند.',
      ar: 'الانزلاق هو الفرق بين السعر المعروض والسعر المنفّذ. الإعداد سقف وليس هدفاً: إذا تجاوز الفرق النسبة المحددة تُلغى المعاملة.'
    }
  },
  {
    id: 'failed',
    k: {
      en: ['failed', 'reverted', 'error', 'why did', 'not work', 'stuck', 'pending'],
      fa: ['شکست', 'خطا', 'انجام نشد', 'کار نکرد', 'گیر کرد', 'در انتظار'],
      ar: ['فشل', 'خطأ', 'لم تعمل', 'عالق']
    },
    a: {
      en: 'A swap usually fails for one of five reasons: not enough native coin for gas; price moved more than your slippage allowed; the token has a transfer tax the router could not absorb; the approval transaction has not confirmed yet; or the pair genuinely has no liquidity on that chain. The error banner names which one. A failed transaction still burns gas — the blockchain charges for the attempt, not the outcome.',
      fa: 'سواپ معمولاً به یکی از این پنج دلیل شکست می‌خورد: نبود کوین بومی کافی برای گس؛ حرکت قیمت بیشتر از اسلیپیج مجاز؛ توکنی که مالیات انتقال دارد و روتر نتوانسته پوششش دهد؛ تایید نشدن هنوزِ تراکنش Approve؛ یا نبود واقعی نقدینگی برای آن جفت روی آن شبکه. پیام خطا مشخص می‌کند کدام است. توجه: تراکنش ناموفق هم گس مصرف می‌کند — بلاکچین بابت تلاش هزینه می‌گیرد نه بابت نتیجه.',
      ar: 'أسباب الفشل الشائعة: نقص الغاز، تجاوز الانزلاق، ضريبة تحويل على العملة، عدم تأكيد الموافقة، أو غياب السيولة.'
    }
  },
  {
    id: 'seed',
    k: {
      en: ['seed', 'recovery phrase', 'lost wallet', '12 words', 'backup', 'restore'],
      fa: ['عبارت بازیابی', 'سید', '۱۲ کلمه', 'کیف پول گم', 'پشتیبان', 'بازیابی'],
      ar: ['عبارة الاسترداد', '١٢ كلمة', 'نسخة احتياطية']
    },
    a: {
      en: 'Your 12-word recovery phrase IS the wallet. Written on paper and kept offline it can restore your funds on any device, in this app or any other. Lose it and the funds are gone permanently — there is no reset, no support ticket, no exception. Never type it into a website, never photograph it, never send it to anyone claiming to be support. We will never ask for it.',
      fa: 'عبارت بازیابی ۱۲ کلمه‌ای، خودِ کیف پول توست. اگر روی کاغذ نوشته و آفلاین نگه داشته باشی، می‌توانی دارایی‌ات را روی هر دستگاهی و در هر اپلیکیشنی برگردانی. اگر گمش کنی، دارایی برای همیشه از بین می‌رود — نه ریست دارد، نه تیکت پشتیبانی، نه استثنا. هرگز آن را در سایتی تایپ نکن، از آن عکس نگیر و برای کسی که ادعای پشتیبانی دارد نفرست. ما هرگز آن را نمی‌خواهیم.',
      ar: 'عبارة الاسترداد المكوّنة من ١٢ كلمة هي محفظتك. احفظها على ورق دون اتصال ولا تشاركها مع أحد أبداً.'
    }
  },
  {
    id: 'coins',
    k: {
      en: ['how many coins', 'token list', 'find token', 'search', 'not listed', 'add token', 'contract address'],
      fa: ['چند سکه', 'لیست توکن', 'پیدا کردن توکن', 'جستجو', 'توکن نیست', 'افزودن توکن', 'آدرس قرارداد'],
      ar: ['كم عملة', 'قائمة العملات', 'بحث', 'إضافة عملة']
    },
    a: {
      en: 'The swap screen loads the public token lists for each chain — thousands of tokens per network — and you can search by name, ticker or contract address. If something brand new is not in a list yet, paste its contract address and the app reads the symbol and decimals straight off the chain and adds it. Being findable is not an endorsement: always verify the contract address against the project\'s own site before swapping.',
      fa: 'صفحه سواپ برای هر شبکه لیست‌های عمومی توکن را بارگذاری می‌کند — هزاران توکن روی هر شبکه — و می‌توانی با نام، نماد یا آدرس قرارداد جستجو کنی. اگر توکنی تازه منتشر شده و هنوز در هیچ لیستی نیست، آدرس قراردادش را بچسبان؛ اپ نماد و اعشار را مستقیم از روی زنجیره می‌خواند و اضافه‌اش می‌کند. توجه: پیدا شدن یک توکن به معنی تایید آن نیست — قبل از سواپ حتماً آدرس قرارداد را با سایت رسمی پروژه مطابقت بده.',
      ar: 'تحمّل شاشة التبادل قوائم العملات العامة لكل شبكة — آلاف العملات — ويمكنك البحث بالاسم أو الرمز أو عنوان العقد، أو لصق عنوان عقد جديد لإضافته.'
    }
  },
  {
    id: 'chains',
    k: {
      en: ['which network', 'chains', 'supported', 'solana', 'tron', 'polygon', 'ethereum', 'bridge'],
      fa: ['کدام شبکه', 'شبکه‌ها', 'پشتیبانی', 'سولانا', 'ترون', 'پالیگان', 'اتریوم', 'پل'],
      ar: ['أي شبكة', 'الشبكات', 'سولانا', 'ترون']
    },
    a: {
      en: 'Swaps run on seven EVM networks: BNB Chain, Ethereum, Polygon, Arbitrum, Base, Optimism and Avalanche. Solana has its own swap screen. For moving stablecoins BETWEEN networks — say USDT on BNB Chain to USDC on Arbitrum — use the Bridge screen, which compares every bridge and shows the full cost before you sign. Bridging to or from Solana and Tron is not offered yet.',
      fa: 'سواپ روی هفت شبکه EVM انجام می‌شود: BNB Chain، اتریوم، پالیگان، آربیتروم، بیس، اپتیمیسم و آوالانچ. سولانا صفحه سواپ جدای خودش را دارد. برای جابه‌جایی استیبل‌کوین بین شبکه‌ها — مثلاً تتر روی BNB به USDC روی آربیتروم — از صفحه «پل» استفاده کن که همه‌ی پل‌ها را مقایسه می‌کند و هزینه کامل را قبل از امضا نشان می‌دهد. پل زدن به سولانا و ترون فعلاً ارائه نمی‌شود.',
      ar: 'يعمل التبادل على سبع شبكات EVM، وتُدعم سولانا وترون كشبكات استلام. التبادل عبر السلاسل يحتاج جسراً بمخاطره الخاصة.'
    }
  },
  {
    id: 'realMoney',
    k: {
      en: ['real money', 'virtual', 'points', 'demo', 'is this real', 'credits'],
      fa: ['پول واقعی', 'مجازی', 'امتیاز', 'دمو', 'واقعی است', 'اعتبار'],
      ar: ['أموال حقيقية', 'افتراضي', 'نقاط']
    },
    a: {
      en: 'Two different things live in this app and the line between them is never blurred. Swap and Wallet are real: real chains, real tokens, real irreversible transactions. Predict, Invest, Earn and the leaderboard run on virtual credits with no cash value, no deposits and no withdrawals — they exist to teach the mechanics safely. Every one of those screens says so on the screen itself.',
      fa: 'در این اپ دو چیز کاملاً جدا وجود دارد و مرزشان هیچ‌وقت مبهم نیست. سواپ و کیف پول واقعی‌اند: شبکه واقعی، توکن واقعی، تراکنش واقعی و برگشت‌ناپذیر. پیش‌بینی، سرمایه‌گذاری، درآمد و جدول رتبه‌بندی با اعتبار مجازی کار می‌کنند که هیچ ارزش نقدی ندارد، واریز و برداشتی هم ندارد — این‌ها هستند تا مکانیزم بازار را بی‌خطر یاد بگیری. روی هر کدام از آن صفحه‌ها هم همین موضوع نوشته شده.',
      ar: 'التبادل والمحفظة حقيقيان بالكامل، أما التوقع والاستثمار والأرباح فتعمل برصيد افتراضي بلا قيمة نقدية.'
    }
  },
  {
    id: 'connect',
    k: {
      en: ['connect wallet', 'metamask', 'trust wallet', 'walletconnect', 'cannot connect', 'no wallet'],
      fa: ['اتصال کیف پول', 'متامسک', 'تراست ولت', 'وصل نمیشود', 'کیف پول ندارم'],
      ar: ['ربط المحفظة', 'ميتاماسك', 'لا يتصل']
    },
    a: {
      en: 'Three ways in: an injected wallet (MetaMask/Trust in a browser that has one), WalletConnect (scan or deep-link from any mobile wallet), or the built-in wallet this app can generate for you. Inside Telegram there is usually no injected wallet, so WalletConnect or the built-in one is the path. If a connection hangs on mobile, it is almost always the wallet app sitting in the background — reopen it, approve, then return here.',
      fa: 'سه راه ورود داری: کیف پول تزریق‌شده (متامسک/تراست در مرورگری که آن را دارد)، واردات از طریق WalletConnect (اسکن QR یا لینک مستقیم از هر کیف پول موبایلی)، یا کیف پول داخلی که همین اپ برایت می‌سازد. داخل تلگرام معمولاً کیف پول تزریق‌شده وجود ندارد، پس WalletConnect یا کیف پول داخلی راه درست است. اگر روی موبایل اتصال گیر کرد، تقریباً همیشه اپ کیف پول در پس‌زمینه منتظر تایید مانده — بازش کن، تایید کن و برگرد.',
      ar: 'ثلاث طرق: محفظة مُحقَنة، أو WalletConnect، أو المحفظة المدمجة. داخل تليجرام استخدم WalletConnect أو المحفظة المدمجة.'
    }
  },
  {
    id: 'notFound',
    k: {
      en: ['coin not found', 'no data', 'missing coin', 'price not loading', 'api'],
      fa: ['ارز پیدا نشد', 'داده ندارد', 'قیمت نمی‌آید', 'پیدا نشد', 'ای پی آی'],
      ar: ['العملة غير موجودة', 'لا توجد بيانات']
    },
    a: {
      en: 'If a coin page says "not found", the market list simply had not loaded that coin yet — the list is paged, and the detail screen now fetches any coin by id directly, so this should resolve itself on retry. Persistent blanks mean the data provider is rate-limiting the free tier; the app falls back to a cached snapshot and labels it as offline rather than showing a stale price as if it were live.',
      fa: 'اگر صفحه یک ارز پیغام «پیدا نشد» می‌داد، دلیلش این بود که آن ارز هنوز در فهرست بارگذاری‌شده نبود — فهرست صفحه‌بندی می‌شود و حالا صفحه جزئیات، هر ارز را مستقیم با شناسه‌اش می‌گیرد، پس با یک بار تلاش دوباره حل می‌شود. اگر همچنان خالی ماند، یعنی سرویس داده دارد نسخه رایگان را محدود می‌کند؛ در آن حالت اپ به داده ذخیره‌شده برمی‌گردد و صریحاً برچسب «آفلاین» می‌زند تا قیمت قدیمی را به‌جای زنده جا نزند.',
      ar: 'إذا ظهرت «العملة غير موجودة» فالقائمة لم تُحمّل تلك العملة بعد؛ صفحة التفاصيل تجلبها الآن مباشرة بالمعرّف.'
    }
  },
  {
    id: 'iranLegal',
    k: {
      en: ['iran', 'legal in iran', 'banned', 'allowed'],
      fa: ['ایران', 'قانون', 'ممنوع', 'مجاز', 'قوانین'],
      ar: ['إيران', 'قانوني', 'ممنوع']
    },
    a: {
      en: 'Short-term up/down betting on price is prohibited under Iranian law, so the prediction screen runs on virtual credits only and no real funds can ever be connected to it. Swapping tokens from your own wallet is a different activity and is not part of that restriction.',
      fa: 'شرط‌بندی کوتاه‌مدت روی جهت قیمت طبق قوانین ایران ممنوع است؛ به همین دلیل صفحه پیش‌بینی فقط با اعتبار مجازی کار می‌کند و امکان وصل کردن پول واقعی به آن اصلاً وجود ندارد. سواپ توکن از کیف پول خودت فعالیت دیگری است و مشمول این محدودیت نیست.',
      ar: 'المراهنة قصيرة المدى محظورة بموجب القانون الإيراني، لذا تعمل شاشة التوقع برصيد افتراضي فقط.'
    }
  }
];

const strip = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[\u064A]/g, 'ی')
    .replace(/[\u0643]/g, 'ک')
    .replace(/[\u200c]/g, ' ')
    .replace(/[۰-۹]/g, (d) => '0123456789'['۰۱۲۳۴۵۶۷۸۹'.indexOf(d)])
    .replace(/[^\p{L}\p{N}\s.]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Score every KB entry against the question and return the best match.
 * Returns null below the confidence floor, so we say "I don't know" instead of
 * confidently answering the wrong question.
 */
export function localAnswer(question, lang = 'fa') {
  const q = strip(question);
  if (!q) return null;
  const words = q.split(' ').filter((w) => w.length > 1);

  let best = null;
  let bestScore = 0;

  for (const entry of KB) {
    // Match against every language's keywords: users mix Persian and English
    // constantly ("گس چیه؟", "fee چقدره؟").
    const terms = Object.values(entry.k).flat().map(strip);
    let score = 0;
    for (const term of terms) {
      if (!term) continue;
      if (q.includes(term)) score += term.includes(' ') ? 3 : 2;
      else if (words.some((w) => term.startsWith(w) && w.length >= 3)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }

  if (!best || bestScore < 2) return null;
  const answer = fillFee(best.a[lang] ?? best.a.en, lang);
  return { id: best.id, answer, confidence: Math.min(1, bestScore / 6) };
}

/**
 * The knowledge base as a browsable FAQ.
 *
 * These twelve entries were written by hand, about this exact app, and each
 * one has been checked against what the code actually does. That makes them
 * strictly better than a model answering the same question — a model can
 * invent a fee, a network or a recovery path, and these cannot.
 *
 * The Help screen renders them directly as an accordion. Questions come from
 * i18n (`help.q.*`) so they read naturally per language; answers come from
 * here because they are long-form and safety-relevant.
 *
 * Order matters: the questions people actually arrive with are first. Fees,
 * gas and "why did my swap fail" account for most support contact.
 */
export const FAQ_ORDER = [
  'howToSwap',
  'deposit',
  'fees',
  'gas',
  'failed',
  'slippage',
  'custody',
  'seed',
  'coins',
  'chains',
  'connect',
  'realMoney',
  'notFound',
  'iranLegal'
];

/** Answer text for a FAQ id, in the given language. English is the fallback. */
export function faqAnswer(id, lang = 'en') {
  const entry = KB.find((e) => e.id === id);
  if (!entry) return null;
  return fillFee(entry.a[lang] ?? entry.a.en, lang);
}

/** Every FAQ entry, ready to render. */
export function faqList(lang = 'en') {
  return FAQ_ORDER.map((id) => ({ id, answer: faqAnswer(id, lang) })).filter((x) => x.answer);
}

/** Suggested questions for the empty state, in the KB's own words. */
export const FAQ_TOPICS = KB.map((e) => e.id);
