import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import AdBanner from '../components/AdBanner';
import AnimatedNumber from '../components/AnimatedNumber';
import { useAppStore } from '../store/useAppStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { tierFor, nextTier, tierProgress, TIERS, TOP_N, POINT_VALUES } from '../lib/ranks';
import { decorate, fetchLeaderboard, publishScore } from '../lib/leaderboard';
import { useTelegram } from '../context/TelegramContext';
import { fmtNum } from '../lib/format';
import { IconChevronLeft } from '../components/Icons';

/** Podium card for ranks 1–3. */
function Podium({ row, place }) {
  const { t } = useTranslation();
  const heights = { 1: 96, 2: 74, 3: 62 };
  const order = { 1: 2, 2: 1, 3: 3 };

  return (
    <motion.div
      style={{ order: order[place], flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 * place, type: 'spring', stiffness: 260, damping: 20 }}
    >
      <motion.div
        animate={{ y: [0, -4, 0] }}
        transition={{ duration: 3 + place * 0.4, repeat: Infinity, ease: 'easeInOut' }}
        style={{ fontSize: place === 1 ? 30 : 24 }}
      >
        {row.tier.icon}
      </motion.div>

      <div style={{ fontSize: 10.5, fontWeight: 700, textAlign: 'center', maxWidth: 74, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {row.name}
      </div>
      <div className="mono" style={{ fontSize: 10, color: row.tier.color }}>{fmtNum(row.points)}</div>

      <motion.div
        initial={{ height: 0 }}
        animate={{ height: heights[place] }}
        transition={{ delay: 0.15 * place, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        style={{
          width: '100%',
          borderRadius: '14px 14px 0 0',
          background: `linear-gradient(180deg, ${row.tier.color}44, ${row.tier.color}0d)`,
          border: `1px solid ${row.tier.color}66`,
          borderBottom: 'none',
          display: 'grid',
          placeItems: 'start center',
          paddingTop: 8,
          fontFamily: 'var(--font-mono)',
          fontWeight: 700,
          fontSize: 17,
          color: row.tier.color
        }}
      >
        {place}
      </motion.div>
    </motion.div>
  );
}

export default function Leaderboard({ embedded = false }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const { tg } = useTelegram();
  const points = useAppStore((s) => s.points);
  const referrals = useAppStore((s) => s.referrals);
  const username = useSettingsStore((s) => s.username);

  /**
   * Live board from the API. Opening the screen also publishes this device's
   * score, which is why the board fills up on its own once the app is in real
   * hands — no seeding required, and nothing invented.
   */
  const [board, setBoard] = useState({ rows: [], live: true, durable: true, at: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      // Publish first so our own row is in the response we are about to read.
      await publishScore({
        name: username,
        points,
        referrals,
        telegramInitData: tg?.initData
      });
      const data = await fetchLeaderboard();
      if (!alive) return;
      setBoard(data);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, username, referrals]);

  const rows = useMemo(() => decorate(board.rows, { points, username }), [board, points, username]);
  const top = rows.slice(0, TOP_N);
  const me = rows.find((r) => r.isUser);

  const tier = tierFor(points);
  const next = nextTier(points);
  const progress = tierProgress(points);

  return (
    <PageTransition embedded={embedded}>
      {/* Suppressed when hosted in a tabbed page — the shell already draws a
          back button and a title, and two of each is clutter. */}
      {!embedded && (
        <motion.div className="row" style={{ gap: 10 }} variants={riseIn} initial="hidden" animate="show">
          <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
            <IconChevronLeft width={18} height={18} />
          </button>
          <h1 className="h1" style={{ fontSize: 19 }}>{t('rank.title')}</h1>
        </motion.div>
      )}

      {/* ---------------- your rank ---------------- */}
      <motion.section
        className="card card-rgb"
        variants={riseIn}
        initial="hidden"
        animate="show"
        style={{ borderColor: `${tier.color}55` }}
      >
        <div className="aurora" />
        <div className="row-between">
          <div className="row" style={{ gap: 12 }}>
            <motion.div
              animate={{ scale: [1, 1.08, 1], rotate: [0, 4, 0] }}
              transition={{ duration: 3.5, repeat: Infinity }}
              style={{
                width: 52,
                height: 52,
                borderRadius: 17,
                display: 'grid',
                placeItems: 'center',
                fontSize: 25,
                background: `radial-gradient(circle at 30% 30%, ${tier.color}44, transparent 70%)`,
                border: `1px solid ${tier.color}66`,
                boxShadow: `0 0 22px -6px ${tier.glow}`
              }}
            >
              {tier.icon}
            </motion.div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15, color: tier.color }}>{t(`rank.tier.${tier.id}`)}</div>
              <div className="faint">
                {me ? t('rank.yourRank', { n: me.rank }) : t('rank.unranked')}
              </div>
            </div>
          </div>
          <div style={{ textAlign: 'end' }}>
            <div className="stat-mini">
              <AnimatedNumber value={points} format={(v) => fmtNum(v, 0)} />
            </div>
            <div className="faint">{t('rank.points')}</div>
          </div>
        </div>

        {next && (
          <>
            <div className="progress" style={{ marginTop: 13 }}>
              <motion.div
                className="progress-fill"
                initial={{ width: 0 }}
                animate={{ width: `${progress * 100}%` }}
                transition={{ duration: 0.9, ease: 'easeOut' }}
                style={{ background: `linear-gradient(90deg, ${tier.color}, ${next.color})` }}
              />
            </div>
            <div className="row-between" style={{ marginTop: 5 }}>
              <span className="faint mono">{fmtNum(points)}</span>
              <span className="faint">
                {t('rank.toNext', { n: fmtNum(next.min - points), tier: t(`rank.tier.${next.id}`) })}
              </span>
            </div>
          </>
        )}
      </motion.section>

      {/* ---------------- all tiers ---------------- */}
      <section>
        <p className="section-label">{t('rank.tiers')}</p>
        <div className="tag-scroll" style={{ marginTop: 8 }}>
          {TIERS.map((tr) => (
            <motion.div
              key={tr.id}
              className="tag"
              whileTap={{ scale: 0.95 }}
              style={{
                borderColor: points >= tr.min ? tr.color : 'var(--line)',
                background: points >= tr.min ? `${tr.color}1f` : undefined,
                color: points >= tr.min ? tr.color : 'var(--text-3)',
                opacity: points >= tr.min ? 1 : 0.6
              }}
            >
              {tr.icon} {t(`rank.tier.${tr.id}`)} · {fmtNum(tr.min)}
            </motion.div>
          ))}
        </div>
      </section>

      {/* ---------------- podium ---------------- */}
      <section>
        <p className="section-label">{t('rank.top')}</p>
        {loading ? (
          <div className="skel" style={{ height: 120, marginTop: 12 }} />
        ) : top.length === 0 ? (
          // An empty real board beats a full fake one. It fills up on its own
          // as people use the app, and saying that is more reassuring than
          // pretending fifty strangers already out-ranked you.
          <div className="empty" style={{ marginTop: 10 }}>
            <span className="empty-icon">🏆</span>
            {t('rank.emptyBoard')}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginTop: 12 }}>
            {top.slice(0, 3).map((r, i) => (
              <Podium key={r.id} row={r} place={i + 1} />
            ))}
          </div>
        )}
      </section>

      {/*
        `swap`, not `referral`.

        The referral slot points at `/earn`, and inside the Rewards tabs this
        screen IS one of the earn tabs — so the banner threw the user out of
        the tabbed page into a standalone copy of the tab beside them. Same
        self-referential bug as the one removed from Earn.

        Swap is the honest destination here: points on this board come from
        swapping, it is a different screen from this one, and it is the route
        that actually earns the platform fee.
      */}
      <AdBanner slot="swap" compact />

      {/* ---------------- table ---------------- */}
      <motion.div className="stack" style={{ gap: 6 }} variants={stagger} initial="hidden" animate="show">
        {top.slice(3).map((r) => (
          <motion.div
            key={r.id}
            variants={riseIn}
            className="coin-row"
            style={
              r.isUser
                ? { borderColor: 'var(--rgb-1)', background: 'rgba(0,229,255,.08)' }
                : undefined
            }
          >
            <span
              className="mono"
              style={{ width: 24, fontSize: 11, color: 'var(--text-3)', textAlign: 'center' }}
            >
              {r.rank}
            </span>
            <span style={{ fontSize: 16 }}>{r.tier.icon}</span>
            <div className="coin-meta">
              <div className="coin-sym" style={{ textTransform: 'none', fontSize: 12.5 }}>
                {r.isUser ? t('rank.you') : r.name}
              </div>
              <div className="coin-name">
                {t('rank.refs', { n: r.referrals })} · {t('rank.swaps', { n: r.swaps })}
              </div>
            </div>
            <div className="coin-right">
              <div className="mono" style={{ fontSize: 12.5, color: r.tier.color, fontWeight: 700 }}>
                {fmtNum(r.points)}
              </div>
            </div>
          </motion.div>
        ))}
      </motion.div>

      {/* ---------------- how to earn points ---------------- */}
      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <p className="section-label" style={{ marginBottom: 10 }}>{t('rank.howTo')}</p>
        {Object.entries(POINT_VALUES).map(([k, v], i) => (
          <motion.div
            key={k}
            className="row-between"
            style={{ padding: '7px 0', borderBottom: '1px solid var(--line)' }}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.03 }}
          >
            <span style={{ fontSize: 12.3 }}>{t(`rank.action.${k}`)}</span>
            <span className="mono up" style={{ fontSize: 12 }}>+{v}</span>
          </motion.div>
        ))}
        <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => navigate('/earn')}>
          {t('rank.startEarning')}
        </button>
      </motion.section>

      {/* Say what this board actually is, in the state it is actually in. */}
      <p className="notice">
        {!board.live
          ? t('rank.offlineNotice')
          : board.durable
            ? t('rank.demoNotice')
            : t('rank.localOnly')}
      </p>
    </PageTransition>
  );
}
