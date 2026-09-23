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
import WalletConnectSheet from '../components/WalletConnectSheet';
import SolanaLendingPanel from '../components/SolanaLendingPanel';
import AssetIcon from '../components/AssetIcon';
import { useWallet } from '../context/WalletContext';
import { useAppStore } from '../store/useAppStore';
import { POINT_VALUES } from '../lib/ranks';
import { useTelegram } from '../context/TelegramContext';
import { SOLANA_LENDING_CHAIN_ID } from '../lib/lending.js';
import { loanErrorText } from '../lib/loanErrors';
import { EVM_CHAINS, explorerTx } from '../lib/chains';
import { apiBase } from '../lib/apiBase';
import {
  lendingVenue, lendingSupported, lendingAssetsFor,
  readAllowance,
  buildLendingPlan,
  fromUnits, toUnits, isMaxAmount, assertCollateralChangeSafe
} from '../lib/lending';
import {
  readMarketState, getMaxBorrow, projectActionRisk, evaluateAction,
  simulateLendingPlan, estimateNetworkFee, executeLendingPlan,
  createMarketCache, createTransactionHistory,
  DATA_STATUS, TX_STATUS, MARKET_POLL_MS, MARKET_STALE_AFTER_MS,
  MIN_HEALTH_FACTOR_AFTER_BORROW, chainNativeSymbol
} from '../lib/lending-service';
import {
  mapRawError, LENDING_ERRORS,
  createTransactionMachine, TX_STATE,
  createInFlightGuard, makeIdempotencyKey, makeRequestId,
  evaluateAlerts, assessPosition, riskLevel,
  enabledNetworks, LENDING_NETWORKS, isNetworkEnabled
} from '../lib/lending-engine';
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
  8453: '#0052ff', 10: '#ff0420', 43114: '#e84142',
  59144: '#61dfff', 146: '#fe9a4d', 900001: '#9945ff'
};
const chainLabel = (id) => id === SOLANA_LENDING_CHAIN_ID ? 'Solana' : EVM_CHAINS[id]?.name || `#${id}`;

/**
 * Codes the engine already defines. A failure whose code is one of these is
 * passed through untouched; anything else goes through `mapRawError` so a raw
 * wallet/RPC/protocol message never becomes the explanation a user reads (§28).
 */
const LENDING_CODES = new Set(Object.keys(LENDING_ERRORS));

/* ═══════════════════════════════════════════════════════════════════════════
   SMALL HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

const fmtUsd = (value) => (value == null || !Number.isFinite(Number(value))
  ? '—'
  : `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

/**
 * Reserve artwork: the vendored token SVG plus the chain's own network badge,
 * exactly the art the swap screen uses. Assets come from the app's audited
 * registry (`lendingAssetsFor`), so symbol-keyed artwork is safe here — the
 * address behind each symbol is ours, never user-imported. The old
 * three-letter gradient tile is what «آیکن‌های واقعی نمایش داده نمی‌شوند»
 * reported: keep the monogram only as AssetIcon's deliberate last resort.
 */
function AssetAvatar({ asset, size = 40 }) {
  return (
    <span style={{ width: size, height: size, flexShrink: 0, display: 'block' }} title={chainLabel(asset.chain)}>
      <AssetIcon symbol={asset.symbol} chain={asset.chain} size={size} radius={Math.round(size * 0.32)} alt={asset.symbol} />
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

/**
 * The reserve's OWN state, from the protocol.
 *
 * This slot used to render a per-symbol "low / medium / high risk" pill from a
 * hardcoded table in lending.js, keyed by ticker and defaulting to "medium" for
 * anything the table had not heard of. It sat directly under a live APY number,
 * so it read as a live risk assessment of the market while being an editorial
 * guess that could not change, could not be wrong loudly, and was borrowed from
 * the Invest page's vocabulary (§37).
 *
 * What actually varies per reserve on Aave — and what a supplier needs — is the
 * protocol's own state: whether the reserve is paused or frozen, and the max LTV
 * it will accept this asset as collateral for. Both are read from the reserve
 * configuration bitmap. When that bitmap could not be read, this renders
 * NOTHING: an absent pill is honest, an invented one is not.
 */
function ReserveStatePill({ reserve, t }) {
  if (!reserve || reserve.listed === false) return null;
  const halted = reserve.status === 'paused' || reserve.status === 'frozen';
  const label = halted
    ? t(`loan.reserveStatus.${reserve.status}`)
    : (reserve.ltvPct != null ? `${t('loan.maxLtv')} ${Number(reserve.ltvPct).toFixed(0)}%` : null);
  if (!label) return null;
  const fg = reserve.status === 'paused' ? '#f87171' : reserve.status === 'frozen' ? '#fbbf24' : '#93c5fd';
  return (
    <span
      data-testid="loan-reserve-state"
      data-status={reserve.status}
      title={halted ? t('loan.reserveStateHalted') : t('loan.reserveStateLtv')}
      style={{
        fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 99,
        background: `${fg}1f`, color: fg, border: `1px solid ${fg}33`,
      }}
    >
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
   §3 — WHERE A NUMBER CAME FROM
   Four states, always visible: live / cached (with its age) / partial /
   unavailable. The point is that the user can tell a read from a memory of a
   read, and can tell "we could not read this" from "this is zero".
   ═══════════════════════════════════════════════════════════════════════════ */

const STATUS_TONE = {
  live: { fg: '#4ade80', bg: 'rgba(74,222,128,0.12)', label: 'loan.status.live' },
  estimated: { fg: '#60a5fa', bg: 'rgba(96,165,250,0.12)', label: 'loan.status.estimated' },
  cached: { fg: '#fbbf24', bg: 'rgba(251,191,36,0.12)', label: 'loan.status.cached' },
  partial: { fg: '#fbbf24', bg: 'rgba(251,191,36,0.12)', label: 'loan.status.partial' },
  unavailable: { fg: '#f87171', bg: 'rgba(248,113,113,0.12)', label: 'loan.status.unavailable' }
};

function DataStatusPill({ status, ageMs, t, testId = 'loan-data-status' }) {
  const tone = STATUS_TONE[status] ?? STATUS_TONE.unavailable;
  const stale = status === DATA_STATUS.CACHED && Number(ageMs) > MARKET_STALE_AFTER_MS;
  return (
    <span
      data-testid={testId}
      data-status={status}
      title={status === DATA_STATUS.CACHED && ageMs != null ? t('loan.statusAge', { s: Math.round(ageMs / 1000) }) : undefined}
      style={{
        fontSize: 9.5, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase',
        padding: '2px 7px', borderRadius: 99, whiteSpace: 'nowrap',
        color: stale ? '#f87171' : tone.fg,
        background: stale ? 'rgba(248,113,113,0.12)' : tone.bg,
        border: `1px solid ${stale ? '#f8717133' : tone.fg + '33'}`,
      }}
    >
      {t(stale ? 'loan.status.stale' : tone.label)}
    </span>
  );
}

/**
 * §19 — "Updated X seconds ago", ticking. A market number with no timestamp is
 * a number the user cannot judge, and on a lending screen that is a risk
 * decision made on data of unknown age.
 */
function useSecondsSince(timestamp) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!timestamp) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [timestamp]);
  if (!timestamp) return null;
  return Math.max(0, Math.round((now - timestamp) / 1000));
}

function UpdatedAgo({ at, t }) {
  const seconds = useSecondsSince(at);
  if (seconds == null) return <span className="faint">—</span>;
  const label = seconds < 60 ? t('loan.updatedSeconds', { n: seconds })
    : seconds < 3600 ? t('loan.updatedMinutes', { n: Math.floor(seconds / 60) })
      : t('loan.updatedHours', { n: Math.floor(seconds / 3600) });
  return (
    <span data-testid="loan-updated-ago" className="faint" style={{ fontSize: 10, fontFamily: 'var(--font-mono)' }}>
      {label}
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   §20 — PROTOCOL LIQUIDITY
   Supplied / available / utilization / caps, read from the protocol's own
   aToken and debt token. A dash means the read failed, never "zero".
   ═══════════════════════════════════════════════════════════════════════════ */

const tokenNumFormatter = new Map();
function tokenNumOptions(key, options) {
  let formatter = tokenNumFormatter.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', options);
    tokenNumFormatter.set(key, formatter);
  }
  return formatter;
}

/**
 * A pool figure written for humans, not for the contract:
 *
 *   87,234,523.12  →  87.23M        (compact beyond a million)
 *   42,301.55      →  42,301.55     (grouped, two decimals)
 *   872.123231     →  872.1232      (four decimals)
 *   0.3948213      →  0.394821      (six significant decimals)
 *
 * Western digits on purpose, isolated with dir=ltr: the value sits inside a
 * mono-font chip in an RTL sentence, and bidi reordering across the grouping
 * separators is exactly what used to make these figures unreadable. The LABELS
 * around the number are localized; the number itself stays parseable by every
 * user of every locale this app ships.
 */
function fmtPoolAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const abs = Math.abs(n);
  try {
    if (abs >= 1_000_000) return tokenNumOptions('compact', { notation: 'compact', maximumFractionDigits: 2 }).format(n);
    if (abs >= 10_000) return tokenNumOptions('group2', { maximumFractionDigits: 2 }).format(n);
    if (abs >= 1) return tokenNumOptions('frac4', { maximumFractionDigits: 4 }).format(n);
    if (abs === 0) return '0';
    return tokenNumOptions('sig6', { maximumSignificantDigits: 6 }).format(n);
  } catch { return null; }
}

/** One metric in the depth grid. The value is an inline LTR isolate, so it
    follows the page's alignment (right in fa, left in en) while its digits,
    grouping separators and unit always read left-to-right. */
function DepthCell({ label, value, symbol, accent = null, testId = null }) {
  return (
    <div
      data-testid={testId || undefined}
      style={{
        minWidth: 0, borderRadius: 12, padding: '8px 10px',
        background: 'rgba(255,255,255,0.040)',
        border: '1px solid rgba(255,255,255,0.065)',
      }}
    >
      <div style={{ fontSize: 9.5, fontWeight: 600, color: 'var(--text-3)', marginBottom: 5, lineHeight: 1.4 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 12, fontWeight: 800, fontFamily: 'var(--font-mono)',
          color: accent || 'var(--text-1)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
        title={value == null ? undefined : `${value}${symbol ? ` ${symbol}` : ''}`}
      >
        <span dir="ltr" style={{ direction: 'ltr', unicodeBidi: 'isolate' }}>
          {value == null ? '—' : value}
          {value != null && symbol ? <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--text-3)' }}> {symbol}</span> : null}
        </span>
      </div>
    </div>
  );
}

function MarketDepth({ reserve, asset, t }) {
  if (!reserve?.listed) return null;
  const dec = Number(reserve.decimals ?? asset.decimals ?? 18);
  const total = reserve.totalSupplyWei != null ? fmtPoolAmount(fromUnits(reserve.totalSupplyWei, dec, 6)) : null;
  const available = reserve.availableLiquidityWei != null ? fmtPoolAmount(fromUnits(reserve.availableLiquidityWei, dec, 6)) : null;
  const borrowed = reserve.totalDebtWei != null ? fmtPoolAmount(fromUnits(reserve.totalDebtWei, dec, 6)) : null;
  const util = reserve.utilizationPct;
  const supplyCap = reserve.supplyCapWhole != null ? Number(reserve.supplyCapWhole) : null;
  const borrowCap = reserve.borrowCapWhole != null ? Number(reserve.borrowCapWhole) : null;

  /* Nothing could be read: say so in one honest box, not a grid of dashes. */
  if (total == null && available == null && borrowed == null && util == null && reserve.ltvPct == null) {
    return (
      <div
        data-testid="loan-depth-unavailable"
        style={{
          marginTop: 8, borderRadius: 13, padding: '10px 12px',
          background: 'rgba(251,191,36,0.07)', border: '1px dashed rgba(251,191,36,0.30)',
        }}
      >
        <p style={{ fontSize: 11.5, margin: 0, lineHeight: 1.7, color: 'var(--text-2)' }}>
          {t('loan.depthUnavailable')}
        </p>
      </div>
    );
  }

  return (
    <div data-testid="loan-market-depth" style={{ marginTop: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
        <DepthCell label={t('loan.totalSupplied')} value={total} symbol={asset.symbol} testId="loan-depth-supplied" />
        <DepthCell label={t('loan.totalBorrowed')} value={borrowed} symbol={asset.symbol} testId="loan-depth-borrowed" />
        <DepthCell label={t('loan.availableLiquidity')} value={available} symbol={asset.symbol} accent="#4ade80" testId="loan-depth-liquidity" />
        <DepthCell label={t('loan.utilization')} value={util != null ? `${util.toFixed(1)}%` : null} accent="#fbbf24" testId="loan-depth-utilization" />
      </div>

      {/* §13 — the reserve's own risk parameters, from its configuration bitmap. */}
      <div style={{ display: 'flex', gap: 7, marginTop: 7, flexWrap: 'wrap' }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          borderRadius: 99, padding: '5px 10px', fontSize: 10.5,
          background: 'rgba(147,197,253,0.09)', border: '1px solid rgba(147,197,253,0.22)',
        }}>
          <span style={{ color: 'var(--text-3)' }}>{t('loan.maxLtv')}</span>
          <strong dir="ltr" style={{ direction: 'ltr', unicodeBidi: 'isolate', fontFamily: 'var(--font-mono)', color: '#93c5fd' }}>
            {reserve.ltvPct != null ? `${reserve.ltvPct.toFixed(1)}%` : '—'}
          </strong>
        </span>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          borderRadius: 99, padding: '5px 10px', fontSize: 10.5,
          background: 'rgba(147,197,253,0.09)', border: '1px solid rgba(147,197,253,0.22)',
        }}>
          <span style={{ color: 'var(--text-3)' }}>{t('loan.liqThreshold')}</span>
          <strong dir="ltr" style={{ direction: 'ltr', unicodeBidi: 'isolate', fontFamily: 'var(--font-mono)', color: '#93c5fd' }}>
            {reserve.liquidationThresholdPct != null ? `${reserve.liquidationThresholdPct.toFixed(1)}%` : '—'}
          </strong>
        </span>
        {(supplyCap > 0 || borrowCap > 0) && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            borderRadius: 99, padding: '5px 10px', fontSize: 10.5,
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)',
          }}>
            <span style={{ color: 'var(--text-3)' }}>{t('loan.caps')}</span>
            <strong dir="ltr" style={{ direction: 'ltr', unicodeBidi: 'isolate', fontFamily: 'var(--font-mono)' }}>
              {t('loan.capsValue', {
                supply: supplyCap > 0 ? fmtPoolAmount(supplyCap) : t('loan.noCap'),
                borrow: borrowCap > 0 ? fmtPoolAmount(borrowCap) : t('loan.noCap')
              })}
            </strong>
          </span>
        )}
      </div>

      {/* §29 — a paused or frozen reserve must say so before the user signs. */}
      {(reserve.status === 'paused' || reserve.status === 'frozen') && (
        <p data-testid="loan-reserve-halted" style={{ fontSize: 10.5, fontWeight: 700, color: '#f87171', margin: '8px 0 0' }}>
          {t(`loan.reserveStatus.${reserve.status}`)}
        </p>
      )}
      {reserve.decimalsMatch === false && (
        <p data-testid="loan-decimals-mismatch" style={{ fontSize: 10.5, color: '#fbbf24', margin: '8px 0 0', lineHeight: 1.6 }}>
          {t('loan.decimalsMismatch', { decimals: dec })}
        </p>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   §13/§14 — RISK, WITH THE ACTUAL NUMBERS
   Bands come from the engine (lending-engine/health.js) — the same table the
   alert rules and the server BFF use. The page previously had its own second
   ladder (1.05/1.35/2.0) so one position could read "watch" in the summary and
   raise a "critical" alert from the bell.
   ═══════════════════════════════════════════════════════════════════════════ */

function RiskMeter({ projection, account, t }) {
  const before = projection?.healthFactorBefore ?? account?.healthFactor ?? null;
  const after = projection?.healthFactorAfter ?? null;
  const bandBefore = riskLevel(before);
  const bandAfter = after == null ? null : riskLevel(after);
  const threshold = projection?.liquidationThresholdPct ?? account?.liquidationThresholdPct ?? null;
  const risk = account?.ok ? assessPosition({
    healthFactor: account.healthFactor,
    totalDebtUsd: account.totalDebtUsd,
    totalCollateralUsd: account.totalCollateralUsd,
    liquidationThresholdPct: account.liquidationThresholdPct
  }) : null;

  const rows = [
    ['loan.healthFactorNow', before == null ? t('loan.healthNone') : before.toFixed(2), bandBefore?.color],
    after != null
      ? ['loan.healthFactorAfter', after.toFixed(2), bandAfter?.color]
      : null,
    ['loan.liquidationThreshold', threshold != null ? `${Number(threshold).toFixed(1)}%` : '—', null],
    ['loan.currentLtv', risk?.ltvPct != null ? `${risk.ltvPct.toFixed(1)}%` : '—', null],
    ['loan.maxLtv', account?.ltvPct != null ? `${Number(account.ltvPct).toFixed(1)}%` : '—', null],
    ['loan.liqDistance', risk?.liquidationDistancePct != null ? `${risk.liquidationDistancePct.toFixed(1)}%` : '—', null]
  ].filter(Boolean);

  return (
    <div
      data-testid="loan-risk-meter"
      data-band={bandAfter?.level ?? bandBefore?.level ?? 'none'}
      style={{
        borderRadius: 12, padding: '10px 12px', marginBottom: 12,
        background: `${bandAfter?.color ?? bandBefore?.color ?? '#60a5fa'}0f`,
        border: `1px solid ${bandAfter?.color ?? bandBefore?.color ?? '#60a5fa'}33`,
      }}
    >
      <div className="row-between" style={{ gap: 8, marginBottom: 7 }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-2)' }}>
          {t('loan.riskTitle2')}
        </span>
        <span data-testid="loan-risk-level" style={{ fontSize: 10.5, fontWeight: 800, color: bandAfter?.color ?? bandBefore?.color }}>
          {t(`loan.riskLevel.${bandAfter?.level ?? bandBefore?.level ?? 'none'}`)}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 10px' }}>
        {rows.map(([key, value, color]) => (
          <div key={key} className="row-between" style={{ gap: 6 }}>
            <span className="faint" style={{ fontSize: 10 }}>{t(key)}</span>
            <span style={{ fontSize: 10.5, fontWeight: 800, fontFamily: 'var(--font-mono)', color: color || 'var(--text-1)' }}>{value}</span>
          </div>
        ))}
      </div>
      {after != null && before != null && (
        <p data-testid="loan-risk-delta" style={{ fontSize: 10.5, lineHeight: 1.6, color: 'var(--text-2)', margin: '7px 0 0' }}>
          {t('loan.riskDelta', { before: before.toFixed(2), after: after.toFixed(2), liq: '1.00' })}
        </p>
      )}
      {projection && !projection.ok && (
        <p data-testid="loan-risk-unavailable" style={{ fontSize: 10.5, lineHeight: 1.6, color: '#fbbf24', margin: '7px 0 0' }}>
          {t('loan.riskUnavailable', { reason: loanErrorText(t, projection.reason) })}
        </p>
      )}
      {/* §41 — never a guarantee. */}
      <p className="faint" style={{ fontSize: 9.5, lineHeight: 1.6, margin: '7px 0 0' }}>
        {t('loan.riskNoGuarantee')}
      </p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   §9/§28 — WHY AN ACTION IS BLOCKED, AND WHAT WE COULD NOT CHECK
   `blocked` disables the button; `warnings` state the risk and let the user
   decide. A check whose inputs were unreadable is a WARNING that names the
   gap — never a silent pass, never a fabricated block.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 2026-09-22: when no wallet is connected, "could not read YOUR ..." warnings
 * are noise — there is no "your" to read yet, and the Connect button below is
 * already the call to action. Showing «موجودی خوانده نشد» to a user who never
 * connected reads as a broken page rather than an unconnected one, so those
 * wallet-dependent warnings are held back until a wallet exists. Protocol-wide
 * warnings (paused markets, stale oracles) still render: they are true with or
 * without a wallet.
 */
const WALLET_DEPENDENT_WARNINGS = new Set([
  'BALANCE_UNKNOWN', 'BORROW_CAPACITY_UNVERIFIED', 'RISK_DATA_UNAVAILABLE',
  'RISK_PROJECTION_UNAVAILABLE', 'ACCOUNT_UNAVAILABLE', 'LIQUIDITY_UNKNOWN'
]);
function visibleWarnings(decision, walletState) {
  const list = decision?.warnings || [];
  if (walletState !== 'disconnected') return list;
  return list.filter((item) => !WALLET_DEPENDENT_WARNINGS.has(item?.code));
}

function ReasonList({ items, tone, t, testId, lang }) {
  if (!items?.length) return null;
  const color = tone === 'danger' ? '#f87171' : '#fbbf24';
  /* `item.detail` is a DIAGNOSTIC written by the engine in English (§28):
     it stays available (tooltip + data attribute) but is only rendered into
     the sentence when the UI itself is English. Appending it verbatim used to
     leave every other language reading two languages in one breath — e.g.
     «توان وام‌گیری تأیید نشده… — no protocol price for this asset». */
  const showDetailInline = /^en\b/i.test(String(lang || ''));
  return (
    <div
      data-testid={testId}
      style={{
        borderRadius: 11, padding: '9px 11px', marginBottom: 10,
        background: `${color}12`, border: `1px solid ${color}33`,
        display: 'flex', flexDirection: 'column', gap: 5,
      }}
    >
      {items.map((item, index) => (
        <p
          key={`${item.code}-${index}`}
          data-code={item.code}
          data-detail={item.detail || undefined}
          title={!showDetailInline && item.detail ? item.detail : undefined}
          style={{ fontSize: 11, lineHeight: 1.6, color, margin: 0 }}
        >
          <span style={{ fontWeight: 800 }}>{tone === 'danger' ? '✕ ' : '⚠ '}</span>
          {/* A code renders as a SENTENCE, never as itself: the old
              `defaultValue: item.code` is what printed «BORROWING_DISABLED»
              under a Persian heading («سه‌جا با استرینگ هست به جای زبان درست»). */}
          {loanErrorText(t, item.code)}
          {showDetailInline && item.detail ? <span style={{ color: 'var(--text-2)' }}> — {item.detail}</span> : null}
        </p>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   §21 — ORACLE
   ═══════════════════════════════════════════════════════════════════════════ */

function OracleNote({ oracle, oracleStatus, t }) {
  if (oracleStatus === 'ok') return null;
  const tone = oracleStatus === 'unavailable' ? '#f87171' : '#fbbf24';
  return (
    <p
      data-testid="loan-oracle-note"
      data-status={oracleStatus}
      style={{
        fontSize: 10.5, lineHeight: 1.65, color: tone, margin: '0 0 10px',
        padding: '8px 11px', borderRadius: 11,
        background: `${tone}10`, border: `1px solid ${tone}30`,
      }}
    >
      {t(`loan.oracle.${oracleStatus}`, { defaultValue: t('loan.oracle.unavailable') })}
      {oracle?.oracleAddress ? (
        <span className="faint" style={{ display: 'block', fontSize: 9.5, fontFamily: 'var(--font-mono)', marginTop: 3 }}>
          {t('loan.oracleSource')}: {oracle.oracleAddress.slice(0, 10)}…
        </span>
      ) : null}
    </p>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   §37 — LIVE DATA UNAVAILABLE
   Not a spinner, not a zero, not a cached number presented as fresh.
   ═══════════════════════════════════════════════════════════════════════════ */

function UnavailableBanner({ failures, onRetry, t }) {
  return (
    <div
      data-testid="loan-unavailable"
      style={{
        borderRadius: 14, padding: '12px 14px', marginBottom: 12,
        background: 'rgba(248,113,113,0.09)', border: '1px solid rgba(248,113,113,0.30)',
      }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 3, color: '#fca5a5' }}>
        {t('loan.unavailableTitle')}
      </div>
      <p style={{ fontSize: 11.5, lineHeight: 1.7, color: 'var(--text-2)', margin: '0 0 9px' }}>
        {t('loan.unavailableBody')}
      </p>
      {/* §28 — the technical reason stays available for diagnostics. */}
      {failures?.length > 0 && (
        <p className="faint" style={{ fontSize: 9.5, lineHeight: 1.6, margin: '0 0 9px', fontFamily: 'var(--font-mono)', wordBreak: 'break-word' }}>
          {failures.slice(0, 3).map((f) => `${f.step}: ${String(f.reason).slice(0, 80)}`).join(' · ')}
        </p>
      )}
      <button type="button" className="btn btn-ghost btn-sm" data-testid="loan-unavailable-retry" onClick={onRetry} style={{ width: '100%' }}>
        {t('loan.retry')}
      </button>
    </div>
  );
}

/**
 * A market the PROTOCOL has closed.
 *
 * Aave's 2026 wind-down (Sonic, Scroll, zkSync, Metis, Soneium, Aptos — ARFC
 * 2026-07-30) freezes every reserve of a market, cuts the caps to 1 and lifts
 * the reserve factor to 99%. Read from the reserve bitmap, that is a wall of
 * reserves whose status is `frozen`, and the page used to answer it with
 * greyed-out cards and a one-word label — which is how «در شبکه سونیک اصلا
 * فریز و قابل وام نیست توکن‌ها» was reported.
 *
 * The facts, stated once and in the user's language: the protocol closed this
 * market to NEW supply and NEW borrow, repay and withdraw still work, open
 * positions stay open, and another market is one tap away on the rail above.
 * Nothing here invents a state: it is rendered only when every listed reserve
 * really is frozen/paused, and it never bypasses the engine's own gating.
 */
function MarketHaltedNotice({ kind, t }) {
  const tone = kind === 'paused' ? '#f87171' : '#fbbf24';
  const title = kind === 'paused' ? t('loan.marketHalted.paused')
    : kind === 'mixed' ? t('loan.marketHalted.mixed')
      : t('loan.marketHalted.frozen');
  return (
    <div
      data-testid="loan-market-halted"
      data-kind={kind}
      style={{
        borderRadius: 14, padding: '12px 14px', marginBottom: 12,
        background: `${tone}10`, border: `1px solid ${tone}33`,
      }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 800, color: tone, marginBottom: 3 }}>
        {t('loan.marketHalted.title')} · {title}
      </div>
      <p style={{ fontSize: 11.5, lineHeight: 1.75, color: 'var(--text-2)', margin: '0 0 6px' }}>
        {t('loan.marketHalted.body')}
      </p>
      <p style={{ fontSize: 11.5, lineHeight: 1.75, color: 'var(--text-2)', margin: 0 }}>
        {t('loan.marketHalted.repayHint')}
      </p>
      <p style={{ fontSize: 11, lineHeight: 1.7, color: 'var(--text-3)', margin: '6px 0 0' }}>
        {t('loan.marketHalted.otherMarkets')}
      </p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   ASSET CARD
   ═══════════════════════════════════════════════════════════════════════════ */

function AssetCard({ asset, selected, onClick, reserve, loading, side, t, price = null }) {
  const isSelected = selected?.id === asset.id;
  /* Only the pool's own answer can take an asset away. A read that failed
     leaves `listed` null — unknown rates, but the asset stays usable. */
  const unavailable = reserve?.listed === false;
  const rateUnknown = reserve != null && reserve.listed == null;
  /* §29 — frozen and paused are NOT the same thing to a user who already has
     a position, and treating them alike was a dead end (2026‑09‑23 report:
     «در شبکه سونیک اصلا فریز و قابل وام نیست توکن‌ها»).
     Aave's FROZEN reserve closes NEW supply and NEW borrow, while repay and
     withdraw stay open — that is exactly how the 2026 wind-down of Sonic and
     the other chains asks positions to unwind. Disabling the card made the
     market unreachable, so a frozen reserve could not even be selected to
     repay against.
     Aave's PAUSED reserve stops every action, so there the card IS inert. */
  const frozen = reserve?.status === 'frozen';
  const paused = reserve?.status === 'paused';
  const halted = frozen || paused;
  const blocked = unavailable || paused;
  return (
    <motion.button
      type="button"
      variants={riseIn}
      onClick={onClick}
      disabled={blocked}
      data-testid={`loan-asset-${asset.symbol.toLowerCase()}`}
      data-halted={halted ? 'true' : 'false'}
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
        cursor: blocked ? 'not-allowed' : 'pointer',
        opacity: blocked ? 0.5 : 1,
        transition: 'border 0.16s, background 0.16s, box-shadow 0.16s',
        display: 'flex', alignItems: 'center', gap: 12,
        boxShadow: isSelected ? `0 8px 24px ${asset.color}1f` : 'none',
      }}
    >
      <AssetAvatar asset={asset} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, lineHeight: 1.3 }}>
          {asset.symbol}
          {frozen && (
            <span
              data-testid="loan-asset-frozen-badge"
              style={{
                marginInlineStart: 6, verticalAlign: 'middle',
                fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 99,
                background: 'rgba(251,191,36,0.16)', color: '#fbbf24',
                border: '1px solid rgba(251,191,36,0.32)',
              }}
            >
              {t('loan.reserveStatus.frozen')}
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>
          {unavailable ? t('loan.reserveUnavailable')
            : frozen ? t('loan.reserveFrozenHint')
              : paused ? t(`loan.reserveStatus.${reserve.status}`)
              : rateUnknown ? t('loan.rateUnknown')
                /* §21 — the price shown next to a market is the PROTOCOL's
                   oracle price, and it is labelled unavailable rather than
                   backfilled from an exchange ticker. */
                : price != null ? t('loan.oraclePrice', { price: `$${Number(price).toLocaleString(undefined, { maximumFractionDigits: price < 1 ? 6 : 2 })}` })
                  : asset.name}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <AprBadge reserve={reserve} side={side} loading={loading} />
          <span className="faint" style={{ fontSize: 9 }}>APY</span>
        </div>
        {side === 'supply'
          ? <ReserveStatePill reserve={reserve} t={t} />
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

/** The selected market's depth + risk parameters, under its card. */
function SelectedMarketDetail({ asset, reserve, t }) {
  if (!asset) return null;
  return <MarketDepth reserve={reserve} asset={asset} t={t} />;
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
            <AssetIcon symbol={asset.symbol} size={18} radius={6} alt={asset.symbol} />
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

function ExecutionSheet({ exec, asset, machine, onConfirm, onCancel, onDone, onRetry, t, lang }) {
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

            {/* §15/§16 — the transaction state machine, visible: current state + the
                five-step checklist (Preparing → Wallet signed → Submitted →
                Confirming → Position update). */}
            {machine && phase !== 'review' && (
              <div
                data-testid="loan-exec-machine"
                data-state={machine.state}
                style={{
                  background: 'rgba(96,165,250,0.07)', border: '1px solid rgba(96,165,250,0.22)',
                  borderRadius: 12, padding: '9px 12px', marginBottom: 12,
                }}
              >
                <div className="row-between" style={{ gap: 8 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.06em', color: '#93c5fd', textTransform: 'uppercase' }}>
                    {t(`loan.machine.${machine.state}`, { defaultValue: machine.state })}
                  </span>
                  {exec?.requestId && (
                    <span data-testid="loan-exec-request" style={{ fontSize: 9.5, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                      {exec.requestId.slice(0, 18)}…
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 5, marginTop: 7, flexWrap: 'wrap' }}>
                  {(machine.progress || []).map((step) => (
                    <span
                      key={step.id}
                      data-testid={`loan-progress-${step.id}`}
                      data-status={step.status}
                      style={{
                        fontSize: 9.5, fontWeight: 700, padding: '2.5px 8px', borderRadius: 99,
                        background: step.status === 'done' ? 'rgba(74,222,128,0.14)'
                          : step.status === 'active' ? 'rgba(96,165,250,0.18)' : 'rgba(255,255,255,0.05)',
                        color: step.status === 'done' ? '#4ade80'
                          : step.status === 'active' ? '#93c5fd' : 'var(--text-3)',
                      }}
                    >
                      {step.status === 'done' ? '✓ ' : step.status === 'active' ? '● ' : '○ '}
                      {t(`loan.progress.${step.id}`, { defaultValue: step.label })}
                    </span>
                  ))}
                </div>
              </div>
            )}

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

            {/* §13/§14 — the risk this specific action creates, with the real
                numbers: current health factor, the health factor after, the
                liquidation threshold and the distance to it. */}
            {exec?.risk?.ok && (exec.risk.healthFactorAfter != null || exec.risk.healthFactorBefore != null) && (
              <RiskMeter projection={exec.risk} account={exec.account ?? null} t={t} />
            )}
            {exec?.risk && !exec.risk.ok && (
              <p data-testid="loan-exec-risk-unavailable" style={{
                fontSize: 11, lineHeight: 1.65, color: '#fbbf24', margin: '0 0 12px',
                padding: '9px 11px', borderRadius: 11,
                background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)',
              }}>
                {t('loan.riskUnavailable', { reason: loanErrorText(t, exec.risk.reason) })}
              </p>
            )}

            {/* §23 — the NETWORK fee, from the current provider. Not an "FBT
                fee": FBT charges nothing on a lending action (§24). */}
            <div
              data-testid="loan-exec-fee"
              data-status={exec?.fee?.ok ? 'live' : 'unavailable'}
              style={{
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 13, padding: '10px 12px', marginBottom: 10,
              }}
            >
              <div className="row-between" style={{ gap: 8 }}>
                <span style={{ fontSize: 11.5, color: 'var(--text-2)' }}>{t('loan.networkFee')}</span>
                <span style={{ fontSize: 11.5, fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
                  {exec?.fee?.ok
                    ? (exec.fee.maxFeeNativeFormatted ?? t('loan.feeCalculating'))
                    : t('loan.feeUnavailable')}
                </span>
              </div>
              {exec?.fee?.ok && exec.fee.maxFeeUsd != null && (
                <div className="row-between" style={{ gap: 8, marginTop: 3 }}>
                  <span className="faint" style={{ fontSize: 10 }}>{t('loan.networkFeeUsd')}</span>
                  <span className="faint" style={{ fontSize: 10, fontFamily: 'var(--font-mono)' }}>
                    ≈ {fmtUsd(exec.fee.maxFeeUsd)} {t('loan.feeUsdIsEstimate')}
                  </span>
                </div>
              )}
              <div className="row-between" style={{ gap: 8, marginTop: 3 }}>
                <span className="faint" style={{ fontSize: 10 }}>{t('loan.fbtFeeLine')}</span>
                <span data-testid="loan-fbt-fee" className="faint" style={{ fontSize: 10, fontWeight: 700, color: '#4ade80' }}>
                  {t('loan.fbtFeeNone')}
                </span>
              </div>
            </div>

            {/* §22 — the simulation verdict. A clean eth_call is reported as
                what it is (would not revert at this block); a revert blocks;
                and "we could not simulate" is reported as NOT proven, never as
                a pass. */}
            {exec?.simulation && (
              <div
                data-testid="loan-exec-simulation"
                data-status={exec.simulation.status}
                style={{
                  borderRadius: 13, padding: '10px 12px', marginBottom: 10,
                  background: exec.simulation.status === 'revert-detected' ? 'rgba(248,113,113,0.09)'
                    : exec.simulation.status === 'simulated-clean' ? 'rgba(74,222,128,0.08)'
                      : 'rgba(251,191,36,0.08)',
                  border: `1px solid ${exec.simulation.status === 'revert-detected' ? 'rgba(248,113,113,0.28)'
                    : exec.simulation.status === 'simulated-clean' ? 'rgba(74,222,128,0.26)'
                      : 'rgba(251,191,36,0.26)'}`,
                }}
              >
                <div className="row-between" style={{ gap: 8 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 800 }}>
                    {t(`loan.simulation.${exec.simulation.status}`, { defaultValue: exec.simulation.status })}
                  </span>
                  {exec.simulation.totalGasLimit && (
                    <span className="faint" style={{ fontSize: 10, fontFamily: 'var(--font-mono)' }}>
                      {t('loan.simGas', { gas: Number(exec.simulation.totalGasLimit).toLocaleString() })}
                    </span>
                  )}
                </div>
                {exec.simulation.revertReason && (
                  <p style={{ fontSize: 10.5, lineHeight: 1.6, color: '#f8a8a8', margin: '5px 0 0', wordBreak: 'break-word' }}>
                    {t('loan.simRevertReason')}: {String(exec.simulation.revertReason).slice(0, 140)}
                  </p>
                )}
                {exec.simulation.status === 'simulated-clean' && (
                  <p className="faint" style={{ fontSize: 9.5, lineHeight: 1.6, margin: '5px 0 0' }}>
                    {t('loan.simNotAGuarantee')}
                  </p>
                )}
                {exec.simulation.status === 'provider-busy' && (
                  <p style={{ fontSize: 10, lineHeight: 1.6, color: '#fbbf24', margin: '5px 0 0' }}>
                    {t('loan.simBusy')}
                  </p>
                )}
              </div>
            )}

            {/* §9 — checks we could not run are named, not silently skipped. */}
            <ReasonList items={exec?.warnings} tone="warn" t={t} lang={lang} testId="loan-exec-warnings" />

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
                data-code={exec?.code || 'UNKNOWN'}
                style={{
                  background: 'rgba(248,113,113,0.09)', border: '1px solid rgba(248,113,113,0.28)',
                  borderRadius: 12, padding: '10px 13px', marginBottom: 14,
                  fontSize: 12, lineHeight: 1.7, color: '#f8a8a8',
                }}
              >
                {loanErrorText(t, exec?.code || 'UNKNOWN')}
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
                /* §22 — a simulation that reverted is a hard stop. The button
                   is disabled and the reason is on screen above; the user is
                   never asked to sign a transaction we already watched fail. */
                disabled={exec?.simulation?.status === 'revert-detected'}
                style={{
                  marginBottom: 10, width: '100%',
                  background: asset ? `linear-gradient(135deg, ${asset.color}, ${asset.color}bb)` : undefined,
                  boxShadow: asset ? `0 10px 26px ${asset.color}44` : undefined,
                  opacity: exec?.simulation?.status === 'revert-detected' ? 0.5 : 1,
                  cursor: exec?.simulation?.status === 'revert-detected' ? 'not-allowed' : 'pointer',
                }}
                whileTap={{ scale: 0.97 }}
                onClick={onConfirm}
              >
                <IconCheck width={14} height={14} style={{ marginInlineEnd: 7 }} />
                {exec?.simulation?.status === 'revert-detected' ? t('loan.confirmBlocked') : t('common.confirm')}
              </motion.button>
            )}

            {phase === 'running' && (
              <button className="btn btn-primary" style={{ marginBottom: 10, width: '100%', opacity: 0.7 }} disabled>
                {/* §17: while the transaction confirms, the button says so —
                    and the in-flight guard behind it refuses a double-tap. */}
                {machine?.state === 'PENDING' ? t('loan.pendingBtn') : t('loan.running')}
              </button>
            )}

            {/* §15: ERROR → RETRY → VALIDATING. Same action, re-validated. */}
            {phase === 'failed' && onRetry && (
              <button
                className="btn btn-primary"
                data-testid="loan-exec-retry"
                style={{ marginBottom: 10, width: '100%' }}
                onClick={onRetry}
              >
                {t('loan.retry')}
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
   §27/§28 — READ-ONLY BANNER
   The server's circuit breaker opened. Markets stay visible; new transactions
   are refused. Better than crashing the page.
   ═══════════════════════════════════════════════════════════════════════════ */

function ReadOnlyBanner({ t }) {
  return (
    <motion.div
      variants={riseIn} initial="hidden" animate="show"
      data-testid="loan-readonly"
      style={{
        borderRadius: 14, padding: '12px 14px', marginBottom: 12,
        background: 'rgba(251,191,36,0.09)', border: '1px solid rgba(251,191,36,0.35)',
        display: 'flex', gap: 10, alignItems: 'flex-start',
      }}
    >
      <span style={{ fontSize: 16, flexShrink: 0 }}>⚠️</span>
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 2 }}>{t('loan.readOnlyTitle')}</div>
        <p style={{ fontSize: 11.5, lineHeight: 1.7, color: 'var(--text-2)', margin: 0 }}>{t('loan.readOnlyBody')}</p>
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   §22/§23 — ALERTS PANEL
   Rendered from the pure alert-rules engine (lending-engine/alerts.js) — the
   component only displays; the engine decides. No white border anywhere.
   ═══════════════════════════════════════════════════════════════════════════ */

const ALERT_DOT = { critical: '#f87171', warning: '#fbbf24', info: '#60a5fa' };
const ALERT_ICON = { critical: '🔴', warning: '⚠️', info: '🟢' };

function AlertsPanel({ alerts, open, onClose, onManage, t }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2 }}
          style={{ overflow: 'hidden' }}
        >
          <div
            data-testid="loan-alerts-panel"
            style={{
              borderRadius: 16, padding: '14px', marginBottom: 12,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.09)',
              display: 'flex', flexDirection: 'column', gap: 8,
            }}
          >
            <div className="row-between">
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', color: 'var(--text-2)', textTransform: 'uppercase' }}>
                {t('loan.alerts.title')}
              </span>
              <button type="button" className="icon-btn" onClick={onClose} aria-label={t('common.close', { defaultValue: 'Close' })}>
                ✕
              </button>
            </div>

            {(!alerts || alerts.length === 0) && (
              <p className="faint" data-testid="loan-alerts-empty" style={{ fontSize: 12, margin: 0, lineHeight: 1.7 }}>
                {t('loan.alerts.empty')}
              </p>
            )}

            {(alerts || []).map((alert) => (
              <div
                key={`${alert.type}-${alert.asset || 'account'}`}
                data-testid={`loan-alert-${alert.type.toLowerCase()}`}
                data-severity={alert.severity}
                style={{
                  borderRadius: 12, padding: '10px 12px',
                  background: `${ALERT_DOT[alert.severity] ?? '#60a5fa'}14`,
                  border: `1px solid ${ALERT_DOT[alert.severity] ?? '#60a5fa'}33`,
                  display: 'flex', gap: 9, alignItems: 'flex-start',
                }}
              >
                <span style={{ fontSize: 13, flexShrink: 0 }}>{ALERT_ICON[alert.severity] ?? '🟢'}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 800 }}>
                    {t(`loan.alertType.${alert.type}`, { defaultValue: alert.title })}
                  </div>
                  <div style={{ fontSize: 11, lineHeight: 1.65, color: 'var(--text-2)', marginTop: 1 }}>
                    {alert.value && typeof alert.value === 'object' && 'from' in alert.value && 'to' in alert.value
                      ? t('loan.alertChange', { from: alert.value.from, to: alert.value.to })
                      : alert.body}
                  </div>
                </div>
              </div>
            ))}

            {(alerts || []).some((a) => a.severity === 'critical') && (
              <button
                type="button"
                data-testid="loan-alert-manage"
                className="btn btn-primary"
                onClick={onManage}
                style={{ width: '100%', marginTop: 2 }}
              >
                {t('loan.alerts.managePosition')}
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   CHAIN RAIL — the markets this screen can actually execute on
   ═══════════════════════════════════════════════════════════════════════════ */

function ChainRail({ chain, onPick, t }) {
  /*
   * §5: the rail renders the NETWORK CONFIG's feature-flagged list — never a
   * hardcoded array. A chain whose flag is off (or whose pool is not wired)
   * simply does not appear, and the rest of Lending keeps working.
   *
   * Registered-but-unwired networks are shown as an inert "coming soon" chip
   * rather than being hidden: §5 asks for exactly that, and a network the app
   * knows about but cannot execute on must never be rendered as a market with
   * liquidity in it. They are not clickable and carry no numbers.
   */
  const networks = enabledNetworks().filter((n) => lendingSupported(n.chainId));
  const pending = LENDING_NETWORKS.filter((n) => !n.enabled || !lendingSupported(n.chainId));
  return (
    <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 10 }}>
      <span className="faint" style={{ fontSize: 10, alignSelf: 'center', flexShrink: 0, marginInlineEnd: 2 }}>
        {t('loan.market')}
      </span>
      {networks.map((network) => {
        const id = network.chainId;
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
      {pending.map((network) => (
        <span
          key={`pending-${network.chainId}`}
          data-testid={`loan-chain-soon-${network.chainId}`}
          data-enabled={isNetworkEnabled(network.chainId) ? 'true' : 'false'}
          title={network.disabledReason ? t('loan.comingSoonReason', { reason: network.disabledReason }) : t('loan.comingSoon')}
          style={{
            flexShrink: 0, padding: '6px 11px', borderRadius: 999,
            fontSize: 11, fontWeight: 700, cursor: 'not-allowed', opacity: 0.45,
            background: 'rgba(255,255,255,0.03)',
            border: '1px dashed rgba(255,255,255,0.14)',
            color: 'var(--text-3)',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: 99, background: network.color || '#888' }} />
          {network.name}
          <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase' }}>
            {t('loan.comingSoonShort')}
          </span>
        </span>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   ACCOUNT SUMMARY — the pool's own view of this wallet
   ═══════════════════════════════════════════════════════════════════════════ */

function AccountSummary({ account, t }) {
  if (!account?.ok) return null;
  /* §12/§13 — the engine's bands, the same table the alert rules and the
     server BFF use. The page used to have its own second ladder here, so one
     position could read "watch" in this card and raise a "critical" alert. */
  const band = riskLevel(account.healthFactor);
  const tone = band.color;
  const risk = assessPosition({
    healthFactor: account.healthFactor,
    totalDebtUsd: account.totalDebtUsd,
    totalCollateralUsd: account.totalCollateralUsd,
    liquidationThresholdPct: account.liquidationThresholdPct
  });
  const cells = [
    [t('loan.collateral'), fmtUsd(account.totalCollateralUsd)],
    [t('loan.debt'), fmtUsd(account.totalDebtUsd)],
    [t('loan.borrowPower'), fmtUsd(account.availableBorrowsUsd)]
  ];
  /* §13 — the four risk numbers the spec asks for, all from the pool. */
  const riskCells = [
    [t('loan.currentLtv'), risk.ltvPct != null ? `${risk.ltvPct.toFixed(1)}%` : '—'],
    [t('loan.maxLtv'), account.ltvPct != null ? `${Number(account.ltvPct).toFixed(1)}%` : '—'],
    [t('loan.liquidationThreshold'), account.liquidationThresholdPct != null ? `${Number(account.liquidationThresholdPct).toFixed(1)}%` : '—'],
    [t('loan.liqDistance'), risk.liquidationDistancePct != null ? `${risk.liquidationDistancePct.toFixed(1)}%` : '—']
  ];
  return (
    <div
      data-testid="loan-account-summary"
      data-risk={band.level}
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
          {account.healthFactor == null ? t('loan.healthNone') : `${account.healthFactor.toFixed(2)} · ${t(`loan.riskLevel.${band.level}`)}`}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 10px', marginTop: 9, paddingTop: 9, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        {riskCells.map(([label, value]) => (
          <div key={label} className="row-between" style={{ gap: 6 }}>
            <span className="faint" style={{ fontSize: 9.5 }}>{label}</span>
            <span data-testid={`loan-risk-${label === riskCells[0][0] ? 'ltv' : label === riskCells[1][0] ? 'maxltv' : label === riskCells[2][0] ? 'threshold' : 'distance'}`}
              style={{ fontSize: 10.5, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{value}</span>
          </div>
        ))}
      </div>
      {/* §41 — the liquidation point is stated, and nothing here is promised. */}
      <p className="faint" style={{ fontSize: 9.5, lineHeight: 1.6, margin: '8px 0 0' }}>
        {t('loan.riskNoGuarantee')}
      </p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SUPPLY TAB
   ═══════════════════════════════════════════════════════════════════════════ */

function SupplyTab({ market, t, haptic, notify, onExecute, preset }) {
  const { assets, reserves, positions, loading, chain, walletState, prices, oracle, oracleStatus, dataStatus, lang } = market;
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
  const reserve = selected ? reserves[selected.id] : null;
  /* §18 — the amount is converted with the decimals the protocol/contract
     reported, not the registry's assumption, whenever it could be read. */
  const decimals = Number(reserve?.decimals ?? selected?.decimals ?? 18);
  const walletWei = position?.walletWei ?? null;
  const walletMax = walletWei != null && BigInt(walletWei) > 0n ? fromUnits(walletWei, decimals) : null;

  const amountWei = selected ? toUnits(amount, decimals) : null;
  const overWallet = Boolean(walletWei != null && amountWei != null && amountWei > BigInt(walletWei));

  /* §9 — the full pre-flight, recomputed on every keystroke. It reads the
     supply cap, the wallet balance, the reserve's paused/frozen state and the
     contract allowlist; `blocked` disables the button and says why. */
  const decision = useMemo(() => evaluateAction({
    market, action: 'supply', asset: selected, amount, amountWei: amountWei?.toString() ?? null,
    walletBalanceWei: walletWei
  }), [market, selected, amount, amountWei?.toString(), walletWei]);

  const invalid = !selected || !amount || !(amountWei != null && amountWei > 0n) || overWallet || !decision.ok;

  const run = () => {
    if (!selected) { notify('loan.chooseAssetFirst', 'error'); return; }
    if (!amount || !(amountWei != null && amountWei > 0n)) { notify('loan.enterAmount', 'error'); return; }
    if (overWallet) { notify('loan.amountOverWallet', 'error'); return; }
    if (!decision.ok) { notify(`loan.error.${decision.blocked[0].code}`, 'error'); return; }
    haptic?.('medium');
    onExecute({ action: 'supply', asset: selected, amount });
  };

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

      <motion.p variants={riseIn} className="prose-sm" style={{ lineHeight: 1.8, padding: '0 2px' }}>
        {t('loan.supplyDesc')}
      </motion.p>

      <OracleNote oracle={oracle} oracleStatus={oracleStatus} t={t} />

      <motion.div variants={riseIn}>
        <div className="row-between" style={{ marginBottom: 8, gap: 8 }}>
          <p className="section-label" style={{ margin: 0 }}>{t('loan.chooseAsset')}</p>
          <DataStatusPill status={dataStatus} ageMs={market.ageMs} t={t} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {assets.map(a => (
            <AssetCard
              key={a.id}
              asset={a} selected={selected} side="supply"
              reserve={reserves[a.id]} loading={loading} t={t}
              price={prices?.[a.id]?.usd ?? null}
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
              {/* §20 — what the pool actually holds, and its caps. */}
              <SelectedMarketDetail asset={selected} reserve={reserve} t={t} />

              <div style={{ height: 12 }} />

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
                    : t('loan.rateUnknown')}
              />
              {overWallet && (
                <p style={{ fontSize: 11.5, color: '#f87171', margin: '0 0 10px' }}>{t('loan.amountOverWallet')}</p>
              )}
              <ReasonList items={decision.blocked} tone="danger" t={t} lang={lang} testId="loan-supply-blocked" />
              <ReasonList items={decision.warnings} tone="warn" t={t} lang={lang} testId="loan-supply-warnings" />
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
  const { assets, reserves, positions, loading, chain, account, walletState, prices, oracle, oracleStatus, dataStatus, lang } = market;
  const [selected, setSelected] = useState(null);
  /* §11 — "select collateral ↓ select borrow asset" are TWO choices. The form
     used to have one asset picker and treated the borrow asset as its own
     collateral: choosing USDC and typing a collateral figure supplied USDC to
     borrow USDC, scaled by the borrow asset's decimals and maxed against the
     borrow asset's wallet balance. Posting WETH against a USDC borrow was
     impossible, and the number that came out was meaningless. */
  const [collateralId, setCollateralId] = useState(null);
  const [collateral, setCollateral] = useState('');
  const [amount, setAmount] = useState('');
  const [collateralOpen, setCollateralOpen] = useState(false);

  useEffect(() => {
    if (!preset?.symbol || !assets.length) return;
    const match = assets.find((a) => a.symbol.toUpperCase() === String(preset.symbol).toUpperCase());
    if (match) {
      setSelected(match);
      if (preset.amount) setAmount(String(preset.amount));
      const collMatch = preset.collateralAsset
        ? assets.find((a) => a.symbol.toUpperCase() === String(preset.collateralAsset).toUpperCase())
        : null;
      if (collMatch) setCollateralId(collMatch.id);
      if (preset.collateral) setCollateral(String(preset.collateral));
    }
  }, [preset?.symbol, preset?.amount, preset?.collateral, preset?.collateralAsset, assets]);

  const position = selected ? positions[selected.id] : null;
  const reserve = selected ? reserves[selected.id] : null;
  const collateralAsset = collateralId ? assets.find((a) => a.id === collateralId) ?? null : null;
  const collateralPosition = collateralAsset ? positions[collateralAsset.id] : null;
  const collateralReserve = collateralAsset ? reserves[collateralAsset.id] : null;

  const decimals = Number(reserve?.decimals ?? selected?.decimals ?? 18);
  const collateralDecimals = Number(collateralReserve?.decimals ?? collateralAsset?.decimals ?? 18);

  const amountWei = selected ? toUnits(amount, decimals) : null;
  const collateralWei = collateralAsset ? toUnits(collateral, collateralDecimals) : null;
  const collateralWalletWei = collateralPosition?.walletWei ?? null;
  const overCollateralWallet = Boolean(collateralWei != null && collateralWalletWei != null && collateralWei > BigInt(collateralWalletWei));

  /* Borrowing power the POOL reports — its own oracle-backed, LTV-aware,
     debt-aware number, not a frontend re-derivation. */
  const powerUsd = account?.ok ? account.availableBorrowsUsd : null;

  /* §12 — the maximum for THIS asset, in its own units, capped by the pool's
     available liquidity and the reserve's borrow cap. Null when the protocol
     price could not be read: an unpriced maximum is never guessed (§21). */
  const maxBorrow = useMemo(
    () => (selected ? getMaxBorrow({ market, asset: selected }) : null),
    [market, selected]
  );
  const maxAmount = maxBorrow?.ok ? maxBorrow.maxAmount : null;

  /* §13 — the health factor after this borrow, with every amount priced by the
     protocol's oracle and converted with integer arithmetic first. */
  const projected = useMemo(() => (selected && amountWei != null && amountWei > 0n
    ? projectActionRisk({
      market, action: 'borrow', amountWei: amountWei.toString(), asset: selected,
      collateralAmountWei: collateralWei != null && collateralWei > 0n ? collateralWei.toString() : null,
      collateralAsset: collateralAsset ?? selected
    })
    : null), [market, selected, amountWei?.toString(), collateralWei?.toString(), collateralAsset]);

  /* §9/§11/§20 — the whole pre-flight. Blocks on: paused/frozen reserve,
     borrowing disabled, amount above the pool's liquidity, above the borrow
     cap, above the user's capacity, a resulting health factor below the floor,
     no collateral at all, no gas. */
  const decision = useMemo(() => evaluateAction({
    market, action: 'borrow', asset: selected, amount,
    amountWei: amountWei?.toString() ?? null,
    collateralAmountWei: collateralWei?.toString() ?? null,
    collateralAsset: collateralAsset ?? selected,
    walletBalanceWei: collateralWei != null && collateralWei > 0n ? collateralWalletWei : null,
    minHealthFactor: MIN_HEALTH_FACTOR_AFTER_BORROW
  }), [market, selected, amount, amountWei?.toString(), collateralWei?.toString(), collateralAsset, collateralWalletWei]);

  const noCollateral = Boolean(account?.ok
    && (account.totalCollateralUsd || 0) <= 0
    && (collateralWei == null || collateralWei <= 0n));
  const invalid = !selected || !(amountWei != null && amountWei > 0n) || noCollateral
    || overCollateralWallet || !decision.ok;

  const run = () => {
    if (!selected) { notify('loan.chooseAssetFirst', 'error'); return; }
    if (!(amountWei != null && amountWei > 0n)) { notify('loan.enterAmount', 'error'); return; }
    if (noCollateral) { notify('loan.needCollateralFirst', 'error'); return; }
    if (!decision.ok) { notify(`loan.error.${decision.blocked[0].code}`, 'error'); return; }
    haptic?.('medium');
    onExecute({
      action: 'borrow', asset: selected, amount, collateral,
      collateralAsset, projected, maxBorrow
    });
  };

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

      <motion.p variants={riseIn} className="prose-sm" style={{ lineHeight: 1.8, padding: '0 2px' }}>
        {t('loan.borrowDesc')}
      </motion.p>

      <OracleNote oracle={oracle} oracleStatus={oracleStatus} t={t} />

      <motion.div variants={riseIn}>
        <div className="row-between" style={{ marginBottom: 8, gap: 8 }}>
          <p className="section-label" style={{ margin: 0 }}>{t('loan.chooseBorrowAsset')}</p>
          <DataStatusPill status={dataStatus} ageMs={market.ageMs} t={t} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {assets.map(a => (
            <AssetCard
              key={a.id}
              asset={a} selected={selected} side="borrow"
              reserve={reserves[a.id]} loading={loading} t={t}
              price={prices?.[a.id]?.usd ?? null}
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
              <SelectedMarketDetail asset={selected} reserve={reserve} t={t} />
              <div style={{ height: 12 }} />

              {/* §12 — borrowing power, stated like it matters.
                  Three honest states, each a full sentence — never the old
                  «وام‌گیری:— · …» fragment that glued an empty dash to half a
                  reason:
                    · wallet not connected → say what to do (connect), not what failed
                    · power read          → the number, big, then the same
                      capacity in the borrow asset with its binding constraint
                    · read failed         → the localized reason, one line */}
              <div
                data-testid="loan-borrow-power-box"
                style={{
                  borderRadius: 13, padding: '10px 12px', marginBottom: 12,
                  background: `linear-gradient(135deg, ${selected.color}10, rgba(255,255,255,0.035))`,
                  border: `1px solid ${selected.color}2e`,
                }}
              >
                <div className="row-between" style={{ gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
                    {t('loan.borrowPower')}
                  </span>
                  {account?.ok && <DataStatusPill status={dataStatus} ageMs={market.ageMs} t={t} />}
                </div>
                {walletState === 'disconnected' ? (
                  <p style={{ fontSize: 11.5, lineHeight: 1.7, color: 'var(--text-2)', margin: 0 }}>
                    {t('loan.powerConnect')}
                  </p>
                ) : account?.ok && powerUsd != null ? (
                  <>
                    <span
                      data-testid="loan-borrow-power"
                      dir="ltr"
                      style={{
                        display: 'inline-block', direction: 'ltr', unicodeBidi: 'isolate',
                        fontSize: 17, fontWeight: 900, fontFamily: 'var(--font-mono)',
                        color: selected.color, letterSpacing: '-.01em',
                      }}
                    >
                      {fmtUsd(powerUsd)}
                    </span>
                    {/* the same capacity in the asset being borrowed, with the
                        constraint that binds it named (§12) */}
                    {maxBorrow?.ok && (
                      <span data-testid="loan-max-borrow" style={{ display: 'block', marginTop: 4, fontSize: 11, color: 'var(--text-2)', lineHeight: 1.6 }}>
                        {t('loan.maxBorrowIs', {
                          amount: fmtPoolAmount(maxAmount) ?? maxAmount,
                          symbol: selected.symbol,
                          by: t(`loan.limitedBy.${maxBorrow.limitedBy}`)
                        })}
                      </span>
                    )}
                    {maxBorrow && !maxBorrow.ok && (
                      <span data-testid="loan-max-borrow-unavailable" style={{ display: 'block', marginTop: 4, fontSize: 11, lineHeight: 1.6, color: 'var(--text-3)' }}>
                        {t('loan.maxBorrowUnavailable', { reason: loanErrorText(t, maxBorrow.reason) })}
                      </span>
                    )}
                  </>
                ) : (
                  <p data-testid="loan-borrow-unavailable" style={{ fontSize: 11.5, lineHeight: 1.7, color: 'var(--text-2)', margin: 0 }}>
                    {t('loan.powerUnavailable')}
                    {maxBorrow?.reason ? ` ${loanErrorText(t, maxBorrow.reason)}`.trim() : ''}
                  </p>
                )}
              </div>

              {/* ── §11 step 1: the collateral asset, chosen separately ────── */}
              <div style={{ marginBottom: 12 }}>
                <div className="row-between" style={{ marginBottom: 6, gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>
                    {t('loan.collateralAssetLabel')}
                  </span>
                  <button
                    type="button"
                    data-testid="loan-collateral-picker"
                    onClick={() => setCollateralOpen((v) => !v)}
                    style={{
                      fontSize: 10.5, fontWeight: 700, color: 'var(--text-2)',
                      background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: 8, padding: '3px 8px', cursor: 'pointer',
                    }}
                  >
                    {collateralAsset ? collateralAsset.symbol : t('loan.useExistingCollateral')}
                  </button>
                </div>
                {collateralOpen && (
                  <div data-testid="loan-collateral-list" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <button
                      type="button"
                      data-testid="loan-collateral-none"
                      onClick={() => { haptic?.('select'); setCollateralId(null); setCollateral(''); setCollateralOpen(false); }}
                      style={{
                        textAlign: 'start', fontSize: 11.5, padding: '9px 11px', borderRadius: 11, cursor: 'pointer',
                        background: collateralId == null ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.04)',
                        border: `1px solid ${collateralId == null ? 'rgba(255,255,255,0.20)' : 'rgba(255,255,255,0.08)'}`,
                        color: 'var(--text-2)',
                      }}
                    >
                      {t('loan.useExistingCollateral')}
                      <span className="faint" style={{ display: 'block', fontSize: 10, marginTop: 2 }}>{t('loan.collateralHint')}</span>
                    </button>
                    {assets.filter((a) => a.id !== selected.id).map((a) => {
                      const on = collateralId === a.id;
                      const bal = positions[a.id]?.walletWei != null ? fromUnits(positions[a.id].walletWei, Number(reserves[a.id]?.decimals ?? a.decimals)) : null;
                      return (
                        <button
                          key={a.id}
                          type="button"
                          data-testid={`loan-collateral-${a.symbol.toLowerCase()}`}
                          onClick={() => { haptic?.('select'); setCollateralId(a.id); setCollateral(''); setCollateralOpen(false); }}
                          style={{
                            textAlign: 'start', fontSize: 11.5, padding: '9px 11px', borderRadius: 11, cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: 9,
                            background: on ? `${a.color}1c` : 'rgba(255,255,255,0.04)',
                            border: `1px solid ${on ? `${a.color}66` : 'rgba(255,255,255,0.08)'}`,
                            color: 'var(--text-1)',
                          }}
                        >
                          <AssetAvatar asset={a} size={24} />
                          <span style={{ fontWeight: 700 }}>{a.symbol}</span>
                          <span className="faint" style={{ marginInlineStart: 'auto', fontSize: 10, fontFamily: 'var(--font-mono)' }}>
                            {bal != null ? `${bal}` : '—'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {collateralAsset && (
                <AmountInput
                  testId="loan-amount-collateral"
                  label={t('loan.collateralToAdd', { symbol: collateralAsset.symbol })}
                  value={collateral} onChange={setCollateral}
                  asset={collateralAsset}
                  max={collateralWalletWei != null && BigInt(collateralWalletWei) > 0n ? fromUnits(collateralWalletWei, collateralDecimals) : null}
                  maxLabel={t('loan.maxOf', {
                    amount: collateralWalletWei != null ? fromUnits(collateralWalletWei, collateralDecimals) : '0',
                    symbol: collateralAsset.symbol
                  })}
                  hint={t('loan.collateralAssetHint', { symbol: collateralAsset.symbol, borrow: selected.symbol })}
                />
              )}
              {overCollateralWallet && (
                <p style={{ fontSize: 11.5, color: '#f87171', margin: '0 0 10px' }}>{t('loan.collateralOverWallet')}</p>
              )}

              <AmountInput
                testId="loan-amount-borrow"
                label={t('loan.borrowAmountLabel', { symbol: selected.symbol })}
                value={amount} onChange={setAmount}
                asset={selected}
                max={maxAmount} maxLabel={t('loan.maxBorrowBtn')}
                hint={projected?.ok && projected.healthFactorAfter != null
                  ? t('loan.projectedHealth', { hf: projected.healthFactorAfter.toFixed(2) })
                  : projected && !projected.ok
                    ? t('loan.projectedHealthUnavailable')
                    : undefined}
              />

              {noCollateral && (
                <p style={{ fontSize: 11.5, color: '#fbbf24', margin: '0 0 10px' }}>{t('loan.needCollateralFirst')}</p>
              )}

              {/* §13/§14 — the numbers behind the warning, before the signature. */}
              {account?.ok && (
                <RiskMeter projection={projected} account={account} t={t} />
              )}

              <ReasonList items={decision.blocked} tone="danger" t={t} lang={lang} testId="loan-borrow-blocked" />
              <ReasonList items={visibleWarnings(decision, walletState)} tone="warn" t={t} lang={lang} testId="loan-borrow-warnings" />

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

function PositionsTab({ market, t, haptic, notify, onExecute, onCollateral, history }) {
  const { assets, positions, account, loading, walletState, refresh, userConfiguration, reserves } = market;
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
        const reserve = reserves?.[asset.id];
        const decimals = Number(reserve?.decimals ?? asset.decimals ?? 18);
        /* §15 — collateral usage comes from the pool's per-user bitmap, not
           from "the aToken balance is non-zero". Those disagree whenever a
           user has supplied with the collateral flag switched off. */
        const usage = userConfiguration?.entries?.[asset.id];
        const isCollateral = usage?.usingAsCollateral ?? null;
        const priceUsd = market.prices?.[asset.id]?.usd ?? null;
        const suppliedUsd = (priceUsd != null && position.suppliedWei != null)
          ? Number(fromUnits(position.suppliedWei, decimals)) * priceUsd : null;
        const debtUsd = (priceUsd != null && position.debtWei != null)
          ? Number(fromUnits(position.debtWei, decimals)) * priceUsd : null;
        const draftWei = toUnits(value, decimals);

        /* §17 — what this withdrawal would do to the health factor, priced by
           the protocol oracle. Shown before the signature, and it gates the
           button when the result would be liquidatable. */
        const withdrawProjection = supplied && draftWei != null && draftWei > 0n
          ? projectActionRisk({ market, action: 'withdraw', amountWei: draftWei.toString(), asset })
          : null;
        const withdrawBlocked = withdrawProjection?.ok
          && withdrawProjection.healthFactorAfter != null
          && withdrawProjection.healthFactorAfter < MIN_HEALTH_FACTOR_AFTER_BORROW;

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
                    {suppliedUsd != null && <span className="faint"> · {fmtUsd(suppliedUsd)}</span>}
                  </div>
                )}
                {owes && (
                  <div style={{ fontSize: 11.5, color: '#f87171', fontFamily: 'var(--font-mono)' }}>
                    {t('loan.borrowed')}: {position.debt}
                    {debtUsd != null && <span className="faint"> · {fmtUsd(debtUsd)}</span>}
                  </div>
                )}
              </div>
            </div>

            {/* §15 — collateral switch, with the dependency check that stops a
                user turning off the collateral their debt is resting on. */}
            {supplied && isCollateral != null && (
              <div
                className="row-between"
                data-testid={`loan-collateral-state-${asset.symbol.toLowerCase()}`}
                data-on={isCollateral ? 'true' : 'false'}
                style={{
                  gap: 8, padding: '8px 10px', borderRadius: 11, marginBottom: 10,
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-2)' }}>{t('loan.useAsCollateral')}</span>
                  <span className="faint" style={{ display: 'block', fontSize: 9.5, lineHeight: 1.5 }}>
                    {isCollateral ? t('loan.collateralOnHint') : t('loan.collateralOffHint')}
                  </span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isCollateral}
                  data-testid={`loan-collateral-toggle-${asset.symbol.toLowerCase()}`}
                  onClick={() => {
                    haptic?.('select');
                    onCollateral({ asset, useAsCollateral: !isCollateral, position, suppliedUsd });
                  }}
                  style={{
                    flexShrink: 0, width: 42, height: 24, borderRadius: 99, cursor: 'pointer',
                    border: '1px solid rgba(255,255,255,0.14)', position: 'relative',
                    background: isCollateral ? 'rgba(74,222,128,0.35)' : 'rgba(255,255,255,0.10)',
                    transition: 'background 0.16s',
                  }}
                >
                  <span style={{
                    position: 'absolute', top: 2, insetInlineStart: isCollateral ? 20 : 2,
                    width: 18, height: 18, borderRadius: 99, background: '#fff',
                    transition: 'inset-inline-start 0.16s',
                  }} />
                </button>
              </div>
            )}
            {supplied && isCollateral == null && (
              <p className="faint" data-testid={`loan-collateral-unknown-${asset.symbol.toLowerCase()}`} style={{ fontSize: 10, margin: '0 0 8px', lineHeight: 1.6 }}>
                {t('loan.collateralStateUnknown')}
              </p>
            )}

            <AmountInput
              testId={`loan-amount-${asset.symbol.toLowerCase()}`}
              label={t('loan.manageAmount', { symbol: asset.symbol })}
              value={value}
              onChange={(next) => setDraft((prev) => ({ ...prev, [asset.id]: next }))}
              asset={asset}
              /* §16/§17 — MAX. It sends the protocol's own "all of it" sentinel
                 and settles exactly what is owed / supplied, including the
                 interest accrued since the last read. */
              max="max"
              maxLabel={owes ? t('loan.repayMaxBtn') : t('loan.withdrawMaxBtn')}
            />

            {withdrawProjection?.ok && withdrawProjection.healthFactorAfter != null && (
              <p
                data-testid={`loan-withdraw-risk-${asset.symbol.toLowerCase()}`}
                style={{
                  fontSize: 10.5, lineHeight: 1.6, margin: '0 0 8px',
                  color: withdrawBlocked ? '#f87171' : '#fbbf24',
                }}
              >
                {t('loan.withdrawHealthAfter', { hf: withdrawProjection.healthFactorAfter.toFixed(2) })}
                {withdrawBlocked ? ` — ${t('loan.error.HEALTH_FACTOR_TOO_LOW')}` : ''}
              </p>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              {supplied && (
                <button
                  type="button" className="btn btn-ghost btn-sm"
                  data-testid={`loan-withdraw-${asset.symbol.toLowerCase()}`}
                  style={{ flex: 1 }}
                  disabled={(!value && !isMaxAmount(value)) || (!isMaxAmount(value) && !(draftWei != null && draftWei > 0n)) || withdrawBlocked}
                  onClick={() => {
                    if (withdrawBlocked) { notify('loan.error.HEALTH_FACTOR_TOO_LOW', 'error'); return; }
                    haptic?.('medium');
                    onExecute({ action: 'withdraw', asset, amount: value, maxWei: position.suppliedWei });
                  }}
                >
                  {t('loan.withdraw')}
                </button>
              )}
              {owes && (
                <button
                  type="button" className="btn btn-ghost btn-sm"
                  data-testid={`loan-repay-${asset.symbol.toLowerCase()}`}
                  style={{ flex: 1 }}
                  disabled={(!value && !isMaxAmount(value)) || (!isMaxAmount(value) && !(draftWei != null && draftWei > 0n))}
                  onClick={() => {
                    haptic?.('medium');
                    onExecute({ action: 'repay', asset, amount: value, maxWei: position.debtWei });
                  }}
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

      {/* §27 — the ledger of what this wallet actually did on this page. */}
      <HistoryList history={history} market={market} t={t} />

      <motion.div variants={riseIn} style={{ marginTop: 4 }}>
        <InfoBox title={t('loan.archTitle')} tone="info" id="pos-arch">
          <p>{t('loan.archBody')}</p>
        </InfoBox>
      </motion.div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   §27 — TRANSACTION HISTORY
   Real hashes only. An entry with no hash is a rejected or failed attempt and
   is labelled as such; nothing here is ever generated to look like a hash, and
   every link points at the explorer of the chain it actually happened on.
   ═══════════════════════════════════════════════════════════════════════════ */

const HISTORY_TONE = {
  CONFIRMED: '#4ade80', PENDING: '#60a5fa', FAILED: '#f87171',
  REPLACED: '#fbbf24', UNKNOWN: '#9ca3af'
};

function HistoryList({ history, market, t }) {
  const [open, setOpen] = useState(false);
  const entries = history?.list?.({ wallet: market.address, chainId: market.chain }) ?? [];
  return (
    <motion.div
      variants={riseIn}
      data-testid="loan-history"
      style={{
        borderRadius: 16, overflow: 'hidden',
        background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <button
        type="button"
        data-testid="loan-history-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '11px 13px', background: 'transparent', border: 'none',
          cursor: 'pointer', color: 'var(--text-1)',
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 800 }}>{t('loan.historyTitle')}</span>
        <span className="faint" style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)' }}>{entries.length}</span>
        <motion.span
          animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.2 }}
          style={{ marginInlineStart: 'auto', display: 'inline-flex', color: 'var(--text-3)' }}
        >
          <IconChevronRight width={14} height={14} />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ padding: '0 13px 12px' }}>
              {entries.length === 0 && (
                <p className="faint" data-testid="loan-history-empty" style={{ fontSize: 11.5, lineHeight: 1.7, margin: 0 }}>
                  {t('loan.historyEmpty')}
                </p>
              )}
              {entries.map((entry) => {
                const tone = HISTORY_TONE[entry.status] ?? HISTORY_TONE.UNKNOWN;
                return (
                  <div
                    key={entry.id}
                    data-testid={`loan-history-${entry.status.toLowerCase()}`}
                    data-action={entry.action}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 9,
                      padding: '9px 0', borderBottom: '1px solid rgba(255,255,255,0.05)',
                    }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: 99, background: tone, flexShrink: 0 }} />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ fontSize: 11.5, fontWeight: 700 }}>
                        {t(`loan.sheetTitle.${entry.action}`, { defaultValue: entry.action })}
                        {entry.asset ? ` · ${entry.asset}` : ''}
                      </span>
                      <span className="faint" style={{ display: 'block', fontSize: 9.5, fontFamily: 'var(--font-mono)' }}>
                        {entry.amount != null ? `${entry.amount} ` : ''}
                        {chainLabel(entry.chainId)} · {new Date(entry.at).toLocaleString()}
                      </span>
                      {entry.code && (
                        <span style={{ display: 'block', fontSize: 9.5, color: tone }}>
                          {loanErrorText(t, entry.code)}
                        </span>
                      )}
                    </span>
                    <span style={{ textAlign: 'end', flexShrink: 0 }}>
                      <span style={{ fontSize: 9.5, fontWeight: 800, color: tone, letterSpacing: '.04em' }}>
                        {t(`loan.txStatus.${entry.status}`)}
                      </span>
                      {entry.hash ? (
                        <a
                          href={explorerTx(entry.chainId, entry.hash)}
                          target="_blank" rel="noreferrer noopener"
                          data-testid="loan-history-link"
                          style={{ display: 'block', fontSize: 9.5, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}
                        >
                          {entry.hash.slice(0, 8)}…
                        </a>
                      ) : (
                        <span className="faint" style={{ display: 'block', fontSize: 9 }}>{t('loan.noHash')}</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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
    <div
      data-testid="loan-how-it-works"
      style={{
        background: open
          ? 'linear-gradient(160deg, rgba(59,130,246,0.10) 0%, rgba(139,92,246,0.08) 55%, rgba(6,182,212,0.06) 100%)'
          : 'linear-gradient(135deg, rgba(255,255,255,0.045), rgba(255,255,255,0.02))',
        border: 'none',
        borderRadius: 20, overflow: 'hidden',
        boxShadow: open ? '0 18px 44px rgba(0,0,0,0.28)' : '0 6px 20px rgba(0,0,0,0.14)',
        transition: 'background 0.3s ease, box-shadow 0.3s ease',
        position: 'relative',
      }}
    >
      {open && (
        <div style={{
          position: 'absolute', top: -60, left: -40, width: 200, height: 200, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(99,102,241,0.22) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />
      )}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', padding: '15px 16px', background: 'transparent', border: 'none',
          cursor: 'pointer', gap: 10, position: 'relative',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <span style={{
            width: 36, height: 36, borderRadius: 12, display: 'grid', placeItems: 'center', flexShrink: 0,
            background: 'linear-gradient(135deg, rgba(59,130,246,0.35), rgba(139,92,246,0.35))',
            color: '#fff', boxShadow: '0 6px 16px rgba(99,102,241,0.30)',
          }}>
            <IconTrend width={18} height={18} />
          </span>
          <span style={{ textAlign: 'start' }}>
            <span style={{ display: 'block', fontWeight: 800, fontSize: 14, color: 'var(--text-1)' }}>{t('loan.howTitle')}</span>
            <span style={{ display: 'block', fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
              {steps.length} {t('loan.stepsLabel', { defaultValue: 'قدم ساده' })}
            </span>
          </span>
        </span>
        <motion.span
          animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.22 }}
          style={{
            width: 30, height: 30, borderRadius: 10, display: 'grid', placeItems: 'center',
            background: 'rgba(255,255,255,0.07)', color: 'var(--text-2)', flexShrink: 0,
          }}
        >
          <IconChevronRight width={16} height={16} />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: 'hidden', position: 'relative' }}
          >
            <div style={{ padding: '4px 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {steps.map((s, i) => (
                <motion.div
                  key={s.key}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05 * i, duration: 0.22 }}
                  style={{
                    display: 'flex', gap: 12, alignItems: 'flex-start',
                    padding: '12px 12px', borderRadius: 14,
                    background: 'rgba(255,255,255,0.04)',
                  }}
                >
                  <div style={{
                    width: 40, height: 40, borderRadius: 13, position: 'relative',
                    background: `linear-gradient(135deg, ${s.color}33, ${s.color}14)`,
                    display: 'grid', placeItems: 'center', flexShrink: 0,
                    color: s.color, boxShadow: `0 6px 16px ${s.color}22`,
                  }}>
                    <s.Icon width={20} height={20} />
                    <span style={{
                      position: 'absolute', top: -6, insetInlineStart: -6,
                      width: 18, height: 18, borderRadius: 9, fontSize: 10, fontWeight: 800,
                      background: s.color, color: '#0b0f19', display: 'grid', placeItems: 'center',
                    }}>{i + 1}</span>
                  </div>
                  <div style={{ paddingTop: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 3, color: 'var(--text-1)' }}>
                      {t(`loan.${s.key}Title`)}
                    </div>
                    <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.7 }}>
                      {t(`loan.${s.key}Body`)}
                    </p>
                  </div>
                </motion.div>
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
  /*
   * §24 — THIS CARD USED TO ADVERTISE A FEE THAT DOES NOT EXIST.
   * It read «FBT Fee / % of your yield». Nothing in the lending path takes a
   * fee: `runLendingPlan` calls Pool.supply / borrow / repay / withdraw with
   * referral code 0 and approves the pool directly — no fee router, no split,
   * no basis points, nowhere. On a page where the user is deciding what to do
   * with their collateral, a fee that is announced but never charged is not a
   * cosmetic problem: it implies a yield haircut that is not happening and it
   * hides the two costs that ARE (protocol interest and the network fee).
   *
   * The rule is "if no FBT fee exists, do not create one" — so the card now
   * states the truth, and the review sheet shows the real network fee (§23)
   * separately from anything FBT might ever charge.
   */
  const stats = [
    { label: t('loan.nonCustodial'), sub: t('loan.nonCustodialSub'), color: '#4ade80', Icon: IconLock },
    { label: t('loan.noFbtFee'),     sub: t('loan.noFbtFeeSub'),     color: '#60a5fa', Icon: IconCoins },
    { label: t('loan.noKyc'),        sub: t('loan.noKycSub'),        color: '#a78bfa', Icon: IconUser },
  ];
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {stats.map(s => (
        <motion.div
          key={s.label}
          whileTap={{ scale: 0.96 }}
          style={{
            flex: '1 1 0', padding: '12px 10px', borderRadius: 16, textAlign: 'center',
            background: 'rgba(255,255,255,0.06)',
            border: 'none',
            backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
            boxShadow: '0 6px 18px rgba(0,0,0,0.16)',
            display: 'flex', flexDirection: 'column', alignItems: 'center'
          }}
        >
          <div style={{
            width: 32, height: 32, borderRadius: 10, marginBottom: 8, display: 'grid', placeItems: 'center',
            background: `linear-gradient(135deg, ${s.color}33, ${s.color}12)`,
            boxShadow: `0 4px 12px ${s.color}22`,
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
  const { t, i18n } = useTranslation();
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
    collateral: searchParams.get('collateral') || null,
    /* §33 — an Intent OS hand-off can now name the collateral asset as well as
       the borrow asset, because the borrow form takes them separately (§11). */
    collateralAsset: searchParams.get('collateralAsset') || null
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
  const [walletOpen, setWalletOpen] = useState(false);
  const [machineView, setMachineView] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  /* §3/§19/§20/§21/§25 — everything the market pass now reads, kept separate
     so each can be labelled with where it came from. */
  const [oracle, setOracle] = useState(null);
  const [oracleStatus, setOracleStatus] = useState('unavailable');
  const [prices, setPrices] = useState({});
  const [userConfiguration, setUserConfiguration] = useState(null);
  const [dataStatus, setDataStatus] = useState(DATA_STATUS.UNAVAILABLE);
  const [sources, setSources] = useState(null);
  const [snapshotAgeMs, setSnapshotAgeMs] = useState(null);
  const [failures, setFailures] = useState([]);
  const [history, setHistory] = useState([]);
  const [nativePriceUsd, setNativePriceUsd] = useState(null);
  /* §15 — why a collateral toggle was refused, kept so the page can explain it
     instead of only firing a toast that disappears. */
  const [collateralRefusal, setCollateralRefusal] = useState(null);

  const machineRef = useRef(null);
  const guardRef = useRef(createInFlightGuard());
  const prevSnapRef = useRef(null);
  const lastTxFailureRef = useRef(null);
  /* One cache and one ledger for the life of the page. The cache is short-TTL
     and only ever holds a snapshot that actually read something (§26). */
  const cacheRef = useRef(createMarketCache());
  const historyRef = useRef(createTransactionHistory());

  const walletState = !isConnected || !address
    ? 'disconnected'
    : Number(walletChainId) !== Number(chain)
      ? 'wrong-chain'
      : 'ready';

  /*
   * §27/§28 — the circuit breaker lives on the BFF. The banner only renders
   * what the server reports; if the status call fails (or is stubbed in
   * tests), the page simply stays interactive — no crash, no invented state.
   *
   * `canTransact` is kept alongside `readOnly` because the banner was
   * previously the ONLY thing read-only mode did: the server said "refuse new
   * transactions", the page agreed in writing, and then let the user sign
   * anyway. It is enforced in `openExecution` now.
   */
  const [canTransact, setCanTransact] = useState(true);
  useEffect(() => {
    let alive = true;
    fetch(`${apiBase()}/lending/status`)
      .then((res) => res.json())
      .then((json) => {
        if (!alive) return;
        const isReadOnly = Boolean(json?.data?.readOnly);
        setReadOnly(isReadOnly);
        /* Trust the server's own verdict when it gives one; otherwise derive it
           from readOnly so a partial payload cannot re-enable transactions. */
        setCanTransact(json?.data?.canTransact === undefined ? !isReadOnly : Boolean(json.data.canTransact) && !isReadOnly);
      })
      .catch(() => { if (alive) { setReadOnly(false); setCanTransact(true); } });
    return () => { alive = false; };
  }, [chain]);

  /* §27 — reconcile abandoned pendings so nothing stays PENDING forever. */
  useEffect(() => {
    historyRef.current.reconcile();
    setHistory(historyRef.current.list({ wallet: address, chainId: chain }));
  }, [address, chain]);

  /*
   * §23 — the native price is used ONLY to show the network fee in USD as a
   * labelled estimate. It is never a risk input: collateral value, borrowing
   * power and the health factor all come from the protocol's own oracle (§32).
   * If it cannot be fetched the fee is simply shown in the native token.
   */
  useEffect(() => {
    let alive = true;
    if (chain === SOLANA_LENDING_CHAIN_ID) { setNativePriceUsd(null); return () => { alive = false; }; }
    const nativeId = chain === 56 ? 'binancecoin' : chain === 137 ? 'matic-network' : chain === 43114 ? 'avalanche-2' : chain === 146 ? 'sonic-3' : 'ethereum';
    import('../lib/api')
      .then((api) => api.getSimplePrices([nativeId]))
      .then((res) => {
        if (!alive) return;
        const value = res?.[nativeId]?.usd;
        setNativePriceUsd(Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null);
      })
      .catch(() => { if (alive) setNativePriceUsd(null); });
    return () => { alive = false; };
  }, [chain]);

  /**
   * One read pass through the LENDING SERVICE (§4): live reserve rates, the
   * protocol's own oracle prices, liquidity and caps, the wallet's account and
   * per-asset positions, and its collateral-usage bitmap.
   *
   * The same pass feeds the alert engine (§22) with the previous snapshot.
   * `force` bypasses the cache — used after a transaction so the position the
   * user sees is the one the chain has, not the one from before they signed.
   */
  const refresh = useCallback(async ({ force = true } = {}) => {
    /* Solana owns a separate RPC and wallet layer; do not route its chain id
       through the EVM provider factory. */
    if (chain === SOLANA_LENDING_CHAIN_ID) {
      setLoading(false);
      setDataStatus(DATA_STATUS.UNAVAILABLE);
      setSources(null);
      setFailures([]);
      return;
    }
    if (!venue || typeof getReadProvider !== 'function') {
      setLoading(false);
      setDataStatus(DATA_STATUS.UNAVAILABLE);
      setSources(null);
      setFailures([{ step: 'provider', reason: 'NO_PROVIDER' }]);
      return;
    }
    setLoading(true);
    try {
      const provider = await getReadProvider(chain);
      const snapshot = await readMarketState({
        provider, chainId: chain, assets, wallet: address || null,
        cache: cacheRef.current, force
      });

      setReserves(snapshot.reserves || {});
      setPositions(snapshot.positions || {});
      setAccount(snapshot.account ?? null);
      setOracle(snapshot.oracle ?? null);
      setOracleStatus(snapshot.oracleStatus ?? 'unavailable');
      setPrices(snapshot.prices || {});
      setUserConfiguration(snapshot.userConfiguration ?? null);
      setDataStatus(snapshot.dataStatus);
      setSources(snapshot.sources ?? null);
      setSnapshotAgeMs(snapshot.ageMs ?? null);
      setFailures(snapshot.failures || []);
      setReadAt(snapshot.readAt ?? null);

      /* Alert engine: pure rules over (current, previous) snapshots. */
      try {
        const prev = prevSnapRef.current;
        const marketNow = Object.fromEntries(assets.map((a) => [a.id, {
          supplyApyPct: snapshot.reserves?.[a.id]?.supplyApyPct,
          borrowApyPct: snapshot.reserves?.[a.id]?.borrowApyPct
        }]));
        const riskNow = snapshot.risk ?? null;
        setAlerts(evaluateAlerts({
          position: riskNow,
          previous: prev?.risk ?? null,
          market: marketNow,
          previousMarket: prev?.market ?? null,
          txFailed: lastTxFailureRef.current,
          /* §21 — an oracle the protocol itself could not answer is a critical
             condition, not a cosmetic one. */
          oracle: snapshot.oracleStatus === 'ok' ? { status: 'ok' }
            : snapshot.oracleStatus === 'stale' ? { status: 'stale' }
              : snapshot.oracleStatus === 'anomaly' ? { status: 'anomaly' } : null
        }));
        prevSnapRef.current = { risk: riskNow, market: marketNow };
      } catch {
        /* Alerts must never take the page down. */
      }
    } catch (error) {
      /* A dead RPC leaves the last honest numbers on screen — labelled with
         their age — and never invents a replacement (§26/§37). */
      setFailures((prev) => [...prev, { step: 'refresh', reason: String(error?.message || error).slice(0, 160) }]);
      setDataStatus(DATA_STATUS.UNAVAILABLE);
      setSources(null);
    } finally {
      setLoading(false);
    }
  }, [venue, chain, assets, address, getReadProvider]);

  useEffect(() => { refresh({ force: true }); }, [refresh]);

  /*
   * §25/§26/§35 — REFRESH TRIGGERS.
   * A position must be re-read on connect, disconnect, chain switch (all of
   * which re-create `refresh` above), and on APP RESUME. The resume case is the
   * one mobile depends on: signing in an external wallet suspends the page, and
   * when the user comes back the numbers on screen are from before the
   * transaction. `visibilitychange` covers the tab and the phone both.
   *
   * While the page is visible it also polls, so a health factor drifting
   * towards liquidation does not sit unnoticed until the user taps refresh.
   */
  useEffect(() => {
    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') refresh({ force: true });
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    if (typeof window !== 'undefined') window.addEventListener('focus', onVisible);
    const id = setInterval(() => {
      const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
      if (visible) refresh({ force: false });
    }, MARKET_POLL_MS);
    return () => {
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
      if (typeof window !== 'undefined') window.removeEventListener('focus', onVisible);
      clearInterval(id);
    };
  }, [refresh]);

  /*
   * ─── THE CONNECT BUTTON USED TO DO NOTHING ─────────────────────────────
   * Reported: «در صفحه وام وقتی روی اتصال کیف پول میزنی اتفاقی نمیافتد».
   *
   * `connect` called `connectInjected()` directly, which needs `window.ethereum`
   * — a desktop browser with a wallet extension. On a phone, in Telegram, or
   * anywhere without an injected provider it threw NO_INJECTED_WALLET, returned
   * false, and the page showed nothing: the button visibly did nothing.
   *
   * Every other page (Swap, Wallet, dYdX, FuturesOnchain…) opens the
   * WalletConnectSheet instead, which offers injected + WalletConnect QR +
   * email/social. This page does the same now — with one fast path kept: when
   * an injected provider IS present the tap connects it immediately (that is
   * also the path the loan-execution probe drives), and only otherwise does
   * the sheet open with the alternatives.
   */
  const connect = useCallback(async () => {
    haptic?.('light');
    const hasInjected = typeof window !== 'undefined' && Boolean(window.ethereum);
    if (hasInjected && typeof connectInjected === 'function') {
      const ok = await connectInjected();
      if (ok) return;
    }
    /* No injected provider, or the injected attempt failed: offer the
       WalletConnect / email alternatives instead of failing silently. */
    setWalletOpen(true);
  }, [connectInjected, haptic]);

  const switchToChain = useCallback(async () => {
    haptic?.('light');
    if (typeof switchChain === 'function') await switchChain(chain);
  }, [switchChain, chain, haptic]);

  /**
   * Review first. Everything the wallet will be asked to sign is computed
   * BEFORE the sheet opens:
   *
   *   1. the current allowance — so an approval step appears only when the
   *      allowance is genuinely short, and for exactly the amount needed (§29)
   *   2. the pre-flight decision — caps, liquidity, borrowing power, the
   *      resulting health factor, gas availability (§9/§11/§17/§20)
   *   3. the resulting risk, priced by the protocol's oracle (§13)
   *
   * The sheet then opens and, while it is open, the SIMULATION and the GAS
   * ESTIMATE run (§22/§23). They are async on purpose: the review numbers
   * should not wait on two RPC round-trips, and a simulation that comes back
   * reverted disables Confirm where the user can see it.
   *
   * Read-only mode is enforced HERE, not just in the banner (§27/§28).
   */
  const openExecution = useCallback(async ({ action, asset, amount, collateral = null, collateralAsset = null, maxWei = null, useAsCollateral = null, suppliedUsd = null }) => {
    /* §27/§28 — the banner said transactions were refused; now they are. */
    if (readOnly || !canTransact) {
      notify('loan.error.READ_ONLY_MODE', 'error');
      return;
    }

    let provider = null;
    let allowanceWei = null;
    let collateralAllowanceWei = null;
    let nativeBalanceWei = null;
    try {
      if (typeof getReadProvider === 'function' && address) {
        provider = await getReadProvider(chain);
        allowanceWei = await readAllowance({ provider, chainId: chain, asset, owner: address });
        if (collateralAsset?.address && collateralAsset.address !== asset.address) {
          collateralAllowanceWei = await readAllowance({ provider, chainId: chain, asset: collateralAsset, owner: address });
        }
        try { nativeBalanceWei = (await provider.getBalance(address)).toString(); } catch { nativeBalanceWei = null; }
      }
    } catch { provider = null; allowanceWei = null; }

    const reserve = reserves[asset.id];
    /* §18 — decimals from the protocol/contract when they could be read. */
    const decimals = Number(reserve?.decimals ?? asset.decimals ?? 18);
    const collateralDecimals = collateralAsset
      ? Number(reserves[collateralAsset.id]?.decimals ?? collateralAsset.decimals ?? 18)
      : decimals;

    const isMax = isMaxAmount(amount);
    const isCollateralToggle = action === 'collateral';
    const amountWei = isCollateralToggle ? null : (isMax ? maxWei : toUnits(amount, decimals)?.toString() ?? null);
    const collateralWei = collateralAsset ? toUnits(collateral, collateralDecimals)?.toString() ?? null : null;

    /* §9 — the full pre-flight. A blocked action never reaches the sheet. */
    const decision = evaluateAction({
      market: { chainId: chain, reserves, positions, account, prices, oracleStatus, userConfiguration },
      action, asset, amount, amountWei,
      collateralAmountWei: collateralWei,
      collateralAsset: collateralAsset ?? asset,
      walletBalanceWei: action === 'supply' ? positions[asset.id]?.walletWei ?? null : null,
      suppliedWei: action === 'withdraw' ? positions[asset.id]?.suppliedWei ?? null : null,
      debtWei: action === 'repay' ? positions[asset.id]?.debtWei ?? null : null,
      nativeBalanceWei
    });
    if (!decision.ok) {
      notify(`loan.error.${decision.blocked[0].code}`, 'error');
      return;
    }

    const plan = buildLendingPlan({
      action, asset, amount, collateral, collateralAsset,
      allowanceWei, collateralAllowanceWei,
      decimals, maxWei, useAsCollateral
    });
    if (!plan.ok) {
      notify(`loan.error.${plan.error}`, 'error');
      return;
    }

    /* §13 — the risk this action creates, with every amount priced first.
       A collateral toggle moves no tokens, so its risk is the one
       `assertCollateralChangeSafe` already computed — shown, not recomputed
       with a different formula. */
    const risk = isCollateralToggle
      ? (() => {
        const check = assertCollateralChangeSafe({
          account,
          /* The USD value of the collateral being switched off, priced by the
             protocol oracle in PositionsTab. Unknown means the check refuses. */
          removeCollateralUsd: useAsCollateral ? 0 : (suppliedUsd ?? 0),
          minSafeHealthFactor: MIN_HEALTH_FACTOR_AFTER_BORROW
        });
        return check.ok
          ? { ok: true, healthFactorBefore: account?.healthFactor ?? null, healthFactorAfter: check.healthFactorAfter, liquidationThresholdPct: account?.liquidationThresholdPct ?? null }
          : { ok: false, reason: check.code, detail: check.reason };
      })()
      : projectActionRisk({
        market: { chainId: chain, reserves, prices, account, userConfiguration, oracleStatus },
        action, amountWei, asset,
        collateralAmountWei: collateralWei,
        collateralAsset: collateralAsset ?? asset
      });

    const review = [
      [t('loan.asset'), asset.symbol],
      [t('loan.action'), t(`loan.sheetTitle.${action}`, { defaultValue: action })],
      /* A collateral toggle moves no tokens, so it has no amount row at all —
         showing "0 USDT" would imply a transfer that is not happening. */
      ...(isCollateralToggle ? [] : [[t('loan.amount'), isMax
        /* A MAX action shows what it will actually settle, not the 2^256-1
           sentinel the protocol receives (§16/§17). */
        ? `${fromUnits(maxWei, decimals)} ${asset.symbol} (${t('loan.maxLabel')})`
        : `${amount} ${asset.symbol}`]])
    ];
    if (collateralAsset && collateralWei && BigInt(collateralWei) > 0n) {
      review.push([t('loan.collateralAsset'), `${fromUnits(collateralWei, collateralDecimals)} ${collateralAsset.symbol}`]);
    } else if (collateral && Number(collateral) > 0) {
      review.push([t('loan.collateral'), `${collateral} ${asset.symbol}`]);
    }
    review.push([t('loan.market'), chainLabel(chain)]);
    if (reserve?.supplyApyPct != null && (action === 'supply' || action === 'withdraw')) {
      review.push([t('loan.supplyApyLine'), `${reserve.supplyApyPct.toFixed(2)}% APY`]);
    }
    if (reserve?.borrowApyPct != null && (action === 'borrow' || action === 'repay')) {
      review.push([t('loan.borrowApyLine'), `${reserve.borrowApyPct.toFixed(2)}% APY (variable)`]);
    }
    if (risk?.ok && risk.healthFactorAfter != null) {
      review.push([t('loan.healthFactorAfter'), risk.healthFactorAfter.toFixed(2)]);
    }
    if (useAsCollateral != null) {
      review.push([t('loan.useAsCollateral'), useAsCollateral ? t('common.on', { defaultValue: 'On' }) : t('common.off', { defaultValue: 'Off' })]);
    }
    /* §19 — where these numbers came from and how old they are. */
    review.push([t('loan.dataSourceLine'), t(`loan.status.${dataStatus}`)]);

    /* §15 — the machine starts here: validation is the reads above; the review
       sheet is the READY state. Each attempt carries its own requestId and a
       deterministic idempotency key (§17). */
    const machine = createTransactionMachine({
      action,
      meta: {
        requestId: makeRequestId(),
        idempotencyKey: makeIdempotencyKey({ action, wallet: address || 'none', asset: asset?.id, amount, chainId: chain }),
        asset: asset?.symbol,
        chainId: chain
      }
    });
    machine.transition(TX_STATE.VALIDATING);
    machine.transition(TX_STATE.READY);
    machineRef.current = machine;
    setMachineView(machine.snapshot());

    setExec({
      action,
      asset,
      amount,
      collateral,
      collateralAsset,
      maxWei,
      useAsCollateral,
      amountWei,
      collateralWei,
      decimals,
      chainId: chain,
      requestId: machine.meta.requestId,
      idempotencyKey: machine.meta.idempotencyKey,
      review,
      plan,
      risk,
      account,
      warnings: decision.warnings,
      simulation: null,
      fee: null,
      steps: plan.steps.map((step) => ({ ...step, state: 'pending', hash: null })),
      phase: 'review'
    });

    /* §22/§23 — simulate the exact calldata the adapter builds, then read the
       network's current fee using the gas limit that simulation returned. ONE
       simulation, not two: each step is a real eth_call + estimateGas against
       a public RPC, and doubling it doubles the chance of a rate-limit that
       would report "could not simulate" for no reason. Neither signs anything,
       and a failure to simulate is reported as NOT proven rather than as a
       pass. */
    if (provider && address) {
      const requestId = machine.meta.requestId;
      Promise.resolve().then(async () => {
        let simulation = null;
        try {
          simulation = await simulateLendingPlan({
            provider, chainId: chain, plan, wallet: address, asset,
            realAmountWei: isMax ? maxWei : null
          });
        } catch {
          simulation = { ok: false, status: 'unknown', reason: 'SIMULATION_FAILED', steps: [] };
        }
        let fee = { ok: false, reason: 'GAS_LIMIT_UNAVAILABLE' };
        try {
          fee = await estimateNetworkFee({
            provider,
            gasLimit: simulation?.totalGasLimit ?? null,
            nativePriceUsd,
            chainId: chain
          });
        } catch { fee = { ok: false, reason: 'FEE_DATA_UNREADABLE' }; }
        /* Only apply to the sheet this pass opened — a second action opened
           while these reads were in flight must not be overwritten by them. */
        setExec((prev) => (prev && prev.requestId === requestId ? { ...prev, simulation, fee } : prev));
      });
    }
  }, [address, chain, getReadProvider, notify, t, readOnly, canTransact, reserves, positions, account, prices, oracleStatus, userConfiguration, dataStatus, nativePriceUsd]);

  const updateMachine = useCallback(() => {
    const machine = machineRef.current;
    if (machine) setMachineView(machine.snapshot());
  }, []);

  /**
   * Run the reviewed plan. Every step is the user's own wallet signature — FBT
   * never signs and never broadcasts (§30).
   *
   * Two things this did not do before:
   *   · the SIMULATING state was a label with nothing behind it. The real
   *     eth_call + estimateGas now runs while the review sheet is open, and a
   *     detected revert disables Confirm. The state is not asserted here unless
   *     a simulation actually happened.
   *   · nothing re-checked the wallet immediately before signing. Between the
   *     sheet opening and Confirm being pressed the account or chain can change
   *     — routinely, on mobile, because opening the external wallet suspends the
   *     page (§35). `executeLendingPlan` re-asserts both (§9).
   */
  const confirmExecution = useCallback(async () => {
    if (!exec) return;
    const machine = machineRef.current;
    if (!machine) return;

    /* §27/§28 — enforced at the signature, not only when the sheet opens: the
       breaker can trip while a review sheet is sitting open. */
    if (readOnly || !canTransact) {
      machine.transition(TX_STATE.ERROR, { code: 'READ_ONLY_MODE' });
      updateMachine();
      setExec((prev) => (prev ? { ...prev, phase: 'failed', code: 'READ_ONLY_MODE' } : prev));
      return;
    }

    /* §17 layer 1: the in-flight guard. A double-tap on Confirm (or a retry
       racing itself) is refused with the SAME deterministic key the backend
       would use — the second attempt never reaches the wallet. */
    const idemKey = exec.idempotencyKey || makeIdempotencyKey({ action: exec.action, wallet: address, asset: exec.asset?.id, amount: exec.amount, chainId: exec.chainId });
    const acquired = guardRef.current.tryAcquire(idemKey);
    if (!acquired.ok) return;

    /* §27 — the ledger entry exists from the moment the attempt starts, so a
       rejection or a dropped transaction is still a record the user can see.
       It carries no hash yet, and one is never invented for it. */
    const historyId = `${exec.requestId}`;
    historyRef.current.record({
      id: historyId,
      action: exec.action,
      asset: exec.asset?.symbol ?? null,
      amount: isMaxAmount(exec.amount) ? t('loan.maxLabel') : exec.amount,
      amountWei: exec.amountWei ?? null,
      chainId: exec.chainId,
      protocol: venue?.protocol ?? 'aave-v3',
      wallet: address,
      hash: null,
      status: TX_STATUS.PENDING
    });
    setHistory(historyRef.current.list({ wallet: address, chainId: chain }));

    try {
      const signer = typeof getSigner === 'function' ? getSigner() : null;
      if (!signer) {
        machine.transition(TX_STATE.ERROR, { code: 'WALLET_NOT_CONNECTED' });
        updateMachine();
        setExec((prev) => (prev ? { ...prev, phase: 'failed', code: 'WALLET_NOT_CONNECTED' } : prev));
        historyRef.current.settle(historyId, { status: TX_STATUS.FAILED, code: 'WALLET_NOT_CONNECTED' });
        setHistory(historyRef.current.list({ wallet: address, chainId: chain }));
        return;
      }

      /* The simulation already ran while the sheet was open. The machine only
         enters SIMULATING when there is a verdict to show; otherwise it is
         reported honestly as not simulated. */
      if (exec.simulation) {
        machine.transition(TX_STATE.SIMULATING);
        updateMachine();
        if (exec.simulation.status === 'revert-detected') {
          machine.transition(TX_STATE.ERROR, { code: 'SIMULATION_FAILED' });
          updateMachine();
          setExec((prev) => (prev ? { ...prev, phase: 'failed', code: 'SIMULATION_FAILED', message: exec.simulation.revertReason } : prev));
          historyRef.current.settle(historyId, { status: TX_STATUS.FAILED, code: 'SIMULATION_FAILED', message: exec.simulation.revertReason });
          setHistory(historyRef.current.list({ wallet: address, chainId: chain }));
          return;
        }
      } else {
        machine.transition(TX_STATE.SIMULATING);
        updateMachine();
      }

      machine.transition(TX_STATE.AWAITING_SIGNATURE);
      updateMachine();
      setExec((prev) => (prev ? { ...prev, phase: 'running' } : prev));

      let provider = null;
      try { provider = typeof getReadProvider === 'function' ? await getReadProvider(exec.chainId) : null; } catch { provider = null; }

      const result = await executeLendingPlan({
        signer,
        provider,
        chainId: exec.chainId,
        plan: exec.plan ?? { steps: exec.steps },
        asset: exec.asset,
        wallet: address,
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
          /* The first real hash is the attempt's transaction (§27). */
          if (update.hash) {
            historyRef.current.record({ id: historyId, hash: update.hash });
          }
        }
      });

      if (result.ok) {
        /* §16: signed → broadcast → confirmed; the final verify is the fresh
           on-chain position read below, then COMPLETED. */
        machine.transition(TX_STATE.SIGNED);
        machine.transition(TX_STATE.BROADCASTING);
        machine.transition(TX_STATE.PENDING);
        machine.transition(TX_STATE.CONFIRMED);
        machine.transition(TX_STATE.VERIFYING);
        updateMachine();
        lastTxFailureRef.current = null;
        /* §26 — force-refresh: the position shown after a confirmation must be
           the chain's, not the cache's. */
        cacheRef.current.invalidate(`market:${exec.chainId}:`);
        await refresh({ force: true });
        machine.transition(TX_STATE.COMPLETED);
        updateMachine();
        setExec((prev) => (prev ? { ...prev, phase: 'done', code: null, message: null } : prev));
        haptic?.('success');

        /* The last step's hash is the action's own transaction (approval steps
           precede it). §27: a real hash from the wallet, or no entry at all. */
        const mainHash = [...(result.completed || [])].reverse().find((step) => step.hash)?.hash ?? null;
        historyRef.current.settle(historyId, { status: TX_STATUS.CONFIRMED, hash: mainHash });
        setHistory(historyRef.current.list({ wallet: address, chainId: chain }));

        /* A confirmed, on-chain lending action is real rewarded activity. */
        const actionKey =
          exec.action === 'supply' ? 'lending'
            : exec.action === 'withdraw' ? 'withdraw'
              : exec.action === 'repay' ? 'repay'
                : exec.action === 'borrow' ? 'borrow' : null;
        if (actionKey && POINT_VALUES[actionKey] > 0 && mainHash) {
          const rewards = useAppStore.getState();
          rewards.awardPoints(actionKey, POINT_VALUES[actionKey], {
            network: 'evm', chainId: exec.chainId, txHash: mainHash
          });
        }
      } else {
        /* §14/§28: a raw wallet/RPC/protocol error is mapped to a stable code
           plus a human sentence. The raw text is kept for diagnostics but is
           never rendered as the explanation. */
        const mapped = mapRawError({ code: result.code, message: result.message }, { fallback: 'UNKNOWN' });
        const code = LENDING_CODES.has(result.code) ? result.code : mapped.code;
        if (code === 'USER_REJECTED') machine.transition(TX_STATE.CANCELLED, { code });
        else machine.transition(TX_STATE.ERROR, { code });
        updateMachine();
        lastTxFailureRef.current = { action: exec.action, asset: exec.asset?.symbol ?? null };
        setExec((prev) => (prev
          ? { ...prev, phase: 'failed', code, message: result.message || null }
          : prev));
        historyRef.current.settle(historyId, {
          /* A dropped/replaced transaction is not the same as a failed one. */
          status: code === 'TRANSACTION_DROPPED' ? TX_STATUS.REPLACED : TX_STATUS.FAILED,
          hash: result.hash || null,
          code,
          message: result.message || null
        });
        setHistory(historyRef.current.list({ wallet: address, chainId: chain }));
      }
    } finally {
      guardRef.current.release(idemKey);
      updateMachine();
    }
  }, [exec, getSigner, getReadProvider, address, chain, refresh, haptic, updateMachine, readOnly, canTransact, venue, t]);

  /** §15: ERROR → RETRY → VALIDATING. A fresh attempt with a fresh requestId. */
  const retryExecution = useCallback(() => {
    if (!exec) return;
    const machine = createTransactionMachine({
      action: exec.action,
      meta: { requestId: makeRequestId(), idempotencyKey: exec.idempotencyKey, asset: exec.asset?.symbol, chainId: exec.chainId }
    });
    machine.transition(TX_STATE.RETRY);
    machine.transition(TX_STATE.VALIDATING);
    machineRef.current = machine;
    setMachineView(machine.snapshot());
    setExec((prev) => (prev ? { ...prev, steps: prev.steps.map((s) => ({ ...s, state: 'pending', hash: null })) } : prev));
    confirmExecution();
  }, [exec, confirmExecution]);

  /**
   * §15 — enable / disable a supplied asset as collateral.
   *
   * Disabling collateral is the one action on this page that can turn a healthy
   * position into a liquidatable one in a single signature, so it is checked
   * BEFORE the sheet opens: if the user has debt resting on this collateral and
   * turning it off would drop the health factor below the floor, the action is
   * refused and the reason is shown. The protocol would revert anyway; the user
   * should not have to pay gas to find that out.
   */
  const toggleCollateral = useCallback(({ asset, useAsCollateral, position, suppliedUsd }) => {
    if (readOnly || !canTransact) { notify('loan.error.READ_ONLY_MODE', 'error'); return; }
    if (useAsCollateral) {
      /* Turning collateral ON never reduces safety. */
      openExecution({ action: 'collateral', asset, amount: '0', useAsCollateral: true, suppliedUsd });
      return;
    }
    const check = assertCollateralChangeSafe({
      account,
      removeCollateralUsd: suppliedUsd ?? 0,
      minSafeHealthFactor: MIN_HEALTH_FACTOR_AFTER_BORROW
    });
    if (!check.ok) {
      notify(`loan.error.${check.code}`, 'error');
      setCollateralRefusal({ asset, code: check.code, reason: check.reason, healthFactorAfter: check.healthFactorAfter ?? null });
      return;
    }
    setCollateralRefusal(null);
    openExecution({ action: 'collateral', asset, amount: '0', useAsCollateral: false, suppliedUsd });
  }, [account, canTransact, notify, openExecution, readOnly]);

  /*
   * The single object the three tabs render from. Everything on it came from
   * one `readMarketState` pass, so the rates, the prices, the liquidity, the
   * position and the risk assessment all describe the SAME block — which is the
   * property that stops a health factor computed from one read being displayed
   * next to a borrowing power from another.
   */
  const market = {
    chain, assets, reserves, positions, account, loading, walletState,
    prices, oracle, oracleStatus, userConfiguration,
    dataStatus, ageMs: snapshotAgeMs, readAt, failures,
    address, readOnly, canTransact,
    /* The active UI language, so value boxes can decide which parts of a
       diagnostic belong on screen (see ReasonList's detail policy). */
    lang: i18n.language,
    sources,
    connect, switchToChain, refresh: () => refresh({ force: true })
  };
  /* The service layer's market shape is keyed by `chainId`; this page and its
     tabs have always called it `chain`. Both are present, because a missing
     key here is not a cosmetic difference — it reads as UNSUPPORTED_CHAIN and
     silently disables every button on the page. */
  market.chainId = chain;

  /* Is this whole market closed by the protocol? Answered from the reserves
     that were actually read — a reserve whose read failed (`listed` null) is
     not counted either way, so an unread market never renders as «closed». */
  const listedReserves = Object.values(reserves || {}).filter((r) => r && r.listed !== false);
  const haltedReserves = listedReserves.filter((r) => r.status === 'frozen' || r.status === 'paused');
  const marketHaltedKind = listedReserves.length > 0 && haltedReserves.length === listedReserves.length
    ? (haltedReserves.every((r) => r.status === 'frozen') ? 'frozen'
      : haltedReserves.every((r) => r.status === 'paused') ? 'paused'
        : 'mixed')
    : null;

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
        {/* §23 — the alert bell: count only, no white border. */}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          data-testid="loan-alerts-bell"
          data-count={alerts.length}
          aria-label={t('loan.alerts.title')}
          onClick={() => { haptic?.('light'); setAlertsOpen((open) => !open); }}
          style={{ position: 'relative' }}
        >
          <span style={{ fontSize: 13 }}>🔔</span>
          {alerts.length > 0 && (
            <span
              style={{
                position: 'absolute', top: -4, right: -4, minWidth: 15, height: 15, borderRadius: 99,
                background: alerts.some((a) => a.severity === 'critical') ? '#f87171' : '#fbbf24',
                color: '#0b0b10', fontSize: 9, fontWeight: 800,
                display: 'grid', placeItems: 'center', padding: '0 3px',
              }}
            >
              {alerts.length}
            </span>
          )}
        </button>
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

      {/* §27/§28 — read-only fallback, driven by the BFF's circuit breaker.
          Enforced in openExecution and confirmExecution, not only displayed. */}
      {readOnly && <ReadOnlyBanner t={t} />}

      {/* §37 — nothing could be read. The page says so and offers a retry
          instead of showing zeros, a spinner that never ends, or a cached
          snapshot presented as if it were fresh. */}
      {!loading && chain !== SOLANA_LENDING_CHAIN_ID && dataStatus === DATA_STATUS.UNAVAILABLE && venue && (
        <UnavailableBanner failures={failures} onRetry={() => refresh({ force: true })} t={t} />
      )}

      {/* §15 — why a collateral toggle was refused, stated on the page. */}
      {collateralRefusal && (
        <motion.div
          variants={riseIn} initial="hidden" animate="show"
          data-testid="loan-collateral-refused"
          data-code={collateralRefusal.code}
          style={{
            borderRadius: 14, padding: '12px 14px', marginBottom: 12,
            background: 'rgba(248,113,113,0.09)', border: '1px solid rgba(248,113,113,0.30)',
          }}
        >
          <div className="row-between" style={{ gap: 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: '#fca5a5' }}>
              {t('loan.collateralRefusedTitle', { symbol: collateralRefusal.asset?.symbol })}
            </span>
            <button type="button" className="icon-btn" aria-label={t('common.close', { defaultValue: 'Close' })} onClick={() => setCollateralRefusal(null)}>✕</button>
          </div>
          <p style={{ fontSize: 11.5, lineHeight: 1.7, color: 'var(--text-2)', margin: '4px 0 0' }}>
            {loanErrorText(t, collateralRefusal.code)}
            {collateralRefusal.healthFactorAfter != null && (
              <span style={{ display: 'block', fontFamily: 'var(--font-mono)', marginTop: 3 }}>
                {t('loan.healthFactorAfter')}: {collateralRefusal.healthFactorAfter.toFixed(2)} · {t('loan.liquidationPoint')}: 1.00
              </span>
            )}
          </p>
        </motion.div>
      )}

      <AlertsPanel
        alerts={alerts}
        open={alertsOpen}
        onClose={() => setAlertsOpen(false)}
        onManage={() => { setAlertsOpen(false); setTab('positions'); }}
        t={t}
      />

      {/* ── Hero card ──────────────────────────────────────────────────── */}
      <motion.div
        variants={riseIn} initial="hidden" animate="show"
        style={{
          borderRadius: 24, overflow: 'hidden',
          background: 'linear-gradient(140deg, rgba(37,99,235,0.28) 0%, rgba(124,58,237,0.22) 48%, rgba(6,182,212,0.16) 100%)',
          border: 'none',
          boxShadow: '0 22px 54px rgba(37,99,235,0.22), inset 0 1px 0 rgba(255,255,255,0.10)',
          padding: '20px 18px 16px',
          marginBottom: 14,
          position: 'relative',
        }}
      >
        <div style={{
          position: 'absolute', top: -40, right: -40,
          width: 220, height: 220, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(99,102,241,0.42) 0%, transparent 70%)',
          filter: 'blur(6px)',
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', bottom: -50, left: -30,
          width: 170, height: 170, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(6,182,212,0.30) 0%, transparent 70%)',
          filter: 'blur(6px)',
          pointerEvents: 'none',
        }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <motion.div
            whileHover={{ rotate: 6, scale: 1.04 }}
            style={{
              width: 50, height: 50, borderRadius: 16, display: 'grid', placeItems: 'center',
              background: 'linear-gradient(135deg, #3b82f6, #8b5cf6 60%, #06b6d4)',
              boxShadow: '0 12px 30px rgba(99,102,241,0.55), inset 0 1px 0 rgba(255,255,255,0.35)',
              flexShrink: 0, color: '#fff',
            }}
          >
            <IconPools width={22} height={22} />
          </motion.div>
          <div>
            <div style={{
              fontWeight: 900, fontSize: 17.5, lineHeight: 1.25, letterSpacing: '-0.01em',
              background: 'linear-gradient(90deg, #fff 0%, #c7d2fe 100%)',
              WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
            }}>{t('loan.heroTitle')}</div>
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 3, opacity: 0.85 }}>{t('loan.heroSub')}</div>
          </div>
        </div>

        <HeroStats t={t} />
      </motion.div>

      {/* ── Market picker ──────────────────────────────────────────────── */}
      <ChainRail chain={chain} onPick={(id) => { haptic?.('select'); setChain(id); }} t={t} />

      {/* §29 — the protocol has closed this market to new positions. Said once,
          with what still works, instead of leaving it to a wall of grey cards. */}
      {chain !== SOLANA_LENDING_CHAIN_ID && marketHaltedKind && !loading && (
        <MarketHaltedNotice kind={marketHaltedKind} t={t} />
      )}

      {chain === SOLANA_LENDING_CHAIN_ID && (
        <SolanaLendingPanel t={t} tab={tab} setTab={setTab} preset={preset} />
      )}

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      {chain !== SOLANA_LENDING_CHAIN_ID && <motion.div
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
      </motion.div>}

      {/* Where the numbers come from — stated, not implied. §19 wants the age
          of the data next to the data, so it ticks here rather than only
          showing the clock time of the read. */}
      {chain !== SOLANA_LENDING_CHAIN_ID && <motion.div
        variants={riseIn} initial="hidden" animate="show"
        data-testid="loan-rate-source"
        style={{ margin: '-6px 2px 10px' }}
      >
        <p className="faint" style={{ fontSize: 10.5, margin: 0, lineHeight: 1.7 }}>
          {venue
            ? t('loan.rateSource', { chain: chainLabel(chain), at: readAt ? new Date(readAt).toLocaleTimeString() : '—' })
            : t('loan.chainUnsupported', { chain: chainLabel(chain) })}
        </p>
        {venue && (
          <div className="row-between" style={{ gap: 8, marginTop: 4 }}>
            <UpdatedAgo at={readAt} t={t} />
            <DataStatusPill status={dataStatus} ageMs={snapshotAgeMs} t={t} testId="loan-rate-source-status" />
          </div>
        )}
      </motion.div>}

      {/* ── Tab body ─────────────────────────────────────────────────────
          2026-09-22: every tab is keyed by the market it renders. The forms
          used to keep their selected asset (and the borrow form its collateral
          and amounts) across chain switches, so Arbitrum-USDT evaluated on
          Base fell through to a bare «✕ TOKEN_NOT_ALLOWED» with no recovery.
          A market change now remounts the form with a clean selection; the
          evaluateAction chain guard stays as the second layer. */}
      {chain !== SOLANA_LENDING_CHAIN_ID && <AnimatePresence mode="wait">
        {tab === 'supply' && (
          <motion.div key={`supply-${chain}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
            <SupplyTab key={`supply-form-${chain}`} market={market} t={t} haptic={haptic} notify={notify} onExecute={openExecution} preset={preset} />
          </motion.div>
        )}
        {tab === 'borrow' && (
          <motion.div key={`borrow-${chain}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
            <BorrowTab key={`borrow-form-${chain}`} market={market} t={t} haptic={haptic} notify={notify} onExecute={openExecution} preset={preset} />
          </motion.div>
        )}
        {tab === 'positions' && (
          <motion.div key={`positions-${chain}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
            <PositionsTab
              key={`positions-form-${chain}`}
              market={market} t={t} haptic={haptic} notify={notify}
              onExecute={openExecution} onCollateral={toggleCollateral} history={historyRef.current}
            />
          </motion.div>
        )}
      </AnimatePresence>}

      {chain !== SOLANA_LENDING_CHAIN_ID && <motion.div variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 6 }}>
        <HowItWorks t={t} />
      </motion.div>}

      {chain !== SOLANA_LENDING_CHAIN_ID && <motion.div variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 2 }}>
        <InfoBox title={t('loan.riskTitle')} tone="danger" id="loan-risk-global">
          <p>{t('loan.riskBody')}</p>
          <p style={{ marginTop: 6 }}>{t('loan.riskBody2')}</p>
        </InfoBox>
      </motion.div>}

      <ExecutionSheet
        exec={exec}
        asset={exec?.asset}
        machine={machineView}
        onConfirm={confirmExecution}
        onCancel={() => { machineRef.current = null; setMachineView(null); setExec(null); }}
        onDone={() => { machineRef.current = null; setMachineView(null); setExec(null); setTab('positions'); }}
        onRetry={retryExecution}
        t={t}
        lang={i18n.language}
      />

      <WalletConnectSheet open={walletOpen} onClose={() => setWalletOpen(false)} />
    </PageTransition>
  );
}

/* Kept for the probes and for any caller that needs the raw unit helpers. */
export { toUnits as loanToUnits, fromUnits as loanFromUnits };
