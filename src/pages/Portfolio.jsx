import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import { IconChevronLeft } from '../components/Icons';
import { useWallet } from '../context/WalletContext';
import { useWalletBalances } from '../hooks/useWalletBalances';
import { buildIntelligence, taxCsv } from '../lib/portfolioIntel';
import { fmtPct, fmtUsd } from '../lib/format';
import { useHideBalances } from '../hooks/useHideBalances';

export default function Portfolio() {
  useHideBalances();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const wallet = useWallet();
  const onchain = useWalletBalances(wallet);
  const intel = useMemo(
    () => buildIntelligence({ holdings: onchain.rows.map((r) => ({ ...r, chainId: wallet.chainId })) }),
    [onchain.rows, wallet.chainId]
  );

  const ch24 = intel.change24h;
  const ch7 = intel.change7d;

  const downloadTax = () => {
    const csv = taxCsv();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fbt-tax-lots.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <PageTransition>
      <motion.div className="row" style={{ gap: 10 }} variants={riseIn} initial="hidden" animate="show">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconChevronLeft width={18} height={18} />
        </button>
        <h1 className="h1" style={{ fontSize: 19 }}>{t('intel.title')}</h1>
      </motion.div>
      <p className="muted" style={{ lineHeight: 1.85 }}>{t('intel.subtitle')}</p>

      <motion.section className="card card-rgb" variants={riseIn} initial="hidden" animate="show">
        <div className="faint" style={{ fontSize: 11, fontWeight: 700 }}>{t('intel.value')}</div>
        <div className="stat-value" style={{ marginTop: 4 }}>{fmtUsd(intel.total)}</div>
        <div className="row" style={{ gap: 14, marginTop: 10 }}>
          <div>
            <div className="faint" style={{ fontSize: 10.5 }}>24H</div>
            <div className={`mono ${ch24 && ch24.abs >= 0 ? 'up' : 'down'}`} style={{ fontWeight: 800 }}>
              {ch24 ? `${ch24.abs >= 0 ? '+' : ''}${fmtUsd(ch24.abs)}` : '—'}
            </div>
          </div>
          <div>
            <div className="faint" style={{ fontSize: 10.5 }}>7D</div>
            <div className={`mono ${ch7 && ch7.abs >= 0 ? 'up' : 'down'}`} style={{ fontWeight: 800 }}>
              {ch7 ? `${ch7.from ? fmtPct((ch7.abs / ch7.from) * 100) : fmtUsd(ch7.abs)}` : '—'}
            </div>
          </div>
        </div>
      </motion.section>

      <div className="grid-2" style={{ marginTop: 12 }}>
        {[
          { k: t('intel.pnl'), v: intel.pnl ? fmtUsd(intel.pnl) : '—' },
          { k: t('intel.cost'), v: intel.cost ? fmtUsd(intel.cost) : '—' },
          { k: t('intel.risk'), v: `${intel.riskScore} · ${t(`intel.band.${intel.riskBand}`)}` },
          { k: t('intel.stables'), v: `${intel.stablePct.toFixed(0)}%` }
        ].map((c) => (
          <div key={c.k} className="card card-tight">
            <div className="faint" style={{ fontSize: 11 }}>{c.k}</div>
            <div className="mono" style={{ fontWeight: 800, marginTop: 4 }}>{c.v}</div>
          </div>
        ))}
      </div>

      {intel.best && (
        <div className="card card-tight" style={{ marginTop: 12 }}>
          <div className="row-between">
            <span className="faint">{t('intel.best')}</span>
            <span className="mono up">{intel.best.symbol} {fmtPct(intel.best.pnlPct)}</span>
          </div>
          {intel.worst && intel.worst !== intel.best && (
            <div className="row-between" style={{ marginTop: 6 }}>
              <span className="faint">{t('intel.worst')}</span>
              <span className="mono down">{intel.worst.symbol} {fmtPct(intel.worst.pnlPct)}</span>
            </div>
          )}
          <div className="row-between" style={{ marginTop: 6 }}>
            <span className="faint">{t('intel.whale')}</span>
            <span className="mono">{intel.topShare.toFixed(0)}%</span>
          </div>
        </div>
      )}

      <section style={{ marginTop: 14 }}>
        <p className="section-label">{t('intel.allocation')}</p>
        {intel.rows.length === 0 ? (
          <p className="faint">{t('intel.empty')}</p>
        ) : (
          intel.rows.map((r) => (
            <div key={r.symbol} className="row-between" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
              <span>
                <b>{r.symbol}</b>
                <span className="faint" style={{ marginInlineStart: 8 }}>{r.weight.toFixed(1)}%</span>
              </span>
              <span className="mono">
                {fmtUsd(r.value)}
                {r.pnlPct != null && (
                  <span className={r.pnlPct >= 0 ? 'up' : 'down'} style={{ marginInlineStart: 8 }}>{fmtPct(r.pnlPct, 1)}</span>
                )}
              </span>
            </div>
          ))
        )}
      </section>

      {intel.partial && <p className="notice" style={{ marginTop: 12 }}>{t('intel.partial')}</p>}

      <button className="btn btn-ghost" style={{ marginTop: 14, width: '100%' }} onClick={downloadTax}>
        {t('intel.taxExport')}
      </button>

      <InfoBox title={t('intel.taxTitle')} tone="warn" id="intel-tax">
        <p>{t('intel.taxBody')}</p>
      </InfoBox>
    </PageTransition>
  );
}
