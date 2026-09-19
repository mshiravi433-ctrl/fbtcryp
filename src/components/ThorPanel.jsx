import ThorDepositGuide from './ThorDepositGuide';
import BridgeSigningReview from './BridgeSigningReview';
import { thorDepositState, thorRequestKey } from '../lib/thorDeposit';
import {
  executeThorEvmDeposit,
  normalizeThorTxStatus,
  thorEvmChainId
} from '../lib/thorEvmDeposit';
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { riseIn } from './PageTransition';
import InfoBox from './InfoBox';
import { IconPen } from './Icons';
import {
  assetChain,
  assetLabel,
  fromThorUnits,
  getThorPools,
  getThorQuote,
  getThorTxStatus,
  toThorUnits
} from '../lib/thorswap';
import {
  addressHintFor,
  checkDestination,
  classifyQuoteError,
  shouldSendDestination
} from '../lib/thorAddress';
import { copyText } from '../lib/share';
import { explorerTx } from '../lib/chains';
import ModernSelect from './ModernSelect';
import { useAppStore } from '../store/useAppStore';
import { useTelegram } from '../context/TelegramContext';
import { useWallet } from '../context/WalletContext';
import { POINT_VALUES } from '../lib/ranks';

/**
 * THORChain panel — quote for every chain, SIGN HERE for EVM sources.
 *
 * ─── WHAT CHANGED, AND THE DEEP ANSWER IT CAME FROM ─────────────────────────
 * Asked: «نمیشه در خود سایت ما انجام شود به جای گذاشتن memo و ادرس در تورچین
 * در خود سایت باشد و مشتری امضا کند فقط». For an EVM source the deposit IS
 * an ordinary contract call on a chain the connected wallet already signs for
 * — so the router's depositWithExpiry is built here, with THIS quote's vault,
 * memo and expiry, and the user signs on this page. No THORSwap, no
 * copy-pasted address, no memo in a note field. The construction and every
 * safety re-check live in src/lib/thorEvmDeposit.js.
 *
 * What CANNOT be signed here: Bitcoin-family and Cosmos sources. Those
 * deposits are UTXO spends with OP_RETURN outputs / Cosmos SDK messages —
 * shapes an EVM wallet cannot produce — and for them the manual guide
 * (ThorDepositGuide) remains the honest path, exactly as before.
 */
const DEBOUNCE_MS = 550;

export default function ThorPanel({ initialFrom, initialTo } = {}) {
  const { t, i18n } = useTranslation();
  const notify = useAppStore((s) => s.notify);
  const { haptic } = useTelegram();
  const wallet = useWallet();

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

  /*
   * ─── CAN THIS SWAP BE SIGNED ON THIS PAGE? ──────────────────────────────
   * Three conditions, all cheap, all checked on every render:
   *   1. the SOURCE is one of THORChain's EVM chains (the connected wallet
   *      can sign there);
   *   2. the quote is READY — a destination is set, the memo pays exactly
   *      that address, and the expiry is comfortably in the future
   *      (thorDepositState already refuses 'stale'/'expired'/'mismatch');
   *   3. THORChain returned a router for this source. No router means the
   *      network wants a direct vault transfer — not a shape we can build
   *      safely, so the manual path stays.
   */
  const signChainId = thorEvmChainId(from);
  const canSignHere = Boolean(signChainId) && Boolean(quote?.router) && depositState === 'ready';

  /*
   * The in-site signing flow. `signReview` is the BridgeSigningReview sheet —
   * the same review the LI.FI/deBridge paths show, opened before the FIRST
   * of up to three signatures (reset-approve, approve, deposit) and resolved
   * by the user's choice.
   */
  const [signing, setSigning] = useState(false);
  const [signStep, setSignStep] = useState(null);
  const [signErr, setSignErr] = useState(null);
  const [signReview, setSignReview] = useState(null);
  const signDecision = useRef(null);
  useEffect(() => () => { signDecision.current?.(false); }, []);

  /* The broadcast deposit + its live status through THORChain. Kept at panel
     level (not inside the sign card) so editing the form after signing does
     not throw the tracker away — "where is my money" must survive a change
     of subject. */
  const [depositTx, setDepositTx] = useState(null);
  const [thorStatus, setThorStatus] = useState(null);

  const finishSignReview = (accepted) => {
    signDecision.current?.(accepted);
    signDecision.current = null;
    setSignReview(null);
  };

  const runSign = async () => {
    if (signing || !canSignHere) return;
    setSigning(true);
    setSignErr(null);
    haptic?.('medium');
    try {
      const res = await executeThorEvmDeposit({
        wallet,
        quote,
        from,
        to,
        amount,
        destination,
        confirmSigning: (details) => new Promise((resolve) => {
          /* A second review while one is open must settle the first, not
             leave a dead promise — the same guard Bridge.jsx applies. */
          signDecision.current?.(false);
          signDecision.current = resolve;
          setSignReview(details);
        }),
        onStep: (s) => setSignStep(s)
      });
      setDepositTx({ hash: res.hash, chainId: res.chainId });
      setThorStatus(null);
      haptic?.('success');
      /* A broadcast THORChain deposit is real rewarded activity, same rule
         as the LI.FI/deBridge paths: wallet + chain + txHash as evidence. */
      if (res.hash) {
        const rewards = useAppStore.getState();
        rewards.awardPoints?.('bridge', POINT_VALUES.bridge, {
          network: 'thor', chainId: res.chainId, txHash: res.hash
        });
      }
    } catch (e) {
      setSignErr(String(e?.message || e).split('\n')[0].slice(0, 80) || 'GENERIC');
      haptic?.('error');
    } finally {
      setSigning(false);
      setSignStep(null);
    }
  };


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

  /*
   * Track the deposit through THORChain itself. 404s (the node has not
   * observed a seconds-old hash yet) and transient upstream failures are
   * "still waiting", never an error — the note under the stages says exactly
   * that, because the alternative reading is how people get talked into
   * double-sending. Polling stops the moment the transfer is delivered.
   */
  useEffect(() => {
    if (!depositTx || thorStatus?.delivered) return undefined;
    let alive = true;
    const tick = async () => {
      try {
        const s = await getThorTxStatus(depositTx.hash);
        if (alive) setThorStatus(normalizeThorTxStatus(s));
      } catch { /* keep the last known state */ }
    };
    tick();
    const id = setInterval(tick, 12000);
    return () => { alive = false; clearInterval(id); };
  }, [depositTx, thorStatus?.delivered]);

  /*
   * Pools down ≠ tab down. The explainer and the step guide are STATIC —
   * they cost no API and are exactly what a user stranded by an upstream
   * outage should still be able to read. Collapsing the whole tab into one
   * red sentence threw away the one part that still worked.
   */
  if (poolsErr) return (
    <motion.section variants={riseIn} initial="hidden" animate="show">
      <InfoBox title={t('thor.whatTitle')} tone="info" id="thor-what">
        <p>{t('thor.what1')}</p>
        <p>{t('thor.what2')}</p>
        <p>{t('thor.what3')}</p>
      </InfoBox>
      <ThorDepositGuide from={from} to={to} signable={Boolean(signChainId)} />
      <p className="notice notice-danger" style={{ marginTop: 12 }}>{t('thor.err.POOLS_FAILED')}</p>
    </motion.section>
  );

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

      <ThorDepositGuide from={from} to={to} signable={Boolean(signChainId)} />

      {!pools ? (
        <div className="skel" style={{ height: 180, marginTop: 12 }} />
      ) : (
        <>
          <div className="card" style={{ marginTop: 12 }}>
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

          {quoting && <div className="skel" style={{ height: 90, marginTop: 12 }} />}

          {quoteErr && !quoting && (
            <p className="notice notice-danger" style={{ marginTop: 12 }}>
              {t(`thor.err.${quoteErr}`, { defaultValue: t('thor.err.QUOTE_FAILED') })}
            </p>
          )}

          {quote && currentQuote && !quoting && out != null && (
            <motion.div className="card" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 12 }}>
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

              {/*
                ─── THE ANSWER TO «نمیشه در خود سایت ما انجام شود» ──────────
                For EVM sources this IS the swap: one review sheet, one (or
                three, with the token approval) signatures in the user's own
                wallet, and the router deposit THORChain quoted is built with
                the quote's own vault, memo and expiry. Hidden once a deposit
                has been broadcast — the tracker below takes over, and a
                second tap on a spent quote is not a feature.

                `|| signing` keeps the card mounted while a signature is in
                flight, even if the one-second clock crosses the expiry margin
                mid-flow: a button that disappears under the user's thumb
                mid-sign reads as a failure it was not.
              */}
              {(canSignHere || signing) && !depositTx && (
                <motion.div
                  className="thor-sign"
                  variants={riseIn}
                  initial="hidden"
                  animate="show"
                  aria-label={t('thor.sign.title')}
                >
                  <div className="thor-sign-head">
                    <span className="thor-step-badge" aria-hidden="true">
                      <IconPen width={16} height={16} />
                    </span>
                    {t('thor.sign.title')}
                  </div>
                  <p className="thor-sign-body">
                    {t('thor.sign.body', { source: assetChain(from), asset: assetLabel(from) })}
                  </p>

                  {!wallet.isConnected || !wallet.address ? (
                    <p className="notice" style={{ marginTop: 10 }}>{t('thor.sign.connectFirst')}</p>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ marginTop: 10, width: '100%' }}
                      disabled={signing}
                      onClick={runSign}
                    >
                      {signing
                        ? t(`thor.sign.step.${signStep || 'network'}`)
                        : t('thor.sign.cta', { amount, asset: assetLabel(from) })}
                    </button>
                  )}

                  <p className="thor-sign-alt">{t('thor.sign.manualAlt')}</p>

                  {signErr && !signing && (
                    <p className="notice notice-danger" style={{ marginTop: 10 }}>
                      {t(`thor.sign.err.${signErr}`, { defaultValue: t('thor.sign.err.GENERIC') })}
                    </p>
                  )}
                </motion.div>
              )}

              {depositState === 'ready' && (
                <InfoBox title={t('thor.guide.detailsTitle')} id="thor-deposit-details" tone="warn">
                  {/* The manual path is the ONLY path for non-EVM sources; for
                      EVM it is the alternative — sending from a different
                      wallet than the one connected here. */}
                  {canSignHere && (
                    <p className="faint" style={{ fontSize: 12, marginBottom: 9 }}>
                      {t('thor.sign.manualIntro')}
                    </p>
                  )}
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

          {/*
            The real progress of a deposit signed HERE, from THORChain itself —
            the same honesty the LI.FI tracker gives the tokens tab: a source
            hash is the first of four things that have to happen, and a
            tracker that stops at "sent" is a tracker that lies by omission.

            Lives OUTSIDE the quote card so editing the form after signing
            cannot make it vanish.
          */}
          {depositTx && (
            <motion.div className="card" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 12 }}>
              <div className="thor-track">
                <div className="thor-track-title">
                  <span>{t('thor.sign.trackTitle')}</span>
                  <a
                    className="thor-track-hash"
                    dir="ltr"
                    href={explorerTx(depositTx.chainId, depositTx.hash)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {depositTx.hash.slice(0, 10)}…{depositTx.hash.slice(-8)} ↗
                  </a>
                </div>
                <ul className="thor-track-stages">
                  {(thorStatus ?? normalizeThorTxStatus(null)).stages.map((s) => (
                    <li
                      key={s.key}
                      className={`thor-track-stage ${s.completed ? 'done' : (thorStatus?.pending ?? 'seen') === s.label ? 'active' : ''}`}
                    >
                      <span className="stage-dot" aria-hidden="true" />
                      {t(`thor.sign.track.${s.label}`)}
                    </li>
                  ))}
                </ul>
                {thorStatus?.delivered ? (
                  <p className="notice thor-track-done" style={{ marginTop: 10 }}>{t('thor.sign.done')}</p>
                ) : (
                  <p className="thor-track-note">{t('thor.sign.trackNote')}</p>
                )}
              </div>
            </motion.div>
          )}
        </>
      )}

      {/* The one review sheet before any signature — same component, same
          wording, same poisoning alert as the other money paths on this page. */}
      <BridgeSigningReview review={signReview} onDecision={finishSignReview} />
    </motion.section>
  );
}
