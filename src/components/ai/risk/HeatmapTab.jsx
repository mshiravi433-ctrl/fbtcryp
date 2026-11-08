/**
 * AI RISK ENGINE — HEATMAP
 * ===========================================================================
 * «Risk Heatmap: دارایی‌ها و شبکه‌ها.»
 *
 * A heat map's only job is to be READ. So:
 *
 *   · Axes are fixed and named: six measured families down the side, the ten
 *     largest holdings across the top. A cell that was not measured shows a dot
 *     — visibly different from a cell that measured 0, which is the difference
 *     between "safe" and "we don't know".
 *   · The axis order is the FAMILY WEIGHT order, so the strip that matters most
 *     is on the left in LTR / right in RTL without the reader sorting it.
 *   · Buckets rather than a continuous gradient: a reader can tell 40 from 70.
 *   · The network map is a second, separate question — is the value sitting on
 *     one chain, and could that chain be read at all — so it gets its own table
 *     rather than being folded into the asset grid.
 */
import { SectionCard, EmptyState } from '../../ai/analysis/ui.jsx';
import { IconGlobe, IconPools } from '../../Icons.jsx';
import { rt } from '../../../lib/risk/copy.js';
import { fmtUsd } from '../../../lib/format.js';
import { BandLegend, Pct, RiskCell, TONE_CLASS } from './parts.jsx';
import { RISK_FAMILIES } from '../../../lib/risk/taxonomy.js';

/** The six families a heat map can honestly populate per asset. */
const AXIS = ['volatility', 'portfolio', 'liquidity', 'smartContract', 'stablecoin', 'network'];

const AXIS_LABEL = (locale, id) => {
  const meta = RISK_FAMILIES.find((f) => f.id === id);
  if (!meta) return id;
  return locale === 'fa' ? meta.shortFa : meta.shortEn;
};

const CHAIN_LABEL = {
  1: 'Ethereum', 10: 'OP', 56: 'BNB', 137: 'Polygon', 8453: 'Base',
  42161: 'Arbitrum', 43114: 'Avalanche', 59144: 'Linea', 146: 'Sonic',
  324: 'zkSync', 5000: 'Mantle'
};

export default function HeatmapTab({ locale, report, bands }) {
  const rows = report.heatmap || [];
  const networks = report.networkHeat || [];

  if (!rows.length) {
    return (
      <EmptyState
        title={rt(locale, 'page.noWallet')}
        hint={rt(locale, 'heat.hint')}
      />
    );
  }

  return (
    <div className="rk-stack">
      <SectionCard
        mark={<IconPools width={16} height={16} />}
        title={rt(locale, 'heat.title')}
        hint={rt(locale, 'heat.hint')}
        actions={<BandLegend locale={locale} bands={bands} />}
      >
        <div className="rk-heat-scroll">
          <table className="rk-heat">
            <thead>
              <tr>
                <th scope="col" className="rk-heat-corner">{rt(locale, 'heat.asset')}</th>
                {AXIS.map((id) => (
                  <th scope="col" key={id} className="rk-heat-col">{AXIS_LABEL(locale, id)}</th>
                ))}
                <th scope="col" className="rk-heat-col rk-heat-total">{locale === 'fa' ? 'میانگین' : 'Mean'}</th>
                <th scope="col" className="rk-heat-col">{rt(locale, 'heat.weight')}</th>
                <th scope="col" className="rk-heat-col">{rt(locale, 'heat.chain')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.symbol}-${r.chainId}`}>
                  <th scope="row" className="rk-heat-name">
                    <b>{r.symbol}</b>
                    <span>{fmtUsd(r.valueUsd)}</span>
                  </th>
                  {AXIS.map((id) => (
                    <td key={id}>
                      <RiskCell
                        value={r.cells?.[id] ?? null}
                        locale={locale}
                        title={`${r.symbol} · ${AXIS_LABEL(locale, id)}`}
                      />
                    </td>
                  ))}
                  <td className="rk-heat-total">
                    <RiskCell value={r.score} locale={locale} title={`${r.symbol} · ${locale === 'fa' ? 'میانگین' : 'mean'}`} />
                  </td>
                  <td className="rk-heat-num"><Pct value={r.weightPct} digits={1} /></td>
                  <td className="rk-heat-num">{(CHAIN_LABEL[r.chainId] || (r.chainId ?? '—'))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="rk-foot">
          {locale === 'fa'
            ? 'هر ستون یک اندازه‌گیری جدا برای همان دارایی است. ستون «قرارداد» فقط برای دارایی‌هایی پر می‌شود که آدرس قرارداد دارند و در این اجرا اسکن شده‌اند.'
            : 'Each column is a separate measurement for that asset. The contract column is only filled for assets that have an address and were scanned in this run.'}
        </p>
      </SectionCard>

      <SectionCard
        mark={<IconGlobe width={16} height={16} />}
        title={rt(locale, 'heat.networks')}
        hint={rt(locale, 'heat.networksHint')}
      >
        <div className="rk-net-grid">
          {networks.map((n) => (
            <div key={n.chainId} className="rk-net">
              <div className="rk-net-head">
                <b>{CHAIN_LABEL[n.chainId] || `#${n.chainId}`}</b>
                <span className={`rk-net-state rk-net-${n.state}`}>{rt(locale, `heat.state.${n.state}`)}</span>
              </div>
              <div className="rk-net-body">
                <span className="rk-net-val">{fmtUsd(n.valueUsd)}</span>
                <Pct value={n.sharePct} digits={1} />
              </div>
              <div className="rk-net-cells">
                <span className="rk-net-cell">
                  {locale === 'fa' ? 'تمرکز' : 'Share'}
                  <RiskCell value={n.cells?.network ?? null} locale={locale} small />
                </span>
                <span className="rk-net-cell">
                  {rt(locale, 'heat.observability')}
                  <RiskCell value={n.cells?.observability ?? null} locale={locale} small />
                </span>
              </div>
            </div>
          ))}
        </div>
        <p className="rk-foot">
          {locale === 'fa'
            ? '«قابلیت خواندن» یعنی این اجرا توانست ارزش این زنجیره را بخواند یا نه؛ زنجیره‌ای که خوانده نشود، ریسک پنهان است، نه صفر.'
            : '"Observability" is whether this run could read that chain at all; a chain that cannot be read is hidden risk, not zero risk.'}
        </p>
      </SectionCard>
    </div>
  );
}
