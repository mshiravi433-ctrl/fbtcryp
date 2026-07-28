/** i18n patch: support phone on the Contact screen (required by Play review). */
import { readFileSync, writeFileSync } from 'node:fs';
const path = (l) => new URL(`../src/i18n/locales/${l}.json`, import.meta.url);
const T = {
  fa: { phone: 'تلفن پشتیبانی', call: 'تماس' },
  en: { phone: 'Support phone', call: 'Call' },
  ar: { phone: 'هاتف الدعم', call: 'اتصال' }
};
for (const [lang, v] of Object.entries(T)) {
  const p = path(lang);
  const json = JSON.parse(readFileSync(p, 'utf8'));
  json.contact ??= {};
  Object.assign(json.contact, v);
  writeFileSync(p, `${JSON.stringify(json, null, 2)}\n`);
  console.log('patched', lang);
}
