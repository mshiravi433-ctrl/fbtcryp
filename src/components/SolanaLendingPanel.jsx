import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSolanaWallet } from '../hooks/useSolanaWallet.js';
import AssetIcon from './AssetIcon.jsx';
import { IconChart, IconChevronRight, IconCoins, IconPools, IconTrend } from './Icons.jsx';
import '../styles/solana-loan.css';
import { loanErrorText } from '../lib/loanErrors.js';
import { mapRawError } from '../lib/lending-engine/errors.js';
import { riskLevel } from '../lib/lending-engine/health.js';
import { solanaLendingFacts } from '../lib/solanaLendingInsights.js';
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

/**
 * What a phone keyboard types into a decimal field, as a number the builder
 * can read: Persian (۰-۹) and Arabic-Indic (٠-٩) digits become ASCII, the
 * Persian decimal mark «٫» and a comma become «.», anything else is dropped,
 * and only the first decimal point survives.
 */
export function normalizeAmountInput(raw) {
  const ascii = String(raw ?? '')
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[٫,]/g, '.')
    .replace(/[^0-9.]/g, '');
  const dot = ascii.indexOf('.');
  return dot === -1 ? ascii : `${ascii.slice(0, dot + 1)}${ascii.slice(dot + 1).replace(/\./g, '')}`;
}

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
  const live = status === 'live' || status === 'ok';
  return (
    <span
      data-testid="solana-loan-data-status"
      data-status={status}
      className="sol-loan-badge"
      data-live={live ? 'true' : 'false'}
    >
      <span className="sol-loan-badge-dot" aria-hidden="true" />
      {t(live ? 'loan.status.live' : 'loan.status.unavailable')}
    </span>
  );
}

/**
 * One measured number.
 *
 * `tone` is optional and only ever set from a value the engine already
 * computed (a risk band colour, a rate direction) — never to decorate.
 */
function Metric({ label, value, sub, tone = null }) {
  return (
    <div className="sol-loan-metric">
      <div className="sol-loan-metric-label">{label}</div>
      <div className="sol-loan-metric-value" style={tone ? { color: tone } : undefined}>{value}</div>
      {sub ? <div className="sol-loan-metric-sub" style={tone ? { color: tone } : undefined}>{sub}</div> : null}
    </div>
  );
}

/**
 * A COLLAPSIBLE BOX.
 *
 * Asked for directly: «در بخش وام سولانا … باکس‌ها، توکن‌ها، تحلیل‌ها … در
 * باکس بازشونده شود».
 *
 * ─── WHY THE HEADER CARRIES LIVE VALUES ─────────────────────────────────────
 * A disclosure whose header says only «Market» makes the user open it to learn
 * anything, which is worse than not collapsing it. The header therefore carries
 * CHIPS — the health factor, the debt, the count — so the closed state is still
 * a true, current summary and the open state is the detail.
 *
 * The chevron is the only thing that animates, and the body is a height/opacity
 * transition: both are composited, and both are disabled under
 * prefers-reduced-motion (see the stylesheet).
 */
function SolBox({
  id, testId, title, subtitle, icon, chips = [], badge = null, defaultOpen = false, children
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`sol-box ${open ? 'is-open' : ''}`} data-testid={testId} data-box={id} data-open={open}>
      <button
        type="button"
        className="sol-box-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="sol-box-icon" aria-hidden="true">{icon}</span>
        <span className="sol-box-text">
          <span className="sol-box-title">
            {title}
            {badge ? <span className="sol-box-badge">{badge}</span> : null}
          </span>
          {subtitle ? <span className="sol-box-sub">{subtitle}</span> : null}
        </span>
        {chips.length > 0 && (
          <span className="sol-box-chips">
            {chips.slice(0, 2).map((chip) => (
              <span key={`${chip.label}-${chip.value}`} className="sol-chip">
                <span className="sol-chip-label">{chip.label}</span>
                <span className="sol-chip-value" style={chip.tone ? { color: chip.tone } : undefined}>{chip.value}</span>
              </span>
            ))}
          </span>
        )}
        <motion.span
          className="sol-box-chev"
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ duration: 0.18 }}
          aria-hidden="true"
        >
          <IconChevronRight width={16} height={16} />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div className="sol-box-body">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/**
 * ONE TOKEN — selectable, and expandable.
 *
 * The row's main surface SELECTS the token for the form (the behaviour the
 * tests and the user already rely on). The chevron is a separate control that
 * opens this token's OWN detail: both APYs, the asset's LTV and liquidation
 * threshold, what the reserve actually holds, its caps, and the wallet's
 * spendable balance.
 *
 * Two controls rather than one because a tap that both changes the selection
 * and expands a panel is a tap the user cannot predict. The chevron stops the
 * event, so nothing happens twice.
 */
function SolanaAssetCard({ asset, position, selected, expanded, onSelect, onToggle, t }) {
  const active = selected?.id === asset.id;
  const rows = [
    [t('loan.supplyApyLine'), asset.supplyApyPct == null ? '—' : `${fmt(asset.supplyApyPct)}%`],
    [t('loan.borrowApyLine'), asset.borrowApyPct == null ? '—' : `${fmt(asset.borrowApyPct)}%`],
    [t('loan.maxLtv'), asset.loanToValuePct == null ? '—' : `${fmt(asset.loanToValuePct)}%`],
    [t('loan.liquidationThreshold'), asset.liquidationThresholdPct == null ? '—' : `${fmt(asset.liquidationThresholdPct)}%`],
    [t('loan.availableLiquidity'), asset.availableLiquidity == null ? '—' : fmt(asset.availableLiquidity, 4)],
    [t('loan.solana.borrowed'), asset.borrowed == null ? '—' : fmt(asset.borrowed, 4)],
    [t('loan.solana.supplyCap'), asset.supplyCap == null ? '—' : fmt(asset.supplyCap, 2)],
    [t('loan.solana.borrowCap'), asset.borrowCap == null ? '—' : fmt(asset.borrowCap, 2)],
    [t('loan.solana.walletBalance'), position?.walletBalance == null ? '—' : fmt(position.walletBalance, 6)]
  ];

  return (
    <div className={`sol-asset ${active ? 'is-selected' : ''}`} data-asset={asset.symbol.toLowerCase()}>
      <div className="sol-asset-row">
        <button
          type="button"
          className="sol-asset-main"
          data-testid={`solana-loan-asset-${asset.symbol.toLowerCase()}`}
          onClick={() => onSelect(asset)}
        >
          <span className="sol-asset-art">
            <AssetIcon symbol={asset.symbol} chain="solana" size={38} radius={14} alt={asset.symbol} />
          </span>
          <span className="sol-asset-id">
            <span className="sol-asset-symbol">{asset.symbol}</span>
            <span className="sol-asset-sub">{t('loan.solana.marketReserve')}</span>
          </span>
          <span className="sol-asset-rates">
            <span className="sol-asset-supply">{asset.supplyApyPct == null ? '—' : `+${fmt(asset.supplyApyPct)}%`}</span>
            <span className="sol-asset-borrow">{asset.borrowApyPct == null ? '—' : `${fmt(asset.borrowApyPct)}%`}</span>
          </span>
        </button>
        <button
          type="button"
          className="sol-asset-toggle"
          data-testid={`solana-loan-asset-toggle-${asset.symbol.toLowerCase()}`}
          aria-expanded={expanded}
          aria-label={`${t('loan.solana.details')} · ${asset.symbol}`}
          onClick={() => onToggle(expanded ? null : asset.id)}
        >
          <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.18 }} style={{ display: 'inline-flex' }}>
            <IconChevronRight width={15} height={15} style={{ transform: 'rotate(90deg)' }} />
          </motion.span>
        </button>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="detail"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div className="sol-asset-detail" data-testid={`solana-loan-asset-detail-${asset.symbol.toLowerCase()}`}>
              {rows.map(([label, value]) => (
                <div key={label} className="sol-asset-detail-row">
                  <span className="sol-asset-detail-label">{label}</span>
                  <span className="sol-asset-detail-value">{value}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
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
  /* Which token's own detail is open. One at a time: a list where every row can
     be open at once stops being scannable the moment there are four tokens. */
  const [expandedAssetId, setExpandedAssetId] = useState(null);
  const claimingRef = useRef(false);

  /* `opts.fresh` after a transaction: skip the server's short snapshot cache so
     the position shown is the one AFTER the deposit, not the one before it.
     (Used as an onClick handler too — a click event is not `{ fresh: true }`.) */
  const refresh = useCallback(async (opts) => {
    const fresh = opts?.fresh === true;
    setLoading(true);
    setError(null);
    try {
      /* No rpcUrl here on purpose: the lending client resolves the app's
         probed Solana RPC layer (custom endpoint first, then the community
         nodes) instead of pinning the Foundation's most-throttled host. */
      const next = await readSolanaLendingMarket({ wallet: wallet.address, fresh });
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
        hosts: Array.isArray(cause?.hosts) ? cause.hosts : null,
        /* The SECOND door's verdict. lib/solanaLending.js races the browser
           against our own backend, and when both are shut it throws the
           browser's failure with the server's answer attached — so the panel
           can say «our server was asked too, and it said …» instead of leaving
           the second door invisible on the exact screen where it matters. */
        serverTried: Boolean(cause?.serverTried),
        serverCode: cause?.serverCode ? String(cause.serverCode) : null,
        serverDetail: cause?.serverDetail ? String(cause.serverDetail).slice(0, 160) : null
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
      await refresh({ fresh: true });
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
  const hasOpenPosition = assets.some((asset) => {
    const row = snapshot?.positions?.[asset.id];
    return Number(row?.supplied || 0) > 0 || Number(row?.borrowed || 0) > 0;
  });
  const currentPosition = selected ? snapshot?.positions?.[selected.id] : null;
  const currentDecimals = Number(selected?.decimals || 0);
  const maxForTab = tab === 'borrow'
    ? null
    : tab === 'positions' && currentPosition
      ? (Number(currentPosition.borrowed) > 0 ? currentPosition.borrowed : currentPosition.supplied)
      : null;

  /* The obligation was read, and is not "unknown": the figures are real (a
     wallet that never deposited reads as a KNOWN empty position, not a failed
     read — see test/solana-loan-positions-amount.test.jsx). */
  const accountKnown = Boolean(snapshot?.account) && !snapshot.account.unknown;

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
      await refresh({ fresh: true });
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

  /*
   * ─── WHAT THE NUMBERS SAY ──────────────────────────────────────────────────
   * «در بخش وام سولانا … تحلیل‌ها … مدرن‌تر و به‌روزتر شود»
   *
   * Every fact below is computed from the snapshot already on screen by
   * lib/solanaLendingInsights.js — utilisation, the borrow-over-supply spread,
   * how full the reserve's deposit limit is, how far the position is from the
   * liquidation point. No extra request, no second risk engine, no forecast:
   * the panel is not allowed to say anything the pool did not report.
   *
   * The amount typed feeds the depth fact, so it re-renders as the user types —
   * that is the one input that changes what the analysis can say.
   */
  const typedUsd = useMemo(() => {
    if (!selected) return null;
    const price = Number(selected.priceUsd);
    const units = toSolanaUnits(amount, Number(selected.decimals || 0));
    if (!Number.isFinite(price) || price <= 0 || units == null) return null;
    return Number(units) / (10 ** Number(selected.decimals || 0)) * price;
  }, [selected?.id, selected?.priceUsd, selected?.decimals, amount]);

  const analysis = useMemo(
    () => solanaLendingFacts({ snapshot, asset: selected, amountUsd: typedUsd }),
    [snapshot, selected?.id, typedUsd]
  );

  const health = useMemo(() => {
    const hf = Number(snapshot?.account?.healthFactor);
    return Number.isFinite(hf) ? hf : null;
  }, [snapshot?.account?.healthFactor]);

  return (
    <section data-testid="solana-lending-panel" dir="inherit" className="sol-loan">
      {/* ── the market, as a header card ─────────────────────────────────── */}
      <div className="sol-loan-hero">
        <div className="sol-loan-hero-top">
          <span className="sol-loan-hero-art">
            <AssetIcon symbol="SOL" chain="solana" size={46} radius={15} alt="SOL" />
            <span className="sol-loan-hero-ring" aria-hidden="true" />
          </span>
          <div className="sol-loan-hero-text">
            <div className="sol-loan-hero-title">{t('loan.solana.title')}</div>
            <div className="sol-loan-hero-sub">{t('loan.solana.subtitle')}</div>
            {/* Which door served these numbers. When the public nodes refused
                this network path and our own backend answered instead, the user
                is told so — a figure that arrived by another route should not
                look like the route that failed a minute ago. */}
            {snapshot?.via === 'server' ? (
              <div data-testid="solana-loan-via-server" className="sol-loan-via">
                {t('loan.solana.serverDoor')}
              </div>
            ) : null}
          </div>
          <DataBadge t={t} status={snapshot?.dataStatus || 'unavailable'} />
        </div>

        <div className="sol-loan-hero-metrics">
          {/* When the obligation could not be READ, its figures are placeholder
              zeros — they render as '—' with a retry, never as $0.00 that reads
              as "you have no position". */}
          <Metric label={t('loan.collateral')} value={accountKnown ? `$${fmt(snapshot.account.totalCollateralUsd)}` : '—'} />
          <Metric label={t('loan.debt')} value={accountKnown ? `$${fmt(snapshot.account.totalDebtUsd)}` : '—'} />
          <Metric label={t('loan.borrowPower')} value={accountKnown ? `$${fmt(snapshot.account.availableBorrowsUsd)}` : '—'} />
          {health != null && (
            <Metric
              label={t('loan.healthFactorNow')}
              value={health.toFixed(2)}
              sub={t(`loan.riskLevel.${riskLevel(health).level}`)}
              tone={riskLevel(health).color}
            />
          )}
        </div>

        {snapshot?.account?.unknown && (
          <button
            type="button"
            className="sol-loan-retry-inline"
            data-testid="solana-loan-position-retry"
            onClick={refresh}
          >
            {loanErrorText(t, 'RPC_ERROR')} · {t('loan.retry')}
          </button>
        )}

        {!wallet.address ? (
          <button type="button" className="btn btn-primary" data-testid="solana-loan-connect" onClick={connect} style={{ width: '100%', marginTop: 13 }}>{t('loan.connectWallet')}</button>
        ) : (
          <div className="sol-loan-wallet">
            <span className="sol-loan-wallet-dot" aria-hidden="true" />
            {wallet.walletName || 'Solana'} · {wallet.address.slice(0, 6)}…{wallet.address.slice(-5)}
          </div>
        )}
      </div>

      {/* ── the tabs, as a modern segmented control ──────────────────────── */}
      <div className="sol-loan-tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            data-testid={`solana-loan-tab-${id}`}
            className={`sol-loan-tab ${tab === id ? 'is-active' : ''}`}
            onClick={() => setTab(id)}
          >
            {tab === id && <motion.span layoutId="sol-loan-tab-pill" className="sol-loan-tab-pill" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
            <span className="sol-loan-tab-label">{label}</span>
          </button>
        ))}
      </div>

      {loading && (
        <div className="sol-loan-skeleton" data-testid="solana-loan-loading">
          <span className="sol-loan-skeleton-bar" />
          <span className="sol-loan-skeleton-bar" />
          <span className="sol-loan-skeleton-bar is-short" />
          <span className="sol-loan-loading-text">{t('loan.solana.loading')}</span>
        </div>
      )}

      {!loading && error && (
        <div
          data-testid="solana-loan-error"
          data-code={error.code}
          className="sol-loan-error"
        >
          <div className="sol-loan-error-head">
            <span className="sol-loan-error-mark" aria-hidden="true">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 9v5M12 17.5h.01" />
                <path d="M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z" />
              </svg>
            </span>
            <span className="sol-loan-error-title">
              {error.hosts?.length ? t('loan.rpc.title') : t('loan.unavailableTitle')}
            </span>
            <span className="sol-loan-code" dir="ltr">{error.code}</span>
          </div>
          {/* The localized reason comes first; the protocol sentence stays
              as context beneath it, never the other way around. */}
          <p data-testid="solana-loan-error-reason" className="sol-loan-error-reason">
            {/* Always a sentence: a code with no translation renders as the
                localized generic WITH the code attached, never as itself. */}
            {loanErrorText(t, error.code || 'PROTOCOL_UNAVAILABLE')}
          </p>
          <p className="sol-loan-error-note">{t('loan.solana.unavailable')}</p>
          <RpcIncident hosts={error.hosts} t={t} />
          {/* The second door's own verdict, when it was tried. Nine public
              refusals and one line saying nothing else was attempted reads as
              «the app is broken»; the honest report is that our server was
              asked too, and here is what it said. */}
          {error.serverTried ? (
            <div data-testid="solana-loan-server-door" className="sol-loan-server-door">
              <p className="sol-loan-error-note">{t('loan.rpc.serverTried')}</p>
              <p className="sol-loan-error-note">
                {t('loan.rpc.serverHost')}
                {' — '}
                <span className="sol-loan-warn">{loanErrorText(t, error.serverCode || 'SERVER_UNAVAILABLE')}</span>
              </p>
              {error.serverDetail && error.serverDetail !== error.serverCode ? (
                <p dir="ltr" className="sol-loan-evidence">{error.serverDetail}</p>
              ) : null}
            </div>
          ) : null}
          {error.detail && error.detail !== error.code && !error.hosts?.length ? (
            <p dir="ltr" className="sol-loan-evidence">{error.detail}</p>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost btn-sm sol-loan-error-retry"
            data-testid="solana-loan-error-retry"
            onClick={refresh}
          >
            {t('loan.retry')}
          </button>
        </div>
      )}

      {!loading && !error && tab !== 'positions' && (
        <>
          {/*
            ── THE MARKET BOX ───────────────────────────────────────────────
            Collapsed = a title, a live chip and the health factor. Open = the
            full picture. The chips are on the HEADER on purpose: a closed box
            still has to say something true and current, or collapsing it hides
            information instead of tidying it.
          */}
          <SolBox
            id="sol-market"
            testId="solana-loan-box-market"
            title={t('loan.solana.box.market')}
            subtitle={t('loan.solana.box.marketSub')}
            icon={<IconPools width={17} height={17} />}
            chips={[
              health != null
                ? { label: t('loan.healthFactorNow'), value: health.toFixed(2), tone: riskLevel(health).color }
                : null,
              accountKnown
                ? { label: t('loan.debt'), value: `$${fmt(snapshot.account.totalDebtUsd)}` }
                : null,
              { label: t('loan.solana.reserves'), value: String(assets.length) }
            ].filter(Boolean)}
            defaultOpen
          >
            <div className="sol-loan-metric-grid">
              <Metric label={t('loan.collateral')} value={accountKnown ? `$${fmt(snapshot.account.totalCollateralUsd)}` : '—'} />
              <Metric label={t('loan.debt')} value={accountKnown ? `$${fmt(snapshot.account.totalDebtUsd)}` : '—'} />
              <Metric label={t('loan.borrowPower')} value={accountKnown ? `$${fmt(snapshot.account.availableBorrowsUsd)}` : '—'} />
              <Metric
                label={t('loan.liquidationThreshold')}
                value={accountKnown && snapshot.account.liquidationThresholdPct != null ? `${fmt(snapshot.account.liquidationThresholdPct)}%` : '—'}
              />
              <Metric
                label={t('loan.currentLtv')}
                value={accountKnown && snapshot.account.ltvPct != null ? `${fmt(snapshot.account.ltvPct)}%` : '—'}
              />
              <Metric label={t('loan.solana.slot')} value={snapshot?.slot == null ? '—' : String(snapshot.slot)} />
            </div>
            {/* The obligation could not be read: every figure above is a
                placeholder, and the panel says which read failed rather than
                letting the dashes look like an empty position. */}
            {snapshot?.failures?.length ? (
              <p className="sol-loan-warn-line">
                {t('loan.solana.partial', { n: snapshot.failures.length })}
              </p>
            ) : null}
          </SolBox>

          {/*
            ── THE TOKENS BOX ───────────────────────────────────────────────
            «باکس ها ، توکن ها ،تحلیل ها … در باکس بازشونده شود» — the tokens
            are now a collapsible box, and EVERY token inside it opens its own
            detail (APYs, the asset's own LTV and liquidation threshold, what
            the reserve actually holds, caps, the wallet's spendable balance).

            The row's main surface still SELECTS the token, exactly as before —
            the chevron is a separate control, so a tap on the row cannot both
            select and expand by accident.
          */}
          <SolBox
            id="sol-tokens"
            testId="solana-loan-box-tokens"
            title={tab === 'borrow' ? t('loan.chooseBorrowAsset') : t('loan.chooseAsset')}
            subtitle={t('loan.solana.box.tokensSub')}
            icon={<IconCoins width={17} height={17} />}
            chips={[{ label: t('loan.solana.reserves'), value: String(assets.length) }]}
            defaultOpen
          >
            <div className="sol-loan-assets">
              {assets.map((asset) => (
                <SolanaAssetCard
                  key={asset.id}
                  asset={asset}
                  position={snapshot?.positions?.[asset.id]}
                  selected={selected}
                  expanded={expandedAssetId === asset.id}
                  onSelect={setSelected}
                  onToggle={(next) => setExpandedAssetId(next)}
                  t={t}
                />
              ))}
              {assets.length === 0 && (
                <p className="sol-loan-empty-line">{t('loan.noAssetsOnChain', { chain: 'Solana' })}</p>
              )}
            </div>
          </SolBox>

          {/*
            ── THE ANALYSIS BOX ─────────────────────────────────────────────
            Every line is measured from the snapshot already on screen (see
            lib/solanaLendingInsights.js) — utilisation, the spread between
            borrowing and depositing, how full the deposit limit is, how big the
            typed amount is against real liquidity, and how far the position is
            from its liquidation point. No request, no forecast, and nothing
            rendered when there is nothing to measure.
          */}
          {analysis.length > 0 && (
            <SolBox
              id="sol-analysis"
              testId="solana-loan-box-analysis"
              title={t('loan.solana.box.analysis')}
              subtitle={t('loan.solana.box.analysisSub', { symbol: selected?.symbol ?? '—' })}
              icon={<IconChart width={17} height={17} />}
              defaultOpen={false}
            >
              <ul className="sol-loan-facts">
                {analysis.map((fact) => (
                  <li key={fact.id} className={`sol-loan-fact is-${fact.kind}`} data-testid={`solana-loan-fact-${fact.id}`}>
                    <span className="sol-loan-fact-dot" aria-hidden="true" />
                    <span>{t(`loan.solana.analysis.${fact.id}`, fact.values)}</span>
                  </li>
                ))}
              </ul>
              <p className="sol-loan-facts-note">{t('loan.solana.analysis.notAdvice')}</p>
            </SolBox>
          )}

          {/*
            ── THE ACTION BOX ───────────────────────────────────────────────
            The form itself, unchanged in behaviour (preflight, MAX, the deep
            link hand-over, the pending card) and modernised in shape.
          */}
          {selected && (
            <SolBox
              id="sol-action"
              testId="solana-loan-box-action"
              title={tab === 'borrow' ? t('loan.borrowBtn', { symbol: selected.symbol }) : t('loan.supplyBtn', { symbol: selected.symbol })}
              subtitle={t('loan.solana.box.actionSub')}
              icon={<IconTrend width={17} height={17} />}
              chips={[
                selected.supplyApyPct != null ? { label: t('loan.supplyApyLine'), value: `+${fmt(selected.supplyApyPct)}%`, tone: '#86efac' } : null,
                selected.borrowApyPct != null ? { label: t('loan.borrowApyLine'), value: `${fmt(selected.borrowApyPct)}%`, tone: '#fca5a5' } : null
              ].filter(Boolean)}
              defaultOpen
            >
              <div className="sol-loan-form">
                <div className="sol-loan-form-head">
                  <span className="sol-loan-form-asset">
                    <AssetIcon symbol={selected.symbol} chain="solana" size={22} radius={8} alt={selected.symbol} />
                    {selected.symbol}
                  </span>
                  {/* MAX means the wallet's real spendable balance — the number
                      the preflight checks the transaction against. Unreadable
                      balance renders no MAX rather than zero. */}
                  {tab !== 'borrow' && currentPosition?.walletBalance != null && (
                    <button
                      type="button"
                      className="sol-loan-max"
                      data-testid="solana-loan-max"
                      onClick={() => setAmount(String(currentPosition.walletBalance))}
                    >
                      {t('loan.maxOf', { amount: currentPosition.walletBalance, symbol: selected.symbol })}
                    </button>
                  )}
                </div>

                {/*
                  The amount field owns its row. It used to share a flex row
                  with the action button — and `.btn` is `width: 100%`
                  globally, so the button took the whole line and squeezed the
                  input down to a tiny rounded pill («خیلی کوچیک و تخم‌مرغی»).
                */}
                <div className="sol-loan-amount-field" data-testid="solana-loan-amount-field">
                  <input
                    data-testid="solana-loan-amount"
                    className="sol-loan-amount-input"
                    value={amount}
                    onChange={(event) => setAmount(normalizeAmountInput(event.target.value))}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0.00"
                    dir="ltr"
                    aria-label={`${t('loan.amount')} · ${selected.symbol}`}
                  />
                  <span className="sol-loan-amount-asset">
                    <AssetIcon symbol={selected.symbol} chain="solana" size={20} radius={7} alt={selected.symbol} />
                    {selected.symbol}
                  </span>
                </div>

                {!wallet.address ? (
                  <button type="button" className="btn btn-primary sol-loan-action" data-testid="solana-loan-action-connect" onClick={connect}>{t('loan.connectWallet')}</button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary sol-loan-action"
                    data-testid="solana-loan-action"
                    disabled={Boolean(action)}
                    onClick={() => runAction(tab === 'borrow' ? 'borrow' : 'supply')}
                  >
                    {action ? t('loan.running') : tab === 'borrow' ? t('loan.borrowBtn', { symbol: selected.symbol }) : t('loan.supplyBtn', { symbol: selected.symbol })}
                  </button>
                )}

                {tab !== 'borrow' && wallet.address && currentPosition?.walletBalance == null && (
                  <p data-testid="solana-loan-balance-unknown" className="sol-loan-warn-line">{loanErrorText(t, 'BALANCE_UNKNOWN')}</p>
                )}
                {snapshot?.account && tab === 'borrow' && (
                  <p className="sol-loan-hint">{t('loan.maxBorrowHint', { max: `$${fmt(snapshot.account.availableBorrowsUsd)}` })}</p>
                )}

                {waiting?.id && (
                  <div
                    className="sol-loan-pending"
                    data-testid="solana-loan-pending"
                    data-request={waiting.id}
                  >
                    <div className="sol-loan-pending-title">{t('loan.solana.pendingTitle')}</div>
                    <p className="sol-loan-pending-body">{t('loan.solana.pendingBody')}</p>
                    <div className="sol-loan-pending-actions">
                      <button type="button" className="btn btn-ghost btn-sm" data-testid="solana-loan-pending-reopen" onClick={async () => {
                        const { reopenDeeplinkRequest } = await import('../lib/solana/deeplink.js');
                        try { reopenDeeplinkRequest(waiting.id); } catch { /* the wallet app decides */ }
                      }}>{t('loan.solana.pendingReopen')}</button>
                      <button type="button" className="btn btn-ghost btn-sm" data-testid="solana-loan-pending-check" onClick={() => { claimPendingSignature(); }}>{t('loan.solana.pendingCheck')}</button>
                    </div>
                  </div>
                )}

                {actionError && <p data-testid="solana-loan-action-error" className="sol-loan-action-error">{loanErrorText(t, actionError)}</p>}
                {actionError && actionDetail && <p dir="ltr" className="sol-loan-evidence">{actionDetail}</p>}
                <WalletIncident code={actionError} t={t} />
                {lastSignature && (
                  <a data-testid="solana-loan-tx" href={`${SOLANA_LENDING_EXPLORER}/tx/${lastSignature}`} target="_blank" rel="noreferrer" className="sol-loan-tx">
                    {t('loan.solana.viewTransaction')} · {lastSignature.slice(0, 10)}…
                  </a>
                )}
              </div>
            </SolBox>
          )}
        </>
      )}

      {!loading && !error && tab === 'positions' && (
        <div className="sol-loan-positions">
          {snapshot?.account?.unknown ? (
            <div className="sol-loan-card sol-loan-card-warn">
              <div className="sol-loan-warn-line">{loanErrorText(t, 'RPC_ERROR')}</div>
              <button type="button" className="btn btn-ghost btn-sm" data-testid="solana-loan-positions-retry" onClick={refresh} style={{ width: '100%', marginTop: 10 }}>
                {t('loan.retry')}
              </button>
            </div>
          ) : !wallet.address ? (
            /* Positions belong to a wallet: say so and offer the door, instead of
               «no position» that reads as «you have nothing here». */
            <div className="sol-loan-empty" data-testid="solana-loan-positions-connect">
              <div className="sol-loan-empty-text">{t('loan.solana.noPosition')}</div>
              <button type="button" className="btn btn-primary" onClick={connect}>{t('loan.connectWallet')}</button>
            </div>
          ) : !hasOpenPosition ? (
            <div className="sol-loan-card sol-loan-empty-text" data-testid="solana-loan-positions-empty">{t('loan.solana.noPosition')}</div>
          ) : null}

          {assets.map((asset) => {
            const position = snapshot.positions?.[asset.id];
            const supplied = Number(position?.supplied || 0);
            const borrowed = Number(position?.borrowed || 0);
            if (supplied <= 0 && borrowed <= 0) return null;
            return (
              <SolBox
                key={asset.id}
                id={`sol-position-${asset.id}`}
                testId={`solana-loan-position-${asset.symbol.toLowerCase()}`}
                title={asset.symbol}
                subtitle={t('loan.solana.marketReserve')}
                icon={<AssetIcon symbol={asset.symbol} chain="solana" size={24} radius={9} alt={asset.symbol} />}
                chips={[
                  borrowed > 0 ? { label: t('loan.borrowed'), value: fmt(borrowed, 6), tone: '#fca5a5' } : null,
                  supplied > 0 ? { label: t('loan.supplied'), value: fmt(supplied, 6), tone: '#86efac' } : null
                ].filter(Boolean)}
                badge={t('loan.solana.protocolBadge')}
                defaultOpen
              >
                <div className="sol-loan-metric-grid is-two">
                  <Metric label={t('loan.supplied')} value={fmt(supplied, 6)} sub={supplied > 0 && Number(position?.suppliedUsd) > 0 ? `$${fmt(position.suppliedUsd)}` : undefined} />
                  <Metric label={t('loan.borrowed')} value={fmt(borrowed, 6)} sub={borrowed > 0 && Number(position?.borrowedUsd) > 0 ? `$${fmt(position.borrowedUsd)}` : undefined} />
                </div>
                <div className="sol-loan-position-actions">
                  {supplied > 0 && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setSelected(asset); setAmount(String(supplied)); runAction('withdraw', { asset, value: String(supplied) }); }}>{t('loan.withdraw')}</button>
                  )}
                  {borrowed > 0 && (
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => { setSelected(asset); setAmount(String(borrowed)); runAction('repay', { asset, value: String(borrowed) }); }}>{t('loan.repay')}</button>
                  )}
                </div>
              </SolBox>
            );
          })}

          {waiting?.id && (
            <div className="sol-loan-card sol-loan-card-warn" data-testid="solana-loan-pending" data-request={waiting.id}>
              <div className="sol-loan-pending-title">{t('loan.solana.pendingTitle')}</div>
              <p className="sol-loan-pending-body">{t('loan.solana.pendingBody')}</p>
              <button type="button" className="btn btn-ghost btn-sm" data-testid="solana-loan-pending-check" onClick={() => { claimPendingSignature(); }} style={{ width: '100%' }}>{t('loan.solana.pendingCheck')}</button>
            </div>
          )}

          {actionError && <p data-testid="solana-loan-action-error" className="sol-loan-action-error">{loanErrorText(t, actionError)}</p>}
          {actionError && actionDetail && <p dir="ltr" className="sol-loan-evidence">{actionDetail}</p>}
          <WalletIncident code={actionError} t={t} />
          {lastSignature && (
            <a data-testid="solana-loan-tx" href={`${SOLANA_LENDING_EXPLORER}/tx/${lastSignature}`} target="_blank" rel="noreferrer" className="sol-loan-tx">
              {t('loan.solana.viewTransaction')}
            </a>
          )}
        </div>
      )}

      {/* The safety note stays last, and stays closed until asked. */}
      <div className="sol-loan-footnote">{t('loan.solana.securityNote')}</div>
    </section>
  );
}
