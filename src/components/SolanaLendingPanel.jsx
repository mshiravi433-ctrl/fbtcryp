import { useCallback, useEffect, useState } from 'react';
import { useSolanaWallet } from '../hooks/useSolanaWallet.js';
import AssetIcon from './AssetIcon.jsx';
import {
  buildSolanaLendingTransactions,
  readSolanaLendingMarket,
  waitForSolanaLendingTransaction,
  preflightSolanaAction,
  SOLANA_LENDING_EXPLORER,
  toSolanaUnits
} from '../lib/solanaLending.js';

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
  const [lastSignature, setLastSignature] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      /* No rpcUrl here on purpose: the lending client resolves the app's
         probed Solana RPC layer (custom endpoint first, then the community
         nodes) instead of pinning the Foundation's most-throttled host. */
      const next = await readSolanaLendingMarket({ wallet: wallet.address });
      if (!next.ok) {
        const failure = new Error(next.code || 'PROTOCOL_UNAVAILABLE');
        failure.code = next.code || 'PROTOCOL_UNAVAILABLE';
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
        detail: String(cause?.detail || cause?.message || '').slice(0, 160)
      });
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  }, [wallet.address, preset?.symbol]);

  useEffect(() => { refresh(); }, [refresh]);

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
    const result = await wallet.connect({ returnTo: window.location.href });
    if (result && typeof result === 'object' && result.ok === false) setActionError(result.code);
  };

  const runAction = async (nextAction, overrides = {}) => {
    const actionAsset = overrides.asset || selected;
    const actionAmount = overrides.value ?? amount;
    setActionError(null);
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
      let signature = null;
      for (const tx of built.transactions) {
        /* Kamino builds v0 (versioned) transactions. Passing `versioned:false`
           sent them through LEGACY deserialization — every signing attempt
           through an injected wallet failed before the user could ever see an
           approval. */
        const sent = await wallet.signAndSendTransaction(tx.transaction, { versioned: true });
        if (!sent?.ok || !sent.signature) throw new Error(sent?.code || 'SOLANA_SEND_FAILED');
        const confirmed = await waitForSolanaLendingTransaction(sent.signature);
        if (!confirmed.ok) throw new Error(confirmed.code || 'SOLANA_SEND_FAILED');
        signature = sent.signature;
      }
      setLastSignature(signature);
      setAmount('');
      await refresh();
    } catch (cause) {
      setActionError(String(cause?.message || cause));
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
            {t('loan.error.RPC_ERROR')} · {t('loan.retry')}
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
              <span style={{ fontWeight: 800, color: '#fca5a5', fontSize: 13, flex: 1 }}>{t('loan.unavailableTitle')}</span>
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
              {t(`loan.error.${error.code}`, { defaultValue: '' }) || t('loan.error.PROTOCOL_UNAVAILABLE')}
            </p>
            <p style={{ margin: 0, color: 'var(--text-3)', fontSize: 11, lineHeight: 1.75 }}>{t('loan.solana.unavailable')}</p>
            {error.detail && error.detail !== error.code ? (
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
                <p data-testid="solana-loan-balance-unknown" style={{ color: '#fbbf24', fontSize: 10.5, margin: '8px 0 0' }}>{t('loan.error.BALANCE_UNKNOWN')}</p>
              )}
              {snapshot?.account && tab === 'borrow' && <p style={{ color: 'var(--text-3)', fontSize: 10.5, margin: '8px 0 0' }}>{t('loan.maxBorrowHint', { max: `$${fmt(snapshot.account.availableBorrowsUsd)}` })}</p>}
              {actionError && <p data-testid="solana-loan-action-error" style={{ color: '#fca5a5', fontSize: 11, lineHeight: 1.6, margin: '9px 0 0' }}>{t(`loan.error.${actionError}`, { defaultValue: t('loan.error.UNKNOWN') })}</p>}
              {lastSignature && <a data-testid="solana-loan-tx" href={`${SOLANA_LENDING_EXPLORER}/tx/${lastSignature}`} target="_blank" rel="noreferrer" style={{ display: 'block', color: '#a78bfa', fontSize: 10.5, marginTop: 9, fontFamily: 'var(--font-mono)' }}>{t('loan.solana.viewTransaction')} · {lastSignature.slice(0, 10)}…</a>}
            </div>
          )}
        </>
      )}

      {!loading && !error && tab === 'positions' && (
        <div style={{ display: 'grid', gap: 9 }}>
          {snapshot?.account?.unknown ? (
            <div style={{ ...card, padding: 15, borderColor: 'rgba(251,191,36,0.30)' }}>
              <div style={{ color: '#fbbf24', fontSize: 12, fontWeight: 700, lineHeight: 1.7 }}>{t('loan.error.RPC_ERROR')}</div>
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
          {actionError && <p data-testid="solana-loan-action-error" style={{ color: '#fca5a5', fontSize: 11 }}>{t(`loan.error.${actionError}`, { defaultValue: t('loan.error.UNKNOWN') })}</p>}
          {lastSignature && <a data-testid="solana-loan-tx" href={`${SOLANA_LENDING_EXPLORER}/tx/${lastSignature}`} target="_blank" rel="noreferrer" style={{ color: '#a78bfa', fontSize: 10.5 }}>{t('loan.solana.viewTransaction')}</a>}
        </div>
      )}

      <div style={{ ...card, padding: '11px 13px', marginTop: 12, color: 'var(--text-3)', fontSize: 10.5, lineHeight: 1.75 }}>
        {t('loan.solana.securityNote')}
      </div>
    </section>
  );
}
