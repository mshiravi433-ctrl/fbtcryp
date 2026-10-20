import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import LearnHub from '../components/learn/LearnHub';
import Help from './Help';
import Docs, { DOC_SECTIONS } from './Docs';
import AparatVideos, { APARAT_COURSES } from './AparatVideos';
import { faqList } from '../lib/faqLocal';
import { IconInfo, IconDoc, IconVideo } from '../components/Icons';

/**
 * LEARN — help, documentation and the video academy in one place.
 * ---------------------------------------------------------------------------
 * Someone stuck does not know whether their problem is a FAQ entry, a guide
 * or a video, and making them guess between menu items is the failure. Help is
 * first because a person arriving here usually has a specific question; the
 * guides are what they read after it is answered, and the videos walk through
 * each feature visually.
 *
 * ─── EVERY NUMBER HERE IS COUNTED, NOT TYPED ───────────────────────────────
 * The three tab badges and the three hero chips are derived from the same
 * arrays the tabs render from — the FAQ list, DOC_SECTIONS and APARAT_COURSES.
 * A typed number is a second source of truth and the first thing to go stale:
 * add one guide and the hero would quietly promise a number the tab does not
 * hold. One source, two consumers.
 */
const TABS = [
  { id: 'help', Icon: IconInfo, a: '#00e5ff', b: '#7c4dff', Component: Help },
  { id: 'docs', Icon: IconDoc, a: '#00ff9d', b: '#00e5ff', Component: Docs },
  { id: 'videos', Icon: IconVideo, a: '#ff2d95', b: '#7c4dff', Component: AparatVideos }
];

export default function Learn() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || i18n.language || 'en';

  const faqCount = useMemo(() => faqList(i18n.language).length, [i18n.language]);

  const counts = useMemo(
    () => ({ help: faqCount, docs: DOC_SECTIONS.length, videos: APARAT_COURSES.length }),
    [faqCount]
  );

  const tabs = useMemo(() => TABS.map((tab) => ({ ...tab, count: counts[tab.id] })), [counts]);

  /* Formatted from the numbers, never from a formatted string: Number() on
     "۱۴" is NaN, and a hero chip that reads NaN is worse than one that reads
     nothing. */
  const fmt = useMemo(() => (n) => new Intl.NumberFormat(locale).format(n), [locale]);

  const stats = useMemo(
    () => [
      { value: fmt(DOC_SECTIONS.length), label: t('learn.stats.guides'), a: '#00e5ff', b: '#7c4dff' },
      { value: fmt(faqCount), label: t('learn.stats.faq'), a: '#00ff9d', b: '#00e5ff' },
      { value: fmt(APARAT_COURSES.length), label: t('learn.stats.lessons'), a: '#ff2d95', b: '#7c4dff' }
    ],
    [fmt, faqCount, t]
  );

  return <LearnHub tabs={tabs} stats={stats} />;
}
