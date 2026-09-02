import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { riseIn } from './PageTransition';
import { useWallet, shortAddress } from '../context/WalletContext';
import { guidedTokenMeta, isEvmAddress } from '../lib/guidedCheckout';
import { watchWalletDelta } from '../lib/buySellWatch';
import { showLocalNotification } from '../lib/notify';
import { explorerAddr } from '../lib/chains';
import { IconActivity, IconCheck, IconChevronRight, IconShield } from './Icons';

/**
 * ON-CHAIN WALLET REPORT — rendered under BOTH the Buy and the Sell tab.
 *
 * Reads the public blockchain and nothing else: it polls the watched
 * wallet's balance of the exact token the wizard named and reports every
 * movement — IN for a buy, OUT for a sell. No provider API, no webhook, no
 * account. Because a balance delta proves a transfer and not a payment, the
 * copy says "a deposit matching your order was detected", never "payment
 * confirmed" — the strings in i18n keep that wording rule.
 */
export default function WalletWatchReport({ side, walletAddress, asset, network, autoStart = 0 }) {
  const { t, i18n } = useTranslation();
  const wallet = useWallet();
  const [watching, setWatching] = useState(false);
  const [events, setEvents] = useState([]);
  const [balance, setBalance] = useState(null);
  const [lastTick, setLastTick] = useState(null);
  const [error, setError] = useState(null);
  const stopRef = useRef(null);
  const startedForRef = useRef(0);

  const meta = guidedTokenMeta(network, asset);
  const address = String(walletAddress || '').trim();
  const ready = Boolean(meta) && isEvmAddress(address);
  const sell = side === 'SELL';

  const stop = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    setWatching(false);
  }, []);

  const start = useCallback(async () => {
    if (!ready || stopRef.current) return;
    setError(null);
    try {
      const provider = await wallet.getReadProvider?.(meta.chainId);
      if (!provider) throw new Error('WATCH_NO_PROVIDER');
      setEvents([]); setBalance(null); setLastTick(null);
      stopRef.current = watchWalletDelta({
        provider,
        address,
        token: meta,
        onTick: ({ amount, at }) => { setBalance(amount); setLastTick(at); },
        onDelta: (event) => {
          setEvents((rows) => [{ ...event, id: `${event.at}-${rows.length}` }, ...rows].slice(0, 12));
          /* A REAL notification for a REAL on-chain movement. When the
             detected transfer matches the order's direction, it goes through
             the same pipeline every other notification uses: mirrored into
             the in-app inbox (the settings-badge bell) always, and shown as
             an OS notification when permission is granted. The wording stays
             "deposit/withdrawal detected" — a balance delta proves a
             transfer, never a payment. */
          const match = sell ? event.direction === 'out' : event.direction === 'in';
          if (match) {
            showLocalNotification(
              event.direction === 'in' ? t('buySell.watch.eventIn') : t('buySell.watch.eventOut'),
              {
                body: `${event.direction === 'in' ? '+' : '−'}${event.amount} ${event.symbol} · ${shortAddress(address)}`,
                tag: `fbt-watch-${address}-${event.at}`,
                data: { url: '/buy' }
              }
            );
          }
        }
      });
      setWatching(true);
    } catch {
      setError('WATCH_NO_PROVIDER');
    }
  }, [address, meta, ready, sell, t, wallet]);

  /* The wizard bumps `autoStart` right after the guided handoff opens, so
     the report begins the moment there is something real to wait for. */
  useEffect(() => {
    if (autoStart > 0 && autoStart !== startedForRef.current) {
      startedForRef.current = autoStart;
      stop(); start();
    }
  }, [autoStart, start, stop]);

  /* Inputs changed → the old watch is about a different wallet/token. */
  useEffect(() => () => stopRef.current?.(), []);
  useEffect(() => { stop(); }, [address, asset, network, stop]);

  const timeOf = (at) => {
    try { return new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(at); }
    catch { return new Date(at).toLocaleTimeString(); }
  };
  const matches = (event) => (sell ? event.direction === 'out' : event.direction === 'in');

  return (
    <motion.section className="lab-card buy-sell-watch" variants={riseIn} initial="hidden" animate="show">
      <div className="buy-sell-watch-head">
        <span className={`buy-sell-watch-dot ${watching ? 'live' : ''}`} aria-hidden="true"><IconActivity width={15} height={15} /></span>
        <div>
          <p className="section-label" style={{ margin: 0 }}>{sell ? t('buySell.watch.titleSell') : t('buySell.watch.titleBuy')}</p>
          <p className="faint" style={{ marginTop: 3, fontSize: 11 }}>{t('buySell.watch.subtitle')}</p>
        </div>
        {watching
          ? <button type="button" className="btn btn-ghost btn-sm buy-sell-watch-toggle" onClick={stop}>{t('buySell.watch.stop')}</button>
          : <button type="button" className="btn btn-ghost btn-sm buy-sell-watch-toggle" disabled={!ready} onClick={start}>{t('buySell.watch.start')}</button>}
      </div>

      {!ready && <p className="buy-sell-watch-hint">{t('buySell.watch.needsInputs')}</p>}

      {ready && (
        <div className="buy-sell-watch-meta">
          <span className="mono" dir="ltr">{shortAddress(address)}</span>
          <span>{asset} · {String(network).toUpperCase()}</span>
          {balance != null && <span className="mono" dir="ltr">{balance} {asset}</span>}
        </div>
      )}

      {watching && (
        <p className="buy-sell-watch-status" aria-live="polite">
          <span className="buy-sell-watch-pulse" aria-hidden="true" />
          {sell ? t('buySell.watch.watchingSell') : t('buySell.watch.watchingBuy')}
          {lastTick && <small> · {t('buySell.watch.lastChecked', { time: timeOf(lastTick) })}</small>}
        </p>
      )}

      {error && <p className="buy-sell-watch-hint">{t('buySell.watch.providerError')}</p>}

      {events.length > 0 && (
        <ul className="buy-sell-watch-events" aria-live="polite">
          {events.map((event) => (
            <li key={event.id} className={matches(event) ? 'match' : ''}>
              <span className={`buy-sell-watch-kind ${event.direction}`}>
                {matches(event) ? <IconCheck width={13} height={13} /> : <IconActivity width={13} height={13} />}
              </span>
              <div>
                <b dir="ltr">{event.direction === 'in' ? '+' : '−'}{event.amount} {event.symbol}</b>
                <small>
                  {event.direction === 'in' ? t('buySell.watch.eventIn') : t('buySell.watch.eventOut')}
                  {matches(event) ? ` — ${t('buySell.watch.eventMatch')}` : ''} · {timeOf(event.at)}
                </small>
              </div>
            </li>
          ))}
        </ul>
      )}

      {watching && events.length === 0 && <p className="buy-sell-watch-hint">{t('buySell.watch.noneYet')}</p>}

      {ready && meta?.explorer && (
        <a className="buy-sell-tx-link" href={explorerAddr(meta.chainId, address)} target="_blank" rel="noreferrer">
          {t('buySell.watch.viewOnExplorer')} <IconChevronRight width={14} height={14} />
        </a>
      )}

      <p className="buy-sell-watch-honesty"><IconShield width={13} height={13} /> {t('buySell.watch.honestNote')}</p>
    </motion.section>
  );
}
