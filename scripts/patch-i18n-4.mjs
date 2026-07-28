/** i18n patch: the "why is AI offline" disclosure in Help. */
import { readFileSync, writeFileSync } from 'node:fs';
const path = (l) => new URL(`../src/i18n/locales/${l}.json`, import.meta.url);
const T = {
  fa: 'چرا هوش مصنوعی سمت سرور کار نمی‌کند؟',
  en: 'Why is the server-side AI not working?',
  ar: 'لماذا لا يعمل الذكاء الاصطناعي على الخادم؟'
};
for (const [lang, text] of Object.entries(T)) {
  const p = path(lang);
  const json = JSON.parse(readFileSync(p, 'utf8'));
  json.help ??= {};
  json.help.aiWhy = text;
  writeFileSync(p, `${JSON.stringify(json, null, 2)}\n`);
  console.log('patched', lang);
}
