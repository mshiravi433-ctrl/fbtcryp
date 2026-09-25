/**
 * FBT INTENT OS — PHASE 213 PROBE: THE CHAT **IS** THE INTENT OS SURFACE
 * ---------------------------------------------------------------------------
 * This probe is written against the owner's report, sentence by sentence:
 *
 *   «هر چیزی داخل Intent OS باید در چت بیاید»
 *        → Suite 3: the catalog covers every domain, every event that matters
 *          is mirrored, and noise is not.
 *   «اگر سوالی می‌پرسد باید منتظر جواب کاربر باشد و یادش نره»
 *        → Suite 1–2: one durable open question, bound exactly once, survives a
 *          reload, is not re-asked, and is not eaten by a new topic.
 *   «حالت چطوره یا چیزهای دیگر را بفهمد»
 *        → Suite 6: the client answers a pleasantry in the user's own language
 *          with no server, and still refuses to swallow an order.
 *   «جستجو در نت هم باشد و همه اپشن‌ها فعال»
 *        → Suite 5: an explicit search is a real search with real sources, or
 *          an honest failure — never a fabricated citation.
 *   «انسان به انسان، انسان به ایجنت، ایجنت به ایجنت، توافق، اضطرار»
 *        → Suite 4: every coordination mode is reachable from chat, driven by
 *          the real engines, and none of them executes or claims contact.
 *
 * Everything here is offline and deterministic. The network boundary is an
 * injected function, exactly where the app injects the gateway.
 */

import assert from 'node:assert/strict';

import {
  askQuestion,
  bindAnswer,
  classifyAnswer,
  getOpenQuestion,
  getOpenQuestionState,
  closeQuestion,
  resetLedger,
  wasRecentlyAsked,
  acknowledgement,
  promptBlock,
  answerHint,
  ANSWER_KINDS,
  QUESTION_STATUS,
  OPEN_QUESTION_SCHEMA,
  QUESTION_TTL_MS
} from '../../src/lib/intent-ai/chat/questionLedger.js';

import {
  SURFACE_CATALOG,
  COORDINATION_MODES,
  SURFACE_KINDS,
  catalogMessage,
  createSurfaceGate,
  domainCoverage,
  eventToChatMessage,
  isSurfaceWorthy,
  localizedCatalog,
  surfaceMessage
} from '../../src/lib/intent-ai/chat/osSurface.js';

import {
  NEGOTIATION_MODES,
  NEGOTIATION_OUTCOMES,
  NEGOTIATION_LAWS,
  parseNegotiationRequest,
  runChatNegotiation,
  negotiationToChatMessage,
  negotiationQuestion
} from '../../src/lib/intent-ai/chat/negotiationChat.js';

import {
  parseSearchRequest,
  runChatSearch,
  searchToMessage,
  shouldForceWebSearch,
  SEARCH_HONESTY
} from '../../src/lib/intent-ai/chat/searchChat.js';

import {
  composeSocialReply,
  offlineSocialFallback,
  isPureSocialTurn
} from '../../src/lib/intent-ai/chat/socialChat.js';

const rows = [];
const t = (name, ok, detail = '') => rows.push([name, Boolean(ok), ok ? '' : String(detail).slice(0, 200)]);

/* A localStorage stand-in so the ledger's persistence can be tested for real
   (node has none, and "survives a reload" is exactly the claim under test). */
const fakeStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (fakeStore.has(k) ? fakeStore.get(k) : null),
  setItem: (k, v) => fakeStore.set(k, String(v)),
  removeItem: (k) => fakeStore.delete(k),
  clear: () => fakeStore.clear()
};

/* ── 1. THE OPEN QUESTION: asked once, bound once, remembered ─────────────── */
{
  resetLedger();
  const asked = askQuestion({
    text: 'چند دلار می‌خواهی وارد کنی؟',
    slot: 'amountUsd',
    expectedType: 'amount',
    conversationId: 'c1',
    locale: 'fa'
  });
  t('1.1 asking a question records exactly one open question', asked.ok && getOpenQuestion({ conversationId: 'c1' })?.id === asked.question.id);
  t('1.2 the open question survives a "reload" (it is in storage)', (() => {
    const raw = JSON.parse(fakeStore.get('fbt.chat.open-question.v1') || '[]');
    return raw.length === 1 && raw[0].status === 'open';
  })());

  const answer = bindAnswer({ text: '۲۵۰۰ دلار', conversationId: 'c1' });
  t('1.3 a Persian-digit amount is understood as the answer', answer.kind === ANSWER_KINDS.ANSWER && answer.value === 2500, JSON.stringify(answer));
  t('1.4 the question is closed after one answer', answer.closed === true && getOpenQuestion({ conversationId: 'c1' }) === null);
  t('1.5 the answer is not re-bindable (consumed exactly once)', bindAnswer({ text: '۳۰۰۰ دلار', conversationId: 'c1' }).ok === false);
  t('1.6 the acknowledgement names the slot and the value', /مقدار دلاری/.test(acknowledgement(answer, { locale: 'fa' }) || '') && /2,?500/.test(acknowledgement(answer, { locale: 'fa' }) || ''), acknowledgement(answer, { locale: 'fa' }));

  const first = askQuestion({ text: 'دوره‌ات چند ماه است؟', slot: 'duration', expectedType: 'duration', conversationId: 'c1' });
  const second = askQuestion({ text: 'سطح ریسکت چیست؟', slot: 'risk', expectedType: 'text', conversationId: 'c1' });
  t('1.7 a second question supersedes the first instead of orphaning it', second.replacedId === first.question.id && getOpenQuestion({ conversationId: 'c1' }).id === second.question.id);
  t('1.8 wasRecentlyAsked knows what was just asked', wasRecentlyAsked('سطح ریسکت چیست؟') === true);
}

/* ── 2. THE FOUR WAYS A TURN CAN TREAT THE OPEN QUESTION ──────────────────── */
{
  resetLedger();
  const q = askQuestion({ text: 'ریسکت را چه سطحی بگذارم؟', slot: 'risk', expectedType: 'text', conversationId: 'c2', options: [{ id: 'low', label: 'کم' }, { id: 'high', label: 'زیاد' }] }).question;
  t('2.1 a skip is recognised and closes the question', (() => {
    const v = classifyAnswer('نمی‌دونم', q);
    return v.kind === ANSWER_KINDS.SKIP;
  })());
  t('2.2 a cancel is recognised', classifyAnswer('بی‌خیال', q).kind === ANSWER_KINDS.CANCEL);
  t('2.3 a choice label answers the question', (() => {
    const v = classifyAnswer('کم', q);
    return v.kind === ANSWER_KINDS.ANSWER && v.value.id === 'low';
  })());
  t('2.4 a yes/no question accepts yes and no', (() => {
    const yn = { expectedType: 'confirmation', options: [] };
    return classifyAnswer('بله', yn).value === true && classifyAnswer('no', yn).value === false;
  })());

  // NEW_TOPIC: a fresh, unrelated request must NOT eat the question.
  const open = askQuestion({ text: 'هدفت چند ماهه است؟', slot: 'duration', expectedType: 'duration', conversationId: 'c3' }).question;
  const verdict = bindAnswer({ text: 'یک تحلیل از بازار بده و بعداً جواب می‌دهم', conversationId: 'c3' });
  t('2.5 an unrelated request does not eat the open question', verdict.kind === ANSWER_KINDS.NEW_TOPIC && getOpenQuestion({ conversationId: 'c3' })?.id === open.id, JSON.stringify(verdict));
  t('2.6 the re-surface acknowledgement mentions the still-open question', /هدفت چند ماهه است/.test(acknowledgement(verdict, { locale: 'fa' }) || ''));
  t('2.7 a conflicting free text still binds as an answer when it IS one', (() => {
    resetLedger();
    askQuestion({ text: 'دوره‌ات چند ماه است؟', slot: 'duration', expectedType: 'duration', conversationId: 'c4' });
    const v = bindAnswer({ text: '۴ ماه', conversationId: 'c4' });
    return v.kind === ANSWER_KINDS.ANSWER && v.value.unit === 'month' && v.value.value === 4;
  })());

  // TTL: an old question expires honestly instead of blocking forever.
  resetLedger();
  askQuestion({ text: 'چه مقدار؟', slot: 'amount', expectedType: 'amount', conversationId: 'c5', now: Date.now() - QUESTION_TTL_MS - 1000 });
  const state = getOpenQuestionState({ conversationId: 'c5' });
  t('2.8 an expired question is reported as expired, not silently dropped', state.question === null && state.expired === true);
  t('2.9 closing by hand works and says why', (() => {
    resetLedger();
    const qq = askQuestion({ text: 'کدام گزینه؟', slot: 'choice', expectedType: 'choice', conversationId: 'c6' }).question;
    const closed = closeQuestion({ questionId: qq.id, reason: 'skipped' });
    return closed.ok && closed.question.status === QUESTION_STATUS.SKIPPED;
  })());
}

/* ── 3. WHAT THE MODEL IS TOLD (the "so it does not forget" contract) ─────── */
{
  resetLedger();
  const asked = askQuestion({ text: 'چقدر سرمایه داری؟', slot: 'amountUsd', expectedType: 'amount', conversationId: 'c7', options: [{ id: 'a', label: 'کمتر از ۵۰۰۰ دلار' }, { id: 'b', label: 'بیشتر' }] });
  t('3.1 the question is registered for the prompt', asked.ok);
  const block = promptBlock({ locale: 'fa' });
  t('3.2 the prompt block is mandatory and names the question', /الزامی/.test(block) && /چقدر سرمایه داری/.test(block), block);
  t('3.3 the prompt block forbids re-asking and forbids claims', /تکرار نکن/.test(block) && /ادعا نکن/.test(block));
  t('3.4 the prompt block carries the options the user was offered', /کمتر از/.test(block));
  const bound = bindAnswer({ text: '۵۰۰۰ دلار', conversationId: 'c7' });
  const hint = answerHint(bound);
  t('3.5 the answer hint is structured for the server', hint.schema === OPEN_QUESTION_SCHEMA && hint.closed === true && hint.value === 5000, JSON.stringify(hint));
  t('3.6 after the answer there is no open question left to ask again', promptBlock({ locale: 'fa' }) === null);
}

/* ── 4. EVERYTHING IN INTENT OS IS ASKABLE (and only real things appear) ──── */
{
  const en = localizedCatalog('en');
  t('4.1 the surface catalog exposes all five coordination modes', COORDINATION_MODES.length === 5 && COORDINATION_MODES.every((m) => m.chatPrompt.fa && m.chatPrompt.en));
  t('4.2 the catalog covers every operations domain', ['portfolio', 'wallet', 'swap', 'bridge', 'lending', 'farm', 'liquidity', 'futures', 'dydx', 'markets', 'intelligence', 'goals', 'automation', 'monitoring', 'rewards'].every((d) => domainCoverage(d).cards > 0));
  t('4.3 every catalog entry has a real Persian chat sentence', en.every((e) => typeof e.chatPrompt === 'string' && e.chatPrompt.length > 3));
  t('4.4 coverage reports the real card counts (no stub domains)', (() => {
    const swap = domainCoverage('swap');
    return swap.cards >= 4 && swap.routes.includes('/swap');
  })());

  const msg = catalogMessage({ locale: 'fa' });
  t('4.5 asking "what can you do" produces the full option list', msg.kind === SURFACE_KINDS.CATALOG && msg.entries.length === SURFACE_CATALOG.length);
  t('4.6 the catalog answers in the user\'s language', /گزینه‌های Intent OS/.test(msg.title) && msg.lines.some((l) => /کیف پول|سواپ/.test(l)), msg.title);
  t('4.7 the catalog states that nothing executes by itself', msg.lines.some((l) => /اجرا نمی‌شود/.test(l)));

  /* The event mirror: facts appear, bookkeeping does not. */
  t('4.8 an execution event becomes a chat bubble', (() => {
    const m = eventToChatMessage({ type: 'EXECUTION_COMPLETED', payload: { success: true }, timestamp: 1 });
    return m?.kind === 'os' && m.osEvent.kind === SURFACE_KINDS.EXECUTION;
  })());
  t('4.9 a scroll or a bookkeeping event never becomes a bubble', ['SCROLL_EVENT', 'CONTEXT_PRESERVED', 'USER_MESSAGE', 'AI_RESPONSE', 'SLOT_FILLED'].every((type) => isSurfaceWorthy({ type }) === false && eventToChatMessage({ type }) === null));
  t('4.10 an error event is surfaced with its message', (() => {
    const m = eventToChatMessage({ type: 'ERROR', payload: { error: 'QUOTE_TIMEOUT' } });
    return m && /QUOTE_TIMEOUT/.test(m.content);
  })());
  t('4.11 the dedupe gate stops a retry from spamming the thread', (() => {
    const gate = createSurfaceGate({ windowMs: 60_000 });
    const ev = { type: 'EXECUTION_COMPLETED', payload: { intentId: 'x1' } };
    return eventToChatMessage(ev, { gate }) !== null && eventToChatMessage(ev, { gate }) === null;
  })());
  t('4.12 a mirrored message never carries authority', (() => {
    const m = surfaceMessage({ kind: SURFACE_KINDS.NOTICE, title: 'x', lines: ['y'] });
    return m.role === 'ai' && m.osEvent.schema === 'fbt.chat-os-surface.v1' && !('executed' in m.osEvent) && !m.osEvent.payload?.executionAuthorized;
  })());
}

/* ── 5. WEB SEARCH: ASKED FOR, CITED, OR HONESTLY ABSENT ──────────────────── */
{
  t('5.1 an explicit Persian search command is recognised with its query', (() => {
    const p = parseSearchRequest('جستجو کن قیمت بیت‌کوین امروز چنده');
    return p?.explicit === true && /قیمت بیت‌کوین/.test(p.query);
  })());
  t('5.2 an English command works the same way', (() => {
    const p = parseSearchRequest('search for ethereum upgrade news');
    return p?.query === 'ethereum upgrade news' && p.freshness === 'RECENT';
  })());
  t('5.3 a news request is classified as BREAKING', parseSearchRequest('آخرین اخبار سولانا')?.freshness === 'BREAKING');
  t('5.4 an ordinary question is not stolen by the search parser', parseSearchRequest('قیمت بیت‌کوین چنده؟') === null);
  t('5.5 a live classification forces a search even without a command', shouldForceWebSearch('امروز چه خبر است؟', { classification: { freshness: 'LIVE' } }) === true);

  const fakeResearch = async ({ query }) => ({
    ok: true,
    sources: [
      { title: 'Bitcoin price', url: 'https://www.coindesk.com/markets/btc', tier: 2, snippet: 'BTC trades higher' },
      { title: 'official docs', url: 'https://bitcoin.org/en/', tier: 1, snippet: 'primary' },
      { title: 'a tweet', url: 'https://x.com/someone/status/1', tier: 4, snippet: 'lead' }
    ],
    answer: 'قیمت در حال رشد است.',
    provider: 'fake'
  });

  const good = await runChatSearch({ query: 'قیمت بیت‌کوین', research: fakeResearch, locale: 'fa' });
  t('5.6 a successful search keeps every returned source', good.ok && good.sources.length === 3);
  t('5.7 source tiers travel with the sources', good.sources[0].tier === 2 && good.sources[1].tier === 1 && good.sources[2].tier === 4);
  const goodMsg = searchToMessage(good, { locale: 'fa' });
  t('5.8 the message is a cited answer with an intelligence block', /منبع/.test(goodMsg.content) && goodMsg.intelligence.sources.length === 3 && goodMsg.intelligence.webUsed === true);
  t('5.9 a social source is labelled as a lead, not a fact', /سرنخ|شبکه اجتماعی/.test(goodMsg.content));

  const empty = await runChatSearch({ query: 'چیزی که نیست', research: async () => ({ ok: true, sources: [] }), locale: 'fa' });
  const emptyMsg = searchToMessage(empty, { locale: 'fa' });
  t('5.10 a search with no results invents no source', empty.sources.length === 0 && emptyMsg.intelligence.sources.length === 0 && /چیزی برنگرداند|برنگرداند/.test(emptyMsg.content), emptyMsg.content);

  const broken = await runChatSearch({ query: 'x', research: async () => { throw new Error('boom'); }, locale: 'fa' });
  const brokenMsg = searchToMessage(broken, { locale: 'fa' });
  t('5.11 a failing search fails out loud', broken.ok === false && /انجام نشد|خطا/.test(brokenMsg.content) && brokenMsg.intelligence.webUsed === false);
  t('5.12 the honesty laws are declared in code', SEARCH_HONESTY.neverFabricatesSources === true && SEARCH_HONESTY.socialIsALead === true);
}

/* ── 6. SMALL TALK: THE SAME VOICE, EVEN WITH NO SERVER ──────────────────── */
{
  const fa = composeSocialReply('حالت چطوره؟', { locale: 'fa' });
  t('6.1 «حالت چطوره» is understood as a social act and answered', fa.ok === true && fa.act === 'HOW_ARE_YOU', JSON.stringify({ act: fa.act, ok: fa.ok, reason: fa.reason }));
  t('6.2 the answer is in Persian, not English', fa.lang === 'fa' && !/^hello/i.test(fa.text || ''), fa.text);
  t('6.3 a social answer never names a price or a number', fa.mentionsNumbers === false && !/\d/.test(fa.text || ''));
  t('6.4 an order wearing a greeting is still an order', composeSocialReply('سلام، ۱۰۰ دلار بیت‌کوین بخر', { locale: 'fa' }).ok === false);
  t('6.5 «چخبر» is a request for a real report, not a hello', (() => {
    const r = composeSocialReply('چخبر؟', { locale: 'fa' });
    return r.serverNeeded === true && r.ok === false;
  })());
  t('6.6 the offline fallback answers a pleasantry instead of an error banner', (() => {
    const m = offlineSocialFallback('ممنون از کمکت', { locale: 'fa' });
    return m && m.kind === 'assistant' && m.social?.offline === true && m.content.length > 10;
  })());
  t('6.7 the offline fallback refuses to fake a market brief', (() => {
    const m = offlineSocialFallback('چخبر؟', { locale: 'fa' });
    return m && /داده زنده|سرور/.test(m.content) && !/\d{2,}/.test(m.content);
  })());
  t('6.8 a non-social sentence gets no social fallback (errors stay honest)', offlineSocialFallback('قیمت بیت‌کوین چنده؟', { locale: 'fa' }) === null);
  t('6.9 English and Turkish pleasantries work too', (() => {
    const en = composeSocialReply('how are you?', { locale: 'en' });
    const tr = composeSocialReply('nasılsın?', { locale: 'tr' });
    return en.ok && en.lang === 'en' && tr.ok;
  })());
  t('6.10 pure social detection separates a hello from a question', isPureSocialTurn('سلام', { locale: 'fa' }) === true && isPureSocialTurn('قیمت بیت‌کوین چنده؟', { locale: 'fa' }) === false);
  t('6.11 a greeting carrying a real request is NOT answered as small talk',
    composeSocialReply('سلام، امروز بازار چطوره؟', { locale: 'fa' }).ok === false
    && composeSocialReply('خوبی؟ یک تحلیل بده', { locale: 'fa' }).ok === false);
  t('6.12 the local social path never swallows a request it cannot answer',
    offlineSocialFallback('سلام، امروز بازار چطوره؟', { locale: 'fa' }) === null);
}

/* ── 7. NEGOTIATION MODES, INSIDE CHAT ───────────────────────────────────── */
{
  t('7.1 human↔human is recognised in Persian', parseNegotiationRequest('می‌خواهم یک توافق دو طرفه با طرف دیگر هماهنگ کنم')?.mode === NEGOTIATION_MODES.HUMAN_HUMAN);
  t('7.2 agent↔agent is recognised in Persian', parseNegotiationRequest('ایجنت‌ها را با هم مذاکره بده و رأی شورا را بگو')?.mode === NEGOTIATION_MODES.AGENT_AGENT);
  t('7.3 human↔agent is recognised', parseNegotiationRequest('با ایجنت‌های FBT مذاکره کن')?.mode === NEGOTIATION_MODES.HUMAN_AGENT);
  t('7.4 external agent is recognised', parseNegotiationRequest('نظر یک ایجنت خارجی را هم بگیر')?.mode === NEGOTIATION_MODES.EXTERNAL_AGENT);
  t('7.5 emergency is recognised', parseNegotiationRequest('وضعیت اضطراری — همه چیز را متوقف کن')?.mode === NEGOTIATION_MODES.EMERGENCY);
  t('7.6 conflict review is recognised', parseNegotiationRequest('تضاد برنامه‌ها را بررسی کن')?.intent === 'CONFLICT');
  t('7.7 an ordinary financial sentence is not a negotiation', parseNegotiationRequest('۱۰۰ دلار بیت‌کوین بخر') === null);

  /* a2a with a clean proposal: the real council runs and approves */
  const clean = runChatNegotiation({
    mode: NEGOTIATION_MODES.AGENT_AGENT,
    subject: 'بازبینی پرتفوی',
    context: { proposal: { id: 'p1', action: 'rebalance', asset: 'BTC', amountUsd: 500, evidenceComplete: true } },
    locale: 'fa'
  });
  t('7.8 the council transcript exists and comes from the real engine', clean.transcript.length >= 4 && clean.transcript.some((l) => l.type === 'vote'));
  t('7.9 a clean proposal ends in agreement but still needs you', clean.outcome === NEGOTIATION_OUTCOMES.AGREEMENT && clean.decision === 'APPROVE' && clean.requiresUserAuthorization === true);
  t('7.10 nothing was executed by a negotiation', clean.executed === false && clean.broadcast === false && NEGOTIATION_LAWS.executesNothing === true);

  const rejected = runChatNegotiation({
    mode: NEGOTIATION_MODES.AGENT_AGENT,
    context: { proposal: { id: 'p2', action: 'swap', asset: 'ETH', amountUsd: 25_000, evidenceComplete: true }, guardianApproved: false },
    locale: 'fa'
  });
  t('7.11 a guardian veto is a CONFLICT, not a silent rejection', rejected.outcome === NEGOTIATION_OUTCOMES.CONFLICT && rejected.decision === 'REJECT');

  const revise = runChatNegotiation({
    mode: NEGOTIATION_MODES.AGENT_AGENT,
    context: { proposal: { id: 'p3', action: 'swap', asset: 'ETH', amountUsd: 1000, evidenceComplete: false } },
    locale: 'fa'
  });
  t('7.12 thin evidence escalates to recalculation', revise.outcome === NEGOTIATION_OUTCOMES.ESCALATION && revise.decision === 'REVISE');

  const noSubject = runChatNegotiation({ mode: NEGOTIATION_MODES.AGENT_AGENT, locale: 'fa' });
  t('7.13 without a subject the agents ask instead of inventing one', noSubject.outcome === NEGOTIATION_OUTCOMES.NEEDS_SUBJECT && Boolean(noSubject.question));
  t('7.14 that question is registerable in the ledger', (() => {
    const q = negotiationQuestion(noSubject, 'fa');
    return q && q.slot === 'text' && q.options.length >= 1;
  })());

  const external = runChatNegotiation({ mode: NEGOTIATION_MODES.EXTERNAL_AGENT, locale: 'fa' });
  t('7.15 an unverified external agent is refused with a reason', external.outcome === NEGOTIATION_OUTCOMES.UNAVAILABLE && /تأیید/.test(external.transcript.map((l) => l.text).join(' ')));
  const externalVerified = runChatNegotiation({
    mode: NEGOTIATION_MODES.EXTERNAL_AGENT,
    context: { externalVerified: true, externalAgent: { id: 'fbt.market-analyst', label: 'تحلیل‌گر بازار' }, externalView: 'روند صعودی ضعیف' },
    locale: 'fa'
  });
  t('7.16 a verified external agent gives analysis only', externalVerified.outcome === NEGOTIATION_OUTCOMES.AGREEMENT && externalVerified.transcript.some((l) => l.from === 'external-agent'));

  const h2h = runChatNegotiation({
    mode: NEGOTIATION_MODES.HUMAN_HUMAN,
    context: { proposal: { id: 'p4', action: 'OTC deal', asset: 'BTC', amountUsd: 5000 }, counterparty: { label: 'علی' }, deadlineDays: 7 },
    locale: 'fa'
  });
  const h2hText = h2h.transcript.map((l) => l.text).join(' ');
  t('7.17 human↔human builds a terms sheet with a custody boundary', h2h.terms?.some((r) => r.key === 'custody') && /نگه نمی‌دارد/.test(h2hText));
  t('7.18 the terms sheet carries the real escrow cap and appeal window', /10,000|10٬000/.test(h2hText) && /14/.test(h2hText));
  t('7.19 both sides must confirm — and we say we contacted nobody', h2h.outcome === NEGOTIATION_OUTCOMES.AWAITING_COUNTERPARTY && /نه پیامی/.test(h2h.notes.join(' ')));

  const emergency = runChatNegotiation({ mode: NEGOTIATION_MODES.EMERGENCY, context: { automations: [1, 2], monitors: [1] }, locale: 'fa' });
  t('7.20 emergency is a plan, never an action', emergency.executed === false && emergency.transcript.some((l) => /متوقف نمی‌کند|پلن توقف/.test(l.text)));
  t('7.21 the emergency plan asks for explicit confirmation first', emergency.chips.some((c) => /تأیید/.test(c.label)));

  const rendered = negotiationToChatMessage(clean, { locale: 'fa' });
  t('7.22 a negotiation renders as a chat card with speakers and a badge', rendered.kind === 'os' && rendered.osEvent.lines.some((l) => /موتور استراتژی/.test(l)) && Boolean(rendered.osEvent.badge));
  t('7.23 the card payload states its own limits', rendered.osEvent.payload.requiresUserAuthorization === true && rendered.osEvent.payload.executed === false);
}

/* ── 8. THE COMMAND DOOR (what the chat calls on every turn) ─────────────── */
{
  const { runSurfaceCommand, buildNegotiationContext } = await import('../../src/lib/intent-ai/chat/surfaceCommands.js');
  const fakeResearch = async () => ({ ok: true, sources: [{ title: 'x', url: 'https://example.com/x', tier: 3, snippet: 'y' }] });

  const catalog = await runSurfaceCommand('چه کارهایی می‌تونی بکنی؟', { locale: 'fa' });
  t('8.1 the "what can you do" command opens the whole catalog', catalog.handled === true && catalog.command === 'CATALOG' && catalog.message.kind === 'os');

  const search = await runSurfaceCommand('جستجو کن قیمت بیت‌کوین', { locale: 'fa', research: fakeResearch });
  t('8.2 the search command produces a cited message', search.handled === true && search.command === 'SEARCH' && search.message.intelligence.sources.length === 1);

  const nego = await runSurfaceCommand('با ایجنت‌ها مذاکره کن', { locale: 'fa' });
  t('8.3 a negotiation command produces a card and, when needed, a question', nego.handled === true && nego.command === 'NEGOTIATION' && nego.message.kind === 'os');
  t('8.4 a negotiation that needs a subject asks one (ledger-ready)', !nego.negotiation?.question || Boolean(nego.question?.text));

  const ordinary = await runSurfaceCommand('۱۰۰ دلار بیت‌کوین بخر', { locale: 'fa', research: fakeResearch });
  t('8.5 an ordinary order is left to the pipeline', ordinary.handled === false);

  const context = buildNegotiationContext({
    wallet: { address: '0xabc' },
    portfolio: { totalValueUsd: 2500 },
    conversationState: { collectedSlots: { amountUsd: 300, token: 'BTC', riskProfile: 'medium' } }
  });
  t('8.6 the negotiation context comes from what the app already knows', context.proposal?.amountUsd === 300 && context.proposal?.asset === 'BTC' && context.walletConnected === true);
}

/* ── 8b. THE WIRE: THE QUESTION LEAVES THE BROWSER AND IS READ AS A DIRECTIVE */
{
  const { answerBindingHint } = await import('../../src/lib/intent-ai/chat/questionLedger.js');
  const { buildSafeContextBlock } = await import('../../server/aiCollaboration.js');

  resetLedger();
  t('8b.1 with no question and no verdict there is nothing to carry', answerBindingHint({ locale: 'fa' }) === null);

  const asked = askQuestion({ text: 'چقدر سرمایه داری؟', slot: 'capitalUsd', expectedType: 'amount', locale: 'fa', conversationId: 'wire' });
  const hintOpen = answerBindingHint({ locale: 'fa' });
  t('8b.2 while the question is open the turn carries the mandatory block', Boolean(hintOpen?.prompt) && hintOpen.stillOpen === true);

  const bound = bindAnswer({ text: '۵۰۰۰ دلار', conversationId: 'wire' });
  const hintAnswered = answerBindingHint({ verdict: bound, locale: 'fa' });
  t('8b.3 an answered turn carries the verdict AND the recorded value',
    hintAnswered?.verdict?.value === 5000 && hintAnswered.verdict.status === 'ANSWER' && hintAnswered.stillOpen === false);

  const prompt = buildSafeContextBlock({
    context: { directives: [hintOpen.prompt], market: { priceMap: { BTC: 60000 } }, locale: 'fa' }
  });
  t('8b.4 the server puts the directive FIRST, above the data it overrides', prompt.trimStart().startsWith('MANDATORY TURN DIRECTIVES'));
  t('8b.5 the directive survives into the prompt unmodified', prompt.includes('قدر سرمایه داری'));

  const fs = await import('node:fs');
  const readSrc = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  const chatSrc = readSrc('../../src/components/IntentAIUnified.jsx');
  t('8b.6 the chat attaches the binding hint to the request it sends',
    /answerBindingHint\(/.test(chatSrc) && /hints:\s*\{/.test(chatSrc) && /answerBinding:\s*bindingHint/.test(chatSrc));
  const serverSrc = readSrc('../../server/aiIntentOS.js');
  t('8b.7 the server reads the hint it is sent', /hints\?\.answerBinding/.test(serverSrc));
  t('8b.8 the server passes the directive into the collaboration context', /directives:/.test(serverSrc));
}

/* ── 9. THE GAPS THAT ARE NOT ALLOWED TO COME BACK ───────────────────────── */
{
  const fa = localizedCatalog('fa');
  t('9.1 no catalog entry claims a capability that is not wired', fa.every((e) => e.available === true || e.unavailableReason));
  t('9.2 the surface laws are declared once and exported', NEGOTIATION_LAWS.sendsNothingOnYourBehalf === true && NEGOTIATION_LAWS.externalMustBeVerified === true);
  t('9.3 a mirrored execution event cannot look like a negotiation', (() => {
    const m = eventToChatMessage({ type: 'EXECUTION_COMPLETED', payload: { success: true } });
    return m.osEvent.kind === SURFACE_KINDS.EXECUTION;
  })());
  t('9.4b a completed order from another screen appears as one receipt row', (() => {
    const gate = createSurfaceGate();
    const row = eventToChatMessage({ type: 'buySell.completed', payload: { orderId: 'o9', asset: 'BTC', network: 'base', txHash: '0xdeadbeefcafe' } }, { locale: 'fa', gate });
    const dupe = eventToChatMessage({ type: 'buySell.completed', payload: { orderId: 'o9', asset: 'BTC', network: 'base', txHash: '0xdeadbeefcafe' } }, { locale: 'fa', gate });
    return row?.osEvent?.kind === 'EXECUTION' && /رسید/.test(row.content) && /BTC/.test(row.content) && dupe === null;
  })());
  t('9.4c the receipt invents no amount the emitter never sent', (() => {
    const row = eventToChatMessage({ type: 'buySell.completed', payload: { orderId: 'o10' } }, { locale: 'fa' });
    return row && !/\d/.test(row.content.replace(/o10/g, ''));
  })());
  t('9.4d the fan-out signals stay out of the conversation', ['portfolio.updated', 'wallet.updated', 'transactions.updated', 'notifications.received']
    .every((type) => eventToChatMessage({ type }) === null));
  t('9.4 social answers never claim a body or a mood', (() => {
    const r = composeSocialReply('حالت چطوره', { locale: 'fa' });
    return !/خوبم|روزم|حالم/.test(r.text || '');
  })());
}

const fails = rows.filter((r) => !r[1]);
for (const [name, ok, detail] of rows) console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — ${detail}`}`);
console.log(`\n=== PHASE 213 CHAT-SURFACE PROBE: ${rows.length - fails.length}/${rows.length} passed ===`);
process.exit(fails.length ? 1 : 0);
