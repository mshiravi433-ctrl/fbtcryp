// @vitest-environment jsdom
/**
 * THE SCREENSHOT PROMPT AND THE PICTURE IT SHARES.
 *
 * History: 2026-09-23 added an always-on brand rail (logo + address + share
 * button) above the nav. 2026-09-24 the owner asked for the opposite shape:
 * «باکس بالای فوتر که دکمه اشتراک و آدرس سایت هست را پاک کن. وقتی کسی اسکرین
 * گرفت یک بند برای ۳۰ ثانیه بیاد که بگه شما اسکرین گرفتید، می‌خواهید اشتراک
 * بگذارید اسکرین‌شات را با واترمارک آدرس سایت — نه اینکه همیشه باشه.»
 *
 * What is pinned here:
 *
 *   1. NOTHING IS ON SCREEN UNTIL A SCREENSHOT. No permanent bar, no reserved
 *      bottom padding; the prompt renders null until `fbt:screenshot` (native
 *      shell) or a screenshot key arrives, then leaves after 30 seconds.
 *   2. THE ADDRESS IS DERIVED, NOT TYPED (`publicAppUrl()` → `brandDomain()`).
 *   3. THE PICTURE EXCLUDES THE CHROME — nav, toasts, the prompt itself.
 *   4. EVERY SHARE RUNG TELLS THE TRUTH, and a DISMISSED sheet is never an error.
 *   5. THE ANDROID SHELL REALLY EMITS THE SIGNAL (source-level check).
 *   6. EVERY LANGUAGE CAN SAY IT.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
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
const promptModule = await import('../src/components/ScreenshotSharePrompt.jsx');
const ScreenshotSharePrompt = promptModule.default;
const { SCREENSHOT_PROMPT_MS } = promptModule;
const detect = await import('../src/lib/screenshotDetect.js');

/** A Blob that behaves like a picture without being one. */
const fakePng = (bytes = 2048) => new Blob([new Uint8Array(bytes)], { type: 'image/png' });

const mountPrompt = (route = '/market', props = {}) => render(
  <MemoryRouter initialEntries={[route]}><ScreenshotSharePrompt {...props} /></MemoryRouter>
);

/** What the Android shell does after a capture. */
const takeScreenshot = () => act(() => { window.dispatchEvent(new Event(detect.SCREENSHOT_EVENT)); });

/** Mount, screenshot, and hand back the queries. */
const mountAfterScreenshot = (route = '/market', props = {}) => {
  const view = mountPrompt(route, props);
  takeScreenshot();
  return view;
};

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

/* ═══════════════════ 1. only after a screenshot, only for 30 s ═══════════ */

describe('the prompt appears only after a screenshot, and only for 30 seconds', () => {
  it('renders nothing at all until a screenshot happens', () => {
    const { queryByTestId } = mountPrompt();
    expect(queryByTestId('screenshot-prompt'), 'no permanent bar').toBeNull();
    expect(queryByTestId('screenshot-share')).toBeNull();
  });

  it('appears on the native shell\'s signal and names the site address', () => {
    const { getByTestId } = mountAfterScreenshot();
    const prompt = getByTestId('screenshot-prompt');
    expect(prompt.textContent).toContain('You took a screenshot');
    expect(prompt.textContent).toContain(brandDomain());
    expect(prompt.querySelector('svg'), 'the brand coin is drawn').toBeTruthy();
    expect(getByTestId('screenshot-share')).toBeTruthy();
  });

  it('closes itself after 30 seconds, and a new screenshot restarts the clock', () => {
    vi.useFakeTimers();
    try {
      const { queryByTestId } = mountAfterScreenshot();
      expect(SCREENSHOT_PROMPT_MS).toBe(30_000);
      act(() => { vi.advanceTimersByTime(20_000); });
      expect(queryByTestId('screenshot-prompt')).not.toBeNull();
      /* past the debounce, a second capture: 30 s from HERE */
      takeScreenshot();
      act(() => { vi.advanceTimersByTime(20_000); });
      expect(queryByTestId('screenshot-prompt'), 'restarted, so still up at 40 s').not.toBeNull();
      act(() => { vi.advanceTimersByTime(10_500); });
      expect(queryByTestId('screenshot-prompt')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('the close button dismisses it', () => {
    const { getByTestId, queryByTestId } = mountAfterScreenshot();
    fireEvent.click(getByTestId('screenshot-prompt-close'));
    expect(queryByTestId('screenshot-prompt')).toBeNull();
  });

  it('keeps itself out of the picture it offers to share', () => {
    const { getByTestId } = mountAfterScreenshot();
    expect(getByTestId('screenshot-prompt').getAttribute('data-screenshot-ignore')).toBe('true');
  });

  it('takes the address from the identity module, not from a literal', () => {
    expect(brandDomain()).toBe(new URL(publicAppUrl('/')).host.replace(/^www\./i, ''));
    expect(brandDomain()).toBe('fbtswap.ir');
    expect(brandDomain()).not.toContain('lawpoetics');
  });

  it('keeps the address readable in a right-to-left layout', () => {
    const { container } = mountAfterScreenshot();
    expect(container.querySelector('.screenshot-prompt-domain').getAttribute('dir')).toBe('ltr');
    expect(read('src/styles/screenshot-prompt.css')).toContain('unicode-bidi: isolate');
  });

  it('places itself by route: above the nav, at the edge on /pay, from the top on /intent', () => {
    const { getByTestId } = mountAfterScreenshot('/pay/abc', { placement: 'bare' });
    expect(getByTestId('screenshot-prompt').className).toContain('screenshot-prompt--bare');
    const app = read('src/App.jsx');
    expect(app).toContain("<ScreenshotSharePrompt placement={pathname === '/intent' ? 'top' : headerless ? 'bare' : 'nav'} />");
  });

  it('the mark exists as SVG too, for the canvas that brands the picture', () => {
    const svg = brandMarkSvg({ size: 48 });
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('#00e5ff');
    expect(screenshotFilename({ screen: '/market?tab=all' })).toMatch(/^fbtswap-market-tab-all-.*\.png$/);
  });
});

/* ═══════════════════ 1b. what counts as a screenshot ═══════════════════ */

describe('screenshot detection', () => {
  it('knows the desktop shortcuts and nothing else', () => {
    expect(detect.isScreenshotKey({ key: 'PrintScreen' })).toBe(true);
    expect(detect.isScreenshotKey({ code: 'PrintScreen' })).toBe(true);
    expect(detect.isScreenshotKey({ key: '3', metaKey: true, shiftKey: true })).toBe(true);
    expect(detect.isScreenshotKey({ key: '4', code: 'Digit4', metaKey: true, shiftKey: true })).toBe(true);
    expect(detect.isScreenshotKey({ key: 's', metaKey: true, shiftKey: true })).toBe(true);
    expect(detect.isScreenshotKey({ key: '3', shiftKey: true }), 'Shift+3 is typing a #').toBe(false);
    expect(detect.isScreenshotKey({ key: 's', metaKey: true }), 'Cmd+S is save').toBe(false);
    expect(detect.isScreenshotKey({ key: 'a' })).toBe(false);
    expect(detect.isScreenshotKey(null)).toBe(false);
  });

  it('folds one capture\'s several signals into one', () => {
    let clock = 1000;
    const shots = [];
    const off = detect.subscribeScreenshots((info) => shots.push(info), { now: () => clock });
    detect.announceScreenshot();
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'PrintScreen' }));
    expect(shots).toHaveLength(1);
    expect(shots[0].source).toBe('system');
    clock += detect.SCREENSHOT_DEBOUNCE_MS + 1;
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'PrintScreen' }));
    expect(shots).toHaveLength(2);
    expect(shots[1].source).toBe('keyboard');
    off();
    clock += 10_000;
    detect.announceScreenshot();
    expect(shots, 'unsubscribed').toHaveLength(2);
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
        <div class="screenshot-prompt" id="rail">prompt</div>
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
    expect(filter(byId('rail')), 'the prompt is not part of the screen it offers to share').toBe(false);
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

describe('the prompt\'s button takes the picture, brands it and shares it', () => {
  it('shares the link when this device cannot take the picture — never nothing', async () => {
    /* No renderer can be injected through the button, and jsdom has no canvas, so
       this exercises the real fallback: the capture fails, `shareLink` opens the
       sheet with the URL of the screen the user is on. */
    const share = vi.fn(async () => undefined);
    navigator.share = share;
    navigator.canShare = vi.fn(() => false);

    const { getByTestId, queryByTestId } = mountAfterScreenshot('/market');
    fireEvent.click(getByTestId('screenshot-share'));

    await waitFor(() => expect(share).toHaveBeenCalled());
    const payload = share.mock.calls[0][0];
    expect(payload.url).toContain('fbtswap.ir');
    expect(payload.url).toContain('#/market');
    /* Done is done: the offer closes once the share has run. */
    await waitFor(() => expect(queryByTestId('screenshot-prompt')).toBeNull());
  });

  it('toasts nothing when the user simply closed the sheet', async () => {
    navigator.share = vi.fn(async () => { const error = new Error('closed'); error.name = 'AbortError'; throw error; });
    navigator.canShare = vi.fn(() => false);

    const { getByTestId, queryByTestId } = mountAfterScreenshot('/market');
    fireEvent.click(getByTestId('screenshot-share'));
    await waitFor(() => expect(queryByTestId('screenshot-prompt')).toBeNull());
    expect(useAppStore.getState().notifications.filter((note) => note.kind === 'error')).toHaveLength(0);
  });

  it('names the screen it is sharing in the link and in the filename', async () => {
    const share = vi.fn(async () => undefined);
    navigator.share = share;
    navigator.canShare = vi.fn(() => false);

    const { getByTestId } = mountAfterScreenshot('/loan?tab=solana');
    fireEvent.click(getByTestId('screenshot-share'));
    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(share.mock.calls[0][0].url).toContain('#/loan?tab=solana');
  });
});

/* ═══════════════════ 5. the permanent rail is gone; the shell emits ══════ */

describe('the always-on rail is gone, and the Android shell reports captures', () => {
  it('no permanent bar is mounted and no bottom space is reserved for one', () => {
    const app = read('src/App.jsx');
    expect(app).not.toContain('<BrandRail');
    expect(app).not.toContain('brand-rail');
    const css = [read('src/index.css'), read('src/styles/derivatives-glass.css'), read('src/styles/screenshot-prompt.css')].join('\n');
    expect(css).not.toContain('.brand-rail');
    expect(css).not.toContain('--brand-rail-h');
  });

  it('MainActivity dispatches fbt:screenshot from both Android hooks', () => {
    const java = read('android/app/src/main/java/ir/fbtswap/app/MainActivity.java');
    expect(java).toContain("window.dispatchEvent(new Event('fbt:screenshot'))");
    expect(java).toContain('registerScreenCaptureCallback');
    expect(java).toContain('unregisterScreenCaptureCallback');
    expect(java).toContain('MediaStore.Images.Media.EXTERNAL_CONTENT_URI');
    expect(java, 'lifecycle overrides must stay public (BridgeActivity declares them public)').toMatch(/public void onStart\(\)/);
    expect(java).toMatch(/public void onStop\(\)/);
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    expect(manifest).toMatch(/uses-permission[^>]*DETECT_SCREEN_CAPTURE/);
    expect(manifest, 'no storage permission for this').not.toMatch(/uses-permission[^>]*(READ_MEDIA_IMAGES|READ_EXTERNAL_STORAGE)/);
  });

  it('the event name the shell dispatches is the one the page listens for', () => {
    expect(detect.SCREENSHOT_EVENT).toBe('fbt:screenshot');
  });
});

/* ═══════════════════ 6. every language can say it ═══════════════════════ */

describe('every language can say it', () => {
  const KEYS = [
    ['share', 'screen'], ['share', 'screenBusy'], ['share', 'screenAria'], ['share', 'screenText'],
    ['toast', 'screenSavedAndCopied'], ['toast', 'screenSaved'], ['toast', 'screenLinkCopied'],
    ['toast', 'screenLinkShared'], ['toast', 'screenFailed'],
    ['share', 'shotTitle'], ['share', 'shotBody'], ['share', 'shotShare'], ['share', 'shotClose']
  ];

  it('in all 12 locales', () => {
    for (const locale of ['ar', 'en', 'es', 'fa', 'fr', 'hi', 'id', 'pt', 'ru', 'tr', 'ur', 'zh']) {
      const messages = JSON.parse(read(`src/i18n/locales/${locale}.json`));
      for (const [namespace, key] of KEYS) {
        const sentence = messages?.[namespace]?.[key];
        expect(typeof sentence === 'string' && sentence.trim().length > 0, `${locale}: ${namespace}.${key}`).toBe(true);
        if (key === 'shotBody') expect(sentence, `${locale}: the address is interpolated, not typed`).toContain('{{domain}}');
      }
    }
  });
});
