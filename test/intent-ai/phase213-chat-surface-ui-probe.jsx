/**
 * PHASE 213 — THE CHAT-SURFACE PROBE, MOUNTED
 * ---------------------------------------------------------------------------
 * The node probe (phase213-chat-surface-probe.mjs) proves the modules: the
 * ledger, the catalog, the search door, the negotiation engines, the mirror.
 *
 * This probe proves the SEAM — the exact thing this repo has shipped broken
 * twice: logic correct in `src/lib`, wiring missing in the page.
 *
 * What the owner asked for, and what is asserted here on the real component:
 *
 *   1. «چه کارهایی می‌تونی بکنی؟» → every Intent-OS option appears in chat as a
 *      button that actually sends when pressed;
 *   2. the emergency mode is one of those buttons and produces the stop-PLAN
 *      card, which asks for confirmation and never claims anything stopped;
 *   3. «جستجو کن …» produces a real search answer — offline: an honest refusal
 *      with no invented source;
 *   4. a negotiation that lacks a subject ASKS for it, in a bar above the
 *      composer, and the question is persisted;
 *   5. answering in chat closes the question exactly once and shows the
 *      acknowledgement naming the value;
 *   6. «حالت چطوره» typed while the composer is the only thing alive gets a
 *      human answer in Persian (the offline social path), never a retry banner.
 *
 * Mounts ONCE — repeated mounts of this component exhaust the heap.
 */
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import { TelegramProvider } from '../../src/context/TelegramContext.jsx';
import { WalletProvider } from '../../src/context/WalletContext.jsx';
import IntentAIUnified from '../../src/components/IntentAIUnified.jsx';
import { OPEN_QUESTION_KEY, QUESTION_STATUS, resetLedger } from '../../src/lib/intent-ai/chat/questionLedger.js';
import { offlineSocialFallback } from '../../src/lib/intent-ai/chat/socialChat.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const setInputValue = (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

export async function run(container) {
  const rows = [];
  const check = (name, ok) => rows.push([name, !!ok]);
  const q = (sel) => container.querySelector(sel);
  const qa = (sel) => Array.from(container.querySelectorAll(sel));

  /* The network boundary is dead in this probe: a card that pretends to have
     live data, or a question that pretends to be answered, would be a bug. */
  const calls = [];
  const recordingFetch = (url, init = {}) => {
    let body = null;
    try { body = init?.body ? JSON.parse(init.body) : null; } catch { body = null; }
    calls.push({ url: String(url), body });
    return Promise.reject(new Error('offline probe'));
  };
  window.fetch = recordingFetch;
  globalThis.fetch = recordingFetch;

  resetLedger();

  const root = createRoot(container);
  await act(async () => {
    root.render(
      <TelegramProvider>
        <WalletProvider>
          <MemoryRouter initialEntries={['/intent']}>
            <IntentAIUnified />
          </MemoryRouter>
        </WalletProvider>
      </TelegramProvider>
    );
  });
  for (let i = 0; i < 4; i += 1) await act(async () => { await sleep(20); });

  const send = async (text, waitMs = 900) => {
    const input = q('.iaos-composer input.iaos-input');
    await act(async () => { setInputValue(input, text); });
    await act(async () => { await sleep(10); });
    const btn = q('.iaos-composer button.iaos-send');
    if (btn && !btn.disabled) await act(async () => { btn.click(); });
    const steps = Math.max(1, Math.ceil(waitMs / 50));
    for (let i = 0; i < steps; i += 1) await act(async () => { await sleep(50); });
  };

  check('the chat renders with its composer', !!q('.iaos-composer .iaos-input'));

  /* ── 1. EVERYTHING IN INTENT OS IS ASKABLE, AND THE OPTIONS ARE REAL ───── */
  await send('چه کارهایی می‌تونی بکنی؟');
  const catalog = q('[data-testid="intent-os-card"][data-kind="CATALOG"]');
  check('asking "what can you do" renders the Intent OS catalog card', !!catalog);
  const catalogChips = catalog ? catalog.querySelectorAll('[data-testid="intent-os-chip"]') : [];
  check('the catalog offers real buttons (coordination + every domain)', catalogChips.length >= 8);
  check('the catalog states that nothing runs by itself',
    !catalog || /اجرا نمی‌شود/.test(catalog.textContent || ''));
  check('the catalog renders the option lines, not a link to another page',
    !catalog || (catalog.querySelectorAll('.iaos-os-line').length >= 10));

  /* ── 2. THE EMERGENCY MODE IS ASKABLE FROM A CHIP ─────────────────────── */
  const emergencyChip = catalogChips.length
    ? Array.from(catalogChips).find((c) => /اضطرار/.test(c.textContent || ''))
    : null;
  check('the emergency mode is one of the offered options', !!emergencyChip);
  if (emergencyChip) await act(async () => { emergencyChip.click(); });
  for (let i = 0; i < 20; i += 1) { await act(async () => { await sleep(50); }); if (q('[data-kind="EMERGENCY"]')) break; }
  const emergency = q('[data-testid="intent-os-card"][data-kind="EMERGENCY"]');
  check('pressing it produces the emergency plan as a card', !!emergency);
  check('the emergency card asks for explicit confirmation first',
    !emergency || Array.from(emergency.querySelectorAll('[data-testid="intent-os-chip"]')).some((c) => /تأیید/.test(c.textContent || '')));
  check('the emergency card never claims something was stopped by itself',
    !emergency || /اجرا نشد|متوقف نمی‌کند|پلن توقف/.test(emergency.textContent || ''));

  /* ── 3. WEB SEARCH: ASKED FOR EXPLICITLY, HONEST WHEN IT CANNOT RUN ─────
        A search answer is a normal assistant bubble carrying an `intelligence`
        block (sources render from there), not an OS card — so it is found by
        comparing the bubble count and reading the last answer. */
  const aiBefore = qa('.iaos-msg.iaos-ai').length;
  await send('جستجو کن قیمت بیت‌کوین الان چنده');
  const aiAfter = qa('.iaos-msg.iaos-ai');
  check('the explicit search command produces its own answer bubble', aiAfter.length > aiBefore);
  const searchText = aiAfter[aiAfter.length - 1]?.textContent || '';
  check('the search bubble is about the search the user asked for',
    /جستجو/.test(searchText) && /بیت‌کوین|قیمت/.test(searchText));
  check('offline, the search says it did not run instead of inventing a price',
    /انجام نشد|در دسترس|برنگشت|خطا|چیزی/.test(searchText) && !/حاصل شد/.test(searchText));
  check('no source is cited when no source was returned',
    !aiAfter[aiAfter.length - 1]?.querySelector('a[href^="http"]'));

  /* ── 4. A QUESTION THE ASSISTANT ASKS STAYS IN FRONT OF THE USER ──────── */
  await send('با ایجنت‌ها مذاکره کن');
  for (let i = 0; i < 20; i += 1) { await act(async () => { await sleep(50); }); if (q('[data-testid="intent-ai-open-question"]')) break; }
  const bar = q('[data-testid="intent-ai-open-question"]');
  check('a negotiation without a subject asks instead of inventing one', !!bar);
  const openText = bar?.textContent || '';
  check('the question bar says it is waiting and names the question',
    /منتظر جواب/.test(openText) && (openText.includes('مذاکره') || openText.includes('موضوع')));

  let stored = [];
  try { stored = JSON.parse(localStorage.getItem(OPEN_QUESTION_KEY) || '[]'); } catch { stored = []; }
  check('the question is persisted (a reload cannot lose it)',
    stored.some((r) => r.status === QUESTION_STATUS.OPEN));
  const openRow = stored.find((r) => r.status === QUESTION_STATUS.OPEN);
  check('the persisted question keeps the options the user was shown',
    Array.isArray(openRow?.options) && openRow.options.length >= 1);

  /* ── 5. THE ANSWER CLOSES THE QUESTION EXACTLY ONCE ──────────────────── */
  await send('۳۰۰۰ دلار');
  const ack = q('[data-testid="intent-ai-question-ack"]');
  check('answering in chat shows an acknowledgement', !!ack);
  check('the acknowledgement repeats the value the user gave',
    !ack || /3,?000|۳٬?۰۰۰|۳۰۰۰/.test(ack.textContent || ''));
  try { stored = JSON.parse(localStorage.getItem(OPEN_QUESTION_KEY) || '[]'); } catch { stored = []; }
  check('the question is closed after one answer', !stored.some((r) => r.status === QUESTION_STATUS.OPEN));
  const answered = stored.find((r) => r.status === QUESTION_STATUS.ANSWERED) || stored.find((r) => r.closedAt);
  check('the ledger keeps the answer as the record of what happened', Boolean(answered));

  /* ── 6. «حالت چطوره» — understood, in Persian, even with the pipe down ── */
  const social = offlineSocialFallback('حالت چطوره؟', { locale: 'fa' });
  check('the offline social path answers a pleasantry (nothing to retry)',
    social && social.kind === 'assistant' && /ممنون|سلام|آماده/.test(social.content || ''));
  check('the social answer carries no number and no price',
    Boolean(social) && !/\d/.test(social.content || ''));

  const beforeSocial = qa('.iaos-msg.iaos-ai').length;
  await send('حالت چطوره');
  const afterSocial = qa('.iaos-msg.iaos-ai');
  check('typing a pleasantry in the live chat gets an answer bubble',
    afterSocial.length > beforeSocial);
  const socialBubble = afterSocial[afterSocial.length - 1]?.textContent || '';
  check('the pleasantry is answered with words, not with a retry banner',
    !/دوباره تلاش کن|NETWORK_FAILED|اتصال برقرار نشد/.test(socialBubble) && socialBubble.length > 5);
  check('the pleasantry is answered in Persian',
    /[\u0600-\u06FF]/.test(socialBubble) && /ممنون|سلام|خوش|آماده|در خدمت/.test(socialBubble));
  check('every request this probe made was recorded as a failed call, never faked',
    calls.every((c) => typeof c.url === 'string' && c.url.length > 0) && calls.length > 0);

  return rows;
}
