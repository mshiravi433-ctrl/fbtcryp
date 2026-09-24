/**
 * WALLETCONNECT REQUEST HAND-OFF (APK) — the probe.
 * ---------------------------------------------------------------------------
 * The report: «تو سایت درست کار میکنه ولی تو اپ اندروید موقع امضا (پل، dYdX…)
 * کیف پول میگه اتصال برقرار نیست». Two APK-only facts made it: the relay
 * socket a backgrounded WebView keeps is dead while still reporting
 * `connected`, and the SDK opens the wallet with the requestId BEFORE the
 * relay has acknowledged the request. src/lib/wc/requestHandoff.js answers
 * both, and this file drives it against a FAKE relayer and a FAKE window —
 * no socket, no wallet, no bundler.
 *
 * Wired into test/run.mjs next to the WalletConnect stack probe.
 */
import { readFileSync } from 'node:fs';

import {
  REQUEST_LINK_HOLD_MS,
  installSessionRequestGate,
  openSessionRequestLink,
  parseSessionRequestLink,
  sessionRequestLink,
  verifyRelayLive
} from '../src/lib/wc/requestHandoff.js';
import { guardEip1193 } from '../src/lib/wc/signing.js';
import { walletByKey } from '../src/lib/wc/wallets.js';

const TOPIC = 'a'.repeat(64);
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** A relayer as the SDK exposes it, with a scriptable socket. */
function fakeRelayer({ answers = true, messages = [], delayMs = 0 } = {}) {
  const calls = [];
  const relay = {
    connected: true,
    transportExplicitlyClosed: false,
    subscriber: { topics: [TOPIC] },
    provider: {
      request: async (rpc) => {
        calls.push(['request', rpc.method, rpc.params]);
        if (!answers) return new Promise(() => {});
        if (delayMs) await tick(delayMs);
        return { messages };
      }
    },
    handled: [],
    handleBatchMessageEvents: async (list) => { relay.handled.push(...list); },
    restartTransport: async () => {
      calls.push(['restart']);
      relay.connected = true;
      relay.answersAfterRestart = true;
    },
    transportOpen: async () => { calls.push(['open']); },
    calls
  };
  return relay;
}

/** A window as the APK exposes it: Capacitor + the Java bridge. */
function fakeWindow({ bridge = true, bridgeAnswer = true } = {}) {
  const opens = [];
  const bridgeCalls = [];
  const win = {
    Capacitor: { isNativePlatform: () => true },
    open: (url, name) => { opens.push([url, name]); return null; },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    opens,
    bridgeCalls
  };
  if (bridge) {
    win.FBTWalletLink = {
      openWallet: () => true,
      openSessionLink: (url, pkg) => { bridgeCalls.push([url, pkg]); return bridgeAnswer; }
    };
  }
  return win;
}

/** A sign client with an event bus, as `eip.signer.client`. */
function fakeClient() {
  const handlers = new Map();
  return {
    on: (name, fn) => { handlers.set(name, fn); },
    emit: (name, payload) => handlers.get(name)?.(payload),
    handlers
  };
}

export async function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);

  /* ══════════════════ 1. recognising the SDK's second link ════════════════ */
  {
    const link = `trust://wc?requestId=1758700000000001&sessionTopic=${TOPIC}`;
    const parsed = parseSessionRequestLink(link);
    t('the SDK\'s native request link is recognised',
      parsed && parsed.scheme === 'trust' && parsed.requestId === '1758700000000001' && parsed.topic === TOPIC && !parsed.https);
    t('the three-slash form some SDK builds emit is recognised too',
      parseSessionRequestLink(`metamask:///wc?requestId=5&sessionTopic=${TOPIC}`)?.scheme === 'metamask');
    t('the link-mode https form is recognised',
      parseSessionRequestLink(`https://link.trustwallet.com/wc?requestId=5&sessionTopic=${TOPIC}`)?.https === true);
    t('a pairing link is NOT a request link (that is handoff.js\'s job)',
      parseSessionRequestLink('trust://wc?uri=wc%3Aabc%402%3Frelay-protocol%3Dirn%26symKey%3D00') === null);
    t('a bare scheme is not a request link', parseSessionRequestLink('trust://') === null);
    t('a requestId that is not a number is refused',
      parseSessionRequestLink(`trust://wc?requestId=abc&sessionTopic=${TOPIC}`) === null);
    t('a topic that is not 32 bytes of hex is refused',
      parseSessionRequestLink('trust://wc?requestId=1&sessionTopic=deadbeef') === null);
    t('in-page schemes are never request links',
      parseSessionRequestLink(`javascript://wc?requestId=1&sessionTopic=${TOPIC}`) === null);
    t('the link we build ourselves is the one the SDK would have built',
      sessionRequestLink(walletByKey('trust'), { requestId: '7', topic: TOPIC }) === `trust://wc?requestId=7&sessionTopic=${TOPIC}`
      && sessionRequestLink(walletByKey('metamask'), { requestId: '7', topic: TOPIC }).startsWith('metamask://wc?')
      && sessionRequestLink(null, { requestId: '7', topic: TOPIC }) === ''
      && sessionRequestLink(walletByKey('trust'), { requestId: 'x', topic: TOPIC }) === '');
  }

  /* ══════════════════ 2. proving the socket ═══════════════════════════════ */
  {
    const live = fakeRelayer({ messages: [{ topic: TOPIC, message: 'm1', publishedAt: 1 }] });
    const res = await verifyRelayLive(live, { timeoutMs: 200 });
    t('a socket that answers is reported live and is NOT restarted',
      res.ok && res.live && !res.restarted && !live.calls.some(([k]) => k === 'restart'));
    t('the probe asks the relay for the session\'s topics with the SDK\'s own RPC',
      live.calls[0][1] === 'irn_batchFetchMessages' && live.calls[0][2].topics.includes(TOPIC));
    t('messages the relay was holding are DELIVERED through the SDK (the wallet\'s answer arrives)',
      res.delivered === 1 && live.handled.length === 1 && live.handled[0].message === 'm1');

    const dead = fakeRelayer({ answers: false });
    const res2 = await verifyRelayLive(dead, { timeoutMs: 60, restartMs: 500 });
    t('a socket that says connected but never answers is RESTARTED through the SDK',
      res2.ok && !res2.live && res2.restarted && dead.calls.some(([k]) => k === 'restart') && /TIMEOUT/.test(res2.error));
    t('the probe is bounded — it did not wait on the dead socket', res2.ms < 400);

    const dead2 = fakeRelayer({ answers: false });
    const [a, b] = await Promise.all([
      verifyRelayLive(dead2, { timeoutMs: 60, restartMs: 500 }),
      verifyRelayLive(dead2, { timeoutMs: 60, restartMs: 500 })
    ]);
    t('two callers in the same second share ONE probe and ONE restart',
      a === b && dead2.calls.filter(([k]) => k === 'restart').length === 1);

    const extra = fakeRelayer();
    extra.subscriber.topics = [];
    await verifyRelayLive(extra, { topics: [TOPIC], timeoutMs: 200 });
    t('a caller can name the session topic when the subscriber has none yet',
      extra.calls[0]?.[2]?.topics?.[0] === TOPIC);
    t('nothing to ask and nothing to prove is answered honestly, not as live',
      (await verifyRelayLive(fakeRelayer(), { topics: [] , timeoutMs: 50 })).live === true
      && (await (async () => { const r = fakeRelayer(); r.subscriber.topics = []; return verifyRelayLive(r, { timeoutMs: 50 }); })()).live === false);
    t('no relayer at all is a named refusal', (await verifyRelayLive(null)).error === 'NO_RELAY');
  }

  /* ══════════════════ 3. the gate: one launch, after the ack ══════════════ */
  {
    const win = fakeWindow();
    const client = fakeClient();
    const traces = [];
    const gate = installSessionRequestGate({ win, trace: (n, d) => traces.push([n, d]), wallet: () => walletByKey('trust') });
    t('the gate installs only where Capacitor says native',
      gate && win.open !== null && installSessionRequestGate({ win: { open: () => null } }) === null);
    t('installing twice returns the same gate', installSessionRequestGate({ win }) === gate);
    gate.attachClient(client);
    t('the sign client\'s session_request_sent is subscribed', client.handlers.has('session_request_sent'));

    /* The SDK's redirect, fired BEFORE the relay ack. */
    const link = `trust://wc?requestId=42&sessionTopic=${TOPIC}`;
    const r = win.open(link, '_self', 'noreferrer noopener');
    t('the SDK\'s early launch is HELD, not opened',
      r === null && win.opens.length === 0 && win.bridgeCalls.length === 0 && gate.heldIds().includes('42'));
    await tick(30);
    t('…and stays held while the relay has not acknowledged', win.bridgeCalls.length === 0);
    client.emit('session_request_sent', { id: 42, topic: TOPIC, chainId: 'eip155:1', request: {} });
    t('the ack releases it — ONCE, package-scoped, through the Java bridge',
      win.bridgeCalls.length === 1 && win.bridgeCalls[0][0] === link && win.bridgeCalls[0][1] === 'com.wallet.crypto.trustapp'
      && win.opens.length === 0 && !gate.heldIds().includes('42'));
    win.open(link, '_self');
    t('a late duplicate of an opened link is swallowed', win.bridgeCalls.length === 1 && win.opens.length === 0);

    /* The SDK opened nothing (no focus / no choice key): we build the link. */
    client.emit('session_request_sent', { id: 43, topic: TOPIC });
    t('when the SDK handed us no link, the ack still opens the wallet at the exact request',
      win.bridgeCalls.length === 2 && win.bridgeCalls[1][0] === `trust://wc?requestId=43&sessionTopic=${TOPIC}`);

    /* Everything else passes straight through. */
    win.open('https://fbtswap.ir/help', '_blank');
    win.open('trust://wc?uri=wc%3Aabc', '_self');
    t('store links and pairing links are untouched', win.opens.length === 2);

    t('the hold has a ceiling so a request nobody acked is not opened a minute later',
      REQUEST_LINK_HOLD_MS <= 60_000);
    gate.uninstall();
    t('uninstall restores window.open', typeof win.open === 'function' && !win.open.__fbtGate && win.__fbtSessionRequestGate === undefined);
  }

  /* ══════════════════ 4. fail-open ═════════════════════════════════════════ */
  {
    /* No client to listen to: the link must still be released, later. */
    const win = fakeWindow();
    const gate = installSessionRequestGate({ win, wallet: () => walletByKey('trust') });
    const link = `trust://wc?requestId=9&sessionTopic=${TOPIC}`;
    win.open(link, '_self');
    await tick(1700);
    t('with no event bus the held link is released on the fallback timer', win.bridgeCalls.length === 1);
    gate.uninstall();

    /* Bridge missing (older APK): the original window.open carries it. */
    const win2 = fakeWindow({ bridge: false });
    const res = openSessionRequestLink(win2, link, { wallet: walletByKey('trust') });
    t('without the Java bridge the link goes out through window.open, _self',
      res.ok && res.route === 'window-open' && win2.opens[0][0] === link && win2.opens[0][1] === '_self');

    /* Bridge refuses (wallet not installed under that package). */
    const win3 = fakeWindow({ bridgeAnswer: false });
    const res3 = openSessionRequestLink(win3, link, { wallet: walletByKey('trust') });
    t('a bridge refusal falls back to the browser call instead of failing silently',
      res3.ok && res3.route === 'window-open' && win3.bridgeCalls.length === 1 && win3.opens.length === 1);
  }

  /* ══════════════════ 5. the signing guard proves the socket first ════════ */
  {
    const relay = fakeRelayer({ answers: false });
    const order = [];
    const eip = {
      session: { topic: TOPIC, namespaces: { eip155: { methods: ['eth_sendTransaction', 'personal_sign'], chains: ['eip155:1'], accounts: [`eip155:1:0x${'1'.repeat(40)}`] } } },
      chainId: 1,
      accounts: [`0x${'1'.repeat(40)}`],
      signer: { client: { core: { relayer: relay } } },
      request: async (args) => { order.push(['request', args.method]); return '0xsig'; }
    };
    relay.provider.request = async (rpc) => { order.push(['probe', rpc.method]); return new Promise(() => {}); };
    relay.restartTransport = async () => { order.push(['restart']); };
    const traces = [];
    const doc = { visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} };
    const guarded = guardEip1193(eip, { relayLiveness: true, onTrace: (n) => traces.push(n), doc, win: null });
    const out = await guarded.request({ method: 'personal_sign', params: ['0x01', `0x${'1'.repeat(40)}`] });
    t('with relayLiveness the socket is probed and restarted BEFORE the request is published',
      out === '0xsig' && order[0][0] === 'probe' && order[1][0] === 'restart' && order[2][0] === 'request');
    t('the outcome is traced for the diagnostics', traces.includes('sign_relay_restarted'));

    const quiet = [];
    const eip2 = { ...eip, request: async () => { quiet.push('request'); return '0x'; } };
    relay.provider.request = async () => { quiet.push('probe'); return { messages: [] }; };
    const guarded2 = guardEip1193(eip2, { relayLiveness: false, doc, win: null });
    await guarded2.request({ method: 'personal_sign', params: ['0x01', `0x${'1'.repeat(40)}`] });
    t('without relayLiveness (desktop) nothing is probed', quiet.join(',') === 'request');
  }

  /* ══════════════════ 6. wiring: reachable, not just correct ══════════════ */
  {
    const ctx = readFileSync('src/context/WalletContext.jsx', 'utf8');
    const signing = readFileSync('src/lib/wc/signing.js', 'utf8');
    const session = readFileSync('src/lib/wc/session.js', 'utf8');
    const java = readFileSync('android/app/src/main/java/ir/fbtswap/app/MainActivity.java', 'utf8');
    t('the WalletContext arms the gate where the WalletConnect provider is adapted',
      /armNativeRequestHandoff\(eip/.test(ctx) && /relayLiveness: onPhone/.test(ctx));
    t('the bare-scheme nudge is deferred to the gate inside the APK',
      /isNativePlatform\?\.\(\)\)\s*\{[\s\S]*?sign_wallet_nudge_deferred/.test(ctx));
    t('the guard proves the socket before the publish and on the return',
      /await proveRelay\('pre_sign'\)/.test(signing) && /proveRelay\('returned'\)/.test(signing)
      && /fbt:app-resume/.test(signing));
    t('the foreground wake proves a "connected" socket instead of trusting it',
      /relayer\.connected === true\)\s*\{\s*\n\s*const proof = await verifyRelayLive/.test(session));
    t('the Java bridge has the package-scoped session-link door',
      /public boolean openSessionLink\(final String url, final String packageName\)/.test(java)
      && /SESSION_REQUEST_QUERY/.test(java) && /schemeForPackage\(packageName\)/.test(java));
    t('the deep-link inbox accepts a signed transaction, not just a pairing',
      /MAX_DEEPLINK_LENGTH = 65536/.test(java));
    t('the Solana bridge tries every door the wallet declares before an unscoped launch',
      /public String openWalletRequest\(final String url, final String packageName\)/.test(java)
      && /aliasHosts\(host\)/.test(java) && /customSchemeUri\(uri, packageName\)/.test(java)
      && /"phantom:\/\/"|scheme = "phantom"/.test(java));
  }

  return rows;
}

/* Standalone run: node test/wc-request-handoff-probe.mjs */
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const rows = await run();
  for (const [name, ok] of rows) console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  const failed = rows.filter(([, ok]) => !ok).length;
  console.log(failed ? `\n${failed} FAILED of ${rows.length}\n` : `\nAll ${rows.length} request hand-off checks passed.\n`);
  process.exit(failed ? 1 : 0);
}
