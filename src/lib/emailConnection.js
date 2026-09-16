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
      Promise.resolve().then(() => attach(acct.address)).then(settle, fail);
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
          clearTimeout(closeTimer);
          closeTimer = setTimeout(() => {
            try { checkAccount(); if (!attaching) settle(false); } catch { fail(); }
          }, 250);
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
