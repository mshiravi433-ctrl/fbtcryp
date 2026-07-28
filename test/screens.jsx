/**
 * Smoke-render every screen touched by this change.
 *
 * These pages are lazy-loaded behind routes, so a broken import or a bad hook
 * call in one of them does not fail the build and does not fail the existing
 * boot test either — it fails silently at runtime for whoever taps that tab.
 * Rendering each one directly is the cheapest way to catch that.
 */
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { HashRouter } from 'react-router-dom';
import '../src/i18n/index.js';
import { TelegramProvider } from '../src/context/TelegramContext.jsx';
import { WalletProvider } from '../src/context/WalletContext.jsx';
import Welcome from '../src/pages/Welcome.jsx';
import News from '../src/pages/News.jsx';
import Swap from '../src/pages/Swap.jsx';
import Leaderboard from '../src/pages/Leaderboard.jsx';
import Help from '../src/pages/Help.jsx';
import LanguagePicker from '../src/components/LanguagePicker.jsx';
import { setLanguage } from '../src/i18n/index.js';
import { LANGUAGES } from '../src/i18n/languages.js';

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
  const errors = [];
  const realError = console.error;
  console.error = (...a) => {
    const s = String(a[0] ?? '');
    if (s.includes('useLayoutEffect') || s.includes('act(') || s.includes('not wrapped')) return;
    errors.push(s);
  };

  async function mount(name, node) {
    const before = errors.length;
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(<Wrap>{node}</Wrap>);
      });
      const rendered = container.textContent.trim().length > 0;
      out.push([`${name} renders`, rendered]);
      out.push([`${name} renders without a React error`, errors.length === before]);
    } catch (e) {
      out.push([`${name} renders`, false]);
      out.push([`${name} renders without a React error`, false]);
      errors.push(`${name}: ${e.message}`);
    } finally {
      await act(async () => root.unmount());
    }
  }

  await mount('Welcome', <Welcome onDone={() => {}} />);
  await mount('News', <News />);
  await mount('Swap', <Swap />);
  await mount('Leaderboard', <Leaderboard />);
  await mount('Help', <Help />);

  /* Every language must render the picker without throwing. RTL languages in
     particular have bitten this app before — direction is applied to the
     document root, and a language whose meta is missing would silently leave
     the app in the previous direction. */
  for (const lang of LANGUAGES) {
    const root = createRoot(container);
    const before = errors.length;
    await act(async () => {
      setLanguage(lang.code);
      root.render(
        <Wrap>
          <LanguagePicker />
        </Wrap>
      );
    });
    out.push([`picker renders in ${lang.code}`, errors.length === before && container.textContent.includes(lang.endonym)]);
    out.push([
      `${lang.code} sets document direction to ${lang.dir}`,
      document.documentElement.getAttribute('dir') === lang.dir
    ]);
    await act(async () => root.unmount());
  }

  setLanguage('fa');
  console.error = realError;
  if (errors.length) out.push([`no console errors (${errors.slice(0, 2).join(' | ').slice(0, 200)})`, false]);
  return out;
}
