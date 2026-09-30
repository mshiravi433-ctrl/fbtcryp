#!/usr/bin/env node
/**
 * ONE-OFF: add the keys introduced by the perp / market / coin / solana work
 * to every locale bundle. Idempotent — re-running only fills what is missing.
 *
 * Not part of the build. Kept in the repo so the next person adding keys to
 * these screens does not have to hand-edit twelve JSON files and hope.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'src/i18n/locales');

/** key path → { locale: string } */
const ADDITIONS = {
  /* ─── perp: the pair catalogue ─────────────────────────────────────────── */
  'perp.terminal.pairsCount': {
    en: '{{count}} pairs',
    fa: '{{count}} جفت توکن',
    ar: '{{count}} زوج',
    tr: '{{count}} çift',
    es: '{{count}} pares',
    fr: '{{count}} paires',
    ru: '{{count}} пар',
    zh: '{{count}} 个币对',
    pt: '{{count}} pares',
    id: '{{count}} pasangan',
    hi: '{{count}} जोड़े',
    ur: '{{count}} جوڑے'
  },
  'perp.terminal.pairSearch': {
    en: 'Search pairs',
    fa: 'جستجوی جفت توکن',
    ar: 'ابحث عن زوج',
    tr: 'Çift ara',
    es: 'Buscar pares',
    fr: 'Rechercher des paires',
    ru: 'Поиск пар',
    zh: '搜索币对',
    pt: 'Buscar pares',
    id: 'Cari pasangan',
    hi: 'जोड़े खोजें',
    ur: 'جوڑے تلاش کریں'
  },
  'perp.terminal.pairInApp': {
    en: 'Can be traded in this app',
    fa: 'در همین اپ قابل معامله است',
    ar: 'قابل التداول داخل التطبيق',
    tr: 'Bu uygulamada işlem görür',
    es: 'Se puede operar en esta app',
    fr: 'Négociable dans cette application',
    ru: 'Торгуется в этом приложении',
    zh: '可直接在本应用交易',
    pt: 'Negociável neste app',
    id: 'Dapat diperdagangkan di app ini',
    hi: 'इस ऐप में ही व्यापार होता है',
    ur: 'اسی ایپ میں قابل تجارت ہے'
  },
  'perp.terminal.noPairMatch': {
    en: 'No pair matches that search.',
    fa: 'جفت توکنی با این جستجو پیدا نشد.',
    ar: 'لا يوجد زوج مطابق لهذا البحث.',
    tr: 'Bu aramayla eşleşen çift yok.',
    es: 'Ningún par coincide con esa búsqueda.',
    fr: 'Aucune paire ne correspond à cette recherche.',
    ru: 'Нет пар, подходящих под этот запрос.',
    zh: '没有符合搜索的币对。',
    pt: 'Nenhum par corresponde a essa busca.',
    id: 'Tidak ada pasangan yang cocok dengan pencarian itu.',
    hi: 'इस खोज से कोई जोड़ा नहीं मिला।',
    ur: 'اس تلاش سے کوئی جوڑا نہیں ملا۔'
  },

  /* ─── perp: signing in this tab, not on another one ────────────────────── */
  'perp.terminal.connectSolana': {
    en: 'Connect Solana wallet',
    fa: 'اتصال کیف پول سولانا',
    ar: 'ربط محفظة سولانا',
    tr: 'Solana cüzdanı bağla',
    es: 'Conectar wallet de Solana',
    fr: 'Connecter le portefeuille Solana',
    ru: 'Подключить кошелёк Solana',
    zh: '连接 Solana 钱包',
    pt: 'Conectar carteira Solana',
    id: 'Hubungkan dompet Solana',
    hi: 'Solana वॉलेट जोड़ें',
    ur: 'سولانا والیٹ جوڑیں'
  },
  'perp.terminal.preparing': {
    en: 'Preparing the order…',
    fa: 'در حال آماده‌سازی سفارش…',
    ar: 'جارٍ تجهيز الأمر…',
    tr: 'Emir hazırlanıyor…',
    es: 'Preparando la orden…',
    fr: 'Préparation de l’ordre…',
    ru: 'Готовим ордер…',
    zh: '正在准备订单…',
    pt: 'Preparando a ordem…',
    id: 'Menyiapkan order…',
    hi: 'ऑर्डर तैयार हो रहा है…',
    ur: 'آرڈر تیار کیا جا رہا ہے…'
  },
  'perp.terminal.prepared': {
    en: 'Built by the backend',
    fa: 'ساخته‌شده توسط سرور',
    ar: 'أُنشئ بواسطة الخادم',
    tr: 'Sunucu tarafından oluşturuldu',
    es: 'Construida por el servidor',
    fr: 'Construite par le serveur',
    ru: 'Собрано сервером',
    zh: '由服务器构建',
    pt: 'Criada pelo servidor',
    id: 'Dibangun oleh server',
    hi: 'सर्वर द्वारा बनाया गया',
    ur: 'سرور کے ذریعے تیار کردہ'
  },
  'perp.terminal.preparedNotional': {
    en: 'Order size',
    fa: 'حجم سفارش',
    ar: 'حجم الأمر',
    tr: 'Emir büyüklüğü',
    es: 'Tamaño de la orden',
    fr: 'Taille de l’ordre',
    ru: 'Размер ордера',
    zh: '订单规模',
    pt: 'Tamanho da ordem',
    id: 'Ukuran order',
    hi: 'ऑर्डर का आकार',
    ur: 'آرڈر کا حجم'
  },
  'perp.terminal.preparedSlippage': {
    en: 'Max slippage',
    fa: 'بیشینه لغزش',
    ar: 'أقصى انزلاق',
    tr: 'Maks. kayma',
    es: 'Deslizamiento máx.',
    fr: 'Glissement max.',
    ru: 'Макс. проскальзывание',
    zh: '最大滑点',
    pt: 'Slippage máx.',
    id: 'Slippage maks.',
    hi: 'अधिकतम स्लिपेज',
    ur: 'زیادہ سے زیادہ سلیپیج'
  },
  'perp.terminal.preparedVenue': {
    en: 'Venue market',
    fa: 'بازار مقصد',
    ar: 'سوق المنصة',
    tr: 'Piyasa',
    es: 'Mercado del venue',
    fr: 'Marché du venue',
    ru: 'Рынок площадки',
    zh: '合约市场',
    pt: 'Mercado da venue',
    id: 'Pasar venue',
    hi: 'वेन्यू मार्केट',
    ur: 'ونیو مارکیٹ'
  },
  'perp.terminal.signHere': {
    en: 'The next tap asks YOUR wallet to sign this exact order, here on this screen. Nothing is held by the app.',
    fa: 'لمس بعدی از کیف پول خودت برای امضای همین سفارش می‌خواهد، همین‌جا روی همین صفحه. هیچ دارایی‌ای در اپ نگه داشته نمی‌شود.',
    ar: 'اللمسة التالية تطلب من محفظتك أنت توقيع هذا الأمر بالضبط، هنا على هذه الشاشة. لا يحتفظ التطبيق بأي أصول.',
    tr: 'Bir sonraki dokunuş BU siparişi tam olarak kendi cüzdanınıza imzalatır, burada bu ekranda. Uygulama hiçbir varlığı tutmaz.',
    es: 'El siguiente toque pide a TU wallet que firme esta orden exacta, aquí en esta pantalla. La app no custodia nada.',
    fr: 'Le prochain appui demande à VOTRE portefeuille de signer cet ordre exact, ici, sur cet écran. L’application ne conserve rien.',
    ru: 'Следующее нажатие попросит подписать именно этот ордер вашим кошельком — здесь, на этом экране. Приложение ничего не хранит.',
    zh: '下一次点击将在这里、在本屏幕上请求用你自己的钱包签署这笔订单，应用不托管任何资产。',
    pt: 'O próximo toque pede que a SUA carteira assine exatamente esta ordem, aqui nesta tela. O app não custodia nada.',
    id: 'Ketukan berikutnya meminta dompet ANDA menandatangani order ini tepat di layar ini. Aplikasi tidak menyimpan aset apa pun.',
    hi: 'अगला टैप आपके वॉलेट से इसी ऑर्डर पर यहीं इसी स्क्रीन पर हस्ताक्षर माँगेगा। ऐप कुछ भी अपने पास नहीं रखता।',
    ur: 'اگلا tap آپ کے والیٹ سے اسی آرڈر کی دستخط یہیں اسی اسکرین پر مانگے گا۔ ایپ کچھ بھی اپنے پاس نہیں رکھتا۔'
  },
  'perp.terminal.signNow': {
    en: 'Sign and send',
    fa: 'امضا و ارسال',
    ar: 'وقّع وأرسل',
    tr: 'İmzala ve gönder',
    es: 'Firmar y enviar',
    fr: 'Signer et envoyer',
    ru: 'Подписать и отправить',
    zh: '签名并发送',
    pt: 'Assinar e enviar',
    id: 'Tandatangani dan kirim',
    hi: 'हस्ताक्षर करें और भेजें',
    ur: 'دستخط کریں اور بھیجیں'
  },
  'perp.terminal.signing': {
    en: 'Waiting for your signature…',
    fa: 'در انتظار امضای تو…',
    ar: 'بانتظار توقيعك…',
    tr: 'İmzanız bekleniyor…',
    es: 'Esperando tu firma…',
    fr: 'En attente de votre signature…',
    ru: 'Ожидаем вашу подпись…',
    zh: '等待你的签名…',
    pt: 'Aguardando sua assinatura…',
    id: 'Menunggu tanda tangan Anda…',
    hi: 'आपके हस्ताक्षर की प्रतीक्षा…',
    ur: 'آپ کے دستخط کا انتظار…'
  },
  'perp.terminal.signed': {
    en: 'Order sent. The hash below is recorded in the ledger:',
    fa: 'سفارش ارسال شد. هش زیر در دفتر ثبت شده است:',
    ar: 'تم إرسال الأمر. الهاش أدناه مسجّل في السجل:',
    tr: 'Emir gönderildi. Aşağıdaki hash kayda geçti:',
    es: 'Orden enviada. El hash siguiente quedó registrado en el libro:',
    fr: 'Ordre envoyé. Le hash ci-dessous est enregistré au registre :',
    ru: 'Ордер отправлен. Хеш ниже записан в реестре:',
    zh: '订单已发送。下面的哈希已记入账本：',
    pt: 'Ordem enviada. O hash abaixo foi registrado no livro-razão:',
    id: 'Order terkirim. Hash di bawah tercatat di ledger:',
    hi: 'ऑर्डर भेजा गया। नीचे का हैश लेजर में दर्ज है:',
    ur: 'آرڈر بھیج دیا گیا۔ نیچے دیا ہیش لیجر میں درج ہے:'
  },

  /* ─── perp: execution errors, named rather than coded ─────────────────── */
  'perp.terminal.err.USER_REJECTED': {
    en: 'You rejected the signature in your wallet. Nothing was sent.',
    fa: 'امضا را در کیف پول رد کردی. هیچ چیزی ارسال نشد.',
    ar: 'رفضت التوقيع في محفظتك. لم يُرسل شيء.',
    tr: 'Cüzdanında imzayı reddettin. Hiçbir şey gönderilmedi.',
    es: 'Rechazaste la firma en tu wallet. No se envió nada.',
    fr: 'Vous avez refusé la signature. Rien n’a été envoyé.',
    ru: 'Вы отклонили подпись. Ничего не отправлено.',
    zh: '你在钱包里拒绝了签名。没有发送任何东西。',
    pt: 'Você rejeitou a assinatura. Nada foi enviado.',
    id: 'Kamu menolak tanda tangan di dompet. Tidak ada yang dikirim.',
    hi: 'आपने वॉलेट में हस्ताक्षर अस्वीकार कर दिया। कुछ नहीं भेजा गया।',
    ur: 'آپ نے والیٹ میں دستخط مسترد کر دیا۔ کچھ نہیں بھیجا گیا۔'
  },
  'perp.terminal.err.QUOTE_EXPIRED': {
    en: 'The quote expired. Close this and build the order again.',
    fa: 'قیمت‌گذاری منقضی شد. این پنجره را ببند و سفارش را دوباره بساز.',
    ar: 'انتهت صلاحية السعر. أغلق وأعد بناء الأمر.',
    tr: 'Fiyat teklifinin süresi doldu. Kapatıp emri yeniden oluşturun.',
    es: 'La cotización caducó. Ciérrala y vuelve a crear la orden.',
    fr: 'Le devis a expiré. Fermez et reconstruisez l’ordre.',
    ru: 'Котировка истекла. Закройте и соберите ордер заново.',
    zh: '报价已过期。关闭并重新构建订单。',
    pt: 'A cotação expirou. Feche e crie o pedido de novo.',
    id: 'Kuotasi kedaluwarsa. Tutup lalu bangun ulang ordernya.',
    hi: 'कोटेशन समाप्त हो गया। बंद करें और ऑर्डर फिर से बनाएँ।',
    ur: 'قیمت کی میعاد ختم ہو گئی۔ بند کریں اور آرڈر دوبارہ بنائیں۔'
  },
  'perp.terminal.err.RISK_BLOCKED': {
    en: 'The risk engine refused this order. Nothing was sent.',
    fa: 'موتور ریسک این سفارش را رد کرد. هیچ چیزی ارسال نشد.',
    ar: 'رفض محرك المخاطر هذا الأمر. لم يُرسل شيء.',
    tr: 'Risk motoru bu emri reddetti. Hiçbir şey gönderilmedi.',
    es: 'El motor de riesgo rechazó la orden. No se envió nada.',
    fr: 'Le moteur de risque a refusé cet ordre. Rien n’a été envoyé.',
    ru: 'Риск-движок отклонил ордер. Ничего не отправлено.',
    zh: '风控引擎拒绝了该订单。没有发送任何东西。',
    pt: 'O motor de risco recusou a ordem. Nada foi enviado.',
    id: 'Mesin risiko menolak order ini. Tidak ada yang dikirim.',
    hi: 'रिस्क इंजन ने यह ऑर्डर अस्वीकार कर दिया। कुछ नहीं भेजा गया।',
    ur: 'رسک انجن نے یہ آرڈر مسترد کر دیا۔ کچھ نہیں بھیجا گیا۔'
  },
  'perp.terminal.err.MARKET_NOT_LISTED': {
    en: 'This venue does not list that pair. Pick another one from the strip.',
    fa: 'این صرافی آن جفت توکن را ندارد. از نوار پایین جفت دیگری انتخاب کن.',
    ar: 'هذه المنصة لا تدرج هذا الزوج. اختر زوجًا آخر من الشريط.',
    tr: 'Bu borsa o çifti listelemiyor. Şeritten başka bir çift seçin.',
    es: 'Este venue no lista ese par. Elige otro en la barra.',
    fr: 'Cette plateforme ne liste pas cette paire. Choisissez-en une autre.',
    ru: 'Эта площадка не листирует эту пару. Выберите другую в ленте.',
    zh: '该场所不提供这个币对。请从横条中另选一个。',
    pt: 'Esta venue não lista esse par. Escolha outro na faixa.',
    id: 'Venue ini tidak mencantumkan pasangan itu. Pilih yang lain.',
    hi: 'यह वेन्यू वह जोड़ा नहीं देता। स्ट्रिप से दूसरा चुनें।',
    ur: 'یہ ایکسچنج وہ جوڑا نہیں کھلاتا۔ اسٹرپ سے کوئی اور منتخب کریں۔'
  },
  'perp.terminal.err.PROVIDER_UNAVAILABLE': {
    en: 'The venue did not answer. Nothing was sent — try again in a moment.',
    fa: 'صرافی پاسخ نداد. هیچ چیزی ارسال نشد — کمی بعد دوباره تلاش کن.',
    ar: 'لم تستجب المنصة. لم يُرسل شيء — أعد المحاولة بعد قليل.',
    tr: 'Borsa yanıt vermedi. Hiçbir şey gönderilmedi — birazdan tekrar deneyin.',
    es: 'El venue no respondió. No se envió nada: inténtalo en un momento.',
    fr: 'La plateforme n’a pas répondu. Rien n’a été envoyé — réessayez dans un instant.',
    ru: 'Площадка не ответила. Ничего не отправлено — попробуйте чуть позже.',
    zh: '场所没有响应。没有发送任何内容——稍后重试。',
    pt: 'A venue não respondeu. Nada foi enviado — tente em instantes.',
    id: 'Venue tidak menjawab. Tidak ada yang dikirim — coba lagi sebentar.',
    hi: 'वेन्यू ने जवाब नहीं दिया। कुछ नहीं भेजा — थोड़ी देर बाद कोशिश करें।',
    ur: 'ایکسچنج نے جواب نہیں دیا۔ کچھ نہیں بھیجا — کچھ دیر بعد کوشش کریں۔'
  },

  /* ─── market / coin: the sticky dock ──────────────────────────────────── */
  'coin.swapDockAria': {
    en: 'Buy {{symbol}}',
    fa: 'خرید {{symbol}}',
    ar: 'شراء {{symbol}}',
    tr: '{{symbol}} satın al',
    es: 'Comprar {{symbol}}',
    fr: 'Acheter {{symbol}}',
    ru: 'Купить {{symbol}}',
    zh: '买入 {{symbol}}',
    pt: 'Comprar {{symbol}}',
    id: 'Beli {{symbol}}',
    hi: '{{symbol}} खरीदें',
    ur: '{{symbol}} خریدیں'
  },

  /* ─── solana swap: a token universe, not three rows ───────────────────── */
  'solana.picker.popular': {
    en: 'Popular tokens',
    fa: 'توکن‌های محبوب',
    ar: 'الرموز الشائعة',
    tr: 'Popüler tokenlar',
    es: 'Tokens populares',
    fr: 'Tokens populaires',
    ru: 'Популярные токены',
    zh: '热门代币',
    pt: 'Tokens populares',
    id: 'Token populer',
    hi: 'लोकप्रिय टोकन',
    ur: 'مقبول ترین ٹوکن'
  },
  'solana.picker.universeCount': {
    en: '{{count}} tokens available',
    fa: '{{count}} توکن در دسترس',
    ar: '{{count}} رمز متاح',
    tr: '{{count}} token mevcut',
    es: '{{count}} tokens disponibles',
    fr: '{{count}} tokens disponibles',
    ru: 'Доступно токенов: {{count}}',
    zh: '可用代币 {{count}} 个',
    pt: '{{count}} tokens disponíveis',
    id: '{{count}} token tersedia',
    hi: '{{count}} टोकन उपलब्ध',
    ur: '{{count}} ٹوکن دستیاب'
  },
  'solana.universe.unavailable': {
    en: 'Could not load the token list. Paste a mint address to swap it anyway.',
    fa: 'فهرست توکن‌ها بارگذاری نشد. برای سواپ، آدرس مینت را بچسبان.',
    ar: 'تعذّر تحميل قائمة الرموز. الصق عنوان المينت للمبادلة على أي حال.',
    tr: 'Token listesi yüklenemedi. Yine de takas etmek için bir mint adresi yapıştırın.',
    es: 'No se pudo cargar la lista. Pega una dirección mint para cambiarla igual.',
    fr: 'Impossible de charger la liste. Collez une adresse mint pour l’échanger quand même.',
    ru: 'Не удалось загрузить список токенов. Вставьте адрес mint, чтобы обменять его в любом случае.',
    zh: '无法加载代币列表。粘贴铸币地址仍可直接兑换。',
    pt: 'Não foi possível carregar a lista. Cole um endereço mint para trocar mesmo assim.',
    id: 'Daftar token gagal dimuat. Tempel alamat mint untuk tetap menukarnya.',
    hi: 'टोकन सूची लोड नहीं हो सकी। स्वैप करने के लिए मिंट पता पेस्ट करें।',
    ur: 'ٹوکن لسٹ لوڈ نہیں ہو سکی۔ اسے بدلنے کے لیے مِنٹ ایڈریس پیسٹ کریں۔'
  }
};

function set(obj, dotted, value) {
  const parts = dotted.split('.');
  let node = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (typeof node[parts[i]] !== 'object' || node[parts[i]] === null) node[parts[i]] = {};
    node = node[parts[i]];
  }
  node[parts[parts.length - 1]] = value;
}

const LOCALES = ['en', 'fa', 'ar', 'tr', 'es', 'fr', 'ru', 'zh', 'pt', 'id', 'hi', 'ur'];
let added = 0;

for (const locale of LOCALES) {
  const file = join(dir, `${locale}.json`);
  const raw = readFileSync(file, 'utf8');
  const json = JSON.parse(raw);
  let touched = 0;
  for (const [path, byLocale] of Object.entries(ADDITIONS)) {
    const value = byLocale[locale] ?? byLocale.en;
    if (!value) continue;
    const parts = path.split('.');
    let existing = json;
    let present = true;
    for (const p of parts) {
      if (existing == null || typeof existing !== 'object' || !(p in existing)) { present = false; break; }
      existing = existing[p];
    }
    if (present && typeof existing === 'string') continue;
    set(json, path, value);
    touched += 1;
    added += 1;
  }
  if (touched) writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
  console.log(`${locale}: +${touched}`);
}

console.log(`total keys added: ${added}`);
