import { motion } from 'framer-motion';
import InfoBox from '../InfoBox';
import EquityRow from '../EquityRow';
import EquityHoldings from '../EquityHoldings';
import TopMovers from '../TopMovers';
import RwaHorizonSwapBanners from '../RwaHorizonSwapBanners';
import { IconSearch } from '../Icons';
import { riseIn, stagger } from '../PageTransition';
import { fmtCompact, fmtPct, fmtUsd } from '../../lib/format';
import StockStatMini from './StockStatMini';

export default function EquityBoard({
  t,
  isRTL,
  lang,
  haptic,
  setTab,
  assetsLoading,
  assetsError,
  equities,
  topEquities,
  equityAvg,
  equityDepth,
  solAddress,
  held,
  sell,
  openSolanaWallet,
  AMOUNTS,
  amount,
  setAmount,
  eqSearch,
  setEqSearch,
  EQ_SORTS,
  eqSort,
  setEqSort,
  SECTOR_ORDER,
  eqSector,
  setEqSector,
  visibleEquities,
  buy,
  filteredEquities,
  EQ_PAGE,
  eqShowAll,
  setEqShowAll,
  THIN_ASSETS
}) {
  return (
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

      {/* The RWA + Horizon (افق جهانی) banner: two slides that swap
          horizontally inside one animated glass slab (aurora fields, a
          border comet, a two-ring orb, a self-drawing sparkline), sized
          112/128px. Replaced the 3D flip card: on iPhone the two faces
          painted over each other while rotating — no 3D left for that to
          happen in. Its only buttons are the two slides: the old indicator
          dots were <button>s, and the global 44px tap-target rule turned
          them into the «دکمه چپ و راست» the owner asked to hide. */}
      <motion.div variants={riseIn} initial="hidden" animate="show">
        <RwaHorizonSwapBanners
          haptic={haptic}
          isRTL={isRTL}
          lang={lang}
          onGoRwa={() => setTab('rwa')}
          onGoHorizon={() => setTab('ostium')}
        />
      </motion.div>

      {/*
        ─── TOP MOVERS + STATS, ABOVE THE LIST ────────────────────────────
        The most profitable tokens get their own highlight reel at the top
        rather than hiding inside a sorted table. Tapping an equity card
        buys it — the same hand-off as the row's own Buy button.
      */}
      {!assetsLoading && !assetsError && equities.length > 0 && (
        <motion.div variants={riseIn} initial="hidden" animate="show">
          <TopMovers
            title={t('stocks.topGainers')}
            subtitle={t('stocks.topGainersEquitySub')}
            items={topEquities}
            logoKind="token"
            onSelect={(it) => buy(it.raw)}
            testId="stocks-top-equities"
          />
          <div className="grid-3" style={{ marginTop: 4 }}>
            <StockStatMini label={t('stocks.stats.listed')} value={equities.length} />
            <StockStatMini
              label={t('stocks.stats.avgChange')}
              value={equityAvg != null ? fmtPct(equityAvg, 1) : '—'}
              tone={equityAvg != null ? (equityAvg >= 0 ? 'up' : 'down') : undefined}
            />
            <StockStatMini label={t('stocks.stats.depth')} value={fmtCompact(equityDepth)} />
          </div>
        </motion.div>
      )}

      {/*
        ─── «سهام من», DIRECTLY ABOVE «قابل خرید» ─────────────────────────
        What the connected wallet already holds of the tokens below, read
        from the chain, with a Sell on every row. It sits right above the
        buy list so the two labels answer each other — yours / available —
        and so a buyer who comes back from the wallet finds the token they
        just bought before they find the button they just used. The same
        holdings also light up the matching rows in the list below.
      */}
      <EquityHoldings address={solAddress} held={held} onSell={sell} onOpenWallet={openSolanaWallet} />

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

        {/* Search + sort — views over the verified list, never a new list. */}
        {!assetsLoading && !assetsError && equities.length > 0 && (
          <>
            <div style={{ position: 'relative', marginTop: 10 }}>
              <input
                type="text"
                value={eqSearch}
                onChange={(e) => setEqSearch(e.target.value)}
                placeholder={t('stocks.equitySearchPlaceholder')}
                spellCheck={false}
                autoComplete="off"
                enterKeyHint="search"
                aria-label={t('stocks.equitySearchPlaceholder')}
                style={{
                  width: '100%',
                  fontSize: 12.5,
                  /*
                   * Styled here rather than by a class: this repo's other
                   * search fields are inline too, and a plain <input> picks
                   * up the browser's white box, which is a hole in the dark
                   * theme. The 36px on the icon side is the clear space for
                   * the glyph below — measured, not guessed.
                   */
                  padding: isRTL ? '10px 36px 10px 12px' : '10px 12px 10px 36px',
                  background: 'var(--bg-raised)',
                  border: '1px solid var(--line)',
                  borderRadius: 12,
                  color: 'inherit'
                }}
              />
              <span
                style={{
                  position: 'absolute',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  [isRTL ? 'right' : 'left']: 12,
                  pointerEvents: 'none',
                  color: 'var(--muted)',
                  display: 'flex',
                  alignItems: 'center'
                }}
              >
                <IconSearch width={14} height={14} />
              </span>
            </div>

            <div className="tag-scroll" style={{ marginTop: 8 }}>
              {EQ_SORTS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`tag ${eqSort === s ? 'active' : ''}`}
                  onClick={() => { haptic?.('select'); setEqSort(s); }}
                >
                  {t(`stocks.sort.${s}`)}
                </button>
              ))}
            </div>

            <div className="tag-scroll" style={{ marginTop: 6 }}>
              {SECTOR_ORDER.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`tag ${eqSector === s ? 'active' : ''}`}
                  onClick={() => { haptic?.('select'); setEqSector(s); }}
                >
                  {t(`stocks.sector.${s}`)}
                </button>
              ))}
            </div>
          </>
        )}

        {visibleEquities.length > 0 ? (
          <motion.div
            className="stack"
            style={{ gap: 10, marginTop: 8 }}
            variants={stagger}
            initial="hidden"
            animate="show"
          >
            {visibleEquities.map((a) => (
              <EquityRow key={a.id} asset={a} amountUsd={amount} onBuy={buy} holding={held.byMint.get(a.mint) ?? null} onSell={sell} />
            ))}
          </motion.div>
        ) : (
          !assetsLoading && !assetsError && equities.length > 0 && (
            <p className="notice" style={{ marginTop: 8 }}>
              {eqSearch.trim() ? t('stocks.equityNoMatch') : t('market.sectorEmpty')}
            </p>
          )
        )}

        {filteredEquities.length > EQ_PAGE && (
          <button
            type="button"
            className="btn btn-ghost"
            style={{ marginTop: 10 }}
            onClick={() => { haptic?.('select'); setEqShowAll((v) => !v); }}
          >
            {eqShowAll
              ? t('stocks.showLess')
              : t('stocks.showAll', { count: filteredEquities.length })}
          </button>
        )}

        <p className="faint" style={{ marginTop: 10, lineHeight: 1.75 }}>{t('stocks.verifyNote')}</p>

        {/*
          ─── THE xSTOCKS NOBODY CAN EXIT YET ──────────────────────────────
          Asked for directly: «تعداد سهام تب اول خیلی کمه». It is, and the
          reason is not effort — the whole universe was measured (see the
          note in lib/solanaAssets.js: 223 tickers probed, 161 real xStocks
          found, 22 with a book worth trading). OF THOSE 22, SIXTEEN WERE
          ALREADY LISTED ABOVE. These are the other ~139.

          They are NOT rows with a disabled button, deliberately. A list of
          sixty disabled rows is a wall the reader has to scroll past, and
          the honest way to answer "why is my ticker missing" is a fold-out
          that lists the ticker and says why. No button, no mint, no price:
          `THIN_ASSETS` is not in `EQUITY_ASSETS`, so `findAsset()` cannot
          resolve these mints and the ?to= handoff refuses them.

          InfoBox because this is an explanation, not a warning about the
          tap in front of you — the distinction InfoBox's own header draws.
        */}
        {THIN_ASSETS.length > 0 && (
          <motion.div variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 10 }}>
            <InfoBox
              title={t('stocks.thinTitle', { count: THIN_ASSETS.length })}
              tone="info"
              id="stocks-thin"
            >
              <p>{t('stocks.thinBody')}</p>
              <div className="stack" style={{ gap: 5, marginTop: 8 }}>
                {THIN_ASSETS.map((a) => (
                  <div key={a.id} className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
                    <span className="mono" style={{ fontSize: 12 }}>{a.symbol}</span>
                    <span className="faint" style={{ fontSize: 12 }}>{a.name}</span>
                  </div>
                ))}
              </div>
              <p className="faint" style={{ marginTop: 8, lineHeight: 1.7 }}>{t('stocks.thinNote')}</p>
            </InfoBox>
          </motion.div>
        )}
      </section>
    </>
  );
}
