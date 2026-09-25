/**
 * FBT INTENT OS — PHASE 213: THE INTENT OS SURFACE BRIDGE
 * ---------------------------------------------------------------------------
 * The complaint this module exists to answer:
 *
 *   «وقتی اپشنی هست باید هماهنگ شود؛ هر چیزی داخل Intent OS باید در چت بیاید»
 *
 * Intent OS had 80 catalog cards, 15 categories, 13 agents, a council, an
 * escalation ladder, escrow, disputes and monitors — and the chat could only
 * talk about what a user happened to type. Everything else happened in panels,
 * or not visibly at all. This bridge is the single place that decides:
 *
 *   1. WHAT of Intent OS is askable in chat  → SURFACE_CATALOG (derived from
 *      the real Operations catalog, so a new card cannot exist only in a panel)
 *   2. WHAT of Intent OS appears in chat as it happens → eventToChatMessage()
 *      for real OS events, with a noise filter and a dedupe gate
 *   3. HOW it looks when it gets there → surfaceMessage(), one shape the chat
 *      already knows how to render (`kind: 'os'` + `osEvent`)
 *
 * Laws:
 *   · A mirrored event is a FACT, never an instruction. Nothing here signs,
 *     broadcasts, approves or unlocks anything; execution authority is
 *     untouched (§67 of the Upgrade-5 spec).
 *   · Noise stays out. Scroll events, context-preservation bookkeeping and the
 *     user's own messages are not "Intent OS appearing in chat".
 *   · One event, one bubble: the dedupe gate fingerprints the event so a
 *     retry/re-render cannot spam the same row.
 *   · Unavailable is said out loud. A catalog entry carries `available:false`
 *     and the reason; it is never rendered as a working button.
 */

import { CATEGORIES, OPERATIONS } from '../os/opsCatalog.js';
import { localizeOpsCard, localizeOpsCategory } from '../os/opsCatalogI18n.js';

export const SURFACE_SCHEMA = 'fbt.chat-os-surface.v1';
export const SURFACE_MESSAGE_KIND = 'os';

export const SURFACE_KINDS = Object.freeze({
  CATALOG: 'CATALOG',
  NEGOTIATION: 'NEGOTIATION',
  AGREEMENT: 'AGREEMENT',
  CONFLICT: 'CONFLICT',
  ESCALATION: 'ESCALATION',
  EMERGENCY: 'EMERGENCY',
  AGENT: 'AGENT',
  MONITOR: 'MONITOR',
  ORDER: 'ORDER',
  EXECUTION: 'EXECUTION',
  WALLET: 'WALLET',
  MEMORY: 'MEMORY',
  SEARCH: 'SEARCH',
  QUESTION: 'QUESTION',
  NOTICE: 'NOTICE'
});

/**
 * The coordination modes Intent OS offers. «انسان↔انسان» is here because the
 * app coordinates two humans through a terms sheet + two confirmations; it is
 * NOT a claim that FBT opened a chat with another person.
 */
export const COORDINATION_MODES = Object.freeze([
  {
    id: 'human-human',
    label: { fa: 'انسان ↔ انسان', en: 'Human ↔ Human', ar: 'إنسان ↔ إنسان' },
    desc: {
      fa: 'توافق بین دو نفر با FBT به‌عنوان هماهنگ‌کننده: برگه شرایط + تأیید هر دو طرف. نه پیامی از طرف تو فرستاده می‌شود و نه چیزی خودکار توافق می‌شود.',
      en: 'An agreement between two people with FBT as the coordinator: a terms sheet plus both confirmations. Nothing is sent on your behalf and nothing auto-agrees.'
    },
    chatPrompt: { fa: 'می‌خواهم یک توافق انسان به انسان را با FBT هماهنگ کنم', en: 'I want to coordinate a human-to-human agreement with FBT' },
    requires: 'both-confirmations'
  },
  {
    id: 'human-agent',
    label: { fa: 'انسان ↔ ایجنت', en: 'Human ↔ Agent', ar: 'إنسان ↔ وكيل' },
    desc: {
      fa: 'تو با ایجنت‌های FBT مذاکره می‌کنی: ایجنت گزینه‌ها را با سقف‌های واقعی سیاست می‌آورد و انتخاب نهایی مال توست.',
      en: 'You negotiate with FBT agents: the agent brings options constrained by the real policy caps and the final choice is yours.'
    },
    chatPrompt: { fa: 'با ایجنت‌های FBT مذاکره کن و گزینه‌هایت را بگو', en: 'Negotiate with the FBT agents and show me your options' },
    requires: 'user-choice'
  },
  {
    id: 'agent-agent',
    label: { fa: 'ایجنت ↔ ایجنت', en: 'Agent ↔ Agent', ar: 'وكيل ↔ وكيل' },
    desc: {
      fa: 'استراتژی، اجرا، ریسک و نگهبان با هم مذاکره می‌کنند؛ تو رونوشت واقعی و رأی شورا را می‌بینی. مذاکره هرگز اجازه اجرا نمی‌دهد.',
      en: 'Strategy, execution, risk and guardian negotiate; you see the real transcript and the council vote. A negotiation never grants execution.'
    },
    chatPrompt: { fa: 'ایجنت‌ها را با هم مذاکره بده و رأی شورا را نشان بده', en: 'Have the agents negotiate and show me the council vote' },
    requires: 'council'
  },
  {
    id: 'fbt-external-agent',
    label: { fa: 'هوش FBT ↔ ایجنت خارجی', en: 'FBT AI ↔ External agent', ar: 'ذكاء FBT ↔ وكيل خارجي' },
    desc: {
      fa: 'نظر دوم از ایجنت خارجیِ تأییدشده؛ فقط تحلیل. پیام‌های بدون امضا رد می‌شوند و هیچ ایجنت خارجی اجرا نمی‌کند.',
      en: 'A second opinion from a verified external agent — analysis only. Unsigned messages are rejected and no external agent executes.'
    },
    chatPrompt: { fa: 'نظر یک ایجنت خارجی را هم بگیر', en: 'Get an external agent second opinion too' },
    requires: 'verified-external'
  },
  {
    id: 'emergency',
    label: { fa: 'اضطرار / توقف', en: 'Emergency / stop', ar: 'الطوارئ / إيقاف' },
    desc: {
      fa: 'مسیر اضطراری: پلن توقف (توقف خودکارسازی‌ها و قفل اجرای خودکار) ساخته می‌شود و فقط با تأیید صریح تو اجرا می‌شود.',
      en: 'The emergency path: a stop plan (halt automations, lock autonomous execution) is prepared and runs only after your explicit confirmation.'
    },
    chatPrompt: { fa: 'وضعیت اضطراری — همه‌چیز را متوقف کن', en: 'Emergency — stop everything' },
    requires: 'explicit-confirmation'
  }
]);

/* -------------------------------------------------------------------------- */
/*  THE CATALOG — everything Intent OS can do, reachable from chat             */
/* -------------------------------------------------------------------------- */

/** Short, chat-shaped description of a whole domain, used by the catalog card. */
const CATEGORY_PROMPTS = Object.freeze({
  portfolio: { fa: 'پرتفوی من را تحلیل کن', en: 'analyze my portfolio' },
  wallet: { fa: 'کیف پول من را تحلیل کن', en: 'analyze my wallet' },
  swap: { fa: 'یک سواپ برایم قیمت بگیر', en: 'quote a swap for me' },
  bridge: { fa: 'یک بریج برایم قیمت بگیر', en: 'quote a bridge for me' },
  lending: { fa: 'بازارهای وام را تحلیل کن', en: 'analyze the lending markets' },
  farm: { fa: 'فارم‌های فعال را نشان بده', en: 'show live farms' },
  liquidity: { fa: 'استخرهای نقدینگی را تحلیل کن', en: 'analyze liquidity pools' },
  futures: { fa: 'بازارهای فیوچرز را تحلیل کن', en: 'analyze the futures markets' },
  dydx: { fa: 'بازارهای dYdX را نشان بده', en: 'show dYdX markets' },
  markets: { fa: 'بازارهای جهانی را تحلیل کن', en: 'analyze global markets' },
  intelligence: { fa: 'هوشمندی بازار را نشان بده', en: 'show market intelligence' },
  goals: { fa: 'هدف‌های مالی من را نشان بده', en: 'show my financial goals' },
  automation: { fa: 'خودکارسازی‌های من را نشان بده', en: 'show my automations' },
  monitoring: { fa: 'پایش‌های فعال من را نشان بده', en: 'show my active monitors' },
  rewards: { fa: 'پاداش‌های من را نشان بده', en: 'show my rewards' }
});

function langKey(locale) {
  const l = String(locale || 'fa').toLowerCase();
  if (l.startsWith('fa')) return 'fa';
  if (l.startsWith('ar')) return 'ar';
  return 'en';
}

function pick(entry, locale) {
  if (!entry) return null;
  const key = langKey(locale);
  return entry[key] || entry.en || entry.fa || null;
}

/**
 * The list the chat can offer and answer. Categories come from the live
 * Operations catalog (single source of truth), coordination modes come from
 * COORDINATION_MODES, and every entry carries the exact sentence that reaches
 * the same capability from chat.
 */
export const SURFACE_CATALOG = Object.freeze([
  ...COORDINATION_MODES.map((mode) => Object.freeze({
    id: `coord_${mode.id}`,
    kind: mode.id === 'emergency' ? SURFACE_KINDS.EMERGENCY : SURFACE_KINDS.NEGOTIATION,
    coordinationMode: mode.id,
    icon: mode.id === 'emergency' ? '🛑' : '🤝',
    title: mode.label,
    desc: mode.desc,
    chatPrompt: mode.chatPrompt,
    available: true,
    requires: mode.requires,
    route: null
  })),
  ...CATEGORIES.map((category) => Object.freeze({
    id: `domain_${category.id}`,
    kind: SURFACE_KINDS.CATALOG,
    domain: category.id,
    icon: category.icon,
    title: localizeOpsCategory(category, 'fa').title
      ? { fa: localizeOpsCategory(category, 'fa').title, en: category.title }
      : { fa: category.title, en: category.title },
    desc: { fa: `${localizeOpsCategory(category, 'fa').title} — همهٔ عملیات واقعی این بخش از چت قابل پرسیدن است.`, en: `${category.title} — every real operation in this domain is askable from chat.` },
    chatPrompt: CATEGORY_PROMPTS[category.id] || null,
    available: true,
    route: null
  }))
]);

export function surfaceCatalogEntry(id) {
  return SURFACE_CATALOG.find((entry) => entry.id === id) || null;
}

export function localizedCatalog(locale = 'fa') {
  return SURFACE_CATALOG.map((entry) => ({
    ...entry,
    title: pick(entry.title, locale) || entry.id,
    desc: pick(entry.desc, locale) || '',
    chatPrompt: pick(entry.chatPrompt, locale) || null
  }));
}

/** How many real Operations cards sit behind each domain entry — the honest
 *  answer to "is this a full option or a stub?". */
export function domainCoverage(domain) {
  const cards = OPERATIONS.filter((card) => card.category === domain);
  return {
    domain,
    cards: cards.length,
    chatable: cards.filter((card) => ['read', 'quote', 'opportunity', 'monitor', 'order'].includes(card.action)).length,
    routes: [...new Set(cards.map((card) => card.route).filter(Boolean))]
  };
}

/** The catalog as a chat message: categories with real card counts, plus the
 *  coordination modes. This is what "everything in Intent OS" looks like when
 *  the user asks what the assistant can do. */
export function catalogMessage({ locale = 'fa', onOpenRoute = null } = {}) {
  const fa = langKey(locale) === 'fa';
  const ar = langKey(locale) === 'ar';
  const entries = localizedCatalog(locale);
  const coordination = entries.filter((e) => e.coordinationMode);
  const domains = entries.filter((e) => e.domain);
  const lines = [];
  lines.push(fa
    ? 'این‌ها همهٔ چیزهایی است که Intent OS می‌تواند انجام دهد — همه از همین چت قابل پرسیدن است:'
    : ar
      ? 'هذه كل ما يستطيع Intent OS فعله — وكلها قابلة للسؤال من هذه المحادثة:'
      : 'Everything Intent OS can do is askable from this chat:');
  lines.push('');
  lines.push(fa ? 'هماهنگی و توافق:' : 'Coordination:');
  for (const entry of coordination) {
    lines.push(`• ${entry.icon} ${entry.title} — ${entry.chatPrompt}`);
  }
  lines.push('');
  lines.push(fa ? 'دامنه‌های عملیاتی:' : 'Operational domains:');
  for (const entry of domains) {
    const coverage = domainCoverage(entry.domain);
    lines.push(`• ${entry.icon} ${entry.title} (${coverage.cards} ${fa ? 'عملیات' : 'operations'}) — ${entry.chatPrompt}`);
  }
  lines.push('');
  lines.push(fa
    ? 'هیچ‌کدام از این‌ها خودکار اجرا نمی‌شود؛ هر اجرای مالی به تأیید و امضای خودت می‌رسد.'
    : 'None of this executes on its own; every financial action still needs your confirmation and signature.');
  const prompts = entries.filter((e) => e.chatPrompt).map((e) => ({ id: e.id, label: e.chatPrompt, prompt: e.chatPrompt }));
  return {
    ok: true,
    kind: SURFACE_KINDS.CATALOG,
    title: fa ? 'همهٔ گزینه‌های Intent OS' : 'Every Intent OS option',
    lines,
    entries,
    chips: prompts.slice(0, 8),
    onOpenRoute
  };
}

/* -------------------------------------------------------------------------- */
/*  MESSAGE FACTORY                                                            */
/* -------------------------------------------------------------------------- */

export function surfaceMessage({
  kind = SURFACE_KINDS.NOTICE,
  title = null,
  lines = [],
  chips = [],
  actions = [],
  badge = null,
  tone = null,
  payload = null,
  id = null,
  at = Date.now()
} = {}) {
  const text = [title, ...(Array.isArray(lines) ? lines : [lines])].filter(Boolean).join('\n');
  return {
    id: id || `os_${at.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    role: 'ai',
    kind: SURFACE_MESSAGE_KIND,
    content: text,
    ui: { type: 'TEXT' },
    osEvent: {
      schema: SURFACE_SCHEMA,
      kind,
      title,
      lines: Array.isArray(lines) ? lines : [lines],
      chips: (chips || []).slice(0, 8),
      badge,
      tone,
      payload: payload || null,
      at
    },
    actions: (actions || []).filter((a) => a && a.route)
  };
}

/* -------------------------------------------------------------------------- */
/*  EVENT MIRROR — what actually gets to appear in the chat                    */
/* -------------------------------------------------------------------------- */

/** Events that are bookkeeping, not information for the user. */
export const SURFACE_NOISE = Object.freeze([
  'SCROLL_EVENT', 'CONTEXT_PRESERVED', 'CONTEXT_LOST', 'USER_MESSAGE', 'AI_RESPONSE',
  'SHORT_ANSWER_RESOLVED', 'REFERENCE_RESOLVED', 'CONFIDENCE_EVALUATED',
  'NAVIGATION_STARTED', 'NAVIGATION_COMPLETED', 'SLOT_FILLED', 'QUESTION_ASKED',
  'ANSWER_RECEIVED', 'INTENT_CREATED', 'INTENT_UPDATED', 'WALLET_CHANGED',
  'REPETITION_PREVENTED', 'NAVIGATION_LOOP_DETECTED',
  /* A completed order is a RECEIPT, not noise: it becomes one chat row. The
     fan-out signals it fires (portfolio.updated, wallet.updated, …) stay out —
     they redraw screens, they do not tell the user anything new. */
  'portfolio.updated', 'wallet.updated', 'transactions.updated', 'risk.updated',
  'goals.updated', 'notifications.received', 'intent.updated', 'navigation.opened'
]);

const EVENT_COPY = Object.freeze({
  INTENT_COMPLETED: {
    fa: () => 'درخواست کامل شد.',
    en: () => 'The request completed.'
  },
  INTENT_FAILED: {
    fa: (p) => `درخواست ناموفق بود${p?.error ? ` (${String(p.error).slice(0, 80)})` : ''}.`,
    en: (p) => `The request failed${p?.error ? ` (${String(p.error).slice(0, 80)})` : ''}.`
  },
  EXECUTION_STARTED: {
    fa: () => 'اجرای تأییدشده شروع شد.',
    en: () => 'A confirmed execution started.'
  },
  EXECUTION_COMPLETED: {
    fa: (p) => (p?.success === false ? 'اجرا ناموفق بود.' : 'اجرا انجام شد.'),
    en: (p) => (p?.success === false ? 'The execution failed.' : 'The execution completed.')
  },
  AGENT_STARTED: {
    fa: (p) => `ایجنت‌ها شروع کردند${p?.agentsUsed?.length ? ` (${p.agentsUsed.join(', ')})` : ''}.`,
    en: (p) => `Agents started${p?.agentsUsed?.length ? ` (${p.agentsUsed.join(', ')})` : ''}.`
  },
  AGENT_COMPLETED: {
    fa: (p) => `ایجنت‌ها تمام کردند${p?.agentsUsed?.length ? ` (${p.agentsUsed.join(', ')})` : ''}.`,
    en: (p) => `Agents finished${p?.agentsUsed?.length ? ` (${p.agentsUsed.join(', ')})` : ''}.`
  },
  ERROR: {
    fa: (p) => `خطا${p?.error ? `: ${String(p.error).slice(0, 100)}` : ''}.`,
    en: (p) => `Error${p?.error ? `: ${String(p.error).slice(0, 100)}` : ''}.`
  },
  RECOVERY: {
    fa: (p) => `بازیابی${p?.strategy?.action ? `: ${String(p.strategy.action).slice(0, 60)}` : ''}.`,
    en: (p) => `Recovery${p?.strategy?.action ? `: ${String(p.strategy.action).slice(0, 60)}` : ''}.`
  },
  WALLET_CONNECTED: {
    fa: () => 'کیف پول وصل شد.',
    en: () => 'Wallet connected.'
  },
  WALLET_DISCONNECTED: {
    fa: () => 'کیف پول جدا شد.',
    en: () => 'Wallet disconnected.'
  },
  /* Receipts: money moved in another screen, and the conversation keeps the
     record. The text says what the payload really contains — it never invents
     an amount the emitter did not send. */
  'buySell.completed': {
    fa: (p) => `رسید: سفارش${p?.asset ? ` ${p.asset}` : ''} تکمیل شد${p?.network ? ` (${p.network})` : ''}${p?.txHash ? ` — ${String(p.txHash).slice(0, 12)}…` : ''}.`,
    en: (p) => `Receipt: the${p?.asset ? ` ${p.asset}` : ''} order completed${p?.network ? ` (${p.network})` : ''}${p?.txHash ? ` — ${String(p.txHash).slice(0, 12)}…` : ''}.`
  },
  'iranBuy.confirmed': {
    fa: (p) => `رسید: خرید ریالی${p?.asset ? ` ${p.asset}` : ''} تأیید شد${p?.txHash ? ` — ${String(p.txHash).slice(0, 12)}…` : ''}.`,
    en: (p) => `Receipt: the IRR purchase${p?.asset ? ` of ${p.asset}` : ''} was confirmed${p?.txHash ? ` — ${String(p.txHash).slice(0, 12)}…` : ''}.`
  }
});

const KIND_BY_EVENT = Object.freeze({
  INTENT_COMPLETED: SURFACE_KINDS.NOTICE,
  INTENT_FAILED: SURFACE_KINDS.NOTICE,
  EXECUTION_STARTED: SURFACE_KINDS.EXECUTION,
  EXECUTION_COMPLETED: SURFACE_KINDS.EXECUTION,
  AGENT_STARTED: SURFACE_KINDS.AGENT,
  AGENT_COMPLETED: SURFACE_KINDS.AGENT,
  ERROR: SURFACE_KINDS.NOTICE,
  RECOVERY: SURFACE_KINDS.NOTICE,
  WALLET_CONNECTED: SURFACE_KINDS.WALLET,
  WALLET_DISCONNECTED: SURFACE_KINDS.WALLET,
  'buySell.completed': SURFACE_KINDS.EXECUTION,
  'iranBuy.confirmed': SURFACE_KINDS.EXECUTION
});

/** Should this event become a chat bubble at all? */
export function isSurfaceWorthy(event) {
  const type = String(event?.type || '');
  if (!type) return false;
  if (SURFACE_NOISE.includes(type)) return false;
  /* Negotiation/escalation objects carry their own kind and are always
     surfaced: they are answers to something the user asked. */
  if (event?.surfaceKind) return true;
  return Object.prototype.hasOwnProperty.call(EVENT_COPY, type);
}

function eventFingerprint(event) {
  const type = String(event?.type || event?.surfaceKind || 'event');
  const payload = event?.payload || event?.detail || {};
  const bits = [
    type,
    payload?.intentId || '',
    payload?.agentsUsed ? String(payload.agentsUsed).slice(0, 80) : '',
    payload?.error || '',
    payload?.strategy?.action || '',
    payload?.orderId || payload?.txHash || ''
  ];
  return bits.join('|').slice(0, 200);
}

/**
 * Dedupe gate: the same event (identical fingerprint) is allowed once inside
 * `windowMs`. Prevents a re-render or a retry from stacking twenty identical
 * rows in a conversation, without hiding genuinely repeated events over time.
 */
export function createSurfaceGate({ windowMs = 90_000, max = 60 } = {}) {
  const seen = new Map();
  return {
    allow(event) {
      const fp = eventFingerprint(event);
      const now = Date.now();
      const last = seen.get(fp);
      if (last != null && now - last < windowMs) return false;
      seen.set(fp, now);
      if (seen.size > max) {
        const oldest = [...seen.entries()].sort((a, b) => a[1] - b[1])[0];
        if (oldest) seen.delete(oldest[0]);
      }
      return true;
    },
    reset() { seen.clear(); },
    size() { return seen.size; }
  };
}

/**
 * Turn a real OS event into a chat message. Returns null when the event is
 * noise — the caller appends only what this returns.
 */
export function eventToChatMessage(event, { locale = 'fa', gate = null } = {}) {
  if (!isSurfaceWorthy(event)) return null;
  if (gate && !gate.allow(event)) return null;
  const payload = event?.payload || event?.detail || {};
  const type = String(event.type || event.surfaceKind);
  const fa = langKey(locale) === 'fa';
  /* Explicit negotiation/escalation surfaces carry ready-made lines. */
  if (event.surfaceKind) {
    return surfaceMessage({
      kind: event.surfaceKind,
      title: event.title || null,
      lines: event.lines || [],
      chips: event.chips || [],
      actions: event.actions || [],
      badge: event.badge || null,
      tone: event.tone || null,
      payload,
      at: event.at || Date.now()
    });
  }
  const copy = EVENT_COPY[type];
  if (!copy) return null;
  const line = fa ? copy.fa(payload) : copy.en(payload);
  return surfaceMessage({
    kind: KIND_BY_EVENT[type] || SURFACE_KINDS.NOTICE,
    title: null,
    lines: [line],
    payload: { eventType: type, ...payload },
    at: event.timestamp || event.at || Date.now()
  });
}

/**
 * «چه کارهایی می‌توانی بکنی؟» / «همه گزینه‌ها را نشان بده» — the request that
 * used to be answered with a generic paragraph now answers with the real
 * catalog (every domain + every coordination mode + the sentence that reaches
 * each one from chat).
 */
const CATALOG_RE = /(?:چه\s*کار(?:ها|هایی|ی)|چی\s*کار\s*می\s*تونی|چیکار\s*می\s*تونی|چه\s*قابلیت|قابلیت\s*های|همه\s*گزینه|گزینه\s*های|همه\s*امکانات|لیست\s*امکانات|چیا\s*داری|what\s*can\s*you\s*do|all\s*options|your\s*capabilities|list\s*(?:your\s*)?(?:features|options|capabilities))/i;

export function parseCatalogRequest(text) {
  const raw = String(text || '').trim();
  if (!raw || raw.length > 120) return null;
  return CATALOG_RE.test(raw) ? { ok: true, kind: SURFACE_KINDS.CATALOG } : null;
}

export const SURFACE_INFO = Object.freeze({
  schema: SURFACE_SCHEMA,
  messageKind: SURFACE_MESSAGE_KIND,
  catalogSize: SURFACE_CATALOG.length,
  coordinationModes: COORDINATION_MODES.map((m) => m.id)
});
