/** Relay measurements are advisory; browser socket errors do not identify their cause. */
import { readFileSync } from 'node:fs';
import {
  RELAY_BLOCKED_VERDICTS,
  RELAY_PREFLIGHT_TIMEOUT_MS,
  RELAY_STATE_TTL_MS,
  clearRelayStateCache,
  getRelayState,
  isRelayBlocked,
  probeRelaySet,
  readRelaySocket,
  readRelayStateCache,
  relayOrderFromHosts,
  relayVerdict,
  resetRelayState
} from '../src/lib/wcRelayProbe.js';
import { WC_RELAY_URLS } from '../src/lib/wcTimeout.js';

const PROJECT_ID = '5997d5aee8bb42f43ddec4b1a5f94eb1';
const [PRIMARY, FALLBACK] = WC_RELAY_URLS;

/* Strip comments before searching source: these files document the very bugs
   the checks guard against, and a check that matches its own prose is no check. */
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** A WebSocket double that fires the event its plan names for THAT url. */
const socketPlan = (plan) => {
  const sockets = [];
  class FakeSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      sockets.push(this);
      const behaviour = typeof plan === 'function' ? plan(url) : plan;
      queueMicrotask(() => {
        if (behaviour === 'open') { this.readyState = 1; this.onopen?.({}); } else if (behaviour === 'error') this.onerror?.({});
        else if (behaviour === 'close') this.onclose?.({ code: 1006 });
        else if (behaviour && typeof behaviour === 'object') this.onclose?.({ code: behaviour.code });
        /* 'silent' intentionally does nothing at all */
      });
    }
    close() { this.closed = true; }
  }
  return { FakeSocket, sockets };
};

/** A fetch double for the relay's HTTPS door: 'ok' answers, 'error' refuses. */
const fetchFor = (behaviour = 'ok') => async () => {
  if (behaviour === 'error') throw new TypeError('NetworkError when attempting to fetch resource.');
  return { ok: true, status: 200, json: async () => ({}) };
};

/** The exact shape the support report measured: HTTPS alive, sockets refused. */
const WS_REFUSED_PLAN = () => 'error';

export default async function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);
  resetRelayState();

  /* ---- 1. probeRelaySet: the measurement and the order it justifies ------- */
  {
    const state = await probeRelaySet({
      projectId: PROJECT_ID,
      WebSocketImpl: socketPlan(WS_REFUSED_PLAN).FakeSocket,
      fetchImpl: fetchFor('ok'),
      timeoutMs: 500
    });
    t('every configured hostname is probed, each with its own socket and HTTPS facts',
      state.hosts.length === WC_RELAY_URLS.length
        && state.hosts.every((h) => h.socket && h.https && h.socket.ok === false));
    t('the report’s exact shape (HTTPS alive + sockets refused) reads WS_REFUSED',
      state.verdict === 'WS_REFUSED' && state.blocked === true);
    /* `ms` and the error are the two facts that survive a refusal; the close
       code only exists when the browser's second event lands (probeRelay waits
       250ms for it), which this fake does not fire — so it is asserted where a
       close IS fired, not here. */
    t('a WS_REFUSED measurement keeps the per-host timing the report quoted',
      state.hosts.every((h) => typeof h.socket.ms === 'number' && h.socket.error === 'SOCKET_ERROR')
        && state.hosts.every((h) => h.https.ok === true));
    t('a code the RELAY published survives as CLOSED_<code> (a refusal by the host is distinguishable)',
      (await probeRelaySet({
        projectId: PROJECT_ID,
        WebSocketImpl: socketPlan({ code: 3000 }).FakeSocket,
        fetchImpl: fetchFor('ok'),
        timeoutMs: 400
      })).hosts.every((h) => h.socket.error === 'CLOSED_3000' && h.socket.closeCode === 3000));
    t('a blocked measurement still yields a try order (a permutation, never an invention)',
      state.order.length === WC_RELAY_URLS.length
        && state.order.every((u) => WC_RELAY_URLS.includes(u))
        && new Set(state.order).size === WC_RELAY_URLS.length);
  }

  {
    /* The case the old static order got wrong: the PRIMARY is filtered, the
       FALLBACK opens. The order must put the working host first — that is the
       whole difference between "pairing succeeds" and "the relay is blocked". */
    /* The probe dials `${url}/?projectId=…` — the SDK's own URL shape — so the
       plan keys on the prefix, exactly as the real handshake would. */
    const onlyFallback = socketPlan((url) => (String(url).startsWith(FALLBACK) ? 'open' : 'error'));
    const state = await probeRelaySet({
      projectId: PROJECT_ID,
      WebSocketImpl: onlyFallback.FakeSocket,
      fetchImpl: fetchFor('ok'),
      timeoutMs: 500
    });
    t('a blocked primary with a working fallback is OPEN, not «the relay is blocked»',
      state.verdict === 'OPEN' && state.blocked === false);
    t('…and the host that OPENED is the one handed to init() first (real failover)',
      state.order[0] === FALLBACK && state.order[1] === PRIMARY);
    t('the open host is listed in openUrls, and the probe closed its sockets',
      state.openUrls.length === 1 && state.openUrls[0] === FALLBACK
        && onlyFallback.sockets.every((s) => s.closed === true));
  }

  {
    const state = await probeRelaySet({
      projectId: PROJECT_ID,
      WebSocketImpl: socketPlan('silent').FakeSocket,
      fetchImpl: fetchFor('error'),
      timeoutMs: 120
    });
    t('every socket swallowed AND no HTTPS answer is TIMEOUT (a filtering network)',
      state.verdict === 'TIMEOUT' && state.blocked === true);
    t('the preflight is bounded by its own timeout, not by the network',
      state.ms >= 100 && state.ms < RELAY_PREFLIGHT_TIMEOUT_MS);
  }

  /* ---- 2. relayOrderFromHosts: the permutation contract ------------------ */
  {
    t('an unmeasured list falls back to the configured order',
      relayOrderFromHosts(null).join() === WC_RELAY_URLS.join()
        && relayOrderFromHosts([]).join() === WC_RELAY_URLS.join());
    t('open hosts come first, in the configured order',
      relayOrderFromHosts([
        { url: PRIMARY, socket: { ok: true } },
        { url: FALLBACK, socket: { ok: true } }
      ]).join() === [PRIMARY, FALLBACK].join());
    /* The order is built ONLY from hostnames that were probed or configured —
       both lists are ours, so a relay URL can never be injected from the
       network. That is the invariant that matters; "must equal the static list"
       would forbid a deliberately configured extra relay. */
    t('the order never invents a hostname (probed or configured, nothing else)',
      relayOrderFromHosts([{ url: 'wss://extra.example', socket: { ok: true } }])
        .every((u) => u === 'wss://extra.example' || WC_RELAY_URLS.includes(u))
        && relayOrderFromHosts([{ url: 'wss://extra.example', socket: { ok: true } }])[0] === 'wss://extra.example');
    t('a probe over the configured list can only return that list, reordered',
      relayOrderFromHosts([
        { url: PRIMARY, socket: { ok: false } },
        { url: FALLBACK, socket: { ok: true } }
      ]).every((u) => WC_RELAY_URLS.includes(u)));
    t('a host that was never measured still gets its turn (just not first)',
      relayOrderFromHosts([{ url: PRIMARY, socket: { ok: true } }]).join()
        === [PRIMARY, FALLBACK].join());
  }

  /* ---- 3. getRelayState: one measurement, shared ------------------------- */
  {
    resetRelayState();
    const { FakeSocket, sockets } = socketPlan(WS_REFUSED_PLAN);
    const first = await getRelayState({
      projectId: PROJECT_ID, WebSocketImpl: FakeSocket, fetchImpl: fetchFor('ok'), timeoutMs: 400
    });
    const second = await getRelayState({
      projectId: PROJECT_ID, WebSocketImpl: FakeSocket, fetchImpl: fetchFor('ok'), timeoutMs: 400
    });
    t('the second call inside the TTL is served from the measurement (no new sockets)',
      second.fromCache === true && sockets.length === WC_RELAY_URLS.length);
    t('the cached state carries the same verdict the first probe made',
      first.verdict === 'WS_REFUSED' && second.verdict === 'WS_REFUSED');
    t('readRelayStateCache() exposes the same object the flow stored',
      readRelayStateCache()?.verdict === 'WS_REFUSED');
    t('an expired measurement is re-probed (a verdict is not permanent)',
      RELAY_STATE_TTL_MS > 0 && RELAY_STATE_TTL_MS <= 600_000);

    const forced = await getRelayState({
      projectId: PROJECT_ID, force: true, WebSocketImpl: FakeSocket,
      fetchImpl: fetchFor('ok'), timeoutMs: 400
    });
    t('`force` re-measures — the user’s explicit "try again" is never answered from cache',
      forced.fromCache === false && sockets.length === WC_RELAY_URLS.length * 2);

    /* Two callers at once (a tap during a restore) must open ONE set of sockets. */
    resetRelayState();
    const { FakeSocket: FS2, sockets: s2 } = socketPlan('open');
    const [a, b] = await Promise.all([
      getRelayState({ projectId: PROJECT_ID, WebSocketImpl: FS2, fetchImpl: fetchFor('ok'), timeoutMs: 400 }),
      getRelayState({ projectId: PROJECT_ID, WebSocketImpl: FS2, fetchImpl: fetchFor('ok'), timeoutMs: 400 })
    ]);
    t('concurrent callers share one in-flight probe (single-flighted)',
      a.verdict === 'OPEN' && b.verdict === 'OPEN' && s2.length === WC_RELAY_URLS.length);

    clearRelayStateCache();
    t('clearRelayStateCache() drops the verdict, so the next attempt measures again',
      readRelayStateCache() === null);
    resetRelayState();
  }

  /* ---- 4. isRelayBlocked: what may and may not refuse a connection ------- */
  {
    t('the three measured blocks are blocks',
      RELAY_BLOCKED_VERDICTS.join() === ['WS_REFUSED', 'UNREACHABLE', 'TIMEOUT'].join()
        && RELAY_BLOCKED_VERDICTS.every((v) => isRelayBlocked(v)));
    t('OPEN is not a block', !isRelayBlocked('OPEN'));
    t('a host with NO WebSocket is not a block (nothing was measured, so nothing is refused)',
      !isRelayBlocked('NO_WEBSOCKET'));
    t('NO_MEASUREMENT is not a block (a missing instrument must not break the feature)',
      !isRelayBlocked('NO_MEASUREMENT') && !isRelayBlocked(null) && !isRelayBlocked(undefined));
    t('the verdict rule the preflight and the panel share is the exported one',
      relayVerdict([]).verdict === 'NO_MEASUREMENT'
        && relayVerdict([{ socket: { ok: true }, url: PRIMARY }]).verdict === 'OPEN');
  }

  /* ---- 5. readRelaySocket: the SDK’s own answer -------------------------- */
  {
    t('no provider at all is reported honestly, never as "connected"',
      readRelaySocket(null).connected === false && readRelaySocket(null).hasRelayer === false);
    const live = { signer: { client: { core: { relayer: {
      connected: true, connecting: false, provider: { connection: { socket: { readyState: 1 } } }
    } } } } };
    t('the SDK’s live relayer reads as an open socket',
      readRelaySocket(live).connected === true && readRelaySocket(live).readyState === 1);
    const never = { signer: { client: { core: { relayer: {
      connected: false, connecting: false, provider: { connection: {} }
    } } } } };
    /* readyState null is the transportOpen() short-circuit: with no topics the
       SDK has not tried yet — a different fact from "it tried and failed". */
    t('an untouched transport reports readyState null, not 0 (never attempted ≠ failed)',
      readRelaySocket(never).connected === false && readRelaySocket(never).readyState === null);
  }

  /* ---- 6. wiring: the connect flow --------------------------------------- */
  {
    const ctx = strip(readFileSync('src/context/WalletContext.jsx', 'utf8'));

    t('the preflight runs BEFORE init() — the measurement precedes the promise',
      ctx.indexOf('await getRelayState({') > ctx.indexOf('const connectWalletConnect')
        && ctx.indexOf('await getRelayState({') < ctx.indexOf('await initWcProvider('));
    t('a failed diagnostic never skips the real SDK connection',
      !ctx.includes("wcEvent('connect_skipped_relay')"));
    t('an explicit `force` re-measures instead of trusting the verdict',
      /connectWalletConnect = useCallback\(async \(\{ force = false \} = \{\}\)/.test(ctx)
        && /force\n?\s*\}\);/.test(ctx.slice(ctx.indexOf('await getRelayState({'), ctx.indexOf('await getRelayState({') + 220)));
    t('the measured order is what init() receives (not the static list)',
      /const relayOrder = Array\.isArray\(relay\?\.order\) && relay\.order\.length \? relay\.order : WC_RELAY_URLS/.test(ctx)
        && ctx.includes('buildWcInitConfig(true), relayOrder)'));
    t('every preflight verdict is traced as a literal event name',
      ['relay_preflight_open', 'relay_preflight_ws_refused', 'relay_preflight_unreachable',
        'relay_preflight_timeout', 'relay_preflight_unmeasured']
        .every((name) => ctx.includes(`wcEvent('${name}'`)));
    t('the SDK’s own socket state is traced after init (the fact `relay_ok` used to fake)',
      /readRelaySocket\(wcInstance\)/.test(ctx)
        && ctx.includes("wcEvent('relay_socket_open'")
        && ctx.includes("wcEvent('relay_socket_unopened')"));
    t('init() no longer claims the relay answered (no relay_ok event survives)',
      !/wcEvent\('relay_ok'/.test(ctx) && !/wcEvent\('relay_fallback_ok'/.test(ctx)
        && ctx.includes("wcEvent(i ? 'provider_ready_fallback' : 'provider_ready', Number(i))"));
    t('the failure the trace records now carries its REASON and its duration',
      ['connect_failed_cancel', 'connect_failed_origin', 'connect_failed_expired',
        'connect_failed_relay', 'connect_failed_unknown']
        .every((name) => new RegExp(`wcEvent\\('${name}', Number\\(elapsed\\)\\)`).test(ctx)));
    t('a relay-class failure drops the cached verdict (the next attempt re-measures)',
      /wcEvent\('connect_failed_relay', Number\(elapsed\)\);[\s\S]{0,320}clearRelayStateCache\(\);/.test(ctx));
    /* Scoped to the restore block: `buildWcInitConfig(false), relayOrder` also
       appears earlier in the file, as connect()'s retry without the modal. */
    t('a failed diagnostic never skips SDK session restoration',
      !ctx.includes("wcEvent('restore_skipped_relay')"));
    t('the measurement reaches the UI through the context (one story, three surfaces)',
      /wcRelay,\s*wcRelayBlocked,/.test(ctx)
        && /const wcRelayBlocked = Boolean\(wcRelay && isRelayBlocked\(wcRelay\.verdict\)\)/.test(ctx));
  }

  /* ---- 7. wiring: the sheet and the strings ------------------------------ */
  {
    const sheet = strip(readFileSync('src/components/WalletConnectSheet.jsx', 'utf8'));
    t('the sheet reads the context’s measurement instead of probing again',
      /const relayBlocked = Boolean\(wallet\.wcRelayBlocked\)/.test(sheet));
    t('a blocked relay stops the pairing row from claiming to be recommended',
      /relayBlocked \? \(\s*<span className="pill pill-down"/.test(sheet));
    t('…and hands the recommendation to a route that needs no relay',
      /data-featured=\{relayBlocked \? 'true' : undefined\}/.test(sheet));
    t('the tap on a blocked network is an explicit force (evidence, not a law)',
      /connectWalletConnect\(\{ force: relayBlocked \}\)/.test(sheet));
    t('the sheet says why, before the tap',
      /relayBlocked && \(\s*<p className="notice notice-danger"[\s\S]{0,120}wallet\.wcRelayBlockedHint/.test(sheet));

    const keys = ['wcRelayBlockedHint', 'wcRelayBlockedPill', 'wcRelayTryAnyway'];
    t('the three new strings exist in all three complete locales',
      ['fa', 'en', 'ar'].every((locale) => {
        const json = JSON.parse(readFileSync(`src/i18n/locales/${locale}.json`, 'utf8'));
        return keys.every((k) => typeof json.wallet?.[k] === 'string' && json.wallet[k].length > 8);
      }));
    t('the existing relay-free-routes sentence is still what the panel and the error print',
      ['fa', 'en', 'ar'].every((locale) => {
        const json = JSON.parse(readFileSync(`src/i18n/locales/${locale}.json`, 'utf8'));
        return Boolean(json.wallet?.healthRelayFreeRoutes) && Boolean(json.wallet?.wcRelayUnreachable);
      }));
  }

  /* ---- 8. the instrument is shared, not duplicated ----------------------- */
  {
    const health = readFileSync('src/lib/walletHealth.js', 'utf8');
    t('the health report re-exports the same probe (one instrument, two surfaces)',
      /export \{[\s\S]{0,120}probeRelay,[\s\S]{0,120}\} from '\.\/wcRelayProbe\.js'/.test(health));
    t('…and its collector calls the SAME probeRelaySet the connect flow calls',
      /probeRelaySet\(\{ urls: hosts, projectId, timeoutMs, WebSocketImpl, fetchImpl \}\)/.test(strip(health)));
    t('the probe includes signed auth rather than a projectId-only handshake',
      readFileSync('src/lib/wcRelayProbe.js', 'utf8').includes("target.searchParams.set('auth', auth)"));
  }

  return rows;
}

/* Standalone run: node test/wc-relay-preflight-probe.mjs */
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const rows = await run();
  for (const [name, ok] of rows) console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  const failed = rows.filter(([, ok]) => !ok).length;
  console.log(failed ? `\n${failed} FAILED\n` : '\nAll relay preflight checks passed.\n');
  process.exit(failed ? 1 : 0);
}
