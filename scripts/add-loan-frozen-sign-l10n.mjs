#!/usr/bin/env node
/**
 * LOAN LOCALE ROUND 3 — the keys the 2026-09-23 loan-page fixes introduced.
 * ---------------------------------------------------------------------------
 * Round 2 (scripts/add-loan-error-l10n-round2.mjs) covered the failure codes
 * the page could already produce. Three changes in this round made new
 * sentences possible, and a missing sentence is not a cosmetic gap here — the
 * page renders codes through src/lib/loanErrors.js, which falls back to a
 * translated generic WHEN a key is absent, but the specific, actionable
 * sentence is the whole point of these three:
 *
 *   · loan.error.MARKET_FROZEN — frozen ≠ paused. Aave's wind-down (Sonic,
 *     Scroll, zkSync, Metis, Soneium, Aptos) freezes every reserve; repay and
 *     withdraw stay open. The old code answered that state with MARKET_PAUSED
 *     and blocked all four actions, so the sentence has to be its own.
 *   · loan.error.TIMEOUT — the wallet layer names it; the page used to answer
 *     UNKNOWN («the transaction did not go through») for it.
 *   · loan.reserveFrozenHint — the one-line label on a frozen reserve card,
 *     which is now SELECTABLE (unwinding a position must stay possible).
 *   · loan.solana.pending* — the deep-link hand-off: the request is in the
 *     wallet app, and the page finishes it on return.
 *
 * Also REVISES loan.error.RPC_BLOCKED: the round-2 wording said every node
 * refused, which is only true when all of them did. One provider refusing
 * (403) while another is merely unreachable is the common case and the
 * sentence must not overclaim.
 *
 * Run: node scripts/add-loan-frozen-sign-l10n.mjs
 * Idempotent for additions; the REVISIONS below are applied deliberately.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const STRINGS = {
  en: {
    "error.RPC_UNAVAILABLE": "That node answered with something we could not use.",
    "rpc.title": "لم تُقرأ بيانات السوق",
    "rpc.body": "Every public RPC node we tried failed. This is what each one answered:",
    "rpc.useOwn": "Public nodes come and go. Add your own RPC in Settings → Networks so this page stops depending on them.",
    "wallet.title": "The wallet did not open for signing",
    "wallet.switch": "افتح تطبيق المحفظة أو أزل قفله، وتأكد أنه على شبكة Solana الرئيسية، ثم أعد المحاولة. لم يُرسل أي شيء ولم تُخصم أي رسوم.",
    "error.KAMINO_TX_BUILD_FAILED": "Kamino could not build this transaction, so nothing was signed and nothing was sent. Try again in a moment.",
    "error.NO_SIGNATURE": "The wallet answered without a signature, so nothing was sent.",
    "error.KAMINO_SDK_MIME": "The Kamino module was served with the wrong content type (the server answered with a page, not the module) — reload the app.",
    "error.KAMINO_SDK_RECOVERED": "The Kamino module loaded after a retry. If something fails, reload the app.",
    'error.MARKET_FROZEN': 'The protocol has frozen this reserve: new deposits and new borrows are closed on it. Repaying and withdrawing still work, and those are the way to close an open position.',
    'error.TIMEOUT': 'The wallet did not answer in time, so nothing was sent. Open the wallet app and try again.',
    'reserveFrozenHint': 'Frozen — repay and withdraw only',
    'solana.pendingTitle': 'The request is in your wallet',
    'solana.pendingBody': 'We handed the signature to your wallet app. Approve it there — when you come back we claim the answer ourselves, confirm it on-chain and update your position. Nothing is lost by leaving this screen.',
    'solana.pendingReopen': 'Open the wallet again',
    'solana.pendingCheck': 'Check the result'
  },
  fa: {
    "error.RPC_UNAVAILABLE": "آن گره پاسخ داد، ولی پاسخی که نتوانستیم استفاده کنیم.",
    "rpc.title": "به شبکه نرسیدیم",
    "rpc.body": "هر گره RPC عمومی که امتحان کردیم پاسخ نداد. پاسخ هرکدام این بود:",
    "rpc.useOwn": "گره‌های عمومی می‌آیند و می‌روند. در تنظیمات ← شبکه‌ها RPC خودت را وارد کن تا این صفحه به آن‌ها وابسته نماند.",
    "wallet.title": "کیف پول برای امضا باز نشد",
    "wallet.switch": "کیف پول را عوض کن یا دوباره وصل کن و باز تلاش کن. اگر تکرار شد، گزارش خود کیف پول در پایین دلیل را می‌گوید.",
    "error.KAMINO_TX_BUILD_FAILED": "Kamino نتوانست این تراکنش را بسازد؛ چیزی امضا و ارسال نشد. لحظاتی بعد دوباره تلاش کن.",
    "error.NO_SIGNATURE": "کیف پول بدون امضا پاسخ داد، پس چیزی ارسال نشد.",
    "error.KAMINO_SDK_MIME": "ماژول Kamino با نوع محتوای اشتباه سرو شد (سرور به‌جای ماژول یک صفحه برگرداند) — اپ را دوباره بارگذاری کن.",
    "error.KAMINO_SDK_RECOVERED": "ماژول Kamino پس از تلاش دوباره بارگذاری شد. اگر خطایی دیدی، اپ را دوباره باز کن.",
    'error.MARKET_FROZEN': 'پروتکل این رزرو را منجمد کرده: سپرده‌گذاری و وام‌گیری جدید روی آن بسته است. بازپرداخت و برداشت هنوز کار می‌کند و همان راه بستن پوزیشن باز است.',
    'error.TIMEOUT': 'کیف پول در مهلت مقرر پاسخ نداد، پس چیزی ارسال نشد. اپ کیف پول را باز کن و دوباره تلاش کن.',
    'reserveFrozenHint': 'منجمد — فقط بازپرداخت و برداشت',
    'solana.pendingTitle': 'درخواست در کیف پول توست',
    'solana.pendingBody': 'امضا را به اپ کیف پول سپردیم. آنجا تأییدش کن — با برگشتنت خودمان پاسخ را می‌گیریم، زنجیره‌ای تأییدش می‌کنیم و پوزیشن را به‌روز می‌کنیم. با رفتن از این صفحه چیزی گم نمی‌شود.',
    'solana.pendingReopen': 'باز کردن دوباره کیف پول',
    'solana.pendingCheck': 'بررسی نتیجه'
  },
  ar: {
    "error.RPC_UNAVAILABLE": "تلك العقدة أجابت بشيء لم نستطع استخدامه.",
    "rpc.title": "لم نصل إلى الشبكة",
    "rpc.body": "كل عقدة RPC عامة جرّبناها لم تنجح. هذا ما أجابت به كل واحدة:",
    "rpc.useOwn": "العقد العامة تأتي وتذهب. أدخل RPC الخاص بك من الإعدادات ← الشبكات حتى لا تعتمد هذه الصفحة عليها.",
    "wallet.title": "لم تُفتح المحفظة للتوقيع",
    "wallet.switch": "بدّل المحفظة أو أعد ربطها ثم جرّب مرة أخرى. وإن تكرر الأمر، تقرير المحفظة نفسه أدناه يذكر السبب.",
    "error.KAMINO_TX_BUILD_FAILED": "لم تستطع Kamino بناء هذه المعاملة، فلم يُوقّع ولم يُرسل شيء. أعد المحاولة بعد لحظات.",
    "error.NO_SIGNATURE": "أجابت المحفظة دون توقيع، فلم يُرسل شيء.",
    "error.KAMINO_SDK_MIME": "قُدّم وحدة Kamino بنوع محتوى خاطئ (أعاد الخادم صفحة بدل الوحدة) — أعد تحميل التطبيق.",
    "error.KAMINO_SDK_RECOVERED": "حُمّلت وحدة Kamino بعد إعادة المحاولة. إن ظهر خطأ فأعد تحميل التطبيق.",
    'error.MARKET_FROZEN': 'جمّد البروتوكول هذا الاحتياطي: الإيداع الجديد والاقتراض الجديد مغلقان عليه. السداد والسحب ما زالا يعملان، وهما طريق إغلاق مركز مفتوح.',
    'error.TIMEOUT': 'لم تجب المحفظة في الوقت المحدد، فلم يُرسل شيء. افتح تطبيق المحفظة وأعد المحاولة.',
    'reserveFrozenHint': 'مجمّد — السداد والسحب فقط',
    'solana.pendingTitle': 'الطلب في محفظتك',
    'solana.pendingBody': 'سلّمنا التوقيع إلى تطبيق محفظتك. وافق عليه هناك — وعند عودتك نستلم الجواب بأنفسنا ونؤكده على السلسلة ونحدّث مركزك. مغادرة هذه الشاشة لا تضيّع شيئًا.',
    'solana.pendingReopen': 'فتح المحفظة من جديد',
    'solana.pendingCheck': 'تحقّق من النتيجة'
  },
  es: {
    "error.RPC_UNAVAILABLE": "Ese nodo respondió con algo que no pudimos usar.",
    "rpc.title": "No se pudieron leer los datos del mercado",
    "rpc.body": "Probamos estos nodos de Solana; la respuesta de cada uno está abajo.",
    "rpc.useOwn": "Añade tu propio RPC en Ajustes → Redes para que la aplicación deje de depender de nodos públicos.",
    "wallet.title": "La cartera no se abrió",
    "wallet.switch": "Desbloquea la cartera, comprueba que esté en Solana mainnet y vuelve a intentarlo. No se envió nada ni se cobró comisión.",
    "error.KAMINO_TX_BUILD_FAILED": "Kamino no pudo construir esta transacción, así que no se firmó ni se envió nada. Inténtalo otra vez en un momento.",
    "error.NO_SIGNATURE": "La cartera respondió sin firma, así que no se envió nada.",
    "error.KAMINO_SDK_MIME": "El módulo de Kamino se sirvió con un tipo de contenido incorrecto (el servidor devolvió una página en vez del módulo): recarga la app.",
    "error.KAMINO_SDK_RECOVERED": "El módulo de Kamino cargó tras reintentar. Si algo falla, recarga la app.",
    'error.MARKET_FROZEN': 'El protocolo ha congelado esta reserva: los nuevos depósitos y préstamos están cerrados. Pagar y retirar siguen funcionando, y esa es la vía para cerrar una posición abierta.',
    'error.TIMEOUT': 'La cartera no respondió a tiempo, así que no se envió nada. Abre la app de la cartera e inténtalo otra vez.',
    'reserveFrozenHint': 'Congelado — solo pagar y retirar',
    'solana.pendingTitle': 'La petición está en tu cartera',
    'solana.pendingBody': 'Entregamos la firma a tu app de cartera. Apruébala allí: al volver reclamamos la respuesta, la confirmamos en la cadena y actualizamos tu posición. Salir de esta pantalla no pierde nada.',
    'solana.pendingReopen': 'Abrir la cartera otra vez',
    'solana.pendingCheck': 'Comprobar el resultado'
  },
  fr: {
    "error.RPC_UNAVAILABLE": "Ce nœud a répondu quelque chose que nous n’avons pas pu utiliser.",
    "rpc.title": "Les données du marché n'ont pas pu être lues",
    "rpc.body": "Nous avons essayé ces nœuds Solana ; la réponse de chacun est ci-dessous.",
    "rpc.useOwn": "Ajoutez votre propre RPC dans Réglages → Réseaux pour que l'application ne dépende plus des nœuds publics.",
    "wallet.title": "Le portefeuille ne s'est pas ouvert",
    "wallet.switch": "Déverrouillez le portefeuille, vérifiez qu'il est sur Solana mainnet, puis réessayez. Rien n'a été envoyé et aucun frais n'a été prélevé.",
    "error.KAMINO_TX_BUILD_FAILED": "Kamino n’a pas pu construire cette transaction : rien n’a été signé ni envoyé. Réessayez dans un instant.",
    "error.NO_SIGNATURE": "Le portefeuille a répondu sans signature, donc rien n’a été envoyé.",
    "error.KAMINO_SDK_MIME": "Le module Kamino a été servi avec un mauvais type de contenu (le serveur a renvoyé une page au lieu du module) — rechargez l’app.",
    "error.KAMINO_SDK_RECOVERED": "Le module Kamino s’est chargé après une nouvelle tentative. En cas d’échec, rechargez l’app.",
    'error.MARKET_FROZEN': 'Le protocole a gelé cette réserve : les nouveaux dépôts et emprunts sont fermés. Le remboursement et le retrait fonctionnent encore, et c’est la voie pour clôturer une position ouverte.',
    'error.TIMEOUT': 'Le portefeuille n’a pas répondu à temps, rien n’a été envoyé. Ouvrez l’app du portefeuille et réessayez.',
    'reserveFrozenHint': 'Gelé — remboursement et retrait uniquement',
    'solana.pendingTitle': 'La demande est dans votre portefeuille',
    'solana.pendingBody': 'Nous avons transmis la signature à votre app de portefeuille. Validez-la là-bas : à votre retour, nous récupérons la réponse, la confirmons sur la chaîne et mettons à jour votre position. Quitter cet écran ne perd rien.',
    'solana.pendingReopen': 'Rouvrir le portefeuille',
    'solana.pendingCheck': 'Vérifier le résultat'
  },
  hi: {
    "error.RPC_UNAVAILABLE": "उस नोड ने ऐसा जवाब दिया जिसका हम उपयोग नहीं कर सके।",
    "rpc.title": "बाज़ार डेटा पढ़ा नहीं जा सका",
    "rpc.body": "हमने ये Solana नोड आज़माए; हर एक का जवाब नीचे है।",
    "rpc.useOwn": "सेटिंग्स → नेटवर्क में अपना RPC जोड़ें ताकि ऐप सार्वजनिक नोड्स पर निर्भर न रहे।",
    "wallet.title": "वॉलेट नहीं खुला",
    "wallet.switch": "वॉलेट अनलॉक करें, देखें कि वह Solana मेननेट पर है, फिर दोबारा कोशिश करें। कुछ भेजा नहीं गया और कोई शुल्क नहीं लगा।",
    "error.KAMINO_TX_BUILD_FAILED": "Kamino यह ट्रांज़ैक्शन बना नहीं सका, इसलिए न साइन हुआ न कुछ भेजा गया। थोड़ी देर बाद फिर कोशिश करें।",
    "error.NO_SIGNATURE": "वॉलेट ने बिना साइन के जवाब दिया, इसलिए कुछ नहीं भेजा गया।",
    "error.KAMINO_SDK_MIME": "Kamino मॉड्यूल गलत content-type के साथ मिला (सर्वर ने मॉड्यूल की जगह पेज भेजा) — ऐप दोबारा लोड करें।",
    "error.KAMINO_SDK_RECOVERED": "दोबारा कोशिश के बाद Kamino मॉड्यूल लोड हो गया। कुछ फेल हो तो ऐप दोबारा लोड करें।",
    'error.MARKET_FROZEN': 'प्रोटोकॉल ने इस रिज़र्व को फ़्रीज़ कर दिया है: नई जमा और नया कर्ज़ बंद है। चुकौती और निकासी अब भी चलती हैं, और खुली पोज़िशन बंद करने का रास्ता वही है।',
    'error.TIMEOUT': 'वॉलेट ने समय पर जवाब नहीं दिया, इसलिए कुछ नहीं भेजा गया। वॉलेट ऐप खोलकर फिर कोशिश करें।',
    'reserveFrozenHint': 'फ़्रीज़ — सिर्फ़ चुकौती और निकासी',
    'solana.pendingTitle': 'अनुरोध आपके वॉलेट में है',
    'solana.pendingBody': 'हमने साइन करने का अनुरोध आपके वॉलेट ऐप को दे दिया है। वहीं मंज़ूरी दें — लौटने पर हम खुद जवाब लेते हैं, चेन पर पुष्टि करते हैं और आपकी पोज़िशन अपडेट करते हैं। इस स्क्रीन से हटने पर कुछ नहीं खोता।',
    'solana.pendingReopen': 'वॉलेट दोबारा खोलें',
    'solana.pendingCheck': 'नतीजा देखें'
  },
  id: {
    "error.RPC_UNAVAILABLE": "Node itu menjawab dengan sesuatu yang tidak dapat kami gunakan.",
    "rpc.title": "Data pasar tidak dapat dibaca",
    "rpc.body": "Kami mencoba node Solana berikut; jawaban masing-masing ada di bawah.",
    "rpc.useOwn": "Tambahkan RPC Anda sendiri di Pengaturan → Jaringan agar aplikasi tidak lagi bergantung pada node publik.",
    "wallet.title": "Dompet tidak terbuka",
    "wallet.switch": "Buka kunci dompet, pastikan berada di Solana mainnet, lalu coba lagi. Tidak ada yang dikirim dan tidak ada biaya.",
    "error.KAMINO_TX_BUILD_FAILED": "Kamino tidak bisa membangun transaksi ini, jadi tidak ada yang ditandatangani atau dikirim. Coba lagi sebentar.",
    "error.NO_SIGNATURE": "Dompet menjawab tanpa tanda tangan, jadi tidak ada yang dikirim.",
    "error.KAMINO_SDK_MIME": "Modul Kamino disajikan dengan content-type yang salah (server mengirim halaman, bukan modul) — muat ulang aplikasi.",
    "error.KAMINO_SDK_RECOVERED": "Modul Kamino termuat setelah diulang. Kalau ada yang gagal, muat ulang aplikasi.",
    'error.MARKET_FROZEN': 'Protokol membekukan cadangan ini: setoran baru dan pinjaman baru ditutup. Pelunasan dan penarikan masih berjalan, dan itulah jalan menutup posisi yang terbuka.',
    'error.TIMEOUT': 'Dompet tidak menjawab tepat waktu, jadi tidak ada yang dikirim. Buka aplikasi dompet dan coba lagi.',
    'reserveFrozenHint': 'Dibekukan — hanya pelunasan dan penarikan',
    'solana.pendingTitle': 'Permintaannya ada di dompetmu',
    'solana.pendingBody': 'Kami sudah menyerahkan tanda tangan ke aplikasi dompetmu. Setujui di sana — saat kamu kembali, kami sendiri yang mengambil jawabannya, memastikannya di rantai, dan memperbarui posisimu. Meninggalkan layar ini tidak menghilangkan apa pun.',
    'solana.pendingReopen': 'Buka dompet lagi',
    'solana.pendingCheck': 'Periksa hasilnya'
  },
  pt: {
    "error.RPC_UNAVAILABLE": "Aquele nó respondeu com algo que não conseguimos usar.",
    "rpc.title": "Não foi possível ler os dados do mercado",
    "rpc.body": "Tentamos estes nós Solana; a resposta de cada um está abaixo.",
    "rpc.useOwn": "Adicione seu próprio RPC em Ajustes → Redes para o aplicativo parar de depender de nós públicos.",
    "wallet.title": "A carteira não abriu",
    "wallet.switch": "Desbloqueie a carteira, confirme que ela está na Solana mainnet e tente de novo. Nada foi enviado e nenhuma taxa foi cobrada.",
    "error.KAMINO_TX_BUILD_FAILED": "A Kamino não conseguiu montar esta transação, então nada foi assinado nem enviado. Tente de novo em instantes.",
    "error.NO_SIGNATURE": "A carteira respondeu sem assinatura, então nada foi enviado.",
    "error.KAMINO_SDK_MIME": "O módulo da Kamino foi servido com tipo de conteúdo errado (o servidor devolveu uma página em vez do módulo) — recarregue o app.",
    "error.KAMINO_SDK_RECOVERED": "O módulo da Kamino carregou após nova tentativa. Se algo falhar, recarregue o app.",
    'error.MARKET_FROZEN': 'O protocolo congelou esta reserva: novos depósitos e novos empréstimos estão fechados nela. Pagar e sacar continuam funcionando, e é esse o caminho para fechar uma posição aberta.',
    'error.TIMEOUT': 'A carteira não respondeu a tempo, então nada foi enviado. Abra o app da carteira e tente de novo.',
    'reserveFrozenHint': 'Congelado — apenas pagar e sacar',
    'solana.pendingTitle': 'A solicitação está na sua carteira',
    'solana.pendingBody': 'Entregamos a assinatura ao app da sua carteira. Aprove lá — ao voltar, nós mesmos buscamos a resposta, confirmamos na rede e atualizamos sua posição. Sair desta tela não perde nada.',
    'solana.pendingReopen': 'Abrir a carteira novamente',
    'solana.pendingCheck': 'Verificar o resultado'
  },
  ru: {
    "error.RPC_UNAVAILABLE": "Тот узел ответил так, что мы не смогли этим воспользоваться.",
    "rpc.title": "Не удалось прочитать данные рынка",
    "rpc.body": "Мы попробовали эти узлы Solana; ответ каждого — ниже.",
    "rpc.useOwn": "Добавьте свой RPC в «Настройки → Сети», чтобы приложение не зависело от публичных узлов.",
    "wallet.title": "Кошелёк не открылся",
    "wallet.switch": "Разблокируйте кошелёк, убедитесь, что выбрана сеть Solana mainnet, и повторите попытку. Ничего не отправлено, комиссия не списана.",
    "error.KAMINO_TX_BUILD_FAILED": "Kamino не смогла собрать эту транзакцию — ничего не подписано и не отправлено. Повторите попытку через момент.",
    "error.NO_SIGNATURE": "Кошелёк ответил без подписи, поэтому ничего не отправлено.",
    "error.KAMINO_SDK_MIME": "Модуль Kamino отдан с неверным типом содержимого (сервер вернул страницу вместо модуля) — перезагрузите приложение.",
    "error.KAMINO_SDK_RECOVERED": "Модуль Kamino загрузился после повтора. Если что-то не работает, перезагрузите приложение.",
    'error.MARKET_FROZEN': 'Протокол заморозил этот резерв: новые вклады и новые займы по нему закрыты. Погашение и вывод по-прежнему работают — это и есть путь закрыть открытую позицию.',
    'error.TIMEOUT': 'Кошелёк не ответил вовремя, поэтому ничего не отправлено. Откройте приложение кошелька и попробуйте снова.',
    'reserveFrozenHint': 'Заморожено — только погашение и вывод',
    'solana.pendingTitle': 'Запрос в вашем кошельке',
    'solana.pendingBody': 'Мы передали подпись в приложение кошелька. Подтвердите её там — при возврате мы сами заберём ответ, подтвердим его в сети и обновим позицию. Уход с этого экрана ничего не теряет.',
    'solana.pendingReopen': 'Открыть кошелёк снова',
    'solana.pendingCheck': 'Проверить результат'
  },
  tr: {
    "error.RPC_UNAVAILABLE": "O düğüm kullanabileceğimiz bir yanıt vermedi.",
    "rpc.title": "Piyasa verileri okunamadı",
    "rpc.body": "Şu Solana düğümlerini denedik; her birinin yanıtı aşağıda.",
    "rpc.useOwn": "Ayarlar → Ağlar bölümünden kendi RPC adresinizi ekleyin; uygulama herkese açık düğümlere bağımlı kalmasın.",
    "wallet.title": "Cüzdan açılmadı",
    "wallet.switch": "Cüzdanın kilidini açın, Solana mainnet ağında olduğundan emin olun ve yeniden deneyin. Hiçbir şey gönderilmedi, ücret alınmadı.",
    "error.KAMINO_TX_BUILD_FAILED": "Kamino bu işlemi oluşturamadı, bu yüzden hiçbir şey imzalanmadı ve gönderilmedi. Birazdan tekrar dene.",
    "error.NO_SIGNATURE": "Cüzdan imza olmadan yanıt verdi, bu yüzden hiçbir şey gönderilmedi.",
    "error.KAMINO_SDK_MIME": "Kamino modülü yanlış içerik türüyle sunuldu (sunucu modül yerine bir sayfa döndürdü) — uygulamayı yeniden yükle.",
    "error.KAMINO_SDK_RECOVERED": "Kamino modülü yeniden denemeden sonra yüklendi. Bir şey başarısız olursa uygulamayı yeniden yükle.",
    'error.MARKET_FROZEN': 'Protokol bu rezervi dondurdu: yeni mevduat ve yeni kredi kapalı. Geri ödeme ve çekim hâlâ çalışıyor; açık bir pozisyonu kapatmanın yolu da bu.',
    'error.TIMEOUT': 'Cüzdan zamanında yanıt vermedi, bu yüzden hiçbir şey gönderilmedi. Cüzdan uygulamasını açıp tekrar dene.',
    'reserveFrozenHint': 'Donduruldu — yalnızca geri ödeme ve çekim',
    'solana.pendingTitle': 'İstek cüzdanında',
    'solana.pendingBody': 'İmzayı cüzdan uygulamana ilettik. Orada onayla — döndüğünde yanıtı biz alır, zincirde doğrular ve pozisyonunu güncelleriz. Bu ekrandan ayrılmak hiçbir şeyi kaybettirmez.',
    'solana.pendingReopen': 'Cüzdanı yeniden aç',
    'solana.pendingCheck': 'Sonucu kontrol et'
  },
  ur: {
    "error.RPC_UNAVAILABLE": "اُس نوڈ نے ایسا جواب دیا جسے ہم استعمال نہیں کر سکے۔",
    "rpc.title": "مارکیٹ ڈیٹا پڑھا نہیں جا سکا",
    "rpc.body": "ہم نے یہ Solana نوڈ آزمائے؛ ہر ایک کا جواب نیچے ہے۔",
    "rpc.useOwn": "سیٹنگز → نیٹ ورکس میں اپنا RPC شامل کریں تاکہ ایپ عوامی نوڈز پر منحصر نہ رہے۔",
    "wallet.title": "والٹ نہیں کھلا",
    "wallet.switch": "والٹ کھولیں، یقینی بنائیں کہ یہ Solana مین نیٹ پر ہے، پھر دوبارہ کوشش کریں۔ کچھ بھی نہیں بھیجا گیا اور کوئی فیس نہیں لگی۔",
    "error.KAMINO_TX_BUILD_FAILED": "Kamino یہ ٹرانزیکشن بنا نہ سکا، اس لیے نہ دستخط ہوئے نہ کچھ بھیجا گیا۔ تھوڑی دیر بعد دوبارہ کوشش کریں۔",
    "error.NO_SIGNATURE": "والٹ نے بغیر دستخط جواب دیا، اس لیے کچھ نہیں بھیجا گیا۔",
    "error.KAMINO_SDK_MIME": "Kamino ماڈیول غلط content-type کے ساتھ ملا (سرور نے ماڈیول کے بجائے صفحہ بھیجا) — ایپ دوبارہ لوڈ کریں۔",
    "error.KAMINO_SDK_RECOVERED": "دوبارہ کوشش کے بعد Kamino ماڈیول لوڈ ہو گیا۔ کچھ ناکام ہو تو ایپ دوبارہ لوڈ کریں۔",
    'error.MARKET_FROZEN': 'پروٹوکول نے اس ریزرو کو منجمد کر دیا ہے: نئی جمع اور نیا قرض بند ہے۔ ادائیگی اور نکاسی اب بھی چلتی ہیں، اور کھلی پوزیشن بند کرنے کا راستہ یہی ہے۔',
    'error.TIMEOUT': 'والٹ نے وقت پر جواب نہیں دیا، اس لیے کچھ نہیں بھیجا گیا۔ والٹ ایپ کھول کر دوبارہ کوشش کریں۔',
    'reserveFrozenHint': 'منجمد — صرف ادائیگی اور نکاسی',
    'solana.pendingTitle': 'درخواست آپ کے والٹ میں ہے',
    'solana.pendingBody': 'ہم نے دستخط کی درخواست آپ کے والٹ ایپ کو دے دی ہے۔ وہیں منظور کریں — واپسی پر ہم خود جواب لیتے ہیں، چین پر تصدیق کرتے ہیں اور آپ کی پوزیشن اپڈیٹ کرتے ہیں۔ اس اسکرین سے جانے پر کچھ ضائع نہیں ہوتا۔',
    'solana.pendingReopen': 'والٹ دوبارہ کھولیں',
    'solana.pendingCheck': 'نتیجہ دیکھیں'
  },
  zh: {
    "error.RPC_UNAVAILABLE": "该节点返回了我们无法使用的内容。",
    "rpc.title": "无法读取市场数据",
    "rpc.body": "我们尝试了以下 Solana 节点；各自的结果如下。",
    "rpc.useOwn": "在“设置 → 网络”中添加你自己的 RPC，应用就不再依赖公共节点。",
    "wallet.title": "钱包未打开",
    "wallet.switch": "请解锁钱包，确认已切换到 Solana 主网，然后重试。没有任何内容被发送，也未收取费用。",
    "error.KAMINO_TX_BUILD_FAILED": "Kamino 无法构建这笔交易，因此没有任何内容被签名或发送。请稍后再试。",
    "error.NO_SIGNATURE": "钱包回复中没有签名，因此没有发送任何内容。",
    "error.KAMINO_SDK_MIME": "Kamino 模块的内容类型不正确（服务器返回的是页面而不是模块）——请重新加载应用。",
    "error.KAMINO_SDK_RECOVERED": "重试后 Kamino 模块已加载。若出现问题，请重新加载应用。",
    'error.MARKET_FROZEN': '协议已冻结该储备：新的存款和借款已关闭。还款和提现仍然可用，这正是了结已有仓位的途径。',
    'error.TIMEOUT': '钱包没有及时响应，因此没有发送任何内容。请打开钱包应用后重试。',
    'reserveFrozenHint': '已冻结——仅可还款和提现',
    'solana.pendingTitle': '请求在你的钱包里',
    'solana.pendingBody': '我们已把签名请求交给你的钱包应用。请在那里确认——你回来时我们会自己取回结果，在链上确认并更新你的仓位。离开此页面不会丢失任何进度。',
    'solana.pendingReopen': '再次打开钱包',
    'solana.pendingCheck': '查看结果'
  }
};

/* Deliberate text revisions — applied even when the key already exists, so a
   wording that overclaimed («every node refused») can be corrected. */
const REVISIONS = {
  en: { 'error.RPC_BLOCKED': 'One or more Solana nodes refused the request (403 — a provider or network block, not a rate limit). Try again, or enter your own RPC in Settings → Networks.' },
  fa: { 'error.RPC_BLOCKED': 'یک یا چند گره سولانا درخواست را رد کردند (۴۰۳ — مسدودسازی از سمت ارائه‌دهنده یا شبکه، نه محدودیت نرخ). دوباره تلاش کن یا در تنظیمات ← شبکه‌ها RPC خودت را وارد کن.' },
  ar: { 'error.RPC_BLOCKED': 'عقدة سولانا واحدة أو أكثر رفضت الطلب (403 — حجب من المزوّد أو الشبكة وليس تحديد معدّل). أعد المحاولة، أو أدخل RPC الخاص بك من الإعدادات ← الشبكات.' },
  es: { 'error.RPC_BLOCKED': 'Uno o más nodos de Solana rechazaron la petición (403: un bloqueo del proveedor o de la red, no un límite de velocidad). Inténtalo otra vez, o pon tu propio RPC en Ajustes → Redes.' },
  fr: { 'error.RPC_BLOCKED': 'Un ou plusieurs nœuds Solana ont refusé la requête (403 — un blocage du fournisseur ou du réseau, pas une limite de débit). Réessayez, ou renseignez votre propre RPC dans Réglages → Réseaux.' },
  hi: { 'error.RPC_BLOCKED': 'एक या अधिक Solana नोड ने अनुरोध ठुकरा दिया (403 — प्रोवाइडर या नेटवर्क की ब्लॉकिंग, रेट-लिमिट नहीं)। दोबारा कोशिश करें, या Settings → Networks में अपना RPC डालें।' },
  id: { 'error.RPC_BLOCKED': 'Satu atau beberapa node Solana menolak permintaan (403 — blokir dari penyedia atau jaringan, bukan batas laju). Coba lagi, atau isi RPC sendiri di Pengaturan → Jaringan.' },
  pt: { 'error.RPC_BLOCKED': 'Um ou mais nós Solana recusaram a solicitação (403 — bloqueio do provedor ou da rede, não um limite de taxa). Tente de novo, ou informe seu próprio RPC em Configurações → Redes.' },
  ru: { 'error.RPC_BLOCKED': 'Один или несколько узлов Solana отклонили запрос (403 — блокировка провайдера или сети, а не лимит скорости). Повторите попытку или укажите свой RPC в «Настройки → Сети».' },
  tr: { 'error.RPC_BLOCKED': 'Bir veya daha fazla Solana düğümü isteği reddetti (403 — sağlayıcı/ağ engeli, hız sınırı değil). Tekrar dene ya da Ayarlar → Ağlar bölümüne kendi RPC’ni gir.' },
  ur: { 'error.RPC_BLOCKED': 'ایک یا زیادہ سولانا نوڈز نے درخواست رد کر دی (403 — provider یا نیٹ ورک کی بلاکنگ، ریٹ لِمٹ نہیں)۔ دوبارہ کوشش کریں یا Settings → Networks میں اپنا RPC ڈالیں۔' },
  zh: { 'error.RPC_BLOCKED': '一个或多个 Solana 节点拒绝了请求（403——来自提供方或网络的封锁，而非限速）。请重试，或在“设置 → 网络”中填入自己的 RPC。' }
};

const setPath = (object, dotted, value, { force = false } = {}) => {
  const parts = dotted.split('.');
  let node = object;
  for (const part of parts.slice(0, -1)) {
    if (node[part] == null || typeof node[part] !== 'object') node[part] = {};
    node = node[part];
  }
  const leaf = parts[parts.length - 1];
  if (node[leaf] != null && !force) return false;
  node[leaf] = value;
  return true;
};

let failed = false;
for (const [lang, strings] of Object.entries(STRINGS)) {
  const path = resolve(root, `src/i18n/locales/${lang}.json`);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (!data.loan || typeof data.loan !== 'object') {
    console.error(`✗ ${lang}: no loan object`);
    failed = true;
    continue;
  }
  let added = 0;
  for (const [dotted, value] of Object.entries(strings)) {
    if (setPath(data.loan, dotted, value)) added += 1;
  }
  let revised = 0;
  for (const [dotted, value] of Object.entries(REVISIONS[lang] || {})) {
    if (setPath(data.loan, dotted, value, { force: true })) revised += 1;
  }
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`${added ? '✓' : '•'} ${lang}: ${added} keys added, ${revised} revised`);
}

if (failed) process.exitCode = 1;
