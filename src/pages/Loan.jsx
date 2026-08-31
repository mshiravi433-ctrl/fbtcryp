/**
 * LOAN — Lending & Borrowing, executed HERE.
 * ─────────────────────────────────────────────────────────────────────────
 * Architecture: FBT = Router + Fee layer only.
 * Assets go directly into the lending-protocol smart contracts (Aave V3).
 * FBT never holds, signs, or broadcasts user funds.
 *
 * ─── WHAT CHANGED AND WHY ────────────────────────────────────────────────
 * Reported as: «صفحه وام باید در همان صفحه انجام شود … نمی‌خواد به Intent OS
 * بره برای سپرده … کلا فعال باشد ۱۰۰ درصد».
 *
 * Every primary action on this page used to end in `navigate('/intent?…')`.
 * The user picked an asset, typed an amount, reviewed a confirm sheet, hit
 * confirm — and landed on a different screen holding a draft. Nothing was
 * ever supplied, borrowed, repaid or withdrawn from here, and "My positions"
 * was two links out to other pages.
 *
 * The page is now wired end to end against the pool itself (src/lib/lending.js):
 *
 *   · the asset list is the chain's REAL reserves (address + decimals from the
 *     app's token registry), never a hardcoded catalogue
 *   · APY is read from the pool's own per-second rates, so it is the number
 *     the user will actually earn or pay — no server table, no placeholder
 *   · supply / borrow / repay / withdraw run right here: allowance is checked,
 *     an approval step appears only when it is genuinely short, and each step
 *     is a transaction the user's own wallet signs
 *   · every step shows its live state and its transaction hash, and a failure
 *     says which step failed and why (including a plain "you rejected it")
 *   · My positions reads the account from the pool: collateral, debt, borrowing
 *     power, health factor, and the per-asset supplied/borrowed balances, each
 *     with its own withdraw / repay action
 *
 * Rules this file is still held to:
 *   1. No external links — everything stays in-app.
 *   2. No hardcoded APY numbers — show the live rate or "—".
 *   3. No guarantee-of-profit language.
 *   4. All warnings inside collapsible InfoBox (in-page, not overlay).
 *   5. The action sheet is two-step: review → confirm.
 *   6. Sizes follow the app's existing token/class system.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import { useWallet } from '../context/WalletContext';
import { useAppStore } from '../store/useAppStore';
import { useTelegram } from '../context/TelegramContext';
import { EVM_CHAINS, explorerTx } from '../lib/chains';
import {
  lendingVenue, lendingSupported, lendingChains, lendingAssetsFor,
  readReserves, readUserAccount, readAssetPosition, readAllowance,
  buildLendingPlan, runLendingPlan, projectHealthFactor, healthBand,
  fromUnits, toUnits
} from '../lib/lending';
import {
  IconChevronLeft,
  IconChevronRight,
  IconCheck,
  IconShield,
  IconTrend,
  IconPools,
  IconSwap,
  IconLock,
  IconCoins,
  IconUser,
  IconBank
} from '../components/Icons';

const CHAIN_DOT = {
  1: '#627eea', 56: '#f3ba2f', 137: '#8247e5', 42161: '#28a0f0',
  8453: '#0052ff', 10: '#ff0420', 43114: '#e84142'
};
const chainLabel = (id) => EVM_CHAINS[id]?.name || `#${id}`;

/* ═══════════════════════════════════════════════════════════════════════════
   SMALL HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

const fmtUsd = (value) => (value == null || !Number.isFinite(Number(value))
  ? '—'
  : `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

/** Modern gradient asset avatar. */
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
        title={chainLabel(asset.chain)}
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
      {chainLabel(chainId)}
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

/** The live pool rate for one asset — or an honest dash. */
function AprBadge({ reserve, side, loading }) {
  if (loading) return <span className="spinner" style={{ width: 11, height: 11 }} />;
  const value = side === 'supply' ? reserve?.supplyApyPct : reserve?.borrowApyPct;
  if (!reserve?.listed || value == null) return <span style={{ fontSize: 11, color: 'var(--text-3)' }}>—</span>;
  return (
    <span
      data-testid="loan-apy"
      style={{
        fontSize: 11, fontWeight: 800, color: side === 'supply' ? '#4ade80' : '#f87171',
        fontFamily: 'var(--font-mono)',
      }}
    >
      {side === 'supply' ? '+' : ''}{value.toFixed(2)}%
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   ASSET CARD
   ═══════════════════════════════════════════════════════════════════════════ */

function AssetCard({ asset, selected, onClick, reserve, loading, side, t }) {
  const isSelected = selected?.id === asset.id;
  /* Only the pool's own answer can take an asset away. A read that failed
     leaves `listed` null — unknown rates, but the asset stays usable. */
  const unavailable = reserve?.listed === false;
  const rateUnknown = reserve != null && reserve.listed == null;
  return (
    <motion.button
      type="button"
      variants={riseIn}
      onClick={onClick}
      disabled={unavailable}
      data-testid={`loan-asset-${asset.symbol.toLowerCase()}`}
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
        cursor: unavailable ? 'not-allowed' : 'pointer',
        opacity: unavailable ? 0.5 : 1,
        transition: 'border 0.16s, background 0.16s, box-shadow 0.16s',
        display: 'flex', alignItems: 'center', gap: 12,
        boxShadow: isSelected ? `0 8px 24px ${asset.color}1f` : 'none',
      }}
    >
      <AssetAvatar asset={asset} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, lineHeight: 1.3 }}>{asset.symbol}</div>
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>
          {unavailable ? t('loan.reserveUnavailable') : rateUnknown ? t('loan.rateUnknown') : asset.name}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <AprBadge reserve={reserve} side={side} loading={loading} />
          <span className="faint" style={{ fontSize: 9 }}>APY</span>
        </div>
        {side === 'supply'
          ? <RiskPill risk={asset.risk} t={t} />
          : <ChainPill chainId={asset.chain} />}
      </div>

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

function AmountInput({ label, value, onChange, asset, hint, autoFocus, max, maxLabel, testId }) {
  const ref = useRef(null);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="row-between" style={{ marginBottom: 6, gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>{label}</span>
        {max != null && (
          <button
            type="button"
            onClick={() => onChange(String(max))}
            data-testid="loan-max"
            style={{
              fontSize: 10.5, fontWeight: 700, color: 'var(--text-2)',
              background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 8, padding: '3px 8px', cursor: 'pointer',
            }}
          >
            {maxLabel}
          </button>
        )}
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
          data-testid={testId}
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
   ACTION BUTTON — connect → switch chain → run, in that order
   ═══════════════════════════════════════════════════════════════════════════ */

function ActionButton({ state, onConnect, onSwitch, onRun, label, color, icon, disabled, t }) {
  if (state === 'disconnected') {
    return (
      <motion.button
        className="btn btn-primary" type="button" onClick={onConnect}
        data-testid="loan-connect"
        style={{ marginTop: 4, width: '100%' }} whileTap={{ scale: 0.97 }}
      >
        {t('loan.connectWallet')}
      </motion.button>
    );
  }
  if (state === 'wrong-chain') {
    return (
      <motion.button
        className="btn btn-primary" type="button" onClick={onSwitch}
        data-testid="loan-switch-chain"
        style={{ marginTop: 4, width: '100%' }} whileTap={{ scale: 0.97 }}
      >
        {t('loan.switchChain', { chain: label })}
      </motion.button>
    );
  }
  return (
    <motion.button
      className="btn btn-primary" type="button" onClick={onRun}
      disabled={disabled}
      data-testid="loan-action"
      style={{
        marginTop: 4, width: '100%',
        background: `linear-gradient(135deg, ${color}, ${color}bb)`,
        boxShadow: `0 10px 26px ${color}33`,
        opacity: disabled ? 0.55 : 1,
      }}
      whileTap={{ scale: 0.97 }}
    >
      {icon}
      {label}
    </motion.button>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   EXECUTION SHEET — review, then the real steps, in this page
   ═══════════════════════════════════════════════════════════════════════════ */

function StepRow({ step, asset, t }) {
  const tone = step.state === 'done' ? '#4ade80'
    : step.state === 'failed' ? '#f87171'
      : step.state === 'running' ? '#60a5fa' : 'var(--text-3)';
  return (
    <div
      className="row-between"
      data-testid={`loan-step-${step.id}`}
      data-state={step.state}
      style={{ padding: '10px 13px', borderBottom: '1px solid rgba(255,255,255,0.05)', gap: 10 }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
        <span style={{
          width: 20, height: 20, borderRadius: 7, flexShrink: 0, display: 'grid', placeItems: 'center',
          background: `${tone}22`, color: tone, fontSize: 10, fontWeight: 800,
        }}>
          {step.state === 'done' ? '✓' : step.state === 'failed' ? '!' : step.state === 'running' ? '…' : '·'}
        </span>
        <span style={{ fontSize: 12.5, color: 'var(--text-1)', minWidth: 0 }}>
          {t(`loan.step.${step.id}`, { symbol: asset?.symbol })}
        </span>
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 10.5, color: tone, fontWeight: 700 }}>
          {t(`loan.stepState.${step.state || 'pending'}`)}
        </span>
        {step.hash && (
          <a
            href={explorerTx(step.chainId, step.hash)}
            target="_blank" rel="noreferrer noopener"
            style={{ fontSize: 10.5, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}
          >
            {step.hash.slice(0, 6)}…
          </a>
        )}
      </span>
    </div>
  );
}

function ExecutionSheet({ exec, asset, onConfirm, onCancel, onDone, t }) {
  const open = Boolean(exec);
  const phase = exec?.phase || 'review';
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={phase === 'running' ? undefined : onCancel}
            style={{
              position: 'fixed', inset: 0, zIndex: 190,
              background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
            }}
          />
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            data-testid="loan-execution-sheet"
            data-phase={phase}
            style={{
              position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 200,
              background: 'var(--bg-sheet, #16161e)',
              borderRadius: '24px 24px 0 0',
              padding: '22px 20px 34px',
              boxShadow: '0 -8px 48px rgba(0,0,0,0.5)',
              borderTop: `1px solid ${asset?.color ?? '#333'}44`,
              maxHeight: '86vh', overflowY: 'auto',
            }}
          >
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.18)', margin: '0 auto 18px' }} />

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              {asset && <AssetAvatar asset={asset} size={42} />}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 16 }}>
                  {t(`loan.sheetTitle.${exec?.action || 'supply'}`)}
                </div>
                <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>
                  {t('loan.poolLabel', { chain: chainLabel(exec?.chainId) })}
                </div>
              </div>
            </div>

            {/* Review rows — the exact numbers the wallet will be asked to sign. */}
            <div style={{
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 15, padding: '4px 0', marginBottom: 14, overflow: 'hidden',
            }}>
              {(exec?.review || []).map(([label, value]) => (
                <div key={label} className="row-between" style={{ padding: '11px 14px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{label}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{value}</span>
                </div>
              ))}
            </div>

            {/* The steps, before and while they run. */}
            <div style={{
              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: 15, marginBottom: 14, overflow: 'hidden',
            }}>
              <div style={{ padding: '9px 13px', fontSize: 10.5, fontWeight: 800, letterSpacing: '.08em', color: 'var(--text-3)', textTransform: 'uppercase' }}>
                {t('loan.stepsTitle', { n: (exec?.steps || []).length })}
              </div>
              {(exec?.steps || []).map((step) => (
                <StepRow key={step.id} step={{ ...step, chainId: exec?.chainId }} asset={asset} t={t} />
              ))}
            </div>

            {phase === 'failed' && (
              <div
                data-testid="loan-exec-error"
                style={{
                  background: 'rgba(248,113,113,0.09)', border: '1px solid rgba(248,113,113,0.28)',
                  borderRadius: 12, padding: '10px 13px', marginBottom: 14,
                  fontSize: 12, lineHeight: 1.7, color: '#f8a8a8',
                }}
              >
                {t(`loan.error.${exec?.code || 'UNKNOWN'}`, { defaultValue: exec?.message || t('loan.error.UNKNOWN') })}
              </div>
            )}

            {phase === 'done' && (
              <div
                data-testid="loan-exec-done"
                style={{
                  background: 'rgba(74,222,128,0.09)', border: '1px solid rgba(74,222,128,0.28)',
                  borderRadius: 12, padding: '10px 13px', marginBottom: 14,
                  fontSize: 12, lineHeight: 1.7, color: '#8ee7b0',
                }}
              >
                {t(`loan.done.${exec?.action || 'supply'}`)}
              </div>
            )}

            <div style={{
              background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)',
              borderRadius: 12, padding: '10px 13px', marginBottom: 16,
              display: 'flex', gap: 9, alignItems: 'flex-start',
            }}>
              <span style={{ fontSize: 15, flexShrink: 0 }}>⚠️</span>
              <p style={{ fontSize: 12, lineHeight: 1.65, color: 'var(--text-2)', margin: 0 }}>
                {t('loan.walletSignBody')}
              </p>
            </div>

            {phase === 'review' && (
              <motion.button
                className="btn btn-primary"
                data-testid="loan-exec-confirm"
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
            )}

            {phase === 'running' && (
              <button className="btn btn-primary" style={{ marginBottom: 10, width: '100%', opacity: 0.7 }} disabled>
                {t('loan.running')}
              </button>
            )}

            {(phase === 'done' || phase === 'failed') && (
              <button
                className="btn btn-primary"
                data-testid="loan-exec-close"
                style={{ marginBottom: 10, width: '100%' }}
                onClick={onDone}
              >
                {t('common.close', { defaultValue: 'Close' })}
              </button>
            )}

            {phase !== 'running' && (
              <button className="btn btn-ghost" style={{ width: '100%' }} onClick={onCancel}>
                {phase === 'review' ? t('common.cancel') : t('loan.backToLoan')}
              </button>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   CHAIN RAIL — the markets this screen can actually execute on
   ═══════════════════════════════════════════════════════════════════════════ */

function ChainRail({ chain, onPick, t }) {
  return (
    <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 10 }}>
      <span className="faint" style={{ fontSize: 10, alignSelf: 'center', flexShrink: 0, marginInlineEnd: 2 }}>
        {t('loan.market')}
      </span>
      {lendingChains().map((id) => {
        const on = id === chain;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onPick(id)}
            data-testid={`loan-chain-${id}`}
            data-active={on ? 'true' : 'false'}
            style={{
              flexShrink: 0, padding: '6px 11px', borderRadius: 999, cursor: 'pointer',
              fontSize: 11, fontWeight: 700,
              background: on ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${on ? (CHAIN_DOT[id] || '#888') + '88' : 'rgba(255,255,255,0.08)'}`,
              color: on ? 'var(--text-1)' : 'var(--text-3)',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: 99, background: CHAIN_DOT[id] || '#888' }} />
            {chainLabel(id)}
          </button>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   ACCOUNT SUMMARY — the pool's own view of this wallet
   ═══════════════════════════════════════════════════════════════════════════ */

function AccountSummary({ account, t }) {
  if (!account?.ok) return null;
  const band = healthBand(account.healthFactor);
  const tone = { safe: '#4ade80', watch: '#facc15', risky: '#fb923c', critical: '#f87171', none: 'var(--text-3)' }[band];
  const cells = [
    [t('loan.collateral'), fmtUsd(account.totalCollateralUsd)],
    [t('loan.debt'), fmtUsd(account.totalDebtUsd)],
    [t('loan.borrowPower'), fmtUsd(account.availableBorrowsUsd)],
  ];
  return (
    <div
      data-testid="loan-account-summary"
      style={{
        borderRadius: 16, padding: '13px 14px', marginBottom: 12,
        background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        {cells.map(([label, value]) => (
          <div key={label} style={{ flex: '1 1 0', minWidth: 0 }}>
            <div className="faint" style={{ fontSize: 9.5, marginBottom: 3 }}>{label}</div>
            <div style={{ fontSize: 13, fontWeight: 800, fontFamily: 'var(--font-mono)' }}>{value}</div>
          </div>
        ))}
      </div>
      <div className="row-between" style={{ gap: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{t('loan.healthFactor')}</span>
        <span data-testid="loan-health" style={{ fontSize: 12, fontWeight: 800, color: tone, fontFamily: 'var(--font-mono)' }}>
          {account.healthFactor == null ? t('loan.healthNone') : `${account.healthFactor.toFixed(2)} · ${t(`loan.health.${band}`)}`}
        </span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SUPPLY TAB
   ═══════════════════════════════════════════════════════════════════════════ */

function SupplyTab({ market, t, haptic, notify, onExecute, preset }) {
  const { assets, reserves, positions, loading, chain, walletState } = market;
  const [selected, setSelected] = useState(null);
  const [amount, setAmount] = useState('');

  /* A hand-off from Intent OS (or a shared link) arrives with the asset and
     the amount already decided — the user should only have to confirm. */
  useEffect(() => {
    if (!preset?.symbol || !assets.length) return;
    const match = assets.find((a) => a.symbol.toUpperCase() === String(preset.symbol).toUpperCase());
    if (match) {
      setSelected(match);
      if (preset.amount) setAmount(String(preset.amount));
    }
  }, [preset?.symbol, preset?.amount, assets]);

  const position = selected ? positions[selected.id] : null;
  const walletMax = position?.wallet && Number(position.wallet) > 0 ? position.wallet : null;
  const reserve = selected ? reserves[selected.id] : null;

  const overWallet = Boolean(walletMax && Number(amount) > Number(walletMax));
  const invalid = !selected || !amount || Number(amount) <= 0 || overWallet;

  const run = () => {
    if (!selected) { notify('loan.chooseAssetFirst', 'error'); return; }
    if (!amount || Number(amount) <= 0) { notify('loan.enterAmount', 'error'); return; }
    if (overWallet) { notify('loan.amountOverWallet', 'error'); return; }
    haptic?.('medium');
    onExecute({ action: 'supply', asset: selected, amount });
  };

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

      <motion.p variants={riseIn} className="prose-sm" style={{ lineHeight: 1.8, padding: '0 2px' }}>
        {t('loan.supplyDesc')}
      </motion.p>

      <motion.div variants={riseIn}>
        <p className="section-label" style={{ marginBottom: 8 }}>{t('loan.chooseAsset')}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {assets.map(a => (
            <AssetCard
              key={a.id}
              asset={a} selected={selected} side="supply"
              reserve={reserves[a.id]} loading={loading} t={t}
              onClick={() => { haptic?.('select'); setSelected(a); setAmount(''); }}
            />
          ))}
          {assets.length === 0 && (
            <p className="faint" style={{ fontSize: 12 }}>{t('loan.noAssetsOnChain', { chain: chainLabel(chain) })}</p>
          )}
        </div>
      </motion.div>

      <AnimatePresence>
        {selected && (
          <motion.div
            key={selected.id}
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
                testId="loan-amount-supply"
                label={t('loan.supplyAmount', { symbol: selected.symbol })}
                value={amount} onChange={setAmount}
                asset={selected} autoFocus
                max={walletMax} maxLabel={t('loan.maxOf', { amount: walletMax, symbol: selected.symbol })}
                hint={position?.supplied && Number(position.supplied) > 0
                  ? t('loan.alreadySupplied', { amount: position.supplied, symbol: selected.symbol })
                  : reserve?.supplyApyPct != null
                    ? t('loan.earnHint', { apy: reserve.supplyApyPct.toFixed(2) })
                    : undefined}
              />
              {overWallet && (
                <p style={{ fontSize: 11.5, color: '#f87171', margin: '0 0 10px' }}>{t('loan.amountOverWallet')}</p>
              )}
              <ActionButton
                state={walletState}
                onConnect={market.connect}
                onSwitch={market.switchToChain}
                onRun={run}
                disabled={invalid}
                label={walletState === 'wrong-chain' ? chainLabel(chain) : t('loan.supplyBtn', { symbol: selected.symbol })}
                color={selected.color}
                icon={<IconTrend width={14} height={14} style={{ marginInlineEnd: 6 }} />}
                t={t}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   BORROW TAB
   ═══════════════════════════════════════════════════════════════════════════ */

function BorrowTab({ market, t, haptic, notify, onExecute, preset }) {
  const { assets, reserves, positions, loading, chain, account, walletState } = market;
  const [selected, setSelected] = useState(null);
  const [collateral, setCollateral] = useState('');
  const [amount, setAmount] = useState('');

  useEffect(() => {
    if (!preset?.symbol || !assets.length) return;
    const match = assets.find((a) => a.symbol.toUpperCase() === String(preset.symbol).toUpperCase());
    if (match) {
      setSelected(match);
      if (preset.amount) setAmount(String(preset.amount));
      if (preset.collateral) setCollateral(String(preset.collateral));
    }
  }, [preset?.symbol, preset?.amount, preset?.collateral, assets]);

  const position = selected ? positions[selected.id] : null;
  const walletMax = position?.wallet && Number(position.wallet) > 0 ? position.wallet : null;

  /* Borrowing power the POOL reports, plus what the collateral in this form
     would add. Both are shown; neither is a recommendation. */
  const powerUsd = account?.ok ? account.availableBorrowsUsd : null;
  const projected = account?.ok && amount
    ? projectHealthFactor({
      totalCollateralUsd: account.totalCollateralUsd,
      totalDebtUsd: account.totalDebtUsd,
      liquidationThresholdPct: account.liquidationThresholdPct,
      addDebtUsd: Number(amount) || 0,
      addCollateralUsd: Number(collateral) || 0
    })
    : null;

  const noCollateral = Boolean(account?.ok
    && (account.totalCollateralUsd || 0) <= 0
    && (!collateral || Number(collateral) <= 0));
  const invalid = !selected || !amount || Number(amount) <= 0 || noCollateral;

  const run = () => {
    if (!selected) { notify('loan.chooseAssetFirst', 'error'); return; }
    if (!amount || Number(amount) <= 0) { notify('loan.enterAmount', 'error'); return; }
    if (noCollateral) { notify('loan.needCollateralFirst', 'error'); return; }
    haptic?.('medium');
    onExecute({ action: 'borrow', asset: selected, amount, collateral });
  };

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

      <motion.p variants={riseIn} className="prose-sm" style={{ lineHeight: 1.8, padding: '0 2px' }}>
        {t('loan.borrowDesc')}
      </motion.p>

      <motion.div variants={riseIn}>
        <p className="section-label" style={{ marginBottom: 8 }}>{t('loan.chooseBorrowAsset')}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {assets.map(a => (
            <AssetCard
              key={a.id}
              asset={a} selected={selected} side="borrow"
              reserve={reserves[a.id]} loading={loading} t={t}
              onClick={() => { haptic?.('select'); setSelected(a); setCollateral(''); setAmount(''); }}
            />
          ))}
          {assets.length === 0 && (
            <p className="faint" style={{ fontSize: 12 }}>{t('loan.noAssetsOnChain', { chain: chainLabel(chain) })}</p>
          )}
        </div>
      </motion.div>

      <AnimatePresence>
        {selected && (
          <motion.div
            key={selected.id}
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
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)',
                borderRadius: 9, padding: '5px 10px', marginBottom: 14,
              }}>
                <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{t('loan.borrowPower')}:</span>
                <span data-testid="loan-borrow-power" style={{ fontSize: 12, fontWeight: 800, color: selected.color }}>
                  {powerUsd == null ? '—' : fmtUsd(powerUsd)}
                </span>
              </div>

              <AmountInput
                testId="loan-amount-collateral"
                label={t('loan.collateralOptional', { symbol: selected.symbol })}
                value={collateral} onChange={setCollateral}
                asset={selected}
                max={walletMax} maxLabel={t('loan.maxOf', { amount: walletMax, symbol: selected.symbol })}
                hint={t('loan.collateralHint')}
              />

              <AmountInput
                testId="loan-amount-borrow"
                label={t('loan.borrowAmountLabel', { symbol: selected.symbol })}
                value={amount} onChange={setAmount}
                asset={selected}
                hint={projected != null ? t('loan.projectedHealth', { hf: projected.toFixed(2) }) : undefined}
              />

              {noCollateral && (
                <p style={{ fontSize: 11.5, color: '#fbbf24', margin: '0 0 10px' }}>{t('loan.needCollateralFirst')}</p>
              )}

              <ActionButton
                state={walletState}
                onConnect={market.connect}
                onSwitch={market.switchToChain}
                onRun={run}
                disabled={invalid}
                label={walletState === 'wrong-chain' ? chainLabel(chain) : t('loan.borrowBtn', { symbol: selected.symbol })}
                color={selected.color}
                icon={<IconPools width={14} height={14} style={{ marginInlineEnd: 6 }} />}
                t={t}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   POSITIONS TAB — the real position, managed here
   ═══════════════════════════════════════════════════════════════════════════ */

function PositionsTab({ market, t, haptic, onExecute }) {
  const { assets, positions, account, loading, walletState, refresh } = market;
  const [draft, setDraft] = useState({});

  const rows = assets
    .map((asset) => ({ asset, position: positions[asset.id] }))
    .filter(({ position }) => position && (Number(position.supplied) > 0 || Number(position.debt) > 0));

  if (walletState === 'disconnected') {
    return (
      <motion.div variants={stagger} initial="hidden" animate="show" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <motion.p variants={riseIn} className="prose-sm" style={{ lineHeight: 1.8 }}>{t('loan.positionsBody')}</motion.p>
        <motion.button
          variants={riseIn} type="button" className="btn btn-primary"
          data-testid="loan-connect" onClick={market.connect} style={{ width: '100%' }}
        >
          {t('loan.connectWallet')}
        </motion.button>
      </motion.div>
    );
  }

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <AccountSummary account={account} t={t} />

      {rows.length === 0 && (
        <motion.p variants={riseIn} className="faint" data-testid="loan-no-positions" style={{ fontSize: 12.5, lineHeight: 1.8 }}>
          {loading ? t('loan.loadingPositions') : t('loan.noPositions')}
        </motion.p>
      )}

      {rows.map(({ asset, position }) => {
        const value = draft[asset.id] || '';
        const supplied = Number(position.supplied) > 0;
        const owes = Number(position.debt) > 0;
        return (
          <motion.div
            key={asset.id}
            variants={riseIn}
            data-testid={`loan-position-${asset.symbol.toLowerCase()}`}
            style={{
              borderRadius: 16, padding: '13px 14px',
              background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 10 }}>
              <AssetAvatar asset={asset} size={34} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{asset.symbol}</div>
                <div className="faint" style={{ fontSize: 10.5 }}>{chainLabel(asset.chain)}</div>
              </div>
              <div style={{ textAlign: 'end' }}>
                {supplied && (
                  <div style={{ fontSize: 11.5, color: '#4ade80', fontFamily: 'var(--font-mono)' }}>
                    {t('loan.supplied')}: {position.supplied}
                  </div>
                )}
                {owes && (
                  <div style={{ fontSize: 11.5, color: '#f87171', fontFamily: 'var(--font-mono)' }}>
                    {t('loan.borrowed')}: {position.debt}
                  </div>
                )}
              </div>
            </div>

            <AmountInput
              testId={`loan-amount-${asset.symbol.toLowerCase()}`}
              label={t('loan.manageAmount', { symbol: asset.symbol })}
              value={value}
              onChange={(next) => setDraft((prev) => ({ ...prev, [asset.id]: next }))}
              asset={asset}
            />

            <div style={{ display: 'flex', gap: 8 }}>
              {supplied && (
                <button
                  type="button" className="btn btn-ghost btn-sm"
                  data-testid={`loan-withdraw-${asset.symbol.toLowerCase()}`}
                  style={{ flex: 1 }}
                  disabled={!value || Number(value) <= 0}
                  onClick={() => { haptic?.('medium'); onExecute({ action: 'withdraw', asset, amount: value }); }}
                >
                  {t('loan.withdraw')}
                </button>
              )}
              {owes && (
                <button
                  type="button" className="btn btn-ghost btn-sm"
                  data-testid={`loan-repay-${asset.symbol.toLowerCase()}`}
                  style={{ flex: 1 }}
                  disabled={!value || Number(value) <= 0}
                  onClick={() => { haptic?.('medium'); onExecute({ action: 'repay', asset, amount: value }); }}
                >
                  {t('loan.repay')}
                </button>
              )}
            </div>
          </motion.div>
        );
      })}

      <motion.button
        variants={riseIn} type="button" className="btn btn-ghost btn-sm"
        data-testid="loan-refresh-positions" onClick={refresh} style={{ width: '100%' }}
      >
        {t('common.refresh', { defaultValue: 'Refresh' })}
      </motion.button>

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
    { Icon: IconLock, key: 'step1', color: '#4ade80' },
    { Icon: IconTrend, key: 'step2', color: '#60a5fa' },
    { Icon: IconBank, key: 'step3', color: '#a78bfa' },
    { Icon: IconCoins, key: 'step4', color: '#fbbf24' },
  ];

  return (
    <div style={{
      background: 'var(--surface-1)',
      border: '1px solid var(--line)',
      borderRadius: 14, overflow: 'hidden',
      boxShadow: '0 2px 10px rgba(0,0,0,0.05)',
    }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', padding: '15px 18px', background: 'transparent',
          cursor: 'pointer', gap: 8,
        }}
      >
        <span style={{ fontWeight: 800, fontSize: 13.5, color: 'var(--text-1)' }}>{t('loan.howTitle')}</span>
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.2 }}>
          <IconChevronRight width={16} height={16} style={{ color: 'var(--text-3)' }} />
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
            <div style={{ padding: '0 18px 18px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {steps.map((s, i) => (
                <div key={s.key} style={{ display: 'flex', gap: 14, alignItems: 'flex-start', position: 'relative' }}>
                  {i !== steps.length - 1 && (
                    <div style={{
                      position: 'absolute', top: 40, bottom: -16, right: 18, width: 2,
                      background: 'var(--line)', borderRadius: 2
                    }} />
                  )}
                  <div style={{
                    width: 38, height: 38, borderRadius: 12,
                    background: `linear-gradient(135deg, ${s.color}22, ${s.color}11)`,
                    border: `1px solid ${s.color}33`,
                    display: 'grid', placeItems: 'center', flexShrink: 0,
                    color: s.color, zIndex: 1
                  }}>
                    <s.Icon width={20} height={20} />
                  </div>
                  <div style={{ paddingTop: 2 }}>
                    <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 4, color: 'var(--text-1)' }}>
                      {t(`loan.${s.key}Title`)}
                    </div>
                    <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.7 }}>
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
    { label: t('loan.nonCustodial'), sub: t('loan.nonCustodialSub'), color: '#4ade80', Icon: IconLock },
    { label: t('loan.fbtFee'),       sub: t('loan.fbtFeeSub'),       color: '#60a5fa', Icon: IconCoins },
    { label: t('loan.noKyc'),        sub: t('loan.noKycSub'),        color: '#a78bfa', Icon: IconUser },
  ];
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {stats.map(s => (
        <motion.div
          key={s.label}
          whileTap={{ scale: 0.96 }}
          style={{
            flex: '1 1 0', padding: '12px 10px', borderRadius: 14, textAlign: 'center',
            background: 'var(--surface-1)',
            border: '1px solid var(--line)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            display: 'flex', flexDirection: 'column', alignItems: 'center'
          }}
        >
          <div style={{
            width: 32, height: 32, borderRadius: 10, marginBottom: 8, display: 'grid', placeItems: 'center',
            background: `linear-gradient(135deg, ${s.color}22, ${s.color}11)`,
            color: s.color
          }}>
            <s.Icon width={18} height={18} />
          </div>
          <div style={{ fontWeight: 800, fontSize: 11, color: 'var(--text-1)', lineHeight: 1.2 }}>
            {s.label}
          </div>
          <div style={{ fontSize: 9.5, color: 'var(--text-3)', marginTop: 3, lineHeight: 1.3 }}>
            {s.sub}
          </div>
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
  const [searchParams] = useSearchParams();
  const { haptic } = useTelegram();
  const notify = useAppStore(s => s.notify);
  const wallet = useWallet();

  const {
    address = null,
    chainId: walletChainId = null,
    isConnected = false,
    connectInjected,
    switchChain,
    getReadProvider,
    getSigner
  } = wallet || {};

  /*
   * The Intent OS workflow step actions hand off here with ?tab=supply /
   * ?tab=borrow (deposit → supply, borrow → borrow) and, since the workflow
   * carries real values, with ?asset=&amount=&chain= as well: the venue is
   * pre-filled and the user only has to confirm.
   */
  const [tab, setTab] = useState(() => {
    const requested = searchParams.get('tab');
    return requested === 'borrow' || requested === 'positions' ? requested : 'supply';
  });

  const urlChain = Number(searchParams.get('chain'));
  const [chain, setChain] = useState(() => {
    if (lendingSupported(urlChain)) return urlChain;
    if (isConnected && lendingSupported(walletChainId)) return Number(walletChainId);
    return 42161;
  });

  const preset = useMemo(() => ({
    symbol: searchParams.get('asset') || searchParams.get('from') || null,
    amount: searchParams.get('amount') || null,
    collateral: searchParams.get('collateral') || null
  }), [searchParams]);

  /*
   * Follow the wallet when it moves to another supported market — but only
   * once a wallet is actually CONNECTED. A disconnected context still reports
   * its default chain, and following that used to throw away the market the
   * user (or an Intent OS hand-off) had asked for in `?chain=`: you opened a
   * prefilled Arbitrum deposit and landed on the BNB market.
   */
  useEffect(() => {
    if (!isConnected || !address) return;
    if (lendingSupported(walletChainId)) setChain(Number(walletChainId));
  }, [walletChainId, isConnected, address]);

  const assets = useMemo(() => lendingAssetsFor(chain), [chain]);
  const venue = useMemo(() => lendingVenue(chain), [chain]);

  const [reserves, setReserves] = useState({});
  const [positions, setPositions] = useState({});
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [readAt, setReadAt] = useState(null);
  const [exec, setExec] = useState(null);

  const walletState = !isConnected || !address
    ? 'disconnected'
    : Number(walletChainId) !== Number(chain)
      ? 'wrong-chain'
      : 'ready';

  /**
   * One read pass: live reserve rates for every asset (no wallet needed) and,
   * when a wallet is connected, that wallet's position in each of them.
   */
  const refresh = useCallback(async () => {
    if (!venue || typeof getReadProvider !== 'function') { setLoading(false); return; }
    setLoading(true);
    try {
      const provider = await getReadProvider(chain);
      const nextReserves = await readReserves({ provider, chainId: chain, assets });
      setReserves(nextReserves);
      if (address) {
        const [acct, entries] = await Promise.all([
          readUserAccount({ provider, chainId: chain, user: address }),
          Promise.all(assets.map(async (asset) => [
            asset.id,
            await readAssetPosition({ provider, chainId: chain, asset, user: address, reserve: nextReserves[asset.id] })
          ]))
        ]);
        setAccount(acct);
        setPositions(Object.fromEntries(entries));
      } else {
        setAccount(null);
        setPositions({});
      }
      setReadAt(Date.now());
    } catch {
      /* A dead RPC leaves the last honest numbers on screen and the dash
         where a rate could not be read — it never invents one. */
    } finally {
      setLoading(false);
    }
  }, [venue, chain, assets, address, getReadProvider]);

  useEffect(() => { refresh(); }, [refresh]);

  const connect = useCallback(() => {
    haptic?.('light');
    if (typeof connectInjected === 'function') connectInjected();
    else notify('loan.connectWalletFirst', 'error');
  }, [connectInjected, haptic, notify]);

  const switchToChain = useCallback(async () => {
    haptic?.('light');
    if (typeof switchChain === 'function') await switchChain(chain);
  }, [switchChain, chain, haptic]);

  /**
   * Review first: the allowance is read BEFORE the sheet opens, so the steps
   * the user is shown are exactly the transactions their wallet will be asked
   * to sign — an approval appears only when the current allowance is short.
   */
  const openExecution = useCallback(async ({ action, asset, amount, collateral = null }) => {
    let allowanceWei = null;
    try {
      if (typeof getReadProvider === 'function' && address) {
        const provider = await getReadProvider(chain);
        allowanceWei = await readAllowance({ provider, chainId: chain, asset, owner: address });
      }
    } catch { allowanceWei = null; }

    const plan = buildLendingPlan({ action, asset, amount, collateral, allowanceWei, decimals: asset.decimals });
    if (!plan.ok) { notify('loan.enterAmount', 'error'); return; }

    const review = [
      [t('loan.asset'), asset.symbol],
      [t('loan.action'), t(`loan.sheetTitle.${action}`)],
      [t('loan.amount'), `${amount} ${asset.symbol}`]
    ];
    if (collateral && Number(collateral) > 0) review.push([t('loan.collateral'), `${collateral} ${asset.symbol}`]);
    review.push([t('loan.market'), chainLabel(chain)]);

    setExec({
      action,
      asset,
      amount,
      collateral,
      chainId: chain,
      review,
      steps: plan.steps.map((step) => ({ ...step, state: 'pending', hash: null })),
      phase: 'review'
    });
  }, [address, chain, getReadProvider, notify, t]);

  /** Run the reviewed plan. Every step is the user's own wallet signature. */
  const confirmExecution = useCallback(async () => {
    if (!exec) return;
    const signer = typeof getSigner === 'function' ? getSigner() : null;
    if (!signer) {
      setExec((prev) => (prev ? { ...prev, phase: 'failed', code: 'WALLET_NOT_CONNECTED' } : prev));
      return;
    }
    setExec((prev) => (prev ? { ...prev, phase: 'running' } : prev));
    const result = await runLendingPlan({
      steps: exec.steps,
      signer,
      chainId: exec.chainId,
      asset: exec.asset,
      account: address,
      onStep: (update) => {
        setExec((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            steps: prev.steps.map((step) => (step.id === update.id
              ? { ...step, state: update.state, hash: update.hash || step.hash }
              : step))
          };
        });
      }
    });
    setExec((prev) => (prev
      ? { ...prev, phase: result.ok ? 'done' : 'failed', code: result.code || null, message: result.message || null }
      : prev));
    if (result.ok) haptic?.('success');
    refresh();
  }, [exec, getSigner, address, refresh, haptic]);

  const market = {
    chain, assets, reserves, positions, account, loading, walletState,
    connect, switchToChain, refresh
  };

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
          onClick={refresh}
          data-testid="loan-refresh"
          aria-label={t('common.refresh', { defaultValue: 'Refresh' })}
        >
          <motion.span
            animate={loading ? { rotate: 360 } : { rotate: 0 }}
            transition={loading ? { repeat: Infinity, duration: 0.8, ease: 'linear' } : { duration: 0.2 }}
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

      {/* ── Market picker ──────────────────────────────────────────────── */}
      <ChainRail chain={chain} onPick={(id) => { haptic?.('select'); setChain(id); }} t={t} />

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
          const on = tab === tb.id;
          return (
            <button
              key={tb.id}
              type="button"
              data-testid={`loan-tab-${tb.id}`}
              data-active={on ? 'true' : 'false'}
              onClick={() => { haptic?.('select'); setTab(tb.id); }}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                padding: '9px 6px', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: 'transparent', position: 'relative',
                color: on ? 'var(--text-1)' : 'var(--text-3)',
                fontWeight: on ? 700 : 500, fontSize: 12.5, transition: 'color 0.16s',
              }}
            >
              {on && (
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
              <span style={{ position: 'relative', opacity: on ? 1 : 0.6, display: 'inline-flex' }}>{tb.icon}</span>
              <span style={{ position: 'relative' }}>{tb.label}</span>
            </button>
          );
        })}
      </motion.div>

      {/* Where the numbers come from — stated, not implied. */}
      <motion.p
        variants={riseIn} initial="hidden" animate="show"
        className="faint" data-testid="loan-rate-source"
        style={{ fontSize: 10.5, margin: '-6px 2px 10px', lineHeight: 1.7 }}
      >
        {venue
          ? t('loan.rateSource', { chain: chainLabel(chain), at: readAt ? new Date(readAt).toLocaleTimeString() : '—' })
          : t('loan.chainUnsupported', { chain: chainLabel(chain) })}
      </motion.p>

      {/* ── Tab body ───────────────────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {tab === 'supply' && (
          <motion.div key="supply" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
            <SupplyTab market={market} t={t} haptic={haptic} notify={notify} onExecute={openExecution} preset={preset} />
          </motion.div>
        )}
        {tab === 'borrow' && (
          <motion.div key="borrow" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
            <BorrowTab market={market} t={t} haptic={haptic} notify={notify} onExecute={openExecution} preset={preset} />
          </motion.div>
        )}
        {tab === 'positions' && (
          <motion.div key="positions" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
            <PositionsTab market={market} t={t} haptic={haptic} onExecute={openExecution} />
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 6 }}>
        <HowItWorks t={t} />
      </motion.div>

      <motion.div variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 2 }}>
        <InfoBox title={t('loan.riskTitle')} tone="danger" id="loan-risk-global">
          <p>{t('loan.riskBody')}</p>
          <p style={{ marginTop: 6 }}>{t('loan.riskBody2')}</p>
        </InfoBox>
      </motion.div>

      <ExecutionSheet
        exec={exec}
        asset={exec?.asset}
        onConfirm={confirmExecution}
        onCancel={() => setExec(null)}
        onDone={() => { setExec(null); setTab('positions'); }}
        t={t}
      />
    </PageTransition>
  );
}

/* Kept for the probes and for any caller that needs the raw unit helpers. */
export { toUnits as loanToUnits, fromUnits as loanFromUnits };
