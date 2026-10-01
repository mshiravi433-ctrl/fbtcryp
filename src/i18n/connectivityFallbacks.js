/**
 * Tiny, boot-critical copy for the full-screen network alert.
 *
 * Other locale bundles are lazy-loaded to keep the first download small. On a
 * cold offline launch their dynamic import may not be available yet, so this
 * small set lets the alert still honour the language/direction already stored
 * in <html lang>. The full locale JSON files remain the canonical translations.
 */
export const CONNECTIVITY_FALLBACKS = Object.freeze({
  en: {
    offlineTitle: 'No internet connection',
    weakTitle: 'Your internet connection is weak',
    offlineBody: 'Your device seems to be offline. Check your Wi-Fi or mobile data. This alert will close when the connection is restored.',
    weakBody: 'The connection seems slow or unstable. Live prices and some online features may not load correctly. Check your Wi-Fi or mobile data, then continue when it is stable.',
    transactionNote: 'Transaction updates may be delayed. If you have just sent one, check its status before trying again.',
    acknowledge: 'I understand',
    offlineBadge: 'OFFLINE',
    weakBadge: 'WEAK CONNECTION'
  },
  fa: {
    offlineTitle: 'اتصال اینترنت قطع شده است',
    weakTitle: 'اتصال اینترنت ضعیف است',
    offlineBody: 'دستگاه شما به اینترنت وصل نیست. وای‌فای یا دادهٔ همراه را بررسی کنید. با وصل شدن دوباره، این هشدار بسته می‌شود.',
    weakBody: 'اتصال کند یا ناپایدار است و ممکن است قیمت‌های زنده یا بعضی امکانات آنلاین بارگیری نشوند. اتصال را بررسی کنید و پس از پایدار شدن ادامه دهید.',
    transactionNote: 'به‌روزرسانی وضعیت تراکنش‌ها ممکن است با تأخیر انجام شود. اگر تراکنشی فرستاده‌اید، پیش از تلاش دوباره وضعیت آن را بررسی کنید.',
    acknowledge: 'متوجه شدم',
    offlineBadge: 'بدون اتصال',
    weakBadge: 'اتصال ضعیف'
  },
  ar: {
    offlineTitle: 'لا يوجد اتصال بالإنترنت',
    weakTitle: 'اتصال الإنترنت ضعيف',
    offlineBody: 'يبدو أن جهازك غير متصل بالإنترنت. تحقق من شبكة Wi‑Fi أو بيانات الهاتف. سيختفي هذا التنبيه عند استعادة الاتصال.',
    weakBody: 'الاتصال بطيء أو غير مستقر، وقد لا تُحمّل الأسعار المباشرة وبعض الميزات عبر الإنترنت. تحقق من Wi‑Fi أو بيانات الهاتف وتابع عندما يستقر الاتصال.',
    transactionNote: 'قد تتأخر تحديثات المعاملات. إذا أرسلت معاملة للتو، فتحقق من حالتها قبل المحاولة مرة أخرى.',
    acknowledge: 'فهمت',
    offlineBadge: 'غير متصل',
    weakBadge: 'اتصال ضعيف'
  },
  es: {
    offlineTitle: 'Sin conexión a Internet',
    weakTitle: 'La conexión a Internet es débil',
    offlineBody: 'Parece que tu dispositivo no tiene conexión. Comprueba el Wi-Fi o los datos móviles. Esta alerta desaparecerá cuando se restablezca la conexión.',
    weakBody: 'La conexión parece lenta o inestable. Es posible que los precios en vivo y algunas funciones no se carguen bien. Comprueba el Wi-Fi o los datos móviles y continúa cuando la conexión se estabilice.',
    transactionNote: 'Las actualizaciones de las transacciones pueden retrasarse. Si acabas de enviar una, comprueba su estado antes de volver a intentarlo.',
    acknowledge: 'Entendido',
    offlineBadge: 'SIN CONEXIÓN',
    weakBadge: 'CONEXIÓN DÉBIL'
  },
  fr: {
    offlineTitle: 'Aucune connexion Internet',
    weakTitle: 'Votre connexion Internet est faible',
    offlineBody: 'Votre appareil semble hors ligne. Vérifiez le Wi-Fi ou les données mobiles. Cette alerte disparaîtra une fois la connexion rétablie.',
    weakBody: 'La connexion semble lente ou instable. Les prix en direct et certaines fonctionnalités en ligne risquent de ne pas se charger correctement. Vérifiez le Wi-Fi ou les données mobiles, puis reprenez lorsque la connexion sera stable.',
    transactionNote: 'Les mises à jour des transactions peuvent être retardées. Si vous venez d’en envoyer une, vérifiez son statut avant de réessayer.',
    acknowledge: 'J’ai compris',
    offlineBadge: 'HORS LIGNE',
    weakBadge: 'CONNEXION FAIBLE'
  },
  hi: {
    offlineTitle: 'इंटरनेट कनेक्शन नहीं है',
    weakTitle: 'आपका इंटरनेट कनेक्शन कमज़ोर है',
    offlineBody: 'आपका डिवाइस ऑफ़लाइन लग रहा है। वाई-फ़ाई या मोबाइल डेटा जाँचें। कनेक्शन लौटने पर यह चेतावनी अपने आप बंद हो जाएगी।',
    weakBody: 'कनेक्शन धीमा या अस्थिर है। लाइव कीमतें और कुछ ऑनलाइन सुविधाएँ ठीक से लोड नहीं हो सकतीं। वाई-फ़ाई या मोबाइल डेटा जाँचें और कनेक्शन स्थिर होने पर आगे बढ़ें।',
    transactionNote: 'लेन-देन की स्थिति अपडेट होने में देर हो सकती है। अगर आपने अभी लेन-देन भेजा है, तो दोबारा कोशिश करने से पहले उसकी स्थिति जाँचें।',
    acknowledge: 'मैं समझ गया/गई',
    offlineBadge: 'ऑफ़लाइन',
    weakBadge: 'कमज़ोर कनेक्शन'
  },
  id: {
    offlineTitle: 'Tidak ada koneksi internet',
    weakTitle: 'Koneksi internet Anda lemah',
    offlineBody: 'Perangkat Anda tampaknya sedang offline. Periksa Wi-Fi atau data seluler. Peringatan ini akan tertutup setelah koneksi pulih.',
    weakBody: 'Koneksi tampaknya lambat atau tidak stabil. Harga langsung dan beberapa fitur online mungkin tidak dimuat dengan baik. Periksa Wi-Fi atau data seluler, lalu lanjutkan setelah koneksi stabil.',
    transactionNote: 'Pembaruan transaksi mungkin tertunda. Jika Anda baru saja mengirim transaksi, periksa statusnya sebelum mencoba lagi.',
    acknowledge: 'Saya mengerti',
    offlineBadge: 'OFFLINE',
    weakBadge: 'KONEKSI LEMAH'
  },
  pt: {
    offlineTitle: 'Sem ligação à Internet',
    weakTitle: 'A sua ligação à Internet está fraca',
    offlineBody: 'O seu dispositivo parece estar sem ligação. Verifique o Wi-Fi ou os dados móveis. Este aviso fechará quando a ligação for restabelecida.',
    weakBody: 'A ligação parece lenta ou instável. Os preços em tempo real e algumas funcionalidades online podem não carregar corretamente. Verifique o Wi-Fi ou os dados móveis e continue quando a ligação estiver estável.',
    transactionNote: 'As atualizações das transações podem atrasar. Se acabou de enviar uma, confirme o estado antes de tentar novamente.',
    acknowledge: 'Compreendi',
    offlineBadge: 'SEM LIGAÇÃO',
    weakBadge: 'LIGAÇÃO FRACA'
  },
  ru: {
    offlineTitle: 'Нет подключения к интернету',
    weakTitle: 'Слабое интернет-соединение',
    offlineBody: 'Похоже, устройство не подключено к интернету. Проверьте Wi-Fi или мобильную сеть. Это предупреждение исчезнет после восстановления соединения.',
    weakBody: 'Соединение медленное или нестабильное. Актуальные цены и некоторые онлайн-функции могут загружаться с ошибками. Проверьте Wi-Fi или мобильную сеть и продолжайте, когда соединение станет стабильным.',
    transactionNote: 'Обновление статуса транзакции может задержаться. Если вы только что отправили транзакцию, проверьте её статус перед повторной попыткой.',
    acknowledge: 'Понятно',
    offlineBadge: 'НЕТ СВЯЗИ',
    weakBadge: 'СЛАБОЕ СОЕДИНЕНИЕ'
  },
  tr: {
    offlineTitle: 'İnternet bağlantısı yok',
    weakTitle: 'İnternet bağlantınız zayıf',
    offlineBody: 'Cihazınız çevrimdışı görünüyor. Wi-Fi veya mobil veriyi kontrol edin. Bağlantı yeniden kurulduğunda bu uyarı kapanır.',
    weakBody: 'Bağlantı yavaş veya kararsız görünüyor. Canlı fiyatlar ve bazı çevrimiçi özellikler düzgün yüklenmeyebilir. Wi-Fi veya mobil veriyi kontrol edin ve bağlantı kararlı olduğunda devam edin.',
    transactionNote: 'İşlem güncellemeleri gecikebilir. Bir işlemi yeni gönderdiyseniz tekrar denemeden önce durumunu kontrol edin.',
    acknowledge: 'Anladım',
    offlineBadge: 'ÇEVRİMDIŞI',
    weakBadge: 'ZAYIF BAĞLANTI'
  },
  ur: {
    offlineTitle: 'انٹرنیٹ کنکشن موجود نہیں',
    weakTitle: 'آپ کا انٹرنیٹ کنکشن کمزور ہے',
    offlineBody: 'لگتا ہے آپ کا آلہ آف لائن ہے۔ وائی فائی یا موبائل ڈیٹا چیک کریں۔ کنکشن بحال ہونے پر یہ تنبیہ بند ہو جائے گی۔',
    weakBody: 'کنکشن سست یا غیر مستحکم ہے۔ لائیو قیمتیں اور کچھ آن لائن سہولتیں درست طور پر لوڈ نہیں ہو سکتیں۔ وائی فائی یا موبائل ڈیٹا چیک کریں اور کنکشن مستحکم ہونے پر آگے بڑھیں۔',
    transactionNote: 'لین دین کی تازہ کاری میں تاخیر ہو سکتی ہے۔ اگر ابھی لین دین بھیجا ہے تو دوبارہ کوشش سے پہلے اس کی حالت چیک کریں۔',
    acknowledge: 'میں سمجھ گیا/گئی',
    offlineBadge: 'آف لائن',
    weakBadge: 'کمزور کنکشن'
  },
  zh: {
    offlineTitle: '没有互联网连接',
    weakTitle: '网络连接较弱',
    offlineBody: '您的设备似乎已断网。请检查 Wi-Fi 或移动数据；网络恢复后，此提示会自动关闭。',
    weakBody: '网络连接较慢或不稳定，实时价格和部分在线功能可能无法正常加载。请检查 Wi-Fi 或移动数据，待连接稳定后再继续。',
    transactionNote: '交易状态更新可能会延迟。如果您刚刚发送了交易，请先确认交易状态，再尝试操作。',
    acknowledge: '我知道了',
    offlineBadge: '已断网',
    weakBadge: '网络较弱'
  }
});
