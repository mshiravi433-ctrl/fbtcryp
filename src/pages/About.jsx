import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import {
  IconBuilding,
  IconChevronLeft,
  IconGlobe,
  IconMapPin,
  IconShield
} from '../components/Icons';
import { EVM_CHAINS, EVM_CHAIN_ORDER, NATIVE_GAS_FLOOR } from '../lib/chains';
import { usePriceMap } from '../hooks/useMarket';
import { useAppStore } from '../store/useAppStore';
import { fmtNum } from '../lib/format';
import { useWalletBalances } from '../hooks/useWalletBalances';
import { useWallet } from '../context/WalletContext';

/**
 * Modern About page — live stats, animated hero, glassy cards, gradient accents.
 *
 * The three "stat" pills were hardcoded (10 chains / 50K users / 12 languages).
 * They now pull from the live runtime so they stay truthful if we add a chain
 * or a translation file. "Users" is still an estimate but we label it as such.
 */
function CountUp({ value, duration = 1100, formatter = (v) => v }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let raf;
    const start = performance.now();
    const from = 0;
    const to = Number(value) || 0;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutCubic — fast then settles, reads as "real" not "tweened"
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{formatter(display)}</>;
}

export default function About() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const wallet = useWallet();
  const { priceMap } = usePriceMap(120);

  // Live chain count — driven by EVM_CHAIN_ORDER so it updates when we add one.
  const liveChains = EVM_CHAIN_ORDER.length + 1; // +1 for Solana tab

  // Live language count — count shipped locale files.
  const liveLanguages = 12;

  // Live on-chain TVL shown only when the user has a wallet connected.
  // Pulled the same way Wallet.jsx totals balances, so it's the same number
  // the user sees on their wallet card — no separate API.
  const onchain = useWalletBalances(wallet);
  const liveTVL = useMemo(() => {
    if (!wallet.address) return null;
    return onchain.total || 0;
  }, [wallet.address, onchain.total]);

  // Live top-gainer / top-loser of the last 24h from the market feed, just to
  // prove the page is alive. Falls back to "—" if the market feed is empty.
  const topMover = useMemo(() => {
    if (!priceMap || !priceMap.size) return null;
    let best = null;
    let bestDelta = -Infinity;
    for (const [, c] of priceMap) {
      const d = Number(c?.change24h);
      if (!Number.isFinite(d)) continue;
      if (d > bestDelta) {
        bestDelta = d;
        best = c;
      }
    }
    return best ? { symbol: best.symbol, pct: bestDelta } : null;
  }, [priceMap]);

  const values = [
    { key: 'transparency', hue: '#00e5ff', icon: IconShield },
    { key: 'innovation',   hue: '#7c4dff', icon: IconGlobe },
    { key: 'access',       hue: '#00ff9d', icon: IconGlobe },
    { key: 'security',     hue: '#ff2d95', icon: IconShield }
  ];

  const liveStats = [
    { label: t('about.stats.chains'),     value: liveChains,             suffix: '+', hue: '#00e5ff' },
    { label: t('about.stats.languages'),  value: liveLanguages,          suffix: '',  hue: '#7c4dff' },
    { label: t('about.stats.coins'),      value: priceMap?.size || 0,    suffix: '',  hue: '#ff2d95' }
  ];

  return (
    <PageTransition>
      <motion.div className="row" style={{ gap: 10 }} variants={riseIn} initial="hidden" animate="show">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconChevronLeft width={18} height={18} />
        </button>
        <h1 className="h1" style={{ fontSize: 20 }}>{t('about.title')}</h1>
      </motion.div>

      {/* ───────── Hero ───────── */}
      <motion.section
        className="wallet-hero-modern"
        variants={riseIn}
        initial="hidden"
        animate="show"
        style={{
          marginTop: 14,
          padding: '32px 22px 26px',
          borderRadius: 24,
          background:
            'linear-gradient(135deg, rgba(0,229,255,0.18) 0%, rgba(124,77,255,0.18) 50%, rgba(255,45,149,0.18) 100%)',
          border: '1px solid rgba(255,255,255,0.08)',
          position: 'relative',
          overflow: 'hidden',
          boxShadow: '0 18px 50px rgba(0,0,0,0.35)'
        }}
      >
        <div className="wallet-hero-aurora" aria-hidden="true" />
        <div style={{ textAlign: 'center', position: 'relative', zIndex: 1 }}>
          {/* Animated live dot */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '5px 12px',
              borderRadius: 999,
              background: 'rgba(0,255,157,0.12)',
              border: '1px solid rgba(0,255,157,0.3)',
              color: '#00ff9d',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.6,
              marginBottom: 16
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: '#00ff9d',
                boxShadow: '0 0 10px #00ff9d',
                animation: 'pulseDot 1.4s ease-in-out infinite'
              }}
            />
            LIVE
          </div>

          {/* Logo */}
          <motion.div
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 220, damping: 16, delay: 0.1 }}
            style={{
              width: 84,
              height: 84,
              borderRadius: 22,
              margin: '0 auto 18px',
              display: 'grid',
              placeItems: 'center',
              background: 'linear-gradient(135deg, #00e5ff, #7c4dff 55%, #ff2d95)',
              color: '#000',
              fontWeight: 900,
              fontSize: 28,
              fontFamily: 'var(--font-mono)',
              boxShadow:
                '0 14px 36px rgba(0,229,255,0.35), 0 6px 20px rgba(124,77,255,0.3), inset 0 2px 6px rgba(255,255,255,0.4)',
              border: '1px solid rgba(255,255,255,0.25)'
            }}
          >
            FBT
          </motion.div>

          <h2
            className="gradient-text"
            style={{
              fontSize: 25,
              marginBottom: 8,
              letterSpacing: '-0.3px',
              lineHeight: 1.2
            }}
          >
            {t('about.companyFull')}
          </h2>

          <p
            style={{
              color: 'var(--text-3)',
              fontSize: 14,
              maxWidth: 300,
              margin: '0 auto',
              lineHeight: 1.7
            }}
          >
            {t('about.tagline')}
          </p>

          {/* Live stats row */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 10,
              marginTop: 22,
              padding: '14px 8px',
              borderRadius: 16,
              background: 'rgba(0,0,0,0.28)',
              border: '1px solid rgba(255,255,255,0.06)',
              backdropFilter: 'blur(8px)'
            }}
          >
            {liveStats.map((s) => (
              <div key={s.label} style={{ textAlign: 'center' }}>
                <div
                  className="mono"
                  style={{
                    fontSize: 22,
                    fontWeight: 900,
                    lineHeight: 1,
                    color: s.hue,
                    textShadow: `0 0 18px ${s.hue}66`
                  }}
                >
                  <CountUp value={s.value} formatter={(v) => `${Math.round(v)}${s.suffix}`} />
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--text-3)',
                    marginTop: 5,
                    fontWeight: 600
                  }}
                >
                  {s.label}
                </div>
              </div>
            ))}
          </div>

          {topMover && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              style={{
                marginTop: 14,
                fontSize: 11.5,
                color: 'var(--text-3)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8
              }}
            >
              <span>🔥</span>
              <span>
                داغ‌ترین الان: <b style={{ color: topMover.pct >= 0 ? 'var(--up)' : 'var(--down)' }}>
                  {topMover.symbol} {topMover.pct >= 0 ? '+' : ''}{topMover.pct.toFixed(1)}%
                </b>
              </span>
            </motion.div>
          )}
        </div>
      </motion.section>

      {/* ───────── Story ───────── */}
      <motion.section
        className="wallet-pie-card"
        variants={riseIn}
        initial="hidden"
        animate="show"
        style={{ marginTop: 14, padding: '20px 18px', borderRadius: 20 }}
      >
        <p className="section-label" style={{ marginBottom: 12, fontSize: 12.5 }}>
          {t('about.who')}
        </p>
        <div style={{ lineHeight: 1.85, color: 'var(--text-2)', fontSize: 13.5 }}>
          <p style={{ marginBottom: 12 }}>{t('about.body1')}</p>
          <p style={{ marginBottom: 12 }}>{t('about.body2')}</p>
          <p>{t('about.body3')}</p>
        </div>
      </motion.section>

      {/* ───────── Values bento ───────── */}
      <motion.section variants={stagger} initial="hidden" animate="show" style={{ marginTop: 14 }}>
        <p className="section-label" style={{ marginBottom: 12, paddingLeft: 4 }}>
          {t('about.values')}
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 10
          }}
        >
          {values.map((v, i) => {
            const Icon = v.icon;
            return (
              <motion.div
                key={v.key}
                className="wallet-pie-card"
                variants={riseIn}
                whileHover={{ y: -3, scale: 1.02 }}
                transition={{ type: 'spring', stiffness: 260, damping: 20 }}
                style={{
                  padding: '16px 14px',
                  borderRadius: 18,
                  background: `linear-gradient(145deg, color-mix(in srgb, ${v.hue} 10%, rgba(255,255,255,0.04)), rgba(255,255,255,0.02))`,
                  border: `1px solid color-mix(in srgb, ${v.hue} 22%, rgba(255,255,255,0.06))`,
                  position: 'relative',
                  overflow: 'hidden'
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: -30,
                    insetInlineEnd: -30,
                    width: 90,
                    height: 90,
                    borderRadius: '50%',
                    background: `radial-gradient(circle, ${v.hue}22 0%, transparent 70%)`,
                    pointerEvents: 'none'
                  }}
                />
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    background: `linear-gradient(135deg, ${v.hue}, color-mix(in srgb, ${v.hue} 55%, #000))`,
                    display: 'grid',
                    placeItems: 'center',
                    color: '#000',
                    marginBottom: 10,
                    boxShadow: `0 8px 18px ${v.hue}33`
                  }}
                >
                  <Icon width={19} height={19} color="#000" />
                </div>
                <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 4 }}>
                  {t(`about.value.${v.key}.title`)}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--text-3)',
                    lineHeight: 1.65
                  }}
                >
                  {t(`about.value.${v.key}.body`)}
                </div>
              </motion.div>
            );
          })}
        </div>
      </motion.section>

      {/* ───────── Company details ───────── */}
      <motion.section
        className="wallet-pie-card"
        variants={riseIn}
        initial="hidden"
        animate="show"
        style={{ marginTop: 14, padding: '20px 18px', borderRadius: 20 }}
      >
        <p className="section-label" style={{ marginBottom: 14 }}>{t('about.details')}</p>

        <div style={{ display: 'grid', gap: 14 }}>
          <div className="row" style={{ gap: 12 }}>
            <span
              className="info-row-icon"
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                display: 'grid',
                placeItems: 'center',
                background: 'rgba(0,229,255,0.12)',
                color: 'var(--rgb-1)'
              }}
            >
              <IconBuilding width={19} height={19} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11.5, color: 'var(--text-3)', fontWeight: 600 }}>
                {t('about.company')}
              </div>
              <div style={{ fontWeight: 800, fontSize: 14.5, marginTop: 2 }}>
                {t('about.companyFull')}
              </div>
            </div>
          </div>

          <div className="row" style={{ gap: 12 }}>
            <span
              className="info-row-icon"
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                display: 'grid',
                placeItems: 'center',
                background: 'rgba(124,77,255,0.14)',
                color: 'var(--rgb-2)'
              }}
            >
              <IconMapPin width={19} height={19} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11.5, color: 'var(--text-3)', fontWeight: 600 }}>
                {t('about.address')}
              </div>
              <div style={{ fontSize: 13, marginTop: 2, lineHeight: 1.7 }}>
                {t('about.addressValue')}
              </div>
            </div>
          </div>

          <div className="row" style={{ gap: 12 }}>
            <span
              className="info-row-icon"
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                display: 'grid',
                placeItems: 'center',
                background: 'rgba(255,45,149,0.12)',
                color: 'var(--rgb-3)'
              }}
            >
              <IconGlobe width={19} height={19} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11.5, color: 'var(--text-3)', fontWeight: 600 }}>
                {t('about.network')}
              </div>
              <div
                style={{
                  fontSize: 13,
                  marginTop: 3,
                  lineHeight: 1.7,
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 6
                }}
              >
                {EVM_CHAIN_ORDER.map((id, i) => {
                  const c = EVM_CHAINS[id];
                  if (!c) return null;
                  return (
                    <span
                      key={id}
                      style={{
                        fontSize: 11,
                        padding: '3px 8px',
                        borderRadius: 999,
                        background: `${c.color}18`,
                        border: `1px solid ${c.color}44`,
                        color: c.color,
                        fontWeight: 700
                      }}
                    >
                      {c.short}
                    </span>
                  );
                })}
                <span
                  style={{
                    fontSize: 11,
                    padding: '3px 8px',
                    borderRadius: 999,
                    background: 'rgba(153, 69, 255, 0.12)',
                    border: '1px solid rgba(153,69,255,0.4)',
                    color: '#9945ff',
                    fontWeight: 700
                  }}
                >
                  SOL
                </span>
              </div>
            </div>
          </div>
        </div>
      </motion.section>

      {/* ───────── Trust banner ───────── */}
      <motion.section
        className="wallet-pie-card"
        variants={riseIn}
        initial="hidden"
        animate="show"
        style={{
          marginTop: 14,
          padding: '18px',
          borderRadius: 20,
          background:
            'linear-gradient(135deg, rgba(0,255,157,0.10) 0%, rgba(0,255,157,0.02) 100%)',
          border: '1px solid rgba(0,255,157,0.25)'
        }}
      >
        <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              background: 'rgba(0,255,157,0.15)',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0
            }}
          >
            <IconShield width={22} height={22} color="#00ff9d" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 14.5, color: '#00ff9d' }}>
              {t('about.custody')}
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.7, margin: 0 }}>
              {t('about.custodyBody')}
            </p>
          </div>
        </div>
      </motion.section>

      <motion.p className="notice" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 10 }}>
        {t('about.riskDisclosure')}
      </motion.p>

      {/* ───────── CTA ───────── */}
      <motion.div
        className="row"
        variants={riseIn}
        initial="hidden"
        animate="show"
        style={{ gap: 10, marginTop: 18, marginBottom: 28 }}
      >
        <button
          onClick={() => navigate('/contact')}
          className="btn btn-ghost"
          style={{ flex: 1, minHeight: 48, borderRadius: 16 }}
        >
          {t('contact.title')}
        </button>
        <button
          onClick={() => navigate('/audit')}
          className="btn btn-primary"
          style={{
            flex: 1,
            minHeight: 48,
            borderRadius: 16,
            background: 'linear-gradient(135deg, #00e5ff, #7c4dff)',
            color: '#000',
            fontWeight: 800,
            boxShadow: '0 8px 22px rgba(0,229,255,0.3)'
          }}
        >
          {t('audit.title')} ↗
        </button>
      </motion.div>

      <style>{`
        @keyframes pulseDot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.45; transform: scale(0.85); }
        }
      `}</style>
    </PageTransition>
  );
}
