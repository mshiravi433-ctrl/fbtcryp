import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import FbtPanel from '../components/FbtPanel';
import AdBanner from '../components/AdBanner';
import AnimatedNumber from '../components/AnimatedNumber';
import { useAppStore } from '../store/useAppStore';
import { tierFor, nextTier, tierProgress, TIERS, POINT_VALUES } from '../lib/ranks';
import { fmtNum, fmtDateTime } from '../lib/format';
import { IconChevronLeft } from '../components/Icons';

/**
 * YOUR POINTS — formerly "Top traders" / the leaderboard.
 *
 * ─── WHY THE BOARD IS GONE ──────────────────────────────────────────────────
 * Asked for directly: «تبدیلش کن به امتیاز تو و برترین ها نباشه [...] فقط
 * امتیاز همون فرد» — make it your points, drop the rankings, show only this
 * person's score and nobody else's.
 *
 * The immediate trigger was the empty state reading "nobody has posted a score
 * yet", which is a strange thing for an app to tell its user about itself. But
 * the deeper problem is the one the instruction fixes: the screen's whole
 * premise was comparison, and there was nothing honest to compare against.
 * /api/leaderboard returns `{"rows":[]}` — measured live — so every user saw
 * either an empty hall or a board of one. Ranking somebody against an empty
 * set produces "#1 of 1", which flatters and means nothing.
 *
 * ─── WHAT REPLACED IT, AND WHY IT IS MORE THAN A DELETION ───────────────────
 * The points were always real (they are awarded from confirmed events — see
 * QUEST_POINTS in useAppStore) but the user could only ever see a TOTAL. Where
 * that total came from was invisible, which is exactly what makes a score feel
 * arbitrary. `pointsLog` has been recorded on every award all along and was
 * rendered NOWHERE — grepped: zero references in any .jsx before this change.
 *
 * So the space the podium and the table used to occupy now shows that log:
 * every award, what it was for, and when. Same layout language, same tier
 * card, same "how to earn" table — the styling the owner explicitly asked to
 * keep — with the comparison replaced by an explanation.
 *
 * ─── WHAT THIS SCREEN NO LONGER DOES ────────────────────────────────────────
 * It does not call the network at all. It used to POST this device's score,
 * display name and referral count to a public endpoint on every open, purely
 * so it could be ranked. With the ranking gone that upload has no purpose, and
 * publishing a name and a score nobody will ever read is a privacy cost with
 * no product left behind it. `publishScore` and `fetchLeaderboard` are no
 * longer imported here.
 *
 * A consequence worth stating plainly: the screen now works offline, and it
 * can no longer show a stale rank cached from a previous session.
 */

/** Human label for a pointsLog entry. */
function actionLabel(t, action) {
  /*
   * Quest awards are logged as `quest:<id>` by awardPointsOnce, so the raw
   * action string is not a translation key on its own. Splitting first means a
   * quest and its standalone equivalent (`firstSwap` fired from Swap.jsx vs
   * `quest:firstSwap`) resolve to the SAME label instead of one of them
   * rendering as the literal string "quest:firstSwap" on screen.
   */
  const id = String(action ?? '').replace(/^quest:/, '');
  /*
   * i18next returns the key itself when it is missing, which is how a raw id
   * would leak into the UI. Ask for no fallback, then supply our own.
   */
  const label = t(`rank.action.${id}`, { defaultValue: '' });
  return label || t('rank.action.quest');
}

export default function Leaderboard({ embedded = false }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const points = useAppStore((s) => s.points);
  const pointsLog = useAppStore((s) => s.pointsLog);

  const tier = tierFor(points);
  const next = nextTier(points);
  const progress = tierProgress(points);

  /*
   * Newest first. The store already prepends, but sorting here means the list
   * cannot be thrown out of order by a future write that appends instead —
   * a history that is nearly in order is harder to read than one that is not.
   */
  const history = useMemo(
    () => [...(pointsLog ?? [])].sort((a, b) => (b.at ?? 0) - (a.at ?? 0)),
    [pointsLog]
  );

  return (
    <PageTransition embedded={embedded}>
      {!embedded && (
        <motion.div className="row" style={{ gap: 10 }} variants={riseIn} initial="hidden" animate="show">
          <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
            <IconChevronLeft width={18} height={18} />
          </button>
          <h1 className="h1" style={{ fontSize: 19 }}>{t('rank.title')}</h1>
        </motion.div>
      )}

      {/*
        ─── THE FBT BALANCE, ABOVE THE POINTS CARD ─────────────────────────
        Asked for our own coin. The full reasoning is in docs/FBT-TOKEN-FA.md;
        the short version is that a real on-chain token needs a liquidity pool
        — real money, locked — and the market rate for a working launch is
        $35k-$280k against a standing "no money to spend" constraint.

        This is the half that is free and honest today: the points that have
        been accruing all along, given a name, a symbol and an actual job
        (cheaper swaps, free adverts). If a token is ever affordable, this
        balance converts one-to-one and nobody was promised anything we could
        not deliver.

        It sits ABOVE the rank card because it is the thing with consequences;
        the rank is a label.
      */}
      <FbtPanel />

      {/* ---------------- your points ---------------- */}
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
              {/*
                Was "Rank #4" / "Not ranked yet". A position is meaningless
                without the field it was measured against, and there is no
                field any more. The tier is the standing now, and it is one the
                user reaches on their own rather than by out-scoring somebody.
              */}
              <div className="faint">
                {next ? t('rank.atTier', { tier: t(`rank.tier.${tier.id}`) }) : t('rank.topTier')}
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

      {/* ---------------- where your points came from ---------------- */}
      <section>
        <p className="section-label">{t('rank.historyTitle')}</p>

        {history.length === 0 ? (
          /*
            The empty state the owner asked for, in the first person: "you
            haven't earned any points yet", not "nobody has posted a score".
            The old wording described the state of a shared board — which,
            since we no longer keep one, would have been describing something
            that does not exist.
          */
          <div className="empty" style={{ marginTop: 10 }}>
            <span className="empty-icon">✨</span>
            {points > 0 ? t('rank.historyEmpty') : t('rank.noneYet')}
          </div>
        ) : (
          <motion.div className="stack" style={{ gap: 6, marginTop: 10 }} variants={stagger} initial="hidden" animate="show">
            {history.map((entry) => (
              <motion.div key={entry.id} variants={riseIn} className="coin-row">
                {/*
                  A neutral mark, deliberately NOT the tier medal. Stamping
                  today's medal on every past award would say the row was
                  earned at that tier, and the log does not record what tier
                  the user held at the time — so the medal would be a claim we
                  cannot support.
                */}
                <span style={{ fontSize: 16 }}>✨</span>
                <div className="coin-meta">
                  <div className="coin-sym" style={{ textTransform: 'none', fontSize: 12.5 }}>
                    {actionLabel(t, entry.action)}
                  </div>
                  <div className="coin-name">{fmtDateTime(entry.at)}</div>
                </div>
                <div className="coin-right">
                  <div className="mono up" style={{ fontSize: 12.5, fontWeight: 700 }}>
                    +{fmtNum(entry.amount)}
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </section>

      {/*
        `swap`, not `referral`: the referral slot points at /earn, and this
        screen is one of the Rewards tabs, so that banner threw the user out of
        the tabbed page into a standalone copy of the tab beside them. Swap is
        the honest destination — points come from swapping, and it is the route
        that actually earns the platform fee.
      */}
      <AdBanner slot="swap" compact />

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

      {/*
        The three old notices described the BOARD's state — live, cached, or
        device-only. None of them applies now, and leaving one would describe
        machinery that is gone. This says the one thing that is true of the new
        screen and that the user cannot verify for themselves: the score is not
        published anywhere.
      */}
      <p className="notice">{t('rank.privateNote')}</p>
    </PageTransition>
  );
}
