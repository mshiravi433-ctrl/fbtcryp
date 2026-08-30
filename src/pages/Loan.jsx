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
  IconX,
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
    color: '#26a17b', risk: 'low',    emoji: '💵',
  },
  {
    id: 'usdc',   symbol: 'USDC', name: 'USD Coin',        chain: 1,
    color: '#2775ca', risk: 'low',    emoji: '🔵',
  },
  {
    id: 'eth',    symbol: 'ETH',  name: 'Ethereum',        chain: 1,
    color: '#627eea', risk: 'medium', emoji: '⟠',
  },
  {
    id: 'wbtc',   symbol: 'WBTC', name: 'Wrapped Bitcoin', chain: 1,
    color: '#f09242', risk: 'medium', emoji: '₿',
  },
  {
    id: 'bnb',    symbol: 'BNB',  name: 'BNB Chain',       chain: 56,
    color: '#f3ba2f', risk: 'medium', emoji: '◆',
  },
  {
    id: 'usdt56', symbol: 'USDT', name: 'Tether (BNB)',    chain: 56,
    color: '#26a17b', risk: 'low',    emoji: '💵',
  },
];

const BORROW_ASSETS = [
  {
    id: 'usdt', symbol: 'USDT', name: 'Tether USD',  chain: 1,
    ltv: 80, color: '#26a17b', emoji: '💵',
  },
  {
    id: 'usdc', symbol: 'USDC', name: 'USD Coin',     chain: 1,
    ltv: 80, color: '#2775ca', emoji: '🔵',
  },
  {
    id: 'eth',  symbol: 'ETH',  name: 'Ethereum',     chain: 1,
    ltv: 75, color: '#627eea', emoji: '⟠',
  },
  {
    id: 'bnb',  symbol: 'BNB',  name: 'BNB Chain',    chain: 56,
    ltv: 70, color: '#f3ba2f', emoji: '◆',
  },
];

const CHAIN_LABEL = { 1: 'Ethereum', 56: 'BNB Chain', 42161: 'Arbitrum', 8453: 'Base' };

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
      style={{
        width: '100%', textAlign: 'start',
        padding: '13px 14px', borderRadius: 14,
        background: isSelected
          ? `linear-gradient(135deg, ${asset.color}18, ${asset.color}08)`
          : 'rgba(255,255,255,0.03)',
        border: isSelected
          ? `1.5px solid ${asset.color}55`
          : '1.5px solid rgba(255,255,255,0.07)',
        cursor: 'pointer', transition: 'border 0.16s, background 0.16s',
        display: 'flex', alignItems: 'center', gap: 12,
      }}
    >
      {/* Avatar */}
      <span style={{
        width: 40, height: 40, borderRadius: 12, flexShrink: 0,
        display: 'grid', placeItems: 'center', fontSize: 18,
        background: `linear-gradient(135deg, ${asset.color}28, ${asset.color}0a)`,
        border: `1.5px solid ${asset.color}44`,
      }}>
        {asset.emoji}
      </span>

      {/* Name */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, lineHeight: 1.3 }}>{asset.symbol}</div>
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>
          {CHAIN_LABEL[asset.chain]}
        </div>
      </div>

      {/* Badges */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
        <AprBadge rates={rates} assetId={asset.id} side={side} loading={ratesLoading} />
        {side === 'supply'
          ? <RiskPill risk={asset.risk} t={t} />
          : <ChainPill chainId={asset.chain} />
        }
      </div>

      {/* Check */}
      {isSelected && (
        <span style={{
          width: 20, height: 20, borderRadius: 99, background: asset.color,
          display: 'grid', placeItems: 'center', flexShrink: 0,
        }}>
          <IconCheck width={11} height={11} style={{ color: '#000' }} />
        </span>
      )}
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
        borderRadius: 12, overflow: 'hidden',
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
            padding: '0 14px', fontSize: 12, fontWeight: 700,
            color: 'var(--text-2)', whiteSpace: 'nowrap',
          }}>
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
              borderRadius: '22px 22px 0 0',
              padding: '24px 20px 36px',
              boxShadow: '0 -8px 48px rgba(0,0,0,0.5)',
            }}
          >
            {/* Handle */}
            <div style={{
              width: 36, height: 4, borderRadius: 2,
              background: 'rgba(255,255,255,0.18)',
              margin: '0 auto 20px',
            }} />

            {/* Title */}
            <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 18 }}>
              {isSupply ? t('loan.confirmSupplyTitle') : t('loan.confirmBorrowTitle')}
            </div>

            {/* Summary rows */}
            <div style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 14, padding: '4px 0', marginBottom: 16,
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
                  padding: '10px 14px',
                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                }}>
                  <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{k}</span>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{v}</span>
                </div>
              ))}
            </div>

            {/* Inline warning — always visible before signing */}
            <div style={{
              background: 'rgba(251,191,36,0.08)',
              border: '1px solid rgba(251,191,36,0.25)',
              borderRadius: 11, padding: '10px 13px', marginBottom: 18,
              display: 'flex', gap: 9, alignItems: 'flex-start',
            }}>
              <span style={{ fontSize: 15, flexShrink: 0 }}>⚠️</span>
              <p style={{ fontSize: 12, lineHeight: 1.65, color: 'var(--text-2)', margin: 0 }}>
                {t('loan.walletSignBody')}
              </p>
            </div>

            {/* Buttons */}
            <button
              className="btn btn-primary"
              style={{ marginBottom: 10 }}
              onClick={onConfirm}
            >
              <IconCheck width={14} height={14} style={{ marginInlineEnd: 7 }} />
              {t('common.confirm')}
            </button>
            <button className="btn btn-ghost" onClick={onCancel}>
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

function SupplyTab({ rates, ratesLoading, t, haptic, notify }) {
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
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
              background: 'rgba(255,255,255,0.04)',
              border: `1.5px solid ${selected.color}33`,
              borderRadius: 14, padding: '16px',
            }}>
              <AmountInput
                label={t('loan.supplyAmount', { symbol: selected.symbol })}
                value={amount} onChange={setAmount}
                asset={selected} autoFocus
              />
              <button className="btn btn-primary" onClick={handleSubmit} style={{ marginTop: 4 }}>
                {t('loan.supplyBtn', { symbol: selected.symbol })}
              </button>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
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
              background: 'rgba(255,255,255,0.04)',
              border: `1.5px solid ${selected.color}33`,
              borderRadius: 14, padding: '16px',
            }}>
              {/* LTV badge */}
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)',
                borderRadius: 8, padding: '5px 10px', marginBottom: 14,
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
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: 'rgba(74,222,128,0.07)',
                  border: '1px solid rgba(74,222,128,0.20)',
                  borderRadius: 9, padding: '8px 12px', marginBottom: 14,
                }}>
                  <span style={{ fontSize: 13 }}>📊</span>
                  <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
                    {t('loan.maxBorrowNote', {
                      max: maxBorrow,
                      symbol: selected.symbol,
                      pct: selected.ltv,
                    })}
                  </span>
                </div>
              )}

              <AmountInput
                label={t('loan.borrowAmountLabel', { symbol: selected.symbol })}
                value={amount} onChange={setAmount}
                asset={selected}
                hint={maxBorrow ? t('loan.maxBorrowHint', { max: maxBorrow }) : undefined}
              />

              <button className="btn btn-primary" onClick={handleSubmit} style={{ marginTop: 4 }}>
                {t('loan.borrowBtn', { symbol: selected.symbol })}
              </button>
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
    },
    {
      label: t('loan.openWallet'),
      icon: <IconShield width={16} height={16} />,
      to: '/wallet',
      color: 'var(--rgb-4)',
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
          type="button"
          onClick={() => { haptic?.('light'); navigate(lnk.to); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 13, width: '100%',
            padding: '14px 16px', borderRadius: 14, cursor: 'pointer',
            background: 'rgba(255,255,255,0.04)',
            border: '1.5px solid rgba(255,255,255,0.08)',
            textAlign: 'start',
          }}
        >
          <span style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            display: 'grid', placeItems: 'center',
            background: `linear-gradient(135deg, ${lnk.color}22, ${lnk.color}08)`,
            border: `1px solid ${lnk.color}33`,
            color: lnk.color,
          }}>
            {lnk.icon}
          </span>
          <span style={{ flex: 1, fontWeight: 600, fontSize: 13.5 }}>{lnk.label}</span>
          <IconChevronRight width={15} height={15} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
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
    { emoji: '🔒', key: 'step1' },
    { emoji: '📈', key: 'step2' },
    { emoji: '⚖️', key: 'step3' },
    { emoji: '💸', key: 'step4' },
  ];

  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 14, overflow: 'hidden',
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
                    width: 32, height: 32, borderRadius: 9, background: 'rgba(255,255,255,0.06)',
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
        <div key={s.label} style={{
          flex: '1 1 0', padding: '10px 8px', borderRadius: 12, textAlign: 'center',
          background: `linear-gradient(160deg, ${s.color}10, transparent)`,
          border: `1px solid ${s.color}22`,
        }}>
          <div style={{ fontSize: 16, marginBottom: 3 }}>{s.icon}</div>
          <div style={{ fontWeight: 800, fontSize: 10.5, color: s.color, lineHeight: 1.2 }}>
            {s.label}
          </div>
          <div style={{ fontSize: 9.5, color: 'var(--text-3)', marginTop: 2 }}>{s.sub}</div>
        </div>
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

  useEffect(() => {
    let alive = true;
    setRatesLoading(true);
    fetchLoanRates().then(data => {
      if (alive) { setRates(data); setRatesLoading(false); }
    });
    return () => { alive = false; };
  }, []);

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
      </motion.div>

      {/* ── Hero card ──────────────────────────────────────────────────── */}
      <motion.div
        variants={riseIn} initial="hidden" animate="show"
        style={{
          borderRadius: 18, overflow: 'hidden',
          background: 'linear-gradient(135deg, rgba(37,99,235,0.15) 0%, rgba(124,58,237,0.12) 50%, rgba(6,182,212,0.08) 100%)',
          border: '1px solid rgba(255,255,255,0.08)',
          padding: '18px 18px 14px',
          marginBottom: 14,
          position: 'relative',
        }}
      >
        {/* Glow orb */}
        <div style={{
          position: 'absolute', top: -40, right: -40,
          width: 160, height: 160, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(99,102,241,0.20) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 14, display: 'grid', placeItems: 'center',
            background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
            fontSize: 22, flexShrink: 0,
          }}>⚖️</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, lineHeight: 1.25 }}>{t('loan.heroTitle')}</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{t('loan.heroSub')}</div>
          </div>
        </div>

        <HeroStats t={t} />
      </motion.div>

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <motion.div
        variants={riseIn} initial="hidden" animate="show"
        style={{
          display: 'flex', gap: 6, marginBottom: 14,
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 12, padding: 4,
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
                gap: 5, padding: '8px 6px', borderRadius: 9, border: 'none', cursor: 'pointer',
                background: active ? 'rgba(255,255,255,0.10)' : 'transparent',
                color: active ? 'var(--text-1)' : 'var(--text-3)',
                fontWeight: active ? 700 : 500, fontSize: 12.5,
                transition: 'all 0.16s',
              }}
            >
              <span style={{ opacity: active ? 1 : 0.6 }}>{tb.icon}</span>
              {tb.label}
            </button>
          );
        })}
      </motion.div>

      {/* ── Tab content ────────────────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {tab === 'supply' && (
          <motion.div key="supply"
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}>
            <SupplyTab
              rates={rates} ratesLoading={ratesLoading}
              t={t} haptic={haptic} notify={notifyHelper}
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
