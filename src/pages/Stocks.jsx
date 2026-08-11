import { Suspense, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import CoinLogo from '../components/CoinLogo';
import InfoBox from '../components/InfoBox';
import Sparkline from '../components/Sparkline';
import EquityRow from '../components/EquityRow';
import HistoryPanel from '../components/HistoryPanel';
import { useChart, useMarkets } from '../hooks/useMarket';
import { fmtCompact, fmtPct, fmtPrice, fmtUsd } from '../lib/format';
import { useTelegram } from '../context/TelegramContext';
import { IconExternal, IconShield } from '../components/Icons';
import SegIndicator from '../components/SegIndicator';
import { MIN_EQUITY_LIQUIDITY, getSolanaAssets } from '../lib/solanaAssetsClient';
/*
 * No `venueReferral` import any more, and that absence is deliberate.
 *
 * This screen used to attach our Avantis and UTEX referral codes to outbound
 * buttons under the equity list. Both buttons are gone on instruction — «ما
 * پروموت کننده رایگان هیچ شرکتی نیستیم در صفحه سهام» — so nothing here needs
 * a referral code, and importing the module would leave a loaded gun for the
 * next person editing this file.
 */
import { fetchAvantisEquities } from '../lib/avantisEquities';
import { SPECULATION_ENABLED } from '../lib/features';
import lazyRetry from '../lib/lazyRetry';

/*
 * These are tab routes, not imports. The Stocks page is already a lazy route,
 * but importing the three heavy screens here would still put all of their
 * code—and dYdX's SDK—behind the first Stocks request. Keep each screen in its
 * own chunk and fetch it only after the user selects that tab.
 */
const LazyOstium = SPECULATION_ENABLED ? lazyRetry(() => import('./Ostium')) : null;
const LazyDerivatives = SPECULATION_ENABLED ? lazyRetry(() => import('./DerivativesDashboard')) : null;

/**
 * STOCKS — tokenized equities, RWA sector tokens, and the honest limits.
 *
 * ─── WHAT CHANGED, AND WHY THE OLD COPY WAS WRONG ───────────────────────────
 * This screen used to say "you can't buy Apple stock here" and link out to
 * three licensed issuers. That was true when it was written and is no longer:
 * Backed Finance's xStocks are SPL tokens on Solana, Jupiter routes them, and
 * our own aggregator can quote them. Verified with a live quote before any of
 * this was built:
 *
 *   USDC → AAPLx   platformFee { amount: 224807, feeBps: 70 }
 *
 * Leaving the old copy in place would have been the app lying about its own
 * capability — the same class of error as the "9 Chains" claim.
 *
 * ─── THE THREE THINGS THAT MADE THIS SAFE TO SHIP ───────────────────────────
 *
 * 1. A HARD-CODED MINT LIST, NOT A SEARCH. Querying Jupiter for "AAPLx"
 *    returns seven tokens. One is real ($80k liquidity); the others are
 *    pump.fun clones with the same name, the same symbol and in two cases the
 *    same logo scraped from Google ($3.44 liquidity). Search cannot be made
 *    safe here — the fakes copy whatever signal you rank on.
 *
 * 2. ISSUER VERIFICATION ON EVERY FETCH. The server re-checks each mint's
 *    authority against Backed's own key before the row is returned. A clone
 *    cannot pass this because passing it needs the issuer's private key. Fails
 *    closed: a mismatch makes the row disappear.
 *
 * 3. THE FREEZE WARNING SITS ABOVE THE LIST. Not in a footnote, not behind an
 *    accordion. See the note on that block below for why placement is the
 *    whole point.
 */

/** Protocols building tokenized real-world assets. These are normal tokens. */
const RWA_IDS = ['ondo-finance', 'chainlink', 'maker', 'polymesh', 'centrifuge', 'pendle'];

/**
 * Other licensed issuers, kept from the previous version of this screen.
 *
 * Still useful and still honest: Backed is one issuer among several, these
 * others serve markets and instruments it does not, and someone who wants a
 * KYC'd relationship with a regulated broker should be able to find one from
 * here. We earn nothing from any of them and the copy says so.
 */
const ISSUERS = [
  { id: 'backed', url: 'https://backed.fi', color: 'var(--rgb-1)' },
  { id: 'ondo', url: 'https://ondo.finance', color: 'var(--rgb-2)' },
  { id: 'swarm', url: 'https://swarm.com', color: 'var(--rgb-3)' }
];

/** Sizes for the depth gate. Deliberately the same set the Farm screen uses. */
const AMOUNTS = [100, 1000, 5000];
const STOCK_TABS = SPECULATION_ENABLED
  ? ['equity', 'rwa', 'ostium', 'derivatives']
  : ['equity', 'rwa'];

export default function Stocks() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic, tg } = useTelegram();
  const { data: coins, loading } = useMarkets(100);
  const [tab, setTab] = useState('equity');

  const [assets, setAssets] = useState(null);
  const [assetsError, setAssetsError] = useState(null);
  const [assetsLoading, setAssetsLoading] = useState(true);
  const [amount, setAmount] = useState(AMOUNTS[1]);

  useEffect(() => {
    let alive = true;
    setAssetsLoading(true);
    getSolanaAssets()
      .then((d) => alive && (setAssets(d), setAssetsError(null)))
      .catch((e) => alive && setAssetsError(e))
      .finally(() => alive && setAssetsLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  /*
   * ─── THE AVANTIS TICKER LIST ────────────────────────────────────────────
   * Asked for: «سهام ها باشد در صفحه سهام فقط بنر تبلیغاتی نباشد» — the
   * stocks themselves, not just an advert. See lib/avantisEquities.js.
   *
   * Loaded only on the equity tab. Fetching it while the user is reading the
   * RWA tab would spend a request on a section that is not rendered.
   */
  const [avantis, setAvantis] = useState(null);
  const [avantisLoading, setAvantisLoading] = useState(true);

  useEffect(() => {
    if (tab !== 'equity') return undefined;
    let alive = true;
    setAvantisLoading(true);
    fetchAvantisEquities()
      .then((d) => alive && setAvantis(d))
      .finally(() => alive && setAvantisLoading(false));
    return () => {
      alive = false;
    };
  }, [tab]);

  const rwaCoins = useMemo(
    () => (coins ?? []).filter((c) => RWA_IDS.includes(c.id)),
    [coins]
  );

  /*
   * ─── ONLY THE TICKERS WE CANNOT SELL ────────────────────────────────────
   * The reference table exists to answer "is my ticker here at all". Listing
   * NVDA in it when NVDAx is buyable three sections above would be worse than
   * useless: it puts a row with no button next to a row with one, for the
   * same company, and invites the reader to think the buyable one is broken.
   *
   * Matched on the symbol with the xStock "x" suffix removed, so NVDA pairs
   * with NVDAx. Uppercased both sides because the two feeds disagree on case.
   *
   * ─── AND THE ONE PAIR THAT SUFFIX-STRIPPING MISSES ───────────────────────
   * Alphabet. Backed name it GOOGLx (from GOOGL, the class A ticker) while
   * Avantis list GOOG (class C). Strip the x and you get GOOGL vs GOOG — no
   * match — so Alphabet appeared in BOTH lists: once buyable, once as a
   * reference row with no button, for the same company on one screen.
   *
   * Caught by diffing the two live symbol lists rather than by reading the
   * code. Aliases are explicit because guessing at prefixes would eventually
   * collapse two genuinely different companies into one.
   */
  const refRows = useMemo(() => {
    const rows = avantis?.rows ?? [];
    if (!rows.length) return [];

    /* Avantis symbol -> the xStock ticker that already covers it. */
    const ALIASES = { GOOG: 'GOOGL' };

    const ours = new Set(
      (assets?.equities ?? []).map((e) =>
        String(e.symbol ?? '').toUpperCase().replace(/X$/, '')
      )
    );
    return rows.filter((r) => {
      const sym = String(r.symbol ?? '').toUpperCase();
      return !ours.has(sym) && !ours.has(ALIASES[sym] ?? '');
    });
  }, [avantis, assets]);

  /*
   * A second depth floor on top of the per-trade gate. That one asks "is this
   * ORDER too big for the pool"; this asks "is this pool deep enough to list
   * at all". A market with $5k of depth is not a market, and listing it
   * invites someone to buy something they cannot sell.
   */
  const equities = useMemo(
    () => (assets?.equities ?? []).filter((a) => a.liquidity >= MIN_EQUITY_LIQUIDITY),
    [assets]
  );

  /*
   * Gold, under the same depth floor.
   *
   * Its own section rather than mixed into the equity list: gold is not a
   * company. No earnings, no dividend, no shareholder register — and someone
   * buying it is usually doing something different from someone buying Tesla.
   * Listing them together would blur a distinction worth keeping.
   */
  const commodities = useMemo(
    () => (assets?.commodities ?? []).filter((a) => a.liquidity >= MIN_EQUITY_LIQUIDITY),
    [assets]
  );

  /*
   * 90 days of gold, for the "What the past says" panel below the gold rows.
   *
   * The id is passed as null unless the gold section is ACTUALLY going to
   * render — `useChart` resolves to an empty array on a null id, so nothing is
   * requested. Fetching unconditionally would poll CoinGecko every 60 seconds
   * for a chart nobody is looking at, including on the RWA tab and while the
   * asset list is still loading.
   */
  const goldId = commodities.length > 0 && tab === 'equity' ? 'pax-gold' : null;
  const { data: goldChart } = useChart(goldId, 90);
  const goldSeries = useMemo(
    () => (goldChart ?? []).map((d) => d.p).filter((p) => Number.isFinite(p)),
    [goldChart]
  );

  const open = (url) => {
    haptic?.('light');
    if (tg?.openLink) tg.openLink(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  /*
   * Hand off to the Solana swap screen with the pair pre-filled. Reuses the
   * existing ?from=&to= contract rather than inventing a second one, and the
   * mint address is what travels — never the symbol, because the symbol is the
   * thing the fakes clone.
   */
  const buy = (asset) => {
    haptic?.('select');
    navigate(`/solana?to=${encodeURIComponent(asset.mint)}`);
  };

  return (
    <PageTransition>
      <motion.div variants={riseIn} initial="hidden" animate="show">
        <h1 className="h1">{t('stocks.title')}</h1>
        <p className="muted">{t('stocks.subtitle')}</p>
      </motion.div>

      <div className="segmented" role="tablist" aria-label={t('stocks.title')}>
        {STOCK_TABS.map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            className={tab === k ? 'active' : ''}
            onClick={() => setTab(k)}
            style={{ isolation: 'isolate' }}
          >
            {tab === k && <SegIndicator id="stk" />}
            {t(`stocks.tab.${k}`)}
          </button>
        ))}
      </div>

      {tab === 'equity' ? (
        <>
          <motion.section className="card card-rgb card-glow-cyan" variants={riseIn} initial="hidden" animate="show">
            <div className="sheen" />
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 5 }}>{t('stocks.realTitle')}</div>
            <p className="muted" style={{ fontSize: 12.3, margin: 0 }}>{t('stocks.realBody')}</p>
          </motion.section>

          {/*
            ─── THE WARNING GOES HERE, ABOVE EVERYTHING ──────────────────────
            Placement is the entire decision. Put this at the bottom and it
            becomes the paragraph nobody reads after they have already decided
            — which is exactly how the APKPure rejection happened: an honest
            risk notice three paragraphs below the thing it was warning about
            does not change what anyone does.

            The freeze authority is real and it is used. Tether has frozen over
            $5bn across roughly 10,000 addresses under the same kind of power.
            Backed holds the same authority over every xStock, and a user in a
            jurisdiction the issuer decides not to serve can lose access to a
            position they already own. Nobody should tap Buy without having
            read that sentence first.
          */}
          {/*
            ─── NOW COLLAPSED, ON INSTRUCTION ────────────────────────────────
            Asked for directly: «هشدار را در صفحه باز شونده بزار».

            `defaultOpen` is gone. I argued for keeping it open and the earlier
            comment above still records that reasoning, so it is worth being
            straight about the trade rather than quietly flipping a flag.

            What is lost: the freeze text is no longer read without a tap.
            What is gained is the argument InfoBox itself makes in its header —
            a collapsed box with a clear title IS read, while a stacked wall of
            open red slabs is scrolled past. This tab was carrying two
            permanently-open danger boxes above the first buyable row; at that
            density neither of them was working.

            The title still names the risk, so the fact survives the fold: it
            says the issuer can freeze the token, not "more information".
          */}
          <motion.div variants={riseIn} initial="hidden" animate="show">
            <InfoBox title={t('stocks.freezeTitle')} tone="danger" id="stocks-freeze">
              <p>{t('stocks.freezeBody')}</p>
            </InfoBox>
          </motion.div>

          <section>
            <p className="section-label">{t('stocks.available')}</p>

            {/*
              The order size drives the depth gate below, so it is a control
              rather than a display. Default $1,000: large enough that the
              impact on a thin book is visible, small enough to be realistic.
            */}
            <div className="farm-amounts">
              <span className="faint">{t('stocks.ifIBuy')}</span>
              <div className="row" style={{ gap: 6 }}>
                {AMOUNTS.map((a) => (
                  <button
                    key={a}
                    type="button"
                    className={`tag ${amount === a ? 'active' : ''}`}
                    onClick={() => setAmount(a)}
                  >
                    {fmtUsd(a)}
                  </button>
                ))}
              </div>
            </div>

            {assetsLoading && (
              <div className="stack" style={{ gap: 9, marginTop: 8 }}>
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="skel"
                    style={{ height: 118, borderRadius: 14 }}
                    animate={{ opacity: [0.4, 0.9, 0.4] }}
                    transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.12 }}
                  />
                ))}
              </div>
            )}

            {/*
              No cached fallback, deliberately — see lib/solanaAssetsClient.js.
              A stale equity price can be a whole weekend old, and a cached row
              would survive the issuer check being revoked.
            */}
            {!assetsLoading && assetsError && (
              <p className="notice notice-danger">{t('stocks.unavailable')}</p>
            )}

            {!assetsLoading && !assetsError && equities.length === 0 && (
              <p className="notice">{t('stocks.noneTradeable')}</p>
            )}

            {equities.length > 0 && (
              <motion.div
                className="stack"
                style={{ gap: 10, marginTop: 8 }}
                variants={stagger}
                initial="hidden"
                animate="show"
              >
                {equities.map((a) => (
                  <EquityRow key={a.id} asset={a} amountUsd={amount} onBuy={buy} />
                ))}
              </motion.div>
            )}

            <p className="faint" style={{ marginTop: 10, lineHeight: 1.75 }}>{t('stocks.verifyNote')}</p>
          </section>

          {/*
            ─── GOLD ──────────────────────────────────────────────────────
            Below the equities but under the SAME freeze warning, which is why
            it lives inside this tab rather than getting one of its own: the
            issuer risk is identical and splitting it out would mean either
            repeating the warning or, worse, not repeating it.

            Both tokens are backed one-for-one by a real ounce in a vault.
            PAXG is listed first because Paxos holds a New York trust charter
            and is OCC-regulated, which is the strongest pedigree available
            here — not because it has more liquidity.
          */}
          {commodities.length > 0 && (
            <section>
              <p className="section-label">{t('stocks.gold')}</p>
              <p className="farm-filtered faint">{t('stocks.goldIntro')}</p>
              <motion.div
                className="stack"
                style={{ gap: 10, marginTop: 8 }}
                variants={stagger}
                initial="hidden"
                animate="show"
              >
                {commodities.map((a) => (
                  <EquityRow key={a.id} asset={a} amountUsd={amount} onBuy={buy} />
                ))}
              </motion.div>

              {/*
                ─── "WHAT THE PAST SAYS", ON GOLD ────────────────────────────
                Asked for: «در صفحه سهام گذشته چه میگوید را بزار باشد».

                It is attached to GOLD specifically, and that is a data
                constraint rather than a preference. The equity rows come from
                /api/solana/assets, which returns a Jupiter spot price and a
                24-hour change — one number and a delta, no series at all. The
                panel measures support levels, range position and the largest
                drawdown across a window, so with no window there is nothing
                for it to compute and it would render empty.

                PAXG is different: it is on CoinGecko, so a real 90-day series
                exists and every figure below is measured from it. Gold is
                also the row where the panel earns its place — someone buying
                gold is usually asking "is this a normal price or a spike",
                which is exactly the question it answers.
              */}
              {goldSeries.length >= 20 && (
                <div style={{ marginTop: 10 }}>
                  <HistoryPanel series={goldSeries} days={90} />
                </div>
              )}
            </section>
          )}

          {/*
            Requested by name: «قبل از خرید این را بخوان» and «این ها سهم
            نیستند». Both are the same question — what am I actually buying —
            so they are one box rather than two stacked notices.

            It was `defaultOpen`, on the reasoning that someone who believes a
            tokenised share is a share has misunderstood what they own. That is
            still true — but the box now starts collapsed on instruction
            («هشدار را در صفحه باز شونده بزار»), and the mitigation is that the
            TITLE carries the load-bearing claim rather than a neutral label.
            Folding it hides the detail, not the fact.
          */}
          <InfoBox title={t('stocks.beforeBuy.title')} tone="warn" id="stocks-before">
            <p>{t('stocks.notShares')}</p>
            <p>{t('stocks.beforeBuy.p1')}</p>
            <p>{t('stocks.beforeBuy.p2')}</p>
            <p>{t('stocks.beforeBuy.p3')}</p>
          </InfoBox>

          {/*
            ─── UTEX: THE TICKERS THAT ARE NOT ABOVE ───────────────────────────
            UTEX was registered as a revenue line but appeared in exactly ONE
            place in the whole app — the Earn rank perks, behind Diamond at
            15,000 points. In practice nobody could see it, which makes a live
            30-60% line worth nothing.

            ─── WHY IT SITS BELOW THE REAL EQUITIES AND NOT ABOVE ─────────────
            This is the important decision on this block, and it is a rule this
            project already has: never route a user to a worse product because
            it pays us more. The precedent is deBridge, set to 0.4% instead of
            0.7% because 0.7% measurably left the user worse off than the route
            we already had.

            The same test applies here and it is not close. The rows above are
            backed 1:1 by real shares in custody and earn us 70 bps. UTEX pays
            us far more — 30% of fees, up to 60% — and is the WORSE product for
            the buyer: no broker licence, no share, no shareholder register, no
            compensation scheme. Putting it first would be choosing our margin
            over the user's outcome.

            So it is framed as the honest thing it actually is: the answer to
            "why isn't my ticker in the list". xStocks covers a few dozen large
            caps; someone looking for a smaller US name will not find it above,
            and today that question had no answer at all on this screen.

            ─── AND WHY THE WARNING IS INLINE, NOT IN AN INFOBOX ───────────────
            InfoBox's own rule, quoted from its header: "if it describes what
            the button will do, it stays visible; if it explains how a market
            works or restates policy, it goes in here." That a UTEX position is
            not a share is exactly the first kind. It is also the single fact
            most likely to be misread on a page whose whole subject is buying
            equities — the two must not blur together.
          */}
          {/*
            ─── REFERENCE PRICES. NO LINKS, AND THAT IS THE POINT ─────────────
            Two instructions, both taken literally:

              «لینک تبلیغاتی زیر سهام را حذف کن ما پروموت کننده رایگان هیچ
               شرکتی نیستیم در صفحه سهام»

            The Avantis and UTEX buttons that used to sit here are GONE. Not
            moved, not folded into a box — deleted. We are not anybody's free
            promoter on the screen that sells our own product.

            ─── WHY THE TABLE STAYS WHEN THE LINKS GO ─────────────────────────
            The data was never the problem; the outbound buttons were. These
            are the US tickers that have no tokenised version we can sell —
            NFLX, PLTR, AVGO, INTC and the rest — priced live from Pyth. As a
            reference table it answers "is my ticker here at all", which the
            list above cannot, and it sends nobody anywhere.

            There is no referral code attached to anything in this block and
            no `withReferral` call, so the earnings disclosure that used to
            follow it is gone too: there is nothing left to disclose.
          */}
          <section>
            <p className="section-label">{t('stocks.ref.title')}</p>
            <p className="farm-filtered faint">{t('stocks.ref.intro')}</p>

            {avantisLoading && !avantis ? (
              <div className="stack" style={{ gap: 8, marginTop: 10 }}>
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="skel" style={{ height: 52 }} />
                ))}
              </div>
            ) : !avantis?.live || !refRows.length ? (
              /* Silent when empty. A reference table nobody asked for should
                 not shout about being unavailable. */
              null
            ) : (
              <motion.div
                className="stack"
                style={{ gap: 8, marginTop: 10 }}
                variants={stagger}
                initial="hidden"
                animate="show"
              >
                {refRows.map((r) => (
                  <motion.div key={r.id} className="coin-row" variants={riseIn}>
                    <span
                      className="wallet-badge"
                      style={{ color: 'var(--rgb-5)', fontSize: 10.5, fontFamily: 'var(--font-mono)', flexShrink: 0 }}
                    >
                      {r.symbol.slice(0, 4)}
                    </span>
                    <div className="coin-meta">
                      <div className="coin-sym">{r.symbol}</div>
                      <div className="coin-name">
                        {/*
                          Market hours, not a venue name. US markets are shut
                          most of the week in Tehran and an unlabelled price
                          reads as stale or broken.
                        */}
                        {r.marketOpen === false ? t('stocks.ref.closed') : t('stocks.ref.openNow')}
                      </div>
                    </div>
                    <div className="coin-right">
                      {/*
                        Null stays a dash. Number(null) is 0 and 0 is finite,
                        so "$0.00" is the easy and very misleading bug.
                      */}
                      <div className="mono" style={{ fontSize: 12.5 }}>
                        {r.price ? `$${fmtPrice(r.price)}` : '—'}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </motion.div>
            )}

            {/*
              Says plainly that these are not for sale here and that we are not
              routing anyone anywhere. Without it a price with no button looks
              like a broken buy flow rather than a deliberate reference.
            */}
            <p className="faint" style={{ marginTop: 10, lineHeight: 1.75 }}>
              {t('stocks.ref.note')}
            </p>
          </section>
        </>
      ) : tab === 'rwa' ? (
        <>
          <motion.section className="card card-rgb card-glow-cyan" variants={riseIn} initial="hidden" animate="show">
            <div className="sheen" />
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 5 }}>{t('stocks.rwaTitle')}</div>
            <p className="muted" style={{ fontSize: 12.3, margin: 0 }}>{t('stocks.rwaBody')}</p>
          </motion.section>

          <section>
            <p className="section-label">{t('stocks.rwaTokens')}</p>
            {loading ? (
              <div className="stack" style={{ gap: 8, marginTop: 8 }}>
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="skel" style={{ height: 58 }} />
                ))}
              </div>
            ) : rwaCoins.length === 0 ? (
              <div className="empty">
                <span className="empty-icon">🏛</span>
                {t('stocks.noTokens')}
              </div>
            ) : (
              <motion.div className="stack" style={{ gap: 8, marginTop: 8 }} variants={stagger} initial="hidden" animate="show">
                {rwaCoins.map((c) => (
                  <motion.div
                    key={c.id}
                    className="coin-row"
                    variants={riseIn}
                    onClick={() => navigate(`/coin/${c.id}`)}
                  >
                    <CoinLogo coin={c} />
                    <div className="coin-meta">
                      <div className="coin-sym">{c.symbol}</div>
                      <div className="coin-name">{c.name} · {fmtCompact(c.mcap)}</div>
                    </div>
                    <Sparkline data={c.sparkline?.slice(-40) ?? []} up={c.change24h >= 0} width={54} height={24} />
                    <div className="coin-right">
                      <div className="mono" style={{ fontSize: 12.5 }}>${fmtPrice(c.price)}</div>
                      <div className={`mono ${c.change24h >= 0 ? 'up' : 'down'}`} style={{ fontSize: 10.5 }}>
                        {fmtPct(c.change24h, 1)}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </motion.div>
            )}
            <p className="faint" style={{ marginTop: 9, lineHeight: 1.7 }}>{t('stocks.rwaNote')}</p>
          </section>

          <section>
            <p className="section-label">{t('stocks.issuers')}</p>
            <motion.div className="stack" style={{ gap: 9, marginTop: 8 }} variants={stagger} initial="hidden" animate="show">
              {ISSUERS.map((iss) => (
                <motion.button
                  key={iss.id}
                  className="wallet-option"
                  variants={riseIn}
                  whileTap={{ scale: 0.985 }}
                  onClick={() => open(iss.url)}
                >
                  <span className="wallet-badge" style={{ color: iss.color, fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                    {t(`stocks.issuer.${iss.id}.short`)}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 700, fontSize: 13.5 }}>
                      {t(`stocks.issuer.${iss.id}.name`)}
                    </span>
                    <span className="set-row-sub">{t(`stocks.issuer.${iss.id}.desc`)}</span>
                  </span>
                  <IconExternal width={17} height={17} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                </motion.button>
              ))}
            </motion.div>
          </section>

          <InfoBox title={t('stocks.kycTitle')} tone="info" id="stocks-kyc">
            <p>{t('stocks.kycNotice')}</p>
          </InfoBox>
        </>
      ) : (
        <Suspense fallback={<div className="card" style={{ minHeight: 240, display: 'grid', placeItems: 'center' }}><div className="spinner" /></div>}>
          {tab === 'ostium' && LazyOstium && <LazyOstium />}
          {tab === 'derivatives' && LazyDerivatives && <LazyDerivatives />}
        </Suspense>
      )}

      {/*
        The closing risk notice, also boxed as asked.

        Closed by default, unlike the freeze warning at the top. The difference
        is what each one does: the freeze notice describes something that can
        happen to money the user is about to commit, while this restates the
        general position — no advice, no guarantees, prices move. That is worth
        having and is not worth spending the user's attention on before they
        have even chosen an asset.
      */}
      <InfoBox title={t('stocks.riskTitle')} tone="danger" id="stocks-risk">
        <p>{t('stocks.riskNotice')}</p>
      </InfoBox>
    </PageTransition>
  );
}
