import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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

/**
 * Portfolio Intelligence — modern, more visual layout.
 *
 * Hero value card with gradient + 24H/7D chips, a 4-tile bento of key stats,
 * best/worst/whale rows in a soft card, allocation as progress bars,
 * and the tax export as a primary action.
 */
export default function Portfolio({ embedded = false, onBack }) {
  useHideBalances();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const wallet = useWallet();
  const onchain = useWalletBalances(wallet);
  const intel = useMemo(
    () => buildIntelligence({ holdings: onchain.rows.map((r) => ({ ...r, chainId: wallet.chainId })) }),
    [onchain.rows, wallet.chainId]
  );
  const [expand, setExpand] = useState(false);

  const ch24 = intel.change24h;
  const ch7 = intel.change7d;
  const goBack = () => (onBack ? onBack() : navigate(-1));

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

  const content = (
    <>
      {!embedded && (
        <motion.div className="row" style={{ gap: 10 }} variants={riseIn} initial="hidden" animate="show">
          <button className="icon-btn" onClick={goBack} aria-label={t('common.back')}>
            <IconChevronLeft width={18} height={18} />
          </button>
          <h1 className="h1" style={{ fontSize: 19 }}>{t('intel.title')}</h1>
        </motion.div>
      )}

      {/* ── HERO ─────────────────────────────────────────────── */}
      <motion.section
        className="wallet-hero-modern"
        variants={riseIn}
        initial="hidden"
        animate="show"
        style={{
          marginTop: embedded ? 0 : 12,
          padding: 22,
          borderRadius: 22,
          background: 'linear-gradient(135deg, rgba(0,229,255,0.22), rgba(124,77,255,0.18) 60%, rgba(0,255,157,0.15))',
          border: '1px solid rgba(255,255,255,0.08)',
          position: 'relative',
          overflow: 'hidden'
        }}
      >
        <div className="wallet-hero-aurora" aria-hidden="true" />
        <div className="faint" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.7, position: 'relative' }}>
          {t('intel.value')}
        </div>
        <div className="wallet-total-modern" style={{ marginTop: 4, fontSize: 34, position: 'relative' }}>
          {fmtUsd(intel.total)}
        </div>
        <div className="row" style={{ gap: 10, marginTop: 14, position: 'relative' }}>
          <span className={`pill ${ch24 && ch24.abs >= 0 ? 'pill-up' : 'pill-down'}`} style={{ fontSize: 11, padding: '6px 10px' }}>
            24H {ch24 ? `${ch24.abs >= 0 ? '+' : ''}${fmtUsd(ch24.abs)}` : '—'}
          </span>
          <span className={`pill ${ch7 && ch7.abs >= 0 ? 'pill-up' : 'pill-down'}`} style={{ fontSize: 11, padding: '6px 10px' }}>
            7D {ch7 ? (ch7.from ? fmtPct((ch7.abs / ch7.from) * 100) : fmtUsd(ch7.abs)) : '—'}
          </span>
        </div>
      </motion.section>

      {/* ── BENTO STATS ──────────────────────────────────────── */}
      <motion.div
        className="wallet-bento"
        variants={riseIn}
        initial="hidden"
        animate="show"
        style={{ marginTop: 14, gridTemplateColumns: '1fr 1fr' }}
      >
        {[
          { k: t('intel.pnl'), v: intel.pnl ? fmtUsd(intel.pnl) : '—', hue: '#00e5ff' },
          { k: t('intel.cost'), v: intel.cost ? fmtUsd(intel.cost) : '—', hue: '#7c4dff' },
          { k: t('intel.risk'), v: `${intel.riskScore} · ${t(`intel.band.${intel.riskBand}`)}`, hue: '#ff2d95' },
          { k: t('intel.stables'), v: `${intel.stablePct.toFixed(0)}%`, hue: '#00ff9d' }
        ].map((c) => (
          <div
            key={c.k}
            className="wallet-pie-card"
            style={{
              padding: 14,
              borderRadius: 16,
              textAlign: 'center',
              borderColor: `color-mix(in srgb, ${c.hue} 20%, transparent)`,
              background: `linear-gradient(145deg, color-mix(in srgb, ${c.hue} 10%, rgba(255,255,255,0.04)), rgba(255,255,255,0.02))`
            }}
          >
            <div className="faint" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5 }}>{c.k}</div>
            <div className="mono" style={{ fontSize: 17, fontWeight: 900, marginTop: 6, color: c.hue }}>{c.v}</div>
          </div>
        ))}
      </motion.div>

      {/* ── BEST/WORST/WHALE ─────────────────────────────────── */}
      {intel.best && (
        <motion.section
          className="wallet-pie-card"
          variants={riseIn}
          initial="hidden"
          animate="show"
          style={{ marginTop: 14, padding: 14, borderRadius: 18 }}
        >
          <div className="row-between" style={{ padding: '6px 4px' }}>
            <span className="faint" style={{ fontSize: 11.5 }}>{t('intel.best')}</span>
            <span className="mono up" style={{ fontWeight: 800 }}>{intel.best.symbol} {fmtPct(intel.best.pnlPct)}</span>
          </div>
          {intel.worst && intel.worst !== intel.best && (
            <div className="row-between" style={{ padding: '6px 4px', borderTop: '1px solid var(--line)' }}>
              <span className="faint" style={{ fontSize: 11.5 }}>{t('intel.worst')}</span>
              <span className="mono down" style={{ fontWeight: 800 }}>{intel.worst.symbol} {fmtPct(intel.worst.pnlPct)}</span>
            </div>
          )}
          <div className="row-between" style={{ padding: '6px 4px', borderTop: '1px solid var(--line)' }}>
            <span className="faint" style={{ fontSize: 11.5 }}>{t('intel.whale')}</span>
            <span className="mono" style={{ fontWeight: 800 }}>{intel.topShare.toFixed(0)}%</span>
          </div>
        </motion.section>
      )}

      {/* ── ALLOCATION (collapsible bars) ───────────────────── */}
      <section style={{ marginTop: 14 }}>
        <button
          type="button"
          onClick={() => setExpand((v) => !v)}
          className="row-between card"
          style={{
            width: '100%', padding: '12px 14px', borderRadius: 16,
            background: 'rgba(255,255,255,0.03)', border: '1px solid var(--line)', textAlign: 'start'
          }}
        >
          <span style={{ fontWeight: 800, fontSize: 13 }}>{t('intel.allocation')}</span>
          <span className="faint" style={{ fontSize: 11 }}>
            {intel.rows.length} {expand ? '▾' : '▸'}
          </span>
        </button>
        <AnimatePresence initial={false}>
          {expand && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              style={{ overflow: 'hidden' }}
            >
              <div className="wallet-pie-card" style={{ marginTop: 8, padding: 14, borderRadius: 18 }}>
                {intel.rows.length === 0 ? (
                  <p className="faint">{t('intel.empty')}</p>
                ) : (
                  intel.rows.map((r, i) => (
                    <div key={r.symbol} style={{ marginBottom: i === intel.rows.length - 1 ? 0 : 10 }}>
                      <div className="row-between" style={{ marginBottom: 4 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 700 }}>
                          {r.symbol}
                          <span className="faint" style={{ marginInlineStart: 8, fontWeight: 500, fontSize: 11 }}>
                            {r.weight.toFixed(1)}%
                          </span>
                        </span>
                        <span className="mono" style={{ fontSize: 12 }}>
                          {fmtUsd(r.value)}
                          {r.pnlPct != null && (
                            <span className={r.pnlPct >= 0 ? 'up' : 'down'} style={{ marginInlineStart: 8 }}>
                              {fmtPct(r.pnlPct, 1)}
                            </span>
                          )}
                        </span>
                      </div>
                      <div style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.min(100, r.weight)}%` }}
                          transition={{ type: 'spring', stiffness: 110, damping: 20, delay: i * 0.03 }}
                          style={{
                            height: '100%', borderRadius: 999,
                            background: `linear-gradient(90deg, hsl(${(i * 52) % 360} 90% 60%), hsl(${(i * 52 + 40) % 360} 85% 55%))`
                          }}
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {intel.partial && <p className="notice" style={{ marginTop: 12 }}>{t('intel.partial')}</p>}

      <button
        className="btn btn-primary"
        style={{ marginTop: 16, width: '100%', minHeight: 46, borderRadius: 14 }}
        onClick={downloadTax}
      >
        {t('intel.taxExport')} ↓
      </button>

      <InfoBox title={t('intel.taxTitle')} tone="warn" id="intel-tax">
        <p>{t('intel.taxBody')}</p>
      </InfoBox>
    </>
  );

  if (embedded) return <div>{content}</div>;
  return <PageTransition>{content}</PageTransition>;
}
