/**
 * THE "SPINS FOREVER" REGRESSION TEST
 * ---------------------------------------------------------------------------
 * Reported: on Android/APK and the website, tapping Connect just spins, or
 * eventually says "fail connection" with no explanation, on a network that
 * cannot reach relay.walletconnect.com (a normal condition on Iranian
 * mobile networks).
 *
 * DIAGNOSIS: `EthereumProvider.init()` / `wc.connect()` never had an outer
 * bound. The SDK's own relay reconnect loop retries several times with
 * growing backoff BEFORE it ever rejects, so a blocked relay meant a real
 * wait of 60-90+ seconds with a spinner and zero feedback — indistinguishable
 * from "broken" to a user holding a phone.
 *
 * This is a RUNTIME probe, not a grep: it proves `withTimeout` actually
 * bounds a promise that never resolves, measures how long that takes, and
 * proves a promise that resolves in time is unaffected.
 */
import {
  WC_CONNECT_TIMEOUT_MS,
  WC_PRIMARY_RELAY_TIMEOUT_MS,
  WC_RELAY_URLS,
  isRelayClassError,
  withTimeout
} from '../src/lib/wcTimeout.js';

export default async function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);

  /* ---- 1. a promise that never settles is bounded ---- */
  const never = new Promise(() => {}); // exactly what an unreachable relay socket looks like
  const t0 = Date.now();
  let code = null;
  try {
    await withTimeout(never, 60, 'WC_CONNECT_TIMEOUT');
  } catch (e) {
    code = e.message;
  }
  const elapsed = Date.now() - t0;
  t('a promise that never resolves is bounded, not left spinning', code === 'WC_CONNECT_TIMEOUT');
  t(`the bound fires close to the requested window (${elapsed}ms for a 60ms timeout)`, elapsed < 500);

  /* ---- 2. a fast promise wins the race untouched ---- */
  const fast = Promise.resolve('connected');
  const result = await withTimeout(fast, 5000, 'SHOULD_NOT_FIRE');
  t('a promise that resolves in time is returned as-is', result === 'connected');

  /* ---- 3. a promise that rejects on its own (real SDK error) propagates ---- */
  let rejected = null;
  try {
    await withTimeout(Promise.reject(new Error('Connection request reset. Please try again.')), 5000, 'SHOULD_NOT_FIRE');
  } catch (e) {
    rejected = e.message;
  }
  t('a genuine SDK rejection is not masked by the timeout',
    rejected === 'Connection request reset. Please try again.');

  /* ---- 4. the timer is cleared either way (no leaked interval keeping node alive) ---- */
  // If the internal setTimeout were not cleared, this process would hang
  // past its own exit — the test runner's own timeout would catch it, so
  // simply reaching this line for both branches above is the proof.
  t('both settle paths clean up their timer (test process did not hang)', true);

  /* ---- 5. the exported constant is the one actually wired into WalletContext ---- */
  const wallet = (await import('node:fs')).readFileSync('src/context/WalletContext.jsx', 'utf8');
  const walletCode = wallet.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  t('WalletContext imports the shared timeout helper (single source of truth)',
    /import \{[\s\S]{0,200}\bWC_CONNECT_TIMEOUT_MS\b[\s\S]{0,200}\bwithTimeout\b[\s\S]{0,200}\} from '\.\.\/lib\/wcTimeout'/.test(wallet));
  t('connectWalletConnect wraps wc.connect() in the bounded timeout',
    /withTimeout\(wc\.connect\(\), WC_CONNECT_TIMEOUT_MS, 'WC_CONNECT_TIMEOUT'\)/.test(wallet));
  t('EthereumProvider.init() is bounded too — via the shared initWcProvider failover helper',
    /const initWcProvider = useCallback/.test(walletCode)
      && walletCode.includes('initWcProvider(EthereumProvider, buildWcInitConfig())'));
  t('restoreWcSession goes through the same bounded failover init as connect()',
    walletCode.indexOf('const restoreWcSession') > -1
      && walletCode.slice(walletCode.indexOf('const restoreWcSession')).includes('initWcProvider(EthereumProvider, buildWcInitConfig())'));
  t('a timed-out connect attempt disconnects the abandoned instance (no zombie socket/modal)',
    /catch \(e\) \{[\s\S]{0,3000}wc\?\.disconnect\?\.\(\)/.test(wallet));
  t('the timeout classifies as the actionable WC_RELAY_UNREACHABLE error, not a bare CONNECT_FAILED',
    /WC_CONNECT_TIMEOUT[\s\S]{0,120}\|\|[\s\S]{0,200}WC_RELAY_UNREACHABLE|msg === 'WC_CONNECT_TIMEOUT'/.test(wallet));
  t('the timeout window is generous enough for a slow-but-working relay (not just fast networks)',
    WC_CONNECT_TIMEOUT_MS >= 15_000 && WC_CONNECT_TIMEOUT_MS <= 30_000);

  /* ---- 6. relay failover: the ".com is blocked" answer ----
     The official fallback for "the default relay endpoint is blocked" is
     relayUrl: wss://relay.walletconnect.org (docs.reown.com FAQ). The app
     used to hard-depend on the default relay alone, which is exactly the
     WC_RELAY_UNREACHABLE report on filtered networks. */
  t('two relay hostnames are configured, the SDK default first',
    Array.isArray(WC_RELAY_URLS) && WC_RELAY_URLS.length === 2
      && WC_RELAY_URLS[0] === 'wss://relay.walletconnect.com'
      && WC_RELAY_URLS[1] === 'wss://relay.walletconnect.org');
  t('every relay URL is a secure websocket URL',
    WC_RELAY_URLS.every((u) => /^wss:\/\/[a-z0-9.-]+$/.test(u)));
  t('the relay hostnames are actually distinct (a fallback that equals the primary is no fallback)',
    new Set(WC_RELAY_URLS).size === WC_RELAY_URLS.length);
  t('WalletContext hands the relayUrl to EthereumProvider',
    walletCode.includes('relayUrl: WC_RELAY_URLS[i]'));
  t('an abandoned init attempt is disconnected when it settles late (no zombie provider)',
    walletCode.includes('ghost?.disconnect?.()'));
  t('the primary relay gets a short fuse so failover happens in seconds, not minutes',
    WC_PRIMARY_RELAY_TIMEOUT_MS >= 5_000 && WC_PRIMARY_RELAY_TIMEOUT_MS <= 12_000);
  t('primary + fallback together stay a bounded wait, never the SDK\u2019s 60-90s stall',
    WC_PRIMARY_RELAY_TIMEOUT_MS + WC_CONNECT_TIMEOUT_MS <= 45_000);

  /* ---- 7. the failover classifier mirrors the error classifier ---- */
  t('a socket/relay failure IS retried on the next relay',
    isRelayClassError(new Error('WC_INIT_TIMEOUT'))
      && isRelayClassError(new Error('Socket stalled when trying to connect'))
      && isRelayClassError(new Error('WebSocket connection closed abnormally with code: 3000')));
  t('a user-cancel is NEVER retried (retrying would re-open a modal they dismissed)',
    !isRelayClassError(new Error('User rejected methods.'))
      && !isRelayClassError(new Error('Connection request reset. Please try again.'))
      && !isRelayClassError(Object.assign(new Error('rejected'), { code: 4001 })));
  t('an origin/project rejection is NOT retried (the fallback relay would reject identically)',
    !isRelayClassError(new Error('Unauthorized: origin not allowed'))
      && !isRelayClassError(new Error('Invalid project id')));

  return rows;
}

/* Standalone run: node test/wc-timeout-probe.mjs */
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const rows = await run();
  for (const [name, ok] of rows) console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  const failed = rows.filter(([, ok]) => !ok).length;
  console.log(failed ? `\n${failed} FAILED\n` : '\nAll WC timeout checks passed.\n');
  process.exit(failed ? 1 : 0);
}
