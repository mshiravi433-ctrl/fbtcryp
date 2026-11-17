/**
 * CHAT-FIRST MODULE HAND-OFFS — local intent, route, and safety regression probe.
 * ---------------------------------------------------------------------------
 * Keep the assistant useful in chat while making every real destination one
 * deliberate tap away. The router may prefill supported form fields; it must
 * not turn a route into a quote, an order, or a signature.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { understandIntent } from '../../src/lib/intent-ai/os/intentUnderstanding.js';
import { resolveIntent } from '../../src/lib/intent-ai/os/routeAdapter.js';
import { wantsPageOpen } from '../../src/lib/intent-ai/os/moduleRouter.js';
import { buildHumanResponse } from '../../src/lib/intent-ai/os/humanResponse.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const results = [];
const check = (name, ok, extra = null) => results.push({ name, ok: Boolean(ok), extra });
const parse = (text) => understandIntent(text);
const route = (intent, text, openPage = wantsPageOpen(text)) => resolveIntent(intent, text, { openPage });

/* ── Swap: a network name is not an output token ───────────────────────── */
{
  const text = 'Swap 0.5 ETH to USDC on Arbitrum';
  const intent = parse(text);
  const resolved = route(intent, text, true);
  check('the Arbitrum chain does not overwrite USDC as the swap destination',
    intent.type === 'SWAP' && intent.entities.fromToken === 'ETH' && intent.entities.toToken === 'USDC'
      && resolved.route === '/swap?from=ETH&to=USDC&amount=0.5&chain=42161',
    JSON.stringify({ intent: intent.type, entities: intent.entities, route: resolved.route }));
}

/* ── Persian amounts and chain names ───────────────────────────────────── */
{
  const digitText = 'سواپ ۰.۵ اتریوم به تتر روی آربیتروم';
  const digitIntent = parse(digitText);
  const digitRoute = route(digitIntent, digitText, true);
  check('Persian decimal digits stay attached to the token amount and Arbitrum is the selected chain',
    digitIntent.entities.amount === '0.5' && digitIntent.entities.toToken === 'USDT'
      && digitIntent.entities.chainIds?.length === 1 && digitIntent.entities.network === 42161
      && digitRoute.route === '/swap?from=ETH&to=USDT&amount=0.5&chain=42161',
    JSON.stringify({ entities: digitIntent.entities, route: digitRoute.route }));

  const wordText = 'سواپ دو اتریوم به تتر روی آربیتروم';
  const wordIntent = parse(wordText);
  const wordRoute = route(wordIntent, wordText, true);
  check('a Persian number word becomes an exact route amount',
    wordIntent.entities.amount === '2' && wordRoute.route === '/swap?from=ETH&to=USDT&amount=2&chain=42161',
    JSON.stringify({ entities: wordIntent.entities, route: wordRoute.route }));

  const preciseText = 'Swap 0.00000000000000012345 ETH to USDC';
  const preciseIntent = parse(preciseText);
  const preciseRoute = route(preciseIntent, preciseText, true);
  check('high-precision token amounts are not rounded through JavaScript Number',
    preciseIntent.entities.amount === '0.00000000000000012345'
      && preciseRoute.route === '/swap?from=ETH&to=USDC&amount=0.00000000000000012345',
    JSON.stringify({ amount: preciseIntent.entities.amount, route: preciseRoute.route }));
}

/* ── Bridge: correct asset, explicit inspection link, no execution ──────── */
{
  const text = 'Bridge 50 USDC from Ethereum to Arbitrum';
  const intent = parse(text);
  const resolved = route(intent, text, false);
  const answer = buildHumanResponse({
    intent,
    results: { inspectionRoute: resolved.route },
    locale: 'en'
  });
  check('bridge parsing keeps USDC and the requested source/destination chains',
    intent.type === 'BRIDGE' && intent.entities.token === 'USDC'
      && intent.entities.fromChain === 1 && intent.entities.toChain === 42161
      && intent.entities.amount === '50' && intent.entities.amountUsd == null
      && resolved.route === '/bridge?token=USDC&amount=50&fromChain=1&toChain=42161',
    JSON.stringify({ entities: intent.entities, route: resolved.route }));
  check('an unwired bridge offers a prefilled inspection hand-off, never a quote or transaction',
    answer.code === 'BRIDGE_EXECUTE_UNAVAILABLE' && answer.requiresConfirmation === false
      && answer.actions?.[0]?.route === resolved.route && !answer.navigated
      && answer.executed !== true && !answer.card
      && /nothing is executed/i.test(answer.message),
    JSON.stringify(answer));
}

/* ── Farm and Lending: separate intent, inspection, and review surfaces ── */
{
  const farmText = 'deposit 100 USDC in the best farm';
  const farmIntent = parse(farmText);
  const farmRoute = route(farmIntent, farmText, false);
  const farmAnswer = buildHumanResponse({ intent: farmIntent, locale: 'en' });
  check('a best-farm deposit stays a FARM request and only offers farm inspection',
    farmIntent.type === 'FARM' && farmRoute.route === '/farm'
      && farmAnswer.actions?.some((action) => action.route === '/farm')
      && farmAnswer.requiresConfirmation === false && !farmAnswer.card,
    JSON.stringify({ type: farmIntent.type, actions: farmAnswer.actions, code: farmAnswer.code }));

  const loanText = 'deposit 100 USDC on Base';
  const loanIntent = parse(loanText);
  const loanRoute = route(loanIntent, loanText, false);
  const loanAnswer = buildHumanResponse({ intent: loanIntent, handoffRoute: loanRoute.route, locale: 'en' });
  check('a plain token deposit maps to Lending and exposes a separate loan-page hand-off',
    loanIntent.type === 'LEND' && loanRoute.route === '/loan?tab=supply&asset=USDC&amount=100&chain=8453'
      && loanAnswer.actions?.some((action) => action.route === loanRoute.route)
      && loanAnswer.requiresConfirmation !== true,
    JSON.stringify({ type: loanIntent.type, route: loanRoute.route, actions: loanAnswer.actions }));
}

/* ── Stocks and insurance are reachable, but not executed in chat ──────── */
{
  for (const text of ['buy Tesla stock', 'Should I buy Tesla stock?']) {
    const intent = parse(text);
    const answer = buildHumanResponse({ intent, locale: 'en' });
    check(`“${text}” offers the Stocks page without placing an order`,
      intent.type === 'STOCKS' && answer.actions?.some((action) => action.route === '/stocks')
        && answer.requiresConfirmation === false && !answer.card && /not place|submitted nothing/i.test(answer.message),
      JSON.stringify({ type: intent.type, actions: answer.actions, message: answer.message }));
  }

  const insuranceText = 'open insurance';
  const insuranceIntent = parse(insuranceText);
  const insuranceRoute = route(insuranceIntent, insuranceText, true);
  const insuranceAnswer = buildHumanResponse({ intent: insuranceIntent, locale: 'en' });
  check('insurance is recognized and an explicit open request resolves to its mounted page',
    insuranceIntent.type === 'INSURANCE' && insuranceRoute.route === '/insurance' && insuranceRoute.openPage === true,
    JSON.stringify({ type: insuranceIntent.type, route: insuranceRoute.route, openPage: insuranceRoute.openPage }));
  check('insurance chat hand-off creates no quote, policy, purchase, or transaction',
    insuranceAnswer.actions?.some((action) => action.route === '/insurance')
      && insuranceAnswer.requiresConfirmation === false && !insuranceAnswer.card
      && /created no quote, policy or transaction/i.test(insuranceAnswer.message),
    JSON.stringify(insuranceAnswer));
}

/* ── “What can you do?” exposes the six safe module destinations ───────── */
{
  const intent = parse('what can you do');
  const answer = buildHumanResponse({ intent, locale: 'en' });
  const offered = new Set((answer.actions || []).map((action) => action.route));
  const destinations = ['/swap', '/bridge', '/loan', '/farm', '/stocks', '/insurance'];
  check('the capability answer offers Swap, Bridge, Lending, Farm, Stocks, and Insurance',
    intent.type === 'CAPABILITIES' && destinations.every((destination) => offered.has(destination)),
    JSON.stringify([...offered]));
  check('capability copy does not claim that the chat executes a bridge or buys cover',
    /bridge is an inspection hand-off/i.test(answer.message) && /no chat order or policy purchase/i.test(answer.message),
    answer.message);
}

/* Keep the bridge execution gate coupled to the user-facing inspection path. */
{
  const os = readFileSync(resolve(root, 'src/lib/intent-ai/os/index.js'), 'utf8');
  check('BRIDGE execution remains blocked unless the user explicitly asks to open its page',
    /workingIntent\.type === 'BRIDGE'\s*&&\s*!wantsPageOpen\(workingIntent\.raw\)/.test(os)
      && /inspectionRoute:\s*handoffRoute\s*\|\|\s*'\/bridge'/.test(os));
  check('Stocks and borrowing requests do not auto-open their venue without an explicit page request',
    /if \(\['STOCKS', 'BORROW'\]\.includes\(workingIntent\.type\) && !openPage\)[\s\S]{0,240}agentId !== 'navigation-agent'/.test(os));

  const chatUi = readFileSync(resolve(root, 'src/components/IntentAIUnified.jsx'), 'utf8');
  check('a lending review still selects its single reviewed action when route chips are also present',
    chatUi.includes('const lendingReviewActions = Array.isArray(osResult.human?.actions)')
      && chatUi.includes('&& lendingReviewActions.length === 1'));
  check('the live lending review bubble keeps only the optional page routes as route chips',
    chatUi.includes('actions: Array.isArray(reviewHuman.actions)')
      && chatUi.includes("reviewHuman.actions.filter((action) => typeof action?.route === 'string' && action.route.trim())"));
}

const passed = results.filter((row) => row.ok).length;
console.log(`\nchat-capability-handoff probe: ${passed}/${results.length} passed`);
if (passed !== results.length) {
  console.error(results.filter((row) => !row.ok)
    .map((row) => `  ✗ ${row.name}${row.extra ? ` [${row.extra}]` : ''}`).join('\n'));
  process.exit(1);
}
console.log('OK: intent-ai/chat-capability-handoff-probe');

export default results;
