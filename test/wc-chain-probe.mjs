/**
 * WALLETCONNECT CHAIN-ID PROBE (runtime, no DOM needed)
 * ---------------------------------------------------------------------------
 * Reported: with Trust Wallet connected, token balances (e.g. Bitcoin as
 * WBTC) were missing from the Wallet tab. Root cause found in the SDK:
 * EthereumProvider.connect() ends with
 *   setChainIds(this.rpc.chains.length ? this.rpc.chains : accounts)
 * and `rpc.chains` is the REQUIRED chain list passed to init() — the app's
 * DEFAULT_CHAIN (BNB Chain, 56) — regardless of the network the wallet
 * actually approved. A Trust connected while on Ethereum reported chainId 56,
 * the Wallet tab filtered its list to BSC, and WBTC (an Ethereum token) was
 * nowhere. `chainFromWcSession()` reads the honest chain from the session the
 * wallet signed: the first account in `session.namespaces.eip155.accounts`.
 *
 * This probe locks the resolver's behavior for every spelling a wallet may
 * use, and the fallback order (session > provider > null).
 */
import { chainFromWcSession, parseChainId } from '../src/lib/wcChain.js';

export default function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);

  /* ---- 1. parseChainId accepts every spelling wallets actually emit ---- */
  t('numeric chain id parses', parseChainId(56) === 56);
  t('numeric string parses', parseChainId('56') === 56);
  t('hex string parses', parseChainId('0x38') === 56);
  t('CAIP-2 chain id parses', parseChainId('eip155:56') === 56);
  t('CAIP-2 account string parses to its chain', parseChainId('eip155:1:0x1111111111111111111111111111111111111111') === 1);
  t('garbage is rejected, not coerced to NaN', parseChainId('eip155:x') === null && parseChainId('nonsense') === null);
  t('empty/null is rejected', parseChainId(null) === null && parseChainId('') === null);

  /* ---- 2. the session is the source of truth, not provider.chainId ---- */
  const trustOnEth = {
    chainId: 56, // the SDK's lie after connect()
    session: {
      namespaces: {
        eip155: { accounts: ['eip155:1:0x1111111111111111111111111111111111111111'] }
      }
    }
  };
  t('the approved session chain beats the provider chainId (Trust on Ethereum reporting 56)',
    chainFromWcSession(trustOnEth) === 1);

  /* ---- 3. fallbacks ---- */
  t('falls back to provider.chainId when no session namespace is readable',
    chainFromWcSession({ chainId: 137, session: null }) === 137);
  t('falls back to null when nothing is readable (caller picks its default)',
    chainFromWcSession({}) === null && chainFromWcSession(null) === null);

  /* ---- 4. a malformed session must not throw (real wallets send odd shapes) ---- */
  let threw = false;
  try {
    chainFromWcSession({ session: { namespaces: { eip155: { accounts: 42 } } }, chainId: 56 });
    chainFromWcSession({ session: { namespaces: null }, chainId: '0x89' });
  } catch {
    threw = true;
  }
  t('a malformed session object degrades to fallbacks instead of throwing', !threw);

  /* ---- 5. multi-account namespaces: the first approved eip155 account wins ---- */
  const multi = {
    chainId: 56,
    session: {
      namespaces: {
        eip155: {
          accounts: [
            'eip155:8453:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            'eip155:1:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
          ]
        }
      }
    }
  };
  t('the first approved account decides the chain', chainFromWcSession(multi) === 8453);

  return rows;
}
