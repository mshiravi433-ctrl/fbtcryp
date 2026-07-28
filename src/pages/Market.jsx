import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import AdBanner from '../components/AdBanner';
import Ticker from '../components/Ticker';
import CoinRow from '../components/CoinRow';
import AnimatedNumber from '../components/AnimatedNumber';
import Sparkline from '../components/Sparkline';
import { useGlobalStats, useMarkets, useTrending } from '../hooks/useMarket';
import { fmtCompact, fmtNum, fmtPct } from '../lib/format';
import { useAppStore } from '../store/useAppStore';

const FILTERS = ['all', 'gainers', 'losers', 'favorites', 'volume'];

function StatTile({ label, value, sub, tone }) {
  return (
    <motion.div className="card card-tight" variants={riseIn}>
      <div className="faint" style={{ marginBottom: 4 }}>{label}</div>
      <div className="stat-mini">{value}</div>
      {sub != null && (
        <div className={`mono ${tone === 'up' ? 'up' : tone === 'down' ? 'down' : ''}`} style={{ fontSize: 10.5, marginTop: 2 }}>
          {sub}
        </div>
      )}
    </motion.div>
  );
}

export default function Market() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const favorites = useAppStore((s) => s.favorites);

  const { data: global } = useGlobalStats();
  const { data: coins, loading } = useMarkets(60);
  const { data: trending } = useTrending();

  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');

  const list = useMemo(() => {
    let out = coins ?? [];
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      out = out.filter((c) => c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));
    }
    switch (filter) {
      case 'gainers':
        return [...out].sort((a, b) => b.change24h - a.change24h).slice(0, 25);
      case 'losers':
        return [...out].sort((a, b) => a.change24h - b.change24h).slice(0, 25);
      case 'favorites':
        return out.filter((c) => favorites.includes(c.id));
      case 'volume':
        return [...out].sort((a, b) => b.volume - a.volume).slice(0, 25);
      default:
        return out;
    }
  }, [coins, filter, query, favorites]);

  const hero = coins?.[0];
  const isOffline = global?.offline || coins?.[0]?.offline;

  return (
    <PageTransition>
      <Ticker coins={(coins ?? []).slice(0, 18)} />

      {isOffline && <div className="notice">{t('common.offlineData')}</div>}

      {/* ---------- global market card ---------- */}
      <motion.section
        className="card card-rgb card-glow-cyan"
        variants={riseIn}
        initial="hidden"
        animate="show"
      >
        <div className="sheen" />
        <div className="row-between" style={{ marginBottom: 10 }}>
          <div>
            <div className="faint">{t('market.totalMcap')}</div>
            <div className="stat-value">
              <AnimatedNumber value={global?.mcap ?? 0} format={(v) => fmtCompact(v)} />
            </div>
          </div>
          <span className={`pill ${(global?.mcapChange ?? 0) >= 0 ? 'pill-up' : 'pill-down'}`}>
            {fmtPct(global?.mcapChange ?? 0, 2)}
          </span>
        </div>

        <div className="grid-3">
          <div>
            <div className="faint">{t('market.volume24h')}</div>
            <div className="mono" style={{ fontSize: 13 }}>{fmtCompact(global?.volume ?? 0)}</div>
          </div>
          <div>
            <div className="faint">{t('market.btcDominance')}</div>
            <div className="mono" style={{ fontSize: 13 }}>{(global?.btcDominance ?? 0).toFixed(2)}%</div>
          </div>
          <div>
            <div className="faint">{t('market.ethDominance')}</div>
            <div className="mono" style={{ fontSize: 13 }}>{(global?.ethDominance ?? 0).toFixed(2)}%</div>
          </div>
        </div>

        <div className="progress" style={{ marginTop: 12 }}>
          <motion.div
            className="progress-fill"
            initial={{ width: 0 }}
            animate={{ width: `${global?.btcDominance ?? 50}%` }}
            transition={{ duration: 1, ease: 'easeOut' }}
          />
        </div>
      </motion.section>

      <motion.div className="grid-3" variants={stagger} initial="hidden" animate="show">
        <StatTile label={t('market.coins')} value={fmtNum(global?.coins ?? 0)} />
        <StatTile label={t('market.markets')} value={fmtNum(global?.markets ?? 0)} />
        <StatTile
          label={t('market.avgChange')}
          value={fmtPct(global?.avgChange ?? 0, 2)}
          tone={(global?.avgChange ?? 0) >= 0 ? 'up' : 'down'}
        />
      </motion.div>

      {/* ---------- hero coin ---------- */}
      {hero && (
        <motion.section
          className="card"
          variants={riseIn}
          initial="hidden"
          animate="show"
          onClick={() => navigate(`/coin/${hero.id}`)}
          style={{ cursor: 'pointer' }}
        >
          <div className="row-between">
            <div className="row">
              <div className="coin-logo">{hero.image ? <img src={hero.image} alt="" /> : hero.symbol.slice(0, 3)}</div>
              <div>
                <div style={{ fontWeight: 700 }}>{hero.name}</div>
                <div className="faint">{hero.symbol} / USD</div>
              </div>
            </div>
            <div style={{ textAlign: 'end' }}>
              <div className="stat-mini">
                <AnimatedNumber value={hero.price} format={(v) => `$${fmtNum(v, 2)}`} />
              </div>
              <div className={`mono ${hero.change24h >= 0 ? 'up' : 'down'}`} style={{ fontSize: 11 }}>
                {fmtPct(hero.change24h)}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <Sparkline data={hero.sparkline ?? []} up={hero.change24h >= 0} width={470} height={64} strokeWidth={2} />
          </div>
        </motion.section>
      )}

      <AdBanner slot="signals" />

      {/* ---------- trending ---------- */}
      {trending?.length > 0 && (
        <section>
          <p className="section-label">🔥 {t('market.trending')}</p>
          <div className="tag-scroll" style={{ marginTop: 8 }}>
            {trending.map((c) => (
              <motion.button
                key={c.id}
                className="tag"
                whileTap={{ scale: 0.94 }}
                onClick={() => navigate(`/coin/${c.id}`)}
              >
                {c.image && <img src={c.image} alt="" width={14} height={14} style={{ borderRadius: 4, marginInlineEnd: 5, verticalAlign: -2 }} />}
                {c.symbol}
              </motion.button>
            ))}
          </div>
        </section>
      )}

      {/* ---------- list ---------- */}
      <section>
        <p className="section-label">{t('market.allCoins')}</p>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('market.search')}
          style={{ margin: '10px 0' }}
        />

        <div className="tag-scroll" style={{ marginBottom: 10 }}>
          {FILTERS.map((f) => (
            <button key={f} className={`tag ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
              {t(`market.filter.${f}`)}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="stack">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skel" style={{ height: 58 }} />
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="empty">
            <span className="empty-icon">🔍</span>
            {t('market.noResults')}
          </div>
        ) : (
          <motion.div className="stack" style={{ gap: 8 }} variants={stagger} initial="hidden" animate="show">
            {list.map((c, i) => (
              <CoinRow key={c.id} coin={c} rank={i + 1} onClick={() => navigate(`/coin/${c.id}`)} />
            ))}
          </motion.div>
        )}
      </section>
    </PageTransition>
  );
}
