/**
 * FBT INTENT AI — TAUGHT MEMORY (Phase 205)
 * ---------------------------------------------------------------------------
 * Reported as: «نبود ارتباط با سیستم آموزش» — the AI had an internal
 * learning loop (adaptiveMemory.js, server/learning/) but no way for the
 * USER to teach it anything, and nothing it was taught ever came back.
 *
 * This module is the teach side of that bridge, with the same hard rules the
 * rest of the memory stack already obeys:
 *
 *   · teaching is EXPLICIT — «یادت باشد…» / "remember…" / "علّمني…" only;
 *     nothing a user types in a normal request is ever memorized
 *   · bounded — 50 entries, 240 characters each, oldest dropped first
 *   · secret-free — the same credential screen the chat uses runs first
 *   · local-only — localStorage (fbt.intent.taught.v1), never a server
 *   · revocable — the user can list and clear everything at any time
 *
 * And what is taught is APPLIED: a taught chain becomes the default chain of
 * later requests in the same session (see the panel's sendText).
 */

export const TAUGHT_MEMORY_SCHEMA = 'fbt.taught-memory.v1';
export const TAUGHT_MAX_ENTRIES = 50;
export const TAUGHT_MAX_TEXT = 240;
const TAUGHT_KEY = 'fbt.intent.taught.v1';

/** Same shape of credential test the chat uses — a taught secret is refused. */
const RAW_CREDENTIAL_TEXT = /(-----BEGIN[^-]*PRIVATE KEY-----|\b(?:0x)?[a-f0-9]{64}\b|\b(?:seed phrase|recovery phrase|mnemonic|private key|master password|raw secret|پنج‌عبارت|عبارت بازیابی|کلید خصوصی|کلید مخفی)\b)/i;

/** Teach command markers, per language family. Nothing else is memorized. */
const TEACH_MARKERS = Object.freeze([
  'remember:', 'remember that', 'note that', 'teach:',
  'یادت باشد', 'یادت باشه', 'یادت باشد که', 'به من یاد بده که', 'یادت نره',
  'تذكر:', 'اعرف أن', 'hatırla:', 'запомни:', '记住', 'याद रखो', 'یاد رکھو', 'ingat:', 'recuerda:', 'lembra:', 'retiens:'
]);

/** Recall command markers — «چه چیزی یادت هست؟» and friends. */
const RECALL_MARKERS = Object.freeze([
  'what do you remember', 'what did i teach you', 'your memory', 'what have you learned',
  'چه چیزی یادت هست', 'چه چیزهایی یادت هست', 'چی یادت هست', 'یادت چی هست', 'چی یادت گرفته‌ای', 'یادت کجاست',
  'ماذا تتذكر', 'ماذا تعلمت', 'hatırladığın ne', 'что ты помнишь', '你记住了什么', 'तुम्हें क्या याद है', 'آپ کو کیا یاد ہے', 'apa yang kau ingat', 'qué recuerdas', 'o que você lembra', 'qu’est-ce que tu retiens'
]);

const FORGET_MARKERS = Object.freeze([
  'forget everything', 'clear your memory', 'clear memory', 'forget it all',
  'همه چیز یادت بره', 'همه‌چیز یادت بره', 'حافظه‌ات پاک', 'یادت پاک', 'همه یادت بره',
  'انسَ كل شيء', 'her şeyi unut', 'забудь всё', '全部忘记', 'सब भूल जाओ', 'سب بھول جاؤ', 'lupakan semuanya', 'olvida todo', 'esquece tudo', 'oublie tout'
]);

const safeId = () => `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

function readStore() {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(TAUGHT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((e) => e && typeof e.text === 'string') : [];
  } catch {
    return [];
  }
}

function writeStore(entries) {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(TAUGHT_KEY, JSON.stringify(entries.slice(0, TAUGHT_MAX_ENTRIES)));
    return true;
  } catch {
    return false;
  }
}

const lower = (text) => String(text || '').toLowerCase().trim();

/** Detect a teach command and extract what to remember. */
export function parseTeachCommand(text) {
  const raw = String(text || '').trim();
  if (!raw) return { ok: false, code: 'EMPTY' };
  const lowered = lower(raw);
  const marker = TEACH_MARKERS.find((m) => lowered.startsWith(lower(m)) || lowered.includes(` ${m}`));
  if (!marker) return { ok: false, code: 'NOT_A_TEACH_COMMAND' };
  let body = raw;
  const idx = lowered.indexOf(lower(marker));
  if (idx >= 0) body = raw.slice(idx + marker.length).replace(/^[\s:،,]+/, '').trim();
  if (!body) return { ok: false, code: 'EMPTY' };
  if (RAW_CREDENTIAL_TEXT.test(body)) return { ok: false, code: 'SECRET_REFUSED' };
  if (body.length > TAUGHT_MAX_TEXT) body = `${body.slice(0, TAUGHT_MAX_TEXT - 1)}…`;
  return {
    ok: true,
    schema: TAUGHT_MEMORY_SCHEMA,
    text: body,
    tag: detectTag(body)
  };
}

/** Detect a recall (list) or forget (clear) request. */
export function parseMemoryCommand(text) {
  const lowered = lower(text);
  if (FORGET_MARKERS.some((m) => lowered.includes(m))) return { ok: true, command: 'forget' };
  if (RECALL_MARKERS.some((m) => lowered.includes(m))) return { ok: true, command: 'recall' };
  return { ok: false, command: null };
}

/** A light classification so the UI can show WHAT kind of thing was learned. */
function detectTag(body) {
  const s = lower(body);
  if (/(risk|ریسک|مخاطره|مخاطر)/.test(s)) return 'risk-appetite';
  if (/(chain|شبکه|زنجیره|network|arbitrum|پالیگان|polygon|base|bsc|bnb|ethereum|اتریوم|آربیتروم|بیس)/.test(s)) return 'preferred-chain';
  if (/(asset|دارایی|توکن|token|btc|eth|usdc|usdt|bnb|sol)/.test(s)) return 'assets';
  return 'preferences';
}

/* Known chain ids for the taught-default-chain application. */
const CHAIN_HINTS = [
  { re: /arbitrum|آربیتروم|أربيتروم|арбитрум|arb/i, chainId: 42161 },
  { re: /base|بیس/i, chainId: 8453 },
  { re: /polygon|پالیگان|بوليجون|полигон/i, chainId: 137 },
  { re: /\bbsc\b|\bbnb chain\b|بایننس/i, chainId: 56 },
  { re: /optimism|اپتیمیزم|op mainnet/i, chainId: 10 },
  { re: /avalanche|آوالانچ/i, chainId: 43114 },
  { re: /linea/i, chainId: 59144 }
];

/** The chain a taught entry hints at, or null — used as a session default. */
export function taughtChainHint(entry) {
  if (!entry?.text) return null;
  const hit = CHAIN_HINTS.find((hint) => hint.re.test(entry.text));
  return hit ? hit.chainId : null;
}

/** Store one taught entry. */
export function rememberTaught(entry) {
  if (!entry?.text) return { ok: false, code: 'EMPTY' };
  if (RAW_CREDENTIAL_TEXT.test(entry.text)) return { ok: false, code: 'SECRET_REFUSED' };
  const entries = readStore();
  const record = {
    schema: TAUGHT_MEMORY_SCHEMA,
    id: safeId(),
    text: String(entry.text).slice(0, TAUGHT_MAX_TEXT),
    tag: entry.tag || detectTag(entry.text),
    createdAt: Date.now()
  };
  const next = [record, ...entries].slice(0, TAUGHT_MAX_ENTRIES);
  const written = writeStore(next);
  return { ok: written, entry: written ? record : null, total: next.length };
}

/** Everything the AI was taught, newest first. */
export function listTaught() {
  return readStore();
}

/** Clear everything taught. */
export function clearTaught() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(TAUGHT_KEY);
  } catch { /* nothing to do */ }
  return { ok: true, cleared: true };
}

/** A compact summary for the UI: counts by tag + the taught chain default. */
export function taughtSummary() {
  const entries = readStore();
  const tags = {};
  for (const entry of entries) tags[entry.tag] = (tags[entry.tag] || 0) + 1;
  const chainEntry = entries.find((e) => taughtChainHint(e) != null) || null;
  return {
    schema: TAUGHT_MEMORY_SCHEMA,
    total: entries.length,
    max: TAUGHT_MAX_ENTRIES,
    tags,
    defaultChainId: chainEntry ? taughtChainHint(chainEntry) : null,
    localOnly: true,
    secretFree: true
  };
}
