// @vitest-environment jsdom
/**
 * THE BRAND RAIL AND THE SCREENSHOT IT SHARES.
 *
 * The request (2026-09-23): «وقتی در سایت و اپ اسکرین‌شات گرفته می‌شود، لوگو و نام
 * سایت (یا آدرس سایت) پایین صفحه باشد. باید مدرن باشد و سایت را درست معرفی کند.
 * دکمهٔ اشتراک‌گذاری اسکرین‌شات هم اضافه کن.»
 *
 * What is pinned here, and why each of these is the thing that could quietly rot:
 *
 *   1. THE ADDRESS IS DERIVED, NOT TYPED. It comes from `publicAppUrl()`, which
 *      refuses any origin that is not the canonical host — the defence that
 *      exists because a stale env var once made this app introduce itself as
 *      `lawpoetics.ir`. A brand rail that states the wrong address is worse than
 *      no rail, so the test compares the rail's words with the identity module
 *      rather than with a literal somebody wrote down.
 *   2. THE PICTURE EXCLUDES THE CHROME. The capture filter is applied to real
 *      elements: the bottom nav, the rail itself, a toast and anything carrying
 *      `data-screenshot-ignore` (the share button) are out; the page is in.
 *   3. EVERY RUNG TELLS THE TRUTH. Web Share with a file, the packaged app's
 *      sheet, save-and-copy, and the link-only fallback each report what actually
 *      happened — and a DISMISSED sheet is never an error toast.
 *   4. THE RAIL'S GEOMETRY IS THE NAV'S. Two fixed bars whose widths disagree
 *      look broken, and they are set in three different files, so the numbers are
 *      compared across the files instead of trusted.
 *   5. EVERY LANGUAGE CAN SAY IT — 9 new keys × 12 locales.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import en from '../src/i18n/locales/en.json';

const root = resolve(__dirname, '..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

const t = (key, values = {}) => {
  const text = key.split('.').reduce((node, part) => node?.[part], en) ?? key;
  return String(text).replace(/\{\{(\w+)\}\}/g, (_, name) => values[name] ?? '');
};
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t, i18n: { language: 'en' } }) }));

/* The packaged-app rung, switched per test. */
let nativeMode = false;
vi.mock('../src/lib/nativeShell', async () => {
  const actual = await vi.importActual('../src/lib/nativeShell');
  return { ...actual, isNativeShell: () => nativeMode };
});

const capacitorShare = vi.fn(async () => undefined);
const capacitorWrite = vi.fn(async ({ path }) => ({ uri: `file:///cache/${path}` }));
vi.mock('@capacitor/share', () => ({ Share: { share: (...args) => capacitorShare(...args) } }));
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' },
  Filesystem: { writeFile: (...args) => capacitorWrite(...args) }
}));

const { brandDomain, BRAND_NAME, brandMarkSvg, screenshotFilename } = await import('../src/lib/brand.js');
const { publicAppUrl } = await import('../src/lib/nativeShell');
const screenShare = await import('../src/lib/screenShare.js');
const { useAppStore } = await import('../src/store/useAppStore.js');
const BrandRail = (await import('../src/components/BrandRail.jsx')).default;

/** A Blob that behaves like a picture without being one. */
const fakePng = (bytes = 2048) => new Blob([new Uint8Array(bytes)], { type: 'image/png' });

const mountRail = (route = '/market') => render(
  <MemoryRouter initialEntries={[route]}><BrandRail /></MemoryRouter>
);

beforeEach(() => {
  nativeMode = false;
  capacitorShare.mockClear();
  capacitorWrite.mockClear();
  URL.createObjectURL = vi.fn(() => 'blob:fbtswap-mock');
  URL.revokeObjectURL = vi.fn();
  useAppStore.setState({ notifications: [], inbox: [] });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete navigator.share;
  delete navigator.canShare;
});

/* ═══════════════════ 1. the rail states who we are ═══════════════════════ */

describe('the rail names the app and its address', () => {
  it('draws the coin, the name, the canonical host and the share button', () => {
    const { getByTestId, container } = mountRail();
    const rail = getByTestId('brand-rail');
    expect(rail.querySelector('svg'), 'the mark is drawn, not a word').toBeTruthy();
    expect(rail.textContent).toContain(BRAND_NAME);
    expect(rail.textContent).toContain(brandDomain());
    expect(getByTestId('screenshot-share')).toBeTruthy();
    expect(container.querySelector('.brand-rail-name').textContent).toBe('FBT Swap');
  });

  it('takes the address from the identity module, not from a literal', () => {
    /* `publicAppUrl()` is the only thing in the app allowed to say who we are;
       it rejects a configured origin that is not the canonical host. */
    expect(brandDomain()).toBe(new URL(publicAppUrl('/')).host.replace(/^www\./i, ''));
    expect(brandDomain()).toBe('fbtswap.ir');
    expect(brandDomain()).not.toContain('lawpoetics');
  });

  it('keeps the address readable in a right-to-left layout', () => {
    const { getByTestId } = mountRail();
    /* The identity line is LTR by content even when the app is RTL: a mirrored
       monospace host is an address nobody can read back to a browser. */
    expect(getByTestId('brand-rail').querySelector('.brand-rail-id').getAttribute('dir')).toBe('ltr');
    const css = read('src/styles/brand-rail.css');
    expect(/\.brand-rail-domain\s*\{[^}]*direction:\s*ltr/.test(css)).toBe(true);
    expect(css).toContain('unicode-bidi: isolate');
  });

  it('opts its own button out of the picture it takes', () => {
    const { getByTestId } = mountRail();
    expect(getByTestId('screenshot-share').getAttribute('data-screenshot-ignore')).toBe('true');
  });

  it('sits at the bottom edge on a route that has no nav', () => {
    const { getByTestId } = render(<MemoryRouter><BrandRail bare /></MemoryRouter>);
    const rail = getByTestId('brand-rail');
    expect(rail.className).toContain('brand-rail--bare');
    expect(rail.getAttribute('data-bare')).toBe('true');
  });

  it('the mark exists as SVG too, for the canvas that brands the picture', () => {
    const svg = brandMarkSvg({ size: 48 });
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('#00e5ff');
    expect(screenshotFilename({ screen: '/market?tab=all' })).toMatch(/^fbtswap-market-tab-all-.*\.png$/);
  });
});

/* ═══════════════════ 2. what the picture contains ═══════════════════════ */

describe('the capture keeps the screen and drops the chrome', () => {
  const mountScreen = () => {
    document.body.innerHTML = `
      <div class="app-shell">
        <header class="top-bar">FBT Swap</header>
        <div class="ptr-content">
          <main class="page"><div class="card" id="kept">content</div></main>
        </div>
        <div class="brand-rail" id="rail">branding</div>
        <nav class="bottom-nav" id="nav">tabs</nav>
        <div class="toast-host" id="toast">a toast</div>
        <div class="ptr-indicator" id="ptr">pull</div>
      </div>`;
    return document.querySelector('.ptr-content');
  };

  it('rasterizes the content node, at a ratio that lands on 1080 wide', async () => {
    const node = mountScreen();
    const calls = [];
    const renderer = async (target, options) => { calls.push({ target, options }); return fakePng(); };

    const shot = await screenShare.captureScreen({ node, renderer });
    expect(shot.ok).toBe(true);
    expect(calls[0].target).toBe(node);
    expect(calls[0].options.pixelRatio).toBeGreaterThan(1);
    expect(calls[0].options.width).toBeGreaterThan(0);
    /* jsdom lays nothing out, so the visible slice is a 1px-tall screen — what
       matters is that it was computed and handed to the compositor. */
    expect(shot.visible).toMatchObject({ top: 0 });
    expect(shot.visible.height).toBeGreaterThan(0);
  });

  it('excludes the fixed chrome, the toasts and its own button', async () => {
    const node = mountScreen();
    let filter = null;
    await screenShare.captureScreen({ node, renderer: async (target, options) => { filter = options.filter; return fakePng(); } });

    expect(typeof filter).toBe('function');
    const byId = (id) => document.getElementById(id);
    expect(filter(byId('nav')), 'the bottom nav is fixed; it would land at the wrong offset').toBe(false);
    expect(filter(byId('rail')), 'the rail is drawn into the picture, not photographed').toBe(false);
    expect(filter(byId('toast')), 'a transient toast is not what the reader chose').toBe(false);
    expect(filter(byId('ptr')), 'a mid-gesture refresh capsule is not the screen').toBe(false);
    expect(filter(byId('kept')), 'the page itself is the picture').toBe(true);
    expect(filter(document.querySelector('.top-bar')), 'the sticky header is part of the screen').toBe(true);
  });

  it('retries without embedding fonts before it gives up', async () => {
    const node = mountScreen();
    const attempts = [];
    const renderer = async (target, options) => {
      attempts.push(options);
      if (attempts.length === 1) throw new Error('font fetch failed');
      return fakePng();
    };
    const shot = await screenShare.captureScreen({ node, renderer });
    expect(shot.ok).toBe(true);
    expect(attempts.length).toBe(2);
    expect(attempts[1].skipFonts).toBe(true);
  });

  it('names the failure when there is nothing to take a picture of', async () => {
    const failing = async () => { throw new Error('nope'); };
    expect((await screenShare.captureScreen({ node: document.body, renderer: failing })).reason).toBe('CAPTURE_FAILED');
    expect((await screenShare.captureScreen({ node: null, renderer: failing })).ok === false).toBe(true);
  });

  it('says so, and does not throw, where a canvas does not exist', async () => {
    /* jsdom has no 2D context. The real answer matters: the caller shares the
       UNBRANDED capture rather than failing, so this returns a reason and not an
       exception. */
    const branded = await screenShare.brandTheShot({
      blob: fakePng(), pixelRatio: 2, visible: { top: 0, height: 400, cssWidth: 390 }
    });
    expect(branded.ok).toBe(false);
    expect(branded.reason).toBe('CANVAS_UNAVAILABLE');
  });
});

/* ═══════════════════ 3. every rung tells the truth ═══════════════════════ */

describe('the picture is handed over by the best rung this device has', () => {
  it('Web Share with a file — and no url beside it, which Safari rejects', async () => {
    const share = vi.fn(async () => undefined);
    navigator.canShare = vi.fn((data) => Array.isArray(data?.files));
    navigator.share = share;

    const out = await screenShare.shareScreenshot({ blob: fakePng(), url: 'https://fbtswap.ir/#/market' });
    expect(out).toMatchObject({ ok: true, via: 'web' });
    expect(share.mock.calls[0][0].files).toHaveLength(1);
    expect(share.mock.calls[0][0].files[0].type).toBe('image/png');
    expect(share.mock.calls[0][0].url).toBeUndefined();
  });

  it('a dismissed sheet is a decision, not a failure', async () => {
    navigator.canShare = vi.fn(() => true);
    navigator.share = vi.fn(async () => { const error = new Error('user closed it'); error.name = 'AbortError'; throw error; });

    const out = await screenShare.shareScreenshot({ blob: fakePng() });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('DISMISSED');
    expect(URL.createObjectURL, 'nothing was saved behind their back').not.toHaveBeenCalled();
  });

  it('saves the picture and copies the link where no sheet can carry a file', async () => {
    navigator.canShare = vi.fn(() => false);
    navigator.share = vi.fn(async () => undefined);
    const clicks = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const element = realCreate(tag);
      if (tag === 'a') element.click = () => clicks.push({ download: element.download, href: element.href });
      return element;
    });
    const out = await screenShare.shareScreenshot({
      blob: fakePng(), filename: 'fbtswap-market.png', url: 'https://fbtswap.ir/#/market'
    });

    expect(out.ok).toBe(true);
    expect(out.via).toBe('download');
    expect(clicks[0].download).toBe('fbtswap-market.png');
    expect(navigator.share, 'a sheet that cannot carry the file is not opened').not.toHaveBeenCalled();
    document.createElement.mockRestore();
  });

  it('the packaged app writes the PNG to its cache and shares the FILE', async () => {
    nativeMode = true;
    const out = await screenShare.shareScreenshot({ blob: fakePng(), filename: 'fbtswap-sol.png', title: 'FBT Swap' });

    expect(out).toMatchObject({ ok: true, via: 'native' });
    expect(capacitorWrite).toHaveBeenCalledOnce();
    expect(capacitorWrite.mock.calls[0][0]).toMatchObject({ path: 'fbtswap-sol.png', directory: 'CACHE' });
    expect(capacitorShare.mock.calls[0][0].files).toEqual(['file:///cache/fbtswap-sol.png']);
  });

  it('a native sheet the user closes is a decision there too', async () => {
    nativeMode = true;
    capacitorShare.mockImplementationOnce(async () => { throw new Error('Share canceled'); });
    const out = await screenShare.shareScreenshot({ blob: fakePng() });
    expect(out).toMatchObject({ ok: false, via: 'native', reason: 'DISMISSED' });
  });

  it('with no picture at all there is nothing to share, and it says so', async () => {
    expect(await screenShare.shareScreenshot({ blob: null })).toMatchObject({ ok: false, via: 'none', reason: 'NO_IMAGE' });
  });
});

/* ═══════════════════ 4. the button, end to end ═══════════════════════ */

describe('the button takes the picture, brands it and shares it', () => {
  it('shares the link when this device cannot take the picture — never nothing', async () => {
    /* No renderer can be injected through the button, and jsdom has no canvas, so
       this exercises the real fallback: the capture fails, `shareLink` opens the
       sheet with the URL of the screen the user is on. */
    const share = vi.fn(async () => undefined);
    navigator.share = share;
    navigator.canShare = vi.fn(() => false);

    const { getByTestId } = mountRail('/market');
    fireEvent.click(getByTestId('screenshot-share'));

    await waitFor(() => expect(share).toHaveBeenCalled());
    const payload = share.mock.calls[0][0];
    expect(payload.url).toContain('fbtswap.ir');
    expect(payload.url).toContain('#/market');
    /* The button is idle again — a stuck spinner on a global rail would outlive
       the screen it was pressed on. */
    await waitFor(() => expect(getByTestId('screenshot-share').disabled).toBe(false));
  });

  it('toasts nothing when the user simply closed the sheet', async () => {
    navigator.share = vi.fn(async () => { const error = new Error('closed'); error.name = 'AbortError'; throw error; });
    navigator.canShare = vi.fn(() => false);

    const { getByTestId } = mountRail('/market');
    fireEvent.click(getByTestId('screenshot-share'));
    await waitFor(() => expect(getByTestId('screenshot-share').disabled).toBe(false));
    expect(useAppStore.getState().notifications.filter((note) => note.kind === 'error')).toHaveLength(0);
  });

  it('names the screen it is sharing in the link and in the filename', async () => {
    const share = vi.fn(async () => undefined);
    navigator.share = share;
    navigator.canShare = vi.fn(() => false);

    const { getByTestId } = mountRail('/loan?tab=solana');
    fireEvent.click(getByTestId('screenshot-share'));
    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(share.mock.calls[0][0].url).toContain('#/loan?tab=solana');
  });
});

/* ═══════════════════ 5. the rail and the nav agree ═══════════════════════ */

describe('the rail is lined up with the bar under it', () => {
  /**
   * The `max-width` a selector is given, per media range.
   *
   * Top-level `@media` blocks are matched brace-by-brace first, and the rules
   * inside each are read from that block alone — counting braces backwards from
   * a match looks like it works until a stylesheet has a comment or a nested
   * block in the way, and index.css is 12 000 lines of both.
   */
  const widths = (rawCss, selector) => {
    /* Comments come out first: they carry commas and braces of their own, and
       either one is enough to make a selector list stop matching itself. */
    const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');
    const blocks = [];
    let cursor = 0;
    let rest = '';
    for (const at of css.matchAll(/@media([^{]*)\{/g)) {
      const open = at.index + at[0].length - 1;
      let depth = 0;
      let endBrace = -1;
      for (let i = open; i < css.length; i += 1) {
        if (css[i] === '{') depth += 1;
        else if (css[i] === '}') { depth -= 1; if (depth === 0) { endBrace = i; break; } }
      }
      if (endBrace < 0) continue;
      rest += css.slice(cursor, at.index);
      blocks.push({ range: `@media${at[1].replace(/\s+/g, ' ').trim()}`, text: css.slice(open + 1, endBrace) });
      cursor = endBrace + 1;
    }
    rest += css.slice(cursor);

    const inText = (text, range) => {
      const found = [];
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rule = new RegExp(`([^{}]*${escaped}[^{}]*)\\{([^}]*)\\}`, 'g');
      for (const match of text.matchAll(rule)) {
        const [, selectors, body] = match;
        if (!selectors.split(',').some((one) => one.trim() === selector)) continue;
        const width = /max-width:\s*(\d+)px/.exec(body);
        if (width) found.push({ px: Number(width[1]), range });
      }
      return found;
    };

    return [...inText(rest, null), ...blocks.flatMap((block) => inText(block.text, block.range))];
  };

  const startsAt = (rule) => Number(/min-width:\s*(\d+)px/.exec(rule.range || '')?.[1] ?? 0);

  it('takes the nav’s widths at every breakpoint', () => {
    const railCss = read('src/styles/brand-rail.css');
    const indexCss = read('src/index.css');
    const rail = widths(railCss, '.brand-rail');
    const nav = widths(indexCss, '.bottom-nav');

    for (const breakpoint of [0, 600, 900, 1400]) {
      const railWidth = rail.filter((row) => startsAt(row) === breakpoint).pop();
      const navWidth = nav.filter((row) => startsAt(row) === breakpoint).pop();
      expect(railWidth, `a rail width from ${breakpoint}px`).toBeTruthy();
      expect(navWidth, `index.css still has a nav width from ${breakpoint}px`).toBeTruthy();
      expect(railWidth.px, `the rail matches the nav from ${breakpoint}px`).toBe(navWidth.px);
    }
  });

  it('reserves its own height at the bottom of the shell', () => {
    const railCss = read('src/styles/brand-rail.css');
    /* The nav's space is `--nav-h`; the rail lives in the gap, so the shell's
       reservation has to grow — otherwise the last card of every page hides
       behind the branding. */
    expect(railCss).toContain('--brand-rail-h');
    const padding = /\.app-shell:not\(\.app-shell--headerless\)\s*\{[^}]*padding-bottom:[^}]*\}/.exec(railCss)?.[0] ?? '';
    expect(padding).toContain('--nav-h');
    expect(padding).toContain('--brand-rail-h');
    expect(padding, 'the headerless shell keeps owning its own bottom padding').toContain('--headerless');
  });

  it('widens with the derivatives hall, which widens the column', () => {
    const hallCss = read('src/styles/derivatives-glass.css');
    const rail = widths(hallCss, 'body.hall-wide .brand-rail');
    const shell = widths(hallCss, 'body.hall-wide .app-shell').filter((row) => row.range);
    expect(rail.length).toBe(3);
    for (const rule of shell.slice(1)) {
      const partner = rail.find((row) => row.range === rule.range);
      expect(partner?.px, `the rail matches the shell at ${rule.range}`).toBe(rule.px);
    }
  });

  it('is mounted by the chrome, on every route that has a nav', () => {
    const app = read('src/App.jsx');
    expect(app).toContain('<BrandRail');
    /* `/intent` ships its own bottom tab bar; stacking a rail under it is the
       same mistake AppChrome already refuses for the app's nav. */
    expect(app).toMatch(/pathname !== '\/intent' && <BrandRail bare=\{headerless\} \/>/);
  });
});

/* ═══════════════════ 6. every language can say it ═══════════════════════ */

describe('every language can say it', () => {
  const KEYS = [
    ['share', 'screen'], ['share', 'screenBusy'], ['share', 'screenAria'], ['share', 'screenText'],
    ['toast', 'screenSavedAndCopied'], ['toast', 'screenSaved'], ['toast', 'screenLinkCopied'],
    ['toast', 'screenLinkShared'], ['toast', 'screenFailed']
  ];

  it('in all 12 locales', () => {
    for (const locale of ['ar', 'en', 'es', 'fa', 'fr', 'hi', 'id', 'pt', 'ru', 'tr', 'ur', 'zh']) {
      const messages = JSON.parse(read(`src/i18n/locales/${locale}.json`));
      for (const [namespace, key] of KEYS) {
        const sentence = messages?.[namespace]?.[key];
        expect(typeof sentence === 'string' && sentence.trim().length > 0, `${locale}: ${namespace}.${key}`).toBe(true);
      }
    }
  });
});
