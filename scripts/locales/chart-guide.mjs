/**
 * LOCALE STRINGS FOR THE CHART GUIDE + THE ADVANCED DOORWAY + THE PERCENT FIELD
 * ═══════════════════════════════════════════════════════════════════════════
 * Two hand-maintained locales carry these keys: `en.json` (the source) and
 * `fa.json` (the product's primary language). The nine generated locales pick
 * the strings up from THIS module, which `scripts/gen-locales.mjs` folds into
 * `SOURCES`; they then fall back to English for anything missing.
 *
 * ─── WHY A SEPARATE MODULE AND NOT `common.mjs` ────────────────────────────
 * `common.mjs` is navigation and shared chrome — it is loaded for the whole
 * shell. These strings exist only behind `/lab/chart-guide` and the Advanced
 * tab, and keeping them in their own file means the next person editing a
 * chapter's prose does not scroll past two thousand unrelated entries.
 *
 * ─── HOW TO EDIT ───────────────────────────────────────────────────────────
 *   1. add/change the key in `en.json` AND `fa.json` (same path);
 *   2. add the nine translations in `STRINGS` below;
 *   3. run `node scripts/gen-locales.mjs` — it validates that every key here
 *      exists in en.json (an orphan is a typo, and it exits non-zero), that
 *      `{{placeholders}}` survive, and it rewrites `coverage.json`.
 *
 * The script refuses to run if a key here is missing from en.json, which is
 * what stops this file from becoming a graveyard of strings that never render.
 */

/** dotted key → { zh, hi, es, fr, ru, tr, ur, id, pt } */
export const CHART_GUIDE = {
  /* ── the screen itself ───────────────────────────────────────────────── */
  'lab2.screens.chartGuide.title': {
    zh: 'K线图指南', hi: 'चार्ट गाइड', es: 'Guía del gráfico', fr: 'Guide du graphique',
    ru: 'Гайд по графику', tr: 'Grafik rehberi', ur: 'چارٹ گائیڈ', id: 'Panduan grafik',
    pt: 'Guia do gráfico'
  },
  'lab2.screens.chartGuide.sub': {
    zh: '读懂代币页面上的K线：窗口、轴、价格和工具栏上的每个按钮。',
    hi: 'टोकन पेज के कैंडल चार्ट को पढ़ना सीखें: विंडो, अक्ष, मूल्य और टूलबार का हर बटन।',
    es: 'Aprende a leer las velas de la página del token: ventana, ejes, precio y cada botón de la barra.',
    fr: 'Apprenez à lire les chandeliers de la page du jeton : fenêtre, axes, prix et chaque bouton de la barre.',
    ru: 'Научитесь читать свечи на странице токена: окно, оси, цену и каждую кнопку панели.',
    tr: 'Token sayfasındaki mum grafiğini okumayı öğrenin: pencere, eksenler, fiyat ve araç çubuğundaki her düğme.',
    ur: 'ٹوکن صفحے کے کینڈل چارٹ کو پڑھنا سیکھیں: ونڈو، محور، قیمت اور ٹول بار کا ہر بٹن۔',
    id: 'Pelajari cara membaca candlestick di halaman token: jendela, sumbu, harga, dan setiap tombol di bilah alat.',
    pt: 'Aprenda a ler os candles na página do token: janela, eixos, preço e cada botão da barra.'
  },
  'lab2.chartGuide.sampleData': {
    zh: '下方数据是练习序列，不是实时价格。用于学习，不是行情。',
    hi: 'नीचे दिया गया डेटा अभ्यास सीरीज़ है, लाइव मूल्य नहीं। सीखने के लिए, बाज़ार नहीं।',
    es: 'Los datos de abajo son una serie de práctica, no el precio en vivo. Para aprender, no es el mercado.',
    fr: 'Les données ci-dessous sont une série d’entraînement, pas le prix en direct. Pour apprendre, pas pour le marché.',
    ru: 'Данные ниже — тренировочный ряд, а не живая цена. Для обучения, а не для рынка.',
    tr: 'Aşağıdaki veriler bir alıştırma serisidir, canlı fiyat değildir. Öğrenmek için, piyasa için değil.',
    ur: 'نیچے دیا گیا ڈیٹا ایک مشقی سیریز ہے، لائیو قیمت نہیں۔ سیکھنے کے لیے، مارکیٹ کے لیے نہیں۔',
    id: 'Data di bawah adalah seri latihan, bukan harga langsung. Untuk belajar, bukan untuk pasar.',
    pt: 'Os dados abaixo são uma série de prática, não o preço ao vivo. Para aprender, não é o mercado.'
  },
  'lab2.chartGuide.chaptersLabel': {
    zh: '章节', hi: 'अध्याय', es: 'Capítulos', fr: 'Chapitres', ru: 'Главы',
    tr: 'Bölümler', ur: 'ابواب', id: 'Bab', pt: 'Capítulos'
  },
  'lab2.chartGuide.noteTitle': {
    zh: '请记住', hi: 'ध्यान में रखें', es: 'Ten en cuenta', fr: 'À retenir',
    ru: 'Важно', tr: 'Unutmayın', ur: 'یاد رکھیں', id: 'Ingat', pt: 'Lembre-se'
  },
  'lab2.chartGuide.note': {
    zh: '本指南只讲解如何阅读，不给出交易建议、目标价或“好的入场点”。',
    hi: 'यह मार्गदर्शिका केवल पढ़ना सिखाती है — कोई ट्रेड सुझाव, लक्ष्य मूल्य या “अच्छा प्रवेश” नहीं।',
    es: 'Esta guía solo enseña a leer: no da sugerencias de operación, objetivos de precio ni un «buen punto de entrada».',
    fr: 'Ce guide apprend seulement à lire : aucun conseil de trade, aucun objectif de prix, aucun « bon point d’entrée ».',
    ru: 'Этот гайд учит только читать: он не даёт торговых советов, целей по цене и «хороших точек входа».',
    tr: 'Bu rehber yalnızca okumayı öğretir: işlem önerisi, fiyat hedefi veya “iyi giriş” vermez.',
    ur: 'یہ گائیڈ صرف پڑھنا سکھاتی ہے — کوئی تجارتی مشورہ، ہدف قیمت یا ”اچھا اندراج“ نہیں۔',
    id: 'Panduan ini hanya mengajarkan cara membaca: tidak ada saran perdagangan, target harga, atau “titik masuk yang bagus”.',
    pt: 'Este guia ensina apenas a ler: não dá dicas de operação, alvos de preço nem um “bom ponto de entrada”.'
  },
  'lab2.chartGuide.backToLab': {
    zh: '返回实验室', hi: 'लैब पर वापस', es: 'Volver al Lab', fr: 'Retour au Lab',
    ru: 'Назад в Lab', tr: 'Lab’a dön', ur: 'لیب پر واپس', id: 'Kembali ke Lab', pt: 'Voltar ao Lab'
  },

  /* ── tabs ────────────────────────────────────────────────────────────── */
  'lab2.chartGuide.tabs.basics': {
    zh: '基础', hi: 'मूल बातें', es: 'Básico', fr: 'Bases', ru: 'Основы',
    tr: 'Temel', ur: 'بنیادی', id: 'Dasar', pt: 'Básico'
  },
  'lab2.chartGuide.tabs.studies': {
    zh: '指标', hi: 'संकेतक', es: 'Indicadores', fr: 'Indicateurs', ru: 'Индикаторы',
    tr: 'Göstergeler', ur: 'اشاریے', id: 'Indikator', pt: 'Indicadores'
  },
  'lab2.chartGuide.tabs.levels': {
    zh: '价位', hi: 'स्तर', es: 'Niveles', fr: 'Niveaux', ru: 'Уровни',
    tr: 'Seviyeler', ur: 'سطحیں', id: 'Level', pt: 'Níveis'
  },
  'lab2.chartGuide.tabs.extras': {
    zh: '更多', hi: 'अधिक', es: 'Más', fr: 'Plus', ru: 'Ещё',
    tr: 'Daha fazla', ur: 'مزید', id: 'Lainnya', pt: 'Mais'
  },

  /* ── the demo panel ──────────────────────────────────────────────────── */
  'lab2.chartGuide.demo.title': {
    zh: '亲自动手', hi: 'खुद आज़माएँ', es: 'Pruébalo tú', fr: 'Essayez vous-même',
    ru: 'Попробуйте сами', tr: 'Kendiniz deneyin', ur: 'خود آزمائیں', id: 'Coba sendiri', pt: 'Experimente'
  },
  'lab2.chartGuide.demo.legendHint': {
    zh: '触摸或悬停图表，查看每根K线的精确数值',
    hi: 'सटीक मान देखने के लिए चार्ट को छुएँ या उस पर रुकें',
    es: 'Toca o pasa el cursor por el gráfico para ver los valores exactos',
    fr: 'Touchez ou survolez le graphique pour lire les valeurs exactes',
    ru: 'Коснитесь графика или наведите курсор, чтобы увидеть точные значения',
    tr: 'Kesin değerler için grafiğe dokunun veya imleci getirin',
    ur: 'درست اقدار کے لیے چارٹ کو چھوئیں یا اس پر کرسر رکھیں',
    id: 'Sentuh atau arahkan kursor ke grafik untuk melihat nilai persisnya',
    pt: 'Toque ou passe o cursor no gráfico para ver os valores exatos'
  },
  'lab2.chartGuide.demo.type': {
    zh: '图表类型', hi: 'चार्ट प्रकार', es: 'Tipo de gráfico', fr: 'Type de graphique',
    ru: 'Тип графика', tr: 'Grafik türü', ur: 'چارٹ کی قسم', id: 'Jenis grafik', pt: 'Tipo de gráfico'
  },
  'lab2.chartGuide.demo.types.candles': {
    zh: 'K线', hi: 'कैंडल', es: 'Velas', fr: 'Chandeliers', ru: 'Свечи',
    tr: 'Mum', ur: 'کینڈل', id: 'Candle', pt: 'Candles'
  },
  'lab2.chartGuide.demo.types.line': {
    zh: '折线', hi: 'रेखा', es: 'Línea', fr: 'Ligne', ru: 'Линия',
    tr: 'Çizgi', ur: 'لکیر', id: 'Garis', pt: 'Linha'
  },
  'lab2.chartGuide.demo.types.area': {
    zh: '面积', hi: 'क्षेत्र', es: 'Área', fr: 'Aire', ru: 'Область',
    tr: 'Alan', ur: 'رقبہ', id: 'Area', pt: 'Área'
  },
  'lab2.chartGuide.demo.toggles': {
    zh: '叠加层', hi: 'ओवरले', es: 'Superposiciones', fr: 'Superpositions',
    ru: 'Наложения', tr: 'Katmanlar', ur: 'اوورلے', id: 'Lapisan', pt: 'Sobreposições'
  },
  'lab2.chartGuide.demo.togglesMap.ma7': {
    zh: 'MA7', hi: 'MA7', es: 'MA7', fr: 'MA7', ru: 'MA7', tr: 'MA7', ur: 'MA7', id: 'MA7', pt: 'MA7'
  },
  'lab2.chartGuide.demo.togglesMap.ma25': {
    zh: 'MA25', hi: 'MA25', es: 'MA25', fr: 'MA25', ru: 'MA25', tr: 'MA25', ur: 'MA25', id: 'MA25', pt: 'MA25'
  },
  'lab2.chartGuide.demo.togglesMap.ema21': {
    zh: 'EMA21', hi: 'EMA21', es: 'EMA21', fr: 'EMA21', ru: 'EMA21', tr: 'EMA21', ur: 'EMA21', id: 'EMA21', pt: 'EMA21'
  },
  'lab2.chartGuide.demo.togglesMap.bb': {
    zh: '布林带', hi: 'बोलिंजर', es: 'Bollinger', fr: 'Bollinger', ru: 'Боллинджер',
    tr: 'Bollinger', ur: 'بولنگر', id: 'Bollinger', pt: 'Bollinger'
  },
  'lab2.chartGuide.demo.togglesMap.volume': {
    zh: '成交量', hi: 'वॉल्यूम', es: 'Volumen', fr: 'Volume', ru: 'Объём',
    tr: 'Hacim', ur: 'حجم', id: 'Volume', pt: 'Volume'
  },
  'lab2.chartGuide.demo.togglesMap.rsi': {
    zh: 'RSI', hi: 'RSI', es: 'RSI', fr: 'RSI', ru: 'RSI', tr: 'RSI', ur: 'RSI', id: 'RSI', pt: 'RSI'
  },
  'lab2.chartGuide.demo.togglesMap.fib': {
    zh: '斐波那契', hi: 'फिबोनाची', es: 'Fibonacci', fr: 'Fibonacci', ru: 'Фибоначчи',
    tr: 'Fibonacci', ur: 'فیبوناچی', id: 'Fibonacci', pt: 'Fibonacci'
  },
  'lab2.chartGuide.demo.view': {
    zh: '视图', hi: 'दृश्य', es: 'Vista', fr: 'Vue', ru: 'Вид',
    tr: 'Görünüm', ur: 'منظر', id: 'Tampilan', pt: 'Visualização'
  },
  'lab2.chartGuide.demo.zoomIn': {
    zh: '放大', hi: 'ज़ूम इन', es: 'Acercar', fr: 'Zoomer', ru: 'Приблизить',
    tr: 'Yakınlaştır', ur: 'زوم اِن', id: 'Perbesar', pt: 'Aproximar'
  },
  'lab2.chartGuide.demo.fit': {
    zh: '适合', hi: 'फ़िट', es: 'Ajustar', fr: 'Ajuster', ru: 'Вписать',
    tr: 'Sığdır', ur: 'فٹ', id: 'Paskan', pt: 'Ajustar'
  },
  'lab2.chartGuide.demo.log': {
    zh: '对数轴', hi: 'लॉग स्केल', es: 'Escala log', fr: 'Échelle log', ru: 'Лог. шкала',
    tr: 'Log ölçek', ur: 'لاگ اسکیل', id: 'Skala log', pt: 'Escala log'
  },
  'lab2.chartGuide.demo.loadingNote': {
    zh: '图表引擎正在加载；如果不可用，会显示简报图。',
    hi: 'चार्ट इंजन लोड हो रहा है; उपलब्ध न हो तो सरल चार्ट दिखेगा।',
    es: 'El motor del gráfico está cargando; si no está disponible, se muestra el gráfico simple.',
    fr: 'Le moteur du graphique se charge ; s’il est indisponible, un graphique simplifié s’affiche.',
    ru: 'Движок графика загружается; если он недоступен, показывается упрощённый график.',
    tr: 'Grafik motoru yükleniyor; kullanılamıyorsa basit grafik gösterilir.',
    ur: 'چارٹ انجن لوڈ ہو رہا ہے؛ دستیاب نہ ہو تو سادہ چارٹ دکھایا جاتا ہے۔',
    id: 'Mesin grafik sedang dimuat; jika tidak tersedia, grafik sederhana ditampilkan.',
    pt: 'O motor do gráfico está carregando; se não estiver disponível, o gráfico simples é exibido.'
  },

  /* ── chapters · read ─────────────────────────────────────────────────── */
  'lab2.chartGuide.chapters.read.title': {
    zh: '读懂一根K线', hi: 'एक कैंडल पढ़ें', es: 'Leer una vela', fr: 'Lire un chandelier',
    ru: 'Читаем свечу', tr: 'Bir mumu okumak', ur: 'ایک کینڈل پڑھیں', id: 'Membaca satu candle', pt: 'Ler um candle'
  },
  'lab2.chartGuide.chapters.read.steps.open.title': {
    zh: '打开图表', hi: 'चार्ट खोलें', es: 'Abre el gráfico', fr: 'Ouvrir le graphique',
    ru: 'Открыть график', tr: 'Grafiği aç', ur: 'چارٹ کھولیں', id: 'Buka grafik', pt: 'Abra o gráfico'
  },
  'lab2.chartGuide.chapters.read.steps.open.body': {
    zh: '在代币页面，价格下方的卡片就是图表。展开按钮（⇱）会打开全屏终端，工具栏在那里最完整。',
    hi: 'टोकन पेज पर कीमत के नीचे वाला कार्ड चार्ट है। विस्तार बटन (⇱) फ़ुल-स्क्रीन टर्मिनल खोलता है, जहाँ टूलबार पूरा दिखता है।',
    es: 'En la página del token, la tarjeta bajo el precio es el gráfico. El botón de expandir (⇱) abre el terminal a pantalla completa, donde la barra está completa.',
    fr: 'Sur la page du jeton, la carte sous le prix est le graphique. Le bouton d’agrandissement (⇱) ouvre le terminal plein écran, où la barre est complète.',
    ru: 'На странице токена карточка под ценой — это график. Кнопка разворота (⇱) открывает полноэкранный терминал, где панель полная.',
    tr: 'Token sayfasında fiyatın altındaki kart grafiktir. Genişlet düğmesi (⇱) tam ekran terminali açar; araç çubuğu orada tamdır.',
    ur: 'ٹوکن صفحے پر قیمت کے نیچے والا کارڈ چارٹ ہے۔ بڑا کرنے کا بٹن (⇱) فل اسکرین ٹرمینل کھولتا ہے جہاں ٹول بار مکمل ہوتی ہے۔',
    id: 'Di halaman token, kartu di bawah harga adalah grafiknya. Tombol perluas (⇱) membuka terminal layar penuh, tempat bilah alat paling lengkap.',
    pt: 'Na página do token, o cartão abaixo do preço é o gráfico. O botão de expandir (⇱) abre o terminal em tela cheia, onde a barra é completa.'
  },
  'lab2.chartGuide.chapters.read.steps.open.where': {
    zh: '代币页面 → 价格卡片 → 展开图标',
    hi: 'टोकन पेज → मूल्य कार्ड → विस्तार आइकन',
    es: 'Página del token → tarjeta de precio → icono de expandir',
    fr: 'Page du jeton → carte du prix → icône d’agrandissement',
    ru: 'Страница токена → карточка цены → значок разворота',
    tr: 'Token sayfası → fiyat kartı → genişlet simgesi',
    ur: 'ٹوکن صفحہ → قیمت کارڈ → بڑا کرنے کا آئیکن',
    id: 'Halaman token → kartu harga → ikon perluas',
    pt: 'Página do token → cartão de preço → ícone de expandir'
  },
  'lab2.chartGuide.chapters.read.steps.bar.title': {
    zh: '实体与影线', hi: 'बॉडी और विक', es: 'Cuerpo y mecha', fr: 'Corps et mèche',
    ru: 'Тело и тень', tr: 'Gövde ve fitil', ur: 'باڈی اور وِک', id: 'Badan dan ekor', pt: 'Corpo e pavio'
  },
  'lab2.chartGuide.chapters.read.steps.bar.body': {
    zh: '每根K线的实体从开盘到收盘；上影线是区间内最高价，下影线是最低价。实体上涨通常为绿色，下跌为红色。',
    hi: 'हर कैंडल का बॉडी खुलने से बंद तक होता है; ऊपर की विक अवधि का उच्चतम और नीचे की विक न्यूनतम मूल्य है। बढ़ता बॉडी आमतौर पर हरा, गिरता लाल।',
    es: 'El cuerpo de cada vela va de apertura a cierre; la mecha superior es el máximo del intervalo y la inferior el mínimo. Un cuerpo que sube suele ser verde y uno que baja, rojo.',
    fr: 'Le corps d’un chandelier va de l’ouverture à la clôture ; la mèche haute est le plus haut de l’intervalle et la basse le plus bas. Un corps qui monte est généralement vert, un corps qui descend, rouge.',
    ru: 'Тело свечи — от открытия до закрытия; верхняя тень — максимум интервала, нижняя — минимум. Растущее тело обычно зелёное, падающее — красное.',
    tr: 'Mumun gövdesi açılıştan kapanışa uzanır; üst fitil aralığın en yükseği, alt fitil en düşüğüdür. Yükselen gövde genelde yeşil, düşen kırmızıdır.',
    ur: 'ہر کینڈل کی باڈی اوپن سے کلوز تک ہوتی ہے؛ اوپر کی وِک دورانیے کی بلند ترین اور نیچے کی کم ترین قیمت ہے۔ بڑھتی باڈی عام طور پر سبز، گرتی سرخ۔',
    id: 'Badan candle membentang dari pembukaan ke penutupan; ekor atas adalah harga tertinggi dalam periode dan ekor bawah terendah. Badan naik biasanya hijau, turun merah.',
    pt: 'O corpo do candle vai da abertura ao fechamento; o pavio superior é a máxima do intervalo e o inferior, a mínima. Corpo em alta costuma ser verde, em queda, vermelho.'
  },
  'lab2.chartGuide.chapters.read.steps.bar.where': {
    zh: '图表正中央的K线本身',
    hi: 'चार्ट के बीच के कैंडल स्वयं',
    es: 'Los propios candados en el centro del gráfico',
    fr: 'Les chandeliers eux-mêmes, au centre du graphique',
    ru: 'Сами свечи в центре графика',
    tr: 'Grafiğin ortasındaki mumların kendisi',
    ur: 'چارٹ کے بیچ میں موجود کینڈل خود',
    id: 'Candle itu sendiri di tengah grafik',
    pt: 'Os próprios candles no centro do gráfico'
  },
  'lab2.chartGuide.chapters.read.steps.colors.title': {
    zh: '颜色与方向', hi: 'रंग और दिशा', es: 'Color y dirección', fr: 'Couleur et direction',
    ru: 'Цвет и направление', tr: 'Renk ve yön', ur: 'رنگ اور سمت', id: 'Warna dan arah', pt: 'Cor e direção'
  },
  'lab2.chartGuide.chapters.read.steps.colors.body': {
    zh: '绿色表示该区间收盘高于开盘，红色相反。颜色只是比较，不表示好坏——红色也可能只是回撤。',
    hi: 'हरा मतलब उस अवधि में बंद खुलने से ऊपर, लाल इसका उलटा। रंग केवल तुलना है, अच्छा-बुरा नहीं — लाल केवल सुधार भी हो सकता है।',
    es: 'Verde significa que el cierre quedó por encima de la apertura en ese intervalo; rojo, lo contrario. El color es comparación, no juicio: rojo también puede ser solo un retroceso.',
    fr: 'Vert signifie que la clôture dépasse l’ouverture sur l’intervalle ; rouge, l’inverse. La couleur compare, elle ne juge pas : du rouge peut n’être qu’un repli.',
    ru: 'Зелёный — закрытие выше открытия на интервале, красный — наоборот. Цвет сравнивает, а не судит: красное может быть просто откатом.',
    tr: 'Yeşil, o aralıkta kapanışın açılışın üstünde olduğunu gösterir; kırmızı tersini. Renk karşılaştırmadır, yargı değil: kırmızı yalnızca geri çekilme de olabilir.',
    ur: 'سبز کا مطلب ہے کہ اس دورانیے میں کلوز اوپن سے اوپر، سرخ اس کے برعکس۔ رنگ صرف موازنہ ہے، اچھا یا برا نہیں — سرخ محض کمی بھی ہو سکتی ہے۔',
    id: 'Hijau berarti penutupan di atas pembukaan pada periode itu; merah sebaliknya. Warna adalah perbandingan, bukan penilaian — merah juga bisa sekadar koreksi.',
    pt: 'Verde significa fechamento acima da abertura no intervalo; vermelho, o contrário. Cor é comparação, não julgamento: vermelho também pode ser só um recuo.'
  },
  'lab2.chartGuide.chapters.read.steps.colors.where': {
    zh: 'K线颜色（跟随应用主题）',
    hi: 'कैंडल के रंग (ऐप थीम के अनुसार)',
    es: 'Color de las velas (sigue el tema de la app)',
    fr: 'Couleur des chandeliers (suit le thème de l’app)',
    ru: 'Цвет свечей (следует теме приложения)',
    tr: 'Mum rengi (uygulama temasına göre)',
    ur: 'کینڈل کا رنگ (ایپ تھیم کے مطابق)',
    id: 'Warna candle (mengikuti tema aplikasi)',
    pt: 'Cor dos candles (segue o tema do app)'
  },
  'lab2.chartGuide.chapters.read.steps.legend.title': {
    zh: '十字光标读数', hi: 'क्रॉसहेयर रीडआउट', es: 'Lectura del cursor', fr: 'Lecture du curseur',
    ru: 'Показания перекрестия', tr: 'Artı imleç okuması', ur: 'کراس ہیئر ریڈ آؤٹ', id: 'Pembacaan crosshair', pt: 'Leitura do cursor'
  },
  'lab2.chartGuide.chapters.read.steps.legend.body': {
    zh: '当手指或光标在图表上时，左上角的条会显示 o/h/l/c 和成交量。这正是本页练习区里演示的那一条。',
    hi: 'जब उँगली या कर्सर चार्ट पर हो, ऊपर की पट्टी o/h/l/c और वॉल्यूम दिखाती है। यह ठीक वही पट्टी है जो इस पेज पर अभ्यास क्षेत्र में दिखती है।',
    es: 'Con el dedo o el cursor sobre el gráfico, la franja superior muestra o/h/l/c y el volumen. Es la misma franja que se ve en la zona de práctica de esta página.',
    fr: 'Avec le doigt ou le curseur sur le graphique, la bande du haut affiche o/h/l/c et le volume. C’est la même bande que dans la zone d’essai de cette page.',
    ru: 'Когда палец или курсор на графике, верхняя полоса показывает o/h/l/c и объём. Это та же полоса, что в зоне практики на этой странице.',
    tr: 'Parmak veya imleç grafikteyken üst şerit o/h/l/c ve hacmi gösterir. Bu sayfadaki alıştırma alanında gördüğünüz şeridin aynısıdır.',
    ur: 'جب انگلی یا کرسر چارٹ پر ہو تو اوپر کی پٹی o/h/l/c اور حجم دکھاتی ہے۔ یہ وہی پٹی ہے جو اس صفحے کے مشق کے خانے میں نظر آتی ہے۔',
    id: 'Saat jari atau kursor di atas grafik, bilah atas menampilkan o/h/l/c dan volume. Itu bilah yang sama dengan area latihan di halaman ini.',
    pt: 'Com o dedo ou o cursor sobre o gráfico, a faixa superior mostra o/h/l/c e o volume. É a mesma faixa que aparece na área de prática desta página.'
  },
  'lab2.chartGuide.chapters.read.steps.legend.where': {
    zh: '图表左上角的读数条',
    hi: 'चार्ट के ऊपर-बाएँ रीडआउट पट्टी',
    es: 'La franja de lectura en la esquina superior del gráfico',
    fr: 'La bande de lecture en haut du graphique',
    ru: 'Полоса показаний в верхней части графика',
    tr: 'Grafiğin üstündeki okuma şeridi',
    ur: 'چارٹ کے اوپر والی ریڈ آؤٹ پٹی',
    id: 'Bilah pembacaan di bagian atas grafik',
    pt: 'A faixa de leitura no topo do gráfico'
  },

  /* ── chapters · range ────────────────────────────────────────────────── */
  'lab2.chartGuide.chapters.range.title': {
    zh: '时间窗口', hi: 'समय विंडो', es: 'Ventana de tiempo', fr: 'Fenêtre de temps',
    ru: 'Временное окно', tr: 'Zaman penceresi', ur: 'وقت کی ونڈو', id: 'Jendela waktu', pt: 'Janela de tempo'
  },
  'lab2.chartGuide.chapters.range.steps.ranges.title': {
    zh: '五个范围按钮', hi: 'पाँच रेंज बटन', es: 'Los cinco botones de rango', fr: 'Les cinq boutons de plage',
    ru: 'Пять кнопок диапазона', tr: 'Beş aralık düğmesi', ur: 'پانچ رینج بٹن', id: 'Lima tombol rentang', pt: 'Os cinco botões de intervalo'
  },
  'lab2.chartGuide.chapters.range.steps.ranges.body': {
    zh: '1D · 7D · 30D · 90D · 1Y。每个按钮设置图表所覆盖的总时间；每根K线代表多久取决于此。',
    hi: '1D · 7D · 30D · 90D · 1Y। हर बटन तय करता है कि चार्ट कुल कितना समय दिखाए; एक कैंडल कितनी अवधि की होगी यह इसी पर निर्भर है।',
    es: '1D · 7D · 30D · 90D · 1Y. Cada botón fija cuánto tiempo cubre el gráfico; de ahí sale cuánto dura cada vela.',
    fr: '1D · 7D · 30D · 90D · 1Y. Chaque bouton définit la durée couverte ; la durée d’un chandelier en découle.',
    ru: '1D · 7D · 30D · 90D · 1Y. Каждая кнопка задаёт охватываемое время, а от него зависит длительность одной свечи.',
    tr: '1D · 7D · 30D · 90D · 1Y. Her düğme grafiğin kapsadığı süreyi belirler; bir mumun süresi buna bağlıdır.',
    ur: '1D · 7D · 30D · 90D · 1Y۔ ہر بٹن طے کرتا ہے کہ چارٹ کتنا وقت دکھائے؛ ایک کینڈل کتنی دیر کی ہوگی اسی پر منحصر ہے۔',
    id: '1D · 7D · 30D · 90D · 1Y. Setiap tombol menentukan berapa lama grafik mencakup; dari situ durasi satu candle ditentukan.',
    pt: '1D · 7D · 30D · 90D · 1Y. Cada botão define quanto tempo o gráfico cobre; daí vem a duração de cada candle.'
  },
  'lab2.chartGuide.chapters.range.steps.ranges.where': {
    zh: '图表上方的一行按钮',
    hi: 'चार्ट के ऊपर बटनों की पंक्ति', es: 'La fila de botones sobre el gráfico', fr: 'La rangée de boutons au-dessus du graphique',
    ru: 'Ряд кнопок над графиком', tr: 'Grafiğin üstündeki düğme sırası', ur: 'چارٹ کے اوپر بٹنوں کی قطار',
    id: 'Baris tombol di atas grafik', pt: 'A linha de botões acima do gráfico'
  },
  'lab2.chartGuide.chapters.range.steps.whatChanges.title': {
    zh: '切换时什么会变', hi: 'बदलने पर क्या बदलता है', es: 'Qué cambia al cambiar', fr: 'Ce qui change',
    ru: 'Что меняется', tr: 'Ne değişir', ur: 'کیا بدلتا ہے', id: 'Apa yang berubah', pt: 'O que muda'
  },
  'lab2.chartGuide.chapters.range.steps.whatChanges.body': {
    zh: '窗口变了，K线的数量与每根的时长都变。同一个最高价在不同窗口里看起来不一样——比较前先对齐窗口。',
    hi: 'विंडो बदलने पर कैंडल की संख्या और हर कैंडल की अवधि बदलती है। एक ही उच्चतम मूल्य दो अलग विंडो में अलग दिखता है — तुलना से पहले विंडो एक रखें।',
    es: 'Al cambiar la ventana cambian el número de velas y la duración de cada una. El mismo máximo se ve distinto en ventanas distintas: compara siempre con la misma ventana.',
    fr: 'Changer de fenêtre change le nombre de chandeliers et leur durée. Un même plus haut ne se lit pas pareil dans deux fenêtres : comparez à fenêtre égale.',
    ru: 'При смене окна меняются число свечей и их длительность. Один и тот же максимум выглядит иначе в разных окнах — сравнивайте в одном.',
    tr: 'Pencere değişince mum sayısı ve her mumun süresi değişir. Aynı zirve farklı pencerelerde farklı görünür — aynı pencereyle karşılaştırın.',
    ur: 'ونڈو بدلنے سے کینڈل کی تعداد اور ہر کینڈل کی مدت بدلتی ہے۔ ایک ہی بلند ترین قیمت مختلف ونڈوز میں مختلف دکھتی ہے — موازنہ اسی ونڈو میں کریں۔',
    id: 'Mengubah jendela mengubah jumlah candle dan durasi masing-masing. Harga tertinggi yang sama terlihat berbeda di jendela berbeda — bandingkan dalam jendela yang sama.',
    pt: 'Mudar a janela muda o número de candles e a duração de cada um. A mesma máxima parece diferente em janelas diferentes: compare na mesma janela.'
  },
  'lab2.chartGuide.chapters.range.steps.whatChanges.where': {
    zh: '在练习区下方切换类型/范围，观看它变化',
    hi: 'नीचे अभ्यास क्षेत्र में प्रकार/रेंज बदलकर देखें',
    es: 'Cambia tipo/rango en la zona de práctica y míralo',
    fr: 'Changez de type/plage dans la zone d’essai pour le voir',
    ru: 'Переключите тип/диапазон в зоне практики и посмотрите',
    tr: 'Alıştırma alanında tür/aralık değiştirip görün',
    ur: 'مشق کے خانے میں قسم/رینج بدل کر دیکھیں',
    id: 'Ubah jenis/rentang di area latihan dan lihat',
    pt: 'Troque tipo/intervalo na área de prática e veja'
  },
  'lab2.chartGuide.chapters.range.steps.reset.title': {
    zh: '重置缩放', hi: 'ज़ूम रीसेट', es: 'Restablecer el zoom', fr: 'Réinitialiser le zoom',
    ru: 'Сброс масштаба', tr: 'Yakınlaştırmayı sıfırla', ur: 'زوم ری سیٹ', id: 'Atur ulang zoom', pt: 'Redefinir o zoom'
  },
  'lab2.chartGuide.chapters.range.steps.reset.body': {
    zh: '范围按钮也会重置平移与缩放，所以图表回到该窗口的完整视图。这就是“我看不到全部”最常见的原因。',
    hi: 'रेंज बटन पैन और ज़ूम भी रीसेट करता है, इसलिए चार्ट उस विंडो का पूरा दृश्य दिखाता है। “मुझे सब नहीं दिख रहा” की सबसे आम वजह यही है।',
    es: 'Los botones de rango también reinician el desplazamiento y el zoom, así que el gráfico vuelve a mostrar la ventana completa. Es la causa más habitual de “no veo todo”.',
    fr: 'Les boutons de plage réinitialisent aussi le déplacement et le zoom : le graphique revient à la fenêtre entière. C’est la cause la plus fréquente du « je ne vois pas tout ».',
    ru: 'Кнопки диапазона сбрасывают и сдвиг, и масштаб, поэтому график снова показывает всё окно. Это самая частая причина «я не вижу всё».',
    tr: 'Aralık düğmeleri kaydırmayı ve yakınlaştırmayı da sıfırlar; grafik pencerenin tamamını gösterir. “Her şeyi göremiyorum”un en sık nedeni budur.',
    ur: 'رینج بٹن پین اور زوم بھی ری سیٹ کرتے ہیں، اس لیے چارٹ پوری ونڈو دکھاتا ہے۔ ”مجھے سب نظر نہیں آتا“ کی سب سے عام وجہ یہی ہے۔',
    id: 'Tombol rentang juga mengatur ulang geser dan zoom, jadi grafik menampilkan seluruh jendela. Ini penyebab paling umum dari “saya tidak melihat semuanya”.',
    pt: 'Os botões de intervalo também redefinem o deslocamento e o zoom, então o gráfico volta à janela inteira. É a causa mais comum do “não estou vendo tudo”.'
  },
  'lab2.chartGuide.chapters.range.steps.reset.where': {
    zh: '同一个范围按钮行',
    hi: 'वही रेंज बटन पंक्ति', es: 'La misma fila de rango', fr: 'La même rangée de plage',
    ru: 'Тот же ряд кнопок', tr: 'Aynı aralık satırı', ur: 'وہی رینج قطار',
    id: 'Baris rentang yang sama', pt: 'A mesma linha de intervalo'
  },

  /* ── chapters · move ─────────────────────────────────────────────────── */
  'lab2.chartGuide.chapters.move.title': {
    zh: '移动与缩放', hi: 'खिसकाएँ और ज़ूम करें', es: 'Desplazar y hacer zoom', fr: 'Déplacer et zoomer',
    ru: 'Сдвиг и масштаб', tr: 'Kaydırma ve yakınlaştırma', ur: 'سرکائیں اور زوم کریں', id: 'Geser dan zoom', pt: 'Mover e ampliar'
  },
  'lab2.chartGuide.chapters.move.steps.drag.title': {
    zh: '拖动平移', hi: 'खींचकर खिसकाएँ', es: 'Arrastra para desplazar', fr: 'Faites glisser pour déplacer',
    ru: 'Перетаскивание', tr: 'Sürükleyerek kaydır', ur: 'کھینچ کر سرکائیں', id: 'Seret untuk menggeser', pt: 'Arraste para mover'
  },
  'lab2.chartGuide.chapters.move.steps.drag.body': {
    zh: '在图内水平拖动可平移。纵向拖动仍在滚动页面，所以不会把页面卡住。',
    hi: 'चार्ट में क्षैतिज खींचने पर वह खिसकता है। लंबवत खींचने पर पेज स्क्रॉल होता है, इसलिए पेज फँसता नहीं।',
    es: 'Arrastrar en horizontal dentro del gráfico lo desplaza. Arrastrar en vertical sigue desplazando la página, así que no se queda atascada.',
    fr: 'Un glissement horizontal dans le graphique le déplace. Un glissement vertical fait défiler la page : elle ne reste pas bloquée.',
    ru: 'Горизонтальное перетаскивание сдвигает график. Вертикальное по-прежнему прокручивает страницу, так что она не залипает.',
    tr: 'Grafikte yatay sürükleme onu kaydırır. Dikey sürükleme sayfayı kaydırmaya devam eder; sayfa kilitlenmez.',
    ur: 'چارٹ میں افقی کھینچاؤ اسے سرکاتا ہے۔ عمودی کھینچاؤ صفحہ ہی اسکرول کرتا ہے، اس لیے صفحہ نہیں اٹکتا۔',
    id: 'Menyeret horizontal di dalam grafik menggeser grafik. Seret vertikal tetap menggulir halaman, jadi halaman tidak macet.',
    pt: 'Arrastar na horizontal dentro do gráfico o desloca. Arrastar na vertical continua rolando a página, então ela não trava.'
  },
  'lab2.chartGuide.chapters.move.steps.drag.where': {
    zh: '图表内部任意位置',
    hi: 'चार्ट के अंदर कहीं भी', es: 'En cualquier parte dentro del gráfico', fr: 'N’importe où dans le graphique',
    ru: 'В любом месте графика', tr: 'Grafiğin herhangi bir yeri', ur: 'چارٹ کے اندر کہیں بھی',
    id: 'Di mana saja di dalam grafik', pt: 'Em qualquer lugar dentro do gráfico'
  },
  'lab2.chartGuide.chapters.move.steps.pinch.title': {
    zh: '双指缩放', hi: 'दो अँगुली ज़ूम', es: 'Pellizcar para acercar', fr: 'Pincer pour zoomer',
    ru: 'Масштаб двумя пальцами', tr: 'İki parmakla yakınlaştır', ur: 'دو انگلیوں سے زوم', id: 'Cubit untuk zoom', pt: 'Pinçar para ampliar'
  },
  'lab2.chartGuide.chapters.move.steps.pinch.body': {
    zh: '在全屏终端里可用双指张开放大、捏合缩小。手机端的工具栏里还有 + / − 按钮，当手势被浏览器拦下时使用它们。',
    hi: 'फ़ुल-स्क्रीन टर्मिनल में दो अँगुली खोलकर ज़ूम इन और मिलाकर ज़ूम आउट करें। मोबाइल टूलबार में + / − भी हैं, जब ब्राउज़र जेस्चर न पकड़े तो उन्हें दबाएँ।',
    es: 'En el terminal a pantalla completa, abre los dedos para acercar y júntalos para alejar. La barra móvil también tiene + / −, para cuando el navegador intercepta el gesto.',
    fr: 'Dans le terminal plein écran, écartez deux doigts pour zoomer, rapprochez-les pour dézoomer. La barre mobile propose aussi + / −, quand le navigateur intercepte le geste.',
    ru: 'В полноэкранном терминале разведите два пальца, чтобы приблизить, и сведите, чтобы отдалить. В мобильной панели есть + / − на случай, если жест перехватит браузер.',
    tr: 'Tam ekran terminalde iki parmağı açarak yakınlaştırın, birleştirerek uzaklaştırın. Mobil araç çubuğunda + / − de var; tarayıcı jesti kaptığında onları kullanın.',
    ur: 'فل اسکرین ٹرمینل میں دو انگلیاں کھول کر زوم اِن اور ملحق کر کے زوم آؤٹ کریں۔ موبائل ٹول بار میں + / − بھی ہیں، جب براؤزر جیسچر نہ پکڑے تو وہ دبائیں۔',
    id: 'Di terminal layar penuh, renggangkan dua jari untuk memperbesar dan rapatkan untuk memperkecil. Bilah alat seluler juga punya + / − saat browser menangkap gesturnya.',
    pt: 'No terminal em tela cheia, afaste dois dedos para aproximar e junte para afastar. A barra móvel também tem + / −, para quando o navegador captura o gesto.'
  },
  'lab2.chartGuide.chapters.move.steps.pinch.where': {
    zh: '全屏终端内的图表',
    hi: 'फ़ुल-स्क्रीन टर्मिनल का चार्ट', es: 'El gráfico dentro del terminal a pantalla completa', fr: 'Le graphique du terminal plein écran',
    ru: 'График в полноэкранном терминале', tr: 'Tam ekran terminaldeki grafik', ur: 'فل اسکرین ٹرمینل کا چارٹ',
    id: 'Grafik di terminal layar penuh', pt: 'O gráfico no terminal em tela cheia'
  },
  'lab2.chartGuide.chapters.move.steps.doubleTap.title': {
    zh: '双击放大', hi: 'दो बार टैप करें', es: 'Doble toque', fr: 'Double tap',
    ru: 'Двойное нажатие', tr: 'Çift dokunma', ur: 'ڈبل ٹیپ', id: 'Ketuk dua kali', pt: 'Toque duplo'
  },
  'lab2.chartGuide.chapters.move.steps.doubleTap.body': {
    zh: '双击会以你点的位置为中心放大；已经放大时再双击会返回完整视图。',
    hi: 'डबल-टैप उस बिंदु पर ज़ूम करता है जहाँ आपने टैप किया; जब पहले से ज़ूम है तो डबल-टैप पूरा दृश्य लौटाता है।',
    es: 'El doble toque acerca hacia el punto que tocas; si ya estás cerca, vuelve a la vista completa.',
    fr: 'Un double tap zoome vers le point touché ; si vous êtes déjà zoomé, il revient à la vue entière.',
    ru: 'Двойное нажатие приближает к точке касания; если уже приближено — возвращает весь вид.',
    tr: 'Çift dokunma dokunduğunuz noktaya yakınlaşır; zaten yakınsa tam görünüme döner.',
    ur: 'ڈبل ٹیپ اسی جگہ زوم کرتا ہے جہاں آپ نے ٹیپ کیا؛ اگر پہلے سے زوم ہے تو پورا منظر واپس کرتا ہے۔',
    id: 'Ketuk dua kali memperbesar ke titik yang Anda sentuh; jika sudah diperbesar, kembali ke tampilan penuh.',
    pt: 'O toque duplo aproxima do ponto tocado; se já estiver ampliado, volta à visão completa.'
  },
  'lab2.chartGuide.chapters.move.steps.doubleTap.where': {
    zh: '图表上的任意点',
    hi: 'चार्ट पर कोई भी बिंदु', es: 'Cualquier punto del gráfico', fr: 'N’importe quel point du graphique',
    ru: 'Любая точка графика', tr: 'Grafikte herhangi bir nokta', ur: 'چارٹ پر کوئی بھی مقام',
    id: 'Titik mana saja di grafik', pt: 'Qualquer ponto do gráfico'
  },
  'lab2.chartGuide.chapters.move.steps.fit.title': {
    zh: '回到完整视图', hi: 'पूरा दृश्य पर लौटें', es: 'Volver a la vista completa', fr: 'Revenir à la vue entière',
    ru: 'Вернуться к полному виду', tr: 'Tam görünüme dön', ur: 'پورے منظر پر واپس', id: 'Kembali ke tampilan penuh', pt: 'Voltar à visão completa'
  },
  'lab2.chartGuide.chapters.move.steps.fit.body': {
    zh: '“适合”按钮（或重置缩放）始终会把整个窗口放回屏幕——迷路时用它。',
    hi: '“फ़िट” बटन (या ज़ूम रीसेट) हमेशा पूरी विंडो लौटाता है — रास्ता भूलें तो यही दबाएँ।',
    es: 'El botón «Ajustar» (o restablecer zoom) siempre devuelve la ventana entera a la pantalla: úsalo si te pierdes.',
    fr: 'Le bouton « Ajuster » (ou la réinitialisation du zoom) ramène toujours la fenêtre entière : servez-vous-en si vous vous perdez.',
    ru: 'Кнопка «Вписать» (или сброс масштаба) всегда возвращает всё окно на экран — если потерялись, жмите её.',
    tr: '“Sığdır” düğmesi (veya yakınlaştırma sıfırlama) her zaman tüm pencereyi geri getirir — kaybolursanız onu kullanın.',
    ur: '”فٹ“ بٹن (یا زوم ری سیٹ) ہمیشہ پوری ونڈو واپس لاتا ہے — راستہ بھولیں تو یہی دبائیں۔',
    id: 'Tombol “Paskan” (atau atur ulang zoom) selalu mengembalikan seluruh jendela ke layar — gunakan bila tersesat.',
    pt: 'O botão “Ajustar” (ou redefinir zoom) sempre traz a janela inteira de volta: use se se perder.'
  },
  'lab2.chartGuide.chapters.move.steps.fit.where': {
    zh: '此页练习区的视图按钮 / 终端工具栏',
    hi: 'इस पेज के अभ्यास क्षेत्र के दृश्य बटन / टर्मिनल टूलबार',
    es: 'Botones de vista de la práctica en esta página / barra del terminal',
    fr: 'Boutons de vue de l’essai sur cette page / barre du terminal',
    ru: 'Кнопки вида в зоне практики / панель терминала',
    tr: 'Bu sayfadaki alıştırma görünüm düğmeleri / terminal araç çubuğu',
    ur: 'اس صفحے کے مشق کے منظر والے بٹن / ٹرمینل ٹول بار',
    id: 'Tombol tampilan latihan di halaman ini / bilah terminal',
    pt: 'Botões de visualização da prática nesta página / barra do terminal'
  },

  /* ── chapters · type ─────────────────────────────────────────────────── */
  'lab2.chartGuide.chapters.type.title': {
    zh: '图表类型', hi: 'चार्ट प्रकार', es: 'Tipo de gráfico', fr: 'Type de graphique',
    ru: 'Тип графика', tr: 'Grafik türü', ur: 'چارٹ کی قسم', id: 'Jenis grafik', pt: 'Tipo de gráfico'
  },
  'lab2.chartGuide.chapters.type.steps.candles.title': {
    zh: 'K线（默认）', hi: 'कैंडल (डिफ़ॉल्ट)', es: 'Velas (por defecto)', fr: 'Chandeliers (par défaut)',
    ru: 'Свечи (по умолчанию)', tr: 'Mum (varsayılan)', ur: 'کینڈل (ڈیفالٹ)', id: 'Candle (bawaan)', pt: 'Candles (padrão)'
  },
  'lab2.chartGuide.chapters.type.steps.candles.body': {
    zh: 'K线同时给出开盘、收盘、最高和最低四个值，所以一个周期里的波动也能看见。',
    hi: 'कैंडल एक साथ चार मान देता है — खुलना, बंद, उच्च, निम्न — इसलिए एक अवधि के अंदर की हलचल भी दिखती है।',
    es: 'La vela da cuatro valores a la vez —apertura, cierre, máximo y mínimo— así que también se ve qué pasó dentro del período.',
    fr: 'Le chandelier donne quatre valeurs à la fois — ouverture, clôture, plus haut, plus bas — donc l’agitation à l’intérieur de la période reste visible.',
    ru: 'Свеча даёт четыре значения сразу — открытие, закрытие, максимум, минимум, — поэтому видно, что было внутри периода.',
    tr: 'Mum aynı anda dört değer verir — açılış, kapanış, yüksek, düşük — böylece dönem içindeki hareket de görünür.',
    ur: 'کینڈل ایک ساتھ چار اقدار دیتا ہے — اوپن، کلوز، بلند، کم — اس لیے دورانیے کے اندر کی ہلچل بھی نظر آتی ہے۔',
    id: 'Candle memberi empat nilai sekaligus — pembukaan, penutupan, tertinggi, terendah — sehingga gejolak di dalam periode tetap terlihat.',
    pt: 'O candle dá quatro valores ao mesmo tempo — abertura, fechamento, máxima e mínima — então a agitação dentro do período também aparece.'
  },
  'lab2.chartGuide.chapters.type.steps.candles.where': {
    zh: '工具栏：图表类型按钮',
    hi: 'टूलबार: चार्ट प्रकार बटन', es: 'Barra: botón de tipo de gráfico', fr: 'Barre : bouton de type',
    ru: 'Панель: кнопка типа графика', tr: 'Araç çubuğu: grafik türü düğmesi', ur: 'ٹول بار: چارٹ قسم بٹن',
    id: 'Bilah alat: tombol jenis grafik', pt: 'Barra: botão de tipo de gráfico'
  },
  'lab2.chartGuide.chapters.type.steps.line.title': {
    zh: '折线', hi: 'रेखा', es: 'Línea', fr: 'Ligne', ru: 'Линия',
    tr: 'Çizgi', ur: 'لکیر', id: 'Garis', pt: 'Linha'
  },
  'lab2.chartGuide.chapters.type.steps.line.body': {
    zh: '折线只画收盘价，所以形状更干净，但覆盖了周期内的波动。用于看长期方向，不适合判断当根。',
    hi: 'रेखा केवल बंद मूल्य खींचती है: आकार साफ़ होता है पर अवधि के अंदर की हलचल छिप जाती है। दीर्घ दिशा के लिए, एक कैंडल पढ़ने के लिए नहीं।',
    es: 'La línea solo dibuja el cierre: más limpia, pero oculta el vaivén del período. Sirve para la dirección de fondo, no para juzgar una vela.',
    fr: 'La ligne ne trace que la clôture : plus propre, mais elle masque l’agitation de la période. Pour la direction de fond, pas pour juger un chandelier.',
    ru: 'Линия рисует только закрытие: график чище, но колебания внутри периода скрыты. Для общего направления, а не для одной свечи.',
    tr: 'Çizgi yalnızca kapanışı çizer: daha temiz, ama dönem içi dalgalanmayı saklar. Ana yön için, tek mumu yargılamak için değil.',
    ur: 'لکیر صرف کلوز کھینچتی ہے: شکل صاف، مگر دورانیے کی ہلچل چھپ جاتی ہے۔ طویل سمت کے لیے، ایک کینڈل پرکھنے کے لیے نہیں۔',
    id: 'Garis hanya menggambar penutupan: lebih bersih, tetapi gejolak dalam periode tersembunyi. Untuk arah utama, bukan menilai satu candle.',
    pt: 'A linha desenha só o fechamento: mais limpa, mas esconde o vaivém do período. Para a direção de fundo, não para julgar um candle.'
  },
  'lab2.chartGuide.chapters.type.steps.line.where': {
    zh: '工具栏图表类型 → 折线',
    hi: 'टूलबार चार्ट प्रकार → रेखा', es: 'Tipo de gráfico → Línea', fr: 'Type de graphique → Ligne',
    ru: 'Тип графика → Линия', tr: 'Grafik türü → Çizgi', ur: 'چارٹ قسم → لکیر',
    id: 'Jenis grafik → Garis', pt: 'Tipo de gráfico → Linha'
  },
  'lab2.chartGuide.chapters.type.steps.area.title': {
    zh: '面积', hi: 'क्षेत्र', es: 'Área', fr: 'Aire', ru: 'Область',
    tr: 'Alan', ur: 'رقبہ', id: 'Area', pt: 'Área'
  },
  'lab2.chartGuide.chapters.type.steps.area.body': {
    zh: '面积图是带填充的折线——适合一眼看出区间高低，同样隐藏周期内的波动。',
    hi: 'क्षेत्र चार्ट भरा हुआ रेखा चार्ट है — अवधि का ऊपर-नीचा एक नज़र में, पर हलचल वैसे ही छिपी।',
    es: 'El área es una línea rellena: el vaivén del intervalo se ve de un vistazo, y el movimiento interno sigue oculto igual.',
    fr: 'L’aire est une ligne remplie : l’amplitude de l’intervalle saute aux yeux, et le mouvement interne reste tout aussi caché.',
    ru: 'Область — залитая линия: размах интервала виден сразу, а движение внутри периода так же скрыто.',
    tr: 'Alan, doldurulmuş çizgi grafiğidir: aralığın genliği bir bakışta görünür, iç hareket yine gizlidir.',
    ur: 'رقبہ بھری ہوئی لکیر ہے — دورانیے کا اتار چڑھاؤ ایک نظر میں، اندر کی ہلچل ویسے ہی چھپی۔',
    id: 'Area adalah garis berisi: rentang periode terlihat sekali pandang, dan gerakan internal tetap tersembunyi.',
    pt: 'A área é uma linha preenchida: a amplitude do intervalo salta aos olhos, e o movimento interno continua oculto.'
  },
  'lab2.chartGuide.chapters.type.steps.area.where': {
    zh: '工具栏图表类型 → 面积', hi: 'टूलबार चार्ट प्रकार → क्षेत्र', es: 'Tipo de gráfico → Área',
    fr: 'Type de graphique → Aire', ru: 'Тип графика → Область', tr: 'Grafik türü → Alan',
    ur: 'چارٹ قسم → رقبہ', id: 'Jenis grafik → Area', pt: 'Tipo de gráfico → Área'
  },
  'lab2.chartGuide.chapters.type.steps.which.title': {
    zh: '用哪个', hi: 'कौन-सा चुनें', es: 'Cuál usar', fr: 'Lequel choisir',
    ru: 'Что выбрать', tr: 'Hangisi', ur: 'کون سا', id: 'Mana yang dipakai', pt: 'Qual usar'
  },
  'lab2.chartGuide.chapters.type.steps.which.body': {
    zh: '要判断一个周期里发生了什么，用K线；要看整个窗口的形状，用折线或面积。',
    hi: 'किसी एक अवधि में क्या हुआ यह जानना हो तो कैंडल; पूरी विंडो का आकार देखना हो तो रेखा या क्षेत्र।',
    es: 'Para saber qué pasó dentro de un período, velas; para la forma de toda la ventana, línea o área.',
    fr: 'Pour savoir ce qui s’est passé dans une période, les chandeliers ; pour la forme de toute la fenêtre, la ligne ou l’aire.',
    ru: 'Чтобы понять, что было внутри периода, — свечи; чтобы увидеть форму всего окна — линия или область.',
    tr: 'Bir dönemde ne olduğunu anlamak için mum; pencerenin genel şekli için çizgi veya alan.',
    ur: 'کسی دورانیے میں کیا ہوا جاننا ہو تو کینڈل؛ پوری ونڈو کی شکل دیکھنی ہو تو لکیر یا رقبہ۔',
    id: 'Untuk tahu apa yang terjadi dalam satu periode, pakai candle; untuk bentuk seluruh jendela, garis atau area.',
    pt: 'Para saber o que aconteceu num período, candles; para a forma da janela inteira, linha ou área.'
  },
  'lab2.chartGuide.chapters.type.steps.which.where': {
    zh: '工具栏图表类型三个按钮',
    hi: 'टूलबार के तीन चार्ट प्रकार बटन', es: 'Los tres botones de tipo en la barra',
    fr: 'Les trois boutons de type de la barre', ru: 'Три кнопки типа на панели', tr: 'Araç çubuğundaki üç tür düğmesi',
    ur: 'ٹول بار کے تین چارٹ قسم بٹن', id: 'Tiga tombol jenis di bilah alat', pt: 'Os três botões de tipo na barra'
  },

  /* ── chapters · avg ──────────────────────────────────────────────────── */
  'lab2.chartGuide.chapters.avg.title': {
    zh: '移动平均', hi: 'मूविंग एवरेज', es: 'Medias móviles', fr: 'Moyennes mobiles',
    ru: 'Скользящие средние', tr: 'Hareketli ortalamalar', ur: 'موونگ ایوریج', id: 'Rata-rata bergerak', pt: 'Médias móveis'
  },
  'lab2.chartGuide.chapters.avg.steps.why.title': {
    zh: '它们回答什么', hi: 'ये क्या बताते हैं', es: 'Qué responden', fr: 'À quoi elles servent',
    ru: 'Что они показывают', tr: 'Ne işe yarar', ur: 'یہ کیا بتاتے ہیں', id: 'Apa fungsinya', pt: 'Para que servem'
  },
  'lab2.chartGuide.chapters.avg.steps.why.body': {
    zh: '移动平均把过去 N 个收盘价平滑成一条线，去掉单根K线的噪声。它描述的是过去，不是预测。',
    hi: 'मूविंग एवरेज पिछले N बंद मूल्यों को एक रेखा में समतल करता है और एक कैंडल का शोर हटाता है। यह अतीत बताता है, भविष्यवाणी नहीं।',
    es: 'Una media móvil suaviza los últimos N cierres en una línea y quita el ruido de una sola vela. Describe el pasado, no predice.',
    fr: 'Une moyenne mobile lisse les N dernières clôtures en une ligne et gomme le bruit d’un seul chandelier. Elle décrit le passé, elle ne prédit pas.',
    ru: 'Скользящая средняя сглаживает последние N закрытий в одну линию и убирает шум одной свечи. Она описывает прошлое, а не предсказывает.',
    tr: 'Hareketli ortalama son N kapanışı tek çizgiye yumuşatır ve tek mumun gürültüsünü atar. Geçmişi anlatır, tahmin etmez.',
    ur: 'موونگ ایوریج گزشتہ N کلوز کو ایک لکیر میں ہموار کرتا ہے اور ایک کینڈل کا شور ہٹاتا ہے۔ یہ ماضی بیان کرتا ہے، پیشگوئی نہیں۔',
    id: 'Rata-rata bergerak menghaluskan N penutupan terakhir menjadi satu garis dan membuang derau satu candle. Ia menjelaskan masa lalu, bukan memprediksi.',
    pt: 'Uma média móvel suaviza os últimos N fechamentos em uma linha e remove o ruído de um candle. Ela descreve o passado, não prevê.'
  },
  'lab2.chartGuide.chapters.avg.steps.why.where': {
    zh: '工具栏：MA7 · MA25 · MA99', hi: 'टूलबार: MA7 · MA25 · MA99', es: 'Barra: MA7 · MA25 · MA99',
    fr: 'Barre : MA7 · MA25 · MA99', ru: 'Панель: MA7 · MA25 · MA99', tr: 'Araç çubuğu: MA7 · MA25 · MA99',
    ur: 'ٹول بار: MA7 · MA25 · MA99', id: 'Bilah alat: MA7 · MA25 · MA99', pt: 'Barra: MA7 · MA25 · MA99'
  },
  'lab2.chartGuide.chapters.avg.steps.sma.title': {
    zh: '短线与长线', hi: 'छोटी और लंबी अवधि', es: 'Corto y largo', fr: 'Court et long',
    ru: 'Короткая и длинная', tr: 'Kısa ve uzun', ur: 'مختصر اور طویل', id: 'Pendek dan panjang', pt: 'Curta e longa'
  },
  'lab2.chartGuide.chapters.avg.steps.sma.body': {
    zh: '周期越短（MA7），线越贴近价格；越长（MA99），线越稳但越滞后。两条线的间距就是它们的分歧程度。',
    hi: 'छोटी अवधि (MA7) की रेखा मूल्य के करीब रहती है; लंबी (MA99) स्थिर पर पीछे। दोनों के बीच का अंतर उनके फ़ासले का माप है।',
    es: 'Cuanto más corta (MA7), más se pega al precio; cuanto más larga (MA99), más estable pero con más retraso. La separación entre ambas mide su desacuerdo.',
    fr: 'Plus la période est courte (MA7), plus la ligne colle au prix ; plus elle est longue (MA99), plus elle est stable mais en retard. L’écart entre les deux mesure leur désaccord.',
    ru: 'Чем короче период (MA7), тем ближе линия к цене; чем длиннее (MA99), тем устойчивее, но с большим запаздыванием. Расстояние между ними и есть мера их расхождения.',
    tr: 'Kısa periyot (MA7) fiyata yakın durur; uzun periyot (MA99) daha kararlı ama gecikmeli. İkisi arasındaki açıklık, anlaşmazlıklarının ölçüsüdür.',
    ur: 'چھوٹی مدت (MA7) قیمت کے قریب رہتی ہے؛ لمبی (MA99) مستحکم مگر پیچھے۔ دونوں کے درمیان فاصلہ ان کے اختلاف کا پیمانہ ہے۔',
    id: 'Makin pendek (MA7), makin menempel pada harga; makin panjang (MA99), makin stabil tetapi makin tertinggal. Jarak keduanya mengukur perbedaan mereka.',
    pt: 'Quanto mais curta (MA7), mais colada ao preço; quanto mais longa (MA99), mais estável mas mais atrasada. A separação entre as duas mede a discordância.'
  },
  'lab2.chartGuide.chapters.avg.steps.sma.where': {
    zh: '练习区：打开 MA7 和 MA25 观察',
    hi: 'अभ्यास क्षेत्र: MA7 और MA25 चालू करके देखें',
    es: 'Zona de práctica: activa MA7 y MA25 y observa',
    fr: 'Zone d’essai : activez MA7 et MA25 et observez',
    ru: 'Зона практики: включите MA7 и MA25 и посмотрите',
    tr: 'Alıştırma alanı: MA7 ve MA25’i açıp izleyin',
    ur: 'مشق کا خانہ: MA7 اور MA25 چلا کر دیکھیں',
    id: 'Area latihan: aktifkan MA7 dan MA25 lalu amati',
    pt: 'Área de prática: ative MA7 e MA25 e observe'
  },
  'lab2.chartGuide.chapters.avg.steps.ema.title': {
    zh: 'EMA 与 MA', hi: 'EMA और MA', es: 'EMA frente a MA', fr: 'EMA contre MA',
    ru: 'EMA и MA', tr: 'EMA ve MA', ur: 'EMA اور MA', id: 'EMA vs MA', pt: 'EMA e MA'
  },
  'lab2.chartGuide.chapters.avg.steps.ema.body': {
    zh: 'EMA 给近期价格更高权重，所以转向更快、也更敏感。同一周期下，EMA 通常比 MA 更贴近价格。',
    hi: 'EMA हाल के मूल्यों को अधिक भार देता है, इसलिए मुड़ाव में तेज़ और अधिक संवेदनशील है। एक ही अवधि में EMA आमतौर पर MA से मूल्य के करीब रहता है।',
    es: 'La EMA pondera más los precios recientes, así que gira antes y es más sensible. Con el mismo período suele quedar más cerca del precio que la MA.',
    fr: 'L’EMA donne plus de poids aux prix récents : elle tourne plus tôt et réagit davantage. À période égale, elle reste souvent plus proche du prix que la MA.',
    ru: 'EMA придаёт больший вес недавним ценам, поэтому разворачивается раньше и чувствительнее. При том же периоде обычно ближе к цене, чем MA.',
    tr: 'EMA son fiyatlara daha çok ağırlık verir; bu yüzden daha erken döner ve daha duyarlıdır. Aynı periyotta genelde MA’ya göre fiyata daha yakındır.',
    ur: 'EMA حالیہ قیمتوں کو زیادہ وزن دیتا ہے، اس لیے پہلے مڑتا ہے اور زیادہ حساس ہے۔ اسی مدت میں عام طور پر MA سے قیمت کے قریب رہتا ہے۔',
    id: 'EMA memberi bobot lebih pada harga terbaru, jadi berbalik lebih awal dan lebih sensitif. Pada periode sama biasanya lebih dekat ke harga daripada MA.',
    pt: 'A EMA pondera mais os preços recentes, então vira antes e é mais sensível. No mesmo período costuma ficar mais perto do preço que a MA.'
  },
  'lab2.chartGuide.chapters.avg.steps.ema.where': {
    zh: '工具栏：EMA21 · EMA55', hi: 'टूलबार: EMA21 · EMA55', es: 'Barra: EMA21 · EMA55',
    fr: 'Barre : EMA21 · EMA55', ru: 'Панель: EMA21 · EMA55', tr: 'Araç çubuğu: EMA21 · EMA55',
    ur: 'ٹول بار: EMA21 · EMA55', id: 'Bilah alat: EMA21 · EMA55', pt: 'Barra: EMA21 · EMA55'
  },
  'lab2.chartGuide.chapters.avg.steps.cross.title': {
    zh: '交叉不是信号', hi: 'क्रॉस संकेत नहीं है', es: 'Un cruce no es una señal', fr: 'Un croisement n’est pas un signal',
    ru: 'Пересечение — не сигнал', tr: 'Kesişim sinyal değildir', ur: 'کراس سگنل نہیں', id: 'Persilangan bukan sinyal', pt: 'Cruzamento não é sinal'
  },
  'lab2.chartGuide.chapters.avg.steps.cross.body': {
    zh: '短线上穿长线常被叫作“交叉”，但它在震荡市里非常频繁。它描述的是近期价格相对更强，不是什么保证。',
    hi: 'छोटी रेखा का लंबी को पार करना “क्रॉस” कहलाता है, पर बाज़ार के दायरे में यह बहुत बार होता है। यह बताता है कि हाल का मूल्य तुलनात्मक रूप से मज़बूत है — यह कोई गारंटी नहीं।',
    es: 'Que la corta cruce a la larga se llama “cruce”, y ocurre muchísimo en mercados laterales. Describe que el precio reciente está relativamente más fuerte; no es una garantía.',
    fr: 'Le croisement de la courte au-dessus de la longue s’appelle un « cross », et il est très fréquent en marché latéral. Il dit que le prix récent est relativement plus fort — pas une garantie.',
    ru: 'Пересечение короткой выше длинной называют «кроссом», и в боковике оно случается очень часто. Оно говорит, что недавняя цена относительно сильнее, а не даёт гарантию.',
    tr: 'Kısa çizginin uzunu yukarı kesmesine “kesişim” denir ve yatay piyasada çok sık olur. Son fiyatın görece daha güçlü olduğunu söyler — bir garanti değil.',
    ur: 'چھوٹی لکیر کا لمبی کو اوپر کاٹنا ”کراس“ کہلاتا ہے، مگر سائیڈ ویز مارکیٹ میں یہ بہت بار ہوتا ہے۔ یہ بتاتا ہے کہ حالیہ قیمت نسبتاً مضبوط ہے — کوئی ضمانت نہیں۔',
    id: 'Garis pendek memotong garis panjang disebut “persilangan”, dan itu sering sekali terjadi di pasar menyamping. Ia menjelaskan harga terbaru relatif lebih kuat — bukan jaminan.',
    pt: 'A curta cruzando acima da longa é chamada de “cruzamento”, e acontece muito em mercado lateral. Descreve que o preço recente está relativamente mais forte — não é garantia.'
  },
  'lab2.chartGuide.chapters.avg.steps.cross.where': {
    zh: '练习区中把 MA7 与 MA99 同时打开对比',
    hi: 'अभ्यास क्षेत्र में MA7 और MA99 साथ खोलकर देखें',
    es: 'Abre MA7 y MA99 juntas en la práctica y compara',
    fr: 'Ouvrez MA7 et MA99 ensemble dans l’essai',
    ru: 'Включите MA7 и MA99 вместе в зоне практики',
    tr: 'Alıştırmada MA7 ve MA99’u birlikte açın',
    ur: 'مشق میں MA7 اور MA99 اکٹھے کھول کر دیکھیں',
    id: 'Buka MA7 dan MA99 bersamaan di area latihan',
    pt: 'Abra MA7 e MA99 juntas na prática'
  },
  'lab2.chartGuide.chapters.avg.steps.labels.title': {
    zh: '那些英文标签', hi: 'वे अंग्रेज़ी लेबल', es: 'Esas etiquetas', fr: 'Ces libellés',
    ru: 'Эти подписи', tr: 'O etiketler', ur: 'وہ لیبل', id: 'Label-label itu', pt: 'Esses rótulos'
  },
  'lab2.chartGuide.chapters.avg.steps.labels.body': {
    zh: '工具栏上的 MA7 / MA25 / MA99 / EMA21 / EMA55 是标准缩写，刻意不翻译——它们在每个交易终端里都一样。',
    hi: 'टूलबार पर MA7 / MA25 / MA99 / EMA21 / EMA55 मानक संक्षेप हैं और जानबूझकर अनुवादित नहीं — हर ट्रेडिंग टर्मिनल में यही रहते हैं।',
    es: 'MA7 / MA25 / MA99 / EMA21 / EMA55 son abreviaturas estándar y no se traducen a propósito: son las mismas en cualquier terminal de trading.',
    fr: 'MA7 / MA25 / MA99 / EMA21 / EMA55 sont des abréviations standard et ne sont volontairement pas traduites : elles sont identiques dans tous les terminaux de trading.',
    ru: 'MA7 / MA25 / MA99 / EMA21 / EMA55 — стандартные сокращения, и они намеренно не переводятся: так в любом торговом терминале.',
    tr: 'MA7 / MA25 / MA99 / EMA21 / EMA55 standart kısaltmalardır ve bilerek çevrilmez: her işlem terminalinde aynıdır.',
    ur: 'ٹول بار پر MA7 / MA25 / MA99 / EMA21 / EMA55 معیاری مخففات ہیں اور جان بوجھ کر ترجمہ نہیں کیے گئے — ہر ٹریڈنگ ٹرمینل میں یہی رہتے ہیں۔',
    id: 'MA7 / MA25 / MA99 / EMA21 / EMA55 adalah singkatan standar dan sengaja tidak diterjemahkan: sama di setiap terminal perdagangan.',
    pt: 'MA7 / MA25 / MA99 / EMA21 / EMA55 são abreviações padrão e de propósito não são traduzidas: são iguais em qualquer terminal de negociação.'
  },
  'lab2.chartGuide.chapters.avg.steps.labels.where': {
    zh: '工具栏指标芯片的标签',
    hi: 'टूलबार के संकेतक चिप लेबल', es: 'Etiquetas de chips de indicador en la barra',
    fr: 'Libellés des puces d’indicateur', ru: 'Подписи чипов индикаторов', tr: 'Gösterge çipi etiketleri',
    ur: 'ٹول بار کے اشاریہ چپ لیبل', id: 'Label chip indikator', pt: 'Rótulos dos chips de indicador'
  },

  /* ── chapters · bands ────────────────────────────────────────────────── */
  'lab2.chartGuide.chapters.bands.title': {
    zh: '布林带', hi: 'बोलिंजर बैंड', es: 'Bandas de Bollinger', fr: 'Bandes de Bollinger',
    ru: 'Полосы Боллинджера', tr: 'Bollinger bantları', ur: 'بولنگر بینڈز', id: 'Pita Bollinger', pt: 'Bandas de Bollinger'
  },
  'lab2.chartGuide.chapters.bands.steps.what.title': {
    zh: '它画的是什么', hi: 'यह क्या खींचता है', es: '¿Qué dibuja?', fr: 'Ce qu’elle dessine',
    ru: 'Что она рисует', tr: 'Ne çizer', ur: 'یہ کیا کھینچتی ہے', id: 'Apa yang digambar', pt: 'O que desenha'
  },
  'lab2.chartGuide.chapters.bands.steps.what.body': {
    zh: '三条线：一条 20 周期均线，上下各一条按波动率偏移的带。价格大部分时间待在带内。',
    hi: 'तीन रेखाएँ: 20-अवधि की औसत, और उसके ऊपर-नीचे अस्थिरता के अनुसार दूरी पर दो बैंड। मूल्य ज़्यादातर समय बैंड के अंदर रहता है।',
    es: 'Tres líneas: una media de 20 períodos y una banda a cada lado desplazada según la volatilidad. El precio pasa la mayor parte del tiempo dentro.',
    fr: 'Trois lignes : une moyenne sur 20 périodes et une bande de chaque côté, décalée selon la volatilité. Le prix reste la plupart du temps dedans.',
    ru: 'Три линии: средняя за 20 периодов и две полосы по сторонам, смещённые по волатильности. Цена большую часть времени внутри.',
    tr: 'Üç çizgi: 20 periyotluk ortalama ve oynaklığa göre kaydırılmış iki bant. Fiyat çoğu zaman bantların içinde kalır.',
    ur: 'تین لکیریں: 20 مدت کی اوسط اور اوپر نیچے اتار چڑھاؤ کے مطابق ہٹے ہوئے دو بینڈ۔ قیمت زیادہ تر وقت بینڈ کے اندر رہتی ہے۔',
    id: 'Tiga garis: rata-rata 20 periode dan satu pita di atas serta di bawah, digeser sesuai volatilitas. Harga sebagian besar waktu berada di dalam.',
    pt: 'Três linhas: uma média de 20 períodos e uma banda de cada lado, deslocada conforme a volatilidade. O preço fica a maior parte do tempo dentro.'
  },
  'lab2.chartGuide.chapters.bands.steps.what.where': {
    zh: '工具栏：BB 按钮', hi: 'टूलबार: BB बटन', es: 'Barra: botón BB', fr: 'Barre : bouton BB',
    ru: 'Панель: кнопка BB', tr: 'Araç çubuğu: BB düğmesi', ur: 'ٹول بار: BB بٹن',
    id: 'Bilah alat: tombol BB', pt: 'Barra: botão BB'
  },
  'lab2.chartGuide.chapters.bands.steps.squeeze.title': {
    zh: '带变窄意味着什么', hi: 'बैंड सिकुड़ने का मतलब', es: 'Qué significa que se estrechen', fr: 'Ce que signifie un rétrécissement',
    ru: 'Что значит сужение', tr: 'Daralma ne demek', ur: 'بینڈ تنگ ہونے کا مطلب', id: 'Arti pita menyempit', pt: 'O que significa estreitar'
  },
  'lab2.chartGuide.chapters.bands.steps.squeeze.body': {
    zh: '带宽收窄表示近期波动小。它不告诉你什么时候会突破，只说明现在的波动比之前小。',
    hi: 'बैंड का पतला होना बताता है कि हाल की अस्थिरता कम है। यह नहीं कहता कि ब्रेकआउट कब होगा — केवल यह कि अभी उतार-चढ़ाव पहले से कम है।',
    es: 'Que las bandas se estrechen dice que la volatilidad reciente es baja. No dice cuándo habrá una ruptura, solo que el vaivén es menor que antes.',
    fr: 'Des bandes étroites disent que la volatilité récente est faible. Elles ne disent pas quand surviendra une cassure, seulement que l’agitation est moindre qu’avant.',
    ru: 'Сужение полос говорит о низкой недавней волатильности. Оно не говорит, когда будет пробой, только что размах меньше прежнего.',
    tr: 'Bantların daralması son dönemdeki oynaklığın düşük olduğunu söyler. Kırılmanın ne zaman olacağını değil, yalnızca salınımın eskisinden az olduğunu.',
    ur: 'بینڈ کا تنگ ہونا بتاتا ہے کہ حالیہ اتار چڑھاؤ کم ہے۔ یہ نہیں بتاتا کہ بریک آؤٹ کب ہوگا — صرف یہ کہ ابھی ہلچل پہلے سے کم ہے۔',
    id: 'Pita menyempit berarti volatilitas terbaru rendah. Ia tidak memberi tahu kapan akan ada penembusan, hanya bahwa gejolaknya lebih kecil dari sebelumnya.',
    pt: 'Bandas estreitas dizem que a volatilidade recente é baixa. Não dizem quando haverá rompimento, só que o vaivém é menor que antes.'
  },
  'lab2.chartGuide.chapters.bands.steps.squeeze.where': {
    zh: '练习区：打开 BB 观察带宽变化',
    hi: 'अभ्यास क्षेत्र: BB चालू करके चौड़ाई देखें',
    es: 'Práctica: activa BB y mira el ancho',
    fr: 'Essai : activez BB et regardez la largeur',
    ru: 'Практика: включите BB и смотрите ширину',
    tr: 'Alıştırma: BB’yi açıp genişliği izleyin',
    ur: 'مشق: BB چلا کر چوڑائی دیکھیں',
    id: 'Latihan: aktifkan BB dan amati lebarnya',
    pt: 'Prática: ative BB e veja a largura'
  },
  'lab2.chartGuide.chapters.bands.steps.caution.title': {
    zh: '带外不等于反转', hi: 'बैंड के बाहर का मतलब उलटाव नहीं', es: 'Fuera de la banda no es un giro',
    fr: 'Sortir de la bande n’est pas un retournement', ru: 'Выход за полосу — не разворот', tr: 'Bant dışı dönüş demek değil',
    ur: 'بینڈ سے باہر ہونا الٹاوٹ نہیں', id: 'Keluar pita bukan pembalikan', pt: 'Fora da banda não é reversão'
  },
  'lab2.chartGuide.chapters.bands.steps.caution.body': {
    zh: '价格收在带外只表示这一根移动幅度大；在强趋势里它会一直待在带外。别把它当成卖出/买入提示。',
    hi: 'बैंड के बाहर बंद होना केवल यह बताता है कि इस अवधि में बड़ी हलचल हुई; तेज़ रुझान में यह बाहर ही रहता है। इसे खरीद/बिक्री संकेत मत समझें।',
    es: 'Cerrar fuera de la banda solo dice que este período se movió mucho; en una tendencia fuerte se queda fuera. No lo tomes como aviso de compra o venta.',
    fr: 'Clôturer hors de la bande dit seulement que la période a beaucoup bougé ; dans une forte tendance, le prix y reste. Ne le prenez pas pour un signal d’achat ou de vente.',
    ru: 'Закрытие за полосой говорит лишь о большом движении за период; в сильном тренде цена остаётся снаружи. Не считайте это сигналом к покупке или продаже.',
    tr: 'Bandın dışında kapanış yalnızca bu dönemde büyük hareket olduğunu söyler; güçlü trendde fiyat dışarıda kalır. Bunu al/sat sinyali saymayın.',
    ur: 'بینڈ سے باہر کلوز صرف یہ بتاتا ہے کہ اس دورانیے میں بڑی ہلچل ہوئی؛ تیز رجحان میں یہ باہر ہی رہتا ہے۔ اسے خریدنے/بیچنے کا اشارہ مت سمجھیں۔',
    id: 'Menutup di luar pita hanya berarti periode ini bergerak besar; dalam tren kuat harga tetap di luar. Jangan anggap ini sinyal beli/jual.',
    pt: 'Fechar fora da banda só diz que o período se moveu muito; em tendência forte o preço fica fora. Não tome isso como sinal de compra ou venda.'
  },
  'lab2.chartGuide.chapters.bands.steps.caution.where': {
    zh: '任何 BB 打开的图表',
    hi: 'BB खुला हो तो कोई भी चार्ट', es: 'Cualquier gráfico con BB activo', fr: 'N’importe quel graphique avec BB',
    ru: 'Любой график с включённым BB', tr: 'BB açık her grafik', ur: 'BB کھلا ہو تو کوئی بھی چارٹ',
    id: 'Grafik mana pun dengan BB aktif', pt: 'Qualquer gráfico com BB ligado'
  },

  /* ── chapters · panes ────────────────────────────────────────────────── */
  'lab2.chartGuide.chapters.panes.title': {
    zh: '下方窗格', hi: 'नीचे के पैन', es: 'Paneles inferiores', fr: 'Panneaux du bas',
    ru: 'Нижние панели', tr: 'Alt paneller', ur: 'نیچے کے پین', id: 'Panel bawah', pt: 'Painéis inferiores'
  },
  'lab2.chartGuide.chapters.panes.steps.volume.title': {
    zh: '成交量', hi: 'वॉल्यूम', es: 'Volumen', fr: 'Volume', ru: 'Объём',
    tr: 'Hacim', ur: 'حجم', id: 'Volume', pt: 'Volume'
  },
  'lab2.chartGuide.chapters.panes.steps.volume.body': {
    zh: '成交量的柱表示该周期内换手了多少。价涨量增通常比价涨量缩更“有参与”，但这不是规则。',
    hi: 'वॉल्यूम बार बताते हैं कि उस अवधि में कितना कारोबार हुआ। बढ़ती कीमत के साथ बढ़ता वॉल्यूम आमतौर पर अधिक भागीदारी दिखाता है — यह नियम नहीं।',
    es: 'Las barras de volumen dicen cuánto se negoció en el período. Subida con volumen suele indicar más participación que subida sin él, pero no es una regla.',
    fr: 'Les barres de volume indiquent ce qui a été échangé sur la période. Une hausse avec volume traduit souvent plus de participation qu’une hausse sans, sans être une règle.',
    ru: 'Столбцы объёма показывают, сколько наторговали за период. Рост с объёмом обычно означает больше участия, чем рост без него, но это не правило.',
    tr: 'Hacim çubukları o dönemde ne kadar işlem geçtiğini gösterir. Hacimle yükseliş, hacimsiz yükselişten genelde daha fazla katılım demektir — kural değil.',
    ur: 'حجم کے ستون بتاتے ہیں کہ اس دورانیے میں کتنا کاروبار ہوا۔ قیمت بڑھنے کے ساتھ بڑھتا حجم عام طور پر زیادہ شرکت ظاہر کرتا ہے — مگر یہ اصول نہیں۔',
    id: 'Batang volume menunjukkan berapa banyak yang ditransaksikan dalam periode itu. Kenaikan dengan volume biasanya berarti lebih banyak partisipasi daripada tanpa — tetapi itu bukan aturan.',
    pt: 'As barras de volume dizem quanto foi negociado no período. Alta com volume costuma indicar mais participação do que sem ele, mas não é regra.'
  },
  'lab2.chartGuide.chapters.panes.steps.volume.where': {
    zh: '工具栏：成交量按钮',
    hi: 'टूलबार: वॉल्यूम बटन', es: 'Barra: botón Volumen', fr: 'Barre : bouton Volume',
    ru: 'Панель: кнопка Объём', tr: 'Araç çubuğu: Hacim düğmesi', ur: 'ٹول بار: حجم بٹن',
    id: 'Bilah alat: tombol Volume', pt: 'Barra: botão Volume'
  },
  'lab2.chartGuide.chapters.panes.steps.rsi.title': {
    zh: 'RSI', hi: 'RSI', es: 'RSI', fr: 'RSI', ru: 'RSI', tr: 'RSI', ur: 'RSI', id: 'RSI', pt: 'RSI'
  },
  'lab2.chartGuide.chapters.panes.steps.rsi.body': {
    zh: 'RSI 把近期涨跌压缩成 0–100 的数值。靠近 70 只表示“最近涨得多”，靠近 30 只表示“最近跌得多”，不代表马上反转。',
    hi: 'RSI हाल की तेज़ी-मंदी को 0–100 के अंक में बदलता है। 70 के पास का मतलब “हाल में ज़्यादा बढ़ा”, 30 के पास “हाल में ज़्यादा गिरा” — तुरंत उलटाव नहीं।',
    es: 'El RSI comprime las subidas y bajadas recientes en un número de 0 a 100. Cerca de 70 solo significa “subió mucho últimamente”; cerca de 30, “bajó mucho”. No anuncia un giro.',
    fr: 'Le RSI comprime les hausses et baisses récentes en un nombre de 0 à 100. Près de 70 veut dire « a beaucoup monté récemment » ; près de 30, « a beaucoup baissé ». Ce n’est pas un retournement annoncé.',
    ru: 'RSI сжимает недавние движения в число от 0 до 100. Близко к 70 — «сильно вырос за последнее время», близко к 30 — «сильно упал». Это не предвестие разворота.',
    tr: 'RSI son yükseliş ve düşüşleri 0–100 arası bir sayıya sıkıştırır. 70’e yakın olmak “son dönemde çok yükseldi”, 30’a yakın olmak “çok düştü” demektir — dönüş işareti değil.',
    ur: 'RSI حالیہ تیزی و مندی کو 0–100 کے عدد میں سمو دیتا ہے۔ 70 کے قریب کا مطلب ”حال میں زیادہ چڑھا“، 30 کے قریب ”زیادہ گرا“ — فوری الٹاوٹ نہیں۔',
    id: 'RSI memadatkan naik-turun terbaru menjadi angka 0–100. Dekat 70 hanya berarti “baru naik banyak”; dekat 30, “baru turun banyak”. Bukan tanda pembalikan.',
    pt: 'O RSI comprime as altas e baixas recentes num número de 0 a 100. Perto de 70 só significa “subiu muito ultimamente”; perto de 30, “caiu muito”. Não anuncia um giro.'
  },
  'lab2.chartGuide.chapters.panes.steps.rsi.where': {
    zh: '工具栏：RSI 按钮（打开后出现在下方窗格）',
    hi: 'टूलबार: RSI बटन (चालू होने पर नीचे के पैन में)',
    es: 'Barra: botón RSI (aparece en el panel inferior)',
    fr: 'Barre : bouton RSI (apparaît dans le panneau du bas)',
    ru: 'Панель: кнопка RSI (появляется в нижней панели)',
    tr: 'Araç çubuğu: RSI düğmesi (alt panelde görünür)',
    ur: 'ٹول بار: RSI بٹن (کھلنے پر نیچے کے پین میں)',
    id: 'Bilah alat: tombol RSI (muncul di panel bawah)',
    pt: 'Barra: botão RSI (aparece no painel inferior)'
  },
  'lab2.chartGuide.chapters.panes.steps.macd.title': {
    zh: 'MACD', hi: 'MACD', es: 'MACD', fr: 'MACD', ru: 'MACD', tr: 'MACD', ur: 'MACD', id: 'MACD', pt: 'MACD'
  },
  'lab2.chartGuide.chapters.panes.steps.macd.body': {
    zh: 'MACD 画两条均线之差与它的信号线；柱状图是两者的间距。它衡量的是动量变化的速度，同样是滞后的。',
    hi: 'MACD दो औसतों का अंतर और उसकी सिग्नल रेखा खींचता है; हिस्टोग्राम दोनों का फ़ासला है। यह गति के बदलने की रफ़्तार मापता है, और वह भी पीछे चलता है।',
    es: 'El MACD dibuja la diferencia entre dos medias y su línea de señal; el histograma es la separación. Mide la velocidad del cambio de impulso, y también va con retraso.',
    fr: 'Le MACD trace la différence entre deux moyennes et sa ligne de signal ; l’histogramme en est l’écart. Il mesure la vitesse du changement d’élan, et reste en retard.',
    ru: 'MACD рисует разницу двух средних и свою сигнальную линию; гистограмма — их расстояние. Он измеряет скорость изменения импульса и тоже запаздывает.',
    tr: 'MACD iki ortalamanın farkını ve sinyal çizgisini çizer; histogram ikisinin aralığıdır. Momentumun değişim hızını ölçer ve o da gecikmelidir.',
    ur: 'MACD دو اوسطوں کا فرق اور اس کی سگنل لکیر کھینچتا ہے؛ ہسٹوگرام دونوں کا فاصلہ ہے۔ یہ رفتار کی تبدیلی کی شرح ناپتا ہے، اور وہ بھی پیچھے چلتا ہے۔',
    id: 'MACD menggambar selisih dua rata-rata dan garis sinyalnya; histogram adalah jaraknya. Ia mengukur kecepatan perubahan momentum, dan juga tertinggal.',
    pt: 'O MACD desenha a diferença entre duas médias e sua linha de sinal; o histograma é a separação. Ele mede a velocidade da mudança do impulso, e também fica atrasado.'
  },
  'lab2.chartGuide.chapters.panes.steps.macd.where': {
    zh: '工具栏：MACD 按钮', hi: 'टूलबार: MACD बटन', es: 'Barra: botón MACD', fr: 'Barre : bouton MACD',
    ru: 'Панель: кнопка MACD', tr: 'Araç çubuğu: MACD düğmesi', ur: 'ٹول بار: MACD بٹن',
    id: 'Bilah alat: tombol MACD', pt: 'Barra: botão MACD'
  },

  /* ── chapters · levels ───────────────────────────────────────────────── */
  'lab2.chartGuide.chapters.levels.title': {
    zh: '价位工具', hi: 'स्तर उपकरण', es: 'Herramientas de nivel', fr: 'Outils de niveaux',
    ru: 'Инструменты уровней', tr: 'Seviye araçları', ur: 'سطح کے اوزار', id: 'Alat level', pt: 'Ferramentas de nível'
  },
  'lab2.chartGuide.chapters.levels.steps.priceLine.title': {
    zh: '价格线', hi: 'मूल्य रेखा', es: 'Línea de precio', fr: 'Ligne de prix',
    ru: 'Линия цены', tr: 'Fiyat çizgisi', ur: 'قیمت لکیر', id: 'Garis harga', pt: 'Linha de preço'
  },
  'lab2.chartGuide.chapters.levels.steps.priceLine.body': {
    zh: '价格线是你在图上画的一条水平线，用来记住一个价位。它不触发任何东西，只做标记。',
    hi: 'मूल्य रेखा आपके द्वारा चार्ट पर खींची गई क्षैतिज रेखा है, किसी स्तर को याद रखने के लिए। यह कुछ शुरू नहीं करती, केवल चिह्नित करती है।',
    es: 'La línea de precio es una horizontal que dibujas en el gráfico para recordar un nivel. No dispara nada: solo marca.',
    fr: 'La ligne de prix est une horizontale que vous tracez pour retenir un niveau. Elle ne déclenche rien : elle marque.',
    ru: 'Линия цены — горизонталь, которую вы рисуете, чтобы помнить уровень. Она ничего не запускает, только отмечает.',
    tr: 'Fiyat çizgisi bir seviyeyi hatırlamak için çizdiğiniz yatay çizgidir. Hiçbir şeyi tetiklemez, yalnızca işaretler.',
    ur: 'قیمت لکیر آپ کی کھینچی ہوئی افقی لکیر ہے، کسی سطح کو یاد رکھنے کے لیے۔ یہ کچھ شروع نہیں کرتی، صرف نشان زد کرتی ہے۔',
    id: 'Garis harga adalah garis horizontal yang Anda gambar untuk mengingat level. Ia tidak memicu apa pun, hanya menandai.',
    pt: 'A linha de preço é uma horizontal que você desenha para lembrar um nível. Ela não dispara nada: apenas marca.'
  },
  'lab2.chartGuide.chapters.levels.steps.priceLine.where': {
    zh: '工具栏：价格线芯片',
    hi: 'टूलबार: मूल्य रेखा चिप', es: 'Barra: chip de línea de precio', fr: 'Barre : puce ligne de prix',
    ru: 'Панель: чип линии цены', tr: 'Araç çubuğu: fiyat çizgisi çipi', ur: 'ٹول بار: قیمت لکیر چپ',
    id: 'Bilah alat: chip garis harga', pt: 'Barra: chip de linha de preço'
  },
  'lab2.chartGuide.chapters.levels.steps.measure.title': {
    zh: '测量', hi: 'मापें', es: 'Medir', fr: 'Mesurer', ru: 'Измерение',
    tr: 'Ölç', ur: 'پیمائش', id: 'Ukur', pt: 'Medir'
  },
  'lab2.chartGuide.chapters.levels.steps.measure.body': {
    zh: '测量工具让你从一点拖到另一点，读出两点之间的价格差与时间。用来量化一段走势的幅度。',
    hi: 'माप उपकरण एक बिंदु से दूसरे तक खींचकर दोनों के बीच का मूल्य अंतर और समय बताता है। एक चाल की मात्रा नापने के लिए।',
    es: 'La herramienta de medición te deja arrastrar de un punto a otro y lee la diferencia de precio y el tiempo entre ambos. Sirve para cuantificar un tramo.',
    fr: 'L’outil de mesure permet de glisser d’un point à un autre et lit l’écart de prix et le temps entre eux. Pour quantifier un mouvement.',
    ru: 'Инструмент измерения: тянете от одной точки к другой и читаете разницу цен и время между ними. Чтобы оценить величину движения.',
    tr: 'Ölçüm aracı bir noktadan diğerine sürüklemenizi sağlar; iki nokta arasındaki fiyat farkını ve süreyi okur. Bir hareketin büyüklüğünü ölçmek için.',
    ur: 'پیمائش کا اوزار ایک نقطے سے دوسرے تک کھینچنے دیتا ہے اور دونوں کے درمیان قیمت کا فرق اور وقت پڑھتا ہے۔ کسی حرکت کا حجم ناپنے کے لیے۔',
    id: 'Alat ukur memungkinkan Anda menyeret dari satu titik ke titik lain dan membaca selisih harga serta waktu di antaranya. Untuk mengukur besarnya sebuah pergerakan.',
    pt: 'A ferramenta de medição permite arrastar de um ponto a outro e lê a diferença de preço e o tempo entre eles. Para quantificar um trecho.'
  },
  'lab2.chartGuide.chapters.levels.steps.measure.where': {
    zh: '工具栏：测量芯片', hi: 'टूलबार: माप चिप', es: 'Barra: chip de medir', fr: 'Barre : puce mesurer',
    ru: 'Панель: чип измерения', tr: 'Araç çubuğu: ölç çipi', ur: 'ٹول بار: پیمائش چپ',
    id: 'Bilah alat: chip ukur', pt: 'Barra: chip de medir'
  },
  'lab2.chartGuide.chapters.levels.steps.fib.title': {
    zh: '斐波那契', hi: 'फिबोनाची', es: 'Fibonacci', fr: 'Fibonacci', ru: 'Фибоначчи',
    tr: 'Fibonacci', ur: 'فیبوناچی', id: 'Fibonacci', pt: 'Fibonacci'
  },
  'lab2.chartGuide.chapters.levels.steps.fib.body': {
    zh: '斐波那契按当前窗口的最高到最低画几条回撤比例线。它只是一个参照刻度，不是支撑阻力本身。',
    hi: 'फिबोनाची वर्तमान विंडो के उच्चतम और निम्नतम के आधार पर कुछ रिट्रेसमेंट रेखाएँ खींचता है। यह केवल एक संदर्भ पैमाना है, स्वयं सपोर्ट या रेज़िस्टेंस नहीं।',
    es: 'Fibonacci dibuja varias líneas de retroceso entre el máximo y el mínimo de la ventana actual. Es una escala de referencia, no un soporte ni una resistencia por sí mismo.',
    fr: 'Fibonacci trace plusieurs lignes de retracement entre le plus haut et le plus bas de la fenêtre. C’est une échelle de référence, pas un support ni une résistance en soi.',
    ru: 'Фибоначчи рисует несколько линий коррекции от максимума до минимума текущего окна. Это опорная шкала, а не поддержка или сопротивление сами по себе.',
    tr: 'Fibonacci geçerli pencerenin en yükseği ile en düşüğü arasında birkaç geri çekilme çizgisi çizer. Yalnızca bir referans ölçektir; kendisi destek veya direnç değildir.',
    ur: 'فیبوناچی موجودہ ونڈو کی بلند ترین اور کم ترین سطح کے درمیان چند ریٹریسمنٹ لکیریں کھینچتا ہے۔ یہ صرف ایک حوالہ پیمانہ ہے، بذات خود سپورٹ یا ریزسٹنس نہیں۔',
    id: 'Fibonacci menggambar beberapa garis retracement antara tertinggi dan terendah jendela saat ini. Ini hanya skala acuan, bukan support atau resistance itu sendiri.',
    pt: 'O Fibonacci desenha várias linhas de retração entre a máxima e a mínima da janela atual. É uma escala de referência, não um suporte nem uma resistência por si só.'
  },
  'lab2.chartGuide.chapters.levels.steps.fib.where': {
    zh: '工具栏：Fib 芯片', hi: 'टूलबार: Fib चिप', es: 'Barra: chip Fib', fr: 'Barre : puce Fib',
    ru: 'Панель: чип Fib', tr: 'Araç çubuğu: Fib çipi', ur: 'ٹول بار: Fib چپ',
    id: 'Bilah alat: chip Fib', pt: 'Barra: chip Fib'
  },
  'lab2.chartGuide.chapters.levels.steps.fibRead.title': {
    zh: '如何读这些线', hi: 'इन रेखाओं को कैसे पढ़ें', es: 'Cómo leerlas', fr: 'Comment les lire',
    ru: 'Как их читать', tr: 'Nasıl okunur', ur: 'ان لکیروں کو کیسے پڑھیں', id: 'Cara membacanya', pt: 'Como lê-las'
  },
  'lab2.chartGuide.chapters.levels.steps.fibRead.body': {
    zh: '线随窗口移动：换到 90D，这些线会重画。它们标的是比例，不是承诺——价格穿过某条线并不代表那里就该反转。',
    hi: 'रेखाएँ विंडो के साथ चलती हैं: 90D पर जाने से वे फिर बनती हैं। वे अनुपात चिह्नित करती हैं, वादा नहीं — किसी रेखा को पार करना उलटाव का प्रमाण नहीं।',
    es: 'Las líneas se mueven con la ventana: al pasar a 90D se redibujan. Marcan proporciones, no promesas: cruzar una no prueba que ahí deba girar.',
    fr: 'Les lignes suivent la fenêtre : en passant à 90D, elles sont redessinées. Elles marquent des proportions, pas des promesses : traverser une ligne ne prouve pas un retournement.',
    ru: 'Линии двигаются с окном: переключитесь на 90D — они перерисуются. Они отмечают пропорции, а не обещания: проход линии не доказывает разворот.',
    tr: 'Çizgiler pencereyle birlikte hareket eder: 90D’ye geçince yeniden çizilir. Oranları işaretlerler, vaat değil — bir çizgiyi geçmek orada dönüş olacağını kanıtlamaz.',
    ur: 'لکیریں ونڈو کے ساتھ چلتی ہیں: 90D پر جانے سے وہ دوبارہ بنتی ہیں۔ وہ تناسب نشان زد کرتی ہیں، وعدہ نہیں — کسی لکیر کو پار کرنا الٹاوٹ کا ثبوت نہیں۔',
    id: 'Garis bergerak bersama jendela: pindah ke 90D dan garis digambar ulang. Ia menandai proporsi, bukan janji — melewati garis tidak membuktikan pembalikan.',
    pt: 'As linhas acompanham a janela: ao mudar para 90D, elas são redesenhadas. Marcam proporções, não promessas: cruzar uma linha não prova reversão.'
  },
  'lab2.chartGuide.chapters.levels.steps.fibRead.where': {
    zh: '练习区：打开 Fibonacci 后切换范围看它重画',
    hi: 'अभ्यास क्षेत्र: Fibonacci चालू करके रेंज बदलें और दोबारा बनते देखें',
    es: 'Práctica: activa Fibonacci y cambia el rango para verlo redibujarse',
    fr: 'Essai : activez Fibonacci et changez la plage pour le voir redessiner',
    ru: 'Практика: включите Fibonacci и меняйте диапазон — линии перерисуются',
    tr: 'Alıştırma: Fibonacci’yi açın, aralığı değiştirin ve yeniden çizilmesini görün',
    ur: 'مشق: Fibonacci چلا کر رینج بدلیں اور دوبارہ بنتا دیکھیں',
    id: 'Latihan: aktifkan Fibonacci dan ubah rentang untuk melihatnya digambar ulang',
    pt: 'Prática: ative o Fibonacci e mude o intervalo para vê-lo redesenhar'
  },

  /* ── chapters · scale ────────────────────────────────────────────────── */
  'lab2.chartGuide.chapters.scale.title': {
    zh: '坐标刻度', hi: 'पैमाना', es: 'Escala', fr: 'Échelle', ru: 'Масштаб',
    tr: 'Ölçek', ur: 'پیمانہ', id: 'Skala', pt: 'Escala'
  },
  'lab2.chartGuide.chapters.scale.steps.log.title': {
    zh: '对数刻度', hi: 'लॉग स्केल', es: 'Escala logarítmica', fr: 'Échelle logarithmique',
    ru: 'Логарифмическая шкала', tr: 'Logaritmik ölçek', ur: 'لاگ اسکیل', id: 'Skala logaritmik', pt: 'Escala logarítmica'
  },
  'lab2.chartGuide.chapters.scale.steps.log.body': {
    zh: '线性刻度里 10 和 100 的间距与 100 和 1000 一样，但对数刻度里两块间距相同——同样的百分比变化看起来一样大。',
    hi: 'रेखीय स्केल में 10–100 और 100–1000 का फ़ासला अलग दिखता है; लॉग स्केल में दोनों बराबर हैं — यानी समान प्रतिशत बदलाव समान दिखता है।',
    es: 'En escala lineal el hueco de 10 a 100 no se parece al de 100 a 1000; en escala logarítmica ambos son iguales, es decir, un mismo cambio porcentual se ve igual.',
    fr: 'En échelle linéaire, l’écart 10→100 ne ressemble pas à 100→1000 ; en échelle log, les deux sont égaux — une même variation en pourcentage se voit pareil.',
    ru: 'На линейной шкале путь 10→100 выглядит иначе, чем 100→1000; на логарифмической они равны — один и тот же процентный ход виден одинаково.',
    tr: 'Doğrusal ölçekte 10→100 arası, 100→1000 arasına benzemez; log ölçekte ikisi eşittir — aynı yüzde değişim aynı görünür.',
    ur: 'لکیری پیمانے میں 10 سے 100 کا فاصلہ 100 سے 1000 جیسا نہیں لگتا؛ لاگ پیمانے میں دونوں برابر ہیں — یعنی یکساں فیصد تبدیلی یکساں دکھتی ہے۔',
    id: 'Pada skala linear, jarak 10→100 tidak tampak seperti 100→1000; pada skala log keduanya sama — artinya perubahan persen yang sama terlihat sama.',
    pt: 'Na escala linear, o intervalo 10→100 não parece o de 100→1000; na escala log, os dois são iguais — ou seja, a mesma variação percentual aparece do mesmo jeito.'
  },
  'lab2.chartGuide.chapters.scale.steps.log.where': {
    zh: '工具栏：对数芯片 / 本页视图按钮', hi: 'टूलबार: लॉग चिप / इस पेज के दृश्य बटन',
    es: 'Barra: chip log / botones de vista de esta página', fr: 'Barre : puce log / boutons de vue de cette page',
    ru: 'Панель: чип log / кнопки вида на этой странице', tr: 'Araç çubuğu: log çipi / bu sayfanın görünüm düğmeleri',
    ur: 'ٹول بار: لاگ چپ / اس صفحے کے منظر والے بٹن', id: 'Bilah alat: chip log / tombol tampilan halaman ini',
    pt: 'Barra: chip log / botões de visualização desta página'
  },
  'lab2.chartGuide.chapters.scale.steps.when.title': {
    zh: '什么时候用', hi: 'कब इस्तेमाल करें', es: 'Cuándo usarla', fr: 'Quand l’utiliser',
    ru: 'Когда включать', tr: 'Ne zaman kullanılır', ur: 'کب استعمال کریں', id: 'Kapan memakainya', pt: 'Quando usar'
  },
  'lab2.chartGuide.chapters.scale.steps.when.body': {
    zh: '像 BTC 这样十年里从几十涨到几万，线性图会让早期变化看不见；对数刻度让早期同样重要的变化显示出来。',
    hi: 'BTC जैसा बीस से हज़ारों तक पहुँचा परिसंपत्ति रेखीय चार्ट में शुरुआती बदलाव गायब कर देता है; लॉग स्केल उन्हें वापस दिखाता है।',
    es: 'Un activo que pasó de decenas a miles, como BTC, desaparece en el tramo inicial con escala lineal; la logarítmica los devuelve a la vista.',
    fr: 'Un actif passé de quelques dizaines à des milliers, comme BTC, écrase ses débuts en échelle linéaire ; l’échelle log les fait réapparaître.',
    ru: 'Актив, прошедший путь от десятков до тысяч, как BTC, на линейной шкале теряет начало; лог-шкала возвращает его.',
    tr: 'BTC gibi onlardan binlere çıkan bir varlık doğrusal ölçekte başlangıcını yutar; log ölçek geri getirir.',
    ur: 'BTC جیسا اثاثہ جو دہائیوں سے ہزاروں تک پہنچا، لکیری چارٹ میں ابتدائی تبدیلیاں غائب کر دیتا ہے؛ لاگ پیمانہ انہیں واپس لاتا ہے۔',
    id: 'Aset yang naik dari puluhan ke ribuan, seperti BTC, menghapus bagian awalnya pada skala linear; skala log mengembalikannya.',
    pt: 'Um ativo que foi de dezenas a milhares, como o BTC, some no trecho inicial na escala linear; a log traz isso de volta.'
  },
  'lab2.chartGuide.chapters.scale.steps.when.where': {
    zh: '长期窗口（90D / 1Y）的图表',
    hi: 'लंबी विंडो (90D / 1Y) के चार्ट', es: 'Gráficos de ventanas largas (90D / 1Y)',
    fr: 'Graphiques de fenêtres longues (90D / 1Y)', ru: 'Графики длинных окон (90D / 1Y)',
    tr: 'Uzun pencereler (90D / 1Y)', ur: 'طویل ونڈو (90D / 1Y) کے چارٹ',
    id: 'Grafik jendela panjang (90D / 1Y)', pt: 'Gráficos de janelas longas (90D / 1Y)'
  },
  'lab2.chartGuide.chapters.scale.steps.grid.title': {
    zh: '网格', hi: 'ग्रिड', es: 'Rejilla', fr: 'Grille', ru: 'Сетка',
    tr: 'Izgara', ur: 'گرڈ', id: 'Kisi', pt: 'Grade'
  },
  'lab2.chartGuide.chapters.scale.steps.grid.body': {
    zh: '网格只是读数值的辅助线；关掉它不会改变数据，只是让干净的图更好看趋势。',
    hi: 'ग्रिड केवल मान पढ़ने की मदद है; बंद करने से डेटा नहीं बदलता, बस साफ़ चार्ट में रुझान आसान दिखता है।',
    es: 'La rejilla solo ayuda a leer valores; apagarla no cambia los datos, solo deja un gráfico más limpio para ver la tendencia.',
    fr: 'La grille aide seulement à lire les valeurs ; la couper ne change pas les données, elle laisse juste un graphique plus net pour voir la tendance.',
    ru: 'Сетка только помогает читать значения; выключив её, вы не меняете данные — просто график чище и тренд виднее.',
    tr: 'Izgara yalnızca değer okumaya yardım eder; kapatmak veriyi değiştirmez, yalnızca trendi görmek için daha temiz bir grafik bırakır.',
    ur: 'گرڈ صرف اقدار پڑھنے میں مدد ہے؛ بند کرنے سے ڈیٹا نہیں بدلتا، صرف صاف چارٹ میں رجحان آسان دکھتا ہے۔',
    id: 'Kisi hanya membantu membaca nilai; mematikannya tidak mengubah data, hanya menyisakan grafik lebih bersih untuk melihat tren.',
    pt: 'A grade só ajuda a ler valores; desligá-la não muda os dados, só deixa um gráfico mais limpo para ver a tendência.'
  },
  'lab2.chartGuide.chapters.scale.steps.grid.where': {
    zh: '工具栏：网格芯片', hi: 'टूलबार: ग्रिड चिप', es: 'Barra: chip de rejilla', fr: 'Barre : puce grille',
    ru: 'Панель: чип сетки', tr: 'Araç çubuğu: ızgara çipi', ur: 'ٹول بار: گرڈ چپ',
    id: 'Bilah alat: chip kisi', pt: 'Barra: chip de grade'
  },

  /* ── chapters · capture ──────────────────────────────────────────────── */
  'lab2.chartGuide.chapters.capture.title': {
    zh: '截图与保存', hi: 'स्क्रीनशॉट और सहेजना', es: 'Captura y guardado', fr: 'Capture et sauvegarde',
    ru: 'Снимок и сохранение', tr: 'Ekran görüntüsü', ur: 'اسکرین شاٹ اور محفوظ کرنا', id: 'Tangkapan layar', pt: 'Captura e salvamento'
  },
  'lab2.chartGuide.chapters.capture.steps.png.title': {
    zh: 'PNG 按钮', hi: 'PNG बटन', es: 'Botón PNG', fr: 'Bouton PNG', ru: 'Кнопка PNG',
    tr: 'PNG düğmesi', ur: 'PNG بٹن', id: 'Tombol PNG', pt: 'Botão PNG'
  },
  'lab2.chartGuide.chapters.capture.steps.png.body': {
    zh: '把当前图表按现在的外观保存成 PNG，包括打开的指标。图上不会带任何钱包或账户信息。',
    hi: 'वर्तमान चार्ट को जैसा दिख रहा है वैसा PNG में सहेजता है, खुले संकेतकों सहित। चित्र में कोई वॉलेट या खाता जानकारी नहीं आती।',
    es: 'Guarda el gráfico tal como se ve en un PNG, con los indicadores abiertos. La imagen no lleva datos de cartera ni de cuenta.',
    fr: 'Enregistre le graphique tel qu’il apparaît en PNG, indicateurs ouverts compris. L’image ne contient aucune donnée de portefeuille ou de compte.',
    ru: 'Сохраняет текущий график в PNG как есть, вместе с включёнными индикаторами. На изображении нет данных кошелька или аккаунта.',
    tr: 'Grafiği açık göstergelerle birlikte olduğu gibi PNG olarak kaydeder. Görselde cüzdan veya hesap bilgisi yoktur.',
    ur: 'موجودہ چارٹ کو جیسا نظر آ رہا ہے PNG میں محفوظ کرتا ہے، کھلے اشاریوں سمیت۔ تصویر میں کوئی والٹ یا اکاؤنٹ معلومات نہیں آتیں۔',
    id: 'Menyimpan grafik apa adanya sebagai PNG, termasuk indikator yang terbuka. Gambar tidak memuat data dompet atau akun.',
    pt: 'Salva o gráfico como está em PNG, incluindo os indicadores abertos. A imagem não leva dados de carteira nem de conta.'
  },
  'lab2.chartGuide.chapters.capture.steps.png.where': {
    zh: '工具栏：PNG 芯片（在展开的终端里）', hi: 'टूलबार: PNG चिप (खुले टर्मिनल में)',
    es: 'Barra: chip PNG (en el terminal expandido)', fr: 'Barre : puce PNG (terminal agrandi)',
    ru: 'Панель: чип PNG (в развёрнутом терминале)', tr: 'Araç çubuğu: PNG çipi (genişletilmiş terminalde)',
    ur: 'ٹول بار: PNG چپ (کھلے ٹرمینل میں)', id: 'Bilah alat: chip PNG (di terminal yang diperluas)',
    pt: 'Barra: chip PNG (no terminal expandido)'
  },
  'lab2.chartGuide.chapters.capture.steps.fit.title': {
    zh: '重置视图再截图', hi: 'रीसेट करके स्क्रीनशॉट', es: 'Restablece antes de capturar',
    fr: 'Réinitialisez avant de capturer', ru: 'Сбросьте вид перед снимком', tr: 'Çekmeden önce sıfırlayın',
    ur: 'ری سیٹ کر کے اسکرین شاٹ', id: 'Atur ulang sebelum menangkap', pt: 'Redefina antes de capturar'
  },
  'lab2.chartGuide.chapters.capture.steps.fit.body': {
    zh: '“适合”（或重置缩放）先把窗口放回屏幕，截图才不会只截到一段放大很多的历史。',
    hi: '“फ़िट” (या ज़ूम रीसेट) पहले पूरी विंडो लौटाता है, ताकि स्क्रीनशॉट में बहुत ज़ूम किया हुआ एक टुकड़ा न आए।',
    es: '«Ajustar» (o restablecer zoom) devuelve la ventana completa antes de capturar, para que el PNG no sea un fragmento muy ampliado.',
    fr: '« Ajuster » (ou réinitialiser le zoom) ramène la fenêtre entière avant la capture, pour que le PNG ne soit pas un fragment très zoomé.',
    ru: '«Вписать» (или сброс масштаба) сначала возвращает всё окно, чтобы на PNG не попал сильно приближенный фрагмент.',
    tr: '“Sığdır” (veya yakınlaştırma sıfırlama) önce tüm pencereyi geri getirir; böylece PNG çok yakınlaştırılmış bir parça olmaz.',
    ur: '”فٹ“ (یا زوم ری سیٹ) پہلے پوری ونڈو واپس لاتا ہے، تاکہ PNG میں بہت زوم شدہ ٹکڑا نہ آئے۔',
    id: '“Paskan” (atau atur ulang zoom) mengembalikan seluruh jendela lebih dulu, agar PNG tidak berupa potongan yang sangat diperbesar.',
    pt: '“Ajustar” (ou redefinir zoom) traz a janela inteira de volta antes da captura, para o PNG não ser um trecho muito ampliado.'
  },
  'lab2.chartGuide.chapters.capture.steps.fit.where': {
    zh: '工具栏：适合 / 重置缩放之后截图', hi: 'टूलबार: फ़िट / ज़ूम रीसेट के बाद PNG',
    es: 'Barra: Ajustar / restablecer zoom y luego PNG', fr: 'Barre : Ajuster / réinitialiser puis PNG',
    ru: 'Панель: Вписать / сброс масштаба, затем PNG', tr: 'Araç çubuğu: Sığdır / sıfırla, sonra PNG',
    ur: 'ٹول بار: فٹ / زوم ری سیٹ کے بعد PNG', id: 'Bilah alat: Paskan / atur ulang lalu PNG',
    pt: 'Barra: Ajustar / redefinir e depois PNG'
  },

  /* ── chapters · forecast ─────────────────────────────────────────────── */
  'lab2.chartGuide.chapters.forecast.title': {
    zh: 'AI 预测按钮', hi: 'AI पूर्वानुमान बटन', es: 'Botón de pronóstico IA', fr: 'Bouton de prévision IA',
    ru: 'Кнопка AI-прогноза', tr: 'AI tahmin düğmesi', ur: 'AI پیشگوئی بٹن', id: 'Tombol prakiraan AI', pt: 'Botão de previsão IA'
  },
  'lab2.chartGuide.chapters.forecast.steps.what.title': {
    zh: '它做什么', hi: 'यह क्या करता है', es: 'Qué hace', fr: 'Ce qu’il fait',
    ru: 'Что он делает', tr: 'Ne yapar', ur: 'یہ کیا کرتا ہے', id: 'Apa fungsinya', pt: 'O que ele faz'
  },
  'lab2.chartGuide.chapters.forecast.steps.what.body': {
    zh: '它把屏幕上现有的K线发给模型，模型给出接下来几根“可能”的K线，画成虚线。它不会自己拉取未来数据。',
    hi: 'यह स्क्रीन पर मौजूद कैंडल मॉडल को भेजता है, जो अगली कुछ “संभावित” कैंडल डैश में देता है। यह भविष्य का डेटा नहीं खींचता।',
    es: 'Envía al modelo las velas que ya están en pantalla y este dibuja unas pocas velas “posibles” a continuación, con línea discontinua. No obtiene datos del futuro.',
    fr: 'Il envoie au modèle les chandeliers déjà à l’écran, qui dessine quelques chandeliers « possibles » en pointillés. Il ne va rien chercher dans le futur.',
    ru: 'Он отправляет модели свечи, уже показанные на экране, и модель рисует несколько «возможных» свечей пунктиром. Данные из будущего он не берёт.',
    tr: 'Ekrandaki mumları modele gönderir; model sonraki birkaç “olası” mumu kesik çizgiyle çizer. Gelecekten veri çekmez.',
    ur: 'یہ اسکرین پر موجود کینڈل ماڈل کو بھیجتا ہے، جو آگے کی چند ”ممکنہ“ کینڈل ڈیشڈ لکیروں میں دیتا ہے۔ یہ مستقبل کا ڈیٹا نہیں لاتا۔',
    id: 'Ia mengirim candle yang sudah ada di layar ke model, lalu model menggambar beberapa candle “mungkin” berikutnya dengan garis putus-putus. Ia tidak mengambil data masa depan.',
    pt: 'Envia ao modelo os candles que já estão na tela, e o modelo desenha alguns candles “possíveis” em seguida, com linha tracejada. Ele não busca dados do futuro.'
  },
  'lab2.chartGuide.chapters.forecast.steps.what.where': {
    zh: '图表工具栏的“AI 预测”芯片', hi: 'चार्ट टूलबार का “AI पूर्वानुमान” चिप',
    es: 'Chip «pronóstico IA» en la barra del gráfico', fr: 'Puce « prévision IA » de la barre du graphique',
    ru: 'Чип «AI-прогноз» на панели графика', tr: 'Grafik araç çubuğundaki “AI tahmin” çipi',
    ur: 'چارٹ ٹول بار کا ”AI پیشگوئی“ چپ', id: 'Chip “prakiraan AI” di bilah grafik',
    pt: 'Chip “previsão IA” na barra do gráfico'
  },
  'lab2.chartGuide.chapters.forecast.steps.horizon.title': {
    zh: '预测步数', hi: 'पूर्वानुमान चरण', es: 'Horizonte', fr: 'Horizon',
    ru: 'Горизонт', tr: 'Ufuk', ur: 'افق', id: 'Horizon', pt: 'Horizonte'
  },
  'lab2.chartGuide.chapters.forecast.steps.horizon.body': {
    zh: '旁边的下拉框选择画几根。步数越多，不确定性累积得越快——第三十根比第三根弱得多。',
    hi: 'बगल का चयन तय करता है कितने कैंडल बनेंगे। जितने ज़्यादा, उतनी तेज़ी से अनिश्चितता बढ़ती है — तीसरा कैंडल तीसवें से बहुत कमज़ोर है।',
    es: 'El selector de al lado decide cuántas velas se dibujan. Cuantas más, más rápido se acumula la incertidumbre: la trigésima es mucho más débil que la tercera.',
    fr: 'Le sélecteur voisin décide combien de chandeliers sont dessinés. Plus il y en a, plus l’incertitude s’accumule : le trentième est bien plus faible que le troisième.',
    ru: 'Селектор рядом задаёт, сколько свечей рисовать. Чем больше, тем быстрее накапливается неопределённость: тридцатая куда слабее третьей.',
    tr: 'Yandaki seçici kaç mum çizileceğini belirler. Sayı arttıkça belirsizlik daha hızlı birikir: otuzuncu, üçüncüden çok daha zayıftır.',
    ur: 'ساتھ والا سلیکٹر طے کرتا ہے کتنے کینڈل بنیں گے۔ جتنے زیادہ، اتنی تیزی سے غیر یقینی بڑھتی ہے — تیسواں تیسرے سے بہت کمزور ہے۔',
    id: 'Pemilih di sebelahnya menentukan berapa candle yang digambar. Makin banyak, makin cepat ketidakpastian menumpuk — yang ketiga puluh jauh lebih lemah daripada yang ketiga.',
    pt: 'O seletor ao lado decide quantos candles são desenhados. Quanto mais, mais rápido a incerteza se acumula: o trigésimo é bem mais fraco que o terceiro.'
  },
  'lab2.chartGuide.chapters.forecast.steps.horizon.where': {
    zh: 'AI 芯片旁边的步数下拉框', hi: 'AI चिप के बगल का चरण चयन', es: 'Selector de pasos junto al chip IA',
    fr: 'Sélecteur d’horizon à côté de la puce IA', ru: 'Селектор горизонта рядом с чипом AI',
    tr: 'AI çipinin yanındaki ufuk seçici', ur: 'AI چپ کے ساتھ والا افق سلیکٹر',
    id: 'Pemilih horizon di samping chip AI', pt: 'Seletor de horizonte ao lado do chip IA'
  },
  'lab2.chartGuide.chapters.forecast.steps.limits.title': {
    zh: '何时不是模型', hi: 'कब यह मॉडल नहीं होता', es: 'Cuándo no es el modelo',
    fr: 'Quand ce n’est pas le modèle', ru: 'Когда это не модель', tr: 'Ne zaman model değil',
    ur: 'کب یہ ماڈل نہیں ہوتا', id: 'Kapan bukan model', pt: 'Quando não é o modelo'
  },
  'lab2.chartGuide.chapters.forecast.steps.limits.body': {
    zh: '如果服务器跑不了模型，它会用一条“基线”画法，并在卡片上写出模型名。看到 baseline 就说明这不是模型输出。',
    hi: 'अगर सर्वर मॉडल नहीं चला सकता, वह “बेसलाइन” तरीका इस्तेमाल करता है और कार्ड पर मॉडल नाम लिखता है। baseline दिखे तो यह मॉडल का आउटपुट नहीं है।',
    es: 'Si el servidor no puede ejecutar el modelo, usa un método “baseline” y escribe el nombre del modelo en la tarjeta. Si lees baseline, no es salida del modelo.',
    fr: 'Si le serveur ne peut pas exécuter le modèle, il emploie une méthode « baseline » et écrit le nom du modèle sur la carte. Si vous lisez baseline, ce n’est pas la sortie du modèle.',
    ru: 'Если сервер не может запустить модель, он использует «baseline» и пишет имя модели на карточке. Если видите baseline — это не выход модели.',
    tr: 'Sunucu modeli çalıştıramazsa bir “baseline” yöntemi kullanır ve kartta model adını yazar. baseline görüyorsanız bu model çıktısı değildir.',
    ur: 'اگر سرور ماڈل نہ چلا سکے تو ”بیس لائن“ طریقہ استعمال کرتا ہے اور کارڈ پر ماڈل کا نام لکھتا ہے۔ baseline دکھے تو یہ ماڈل کا آؤٹ پٹ نہیں۔',
    id: 'Jika server tidak bisa menjalankan model, ia memakai metode “baseline” dan menulis nama model di kartu. Melihat baseline berarti ini bukan keluaran model.',
    pt: 'Se o servidor não conseguir rodar o modelo, usa um método “baseline” e escreve o nome do modelo no cartão. Se ler baseline, não é saída do modelo.'
  },
  'lab2.chartGuide.chapters.forecast.steps.limits.where': {
    zh: '预测结果卡片顶部的模型名', hi: 'पूर्वानुमान कार्ड के ऊपर मॉडल नाम',
    es: 'El nombre del modelo en la tarjeta de pronóstico', fr: 'Le nom du modèle en haut de la carte de prévision',
    ru: 'Имя модели в шапке карточки прогноза', tr: 'Tahmin kartının başındaki model adı',
    ur: 'پیشگوئی کارڈ کے اوپر ماڈل کا نام', id: 'Nama model di atas kartu prakiraan',
    pt: 'O nome do modelo no topo do cartão de previsão'
  },
  'lab2.chartGuide.chapters.forecast.steps.notAdvice.title': {
    zh: '它不是建议', hi: 'यह सलाह नहीं है', es: 'No es un consejo', fr: 'Ce n’est pas un conseil',
    ru: 'Это не совет', tr: 'Bu bir tavsiye değil', ur: 'یہ مشورہ نہیں', id: 'Ini bukan saran', pt: 'Não é um conselho'
  },
  'lab2.chartGuide.chapters.forecast.steps.notAdvice.body': {
    zh: '预测是一条可能的路径，不是承诺。它由过去的K线生成，而过去不能保证未来。',
    hi: 'पूर्वानुमान एक संभावित रास्ता है, वादा नहीं। यह पिछले कैंडल से बनता है, और अतीत भविष्य की गारंटी नहीं।',
    es: 'Una previsión es un camino posible, no una promesa. Se genera con velas pasadas, y el pasado no garantiza el futuro.',
    fr: 'Une prévision est un chemin possible, pas une promesse. Elle est produite à partir de chandeliers passés, et le passé ne garantit pas l’avenir.',
    ru: 'Прогноз — возможный путь, а не обещание. Он строится по прошлым свечам, а прошлое не гарантирует будущее.',
    tr: 'Tahmin olası bir yoldur, vaat değil. Geçmiş mumlardan üretilir; geçmiş geleceği garanti etmez.',
    ur: 'پیشگوئی ایک ممکنہ راستہ ہے، وعدہ نہیں۔ یہ گزشتہ کینڈل سے بنتی ہے، اور ماضی مستقبل کی ضمانت نہیں۔',
    id: 'Prakiraan adalah jalur yang mungkin, bukan janji. Ia dihasilkan dari candle masa lalu, dan masa lalu tidak menjamin masa depan.',
    pt: 'Uma previsão é um caminho possível, não uma promessa. Ela é gerada a partir de candles passados, e o passado não garante o futuro.'
  },
  'lab2.chartGuide.chapters.forecast.steps.notAdvice.where': {
    zh: '整个应用：本指南不给出交易建议',
    hi: 'पूरे ऐप में: यह मार्गदर्शिका ट्रेड सलाह नहीं देती',
    es: 'En toda la app: esta guía no da consejo de operación',
    fr: 'Dans toute l’app : ce guide ne donne aucun conseil de trade',
    ru: 'Во всём приложении: этот гайд не даёт торговых советов',
    tr: 'Uygulamanın tamamında: bu rehber işlem tavsiyesi vermez',
    ur: 'پوری ایپ میں: یہ گائیڈ تجارتی مشورہ نہیں دیتی',
    id: 'Di seluruh aplikasi: panduan ini tidak memberi saran perdagangan',
    pt: 'Em todo o app: este guia não dá conselho de operação'
  },

  /* ── the Advanced doorway box ────────────────────────────────────────── */
  'lab2.cards.chartGuide.title': {
    zh: 'K线图指南',
    hi: 'कैंडल चार्ट गाइड',
    es: 'Guía de velas',
    fr: 'Guide des chandeliers',
    ru: 'Гайд по свечам',
    tr: 'Mum grafiği rehberi',
    ur: 'کینڈل چارٹ گائیڈ',
    id: 'Panduan candlestick',
    pt: 'Guia de candles'
  },
  'lab2.cards.chartGuide.sub': {
    zh: '逐根读懂K线：窗口、指标、价位和预测按钮。',
    hi: 'कैंडल दर कैंडल: विंडो, संकेतक, स्तर और पूर्वानुमान बटन।',
    es: 'De vela en vela: ventanas, indicadores, niveles y el botón de pronóstico.',
    fr: 'Chandelier par chandelier : fenêtres, indicateurs, niveaux et bouton de prévision.',
    ru: 'Свеча за свечой: окна, индикаторы, уровни и кнопка прогноза.',
    tr: 'Mum mum: pencereler, göstergeler, seviyeler ve tahmin düğmesi.',
    ur: 'ایک ایک کینڈل: ونڈوز، اشاریے، سطحیں اور پیشگوئی بٹن۔',
    id: 'Candle demi candle: jendela, indikator, level, dan tombol prakiraan.',
    pt: 'Candle a candle: janelas, indicadores, níveis e o botão de previsão.'
  },
  'lab2.advancedGuide.kicker': {
    zh: '先学再看', hi: 'देखने से पहले सीखें', es: 'Aprende antes de mirar', fr: 'Apprenez avant de regarder',
    ru: 'Сначала научитесь', tr: 'Bakmadan önce öğrenin', ur: 'دیکھنے سے پہلے سیکھیں',
    id: 'Belajar sebelum melihat', pt: 'Aprenda antes de olhar'
  },
  'lab2.advancedGuide.title': {
    zh: '这里用的图表，你真的会读吗？',
    hi: 'क्या आप यहाँ का चार्ट पढ़ सकते हैं?',
    es: '¿Sabes leer el gráfico que se usa aquí?',
    fr: 'Savez-vous lire le graphique utilisé ici ?',
    ru: 'Вы умеете читать график, который здесь используется?',
    tr: 'Burada kullanılan grafiği okuyabiliyor musunuz?',
    ur: 'کیا آپ یہاں استعمال ہونے والا چارٹ پڑھ سکتے ہیں؟',
    id: 'Sudah bisa membaca grafik yang dipakai di sini?',
    pt: 'Você sabe ler o gráfico usado aqui?'
  },
  'lab2.advancedGuide.body': {
    zh: '回测、秋千图和情景模拟都建立在K线图上。这个十分钟的动手指南用真实图表讲解每一部分，不用截图。',
    hi: 'बैकटेस्ट, व्हाट-इफ़ और परिदृश्य सब कैंडल चार्ट पर बने हैं। यह दस मिनट की व्यावहारिक मार्गदर्शिका असली चार्ट पर हर हिस्सा समझाती है, स्क्रीनशॉट पर नहीं।',
    es: 'Los backtests, el what-if y los escenarios se apoyan en el gráfico de velas. Esta guía práctica de diez minutos explica cada parte con el gráfico real, no con capturas.',
    fr: 'Les backtests, le what-if et les scénarios reposent sur le graphique en chandeliers. Ce guide pratique de dix minutes explique chaque partie sur le vrai graphique, pas sur des captures.',
    ru: 'Бэктесты, what-if и сценарии опираются на свечной график. Этот десятиминутный практический гайд объясняет каждую часть на настоящем графике, а не на скриншотах.',
    tr: 'Geri testler, what-if ve senaryolar mum grafiğine dayanır. Bu on dakikalık uygulamalı rehber her parçayı ekran görüntüsüyle değil, gerçek grafikle anlatır.',
    ur: 'بیک ٹیسٹ، واٹ اِف اور منظرنامے سب کینڈل چارٹ پر بنے ہیں۔ یہ دس منٹ کی عملی گائیڈ ہر حصہ اصل چارٹ پر سمجھاتی ہے، اسکرین شاٹ پر نہیں۔',
    id: 'Backtest, what-if, dan skenario semuanya berdiri di atas grafik candlestick. Panduan praktik sepuluh menit ini menjelaskan setiap bagian di grafik nyata, bukan tangkapan layar.',
    pt: 'Backtests, what-if e cenários se apoiam no gráfico de candles. Este guia prático de dez minutos explica cada parte no gráfico real, não em capturas.'
  },
  'lab2.advancedGuide.cta': {
    zh: '打开图表指南', hi: 'चार्ट गाइड खोलें', es: 'Abrir la guía del gráfico', fr: 'Ouvrir le guide du graphique',
    ru: 'Открыть гайд по графику', tr: 'Grafik rehberini aç', ur: 'چارٹ گائیڈ کھولیں',
    id: 'Buka panduan grafik', pt: 'Abrir o guia do gráfico'
  },
  'lab2.cards.chartGuide.hint': {
    zh: '互动练习，不是截图', hi: 'इंटरैक्टिव अभ्यास, स्क्रीनशॉट नहीं', es: 'Práctica interactiva, no capturas',
    fr: 'Essai interactif, pas des captures', ru: 'Живая практика, а не скриншоты',
    tr: 'Etkileşimli alıştırma, ekran görüntüsü değil', ur: 'تفاعلی مشق، اسکرین شاٹ نہیں',
    id: 'Latihan interaktif, bukan tangkapan layar', pt: 'Prática interativa, não capturas'
  },

  /* ── the percent field ───────────────────────────────────────────────── */
  'lab2.percent.clamped': {
    zh: '已限制在 {{min}}–{{max}}',
    hi: '{{min}}–{{max}} तक सीमित',
    es: 'Limitado a {{min}}–{{max}}',
    fr: 'Limité à {{min}}–{{max}}',
    ru: 'Ограничено до {{min}}–{{max}}',
    tr: '{{min}}–{{max}} aralığına çekildi',
    ur: '{{min}}–{{max}} تک محدود',
    id: 'Dibatasi ke {{min}}–{{max}}',
    pt: 'Limitado a {{min}}–{{max}}'
  },
  'lab2.percent.increase': {
    zh: '增加', hi: 'बढ़ाएँ', es: 'Aumentar', fr: 'Augmenter', ru: 'Увеличить',
    tr: 'Artır', ur: 'بڑھائیں', id: 'Naikkan', pt: 'Aumentar'
  },
  'lab2.percent.decrease': {
    zh: '减少', hi: 'घटाएँ', es: 'Disminuir', fr: 'Diminuer', ru: 'Уменьшить',
    tr: 'Azalt', ur: 'کم کریں', id: 'Turunkan', pt: 'Diminuir'
  }
};
