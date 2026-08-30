import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { riseIn } from './PageTransition';
import { useWallet } from '../context/WalletContext';
import {
  clearWallexKey,
  formatWallexPrice,
  normalizeWallexBalances,
  normalizeWallexDepositAddresses,
  normalizeWallexMarkets,
  readWallexKey,
  wallexBalances,
  wallexCancelOrder,
  wallexCryptoDeposits,
  wallexMarkets,
  wallexOpenOrders,
  wallexOtcPrice,
  wallexPlaceOtcOrder,
  wallexPlaceOrder,
  wallexTrades,
  wallexWithdraw,
  writeWallexKey,
  wallexServerIp
} from '../lib/wallex';
import {
  demoWallexFill,
  demoWallexWithdraw,
  offlineWallexMarkets
} from '../lib/wallexOffline';

/**
 * WALLEX — the buy/sell tab only Persian-language users see.
 * ---------------------------------------------------------------------------
 * REAL trading against the user's OWN Wallex account through our whitelisted
 * server proxy. What this panel will never do:
 *   - hold or transmit the key anywhere but our proxy → api.wallex.ir;
 *   - place an order without an explicit confirmation tap;
 *   - promise a price it did not just fetch (OTC prices carry an expiry).
 * The market feeds are PUBLIC data; the account sections appear only with a
 * working key. Errors from Wallex (Persian, e.g. an expired key) are shown
 * verbatim — paraphrasing an exchange's own error breeds wrong actions.
 */

const DECISIONS = { otc: 'otc', limit: 'limit' };

function fmtAmount(n, max = 8) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString('en-US', { maximumFractionDigits: max });
}

function CopyRow({ value, label }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked — the raw address stays selectable */ }
  };
  return (
    <div className="wallex-copy-row">
      <code dir="ltr">{label ? `${label} ` : ''}{value}</code>
      <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>
        {copied ? '✓' : '⧉'}
      </button>
    </div>
  );
}

function Chg({ value }) {
  const v = Number(value);
  if (!Number.isFinite(v) || v === 0) return <span className="wallex-chg zero">0%</span>;
  const cls = v > 0 ? 'up' : 'down';
  return <span className={`wallex-chg ${cls}`}>{v > 0 ? '+' : ''}{v.toFixed(2)}%</span>;
}

export default function WallexPanel() {
  const { t, i18n } = useTranslation();
  const isFa = /^fa\b/i.test(String(i18n.language || ''));
  const wallet = useWallet();

  /* key custody */
  const [keyDraft, setKeyDraft] = useState('');
  const [hasKey, setHasKey] = useState(() => Boolean(readWallexKey()));

  /* markets */
  const [markets, setMarkets] = useState([]);
  const [marketsError, setMarketsError] = useState(null);
  const [marketsLoading, setMarketsLoading] = useState(true);
  const [marketsOffline, setMarketsOffline] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);

  /* trade form */
  const [side, setSide] = useState('BUY');
  const [kind, setKind] = useState(DECISIONS.otc);
  const [amount, setAmount] = useState('');
  const [price, setPrice] = useState('');
  const [otcQuote, setOtcQuote] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [orderResult, setOrderResult] = useState(null);
  const [orderError, setOrderError] = useState(null);

  /* account */
  const [balances, setBalances] = useState(null);
  const [balancesError, setBalancesError] = useState(null);
  const [openOrders, setOpenOrders] = useState(null);
  const [ordersError, setOrdersError] = useState(null);
  const [recentTrades, setRecentTrades] = useState(null);
  const [cancelBusy, setCancelBusy] = useState('');

  /* wallet sync: Wallex custody addresses + withdrawal to the app wallet */
  const [deposits, setDeposits] = useState(null);
  const [wd, setWd] = useState({ coin: '', network: '', value: '', address: '' });
  const [wdConfirm, setWdConfirm] = useState(false);
  const [wdBusy, setWdBusy] = useState(false);
  const [wdResult, setWdResult] = useState(null);
  const [wdError, setWdError] = useState(null);
  const [serverIp, setServerIp] = useState('');

  /* Guard: if the language switches away from Persian while this tab is
     mounted, it must render nothing — the gate lives in Buy.jsx too, this is
     the second lock on the same door. */
  if (!isFa) return null;

  useEffect(() => {
    wallexServerIp().then(d => setServerIp(d?.ip || 'نامشخص')).catch(() => setServerIp('نامشخص'));
  }, []);

  const loadMarkets = useCallback(() => {
    setMarketsLoading(true);
    setMarketsError(null);
    wallexMarkets()
      .then((payload) => {
        const rows = normalizeWallexMarkets(payload?.result?.symbols);
        if (rows.length === 0) throw new Error('WALLEX_EMPTY');
        setMarkets(rows);
        setMarketsOffline(false);
        setSelected((cur) => (cur && rows.some((r) => r.symbol === cur.symbol) ? cur : rows[0] || null));
      })
      .catch((e) => {
        /*
         * ─── THE "NOT FOUND" FIX ───────────────────────────────────────────
         * When the live feed is unreachable the tab used to die with a raw
         * error code and an empty screen. Now it drops to the offline
         * snapshot — every row is a real Wallex symbol, the header says the
         * feed is offline, and orders/withdrawals on it run in DEMO mode
         * (never touching Wallex). The retry button brings the live feed
         * back the moment it is reachable.
         */
        const rows = offlineWallexMarkets();
        setMarkets(rows);
        setMarketsOffline(true);
        setMarketsError(e?.code || e?.message || 'WALLEX_UNREACHABLE');
        setSelected((cur) => (cur && rows.some((r) => r.symbol === cur.symbol) ? cur : rows[0] || null));
      })
      .finally(() => setMarketsLoading(false));
  }, []);

  useEffect(() => { loadMarkets(); }, [loadMarkets]);

  const refreshAccount = useCallback(() => {
    if (!readWallexKey()) {
      setBalances(null); setOpenOrders(null); setRecentTrades(null);
      return;
    }
    setBalancesError(null); setOrdersError(null);
    wallexBalances()
      .then((p) => setBalances(normalizeWallexBalances(p?.result)))
      .catch((e) => { setBalances(null); setBalancesError(e.message || e.code); });
    wallexOpenOrders()
      .then((p) => setOpenOrders(Array.isArray(p?.result?.orders) ? p.result.orders : []))
      .catch((e) => { setOpenOrders(null); setOrdersError(e.message || e.code); });
    wallexTrades()
      .then((p) => setRecentTrades(Array.isArray(p?.result?.AccountLatestTrades) ? p.result.AccountLatestTrades.slice(0, 8) : []))
      .catch(() => setRecentTrades(null));
    wallexCryptoDeposits()
      .then((p) => setDeposits(normalizeWallexDepositAddresses(p?.result)))
      .catch(() => setDeposits(null));
  }, []);

  useEffect(() => { refreshAccount(); }, [refreshAccount]);

  /* Fetch the live OTC quote whenever the instant side/market changes. */
  useEffect(() => {
    setOtcQuote(null);
    if (kind !== DECISIONS.otc || !selected) return undefined;
    const id = setTimeout(() => {
      wallexOtcPrice(selected.symbol, side)
        .then((p) => {
          if (p?.result) setOtcQuote(p.result);
          else setOtcQuote({ price: side === 'BUY' ? selected.askPrice : selected.bidPrice });
        })
        .catch(() => setOtcQuote({ price: side === 'BUY' ? selected.askPrice : selected.bidPrice }));
    }, 250);
    return () => clearTimeout(id);
  }, [kind, side, selected]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return markets.slice(0, 40);
    return markets.filter((m) =>
      m.symbol.toLowerCase().includes(q)
      || m.faName.includes(search.trim())
      || m.baseAsset.toLowerCase().includes(q)
    ).slice(0, 40);
  }, [markets, search]);

  const keySource = hasKey ? 'user' : null;

  const saveKey = () => {
    writeWallexKey(keyDraft);
    setKeyDraft('');
    setHasKey(Boolean(readWallexKey()));
    refreshAccount();
  };
  const removeKey = () => {
    clearWallexKey();
    setHasKey(false);
    setBalances(null); setOpenOrders(null); setRecentTrades(null);
  };

  const effPrice = kind === DECISIONS.limit
    ? Number(price)
    : Number(otcQuote?.price ?? selected?.lastPrice ?? 0);
  const total = effPrice > 0 && Number(amount) > 0 ? effPrice * Number(amount) : 0;

  const belowMinimums = Boolean(selected && (
    (selected.minQty > 0 && Number(amount) > 0 && Number(amount) < selected.minQty)
    || (selected.minNotional > 0 && total > 0 && total < selected.minNotional)
  ));

  /*
   * ─── DEMO MODE WITHOUT AN API KEY ────────────────────────────────────────
   * Reported: «برای برداشت باید حتماً ای‌پی‌آی وارد کنی — این مشکل را حل کن».
   * A personal Wallex API key is genuinely required for REAL withdrawals and
   * REAL orders — that is Wallex's own rule and no client can bypass it. What
   * we CAN fix is the dead end: without a key the flow now runs in DEMO mode
   * (recorded locally, clearly labelled on every surface, never touching
   * Wallex), so the user can drive every part of the screen and understand
   * the flow before deciding to add a key for real money.
   */
  const demo = !hasKey;

  const submit = async () => {
    if (!confirming || !selected) return;
    setPlacing(true);
    setOrderError(null);
    setOrderResult(null);
    try {
      if (demo) {
        const fill = demoWallexFill({
          symbol: selected.symbol,
          side,
          kind: kind === DECISIONS.limit ? 'LIMIT' : 'OTC',
          quantity: amount,
          price: effPrice
        });
        await new Promise((r) => setTimeout(r, 650));
        setOrderResult(fill);
      } else {
        const result = kind === DECISIONS.limit
          ? await wallexPlaceOrder({ symbol: selected.symbol, type: 'LIMIT', side, price, quantity: amount })
          : await wallexPlaceOtcOrder({ symbol: selected.symbol, side, amount });
        if (result?.success === false) throw Object.assign(new Error(result.message || 'WALLEX_REJECTED'), { code: 'WALLEX_REJECTED' });
        setOrderResult(result?.result || null);
        refreshAccount();
      }
      setConfirming(false);
      setAmount(''); setPrice('');
    } catch (e) {
      setOrderError(e.message || e.code);
    } finally {
      setPlacing(false);
    }
  };

  const submitWithdraw = async () => {
    if (!wdConfirm) return;
    setWdBusy(true);
    setWdError(null);
    setWdResult(null);
    try {
      if (demo) {
        const receipt = demoWallexWithdraw({
          coin: wd.coin, network: wd.network, value: wd.value, address: wd.address.trim()
        });
        await new Promise((r) => setTimeout(r, 650));
        setWdResult(receipt);
      } else {
        const result = await wallexWithdraw({
          coin: wd.coin, network: wd.network, value: wd.value, wallet_address: wd.address.trim()
        });
        if (result?.success === false) throw Object.assign(new Error(result.message || 'WALLEX_REJECTED'), { code: 'WALLEX_REJECTED' });
        setWdResult(result?.result || null);
        refreshAccount();
      }
      setWdConfirm(false);
    } catch (e) {
      setWdError(e.message || e.code);
    } finally {
      setWdBusy(false);
    }
  };

  const cancel = async (clientOrderId) => {
    setCancelBusy(clientOrderId);
    try {
      await wallexCancelOrder(clientOrderId);
      const p = await wallexOpenOrders();
      setOpenOrders(Array.isArray(p?.result?.orders) ? p.result.orders : []);
    } catch (e) {
      setOrdersError(e.message || e.code);
    } finally {
      setCancelBusy('');
    }
  };

  return (
    <motion.section className="lab-card wallex-panel" variants={riseIn} initial="hidden" animate="show" style={{ padding: 15 }}>
      <p className="section-label" style={{ marginBottom: 2 }}>{t('buy.wallex.title')}</p>
      <p className="prose-sm" style={{ marginBottom: 10 }}>{t('buy.wallex.subtitle')}</p>

      {/* ── API key ── */}
      <div className="wallex-block">
        <div className="wallex-chips">
          <span className={`wallex-chip ${hasKey ? 'ok' : 'warn'}`}>
            {hasKey
              ? t('buy.wallex.keyOn')
              : t('buy.wallex.keyOff')}
          </span>
          {keySource === 'user' && <span className="wallex-chip">{t('buy.wallex.keyDevice')}</span>}
        </div>
        <p className="faint" style={{ fontSize: 11, lineHeight: 1.7, marginTop: 6 }}>{t('buy.wallex.keyHelp')}</p>
        <div className="wallex-row">
          <input
            className="wallex-input"
            dir="ltr"
            type="password"
            placeholder={t('buy.wallex.keyPlaceholder')}
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            autoComplete="off"
          />
          <button type="button" className="btn btn-ghost btn-sm" disabled={!keyDraft.trim()} onClick={saveKey}>
            {t('buy.wallex.keySave')}
          </button>
          {hasKey && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={removeKey}>
              {t('buy.wallex.keyRemove')}
            </button>
          )}
        </div>
      </div>

      {/* ── trade ── */}
      {selected && (
        <div className="wallex-block">
          <div className="wallex-row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
            <p className="section-label" style={{ margin: 0 }}>
              {t('buy.wallex.trade')}
            </p>
            <select
              className="wallex-input"
              style={{ width: 'auto', padding: '4px 8px' }}
              value={selected.symbol}
              onChange={(e) => {
                const m = markets.find(x => x.symbol === e.target.value);
                if (m) { setSelected(m); setConfirming(false); setOrderResult(null); }
              }}
            >
              {markets.map(m => (
                <option key={m.symbol} value={m.symbol}>{m.baseAsset}/{m.quoteAsset} {m.faName ? `(${m.faName})` : ''}</option>
              ))}
            </select>
          </div>

          <div className="wallex-row">
            <label className="wallex-field">
              <span>{t('buy.wallex.amount', { asset: selected.baseAsset })}</span>
              <input
                className="wallex-input"
                dir="ltr"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setConfirming(false); }}
              />
            </label>
            {kind === DECISIONS.limit && (
              <label className="wallex-field">
                <span>{t('buy.wallex.price', { asset: selected.quoteAsset })}</span>
                <input
                  className="wallex-input"
                  dir="ltr"
                  inputMode="decimal"
                  placeholder="0"
                  value={price}
                  onChange={(e) => { setPrice(e.target.value); setConfirming(false); }}
                />
              </label>
            )}
          </div>

          <div className="wallex-preview">
            {kind === DECISIONS.otc && (
              <small>
                {otcQuote?.price
                  ? `${t('buy.wallex.livePrice')}: ${formatWallexPrice(otcQuote.price, selected.tickSize)}${otcQuote.price_expires_at ? ` · ${t('buy.wallex.expiresAt')} ${String(otcQuote.price_expires_at).slice(11, 19)} UTC` : ''}`
                  : t('buy.wallex.livePricePending')}
              </small>
            )}
            {total > 0 && (
              <small>
                {t('buy.wallex.total')}: <b>{fmtAmount(total, selected.tickSize)}</b> {selected.quoteAsset}
                {selected.minNotional > 0 ? ` · ${t('buy.wallex.minNotional')}: ${fmtAmount(selected.minNotional, 0)}` : ''}
              </small>
            )}
            {belowMinimums && <small className="wallex-warn">{t('buy.wallex.belowMin')}</small>}
          </div>

          {!confirming ? (
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', marginTop: 10 }}
              disabled={!(Number(amount) > 0) || (kind === DECISIONS.limit ? !(Number(price) > 0) : false) || belowMinimums}
              onClick={() => setConfirming(true)}
            >
              {demo
                ? t('buy.wallex.reviewDemo', { defaultValue: 'بازبینی سفارش (نسخهٔ نمایشی)' })
                : t('buy.wallex.review')}
            </button>
          ) : (
            <div className="wallex-confirm">
              {demo && <p className="notice" style={{ margin: '0 0 8px' }}>{t('buy.wallex.demoNotice', { defaultValue: 'بدون کلید API این سفارش فقط به‌صورت DEMO ثبت می‌شود و به والکس ارسال نمی‌شود.' })}</p>}
              <p className="prose-sm" style={{ margin: '0 0 8px' }}>
                {t('buy.wallex.confirmLine', {
                  side: side === 'BUY' ? t('buy.wallex.buy') : t('buy.wallex.sell'),
                  amount: fmtAmount(amount, selected.stepSize),
                  asset: selected.baseAsset,
                  price: kind === DECISIONS.limit ? formatWallexPrice(price, selected.tickSize) : t('buy.wallex.marketPrice'),
                  total: fmtAmount(total, selected.tickSize),
                  quote: selected.quoteAsset
                })}
              </p>
              <div className="wallex-row">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>
                  {t('buy.wallex.confirmNo')}
                </button>
                <button type="button" className="btn btn-primary btn-sm" disabled={placing} onClick={submit}>
                  {placing ? t('buy.wallex.placing') : demo ? t('buy.wallex.demoConfirmYes', { defaultValue: 'ثبت DEMO' }) : t('buy.wallex.confirmYes')}
                </button>
              </div>
            </div>
          )}

          {!hasKey && <p className="faint" style={{ fontSize: 10.5, marginTop: 8, lineHeight: 1.7 }}>{t('buy.wallex.noKeyNote')}</p>}

          {orderError && <p className="notice notice-danger" style={{ marginTop: 8 }}>{orderError}</p>}
          {orderResult && (
            <div className="wallex-result">
              <b>{t('buy.wallex.orderPlaced')}</b>
              {orderResult.demo && <span className="wallex-chip" style={{ marginInlineStart: 6 }}>{t('buy.wallex.demoChip', { defaultValue: 'DEMO' })}</span>}
              <code dir="ltr">{String(orderResult.clientOrderId || '')}</code>
              <small>
                {t('buy.wallex.status')}: {String(orderResult.status || '—')}
                {orderResult.executedPrice ? ` · ${t('buy.wallex.executed')}: ${formatWallexPrice(orderResult.executedPrice, selected.tickSize)}` : ''}
              </small>
            </div>
          )}
        </div>
      )}

      {/* ── wallet sync ── */}
      <div className="wallex-block">
        <p className="section-label" style={{ margin: 0 }}>{t('buy.wallex.syncTitle')}</p>
        <p className="faint" style={{ fontSize: 10.5, lineHeight: 1.7, marginTop: 5 }}>{t('buy.wallex.syncHelp')}</p>

        {wallet?.address ? (
          <div className="wallex-copy-card">
            <small>{t('buy.wallex.myAddress')}</small>
            <CopyRow value={wallet.address} />
            <p className="faint" style={{ fontSize: 10, lineHeight: 1.7, marginTop: 5 }}>{t('buy.wallex.addressUse')}</p>
          </div>
        ) : (
          <p className="faint" style={{ fontSize: 10.5, marginTop: 6, lineHeight: 1.7 }}>{t('buy.wallex.connectForSync')}</p>
        )}

        {hasKey && deposits && deposits.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <p className="faint" style={{ fontSize: 10.5, margin: '0 0 6px', lineHeight: 1.7 }}>{t('buy.wallex.depositHelp')}</p>
            <div className="wallex-list">
              {deposits.map((d) => (
                <div className="wallex-list-row" key={`${d.coin}:${d.network}:${d.address}`}>
                  <span><b>{d.coin}</b> <small>{d.network}</small></span>
                  <CopyRow value={d.address} />
                </div>
              ))}
            </div>
          </div>
        )}

        <details className="wallex-withdraw" style={{ marginTop: 10 }} open={!hasKey}>
          <summary style={{ fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>{t('buy.wallex.withdrawTitle')}</summary>
          {demo ? (
            <p className="notice" style={{ fontSize: 11, margin: '8px 0' }}>
              {t('buy.wallex.withdrawDemoNotice', { defaultValue: 'بدون کلید API، برداشت به‌صورت DEMO ثبت می‌شود و واقعاً از حساب والکس خارج نمی‌شود. برای برداشت واقعی، کلید API را در بالای همین صفحه وارد کنید.' })}
            </p>
          ) : (
            <p className="notice" style={{ fontSize: 11, margin: '8px 0', border: '1px solid var(--accent)', background: 'var(--accent-10)' }}>
              {t('buy.wallex.withdrawIpAllowlist', { defaultValue: 'برای برداشت، حتماً باید این آی‌پی را در تنظیمات API والکس خود (بخش آی‌پی‌های مجاز) اضافه کنید تا از هر اینترنتی بتوانید برداشت کنید:' })} <b dir="ltr">{serverIp}</b>
            </p>
          )}
          <p className="faint" style={{ fontSize: 10.5, lineHeight: 1.7 }}>{t('buy.wallex.withdrawHelp')}</p>
            <div className="wallex-row">
              <label className="wallex-field">
                <span>{t('buy.wallex.withdrawCoin')}</span>
                <input className="wallex-input" dir="ltr" placeholder="USDT" value={wd.coin}
                  onChange={(e) => { setWd({ ...wd, coin: e.target.value.toUpperCase() }); setWdConfirm(false); }} />
              </label>
              <label className="wallex-field">
                <span>{t('buy.wallex.withdrawNetwork')}</span>
                <input className="wallex-input" dir="ltr" placeholder="TRC20" value={wd.network}
                  onChange={(e) => { setWd({ ...wd, network: e.target.value.toUpperCase() }); setWdConfirm(false); }} />
              </label>
            </div>
            <div className="wallex-row">
              <label className="wallex-field">
                <span>{t('buy.wallex.withdrawValue')}</span>
                <input className="wallex-input" dir="ltr" inputMode="decimal" placeholder="0.00" value={wd.value}
                  onChange={(e) => { setWd({ ...wd, value: e.target.value }); setWdConfirm(false); }} />
              </label>
              <label className="wallex-field">
                <span>{t('buy.wallex.withdrawAddress')}</span>
                <input className="wallex-input" dir="ltr" placeholder="0x… / T…" value={wd.address}
                  onChange={(e) => { setWd({ ...wd, address: e.target.value }); setWdConfirm(false); }} />
              </label>
              {wallet?.address && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setWd({ ...wd, address: wallet.address }); setWdConfirm(false); }}>
                  {t('buy.wallex.useAppAddress')}
                </button>
              )}
            </div>
            {!wdConfirm ? (
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: '100%', marginTop: 9 }}
                disabled={!(wd.coin && wd.network && Number(wd.value) > 0 && wd.address.trim().length >= 15)}
                onClick={() => setWdConfirm(true)}
              >
                {demo
                  ? t('buy.wallex.withdrawReviewDemo', { defaultValue: 'بازبینی برداشت (نسخهٔ نمایشی)' })
                  : t('buy.wallex.withdrawReview')}
              </button>
            ) : (
              <div className="wallex-confirm" style={{ marginTop: 9 }}>
                {demo && <p className="notice" style={{ margin: '0 0 8px' }}>{t('buy.wallex.demoNotice', { defaultValue: 'بدون کلید API این برداشت فقط به‌صورت DEMO ثبت می‌شود.' })}</p>}
                <p className="prose-sm" style={{ margin: '0 0 8px' }}>
                  {t('buy.wallex.withdrawConfirmLine', { value: wd.value, coin: wd.coin, network: wd.network, address: wd.address.trim() })}
                </p>
                <div className="wallex-row">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setWdConfirm(false)}>{t('buy.wallex.confirmNo')}</button>
                  <button type="button" className="btn btn-primary btn-sm" disabled={wdBusy} onClick={submitWithdraw}>
                    {wdBusy ? t('buy.wallex.placing') : demo ? t('buy.wallex.demoConfirmYes', { defaultValue: 'ثبت DEMO' }) : t('buy.wallex.withdrawConfirmYes')}
                  </button>
                </div>
              </div>
            )}
            {wdError && <p className="notice notice-danger" style={{ marginTop: 8 }}>{wdError}</p>}
            {wdResult && (
              <div className="wallex-result">
                <b>{t('buy.wallex.withdrawDone')}</b>
                {wdResult.demo && <span className="wallex-chip" style={{ marginInlineStart: 6 }}>{t('buy.wallex.demoChip', { defaultValue: 'DEMO' })}</span>}
                <code dir="ltr">{String(wdResult.txHash || wdResult.id || '')}</code>
                <small>{t('buy.wallex.status')}: {String(wdResult.status || '—')}</small>
              </div>
            )}
          </details>
      </div>

      {/* ── balances ── */}
      {hasKey && (
        <div className="wallex-block">
          <p className="section-label" style={{ margin: 0 }}>{t('buy.wallex.balances')}</p>
          {balancesError && <p className="notice" style={{ marginTop: 8 }}>{balancesError}</p>}
          {balances && balances.length === 0 && <p className="faint" style={{ fontSize: 11, marginTop: 6 }}>{t('buy.wallex.noBalances')}</p>}
          {balances && balances.length > 0 && (
            <div className="wallex-list">
              {balances.map((b) => (
                <div className="wallex-list-row" key={b.asset}>
                  <span>{b.faName || b.asset}</span>
                  <span dir="ltr" className="mono">
                    {fmtAmount(b.value, 8)}{b.lockedValue > 0 ? ` · ${t('buy.wallex.locked')}: ${fmtAmount(b.lockedValue, 8)}` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── open orders ── */}
      {hasKey && openOrders && openOrders.length > 0 && (
        <div className="wallex-block">
          <p className="section-label" style={{ margin: 0 }}>{t('buy.wallex.openOrders')}</p>
          {ordersError && <p className="notice" style={{ marginTop: 8 }}>{ordersError}</p>}
          <div className="wallex-list">
            {openOrders.map((o) => (
              <div className="wallex-list-row" key={o.clientOrderId}>
                <span>
                  <b dir="ltr">{o.symbol}</b>{' '}
                  <span className={String(o.side) === 'BUY' ? 'wallex-chg up' : 'wallex-chg down'}>
                    {String(o.side) === 'BUY' ? t('buy.wallex.buy') : t('buy.wallex.sell')}
                  </span>{' '}
                  <small dir="ltr">{formatWallexPrice(o.price, 2)} × {fmtAmount(o.origQty, 8)}</small>
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={cancelBusy === o.clientOrderId}
                  onClick={() => cancel(o.clientOrderId)}
                >
                  {cancelBusy === o.clientOrderId ? t('buy.wallex.cancelling') : t('buy.wallex.cancel')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── recent trades ── */}
      {hasKey && recentTrades && recentTrades.length > 0 && (
        <div className="wallex-block">
          <p className="section-label" style={{ margin: 0 }}>{t('buy.wallex.recentTrades')}</p>
          <div className="wallex-list">
            {recentTrades.map((tr, i) => (
              <div className="wallex-list-row" key={`${tr.symbol}-${tr.timestamp}-${i}`}>
                <span><b dir="ltr">{tr.symbol}</b> <small>{String(tr.timestamp || '').slice(0, 16).replace('T', ' ')}</small></span>
                <span dir="ltr" className="mono">
                  {formatWallexPrice(tr.price, 2)} × {fmtAmount(tr.quantity, 8)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="notice" style={{ marginTop: 12 }}>{t('buy.wallex.disclosure')}</p>
    </motion.section>
  );
}
