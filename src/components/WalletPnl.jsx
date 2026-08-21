import { useTranslation } from 'react-i18next';
import { fmtUsd } from '../lib/format';

/**
 * P&L CARD — unrealized and realized, kept separate.
 * ---------------------------------------------------------------------------
 * Source: buildIntelligence() over the local lot ledger + live holdings.
 *
 * ─── NO FAKE ZEROS ──────────────────────────────────────────────────────────
 * `intel.unrealised` sums `pnl ?? 0`, which silently counts rows WITHOUT a
 * cost basis as zero — exactly the lie this app must not tell. This card
 * recomputes over rows that actually have a cost basis, and shows `—` +
 * `partial` when some rows are missing theirs. Realized P&L is `—` until the
 * ledger actually contains a recorded fill.
 */
export default function WalletPnl({ intel = null }) {
  const { t } = useTranslation();

  const unreal = (intel?.rows || [])
    .filter((r) => r.pnl != null)
    .reduce((s, r) => s + r.pnl, 0);
  const withCost = (intel?.rows || []).filter((r) => r.cost != null).length;
  const totalRows = (intel?.rows || []).length;
  const hasAnyCost = withCost > 0;
  const realised = intel?.realised ?? null;
  const hasLots = (intel?.lotCount || 0) > 0;
  const partial = totalRows > withCost;

  const unrealBlock = !hasAnyCost
    ? <span className="faint">— <span style={{ fontSize: 10.5, fontWeight: 600 }}>{t('wallet.notIndexed')}</span></span>
    : (
      <span className={unreal >= 0 ? 'up' : 'down'} style={{ fontWeight: 900 }}>
        {unreal >= 0 ? '+' : ''}{fmtUsd(unreal)}
      </span>
    );
  const realisedBlock = !hasLots
    ? <span className="faint">— <span style={{ fontSize: 10.5, fontWeight: 600 }}>{t('wallet.noRecordedTrades')}</span></span>
    : (
      <span className={realised >= 0 ? 'up' : 'down'} style={{ fontWeight: 900 }}>
        {realised >= 0 ? '+' : ''}{fmtUsd(realised)}
      </span>
    );

  return (
    <section className="wallet-pie-card" style={{ padding: 14, borderRadius: 18 }}>
      <div className="row-between" style={{ marginBottom: 10 }}>
        <span className="wallet-section-title">{t('wallet.pnl.title')}</span>
        {partial && <span className="wal-note">{t('wallet.partial')}</span>}
      </div>
      <div className="wallet-bento" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="card card-tight" style={{ padding: 12, borderRadius: 12 }}>
          <div className="faint" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4 }}>{t('wallet.pnl.unrealized')}</div>
          <div className="mono" style={{ fontSize: 15.5, marginTop: 5 }}>{unrealBlock}</div>
        </div>
        <div className="card card-tight" style={{ padding: 12, borderRadius: 12 }}>
          <div className="faint" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4 }}>{t('wallet.pnl.realized')}</div>
          <div className="mono" style={{ fontSize: 15.5, marginTop: 5 }}>{realisedBlock}</div>
        </div>
      </div>
      {partial && (
        <p className="muted" style={{ fontSize: 11, margin: '10px 2px 0', lineHeight: 1.7 }}>
          {t('wallet.pnl.partialNote')}
        </p>
      )}
    </section>
  );
}
