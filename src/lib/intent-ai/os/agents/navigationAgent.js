/**
 * FBT INTENT OS — Navigation Agent
 * ---------------------------------------------------------------------------
 * Spec §8 + §27
 * Can navigate user to different pages, no confirmation needed for nav
 */

import { APP_CAPABILITIES } from '../appCapabilities.js';
import { routeForIntent } from '../moduleRouter.js';

export const NAV_AGENT_SCHEMA = 'fbt.nav-agent.v1';

const ROUTE_MAP = new Map(APP_CAPABILITIES.map(c => [c.id, c.route]));
// Persian route aliases
const PERSIAN_ROUTE_ALIASES = Object.freeze({
  'اخبار': '/news',
  'فارم': '/farm',
  'کیف پول': '/wallet',
  'کیف': '/wallet',
  'پرتفوی': '/portfolio',
  'سبد': '/portfolio',
  'بازار': '/market',
  'سواپ': '/swap',
  'بریج': '/bridge',
  'پل': '/bridge',
  'سیگنال': '/signals',
  'هوشمند': '/smart-money',
  'اسمارت': '/smart-money',
  'وام': '/loan',
  'سود': '/earn',
  'کاوش': '/explore',
  'ان اف تی': '/nft',
  'فروشگاه': '/shop',
  'تنظیمات': '/settings',
  'سفارش': '/orders',
  'فیوچرز': '/perp',
  'پرپچوال': '/perp',
  'سهام': '/stocks',
  'افق جهانی': '/invest',
  'فارکس': '/invest',
  'امتیاز': '/rewards',
  'آرامش': '/explore',
  'اینتنت': '/intent',
  'پی تو پی': '/p2p'
});

export function resolveRoute(input) {
  const raw = String(input || '').trim().toLowerCase();
  
  // Direct route
  if (raw.startsWith('/')) return raw;
  
  // Check Persian aliases
  for (const [key, route] of Object.entries(PERSIAN_ROUTE_ALIASES)) {
    if (raw.includes(key.toLowerCase())) return route;
  }
  
  // Check capability id
  if (ROUTE_MAP.has(raw)) return ROUTE_MAP.get(raw);
  
  // English keywords
  const englishMap = {
    'news': '/news',
    'farm': '/farm',
    'wallet': '/wallet',
    'portfolio': '/portfolio',
    'market': '/market',
    'swap': '/swap',
    'bridge': '/bridge',
    'signals': '/signals',
    'smart-money': '/smart-money',
    'smart money': '/smart-money',
    'loan': '/loan',
    'lending': '/loan',
    'earn': '/earn',
    'explore': '/explore',
    'nft': '/nft',
    'shop': '/shop',
    'settings': '/settings',
    'orders': '/orders',
    'perp': '/perp',
    'futures': '/perp',
    'stocks': '/stocks',
    'calm': '/explore',
    'intent': '/intent'
  };
  
  for (const [kw, route] of Object.entries(englishMap)) {
    if (raw.includes(kw)) return route;
  }
  
  return null;
}

export function createNavigationAgent({ navigateFn = null, eventBus = null } = {}) {
  const navigate = navigateFn || ((route) => {
    try {
      if (typeof window !== 'undefined') {
        window.location.hash = `#${route}`;
        if (eventBus?.emit) eventBus.emit('navigation.opened', { route }, 'navigation-agent');
      }
      return { ok: true, route };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  return {
    id: 'navigation-agent',
    schema: NAV_AGENT_SCHEMA,
    
    async navigate({ route, params = {}, replace = false } = {}) {
      const resolved = resolveRoute(route) || route;
      if (!resolved) {
        return { ok: false, error: 'ROUTE_NOT_FOUND', message: 'این قابلیت در حال حاضر در دسترس نیست.' };
      }
      
      // Navigation doesn't need confirmation (Spec §26)
      try {
        const result = await navigate(resolved, params, replace);
        
        if (eventBus?.emit) {
          eventBus.emit('navigation.opened', { route: resolved, params }, 'navigation-agent');
        }
        
        return { ok: true, route: resolved, params, result };
      } catch (err) {
        return { ok: false, error: 'NAVIGATION_FAILED', message: err.message };
      }
    },
    
    async handleIntent(intent, context = {}) {
      const routed = routeForIntent(intent, { openPage: true });
      if (routed) return this.navigate({ route: routed });
      if (intent?.navigation?.route) return this.navigate({ route: intent.navigation.route });
      if (intent?.entities?.targetPage) return this.navigate({ route: intent.entities.targetPage });
      const route = resolveRoute(intent?.raw || intent?.message || intent?.content || '');
      if (route) return this.navigate({ route });
      return { ok: false, error: 'NO_NAVIGATION_INTENT' };
    },
    
    listRoutes() {
      return APP_CAPABILITIES.map(c => ({ id: c.id, route: c.route, name: c.name }));
    }
  };
}

export const navigationAgent = createNavigationAgent();
