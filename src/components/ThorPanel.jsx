import ThorDepositGuide from './ThorDepositGuide';
import { thorDepositState, thorRequestKey } from '../lib/thorDeposit';
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { riseIn } from './PageTransition';
import InfoBox from './InfoBox';
import {
  assetChain,
  assetLabel,
  fromThorUnits,
  getThorPools,
  getThorQuote,
  toThorUnits
} from '../lib/thorswap';
import {
  addressHintFor,
  checkDestination,
  classifyQuoteError,
  shouldSendDestination
} from '../lib/thorAddress';
import { copyText } from '../lib/share';
import ModernSelect from './ModernSelect';
import { useAppStore } from '../store/useAppStore';

/** Quote-only THORChain panel. Wallet signing requires chain-specific transaction
 * construction (router deposits / OP_RETURN), not a generic Send operation.
 * See ThorDepositGuide for the supported external completion path.
 */
const DEBOUNCE_MS = 550;

export default function ThorPanel({ initialFrom, initialTo } = {}) {
  const { t, i18n } = useTranslation();
  const notify = useAppStore((s) => s.notify);

  const [pools, setPools] = useState(null);
  const [poolsErr, setPoolsErr] = useState(false);

  const [from, setFrom] = useState(initialFrom || 'BTC.BTC');
  const [to, setTo] = useState(initialTo || 'ETH.ETH');
  const [amount, setAmount] = useState('');
  const [destination, setDestination] = useState('');

  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteErr, setQuoteErr] = useState(null);

  const seq = useRef(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const request = { from, to, amount, destination };
  const depositState = thorDepositState(quote, request, now);
  const currentQuote = quote?.requestKey === thorRequestKey(request);


  useEffect(() => {
    let alive = true;
    getThorPools()
      .then((d) => alive && setPools(d))
      .catch(() => alive && setPoolsErr(true));
    return () => {
      alive = false;
    };
  }, []);

  /*
   * The pool list is already sorted by depth and already excludes halted
   * chains — that filtering happens server-side because a halted pair must
   * never reach a dropdown. Capped at 24 so the picker stays usable; the tail
   * of the list is pools with almost no liquidity.
   */
  const options = useMemo(() => (pools?.items ?? []).slice(0, 24), [pools]);

  /* Quote on a debounce, with a sequence guard so a slow earlier request
     cannot overwrite a newer one — the same race the swap screen fixes. */
  useEffect(() => {
    const mine = ++seq.current;
    setQuote(null);
    const units = toThorUnits(amount);
    if (!units || from === to) {
      setQuote(null);
      setQuoteErr(from === to && amount ? 'SAME_ASSET' : null);
      setQuoting(false);
      return undefined;
    }

    /*
     * ─── A HALF-TYPED ADDRESS MUST NOT BE SENT ────────────────────────────
     * Reported: entering an address made EVERY pair show "no price for this
     * pair - the pool may be shallow". That message was false. The panel sent
     * `destination` on every keystroke, and THORChain rejects the whole quote
     * for an unparseable address:
     *
     *   destination=bc1q2nf -> "bad destination address: unable to parse
     *                           address: THORName doesn't exist: bc1q2nf"
     *
     * So the user saw a red error for the whole time they were typing.
     *
     * Quoting WITHOUT a destination works - production returns a full quote -
     * so while the address is incomplete we omit it and keep showing a live
     * price. It is added once it is actually an address, which is also when
     * the memo it affects becomes real.
     */
    const destState = checkDestination(destination, to);
    const dest = shouldSendDestination(destination, to) ? destination.trim() : undefined;

    /*
     * A COMPLETE address of the WRONG CHAIN is the one state here that is
     * genuinely an error. It will never resolve by typing more, and sending
     * bitcoin to an ethereum address is the most expensive mistake this
     * screen can produce - so it is caught before any request.
     */
    if (destState === 'wrong-chain') {
      setQuote(null);
      setQuoteErr('DEST_WRONG_CHAIN');
      setQuoting(false);
      return undefined;
    }

    setQuoting(true);
    setQuoteErr(null);

    const id = setTimeout(() => {
      getThorQuote({ from, to, amount: units, destination: dest })
        .then((q) => {
          if (seq.current !== mine) return;
          setQuote({ ...q, requestKey: thorRequestKey({ from, to, amount, destination }) });
        })
        .catch((e) => {
          if (seq.current !== mine) return;
          setQuote(null);
          /*
           * Classify from THORChain's OWN words. Previously every failure
           * became the single code QUOTE_FAILED, so a wrong-chain address, a
           * dust-sized amount and a halted chain all printed the same
           * sentence about pool depth - and changing the amount, the action
           * that sentence invites, fixes none of them.
           */
          setQuoteErr(classifyQuoteError(e.detail) || String(e.message || 'QUOTE_FAILED'));
        })
        .finally(() => {
          if (seq.current === mine) setQuoting(false);
        });
    }, DEBOUNCE_MS);

    return () => { clearTimeout(id); ++seq.current; };
  }, [from, to, amount, destination, refreshKey]);

  if (poolsErr) return <p className="notice notice-danger">{t('thor.err.POOLS_FAILED')}</p>;

  const out = quote?.expected_amount_out ? fromThorUnits(quote.expected_amount_out) : null;

  const copy = async (value, key) => {
    if (thorDepositState(quote, request, Date.now()) !== 'ready') return;
    const ok = await copyText(value);
    notify?.(ok ? key : 'copyFailed', ok ? 'success' : 'error');
  };

  return (
    <motion.section variants={riseIn} initial="hidden" animate="show">
      <InfoBox title={t('thor.whatTitle')} tone="info" id="thor-what">
        <p>{t('thor.what1')}</p>
        <p>{t('thor.what2')}</p>
        <p>{t('thor.what3')}</p>
      </InfoBox>

      <ThorDepositGuide from={from} to={to} />

      {!pools ? (
        <div className="skel" style={{ height: 180, marginTop: 10 }} />
      ) : (
        <>
          <div className="card" style={{ marginTop: 10 }}>
            <div className="field-label">{t('thor.from')}</div>
            <ModernSelect
              value={from}
              onChange={setFrom}
              options={options.map((p) => ({
                value: p.asset,
                label: assetLabel(p.asset),
                sublabel: assetChain(p.asset),
                /* BTC.BTC → the coin's own mark; ETH.USDC-0X… → USDC with an
                   Ethereum badge. Both offline, so a phone that cannot reach
                   any icon CDN still sees pictures. */
                symbol: assetLabel(p.asset),
                chain: assetLabel(p.asset) === assetChain(p.asset) ? undefined : assetChain(p.asset),
              }))}
              title={t('thor.from')}
              placeholder={t('thor.from')}
              searchable
              testId="thor-from-select"
            />

            <label className="faint" htmlFor="thor-amt" style={{ display: 'block', marginTop: 12 }}>
              {t('thor.amount')}
            </label>
            <input
              id="thor-amt"
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              placeholder="0.01"
              style={{ marginTop: 6 }}
            />

            <div className="field-label" style={{ marginTop: 12 }}>{t('thor.to')}</div>
            <ModernSelect
              value={to}
              onChange={setTo}
              options={options.map((p) => ({
                value: p.asset,
                label: assetLabel(p.asset),
                sublabel: assetChain(p.asset),
                /* BTC.BTC → the coin's own mark; ETH.USDC-0X… → USDC with an
                   Ethereum badge. Both offline, so a phone that cannot reach
                   any icon CDN still sees pictures. */
                symbol: assetLabel(p.asset),
                chain: assetLabel(p.asset) === assetChain(p.asset) ? undefined : assetChain(p.asset),
              }))}
              title={t('thor.to')}
              placeholder={t('thor.to')}
              searchable
              testId="thor-to-select"
            />

            <label className="faint" htmlFor="thor-dest" style={{ display: 'block', marginTop: 12 }}>
              {t('thor.destination')}
            </label>
            <input
              id="thor-dest"
              type="text"
              value={destination}
              onChange={(e) => setDestination(e.target.value.trim())}
              placeholder={t('thor.destinationPlaceholder')}
              style={{ marginTop: 6, fontSize: 12.5 }}
            />
            {/*
              Inline, not collapsed. This is the "what this tap will do with
              real money" case the InfoBox rule deliberately excludes: the
              destination is where the coins land, and there is no undo.
            */}
            {/*
              The shape the receiving chain expects, shown BEFORE the mistake.
              Someone pasting an address has no way to know BTC wants `bc1…`
              and that this pair will reject `0x…` until it has already failed.
            */}
            {addressHintFor(to) && (
              <div className="faint" style={{ marginTop: 5, fontSize: 11 }}>
                {t('thor.expectsFormat', { format: addressHintFor(to) })}
              </div>
            )}
            <p className="notice" style={{ marginTop: 10 }}>{t('thor.destinationNote')}</p>
          </div>

          {quoting && <div className="skel" style={{ height: 90, marginTop: 10 }} />}

          {quoteErr && !quoting && (
            <p className="notice notice-danger" style={{ marginTop: 10 }}>
              {t(`thor.err.${quoteErr}`, { defaultValue: t('thor.err.QUOTE_FAILED') })}
            </p>
          )}

          {quote && currentQuote && !quoting && out != null && (
            <motion.div className="card" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 10 }}>
              <div className="row-between">
                <span className="faint">{t('thor.youReceive')}</span>
                <span className="mono" style={{ fontSize: 14, fontWeight: 700 }}>
                  {out.toLocaleString(undefined, { maximumFractionDigits: 8 })} {assetLabel(to)}
                </span>
              </div>

              <div className="row-between" style={{ marginTop: 8 }}>
                <span className="faint">{t('thor.totalFee')}</span>
                <span className="mono" style={{ fontSize: 12 }}>
                  {((Number(quote.fees?.total_bps) || 0) / 100).toFixed(2)}%
                </span>
              </div>

              {quote.total_swap_seconds != null && (
                <div className="row-between" style={{ marginTop: 6 }}>
                  <span className="faint">{t('thor.eta')}</span>
                  <span className="mono" style={{ fontSize: 12 }}>
                    ~{Math.round(Number(quote.total_swap_seconds) / 60)} {t('thor.minutes')}
                  </span>
                </div>
              )}

              <div className="thor-quote-validity">
                <span role="status">{depositState === 'ready'
                  ? t('thor.guide.expires', { time: new Date(Number(quote.expiry) * 1000).toLocaleTimeString(i18n.language) })
                  : t(`thor.guide.state.${depositState}`)}</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRefreshKey((n) => n + 1)}>{t('thor.guide.refresh')}</button>
              </div>
              {depositState === 'ready' && (
                <InfoBox title={t('thor.guide.detailsTitle')} id="thor-deposit-details" tone="warn">
                  <p className="notice notice-danger">{t('thor.sendWarning')}</p>
                  <dl className="bridge-addresses">
                    <div><dt>{t('thor.guide.receiveTitle')}</dt><dd dir="ltr">{destination}</dd><p>{t('thor.guide.recipientHelp', { target: assetChain(to) })}</p></div>
                    <div><dt>{t('thor.inboundAddress')}</dt><dd dir="ltr">{quote.inbound_address}</dd>
                      <p>{t('thor.guide.inboundHelp', { source: assetChain(from) })}</p>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(quote.inbound_address, 'addressCopied')}>{t('thor.guide.copyInbound')}</button>
                    </div>
                    {quote.router && <div><dt>{t('thor.guide.routerTitle')}</dt><dd dir="ltr">{quote.router}</dd><p>{t('thor.guide.routerHelp')}</p></div>}
                    <div><dt>{t('thor.memo')}</dt><dd dir="ltr">{quote.memo}</dd>
                      <p>{t('thor.guide.memoHelp')}</p>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(quote.memo, 'memoCopied')}>{t('thor.guide.copyMemo')}</button>
                    </div>
                  </dl>
                  <p className="notice">{t('thor.memoWarning')}</p>
                </InfoBox>
              )}

              {/*
                Honest about where our fee did and did not apply. On Bitcoin
                the memo cannot fit our address, so that swap costs the user
                less and earns us nothing — and saying so is cheap, while
                being caught implying otherwise is not.
              */}
              {quote.feeApplied === false && (
                <p className="faint" style={{ fontSize: 11, marginTop: 10, lineHeight: 1.7 }}>
                  {t('thor.noFeeNote')}
                </p>
              )}
            </motion.div>
          )}
        </>
      )}
    </motion.section>
  );
}
