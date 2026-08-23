/**
 * INTERNAL BITCOIN WALLET — BIP-84 native segwit from the SAME seed.
 * ---------------------------------------------------------------------------
 * ─── THE ZERO LAW (everything here obeys it) ───────────────────────────────
 * The output of this module is m/84'/0'/0'/0/x derived from the mnemonic the
 * local vault ALREADY stores, encrypted, under the password the user ALREADY
 * set. Nothing new is created and nothing new is persisted:
 *
 *   · no new secret, password or storage key is ever generated or saved;
 *   · unlock / autoLock / backup behaviour is byte-for-byte unchanged — this
 *     module never touches localWallet.js's vault, only READS the phrase from
 *     the in-memory signer while it is alive;
 *   · bitcoin is never linked into the injected (MetaMask/Trust) wallet — the
 *     derivation only runs for wallet.mode === 'local';
 *   · signing happens only with that in-memory signer, during unlock;
 *   · the private key never lands in localStorage, server state or a log.
 *
 * The BTC ADDRESS (public data, like the EVM address already stored in the
 * vault blob) may be memoised for the session keyed by the EVM address, so
 * P2P and Wallet don't each re-derive it — that cache holds addresses only
 * and dies with the page.
 *
 * ─── WHY ETHERS IS ENOUGH ──────────────────────────────────────────────────
 * BIP-84 needs: secp256k1 HD derivation and HASH160. ethers has both —
 * HDNodeWallet.derivePath implements BIP-32 and SigningKey.computePublicKey
 * with compressed=true gives the 33-byte key P2WPKH requires. sha256 and
 * ripemd160 are exported by the same package. A second crypto dependency for
 * one hash chain this thin would be a bigger risk than the code it replaces.
 *
 * ─── MAINNET ONLY, ON PURPOSE ──────────────────────────────────────────────
 * coin_type 0 (mainnet), HRP "bc". The P2P funnel, the balance proxy and the
 * send validation are all mainnet; a testnet path here would be a cross-
 * network burn dressed as flexibility — the same policy btcAddress.js
 * enforces on every pasted address.
 *
 * Pure module: no DOM, no import.meta — the probe and the browser bundle run
 * the same bytes. ethers is a dynamic import so it stays in its own lazy
 * chunk and this file costs nothing on screens that never open it.
 */

/** The one shared ethers chunk, same pattern as localWallet.js. */
let ethersPromise = null;
function loadEthers() {
  if (!ethersPromise) {
    ethersPromise = import('ethers').catch((error) => {
      ethersPromise = null;
      throw error;
    });
  }
  return ethersPromise;
}

export const BTC_HRP = 'bc';
export const BTC_COIN_TYPE = 0;

/** m/84'/0'/0'/0/7 for index 7, m/84'/0'/0'/1/0 for the first change key. */
export function bip84Path(index, change = 0) {
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i > 2 ** 31 - 2) return null;
  const c = change ? 1 : 0;
  return `m/84'/${BTC_COIN_TYPE}'/0'/${c}/${i}`;
}

/* Session memo for derived ADDRESSES (public data) keyed by the vault's EVM
   address. Never holds a key, never survives a reload. */
const addressCache = new Map();

/**
 * Derive the index'th native-segwit address of a mnemonic.
 *
 * @param {number} index receiving index; 0 is the default Receive address
 * @param {string} mnemonic the 12-word phrase (already decrypted, in memory)
 * @returns {Promise<{address:string, path:string, publicKey:string, index:number}>}
 */
export async function addressAt(index, mnemonic) {
  const path = bip84Path(index, 0);
  if (!path) throw new Error('BAD_INDEX');
  if (!mnemonic || typeof mnemonic !== 'string') throw new Error('BAD_MNEMONIC');

  const { HDNodeWallet, Mnemonic, SigningKey, sha256, ripemd160, getBytes } = await loadEthers();

  const phrase = mnemonic.trim();
  if (!Mnemonic.isValidMnemonic(phrase)) throw new Error('BAD_MNEMONIC');

  /* fromPhrase would derive m/44'/60'/0'/0/0 we never need; fromMnemonic with
     the account path keeps exactly one derive step per address. */
  const account = HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(phrase), `m/84'/${BTC_COIN_TYPE}'/0'`);
  const key = account.derivePath(`0/${index}`);
  /* HASH160 for P2WPKH: ripemd160(sha256(compressed-pubkey)). */
  const publicKey = SigningKey.computePublicKey(key.privateKey, true);
  const program = getBytes(ripemd160(sha256(publicKey)));

  const { encodeSegwitAddress } = await import('./btcAddress.js');
  const address = encodeSegwitAddress(BTC_HRP, 0, program);
  if (!address) throw new Error('ENCODE_FAILED');

  return { address, path, publicKey, index: Number(index) };
}

/**
 * The unlocked local wallet's BTC address, from the in-memory signer ONLY.
 *
 * This is the single door the UI has to internal bitcoin. It refuses every
 * wallet that is not the local vault in the unlocked state, which is what
 * keeps the zero law honest: no phrase in memory ⇒ no derivation, and an
 * injected wallet can never grow a bitcoin leg through here.
 *
 * The signer's mnemonic never leaves this function; only the ADDRESS is
 * cached (keyed by the EVM address the vault itself already publishes).
 */
export async function btcAddressForSigner(signer, { index = 0 } = {}) {
  if (!signer || typeof signer.getAddress !== 'function') return null;
  if (!signer.mnemonic?.phrase) return null; /* injected/WC signers have none */

  const evmAddress = (await signer.getAddress()).toLowerCase();
  const cacheKey = `${evmAddress}:${index}`;
  const hit = addressCache.get(cacheKey);
  if (hit) return hit;

  const info = await addressAt(index, signer.mnemonic.phrase);
  addressCache.set(cacheKey, info.address);
  return info.address;
}

/**
 * Everything a SEND needs from the unlocked local wallet — address, path,
 * public key, public key hash and the private key — derived in ONE pass.
 *
 * Same door and same rules as btcAddressForSigner: only the local vault's
 * in-memory signer qualifies (it carries mnemonic.phrase; an injected wallet
 * never does), so no phrase ⇒ no key. The result is NEVER cached — the caller
 * (the send sheet) uses it to sign one transaction and lets it go out of
 * scope. This is the only function in the app that hands out a BTC key, and
 * only while the vault is unlocked.
 *
 * @returns {Promise<null | {address, path, publicKey, pubkeyHash:Uint8Array,
 *                           privateKey:string, index:number}>}
 */
export async function btcSpendFromSigner(signer, { index = 0 } = {}) {
  if (!signer || typeof signer.getAddress !== 'function') return null;
  if (!signer.mnemonic?.phrase) return null; /* injected/WC signers have none */

  const path = bip84Path(index, 0);
  if (!path) return null;

  const { HDNodeWallet, Mnemonic, SigningKey, sha256, ripemd160, getBytes } = await loadEthers();
  const account = HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(signer.mnemonic.phrase.trim()), `m/84'/${BTC_COIN_TYPE}'/0'`);
  const key = account.derivePath(`0/${Number(index)}`);
  const publicKey = SigningKey.computePublicKey(key.privateKey, true);
  const pubkeyHash = getBytes(ripemd160(sha256(publicKey)));

  const { encodeSegwitAddress } = await import('./btcAddress.js');
  const address = encodeSegwitAddress(BTC_HRP, 0, pubkeyHash);
  if (!address) return null;

  return { address, path, publicKey, pubkeyHash, privateKey: key.privateKey, index: Number(index) };
}

/** Test seam: drop the address memo (never holds anything else). */
export function _clearBtcAddressCache() {
  addressCache.clear();
}
