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
      en: ['fee', 'fees', 'commission', 'cost', 'charge', 'how much', '0.5', '0.7', 'percent'],
      fa: ['کارمزد', 'هزینه', 'درصد', 'کمیسیون', 'چقدر', 'نیم درصد', '۰.۵', '۰.۷'],
      ar: ['رسوم', 'عمولة', 'تكلفة', 'كم']
    },
    a: {
      en: 'Every swap carries two separate costs. (1) The platform fee: {{fee}}% of the amount you send in, taken on-chain in the same transaction and shown to you before you sign. (2) The network fee (gas), paid in the chain\'s own coin — BNB on BNB Chain, ETH on Ethereum/Arbitrum/Base/Optimism/Linea, POL on Polygon, AVAX on Avalanche, S on Sonic and SOL on Solana. Gas goes to the blockchain validators, not to us, and we cannot reduce or refund it.',
      fa: 'هر سواپ دو هزینه جدا دارد. ۱) کارمزد پلتفرم: {{fee}}٪ از مبلغ ورودی که روی زنجیره و در همان تراکنش برداشته می‌شود و قبل از امضا به تو نشان داده می‌شود. ۲) کارمزد شبکه (گس) که با کوین بومی همان شبکه پرداخت می‌شود — BNB روی BNB Chain، ETH روی اتریوم/آربیتروم/بیس/اپتیمیسم/لینیا، POL روی پالیگان، AVAX روی آوالانچ، S روی سونیک و SOL روی سولانا. گس به اعتبارسنج‌های بلاکچین می‌رسد نه به ما، و نه می‌توانیم کمش کنیم نه برگردانیم.',
      ar: 'كل عملية تبادل لها تكلفتان: رسوم المنصة {{fee}}٪ من المبلغ المُدخل تُخصم على السلسلة في نفس المعاملة، ورسوم الشبكة (الغاز) تُدفع بعملة الشبكة نفسها وتذهب للمُدققين وليس لنا. الغاز منفصل عن رسوم المنصة.'
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
      en: 'Gas is always paid in the native coin of the network you are on, and it must be in the same wallet. On BNB Chain you need a little BNB; on Ethereum, Arbitrum, Base, Optimism and Linea you need ETH; on Polygon, POL; on Avalanche, AVAX; on Sonic, S; and on Solana, SOL. You cannot pay Ethereum gas with BNB. If a swap fails with "insufficient funds", the missing amount is almost always gas, not the token you are swapping — top up a few dollars of the native coin and retry.',
      fa: 'گس همیشه با کوین بومی همان شبکه و از همان کیف پول پرداخت می‌شود. روی BNB Chain کمی BNB لازم داری؛ روی اتریوم، آربیتروم، بیس، اپتیمیسم و لینیا اتر (ETH)؛ روی پالیگان POL؛ روی آوالانچ AVAX؛ روی سونیک S؛ و روی سولانا SOL. با BNB نمی‌توانی گس اتریوم را بدهی. اگر سواپ با خطای «موجودی کافی نیست» شکست خورد، تقریباً همیشه کمبود گس است نه توکنی که می‌فروشی — چند دلار از کوین بومی شبکه شارژ کن و دوباره امتحان کن.',
      ar: 'يُدفع الغاز دائماً بعملة الشبكة الأصلية ومن نفس المحفظة: BNB على BNB Chain، وETH على إيثريوم وأربيتروم وبيس وأوبتيميزم ولينيا، وPOL على بوليجون، وAVAX على أفالانش، وS على سونيك، وSOL على سولانا.'
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
      en: 'Swaps run on nine EVM networks: BNB Chain, Ethereum, Polygon, Arbitrum, Base, Optimism, Avalanche, Linea and Sonic. Solana has its own swap screen, for ten supported swap networks in total. For moving eligible assets BETWEEN networks — say USDT on BNB Chain to USDC on Arbitrum — use the Bridge screen. It only shows routes a provider can quote for the chosen asset and destination, and shows the full cost before you sign.',
      fa: 'سواپ روی نه شبکه EVM انجام می‌شود: BNB Chain، اتریوم، پالیگان، آربیتروم، بیس، اپتیمیسم، آوالانچ، لینیا و سونیک. سولانا هم صفحهٔ سواپ جدا دارد؛ یعنی در مجموع ده شبکهٔ سواپ پشتیبانی می‌شود. برای جابه‌جایی دارایی‌های قابل‌پشتیبانی بین شبکه‌ها — مثلاً تتر روی BNB به USDC روی آربیتروم — از صفحه «پل» استفاده کن. فقط مسیرهایی نمایش داده می‌شوند که سرویس‌دهنده برای دارایی و مقصد انتخاب‌شده بتواند quote واقعی بدهد و هزینهٔ کامل پیش از امضا نشان داده می‌شود.',
      ar: 'يعمل التبادل على تسع شبكات EVM: BNB Chain وإيثريوم وبوليجون وأربيتروم وبيس وأوبتيميزم وأفالانش ولينيا وسونيك. ولسولانا شاشة تبديل خاصة، أي عشر شبكات مدعومة إجمالاً. للانتقال بين الشبكات استخدم شاشة الجسر؛ لا تظهر إلا المسارات التي يستطيع مزود الخدمة تسعيرها للأصل والوجهة المختارين، مع التكلفة الكاملة قبل التوقيع.'
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
      en: 'Two different things live in this app and the line between them is never blurred. Swap and Wallet are real: real chains, real tokens, real irreversible transactions. Predict, Invest and Earn run on virtual credits with no cash value, no deposits and no withdrawals — they exist to teach the mechanics safely. Every one of those screens says so on the screen itself.',
      fa: 'در این اپ دو چیز کاملاً جدا وجود دارد و مرزشان هیچ‌وقت مبهم نیست. سواپ و کیف پول واقعی‌اند: شبکه واقعی، توکن واقعی، تراکنش واقعی و برگشت‌ناپذیر. پیش‌بینی، سرمایه‌گذاری و درآمد با اعتبار مجازی کار می‌کنند که هیچ ارزش نقدی ندارد، واریز و برداشتی هم ندارد — این‌ها هستند تا مکانیزم بازار را بی‌خطر یاد بگیری. روی هر کدام از آن صفحه‌ها هم همین موضوع نوشته شده.',
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
  },

  {
    id: 'wcSecurityRisk',
    k: {
      en: ['security risk', 'flagged unsafe', 'unsafe domain', 'dangerous site', 'walletconnect warning', 'phishing', 'scam warning', 'security providers'],
      fa: ['هشدار امنیتی', 'دامنه ناامن', 'ریسک امنیتی', 'فیشینگ', 'هشدار ولت کانکت', 'دامنه پرچم خورده'],
      ar: ['خطر أمني', 'نطاق غير آمن', 'تصيد', 'تحذير']
    },
    a: {
      en: 'That red "security risk" screen comes from the wallet app (Trust/MetaMask) checking the domain the app introduced itself with — not from anything you did. An older version introduced itself as "https://localhost" inside the Android app, which is exactly what the wallet security scanners flag. Update to the latest version and connect from https://fbtswap.ir. If the warning still appears, report it via Help → Contact with your wallet name and version. Never type your recovery phrase anywhere to "verify" anything: no real support flow will ever ask for it.',
      fa: 'آن صفحه قرمز «ریسک امنیتی» را خودِ کیف پول (تراست/متامسک) نشان می‌دهد، چون دامنه‌ای را که اپ خودش را با آن معرفی کرده بررسی کرده است — نه به خاطر کاری که تو کردی. نسخه قدیمی داخل اپ اندروید خودش را «https://localhost» معرفی می‌کرد و دقیقاً همین را اسکنرهای امنیتی کیف پول پرچم می‌زنند. به آخرین نسخه آپدیت کن و از https://fbtswap.ir وصل شو. اگر هشدار همچنان آمد، از Help → Contact با نام کیف پول و نسخه‌اش گزارش بده. هرگز برای «تأیید» چیزی عبارت بازیابی را جایی تایپ نکن: هیچ پشتیبانی واقعی‌ای هرگز آن را نمی‌خواهد.',
      ar: 'شاشة "الخطر الأمني" الحمراء تأتي من المحفظة (Trust/MetaMask) بعد فحص النطاق الذي عرّف التطبيق نفسه به، وليس بسبب أي شيء فعلته. النسخة القديمة كانت تعرّف نفسها بـ "https://localhost" داخل تطبيق أندرويد، وهذا بالضبط ما ترصده فاحصات الأمان. حدّث إلى آخر نسخة واربط من https://fbtswap.ir. لا تكتب عبارة الاسترداد في أي مكان "للتحقق" — لن يطلبها أي دعم حقيقي أبداً.'
    }
  },
  {
    id: 'wcNoProjectId',
    k: {
      en: ['without project id', 'no project id', 'projectid', 'walletconnect id', 'remove project id', 'project id'],
      fa: ['بدون پراجکت آیدی', 'پروجکت آیدی', 'آیدی ولت کانکت', 'حذف پروجکت'],
      ar: ['معرف المشروع', 'بدون معرف المشروع']
    },
    a: {
      en: 'The WalletConnect project ID is not optional: the SDK refuses to start without one, because it is the credential the relay uses to route and authenticate your connection. Removing it would not make connecting "more private" — it would make connecting impossible. The ID itself is public by design (it ships in every client bundle); the security-relevant part is the DOMAIN registration and verification on the WalletConnect dashboard, which only the app owner can change. Those exact steps are written down in the Docs → Security section.',
      fa: 'پروجکت آیدی ولت کانکت اختیاری نیست: SDK بدون آن اصلاً شروع نمی‌شود، چون همین شناسه مدرکی است که رله با آن اتصال تو را مسیریابی و احراز هویت می‌کند. حذفش اتصال را «خصوصی‌تر» نمی‌کند — آن را غیرممکن می‌کند. خودِ شناسه ذاتاً عمومی است (در باندل هر کلاینتی هست)؛ بخش امنیتی ماجرا ثبت و تأیید دامنه در داشبورد ولت کانکت است که فقط مالک اپ می‌تواند انجامش دهد. قدم‌های دقیقش در Docs → بخش امنیت نوشته شده.',
      ar: 'معرف مشروع WalletConnect ليس اختيارياً: ترفض الحزمة البدء بدونه لأنه بيانات اعتماد الرِّيلاي لتوجيه اتصالك. حذفه لا يزيد الخصوصية بل يمنع الاتصال. المعرف نفسه عام بالتصميم؛ الجزء الأمني هو تسجيل النطاق والتحقق منه في لوحة التحكم، ولا يغيّره إلا مالك التطبيق. الخطوات مكتوبة في Docs ← الأمان.'
    }
  },
  {
    id: 'wcReconnect',
    k: {
      en: ['disconnect', 'reconnect', 'wallet opens', 'metamask opens', 'connect again', 'stale session', 'pairing', 'qr missing', 'modal', 'walletconnect not working'],
      fa: ['قطع اتصال', 'وصل دوباره', 'متامسک باز می‌شود', 'اتصال مجدد', 'کیوآر نمیاد', 'جفت‌سازی', 'ولت کانکت کار نمی‌کند'],
      ar: ['فصل', 'إعادة اتصال', 'محفظة تفتح', 'اقتران', 'الرمز لا يظهر']
    },
    a: {
      en: 'After any disconnect, the next Connect starts from a clean slate: the app removes the stored session, the last mobile deep-link choice and the recent-wallet memory before pairing again. If a wallet app still opens by itself and shows an error, that pairing was stale — close the wallet app, wait a few seconds and tap Connect again; every retry creates a brand-new pairing. If the QR modal never appears and no wallet opens, the relay is unreachable from your network (common on filtered connections): switch networks or use a VPN and retry.',
      fa: 'بعد از هر دیس‌کانکت، اتصال بعدی از صفر ساخته می‌شود: اپ سشن ذخیره‌شده، آخرین انتخاب دیپ‌لینک موبایل و حافظه کیف پول‌های اخیر را قبل از جفت‌سازی پاک می‌کند. اگر باز هم اپ کیف پول خودش باز شد و ارور داد، آن جفت‌سازی قدیمی بوده — اپ کیف پول را ببند، چند ثانیه صبر کن و دوباره Connect بزن؛ هر تلاش یک جفت‌سازی کاملاً تازه می‌سازد. اگر مودال کیوآر اصلاً نیامد و هیچ کیف پولی هم باز نشد، رله از شبکه تو در دسترس نیست (روی شبکه‌های فیلترشده عادی است): شبکه را عوض کن یا VPN روشن کن و دوباره امتحان کن.',
      ar: 'بعد أي فصل، يبدأ الاتصال التالي من الصفر: يمسح التطبيق الجلسة المخزنة وآخر خيار رابط عميق وذاكرة المحافظ الأخيرة قبل الاقتران. إذا فتحت المحفظة وحدها وأظهرت خطأً فالاقتران قديم — أغلق المحفظة وانتظر قليلاً واضغط اتصال مجدداً؛ كل محاولة تنشئ اقتراناً جديداً. إذا لم يظهر رمز QR إطلاقاً فالرِّيلاي غير متاح من شبكتك: غيّر الشبكة أو استخدم VPN.'
    }
  },
  {
    id: 'tokenMissing',
    k: {
      en: ['balance missing', 'bitcoin not showing', 'wbtc', 'cbbtc', 'btcb', 'token not showing', 'balance zero', 'wrong chain', 'coins missing', 'my bitcoin'],
      fa: ['موجودی نمایش داده نمی‌شود', 'بیت کوین نیست', 'موجودی صفر', 'شبکه اشتباه', 'توکن گم شده', 'WBTC', 'cbBTC', 'BTCB'],
      ar: ['الرصيد لا يظهر', 'بيتكوين لا يظهر', 'رصيد صفر', 'شبكة خاطئة', 'عملة مفقودة']
    },
    a: {
      en: 'A token is never "hidden" — it lives on a specific network, and the Wallet tab shows the network your wallet is connected to. Bitcoin exists here only as wrapped versions: WBTC on Ethereum and Arbitrum, cbBTC on Base, BTCB on BNB Chain. Pick "All networks" at the top of the Wallet tab to see holdings on every chain at once. If a balance still reads zero, check the network inside Trust/MetaMask itself — the wallet may be on a different chain than you think.',
      fa: 'هیچ توکنی «پنهان» نمی‌شود — هر توکن روی یک شبکه مشخص است و تب کیف پول، شبکه‌ای را نشان می‌دهد که کیف پولت به آن وصل است. بیت‌کوین اینجا فقط در نسخه‌های رپ‌شده وجود دارد: WBTC روی اتریوم و آربیتروم، cbBTC روی بیس و BTCB روی BNB Chain. بالای تب کیف پول «همه شبکه‌ها» را انتخاب کن تا دارایی همه شبکه‌ها یکجا دیده شود. اگر باز هم موجودی صفر بود، داخل خودِ تراست/متامسک شبکه را چک کن — ممکن است کیف پول روی شبکه دیگری باشد.',
      ar: 'لا تُخفى أي عملة — كل عملة على شبكة محددة، وتبويب المحفظة يعرض شبكة محفظتك المتصلة. البيتكوين هنا نسخ مغلفة فقط: WBTC على إيثريوم وأربيتروم، وcbBTC على بيس، وBTCB على BNB Chain. اختر "كل الشبكات" لرؤية كل ما تملك. إذا بقي الرصيد صفراً فتحقق من الشبكة داخل المحفظة نفسها.'
    }
  },
  {
    id: 'portfolio',
    k: {
      en: ['portfolio', 'total balance', 'net worth', 'all networks', 'holdings', 'total value'],
      fa: ['سبد', 'موجودی کل', 'همه شبکه‌ها', 'ارزش کل', 'دارایی'],
      ar: ['المحفظة الإجمالية', 'إجمالي الرصيد', 'كل الشبكات']
    },
    a: {
      en: 'The Portfolio reads every supported chain through public RPC endpoints — it never needs you to switch networks and never talks to a central exchange. The total is the sum of the chains that answered; a chain showing "unavailable" simply had an RPC that did not respond, and a refresh fixes it. Dust balances under one cent are hidden, and tokens without a price are still listed with a dash instead of a value.',
      fa: 'سبد دارایی همه شبکه‌های پشتیبانی‌شده را از طریق RPC عمومی می‌خواند — نه نیازی به تعویض شبکه داری و نه با هیچ صرافی مرکزی حرفی می‌زند. جمع کل، مجموع شبکه‌هایی است که پاسخ داده‌اند؛ شبکه‌ای که «در دسترس نیست» فقط RPC‌اش جواب نداده و رفرش درستش می‌کند. موجودی‌های زیر یک سنت به‌عنوان گردوغبار پنهان می‌شوند و توکن‌های بدون قیمت هم با خط تیره به‌جای ارزش نمایش داده می‌شوند.',
      ar: 'تقرأ المحفظة الإجمالية كل الشبكات المدعومة عبر RPC عام — لا حاجة لتبديل الشبكة ولا تعامل مع بورصة مركزية. الإجمالي مجموع الشبكات التي استجابت؛ "غير متاح" تعني أن RPC لم يستجب والتحديث يصلحها. الأرصدة تحت سنت واحد تُخفى، والعملات بلا سعر تظهر بشرطة بدل القيمة.'
    }
  },
  {
    id: 'intentOS',
    k: {
      en: ['intent', 'intent os', 'intent-based', 'solver', 'natural language', 'ai order', 'intention'],
      fa: ['اینتنت', 'اینتنت او اس', 'سفارش متنی', 'سالور', 'زبان طبیعی'],
      ar: ['نية', 'نظام النوايا', 'أمر نصي', 'حلّال']
    },
    a: {
      en: 'Intent OS lets you describe a trade in plain words ("swap 50 USDT to BNB when the price is right") and compiles it into an order: route, limit price and fees are all shown before you sign anything. You approve the spending allowance once; a solver executes it when the market matches your intent. A filled intent is a real on-chain trade — final and irreversible — so double-check the amount and direction, and track it in Orders.',
      fa: 'اینتنت OS می‌گذارد معامله را با زبان ساده بنویسی («۵۰ USDT را وقتی قیمت مناسب شد به BNB تبدیل کن») و آن را به یک سفارش کامپایل می‌کند: مسیر، قیمت حد و کارمزدها همه قبل از هر امضایی نمایش داده می‌شوند. اجازه خرج کردن را یک‌بار می‌دهی و یک حل‌کننده وقتی بازار با اینتنتت منطبق شد اجرایش می‌کند. اینتنت پرشده یک معامله واقعی روی زنجیره است — قطعی و برگشت‌ناپذیر — پس مقدار و جهت را دوباره چک کن و در Orders پیگیرش باش.',
      ar: 'يتيح نظام النوايا وصف الصفقة بكلمات بسيطة ويحوّلها إلى أمر: المسار وسعر الحد والرسوم تظهر قبل أي توقيع. توافق على إذن الإنفاق مرة واحدة وينفذها حلّال عندما يطابق السوق نيتك. النية المنفذة صفقة حقيقية على السلسلة — نهائية لا رجعة فيها — فراجع المبلغ والاتجاه وتابعها في Orders.'
    }
  },
  {
    id: 'smartWallet',
    k: {
      en: ['smart wallet', 'in-app wallet', 'local wallet', 'create wallet', 'forget wallet', 'vault', '12 words', 'recovery phrase app'],
      fa: ['کیف پول داخل اپ', 'کیف پول محلی', 'ساخت کیف پول', 'فراموش کردن کیف پول', 'ولت داخل اپ', '۱۲ کلمه'],
      ar: ['محفظة داخل التطبيق', 'محفظة محلية', 'إنشاء محفظة', '١٢ كلمة', 'خزنة']
    },
    a: {
      en: 'The in-app wallet is a self-custody vault encrypted on your device: the 12-word phrase is the wallet itself. Write it on paper, offline; set a strong password; export the encrypted backup file from Settings as a second copy. To remove the wallet, disconnect and delete the vault — but only if the phrase is safe, because the phrase is the only way back. Nobody, including support, can recover a lost phrase.',
      fa: 'کیف پول داخل اپ یک خزانه خودنگهدار است که روی دستگاه خودت رمزنگاری می‌شود: عبارت ۱۲ کلمه‌ای، خودِ کیف پول است. آن را روی کاغذ و آفلاین بنویس؛ رمز قوی بگذار؛ از تنظیمات فایل پشتیبان رمزنگاری‌شده را به‌عنوان نسخه دوم بردار. برای حذف کیف پول، دیس‌کانکت کن و خزانه را پاک کن — اما فقط وقتی عبارت امن است، چون عبارت تنها راه برگشت است. هیچ‌کس، حتی پشتیبانی، عبارت گم‌شده را برنمی‌گرداند.',
      ar: 'المحفظة داخل التطبيق خزنة ذاتية الحراسة مشفرة على جهازك: عبارة الـ ١٢ كلمة هي المحفظة نفسها. اكتبها على ورق دون اتصال، وضع كلمة مرور قوية، وصدّر النسخة الاحتياطية المشفرة من الإعدادات. لحذفها افصل ثم احذف الخزنة — فقط إذا كانت العبارة محفوظة، فهي السبيل الوحيد للعودة. لا أحد، حتى الدعم، يستطيع استرجاع عبارة مفقودة.'
    }
  },
  {
    id: 'p2p',
    k: {
      en: ['p2p', 'peer to peer', 'escrow', 'buy usdt', 'sell usdt', 'merchant', 'fiat', 'release order'],
      fa: ['همتا به همتا', 'امانی', 'خرید یو اس دی تی', 'فروش یو اس دی تی', 'فیات', 'آزادسازی'],
      ar: ['ند لند', 'ضمان', 'شراء USDT', 'بيع USDT', 'إفراج']
    },
    a: {
      en: 'P2P trades happen between two people, with the crypto locked in escrow until the fiat payment is confirmed. Only trade inside the escrow chat, only release when the money is really in your own account, and never accept requests to continue the deal on another app. Anyone asking to release early, or to "verify" with a payment you did not initiate, is running a scam — report them and stop.',
      fa: 'معامله P2P بین دو نفر انجام می‌شود و رمزارز تا تأیید پرداخت فیات در امانی قفل می‌ماند. فقط داخل چت امانی معامله کن، فقط وقتی پول واقعاً به حساب خودت نشست آزادش کن، و هرگز درخواست ادامه معامله در اپ دیگری را قبول نکن. هرکس خواست زود آزاد کنی یا با پرداختی که خودت شروع نکرده‌ای «تأیید» کنی، کلاهبردار است — گزارش کن و ادامه نده.',
      ar: 'تتم صفقات P2P بين شخصين والعملة مقفلة في الضمان حتى يتأكد الدفع النقدي. تعامل فقط داخل محادثة الضمان، وحرّر فقط عندما يصل المال فعلاً إلى حسابك، ولا تقبل أبداً إكمال الصفقة في تطبيق آخر. من يطلب الإفراج المبكر أو "التحقق" بدفعة لم تبدأها أنت محتال — أبلغ عنه وتوقف.'
    }
  },
  {
    id: 'ordersAutomation',
    k: {
      en: ['order', 'automation', 'limit order', 'trigger price', 'stop loss', 'take profit', 'pending order'],
      fa: ['سفارش', 'اتوماسیون', 'قیمت فعال‌سازی', 'حد ضرر', 'حد سود', 'سفارش در انتظار'],
      ar: ['أمر', 'أتمتة', 'سعر تفعيل', 'وقف خسارة', 'جني أرباح']
    },
    a: {
      en: 'Orders and automation let you set a trigger price and amount; the order waits and executes when the market reaches it. Keep notifications on so you learn the moment it fills or fails. An order is not a price guarantee: in a fast move it can fill with slippage, and a filled order is a real trade. Cancel anytime before it triggers — an open order costs nothing.',
      fa: 'سفارش و اتوماسیون می‌گذارد قیمت فعال‌سازی و مقدار تعیین کنی؛ سفارش منتظر می‌ماند و وقتی بازار به آن رسید اجرا می‌شود. اعلان‌ها را روشن نگه دار تا لحظه پر شدن یا شکست را بفهمی. سفارش تضمین قیمت نیست: در حرکت سریع ممکن است با لغزش پر شود و سفارش پرشده هم یک معامله واقعی است. قبل از فعال شدن هر وقت خواستی لغوش کن — سفارش باز هزینه‌ای ندارد.',
      ar: 'الأوامر والأتمتة تتيح تحديد سعر تفعيل ومبلغ؛ ينتظر الأمر ويُنفذ عندما يصل السوق إليه. أبقِ الإشعارات مفعلة لتعرف لحظة التنفيذ أو الفشل. الأمر ليس ضماناً للسعر: في الحركة السريعة قد يُنفذ بانزلاق، والمنفذ صفقة حقيقية. ألغِ في أي وقت قبل التفعيل — الأمر المفتوح لا يكلف شيئاً.'
    }
  },
  {
    id: 'signals',
    k: {
      en: ['signal', 'signals', 'rsi', 'macd', 'indicator', 'technical analysis', 'buy signal'],
      fa: ['سیگنال', 'اندیکاتور', 'تحلیل تکنیکال', 'سیگنال خرید'],
      ar: ['إشارة', 'مؤشر', 'تحليل فني']
    },
    a: {
      en: 'Signals are technical indicators (RSI, MACD and similar) computed on market data. They are measurements, not predictions: no indicator can tell the future, and no signal is a promise of profit. Use them to time entries you have already decided on — never as a reason to trade money you cannot afford to lose.',
      fa: 'سیگنال‌ها اندیکاتورهای تکنیکال (RSI و MACD و مشابه) هستند که روی داده بازار محاسبه می‌شوند. این‌ها اندازه‌گیری‌اند، نه پیش‌بینی: هیچ اندیکاتوری آینده را نمی‌داند و هیچ سیگنالی وعده سود نیست. از آن‌ها برای زمان‌بندی ورودهایی استفاده کن که از قبل تصمیمشان را گرفته‌ای — نه به‌عنوان بهانه معامله با پولی که تحمل از دست دادنش را نداری.',
      ar: 'الإشارات مؤشرات فنية (RSI وMACD ونحوها) محسوبة على بيانات السوق. هي قياسات لا تنبؤات: لا مؤشر يعرف المستقبل ولا إشارة تعد بالربح. استخدمها لتوقيت دخول قررت عليه مسبقاً — لا سبباً للمتاجرة بمال لا تتحمل خسارته.'
    }
  },
  {
    id: 'bridge',
    k: {
      en: ['bridge', 'cross chain', 'move between networks', 'wrong network', 'transfer network', 'network fee bridge'],
      fa: ['پل', 'کراس چین', 'انتقال بین شبکه', 'شبکه اشتباه', 'جابه‌جایی شبکه'],
      ar: ['جسر', 'عبر السلاسل', 'نقل بين الشبكات', 'شبكة خاطئة']
    },
    a: {
      en: 'The Bridge moves tokens between networks and shows every cost — the bridge fee, the network fees and the platform fee — before you sign. Always confirm the destination network on the receiving side: funds sent to the wrong network are lost permanently, which is exactly why the screen asks you to confirm the target chain explicitly.',
      fa: 'پل، توکن‌ها را بین شبکه‌ها جابه‌جا می‌کند و همه هزینه‌ها — کارمزد پل، کارمزد شبکه‌ها و کارمزد پلتفرم — را قبل از امضا نشان می‌دهد. همیشه شبکه مقصد را در سمت گیرنده تأیید کن: دارایی ارسال‌شده به شبکه اشتباه برای همیشه از بین می‌رود؛ دقیقاً به همین دلیل صفحه از تو می‌خواهد زنجیره مقصد را صریح تأیید کنی.',
      ar: 'ينقل الجسر العملات بين الشبكات ويعرض كل التكاليف — رسوم الجسر ورسوم الشبكات ورسوم المنصة — قبل التوقيع. أكّد دائماً شبكة الوجهة: الأموال المرسلة إلى شبكة خاطئة تضيع نهائياً، ولهذا تطلب الشاشة تأكيد السلسلة الهدف صراحةً.'
    }
  },
  {
    id: 'buyCrypto',
    k: {
      en: ['buy', 'onramp', 'buy crypto', 'card', 'credit card', 'ramp', 'buy with card'],
      fa: ['خرید', 'خرید ارز', 'کارت بانکی', 'درگاه خرید'],
      ar: ['شراء', 'شراء عملات', 'بطاقة', 'بوابة شراء']
    },
    a: {
      en: 'Buying crypto with a card or bank transfer is handled by third-party on-ramp providers, so their KYC checks and fees apply on top of the price. The app never sees your card details and never holds the purchased coins — they are sent to the address you provide. Pick the correct network when you choose the destination address.',
      fa: 'خرید ارز با کارت یا انتقال بانکی را ارائه‌دهنده‌های شخص ثالث انجام می‌دهند، پس احراز هویت و کارمزد خودشان روی قیمت اضافه می‌شود. اپ هرگز مشخصات کارتت را نمی‌بیند و ارز خریداری‌شده را نگه نمی‌دارد — مستقیم به آدرسی که می‌دهی ارسال می‌شود. موقع انتخاب آدرس مقصد، شبکه درست را انتخاب کن.',
      ar: 'الشراء بالبطاقة أو التحويل البنكي يتم عبر مزوّدين خارجيين، فتنطبق تحققاتهم ورسومهم فوق السعر. التطبيق لا يرى بيانات بطاقتك ولا يحتفظ بالعملات — تُرسل إلى العنوان الذي تحدده. اختر الشبكة الصحيحة عند اختيار عنوان الوجهة.'
    }
  },
  {
    id: 'farmYield',
    k: {
      en: ['farm', 'staking', 'yield', 'apy', 'liquidity pool', 'impermanent loss', 'lp', 'earn'],
      fa: ['فارم', 'استیکینگ', 'بازده', 'استخر نقدینگی', 'زیان ناپایدار', 'کسب درآمد'],
      ar: ['مزرعة', 'تخزين', 'عائد', 'مجمع سيولة', 'خسارة غير دائمة']
    },
    a: {
      en: 'Farm and Earn yields come from liquidity pools and staking protocols, and the displayed APY is an estimate that changes with market activity. The risk you cannot see is impermanent loss: when one token in a pair moves a lot, your share can end up worth less than simply holding both tokens. Only farm money you plan to leave alone for a while.',
      fa: 'بازده فارم و Earn از استخرهای نقدینگی و پروتکل‌های استیکینگ می‌آید و APY نمایش‌داده‌شده یک تخمین است که با فعالیت بازار عوض می‌شود. ریسکی که نمی‌بینی زیان ناپایدار است: وقتی یکی از توکن‌های جفت خیلی حرکت کند، سهم تو ممکن است از نگه‌داشتن ساده هر دو توکن کم‌ارزش‌تر شود. فقط پولی را فارم کن که قرار است مدتی به آن دست نزنی.',
      ar: 'عوائد المزرعة والكسب تأتي من مجمعات السيولة وبروتوكولات التخزين، والنسبة المعروضة تقدير يتغير مع السوق. الخطر الخفي هو الخسارة غير الدائمة: إذا تحرك أحد الرمزين كثيراً قد تقل قيمة حصتك عن مجرد الاحتفاظ بالرمزين. لا تزرع إلا مالاً تنوي تركه فترة.'
    }
  },
  {
    id: 'rewardsPoints',
    k: {
      en: ['rewards', 'points', 'leaderboard', 'shop', 'perks', 'quest', 'xp', 'rank'],
      fa: ['جایزه', 'امتیاز', 'لیدربرد', 'فروشگاه', 'کوئست', 'رتبه'],
      ar: ['مكافآت', 'نقاط', 'لوحة الصدارة', 'متجر', 'مهمات']
    },
    a: {
      en: 'Rewards, quests, the leaderboard and the shop are gamification on top of real usage: they grant points and perks, never guaranteed money. Points have whatever value the shop gives them and that can change. Quests like "connect your wallet" pay once and are idempotent, so reconnecting cannot pay twice.',
      fa: 'جایزه‌ها، کوئست‌ها، لیدربرد و فروشگاه، بازي‌سازی روی استفاده واقعی‌اند: امتیاز و مزیت می‌دهند، نه پول تضمین‌شده. ارزش امتیاز همانی است که فروشگاه به آن می‌دهد و ممکن است تغییر کند. کوئست‌هایی مثل «وصل کردن کیف پول» فقط یک‌بار پرداخت می‌شوند و تکرار اتصال دوباره پرداخت نمی‌کند.',
      ar: 'المكافآت والمهمات ولوحة الصدارة والمتجر عناصر تحفيز فوق الاستخدام الحقيقي: تمنح نقاطاً ومزايا لا أموالاً مضمونة. قيمة النقاط هي ما يمنحه المتجر وقد تتغير. المهمات مثل "اربط المحفظة" تُدفع مرة واحدة ولا تتكرر.'
    }
  },
  {
    id: 'derivatives',
    k: {
      en: ['ostium', 'perp', 'perpetual', 'predict', 'invest', 'derivatives', 'leverage', 'dydx', 'futures', 'margin'],
      fa: ['استیوم', 'پرپ', 'مشتقات', 'ضریب', 'آتی'],
      ar: ['مشتقات', 'رافعة', 'عقود آجلة', 'هامش']
    },
    a: {
      en: 'The derivatives screens (dYdX, Ostium, Perp, Invest and the derivatives dashboard) trade positions that amplify every price move, where a small move can close your position and take the margin with it. Screens that predict the next price move run on virtual credits where local law requires it. A multiplier cuts both ways — it enlarges losses exactly like gains — so start with the smallest position the screen allows.',
      fa: 'صفحه‌های مشتقات (dYdX، استیوم، Perp، Invest و داشبورد مشتقات) پوزیشن‌هایی با ضریب معامله می‌کنند که در آن‌ها یک حرکت کوچک قیمت می‌تواند پوزیشنت را ببندد و مارجین را با خودش ببرد. صفحه‌های مربوط به پیش‌بینی، آن‌جا که قانون محلی لازم می‌داند، فقط با اعتبار مجازی کار می‌کنند. ضریب، ضرر را دقیقاً مثل سود چند برابر می‌کند — با کوچک‌ترین پوزیشن ممکن شروع کن.',
      ar: 'شاشات المشتقات تتداول مراكز برافعة: حركة سعر صغيرة قد تغلق مركزك وتأخذ الهامش. شاشات توقع السعر تعمل برصيد افتراضي حيث يقتضي القانون المحلي. الرافعة تضاعف الخسارة كما الربح — ابدأ بأصغر مركز تسمح به الشاشة.'
    }
  },
  {
    id: 'nft',
    k: {
      en: ['nft', 'non fungible', 'collectible', 'mint', 'floor price'],
      fa: ['ان اف تی', 'کلکسیونی', 'مینت'],
      ar: ['رموز غير قابلة للاستبدال', 'مقتنيات']
    },
    a: {
      en: 'The NFT screen shows the NFTs held by the connected wallet, read straight from the chain. NFTs are not investments by default: most collections have no buyers. Never buy an NFT because a floor price went up — that price is the lowest ask, not what someone actually paid.',
      fa: 'صفحه NFT، ان‌اف‌تی‌های کیف پول متصل را مستقیم از زنجیره می‌خواند. ان‌اف‌تی به‌طور پیش‌فرض سرمایه‌گذاری نیست: اکثر کلکسیون‌ها خریدار ندارند. هرگز فقط به خاطر بالا رفتن قیمت کف، ان‌اف‌تی نخر — قیمت کف پایین‌ترین قیمت پیشنهادی فروشنده است، نه قیمتی که کسی واقعاً پرداخته.',
      ar: 'تعرض شاشة NFT مقتنيات المحفظة المتصلة مباشرة من السلسلة. رموز NFT ليست استثماراً افتراضياً: معظم المجموعات بلا مشترين. لا تشترِ لأن السعر الأدنى ارتفع — فهو أدنى سعر طلب وليس ما دفعه أحد فعلاً.'
    }
  },
  {
    id: 'solana',
    k: {
      en: ['solana', 'sol', 'phantom', 'solana swap', 'spl token'],
      fa: ['سولانا', 'فانتوم', 'سواپ سولانا'],
      ar: ['سولانا', 'فانتوم']
    },
    a: {
      en: 'The Solana screen swaps SPL tokens on Solana from your own wallet (Phantom or any Solana wallet). Fees are paid in SOL, and Solana tokens cannot be seen or sent on EVM networks — the two are separate chains with separate addresses. A Solana address on an EVM network is how funds get lost, so the screen keeps the two flows apart on purpose.',
      fa: 'صفحه سولانا توکن‌های SPL را روی سولانا از کیف پول خودت (فانتوم یا هر کیف سولانا) سواپ می‌کند. کارمزدها با SOL پرداخت می‌شود و توکن‌های سولانا روی شبکه‌های EVM نه دیده می‌شوند نه قابل ارسال‌اند — این دو زنجیره‌های جدایند با آدرس‌های جدا. استفاده از آدرس سولانا روی شبکه EVM دقیقاً راهی است که دارایی گم می‌شود؛ برای همین صفحه عمداً این دو مسیر را جدا نگه می‌دارد.',
      ar: 'تبدّل شاشة سولانا رموز SPL على سولانا من محفظتك (فانتوم أو أي محفظة سولانا). الرسوم تُدفع بـ SOL، ورموز سولانا لا تُرى ولا تُرسل على شبكات EVM — سلسلتان منفصلتان بعناوين منفصلة.'
    }
  },
  {
    id: 'stocks',
    k: {
      en: ['stock', 'stocks', 'equities', 'tokenized stock', 'shares', 'stock token'],
      fa: ['سهام', 'سهم', 'سهام توکنیزه'],
      ar: ['أسهم', 'سهم', 'أسهم مرمزة']
    },
    a: {
      en: 'The Stocks screen shows tokenized equity trackers. They mirror a share price, not the share itself: the issuer can delist them, and their price can drift from the real market. Treat them as a derivative of the price — never as owning the company.',
      fa: 'صفحه سهام، ردیاب‌های توکنیزه سهام را نشان می‌دهد. این‌ها آینه قیمت سهم‌اند، نه خود سهم: صادرکننده می‌تواند آن‌ها را از فهرست خارج کند و قیمتشان می‌تواند از بازار واقعی فاصله بگیرد. با آن‌ها مثل مشتق قیمت رفتار کن — نه مالکیت شرکت.',
      ar: 'تعرض شاشة الأسهم متتبعات أسهم مرمزة. هي تعكس سعر السهم لا السهم نفسه: يمكن للمُصدر شطبها وقد ينحرف سعرها عن السوق الحقيقي. تعامل معها كمشتق للسعر — لا كملكية للشركة.'
    }
  },
  {
    id: 'newsMarket',
    k: {
      en: ['news', 'market', 'price', 'coin detail', 'chart', 'market cap', 'rank', 'headline'],
      fa: ['اخبار', 'بازار', 'قیمت', 'جزئیات کوین', 'نمودار', 'رتبه'],
      ar: ['أخبار', 'سوق', 'سعر', 'تفاصيل العملة', 'رسم بياني']
    },
    a: {
      en: 'Market data, coin details and news come from public aggregators and can lag the chain by a few minutes. Prices shown are reference prices for display; the price you actually trade at is the one in the on-chain swap quote. News headlines are third-party content — always check a second source before acting on them.',
      fa: 'داده بازار، جزئیات کوین و اخبار از تجمیع‌کننده‌های عمومی می‌آیند و ممکن است چند دقیقه از زنجیره عقب باشند. قیمت‌های نمایشی، قیمت مرجع‌اند؛ قیمتی که واقعاً با آن معامله می‌کنی همانی است که در کوتیشن آنچین سواپ می‌بینی. تیتر اخبار محتوای شخص ثالث است — قبل از اقدام همیشه یک منبع دوم را هم چک کن.',
      ar: 'بيانات السوق وتفاصيل العملة والأخبار تأتي من مجمّعات عامة وقد تتأخر دقائق عن السلسلة. الأسعار المعروضة مرجعية؛ سعر تداولك الحقيقي هو سعر عرض التبادل على السلسلة. العناوين محتوى طرف ثالث — تحقق من مصدر ثانٍ قبل التصرف.'
    }
  },
  {
    id: 'aboutFbt',
    k: {
      en: ['about', 'who made', 'company', 'audit', 'is it safe', 'legit', 'developers', 'api', 'ecosystem', 'discover', 'explore', 'scam?'],
      fa: ['درباره', 'شرکت', 'ممیزی', 'امن است', 'توسعه‌دهنده', 'اکوسیستم', 'کشف'],
      ar: ['حول', 'شركة', 'تدقيق', 'هل هو آمن', 'مطورون', 'نظام بيئي']
    },
    a: {
      en: 'FBT Swap is a non-custodial interface: it never holds your funds, has no deposit address, and every transaction is signed by your own wallet. The security model is described in the Audit screen and in the Docs → Security section. Developers can build against the same public API the app uses — see the Developers screen. Discover, Explore and Ecosystem surface third-party content; those are not products we operate.',
      fa: 'FBT Swap یک رابط غیرحضانتی است: هرگز دارایی‌ات را نگه نمی‌دارد، آدرس واریز ندارد و هر تراکنش را کیف پول خودت امضا می‌کند. مدل امنیتی در صفحه Audit و بخش امنیت Docs توضیح داده شده. توسعه‌دهنده‌ها می‌توانند با همان API عمومی‌ای که خود اپ استفاده می‌کند کار کنند — صفحه Developers را ببین. Discover و Explore و Ecosystem محتوای شخص ثالث نمایش می‌دهند؛ این‌ها محصولاتی نیستند که ما اداره می‌کنیم.',
      ar: 'FBT Swap واجهة غير احتجازية: لا تحتفظ بأموالك ولا عنوان إيداع لها، وكل معاملة توقّعها محفظتك. نموذج الأمان مشروح في شاشة Audit وقسم الأمان في Docs. يمكن للمطورين استخدام نفس الواجهة العامة التي يستخدمها التطبيق — راجع شاشة Developers. Discover وExplore وEcosystem تعرض محتوى طرفاً ثالثاً لا نديره.'
    }
  },
  {
    id: 'support',
    k: {
      en: ['support', 'contact', 'help', 'bug', 'report', 'complaint', 'legal', 'guide', 'learn'],
      fa: ['پشتیبانی', 'تماس', 'کمک', 'باگ', 'گزارش', 'شکایت', 'حقوقی'],
      ar: ['دعم', 'اتصال', 'مساعدة', 'خطأ', 'بلاغ', 'قانوني']
    },
    a: {
      en: 'For bugs and questions use Help → Contact and include your wallet name, the network you were on and what you expected to happen. Do not post transaction hashes or addresses in public channels. The four-part onboarding guide can be replayed from the Help screen, and the legal documents live under Legal. Support will never ask for your recovery phrase.',
      fa: 'برای باگ و سوال از Help → Contact استفاده کن و نام کیف پول، شبکه‌ای که رویش بودی و انتظاری که داشتی را بنویس. هش تراکنش یا آدرس را در کانال‌های عمومی پست نکن. راهنمای چهاربخشی ورود از صفحه Help قابل اجرای دوباره است و اسناد حقوقی زیر Legal قرار دارند. پشتیبانی هرگز عبارت بازیابی‌ات را نمی‌خواهد.',
      ar: 'للأخطاء والأسئلة استخدم Help ← Contact واذكر اسم المحفظة والشبكة وما توقعت حدوثه. لا تنشر معرّفات المعاملات أو العناوين علناً. يمكن إعادة تشغيل دليل البداية من شاشة Help، والمستندات القانونية تحت Legal. لن يطلب الدعم عبارة الاسترداد أبداً.'
    }
  },
  {
    id: 'securitySettings',
    k: {
      en: ['settings', 'security', 'hide balance', 'custom rpc', 'rpc', 'biometric', 'lock', 'backup file', 'privacy'],
      fa: ['تنظیمات', 'امنیت', 'مخفی کردن موجودی', 'RPC سفارشی', 'قفل', 'فایل پشتیبان'],
      ar: ['إعدادات', 'أمان', 'إخفاء الرصيد', 'RPC مخصص', 'قفل']
    },
    a: {
      en: 'The security settings control the local wallet and the app\'s privacy behaviour: hide balances removes amounts from the screen, the custom RPC field replaces the default public endpoints (https only), and the backup file is an encrypted copy of the vault. A private RPC you configure still sees your address activity — only use endpoints you trust, exactly as the warning on the screen says.',
      fa: 'تنظیمات امنیتی، کیف پول محلی و رفتار حریم خصوصی اپ را کنترل می‌کند: مخفی کردن موجودی، مبلغ‌ها را از صفحه حذف می‌کند، فیلد RPC سفارشی جایگزین نقاط پایانی عمومی پیش‌فرض می‌شود (فقط https) و فایل پشتیبان یک کپی رمزنگاری‌شده از خزانه است. RPC خصوصی‌ای که خودت تنظیم می‌کنی باز هم فعالیت آدرست را می‌بیند — فقط از نقاطی استفاده کن که بهشان اعتماد داری، دقیقاً همان‌طور که هشدار روی صفحه می‌گوید.',
      ar: 'تتحكم إعدادات الأمان بالمحفظة المحلية وخصوصية التطبيق: إخفاء الرصيد يزيل المبالغ من الشاشة، وحقل RPC المخصص يستبدل النقاط العامة الافتراضية (https فقط)، والنسخة الاحتياطية نسخة مشفرة من الخزنة. أي RPC خاص تختاره يرى نشاط عنوانك — استخدم فقط نقاطاً تثق بها كما يقول التحذير على الشاشة.'
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
  'iranLegal',
  'wcSecurityRisk',
  'wcNoProjectId',
  'wcReconnect',
  'tokenMissing',
  'portfolio',
  'intentOS',
  'smartWallet',
  'p2p',
  'ordersAutomation',
  'signals',
  'bridge',
  'buyCrypto',
  'farmYield',
  'rewardsPoints',
  'derivatives',
  'nft',
  'solana',
  'stocks',
  'newsMarket',
  'aboutFbt',
  'support',
  'securitySettings'
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
