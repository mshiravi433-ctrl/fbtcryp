/**
 * STALE-CHUNK RELOAD LOOP — the incident, reproduced as a sequence of documents.
 * ─────────────────────────────────────────────────────────────────────────────
 * Reported: «صفحه کیف پول قاطی زده و وقتی روش میزنی میزنه نسخه جدید منتشر شد،
 * دوباره رفرش میشه، دوباره همین پیام — همش پشت سرهم»
 *
 * The wallet page fails to load, the app says a new version shipped, reloads,
 * and then does it again. Forever. The message that promised the fix WAS the
 * loop: on the next document load the boundary's componentDidMount cleared its
 * own one-shot guard while the chunk was still in flight, so every failure
 * looked like a first failure.
 *
 * ─── WHY THE EXISTING BOUNDARY TEST DID NOT CATCH IT ────────────────────────
 * test/coindetail-probe.jsx mounts a child that throws SYNCHRONOUSLY. A child
 * that throws during the boundary's first render means the boundary never
 * commits, so `componentDidMount` never runs, so the guard is never touched,
 * and "a second failure does not reload again" passes.
 *
 * A LAZY route is a different commit sequence: the import is PENDING, so the
 * boundary commits with the Suspense fallback, componentDidMount fires, the
 * guard is cleared — and only THEN does the rejected import throw.
 *
 * ─── WHAT THIS PROBE DOES ───────────────────────────────────────────────────
 * Builds the route exactly the way App.jsx does — `lazy(retryImport(...))`, so
 * both layers (the cache-busted retry and the boundary reload) are exercised —
 * and simulates whole DOCUMENT loads against one shared sessionStorage, which
 * is the only way to see a reload loop at all: a loop is not a second render,
 * it is a second page load.
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { readFileSync } from 'node:fs';
import RouteBoundary, { noteRoutePainted } from '../src/components/RouteBoundary.jsx';
import { retryImport } from '../src/lib/lazyRetry.js';

const CHUNK_MESSAGE =
  'Failed to fetch dynamically imported module: https://fbt.app/assets/Wallet-3f9a1c.js';

/* The module map is poisoned after a failure, so every attempt must fail the
   same way — exactly what a stale shell naming a deleted chunk produces. */
const alwaysFails = async () => {
  const error = new Error(CHUNK_MESSAGE);
  error.name = 'ChunkLoadError';
  throw error;
};

/** A route that can be made to load or not, per simulated document. */
function makeRoute({ shouldFail }) {
  return lazy(
    retryImport(
      async () => {
        if (shouldFail()) {
          const error = new Error(CHUNK_MESSAGE);
          error.name = 'ChunkLoadError';
          throw error;
        }
        return { default: () => <div>wallet content painted</div> };
      },
      /* The retry goes through the same fake loader: no network in a probe. */
      { load: alwaysFails, delay: 0 }
    )
  );
}

/**
 * The App.jsx `RoutePaintProbe`, mirrored here: an effect that cannot run until
 * the suspended subtree resolves. The real component is not imported because
 * it is deliberately private to App.jsx — and because the contract under test
 * is `noteRoutePainted`, not App's copy of four lines. Its PLACEMENT is a
 * separate structural assertion below, which is where the regression hides.
 */
function PaintProbe({ route, children }) {
  useEffect(() => {
    noteRoutePainted(route);
  }, [route]);
  return children;
}

/**
 * One simulated document load. Returns what the user ended up reading and how
 * many reloads this page load asked for.
 */
async function loadDocument(container, { route, reloads, failRoute }) {
  const previousHash = window.location.hash;
  const Page = makeRoute({ shouldFail: () => failRoute() });
  const root = createRoot(container);
  try {
    /* A HashRouter reload lands back on the same route: the hash must persist
       across simulated documents for that to be the scenario under test. */
    window.location.hash = `#${route}`;
    await act(async () => {
      root.render(
        <RouteBoundary t={(k) => k} reload={() => reloads.push(route)} route={route}>
          <Suspense fallback={<div>spinner</div>}>
            <PaintProbe route={route}>
              <Page />
            </PaintProbe>
          </Suspense>
        </RouteBoundary>
      );
    });
    /* Let the (immediately rejected) import surface through the boundary. */
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    /* The reload is deferred ~120ms on purpose; wait past it or the probe
       measures the delay instead of the behaviour. */
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });
    /* Read it BEFORE unmounting — the container is empty afterwards, and an
       empty container passes every "does not show X" assertion by accident. */
    const text = container.textContent;
    await act(async () => root.unmount());
    return { text };
  } finally {
    window.location.hash = previousHash;
  }
}

const readState = () => {
  try {
    return window.sessionStorage?.getItem('fbt:chunk-reload') ?? null;
  } catch {
    return 'unavailable';
  }
};

export async function run(container) {
  const out = [];
  const t = (name, ok) => out.push([name, Boolean(ok)]);
  const realError = console.error;
  console.error = () => {};

  /* ───────────────────────── 1. the reported loop ───────────────────────── */
  {
    window.location.hash = '#/wallet';
    window.sessionStorage?.removeItem('fbt:chunk-reload');
    window.sessionStorage?.removeItem('fbt:hard-reload');

    const reloads = [];
    let lastText = '';
    for (let i = 0; i < 4; i += 1) {
      const doc = await loadDocument(container, {
        route: '/wallet',
        reloads,
        failRoute: () => true
      });
      lastText = doc.text;
    }

    t('a stale chunk reloads at most ONCE per route', reloads.length <= 1);
    t('...and not once per attempted page load', !(reloads.length >= 2));
    t('...so four failing loads cannot mean four refreshes', reloads.length === 1);
    t('the user ends up on a screen they can act on', lastText.includes('crash.stillBrokenTitle'));
    t('...which offers a way out to a working screen', lastText.includes('crash.goHome'));
  }

  /* ─────────────────── 2. the honest message after refusal ───────────────── */
  /*
   * «نسخه جدید منتشر شد» is a promise: a refresh is coming and it will fix
   * this. Repeating it on the load where the refresh has ALREADY run is what
   * made this read as «همش پشت سرهم همین پیام».
   */
  {
    window.sessionStorage?.removeItem('fbt:chunk-reload');
    const reloads = [];
    const first = await loadDocument(container, { route: '/wallet', reloads, failRoute: () => true });
    t('the automatic refresh shows no alarming text at all', !first.text.includes('crash.'));
    t('...and it does reload once', reloads.length === 1);
    const second = await loadDocument(container, { route: '/wallet', reloads, failRoute: () => true });
    t('the second failure does not show a promise it is not keeping',
      !second.text.includes('crash.update'));
    t('...and names what actually happened', /crash\.stillBrokenTitle/.test(second.text));
    t('...with an action that is not a lie', /crash\.stillBrokenBody/.test(second.text));
  }

  /* ───────────────────── 3. recovery still works (no regression) ─────────── */
  /*
   * The guard must not become a ban. The whole reason to reload is that the
   * next document gets a fresh module map and the current chunk names; once a
   * route paints, the incident is over and a LATER incident must be allowed its
   * one reload again.
   */
  {
    window.sessionStorage?.removeItem('fbt:chunk-reload');
    const reloads = [];
    await loadDocument(container, { route: '/wallet', reloads, failRoute: () => true });
    t('one reload is still issued when the chunk is stale', reloads.length === 1);

    const ok = await loadDocument(container, { route: '/wallet', reloads, failRoute: () => false });
    t('a route that paints after the reload is the recovery', ok.text.includes('wallet content painted'));
    t('...and paints with no further reload', reloads.length === 1);

    const stateAfterSuccess = readState();
    const empty =
      stateAfterSuccess === null || stateAfterSuccess === 'unavailable' || stateAfterSuccess === '{}';
    t('a successful paint clears the incident record', empty);

    await loadDocument(container, { route: '/wallet', reloads, failRoute: () => true });
    t('a LATER incident on the same route gets its reload again', reloads.length === 2);
  }

  /* ──────────────── 4. one route's failure must not mute another ─────────── */
  {
    window.sessionStorage?.removeItem('fbt:chunk-reload');
    const reloads = [];
    await loadDocument(container, { route: '/wallet', reloads, failRoute: () => true });
    await loadDocument(container, { route: '/swap', reloads, failRoute: () => true });
    t('a second route still gets its own one reload', reloads.filter((r) => r === '/swap').length === 1);
    await loadDocument(container, { route: '/swap', reloads, failRoute: () => true });
    t('...and then stops for that route too', reloads.filter((r) => r === '/swap').length === 1);
    t('...while the broken route is still recorded', reloads.filter((r) => r === '/wallet').length === 1);
  }

  /* ─────────────────────── 5. a real bug never reloads ──────────────────── */
  {
    window.sessionStorage?.removeItem('fbt:chunk-reload');
    const reloads = [];
    const Boom = () => {
      throw new TypeError("Cannot read properties of undefined (reading 'balance')");
    };
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <RouteBoundary t={(k) => k} reload={() => reloads.push('boom')} route="/wallet">
          <Boom />
        </RouteBoundary>
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    t('a genuine crash never triggers a reload', reloads.length === 0);
    t('...and shows the error text so it can be reported', container.textContent.includes('balance'));
    t('...and is NOT the refresh screen', !container.textContent.includes('crash.stillBrokenTitle'));
    await act(async () => root.unmount());
  }

  /* ─────────── 5a. a decision belongs to the error, not to the moment ─────── */
  /*
   * The record EXPIRES on purpose (a later incident must be allowed its
   * reload). That is only safe if the screen does not re-derive it on every
   * render: a user sitting on «بعد از یک بار تازه‌سازی هم بالا نیامد» for two
   * minutes, then toggling the theme, would otherwise flip to a quiet spinner
   * waiting for a reload nobody scheduled — strictly worse than the message,
   * because now there is nothing to read and no button to press.
   */
  {
    let bump = null;
    window.sessionStorage?.setItem(
      'fbt:chunk-reload',
      JSON.stringify({ '/wallet': Date.now() })
    );
    const reloads = [];
    /* ONE error object for every render: a re-render of the same failure, not
       a new failure. That is the case the memo exists for. */
    const STUCK = new Error(CHUNK_MESSAGE);
    STUCK.name = 'ChunkLoadError';
    const Failing = () => {
      throw STUCK;
    };
    const root = createRoot(container);
    const Tickered = () => {
      const [, setN] = useState(0);
      bump = () => setN((n) => n + 1);
      return (
        <RouteBoundary t={(k) => k} reload={() => reloads.push('/wallet')} route="/wallet">
          <Failing />
        </RouteBoundary>
      );
    };
    await act(async () => {
      /* The budget is already spent above: this document must NOT reload. */
      root.render(<Tickered />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    const whileFresh = container.textContent;
    /* Now let the record expire, exactly as two idle minutes would. */
    window.sessionStorage?.setItem(
      'fbt:chunk-reload',
      JSON.stringify({ '/wallet': Date.now() - 600_000 })
    );
    await act(async () => {
      bump();
      await new Promise((r) => setTimeout(r, 30));
    });
    const afterExpiry = container.textContent;
    t('the stale-chunk screen is showing while the budget is spent', whileFresh.includes('crash.stillBrokenTitle'));
    t('...and an unrelated re-render cannot turn it into a bare spinner',
      afterExpiry.includes('crash.stillBrokenTitle'));
    t('...so the buttons are still there to press', afterExpiry.includes('crash.goHome'));
    t('...and nothing reloaded behind the scenes', reloads.length === 0);
    await act(async () => root.unmount());
  }

  /* ─────────── 5b. a stale stylesheet is the same incident, one file over ─── */
  /*
   * Vite gives a lazy route its CSS as a separate chunk, so the deploy that
   * renames `Wallet-<hash>.js` renames `Wallet-<hash>.css` in the same breath.
   * A 404 on that link rejects the import with "Unable to preload CSS for …",
   * which is a LOAD failure and gets the same one reload — and must NOT be
   * handed to retryImport, whose only handle is the URL in the message, and
   * importing a .css as a module can never work at all.
   */
  {
    window.sessionStorage?.removeItem('fbt:chunk-reload');
    const reloads = [];
    const CssBoom = () => {
      const e = new Error('Unable to preload CSS for https://fbt.app/assets/Wallet-BmDVSeqw.css');
      e.name = 'ChunkLoadError';
      throw e;
    };
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <RouteBoundary t={(k) => k} reload={() => reloads.push('/wallet')} route="/wallet">
          <CssBoom />
        </RouteBoundary>
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    t('a missing route stylesheet reloads once, like a missing route chunk', reloads.length === 1);
    t('...without showing the crash screen first', !container.textContent.includes('crash.'));
    await act(async () => root.unmount());

    const root2 = createRoot(container);
    await act(async () => {
      root2.render(
        <RouteBoundary t={(k) => k} reload={() => reloads.push('/wallet')} route="/wallet">
          <CssBoom />
        </RouteBoundary>
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    t('...and a CSS failure is caught by the same one-shot guard', reloads.length === 1);
    await act(async () => root2.unmount());

    const lazyRetrySrc = readFileSync('src/lib/lazyRetry.js', 'utf8');
    t('the in-document retry does not try to import() a .css URL',
      !/Unable to preload CSS/.test(lazyRetrySrc));
  }

  /* ───────────── 6. the record: what survives, and what it must not ──────── */
  {
    window.sessionStorage?.removeItem('fbt:chunk-reload');
    const reloads = [];
    await loadDocument(container, { route: '/wallet', reloads, failRoute: () => true });
    const raw = readState();
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    t('the incident record is JSON keyed by route', Boolean(parsed) && typeof parsed === 'object');
    t('...and records the route that asked for the reload', '/wallet' in record);
    t('...with a timestamp, so the budget comes back on its own', Number.isFinite(record['/wallet']));
    t('...and nothing else: no balances, no mnemonics', Object.keys(record).length <= 2);
    t('the record never touches localStorage (the vault lives there)', (() => {
      try {
        return window.localStorage.getItem('fbt:chunk-reload') === null;
      } catch {
        return true;
      }
    })());
    t('and never the wallet storage keys', (() => {
      try {
        return !Object.keys(window.localStorage || {}).some((k) => k.startsWith('fbt:vault'));
      } catch {
        return true;
      }
    })());
  }

  /*
   * ─── 7. the mechanism is WIRED, not just present ─────────────────────────
   * The bug was never RouteBoundary's reload — it was WHERE the success signal
   * came from. `noteRoutePainted` only means anything if the component calling
   * it sits INSIDE the Suspense boundary, because that is the only reason it
   * cannot mount early. Move it outside and every assertion above still passes
   * while the product regresses to a refresh loop: the guard would again be
   * disarmed by a mount instead of by a paint. So the placement is asserted as
   * text, in the one file where moving it is possible.
   */
  {
    const app = readFileSync('src/App.jsx', 'utf8');
    const open = app.indexOf('<Suspense fallback={<Loader />}>');
    const probe = app.indexOf('<RoutePaintProbe route={location.pathname}>');
    const close = app.indexOf('</Suspense>');
    t('App renders a paint probe', probe !== -1);
    t('...inside the Suspense boundary, after it opens', open !== -1 && probe > open);
    t('...and before it closes', close !== -1 && probe < close);
    t('the probe reports the painted route', /noteRoutePainted\(route\)/.test(app));
    t('the boundary is told which route it guards', /<RouteBoundary[^>]*route=\{location\.pathname\}/.test(app));
    /*
     * The copy is part of the fix. «نسخه جدید منتشر شد — یک‌بار تازه‌سازی نسخه
     * جدید را می‌آورد» is true exactly once per route, and the screen that says
     * it while refusing to refresh is what made this read as a broken record.
     * Deleting the two keys is what keeps them from being re-adopted by the
     * next "helpful" message.
     */
    const faCrash = JSON.parse(readFileSync('src/i18n/locales/fa.json', 'utf8')).crash ?? {};
    const enCrash = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8')).crash ?? {};
    t('the "one refresh fixes it" promise is gone from both locales',
      !('updateTitle' in faCrash) && !('updateTitle' in enCrash) && !('updateBody' in faCrash));
    t('...and the honest copy exists in both',
      'stillBrokenTitle' in faCrash && 'stillBrokenTitle' in enCrash
        && 'stillBrokenBody' in faCrash && 'stillBrokenBody' in enCrash);
    t('...in Persian, not only English', /تازه‌سازی/.test(faCrash.stillBrokenTitle ?? ''));

    t(
      'the boundary no longer clears its own guard on mount',
      !/componentDidMount\(\)\s*\{[^}]*setFlag/.test(readFileSync('src/components/RouteBoundary.jsx', 'utf8'))
    );
  }

  window.sessionStorage?.removeItem('fbt:chunk-reload');
  console.error = realError;
  return out;
}
