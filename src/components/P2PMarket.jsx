import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { riseIn } from './PageTransition';
import SegIndicator from './SegIndicator';
import Sheet from './Sheet';
import { useTelegram } from '../context/TelegramContext';
import { useWallet } from '../context/WalletContext';
import { fetchP2PMeta, fetchP2POffers } from '../lib/p2pMarket';
import { btcAddressInfo } from '../lib/btcAddress';
import { openUrl } from '../lib/browser';
import { fmtNum, fmtQty } from '../lib/format';
import {
  IconCheck, IconChevronLeft, IconExternal, IconGlobe, IconRefresh, IconShield, IconSwap, IconUser
} from './Icons';

/**
 * P2P MARKET — live Hodl Hodl offers, shared by /buy and /p2p.
 * ---------------------------------------------------------------------------
 * ─── WHY ONE COMPONENT, NO COPY-PASTE ─────────────────────────────────────
 * The Buy screen and the P2P screen sell the same market. Two implementations
 * would drift the way this repo has watched twice before, so both pages mount
 * THIS. The pages keep their own framing (address card and safety warnings on
 * /buy, the OTC tab and scam education on /p2p); everything about the market
 * lives here exactly once.
 *
 * ─── THE REVENUE DESIGN, IN ONE PARAGRAPH ─────────────────────────────────
 * The desk's escrow is on Hodl Hodl and pays us 5-10% of THEIR ~0.5% fee
 * (~0.03% of volume). Our own swap pays 0.70% of volume. This component is
 * therefore deliberately a FUNNEL: it ends every flow with an internal CTA
 * into /swap (BTCB preselected on BNB Chain via the swap screen's existing
 * ?from/?to prefill — zero changes on the swap path, see the anti-cannibal
 * wiring test), and it never prices, suggests or links a crypto-to-crypto
 * alternative. The CTA is the point of the feature, not a decoration.
 *
 * ─── NO POLLING, ON PURPOSE ───────────────────────────────────────────────
 * Upstream's anonymous budget is 2 reads/minute and answers 429 past it. A
 * 30s interval per open screen would burst the server-wide budget and take
 * the market down for everyone. Freshness comes from filter changes, a
 * manual refresh button, and the server's 25s cache; when upstream refuses,
 * the stale copy is labelled with its age instead of pretending to be live.
 *
 * ─── NETWORK DISCIPLINE ───────────────────────────────────────────────────
 * Meta lists: one parallel fetch per session, memoized in lib/p2pMarket.
 * Offers: 350ms debounce, every request aborts its predecessor, and a
 * monotonic sequence number discards late arrivals — a slow answer may
 * never overwrite a newer filter. Unmount aborts the in-flight request and
 * invalidates the sequence, so no setState lands after unmount.
 */

const PAGE = 20;
const DEBOUNCE_MS = 350;

const FALLBACK_CURRENCIES = [
  { code: 'USD', name: 'US Dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'TRY', name: 'Turkish Lira' },
  { code: 'AED', name: 'UAE Dirham' },
  { code: 'RUB', name: 'Russian Ruble' }
];

const emptyInputs = () => ({ amount: '', currency: 'USD', paymentMethod: '', country: '', layer: 'any' });

/** Age in minutes/hours for the stale label. */
function staleAge(t, fetchedAt) {
  const mins = Math.max(1, Math.round((Date.now() - fetchedAt) / 60000));
  if (mins < 120) return t('p2pMarket.staleMin', { n: mins });
  return t('p2pMarket.staleHours', { n: Math.round(mins / 60) });
}

export default function P2PMarket({ side: controlledSide, onSideChange }) {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const navigate = useNavigate();
  const wallet = useWallet();

  /* side is controllable by the page (Buy keeps its address card in sync);
     standalone it manages itself. Either way BOTH sides' inputs are kept in
     parallel state, so switching tabs loses nothing. */
  const [innerSide, setInnerSide] = useState('buy');
  const side = controlledSide ?? innerSide;
  const setSide = (s) => {
    haptic?.('select');
    if (onSideChange) onSideChange(s);
    else setInnerSide(s);
  };

  const [inputs, setInputs] = useState({ buy: emptyInputs(), sell: emptyInputs() });
  const input = inputs[side];
  const patch = useCallback(
    (p) => setInputs((s) => ({ ...s, [side]: { ...s[side], ...p } })),
    [side]
  );
  const [workingNow, setWorkingNow] = useState(false);

  /* BTC receive address (buy tab). Separate from `inputs` because it is
     guidance for ONE direction; the desk releases to an address set on their
     site, we only verify format here. */
  const [btcAddress, setBtcAddress] = useState('');
  const [addressTouched, setAddressTouched] = useState(false);

  /* Auto-fill per spec: only when the connected wallet's address actually IS
     a valid Bitcoin address. This app's wallet is EVM/Solana, so in practice
     the field stays manual — prefill code must never make an 0x address look
     like a BTC destination. */
  useEffect(() => {
    if (!addressTouched && wallet?.address && btcAddressInfo(wallet.address).valid) {
      setBtcAddress(wallet.address);
    }
  }, [wallet?.address, addressTouched]);

  /* ── THE INTERNAL BITCOIN LEG ──────────────────────────────────────────
     The wallet this app itself runs (local vault, unlocked) now has a real
     BIP-84 address — same seed, same 12-word backup. When it exists, the buy
     tab OFFERS it (button below) instead of sending the user to TrustWallet
     to fetch a paste, and the hint copy stops claiming the app has no
     bitcoin wallet. Injected/locked wallets still get the old honest text:
     no phrase in memory ⇒ no internal address to offer, ever. */
  const [internalBtc, setInternalBtc] = useState(null);
  const localUnlocked = wallet?.mode === 'local' && !wallet?.locked && Boolean(wallet?.address);
  useEffect(() => {
    if (!localUnlocked) { setInternalBtc(null); return undefined; }
    let alive = true;
    (async () => {
      const { btcAddressForSigner } = await import('../lib/btcWallet');
      const addr = await btcAddressForSigner(wallet.getSigner?.(), { index: 0 });
      if (alive) setInternalBtc(addr);
    })();
    return () => { alive = false; };
  }, [localUnlocked, wallet?.address]);

  const addressInfo = useMemo(
    () => (btcAddress ? btcAddressInfo(btcAddress) : null),
    [btcAddress]
  );

  /* ------------------------------ meta lists ---------------------------- */
  const [meta, setMeta] = useState({ status: 'loading', currencies: [], countries: [], paymentMethods: [] });
  useEffect(() => {
    let alive = true;
    fetchP2PMeta()
      .then((m) => {
        if (!alive) return;
        setMeta({
          status: m.currencies.length || m.paymentMethods.length ? 'ok' : 'err',
          currencies: m.currencies,
          countries: m.countries,
          paymentMethods: m.paymentMethods
        });
      })
      .catch(() => alive && setMeta((s) => ({ ...s, status: 'err' })));
    return () => { alive = false; };
  }, []);

  const currencyOptions = meta.currencies.length ? meta.currencies : FALLBACK_CURRENCIES;

  /* ------------------------------ offers fetch --------------------------- */
  const [offers, setOffers] = useState({ status: 'loading', list: [], stale: false, fetchedAt: 0, hasMore: false, error: null });
  const [offset, setOffset] = useState(0);
  const seqRef = useRef(0);
  const ctrlRef = useRef(null);
  const [refreshTick, setRefreshTick] = useState(0);

  /* The debounced parameter snapshot. Primitive join so the effect compares
     by value, not by object identity. */
  const queryKey = [
    side, input.amount, input.currency, input.paymentMethod, input.country, input.layer, workingNow
  ].join('|');

  useEffect(() => {
    const timer = setTimeout(async () => {
      const mySeq = ++seqRef.current;
      ctrlRef.current?.abort();
      const ctrl = new AbortController();
      ctrlRef.current = ctrl;

      setOffers((s) => ({ ...s, status: 'loading', error: null }));
      const r = await fetchP2POffers(
        {
          side,
          amount: input.amount || null,
          currency: input.currency || null,
          paymentMethod: input.paymentMethod || null,
          country: input.country || null,
          layer: input.layer,
          workingNow,
          limit: PAGE,
          offset: 0
        },
        { signal: ctrl.signal }
      );
      /* A newer request (or unmount) already superseded this one. */
      if (mySeq !== seqRef.current) return;
      if (r.aborted) return;
      setOffset(0);
      if (!r.ok) {
        setOffers({ status: 'error', list: [], stale: false, fetchedAt: 0, hasMore: false, error: r.error || 'NETWORK' });
        return;
      }
      setOffers({
        status: 'ok',
        list: r.data.offers ?? [],
        stale: Boolean(r.data.stale),
        fetchedAt: r.data.fetchedAt || Date.now(),
        hasMore: Boolean(r.data.hasMore),
        error: null
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, refreshTick]);

  /* Unmount: cancel everything, invalidate every pending sequence. */
  useEffect(
    () => () => {
      seqRef.current += 1;
      ctrlRef.current?.abort();
    },
    []
  );

  const [moreLoading, setMoreLoading] = useState(false);
  const loadMore = useCallback(async () => {
    const next = offset + PAGE;
    const mySeq = ++seqRef.current;
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setMoreLoading(true);
    const r = await fetchP2POffers(
      {
        side,
        amount: input.amount || null,
        currency: input.currency || null,
        paymentMethod: input.paymentMethod || null,
        country: input.country || null,
        layer: input.layer,
        workingNow,
        limit: PAGE,
        offset: next
      },
      { signal: ctrl.signal }
    );
    setMoreLoading(false);
    if (mySeq !== seqRef.current || r.aborted) return;
    if (!r.ok) return; /* keep what we have; the retry is "load more" again */
    setOffset(next);
    setOffers((s) => {
      const seen = new Set(s.list.map((o) => o.id));
      const appended = (r.data.offers ?? []).filter((o) => !seen.has(o.id));
      return {
        ...s,
        list: [...s.list, ...appended],
        stale: Boolean(r.data.stale),
        fetchedAt: r.data.fetchedAt || s.fetchedAt,
        hasMore: Boolean(r.data.hasMore)
      };
    });
  }, [offset, side, input, workingNow]);

  /* ------------------------------ selection ------------------------------ */
  const [selectedId, setSelectedId] = useState(null);
  const selected = useMemo(
    () => offers.list.find((o) => o.id === selectedId) ?? null,
    [offers.list, selectedId]
  );

  /* The offer the sticky bar quotes: best-priced card that accepts the
     amount. With no amount entered, simply the top card. */
  const bestOffer = useMemo(() => {
    if (!offers.list.length) return null;
    if (!input.amount) return offers.list[0];
    return offers.list.find((o) => o.fitsAmount !== false && o.price != null) ?? offers.list[0];
  }, [offers.list, input.amount]);

  const summaryQuote = bestOffer?.quote ?? null;

  const openSheet = (offer) => {
    haptic?.('light');
    setSelectedId(offer.id);
  };

  const openTrade = (url) => {
    haptic?.('medium');
    void openUrl(url);
  };

  /* ------------------------------ swap CTA ------------------------------- */
  /* Internal, one tap, on the HOUSE path — this is the revenue of the whole
     feature. BTCB is the bitcoin asset on the swap screen's default chain
     (BNB Chain, 56) and picks up via its existing ?from=/?to= prefill; the
     swap path itself is untouched. */
  const swapCta = useMemo(() => {
    if (side === 'buy') {
      const qty = summaryQuote?.netBtc ?? summaryQuote?.grossBtc ?? null;
      const q = qty && qty > 0 ? `&amount=${qty}` : '';
      return { to: `/swap?from=BTCB&to=USDT${q}`, title: t('p2pMarket.swapCta.buyTitle'), body: t('p2pMarket.swapCta.buyBody'), btn: t('p2pMarket.swapCta.buyBtn') };
    }
    return { to: '/swap?to=BTCB', title: t('p2pMarket.swapCta.sellTitle'), body: t('p2pMarket.swapCta.sellBody'), btn: t('p2pMarket.swapCta.sellBtn') };
  }, [side, summaryQuote, t]);

  const refresh = () => {
    haptic?.('light');
    setRefreshTick((n) => n + 1);
  };

  const tErr = (code) =>
    code === 'UPSTREAM_RATE_LIMIT' ? t('p2pMarket.err.rate')
    : code === 'UPSTREAM_UNAVAILABLE' ? t('p2pMarket.err.unavailable')
    : t('p2pMarket.err.network');

  return (
    <div className="p2pm">
      {/* ---------------------------- buy / sell ---------------------------- */}
      <div className="segmented" role="tablist" aria-label={t('p2pMarket.sideLabel')}>
        {['buy', 'sell'].map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={side === k}
            className={side === k ? 'active' : ''}
            onClick={() => setSide(k)}
            style={{ isolation: 'isolate' }}
          >
            {side === k && <SegIndicator id="p2pmarket" />}
            {t(`p2pMarket.tab.${k}`)}
          </button>
        ))}
      </div>

      {/* ------------------------------ filters ----------------------------- */}
      <motion.section className="p2pm-filters" variants={riseIn} initial="hidden" animate="show">
        <div className="p2pm-amount-row">
          <div className="p2pm-field p2pm-field-amount">
            <label className="field-label" htmlFor="p2pm-amount">{t('p2pMarket.amount.label')}</label>
            <input
              id="p2pm-amount"
              dir="ltr"
              inputMode="decimal"
              autoComplete="off"
              placeholder={t('p2pMarket.amount.placeholder')}
              aria-label={t('p2pMarket.amount.label')}
              value={input.amount}
              onChange={(e) => {
                const v = e.target.value.replace(/[^\d.]/g, '');
                if (/^\d{0,9}(\.\d{0,2})?$/.test(v)) patch({ amount: v });
              }}
            />
          </div>
          <div className="p2pm-field">
            <label className="field-label" htmlFor="p2pm-currency">{t('p2pMarket.currency.label')}</label>
            <select
              id="p2pm-currency"
              aria-label={t('p2pMarket.currency.label')}
              value={input.currency}
              onChange={(e) => patch({ currency: e.target.value })}
            >
              {currencyOptions.map((c) => (
                <option key={c.code} value={c.code}>{c.code}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="p2pm-amount-row">
          <div className="p2pm-field">
            <label className="field-label" htmlFor="p2pm-method">{t('p2pMarket.method.label')}</label>
            <select
              id="p2pm-method"
              aria-label={t('p2pMarket.method.label')}
              value={input.paymentMethod}
              onChange={(e) => patch({ paymentMethod: e.target.value })}
            >
              <option value="">{t('p2pMarket.method.any')}</option>
              {meta.paymentMethods.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
          {meta.countries.length > 0 && (
            <div className="p2pm-field">
              <label className="field-label" htmlFor="p2pm-country">{t('p2pMarket.country.label')}</label>
              <select
                id="p2pm-country"
                aria-label={t('p2pMarket.country.label')}
                value={input.country}
                onChange={(e) => patch({ country: e.target.value })}
              >
                <option value="">{t('p2pMarket.country.any')}</option>
                {meta.countries.map((c) => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button
            className={`p2pm-toggle ${input.layer === 'onchain' ? 'active' : ''}`}
            aria-pressed={input.layer === 'onchain'}
            onClick={() => patch({ layer: input.layer === 'onchain' ? 'any' : 'onchain' })}
          >
            {t('p2pMarket.layer.onchain')}
          </button>
          <button
            className={`p2pm-toggle ${input.layer === 'fast' ? 'active' : ''}`}
            aria-pressed={input.layer === 'fast'}
            onClick={() => patch({ layer: input.layer === 'fast' ? 'any' : 'fast' })}
          >
            {t('p2pMarket.layer.fast')}
          </button>
          <button
            className={`p2pm-toggle ${workingNow ? 'active' : ''}`}
            aria-pressed={workingNow}
            onClick={() => setWorkingNow((v) => !v)}
          >
            {t('p2pMarket.workingNow')}
          </button>
          <button className="p2pm-toggle" onClick={refresh} aria-label={t('p2pMarket.refresh')}>
            <IconRefresh width={13} height={13} />
          </button>
        </div>
      </motion.section>

      {/* ----------------------- BTC receive address ------------------------ */}
      {side === 'buy' && (
        <motion.section className="p2pm-address" variants={riseIn} initial="hidden" animate="show">
          <label className="field-label" htmlFor="p2pm-btc-addr">{t('p2pMarket.address.title')}</label>
          <input
            id="p2pm-btc-addr"
            dir="ltr"
            autoComplete="off"
            spellCheck="false"
            className={`mono ${addressInfo ? (addressInfo.valid ? 'p2pm-addr-ok' : 'p2pm-addr-bad') : ''}`}
            placeholder={t('p2pMarket.address.placeholder')}
            aria-label={t('p2pMarket.address.title')}
            aria-invalid={Boolean(addressInfo && !addressInfo.valid)}
            value={btcAddress}
            onChange={(e) => {
              setAddressTouched(true);
              setBtcAddress(e.target.value.trim());
            }}
          />
          <p className="prose-sm" style={{ marginTop: 6 }}>
            {internalBtc ? t('p2pMarket.address.hintInternal') : t('p2pMarket.address.hint')}
          </p>
          {internalBtc && !addressTouched && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              style={{ marginTop: 8, minHeight: 38, borderRadius: 12 }}
              onClick={() => { setAddressTouched(true); setBtcAddress(internalBtc); haptic?.('light'); }}
            >
              {t('p2pMarket.address.useAppWallet')}
            </button>
          )}
          {addressInfo && !addressInfo.valid && (
            <p className="p2pm-addr-msg p2pm-addr-bad" role="alert">{t('p2pMarket.address.invalid')}</p>
          )}
          {addressInfo?.valid && (
            <p className="p2pm-addr-msg p2pm-addr-ok">
              <IconCheck width={12} height={12} /> {t('p2pMarket.address.valid')}
            </p>
          )}
        </motion.section>
      )}

      {/* ------------------------------ stale note -------------------------- */}
      {offers.stale && offers.status === 'ok' && (
        <p className="notice" role="status">
          {t('p2pMarket.stale', { age: staleAge(t, offers.fetchedAt) })}
        </p>
      )}

      {/* ------------------------------ offer list -------------------------- */}
      <div className="p2pm-list" role="list" aria-label={t('p2pMarket.listLabel')} aria-busy={offers.status === 'loading'}>
        {offers.status === 'loading' ? (
          [0, 1, 2, 3].map((i) => <div key={i} className="p2pm-card skel" aria-hidden="true" />)
        ) : offers.status === 'error' ? (
          <div className="p2pm-empty">
            <p className="prose-sm">{tErr(offers.error)}</p>
            <button className="btn btn-ghost btn-sm" onClick={refresh}>{t('p2pMarket.err.retry')}</button>
          </div>
        ) : offers.list.length === 0 ? (
          <div className="p2pm-empty">
            <p style={{ fontWeight: 700, fontSize: 13.5 }}>{t('p2pMarket.none.title')}</p>
            <p className="prose-sm">{t('p2pMarket.none.body')}</p>
            <button className="btn btn-ghost btn-sm" onClick={refresh}>{t('p2pMarket.err.retry')}</button>
          </div>
        ) : (
          offers.list.map((o) => (
            <OfferCard
              key={o.id}
              offer={o}
              t={t}
              hasAmount={Boolean(input.amount)}
              onTrade={() => openSheet(o)}
            />
          ))
        )}
      </div>

      {offers.status === 'ok' && offers.hasMore && offers.list.length < 300 && (
        <button className="btn btn-ghost" style={{ width: '100%' }} disabled={moreLoading} onClick={loadMore}>
          {moreLoading ? t('p2pMarket.loading') : t('p2pMarket.more')}
        </button>
      )}

      {/* --------------------------- swap hand-off --------------------------- */}
      {/*
        Not an ad. Buying bitcoin here and selling it for USDT on our own swap
        is the entire revenue design of this screen; the matching CTA lives at
        the END of the funnel, after the offer list, not above it.
      */}
      <motion.section className="card card-rgb edge-mint p2pm-swap-cta" variants={riseIn} initial="hidden" animate="show">
        <div className="aurora" aria-hidden="true" />
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <span style={{ color: 'var(--rgb-4)', flexShrink: 0 }}>
            <IconSwap width={20} height={20} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>{swapCta.title}</div>
            <p className="prose-sm">{swapCta.body}</p>
            <button
              className="btn btn-primary btn-sm"
              style={{ marginTop: 10 }}
              onClick={() => {
                haptic?.('medium');
                navigate(swapCta.to);
              }}
            >
              {swapCta.btn}
            </button>
          </div>
        </div>
      </motion.section>

      {/* --------------------------- sticky summary -------------------------- */}
      <div className="p2pm-bar" role="region" aria-label={t('p2pMarket.summary.label')}>
        <div className="p2pm-bar-figures" dir="ltr">
          {summaryQuote ? (
            <>
              <span className="p2pm-bar-fiat">
                {side === 'buy'
                  ? `${fmtNum(summaryQuote.payFiat, 2)} ${bestOffer.currencyCode ?? input.currency}`
                  : `${fmtQty(summaryQuote.depositBtc ?? summaryQuote.tradeBtc)} BTC`}
              </span>
              <IconChevronLeft width={14} height={14} className="p2pm-bar-arrow" />
              <span className="p2pm-bar-btc">
                {side === 'buy'
                  ? `${fmtQty(summaryQuote.netBtc ?? summaryQuote.grossBtc)} BTC`
                  : `${fmtNum(summaryQuote.receiveFiat, 2)} ${bestOffer.currencyCode ?? input.currency}`}
              </span>
            </>
          ) : (
            <span className="p2pm-bar-hint">{t('p2pMarket.summary.hint')}</span>
          )}
        </div>
        <button
          className="btn btn-primary"
          disabled={!bestOffer || (Boolean(input.amount) && bestOffer.fitsAmount === false)}
          onClick={() => bestOffer && openSheet(bestOffer)}
        >
          {t('p2pMarket.summary.continue')}
        </button>
      </div>

      {/* ------------------------- disclosure sheet -------------------------- */}
      <TradeSheet
        offer={selected}
        side={side}
        amount={input.amount}
        currency={input.currency}
        btcAddress={addressInfo?.valid ? btcAddress : ''}
        t={t}
        onClose={() => setSelectedId(null)}
        onOpen={openTrade}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Offer card                                                                  */
/* -------------------------------------------------------------------------- */

function OfferCard({ offer: o, t, hasAmount, onTrade }) {
  const out = hasAmount && o.fitsAmount === false;
  const online = o.trader.onlineStatus === 'online';
  const ratingPct = o.trader.rating != null ? Math.round(o.trader.rating * 100) : null;

  const deviation =
    o.priceSource === 'exchange_rate' && o.exchangePriceDeviation != null && o.exchangePriceSign
      ? `${o.exchangePriceSign}${fmtNum(Math.abs(o.exchangePriceDeviation), o.exchangePriceUnit === '%' ? 1 : 2)}${o.exchangePriceUnit === '%' ? '%' : ''}`
      : null;
  const devPositive = o.exchangePriceSign === '+';

  return (
    <div className={`p2pm-card ${out ? 'p2pm-card-out' : ''}`} role="listitem">
      <div className="p2pm-card-top">
        <div className="p2pm-price" dir="ltr">
          {o.price != null ? fmtNum(o.price, 2) : '—'}
          <span className="p2pm-price-cc">{o.currencyCode ?? ''}</span>
        </div>
        <div className="p2pm-badges">
          {deviation && (
            <span className={`pill ${devPositive ? 'pill-down' : 'pill-up'}`} dir="ltr">
              {deviation}
            </span>
          )}
          {!o.onchain && <span className="pill pill-neutral">{o.assetLayer}</span>}
          {!o.workingNow && <span className="pill pill-neutral">{t('p2pMarket.card.offline')}</span>}
        </div>
      </div>

      <div className="p2pm-card-mid">
        <span className="p2pm-range" dir="ltr">
          {o.minAmount != null ? fmtNum(o.minAmount, 0) : '?'} – {o.maxAmount ? fmtNum(o.maxAmount, 0) : '?'} {o.currencyCode ?? ''}
        </span>
        {o.paymentWindowMinutes != null && (
          <span className="p2pm-window">{t('p2pMarket.card.window', { n: o.paymentWindowMinutes })}</span>
        )}
        {hasAmount && o.quote && !out && (
          <span className="p2pm-youget" dir="ltr">
            {o.quote.direction === 'buy'
              ? `${fmtQty(o.quote.netBtc ?? o.quote.grossBtc)} BTC`
              : `${fmtQty(o.quote.tradeBtc)} BTC`}
          </span>
        )}
      </div>

      <div className="p2pm-card-methods">
        {o.paymentMethods.slice(0, 3).map((m) => (
          <span key={m.id ?? m.name} className="p2pm-chip">{m.name}</span>
        ))}
        {o.paymentMethods.length > 3 && (
          <span className="p2pm-chip p2pm-chip-more">{t('p2pMarket.card.more', { n: o.paymentMethods.length - 3 })}</span>
        )}
        {o.paymentMethods.length === 0 && <span className="p2pm-chip">{t('p2pMarket.card.askDesk')}</span>}
      </div>

      <div className="p2pm-card-bottom">
        <span className="p2pm-trader">
          <span className={`p2pm-dot ${online ? 'on' : 'off'}`} aria-hidden="true" />
          <IconUser width={12} height={12} />
          {o.trader.login ?? t('p2pMarket.card.anon')}
          {o.trader.verified && <IconCheck width={12} height={12} className="p2pm-verified" />}
        </span>
        {(ratingPct != null || o.trader.tradesCount != null) && (
          <span className="p2pm-stats" dir="ltr">
            {ratingPct != null && <b>{ratingPct}%</b>}
            {o.trader.tradesCount != null && <span> · {t('p2pMarket.card.trades', { n: o.trader.tradesCount })}</span>}
          </span>
        )}
        <button className="btn btn-primary btn-sm p2pm-trade-btn" disabled={out} onClick={onTrade}>
          {t('p2pMarket.card.trade')}
        </button>
      </div>

      {out && (
        <p className="p2pm-outnote">
          {t('p2pMarket.card.outOfRange', {
            min: o.minAmount != null ? fmtNum(o.minAmount, 0) : '?',
            max: o.maxAmount ? fmtNum(o.maxAmount, 0) : '?',
            currency: o.currencyCode ?? ''
          })}
        </p>
      )}
      {!out && o.firstTradeLimited && (
        <p className="p2pm-outnote">
          {t('p2pMarket.card.firstTrade', { amount: fmtNum(o.firstTradeLimit, 0), currency: o.currencyCode ?? '' })}
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The sheet that says what is actually true before a trade leaves the app     */
/* -------------------------------------------------------------------------- */

function TradeSheet({ offer: o, side, amount, currency, btcAddress, t, onClose, onOpen }) {
  if (!o) return <Sheet open={false} onClose={onClose} title="" />;
  const joinUrl = o.trade?.joinUrl ?? null;
  const offerUrl = o.trade?.offerUrl ?? null;
  const q = o.quote;
  const feePct = o.fee?.takerPct;

  const Row = ({ label, value, strong }) => (
    <div className="row-between" style={{ paddingBlock: 5 }}>
      <span className="faint">{label}</span>
      <span className="mono" dir="ltr" style={{ fontWeight: strong ? 800 : 600, fontSize: strong ? 13.5 : 12.5 }}>{value}</span>
    </div>
  );

  return (
    <Sheet open={Boolean(o)} onClose={onClose} title={t('p2pMarket.sheet.title')} size="lg">
      <div className="p2pm-sheet-offer">
        {o.title && <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 4 }}>{o.title}</div>}
        {o.description && <p className="prose-sm">{o.description}</p>}
      </div>

      <div className="p2pm-sheet-rows">
        <Row label={t('p2pMarket.sheet.price')} value={o.price != null ? `${fmtNum(o.price, 2)} ${o.currencyCode ?? currency}` : '—'} />
        {(o.minAmount != null || o.maxAmount != null) && (
          <Row
            label={t('p2pMarket.card.range')}
            value={`${fmtNum(o.minAmount ?? 0, 0)} – ${o.maxAmount ? fmtNum(o.maxAmount, 0) : '?'} ${o.currencyCode ?? currency}`}
          />
        )}
        {o.trader.login && (
          <Row
            label={t('p2pMarket.sheet.counterparty')}
            value={`${o.trader.login}${o.trader.tradesCount != null ? ` · ${o.trader.tradesCount}` : ''}`}
          />
        )}
        {q?.direction === 'buy' && (
          <>
            <Row label={t('p2pMarket.sheet.youPay')} value={`${fmtNum(q.payFiat, 2)} ${o.currencyCode ?? currency}`} />
            {q.estFeeBtc != null && feePct != null && (
              <Row label={t('p2pMarket.sheet.feeRow', { pct: fmtNum(feePct, 2) })} value={`${fmtQty(q.estFeeBtc)} BTC`} />
            )}
            <Row label={t('p2pMarket.sheet.youGet')} value={`≈ ${fmtQty(q.netBtc ?? q.grossBtc)} BTC`} strong />
          </>
        )}
        {q?.direction === 'sell' && (
          <>
            <Row label={t('p2pMarket.sheet.youGive')} value={`≈ ${fmtQty(q.depositBtc ?? q.tradeBtc)} BTC`} />
            {q.estFeeBtc != null && feePct != null && (
              <Row label={t('p2pMarket.sheet.feeRow', { pct: fmtNum(feePct, 2) })} value={`${fmtQty(q.estFeeBtc)} BTC`} />
            )}
            <Row label={t('p2pMarket.sheet.youGetFiat')} value={`${fmtNum(q.receiveFiat, 2)} ${o.currencyCode ?? currency}`} strong />
          </>
        )}
        {btcAddress && side === 'buy' && (
          <Row label={t('p2pMarket.sheet.releaseTo')} value={`${btcAddress.slice(0, 10)}…${btcAddress.slice(-6)}`} />
        )}
      </div>

      {/* The three honesty bullets. This sheet exists because of them. */}
      <ul className="prose-list" style={{ marginTop: 14 }}>
        <li>
          <span className="row" style={{ gap: 6 }}>
            <IconShield width={13} height={13} style={{ color: 'var(--rgb-5)', flexShrink: 0 }} />
            {t('p2pMarket.sheet.escrow')}
          </span>
        </li>
        <li>{t('p2pMarket.sheet.fees', { pct: feePct != null ? fmtNum(feePct, 2) : '—' })}</li>
        {/*
          Two bank-side rules that survive the directory, asserted by the
          wiring suite because they exist nowhere else: pay from an account
          in your own name, and never write "crypto" in the bank reference —
          banks freeze accounts over that wording. Only the side that SENDS
          fiat (the buyer) needs them, which is why they show on buy only.
        */}
        {side === 'buy' && <li>{t('p2pMarket.sheet.payOwn')}</li>}
        {side === 'buy' && <li>{t('p2pMarket.sheet.payRef')}</li>}
        <li>{t('p2pMarket.sheet.step')}</li>
      </ul>

      {joinUrl && (
        <>
          <button className="btn btn-primary" style={{ width: '100%', marginTop: 14 }} onClick={() => onOpen(joinUrl)}>
            <IconExternal width={15} height={15} /> {t('p2pMarket.sheet.join')}
          </button>
          <p className="prose-sm" style={{ textAlign: 'center', marginTop: 6 }}>{t('p2pMarket.sheet.joinNote')}</p>
        </>
      )}
      {offerUrl && (
        <button
          className={joinUrl ? 'btn btn-ghost' : 'btn btn-primary'}
          style={{ width: '100%', marginTop: joinUrl ? 8 : 14 }}
          onClick={() => onOpen(offerUrl)}
        >
          <IconExternal width={15} height={15} />
          {joinUrl ? t('p2pMarket.sheet.open') : t('p2pMarket.sheet.openPlain')}
        </button>
      )}
      <p className="faint" style={{ fontSize: 11, marginTop: 12, lineHeight: 1.7 }}>
        <IconGlobe width={11} height={11} /> {t('p2pMarket.sheet.domain')}
      </p>
    </Sheet>
  );
}
