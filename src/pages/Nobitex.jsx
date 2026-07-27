import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import Sheet from '../components/Sheet';
import AnimatedNumber from '../components/AnimatedNumber';
import { useTelegram } from '../context/TelegramContext';
import {
  cancelNobitexOrder,
  clearNobitexToken,
  getIrtMarkets,
  getNobitexBalances,
  getNobitexOrders,
  hasNobitexToken,
  placeNobitexOrder,
  readNobitexToken,
  saveNobitexToken
} from '../lib/nobitex';
import { fmtNum, fmtPct, fmtQty } from '../lib/format';

const toman = (v) => `${fmtNum(v, 0)} ﷼`;

export default function Nobitex() {
  const { t } = useTranslation();
  const { haptic } = useTelegram();

  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const [token, setToken] = useState(null); // decrypted, memory only
  const [linked, setLinked] = useState(hasNobitexToken());
  const [balances, setBalances] = useState([]);
  const [orders, setOrders] = useState([]);
  const [accountErr, setAccountErr] = useState(null);

  const [keySheet, setKeySheet] = useState(false);
  const [unlockSheet, setUnlockSheet] = useState(false);
  const [tradeSheet, setTradeSheet] = useState(null); // market row

  const [keyInput, setKeyInput] = useState('');
  const [pw, setPw] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState(null);

  // order form
  const [side, setSide] = useState('buy');
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [execution, setExecution] = useState('limit');
  const [orderResult, setOrderResult] = useState(null);

  /* ------------------------------ market data ----------------------------- */

  const load = useCallback(async () => {
    try {
      const data = await getIrtMarkets();
      setMarkets(data);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => document.visibilityState === 'visible' && load(), 30000);
    return () => clearInterval(id);
  }, [load]);

  const usdtRate = useMemo(() => markets.find((m) => m.symbol === 'USDT')?.latest ?? null, [markets]);

  /* -------------------------------- account ------------------------------- */

  const loadAccount = useCallback(async (tk) => {
    setAccountErr(null);
    try {
      const [b, o] = await Promise.all([getNobitexBalances(tk), getNobitexOrders(tk).catch(() => [])]);
      setBalances(b);
      setOrders(o);
    } catch (e) {
      setAccountErr(/HTTP 401|403/.test(String(e.message)) ? 'BAD_TOKEN' : 'FETCH_FAILED');
    }
  }, []);

  const saveKey = async () => {
    if (!keyInput.trim()) return setFormErr('TOKEN_REQUIRED');
    if (pw.length < 8) return setFormErr('PASSWORD_SHORT');
    if (!ack) return setFormErr('MUST_ACK');
    setBusy(true);
    setFormErr(null);
    try {
      await saveNobitexToken(keyInput, pw);
      setToken(keyInput.trim());
      setLinked(true);
      setKeySheet(false);
      setKeyInput('');
      setPw('');
      setAck(false);
      haptic?.('success');
      await loadAccount(keyInput.trim());
    } catch {
      setFormErr('SAVE_FAILED');
    } finally {
      setBusy(false);
    }
  };

  const unlock = async () => {
    setBusy(true);
    setFormErr(null);
    try {
      const tk = await readNobitexToken(pw);
      setToken(tk);
      setUnlockSheet(false);
      setPw('');
      haptic?.('success');
      await loadAccount(tk);
    } catch {
      setFormErr('BAD_PASSWORD');
    } finally {
      setBusy(false);
    }
  };

  const unlink = () => {
    clearNobitexToken();
    setToken(null);
    setLinked(false);
    setBalances([]);
    setOrders([]);
    haptic?.('warning');
  };

  const submitOrder = async () => {
    if (!token || !tradeSheet) return;
    setBusy(true);
    setOrderResult(null);
    try {
      const res = await placeNobitexOrder(token, {
        type: side,
        srcCurrency: tradeSheet.symbol.toLowerCase(),
        dstCurrency: 'rls',
        amount: qty,
        // UI shows tomans; the API wants rials
        price: execution === 'limit' ? String(Number(price) * 10) : undefined,
        execution
      });
      setOrderResult({ ok: res?.status === 'ok', raw: res });
      haptic?.(res?.status === 'ok' ? 'success' : 'error');
      if (res?.status === 'ok') {
        setQty('');
        loadAccount(token);
      }
    } catch (e) {
      setOrderResult({ ok: false, error: String(e.message).slice(0, 120) });
      haptic?.('error');
    } finally {
      setBusy(false);
    }
  };

  const total = Number(qty) * Number(price || tradeSheet?.latest || 0);

  return (
    <PageTransition>
      <motion.div variants={riseIn} initial="hidden" animate="show">
        <h1 className="h1">{t('nobitex.title')}</h1>
        <p className="muted">{t('nobitex.subtitle')}</p>
      </motion.div>

      <p className="notice notice-danger">{t('nobitex.custodialWarning')}</p>

      {/* -------------------------- USDT reference -------------------------- */}
      {usdtRate && (
        <motion.section className="card card-rgb card-glow-cyan" variants={riseIn} initial="hidden" animate="show">
          <div className="sheen" />
          <div className="faint">{t('nobitex.usdtRate')}</div>
          <div className="stat-value">
            <AnimatedNumber value={usdtRate} format={(v) => fmtNum(v, 0)} />
            <span style={{ fontSize: 14, color: 'var(--text-2)', marginInlineStart: 6 }}>{t('nobitex.toman')}</span>
          </div>
        </motion.section>
      )}

      {failed && <p className="notice">{t('nobitex.fetchFailed')}</p>}

      {/* ------------------------------ account ----------------------------- */}
      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <div className="row-between" style={{ marginBottom: linked ? 10 : 0 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t('nobitex.account')}</div>
            <div className="faint">{token ? t('nobitex.unlocked') : linked ? t('nobitex.lockedKey') : t('nobitex.noKey')}</div>
          </div>
          {!linked ? (
            <button className="btn btn-sm btn-ghost" onClick={() => setKeySheet(true)}>{t('nobitex.linkKey')}</button>
          ) : !token ? (
            <button className="btn btn-sm btn-primary" onClick={() => setUnlockSheet(true)}>{t('wallet.unlock')}</button>
          ) : (
            <button className="btn btn-sm btn-ghost" onClick={unlink}>{t('nobitex.unlink')}</button>
          )}
        </div>

        {accountErr && <p className="notice notice-danger">{t(`nobitex.err.${accountErr}`)}</p>}

        {token && balances.length > 0 && (
          <div className="stack" style={{ gap: 7 }}>
            {balances.slice(0, 8).map((b) => (
              <div key={b.currency} className="row-between">
                <span className="row" style={{ gap: 7 }}>
                  <span className="coin-logo" style={{ width: 24, height: 24, fontSize: 9 }}>{b.currency.slice(0, 3)}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{b.currency}</span>
                </span>
                <span className="mono" style={{ fontSize: 11.5 }}>{fmtQty(b.available)}</span>
              </div>
            ))}
          </div>
        )}

        {token && orders.length > 0 && (
          <>
            <p className="section-label" style={{ marginTop: 12 }}>{t('nobitex.openOrders')}</p>
            <div className="stack" style={{ gap: 6, marginTop: 8 }}>
              {orders.slice(0, 5).map((o) => (
                <div key={o.id} className="row-between">
                  <span className={`pill ${o.type === 'buy' ? 'pill-up' : 'pill-down'}`}>{t(`trade.${o.type}`)}</span>
                  <span className="mono" style={{ fontSize: 11 }}>{o.srcCurrency?.toUpperCase()}</span>
                  <span className="mono" style={{ fontSize: 11 }}>{fmtQty(Number(o.amount))}</span>
                  <button
                    className="tag"
                    style={{ padding: '3px 9px' }}
                    onClick={() => cancelNobitexOrder(token, o.id).then(() => loadAccount(token))}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </motion.section>

      {/* ------------------------------ markets ----------------------------- */}
      <section>
        <p className="section-label">{t('nobitex.markets')}</p>
        {loading ? (
          <div className="stack" style={{ gap: 8, marginTop: 8 }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="skel" style={{ height: 54 }} />
            ))}
          </div>
        ) : markets.length === 0 ? (
          <div className="empty">
            <span className="empty-icon">🇮🇷</span>
            {t('nobitex.noMarkets')}
          </div>
        ) : (
          <motion.div className="stack" style={{ gap: 8, marginTop: 8 }} variants={stagger} initial="hidden" animate="show">
            {markets.slice(0, 20).map((m) => (
              <motion.div
                key={m.pair}
                className="coin-row"
                variants={riseIn}
                onClick={() => {
                  setTradeSheet(m);
                  setPrice(String(Math.round(m.latest)));
                  setOrderResult(null);
                }}
              >
                <div className="coin-logo">{m.symbol.slice(0, 3)}</div>
                <div className="coin-meta">
                  <div className="coin-sym">{m.symbol}</div>
                  <div className="coin-name">{t('nobitex.toman')}</div>
                </div>
                <div className="coin-right">
                  <div className="mono" style={{ fontSize: 12.5 }}>{fmtNum(m.latest, 0)}</div>
                  <div className={`mono ${m.dayChange >= 0 ? 'up' : 'down'}`} style={{ fontSize: 10.5 }}>
                    {fmtPct(m.dayChange, 2)}
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </section>

      {/* ----------------------------- link key ----------------------------- */}
      <Sheet open={keySheet} onClose={() => setKeySheet(false)}>
        <h2 className="h2" style={{ marginBottom: 4 }}>{t('nobitex.linkTitle')}</h2>
        <p className="muted" style={{ marginBottom: 12 }}>{t('nobitex.linkDesc')}</p>

        <p className="notice notice-danger" style={{ marginBottom: 12 }}>{t('nobitex.keyWarning')}</p>

        <label className="field-label">{t('nobitex.apiToken')}</label>
        <input
          type="password"
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          placeholder="Token …"
          autoComplete="off"
        />

        <label className="field-label" style={{ marginTop: 10 }}>{t('nobitex.encryptPassword')}</label>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />

        <label className="row" style={{ gap: 9, marginTop: 12, alignItems: 'flex-start', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
            style={{ width: 17, height: 17, marginTop: 2, accentColor: '#00e5ff', flexShrink: 0 }}
          />
          <span className="muted" style={{ fontSize: 11.5 }}>{t('nobitex.ackText')}</span>
        </label>

        {formErr && <p className="notice notice-danger" style={{ marginTop: 10 }}>{t(`nobitex.err.${formErr}`)}</p>}

        <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={busy} onClick={saveKey}>
          {busy ? t('common.loading') : t('nobitex.saveKey')}
        </button>
      </Sheet>

      {/* ------------------------------ unlock ------------------------------ */}
      <Sheet open={unlockSheet} onClose={() => setUnlockSheet(false)}>
        <h2 className="h2" style={{ marginBottom: 10 }}>{t('nobitex.unlockTitle')}</h2>
        <label className="field-label">{t('nobitex.encryptPassword')}</label>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && unlock()}
        />
        {formErr && <p className="notice notice-danger" style={{ marginTop: 10 }}>{t(`nobitex.err.${formErr}`)}</p>}
        <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={busy || !pw} onClick={unlock}>
          {busy ? t('common.loading') : t('wallet.unlock')}
        </button>
      </Sheet>

      {/* ------------------------------- trade ------------------------------ */}
      <Sheet open={Boolean(tradeSheet)} onClose={() => setTradeSheet(null)}>
        {tradeSheet && (
          <>
            <h2 className="h2" style={{ marginBottom: 4 }}>
              {tradeSheet.symbol} / {t('nobitex.toman')}
            </h2>
            <p className="faint" style={{ marginBottom: 12 }}>
              {t('nobitex.last')}: {toman(tradeSheet.latest)} · {fmtPct(tradeSheet.dayChange, 2)}
            </p>

            {!token ? (
              <>
                <p className="notice">{t('nobitex.needKeyToTrade')}</p>
                <button
                  className="btn btn-primary"
                  style={{ marginTop: 12 }}
                  onClick={() => {
                    setTradeSheet(null);
                    linked ? setUnlockSheet(true) : setKeySheet(true);
                  }}
                >
                  {linked ? t('wallet.unlock') : t('nobitex.linkKey')}
                </button>
              </>
            ) : (
              <>
                <div className="segmented" style={{ marginBottom: 12 }}>
                  {['buy', 'sell'].map((s) => (
                    <button key={s} className={side === s ? 'active' : ''} onClick={() => setSide(s)} style={{ isolation: 'isolate' }}>
                      {side === s && (
                        <motion.span
                          layoutId="nbx-side"
                          className="seg-indicator"
                          style={{
                            background:
                              s === 'buy'
                                ? 'linear-gradient(90deg,#00ff9d,#00e5ff)'
                                : 'linear-gradient(90deg,#ff3b6b,#ff2d95)'
                          }}
                        />
                      )}
                      {t(`trade.${s}`)}
                    </button>
                  ))}
                </div>

                <div className="segmented" style={{ marginBottom: 12 }}>
                  {['limit', 'market'].map((e) => (
                    <button key={e} className={execution === e ? 'active' : ''} onClick={() => setExecution(e)} style={{ isolation: 'isolate' }}>
                      {execution === e && <motion.span layoutId="nbx-exec" className="seg-indicator" />}
                      {t(`nobitex.${e}`)}
                    </button>
                  ))}
                </div>

                <label className="field-label">{t('nobitex.amount')} ({tradeSheet.symbol})</label>
                <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0.0" />

                {execution === 'limit' && (
                  <>
                    <label className="field-label" style={{ marginTop: 10 }}>{t('nobitex.price')} ({t('nobitex.toman')})</label>
                    <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
                  </>
                )}

                <div className="card card-tight row-between" style={{ marginTop: 12 }}>
                  <span className="faint">{t('nobitex.estTotal')}</span>
                  <span className="mono">{toman(total)}</span>
                </div>

                <p className="notice" style={{ marginTop: 12 }}>{t('nobitex.orderNotice')}</p>

                {orderResult && (
                  <p className={`notice ${orderResult.ok ? '' : 'notice-danger'}`} style={{ marginTop: 10 }}>
                    {orderResult.ok ? t('nobitex.orderPlaced') : orderResult.error || t('nobitex.orderFailed')}
                  </p>
                )}

                <button
                  className={`btn ${side === 'buy' ? 'btn-success' : 'btn-danger'}`}
                  style={{ marginTop: 12 }}
                  disabled={busy || !(Number(qty) > 0)}
                  onClick={submitOrder}
                >
                  {busy ? t('common.loading') : `${t(`trade.${side}`)} ${tradeSheet.symbol}`}
                </button>
              </>
            )}
          </>
        )}
      </Sheet>
    </PageTransition>
  );
}
