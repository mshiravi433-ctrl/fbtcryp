/**
 * i18n patch: the keys the local AI narrator and the honest push labels need.
 *
 * These were referenced from JSX before they existed in any locale file —
 * `gen-locales.mjs` catches exactly that and refuses to build, which is why
 * they are being added now rather than shipping as raw key names on screen.
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
  if (tree && typeof tree === 'object' && typeof tree.en === 'string') return tree[lang] ?? tree.en;
  if (tree && typeof tree === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(tree)) out[k] = slice(v, lang);
    return out;
  }
  return tree;
}

const T = {
  toast: {
    copied: { fa: 'در کلیپ‌بورد کپی شد', en: 'Copied to clipboard', ar: 'تم النسخ' }
  },

  signals: {
    /* Header when the read is narrated locally. Calling it "AI outlook" in
       that case would be a small lie that devalues every other label. */
    outlookLocal: { fa: 'تحلیل اندیکاتورها', en: 'Indicator read', ar: 'قراءة المؤشرات' },
    aiMetaLocal: {
      fa: 'این تحلیل روی همین دستگاه و مستقیماً از اندیکاتورها (RSI، MACD، بولینگر، میانگین متحرک، نوسان) ساخته شده است — هیچ مدل زبانی در آن دخالت ندارد. هر جمله از عددی می‌آید که واقعاً محاسبه شده.',
      en: 'Generated on this device straight from the indicators (RSI, MACD, Bollinger, moving averages, volatility). No language model is involved — every sentence comes from a number that was actually computed.',
      ar: 'وُلّد على هذا الجهاز مباشرة من المؤشرات (RSI، MACD، بولينجر، المتوسطات المتحركة، التذبذب). لا يشارك أي نموذج لغوي — كل جملة مبنية على رقم محسوب فعلاً.'
    },
    aiUnavailable: {
      fa: 'تحلیل این دارایی ساخته نشد — معمولاً یعنی تاریخچه قیمت کافی نیست. اندیکاتورهای بالا همچنان زنده‌اند.',
      en: 'No outlook could be built for this asset — usually that means there is not enough price history. The indicator signals above are still live.',
      ar: 'تعذّر بناء قراءة لهذا الأصل — غالباً بسبب قلة التاريخ السعري. مؤشرات الأعلى لا تزال حية.'
    }
  },

  notify: {
    modeServer: { fa: 'پوش فعال', en: 'Push active', ar: 'الدفع مفعّل' },
    modeLocal: { fa: 'فقط روی دستگاه', en: 'Device only', ar: 'على الجهاز فقط' },
    dailySubLocal: {
      fa: 'حداکثر روزی یک پیام. در این نسخه، پیام دفعه بعد که اپ را باز کنی نمایش داده می‌شود و خودش روی گوشی نمی‌آید — چون پوش سمت سرور تنظیم نشده است.',
      en: 'At most one a day. In this build it appears the next time you open the app rather than arriving on your phone by itself, because no server-side push is configured.',
      ar: 'رسالة واحدة يومياً كحد أقصى. في هذه النسخة تظهر عند فتحك التطبيق لاحقاً ولا تصل إلى هاتفك تلقائياً، لعدم تهيئة الدفع من الخادم.'
    },
    pushLocal: {
      fa: 'پوش سمت سرور تنظیم نشده است. اعلان‌ها به‌صورت محلی زمان‌بندی می‌شوند و دفعه بعد که اپ را باز کنی نمایش داده می‌شوند. این یک قابلیت واقعی است، اما پوش نیست — و ترجیح می‌دهیم صریح بگوییم تا اینکه وانمود کنیم پوش داریم.',
      en: 'No server-side push is configured. Notifications are scheduled locally and appear the next time you open the app. That is a real feature, but it is not push — and we would rather say so than pretend otherwise.',
      ar: 'لم يُهيَّأ الدفع من الخادم. تُجدوَل الإشعارات محلياً وتظهر عند فتحك التطبيق لاحقاً. هذه ميزة حقيقية لكنها ليست دفعاً، ونفضّل قول ذلك بوضوح.'
    },
    pushOn: {
      fa: 'پوش سمت سرور فعال است: حتی وقتی اپ کاملاً بسته باشد، اعلان می‌رسد.',
      en: 'Server push is active: notifications arrive even when the app is fully closed.',
      ar: 'الدفع من الخادم مفعّل: تصل الإشعارات حتى والتطبيق مغلق تماماً.'
    }
  }
};

for (const lang of ['fa', 'en', 'ar']) {
  const p = path(lang);
  const json = JSON.parse(readFileSync(p, 'utf8'));
  merge(json, slice(T, lang));
  writeFileSync(p, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`patched ${lang}`);
}
