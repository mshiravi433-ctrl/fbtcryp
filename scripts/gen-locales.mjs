/**
 * Generate the partial locales.
 *
 * fa / en / ar are maintained by hand and are complete. The other nine
 * languages get a reviewed core: navigation, the welcome and language screens,
 * the guide chrome, the swap flow and — importantly — every safety warning,
 * because a warning nobody can read is not a warning. Everything else falls
 * back to English via i18next's `fallbackLng`, which is honest: a visibly
 * English string tells the user the translation is incomplete, whereas a
 * machine-translated sentence about losing money reads authoritative and can
 * be wrong.
 *
 * Run: node scripts/gen-locales.mjs
 */
import { writeFileSync } from 'node:fs';

const out = (code) => new URL(`../src/i18n/locales/${code}.json`, import.meta.url);

/** key path -> { lang: string } */
const CORE = {
  'nav.market': {
    zh: '市场', hi: 'बाज़ार', es: 'Mercado', fr: 'Marché', ru: 'Рынок',
    tr: 'Piyasa', ur: 'مارکیٹ', id: 'Pasar', pt: 'Mercado'
  },
  'nav.swap': {
    zh: '兑换', hi: 'स्वैप', es: 'Intercambiar', fr: 'Échanger', ru: 'Обмен',
    tr: 'Takas', ur: 'سویپ', id: 'Tukar', pt: 'Trocar'
  },
  'nav.wallet': {
    zh: '钱包', hi: 'वॉलेट', es: 'Cartera', fr: 'Portefeuille', ru: 'Кошелёк',
    tr: 'Cüzdan', ur: 'والٹ', id: 'Dompet', pt: 'Carteira'
  },
  'nav.signals': {
    zh: '信号', hi: 'सिग्नल', es: 'Señales', fr: 'Signaux', ru: 'Сигналы',
    tr: 'Sinyaller', ur: 'سگنلز', id: 'Sinyal', pt: 'Sinais'
  },
  'nav.news': {
    zh: '新闻', hi: 'समाचार', es: 'Noticias', fr: 'Actualités', ru: 'Новости',
    tr: 'Haberler', ur: 'خبریں', id: 'Berita', pt: 'Notícias'
  },
  'nav.more': {
    zh: '更多', hi: 'और', es: 'Más', fr: 'Plus', ru: 'Ещё',
    tr: 'Daha', ur: 'مزید', id: 'Lainnya', pt: 'Mais'
  },
  'nav.settings': {
    zh: '设置', hi: 'सेटिंग्स', es: 'Ajustes', fr: 'Réglages', ru: 'Настройки',
    tr: 'Ayarlar', ur: 'ترتیبات', id: 'Pengaturan', pt: 'Definições'
  },
  'nav.help': {
    zh: '帮助', hi: 'सहायता', es: 'Ayuda', fr: 'Aide', ru: 'Помощь',
    tr: 'Yardım', ur: 'مدد', id: 'Bantuan', pt: 'Ajuda'
  },
  'nav.about': {
    zh: '关于', hi: 'हमारे बारे में', es: 'Acerca de', fr: 'À propos', ru: 'О нас',
    tr: 'Hakkında', ur: 'ہمارے بارے میں', id: 'Tentang', pt: 'Sobre'
  },

  'common.back': {
    zh: '返回', hi: 'वापस', es: 'Atrás', fr: 'Retour', ru: 'Назад',
    tr: 'Geri', ur: 'واپس', id: 'Kembali', pt: 'Voltar'
  },
  'common.cancel': {
    zh: '取消', hi: 'रद्द करें', es: 'Cancelar', fr: 'Annuler', ru: 'Отмена',
    tr: 'İptal', ur: 'منسوخ', id: 'Batal', pt: 'Cancelar'
  },
  'common.confirm': {
    zh: '确认', hi: 'पुष्टि करें', es: 'Confirmar', fr: 'Confirmer', ru: 'Подтвердить',
    tr: 'Onayla', ur: 'تصدیق', id: 'Konfirmasi', pt: 'Confirmar'
  },
  'common.done': {
    zh: '完成', hi: 'हो गया', es: 'Hecho', fr: 'Terminé', ru: 'Готово',
    tr: 'Tamam', ur: 'مکمل', id: 'Selesai', pt: 'Concluído'
  },
  'common.loading': {
    zh: '加载中…', hi: 'लोड हो रहा है…', es: 'Cargando…', fr: 'Chargement…', ru: 'Загрузка…',
    tr: 'Yükleniyor…', ur: 'لوڈ ہو رہا ہے…', id: 'Memuat…', pt: 'A carregar…'
  },
  'common.refresh': {
    zh: '刷新', hi: 'रिफ़्रेश', es: 'Actualizar', fr: 'Actualiser', ru: 'Обновить',
    tr: 'Yenile', ur: 'ریفریش', id: 'Segarkan', pt: 'Atualizar'
  },
  'common.language': {
    zh: '语言', hi: 'भाषा', es: 'Idioma', fr: 'Langue', ru: 'Язык',
    tr: 'Dil', ur: 'زبان', id: 'Bahasa', pt: 'Idioma'
  },
  'common.notAdvice': {
    zh: '市场数据仅供参考，不构成投资建议。加密资产波动剧烈，你可能损失全部本金。',
    hi: 'बाज़ार डेटा केवल जानकारी के लिए है, यह वित्तीय सलाह नहीं है। क्रिप्टो अस्थिर है — आप सब कुछ खो सकते हैं।',
    es: 'Los datos de mercado son solo informativos y no constituyen asesoramiento financiero. Las criptomonedas son volátiles: puedes perderlo todo.',
    fr: 'Les données de marché sont fournies à titre informatif et ne constituent pas un conseil financier. Les cryptos sont volatiles : vous pouvez tout perdre.',
    ru: 'Рыночные данные носят информационный характер и не являются финансовой рекомендацией. Криптовалюта волатильна — можно потерять всё.',
    tr: 'Piyasa verileri yalnızca bilgi amaçlıdır, yatırım tavsiyesi değildir. Kripto oynaktır — her şeyinizi kaybedebilirsiniz.',
    ur: 'مارکیٹ ڈیٹا صرف معلومات کے لیے ہے، مالی مشورہ نہیں۔ کرپٹو غیر مستحکم ہے — آپ سب کچھ کھو سکتے ہیں۔',
    id: 'Data pasar hanya bersifat informatif dan bukan nasihat keuangan. Kripto sangat fluktuatif — Anda bisa kehilangan semuanya.',
    pt: 'Os dados de mercado são apenas informativos e não constituem aconselhamento financeiro. As criptomoedas são voláteis: pode perder tudo.'
  },

  'welcome.title': {
    zh: '选择你的语言', hi: 'अपनी भाषा चुनें', es: 'Elige tu idioma', fr: 'Choisissez votre langue',
    ru: 'Выберите язык', tr: 'Dilinizi seçin', ur: 'اپنی زبان منتخب کریں',
    id: 'Pilih bahasa Anda', pt: 'Escolha o seu idioma'
  },
  'welcome.subtitle': {
    zh: '之后可以随时在设置中更改。',
    hi: 'आप इसे बाद में सेटिंग्स से कभी भी बदल सकते हैं।',
    es: 'Puedes cambiarlo en cualquier momento desde Ajustes.',
    fr: 'Vous pourrez le modifier à tout moment dans les réglages.',
    ru: 'Это можно изменить в любой момент в настройках.',
    tr: 'Bunu istediğiniz zaman Ayarlar\'dan değiştirebilirsiniz.',
    ur: 'آپ اسے کسی بھی وقت ترتیبات سے تبدیل کر سکتے ہیں۔',
    id: 'Anda dapat mengubahnya kapan saja di Pengaturan.',
    pt: 'Pode alterar isto a qualquer momento nas Definições.'
  },
  'welcome.continue': {
    zh: '继续', hi: 'जारी रखें', es: 'Continuar', fr: 'Continuer', ru: 'Продолжить',
    tr: 'Devam', ur: 'جاری رکھیں', id: 'Lanjutkan', pt: 'Continuar'
  },
  'welcome.partial': {
    zh: '主要界面已翻译；更专业的内容暂时显示英文。',
    hi: 'मुख्य स्क्रीन अनुवादित हैं; अधिक तकनीकी पाठ अभी अंग्रेज़ी में दिखेगा।',
    es: 'Las pantallas principales están traducidas; el texto más especializado aún aparece en inglés.',
    fr: 'Les écrans principaux sont traduits ; les textes plus spécialisés restent en anglais.',
    ru: 'Основные экраны переведены; более специальный текст пока на английском.',
    tr: 'Ana ekranlar çevrildi; daha teknik metinler şimdilik İngilizce görünür.',
    ur: 'بنیادی اسکرینیں ترجمہ شدہ ہیں؛ تکنیکی متن فی الحال انگریزی میں ہے۔',
    id: 'Layar utama sudah diterjemahkan; teks yang lebih teknis masih dalam bahasa Inggris.',
    pt: 'Os ecrãs principais estão traduzidos; o texto mais especializado ainda aparece em inglês.'
  },
  'welcome.full': {
    zh: '完整翻译', hi: 'पूर्ण अनुवाद', es: 'Traducción completa', fr: 'Traduction complète',
    ru: 'Полный перевод', tr: 'Tam çeviri', ur: 'مکمل ترجمہ', id: 'Terjemahan lengkap', pt: 'Tradução completa'
  },

  'onboarding.next': {
    zh: '继续', hi: 'आगे', es: 'Continuar', fr: 'Continuer', ru: 'Далее',
    tr: 'Devam', ur: 'آگے', id: 'Lanjut', pt: 'Continuar'
  },
  'onboarding.skip': {
    zh: '跳过', hi: 'छोड़ें', es: 'Omitir', fr: 'Passer', ru: 'Пропустить',
    tr: 'Atla', ur: 'چھوڑیں', id: 'Lewati', pt: 'Ignorar'
  },
  'onboarding.start': {
    zh: '开始使用', hi: 'शुरू करें', es: 'Empezar', fr: 'Commencer', ru: 'Начать',
    tr: 'Başla', ur: 'شروع کریں', id: 'Mulai', pt: 'Começar'
  },

  'guide.next': {
    zh: '下一步', hi: 'अगला', es: 'Siguiente', fr: 'Suivant', ru: 'Далее',
    tr: 'İleri', ur: 'اگلا', id: 'Berikutnya', pt: 'Seguinte'
  },
  'guide.back': {
    zh: '上一步', hi: 'पिछला', es: 'Anterior', fr: 'Précédent', ru: 'Назад',
    tr: 'Geri', ur: 'پچھلا', id: 'Sebelumnya', pt: 'Anterior'
  },
  'guide.done': {
    zh: '我已读完全部说明', hi: 'मैंने सभी निर्देश पढ़ लिए', es: 'He leído todas las instrucciones',
    fr: 'J\'ai lu toutes les instructions', ru: 'Я прочитал все инструкции',
    tr: 'Tüm açıklamaları okudum', ur: 'میں نے تمام ہدایات پڑھ لیں',
    id: 'Saya sudah membaca semua panduan', pt: 'Li todas as instruções'
  },
  'guide.language': {
    zh: '教程语言', hi: 'गाइड की भाषा', es: 'Idioma de la guía', fr: 'Langue du guide',
    ru: 'Язык руководства', tr: 'Kılavuz dili', ur: 'گائیڈ کی زبان',
    id: 'Bahasa panduan', pt: 'Idioma do guia'
  },

  'swap.title': {
    zh: '兑换', hi: 'स्वैप', es: 'Intercambiar', fr: 'Échanger', ru: 'Обмен',
    tr: 'Takas', ur: 'سویپ', id: 'Tukar', pt: 'Trocar'
  },
  'swap.searchToken': {
    zh: '搜索名称、代号或粘贴合约地址…',
    hi: 'नाम, प्रतीक खोजें या कॉन्ट्रैक्ट पता पेस्ट करें…',
    es: 'Busca por nombre, símbolo o pega una dirección…',
    fr: 'Rechercher un nom, un symbole ou coller une adresse…',
    ru: 'Поиск по названию, тикеру или вставьте адрес…',
    tr: 'Ad, sembol arayın veya sözleşme adresi yapıştırın…',
    ur: 'نام، علامت تلاش کریں یا کنٹریکٹ ایڈریس پیسٹ کریں…',
    id: 'Cari nama, simbol, atau tempel alamat kontrak…',
    pt: 'Pesquise nome, símbolo ou cole um endereço…'
  },
  'swap.gasBody': {
    zh: '网络费（Gas）始终以所在链的原生币支付，并从同一个钱包扣除——不只是 BNB。',
    hi: 'गैस हमेशा उसी नेटवर्क के मूल सिक्के में, उसी वॉलेट से चुकाई जाती है — केवल BNB नहीं।',
    es: 'El gas siempre se paga en la moneda nativa de la red y desde la misma cartera; no es solo BNB.',
    fr: 'Le gas est toujours payé dans la monnaie native du réseau, depuis le même portefeuille — pas seulement en BNB.',
    ru: 'Газ всегда оплачивается родной монетой сети из того же кошелька — не только BNB.',
    tr: 'Gas her zaman bulunduğunuz ağın yerel coini ile ve aynı cüzdandan ödenir — sadece BNB değil.',
    ur: 'گیس ہمیشہ اسی نیٹ ورک کے مقامی سکے میں اور اسی والٹ سے ادا ہوتی ہے — صرف BNB نہیں۔',
    id: 'Gas selalu dibayar dengan koin asli jaringan dari dompet yang sama — bukan hanya BNB.',
    pt: 'O gás é sempre pago na moeda nativa da rede, a partir da mesma carteira — não é só BNB.'
  },
  'swap.nonCustodialNotice': {
    zh: '非托管：每一笔交易都由你自己的钱包签名并发送，我们不持有你的资产，也没有任何充值地址。',
    hi: 'नॉन-कस्टोडियल: हर लेन-देन आपका अपना वॉलेट साइन और भेजता है। हम आपकी संपत्ति नहीं रखते और हमारा कोई डिपॉज़िट पता नहीं है।',
    es: 'No custodial: cada transacción la firma y envía tu propia cartera. No guardamos tus fondos ni tenemos dirección de depósito.',
    fr: 'Non dépositaire : chaque transaction est signée et envoyée par votre propre portefeuille. Nous ne détenons pas vos fonds.',
    ru: 'Некастодиальный сервис: каждую транзакцию подписывает и отправляет ваш кошелёк. Мы не храним ваши средства.',
    tr: 'Saklamasız: her işlemi kendi cüzdanınız imzalar ve gönderir. Varlıklarınızı tutmayız, yatırma adresimiz yoktur.',
    ur: 'نان کسٹوڈیل: ہر ٹرانزیکشن آپ کا اپنا والٹ سائن اور بھیجتا ہے۔ ہم آپ کے فنڈز نہیں رکھتے۔',
    id: 'Non-kustodial: setiap transaksi ditandatangani dan dikirim oleh dompet Anda sendiri. Kami tidak menyimpan dana Anda.',
    pt: 'Não custodial: cada transação é assinada e enviada pela sua própria carteira. Não guardamos os seus fundos.'
  },
  'swap.verifyContracts': {
    zh: '代币出现在列表中并不代表我们背书。兑换前请对照项目官网核对合约地址。',
    hi: 'सूची में होना हमारी सिफ़ारिश नहीं है। स्वैप से पहले प्रोजेक्ट की आधिकारिक साइट से कॉन्ट्रैक्ट पता मिलाएँ।',
    es: 'Aparecer en la lista no es un aval. Verifica la dirección del contrato en el sitio oficial antes de intercambiar.',
    fr: 'Figurer dans une liste n\'est pas une recommandation. Vérifiez l\'adresse du contrat sur le site officiel avant d\'échanger.',
    ru: 'Наличие в списке — не рекомендация. Сверьте адрес контракта с официальным сайтом проекта.',
    tr: 'Listede olmak onay anlamına gelmez. Takas öncesi sözleşme adresini projenin resmi sitesinden doğrulayın.',
    ur: 'فہرست میں ہونا توثیق نہیں۔ سویپ سے پہلے کنٹریکٹ ایڈریس آفیشل سائٹ سے ملائیں۔',
    id: 'Ada di daftar bukan berarti kami merekomendasikan. Verifikasi alamat kontrak di situs resmi sebelum menukar.',
    pt: 'Estar numa lista não é um aval. Verifique o endereço do contrato no site oficial antes de trocar.'
  },
  'swap.review': {
    zh: '查看并确认', hi: 'समीक्षा करें', es: 'Revisar', fr: 'Vérifier', ru: 'Проверить',
    tr: 'İncele', ur: 'جائزہ لیں', id: 'Tinjau', pt: 'Rever'
  },
  'swap.confirmSwap': {
    zh: '确认兑换', hi: 'स्वैप की पुष्टि करें', es: 'Confirmar intercambio', fr: 'Confirmer l\'échange',
    ru: 'Подтвердить обмен', tr: 'Takası onayla', ur: 'سویپ کی تصدیق', id: 'Konfirmasi tukar', pt: 'Confirmar troca'
  },

  'wallet.connect': {
    zh: '连接钱包', hi: 'वॉलेट कनेक्ट करें', es: 'Conectar cartera', fr: 'Connecter le portefeuille',
    ru: 'Подключить кошелёк', tr: 'Cüzdan bağla', ur: 'والٹ منسلک کریں',
    id: 'Hubungkan dompet', pt: 'Ligar carteira'
  },

  'news.title': {
    zh: '加密新闻', hi: 'क्रिप्टो समाचार', es: 'Noticias cripto', fr: 'Actualités crypto',
    ru: 'Крипто-новости', tr: 'Kripto haberleri', ur: 'کرپٹو خبریں', id: 'Berita kripto', pt: 'Notícias cripto'
  },
  'news.subtitle': {
    zh: '每 24 小时更新一次', hi: 'हर 24 घंटे में अपडेट', es: 'Se actualiza cada 24 horas',
    fr: 'Actualisé toutes les 24 heures', ru: 'Обновляется каждые 24 часа',
    tr: '24 saatte bir güncellenir', ur: 'ہر ٢٤ گھنٹے بعد اپ ڈیٹ', id: 'Diperbarui setiap 24 jam',
    pt: 'Atualizado a cada 24 horas'
  },

  'predict.riskNotice': {
    zh: '本页仅使用虚拟额度，无法接入真实资金。以真实资金进行的短期涨跌押注（二元期权）在伊朗法律下被禁止，在英国和欧盟也对散户禁止。这里的内容只用于理解机制。',
    hi: 'यह स्क्रीन केवल वर्चुअल क्रेडिट पर चलती है; इसमें असली पैसा नहीं जोड़ा जा सकता। असली पैसे से अल्पकालिक ऊपर/नीचे सट्टा ईरानी कानून में प्रतिबंधित है और यूके व ईयू में खुदरा ग्राहकों के लिए भी प्रतिबंधित है।',
    es: 'Esta pantalla funciona solo con crédito virtual; no se pueden conectar fondos reales. Las apuestas a corto plazo sobre el precio con dinero real están prohibidas por la ley iraní y también para minoristas en el Reino Unido y la UE.',
    fr: 'Cet écran fonctionne uniquement avec du crédit virtuel ; aucun fonds réel ne peut y être connecté. Les paris à court terme sur le prix avec de l\'argent réel sont interdits par la loi iranienne et aux particuliers au Royaume-Uni et dans l\'UE.',
    ru: 'Экран работает только с виртуальными кредитами; реальные средства подключить нельзя. Краткосрочные ставки на направление цены на реальные деньги запрещены законом Ирана, а также для розничных клиентов в Великобритании и ЕС.',
    tr: 'Bu ekran yalnızca sanal kredi ile çalışır; gerçek para bağlanamaz. Gerçek parayla kısa vadeli yön bahsi İran yasalarında yasaktır; Birleşik Krallık ve AB\'de de bireysel yatırımcılara yasaktır.',
    ur: 'یہ اسکرین صرف ورچوئل کریڈٹ پر چلتی ہے؛ اصل رقم منسلک نہیں ہو سکتی۔ اصل پیسے سے قلیل مدتی شرط ایرانی قانون میں ممنوع ہے۔',
    id: 'Layar ini hanya berjalan dengan kredit virtual; dana nyata tidak dapat dihubungkan. Taruhan arah harga jangka pendek dengan uang nyata dilarang oleh hukum Iran dan juga bagi ritel di Inggris dan UE.',
    pt: 'Este ecrã funciona apenas com crédito virtual; não é possível ligar fundos reais. As apostas de curto prazo na direção do preço com dinheiro real são proibidas pela lei iraniana e também a retalho no Reino Unido e na UE.'
  }
};

const LANGS = ['zh', 'hi', 'es', 'fr', 'ru', 'tr', 'ur', 'id', 'pt'];

function setPath(obj, dotted, value) {
  const parts = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    cur[parts[i]] ??= {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

for (const lang of LANGS) {
  const json = {};
  for (const [key, byLang] of Object.entries(CORE)) {
    if (byLang[lang]) setPath(json, key, byLang[lang]);
  }
  writeFileSync(out(lang), `${JSON.stringify(json, null, 2)}\n`);
  console.log(`wrote ${lang}.json (${Object.keys(CORE).filter((k) => CORE[k][lang]).length} keys)`);
}
