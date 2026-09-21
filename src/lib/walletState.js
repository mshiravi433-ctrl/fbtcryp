/**
 * ONE WALLET STATE, THREE CHAINS, NO OVERWRITING.
 * ---------------------------------------------------------------------------
 * The EVM stack (WalletContext — injected or WalletConnect, plus the encrypted
 * local vault) and the Solana stack (lib/solanaWallet.js + lib/solana/deeplink.js)
 * grew up separately, and that separation was correct: they have nothing in
 * common except «this user has a wallet».
 *
 * What was missing is the OBJECT. Everything that has to reason about «what can
 * this user sign with right now» — the Intent OS execution path, the wallet
 * diagnostics, a future bridge — ended up reading whichever stack it was written
 * next to and guessing about the other one. Reading a Solana address out of a
 * Solana-shaped global, and an EVM account out of React state, is exactly how an
 * «0x…» account gets passed to a Solana signer.
 *
 * So this module is the one place that answers:
 *
 *   wallets:  { evm: {...}, solana: {...}, bitcoin: {...} }
 *   networks: [ 'eip155:1', 'solana:mainnet', … ]   — CAIP-2, only the connected ones
 *   signing:  { evm: {...}, solana: {...}, bitcoin: {...} } — what each can do
 *
 * ─── PROPERTIES THAT MATTER ─────────────────────────────────────────────────
 *   · The three channels are INDEPENDENT. A Solana connect can never clear the
 *     EVM account, because nothing in this module writes to another channel —
 *     each entry is derived from its own source on every read.
 *   · It is READ-ONLY and synchronous: `readWalletState()` never awaits and never
 *     asks a wallet for anything. A connect/disconnect is what changes state;
 *     this reports it.
 *   · Sources are injectable, so every branch is testable in Node.
 *   · Nothing here is a secret. Addresses are public, capabilities are booleans.
 *     A seed phrase, a private key and a wallet password have no representation
 *     in the shape below — deliberately, so no future edit can put one in it.
 */

import { canInjectSolana, canUseMwa, getMwaWallet, getSolanaProvider, solanaAddress, solanaWalletName } from './solanaWallet.js';
import { deeplinkSession } from './solana/deeplink.js';
import { activeSolanaTransport, walletCapabilities } from './solana/walletLayer.js';

/** Bumped when the shape changes, so a stored snapshot can be rejected. */
export const WALLET_STATE_SCHEMA = 'fbt.wallets.v1';

/** The three channels the app reports. */
export const WALLET_CHANNELS = Object.freeze(['evm', 'solana', 'bitcoin']);

/** CAIP-2 ids for the networks this app really connects to. */
export const NETWORK_CAIP2 = Object.freeze({
  ethereum: 'eip155:1',
  base: 'eip155:8453',
  arbitrum: 'eip155:42161',
  optimism: 'eip155:10',
  polygon: 'eip155:137',
  bsc: 'eip155:56',
  solana: 'solana:mainnet',
  /* Bitcoin mainnet genesis hash — the CAIP-2 chain id for BTC. */
  bitcoin: 'bip122:000000000019d6689c085ae165831e93'
});

/* ── the EVM source ──────────────────────────────────────────────────────────
 * The EVM account lives in React state (WalletContext), which is the one thing
 * a platform module cannot read synchronously. Rather than duplicating that
 * state, the provider REGISTERS a reader here (see WalletProvider) and this
 * module asks it. One registration, one reader, and the value can never be a
 * second copy that drifts.
 */
let evmReader = null;
const listeners = new Set();

/**
 * Register the EVM reader. Called by WalletProvider on mount.
 * @param {() => object|null} reader returns the raw EVM facts
 * @returns {() => void} unregister
 */
export function registerEvmWalletSource(reader) {
  evmReader = typeof reader === 'function' ? reader : null;
  notifyWalletState('evm');
  return () => {
    if (evmReader === reader) evmReader = null;
  };
}

/** Subscribe to state changes (connect, disconnect, network switch). */
export function subscribeWalletState(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Tell subscribers a channel changed. Safe to call from anywhere. */
export function notifyWalletState(channel = null) {
  const detail = { channel, at: Date.now() };
  for (const fn of listeners) {
    try {
      fn(detail);
    } catch {
      /* a listener must never break the change it was told about */
    }
  }
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('fbt:wallet-state', { detail }));
    } catch {
      /* no window event bus — the subscriber set above is the contract */
    }
  }
}

/* ── the three channel readers ───────────────────────────────────────────── */

const EVM_SIGNING = Object.freeze({
  eth_signTypedData_v4: 'typed-data',
  personal_sign: 'message',
  eth_sendTransaction: 'send'
});

/**
 * The EVM channel.
 *
 * `kind` distinguishes the three ways an EVM account can exist here — an
 * injected extension, a WalletConnect session, or the app's own encrypted local
 * vault — because «can this be signed without a device prompt» differs between
 * them, and a caller that cannot tell them apart will make the wrong promise.
 */
function readEvmChannel(override, { win } = {}) {
  const raw = override ?? (evmReader ? evmReader() : null) ?? null;
  if (!raw) {
    const injected = win?.ethereum ?? (typeof window !== 'undefined' ? window.ethereum : null);
    if (!injected) return emptyChannel('evm', 'none');
    return {
      channel: 'evm',
      connected: false,
      address: null,
      kind: 'injected-available',
      chainId: null,
      caip2: null,
      locked: false,
      capabilities: { connect: true, sign: false, send: false, reason: 'no account is connected' }
    };
  }
  const address = typeof raw.address === 'string' && /^0x[a-fA-F0-9]{40}$/.test(raw.address) ? raw.address : null;
  const connected = Boolean(raw.connected ?? address) && Boolean(address);
  const kind = raw.mode === 'local' ? 'local-encrypted' : raw.mode === 'wc' || raw.wc ? 'walletconnect' : 'injected';
  const chainId = raw.chainId == null ? null : Number(raw.chainId);
  return {
    channel: 'evm',
    connected,
    address: connected ? address : null,
    kind,
    chainId: Number.isFinite(chainId) ? chainId : null,
    caip2: Number.isFinite(chainId) ? `eip155:${chainId}` : null,
    locked: Boolean(raw.locked),
    capabilities: {
      connect: true,
      /* The provider object is what signs; its absence is why a connected-but
         -locked wallet must not be advertised as able to sign. */
      sign: connected && Boolean(raw.hasProvider ?? true) && !raw.locked,
      send: connected && Boolean(raw.hasProvider ?? true) && !raw.locked,
      methods: { ...EVM_SIGNING }
    }
  };
}

/**
 * The Solana channel — the whole reason this module exists next to the EVM one.
 * Reads whichever transport is live: an injected provider, a Wallet Standard
 * wallet (MWA), or a deeplink session. The address is NEVER coerced into the EVM
 * shape and never shares a field with it.
 */
function readSolanaChannel(override, { win } = {}) {
  if (override) return { channel: 'solana', ...override };
  const w = win ?? (typeof window !== 'undefined' ? window : null);
  const address = solanaAddress();
  const active = activeSolanaTransport({ win: w });
  const caps = walletCapabilities({ win: w });
  const session = deeplinkSession();
  const methods = {};
  for (const [name, value] of Object.entries(caps.methods ?? {})) methods[name] = Boolean(value?.supported);
  return {
    channel: 'solana',
    connected: Boolean(address),
    address: address ?? null,
    kind: active.transport ?? 'none',
    walletId: active.walletId ?? null,
    walletName: address ? (active.name ?? solanaWalletName()) : null,
    chain: 'mainnet-beta',
    caip2: address ? NETWORK_CAIP2.solana : null,
    /* Diagnostics that must be visible without a probe. */
    transports: {
      injected: Boolean(getSolanaProvider()),
      walletStandard: Boolean(getMwaWallet()),
      mwaSupported: canUseMwa(),
      extensionPossible: canInjectSolana(),
      deeplinkSession: Boolean(session),
      pendingRequest: Boolean(session)
    },
    capabilities: { connect: true, sign: Boolean(address), methods }
  };
}

/**
 * The Bitcoin channel — watch-only in this app, and it says so.
 *
 * There is no BTC signer here: FBT reads addresses and balances. Reporting
 * `signing: false` is the honest answer, and it is the one that stops a caller
 * from offering a «sign with Bitcoin» path that cannot exist.
 */
function readBitcoinChannel(override) {
  if (override) return { channel: 'bitcoin', ...override };
  return {
    channel: 'bitcoin',
    connected: false,
    address: null,
    kind: 'watch-only',
    caip2: null,
    capabilities: { connect: false, sign: false, send: false, reason: 'FBT tracks Bitcoin addresses; it holds no Bitcoin signer' }
  };
}

function emptyChannel(channel, kind) {
  return {
    channel,
    connected: false,
    address: null,
    kind,
    caip2: null,
    capabilities: { connect: false, sign: false, send: false }
  };
}

/**
 * THE SNAPSHOT.
 *
 * @param {object} [options]
 * @param {object} [options.evm]     inject the EVM facts (tests / non-React callers)
 * @param {object} [options.solana]  inject the Solana facts
 * @param {object} [options.bitcoin] inject the Bitcoin facts
 * @param {Window} [options.win]
 * @returns {{schema:string, at:string, wallets:object, networks:string[],
 *            signing:object, connected:boolean, count:number}}
 */
export function readWalletState({ evm, solana, bitcoin, win } = {}) {
  const wallets = {
    evm: readEvmChannel(evm, { win }),
    solana: readSolanaChannel(solana, { win }),
    bitcoin: readBitcoinChannel(bitcoin)
  };
  const networks = WALLET_CHANNELS
    .map((channel) => wallets[channel].caip2)
    .filter(Boolean);
  const signing = {};
  for (const channel of WALLET_CHANNELS) {
    signing[channel] = wallets[channel].capabilities ?? { connect: false, sign: false, send: false };
  }
  return {
    schema: WALLET_STATE_SCHEMA,
    at: new Date().toISOString(),
    wallets,
    networks,
    signing,
    connected: WALLET_CHANNELS.some((channel) => wallets[channel].connected),
    count: WALLET_CHANNELS.filter((channel) => wallets[channel].connected).length
  };
}

/**
 * THE INTENT OS QUERY.
 *
 * «Connected EVM wallet, connected Solana wallet, connected networks, available
 * signing capabilities» — as one flat object, because that is the question an
 * execution planner actually asks. Addresses are passed through as-is: an EVM
 * account and a Solana account are different strings on different chains and
 * conflating them is the bug this module is here to prevent.
 */
export function walletStateForIntent(options = {}) {
  const state = readWalletState(options);
  const evm = state.wallets.evm;
  const solana = state.wallets.solana;
  const bitcoin = {
    connected: state.wallets.bitcoin.connected,
    address: state.wallets.bitcoin.address,
    canSign: false,
    watchOnly: true
  };
  return {
    schema: state.schema,
    /*
     * `wallets` IS THE NORMALISED SHAPE the audit asked for — one object, three
     * channels that cannot overwrite each other — and it is what Intent OS
     * reads. The three flat aliases below it are the same values, kept because
     * callers written before the rename read them; a second shape with different
     * CONTENT is what would be a bug, and there is none: both are built from the
     * same `readWalletState()` call.
     */
    wallets: {
      evm: {
        connected: evm.connected,
        address: evm.address,
        chainId: evm.chainId,
        caip2: evm.caip2,
        kind: evm.kind,
        locked: Boolean(evm.locked),
        canSign: Boolean(evm.capabilities?.sign)
      },
      solana: {
        connected: solana.connected,
        address: solana.address,
        wallet: solana.walletName,
        transport: solana.kind,
        caip2: solana.caip2,
        canSign: Boolean(solana.capabilities?.sign),
        methods: solana.capabilities?.methods ?? {}
      },
      bitcoin
    },
    evm: {
      connected: evm.connected,
      address: evm.address,
      chainId: evm.chainId,
      caip2: evm.caip2,
      kind: evm.kind,
      canSign: Boolean(evm.capabilities?.sign)
    },
    solana: {
      connected: solana.connected,
      address: solana.address,
      wallet: solana.walletName,
      transport: solana.kind,
      caip2: solana.caip2,
      canSign: Boolean(solana.capabilities?.sign),
      methods: solana.capabilities?.methods ?? {}
    },
    bitcoin,
    networks: state.networks,
    signingCapabilities: state.signing,
    /* The one field a planner must never confuse: which chains can actually be
       signed for right now. */
    signableChains: WALLET_CHANNELS.filter((channel) => Boolean(state.signing[channel]?.sign))
  };
}
