/**
 * LOAN — Lending & Borrowing
 * ─────────────────────────────────────────────────────────────────────────
 * Architecture: FBT = Router + Fee layer only.
 * Assets go directly into lending-protocol smart contracts (Morpho/Aave).
 * FBT never holds, signs, or broadcasts user funds.
 *
 * Rules this file is held to:
 *   1. No external links — everything stays in-app.
 *   2. No hardcoded APY numbers — show live rate or "—".
 *   3. No guarantee-of-profit language.
 *   4. All warnings inside collapsible InfoBox (in-page, not overlay).
 *   5. Confirm modal is two-step: review → confirm.
 *   6. Sizes follow the app's existing token/class system.
 *
 * Modernisation pass (2026-08): gradient asset avatars instead of emoji,
 * an animated tab indicator, a polished confirm sheet, and the supply flow
 * now hands off to Intent OS exactly like borrow does — so every tab's
 * primary action actually works instead of ending in a toast.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import { useWallet } from '../context/WalletContext';
import { useAppStore } from '../store/useAppStore';
import { useTelegram } from '../context/TelegramContext';
import {
  IconChevronLeft,
  IconChevronRight,
  IconCheck,
  IconShield,
  IconTrend,
  IconPools,
  IconSwap,
} from '../components/Icons';

/* ═══════════════════════════════════════════════════════════════════════════
   ASSET CATALOGUE
   ═══════════════════════════════════════════════════════════════════════════ */

const SUPPLY_ASSETS = [
  {
    id: 'usdt',   symbol: 'USDT', name: 'Tether USD',     chain: 1,
    color: '#26a17b', risk: 'low',    grad: 'linear-gradient(135deg, #26a17b, #0e6b4f)',
  },
  {
    id: 'usdc',   symbol: 'USDC', name: 'USD Coin',        chain: 1,
    color: '#2775ca', risk: 'low',    grad: 'linear-gradient(135deg, #2775ca, #1a4d85)',
  },
  {
    id: 'eth',    symbol: 'ETH',  name: 'Ethereum',        chain: 1,
    color: '#627eea', risk: 'medium', grad: 'linear-gradient(135deg, #627eea, #3b4ea8)',
  },
  {
    id: 'wbtc',   symbol: 'WBTC', name: 'Wrapped Bitcoin', chain: 1,
    color: '#f09242', risk: 'medium', grad: 'linear-gradient(135deg, #f09242, #b35f1f)',
  },
  {
    id: 'bnb',    symbol: 'BNB',  name: 'BNB Chain',       chain: 56,
    color: '#f3ba2f', risk: 'medium', grad: 'linear-gradient(135deg, #f3ba2f, #b8840f)',
  },
  {
    id: 'usdt56', symbol: 'USDT', name: 'Tether (BNB)',    chain: 56,
    color: '#26a17b', risk: 'low',    grad: 'linear-gradient(135deg, #26a17b, #0e6b4f)',
  },
];

const BORROW_ASSETS = [
  {
    id: 'usdt', symbol: 'USDT', name: 'Tether USD',  chain: 1,
    ltv: 80, color: '#26a17b', grad: 'linear-gradient(135deg, #26a17b, #0e6b4f)',
  },
  {
    id: 'usdc', symbol: 'USDC', name: 'USD Coin',     chain: 1,
    ltv: 80, color: '#2775ca', grad: 'linear-gradient(135deg, #2775ca, #1a4d85)',
  },
  {
    id: 'eth',  symbol: 'ETH',  name: 'Ethereum',     chain: 1,
    ltv: 75, color: '#627eea', grad: 'linear-gradient(135deg, #627eea, #3b4ea8)',
  },
  {
    id: 'bnb',  symbol: 'BNB',  name: 'BNB Chain',    chain: 56,
    ltv: 70, color: '#f3ba2f', grad: 'linear-gradient(135deg, #f3ba2f, #b8840f)',
  },
];

const CHAIN_LABEL = { 1: 'Ethereum', 56: 'BNB Chain', 42161: 'Arbitrum', 8453: 'Base' };
const CHAIN_DOT = { 1: '#627eea', 56: '#f3ba2f', 42161: '#28a0f0', 8453: '#0052ff' };

/* ═══════════════════════════════════════════════════════════════════════════
   API
   ═══════════════════════════════════════════════════════════════════════════ */

async function fetchLoanRates() {
  try {
    const r = await fetch('/api/loan/rates', { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    return r.json();
  } catch {
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   SMALL HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

/** Modern gradient asset avatar — replaces the old emoji tiles. */
function AssetAvatar({ asset, size = 40 }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size, height: size, borderRadius: size * 0.32, flexShrink: 0,
        display: 'grid', placeItems: 'center', position: 'relative',
        background: asset.grad || `linear-gradient(135deg, ${asset.color}, ${asset.color}88)`,
        boxShadow: `0 6px 16px ${asset.color}33, inset 0 1px 0 rgba(255,255,255,0.25)`,
        fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: size * 0.3,
        color: '#fff', letterSpacing: -0.5,
      }}
    >
      {asset.symbol.slice(0, 4)}
      <span
        style={{
          position: 'absolute', bottom: -2, right: -2,
          width: size * 0.3, height: size * 0.3, borderRadius: 99,
          background: CHAIN_DOT[asset.chain] ?? '#888', border: '2px solid var(--bg-card, #16161e)',
        }}
        title={CHAIN_LABEL[asset.chain]}
      />
    </span>
  );
}

function ChainPill({ chainId }) {
  return (
    <span style={{
      fontSize: 9.5, fontWeight: 700, letterSpacing: 0.3,
      padding: '2px 7px', borderRadius: 99,
      background: 'rgba(255,255,255,0.08)',
      border: '1px solid rgba(255,255,255,0.12)',
      color: 'var(--text-2)',
      fontFamily: 'var(--font-mono)',
    }}>
      {CHAIN_LABEL[chainId] ?? `#${chainId}`}
    </span>
  );
}

function RiskPill({ risk, t }) {
  const map = {
    low:    { label: t('invest.risk.low'),    bg: 'rgba(34,197,94,0.12)',  fg: '#4ade80' },
    medium: { label: t('invest.risk.medium'), bg: 'rgba(251,191,36,0.12)', fg: '#fbbf24' },
    high:   { label: t('invest.risk.high'),   bg: 'rgba(239,68,68,0.12)',  fg: '#f87171' },
  };
  const { label, bg, fg } = map[risk] ?? map.medium;
  return (
    <span style={{
      fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 99,
      background: bg, color: fg, border: `1px solid ${fg}33`,
    }}>
      {label}
    </span>
  );
}

function AprBadge({ rates, assetId, side, loading }) {
  if (loading) return <span className="spinner" style={{ width: 11, height: 11 }} />;
  const val = rates?.[assetId]?.[side];
  if (val == null) return <span style={{ fontSize: 11, color: 'var(--text-3)' }}>—</span>;
  const pct = typeof val === 'number' ? `${val.toFixed(2)}%` : String(val);
  return (
    <span style={{
      fontSize: 11, fontWeight: 800, color: side === 'supply' ? '#4ade80' : '#f87171',
      fontFamily: 'var(--font-mono)',
    }}>
      {side === 'supply' ? '+' : ''}{pct}
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   ASSET CARD
   ═══════════════════════════════════════════════════════════════════════════ */

function AssetCard({ asset, selected, onClick, rates, ratesLoading, side, t }) {
  const isSelected = selected?.id === asset.id && selected?.chain === asset.chain;
  return (
    <motion.button
      type="button"
      variants={riseIn}
      onClick={onClick}
      whileTap={{ scale: 0.985 }}
      style={{
        width: '100%', textAlign: 'start',
        padding: '13px 14px', borderRadius: 16,
        background: isSelected
          ? `linear-gradient(135deg, ${asset.color}1c, ${asset.color}06)`
          : 'rgba(255,255,255,0.03)',
        border: isSelected
          ? `1.5px solid ${asset.color}66`
          : '1.5px solid rgba(255,255,255,0.07)',
        cursor: 'pointer', transition: 'border 0.16s, background 0.16s, box-shadow 0.16s',
        display: 'flex', alignItems: 'center', gap: 12,
        boxShadow: isSelected ? `0 8px 24px ${asset.color}1f` : 'none',
      }}
    >
      <AssetAvatar asset={asset} />

      {/* Name */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, lineHeight: 1.3 }}>{asset.symbol}</div>
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>
          {asset.name}
        </div>
      </div>

      {/* Badges */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <AprBadge rates={rates} assetId={asset.id} side={side} loading={ratesLoading} />
          <span className="faint" style={{ fontSize: 9 }}>APY</span>
        </div>
        {side === 'supply'
          ? <RiskPill risk={asset.risk} t={t} />
          : <ChainPill chainId={asset.chain} />}
      </div>

      {/* Check */}
      <AnimatePresence>
        {isSelected && (
          <motion.span
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.4, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 26 }}
            style={{
              width: 22, height: 22, borderRadius: 99, background: asset.grad || asset.color,
              display: 'grid', placeItems: 'center', flexShrink: 0,
              boxShadow: `0 4px 10px ${asset.color}55`,
            }}
          >
            <IconCheck width={12} height={12} style={{ color: '#fff' }} />
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   AMOUNT INPUT
   ═══════════════════════════════════════════════════════════════════════════ */

function AmountInput({ label, value, onChange, asset, hint, autoFocus }) {
  const ref = useRef(null);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 0,
        background: 'rgba(255,255,255,0.05)',
        border: '1.5px solid rgba(255,255,255,0.10)',
        borderRadius: 13, overflow: 'hidden',
        transition: 'border 0.16s',
      }}>
        <input
          ref={ref}
          type="number" min="0" step="any" inputMode="decimal"
          placeholder="0.00"
          value={value}
          onChange={e => onChange(e.target.value)}
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            padding: '12px 14px', fontSize: 18, fontWeight: 700,
            color: 'var(--text-1)', fontFamily: 'var(--font-mono)',
          }}
        />
        {asset && (
          <span style={{
            padding: '0 14px', display: 'flex', alignItems: 'center', gap: 7,
            fontSize: 12, fontWeight: 700, color: 'var(--text-2)', whiteSpace: 'nowrap',
          }}>
            <span
              style={{
                width: 18, height: 18, borderRadius: 6, display: 'inline-grid', placeItems: 'center',
                background: asset.grad || asset.color, color: '#fff',
                fontFamily: 'var(--font-mono)', fontSize: 8, fontWeight: 800,
              }}
            >
              {asset.symbol.slice(0, 3)}
            </span>
            {asset.symbol}
          </span>
        )}
      </div>
      {hint && (
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 5 }}>{hint}</div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   CONFIRM SHEET  (slides up from bottom — in page, not overlay)
   ═══════════════════════════════════════════════════════════════════════════ */

function ConfirmSheet({ open, action, asset, amount, collateral, onConfirm, onCancel, t }) {
  const isSupply = action === 'supply';
  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onCancel}
            style={{
              position: 'fixed', inset: 0, zIndex: 190,
              background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
            }}
          />
          {/* Sheet */}
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            style={{
              position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 200,
              background: 'var(--bg-sheet, #16161e)',
              borderRadius: '24px 24px 0 0',
              padding: '24px 20px 36px',
              boxShadow: '0 -8px 48px rgba(0,0,0,0.5)',
              borderTop: `1px solid ${asset?.color ?? '#333'}44`,
            }}
          >
            {/* Handle */}
            <div style={{
              width: 36, height: 4, borderRadius: 2,
              background: 'rgba(255,255,255,0.18)',
              margin: '0 auto 18px',
            }} />

            {/* Title */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
              {asset && <AssetAvatar asset={asset} size={42} />}
              <div>
                <div style={{ fontWeight: 800, fontSize: 16 }}>
                  {isSupply ? t('loan.confirmSupplyTitle') : t('loan.confirmBorrowTitle')}
                </div>
                <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>
                  {asset?.name} · {CHAIN_LABEL[asset?.chain] ?? ''}
                </div>
              </div>
            </div>

            {/* Summary rows */}
            <div style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 15, padding: '4px 0', marginBottom: 16, overflow: 'hidden',
            }}>
              {[
                [t('loan.asset'), asset?.symbol],
                ...(isSupply
                  ? [[t('loan.amount'), `${amount} ${asset?.symbol}`]]
                  : [
                    [t('loan.collateralLabel', { symbol: asset?.symbol }), `${collateral} ${asset?.symbol}`],
                    [t('loan.borrowAmountLabel', { symbol: asset?.symbol }), `${amount} ${asset?.symbol}`],
                  ]
                ),
                [t('loan.action'), isSupply ? t('loan.supply') : t('loan.borrow')],
              ].map(([k, v]) => (
                <div key={k} className="row-between" style={{
                  padding: '11px 14px',
                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                }}>
                  <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{k}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{v}</span>
                </div>
              ))}
            </div>

            {/* Inline warning — always visible before signing */}
            <div style={{
              background: 'rgba(251,191,36,0.08)',
              border: '1px solid rgba(251,191,36,0.25)',
              borderRadius: 12, padding: '10px 13px', marginBottom: 18,
              display: 'flex', gap: 9, alignItems: 'flex-start',
            }}>
              <span style={{ fontSize: 15, flexShrink: 0 }}>⚠️</span>
              <p style={{ fontSize: 12, lineHeight: 1.65, color: 'var(--text-2)', margin: 0 }}>
                {t('loan.walletSignBody')}
              </p>
            </div>

            {/* Buttons */}
            <motion.button
              className="btn btn-primary"
              style={{
                marginBottom: 10, width: '100%',
                background: asset ? `linear-gradient(135deg, ${asset.color}, ${asset.color}bb)` : undefined,
                boxShadow: asset ? `0 10px 26px ${asset.color}44` : undefined,
              }}
              whileTap={{ scale: 0.97 }}
              onClick={onConfirm}
            >
              <IconCheck width={14} height={14} style={{ marginInlineEnd: 7 }} />
              {t('common.confirm')}
            </motion.button>
            <button className="btn btn-ghost" style={{ width: '100%' }} onClick={onCancel}>
              {t('common.cancel')}
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SUPPLY TAB
   ═══════════════════════════════════════════════════════════════════════════ */

function SupplyTab({ rates, ratesLoading, t, haptic, notify, navigate }) {
  const [selected, setSelected] = useState(null);
  const [amount, setAmount]     = useState('');
  const [confirm, setConfirm]   = useState(false);

  const handleSubmit = () => {
    if (!selected) { notify('loan.chooseAssetFirst', 'error'); return; }
    if (!amount || Number(amount) <= 0) { notify('loan.enterAmount', 'error'); return; }
    haptic?.('medium');
    setConfirm(true);
  };

  const handleConfirm = () => {
    setConfirm(false);
    /* Same hand-off borrow already had: the intent composer carries the
       loan-supply hint so the next screen is the actual execution path. */
    navigate('/intent?tab=default&hint=loan-supply');
    notify('loan.openIntentForSupply', 'success');
    setAmount('');
    setSelected(null);
  };

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

      {/* Desc */}
      <motion.p variants={riseIn} className="prose-sm"
        style={{ lineHeight: 1.8, padding: '0 2px' }}>
        {t('loan.supplyDesc')}
      </motion.p>

      {/* Asset list */}
      <motion.div variants={riseIn}>
        <p className="section-label" style={{ marginBottom: 8 }}>{t('loan.chooseAsset')}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {SUPPLY_ASSETS.map(a => (
            <AssetCard
              key={a.id + a.chain}
              asset={a} selected={selected} side="supply"
              rates={rates} ratesLoading={ratesLoading} t={t}
              onClick={() => { haptic?.('select'); setSelected(a); setAmount(''); }}
            />
          ))}
        </div>
      </motion.div>

      {/* Amount input — slides in when asset selected */}
      <AnimatePresence>
        {selected && (
          <motion.div
            key={selected.id + selected.chain}
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{
              background: `linear-gradient(160deg, ${selected.color}12, transparent 65%)`,
              border: `1.5px solid ${selected.color}3a`,
              borderRadius: 16, padding: '16px',
            }}>
              <AmountInput
                label={t('loan.supplyAmount', { symbol: selected.symbol })}
                value={amount} onChange={setAmount}
                asset={selected} autoFocus
              />
              <motion.button
                className="btn btn-primary"
                onClick={handleSubmit}
                style={{
                  marginTop: 4, width: '100%',
                  background: `linear-gradient(135deg, ${selected.color}, ${selected.color}bb)`,
                  boxShadow: `0 10px 26px ${selected.color}33`,
                }}
                whileTap={{ scale: 0.97 }}
              >
                <IconTrend width={14} height={14} style={{ marginInlineEnd: 6 }} />
                {t('loan.supplyBtn', { symbol: selected.symbol })}
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Warnings — collapsible inside page */}
      <motion.div variants={riseIn} style={{ marginTop: 4 }}>
        <InfoBox title={t('loan.warningLiqTitle')} tone="warn" id="supply-liq-warn">
          <p>{t('loan.warningLiqBody')}</p>
        </InfoBox>
        <InfoBox title={t('loan.warningScTitle')} tone="info" id="supply-sc-warn">
          <p>{t('loan.warningScBody')}</p>
        </InfoBox>
        <InfoBox title={t('loan.archTitle')} tone="info" id="supply-arch">
          <p>{t('loan.archBody')}</p>
        </InfoBox>
      </motion.div>

      <ConfirmSheet
        open={confirm} action="supply"
        asset={selected} amount={amount} collateral={null}
        onConfirm={handleConfirm} onCancel={() => setConfirm(false)} t={t}
      />
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   BORROW TAB
   ═══════════════════════════════════════════════════════════════════════════ */

function BorrowTab({ rates, ratesLoading, t, haptic, notify, navigate }) {
  const [selected, setSelected] = useState(null);
  const [collateral, setCollateral] = useState('');
  const [amount, setAmount]         = useState('');
  const [confirm, setConfirm]       = useState(false);

  const maxBorrow = selected && collateral && Number(collateral) > 0
    ? ((Number(collateral) * selected.ltv) / 100).toFixed(4)
    : null;

  const handleSubmit = () => {
    if (!selected) { notify('loan.chooseAssetFirst', 'error'); return; }
    if (!collateral || Number(collateral) <= 0) { notify('loan.enterCollateral', 'error'); return; }
    if (!amount || Number(amount) <= 0) { notify('loan.enterAmount', 'error'); return; }
    if (maxBorrow && Number(amount) > Number(maxBorrow)) { notify('loan.overMaxBorrow', 'error'); return; }
    haptic?.('medium');
    setConfirm(true);
  };

  const handleConfirm = () => {
    setConfirm(false);
    navigate('/intent?tab=default&hint=loan-borrow');
    notify('loan.openIntentForBorrow', 'success');
  };

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

      <motion.p variants={riseIn} className="prose-sm" style={{ lineHeight: 1.8, padding: '0 2px' }}>
        {t('loan.borrowDesc')}
      </motion.p>

      {/* Asset list */}
      <motion.div variants={riseIn}>
        <p className="section-label" style={{ marginBottom: 8 }}>{t('loan.chooseBorrowAsset')}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {BORROW_ASSETS.map(a => (
            <AssetCard
              key={a.id + a.chain}
              asset={{ ...a, risk: 'medium' }}
              selected={selected} side="borrow"
              rates={rates} ratesLoading={ratesLoading} t={t}
              onClick={() => { haptic?.('select'); setSelected(a); setCollateral(''); setAmount(''); }}
            />
          ))}
        </div>
      </motion.div>

      {/* Collateral + borrow inputs */}
      <AnimatePresence>
        {selected && (
          <motion.div
            key={selected.id + selected.chain}
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{
              background: `linear-gradient(160deg, ${selected.color}12, transparent 65%)`,
              border: `1.5px solid ${selected.color}3a`,
              borderRadius: 16, padding: '16px',
            }}>
              {/* LTV badge */}
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)',
                borderRadius: 9, padding: '5px 10px', marginBottom: 14,
              }}>
                <span style={{ fontSize: 11, color: 'var(--text-2)' }}>LTV:</span>
                <span style={{ fontSize: 12, fontWeight: 800, color: selected.color }}>
                  {selected.ltv}%
                </span>
              </div>

              <AmountInput
                label={t('loan.collateralLabel', { symbol: selected.symbol })}
                value={collateral} onChange={setCollateral}
                asset={selected} autoFocus
              />

              {maxBorrow && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    background: 'rgba(74,222,128,0.07)',
                    border: '1px solid rgba(74,222,128,0.20)',
                    borderRadius: 10, padding: '8px 12px', marginBottom: 14,
                  }}
                >
                  <span style={{ fontSize: 13 }}>📊</span>
                  <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
                    {t('loan.maxBorrowNote', {
                      max: maxBorrow,
                      symbol: selected.symbol,
                      pct: selected.ltv,
                    })}
                  </span>
                </motion.div>
              )}

              <AmountInput
                label={t('loan.borrowAmountLabel', { symbol: selected.symbol })}
                value={amount} onChange={setAmount}
                asset={selected}
                hint={maxBorrow ? t('loan.maxBorrowHint', { max: maxBorrow }) : undefined}
              />

              <motion.button
                className="btn btn-primary"
                onClick={handleSubmit}
                style={{
                  marginTop: 4, width: '100%',
                  background: `linear-gradient(135deg, ${selected.color}, ${selected.color}bb)`,
                  boxShadow: `0 10px 26px ${selected.color}33`,
                }}
                whileTap={{ scale: 0.97 }}
              >
                <IconPools width={14} height={14} style={{ marginInlineEnd: 6 }} />
                {t('loan.borrowBtn', { symbol: selected.symbol })}
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Warnings */}
      <motion.div variants={riseIn} style={{ marginTop: 4 }}>
        <InfoBox title={t('loan.warningLiqTitle')} tone="danger" id="borrow-liq-warn">
          <p>{t('loan.warningLiqBorrowBody')}</p>
        </InfoBox>
        <InfoBox title={t('loan.warningScTitle')} tone="warn" id="borrow-sc-warn">
          <p>{t('loan.warningScBody')}</p>
        </InfoBox>
        <InfoBox title={t('loan.archTitle')} tone="info" id="borrow-arch">
          <p>{t('loan.archBody')}</p>
        </InfoBox>
      </motion.div>

      <ConfirmSheet
        open={confirm} action="borrow"
        asset={selected} amount={amount} collateral={collateral}
        onConfirm={handleConfirm} onCancel={() => setConfirm(false)} t={t}
      />
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   POSITIONS TAB
   ═══════════════════════════════════════════════════════════════════════════ */

function PositionsTab({ t, haptic, navigate }) {
  const LINKS = [
    {
      label: t('loan.openIntentOS'),
      icon: <IconSwap width={16} height={16} />,
      to: '/intent',
      color: 'var(--rgb-1)',
      grad: 'linear-gradient(135deg, rgba(0,229,255,0.25), rgba(0,229,255,0.06))',
    },
    {
      label: t('loan.openWallet'),
      icon: <IconShield width={16} height={16} />,
      to: '/wallet',
      color: 'var(--rgb-4)',
      grad: 'linear-gradient(135deg, rgba(255,138,0,0.25), rgba(255,138,0,0.06))',
    },
  ];

  return (
    <motion.div variants={stagger} initial="hidden" animate="show"
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

      <motion.p variants={riseIn} className="prose-sm" style={{ lineHeight: 1.8 }}>
        {t('loan.positionsBody')}
      </motion.p>

      {LINKS.map(lnk => (
        <motion.button
          key={lnk.to}
          variants={riseIn}
          whileTap={{ scale: 0.98 }}
          type="button"
          onClick={() => { haptic?.('light'); navigate(lnk.to); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 13, width: '100%',
            padding: '14px 16px', borderRadius: 15, cursor: 'pointer',
            background: 'rgba(255,255,255,0.04)',
            border: '1.5px solid rgba(255,255,255,0.08)',
            textAlign: 'start',
          }}
        >
          <span style={{
            width: 38, height: 38, borderRadius: 11, flexShrink: 0,
            display: 'grid', placeItems: 'center',
            background: lnk.grad,
            border: `1px solid ${lnk.color}40`,
            color: lnk.color,
            boxShadow: `0 6px 16px ${lnk.color}22`,
          }}>
            {lnk.icon}
          </span>
          <span style={{ flex: 1, fontWeight: 600, fontSize: 13.5 }}>{lnk.label}</span>
          <motion.span style={{ color: 'var(--text-3)', flexShrink: 0 }} whileTap={{ x: 2 }}>
            <IconChevronRight width={15} height={15} />
          </motion.span>
        </motion.button>
      ))}

      <motion.div variants={riseIn} style={{ marginTop: 4 }}>
        <InfoBox title={t('loan.archTitle')} tone="info" id="pos-arch">
          <p>{t('loan.archBody')}</p>
        </InfoBox>
      </motion.div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   HOW IT WORKS  (collapsible section)
   ═══════════════════════════════════════════════════════════════════════════ */

function HowItWorks({ t }) {
  const [open, setOpen] = useState(false);
  const steps = [
    { emoji: '🔒', key: 'step1', hue: '#4ade80' },
    { emoji: '📈', key: 'step2', hue: '#60a5fa' },
    { emoji: '⚖️', key: 'step3', hue: '#a78bfa' },
    { emoji: '💸', key: 'step4', hue: '#fbbf24' },
  ];

  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 15, overflow: 'hidden',
    }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', padding: '13px 16px', background: 'transparent',
          cursor: 'pointer', gap: 8,
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 13.5 }}>{t('loan.howTitle')}</span>
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.18 }}>
          <IconChevronRight width={15} height={15} style={{ color: 'var(--text-3)' }} />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {steps.map(s => (
                <div key={s.key} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <span style={{
                    width: 34, height: 34, borderRadius: 10,
                    background: `linear-gradient(135deg, ${s.hue}22, ${s.hue}08)`,
                    border: `1px solid ${s.hue}33`,
                    display: 'grid', placeItems: 'center', fontSize: 15, flexShrink: 0,
                  }}>{s.emoji}</span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 2 }}>
                      {t(`loan.${s.key}Title`)}
                    </div>
                    <p className="prose-sm" style={{ lineHeight: 1.7 }}>
                      {t(`loan.${s.key}Body`)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   HERO STATS BAR
   ═══════════════════════════════════════════════════════════════════════════ */

function HeroStats({ t }) {
  const stats = [
    { label: t('loan.nonCustodial'), sub: t('loan.nonCustodialSub'), color: '#4ade80', icon: '🔒' },
    { label: t('loan.fbtFee'),       sub: t('loan.fbtFeeSub'),       color: '#60a5fa', icon: '💸' },
    { label: t('loan.noKyc'),        sub: t('loan.noKycSub'),        color: '#a78bfa', icon: '✅' },
  ];
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {stats.map(s => (
        <motion.div
          key={s.label}
          whileTap={{ scale: 0.96 }}
          style={{
            flex: '1 1 0', padding: '11px 8px', borderRadius: 13, textAlign: 'center',
            background: `linear-gradient(160deg, ${s.color}14, transparent)`,
            border: `1px solid ${s.color}28`,
          }}
        >
          <div style={{ fontSize: 16, marginBottom: 3 }}>{s.icon}</div>
          <div style={{ fontWeight: 800, fontSize: 10.5, color: s.color, lineHeight: 1.2 }}>
            {s.label}
          </div>
          <div style={{ fontSize: 9.5, color: 'var(--text-3)', marginTop: 2 }}>{s.sub}</div>
        </motion.div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════════════════════════ */

export default function Loan() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();
  const notify = useAppStore(s => s.notify);

  const [tab, setTab]               = useState('supply');
  const [rates, setRates]           = useState(null);
  const [ratesLoading, setRatesLoading] = useState(true);
  const [ratesAt, setRatesAt]       = useState(null);

  const loadRates = useCallback(() => {
    setRatesLoading(true);
    fetchLoanRates().then(data => {
      if (data) { setRates(data); setRatesAt(Date.now()); }
      setRatesLoading(false);
    });
  }, []);

  useEffect(() => { loadRates(); }, [loadRates]);

  const notifyHelper = useCallback((key, tone) => notify(key, tone), [notify]);

  const TABS = [
    { id: 'supply',    label: t('loan.tabSupply'),    icon: <IconTrend  width={14} height={14} /> },
    { id: 'borrow',    label: t('loan.tabBorrow'),    icon: <IconPools  width={14} height={14} /> },
    { id: 'positions', label: t('loan.tabPositions'), icon: <IconShield width={14} height={14} /> },
  ];

  return (
    <PageTransition>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <motion.div
        variants={riseIn} initial="hidden" animate="show"
        style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}
      >
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconChevronLeft width={18} height={18} />
        </button>
        <div style={{ flex: 1 }}>
          <h1 className="h1" style={{ margin: 0, fontSize: 20 }}>{t('loan.pageTitle')}</h1>
          <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-3)' }}>{t('loan.pageSubtitle')}</p>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={loadRates}
          aria-label={t('common.refresh', { defaultValue: 'Refresh' })}
        >
          <motion.span
            animate={ratesLoading ? { rotate: 360 } : { rotate: 0 }}
            transition={ratesLoading ? { repeat: Infinity, duration: 0.8, ease: 'linear' } : { duration: 0.2 }}
            style={{ display: 'inline-flex' }}
          >
            <IconSwap width={13} height={13} />
          </motion.span>
        </button>
      </motion.div>

      {/* ── Hero card ──────────────────────────────────────────────────── */}
      <motion.div
        variants={riseIn} initial="hidden" animate="show"
        style={{
          borderRadius: 20, overflow: 'hidden',
          background: 'linear-gradient(135deg, rgba(37,99,235,0.18) 0%, rgba(124,58,237,0.14) 50%, rgba(6,182,212,0.10) 100%)',
          border: '1px solid rgba(255,255,255,0.09)',
          padding: '18px 18px 14px',
          marginBottom: 14,
          position: 'relative',
        }}
      >
        {/* Glow orb */}
        <div style={{
          position: 'absolute', top: -40, right: -40,
          width: 170, height: 170, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(99,102,241,0.25) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', bottom: -50, left: -30,
          width: 130, height: 130, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(6,182,212,0.18) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <motion.div
            whileHover={{ rotate: 6, scale: 1.04 }}
            style={{
              width: 46, height: 46, borderRadius: 14, display: 'grid', placeItems: 'center',
              background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
              boxShadow: '0 10px 28px rgba(99,102,241,0.45)',
              flexShrink: 0, color: '#fff',
            }}
          >
            <IconPools width={22} height={22} />
          </motion.div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16.5, lineHeight: 1.25 }}>{t('loan.heroTitle')}</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{t('loan.heroSub')}</div>
          </div>
        </div>

        <HeroStats t={t} />
      </motion.div>

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <motion.div
        variants={riseIn} initial="hidden" animate="show"
        style={{
          display: 'flex', gap: 5, marginBottom: 14, position: 'relative',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 14, padding: 4,
        }}
      >
        {TABS.map(tb => {
          const active = tab === tb.id;
          return (
            <button
              key={tb.id}
              type="button"
              onClick={() => { haptic?.('select'); setTab(tb.id); }}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: 5, padding: '9px 6px', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: 'transparent', position: 'relative',
                color: active ? 'var(--text-1)' : 'var(--text-3)',
                fontWeight: active ? 700 : 500, fontSize: 12.5,
                transition: 'color 0.16s',
              }}
            >
              {active && (
                <motion.span
                  layoutId="loan-tab-glow"
                  transition={{ type: 'spring', stiffness: 480, damping: 38 }}
                  style={{
                    position: 'absolute', inset: 0, borderRadius: 10,
                    background: 'rgba(255,255,255,0.11)',
                    border: '1px solid rgba(255,255,255,0.10)',
                    boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
                  }}
                />
              )}
              <span style={{ position: 'relative', opacity: active ? 1 : 0.6, display: 'inline-flex' }}>{tb.icon}</span>
              <span style={{ position: 'relative' }}>{tb.label}</span>
            </button>
          );
        })}
      </motion.div>

      {/* ── Rates strip ────────────────────────────────────────────────── */}
      {ratesAt && (
        <motion.p variants={riseIn} initial="hidden" animate="show" className="faint" style={{ fontSize: 10.5, margin: '-6px 2px 10px' }}>
          {t('loan.ratesUpdated', { defaultValue: 'نرخ‌ها از قراردادهای وام (Morpho/Aave) خوانده می‌شوند — تازه‌سازی خودکار.' })}
        </motion.p>
      )}

      {/* ── Tab content ────────────────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {tab === 'supply' && (
          <motion.div key="supply"
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}>
            <SupplyTab
              rates={rates} ratesLoading={ratesLoading}
              t={t} haptic={haptic} notify={notifyHelper} navigate={navigate}
            />
          </motion.div>
        )}
        {tab === 'borrow' && (
          <motion.div key="borrow"
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}>
            <BorrowTab
              rates={rates} ratesLoading={ratesLoading}
              t={t} haptic={haptic} notify={notifyHelper} navigate={navigate}
            />
          </motion.div>
        )}
        {tab === 'positions' && (
          <motion.div key="positions"
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}>
            <PositionsTab t={t} haptic={haptic} navigate={navigate} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── How it works (collapsible) ─────────────────────────────────── */}
      <motion.div variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 6 }}>
        <HowItWorks t={t} />
      </motion.div>

      {/* ── Global risk disclaimer (collapsible InfoBox) ───────────────── */}
      <motion.div variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 2 }}>
        <InfoBox title={t('loan.riskTitle')} tone="danger" id="loan-risk-global">
          <p>{t('loan.riskBody')}</p>
          <p style={{ marginTop: 6 }}>{t('loan.riskBody2')}</p>
        </InfoBox>
      </motion.div>

    </PageTransition>
  );
}
