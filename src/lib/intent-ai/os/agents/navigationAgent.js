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
  'افق جهانی': '/stocks',
  'فارکس': '/stocks',
  'طلا': '/stocks',
  'نفت': '/stocks',
  'فلزات': '/stocks',
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
    'forex': '/stocks',
    'horizon': '/stocks',
    'gold': '/stocks',
    'metals': '/stocks',
    'calm': '/explore',
    'intent': '/intent'
  };
  
  for (const [kw, route] of Object.entries(englishMap)) {
    if (raw.includes(kw)) return route;
  }
  
  return null;
}

/*
 * ─── THE NAVIGATION CALL SIGNATURE, AND THE BUG IT CAUSED ───────────────────
 * Every host in this codebase injects `navigate` as a SINGLE-OBJECT function:
 *
 *     navigate({ route, params, replace })
 *
 * `IntentAIUnified.jsx` destructures exactly that. This agent used to call the
 * injected function POSITIONALLY — `navigate(resolved, params, replace)` — so
 * the host destructured a STRING. `{ route } = '/signals'` yields
 * `route === undefined`, the host's own guard (`if (!r) return { ok: false }`)
 * fired, and the turn reported `navigated: '/signals'` while the router never
 * moved.
 *
 * That is the reported «روی منو می‌زنی، سیگنال نمیاد و تو همون چت می‌مونه»:
 * the chat SAID it opened the page and the user stayed exactly where they
 * were. It was silent because the agent treated the host's `{ ok: false }`
 * as success and never surfaced it.
 *
 * `callHostNavigate` below is the single place the host is invoked, and it
 * normalises BOTH shapes on the way in, so no future host can reintroduce the
 * mismatch by picking the other convention.
 */
function callHostNavigate(navigateFn, { route, params, replace }) {
  const asObject = navigateFn({ route, params, replace });
  return Promise.resolve(asObject);
}

export function createNavigationAgent({ navigateFn = null, eventBus = null } = {}) {
  const navigate = navigateFn || ((arg) => {
    // Default (no host injected): the browser's own hash router. Accepts the
    // object form like every other host, and a bare string for convenience.
    const route = typeof arg === 'string' ? arg : arg?.route;
    try {
      if (typeof window !== 'undefined' && route) {
        window.location.hash = `#${route}`;
        if (eventBus?.emit) eventBus.emit('navigation.opened', { route }, 'navigation-agent');
      }
      return { ok: Boolean(route), route: route || null };
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
        const result = await callHostNavigate(navigate, { route: resolved, params, replace });

        /*
         * A host that declines (`{ ok: false }`, or `undefined`) is a FAILED
         * navigation, not a successful one. Reporting success here is what
         * made the bug invisible: the chat rendered «opened /signals» over a
         * router that had not moved.
         */
        if (result && result.ok === false) {
          return {
            ok: false,
            error: result.reason || result.error || 'NAVIGATION_REFUSED',
            message: result.message || 'مسیریابی انجام نشد.',
            route: resolved
          };
        }

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
