/**
 * i18n patch: display-name field and the swap flip control.
 *
 * Same pattern as patch-i18n.mjs — every key is written to fa, en and ar in
 * one pass so the three maintained locales cannot drift apart, and the core
 * strings are added to the nine partial locales too.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const path = (l) => new URL(`../src/i18n/locales/${l}.json`, import.meta.url);

function merge(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) target[k] = merge(target[k] ?? {}, v);
    else target[k] = v;
  }
  return target;
}

function slice(tree, lang) {
  if (tree && typeof tree === 'object' && 'en' in tree && typeof tree.en === 'string') {
    return tree[lang] ?? tree.en;
  }
  if (tree && typeof tree === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(tree)) out[k] = slice(v, lang);
    return out;
  }
  return tree;
}

const MAIN = {
  profile: {
    username: { fa: 'نام نمایشی', en: 'Display name', ar: 'اسم العرض' },
    usernameLabel: { fa: 'نام نمایشی (اختیاری)', en: 'Display name (optional)', ar: 'اسم العرض (اختياري)' },
    usernamePlaceholder: { fa: 'مثلاً: علی', en: 'e.g. Ali', ar: 'مثلاً: علي' },
    usernameUnset: { fa: 'تنظیم نشده', en: 'Not set', ar: 'غير محدد' },
    usernameHelp: {
      fa: 'همین نام کنار امتیاز تو در جدول رتبه‌بندی نشان داده می‌شود. حساب کاربری نیست، رمز ندارد و رزرو هم نمی‌شود — فقط یک نام نمایشی. هویت واقعی تو در این اپ، آدرس کیف پول خودت است.',
      en: 'This is the name shown next to your score on the leaderboard. It is not an account, it has no password and nothing is reserved — just a nickname. Your real identity here is your wallet address.',
      ar: 'هذا الاسم يظهر بجوار نقاطك في لوحة الترتيب. ليس حساباً ولا كلمة مرور له — مجرد لقب. هويتك الحقيقية هنا هي عنوان محفظتك.'
    },
    username_tooShort: {
      fa: 'حداقل ۲ حرف لازم است.',
      en: 'At least 2 characters.',
      ar: 'حرفان على الأقل.'
    }
  },
  swap: {
    flip: { fa: 'جابه‌جایی دو ارز', en: 'Swap the two tokens', ar: 'تبديل العملتين' }
  }
};

for (const lang of ['fa', 'en', 'ar']) {
  const p = path(lang);
  const json = JSON.parse(readFileSync(p, 'utf8'));
  merge(json, slice(MAIN, lang));
  writeFileSync(p, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`patched ${lang}`);
}

/* The nine partial locales get the label and placeholder: an unlabelled text
   box next to a language list is a mystery, and the help text below it can
   fall back to English without anyone being confused about what to type. */
const PARTIAL = {
  zh: { label: '显示名称（可选）', ph: '例如：小明', unset: '未设置' },
  hi: { label: 'प्रदर्शित नाम (वैकल्पिक)', ph: 'जैसे: आरव', unset: 'सेट नहीं' },
  es: { label: 'Nombre visible (opcional)', ph: 'p. ej. Ana', unset: 'Sin definir' },
  fr: { label: 'Nom affiché (facultatif)', ph: 'ex. Marie', unset: 'Non défini' },
  ru: { label: 'Отображаемое имя (необязательно)', ph: 'напр. Иван', unset: 'Не задано' },
  tr: { label: 'Görünen ad (isteğe bağlı)', ph: 'örn. Ayşe', unset: 'Ayarlanmadı' },
  ur: { label: 'ظاہری نام (اختیاری)', ph: 'مثلاً: علی', unset: 'مقرر نہیں' },
  id: { label: 'Nama tampilan (opsional)', ph: 'mis. Budi', unset: 'Belum diatur' },
  pt: { label: 'Nome de exibição (opcional)', ph: 'ex. João', unset: 'Não definido' }
};

for (const [lang, v] of Object.entries(PARTIAL)) {
  const p = path(lang);
  const json = JSON.parse(readFileSync(p, 'utf8'));
  merge(json, {
    profile: { usernameLabel: v.label, usernamePlaceholder: v.ph, usernameUnset: v.unset }
  });
  writeFileSync(p, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`patched ${lang} (partial)`);
}
