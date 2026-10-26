import { motion } from 'framer-motion';
import { IconSearch } from '../Icons';
/*
 * The Robinhood board renders through StockTokenCard, which owns the artwork
 * rule for it: TokenIcon (not CoinLogo), because those tiles are CONTRACTS and
 * TokenIcon resolves artwork by chain + address first — the impersonation-proof
 * rule lib/tokenIcon.jsx documents. CoinLogo is for rows with no contract at
 * all (the reference table).
 */
import StockTokenCard from '../StockTokenCard';
import { riseIn, stagger } from '../PageTransition';
import { ROBINHOOD_CHAIN_NAME, referencePriceFor } from '../../lib/stockTokens';

export default function RobinhoodStockBoard({
  t,
  stockUniverse,
  stockUniverseError,
  rhAll,
  pricesLoading,
  visiblePriced,
  isRTL,
  rhSearch,
  setRhSearch,
  rhVisible,
  stockPrices,
  stockCharts,
  chartsLoading,
  avantis,
  rhBuy,
  rhEquities,
  RH_ROWS,
  rhShowAll,
  setRhShowAll,
  haptic
}) {
  return (
    <>
      {/*
        ─── THE TOKENIZED-STOCK UNIVERSE OF ROBINHOOD CHAIN (2026-10-12) ──
        Asked for as «تعداد توکنهای صفحه سهام — توکنهای توکنیزه و RWA —
        خیلی کمه … اعداد را خیلی بیشتر کن». Everything below is a real
        contract read from a public token list: no row is invented, none is
        padded, and each one prints its own address, because the address —
        not the ticker — is what identifies a token. Where that list comes
        from is an implementation detail of lib/stockTokens.js and is no
        longer printed on the screen (see the note above the grid).

        WHY IT IS A SEPARATE SECTION AND NOT MORE ROWS ABOVE. The Solana
        rail's whole promise is that every mint was matched against
        Backed's issuer keys on load. These were not: we have verified no
        issuer here, and that is exactly what the note under the grid says.
        Merging them into the verified rail would quietly transfer a
        promise to rows that never earned it — so they get their own
        heading and a note that states the limit out loud.

        Every «خرید» here goes to /swap with the contract address attached,
        through the same screen, fee and warnings an RWA row uses. Nothing
        is signed on this page.
      */}
      {stockUniverse === null && !stockUniverseError && (
        <section style={{ marginTop: 16 }}>
          <p className="section-label">{t('stocks.rhTitle')}</p>
          <p className="faint" style={{ margin: 0 }}>{t('stocks.rhLoading')}</p>
        </section>
      )}

      {stockUniverseError && (
        <section style={{ marginTop: 16 }}>
          <p className="section-label">{t('stocks.rhTitle')}</p>
          <p className="notice" style={{ marginTop: 6 }}>{t('stocks.rhUnavailable')}</p>
        </section>
      )}

      {rhAll.length > 0 && (
        <section style={{ marginTop: 18 }}>
          {/*
            ─── THE BADGE THAT NAMED UNISWAP IS GONE (2026-10-12) ────────
            Asked for directly: «جملهٔ فهرست رسمی توکنهای یونیسواپ را پاک
            کن، این بکجور تبلیغ میشود». It was a `stocks.rhSource` pill
            reading «فهرست رسمی توکنهای یونیسواپ» — and the note under the
            grid repeated it. Both are removed from the screen: we are not
            an advertising surface for somebody else's list, and the pill
            was never what made these rows safe anyway. What made them safe
            is printed on every card and kept here: WE have not verified the
            issuer, so the contract address is shown on each tile and again
            on the swap screen before anything is signed.

            In its place: the one piece of status this board actually has —
            whether the prices on it are live. Three honest states, no
            logo, no third-party name.
          */}
          <div className="stk-head">
            <div className="stk-head-id">
              <p className="section-label" style={{ margin: 0 }}>{t('stocks.rhTitle')}</p>
              <p className="farm-filtered faint" style={{ margin: '3px 0 0' }}>
                {t('stocks.rhSub', { count: rhAll.length, chain: ROBINHOOD_CHAIN_NAME })}
              </p>
            </div>
            <span className={`stk-live ${pricesLoading ? 'is-loading' : visiblePriced ? '' : 'is-none'}`}>
              <span className="stk-live-dot" aria-hidden="true" />
              {pricesLoading
                ? t('stocks.rhPricesLoading')
                : visiblePriced
                  ? t('stocks.rhPricesLive')
                  : t('stocks.rhPricesNone')}
            </span>
          </div>

          <div className="stk-search">
            <input
              type="text"
              className="input"
              style={{ paddingLeft: isRTL ? 12 : 34, paddingRight: isRTL ? 34 : 12 }}
              placeholder={t('stocks.rhSearchPlaceholder')}
              value={rhSearch}
              onChange={(e) => setRhSearch(e.target.value)}
            />
            <span className="stk-search-icon" style={{ [isRTL ? 'right' : 'left']: 12 }}>
              <IconSearch width={14} height={14} />
            </span>
          </div>

          {rhVisible.length > 0 ? (
            <motion.div className="stk-grid" variants={stagger} initial="hidden" animate="show">
              {rhVisible.map((tk) => {
                /*
                 * Market price first, share reference second, nothing third.
                 * `market` is the TOKEN's own quote read by contract;
                 * `reference` is the company's SHARE quote matched by ticker
                 * and the card tags it «مرجع» so the two can never be
                 * mistaken for each other.
                 */
                const market = stockPrices[String(tk.address).toLowerCase()] ?? null;
                return (
                  <motion.div key={tk.id} variants={riseIn}>
                    <StockTokenCard
                      token={tk}
                      market={market}
                      reference={market ? null : referencePriceFor(tk.symbol, avantis?.rows ?? [])}
                      chart={stockCharts[String(tk.address).toLowerCase()] ?? null}
                      loading={pricesLoading}
                      chartLoading={chartsLoading}
                      onBuy={rhBuy}
                    />
                  </motion.div>
                );
              })}
            </motion.div>
          ) : (
            <p className="notice" style={{ marginTop: 8 }}>{t('stocks.rhNoMatch')}</p>
          )}

          {rhEquities.length > RH_ROWS && (
            <button
              type="button"
              className="btn btn-ghost stk-more"
              onClick={() => { haptic?.('select'); setRhShowAll((v) => !v); }}
            >
              {/* «توکن», not «سهم»: these tiles are contracts, and the
                  count is what the list claims to hold. */}
              {rhShowAll
                ? t('stocks.showLess')
                : t('stocks.showAllTokens', { count: rhEquities.length })}
            </button>
          )}

          <p className="stk-legend">{t('stocks.rhLegend')}</p>
          <p className="faint" style={{ marginTop: 6, lineHeight: 1.75 }}>{t('stocks.rhNote')}</p>
        </section>
      )}
    </>
  );
}
