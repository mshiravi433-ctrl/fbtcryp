/**
 * Wallet, toasts, trade and the seed-phrase safety copy.
 *
 * The wallet screen is where the money actually is, so this file gets the same
 * hand-written treatment as the warnings in product.mjs. Two rules I held to:
 *
 *  - Seed-phrase copy is translated in full, never abbreviated. If someone can
 *    only read Turkish, the sentence explaining that losing 12 words means
 *    losing everything has to be in Turkish, not politely summarised.
 *  - Where a phrase has a settled local convention, I used it rather than a
 *    literal translation ("عبارت بازیابی" not a calque of "seed phrase").
 */
export default {
  /* ------------------------------- toasts ----------------------------- */
  'toast.insufficientBalance': { zh: '余额不足', hi: 'बैलेंस पर्याप्त नहीं', es: 'Saldo insuficiente', fr: 'Solde insuffisant', ru: 'Недостаточно средств', tr: 'Yetersiz bakiye', ur: 'ناکافی بیلنس', id: 'Saldo tidak cukup', pt: 'Saldo insuficiente' },
  'toast.insufficientPosition': { zh: '该资产数量不足', hi: 'उस एसेट की मात्रा कम है', es: 'No tienes suficiente de ese activo', fr: 'Pas assez de cet actif', ru: 'Недостаточно этого актива', tr: 'Bu varlıktan yeterli yok', ur: 'اس اثاثے کی مقدار کم ہے', id: 'Aset tersebut tidak cukup', pt: 'Não tem esse ativo suficiente' },
  'toast.buyFilled': { zh: '买单已成交', hi: 'खरीद ऑर्डर पूरा', es: 'Orden de compra ejecutada', fr: 'Ordre d\'achat exécuté', ru: 'Ордер на покупку исполнен', tr: 'Alış emri gerçekleşti', ur: 'خرید آرڈر مکمل', id: 'Order beli terisi', pt: 'Ordem de compra executada' },
  'toast.sellFilled': { zh: '卖单已成交', hi: 'बिक्री ऑर्डर पूरा', es: 'Orden de venta ejecutada', fr: 'Ordre de vente exécuté', ru: 'Ордер на продажу исполнен', tr: 'Satış emri gerçekleşti', ur: 'فروخت آرڈر مکمل', id: 'Order jual terisi', pt: 'Ordem de venda executada' },
  'toast.investmentOpened': { zh: '计划已开启', hi: 'प्लान शुरू हुआ', es: 'Plan abierto', fr: 'Plan ouvert', ru: 'План открыт', tr: 'Plan açıldı', ur: 'پلان کھل گیا', id: 'Rencana dibuka', pt: 'Plano aberto' },
  'toast.investmentClaimed': { zh: '计划已领取', hi: 'प्लान क्लेम हुआ', es: 'Plan reclamado', fr: 'Plan réclamé', ru: 'План получен', tr: 'Plan alındı', ur: 'پلان وصول', id: 'Rencana diklaim', pt: 'Plano reclamado' },
  'toast.investmentEarlyExit': { zh: '提前退出 — 已扣罚金', hi: 'जल्दी निकासी — जुर्माना लगा', es: 'Salida anticipada: penalización aplicada', fr: 'Sortie anticipée — pénalité appliquée', ru: 'Досрочный выход — штраф применён', tr: 'Erken çıkış — ceza uygulandı', ur: 'قبل از وقت اخراج — جرمانہ لاگو', id: 'Keluar lebih awal — kena penalti', pt: 'Saída antecipada — penalização aplicada' },
  'toast.dailyClaimed': { zh: '每日奖励已领取', hi: 'दैनिक इनाम मिला', es: 'Recompensa diaria reclamada', fr: 'Récompense quotidienne réclamée', ru: 'Ежедневная награда получена', tr: 'Günlük ödül alındı', ur: 'روزانہ انعام وصول', id: 'Hadiah harian diklaim', pt: 'Recompensa diária reclamada' },
  'toast.claimTooSoon': { zh: '已领取过 — 请稍后再试', hi: 'पहले ही लिया — बाद में कोशिश करें', es: 'Ya reclamado: inténtalo más tarde', fr: 'Déjà réclamé — réessayez plus tard', ru: 'Уже получено — попробуйте позже', tr: 'Zaten alındı — sonra deneyin', ur: 'پہلے ہی وصول — بعد میں کوشش کریں', id: 'Sudah diklaim — coba lagi nanti', pt: 'Já reclamado — tente mais tarde' },
  'toast.questReward': { zh: '任务奖励已到账', hi: 'क्वेस्ट इनाम जुड़ा', es: 'Recompensa de misión añadida', fr: 'Récompense de quête ajoutée', ru: 'Награда за задание начислена', tr: 'Görev ödülü eklendi', ur: 'کویسٹ انعام شامل', id: 'Hadiah misi ditambahkan', pt: 'Recompensa de missão adicionada' },
  'toast.predictionPlaced': { zh: '预测已提交', hi: 'भविष्यवाणी दर्ज', es: 'Predicción registrada', fr: 'Prédiction enregistrée', ru: 'Прогноз принят', tr: 'Tahmin kaydedildi', ur: 'پیش گوئی درج', id: 'Prediksi dikirim', pt: 'Previsão registada' },
  'toast.linkCopied': { zh: '邀请链接已复制', hi: 'इनवाइट लिंक कॉपी हुआ', es: 'Enlace de invitación copiado', fr: 'Lien d\'invitation copié', ru: 'Ссылка-приглашение скопирована', tr: 'Davet bağlantısı kopyalandı', ur: 'دعوتی لنک کاپی', id: 'Tautan undangan disalin', pt: 'Link de convite copiado' },
  'toast.handleCopied': { zh: '用户名已复制', hi: 'हैंडल कॉपी हुआ', es: 'Usuario copiado', fr: 'Identifiant copié', ru: 'Имя скопировано', tr: 'Kullanıcı adı kopyalandı', ur: 'ہینڈل کاپی', id: 'Nama disalin', pt: 'Utilizador copiado' },
  'toast.addressCopied': { zh: '地址已复制', hi: 'पता कॉपी हुआ', es: 'Dirección copiada', fr: 'Adresse copiée', ru: 'Адрес скопирован', tr: 'Adres kopyalandı', ur: 'ایڈریس کاپی', id: 'Alamat disalin', pt: 'Endereço copiado' },
  'toast.pointsEarned': { zh: '获得积分', hi: 'अंक मिले', es: 'Puntos ganados', fr: 'Points gagnés', ru: 'Очки начислены', tr: 'Puan kazanıldı', ur: 'پوائنٹس ملے', id: 'Poin didapat', pt: 'Pontos ganhos' },

  /* ------------------------------- wallet ----------------------------- */
  'wallet.guest': { zh: '访客', hi: 'अतिथि', es: 'Invitado', fr: 'Invité', ru: 'Гость', tr: 'Misafir', ur: 'مہمان', id: 'Tamu', pt: 'Convidado' },
  'wallet.localSession': { zh: '本地会话', hi: 'लोकल सेशन', es: 'Sesión local', fr: 'Session locale', ru: 'Локальная сессия', tr: 'Yerel oturum', ur: 'مقامی سیشن', id: 'Sesi lokal', pt: 'Sessão local' },
  'wallet.allTime': { zh: '累计', hi: 'कुल समय', es: 'histórico', fr: 'depuis le début', ru: 'за всё время', tr: 'tüm zamanlar', ur: 'مجموعی', id: 'sepanjang waktu', pt: 'desde sempre' },
  'wallet.allocation': { zh: '资产分布', hi: 'आवंटन', es: 'Distribución', fr: 'Répartition', ru: 'Распределение', tr: 'Dağılım', ur: 'تقسیم', id: 'Alokasi', pt: 'Distribuição' },
  'wallet.cash': { zh: '现金', hi: 'नकद', es: 'Efectivo', fr: 'Liquidités', ru: 'Наличные', tr: 'Nakit', ur: 'نقد', id: 'Tunai', pt: 'Numerário' },
  'wallet.positions': { zh: '持仓', hi: 'पोज़िशन', es: 'Posiciones', fr: 'Positions', ru: 'Позиции', tr: 'Pozisyonlar', ur: 'پوزیشنز', id: 'Posisi', pt: 'Posições' },
  'wallet.staked': { zh: '质押中', hi: 'स्टेक किया', es: 'En staking', fr: 'En staking', ru: 'В стейкинге', tr: 'Stake edildi', ur: 'اسٹیک شدہ', id: 'Di-stake', pt: 'Em staking' },
  'wallet.startTrading': { zh: '开始交易', hi: 'ट्रेडिंग शुरू करें', es: 'Empezar a operar', fr: 'Commencer à trader', ru: 'Начать торговлю', tr: 'İşleme başla', ur: 'ٹریڈنگ شروع کریں', id: 'Mulai berdagang', pt: 'Começar a negociar' },
  'wallet.stats': { zh: '统计', hi: 'आँकड़े', es: 'Estadísticas', fr: 'Statistiques', ru: 'Статистика', tr: 'İstatistikler', ur: 'اعداد و شمار', id: 'Statistik', pt: 'Estatísticas' },
  'wallet.trades': { zh: '交易数', hi: 'ट्रेड', es: 'Operaciones', fr: 'Transactions', ru: 'Сделки', tr: 'İşlemler', ur: 'ٹریڈز', id: 'Transaksi', pt: 'Negociações' },
  'wallet.winRate': { zh: '胜率', hi: 'जीत दर', es: 'Tasa de acierto', fr: 'Taux de réussite', ru: 'Доля выигрышей', tr: 'Kazanma oranı', ur: 'کامیابی کی شرح', id: 'Tingkat menang', pt: 'Taxa de acerto' },
  'wallet.plans': { zh: '计划', hi: 'प्लान', es: 'Planes', fr: 'Plans', ru: 'Планы', tr: 'Planlar', ur: 'پلانز', id: 'Rencana', pt: 'Planos' },
  'wallet.onchain': { zh: '链上钱包', hi: 'ऑन-चेन वॉलेट', es: 'Cartera on-chain', fr: 'Portefeuille on-chain', ru: 'Ончейн-кошелёк', tr: 'Zincir üstü cüzdan', ur: 'آن چین والٹ', id: 'Dompet on-chain', pt: 'Carteira on-chain' },
  'wallet.settings': { zh: '设置', hi: 'सेटिंग्स', es: 'Ajustes', fr: 'Réglages', ru: 'Настройки', tr: 'Ayarlar', ur: 'ترتیبات', id: 'Pengaturan', pt: 'Definições' },
  'wallet.resetAccount': { zh: '重置账户', hi: 'खाता रीसेट करें', es: 'Restablecer cuenta', fr: 'Réinitialiser le compte', ru: 'Сбросить аккаунт', tr: 'Hesabı sıfırla', ur: 'اکاؤنٹ ری سیٹ', id: 'Atur ulang akun', pt: 'Repor conta' },
  'wallet.connectTitle': { zh: '连接钱包', hi: 'वॉलेट कनेक्ट करें', es: 'Conectar una cartera', fr: 'Connecter un portefeuille', ru: 'Подключить кошелёк', tr: 'Bir cüzdan bağla', ur: 'والٹ منسلک کریں', id: 'Hubungkan dompet', pt: 'Ligar uma carteira' },
  'wallet.connectSubtitle': { zh: '密钥始终由你保管，本应用永远看不到。', hi: 'चाबियाँ आपके पास रहती हैं। यह ऐप उन्हें कभी नहीं देखता।', es: 'Tus claves siguen siendo tuyas. Esta app nunca las ve.', fr: 'Vous gardez vos clés. Cette app ne les voit jamais.', ru: 'Ключи остаются у вас. Приложение их не видит.', tr: 'Anahtarlarınız sizde kalır. Bu uygulama onları asla görmez.', ur: 'چابیاں آپ کے پاس رہتی ہیں۔ یہ ایپ انہیں کبھی نہیں دیکھتی۔', id: 'Kunci tetap milik Anda. Aplikasi ini tidak pernah melihatnya.', pt: 'As chaves continuam suas. Esta app nunca as vê.' },
  'wallet.wcDesc': { zh: 'MetaMask、Trust、Rainbow… 通过二维码或深链接', hi: 'MetaMask, Trust, Rainbow… QR या डीप लिंक से', es: 'MetaMask, Trust, Rainbow… por QR o enlace directo', fr: 'MetaMask, Trust, Rainbow… par QR ou lien direct', ru: 'MetaMask, Trust, Rainbow… через QR или deep link', tr: 'MetaMask, Trust, Rainbow… QR veya bağlantı ile', ur: 'MetaMask، Trust، Rainbow… QR یا ڈیپ لنک سے', id: 'MetaMask, Trust, Rainbow… lewat QR atau deep link', pt: 'MetaMask, Trust, Rainbow… por QR ou link direto' },
  'wallet.recommended': { zh: '最安全', hi: 'सबसे सुरक्षित', es: 'Más seguro', fr: 'Le plus sûr', ru: 'Безопаснее всего', tr: 'En güvenli', ur: 'سب سے محفوظ', id: 'Paling aman', pt: 'Mais seguro' },
  'wallet.injected': { zh: '浏览器钱包', hi: 'ब्राउज़र वॉलेट', es: 'Cartera del navegador', fr: 'Portefeuille du navigateur', ru: 'Кошелёк браузера', tr: 'Tarayıcı cüzdanı', ur: 'براؤزر والٹ', id: 'Dompet peramban', pt: 'Carteira do navegador' },
  'wallet.injectedDesc': { zh: '使用注入此浏览器的钱包', hi: 'इस ब्राउज़र में मौजूद वॉलेट इस्तेमाल करें', es: 'Usa la cartera inyectada en este navegador', fr: 'Utiliser le portefeuille injecté dans ce navigateur', ru: 'Использовать кошелёк, встроенный в браузер', tr: 'Bu tarayıcıya enjekte edilmiş cüzdanı kullan', ur: 'اس براؤزر میں موجود والٹ استعمال کریں', id: 'Gunakan dompet di peramban ini', pt: 'Usar a carteira injetada neste navegador' },
  'wallet.createLocal': { zh: '创建应用内钱包', hi: 'ऐप में वॉलेट बनाएँ', es: 'Crear cartera en la app', fr: 'Créer un portefeuille dans l\'app', ru: 'Создать кошелёк в приложении', tr: 'Uygulama içi cüzdan oluştur', ur: 'ایپ میں والٹ بنائیں', id: 'Buat dompet dalam aplikasi', pt: 'Criar carteira na app' },
  'wallet.createLocalDesc': { zh: '新的 12 词钱包，在本机加密存储', hi: 'नया 12-शब्द वॉलेट, इसी डिवाइस पर एन्क्रिप्टेड', es: 'Nueva cartera de 12 palabras, cifrada en este dispositivo', fr: 'Nouveau portefeuille de 12 mots, chiffré sur cet appareil', ru: 'Новый кошелёк из 12 слов, зашифрован на устройстве', tr: 'Yeni 12 kelimelik cüzdan, bu cihazda şifreli', ur: 'نیا ١٢ الفاظ والا والٹ، اسی آلے پر خفیہ', id: 'Dompet 12 kata baru, terenkripsi di perangkat ini', pt: 'Nova carteira de 12 palavras, cifrada neste dispositivo' },
  'wallet.importLocal': { zh: '导入助记词', hi: 'सीड फ़्रेज़ इम्पोर्ट करें', es: 'Importar frase semilla', fr: 'Importer une phrase de récupération', ru: 'Импортировать seed-фразу', tr: 'Kurtarma ifadesini içe aktar', ur: 'ریکوری فقرہ درآمد کریں', id: 'Impor frasa pemulihan', pt: 'Importar frase de recuperação' },
  'wallet.importLocalDesc': { zh: '恢复已有的 12/24 词钱包', hi: 'मौजूदा 12/24-शब्द वॉलेट बहाल करें', es: 'Restaurar una cartera de 12/24 palabras', fr: 'Restaurer un portefeuille de 12/24 mots', ru: 'Восстановить кошелёк из 12/24 слов', tr: 'Mevcut 12/24 kelimelik cüzdanı geri yükle', ur: 'موجودہ ١٢/٢٤ الفاظ والا والٹ بحال کریں', id: 'Pulihkan dompet 12/24 kata', pt: 'Restaurar uma carteira de 12/24 palavras' },
  'wallet.unlockLocal': { zh: '解锁应用内钱包', hi: 'ऐप वॉलेट अनलॉक करें', es: 'Desbloquear cartera de la app', fr: 'Déverrouiller le portefeuille', ru: 'Разблокировать кошелёк', tr: 'Uygulama cüzdanını aç', ur: 'ایپ والٹ انلاک کریں', id: 'Buka kunci dompet aplikasi', pt: 'Desbloquear carteira da app' },
  'wallet.unlockLocalDesc': { zh: '输入密码以签名交易', hi: 'ट्रांज़ैक्शन साइन करने के लिए पासवर्ड डालें', es: 'Introduce tu contraseña para firmar transacciones', fr: 'Saisissez votre mot de passe pour signer', ru: 'Введите пароль для подписи транзакций', tr: 'İşlemleri imzalamak için parolanızı girin', ur: 'ٹرانزیکشن سائن کرنے کے لیے پاس ورڈ درج کریں', id: 'Masukkan kata sandi untuk menandatangani', pt: 'Introduza a palavra-passe para assinar' },
  'wallet.backupTitle': { zh: '备份你的助记词', hi: 'अपना सीड फ़्रेज़ बैकअप करें', es: 'Guarda tu frase semilla', fr: 'Sauvegardez votre phrase de récupération', ru: 'Сохраните seed-фразу', tr: 'Kurtarma ifadenizi yedekleyin', ur: 'اپنا ریکوری فقرہ محفوظ کریں', id: 'Cadangkan frasa pemulihan', pt: 'Faça cópia da frase de recuperação' },

  /* --- Safety-critical: translated in full, never abbreviated --------- */
  'wallet.backupWarning': {
    zh: '请把这 12 个词按顺序抄在纸上，离线保存。拥有这串词的人就永久拥有你的资产。一旦丢失，没有任何人能找回——我们不能，Telegram 也不能。永远不要把它输入任何网站或发送给任何人。',
    hi: 'इन 12 शब्दों को क्रम से काग़ज़ पर लिखें और ऑफ़लाइन रखें। जिसके पास यह फ़्रेज़ है, आपके फंड हमेशा के लिए उसके हैं। खो जाने पर कोई भी इसे वापस नहीं ला सकता — न हम, न Telegram। इसे कभी किसी वेबसाइट पर न लिखें और किसी को न भेजें।',
    es: 'Escribe estas 12 palabras en papel, en orden, y guárdalas sin conexión. Quien tenga esta frase es dueño de tus fondos para siempre. Si la pierdes, nadie puede recuperarla: ni nosotros, ni Telegram. Nunca la escribas en ninguna web ni se la envíes a nadie.',
    fr: 'Notez ces 12 mots sur papier, dans l\'ordre, et conservez-les hors ligne. Quiconque possède cette phrase possède vos fonds, définitivement. Si vous la perdez, personne ne peut la récupérer — ni nous, ni Telegram. Ne la saisissez jamais sur un site et ne l\'envoyez à personne.',
    ru: 'Запишите эти 12 слов на бумаге по порядку и храните офлайн. Тот, у кого есть эта фраза, владеет вашими средствами навсегда. Если вы её потеряете, восстановить не сможет никто — ни мы, ни Telegram. Никогда не вводите её на сайтах и никому не отправляйте.',
    tr: 'Bu 12 kelimeyi sırasıyla kâğıda yazın ve çevrimdışı saklayın. Bu ifadeye sahip olan kişi paranıza kalıcı olarak sahip olur. Kaybederseniz kimse geri getiremez — ne biz ne Telegram. Asla bir siteye yazmayın, kimseye göndermeyin.',
    ur: 'ان ١٢ الفاظ کو ترتیب سے کاغذ پر لکھیں اور آف لائن محفوظ رکھیں۔ جس کے پاس یہ فقرہ ہو وہ ہمیشہ کے لیے آپ کے فنڈز کا مالک ہے۔ کھو جانے پر کوئی واپس نہیں لا سکتا — نہ ہم، نہ ٹیلیگرام۔ اسے کبھی کسی ویب سائٹ پر نہ لکھیں اور کسی کو نہ بھیجیں۔',
    id: 'Tulis 12 kata ini di kertas, sesuai urutan, dan simpan offline. Siapa pun yang memiliki frasa ini memiliki dana Anda selamanya. Jika hilang, tidak ada yang bisa memulihkannya — kami tidak, Telegram tidak. Jangan pernah mengetiknya di situs mana pun atau mengirimkannya ke siapa pun.',
    pt: 'Escreva estas 12 palavras em papel, por ordem, e guarde-as offline. Quem tiver esta frase é dono dos seus fundos para sempre. Se a perder, ninguém a pode recuperar — nem nós, nem o Telegram. Nunca a escreva num site nem a envie a ninguém.'
  },
  'wallet.localRisk': {
    zh: '应用内钱包把加密后的私钥存在 Telegram WebView 里——没有安全隔区，也没有硬件隔离。放小额可以，但任何你会心疼的金额都应该放在 MetaMask/Trust（通过 WalletConnect）或硬件钱包里。',
    hi: 'ऐप वॉलेट एन्क्रिप्टेड कुंजी Telegram WebView में रखता है — न सिक्योर एन्क्लेव, न हार्डवेयर आइसोलेशन। छोटी रकम के लिए ठीक है, पर जो रकम खोने पर आपको दुख हो वह MetaMask/Trust (WalletConnect) या हार्डवेयर वॉलेट में रखें।',
    es: 'La cartera integrada guarda una clave cifrada dentro de un WebView de Telegram: sin enclave seguro ni aislamiento por hardware. Está bien para cantidades pequeñas, pero cualquier cantidad que te dolería perder debe estar en MetaMask/Trust vía WalletConnect, o en una cartera hardware.',
    fr: 'Le portefeuille intégré stocke une clé chiffrée dans une WebView Telegram : ni enclave sécurisée, ni isolation matérielle. Acceptable pour de petits montants, mais tout ce que vous seriez triste de perdre doit aller sur MetaMask/Trust via WalletConnect, ou un portefeuille matériel.',
    ru: 'Встроенный кошелёк хранит зашифрованный ключ внутри Telegram WebView — без защищённого анклава и аппаратной изоляции. Для небольших сумм это нормально, но всё, что жалко потерять, держите в MetaMask/Trust через WalletConnect или на аппаратном кошельке.',
    tr: 'Uygulama içi cüzdan, şifreli anahtarı bir Telegram WebView içinde saklar — güvenli bölge yok, donanım yalıtımı yok. Küçük tutarlar için uygundur; kaybetmeye üzüleceğiniz her tutar WalletConnect ile MetaMask/Trust\'ta veya donanım cüzdanında olmalıdır.',
    ur: 'ایپ والٹ خفیہ کلید ٹیلیگرام WebView میں رکھتا ہے — نہ سیکیور اینکلیو، نہ ہارڈویئر تنہائی۔ چھوٹی رقم کے لیے ٹھیک ہے، مگر جو رقم کھونا تکلیف دے وہ WalletConnect کے ذریعے MetaMask/Trust یا ہارڈویئر والٹ میں رکھیں۔',
    id: 'Dompet dalam aplikasi menyimpan kunci terenkripsi di dalam WebView Telegram — tanpa secure enclave, tanpa isolasi perangkat keras. Cukup untuk jumlah kecil, tetapi apa pun yang sayang hilang sebaiknya di MetaMask/Trust lewat WalletConnect, atau dompet perangkat keras.',
    pt: 'A carteira integrada guarda uma chave cifrada dentro de uma WebView do Telegram — sem enclave seguro nem isolamento por hardware. Serve para quantias pequenas, mas tudo o que lhe custaria perder deve estar no MetaMask/Trust via WalletConnect, ou numa carteira de hardware.'
  },
  'wallet.noProvider': {
    zh: '未检测到浏览器钱包。Telegram 内置浏览器没有钱包插件——请改用 WalletConnect 或应用内钱包。',
    hi: 'कोई ब्राउज़र वॉलेट नहीं मिला। Telegram के इन-ऐप ब्राउज़र में वॉलेट नहीं होता — WalletConnect या ऐप वॉलेट इस्तेमाल करें।',
    es: 'No se detectó ninguna cartera del navegador. El navegador interno de Telegram no tiene una: usa WalletConnect o la cartera de la app.',
    fr: 'Aucun portefeuille détecté dans le navigateur. Le navigateur intégré de Telegram n\'en a pas — utilisez WalletConnect ou le portefeuille de l\'app.',
    ru: 'Кошелёк в браузере не найден. Во встроенном браузере Telegram его нет — используйте WalletConnect или кошелёк приложения.',
    tr: 'Tarayıcıda cüzdan bulunamadı. Telegram\'ın dahili tarayıcısında cüzdan yoktur — WalletConnect veya uygulama cüzdanını kullanın.',
    ur: 'براؤزر میں کوئی والٹ نہیں ملا۔ ٹیلیگرام کے اندرونی براؤزر میں والٹ نہیں ہوتا — WalletConnect یا ایپ والٹ استعمال کریں۔',
    id: 'Tidak ada dompet peramban. Peramban dalam Telegram tidak punya — gunakan WalletConnect atau dompet aplikasi.',
    pt: 'Nenhuma carteira detetada no navegador. O navegador interno do Telegram não tem — use WalletConnect ou a carteira da app.'
  },
  'wallet.connectFailed': { zh: '连接失败或被拒绝。', hi: 'कनेक्शन विफल या अस्वीकृत।', es: 'La conexión falló o fue rechazada.', fr: 'Connexion échouée ou refusée.', ru: 'Подключение не удалось или было отклонено.', tr: 'Bağlantı başarısız oldu veya reddedildi.', ur: 'کنکشن ناکام یا مسترد۔', id: 'Koneksi gagal atau ditolak.', pt: 'A ligação falhou ou foi recusada.' },
  'wallet.wcOriginBlocked': {
    zh: 'WalletConnect 拒绝了此应用的来源（origin not allowed）。请在 WalletConnect 控制台把 Allowed Domains 列表留空 — Android 应用从 https://localhost 连接，只列网站域名会屏蔽应用。',
    hi: 'WalletConnect ने इस ऐप का पता अस्वीकार किया (origin not allowed)। WalletConnect डैशबोर्ड में Allowed Domains सूची खाली छोड़ें — Android ऐप https://localhost से जुड़ता है, केवल वेबसाइट लिखने से ऐप ब्लॉक हो जाता है।',
    es: 'WalletConnect rechazó la dirección de esta app (origin not allowed). En el panel de WalletConnect deja la lista Allowed Domains VACÍA: la app de Android se conecta desde https://localhost y una lista que solo nombre el sitio bloquea la app.',
    fr: "WalletConnect a refusé l'adresse de cette app (origin not allowed). Dans le tableau de bord WalletConnect, laissez la liste Allowed Domains VIDE — l'app Android se connecte depuis https://localhost, une liste ne citant que le site bloque l'app.",
    ru: 'WalletConnect отклонил адрес этого приложения (origin not allowed). В панели WalletConnect оставьте список Allowed Domains ПУСТЫМ — Android-приложение подключается с https://localhost, и список только с сайтом блокирует приложение.',
    tr: 'WalletConnect bu uygulamanın adresini reddetti (origin not allowed). WalletConnect panosunda Allowed Domains listesini BOŞ bırakın — Android uygulaması https://localhost üzerinden bağlanır; yalnızca siteyi içeren liste uygulamayı engeller.',
    ur: 'WalletConnect نے اس ایپ کا پتا مسترد کیا (origin not allowed)۔ WalletConnect ڈیش بورڈ میں Allowed Domains فہرست خالی چھوڑیں — اینڈرائیڈ ایپ https://localhost سے جڑتی ہے، صرف ویب سائٹ والی فہرست ایپ کو بلاک کر دیتی ہے۔',
    id: 'WalletConnect menolak alamat aplikasi ini (origin not allowed). Di dasbor WalletConnect biarkan daftar Allowed Domains KOSONG — aplikasi Android terhubung dari https://localhost; daftar yang hanya memuat situs akan memblokir aplikasi.',
    pt: 'O WalletConnect recusou o endereço desta app (origin not allowed). No painel do WalletConnect deixe a lista Allowed Domains VAZIA — a app Android liga-se a partir de https://localhost e uma lista só com o site bloqueia a app.'
  },
  'wallet.wcRelayUnreachable': {
    zh: '无法连接 WalletConnect 中继（relay.walletconnect.com）。部分网络会屏蔽它 — 换个网络或使用 VPN 后重试。',
    hi: 'WalletConnect रिले (relay.walletconnect.com) तक नहीं पहुँच सका। कुछ नेटवर्क इसे ब्लॉक करते हैं — दूसरा नेटवर्क या VPN आज़माकर फिर कोशिश करें।',
    es: 'No se pudo alcanzar el relay de WalletConnect (relay.walletconnect.com). Algunas redes lo bloquean: prueba otra red o una VPN y vuelve a intentarlo.',
    fr: "Impossible d'atteindre le relais WalletConnect (relay.walletconnect.com). Certains réseaux le bloquent — essayez un autre réseau ou un VPN, puis réessayez.",
    ru: 'Не удалось связаться с релеем WalletConnect (relay.walletconnect.com). Некоторые сети его блокируют — попробуйте другую сеть или VPN и повторите.',
    tr: 'WalletConnect aktarıcısına (relay.walletconnect.com) ulaşılamadı. Bazı ağlar bunu engeller — başka bir ağ veya VPN deneyip tekrar deneyin.',
    ur: 'WalletConnect ریلے (relay.walletconnect.com) تک رسائی ممکن نہیں ہوئی۔ کچھ نیٹ ورک اسے بلاک کرتے ہیں — دوسرا نیٹ ورک یا VPN آزما کر دوبارہ کوشش کریں۔',
    id: 'Tidak dapat menjangkau relay WalletConnect (relay.walletconnect.com). Sebagian jaringan memblokirnya — coba jaringan lain atau VPN, lalu ulangi.',
    pt: 'Não foi possível contactar o relay do WalletConnect (relay.walletconnect.com). Algumas redes bloqueiam-no — tente outra rede ou uma VPN e volte a tentar.'
  },
  'wallet.wcExpired': {
    zh: '钱包批准前连接请求已过期。请重新打开钱包列表再试一次。',
    hi: 'वॉलेट की मंज़ूरी से पहले कनेक्शन अनुरोध समाप्त हो गया। वॉलेट सूची खोलकर फिर से कोशिश करें।',
    es: 'La solicitud de conexión caducó antes de que la cartera la aprobara. Abre la lista de carteras e inténtalo de nuevo.',
    fr: "La demande de connexion a expiré avant l'approbation du portefeuille. Rouvrez la liste des portefeuilles et réessayez.",
    ru: 'Запрос на подключение истёк до одобрения кошельком. Откройте список кошельков и попробуйте снова.',
    tr: 'Bağlantı isteği cüzdan onaylamadan önce süresi doldu. Cüzdan listesini açıp yeniden deneyin.',
    ur: 'کنکشن کی درخواست والٹ کی منظوری سے پہلے ختم ہو گئی۔ والٹ فہرست کھول کر دوبارہ کوشش کریں۔',
    id: 'Permintaan koneksi kedaluwarsa sebelum dompet menyetujuinya. Buka daftar dompet dan coba lagi.',
    pt: 'O pedido de ligação expirou antes de a carteira o aprovar. Abra a lista de carteiras e tente novamente.'
  },
  'wallet.resetDesc': {
    zh: '把虚拟余额、持仓、计划和历史记录全部恢复到初始状态。',
    hi: 'आपका वर्चुअल बैलेंस, पोज़िशन, प्लान और इतिहास शुरुआती स्थिति में लौटा देता है।',
    es: 'Restablece tu saldo virtual, posiciones, planes e historial al estado inicial.',
    fr: 'Remet votre solde virtuel, vos positions, vos plans et votre historique à l\'état initial.',
    ru: 'Сбрасывает виртуальный баланс, позиции, планы и историю к начальному состоянию.',
    tr: 'Sanal bakiyenizi, pozisyonlarınızı, planlarınızı ve geçmişinizi başlangıç durumuna döndürür.',
    ur: 'آپ کا ورچوئل بیلنس، پوزیشنز، پلانز اور تاریخ ابتدائی حالت پر واپس لے آتا ہے۔',
    id: 'Mengembalikan saldo virtual, posisi, rencana, dan riwayat ke keadaan awal.',
    pt: 'Repõe o saldo virtual, posições, planos e histórico para o estado inicial.'
  },
  'wallet.noWcProject': {
    zh: '在 .env 中设置 VITE_WALLETCONNECT_PROJECT_ID 以启用 WalletConnect。可在 cloud.reown.com 免费获取。',
    hi: 'WalletConnect चालू करने के लिए .env में VITE_WALLETCONNECT_PROJECT_ID सेट करें। cloud.reown.com पर मुफ़्त मिलता है।',
    es: 'Configura VITE_WALLETCONNECT_PROJECT_ID en tu .env para habilitar WalletConnect. Es gratis en cloud.reown.com.',
    fr: 'Définissez VITE_WALLETCONNECT_PROJECT_ID dans votre .env pour activer WalletConnect. Gratuit sur cloud.reown.com.',
    ru: 'Задайте VITE_WALLETCONNECT_PROJECT_ID в .env, чтобы включить WalletConnect. Бесплатно на cloud.reown.com.',
    tr: 'WalletConnect için .env dosyanızda VITE_WALLETCONNECT_PROJECT_ID ayarlayın. cloud.reown.com adresinde ücretsiz.',
    ur: 'WalletConnect فعال کرنے کے لیے .env میں VITE_WALLETCONNECT_PROJECT_ID سیٹ کریں۔ cloud.reown.com پر مفت ہے۔',
    id: 'Atur VITE_WALLETCONNECT_PROJECT_ID di .env untuk mengaktifkan WalletConnect. Gratis di cloud.reown.com.',
    pt: 'Defina VITE_WALLETCONNECT_PROJECT_ID no seu .env para ativar o WalletConnect. Gratuito em cloud.reown.com.'
  },

  /* -------------------------------- trade ----------------------------- */
  'trade.buy': { zh: '买入', hi: 'खरीदें', es: 'Comprar', fr: 'Acheter', ru: 'Купить', tr: 'Al', ur: 'خریدیں', id: 'Beli', pt: 'Comprar' },
  'trade.sell': { zh: '卖出', hi: 'बेचें', es: 'Vender', fr: 'Vendre', ru: 'Продать', tr: 'Sat', ur: 'بیچیں', id: 'Jual', pt: 'Vender' },
  'trade.total': { zh: '合计', hi: 'कुल', es: 'Total', fr: 'Total', ru: 'Итого', tr: 'Toplam', ur: 'کل', id: 'Total', pt: 'Total' },
  'trade.price': { zh: '价格', hi: 'क़ीमत', es: 'Precio', fr: 'Prix', ru: 'Цена', tr: 'Fiyat', ur: 'قیمت', id: 'Harga', pt: 'Preço' },

  /* -------------------------------- earn ------------------------------ */
  'earn.title': { zh: '赚取', hi: 'कमाएँ', es: 'Ganar', fr: 'Gagner', ru: 'Заработок', tr: 'Kazan', ur: 'کمائیں', id: 'Dapatkan', pt: 'Ganhar' },
  'earn.dailyReward': { zh: '每日奖励', hi: 'दैनिक इनाम', es: 'Recompensa diaria', fr: 'Récompense quotidienne', ru: 'Ежедневная награда', tr: 'Günlük ödül', ur: 'روزانہ انعام', id: 'Hadiah harian', pt: 'Recompensa diária' },
  'earn.claimNow': { zh: '立即领取', hi: 'अभी लें', es: 'Reclamar ahora', fr: 'Réclamer', ru: 'Получить', tr: 'Şimdi al', ur: 'ابھی وصول کریں', id: 'Klaim sekarang', pt: 'Reclamar agora' },
  'earn.streakDays': { zh: '连续 {{n}} 天', hi: '{{n}} दिन लगातार', es: '{{n}} días seguidos', fr: '{{n}} jours consécutifs', ru: '{{n}} дней подряд', tr: '{{n}} gün üst üste', ur: '{{n}} دن مسلسل', id: '{{n}} hari beruntun', pt: '{{n}} dias seguidos' },
  'earn.referral': { zh: '邀请好友', hi: 'रेफ़रल', es: 'Referidos', fr: 'Parrainage', ru: 'Приглашения', tr: 'Davet', ur: 'ریفرل', id: 'Referal', pt: 'Indicações' },
  'earn.shareInvite': { zh: '分享邀请', hi: 'इनवाइट शेयर करें', es: 'Compartir invitación', fr: 'Partager l\'invitation', ru: 'Поделиться приглашением', tr: 'Daveti paylaş', ur: 'دعوت شیئر کریں', id: 'Bagikan undangan', pt: 'Partilhar convite' },
  'earn.quests': { zh: '任务', hi: 'क्वेस्ट', es: 'Misiones', fr: 'Quêtes', ru: 'Задания', tr: 'Görevler', ur: 'کویسٹس', id: 'Misi', pt: 'Missões' },
  'earn.virtualNotice': {
    zh: '此处的积分是分数，不是货币。它们不能提现、不能转让，也没有现金价值。',
    hi: 'यहाँ के अंक स्कोर हैं, मुद्रा नहीं। इन्हें निकाला या ट्रांसफ़र नहीं किया जा सकता और इनका कोई नक़द मूल्य नहीं है।',
    es: 'Los puntos aquí son una puntuación, no una moneda. No se pueden retirar ni transferir y no tienen valor en efectivo.',
    fr: 'Les points ici sont un score, pas une monnaie. Ils ne peuvent être ni retirés ni transférés et n\'ont aucune valeur monétaire.',
    ru: 'Очки здесь — это счёт, а не валюта. Их нельзя вывести или передать, и они не имеют денежной ценности.',
    tr: 'Buradaki puanlar bir skordur, para birimi değil. Çekilemez, devredilemez ve nakit değeri yoktur.',
    ur: 'یہاں پوائنٹس ایک اسکور ہیں، کرنسی نہیں۔ انہیں نکالا یا منتقل نہیں کیا جا سکتا اور ان کی کوئی نقد قیمت نہیں۔',
    id: 'Poin di sini adalah skor, bukan mata uang. Tidak bisa ditarik atau dipindahkan dan tidak punya nilai tunai.',
    pt: 'Os pontos aqui são uma pontuação, não uma moeda. Não podem ser levantados nem transferidos e não têm valor monetário.'
  },

  /* --------------------------- ranking / rank ------------------------- */
  'rank.title': { zh: '排行榜', hi: 'रैंकिंग', es: 'Clasificación', fr: 'Classement', ru: 'Рейтинг', tr: 'Sıralama', ur: 'درجہ بندی', id: 'Peringkat', pt: 'Classificação' },
  'rank.points': { zh: '积分', hi: 'अंक', es: 'puntos', fr: 'points', ru: 'очки', tr: 'puan', ur: 'پوائنٹس', id: 'poin', pt: 'pontos' },
  'rank.you': { zh: '你', hi: 'आप', es: 'Tú', fr: 'Vous', ru: 'Вы', tr: 'Siz', ur: 'آپ', id: 'Anda', pt: 'Você' },
  'rank.yourRank': { zh: '第 {{n}} 名', hi: 'रैंक #{{n}}', es: 'Puesto #{{n}}', fr: 'Rang #{{n}}', ru: 'Место #{{n}}', tr: 'Sıra #{{n}}', ur: 'درجہ #{{n}}', id: 'Peringkat #{{n}}', pt: 'Posição #{{n}}' },
  'rank.unranked': { zh: '尚未上榜', hi: 'अभी रैंक नहीं', es: 'Sin clasificar aún', fr: 'Pas encore classé', ru: 'Пока без рейтинга', tr: 'Henüz sıralanmadı', ur: 'ابھی درجہ نہیں', id: 'Belum berperingkat', pt: 'Ainda sem posição' },
  'rank.tiers': { zh: '等级', hi: 'स्तर', es: 'Niveles', fr: 'Paliers', ru: 'Уровни', tr: 'Seviyeler', ur: 'درجات', id: 'Tingkatan', pt: 'Níveis' },
  'rank.top': { zh: '顶尖交易者', hi: 'शीर्ष ट्रेडर', es: 'Mejores traders', fr: 'Meilleurs traders', ru: 'Лучшие трейдеры', tr: 'En iyi yatırımcılar', ur: 'بہترین ٹریڈرز', id: 'Trader teratas', pt: 'Melhores traders' },

  /* ------------------------------- FAQ -------------------------------- */
  /*
   * Question labels only. The ANSWERS live in src/lib/faqLocal.js and are
   * currently fa/en/ar; other languages fall back to English there. That is
   * deliberate — these answers cover irreversible transactions and lost
   * recovery phrases, and a confidently-worded mistranslation of those is
   * worse than a paragraph the reader can tell is not in their language.
   */
  'help.faqTitle': { zh: '常见问题', hi: 'अक्सर पूछे जाने वाले सवाल', es: 'Preguntas frecuentes', fr: 'Questions fréquentes', ru: 'Частые вопросы', tr: 'Sık sorulan sorular', ur: 'اکثر پوچھے گئے سوالات', id: 'Pertanyaan umum', pt: 'Perguntas frequentes' },
  'help.faqSubtitle': { zh: '由团队针对本应用撰写，非自动生成。', hi: 'टीम द्वारा इसी ऐप के लिए लिखा गया — स्वतः जनरेट नहीं।', es: 'Escritas por el equipo sobre esta app, no generadas automáticamente.', fr: 'Rédigées par l\'équipe pour cette app, non générées automatiquement.', ru: 'Написаны командой об этом приложении, а не сгенерированы.', tr: 'Ekip tarafından bu uygulama için yazıldı, otomatik üretilmedi.', ur: 'ٹیم نے اسی ایپ کے بارے میں لکھا — خودکار نہیں۔', id: 'Ditulis tim tentang aplikasi ini, bukan dibuat otomatis.', pt: 'Escritas pela equipa sobre esta app, não geradas automaticamente.' },
  'help.guideCta': { zh: '打开分步指南', hi: 'चरण-दर-चरण गाइड खोलें', es: 'Abrir la guía paso a paso', fr: 'Ouvrir le guide pas à pas', ru: 'Открыть пошаговое руководство', tr: 'Adım adım kılavuzu aç', ur: 'مرحلہ وار گائیڈ کھولیں', id: 'Buka panduan langkah demi langkah', pt: 'Abrir o guia passo a passo' },
  'help.guideCtaSub': { zh: '兑换、钱包、安全与信号的完整讲解', hi: 'स्वैप, वॉलेट, सुरक्षा और सिग्नल की पूरी जानकारी', es: 'Recorrido completo de intercambios, carteras, seguridad y señales', fr: 'Tour complet des échanges, portefeuilles, sécurité et signaux', ru: 'Полный разбор обменов, кошельков, безопасности и сигналов', tr: 'Takas, cüzdan, güvenlik ve sinyallerin tam anlatımı', ur: 'سویپ، والٹ، سیکیورٹی اور سگنلز کی مکمل رہنمائی', id: 'Panduan lengkap tukar, dompet, keamanan, dan sinyal', pt: 'Percurso completo de trocas, carteiras, segurança e sinais' },
  'help.stillStuck': { zh: '没找到答案？', hi: 'जवाब नहीं मिला?', es: '¿No encontraste tu respuesta?', fr: 'Vous n\'avez pas trouvé ?', ru: 'Не нашли ответ?', tr: 'Cevabını bulamadın mı?', ur: 'جواب نہیں ملا؟', id: 'Belum menemukan jawaban?', pt: 'Não encontrou a resposta?' },
  'help.stillStuckSub': { zh: '直接联系客服，会有真人回复。', hi: 'सीधे सपोर्ट को मैसेज करें — असली व्यक्ति जवाब देगा।', es: 'Escribe a soporte: responde una persona real.', fr: 'Écrivez au support : une vraie personne répond.', ru: 'Напишите в поддержку — ответит живой человек.', tr: 'Doğrudan desteğe yazın — gerçek bir kişi yanıtlar.', ur: 'براہ راست سپورٹ کو پیغام بھیجیں — حقیقی شخص جواب دے گا۔', id: 'Kirim pesan ke dukungan — dijawab orang sungguhan.', pt: 'Envie mensagem ao apoio — responde uma pessoa real.' },

  'help.q.howToSwap': { zh: '如何完成我的第一笔兑换？', hi: 'मैं अपना पहला स्वैप कैसे करूँ?', es: '¿Cómo hago mi primer intercambio?', fr: 'Comment effectuer mon premier échange ?', ru: 'Как совершить первый обмен?', tr: 'İlk takasımı nasıl yaparım?', ur: 'میں اپنا پہلا سویپ کیسے کروں؟', id: 'Bagaimana melakukan swap pertama saya?', pt: 'Como faço a minha primeira troca?' },
  'help.q.deposit': { zh: '如何向应用充值？', hi: 'ऐप में पैसे कैसे जमा करूँ?', es: '¿Cómo deposito dinero en la app?', fr: 'Comment déposer de l\'argent dans l\'app ?', ru: 'Как пополнить счёт в приложении?', tr: 'Uygulamaya nasıl para yatırırım?', ur: 'ایپ میں رقم کیسے جمع کروں؟', id: 'Bagaimana cara menyetor dana ke aplikasi?', pt: 'Como deposito dinheiro na app?' },
  'help.q.fees': { zh: '你们收取什么费用？', hi: 'आप क्या फ़ीस लेते हैं?', es: '¿Qué comisiones cobráis?', fr: 'Quels frais prenez-vous ?', ru: 'Какие комиссии вы берёте?', tr: 'Hangi ücretleri alıyorsunuz?', ur: 'آپ کیا فیس لیتے ہیں؟', id: 'Berapa biaya yang dikenakan?', pt: 'Que taxas cobram?' },
  'help.q.gas': { zh: 'Gas 是什么？用哪种币支付？', hi: 'गैस क्या है और कौन सा सिक्का देना होता है?', es: '¿Qué es el gas y con qué moneda se paga?', fr: 'Qu\'est-ce que le gas et avec quelle monnaie ?', ru: 'Что такое газ и какой монетой он платится?', tr: 'Gas nedir ve hangi coin ile ödenir?', ur: 'گیس کیا ہے اور کس سکے سے ادا ہوتی ہے؟', id: 'Apa itu gas dan dibayar dengan koin apa?', pt: 'O que é o gás e com que moeda se paga?' },
  'help.q.failed': { zh: '我的兑换为什么失败了？', hi: 'मेरा स्वैप क्यों विफल हुआ?', es: '¿Por qué falló mi intercambio?', fr: 'Pourquoi mon échange a-t-il échoué ?', ru: 'Почему мой обмен не прошёл?', tr: 'Takasım neden başarısız oldu?', ur: 'میرا سویپ کیوں ناکام ہوا؟', id: 'Kenapa pertukaran saya gagal?', pt: 'Porque falhou a minha troca?' },
  'help.q.slippage': { zh: '滑点是什么意思？', hi: 'स्लिपेज का क्या मतलब है?', es: '¿Qué significa el deslizamiento?', fr: 'Que signifie le slippage ?', ru: 'Что означает проскальзывание?', tr: 'Kayma ne demek?', ur: 'سلپیج کا کیا مطلب ہے؟', id: 'Apa arti slippage?', pt: 'O que significa derrapagem?' },
  'help.q.custody': { zh: '我的资产在你们手里吗？', hi: 'क्या मेरे फंड आपके पास हैं?', es: '¿Guardáis mis fondos?', fr: 'Détenez-vous mes fonds ?', ru: 'Вы храните мои средства?', tr: 'Paramı siz mi tutuyorsunuz?', ur: 'کیا میرے فنڈز آپ کے پاس ہیں؟', id: 'Apakah dana saya Anda simpan?', pt: 'Guardam os meus fundos?' },
  'help.q.seed': { zh: '如果我弄丢了助记词会怎样？', hi: 'अगर मैं सीड फ़्रेज़ खो दूँ तो?', es: '¿Qué pasa si pierdo mi frase semilla?', fr: 'Que se passe-t-il si je perds ma phrase de récupération ?', ru: 'Что если я потеряю seed-фразу?', tr: 'Kurtarma ifademi kaybedersem ne olur?', ur: 'اگر میں ریکوری فقرہ کھو دوں تو؟', id: 'Bagaimana jika frasa pemulihan hilang?', pt: 'E se perder a frase de recuperação?' },
  'help.q.coins': { zh: '可以兑换多少种币？找不到我的币怎么办？', hi: 'कितने सिक्के स्वैप हो सकते हैं, मेरा न मिले तो?', es: '¿Cuántas monedas puedo intercambiar y si falta la mía?', fr: 'Combien de cryptos puis-je échanger, et si la mienne manque ?', ru: 'Сколько монет доступно и что если моей нет?', tr: 'Kaç coin takas edilebilir, benimki yoksa?', ur: 'کتنے سکے سویپ ہو سکتے ہیں، میرا نہ ہو تو؟', id: 'Berapa koin bisa ditukar, kalau punya saya tak ada?', pt: 'Quantas moedas posso trocar e se faltar a minha?' },
  'help.q.chains': { zh: '支持哪些网络？', hi: 'कौन से नेटवर्क समर्थित हैं?', es: '¿Qué redes están soportadas?', fr: 'Quels réseaux sont pris en charge ?', ru: 'Какие сети поддерживаются?', tr: 'Hangi ağlar destekleniyor?', ur: 'کون سے نیٹ ورک سپورٹ ہیں؟', id: 'Jaringan apa saja yang didukung?', pt: 'Que redes são suportadas?' },
  'help.q.connect': { zh: '怎么连接我的钱包？', hi: 'अपना वॉलेट कैसे कनेक्ट करूँ?', es: '¿Cómo conecto mi cartera?', fr: 'Comment connecter mon portefeuille ?', ru: 'Как подключить кошелёк?', tr: 'Cüzdanımı nasıl bağlarım?', ur: 'اپنا والٹ کیسے منسلک کروں؟', id: 'Bagaimana menghubungkan dompet?', pt: 'Como ligo a minha carteira?' },
  'help.q.realMoney': { zh: '哪些部分使用真实资金？', hi: 'कौन से हिस्से असली पैसे से चलते हैं?', es: '¿Qué partes usan dinero real?', fr: 'Quelles parties utilisent de l\'argent réel ?', ru: 'Какие разделы используют реальные деньги?', tr: 'Hangi bölümler gerçek para kullanıyor?', ur: 'کون سے حصے اصل پیسے سے چلتے ہیں؟', id: 'Bagian mana yang memakai uang nyata?', pt: 'Que partes usam dinheiro real?' },
  'help.q.notFound': { zh: '为什么有时显示"找不到该币种"？', hi: 'कभी-कभी "सिक्का नहीं मिला" क्यों आता है?', es: '¿Por qué a veces dice "moneda no encontrada"?', fr: 'Pourquoi affiche-t-il parfois « crypto introuvable » ?', ru: 'Почему иногда пишет «монета не найдена»?', tr: 'Neden bazen "coin bulunamadı" diyor?', ur: 'کبھی "سکہ نہیں ملا" کیوں آتا ہے؟', id: 'Kenapa kadang muncul "koin tidak ditemukan"?', pt: 'Porque diz às vezes "moeda não encontrada"?' },
  'help.q.iranLegal': { zh: '在伊朗的法律状况如何？', hi: 'ईरान में क़ानूनी स्थिति क्या है?', es: '¿Cuál es la situación legal en Irán?', fr: 'Quelle est la situation légale en Iran ?', ru: 'Каков правовой статус в Иране?', tr: 'İran\'daki yasal durum nedir?', ur: 'ایران میں قانونی حیثیت کیا ہے؟', id: 'Bagaimana status hukum di Iran?', pt: 'Qual é a situação legal no Irão?' },

  /* -------------------------------- help ------------------------------ */
  'help.title': { zh: '帮助与支持', hi: 'सहायता', es: 'Ayuda y soporte', fr: 'Aide et support', ru: 'Помощь и поддержка', tr: 'Yardım ve destek', ur: 'مدد اور معاونت', id: 'Bantuan & dukungan', pt: 'Ajuda e suporte' },
};
