/**
 * LAB v2 — Financial Simulation Center.
 *
 * ─── WHAT THIS PAGE IS ─────────────────────────────────────────────────────
 * A single screen with three groups (Practice · Learn · Advanced) and nine
 * child screens behind them. The home view shows the user's level and
 * virtual balance, plus the 3×3 card grid. Tapping a card drills into the
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
 */

import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { useTelegram } from '../context/TelegramContext';
import PageTransition from '../components/PageTransition';
import { LabHeader } from '../components/Lab/Shared';
import PracticeGroup from '../components/Lab/PracticeGroup';
import LearnGroup from '../components/Lab/LearnGroup';
import AdvancedGroup from '../components/Lab/AdvancedGroup';
import ComparePortfolios from '../components/Lab/ComparePortfolios';
import LevelSystem from '../components/Lab/LevelSystem';
import Leaderboard from '../components/Lab/Leaderboard';
import '../styles/lab-v2.css';
import '../styles/lab-modern.css'; // re-use the older glass / aurora styles that already exist

const GROUPS = [
  { id: 'practice', Group: PracticeGroup },
  { id: 'learn', Group: LearnGroup },
  { id: 'advanced', Group: AdvancedGroup }
];

const MORE_TOOLS = [
  { id: 'compare', icon: '⚖️' },
  { id: 'level', icon: '🏆' },
  { id: 'leaderboard', icon: '🎖️' }
];

export default function Lab() {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const navigate = useNavigate();
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

  return (
    <PageTransition>
      <div className="lab2">
        <div className="row" style={{ gap: 10, marginBottom: 2 }}>
          <button
            className="icon-btn"
            onClick={() => navigate(-1)}
            aria-label={t('common.back', 'Back')}
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-1)' }}
          >
            ←
          </button>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>🧪 {t('lab2.title')}</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{t('lab2.subtitle')}</div>
          </div>
        </div>

        <LabHeader />

        {/* Main tabs: Practice / Learn / Advanced */}
        <div className="lab2-tabs" style={{ marginTop: 6 }}>
          {GROUPS.map((g) => (
            <button
              key={g.id}
              className={`lab2-tab ${tab === g.id && !tool ? 'active' : ''}`}
              onClick={() => selectTab(g.id)}
            >
              {t(`lab2.${g.id}`)}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {tool === 'compare' && (
            <motion.div
              key="tool-compare"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
            >
              <ComparePortfolios onBack={() => selectTool(null)} />
            </motion.div>
          )}
          {tool === 'level' && (
            <motion.div
              key="tool-level"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
            >
              <LevelSystem onBack={() => selectTool(null)} />
            </motion.div>
          )}
          {tool === 'leaderboard' && (
            <motion.div
              key="tool-lb"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
            >
              <Leaderboard onBack={() => selectTool(null)} />
            </motion.div>
          )}

          {!tool && ActiveGroup && (
            <motion.div
              key={`group-${tab}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
            >
              <ActiveGroup activeChild={child} onSelectChild={selectChild} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* More tools row */}
        {!tool && !child && (
          <div className="lab2-group">
            <div className="lab2-group-title">
              <span className="lab2-group-emoji">🧰</span>
              {t('lab2.more')}
            </div>
            <div className="lab2-grid">
              {MORE_TOOLS.map((m) => (
                <button
                  key={m.id}
                  className="lab2-card"
                  onClick={() => selectTool(m.id)}
                >
                  <div className="lab2-card-glow amber" />
                  <div className="lab2-card-icon">{m.icon}</div>
                  <div className="lab2-card-title">{t(`lab2.cards.${m.id}.title`)}</div>
                  <div className="lab2-card-sub">{t(`lab2.cards.${m.id}.sub`)}</div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </PageTransition>
  );
}
