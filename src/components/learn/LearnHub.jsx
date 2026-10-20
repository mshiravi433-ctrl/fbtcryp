/**
 * LearnHub — the shell around the three Learn tabs.
 * ---------------------------------------------------------------------------
 * راهنما · مستندات · ویدیوها, each with its own sub-tab rail inside.
 *
 * ─── WHY A SHELL, NOT THREE PAGES WITH A MENU ──────────────────────────────
 * Someone who is stuck does not know whether their problem is a FAQ entry, a
 * guide or a video, and making them guess between menu items is the failure.
 * One address, one set of tabs, three sources underneath.
 *
 * ─── WHY ONLY THE ACTIVE TAB IS MOUNTED ────────────────────────────────────
 * The alternative — render all three and hide two with CSS — would run three
 * screens' effects at once for two nobody is looking at. The cost is that
 * switching remounts, losing scroll position and local state; for three
 * different tasks that is the right trade.
 *
 * ─── WHY THE TAB IS IN THE URL ─────────────────────────────────────────────
 * `?tab=` rather than component state, for the three reasons that have already
 * bitten this app: the Android back button can step between tabs instead of
 * leaving, a link can point at one tab, and a crash-reload returns to where
 * the user was instead of tab one. `replace`, not push — pushing would make
 * Back walk through every tab a user idly tapped.
 */
import { useEffect, useId, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageTransition from '../PageTransition';
import { useTelegram } from '../../context/TelegramContext';
import { onTabListKeyDown } from './rovingTabs';
import LearnHero from './LearnHero';
import LearnOrbMark from './LearnOrbMark';
import '../../styles/learn-hub.css';

const grad = (a, b) => `linear-gradient(135deg, ${a}, ${b})`;

export default function LearnHub({ tabs, stats }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();
  const uid = useId().replace(/:/g, '');
  const locale = i18n.resolvedLanguage || i18n.language || 'en';
  const [params, setParams] = useSearchParams();

  const fromUrl = params.get('tab');
  const valid = tabs.some((x) => x.id === fromUrl);
  const [active, setActive] = useState(valid ? fromUrl : tabs[0].id);

  /* Follow the URL when it changes underneath us — which is what happens when
     the user presses Back. Without this the address bar would say `?tab=docs`
     while the screen still showed the guide. */
  useEffect(() => {
    if (valid && fromUrl !== active) setActive(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromUrl]);

  const select = (id) => {
    if (id === active) return;
    haptic?.('select');
    setActive(id);
    setParams({ tab: id }, { replace: true });
  };

  const current = tabs.find((x) => x.id === active) ?? tabs[0];
  const Body = current.Component;
  const panelId = `${uid}-panel-${active}`;
  const fmt = (n) => new Intl.NumberFormat(locale).format(n);

  return (
    <PageTransition>
      <div className="lh-shell lh-focus">
        <span className="lh-orb a" aria-hidden="true" />
        <span className="lh-orb b" aria-hidden="true" />

        <LearnHero
          kicker={t('learn.kicker')}
          title={t('learn.heroTitle')}
          sub={t('learn.intro')}
          stats={stats}
          art={<LearnOrbMark size={92} />}
          onBack={() => navigate(-1)}
          backLabel={t('common.back')}
        />

        {/* ---------------------------- main tabs --------------------------- */}
        <div
          className="lh-tabs"
          role="tablist"
          aria-label={t('learn.tabsTitle')}
          data-tablist-id={`${uid}-main`}
          onKeyDown={(e) => onTabListKeyDown(e, tabs, active, (tab) => select(tab.id))}
        >
          {tabs.map((tab) => {
            const isActive = tab.id === active;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`${uid}-main-${tab.id}`}
                aria-selected={isActive}
                aria-controls={panelId}
                tabIndex={isActive ? 0 : -1}
                className={`lh-tab${isActive ? ' is-active' : ''}`}
                onClick={() => select(tab.id)}
                style={{ '--a': tab.a, '--b': tab.b }}
              >
                {isActive && (
                  <motion.span
                    className="lh-tab-pill"
                    layoutId={`${uid}-mainpill`}
                    style={{ background: grad(tab.a, tab.b) }}
                    transition={{ type: 'spring', stiffness: 430, damping: 34 }}
                  />
                )}
                <span className="lh-tab-inner">
                  <span className="lh-tab-badge">
                    <tab.Icon width={18} height={18} aria-hidden="true" />
                  </span>
                  <span className="lh-tab-text">
                    <span className="lh-tab-name">{t(`learn.tabs.${tab.id}`)}</span>
                    <span className="lh-tab-hint">{t(`learn.tabsSub.${tab.id}`)}</span>
                  </span>
                </span>
                {typeof tab.count === 'number' && (
                  <span className="lh-tab-count" aria-hidden="true">{fmt(tab.count)}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* ----------------------------- panel ------------------------------ */}
        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            id={panelId}
            role="tabpanel"
            aria-labelledby={`${uid}-main-${active}`}
            className="lh-viewport"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <Body embedded />
          </motion.div>
        </AnimatePresence>
      </div>
    </PageTransition>
  );
}
