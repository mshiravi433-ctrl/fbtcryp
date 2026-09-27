/**
 * dYdX CHAIN — wallet-derived, non-custodial order path with Builder Codes.
 *
 * The user's EVM wallet signs the official dYdX onboarding typed data. The
 * signature deterministically derives the dYdX Chain signing key in memory;
 * no mnemonic/private key is persisted or sent to our server. The protocol
 * client signs and broadcasts directly to a dYdX validator.
 *
 * SECURITY: v4-client-js is pinned EXACTLY to 3.4.0. Versions 3.4.1, 1.22.1,
 * 1.15.2 and 1.0.31 were compromised in the Jan 2026 npm supply-chain attack.
 * 3.4.0 is the preceding official GitHub release, its tarball was scanned for
 * the published IOC before being admitted, and package.json deliberately uses
 * no caret so an install can never float onto a poisoned/new release.
 */

export const DYDX_BUILDER_ADDRESS = 'dydx17493m25rh59j2sf2525r49htr2cva5rqnf76r7';
export const DYDX_BUILDER_FEE_PPM = 1000; // 10 bps = 1000 ppm (dYdX allows up to 10 000 ppm)
/* Kept for the server-side documentation and diagnostics; browser reads use
   the same-origin proxy below so the indexer never has to satisfy CORS. */
export const DYDX_INDEXER = 'https://indexer.dydx.trade';
import { apiBase } from './apiBase.js';

/*
 * THE API ORIGIN IS NOT A CONSTANT ANY MORE.
 *
 * This used to read `import.meta.env?.VITE_API_BASE || '/api'`. That is the
 * exact expression lib/apiBase.js was written to replace, and it is wrong in
 * one place only — but the place that matters: inside the packaged Android
 * app the WebView serves the bundle from https://localhost, so a relative
 * '/api' resolves to the phone's OWN static asset server and every request
 * 404s. On the website the same expression is correct (same origin), which is
 * precisely why these modules looked fine and quietly died in the APK.
 *
 * apiBase() answers the question once: VITE_API_BASE when it is a usable
 * absolute origin, the canonical origin inside the native shell, '/api'
 * everywhere else.
 */
const API_BASE = apiBase();

let session = null;
let clientPromise = null;

const timeoutFetch = async (url, options = {}, timeout = 12000) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal, headers: { accept: 'application/json', ...(options.headers || {}) } });
    if (!res.ok) throw new Error(`HTTP_${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
};

/** Bech32 shape guard; the official client performs the checksum validation. */
export const isDydxAddress = (value) => /^dydx1[02-9ac-hj-np-z]{38}$/.test(String(value || '').toLowerCase());

export function dydxFeeUsd(notional) {
  const n = Number(notional);
  if (!Number.isFinite(n) || n <= 0) return null;
  return (n * DYDX_BUILDER_FEE_PPM) / 1_000_000;
}

const normaliseMarket = (m) => ({
  ticker: m.ticker,
  status: m.status,
  oraclePrice: Number(m.oraclePrice),
  priceChange24H: Number(m.priceChange24H || 0),
  volume24H: Number(m.volume24H || 0),
  openInterest: Number(m.openInterest || 0),
  nextFundingRate: Number(m.nextFundingRate || 0),
  atomicResolution: Number(m.atomicResolution),
  quantumConversionExponent: Number(m.quantumConversionExponent),
  stepBaseQuantums: Number(m.stepBaseQuantums),
  subticksPerTick: Number(m.subticksPerTick),
  clobPairId: String(m.clobPairId),
  raw: m
});

/** Public market metadata through our same-origin CORS proxy. */
export async function getDydxMarkets() {
  try {
    const body = await timeoutFetch(`${API_BASE}/dydx/markets`);
    const values = Array.isArray(body?.markets)
      ? body.markets
      : Object.values(body?.markets || {});
    const markets = values
      .map(normaliseMarket)
      .filter((m) => m.ticker && Number.isFinite(m.oraclePrice) && m.oraclePrice > 0);
    return { markets, live: markets.length > 0 };
  } catch {
    /*
     * ─── NO OFFLINE CATALOGUE ─────────────────────────────────────────────
     * Futures Engine v3 rule: no fabricated markets, prices or funding on a
     * leveraged screen, ever. An unreachable indexer is reported as exactly
     * that (`unavailable: true`, empty list) and the page shows its honest
     * "indexer unavailable — orders disabled" state instead of a demo list a
     * user could mistake for a market.
     */
    return { markets: [], live: false, unavailable: true };
  }
}

/**
 * Historical candles through the same proxy.
 *
 * Added because the dYdX screen asked someone to size a leveraged position
 * from a single oracle price and an open-interest number — the two least
 * informative figures on the page — with no view of how the market had moved.
 *
 * Returns `{ candles, live, resolution }` and NEVER throws: a chart that can
 * crash the page it decorates is worse than no chart. `live: false` plus an
 * empty array is the honest answer when the indexer is unreachable, and the
 * component says so instead of drawing a flat line at zero.
 */
export async function getDydxCandles(ticker, resolution = '1HOUR', limit = 96) {
  const safe = /^[A-Z0-9]+-[A-Z0-9]+$/.test(String(ticker || '')) ? String(ticker).toUpperCase() : '';
  if (!safe) return { candles: [], live: false, ticker: null, resolution };
  try {
    const body = await timeoutFetch(
      `${API_BASE}/dydx/candles?ticker=${encodeURIComponent(safe)}&resolution=${encodeURIComponent(resolution)}&limit=${Number(limit) || 96}`
    );
    const candles = Array.isArray(body?.candles) ? body.candles : [];
    return {
      candles,
      live: candles.length > 1,
      ticker: safe,
      resolution: body?.resolution || resolution
    };
  } catch {
    /* No synthetic candles either: an empty series makes the chart say
       "indexer did not return candles" — a claim about us, not the market. */
    return {
      candles: [],
      live: false,
      unavailable: true,
      ticker: safe,
      resolution
    };
  }
}

/** Public orderbook data through our same-origin CORS proxy. */
export async function getDydxOrderbook(ticker) {
  if (!/^[A-Z0-9]+-[A-Z0-9]+$/.test(String(ticker || ''))) return { live: false };
  try {
    const body = await timeoutFetch(`${API_BASE}/dydx/orderbook/${encodeURIComponent(ticker)}`);
    const bids = Array.isArray(body?.bids) ? body.bids : [];
    const asks = Array.isArray(body?.asks) ? body.asks : [];
    const bestBid = Number(bids[0]?.price);
    const bestAsk = Number(asks[0]?.price);
    const mid = (bestBid + bestAsk) / 2;
    const sum = (rows) => rows.reduce((n, r) => {
      const p = Number(r.price); const s = Number(r.size);
      return Number.isFinite(p) && Number.isFinite(s) && mid > 0 && Math.abs(p / mid - 1) <= 0.01 ? n + p * s : n;
    }, 0);
    return {
      live: Number.isFinite(mid) && mid > 0,
      bestBid, bestAsk,
      spreadBps: mid > 0 ? ((bestAsk - bestBid) / mid) * 10_000 : null,
      bidDepth1Pct: sum(bids), askDepth1Pct: sum(asks)
    };
  } catch {
    return { live: false };
  }
}

/** Public subaccount data through our same-origin CORS proxy. */
export async function getDydxSubaccount(address, number = 0) {
  if (!isDydxAddress(address)) return { account: null, live: false };
  try {
    const account = await timeoutFetch(
      `${API_BASE}/dydx/account/${encodeURIComponent(address)}/${encodeURIComponent(number)}`
    );
    return { account, live: true };
  } catch (err) {
    /* An unfunded derived address is a legitimate empty account. */
    if (String(err?.message).includes('HTTP_404')) return { account: null, live: true };
    return { account: null, live: false };
  }
}

async function loadClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      /* The official client and CosmJS expect Buffer. Keep it inside this lazy
         chunk so users who never open dYdX do not pay for the polyfill. */
      if (!globalThis.Buffer) {
        const { Buffer } = await import('buffer');
        globalThis.Buffer = Buffer;
      }
      return import('@dydxprotocol/v4-client-js');
    })();
  }
  return clientPromise;
}

/*
 * ─── THE ONBOARDING SIGNATURE — WHY IT IS ON ETHEREUM, AND WHY IT IS RAW ───
 * The report: «اتصال dYdX → could not coalesce error (WALLET_RETURNED_UNSIGNED)
 * … eth_signTypedData_v4 … "chainId":"0x1"».
 *
 * dYdX derives the Chain key from a signature over EIP-712 typed data whose
 * domain is `{ name: 'dYdX Chain', chainId: 1 }`. The `chainId: 1` is not
 * negotiable — it is part of what is signed, and a different value derives a
 * different dYdX account from the one dydx.trade shows for the same wallet.
 *
 * The app's default network is BNB Chain (56), so the wallet was on 56 and
 * WalletConnect tagged the request `eip155:56` — while the domain inside it
 * said chain 1. Wallets refuse that mismatch (MetaMask: «Provided chainId
 * must match the active chainId»; Trust and most mobile wallets drop it
 * without drawing a prompt). The user saw the wallet open with nothing to
 * sign, came back, and the signing guard reported WALLET_RETURNED_UNSIGNED
 * through ethers' «could not coalesce error». That code was only a timeout
 * heuristic, not proof of an unsigned return. The guard now retains the
 * pending request across app switches so relay recovery can deliver it.
 *
 * dydx.trade itself switches the wallet to Ethereum before asking (v4-web
 * `useMatchingEvmNetwork` in its key-generation step). So does this, now:
 *
 *   1. move the wallet to Ethereum mainnet (a WalletConnect session that
 *      already approved eip155:1 switches locally, with no extra prompt);
 *   2. send the typed data RAW over EIP-1193, with `chainId` as the JSON number
 *      1 — byte-for-byte the payload viem/wagmi send for dydx.trade — instead
 *      of ethers' hex-string "0x1", which some wallets parse differently;
 *   3. verify the signature recovers to the connected address before a key is
 *      derived from it, so a wallet that signed something else can never
 *      silently produce a different dYdX account;
 *   4. put a WalletConnect wallet back on the network it came from (a local,
 *      prompt-free switch for an approved chain).
 */
export const DYDX_ONBOARDING_CHAIN_ID = 1;

export function dydxOnboardingTypedData() {
  return {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'chainId', type: 'uint256' }
      ],
      dYdX: [{ name: 'action', type: 'string' }]
    },
    domain: { name: 'dYdX Chain', chainId: DYDX_ONBOARDING_CHAIN_ID },
    primaryType: 'dYdX',
    message: { action: 'dYdX Chain Onboarding' }
  };
}

/** A coded error the page can translate (see `dydx.err.*`). */
const dydxError = (code, cause) => {
  const error = new Error(code);
  error.code = code;
  error.dydx = true;
  if (cause) error.cause = cause;
  return error;
};

const withTimeout = (pending, ms, code) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(dydxError(code)), ms);
    Promise.resolve(pending).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const parseChainId = (raw) => {
  if (raw == null) return null;
  const text = String(raw);
  const n = text.startsWith('eip155:')
    ? Number(text.slice(7))
    : /^0x/i.test(text) ? parseInt(text, 16) : Number(text);
  return Number.isInteger(n) && n > 0 ? n : null;
};

async function readChainId(provider) {
  try {
    const hex = await withTimeout(provider.request({ method: 'eth_chainId' }), 8_000, 'CHAIN_READ_TIMEOUT');
    const n = parseChainId(hex);
    if (n) return n;
  } catch { /* fall back to the provider's own field */ }
  return parseChainId(provider?.chainId);
}

/**
 * Collapse every shape a wallet failure arrives in — a signing-guard code, an
 * EIP-1193 `{code:4001}`, an ethers «could not coalesce error» wrapping either
 * — into one code for `dydx.err.*`.
 */
export function classifyDydxError(error) {
  if (!error) return 'CONNECT_FAILED';
  const layers = [error, error.error, error.info?.error, error.cause, error.data?.originalError].filter(Boolean);
  const codes = layers.map((e) => e?.code).filter((c) => c != null).map(String);
  const text = layers.map((e) => String(e?.message ?? e?.shortMessage ?? '')).join(' | ');
  const has = (re) => codes.some((c) => re.test(c)) || re.test(text);

  if (error.dydx && error.code) return error.code;
  if (codes.includes('4001') || codes.includes('ACTION_REJECTED') || /user rejected|user denied|rejected by user|request rejected|cancell?ed by user|user cancell?ed/i.test(text)) {
    return 'REJECTED';
  }
  if (has(/WALLET_RETURNED_UNSIGNED/)) return 'RETURNED_UNSIGNED';
  if (has(/WALLET_NO_RESPONSE/)) return 'NO_RESPONSE';
  if (has(/WALLET_CHAIN_NOT_APPROVED|WALLET_CHAIN_UNAPPROVED|must match the active chain|chainid.*(mismatch|match)|unsupported chain/i)) {
    return 'NEEDS_ETHEREUM';
  }
  if (has(/WALLET_SESSION_GONE|WALLET_RELAY_DOWN|WALLET_NO_ACCOUNT|session not found|no matching key/i)) return 'SESSION_GONE';
  if (has(/WALLET_METHOD_UNAPPROVED|method not (found|supported)|unsupported .*method|4200/i)) return 'METHOD_UNSUPPORTED';
  if (has(/NO_SIGNER/)) return 'NO_SIGNER';
  return 'CONNECT_FAILED';
}

/**
 * Ask the connected EVM wallet for the dYdX onboarding signature.
 *
 * @param {object}   options
 * @param {() => object} options.getProvider  the live EIP-1193 provider (read
 *        through a function: a local vault rebuilds its adapter on a switch)
 * @param {string}   [options.address]       the connected EVM address
 * @param {(chainId:number) => Promise<boolean>} [options.switchChain]
 * @param {boolean}  [options.requireChain=true]  false for the in-app vault,
 *        whose local signer has no «active chain» to disagree with
 * @param {boolean}  [options.restoreChain=false] put the wallet back afterwards
 * @param {(stage:'switch'|'sign'|'derive') => void} [options.onStage]
 * @returns {Promise<string>} a 65-byte signature
 */
export async function requestDydxOnboardingSignature({
  getProvider,
  address = null,
  switchChain = null,
  requireChain = true,
  restoreChain = false,
  onStage = null
} = {}) {
  let provider = typeof getProvider === 'function' ? getProvider() : null;
  if (!provider || typeof provider.request !== 'function') throw dydxError('NO_SIGNER');

  let account = String(address || '').trim();
  if (!account) {
    try {
      const accs = await withTimeout(provider.request({ method: 'eth_accounts' }), 8_000, 'NO_SIGNER');
      account = Array.isArray(accs) && accs[0] ? String(accs[0]) : '';
    } catch { /* handled below */ }
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(account)) throw dydxError('NO_SIGNER');

  const target = DYDX_ONBOARDING_CHAIN_ID;
  let previousChain = null;
  if (requireChain) {
    previousChain = await readChainId(provider);
    if (previousChain !== target) {
      if (typeof switchChain !== 'function') throw dydxError('NEEDS_ETHEREUM');
      try { onStage?.('switch'); } catch { /* advisory */ }
      let ok = false;
      try {
        /* A switch the wallet has to show can wait for the human; a switch
           nobody answers must not spin forever. */
        ok = await withTimeout(switchChain(target), 90_000, 'SWITCH_TIMEOUT');
      } catch (err) {
        if (classifyDydxError(err) === 'REJECTED') throw dydxError('SWITCH_REJECTED', err);
        ok = false;
      }
      if (!ok) throw dydxError('NEEDS_ETHEREUM');
      /* The switch resolves before every layer has heard `chainChanged`;
         the request below must be tagged eip155:1, so wait for the provider
         to say so (bounded). */
      let now = null;
      for (let i = 0; i < 20; i += 1) {
        provider = (typeof getProvider === 'function' && getProvider()) || provider;
        now = await readChainId(provider);
        if (now === target) break;
        await sleep(250);
      }
      if (now !== target) throw dydxError('NEEDS_ETHEREUM');
    }
  }

  const typed = dydxOnboardingTypedData();
  try { onStage?.('sign'); } catch { /* advisory */ }
  let signature;
  try {
    signature = await provider.request({
      method: 'eth_signTypedData_v4',
      params: [account, JSON.stringify(typed)]
    });
  } finally {
    if (restoreChain && previousChain && previousChain !== target && typeof switchChain === 'function') {
      /* Best effort and never awaited by the caller's success path: the
         signature is already in hand (or already failed). */
      Promise.resolve()
        .then(() => switchChain(previousChain))
        .catch(() => {});
    }
  }

  const sig = typeof signature === 'string' ? signature.trim() : '';
  /* dYdX derives the key from r‖s of a 65-byte ECDSA signature. A smart-
     contract wallet (ERC-1271/6492) returns something else and cannot hold a
     dYdX account — say so instead of deriving garbage. */
  if (!/^0x[0-9a-fA-F]{130}$/.test(sig)) throw dydxError('BAD_SIGNATURE');

  try {
    const { verifyTypedData } = await import('ethers');
    const types = { dYdX: typed.types.dYdX };
    const recovered = verifyTypedData(typed.domain, types, typed.message, sig);
    if (String(recovered).toLowerCase() !== account.toLowerCase()) throw dydxError('SIGNER_MISMATCH');
  } catch (err) {
    if (err?.dydx) throw err;
    throw dydxError('BAD_SIGNATURE', err);
  }
  return sig;
}

/*
 * Validator endpoints, tried in order. The derived address needs no network
 * at all, so connecting no longer fails because one RPC was slow: the client
 * is opened lazily (and retried) when an order is actually placed.
 */
const DYDX_VALIDATORS = [
  'https://dydx-ops-rpc.kingnodes.com:443',
  'https://dydx-dao-rpc.polkachu.com:443'
];

async function openCompositeClient(sdk) {
  let lastError = null;
  for (const endpoint of DYDX_VALIDATORS) {
    try {
      const base = sdk.Network.mainnet();
      const vc = base.validatorConfig;
      const network = endpoint === vc.restEndpoint || endpoint.replace(/\/$/, '') === vc.restEndpoint
        ? base
        : new sdk.Network(
            base.env,
            base.indexerConfig,
            new sdk.ValidatorConfig(endpoint, vc.chainId, vc.denoms, vc.broadcastOptions, vc.defaultClientMemo)
          );
      return await withTimeout(sdk.CompositeClient.connect(network), 20_000, 'VALIDATOR_TIMEOUT');
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('VALIDATOR_UNREACHABLE');
}

async function ensureDydxClient() {
  if (!session) throw new Error('NOT_CONNECTED');
  if (session.client) return session.client;
  if (!session.clientPromise) {
    const owner = session;
    owner.clientPromise = openCompositeClient(owner.sdk).then(
      (client) => { owner.client = client; return client; },
      (err) => { owner.clientPromise = null; throw err; }
    );
  }
  return session.clientPromise;
}

/**
 * Create an in-memory dYdX signing session from the user's EVM signature.
 * The returned address matches the account dydx.trade generates for the same
 * EVM wallet. Nothing secret is written to localStorage or React state.
 *
 * Accepts either the options of `requestDydxOnboardingSignature` or — for
 * older callers — an ethers signer (which is adapted, not trusted blindly:
 * the same Ethereum-domain rules apply through its provider).
 */
export async function connectDydx(options) {
  let signature;
  if (options && typeof options.getProvider === 'function') {
    signature = await requestDydxOnboardingSignature(options);
  } else if (options?.signTypedData) {
    const typed = dydxOnboardingTypedData();
    signature = await options.signTypedData(typed.domain, { dYdX: typed.types.dYdX }, typed.message);
    if (!/^0x[0-9a-fA-F]{130}$/.test(String(signature || ''))) throw dydxError('BAD_SIGNATURE');
  } else {
    throw dydxError('NO_SIGNER');
  }

  try { options?.onStage?.('derive'); } catch { /* advisory */ }
  const sdk = await loadClient();
  const { mnemonic } = sdk.onboarding.deriveHDKeyFromEthereumSignature(signature);
  try {
    const wallet = await sdk.LocalWallet.fromMnemonic(mnemonic, 'dydx');
    const subaccount = sdk.SubaccountInfo.forLocalWallet(wallet, 0);
    session = { sdk, wallet, client: null, clientPromise: null, subaccount, address: wallet.address };
    /* Warm the validator connection in the background; an order awaits it. */
    ensureDydxClient().catch(() => {});
    return { address: wallet.address };
  } finally {
    /* Strings cannot be zeroed, but dropping the only reference immediately is
       still materially safer than retaining or persisting the mnemonic. */
    // eslint-disable-next-line no-unused-vars
    void mnemonic;
  }
}

export function disconnectDydx() {
  session = null;
}

export const dydxSessionAddress = () => session?.address || null;

/** Market/IOC order with our builder address and fee inside the signed order. */
export async function placeDydxOrder({ market, side, size, slippagePct = 0.5, reduceOnly = false, orderType = 'market', limitPrice: userPrice = null }) {
  if (!session) throw new Error('NOT_CONNECTED');
  if (!market?.ticker || !market?.raw) throw new Error('BAD_MARKET');
  const qty = Number(size);
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('BAD_SIZE');
  const buy = side === 'buy';
  const sdkTmp = await loadClient();
  let limitPrice;
  let orderTypeEnum;
  let execution;
  if (orderType === 'limit' && userPrice != null && String(userPrice).trim() !== '') {
    const lp = Number(userPrice);
    if (!Number.isFinite(lp) || lp <= 0) throw new Error('BAD_PRICE');
    limitPrice = lp;
    orderTypeEnum = sdkTmp.OrderType.LIMIT;
    execution = sdkTmp.OrderExecution.GTC;
  } else {
    const slip = Number(slippagePct);
    if (!Number.isFinite(slip) || slip <= 0 || slip > 10) throw new Error('BAD_SLIPPAGE');
    limitPrice = market.oraclePrice * (1 + (buy ? 1 : -1) * slip / 100);
    orderTypeEnum = sdkTmp.OrderType.MARKET;
    execution = sdkTmp.OrderExecution.IOC;
  }
  const clientId = crypto.getRandomValues(new Uint32Array(1))[0];
  let client;
  try {
    client = await ensureDydxClient();
  } catch {
    throw new Error('VALIDATOR_UNREACHABLE');
  }
  if (!session) throw new Error('NOT_CONNECTED');
  const { sdk, subaccount } = session;

  const result = await client.placeOrder(
    subaccount,
    market.ticker,
    orderTypeEnum,
    buy ? sdk.OrderSide.BUY : sdk.OrderSide.SELL,
    limitPrice,
    qty,
    clientId,
    undefined,
    undefined,
    execution,
    false,
    Boolean(reduceOnly),
    undefined,
    market.raw,
    undefined,
    undefined,
    'FBT Swap builder order',
    undefined,
    undefined,
    { builderAddress: DYDX_BUILDER_ADDRESS, feePpm: DYDX_BUILDER_FEE_PPM }
  );

  const hash = result?.hash;
  return {
    hash: typeof hash === 'string' ? hash : hash?.toString?.() || null,
    clientId,
    builderAddress: DYDX_BUILDER_ADDRESS,
    feePpm: DYDX_BUILDER_FEE_PPM
  };
}
