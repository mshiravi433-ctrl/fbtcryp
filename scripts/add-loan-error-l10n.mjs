#!/usr/bin/env node
/**
 * Add the 2026-09-22 loan-error keys (TOKEN_NOT_ALLOWED et al.) to every
 * locale. These codes could reach the UI (§31 allowlist gates, Kamino SDK
 * load states) with no translation, rendering as raw codes («✕
 * TOKEN_NOT_ALLOWED»). Run: node scripts/add-loan-error-l10n.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const STRINGS = {
  en: {
    TOKEN_NOT_ALLOWED: 'This token is not in the audited list for this market, so it cannot be used here.',
    POOL_NOT_ALLOWED: 'This pool address is not the audited market for this network.',
    BAD_ADDRESS: 'This address is not valid.',
    NO_TOKEN_REGISTRY: 'The token list for this market could not be loaded.',
    KAMINO_SDK_MISSING: 'The Kamino module is missing from this build — please update the app.',
    KAMINO_SDK_FAILED: 'The Kamino module failed to start. Please update the app and try again.',
    KAMINO_SDK_TRUNCATED: 'The Kamino module downloaded only part of the way — the connection was cut off. Try again on a steadier link.',
    KAMINO_SDK_INIT_FAILED: 'The Kamino module was downloaded but failed to start. Please update the app, and if it repeats, send this message to support.',
    KAMINO_TX_BUILD_EMPTY: 'Kamino did not return a transaction for this action — nothing was sent and no fee was charged.'
  },
  fa: {
    TOKEN_NOT_ALLOWED: 'این توکن در فهرست تأییدشده این بازار نیست، پس اینجا قابل استفاده نیست. دارایی را دوباره در همین بازار انتخاب کن.',
    POOL_NOT_ALLOWED: 'آدرس این استخر با بازار تأییدشده این شبکه یکی نیست.',
    BAD_ADDRESS: 'این آدرس معتبر نیست.',
    NO_TOKEN_REGISTRY: 'فهرست توکن‌های این بازار بارگذاری نشد.',
    KAMINO_SDK_MISSING: 'ماژول Kamino در این نسخه از اپ وجود ندارد — اپ را به‌روزرسانی کن.',
    KAMINO_SDK_FAILED: 'ماژول Kamino اجرا نشد. اپ را به‌روزرسانی کن و دوباره تلاش کن.',
    KAMINO_SDK_TRUNCATED: 'ماژول Kamino کامل دانلود نشد؛ اتصال نیمه‌راه قطع شد. با اینترنت پایدارتر دوباره تلاش کن.',
    KAMINO_SDK_INIT_FAILED: 'ماژول Kamino دانلود شد ولی هنگام اجرا خطا داد. اپ را به‌روزرسانی کن و اگر تکرار شد همین متن را برای پشتیبانی بفرست.',
    KAMINO_TX_BUILD_EMPTY: 'Kamino برای این عملیات تراکنشی برنگرداند — هیچ چیزی ارسال نشد و هزینه‌ای کسر نشد.'
  },
  ar: {
    TOKEN_NOT_ALLOWED: 'هذا الرمز ليس في القائمة المدققة لهذه السوق، لذا لا يمكن استخدامه هنا.',
    POOL_NOT_ALLOWED: 'عنوان هذا المجمّع ليس سوق الشبكة المدقق.',
    BAD_ADDRESS: 'هذا العنوان غير صالح.',
    NO_TOKEN_REGISTRY: 'تعذّر تحميل قائمة رموز هذه السوق.',
    KAMINO_SDK_MISSING: 'وحدة Kamino مفقودة في هذا الإصدار — حدّث التطبيق.',
    KAMINO_SDK_FAILED: 'تعذّر تشغيل وحدة Kamino. حدّث التطبيق وحاول مجددًا.',
    KAMINO_SDK_TRUNCATED: 'لم يكتمل تنزيل وحدة Kamino — انقطع الاتصال. أعد المحاولة على شبكة أكثر استقرارًا.',
    KAMINO_SDK_INIT_FAILED: 'تم تنزيل وحدة Kamino لكنها فشلت عند التشغيل. حدّث التطبيق، وإن تكرر أرسل هذه الرسالة للدعم.',
    KAMINO_TX_BUILD_EMPTY: 'لم تُرجِع Kamino أي معاملة لهذا الإجراء — لم يُرسل شيء ولم تُخصم أي رسوم.'
  },
  es: {
    TOKEN_NOT_ALLOWED: 'Este token no está en la lista auditada de este mercado, así que no puede usarse aquí.',
    POOL_NOT_ALLOWED: 'Esta dirección de pool no es el mercado auditado de esta red.',
    BAD_ADDRESS: 'Esta dirección no es válida.',
    NO_TOKEN_REGISTRY: 'No se pudo cargar la lista de tokens de este mercado.',
    KAMINO_SDK_MISSING: 'El módulo Kamino falta en esta versión — actualiza la app.',
    KAMINO_SDK_FAILED: 'El módulo Kamino no pudo iniciarse. Actualiza la app e inténtalo de nuevo.',
    KAMINO_SDK_TRUNCATED: 'El módulo Kamino se descargó solo en parte: se cortó la conexión. Inténtalo de nuevo con una conexión más estable.',
    KAMINO_SDK_INIT_FAILED: 'El módulo Kamino se descargó pero falló al iniciarse. Actualiza la app y, si se repite, envía este mensaje a soporte.',
    KAMINO_TX_BUILD_EMPTY: 'Kamino no devolvió ninguna transacción para esta acción: no se envió nada ni se cobró comisión.'
  },
  fr: {
    TOKEN_NOT_ALLOWED: 'Ce jeton ne figure pas dans la liste auditée de ce marché ; il ne peut pas être utilisé ici.',
    POOL_NOT_ALLOWED: 'Cette adresse de pool n’est pas le marché audité de ce réseau.',
    BAD_ADDRESS: 'Cette adresse n’est pas valide.',
    NO_TOKEN_REGISTRY: 'La liste des jetons de ce marché n’a pas pu être chargée.',
    KAMINO_SDK_MISSING: 'Le module Kamino est absent de cette version — mettez à jour l’app.',
    KAMINO_SDK_FAILED: 'Le module Kamino n’a pas pu démarrer. Mettez à jour l’app et réessayez.',
    KAMINO_SDK_TRUNCATED: 'Le module Kamino n’a été téléchargé qu’en partie : la connexion a été coupée. Réessayez sur un réseau plus stable.',
    KAMINO_SDK_INIT_FAILED: 'Le module Kamino a été téléchargé mais n’a pas démarré. Mettez à jour l’app et, si cela se répète, envoyez ce message au support.',
    KAMINO_TX_BUILD_EMPTY: 'Kamino n’a renvoyé aucune transaction pour cette action : rien n’a été envoyé et aucun frais n’a été prélevé.'
  },
  hi: {
    TOKEN_NOT_ALLOWED: 'यह टोकन इस मार्केट की ऑडिटेड सूची में नहीं है, इसलिए यहाँ इस्तेमाल नहीं हो सकता।',
    POOL_NOT_ALLOWED: 'यह पूल पता इस नेटवर्क के ऑडिटेड मार्केट का नहीं है।',
    BAD_ADDRESS: 'यह पता मान्य नहीं है।',
    NO_TOKEN_REGISTRY: 'इस मार्केट की टोकन सूची लोड नहीं हो सकी।',
    KAMINO_SDK_MISSING: 'इस बिल्ड में Kamino मॉड्यूल मौजूद नहीं है — ऐप अपडेट करें।',
    KAMINO_SDK_FAILED: 'Kamino मॉड्यूल शुरू नहीं हो सका। ऐप अपडेट करके फिर कोशिश करें।',
    KAMINO_SDK_TRUNCATED: 'Kamino मॉड्यूल पूरा डाउनलोड नहीं हुआ — कनेक्शन बीच में टूट गया। बेहतर नेटवर्क पर फिर कोशिश करें।',
    KAMINO_SDK_INIT_FAILED: 'Kamino मॉड्यूल डाउनलोड हुआ पर शुरू नहीं हो सका। ऐप अपडेट करें, और दोबारा हो तो यह संदेश सपोर्ट को भेजें।',
    KAMINO_TX_BUILD_EMPTY: 'Kamino ने इस कार्रवाई के लिए कोई ट्रांज़ैक्शन नहीं लौटाया — कुछ भेजा नहीं गया और कोई शुल्क नहीं लगा।'
  },
  id: {
    TOKEN_NOT_ALLOWED: 'Token ini tidak ada dalam daftar teraudit pasar ini, jadi tidak dapat digunakan di sini.',
    POOL_NOT_ALLOWED: 'Alamat pool ini bukan pasar teraudit jaringan ini.',
    BAD_ADDRESS: 'Alamat ini tidak valid.',
    NO_TOKEN_REGISTRY: 'Daftar token pasar ini tidak dapat dimuat.',
    KAMINO_SDK_MISSING: 'Modul Kamino tidak ada di build ini — perbarui aplikasi.',
    KAMINO_SDK_FAILED: 'Modul Kamino gagal dijalankan. Perbarui aplikasi dan coba lagi.',
    KAMINO_SDK_TRUNCATED: 'Modul Kamino hanya terunduh sebagian — koneksi terputus. Coba lagi dengan koneksi yang lebih stabil.',
    KAMINO_SDK_INIT_FAILED: 'Modul Kamino terunduh tetapi gagal dijalankan. Perbarui aplikasi, dan jika berulang kirim pesan ini ke dukungan.',
    KAMINO_TX_BUILD_EMPTY: 'Kamino tidak mengembalikan transaksi untuk tindakan ini — tidak ada yang dikirim dan tidak ada biaya.'
  },
  pt: {
    TOKEN_NOT_ALLOWED: 'Este token não está na lista auditada deste mercado, então não pode ser usado aqui.',
    POOL_NOT_ALLOWED: 'Este endereço de pool não é o mercado auditado desta rede.',
    BAD_ADDRESS: 'Este endereço não é válido.',
    NO_TOKEN_REGISTRY: 'A lista de tokens deste mercado não pôde ser carregada.',
    KAMINO_SDK_MISSING: 'O módulo Kamino está ausente nesta versão — atualize o app.',
    KAMINO_SDK_FAILED: 'O módulo Kamino não pôde ser iniciado. Atualize o app e tente de novo.',
    KAMINO_SDK_TRUNCATED: 'O módulo Kamino foi baixado só em parte — a conexão caiu. Tente de novo numa conexão mais estável.',
    KAMINO_SDK_INIT_FAILED: 'O módulo Kamino foi baixado, mas falhou ao iniciar. Atualize o app e, se repetir, envie esta mensagem ao suporte.',
    KAMINO_TX_BUILD_EMPTY: 'A Kamino não retornou nenhuma transação para esta ação — nada foi enviado e nenhuma taxa foi cobrada.'
  },
  ru: {
    TOKEN_NOT_ALLOWED: 'Этого токена нет в проверенном списке этого рынка, поэтому его нельзя здесь использовать.',
    POOL_NOT_ALLOWED: 'Этот адрес пула — не проверенный рынок этой сети.',
    BAD_ADDRESS: 'Этот адрес недействителен.',
    NO_TOKEN_REGISTRY: 'Не удалось загрузить список токенов этого рынка.',
    KAMINO_SDK_MISSING: 'Модуль Kamino отсутствует в этой сборке — обновите приложение.',
    KAMINO_SDK_FAILED: 'Не удалось запустить модуль Kamino. Обновите приложение и попробуйте снова.',
    KAMINO_SDK_TRUNCATED: 'Модуль Kamino загрузился лишь частично — соединение оборвалось. Повторите попытку на более стабильной сети.',
    KAMINO_SDK_INIT_FAILED: 'Модуль Kamino загрузился, но не запустился. Обновите приложение, а если это повторится — отправьте это сообщение в поддержку.',
    KAMINO_TX_BUILD_EMPTY: 'Kamino не вернула транзакцию для этого действия — ничего не отправлено и комиссия не списана.'
  },
  tr: {
    TOKEN_NOT_ALLOWED: 'Bu token, bu piyasanın denetlenmiş listesinde yok; burada kullanılamaz.',
    POOL_NOT_ALLOWED: 'Bu havuz adresi, bu ağın denetlenmiş piyasası değil.',
    BAD_ADDRESS: 'Bu adres geçerli değil.',
    NO_TOKEN_REGISTRY: 'Bu piyasanın token listesi yüklenemedi.',
    KAMINO_SDK_MISSING: 'Kamino modülü bu sürümde eksik — uygulamayı güncelleyin.',
    KAMINO_SDK_FAILED: 'Kamino modülü başlatılamadı. Uygulamayı güncelleyip tekrar deneyin.',
    KAMINO_SDK_TRUNCATED: 'Kamino modülü yalnızca kısmen indirildi — bağlantı kesildi. Daha stabil bir bağlantıyla tekrar deneyin.',
    KAMINO_SDK_INIT_FAILED: 'Kamino modülü indirildi ancak başlatılamadı. Uygulamayı güncelleyin; tekrarlarsa bu mesajı desteğe gönderin.',
    KAMINO_TX_BUILD_EMPTY: 'Kamino bu işlem için işlem döndürmedi — hiçbir şey gönderilmedi ve ücret alınmadı.'
  },
  ur: {
    TOKEN_NOT_ALLOWED: 'یہ ٹوکن اس مارکیٹ کی آڈٹ شدہ فہرست میں نہیں، اس لیے یہاں استعمال نہیں ہو سکتا۔',
    POOL_NOT_ALLOWED: 'یہ پول پتہ اس نیٹ ورک کی آڈٹ شدہ مارکیٹ کا نہیں ہے۔',
    BAD_ADDRESS: 'یہ پتہ درست نہیں ہے۔',
    NO_TOKEN_REGISTRY: 'اس مارکیٹ کی ٹوکن فہرست لوڈ نہیں ہو سکی۔',
    KAMINO_SDK_MISSING: 'Kamino ماڈیول اس ورژن میں موجود نہیں — ایپ اپڈیٹ کریں۔',
    KAMINO_SDK_FAILED: 'Kamino ماڈیول شروع نہیں ہو سکا۔ ایپ اپڈیٹ کر کے دوبارہ کوشش کریں۔',
    KAMINO_SDK_TRUNCATED: 'Kamino ماڈیول ادھورا ڈاؤن لوڈ ہوا — کنکشن بیچ میں کٹ گیا۔ بہتر کنکشن پر دوبارہ کوشش کریں۔',
    KAMINO_SDK_INIT_FAILED: 'Kamino ماڈیول ڈاؤن لوڈ ہوا مگر شروع نہیں ہو سکا۔ ایپ اپڈیٹ کریں، اور دوبارہ ہو تو یہی پیغام سپورٹ کو بھیجیں۔',
    KAMINO_TX_BUILD_EMPTY: 'Kamino نے اس کارروائی کے لیے کوئی ٹرانزیکشن واپس نہیں کی — کچھ بھیجا نہیں گیا اور کوئی فیس نہیں کٹی۔'
  },
  zh: {
    TOKEN_NOT_ALLOWED: '该代币不在本市场的审计名单中，无法在此使用。',
    POOL_NOT_ALLOWED: '该资金池地址不是本网络的审计市场。',
    BAD_ADDRESS: '该地址无效。',
    NO_TOKEN_REGISTRY: '无法加载本市场的代币列表。',
    KAMINO_SDK_MISSING: '此版本缺少 Kamino 模块——请更新应用。',
    KAMINO_SDK_FAILED: 'Kamino 模块启动失败。请更新应用后重试。',
    KAMINO_SDK_TRUNCATED: 'Kamino 模块只下载了一部分——连接被中断。请在更稳定的网络下重试。',
    KAMINO_SDK_INIT_FAILED: 'Kamino 模块已下载但启动失败。请更新应用；若反复出现，请把这条消息发给客服。',
    KAMINO_TX_BUILD_EMPTY: 'Kamino 未返回该操作的交易——没有发送任何内容，也没有扣除手续费。'
  }
};

for (const [lang, strings] of Object.entries(STRINGS)) {
  const path = resolve(root, `src/i18n/locales/${lang}.json`);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  const errors = data?.loan?.error;
  if (!errors || typeof errors !== 'object') {
    console.error(`✗ ${lang}: no loan.error object`);
    process.exitCode = 1;
    continue;
  }
  let added = 0;
  for (const [key, value] of Object.entries(strings)) {
    if (errors[key] == null) {
      errors[key] = value;
      added += 1;
    }
  }
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`${added ? '✓' : '•'} ${lang}: ${added} keys added`);
}
