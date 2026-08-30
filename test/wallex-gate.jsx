/**
 * BEHAVIORAL proof of the Iranians-only tab.
 *
 * Renders the REAL Buy page (providers + router + real i18n) and walks the
 * languages: the Wallex tab must exist ONLY while the live language is fa.
 * Everything else — en, ar (the other RTL language), tr — must not even show
 * the tab, and switching away from fa while the tab is OPEN must remove the
 * panel from under the user. This is the owner's hard requirement:
 * «این تب کلش فقط برای زبان فارسی بیاد بالا».
 */
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { HashRouter } from 'react-router-dom';
import '../src/i18n/index.js';
import i18n, { setLanguage } from '../src/i18n/index.js';
import { TelegramProvider } from '../src/context/TelegramContext.jsx';
import { WalletProvider } from '../src/context/WalletContext.jsx';
import Buy from '../src/pages/Buy.jsx';

function Wrap({ children }) {
  return (
    <TelegramProvider>
      <WalletProvider>
        <HashRouter>{children}</HashRouter>
      </WalletProvider>
    </TelegramProvider>
  );
}

export async function run(container) {
  const out = [];
  const check = (name, ok) => { out.push([name, ok]); console.log(`${ok ? '✓' : '✗'} ${name}`); };
  const errors = [];
  const realError = console.error;
  console.error = (...a) => {
    const s = String(a[0] ?? '');
    if (s.includes('useLayoutEffect') || s.includes('act(') || s.includes('Not implemented')) return;
    /* React 18's own deprecation notice for the act import this suite shares
       with screens.jsx — an environment note, not a component error. */
    if (s.includes('deprecated in favor of `React.act`')) return;
    errors.push(s);
  };

  const root = createRoot(container);
  await act(async () => {
    root.render(<Wrap><Buy /></Wrap>);
  });

  const text = () => container.textContent;
  const hasWallexTab = () => text().includes(i18n.t('buy.walletTabs.wallex'))
    && !i18n.t('buy.walletTabs.wallex').startsWith('buy.');
  const hasPanel = () => text().includes(i18n.t('buy.wallex.syncTitle'))
    && !i18n.t('buy.wallex.syncTitle').startsWith('buy.');

  try {
    /* 1) English (the default): NO third tab, NO panel. */
    await act(async () => { await setLanguage('en'); });
    check('en: the Wallex tab does not exist', !hasWallexTab() && !hasPanel());

    /* 2) Persian: the tab appears and opens the real panel. */
    await act(async () => { await setLanguage('fa'); });
    check('fa: «فقط برای ایرانیان» tab appears', hasWallexTab());
    const tabButton = [...container.querySelectorAll('button')]
      .find((b) => b.textContent.includes(i18n.t('buy.walletTabs.wallex')));
    check('fa: the tab is a real, clickable button', Boolean(tabButton));
    await act(async () => { tabButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    check('fa: opening the tab renders the Wallex desk', hasPanel());

    /* 3) The other RTL language (Arabic) must NOT keep the tab. */
    await act(async () => { await setLanguage('ar'); });
    check('ar: tab and panel are gone (fa ONLY, not "any RTL")', !hasWallexTab() && !hasPanel());

    /* 4) tr: still gone. */
    await act(async () => { await setLanguage('tr'); });
    check('tr: tab and panel are gone', !hasWallexTab() && !hasPanel());

    /* 5) Back to fa: it returns. */
    await act(async () => { await setLanguage('fa'); });
    check('fa: the tab returns', hasWallexTab());
    check('no React errors during the whole walk', errors.length === 0);
  } catch (e) {
    check(`gate walk threw: ${e.message}`, false);
  } finally {
    await act(async () => root.unmount());
    console.error = realError;
    await act(async () => { await setLanguage('en'); });
  }
  return out;
}
