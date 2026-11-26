/**
 * THE OWN-WALLET BITCOIN LEG — one read, shared by the wallet asset list and
 * the bitcoin popup.
 *
 * The old wallet page had TWO copies of this read: BtcCard at the bottom of
 * the page and BtcHubSheet in the popup. Both derived the same m/84' address
 * and both asked /api/btc/address about it. The card is gone; this hook is now
 * the single place that answers «how much BTC does THIS seed hold», so the
 * asset row in the portfolio and the popup can never disagree and opening the
 * popup costs no second request.
 *
 * The btcWallet module is imported DYNAMICALLY and only for an unlocked local
 * vault. An injected/WalletConnect wallet has no bitcoin leg (the zero law),
 * and a user who never opens the wallet page should not download the derivation
 * stack just because this hook is in the module graph.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getBtcAddressInfo, getBtcFees } from '../lib/btcApi';

const EMPTY = Object.freeze({
  address: null,
  balance: null,
  fees: null,
  loading: false,
  error: null
});

export function useBtcHolding({ enabled = false, getSigner = null, account = null, refreshKey = 0 } = {}) {
  const [state, setState] = useState(EMPTY);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!enabled || typeof getSigner !== 'function') {
      setState(EMPTY);
      return null;
    }
    const mine = ++seq.current;
    setState((cur) => ({ ...cur, loading: true, error: null }));
    try {
      /* Kept behind the unlocked-vault check above: a locked signer is not a
         bitcoin signer, and importing the derivation stack for one would be
         pointless work on every locked wallet render. */
      const { btcAddressForSigner } = await import('../lib/btcWallet');
      const address = await btcAddressForSigner(getSigner(), { index: 0 });
      if (mine !== seq.current) return null;
      if (!address) {
        setState({ ...EMPTY, error: 'NO_VAULT' });
        return null;
      }
      /* Both reads are cheap, cached server-side and belong to the same view.
         A failed fee read must not throw away a balance we already have, so the
         fee leg is allowed to fail on its own. */
      const [info, fees] = await Promise.all([
        getBtcAddressInfo(address),
        getBtcFees().catch(() => null)
      ]);
      if (mine !== seq.current) return null;
      const next = {
        address,
        balance: {
          confirmedSats: Number(info?.confirmedSats ?? 0),
          unconfirmedSats: Number(info?.unconfirmedSats ?? 0),
          utxos: Array.isArray(info?.utxos) ? info.utxos.length : null
        },
        fees: fees?.satPerVb ?? null,
        loading: false,
        error: null
      };
      setState(next);
      return next;
    } catch (err) {
      if (mine === seq.current) {
        setState({ ...EMPTY, error: err?.code || err?.message || 'BTC_UNAVAILABLE' });
      }
      return null;
    }
  }, [enabled, getSigner]);

  /* One read per account/refresh. Prices are NOT a dependency: a market tick
     re-prices the row the hook already returned, it does not re-ask Esplora. */
  useEffect(() => {
    void load();
    return () => { seq.current += 1; };
  }, [load, refreshKey]);

  useEffect(() => {
    if (!enabled) return undefined;
    const onVis = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [enabled, load]);

  return { ...state, account, refresh: load };
}

export default useBtcHolding;
