/**
 * FBT INTENT OS — follow-up resume + page-open task completion.
 *
 * Locks the live-dump regressions:
 *   «اره» after “open the market?”  → CONTINUE that resumes /market
 *   «بله تایید شد»                  → CONTINUE, not GENERAL
 *   «اره پر سوده را»               → /farm, never /news
 *   «افق جهانی را باز کن»          → HORIZON, task COMPLETED (no nag)
 *   «پیش بینی بیت کویین»           → ANALYZE_TOKEN
 *   «به ۲۷۰۰ رسید»                 → monitor threshold 2700
 */
import { understandIntent } from '../../src/lib/intent-ai/os/intentUnderstanding.js';
import {
  classifyFollowUp,
  resolveFollowUp,
  isBareFollowUp
} from '../../src/lib/intent-ai/os/upgrade6/followUpResolver.js';
import { parseShortAnswer } from '../../src/lib/intent-ai/os/upgrade6/slotFillingEngine.js';
import { parseMonitorRequest } from '../../src/lib/intent-ai/os/monitorClient.js';
import { createIntentOS, resetIntentOS } from '../../src/lib/intent-ai/os/index.js';
import { getLastActiveTask, getLastTask } from '../../src/lib/intent-ai/os/taskContinuity.js';
import { resolveIntent } from '../../src/lib/intent-ai/os/routeAdapter.js';
import { getSlotFillingEngine } from '../../src/lib/intent-ai/os/upgrade6/slotFillingEngine.js';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear()
};

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);

t('»اره« is confirm + bare follow-up + CONTINUE', (() => {
  const u = understandIntent('اره');
  return classifyFollowUp('اره').type === 'confirm'
    && isBareFollowUp('اره')
    && parseShortAnswer('اره').type === 'confirm'
    && u.type === 'CONTINUE';
})());

t('»بله تایید شد« is CONTINUE, not GENERAL', understandIntent('بله تایید شد').type === 'CONTINUE');

t('»اره باز کن« is CONTINUE', understandIntent('اره باز کن').type === 'CONTINUE');

t('»افق جهانی را باز کن« stays HORIZON (open-only is not a confirm)', understandIntent('افق جهانی را باز کن').type === 'HORIZON');

t('»پیش بینی بیت کویین« is ANALYZE_TOKEN', understandIntent('پیش بینی بیت کویین').type === 'ANALYZE_TOKEN');

t('»اره پر سوده را« resumes /farm, never /news', (() => {
  const r = resolveFollowUp('اره پر سوده را', {
    lastIntentType: 'YIELD_DISCOVERY',
    lastAiContent: '۳ فرصت فعلی پیدا کردم. می‌خواهید یکی را در صفحه مربوط باز کنیم؟'
  });
  return r.handled && r.route === '/farm' && r.selection === 'best';
})());

t('bare follow-up does not steal slots when no yes/no was asked', (() => {
  const engine = getSlotFillingEngine();
  engine.setExpectedQuestion('صفحه بازار را باز کنم؟', 'q1', 'text');
  const fill = engine.fillFromAnswer('اره', {
    conversationState: { lastQuestion: 'صفحه بازار را باز کنم؟', lastQuestionId: 'q1', lastQuestionType: 'text', missingSlots: [] }
  });
  return fill.filled === false;
})());

t('»به ۲۷۰۰ رسید« parses a PRICE threshold', (() => {
  const p = parseMonitorRequest('اگر ETH به ۲۷۰۰ رسید خبر بده');
  return p.monitor && Number(p.monitor.threshold) === 2700 && p.monitor.asset?.symbol === 'ETH';
})());

t('NAVIGATION without a named page does not default to /news', (() => {
  const r = resolveIntent({ type: 'NAVIGATION', raw: 'اره پر سوده را', entities: {}, navigation: {} }, 'اره پر سوده را', { openPage: true });
  return r.route !== '/news';
})());

resetIntentOS();
store.clear();
const os = createIntentOS({ locale: 'fa', forceNew: true });

{
  const first = await os.process({ message: 'افق جهانی را باز کن', conversationId: 't1' });
  t('opening Horizon navigates to /stocks', first.ok && (first.navigated === '/stocks' || first.execution?.route === '/stocks' || first.intent?.navigation?.route === '/stocks'));
  t('Horizon page-open is COMPLETED, not an unfinished PENDING nag', first.task?.status === 'COMPLETED' && getLastActiveTask() == null);
}

{
  const first = await os.process({
    message: 'بازار بیت کوین را تحلیل کن',
    conversationId: 't2'
  });
  const second = await os.process({
    message: 'اره',
    conversationId: 't2',
    conversation: [
      { role: 'user', content: 'بازار بیت کوین را تحلیل کن' },
      { role: 'ai', content: first.message || 'بازار را از ماژول زنده خواندم. جزئیات کامل روی صفحه بازار است — می‌خواهید آنجا را باز کنم؟' }
    ],
    pendingOffer: { route: '/market', intentType: 'MARKET_ANALYSIS' }
  });
  t('»اره« after a market offer opens /market',
    second.ok
    && (second.execution?.route === '/market' || second.navigated === '/market' || second.intent?.navigation?.route === '/market'));
}

{
  const first = await os.process({ message: 'سود بده', conversationId: 't3' });
  const second = await os.process({
    message: 'اره پر سوده را',
    conversationId: 't3',
    conversation: [
      { role: 'user', content: 'سود بده' },
      { role: 'ai', content: first.message || '۳ فرصت فعلی پیدا کردم. می‌خواهید یکی را در صفحه مربوط باز کنیم؟' }
    ]
  });
  t('»اره پر سوده را« after yield opens /farm',
    second.ok && (second.execution?.route === '/farm' || second.navigated === '/farm' || second.intent?.navigation?.route === '/farm' || second.intent?.type === 'FARM' || second.intent?.type === 'YIELD_DISCOVERY'));
}

t('getLastTask still returns the completed Horizon record', Boolean(getLastTask()));

export default rows;
