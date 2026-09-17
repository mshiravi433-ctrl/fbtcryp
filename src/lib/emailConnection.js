/**
 * Own one modal attempt; closing during provider attachment is not cancellation.
 *
 * SETTLE CONTRACT (mirrored by test/wallet-connection-regression.test.js):
 *   • attach() resolves TRUE  → settle(true), unsubscribe.
 *   • attach() REJECTS        → onError() + settle(false) immediately. A thrown
 *     attach is a real failure (provider missing for good, ethers chunk dead) —
 *     retrying it for the full 30s open window with no feedback is the
 *     «popup says connected but our page shows no wallet» report exactly: the
 *     user waits out the silence and gives up before anything settles.
 *   • attach() resolves FALSE → TRANSIENT (getWalletProvider() null on the
 *     first tick of a slow WebView). Keep listening; the next subscribeAccount
 *     event or close-poll retries. Bounded by MAX_ATTACH_ATTEMPTS so an
 *     always-false provider still settles instead of spinning silently.
 *   • after settle, stale account/state callbacks are ignored and unsubscribed.
 */
/**
 * A provider that answers false forever must still settle: 8 attempts across
 * the subscribeAccount events and the close-poll is generous for the measured
 * transient (one missed tick on a cold WebView) without resurrecting the
 * silent 30s hang this module's own regression test timed out on.
 */
export const MAX_ATTACH_ATTEMPTS = 8;

export function waitForEmailConnection(modal, attach, { onError = () => {}, openTimeoutMs = 30_000 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let opened = false;
    let attaching = false;
    let attempts = 0;
    let openTimer;
    let closeTimer;
    const subscriptions = [];
    const settle = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(openTimer);
      clearTimeout(closeTimer);
      subscriptions.forEach((unsubscribe) => { try { unsubscribe?.(); } catch { /* cleanup */ } });
      resolve(Boolean(ok));
    };
    const fail = () => { if (!settled) { onError(); settle(false); } };
    const account = (acct) => {
      if (settled || attaching || !acct?.isConnected || !acct.address) return;
      attaching = true;
      clearTimeout(closeTimer);
      Promise.resolve()
        .then(() => attach(acct.address))
        .then((ok) => {
          if (ok) {
            settle(true);
            return;
          }
          /* Provider not yet ready (getWalletProvider() null on first tick on
             slow WebView). Retry on the next account event / close poll — but
             only a bounded number of times, then settle honestly. */
          attaching = false;
          attempts += 1;
          if (attempts >= MAX_ATTACH_ATTEMPTS) fail();
        }, () => {
          /* A REJECTED attach is not transient noise: the provider was there
             and failed to produce a signer. Settle now — the old behaviour
             (retrying until the 30s fuse) left the user on a silent page with
             no error and no wallet, which reads exactly like a dead button. */
          attaching = false;
          fail();
        });
    };
    const checkAccount = () => {
      account({ isConnected: modal.getIsConnectedState?.(), address: modal.getAddress?.('eip155') });
    };
    const subscribe = (unsubscribe) => {
      if (settled) unsubscribe?.();
      else subscriptions.push(unsubscribe);
    };
    try {
      subscribe(modal.subscribeAccount(account, 'eip155'));
      subscribe(modal.subscribeState((state) => {
        if (settled) return;
        if (state?.open) { opened = true; clearTimeout(openTimer); }
        else if (state?.open === false && opened) {
          // Account/provider updates and modal close may arrive in either order.
          // The embedded wallet's address comes from secure.walletconnect.org
          // via postMessage + iframe — on a slow mobile WebView it can land
          // 500–1500ms AFTER open:false, while the old 250ms grace already
          // settled false and rolled the marker back (the "popup says
          // connected but our page shows no wallet" report). Poll for up to
          // 3s before giving up — the 30s restore window is the outer bound,
          // this is just the in-modal close grace.
          clearTimeout(closeTimer);
          let tries = 0;
          const poll = () => {
            if (settled || attaching) return;
            try { checkAccount(); } catch { /* checkAccount handles its own */ }
            if (settled || attaching) return;
            tries += 1;
            if (tries < 12) closeTimer = setTimeout(poll, 250);
            else if (!attaching) settle(false);
          };
          closeTimer = setTimeout(poll, 250);
        }
      }));
      openTimer = setTimeout(fail, openTimeoutMs);
      Promise.resolve(modal.open({ view: 'Connect' })).then(() => {
        if (settled) return;
        opened = true;
        clearTimeout(openTimer);
        checkAccount();
      }).catch(fail);
    } catch { fail(); }
  });
}
