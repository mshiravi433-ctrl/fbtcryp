/**
 * Runtime regression for chat-first module hand-offs.
 * Exercises the actual Intent OS pipeline, then sends its action URLs through
 * the same route resolver used by the chat's action buttons.
 */
import { createIntentOS } from '../../src/lib/intent-ai/os/index.js';
import { resolveChatRoute } from '../../src/lib/intent-ai/autonomy/chatRoutes.js';

const results = [];
const check = (name, ok, extra = null) => results.push({ name, ok: Boolean(ok), extra });
const actionFor = (result, route) => result?.human?.actions?.find((action) => action.route === route);
const openRoute = (route) => resolveChatRoute(route, { currentPathname: '/intent' });

/* OS observability logs are useful to operators, but noisy in this regression
   probe. Keep normal console output intact even if a process assertion throws. */
const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error
};
const navigationCalls = [];

try {
  console.log = console.info = console.warn = console.error = () => {};
  const os = createIntentOS({
    locale: 'en',
    navigation: {
      navigate: async ({ route }) => {
        navigationCalls.push(route);
        return { ok: true, route };
      }
    }
  });
  const runTurn = async (message, index) => os.process({
    message,
    locale: 'en',
    currentPage: '/intent',
    conversationId: `chat-module-handoff-regression-${Date.now()}-${index}`
  });

  const stock = await runTurn('buy Tesla stock', 1);
  check('a stock-buy request stays in chat unless the user asks to open Stocks',
    stock.ok === true && stock.intent?.type === 'STOCKS' && stock.navigated == null
      && stock.execution?.route == null && !navigationCalls.includes('/stocks')
      && Boolean(actionFor(stock, '/stocks')) && stock.requiresConfirmation === false
      && /submitted nothing|not place or imply a stock order/i.test(stock.human?.message || ''),
    JSON.stringify({ intent: stock.intent?.type, navigated: stock.navigated, actions: stock.human?.actions }));

  const insurance = await runTurn('insurance', 2);
  check('insurance is an optional chat action, not an automatic page jump',
    insurance.ok === true && insurance.intent?.type === 'INSURANCE' && insurance.navigated == null
      && Boolean(actionFor(insurance, '/insurance')) && !navigationCalls.includes('/insurance'),
    JSON.stringify({ intent: insurance.intent?.type, navigated: insurance.navigated, actions: insurance.human?.actions }));

  const bridge = await runTurn('Bridge 50 USDC from Ethereum to Arbitrum', 3);
  const bridgeAction = bridge.human?.actions?.find((action) => action.route?.startsWith('/bridge'));
  const bridgeTarget = bridgeAction ? openRoute(bridgeAction.route) : null;
  check('bridge inspection is a real clickable prefill, with no quote, navigation, or execution',
    bridge.ok === true && bridge.intent?.type === 'BRIDGE' && bridge.navigated == null
      && bridge.execution?.unavailable === 'BRIDGE_EXECUTE_UNAVAILABLE'
      && bridge.execution?.executed === false && bridge.execution?.broadcasts === false
      && bridge.human?.requiresConfirmation === false && !bridge.human?.card
      && bridgeTarget?.kind === 'navigate' && bridgeTarget.to === bridgeAction.route
      && /nothing is executed/i.test(bridge.human?.message || ''),
    JSON.stringify({ route: bridgeAction?.route, execution: bridge.execution, target: bridgeTarget }));

  const lending = await runTurn('deposit 100 USDC on Base', 4);
  const lendingRoute = '/loan?tab=supply&asset=USDC&amount=100&chain=8453';
  const lendingAction = actionFor(lending, lendingRoute);
  const lendingTarget = lendingAction ? openRoute(lendingAction.route) : null;
  check('a lending deposit offers the prefetched loan page, but submits and signs nothing',
    lending.ok === true && lending.intent?.type === 'LEND' && lending.navigated == null
      && lendingTarget?.kind === 'navigate' && lendingTarget.to === lendingRoute
      && lending.requiresConfirmation === false && lending.execution?.executed !== true
      && !lending.human?.card && /nothing has been submitted or signed/i.test(lending.human?.message || ''),
    JSON.stringify({ intent: lending.intent?.type, route: lendingAction?.route, target: lendingTarget }));

  const borrowRoute = '/loan?tab=borrow&asset=USDC&amount=100&chain=8453';
  const borrowing = await runTurn('borrow 100 USDC on Base', 5);
  const borrowAction = actionFor(borrowing, borrowRoute);
  const borrowTarget = borrowAction ? openRoute(borrowAction.route) : null;
  check('a borrow request stays in chat and hands off to the prefilled loan review page',
    borrowing.ok === true && borrowing.intent?.type === 'BORROW' && borrowing.navigated == null
      && borrowTarget?.kind === 'navigate' && borrowTarget.to === borrowRoute
      && borrowing.requiresConfirmation === false && borrowing.execution?.executed !== true
      && !borrowing.human?.card,
    JSON.stringify({ intent: borrowing.intent?.type, route: borrowAction?.route, target: borrowTarget }));

  const farm = await runTurn('deposit 100 USDC in the best farm', 6);
  check('farm remains distinct from lending and offers inspection only',
    farm.ok === true && farm.intent?.type === 'FARM' && farm.navigated == null
      && Boolean(actionFor(farm, '/farm')) && farm.human?.requiresConfirmation === false
      && !farm.human?.card && farm.execution?.executed !== true,
    JSON.stringify({ intent: farm.intent?.type, actions: farm.human?.actions, card: farm.human?.card }));

  const capabilities = await runTurn('what can you do', 7);
  const destinations = ['/swap', '/bridge', '/loan', '/farm', '/stocks', '/insurance'];
  const targets = destinations.map((route) => openRoute(route));
  check('capability actions resolve to real destinations from the chat action row',
    capabilities.ok === true && capabilities.intent?.type === 'CAPABILITIES'
      && destinations.every((route) => Boolean(actionFor(capabilities, route)))
      && targets.every((target, index) => target.kind === 'navigate' && target.to === destinations[index])
      && capabilities.navigated == null,
    JSON.stringify({ destinations, targets }));

  const beforeExplicitOpen = navigationCalls.length;
  const explicitInsurance = await runTurn('open insurance', 8);
  check('an explicit open request performs exactly the requested safe navigation',
    explicitInsurance.ok === true && explicitInsurance.intent?.type === 'INSURANCE'
      && explicitInsurance.navigated === '/insurance'
      && navigationCalls.length === beforeExplicitOpen + 1
      && navigationCalls.at(-1) === '/insurance',
    JSON.stringify({ navigated: explicitInsurance.navigated, navigationCalls }));
} catch (error) {
  check('the Intent OS runtime probe completed without throwing', false, error?.stack || String(error));
} finally {
  Object.assign(console, originalConsole);
}

const passed = results.filter((row) => row.ok).length;
console.log(`\nchat-capability-handoff runtime probe: ${passed}/${results.length} passed`);
if (passed !== results.length) {
  console.error(results.filter((row) => !row.ok)
    .map((row) => `  ✗ ${row.name}${row.extra ? ` [${row.extra}]` : ''}`).join('\n'));
  process.exit(1);
}
console.log('OK: intent-ai/chat-capability-handoff-runtime-probe');

export default results;
