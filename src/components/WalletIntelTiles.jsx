import { useTranslation } from 'react-i18next';
import SecurityCenterCard from './SecurityCenterCard';
import { fmtUsd } from '../lib/format';
import { IconChevronRight, IconSparkle, IconTrend } from './Icons';

/**
 * INTELLIGENCE | P&L | RISK — the three tiles under the hero.
 *
 * Intelligence opens the embedded Portfolio dashboard; P&L shows unrealized
 * and realized from the local lot ledger (honest `—` when absent); Risk is
 * the Security Center sheet. All of it lives on /wallet — no menu entries.
 *
 * All three share one structure (icon + title/subtitle + chevron) so the row
 * stays equal-height in every language and theme instead of the earlier mix
 * of an icon box on one tile and bare text on the other two.
 */
export default function WalletIntelTiles({ intel = null, onIntel, onPnl }) {
  const { t } = useTranslation();

  const unreal = (intel?.rows || [])
    .filter((r) => r.pnl != null)
    .reduce((s, r) => s + r.pnl, 0);
  const hasCost = (intel?.rows || []).some((r) => r.cost != null);
  const realised = intel?.realised ?? null;
  const hasLots = (intel?.lotCount || 0) > 0;

  const pnlUp = (v) => v != null && v >= 0;

  return (
    <div className="wallet-intel-row">
      <button type="button" className="wallet-pie-card wal-sec-card" onClick={onIntel}>
        <span className="row" style={{ gap: 10, flex: 1, minWidth: 0 }}>
          <span className="wal-sec-ico"><IconSparkle width={18} height={18} /></span>
          <span style={{ flex: 1, minWidth: 0, textAlign: 'start' }}>
            <strong style={{ fontSize: 13, display: 'block' }}>{t('wallet.intel.tile')}</strong>
            <small className="faint" style={{ display: 'block', fontSize: 10.5, marginTop: 2, lineHeight: 1.5 }}>{t('wallet.intel.tileHint')}</small>
          </span>
        </span>
        <IconChevronRight width={14} height={14} />
      </button>

      <button type="button" className="wallet-pie-card wal-sec-card" onClick={onPnl}>
        <span className="row" style={{ gap: 10, flex: 1, minWidth: 0 }}>
          <span className="wal-sec-ico"><IconTrend width={18} height={18} /></span>
          <span style={{ flex: 1, minWidth: 0, textAlign: 'start' }}>
            <strong style={{ fontSize: 13, display: 'block' }}>{t('wallet.pnl.title')}</strong>
            <small className="mono" style={{ display: 'block', fontSize: 12, fontWeight: 900, marginTop: 2, color: hasCost && pnlUp(unreal) ? 'var(--up)' : hasCost ? 'var(--down)' : undefined }}>
              {hasCost ? `${unreal >= 0 ? '+' : ''}${fmtUsd(unreal)}` : '—'}
            </small>
            <small className="faint" style={{ display: 'block', fontSize: 9.5, marginTop: 1 }}>
              {t('wallet.pnl.unrealized')}
              {hasLots && <span className={pnlUp(realised) ? 'up' : 'down'} style={{ marginInlineStart: 6 }}>{realised >= 0 ? '+' : ''}{fmtUsd(realised)}</span>}
            </small>
          </span>
        </span>
        <IconChevronRight width={14} height={14} />
      </button>

      <SecurityCenterCard />
    </div>
  );
}
