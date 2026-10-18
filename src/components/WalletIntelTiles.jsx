import { useTranslation } from 'react-i18next';
import SecurityCenterCard from './SecurityCenterCard';
import { fmtUsd } from '../lib/format';
import { IconChevronRight } from './Icons';
import { IconWalSpark, IconWalTrend } from './WalletGlassIcons';

/**
 * INTELLIGENCE | P&L | RISK — the three tiles under the hero.
 *
 * Intelligence opens the embedded Portfolio dashboard; P&L shows unrealized
 * and realized from the local lot ledger (honest `—` when absent); Risk is
 * the Security Center sheet. All of it lives on /wallet — no menu entries.
 *
 * Glass-3.0 layout: every tile is VERTICAL (icon + chevron on the top row,
 * title, then its figure/hint), so the three stay equal-height and scannable
 * in every language and theme instead of the earlier icon-left rows that
 * crushed the text on narrow screens. Each tile owns one accent
 * (`--walx-ac`, driven by the --ink-* tokens) so the trio reads as a family
 * with distinct doors: violet intelligence, mint P&L, cyan security.
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
      <button type="button" className="wallet-pie-card wal-sec-card walx-tile-intel" onClick={onIntel}>
        <span className="walx-tile-head">
          <span className="wal-sec-ico"><IconWalSpark width={18} height={18} /></span>
          <IconChevronRight className="walx-chev" width={14} height={14} />
        </span>
        <span className="walx-tile-title">{t('wallet.intel.tile')}</span>
        <span className="walx-tile-sub">{t('wallet.intel.tileHint')}</span>
      </button>

      <button type="button" className="wallet-pie-card wal-sec-card walx-tile-pnl" onClick={onPnl}>
        <span className="walx-tile-head">
          <span className="wal-sec-ico"><IconWalTrend width={18} height={18} /></span>
          <IconChevronRight className="walx-chev" width={14} height={14} />
        </span>
        <span className="walx-tile-title">{t('wallet.pnl.title')}</span>
        <span className="walx-tile-fig mono" style={{ color: hasCost && pnlUp(unreal) ? 'var(--walx-up)' : hasCost ? 'var(--walx-down)' : undefined }}>
          {hasCost ? `${unreal >= 0 ? '+' : ''}${fmtUsd(unreal)}` : '—'}
        </span>
        <span className="walx-tile-sub">
          {t('wallet.pnl.unrealized')}
          {hasLots && <span className={pnlUp(realised) ? 'up' : 'down'} style={{ marginInlineStart: 6 }}>{realised >= 0 ? '+' : ''}{fmtUsd(realised)}</span>}
        </span>
      </button>

      <SecurityCenterCard />
    </div>
  );
}
