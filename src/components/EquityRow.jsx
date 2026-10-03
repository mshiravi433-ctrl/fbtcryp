import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { fmtCompact, fmtPct, fmtPrice, fmtQty, fmtUsd } from '../lib/format';
import { liquidityVerdict } from '../lib/solanaAssets';
import TokenIcon from '../lib/tokenIcon';
import { IconArrowUpRight, IconChart, IconSwap } from './Icons';
import EquityAnalysis from './EquityAnalysis';
import '../styles/equity-analysis.css';

/**
 * One tokenized equity row.
 *
 * ─── WHY LIQUIDITY IS ON THE ROW AND NOT IN A TOOLTIP ───────────────────────
 * These markets are thin and the thinness is uneven in a way the price does
 * not show. Measured from the live feed:
 *
 *   SPYx  $2.8m      NVDAx $2.0m      TSLAx $931k      AAPLx $80k
 *
 * A $2,000 order is nothing against SPYx and is 2.5% of the entire AAPLx book.
 * Same screen, same-looking buttons, thirty-five times the price impact. A
 * user cannot infer that from a $310 share price, so it is printed on the row.
 *
 * ─── WHY THE SIZE GATE REFUSES INSTEAD OF WARNING ───────────────────────────
 * Above 2% of pool depth the price impact exceeds our own 0.7% fee several
 * times over. Quoting anyway and letting someone discover it in the
 * confirmation screen is the behaviour of a venue that does not care. The
 * button disables and names the largest size that would work, so the user gets
 * a number rather than only a refusal.
 *
 * ─── WHY THERE IS A SELL BUTTON NEXT TO BUY ──────────────────────────────────
 * A row with only «خرید» reads as a one-way door. The tokens a user buys here
 * sit in their own Solana wallet, and selling is the same swap in reverse —
 * but nothing on this page said so, and the swap screen expects the user to
 * find AAPLx in a picker and put it in the FROM box by hand. So people asked
 * «چطور بفروشم؟» and some assumed they could not.
 *
 * `holding` is the amount of THIS token the connected wallet holds (read from
 * the chain by the page, joined by mint — see lib/solanaSell.js). When it is
 * present the row says how much is held and what it is worth at the row's
 * price, and «فروش» opens the swap screen with the token already in FROM and
 * USDC in TO. When it is absent (no wallet, read failed, nothing held) no
 * number is shown at all — a «0» after a failed read would be a lie.
 *
 * @param {object}  props
 * @param {object}  props.asset
 * @param {number}  props.amountUsd  the size chosen in the selector above
 * @param {(asset:object)=>void} props.onBuy
 * @param {{amount:number, amountText:string, usdValue:number|null}|null} [props.holding]
 * @param {(asset:object)=>void} [props.onSell]
 */
export default function EquityRow({ asset, amountUsd, onBuy, holding = null, onSell }) {
  const { t } = useTranslation();

  const verdict = liquidityVerdict(asset.liquidity, amountUsd);
  const up = (asset.change24h ?? 0) >= 0;
  const held = holding && Number.isFinite(holding.amount) && holding.amount > 0 ? holding : null;

  /*
   * The analysis for this row — a FULL-SCREEN popup, not an in-place box.
   *
   * Closed by default and mounted only while open — see the note in
   * EquityAnalysis.jsx for why the 90-day fetch must not run for twenty-two
   * rows at once. The title carries what is inside, so a collapsed row still
   * says there is a history and a depth reading available rather than "more".
   */
  const [analysisOpen, setAnalysisOpen] = useState(false);

  /*
   * WHAT THE CHOSEN AMOUNT ACTUALLY BUYS.
   *
   * The amount selector above the list used to feed ONLY the depth gate, so
   * picking $100 / $1,000 / $10,000 silently changed whether the button was
   * enabled and displayed no number at all. The owner reported it as "it
   * doesn't say how much" — correctly: a control that changes nothing visible
   * reads as broken.
   *
   * Unlike the Farm rows there is no yield to project here. A share is not an
   * income product, and inventing an expected return for Apple stock would be
   * a forecast — the one thing this codebase refuses to emit. So the honest
   * answer to "what do I get for $1,000" is the QUANTITY, which is a fact.
   */
  const price = Number(asset.usdPrice);
  const units = Number.isFinite(price) && price > 0 ? Number(amountUsd) / price : null;

  return (
    <motion.div className={`eq-row ${held ? 'is-held' : ''}`} variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}>
      <div className="row-between" style={{ gap: 10, alignItems: 'flex-start' }}>
        <div className="row" style={{ gap: 10, minWidth: 0 }}>
          {/*
            TokenIcon, not a bare <img>.
            A raw tag with no onError leaves an empty circle when the issuer's
            CDN fails, which reads as broken rather than as a placeholder —
            the exact bug documented at the top of lib/tokenIcon.jsx. That
            component walks its candidate list and always ends on a readable
            monogram.
          */}
          <TokenIcon token={asset} size={34} />
          <div style={{ minWidth: 0 }}>
            <div className="eq-name">{asset.name}</div>
            <div className="set-row-sub mono">{asset.symbol}</div>
          </div>
        </div>
        <div style={{ textAlign: 'end', flexShrink: 0 }}>
          <div className="mono eq-price">${fmtPrice(asset.usdPrice)}</div>
          <div className={`mono ${up ? 'up' : 'down'}`} style={{ fontSize: 11 }}>
            {fmtPct(asset.change24h ?? 0, 1)}
          </div>
        </div>
      </div>

      <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        {/*
          An index tracker is a materially different risk from a single
          company, and labelling it is the cheapest useful thing on this row.
        */}
        {/* Gold is neither an index nor a company, and mislabelling it as
            "single company" would be plainly wrong. */}
        <span className="pill pill-neutral">
          {t(
            asset.unit
              ? 'stocks.kindCommodity'
              /* The server sends kind:'equity' + assetKind:'index'|'single' —
                 reading `kind` alone labelled every index as a single company. */
              : (asset.assetKind ?? asset.kind) === 'index'
                ? 'stocks.kindIndex'
                : 'stocks.kindSingle'
          )}
        </span>
        <span className={`pill ${asset.liquidity < 150_000 ? 'pill-down' : 'pill-neutral'}`}>
          {t('stocks.depth')} {fmtCompact(asset.liquidity)}
        </span>
        {held && <span className="pill eq-held-pill">{t('stocks.held.pill')}</span>}
      </div>

      {/*
        What the connected wallet already holds of this token — the answer to
        «چی خریدم و کجاست؟» on the row itself. The dollar figure is the amount
        times THIS row's price and is marked ≈ because it is a spot value, not a
        quote; when the row has no price the amount stands alone.
      */}
      {held && (
        <div className="eq-held" data-testid="eq-held">
          <span className="faint">{t('stocks.held.inWallet')}</span>
          <span className="mono eq-held-num">
            {fmtQty(held.amount)}
            <span className="faint"> {asset.symbol}</span>
            {held.usdValue != null && <span className="faint eq-held-usd"> ≈ {fmtUsd(held.usdValue)}</span>}
          </span>
        </div>
      )}

      {/*
        The answer to the amount selector.

        Rendered even when the depth gate refuses the order, because "you would
        get 3.2 shares, but not at this size" is more informative than the
        number disappearing — and its disappearing is what made the selector
        look dead in the first place.
      */}
      {units != null && (
        <div className="farm-calc">
          <span className="faint">{t('stocks.wouldGet', { amount: fmtUsd(amountUsd) })}</span>
          <span className="mono farm-calc-num">
            {units < 0.01 ? units.toFixed(4) : units.toFixed(2)}
            <span className="faint"> {asset.symbol}</span>
          </span>
        </div>
      )}

      {/*
        SpaceX is private: no exchange listing, no public quote to check this
        price against. That is simultaneously the reason it is interesting —
        this access does not exist through any broker — and a real extra risk,
        so it is stated on the row rather than smoothed over.
      */}
      {asset.privateCompany && <p className="eq-toobig">{t('stocks.privateCompany')}</p>}

      {/* Only rendered when the chosen size is actually a problem. */}
      {!verdict.ok && verdict.reason === 'tooBig' && (
        <p className="eq-toobig">
          {t('stocks.tooBig', {
            pct: (verdict.share * 100).toFixed(1),
            max: fmtCompact(verdict.maxUsd)
          })}
        </p>
      )}

      {/*
        Buy and analysis on one line. `.btn` sets `width: 100%`, and for a flex
        item `flex-basis: auto` resolves to that width — so a bare neighbour
        takes the whole row and its sibling collapses to its label. `.btn-row`
        removes `width` from the calculation; `.btn-row-minor` then gives the
        analysis toggle two thirds of the buy button, never less than a tap
        target. Buy stays the wider of the two because it is the action the row
        exists for. The same trap the RWA rows document.
      */}
      <div className={`btn-row eq-actions ${held && onSell ? 'has-sell' : ''}`}>
        <button
          type="button"
          className="btn btn-ghost eq-buy"
          disabled={!verdict.ok}
          onClick={() => onBuy(asset)}
        >
          <IconSwap width={15} height={15} />
          <span>{t('stocks.buyWith', { sym: asset.symbol })}</span>
        </button>
        {/*
          «فروش» only when there is something to sell. It is never gated by
          the depth verdict: that gate protects a BUY of the chosen size, and
          the swap screen quotes the real sell against the real balance.
        */}
        {held && onSell && (
          <button
            type="button"
            className="btn btn-ghost eq-sell"
            data-testid="eq-sell"
            onClick={() => onSell(asset)}
          >
            <IconArrowUpRight width={15} height={15} />
            <span>{t('stocks.held.sell', { sym: asset.symbol })}</span>
          </button>
        )}
        <button
          type="button"
          className={`btn btn-ghost btn-row-minor eq-analyze ${analysisOpen ? 'is-open' : ''}`}
          aria-expanded={analysisOpen}
          onClick={() => setAnalysisOpen((v) => !v)}
        >
          <IconChart width={15} height={15} />
          <span>{analysisOpen ? t('stocks.eq.hideAnalysis') : t('stocks.eq.showAnalysis')}</span>
        </button>
      </div>

      <AnimatePresence initial={false}>
        {analysisOpen && (
          <EquityAnalysis
            asset={asset}
            amountUsd={amountUsd}
            onBuy={onBuy}
            onClose={() => setAnalysisOpen(false)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
