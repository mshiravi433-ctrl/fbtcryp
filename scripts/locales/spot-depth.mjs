/**
 * Spot depth card (src/components/spot/SpotDepth.jsx): the indicative price-impact
 * curve built from non-binding aggregator quotes.
 *
 * en and fa live in src/i18n/locales/{en,fa}.json; ar is hand-kept there too.
 * The nine languages below are merged by scripts/gen-locales.mjs. Placeholders
 * ({{time}}, {{value}}, {{medium}}, {{high}}) must survive translation.
 *
 * Wording rule for this card: quotes are NOT binding and NOT an order book. Never
 * promise a fill or a price. Keep the words «indicative» / «non-binding» intact.
 */
export default {
  'spot.depth.title': {
    zh: '报价深度', hi: 'कोटेशन से गहराई', es: 'Profundidad a partir de cotizaciones',
    fr: 'Profondeur à partir des cotations', ru: 'Глубина по котировкам',
    tr: 'Teklif verisinden derinlik', ur: 'کوٹیشنز سے گہرائی',
    id: 'Kedalaman dari kutipan', pt: 'Profundidade a partir de cotações'
  },
  'spot.depth.caveat': {
    zh: '仅供参考。这些是各规模下聚合器返回的非约束性报价。这不是订单簿，兑换时价格可能变化。',
    hi: 'केवल संकेत के लिए। ये हर आकार के लिए एग्रीगेटर के गैर-बाध्यकारी कोटेशन हैं। यह ऑर्डर बुक नहीं है, और स्वैप करते समय कीमत बदल सकती है।',
    es: 'Solo orientativo. Son cotizaciones no vinculantes del agregador para cada tamaño. No es un libro de órdenes y el precio puede cambiar al hacer el intercambio.',
    fr: "Indicatif uniquement. Il s'agit de cotations non contraignantes de l'agrégateur pour chaque montant. Ce n'est pas un carnet d'ordres, et le prix peut changer lors de l'échange.",
    ru: 'Только для ориентира. Это необязывающие котировки агрегатора для каждого объёма. Это не стакан заявок, и цена может измениться при обмене.',
    tr: 'Yalnızca gösterge niteliğindedir. Bunlar her tutar için toplayıcının bağlayıcı olmayan teklifleridir. Emir defteri değildir ve takas sırasında fiyat değişebilir.',
    ur: 'صرف اشارے کے لیے۔ یہ ہر مقدار کے لیے ایگریگیٹر کی غیر پابند کوٹیشنز ہیں۔ یہ آرڈر بک نہیں ہے، اور سواپ کے وقت قیمت بدل سکتی ہے۔',
    id: 'Hanya indikatif. Ini adalah kutipan agregator yang tidak mengikat untuk setiap ukuran. Ini bukan buku pesanan, dan harga dapat berubah saat menukar.',
    pt: 'Apenas indicativo. São cotações não vinculantes do agregador para cada valor. Não é um livro de ofertas, e o preço pode mudar ao trocar.'
  },
  'spot.depth.updatedAt': {
    zh: '更新于 {{time}}', hi: '{{time}} पर अपडेट किया गया', es: 'Actualizado {{time}}',
    fr: 'Mis à jour à {{time}}', ru: 'Обновлено в {{time}}', tr: '{{time}} itibarıyla güncellendi',
    ur: '{{time}} پر اپ ڈیٹ', id: 'Diperbarui {{time}}', pt: 'Atualizado às {{time}}'
  },
  'spot.depth.stale': {
    zh: '已过期——点击刷新获取最新报价', hi: 'पुराना — ताज़ा कोटेशन के लिए रीफ़्रेश दबाएँ',
    es: 'Desactualizado: toca actualizar para cotizaciones actuales',
    fr: 'Périmé : appuyez sur actualiser pour des cotations à jour',
    ru: 'Устарело — нажмите обновить, чтобы получить текущие котировки',
    tr: 'Eski veri — güncel teklifler için yenileyin', ur: 'پرانا ڈیٹا — تازہ کوٹیشنز کے لیے ری فریش دبائیں',
    id: 'Usang — ketuk segarkan untuk kutipan terbaru', pt: 'Desatualizado: toque em atualizar para cotações atuais'
  },
  'spot.depth.refresh': {
    zh: '刷新', hi: 'रीफ़्रेश', es: 'Actualizar', fr: 'Actualiser', ru: 'Обновить',
    tr: 'Yenile', ur: 'ری فریش', id: 'Segarkan', pt: 'Atualizar'
  },
  'spot.depth.loading': {
    zh: '正在获取报价…', hi: 'कोटेशन लाए जा रहे हैं…', es: 'Obteniendo cotizaciones…',
    fr: 'Récupération des cotations…', ru: 'Получаем котировки…', tr: 'Teklifler alınıyor…',
    ur: 'کوٹیشنز حاصل کی جا رہی ہیں…', id: 'Mengambil kutipan…', pt: 'Obtendo cotações…'
  },
  'spot.depth.noPrice': {
    zh: '该代币没有美元价格，无法设定交易规模，因此不显示深度。',
    hi: 'इस टोकन की USD कीमत उपलब्ध नहीं है, इसलिए ट्रेड आकार तय नहीं हो सकते। गहराई नहीं दिखाई जाती।',
    es: 'No hay precio en USD para este token, así que no se pueden fijar los tamaños. No se muestra la profundidad.',
    fr: "Aucun prix en USD pour ce token, les montants ne peuvent donc pas être définis. La profondeur n'est pas affichée.",
    ru: 'Для этого токена нет цены в USD, поэтому объёмы не задать. Глубина не показана.',
    tr: 'Bu token için USD fiyatı yok, bu yüzden işlem tutarları belirlenemez. Derinlik gösterilmiyor.',
    ur: 'اس ٹوکن کی USD قیمت دستیاب نہیں، اس لیے ٹریڈ کی مقداریں طے نہیں ہو سکتیں۔ گہرائی نہیں دکھائی جاتی۔',
    id: 'Tidak ada harga USD untuk token ini, sehingga ukuran perdagangan tidak dapat ditetapkan. Kedalaman tidak ditampilkan.',
    pt: 'Não há preço em USD para este token, então os valores não podem ser definidos. A profundidade não é exibida.'
  },
  'spot.depth.unsupported': {
    zh: '此网络上该交易对暂无深度数据。', hi: 'इस नेटवर्क पर इस जोड़ी के लिए गहराई उपलब्ध नहीं है।',
    es: 'La profundidad no está disponible para este par en esta red.',
    fr: "La profondeur n'est pas disponible pour cette paire sur ce réseau.",
    ru: 'Глубина для этой пары в этой сети недоступна.', tr: 'Bu ağda bu çift için derinlik kullanılamıyor.',
    ur: 'اس نیٹ ورک پر اس جوڑے کے لیے گہرائی دستیاب نہیں۔',
    id: 'Kedalaman tidak tersedia untuk pasangan ini di jaringan ini.',
    pt: 'A profundidade não está disponível para este par nesta rede.'
  },
  'spot.depth.error': {
    zh: '无法获取报价，请重试。', hi: 'कोटेशन नहीं मिल सके। दोबारा कोशिश करें।',
    es: 'No se pudieron obtener las cotizaciones. Inténtalo de nuevo.',
    fr: "Impossible d'obtenir les cotations. Réessayez.", ru: 'Не удалось получить котировки. Попробуйте снова.',
    tr: 'Teklifler alınamadı. Tekrar deneyin.', ur: 'کوٹیشنز حاصل نہیں ہو سکیں۔ دوبارہ کوشش کریں۔',
    id: 'Gagal mengambil kutipan. Coba lagi.', pt: 'Não foi possível obter as cotações. Tente novamente.'
  },
  'spot.depth.chartLabel': {
    zh: '按交易规模划分的价格影响', hi: 'ट्रेड आकार के अनुसार कीमत पर असर', es: 'Impacto en el precio según el tamaño de la operación',
    fr: "Impact sur le prix selon le montant de l'échange", ru: 'Влияние на цену по объёму сделки',
    tr: 'İşlem tutarına göre fiyat etkisi', ur: 'ٹریڈ کی مقدار کے لحاظ سے قیمت پر اثر',
    id: 'Dampak harga menurut ukuran perdagangan', pt: 'Impacto no preço por valor da operação'
  },
  'spot.depth.tableCaption': {
    zh: '按交易规模的报价（仅供参考）', hi: 'ट्रेड आकार के अनुसार कोटेशन (संकेतक)', es: 'Cotizaciones por tamaño de operación (orientativo)',
    fr: "Cotations par montant d'échange (indicatif)", ru: 'Котировки по объёму сделки (ориентировочно)',
    tr: 'İşlem tutarına göre teklifler (gösterge niteliğinde)', ur: 'ٹریڈ کی مقدار کے لحاظ سے کوٹیشنز (اشاریہ)',
    id: 'Kutipan menurut ukuran perdagangan (indikatif)', pt: 'Cotações por valor da operação (indicativo)'
  },
  'spot.depth.col.size': {
    zh: '规模', hi: 'आकार', es: 'Tamaño', fr: 'Montant', ru: 'Объём', tr: 'Tutar', ur: 'مقدار', id: 'Ukuran', pt: 'Valor'
  },
  'spot.depth.col.rate': {
    zh: '汇率', hi: 'दर', es: 'Tasa', fr: 'Taux', ru: 'Курс', tr: 'Oran', ur: 'شرح', id: 'Kurs', pt: 'Taxa'
  },
  'spot.depth.col.impact': {
    zh: '价格影响', hi: 'कीमत पर असर', es: 'Impacto en el precio', fr: 'Impact sur le prix', ru: 'Влияние на цену',
    tr: 'Fiyat etkisi', ur: 'قیمت پر اثر', id: 'Dampak harga', pt: 'Impacto no preço'
  },
  'spot.depth.col.signal': {
    zh: '信号', hi: 'संकेत', es: 'Señal', fr: 'Signal', ru: 'Сигнал', tr: 'Sinyal', ur: 'اشارہ', id: 'Sinyal', pt: 'Sinal'
  },
  'spot.depth.impactTip': {
    zh: '相比最小规模 {{value}}%', hi: 'सबसे छोटे आकार की तुलना में {{value}}%', es: '{{value}} % frente al tamaño más pequeño',
    fr: '{{value}} % par rapport au plus petit montant', ru: '{{value}}% относительно наименьшего объёма',
    tr: 'En küçük tutara göre %{{value}}', ur: 'سب سے چھوٹی مقدار کے مقابلے میں {{value}}٪',
    id: '{{value}}% dibanding ukuran terkecil', pt: '{{value}}% em relação ao menor valor'
  },
  'spot.depth.pointUnavailable': {
    zh: '不可用', hi: 'उपलब्ध नहीं', es: 'No disponible', fr: 'Indisponible', ru: 'Недоступно',
    tr: 'Kullanılamıyor', ur: 'دستیاب نہیں', id: 'Tidak tersedia', pt: 'Indisponível'
  },
  'spot.depth.band.low': {
    zh: '低影响', hi: 'कम असर', es: 'Impacto bajo', fr: 'Impact faible', ru: 'Низкое влияние',
    tr: 'Düşük etki', ur: 'کم اثر', id: 'Dampak rendah', pt: 'Impacto baixo'
  },
  'spot.depth.band.medium': {
    zh: '中等影响', hi: 'मध्यम असर', es: 'Impacto medio', fr: 'Impact moyen', ru: 'Среднее влияние',
    tr: 'Orta etki', ur: 'درمیانہ اثر', id: 'Dampak sedang', pt: 'Impacto médio'
  },
  'spot.depth.band.high': {
    zh: '高影响', hi: 'ज़्यादा असर', es: 'Impacto alto', fr: 'Impact élevé', ru: 'Высокое влияние',
    tr: 'Yüksek etki', ur: 'زیادہ اثر', id: 'Dampak tinggi', pt: 'Impacto alto'
  },
  'spot.depth.thresholds': {
    zh: '估计区间：相比最小规模，中等为 {{medium}}% 起，高为 {{high}}% 起。阈值为估计值。',
    hi: 'अनुमानित सीमाएँ: सबसे छोटे आकार की तुलना में मध्यम {{medium}}% से, ज़्यादा {{high}}% से। ये सीमाएँ अनुमानित हैं।',
    es: 'Bandas estimadas: medio desde {{medium}} %, alto desde {{high}} % frente al tamaño más pequeño. Los umbrales son estimaciones.',
    fr: 'Seuils estimés : moyen à partir de {{medium}} %, élevé à partir de {{high}} % par rapport au plus petit montant. Ces seuils sont des estimations.',
    ru: 'Ориентировочные границы: средний уровень от {{medium}}%, высокий от {{high}}% относительно наименьшего объёма. Пороги ориентировочные.',
    tr: 'Tahmini bantlar: en küçük tutara göre %{{medium}} ve üzeri orta, %{{high}} ve üzeri yüksek. Eşikler tahminidir.',
    ur: 'تخمینی حدود: سب سے چھوٹی مقدار کے مقابلے میں {{medium}}٪ سے درمیانہ اور {{high}}٪ سے زیادہ۔ یہ حدیں تخمینی ہیں۔',
    id: 'Pita perkiraan: sedang dari {{medium}}%, tinggi dari {{high}}% dibanding ukuran terkecil. Ambang batas ini perkiraan.',
    pt: 'Faixas estimadas: médio a partir de {{medium}}%, alto a partir de {{high}}% em relação ao menor valor. Os limites são estimativas.'
  },
  'spot.depth.disclaimer': {
    zh: '报价不具约束力，会随执行而变化。这不代表成交承诺，也不是交易场所的订单簿。',
    hi: 'कोटेशन बाध्यकारी नहीं हैं और निष्पादन के साथ बदलते हैं। यह ट्रेड पूरा होने का वादा नहीं है, और न ही प्लेटफ़ॉर्म की ऑर्डर बुक है।',
    es: 'Las cotizaciones no son vinculantes y cambian con la ejecución. No es una garantía de ejecución ni el libro de órdenes del mercado.',
    fr: "Les cotations ne sont pas contraignantes et changent à l'exécution. Ce n'est pas une exécution promise, ni le carnet d'ordres de la plateforme.",
    ru: 'Котировки не обязывают и меняются при исполнении. Это не обещание исполнения и не стакан заявок площадки.',
    tr: 'Teklifler bağlayıcı değildir ve işlem sırasında değişir. Bu bir işlem garantisi veya borsanın emir defteri değildir.',
    ur: 'کوٹیشنز پابند نہیں ہیں اور عمل درآمد کے ساتھ بدلتی ہیں۔ یہ کسی تکمیل کا وعدہ نہیں اور نہ ہی پلیٹ فارم کی آرڈر بک ہے۔',
    id: 'Kutipan tidak mengikat dan berubah saat eksekusi. Ini bukan jaminan eksekusi dan bukan buku pesanan bursa.',
    pt: 'As cotações não são vinculantes e mudam na execução. Não é uma execução prometida nem o livro de ofertas da plataforma.'
  }
};
