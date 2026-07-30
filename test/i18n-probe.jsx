import i18n, { setLanguage } from '../src/i18n/index.js';
export async function run() {
  const out = [];
  out.push(['boots without throwing', Boolean(i18n)]);
  out.push(['English fallback resolves immediately', i18n.t('nav.swap') === 'Swap']);
  // fa autoloads at boot
  await new Promise((r) => setTimeout(r, 400));
  out.push(['fa loaded asynchronously', i18n.language === 'fa' && i18n.t('nav.swap') === 'سواپ']);
  const ok = await setLanguage('tr');
  out.push(['switching to tr loads its chunk', ok === true && i18n.language === 'tr']);
  out.push(['tr string is Turkish, not a raw key', !i18n.t('nav.swap').includes('nav.')]);
  const back = await setLanguage('fa');
  out.push(['switching back to fa works', back === true && i18n.t('nav.swap') === 'سواپ']);
  out.push(['unsupported code is rejected', (await setLanguage('xx')) === false]);
  return out;
}
