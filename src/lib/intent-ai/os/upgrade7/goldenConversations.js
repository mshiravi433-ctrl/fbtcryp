/**
 * FBT INTENT OS — UPGRADE 7 · Golden Conversations + Evaluation Suite
 * ---------------------------------------------------------------------------
 * Spec §43 (a permanent test set across the ten competences), §44 (at least 50
 * real/synthetic conversations where context must survive every turn),
 * §45 (regression protection for Upgrades 1–6).
 *
 * The data lives in source, not in the probe, so both `npm test` and any future
 * CI job can score the same corpus.
 */

export const GOLDEN_SCHEMA = 'fbt.golden-conversations.v7';

export const COMPETENCES = Object.freeze([
  'intent_understanding', 'context_retention', 'question_answering', 'agent_selection',
  'tool_selection', 'navigation', 'wallet', 'risk', 'execution', 'recovery'
]);

const C = (id, competence, turns, expect = {}) => ({ id, competence, turns, expect });
const U = (content) => ({ role: 'user', content });

/**
 * 52 conversations. `expect` is intentionally coarse — it asserts the property
 * the spec cares about (context survived, no repeated question, the right slot
 * was carried), not an exact sentence, so a wording change never fails the run.
 */
export const GOLDEN_CONVERSATIONS = Object.freeze([
  /* ── intent understanding ────────────────────────────────────────────── */
  C('g01', 'intent_understanding', [U('می‌خوام با سرمایه فعلیم تا چهار ماه دیگه بیشترین بازده ممکن رو بگیرم ولی ریسک خیلی بالا نباشه.')],
    { goal: 'maximize_return', objective: 'risk_adjusted_return', timeframeMonths: 4, riskLevel: 'not_high', capitalSource: 'current_portfolio' }),
  C('g02', 'intent_understanding', [U('پرتفوی من را تحلیل کن')], { intentType: 'PORTFOLIO_ANALYSIS', action: 'analyze' }),
  C('g03', 'intent_understanding', [U('ریسک من را کم کن')], { goal: 'reduce_risk' }),
  C('g04', 'intent_understanding', [U('بخشی از سودم را ذخیره کن')], { goal: 'preserve_capital' }),
  C('g05', 'intent_understanding', [U('هر ماه این کار را انجام بده')], { recurrence: 'monthly', action: 'schedule' }),
  C('g06', 'intent_understanding', [U('اگر بیت‌کوین به 100000 رسید خبرم کن')], { action: 'alert', goal: 'monitor' }),
  C('g07', 'intent_understanding', [U('بهترین گزینه با ریسک متوسط را پیدا کن')], { riskLevel: 'medium' }),
  C('g08', 'intent_understanding', [U('پرتفوی من را متعادل کن')], { goal: 'rebalance', action: 'rebalance' }),
  C('g09', 'intent_understanding', [U('این توکن را با قبلی مقایسه کن')], { action: 'compare' }),
  C('g10', 'intent_understanding', [U('همین را با سرمایه فعلی من بررسی کن')], { capitalSource: 'current_portfolio' }),
  C('g11', 'intent_understanding', [U('maximize my returns over 6 months with low risk')],
    { goal: 'maximize_return', timeframeMonths: 6, riskLevel: 'low' }),
  C('g12', 'intent_understanding', [U('یک درآمد ماهانه از استیبل‌کوین‌هام می‌خوام')], { goal: 'generate_income' }),

  /* ── hidden intent ───────────────────────────────────────────────────── */
  C('g13', 'question_answering', [U('بیت‌کوین الان چطوره؟')], { hiddenIncludes: ['price', 'trend', 'risk'] }),
  C('g14', 'question_answering', [U('چرا BTC ریخت؟')], { hiddenIncludes: ['price_move_cause', 'news'] }),
  C('g15', 'question_answering', [U('اتریوم رو بخرم؟')], { hiddenIncludes: ['risk'] }),
  C('g16', 'question_answering', [U('بهترین جای سود کجاست؟')], { hiddenIncludes: ['yield_discovery', 'risk'] }),

  /* ── context retention (the §44 multi-turn core) ─────────────────────── */
  C('g17', 'context_retention', [U('پرتفوی من را تحلیل کن'), U('۴ ماه'), U('ریسک متوسط'), U('انجام بده')],
    { retainsTimeframe: true, retainsRisk: true, noRepeatedQuestion: true }),
  C('g18', 'context_retention', [U('می‌خوام ۲۰٪ سود کنم'), U('چهار ماه'), U('ریسک متوسط')],
    { targetReturnPct: 20, retainsTimeframe: true }),
  C('g19', 'context_retention', [U('می‌خوام ۲۰٪ سود کنم در ۴ ماه با ریسک متوسط'), U('حالا همین را برای BTC انجام بده')],
    { carriesGoalToNewAsset: true, asset: 'BTC' }),
  C('g20', 'context_retention', [U('سود بده'), U('اره')], { resumesOffer: true }),
  C('g21', 'context_retention', [U('ریسک کم می‌خوام'), U('ریسک بالا می‌خوام')], { contradictionDetected: true, severity: 'high' }),
  C('g22', 'context_retention', [U('بیت کوین را تحلیل کن'), U('نه، منظورم این نبود، اتریوم را می‌گم')],
    { correctionDetected: true, conversationReset: false }),
  C('g23', 'context_retention', [U('پرتفوی من را تحلیل کن'), U('حالا ریسکش را بگو')], { retainsSubject: true }),
  C('g24', 'context_retention', [U('۱۰۰۰ دلار دارم'), U('کجا سرمایه‌گذاری کنم؟')], { retainsCapital: true }),
  C('g25', 'context_retention', [U('analyze my portfolio'), U('4 months'), U('medium risk'), U('do it')],
    { retainsTimeframe: true, retainsRisk: true, noRepeatedQuestion: true }),

  /* ── agent selection ─────────────────────────────────────────────────── */
  C('g26', 'agent_selection', [U('پرتفوی من را تحلیل کن')], { agentsInclude: ['portfolio-agent', 'risk-agent'] }),
  C('g27', 'agent_selection', [U('بازار را تحلیل کن')], { agentsInclude: ['market-agent'] }),
  C('g28', 'agent_selection', [U('بهترین فرصت سود را پیدا کن')], { agentsInclude: ['yield-agent'] }),
  C('g29', 'agent_selection', [U('نهنگ‌ها چه می‌کنند؟')], { modulesInclude: ['smartMoney'] }),
  C('g30', 'agent_selection', [U('یک استراتژی برای ۶ ماه بساز')], { planTemplate: 'FINANCIAL_GOAL' }),

  /* ── tool selection / modules ────────────────────────────────────────── */
  C('g31', 'tool_selection', [U('موجودی من چقدر است؟')], { modulesInclude: ['wallet'] }),
  C('g32', 'tool_selection', [U('۱۰۰ دلار USDC به ETH تبدیل کن')], { modulesInclude: ['swap'], action: 'swap' }),
  C('g33', 'tool_selection', [U('می‌خوام وام بگیرم')], { modulesInclude: ['lending'] }),
  C('g34', 'tool_selection', [U('فارم‌های خوب را نشان بده')], { modulesInclude: ['farm'] }),
  C('g35', 'tool_selection', [U('سیگنال‌های امروز چیست؟')], { modulesInclude: ['signals'] }),

  /* ── navigation (regression: §45 no navigation loop) ─────────────────── */
  C('g36', 'navigation', [U('صفحه پرتفوی را باز کن')], { navigates: true }),
  C('g37', 'navigation', [U('برو به سواپ'), U('برگرد به چت')], { noNavigationLoop: true }),
  C('g38', 'navigation', [U('افق جهانی را باز کن')], { navigates: true }),

  /* ── wallet (regression: no wallet disconnect) ───────────────────────── */
  C('g39', 'wallet', [U('کیف پولم را وصل کن')], { walletIntent: true }),
  C('g40', 'wallet', [U('موجودی من چقدر است؟')], { requiresWallet: true }),
  C('g41', 'wallet', [U('پرتفوی من را تحلیل کن'), U('حالا موجودی را بگو')], { walletPreserved: true }),

  /* ── risk ────────────────────────────────────────────────────────────── */
  C('g42', 'risk', [U('همه سرمایه‌ام را روی یک توکن بذار')], { highRiskFlag: true }),
  C('g43', 'risk', [U('با اهرم ۱۰ معامله کن')], { highRiskFlag: true, requiresConfirmation: true }),
  C('g44', 'risk', [U('ریسک پرتفوی من چقدر است؟')], { intentType: 'RISK_ANALYSIS' }),

  /* ── execution (regression: no duplicate execution) ──────────────────── */
  C('g45', 'execution', [U('۵۰ دلار بیت کوین بخر')], { requiresConfirmation: true, simulationRequired: true }),
  C('g46', 'execution', [U('۵۰ دلار بیت کوین بخر'), U('۵۰ دلار بیت کوین بخر')], { dedupes: true }),
  C('g47', 'execution', [U('بفروش'), U('لغو کن')], { cancellable: true }),
  C('g48', 'execution', [U('هر ماه ۱۰۰ دلار اتریوم بخر')], { recurrence: 'monthly', requiresPermissionEachRun: true }),

  /* ── recovery ────────────────────────────────────────────────────────── */
  C('g49', 'recovery', [U('پرتفوی من را تحلیل کن'), U('صبر کن'), U('ادامه بده')], { resumable: true }),
  C('g50', 'recovery', [U('تراکنشم چی شد؟')], { requiresVerifiedData: true }),
  C('g51', 'recovery', [U('یک استراتژی بساز'), U('۴ ماه')], { resumesSamePlan: true, doesNotRestart: true }),
  C('g52', 'recovery', [U('قیمت سولانا چقدر است؟')], { requiresFreshData: true, dataNeedIncludes: ['price'] })
]);

/* -------------------------------------------------------------------------- */
/*  §45 REGRESSION CHECKS                                                       */
/* -------------------------------------------------------------------------- */

export const REGRESSION_CHECKS = Object.freeze([
  { id: 'no_navigation_loop', description: 'Repeated navigation to the same route must be guarded' },
  { id: 'no_repeated_questions', description: 'A slot already answered is never asked again' },
  { id: 'no_wallet_disconnect', description: 'Wallet context survives an intent turn' },
  { id: 'no_context_reset', description: 'A correction patches the intent; it never clears the conversation' },
  { id: 'no_scroll_regression', description: 'Upgrade 6 scroll manager remains present and untouched' },
  { id: 'no_duplicate_execution', description: 'Identical in-flight requests share one execution' },
  { id: 'no_stale_transaction', description: 'Market-sensitive values are refetched, never served stale' }
]);

/** Coverage report used by the probe and by any deployment gate (§43). */
export function competenceCoverage() {
  const counts = {};
  for (const c of GOLDEN_CONVERSATIONS) counts[c.competence] = (counts[c.competence] || 0) + 1;
  return {
    total: GOLDEN_CONVERSATIONS.length,
    byCompetence: counts,
    missing: COMPETENCES.filter((k) => !counts[k]),
    meetsMinimum: GOLDEN_CONVERSATIONS.length >= 50 && COMPETENCES.every((k) => counts[k] > 0)
  };
}
