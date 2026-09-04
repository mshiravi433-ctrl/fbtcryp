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
import { useAppStore } from '../store/useAppStore';

/**
 * NATIVE CROSS-CHAIN SWAP — real BTC, not wrapped BTC.
 * ---------------------------------------------------------------------------
 * ─── WHY THIS IS A SEPARATE PANEL AND NOT PART OF THE BRIDGE FORM ───────────
 * The LI.FI bridge moves ERC-20 tokens between EVM chains, and the whole form
 * assumes that: a connected wallet, a chain id, an approve step, a signed
 * transaction. THORChain is a fundamentally different act — you SEND coins to
 * an address the network gives you, with a memo attached, from whatever wallet
 * holds them. There is no connect step and there may be no EVM wallet at all,
 * because the user might be holding Bitcoin.
 *
 * Folding that into the bridge form would have meant a form where half the
 * fields disappear depending on the pair. Two panels behind two tabs is
 * honest about the fact that these are two different operations.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ─── THIS PANEL QUOTES. IT DOES NOT SEND. ───────────────────────────────────
 * ═══════════════════════════════════════════════════════════════════════════
 * Deliberate, and the most important decision here.
 *
 * A THORChain swap is executed by sending funds to an inbound address with an
 * exact memo. On Bitcoin that memo rides in an OP_RETURN output — a thing our
 * app cannot construct, because we hold no Bitcoin keys and never will. Even
 * for chains we could sign on, one wrong character in the memo means the
 * network cannot read the instruction and THE FUNDS ARE GONE. Not reverted:
 * gone.
 *
 * So this shows the quote, the exact inbound address, the exact memo and the
 * expiry, and the user completes it in the wallet that actually holds the
 * coins. That is how every honest THORChain interface handles a wallet it
 * does not control, and it is the only version of this feature that cannot
 * lose somebody's money through a bug of ours.
 *
 * The copy says this plainly rather than implying a one-tap swap.
 */
const DEBOUNCE_MS = 550;

export default function ThorPanel({ initialFrom, initialTo } = {}) {
  const { t } = useTranslation();
  const notify = useAppStore((s) => s.notify);

  const [pools, setPools] = useState(null);
  const [poolsErr, setPoolsErr] = useState(false);

  const [from, setFrom] = useState('BTC.BTC');
  const [to, setTo] = useState('ETH.ETH');
  const [amount, setAmount] = useState('');
  const [destination, setDestination] = useState('');

  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteErr, setQuoteErr] = useState(null);

  const seq = useRef(0);

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
    const units = toThorUnits(amount);
    if (!units || from === to) {
      setQuote(null);
      setQuoteErr(from === to && amount ? 'SAME_ASSET' : null);
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

    const mine = ++seq.current;
    setQuoting(true);
    setQuoteErr(null);

    const id = setTimeout(() => {
      getThorQuote({ from, to, amount: units, destination: dest })
        .then((q) => {
          if (seq.current !== mine) return;
          setQuote(q);
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

    return () => clearTimeout(id);
  }, [from, to, amount, destination]);

  if (poolsErr) return null;

  const out = quote?.expected_amount_out ? fromThorUnits(quote.expected_amount_out) : null;

  const copy = async (value, key) => {
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

      {!pools ? (
        <div className="skel" style={{ height: 180, marginTop: 10 }} />
      ) : (
        <>
          <div className="card" style={{ marginTop: 10 }}>
            <label className="faint" htmlFor="thor-from">{t('thor.from')}</label>
            <select
              id="thor-from"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              style={{ marginTop: 6 }}
            >
              {options.map((p) => (
                <option key={p.asset} value={p.asset}>
                  {assetLabel(p.asset)} · {assetChain(p.asset)}
                </option>
              ))}
            </select>

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

            <label className="faint" htmlFor="thor-to" style={{ display: 'block', marginTop: 12 }}>
              {t('thor.to')}
            </label>
            <select
              id="thor-to"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              style={{ marginTop: 6 }}
            >
              {options.map((p) => (
                <option key={p.asset} value={p.asset}>
                  {assetLabel(p.asset)} · {assetChain(p.asset)}
                </option>
              ))}
            </select>

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

          {quote && !quoting && out != null && (
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

              {/*
                ─── THE EXECUTION DETAILS ────────────────────────────────────
                Shown only once a destination has been entered, because the
                memo ENCODES the destination — displaying an address and memo
                built without one would be handing the user instructions that
                send funds to the wrong place.
              */}
              {quote.inbound_address && quote.memo && (
                <div style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                  <p className="notice notice-danger" style={{ marginBottom: 10 }}>
                    {t('thor.sendWarning')}
                  </p>

                  <div className="faint" style={{ fontSize: 11 }}>{t('thor.inboundAddress')}</div>
                  <div className="mono" style={{ fontSize: 11, wordBreak: 'break-all', marginTop: 3 }}>
                    {quote.inbound_address}
                  </div>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ marginTop: 6 }}
                    onClick={() => copy(quote.inbound_address, 'addressCopied')}
                  >
                    {t('common.copy')}
                  </button>

                  <div className="faint" style={{ fontSize: 11, marginTop: 12 }}>{t('thor.memo')}</div>
                  <div className="mono" style={{ fontSize: 11, wordBreak: 'break-all', marginTop: 3 }}>
                    {quote.memo}
                  </div>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ marginTop: 6 }}
                    onClick={() => copy(quote.memo, 'memoCopied')}
                  >
                    {t('common.copy')}
                  </button>

                  <p className="notice" style={{ marginTop: 12 }}>{t('thor.memoWarning')}</p>
                </div>
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
