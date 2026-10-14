/**
 * Spot trade (src/components/spot): the user's own-wallet swap tab.
 *
 * en, fa and ar live directly in src/i18n/locales/{en,fa,ar}.json because
 * those three are hand-kept. The nine languages below are merged by
 * scripts/gen-locales.mjs. Every placeholder ({{wallet}}, {{pct}}, …) must
 * survive translation: the generator refuses the build if one is dropped.
 *
 * Wording rules for this tab: never promise a price, a fill or a profit.
 * Say what happens and what the user still has to check.
 */
export default {
  'spot.subtitle': {
    zh: '用您自己的钱包兑换代币。每笔交易都由您亲自签名。',
    hi: 'अपने वॉलेट से टोकन स्वैप करें। हर लेन-देन पर हस्ताक्षर सिर्फ़ आप करते हैं।',
    es: 'Intercambia tokens desde tu propia cartera. Cada transacción la firmas tú.',
    fr: 'Échangez des tokens depuis votre propre portefeuille. Chaque transaction est signée par vous.',
    ru: 'Обменивайте токены из собственного кошелька. Каждую транзакцию подписываете вы.',
    tr: 'Tokenleri kendi cüzdanınızdan takas edin. Her işlemi yalnızca siz imzalarsınız.',
    ur: 'اپنے بٹوے سے ٹوکن سواپ کریں۔ ہر ٹرانزیکشن پر دستخط صرف آپ کرتے ہیں۔',
    id: 'Tukar token dari dompet Anda sendiri. Setiap transaksi ditandatangani oleh Anda.',
    pt: 'Troque tokens a partir da sua própria carteira. Cada transação é assinada por você.'
  },
  'spot.modeLabel': {
    zh: '交易模式', hi: 'ट्रेड मोड', es: 'Modo de operación', fr: 'Mode de trading', ru: 'Режим торговли',
    tr: 'İşlem modu', ur: 'ٹریڈ موڈ', id: 'Mode perdagangan', pt: 'Modo de negociação'
  },
  'spot.mode.real': {
    zh: '我的钱包', hi: 'मेरा वॉलेट', es: 'Mi cartera', fr: 'Mon portefeuille', ru: 'Мой кошелёк',
    tr: 'Cüzdanım', ur: 'میرا بٹوہ', id: 'Dompet saya', pt: 'Minha carteira'
  },
  'spot.mode.paper': {
    zh: '模拟（纸面）', hi: 'परीक्षण (पेपर)', es: 'Prueba (papel)', fr: 'Essai (papier)', ru: 'Тест (бумажный)',
    tr: 'Deneme (kağıt)', ur: 'آزمائشی (کاغذی)', id: 'Uji coba (kertas)', pt: 'Teste (papel)'
  },
  'spot.paperBanner': {
    zh: '试用 — 无真实资金', hi: 'परीक्षण — कोई असली पैसा नहीं', es: 'Prueba — sin dinero real', fr: 'Essai — aucun argent réel',
    ru: 'Тест — без реальных денег', tr: 'Deneme — gerçek para yok', ur: 'آزمائش — کوئی حقیقی رقم نہیں',
    id: 'Uji coba — tanpa uang sungguhan', pt: 'Teste — sem dinheiro real'
  },
  'spot.market.title': {
    zh: '市场', hi: 'बाज़ार', es: 'Mercado', fr: 'Marché', ru: 'Рынок', tr: 'Piyasa', ur: 'مارکیٹ', id: 'Pasar', pt: 'Mercado'
  },
  'spot.market.sheetTitle': {
    zh: '选择代币', hi: 'टोकन चुनें', es: 'Elige un token', fr: 'Choisir un token', ru: 'Выберите токен',
    tr: 'Bir token seçin', ur: 'ٹوکن منتخب کریں', id: 'Pilih token', pt: 'Escolha um token'
  },
  'spot.market.empty': {
    zh: '没有匹配搜索的代币。', hi: 'खोज से कोई टोकन नहीं मिला।', es: 'Ningún token coincide con tu búsqueda.',
    fr: 'Aucun token ne correspond à votre recherche.', ru: 'Нет токенов по этому запросу.', tr: 'Aramanızla eşleşen token yok.',
    ur: 'تلاش سے کوئی ٹوکن نہیں ملا۔', id: 'Tidak ada token yang cocok dengan pencarian Anda.', pt: 'Nenhum token corresponde à sua busca.'
  },
  'spot.form.title': {
    zh: '兑换', hi: 'स्वैप', es: 'Intercambiar', fr: 'Échanger', ru: 'Обмен', tr: 'Takas', ur: 'سواپ', id: 'Tukar', pt: 'Trocar'
  },
  'spot.network': {
    zh: '网络', hi: 'नेटवर्क', es: 'Red', fr: 'Réseau', ru: 'Сеть', tr: 'Ağ', ur: 'نیٹ ورک', id: 'Jaringan', pt: 'Rede'
  },
  'spot.connectCard.title': {
    zh: '连接钱包后即可交易', hi: 'कारोबार के लिए अपना वॉलेट जोड़ें', es: 'Conecta tu cartera para operar',
    fr: 'Connectez votre portefeuille pour trader', ru: 'Подключите кошелёк, чтобы торговать', tr: 'İşlem yapmak için cüzdanınızı bağlayın',
    ur: 'ٹریڈ کرنے کے لیے اپنا بٹوہ جوڑیں', id: 'Hubungkan dompet untuk berdagang', pt: 'Conecte sua carteira para negociar'
  },
  'spot.connectCard.body': {
    zh: '您现在就能查看价格。连接后可看到余额并签名兑换。私钥始终留在您的钱包中，平台无法看到。',
    hi: 'अभी कीमतें देख सकते हैं। वॉलेट जोड़ने पर बैलेंस दिखेगा और स्वैप पर हस्ताक्षर कर सकेंगे। आपकी कुंजियाँ आपके वॉलेट में ही रहती हैं; प्लेटफ़ॉर्म इन्हें कभी नहीं देखता।',
    es: 'Ya puedes ver los precios. Al conectar, verás tus saldos y podrás firmar un intercambio. Tus claves se quedan en tu cartera; la plataforma nunca las ve.',
    fr: 'Vous pouvez déjà voir les prix. En connectant votre portefeuille, vous voyez vos soldes et signez l’échange. Vos clés restent dans votre portefeuille ; la plateforme ne les voit jamais.',
    ru: 'Цены уже видны. После подключения вы увидите балансы и сможете подписать обмен. Ключи остаются в вашем кошельке; платформа их никогда не видит.',
    tr: 'Fiyatları şimdiden görebilirsiniz. Bağlandığınızda bakiyelerinizi görür ve takası imzalayabilirsiniz. Anahtarlarınız cüzdanınızda kalır; platform bunları asla görmez.',
    ur: 'قیمتیں ابھی دیکھ سکتے ہیں۔ بٹوہ جوڑنے پر بیلنس نظر آئے گا اور سواپ پر دستخط کر سکیں گے۔ آپ کی کلیدیں آپ کے بٹوے میں رہتی ہیں؛ پلیٹ فارم انہیں کبھی نہیں دیکھتا۔',
    id: 'Anda sudah bisa melihat harga. Setelah terhubung, Anda bisa melihat saldo dan menandatangani tukar. Kunci Anda tetap di dompet; platform tidak pernah melihatnya.',
    pt: 'Você já pode ver os preços. Ao conectar, vê seus saldos e assina a troca. Suas chaves ficam na sua carteira; a plataforma nunca as vê.'
  },
  'spot.wrongNetwork.title': {
    zh: '您的钱包在另一个网络上', hi: 'आपका वॉलेट दूसरे नेटवर्क पर है', es: 'Tu cartera está en otra red',
    fr: 'Votre portefeuille est sur un autre réseau', ru: 'Кошелёк подключён к другой сети', tr: 'Cüzdanınız başka bir ağda',
    ur: 'آپ کا بٹوہ کسی اور نیٹ ورک پر ہے', id: 'Dompet Anda ada di jaringan lain', pt: 'Sua carteira está em outra rede'
  },
  'spot.wrongNetwork.body': {
    zh: '您的钱包在 {{wallet}} 上，而此订单在 {{order}} 上。请切换钱包后继续。',
    hi: 'आपका वॉलेट {{wallet}} पर है, जबकि यह ऑर्डर {{order}} पर है। वॉलेट बदलकर आगे बढ़ें।',
    es: 'Tu cartera está en {{wallet}}, pero esta orden es en {{order}}. Cambia la red de tu cartera y continúa.',
    fr: 'Votre portefeuille est sur {{wallet}}, mais cet ordre est sur {{order}}. Changez de réseau dans votre portefeuille pour continuer.',
    ru: 'Кошелёк подключён к {{wallet}}, а этот ордер — в {{order}}. Переключите сеть кошелька и продолжите.',
    tr: 'Cüzdanınız {{wallet}} üzerinde, bu emir ise {{order}} üzerinde. Cüzdanınızın ağını değiştirip devam edin.',
    ur: 'آپ کا بٹوہ {{wallet}} پر ہے، جبکہ یہ آرڈر {{order}} پر ہے۔ بٹوے کا نیٹ ورک بدل کر آگے بڑھیں۔',
    id: 'Dompet Anda ada di {{wallet}}, sedangkan order ini di {{order}}. Ganti jaringan dompet, lalu lanjutkan.',
    pt: 'Sua carteira está em {{wallet}}, mas esta ordem é em {{order}}. Troque a rede da carteira e continue.'
  },
  'spot.wrongNetwork.switch': {
    zh: '将钱包切换到 {{network}}', hi: 'वॉलेट को {{network}} पर बदलें', es: 'Cambiar la cartera a {{network}}',
    fr: 'Passer le portefeuille sur {{network}}', ru: 'Переключить кошелёк на {{network}}', tr: 'Cüzdanı {{network}} ağına geçir',
    ur: 'بٹوہ کو {{network}} پر منتقل کریں', id: 'Ganti dompet ke {{network}}', pt: 'Trocar a carteira para {{network}}'
  },
  'spot.side.label': {
    zh: '方向', hi: 'दिशा', es: 'Dirección', fr: 'Sens', ru: 'Направление', tr: 'Yön', ur: 'سمت', id: 'Arah', pt: 'Direção'
  },
  'spot.side.buy': {
    zh: '买入', hi: 'खरीदें', es: 'Comprar', fr: 'Acheter', ru: 'Купить', tr: 'Al', ur: 'خریدیں', id: 'Beli', pt: 'Comprar'
  },
  'spot.side.sell': {
    zh: '卖出', hi: 'बेचें', es: 'Vender', fr: 'Vendre', ru: 'Продать', tr: 'Sat', ur: 'بیچیں', id: 'Jual', pt: 'Vender'
  },
  'spot.quoteAsset': {
    zh: '支付方式', hi: 'भुगतान के लिए', es: 'Pagar con', fr: 'Payer avec', ru: 'Оплата', tr: 'Ödeme', ur: 'ادائیگی', id: 'Bayar dengan', pt: 'Pagar com'
  },
  'spot.payAmount': {
    zh: '支付金额（{{symbol}}）', hi: 'भुगतान राशि ({{symbol}})', es: 'Cantidad a pagar ({{symbol}})', fr: 'Montant à payer ({{symbol}})',
    ru: 'Сумма к оплате ({{symbol}})', tr: 'Ödenecek miktar ({{symbol}})', ur: 'ادا کی جانے والی رقم ({{symbol}})',
    id: 'Jumlah dibayar ({{symbol}})', pt: 'Valor a pagar ({{symbol}})'
  },
  'spot.percentLabel': {
    zh: '占余额的比例', hi: 'बैलेंस का हिस्सा', es: 'Parte de tu saldo', fr: 'Part de votre solde', ru: 'Доля от баланса',
    tr: 'Bakiyenizin payı', ur: 'بیلنس کا حصہ', id: 'Bagian dari saldo', pt: 'Parte do seu saldo'
  },
  'spot.balance': {
    zh: '余额', hi: 'बैलेंस', es: 'Saldo', fr: 'Solde', ru: 'Баланс', tr: 'Bakiye', ur: 'بیلنس', id: 'Saldo', pt: 'Saldo'
  },
  'spot.balanceUnavailable': {
    zh: '不可用', hi: 'उपलब्ध नहीं', es: 'no disponible', fr: 'indisponible', ru: 'недоступно', tr: 'kullanılamıyor',
    ur: 'دستیاب نہیں', id: 'tidak tersedia', pt: 'indisponível'
  },
  'spot.receiveEstimate': {
    zh: '预计可得', hi: 'लगभग मिलेगा', es: 'Recibirás aprox.', fr: 'Vous recevez environ', ru: 'Вы получите примерно',
    tr: 'Yaklaşık alacağınız', ur: 'تقریباً ملے گا', id: 'Perkiraan diterima', pt: 'Você recebe aprox.'
  },
  'spot.platformFee': {
    zh: '平台手续费（{{pct}}%）', hi: 'प्लेटफ़ॉर्म शुल्क ({{pct}}%)', es: 'Comisión de la plataforma ({{pct}} %)', fr: 'Frais de la plateforme ({{pct}} %)',
    ru: 'Комиссия платформы ({{pct}}%)', tr: 'Platform ücreti (%{{pct}})', ur: 'پلیٹ فارم فیس ({{pct}}%)', id: 'Biaya platform ({{pct}}%)', pt: 'Taxa da plataforma ({{pct}}%)'
  },
  'spot.networkFeeUnknown': {
    zh: '报价后才能确定', hi: 'कोट के बाद पता चलेगा', es: 'Se conocerá al cotizar', fr: 'Connu après le devis', ru: 'Станет известно после котировки',
    tr: 'Fiyat alındıktan sonra belli olur', ur: 'کوٹ کے بعد معلوم ہوگا', id: 'Diketahui setelah kutipan', pt: 'Conhecida após a cotação'
  },
  'spot.route.value': {
    zh: '{{from}} → {{to}} · {{hops}} 跳', hi: '{{from}} → {{to}} · {{hops}} हॉप', es: '{{from}} → {{to}} · {{hops}} salto(s)', fr: '{{from}} → {{to}} · {{hops}} saut(s)',
    ru: '{{from}} → {{to}} · переходов: {{hops}}', tr: '{{from}} → {{to}} · {{hops}} adım', ur: '{{from}} → {{to}} · {{hops}} مرحلہ',
    id: '{{from}} → {{to}} · {{hops}} lompatan', pt: '{{from}} → {{to}} · {{hops}} salto(s)'
  },
  'spot.impact.title': {
    zh: '价格影响', hi: 'कीमत पर असर', es: 'Impacto en el precio', fr: 'Impact sur le prix', ru: 'Влияние на цену', tr: 'Fiyat etkisi', ur: 'قیمت پر اثر', id: 'Dampak harga', pt: 'Impacto no preço'
  },
  'spot.impact.warn': {
    zh: '此交易会使价格变动约 {{pct}}%。您可能得到的数量会明显少于报价。',
    hi: 'यह लेन-देन कीमत को लगभग {{pct}}% हिला देगा। आपको कोट से काफ़ी कम मिल सकता है।',
    es: 'Esta operación mueve el precio unos {{pct}} %. Podrías recibir bastante menos que la cotización.',
    fr: 'Cette opération fait bouger le prix d’environ {{pct}} %. Vous pourriez recevoir nettement moins que le devis.',
    ru: 'Эта сделка сдвигает цену примерно на {{pct}}%. Вы можете получить заметно меньше, чем в котировке.',
    tr: 'Bu işlem fiyatı yaklaşık %{{pct}} oynatır. Tekliften belirgin biçimde daha az alabilirsiniz.',
    ur: 'یہ ٹریڈ قیمت کو تقریباً {{pct}}% تک ہلائے گی۔ آپ کو کوٹ سے نمایاں طور پر کم مل سکتا ہے۔',
    id: 'Transaksi ini menggerakkan harga sekitar {{pct}}%. Anda bisa menerima jauh lebih sedikit dari kutipan.',
    pt: 'Esta operação move o preço cerca de {{pct}}%. Você pode receber bem menos do que a cotação.'
  },
  'spot.impact.high': {
    zh: '此交易会使价格变动约 {{pct}}%。请尝试更小的金额。您可能得到的数量会远少于报价。',
    hi: 'यह लेन-देन कीमत को लगभग {{pct}}% हिला देगा। छोटी राशि आज़माएँ। आपको कोट से बहुत कम मिल सकता है।',
    es: 'Esta operación mueve el precio unos {{pct}} %. Prueba con una cantidad menor. Podrías recibir mucho menos que la cotización.',
    fr: 'Cette opération fait bouger le prix d’environ {{pct}} %. Essayez un montant plus petit. Vous pourriez recevoir beaucoup moins que le devis.',
    ru: 'Эта сделка сдвигает цену примерно на {{pct}}%. Попробуйте меньшую сумму. Вы можете получить значительно меньше, чем в котировке.',
    tr: 'Bu işlem fiyatı yaklaşık %{{pct}} oynatır. Daha küçük bir miktar deneyin. Tekliften çok daha az alabilirsiniz.',
    ur: 'یہ ٹریڈ قیمت کو تقریباً {{pct}}% تک ہلائے گی۔ کم رقم آزمائیں۔ آپ کو کوٹ سے بہت کم مل سکتا ہے۔',
    id: 'Transaksi ini menggerakkan harga sekitar {{pct}}%. Coba jumlah yang lebih kecil. Anda bisa menerima jauh lebih sedikit dari kutipan.',
    pt: 'Esta operação move o preço cerca de {{pct}}%. Tente um valor menor. Você pode receber muito menos do que a cotação.'
  },
  'spot.quoteRefreshIn': {
    zh: '{{s}} 秒后更新报价', hi: '{{s}} सेकंड में नया कोट', es: 'Nueva cotización en {{s}} s', fr: 'Nouveau devis dans {{s}} s',
    ru: 'Новая котировка через {{s}} с', tr: 'Yeni teklif {{s}} sn içinde', ur: '{{s}} سیکنڈ میں نیا کوٹ', id: 'Kutipan baru dalam {{s}} dtk', pt: 'Nova cotação em {{s}} s'
  },
  'spot.quoteExpired': {
    zh: '报价已过期，正在获取新报价', hi: 'कोट की अवधि समाप्त, नया कोट लिया जा रहा है', es: 'La cotización caducó; pidiendo una nueva',
    fr: 'Devis expiré ; nouveau devis en cours', ru: 'Котировка истекла; запрашиваем новую', tr: 'Teklifin süresi doldu; yenisi alınıyor',
    ur: 'کوٹ کی مدت ختم؛ نیا کوٹ لیا جا رہا ہے', id: 'Kutipan kedaluwarsa; mengambil yang baru', pt: 'Cotação expirou; buscando uma nova'
  },
  'spot.quoteLoading': {
    zh: '正在获取报价…', hi: 'कोट लिया जा रहा है…', es: 'Obteniendo cotización…', fr: 'Récupération du devis…', ru: 'Получаем котировку…',
    tr: 'Teklif alınıyor…', ur: 'کوٹ حاصل کیا جا رہا ہے…', id: 'Mengambil kutipan…', pt: 'Obtendo cotação…'
  },
  'spot.quoteAge': {
    zh: '{{s}} 秒前', hi: '{{s}} सेकंड पहले', es: 'hace {{s}} s', fr: 'il y a {{s}} s', ru: '{{s}} с назад', tr: '{{s}} sn önce',
    ur: '{{s}} سیکنڈ پہلے', id: '{{s}} dtk lalu', pt: 'há {{s}} s'
  },
  'spot.refreshQuote': {
    zh: '刷新报价', hi: 'कोट ताज़ा करें', es: 'Actualizar cotización', fr: 'Actualiser le devis', ru: 'Обновить котировку',
    tr: 'Teklifi yenile', ur: 'کوٹ تازہ کریں', id: 'Segarkan kutipan', pt: 'Atualizar cotação'
  },
  'spot.slippageInvalid': {
    zh: '滑点必须在 0.01% 到 5% 之间。', hi: 'स्लिपेज 0.01% और 5% के बीच होना चाहिए।', es: 'La tolerancia debe estar entre 0,01 % y 5 %.',
    fr: 'La tolérance doit être comprise entre 0,01 % et 5 %.', ru: 'Проскальзывание должно быть от 0,01% до 5%.', tr: 'Kayma %0,01 ile %5 arasında olmalı.',
    ur: 'سلپیج 0.01% اور 5% کے درمیان ہونی چاہیے۔', id: 'Slippage harus antara 0,01% dan 5%.', pt: 'A tolerância deve estar entre 0,01% e 5%.'
  },
  'spot.slippageHigh': {
    zh: '滑点较高：交易可能以差得多的价格成交。', hi: 'ऊँचा स्लिपेज: लेन-देन बहुत खराब कीमत पर हो सकता है।', es: 'Tolerancia alta: la operación podría ejecutarse a un precio mucho peor.',
    fr: 'Tolérance élevée : l’opération pourrait se faire à un prix bien moins bon.', ru: 'Высокое проскальзывание: сделка может пройти по гораздо худшей цене.',
    tr: 'Yüksek kayma: işlem çok daha kötü bir fiyatla gerçekleşebilir.', ur: 'زیادہ سلپیج: ٹریڈ بہت خراب قیمت پر ہو سکتی ہے۔',
    id: 'Slippage tinggi: transaksi bisa terjadi di harga yang jauh lebih buruk.', pt: 'Tolerância alta: a operação pode ser executada a um preço bem pior.'
  },
  'spot.reviewOrder': {
    zh: '查看订单', hi: 'ऑर्डर देखें', es: 'Revisar orden', fr: 'Voir l’ordre', ru: 'Проверить ордер', tr: 'Emri gözden geçir', ur: 'آرڈر دیکھیں', id: 'Tinjau order', pt: 'Revisar ordem'
  },
  'spot.review.title': {
    zh: '签名前请确认', hi: 'हस्ताक्षर से पहले जाँचें', es: 'Revisa antes de firmar', fr: 'Vérifier avant de signer', ru: 'Проверьте перед подписью',
    tr: 'İmzalamadan önce kontrol edin', ur: 'دستخط سے پہلے جائزہ لیں', id: 'Periksa sebelum menandatangani', pt: 'Revise antes de assinar'
  },
  'spot.review.action': {
    zh: '操作', hi: 'कार्य', es: 'Acción', fr: 'Action', ru: 'Действие', tr: 'İşlem', ur: 'عمل', id: 'Tindakan', pt: 'Ação'
  },
  'spot.review.back': {
    zh: '返回', hi: 'वापस', es: 'Volver', fr: 'Retour', ru: 'Назад', tr: 'Geri', ur: 'واپس', id: 'Kembali', pt: 'Voltar'
  },
  'spot.review.confirm': {
    zh: '确认并发送', hi: 'पुष्टि करें और भेजें', es: 'Confirmar y enviar', fr: 'Confirmer et envoyer', ru: 'Подтвердить и отправить',
    tr: 'Onayla ve gönder', ur: 'تصدیق کریں اور بھیجیں', id: 'Konfirmasi dan kirim', pt: 'Confirmar e enviar'
  },
  'spot.quoteExpiredReview': {
    zh: '此报价已过期。签名前请返回并刷新报价。尚未发送任何内容。',
    hi: 'यह कोट समाप्त हो गया है। हस्ताक्षर से पहले वापस जाकर कोट ताज़ा करें। अभी कुछ भी नहीं भेजा गया है।',
    es: 'Esta cotización caducó. Vuelve atrás y actualízala antes de firmar. Aún no se ha enviado nada.',
    fr: 'Ce devis a expiré. Revenez en arrière et actualisez-le avant de signer. Rien n’a encore été envoyé.',
    ru: 'Котировка истекла. Вернитесь назад и обновите её перед подписью. Ничего не отправлено.',
    tr: 'Bu teklifin süresi doldu. İmzalamadan önce geri dönüp yenileyin. Henüz hiçbir şey gönderilmedi.',
    ur: 'یہ کوٹ ختم ہو چکا ہے۔ دستخط سے پہلے واپس جا کر اسے تازہ کریں۔ ابھی کچھ نہیں بھیجا گیا۔',
    id: 'Kutipan ini kedaluwarsa. Kembali dan segarkan sebelum menandatangani. Belum ada yang dikirim.',
    pt: 'Esta cotação expirou. Volte e atualize antes de assinar. Nada foi enviado ainda.'
  },
  'spot.notice.own': {
    zh: '每一步都由您的钱包签名。平台无法转移您的资产。', hi: 'हर चरण पर हस्ताक्षर आपका वॉलेट करता है। प्लेटफ़ॉर्म आपकी संपत्ति नहीं हिला सकता।',
    es: 'Tu cartera firma cada paso. La plataforma no puede mover tus fondos.', fr: 'Votre portefeuille signe chaque étape. La plateforme ne peut pas déplacer vos fonds.',
    ru: 'Каждый шаг подписывает ваш кошелёк. Платформа не может перевести ваши средства.', tr: 'Her adımı cüzdanınız imzalar. Platform varlıklarınızı hareket ettiremez.',
    ur: 'ہر مرحلے پر دستخط آپ کا بٹوہ کرتا ہے۔ پلیٹ فارم آپ کے اثاثے منتقل نہیں کر سکتا۔',
    id: 'Dompet Anda menandatangani setiap langkah. Platform tidak dapat memindahkan dana Anda.', pt: 'Sua carteira assina cada etapa. A plataforma não pode movimentar seus fundos.'
  },
  'spot.notice.price': {
    zh: '在交易被打包前价格可能变动。“最少可得”是您接受的最低数量。',
    hi: 'लेन-देन शामिल होने से पहले कीमत बदल सकती है। “न्यूनतम प्राप्ति” वह सबसे कम राशि है जो आप स्वीकार करेंगे।',
    es: 'El precio puede cambiar antes de que la operación se incluya. El “mínimo recibido” es lo menos que aceptarás.',
    fr: 'Le prix peut bouger avant l’inclusion de l’opération. Le « minimum reçu » est le montant le plus bas que vous acceptez.',
    ru: 'Цена может измениться до включения сделки. «Минимум к получению» — наименьшая сумма, которую вы примете.',
    tr: 'İşlem dahil edilmeden önce fiyat değişebilir. “Alınacak en az miktar”, kabul edeceğiniz en düşük tutardır.',
    ur: 'ٹریڈ شامل ہونے سے پہلے قیمت بدل سکتی ہے۔ «کم از کم موصولہ» وہ سب سے کم رقم ہے جو آپ قبول کریں گے۔',
    id: 'Harga bisa berubah sebelum transaksi masuk ke blok. "Minimum diterima" adalah jumlah terendah yang Anda terima.',
    pt: 'O preço pode mudar antes de a operação ser incluída. O “mínimo recebido” é o menor valor que você aceitará.'
  },
  'spot.notice.gas': {
    zh: '网络手续费以该网络的 gas 代币支付，不可退还。', hi: 'नेटवर्क शुल्क नेटवर्क के गैस कॉइन में दिया जाता है और वापस नहीं होता।',
    es: 'Las comisiones de red se pagan en la moneda de gas de la red y no son reembolsables.', fr: 'Les frais de réseau sont payés dans la monnaie de gas du réseau et ne sont pas remboursables.',
    ru: 'Комиссия сети оплачивается в газовой монете сети и не возвращается.', tr: 'Ağ ücretleri ağın gaz parasıyla ödenir ve iade edilmez.',
    ur: 'نیٹ ورک فیس نیٹ ورک کے گیس کوائن میں ادا ہوتی ہے اور واپس نہیں ہوتی۔', id: 'Biaya jaringan dibayar dengan koin gas jaringan dan tidak dapat dikembalikan.',
    pt: 'As taxas de rede são pagas na moeda de gás da rede e não são reembolsáveis.'
  },
  'spot.status.preparing': {
    zh: '正在准备…', hi: 'तैयारी हो रही है…', es: 'Preparando…', fr: 'Préparation…', ru: 'Подготовка…', tr: 'Hazırlanıyor…', ur: 'تیاری ہو رہی ہے…', id: 'Menyiapkan…', pt: 'Preparando…'
  },
  'spot.status.approving': {
    zh: '等待您在钱包中批准…', hi: 'वॉलेट में अनुमति की प्रतीक्षा…', es: 'Esperando la aprobación en tu cartera…', fr: 'En attente de l’approbation dans votre portefeuille…',
    ru: 'Ждём подтверждения в кошельке…', tr: 'Cüzdanınızda onay bekleniyor…', ur: 'بٹوے میں منظوری کا انتظار…', id: 'Menunggu persetujuan di dompet…', pt: 'Aguardando aprovação na sua carteira…'
  },
  'spot.status.approvalSent': {
    zh: '批准已发送，等待确认…', hi: 'अनुमति भेजी गई, पुष्टि की प्रतीक्षा…', es: 'Aprobación enviada; esperando confirmación…', fr: 'Approbation envoyée ; en attente de confirmation…',
    ru: 'Разрешение отправлено; ждём подтверждения…', tr: 'Onay gönderildi; teyit bekleniyor…', ur: 'منظوری بھیج دی گئی؛ تصدیق کا انتظار…', id: 'Persetujuan terkirim; menunggu konfirmasi…', pt: 'Aprovação enviada; aguardando confirmação…'
  },
  'spot.status.quoting': {
    zh: '正在检查最新报价…', hi: 'ताज़ा कोट जाँचा जा रहा है…', es: 'Revisando la cotización más reciente…', fr: 'Vérification du dernier devis…',
    ru: 'Проверяем последнюю котировку…', tr: 'Son teklif kontrol ediliyor…', ur: 'تازہ ترین کوٹ جانچا جا رہا ہے…', id: 'Memeriksa kutipan terbaru…', pt: 'Verificando a cotação mais recente…'
  },
  'spot.status.signing': {
    zh: '等待您签名…', hi: 'आपके हस्ताक्षर की प्रतीक्षा…', es: 'Esperando tu firma…', fr: 'En attente de votre signature…', ru: 'Ждём вашу подпись…',
    tr: 'İmzanız bekleniyor…', ur: 'آپ کے دستخط کا انتظار…', id: 'Menunggu tanda tangan Anda…', pt: 'Aguardando sua assinatura…'
  },
  'spot.status.pending': {
    zh: '已发送，等待网络确认…', hi: 'भेजा गया, नेटवर्क की प्रतीक्षा…', es: 'Enviado; esperando a la red…', fr: 'Envoyé ; en attente du réseau…',
    ru: 'Отправлено; ждём сеть…', tr: 'Gönderildi; ağ bekleniyor…', ur: 'بھیج دیا گیا؛ نیٹ ورک کا انتظار…', id: 'Terkirim; menunggu jaringan…', pt: 'Enviado; aguardando a rede…'
  },
  'spot.status.confirmed': {
    zh: '兑换已确认', hi: 'स्वैप की पुष्टि हुई', es: 'Intercambio confirmado', fr: 'Échange confirmé', ru: 'Обмен подтверждён', tr: 'Takas onaylandı',
    ur: 'سواپ کی تصدیق ہو گئی', id: 'Tukar dikonfirmasi', pt: 'Troca confirmada'
  },
  'spot.status.failed': {
    zh: '未完成', hi: 'पूरा नहीं हुआ', es: 'No completado', fr: 'Non abouti', ru: 'Не выполнено', tr: 'Tamamlanamadı', ur: 'مکمل نہیں ہوا', id: 'Tidak selesai', pt: 'Não concluído'
  },
  'spot.status.cancelled': {
    zh: '已取消：您在钱包中拒绝了该请求。', hi: 'रद्द: आपने वॉलेट में इसे अस्वीकार किया।', es: 'Cancelado: lo rechazaste en tu cartera.',
    fr: 'Annulé : vous l’avez refusé dans votre portefeuille.', ru: 'Отменено: вы отклонили запрос в кошельке.', tr: 'İptal edildi: cüzdanınızda reddettiniz.',
    ur: 'منسوخ: آپ نے بٹوے میں اسے مسترد کیا۔', id: 'Dibatalkan: Anda menolaknya di dompet.', pt: 'Cancelado: você recusou na sua carteira.'
  },
  'spot.status.stale': {
    zh: '价格已变动。再次尝试前请查看新报价。', hi: 'कीमत बदल गई। फिर से कोशिश से पहले नया कोट देखें।',
    es: 'El precio cambió. Revisa la nueva cotización antes de volver a intentar.', fr: 'Le prix a changé. Vérifiez le nouveau devis avant de réessayer.',
    ru: 'Цена изменилась. Проверьте новую котировку перед повтором.', tr: 'Fiyat değişti. Tekrar denemeden önce yeni teklifi kontrol edin.',
    ur: 'قیمت بدل گئی۔ دوبارہ کوشش سے پہلے نیا کوٹ دیکھیں۔', id: 'Harga berubah. Tinjau kutipan baru sebelum mencoba lagi.', pt: 'O preço mudou. Revise a nova cotação antes de tentar de novo.'
  },
  'spot.err.WALLET_NOT_CONNECTED': {
    zh: '请先连接钱包。', hi: 'पहले अपना वॉलेट जोड़ें।', es: 'Conecta primero tu cartera.', fr: 'Connectez d’abord votre portefeuille.', ru: 'Сначала подключите кошелёк.',
    tr: 'Önce cüzdanınızı bağlayın.', ur: 'پہلے اپنا بٹوہ جوڑیں۔', id: 'Hubungkan dompet Anda terlebih dahulu.', pt: 'Conecte sua carteira primeiro.'
  },
  'spot.err.WRONG_NETWORK': {
    zh: '请先将钱包切换到此订单的网络。', hi: 'पहले वॉलेट को इस ऑर्डर के नेटवर्क पर लाएँ।', es: 'Cambia primero tu cartera a la red de esta orden.',
    fr: 'Passez d’abord votre portefeuille sur le réseau de cet ordre.', ru: 'Сначала переключите кошелёк на сеть этого ордера.', tr: 'Önce cüzdanınızı bu emrin ağına geçirin.',
    ur: 'پہلے بٹوے کو اس آرڈر کے نیٹ ورک پر لائیں۔', id: 'Ganti dompet ke jaringan order ini terlebih dahulu.', pt: 'Troque sua carteira para a rede desta ordem primeiro.'
  },
  'spot.err.INSUFFICIENT_BALANCE': {
    zh: '余额不足以支付此金额。', hi: 'इस राशि के लिए बैलेंस कम है।', es: 'Tu saldo no alcanza para esta cantidad.', fr: 'Votre solde est insuffisant pour ce montant.',
    ru: 'Баланса недостаточно для этой суммы.', tr: 'Bakiyeniz bu miktar için yetersiz.', ur: 'اس رقم کے لیے بیلنس کم ہے۔', id: 'Saldo Anda tidak cukup untuk jumlah ini.', pt: 'Seu saldo não é suficiente para este valor.'
  },
  'spot.err.INSUFFICIENT_GAS': {
    zh: '钱包中的网络代币不足以支付手续费。', hi: 'वॉलेट में नेटवर्क कॉइन कम है, शुल्क नहीं भर सकता।', es: 'Tu cartera tiene muy poca moneda de la red para pagar la comisión.',
    fr: 'Votre portefeuille manque de monnaie du réseau pour payer les frais.', ru: 'В кошельке недостаточно монет сети для оплаты комиссии.', tr: 'Cüzdanınızda ücreti ödemek için yeterli ağ parası yok.',
    ur: 'بٹوے میں فیس ادا کرنے کے لیے نیٹ ورک کوائن کم ہے۔', id: 'Koin jaringan di dompet Anda terlalu sedikit untuk membayar biaya.', pt: 'Sua carteira tem pouca moeda da rede para pagar a taxa.'
  },
  'spot.err.QUOTE_EXPIRED': {
    zh: '报价已过期，已请求新报价。签名前请查看。', hi: 'कोट समाप्त हो गया, नया कोट माँगा गया। हस्ताक्षर से पहले जाँचें।',
    es: 'La cotización caducó y se pidió una nueva. Revísala antes de firmar.', fr: 'Le devis a expiré ; un nouveau a été demandé. Vérifiez-le avant de signer.',
    ru: 'Котировка истекла, запрошена новая. Проверьте её перед подписью.', tr: 'Teklifin süresi doldu; yenisi istendi. İmzalamadan önce kontrol edin.',
    ur: 'کوٹ ختم ہو گیا، نیا کوٹ مانگا گیا۔ دستخط سے پہلے جائزہ لیں۔', id: 'Kutipan kedaluwarsa; kutipan baru diminta. Tinjau sebelum menandatangani.', pt: 'A cotação expirou; uma nova foi solicitada. Revise antes de assinar.'
  },
  'spot.err.SLIPPAGE_EXCEEDED': {
    zh: '价格超出了您设定的滑点上限。请查看新报价后再试。', hi: 'कीमत आपकी स्लिपेज सीमा से आगे निकल गई। नया कोट देखकर फिर कोशिश करें।',
    es: 'El precio superó tu límite de tolerancia. Revisa una cotización nueva e inténtalo de nuevo.', fr: 'Le prix a dépassé votre limite de tolérance. Vérifiez un nouveau devis et réessayez.',
    ru: 'Цена вышла за пределы вашего проскальзывания. Проверьте новую котировку и повторите.', tr: 'Fiyat kayma sınırınızı aştı. Yeni bir teklife bakıp tekrar deneyin.',
    ur: 'قیمت آپ کی سلپیج حد سے آگے نکل گئی۔ نیا کوٹ دیکھ کر دوبارہ کوشش کریں۔', id: 'Harga melewati batas slippage Anda. Tinjau kutipan baru lalu coba lagi.', pt: 'O preço ultrapassou seu limite de tolerância. Revise uma nova cotação e tente de novo.'
  },
  'spot.err.SLIPPAGE_INVALID': {
    zh: '滑点必须在 0.01% 到 5% 之间。', hi: 'स्लिपेज 0.01% और 5% के बीच होना चाहिए।', es: 'La tolerancia debe estar entre 0,01 % y 5 %.',
    fr: 'La tolérance doit être comprise entre 0,01 % et 5 %.', ru: 'Проскальзывание должно быть от 0,01% до 5%.', tr: 'Kayma %0,01 ile %5 arasında olmalı.',
    ur: 'سلپیج 0.01% اور 5% کے درمیان ہونی چاہیے۔', id: 'Slippage harus antara 0,01% dan 5%.', pt: 'A tolerância deve estar entre 0,01% e 5%.'
  },
  'spot.err.RPC_ERROR': {
    zh: '网络没有响应，请稍后再试。', hi: 'नेटवर्क ने जवाब नहीं दिया। थोड़ी देर बाद फिर कोशिश करें।', es: 'La red no respondió. Inténtalo de nuevo en un momento.',
    fr: 'Le réseau n’a pas répondu. Réessayez dans un instant.', ru: 'Сеть не ответила. Повторите попытку через минуту.', tr: 'Ağ yanıt vermedi. Biraz sonra tekrar deneyin.',
    ur: 'نیٹ ورک نے جواب نہیں دیا۔ کچھ دیر بعد دوبارہ کوشش کریں۔', id: 'Jaringan tidak merespons. Coba lagi sebentar lagi.', pt: 'A rede não respondeu. Tente de novo em instantes.'
  },
  'spot.err.NO_ROUTE': {
    zh: '目前找不到此交易对的路线。', hi: 'इस जोड़े के लिए अभी कोई रूट नहीं मिला।', es: 'Ahora mismo no hay ruta para este par.', fr: 'Aucun itinéraire pour cette paire pour l’instant.',
    ru: 'Сейчас маршрут для этой пары не найден.', tr: 'Bu çift için şu anda rota bulunamadı.', ur: 'اس جوڑے کے لیے ابھی کوئی راستہ نہیں ملا۔', id: 'Belum ada rute untuk pasangan ini saat ini.', pt: 'No momento não há rota para este par.'
  },
  'spot.err.NO_LIQUIDITY': {
    zh: '此金额的流动性不足。', hi: 'इस राशि के लिए पर्याप्त लिक्विडिटी नहीं है।', es: 'No hay liquidez suficiente para esta cantidad.', fr: 'Liquidité insuffisante pour ce montant.',
    ru: 'Недостаточно ликвидности для этой суммы.', tr: 'Bu miktar için yeterli likidite yok.', ur: 'اس رقم کے لیے کافی لیکویڈیٹی نہیں ہے۔', id: 'Likuiditas tidak cukup untuk jumlah ini.', pt: 'Liquidez insuficiente para este valor.'
  },
  'spot.err.QUOTE_FAILED': {
    zh: '无法获取报价，请重试。', hi: 'कोट नहीं मिल सका। फिर से कोशिश करें।', es: 'No se pudo obtener la cotización. Inténtalo de nuevo.', fr: 'Impossible d’obtenir le devis. Réessayez.',
    ru: 'Не удалось получить котировку. Повторите.', tr: 'Teklif alınamadı. Tekrar deneyin.', ur: 'کوٹ حاصل نہیں ہو سکا۔ دوبارہ کوشش کریں۔', id: 'Gagal mendapatkan kutipan. Coba lagi.', pt: 'Não foi possível obter a cotação. Tente de novo.'
  },
  'spot.err.QUOTE_NETWORK': {
    zh: '无法连接报价服务，请重试。', hi: 'कोट सेवा तक पहुँच नहीं हो सकी। फिर से कोशिश करें।', es: 'No se pudo conectar con el servicio de cotización. Inténtalo de nuevo.',
    fr: 'Impossible de joindre le service de devis. Réessayez.', ru: 'Не удалось связаться с сервисом котировок. Повторите.', tr: 'Teklif servisine ulaşılamadı. Tekrar deneyin.',
    ur: 'کوٹ سروس تک رسائی نہیں ہو سکی۔ دوبارہ کوشش کریں۔', id: 'Tidak dapat menjangkau layanan kutipan. Coba lagi.', pt: 'Não foi possível acessar o serviço de cotação. Tente de novo.'
  },
  'spot.err.AMOUNT_REQUIRED': {
    zh: '请输入金额。', hi: 'राशि दर्ज करें।', es: 'Introduce una cantidad.', fr: 'Saisissez un montant.', ru: 'Введите сумму.', tr: 'Bir miktar girin.', ur: 'رقم درج کریں۔', id: 'Masukkan jumlah.', pt: 'Digite um valor.'
  },
  'spot.err.INVALID_AMOUNT': {
    zh: '请输入有效的数字。', hi: 'मान्य संख्या दर्ज करें।', es: 'Introduce un número válido.', fr: 'Saisissez un nombre valide.', ru: 'Введите корректное число.',
    tr: 'Geçerli bir sayı girin.', ur: 'درست عدد درج کریں۔', id: 'Masukkan angka yang valid.', pt: 'Digite um número válido.'
  },
  'spot.err.AMOUNT_ZERO': {
    zh: '金额必须大于零。', hi: 'राशि शून्य से अधिक होनी चाहिए।', es: 'La cantidad debe ser mayor que cero.', fr: 'Le montant doit être supérieur à zéro.',
    ru: 'Сумма должна быть больше нуля.', tr: 'Miktar sıfırdan büyük olmalı.', ur: 'رقم صفر سے زیادہ ہونی چاہیے۔', id: 'Jumlah harus lebih dari nol.', pt: 'O valor deve ser maior que zero.'
  },
  'spot.err.TOO_MANY_DECIMALS': {
    zh: '此代币最多 {{decimals}} 位小数。', hi: 'इस टोकन में अधिकतम {{decimals}} दशमलव स्थान हैं।', es: 'Este token admite como máximo {{decimals}} decimales.',
    fr: 'Ce token accepte au maximum {{decimals}} décimales.', ru: 'У этого токена не более {{decimals}} знаков после запятой.', tr: 'Bu token en fazla {{decimals}} ondalık basamak destekler.',
    ur: 'اس ٹوکن میں زیادہ سے زیادہ {{decimals}} اعشاری ہندسے ہیں۔', id: 'Token ini mendukung paling banyak {{decimals}} desimal.', pt: 'Este token aceita no máximo {{decimals}} casas decimais.'
  },
  'spot.err.TX_FAILED': {
    zh: '交易未完成。', hi: 'लेन-देन पूरा नहीं हुआ।', es: 'La transacción no se completó.', fr: 'La transaction n’a pas abouti.', ru: 'Транзакция не выполнена.',
    tr: 'İşlem tamamlanamadı.', ur: 'ٹرانزیکشن مکمل نہیں ہوئی۔', id: 'Transaksi tidak selesai.', pt: 'A transação não foi concluída.'
  },
  'spot.err.TX_REVERTED': {
    zh: '网络拒绝了该交易。详情请查看浏览器链接。', hi: 'नेटवर्क ने लेन-देन अस्वीकार किया। विवरण के लिए एक्सप्लोरर लिंक देखें।',
    es: 'La red rechazó la transacción. Revisa el enlace del explorador para ver los detalles.', fr: 'Le réseau a rejeté la transaction. Consultez le lien de l’explorateur pour les détails.',
    ru: 'Сеть отклонила транзакцию. Подробности — по ссылке в обозревателе.', tr: 'Ağ işlemi reddetti. Ayrıntılar için gezgin bağlantısına bakın.',
    ur: 'نیٹ ورک نے ٹرانزیکشن مسترد کی۔ تفصیل کے لیے ایکسپلورر لنک دیکھیں۔', id: 'Jaringan menolak transaksi. Lihat tautan penjelajah untuk detailnya.',
    pt: 'A rede rejeitou a transação. Veja o link do explorador para detalhes.'
  },
  'spot.err.USER_REJECTED': {
    zh: '您在钱包中拒绝了该请求。', hi: 'आपने वॉलेट में इसे अस्वीकार किया।', es: 'Lo rechazaste en tu cartera.', fr: 'Vous l’avez refusé dans votre portefeuille.',
    ru: 'Вы отклонили запрос в кошельке.', tr: 'Cüzdanınızda reddettiniz.', ur: 'آپ نے بٹوے میں اسے مسترد کیا۔', id: 'Anda menolaknya di dompet.', pt: 'Você recusou na sua carteira.'
  },
  'spot.err.PRICE_MOVED': {
    zh: '价格已变动。签名前请查看新报价。', hi: 'कीमत बदल गई। हस्ताक्षर से पहले नया कोट देखें।', es: 'El precio cambió. Revisa la nueva cotización antes de firmar.',
    fr: 'Le prix a changé. Vérifiez le nouveau devis avant de signer.', ru: 'Цена изменилась. Проверьте новую котировку перед подписью.', tr: 'Fiyat değişti. İmzalamadan önce yeni teklifi kontrol edin.',
    ur: 'قیمت بدل گئی۔ دستخط سے پہلے نیا کوٹ دیکھیں۔', id: 'Harga berubah. Tinjau kutipan baru sebelum menandatangani.', pt: 'O preço mudou. Revise a nova cotação antes de assinar.'
  },
  'spot.err.ROUTE_CHANGED': {
    zh: '路线已变更。签名前请查看新报价。', hi: 'रूट बदल गया। हस्ताक्षर से पहले नया कोट देखें।', es: 'La ruta cambió. Revisa la nueva cotización antes de firmar.',
    fr: 'L’itinéraire a changé. Vérifiez le nouveau devis avant de signer.', ru: 'Маршрут изменился. Проверьте новую котировку перед подписью.', tr: 'Rota değişti. İmzalamadan önce yeni teklifi kontrol edin.',
    ur: 'راستہ بدل گیا۔ دستخط سے پہلے نیا کوٹ دیکھیں۔', id: 'Rute berubah. Tinjau kutipan baru sebelum menandatangani.', pt: 'A rota mudou. Revise a nova cotação antes de assinar.'
  },
  'spot.err.CONFIRMATION_TIMEOUT': {
    zh: '网络确认时间较长。请通过浏览器链接查看。', hi: 'नेटवर्क की पुष्टि में देर हो रही है। एक्सप्लोरर लिंक से जाँचें।', es: 'La red tarda en confirmar. Revisa el enlace del explorador.',
    fr: 'La confirmation du réseau tarde. Consultez le lien de l’explorateur.', ru: 'Сеть подтверждает долго. Проверьте по ссылке в обозревателе.', tr: 'Ağın onayı uzun sürüyor. Gezgin bağlantısından kontrol edin.',
    ur: 'نیٹ ورک کی تصدیق میں دیر ہو رہی ہے۔ ایکسپلورر لنک سے دیکھیں۔', id: 'Jaringan butuh waktu lama untuk konfirmasi. Cek lewat tautan penjelajah.', pt: 'A rede está demorando para confirmar. Verifique pelo link do explorador.'
  },
  'spot.err.FEE_NOT_APPLIED': {
    zh: '平台手续费未能应用，因此未发送任何内容。', hi: 'प्लेटफ़ॉर्म शुल्क लागू नहीं हो सका, इसलिए कुछ भी नहीं भेजा गया।',
    es: 'No se pudo aplicar la comisión de la plataforma, así que no se envió nada.', fr: 'Les frais de la plateforme n’ont pas pu être appliqués ; rien n’a été envoyé.',
    ru: 'Комиссию платформы не удалось применить, поэтому ничего не отправлено.', tr: 'Platform ücreti uygulanamadı, bu yüzden hiçbir şey gönderilmedi.',
    ur: 'پلیٹ فارم فیس لاگو نہیں ہو سکی، اس لیے کچھ نہیں بھیجا گیا۔', id: 'Biaya platform tidak dapat diterapkan, sehingga tidak ada yang dikirim.', pt: 'A taxa da plataforma não pôde ser aplicada, então nada foi enviado.'
  },
  'spot.err.FEE_RECIPIENT_MISMATCH': {
    zh: '手续费接收地址不一致，因此未发送任何内容。', hi: 'शुल्क का गंतव्य मेल नहीं खाया, इसलिए कुछ भी नहीं भेजा गया।',
    es: 'El destino de la comisión no coincide, así que no se envió nada.', fr: 'La destination des frais ne correspond pas ; rien n’a été envoyé.',
    ru: 'Получатель комиссии не совпал, поэтому ничего не отправлено.', tr: 'Ücret alıcısı eşleşmedi, bu yüzden hiçbir şey gönderilmedi.',
    ur: 'فیس کی منزل مماثل نہیں، اس لیے کچھ نہیں بھیجا گیا۔', id: 'Tujuan biaya tidak cocok, sehingga tidak ada yang dikirim.', pt: 'O destino da taxa não confere, então nada foi enviado.'
  }
};
