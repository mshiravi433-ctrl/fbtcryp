/**
 * i18n patch: the browsable FAQ that replaces the AI assistant in Help.
 *
 * Questions live here (they need to read naturally per language); the answers
 * live in src/lib/faqLocal.js because they are long-form, safety-relevant and
 * already reviewed.
 *
 * `seedLost` is renamed to `seed` and `network` to `chains` so the question
 * ids line up 1:1 with the knowledge-base ids — two parallel naming schemes
 * for the same twelve topics is exactly how a mismatch slips in later.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const path = (l) => new URL(`../src/i18n/locales/${l}.json`, import.meta.url);

const Q = {
  fees: {
    fa: 'چه کارمزدی می‌گیرید؟',
    en: 'What fees do you charge?',
    ar: 'ما هي الرسوم؟'
  },
  gas: {
    fa: 'کارمزد شبکه (گس) چیست و با چه کوینی پرداخت می‌شود؟',
    en: 'What is gas, and which coin pays it?',
    ar: 'ما هو الغاز وبأي عملة يُدفع؟'
  },
  failed: {
    fa: 'چرا سواپ من انجام نشد؟',
    en: 'Why did my swap fail?',
    ar: 'لماذا فشلت عملية التبادل؟'
  },
  slippage: {
    fa: 'لغزش قیمت (اسلیپیج) یعنی چه؟',
    en: 'What does slippage mean?',
    ar: 'ما معنى الانزلاق السعري؟'
  },
  custody: {
    fa: 'آیا دارایی من دست شماست؟',
    en: 'Do you hold my funds?',
    ar: 'هل تحتفظون بأموالي؟'
  },
  seed: {
    fa: 'اگر عبارت بازیابی را گم کنم چه می‌شود؟',
    en: 'What happens if I lose my recovery phrase?',
    ar: 'ماذا لو فقدت عبارة الاسترداد؟'
  },
  coins: {
    fa: 'چند سکه قابل سواپ است و اگر سکه‌ام نبود چه کنم؟',
    en: 'How many coins can I swap, and what if mine is missing?',
    ar: 'كم عملة يمكن تبادلها وماذا لو لم أجد عملتي؟'
  },
  chains: {
    fa: 'چه شبکه‌هایی پشتیبانی می‌شوند؟',
    en: 'Which networks are supported?',
    ar: 'ما الشبكات المدعومة؟'
  },
  connect: {
    fa: 'چطور کیف پولم را وصل کنم؟',
    en: 'How do I connect my wallet?',
    ar: 'كيف أربط محفظتي؟'
  },
  realMoney: {
    fa: 'کدام بخش‌ها با پول واقعی کار می‌کنند؟',
    en: 'Which parts use real money?',
    ar: 'أي الأقسام تستخدم أموالاً حقيقية؟'
  },
  notFound: {
    fa: 'چرا گاهی می‌نویسد «ارز پیدا نشد»؟',
    en: 'Why does it sometimes say "coin not found"?',
    ar: 'لماذا تظهر أحياناً «العملة غير موجودة»؟'
  },
  iranLegal: {
    fa: 'وضعیت قانونی این اپ در ایران چگونه است؟',
    en: 'What is the legal position in Iran?',
    ar: 'ما الوضع القانوني في إيران؟'
  }
};

const EXTRA = {
  fa: {
    faqTitle: 'سوال‌های متداول',
    faqSubtitle: 'پاسخ‌های نوشته‌شده توسط تیم، درباره همین اپ — نه تولید خودکار.',
    guideCta: 'راهنمای گام‌به‌گام را ببین',
    guideCtaSub: 'آموزش کامل سواپ، کیف پول، امنیت و سیگنال‌ها',
    stillStuck: 'جوابت را پیدا نکردی؟',
    stillStuckSub: 'مستقیم به پشتیبانی پیام بده — یک نفر واقعی جواب می‌دهد.'
  },
  en: {
    faqTitle: 'Frequently asked questions',
    faqSubtitle: 'Written by the team, about this app — not auto-generated.',
    guideCta: 'Open the step-by-step guide',
    guideCtaSub: 'Full walkthrough of swaps, wallets, security and signals',
    stillStuck: 'Did not find your answer?',
    stillStuckSub: 'Message support directly — a real person replies.'
  },
  ar: {
    faqTitle: 'الأسئلة الشائعة',
    faqSubtitle: 'مكتوبة من الفريق عن هذا التطبيق — وليست مولّدة آلياً.',
    guideCta: 'افتح الدليل خطوة بخطوة',
    guideCtaSub: 'شرح كامل للتبادل والمحافظ والأمان والإشارات',
    stillStuck: 'لم تجد إجابتك؟',
    stillStuckSub: 'راسل الدعم مباشرة — يرد عليك شخص حقيقي.'
  }
};

/* Keys that belonged to the removed AI assistant. Leaving them behind would
   inflate the translation-coverage figure with strings nothing renders. */
const REMOVE = [
  'askAi',
  'askAiSub',
  'askPlaceholder',
  'aiOffline',
  'aiFailed',
  'aiCaveat',
  'aiSourceLocal',
  'aiSourceModel',
  'aiNoAnswer',
  'aiLocalMode',
  'aiWhy'
];

for (const lang of ['fa', 'en', 'ar']) {
  const p = path(lang);
  const json = JSON.parse(readFileSync(p, 'utf8'));
  json.help ??= {};
  json.help.q ??= {};

  for (const [id, byLang] of Object.entries(Q)) json.help.q[id] = byLang[lang];

  // Old ids replaced by knowledge-base-aligned ones.
  delete json.help.q.seedLost;
  delete json.help.q.network;

  for (const k of REMOVE) delete json.help[k];
  Object.assign(json.help, EXTRA[lang]);

  writeFileSync(p, `${JSON.stringify(json, null, 2)}\n`);
  console.log('patched', lang);
}
