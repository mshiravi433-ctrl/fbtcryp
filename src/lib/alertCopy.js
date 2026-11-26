/**
 * ONE LOCALISATION TABLE FOR EVERY ALERT, ON BOTH SIDES OF THE WIRE.
 *
 * The server builds order / intent cards and the browser previews the same
 * tones. They used to keep two unrelated copies of the sentence table: the
 * server knew eleven languages for scheduled plans but only three for the
 * stage cards, while the preview knew exactly two. A user who picked Hindi
 * therefore got a Hindi app and an English or Persian notification — which is
 * the one kind of bug nobody reports, because the card still looks plausible.
 *
 * Every string below is plain text with {base}/{quote}/{rate} placeholders;
 * the transports only substitute those three. `normalizeAlertLang` accepts
 * regional tags ('en-US', 'fa-IR') because the browser and Telegram send both.
 */

export const ALERT_LANGS = ['fa', 'en', 'ar', 'es', 'fr', 'hi', 'id', 'pt', 'ru', 'tr', 'ur', 'zh'];

export function normalizeAlertLang(lang) {
  const code = String(lang || 'en').toLowerCase().replace('_', '-').split('-')[0];
  return ALERT_LANGS.includes(code) ? code : 'en';
}

export const ORDER_COPY = {
  en: {
    pending: { title: 'Position pending', body: '{base}→{quote} is waiting. We will alert you when the target is hit.' },
    ready: { title: 'Target reached — ready to swap', body: '1 {base} reached {rate} {quote}. Open the app to swap.' },
    closed: { title: 'Position closed', body: '{base}→{quote} is closed.' }
  },
  fa: {
    pending: { title: 'پوزیشن در انتظار', body: '{base}→{quote} ثبت شد و در انتظار است. با رسیدن به هدف خبر می‌دهیم.' },
    ready: { title: 'به نتیجه رسید — آمادهٔ سواپ', body: '۱ {base} به {rate} {quote} رسید. برای سواپ اپ را باز کن.' },
    closed: { title: 'پوزیشن بسته شد', body: '{base}→{quote} بسته شد.' }
  },
  ar: {
    pending: { title: 'مركز في الانتظار', body: '{base}→{quote} بانتظار الهدف.' },
    ready: { title: 'تحقق الهدف — جاهز للمبادلة', body: '1 {base} وصل إلى {rate} {quote}. افتح التطبيق.' },
    closed: { title: 'أُغلق المركز', body: '{base}→{quote} أُغلق.' }
  },
  es: {
    pending: { title: 'Posición pendiente', body: '{base}→{quote} está esperando. Te avisaremos al alcanzar el objetivo.' },
    ready: { title: 'Objetivo alcanzado — listo para cambiar', body: '1 {base} alcanzó {rate} {quote}. Abre la app para cambiar.' },
    closed: { title: 'Posición cerrada', body: '{base}→{quote} se cerró.' }
  },
  fr: {
    pending: { title: 'Position en attente', body: '{base}→{quote} attend l’objectif. Nous vous préviendrons.' },
    ready: { title: 'Objectif atteint — prêt à échanger', body: '1 {base} a atteint {rate} {quote}. Ouvrez l’app pour échanger.' },
    closed: { title: 'Position clôturée', body: '{base}→{quote} est clôturée.' }
  },
  hi: {
    pending: { title: 'स्थिति लंबित', body: '{base}→{quote} लक्ष्य की प्रतीक्षा में है। लगने पर सूचित करेंगे।' },
    ready: { title: 'लक्ष्य पूरा — स्वैप के लिए तैयार', body: '1 {base} ने {rate} {quote} पार किया। स्वैप के लिए ऐप खोलें।' },
    closed: { title: 'स्थिति बंद', body: '{base}→{quote} बंद हो गई।' }
  },
  id: {
    pending: { title: 'Posisi tertunda', body: '{base}→{quote} menunggu target. Kami akan memberi tahu Anda.' },
    ready: { title: 'Target tercapai — siap swap', body: '1 {base} mencapai {rate} {quote}. Buka aplikasi untuk swap.' },
    closed: { title: 'Posisi ditutup', body: '{base}→{quote} telah ditutup.' }
  },
  pt: {
    pending: { title: 'Posição pendente', body: '{base}→{quote} está aguardando. Avisaremos quando atingir o alvo.' },
    ready: { title: 'Alvo atingido — pronto para trocar', body: '1 {base} chegou a {rate} {quote}. Abra o app para trocar.' },
    closed: { title: 'Posição fechada', body: '{base}→{quote} foi fechada.' }
  },
  ru: {
    pending: { title: 'Позиция ожидает', body: '{base}→{quote} ждёт цели. Мы сообщим о достижении.' },
    ready: { title: 'Цель достигнута — готово к обмену', body: '1 {base} достиг {rate} {quote}. Откройте приложение для обмена.' },
    closed: { title: 'Позиция закрыта', body: '{base}→{quote} закрыта.' }
  },
  tr: {
    pending: { title: 'Pozisyon bekliyor', body: '{base}→{quote} hedefi bekliyor. Ulaşıldığında haber vereceğiz.' },
    ready: { title: 'Hedefe ulaşıldı — takas hazır', body: '1 {base}, {rate} {quote} seviyesine ulaştı. Takas için uygulamayı aç.' },
    closed: { title: 'Pozisyon kapatıldı', body: '{base}→{quote} kapatıldı.' }
  },
  ur: {
    pending: { title: 'پوزیشن زیر التوا', body: '{base}→{quote} ہدف کا منتظر ہے۔ ہدف ملنے پر آپ کو بتائیں گے۔' },
    ready: { title: 'ہدف پورا — سواپ کے لیے تیار', body: '1 {base} نے {rate} {quote} کا ہدف حاصل کیا۔ سواپ کے لیے ایپ کھولیں۔' },
    closed: { title: 'پوزیشن بند', body: '{base}→{quote} بند ہو گئی۔' }
  },
  zh: {
    pending: { title: '仓位等待中', body: '{base}→{quote} 正在等待目标价，达到时会通知你。' },
    ready: { title: '目标已达 — 可以兑换', body: '1 {base} 达到 {rate} {quote}。打开应用完成兑换。' },
    closed: { title: '仓位已关闭', body: '{base}→{quote} 已关闭。' }
  }
};

export const INTENT_COPY = {
  en: {
    pending: { title: 'Intent pending', body: 'A new intent for {base}→{quote} is waiting.' },
    ready: { title: 'Desired result reached', body: 'The intent for {base}→{quote} is ready to complete.' },
    closed: { title: 'Intent position closed', body: '{base}→{quote} has settled and the position is closed.' }
  },
  fa: {
    pending: { title: 'اینتنت در انتظار', body: 'اینتنت جدید {base}→{quote} در انتظار است.' },
    ready: { title: 'رسیدن به نتیجهٔ دلخواه', body: 'اینتنت {base}→{quote} به نتیجه رسید و آمادهٔ تکمیل است.' },
    closed: { title: 'پوزیشن اینتنت بسته شد', body: '{base}→{quote} تسویه و بسته شد.' }
  },
  ar: {
    pending: { title: 'النية في الانتظار', body: 'نية {base}→{quote} بانتظار التنفيذ.' },
    ready: { title: 'تحقق النتيجة المطلوبة', body: 'النية {base}→{quote} جاهزة للإكمال.' },
    closed: { title: 'أُغلق مركز النية', body: '{base}→{quote} أُغلق.' }
  },
  es: {
    pending: { title: 'Intención pendiente', body: 'Una nueva intención para {base}→{quote} está esperando.' },
    ready: { title: 'Resultado deseado alcanzado', body: 'La intención {base}→{quote} está lista para completarse.' },
    closed: { title: 'Posición de intención cerrada', body: '{base}→{quote} se liquidó y la posición se cerró.' }
  },
  fr: {
    pending: { title: 'Intention en attente', body: 'Une nouvelle intention {base}→{quote} attend.' },
    ready: { title: 'Résultat souhaité atteint', body: 'L’intention {base}→{quote} est prête à être finalisée.' },
    closed: { title: 'Position d’intention clôturée', body: '{base}→{quote} est réglée et la position est clôturée.' }
  },
  hi: {
    pending: { title: 'इरादा लंबित', body: '{base}→{quote} के लिए नया इरादा प्रतीक्षा में है।' },
    ready: { title: 'वांछित परिणाम मिला', body: '{base}→{quote} का इरादा पूरा करने के लिए तैयार है।' },
    closed: { title: 'इरादा स्थिति बंद', body: '{base}→{quote} निपट गया और स्थिति बंद हो गई।' }
  },
  id: {
    pending: { title: 'Niat tertunda', body: 'Niat baru untuk {base}→{quote} sedang menunggu.' },
    ready: { title: 'Hasil yang diinginkan tercapai', body: 'Niat {base}→{quote} siap diselesaikan.' },
    closed: { title: 'Posisi niat ditutup', body: '{base}→{quote} telah selesai dan posisi ditutup.' }
  },
  pt: {
    pending: { title: 'Intenção pendente', body: 'Uma nova intenção para {base}→{quote} está aguardando.' },
    ready: { title: 'Resultado desejado alcançado', body: 'A intenção {base}→{quote} está pronta para concluir.' },
    closed: { title: 'Posição de intenção fechada', body: '{base}→{quote} foi liquidada e a posição foi fechada.' }
  },
  ru: {
    pending: { title: 'Намерение ожидает', body: 'Новое намерение для {base}→{quote} ожидает.' },
    ready: { title: 'Желаемый результат достигнут', body: 'Намерение {base}→{quote} готово к завершению.' },
    closed: { title: 'Позиция намерения закрыта', body: '{base}→{quote} урегулировано, позиция закрыта.' }
  },
  tr: {
    pending: { title: 'Niyet bekliyor', body: '{base}→{quote} için yeni bir niyet bekliyor.' },
    ready: { title: 'İstenen sonuç gerçekleşti', body: '{base}→{quote} niyeti tamamlanmaya hazır.' },
    closed: { title: 'Niyet pozisyonu kapatıldı', body: '{base}→{quote} sonuçlandı ve pozisyon kapatıldı.' }
  },
  ur: {
    pending: { title: 'ارادہ زیر التوا', body: '{base}→{quote} کے لیے نیا ارادہ منتظر ہے۔' },
    ready: { title: 'مطلوبہ نتیجہ حاصل', body: '{base}→{quote} کا ارادہ مکمل کرنے کے لیے تیار ہے۔' },
    closed: { title: 'ارادے کی پوزیشن بند', body: '{base}→{quote} طے پا گیا اور پوزیشن بند ہو گئی۔' }
  },
  zh: {
    pending: { title: '意图等待中', body: '{base}→{quote} 的新意图正在等待。' },
    ready: { title: '已达成预期结果', body: '{base}→{quote} 的意图已完成，等待确认。' },
    closed: { title: '意图仓位已关闭', body: '{base}→{quote} 已结算，仓位已关闭。' }
  }
};

export const FILLED_COPY = {
  fa: { title: 'سفارش حد پر شد', body: 'سفارش حد شما با موفقیت در قیمت هدف پر شد.' },
  en: { title: 'Limit order filled', body: 'Your limit order was filled at the target price.' },
  ar: { title: 'تم تنفيذ أمر الحد', body: 'تم تنفيذ أمر الحد الخاص بك بنجاح عند السعر المستهدف.' },
  es: { title: 'Orden límite ejecutada', body: 'Tu orden límite se ejecutó al precio objetivo.' },
  fr: { title: 'Ordre à cours limité exécuté', body: 'Votre ordre a été exécuté au prix cible.' },
  hi: { title: 'लिमिट ऑर्डर पूरा', body: 'आपका लिमिट ऑर्डर लक्ष्य कीमत पर पूरा हुआ।' },
  id: { title: 'Order limit terisi', body: 'Order limit Anda terisi pada harga target.' },
  pt: { title: 'Ordem limitada executada', body: 'Sua ordem limitada foi executada no preço alvo.' },
  ru: { title: 'Лимитный ордер исполнен', body: 'Ваш лимитный ордер исполнен по целевой цене.' },
  tr: { title: 'Limit emri gerçekleşti', body: 'Limit emriniz hedef fiyatta gerçekleşti.' },
  ur: { title: 'لمٹ آرڈر پورا', body: 'آپ کا لمٹ آرڈر ہدفی قیمت پر پورا ہوا۔' },
  zh: { title: '限价单已成交', body: '你的限价单已按目标价格成交。' }
};

export const PREVIEW_COPY = {
  fa: {
    profit: { title: 'به هدف رسید — سود', body: 'پوزیشن BTC→USDT با سود بسته شد.' },
    loss: { title: 'حد ضرر فعال شد', body: 'پوزیشن ETH→USDT با ضرر بسته شد.' },
    pending: { title: 'سفارش خودکار در انتظار', body: 'BTC→USDT ثبت شد. با رسیدن به هدف خبر می\u200cدهیم.' },
    ready: { title: 'آمادهٔ سواپ', body: 'اتوماسیون شما به نتیجه رسید. برای امضا اپ را باز کن.' },
    alert: { title: 'هشدار امنیتی', body: 'یک درخواست امضا در انتظار تأیید شماست.' },
    info: { title: 'خلاصهٔ روزانهٔ FBT', body: 'بازار امروز را ببین؛ همه\u200cچیز در یک نگاه.' }
  },
  en: {
    profit: { title: 'Target reached — in profit', body: 'Your BTC→USDT position closed in profit.' },
    loss: { title: 'Stop-loss triggered', body: 'Your ETH→USDT position closed at a loss.' },
    pending: { title: 'Automation pending', body: 'BTC→USDT is set. We will alert you when it targets.' },
    ready: { title: 'Ready to swap', body: 'Your automation reached its result. Tap to sign.' },
    alert: { title: 'Security alert', body: 'A signing request is waiting for your approval.' },
    info: { title: 'FBT daily digest', body: 'See today’s market at a glance.' }
  },
  ar: {
    profit: { title: 'تحقق الهدف — ربح', body: 'أُغلق مركز BTC→USDT بربح.' },
    loss: { title: 'تفعيل وقف الخسارة', body: 'أُغلق مركز ETH→USDT بخسارة.' },
    pending: { title: 'أتمتة في الانتظار', body: 'تم ضبط BTC→USDT. سنخبرك عند بلوغ الهدف.' },
    ready: { title: 'جاهز للمبادلة', body: 'وصلت أتمتتك إلى النتيجة. افتح التطبيق للتوقيع.' },
    alert: { title: 'تنبيه أمني', body: 'هناك طلب توقيع بانتظار موافقتك.' },
    info: { title: 'ملخص FBT اليومي', body: 'اطّلع على السوق اليوم في لمحة.' }
  },
  es: {
    profit: { title: 'Objetivo alcanzado — ganancia', body: 'Tu posición BTC→USDT se cerró con ganancia.' },
    loss: { title: 'Se activó el stop-loss', body: 'Tu posición ETH→USDT se cerró con pérdida.' },
    pending: { title: 'Automatización pendiente', body: 'BTC→USDT está configurado. Te avisaremos al llegar al objetivo.' },
    ready: { title: 'Listo para cambiar', body: 'Tu automatización llegó al resultado. Toca para firmar.' },
    alert: { title: 'Alerta de seguridad', body: 'Hay una solicitud de firma esperando tu aprobación.' },
    info: { title: 'Resumen diario de FBT', body: 'Mira el mercado de hoy de un vistazo.' }
  },
  fr: {
    profit: { title: 'Objectif atteint — bénéfice', body: 'Votre position BTC→USDT s’est clôturée avec un gain.' },
    loss: { title: 'Stop-loss déclenché', body: 'Votre position ETH→USDT s’est clôturée à perte.' },
    pending: { title: 'Automatisation en attente', body: 'BTC→USDT est configuré. Nous vous préviendrons à l’objectif.' },
    ready: { title: 'Prêt à échanger', body: 'Votre automatisation a atteint son résultat. Touchez pour signer.' },
    alert: { title: 'Alerte de sécurité', body: 'Une demande de signature attend votre approbation.' },
    info: { title: 'Résumé quotidien FBT', body: 'Le marché du jour en un coup d’œil.' }
  },
  hi: {
    profit: { title: 'लक्ष्य पूरा — लाभ', body: 'आपकी BTC→USDT स्थिति लाभ में बंद हुई।' },
    loss: { title: 'स्टॉप-लॉस चालू', body: 'आपकी ETH→USDT स्थिति नुकसान में बंद हुई।' },
    pending: { title: 'स्वचालन लंबित', body: 'BTC→USDT सेट है। लक्ष्य मिलने पर सूचित करेंगे।' },
    ready: { title: 'स्वैप के लिए तैयार', body: 'आपके स्वचालन ने परिणाम दिया। हस्ताक्षर के लिए टैप करें।' },
    alert: { title: 'सुरक्षा चेतावनी', body: 'एक हस्ताक्षर अनुरोध आपके अनुमोदन की प्रतीक्षा में है।' },
    info: { title: 'FBT दैनिक सारांश', body: 'आज का बाज़ार एक नज़र में देखें।' }
  },
  id: {
    profit: { title: 'Target tercapai — untung', body: 'Posisi BTC→USDT Anda ditutup dengan untung.' },
    loss: { title: 'Stop-loss aktif', body: 'Posisi ETH→USDT Anda ditutup dengan rugi.' },
    pending: { title: 'Otomatisasi tertunda', body: 'BTC→USDT sudah disetel. Kami akan memberi tahu saat target tercapai.' },
    ready: { title: 'Siap swap', body: 'Otomatisasi Anda mencapai hasilnya. Ketuk untuk menandatangani.' },
    alert: { title: 'Peringatan keamanan', body: 'Ada permintaan tanda tangan yang menunggu persetujuan Anda.' },
    info: { title: 'Ringkasan harian FBT', body: 'Lihat pasar hari ini sekilas.' }
  },
  pt: {
    profit: { title: 'Alvo atingido — lucro', body: 'Sua posição BTC→USDT fechou com lucro.' },
    loss: { title: 'Stop-loss atingido', body: 'Sua posição ETH→USDT fechou com prejuízo.' },
    pending: { title: 'Automação pendente', body: 'BTC→USDT configurado. Avisaremos quando atingir o alvo.' },
    ready: { title: 'Pronto para trocar', body: 'Sua automação chegou ao resultado. Toque para assinar.' },
    alert: { title: 'Alerta de segurança', body: 'Há uma solicitação de assinatura aguardando sua aprovação.' },
    info: { title: 'Resumo diário FBT', body: 'Veja o mercado de hoje num relance.' }
  },
  ru: {
    profit: { title: 'Цель достигнута — прибыль', body: 'Ваша позиция BTC→USDT закрыта с прибылью.' },
    loss: { title: 'Сработал стоп-лосс', body: 'Ваша позиция ETH→USDT закрыта с убытком.' },
    pending: { title: 'Автоматизация ожидает', body: 'BTC→USDT настроен. Сообщим о достижении цели.' },
    ready: { title: 'Готово к обмену', body: 'Автоматизация достигла результата. Нажмите для подписи.' },
    alert: { title: 'Предупреждение безопасности', body: 'Запрос на подпись ждёт вашего подтверждения.' },
    info: { title: 'Ежедневный обзор FBT', body: 'Рынок сегодня с первого взгляда.' }
  },
  tr: {
    profit: { title: 'Hedef gerçekleşti — kâr', body: 'BTC→USDT pozisyonunuz kârla kapatıldı.' },
    loss: { title: 'Zarar durdurma tetiklendi', body: 'ETH→USDT pozisyonunuz zararla kapatıldı.' },
    pending: { title: 'Otomasyon bekliyor', body: 'BTC→USDT ayarlandı. Hedefe ulaşınca haber vereceğiz.' },
    ready: { title: 'Takas için hazır', body: 'Otomasyonunuz sonuca ulaştı. İmzalamak için dokunun.' },
    alert: { title: 'Güvenlik uyarısı', body: 'Onayınızı bekleyen bir imza isteği var.' },
    info: { title: 'FBT günlük özeti', body: 'Bugünün piyasasına bir bakış.' }
  },
  ur: {
    profit: { title: 'ہدف پورا — منافع', body: 'آپ کی BTC→USDT پوزیشن منافع کے ساتھ بند ہوئی۔' },
    loss: { title: 'اسٹاپ لاس چالو', body: 'آپ کی ETH→USDT پوزیشن نقصان کے ساتھ بند ہوئی۔' },
    pending: { title: 'خودکار سسٹم التوا میں', body: 'BTC→USDT سیٹ ہے۔ ہدف ملنے پر آپ کو بتائیں گے۔' },
    ready: { title: 'سواپ کے لیے تیار', body: 'آپ کے خودکار سسٹم نے نتیجہ دیا۔ دستخط کے لیے ٹیپ کریں۔' },
    alert: { title: 'سیکیورٹی الرٹ', body: 'ایک دستخطی درخواست آپ کی منظوری کا منتظر ہے۔' },
    info: { title: 'FBT روزانہ خلاصہ', body: 'آج کی مارکیٹ ایک نظر میں دیکھیں۔' }
  },
  zh: {
    profit: { title: '目标已达 — 盈利', body: '你的 BTC→USDT 仓位已盈利平仓。' },
    loss: { title: '止损已触发', body: '你的 ETH→USDT 仓位已亏损平仓。' },
    pending: { title: '自动化等待中', body: 'BTC→USDT 已设置，达到目标时会通知你。' },
    ready: { title: '可以兑换了', body: '自动化已达到结果。点击签名。' },
    alert: { title: '安全提醒', body: '有一笔签名请求等待你批准。' },
    info: { title: 'FBT 每日摘要', body: '一眼了解今天的市场。' }
  }
};

export function alertCopy(table, lang, key, fallbackKey = 'en') {
  const pack = table[normalizeAlertLang(lang)] || table[fallbackKey] || table.en;
  return pack[key] || table.en[key] || {};
}
