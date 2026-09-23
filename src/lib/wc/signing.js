/**
 * THE SIGNING BOUNDARY
 * ---------------------------------------------------------------------------
 * Every request that asks a remote wallet to DO something — send a
 * transaction, sign a message, sign typed data — crosses this file first.
 *
 * ─── THE REPORT IT ANSWERS ─────────────────────────────────────────────────
 * «برای امضای کردن که دوباره وارد کیف پول متصل میشود گاهی ارور نتورک ضعیفه یا
 * اتصالی وجود ندارد میده و نمیاره مثلا… خاستیم سپرده گذاری کنیم وارد تراست والت
 * شد اما هیج صفحه امضایی نیامد فقط زد ضعیفه نتورک»
 *
 * Two different failures arrive as the same sentence:
 *
 *   1. THE REQUEST WAS NEVER DELIVERABLE. A WalletConnect session is a
 *      contract: it names the methods the wallet agreed to answer and the
 *      `<namespace>:<chainId>:<address>` accounts it agreed to answer them for.
 *      A deposit on Base against a session whose accounts only cover
 *      `eip155:56` is not a request the wallet can show — it is a request the
 *      wallet DROPS. The dApp waits, the user waits, and the eventual failure
 *      is reported as «شبکه در دسترس نیست»: a diagnosis about the internet, for
 *      a problem that is entirely ours.
 *   2. THE REQUEST WAS PUBLISHED TO A SOCKET NOBODY WAS LISTENING ON. A phone
 *      that slept, a tab Chrome frozen and thawed, a relay that dropped while
 *      the user was reading: the relay socket is closed, `request()` is
 *      published into it, and it resolves never.
 *
 * Both end the same way today — a bound fires or a socket errors, and the
 * caller classifies the failure as the network. So:
 *
 *   • PREFLIGHT: before a signing request leaves the page, the session is
 *     asked whether it can answer it (method, chain, account) and whether the
 *     relay socket is open. A refusal carries a MACHINE CODE and, where one
 *     exists, the fix (`switch` the chain, `reopen` the socket) — tried once,
 *     automatically, before the user is told anything.
 *   • A BOUND THAT MEASURES THE USER, NOT THE NETWORK: the clock pauses while
 *     this document is hidden, because a signature is a human wait.
 *   • AN HONEST CLASSIFICATION: «the wallet did not answer» and «this session
 *     does not cover that network» are two different sentences, and neither is
 *     «your internet is weak».
 *
 * ─── WHY IT IS AN EIP-1193 WRAPPER ─────────────────────────────────────────
 * Every transport in this app is adapted into one EIP-1193 object before
 * ethers ever sees it (see `attachExternal` in context/WalletContext.jsx).
 * Wrapping THAT object covers the farm panels, the send sheet, the insurance
 * flow, Intent AI's execution path and whatever is added next — one boundary,
 * installed once, instead of a guard remembered per call site.
 */

import { TIMEOUT } from './config.js';
import { pauseBound } from './timing.js';

/** Methods that ask the wallet to produce a signature (i.e. to prompt). */
export const SIGN_METHODS = Object.freeze([
  'eth_sendTransaction',
  'eth_signTransaction',
  'eth_sign',
  'eth_signTypedData',
  'eth_signTypedData_v3',
  'eth_signTypedData_v4',
  'personal_sign',
  'wallet_sendCalls'
]);

export const isSigningMethod = (method) =>
  SIGN_METHODS.includes(String(method ?? '').trim());

/** The chain-switch request the `switch` fix sends. */
export const SWITCH_METHOD = 'wallet_switchEthereumChain';

/**
 * Machine codes a caller can act on.
 *
 * Every one of them is a fact about the SESSION or about the WAIT — never a
 * guess about the user's connection. That is the whole point of this file.
 */
export const SIGN_ERRORS = Object.freeze({
  SESSION_GONE: 'WALLET_SESSION_GONE',
  RELAY_DOWN: 'WALLET_RELAY_DOWN',
  METHOD_UNAPPROVED: 'WALLET_METHOD_UNAPPROVED',
  CHAIN_UNAPPROVED: 'WALLET_CHAIN_UNAPPROVED',
  CHAIN_NOT_APPROVED: 'WALLET_CHAIN_NOT_APPROVED',
  NO_RESPONSE: 'WALLET_NO_RESPONSE',
  NO_ACCOUNT: 'WALLET_NO_ACCOUNT',
  /**
   * The user went to the wallet and CAME BACK without approving or rejecting
   * (Back button, swipe-away, closed the wallet). Nothing will ever settle
   * that request from the wallet's side, so the app must stop waiting and
   * say so — the report: «وقتی میزنی که امضا کنی و برگردی بدون انجام کار …
   * هنوز منتظر می‌ماند بدون اینکه بفهمد لغو شده».
   */
  RETURNED_UNSIGNED: 'WALLET_RETURNED_UNSIGNED'
});

/**
 * Flatten one WalletConnect session into the three sets a request must be
 * measured against.
 *
 * `namespaces` is the shape the SDK settled with the wallet:
 * `session.namespaces.eip155 = { chains: ['eip155:56'], methods: [...],
 * accounts: ['eip155:56:0xabc…'] }`. Optional namespaces live beside it and
 * count just as much — a wallet that accepted the optional chains approved
 * them.
 *
 * An EMPTY set means «unknown», not «none»: this function never invents a
 * refusal, and every check below fails open on a set it could not read.
 */
export function sessionCoverage(session) {
  const empty = { methods: new Set(), chains: new Set(), accounts: new Set(), byChain: new Set() };
  if (!session || typeof session !== 'object') return empty;
  const namespaces = session.namespaces ?? {};
  const target = namespaces.eip155 ?? namespaces['eip155:1'] ?? null;
  if (!target) return empty;
  const methods = new Set();
  const chains = new Set();
  const accounts = new Set();
  const byChain = new Set();
  for (const value of target.methods ?? []) methods.add(String(value));
  for (const value of target.chains ?? []) chains.add(String(value).toLowerCase());
  for (const value of target.accounts ?? []) {
    const text = String(value).toLowerCase();
    accounts.add(text);
    const [ns, chain] = text.split(':');
    if (ns && chain) byChain.add(chain);
  }
  /* `requiredNamespaces`/`optionalNamespaces` are the pre-settlement names of
     the same thing — some SDK revisions keep them alive on the record. */
  for (const key of ['requiredNamespaces', 'optionalNamespaces']) {
    const ns = session[key]?.eip155;
    if (!ns) continue;
    for (const value of ns.methods ?? []) methods.add(String(value));
    for (const value of ns.chains ?? []) chains.add(String(value).toLowerCase());
    for (const value of ns.accounts ?? []) {
      const text = String(value).toLowerCase();
      accounts.add(text);
      const [, chain] = text.split(':');
      if (chain) byChain.add(chain);
    }
  }
  /* NOTE, deliberately: a chain present in `chains` is NOT treated as covering
     its accounts. It is exactly the state the «no signature screen» report
     describes — the namespace says Base is allowed while the only account the
     wallet ever named is on BSC — and a request built for `eip155:8453:0x…`
     against that record is one the wallet is entitled to drop. The fix is a
     switch, which the guard performs; the guard does not pretend the switch
     already happened. */
  return { methods, chains, accounts, byChain };
}

/** `eip155:8453:0xabc…` — the CAIP-10 account a request is aimed at. */
export function caipAccount(chainId, address) {
  const cid = Number(chainId);
  const acct = String(address ?? '').trim().toLowerCase();
  if (!Number.isFinite(cid) || cid <= 0 || !acct) return '';
  return `eip155:${cid}:${acct}`;
}

/**
 * Can this session answer this request?
 *
 * @returns {{ok:true} | {ok:false, code:string, fix?:'switch'|'reopen', detail?:object}}
 *
 * Fails OPEN on anything it cannot read: a guard that refuses a signature
 * because it could not parse a namespace is a worse bug than the one it was
 * written to catch.
 */
export function preflightSignRequest({
  session = null,
  method = '',
  chainId = null,
  address = null,
  relayConnected = null
} = {}) {
  if (!session) return { ok: false, code: SIGN_ERRORS.SESSION_GONE };
  if (!address) return { ok: false, code: SIGN_ERRORS.NO_ACCOUNT };

  /* The socket first: a request published into a closed relay is a request
     nobody receives, and every symptom that follows («هیچ صفحه امضایی نیامد»)
     is downstream of it. */
  if (relayConnected === false) {
    return { ok: false, code: SIGN_ERRORS.RELAY_DOWN, fix: 'reopen' };
  }

  const coverage = sessionCoverage(session);

  if (coverage.methods.size > 0 && !coverage.methods.has(String(method))) {
    return {
      ok: false,
      code: SIGN_ERRORS.METHOD_UNAPPROVED,
      detail: { method, allowed: [...coverage.methods].slice(0, 12) }
    };
  }

  const cid = Number(chainId);
  if (Number.isFinite(cid) && cid > 0) {
    const inChains = coverage.chains.has(`eip155:${cid}`);
    /* An EMPTY account list is «unknown», and unknown fails open: a guard that
       refuses a signature because it could not read a namespace is a worse bug
       than the one it was written to catch. */
    const accountCovered =
      coverage.accounts.size === 0 || coverage.accounts.has(caipAccount(cid, address));
    if (!accountCovered) {
      return {
        ok: false,
        /* The chain is approved but the session's account for it is not the
           one we are about to send from — asking the wallet to switch is the
           fix, and it is a fix the wallet can perform without a new pairing. */
        code: inChains ? SIGN_ERRORS.CHAIN_UNAPPROVED : SIGN_ERRORS.CHAIN_NOT_APPROVED,
        fix: inChains ? 'switch' : undefined,
        detail: { chainId: cid, approved: inChains }
      };
    }
  }

  return { ok: true };
}

/**
 * Classify a rejected signing request.
 *
 * `null` means «leave the original error alone» — a user rejection is the
 * caller's business (every panel handles 4001 itself), and an unknown error is
 * more useful as itself than as a guess.
 */
export function classifySignError(error) {
  const msg = String(error?.message ?? '').trim();
  if (!msg) return null;
  if (error?.code === 4001 || /user rejected|user denied|rejected by user|request rejected/i.test(msg)) {
    return null;
  }
  if (msg === SIGN_ERRORS.RETURNED_UNSIGNED) return SIGN_ERRORS.RETURNED_UNSIGNED;
  if (
    msg === SIGN_ERRORS.NO_RESPONSE ||
    /no matching key|session topic doesn't exist|session not found|no session/i.test(msg) ||
    /expired/i.test(msg)
  ) {
    return /expired|no matching key|session topic|session not found|no session/i.test(msg)
      ? SIGN_ERRORS.SESSION_GONE
      : SIGN_ERRORS.NO_RESPONSE;
  }
  if (/websocket|socket stalled|socket error|relay|failed to publish|network/i.test(msg)) {
    return SIGN_ERRORS.RELAY_DOWN;
  }
  if (/unauthorized method|method not found|method not supported/i.test(msg)) {
    return SIGN_ERRORS.METHOD_UNAPPROVED;
  }
  if (/chain|unsupported chain|does not have/i.test(msg)) {
    return SIGN_ERRORS.CHAIN_NOT_APPROVED;
  }
  return null;
}

/** An error carrying a machine code, so the UI can translate it. */
export function signError(code, detail) {
  const error = new Error(code);
  error.code = code;
  error.signError = true;
  if (detail) error.detail = detail;
  return error;
}

/** The relayer behind a WalletConnect provider, or null. */
export function relayOf(eip) {
  return eip?.signer?.client?.core?.relayer ?? eip?.signer?.core?.relayer ?? null;
}

/** Is the relay socket open? `null` when there is no relay to ask. */
export function relayConnected(eip) {
  const relay = relayOf(eip);
  if (!relay) return null;
  if (relay.connected === true) return true;
  if (relay.connecting === true) return null;
  return false;
}

/**
 * Re-open a closed relay socket, bounded.
 *
 * The SDK's own `transportOpen()` is what `Relayer.init()` uses; calling it
 * again is the supported way back from a socket the phone closed while the tab
 * was frozen. Bounded, because a network that filters the relay will not
 * answer this either — and a permanent hang is the symptom we are fixing.
 */
export async function reopenRelay(eip, { withTimeout: race = null } = {}) {
  const relay = relayOf(eip);
  if (!relay || typeof relay.transportOpen !== 'function') return false;
  try {
    const pending = Promise.resolve(relay.transportOpen());
    if (typeof race === 'function') await race(pending);
    else await pending;
    return relay.connected === true;
  } catch {
    return false;
  }
}

/**
 * How long a request may stay unanswered AFTER the user has come back from
 * the wallet.
 *
 * ─── THE BUG THIS CLOSES ───────────────────────────────────────────────────
 * «در صفحه پل وقتی می‌زنی که امضا کنی و برمی‌گردی بدون انجام کار، هنوز منتظر
 * می‌ماند بدون اینکه بفهمد لغو شده.» A WalletConnect wallet that is dismissed
 * with the Back button never publishes a rejection — from the relay's point
 * of view the request is simply still open. The page hid (the wallet came to
 * the front), the pausable clock stopped, the user came back, the clock
 * resumed with almost its whole three-minute budget intact, and the button
 * read «در کیف پول تأیید کن…» for three more minutes over a wallet nobody was
 * in.
 *
 * The return itself is the signal. A wallet that approved publishes the
 * response within a few seconds of the app regaining focus (the relay
 * round-trip); one that was left without an answer never will. So once the
 * document is visible again after having been hidden for a signing request,
 * the remaining budget collapses to this grace window, and the failure it
 * ends with names what happened: RETURNED_UNSIGNED, not NO_RESPONSE.
 *
 * 12 seconds is generous for a relay round-trip on a slow mobile network and
 * short enough that the user is not staring at a spinner after pressing Back.
 */
export const RETURN_GRACE_MS = 12_000;

/**
 * Stop the signing clock while this document is not on screen, and collapse
 * the wait when the user comes back from the wallet without an answer.
 *
 * `wentAway` records that the wallet had the screen at least once for this
 * request: a request that never left this document (a desktop QR session,
 * a wallet in a side panel) is NOT shortened on an unrelated tab switch —
 * only the hide→show pair that a mobile app-switch produces is treated as
 * a return from the wallet.
 */
function watchHiddenPause(bound, doc, { returnGraceMs = RETURN_GRACE_MS, onReturn = null } = {}) {
  if (!doc || typeof doc.addEventListener !== 'function') return () => {};
  let wentAway = false;
  const onVisibility = () => {
    try {
      if (doc.visibilityState === 'hidden') {
        wentAway = true;
        bound.pause();
      } else {
        bound.resume();
        if (wentAway && Number.isFinite(returnGraceMs) && returnGraceMs >= 0) {
          bound.shorten?.(returnGraceMs, SIGN_ERRORS.RETURNED_UNSIGNED);
          try { onReturn?.(); } catch { /* a trace is not load-bearing */ }
        }
      }
    } catch { /* a clock that cannot be paused is still a clock */ }
  };
  if (doc.visibilityState === 'hidden') onVisibility();
  doc.addEventListener('visibilitychange', onVisibility);
  return () => doc.removeEventListener('visibilitychange', onVisibility);
}

/**
 * Wrap one EIP-1193 provider so every signing request is preflighted and
 * bounded.
 *
 * Everything that is not a signature passes straight through: the guard is not
 * a policy engine, it is a seatbelt on the one class of request that can leave
 * the user staring at a wallet that never asks them anything.
 *
 * @param {object} eip
 * @param {object} [options]
 * @param {number} [options.timeoutMs]            visible budget for one signature
 * @param {number} [options.hardCapMs]            never wait past this, hidden or not
 * @param {number} [options.returnGraceMs]        how long to keep waiting once the
 *        user has come BACK from the wallet without an answer (see RETURN_GRACE_MS)
 * @param {(info:{method:string, chainId:number|null, address:string|null}) => void} [options.onSignatureRequest]
 *        Fired the moment a request is published — on mobile that is when the
 *        wallet app is brought back to the front, so the prompt is on screen
 *        when the user arrives.
 * @param {(name:string, detail:object) => void} [options.onTrace]
 * @param {Document} [options.doc]
 */
export function guardEip1193(eip, options = {}) {
  if (!eip || typeof eip.request !== 'function') return eip;
  const {
    timeoutMs = TIMEOUT.signInWallet,
    hardCapMs = TIMEOUT.signHardCap,
    returnGraceMs = RETURN_GRACE_MS,
    onSignatureRequest = null,
    onTrace = null,
    doc = typeof document !== 'undefined' ? document : null
  } = options;

  const trace = (name, detail) => {
    try {
      onTrace?.(name, detail);
    } catch { /* tracing is never load-bearing */ }
  };

  const chainIdOf = () => {
    const raw = eip.chainId;
    const n = typeof raw === 'string' && raw.startsWith('eip155:')
      ? Number(raw.slice(7))
      : Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const runPreflight = (method) => {
    const chainId = chainIdOf();
    const address = eip.accounts?.[0] ?? null;
    return {
      chainId,
      address,
      check: preflightSignRequest({
        session: eip.session,
        method,
        chainId,
        address,
        relayConnected: relayConnected(eip)
      })
    };
  };

  async function sign(method, args, rest) {
    let { chainId, address, check } = runPreflight(method);

    /* FIX 1 — a closed socket is re-opened before the user hears anything. */
    if (!check.ok && check.fix === 'reopen') {
      trace('sign_relay_reopen');
      const back = await reopenRelay(eip, {
        withTimeout: (pending) =>
          new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('RELAY_REOPEN_TIMEOUT')), TIMEOUT.signRelayReopen);
            Promise.resolve(pending).then(
              (v) => { clearTimeout(timer); resolve(v); },
              (e) => { clearTimeout(timer); reject(e); }
            );
          })
      });
      if (back) ({ chainId, address, check } = runPreflight(method));
      else trace('sign_relay_reopen_failed');
    }

    /* FIX 2 — a chain the session approves but has no account for is answered
       by asking the wallet to move to it, once. */
    if (!check.ok && check.fix === 'switch') {
      trace('sign_chain_switch', { chainId });
      let switched = false;
      try {
        await eip.request({
          method: SWITCH_METHOD,
          params: [{ chainId: `0x${Number(chainId).toString(16)}` }]
        });
        switched = true;
      } catch {
        trace('sign_chain_switch_failed');
      }
      if (switched) {
        /* The WALLET is the authority on which network it is on. Its own answer
           outranks a session record that has not been re-derived yet, so the
           request goes out — refusing it here would be refusing the user's
           deposit on the strength of a stale list. */
        check = { ok: true, via: 'switch' };
      } else {
        ({ chainId, address, check } = runPreflight(method));
      }
    }

    if (!check.ok) {
      trace('sign_refused', { code: check.code });
      throw signError(check.code, check.detail);
    }

    const bound = pauseBound(timeoutMs, SIGN_ERRORS.NO_RESPONSE, { hardCapMs });
    const stopWatching = watchHiddenPause(bound, doc, {
      returnGraceMs,
      onReturn: () => trace('sign_returned_waiting', { method, graceMs: returnGraceMs })
    });
    try {
      const pending = Promise.resolve(eip.request(args, ...rest));
      /* The request is on its way: this is the moment to bring the wallet app
         back to the front, not after the user has waited and come looking. */
      try {
        onSignatureRequest?.({ method, chainId, address });
      } catch { /* a nudge that fails must not cancel a request in flight */ }
      return await Promise.race([pending, bound.promise]);
    } catch (error) {
      const code = classifySignError(error);
      if (code) throw signError(code, { from: String(error?.message ?? '').slice(0, 160) });
      throw error;
    } finally {
      bound.stop();
      stopWatching();
    }
  }

  const guard = {
    request: (args, ...rest) => {
      const method = String(args?.method ?? '');
      if (!isSigningMethod(method)) return eip.request(args, ...rest);
      return sign(method, args, rest);
    }
  };

  /* Forward everything else — methods and read-only state alike — so the
     wrapper is indistinguishable from the provider it stands in front of. */
  const proto = Object.getPrototypeOf(eip);
  const names = new Set([
    ...Object.getOwnPropertyNames(proto ?? {}),
    ...Object.getOwnPropertyNames(eip)
  ]);
  for (const name of names) {
    if (name === 'constructor' || name in guard) continue;
    let descriptor = Object.getOwnPropertyDescriptor(eip, name);
    if (!descriptor && proto) descriptor = Object.getOwnPropertyDescriptor(proto, name);
    if (!descriptor) continue;
    try {
      if (typeof descriptor.value === 'function') {
        guard[name] = (...args) => eip[name](...args);
      } else {
        /*
         * EVERYTHING ELSE IS MIRRORED LIVE, NEVER COPIED.
         *
         * `chainId` and `accounts` are plain data properties on the SDK's
         * provider, and copying them would freeze them at wrap time — a
         * provider that keeps reporting the chain it had when it was attached
         * is how a wallet comes to sign on the wrong network. So the values are
         * read through, in both directions.
         */
        Object.defineProperty(guard, name, {
          get: () => eip[name],
          set: (value) => { eip[name] = value; },
          enumerable: true,
          configurable: true
        });
      }
    } catch { /* a property that cannot be mirrored does not matter here */ }
  }

  return guard;
}
