import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { isRtl } from '../i18n/languages';
import { SPECULATION_ENABLED } from '../lib/features';
import {
  IconActivity, IconBriefcase, IconBuilding, IconClock, IconDoc, IconGlobe,
  IconInfo, IconKey, IconMail, IconMarket, IconNews, IconPools, IconRocket,
  IconSearch, IconSettings, IconShield, IconSmartMoney, IconSwap, IconTrend,
  IconTrophy, IconWallet, IconWorld, IconX
} from './Icons';
import '../styles/quick-access.css';

// The first destination in each family is its home. On a related page it
// replaces that page in the rail, so there is always a way back to the hub.
const SWAP_LINK = { to: '/swap', key: 'nav.swap', Icon: IconSwap };
const MARKET_LINKS = [
  { to: '/', key: 'nav.market', Icon: IconMarket },
  ...(SPECULATION_ENABLED ? [{ to: '/perp', key: 'nav.perp', Icon: IconTrend, aliases: ['/dydx', '/ostium', '/derivatives'] }] : []),
  { to: '/stocks', key: 'nav.stocks', Icon: IconBuilding },
  ...(SPECULATION_ENABLED ? [{ to: '/lab', key: 'lab.title', Icon: IconActivity }] : []),
  { to: '/shop', key: 'nav.shop', Icon: IconBriefcase },
  { to: '/buy', key: 'nav.buy', Icon: IconSwap }
];
const SWAP_LINKS = [
  SWAP_LINK,
  { to: '/bridge', key: 'nav.bridge', Icon: IconGlobe },
  { to: '/launch', key: 'nav.launch', Icon: IconRocket },
  { to: '/p2p', key: 'nav.p2p', Icon: IconSwap }
];
const groups = [
  MARKET_LINKS,
  SWAP_LINKS,
  [
    { to: '/wallet', key: 'nav.wallet', Icon: IconWallet },
    { to: '/farm', key: 'nav.farm', Icon: IconPools },
    { to: '/loan', key: 'nav.loan', Icon: IconWallet },
    { to: '/insurance', key: 'nav.protection', Icon: IconShield },
    { to: '/orders', key: 'nav.orders', Icon: IconClock },
    { to: '/rewards', key: 'rewards.title', Icon: IconTrophy }
  ],
  [
    { to: '/signals', key: 'nav.signals', Icon: IconActivity },
    /* No «هوش بازار» tile: those rooms are rendered inside the AI's answers
       now (see ChatIntelRooms.jsx). The route stays for old deep links, but
       the quick rail does not advertise a second place to read the same
       numbers. */
    { to: '/smart-money', key: 'sm.title', Icon: IconSmartMoney },
    { to: '/news', key: 'nav.news', Icon: IconNews },
    { to: '/global', key: 'nav.global', Icon: IconWorld },
    { to: '/learn', key: 'learn.title', Icon: IconDoc },
    { to: '/explore-hub', key: 'exploreHub.title', Icon: IconSearch },
    { to: '/security', key: 'nav.audit', Icon: IconShield, aliases: ['/audit'] }
  ],
  [
    { to: '/settings', key: 'nav.settings', Icon: IconSettings },
    { to: '/contact', key: 'contact.title', Icon: IconMail },
    { to: '/about', key: 'nav.about', Icon: IconInfo },
    { to: '/ecosystem', key: 'nav.ecosystem', Icon: IconGlobe },
    { to: '/developers', key: 'nav.developers', Icon: IconKey },
    { to: '/business', key: 'nav.business', Icon: IconBuilding }
  ]
];

// Desk launchers share the Market and Swap destinations even when opened
// from a route in the second group (Bridge, Launch, or P2P).
const marketDeskLinks = [SWAP_LINK, ...MARKET_LINKS, ...SWAP_LINKS.filter((item) => item !== SWAP_LINK)];

function matches(item, pathname) {
  return [item.to, ...(item.aliases || [])].some((path) =>
    pathname === path || (path !== '/' && pathname.startsWith(`${path}/`))
  );
}

export default function QuickAccess({ centered = false }) {
  const { pathname } = useLocation();
  const { t, i18n } = useTranslation();
  const rtl = isRtl(String(i18n.resolvedLanguage || i18n.language || 'fa').split('-')[0]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const toggleRef = useRef(null);
  const group = groups.find((items) => items.some((item) => matches(item, pathname)));

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (open && centered) rootRef.current?.querySelector('nav a')?.focus({ preventScroll: true });
  }, [open, centered]);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  if ((!centered && !group) || typeof document === 'undefined') return null;
  const links = centered ? marketDeskLinks : group;
  return createPortal(
    <aside ref={rootRef} className={`quick-access${centered ? ' quick-access--centered' : ''}${open ? ' is-open' : ''}`} dir={rtl ? 'rtl' : 'ltr'} aria-label={t('quickAccess.title')}>
      <div id="quick-access-rail" className="quick-access__rail" aria-hidden={!open} inert={!open ? '' : undefined}>
        <div className="quick-access__rail-head">
          <span className="quick-access__caption">{t('quickAccess.title')}</span>
          {centered && <button type="button" className="quick-access__close" tabIndex={open ? 0 : -1}
            aria-label={t('quickAccess.close')} onClick={() => { setOpen(false); toggleRef.current?.focus(); }}>
            <IconX width={18} height={18} />
          </button>}
        </div>
        <nav aria-label={t('quickAccess.title')}>
          {links.filter((item) => !matches(item, pathname)).map(({ to, key, Icon }) => (
            <Link key={to} className="quick-access__item" to={to} tabIndex={open ? undefined : -1} onClick={() => setOpen(false)}>
              <span className="quick-access__icon"><Icon width={19} height={19} aria-hidden="true" /></span>
              <span>{t(key)}</span>
            </Link>
          ))}
        </nav>
      </div>
      <button ref={toggleRef} type="button" className="quick-access__toggle" aria-label={t(open ? 'quickAccess.close' : 'quickAccess.open')} aria-expanded={open} aria-controls="quick-access-rail" onClick={() => setOpen((value) => !value)}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3.5" y="3.5" width="7" height="7" rx="2" /><rect x="13.5" y="3.5" width="7" height="7" rx="2" /><rect x="3.5" y="13.5" width="7" height="7" rx="2" /><path d="M17 14v6m-3-3h6" />
        </svg>
      </button>
    </aside>, document.body
  );
}
