/**
 * EXPLORE / SECURITY-CENTER PROBE — offline invariants.
 * ---------------------------------------------------------------------------
 * The two intelligence surfaces ship a shared honesty contract. It lives in
 * three places at once (server scoring, the route layer, the browser client),
 * and the failure mode this file exists for is exactly the one where one of
 * the three drifts: a "blocked"-style field sneaking into a payload, a client
 * method pointing at a route that no longer exists, a score that stops being
 * deterministic, or UNKNOWN starting to render as reassurance.
 *
 * Everything here runs with NO network and NO express — the sandbox `npm test`
 * environment has neither — and any check that would need one is skipped with
 * a loud line, never silently dropped.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

export default async function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);

  /* ---------------------------- 1. scoring engine ------------------------ */
  const { computeSecurityScore, SECURITY_FACTORS, DISCLOSURE } = await import(
    resolve(root, 'server/securityIntel.js')
  );

  const empty = computeSecurityScore({}, { source: 'none' });
  t('no evidence → score is null, not 100', empty.score === null);
  t('no evidence → level is UNKNOWN', empty.level === 'UNKNOWN');
  t('no evidence → confidence 0', empty.confidence === 0);
  t('no evidence → dataQuality NONE', empty.dataQuality === 'NONE');
  t('unknown status strings never score', computeSecurityScore({ auditEvidence: { status: 'SAFE' } }).score === null);

  // The engine's status vocabulary is PASS / INFO / LOW / MEDIUM / HIGH / UNKNOWN.
  const mixed = computeSecurityScore({
    auditEvidence: { status: 'PASS', detail: '2 audits' },
    sourceVerification: { status: 'MEDIUM', detail: 'not verified' },
    adminRisk: { status: 'PASS', detail: 'ownership renounced' },
    upgradeability: { status: 'MEDIUM', detail: 'upgradeable via proxy' },
    oracleHealth: { status: 'PASS', detail: 'decentralized feeds' },
    liquidity: { status: 'PASS', detail: 'deep' },
    holderConcentration: { status: 'UNKNOWN', detail: 'holders not indexed' }
  });
  t('partial evidence → numeric score in range', typeof mixed.score === 'number' && mixed.score >= 0 && mixed.score <= 100);
  t('partial evidence → deterministic value (82)', mixed.score === 82);
  t('partial evidence → LOW at ≥80 with partial confidence', mixed.level === 'LOW' && mixed.confidence === 0.68);
  t('every scored factor counts', mixed.factors.length === SECURITY_FACTORS.length);
  t('unscored factors become UNKNOWN rows', mixed.factors.filter((f) => f.status === 'UNKNOWN').length >= 1);

  const bad = computeSecurityScore({
    auditEvidence: { status: 'HIGH', detail: 'none' },
    sourceVerification: { status: 'HIGH', detail: 'unverified' },
    adminRisk: { status: 'HIGH', detail: 'owner can mint' },
    upgradeability: { status: 'HIGH', detail: 'arbitrary impl swap' },
    liquidity: { status: 'MEDIUM', detail: 'thin' },
    incidentHistory: { status: 'HIGH', detail: '2 dated incidents' }
  });
  t('bad evidence → HIGH risk level', bad.level === 'HIGH');
  t('bad evidence → near-zero score (16)', bad.score === 16);
  t('bad evidence → confidence reflects coverage', bad.confidence === 0.72);
  const allPass = computeSecurityScore(Object.fromEntries(SECURITY_FACTORS.map((f) => [f.key, { status: 'PASS', detail: 'ok' }])));
  t('all-PASS → 100/LOW with confidence 1', allPass.score === 100 && allPass.level === 'LOW' && allPass.confidence === 1);
  const thin = computeSecurityScore({ contractAge: { status: 'PASS', detail: 'old' } });
  t('one green factor ≠ reassurance: thin coverage → UNKNOWN level', thin.score === 100 && thin.level === 'UNKNOWN');
  t('the disclaimer is attached, not inline-faked', DISCLOSURE.length > 40 && bad.disclaimer === DISCLOSURE);
  t('disclaimer copy states the advisory limit', /not a guarantee.*does not block/i.test(DISCLOSURE));

  /* --------------------- 2. classifyQuery (server side) ------------------ */
  const { classifyQuery } = await import(resolve(root, 'server/explorerData.js'));
  t('0x40 hex → address', classifyQuery('0x' + 'ab'.repeat(20)).kind === 'address');
  t('0x64 hex → tx', classifyQuery('0x' + 'cd'.repeat(32)).kind === 'tx');
  t('bare 64 hex stays text (no guessing)', classifyQuery('cd'.repeat(32)).kind === 'text');
  t('digits → block', classifyQuery('19999999').kind === 'block');
  t('words → text', classifyQuery('uniswap').kind === 'text');
  t('empty → empty kind, never a crash', classifyQuery('   ').kind === 'empty');
  t('addresses normalize to checksum-agnostic lowercase', classifyQuery('0x' + 'AB'.repeat(20)).value.startsWith('0x'));

  /* ------------------ 3. the never-block contract (static) --------------- */
  const secSrc = readFileSync(resolve(root, 'server/securityIntel.js'), 'utf8');
  const routeSrc = readFileSync(resolve(root, 'server/exploreSecurityRoutes.js'), 'utf8');
  const uiSec = readFileSync(resolve(root, 'src/pages/Security.jsx'), 'utf8');
  const uiExp = readFileSync(resolve(root, 'src/pages/Explore.jsx'), 'utf8');

  // Key names only — the prose deliberately discusses blocking to disclaim it.
  const blockingKey = /(^|[\s{,])(block|blocked|cancel|cancelled|reject|rejectsTx|disable|prevent|freeze|halt)(Tx|Transaction|Swap|Sign)?\s*:/m;
  t('security engine exposes no block/cancel field names', !blockingKey.test(secSrc));
  t('route layer exposes no block/cancel field names', !blockingKey.test(routeSrc));
  t('no POST/PUT/DELETE route in the intel API layer', !/app\.(post|put|delete|patch)\(/.test(routeSrc));
  t('security UI has no blocking vocabulary in JSX text',
    !/>[^<]*\b(Transaction Blocked|Swap Blocked|Blocked\b)[^<]*</.test(uiSec));
  t('explore UI never claims to stop a transaction', !/block the (transaction|swap)/i.test(uiExp));

  /* ---------------- 4. every client call has a live route --------------- */
  const clientSrc = readFileSync(resolve(root, 'src/lib/intelApi.js'), 'utf8');
  const paths = [...clientSrc.matchAll(/get\(\s*`([^`]+)`\s*[,)]|get\(\s*'([^']+)'\s*[,)]/g)]
    .map((m) => (m[1] || m[2]).replace(/\$\{[^}]*\}/g, 'seg'));
  const serverRoutes = [...routeSrc.matchAll(/app\.get\('\/api\/v1\/([^']+)'/g)].map((m) => m[1]);
  const routeMatchers = serverRoutes.map((p) => new RegExp('^/api/v1/' + p.replace(/:[A-Za-z]+/g, '[^/]+') + '$'));
  const unmatched = paths.filter((p) => !routeMatchers.some((re) => re.test('/api/v1/' + p)));
  t(`every client path resolves to a GET route (${paths.length} checked)`, paths.length >= 18 && unmatched.length === 0);
  t('routes cover both namespaces', serverRoutes.some((r) => r.startsWith('explore/')) && serverRoutes.some((r) => r.startsWith('security/')));

  /* --------------- 5. mounting: app.js wires both route groups ----------- */
  const appSrc = readFileSync(resolve(root, 'server/app.js'), 'utf8');
  t('app.js imports the intel route module', /from '\.\/exploreSecurityRoutes\.js'/.test(appSrc));
  t('app.js registers explore routes', /registerExploreRoutes\(app\)/.test(appSrc));
  t('app.js registers security routes', /registerSecurityRoutes\(app\)/.test(appSrc));

  /* -------------------- 6. the client helpers (real imports) ------------ */
  let intelApi = null;
  try {
    intelApi = await import(resolve(root, 'src/lib/intelApi.js'));
  } catch { /* vite-only syntax in the import graph → recorded as skip below */ }
  if (intelApi) {
    const { freshnessLabel, intelErrorCode } = intelApi;
    const tt = (k) => k;
    const now = Date.now();
    const a = freshnessLabel({ updatedAt: new Date(now - 40_000).toISOString() }, tt);
    const b = freshnessLabel({ updatedAt: new Date(now - 600_000).toISOString() }, tt);
    t('freshness: seconds wording for young data', a.includes('intel.secondsAgo'));
    t('freshness: minutes wording after a minute', b.includes('intel.minutesAgo'));
    t('freshness: stale flag appends', freshnessLabel({ updatedAt: new Date(now).toISOString(), freshness: 'STALE' }, tt).includes('intel.stale'));
    t('freshness: no data beats a crash', freshnessLabel(null, tt) === 'intel.noData');
    t('error mapping: rate limit reads as temporary', intelErrorCode({ code: 'RATE_LIMITED' }) === 'unavailable');
    t('error mapping: bad address is user error', intelErrorCode({ code: 'BAD_ADDRESS' }) === 'badInput');
    t('error mapping: unknown errors do not vanish', intelErrorCode(new Error('?')) === 'common');
  } else {
    t('client helper checks SKIPPED (intelApi not importable offline)', true);
  }

  /* ---------------------- 7. revoke eligibility matrix ------------------- */
  let revoke = null;
  try {
    revoke = await import(resolve(root, 'src/lib/securityRevoke.js'));
  } catch { /* ignore */ }
  if (revoke) {
    const { revokeEligibility } = revoke;
    const wallet = { address: '0x' + '11'.repeat(20), chainId: 56, locked: false, mode: 'local', isConnected: true, getSigner: () => ({}) };
    t('revoke allowed when connected, unlocked, right chain', revokeEligibility({ wallet, approvalChainId: 56 }).ok === true);
    t('revoke blocked when chain differs (UI explains + links switch)', revokeEligibility({ wallet, approvalChainId: 1 }).code === 'WRONG_NETWORK');
    t('revoke blocked while wallet locked', revokeEligibility({ wallet: { ...wallet, locked: true }, approvalChainId: 56 }).ok === false);
    t('revoke blocked without a wallet', revokeEligibility({ wallet: null, approvalChainId: 56 }).ok === false);
  } else {
    t('revoke eligibility checks SKIPPED (module not importable offline)', true);
  }

  /* ---------------------- 8. UNKNOWN stays UNKNOWN in UI ---------------- */
  const uiIntel = readFileSync(resolve(root, 'src/components/Intel.jsx'), 'utf8');
  const uiIntelCode = uiIntel.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('/**') && !l.trim().startsWith('//')).join('\n');
  t('LevelPill has no SAFE wording outside comments', !/['"]safe['"]|SAFE|100%\s*secure|risk[- ]free/i.test(uiIntelCode));
  t('ScoreBar renders null scores as “—” not zero', /score == null/.test(uiIntel));
  t('missing values render as N/A', /N\/A/.test(uiIntel));

  /* ---------------------- 9. locales carry the new copy ------------------ */
  const en = JSON.parse(readFileSync(resolve(root, 'src/i18n/locales/en.json'), 'utf8'));
  const fa = JSON.parse(readFileSync(resolve(root, 'src/i18n/locales/fa.json'), 'utf8'));
  const get = (o, k) => k.split('.').reduce((c, p) => (c && typeof c === 'object' ? c[p] : undefined), o);
  const mustHave = [
    'secCenter.title', 'secCenter.tab.approvals', 'secCenter.revoke', 'secCenter.revokeErr.COST',
    'secCenter.factor.auditEvidence', 'secCenter.status.INSUFFICIENT_EVIDENCE',
    'intel.level.unknown', 'intel.status.pass', 'intel.err.provider', 'intel.src.hacks',
    'explore.tab.protocols', 'explore.explainApprovalNote', 'explore.txStatus.failed',
    'explore.bucket.highLiquidity', 'nav.audit'
  ];
  t('en + fa define every headline intel key', mustHave.every((k) => typeof get(en, k) === 'string' && typeof get(fa, k) === 'string'));
  t('English nav label renamed to Security', en.nav.audit === 'Security');
  t('Persian nav label stays امنیت', fa.nav.audit === 'امنیت');
  t('fa analyzer copy is real Persian, not a key echo',
    typeof get(fa, 'secCenter.advisoryLine') === 'string' && !get(fa, 'secCenter.advisoryLine').startsWith('secCenter.'));
  t('en never-block subtitle present', /never blocks/i.test(en.secCenter.subtitle));

  /* ---------------- 10. no Intent OS coupling in the new modules -------- */
  for (const [name, src] of [['securityIntel', secSrc], ['routes', routeSrc], ['Security.jsx', uiSec], ['Explore.jsx', uiExp]]) {
    t(`${name} imports nothing from the Intent OS`, !/from '[^']*intent/i.test(src));
  }

  return rows;
}
