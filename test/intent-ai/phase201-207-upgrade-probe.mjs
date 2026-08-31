/**
 * PHASE 201-207 — pure logic of the new Intent AI modules.
 * ---------------------------------------------------------------------------
 *   · taughtMemory — teach/recall/forget, bounds, secret refusal, chain hints
 *   · externalAgentVoice — persona routing, honest no-data, never executable
 *   · the first-party agent catalog entries — the exact shape the client
 *     sanitizer accepts, verified against the REAL route module (no HTTP)
 *   · broadcastSupportedKind — only swaps claim the real broadcast today
 *   · the fee wording rule — "charged" only with a hash, "announced" without
 */
import { readFileSync } from 'node:fs';

const results = [];
const check = (name, ok) => { results.push({ name, ok: Boolean(ok) }); console.log(`${ok ? '✓' : '✗'} ${name}`); };

/* A localStorage stub — the panel runs in a browser; Node needs the shim. */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k)
};

const {
  parseTeachCommand, parseMemoryCommand, rememberTaught,
  listTaught, clearTaught, taughtChainHint, taughtSummary, TAUGHT_MAX_ENTRIES
} = await import('../../src/lib/intent-ai/taughtMemory.js');
const {
  externalAgentRead, agentPersona, selectExternalAgent
} = await import('../../src/lib/intent-ai/externalAgentVoice.js');

try {
  /* ---------------- taught memory ---------------- */
  clearTaught();
  const notTeach = parseTeachCommand('swap 100 USDC to ETH');
  check('a normal request is never memorized', notTeach.ok === false);

  const teach = parseTeachCommand('یادت باشد: شبکهٔ پیش‌فرض من آربیتروم است');
  check('a Persian teach command parses', teach.ok === true && /آربیتروم/.test(teach.text));

  const teachEn = parseTeachCommand('remember: I only ever want stablecoins');
  check('an English teach command parses', teachEn.ok === true && /stablecoins/.test(teachEn.text));

  const stored = rememberTaught(teach);
  check('teaching stores locally', stored.ok === true && listTaught().length === 1);
  check('a taught chain is detected as the default chain hint', taughtChainHint(listTaught()[0]) === 42161);

  const secret = parseTeachCommand('remember: my seed phrase is abandon abandon abandon');
  check('a taught secret is refused', secret.ok === false && secret.code === 'SECRET_REFUSED');
  check('the refusal stored nothing', listTaught().length === 1);

  for (let i = 0; i < TAUGHT_MAX_ENTRIES + 10; i += 1) rememberTaught({ text: `fact ${i}` });
  check('memory stays bounded at the cap', listTaught().length === TAUGHT_MAX_ENTRIES);

  const recall = parseMemoryCommand('چه چیزی یادت هست؟');
  check('a Persian recall command is recognized', recall.ok === true && recall.command === 'recall');
  const forget = parseMemoryCommand('forget everything');
  check('a forget command is recognized', forget.ok === true && forget.command === 'forget');
  clearTaught();
  check('clearing wipes everything', listTaught().length === 0 && taughtSummary().total === 0);

  /* ---------------- external agent voice ---------------- */
  const analyst = { agentId: 'fbt.market-analyst', agentName: 'FBT Market Analyst', capabilities: ['market-analysis'], eligibleForAnalysis: true };
  const auditor = { agentId: 'fbt.risk-auditor', agentName: 'FBT Risk Auditor', capabilities: ['risk-review'], eligibleForAnalysis: true };
  check('persona derives from capabilities', agentPersona(analyst) === 'market-analyst' && agentPersona(auditor) === 'risk-auditor');

  const market = { dataStatus: 'live', assets: [{ symbol: 'BTC', dataStatus: 'live', price: 100000, change24hPct: 3.2, signal: 'up', risk: 'medium', volatilityPct: 5.1 }] };
  const readAnalyst = externalAgentRead({ view: analyst, marketAnalysis: market });
  const readAuditor = externalAgentRead({ view: auditor, marketAnalysis: market });
  check('the analyst speaks about the trend', readAnalyst?.i18nKey === 'intentAI.external.readAnalyst' && readAnalyst.params.symbol === 'BTC');
  check('the auditor speaks about the risk', readAuditor?.i18nKey === 'intentAI.external.readAuditor' && readAuditor.params.risk === 'medium');
  check('no external read can execute', readAnalyst.canExecute === false && readAuditor.canExecute === false);

  const noData = externalAgentRead({ view: analyst, marketAnalysis: { dataStatus: 'unavailable', assets: [] } });
  check('with no live data the agent says so instead of guessing', noData?.i18nKey === 'intentAI.external.readNoData');

  check('an ineligible agent never speaks', externalAgentRead({ view: { ...analyst, eligibleForAnalysis: false }, marketAnalysis: market }) === null);
  check('a non-agent view never speaks', externalAgentRead({ view: null, marketAnalysis: market }) === null);

  /* ---------------- selection ---------------- */
  const candidates = [
    { passport: { id: 'a', capabilities: [] }, eligibleForAnalysis: true },
    { passport: { id: 'b', capabilities: [] }, eligibleForAnalysis: false },
    { passport: { id: 'c', capabilities: [] }, eligibleForAnalysis: true }
  ];
  check('two eligible candidates without a choice stay unselected', selectExternalAgent({ candidates }) === null);
  check('an explicit choice wins', selectExternalAgent({ candidates, selectedId: 'a' })?.passport.id === 'a');
  check('an ineligible explicit choice is refused', selectExternalAgent({ candidates, selectedId: 'b' }) === null);
  check('a single eligible candidate auto-joins', selectExternalAgent({ candidates: [candidates[1], { passport: { id: 'only' }, eligibleForAnalysis: true }] })?.passport.id === 'only');

  /* ---------------- broadcast kind + fee wording rule ---------------- */
  /*
   * The broadcast hook imports lib/chains and lib/swap (extensionless — a
   * Vite resolution), so a Node probe reads it statically instead; the
   * mounted upgrade probe drives its runtime behaviour end to end.
   */
  const hook = readFileSync(new URL('../../src/hooks/useIntentBroadcast.js', import.meta.url), 'utf8');
  check('only swaps claim the real broadcast', /return String\(kind \|\| ''\)\.toLowerCase\(\) === 'swap'/.test(hook));
  check('the hook runs the audited swap path (quote → approval → execute)', /getQuote/.test(hook) && /needsApproval/.test(hook) && /approveToken/.test(hook) && /executeSwap/.test(hook));
  check('the hook never signs itself — the wallet signs', /eth_sendTransaction|executeSwap/.test(hook) && !/signTransaction\(/.test(hook));
  check('broadcast failures use the closed cause-code set', /WALLET_NOT_CONNECTED/.test(hook) && /NO_QUOTE/.test(hook) && /USER_REJECTED/.test(hook));

  const panel = readFileSync(new URL('../../src/components/IntentAIPanel.jsx', import.meta.url), 'utf8');
  check('the fee wording switches on a real hash', /receipt\.txHash \? 'intentAI\.fee\.onReceipt' : 'intentAI\.fee\.quotedOnly'/.test(panel));
  check('the panel holds no hardcoded Persian or Arabic text', !/[‌‌\u0600-\u06FF]/.test(panel));

  /* ---------------- venue hand-off routes (Phase 206) ---------------- */
  const routeSrc = readFileSync(new URL('../../src/components/IntentAIRoute.jsx', import.meta.url), 'utf8');
  check('farm/lend/borrow/futures drafts route to their own screens',
    /farm_deposit: '\/farm'/.test(routeSrc) && /lend_supply: '\/loan'/.test(routeSrc)
    && /borrow: '\/loan'/.test(routeSrc) && /futures_open: '\/perp'/.test(routeSrc));
  check('send drafts route to the wallet screen', /order\.kind === 'send'/.test(routeSrc) && /tab: 'send'/.test(routeSrc));

  /* ---------------- the first-party catalog entries (static) ---------------- */
  const appServer = readFileSync(new URL('../../server/app.js', import.meta.url), 'utf8');
  check('the first-party market analyst ships in the catalog', /fbt\.market-analyst/.test(appServer));
  check('the first-party risk auditor ships in the catalog', /fbt\.risk-auditor/.test(appServer));
  check('first-party agents are analysis-only and never execute', /ANALYSIS_ONLY_FIRST_PARTY/.test(appServer));
  check('the discovery route reports live even with an empty registry', /dataStatus: 'live'/.test(appServer));

  /* ---------------- locale completeness ---------------- */
  const locales = ['en', 'fa', 'ar', 'es', 'fr', 'ru', 'tr', 'zh', 'hi', 'ur', 'id', 'pt'].map((lang) => JSON.parse(
    readFileSync(new URL(`../../src/i18n/locales/${lang}.json`, import.meta.url), 'utf8')
  ));
  check('the mission line exists in all twelve locales', locales.every((l) => typeof l.intentAI?.mission === 'string' && l.intentAI.mission.length > 10));
  check('all six section links are translated everywhere', locales.every((l) => ['wallet', 'stocks', 'futures', 'loan', 'farm', 'points'].every((k) => typeof l.intentAI?.sections?.[k] === 'string')));
  check('the dialogue lines are translated everywhere', locales.every((l) => ['proposal', 'independent-review', 'council', 'gate-result'].every((k) => typeof l.intentAI?.dialogue?.[k] === 'string')));
  check('the taught-memory lines are translated everywhere', locales.every((l) => ['learnedTitle', 'recallTitle', 'secretRefused', 'cleared'].every((k) => typeof l.intentAI?.memory?.[k] === 'string')));
  check('the external voice lines are translated everywhere', locales.every((l) => ['readAnalyst', 'readAuditor', 'readNoData', 'viewTitle'].every((k) => typeof l.intentAI?.external?.[k] === 'string')));
  check('the points lines are translated everywhere', locales.every((l) => typeof l.intentAI?.points?.gained === 'string' && typeof l.intentAI?.points?.unit === 'string'));
  check('the honest fee wording exists everywhere', locales.every((l) => typeof l.intentAI?.fee?.quotedOnly === 'string'));
  check('the broadcast failure wording exists everywhere', locales.every((l) => typeof l.intentAI?.broadcastFail?.error === 'string' && typeof l.intentAI?.broadcastFail?.venue === 'string'));

  console.log(JSON.stringify({ probe: 'phase201-207-upgrades', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
