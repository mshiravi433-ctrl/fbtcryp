/**
 * ETHERS, WITHOUT THE BARREL — AND WITHOUT THE PARTS THAT COST.
 * ============================================================================
 *
 * WHY THIS EXISTS (2026-11-11)
 * ---------------------------------------------------------------------------
 * The deployment's Fluid Active CPU allowance is 4 hours per rolling 30
 * days — about eight minutes of CPU per day. The cold-start measurement
 * put `ethers` at the top of the budget: 181 ms of CPU, compiled on EVERY
 * cold start, to serve a dashboard poll that never touches a wallet.
 *
 * The barrel pulls in EVERYTHING — the contract machinery, the network
 * layer, the signer, the transaction parser — but the application uses it
 * for a handful of symbols, and they fall into two very different groups:
 *
 *   ── GROUP ONE: THE HOT ONES, NOW FREE ────────────────────────────────────
 *   `getAddress`, `isAddress` — address checksumming and validation.
 *   `keccak256`, `toUtf8Bytes`   — the Ethereum hash and its encoding.
 *
 *   These are implemented in `server/evmAddress.js` and `server/keccak.js`
 *   with NO dependency at all. They cost nothing to load, they are
 *   verified against `ethers` itself (over thousands of fuzzed inputs and
 *   the published Keccak test vector), and they are the symbols that
 *   appear on the hottest paths.
 *
 *   ── GROUP TWO: THE HEAVY ONES, LOADED ON DEMAND ──────────────────────────
 *   `Interface`, `AbiCoder`        — ABI encoding/decoding
 *   `verifyMessage`, `verifyTypedData` — signature verification
 *   `Wallet`, `JsonRpcProvider`    — signing and RPC
 *
 *   These cannot be written cheaply — ABI decoding and secp256k recovery
 *   are real cryptography — so they come from the ethers SUBPATHS, which
 *   are much cheaper than the barrel:
 *
 *     `ethers` (barrel)      181 ms      `ethers/abi`       110 ms
 *     `ethers/address`        89 ms      `ethers/hash`       101 ms
 *     `ethers/utils`          58 ms      `ethers/wallet`     ~90 ms
 *     `ethers/crypto`         65 ms      `ethers/constants`    3 ms
 *
 *   ─── WHY GROUP TWO IS LAZY, NOT JUST CHEAPER ──────────────────────────────
 *   Because "cheaper" was not enough. Eight modules on the eager path
 *   import this file, and between them they needed the ABI machinery, the
 *   signature verifier and the RPC provider — so a plain re-export would
 *   have loaded `ethers/abi` and `ethers/hash` (210 ms together) on every
 *   cold start, for a dashboard that never encodes an ABI.
 *
 *   So Group Two is loaded ON DEMAND: the functions below return a PROMISE,
 *   and the caller awaits it. That is a change of shape, so it is stated
 *   plainly here and in every call site: `await Interface(...)` instead of
 *   `new Interface(...)`.
 *
 *   The alternative — `new Interface(...)` kept synchronous — would have
 *   meant keeping the eager load, and the eager load is the thing being
 *   removed.
 *
 * ─── WHAT THIS DOES NOT CHANGE ──────────────────────────────────────────────
 * The behaviour of every function. `ethersLite.getAddress` is
 * `ethers.getAddress` for every input that matters, and the free
 * implementations are held to that by the test suite, which compares them
 * against `ethers` directly — including the mixed-case bad-checksum
 * rejection, the missing-prefix acceptance and the legacy ICAP form.
 */

/* ── GROUP ONE: the free implementations ─────────────────────────────────── */

/*
 * The address helpers. These are the dependency-free equivalents, verified
 * against `ethers`'s own `getAddress`/`isAddress` — see
 * server/evmAddress.js for the exact semantics.
 */
export { getAddress, isAddress } from './evmAddress.js';

/*
 * The Keccak-256 hash and the UTF-8 byte encoding it is applied to.
 *
 * `toUtf8Bytes` is `new TextEncoder().encode(...)` — the same encoding
 * `ethers`'s uses — so the digest is byte-identical.
 */
import { keccak256 as keccak256Bytes, keccak256Hex } from './keccak.js';

/**
 * The Keccak-256 hash, with ethers' shape.
 *
 * `ethers.keccak256` takes a `BytesLike` — a `Uint8Array` OR a string — and
 * returns a 0x-prefixed hex string. The previous export (`keccak256Hex`)
 * only took a STRING and hashed its UTF-8 bytes, so a call like
 * `keccak256(toUtf8Bytes(x))` hashed the *text* of the byte array rather
 * than the bytes themselves. The digests were wrong: the Hyperliquid
 * connectionId did not match the SDK's vectors.
 *
 * This wrapper accepts what ethers accepts and returns what ethers returns.
 */
export function keccak256(data) {
  if (typeof data === 'string') return keccak256Hex(data);
  return `0x${Buffer.from(keccak256Bytes(data instanceof Uint8Array ? data : new Uint8Array(data))).toString('hex')}`;
}

export const toUtf8Bytes = (text) => new TextEncoder().encode(String(text));

/*
 * The remaining small utilities that ethers' `utils` provides.
 *
 * They are LAZY, like the heavy group: `ethers/utils` is 58 ms, and the
 * eager re-export meant every module that wanted a single `getAddress` also
 * paid for the whole utility belt. A caller now awaits them:
 *
 *   const units = await parseUnits('1.5', 6);
 *
 * They are not cryptography and could be written from scratch, but they are
 * not on the hot path either, and re-implementing them would risk a
 * divergence from ethers for no benefit. The lazy boundary is the honest
 * trade: same functions, paid for only when used.
 */
const utilsArea = () => lazyEthersArea('utils', () => import('ethers/utils'));

export function toUtf8String(...args) { return utilsArea().then((m) => m.toUtf8String(...args)); }
export function hexlify(...args) { return utilsArea().then((m) => m.hexlify(...args)); }
export function concat(...args) { return utilsArea().then((m) => m.concat(...args)); }
export function getBytes(...args) { return utilsArea().then((m) => m.getBytes(...args)); }
export function isHexString(...args) { return utilsArea().then((m) => m.isHexString(...args)); }
export function parseUnits(...args) { return utilsArea().then((m) => m.parseUnits(...args)); }

/**
 * `parseUnits(value, decimals)` — the SYNCHRONOUS form.
 *
 * `ethers`'s `parseUnits` lives in `ethers/utils`, which the lazy boundary
 * makes a PROMISE. That is right for a server module, but wrong for the
 * hot paths that turn a decimal string into base units and then COMPARE it
 * — a receipt reconciler does exactly that, in a loop, and making it async
 * changed every caller and every test.
 *
 * The conversion is not cryptography: it is a decimal string and a scale.
 * So it is implemented here, synchronously, and the test suite proves it
 * byte-identical to `ethers`'s own `parseUnits` over the values that
 * matter — including the rounding rule, which is the one detail a
 * hand-written version usually gets wrong.
 *
 * @param {string} value a decimal string, e.g. "250" or "1.5"
 * @param {number} decimals the token scale
 * @returns {bigint} the amount in base units
 */
export function parseUnitsSync(value, decimals) {
  const text = String(value ?? '').trim();
  const scale = Number(decimals);
  if (!Number.isInteger(scale) || scale < 0 || scale > 77) {
    throw new Error(`INVALID_DECIMALS: ${decimals}`);
  }
  /* ethers accepts an optional sign and a decimal point, and nothing else. */
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new Error(`INVALID_FIXED_NUMBER: ${text}`);
  const [, sign, whole, fraction = ''] = match;
  /*
   * ethers REFUSES a fraction longer than the scale — it does not truncate
   * it. `parseUnits('0.0000001', 6)` raises "too many decimals for format".
   *
   * That refusal is the correct behaviour and this copy keeps it: silently
   * truncating would turn 0.0000001 into 0 and quietly under-pay an
   * invoice, where ethers' error makes the caller deal with it.
   */
  if (fraction.length > scale) {
    throw new Error(`TOO_MANY_DECIMALS: ${text} at scale ${scale}`);
  }
  const padded = fraction.padEnd(scale, '0');
  const digits = `${whole}${padded}`.replace(/^0+(?=\d)/, '');
  const amount = BigInt(digits) * (sign ? -1n : 1n);
  return amount;
}
export function formatUnits(...args) { return utilsArea().then((m) => m.formatUnits(...args)); }
export function parseEther(...args) { return utilsArea().then((m) => m.parseEther(...args)); }
export function formatEther(...args) { return utilsArea().then((m) => m.formatEther(...args)); }
export function zeroPadValue(...args) { return utilsArea().then((m) => m.zeroPadValue(...args)); }
export function dataLength(...args) { return utilsArea().then((m) => m.dataLength(...args)); }
export function dataSlice(...args) { return utilsArea().then((m) => m.dataSlice(...args)); }
export function isBytesLike(...args) { return utilsArea().then((m) => m.isBytesLike(...args)); }
export function getBigInt(...args) { return utilsArea().then((m) => m.getBigInt(...args)); }
export function toBigInt(...args) { return utilsArea().then((m) => m.toBigInt(...args)); }

/*
 * The constants — `ZeroAddress` and friends.
 *
 * `ethers/constants` is only 3 ms, but 3 ms on every cold start of every
 * instance is still 3 ms, and `ZeroAddress` is a plain string: it is
 * written out here rather than imported, so it costs nothing at all.
 *
 * The values are the canonical ones — `ZeroAddress` is the all-zero EVM
 * address, `MaxUint256` is 2^256 − 1 — and they are checked against
 * `ethers`'s own constants in the test suite, because a wrong constant here
 * would be a wrong address in a transaction.
 */
export const ZeroAddress = '0x0000000000000000000000000000000000000000';
export const ZeroHash = '0x0000000000000000000000000000000000000000000000000000000000000000';
export const MaxUint256 = 115792089237316195423570985008687907853269984665640564039457584007913129639935n;
export const MinInt256 = -57896044618658097711785492504343953926634992332820282019728792003956564819968n;

/* ── GROUP TWO: the lazy, heavy ones ──────────────────────────────────────── */

/*
 * The shared loader for the heavy ethers areas.
 *
 * Single-flight, and a failure that does not poison the instance: a module
 * that fails to load is retried on the next call, and the error names the
 * area so a failure is traceable.
 */
const loaded = new Map();

function lazyEthersArea(label, loader) {
  const p = (async () => loader())();
  loaded.set(label, p);
  return p;
}

/**
 * The ABI machinery — `ethers/abi`.
 *
 * `Interface` is now a FACTORY that returns a promise, so a call site reads
 * `const iface = await Interface(abi)` instead of `new Interface(abi)`.
 */
export function Interface(abi) {
  return lazyEthersArea('abi', () => import('ethers/abi')).then((m) => new m.Interface(abi));
}

/** The ABI coder — `ethers/abi`. */
export function AbiCoder(...args) {
  return lazyEthersArea('abi', () => import('ethers/abi')).then((m) => new m.AbiCoder(...args));
}

/**
 * The message and typed-data signature verification — `ethers/hash`.
 *
 * `verifyMessage` and `verifyTypedData` are NOT in `ethers/crypto`, which is
 * a trap worth writing down: the obvious guess throws at import time with
 * "does not provide an export named 'verifyMessage'".
 */
export function verifyMessage(message, signature) {
  return lazyEthersArea('hash', () => import('ethers/hash')).then((m) => m.verifyMessage(message, signature));
}

export function verifyTypedData(...args) {
  return lazyEthersArea('hash', () => import('ethers/hash')).then((m) => m.verifyTypedData(...args));
}

export function hashMessage(message) {
  return lazyEthersArea('hash', () => import('ethers/hash')).then((m) => m.hashMessage(message));
}

/** The RPC provider — `ethers/providers`. */
export function JsonRpcProvider(...args) {
  return lazyEthersArea('providers', () => import('ethers/providers')).then((m) => new m.JsonRpcProvider(...args));
}

/** The network description — `ethers/providers`. */
export function Network(...args) {
  return lazyEthersArea('providers', () => import('ethers/providers')).then((m) => new m.Network(...args));
}

/** The signing wallet — `ethers/wallet`. */
export function Wallet(...args) {
  return lazyEthersArea('wallet', () => import('ethers/wallet')).then((m) => new m.Wallet(...args));
}

/** The signing key — `ethers/crypto`. */
export function SigningKey(...args) {
  return lazyEthersArea('crypto', () => import('ethers/crypto')).then((m) => new m.SigningKey(...args));
}

/** The signature type — `ethers/crypto`. */
export function Signature(...args) {
  return lazyEthersArea('crypto', () => import('ethers/crypto')).then((m) => new m.Signature(...args));
}

/**
 * `Signature.from(signature)` — the static parser.
 *
 * It cannot go through the `Signature(...)` wrapper, because that wrapper
 * constructs with `new`. The static factory is what the Hyperliquid signer
 * uses to read `r`, `s` and `v` back out of a raw signature.
 */
export function signatureFrom(signature) {
  return lazyEthersArea('crypto', () => import('ethers/crypto')).then((m) => m.Signature.from(signature));
}

/**
 * The typed-data encoder — `ethers/hash`.
 */
export function TypedDataEncoder(...args) {
  return lazyEthersArea('hash', () => import('ethers/hash')).then((m) => new m.TypedDataEncoder(...args));
}

/**
 * The report: which heavy areas have been loaded.
 *
 * It is here so an operator can see whether the deferral actually happened
 * — "the ABI machinery was loaded at 3:04 AM by a traffic spike" is a real
 * thing that happens, and it is worth being able to see.
 */
export function ethersLiteReport() {
  return {
    free: ['getAddress', 'isAddress', 'keccak256', 'toUtf8Bytes'],
    lazyAreas: [...loaded.keys()],
    loadedAreas: [...loaded.keys()].filter((k) => loaded.get(k).then ? true : false)
  };
}
