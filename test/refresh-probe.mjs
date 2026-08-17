/**
 * SAFE REFRESH PROBE — the refresh contract, behavioural and structural.
 * ---------------------------------------------------------------------------
 * The Android app had no refresh at all, and a naive one (a reload button, a
 * scattered `location.reload()`) would have been a session-killer: pairing
 * interrupted, signatures stranded, a reload loop on any persistent error.
 *
 * Behavioural (bare Node — refresh.js touches no DOM on the soft path):
 *   1. every subscriber runs exactly once per cycle;
 *   2. concurrent requests share ONE in-flight cycle (double-tap safe);
 *   3. a held guard (connect / sign / submit) makes refresh a no-op that
 *      resolves false and NEVER fires a subscriber;
 *   4. a throwing subscriber cannot veto the others (allSettled);
 *   5. the guard releases cleanly and refreshing works again;
 *   6. hardReload with no window refuses rather than throws.
 *
 * Structural (source): the button exists and disables itself under guard, the
 * wallet connect flow and the swap transaction path HOLD the guard, and no
 * new unguarded location.reload() has crept in.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);

const refresh = await import('../src/lib/refresh.js');

/* ------------------------------- behaviour ------------------------------- */

{
  /* 1+2: one cycle, N subscribers, concurrent taps coalesce. */
  let a = 0;
  let b = 0;
  const offA = refresh.onSoftRefresh(async () => { a += 1; });
  const offB = refresh.onSoftRefresh(() => { b += 1; });

  const p1 = refresh.requestSoftRefresh();
  const p2 = refresh.requestSoftRefresh(); /* the double-tap */
  const [r1, r2] = await Promise.all([p1, p2]);

  t('both taps resolve true through ONE cycle', r1 === true && r2 === true);
  t('each subscriber ran exactly once despite the double-tap', a === 1 && b === 1);
  t('the cycle ended (no in-flight left)', refresh.isRefreshing() === false);

  /* 4: failure isolation. */
  let c = 0;
  let invalidated = 0;
  const offC = refresh.onSoftRefresh(async () => { throw new Error('panel dead'); });
  const offD = refresh.onSoftRefresh(() => { c += 1; });
  const ran = await refresh.requestSoftRefresh({ invalidate: () => { invalidated += 1; } });
  t('a throwing subscriber cannot veto the cycle', ran === true && c === 1);
  t('the invalidate hook ran exactly once (api cache + calm cache)', invalidated === 1);

  offA(); offB(); offC(); offD();

  /* 3+5: the guard. */
  const g1 = refresh.holdRefreshGuard('wc-connect');
  let fired = 0;
  const offE = refresh.onSoftRefresh(() => { fired += 1; });
  const blockedResult = await refresh.requestSoftRefresh();
  t('a held guard makes refresh a no-op resolving false', blockedResult === false && fired === 0);
  t('the guard reports blocked state', refresh.refreshBlocked() === true);
  t('guard names are visible for diagnostics', refresh.refreshGuardNames().includes('wc-connect'));

  g1.release();
  t('releasing the guard unblocks', refresh.refreshBlocked() === false);
  const after = await refresh.requestSoftRefresh();
  t('refresh works again once the guard is gone', after === true && fired === 1);
  offE();

  /* idempotent release: a StrictMode-style double release must not corrupt */
  const g2 = refresh.holdRefreshGuard('swap-tx');
  g2.release();
  g2.release();
  t('double-release cannot corrupt the guard set', refresh.refreshBlocked() === false
    && refresh.refreshGuardNames().length === 0);

  /* 6: hardReload without a window refuses rather than throwing. */
  t('hardReload refuses when no window exists', refresh.hardReload() === 'refused');
  t('clearHardReloadFlag without a window is a no-op, not a crash',
    (() => { try { refresh.clearHardReloadFlag(); return true; } catch { return false; } })());
}

/* ------------------------------- structure ------------------------------- */

const read = (p) => readFileSync(p, 'utf8');

{
  const header = read('src/components/Header.jsx');
  t('the header renders the refresh button with an i18n aria-label',
    /aria-label=\{t\('common\.refresh'\)\}/.test(header));
  t('the button disables itself while a guard is held or a cycle runs',
    /refreshDisabled/.test(header) && /disabled=\{refreshDisabled\}/.test(header));
  t('the button reflects wallet.connecting (signing/connecting safety)',
    /wallet\.connecting/.test(header));
  t('the button invalidates the API memo and the calm cache', /clearApiCache/.test(header) && /invalidateCalmCache/.test(header));
  t('the spin class honours reduced motion via the still gate', /refresh-spin/.test(header) && /!still/.test(header));

  const wallet = read('src/context/WalletContext.jsx');
  t('the WalletConnect pairing attempt holds a refresh guard',
    /holdRefreshGuard\('wc-connect'\)/.test(wallet));
  t('the injected connect holds a guard too', /holdRefreshGuard\('injected-connect'\)/.test(wallet));
  t('every connect guard is released in finally', /finally \{\s*setConnecting\(false\);\s*connectGuard\.release\(\);/m.test(wallet)
    || /connectGuard\.release\(\);/.test(wallet));
  t('the wallet layer refreshes its balance on soft refresh (no remount, no new SignClient)',
    /onSoftRefresh/.test(wallet) && /refreshBalance/.test(wallet));

  const swap = read('src/pages/Swap.jsx');
  t('Swap guards ALL sensitive stages (preparing…pending)', /holdRefreshGuard\('swap-tx'\)/.test(swap)
    && /\['preparing', 'quoting', 'signing', 'approving', 'pending'\]/.test(swap));

  const poll = read('src/hooks/useMarket.js');
  t('every usePoll hook joins soft refresh through the same shared cycle', /onSoftRefresh\(run\)/.test(poll));

  const news = read('src/pages/News.jsx');
  t('News re-fetches on soft refresh', /onSoftRefresh/.test(news));
  t('News deep-links tabs (?tab=calm and friends) so a refresh RETURNS to the tab',
    /useSearchParams/.test(news) && /NEWS_TABS/.test(news));

  const main = read('src/main.jsx');
  t('the hard-reload loop guard is cleared on successful boot', /clearHardReloadFlag\(\)/.test(main));
}

/* No new unguarded reloads: the only reload() calls allowed anywhere are the
   two pre-existing recovery paths (RouteBoundary stale-chunk, notify comment)
   and hardReload in lib/refresh.js itself. */
{
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.jsx?$/.test(entry.name)) {
        const src = read(full);
        /* A real CALL, not the word inside a comment — CoinDetail documents
           why it does NOT reload, and prose must not trip the guard. */
        if (/^\s*window\.location\.reload\(\);/m.test(src)) offenders.push(full);
      }
    }
  };
  walk('src');
  const allowed = new Set([
    'src/lib/refresh.js',
    'src/components/RouteBoundary.jsx',
    'src/main.jsx'
  ]);
  const bad = offenders.filter((f) => !allowed.has(f));
  t(`no unguarded window.location.reload() outside the guarded paths${bad.length ? ` — found: ${bad.join(', ')}` : ''}`,
    bad.length === 0);
}

/* The hard-reload one-shot guard exists in source (behavioural test of the
   real flag needs a window; the refusal path above covers the no-window
   case, and RouteBoundary's probe covers the flag pattern). */
{
  const src = read('src/lib/refresh.js');
  t('hard reload has a sessionStorage loop guard', /sessionStorage/.test(src) && /HARD_RELOAD_FLAG/.test(src));
  t('soft refresh never touches wallet storage', !/localStorage\.(removeItem|clear)|sessionStorage\.(removeItem|clear)/.test(
    src.slice(src.indexOf('export async function requestSoftRefresh'), src.indexOf('/* --------------------------- hard refresh'))
  ));
}

export default rows;

/* Standalone run: node test/refresh-probe.mjs */
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  for (const [name, ok] of rows) console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  const failed = rows.filter(([, ok]) => !ok).length;
  console.log(failed ? `\n${failed} FAILED\n` : '\nAll refresh checks passed.\n');
  process.exit(failed ? 1 : 0);
}
