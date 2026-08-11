import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import SegIndicator from '../components/SegIndicator';
import Sheet from '../components/Sheet';
import WalletConnectSheet from '../components/WalletConnectSheet';
import { IconExternal, IconShield, IconTrend } from '../components/Icons';
import { useWallet, shortAddress } from '../context/WalletContext';
import { useTelegram } from '../context/TelegramContext';
import { useSettingsStore } from '../store/useSettingsStore';
import { fmtPrice, fmtUsd } from '../lib/format';
import '../styles/derivatives-glass.css';
import {
  MIN_COLLATERAL_USD,
  OSTIUM_CHAIN_ID,
  OSTIUM_COLLATERAL,
  OSTIUM_SPENDER,
  buildApproveCollateral,
  buildOpenTrade,
  buildCloseTrade,
  buildModifyPosition,
  buildUpdateCollateral,
  getOstiumMarkets,
  getOstiumPositions,
  tradeCosts,
  validateTrade
} from '../lib/ostium';

const CATEGORY_ORDER = ['Commodities', 'Forex', 'Stocks', 'Indices', 'ETFs', 'Crypto'];
const friendlyCategory = (raw) => {
  const v = String(raw || '').toLowerCase();
  if (v.includes('commod')) return 'Commodities';
  if (v.includes('forex') || v.includes('fx')) return 'Forex';
  if (v.includes('stock') || v.includes('equit')) return 'Stocks';
  if (v.includes('indice') || v.includes('index')) return 'Indices';
  if (v.includes('etf')) return 'ETFs';
  if (v.includes('crypto')) return 'Crypto';
  return 'Other';
};

// توضیح هر دسته برای پاپ‌آپ «هر دسته چیست؟»
const CATEGORY_HELP = [
  { id: 'Commodities', fa: 'کالا', icon: '◈', desc: 'طلا، نقره، نفت و فلزات — دارایی‌های فیزیکی با قیمت جهانی. برای حفظ ارزش و تنوع.' },
  { id: 'Forex', fa: 'فارکس', icon: '◎', desc: 'جفت‌ارزها مثل EUR/USD و GBP/JPY — معاملهٔ نرخ برابری ارزهای جهانی.' },
  { id: 'Stocks', fa: 'سهام', icon: '⬡', desc: 'سهام شرکت‌های بزرگ آمریکا مثل اپل و تسلا — به شکل پرپچوال با تسویه USDC.' },
  { id: 'Indices', fa: 'شاخص', icon: '▭', desc: 'شاخص‌های بزرگ مثل S&P 500 و Nasdaq — یک نماد، یک سبد از صدها شرکت.' },
  { id: 'ETFs', fa: 'صندوق', icon: '⬣', desc: 'صندوق‌های قابل معامله (ETF) — مثل طلا یا اوراق، در یک نماد قابل معامله.' },
  { id: 'Crypto', fa: 'کریپتو', icon: '⬢', desc: 'کریپتوهای اصلی — با تسویه آنچین روی آربیتروم.' },
];

const displayError = (e) => {
  const msg = String(e?.shortMessage || e?.reason || e?.message || e || 'TX_FAILED');
  if (/rejected|denied|cancelled/i.test(msg)) return 'USER_REJECTED';
  if (/insufficient funds/i.test(msg)) return 'NO_GAS';
  return msg.length > 160 ? `${msg.slice(0, 157)}…` : msg;
};

export default function Ostium() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const wallet = useWallet();
  const { haptic } = useTelegram();
  const slippagePct = useSettingsStore((s) => s.defaultSlippage);

  const [markets, setMarkets] = useState([]);
  const [feedLive, setFeedLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('Commodities');
  const [pairId, setPairId] = useState('');
  const [marketSearch, setMarketSearch] = useState('');
  const [side, setSide] = useState('long');
  const [collateral, setCollateral] = useState('50');
  const [leverage, setLeverage] = useState('5');
  const [takeProfit, setTakeProfit] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [walletOpen, setWalletOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [txHash, setTxHash] = useState(null);
  const [account, setAccount] = useState({ balance: null, allowance: null });
  const [positions, setPositions] = useState({ positions: [], live: true });
  const [managing, setManaging] = useState(null);
  const [manageAction, setManageAction] = useState('close');
  const [manageValue, setManageValue] = useState('100');
  const [catHelpOpen, setCatHelpOpen] = useState(false);

  const loadMarkets = useCallback(async () => {
    setLoading(true);
    const data = await getOstiumMarkets();
    const rows = data.pairs.map((p) => ({ ...p, uiCategory: friendlyCategory(p.category) }));
    setMarkets(rows);
    setFeedLive(data.live);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadMarkets();
    const id = setInterval(loadMarkets, 20_000);
    return () => clearInterval(id);
  }, [loadMarkets]);

  const categories = useMemo(() => {
    const found = new Set(markets.map((m) => m.uiCategory));
    return [...CATEGORY_ORDER, 'Other'].filter((c) => found.has(c));
  }, [markets]);

  useEffect(() => {
    if (categories.length && !categories.includes(category)) setCategory(categories[0]);
  }, [categories, category]);

  const visible = useMemo(() => {
    let rows = markets.filter((m) => m.uiCategory === category);
    const q = marketSearch.trim().toLowerCase();
    if (q) rows = rows.filter((m) => String(m.name || '').toLowerCase().includes(q) || String(m.pairId || '').toLowerCase().includes(q));
    return rows;
  }, [markets, category, marketSearch]);

  useEffect(() => {
    if (visible.length && !visible.some((m) => m.pairId === pairId)) setPairId(visible[0].pairId);
  }, [visible, pairId]);

  const market = markets.find((m) => m.pairId === pairId) || visible[0];
  const effectiveMax = market?.isDayTradingClosed && market.overnightMaxLeverage > 0
    ? market.overnightMaxLeverage
    : market?.maxLeverage;

  useEffect(() => {
    if (effectiveMax && Number(leverage) > effectiveMax) setLeverage(String(effectiveMax));
  }, [effectiveMax, leverage]);

  const refreshAccount = useCallback(async () => {
    if (!wallet.address) {
      setAccount({ balance: null, allowance: null });
      return;
    }
    try {
      const { Contract, formatUnits } = await import('ethers');
      const provider = await wallet.getReadProvider(OSTIUM_CHAIN_ID);
      const usdc = new Contract(
        OSTIUM_COLLATERAL,
        ['function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)'],
        provider
      );
      const [bal, allowance] = await Promise.all([
        usdc.balanceOf(wallet.address),
        usdc.allowance(wallet.address, OSTIUM_SPENDER)
      ]);
      setAccount({ balance: Number(formatUnits(bal, 6)), allowance: Number(formatUnits(allowance, 6)) });
    } catch {
      setAccount({ balance: null, allowance: null });
    }
  }, [wallet.address, wallet.getReadProvider]);

  useEffect(() => {
    refreshAccount();
  }, [refreshAccount, wallet.chainId, txHash]);

  useEffect(() => {
    if (!wallet.address || !markets.length) return undefined;
    let alive = true;
    getOstiumPositions({ trader: wallet.address, markets }).then((p) => alive && setPositions(p));
    return () => { alive = false; };
  }, [wallet.address, markets, txHash]);

  const costs = useMemo(() => tradeCosts({
    collateralUsd: collateral,
    leverage,
    pairOpenFeeBps: market?.openFeeBps
  }), [collateral, leverage, market]);

  const validation = validateTrade({
    collateralUsd: collateral,
    leverage,
    maxLeverage: effectiveMax,
    isMarketOpen: Boolean(market?.isMarketOpen),
    chainId: wallet.isConnected ? wallet.chainId : null
  });
  const needsApproval = account.allowance != null && account.allowance + 1e-9 < Number(collateral || 0);
  const insufficientUsdc = account.balance != null && account.balance + 1e-9 < Number(collateral || 0);

  const riskPriceError = (reference = market?.mid) => {
    const px = Number(reference);
    const tp = takeProfit === '' ? 0 : Number(takeProfit);
    const sl = stopLoss === '' ? 0 : Number(stopLoss);
    if (!Number.isFinite(tp) || tp < 0 || !Number.isFinite(sl) || sl < 0) return 'BAD_RISK_PRICE';
    if (side === 'long' && ((tp > 0 && tp <= px) || (sl > 0 && sl >= px))) return 'BAD_LONG_RISK';
    if (side === 'short' && ((tp > 0 && tp >= px) || (sl > 0 && sl <= px))) return 'BAD_SHORT_RISK';
    return null;
  };

  const ensureChain = async () => {
    if (wallet.chainId === OSTIUM_CHAIN_ID) return true;
    const ok = await wallet.switchChain?.(OSTIUM_CHAIN_ID);
    if (!ok) throw new Error('WRONG_CHAIN');
    return true;
  };

  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      await ensureChain();
      const signer = wallet.getSigner?.();
      if (!signer) throw new Error('NO_SIGNER');
      const tx = await buildApproveCollateral({ amountUsd: collateral });
      const sent = await signer.sendTransaction({ to: tx.to, data: tx.data });
      await sent.wait();
      await refreshAccount();
      haptic?.('success');
    } catch (e) {
      setError(displayError(e));
      haptic?.('error');
    } finally {
      setBusy(false);
    }
  };

  const openReview = async () => {
    setError(null);
    if (!wallet.isConnected) return setWalletOpen(true);
    try {
      await ensureChain();
      /* Network switching is its own wallet action. Do not immediately open a
         review for a trade that still needs allowance; the next render turns
         the button into the explicit approval step. */
      if (needsApproval) return;
      if (account.balance == null || account.allowance == null) throw new Error('ACCOUNT_UNAVAILABLE');
      if (insufficientUsdc) throw new Error('INSUFFICIENT_USDC');
      const code = validateTrade({
        collateralUsd: collateral,
        leverage,
        maxLeverage: effectiveMax,
        isMarketOpen: Boolean(market?.isMarketOpen),
        chainId: OSTIUM_CHAIN_ID
      });
      if (code) throw new Error(code);
      const riskCode = riskPriceError();
      if (riskCode) throw new Error(riskCode);
      setConfirming(true);
    } catch (e) {
      setError(displayError(e));
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const latest = await getOstiumMarkets();
      const fresh = latest.pairs.find((p) => String(p.pairId) === String(market.pairId));
      if (!latest.live || !fresh || !fresh.isMarketOpen) throw new Error('MARKET_CLOSED');
      const riskCode = riskPriceError(fresh.mid);
      if (riskCode) throw new Error(riskCode);

      await ensureChain();
      const signer = wallet.getSigner?.();
      if (!signer) throw new Error('NO_SIGNER');
      const tx = await buildOpenTrade({
        trader: wallet.address,
        pairId: fresh.pairId,
        buy: side === 'long',
        price: String(fresh.mid),
        collateralUsd: collateral,
        leverage,
        takeProfit: takeProfit || '0',
        stopLoss: stopLoss || '0',
        slippageBps: Math.round(Number(slippagePct) * 100)
      });
      const sent = await signer.sendTransaction({ to: tx.to, data: tx.data });
      setTxHash(sent.hash);
      setConfirming(false);
      haptic?.('success');
    } catch (e) {
      setError(displayError(e));
      haptic?.('error');
    } finally {
      setBusy(false);
    }
  };

  const submitManagement = async () => {
    if (!managing) return;
    setBusy(true);
    setError(null);
    try {
      await ensureChain();
      const signer = wallet.getSigner?.();
      if (!signer) throw new Error('NO_SIGNER');
      let tx;
      if (manageAction === 'close') {
        const fresh = await getOstiumMarkets();
        const row = fresh.pairs.find((m) => String(m.pairId) === String(managing.pairId));
        if (!fresh.live || !row?.isMarketOpen) throw new Error('MARKET_CLOSED');
        tx = await buildCloseTrade({
          pairId: managing.pairId, index: managing.index, closePercent: manageValue,
          price: row.mid, slippageBps: Math.round(Number(slippagePct) * 100)
        });
      } else if (manageAction === 'tp') {
        tx = await buildModifyPosition({ pairId: managing.pairId, index: managing.index, takeProfit: manageValue });
      } else if (manageAction === 'sl') {
        tx = await buildModifyPosition({ pairId: managing.pairId, index: managing.index, stopLoss: manageValue });
      } else {
        tx = await buildUpdateCollateral({ pairId: managing.pairId, index: managing.index, amountUsd: manageValue });
        if (tx.needsApproval) {
          const approval = await buildApproveCollateral({ amountUsd: Math.abs(Number(manageValue)) });
          const approved = await signer.sendTransaction({ to: approval.to, data: approval.data });
          await approved.wait();
        }
      }
      const sent = await signer.sendTransaction({ to: tx.to, data: tx.data });
      setTxHash(sent.hash);
      setManaging(null);
      const refreshed = await getOstiumPositions({ trader: wallet.address, markets });
      setPositions(refreshed);
      haptic?.('success');
    } catch (e) {
      setError(displayError(e));
      haptic?.('error');
    } finally {
      setBusy(false);
    }
  };

  const buttonLabel = !wallet.isConnected
    ? t('ostium.connect')
    : wallet.chainId !== OSTIUM_CHAIN_ID
      ? t('ostium.switchNetwork')
      : needsApproval
        ? t('ostium.approve')
        : t('ostium.review');

  return (
    <PageTransition>
      <div className="derivatives-hall">
        <div className="derivatives-aurora" aria-hidden="true" />
        <motion.section className="derivatives-hero" variants={riseIn} initial="hidden" animate="show">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div className="derivatives-title">
                <span className="derivatives-title-glow">{t('ostium.title')}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', letterSpacing: 1 }}>• OSTIUM</span>
              </div>
              <p className="derivatives-subtitle">{t('ostium.subtitle')}</p>
            </div>
            <span className={`pill ${feedLive ? 'pill-up' : 'pill-down'}`} style={{ alignSelf: 'flex-start' }}>
              {feedLive ? t('ostium.live') : t('ostium.offline')}
            </span>
          </div>
        </motion.section>

        <motion.div variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 16 }}>
          <div className="glass-notice" style={{ borderColor: 'rgba(255,59,107,0.16)', background: 'rgba(255,59,107,0.08)' }}>{t('ostium.risk')}</div>
        </motion.div>

      <motion.section className="card card-rgb card-glow-cyan" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 18 }}>
        <div className="sheen" />
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <IconShield width={21} height={21} style={{ color: 'var(--rgb-1)', flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t('ostium.nonCustodialTitle')}</div>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>{t('ostium.nonCustodialBody')}</p>
          </div>
        </div>
      </motion.section>

      <div className="tag-scroll" style={{ gap: 8, paddingBottom: 2, marginTop: 16 }}>
        {categories.map((c) => (
          <button key={c} className={`tag ${category === c ? 'active' : ''}`} onClick={() => setCategory(c)}>
            {t(`ostium.category.${c.toLowerCase()}`, { defaultValue: c })}
          </button>
        ))}
        <button className="tag" onClick={() => setCatHelpOpen(true)} style={{ borderStyle: 'dashed', gap: 6 }}>
          <span style={{ fontSize: 12 }}>؟</span> هر دسته چیست؟
        </button>
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={marketSearch}
          onChange={(e) => setMarketSearch(e.target.value)}
          placeholder={`جستجوی جفت (مثلاً XAU, EURUSD, AAPL) — ${markets.length} بازار`}
          style={{ flex: 1, fontSize: 12.5 }}
        />
        {marketSearch && (
          <button className="tag" onClick={() => setMarketSearch('')}>پاک</button>
        )}
      </div>
      {visible.length === 0 && marketSearch && (
        <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>چیزی با «{marketSearch}» پیدا نشد — دسته را عوض کن یا جستجو را پاک کن.</p>
      )}

      <motion.section className="card" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 16, width: '100%', boxSizing: 'border-box' }}>
        {loading ? <div className="skel" style={{ height: 240 }} /> : !feedLive ? (
          <div className="empty">
            <span className="empty-icon">⌁</span>
            <p>{t('ostium.feedUnavailable')}</p>
            <button className="btn btn-ghost" onClick={loadMarkets}>{t('common.retry')}</button>
          </div>
        ) : (
          <>
            <label className="field-label">{t('ostium.market')}</label>
            <select value={market?.pairId || ''} onChange={(e) => setPairId(e.target.value)}>
              {visible.map((m) => <option key={m.pairId} value={m.pairId}>{m.name}</option>)}
            </select>

            {market && (
              <div className="row-between" style={{ margin: '12px 0' }}>
                <div>
                  <div className="faint">{t('ostium.midPrice')}</div>
                  <div className="stat-mini mono">${fmtPrice(market.mid)}</div>
                  <span className={`pill ${market.isMarketOpen ? 'pill-up' : 'pill-down'}`}>
                    {market.isMarketOpen ? t('ostium.marketOpen') : t('ostium.marketClosed')}
                  </span>
                </div>
                <div style={{ textAlign: 'end' }}>
                  <div className="faint">{t('ostium.spread')}</div>
                  <div className="mono" style={{ fontSize: 12 }}>${fmtPrice(market.bid)} — ${fmtPrice(market.ask)}</div>
                  <div className="faint" style={{ marginTop: 5 }}>{t('ostium.maxLeverage', { value: effectiveMax })}</div>
                </div>
              </div>
            )}

            <div className="segmented" style={{ marginBottom: 14 }}>
              {['long', 'short'].map((s) => (
                <button key={s} className={side === s ? 'active' : ''} onClick={() => setSide(s)} style={{ isolation: 'isolate' }}>
                  {side === s && <SegIndicator id="ostium-side" />}
                  {t(`ostium.${s}`)}
                </button>
              ))}
            </div>

            <div className="row" style={{ gap: 10 }}>
              <label style={{ flex: 1 }}>
                <span className="field-label">{t('ostium.collateral')}</span>
                <input type="number" min={MIN_COLLATERAL_USD} inputMode="decimal" value={collateral} onChange={(e) => setCollateral(e.target.value)} />
              </label>
              <label style={{ flex: 1 }}>
                <span className="field-label">{t('ostium.leverage')}</span>
                <input type="number" min="1" max={effectiveMax || 200} step="0.25" inputMode="decimal" value={leverage} onChange={(e) => setLeverage(e.target.value)} />
              </label>
            </div>
            <input
              type="range" min="1" max={effectiveMax || 200} step="0.25" value={Math.min(Number(leverage) || 1, effectiveMax || 200)}
              onChange={(e) => setLeverage(e.target.value)} style={{ width: '100%', marginTop: 8, accentColor: 'var(--rgb-1)' }}
            />

            <InfoBox title={t('ostium.riskControls')} tone="info" id="ostium-controls">
              <div className="row" style={{ gap: 10 }}>
                <label style={{ flex: 1 }}>
                  <span className="faint">{t('ostium.takeProfit')}</span>
                  <input type="number" min="0" inputMode="decimal" placeholder="0" value={takeProfit} onChange={(e) => setTakeProfit(e.target.value)} />
                </label>
                <label style={{ flex: 1 }}>
                  <span className="faint">{t('ostium.stopLoss')}</span>
                  <input type="number" min="0" inputMode="decimal" placeholder="0" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} />
                </label>
              </div>
              <p>{t('ostium.slippage', { value: slippagePct })}</p>
            </InfoBox>

            {costs && (
              <div className="brg-quote" style={{ marginTop: 12 }}>
                <div className="row-between"><span className="faint">{t('ostium.notional')}</span><span className="mono">{fmtUsd(costs.notional)}</span></div>
                <div className="row-between"><span className="faint">{t('ostium.protocolFee')}</span><span className="mono">{fmtUsd(costs.venueFee)}</span></div>
                <div className="row-between"><span className="faint">{t('ostium.builderFee')}</span><span className="mono">{fmtUsd(costs.ourFee)}</span></div>
                <div className="row-between"><span className="faint">{t('ostium.oracleFee')}</span><span className="mono">{fmtUsd(costs.oracleFee)}</span></div>
                <div className="row-between"><strong>{t('ostium.totalOpeningCost')}</strong><strong className="mono">{fmtUsd(costs.totalFee)}</strong></div>
                <p className="faint" style={{ margin: '7px 0 0' }}>
                  {t('ostium.feeHonesty', { pct: costs.ourFeePctOfCollateral.toFixed(2) })}
                </p>
              </div>
            )}

            {wallet.isConnected && (
              <div className="row-between" style={{ marginTop: 12 }}>
                <span className="faint">{shortAddress(wallet.address)} · Arbitrum</span>
                <span className="mono" style={{ fontSize: 12 }}>{account.balance == null ? '—' : `${account.balance.toFixed(2)} USDC`}</span>
              </div>
            )}
            {insufficientUsdc && <p className="notice notice-danger" style={{ marginTop: 9 }}>{t('ostium.insufficientUsdc')}</p>}
            {validation && wallet.chainId === OSTIUM_CHAIN_ID && validation !== 'WRONG_CHAIN' && (
              <p className="notice notice-danger" style={{ marginTop: 9 }}>{t(`ostium.err.${validation}`)}</p>
            )}
            {error && <p className="notice notice-danger" style={{ marginTop: 9 }}>{t(`ostium.err.${error}`, { defaultValue: error })}</p>}

            <button
              className={`btn ${side === 'long' ? 'btn-success' : 'btn-danger'}`}
              style={{ width: '100%', marginTop: 12 }} disabled={busy || !feedLive || insufficientUsdc}
              onClick={needsApproval && wallet.chainId === OSTIUM_CHAIN_ID ? approve : openReview}
            >
              {busy ? t('common.loading') : buttonLabel}
            </button>
            <p className="faint" style={{ marginTop: 7 }}>{t('ostium.exactApproval')}</p>
          </>
        )}
      </motion.section>

      {txHash && (
        <div className="notice" style={{ marginTop: 16 }}>
          <strong>{t('ostium.submitted')}</strong>
          <a className="row" style={{ gap: 6, marginTop: 7 }} href={`https://arbiscan.io/tx/${txHash}`} target="_blank" rel="noopener noreferrer">
            {t('ostium.viewTransaction')} <IconExternal width={14} height={14} />
          </a>
        </div>
      )}

      {wallet.isConnected && (
        <section style={{ marginTop: 18 }}>
          <div className="row-between" style={{ marginBottom: 10 }}>
            <p className="section-label">{t('ostium.positions')}</p>
            <button className="tag" onClick={() => getOstiumPositions({ trader: wallet.address, markets }).then(setPositions)}>{t('common.refresh')}</button>
          </div>
          {!positions.live ? <p className="notice">{t('ostium.positionsUnavailable')}</p> : positions.positions.length === 0 ? (
            <div className="empty"><IconTrend width={28} height={28} /><p>{t('ostium.noPositions')}</p></div>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              {positions.positions.map((p) => (
                <div key={p.id} className="card card-tight">
                  <div className="row-between">
                    <div><strong>{p.name}</strong> <span className={`pill ${p.buy ? 'pill-up' : 'pill-down'}`}>{t(`ostium.${p.buy ? 'long' : 'short'}`)}</span></div>
                    <span className="mono">{p.leverage}×</span>
                  </div>
                  <div className="row-between" style={{ marginTop: 7 }}><span className="faint">{t('ostium.collateral')}</span><span className="mono">{fmtUsd(p.collateral)}</span></div>
                  <div className="row-between"><span className="faint">{t('ostium.entryCurrent')}</span><span className="mono">${fmtPrice(p.entryPrice)} / {p.currentPrice ? `$${fmtPrice(p.currentPrice)}` : '—'}</span></div>
                  <button className="btn btn-ghost btn-sm" style={{ marginTop: 9 }} onClick={() => { setManaging(p); setManageAction('close'); setManageValue('100'); }}>
                    {t('ostium.manage')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <div style={{ marginTop: 18 }}><InfoBox title={t('ostium.whatYouTrade')} tone="warn" id="ostium-product">
        <p>{t('ostium.derivativeNotice')}</p>
        <p>{t('ostium.rolloverNotice')}</p>
      </InfoBox></div>

      <button
        className="btn btn-ghost"
        onClick={() => navigate('/swap?chain=42161&to=USDC')}
        style={{ width: '100%', marginTop: 16, boxSizing: 'border-box' }}
      >
        {t('ostium.getUsdc')}
      </button>

      <Sheet open={Boolean(managing)} onClose={() => !busy && setManaging(null)} title={t('ostium.manageTitle')}>
        {managing && <>
          <div className="card card-tight"><div className="row-between"><strong>{managing.name}</strong><span className="mono">{managing.leverage}×</span></div></div>
          <div className="segmented" style={{ marginTop: 10 }}>
            {['close', 'tp', 'sl', 'collateral'].map((a) => <button key={a} className={manageAction === a ? 'active' : ''} onClick={() => { setManageAction(a); setManageValue(a === 'close' ? '100' : ''); }}>{t(`ostium.manageAction.${a}`)}</button>)}
          </div>
          <label className="field-label" style={{ marginTop: 12 }}>{t(`ostium.manageField.${manageAction}`)}</label>
          <input type="number" inputMode="decimal" value={manageValue} onChange={(e) => setManageValue(e.target.value)} placeholder={manageAction === 'collateral' ? t('ostium.collateralHint') : '0'} />
          <p className="notice notice-danger" style={{ marginTop: 10 }}>{t('ostium.manageRisk')}</p>
          {error && <p className="notice notice-danger">{t(`ostium.err.${error}`, { defaultValue: error })}</p>}
          <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={busy || !manageValue} onClick={submitManagement}>{busy ? t('common.loading') : t('common.confirm')}</button>
        </>}
      </Sheet>

      <WalletConnectSheet open={walletOpen} onClose={() => setWalletOpen(false)} />

      {/* پاپ‌آپ توضیح دسته‌ها — کالا، فارکس، سهام، صندوق، کریپتو */}
      <Sheet open={catHelpOpen} onClose={() => setCatHelpOpen(false)} title="هر دسته چیست؟">
        <div className="stack" style={{ gap: 10 }}>
          {CATEGORY_HELP.map((c) => (
            <div key={c.id} className="card card-tight" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', width: '100%', boxSizing: 'border-box' }}>
              <span style={{ width: 34, height: 34, display: 'grid', placeItems: 'center', borderRadius: 10, background: 'rgba(255,255,255,0.06)', border: '1px solid var(--line)', fontSize: 14, flexShrink: 0 }}>{c.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 13.5 }}>{c.fa} <span className="faint" style={{ fontWeight: 600, fontSize: 11 }}>• {c.id}</span></div>
                <p className="muted" style={{ margin: '4px 0 0', fontSize: 12.3, lineHeight: 1.85 }}>{c.desc}</p>
              </div>
            </div>
          ))}
          <p className="faint" style={{ fontSize: 11.5, lineHeight: 1.8, margin: '4px 0 0' }}>
            هر دسته قیمت جهانی دارد و روی همین صفحه با USDC و اهرم قابل معامله است. انتخاب دسته فقط فیلتر است — معامله همیشه با همان مراحل انجام می‌شود.
          </p>
        </div>
      </Sheet>

      <Sheet open={confirming} onClose={() => !busy && setConfirming(false)} title={t('ostium.confirmTitle')}>
        {market && costs && (
          <div className="card card-tight stack" style={{ gap: 8 }}>
            <div className="row-between"><span className="faint">{t('ostium.market')}</span><strong>{market.name}</strong></div>
            <div className="row-between"><span className="faint">{t('ostium.direction')}</span><strong className={side === 'long' ? 'up' : 'down'}>{t(`ostium.${side}`)}</strong></div>
            <div className="row-between"><span className="faint">{t('ostium.collateral')}</span><span className="mono">{collateral} USDC</span></div>
            <div className="row-between"><span className="faint">{t('ostium.notional')}</span><span className="mono">{fmtUsd(costs.notional)}</span></div>
            <div className="row-between"><span className="faint">{t('ostium.totalOpeningCost')}</span><span className="mono">{fmtUsd(costs.totalFee)}</span></div>
          </div>
        )}
        <p className="notice notice-danger" style={{ marginTop: 12 }}>{t('ostium.confirmRisk')}</p>
        {error && <p className="notice notice-danger">{t(`ostium.err.${error}`, { defaultValue: error })}</p>}
        <div className="row" style={{ gap: 10, marginTop: 12 }}>
          <button className="btn btn-ghost" disabled={busy} onClick={() => setConfirming(false)}>{t('common.cancel')}</button>
          <button className={`btn ${side === 'long' ? 'btn-success' : 'btn-danger'}`} disabled={busy} onClick={submit}>{busy ? t('common.loading') : t('common.confirm')}</button>
        </div>
      </Sheet>
      </div>
    </PageTransition>
  );
}
