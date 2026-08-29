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
  /*
   * REMOVED — wallet.localRisk, wallet.noProvider, wallet.backupWarning.
   *
   * These three made a claim that is not true: that the in-app wallet keeps
   * its key "inside the Telegram WebView", and that "not us, not Telegram"
   * can recover a lost phrase. This app is a website and an Android APK; it
   * is not a Telegram Mini App, and the Telegram support channel was removed
   * earlier for exactly this reason.
   *
   * A user who reads a security warning naming a product they are not using
   * is given a reason to distrust the whole warning — and this one is the
   * difference between keeping $50 and keeping $50,000 in a browser-stored
   * key. The strings were rewritten in en/fa/ar and deleted from the nine
   * partial languages so they fall back to the CORRECTED English rather than
   * carrying a false statement in their own words. Safety copy is not
   * machine-translated, and a stale module must not be able to reintroduce
   * it, so it is gone from here too.
   */
  'wallet.connectFailed': { zh: '连接失败或被拒绝。', hi: 'कनेक्शन विफल या अस्वीकृत।', es: 'La conexión falló o fue rechazada.', fr: 'Connexion échouée ou refusée.', ru: 'Подключение не удалось или было отклонено.', tr: 'Bağlantı başarısız oldu veya reddedildi.', ur: 'کنکشن ناکام یا مسترد۔', id: 'Koneksi gagal atau ditolak.', pt: 'A ligação falhou ou foi recusada.' },
  'wallet.wcOriginBlocked': {
    zh: 'WalletConnect 拒绝了此应用的来源。请在 Reown 控制台确认 Allowed Domains 包含 https://fbtswap.ir 和 https://localhost，且 App IDs 包含 ir.fbtswap.app。',
    hi: 'WalletConnect ने इस ऐप का origin अस्वीकार किया। Reown डैशबोर्ड में जाँचें कि Allowed Domains में https://fbtswap.ir और https://localhost तथा App IDs में ir.fbtswap.app शामिल हों।',
    es: 'WalletConnect rechazó el origen de esta app. En el panel de Reown, confirma que Allowed Domains incluya https://fbtswap.ir y https://localhost, y que App IDs incluya ir.fbtswap.app.',
    fr: "WalletConnect a refusé l’origine de cette app. Dans le tableau de bord Reown, vérifiez que Allowed Domains contient https://fbtswap.ir et https://localhost, et que App IDs contient ir.fbtswap.app.",
    ru: 'WalletConnect отклонил origin приложения. В панели Reown проверьте, что Allowed Domains содержит https://fbtswap.ir и https://localhost, а App IDs — ir.fbtswap.app.',
    tr: 'WalletConnect bu uygulamanın origin değerini reddetti. Reown panelinde Allowed Domains alanında https://fbtswap.ir ve https://localhost, App IDs alanında ir.fbtswap.app bulunduğunu doğrulayın.',
    ur: 'WalletConnect نے اس ایپ کا origin مسترد کیا۔ Reown ڈیش بورڈ میں یقینی بنائیں کہ Allowed Domains میں https://fbtswap.ir اور https://localhost، اور App IDs میں ir.fbtswap.app شامل ہوں۔',
    id: 'WalletConnect menolak origin aplikasi ini. Di dasbor Reown, pastikan Allowed Domains berisi https://fbtswap.ir dan https://localhost, serta App IDs berisi ir.fbtswap.app.',
    pt: 'O WalletConnect recusou a origem desta app. No painel Reown, confirme que Allowed Domains inclui https://fbtswap.ir e https://localhost, e que App IDs inclui ir.fbtswap.app.'
  },
  'wallet.wcRelayUnreachable': {
    zh: '无法连接 WalletConnect 中继 — 部分网络和运营商会屏蔽它。如果使用 VPN，必须对整台设备生效：钱包 App 也要连接中继，而不只是浏览器。不用 VPN 时，也可以在钱包内置浏览器（Trust 或 MetaMask → Browser 标签）中打开本站 — 该方式完全不需要中继。',
    hi: 'WalletConnect रिले तक नहीं पहुँच सका — कुछ नेटवर्क और ISP इसे ब्लॉक करते हैं। यदि VPN इस्तेमाल करते हैं तो वह पूरे डिवाइस पर सक्रिय होना चाहिए, क्योंकि वॉलेट ऐप को भी रिले से जुड़ना होता है, सिर्फ़ ब्राउज़र को नहीं। बिना VPN के भी आप इस साइट को वॉलेट के अंदरूनी ब्राउज़र (Trust या MetaMask → Browser टैब) में खोल सकते हैं — उस रास्ते में रिले की ज़रूरत ही नहीं है।',
    es: 'No se pudo alcanzar el relay de WalletConnect: algunas redes y operadores lo bloquean. Si usas VPN, debe cubrir todo el dispositivo, porque la app de la cartera también necesita llegar al relay, no solo el navegador. Sin VPN, también puedes abrir este sitio dentro del navegador integrado de tu cartera (Trust o MetaMask → pestaña Browser); esa vía no necesita relay.',
    fr: "Impossible d'atteindre le relais WalletConnect — certains réseaux et opérateurs le bloquent. Si vous utilisez un VPN, il doit couvrir tout l'appareil : l'app du portefeuille doit aussi joindre le relais, pas seulement le navigateur. Sans VPN, vous pouvez aussi ouvrir ce site dans le navigateur intégré du portefeuille (Trust ou MetaMask → onglet Browser) — cette voie n'a pas besoin de relais.",
    ru: 'Не удалось связаться с релеем WalletConnect — некоторые сети и операторы его блокируют. Если используете VPN, он должен работать для всего устройства: приложению кошелька тоже нужен доступ к релею, а не только браузеру. Без VPN можно открыть этот сайт во встроенном браузере кошелька (Trust или MetaMask → вкладка Browser) — этому пути релей вообще не нужен.',
    tr: 'WalletConnect aktarıcısına ulaşılamadı — bazı ağlar ve operatörler onu engelliyor. VPN kullanıyorsanız tüm cihazı kapsamalı; çünkü cüzdan uygulamasının da aktarıcıya erişmesi gerekir, yalnızca tarayıcının değil. VPN olmadan da bu siteyi cüzdanın yerleşik tarayıcısında (Trust veya MetaMask → Browser sekmesi) açabilirsiniz — o yol aktarıcıya hiç ihtiyaç duymaz.',
    ur: 'WalletConnect ریلے تک رسائی ممکن نہیں ہوئی — کچھ نیٹ ورک اور آپریٹر اسے بلاک کرتے ہیں۔ اگر VPN استعمال کرتے ہیں تو وہ پورے ڈیوائس پر فعال ہونا چاہیے، کیونکہ والٹ ایپ کو بھی ریلے تک پہنچنا ہوتا ہے، صرف براؤزر کو نہیں۔ VPN کے بغیر بھی آپ یہ سائٹ والٹ کے اندرونی براؤزر (Trust یا MetaMask ← Browser ٹیب) میں کھول سکتے ہیں — اس راستے کو ریلے کی ضرورت ہی نہیں۔',
    id: 'Tidak dapat menjangkau relay WalletConnect — sebagian jaringan dan operator memblokirnya. Jika memakai VPN, VPN harus mencakup seluruh perangkat, karena aplikasi dompet juga harus menjangkau relay, bukan hanya browser. Tanpa VPN, kamu juga bisa membuka situs ini di browser bawaan dompet (Trust atau MetaMask → tab Browser) — jalur itu sama sekali tidak butuh relay.',
    pt: 'Não foi possível contactar o relay do WalletConnect — algumas redes e operadores bloqueiam-no. Se usar VPN, ela deve cobrir o dispositivo inteiro, porque a app da carteira também precisa de alcançar o relay, não apenas o navegador. Sem VPN, também pode abrir este site no navegador integrado da carteira (Trust ou MetaMask → separador Browser) — esse caminho não precisa de relay.'
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
  /*
   * REMOVED — rank.you / rank.yourRank / rank.unranked / rank.top.
   *
   * These belong to a public leaderBOARD ("you are #n", "top traders") that
   * was never shipped: pages/Leaderboard.jsx shows the reader their own tier,
   * points and history, and deliberately does not publish a ranking of other
   * people. The nine translations were unreachable; they are in git history
   * if a board is ever built.
   */
  'rank.tiers': { zh: '等级', hi: 'स्तर', es: 'Niveles', fr: 'Paliers', ru: 'Уровни', tr: 'Seviyeler', ur: 'درجات', id: 'Tingkatan', pt: 'Níveis' },

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
