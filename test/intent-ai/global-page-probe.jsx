/**
 * GLOBAL PAGE PROBE — «جهانی» as a page of its own.
 * ---------------------------------------------------------------------------
 * The world console used to be the fifth News tab. It is now its own page:
 *
 *   · /global mounts it (GlobalWorld → AiGlobalIntelligence) and /ai-global
 *     forwards there;
 *   · it is gone from the News tab rail, and #/news?tab=global (an old link, a
 *     refreshed WebView) is forwarded to /global before News does any work;
 *   · More → «جهانی» opens it, with an icon of its own;
 *   · on wide screens the shell opens up instead of leaving a phone column;
 *   · the new menu label exists in every language.
 *
 * Build: vite build -c test/vite.global-page.mjs
 * Run:   node test/run-one-probe.mjs ./.out/global-page/global-page-probe.js
 */
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import i18n, { setLanguage } from '../../src/i18n/index.js';
import GlobalWorld from '../../src/pages/GlobalWorld.jsx';
import News from '../../src/pages/News.jsx';
import MoreSheet from '../../src/components/MoreSheet.jsx';
import { INTEL, BRIEFING, CROSS, PROVIDERS, FLOWS, MACRO_GRAPH } from './world-console-probe.jsx';
import appSource from '../../src/App.jsx?raw';
import newsSource from '../../src/pages/News.jsx?raw';
import cssSource from '../../src/index.css?raw';
import ar from '../../src/i18n/locales/ar.json';
import en from '../../src/i18n/locales/en.json';
import es from '../../src/i18n/locales/es.json';
import fa from '../../src/i18n/locales/fa.json';
import fr from '../../src/i18n/locales/fr.json';
import hi from '../../src/i18n/locales/hi.json';
import id from '../../src/i18n/locales/id.json';
import pt from '../../src/i18n/locales/pt.json';
import ru from '../../src/i18n/locales/ru.json';
import tr from '../../src/i18n/locales/tr.json';
import ur from '../../src/i18n/locales/ur.json';
import zh from '../../src/i18n/locales/zh.json';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastPath = '/';
function LocationSpy() {
  const loc = useLocation();
  lastPath = loc.pathname + loc.search;
  return null;
}

export async function run(container) {
  const rows = [];
  const check = (name, ok, detail) => { rows.push([name, !!ok]); console.log(`${ok ? '✓' : '✗'} ${name}${!ok && detail ? `  ← ${detail}` : ''}`); };
  const all = (sel, scope = document) => Array.from(scope.querySelectorAll(sel));
  const errors = [];
  const realError = console.error;
  console.error = (...a) => {
    const s = String(a[0] ?? '');
    if (s.includes('useLayoutEffect') || s.includes('act(') || s.includes('not wrapped')) return;
    if (s.includes('Not implemented') || s.includes('React Router Future Flag')) return;
    errors.push(s);
  };

  const realFetch = global.fetch;
  global.fetch = async (url) => {
    const path = String(url);
    if (path.includes('/insights/flows')) return { ok: true, json: async () => FLOWS };
    if (path.includes('/global/providers')) return { ok: true, json: async () => PROVIDERS };
    if (path.includes('/deep/macro-graph')) return { ok: true, json: async () => MACRO_GRAPH };
    return {
      ok: true,
      headers: { get: () => null },
      json: async () => {
        if (path.includes('/global/briefing')) return BRIEFING;
        if (path.includes('/global/cross-asset')) return CROSS;
        if (path.includes('/global/intelligence')) return INTEL;
        return { ok: false, items: [], rows: [] };
      }
    };
  };

  await act(async () => { await setLanguage('fa'); });

  /* ── 1. the page ────────────────────────────────────────────────────── */
  let root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/global']}>
        <LocationSpy />
        <Routes><Route path="/global" element={<GlobalWorld />} /></Routes>
      </MemoryRouter>
    );
  });
  await act(async () => { await sleep(60); });
  check('page: /global mounts the console inside a page frame (main.page--global › .ai-global)',
    all('main.page.page--global > .ai-global.gw-root', container).length === 1);
  check('page: the banner says «هوش جهانی» — never FBT',
    (all('.gw-hero-title', container)[0]?.textContent || '').trim() === 'هوش جهانی'
    && !/FBT/i.test(all('.gw-hero', container)[0]?.textContent || ''));
  check('page: the status report is on screen with its twelve tappable tiles',
    all('button.gw-tile[data-tile]', container).length === 12);
  await act(async () => { root.unmount(); });
  container.innerHTML = '';

  /* ── 2. News: no Global tab, and the old link is forwarded ──────────── */
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/news?tab=global']}>
        <LocationSpy />
        <Routes>
          <Route path="/news" element={<News />} />
          <Route path="/global" element={<div data-testid="global-page">global</div>} />
        </Routes>
      </MemoryRouter>
    );
  });
  await act(async () => { await sleep(30); });
  check('news: #/news?tab=global is forwarded to /global (replace), and News never rendered',
    lastPath === '/global' && all('[data-testid="global-page"]', container).length === 1
    && all('.news-mode-tabs', container).length === 0, lastPath);
  await act(async () => { root.unmount(); });
  container.innerHTML = '';

  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/news']}>
        <LocationSpy />
        <Routes><Route path="/news" element={<News />} /></Routes>
      </MemoryRouter>
    );
  });
  await act(async () => { await sleep(60); });
  const railButtons = all('.news-mode-tabs button', container);
  check('news: the tab rail has five tabs — read, community, listen, insights, calm — and no Global',
    railButtons.length === 5 && !railButtons.some((b) => /هوش جهانی|جهانی|Global/.test(b.textContent || '')),
    railButtons.map((b) => (b.textContent || '').trim()).join(' | '));
  check('news: the tab list in source no longer carries «global»',
    /const NEWS_TABS = \['read', 'community', 'listen', 'insights', 'calm'\];/.test(newsSource)
    && !/<AiGlobalIntelligence/.test(newsSource));
  await act(async () => { root.unmount(); });
  container.innerHTML = '';

  /* ── 3. More → «جهانی» ──────────────────────────────────────────────── */
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/']}>
        <LocationSpy />
        <MoreSheet open onClose={() => {}} />
      </MemoryRouter>
    );
  });
  await act(async () => { await sleep(40); });
  const tiles = all('.more-tile');
  const label = (b) => (b.querySelector('.more-tile-label')?.textContent || '').trim();
  const globalTile = tiles.find((b) => label(b) === 'جهانی');
  const newsTile = tiles.find((b) => label(b) === 'اخبار');
  const ecoTile = tiles.find((b) => label(b) === 'اکوسیستم');
  check('more: a tile named «جهانی» exists', !!globalTile, tiles.map(label).join(' | '));
  check('more: it sits right after «اخبار»',
    !!globalTile && !!newsTile && tiles.indexOf(globalTile) === tiles.indexOf(newsTile) + 1);
  check('more: it has an icon of its own — not the Ecosystem globe',
    !!globalTile && !!ecoTile
    && !!globalTile.querySelector('svg') && !!ecoTile.querySelector('svg')
    && globalTile.querySelector('svg').innerHTML !== ecoTile.querySelector('svg').innerHTML);
  await act(async () => { globalTile?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(260); });
  check('more: tapping it opens /global', lastPath === '/global', lastPath);
  await act(async () => { root.unmount(); });
  container.innerHTML = '';

  /* ── 4. routing, width, cold start — read from the source that ships ── */
  check('routes: /global mounts GlobalWorld through a lazy import of the page',
    /<Route path="\/global" element=\{<GlobalWorld \/>\} \/>/.test(appSource)
    && /const GlobalWorld = lazyRetry\(\(\) => import\('\.\/pages\/GlobalWorld'\)\);/.test(appSource));
  check('routes: /ai-global stays as an alias that forwards to /global',
    /<Route path="\/ai-global" element=\{<Navigate to="\/global" replace \/>\} \/>/.test(appSource));
  const landing = appSource.match(/const AI_LANDING_HASH = (\/[^\n]+\/i);/);
  const landingRe = landing ? new RegExp(landing[1].slice(1, -2)) : null;
  check('cold start: #/global is a deliberate address — it is not reset to the market',
    !!landingRe && !landingRe.test('#/global') && !landingRe.test('#/global?x=1'));
  check('width: AppChrome tags the shell «app-shell--wide» on /global',
    /const wide = pathname === '\/global' \|\| pathname\.startsWith\('\/global\/'\);/.test(appSource)
    && /\$\{wide \? ' app-shell--wide' : ''\}/.test(appSource));
  check('width: the shell opens to ~1360px from 900px and 820px on tablets; the page frame adds no gutter',
    /@media \(min-width: 900px\) \{\s*\.app-shell\.app-shell--wide,\s*\.app-shell\.app-shell--wide \.top-bar \{\s*max-width: min\(1360px, 100%\);/.test(cssSource)
    && /@media \(min-width: 600px\) and \(max-width: 899px\) \{\s*\.app-shell\.app-shell--wide,\s*\.app-shell\.app-shell--wide \.top-bar \{\s*max-width: 820px;/.test(cssSource)
    && /\.page\.page--global \{\s*padding: 4px 0 20px;\s*gap: 0;/.test(cssSource));
  const locales = { ar, en, es, fa, fr, hi, id, pt, ru, tr, ur, zh };
  const missing = Object.entries(locales).filter(([, d]) => !d?.nav?.global).map(([k]) => k);
  check('i18n: nav.global exists in all twelve languages', missing.length === 0, missing.join(','));
  check('i18n: the Persian label is exactly «جهانی»', fa.nav.global === 'جهانی' && en.nav.global === 'Global');

  global.fetch = realFetch;
  console.error = realError;
  const realErrors = errors.filter((e) => !/Warning|act\(|Not implemented/i.test(e));
  check('no fatal JS error was logged during any pass', realErrors.length === 0, realErrors[0]);
  return rows;
}
