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
    KAMINO_SDK_FAILED: 'The Kamino module failed to start. Please update the app and try again.'
  },
  fa: {
    TOKEN_NOT_ALLOWED: 'این توکن در فهرست تأییدشده این بازار نیست، پس اینجا قابل استفاده نیست. دارایی را دوباره در همین بازار انتخاب کن.',
    POOL_NOT_ALLOWED: 'آدرس این استخر با بازار تأییدشده این شبکه یکی نیست.',
    BAD_ADDRESS: 'این آدرس معتبر نیست.',
    NO_TOKEN_REGISTRY: 'فهرست توکن‌های این بازار بارگذاری نشد.',
    KAMINO_SDK_MISSING: 'ماژول Kamino در این نسخه از اپ وجود ندارد — اپ را به‌روزرسانی کن.',
    KAMINO_SDK_FAILED: 'ماژول Kamino اجرا نشد. اپ را به‌روزرسانی کن و دوباره تلاش کن.'
  },
  ar: {
    TOKEN_NOT_ALLOWED: 'هذا الرمز ليس في القائمة المدققة لهذه السوق، لذا لا يمكن استخدامه هنا.',
    POOL_NOT_ALLOWED: 'عنوان هذا المجمّع ليس سوق الشبكة المدقق.',
    BAD_ADDRESS: 'هذا العنوان غير صالح.',
    NO_TOKEN_REGISTRY: 'تعذّر تحميل قائمة رموز هذه السوق.',
    KAMINO_SDK_MISSING: 'وحدة Kamino مفقودة في هذا الإصدار — حدّث التطبيق.',
    KAMINO_SDK_FAILED: 'تعذّر تشغيل وحدة Kamino. حدّث التطبيق وحاول مجددًا.'
  },
  es: {
    TOKEN_NOT_ALLOWED: 'Este token no está en la lista auditada de este mercado, así que no puede usarse aquí.',
    POOL_NOT_ALLOWED: 'Esta dirección de pool no es el mercado auditado de esta red.',
    BAD_ADDRESS: 'Esta dirección no es válida.',
    NO_TOKEN_REGISTRY: 'No se pudo cargar la lista de tokens de este mercado.',
    KAMINO_SDK_MISSING: 'El módulo Kamino falta en esta versión — actualiza la app.',
    KAMINO_SDK_FAILED: 'El módulo Kamino no pudo iniciarse. Actualiza la app e inténtalo de nuevo.'
  },
  fr: {
    TOKEN_NOT_ALLOWED: 'Ce jeton ne figure pas dans la liste auditée de ce marché ; il ne peut pas être utilisé ici.',
    POOL_NOT_ALLOWED: 'Cette adresse de pool n’est pas le marché audité de ce réseau.',
    BAD_ADDRESS: 'Cette adresse n’est pas valide.',
    NO_TOKEN_REGISTRY: 'La liste des jetons de ce marché n’a pas pu être chargée.',
    KAMINO_SDK_MISSING: 'Le module Kamino est absent de cette version — mettez à jour l’app.',
    KAMINO_SDK_FAILED: 'Le module Kamino n’a pas pu démarrer. Mettez à jour l’app et réessayez.'
  },
  hi: {
    TOKEN_NOT_ALLOWED: 'यह टोकन इस मार्केट की ऑडिटेड सूची में नहीं है, इसलिए यहाँ इस्तेमाल नहीं हो सकता।',
    POOL_NOT_ALLOWED: 'यह पूल पता इस नेटवर्क के ऑडिटेड मार्केट का नहीं है।',
    BAD_ADDRESS: 'यह पता मान्य नहीं है।',
    NO_TOKEN_REGISTRY: 'इस मार्केट की टोकन सूची लोड नहीं हो सकी।',
    KAMINO_SDK_MISSING: 'इस बिल्ड में Kamino मॉड्यूल मौजूद नहीं है — ऐप अपडेट करें।',
    KAMINO_SDK_FAILED: 'Kamino मॉड्यूल शुरू नहीं हो सका। ऐप अपडेट करके फिर कोशिश करें।'
  },
  id: {
    TOKEN_NOT_ALLOWED: 'Token ini tidak ada dalam daftar teraudit pasar ini, jadi tidak dapat digunakan di sini.',
    POOL_NOT_ALLOWED: 'Alamat pool ini bukan pasar teraudit jaringan ini.',
    BAD_ADDRESS: 'Alamat ini tidak valid.',
    NO_TOKEN_REGISTRY: 'Daftar token pasar ini tidak dapat dimuat.',
    KAMINO_SDK_MISSING: 'Modul Kamino tidak ada di build ini — perbarui aplikasi.',
    KAMINO_SDK_FAILED: 'Modul Kamino gagal dijalankan. Perbarui aplikasi dan coba lagi.'
  },
  pt: {
    TOKEN_NOT_ALLOWED: 'Este token não está na lista auditada deste mercado, então não pode ser usado aqui.',
    POOL_NOT_ALLOWED: 'Este endereço de pool não é o mercado auditado desta rede.',
    BAD_ADDRESS: 'Este endereço não é válido.',
    NO_TOKEN_REGISTRY: 'A lista de tokens deste mercado não pôde ser carregada.',
    KAMINO_SDK_MISSING: 'O módulo Kamino está ausente nesta versão — atualize o app.',
    KAMINO_SDK_FAILED: 'O módulo Kamino não pôde ser iniciado. Atualize o app e tente de novo.'
  },
  ru: {
    TOKEN_NOT_ALLOWED: 'Этого токена нет в проверенном списке этого рынка, поэтому его нельзя здесь использовать.',
    POOL_NOT_ALLOWED: 'Этот адрес пула — не проверенный рынок этой сети.',
    BAD_ADDRESS: 'Этот адрес недействителен.',
    NO_TOKEN_REGISTRY: 'Не удалось загрузить список токенов этого рынка.',
    KAMINO_SDK_MISSING: 'Модуль Kamino отсутствует в этой сборке — обновите приложение.',
    KAMINO_SDK_FAILED: 'Не удалось запустить модуль Kamino. Обновите приложение и попробуйте снова.'
  },
  tr: {
    TOKEN_NOT_ALLOWED: 'Bu token, bu piyasanın denetlenmiş listesinde yok; burada kullanılamaz.',
    POOL_NOT_ALLOWED: 'Bu havuz adresi, bu ağın denetlenmiş piyasası değil.',
    BAD_ADDRESS: 'Bu adres geçerli değil.',
    NO_TOKEN_REGISTRY: 'Bu piyasanın token listesi yüklenemedi.',
    KAMINO_SDK_MISSING: 'Kamino modülü bu sürümde eksik — uygulamayı güncelleyin.',
    KAMINO_SDK_FAILED: 'Kamino modülü başlatılamadı. Uygulamayı güncelleyip tekrar deneyin.'
  },
  ur: {
    TOKEN_NOT_ALLOWED: 'یہ ٹوکن اس مارکیٹ کی آڈٹ شدہ فہرست میں نہیں، اس لیے یہاں استعمال نہیں ہو سکتا۔',
    POOL_NOT_ALLOWED: 'یہ پول پتہ اس نیٹ ورک کی آڈٹ شدہ مارکیٹ کا نہیں ہے۔',
    BAD_ADDRESS: 'یہ پتہ درست نہیں ہے۔',
    NO_TOKEN_REGISTRY: 'اس مارکیٹ کی ٹوکن فہرست لوڈ نہیں ہو سکی۔',
    KAMINO_SDK_MISSING: 'Kamino ماڈیول اس ورژن میں موجود نہیں — ایپ اپڈیٹ کریں۔',
    KAMINO_SDK_FAILED: 'Kamino ماڈیول شروع نہیں ہو سکا۔ ایپ اپڈیٹ کر کے دوبارہ کوشش کریں۔'
  },
  zh: {
    TOKEN_NOT_ALLOWED: '该代币不在本市场的审计名单中，无法在此使用。',
    POOL_NOT_ALLOWED: '该资金池地址不是本网络的审计市场。',
    BAD_ADDRESS: '该地址无效。',
    NO_TOKEN_REGISTRY: '无法加载本市场的代币列表。',
    KAMINO_SDK_MISSING: '此版本缺少 Kamino 模块——请更新应用。',
    KAMINO_SDK_FAILED: 'Kamino 模块启动失败。请更新应用后重试。'
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
