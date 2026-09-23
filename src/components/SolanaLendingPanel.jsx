import { useCallback, useEffect, useRef, useState } from 'react';
import { useSolanaWallet } from '../hooks/useSolanaWallet.js';
import AssetIcon from './AssetIcon.jsx';
import { loanErrorText } from '../lib/loanErrors.js';
import { mapRawError } from '../lib/lending-engine/errors.js';
import {
  buildSolanaLendingTransactions,
  readSolanaLendingMarket,
  waitForSolanaLendingTransaction,
  preflightSolanaAction,
  SOLANA_LENDING_EXPLORER,
  toSolanaUnits
} from '../lib/solanaLending.js';

/*
 * ── WHY THIS PANEL KNOWS ABOUT THE DEEP-LINK RESULT ─────────────────────────
 * «گاهی اصلا امضا نمی‌کند» (2026-09-23 report).
 *
 * On a phone the signature is often obtained through a deep link: the request
 * is handed to the wallet app, the wallet shows its own approval screen, and
 * the answer comes back as a NEW PAGE LOAD carrying a request id. That page
 * load destroys the promise the panel was awaiting, so `signAndSendTransaction`
 * answers `IN_WALLET` — «it is in your wallet now». The signature itself is not
 * lost: lib/solana/deeplink.js stores it under the request id and publishes it
 * as the last result. The panel, though, never read either, so the user
 * approved a transaction in their wallet, came back to a screen that said
 * nothing, and watched a position that had not moved. The request WAS signed;
 * the app never finished it.
 *
 * So the panel now (a) remembers the id of the request it handed over, (b)
 * shows «waiting for your wallet» with a reopen link while it is unanswered,
 * and (c) when the answer exists, confirms the transaction on-chain, links to
 * it and refreshes the position — the same ending it has on the injected path.
 */
const PENDING_KEY = 'fbtswap.loan.pendingSign';

function readPending() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(PENDING_KEY) : null;
    const row = raw ? JSON.parse(raw) : null;
    return row && row.id ? row : null;
  } catch { return null; }
}

function writePending(row) {
  try {
    if (typeof localStorage === 'undefined') return;
    if (row) localStorage.setItem(PENDING_KEY, JSON.stringify(row));
    else localStorage.removeItem(PENDING_KEY);
  } catch { /* storage is a nicety here, never a requirement */ }
}

/*
 * Codes that mean «the wallet did not open / did not answer» rather than
 * «the transaction failed». They get the incident copy, because the reason is
 * outside this app: a locked wallet, an unanswered approval screen, a network
 * the wallet does not know. Anything else keeps the one-sentence treatment.
 */
const WALLET_DID_NOT_OPEN = new Set([
  'IN_WALLET', 'TIMEOUT', 'NO_SESSION', 'NO_ACCOUNT', 'NO_WALLET',
  'WALLET_NOT_FOUND', 'CONNECT_FAILED', 'SOLANA_WALLET_REQUIRED'
]);
const WALLET_WRONG_CHAIN = new Set(['WRONG_NETWORK', 'UNSUPPORTED_CHAIN', 'EXECUTION_WRONG_CHAIN']);

function WalletIncident({ code, t }) {
  const normalized = String(code || '');
  if (!WALLET_DID_NOT_OPEN.has(normalized) && !WALLET_WRONG_CHAIN.has(normalized)) return null;
  return (
    <div
      data-testid="solana-loan-wallet-incident"
      data-code={normalized}
      style={{
        marginTop: 8, padding: '9px 10px', borderRadius: 11,
        background: 'rgba(251,191,36,0.10)', border: '1px solid rgba(251,191,36,0.28)',
      }}
    >
      <div style={{ color: '#fbbf24', fontSize: 11.5, fontWeight: 800, marginBottom: 3 }}>{t('loan.wallet.title')}</div>
      <p style={{ color: 'var(--text-2)', fontSize: 10.5, lineHeight: 1.7, margin: 0 }}>{t('loan.wallet.switch')}</p>
    </div>
  );
}

/*
 * What an RPC incident looks like on screen: the localized sentence for the
 * failure class, then the per-host list with a localized reason each, then the
 * one action that ends the dependence on public nodes. The raw transport text
 * stays as a small LTR witness line (§28) — it is not the explanation, it is
 * the evidence, and it stays out of the way when the host list is present.
 */
function RpcIncident({ hosts, t }) {
  if (!Array.isArray(hosts) || !hosts.length) return null;
  const shown = hosts.slice(0, 3);
  const extra = hosts.length - shown.length;
  return (
    <div data-testid="solana-loan-rpc-incident" style={{ marginTop: 2 }}>
      <p style={{ margin: '0 0 5px', color: 'var(--text-2)', fontSize: 11.5, lineHeight: 1.7 }}>{t('loan.rpc.body')}</p>
      <ul style={{ margin: '0 0 7px', paddingInlineStart: 16, display: 'grid', gap: 3 }}>
        {shown.map((row) => (
          <li key={`${row.host}-${row.reason}`} style={{ fontSize: 11, lineHeight: 1.65, color: 'var(--text-2)' }}>
            {row.relay
              ? <span>{t('loan.rpc.relayHost')}</span>
              : <span dir="ltr" style={{ fontFamily: 'var(--font-mono)', fontStyle: 'normal', direction: 'ltr', unicodeBidi: 'isolate' }}>{row.host}</span>}
            {' — '}
            <span style={{ color: '#fbbf24' }}>{loanErrorText(t, row.reason)}</span>
          </li>
        ))}
      </ul>
      {extra > 0 ? (
        <details style={{ margin: '0 0 7px', fontSize: 11, color: 'var(--text-3)' }}>
          <summary style={{ cursor: 'pointer', color: 'var(--text-2)', fontWeight: 600 }}>{t('loan.rpc.showMore', { n: extra, defaultValue: `نمایش ${extra} مورد دیگر` })}</summary>
          <ul style={{ margin: '6px 0 0', paddingInlineStart: 16, display: 'grid', gap: 3 }}>
            {hosts.slice(3).map((row) => (
              <li key={`${row.host}-${row.reason}`} style={{ fontSize: 11, lineHeight: 1.65, color: 'var(--text-2)' }}>
                {row.relay ? <span>{t('loan.rpc.relayHost')}</span> : <span dir="ltr" style={{ fontFamily: 'var(--font-mono)', direction: 'ltr', unicodeBidi: 'isolate' }}>{row.host}</span>}
                {' — '}<span style={{ color: '#fbbf24' }}>{loanErrorText(t, row.reason)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <p style={{ margin: 0, color: 'var(--text-3)', fontSize: 10.5, lineHeight: 1.7 }}>{t('loan.rpc.useOwn')}</p>
    </div>
  );
}

const card = {
  borderRadius: 18,
  border: '1px solid rgba(255,255,255,0.09)',
  background: 'linear-gradient(150deg, rgba(255,255,255,0.055), rgba(255,255,255,0.022))',
  boxShadow: '0 14px 32px rgba(0,0,0,0.16)',
};

const fmt = (value, digits = 2) => value == null || !Number.isFinite(Number(value))
  ? '—'
  : Number(value).toLocaleString(
    typeof document !== 'undefined' ? document.documentElement.lang || undefined : undefined,
    { maximumFractionDigits: digits }
  );

function DataBadge({ t, status }) {
  return (
    <span
      data-testid="solana-loan-data-status"
      data-status={status}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        borderRadius: 999, padding: '4px 8px', fontSize: 10, fontWeight: 800,
        color: status === 'live' ? '#86efac' : '#fbbf24',
        background: status === 'live' ? 'rgba(74,222,128,0.12)' : 'rgba(251,191,36,0.12)',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 99, background: 'currentColor' }} />
      {t(status === 'live' ? 'loan.status.live' : 'loan.status.unavailable')}
    </span>
  );
}

function Metric({ label, value, sub }) {
  return (
    <div style={{ minWidth: 0, padding: '10px 11px', borderRadius: 13, background: 'rgba(0,0,0,0.15)' }}>
      <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 850, fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
      {sub ? <div style={{ fontSize: 9.5, color: 'var(--text-3)', marginTop: 3 }}>{sub}</div> : null}
    </div>
  );
}

function SolanaAssetCard({ asset, selected, onSelect, t }) {
  const active = selected?.id === asset.id;
  return (
    <button
      type="button"
      data-testid={`solana-loan-asset-${asset.symbol.toLowerCase()}`}
      onClick={() => onSelect(asset)}
      style={{
        ...card, width: '100%', textAlign: 'start', cursor: 'pointer',
        padding: '13px 14px', display: 'flex', alignItems: 'center', gap: 12,
        borderColor: active ? '#9945ff99' : 'rgba(255,255,255,0.09)',
        background: active ? 'linear-gradient(135deg, rgba(153,69,255,0.20), rgba(20,184,166,0.08))' : card.background,
      }}
    >
      <span style={{ width: 39, height: 39, flexShrink: 0, display: 'block' }}>
        <AssetIcon symbol={asset.symbol} chain="solana" size={39} radius={14} alt={asset.symbol} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 800 }}>{asset.symbol}</span>
        <span style={{ display: 'block', color: 'var(--text-3)', fontSize: 10.5, marginTop: 2 }}>{t('loan.solana.marketReserve')}</span>
      </span>
      <span style={{ textAlign: 'end', fontFamily: 'var(--font-mono)' }}>
        <span style={{ display: 'block', color: '#86efac', fontSize: 11, fontWeight: 800 }}>{asset.supplyApyPct == null ? '—' : `+${fmt(asset.supplyApyPct)}%`}</span>
        <span style={{ display: 'block', color: '#fca5a5', fontSize: 10, marginTop: 2 }}>{asset.borrowApyPct == null ? '—' : `${fmt(asset.borrowApyPct)}%`}</span>
      </span>
    </button>
  );
}

export default function SolanaLendingPanel({ t, tab, setTab, preset }) {
  const wallet = useSolanaWallet();
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [amount, setAmount] = useState('');
  const [action, setAction] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [actionDetail, setActionDetail] = useState(null);
  const [lastSignature, setLastSignature] = useState(null);
  /* A request this panel handed to a wallet app (deep link) and has not seen
     the answer to yet. `waiting` is display state; the proof that it is still
     ours lives in storage, because the wallet's return replaces this document. */
  const [waiting, setWaiting] = useState(() => readPending());
  const claimingRef = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      /* No rpcUrl here on purpose: the lending client resolves the app's
         probed Solana RPC layer (custom endpoint first, then the community
         nodes) instead of pinning the Foundation's most-throttled host. */
      const next = await readSolanaLendingMarket({ wallet: wallet.address });
      if (!next.ok) {
        /* A not-ok ANSWER (rather than a thrown failure) must keep the same
           diagnostics a throw would carry: without `hosts` the panel can only
           say «the market is unavailable», which is the sentence the report was
           about. */
        const failure = new Error(next.code || 'PROTOCOL_UNAVAILABLE');
        failure.code = next.code || 'PROTOCOL_UNAVAILABLE';
        failure.detail = String(next.detail || '');
        failure.hosts = Array.isArray(next.hosts) ? next.hosts : null;
        throw failure;
      }
      setSnapshot(next);
      setSelected((current) => {
        const list = next.assets || [];
        return list.find((asset) => asset.id === current?.id)
          || list.find((asset) => asset.symbol === preset?.symbol)
          || list[0]
          || null;
      });
    } catch (cause) {
      /* The failure is a CODE (KAMINO_SDK_UNAVAILABLE / RPC_ERROR /
         RPC_RATE_LIMITED / KAMINO_MARKET_UNAVAILABLE), kept separate from the
         raw transport detail so the panel can show a localized sentence and
         still keep diagnostics one tap away (§28). */
      setError({
        code: String(cause?.code || cause?.message || 'PROTOCOL_UNAVAILABLE'),
        detail: String(cause?.detail || cause?.message || '').slice(0, 160),
        /* The per-host verdicts, when the failure was an RPC one. They reach
           the screen as sentences («host — rate limited»), which is the whole
           difference between «server is broken» and «this node refused you». */
        hosts: Array.isArray(cause?.hosts) ? cause.hosts : null
      });
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  }, [wallet.address, preset?.symbol]);

  useEffect(() => { refresh(); }, [refresh]);

  /*
   * Claim the answer to a handed-over signature.
   *
   * Runs on mount (the wallet's return is a page load), when the tab becomes
   * visible again (Android/iOS app switch fires no page load), and when the
   * deeplink layer reports a terminal state for our request id. The signature
   * was stored by lib/solana/deeplink.js under the id we saved; what was
   * missing was anybody finishing the job — confirming it on-chain, linking to
   * it and refreshing the position.
   */
  const claimPendingSignature = useCallback(async () => {
    const row = readPending();
    if (!row?.id || claimingRef.current) return false;
    const { deeplinkResultFor, pendingDeeplinkRequest } = await import('../lib/solana/deeplink.js');
    /* Still sitting in the wallet unanswered — keep showing «waiting». */
    if (pendingDeeplinkRequest()?.id === row.id && !deeplinkResultFor(row.id)) {
      setWaiting(row);
      return false;
    }
    const answer = deeplinkResultFor(row.id);
    if (!answer) return false;
    claimingRef.current = true;
    try {
      writePending(null);
      setWaiting(null);
      if (!answer.ok) { setActionError(String(answer.code || 'SIGN_FAILED')); return true; }
      if (!answer.signature) { setActionError('NO_SIGNATURE'); return true; }
      const confirmed = await waitForSolanaLendingTransaction(answer.signature);
      if (!confirmed.ok) { setActionError(String(confirmed.code || 'SOLANA_SEND_FAILED')); return true; }
      setLastSignature(answer.signature);
      setAmount('');
      await refresh();
      return true;
    } finally {
      claimingRef.current = false;
    }
  }, [refresh]);

  useEffect(() => {
    claimPendingSignature();
    const onVisible = () => { if (document.visibilityState === 'visible') claimPendingSignature(); };
    document.addEventListener('visibilitychange', onVisible);
    let unsubscribe = () => {};
    let alive = true;
    import('../lib/solana/deeplink.js').then(({ subscribeDeeplink }) => {
      if (!alive) return;
      unsubscribe = subscribeDeeplink((state) => {
        const row = readPending();
        if (row?.id && state?.requestId === row.id && (state.status === 'signed' || state.status === 'error')) {
          claimPendingSignature();
        }
      });
    }).catch(() => {});
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
      unsubscribe();
    };
  }, [claimPendingSignature]);

  const assets = snapshot?.assets || [];
  const currentPosition = selected ? snapshot?.positions?.[selected.id] : null;
  const currentDecimals = Number(selected?.decimals || 0);
  const maxForTab = tab === 'borrow'
    ? null
    : tab === 'positions' && currentPosition
      ? (Number(currentPosition.borrowed) > 0 ? currentPosition.borrowed : currentPosition.supplied)
      : null;

  const connect = async () => {
    setActionError(null);
    setActionDetail(null);
    const result = await wallet.connect({ returnTo: window.location.href });
    if (result && typeof result === 'object' && result.ok === false) setActionError(result.code);
  };

  const runAction = async (nextAction, overrides = {}) => {
    const actionAsset = overrides.asset || selected;
    const actionAmount = overrides.value ?? amount;
    setActionError(null);
    setActionDetail(null);
    setLastSignature(null);
    if (!wallet.address) { setActionError('SOLANA_WALLET_REQUIRED'); return; }
    if (!actionAsset) { setActionError('SOLANA_ASSET_REQUIRED'); return; }
    if (!actionAmount || !toSolanaUnits(actionAmount, Number(actionAsset.decimals || 0))) { setActionError('AMOUNT_REQUIRED'); return; }
    /* §7 — preflight BEFORE the wallet is asked for anything: balances and
       positions come from the latest market read; when they could not be
       read, the honest answer is to refuse the popup, not to let it open for
       a transaction the chain would refuse at the user's expense. */
    const preflight = preflightSolanaAction({ action: nextAction, asset: actionAsset, amount: actionAmount, snapshot });
    if (!preflight.ok) { setActionError(preflight.code); return; }
    setAction(nextAction);
    try {
      const built = await buildSolanaLendingTransactions({ action: nextAction, asset: actionAsset, amount: actionAmount, wallet: wallet.address });
      if (!built.ok) throw new Error(built.code);
      if (typeof wallet.signAndSendTransaction !== 'function') throw new Error('SOLANA_SIGN_UNAVAILABLE');
      writePending(null);
      setWaiting(null);
      let signature = null;
      for (const tx of built.transactions) {
        /* The transaction's OWN version, from the builder — never assumed.
           klend-sdk v5 returns LEGACY transactions; the older API returned v0.
           The wallet layer deserializes with `VersionedTransaction` when
           `versioned` is true and with the legacy `Transaction` when it is
           false, so a hardcoded flag throws on the bytes of the other kind
           before the user ever sees an approval — which is exactly what both
           directions of this bug looked like from the panel. */
        const sent = await wallet.signAndSendTransaction(tx.transaction, { versioned: tx.versioned !== false });
        /* IN_WALLET means «the request is in your wallet app»: on a phone the
           approval screen belongs to the wallet and the answer returns as a
           page load. That is NOT a failure and must not be reported as one —
           it is a request to finish (see claimPendingSignature). */
        if (sent?.code === 'IN_WALLET' || sent?.code === 'IN_WALLET_PENDING') {
          const row = { id: sent.id || null, at: Date.now(), action: nextAction, symbol: actionAsset.symbol };
          if (row.id) { writePending(row); setWaiting(row); }
          setActionError(row.id ? null : 'IN_WALLET');
          setActionDetail(null);
          return;
        }
        if (!sent?.ok || !sent.signature) throw new Error(sent?.code || 'SOLANA_SEND_FAILED');
        const confirmed = await waitForSolanaLendingTransaction(sent.signature);
        if (!confirmed.ok) throw new Error(confirmed.code || 'SOLANA_SEND_FAILED');
        signature = sent.signature;
      }
      setLastSignature(signature);
      setAmount('');
      await refresh();
    } catch (cause) {
      /* A CODE renders as a sentence; wallet/RPC PROSE («Transaction
         simulation failed: …») must not be pasted into the generic
         «… (CODE)» sentence — it is not a code. Prose is mapped to the
         nearest real code, and kept as an evidence line below. */
      const raw = String(cause?.code || cause?.message || cause || '').trim();
      const isCode = /^[A-Z][A-Z0-9_]{2,40}$/.test(raw);
      const code = isCode ? raw : mapRawError({ code: cause?.code, message: raw }, { fallback: 'SEND_FAILED' }).code;
      setActionError(code);
      setActionDetail(isCode ? null : raw.slice(0, 160));
    } finally {
      setAction(null);
    }
  };

  const tabs = [
    ['supply', t('loan.tabSupply')],
    ['borrow', t('loan.tabBorrow')],
    ['positions', t('loan.tabPositions')]
  ];

  return (
    <section data-testid="solana-lending-panel" dir="inherit">
      <div style={{ ...card, padding: '16px', marginBottom: 12, background: 'linear-gradient(140deg, rgba(153,69,255,0.20), rgba(20,184,166,0.10) 70%, rgba(255,255,255,0.03))' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
          <div style={{ width: 46, height: 46, flexShrink: 0 }}><AssetIcon symbol="SOL" chain="solana" size={46} radius={15} alt="SOL" /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 900, fontSize: 17 }}>{t('loan.solana.title')}</div>
            <div style={{ color: 'var(--text-2)', fontSize: 11.5, lineHeight: 1.65, marginTop: 3 }}>{t('loan.solana.subtitle')}</div>
          </div>
          <DataBadge t={t} status={snapshot?.dataStatus || 'unavailable'} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 7, marginTop: 14 }}>
          {/* When the obligation could not be READ, its figures are placeholder
              zeros — they render as '—' with a retry, never as $0.00 that reads
              as "you have no position". */}
          <Metric label={t('loan.collateral')} value={snapshot?.account && !snapshot.account.unknown ? `$${fmt(snapshot.account.totalCollateralUsd)}` : '—'} />
          <Metric label={t('loan.debt')} value={snapshot?.account && !snapshot.account.unknown ? `$${fmt(snapshot.account.totalDebtUsd)}` : '—'} />
          <Metric label={t('loan.borrowPower')} value={snapshot?.account && !snapshot.account.unknown ? `$${fmt(snapshot.account.availableBorrowsUsd)}` : '—'} />
        </div>
        {snapshot?.account?.unknown && (
          <button
            type="button"
            data-testid="solana-loan-position-retry"
            onClick={refresh}
            style={{
              width: '100%', marginTop: 9, padding: '9px 10px', borderRadius: 11, cursor: 'pointer',
              fontSize: 11, fontWeight: 700, color: '#fbbf24',
              background: 'rgba(251,191,36,0.10)', border: '1px solid rgba(251,191,36,0.28)',
            }}
          >
            {loanErrorText(t, 'RPC_ERROR')} · {t('loan.retry')}
          </button>
        )}
        {!wallet.address ? (
          <button type="button" className="btn btn-primary" data-testid="solana-loan-connect" onClick={connect} style={{ width: '100%', marginTop: 13 }}>{t('loan.connectWallet')}</button>
        ) : (
          <div style={{ marginTop: 12, padding: '8px 10px', borderRadius: 11, background: 'rgba(0,0,0,0.16)', fontSize: 10.5, color: 'var(--text-2)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {wallet.walletName || 'Solana'} · {wallet.address.slice(0, 6)}…{wallet.address.slice(-5)}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 5, padding: 4, borderRadius: 14, marginBottom: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
        {tabs.map(([id, label]) => <button key={id} type="button" data-testid={`solana-loan-tab-${id}`} onClick={() => setTab(id)} style={{ flex: 1, border: 0, borderRadius: 10, padding: '9px 5px', background: tab === id ? 'rgba(153,69,255,0.20)' : 'transparent', color: tab === id ? 'var(--text-1)' : 'var(--text-3)', fontWeight: tab === id ? 800 : 500, fontSize: 11.5 }}>{label}</button>)}
      </div>

      {loading && <div style={{ ...card, padding: 18, textAlign: 'center', color: 'var(--text-2)', fontSize: 12 }}>{t('loan.solana.loading')}</div>}
      {!loading && error && (
        <div
          data-testid="solana-loan-error"
          data-code={error.code}
          style={{
            ...card, padding: 0, overflow: 'hidden',
            borderColor: 'rgba(248,113,113,0.35)',
            background: 'linear-gradient(155deg, rgba(248,113,113,0.12), rgba(153,69,255,0.06) 60%, rgba(0,0,0,0.10))',
          }}
        >
          <div style={{ padding: '14px 14px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
              <span style={{
                width: 30, height: 30, borderRadius: 10, flexShrink: 0,
                display: 'grid', placeItems: 'center',
                background: 'rgba(248,113,113,0.16)', border: '1px solid rgba(248,113,113,0.28)',
                color: '#fca5a5', fontSize: 14,
              }}>⚠</span>
              <span style={{ fontWeight: 800, color: '#fca5a5', fontSize: 13, flex: 1 }}>
                {error.hosts?.length ? t('loan.rpc.title') : t('loan.unavailableTitle')}
              </span>
              <span
                dir="ltr"
                style={{
                  fontSize: 9, fontWeight: 800, letterSpacing: '.04em',
                  fontFamily: 'var(--font-mono)', direction: 'ltr', unicodeBidi: 'isolate',
                  color: 'var(--text-3)', background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.10)', borderRadius: 99, padding: '3px 8px',
                }}
              >{error.code}</span>
            </div>
            {/* The localized reason comes first; the protocol sentence stays
                as context beneath it, never the other way around. */}
            <p data-testid="solana-loan-error-reason" style={{ margin: '0 0 6px', color: 'var(--text-1)', fontSize: 12.5, fontWeight: 700, lineHeight: 1.75 }}>
              {/* Always a sentence: a code with no translation renders as the
                  localized generic WITH the code attached, never as itself. */}
              {loanErrorText(t, error.code || 'PROTOCOL_UNAVAILABLE')}
            </p>
            <p style={{ margin: 0, color: 'var(--text-3)', fontSize: 11, lineHeight: 1.75 }}>{t('loan.solana.unavailable')}</p>
            <RpcIncident hosts={error.hosts} t={t} />
            {error.detail && error.detail !== error.code && !error.hosts?.length ? (
              <p dir="ltr" className="faint" style={{ margin: '8px 0 0', fontSize: 9.5, fontFamily: 'var(--font-mono)', direction: 'ltr', unicodeBidi: 'isolate', wordBreak: 'break-word', opacity: 0.75 }}>
                {error.detail}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            data-testid="solana-loan-error-retry"
            onClick={refresh}
            style={{ width: '100%', borderRadius: 0, borderTop: '1px solid rgba(255,255,255,0.07)', padding: '11px' }}
          >
            {t('loan.retry')}
          </button>
        </div>
      )}

      {!loading && !error && tab !== 'positions' && (
        <>
          <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
            {assets.map((asset) => <SolanaAssetCard key={asset.id} asset={asset} selected={selected} onSelect={setSelected} t={t} />)}
          </div>
          {selected && (
            <div style={{ ...card, padding: 15 }}>
              <div className="row-between" style={{ gap: 8, marginBottom: 10 }}>
                <div style={{ fontWeight: 850 }}>{tab === 'borrow' ? t('loan.chooseBorrowAsset') : t('loan.chooseAsset')}</div>
                <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{selected.symbol}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 7, marginBottom: 11 }}>
                <Metric label={t('loan.supplyApyLine')} value={selected.supplyApyPct == null ? '—' : `${fmt(selected.supplyApyPct)}%`} />
                <Metric label={t('loan.borrowApyLine')} value={selected.borrowApyPct == null ? '—' : `${fmt(selected.borrowApyPct)}%`} />
                <Metric label={t('loan.maxLtv')} value={selected.loanToValuePct == null ? '—' : `${fmt(selected.loanToValuePct)}%`} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 8 }}>
                <label style={{ fontSize: 11.5, color: 'var(--text-2)' }}>{t('loan.amount')} · {selected.symbol}</label>
                {/* MAX means the wallet's real spendable balance — the number
                    the preflight checks the transaction against. Unreadable
                    balance renders no MAX rather than zero. */}
                {tab !== 'borrow' && currentPosition?.walletBalance != null && (
                  <button
                    type="button"
                    data-testid="solana-loan-max"
                    onClick={() => setAmount(String(currentPosition.walletBalance))}
                    style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-2)', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '3px 8px', cursor: 'pointer' }}
                  >
                    {t('loan.maxOf', { amount: currentPosition.walletBalance, symbol: selected.symbol })}
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 7 }}>
                <input data-testid="solana-loan-amount" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="0.00" style={{ flex: 1, minWidth: 0, borderRadius: 12, padding: '11px 12px', background: 'rgba(0,0,0,0.22)', border: '1px solid rgba(255,255,255,0.10)', color: 'var(--text-1)', fontFamily: 'var(--font-mono)' }} />
                <button type="button" className="btn btn-primary" data-testid="solana-loan-action" disabled={Boolean(action)} onClick={() => runAction(tab === 'borrow' ? 'borrow' : 'supply')} style={{ minWidth: 112 }}>{action ? t('loan.running') : tab === 'borrow' ? t('loan.borrowBtn', { symbol: selected.symbol }) : t('loan.supplyBtn', { symbol: selected.symbol })}</button>
              </div>
              {tab !== 'borrow' && wallet.address && currentPosition?.walletBalance == null && (
                <p data-testid="solana-loan-balance-unknown" style={{ color: '#fbbf24', fontSize: 10.5, margin: '8px 0 0' }}>{loanErrorText(t, 'BALANCE_UNKNOWN')}</p>
              )}
              {snapshot?.account && tab === 'borrow' && <p style={{ color: 'var(--text-3)', fontSize: 10.5, margin: '8px 0 0' }}>{t('loan.maxBorrowHint', { max: `$${fmt(snapshot.account.availableBorrowsUsd)}` })}</p>}
              {waiting?.id && (
                <div
                  data-testid="solana-loan-pending"
                  data-request={waiting.id}
                  style={{ marginTop: 9, padding: '9px 10px', borderRadius: 11, background: 'rgba(251,191,36,0.10)', border: '1px solid rgba(251,191,36,0.28)' }}
                >
                  <div style={{ color: '#fbbf24', fontSize: 11.5, fontWeight: 800, marginBottom: 3 }}>{t('loan.solana.pendingTitle')}</div>
                  <p style={{ color: 'var(--text-2)', fontSize: 10.5, lineHeight: 1.7, margin: '0 0 8px' }}>{t('loan.solana.pendingBody')}</p>
                  <div style={{ display: 'flex', gap: 7 }}>
                    <button type="button" className="btn btn-ghost btn-sm" data-testid="solana-loan-pending-reopen" style={{ flex: 1 }} onClick={async () => {
                      const { reopenDeeplinkRequest } = await import('../lib/solana/deeplink.js');
                      try { reopenDeeplinkRequest(waiting.id); } catch { /* the wallet app decides */ }
                    }}>{t('loan.solana.pendingReopen')}</button>
                    <button type="button" className="btn btn-ghost btn-sm" data-testid="solana-loan-pending-check" style={{ flex: 1 }} onClick={() => { claimPendingSignature(); }}>{t('loan.solana.pendingCheck')}</button>
                  </div>
                </div>
              )}
              {actionError && <p data-testid="solana-loan-action-error" style={{ color: '#fca5a5', fontSize: 11, lineHeight: 1.6, margin: '9px 0 0' }}>{loanErrorText(t, actionError)}</p>}
              {actionError && actionDetail && <p dir="ltr" className="faint" style={{ fontSize: 9.5, fontFamily: 'var(--font-mono)', direction: 'ltr', unicodeBidi: 'isolate', margin: '3px 0 0', opacity: 0.75, wordBreak: 'break-word' }}>{actionDetail}</p>}
              <WalletIncident code={actionError} t={t} />
              {lastSignature && <a data-testid="solana-loan-tx" href={`${SOLANA_LENDING_EXPLORER}/tx/${lastSignature}`} target="_blank" rel="noreferrer" style={{ display: 'block', color: '#a78bfa', fontSize: 10.5, marginTop: 9, fontFamily: 'var(--font-mono)' }}>{t('loan.solana.viewTransaction')} · {lastSignature.slice(0, 10)}…</a>}
            </div>
          )}
        </>
      )}

      {!loading && !error && tab === 'positions' && (
        <div style={{ display: 'grid', gap: 9 }}>
          {snapshot?.account?.unknown ? (
            <div style={{ ...card, padding: 15, borderColor: 'rgba(251,191,36,0.30)' }}>
              <div style={{ color: '#fbbf24', fontSize: 12, fontWeight: 700, lineHeight: 1.7 }}>{loanErrorText(t, 'RPC_ERROR')}</div>
              <button type="button" className="btn btn-ghost btn-sm" data-testid="solana-loan-positions-retry" onClick={refresh} style={{ width: '100%', marginTop: 10 }}>
                {t('loan.retry')}
              </button>
            </div>
          ) : (!wallet.address || !snapshot?.account?.ok ? <div style={{ ...card, padding: 17, color: 'var(--text-2)', fontSize: 12 }}>{t('loan.solana.noPosition')}</div> : null)}
          {assets.map((asset) => {
            const position = snapshot.positions?.[asset.id];
            const supplied = Number(position?.supplied || 0);
            const borrowed = Number(position?.borrowed || 0);
            if (supplied <= 0 && borrowed <= 0) return null;
            return (
              <div key={asset.id} style={{ ...card, padding: 14 }}>
                <div className="row-between" style={{ gap: 8 }}><strong>{asset.symbol}</strong><span style={{ color: '#a78bfa', fontSize: 10 }}>Kamino</span></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginTop: 10 }}>
                  <Metric label={t('loan.supplied')} value={fmt(supplied, 6)} />
                  <Metric label={t('loan.borrowed')} value={fmt(borrowed, 6)} />
                </div>
                <div style={{ display: 'flex', gap: 7, marginTop: 10 }}>
                  {supplied > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setSelected(asset); setAmount(String(supplied)); runAction('withdraw', { asset, value: String(supplied) }); }} style={{ flex: 1 }}>{t('loan.withdraw')}</button>}
                  {borrowed > 0 && <button type="button" className="btn btn-primary btn-sm" onClick={() => { setSelected(asset); setAmount(String(borrowed)); runAction('repay', { asset, value: String(borrowed) }); }} style={{ flex: 1 }}>{t('loan.repay')}</button>}
                </div>
              </div>
            );
          })}
          {waiting?.id && (
            <div data-testid="solana-loan-pending" data-request={waiting.id} style={{ ...card, padding: '11px 13px', borderColor: 'rgba(251,191,36,0.30)' }}>
              <div style={{ color: '#fbbf24', fontSize: 11.5, fontWeight: 800 }}>{t('loan.solana.pendingTitle')}</div>
              <p style={{ color: 'var(--text-2)', fontSize: 10.5, lineHeight: 1.7, margin: '4px 0 8px' }}>{t('loan.solana.pendingBody')}</p>
              <button type="button" className="btn btn-ghost btn-sm" data-testid="solana-loan-pending-check" onClick={() => { claimPendingSignature(); }} style={{ width: '100%' }}>{t('loan.solana.pendingCheck')}</button>
            </div>
          )}
          {actionError && <p data-testid="solana-loan-action-error" style={{ color: '#fca5a5', fontSize: 11 }}>{loanErrorText(t, actionError)}</p>}
          {actionError && actionDetail && <p dir="ltr" className="faint" style={{ fontSize: 9.5, fontFamily: 'var(--font-mono)', direction: 'ltr', unicodeBidi: 'isolate', margin: '3px 0 0', opacity: 0.75, wordBreak: 'break-word' }}>{actionDetail}</p>}
          <WalletIncident code={actionError} t={t} />
          {lastSignature && <a data-testid="solana-loan-tx" href={`${SOLANA_LENDING_EXPLORER}/tx/${lastSignature}`} target="_blank" rel="noreferrer" style={{ color: '#a78bfa', fontSize: 10.5 }}>{t('loan.solana.viewTransaction')}</a>}
        </div>
      )}

      <div style={{ ...card, padding: '11px 13px', marginTop: 12, color: 'var(--text-3)', fontSize: 10.5, lineHeight: 1.75 }}>
        {t('loan.solana.securityNote')}
      </div>
    </section>
  );
}
