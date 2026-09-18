/**
 * Product surfaces: swap, market, coin detail, signals, news, notifications,
 * welcome, onboarding and guide chrome — plus every safety and legal warning.
 *
 * The warnings are the reason this file is hand-written rather than machine
 * translated. A mistranslated menu label is an annoyance; a mistranslated
 * sentence about irreversible transactions or gambling law is a person losing
 * money or breaking the law while believing the app told them it was fine.
 * Where a warning is not translated we deliberately fall back to English
 * rather than guess.
 */
export default {
  /* ------------------------------- market ----------------------------- */
  'market.totalMcap': { zh: '总市值', hi: 'कुल मार्केट कैप', es: 'Cap. total', fr: 'Cap. totale', ru: 'Общая капитализация', tr: 'Toplam piyasa değeri', ur: 'کل مارکیٹ کیپ', id: 'Total kapitalisasi', pt: 'Cap. total' },
  'market.volume24h': { zh: '24小时成交额', hi: '24घं वॉल्यूम', es: 'Volumen 24h', fr: 'Volume 24h', ru: 'Объём 24ч', tr: '24s hacim', ur: '٢٤ گھنٹے حجم', id: 'Volume 24j', pt: 'Volume 24h' },
  'market.btcDominance': { zh: 'BTC 占比', hi: 'BTC प्रभुत्व', es: 'Dominancia BTC', fr: 'Dominance BTC', ru: 'Доминация BTC', tr: 'BTC hakimiyeti', ur: 'BTC غلبہ', id: 'Dominasi BTC', pt: 'Domínio BTC' },
  'market.ethDominance': { zh: 'ETH 占比', hi: 'ETH प्रभुत्व', es: 'Dominancia ETH', fr: 'Dominance ETH', ru: 'Доминация ETH', tr: 'ETH hakimiyeti', ur: 'ETH غلبہ', id: 'Dominasi ETH', pt: 'Domínio ETH' },
  'market.coins': { zh: '币种', hi: 'सिक्के', es: 'Monedas', fr: 'Cryptos', ru: 'Монеты', tr: 'Coinler', ur: 'سکے', id: 'Koin', pt: 'Moedas' },
  'market.markets': { zh: '市场', hi: 'बाज़ार', es: 'Mercados', fr: 'Marchés', ru: 'Рынки', tr: 'Piyasalar', ur: 'مارکیٹس', id: 'Pasar', pt: 'Mercados' },
  'market.avgChange': { zh: '平均涨跌', hi: 'औसत बदलाव', es: 'Cambio medio', fr: 'Variation moy.', ru: 'Среднее изм.', tr: 'Ort. değişim', ur: 'اوسط تبدیلی', id: 'Perubahan rata-rata', pt: 'Variação média' },
  'market.trending': { zh: '热门', hi: 'ट्रेंडिंग', es: 'Tendencias', fr: 'Tendances', ru: 'В тренде', tr: 'Öne çıkan', ur: 'ٹرینڈنگ', id: 'Tren', pt: 'Em alta' },
  'market.allCoins': { zh: '全部币种', hi: 'सभी सिक्के', es: 'Todas las monedas', fr: 'Toutes les cryptos', ru: 'Все монеты', tr: 'Tüm coinler', ur: 'تمام سکے', id: 'Semua koin', pt: 'Todas as moedas' },
  'market.search': { zh: '搜索币种…', hi: 'सिक्के खोजें…', es: 'Buscar monedas…', fr: 'Rechercher…', ru: 'Поиск монет…', tr: 'Coin ara…', ur: 'سکے تلاش کریں…', id: 'Cari koin…', pt: 'Pesquisar moedas…' },
  'market.noResults': { zh: '没有匹配的结果', hi: 'कोई परिणाम नहीं', es: 'Sin resultados', fr: 'Aucun résultat', ru: 'Ничего не найдено', tr: 'Sonuç yok', ur: 'کوئی نتیجہ نہیں', id: 'Tidak ada hasil', pt: 'Sem resultados' },
  'market.searching': { zh: '正在搜索全部币种…', hi: 'सभी सिक्कों में खोज रहे हैं…', es: 'Buscando en todas las monedas…', fr: 'Recherche dans toutes les cryptos…', ru: 'Поиск по всем монетам…', tr: 'Tüm coinlerde aranıyor…', ur: 'تمام سکوں میں تلاش…', id: 'Mencari semua koin…', pt: 'A pesquisar todas as moedas…' },
  'market.moreResults': { zh: '来自全市场的更多结果', hi: 'पूरे बाज़ार से और परिणाम', es: 'Más resultados del mercado completo', fr: 'Autres résultats du marché complet', ru: 'Ещё результаты по всему рынку', tr: 'Tüm piyasadan daha fazla sonuç', ur: 'پوری مارکیٹ سے مزید نتائج', id: 'Hasil lain dari seluruh pasar', pt: 'Mais resultados de todo o mercado' },
  'market.filter.all': { zh: '全部', hi: 'सभी', es: 'Todo', fr: 'Tout', ru: 'Все', tr: 'Tümü', ur: 'سب', id: 'Semua', pt: 'Tudo' },
  'market.filter.gainers': { zh: '涨幅榜', hi: 'बढ़त', es: 'Ganadores', fr: 'Hausses', ru: 'Растущие', tr: 'Yükselenler', ur: 'بڑھنے والے', id: 'Penguat', pt: 'Em alta' },
  'market.filter.losers': { zh: '跌幅榜', hi: 'गिरावट', es: 'Perdedores', fr: 'Baisses', ru: 'Падающие', tr: 'Düşenler', ur: 'گرنے والے', id: 'Pelemah', pt: 'Em baixa' },
  'market.filter.favorites': { zh: '收藏', hi: 'पसंदीदा', es: 'Favoritos', fr: 'Favoris', ru: 'Избранное', tr: 'Favoriler', ur: 'پسندیدہ', id: 'Favorit', pt: 'Favoritos' },
  'market.filter.volume': { zh: '成交额', hi: 'वॉल्यूम', es: 'Volumen', fr: 'Volume', ru: 'Объём', tr: 'Hacim', ur: 'حجم', id: 'Volume', pt: 'Volume' },

  /* -------------------------------- coin ------------------------------ */
  'coin.notFound': { zh: '找不到该币种', hi: 'सिक्का नहीं मिला', es: 'Moneda no encontrada', fr: 'Crypto introuvable', ru: 'Монета не найдена', tr: 'Coin bulunamadı', ur: 'سکہ نہیں ملا', id: 'Koin tidak ditemukan', pt: 'Moeda não encontrada' },
  'coin.high24h': { zh: '24小时最高', hi: '24घं उच्च', es: 'Máx. 24h', fr: 'Haut 24h', ru: 'Макс. 24ч', tr: '24s en yüksek', ur: '٢٤ گھنٹے بلند', id: 'Tertinggi 24j', pt: 'Máx. 24h' },
  'coin.low24h': { zh: '24小时最低', hi: '24घं निम्न', es: 'Mín. 24h', fr: 'Bas 24h', ru: 'Мин. 24ч', tr: '24s en düşük', ur: '٢٤ گھنٹے کم', id: 'Terendah 24j', pt: 'Mín. 24h' },
  'coin.mcap': { zh: '市值', hi: 'मार्केट कैप', es: 'Capitalización', fr: 'Capitalisation', ru: 'Капитализация', tr: 'Piyasa değeri', ur: 'مارکیٹ کیپ', id: 'Kapitalisasi', pt: 'Capitalização' },
  'coin.volume': { zh: '成交额', hi: 'वॉल्यूम', es: 'Volumen', fr: 'Volume', ru: 'Объём', tr: 'Hacim', ur: 'حجم', id: 'Volume', pt: 'Volume' },
  'coin.change1h': { zh: '1小时', hi: '1घं बदलाव', es: 'Cambio 1h', fr: 'Var. 1h', ru: 'Изм. 1ч', tr: '1s değişim', ur: '١ گھنٹہ', id: 'Perubahan 1j', pt: 'Var. 1h' },
  'coin.change7d': { zh: '7天', hi: '7दिन बदलाव', es: 'Cambio 7d', fr: 'Var. 7j', ru: 'Изм. 7д', tr: '7g değişim', ur: '٧ دن', id: 'Perubahan 7h', pt: 'Var. 7d' },
  'coin.supply': { zh: '流通量', hi: 'सप्लाई', es: 'Suministro', fr: 'Offre', ru: 'Предложение', tr: 'Arz', ur: 'سپلائی', id: 'Pasokan', pt: 'Fornecimento' },
  'coin.fromAth': { zh: '距历史高点', hi: 'ATH से', es: 'Desde máx. histórico', fr: 'Depuis l\'ATH', ru: 'От максимума', tr: 'ATH\'den', ur: 'ATH سے', id: 'Dari ATH', pt: 'Desde o máximo' },
  'coin.notFoundHelp': {
    zh: '该币种不在已加载的列表中，直接查询也没有返回。通常是数据服务正在限流——请稍后重试。',
    hi: 'यह सिक्का लोड की गई सूची में नहीं था और सीधा अनुरोध भी विफल रहा। आमतौर पर डेटा सेवा दर सीमित कर रही होती है — थोड़ी देर बाद फिर कोशिश करें।',
    es: 'Esta moneda no estaba en la página cargada y la consulta directa tampoco respondió. Suele significar que el proveedor de datos está limitando peticiones: inténtalo en un momento.',
    fr: 'Cette crypto n\'était pas dans la page chargée et la requête directe n\'a pas répondu non plus. Cela signifie généralement que le fournisseur de données limite les requêtes : réessayez dans un instant.',
    ru: 'Этой монеты не было в загруженной странице, и прямой запрос тоже не ответил. Обычно это значит, что поставщик данных ограничивает запросы — попробуйте через минуту.',
    tr: 'Bu coin yüklü listede yoktu ve doğrudan sorgu da yanıt vermedi. Genellikle veri sağlayıcı istekleri sınırlıyordur — birazdan tekrar deneyin.',
    ur: 'یہ سکہ لوڈ شدہ فہرست میں نہیں تھا اور براہ راست درخواست بھی ناکام رہی۔ عام طور پر ڈیٹا سروس درخواستیں محدود کر رہی ہوتی ہے — تھوڑی دیر بعد کوشش کریں۔',
    id: 'Koin ini tidak ada di halaman yang dimuat dan permintaan langsung juga tidak menjawab. Biasanya penyedia data sedang membatasi — coba lagi sebentar.',
    pt: 'Esta moeda não estava na página carregada e a consulta direta também não respondeu. Normalmente o fornecedor de dados está a limitar pedidos — tente de novo daqui a pouco.'
  },

  /* -------------------------------- swap ------------------------------ */
  'swap.title': { zh: '兑换', hi: 'स्वैप', es: 'Intercambiar', fr: 'Échanger', ru: 'Обмен', tr: 'Takas', ur: 'سویپ', id: 'Tukar', pt: 'Trocar' },
  'swap.from': { zh: '支付', hi: 'से', es: 'Desde', fr: 'De', ru: 'Отдаёте', tr: 'Gönderilen', ur: 'سے', id: 'Dari', pt: 'De' },
  'swap.to': { zh: '获得', hi: 'को', es: 'A', fr: 'Vers', ru: 'Получаете', tr: 'Alınan', ur: 'کو', id: 'Ke', pt: 'Para' },
  'swap.balance': { zh: '余额', hi: 'बैलेंस', es: 'Saldo', fr: 'Solde', ru: 'Баланс', tr: 'Bakiye', ur: 'بیلنس', id: 'Saldo', pt: 'Saldo' },
  'swap.rate': { zh: '汇率', hi: 'दर', es: 'Tasa', fr: 'Taux', ru: 'Курс', tr: 'Kur', ur: 'شرح', id: 'Kurs', pt: 'Taxa' },
  'swap.minReceived': { zh: '最少获得', hi: 'न्यूनतम प्राप्ति', es: 'Mínimo recibido', fr: 'Minimum reçu', ru: 'Минимум к получению', tr: 'En az alınacak', ur: 'کم از کم وصولی', id: 'Minimal diterima', pt: 'Mínimo recebido' },
  'swap.priceImpact': { zh: '价格影响', hi: 'प्राइस इम्पैक्ट', es: 'Impacto en precio', fr: 'Impact prix', ru: 'Влияние на цену', tr: 'Fiyat etkisi', ur: 'قیمت پر اثر', id: 'Dampak harga', pt: 'Impacto no preço' },
  'swap.networkFee': { zh: '网络费', hi: 'नेटवर्क फ़ीस', es: 'Comisión de red', fr: 'Frais de réseau', ru: 'Комиссия сети', tr: 'Ağ ücreti', ur: 'نیٹ ورک فیس', id: 'Biaya jaringan', pt: 'Taxa de rede' },
  'swap.route': { zh: '路径', hi: 'रूट', es: 'Ruta', fr: 'Route', ru: 'Маршрут', tr: 'Rota', ur: 'راستہ', id: 'Rute', pt: 'Rota' },
  'swap.review': { zh: '查看并确认', hi: 'समीक्षा करें', es: 'Revisar', fr: 'Vérifier', ru: 'Проверить', tr: 'İncele', ur: 'جائزہ لیں', id: 'Tinjau', pt: 'Rever' },
  'swap.quoting': { zh: '报价中…', hi: 'दर मिल रही है…', es: 'Cotizando…', fr: 'Cotation…', ru: 'Расчёт…', tr: 'Fiyat alınıyor…', ur: 'قیمت لی جا رہی ہے…', id: 'Mengambil kurs…', pt: 'A cotar…' },
  'swap.selectToken': { zh: '选择代币', hi: 'टोकन चुनें', es: 'Elegir token', fr: 'Choisir un token', ru: 'Выбрать токен', tr: 'Token seç', ur: 'ٹوکن منتخب کریں', id: 'Pilih token', pt: 'Escolher token' },
  'swap.settings': { zh: '兑换设置', hi: 'स्वैप सेटिंग्स', es: 'Ajustes de intercambio', fr: 'Réglages d\'échange', ru: 'Настройки обмена', tr: 'Takas ayarları', ur: 'سویپ ترتیبات', id: 'Pengaturan tukar', pt: 'Definições de troca' },
  'swap.slippage': { zh: '滑点容忍度', hi: 'स्लिपेज', es: 'Deslizamiento', fr: 'Slippage', ru: 'Проскальзывание', tr: 'Kayma', ur: 'سلپیج', id: 'Slippage', pt: 'Derrapagem' },
  'swap.confirmTitle': { zh: '确认兑换', hi: 'स्वैप की पुष्टि', es: 'Confirmar intercambio', fr: 'Confirmer l\'échange', ru: 'Подтвердить обмен', tr: 'Takası onayla', ur: 'سویپ کی تصدیق', id: 'Konfirmasi tukar', pt: 'Confirmar troca' },
  'swap.confirmSwap': { zh: '确认兑换', hi: 'स्वैप करें', es: 'Confirmar intercambio', fr: 'Confirmer l\'échange', ru: 'Подтвердить обмен', tr: 'Takası onayla', ur: 'سویپ کی تصدیق', id: 'Konfirmasi tukar', pt: 'Confirmar troca' },
  'swap.youPay': { zh: '你支付', hi: 'आप देंगे', es: 'Pagas', fr: 'Vous payez', ru: 'Вы отдаёте', tr: 'Ödersiniz', ur: 'آپ دیں گے', id: 'Anda bayar', pt: 'Você paga' },
  'swap.youReceive': { zh: '你获得', hi: 'आप पाएँगे', es: 'Recibes', fr: 'Vous recevez', ru: 'Вы получите', tr: 'Alırsınız', ur: 'آپ کو ملے گا', id: 'Anda terima', pt: 'Você recebe' },
  'swap.recipient': { zh: '接收地址', hi: 'प्राप्तकर्ता', es: 'Destinatario', fr: 'Destinataire', ru: 'Получатель', tr: 'Alıcı', ur: 'وصول کنندہ', id: 'Penerima', pt: 'Destinatário' },
  'swap.viewOnExplorer': { zh: '在区块浏览器查看', hi: 'एक्सप्लोरर में देखें', es: 'Ver en el explorador', fr: 'Voir sur l\'explorateur', ru: 'Посмотреть в обозревателе', tr: 'Gezginde görüntüle', ur: 'ایکسپلورر میں دیکھیں', id: 'Lihat di explorer', pt: 'Ver no explorador' },
  'swap.dontClose': { zh: '请勿关闭此页面。', hi: 'यह स्क्रीन बंद न करें।', es: 'No cierres esta pantalla.', fr: 'Ne fermez pas cet écran.', ru: 'Не закрывайте этот экран.', tr: 'Bu ekranı kapatmayın.', ur: 'یہ اسکرین بند نہ کریں۔', id: 'Jangan tutup layar ini.', pt: 'Não feche este ecrã.' },
  'swap.success': { zh: '兑换成功', hi: 'स्वैप पूरा हुआ', es: 'Intercambio completado', fr: 'Échange effectué', ru: 'Обмен выполнен', tr: 'Takas tamamlandı', ur: 'سویپ مکمل', id: 'Tukar berhasil', pt: 'Troca concluída' },
  'swap.notConnected': { zh: '钱包未连接', hi: 'वॉलेट कनेक्ट नहीं है', es: 'Cartera no conectada', fr: 'Portefeuille non connecté', ru: 'Кошелёк не подключён', tr: 'Cüzdan bağlı değil', ur: 'والٹ منسلک نہیں', id: 'Dompet belum terhubung', pt: 'Carteira não ligada' },
  'swap.insufficient': { zh: '余额不足', hi: 'बैलेंस पर्याप्त नहीं', es: 'Saldo insuficiente', fr: 'Solde insuffisant', ru: 'Недостаточно средств', tr: 'Yetersiz bakiye', ur: 'ناکافی بیلنس', id: 'Saldo tidak cukup', pt: 'Saldo insuficiente' },
  'swap.flip': { zh: '交换两种代币', hi: 'दोनों टोकन बदलें', es: 'Invertir los dos tokens', fr: 'Inverser les deux tokens', ru: 'Поменять токены местами', tr: 'İki tokeni değiştir', ur: 'دونوں ٹوکن بدلیں', id: 'Tukar kedua token', pt: 'Inverter os dois tokens' },
  'swap.searchToken': {
    zh: '搜索名称、代号或粘贴合约地址…', hi: 'नाम, प्रतीक खोजें या कॉन्ट्रैक्ट पता पेस्ट करें…',
    es: 'Busca por nombre, símbolo o pega una dirección…', fr: 'Rechercher un nom, un symbole ou coller une adresse…',
    ru: 'Поиск по названию, тикеру или вставьте адрес…', tr: 'Ad, sembol arayın veya sözleşme adresi yapıştırın…',
    ur: 'نام، علامت تلاش کریں یا کنٹریکٹ ایڈریس پیسٹ کریں…', id: 'Cari nama, simbol, atau tempel alamat kontrak…',
    pt: 'Pesquise nome, símbolo ou cole um endereço…'
  },
  'swap.tokensAvailable': { zh: '本网络有 {{n}} 个可兑换代币', hi: 'इस नेटवर्क पर {{n}} टोकन उपलब्ध', es: '{{n}} tokens intercambiables en esta red', fr: '{{n}} tokens échangeables sur ce réseau', ru: '{{n}} токенов доступно в этой сети', tr: 'Bu ağda {{n}} takas edilebilir token', ur: 'اس نیٹ ورک پر {{n}} ٹوکن', id: '{{n}} token dapat ditukar di jaringan ini', pt: '{{n}} tokens trocáveis nesta rede' },
  'swap.loadingList': { zh: '正在更新代币列表…', hi: 'टोकन सूची अपडेट हो रही है…', es: 'Actualizando lista de tokens…', fr: 'Mise à jour de la liste…', ru: 'Обновление списка токенов…', tr: 'Token listesi güncelleniyor…', ur: 'ٹوکن فہرست اپ ڈیٹ ہو رہی ہے…', id: 'Memperbarui daftar token…', pt: 'A atualizar lista de tokens…' },
  'swap.verified': { zh: '已核实', hi: 'सत्यापित', es: 'Verificado', fr: 'Vérifié', ru: 'Проверен', tr: 'Doğrulanmış', ur: 'تصدیق شدہ', id: 'Terverifikasi', pt: 'Verificado' },
  'swap.imported': { zh: '已导入', hi: 'इम्पोर्ट किया', es: 'Importado', fr: 'Importé', ru: 'Импортирован', tr: 'İçe aktarıldı', ur: 'درآمد شدہ', id: 'Diimpor', pt: 'Importado' },
  'swap.importTitle': { zh: '通过合约地址导入代币', hi: 'पते से टोकन इम्पोर्ट करें', es: 'Importar token por dirección', fr: 'Importer un token par adresse', ru: 'Импорт токена по адресу', tr: 'Adresle token içe aktar', ur: 'ایڈریس سے ٹوکن شامل کریں', id: 'Impor token dengan alamat', pt: 'Importar token por endereço' },
  'swap.importAction': { zh: '导入此代币', hi: 'यह टोकन इम्पोर्ट करें', es: 'Importar este token', fr: 'Importer ce token', ru: 'Импортировать токен', tr: 'Bu tokeni içe aktar', ur: 'یہ ٹوکن شامل کریں', id: 'Impor token ini', pt: 'Importar este token' },
  'swap.importing': { zh: '正在从链上读取…', hi: 'चेन से पढ़ रहे हैं…', es: 'Leyendo de la cadena…', fr: 'Lecture depuis la chaîne…', ru: 'Чтение из сети…', tr: 'Zincirden okunuyor…', ur: 'چین سے پڑھا جا رہا ہے…', id: 'Membaca dari rantai…', pt: 'A ler da cadeia…' },
  'swap.noTokenResults': {
    zh: '未找到代币。如果你有合约地址，粘贴它即可导入。', hi: 'कोई टोकन नहीं मिला। कॉन्ट्रैक्ट पता हो तो पेस्ट करके इम्पोर्ट करें।',
    es: 'No se encontró el token. Si tienes la dirección del contrato, pégala para importarlo.', fr: 'Aucun token trouvé. Si vous avez l\'adresse du contrat, collez-la pour l\'importer.',
    ru: 'Токен не найден. Если у вас есть адрес контракта, вставьте его для импорта.', tr: 'Token bulunamadı. Sözleşme adresiniz varsa yapıştırıp içe aktarın.',
    ur: 'کوئی ٹوکن نہیں ملا۔ کنٹریکٹ ایڈریس ہو تو پیسٹ کر کے شامل کریں۔', id: 'Token tidak ditemukan. Tempel alamat kontrak untuk mengimpor.',
    pt: 'Token não encontrado. Se tiver o endereço do contrato, cole-o para importar.'
  },
  'swap.gasTitle': { zh: '各链的网络费', hi: 'हर नेटवर्क की फ़ीस', es: 'Comisión de red en cada cadena', fr: 'Frais de réseau par chaîne', ru: 'Комиссия сети на каждой сети', tr: 'Her zincirde ağ ücreti', ur: 'ہر نیٹ ورک پر فیس', id: 'Biaya jaringan tiap rantai', pt: 'Taxa de rede em cada cadeia' },

  /* ---- Safety-critical. Hand-written; English fallback if uncertain. ---- */
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
  'swap.unverifiedWarning': {
    zh: '{{symbol}} 未经我们人工核实。出现在列表中不代表背书——兑换前请对照项目官网核对合约地址。',
    hi: '{{symbol}} हमने मैन्युअली सत्यापित नहीं किया। सूची में होना सिफ़ारिश नहीं है — स्वैप से पहले कॉन्ट्रैक्ट पता जाँचें।',
    es: '{{symbol}} no ha sido verificado manualmente por nosotros. Estar en una lista no es un aval: comprueba la dirección del contrato antes de intercambiar.',
    fr: '{{symbol}} n\'a pas été vérifié manuellement par nos soins. Figurer dans une liste n\'est pas une recommandation : vérifiez l\'adresse du contrat.',
    ru: '{{symbol}} не проверен нами вручную. Наличие в списке — не рекомендация: сверьте адрес контракта перед обменом.',
    tr: '{{symbol}} tarafımızca elle doğrulanmadı. Listede olmak onay değildir — takas öncesi sözleşme adresini kontrol edin.',
    ur: '{{symbol}} کی ہم نے دستی تصدیق نہیں کی۔ فہرست میں ہونا توثیق نہیں — سویپ سے پہلے کنٹریکٹ ایڈریس چیک کریں۔',
    id: '{{symbol}} belum kami verifikasi manual. Ada di daftar bukan rekomendasi — periksa alamat kontrak sebelum menukar.',
    pt: '{{symbol}} não foi verificado manualmente por nós. Estar numa lista não é um aval — verifique o endereço do contrato antes de trocar.'
  },
  'swap.gasBody': {
    zh: '网络费（Gas）始终以所在链的原生币支付，并从同一个钱包扣除——不只是 BNB。要在某条链上兑换，你需要持有下方对应的币。',
    hi: 'गैस हमेशा उसी नेटवर्क के मूल सिक्के में, उसी वॉलेट से चुकाई जाती है — केवल BNB नहीं। किसी चेन पर स्वैप के लिए नीचे दिया सिक्का चाहिए।',
    es: 'El gas siempre se paga en la moneda nativa de la red y desde la misma cartera; no es solo BNB. Para intercambiar en una cadena necesitas algo de la moneda indicada abajo.',
    fr: 'Le gas est toujours payé dans la monnaie native du réseau, depuis le même portefeuille — pas seulement en BNB. Pour échanger sur une chaîne, il vous faut la monnaie indiquée ci-dessous.',
    ru: 'Газ всегда оплачивается родной монетой сети из того же кошелька — не только BNB. Для обмена в сети нужна указанная ниже монета.',
    tr: 'Gas her zaman bulunduğunuz ağın yerel coini ile ve aynı cüzdandan ödenir — sadece BNB değil. Bir zincirde takas için aşağıdaki coinden gerekir.',
    ur: 'گیس ہمیشہ اسی نیٹ ورک کے مقامی سکے میں اور اسی والٹ سے ادا ہوتی ہے — صرف BNB نہیں۔',
    id: 'Gas selalu dibayar dengan koin asli jaringan dari dompet yang sama — bukan hanya BNB. Untuk menukar di suatu rantai Anda perlu koin di bawah ini.',
    pt: 'O gás é sempre pago na moeda nativa da rede, a partir da mesma carteira — não é só BNB. Para trocar numa cadeia precisa da moeda indicada abaixo.'
  },
  'swap.gasNote': {
    zh: 'Gas 归区块链验证者所有，不归我们，且与 {{fee}}% 平台费无关。如果你在某条链上没有原生币，请切换到你持有原生币的链。',
    hi: 'गैस ब्लॉकचेन वैलिडेटर को जाता है, हमें नहीं, और यह {{fee}}% प्लेटफ़ॉर्म फ़ीस से अलग है। किसी चेन का मूल सिक्का न हो तो दूसरी चेन चुनें।',
    es: 'El gas va a los validadores de la cadena, no a nosotros, y es independiente de la comisión del {{fee}}%. Si no tienes la moneda nativa de una cadena, cambia a otra donde sí la tengas.',
    fr: 'Le gas revient aux validateurs, pas à nous, et il est distinct des {{fee}}% de frais. Si vous n\'avez pas la monnaie native d\'une chaîne, changez de réseau.',
    ru: 'Газ идёт валидаторам сети, а не нам, и не связан с комиссией {{fee}}%. Если родной монеты нет — переключитесь на сеть, где она есть.',
    tr: 'Gas ağ doğrulayıcılarına gider, bize değil, ve {{fee}}% platform ücretinden ayrıdır. Bir zincirin yerel coini yoksa sahip olduğunuz bir zincire geçin.',
    ur: 'گیس بلاک چین ویلیڈیٹرز کو جاتی ہے، ہمیں نہیں، اور {{fee}}٪ پلیٹ فارم فیس سے الگ ہے۔',
    id: 'Gas untuk validator jaringan, bukan kami, dan terpisah dari biaya platform {{fee}}%. Jika tak punya koin asli suatu rantai, pindah ke rantai lain.',
    pt: 'O gás vai para os validadores da rede, não para nós, e é separado da taxa de {{fee}}%. Se não tiver a moeda nativa de uma cadeia, mude para outra.'
  },
  'swap.needGas': {
    zh: '这笔交易需要 {{chain}} 上的 {{coin}} 作为手续费，你的余额不足。请补充少量 {{coin}}，或切换到你已持有原生币的链。',
    hi: 'इस लेन-देन के लिए {{chain}} पर {{coin}} चाहिए और आपका बैलेंस कम है। थोड़ा {{coin}} जोड़ें या दूसरी चेन चुनें।',
    es: 'Esta transacción necesita {{coin}} en {{chain}} para el gas y tu saldo no alcanza. Añade un poco de {{coin}} o cambia a una cadena cuya moneda nativa ya tengas.',
    fr: 'Cette transaction nécessite du {{coin}} sur {{chain}} pour le gas et votre solde est insuffisant. Ajoutez un peu de {{coin}} ou changez de chaîne.',
    ru: 'Для этой транзакции нужен {{coin}} в сети {{chain}}, а баланса не хватает. Пополните немного {{coin}} или смените сеть.',
    tr: 'Bu işlem {{chain}} üzerinde {{coin}} gerektiriyor ve bakiyeniz yetersiz. Biraz {{coin}} ekleyin veya başka bir zincire geçin.',
    ur: 'اس ٹرانزیکشن کے لیے {{chain}} پر {{coin}} درکار ہے اور آپ کا بیلنس کم ہے۔ تھوڑا {{coin}} شامل کریں یا ایسا نیٹ ورک منتخب کریں جس کا مقامی سکہ آپ کے پاس ہو۔',
    id: 'Transaksi ini butuh {{coin}} di {{chain}} untuk gas dan saldo Anda kurang. Tambah sedikit {{coin}} atau pindah rantai.',
    pt: 'Esta transação precisa de {{coin}} em {{chain}} para o gás e o seu saldo é insuficiente. Adicione um pouco de {{coin}} ou mude de cadeia.'
  },
  'swap.importBody': {
    zh: '该地址不在任何公开列表中。我们直接从链上读取代号和精度。核对地址是你的责任——错一个字符就是假币。',
    hi: 'यह पता किसी सार्वजनिक सूची में नहीं है। हम चेन से सीधे सिंबल और डेसिमल पढ़ते हैं। पता जाँचना आपकी ज़िम्मेदारी है — एक ग़लत अक्षर यानी नक़ली टोकन।',
    es: 'Esta dirección no está en ninguna lista pública. Leemos el símbolo y los decimales directamente de la cadena. Verificar la dirección es cosa tuya: un carácter equivocado es un token falso.',
    fr: 'Cette adresse ne figure dans aucune liste publique. Nous lisons le symbole et les décimales directement sur la chaîne. La vérification vous incombe : un caractère erroné, c\'est un faux token.',
    ru: 'Этого адреса нет ни в одном публичном списке. Символ и десятичные читаем прямо из сети. Проверка адреса — на вас: один неверный символ означает поддельный токен.',
    tr: 'Bu adres hiçbir genel listede yok. Sembol ve ondalıkları doğrudan zincirden okuyoruz. Adresi doğrulamak size ait — bir karakter hatası sahte token demektir.',
    ur: 'یہ ایڈریس کسی عوامی فہرست میں نہیں۔ ہم علامت اور اعشاریے براہ راست چین سے پڑھتے ہیں۔ ایڈریس کی تصدیق آپ کی ذمہ داری ہے۔',
    id: 'Alamat ini tidak ada di daftar publik mana pun. Kami membaca simbol dan desimal langsung dari rantai. Verifikasi alamat adalah tanggung jawab Anda.',
    pt: 'Este endereço não está em nenhuma lista pública. Lemos o símbolo e as casas decimais diretamente da cadeia. Verificar o endereço é consigo — um carácter errado é um token falso.'
  },

  /* ------------------------------ signals ----------------------------- */
  'signals.title': { zh: '技术信号', hi: 'सिग्नल', es: 'Señales', fr: 'Signaux', ru: 'Сигналы', tr: 'Sinyaller', ur: 'سگنلز', id: 'Sinyal', pt: 'Sinais' },
  'signals.confidence': { zh: '置信度', hi: 'भरोसा', es: 'Confianza', fr: 'Confiance', ru: 'Уверенность', tr: 'Güven', ur: 'اعتماد', id: 'Keyakinan', pt: 'Confiança' },
  'signals.breakdown': { zh: '指标明细', hi: 'सिग्नल विवरण', es: 'Desglose de señales', fr: 'Détail des signaux', ru: 'Разбор сигналов', tr: 'Sinyal dökümü', ur: 'سگنل تفصیل', id: 'Rincian sinyal', pt: 'Detalhe dos sinais' },
  'signals.volatility': { zh: '波动率', hi: 'अस्थिरता', es: 'Volatilidad', fr: 'Volatilité', ru: 'Волатильность', tr: 'Oynaklık', ur: 'اتار چڑھاؤ', id: 'Volatilitas', pt: 'Volatilidade' },
  'signals.support': { zh: '支撑位', hi: 'सपोर्ट', es: 'Soporte', fr: 'Support', ru: 'Поддержка', tr: 'Destek', ur: 'سپورٹ', id: 'Support', pt: 'Suporte' },
  'signals.resistance': { zh: '阻力位', hi: 'रेज़िस्टेंस', es: 'Resistencia', fr: 'Résistance', ru: 'Сопротивление', tr: 'Direnç', ur: 'مزاحمت', id: 'Resistance', pt: 'Resistência' },
  'signals.projection': { zh: '预测区间', hi: 'अनुमानित रेंज', es: 'Rango proyectado', fr: 'Fourchette projetée', ru: 'Проектируемый диапазон', tr: 'Öngörülen aralık', ur: 'متوقع رینج', id: 'Rentang proyeksi', pt: 'Intervalo projetado' },
  'signals.drivers': { zh: '支持因素', hi: 'समर्थन', es: 'A favor', fr: 'En faveur', ru: 'За', tr: 'Destekleyen', ur: 'حمایت', id: 'Pendukung', pt: 'A favor' },
  'signals.risks': { zh: '风险', hi: 'जोखिम', es: 'Riesgos', fr: 'Risques', ru: 'Риски', tr: 'Riskler', ur: 'خطرات', id: 'Risiko', pt: 'Riscos' },
  'signals.invalidation': { zh: '失效条件', hi: 'अमान्य होगा यदि', es: 'Se invalida si', fr: 'Invalidé si', ru: 'Отменяется если', tr: 'Geçersiz olur', ur: 'کالعدم اگر', id: 'Batal jika', pt: 'Invalidado se' },
  'signals.aiThinking': { zh: '正在读取市场…', hi: 'बाज़ार पढ़ रहे हैं…', es: 'Leyendo el mercado…', fr: 'Lecture du marché…', ru: 'Читаем рынок…', tr: 'Piyasa okunuyor…', ur: 'مارکیٹ پڑھی جا رہی ہے…', id: 'Membaca pasar…', pt: 'A ler o mercado…' },
  'signals.aiOutlook': { zh: 'AI 展望', hi: 'AI आउटलुक', es: 'Perspectiva IA', fr: 'Perspective IA', ru: 'Прогноз ИИ', tr: 'YZ görünümü', ur: 'AI جائزہ', id: 'Pandangan AI', pt: 'Perspetiva IA' },
  'signals.outlookLocal': { zh: '指标解读', hi: 'संकेतक विश्लेषण', es: 'Lectura de indicadores', fr: 'Lecture des indicateurs', ru: 'Разбор индикаторов', tr: 'Gösterge okuması', ur: 'اشاریوں کا تجزیہ', id: 'Bacaan indikator', pt: 'Leitura de indicadores' },
  'signals.aiRange': { zh: '{{d}} 天区间', hi: '{{d}}-दिन रेंज', es: 'Rango de {{d}} días', fr: 'Fourchette {{d}} jours', ru: 'Диапазон на {{d}} дн.', tr: '{{d}} günlük aralık', ur: '{{d}} دن کی رینج', id: 'Rentang {{d}} hari', pt: 'Intervalo de {{d}} dias' },
  'signals.aiMetaLocal': {
    zh: '由本机指标（RSI、MACD、布林带、均线、波动率）直接生成，未使用语言模型。',
    hi: 'यह विश्लेषण डिवाइस पर ही संकेतकों (RSI, MACD, बोलिंगर, मूविंग एवरेज, अस्थिरता) से बना है — किसी भाषा मॉडल से नहीं।',
    es: 'Generado en el dispositivo a partir de los indicadores (RSI, MACD, Bollinger, medias móviles, volatilidad). No interviene ningún modelo de lenguaje.',
    fr: 'Généré sur l\'appareil à partir des indicateurs (RSI, MACD, Bollinger, moyennes mobiles, volatilité). Aucun modèle de langage n\'est utilisé.',
    ru: 'Составлено на устройстве по индикаторам (RSI, MACD, Боллинджер, скользящие средние, волатильность). Языковая модель не использовалась.',
    tr: 'Cihazda göstergelerden (RSI, MACD, Bollinger, hareketli ortalamalar, oynaklık) üretildi. Dil modeli kullanılmadı.',
    ur: 'یہ تجزیہ آلے پر ہی اشاریوں (RSI، MACD، بولنگر، موونگ ایوریج، اتار چڑھاؤ) سے بنایا گیا — کسی زبان ماڈل سے نہیں۔',
    id: 'Dibuat di perangkat dari indikator (RSI, MACD, Bollinger, rata-rata bergerak, volatilitas). Tanpa model bahasa.',
    pt: 'Gerado no dispositivo a partir dos indicadores (RSI, MACD, Bollinger, médias móveis, volatilidade). Não é usado nenhum modelo de linguagem.'
  },
  'signals.disclaimer': {
    zh: '这些是基于真实价格历史计算的经典技术指标（RSI、MACD、布林带、均线）——也是大多数"AI 信号"产品的底层。它们概括图表现状，无法预测未来。短周期内市场接近随机，切勿仅凭一个分数交易。',
    hi: 'ये असली मूल्य इतिहास पर गणना किए गए पारंपरिक तकनीकी संकेतक हैं (RSI, MACD, बोलिंगर, मूविंग एवरेज) — यही अधिकांश "AI सिग्नल" उत्पादों का आधार है। ये चार्ट की मौजूदा स्थिति बताते हैं, भविष्य नहीं। कभी केवल स्कोर देखकर ट्रेड न करें।',
    es: 'Son indicadores técnicos clásicos (RSI, MACD, Bollinger, medias móviles) calculados sobre historial real de precios: lo mismo que hay detrás de la mayoría de productos de "señales IA". Resumen lo que hace el gráfico, no predicen el futuro. A corto plazo los mercados son casi aleatorios. Nunca operes solo por una puntuación.',
    fr: 'Ce sont des indicateurs techniques classiques (RSI, MACD, Bollinger, moyennes mobiles) calculés sur un historique réel — la même chose que derrière la plupart des produits « signaux IA ». Ils résument ce que fait le graphique, ils ne prédisent pas l\'avenir. Ne tradez jamais sur un simple score.',
    ru: 'Это классические технические индикаторы (RSI, MACD, Боллинджер, скользящие средние) по реальной истории цен — то же, что лежит в основе большинства продуктов с «ИИ-сигналами». Они описывают текущее состояние графика, но не предсказывают будущее. Никогда не торгуйте только по баллу.',
    tr: 'Bunlar gerçek fiyat geçmişi üzerinden hesaplanan klasik teknik göstergelerdir (RSI, MACD, Bollinger, hareketli ortalamalar) — çoğu "YZ sinyali" ürününün altında da bu vardır. Grafiğin ne yaptığını özetler, geleceği tahmin edemez. Asla yalnızca bir skora bakarak işlem yapmayın.',
    ur: 'یہ اصل قیمت کی تاریخ پر محاسبہ کیے گئے کلاسیکی تکنیکی اشاریے ہیں (RSI، MACD، بولنگر، موونگ ایوریج) — زیادہ تر "AI سگنل" مصنوعات کے پیچھے یہی ہے۔ یہ چارٹ کی موجودہ حالت بتاتے ہیں، مستقبل نہیں۔ کبھی صرف اسکور دیکھ کر ٹریڈ نہ کریں۔',
    id: 'Ini indikator teknikal klasik (RSI, MACD, Bollinger, rata-rata bergerak) yang dihitung dari riwayat harga nyata — sama seperti di balik kebanyakan produk "sinyal AI". Mereka merangkum kondisi grafik, bukan memprediksi masa depan. Jangan pernah berdagang hanya berdasarkan skor.',
    pt: 'São indicadores técnicos clássicos (RSI, MACD, Bollinger, médias móveis) calculados sobre histórico real de preços — o mesmo que está por trás da maioria dos produtos de "sinais IA". Resumem o que o gráfico está a fazer; não preveem o futuro. Nunca negoceie apenas com base numa pontuação.'
  },
  'signals.coneExplain': {
    zh: '这是波动率区间，不是预测。如果 {{d}} 天内的价格波动延续近期节奏，约 {{p}}% 的结果会落在此区间内。它不说明方向。',
    hi: 'यह अस्थिरता की रेंज है, भविष्यवाणी नहीं। यदि {{d}} दिन की चाल हाल की गति से चलती रही, तो लगभग {{p}}% परिणाम इसी दायरे में होंगे। यह दिशा नहीं बताती।',
    es: 'Es un rango de volatilidad, no un pronóstico. Si el movimiento a {{d}} días continúa al ritmo reciente, en torno al {{p}}% de los resultados caerá dentro de esta banda. No dice nada sobre la dirección.',
    fr: 'C\'est une fourchette de volatilité, pas une prévision. Si le mouvement sur {{d}} jours se poursuit au rythme récent, environ {{p}} % des issues tomberont dans cette bande. Elle ne dit rien de la direction.',
    ru: 'Это диапазон волатильности, а не прогноз. Если движение за {{d}} дн. продолжится в недавнем темпе, примерно {{p}}% исходов попадут в эту полосу. О направлении он ничего не говорит.',
    tr: 'Bu bir oynaklık aralığıdır, tahmin değil. {{d}} günlük hareket son hızıyla sürerse sonuçların yaklaşık %{{p}}\'i bu bandın içinde kalır. Yön hakkında bir şey söylemez.',
    ur: 'یہ اتار چڑھاؤ کی رینج ہے، پیش گوئی نہیں۔ اگر {{d}} دن کی حرکت حالیہ رفتار سے جاری رہے تو تقریباً {{p}}٪ نتائج اسی دائرے میں ہوں گے۔ یہ سمت نہیں بتاتی۔',
    id: 'Ini rentang volatilitas, bukan ramalan. Jika pergerakan {{d}} hari berlanjut pada laju terkini, sekitar {{p}}% hasil jatuh di dalam pita ini. Ini tidak menyatakan arah.',
    pt: 'Isto é um intervalo de volatilidade, não uma previsão. Se o movimento a {{d}} dias continuar ao ritmo recente, cerca de {{p}}% dos resultados caem dentro desta banda. Não diz nada sobre a direção.'
  },
  'signals.label.strongBuy': { zh: '强烈买入', hi: 'मज़बूत खरीद', es: 'Compra fuerte', fr: 'Achat fort', ru: 'Сильная покупка', tr: 'Güçlü al', ur: 'مضبوط خرید', id: 'Beli kuat', pt: 'Compra forte' },
  'signals.label.buy': { zh: '买入', hi: 'खरीद', es: 'Compra', fr: 'Achat', ru: 'Покупка', tr: 'Al', ur: 'خرید', id: 'Beli', pt: 'Compra' },
  'signals.label.neutral': { zh: '中性', hi: 'तटस्थ', es: 'Neutral', fr: 'Neutre', ru: 'Нейтрально', tr: 'Nötr', ur: 'غیر جانبدار', id: 'Netral', pt: 'Neutro' },
  'signals.label.sell': { zh: '卖出', hi: 'बिक्री', es: 'Venta', fr: 'Vente', ru: 'Продажа', tr: 'Sat', ur: 'فروخت', id: 'Jual', pt: 'Venda' },
  'signals.label.strongSell': { zh: '强烈卖出', hi: 'मज़बूत बिक्री', es: 'Venta fuerte', fr: 'Vente forte', ru: 'Сильная продажа', tr: 'Güçlü sat', ur: 'مضبوط فروخت', id: 'Jual kuat', pt: 'Venda forte' },
  'signals.bias.bullish': { zh: '看涨', hi: 'तेजी', es: 'Alcista', fr: 'Haussier', ru: 'Бычий', tr: 'Yükseliş', ur: 'تیزی', id: 'Bullish', pt: 'Altista' },
  'signals.bias.bearish': { zh: '看跌', hi: 'मंदी', es: 'Bajista', fr: 'Baissier', ru: 'Медвежий', tr: 'Düşüş', ur: 'مندی', id: 'Bearish', pt: 'Baixista' },
  'signals.bias.neutral': { zh: '中性', hi: 'तटस्थ', es: 'Neutral', fr: 'Neutre', ru: 'Нейтральный', tr: 'Nötr', ur: 'غیر جانبدار', id: 'Netral', pt: 'Neutro' },

  /* -------------------------------- news ------------------------------ */
  'news.title': { zh: '加密新闻', hi: 'क्रिप्टो समाचार', es: 'Noticias cripto', fr: 'Actualités crypto', ru: 'Крипто-новости', tr: 'Kripto haberleri', ur: 'کرپٹو خبریں', id: 'Berita kripto', pt: 'Notícias cripto' },
  'news.subtitle': { zh: '每 24 小时更新一次', hi: 'हर 24 घंटे में अपडेट', es: 'Se actualiza cada 24 horas', fr: 'Actualisé toutes les 24 heures', ru: 'Обновляется каждые 24 часа', tr: '24 saatte bir güncellenir', ur: 'ہر ٢٤ گھنٹے بعد اپ ڈیٹ', id: 'Diperbarui setiap 24 jam', pt: 'Atualizado a cada 24 horas' },
  'news.refresh': { zh: '刷新', hi: 'रिफ़्रेश', es: 'Actualizar', fr: 'Actualiser', ru: 'Обновить', tr: 'Yenile', ur: 'ریفریش', id: 'Segarkan', pt: 'Atualizar' },
  'news.loading': { zh: '加载中…', hi: 'लोड हो रहा है…', es: 'Cargando…', fr: 'Chargement…', ru: 'Загрузка…', tr: 'Yükleniyor…', ur: 'لوڈ ہو رہا ہے…', id: 'Memuat…', pt: 'A carregar…' },
  'news.search': { zh: '搜索标题…', hi: 'हेडलाइन खोजें…', es: 'Buscar titulares…', fr: 'Rechercher…', ru: 'Поиск заголовков…', tr: 'Başlık ara…', ur: 'سرخیاں تلاش کریں…', id: 'Cari berita…', pt: 'Pesquisar títulos…' },
  'news.empty': { zh: '没有符合此筛选的新闻。', hi: 'इस फ़िल्टर से कोई खबर नहीं।', es: 'Ningún titular coincide.', fr: 'Aucun titre ne correspond.', ru: 'Ничего не найдено.', tr: 'Bu filtreye uygun haber yok.', ur: 'اس فلٹر سے کوئی خبر نہیں۔', id: 'Tidak ada berita cocok.', pt: 'Nenhum título corresponde.' },
  'news.digest': { zh: '市场摘要', hi: 'बाज़ार सारांश', es: 'Resumen de mercado', fr: 'Résumé du marché', ru: 'Обзор рынка', tr: 'Piyasa özeti', ur: 'مارکیٹ خلاصہ', id: 'Ringkasan pasar', pt: 'Resumo do mercado' },
  'news.updated': { zh: '{{ago}}前更新', hi: '{{ago}} पहले अपडेट', es: 'Actualizado hace {{ago}}', fr: 'Mis à jour il y a {{ago}}', ru: 'Обновлено {{ago}} назад', tr: '{{ago}} önce güncellendi', ur: '{{ago}} پہلے اپ ڈیٹ', id: 'Diperbarui {{ago}} lalu', pt: 'Atualizado há {{ago}}' },
  'news.readAt': { zh: '在 {{source}} 阅读', hi: '{{source}} पर पढ़ें', es: 'Leer en {{source}}', fr: 'Lire sur {{source}}', ru: 'Читать на {{source}}', tr: '{{source}} üzerinde oku', ur: '{{source}} پر پڑھیں', id: 'Baca di {{source}}', pt: 'Ler em {{source}}' },
  'news.notifyToggle': { zh: '新闻通知', hi: 'समाचार सूचनाएँ', es: 'Notificaciones de noticias', fr: 'Notifications d\'actualités', ru: 'Уведомления о новостях', tr: 'Haber bildirimleri', ur: 'خبر اطلاعات', id: 'Notifikasi berita', pt: 'Notificações de notícias' },
  'news.cat.all': { zh: '全部', hi: 'सभी', es: 'Todo', fr: 'Tout', ru: 'Все', tr: 'Tümü', ur: 'سب', id: 'Semua', pt: 'Tudo' },
  'news.cat.bitcoin': { zh: '比特币', hi: 'बिटकॉइन', es: 'Bitcoin', fr: 'Bitcoin', ru: 'Биткоин', tr: 'Bitcoin', ur: 'بٹ کوائن', id: 'Bitcoin', pt: 'Bitcoin' },
  'news.cat.ethereum': { zh: '以太坊', hi: 'एथेरियम', es: 'Ethereum', fr: 'Ethereum', ru: 'Эфириум', tr: 'Ethereum', ur: 'ایتھیریم', id: 'Ethereum', pt: 'Ethereum' },
  'news.cat.defi': { zh: 'DeFi', hi: 'DeFi', es: 'DeFi', fr: 'DeFi', ru: 'DeFi', tr: 'DeFi', ur: 'DeFi', id: 'DeFi', pt: 'DeFi' },
  'news.cat.policy': { zh: '政策法规', hi: 'नीति व नियमन', es: 'Política y regulación', fr: 'Politique et régulation', ru: 'Политика и регулирование', tr: 'Politika ve düzenleme', ur: 'پالیسی و ضابطہ', id: 'Kebijakan & regulasi', pt: 'Política e regulação' },
  'news.cat.regional': { zh: '伊朗与中东', hi: 'ईरान और मध्य पूर्व', es: 'Irán y Oriente Medio', fr: 'Iran et Moyen-Orient', ru: 'Иран и Ближний Восток', tr: 'İran ve Orta Doğu', ur: 'ایران اور مشرقِ وسطیٰ', id: 'Iran & Timur Tengah', pt: 'Irão e Médio Oriente' },
  'news.cat.events': { zh: '活动', hi: 'कार्यक्रम', es: 'Eventos', fr: 'Événements', ru: 'События', tr: 'Etkinlikler', ur: 'تقریبات', id: 'Acara', pt: 'Eventos' },
  'news.cat.future': { zh: '加密货币的未来', hi: 'क्रिप्टो का भविष्य', es: 'El futuro cripto', fr: 'L\'avenir de la crypto', ru: 'Будущее криптовалют', tr: 'Kriptonun geleceği', ur: 'کرپٹو کا مستقبل', id: 'Masa depan kripto', pt: 'O futuro da cripto' },
  'news.cat.lang': { zh: '其他语言', hi: 'अन्य भाषाएँ', es: 'Otros idiomas', fr: 'Autres langues', ru: 'Другие языки', tr: 'Diğer diller', ur: 'دیگر زبانیں', id: 'Bahasa lain', pt: 'Outros idiomas' },
  'news.disclaimer': {
    zh: '标题来自第三方媒体，每张卡片都注明来源。我们不认可也不编辑其内容，其中任何内容都不构成投资建议。',
    hi: 'हेडलाइन तीसरे पक्ष के स्रोतों से हैं और हर कार्ड पर स्रोत लिखा है। हम उनकी सामग्री का समर्थन या संपादन नहीं करते, और इनमें से कुछ भी निवेश सलाह नहीं है।',
    es: 'Los titulares provienen de medios de terceros y cada tarjeta indica su fuente. No respaldamos ni editamos su contenido, y nada de esto es asesoramiento de inversión.',
    fr: 'Les titres proviennent de médias tiers et chaque carte indique sa source. Nous n\'approuvons ni ne modifions leur contenu, et rien de tout cela ne constitue un conseil en investissement.',
    ru: 'Заголовки взяты у сторонних изданий, источник указан на каждой карточке. Мы не одобряем и не редактируем их содержание, и ничто из этого не является инвестиционной рекомендацией.',
    tr: 'Başlıklar üçüncü taraf yayınlardan gelir ve her kartta kaynağı yazar. İçeriklerini onaylamaz veya düzenlemeyiz; hiçbiri yatırım tavsiyesi değildir.',
    ur: 'سرخیاں فریق ثالث ذرائع سے ہیں اور ہر کارڈ پر ماخذ درج ہے۔ ہم ان کے مواد کی توثیق یا تدوین نہیں کرتے، اور ان میں سے کچھ بھی سرمایہ کاری کا مشورہ نہیں۔',
    id: 'Berita berasal dari media pihak ketiga dan setiap kartu mencantumkan sumbernya. Kami tidak mendukung atau menyunting isinya, dan tidak ada yang merupakan nasihat investasi.',
    pt: 'Os títulos vêm de meios terceiros e cada cartão indica a sua fonte. Não subscrevemos nem editamos o seu conteúdo, e nada disto é aconselhamento de investimento.'
  },
  'news.generatedNotice': {
    zh: '未能连接任何新闻源，因此本摘要由市场数据自动生成——它不是新闻报道。',
    hi: 'कोई समाचार स्रोत उपलब्ध नहीं था, इसलिए यह सारांश बाज़ार डेटा से स्वतः बना है — यह पत्रकारिता नहीं है।',
    es: 'No se pudo acceder a ninguna fuente de noticias, así que este resumen se generó a partir de datos de mercado: no es periodismo.',
    fr: 'Aucune source d\'actualités n\'était joignable ; ce résumé a donc été généré à partir des données de marché — ce n\'est pas du journalisme.',
    ru: 'Ни один источник новостей недоступен, поэтому эта сводка сгенерирована из рыночных данных — это не журналистика.',
    tr: 'Hiçbir haber kaynağına erişilemedi, bu nedenle bu özet piyasa verilerinden üretildi — gazetecilik değildir.',
    ur: 'کوئی خبر ذریعہ دستیاب نہیں تھا، اس لیے یہ خلاصہ مارکیٹ ڈیٹا سے خودکار طور پر بنایا گیا — یہ صحافت نہیں ہے۔',
    id: 'Tidak ada sumber berita yang dapat dijangkau, jadi ringkasan ini dibuat dari data pasar — ini bukan jurnalisme.',
    pt: 'Nenhuma fonte de notícias estava acessível, por isso este resumo foi gerado a partir de dados de mercado — não é jornalismo.'
  },

  /* -------------------------- notifications --------------------------- */
  'notify.title': { zh: '通知与声音', hi: 'सूचनाएँ और ध्वनि', es: 'Notificaciones y sonido', fr: 'Notifications et son', ru: 'Уведомления и звук', tr: 'Bildirimler ve ses', ur: 'اطلاعات اور آواز', id: 'Notifikasi & suara', pt: 'Notificações e som' },
  'notify.sound': { zh: '交易提示音', hi: 'ट्रेड ध्वनि', es: 'Sonido de operación', fr: 'Son de transaction', ru: 'Звук сделки', tr: 'İşlem sesi', ur: 'ٹریڈ آواز', id: 'Suara transaksi', pt: 'Som da operação' },
  'notify.vibrate': { zh: '振动', hi: 'कंपन', es: 'Vibración', fr: 'Vibration', ru: 'Вибрация', tr: 'Titreşim', ur: 'ارتعاش', id: 'Getaran', pt: 'Vibração' },
  'notify.tradeAlerts': { zh: '交易提醒', hi: 'ट्रेड अलर्ट', es: 'Alertas de operaciones', fr: 'Alertes de transaction', ru: 'Оповещения о сделках', tr: 'İşlem uyarıları', ur: 'ٹریڈ الرٹس', id: 'Peringatan transaksi', pt: 'Alertas de operação' },
  'notify.daily': { zh: '每日通知', hi: 'दैनिक सूचना', es: 'Notificación diaria', fr: 'Notification quotidienne', ru: 'Ежедневное уведомление', tr: 'Günlük bildirim', ur: 'روزانہ اطلاع', id: 'Notifikasi harian', pt: 'Notificação diária' },
  'notify.news': { zh: '新闻提醒', hi: 'समाचार अलर्ट', es: 'Alertas de noticias', fr: 'Alertes d\'actualités', ru: 'Новостные оповещения', tr: 'Haber uyarıları', ur: 'خبر الرٹس', id: 'Peringatan berita', pt: 'Alertas de notícias' },
  'notify.permission': { zh: '通知权限', hi: 'सूचना अनुमति', es: 'Permiso de notificaciones', fr: 'Autorisation des notifications', ru: 'Разрешение на уведомления', tr: 'Bildirim izni', ur: 'اطلاع کی اجازت', id: 'Izin notifikasi', pt: 'Permissão de notificações' },
  'notify.permissionAsk': { zh: '允许', hi: 'अनुमति दें', es: 'Permitir', fr: 'Autoriser', ru: 'Разрешить', tr: 'İzin ver', ur: 'اجازت دیں', id: 'Izinkan', pt: 'Permitir' },
  'notify.modeServer': { zh: '推送已开启', hi: 'पुश चालू', es: 'Push activo', fr: 'Push actif', ru: 'Push включён', tr: 'Push açık', ur: 'پش فعال', id: 'Push aktif', pt: 'Push ativo' },
  'notify.modeLocal': { zh: '仅本机', hi: 'केवल डिवाइस', es: 'Solo en el dispositivo', fr: 'Appareil uniquement', ru: 'Только на устройстве', tr: 'Yalnızca cihazda', ur: 'صرف آلے پر', id: 'Hanya perangkat', pt: 'Apenas no dispositivo' },
  'notify.tradeDoneTitle': { zh: '交易完成', hi: 'ट्रेड पूरा', es: 'Operación completada', fr: 'Transaction effectuée', ru: 'Сделка выполнена', tr: 'İşlem tamamlandı', ur: 'ٹریڈ مکمل', id: 'Transaksi selesai', pt: 'Operação concluída' },
  'notify.tradeFailTitle': { zh: '交易失败', hi: 'ट्रेड विफल', es: 'Operación fallida', fr: 'Transaction échouée', ru: 'Сделка не прошла', tr: 'İşlem başarısız', ur: 'ٹریڈ ناکام', id: 'Transaksi gagal', pt: 'Operação falhou' },
  'notify.tradeDoneBody': { zh: '已将 {{amount}} {{from}} 兑换为 {{to}}。', hi: '{{amount}} {{from}} को {{to}} में बदला गया।', es: 'Se cambiaron {{amount}} {{from}} por {{to}}.', fr: '{{amount}} {{from}} échangés contre {{to}}.', ru: '{{amount}} {{from}} обменяно на {{to}}.', tr: '{{amount}} {{from}}, {{to}} ile takas edildi.', ur: '{{amount}} {{from}} کو {{to}} میں بدلا گیا۔', id: '{{amount}} {{from}} ditukar dengan {{to}}.', pt: 'Trocou {{amount}} {{from}} por {{to}}.' },
  'notify.pushLocal': {
    zh: '本次构建没有服务器推送。通知会在你下次打开应用时显示——这是真实功能，但不是推送，我们不会假装它是。',
    hi: 'इस बिल्ड में सर्वर पुश नहीं है। सूचनाएँ आपके अगली बार ऐप खोलने पर दिखेंगी — यह असली सुविधा है, पर पुश नहीं, और हम इसे पुश नहीं कहेंगे।',
    es: 'Esta versión no tiene push desde el servidor. Las notificaciones aparecen la próxima vez que abras la app: es una función real, pero no es push, y no vamos a fingir lo contrario.',
    fr: 'Cette version n\'a pas de push serveur. Les notifications s\'affichent à la prochaine ouverture de l\'app : c\'est une vraie fonctionnalité, mais ce n\'est pas du push, et nous ne prétendrons pas le contraire.',
    ru: 'В этой сборке нет серверного push. Уведомления показываются при следующем открытии приложения — это настоящая функция, но не push, и мы не станем это скрывать.',
    tr: 'Bu sürümde sunucu push yok. Bildirimler uygulamayı bir sonraki açışınızda görünür — bu gerçek bir özellik ama push değil ve öyleymiş gibi davranmayacağız.',
    ur: 'اس بلڈ میں سرور پش نہیں ہے۔ اطلاعات اگلی بار ایپ کھولنے پر دکھائی دیں گی — یہ حقیقی خصوصیت ہے مگر پش نہیں، اور ہم اسے پش نہیں کہیں گے۔',
    id: 'Versi ini tidak punya push server. Notifikasi muncul saat Anda membuka aplikasi berikutnya — ini fitur nyata, tetapi bukan push, dan kami tidak akan berpura-pura sebaliknya.',
    pt: 'Esta versão não tem push do servidor. As notificações aparecem da próxima vez que abrir a app — é uma funcionalidade real, mas não é push, e não vamos fingir que é.'
  },
  'notify.pushOn': {
    zh: '服务器推送已启用：即使应用完全关闭，通知也会送达。',
    hi: 'सर्वर पुश चालू है: ऐप पूरी तरह बंद होने पर भी सूचनाएँ पहुँचेंगी।',
    es: 'Push desde el servidor activo: las notificaciones llegan aunque la app esté cerrada.',
    fr: 'Push serveur actif : les notifications arrivent même app fermée.',
    ru: 'Серверный push включён: уведомления приходят даже при закрытом приложении.',
    tr: 'Sunucu push açık: uygulama tamamen kapalıyken bile bildirimler ulaşır.',
    ur: 'سرور پش فعال ہے: ایپ مکمل بند ہونے پر بھی اطلاعات پہنچیں گی۔',
    id: 'Push server aktif: notifikasi tiba meski aplikasi tertutup.',
    pt: 'Push do servidor ativo: as notificações chegam mesmo com a app fechada.'
  },
  'notify.dailySubLocal': {
    zh: '每天最多一条。此构建中，它会在你下次打开应用时显示，而不是主动推送到你的手机。',
    hi: 'दिन में अधिकतम एक। इस बिल्ड में यह आपके अगली बार ऐप खोलने पर दिखेगी, फ़ोन पर अपने आप नहीं आएगी।',
    es: 'Como máximo una al día. En esta versión aparece la próxima vez que abras la app, no llega sola al teléfono.',
    fr: 'Une par jour maximum. Dans cette version, elle s\'affiche à la prochaine ouverture de l\'app, elle n\'arrive pas seule sur le téléphone.',
    ru: 'Не более одной в день. В этой сборке она показывается при следующем открытии приложения, а не приходит на телефон сама.',
    tr: 'Günde en fazla bir tane. Bu sürümde uygulamayı açtığınızda görünür, telefona kendiliğinden gelmez.',
    ur: 'دن میں زیادہ سے زیادہ ایک۔ اس بلڈ میں یہ ایپ اگلی بار کھولنے پر دکھائی دے گی، فون پر خود نہیں آئے گی۔',
    id: 'Maksimal satu per hari. Di versi ini muncul saat Anda membuka aplikasi, bukan tiba sendiri di ponsel.',
    pt: 'No máximo uma por dia. Nesta versão aparece quando abrir a app, não chega sozinha ao telemóvel.'
  },

  /* ------------------------------ welcome ----------------------------- */
  'welcome.title': { zh: '选择你的语言', hi: 'अपनी भाषा चुनें', es: 'Elige tu idioma', fr: 'Choisissez votre langue', ru: 'Выберите язык', tr: 'Dilinizi seçin', ur: 'اپنی زبان منتخب کریں', id: 'Pilih bahasa Anda', pt: 'Escolha o seu idioma' },
  'welcome.subtitle': { zh: '之后可以随时在设置中更改。', hi: 'आप इसे बाद में सेटिंग्स से कभी भी बदल सकते हैं।', es: 'Puedes cambiarlo en cualquier momento desde Ajustes.', fr: 'Vous pourrez le modifier à tout moment dans les réglages.', ru: 'Это можно изменить в любой момент в настройках.', tr: 'Bunu istediğiniz zaman Ayarlar\'dan değiştirebilirsiniz.', ur: 'آپ اسے کسی بھی وقت ترتیبات سے تبدیل کر سکتے ہیں۔', id: 'Anda dapat mengubahnya kapan saja di Pengaturan.', pt: 'Pode alterar isto a qualquer momento nas Definições.' },
  'welcome.continue': { zh: '继续', hi: 'जारी रखें', es: 'Continuar', fr: 'Continuer', ru: 'Продолжить', tr: 'Devam', ur: 'جاری رکھیں', id: 'Lanjutkan', pt: 'Continuar' },
  'welcome.partial': { zh: '部分翻译', hi: 'आंशिक अनुवाद', es: 'Traducción parcial', fr: 'Traduction partielle', ru: 'Частичный перевод', tr: 'Kısmi çeviri', ur: 'جزوی ترجمہ', id: 'Terjemahan sebagian', pt: 'Tradução parcial' },
  'welcome.full': { zh: '完整翻译', hi: 'पूर्ण अनुवाद', es: 'Traducción completa', fr: 'Traduction complète', ru: 'Полный перевод', tr: 'Tam çeviri', ur: 'مکمل ترجمہ', id: 'Terjemahan lengkap', pt: 'Tradução completa' },

  /* ---------------------------- onboarding ---------------------------- */
  'onboarding.next': { zh: '继续', hi: 'आगे', es: 'Continuar', fr: 'Continuer', ru: 'Далее', tr: 'Devam', ur: 'آگے', id: 'Lanjut', pt: 'Continuar' },
  'onboarding.skip': { zh: '跳过', hi: 'छोड़ें', es: 'Omitir', fr: 'Passer', ru: 'Пропустить', tr: 'Atla', ur: 'چھوڑیں', id: 'Lewati', pt: 'Ignorar' },
  'onboarding.start': { zh: '开始使用', hi: 'शुरू करें', es: 'Empezar', fr: 'Commencer', ru: 'Начать', tr: 'Başla', ur: 'شروع کریں', id: 'Mulai', pt: 'Começar' },
  'onboarding.language.title': { zh: '选择语言', hi: 'भाषा चुनें', es: 'Elige tu idioma', fr: 'Choisissez votre langue', ru: 'Выберите язык', tr: 'Dilinizi seçin', ur: 'زبان منتخب کریں', id: 'Pilih bahasa', pt: 'Escolha o idioma' },
  'onboarding.language.body': { zh: '一切会立即切换，之后也可随时在设置中更改。', hi: 'सब कुछ तुरंत बदल जाएगा, और आप इसे बाद में सेटिंग्स से बदल सकते हैं।', es: 'Todo cambia al instante y puedes volver a cambiarlo desde Ajustes cuando quieras.', fr: 'Tout change immédiatement, et vous pourrez le modifier depuis les réglages quand vous voulez.', ru: 'Всё переключится сразу, изменить можно в любой момент в настройках.', tr: 'Her şey anında değişir; istediğinizde Ayarlar\'dan tekrar değiştirebilirsiniz.', ur: 'سب کچھ فوراً بدل جائے گا، اور آپ اسے بعد میں ترتیبات سے بدل سکتے ہیں۔', id: 'Semuanya berubah seketika, dan bisa diubah lagi lewat Pengaturan kapan saja.', pt: 'Tudo muda de imediato e pode voltar a alterar nas Definições quando quiser.' },
  'onboarding.custody.title': { zh: '你的密钥，你的资产', hi: 'आपकी चाबी, आपके सिक्के', es: 'Tus claves, tus monedas', fr: 'Vos clés, vos cryptos', ru: 'Ваши ключи — ваши монеты', tr: 'Anahtarlarınız, coinleriniz', ur: 'آپ کی چابیاں، آپ کے سکے', id: 'Kunci Anda, koin Anda', pt: 'As suas chaves, as suas moedas' },

  /* ------------------------------- guide ------------------------------ */
  'guide.next': { zh: '下一步', hi: 'अगला', es: 'Siguiente', fr: 'Suivant', ru: 'Далее', tr: 'İleri', ur: 'اگلا', id: 'Berikutnya', pt: 'Seguinte' },
  'guide.back': { zh: '上一步', hi: 'पिछला', es: 'Anterior', fr: 'Précédent', ru: 'Назад', tr: 'Geri', ur: 'پچھلا', id: 'Sebelumnya', pt: 'Anterior' },
  'guide.done': { zh: '我已读完全部说明', hi: 'मैंने सभी निर्देश पढ़ लिए', es: 'He leído todas las instrucciones', fr: 'J\'ai lu toutes les instructions', ru: 'Я прочитал все инструкции', tr: 'Tüm açıklamaları okudum', ur: 'میں نے تمام ہدایات پڑھ لیں', id: 'Saya sudah membaca semua panduan', pt: 'Li todas as instruções' },
  'guide.language': { zh: '教程语言', hi: 'गाइड की भाषा', es: 'Idioma de la guía', fr: 'Langue du guide', ru: 'Язык руководства', tr: 'Kılavuz dili', ur: 'گائیڈ کی زبان', id: 'Bahasa panduan', pt: 'Idioma do guia' },
  'guide.title': { zh: '开始之前', hi: 'शुरू करने से पहले', es: 'Antes de empezar', fr: 'Avant de commencer', ru: 'Прежде чем начать', tr: 'Başlamadan önce', ur: 'شروع کرنے سے پہلے', id: 'Sebelum mulai', pt: 'Antes de começar' },
  'guide.step': { zh: '第 {{n}} 步', hi: 'चरण {{n}}', es: 'Paso {{n}}', fr: 'Étape {{n}}', ru: 'Шаг {{n}}', tr: 'Adım {{n}}', ur: 'مرحلہ {{n}}', id: 'Langkah {{n}}', pt: 'Passo {{n}}' },
  'guide.doneHint': { zh: '请先浏览全部四个部分。', hi: 'पहले चारों भाग खोलें।', es: 'Abre las cuatro secciones primero.', fr: 'Ouvrez d\'abord les quatre sections.', ru: 'Сначала откройте все четыре раздела.', tr: 'Önce dört bölümü de açın.', ur: 'پہلے چاروں حصے کھولیں۔', id: 'Buka keempat bagian dulu.', pt: 'Abra primeiro as quatro secções.' },
  'guide.closing': { zh: '准备就绪 — 欢迎使用', hi: 'तैयार — आपका स्वागत है', es: 'Todo listo — bienvenido', fr: 'C\'est prêt — bienvenue', ru: 'Готово — добро пожаловать', tr: 'Hazırsınız — hoş geldiniz', ur: 'تیار — خوش آمدید', id: 'Siap — selamat datang', pt: 'Tudo pronto — bem-vindo' },

  /* ------------------- legal / regulatory (critical) ------------------ */
  'predict.riskNotice': {
    zh: '本页仅使用虚拟额度，无法接入真实资金。以真实资金进行的短期涨跌押注（二元期权）在伊朗法律下被禁止，在英国和欧盟也对散户禁止。这里的内容只用于理解机制。',
    hi: 'यह स्क्रीन केवल वर्चुअल क्रेडिट पर चलती है; इसमें असली पैसा नहीं जोड़ा जा सकता। असली पैसे से अल्पकालिक ऊपर/नीचे सट्टा ईरानी कानून में प्रतिबंधित है और यूके व ईयू में खुदरा ग्राहकों के लिए भी प्रतिबंधित है। यह केवल तंत्र समझने के लिए है।',
    es: 'Esta pantalla funciona solo con crédito virtual; no se pueden conectar fondos reales. Las apuestas a corto plazo sobre el precio con dinero real están prohibidas por la ley iraní y también para minoristas en el Reino Unido y la UE. Esto existe solo para enseñar el mecanismo.',
    fr: 'Cet écran fonctionne uniquement avec du crédit virtuel ; aucun fonds réel ne peut y être connecté. Les paris à court terme sur le prix avec de l\'argent réel sont interdits par la loi iranienne et aux particuliers au Royaume-Uni et dans l\'UE. Ceci n\'existe que pour expliquer le mécanisme.',
    ru: 'Экран работает только с виртуальными кредитами; реальные средства подключить нельзя. Краткосрочные ставки на направление цены на реальные деньги запрещены законом Ирана, а также для розничных клиентов в Великобритании и ЕС. Это существует только для обучения.',
    tr: 'Bu ekran yalnızca sanal kredi ile çalışır; gerçek para bağlanamaz. Gerçek parayla kısa vadeli yön bahsi İran yasalarında yasaktır; Birleşik Krallık ve AB\'de de bireysel yatırımcılara yasaktır. Burası yalnızca mekanizmayı öğretmek içindir.',
    ur: 'یہ اسکرین صرف ورچوئل کریڈٹ پر چلتی ہے؛ اصل رقم منسلک نہیں ہو سکتی۔ اصل پیسے سے قلیل مدتی شرط ایرانی قانون میں ممنوع ہے، اور برطانیہ و یورپی یونین میں بھی عام صارفین کے لیے ممنوع ہے۔',
    id: 'Layar ini hanya berjalan dengan kredit virtual; dana nyata tidak dapat dihubungkan. Taruhan arah harga jangka pendek dengan uang nyata dilarang oleh hukum Iran dan juga bagi ritel di Inggris dan UE. Ini hanya untuk mengajarkan mekanismenya.',
    pt: 'Este ecrã funciona apenas com crédito virtual; não é possível ligar fundos reais. As apostas de curto prazo na direção do preço com dinheiro real são proibidas pela lei iraniana e também a retalho no Reino Unido e na UE. Existe apenas para ensinar o mecanismo.'
  },
  'invest.simNotice': {
    zh: '本模块用于学习：收益是模拟的，由虚拟额度按固定公式发放，不汇集也不承担任何真实资金风险。真实的投资产品需要正式牌照——Fanous Bazaar Pishgam 持有该牌照，真实版本已在规划中；在此之前，这里只是练习。',
    hi: 'यह मॉड्यूल सीखने के लिए है: प्रतिफल सिम्युलेटेड है और तय फ़ॉर्मूले से वर्चुअल क्रेडिट में मिलता है, कोई असली पैसा जमा या जोखिम में नहीं है। असली निवेश उत्पाद के लिए औपचारिक लाइसेंस चाहिए — Fanous Bazaar Pishgam के पास वह लाइसेंस है और असली संस्करण योजना में है; तब तक यह अभ्यास है।',
    es: 'Este módulo existe para aprender: el rendimiento es simulado y se paga con crédito virtual según una fórmula fija, así que no se agrupa ni se arriesga dinero real. Un producto de inversión real requiere autorización formal: Fanous Bazaar Pishgam posee esa licencia y una versión real está en la hoja de ruta; hasta entonces, esto es práctica.',
    fr: 'Ce module sert à apprendre : le rendement est simulé et versé en crédit virtuel selon une formule fixe, aucun argent réel n\'est collecté ni exposé. Un vrai produit d\'investissement exige un agrément : Fanous Bazaar Pishgam détient cette licence et une version réelle est prévue ; d\'ici là, ceci est un entraînement.',
    ru: 'Модуль создан для обучения: доходность смоделирована и начисляется виртуальными кредитами по фиксированной формуле, реальные деньги не собираются и не рискуют. Настоящий инвестиционный продукт требует официальной лицензии — она у Fanous Bazaar Pishgam есть, и реальная версия в планах; пока это тренировка.',
    tr: 'Bu modül öğrenmek içindir: getiri simüledir ve sabit bir formülle sanal krediden ödenir; gerçek para toplanmaz ve riske atılmaz. Gerçek bir yatırım ürünü resmi izin gerektirir — Fanous Bazaar Pishgam bu lisansa sahiptir ve gerçek sürüm yol haritasındadır; o zamana kadar burası pratiktir.',
    ur: 'یہ ماڈیول سیکھنے کے لیے ہے: منافع مصنوعی ہے اور مقررہ فارمولے سے ورچوئل کریڈٹ میں ادا ہوتا ہے، کوئی اصل رقم جمع یا خطرے میں نہیں۔ اصل سرمایہ کاری مصنوعات کے لیے باقاعدہ لائسنس درکار ہے — Fanous Bazaar Pishgam کے پاس وہ لائسنس ہے۔',
    id: 'Modul ini untuk belajar: imbal hasilnya simulasi dan dibayar dari kredit virtual dengan rumus tetap, jadi tidak ada uang nyata yang dikumpulkan atau dipertaruhkan. Produk investasi nyata butuh izin resmi — Fanous Bazaar Pishgam memilikinya dan versi nyata ada di peta jalan; sampai saat itu, ini latihan.',
    pt: 'Este módulo existe para aprender: o rendimento é simulado e pago em crédito virtual por uma fórmula fixa, pelo que não se junta nem arrisca dinheiro real. Um produto de investimento real exige autorização formal — a Fanous Bazaar Pishgam tem essa licença e uma versão real está planeada; até lá, isto é prática.'
  },
  /*
   * REMOVED — stocks.honestBody, rank.demoNotice, rank.emptyBoard.
   *
   * Three unreachable strings. en.json has no `stocks.honest*` namespace at
   * all and nothing renders these two rank notices — same missing public
   * board as the rank.* keys in wallet.mjs. All nine translations are in git
   * history; the generator refuses to carry strings no screen can reach.
   */

  /*
   * ─── BRIDGE ERROR CODES, ALL NINE PARTIAL LANGUAGES ─────────────────────
   * Reported twice in one round: the bridge tabs rendered machine codes
   * (`INSUFFICIENT_BALANCE`) and raw upstream prose because `bridge.err` held
   * five keys while the stack under it throws forty-odd codes — and a partial
   * locale fell back to ENGLISH for every one of them, so the errors were the
   * most English part of an otherwise translated screen. These are the codes
   * src/lib/bridgeErrors.js maps, so the sentence a Turkish user reads when a
   * transfer fails is Turkish, not `INSUFFICIENT_BALANCE`.
   */
  'bridge.err.NO_ROUTE': { zh: '当前没有该币对和金额的跨链路线。请尝试其他金额或网络。', hi: 'इस जोड़ी और राशि के लिए अभी कोई रास्ता नहीं है। दूसरी राशि या नेटवर्क आज़माएँ।', es: 'Ahora mismo no existe ruta para este par y importe. Prueba con otro importe o red.', fr: 'Aucun itinéraire n’existe pour cette paire et ce montant pour le moment. Essayez un autre montant ou réseau.', ru: 'Сейчас маршрута для этой пары и суммы нет. Попробуйте другую сумму или сеть.', tr: 'Şu anda bu parite ve tutar için rota yok. Farklı bir tutar veya ağ deneyin.', ur: 'اس جوڑی اور رقم کے لیے فی الحال کوئی راستہ نہیں۔ دوسری رقم یا نیٹ ورک آزمائیں۔', id: 'Saat ini tidak ada rute untuk pasangan dan jumlah ini. Coba jumlah atau jaringan lain.', pt: 'Neste momento não existe rota para este par e montante. Tente outro montante ou rede.' },
  'bridge.err.NO_SIGNER': { zh: '钱包无法生成签名。请重新连接后再试。', hi: 'वॉलेट हस्ताक्षर नहीं बना पाया। इसे दोबारा जोड़ें और फिर कोशिश करें।', es: 'La cartera no pudo generar la firma. Reconéctala e inténtalo de nuevo.', fr: 'Le portefeuille n’a pas pu produire la signature. Reconnectez-le et réessayez.', ru: 'Кошелёк не смог создать подпись. Подключите его заново и повторите.', tr: 'Cüzdan imza oluşturamadı. Yeniden bağlayın ve tekrar deneyin.', ur: 'والٹ دستخط نہیں بنا سکا۔ اسے دوبارہ جوڑیں اور پھر کوشش کریں۔', id: 'Dompet tidak dapat membuat tanda tangan. Sambungkan ulang lalu coba lagi.', pt: 'A carteira não conseguiu gerar a assinatura. Reconecte-a e tente de novo.' },
  'bridge.err.NO_RECIPIENT': { zh: '请输入接收资金的目标地址。', hi: 'जिसे धन प्राप्त होगा उस गंतव्य पते को दर्ज करें।', es: 'Introduce la dirección de destino que debe recibir los fondos.', fr: 'Saisissez l’adresse de destination qui doit recevoir les fonds.', ru: 'Введите адрес получателя, на который должны прийти средства.', tr: 'Fonları alacak hedef adresi girin.', ur: 'جسے فنڈز ملنے ہیں وہ منزل کا پتہ درج کریں۔', id: 'Masukkan alamat tujuan yang akan menerima dana.', pt: 'Introduza o endereço de destino que deve receber os fundos.' },
  'bridge.err.TX_FAILED': { zh: '交易未完成。没有发送任何资产。', hi: 'लेन-देन पूरा नहीं हुआ। कुछ भी नहीं भेजा गया।', es: 'La transacción no se completó. No se envió nada.', fr: 'La transaction n’a pas abouti. Rien n’a été envoyé.', ru: 'Транзакция не прошла. Ничего не отправлено.', tr: 'İşlem tamamlanmadı. Hiçbir şey gönderilmedi.', ur: 'لین دین مکمل نہیں ہوا۔ کچھ بھی نہیں بھیجا گیا۔', id: 'Transaksi tidak selesai. Tidak ada yang dikirim.', pt: 'A transação não foi concluída. Nada foi enviado.' },
  'bridge.err.WRONG_NETWORK': { zh: '钱包在其他网络上。请切换到源网络后重试。', hi: 'वॉलेट किसी और नेटवर्क पर है। इसे मूल नेटवर्क पर बदलें और फिर कोशिश करें।', es: 'La cartera está en otra red. Cámbiala a la red de origen e inténtalo de nuevo.', fr: 'Le portefeuille est sur un autre réseau. Basculez-le sur le réseau d’origine et réessayez.', ru: 'Кошелёк в другой сети. Переключите его на сеть отправки и повторите.', tr: 'Cüzdan başka bir ağda. Kaynak ağa geçirin ve tekrar deneyin.', ur: 'والٹ کسی اور نیٹ ورک پر ہے۔ اسے ماخذ نیٹ ورک پر بدلیں اور دوبارہ کوشش کریں۔', id: 'Dompet berada di jaringan lain. Alihkan ke jaringan asal lalu coba lagi.', pt: 'A carteira está noutra rede. Mude para a rede de origem e tente de novo.' },
  'bridge.err.CHAIN_SWITCH_REJECTED': { zh: '钱包中拒绝了网络切换。请批准切换以继续。', hi: 'वॉलेट में नेटवर्क बदलने से इनकार कर दिया गया। जारी रखने के लिए स्विच स्वीकार करें।', es: 'Se rechazó el cambio de red en la cartera. Apruébalo para continuar.', fr: 'Le changement de réseau a été refusé dans le portefeuille. Approuvez-le pour continuer.', ru: 'Смена сети отклонена в кошельке. Подтвердите её, чтобы продолжить.', tr: 'Ağ değişimi cüzdanda reddedildi. Devam etmek için değişimi onaylayın.', ur: 'والٹ میں نیٹ ورک تبدیلی مسترد کر دی گئی۔ جاری رکھنے کے لیے تبدیلی منظور کریں۔', id: 'Perpindahan jaringan ditolak di dompet. Setujui untuk melanjutkan.', pt: 'A mudança de rede foi recusada na carteira. Aprove-a para continuar.' },
  'bridge.err.INSUFFICIENT_BALANCE': { zh: '钱包中该代币余额不足以完成转账。', hi: 'इस टोकन की वॉलेट में इस ट्रांसफर के लिए पर्याप्त राशि नहीं है।', es: 'La cartera no tiene suficiente de este token para la transferencia.', fr: 'Le portefeuille ne détient pas assez de ce jeton pour le transfert.', ru: 'В кошельке недостаточно этого токена для перевода.', tr: 'Bu transfer için cüzdanda yeterli token yok.', ur: 'اس ٹرانسفر کے لیے والٹ میں اس ٹوکن کی کافی مقدار نہیں ہے۔', id: 'Dompet tidak punya cukup token ini untuk transfer.', pt: 'A carteira não tem tokens suficientes para a transferência.' },
  'bridge.err.INSUFFICIENT_GAS': { zh: '钱包内原生代币不足以支付网络费用。', hi: 'नेटवर्क शुल्क चुकाने के लिए वॉलेट में पर्याप्त मूल कॉइन नहीं है।', es: 'No hay suficiente moneda nativa en la cartera para pagar la comisión de red.', fr: 'Il n’y a pas assez de monnaie native dans le portefeuille pour payer les frais de réseau.', ru: 'В кошельке недостаточно нативной монеты для оплаты комиссии сети.', tr: 'Ağ ücretini ödemek için cüzdanda yeterli yerel coin yok.', ur: 'نیٹ ورک فیس ادا کرنے کے لیے والٹ میں کافی مقامی سکہ نہیں ہے۔', id: 'Tidak ada koin asli yang cukup di dompet untuk membayar biaya jaringan.', pt: 'Não há moeda nativa suficiente na carteira para pagar a taxa de rede.' },
  'bridge.err.USER_REJECTED': { zh: '请求已在钱包中被拒绝。没有发送任何资产。', hi: 'वॉलेट में अनुरोध अस्वीकार कर दिया गया। कुछ भी नहीं भेजा गया।', es: 'La solicitud se rechazó en la cartera. No se envió nada.', fr: 'La demande a été refusée dans le portefeuille. Rien n’a été envoyé.', ru: 'Запрос отклонён в кошельке. Ничего не отправлено.', tr: 'İstek cüzdanda reddedildi. Hiçbir şey gönderilmedi.', ur: 'درخواست والٹ میں مسترد کر دی گئی۔ کچھ بھی نہیں بھیجا گیا۔', id: 'Permintaan ditolak di dompet. Tidak ada yang dikirim.', pt: 'O pedido foi recusado na carteira. Nada foi enviado.' },
  'bridge.err.ROUTE_NOT_EXECUTABLE': { zh: '该路线已无法签名——正在获取新报价。', hi: 'यह रास्ता अब हस्ताक्षर योग्य नहीं है — नई दर ली जा रही है।', es: 'Esta ruta ya no se puede firmar: se está obteniendo una nueva cotización.', fr: 'Cet itinéraire ne peut plus être signé — un nouveau tarif est récupéré.', ru: 'Этот маршрут больше нельзя подписать — запрашивается новый курс.', tr: 'Bu rota artık imzalanamıyor — yeni kur alınıyor.', ur: 'یہ راستہ اب دستخط کے قابل نہیں — نئی شرح حاصل کی جا رہی ہے۔', id: 'Rute ini tidak bisa ditandatangani lagi — kurs baru sedang diambil.', pt: 'Esta rota já não pode ser assinada — está a obter-se uma nova cotação.' },
  'bridge.err.BROADCAST_FAILED': { zh: '网络拒绝了该交易。如有资产离开钱包，可在钱包记录中查看。', hi: 'नेटवर्क ने लेन-देन अस्वीकार कर दिया। यदि कुछ वॉलेट से निकला हो तो वॉलेट इतिहास में दिखेगा।', es: 'La red rechazó la transacción. Si algo salió de la cartera, se ve en su historial.', fr: 'Le réseau a rejeté la transaction. Si quelque chose a quitté le portefeuille, c’est visible dans son historique.', ru: 'Сеть отклонила транзакцию. Если что-то покинуло кошелёк, это видно в его истории.', tr: 'Ağ işlemi reddetti. Cüzdandan bir şey çıktıysa geçmişinde görünür.', ur: 'نیٹ ورک نے لین دین مسترد کر دیا۔ اگر والٹ سے کچھ نکلا ہو تو والٹ کی سرگزشت میں نظر آئے گا۔', id: 'Jaringan menolak transaksi. Jika ada yang keluar dari dompet, terlihat di riwayatnya.', pt: 'A rede rejeitou a transação. Se algo saiu da carteira, vê-se no histórico dela.' },
  'bridge.err.QUOTE_EXPIRED': { zh: '签名前报价已过期。正在获取新报价。', hi: 'हस्ताक्षर से पहले दर समाप्त हो गई। नई दर ली जा रही है।', es: 'La cotización caducó antes de firmar. Se está obteniendo una nueva.', fr: 'Le tarif a expiré avant la signature. Un nouveau est récupéré.', ru: 'Курс истёк до подписания. Запрашивается новый.', tr: 'Kur, imzalamadan önce süresi doldu. Yeni kur alınıyor.', ur: 'دستخط سے پہلے شرح کی میعاد ختم ہو گئی۔ نئی شرح حاصل کی جا رہی ہے۔', id: 'Kurs kedaluwarsa sebelum ditandatangani. Kurs baru sedang diambil.', pt: 'A cotação expirou antes da assinatura. Está a obter-se uma nova.' },
  'bridge.err.PROVIDER_UNAVAILABLE': { zh: '路由服务当前不可用。没有发送任何资产。', hi: 'रूटिंग सेवा अभी उपलब्ध नहीं है। कुछ भी नहीं भेजा गया।', es: 'El proveedor de rutas no está disponible ahora mismo. No se envió nada.', fr: 'Le fournisseur de routage est indisponible pour le moment. Rien n’a été envoyé.', ru: 'Сервис маршрутизации сейчас недоступен. Ничего не отправлено.', tr: 'Yönlendirme servisi şu anda erişilemiyor. Hiçbir şey gönderilmedi.', ur: 'روٹنگ سروس فی الحال دستیاب نہیں۔ کچھ بھی نہیں بھیجا گیا۔', id: 'Layanan perutean sedang tidak tersedia. Tidak ada yang dikirim.', pt: 'O fornecedor de rotas está indisponível neste momento. Nada foi enviado.' },
  'bridge.err.PROVIDER_BAD_RESPONSE': { zh: '路由服务返回了无法使用的数据。请稍后重试。', hi: 'रूटिंग सेवा ने अनुपयोगी डेटा दिया। थोड़ी देर बाद फिर कोशिश करें।', es: 'El proveedor de rutas respondió con datos que no se pueden usar. Inténtalo en un momento.', fr: 'Le fournisseur de routage a répondu avec des données inutilisables. Réessayez dans un instant.', ru: 'Сервис маршрутизации вернул непригодные данные. Попробуйте позже.', tr: 'Yönlendirme servisi kullanılamayan veri döndürdü. Birazdan tekrar deneyin.', ur: 'روٹنگ سروس نے ناقابلِ استعمال ڈیٹا دیا۔ تھوڑی دیر بعد دوبارہ کوشش کریں۔', id: 'Layanan perutean mengirim data yang tak dapat digunakan. Coba lagi sebentar.', pt: 'O fornecedor de rotas respondeu com dados inutilizáveis. Tente de novo daqui a pouco.' },
  'bridge.err.PROVIDER_RATE_LIMITED': { zh: '路由服务限制了我们的请求频率。请稍后重试。', hi: 'रूटिंग सेवा ने हमारे अनुरोध सीमित कर दिए। थोड़ी देर बाद फिर कोशिश करें।', es: 'El proveedor de rutas está limitando nuestras peticiones. Espera un momento e inténtalo de nuevo.', fr: 'Le fournisseur de routage limite nos requêtes. Patientez un instant et réessayez.', ru: 'Сервис маршрутизации ограничивает наши запросы. Подождите и повторите.', tr: 'Yönlendirme servisi isteklerimizi sınırlıyor. Biraz bekleyip tekrar deneyin.', ur: 'روٹنگ سروس ہماری درخواستیں محدود کر رہی ہے۔ تھوڑا انتظار کریں اور دوبارہ کوشش کریں۔', id: 'Layanan perutean membatasi permintaan kami. Tunggu sebentar lalu coba lagi.', pt: 'O fornecedor de rotas está a limitar os nossos pedidos. Espere um momento e tente de novo.' },
  'bridge.err.UPSTREAM_FAILED': { zh: '上游报价服务失败。请稍后重试。', hi: 'अपस्ट्रीम कोट सेवा विफल रही। थोड़ी देर बाद फिर कोशिश करें।', es: 'El servicio de cotización falló. Inténtalo en un momento.', fr: 'Le service de cotation a échoué. Réessayez dans un instant.', ru: 'Сервис котировок вернул ошибку. Попробуйте позже.', tr: 'Kotasyon servisi başarısız oldu. Birazdan tekrar deneyin.', ur: 'اپ اسٹریم کوٹ سروس ناکام رہی۔ تھوڑی دیر بعد دوبارہ کوشش کریں۔', id: 'Layanan kutipan gagal. Coba lagi sebentar.', pt: 'O serviço de cotação falhou. Tente de novo daqui a pouco.' },
  'bridge.err.UPSTREAM_TIMEOUT': { zh: '获取报价耗时过长。请重试。', hi: 'दर लेने में बहुत समय लगा। दोबारा कोशिश करें।', es: 'La cotización tardó demasiado. Inténtalo de nuevo.', fr: 'La cotation a pris trop de temps. Réessayez.', ru: 'Получение котировки заняло слишком много времени. Повторите.', tr: 'Kur almak çok uzun sürdü. Tekrar deneyin.', ur: 'شرح حاصل کرنے میں بہت وقت لگا۔ دوبارہ کوشش کریں۔', id: 'Pengambilan kutipan terlalu lama. Coba lagi.', pt: 'A cotação demorou demasiado. Tente de novo.' },
  'bridge.err.NETWORK_FAILED': { zh: '网络请求失败。请检查连接后重试。', hi: 'नेटवर्क अनुरोध विफल रहा। कनेक्शन जाँचें और दोबारा कोशिश करें।', es: 'La petición de red falló. Comprueba la conexión e inténtalo de nuevo.', fr: 'La requête réseau a échoué. Vérifiez la connexion et réessayez.', ru: 'Сетевой запрос не удался. Проверьте соединение и повторите.', tr: 'Ağ isteği başarısız oldu. Bağlantıyı kontrol edip tekrar deneyin.', ur: 'نیٹ ورک درخواست ناکام رہی۔ کنکشن چیک کریں اور دوبارہ کوشش کریں۔', id: 'Permintaan jaringan gagal. Periksa koneksi lalu coba lagi.', pt: 'O pedido de rede falhou. Verifique a ligação e tente de novo.' },
  'bridge.err.TIMEOUT': { zh: '请求超时。请重试。', hi: 'अनुरोध का समय समाप्त हो गया। दोबारा कोशिश करें।', es: 'La petición caducó. Inténtalo de nuevo.', fr: 'La requête a expiré. Réessayez.', ru: 'Время запроса истекло. Повторите.', tr: 'İstek zaman aşımına uğradı. Tekrar deneyin.', ur: 'درخواست کی میعاد ختم ہو گئی۔ دوبارہ کوشش کریں۔', id: 'Permintaan habis waktu. Coba lagi.', pt: 'O pedido expirou. Tente de novo.' },
  'bridge.err.AMOUNT_TOO_LOW': { zh: '该金额对此路线来说太小。请尝试更大金额。', hi: 'यह राशि इस रास्ते के लिए बहुत कम है। बड़ी राशि आज़माएँ।', es: 'Este importe es demasiado pequeño para esta ruta. Prueba con uno mayor.', fr: 'Ce montant est trop faible pour cet itinéraire. Essayez un montant plus élevé.', ru: 'Эта сумма слишком мала для этого маршрута. Попробуйте большую.', tr: 'Bu tutar bu rota için çok küçük. Daha büyük bir tutar deneyin.', ur: 'یہ رقم اس راستے کے لیے بہت کم ہے۔ بڑی رقم آزمائیں۔', id: 'Jumlah ini terlalu kecil untuk rute ini. Coba jumlah lebih besar.', pt: 'Este montante é demasiado pequeno para esta rota. Tente um maior.' },
  'bridge.err.WALLET_REQUIRED': { zh: '请连接钱包以继续。', hi: 'जारी रखने के लिए वॉलेट जोड़ें।', es: 'Conecta una cartera para continuar.', fr: 'Connectez un portefeuille pour continuer.', ru: 'Подключите кошелёк, чтобы продолжить.', tr: 'Devam etmek için bir cüzdan bağlayın.', ur: 'جاری رکھنے کے لیے والٹ جوڑیں۔', id: 'Sambungkan dompet untuk melanjutkan.', pt: 'Ligue uma carteira para continuar.' },
  'bridge.err.WALLET_NOT_CONNECTED': { zh: '钱包已断开连接。请重新连接后重试。', hi: 'वॉलेट अब जुड़ा नहीं है। दोबारा जोड़ें और कोशिश करें।', es: 'La cartera ya no está conectada. Reconéctala e inténtalo de nuevo.', fr: 'Le portefeuille n’est plus connecté. Reconnectez-le et réessayez.', ru: 'Кошелёк больше не подключён. Подключите его заново и повторите.', tr: 'Cüzdan artık bağlı değil. Yeniden bağlayın ve tekrar deneyin.', ur: 'والٹ اب متصل نہیں۔ دوبارہ جوڑیں اور کوشش کریں۔', id: 'Dompet sudah tidak terhubung. Sambungkan ulang lalu coba lagi.', pt: 'A carteira já não está ligada. Reconecte-a e tente de novo.' },
  'bridge.err.BAD_CHAIN': { zh: '所选网络之一不支持此路线。', hi: 'चुने गए नेटवर्क में से एक इस रास्ते पर समर्थित नहीं है।', es: 'Una de las redes seleccionadas no está soportada en esta ruta.', fr: 'Un des réseaux sélectionnés n’est pas pris en charge sur cet itinéraire.', ru: 'Одна из выбранных сетей не поддерживается на этом маршруте.', tr: 'Seçilen ağlardan biri bu rotada desteklenmiyor.', ur: 'منتخب نیٹ ورکس میں سے ایک اس راستے پر معاون نہیں۔', id: 'Salah satu jaringan yang dipilih tidak didukung di rute ini.', pt: 'Uma das redes selecionadas não é suportada nesta rota.' },
  'bridge.err.BAD_TOKEN': { zh: '该代币在此路线不可用。', hi: 'यह टोकन इस रास्ते पर उपलब्ध नहیं है।', es: 'Ese token no está disponible en esta ruta.', fr: 'Ce jeton n’est pas disponible sur cet itinéraire.', ru: 'Этот токен недоступен на этом маршруте.', tr: 'Bu token bu rotada mevcut değil.', ur: 'یہ ٹوکن اس راستے پر دستیاب نہیں۔', id: 'Token ini tidak tersedia di rute ini.', pt: 'Esse token não está disponível nesta rota.' },
  'bridge.err.BAD_ORIGIN_ADDRESS': { zh: '无法读取发送地址。请重新连接钱包。', hi: 'भेजने वाला पता पढ़ा नहीं जा सका। वॉलेट दोबारा जोड़ें।', es: 'No se pudo leer la dirección de envío. Reconecta la cartera.', fr: 'Impossible de lire l’adresse d’envoi. Reconnectez le portefeuille.', ru: 'Не удалось прочитать адрес отправителя. Подключите кошелёк заново.', tr: 'Gönderim adresi okunamadı. Cüzdanı yeniden bağlayın.', ur: 'بھیجنے والا پتہ نہیں پڑھا جا سکا۔ والٹ دوبارہ جوڑیں۔', id: 'Alamat pengirim tidak dapat dibaca. Sambungkan ulang dompet.', pt: 'Não foi possível ler o endereço de envio. Reconecte a carteira.' },
  'bridge.err.DESTINATION_ADDRESS_REQUIRED': { zh: '请输入目标地址——此路线无法使用默认地址。', hi: 'गंतव्य पता दर्ज करें — यह रास्ता इसे स्वयं नहीं चुन सकता।', es: 'Introduce la dirección de destino: esta ruta no puede asumirla por defecto.', fr: 'Saisissez l’adresse de destination — cet itinéraire ne peut pas la déduire.', ru: 'Введите адрес назначения — этот маршрут не может подставить его сам.', tr: 'Hedef adresi girin — bu rota bunu varsayılan olarak seçemez.', ur: 'منزل کا پتہ درج کریں — یہ راستہ خود اسے منتخب نہیں کر سکتا۔', id: 'Masukkan alamat tujuan — rute ini tidak bisa menentukannya sendiri.', pt: 'Introduza o endereço de destino — esta rota não o pode assumir.' },
  'bridge.err.CROSSCHAIN_NOT_CONFIGURED': { zh: '此部署未配置跨链服务。', hi: 'इस डिप्लॉयमेंट पर क्रॉस-चेन सेवा कॉन्फ़िगर नहीं है।', es: 'El servicio de cadenas cruzadas no está configurado en este despliegue.', fr: 'Le service inter-chaînes n’est pas configuré sur ce déploiement.', ru: 'Сервис кросс-чейн переводов не настроен в этой сборке.', tr: 'Bu dağıtımda çapraz zincir servisi yapılandırılmamış.', ur: 'اس تعیناتی پر کراس چین سروس ترتیب نہیں دی گئی۔', id: 'Layanan lintas rantai belum dikonfigurasi di deployment ini.', pt: 'O serviço entre cadeias não está configurado nesta implantação.' },
  'bridge.err.GENERIC': { zh: '出现问题（{{code}}）。没有发送任何资产。', hi: 'कुछ गड़बड़ हुई ({{code}})। कुछ भी नहीं भेजा गया।', es: 'Algo salió mal ({{code}}). No se envió nada.', fr: 'Un problème est survenu ({{code}}). Rien n’a été envoyé.', ru: 'Что-то пошло не так ({{code}}). Ничего не отправлено.', tr: 'Bir sorun oluştu ({{code}}). Hiçbir şey gönderilmedi.', ur: 'کچھ خراب ہو گیا ({{code}})۔ کچھ بھی نہیں بھیجا گیا۔', id: 'Terjadi masalah ({{code}}). Tidak ada yang dikirim.', pt: 'Ocorreu um problema ({{code}}). Nada foi enviado.' },

  /* -------------------------------- bridge ----------------------------- */
  'bridge.emptyHint': {
    zh: '输入金额以查看最佳路径和费用。',
    hi: 'सर्वोत्तम मार्ग और शुल्क देखने के लिए राशि दर्ज करें।',
    es: 'Introduce un importe para ver la mejor ruta y sus comisiones.',
    fr: 'Saisissez un montant pour voir le meilleur itinéraire et ses frais.',
    ru: 'Введите сумму, чтобы увидеть лучший маршрут и комиссии.',
    tr: 'En iyi rotayı ve ücretleri görmek için bir tutar girin.',
    ur: 'بہترین راستہ اور اس کی فیس دیکھنے کے لیے رقم درج کریں۔',
    id: 'Masukkan jumlah untuk melihat rute terbaik dan biayanya.',
    pt: 'Introduza um valor para ver a melhor rota e as suas taxas.'
  },
};
