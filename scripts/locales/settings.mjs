/**
 * Settings, security and network configuration.
 *
 * Security copy carries real consequences, so the warnings here are written
 * out in full in each language rather than shortened. Two in particular were
 * worth the effort:
 *
 *  - `settings.rpcWarn`: a hostile RPC endpoint can show fabricated balances
 *    and prices. Someone who cannot read that sentence in English is exactly
 *    the person most likely to paste in a random endpoint from a chat group.
 *  - `settings.testnetWarn`: a user who leaves testnet on believes they are
 *    trading and is not, which looks like the app silently swallowing money.
 */
export default {
  'settings.subtitle': { zh: '外观、安全与账户。', hi: 'दिखावट, सुरक्षा और खाता।', es: 'Apariencia, seguridad y cuenta.', fr: 'Apparence, sécurité et compte.', ru: 'Оформление, безопасность и аккаунт.', tr: 'Görünüm, güvenlik ve hesap.', ur: 'ظاہری شکل، سیکیورٹی اور اکاؤنٹ۔', id: 'Tampilan, keamanan, dan akun.', pt: 'Aparência, segurança e conta.' },
  'settings.username': { zh: '用户名', hi: 'यूज़रनेम', es: 'Nombre de usuario', fr: 'Nom d\'utilisateur', ru: 'Имя пользователя', tr: 'Kullanıcı adı', ur: 'صارف نام', id: 'Nama pengguna', pt: 'Nome de utilizador' },
  'settings.noUsername': { zh: '未设置', hi: 'सेट नहीं', es: 'Sin definir', fr: 'Non défini', ru: 'Не задано', tr: 'Ayarlanmadı', ur: 'مقرر نہیں', id: 'Belum diatur', pt: 'Não definido' },
  'settings.usernamePlaceholder': { zh: '取一个显示名称', hi: 'एक प्रदर्शित नाम चुनें', es: 'Elige un nombre visible', fr: 'Choisissez un nom affiché', ru: 'Выберите отображаемое имя', tr: 'Bir görünen ad seçin', ur: 'ایک ظاہری نام منتخب کریں', id: 'Pilih nama tampilan', pt: 'Escolha um nome de exibição' },
  'settings.usernameNote': {
    zh: '仅在本应用内显示。不会上链，也不与你的钱包地址绑定。',
    hi: 'केवल इस ऐप में दिखता है। यह ऑन-चेन प्रकाशित नहीं होता और आपके वॉलेट पते से जुड़ा नहीं है।',
    es: 'Solo se muestra dentro de esta app. No se publica on-chain ni queda vinculado a tu dirección.',
    fr: 'Affiché uniquement dans cette app. Il n\'est pas publié on-chain ni lié à votre adresse.',
    ru: 'Показывается только внутри приложения. Не публикуется в блокчейне и не связано с вашим адресом.',
    tr: 'Yalnızca bu uygulamada görünür. Zincire yazılmaz ve cüzdan adresinize bağlanmaz.',
    ur: 'صرف اس ایپ میں دکھایا جاتا ہے۔ یہ آن چین شائع نہیں ہوتا اور آپ کے والٹ ایڈریس سے منسلک نہیں۔',
    id: 'Hanya tampil di dalam aplikasi ini. Tidak dipublikasikan on-chain dan tidak terkait alamat dompet Anda.',
    pt: 'Mostrado apenas dentro desta app. Não é publicado on-chain nem ligado ao seu endereço.'
  },
  'settings.hideBalancesSub': { zh: '他人能看到屏幕时遮住金额', hi: 'दूसरों के सामने राशि छिपाएँ', es: 'Oculta importes si alguien ve tu pantalla', fr: 'Masque les montants si on voit votre écran', ru: 'Скрывать суммы, когда экран видят другие', tr: 'Ekranınızı görenlere tutarları gizle', ur: 'دوسروں کے سامنے رقم چھپائیں', id: 'Sembunyikan jumlah saat layar terlihat orang lain', pt: 'Oculta valores quando outros veem o ecrã' },
  'settings.biometric': { zh: '生物识别解锁', hi: 'बायोमेट्रिक अनलॉक', es: 'Desbloqueo biométrico', fr: 'Déverrouillage biométrique', ru: 'Биометрическая разблокировка', tr: 'Biyometrik kilit açma', ur: 'بایومیٹرک انلاک', id: 'Buka dengan biometrik', pt: 'Desbloqueio biométrico' },
  'settings.biometricSub': { zh: '用指纹或面容打开应用', hi: 'फ़िंगरप्रिंट या चेहरे से ऐप खोलें', es: 'Abre la app con huella o rostro', fr: 'Ouvrir l\'app par empreinte ou visage', ru: 'Открывать приложение отпечатком или лицом', tr: 'Uygulamayı parmak izi veya yüzle aç', ur: 'فنگر پرنٹ یا چہرے سے ایپ کھولیں', id: 'Buka aplikasi dengan sidik jari atau wajah', pt: 'Abrir a app com impressão digital ou rosto' },
  'settings.biometricUnavailable': { zh: '此设备不支持', hi: 'इस डिवाइस पर उपलब्ध नहीं', es: 'No disponible en este dispositivo', fr: 'Indisponible sur cet appareil', ru: 'Недоступно на этом устройстве', tr: 'Bu cihazda kullanılamaz', ur: 'اس آلے پر دستیاب نہیں', id: 'Tidak tersedia di perangkat ini', pt: 'Indisponível neste dispositivo' },
  'settings.twoFactor': { zh: '两步验证 (TOTP)', hi: 'टू-फ़ैक्टर (TOTP)', es: 'Doble factor (TOTP)', fr: 'Double facteur (TOTP)', ru: 'Двухфакторная (TOTP)', tr: 'İki adımlı (TOTP)', ur: 'ٹو فیکٹر (TOTP)', id: 'Dua faktor (TOTP)', pt: 'Dois fatores (TOTP)' },
  'settings.twoFactorSub': { zh: '需要验证器中的 6 位验证码', hi: 'ऑथेंटिकेटर से 6-अंकों का कोड ज़रूरी', es: 'Exige un código de 6 dígitos del autenticador', fr: 'Exige un code à 6 chiffres de votre authentificateur', ru: 'Требовать 6-значный код из приложения', tr: 'Doğrulayıcıdan 6 haneli kod iste', ur: 'اتھینٹی کیٹر سے ٦ ہندسوں کا کوڈ درکار', id: 'Wajib kode 6 digit dari autentikator', pt: 'Exigir um código de 6 dígitos do autenticador' },
  'settings.twoFactorSetup': { zh: '设置两步验证', hi: 'टू-फ़ैक्टर सेट करें', es: 'Configurar doble factor', fr: 'Configurer le double facteur', ru: 'Настроить двухфакторную', tr: 'İki adımlıyı kur', ur: 'ٹو فیکٹر سیٹ کریں', id: 'Siapkan dua faktor', pt: 'Configurar dois fatores' },
  'settings.secretKey': { zh: '密钥', hi: 'गुप्त कुंजी', es: 'Clave secreta', fr: 'Clé secrète', ru: 'Секретный ключ', tr: 'Gizli anahtar', ur: 'خفیہ کلید', id: 'Kunci rahasia', pt: 'Chave secreta' },
  'settings.openInAuthApp': { zh: '在验证器中打开', hi: 'ऑथेंटिकेटर ऐप में खोलें', es: 'Abrir en la app de autenticación', fr: 'Ouvrir dans l\'app d\'authentification', ru: 'Открыть в приложении-аутентификаторе', tr: 'Doğrulayıcı uygulamada aç', ur: 'اتھینٹی کیٹر ایپ میں کھولیں', id: 'Buka di aplikasi autentikator', pt: 'Abrir na app de autenticação' },
  'settings.enterCode': { zh: '输入 6 位验证码', hi: '6-अंकों का कोड डालें', es: 'Introduce el código de 6 dígitos', fr: 'Saisissez le code à 6 chiffres', ru: 'Введите 6-значный код', tr: '6 haneli kodu girin', ur: '٦ ہندسوں کا کوڈ درج کریں', id: 'Masukkan kode 6 digit', pt: 'Introduza o código de 6 dígitos' },
  'settings.badCode': {
    zh: '验证码不正确。请检查手机时间是否准确，并输入当前的验证码。',
    hi: 'कोड सही नहीं है। जाँचें कि फ़ोन का समय सही है और मौजूदा कोड डालें।',
    es: 'Ese código no es correcto. Comprueba que la hora del móvil sea exacta y prueba el código actual.',
    fr: 'Ce code est incorrect. Vérifiez que l\'heure du téléphone est exacte et saisissez le code actuel.',
    ru: 'Код неверный. Проверьте точность часов телефона и введите текущий код.',
    tr: 'Bu kod doğru değil. Telefonunuzun saatinin doğru olduğunu kontrol edip güncel kodu deneyin.',
    ur: 'یہ کوڈ درست نہیں۔ فون کا وقت درست ہے یا نہیں دیکھیں اور موجودہ کوڈ آزمائیں۔',
    id: 'Kode itu salah. Pastikan jam ponsel akurat lalu coba kode saat ini.',
    pt: 'Esse código não está certo. Verifique se a hora do telemóvel está exata e tente o código atual.'
  },
  'settings.verifyEnable': { zh: '验证并启用', hi: 'सत्यापित कर चालू करें', es: 'Verificar y activar', fr: 'Vérifier et activer', ru: 'Проверить и включить', tr: 'Doğrula ve etkinleştir', ur: 'تصدیق کر کے فعال کریں', id: 'Verifikasi & aktifkan', pt: 'Verificar e ativar' },
  'settings.enabled': { zh: '已启用', hi: 'चालू', es: 'Activado', fr: 'Activé', ru: 'Включено', tr: 'Etkin', ur: 'فعال', id: 'Aktif', pt: 'Ativado' },
  'settings.autoLock': { zh: '自动锁定', hi: 'ऑटो-लॉक', es: 'Bloqueo automático', fr: 'Verrouillage auto', ru: 'Автоблокировка', tr: 'Otomatik kilit', ur: 'خودکار لاک', id: 'Kunci otomatis', pt: 'Bloqueio automático' },
  'settings.never': { zh: '从不', hi: 'कभी नहीं', es: 'Nunca', fr: 'Jamais', ru: 'Никогда', tr: 'Asla', ur: 'کبھی نہیں', id: 'Tidak pernah', pt: 'Nunca' },
  'settings.afterMinutes': { zh: '{{n}} 分钟后', hi: '{{n}} मिनट बाद', es: 'Tras {{n}} minutos', fr: 'Après {{n}} minutes', ru: 'Через {{n}} минут', tr: '{{n}} dakika sonra', ur: '{{n}} منٹ بعد', id: 'Setelah {{n}} menit', pt: 'Após {{n}} minutos' },
  /*
   * REMOVED — translations for controls that do not exist.
   *
   *   settings.txConfirm / txConfirmSub — "Confirm every transaction" was
   *     deleted from the settings screen rather than wired: `txConfirmations`
   *     was read nowhere, and it was the exact inverse of Expert mode, which
   *     really does decide whether the review step is skipped. Two switches
   *     fighting over one behaviour, and the losing one looks broken.
   *
   *   settings.testnet / testnetOn / testnetOff / testnetWarn — the app is
   *     MAINNET ONLY by decision, not by omission (see lib/btcAddress.js: a
   *     testnet address is refused as firmly as a mistyped one). Shipping a
   *     switch that turns real money into toy money is the opposite of that.
   *
   * The strings are in git history if either feature is ever built for real.
   */
  'settings.bioErr.UNSUPPORTED': { zh: '此设备或浏览器不支持生物识别解锁。', hi: 'यह डिवाइस या ब्राउज़र बायोमेट्रिक अनलॉक सपोर्ट नहीं करता।', es: 'Este dispositivo o navegador no admite desbloqueo biométrico.', fr: 'Cet appareil ou navigateur ne prend pas en charge la biométrie.', ru: 'Это устройство или браузер не поддерживает биометрию.', tr: 'Bu cihaz veya tarayıcı biyometrik kilidi desteklemiyor.', ur: 'یہ آلہ یا براؤزر بایومیٹرک انلاک سپورٹ نہیں کرتا۔', id: 'Perangkat atau peramban ini tidak mendukung biometrik.', pt: 'Este dispositivo ou navegador não suporta desbloqueio biométrico.' },
  'settings.bioErr.FAILED': { zh: '生物识别设置失败或已取消。', hi: 'बायोमेट्रिक सेटअप विफल या रद्द।', es: 'La configuración biométrica falló o se canceló.', fr: 'La configuration biométrique a échoué ou a été annulée.', ru: 'Настройка биометрии не удалась или отменена.', tr: 'Biyometrik kurulum başarısız oldu veya iptal edildi.', ur: 'بایومیٹرک سیٹ اپ ناکام یا منسوخ۔', id: 'Penyiapan biometrik gagal atau dibatalkan.', pt: 'A configuração biométrica falhou ou foi cancelada.' },
  'settings.bioErr.CANCELLED': { zh: '你取消了提示，或设备超时。', hi: 'आपने प्रॉम्प्ट रद्द किया, या डिवाइस टाइमआउट हुआ।', es: 'Cancelaste el aviso o el dispositivo agotó el tiempo.', fr: 'Vous avez annulé, ou l\'appareil a expiré.', ru: 'Вы отменили запрос или устройство прервало ожидание.', tr: 'İstemi iptal ettiniz veya cihaz zaman aşımına uğradı.', ur: 'آپ نے پرامپٹ منسوخ کیا، یا آلہ ٹائم آؤٹ ہوا۔', id: 'Anda membatalkan, atau perangkat kehabisan waktu.', pt: 'Cancelou o pedido, ou o dispositivo expirou.' },
  'settings.bioErr.ALREADY_REGISTERED': { zh: '此设备已注册。请把开关关掉再打开。', hi: 'यह डिवाइस पहले से पंजीकृत है। स्विच बंद कर फिर चालू करें।', es: 'Este dispositivo ya está registrado. Apaga y vuelve a encender el interruptor.', fr: 'Cet appareil est déjà enregistré. Désactivez puis réactivez.', ru: 'Устройство уже зарегистрировано. Выключите и снова включите переключатель.', tr: 'Bu cihaz zaten kayıtlı. Anahtarı kapatıp tekrar açın.', ur: 'یہ آلہ پہلے سے رجسٹرڈ ہے۔ سوئچ بند کر کے دوبارہ آن کریں۔', id: 'Perangkat ini sudah terdaftar. Matikan lalu nyalakan lagi.', pt: 'Este dispositivo já está registado. Desligue e volte a ligar.' },
  'settings.bioErr.INSECURE_ORIGIN': { zh: '生物识别需要安全连接 (https)，在普通 http 下无法使用。', hi: 'बायोमेट्रिक के लिए सुरक्षित (https) कनेक्शन चाहिए; सादे http पर काम नहीं करेगा।', es: 'La biometría necesita una conexión segura (https). No funciona sobre http normal.', fr: 'La biométrie nécessite une connexion sécurisée (https). Elle ne fonctionne pas en http.', ru: 'Биометрия требует защищённого соединения (https) и не работает по обычному http.', tr: 'Biyometri güvenli (https) bağlantı gerektirir; düz http üzerinde çalışmaz.', ur: 'بایومیٹرکس کو محفوظ (https) کنکشن درکار ہے؛ سادہ http پر کام نہیں کرے گا۔', id: 'Biometrik butuh koneksi aman (https). Tidak berfungsi di http biasa.', pt: 'A biometria precisa de ligação segura (https). Não funciona em http simples.' },
  'settings.sync': { zh: '同步', hi: 'सिंक', es: 'Sincronización', fr: 'Synchronisation', ru: 'Синхронизация', tr: 'Eşitleme', ur: 'مطابقت', id: 'Sinkronisasi', pt: 'Sincronização' },
  'settings.cloudSync': { zh: '云同步', hi: 'क्लाउड सिंक', es: 'Sincronización en la nube', fr: 'Synchro cloud', ru: 'Облачная синхронизация', tr: 'Bulut eşitleme', ur: 'کلاؤڈ سنک', id: 'Sinkronisasi awan', pt: 'Sincronização na nuvem' },
  'settings.syncNow': { zh: '立即同步', hi: 'अभी सिंक करें', es: 'Sincronizar', fr: 'Synchroniser', ru: 'Синхронизировать', tr: 'Eşitle', ur: 'ابھی سنک کریں', id: 'Sinkronkan', pt: 'Sincronizar' },
  'settings.neverSynced': { zh: '从未同步', hi: 'कभी सिंक नहीं हुआ', es: 'Nunca sincronizado', fr: 'Jamais synchronisé', ru: 'Никогда не синхронизировалось', tr: 'Hiç eşitlenmedi', ur: 'کبھی سنک نہیں ہوا', id: 'Belum pernah disinkronkan', pt: 'Nunca sincronizado' },
  'settings.legal': { zh: '法律条款', hi: 'क़ानूनी', es: 'Legal', fr: 'Mentions légales', ru: 'Правовая информация', tr: 'Yasal', ur: 'قانونی', id: 'Legal', pt: 'Legal' },
  'settings.terms': { zh: '服务条款', hi: 'सेवा की शर्तें', es: 'Términos del servicio', fr: 'Conditions d\'utilisation', ru: 'Условия использования', tr: 'Hizmet şartları', ur: 'شرائط خدمت', id: 'Ketentuan layanan', pt: 'Termos de serviço' },
  'settings.privacy': { zh: '隐私政策', hi: 'गोपनीयता नीति', es: 'Política de privacidad', fr: 'Politique de confidentialité', ru: 'Политика конфиденциальности', tr: 'Gizlilik politikası', ur: 'رازداری کی پالیسی', id: 'Kebijakan privasi', pt: 'Política de privacidade' },
  'settings.support': { zh: '客服支持', hi: 'सहायता', es: 'Soporte', fr: 'Support', ru: 'Поддержка', tr: 'Destek', ur: 'معاونت', id: 'Dukungan', pt: 'Suporte' },
  'settings.supportSub': { zh: '在 Telegram 上联系我们', hi: 'Telegram पर मैसेज करें', es: 'Escríbenos por Telegram', fr: 'Écrivez-nous sur Telegram', ru: 'Напишите нам в Telegram', tr: 'Telegram\'dan yazın', ur: 'ٹیلیگرام پر پیغام بھیجیں', id: 'Kirim pesan lewat Telegram', pt: 'Envie-nos mensagem no Telegram' },
  'settings.defaultSlippageSub': { zh: '应用于新的兑换', hi: 'नए स्वैप पर लागू', es: 'Se aplica a los nuevos intercambios', fr: 'Appliqué aux nouveaux échanges', ru: 'Применяется к новым обменам', tr: 'Yeni takaslara uygulanır', ur: 'نئے سویپ پر لاگو', id: 'Berlaku untuk pertukaran baru', pt: 'Aplicado a novas trocas' },
  'settings.expertMode': { zh: '专家模式', hi: 'एक्सपर्ट मोड', es: 'Modo experto', fr: 'Mode expert', ru: 'Экспертный режим', tr: 'Uzman modu', ur: 'ایکسپرٹ موڈ', id: 'Mode ahli', pt: 'Modo avançado' },
  'settings.expertModeSub': { zh: '跳过确认界面并允许高滑点', hi: 'पुष्टि स्क्रीन छोड़ें और ज़्यादा स्लिपेज दें', es: 'Omite pantallas de confirmación y permite alto deslizamiento', fr: 'Ignore les écrans de confirmation et autorise un slippage élevé', ru: 'Пропускать подтверждения и разрешать высокое проскальзывание', tr: 'Onay ekranlarını atla ve yüksek kaymaya izin ver', ur: 'تصدیقی اسکرینیں چھوڑیں اور زیادہ سلپیج کی اجازت دیں', id: 'Lewati layar konfirmasi dan izinkan slippage tinggi', pt: 'Ignora ecrãs de confirmação e permite derrapagem alta' },
  'settings.currency': { zh: '显示货币', hi: 'प्रदर्शित मुद्रा', es: 'Moneda de visualización', fr: 'Devise d\'affichage', ru: 'Валюта отображения', tr: 'Görüntüleme para birimi', ur: 'ظاہری کرنسی', id: 'Mata uang tampilan', pt: 'Moeda de exibição' },
  'settings.reduceMotionSub': { zh: '更少动效，更省电', hi: 'कम एनिमेशन, बेहतर बैटरी', es: 'Menos animaciones, más batería', fr: 'Moins d\'animations, plus d\'autonomie', ru: 'Меньше анимаций, дольше батарея', tr: 'Daha az animasyon, daha uzun pil', ur: 'کم اینیمیشن، زیادہ بیٹری', id: 'Lebih sedikit animasi, baterai lebih awet', pt: 'Menos animações, mais bateria' },
  'settings.compactModeSub': { zh: '一屏显示更多内容', hi: 'स्क्रीन पर ज़्यादा दिखाएँ', es: 'Muestra más en pantalla', fr: 'Afficher plus à l\'écran', ru: 'Больше информации на экране', tr: 'Ekranda daha fazlasını göster', ur: 'اسکرین پر زیادہ دکھائیں', id: 'Tampilkan lebih banyak di layar', pt: 'Mostra mais no ecrã' },
  'settings.evmNetwork': { zh: 'EVM 网络', hi: 'EVM नेटवर्क', es: 'Red EVM', fr: 'Réseau EVM', ru: 'Сеть EVM', tr: 'EVM ağı', ur: 'EVM نیٹ ورک', id: 'Jaringan EVM', pt: 'Rede EVM' },
  'settings.evmNetworkSub': { zh: '用于兑换的链', hi: 'स्वैप के लिए चेन', es: 'Cadena usada para intercambios', fr: 'Chaîne utilisée pour les échanges', ru: 'Сеть для обменов', tr: 'Takaslarda kullanılan zincir', ur: 'سویپ کے لیے چین', id: 'Rantai untuk pertukaran', pt: 'Cadeia usada nas trocas' },
  'settings.solana': { zh: 'Solana 集群', hi: 'Solana क्लस्टर', es: 'Clúster de Solana', fr: 'Cluster Solana', ru: 'Кластер Solana', tr: 'Solana kümesi', ur: 'Solana کلسٹر', id: 'Klaster Solana', pt: 'Cluster Solana' },
  'settings.solanaSub': { zh: '用于 Solana 功能', hi: 'Solana फ़ीचर्स के लिए', es: 'Para funciones de Solana', fr: 'Pour les fonctions Solana', ru: 'Для функций Solana', tr: 'Solana özellikleri için', ur: 'Solana خصوصیات کے لیے', id: 'Untuk fitur Solana', pt: 'Para funcionalidades Solana' },
  'settings.customRpc': { zh: '自定义 RPC', hi: 'कस्टम RPC', es: 'RPC personalizado', fr: 'RPC personnalisé', ru: 'Свой RPC', tr: 'Özel RPC', ur: 'اپنی مرضی کا RPC', id: 'RPC kustom', pt: 'RPC personalizado' },
  'settings.customRpcSub': { zh: '使用你自己的节点', hi: 'अपना नोड इस्तेमाल करें', es: 'Usa tu propio nodo', fr: 'Utiliser votre propre nœud', ru: 'Использовать свой узел', tr: 'Kendi düğümünüzü kullanın', ur: 'اپنا نوڈ استعمال کریں', id: 'Gunakan node Anda sendiri', pt: 'Usar o seu próprio nó' },
  'settings.customRpcHelp': { zh: '覆盖默认的公共 RPC 端点。留空则使用默认值。', hi: 'डिफ़ॉल्ट सार्वजनिक RPC बदलें। खाली छोड़ने पर डिफ़ॉल्ट चलेगा।', es: 'Sustituye los endpoints RPC públicos por defecto. Déjalo vacío para usar los predeterminados.', fr: 'Remplace les endpoints RPC publics par défaut. Laissez vide pour les valeurs par défaut.', ru: 'Заменяет публичные RPC по умолчанию. Оставьте пустым для значений по умолчанию.', tr: 'Varsayılan genel RPC uç noktalarını değiştirir. Boş bırakırsanız varsayılanlar kullanılır.', ur: 'ڈیفالٹ عوامی RPC اینڈ پوائنٹس بدلیں۔ خالی چھوڑنے پر ڈیفالٹ استعمال ہوں گے۔', id: 'Mengganti endpoint RPC publik bawaan. Kosongkan untuk memakai bawaan.', pt: 'Substitui os endpoints RPC públicos padrão. Deixe vazio para usar os padrões.' },
  'settings.rpcWarn': {
    zh: '恶意的 RPC 节点可以向你显示伪造的余额和价格。只使用你信任的端点。',
    hi: 'दुर्भावनापूर्ण RPC आपको नक़ली बैलेंस और क़ीमतें दिखा सकता है। केवल भरोसेमंद endpoint इस्तेमाल करें।',
    es: 'Un RPC malicioso puede mostrarte saldos y precios falsos. Usa solo endpoints en los que confíes.',
    fr: 'Un RPC malveillant peut vous afficher de faux soldes et de faux prix. N\'utilisez que des endpoints de confiance.',
    ru: 'Вредоносный RPC может показывать поддельные балансы и цены. Используйте только доверенные адреса.',
    tr: 'Kötü niyetli bir RPC size sahte bakiye ve fiyat gösterebilir. Yalnızca güvendiğiniz uç noktaları kullanın.',
    ur: 'بدنیت RPC آپ کو جعلی بیلنس اور قیمتیں دکھا سکتا ہے۔ صرف قابل اعتماد اینڈ پوائنٹس استعمال کریں۔',
    id: 'RPC berbahaya dapat menampilkan saldo dan harga palsu. Gunakan hanya endpoint yang Anda percayai.',
    pt: 'Um RPC malicioso pode mostrar-lhe saldos e preços falsos. Use apenas endpoints em que confie.'
  }
};
