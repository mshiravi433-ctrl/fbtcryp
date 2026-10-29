// @vitest-environment jsdom
/**
 * THE APP COMES UP — the one assertion that would have caught the outage
 * ---------------------------------------------------------------------------
 * ─── WHAT HAPPENED ──────────────────────────────────────────────────────────
 *   «برنامه کلا نمیاد بالا … برای همه سایت و صفحات … خطای غیر منتظره»
 *
 * The notification-design merge mounted `<NotificationBar />` next to
 * `<Toasts>`, i.e. OUTSIDE `<HashRouter>`. The bar deep-links with
 * `useNavigate()`, and react-router throws when that hook has no Router above
 * it:
 *
 *     useNavigate() may be used only in the context of a <Router> component.
 *
 * `<RouteBoundary>` is mounted INSIDE a route, so it never saw the throw; it
 * travelled to `BootBoundary` in main.jsx, which replaces the whole app with
 * «خطای غیرمنتظره». Every route, on every device, the moment the bar's chunk
 * landed — the site was down, and the build was green.
 *
 * ─── WHY NOTHING CAUGHT IT ──────────────────────────────────────────────────
 * test/notification-bar.test.jsx MOCKS `react-router-dom` (`useNavigate`,
 * `useInRouterContext`), so it can never observe a missing Router. A render
 * test of a component cannot prove the component is wired correctly — only the
 * real tree can. So this file mounts the REAL App, in jsdom, and asserts the
 * frame that must survive: no boot error, and the app shell actually painted.
 *
 * Two stubs, both of them environment, not behaviour:
 *   · `seoEntryHandoff` — main's redirect hook: in jsdom the entry rule decides
 *     to bounce to a landing page, and App correctly renders `null`. Pinned to
 *     false so the test sees the SPA.
 *   · the WalletConnect verify enclave — network warm-up, irrelevant here.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import React from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../src/lib/webEntry.js', async (importOriginal) => {
  const mod = await importOriginal();
  return { ...mod, seoEntryHandoff: false };
});
vi.mock('../src/lib/wc/verify.js', () => ({
  measureVerifyEnclave: () => {},
  warmVerifyEnclave: () => {}
}));

describe('app boot', () => {
  beforeAll(() => {
    /* A returning user: no splash, no welcome, no guide. The most common path,
       and the one every reported outage was seen on. */
    return import('../src/store/useSettingsStore.js').then(({ useSettingsStore }) => {
      useSettingsStore.setState({
        onboarded: true,
        guideReadAt: Date.now(),
        biometricEnabled: false,
        twoFactorEnabled: false
      });
    });
  });

  it('mounts the shell with no «خطای غیرمنتظره» screen', async () => {
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const App = (await import('../src/App.jsx')).default;

    const errors = [];
    const realError = console.error;
    console.error = (...args) => {
      errors.push(args.map(String).join(' '));
      realError(...args);
    };

    const el = document.createElement('div');
    el.id = 'root';
    document.body.appendChild(el);
    const root = createRoot(el);

    try {
      await act(async () => {
        root.render(React.createElement(App));
      });
      /* The lazy overlays (notification bar, install prompt, radio pill) load
         one chunk later — and the bar's chunk is exactly what used to throw
         AFTER the first successful paint. Give them their turn. */
      for (let i = 0; i < 6; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 400));
        });
      }

      /* 1. Nothing reached the boot boundary. main.jsx records the message
            there before drawing the error screen. */
      expect(window.__FBT_BOOT_ERR__).toBeUndefined();

      /* 2. The app really painted, rather than silently rendering null. */
      expect(el.innerHTML.length).toBeGreaterThan(5000);

      /* 3. And the specific screen is not the error one. */
      expect(el.innerHTML.includes('خطای غیرمنتظره')).toBe(false);

      /* 4. No render-time exception was logged along the way. React swallows
            caught errors into the boundary, so the console is the record. */
      const fatal = errors.filter(
        (line) => line.includes('may be used only in the context of a <Router>')
          || line.includes('The above error occurred in')
      );
      expect(fatal).toEqual([]);
    } finally {
      console.error = realError;
      await act(async () => {
        root.unmount();
      });
      el.remove();
    }
  }, 120000);
});
