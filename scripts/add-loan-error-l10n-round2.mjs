#!/usr/bin/env node
/**
 * LOAN LOCALE ROUND 2 — the keys the 2026-09-23 report needed.
 * ---------------------------------------------------------------------------
 * Report: «سه‌جا با استرینگ هست به جای زبان درست» + «در شبکه سونیک اصلا فریز و
 * قابل وام نیست» + the Solana RPC failure.
 *
 * What this adds, and why each group is here:
 *
 *   loan.error.*            every code the loan page/wallet layer can put in
 *                           front of a user but no locale had a sentence for.
 *                           A missing key is not cosmetic: the page rendered
 *                           the CODE (`MARKET_PAUSED`) and the toast rendered
 *                           its own key path (`loan.error.MARKET_PAUSED`).
 *                           `UNKNOWN_WITH_CODE` is the new generic: it keeps
 *                           the machine code for support INSIDE a translated
 *                           sentence, so an unknown failure never prints a
 *                           bare string again.
 *   loan.sheetTitle.approve the approval step's sheet title was missing in all
 *                           12 locales, so the sheet header read `approve` —
 *                           an English literal in a Persian UI.
 *   loan.marketHalted.*     a market whose every reserve the protocol has
 *                           frozen (Aave's 2026 wind-down of Sonic/Scroll/
 *                           zkSync/Metis/Soneium/Aptos freezes all reserves
 *                           and cuts the caps to 1). The page used to show a
 *                           list of greyed-out cards with a one-word label;
 *                           it now explains what happened and what still works.
 *
 * Run: node scripts/add-loan-error-l10n-round2.mjs
 * Idempotent: an existing key is never overwritten.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* Dotted paths under `loan.` — one object per language, so a translator reads
   a whole language at a time instead of one key at a time. */
const STRINGS = {
  en: {
    'error.RPC_BLOCKED': 'Every Solana node we tried refused the request (403). That is a provider or network block, not a rate limit — try again, or set your own RPC in Settings → Networks.',
    'error.BAD_PAYLOAD': 'The provider answered with something unusable. Try again in a moment.',
    'error.BAD_RESPONSE': 'The node answered with something that was not data. Try again in a moment.',
    'error.BAD_WALLET': 'This wallet cannot be used for this action.',
    'error.BFF_UNAVAILABLE': 'The app’s own server is not answering. Nothing was sent — try again in a moment.',
    'error.CONNECT_FAILED': 'The wallet connection did not complete.',
    'error.GAS_LIMIT_UNAVAILABLE': 'The network fee could not be estimated, so no transaction was sent.',
    'error.IN_WALLET': 'The request was handed to your wallet app. Approve it there — the result will be here when you come back.',
    'error.NO_ACCOUNT': 'No account is available from this wallet.',
    'error.NO_ADDRESSES_PROVIDER': 'The pool did not reveal its addresses provider, so its oracle could not be read.',
    'error.NO_FETCH': 'This browser cannot make the network request.',
    'error.NO_SESSION': 'The wallet session has ended. Connect again.',
    'error.NO_WALLET': 'No Solana wallet was found on this device.',
    'error.REJECTED': 'You rejected the request in your wallet. Nothing was sent.',
    'error.SIGN_FAILED': 'The wallet did not sign. Nothing was sent.',
    'error.SEND_FAILED': 'The wallet did not send the transaction. Nothing was spent.',
    'error.BAD_TRANSACTION': 'The transaction could not be read before signing, so nothing was sent.',
    'error.UNSUPPORTED_TRANSACTION': 'This wallet does not accept this transaction format. The app tries the other format automatically — nothing was sent.',
    'error.TRANSACTION_FAILED': 'The chain rejected the transaction — only the network fee was spent.',
    'error.TRANSACTION_NOT_FOUND': 'The transaction is not visible on the nodes we tried yet. Check the explorer before retrying.',
    'error.UNSUPPORTED': 'This wallet cannot perform this action.',
    'error.UNKNOWN_WITH_CODE': 'The action did not go through ({{code}}). Only the network fee could have been spent; if it repeats, send this code to support.',
    'error.SOLANA_TX_FAILED': 'The Solana transaction did not succeed on-chain — nothing was spent.',
    'sheetTitle.approve': 'Approval',
    'marketHalted.title': 'This market is closed by the protocol',
    'marketHalted.body': 'Every reserve listed here is frozen by the protocol itself: new deposits and new borrows are closed, and these assets cannot be used as fresh collateral. Repayments and withdrawals still work, and open positions stay open.',
    'marketHalted.frozen': 'Frozen by the protocol',
    'marketHalted.paused': 'Paused by the protocol',
    'marketHalted.mixed': 'Partly frozen / paused by the protocol',
    'marketHalted.otherMarkets': 'To supply or borrow, pick another market on the rail above.',
    'marketHalted.repayHint': 'If you have a position here: repay first, then withdraw. Both are still allowed.'
  },
  fa: {
    'error.RPC_BLOCKED': 'هر گره سولانایی که امتحان کردیم درخواست را رد کرد (۴۰۳). این محدودیت نرخ نیست، مسدودسازی از سمت ارائه‌دهنده یا شبکه است — دوباره تلاش کن یا در تنظیمات ← شبکه‌ها RPC خودت را وارد کن.',
    'error.BAD_PAYLOAD': 'پاسخ ارائه‌دهنده قابل استفاده نبود. لحظاتی بعد دوباره تلاش کن.',
    'error.BAD_RESPONSE': 'گره پاسخی داد که داده نبود. لحظاتی بعد دوباره تلاش کن.',
    'error.BAD_WALLET': 'این کیف پول برای این کار قابل استفاده نیست.',
    'error.BFF_UNAVAILABLE': 'سرور خود اپ پاسخ نمی‌دهد. چیزی ارسال نشد — لحظاتی بعد دوباره تلاش کن.',
    'error.CONNECT_FAILED': 'اتصال کیف پول کامل نشد.',
    'error.GAS_LIMIT_UNAVAILABLE': 'کارمزد شبکه تخمین زده نشد، پس هیچ تراکنشی ارسال نشد.',
    'error.IN_WALLET': 'درخواست به اپ کیف پولت سپرده شد. آنجا تأییدش کن — با برگشتنت نتیجه همین‌جا آماده است.',
    'error.NO_ACCOUNT': 'هیچ حسابی از این کیف پول در دسترس نیست.',
    'error.NO_ADDRESSES_PROVIDER': 'استخر آدرس ارائه‌دهندهٔ خود را برنگرداند، پس اوراکلش خوانده نشد.',
    'error.NO_FETCH': 'این مرورگر نمی‌تواند درخواست شبکه‌ای بفرستد.',
    'error.NO_SESSION': 'نشست کیف پول تمام شده. دوباره وصل کن.',
    'error.NO_WALLET': 'روی این دستگاه کیف پول سولانا پیدا نشد.',
    'error.REJECTED': 'درخواست را در کیف پول رد کردی. چیزی ارسال نشد.',
    'error.SIGN_FAILED': 'کیف پول امضا نکرد. چیزی ارسال نشد.',
    'error.SEND_FAILED': 'کیف پول تراکنش را ارسال نکرد. چیزی خرج نشد.',
    'error.BAD_TRANSACTION': 'تراکنش پیش از امضا خوانده نشد، پس چیزی ارسال نشد.',
    'error.UNSUPPORTED_TRANSACTION': 'این کیف پول این قالب تراکنش را نمی‌پذیرد. اپ خودش قالب دیگر را امتحان می‌کند — چیزی ارسال نشد.',
    'error.TRANSACTION_FAILED': 'زنجیره تراکنش را رد کرد — فقط کارمزد شبکه خرج شد.',
    'error.TRANSACTION_NOT_FOUND': 'تراکنش روی گره‌هایی که امتحان کردیم هنوز دیده نمی‌شود. پیش از تلاش دوباره در مرورگر بررسی کن.',
    'error.UNSUPPORTED': 'این کیف پول نمی‌تواند این کار را انجام دهد.',
    'error.UNKNOWN_WITH_CODE': 'عملیات انجام نشد ({{code}}). نهایتاً کارمزد شبکه خرج شده؛ اگر تکرار شد همین کد را برای پشتیبانی بفرست.',
    'error.SOLANA_TX_FAILED': 'تراکنش سولانا زنجیره‌ای انجام نشد — چیزی خرج نشد.',
    'sheetTitle.approve': 'تأییدیه',
    'marketHalted.title': 'این بازار از سمت پروتکل بسته شده',
    'marketHalted.body': 'همهٔ رزروهای این استخر از سمت خود پروتکل منجمد شده‌اند: سپرده‌گذاری و وام‌گیری جدید بسته است و این دارایی‌ها به‌عنوان وثیقهٔ تازه پذیرفته نمی‌شوند. بازپرداخت و برداشت هنوز کار می‌کند و پوزیشن‌های باز باز می‌مانند.',
    'marketHalted.frozen': 'منجمدشده توسط پروتکل',
    'marketHalted.paused': 'متوقف‌شده توسط پروتکل',
    'marketHalted.mixed': 'بخشی منجمد / بخشی متوقف توسط پروتکل',
    'marketHalted.otherMarkets': 'برای سپرده‌گذاری یا وام‌گیری، از نوار بازار بالا یک بازار دیگر را انتخاب کن.',
    'marketHalted.repayHint': 'اگر اینجا پوزیشن داری: اول بازپرداخت، بعد برداشت. هر دو هنوز مجاز است.'
  },
  ar: {
    'error.RPC_BLOCKED': 'كل عقدة سولانا جرّبناها رفضت الطلب (403). هذا حجب من المزوّد أو الشبكة وليس تحديد معدّل — أعد المحاولة، أو أدخل RPC الخاص بك من الإعدادات ← الشبكات.',
    'error.BAD_PAYLOAD': 'كان رد المزوّد غير قابل للاستخدام. أعد المحاولة بعد لحظات.',
    'error.BAD_RESPONSE': 'أجابت العقدة بشيء ليس بيانات. أعد المحاولة بعد لحظات.',
    'error.BAD_WALLET': 'لا يمكن استخدام هذه المحفظة لهذا الإجراء.',
    'error.BFF_UNAVAILABLE': 'خادم التطبيق نفسه لا يستجيب. لم يُرسل شيء — أعد المحاولة بعد لحظات.',
    'error.CONNECT_FAILED': 'لم يكتمل اتصال المحفظة.',
    'error.GAS_LIMIT_UNAVAILABLE': 'تعذّر تقدير رسوم الشبكة، لذا لم تُرسل أي معاملة.',
    'error.IN_WALLET': 'أُرسل الطلب إلى تطبيق محفظتك. وافق هناك — وستجد النتيجة هنا عند عودتك.',
    'error.NO_ACCOUNT': 'لا يوجد حساب متاح من هذه المحفظة.',
    'error.NO_ADDRESSES_PROVIDER': 'لم يُفصح المجمّع عن مزوّد عناوينه، لذا تعذّرت قراءة أوراكل الخاص به.',
    'error.NO_FETCH': 'هذا المتصفح لا يستطيع إرسال طلب الشبكة.',
    'error.NO_SESSION': 'انتهت جلسة المحفظة. اتصل من جديد.',
    'error.NO_WALLET': 'لم يُعثر على محفظة سولانا على هذا الجهاز.',
    'error.REJECTED': 'رفضت الطلب في محفظتك. لم يُرسل شيء.',
    'error.SIGN_FAILED': 'لم توقّع المحفظة. لم يُرسل شيء.',
    'error.SEND_FAILED': 'لم تُرسل المحفظة المعاملة. لم يُخصم شيء.',
    'error.BAD_TRANSACTION': 'تعذّرت قراءة المعاملة قبل التوقيع، لذا لم يُرسل شيء.',
    'error.UNSUPPORTED_TRANSACTION': 'هذه المحفظة لا تقبل هذا النسق من المعاملات. يجرب التطبيق النسق الآخر تلقائيًا — لم يُرسل شيء.',
    'error.TRANSACTION_FAILED': 'رفضت الشبكة المعاملة — لم يُخصم سوى رسوم الشبكة.',
    'error.TRANSACTION_NOT_FOUND': 'المعاملة غير ظاهرة بعد على العقد التي جرّبناها. تحقّق من المستكشف قبل إعادة المحاولة.',
    'error.UNSUPPORTED': 'هذه المحفظة لا تستطيع تنفيذ هذا الإجراء.',
    'error.UNKNOWN_WITH_CODE': 'لم يتم الإجراء ({{code}}). أقصى ما قد يُخصم هو رسوم الشبكة؛ وإذا تكرر فأرسل هذا الرمز للدعم.',
    'error.SOLANA_TX_FAILED': 'لم تنجح معاملة سولانا على السلسلة — لم يُخصم شيء.',
    'sheetTitle.approve': 'موافقة',
    'marketHalted.title': 'هذه السوق مغلقة من البروتوكول',
    'marketHalted.body': 'كل احتياطي في هذا المجمّع مجمّد من البروتوكول نفسه: الإيداع الجديد والاقتراض الجديد مغلقان، وهذه الأصول لا تُقبل كرهن جديد. السداد والسحب ما زالا يعملان، والمراكز المفتوحة تبقى مفتوحة.',
    'marketHalted.frozen': 'مجمّد من البروتوكول',
    'marketHalted.paused': 'موقوف من البروتوكول',
    'marketHalted.mixed': 'جزئيًا مجمّد / موقوف من البروتوكول',
    'marketHalted.otherMarkets': 'للإيداع أو الاقتراض، اختر سوقًا آخر من الشريط أعلاه.',
    'marketHalted.repayHint': 'إذا كان لديك مركز هنا: سدّد أولًا ثم اسحب. كلاهما ما زال مسموحًا.'
  },
  es: {
    'error.RPC_BLOCKED': 'Todos los nodos de Solana que probamos rechazaron la petición (403). Es un bloqueo del proveedor o de la red, no un límite de velocidad: inténtalo de nuevo o pon tu propio RPC en Ajustes → Redes.',
    'error.BAD_PAYLOAD': 'El proveedor respondió con algo inutilizable. Inténtalo de nuevo en un momento.',
    'error.BAD_RESPONSE': 'El nodo respondió con algo que no eran datos. Inténtalo de nuevo en un momento.',
    'error.BAD_WALLET': 'Esta cartera no puede usarse para esta acción.',
    'error.BFF_UNAVAILABLE': 'El servidor de la app no responde. No se envió nada: inténtalo de nuevo en un momento.',
    'error.CONNECT_FAILED': 'La conexión de la cartera no se completó.',
    'error.GAS_LIMIT_UNAVAILABLE': 'No se pudo estimar la comisión de red, así que no se envió ninguna transacción.',
    'error.IN_WALLET': 'La petición se entregó a tu app de cartera. Apruébala allí; al volver, el resultado estará aquí.',
    'error.NO_ACCOUNT': 'No hay ninguna cuenta disponible en esta cartera.',
    'error.NO_ADDRESSES_PROVIDER': 'El pool no reveló su proveedor de direcciones, así que no se pudo leer su oráculo.',
    'error.NO_FETCH': 'Este navegador no puede hacer la petición de red.',
    'error.NO_SESSION': 'La sesión de la cartera ha terminado. Conéctala otra vez.',
    'error.NO_WALLET': 'No se encontró ninguna cartera de Solana en este dispositivo.',
    'error.REJECTED': 'Rechazaste la petición en tu cartera. No se envió nada.',
    'error.SIGN_FAILED': 'La cartera no firmó. No se envió nada.',
    'error.SEND_FAILED': 'La cartera no envió la transacción. No se gastó nada.',
    'error.BAD_TRANSACTION': 'No se pudo leer la transacción antes de firmar, así que no se envió nada.',
    'error.UNSUPPORTED_TRANSACTION': 'Esta cartera no acepta este formato de transacción. La app prueba el otro formato automáticamente; no se envió nada.',
    'error.TRANSACTION_FAILED': 'La cadena rechazó la transacción: solo se gastó la comisión de red.',
    'error.TRANSACTION_NOT_FOUND': 'La transacción aún no se ve en los nodos que probamos. Revisa el explorador antes de reintentar.',
    'error.UNSUPPORTED': 'Esta cartera no puede realizar esta acción.',
    'error.UNKNOWN_WITH_CODE': 'La acción no se completó ({{code}}). Como mucho se gastó la comisión de red; si se repite, envía este código a soporte.',
    'error.SOLANA_TX_FAILED': 'La transacción de Solana no se completó en la cadena: no se gastó nada.',
    'sheetTitle.approve': 'Aprobación',
    'marketHalted.title': 'El protocolo ha cerrado este mercado',
    'marketHalted.body': 'Todas las reservas listadas aquí están congeladas por el propio protocolo: los nuevos depósitos y préstamos están cerrados y estos activos no valen como garantía nueva. Los pagos y los retiros siguen funcionando, y las posiciones abiertas siguen abiertas.',
    'marketHalted.frozen': 'Congelado por el protocolo',
    'marketHalted.paused': 'Pausado por el protocolo',
    'marketHalted.mixed': 'En parte congelado / pausado por el protocolo',
    'marketHalted.otherMarkets': 'Para depositar o pedir prestado, elige otro mercado en la barra de arriba.',
    'marketHalted.repayHint': 'Si tienes una posición aquí: paga primero y luego retira. Ambos siguen permitidos.'
  },
  fr: {
    'error.RPC_BLOCKED': 'Tous les nœuds Solana essayés ont refusé la requête (403). C’est un blocage du fournisseur ou du réseau, pas une limite de débit — réessayez, ou renseignez votre propre RPC dans Réglages → Réseaux.',
    'error.BAD_PAYLOAD': 'Le fournisseur a répondu quelque chose d’inutilisable. Réessayez dans un instant.',
    'error.BAD_RESPONSE': 'Le nœud a répondu autre chose que des données. Réessayez dans un instant.',
    'error.BAD_WALLET': 'Ce portefeuille ne peut pas servir à cette action.',
    'error.BFF_UNAVAILABLE': 'Le serveur de l’app ne répond pas. Rien n’a été envoyé — réessayez dans un instant.',
    'error.CONNECT_FAILED': 'La connexion du portefeuille n’a pas abouti.',
    'error.GAS_LIMIT_UNAVAILABLE': 'Les frais de réseau n’ont pas pu être estimés ; aucune transaction n’a été envoyée.',
    'error.IN_WALLET': 'La demande a été transmise à votre app de portefeuille. Validez-la là-bas — le résultat sera ici à votre retour.',
    'error.NO_ACCOUNT': 'Aucun compte n’est disponible dans ce portefeuille.',
    'error.NO_ADDRESSES_PROVIDER': 'Le pool n’a pas révélé son fournisseur d’adresses ; son oracle n’a pas pu être lu.',
    'error.NO_FETCH': 'Ce navigateur ne peut pas envoyer la requête réseau.',
    'error.NO_SESSION': 'La session du portefeuille est terminée. Reconnectez-le.',
    'error.NO_WALLET': 'Aucun portefeuille Solana n’a été trouvé sur cet appareil.',
    'error.REJECTED': 'Vous avez refusé la demande dans votre portefeuille. Rien n’a été envoyé.',
    'error.SIGN_FAILED': 'Le portefeuille n’a pas signé. Rien n’a été envoyé.',
    'error.SEND_FAILED': 'Le portefeuille n’a pas envoyé la transaction. Rien n’a été dépensé.',
    'error.BAD_TRANSACTION': 'La transaction n’a pas pu être lue avant la signature ; rien n’a été envoyé.',
    'error.UNSUPPORTED_TRANSACTION': 'Ce portefeuille n’accepte pas ce format de transaction. L’app essaie l’autre format automatiquement — rien n’a été envoyé.',
    'error.TRANSACTION_FAILED': 'La chaîne a refusé la transaction — seuls les frais de réseau ont été dépensés.',
    'error.TRANSACTION_NOT_FOUND': 'La transaction n’est pas encore visible sur les nœuds essayés. Vérifiez l’explorateur avant de réessayer.',
    'error.UNSUPPORTED': 'Ce portefeuille ne peut pas effectuer cette action.',
    'error.UNKNOWN_WITH_CODE': 'L’action n’a pas abouti ({{code}}). Seuls les frais de réseau ont pu être dépensés ; si cela se répète, envoyez ce code au support.',
    'error.SOLANA_TX_FAILED': 'La transaction Solana n’a pas abouti sur la chaîne — rien n’a été dépensé.',
    'sheetTitle.approve': 'Approbation',
    'marketHalted.title': 'Ce marché est fermé par le protocole',
    'marketHalted.body': 'Toutes les réserves listées ici sont gelées par le protocole lui-même : les nouveaux dépôts et les nouveaux emprunts sont fermés, et ces actifs ne valent pas comme garantie nouvelle. Les remboursements et les retraits fonctionnent encore, et les positions ouvertes restent ouvertes.',
    'marketHalted.frozen': 'Gelé par le protocole',
    'marketHalted.paused': 'En pause par le protocole',
    'marketHalted.mixed': 'En partie gelé / en pause par le protocole',
    'marketHalted.otherMarkets': 'Pour déposer ou emprunter, choisissez un autre marché dans la barre ci-dessus.',
    'marketHalted.repayHint': 'Si vous avez une position ici : remboursez d’abord, puis retirez. Les deux restent autorisés.'
  },
  hi: {
    'error.RPC_BLOCKED': 'हमने जो भी Solana नोड आज़माए, सबने अनुरोध ठुकरा दिया (403)। यह प्रोवाइडर या नेटवर्क की ब्लॉकिंग है, रेट-लिमिट नहीं — दोबारा कोशिश करें, या Settings → Networks में अपना RPC डालें।',
    'error.BAD_PAYLOAD': 'प्रोवाइडर का जवाब इस्तेमाल लायक नहीं था। थोड़ी देर बाद फिर कोशिश करें।',
    'error.BAD_RESPONSE': 'नोड ने डेटा के बजाय कुछ और भेजा। थोड़ी देर बाद फिर कोशिश करें।',
    'error.BAD_WALLET': 'इस काम के लिए यह वॉलेट इस्तेमाल नहीं हो सकता।',
    'error.BFF_UNAVAILABLE': 'ऐप का अपना सर्वर जवाब नहीं दे रहा। कुछ भेजा नहीं गया — थोड़ी देर बाद फिर कोशिश करें।',
    'error.CONNECT_FAILED': 'वॉलेट कनेक्शन पूरा नहीं हुआ।',
    'error.GAS_LIMIT_UNAVAILABLE': 'नेटवर्क फीस का अंदाज़ा नहीं लगा, इसलिए कोई ट्रांज़ैक्शन नहीं भेजा गया।',
    'error.IN_WALLET': 'अनुरोध आपके वॉलेट ऐप को भेज दिया गया है। वहीं मंज़ूरी दें — लौटने पर नतीजा यहीं मिलेगा।',
    'error.NO_ACCOUNT': 'इस वॉलेट से कोई अकाउंट उपलब्ध नहीं है।',
    'error.NO_ADDRESSES_PROVIDER': 'पूल ने अपना एड्रेस प्रोवाइडर नहीं बताया, इसलिए उसका ओरैकल पढ़ा नहीं जा सका।',
    'error.NO_FETCH': 'यह ब्राउज़र नेटवर्क अनुरोध नहीं भेज सकता।',
    'error.NO_SESSION': 'वॉलेट सेशन खत्म हो गया। दोबारा कनेक्ट करें।',
    'error.NO_WALLET': 'इस डिवाइस पर कोई Solana वॉलेट नहीं मिला।',
    'error.REJECTED': 'आपने वॉलेट में अनुरोध ठुकरा दिया। कुछ भेजा नहीं गया।',
    'error.SIGN_FAILED': 'वॉलेट ने साइन नहीं किया। कुछ भेजा नहीं गया।',
    'error.SEND_FAILED': 'वॉलेट ने ट्रांज़ैक्शन नहीं भेजा। कुछ खर्च नहीं हुआ।',
    'error.BAD_TRANSACTION': 'साइन करने से पहले ट्रांज़ैक्शन पढ़ा नहीं गया, इसलिए कुछ भेजा नहीं गया।',
    'error.UNSUPPORTED_TRANSACTION': 'यह वॉलेट इस ट्रांज़ैक्शन फ़ॉर्मैट को नहीं मानता। ऐप दूसरा फ़ॉर्मैट अपने-आप आज़माता है — कुछ भेजा नहीं गया।',
    'error.TRANSACTION_FAILED': 'चेन ने ट्रांज़ैक्शन ठुकरा दिया — सिर्फ़ नेटवर्क फीस खर्च हुई।',
    'error.TRANSACTION_NOT_FOUND': 'जिन नोड पर हमने कोशिश की, वहाँ ट्रांज़ैक्शन अभी नहीं दिख रहा। दोबारा कोशिश से पहले एक्सप्लोरर देखें।',
    'error.UNSUPPORTED': 'यह वॉलेट यह काम नहीं कर सकता।',
    'error.UNKNOWN_WITH_CODE': 'काम पूरा नहीं हुआ ({{code}})। ज़्यादा-से-ज़्यादा नेटवर्क फीस खर्च हुई होगी; दोबारा हो तो यह कोड सपोर्ट को भेजें।',
    'error.SOLANA_TX_FAILED': 'Solana ट्रांज़ैक्शन चेन पर सफल नहीं हुआ — कुछ खर्च नहीं हुआ।',
    'sheetTitle.approve': 'मंज़ूरी',
    'marketHalted.title': 'यह मार्केट प्रोटोकॉल ने बंद कर दिया है',
    'marketHalted.body': 'यहाँ की हर रिज़र्व खुद प्रोटोकॉल ने फ़्रीज़ कर दी है: नई जमा और नया कर्ज़ बंद हैं, और ये टोकन नई गिरवी के तौर पर नहीं चलेंगे। चुकौती और निकासी अब भी काम करती हैं, और खुली पोज़िशन खुली रहती हैं।',
    'marketHalted.frozen': 'प्रोटोकॉल ने फ़्रीज़ किया',
    'marketHalted.paused': 'प्रोटोकॉल ने रोका',
    'marketHalted.mixed': 'कुछ हिस्सा फ़्रीज़ / रोका गया',
    'marketHalted.otherMarkets': 'जमा या कर्ज़ के लिए ऊपर की बार से दूसरा मार्केट चुनें।',
    'marketHalted.repayHint': 'यहाँ पोज़िशन हो तो: पहले चुकाएँ, फिर निकालें। दोनों अब भी मान्य हैं।'
  },
  id: {
    'error.RPC_BLOCKED': 'Semua node Solana yang kami coba menolak permintaan (403). Ini blokir dari penyedia atau jaringan, bukan batas laju — coba lagi, atau isi RPC sendiri di Pengaturan → Jaringan.',
    'error.BAD_PAYLOAD': 'Jawaban penyedia tidak bisa dipakai. Coba lagi sebentar.',
    'error.BAD_RESPONSE': 'Node menjawab dengan sesuatu yang bukan data. Coba lagi sebentar.',
    'error.BAD_WALLET': 'Dompet ini tidak bisa dipakai untuk tindakan ini.',
    'error.BFF_UNAVAILABLE': 'Server aplikasi tidak menjawab. Tidak ada yang dikirim — coba lagi sebentar.',
    'error.CONNECT_FAILED': 'Koneksi dompet tidak selesai.',
    'error.GAS_LIMIT_UNAVAILABLE': 'Biaya jaringan tidak bisa diperkirakan, jadi tidak ada transaksi yang dikirim.',
    'error.IN_WALLET': 'Permintaan diteruskan ke aplikasi dompetmu. Setujui di sana — hasilnya menunggu di sini saat kamu kembali.',
    'error.NO_ACCOUNT': 'Tidak ada akun yang tersedia dari dompet ini.',
    'error.NO_ADDRESSES_PROVIDER': 'Pool tidak mengungkap penyedia alamatnya, jadi oracle-nya tidak bisa dibaca.',
    'error.NO_FETCH': 'Peramban ini tidak bisa mengirim permintaan jaringan.',
    'error.NO_SESSION': 'Sesi dompet sudah berakhir. Sambungkan lagi.',
    'error.NO_WALLET': 'Tidak ada dompet Solana di perangkat ini.',
    'error.REJECTED': 'Kamu menolak permintaan di dompetmu. Tidak ada yang dikirim.',
    'error.SIGN_FAILED': 'Dompet tidak menandatangani. Tidak ada yang dikirim.',
    'error.SEND_FAILED': 'Dompet tidak mengirim transaksi. Tidak ada yang terpakai.',
    'error.BAD_TRANSACTION': 'Transaksi tidak bisa dibaca sebelum ditandatangani, jadi tidak ada yang dikirim.',
    'error.UNSUPPORTED_TRANSACTION': 'Dompet ini tidak menerima format transaksi ini. Aplikasi otomatis mencoba format lainnya — tidak ada yang dikirim.',
    'error.TRANSACTION_FAILED': 'Rantai menolak transaksi — hanya biaya jaringan yang terpakai.',
    'error.TRANSACTION_NOT_FOUND': 'Transaksi belum terlihat di node yang kami coba. Periksa explorer sebelum mengulang.',
    'error.UNSUPPORTED': 'Dompet ini tidak bisa melakukan tindakan ini.',
    'error.UNKNOWN_WITH_CODE': 'Tindakan tidak berhasil ({{code}}). Paling banyak hanya biaya jaringan terpakai; jika berulang, kirim kode ini ke dukungan.',
    'error.SOLANA_TX_FAILED': 'Transaksi Solana tidak berhasil di rantai — tidak ada yang terpakai.',
    'sheetTitle.approve': 'Persetujuan',
    'marketHalted.title': 'Pasar ini ditutup oleh protokol',
    'marketHalted.body': 'Semua cadangan di sini dibekukan oleh protokol itu sendiri: setoran baru dan pinjaman baru ditutup, dan aset ini tidak bisa dipakai sebagai jaminan baru. Pelunasan dan penarikan masih berjalan, dan posisi yang terbuka tetap terbuka.',
    'marketHalted.frozen': 'Dibekukan protokol',
    'marketHalted.paused': 'Dihentikan protokol',
    'marketHalted.mixed': 'Sebagian dibekukan / dihentikan protokol',
    'marketHalted.otherMarkets': 'Untuk menyetor atau meminjam, pilih pasar lain di bar di atas.',
    'marketHalted.repayHint': 'Kalau ada posisi di sini: lunasi dulu, baru tarik. Keduanya masih diizinkan.'
  },
  pt: {
    'error.RPC_BLOCKED': 'Todos os nós Solana que tentamos recusaram a solicitação (403). Isto é um bloqueio do provedor ou da rede, não um limite de taxa — tente de novo, ou informe seu próprio RPC em Configurações → Redes.',
    'error.BAD_PAYLOAD': 'A resposta do provedor não pôde ser usada. Tente de novo em instantes.',
    'error.BAD_RESPONSE': 'O nó respondeu com algo que não eram dados. Tente de novo em instantes.',
    'error.BAD_WALLET': 'Esta carteira não pode ser usada nesta ação.',
    'error.BFF_UNAVAILABLE': 'O servidor do app não está respondendo. Nada foi enviado — tente de novo em instantes.',
    'error.CONNECT_FAILED': 'A conexão da carteira não foi concluída.',
    'error.GAS_LIMIT_UNAVAILABLE': 'Não foi possível estimar a taxa de rede, então nenhuma transação foi enviada.',
    'error.IN_WALLET': 'A solicitação foi entregue ao app da sua carteira. Aprove lá — o resultado estará aqui quando você voltar.',
    'error.NO_ACCOUNT': 'Nenhuma conta está disponível nesta carteira.',
    'error.NO_ADDRESSES_PROVIDER': 'O pool não revelou seu provedor de endereços, então o oráculo dele não pôde ser lido.',
    'error.NO_FETCH': 'Este navegador não consegue fazer a solicitação de rede.',
    'error.NO_SESSION': 'A sessão da carteira terminou. Conecte de novo.',
    'error.NO_WALLET': 'Nenhuma carteira Solana foi encontrada neste dispositivo.',
    'error.REJECTED': 'Você recusou a solicitação na sua carteira. Nada foi enviado.',
    'error.SIGN_FAILED': 'A carteira não assinou. Nada foi enviado.',
    'error.SEND_FAILED': 'A carteira não enviou a transação. Nada foi gasto.',
    'error.BAD_TRANSACTION': 'A transação não pôde ser lida antes de assinar, então nada foi enviado.',
    'error.UNSUPPORTED_TRANSACTION': 'Esta carteira não aceita este formato de transação. O app tenta o outro formato automaticamente — nada foi enviado.',
    'error.TRANSACTION_FAILED': 'A rede recusou a transação — apenas a taxa de rede foi gasta.',
    'error.TRANSACTION_NOT_FOUND': 'A transação ainda não aparece nos nós que tentamos. Verifique o explorador antes de repetir.',
    'error.UNSUPPORTED': 'Esta carteira não consegue fazer esta ação.',
    'error.UNKNOWN_WITH_CODE': 'A ação não foi concluída ({{code}}). No máximo a taxa de rede foi gasta; se repetir, envie este código ao suporte.',
    'error.SOLANA_TX_FAILED': 'A transação da Solana não foi concluída na rede — nada foi gasto.',
    'sheetTitle.approve': 'Aprovação',
    'marketHalted.title': 'Este mercado foi fechado pelo protocolo',
    'marketHalted.body': 'Todas as reservas listadas aqui estão congeladas pelo próprio protocolo: novos depósitos e novos empréstimos estão fechados, e estes ativos não valem como garantia nova. Pagamentos e saques continuam funcionando, e as posições abertas seguem abertas.',
    'marketHalted.frozen': 'Congelado pelo protocolo',
    'marketHalted.paused': 'Pausado pelo protocolo',
    'marketHalted.mixed': 'Em parte congelado / pausado pelo protocolo',
    'marketHalted.otherMarkets': 'Para depositar ou pedir emprestado, escolha outro mercado na barra acima.',
    'marketHalted.repayHint': 'Se você tem uma posição aqui: pague primeiro, depois saque. Os dois continuam permitidos.'
  },
  ru: {
    'error.RPC_BLOCKED': 'Все опрошенные узлы Solana отклонили запрос (403). Это блокировка провайдера или сети, а не лимит скорости — повторите попытку или укажите свой RPC в «Настройки → Сети».',
    'error.BAD_PAYLOAD': 'Ответ провайдера оказался непригодным. Повторите попытку через момент.',
    'error.BAD_RESPONSE': 'Узел вернул не данные. Повторите попытку через момент.',
    'error.BAD_WALLET': 'Этот кошелёк нельзя использовать для этого действия.',
    'error.BFF_UNAVAILABLE': 'Сервер приложения не отвечает. Ничего не отправлено — повторите попытку через момент.',
    'error.CONNECT_FAILED': 'Подключение кошелька не завершилось.',
    'error.GAS_LIMIT_UNAVAILABLE': 'Не удалось оценить комиссию сети, поэтому транзакция не отправлена.',
    'error.IN_WALLET': 'Запрос передан в приложение кошелька. Подтвердите там — результат будет здесь, когда вернётесь.',
    'error.NO_ACCOUNT': 'В этом кошельке нет доступного аккаунта.',
    'error.NO_ADDRESSES_PROVIDER': 'Пул не раскрыл своего поставщика адресов, поэтому его оракул не прочитан.',
    'error.NO_FETCH': 'Этот браузер не может отправить сетевой запрос.',
    'error.NO_SESSION': 'Сессия кошелька завершена. Подключите снова.',
    'error.NO_WALLET': 'На этом устройстве не найден кошелёк Solana.',
    'error.REJECTED': 'Вы отклонили запрос в кошельке. Ничего не отправлено.',
    'error.SIGN_FAILED': 'Кошелёк не подписал. Ничего не отправлено.',
    'error.SEND_FAILED': 'Кошелёк не отправил транзакцию. Ничего не потрачено.',
    'error.BAD_TRANSACTION': 'Транзакцию не удалось прочитать до подписи, поэтому ничего не отправлено.',
    'error.UNSUPPORTED_TRANSACTION': 'Этот кошелёк не принимает такой формат транзакции. Приложение само пробует другой формат — ничего не отправлено.',
    'error.TRANSACTION_FAILED': 'Сеть отклонила транзакцию — потрачена только комиссия сети.',
    'error.TRANSACTION_NOT_FOUND': 'Транзакция пока не видна на опрошенных узлах. Проверьте обозреватель перед повтором.',
    'error.UNSUPPORTED': 'Этот кошелёк не может выполнить это действие.',
    'error.UNKNOWN_WITH_CODE': 'Действие не прошло ({{code}}). Максимум потрачена комиссия сети; если повторится — отправьте этот код в поддержку.',
    'error.SOLANA_TX_FAILED': 'Транзакция Solana не прошла в сети — ничего не потрачено.',
    'sheetTitle.approve': 'Одобрение',
    'marketHalted.title': 'Этот рынок закрыт протоколом',
    'marketHalted.body': 'Все резервы здесь заморожены самим протоколом: новые вклады и новые займы закрыты, и эти активы не принимаются как новое обеспечение. Погашение и вывод по-прежнему работают, а открытые позиции остаются открытыми.',
    'marketHalted.frozen': 'Заморожено протоколом',
    'marketHalted.paused': 'Приостановлено протоколом',
    'marketHalted.mixed': 'Частично заморожено / приостановлено протоколом',
    'marketHalted.otherMarkets': 'Чтобы внести или занять, выберите другой рынок на панели выше.',
    'marketHalted.repayHint': 'Если здесь есть позиция: сначала погасите, потом выводите. И то и другое разрешено.'
  },
  tr: {
    'error.RPC_BLOCKED': 'Denediğimiz tüm Solana düğümleri isteği reddetti (403). Bu bir sağlayıcı/ağ engeli, hız sınırı değil — tekrar dene ya da Ayarlar → Ağlar bölümüne kendi RPC’ni gir.',
    'error.BAD_PAYLOAD': 'Sağlayıcının yanıtı kullanılabilir değildi. Birazdan tekrar dene.',
    'error.BAD_RESPONSE': 'Düğüm veri yerine başka bir şey döndürdü. Birazdan tekrar dene.',
    'error.BAD_WALLET': 'Bu cüzdan bu işlem için kullanılamaz.',
    'error.BFF_UNAVAILABLE': 'Uygulamanın kendi sunucusu yanıt vermiyor. Hiçbir şey gönderilmedi — birazdan tekrar dene.',
    'error.CONNECT_FAILED': 'Cüzdan bağlantısı tamamlanmadı.',
    'error.GAS_LIMIT_UNAVAILABLE': 'Ağ ücreti tahmin edilemedi, bu yüzden hiçbir işlem gönderilmedi.',
    'error.IN_WALLET': 'İstek cüzdan uygulamana iletildi. Orada onayla — döndüğünde sonuç burada olacak.',
    'error.NO_ACCOUNT': 'Bu cüzdanda kullanılabilir bir hesap yok.',
    'error.NO_ADDRESSES_PROVIDER': 'Havuz adres sağlayıcısını açıklamadı, bu yüzden oracle’ı okunamadı.',
    'error.NO_FETCH': 'Bu tarayıcı ağ isteğini yapamıyor.',
    'error.NO_SESSION': 'Cüzdan oturumu bitti. Yeniden bağlan.',
    'error.NO_WALLET': 'Bu cihazda Solana cüzdanı bulunamadı.',
    'error.REJECTED': 'İsteği cüzdanında reddettin. Hiçbir şey gönderilmedi.',
    'error.SIGN_FAILED': 'Cüzdan imzalamadı. Hiçbir şey gönderilmedi.',
    'error.SEND_FAILED': 'Cüzdan işlemi göndermedi. Hiçbir şey harcanmadı.',
    'error.BAD_TRANSACTION': 'İşlem imzalanmadan önce okunamadı, bu yüzden hiçbir şey gönderilmedi.',
    'error.UNSUPPORTED_TRANSACTION': 'Bu cüzdan bu işlem biçimini kabul etmiyor. Uygulama diğer biçimi kendisi dener — hiçbir şey gönderilmedi.',
    'error.TRANSACTION_FAILED': 'Zincir işlemi reddetti — yalnızca ağ ücreti harcandı.',
    'error.TRANSACTION_NOT_FOUND': 'İşlem denediğimiz düğümlerde henüz görünmüyor. Tekrar denemeden önce explorer’a bak.',
    'error.UNSUPPORTED': 'Bu cüzdan bu işlemi yapamaz.',
    'error.UNKNOWN_WITH_CODE': 'İşlem tamamlanmadı ({{code}}). En fazla ağ ücreti harcanmıştır; tekrarlarsa bu kodu desteğe gönder.',
    'error.SOLANA_TX_FAILED': 'Solana işlemi zincirde başarılı olmadı — hiçbir şey harcanmadı.',
    'sheetTitle.approve': 'Onay',
    'marketHalted.title': 'Bu piyasa protokol tarafından kapatıldı',
    'marketHalted.body': 'Buradaki tüm rezervler protokolün kendisi tarafından donduruldu: yeni mevduat ve yeni kredi kapalı, bu varlıklar yeni teminat olarak sayılmıyor. Geri ödeme ve çekim hâlâ çalışıyor, açık pozisyonlar açık kalıyor.',
    'marketHalted.frozen': 'Protokol dondurdu',
    'marketHalted.paused': 'Protokol durdurdu',
    'marketHalted.mixed': 'Kısmen donduruldu / durduruldu',
    'marketHalted.otherMarkets': 'Mevduat veya kredi için yukarıdaki şeritten başka bir piyasa seç.',
    'marketHalted.repayHint': 'Burada pozisyonun varsa: önce geri öde, sonra çek. İkisi de hâlâ serbest.'
  },
  ur: {
    'error.RPC_BLOCKED': 'ہم نے جو بھی سولانا نوڈ آزماے، سب نے درخواست رد کر دی (403)۔ یہ provider یا نیٹ ورک کی بلاکنگ ہے، ریٹ لِمٹ نہیں — دوبارہ کوشش کریں یا Settings → Networks میں اپنا RPC ڈالیں۔',
    'error.BAD_PAYLOAD': 'provider کا جواب قابلِ استعمال نہیں تھا۔ تھوڑی دیر بعد دوبارہ کوشش کریں۔',
    'error.BAD_RESPONSE': 'نوڈ نے ڈیٹا کے بجائے کچھ اور بھیجا۔ تھوڑی دیر بعد دوبارہ کوشش کریں۔',
    'error.BAD_WALLET': 'یہ والٹ اس کام کے لیے استعمال نہیں ہو سکتا۔',
    'error.BFF_UNAVAILABLE': 'ایپ کا اپنا سرور جواب نہیں دے رہا۔ کچھ بھیجا نہیں گیا — تھوڑی دیر بعد دوبارہ کوشش کریں۔',
    'error.CONNECT_FAILED': 'والٹ کنکشن مکمل نہیں ہوا۔',
    'error.GAS_LIMIT_UNAVAILABLE': 'نیٹ ورک فیس کا اندازہ نہیں لگا، اس لیے کوئی ٹرانزیکشن نہیں بھیجی گئی۔',
    'error.IN_WALLET': 'درخواست آپ کے والٹ ایپ کو بھیج دی گئی ہے۔ وہیں منظور کریں — واپسی پر نتیجہ یہاں ہوگا۔',
    'error.NO_ACCOUNT': 'اس والٹ سے کوئی اکاؤنٹ دستیاب نہیں۔',
    'error.NO_ADDRESSES_PROVIDER': 'پول نے اپنا ایڈریس provider ظاہر نہیں کیا، اس لیے اس کا oracle پڑھا نہ جا سکا۔',
    'error.NO_FETCH': 'یہ براؤزر نیٹ ورک درخواست نہیں بھیج سکتا۔',
    'error.NO_SESSION': 'والٹ سیشن ختم ہو گیا۔ دوبارہ کنیکٹ کریں۔',
    'error.NO_WALLET': 'اس ڈیوائس پر سولانا والٹ نہیں ملا۔',
    'error.REJECTED': 'آپ نے والٹ میں درخواست رد کر دی۔ کچھ بھیجا نہیں گیا۔',
    'error.SIGN_FAILED': 'والٹ نے دستخط نہیں کیے۔ کچھ بھیجا نہیں گیا۔',
    'error.SEND_FAILED': 'والٹ نے ٹرانزیکشن نہیں بھیجی۔ کچھ خرچ نہیں ہوا۔',
    'error.BAD_TRANSACTION': 'دستخط سے پہلے ٹرانزیکشن پڑھی نہ جا سکی، اس لیے کچھ بھیجا نہیں گیا۔',
    'error.UNSUPPORTED_TRANSACTION': 'یہ والٹ اس ٹرانزیکشن فارمیٹ کو قبول نہیں کرتا۔ ایپ خود دوسرا فارمیٹ آزمانے کی کوشش کرتی ہے — کچھ بھیجا نہیں گیا۔',
    'error.TRANSACTION_FAILED': 'چین نے ٹرانزیکشن رد کر دی — صرف نیٹ ورک فیس خرچ ہوئی۔',
    'error.TRANSACTION_NOT_FOUND': 'جتنے نوڈ ہم نے آزماے ان پر ٹرانزیکشن ابھی نظر نہیں آتی۔ دوبارہ کوشش سے پہلے explorer دیکھیں۔',
    'error.UNSUPPORTED': 'یہ والٹ یہ کام نہیں کر سکتا۔',
    'error.UNKNOWN_WITH_CODE': 'کام مکمل نہیں ہوا ({{code}})۔ زیادہ سے زیادہ نیٹ ورک فیس خرچ ہوئی ہوگی؛ دوبارہ ہو تو یہی کوڈ سپورٹ کو بھیجیں۔',
    'error.SOLANA_TX_FAILED': 'سولانا ٹرانزیکشن چین پر کامیاب نہیں ہوئی — کچھ خرچ نہیں ہوا۔',
    'sheetTitle.approve': 'منظوری',
    'marketHalted.title': 'یہ مارکیٹ پروٹوکول نے بند کر دی ہے',
    'marketHalted.body': 'یہاں کے تمام ریزرو خود پروٹوکول نے منجمد کیے ہیں: نئی جمع اور نیا قرض بند ہے، اور یہ اثاثے نئی ضمانت کے طور پر قبول نہیں۔ ادائیگی اور نکاسی اب بھی کام کرتی ہے، اور کھلی پوزیشنیں کھلی رہتی ہیں۔',
    'marketHalted.frozen': 'پروٹوکول نے منجمد کیا',
    'marketHalted.paused': 'پروٹوکول نے روکا',
    'marketHalted.mixed': 'کچھ حصہ منجمد / روکا گیا',
    'marketHalted.otherMarkets': 'جمع یا قرض کے لیے اوپر کی بار سے دوسری مارکیٹ چنیں۔',
    'marketHalted.repayHint': 'یہاں پوزیشن ہو تو: پہلے ادا کریں، پھر نکالیں۔ دونوں اب بھی جائز ہیں۔'
  },
  zh: {
    'error.RPC_BLOCKED': '我们试过的 Solana 节点都拒绝了请求（403）。这是提供方或网络的封锁，不是限速——请重试，或在“设置 → 网络”里填自己的 RPC。',
    'error.BAD_PAYLOAD': '提供方的返回无法使用。请稍后再试。',
    'error.BAD_RESPONSE': '节点返回的不是数据。请稍后再试。',
    'error.BAD_WALLET': '此钱包不能用于该操作。',
    'error.BFF_UNAVAILABLE': '应用自己的服务器没有响应。没有发送任何内容——请稍后再试。',
    'error.CONNECT_FAILED': '钱包连接没有完成。',
    'error.GAS_LIMIT_UNAVAILABLE': '无法估算网络手续费，因此没有发送交易。',
    'error.IN_WALLET': '请求已交给你的钱包应用。请在那里确认——回来时结果会在这里。',
    'error.NO_ACCOUNT': '此钱包没有可用账户。',
    'error.NO_ADDRESSES_PROVIDER': '资金池没有公开其地址提供方，因此无法读取它的预言机。',
    'error.NO_FETCH': '此浏览器无法发起网络请求。',
    'error.NO_SESSION': '钱包会话已结束。请重新连接。',
    'error.NO_WALLET': '此设备上未找到 Solana 钱包。',
    'error.REJECTED': '你在钱包里拒绝了请求。没有发送任何内容。',
    'error.SIGN_FAILED': '钱包没有签名。没有发送任何内容。',
    'error.SEND_FAILED': '钱包没有发送交易。没有花费任何内容。',
    'error.BAD_TRANSACTION': '签名前无法读取该交易，因此没有发送任何内容。',
    'error.UNSUPPORTED_TRANSACTION': '此钱包不接受这种交易格式。应用会自动尝试另一种格式——没有发送任何内容。',
    'error.TRANSACTION_FAILED': '链上拒绝了该交易——只花费了网络手续费。',
    'error.TRANSACTION_NOT_FOUND': '我们试过的节点上还看不到这笔交易。重试前请先在区块浏览器上核实。',
    'error.UNSUPPORTED': '此钱包无法执行该操作。',
    'error.UNKNOWN_WITH_CODE': '操作未完成（{{code}}）。最多只损失网络手续费；若反复出现，请把这个代码发给客服。',
    'error.SOLANA_TX_FAILED': 'Solana 交易未在链上成功——没有花费任何内容。',
    'sheetTitle.approve': '授权',
    'marketHalted.title': '该市场已被协议关闭',
    'marketHalted.body': '这里列出的所有储备都已被协议本身冻结：新的存款和新的借款都已关闭，这些资产也不能作为新的抵押。还款和提现仍然可用，已有的仓位保持开放。',
    'marketHalted.frozen': '已被协议冻结',
    'marketHalted.paused': '已被协议暂停',
    'marketHalted.mixed': '部分被冻结 / 暂停',
    'marketHalted.otherMarkets': '要存款或借款，请在上方的市场栏里选择另一个市场。',
    'marketHalted.repayHint': '如果这里有仓位：先还款，再提现。两者都仍然允许。'
  }
};

const setPath = (object, dotted, value) => {
  const parts = dotted.split('.');
  let node = object;
  for (const part of parts.slice(0, -1)) {
    if (node[part] == null || typeof node[part] !== 'object') node[part] = {};
    node = node[part];
  }
  const leaf = parts[parts.length - 1];
  if (node[leaf] != null) return false;
  node[leaf] = value;
  return true;
};

const hasPath = (object, dotted) => dotted
  .split('.')
  .reduce((node, part) => (node == null ? undefined : node[part]), object) != null;

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
  /* `{{code}}` is what keeps the machine string inside the sentence for an
     unknown code; without it the placeholder would vanish in that language. */
  if (!hasPath(data.loan, 'error.UNKNOWN_WITH_CODE') || !String(data.loan.error.UNKNOWN_WITH_CODE).includes('{{code}}')) {
    console.error(`✗ ${lang}: loan.error.UNKNOWN_WITH_CODE is missing the {{code}} placeholder`);
    failed = true;
  }
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`${added ? '✓' : '•'} ${lang}: ${added} keys added`);
}

if (failed) process.exitCode = 1;
