/** Mounted regression: real option → main handler → persisted canonical plan,
 * Operations intake/list, alternative rebuild and consented pause APIs. Only
 * upstream reads are fixtures. No signature/broadcast endpoint is ever used. */
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import { TelegramProvider } from '../../src/context/TelegramContext.jsx';
import { WalletProvider } from '../../src/context/WalletContext.jsx';
import IntentAIUnified from '../../src/components/IntentAIUnified.jsx';
import { clearApiCache } from '../../src/lib/api.js';
import { resetSharedReads } from '../../src/lib/strategyBrain/chatBridge.js';
import { STRATEGY_STORE_KEY } from '../../src/lib/strategyBrain/strategyStore.js';
import { getCurrentSlot, MULTI_SLOT_KEY } from '../../src/lib/intent-ai/chat/multiSlotCollector.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const setter = (input, value) => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};
const json = (data) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });

export async function run(container) {
  const rows = [];
  const check = (name, ok) => rows.push([name, !!ok]);
  const q = (s) => container.querySelector(s);
  const qa = (s) => Array.from(container.querySelectorAll(s));
  const wait = async (predicate, max = 90) => {
    for (let i = 0; i < max; i += 1) {
      await act(async () => { await sleep(40); });
      if (predicate()) return true;
    }
    return false;
  };
  const click = async (element) => { if (element && !element.disabled) await act(async () => { element.click(); }); };
  const send = async (text) => {
    await act(async () => { setter(q('.iaos-composer input.iaos-input'), text); });
    await click(q('.iaos-composer .iaos-send'));
    await wait(() => !q('.iaos-thinking'));
    await act(async () => { await sleep(80); });
  };
  const apiCalls = [];
  let autoStatus = 'ACTIVE'; let monitorStatus = 'ACTIVE';
  const oldFetch = globalThis.fetch;
  globalThis.fetch = window.fetch = async (url, init = {}) => {
    const u = String(url); const method = init.method || 'GET';
    apiCalls.push({ url: u, method });
    if (u.includes('/v1/ai/automations/auto-one/pause')) { autoStatus = 'PAUSED'; return json({ ok: true }); }
    if (u.includes('/v1/ai/monitors/mon-one/pause')) { monitorStatus = 'PAUSED'; return json({ ok: true }); }
    if (u.includes('/v1/ai/automations') && method === 'GET') return json({ ok: true, automations: [{ id: 'auto-one', status: autoStatus, title: 'Owned automation' }] });
    if (u.includes('/v1/ai/monitors/status')) return json({ ok: true, total: 1, active: monitorStatus === 'ACTIVE' ? 1 : 0, durable: true });
    if (u.includes('/v1/ai/monitors') && method === 'GET') return json({ ok: true, monitors: [{ id: 'mon-one', status: monitorStatus, label: 'Owned BTC monitor', metric: 'PRICE', asset: { symbol: 'BTC' }, threshold: 100000, operator: 'ABOVE' }] });
    if (u.includes('/v1/rewards/summary')) return json({ ok: true, data: { points: 321, level: { current: { id: 'silver' } } } });
    if (u.includes('/markets?')) return json([
      { id: 'ethereum', symbol: 'ETH', price: 3000, change24h: -2.5, mcap: 1e9, volume: 1e6 },
      { id: 'chainlink', symbol: 'LINK', price: 25, change24h: 1.3, mcap: 1e9, volume: 1e6 }
    ]);
    if (u.includes('/category/')) return json([{ id: 'pax-gold', symbol: 'PAXG', price: 3300, change24h: 1, mcap: 1e9, volume: 1e6 }]);
    throw new Error('fixture: other domains unavailable');
  };
  clearApiCache(); resetSharedReads();
  const root = createRoot(container);
  try {
    await act(async () => root.render(<TelegramProvider><WalletProvider><MemoryRouter initialEntries={['/intent?tab=history&section=monitoring']}><IntentAIUnified /></MemoryRouter></WalletProvider></TelegramProvider>));
    await wait(() => q('.iaos-history-tab[aria-selected="true"]'));
    check('a shared history URL preserves its monitoring section on initial page mount', /پایش/.test(q('.iaos-history-tab[aria-selected="true"]')?.textContent || ''));
    await click(q('.iaos-history-panel .iaos-close'));
    await send('مرکز عملیات را باز کن');
    await wait(() => q('[data-testid="ops-card-portfolio_analysis"]'));
    check('real operations panel mounts with primary actions, not only links', !!q('[data-testid="ops-card-portfolio_analysis"]'));
    const goalsTab = qa('.iaos-ops-cat').find((b) => /اهداف/.test(b.textContent));
    await click(goalsTab);
    await click(q('[data-testid="ops-card-strategy_build"]'));
    await wait(() => q('[data-testid="intent-ai-multislot-form"]'));
    const cid = Object.keys(JSON.parse(localStorage.getItem(MULTI_SLOT_KEY) || '{}'))[0];
    const firstSlot = getCurrentSlot({ conversationId: cid });
    check('strategy operation opens capital intake without inventing 10k/15% values', !!firstSlot && firstSlot.key === 'capitalUsd' && firstSlot.collectedCount === 0);
    await click(q('.iaos-multislot-cancel'));
    // Cancellation selector is text-based too, so changes to visual classes do
    // not accidentally bypass the actual handler the user gets.
    if (q('[data-testid="intent-ai-multislot-form"]')) await click(qa('[data-testid="intent-ai-multislot-form"] button').find((b) => /لغو/.test(b.textContent)));
    await wait(() => !q('[data-testid="intent-ai-multislot-form"]'));

    await send('با ایجنت مذاکره کن دربارهٔ ۱۰۰۰ دلار سرمایه و حداقل ۲۰٪ سود در ۲۰ روز');
    const negotiation = qa('[data-testid="intent-os-card"]').find((c) => c.querySelector('[data-chip-id="pick_balanced"]'));
    check('human/agent negotiation actually offers balanced with one in-card explanation', !!negotiation && negotiation.textContent.split('بودجه افت برآوردی 18').length - 1 === 1);
    check('no duplicate transcript outside the negotiation box', !!negotiation && !negotiation.closest('.iaos-bubble').querySelector('.iaos-msg-text'));
    await click(negotiation?.querySelector('[data-chip-id="pick_balanced"]'));
    await wait(() => q('[data-testid="strategy-plan-card"]'));
    const stored = () => JSON.parse(localStorage.getItem(STRATEGY_STORE_KEY) || '{}').plans || [];
    const first = stored()[0];
    check('balanced click builds a real canonical persisted plan with the original objective', !!first && first.strategy?.ok && first.strategy.goal.capitalUsd === 1000 && first.strategy.goal.targetPct === 20 && first.strategy.goal.floorPct === 20 && first.strategy.goal.horizonDays === 20 && first.strategy.goal.riskProfile === 'balanced');
    check('the answered offer is consumed and cannot be clicked twice', !!negotiation && Array.from(negotiation.querySelectorAll('button')).every((b) => b.disabled));
    const planCard = q('[data-testid="strategy-plan-card"]');
    check('Persian plan has none of the reported English explanation leaks', !!planCard && !/Expected returns|Nothing here signs|Not read this turn|Gas was unread|Derivative exposure/.test(planCard.textContent));
    const originalRecord = first ? JSON.stringify(first) : null;
    const alternative = planCard?.querySelector('tr[data-testid^="strategy-option-"]:not(.is-default) button');
    await click(alternative);
    check('alternative table click previews without creating an executable replacement', stored().length === 1 && !!q('[data-testid="strategy-option-preview"]'));
    const readsBefore = apiCalls.filter((c) => c.url.includes('/markets?')).length;
    await click(q('[data-testid="strategy-adopt-option"]'));
    await wait(() => stored().length >= 2);
    check('build-alternative button produces a second persisted plan/card', stored().length === 2 && qa('[data-testid="strategy-plan-card"]').length === 2);
    check('old plan, progress and receipts are preserved exactly', first && JSON.stringify(stored().find((p) => p.strategy?.strategyId === first.strategy.strategyId)) === originalRecord);
    check('alternative build re-reads upstream data instead of adopting stale table numbers', apiCalls.filter((c) => c.url.includes('/markets?')).length > readsBefore);

    await send('مرکز عملیات را باز کن');
    await wait(() => q('[data-testid="ops-card-portfolio_analysis"]'));
    const monitoringTab = qa('.iaos-ops-cat').find((b) => b.textContent.trim() === 'پایش');
    await click(monitoringTab);
    await click(q('[data-testid="ops-card-monitor_list"]'));
    await wait(() => !!q('.iaos-history-tab[aria-selected="true"]'));
    check('active-monitor operation opens monitoring history, not the new-monitor form', /پایش/.test(q('.iaos-history-tab[aria-selected="true"]')?.textContent || '') && !q('.iaos-form-panel'));
    const histClose = q('.iaos-history-panel .iaos-close') || qa('.iaos-panel .iaos-close').at(-1);
    await click(histClose);

    const pausesBefore = apiCalls.filter((c) => c.url.endsWith('/pause')).length;
    await send('توقف کامل');
    const emergency = qa('[data-kind="EMERGENCY"]').at(-1);
    check('opening emergency stop does not pause a job before explicit confirmation', apiCalls.filter((c) => c.url.endsWith('/pause')).length === pausesBefore);
    await click(emergency?.querySelector('[data-chip-id="emergency-confirm"]'));
    await wait(() => autoStatus === 'PAUSED' && monitorStatus === 'PAUSED');
    check('explicit stop confirmation reaches the real scoped automation and monitor pause clients', autoStatus === 'PAUSED' && monitorStatus === 'PAUSED');
    check('stop result states that no position closed and no transaction was signed', /پوزیشن باز بسته نشده/.test(container.textContent) && /تراکنشی امضا یا ارسال نشده/.test(container.textContent));
    await send('استراتژی پرتفوی بساز');
    await wait(() => q('[data-testid="intent-ai-multislot-form"]'));
    const emergenciesBefore = qa('[data-kind="EMERGENCY"]').length;
    await act(async () => { const input = q('[data-testid="intent-ai-multislot-form"] input'); if (input) setter(input, 'توقف کامل'); });
    await click(q('.iaos-multislot-submit'));
    await wait(() => qa('[data-kind="EMERGENCY"]').length > emergenciesBefore);
    check('an emergency typed in the active intake interrupts it, not parsed as capital',
      !q('[data-testid="intent-ai-multislot-form"]') && qa('[data-kind="EMERGENCY"]').length === emergenciesBefore + 1);
    await send('مرکز عملیات را باز کن');
    await wait(() => q('[data-testid="ops-card-portfolio_analysis"]'));
    await click(qa('.iaos-ops-cat').find((b) => /پاداش/.test(b.textContent)));
    await click(q('[data-testid="ops-card-rewards_points"]'));
    await wait(() => /امتیاز ثبت‌شده\s*:?\s*321/.test(container.textContent));
    check('the real Rewards primary handler reads /v1/rewards/summary and displays the server value',
      apiCalls.some((c) => c.url.includes('/v1/rewards/summary')) && /امتیاز ثبت‌شده\s*:?\s*321/.test(container.textContent));
    check('Rewards API data is explicitly not presented as cash or guaranteed return', /موجودی نقدی یا سود تضمینی نیست/.test(container.textContent));

    check('no operation in this probe signs, broadcasts or invokes the execution endpoint', !apiCalls.some((c) => /\/execute(?:\?|$)|\/broadcast(?:\?|$)/.test(c.url)));
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = window.fetch = oldFetch;
  }
  return rows;
}
