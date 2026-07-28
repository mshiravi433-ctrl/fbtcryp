/**
 * Shared UI chrome: navigation, common verbs, toasts, wallet, settings.
 *
 * These are the strings a user meets on literally every screen. If only one
 * part of the app is translated, it must be this part — an untranslated nav
 * bar makes the whole product feel broken in a way an untranslated legal
 * appendix does not.
 *
 * Format: `'dotted.key': { zh, hi, es, fr, ru, tr, ur, id, pt }`
 * English lives in en.json and is the fallback for anything omitted here.
 */
export default {
  /* ------------------------------- nav -------------------------------- */
  'nav.market': { zh: '市场', hi: 'बाज़ार', es: 'Mercado', fr: 'Marché', ru: 'Рынок', tr: 'Piyasa', ur: 'مارکیٹ', id: 'Pasar', pt: 'Mercado' },
  'nav.trade': { zh: '交易', hi: 'ट्रेड', es: 'Operar', fr: 'Trader', ru: 'Торговля', tr: 'İşlem', ur: 'ٹریڈ', id: 'Dagang', pt: 'Negociar' },
  'nav.swap': { zh: '兑换', hi: 'स्वैप', es: 'Intercambiar', fr: 'Échanger', ru: 'Обмен', tr: 'Takas', ur: 'سویپ', id: 'Tukar', pt: 'Trocar' },
  'nav.wallet': { zh: '钱包', hi: 'वॉलेट', es: 'Cartera', fr: 'Portefeuille', ru: 'Кошелёк', tr: 'Cüzdan', ur: 'والٹ', id: 'Dompet', pt: 'Carteira' },
  'nav.signals': { zh: '信号', hi: 'सिग्नल', es: 'Señales', fr: 'Signaux', ru: 'Сигналы', tr: 'Sinyaller', ur: 'سگنلز', id: 'Sinyal', pt: 'Sinais' },
  'nav.news': { zh: '新闻', hi: 'समाचार', es: 'Noticias', fr: 'Actualités', ru: 'Новости', tr: 'Haberler', ur: 'خبریں', id: 'Berita', pt: 'Notícias' },
  'nav.more': { zh: '更多', hi: 'और', es: 'Más', fr: 'Plus', ru: 'Ещё', tr: 'Daha', ur: 'مزید', id: 'Lainnya', pt: 'Mais' },
  'nav.settings': { zh: '设置', hi: 'सेटिंग्स', es: 'Ajustes', fr: 'Réglages', ru: 'Настройки', tr: 'Ayarlar', ur: 'ترتیبات', id: 'Pengaturan', pt: 'Definições' },
  'nav.help': { zh: '帮助', hi: 'सहायता', es: 'Ayuda', fr: 'Aide', ru: 'Помощь', tr: 'Yardım', ur: 'مدد', id: 'Bantuan', pt: 'Ajuda' },
  'nav.about': { zh: '关于', hi: 'हमारे बारे में', es: 'Acerca de', fr: 'À propos', ru: 'О нас', tr: 'Hakkında', ur: 'ہمارے بارے میں', id: 'Tentang', pt: 'Sobre' },
  'nav.invest': { zh: '投资', hi: 'निवेश', es: 'Invertir', fr: 'Investir', ru: 'Инвестиции', tr: 'Yatırım', ur: 'سرمایہ کاری', id: 'Investasi', pt: 'Investir' },
  'nav.earn': { zh: '赚取', hi: 'कमाएँ', es: 'Ganar', fr: 'Gagner', ru: 'Заработок', tr: 'Kazan', ur: 'کمائیں', id: 'Dapatkan', pt: 'Ganhar' },
  'nav.farm': { zh: '流动性', hi: 'फ़ार्म', es: 'Farming', fr: 'Farming', ru: 'Фарминг', tr: 'Çiftlik', ur: 'فارم', id: 'Farm', pt: 'Farming' },
  'nav.perp': { zh: '合约', hi: 'पर्प', es: 'Perpetuos', fr: 'Perpétuels', ru: 'Бессрочные', tr: 'Vadesiz', ur: 'پرپ', id: 'Perp', pt: 'Perpétuos' },
  'nav.predict': { zh: '预测', hi: 'भविष्यवाणी', es: 'Predecir', fr: 'Prédire', ru: 'Прогноз', tr: 'Tahmin', ur: 'پیش گوئی', id: 'Prediksi', pt: 'Prever' },
  'nav.stocks': { zh: '股票', hi: 'स्टॉक', es: 'Acciones', fr: 'Actions', ru: 'Акции', tr: 'Hisseler', ur: 'اسٹاکس', id: 'Saham', pt: 'Ações' },
  'nav.p2p': { zh: '点对点', hi: 'P2P', es: 'P2P', fr: 'P2P', ru: 'P2P', tr: 'P2P', ur: 'P2P', id: 'P2P', pt: 'P2P' },
  'nav.leaderboard': { zh: '排行榜', hi: 'रैंकिंग', es: 'Clasificación', fr: 'Classement', ru: 'Рейтинг', tr: 'Sıralama', ur: 'درجہ بندی', id: 'Peringkat', pt: 'Classificação' },
  'nav.docs': { zh: '文档', hi: 'दस्तावेज़', es: 'Guías', fr: 'Guides', ru: 'Документация', tr: 'Belgeler', ur: 'دستاویزات', id: 'Dokumen', pt: 'Documentos' },
  'nav.audit': { zh: '审计', hi: 'ऑडिट', es: 'Auditoría', fr: 'Audit', ru: 'Аудит', tr: 'Denetim', ur: 'آڈٹ', id: 'Audit', pt: 'Auditoria' },
  'nav.developers': { zh: '开发者', hi: 'डेवलपर', es: 'Desarrolladores', fr: 'Développeurs', ru: 'Разработчикам', tr: 'Geliştiriciler', ur: 'ڈویلپرز', id: 'Pengembang', pt: 'Programadores' },
  'nav.ecosystem': { zh: '生态', hi: 'इकोसिस्टम', es: 'Ecosistema', fr: 'Écosystème', ru: 'Экосистема', tr: 'Ekosistem', ur: 'ایکو سسٹم', id: 'Ekosistem', pt: 'Ecossistema' },
  'nav.business': { zh: '商务', hi: 'व्यवसाय', es: 'Negocios', fr: 'Entreprise', ru: 'Бизнес', tr: 'Kurumsal', ur: 'کاروبار', id: 'Bisnis', pt: 'Negócios' },
  'nav.play': { zh: '游戏', hi: 'गेम्स', es: 'Juegos', fr: 'Jeux', ru: 'Игры', tr: 'Oyunlar', ur: 'گیمز', id: 'Gim', pt: 'Jogos' },
  'nav.group.markets': { zh: '市场', hi: 'बाज़ार', es: 'Mercados', fr: 'Marchés', ru: 'Рынки', tr: 'Piyasalar', ur: 'مارکیٹس', id: 'Pasar', pt: 'Mercados' },
  'nav.group.earn': { zh: '赚取', hi: 'कमाएँ', es: 'Ganar', fr: 'Gagner', ru: 'Заработок', tr: 'Kazan', ur: 'کمائیں', id: 'Dapatkan', pt: 'Ganhar' },
  'nav.group.more': { zh: '更多', hi: 'और', es: 'Más', fr: 'Plus', ru: 'Ещё', tr: 'Daha', ur: 'مزید', id: 'Lainnya', pt: 'Mais' },

  /* ------------------------------ common ------------------------------ */
  'common.balance': { zh: '余额', hi: 'बैलेंस', es: 'Saldo', fr: 'Solde', ru: 'Баланс', tr: 'Bakiye', ur: 'بیلنس', id: 'Saldo', pt: 'Saldo' },
  'common.back': { zh: '返回', hi: 'वापस', es: 'Atrás', fr: 'Retour', ru: 'Назад', tr: 'Geri', ur: 'واپس', id: 'Kembali', pt: 'Voltar' },
  'common.cancel': { zh: '取消', hi: 'रद्द करें', es: 'Cancelar', fr: 'Annuler', ru: 'Отмена', tr: 'İptal', ur: 'منسوخ', id: 'Batal', pt: 'Cancelar' },
  'common.confirm': { zh: '确认', hi: 'पुष्टि करें', es: 'Confirmar', fr: 'Confirmer', ru: 'Подтвердить', tr: 'Onayla', ur: 'تصدیق', id: 'Konfirmasi', pt: 'Confirmar' },
  'common.copy': { zh: '复制', hi: 'कॉपी', es: 'Copiar', fr: 'Copier', ru: 'Копировать', tr: 'Kopyala', ur: 'کاپی', id: 'Salin', pt: 'Copiar' },
  'common.copied': { zh: '已复制', hi: 'कॉपी हो गया', es: 'Copiado', fr: 'Copié', ru: 'Скопировано', tr: 'Kopyalandı', ur: 'کاپی ہو گیا', id: 'Disalin', pt: 'Copiado' },
  'common.refresh': { zh: '刷新', hi: 'रिफ़्रेश', es: 'Actualizar', fr: 'Actualiser', ru: 'Обновить', tr: 'Yenile', ur: 'ریفریش', id: 'Segarkan', pt: 'Atualizar' },
  'common.days': { zh: '天', hi: 'दिन', es: 'días', fr: 'jours', ru: 'дн.', tr: 'gün', ur: 'دن', id: 'hari', pt: 'dias' },
  'common.loading': { zh: '加载中…', hi: 'लोड हो रहा है…', es: 'Cargando…', fr: 'Chargement…', ru: 'Загрузка…', tr: 'Yükleniyor…', ur: 'لوڈ ہو رہا ہے…', id: 'Memuat…', pt: 'A carregar…' },
  'common.done': { zh: '完成', hi: 'हो गया', es: 'Hecho', fr: 'Terminé', ru: 'Готово', tr: 'Tamam', ur: 'مکمل', id: 'Selesai', pt: 'Concluído' },
  'common.searching': { zh: '搜索中…', hi: 'खोज रहे हैं…', es: 'Buscando…', fr: 'Recherche…', ru: 'Поиск…', tr: 'Aranıyor…', ur: 'تلاش جاری…', id: 'Mencari…', pt: 'A pesquisar…' },
  'common.enable': { zh: '启用', hi: 'चालू करें', es: 'Activar', fr: 'Activer', ru: 'Включить', tr: 'Etkinleştir', ur: 'فعال کریں', id: 'Aktifkan', pt: 'Ativar' },
  'common.disable': { zh: '停用', hi: 'बंद करें', es: 'Desactivar', fr: 'Désactiver', ru: 'Выключить', tr: 'Devre dışı', ur: 'غیر فعال', id: 'Nonaktifkan', pt: 'Desativar' },
  'common.on': { zh: '开', hi: 'चालू', es: 'Activado', fr: 'Activé', ru: 'Вкл.', tr: 'Açık', ur: 'آن', id: 'Aktif', pt: 'Ligado' },
  'common.off': { zh: '关', hi: 'बंद', es: 'Desactivado', fr: 'Désactivé', ru: 'Выкл.', tr: 'Kapalı', ur: 'آف', id: 'Nonaktif', pt: 'Desligado' },
  'common.language': { zh: '语言', hi: 'भाषा', es: 'Idioma', fr: 'Langue', ru: 'Язык', tr: 'Dil', ur: 'زبان', id: 'Bahasa', pt: 'Idioma' },
  'common.tryAgain': { zh: '重试', hi: 'फिर कोशिश करें', es: 'Reintentar', fr: 'Réessayer', ru: 'Повторить', tr: 'Tekrar dene', ur: 'دوبارہ کوشش', id: 'Coba lagi', pt: 'Tentar de novo' },
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
  'common.offlineData': {
    zh: '无法连接实时行情，显示的是缓存快照。价格并非实时。',
    hi: 'लाइव फ़ीड उपलब्ध नहीं — कैश किया गया स्नैपशॉट दिख रहा है। कीमतें वास्तविक नहीं हैं।',
    es: 'Sin conexión en directo: se muestra una copia en caché. Los precios no son reales.',
    fr: 'Flux en direct indisponible : instantané en cache affiché. Les prix ne sont pas réels.',
    ru: 'Живой поток недоступен — показан кэш. Цены не актуальны.',
    tr: 'Canlı akış yok — önbellek gösteriliyor. Fiyatlar gerçek değil.',
    ur: 'لائیو فیڈ دستیاب نہیں — محفوظ اسنیپ شاٹ دکھایا جا رہا ہے۔ قیمتیں اصل نہیں ہیں۔',
    id: 'Umpan langsung tidak tersedia — menampilkan cadangan tersimpan. Harga tidak nyata.',
    pt: 'Fluxo ao vivo indisponível — a mostrar cópia em cache. Os preços não são reais.'
  },

  /* ------------------------------ toasts ------------------------------ */
  'toast.copied': { zh: '已复制到剪贴板', hi: 'क्लिपबोर्ड पर कॉपी हुआ', es: 'Copiado al portapapeles', fr: 'Copié dans le presse-papiers', ru: 'Скопировано в буфер', tr: 'Panoya kopyalandı', ur: 'کلپ بورڈ پر کاپی', id: 'Disalin ke papan klip', pt: 'Copiado para a área de transferência' },

  /* ------------------------------ wallet ------------------------------ */
  'wallet.connect': { zh: '连接钱包', hi: 'वॉलेट कनेक्ट करें', es: 'Conectar cartera', fr: 'Connecter le portefeuille', ru: 'Подключить кошелёк', tr: 'Cüzdan bağla', ur: 'والٹ منسلک کریں', id: 'Hubungkan dompet', pt: 'Ligar carteira' },
  'wallet.connecting': { zh: '连接中…', hi: 'कनेक्ट हो रहा है…', es: 'Conectando…', fr: 'Connexion…', ru: 'Подключение…', tr: 'Bağlanıyor…', ur: 'منسلک ہو رہا ہے…', id: 'Menghubungkan…', pt: 'A ligar…' },
  'wallet.disconnect': { zh: '断开连接', hi: 'डिस्कनेक्ट', es: 'Desconectar', fr: 'Déconnecter', ru: 'Отключить', tr: 'Bağlantıyı kes', ur: 'منقطع کریں', id: 'Putuskan', pt: 'Desligar' },
  'wallet.unlock': { zh: '解锁', hi: 'अनलॉक', es: 'Desbloquear', fr: 'Déverrouiller', ru: 'Разблокировать', tr: 'Kilidi aç', ur: 'انلاک', id: 'Buka kunci', pt: 'Desbloquear' },
  'wallet.wrongNetwork': { zh: '网络不正确', hi: 'ग़लत नेटवर्क', es: 'Red incorrecta', fr: 'Mauvais réseau', ru: 'Неверная сеть', tr: 'Yanlış ağ', ur: 'غلط نیٹ ورک', id: 'Jaringan salah', pt: 'Rede errada' },
  'wallet.netWorth': { zh: '总资产', hi: 'कुल संपत्ति', es: 'Patrimonio', fr: 'Valeur nette', ru: 'Всего активов', tr: 'Net değer', ur: 'کل مالیت', id: 'Total aset', pt: 'Património' },
  'wallet.holdings': { zh: '持仓', hi: 'होल्डिंग्स', es: 'Posiciones', fr: 'Avoirs', ru: 'Активы', tr: 'Varlıklar', ur: 'ہولڈنگز', id: 'Kepemilikan', pt: 'Participações' },
  'wallet.noHoldings': { zh: '暂无持仓', hi: 'अभी कोई होल्डिंग नहीं', es: 'Sin posiciones aún', fr: 'Aucun avoir', ru: 'Пока нет активов', tr: 'Henüz varlık yok', ur: 'ابھی کوئی ہولڈنگ نہیں', id: 'Belum ada aset', pt: 'Ainda sem participações' },
  'wallet.activity': { zh: '最近活动', hi: 'हाल की गतिविधि', es: 'Actividad reciente', fr: 'Activité récente', ru: 'Последние операции', tr: 'Son işlemler', ur: 'حالیہ سرگرمی', id: 'Aktivitas terbaru', pt: 'Atividade recente' },
  'wallet.custodyNotice': {
    zh: '只读。本应用没有任何充值地址，也绝不会要求你向任何地方转账。任何要求你转币的机器人都应视为诈骗。',
    hi: 'केवल पढ़ने के लिए। इस ऐप का कोई डिपॉज़िट पता नहीं है और यह कभी आपसे कहीं क्रिप्टो भेजने को नहीं कहेगा। ऐसा माँगने वाला कोई भी बॉट धोखाधड़ी है।',
    es: 'Solo lectura. Esta app no tiene dirección de depósito y nunca te pedirá enviar cripto a ningún sitio. Cualquier bot que lo pida es una estafa.',
    fr: 'Lecture seule. Cette app n\'a aucune adresse de dépôt et ne vous demandera jamais d\'envoyer des cryptos. Tout bot qui le demande est une arnaque.',
    ru: 'Только чтение. У приложения нет адреса для депозита и оно никогда не попросит куда-либо отправить криптовалюту. Любой бот с такой просьбой — мошенник.',
    tr: 'Salt okunur. Bu uygulamanın yatırma adresi yoktur ve sizden asla kripto göndermenizi istemez. İsteyen her bot dolandırıcıdır.',
    ur: 'صرف پڑھنے کے لیے۔ اس ایپ کا کوئی ڈپازٹ ایڈریس نہیں اور یہ کبھی آپ سے کرپٹو بھیجنے کو نہیں کہے گی۔ ایسا کہنے والا ہر بوٹ فراڈ ہے۔',
    id: 'Hanya baca. Aplikasi ini tidak punya alamat deposit dan tidak akan pernah meminta Anda mengirim kripto. Bot mana pun yang meminta adalah penipuan.',
    pt: 'Apenas leitura. Esta app não tem endereço de depósito e nunca lhe pedirá para enviar cripto. Qualquer bot que peça é uma fraude.'
  },

  /* ----------------------------- settings ----------------------------- */
  'settings.title': { zh: '设置', hi: 'सेटिंग्स', es: 'Ajustes', fr: 'Réglages', ru: 'Настройки', tr: 'Ayarlar', ur: 'ترتیبات', id: 'Pengaturan', pt: 'Definições' },
  'settings.profile': { zh: '个人资料', hi: 'प्रोफ़ाइल', es: 'Perfil', fr: 'Profil', ru: 'Профиль', tr: 'Profil', ur: 'پروفائل', id: 'Profil', pt: 'Perfil' },
  'settings.appearance': { zh: '外观', hi: 'दिखावट', es: 'Apariencia', fr: 'Apparence', ru: 'Оформление', tr: 'Görünüm', ur: 'ظاہری شکل', id: 'Tampilan', pt: 'Aparência' },
  'settings.trading': { zh: '交易', hi: 'ट्रेडिंग', es: 'Operaciones', fr: 'Trading', ru: 'Торговля', tr: 'İşlem', ur: 'ٹریڈنگ', id: 'Perdagangan', pt: 'Negociação' },
  'settings.security': { zh: '安全', hi: 'सुरक्षा', es: 'Seguridad', fr: 'Sécurité', ru: 'Безопасность', tr: 'Güvenlik', ur: 'سیکیورٹی', id: 'Keamanan', pt: 'Segurança' },
  'settings.networks': { zh: '网络', hi: 'नेटवर्क', es: 'Redes', fr: 'Réseaux', ru: 'Сети', tr: 'Ağlar', ur: 'نیٹ ورکس', id: 'Jaringan', pt: 'Redes' },
  'settings.company': { zh: '公司', hi: 'कंपनी', es: 'Empresa', fr: 'Société', ru: 'Компания', tr: 'Şirket', ur: 'کمپنی', id: 'Perusahaan', pt: 'Empresa' },
  'settings.language': { zh: '语言', hi: 'भाषा', es: 'Idioma', fr: 'Langue', ru: 'Язык', tr: 'Dil', ur: 'زبان', id: 'Bahasa', pt: 'Idioma' },
  'settings.wallet': { zh: '钱包', hi: 'वॉलेट', es: 'Cartera', fr: 'Portefeuille', ru: 'Кошелёк', tr: 'Cüzdan', ur: 'والٹ', id: 'Dompet', pt: 'Carteira' },
  'settings.noWallet': { zh: '未连接', hi: 'कनेक्ट नहीं है', es: 'Sin conectar', fr: 'Non connecté', ru: 'Не подключён', tr: 'Bağlı değil', ur: 'منسلک نہیں', id: 'Belum terhubung', pt: 'Não ligada' },
  'settings.theme': { zh: '主题', hi: 'थीम', es: 'Tema', fr: 'Thème', ru: 'Тема', tr: 'Tema', ur: 'تھیم', id: 'Tema', pt: 'Tema' },
  'settings.themeDark': { zh: '深色', hi: 'डार्क', es: 'Oscuro', fr: 'Sombre', ru: 'Тёмная', tr: 'Koyu', ur: 'ڈارک', id: 'Gelap', pt: 'Escuro' },
  'settings.themeLight': { zh: '浅色', hi: 'लाइट', es: 'Claro', fr: 'Clair', ru: 'Светлая', tr: 'Açık', ur: 'لائٹ', id: 'Terang', pt: 'Claro' },
  'settings.themeAuto': { zh: '自动', hi: 'ऑटो', es: 'Auto', fr: 'Auto', ru: 'Авто', tr: 'Otomatik', ur: 'خودکار', id: 'Otomatis', pt: 'Automático' },
  'settings.accent': { zh: '主色调', hi: 'एक्सेंट रंग', es: 'Color de acento', fr: 'Couleur d\'accent', ru: 'Акцентный цвет', tr: 'Vurgu rengi', ur: 'ایکسنٹ رنگ', id: 'Warna aksen', pt: 'Cor de destaque' },
  'settings.hideBalances': { zh: '隐藏余额', hi: 'बैलेंस छिपाएँ', es: 'Ocultar saldos', fr: 'Masquer les soldes', ru: 'Скрыть балансы', tr: 'Bakiyeleri gizle', ur: 'بیلنس چھپائیں', id: 'Sembunyikan saldo', pt: 'Ocultar saldos' },
  'settings.reduceMotion': { zh: '减弱动效', hi: 'एनिमेशन कम करें', es: 'Reducir animaciones', fr: 'Réduire les animations', ru: 'Меньше анимации', tr: 'Hareketi azalt', ur: 'اینیمیشن کم کریں', id: 'Kurangi animasi', pt: 'Reduzir animações' },
  'settings.compactMode': { zh: '紧凑模式', hi: 'कॉम्पैक्ट मोड', es: 'Modo compacto', fr: 'Mode compact', ru: 'Компактный режим', tr: 'Sıkışık mod', ur: 'کمپیکٹ موڈ', id: 'Mode ringkas', pt: 'Modo compacto' },
  'settings.defaultSlippage': { zh: '默认滑点', hi: 'डिफ़ॉल्ट स्लिपेज', es: 'Deslizamiento por defecto', fr: 'Slippage par défaut', ru: 'Проскальзывание по умолчанию', tr: 'Varsayılan kayma', ur: 'ڈیفالٹ سلپیج', id: 'Slippage bawaan', pt: 'Derrapagem padrão' },

  /* ------------------------------ profile ----------------------------- */
  'profile.username': { zh: '显示名称', hi: 'प्रदर्शित नाम', es: 'Nombre visible', fr: 'Nom affiché', ru: 'Отображаемое имя', tr: 'Görünen ad', ur: 'ظاہری نام', id: 'Nama tampilan', pt: 'Nome de exibição' },
  'profile.usernameLabel': { zh: '显示名称（可选）', hi: 'प्रदर्शित नाम (वैकल्पिक)', es: 'Nombre visible (opcional)', fr: 'Nom affiché (facultatif)', ru: 'Отображаемое имя (необязательно)', tr: 'Görünen ad (isteğe bağlı)', ur: 'ظاہری نام (اختیاری)', id: 'Nama tampilan (opsional)', pt: 'Nome de exibição (opcional)' },
  'profile.usernamePlaceholder': { zh: '例如：小明', hi: 'जैसे: आरव', es: 'p. ej. Ana', fr: 'ex. Marie', ru: 'напр. Иван', tr: 'örn. Ayşe', ur: 'مثلاً: علی', id: 'mis. Budi', pt: 'ex. João' },
  'profile.usernameUnset': { zh: '未设置', hi: 'सेट नहीं', es: 'Sin definir', fr: 'Non défini', ru: 'Не задано', tr: 'Ayarlanmadı', ur: 'مقرر نہیں', id: 'Belum diatur', pt: 'Não definido' },
  'profile.username_tooShort': { zh: '至少 2 个字符。', hi: 'कम से कम 2 अक्षर।', es: 'Al menos 2 caracteres.', fr: 'Au moins 2 caractères.', ru: 'Минимум 2 символа.', tr: 'En az 2 karakter.', ur: 'کم از کم ٢ حروف۔', id: 'Minimal 2 karakter.', pt: 'Pelo menos 2 caracteres.' },
  'profile.usernameHelp': {
    zh: '这是排行榜上显示在你分数旁边的名字。它不是账户，没有密码，也不会被保留——只是一个昵称。你在这里的真实身份是你的钱包地址。',
    hi: 'यह नाम लीडरबोर्ड पर आपके स्कोर के साथ दिखेगा। यह कोई खाता नहीं है, इसका पासवर्ड नहीं है और यह आरक्षित नहीं होता — बस एक उपनाम। यहाँ आपकी असली पहचान आपका वॉलेट पता है।',
    es: 'Es el nombre que aparece junto a tu puntuación en la clasificación. No es una cuenta, no tiene contraseña y no se reserva: solo un apodo. Tu identidad real aquí es tu dirección de cartera.',
    fr: 'C\'est le nom affiché à côté de votre score au classement. Ce n\'est pas un compte, il n\'a pas de mot de passe et rien n\'est réservé — juste un pseudo. Votre véritable identité ici est votre adresse de portefeuille.',
    ru: 'Это имя показывается рядом с вашим счётом в рейтинге. Это не аккаунт, у него нет пароля и оно не резервируется — просто псевдоним. Ваша настоящая личность здесь — адрес кошелька.',
    tr: 'Bu, sıralamada puanınızın yanında görünen addır. Hesap değildir, parolası yoktur ve rezerve edilmez — sadece bir takma ad. Buradaki gerçek kimliğiniz cüzdan adresinizdir.',
    ur: 'یہ نام لیڈر بورڈ پر آپ کے اسکور کے ساتھ دکھایا جاتا ہے۔ یہ اکاؤنٹ نہیں، اس کا پاس ورڈ نہیں اور یہ محفوظ نہیں ہوتا — صرف ایک عرفی نام۔ یہاں آپ کی اصل شناخت آپ کا والٹ ایڈریس ہے۔',
    id: 'Ini nama yang tampil di sebelah skor Anda di papan peringkat. Bukan akun, tanpa kata sandi, dan tidak dipesan — hanya julukan. Identitas asli Anda di sini adalah alamat dompet.',
    pt: 'É o nome mostrado ao lado da sua pontuação na classificação. Não é uma conta, não tem palavra-passe e nada fica reservado — apenas uma alcunha. A sua identidade real aqui é o endereço da carteira.'
  }
};
