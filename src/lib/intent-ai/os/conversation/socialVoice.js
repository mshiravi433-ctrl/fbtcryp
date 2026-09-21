/**
 * FBT INTENT OS — UPGRADE 13 (3/4): SOCIAL VOICE
 * ---------------------------------------------------------------------------
 * Small talk is where an assistant either sounds like a colleague or sounds
 * like a kiosk. Until now FBT had exactly two voices — Persian and English —
 * hard-wired into a ternary:
 *
 *   const isFa = locale.startsWith('fa');
 *   return isFa ? 'سلام! خوشحالم که اینجایی…' : 'Hello! Good to see you…';
 *
 * A Turkish, Arabic, Russian, Chinese, Hindi, Urdu, Spanish, Portuguese,
 * French or Indonesian user therefore did not get a translation of the
 * assistant's personality; they got the English one. Twelve UI languages,
 * two voices.
 *
 * This module closes that with a table the build can *prove* is complete:
 * every social act exists in all twelve locales, and `voiceParity()` fails
 * loudly if someone adds an act without adding its languages. The strings are
 * short on purpose — a greeting is one breath.
 *
 * Laws:
 *   - **warm, never dishonest.** The assistant does not claim a body, a mood,
 *     a day, or feelings. «حالت چطوره» is answered as availability and
 *     readiness — which is true of it — not as «خوبم، روز شلوغی داشتیم».
 *   - **no upsell on a hello.** §24 of Upgrade 5: thanks and greetings never
 *     get a disclaimer, a product pitch or a fee footnote.
 *   - **never a fabricated state.** Nothing here may name a price, a balance
 *     or a change; that belongs to `economicBrief.js`, which is the only place
 *     real numbers enter a social reply.
 *   - deterministic variation: the variant is chosen by a seed, so a repeated
 *     greeting is not byte-identical, while a test run stays reproducible.
 */

import { SOCIAL_ACTS } from './socialIntent.js';
import { SUPPORTED_LANGS } from './languageSense.js';

export const SOCIAL_VOICE_SCHEMA = 'fbt.ai-social-voice.v13';
export const SOCIAL_VOICE_VERSION = '13.0.0';

/* `rtl` drives punctuation direction only; no text differs because of it. */
export const VOICE_LOCALES = Object.freeze([...SUPPORTED_LANGS]);
export const RTL_LANGS = Object.freeze(['fa', 'ar', 'ur']);

/**
 * The voice table. Key = act, value = { lang: [variants] }.
 * Numbers, prices and portfolio figures never appear here.
 */
const VOICE = Object.freeze({
  [SOCIAL_ACTS.GREETING]: {
    fa: ['سلام! خوش اومدی 👋 هر وقت بخوای بازار، کیف پول یا هدفت رو با هم بررسی می‌کنیم.', 'درود! اینجام — یه سؤال مالی، یه تصمیم، یا فقط یه بررسی سریع.'],
    en: ['Hello — good to see you here. Ask me about the market, your wallet, or a goal and we will take it from there.', 'Hi there. I am ready when you are: markets, wallet, swaps, or a plan.'],
    ar: ['مرحبًا! سعيد بوجودك هنا 👋 اسألني عن السوق أو محفظتك أو هدفك وسنبدأ من هناك.', 'أهلًا! أنا جاهز: أسعار، محافظ، سواب أو خطة.'],
    tr: ['Merhaba, buraya bekleniyordun 👋 Piyasayı, cüzdanını ya da hedefini sor — birlikte bakalım.', 'Selam! Hazırım: fiyatlar, cüzdan, takas ya da bir plan.'],
    ru: ['Привет, рад видеть тебя здесь 👋 Спроси про рынок, кошелёк или цель — разберёмся вместе.', 'Здравствуй! Я готов: цены, кошелёк, обмен или план.'],
    zh: ['你好，很高兴你来了 👋 想聊行情、钱包还是目标，我都在。', '嗨，我准备好了——价格、钱包、兑换或一个计划。'],
    hi: ['नमस्ते! आप यहाँ हैं तो अच्छा लगा 👋 बाज़ार, वॉलेट या लक्ष्य के बारे में पूछिए।', 'नमस्कार। मैं तैयार हूँ: कीमत, वॉलेट, स्वैप या कोई योजना।'],
    ur: ['السلام علیکم! آپ کا خوش آمدید 👋 بازار، والیٹ یا ہدف کے بارے میں کچھ بھی پوچھیں۔', 'وعلیکم السلام۔ میں حاضر ہوں: قیمت، والیٹ، سواپ یا منصوبہ۔'],
    id: ['Halo, senang kamu mampir 👋 Tanya soal pasar, dompet, atau targetmu.', 'Hai. Aku siap: harga, dompet, swap, atau rencana.'],
    es: ['Hola, qué bueno verte por aquí 👋 Pregúntame por el mercado, tu billetera o tus metas.', '¡Hola! Listo cuando tú lo estés: precios, billetera, swaps o un plan.'],
    pt: ['Olá, que bom te ver por aqui 👋 Me pergunta sobre o mercado, a carteira ou as suas metas.', 'Oi! Estou pronto: preços, carteira, troca ou um plano.'],
    fr: ['Bonjour, content de vous lire 👋 Marché, portefeuille ou objectif : je suis là.', 'Salut ! Je suis prêt : prix, portefeuille, swap ou plan.'],
},
  [SOCIAL_ACTS.HOW_ARE_YOU]: {
    fa: ['ممنون که پرسیدی — من همیشه آماده‌ام 🙂 کاری داری یا خلاصه‌ای از بازار می‌خوای؟', 'مرسی، من که همیشه بیدار و آماده‌ام! اگه بخوای همین الان وضعیت بازار رو خلاصه کنم بگو.'],
    en: ['Thanks for asking — I am always ready. Want a quick read on the market, or is there something to sort out?', 'Appreciate it. No bad days when you are a program 🙂 What can I look at for you?'],
    ar: ['شكرًا لسؤالك — أنا جاهز دائمًا. تحب قراءة سريعة للسوق أم عندك مهمة؟', 'بخير، شكرًا! كل شيء يعمل. أخبرني بما أبدأ: سعر، محفظة، أم خطة؟'],
    tr: ['İyiyim, sorduğun için sağ ol — her zaman hazırım 🙂 Bir piyasa özeti mi istersin?', 'Teşekkürler, çalışıyorum. İstersen hemen bugünün pazarına bakalım.'],
    ru: ['Спасибо, всё рабочее — я всегда на связи 🙂 Расскажу сводку по рынку?', 'Хорошо, спасибо! Если нужно — сводку по рынку или кошельку сделаю сразу.'],
    zh: ['谢谢关心，我一直都在 🙂 要看一眼今天的行情，还是有别的事？', '我很好，程序不会累 🙂 需要我先看看你的钱包或市场吗？'],
    hi: ['पूछने के लिए धन्यवाद — मैं हमेशा तैयार हूँ 🙂 बाज़ार का संक्षिप्त हाल सुनें?', 'शुक्रिया, सब ठीक है! बताइए पहले क्या देखूँ — कीमत, वॉलेट या योजना?'],
    ur: ['پوچھا، شکریہ — میں ہمیشہ حاضر ہوں 🙂 بازار کا خلاصہ سنوں یا کوئی اور کام؟', 'میرا سب ٹھیک ہے، پوچھنے کا شکریہ! بتائیں کہاں سے شروع کروں۔'],
    id: ['Baik, terima kasih sudah bertanya 🙂 Mau ringkasan pasar hari ini?', 'Selalu siap. Mau kubacakan kondisi pasar dulu?'],
    es: ['Todo bien, gracias por preguntar 🙂 ¿Te doy un resumen del mercado?', 'Muy bien, gracias! Dime por dónde empezamos: precios, billetera o un plan.'],
    pt: ['Tudo certo por aqui, obrigado por perguntar 🙂 Quer um resumo do mercado?', 'Estou ótimo — programa não tem dia ruim 🙂 O que vejo primeiro?'],
    fr: ['Tout va bien, merci de demander 🙂 Je te fais un point sur le marché ?', 'Formidable, merci ! Dis-moi par quoi on commence : prix, portefeuille ou plan.']
  },
  [SOCIAL_ACTS.WHATS_UP]: {
    fa: ['سلام! قربانت — اینم خلاصهٔ امروز:', 'درود! همه‌چیز رو به راه. این چیزی‌ست که الان در بازار می‌بینم:'],
    en: ['Hey! All good here — and here is what the market is doing right now:', 'Hello! Everything runs. Here is the picture as I can see it:'],
    ar: ['أهلًا! كل شيء بخير — وهذا ما أراه في السوق الآن:', 'مرحبًا! عندي ملخص سريع لما يحدث الآن:'],
    tr: ['Selam! Her şey yolunda — işte şu an pazarda gördüklerim:', 'Merhaba! Ben iyiyim, bir de bugünün piyasa özeti var:'],
    ru: ['Привет! Всё спокойно — вот что сейчас на рынке:', 'Здравствуй! У меня всё ровно, и вот короткая сводка по рынку:'],
    zh: ['你好，我这边一切正常 —— 先看今天的行情：', '嗨，都在。这是我现在看到的市场概况：'],
    hi: ['नमस्ते, सब ठीक है — और यहाँ आज का बाज़ार है:', 'नमस्कार! मेरा सब अच्छा है, यह रहा बाज़ार का संक्षिप्त हाल:'],
    ur: ['وعلیکم السلام! سب ٹھیک ہے — اور یہ آج کے بازار کا حال ہے:', 'السلام علیکم! میں حاضر ہوں، یہ رہا بازار کا خلاصہ:'],
    id: ['Halo, baik-baik saja — ini kondisi pasar sekarang:', 'Hai! Semuanya aman. Ini ringkasan pasar hari ini:'],
    es: ['¡Hola! Todo bien por aquí — y este es el mercado ahora mismo:', '¡Hola! Yo estoy listo. Este es el panorama de hoy:'],
    pt: ['Oi, tudo certo por aqui — e é assim que o mercado está agora:', 'Olá! Sigo pronto. Veja o retrato do mercado hoje:'],
    fr: ['Salut, tout va bien — voilà le marché en ce moment :', 'Bonjour ! Prêt à servir. Voici la situation du jour :']
  },
  [SOCIAL_ACTS.THANKS]: {
    fa: ['خواهش می‌کنم ❤️ هر وقت لازم داشتی همین‌جام.', 'قابلی نداشت — کاری بود در خدمتم.'],
    en: ['Anytime. I am right here if something else comes up.', 'Happy to help — say the word if you want me to double-check anything.'],
    ar: ['العفو ❤️ أنا هنا متى احتجت.', 'على الرحب والسعة — إن احتجت شيئًا آخر، اسأل.'],
    tr: ['Rica ederim ❤️ Başka bir şey olursa buradayım.', 'Ne demek — bir şeyi tekrar kontrol etmemi istersen söyle.'],
    ru: ['Всегда пожалуйста ❤️ Если что — я рядом.', 'Обращайся — могу ещё раз что-нибудь перепроверить.'],
    zh: ['不客气 ❤️ 需要我再看什么，随时说。', '应该的。要我再核对一下也可以。'],
    hi: ['कोई बात नहीं ❤️ कुछ और चाहिए तो बता दीजिए।', 'आपका स्वागत है — कुछ दोबारा जाँचना हो तो कहिए।'],
    ur: ['کوئی بات نہیں ❤️ کچھ اور چاہیے تو بتا دیجیے۔', 'خوش آمدید — دوبارہ جانچنا ہو تو کہہ دیجیے۔'],
    id: ['Sama-sama ❤️ Kalau ada yang perlu kucek lagi, bilang saja.', 'Dengan senang hati.'],
    es: ['A la orden ❤️ Si quieres que revise otra cosa, dime.', 'Un gusto — pídeme lo que necesites.'],
    pt: ['Imagina ❤️ Se quiser que eu confira outra coisa, é só falar.', 'Por nada — pede o que precisar.'],
    fr: ['Avec plaisir ❤️ Dis-moi si tu veux que je vérifie autre chose.', 'De rien — je reste là.']
  },
  [SOCIAL_ACTS.GOODBYE]: {
    fa: ['مراقب خودت باش! هر وقت برگشتی، همه‌چیز همین‌جا مونده 🙂', 'خداحافظ! اگه بازار یه حرکت مهم کرد، اینجام.'],
    en: ['Take care — everything stays exactly where you left it 🙂', 'Bye for now. The market will still be here when you are.'],
    ar: ['اعتنِ بنفسك! كل شيء يبقى كما هو عند عودتك 🙂', 'إلى اللقاء — سأكون هنا حين تحتاج.'],
    tr: ['Kendine iyi bak! Döndüğünde her şey yerinde 🙂', 'Görüşürüz — piyasa seni bekler.'],
    ru: ['Береги себя! Всё останется на месте, когда вернёшься 🙂', 'Пока! Рынок никуда не денется.'],
    zh: ['照顾好自己，回来时一切都在原处 🙂', '再见！市场会等你。'],
    hi: ['अपना ख्याल रखें — वापस आने पर सब यहीं मिलेगा 🙂', 'अलविदा! बाज़ार आपका इंतज़ार करेगा।'],
    ur: ['اپنا خیال رکھیے — واپس آئیں تو سب یہیں ملے گا 🙂', 'خدا حافظ! بازار آپ کا انتظار کرے گا۔'],
    id: ['Hati-hati ya — semuanya tetap di sini saat kamu kembali 🙂', 'Sampai jumpa! Pasar akan menunggu.'],
    es: ['Cuídate — a tu regreso todo estará donde lo dejaste 🙂', '¡Hasta luego! El mercado te espera.'],
    pt: ['Se cuida — na tua volta está tudo onde deixaste 🙂', 'Até já! O mercado espera por ti.'],
    fr: ['Prends soin de toi — à ton retour, tout sera à la même place 🙂', 'À bientôt ! Le marché t\u2019attend.']
  },
  [SOCIAL_ACTS.IDENTITY]: {
    fa: ['من دستیار مالی FBT هستم. بازار رو می‌خونم، برنامه می‌چینم، و برای هر کاری که به پولت دست بزنه از خودت امضا می‌خوام — کلید و عبارت بازیابی هیچ‌وقت پیش من نیست.', 'من همون یارِ FBT‌ام: تحلیل، سواپ، پل و خودکارسازی. کیف پولت غیرامانی‌ست، پس تصمیم نهایی همیشه با خودته.'],
    en: ['I am FBT\u2019s financial assistant. I read markets, build plans, and ask for your signature before anything touches your money — your keys and seed phrase never live with me.', 'I am the FBT assistant: analysis, swaps, bridges, automations. The wallet is non-custodial, so the last word is always yours.'],
    ar: ['أنا مساعد FBT المالي: أقرأ السوق وأبني خطة، وأطلب توقيعك قبل أي إجراء يمس أموالك — مفاتيحك وعبارة الاستعادة ليست لدي أبدًا.', 'أنا مساعد FBT: تحليل وتحويل وجسور وأتمتة. محفظتك غير حاضنة، فالقرار لك.'],
    tr: ['Ben FBT\u2019nin finansal asistanıyım: piyasayı okur, plan kurar, paranı ilgilendiren her adımda imzanı isterim. Anahtarların ve kurtarma ifaden bende hiç durmaz.', 'FBT asistanıyım: analiz, takas, köprü ve otomasyon. Cüzdan non-custodial, son söz sende.'],
    ru: ['Я финансовый помощник FBT: читаю рынок, строю планы и прошу твою подпись перед любым действием с деньгами. Ключи и seed-фраза у меня не хранятся — никогда.', 'Я ассистент FBT: анализ, свопы, мосты, автоматизация. Кошелёк некастодиальный, последнее слово за тобой.'],
    zh: ['我是 FBT 的金融助手：读行情、做计划，任何动到你资金的操作都会先请你签名。私钥和助记词从不经过我。', '我是 FBT 助手：分析、兑换、跨链与自动化。钱包是非托管的，最终决定权在你。'],
    hi: ['मैं FBT का वित्तीय सहायक हूँ — बाज़ार पढ़ता हूँ, योजना बनाता हूँ, और पैसों से जुड़े हर कदम पर आपका हस्ताक्षर माँगता हूँ। आपकी कुंजी या सीड फ़्रेज़ मेरे पास कभी नहीं रहती।', 'मैं FBT सहायक हूँ: विश्लेषण, स्वैप, ब्रिज और ऑटोमेशन। वॉलेट non-custodial है, अंतिम निर्णय आपका।'],
    ur: ['میں FBT کا مالیاتی معاون ہوں — بازار پڑھتا ہوں، منصوبہ بناتا ہوں، اور آپ کے پیسوں سے متعلق ہر قدم پر آپ کا دستخط مانگتا ہوں۔ آپ کی کنجی یا seed phrase کبھی میرے پاس نہیں رہتی۔', 'میں FBT معاون ہوں: تجزیہ، سواپ، برج اور آٹومیشن۔ والیٹ non-custodial ہے، آخری فیصلہ آپ کا۔'],
    id: ['Aku asisten keuangan FBT: membaca pasar, menyusun rencana, dan meminta tanda tanganmu sebelum apa pun menyentuh uangmu. Kunci dan seed phrase tidak pernah ada padaku.', 'Aku asisten FBT: analisis, swap, bridge, otomatisasi. Dompetmu non-custodial, jadi keputusan akhir tetap milikmu.'],
    es: ['Soy el asistente financiero de FBT: leo el mercado, armo planes y pido tu firma antes de que algo toque tu dinero. Tus claves y tu frase semilla nunca pasan por mí.', 'Soy el asistente de FBT: análisis, swaps, puentes y automatización. La billetera es no-custodial, la última palabra es tuya.'],
    pt: ['Sou o assistente financeiro da FBT: leio o mercado, faço planos e peço a tua assinatura antes de qualquer coisa tocar no teu dinheiro. As tuas chaves e seed phrase nunca ficam comigo.', 'Sou o assistente FBT: análise, swaps, pontes e automações. A carteira é non-custodial, por isso a decisão final é tua.'],
    fr: ['Je suis l\u2019assistant financier de FBT : je lis le marché, je construis des plans et je demande ta signature avant que quoi que ce soit touche ton argent. Tes clés et ta phrase de récupération ne transitent jamais par moi.', 'Je suis l\u2019assistant FBT : analyse, swaps, ponts et automatisations. Le portefeuille est non-custodial, le dernier mot t\u2019appartient.']
  },
  [SOCIAL_ACTS.CAPABILITY]: {
    fa: ['می‌تونم قیمت و روند بازار رو بخونم، پرتفوی‌ت رو بررسی کنم، سواپ/پل/استیک رو برات آماده کنم، سفارش شرطی و DCA بچینم و هدف مالی‌ت رو به یه برنامهٔ قابل دفاع تبدیل کنم. هیچ‌کدوم بدون امضای تو اجرا نمی‌شه.', 'کارهام: تحلیل بازار و ریسک، پیشنهاد تخصیص، آماده‌سازی سواپ و بریج، مانیتور قیمت، خودکارسازی DCA. تصمیم و امضا همیشه مال توئه.'],
    en: ['I can read the market and your portfolio, prepare a swap, bridge or stake, set a price monitor or a DCA, and turn a goal into a plan you can argue with. Nothing runs without your signature.', 'What I do: analysis, risk, allocation proposals, prepared swaps and bridges, monitors, automations. The decision stays with you.'],
    ar: ['أستطيع قراءة السوق ومحفظتك، تجهيز سواب أو جسر أو ستاكنغ، ضبط تنبيه سعري أو خطة شراء دورية، وتحويل هدفك إلى خطة واضحة — ولا شيء يُنفَّذ بلا توقيعك.', 'ما أفعله: تحليل، مخاطرة، توزيع مقترح، تجهيز تحويلات ومراقبة أسعار وأتمتة. القرار يبقى لك.'],
    tr: ['Piyasayı ve cüzdanını okuyabilirim; takas, köprü veya stake hazırlar, fiyat monitörü ve DCA kurar, hedefini savunulabilir bir plana çeviririm. Hiçbiri senin imzan olmadan çalışmaz.', 'Yaptıklarım: analiz, risk, tahsis önerisi, takas/köprü hazırlığı, izleme, otomasyon. Son karar sende.'],
    ru: ['Читаю рынок и кошелёк, готовлю своп, мост или стейкинг, ставлю монитор цены и DCA, превращаю цель в план, с которым можно спорить. Ничего не исполняется без твоей подписи.', 'Что умею: анализ, риск, предложения по аллокации, подготовка свопов и мостов, мониторы, автоматизация. Решение остаётся за тобой.'],
    zh: ['我能读行情和你的钱包，准备兑换、跨链或质押，设置价格监控和定投，也能把你的目标变成可执行的计划。任何操作都需要你签名。', '我会做：分析、风险、配置建议、准备 swap/bridge、监控、自动化。最终决定权在你。'],
    hi: ['मैं बाज़ार और आपकी पॉर्टफोलियो पढ़ सकता हूँ, swap/bridge/stake तैयार कर सकता हूँ, मूल्य मॉनिटर और DCA सेट कर सकता हूँ, और आपके लक्ष्य को सुसंगत योजना बना सकता हूँ। आपके हस्ताक्षर के बिना कुछ नहीं चलेगा।', 'मेरे काम: विश्लेषण, जोखिम, आवंटन सुझाव, तैयार स्वैप/ब्रिज, मॉनिटर, ऑटोमेशन। अंतिम निर्णय आपका।'],
    ur: ['میں بازار اور آپ کا پورٹ فولیو پڑھ سکتا ہوں، سواپ/بریج/اسٹیک تیار کر سکتا ہوں، قیمت کا مانٹر اور DCA لگا سکتا ہوں، اور آپ کے ہدف کو قابلِ دفاع منصوبہ بنا سکتا ہوں۔ آپ کے دستخط کے بغیر کچھ نہیں چلے گا۔', 'میرے کام: تجزیہ، رسک، مختص کی تجویز، تیاری، مانٹر، آٹومیشن۔ فیصلہ آپ کا۔'],
    id: ['Aku bisa membaca pasar dan portofoliomu, menyiapkan swap, bridge atau staking, memasang monitor harga dan DCA, dan mengubah targetmu jadi rencana yang bisa diperdebatkan. Tidak ada yang jalan tanpa tanda tanganmu.', 'Yang kubisa: analisis, risiko, usulan alokasi, persiapan swap/bridge, monitor, otomatisasi. Keputusan tetap di tanganmu.'],
    es: ['Leo el mercado y tu portafolio, preparo un swap, puente o stake, monto un monitor de precio o un DCA, y convierto tu meta en un plan discutible. Nada se ejecuta sin tu firma.', 'Qué hago: análisis, riesgo, propuestas de asignación, preparación de swaps y puentes, monitores, automatizaciones. La decisión es tuya.'],
    pt: ['Leio o mercado e a tua carteira, preparei um swap, ponte ou staking, monto um monitor de preço ou um DCA, e transformo a tua meta num plano defensável. Nada corre sem a tua assinatura.', 'O que faço: análise, risco, propostas de alocação, preparação de swaps e pontes, monitores, automações. A decisão é tua.'],
    fr: ['Je lis le marché et ton portefeuille, je prépare un swap, un pont ou du staking, je pose une alerte de prix ou un DCA, et je transforme ton objectif en plan défendable. Rien ne s\u2019exécute sans ta signature.', 'Ce que je fais : analyse, risque, propositions d\u2019allocation, préparation de swaps et de ponts, moniteurs, automatisations. La décision reste la tienne.']
  },
  [SOCIAL_ACTS.WELLBEING]: {
    fa: ['متأسفم که روزت خوب نبوده. لازم نیست الان تصمیم بگیری — اگه بخوای فقط آروم آمار رو با هم نگاه می‌کنیم.', 'نفس بکش. پول فردا هم هست؛ اگه بخوای کاری انجام بدم می‌گم، وگرنه همین‌جا پیشت هستم.'],
    en: ['Sorry the day is heavy. Nothing has to be decided right now — we can just look at the numbers slowly.', 'Breathe. Money keeps existing tomorrow; if you want one thing done, say it, otherwise I stay right here.'],
    ar: ['يؤسفني أن يومك متعب. لا قرار مطلوب الآن — يمكننا فقط أن ننظر للأرقام بهدوء.', 'خذ نفسك. المال سيكون غدًا أيضًا؛ أخبرني إن أردت شيئًا واحدًا الآن.'],
    tr: ['Günün zor geçiyorsa üzüldüm. Şimdi hiçbir şeye karar vermek yok — sadece sayılara sakinçe bakalım.', 'Nefes al. Para yarın da olacak; tek bir şey yapmamı istersen söyle.'],
    ru: ['Жаль, что день тяжёлый. Сейчас ничего решать не нужно — можем просто спокойно посмотреть цифры.', 'Дыши. Деньги никуда не денутся до завтра; скажи, если сделать одно дело.'],
    zh: ['听起来今天不太好受。现在不用做任何决定，我们可以慢慢看一眼数据。', '深呼吸。钱明天还在；你想让我先做一件事就说。'],
    hi: ['अगर दिन भारी है तो खेद है। अभी कुछ भी तय करने की ज़रूरत नहीं — बस धीरे-धीरे आँकड़े देख लेते हैं।', 'सांस लीजिए। पैसा कल भी रहेगा; एक काम कराना हो तो बताइए।'],
    ur: ['افسوس ہے کہ دن بھاری ہے۔ ابھی کچھ طے کرنے کی ضرورت نہیں — آہستہ سے اعداد دیکھ لیتے ہیں۔', 'سانس لیجیے۔ پیسہ کل بھی رہے گا؛ ایک کام کرانا ہو تو بتائیے۔'],
    id: ['Maaf harimu berat. Nggak harus mutusin apa pun sekarang — kita lihat angkanya pelan-pelan.', 'Tarik napas. Uang masih ada besok; kalau mau kuerjakan satu hal, bilang.'],
    es: ['Siento que el día esté pesado. No hay que decidir nada ahora — podemos mirar los números con calma.', 'Respira. El dinero seguirá mañana; si quieres que haga una sola cosa, dime.'],
    pt: ['Desculpa se o dia está pesado. Não tens de decidir nada agora — podemos ver os números com calma.', 'Respira. O dinheiro cá estará amanhã; se quiseres que faça uma coisa, diz.'],
    fr: ['Désolé si la journée est lourde. Rien à décider maintenant — on peut juste regarder les chiffres tranquillement.', 'Respire. L\u2019argent sera encore là demain ; si tu veux que je fasse une seule chose, dis-le.']
  },
  [SOCIAL_ACTS.SMALL_TALK]: {
    fa: ['من برای جوک خوب نیستم ولی برای آمار بد نیستم 🙂 یه عدد بگو یا یه سؤال بپرس.', 'می‌تونم باهات حرف بزنم — ولی ترجیح می‌دم یه سؤال بازار ازت بپرسم، اونجا واقعاً به‌دردت می‌خوره.'],
    en: ['I am a better analyst than a comedian 🙂 Give me a number or a question.', 'We can chat — though I am most useful when you ask me about a market or a wallet.'],
    ar: ['أنا محلل أفضل مني كوميديان 🙂 أعطني رقمًا أو سؤالًا.', 'يمكننا الحديث — لكني أكون أنفع حين تسألني عن سوق أو محفظة.'],
    tr: ['Komedyenden iyi analistim 🙂 Bana bir rakam ya da soru ver.', 'Sohbet de ederiz — ama bir piyasa ya da cüzdan sorarsan daha işe yararım.'],
    ru: ['Я лучше аналитик, чем комик 🙂 Дай мне число или вопрос.', 'Поболтать можно, но полезнее буду, если спросишь про рынок или кошелёк.'],
    zh: ['我当分析师比当段子手强 🙂 给我一个数字或问题吧。', '可以聊，但聊行情或钱包时我更有用。'],
    hi: ['मैं कॉमेडियन से बेहतर एनालिस्ट हूँ 🙂 कोई संख्या या सवाल दीजिए।', 'बातचीत हो जाएगी, पर बाज़ार या वॉलेट पर पूछेंगे तो ज़्यादा काम आऊँगा।'],
    ur: ['میں کامیڈین سے بہتر اینالسٹ ہوں 🙂 کوئی عدد یا سوال دیجیے۔', 'بات ہو سکتی ہے، مگر بازار یا والیٹ کے بارے میں زیادہ کارآمد ہوں گا۔'],
    id: ['Aku lebih jago analisis daripada melucu 🙂 Kasih aku angka atau pertanyaan.', 'Boleh ngobrol — tapi aku lebih berguna kalau kamu tanya pasar atau dompet.'],
    es: ['Soy mejor analista que cómico 🙂 Dame un número o una pregunta.', 'Podemos charlar, pero rindo más si me preguntas por un mercado o una billetera.'],
    pt: ['Sou melhor analista do que comediante 🙂 Dá-me um número ou uma pergunta.', 'Podemos conversar, mas sou mais útil com uma pergunta sobre o mercado ou a carteira.'],
    fr: ['Je suis meilleur analyste que comique 🙂 Donne-moi un chiffre ou une question.', 'On peut discuter — mais je sers plus sur un marché ou un portefeuille.']
  }
});

/* -------------------------------------------------------------------------- */
/*  RENDERING                                                                  */
/* -------------------------------------------------------------------------- */

function hashCode(value) {
  let h = 2166136261;
  for (const ch of String(value)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Every locale the table actually holds for one act (used by tests). */
export function localesFor(act) {
  const row = VOICE[act];
  if (!row) return [];
  return VOICE_LOCALES.filter((lang) => Array.isArray(row[lang]) && row[lang].length > 0);
}

/**
 * Which locale to write in: what we have for the requested language, else the
 * caller's declared fallback, else English. `fellBack` is part of the result so
 * a UI can be honest instead of pretending the answer was localised.
 */
export function renderSocialReply({ act = SOCIAL_ACTS.SMALL_TALK, lang = 'en', seed = null, extra = '' } = {}) {
  const row = VOICE[act];
  const wanted = String(lang || 'en').toLowerCase().split('-')[0];
  const variants = (row && Array.isArray(row[wanted]) && row[wanted].length) ? row[wanted] : (row?.en || []);
  const usedLang = (row && Array.isArray(row[wanted]) && row[wanted].length) ? wanted : (row?.en?.length ? 'en' : null);
  if (!variants.length) {
    return { ok: false, text: '', lang: wanted, schema: SOCIAL_VOICE_SCHEMA, reason: 'NO_VOICE_FOR_ACT' };
  }
  const key = seed === null || seed === '' ? String(act) : String(seed);
  const idx = hashCode(key) % variants.length;
  const body = variants[idx];
  return {
    ok: true,
    schema: SOCIAL_VOICE_SCHEMA,
    act,
    lang: usedLang,
    requestedLang: wanted,
    /* An untranslated act is an English answer, never a half-translated mix. */
    fellBack: usedLang !== wanted,
    rtl: RTL_LANGS.includes(usedLang),
    variant: idx,
    text: extra ? `${body}\n${String(extra).trim()}` : body,
    /* A social reply carries no instruction and no authority — belt and braces,
       since this text is what the user sees before a money turn. */
    mentionsNumbers: /\$\s?\d|\d[\d.,]*\s?%|\b\d+\s?(?:USDT?|USD|BTC|ETH)\b/i.test(body),
    executionAuthorized: false,
    requiresSignatureForAnything: false
  };
}

/**
 * Proof helper for tests and for the ops panel: the table either covers all
 * twelve locales for every act, or the gap is named. A silent English fallback
 * for an entire language is the failure mode this exists to catch.
 */
export function voiceParity() {
  const rows = [];
  for (const act of Object.keys(VOICE)) {
    const have = localesFor(act);
    const missing = VOICE_LOCALES.filter((l) => !have.includes(l));
    rows.push({ act, covered: have.length, total: VOICE_LOCALES.length, missing });
  }
  const gaps = rows.filter((r) => r.missing.length);
  return {
    ok: gaps.length === 0,
    schema: SOCIAL_VOICE_SCHEMA,
    locales: VOICE_LOCALES,
    acts: rows.length,
    rows,
    gaps
  };
}

export default renderSocialReply;
