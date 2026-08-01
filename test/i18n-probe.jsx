import i18n, { setLanguage } from '../src/i18n/index.js';
export async function run() {
  const out = [];
  out.push(['boots without throwing', Boolean(i18n)]);
  out.push(['English fallback resolves immediately', i18n.t('nav.swap') === 'Swap']);
  /*
   * With no stored preference and no device hint, boot settles on ENGLISH.
   * It used to auto-select Persian, which meant an international user with no
   * signal opened a right-to-left app in a script they might not read.
   * Persian is now one tap away on the Welcome screen instead.
   */
  await new Promise((r) => setTimeout(r, 400));
  out.push(['boot settles on English by default', i18n.language === 'en']);
  out.push(['English strings are real, not raw keys', !i18n.t('nav.swap').includes('nav.')]);

  // Persian must still load correctly on demand — the default changed, not
  // the language support.
  const faOk = await setLanguage('fa');
  out.push(['fa loads on demand', faOk === true && i18n.t('nav.swap') === 'سواپ']);
  const ok = await setLanguage('tr');
  out.push(['switching to tr loads its chunk', ok === true && i18n.language === 'tr']);
  out.push(['tr string is Turkish, not a raw key', !i18n.t('nav.swap').includes('nav.')]);
  const back = await setLanguage('fa');
  out.push(['switching back to fa works', back === true && i18n.t('nav.swap') === 'سواپ']);
  out.push(['unsupported code is rejected', (await setLanguage('xx')) === false]);
  return out;
}
