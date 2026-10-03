#!/usr/bin/env python3
"""
Add the "open positions" copy (item 4) to all twelve locales.

Targeted text insertion rather than a json.load/json.dump round trip: these
files are hand-formatted with two-space indentation and a full dump rewrites
every line, which turns a twelve-key addition into a 10 000-line diff nobody
can review. The insertion point is the opening brace of the `perp` object and
the sibling `dydx` object, both matched at their exact indentation.

Run:  python3 scripts/add-positions-copy.py
Idempotent: refuses to run twice (it checks for the marker key first).
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCALES = sorted((ROOT / 'src' / 'i18n' / 'locales').glob('*.json'))

# English is the source of truth for the shape; every other locale must carry
# the same key set or the screen falls back mid-sentence.
POSITIONS = {
    'en': {
        'title': 'Open positions',
        'sub': 'Live from the venues',
        'count': '{n} open',
        'reading': 'Reading your positions…',
        'unavailable': 'The venue did not answer. Your position is untouched — this is only a read.',
        'empty': 'No open position right now.',
        'entry': 'Entry',
        'mark': 'Mark',
        'size': 'Size',
        'pnl': 'P&L',
        'risk': 'TP / SL',
        'howMuch': 'How much do you want to close?',
        'all': 'All',
        'close': 'Close position',
        'closing': 'Closing…',
        'confirm': 'Close {pct}% and sign',
        'sent': 'Close submitted:',
        'noWallet': 'Connect a wallet to see your open positions.',
        'venue': {'solana': 'Solana', 'evm': 'Arbitrum'},
        'err': {'USER_REJECTED': 'You cancelled the signature. The position is untouched.',
        'err.WALLET_NOT_CONNECTED': 'Connect the wallet that owns this position.',
        'err.NO_POSITION': 'The venue no longer has this position — it may already be closed.',
        'err.INVALID_INPUT': 'The venue refused that amount. Try a larger close percentage.',
        'err.BROADCAST_FAILED': 'The signature was made but the transaction was not accepted. Nothing changed.',
        'err.PROVIDER_UNAVAILABLE': 'The venue is not answering right now. Try again in a moment.'
    },
    'fa': {
        'title': 'پوزیشن‌های باز',
        'sub': 'زنده از خود صرافی‌ها',
        'count': '{n} پوزیشن باز',
        'reading': 'در حال خواندن پوزیشن‌ها…',
        'unavailable': 'صرافی پاسخ نداد. پوزیشن شما دست‌نخورده است — این فقط یک خواندن بود.',
        'empty': 'الان پوزیشن بازی ندارید.',
        'entry': 'ورود',
        'mark': 'قیمت فعلی',
        'size': 'حجم',
        'pnl': 'سود / زیان',
        'risk': 'حد سود / حد ضرر',
        'howMuch': 'چقدر می‌خواهید ببندید؟',
        'all': 'همه',
        'close': 'بستن پوزیشن',
        'closing': 'در حال بستن…',
        'confirm': 'بستن {pct}٪ و امضا',
        'sent': 'دستور بستن ثبت شد:',
        'noWallet': 'برای دیدن پوزیشن‌های باز، کیف پول را وصل کنید.',
        'venue.solana': 'سولانا',
        'venue.evm': 'آربیتروم',
        'err.USER_REJECTED': 'امضا را لغو کردید. پوزیشن دست‌نخورده است.',
        'err.WALLET_NOT_CONNECTED': 'کیف پولی که صاحب این پوزیشن است را وصل کنید.',
        'err.NO_POSITION': 'صرافی دیگر این پوزیشن را ندارد — احتمالاً قبلاً بسته شده.',
        'err.INVALID_INPUT': 'صرافی این مقدار را نپذیرفت. درصد بزرگ‌تری را امتحان کنید.',
        'err.BROADCAST_FAILED': 'امضا انجام شد اما تراکنش پذیرفته نشد. چیزی تغییر نکرد.',
        'err.PROVIDER_UNAVAILABLE': 'صرافی الان پاسخ نمی‌دهد. کمی بعد دوباره تلاش کنید.'
    },
    'ar': {
        'title': 'المراكز المفتوحة',
        'sub': 'مباشر من المنصات',
        'count': '{n} مفتوح',
        'reading': 'جارٍ قراءة مراكزك…',
        'unavailable': 'لم تستجب المنصة. مركزك كما هو — هذه قراءة فقط.',
        'empty': 'لا يوجد مركز مفتوح الآن.',
        'entry': 'الدخول',
        'mark': 'السعر الحالي',
        'size': 'الحجم',
        'pnl': 'الربح / الخسارة',
        'risk': 'جني الربح / وقف الخسارة',
        'howMuch': 'كم تريد أن تغلق؟',
        'all': 'الكل',
        'close': 'إغلاق المركز',
        'closing': 'جارٍ الإغلاق…',
        'confirm': 'إغلاق {pct}٪ والتوقيع',
        'sent': 'تم إرسال أمر الإغلاق:',
        'noWallet': 'اربط محفظة لعرض مراكزك المفتوحة.',
        'venue.solana': 'سولانا',
        'venue.evm': 'أربيتروم',
        'err.USER_REJECTED': 'ألغيت التوقيع. المركز كما هو.',
        'err.WALLET_NOT_CONNECTED': 'اربط المحفظة التي تملك هذا المركز.',
        'err.NO_POSITION': 'لم تعد المنصة تملك هذا المركز — ربما أُغلق سابقًا.',
        'err.INVALID_INPUT': 'رفضت المنصة هذا المقدار. جرّب نسبة إغلاق أكبر.',
        'err.BROADCAST_FAILED': 'تم التوقيع لكن المعاملة لم تُقبل. لم يتغير شيء.',
        'err.PROVIDER_UNAVAILABLE': 'المنصة لا تستجيب الآن. أعد المحاولة بعد قليل.'
    },
    'es': {
        'title': 'Posiciones abiertas',
        'sub': 'En vivo desde las plataformas',
        'count': '{n} abiertas',
        'reading': 'Leyendo tus posiciones…',
        'unavailable': 'La plataforma no respondió. Tu posición está intacta: esto solo era una lectura.',
        'empty': 'Ahora mismo no tienes posiciones abiertas.',
        'entry': 'Entrada',
        'mark': 'Mercado',
        'size': 'Tamaño',
        'pnl': 'G/P',
        'risk': 'TP / SL',
        'howMuch': '¿Cuánto quieres cerrar?',
        'all': 'Todo',
        'close': 'Cerrar posición',
        'closing': 'Cerrando…',
        'confirm': 'Cerrar {pct}% y firmar',
        'sent': 'Cierre enviado:',
        'noWallet': 'Conecta una cartera para ver tus posiciones abiertas.',
        'venue': {'solana': 'Solana', 'evm': 'Arbitrum'},
        'err': {'USER_REJECTED': 'Cancelaste la firma. La posición está intacta.',
        'err.WALLET_NOT_CONNECTED': 'Conecta la cartera dueña de esta posición.',
        'err.NO_POSITION': 'La plataforma ya no tiene esta posición: puede estar cerrada.',
        'err.INVALID_INPUT': 'La plataforma rechazó ese importe. Prueba un porcentaje mayor.',
        'err.BROADCAST_FAILED': 'Se firmó, pero la transacción no se aceptó. Nada cambió.',
        'err.PROVIDER_UNAVAILABLE': 'La plataforma no responde ahora. Inténtalo en un momento.'
    },
    'fr': {
        'title': 'Positions ouvertes',
        'sub': 'En direct des plateformes',
        'count': '{n} ouverte(s)',
        'reading': 'Lecture de vos positions…',
        'unavailable': 'La plateforme n’a pas répondu. Votre position est intacte — ceci n’était qu’une lecture.',
        'empty': 'Aucune position ouverte pour le moment.',
        'entry': 'Entrée',
        'mark': 'Cours',
        'size': 'Taille',
        'pnl': 'G/P',
        'risk': 'TP / SL',
        'howMuch': 'Combien voulez-vous clôturer ?',
        'all': 'Tout',
        'close': 'Clôturer la position',
        'closing': 'Clôture…',
        'confirm': 'Clôturer {pct} % et signer',
        'sent': 'Clôture envoyée :',
        'noWallet': 'Connectez un portefeuille pour voir vos positions ouvertes.',
        'venue': {'solana': 'Solana', 'evm': 'Arbitrum'},
        'err': {'USER_REJECTED': 'Vous avez annulé la signature. La position est intacte.',
        'err.WALLET_NOT_CONNECTED': 'Connectez le portefeuille propriétaire de cette position.',
        'err.NO_POSITION': 'La plateforme n’a plus cette position — elle est peut-être déjà clôturée.',
        'err.INVALID_INPUT': 'La plateforme a refusé ce montant. Essayez un pourcentage plus élevé.',
        'err.BROADCAST_FAILED': 'La signature a eu lieu mais la transaction a été refusée. Rien n’a changé.',
        'err.PROVIDER_UNAVAILABLE': 'La plateforme ne répond pas. Réessayez dans un instant.'
    },
    'hi': {
        'title': 'खुली पोज़िशन',
        'sub': 'सीधे एक्सचेंज से',
        'count': '{n} खुली',
        'reading': 'आपकी पोज़िशन पढ़ी जा रही हैं…',
        'unavailable': 'एक्सचेंज ने जवाब नहीं दिया। आपकी पोज़िशन जस की तस है — यह केवल एक पढ़ाई थी।',
        'empty': 'अभी कोई खुली पोज़िशन नहीं है।',
        'entry': 'एंट्री',
        'mark': 'मार्क',
        'size': 'साइज़',
        'pnl': 'लाभ / हानि',
        'risk': 'TP / SL',
        'howMuch': 'कितना बंद करना है?',
        'all': 'पूरा',
        'close': 'पोज़िशन बंद करें',
        'closing': 'बंद हो रही है…',
        'confirm': '{pct}% बंद करें और साइन करें',
        'sent': 'बंद करने का ऑर्डर भेजा:',
        'noWallet': 'अपनी खुली पोज़िशन देखने के लिए वॉलेट जोड़ें।',
        'venue.solana': 'सोलाना',
        'venue.evm': 'आर्बिट्रम',
        'err.USER_REJECTED': 'आपने साइन रद्द किया। पोज़िशन जस की तस है।',
        'err.WALLET_NOT_CONNECTED': 'इस पोज़िशन का मालिक वॉलेट जोड़ें।',
        'err.NO_POSITION': 'एक्सचेंज के पास अब यह पोज़िशन नहीं है — शायद पहले ही बंद हो चुकी।',
        'err.INVALID_INPUT': 'एक्सचेंज ने यह रकम नहीं मानी। बड़ा प्रतिशत आज़माएँ।',
        'err.BROADCAST_FAILED': 'साइन हो गया पर ट्रांज़ैक्शन स्वीकार नहीं हुआ। कुछ नहीं बदला।',
        'err.PROVIDER_UNAVAILABLE': 'एक्सचेंज अभी जवाब नहीं दे रहा। थोड़ी देर बाद कोशिश करें।'
    },
    'id': {
        'title': 'Posisi terbuka',
        'sub': 'Langsung dari bursa',
        'count': '{n} terbuka',
        'reading': 'Membaca posisi Anda…',
        'unavailable': 'Bursa tidak menjawab. Posisi Anda tidak tersentuh — ini hanya pembacaan.',
        'empty': 'Tidak ada posisi terbuka saat ini.',
        'entry': 'Masuk',
        'mark': 'Mark',
        'size': 'Ukuran',
        'pnl': 'L/R',
        'risk': 'TP / SL',
        'howMuch': 'Berapa yang ingin ditutup?',
        'all': 'Semua',
        'close': 'Tutup posisi',
        'closing': 'Menutup…',
        'confirm': 'Tutup {pct}% dan tanda tangan',
        'sent': 'Penutupan dikirim:',
        'noWallet': 'Hubungkan dompet untuk melihat posisi terbuka Anda.',
        'venue': {'solana': 'Solana', 'evm': 'Arbitrum'},
        'err': {'USER_REJECTED': 'Anda membatalkan tanda tangan. Posisi tidak tersentuh.',
        'err.WALLET_NOT_CONNECTED': 'Hubungkan dompet pemilik posisi ini.',
        'err.NO_POSITION': 'Bursa tidak lagi memiliki posisi ini — mungkin sudah ditutup.',
        'err.INVALID_INPUT': 'Bursa menolak jumlah itu. Coba persentase lebih besar.',
        'err.BROADCAST_FAILED': 'Sudah ditandatangani tetapi transaksi tidak diterima. Tidak ada yang berubah.',
        'err.PROVIDER_UNAVAILABLE': 'Bursa tidak menjawab sekarang. Coba lagi sebentar.'
    },
    'pt': {
        'title': 'Posições abertas',
        'sub': 'Ao vivo das corretoras',
        'count': '{n} aberta(s)',
        'reading': 'A ler as suas posições…',
        'unavailable': 'A corretora não respondeu. A sua posição está intacta — isto foi apenas uma leitura.',
        'empty': 'Neste momento não tem posições abertas.',
        'entry': 'Entrada',
        'mark': 'Mercado',
        'size': 'Tamanho',
        'pnl': 'L/P',
        'risk': 'TP / SL',
        'howMuch': 'Quanto quer fechar?',
        'all': 'Tudo',
        'close': 'Fechar posição',
        'closing': 'A fechar…',
        'confirm': 'Fechar {pct}% e assinar',
        'sent': 'Fecho enviado:',
        'noWallet': 'Ligue uma carteira para ver as suas posições abertas.',
        'venue': {'solana': 'Solana', 'evm': 'Arbitrum'},
        'err': {'USER_REJECTED': 'Cancelou a assinatura. A posição está intacta.',
        'err.WALLET_NOT_CONNECTED': 'Ligue a carteira dona desta posição.',
        'err.NO_POSITION': 'A corretora já não tem esta posição — pode estar fechada.',
        'err.INVALID_INPUT': 'A corretora recusou esse valor. Tente uma percentagem maior.',
        'err.BROADCAST_FAILED': 'Foi assinado mas a transação não foi aceite. Nada mudou.',
        'err.PROVIDER_UNAVAILABLE': 'A corretora não responde agora. Tente daqui a pouco.'
    },
    'ru': {
        'title': 'Открытые позиции',
        'sub': 'Напрямую с площадок',
        'count': '{n} открыто',
        'reading': 'Читаем ваши позиции…',
        'unavailable': 'Площадка не ответила. Ваша позиция не тронута — это было только чтение.',
        'empty': 'Сейчас открытых позиций нет.',
        'entry': 'Вход',
        'mark': 'Текущая',
        'size': 'Объём',
        'pnl': 'Прибыль / убыток',
        'risk': 'TP / SL',
        'howMuch': 'Сколько закрыть?',
        'all': 'Всё',
        'close': 'Закрыть позицию',
        'closing': 'Закрываем…',
        'confirm': 'Закрыть {pct}% и подписать',
        'sent': 'Заявка на закрытие отправлена:',
        'noWallet': 'Подключите кошелёк, чтобы видеть открытые позиции.',
        'venue': {'solana': 'Solana', 'evm': 'Arbitrum'},
        'err': {'USER_REJECTED': 'Вы отменили подпись. Позиция не тронута.',
        'err.WALLET_NOT_CONNECTED': 'Подключите кошелёк — владелец этой позиции.',
        'err.NO_POSITION': 'У площадки больше нет этой позиции — возможно, уже закрыта.',
        'err.INVALID_INPUT': 'Площадка отклонила эту сумму. Попробуйте больший процент.',
        'err.BROADCAST_FAILED': 'Подпись есть, но транзакция не принята. Ничего не изменилось.',
        'err.PROVIDER_UNAVAILABLE': 'Площадка сейчас не отвечает. Повторите через минуту.'
    },
    'tr': {
        'title': 'Açık pozisyonlar',
        'sub': 'Doğrudan borsalardan',
        'count': '{n} açık',
        'reading': 'Pozisyonlarınız okunuyor…',
        'unavailable': 'Borsa yanıt vermedi. Pozisyonunuz olduğu gibi duruyor — bu yalnızca bir okumaydı.',
        'empty': 'Şu anda açık pozisyonunuz yok.',
        'entry': 'Giriş',
        'mark': 'Piyasa',
        'size': 'Büyüklük',
        'pnl': 'K/Z',
        'risk': 'TP / SL',
        'howMuch': 'Ne kadarını kapatmak istiyorsunuz?',
        'all': 'Tamamı',
        'close': 'Pozisyonu kapat',
        'closing': 'Kapatılıyor…',
        'confirm': '{pct}% kapat ve imzala',
        'sent': 'Kapatma gönderildi:',
        'noWallet': 'Açık pozisyonlarınızı görmek için cüzdan bağlayın.',
        'venue': {'solana': 'Solana', 'evm': 'Arbitrum'},
        'err': {'USER_REJECTED': 'İmzayı iptal ettiniz. Pozisyon olduğu gibi duruyor.',
        'err.WALLET_NOT_CONNECTED': 'Bu pozisyonun sahibi olan cüzdanı bağlayın.',
        'err.NO_POSITION': 'Borsada bu pozisyon artık yok — kapanmış olabilir.',
        'err.INVALID_INPUT': 'Borsa bu tutarı kabul etmedi. Daha büyük bir yüzde deneyin.',
        'err.BROADCAST_FAILED': 'İmzalandı ama işlem kabul edilmedi. Hiçbir şey değişmedi.',
        'err.PROVIDER_UNAVAILABLE': 'Borsa şu anda yanıt vermiyor. Birazdan tekrar deneyin.'
    },
    'ur': {
        'title': 'کھلی پوزیشنز',
        'sub': 'براہِ راست ایکسچینجز سے',
        'count': '{n} کھلی',
        'reading': 'آپ کی پوزیشنز پڑھی جا رہی ہیں…',
        'unavailable': 'ایکسچینج نے جواب نہیں دیا۔ آپ کی پوزیشن جوں کی توں ہے — یہ صرف پڑھائی تھی۔',
        'empty': 'اس وقت کوئی کھلی پوزیشن نہیں۔',
        'entry': 'انٹری',
        'mark': 'مارک',
        'size': 'سائز',
        'pnl': 'نفع / نقصان',
        'risk': 'TP / SL',
        'howMuch': 'کتنا بند کرنا ہے؟',
        'all': 'سب',
        'close': 'پوزیشن بند کریں',
        'closing': 'بند ہو رہی ہے…',
        'confirm': '{pct}٪ بند کریں اور دستخط کریں',
        'sent': 'بندش بھیجی گئی:',
        'noWallet': 'اپنی کھلی پوزیشنز دیکھنے کے لیے والٹ منسلک کریں۔',
        'venue.solana': 'سولانا',
        'venue.evm': 'آربیٹرم',
        'err.USER_REJECTED': 'آپ نے دستخط منسوخ کیے۔ پوزیشن جوں کی توں ہے۔',
        'err.WALLET_NOT_CONNECTED': 'اس پوزیشن کا مالک والٹ منسلک کریں۔',
        'err.NO_POSITION': 'ایکسچینج کے پاس اب یہ پوزیشن نہیں — شاید پہلے بند ہو چکی۔',
        'err.INVALID_INPUT': 'ایکسچینج نے یہ رقم قبول نہیں کی۔ بڑا فیصد آزمائیں۔',
        'err.BROADCAST_FAILED': 'دستخط ہو گئے مگر ٹرانزیکشن قبول نہیں ہوئی۔ کچھ نہیں بدلا۔',
        'err.PROVIDER_UNAVAILABLE': 'ایکسچینج ابھی جواب نہیں دے رہا۔ تھوڑی دیر بعد کوشش کریں۔'
    },
    'zh': {
        'title': '持仓',
        'sub': '直接来自交易所',
        'count': '{n} 个持仓',
        'reading': '正在读取你的持仓…',
        'unavailable': '交易所未响应。你的持仓没有变化——这只是一次读取。',
        'empty': '当前没有持仓。',
        'entry': '开仓价',
        'mark': '标记价',
        'size': '规模',
        'pnl': '盈亏',
        'risk': '止盈 / 止损',
        'howMuch': '要平掉多少？',
        'all': '全部',
        'close': '平仓',
        'closing': '正在平仓…',
        'confirm': '平掉 {pct}% 并签名',
        'sent': '平仓已提交：',
        'noWallet': '连接钱包即可查看你的持仓。',
        'venue': {'solana': 'Solana', 'evm': 'Arbitrum'},
        'err': {'USER_REJECTED': '你取消了签名。持仓没有变化。',
        'err.WALLET_NOT_CONNECTED': '请连接拥有该持仓的钱包。',
        'err.NO_POSITION': '交易所已没有该持仓——可能已经平掉了。',
        'err.INVALID_INPUT': '交易所拒绝了该数量。请尝试更大的平仓比例。',
        'err.BROADCAST_FAILED': '已签名，但交易未被接受。没有发生任何变化。',
        'err.PROVIDER_UNAVAILABLE': '交易所暂时没有响应。请稍后再试。'
    }
}

# dYdX: the tab listed positions and offered no way out of them.
DYDX = {
    'en': {'close': 'Close', 'closing': 'Closing…', 'closeSent': 'Close order submitted:', 'errNotConnected': 'Connect your dYdX account first.'},
    'fa': {'close': 'بستن', 'closing': 'در حال بستن…', 'closeSent': 'دستور بستن ثبت شد:', 'errNotConnected': 'اول حساب dYdX را وصل کنید.'},
    'ar': {'close': 'إغلاق', 'closing': 'جارٍ الإغلاق…', 'closeSent': 'تم إرسال أمر الإغلاق:', 'errNotConnected': 'اربط حساب dYdX أولاً.'},
    'es': {'close': 'Cerrar', 'closing': 'Cerrando…', 'closeSent': 'Orden de cierre enviada:', 'errNotConnected': 'Conecta tu cuenta de dYdX primero.'},
    'fr': {'close': 'Clôturer', 'closing': 'Clôture…', 'closeSent': 'Ordre de clôture envoyé :', 'errNotConnected': 'Connectez d’abord votre compte dYdX.'},
    'hi': {'close': 'बंद करें', 'closing': 'बंद हो रही है…', 'closeSent': 'बंद करने का ऑर्डर भेजा:', 'errNotConnected': 'पहले अपना dYdX खाता जोड़ें।'},
    'id': {'close': 'Tutup', 'closing': 'Menutup…', 'closeSent': 'Perintah tutup dikirim:', 'errNotConnected': 'Hubungkan akun dYdX Anda dulu.'},
    'pt': {'close': 'Fechar', 'closing': 'A fechar…', 'closeSent': 'Ordem de fecho enviada:', 'errNotConnected': 'Ligue primeiro a sua conta dYdX.'},
    'ru': {'close': 'Закрыть', 'closing': 'Закрываем…', 'closeSent': 'Заявка на закрытие отправлена:', 'errNotConnected': 'Сначала подключите аккаунт dYdX.'},
    'tr': {'close': 'Kapat', 'closing': 'Kapatılıyor…', 'closeSent': 'Kapatma emri gönderildi:', 'errNotConnected': 'Önce dYdX hesabınızı bağlayın.'},
    'ur': {'close': 'بند کریں', 'closing': 'بند ہو رہی ہے…', 'closeSent': 'بندش کا آرڈر بھیجا گیا:', 'errNotConnected': 'پہلے اپنا dYdX اکاؤنٹ منسلک کریں۔'},
    'zh': {'close': '平仓', 'closing': '正在平仓…', 'closeSent': '平仓已提交：', 'errNotConnected': '请先连接你的 dYdX 账户。'}
}


def render(obj, indent):
    """Emit an object as JSON lines at `indent`, preserving key order."""
    pad = ' ' * indent
    inner = ' ' * (indent + 2)
    parts = []
    for i, (k, v) in enumerate(obj.items()):
        key = json.dumps(k, ensure_ascii=False)
        if isinstance(v, dict):
            parts.append(f'{inner}{key}: {render(v, indent + 2)}')
        else:
            parts.append(f'{inner}{key}: {json.dumps(v, ensure_ascii=False)}')
    body = ',\n'.join(parts)
    return '{\n' + body + '\n' + pad + '}'


def insert_after(path, anchor_line, block):
    text = path.read_text(encoding='utf-8')
    lines = text.split('\n')
    for i, line in enumerate(lines):
        if line.rstrip() == anchor_line:
            lines.insert(i + 1, block)
            path.write_text('\n'.join(lines), encoding='utf-8')
            return True
    return False


def main():
    missing = []
    for path in LOCALES:
        lang = path.stem
        if lang not in POSITIONS:
            missing.append(lang)
    if missing:
        sys.exit(f'no copy for: {missing}')

    for path in LOCALES:
        lang = path.stem
        data = json.loads(path.read_text(encoding='utf-8'))
        if 'positions' in data.get('perp', {}) and 'closeSent' in data.get('dydx', {}):
            print(f'{lang}: already present, skipped')
            continue

        block = f'    "positions": {render(POSITIONS[lang], 4)},'
        if not insert_after(path, '  "perp": {', block):
            sys.exit(f'{lang}: perp anchor not found')
        block = f'    "closeSent": {json.dumps(DYDX[lang]["closeSent"], ensure_ascii=False)},'
        if not insert_after(path, '  "dydx": {', block):
            sys.exit(f'{lang}: dydx anchor not found')
        for key in ('close', 'closing', 'errNotConnected'):
            line = f'    "{key}": {json.dumps(DYDX[lang][key], ensure_ascii=False)},'
            if not insert_after(path, '  "dydx": {', line):
                sys.exit(f'{lang}: dydx anchor not found ({key})')

        # A malformed locale file breaks every screen, so fail loudly here.
        json.loads(path.read_text(encoding='utf-8'))
        print(f'{lang}: added {len(POSITIONS[lang])} position keys + 4 dydx keys')


if __name__ == '__main__':
    main()
