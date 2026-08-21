import { useTranslation } from 'react-i18next';
import SecurityCenterCard from './SecurityCenterCard';
import { fmtUsd } from '../lib/format';
import { IconChevronRight } from './Icons';

/**
 * INTELLIGENCE | P&L | RISK — the three tiles under the hero.
 *
 * Intelligence opens the embedded Portfolio dashboard; P&L shows unrealized
 * and realized from the local lot ledger (honest `—` when absent); Risk is
 * the Security Center sheet. All of it lives on /wallet — no menu entries.
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
      <button type="button" className="wallet-pie-card wal-intel-tile" onClick={onIntel}>
        <span className="wal-intel-tile-head">
          <strong style={{ fontSize: 12.5 }}>{t('wallet.intel.tile')}</strong>
          <IconChevronRight width={13} height={13} />
        </span>
        <span className="faint" style={{ fontSize: 10.5, lineHeight: 1.6, display: 'block' }}>
          {t('wallet.intel.tileHint')}
        </span>
      </button>

      <button type="button" className="wallet-pie-card wal-intel-tile" onClick={onPnl}>
        <span className="wal-intel-tile-head">
          <strong style={{ fontSize: 12.5 }}>{t('wallet.pnl.title')}</strong>
          <IconChevronRight width={13} height={13} />
        </span>
        <span className="mono" style={{ fontSize: 12.5, fontWeight: 900, color: hasCost && pnlUp(unreal) ? 'var(--up)' : hasCost ? 'var(--down)' : undefined }}>
          {hasCost ? `${unreal >= 0 ? '+' : ''}${fmtUsd(unreal)}` : <span className="faint" style={{ fontWeight: 600, fontSize: 10.5 }}>— {t('wallet.notIndexed')}</span>}
        </span>
        <span className="faint" style={{ fontSize: 9.5, display: 'block', marginTop: 3 }}>
          {t('wallet.pnl.unrealized')}
          {hasLots && <span className={pnlUp(realised) ? 'up' : 'down'} style={{ marginInlineStart: 6 }}>{realised >= 0 ? '+' : ''}{fmtUsd(realised)}</span>}
        </span>
      </button>

      <SecurityCenterCard />
    </div>
  );
}
