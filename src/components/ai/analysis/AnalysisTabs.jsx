/**
 * Shared navigation for the full intelligence page and its chat rooms.
 *
 * The visual accent belongs to the room, not to an arbitrary button index:
 * overview is cyan, screener violet, token blue, portfolio mint, opportunities
 * amber, compare magenta and report slate. The same map therefore produces
 * the same landmark wherever the room is opened.
 */
import { useEffect, useId, useRef } from 'react';
import {
  IconChart,
  IconDoc,
  IconMarket,
  IconRocket,
  IconSearch,
  IconSwap,
  IconWallet
} from '../../Icons';
import { t } from '../../../lib/intelligence/copy';

const TAB_ICONS = {
  overview: IconMarket,
  screener: IconSearch,
  token: IconChart,
  portfolio: IconWallet,
  opportunities: IconRocket,
  compare: IconSwap,
  report: IconDoc
};

export default function AnalysisTabs({
  tabs,
  active,
  onChange,
  locale,
  label,
  id,
  panelId,
  className = ''
}) {
  const navRef = useRef(null);
  const generatedId = useId();
  const navId = id || `aix-tabs-${generatedId}`;
  const contentId = panelId || `${navId}-panel`;

  /* Opening a token from a mover can select a tab that is currently outside
     the mobile rail. Move only the rail horizontally (never the document),
     using physical pixel deltas so the same code works in RTL and LTR. */
  useEffect(() => {
    const nav = navRef.current;
    const current = nav?.querySelector('.aix-tab.is-active');
    if (!nav || !current || nav.scrollWidth <= nav.clientWidth) return;
    const navBox = nav.getBoundingClientRect();
    const tabBox = current.getBoundingClientRect();
    const delta = tabBox.left - navBox.left - (navBox.width - tabBox.width) / 2;
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    nav.scrollBy?.({ left: delta, behavior: reduced ? 'auto' : 'smooth' });
  }, [active, locale]);

  const move = (event, index) => {
    const rtl = event.currentTarget.closest('[dir]')?.getAttribute('dir') === 'rtl';
    let next = null;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (event.key === 'ArrowRight') next = (index + (rtl ? -1 : 1) + tabs.length) % tabs.length;
    if (event.key === 'ArrowLeft') next = (index + (rtl ? 1 : -1) + tabs.length) % tabs.length;
    if (next == null) return;
    event.preventDefault();
    onChange(tabs[next].id);
    const buttons = event.currentTarget.parentElement?.querySelectorAll('.aix-tab');
    buttons?.[next]?.focus();
  };

  return (
    <nav
      ref={navRef}
      id={navId}
      className={`aix-tabs ${className}`.trim()}
      role="tablist"
      aria-label={label || t(locale, 'page.title')}
      aria-orientation="horizontal"
    >
      {tabs.map((item, index) => {
        const Icon = TAB_ICONS[item.id] || IconMarket;
        const selected = active === item.id;
        return (
          <button
            key={item.id}
            id={`${navId}-${item.id}`}
            type="button"
            role="tab"
            className={`aix-tab aix-tab-${item.id}${selected ? ' is-active' : ''}`}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => move(event, index)}
            aria-selected={selected}
            aria-controls={contentId}
            tabIndex={selected ? 0 : -1}
          >
            <span className="aix-tab-icon" aria-hidden="true">
              <Icon width={18} height={18} />
            </span>
            <span className="aix-tab-label">{t(locale, item.key)}</span>
            <span className="aix-tab-active-dot" aria-hidden="true" />
          </button>
        );
      })}
    </nav>
  );
}
