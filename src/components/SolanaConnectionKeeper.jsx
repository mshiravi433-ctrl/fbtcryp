/**
 * MOUNTED ONCE, AT THE APP ROOT — it renders nothing.
 * ---------------------------------------------------------------------------
 *   «قبلا درست بود ولی الان درست نیست … اتصال ولت روی همین دستگاه نیره به
 *    کیف مول سولانا مثل فانتوم اما هیچ پاپ آپی برای وصل کردن کیف مول به اپ ما
 *    نمیاد تازه خیلی اوقات میزنه دامنه تایید نشده»
 *
 * ─── WHY IT EXISTS, IN ONE PARAGRAPH ───────────────────────────────────────
 * Mobile Wallet Adapter registration is asynchronous. Until it has run, a
 * connected Android wallet is INVISIBLE: the app cannot ask it anything, so it
 * reports «وصل نیست» for a connection the wallet still holds. That registration
 * used to live in the mount effect of the Wallet tab and the on-chain Futures
 * screen, which made the restore depend on the route — so a user who refreshed
 * anywhere else got a disconnected app and no way back, because the one remedy
 * in the UI is Connect, and Connect is the flow a wallet declines to open when
 * it cannot verify the domain. The only route to a working connection was a
 * navigation the app never performed. This component performs it, once, for
 * every route, and renders nothing.
 *
 * It is a sibling of WalletProvider rather than a child so that it starts the
 * same moment the app does, not after a route has already asked the question it
 * exists to answer.
 */
import { useEffect } from 'react';
import { restoreSolanaConnection } from '../lib/solanaWallet.js';
import { publicAppUrl } from '../lib/nativeShell.js';

export default function SolanaConnectionKeeper() {
  useEffect(() => {
    let alive = true;

    /* Fire and forget, deliberately. Every failure path here is a device that
       has no Solana transport — a desktop browser with no extension, an iOS
       WebView — and the screens already say «وصل نیست» in that case. Throwing
       here would put a console error in front of every user who has no Solana
       wallet, which is most of them, for a condition that is not a condition. */
    const done = restoreSolanaConnection(publicAppUrl('/'))
      .then((address) => {
        if (alive && address) {
          /* Tell every listening screen, so one that mounted before this
             finished re-reads the address rather than keeping its null. */
          window.dispatchEvent(new CustomEvent('solana:wallet-change', {
            detail: { address }
          }));
        }
      })
      .catch(() => {});

    /* A page restored from the bfcache or resumed on mobile re-evaluates this
       and must not register twice in one document. */
    return () => { alive = false; void done; };
  }, []);

  return null;
}
