/**
 * RESTORE THE SOLANA CONNECTION ONCE PER DOCUMENT, WHEREVER THE USER LANDS.
 * ---------------------------------------------------------------------------
 *   «قبلا درست بود ولی الان درست نیست … اتصال ولت روی همین دستگاه نیره به
 *    کیف مول سولانا … تازه خیلی اوقات میزنه دامنه تایید نشده»
 *
 * ─── WHY A HOOK, AND WHY IT IS NOT A SCREEN ───────────────────────────────
 * MWA registration is ASYNC: it imports two packages and installs the Wallet
 * Standard registry, and only then does a connected wallet exist to be asked.
 * Before my change that happened inside the mount effect of the Wallet tab and
 * the on-chain Futures screen — so the restore depended on WHICH screen
 * happened to be open. A user who refreshed on the Solana swap page, or on the
 * home screen, or straight into a token, got no adapter, no answer, and
 * «وصل نیست» for a connection their wallet still held. The only remedy left in
 * the UI was Connect — and Connect is the flow Phantom refuses to open when it
 * cannot verify the domain. So one registration-timing detail turned into a
 * dead end with no way out of it.
 *
 * Putting the restore at the app root removes the dependency on the route
 * entirely: by the time any screen asks «am I connected?», the adapter has been
 * given the chance to answer.
 *
 * It is deliberately NOT the EVM restore. That one is lease-driven and retries
 * on a ladder (lib/wc/lease.js); this one is a single registration whose result
 * the wallet itself holds, so there is nothing to ladder — asking again later
 * would return the same answer.
 */
import { useEffect, useState } from 'react';
import { restoreSolanaConnection, solanaAddress } from './solanaWallet.js';

/** The event the wallet layer broadcasts on every Solana address change. */
const SOL_EVENT = 'solana:wallet-change';

/**
 * The connected Solana address for this document, or null while it is being
 * worked out. Updates on every wallet event, so a connect or a disconnect
 * anywhere in the app re-renders the screens that read it.
 *
 * @param {string} [appUrl] the identity the MWA adapter registers with
 */
export function useSolanaAddress(appUrl) {
  const [address, setAddress] = useState(() => solanaAddress());

  useEffect(() => {
    let alive = true;
    const sync = (next) => { if (alive) setAddress(next ?? null); };

    const onWalletEvent = (e) => sync(e?.detail?.address ?? solanaAddress());
    window.addEventListener(SOL_EVENT, onWalletEvent);

    /* Register and ask, once. `solanaAddress()` inside this call answers
       immediately for an injected provider or a stored deeplink session — the
       asynchronous part is only needed for MWA, so a user on either of the
       other two paths is not held waiting for a package import. */
    restoreSolanaConnection(appUrl).then((found) => {
      if (!alive) return;
      setAddress((current) => found ?? current ?? solanaAddress());
    }).catch(() => { /* no Solana transport here; the screens say so */ });

    /* A wallet that connects in another tab, or a page that comes back to the
       foreground on mobile, is not going to fire our event. */
    const onVisible = () => { if (document.visibilityState === 'visible') sync(solanaAddress()); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      alive = false;
      window.removeEventListener(SOL_EVENT, onWalletEvent);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [appUrl]);

  return address;
}
