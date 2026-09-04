/**
 * About page (`/about`).
 *
 * Every string the screen renders, in the nine partial locales. Until now the
 * page fell back to English for all of them — «درباره ما» opened in Chinese or
 * Spanish and read as an English brochure with a translated nav bar, which is
 * the opposite of what a "who are these people" page is for. Persian and
 * Arabic are hand-maintained in their own files.
 *
 * Only the keys the redesigned page actually reads are here. The legacy
 * `about.*` blocks (story, vision, roadmap, tech stack…) are dead copy the
 * screen no longer renders, and translating dead copy is how a locale file
 * grows without the app getting any better.
 *
 * Format: `'dotted.key': { zh, hi, es, fr, ru, tr, ur, id, pt }`
 */
export default {
  /* ------------------------------ brand ------------------------------- */
  'about.title': { zh: '关于我们', hi: 'हमारे बारे में', es: 'Sobre nosotros', fr: 'À propos', ru: 'О нас', tr: 'Hakkımızda', ur: 'ہمارے بارے میں', id: 'Tentang kami', pt: 'Sobre nós' },
  'about.tagline': { zh: '面向新经济的交易与技术', hi: 'नई अर्थव्यवस्था के लिए ट्रेड और तकनीक', es: 'Comercio y tecnología para una nueva economía', fr: 'Commerce et technologie pour une nouvelle économie', ru: 'Торговля и технологии для новой экономики', tr: 'Yeni ekonomi için ticaret ve teknoloji', ur: 'نئی معیشت کے لیے تجارت اور ٹیکنالوجی', id: 'Perdagangan & teknologi untuk ekonomi baru', pt: 'Comércio e tecnologia para uma nova economia' },
  'about.headline': { zh: '链上交易，私钥自持。', hi: 'ऑन-चेन ट्रेड करें। अपनी कुंजियाँ अपने पास रखें।', es: 'Opera en cadena. Conserva tus claves.', fr: 'Tradez on-chain. Gardez vos clés.', ru: 'Торгуйте в сети. Ключи остаются у вас.', tr: 'Zincir üstünde işlem yap. Anahtarların sende kalsın.', ur: 'آن چین ٹریڈ کریں۔ اپنی کیز اپنے پاس رکھیں۔', id: 'Bertransaksi on-chain. Kunci tetap milikmu.', pt: 'Negocie on-chain. Fique com as suas chaves.' },
  'about.who': { zh: '我们是谁', hi: 'हम कौन हैं', es: 'Quiénes somos', fr: 'Qui nous sommes', ru: 'Кто мы', tr: 'Biz kimiz', ur: 'ہم کون ہیں', id: 'Siapa kami', pt: 'Quem somos' },
  'about.summary': {
    zh: 'Fanous Bazaar Pishgam 是一家位于伊斯法罕霍梅尼沙赫尔的贸易公司。我们打造的是非托管交易所：您连接自己的钱包，交易直接在链上结算，资产从不存放在我们控制的账户中。',
    hi: 'Fanous Bazaar Pishgam इस्फ़हान के ख़ुमैनी शहर में स्थित एक ट्रेडिंग कंपनी है। हम एक नॉन-कस्टोडियल एक्सचेंज बनाते हैं: आप अपना वॉलेट जोड़ते हैं, ट्रेड सीधे ऑन-चेन सेटल होते हैं, और आपकी संपत्ति कभी हमारे नियंत्रण वाले खाते में नहीं रहती।',
    es: 'Fanous Bazaar Pishgam es una empresa comercial con sede en Khomeyni Shahr, Isfahán. Construimos un exchange sin custodia: conectas tu propia cartera, las operaciones se liquidan directamente en cadena y tus activos nunca quedan en una cuenta que controlemos nosotros.',
    fr: 'Fanous Bazaar Pishgam est une société de négoce basée à Khomeyni Shahr, Ispahan. Nous construisons un exchange non-custodial : vous connectez votre propre portefeuille, les échanges se règlent directement on-chain et vos actifs ne transitent jamais par un compte que nous contrôlons.',
    ru: 'Fanous Bazaar Pishgam — торговая компания из Хомейни-Шехра, Исфахан. Мы создаём некастодиальную биржу: вы подключаете собственный кошелёк, сделки рассчитываются прямо в блокчейне, а ваши активы никогда не лежат на счёте, который контролируем мы.',
    tr: 'Fanous Bazaar Pishgam, İsfahan\u2019ın Humeyni Şehir ilçesinde kurulu bir ticaret şirketidir. Saklama yapmayan bir borsa geliştiriyoruz: kendi cüzdanını bağlarsın, işlemler doğrudan zincir üstünde sonuçlanır ve varlıkların asla bizim kontrolümüzdeki bir hesapta durmaz.',
    ur: 'Fanous Bazaar Pishgam اصفہان کے خمینی شہر میں قائم ایک تجارتی کمپنی ہے۔ ہم ایک نان کسٹوڈیل ایکسچینج بناتے ہیں: آپ اپنا والٹ جوڑتے ہیں، ٹریڈ براہِ راست آن چین سیٹل ہوتی ہے، اور آپ کے اثاثے کبھی ہمارے کنٹرول والے اکاؤنٹ میں نہیں رہتے۔',
    id: 'Fanous Bazaar Pishgam adalah perusahaan dagang yang berbasis di Khomeyni Shahr, Isfahan. Kami membangun bursa non-kustodial: kamu menghubungkan dompetmu sendiri, transaksi diselesaikan langsung on-chain, dan asetmu tidak pernah berada di akun yang kami kendalikan.',
    pt: 'A Fanous Bazaar Pishgam é uma empresa comercial sediada em Khomeyni Shahr, Isfahan. Construímos uma exchange sem custódia: você conecta a sua própria carteira, as operações são liquidadas diretamente on-chain e os seus ativos nunca ficam numa conta controlada por nós.'
  },

  /* ------------------------------ facts ------------------------------- */
  'about.trust.nonCustodial': { zh: '非托管', hi: 'नॉन-कस्टोडियल', es: 'Sin custodia', fr: 'Non-custodial', ru: 'Некастодиальный', tr: 'Saklamasız', ur: 'نان کسٹوڈیل', id: 'Non-kustodial', pt: 'Sem custódia' },
  'about.trust.multiChain': { zh: '多链', hi: 'मल्टी-चेन', es: 'Multicadena', fr: 'Multi-chaînes', ru: 'Мультичейн', tr: 'Çok zincirli', ur: 'ملٹی چین', id: 'Multi-chain', pt: 'Multichain' },
  'about.value.access.title': { zh: '开放访问', hi: 'खुली पहुँच', es: 'Acceso abierto', fr: 'Accès ouvert', ru: 'Открытый доступ', tr: 'Açık erişim', ur: 'کھلی رسائی', id: 'Akses terbuka', pt: 'Acesso aberto' },

  /* ------------------------------ figures ----------------------------- */
  'about.stats.chains': { zh: '网络', hi: 'नेटवर्क', es: 'Redes', fr: 'Réseaux', ru: 'Сетей', tr: 'Ağ', ur: 'نیٹ ورکس', id: 'Jaringan', pt: 'Redes' },
  'about.stats.languages': { zh: '语言', hi: 'भाषाएँ', es: 'Idiomas', fr: 'Langues', ru: 'Языков', tr: 'Dil', ur: 'زبانیں', id: 'Bahasa', pt: 'Idiomas' },
  'about.stats.custody': { zh: '我们持有的资金', hi: 'हमारे पास रखी राशि', es: 'Fondos en nuestro poder', fr: 'Fonds que nous détenons', ru: 'Средств у нас на хранении', tr: 'Bizde tutulan fon', ur: 'ہمارے پاس رکھی رقم', id: 'Dana yang kami simpan', pt: 'Fundos sob nossa guarda' },

  /* ---------------------------- how it works --------------------------- */
  'about.how.title': { zh: '如何运作', hi: 'यह कैसे काम करता है', es: 'Cómo funciona', fr: 'Comment ça marche', ru: 'Как это работает', tr: 'Nasıl çalışır', ur: 'یہ کیسے کام کرتا ہے', id: 'Cara kerjanya', pt: 'Como funciona' },
  'about.how.step1Title': { zh: '带上钱包', hi: 'अपना वॉलेट लाएँ', es: 'Trae una cartera', fr: 'Apportez un portefeuille', ru: 'Подключите кошелёк', tr: 'Bir cüzdan getir', ur: 'اپنا والٹ لائیں', id: 'Bawa dompetmu', pt: 'Traga uma carteira' },
  'about.how.step1Body': {
    zh: '使用您已有的钱包，或在应用内创建一个。无需账户、邮箱或身份验证。',
    hi: 'अपना मौजूदा वॉलेट इस्तेमाल करें या ऐप के अंदर नया बनाएँ। कोई खाता, ईमेल या पहचान सत्यापन नहीं।',
    es: 'Usa una cartera que ya tengas o crea una dentro de la app. Sin cuenta, sin correo, sin verificación de identidad.',
    fr: 'Utilisez un portefeuille que vous possédez déjà ou créez-en un dans l\u2019application. Pas de compte, pas d\u2019e-mail, pas de vérification d\u2019identité.',
    ru: 'Используйте свой кошелёк или создайте новый прямо в приложении. Без аккаунта, без e-mail, без проверки личности.',
    tr: 'Zaten sahip olduğun bir cüzdanı kullan ya da uygulama içinde bir tane oluştur. Hesap yok, e-posta yok, kimlik doğrulama yok.',
    ur: 'اپنا موجودہ والٹ استعمال کریں یا ایپ کے اندر نیا بنائیں۔ نہ اکاؤنٹ، نہ ای میل، نہ شناختی تصدیق۔',
    id: 'Gunakan dompet yang sudah kamu miliki atau buat di dalam aplikasi. Tanpa akun, tanpa email, tanpa verifikasi identitas.',
    pt: 'Use uma carteira que já tem ou crie uma dentro da app. Sem conta, sem e-mail, sem verificação de identidade.'
  },
  'about.how.step2Title': { zh: '说出您的目标', hi: 'बताइए आप क्या चाहते हैं', es: 'Di qué quieres', fr: 'Dites ce que vous voulez', ru: 'Скажите, чего хотите', tr: 'Ne istediğini söyle', ur: 'بتائیں آپ کیا چاہتے ہیں', id: 'Katakan apa yang kamu mau', pt: 'Diga o que quer' },
  'about.how.step2Body': {
    zh: '直接兑换，或者用自然语言描述您的目标，让 Intent OS 在任何操作发生前列出路径、费用和风险。',
    hi: 'सीधे स्वैप करें, या अपना लक्ष्य सादी भाषा में बताएँ और Intent OS कुछ भी होने से पहले रास्ता, शुल्क और जोखिम सामने रख देगा।',
    es: 'Intercambia directamente, o describe tu objetivo en lenguaje natural y deja que Intent OS muestre la ruta, la comisión y el riesgo antes de que ocurra nada.',
    fr: 'Échangez directement, ou décrivez votre objectif en langage courant et laissez Intent OS présenter l\u2019itinéraire, les frais et le risque avant toute action.',
    ru: 'Обменивайте напрямую или опишите цель простыми словами — Intent OS покажет маршрут, комиссию и риск до того, как что-либо произойдёт.',
    tr: 'Doğrudan takas yap ya da hedefini düz bir dille anlat; Intent OS herhangi bir şey olmadan önce rotayı, ücreti ve riski önüne koysun.',
    ur: 'براہِ راست سویپ کریں، یا اپنا مقصد سادہ زبان میں لکھیں اور Intent OS کچھ بھی ہونے سے پہلے راستہ، فیس اور رسک سامنے رکھ دے گا۔',
    id: 'Tukar langsung, atau jelaskan tujuanmu dengan bahasa sehari-hari dan biarkan Intent OS memaparkan rute, biaya, dan risikonya sebelum apa pun terjadi.',
    pt: 'Troque diretamente, ou descreva o seu objetivo em linguagem simples e deixe o Intent OS apresentar a rota, a taxa e o risco antes de qualquer coisa acontecer.'
  },
  'about.how.step3Title': { zh: '签名并在链上结算', hi: 'साइन करें और ऑन-चेन सेटल करें', es: 'Firma y liquida en cadena', fr: 'Signez et réglez on-chain', ru: 'Подпишите — расчёт в блокчейне', tr: 'İmzala, zincir üstünde sonuçlansın', ur: 'سائن کریں اور آن چین سیٹل کریں', id: 'Tanda tangani dan selesaikan on-chain', pt: 'Assine e liquide on-chain' },
  'about.how.step3Body': {
    zh: '每笔交易都由您签名并在区块链上结算。未经您批准不会有任何转移，资产也从不存放在我们控制的账户中。',
    hi: 'हर लेनदेन पर आप साइन करते हैं और वह ब्लॉकचेन पर सेटल होता है। आपकी मंज़ूरी के बिना कुछ नहीं हिलता, और कुछ भी कभी हमारे नियंत्रण वाले खाते में नहीं रहता।',
    es: 'Tú firmas cada transacción y se liquida en la blockchain. Nada se mueve sin tu aprobación y nada queda jamás en una cuenta que controlemos nosotros.',
    fr: 'Vous signez chaque transaction et elle se règle sur la blockchain. Rien ne bouge sans votre accord, et rien ne reste jamais sur un compte que nous contrôlons.',
    ru: 'Каждую транзакцию подписываете вы, и она рассчитывается в блокчейне. Без вашего одобрения ничего не сдвинется, и ничто никогда не лежит на счёте под нашим контролем.',
    tr: 'Her işlemi sen imzalarsın ve işlem blokzincirde sonuçlanır. Onayın olmadan hiçbir şey hareket etmez ve hiçbir şey asla bizim kontrolümüzdeki bir hesapta durmaz.',
    ur: 'ہر ٹرانزیکشن آپ سائن کرتے ہیں اور وہ بلاک چین پر سیٹل ہوتی ہے۔ آپ کی منظوری کے بغیر کچھ نہیں ہلتا، اور کچھ بھی کبھی ہمارے کنٹرول والے اکاؤنٹ میں نہیں رہتا۔',
    id: 'Kamu menandatangani setiap transaksi dan transaksi itu diselesaikan di blockchain. Tidak ada yang bergerak tanpa persetujuanmu, dan tidak ada yang pernah berada di akun yang kami kendalikan.',
    pt: 'Você assina cada transação e ela é liquidada na blockchain. Nada se move sem a sua aprovação e nada fica jamais numa conta controlada por nós.'
  },

  /* ---------------------------- capabilities --------------------------- */
  'about.featuresTitle': { zh: '您可以在这里做什么', hi: 'यहाँ आप क्या कर सकते हैं', es: 'Qué puedes hacer aquí', fr: 'Ce que vous pouvez faire ici', ru: 'Что здесь можно делать', tr: 'Burada neler yapabilirsin', ur: 'یہاں آپ کیا کر سکتے ہیں', id: 'Apa yang bisa kamu lakukan di sini', pt: 'O que pode fazer aqui' },
  'about.ecosystem.swapTitle': { zh: '兑换', hi: 'स्वैप', es: 'Intercambiar', fr: 'Échanger', ru: 'Обмен', tr: 'Takas', ur: 'سویپ', id: 'Tukar', pt: 'Trocar' },
  'about.ecosystem.swapDesc': { zh: '在支持的网络间交易数字资产。', hi: 'समर्थित नेटवर्क पर डिजिटल संपत्ति का ट्रेड करें।', es: 'Opera con activos digitales en las redes compatibles.', fr: 'Échangez des actifs numériques sur les réseaux pris en charge.', ru: 'Торгуйте цифровыми активами в поддерживаемых сетях.', tr: 'Desteklenen ağlarda dijital varlık alıp sat.', ur: 'معاون نیٹ ورکس پر ڈیجیٹل اثاثوں کی ٹریڈ کریں۔', id: 'Perdagangkan aset digital di jaringan yang didukung.', pt: 'Negocie ativos digitais nas redes suportadas.' },
  'about.ecosystem.walletTitle': { zh: '钱包', hi: 'वॉलेट', es: 'Cartera', fr: 'Portefeuille', ru: 'Кошелёк', tr: 'Cüzdan', ur: 'والٹ', id: 'Dompet', pt: 'Carteira' },
  'about.ecosystem.walletDesc': { zh: '在完全自主掌控下管理和使用数字资产。', hi: 'नियंत्रण अपने पास रखते हुए डिजिटल संपत्ति प्रबंधित करें।', es: 'Gestiona tus activos digitales sin perder el control.', fr: 'Gérez vos actifs numériques en gardant le contrôle.', ru: 'Управляйте активами, сохраняя полный контроль.', tr: 'Kontrol sende kalarak dijital varlıklarını yönet.', ur: 'کنٹرول اپنے پاس رکھتے ہوئے ڈیجیٹل اثاثے سنبھالیں۔', id: 'Kelola aset digital dengan kendali tetap di tanganmu.', pt: 'Gira os seus ativos digitais mantendo o controlo.' },
  'about.ecosystem.intentTitle': { zh: 'Intent OS', hi: 'Intent OS', es: 'Intent OS', fr: 'Intent OS', ru: 'Intent OS', tr: 'Intent OS', ur: 'Intent OS', id: 'Intent OS', pt: 'Intent OS' },
  'about.ecosystem.intentDesc': { zh: '用自然语言表达您的财务目标。', hi: 'अपने वित्तीय लक्ष्य सादी भाषा में बताएँ।', es: 'Expresa tus objetivos financieros en lenguaje natural.', fr: 'Exprimez vos objectifs financiers en langage courant.', ru: 'Формулируйте финансовые цели обычными словами.', tr: 'Finansal hedeflerini doğal dille ifade et.', ur: 'اپنے مالی مقاصد سادہ زبان میں بیان کریں۔', id: 'Ungkapkan tujuan finansialmu dengan bahasa sehari-hari.', pt: 'Expresse os seus objetivos financeiros em linguagem natural.' },
  'about.ecosystem.signalsTitle': { zh: 'AI 信号', hi: 'AI सिग्नल', es: 'Señales IA', fr: 'Signaux IA', ru: 'ИИ-сигналы', tr: 'Yapay zekâ sinyalleri', ur: 'AI سگنلز', id: 'Sinyal AI', pt: 'Sinais de IA' },
  'about.ecosystem.signalsDesc': { zh: 'AI 辅助的市场与机会洞察。', hi: 'AI-सहायित बाज़ार और अवसर की जानकारी।', es: 'Inteligencia de mercado y oportunidades asistida por IA.', fr: 'Analyse des marchés et des opportunités assistée par IA.', ru: 'Аналитика рынка и возможностей с помощью ИИ.', tr: 'Yapay zekâ destekli piyasa ve fırsat analizi.', ur: 'AI کی مدد سے مارکیٹ اور مواقع کی معلومات۔', id: 'Intelijen pasar dan peluang berbantuan AI.', pt: 'Inteligência de mercado e oportunidades assistida por IA.' },
  'about.ecosystem.smartMoneyTitle': { zh: '聪明钱', hi: 'स्मार्ट मनी', es: 'Smart Money', fr: 'Smart Money', ru: 'Smart Money', tr: 'Akıllı para', ur: 'اسمارٹ منی', id: 'Smart Money', pt: 'Smart Money' },
  'about.ecosystem.smartMoneyDesc': { zh: '在有数据的地方分析钱包与市场活动。', hi: 'जहाँ डेटा उपलब्ध हो, वॉलेट और बाज़ार गतिविधि का विश्लेषण।', es: 'Analiza la actividad de carteras y mercado donde hay datos.', fr: 'Analysez l\u2019activité des portefeuilles et du marché là où les données existent.', ru: 'Анализ активности кошельков и рынка там, где есть данные.', tr: 'Veri olan yerde cüzdan ve piyasa hareketlerini incele.', ur: 'جہاں ڈیٹا دستیاب ہو، والٹ اور مارکیٹ کی سرگرمی کا تجزیہ۔', id: 'Analisis aktivitas dompet dan pasar di mana datanya tersedia.', pt: 'Analise a atividade de carteiras e do mercado onde há dados.' },
  'about.ecosystem.farmsTitle': { zh: '农场与收益', hi: 'फ़ार्म और यील्ड', es: 'Farms y rendimiento', fr: 'Farms et rendement', ru: 'Фарминг и доход', tr: 'Çiftlikler ve getiri', ur: 'فارمز اور ییلڈ', id: 'Farm & imbal hasil', pt: 'Farms e rendimento' },
  'about.ecosystem.farmsDesc': { zh: '探索支持的收益与流动性机会。', hi: 'समर्थित यील्ड और लिक्विडिटी अवसर देखें।', es: 'Explora oportunidades de rendimiento y liquidez compatibles.', fr: 'Explorez les opportunités de rendement et de liquidité prises en charge.', ru: 'Изучайте поддерживаемые возможности дохода и ликвидности.', tr: 'Desteklenen getiri ve likidite fırsatlarını keşfet.', ur: 'معاون ییلڈ اور لیکویڈیٹی مواقع دریافت کریں۔', id: 'Jelajahi peluang imbal hasil dan likuiditas yang didukung.', pt: 'Explore oportunidades de rendimento e liquidez suportadas.' },

  /* ------------------------------- faq -------------------------------- */
  'about.faq.title': { zh: '常见问题', hi: 'अक्सर पूछे जाने वाले सवाल', es: 'Preguntas frecuentes', fr: 'Questions fréquentes', ru: 'Частые вопросы', tr: 'Sık sorulan sorular', ur: 'عام سوالات', id: 'Pertanyaan umum', pt: 'Perguntas frequentes' },
  'about.faq.q1': { zh: 'FBT Swap 是什么？', hi: 'FBT Swap क्या है?', es: '¿Qué es FBT Swap?', fr: 'Qu\u2019est-ce que FBT Swap ?', ru: 'Что такое FBT Swap?', tr: 'FBT Swap nedir?', ur: 'FBT Swap کیا ہے؟', id: 'Apa itu FBT Swap?', pt: 'O que é o FBT Swap?' },
  'about.faq.a1': {
    zh: 'FBT Swap 是一个非托管界面，帮助您在支持的网络上兑换和使用数字资产。您连接自己的钱包，自己签署交易，资产从不存放在公司账户中。',
    hi: 'FBT Swap एक नॉन-कस्टोडियल इंटरफ़ेस है जो समर्थित नेटवर्क पर डिजिटल संपत्ति स्वैप और इस्तेमाल करने में मदद करता है। आप अपना वॉलेट जोड़ते हैं, अपने लेनदेन खुद साइन करते हैं, और संपत्ति कभी किसी कंपनी खाते में नहीं रहती।',
    es: 'FBT Swap es una interfaz sin custodia que te ayuda a intercambiar e interactuar con activos digitales en las redes compatibles. Conectas tu propia cartera, firmas tus propias transacciones y los activos nunca quedan en una cuenta de la empresa.',
    fr: 'FBT Swap est une interface non-custodial qui vous permet d\u2019échanger et d\u2019utiliser des actifs numériques sur les réseaux pris en charge. Vous connectez votre propre portefeuille, vous signez vos propres transactions et les actifs ne transitent jamais par un compte de la société.',
    ru: 'FBT Swap — некастодиальный интерфейс для обмена и работы с цифровыми активами в поддерживаемых сетях. Вы подключаете свой кошелёк, сами подписываете транзакции, и активы никогда не лежат на счёте компании.',
    tr: 'FBT Swap, desteklenen ağlarda dijital varlıkları takas etmene ve kullanmana yardımcı olan saklamasız bir arayüzdür. Kendi cüzdanını bağlarsın, işlemlerini kendin imzalarsın ve varlıklar asla bir şirket hesabında durmaz.',
    ur: 'FBT Swap ایک نان کسٹوڈیل انٹرفیس ہے جو معاون نیٹ ورکس پر ڈیجیٹل اثاثوں کی سویپ اور استعمال میں مدد کرتا ہے۔ آپ اپنا والٹ جوڑتے ہیں، اپنی ٹرانزیکشنز خود سائن کرتے ہیں، اور اثاثے کبھی کمپنی کے اکاؤنٹ میں نہیں رہتے۔',
    id: 'FBT Swap adalah antarmuka non-kustodial yang membantumu menukar dan berinteraksi dengan aset digital di jaringan yang didukung. Kamu menghubungkan dompetmu sendiri, menandatangani transaksimu sendiri, dan aset tidak pernah berada di akun perusahaan.',
    pt: 'O FBT Swap é uma interface sem custódia que o ajuda a trocar e interagir com ativos digitais nas redes suportadas. Você conecta a sua própria carteira, assina as suas próprias transações e os ativos nunca ficam numa conta da empresa.'
  },
  'about.faq.q2': { zh: 'FBT Intent OS 是什么？', hi: 'FBT Intent OS क्या है?', es: '¿Qué es FBT Intent OS?', fr: 'Qu\u2019est-ce que FBT Intent OS ?', ru: 'Что такое FBT Intent OS?', tr: 'FBT Intent OS nedir?', ur: 'FBT Intent OS کیا ہے؟', id: 'Apa itu FBT Intent OS?', pt: 'O que é o FBT Intent OS?' },
  'about.faq.a2': {
    zh: 'Intent OS 是一个智能层：理解您想达成的目标，分析可用信息，并帮助规划一条风险可控、可解释的路径——在任何执行之前始终征求您的批准。',
    hi: 'Intent OS वह इंटेलिजेंस लेयर है जो समझती है कि आप क्या हासिल करना चाहते हैं, उपलब्ध जानकारी का विश्लेषण करती है, और उस लक्ष्य तक जोखिम-सजग, समझाने योग्य रास्ता बनाने में मदद करती है — किसी भी निष्पादन से पहले हमेशा आपकी मंज़ूरी माँगते हुए।',
    es: 'Intent OS es la capa de inteligencia que entiende lo que quieres lograr, analiza la información disponible y ayuda a trazar un camino explicable y consciente del riesgo hacia ese objetivo, pidiendo siempre tu aprobación antes de cualquier ejecución.',
    fr: 'Intent OS est la couche d\u2019intelligence qui comprend ce que vous voulez accomplir, analyse les informations disponibles et aide à construire un parcours explicable et conscient du risque vers cet objectif, en demandant toujours votre accord avant toute exécution.',
    ru: 'Intent OS — интеллектуальный слой, который понимает, чего вы хотите добиться, анализирует доступную информацию и помогает выстроить объяснимый путь к цели с учётом риска, всегда спрашивая ваше одобрение перед выполнением.',
    tr: 'Intent OS, neye ulaşmak istediğini anlayan, mevcut bilgiyi analiz eden ve o hedefe giden riske duyarlı, açıklanabilir bir yol oluşturmaya yardımcı olan zekâ katmanıdır; herhangi bir işlemden önce her zaman onayını ister.',
    ur: 'Intent OS وہ انٹیلیجنس لیئر ہے جو سمجھتی ہے آپ کیا حاصل کرنا چاہتے ہیں، دستیاب معلومات کا تجزیہ کرتی ہے، اور اس مقصد تک رسک سے آگاہ، قابلِ وضاحت راستہ بنانے میں مدد کرتی ہے — کسی بھی عمل سے پہلے ہمیشہ آپ کی منظوری مانگتے ہوئے۔',
    id: 'Intent OS adalah lapisan kecerdasan yang memahami apa yang ingin kamu capai, menganalisis informasi yang tersedia, dan membantu menyusun jalur yang sadar risiko dan dapat dijelaskan menuju tujuan itu, selalu meminta persetujuanmu sebelum eksekusi apa pun.',
    pt: 'O Intent OS é a camada de inteligência que entende o que quer alcançar, analisa a informação disponível e ajuda a traçar um caminho explicável e consciente do risco até esse objetivo, pedindo sempre a sua aprovação antes de qualquer execução.'
  },
  'about.faq.q3': { zh: 'FBT Swap 是非托管的吗？', hi: 'क्या FBT Swap नॉन-कस्टोडियल है?', es: '¿FBT Swap es sin custodia?', fr: 'FBT Swap est-il non-custodial ?', ru: 'FBT Swap — некастодиальный?', tr: 'FBT Swap saklamasız mı?', ur: 'کیا FBT Swap نان کسٹوڈیل ہے؟', id: 'Apakah FBT Swap non-kustodial?', pt: 'O FBT Swap é sem custódia?' },
  'about.faq.a3': {
    zh: '是的（在适用范围内）。交易直接在您的钱包与区块链之间执行。Fanous Bazaar Pishgam 无法访问您的私钥，无法转移您的资金，也无法找回丢失的助记词。',
    hi: 'हाँ, जहाँ लागू हो। ट्रेड सीधे आपके वॉलेट और ब्लॉकचेन के बीच होते हैं। Fanous Bazaar Pishgam के पास आपकी निजी कुंजियों की पहुँच नहीं है, वह आपके फंड नहीं हिला सकती, और खोया हुआ सीड फ़्रेज़ वापस नहीं ला सकती।',
    es: 'Sí, donde aplica. Las operaciones se ejecutan directamente entre tu cartera y la blockchain. Fanous Bazaar Pishgam no tiene acceso a tus claves privadas, no puede mover tus fondos y no puede recuperar una frase semilla perdida.',
    fr: 'Oui, là où cela s\u2019applique. Les échanges s\u2019exécutent directement entre votre portefeuille et la blockchain. Fanous Bazaar Pishgam n\u2019a pas accès à vos clés privées, ne peut pas déplacer vos fonds et ne peut pas récupérer une phrase de récupération perdue.',
    ru: 'Да, там, где это применимо. Сделки выполняются напрямую между вашим кошельком и блокчейном. Fanous Bazaar Pishgam не имеет доступа к вашим приватным ключам, не может перемещать ваши средства и не может восстановить утерянную seed-фразу.',
    tr: 'Evet, geçerli olduğu her yerde. İşlemler doğrudan cüzdanınla blokzincir arasında yürür. Fanous Bazaar Pishgam özel anahtarlarına erişemez, fonlarını taşıyamaz ve kaybolmuş bir kurtarma ifadesini geri getiremez.',
    ur: 'جی ہاں، جہاں لاگو ہو۔ ٹریڈز براہِ راست آپ کے والٹ اور بلاک چین کے درمیان چلتی ہیں۔ Fanous Bazaar Pishgam کو آپ کی پرائیویٹ کیز تک رسائی نہیں، وہ آپ کے فنڈز نہیں ہلا سکتی، اور گم شدہ سیڈ فریز واپس نہیں لا سکتی۔',
    id: 'Ya, di mana berlaku. Transaksi dieksekusi langsung antara dompetmu dan blockchain. Fanous Bazaar Pishgam tidak punya akses ke kunci privatmu, tidak bisa memindahkan danamu, dan tidak bisa memulihkan seed phrase yang hilang.',
    pt: 'Sim, onde aplicável. As operações são executadas diretamente entre a sua carteira e a blockchain. A Fanous Bazaar Pishgam não tem acesso às suas chaves privadas, não pode mover os seus fundos e não pode recuperar uma frase-semente perdida.'
  },
  'about.faq.q4': { zh: '支持哪些网络？', hi: 'कौन-से नेटवर्क समर्थित हैं?', es: '¿Qué redes son compatibles?', fr: 'Quels réseaux sont pris en charge ?', ru: 'Какие сети поддерживаются?', tr: 'Hangi ağlar destekleniyor?', ur: 'کون سے نیٹ ورکس معاون ہیں؟', id: 'Jaringan apa saja yang didukung?', pt: 'Que redes são suportadas?' },
  'about.faq.a4': {
    zh: '实时列表来自应用的网络注册表：BNB Chain、以太坊、Polygon、Arbitrum、Base、Optimism、Avalanche、Linea、Sonic 和 Solana。页面始终反映当前注册表，而不是硬编码的营销清单。',
    hi: 'लाइव सूची ऐप की रजिस्ट्री से आती है: BNB Chain, Ethereum, Polygon, Arbitrum, Base, Optimism, Avalanche, Linea, Sonic और Solana। यह पेज हमेशा मौजूदा रजिस्ट्री दिखाता है — कोई हार्डकोड की गई मार्केटिंग सूची नहीं।',
    es: 'La lista activa sale del registro de la app: BNB Chain, Ethereum, Polygon, Arbitrum, Base, Optimism, Avalanche, Linea, Sonic y Solana. La página siempre refleja el registro actual, no una lista de marketing escrita a mano.',
    fr: 'La liste active provient du registre de l\u2019application : BNB Chain, Ethereum, Polygon, Arbitrum, Base, Optimism, Avalanche, Linea, Sonic et Solana. La page reflète toujours le registre courant, pas une liste marketing codée en dur.',
    ru: 'Актуальный список берётся из реестра приложения: BNB Chain, Ethereum, Polygon, Arbitrum, Base, Optimism, Avalanche, Linea, Sonic и Solana. Страница всегда отражает текущий реестр, а не зашитый маркетинговый перечень.',
    tr: 'Canlı liste uygulamanın kayıt defterinden gelir: BNB Chain, Ethereum, Polygon, Arbitrum, Base, Optimism, Avalanche, Linea, Sonic ve Solana. Sayfa her zaman güncel kaydı yansıtır; sabit kodlanmış bir pazarlama listesi değildir.',
    ur: 'لائیو فہرست ایپ کی رجسٹری سے آتی ہے: BNB Chain، Ethereum، Polygon، Arbitrum، Base، Optimism، Avalanche، Linea، Sonic اور Solana۔ یہ صفحہ ہمیشہ موجودہ رجسٹری دکھاتا ہے — کوئی ہارڈ کوڈڈ مارکیٹنگ فہرست نہیں۔',
    id: 'Daftar aktif diambil dari registri aplikasi: BNB Chain, Ethereum, Polygon, Arbitrum, Base, Optimism, Avalanche, Linea, Sonic, dan Solana. Halaman ini selalu mencerminkan registri saat ini, bukan daftar pemasaran yang ditulis tetap.',
    pt: 'A lista ativa vem do registo da app: BNB Chain, Ethereum, Polygon, Arbitrum, Base, Optimism, Avalanche, Linea, Sonic e Solana. A página reflete sempre o registo atual, não uma lista de marketing escrita à mão.'
  },
  'about.faq.q5': { zh: 'AI 是如何工作的？', hi: 'AI कैसे काम करता है?', es: '¿Cómo funciona la IA?', fr: 'Comment fonctionne l\u2019IA ?', ru: 'Как работает ИИ?', tr: 'Yapay zekâ nasıl çalışıyor?', ur: 'AI کیسے کام کرتا ہے؟', id: 'Bagaimana cara kerja AI-nya?', pt: 'Como funciona a IA?' },
  'about.faq.a5': {
    zh: '通过 FBT AI 网关和编排器，平台可以使用已配置的提供方（如 Gemini 或 OpenRouter）以及内部智能系统来分析市场、链上和投资组合数据。它负责辅助和解释——不保证结果。',
    hi: 'FBT AI गेटवे और ऑर्केस्ट्रेटर के ज़रिए प्लेटफ़ॉर्म कॉन्फ़िगर किए गए प्रोवाइडर (जैसे Gemini या OpenRouter) और आंतरिक इंटेलिजेंस सिस्टम से बाज़ार, ऑन-चेन और पोर्टफ़ोलियो डेटा का विश्लेषण कर सकता है। यह सहायता करता है और समझाता है — नतीजों की गारंटी नहीं देता।',
    es: 'A través del FBT AI Gateway y el orquestador, la plataforma puede usar proveedores configurados (como Gemini u OpenRouter) y sistemas de inteligencia internos para analizar datos de mercado, en cadena y de cartera. Asiste y explica; no garantiza resultados.',
    fr: 'Via la passerelle FBT AI et l\u2019orchestrateur, la plateforme peut s\u2019appuyer sur des fournisseurs configurés (comme Gemini ou OpenRouter) et des systèmes d\u2019intelligence internes pour analyser les données de marché, on-chain et de portefeuille. Elle assiste et explique — elle ne garantit aucun résultat.',
    ru: 'Через шлюз FBT AI и оркестратор платформа может использовать настроенных провайдеров (например, Gemini или OpenRouter) и внутренние системы аналитики для анализа рыночных, ончейн- и портфельных данных. ИИ помогает и объясняет — но не гарантирует результат.',
    tr: 'FBT AI Gateway ve orkestratör üzerinden platform, yapılandırılmış sağlayıcıları (Gemini veya OpenRouter gibi) ve dahili zekâ sistemlerini kullanarak piyasa, zincir üstü ve portföy verilerini analiz edebilir. Yardımcı olur ve açıklar; sonuç garanti etmez.',
    ur: 'FBT AI گیٹ وے اور آرکسٹریٹر کے ذریعے پلیٹ فارم کنفیگر شدہ فراہم کنندگان (جیسے Gemini یا OpenRouter) اور اندرونی انٹیلیجنس سسٹمز سے مارکیٹ، آن چین اور پورٹ فولیو ڈیٹا کا تجزیہ کر سکتا ہے۔ یہ مدد اور وضاحت کرتا ہے — نتائج کی ضمانت نہیں دیتا۔',
    id: 'Melalui FBT AI Gateway dan orkestrator, platform dapat memakai penyedia yang dikonfigurasi (seperti Gemini atau OpenRouter) dan sistem kecerdasan internal untuk menganalisis data pasar, on-chain, dan portofolio. Ia membantu dan menjelaskan, bukan menjamin hasil.',
    pt: 'Através do FBT AI Gateway e do orquestrador, a plataforma pode usar fornecedores configurados (como Gemini ou OpenRouter) e sistemas de inteligência internos para analisar dados de mercado, on-chain e de carteira. Ela ajuda e explica; não garante resultados.'
  },
  'about.faq.q6': { zh: 'FBT 保证盈利吗？', hi: 'क्या FBT मुनाफ़े की गारंटी देता है?', es: '¿FBT garantiza beneficios?', fr: 'FBT garantit-il des profits ?', ru: 'FBT гарантирует прибыль?', tr: 'FBT kâr garantisi veriyor mu?', ur: 'کیا FBT منافع کی ضمانت دیتا ہے؟', id: 'Apakah FBT menjamin keuntungan?', pt: 'A FBT garante lucros?' },
  'about.faq.a6': {
    zh: '不。AI 分析和信号仅供参考，无法保证未来表现。加密货币波动剧烈，您可能损失全部资金。',
    hi: 'नहीं। AI विश्लेषण और सिग्नल सिर्फ़ जानकारी के लिए हैं और भविष्य के प्रदर्शन की गारंटी नहीं दे सकते। क्रिप्टो अस्थिर है और आप सब कुछ खो सकते हैं।',
    es: 'No. El análisis y las señales de IA son informativos y no pueden garantizar resultados futuros. Las criptomonedas son volátiles y puedes perderlo todo.',
    fr: 'Non. Les analyses et signaux de l\u2019IA sont informatifs et ne peuvent garantir aucune performance future. Les cryptomonnaies sont volatiles et vous pouvez tout perdre.',
    ru: 'Нет. Аналитика и сигналы ИИ носят информационный характер и не гарантируют будущих результатов. Криптовалюты волатильны, и вы можете потерять всё.',
    tr: 'Hayır. Yapay zekâ analizleri ve sinyaller bilgilendirme amaçlıdır ve gelecekteki performansı garanti edemez. Kripto oynaktır ve her şeyi kaybedebilirsin.',
    ur: 'نہیں۔ AI تجزیہ اور سگنلز صرف معلومات کے لیے ہیں اور مستقبل کی کارکردگی کی ضمانت نہیں دے سکتے۔ کرپٹو غیر مستحکم ہے اور آپ سب کچھ کھو سکتے ہیں۔',
    id: 'Tidak. Analisis dan sinyal AI bersifat informatif dan tidak dapat menjamin kinerja di masa depan. Kripto sangat fluktuatif dan kamu bisa kehilangan semuanya.',
    pt: 'Não. As análises e os sinais de IA são informativos e não podem garantir resultados futuros. As criptomoedas são voláteis e você pode perder tudo.'
  },
  'about.faq.q7': { zh: 'AI 能执行交易吗？', hi: 'क्या AI लेनदेन कर सकता है?', es: '¿Puede la IA ejecutar transacciones?', fr: 'L\u2019IA peut-elle exécuter des transactions ?', ru: 'Может ли ИИ выполнять транзакции?', tr: 'Yapay zekâ işlem yapabilir mi?', ur: 'کیا AI ٹرانزیکشنز کر سکتا ہے؟', id: 'Bisakah AI mengeksekusi transaksi?', pt: 'A IA pode executar transações?' },
  'about.faq.a7': {
    zh: 'AI 可以提议并解释操作，但执行始终需要您的明确授权。对于敏感的资金操作，AI 绝不会独立控制用户资金。授权模型是由用户掌控的签名。',
    hi: 'AI कार्रवाइयाँ सुझा और समझा सकता है, लेकिन निष्पादन के लिए हमेशा आपकी स्पष्ट मंज़ूरी चाहिए। संवेदनशील वित्तीय कार्रवाइयों में AI कभी स्वतंत्र रूप से उपयोगकर्ता के फंड नियंत्रित नहीं करता। अधिकार मॉडल उपयोगकर्ता-नियंत्रित साइनिंग है।',
    es: 'La IA puede proponer y explicar acciones, pero la ejecución siempre requiere tu autorización explícita. En acciones financieras sensibles la IA nunca controla los fondos del usuario por sí sola. El modelo de autorización es la firma controlada por el usuario.',
    fr: 'L\u2019IA peut proposer et expliquer des actions, mais l\u2019exécution exige toujours votre autorisation explicite. Pour les opérations financières sensibles, l\u2019IA ne contrôle jamais seule les fonds de l\u2019utilisateur. Le modèle d\u2019autorisation est la signature contrôlée par l\u2019utilisateur.',
    ru: 'ИИ может предлагать и объяснять действия, но выполнение всегда требует вашего явного разрешения. В чувствительных финансовых операциях ИИ никогда самостоятельно не распоряжается средствами пользователя. Модель авторизации — подпись под контролем пользователя.',
    tr: 'Yapay zekâ eylem önerebilir ve açıklayabilir; ancak yürütme her zaman açık onayını gerektirir. Hassas finansal işlemlerde yapay zekâ kullanıcı fonlarını asla tek başına kontrol etmez. Yetkilendirme modeli kullanıcı kontrolündeki imzadır.',
    ur: 'AI اقدامات تجویز اور واضح کر سکتا ہے، لیکن عمل درآمد کے لیے ہمیشہ آپ کی واضح اجازت درکار ہے۔ حساس مالی اقدامات میں AI کبھی آزادانہ طور پر صارف کے فنڈز کنٹرول نہیں کرتا۔ اجازت کا ماڈل صارف کے کنٹرول والی سائننگ ہے۔',
    id: 'AI bisa mengusulkan dan menjelaskan tindakan, tetapi eksekusi selalu membutuhkan otorisasi eksplisit darimu. Untuk tindakan finansial yang sensitif, AI tidak pernah mengendalikan dana pengguna secara mandiri. Model otorisasinya adalah penandatanganan yang dikendalikan pengguna.',
    pt: 'A IA pode propor e explicar ações, mas a execução exige sempre a sua autorização explícita. Em ações financeiras sensíveis, a IA nunca controla os fundos do utilizador de forma independente. O modelo de autorização é a assinatura controlada pelo utilizador.'
  },
  'about.faq.q8': { zh: '什么是聪明钱？', hi: 'स्मार्ट मनी क्या है?', es: '¿Qué es Smart Money?', fr: 'Qu\u2019est-ce que Smart Money ?', ru: 'Что такое Smart Money?', tr: 'Akıllı para nedir?', ur: 'اسمارٹ منی کیا ہے؟', id: 'Apa itu Smart Money?', pt: 'O que é o Smart Money?' },
  'about.faq.a8': {
    zh: '聪明钱把链上活动——巨鲸动向、大额交易、持币者变化以及有数据时的钱包行为——转化为可理解的洞察。它不预测价格。',
    hi: 'स्मार्ट मनी ऑन-चेन गतिविधि — व्हेल की चाल, बड़े लेनदेन, होल्डर बदलाव और जहाँ डेटा उपलब्ध हो वहाँ वॉलेट व्यवहार — को समझने योग्य जानकारी में बदलता है। यह कीमतों की भविष्यवाणी नहीं करता।',
    es: 'Smart Money convierte la actividad en cadena (movimientos de ballenas, transacciones grandes, cambios de holders y comportamiento de carteras donde hay datos) en inteligencia comprensible. No predice precios.',
    fr: 'Smart Money transforme l\u2019activité on-chain — mouvements de baleines, grosses transactions, évolution des détenteurs et comportement des portefeuilles lorsque les données existent — en informations compréhensibles. Il ne prédit pas les prix.',
    ru: 'Smart Money превращает ончейн-активность — движения китов, крупные транзакции, изменения держателей и поведение кошельков там, где есть данные, — в понятную аналитику. Цены он не предсказывает.',
    tr: 'Akıllı para; balina hareketleri, büyük işlemler, sahip değişimleri ve veri olan yerde cüzdan davranışları gibi zincir üstü etkinliği anlaşılır bilgiye dönüştürür. Fiyat tahmini yapmaz.',
    ur: 'اسمارٹ منی آن چین سرگرمی — وہیل کی نقل و حرکت، بڑی ٹرانزیکشنز، ہولڈرز میں تبدیلی اور جہاں ڈیٹا ہو وہاں والٹ رویّہ — کو قابلِ فہم معلومات میں بدلتا ہے۔ یہ قیمتوں کی پیش گوئی نہیں کرتا۔',
    id: 'Smart Money mengubah aktivitas on-chain (pergerakan whale, transaksi besar, perubahan pemegang, dan perilaku dompet di mana datanya tersedia) menjadi intelijen yang mudah dipahami. Ia tidak memprediksi harga.',
    pt: 'O Smart Money transforma a atividade on-chain — movimentos de baleias, transações grandes, mudanças de detentores e comportamento de carteiras onde há dados — em inteligência compreensível. Não prevê preços.'
  },
  'about.faq.q9': { zh: '什么是 Solana 洞察？', hi: 'Solana इंटेलिजेंस क्या है?', es: '¿Qué es Solana Intelligence?', fr: 'Qu\u2019est-ce que Solana Intelligence ?', ru: 'Что такое Solana Intelligence?', tr: 'Solana zekâsı nedir?', ur: 'Solana انٹیلیجنس کیا ہے؟', id: 'Apa itu Solana Intelligence?', pt: 'O que é o Solana Intelligence?' },
  'about.faq.a9': {
    zh: '专为 Solana 生态打造的一层：SOL 分析、代币发现、早期信号、流动性与持币者分析，以及已实现的代币风险指标。',
    hi: 'Solana इकोसिस्टम के लिए एक समर्पित लेयर: SOL विश्लेषण, टोकन खोज, शुरुआती सिग्नल, लिक्विडिटी और होल्डर एनालिटिक्स, और जहाँ लागू हो वहाँ टोकन जोखिम संकेतक।',
    es: 'Una capa dedicada al ecosistema Solana: análisis de SOL, descubrimiento de tokens, señales tempranas, analítica de liquidez y holders, e indicadores de riesgo de tokens donde estén implementados.',
    fr: 'Une couche dédiée à l\u2019écosystème Solana : analyse de SOL, découverte de tokens, signaux précoces, analyse de la liquidité et des détenteurs, et indicateurs de risque des tokens lorsqu\u2019ils sont implémentés.',
    ru: 'Отдельный слой для экосистемы Solana: анализ SOL, поиск токенов, ранние сигналы, аналитика ликвидности и держателей, а также индикаторы риска токенов там, где они реализованы.',
    tr: 'Solana ekosistemine özel bir katman: SOL analizi, token keşfi, erken sinyaller, likidite ve sahip analizi ve uygulandığı yerde token risk göstergeleri.',
    ur: 'Solana ایکو سسٹم کے لیے مخصوص لیئر: SOL تجزیہ، ٹوکن دریافت، ابتدائی سگنلز، لیکویڈیٹی اور ہولڈر تجزیات، اور جہاں نافذ ہو وہاں ٹوکن رسک اشارے۔',
    id: 'Lapisan khusus untuk ekosistem Solana: analisis SOL, penemuan token, sinyal awal, analitik likuiditas dan pemegang, serta indikator risiko token di mana sudah diterapkan.',
    pt: 'Uma camada dedicada ao ecossistema Solana: análise de SOL, descoberta de tokens, sinais iniciais, análise de liquidez e detentores, e indicadores de risco de tokens onde implementados.'
  },
  'about.faq.q10': { zh: 'FBT 支持哪些市场？', hi: 'FBT किन बाज़ारों का समर्थन करता है?', es: '¿Qué mercados admite FBT?', fr: 'Quels marchés FBT prend-il en charge ?', ru: 'Какие рынки поддерживает FBT?', tr: 'FBT hangi piyasaları destekliyor?', ur: 'FBT کن مارکیٹس کو سپورٹ کرتا ہے؟', id: 'Pasar apa saja yang didukung FBT?', pt: 'Que mercados a FBT suporta?' },
  'about.faq.a10': {
    zh: '已上线：加密货币兑换、DeFi 发现和 Solana 洞察。未来/即将推出（视情况而定）：代币化资产、RWA、股票、大宗商品、期货及更广泛的全球市场。未来市场始终标注为"未来"或"即将推出"。',
    hi: 'लाइव: क्रिप्टो स्वैप, DeFi खोज और Solana इंटेलिजेंस। भविष्य/जल्द आ रहा है (जहाँ उपयुक्त हो): टोकनाइज़्ड संपत्ति, RWA, स्टॉक, कमोडिटी, फ़्यूचर्स और व्यापक वैश्विक बाज़ार। भविष्य के बाज़ारों को हम हमेशा "भविष्य" या "जल्द आ रहा है" के रूप में चिह्नित करते हैं।',
    es: 'Activo: intercambio de cripto, descubrimiento DeFi e inteligencia Solana. Futuro / próximamente, según corresponda: activos tokenizados, RWA, acciones, materias primas, futuros y mercados globales más amplios. Los mercados futuros siempre se etiquetan como Futuro o Próximamente.',
    fr: 'En service : échanges crypto, découverte DeFi et intelligence Solana. À venir / bientôt, le cas échéant : actifs tokenisés, RWA, actions, matières premières, contrats à terme et marchés mondiaux plus larges. Les marchés à venir sont toujours étiquetés « À venir » ou « Bientôt ».',
    ru: 'Работает: обмен криптовалют, поиск DeFi-возможностей и аналитика Solana. В планах / скоро, где это уместно: токенизированные активы, RWA, акции, сырьё, фьючерсы и более широкие мировые рынки. Будущие рынки всегда помечены как «В планах» или «Скоро».',
    tr: 'Canlı: kripto takası, DeFi keşfi ve Solana zekâsı. Gelecek / yakında (uygun olduğunda): tokenleştirilmiş varlıklar, RWA, hisseler, emtialar, vadeli işlemler ve daha geniş küresel piyasalar. Gelecekteki piyasaları her zaman Gelecek veya Yakında olarak etiketleriz.',
    ur: 'لائیو: کرپٹو سویپ، DeFi دریافت اور Solana انٹیلیجنس۔ مستقبل / جلد آ رہا ہے (جہاں مناسب ہو): ٹوکنائزڈ اثاثے، RWA، اسٹاکس، اجناس، فیوچرز اور وسیع تر عالمی مارکیٹس۔ مستقبل کی مارکیٹس کو ہم ہمیشہ "مستقبل" یا "جلد" کے طور پر نشان زد کرتے ہیں۔',
    id: 'Aktif: swap kripto, penemuan DeFi, dan intelijen Solana. Mendatang / segera hadir bila sesuai: aset tertokenisasi, RWA, saham, komoditas, futures, dan pasar global yang lebih luas. Pasar mendatang selalu kami beri label Mendatang atau Segera Hadir.',
    pt: 'Ativo: swaps de cripto, descoberta DeFi e inteligência Solana. Futuro / em breve, quando aplicável: ativos tokenizados, RWA, ações, matérias-primas, futuros e mercados globais mais amplos. Os mercados futuros são sempre marcados como Futuro ou Em breve.'
  },

  /* ------------------------------- close -------------------------------- */
  'about.ctaTitle': { zh: '还有疑问？', hi: 'अब भी कोई सवाल है?', es: '¿Todavía tienes dudas?', fr: 'Une question ?', ru: 'Остались вопросы?', tr: 'Hâlâ bir sorun mu var?', ur: 'اب بھی کوئی سوال ہے؟', id: 'Masih ada pertanyaan?', pt: 'Ainda tem dúvidas?' },
  'about.companyFull': { zh: 'Fanous Bazaar Pishgam', hi: 'Fanous Bazaar Pishgam', es: 'Fanous Bazaar Pishgam', fr: 'Fanous Bazaar Pishgam', ru: 'Fanous Bazaar Pishgam', tr: 'Fanous Bazaar Pishgam', ur: 'Fanous Bazaar Pishgam', id: 'Fanous Bazaar Pishgam', pt: 'Fanous Bazaar Pishgam' },
  'about.footNote': {
    zh: '市场数据仅供参考，不构成财务建议。加密货币波动剧烈——只投入您能承受损失的资金。',
    hi: 'बाज़ार डेटा सिर्फ़ जानकारी के लिए है, वित्तीय सलाह नहीं। क्रिप्टो अस्थिर है — सिर्फ़ उतना ही ट्रेड करें जितना खोने का जोखिम उठा सकते हों।',
    es: 'Los datos de mercado son informativos, no asesoramiento financiero. Las criptomonedas son volátiles: opera solo con lo que puedas permitirte perder.',
    fr: 'Les données de marché sont fournies à titre informatif et ne constituent pas un conseil financier. Les cryptomonnaies sont volatiles : ne tradez que ce que vous pouvez vous permettre de perdre.',
    ru: 'Рыночные данные носят информационный характер и не являются финансовой рекомендацией. Криптовалюты волатильны — торгуйте только тем, что готовы потерять.',
    tr: 'Piyasa verileri bilgilendirme amaçlıdır, finansal tavsiye değildir. Kripto oynaktır; yalnızca kaybetmeyi göze alabileceğin kadarıyla işlem yap.',
    ur: 'مارکیٹ ڈیٹا صرف معلومات کے لیے ہے، مالی مشورہ نہیں۔ کرپٹو غیر مستحکم ہے — صرف اتنی ٹریڈ کریں جتنا نقصان برداشت کر سکیں۔',
    id: 'Data pasar bersifat informatif, bukan nasihat keuangan. Kripto sangat fluktuatif; bertransaksilah hanya dengan dana yang siap kamu relakan.',
    pt: 'Os dados de mercado são informativos, não aconselhamento financeiro. As criptomoedas são voláteis: negocie apenas o que pode perder.'
  },

  /* Reused by the closing buttons; the keys live outside `about.*`. */
  'contact.title': { zh: '联系我们', hi: 'संपर्क करें', es: 'Contáctanos', fr: 'Nous contacter', ru: 'Связаться с нами', tr: 'Bize ulaşın', ur: 'ہم سے رابطہ کریں', id: 'Hubungi kami', pt: 'Fale connosco' }
};
