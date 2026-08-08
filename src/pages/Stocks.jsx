import { useEffect, useMemo, useState } from 'react';
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

  const rwaCoins = useMemo(
    () => (coins ?? []).filter((c) => RWA_IDS.includes(c.id)),
    [coins]
  );

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

      <div className="segmented">
        {['equity', 'rwa'].map((k) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)} style={{ isolation: 'isolate' }}>
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
            ─── NOW A BOX, BUT STILL OPEN BY DEFAULT ─────────────────────────
            Asked to put this warning in a collapsible box. Done — with one
            deliberate qualification: `defaultOpen`.

            The original comment above argued placement is everything, and it
            was right. Collapsing this one CLOSED would undo the reason it sits
            at the top: the freeze authority is real and used, Tether have
            frozen over $5bn across roughly 10,000 addresses under the same
            kind of power, and Backed hold it over every xStock. Someone can
            lose access to a position they already own.

            So the box gives what was asked — one tidy container instead of a
            loose red slab, and the user can fold it away once read — while
            still being visible the first time. That is the same rule already
            applied to `stocks.beforeBuy` directly below.
          */}
          <motion.div variants={riseIn} initial="hidden" animate="show">
            <InfoBox title={t('stocks.freezeTitle')} tone="danger" defaultOpen id="stocks-freeze">
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

            `defaultOpen` because this one is genuinely load-bearing: someone
            who believes a tokenised share is a share has misunderstood what
            they own, and unlike the other explainers on this page that
            misunderstanding survives until it costs them.
          */}
          <InfoBox title={t('stocks.beforeBuy.title')} tone="warn" defaultOpen id="stocks-before">
            <p>{t('stocks.notShares')}</p>
            <p>{t('stocks.beforeBuy.p1')}</p>
            <p>{t('stocks.beforeBuy.p2')}</p>
            <p>{t('stocks.beforeBuy.p3')}</p>
          </InfoBox>
        </>
      ) : (
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
