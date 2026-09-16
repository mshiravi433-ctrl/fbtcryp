/** Own one modal attempt; closing during provider attachment is not cancellation. */
export function waitForEmailConnection(modal, attach, { onError = () => {}, openTimeoutMs = 30_000 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let opened = false;
    let attaching = false;
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
          if (ok) settle(true);
          else {
            // Provider not yet ready (getWalletProvider() null on first tick on
            // slow WebView). Don't settle false — let the close poll / next
            // subscribeAccount event retry. This is the "popup says connected
            // but our page shows no wallet" path: the modal is open:false but
            // the embedded provider needs one more tick.
            attaching = false;
          }
        }, () => {
          attaching = false;
          // transient attach error — keep polling, outer openTimeout will fail
          // eventually if nothing ever succeeds
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
