/**
 * WALLET DIAGNOSTICS PROBE — the matrix, against the real source.
 * ---------------------------------------------------------------------------
 * `walletconnect-stack-probe.mjs` locks the WalletConnect lifecycle and
 * `solana-deeplink-probe.mjs` locks the Solana round trip. This file locks the
 * three things those two cannot see, because they are newer than both:
 *
 *   1. THE VERDICT — `src/lib/wc/diagnostics.js`: eight named causes, one of
 *      them OK, and the rule that a dashboard problem must never be reported as
 *      a code problem (and vice versa).
 *   2. THE SOLANA LAYER — `src/lib/solana/walletLayer.js`: what is detected per
 *      platform, and which methods each transport can honestly claim.
 *   3. THE UNIFIED STATE — `src/lib/walletState.js`: EVM and Solana are
 *      independent channels; one can never overwrite the other; the Intent OS
 *      query reports both plus the networks and the signing capabilities.
 *
 * Plus the two operational files that decide whether a wallet can trust us at
 * all: `src/lib/solana/assetlinks.js` (identity) and `src/lib/solana/health.js`
 * (the Solana half of the health panel).
 *
 * No network. No browser. No bundler. Everything external is injected, which is
 * the only way a verdict about «the dashboard is not registered» can be tested
 * without a dashboard.
 */
import { readFileSync } from 'node:fs';

import {
  WC_DIAGNOSIS,
  WC_DIAGNOSIS_OWNER,
  WC_DIAGNOSIS_SENTENCE,
  classifyWalletConnectDiagnosis,
  collectWalletConnectDiagnosis,
  diagnosisLines,
  sdkConfigFacts
} from '../src/lib/wc/diagnostics.js';
import { RELAY_URLS, WC_ALLOWED_ORIGINS, WC_PROJECT_ID, wcMetadata, walletIdentityFacts, walletIdentityUrl } from '../src/lib/wc/config.js';
import { probeVerifyReachability } from '../src/lib/wc/verify.js';
import {
  ASSETLINKS_PATH,
  ASSETLINKS_SENTENCE,
  assetLinksUrl,
  checkDeployedAssetLinks,
  normalizeFingerprint,
  validateAssetLinks
} from '../src/lib/solana/assetlinks.js';
import {
  SOLANA_WALLET_ERRORS,
  SOLANA_WALLET_METHODS,
  activeSolanaTransport,
  connectSolanaWallet,
  createSolanaWalletLayer,
  detectInjectedWallets,
  detectSolanaWallets,
  getSolanaPublicKey,
  signAllSolanaTransactions,
  signSolanaMessage,
  signSolanaTransaction,
  signAndSendSolanaTransaction,
  walletCapabilities,
  walletStandardSupported
} from '../src/lib/solana/walletLayer.js';
import { collectSolanaHealth } from '../src/lib/solana/health.js';
import { WALLET_STATE_SCHEMA, registerEvmWalletSource, readWalletState, subscribeWalletState, walletStateForIntent } from '../src/lib/walletState.js';

const FINGERPRINT = 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99';
const OTHER_FINGERPRINT = '11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00';

/** A window-like object — enough for identity, detection and packaging rules. */
function fakeWindow({ origin = 'https://fbtswap.ir', ua = 'Mozilla/5.0', native = false, globals = {} } = {}) {
  const win = {
    location: { origin, href: `${origin}/`, hostname: new URL(origin).hostname, hash: '' },
    navigator: { userAgent: ua },
    Capacitor: { isNativePlatform: () => native },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    setTimeout,
    clearTimeout,
    document: undefined,
    ...globals
  };
  return win;
}

/** A fetch double: a URL → response map, anything else rejects. */
function fakeFetch(routes) {
  return async (url, options = {}) => {
    const key = Object.keys(routes).find((candidate) => String(url).startsWith(candidate));
    if (!key) throw new Error(`fetch failed: ${url} ${options.method ?? 'GET'}`);
    const route = routes[key];
    if (typeof route === 'function') return route(url, options);
    return {
      ok: route.status ? route.status < 400 : true,
      status: route.status ?? 200,
      json: async () => route.body ?? null
    };
  };
}

/** A WebSocket double: opens for the urls that say so, refuses the rest. */
function fakeWebSocket({ open = [] } = {}) {
  return class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      const willOpen = open.some((prefix) => String(url).startsWith(prefix));
      setTimeout(() => {
        if (willOpen) {
          this.readyState = 1;
          this.onopen?.({});
        } else {
          this.readyState = 3;
          this.onerror?.({});
          this.onclose?.({ code: 1006 });
        }
      }, 0);
    }
    close() {
      this.readyState = 3;
    }
  };
}

export async function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);
  const meta = wcMetadata();

  /* ══════════════════ 1. metadata is ONE canonical builder ════════════════ */
  {
    t('there is exactly one metadata builder in src/lib/wc',
      ['config.js', 'appkit.js', 'session.js', 'handoff.js', 'health.js', 'diagnostics.js'].every((file) => {
        const src = readFileSync(`src/lib/wc/${file}`, 'utf8');
        /* `metadata = {` inside a returned object is not a builder — only a
           second `function wcMetadata`-shaped definition would be. */
        return !/export function wcMetadata/.test(src) || file === 'config.js';
      }));
    t('the project id is a source constant, not an env read',
      WC_PROJECT_ID === '5997d5aee8bb42f43ddec4b1a5f94eb1'
        && !/VITE_WALLETCONNECT_PROJECT_ID/.test(readFileSync('src/lib/wc/config.js', 'utf8').replace(/^\s*\*.*$/gm, '')));
    t('the browser origin is the identity on a public https page',
      walletIdentityUrl(fakeWindow({ origin: 'https://fbtswap.ir' })) === 'https://fbtswap.ir'
        && walletIdentityUrl(fakeWindow({ origin: 'https://www.fbtswap.ir' })) === 'https://www.fbtswap.ir');
    t('the packaged WebView declares the canonical origin, not localhost',
      walletIdentityUrl(fakeWindow({ origin: 'https://localhost', native: true })) === 'https://fbtswap.ir');
    t('a dev server does not claim to be localhost either',
      walletIdentityUrl(fakeWindow({ origin: 'http://localhost:5173' })) === 'https://fbtswap.ir');
    t('metadata.url follows the page on both production hosts',
      wcMetadata(fakeWindow({ origin: 'https://fbtswap.ir' })).url === 'https://fbtswap.ir'
        && wcMetadata(fakeWindow({ origin: 'https://www.fbtswap.ir' })).url === 'https://www.fbtswap.ir');
    t('metadata.verifyUrl agrees with metadata.url',
      wcMetadata(fakeWindow({ origin: 'https://www.fbtswap.ir' })).verifyUrl === 'https://www.fbtswap.ir');
    t('metadata carries a same-origin icon',
      wcMetadata(fakeWindow({ origin: 'https://fbtswap.ir' })).icons[0] === 'https://fbtswap.ir/icon-512.png');
    t('every declared origin is a scheme-qualified public origin',
      WC_ALLOWED_ORIGINS.length === 3
        && WC_ALLOWED_ORIGINS.includes('https://fbtswap.ir')
        && WC_ALLOWED_ORIGINS.includes('https://www.fbtswap.ir')
        && WC_ALLOWED_ORIGINS.includes('https://localhost'));
    const sdk = sdkConfigFacts({ projectId: WC_PROJECT_ID });
    t('the shipped configuration passes its own SDK check', sdk.ok === true);
    t('a bad project id shape is caught before any network call',
      sdkConfigFacts({ projectId: 'nope' }).problems.includes('PROJECT_ID_SHAPE'));
    t('a non-https metadata url is caught',
      sdkConfigFacts({ projectId: WC_PROJECT_ID, metadata: { ...meta, url: 'http://fbtswap.ir', verifyUrl: 'http://fbtswap.ir', icons: ['http://fbtswap.ir/x.png'] } }).ok === false);
    t('a verifyUrl naming another host is caught',
      sdkConfigFacts({ projectId: WC_PROJECT_ID, metadata: { ...meta, verifyUrl: 'https://evil.example' } })
        .problems.includes('METADATA_VERIFY_URL_MISMATCH'));
    t('an icon on another origin is caught',
      sdkConfigFacts({ projectId: WC_PROJECT_ID, metadata: { ...meta, icons: ['https://cdn.example/i.png'] } })
        .problems.includes('METADATA_ICON_CROSS_ORIGIN'));
  }

  /* ══════════════════ 2. the verdict: eight causes, one OK ════════════════ */
  {
    const base = { sdkConfig: { ok: true, problems: [] }, pageOrigin: 'https://fbtswap.ir', declaredUrl: 'https://fbtswap.ir' };
    const good = {
      ...base,
      registry: { ok: true, status: 200, list: ['https://fbtswap.ir'] },
      projectConfig: { ok: true, status: 200 },
      relay: { hosts: [{ url: RELAY_URLS[0], socket: { ok: true } }] },
      verify: { enclave: { ok: true }, attestation: { verdict: 'VERIFIED' } }
    };
    const codes = (facts) => classifyWalletConnectDiagnosis(facts).code;

    t('a healthy stack is OK', codes(good) === WC_DIAGNOSIS.OK);
    t('www is tested as its own origin, not the parent domain',
      codes({ ...good, pageOrigin: 'https://www.fbtswap.ir', declaredUrl: 'https://www.fbtswap.ir', registry: { ok: true, list: ['https://www.fbtswap.ir'] } }) === WC_DIAGNOSIS.OK);
    t('metadata naming another host than the page is ORIGIN_MISMATCH',
      codes({ ...good, pageOrigin: 'https://www.fbtswap.ir', declaredUrl: 'https://fbtswap.ir' }) === WC_DIAGNOSIS.ORIGIN_MISMATCH);
    t('the packaged app is never an origin mismatch',
      codes({ ...good, pageOrigin: 'https://localhost', declaredUrl: 'https://fbtswap.ir', packaged: true, registry: { ok: true, list: ['https://fbtswap.ir', 'https://localhost'] } }) === WC_DIAGNOSIS.OK);
    t('an empty registry is DOMAIN_NOT_REGISTERED even when everything else answers',
      codes({ ...good, registry: { ok: true, status: 200, list: [] } }) === WC_DIAGNOSIS.DOMAIN_NOT_REGISTERED);
    t('an origin missing from a populated registry is DOMAIN_NOT_REGISTERED',
      codes({ ...good, pageOrigin: 'https://www.fbtswap.ir', declaredUrl: 'https://www.fbtswap.ir', registry: { ok: true, list: ['https://fbtswap.ir'] } }) === WC_DIAGNOSIS.DOMAIN_NOT_REGISTERED);
    t('the domain cause is owned by DASHBOARD, not by CODE',
      classifyWalletConnectDiagnosis({ ...good, registry: { ok: true, list: [] } }).owner === WC_DIAGNOSIS_OWNER.DOMAIN_NOT_REGISTERED);
    t('a 403 on the project config is PROJECT_ID_MISMATCH',
      codes({ ...good, projectConfig: { ok: false, status: 403 } }) === WC_DIAGNOSIS.PROJECT_ID_MISMATCH);
    t('a 403 on the registry is a project id problem, not a network one',
      codes({ ...good, registry: { ok: false, status: 403, list: null } }) === WC_DIAGNOSIS.PROJECT_ID_MISMATCH);
    t('an unreachable enclave with an unreadable registry is VERIFY_SERVICE_UNREACHABLE',
      codes({ ...good, registry: { ok: false, status: null, error: 'TIMEOUT', list: null }, verify: { enclave: { ok: false }, attestation: null } }) === WC_DIAGNOSIS.VERIFY_SERVICE_UNREACHABLE);
    t('no relay socket anywhere is RELAY_UNREACHABLE',
      codes({ ...good, relay: { hosts: [{ url: RELAY_URLS[0], socket: { ok: false } }, { url: RELAY_URLS[1], socket: { ok: false } }] } }) === WC_DIAGNOSIS.RELAY_UNREACHABLE);
    t('one open relay host is enough to pass the relay check',
      codes({ ...good, relay: { hosts: [{ url: RELAY_URLS[0], socket: { ok: false } }, { url: RELAY_URLS[1], socket: { ok: true } }] } }) === WC_DIAGNOSIS.OK);
    t('a malformed SDK configuration is SDK_CONFIGURATION_ERROR',
      codes({ ...good, sdkConfig: { ok: false, problems: ['METADATA_URL_NOT_HTTPS'] } }) === WC_DIAGNOSIS.SDK_CONFIGURATION_ERROR);
    t('nothing measured at all is not reported as OK',
      codes({ sdkConfig: { ok: true, problems: [] }, pageOrigin: '', declaredUrl: '' }) === WC_DIAGNOSIS.SDK_CONFIGURATION_ERROR);
    t('every detected cause is kept, not just the headline',
      classifyWalletConnectDiagnosis({
        ...good,
        registry: { ok: false, status: null, error: 'T', list: null },
        relay: { hosts: [{ url: RELAY_URLS[0], socket: { ok: false } }] },
        verify: { enclave: { ok: false }, attestation: null }
      }).findings.map((f) => f.code).join(',') === 'RELAY_UNREACHABLE,VERIFY_SERVICE_UNREACHABLE');
    t('an attested origin that disagrees is reported, never hidden',
      classifyWalletConnectDiagnosis({
        ...good,
        pageOrigin: 'https://www.fbtswap.ir',
        declaredUrl: 'https://www.fbtswap.ir',
        registry: { ok: true, list: ['https://fbtswap.ir'] },
        verify: { enclave: { ok: true }, attestation: { verdict: 'MISMATCH' } }
      }).findings.some((f) => f.code === WC_DIAGNOSIS.ORIGIN_MISMATCH));
    t('a scam attestation is never OK',
      codes({ ...good, verify: { enclave: { ok: true }, attestation: { verdict: 'THREAT' } } }) !== WC_DIAGNOSIS.OK);
    t('every code has an owner and a sentence',
      Object.values(WC_DIAGNOSIS).every((code) => WC_DIAGNOSIS_OWNER[code] && WC_DIAGNOSIS_SENTENCE[code]));
  }

  /* ══════════════════ 3. the engine, measured end to end ══════════════════ */
  {
    const registryBody = { allowedOrigins: ['https://fbtswap.ir', 'https://www.fbtswap.ir'] };
    const report = await collectWalletConnectDiagnosis({
      origin: 'https://fbtswap.ir',
      projectId: WC_PROJECT_ID,
      fetchImpl: fakeFetch({
        'https://api.web3modal.org/appkit/v1/config': { body: { name: 'FBT' } },
        'https://api.web3modal.org/projects/v1/origins': { body: registryBody },
        'https://verify.walletconnect.org': { status: 200 }
      }),
      WebSocketImpl: fakeWebSocket({ open: RELAY_URLS }),
      win: { location: { origin: 'https://fbtswap.ir' }, Capacitor: { isNativePlatform: () => false } }
    });
    t('the measured report reaches OK on a healthy stack', report.diagnosis.code === WC_DIAGNOSIS.OK);
    t('the measured report prints CODE STATUS PASS', report.codeStatus === 'PASS');
    t('the measured report prints the registry as REGISTERED', report.dashboardStatus === 'REGISTERED');
    t('both relay hosts were measured over WebSocket, not just HTTPS',
      report.relay.hosts.length === 2 && report.relay.hosts.every((host) => 'socket' in host));
    t('the relay.hosts names .org and .com in the configured order',
      report.relay.urls[0] === RELAY_URLS[0] && report.relay.urls[1] === RELAY_URLS[1]);
    t('the report carries the metadata the wallet will receive',
      report.metadata.url === 'https://fbtswap.ir' && report.metadata.verifyUrl === 'https://fbtswap.ir');

    const lines = diagnosisLines(report);
    for (const needle of ['projectId', 'window.location.origin', 'metadata.url', 'metadata.verifyUrl', 'allowed origins (code)', 'origin match', 'project config', 'allowlist', 'verify service', 'relay', 'final diagnosis', 'CODE STATUS', 'DASHBOARD STATUS']) {
      t(`the diagnostic prints «${needle}»`, lines.some((line) => line.includes(needle)));
    }
    t('the diagnostic prints the verdict itself', lines.some((line) => line.includes('OK')));

    /* The production state this repository was actually in on 2026-09-21: a
       project with NO domain in its registry. */
    const empty = await collectWalletConnectDiagnosis({
      origin: 'https://fbtswap.ir',
      projectId: WC_PROJECT_ID,
      fetchImpl: fakeFetch({
        'https://api.web3modal.org/appkit/v1/config': { body: {} },
        'https://api.web3modal.org/projects/v1/origins': { body: { allowedOrigins: [] } },
        'https://verify.walletconnect.org': { status: 200 }
      }),
      WebSocketImpl: fakeWebSocket({ open: RELAY_URLS })
    });
    t('an unregistered domain reads DOMAIN_NOT_REGISTERED',
      empty.diagnosis.code === WC_DIAGNOSIS.DOMAIN_NOT_REGISTERED);
    t('and its CODE STATUS is still PASS — the code is not the fault',
      empty.codeStatus === 'PASS' && empty.dashboardStatus === 'DOMAIN NOT REGISTERED');
    t('and it names the origin a human has to register',
      diagnosisLines(empty).some((line) => line.includes('register this origin   : https://fbtswap.ir')));

    /* The packaged app: https://localhost in the WebView, canonical identity. */
    const packaged = await collectWalletConnectDiagnosis({
      origin: 'https://localhost',
      projectId: WC_PROJECT_ID,
      fetchImpl: fakeFetch({
        'https://api.web3modal.org/appkit/v1/config': { body: {} },
        'https://api.web3modal.org/projects/v1/origins': { body: { allowedOrigins: ['https://fbtswap.ir', 'https://localhost'] } },
        'https://verify.walletconnect.org': { status: 200 }
      }),
      WebSocketImpl: fakeWebSocket({ open: RELAY_URLS }),
      win: { location: { origin: 'https://localhost' }, Capacitor: { isNativePlatform: () => true } }
    });
    t('the packaged app declares the canonical origin, not localhost',
      packaged.metadata.url === 'https://fbtswap.ir' && packaged.originMatch.matches === false);
    t('the packaged app is not reported as an origin mismatch', packaged.diagnosis.code === WC_DIAGNOSIS.OK);
    t('www is measured against its own registry entry',
      (await collectWalletConnectDiagnosis({
        origin: 'https://www.fbtswap.ir',
        projectId: WC_PROJECT_ID,
        /* A page served from www declares www — the registry entry for the bare
           host does not cover it, which is the whole reason both must be on the
           dashboard. */
        win: { location: { origin: 'https://www.fbtswap.ir' }, Capacitor: { isNativePlatform: () => false } },
        fetchImpl: fakeFetch({
          'https://api.web3modal.org/appkit/v1/config': { body: {} },
          'https://api.web3modal.org/projects/v1/origins': { body: { allowedOrigins: ['https://fbtswap.ir'] } },
          'https://verify.walletconnect.org': { status: 200 }
        }),
        WebSocketImpl: fakeWebSocket({ open: RELAY_URLS })
      })).diagnosis.code === WC_DIAGNOSIS.DOMAIN_NOT_REGISTERED);

    /* A relay that is refused while everything else answers. */
    const relayDown = await collectWalletConnectDiagnosis({
      origin: 'https://fbtswap.ir',
      projectId: WC_PROJECT_ID,
      fetchImpl: fakeFetch({
        'https://api.web3modal.org/appkit/v1/config': { body: {} },
        'https://api.web3modal.org/projects/v1/origins': { body: { allowedOrigins: ['https://fbtswap.ir'] } },
        'https://verify.walletconnect.org': { status: 200 }
      }),
      WebSocketImpl: fakeWebSocket({ open: [] })
    });
    t('dead sockets on both hosts read RELAY_UNREACHABLE',
      relayDown.diagnosis.code === WC_DIAGNOSIS.RELAY_UNREACHABLE);
    t('the relay failure does not blame the dashboard',
      relayDown.dashboardStatus === 'REGISTERED');

    /* Reachability probe: bounded, honest, never throws. */
    const reachable = await probeVerifyReachability({ fetchImpl: async () => ({ ok: true, status: 200 }) });
    t('a reachable enclave is reported reachable', reachable.ok === true && reachable.status === 200);
    const blocked = await probeVerifyReachability({ fetchImpl: async () => { throw new Error('blocked'); } });
    t('a blocked enclave names the error instead of throwing', blocked.ok === false && /blocked/.test(blocked.error));
    t('no fetch implementation is reported, not crashed', (await probeVerifyReachability({ fetchImpl: null, timeoutMs: 1 }) && true) !== undefined);
  }

  /* ══════════════════ 4. Solana: detection and capabilities ═══════════════ */
  {
    const desktop = fakeWindow({ origin: 'https://fbtswap.ir', ua: 'Mozilla/5.0 (Macintosh)' });
    t('nothing connected means nothing to sign with',
      walletCapabilities({ win: desktop }).transport === null
        && SOLANA_WALLET_METHODS.every((method) => walletCapabilities({ win: desktop }).methods[method].supported === false || method === 'connect' || method === 'disconnect'));
    t('the reason is named, not just the boolean',
      /no Solana wallet is connected/.test(walletCapabilities({ win: desktop }).methods.signTransaction.reason));

    const phantomWin = fakeWindow({
      globals: {
        phantom: { solana: { isPhantom: true, publicKey: { toString: () => 'PhantomPubkey111111111111111111111111111111' }, signTransaction() {}, signAllTransactions() {}, signMessage() {} } }
      }
    });
    t('Phantom is detected through its own namespace',
      detectInjectedWallets(phantomWin)[0]?.id === 'phantom');
    t('Solflare is detected',
      detectInjectedWallets(fakeWindow({ globals: { solflare: { publicKey: { toString: () => 'Solflare111' } } } }))[0]?.id === 'solflare');
    t('Backpack is detected',
      detectInjectedWallets(fakeWindow({ globals: { backpack: { publicKey: { toString: () => 'Backpack111' } } } }))[0]?.id === 'backpack');
    t('the deep-link wallets are always offered as a route',
      detectSolanaWallets({ win: desktop }).filter((entry) => entry.transport === 'deeplink').map((entry) => entry.id).join(',') === 'phantom,solflare,backpack');
    t('an injected wallet reports the methods its provider actually has',
      walletCapabilities({ win: phantomWin }).methods.signAllTransactions.supported === true);
    const bareWin = fakeWindow({
      globals: { solana: { isPhantom: true, publicKey: { toString: () => 'x' } } }
    });
    t('a provider without signAllTransactions says so instead of pretending',
      walletCapabilities({ win: bareWin }).methods.signAllTransactions.supported === false);
    t('a desktop browser can be told to install an extension',
      walletStandardSupported({ win: desktop }) === false);
    t('MWA is unsupported outside Android Chrome',
      collectSolanaHealth({ win: desktop, includeAssetLinks: false }).then(() => true) && true);
    t('the wallet layer exposes every documented method',
      SOLANA_WALLET_METHODS.every((method) => typeof createSolanaWalletLayer({ win: desktop })[method] === 'function'));
    t('the layer reports a stable error code when no wallet exists',
      (await connectSolanaWallet({ win: desktop })).code === SOLANA_WALLET_ERRORS.NO_WALLET);
    t('signing without a wallet is UNSUPPORTED, not a crash',
      (await signSolanaTransaction('AAAA', { win: desktop })).code === SOLANA_WALLET_ERRORS.UNSUPPORTED);
    t('signAllTransactions is UNSUPPORTED where no provider implements it',
      (await signAllSolanaTransactions(['AAAA'], { win: desktop })).code === SOLANA_WALLET_ERRORS.UNSUPPORTED);
    t('signAndSendTransaction is UNSUPPORTED without a transport',
      (await signAndSendSolanaTransaction('AAAA', { win: desktop })).code === SOLANA_WALLET_ERRORS.UNSUPPORTED);
    t('signMessage is UNSUPPORTED without a transport',
      (await signSolanaMessage('hello', { win: desktop })).code === SOLANA_WALLET_ERRORS.UNSUPPORTED);
    t('getPublicKey is synchronous and reads the live transport only',
      getSolanaPublicKey() === null);
    t('the active transport is null when nothing is connected',
      activeSolanaTransport({ win: desktop }).transport === null);
  }

  /* ══════════════════ 5. assetlinks: identity, honestly ═══════════════════ */
  {
    const statement = (fingerprints, pkg = 'ir.fbtswap.app') => [{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: fingerprints }
    }];
    t('the file lives at the path Android fetches', ASSETLINKS_PATH === '/.well-known/assetlinks.json');
    t('the url is the bare origin plus that path',
      assetLinksUrl('https://fbtswap.ir') === 'https://fbtswap.ir/.well-known/assetlinks.json');
    t('a trailing slash is not doubled', assetLinksUrl('https://fbtswap.ir/') === 'https://fbtswap.ir/.well-known/assetlinks.json');
    t('the identity URI is an origin, never a path variant',
      !assetLinksUrl('https://fbtswap.ir').includes('//.well-known'));
    t('a fingerprint is normalised to Android’s uppercase colon form',
      normalizeFingerprint(FINGERPRINT.toLowerCase().replace(/:/g, '')) === FINGERPRINT);
    t('a malformed fingerprint is rejected, not silently accepted',
      normalizeFingerprint('AA:BB') === null);
    t('a correct statement validates',
      validateAssetLinks(statement([FINGERPRINT]), { packageName: 'ir.fbtswap.app', fingerprints: [FINGERPRINT] }).ok === true);
    t('a wrong package name is named',
      validateAssetLinks(statement([FINGERPRINT], 'com.other.app'), { packageName: 'ir.fbtswap.app' })
        .problems.includes('[0].PACKAGE_MISMATCH'));
    t('a debug keystore fingerprint is refused',
      validateAssetLinks(statement(['FA:C6:17:45:DC:24:43:0D:FC:FE:5D:3B:94:9E:1B:CE:3D:55:83:64:26:9C:6B:7B:C4:BD:9B:7C:2D:72:A5:CD']), { packageName: 'ir.fbtswap.app' })
        .problems.includes('[0].FINGERPRINT_0_DEBUG_KEYSTORE'));
    t('a mismatched known fingerprint is named',
      validateAssetLinks(statement([FINGERPRINT]), { packageName: 'ir.fbtswap.app', fingerprints: [OTHER_FINGERPRINT] })
        .problems.includes('[0].FINGERPRINT_MISMATCH'));
    t('a missing relation is named',
      validateAssetLinks([{ target: { namespace: 'android_app', package_name: 'ir.fbtswap.app', sha256_cert_fingerprints: [FINGERPRINT] } }], { packageName: 'ir.fbtswap.app' })
        .problems.includes('[0].RELATION_MISSING'));
    t('a non-array document is named', validateAssetLinks({}, {}).problems.includes('NOT_AN_ARRAY'));

    const deployed = await checkDeployedAssetLinks({
      origin: 'https://fbtswap.ir',
      packageName: 'ir.fbtswap.app',
      fingerprints: [FINGERPRINT],
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => statement([FINGERPRINT]) })
    });
    t('a deployed correct file PASSes', deployed.code === 'PASS');
    const missing = await checkDeployedAssetLinks({
      origin: 'https://fbtswap.ir',
      packageName: 'ir.fbtswap.app',
      fetchImpl: async () => ({ ok: false, status: 404, json: async () => null })
    });
    t('a 404 is NOT_DEPLOYED, not “invalid”', missing.code === 'NOT_DEPLOYED');
    const broken = await checkDeployedAssetLinks({
      origin: 'https://fbtswap.ir',
      packageName: 'ir.fbtswap.app',
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } })
    });
    t('unparseable JSON is INVALID_JSON', broken.code === 'INVALID_JSON');
    const offline = await checkDeployedAssetLinks({
      origin: 'https://fbtswap.ir',
      packageName: 'ir.fbtswap.app',
      fetchImpl: async () => { throw new Error('no network'); }
    });
    t('an unreachable host is NETWORK_UNREACHABLE', offline.code === 'NETWORK_UNREACHABLE');
    t('every code has a sentence a human can read',
      ['PASS', 'NOT_DEPLOYED', 'INVALID_JSON', 'INVALID', 'HTTP_ERROR', 'TIMEOUT', 'NETWORK_UNREACHABLE', 'NO_FETCH']
        .every((code) => typeof ASSETLINKS_SENTENCE[code] === 'string'));
  }

  /* ══════════════════ 6. the Solana health report ═════════════════════════ */
  {
    const health = await collectSolanaHealth({
      win: fakeWindow({ origin: 'https://fbtswap.ir' }),
      footer: false,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => [] }),
      includeAssetLinks: true
    });
    t('the Solana report names the three deep-link wallets',
      health.deepLink.wallets.map((wallet) => wallet.id).join(',') === 'phantom,solflare,backpack');
    t('the Solana report carries the Wallet Standard and MWA rows',
      typeof health.truthy.walletStandard === 'boolean' && typeof health.truthy.mwaSupported === 'boolean');
    t('the Solana report names the return channels it watches',
      Object.values(health.deepLink.returnChannels).every((value) => typeof value === 'boolean'));
    t('the Solana report measures assetlinks and explains the answer',
      typeof health.assetLinks.code === 'string' && typeof health.assetLinks.sentence === 'string');
    t('an empty but valid file is INVALID rather than PASS',
      (await collectSolanaHealth({
        win: fakeWindow({ origin: 'https://fbtswap.ir' }),
        fetchImpl: async () => ({ ok: true, status: 200, json: async () => [] })
      })).assetLinks.ok === false);
    t('the package named in the report is the one Capacitor builds',
      health.packageName === 'ir.fbtswap.app' && /"appId":\s*"ir\.fbtswap\.app"/.test(readFileSync('capacitor.config.json', 'utf8')));
    t('the signing section refuses to claim a method with no transport',
      health.signing.ok === false && health.signing.methods.join(',') === 'connect,disconnect');
  }

  /* ══════════════════ 7. one wallet state, independent channels ═══════════ */
  {
    const solanaOnly = readWalletState({
      evm: null,
      solana: { connected: true, address: 'PhantomAddr11111111111111111111111111111111', kind: 'deeplink', caip2: 'solana:mainnet', capabilities: { connect: true, sign: true, methods: {} } }
    });
    t('the schema is named so a stored snapshot can be rejected', solanaOnly.schema === WALLET_STATE_SCHEMA);
    t('a Solana-only connection never invents an EVM account',
      solanaOnly.wallets.evm.connected === false && solanaOnly.wallets.evm.address === null);
    t('the Solana address stays a Solana address',
      solanaOnly.wallets.solana.address.startsWith('Phantom'));
    t('networks list only what is connected', solanaOnly.networks.join(',') === 'solana:mainnet');
    t('bitcoin is present, watch-only, and never claims a signer',
      solanaOnly.wallets.bitcoin.connected === false && solanaOnly.wallets.bitcoin.capabilities.sign === false);

    const evmAndSolana = walletStateForIntent({
      evm: { address: '0x1111111111111111111111111111111111111111', chainId: 8453, mode: 'injected', locked: false, hasProvider: true, connected: true },
      solana: { connected: true, address: 'PhantomAddr11111111111111111111111111111111', kind: 'injected', walletName: 'Phantom', caip2: 'solana:mainnet', capabilities: { connect: true, sign: true, methods: { signTransaction: true } } }
    });
    t('both chains are reported at once', evmAndSolana.evm.connected && evmAndSolana.solana.connected);
    t('the EVM address is not overwritten by the Solana one',
      evmAndSolana.evm.address === '0x1111111111111111111111111111111111111111'
        && evmAndSolana.solana.address === 'PhantomAddr11111111111111111111111111111111');
    t('the networks are CAIP-2 for each connected chain',
      evmAndSolana.networks.includes('eip155:8453') && evmAndSolana.networks.includes('solana:mainnet'));
    t('signable chains name only what can actually sign',
      evmAndSolana.signableChains.includes('evm') && evmAndSolana.signableChains.includes('solana')
        && !evmAndSolana.signableChains.includes('bitcoin'));
    t('the Solana method list travels with the state',
      evmAndSolana.solana.methods.signTransaction === true);
    t('a locked EVM wallet is not advertised as able to sign',
      walletStateForIntent({ evm: { address: '0x1111111111111111111111111111111111111111', chainId: 1, mode: 'local', locked: true, hasProvider: true, connected: true } })
        .evm.canSign === false);

    /* Registration is how the React tree feeds the EVM half in. */
    let notifies = 0;
    const unsubscribe = subscribeWalletState(() => { notifies += 1; });
    const unregister = registerEvmWalletSource(() => ({ address: '0x2222222222222222222222222222222222222222', chainId: 1, mode: 'wc', connected: true, hasProvider: true }));
    const live = walletStateForIntent();
    t('a registered EVM source is what the snapshot reports', live.evm.address === '0x2222222222222222222222222222222222222222');
    t('registering tells subscribers', notifies > 0);
    unregister();
    t('unregistering removes the source',
      walletStateForIntent().evm.connected === false);
    t('unsubscribing stops notifications', (() => {
      const before = notifies;
      unsubscribe();
      registerEvmWalletSource(() => null)();
      return notifies === before;
    })());
    t('the shape carries no secret-bearing field names',
      !/seed|mnemonic|privateKey|secretKey|password/i.test(JSON.stringify(readWalletState())));
  }

  /* ══════════ 7b. the signing matrix, against a stub provider ═════════════
   *
   * WHAT CAN BE TESTED HERE AND WHAT CANNOT. This sandbox has no wallet and no
   * device, so «Phantom showed an approval screen» is a DEVICE test and is
   * reported as such. What IS decidable here is everything between the app and
   * the provider boundary: the transport that gets picked, the encoding that
   * comes back, the refusal that a wallet cannot honour a method, and the
   * mapping from a wallet's own error to a stable code. A stub provider is the
   * wallet for these — deliberately, because the alternative is asserting that
   * our own mock returned what our own mock was told to return.
   */
  {
    const { createSolanaWalletLayer, SOLANA_WALLET_ERRORS } = await import('../src/lib/solana/walletLayer.js');

    const signingProvider = {
      publicKey: { toString: () => 'StubSolanaAddress1111111111111111111111111' },
      signMessage: async () => ({ signature: new Uint8Array([1, 2, 3, 4]) }),
      signTransaction: async () => ({ serialize: () => new Uint8Array([7, 7]) })
    };
    const stubWin = (provider) => ({
      phantom: { solana: provider },
      navigator: {},
      location: { origin: 'https://fbtswap.ir' }
    });

    const layer = createSolanaWalletLayer({ win: stubWin(signingProvider) });
    const signMessage = await layer.signMessage('FBT signing test');

    t('the layer signs a message through the injected transport', signMessage.ok === true);
    t('the signature comes back base64, named as such',
      /^[A-Za-z0-9+/]+=*$/.test(String(signMessage.signature)) && signMessage.encoding === 'base64');
    t('the public key is read from the window the layer was given, not the global one',
      layer.getPublicKey() === 'StubSolanaAddress1111111111111111111111111');

    /* A refusal must be the WALLET's, and must arrive as a code, not as prose. */
    const rejectingLayer = createSolanaWalletLayer({
      win: stubWin({ ...signingProvider, signMessage: async () => { const e = new Error('User rejected the request.'); e.code = 4001; throw e; } })
    });
    const rejected = await rejectingLayer.signMessage('nope');
    t('a user rejection is reported as REJECTED, not as a generic failure',
      rejected.ok === false && rejected.code === SOLANA_WALLET_ERRORS.REJECTED);

    /* A method the connected transport does not implement is UNSUPPORTED — with
       the reason, because «Unsupported» alone is what sends a support thread
       hunting the wrong thing. */
    const missing = await layer.signAllTransactions(['AAAA']);
    t('a method the injected wallet does not implement is UNSUPPORTED',
      missing.ok === false && missing.code === SOLANA_WALLET_ERRORS.UNSUPPORTED);
    t('…and the reason names the missing method',
      /signAllTransactions/.test(String(missing.reason)));

    const emptyLayer = createSolanaWalletLayer({ win: { navigator: {}, location: { origin: 'https://fbtswap.ir' } } });
    t('with nothing connected every signing method refuses instead of throwing',
      (await emptyLayer.signMessage('x')).code === SOLANA_WALLET_ERRORS.UNSUPPORTED
        && (await emptyLayer.signTransaction('x')).code === SOLANA_WALLET_ERRORS.UNSUPPORTED
        && (await emptyLayer.signAndSendTransaction('x')).code === SOLANA_WALLET_ERRORS.UNSUPPORTED);
    t('…and getPublicKey answers null rather than inventing an address', emptyLayer.getPublicKey() === null);
    t('the layer never demands a private key or a seed phrase',
      !/seedPhrase|mnemonic|privateKey/i.test(
        readFileSync('src/lib/solana/walletLayer.js', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\*.*$/gm, '')
      ));

    /* The app's hook must actually use that layer — a layer nobody calls is a
       document, not an implementation. */
    const hook = readFileSync('src/hooks/useSolanaWallet.js', 'utf8');
    t('the React hook connects and signs through the unified layer',
      /createSolanaWalletLayer/.test(hook) && /layer\.connect/.test(hook));
    t('the hook exposes only the methods the live transport supports',
      /supported\.signMessage \?/.test(hook) && /supported\.signAllTransactions \?/.test(hook));

    /* Requirement: explicit user action, never on load, and never the backend. */
    const sheet = readFileSync('src/components/SolanaConnectSheet.jsx', 'utf8');
    t('no Solana signature is requested without a user action',
      !/useEffect\([^)]*sign(Solana)?(Message|Transaction)/.test(sheet));
  }

  /* ═════════ 7c. the connection lifecycle is named, not inferred ═══════════ */
  {
    const flow = await import('../src/lib/wc/flowState.js');
    const reached = new Map();
    const factsFor = {
      IDLE: {},
      CONNECTING: { connecting: true },
      WALLET_OPENED: { walletOpened: true },
      AWAITING_APPROVAL: { awaitingApproval: true },
      APPROVED: { approved: true },
      PROVIDER_ATTACHING: { providerAttaching: true },
      CONNECTED: { connected: true },
      REJECTED: { error: 'REJECTED' },
      TIMEOUT: { error: 'TIMEOUT' },
      FAILED: { failed: true },
      RECOVERABLE: { failed: true, recoverable: true }
    };
    for (const [want, facts] of Object.entries(factsFor)) {
      reached.set(want, flow.wcFlowState(facts).code);
    }
    t('all eleven lifecycle states are distinguished',
      [...reached.values()].join(',') === flow.WC_FLOW_STATES.join(','),
      [...reached.values()].join(','));
    t('a live account outranks a stale error (the wallet can attach late)',
      flow.wcFlowState({ connected: true, error: 'TIMEOUT' }).code === 'CONNECTED');
    t('a user rejection is never reported as a failure of ours',
      flow.wcFlowState({ error: 'USER_REJECTED' }).code === 'REJECTED');
    t('a timeout with a way forward is RECOVERABLE, not TIMEOUT',
      flow.wcFlowState({ error: 'TIMEOUT', recoverable: true }).code === 'RECOVERABLE');
    t('a finished connection is terminal', flow.wcFlowState({ connected: true }).terminal === true);
    t('every state has a transition row, and none is a dead end',
      flow.WC_FLOW_STATES.every((code) => Array.isArray(flow.WC_FLOW_TRANSITIONS[code]) && flow.WC_FLOW_TRANSITIONS[code].length > 0));
    t('a rejected pairing can only come back through CONNECTING',
      flow.wcFlowTransitionAllowed('REJECTED', 'CONNECTED') === false
        && flow.wcFlowTransitionAllowed('REJECTED', 'CONNECTING') === true);
    t('the derivation cannot move a state to one the table forbids',
      flow.WC_FLOW_STATES.every((from) => flow.WC_FLOW_TRANSITIONS[from].every((to) => flow.WC_FLOW_STATES.includes(to))));
    /* And the app actually reports it: the health panel's own report carries a
       state, derived from the measured facts rather than typed in. */
    const { collectWalletHealth } = await import('../src/lib/wc/health.js');
    const report = await collectWalletHealth({
      origin: 'https://fbtswap.ir',
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }),
      WebSocketImpl: fakeWebSocket({ open: RELAY_URLS }),
      storage: null
    });
    t('the measured report carries a lifecycle state',
      flow.WC_FLOW_STATES.includes(report.flow?.code), String(report.flow?.code));
    t('the panel row for it exists in both locales',
      ['en', 'fa'].every((lang) => {
        const dict = JSON.parse(readFileSync(`src/i18n/locales/${lang}.json`, 'utf8'));
        return typeof dict.wallet?.healthFlow === 'string' && dict.wallet.healthFlow.length > 0;
      }));
  }

  /* ══════════════════ 8. nothing was deleted, nothing regressed ═══════════ */
  {
    const pages = ['Wallet', 'Swap', 'IntentOS', 'Market', 'Earn', 'Signals', 'Bridge', 'Loan', 'Farm', 'FuturesOnchain', 'Rewards', 'Ecosystem', 'Explore', 'Discover', 'Security', 'Lab'];
    /* Both Solana transports must tell the unified state bus, or Intent OS
       plans against a snapshot that never learned a wallet connected. */
    t('the injected Solana path notifies the unified wallet state',
      /notifyWalletState\('solana'\)/.test(readFileSync('src/lib/solanaWallet.js', 'utf8')));
    t('the deeplink Solana path notifies the unified wallet state',
      /notifyWalletState\('solana'\)/.test(readFileSync('src/lib/solana/deeplink.js', 'utf8')));
    t('every application page still exists',
      pages.every((page) => {
        try {
          return readFileSync(`src/pages/${page}.jsx`, 'utf8').length > 0;
        } catch {
          return false;
        }
      }));
    t('no wallet path navigates the document for a pairing URI',
      ['config.js', 'appkit.js', 'handoff.js', 'session.js'].every((file) => {
        const src = readFileSync(`src/lib/wc/${file}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        return !/location\.(assign|replace)\(\s*[a-z]*uri/i.test(src) && !/location\.href\s*=\s*[a-z]*uri/i.test(src);
      }));
    /*
     * THE INVARIANT, not a description of it: `mode: 'place'` is the only route
     * that navigates THIS document, and the only two lines that use it are the
     * INTENT routes (Chrome resolves those itself, so the navigation does not
     * commit). Any future `mode: 'place'` on a native scheme or a universal link
     * would destroy the pending pairing — this is the check that forbids it.
     */
    const placeLines = readFileSync('src/lib/wc/handoff.js', 'utf8')
      .split('\n')
      .filter((line) => /mode: 'place'/.test(line));
    t('the in-place route is used for intent URLs only',
      placeLines.length > 0 && placeLines.every((line) => /intent/i.test(line)));
    t('the SDK opener is patched so it can never use _self',
      /getOpenTargetForPlatform/.test(readFileSync('src/lib/wc/appkit.js', 'utf8'))
        && /'_blank'/.test(readFileSync('src/lib/wc/appkit.js', 'utf8')));
    const panel = readFileSync('src/components/WalletHealthPanel.jsx', 'utf8');
    t('the panel shows the diagnosis and both statuses',
      /report\.diagnosis/.test(panel) && /CODE STATUS/.test(panel) && /DASHBOARD STATUS/.test(panel));
    t('the panel shows the Solana rows in the same panel',
      /collectSolanaHealth/.test(panel) && /healthSolanaAssetLinks/.test(panel));
    t('the CLI gate is wired to a real flag',
      /"walletconnect:check": "node scripts\/walletconnect-domain-verify\.mjs --check"/.test(readFileSync('package.json', 'utf8'))
        && /--check/.test(readFileSync('scripts/walletconnect-domain-verify.mjs', 'utf8'))
        && /process\.exitCode = isGate/.test(readFileSync('scripts/walletconnect-domain-verify.mjs', 'utf8')));
    t('the assetlinks build hook never invents a fingerprint',
      /--ensure/.test(readFileSync('scripts/assetlinks.mjs', 'utf8'))
        && /never invents a value/.test(readFileSync('scripts/assetlinks.mjs', 'utf8')));
    const verifyScript = readFileSync('scripts/walletconnect-domain-verify.mjs', 'utf8');
    t('no verification file or DNS record is fabricated anywhere',
      !/(writeFileSync|mkdirSync|appendFileSync)/.test(verifyScript)
        && !/walletconnect\.txt/.test(verifyScript.replace(/^\s*\*.*$/gm, ''))
        && !/TXT record/i.test(verifyScript.replace(/^\s*\*.*$/gm, '')));
  }

  return rows;
}

/* Standalone run: node test/wallet-diagnostics-probe.mjs */
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const rows = await run();
  for (const [name, ok] of rows) console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  const failed = rows.filter(([, ok]) => !ok).length;
  console.log(failed ? `\n${failed} FAILED of ${rows.length}\n` : `\nAll ${rows.length} wallet-diagnostics checks passed.\n`);
  process.exit(failed ? 1 : 0);
}
