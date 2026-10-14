import AssetIcon from '../AssetIcon';
import Sparkline from '../Sparkline';
import { balancesHidden, fmtUsd } from '../../lib/format';

/**
 * THE MARKET — now a picker list, not a column of its own
 * ---------------------------------------------------------------------------
 * The spot tab used to render the market twice: a «بازار» column on the left
 * with its own search field, and an «انتخاب توکن» button that opened a sheet
 * with the SAME rows, the SAME prices and the SAME balances. One dataset, two
 * boxes, twice the reading. The report was exact about it: «بازار کلا باید
 * باکسش محو شود ما در انتخاب توکن همون بازاره و اطلاعات تکراریه باید یک باکس
 * باشد واحد».
 *
 * So the column is gone and this module is what is left of it: it turns the
 * curated token list of one network into the ROWS of the token popup
 * (components/spot/SpotSelect.jsx). Same honesty rules as before:
 *   • price and 24h change come from the market feed, or an honest dash when
 *     the feed has no coin for it — never a guessed number;
 *   • the sparkline is drawn only from a real series. `Sparkline` renders a
 *     skeleton when it has fewer than two points; nothing here invents a line
 *     out of percentage changes (the rule lib/marketVisuals.js states);
 *   • the wallet balance is «unavailable» when the read failed, never zero.
 *
 * One row is one line: artwork, name, chart, price. Every column but the name
 * is fixed-width and the name is the one that ellipsises, so a long token name
 * can never push the chart or the price off the row.
 */
export function tokenItems({
  chainId,
  tokens,
  markets,
  connected,
  balanceFor,
  t,
  excludeSymbol = null,
  withChart = true
}) {
  const list = (tokens ?? []).filter((tk) => !excludeSymbol || tk.symbol !== excludeSymbol);

  return list.map((tk) => {
    const row = markets?.find((m) => m.id === tk.coingeckoId) ?? null;
    const change = row?.change24h;
    const up = Number(change) >= 0;
    const spark = Array.isArray(row?.sparkline) ? row.sparkline.slice(-40) : [];
    const bal = connected ? balanceFor?.(tk) : undefined;

    return {
      value: tk.symbol,
      token: tk,
      icon: <AssetIcon symbol={tk.symbol} chain={chainId} size={30} />,
      title: tk.symbol,
      sub: tk.name,
      spark: withChart ? <Sparkline data={spark} up={up} width={54} height={24} /> : null,
      num: row?.price != null ? fmtUsd(row.price) : '—',
      change:
        change != null && Number.isFinite(Number(change)) ? (
          <span className={`spot-chg ${up ? 'up' : 'down'}`} dir="ltr">
            {up ? '▲' : '▼'} {Math.abs(Number(change)).toFixed(2)}%
          </span>
        ) : null,
      meta: connected ? (
        <span className="spot-row-bal mono" dir="ltr">
          {bal === undefined
            ? ''
            : bal === null
              ? t('spot.balanceUnavailable')
              : balancesHidden()
                ? '•••'
                : `${bal.formatted} ${tk.symbol}`}
        </span>
      ) : null
    };
  });
}

/** One market row for the feed lookup the triggers need (price + change). */
export function tokenInfo(markets, tk) {
  if (!tk) return null;
  return markets?.find((m) => m.id === tk.coingeckoId) ?? null;
}
