import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import { useWallet } from '../context/WalletContext';
import { useAppStore } from '../store/useAppStore';
import { useTelegram } from '../context/TelegramContext';
import {
  IconShield,
  IconTrend,
  IconSwap,
  IconChevronRight,
  IconChevronLeft,
  IconCheck,
  IconX
} from '../components/Icons';

/* ─── CONSTANTS ─────────────────────────────────────────────────────────── */

/**
 * Supported lending markets — all routed through our own proxy/server.
 * No external links leave this component.
 *
 * APYs are NEVER hardcoded. UI shows "live rate" or "unavailable".
 * collateralRatio: loan-to-value as %, e.g. 75 means borrow up to 75% of collateral.
 */
const SUPPLY_ASSETS = [
  { id: 'usdt',  symbol: 'USDT', name: 'Tether USD',     chain: 1,     color: 'var(--rgb-2)', risk: 'low' },
  { id: 'usdc',  symbol: 'USDC', name: 'USD Coin',        chain: 1,     color: 'var(--rgb-1)', risk: 'low' },
  { id: 'eth',   symbol: 'ETH',  name: 'Ethereum',        chain: 1,     color: 'var(--rgb-8)', risk: 'medium' },
  { id: 'wbtc',  symbol: 'WBTC', name: 'Wrapped Bitcoin', chain: 1,     color: 'var(--rgb-5)', risk: 'medium' },
  { id: 'bnb',   symbol: 'BNB',  name: 'BNB',             chain: 56,    color: 'var(--rgb-4)', risk: 'medium' },
  { id: 'usdt56',symbol: 'USDT', name: 'Tether (BNB)',    chain: 56,    color: 'var(--rgb-2)', risk: 'low' },
];

const BORROW_ASSETS = [
  { id: 'usdt',  symbol: 'USDT', name: 'Tether USD',     chain: 1,  collateralRatio: 80, color: 'var(--rgb-2)' },
  { id: 'usdc',  symbol: 'USDC', name: 'USD Coin',        chain: 1,  collateralRatio: 80, color: 'var(--rgb-1)' },
  { id: 'eth',   symbol: 'ETH',  name: 'Ethereum',        chain: 1,  collateralRatio: 75, color: 'var(--rgb-8)' },
  { id: 'bnb',   symbol: 'BNB',  name: 'BNB',             chain: 56, collateralRatio: 70, color: 'var(--rgb-4)' },
];

/* ─── MOCK RATES ─────────────────────────────────────────────────────────── */
/**
 * Live rates would be fetched from /api/loan/rates.
 * Until that route exists we show "unavailable" rather than a frozen number.
 * This stub resolves to null (unknown) after a brief delay.
 */
async function fetchLoanRates() {
  try {
    const r = await fetch('/api/loan/rates', { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    return r.json();
  } catch {
    return null;
  }
}

/* ─── HELPERS ────────────────────────────────────────────────────────────── */
function riskBadge(risk, t) {
  if (risk === 'low')    return <span className="pill pill-neutral" style={{ fontSize: 10.5 }}>{t('invest.risk.low')}</span>;
  if (risk === 'medium') return <span className="pill pill-rgb"     style={{ fontSize: 10.5 }}>{t('invest.risk.medium')}</span>;
  return                        <span className="pill"              style={{ fontSize: 10.5 }}>{t('invest.risk.high')}</span>;
}

function chainBadge(chainId) {
  const map = { 1: 'ETH', 56: 'BNB', 42161: 'ARB', 8453: 'BASE' };
  const label = map[chainId] || `#${chainId}`;
  return (
    <span className="pill pill-neutral" style={{ fontSize: 10, fontFamily: 'var(--font-mono)' }}>
      {label}
    </span>
  );
}

/* ─── SUB-COMPONENTS ─────────────────────────────────────────────────────── */

/** Live APY display — shows spinner then rate or dash */
function AprBadge({ rates, assetId, side }) {
  if (!rates) return <span className="faint" style={{ fontSize: 11 }}>—</span>;
  const val = rates?.[assetId]?.[side];
  if (val == null) return <span className="faint" style={{ fontSize: 11 }}>—</span>;
  const formatted = typeof val === 'number' ? `${val.toFixed(2)}%` : String(val);
  return (
    <span className="pill pill-up" style={{ fontSize: 11 }}>
      {side === 'supply' ? '+' : ''}{formatted}
    </span>
  );
}

/** Confirmation modal for supply or borrow action */
function ConfirmModal({ action, asset, amount, onConfirm, onCancel, t }) {
  const isSupply = action === 'supply';
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      transition={{ duration: 0.22 }}
      className="card"
      style={{
        position: 'fixed', bottom: 80, left: 12, right: 12, zIndex: 200,
        background: 'rgba(18,18,24,0.97)', backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.10)',
        borderRadius: 20, padding: 20, boxShadow: '0 16px 48px rgba(0,0,0,0.4)'
      }}
    >
      <div className="row-between" style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>
          {isSupply ? t('loan.confirmSupplyTitle') : t('loan.confirmBorrowTitle')}
        </div>
        <button className="icon-btn" onClick={onCancel} aria-label={t('common.cancel')}>
          <IconX width={15} height={15} />
        </button>
      </div>

      <div className="stack" style={{ gap: 8, marginBottom: 16 }}>
        <div className="row-between">
          <span className="faint" style={{ fontSize: 13 }}>{t('loan.asset')}</span>
          <span style={{ fontWeight: 700 }}>{asset?.symbol}</span>
        </div>
        <div className="row-between">
          <span className="faint" style={{ fontSize: 13 }}>{t('loan.amount')}</span>
          <span style={{ fontWeight: 700 }}>{amount || '—'}</span>
        </div>
        <div className="row-between">
          <span className="faint" style={{ fontSize: 13 }}>{t('loan.action')}</span>
          <span style={{ fontWeight: 700, color: isSupply ? 'var(--rgb-1)' : 'var(--rgb-3)' }}>
            {isSupply ? t('loan.supply') : t('loan.borrow')}
          </span>
        </div>
      </div>

      <InfoBox title={t('loan.walletSignRequired')} tone="info" id="loan-confirm-info">
        <p style={{ fontSize: 12.5 }}>{t('loan.walletSignBody')}</p>
      </InfoBox>

      <div className="btn-row" style={{ marginTop: 14 }}>
        <button className="btn btn-primary" onClick={onConfirm}>
          <IconCheck width={14} height={14} style={{ marginInlineEnd: 6 }} />
          {t('common.confirm')}
        </button>
        <button className="btn btn-ghost btn-row-minor" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </motion.div>
  );
}

/* ─── SUPPLY TAB ─────────────────────────────────────────────────────────── */
function SupplyTab({ rates, ratesLoading, t, haptic, notify }) {
  const [selected, setSelected] = useState(null);
  const [amount, setAmount]   = useState('');
  const [confirm, setConfirm] = useState(false);
  const { address } = useWallet?.() || {};

  const handleSubmit = () => {
    if (!address) { notify('loan.connectWalletFirst', 'error'); return; }
    if (!amount || Number(amount) <= 0) { notify('loan.enterAmount', 'error'); return; }
    setConfirm(true);
  };

  const handleConfirm = () => {
    setConfirm(false);
    // Real implementation: call /api/loan/supply → server proxies to Morpho/Aave
    // For now: user is shown intent-OS to build the tx themselves
    notify('loan.openIntentForSupply', 'success');
    setAmount('');
    setSelected(null);
  };

  return (
    <>
      <motion.section className="card" variants={riseIn} initial="hidden" animate="show"
        style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 16, border: '1px solid rgba(255,255,255,0.08)', padding: 16, marginBottom: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 6 }}>
          {t('loan.supplySubtitle')}
        </div>
        <p className="prose-sm" style={{ lineHeight: 1.75 }}>{t('loan.supplyDesc')}</p>
      </motion.section>

      <p className="section-label">{t('loan.chooseAsset')}</p>
      <motion.div className="stack" style={{ gap: 9 }} variants={stagger} initial="hidden" animate="show">
        {SUPPLY_ASSETS.map(a => (
          <motion.div
            key={a.id + a.chain}
            className={`card ${selected?.id === a.id && selected?.chain === a.chain ? 'card-selected' : ''}`}
            variants={riseIn}
            style={{
              padding: 14, borderRadius: 16, cursor: 'pointer',
              background: selected?.id === a.id && selected?.chain === a.chain
                ? `rgba(${a.color.replace('var(--rgb-','').replace(')','')}, 0.10)`
                : 'rgba(255,255,255,0.05)',
              border: selected?.id === a.id && selected?.chain === a.chain
                ? `1px solid ${a.color}55` : '1px solid rgba(255,255,255,0.08)',
              transition: 'all 0.18s'
            }}
            onClick={() => { haptic?.('select'); setSelected(a); }}
          >
            <div className="row-between">
              <div className="row" style={{ gap: 12 }}>
                <span style={{
                  width: 36, height: 36, borderRadius: 11, display: 'grid', placeItems: 'center',
                  background: `linear-gradient(135deg, ${a.color}22, transparent)`,
                  border: `1px solid ${a.color}33`, color: a.color, fontWeight: 800, fontSize: 13
                }}>
                  {a.symbol.slice(0, 2)}
                </span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{a.symbol}</div>
                  <div className="faint" style={{ fontSize: 11.5 }}>{a.name}</div>
                </div>
              </div>
              <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                {chainBadge(a.chain)}
                {riskBadge(a.risk, t)}
                {ratesLoading
                  ? <span className="spinner" style={{ width: 12, height: 12 }} />
                  : <AprBadge rates={rates} assetId={a.id} side="supply" />
                }
              </div>
            </div>
          </motion.div>
        ))}
      </motion.div>

      {selected && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card"
          style={{ marginTop: 12, borderRadius: 16, padding: 16, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <p style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>
            {t('loan.supplyAmount', { symbol: selected.symbol })}
          </p>
          <input
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            className="input"
            placeholder="0.00"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            style={{ marginBottom: 12 }}
          />
          <button className="btn btn-primary" onClick={handleSubmit}>
            {t('loan.supplyBtn', { symbol: selected.symbol })}
          </button>
        </motion.div>
      )}

      <AnimatePresence>
        {confirm && (
          <ConfirmModal
            action="supply" asset={selected} amount={amount}
            onConfirm={handleConfirm} onCancel={() => setConfirm(false)} t={t}
          />
        )}
      </AnimatePresence>
    </>
  );
}

/* ─── BORROW TAB ─────────────────────────────────────────────────────────── */
function BorrowTab({ rates, ratesLoading, t, haptic, notify }) {
  const [selected, setSelected] = useState(null);
  const [amount, setAmount]     = useState('');
  const [collateral, setCollateral] = useState('');
  const [confirm, setConfirm]   = useState(false);
  const { address } = useWallet?.() || {};
  const navigate = useNavigate();

  const maxBorrow = selected && collateral
    ? ((Number(collateral) * selected.collateralRatio) / 100).toFixed(4)
    : null;

  const handleSubmit = () => {
    if (!address) { notify('loan.connectWalletFirst', 'error'); return; }
    if (!collateral || Number(collateral) <= 0) { notify('loan.enterCollateral', 'error'); return; }
    if (!amount || Number(amount) <= 0) { notify('loan.enterAmount', 'error'); return; }
    if (maxBorrow && Number(amount) > Number(maxBorrow)) { notify('loan.overMaxBorrow', 'error'); return; }
    setConfirm(true);
  };

  const handleConfirm = () => {
    setConfirm(false);
    // Real: POST /api/loan/borrow → server validates + routes to Morpho/Aave
    // Bridge to IntentOS so the user signs themselves
    navigate('/intent?tab=default&hint=loan-borrow');
    notify('loan.openIntentForBorrow', 'success');
  };

  return (
    <>
      <motion.section className="card" variants={riseIn} initial="hidden" animate="show"
        style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 16, border: '1px solid rgba(255,255,255,0.08)', padding: 16, marginBottom: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 6 }}>{t('loan.borrowSubtitle')}</div>
        <p className="prose-sm" style={{ lineHeight: 1.75 }}>{t('loan.borrowDesc')}</p>
      </motion.section>

      <p className="section-label">{t('loan.chooseBorrowAsset')}</p>
      <motion.div className="stack" style={{ gap: 9 }} variants={stagger} initial="hidden" animate="show">
        {BORROW_ASSETS.map(a => (
          <motion.div
            key={a.id + a.chain}
            className="card"
            variants={riseIn}
            style={{
              padding: 14, borderRadius: 16, cursor: 'pointer',
              background: selected?.id === a.id && selected?.chain === a.chain
                ? `${a.color}11` : 'rgba(255,255,255,0.05)',
              border: selected?.id === a.id && selected?.chain === a.chain
                ? `1px solid ${a.color}55` : '1px solid rgba(255,255,255,0.08)',
              transition: 'all 0.18s'
            }}
            onClick={() => { haptic?.('select'); setSelected(a); setAmount(''); setCollateral(''); }}
          >
            <div className="row-between">
              <div className="row" style={{ gap: 11 }}>
                <span style={{
                  width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center',
                  background: `linear-gradient(135deg, ${a.color}22, transparent)`,
                  border: `1px solid ${a.color}33`, color: a.color, fontWeight: 800, fontSize: 12
                }}>
                  {a.symbol.slice(0, 2)}
                </span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{a.symbol}</div>
                  <div className="faint" style={{ fontSize: 11.5 }}>{t('loan.collateralRatio', { pct: a.collateralRatio })}</div>
                </div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                {chainBadge(a.chain)}
                {ratesLoading
                  ? <span className="spinner" style={{ width: 12, height: 12 }} />
                  : <AprBadge rates={rates} assetId={a.id} side="borrow" />
                }
              </div>
            </div>
          </motion.div>
        ))}
      </motion.div>

      {selected && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card"
          style={{ marginTop: 12, borderRadius: 16, padding: 16, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <p style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>
            {t('loan.collateralLabel', { symbol: selected.symbol })}
          </p>
          <input
            type="number" min="0" step="any" inputMode="decimal" className="input"
            placeholder="0.00" value={collateral}
            onChange={e => setCollateral(e.target.value)}
            style={{ marginBottom: 4 }}
          />
          {maxBorrow && (
            <p className="faint" style={{ fontSize: 11.5, marginBottom: 10 }}>
              {t('loan.maxBorrowNote', { max: maxBorrow, symbol: selected.symbol, pct: selected.collateralRatio })}
            </p>
          )}
          <p style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>
            {t('loan.borrowAmountLabel', { symbol: selected.symbol })}
          </p>
          <input
            type="number" min="0" step="any" inputMode="decimal" className="input"
            placeholder="0.00" value={amount}
            onChange={e => setAmount(e.target.value)}
            style={{ marginBottom: 12 }}
          />
          <button className="btn btn-primary" onClick={handleSubmit}>
            {t('loan.borrowBtn', { symbol: selected.symbol })}
          </button>
        </motion.div>
      )}

      <AnimatePresence>
        {confirm && (
          <ConfirmModal
            action="borrow" asset={selected} amount={amount}
            onConfirm={handleConfirm} onCancel={() => setConfirm(false)} t={t}
          />
        )}
      </AnimatePresence>
    </>
  );
}

/* ─── MY POSITIONS TAB ───────────────────────────────────────────────────── */
function PositionsTab({ t, haptic, navigate }) {
  return (
    <motion.section className="card" variants={riseIn} initial="hidden" animate="show"
      style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 16, border: '1px solid rgba(255,255,255,0.08)', padding: 20 }}>
      <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 8 }}>{t('loan.positionsTitle')}</div>
      <p className="prose-sm" style={{ lineHeight: 1.8 }}>{t('loan.positionsBody')}</p>
      <div className="btn-row" style={{ marginTop: 14 }}>
        <button className="btn btn-ghost" onClick={() => { haptic?.('light'); navigate('/intent'); }}>
          {t('loan.openIntentOS')}
          <IconChevronRight width={14} height={14} style={{ marginInlineStart: 4 }} />
        </button>
        <button className="btn btn-ghost btn-row-minor" onClick={() => { haptic?.('light'); navigate('/wallet'); }}>
          {t('loan.openWallet')}
        </button>
      </div>
    </motion.section>
  );
}

/* ─── MAIN PAGE ──────────────────────────────────────────────────────────── */
export default function Loan() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();
  const notify = useAppStore(s => s.notify);

  const [tab, setTab] = useState('supply'); // 'supply' | 'borrow' | 'positions'
  const [rates, setRates] = useState(null);
  const [ratesLoading, setRatesLoading] = useState(true);

  // Fetch live rates once on mount
  useEffect(() => {
    let alive = true;
    setRatesLoading(true);
    fetchLoanRates().then(data => {
      if (alive) { setRates(data); setRatesLoading(false); }
    });
    return () => { alive = false; };
  }, []);

  const TABS = [
    { id: 'supply',    label: t('loan.tabSupply') },
    { id: 'borrow',    label: t('loan.tabBorrow') },
    { id: 'positions', label: t('loan.tabPositions') },
  ];

  const notifyHelper = useCallback((key, tone) => {
    notify(key, tone);
  }, [notify]);

  return (
    <PageTransition>
      {/* Header */}
      <motion.div className="row" style={{ gap: 10, marginBottom: 4 }} variants={riseIn} initial="hidden" animate="show">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconChevronLeft width={18} height={18} />
        </button>
        <div>
          <h1 className="h1" style={{ margin: 0, fontSize: 19 }}>{t('loan.pageTitle')}</h1>
          <p className="faint" style={{ fontSize: 12, marginTop: 2 }}>{t('loan.pageSubtitle')}</p>
        </div>
      </motion.div>

      {/* Headline card */}
      <motion.section variants={riseIn} initial="hidden" animate="show"
        className="card"
        style={{
          background: 'linear-gradient(135deg, rgba(var(--rgb-1-raw),0.12), rgba(var(--rgb-4-raw),0.08))',
          backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
          border: '1px solid rgba(255,255,255,0.09)', borderRadius: 18, padding: 18, marginBottom: 4
        }}>
        <div className="row" style={{ gap: 12, marginBottom: 10 }}>
          <span style={{ width: 40, height: 40, borderRadius: 13, display: 'grid', placeItems: 'center',
            background: 'linear-gradient(135deg, var(--rgb-1), var(--rgb-4))', color: '#fff', fontSize: 18 }}>
            ⚖️
          </span>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15 }}>{t('loan.heroTitle')}</div>
            <div className="faint" style={{ fontSize: 12 }}>{t('loan.heroSub')}</div>
          </div>
        </div>

        {/* Three stat pills */}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 0', minWidth: 80, padding: '8px 10px', borderRadius: 12,
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', textAlign: 'center' }}>
            <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--rgb-1)' }}>
              {t('loan.nonCustodial')}
            </div>
            <div className="faint" style={{ fontSize: 10.5 }}>{t('loan.nonCustodialSub')}</div>
          </div>
          <div style={{ flex: '1 1 0', minWidth: 80, padding: '8px 10px', borderRadius: 12,
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', textAlign: 'center' }}>
            <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--rgb-2)' }}>
              {t('loan.fbtFee')}
            </div>
            <div className="faint" style={{ fontSize: 10.5 }}>{t('loan.fbtFeeSub')}</div>
          </div>
          <div style={{ flex: '1 1 0', minWidth: 80, padding: '8px 10px', borderRadius: 12,
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', textAlign: 'center' }}>
            <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--rgb-4)' }}>
              {t('loan.noKyc')}
            </div>
            <div className="faint" style={{ fontSize: 10.5 }}>{t('loan.noKycSub')}</div>
          </div>
        </div>
      </motion.section>

      {/* Tabs */}
      <div className="segmented" style={{ marginTop: 8 }}>
        {TABS.map(tb => (
          <button key={tb.id} className={tab === tb.id ? 'active' : ''}
            onClick={() => { haptic?.('select'); setTab(tb.id); }}>
            {tb.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        {tab === 'supply' && (
          <motion.div key="supply"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}>
            <SupplyTab rates={rates} ratesLoading={ratesLoading} t={t} haptic={haptic} notify={notifyHelper} />
          </motion.div>
        )}
        {tab === 'borrow' && (
          <motion.div key="borrow"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}>
            <BorrowTab rates={rates} ratesLoading={ratesLoading} t={t} haptic={haptic} notify={notifyHelper} />
          </motion.div>
        )}
        {tab === 'positions' && (
          <motion.div key="positions"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}>
            <PositionsTab t={t} haptic={haptic} navigate={navigate} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* How it works */}
      <motion.section variants={riseIn} initial="hidden" animate="show"
        className="card"
        style={{ marginTop: 4, background: 'rgba(255,255,255,0.04)', borderRadius: 16,
          border: '1px solid rgba(255,255,255,0.07)', padding: 16 }}>
        <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 10 }}>{t('loan.howTitle')}</div>
        <div className="stack" style={{ gap: 10 }}>
          {[
            { icon: '🔒', key: 'step1' },
            { icon: '📈', key: 'step2' },
            { icon: '⚖️', key: 'step3' },
            { icon: '💸', key: 'step4' },
          ].map(s => (
            <div key={s.key} className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 18, flexShrink: 0 }}>{s.icon}</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{t(`loan.${s.key}Title`)}</div>
                <p className="prose-sm" style={{ marginTop: 2, lineHeight: 1.7 }}>{t(`loan.${s.key}Body`)}</p>
              </div>
            </div>
          ))}
        </div>
      </motion.section>

      {/* Risk disclaimer — always present */}
      <InfoBox title={t('loan.riskTitle')} tone="danger" id="loan-risk">
        <p>{t('loan.riskBody')}</p>
        <p style={{ marginTop: 6 }}>{t('loan.riskBody2')}</p>
      </InfoBox>

      {/* Architecture note */}
      <InfoBox title={t('loan.archTitle')} tone="info" id="loan-arch">
        <p>{t('loan.archBody')}</p>
      </InfoBox>
    </PageTransition>
  );
}
