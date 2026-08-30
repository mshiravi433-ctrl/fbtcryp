import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { riseIn } from './PageTransition';
import {
  clearWallexKey,
  formatWallexPrice,
  normalizeWallexBalances,
  normalizeWallexMarkets,
  readWallexKey,
  wallexBalances,
  wallexCancelOrder,
  wallexMarkets,
  wallexOpenOrders,
  wallexOtcPrice,
  wallexPlaceOtcOrder,
  wallexPlaceOrder,
  wallexTrades,
  writeWallexKey
} from '../lib/wallex';

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

function Chg({ value }) {
  const v = Number(value);
  if (!Number.isFinite(v) || v === 0) return <span className="wallex-chg zero">0%</span>;
  const cls = v > 0 ? 'up' : 'down';
  return <span className={`wallex-chg ${cls}`}>{v > 0 ? '+' : ''}{v.toFixed(2)}%</span>;
}

export default function WallexPanel() {
  const { t, i18n } = useTranslation();
  const isFa = /^fa\b/i.test(String(i18n.language || ''));

  /* key custody */
  const [keyDraft, setKeyDraft] = useState('');
  const [hasKey, setHasKey] = useState(() => Boolean(readWallexKey()));

  /* markets */
  const [markets, setMarkets] = useState([]);
  const [marketsError, setMarketsError] = useState(null);
  const [marketsLoading, setMarketsLoading] = useState(true);
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

  /* Guard: if the language switches away from Persian while this tab is
     mounted, it must render nothing — the gate lives in Buy.jsx too, this is
     the second lock on the same door. */
  if (!isFa) return null;

  const loadMarkets = useCallback(() => {
    setMarketsLoading(true);
    setMarketsError(null);
    wallexMarkets()
      .then((payload) => {
        const rows = normalizeWallexMarkets(payload?.result?.symbols);
        setMarkets(rows);
        setSelected((cur) => (cur && rows.some((r) => r.symbol === cur.symbol) ? cur : rows[0] || null));
      })
      .catch((e) => setMarketsError(e.code || e.message))
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
  }, []);

  useEffect(() => { refreshAccount(); }, [refreshAccount]);

  /* Fetch the live OTC quote whenever the instant side/market changes. */
  useEffect(() => {
    setOtcQuote(null);
    if (kind !== DECISIONS.otc || !selected) return undefined;
    const id = setTimeout(() => {
      wallexOtcPrice(selected.symbol, side)
        .then((p) => setOtcQuote(p?.result || null))
        .catch(() => setOtcQuote(null));
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

  const submit = async () => {
    if (!confirming || !selected) return;
    setPlacing(true);
    setOrderError(null);
    setOrderResult(null);
    try {
      const result = kind === DECISIONS.limit
        ? await wallexPlaceOrder({ symbol: selected.symbol, type: 'LIMIT', side, price, quantity: amount })
        : await wallexPlaceOtcOrder({ symbol: selected.symbol, side, amount });
      if (result?.success === false) throw Object.assign(new Error(result.message || 'WALLEX_REJECTED'), { code: 'WALLEX_REJECTED' });
      setOrderResult(result?.result || null);
      setConfirming(false);
      setAmount(''); setPrice('');
      refreshAccount();
    } catch (e) {
      setOrderError(e.message || e.code);
    } finally {
      setPlacing(false);
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

      {/* ── markets ── */}
      <div className="wallex-block">
        <div className="wallex-row" style={{ justifyContent: 'space-between' }}>
          <p className="section-label" style={{ margin: 0 }}>{t('buy.wallex.markets')}</p>
          <input
            className="wallex-input wallex-search"
            placeholder={t('buy.wallex.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {marketsError && <p className="notice" style={{ marginTop: 8 }}><code>{marketsError}</code></p>}
        {marketsLoading && <p className="faint" style={{ fontSize: 11, marginTop: 8 }}>{t('buy.wallex.loading')}</p>}
        <div className="wallex-markets">
          {filtered.map((m) => (
            <button
              key={m.symbol}
              type="button"
              className={`wallex-market ${selected?.symbol === m.symbol ? 'active' : ''}`}
              onClick={() => { setSelected(m); setConfirming(false); setOrderResult(null); }}
            >
              <span className="wallex-market-name">
                <b dir="ltr">{m.baseAsset}/{m.quoteAsset}</b>
                {m.faName && <small>{m.faName}</small>}
              </span>
              <span className="wallex-market-price">
                <b>{formatWallexPrice(m.lastPrice, m.tickSize)}</b>
                <Chg value={m.change24h} />
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── trade ── */}
      {selected && (
        <div className="wallex-block">
          <p className="section-label" style={{ margin: 0 }}>
            {t('buy.wallex.trade')} — <span dir="ltr">{selected.baseAsset}/{selected.quoteAsset}</span>
          </p>

          <div className="wallex-toggle" role="group" aria-label={t('buy.wallex.side')}>
            <button type="button" className={side === 'BUY' ? 'buy active' : 'buy'} onClick={() => { setSide('BUY'); setConfirming(false); }}>
              {t('buy.wallex.buy')}
            </button>
            <button type="button" className={side === 'SELL' ? 'sell active' : 'sell'} onClick={() => { setSide('SELL'); setConfirming(false); }}>
              {t('buy.wallex.sell')}
            </button>
          </div>

          <div className="wallex-toggle" role="group" aria-label={t('buy.wallex.kind')}>
            <button type="button" className={kind === DECISIONS.otc ? 'active' : ''} onClick={() => { setKind(DECISIONS.otc); setConfirming(false); }}>
              {t('buy.wallex.instant')}
            </button>
            <button type="button" className={kind === DECISIONS.limit ? 'active' : ''} onClick={() => { setKind(DECISIONS.limit); setConfirming(false); }}>
              {t('buy.wallex.limitOrder')}
            </button>
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
              disabled={!hasKey || !(Number(amount) > 0) || (kind === DECISIONS.limit ? !(Number(price) > 0) : false) || belowMinimums}
              onClick={() => setConfirming(true)}
            >
              {hasKey
                ? t('buy.wallex.review')
                : t('buy.wallex.needKey')}
            </button>
          ) : (
            <div className="wallex-confirm">
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
                  {placing ? t('buy.wallex.placing') : t('buy.wallex.confirmYes')}
                </button>
              </div>
            </div>
          )}

          {!hasKey && <p className="faint" style={{ fontSize: 10.5, marginTop: 8, lineHeight: 1.7 }}>{t('buy.wallex.noKeyNote')}</p>}

          {orderError && <p className="notice notice-danger" style={{ marginTop: 8 }}>{orderError}</p>}
          {orderResult && (
            <div className="wallex-result">
              <b>{t('buy.wallex.orderPlaced')}</b>
              <code dir="ltr">{String(orderResult.clientOrderId || '')}</code>
              <small>
                {t('buy.wallex.status')}: {String(orderResult.status || '—')}
                {orderResult.executedPrice ? ` · ${t('buy.wallex.executed')}: ${formatWallexPrice(orderResult.executedPrice, selected.tickSize)}` : ''}
              </small>
            </div>
          )}
        </div>
      )}

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
