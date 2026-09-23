/**
 * THE SOLANA WALLET HEALTH REPORT.
 * ---------------------------------------------------------------------------
 * The EVM half of the health panel already measures the links a report cannot
 * show (project registry, relay sockets, the Verify enclave). The Solana half
 * had no such thing, so the report «وصل نمیشه» arrived without the four facts
 * that decide it:
 *
 *   · is there an INJECTED provider (extension, or the wallet's own browser)?
 *   · can MOBILE WALLET ADAPTER complete on this device (Android Chrome only)?
 *   · is a DEEP LINK session live, and is a request still owed an answer?
 *   · can Phantom/MWA verify our APP IDENTITY — is `.well-known/assetlinks.json`
 *     deployed and does it match this package?
 *   · can this device READ THE CHAIN at all — which door answers (a public node
 *     or our own backend), what it cost, and the NAMED reason when neither does?
 *
 * The last one was added with the 2026-09-23 report «برای امضا و خرید با سولانا
 * در بیشتر اوقات می‌زنه موجودی کیف پول کم یا RPC را چک کنید»: the connection was
 * provably fine and the failure was in the balance read that gates signing, which
 * the report could not see. A panel that measures everything except the thing
 * that is broken sends the next report down the same dead end.
 *
 * Plus the one sentence the user needs before signing: which SIGNING methods the
 * connected transport actually implements.
 *
 * Everything here is a measurement. Nothing is inferred from a label, and
 * nothing claims a capability that was not detected — see
 * `lib/solana/walletLayer.js`, whose capability report is reused verbatim.
 */

import { publicAppUrl } from '../nativeShell.js';
import { canInjectSolana, canUseMwa, getMwaWallet, getSolanaProvider, getStandardWallets, solanaWalletName } from '../solanaWallet.js';
import { deeplinkSession, deeplinkState, deeplinkWalletOptions, pendingDeeplinkRequest } from './deeplink.js';
import { activeSolanaTransport, detectSolanaWallets, walletCapabilities } from './walletLayer.js';
import {
  ASSETLINKS_PATH,
  ASSETLINKS_SENTENCE,
  checkDeployedAssetLinks,
  normalizeFingerprint
} from './assetlinks.js';
import { readSolanaSwapBalances } from './balanceSource.js';
import { SOL_MINT } from './chainReads.js';
import { lamportsToSol } from './swapPreflight.js';

/** The package name this Android build ships — read from the Capacitor config. */
export const SOLANA_ANDROID_PACKAGE = 'ir.fbtswap.app';

/** The three wallets with a documented deep-link protocol, as booleans. */
export function walletDetection({ win } = {}) {
  const w = win ?? (typeof window !== 'undefined' ? window : null);
  const wallets = detectSolanaWallets({ win: w });
  const injected = wallets.filter((entry) => entry.transport === 'injected').map((entry) => entry.id);
  const standard = wallets.filter((entry) => entry.transport === 'standard').map((entry) => entry.id);
  const provider = getSolanaProvider();
  return {
    phantom: Boolean(injected.includes('phantom') || /phantom/i.test(String(provider?.isPhantom ? 'phantom' : ''))),
    solflare: Boolean(injected.includes('solflare')),
    backpack: Boolean(injected.includes('backpack')),
    injected,
    standard,
    /* A deep link needs no installed wallet to be *offered* — the wallet app is
       launched by the OS — so this is an availability fact, not a detection. */
    deeplink: deeplinkWalletOptions().map((option) => option.id)
  };
}

const shortHost = (url) => {
  try { return new URL(String(url)).hostname; } catch { return String(url || '').slice(0, 40) || null; }
};

/**
 * Measure the read that gates every signature: what does this wallet hold?
 *
 * One `getBalance` (SOL→SOL, so no token query is made) through the same two
 * doors the swap screen uses, timed. It reports WHICH door answered and what it
 * cost, or the named reason neither did, with the per-host list — «blocked» and
 * «throttled» have different remedies and only one is fixed by retrying.
 *
 * Never throws: a measurement that can throw turns a health report into a
 * second failure to diagnose.
 *
 * @returns {Promise<object>}
 */
export async function measureSolanaChainRead(address) {
  const started = Date.now();
  if (!address) return { ok: false, code: 'NOT_MEASURED', reason: 'NO_ADDRESS', ms: 0 };
  try {
    const r = await readSolanaSwapBalances({ owner: address, inputMint: SOL_MINT, outputMint: SOL_MINT });
    const ms = Date.now() - started;
    if (r?.ok) {
      return {
        ok: true,
        ms,
        /* 'rpc' = a public node answered this device directly; 'server' = the
           nodes did not and our own backend did, which is the fact that decides
           whether a swap can be pre-checked on this network at all. */
        via: r.via,
        host: shortHost(r.url),
        calls: Number(r.calls) || 0,
        solLamports: String(r.solLamports),
        sol: lamportsToSol(typeof r.solLamports === 'bigint' ? r.solLamports : 0n)
      };
    }
    return {
      ok: false,
      ms,
      code: r?.code || 'RPC_UNAVAILABLE',
      hosts: r?.hosts ?? [],
      detail: r?.detail ?? null,
      serverTried: r?.serverTried === true,
      serverCode: r?.serverCode ?? null
    };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, code: 'READ_FAILED', detail: String(err?.message || err || '').slice(0, 160) };
  }
}

/**
 * The whole Solana report. Never throws.
 *
 * @param {object} [options]
 * @param {Window} [options.win]
 * @param {Function} [options.fetchImpl]
 * @param {string} [options.origin]      where assetlinks.json is expected
 * @param {string[]} [options.fingerprints] known signing certificate(s), when available
 */
export async function collectSolanaHealth({
  win,
  fetchImpl,
  origin,
  fingerprints = [],
  timeoutMs = 8_000,
  includeAssetLinks = true,
  includeChainRead = true
} = {}) {
  const w = win ?? (typeof window !== 'undefined' ? window : null);
  const appOrigin = String(origin ?? publicAppUrl('/')).replace(/\/+$/, '');
  const detection = walletDetection({ win: w });
  const active = activeSolanaTransport({ win: w });
  const capabilities = walletCapabilities({ win: w });
  const methods = {};
  for (const [name, value] of Object.entries(capabilities.methods ?? {})) {
    methods[name] = { supported: Boolean(value?.supported), reason: value?.reason ?? null };
  }
  const pending = pendingDeeplinkRequest();
  const session = deeplinkSession();
  const flow = deeplinkState();

  const assetLinks = includeAssetLinks
    ? await checkDeployedAssetLinks({
      origin: appOrigin,
      packageName: SOLANA_ANDROID_PACKAGE,
      fingerprints: (fingerprints ?? []).map(normalizeFingerprint).filter(Boolean),
      fetchImpl,
      timeoutMs
    })
    : { ok: false, code: 'NOT_MEASURED', url: `${appOrigin}${ASSETLINKS_PATH}` };

  /* The chain read is measured only for a connected address: without one there
     is nothing to read, and inventing a probe address would measure a wallet
     that is not the user's. */
  const chainRead = includeChainRead
    ? await measureSolanaChainRead(active.address ?? null)
    : { ok: false, code: 'NOT_MEASURED', reason: 'SKIPPED', ms: 0 };

  const truthy = {
    walletStandard: getStandardWallets().length > 0,
    mwaSupported: canUseMwa(),
    mwaRegistered: Boolean(getMwaWallet()),
    injected: Boolean(getSolanaProvider()),
    extensionPossible: canInjectSolana(),
    deeplinkSession: Boolean(session),
    pendingRequest: Boolean(pending)
  };
  const supportedMethods = Object.entries(methods).filter(([, v]) => v.supported).map(([k]) => k);

  return {
    at: new Date().toISOString(),
    origin: appOrigin,
    packageName: SOLANA_ANDROID_PACKAGE,
    transport: active.transport,
    walletId: active.walletId,
    walletName: active.name ?? solanaWalletName(),
    address: active.address ?? null,
    detection,
    truthy,
    capabilities: methods,
    supportedMethods,
    deepLink: {
      wallets: deeplinkWalletOptions(),
      pending: pending
        ? { id: pending.id, walletId: pending.walletId, op: pending.op, createdAt: pending.createdAt ?? null }
        : null,
      session: session ? { walletId: session.walletId, address: session.address, expiresAt: session.expiresAt ?? null } : null,
      returnState: flow?.status ?? 'idle',
      /* The three moments the return flow can be lost, named. */
      returnChannels: {
        boot: true,
        nativeBridge: Boolean(w?.FBTDeepLink),
        visibility: typeof w?.addEventListener === 'function',
        storage: typeof w?.addEventListener === 'function'
      }
    },
    assetLinks: {
      ok: Boolean(assetLinks.ok),
      code: assetLinks.code,
      url: assetLinks.url,
      status: assetLinks.status ?? null,
      problems: assetLinks.problems ?? [],
      sentence: ASSETLINKS_SENTENCE[assetLinks.code] ?? null
    },
    chainRead,
    signing: {
      ok: supportedMethods.includes('signTransaction') || supportedMethods.includes('signAndSendTransaction'),
      methods: supportedMethods,
      /* Named rather than silent: a wallet that cannot signAllTransactions is a
         fact the caller has to plan around, not a runtime surprise. */
      unsupported: Object.entries(methods).filter(([, v]) => !v.supported).map(([k, v]) => `${k}: ${v.reason ?? 'unsupported'}`)
    }
  };
}
