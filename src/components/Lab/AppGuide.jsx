/**
 * AppGuide — «راهنمای گام‌به‌گام برنامه» for the Lab Practice group.
 *
 * Reported: the Lab should have a section, in the same visual language as
 * the rest of the tab, that walks every area of the app END TO END — from
 * connecting a wallet to the finished result — with a picture per step:
 * Swap, Bridge, Loan, Guard (insurance + MEV guard), Stocks (each tab) and
 * Futures (each tab).
 *
 * ─── SHAPE ──────────────────────────────────────────────────────────────────
 * `AREAS` is pure data: which areas exist, which sections (tabs) each has,
 * and which steps each section walks, with the illustration each step uses
 * (`GuideArt`). ALL prose lives in i18n under `lab2.guide.*` — hard-coding
 * Persian here is the mistake Glossary already paid for.
 *
 * The section ids for Stocks and Futures are the SAME ids those pages use
 * for their tabs (`stocks.tab.*`, `perp.tabs.*`), so the guide cannot drift
 * from the real screens without a grep hit, and the «open» link deep-links
 * to that tab.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { LAB_EASE, LabBack, LabChips, Notice, Panel } from './Shared';
import { LabIcon } from './LabIcons';
import { useStill } from '../AnimatedIcon';
import GuideArt from './GuideArt';

/* Steps shared by more than one flow, so the tables below stay readable. */
const CONNECT = { id: 'connect', art: 'wallet' };
const SIGN = { id: 'sign', art: 'sign' };
const DONE = { id: 'done', art: 'done' };

export const AREAS = [
  {
    id: 'swap',
    accent: 'cyan',
    icon: 'refresh',
    route: '/swap',
    sections: [
      {
        id: 'flow',
        steps: [
          CONNECT,
          { id: 'network', art: 'network' },
          { id: 'pair', art: 'tokens' },
          { id: 'quote', art: 'quote' },
          { id: 'guard', art: 'shield' },
          SIGN,
          DONE
        ]
      }
    ]
  },
  {
    id: 'bridge',
    accent: 'violet',
    icon: 'layers',
    route: '/bridge',
    sections: [
      {
        id: 'flow',
        steps: [
          CONNECT,
          { id: 'chains', art: 'network' },
          { id: 'asset', art: 'tokens' },
          { id: 'route', art: 'quote' },
          SIGN,
          { id: 'wait', art: 'track' },
          DONE
        ]
      }
    ]
  },
  {
    id: 'loan',
    accent: 'mint',
    icon: 'bank',
    route: '/loan',
    sections: [
      {
        id: 'flow',
        steps: [
          CONNECT,
          { id: 'market', art: 'network' },
          { id: 'collateral', art: 'gauge' },
          { id: 'health', art: 'health' },
          SIGN,
          { id: 'manage', art: 'track' },
          { id: 'repay', art: 'done' }
        ]
      }
    ]
  },
  {
    id: 'guard',
    accent: 'amber',
    icon: 'shield',
    route: '/insurance',
    sections: [
      {
        id: 'insurance',
        route: '/insurance',
        steps: [
          CONNECT,
          { id: 'dashboard', art: 'tabs' },
          { id: 'marketplace', art: 'quote' },
          { id: 'buy', art: 'sign' },
          { id: 'coverage', art: 'shield' },
          { id: 'claim', art: 'doc' }
        ]
      },
      {
        id: 'mev',
        route: '/swap',
        steps: [
          { id: 'where', art: 'tabs' },
          { id: 'level', art: 'gauge' },
          { id: 'minOut', art: 'quote' },
          { id: 'private', art: 'shield' },
          { id: 'result', art: 'done' }
        ]
      }
    ]
  },
  {
    id: 'stocks',
    accent: 'magenta',
    icon: 'trend',
    route: '/stocks',
    sections: [
      {
        id: 'equity',
        route: '/stocks?tab=equity',
        steps: [
          { id: 'browse', art: 'chart' },
          CONNECT,
          { id: 'pick', art: 'tokens' },
          { id: 'quote', art: 'quote' },
          SIGN,
          { id: 'hold', art: 'done' }
        ]
      },
      {
        id: 'rwa',
        route: '/stocks?tab=rwa',
        steps: [
          { id: 'browse', art: 'chart' },
          { id: 'read', art: 'doc' },
          CONNECT,
          { id: 'quote', art: 'quote' },
          SIGN,
          { id: 'hold', art: 'done' }
        ]
      },
      {
        id: 'ostium',
        route: '/stocks?tab=ostium',
        steps: [
          CONNECT,
          { id: 'network', art: 'network' },
          { id: 'market', art: 'chart' },
          { id: 'size', art: 'gauge' },
          SIGN,
          { id: 'manage', art: 'track' }
        ]
      },
      {
        id: 'derivatives',
        route: '/stocks?tab=derivatives',
        steps: [
          { id: 'browse', art: 'tabs' },
          CONNECT,
          { id: 'contract', art: 'doc' },
          { id: 'risk', art: 'health' },
          SIGN,
          { id: 'manage', art: 'track' }
        ]
      }
    ]
  },
  {
    id: 'perp',
    accent: 'rose',
    icon: 'activity',
    route: '/perp',
    sections: [
      {
        id: 'overview',
        route: '/perp',
        steps: [
          { id: 'index', art: 'chart' },
          { id: 'funding', art: 'gauge' },
          { id: 'liq', art: 'health' },
          { id: 'next', art: 'tabs' }
        ]
      },
      {
        id: 'dydx',
        route: '/perp?tab=dydx',
        steps: [
          CONNECT,
          { id: 'deposit', art: 'network' },
          { id: 'market', art: 'chart' },
          { id: 'order', art: 'gauge' },
          SIGN,
          { id: 'manage', art: 'track' }
        ]
      },
      {
        id: 'onchain',
        route: '/perp?tab=onchain',
        steps: [
          CONNECT,
          { id: 'network', art: 'network' },
          { id: 'venue', art: 'tabs' },
          { id: 'position', art: 'gauge' },
          SIGN,
          { id: 'close', art: 'done' }
        ]
      }
    ]
  }
];

export default function AppGuide({ onBack }) {
  const { t } = useTranslation();
  const still = useStill();
  const [areaId, setAreaId] = useState(AREAS[0].id);
  const area = AREAS.find((a) => a.id === areaId) || AREAS[0];
  const [sectionId, setSectionId] = useState(area.sections[0].id);

  const section = area.sections.find((s) => s.id === sectionId) || area.sections[0];

  const areaChips = useMemo(
    () => AREAS.map((a) => ({ id: a.id, label: t(`lab2.guide.areas.${a.id}.title`) })),
    [t]
  );
  const sectionChips = useMemo(
    () => area.sections.map((s) => ({ id: s.id, label: t(`lab2.guide.areas.${area.id}.sections.${s.id}.title`) })),
    [area, t]
  );

  const pickArea = (id) => {
    const next = AREAS.find((a) => a.id === id);
    if (!next) return;
    setAreaId(id);
    setSectionId(next.sections[0].id);
  };

  const k = (rest) => `lab2.guide.areas.${area.id}.${rest}`;
  const sk = (rest) => k(`sections.${section.id}.${rest}`);
  const openHref = section.route || area.route;

  return (
    <div className={`lab2-screen lab2-guide acc-${area.accent}`}>
      <LabBack
        onBack={onBack}
        icon="book"
        accent="cyan"
        title={t('lab2.screens.guide.title')}
        sub={t('lab2.screens.guide.sub')}
      />

      <LabChips items={areaChips} value={area.id} onChange={pickArea} layoutId="guide-area" accent={area.accent} />

      <Panel
        accent={area.accent}
        className="lab2-guide-intro"
        icon={area.icon}
        title={t(k('title'))}
        action={(
          <Link className="lab2-guide-open" to={openHref}>
            {t('lab2.guide.open')}
            <LabIcon name="next" width={13} height={13} />
          </Link>
        )}
      >
        <p className="lab2-guide-lead">{t(k('sub'))}</p>
        {area.sections.length > 1 && (
          <LabChips
            items={sectionChips}
            value={section.id}
            onChange={setSectionId}
            layoutId={`guide-section-${area.id}`}
            accent={area.accent}
            size="sm"
          />
        )}
        {area.sections.length > 1 && (
          <p className="lab2-guide-section-sub">{t(sk('sub'))}</p>
        )}
      </Panel>

      <ol className="lab2-guide-steps" key={`${area.id}:${section.id}`}>
        {section.steps.map((step, i) => (
          <motion.li
            key={step.id}
            className="lab2-guide-step"
            initial={still ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.36, ease: LAB_EASE, delay: still ? 0 : Math.min(i * 0.06, 0.4) }}
          >
            <div className="lab2-guide-rail" aria-hidden="true">
              <span className="lab2-guide-num">{i + 1}</span>
              {i < section.steps.length - 1 && <span className="lab2-guide-line" />}
            </div>
            <div className="lab2-guide-card">
              <GuideArt name={step.art} />
              <div className="lab2-guide-text">
                <div className="lab2-guide-step-title">{t(sk(`steps.${step.id}.title`))}</div>
                <p className="lab2-guide-step-body">{t(sk(`steps.${step.id}.body`))}</p>
              </div>
            </div>
          </motion.li>
        ))}
      </ol>

      <Notice variant="tip" icon="bulb">{t('lab2.guide.note')}</Notice>
    </div>
  );
}
