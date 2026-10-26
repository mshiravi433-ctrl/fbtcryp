import { motion } from 'framer-motion';
import EquityRow from '../EquityRow';
import GoldHistoryBox from '../GoldHistoryBox';
import { riseIn, stagger } from '../PageTransition';

export default function EquityGoldPanel({
  t,
  assetsLoading,
  assetsError,
  commodities,
  amount,
  buy,
  held,
  sell
}) {
  return (
    <>
      {assetsLoading && (
        <div className="stack" style={{ gap: 9 }}>
          {[0, 1].map((i) => <div key={i} className="skel" style={{ height: 104, borderRadius: 14 }} />)}
        </div>
      )}
      {!assetsLoading && assetsError && <p className="notice notice-danger">{t('stocks.unavailable')}</p>}
      {!assetsLoading && !assetsError && commodities.length === 0 && <p className="notice">{t('stocks.noneTradeable')}</p>}
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
              <EquityRow key={a.id} asset={a} amountUsd={amount} onBuy={buy} holding={held.byMint.get(a.mint) ?? null} onSell={sell} />
            ))}
          </motion.div>

          {/*
            ─── "WHAT THE PAST SAYS", ON GOLD ────────────────────────────
            Asked for: «در صفحه سهام گذشته چه میگوید را بزار باشد» and then
            «در طلا هم گذشته چه میگوید باید در باکس طلا و باکس جمع شونده و
            مدرن باشد».

            Gold-specific, and that is a data constraint rather than a
            preference. The equity rows come from /api/solana/assets, which
            returns a Jupiter spot price and a 24-hour change — one number
            and a delta, no series at all. The panel measures support
            levels, range position and the largest drawdown across a window,
            so with no window there is nothing for it to compute.

            PAXG, XAUt0 and GLDx are all on CoinGecko, so a real 90-day
            series exists for each and every figure in the box is measured
            from it. Gold is also the row where the panel earns its place —
            someone buying gold is usually asking "is this a normal price or
            a spike", which is exactly the question it answers.
          */}
          <div style={{ marginTop: 10 }}>
            <GoldHistoryBox assets={commodities} amountUsd={amount} />
          </div>
        </section>
      )}
    </>
  );
}
