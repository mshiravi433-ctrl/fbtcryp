import { motion } from 'framer-motion';
import CoinLogo from '../CoinLogo';
import InfoBox from '../InfoBox';
import { riseIn, stagger } from '../PageTransition';
import { fmtPrice } from '../../lib/format';

export default function EquityDisclosures({ t, avantis, refRows }) {
  return (
    <>
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
      {/*
        ─── THE REFERENCE TABLE, INSIDE A COLLAPSIBLE BOX ─────────────────
        «این فقط لوگو و اسم هست داده قیمتی نیست ... در باکس باز شونده
        بزار» — a dozen rows of names with no buy action sat on the page
        whether anyone asked for them or not, and between two buy lists
        they read as a broken section. The table stays — it answers "is my
        ticker here at all" with live Pyth numbers — but it folds: the
        closed title already says what it is, and one tap shows the rows.
        When the feed is down the box simply is not rendered, exactly as
        the old empty state behaved.
      */}
      {avantis?.live && refRows.length > 0 && (
        <motion.div variants={riseIn} initial="hidden" animate="show">
          <InfoBox title={t('stocks.ref.title')} tone="info" id="stocks-ref">
            <p className="faint" style={{ marginTop: 0, lineHeight: 1.7 }}>{t('stocks.ref.intro')}</p>
            <motion.div className="stack" style={{ gap: 8, marginTop: 8 }} variants={stagger} initial="hidden" animate="show">
              {refRows.map((r) => (
                <motion.div key={r.id} className="coin-row" variants={riseIn}>
                  {/*
                    Real company logo from the ticker — the same visual
                    language as the buyable rows above, not a text stub.
                    CoinLogo degrades to the monogram if the CDN fails, so a
                    dead logo cannot leave a blank circle.
                  */}
                  <CoinLogo ticker={r.symbol} px={26} />
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
            <p className="faint" style={{ marginTop: 8, marginBottom: 0, lineHeight: 1.75 }}>
              {t('stocks.ref.note')}
            </p>
          </InfoBox>
        </motion.div>
      )}
    </>
  );
}
