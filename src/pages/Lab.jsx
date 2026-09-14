/**
 * LAB v2 — Financial Simulation Center.
 *
 * ─── WHAT THIS PAGE IS ─────────────────────────────────────────────────────
 * A single screen with three groups (Practice · Learn · Advanced) and nine
 * child screens behind them. The home view shows the user's level and
 * virtual balance, plus the card grid. Tapping a card drills into the
 * corresponding simulator.
 *
 * ─── WHY THREE GROUPS, NOT NINE TABS ──────────────────────────────────────
 * The previous version of this screen had only two tabs (Predict / Invest)
 * and the rest of the Lab content was buried elsewhere. The spec asks for
 * nine sections. On a phone, nine flat tabs is unusable: the labels truncate
 * and the strip scrolls horizontally. Three groups is the largest number
 * that still fits cleanly above the fold, and the cards under each group
 * are big enough to be readable.
 *
 * ─── WHY EACH CHILD IS ITS OWN URL ────────────────────────────────────────
 * The selected child is reflected in the URL via `?child=…` (the parent
 * group is the tab, e.g. `?tab=practice&child=predict`). This makes every
 * simulator deep-linkable from elsewhere in the app, and survives the
 * Android back button.
 *
 * ─── VIRTUAL EVERYTHING ───────────────────────────────────────────────────
 * The whole screen runs on `useLabStore`, a separate zustand store persisted
 * to `localStorage` under `fbt-lab-v1`. No balance or XP ever leaves the
 * device. The Lab persists independently of the main app wallet so resetting
 * one does not reset the other.
 *
 * ─── THE 2026 VISUAL PASS ─────────────────────────────────────────────────
 * Emoji are out, `LabIcons` SVGs are in; the tab strip is a segmented control
 * with a pill that slides between tabs (framer `layoutId`); the header is an
 * aurora hero with a level ring and spring-animated counters; cards cascade in
 * and carry a pointer spotlight. All of it collapses to a still, instant
 * render when reduced motion is on — see `useStill()`.
 */

import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { useTelegram } from '../context/TelegramContext';
import { useStill } from '../components/AnimatedIcon';
import PageTransition from '../components/PageTransition';
import { IconChevronLeft, IconFlask, LabIcon } from '../components/Lab/LabIcons';
import { LAB_EASE, LabCard, LabHeader } from '../components/Lab/Shared';
import PracticeGroup from '../components/Lab/PracticeGroup';
import LearnGroup from '../components/Lab/LearnGroup';
import AdvancedGroup from '../components/Lab/AdvancedGroup';
import ComparePortfolios from '../components/Lab/ComparePortfolios';
import LevelSystem from '../components/Lab/LevelSystem';
import Leaderboard from '../components/Lab/Leaderboard';
import '../styles/lab-v2.css';
import '../styles/lab-modern.css'; // re-use the older glass / aurora styles that already exist
import '../styles/lab-polish.css';

/* `icon` is a name in the LabIcons registry, `accent` an .acc-* utility.
   Both are data, not markup — that is what keeps the three group files
   identical apart from their card tables. */
const GROUPS = [
  { id: 'practice', Group: PracticeGroup, icon: 'bolt', accent: 'cyan' },
  { id: 'learn', Group: LearnGroup, icon: 'cap', accent: 'amber' },
  { id: 'advanced', Group: AdvancedGroup, icon: 'rocket', accent: 'magenta' }
];

const MORE_TOOLS = [
  { id: 'compare', icon: 'scale', accent: 'cyan' },
  { id: 'level', icon: 'trophy', accent: 'amber' },
  { id: 'leaderboard', icon: 'medal', accent: 'magenta' }
];

const TAB_SPRING = { type: 'spring', stiffness: 480, damping: 38, mass: 0.75 };

export default function Lab() {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const navigate = useNavigate();
  const still = useStill();
  const [params, setParams] = useSearchParams();

  const fromUrlTab = params.get('tab');
  const fromUrlChild = params.get('child');
  const fromUrlTool = params.get('tool');
  const validTab = GROUPS.some((g) => g.id === fromUrlTab);
  const [tab, setTab] = useState(validTab ? fromUrlTab : GROUPS[0].id);
  const [child, setChild] = useState(fromUrlChild || null);
  const [tool, setTool] = useState(fromUrlTool || null);

  // Sync tab from URL (back button)
  useEffect(() => {
    if (validTab && fromUrlTab !== tab) setTab(fromUrlTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromUrlTab]);

  const selectTab = (id) => {
    if (id === tab) return;
    haptic?.('select');
    setTab(id);
    setChild(null);
    setTool(null);
    setParams({ tab: id }, { replace: true });
  };

  const selectChild = (id) => {
    haptic?.('select');
    setChild(id);
    setParams({ tab, child: id || undefined }, { replace: true });
  };

  const selectTool = (id) => {
    haptic?.('select');
    setTool(id);
    setParams({ tab, tool: id || undefined }, { replace: true });
  };

  const ActiveGroup = GROUPS.find((g) => g.id === tab)?.Group;
  const activeAccent = GROUPS.find((g) => g.id === tab)?.accent ?? 'cyan';

  return (
    <PageTransition>
      <div className="lab2">
        {/* Ambient wash behind the whole screen. First child, z-index 0; every
            sibling is lifted above it by `.lab2 > *`. */}
        <div className="lab2-bg" aria-hidden="true">
          <span className="lab2-bg-grid" />
        </div>

        <div className="lab2-topbar">
          <button
            className="lab2-icon-btn"
            type="button"
            onClick={() => navigate(-1)}
            aria-label={t('common.back', 'Back')}
          >
            <span className="lab2-back-glyph" style={{ display: 'inline-flex' }}>
              <IconChevronLeft width={19} height={19} />
            </span>
          </button>
          <div className="lab2-topbar-text">
            <div className="lab2-topbar-title">
              <span className="lab2-grad-text">{t('lab2.title')}</span>
            </div>
            <div className="lab2-topbar-sub">{t('lab2.subtitle')}</div>
          </div>
          <div className="lab2-screen-badge acc-violet" aria-hidden="true">
            <IconFlask width={23} height={23} />
          </div>
        </div>

        <LabHeader />

        {/* Main tabs: Practice / Learn / Advanced — a segmented control whose
            active pill physically travels between tabs. */}
        <div className={`lab2-tabs acc-${activeAccent}`} role="tablist" aria-label={t('lab2.title')}>
          {GROUPS.map((g) => {
            const active = tab === g.id && !tool;
            return (
              <button
                key={g.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={`lab2-tab acc-${g.accent} ${active ? 'active' : ''}`}
                onClick={() => selectTab(g.id)}
              >
                {active && !still && (
                  <motion.span className="lab2-tab-pill" layoutId="lab2-tab-pill" transition={TAB_SPRING} />
                )}
                <span className="lab2-tab-icon" aria-hidden="true">
                  <LabIcon name={g.icon} width={16} height={16} />
                </span>
                <span>{t(`lab2.${g.id}`)}</span>
              </button>
            );
          })}
        </div>

        <AnimatePresence mode="wait">
          {tool === 'compare' && (
            <motion.div
              key="tool-compare"
              initial={still ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={still ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: 0.3, ease: LAB_EASE }}
            >
              <ComparePortfolios onBack={() => selectTool(null)} />
            </motion.div>
          )}
          {tool === 'level' && (
            <motion.div
              key="tool-level"
              initial={still ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={still ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: 0.3, ease: LAB_EASE }}
            >
              <LevelSystem onBack={() => selectTool(null)} />
            </motion.div>
          )}
          {tool === 'leaderboard' && (
            <motion.div
              key="tool-lb"
              initial={still ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={still ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: 0.3, ease: LAB_EASE }}
            >
              <Leaderboard onBack={() => selectTool(null)} />
            </motion.div>
          )}

          {!tool && ActiveGroup && (
            <motion.div
              key={`group-${tab}`}
              initial={still ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={still ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: 0.3, ease: LAB_EASE }}
            >
              <ActiveGroup activeChild={child} onSelectChild={selectChild} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* More tools row */}
        {!tool && !child && (
          <motion.section
            className="lab2-group"
            initial={still ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: LAB_EASE, delay: still ? 0 : 0.18 }}
          >
            <div className="lab2-group-title acc-amber">
              <span className="lab2-group-icon" aria-hidden="true">
                <LabIcon name="toolbox" width={15} height={15} />
              </span>
              {t('lab2.more')}
            </div>
            <div className="lab2-grid">
              {MORE_TOOLS.map((m, i) => (
                <LabCard
                  key={m.id}
                  icon={m.icon}
                  accent={m.accent}
                  index={i}
                  title={t(`lab2.cards.${m.id}.title`)}
                  sub={t(`lab2.cards.${m.id}.sub`)}
                  onClick={() => selectTool(m.id)}
                />
              ))}
            </div>
          </motion.section>
        )}
      </div>
    </PageTransition>
  );
}
