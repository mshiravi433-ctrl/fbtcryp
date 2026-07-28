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
const KB = [
  {
    id: 'fees',
    k: {
      en: ['fee', 'fees', 'commission', 'cost', 'charge', 'how much', '0.5', 'percent'],
      fa: ['کارمزد', 'هزینه', 'درصد', 'کمیسیون', 'چقدر', 'نیم درصد', '۰.۵'],
      ar: ['رسوم', 'عمولة', 'تكلفة', 'كم']
    },
    a: {
      en: 'Every swap carries two separate costs. (1) The platform fee: 0.5% of the amount you send in, taken on-chain in the same transaction and shown to you before you sign. (2) The network fee (gas), paid in the chain\'s own coin — BNB on BNB Chain, ETH on Ethereum/Arbitrum/Base/Optimism, POL on Polygon, AVAX on Avalanche, TRX on Tron, SOL on Solana. Gas goes to the blockchain validators, not to us, and we cannot reduce or refund it.',
      fa: 'هر سواپ دو هزینه جدا دارد. ۱) کارمزد پلتفرم: ۰.۵٪ از مبلغ ورودی که روی زنجیره و در همان تراکنش برداشته می‌شود و قبل از امضا به تو نشان داده می‌شود. ۲) کارمزد شبکه (گس) که با کوین بومی همان شبکه پرداخت می‌شود — BNB روی BNB Chain، ETH روی اتریوم/آربیتروم/بیس/اپتیمیسم، POL روی پالیگان، AVAX روی آوالانچ، TRX روی ترون و SOL روی سولانا. گس به اعتبارسنج‌های بلاکچین می‌رسد نه به ما، و نه می‌توانیم کمش کنیم نه برگردانیم.',
      ar: 'كل عملية تبادل لها تكلفتان: رسوم المنصة ٠٫٥٪ من المبلغ المُدخل تُخصم على السلسلة في نفس المعاملة، ورسوم الشبكة (الغاز) تُدفع بعملة الشبكة نفسها وتذهب للمُدققين وليس لنا.'
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
      en: 'Swaps run on seven EVM networks: BNB Chain, Ethereum, Polygon, Arbitrum, Base, Optimism and Avalanche. Solana and Tron are supported as receiving networks for payouts and balances. Cross-chain swaps (say BNB straight to Solana) need a bridge, which adds custody and failure risks we do not want to hide inside a one-tap button — switch networks instead, so you can see exactly what is happening.',
      fa: 'سواپ روی هفت شبکه EVM انجام می‌شود: BNB Chain، اتریوم، پالیگان، آربیتروم، بیس، اپتیمیسم و آوالانچ. سولانا و ترون به‌عنوان شبکه‌های دریافت و نمایش موجودی پشتیبانی می‌شوند. سواپ بین‌زنجیره‌ای (مثلاً BNB مستقیم به سولانا) نیازمند پل (bridge) است که ریسک حضانت و شکست خودش را دارد و ما ترجیح می‌دهیم آن را پشت یک دکمه پنهان نکنیم — به‌جایش شبکه را عوض کن تا دقیقاً ببینی چه اتفاقی می‌افتد.',
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
  const answer = best.a[lang] ?? best.a.en;
  return { id: best.id, answer, confidence: Math.min(1, bestScore / 6) };
}

/** Suggested questions for the empty state, in the KB's own words. */
export const FAQ_TOPICS = KB.map((e) => e.id);
