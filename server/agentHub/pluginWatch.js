/**
 * ─── THE PLUGIN THAT SPEAKS FIRST ───────────────────────────────────────────
 * Until now a first-party plugin answered when it was asked and never otherwise:
 * `runNativeAgent` had no caller outside a chat turn, so the token risk scanner
 * that already reads GoPlus could not tell its own user that a honeypot flag had
 * appeared since yesterday. This module is the missing half — the plugin becomes
 * an alerter, on the wire the other alerters already use.
 *
 * It is deliberately the TWIN of `server/priceWatch.js`, and inherits its four
 * rules rather than inventing new ones:
 *
 *   1. A run that did not answer is silence, and it never moves the baseline.
 *      For a plugin "did not answer" is not only `ok:false`: it is also a
 *      verdict with `complete:false`, which is what an agent returns when a
 *      source the datum depends on was unread. Measured, not assumed — with no
 *      egress `token-risk-scanner` answers `ok:true, dataStatus:'partial'` and
 *      its lead reads «پرچم پرخطرِ قطعی دیده نشد». Arming THAT as a baseline
 *      would make the first real read look like a change in the token, when the
 *      only thing that changed was our own network. A notification about our
 *      egress, addressed to a user as a fact about their token, is a lie with a
 *      push sound.
 *   2. The first complete read arms the baseline and says nothing. Nobody asked
 *      to be told that the world is the way it already was.
 *   3. A baseline older than STALE_BASELINE_MS re-arms silently: comparing
 *      today's verdict with last month's is a statement about then.
 *   4. The baseline and the cooldown move only on a DELIVERED notice, so a
 *      failed push is retried by the next cycle instead of being swallowed.
 *
 * WHAT IS COMPARED IS A CODE, NEVER A SENTENCE. Each watchable plugin returns a
 * `verdict` (see `native/agents.js` → `verdictOf`): a level, a locale-independent
 * key and the number behind it. Prose cannot be diffed — the report footer stamps
 * the read time, so the same verdict reads differently a minute later, and a
 * wording change would become a notification about nothing. The key is built from
 * codes for the same reason: arming a watch in Persian and reading it back in
 * English must not look like the token changed.
 *
 * ─── WHY THE ROWS LIVE IN THE GLOBAL STORE, NOT IN AN FI COLLECTION ─────────
 * §5.24.15 put the owner's ATTACHMENT in `plugin_attachments`, a per-owner FI
 * collection, and that stays the authority on which plugin the user chose. A
 * cycle, though, has to enumerate every owner's watches in one pass to budget
 * its runs, and FI collections are keyed `fi:<collection>:v1:<owner>` — there is
 * no cross-owner read. So the rows live in the same global store the order and
 * price watchers use, and `storeDurable()` is reported rather than assumed: with
 * no BLOB_READ_WRITE_TOKEN this is a per-instance Map, which every response says.
 *
 * ─── THE BUDGET, MEASURED ───────────────────────────────────────────────────
 * One plugin run is a network read: 15-125 ms with no egress (it fails fast),
 * up to the 8 s attach budget when sources answer. `/api/cron/watch` is hit
 * every 20 minutes by `.github/workflows/order-watch-tick.yml` and once a day by
 * `/api/cron/daily`, and the whole API is ONE Vercel function with maxDuration
 * 60 shared with the order cycle and the price cycle. So a cycle runs at most
 * MAX_RUNS_PER_CYCLE plugins, each capped at PLUGIN_WATCH_RUN_TIMEOUT_MS: worst
 * case 12 s of a 60 s ceiling. It does NOT ride `/api/cron/tick` — that call is
 * made by a foreground tab, and adding seconds to it would charge the person
 * using the site for a background read. The datum decides the cadence: a
 * contract flag or a recorded incident is a six-hour fact, not a four-minute one.
 *
 * NOTHING HERE HAS EXECUTION AUTHORITY. A watch reads and announces. It cannot
 * sign, build or send a transaction, and the plugin rows it runs under still
 * carry `canExecute:false`.
 */

import { storeGet, storeSet, storeDurable } from '../store.js';
import { parseIdentity } from '../watch.js';
import { resolveTone, toneForVerdict } from '../../src/lib/notificationDesign.js';
import { attachEnabled, attachPluginAnswer, pluginCatalog } from './pluginAttach.js';
import { pluginAgentId, slugFromAgentId } from './pluginRegistry.js';

/* The owner's durable choice (§5.24.15) lives behind the CI bridge, and this
   module is imported statically by `app.js`, so the bridge is reached lazily: a
   static import would make the agent layer depend on the CI layer at boot and
   would pull the bridge into every process that merely serves a page. A cron
   that never runs should cost nothing, and a missing bridge must degrade to "no
   choice was stated" rather than to a crash. */
async function readOwnerChoice(owner) {
  try {
    const bridge = await import('../ci/pluginBridge.js');
    return typeof bridge.readAttachedPlugin === 'function' ? bridge.readAttachedPlugin(String(owner)) : null;
  } catch { return null; }
}

export const PLUGIN_WATCH_SCHEMA = 'fbt.agent-hub.plugin-watch.v1';
const WATCH_KEY = 'plugin:watch:v1';
const TICK_KEY = 'plugin:watch:lastTick';

/** `AI_PLUGIN_WATCH=false` stops the alerter and nothing else. An unset flag
 *  under NODE_ENV=test also means off, following `attachEnabled` and the
 *  repository's own convention: a cycle that ran for real would make outbound
 *  reads whose latency and failures no test controls. */
export const PLUGIN_WATCH_ENV = 'AI_PLUGIN_WATCH';

const truthy = (v) => !['0', 'false', 'off', 'no'].includes(String(v).trim().toLowerCase());

export function watchEnabled(env = process.env) {
  const raw = env?.[PLUGIN_WATCH_ENV];
  const flag = raw === undefined || raw === null ? '' : String(raw).trim();
  if (flag === '') return String(env?.NODE_ENV || '').trim().toLowerCase() !== 'test';
  return truthy(flag);
}

/* Cadence, caps and budgets — see the header for what each one protects. */
export const PLUGIN_WATCH_RUN_TIMEOUT_MS = Math.max(1000, Number(process.env.PLUGIN_WATCH_RUN_TIMEOUT_MS || 6000));
export const MAX_RUNS_PER_CYCLE = Math.max(1, Number(process.env.PLUGIN_WATCH_MAX_RUNS || 2));
export const MAX_PER_OWNER = 3;
export const MAX_TOTAL = 60;
export const MAX_AGE = 45 * 86400000;
/** A delivered notice is not repeated for 12 h: the same fact twice is noise,
 *  and noise teaches a user to swipe the next one away unread. */
export const COOLDOWN_MS = 12 * 3600000;
/** The verdict, not the price, decides how often a row is worth re-reading. */
export const RECHECK_MIN_MS = Math.max(60_000, Number(process.env.PLUGIN_WATCH_RECHECK_MIN_MS || 6 * 3600000));
export const STALE_BASELINE_MS = 7 * 24 * 3600000;
/** How many cycles a notice that could not be delivered is retried. Bounded,
 *  because a subscription whose app was uninstalled fails forever, and paying
 *  for a plugin read on every cycle to reach a dead device is not a retry
 *  policy — it is a leak. After the last attempt the baseline moves and the row
 *  records `DELIVERY_FAILED`, so the state is visible instead of silent. */
export const MAX_DELIVERY_ATTEMPTS = 3;
export const PLUGIN_WATCH_TICK_MIN_MS = Math.max(60_000, Number(process.env.PLUGIN_WATCH_TICK_MIN_MS || 240_000));

const BODY_MAX = 180;
const EVM_RE = /^0x[a-fA-F0-9]{40}$/;
const PROTOCOL_RE = /^[A-Za-z0-9][A-Za-z0-9 ._]{1,29}$/;

/* Levels a verdict may carry, in the words a user reads. `unknown` never gets
   here: the cycle refuses to announce a run that made no claim. */
const LEVEL_FA = Object.freeze({ danger: 'پرخطر', warn: 'هشدار', info: 'تغییر', clear: 'پاک' });
const LEVEL_EN = Object.freeze({ danger: 'high risk', warn: 'warning', info: 'changed', clear: 'clear' });
const UNIT = Object.freeze({
  flags: { fa: 'پرچم', en: 'flag(s)', digits: 0 },
  incidents: { fa: 'حادثه', en: 'incident(s)', digits: 0 },
  '%': { fa: '٪', en: '%', digits: 2 },
  usd: { fa: 'دلار', en: 'USD', digits: 0 }
});

/* -------------------------------------------------------------------------- */
/* store                                                                       */
/* -------------------------------------------------------------------------- */

export async function readPluginWatches() {
  const rows = await storeGet(WATCH_KEY, []);
  return Array.isArray(rows) ? rows.filter((r) => r && typeof r === 'object') : [];
}

async function writePluginWatches(rows) {
  await storeSet(WATCH_KEY, rows.slice(0, MAX_TOTAL));
}

/** Test seam, mirroring `clearWatches`. */
export async function clearPluginWatches() { await storeSet(WATCH_KEY, []); await storeSet(TICK_KEY, 0); }

const rowId = (row) => `${String(row.owner)}|${String(row.slug)}|${String(row.subject?.value || '')}`;

/* -------------------------------------------------------------------------- */
/* arming                                                                      */
/* -------------------------------------------------------------------------- */

const specOf = (row) => row?.watch || null;

/**
 * Which plugin a watch is for, in the order of authority §5.24.15 established:
 * an explicit `agentId` wins, otherwise the owner's own durable attachment — the
 * plugin they chose — decides. A plugin that exists but declares no watch is
 * refused as NOT WATCHABLE, which is a different fact from NOT IN CATALOG: the
 * first says "we cannot watch this", the second says "this is not ours".
 */
export async function resolveWatchTarget({ owner, agentId = null } = {}) {
  const catalog = await pluginCatalog().catch(() => []);
  let slug = agentId == null || String(agentId).trim() === '' ? null : slugFromAgentId(String(agentId).trim());
  let byChoice = false;
  if (!slug && owner) {
    const attached = await readOwnerChoice(owner);
    slug = attached?.slug || null;
    byChoice = Boolean(slug);
  }
  if (!slug) return { ok: false, code: agentId ? 'INVALID_AGENT_ID' : 'NO_PLUGIN_CHOICE' };
  const row = (catalog || []).find((a) => a && a.slug === slug);
  if (!row) return { ok: false, code: 'PLUGIN_NOT_IN_CATALOG', slug };
  if (!row.watch || !row.watch.subject || !row.watch.datum) return { ok: false, code: 'PLUGIN_NOT_WATCHABLE', slug };
  return { ok: true, slug, spec: row.watch, name: row.name, nameFa: row.nameFa || row.name, byChoice };
}

function normalizeSubject(spec, subject) {
  if (!subject || typeof subject !== 'object') return null;
  const kind = String(subject.kind || spec.subject);
  if (kind !== String(spec.subject)) return null;
  const value = String(subject.value || '').trim();
  if (!value) return null;
  if (kind === 'address') {
    if (!EVM_RE.test(value) && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return null;
    const chain = subject.chain === null || subject.chain === undefined || subject.chain === ''
      ? null : String(subject.chain).slice(0, 12);
    return { kind, value, chain };
  }
  if (kind === 'protocol') {
    if (!PROTOCOL_RE.test(value)) return null;
    return { kind, value, chain: null };
  }
  return null;
}

/**
 * Arm (or replace) one watch.
 *
 * Replace-by-subject, and the BASELINE SURVIVES a re-arm: a client that re-uploads
 * its rows must not reset the dedupe and manufacture a change, which is the same
 * rule `putPriceWatch` keeps for its baselines. Idempotency keys on the subject
 * the row holds, so arming the same token twice is one row, not two notices.
 */
export async function putPluginWatch({ owner, identity, agentId = null, subject = null, lang = 'fa', thresholdPct = null } = {}) {
  if (!watchEnabled()) return { ok: false, code: 'PLUGIN_WATCH_DISABLED' };
  const own = String(owner || '').trim();
  if (!own) return { ok: false, code: 'NO_OWNER' };
  if (!parseIdentity(identity)) return { ok: false, code: 'BAD_IDENTITY' };

  const target = await resolveWatchTarget({ owner: own, agentId });
  if (!target.ok) return { ok: false, code: target.code, slug: target.slug || null };

  const clean = normalizeSubject(target.spec, subject);
  if (!clean) return { ok: false, code: 'BAD_SUBJECT', slug: target.slug, wants: target.spec.subject };

  /* THE ROUND TRIP. The cycle re-runs a watch by rendering its subject back into
     a sentence and handing it to the plugin, so a subject that does not survive
     that trip would be re-read as something else — and a notice about a token
     the user never asked about, carrying a real number in the plugin's own
     name, is worse than no notice at all. Checked at arm time, where it can be
     refused, instead of at fire time, where it can only be wrong. */
  const { subjectToMessage, subjectRoundTrips, extractRequest } = await watchVocabulary();
  const message = subjectToMessage(clean, lang);
  if (!message) return { ok: false, code: 'SUBJECT_NOT_RENDERABLE', slug: target.slug };
  if (!subjectRoundTrips(clean, extractRequest(message))) {
    return { ok: false, code: 'SUBJECT_DOES_NOT_ROUND_TRIP', slug: target.slug, message };
  }

  const all = await readPluginWatches();
  const id = `${own}|${target.slug}|${clean.value}`;
  const previous = all.find((r) => rowId(r) === id) || null;
  const others = all.filter((r) => rowId(r) !== id);
  const mine = others.filter((r) => String(r.owner) === own);
  if (!previous && mine.length >= MAX_PER_OWNER) {
    return { ok: false, code: 'TOO_MANY_WATCHES', cap: MAX_PER_OWNER, watches: mine.length };
  }

  const bound = target.spec.thresholdPct;
  const wanted = Number(thresholdPct);
  const threshold = bound && Number.isFinite(wanted) && wanted > 0
    ? Math.min(bound.max, Math.max(bound.min, wanted))
    : (bound ? bound.default : null);

  const row = {
    id,
    owner: own,
    identity: String(identity),
    slug: target.slug,
    lang: String(lang || 'fa').slice(0, 5),
    subject: clean,
    message,
    datum: target.spec.datum,
    datumFa: target.spec.datumFa || target.spec.datum,
    datumEn: target.spec.datumEn || target.spec.datum,
    /* The notice is written from the row, not from the catalog, so the plugin's
       own names ride along: a card titled «token-risk-scanner · پرچم‌های ریسک
       قرارداد» would be one sentence in two languages. */
    name: String(target.name || target.slug),
    nameFa: String(target.nameFa || target.name || target.slug),
    fires: String(target.spec.fires || 'key'),
    thresholdPct: threshold,
    armedBy: target.byChoice ? 'owner-choice' : 'explicit',
    /* Server state, and it survives a re-arm. */
    baseline: previous?.baseline || null,
    lastRunAt: previous?.lastRunAt || null,
    lastNotifiedAt: previous?.lastNotifiedAt || null,
    lastSkip: previous?.lastSkip || null,
    at: Date.now()
  };
  await writePluginWatches([...others, row]);
  return { ok: true, watch: publicWatch(row), durable: storeDurable() };
}

/** The rows one owner armed. Another owner's rows are never readable here. */
export async function listPluginWatches({ owner } = {}) {
  const own = String(owner || '').trim();
  if (!own) return { ok: false, code: 'NO_OWNER' };
  const rows = (await readPluginWatches()).filter((r) => String(r.owner) === own);
  return { ok: true, watches: rows.map(publicWatch), durable: storeDurable() };
}

/** Idempotent: stopping a watch that is not armed is still a success. */
export async function stopPluginWatch({ owner, id = null, slug = null } = {}) {
  const own = String(owner || '').trim();
  if (!own) return { ok: false, code: 'NO_OWNER' };
  const all = await readPluginWatches();
  const wanted = String(id || '').trim();
  const keep = all.filter((r) => {
    if (String(r.owner) !== own) return true;
    if (wanted) return rowId(r) !== wanted && String(r.id) !== wanted;
    if (slug) return String(r.slug) !== String(slug);
    return false;
  });
  const removed = all.length - keep.length;
  if (removed) await writePluginWatches(keep);
  return { ok: true, removed, durable: storeDurable() };
}

/** What a user is shown: the subject and the state of the watch, never the
 *  identity that delivers it (a push endpoint is a credential). */
export function publicWatch(row) {
  const base = row?.baseline || null;
  return Object.freeze({
    id: String(row?.id || ''),
    slug: String(row?.slug || ''),
    subject: row?.subject ? Object.freeze({ ...row.subject }) : null,
    datum: String(row?.datum || ''),
    datumFa: String(row?.datumFa || row?.datum || ''),
    datumEn: String(row?.datumEn || row?.datum || ''),
    fires: String(row?.fires || 'key'),
    thresholdPct: Number.isFinite(Number(row?.thresholdPct)) ? Number(row.thresholdPct) : null,
    armedBy: String(row?.armedBy || 'explicit'),
    baseline: base ? Object.freeze({
      level: String(base.level || 'unknown'),
      key: base.key == null ? null : String(base.key),
      metric: Number.isFinite(Number(base.metric)) ? Number(base.metric) : null,
      unit: base.unit ? String(base.unit) : null,
      seen: Number.isFinite(Number(base.seen)) ? Number(base.seen) : null
    }) : null,
    armed: Boolean(base && base.key != null),
    lastRunAt: Number.isFinite(Number(row?.lastRunAt)) ? Number(row.lastRunAt) : null,
    lastNotifiedAt: Number.isFinite(Number(row?.lastNotifiedAt)) ? Number(row.lastNotifiedAt) : null,
    /* Real row state, not a stand-in for a missing engine: a notice that could
       not be delivered is waiting for the next cycle to try again. */
    retrying: row?.pendingRetry === true,
    /* Why the last cycle said nothing. A watch that can never be read completely
       has to be diagnosable from the outside instead of looking armed and mute. */
    lastSkip: row?.lastSkip ? String(row.lastSkip) : null,
    at: Number.isFinite(Number(row?.at)) ? Number(row.at) : null
  });
}

/* -------------------------------------------------------------------------- */
/* the notice                                                                  */
/* -------------------------------------------------------------------------- */

const fmt = (value, digits, lang) => {
  try {
    return new Intl.NumberFormat(String(lang || 'fa') === 'fa' ? 'fa-IR' : 'en-US', {
      minimumFractionDigits: digits, maximumFractionDigits: digits
    }).format(Number(value));
  } catch { return String(value); }
};

function metricPhrase(verdict, lang) {
  const unit = UNIT[String(verdict?.unit || '')] || null;
  const digits = unit ? unit.digits : 2;
  const value = fmt(verdict.metric, digits, lang);
  if (!unit) return `${value}`;
  return String(lang || 'fa') === 'fa' ? `${value} ${unit.fa}` : `${value} ${unit.en}`;
}

/** The subject in the words a user reads, not the raw value. */
function subjectPhrase(subject, lang) {
  const fa = String(lang || 'fa') === 'fa';
  const value = String(subject?.value || '');
  if (String(subject?.kind) === 'address') return fa ? `آدرس ${value.slice(0, 10)}…` : `address ${value.slice(0, 10)}…`;
  return fa ? `پروتکل ${value}` : `protocol ${value}`;
}

/**
 * One notice, one idea, one number — and the plugin's own caveat if it has one.
 *
 * The caveat is fitted BEFORE the body is cut, not after: a 180-character body
 * that drops «نبودِ رکورد، اثباتِ نبودِ حادثه نیست» publishes the fact and loses
 * the limit of the fact, which is the defect that cost a honeypot report its
 * meaning in §5.24.14. So when both do not fit, the metric clause goes and the
 * caveat stays. The tone comes from the verdict's own level, so the card's
 * colour is decided by the plugin that made the claim.
 */
export function buildPluginWatchAlert({ slug = '', name = '', nameFa = '', datum = '', datumFa = '', datumEn = '', subject = null, verdict = null, previous = null, reason = 'key', movePct = null, lang = 'fa' }) {
  const fa = String(lang || 'fa').split('-')[0] === 'fa';
  const L = fa ? 'fa' : 'en';
  const plugin = String(fa ? (nameFa || name) : (name || slug) || '').slice(0, 40);
  /* The datum is named in the reader's own language. The fallback is the machine
     slug and NOT the other language: a Persian phrase on an English card is one
     sentence in two languages, which is worse than an identifier. */
  const datumText = String(fa ? (datumFa || datum) : (datumEn || datum) || '').slice(0, 40);
  const level = String(verdict?.level || 'info');
  /* The plugin's own claim decides the colour of the card that announces it. */
  const tone = toneForVerdict(level);
  const levels = fa ? LEVEL_FA : LEVEL_EN;
  const nowLevel = levels[level] || level;
  const wasLevel = previous && levels[String(previous.level)] ? levels[String(previous.level)] : null;
  const where = subjectPhrase(subject, L);
  const unit = UNIT[String(verdict?.unit || '')] || null;
  const digits = unit ? unit.digits : 2;
  const unitWord = unit ? (fa ? unit.fa : unit.en) : '';

  /* ONE IDEA: what changed. A metric move with no finite move to quote falls back
     to the level sentence rather than printing «NaN٪» — a number that is really
     an absence must never reach a lock screen.

     THE SENTENCE OWNS THE DIRECTION. A percentage on its own says nothing about
     which way a rate went, so the verb carries it («بالا رفت» / «پایین آمد») and
     the number is quoted unsigned. Every clause ends in a full stop, because the
     caveat is appended after it and two sentences with no mark between them read
     as one claim about the plugin's own limit. */
  const metricMove = reason === 'metric' && Number.isFinite(Number(movePct));
  const hasBothMetrics = Number.isFinite(Number(verdict?.metric)) && Number.isFinite(Number(previous?.metric));
  const from = hasBothMetrics ? fmt(previous.metric, digits, L) : null;
  const to = hasBothMetrics ? fmt(verdict.metric, digits, L) : null;
  const unitSuffix = hasBothMetrics && unitWord ? ` ${unitWord}` : '';

  let shortNews;
  if (metricMove) {
    const up = Number(movePct) >= 0;
    const move = fmt(Math.abs(Number(movePct)), 1, L);
    shortNews = hasBothMetrics
      ? (fa
        ? `${where}: ${datumText} از ${from}${unitSuffix} به ${to}${unitSuffix} ${up ? 'بالا رفت' : 'پایین آمد'} (${move}٪).`
        : `${where}: ${datumText} ${up ? 'rose' : 'fell'} from ${from}${unitSuffix} to ${to}${unitSuffix} (${move}%).`)
      : (fa
        ? `${where}: ${datumText} ${move}٪ ${up ? 'بالا رفت' : 'پایین آمد'}.`
        : `${where}: ${datumText} moved ${move}% ${up ? 'up' : 'down'}.`);
  } else {
    shortNews = fa
      ? `${where}: وضعیت از «${wasLevel || 'نامشخص'}» به «${nowLevel}» تغییر کرد.`
      : `${where}: ${datumText} went from ${wasLevel || 'unknown'} to ${nowLevel}.`;
  }

  /* The numbers that make a level change concrete, appended only as long as the
     plugin's own caveat still fits — see the fitting rule below. */
  let news = shortNews;
  if (!metricMove && hasBothMetrics) {
    news = fa
      ? `${shortNews} ${from} \u2190 ${to}${unitSuffix}.`
      : `${shortNews} (${from} \u2192 ${to}${unitSuffix}).`;
  }

  /* THE CAVEAT IS FITTED BEFORE THE BODY IS CUT, never after. A 180-character
     body that drops «نبودِ رکورد، اثباتِ نبودِ حادثه نیست» publishes the fact and
     loses the limit of the fact — the same defect that cost a honeypot report
     its meaning in §5.24.14. So when both do not fit, the metric clause goes and
     the caveat stays. */
  const caveat = String((fa ? verdict?.noteFa : verdict?.noteEn) || '').trim();
  let body = news.trim();
  if (caveat) {
    body = `${body} ${caveat}`.length <= BODY_MAX
      ? `${body} ${caveat}`
      : `${shortNews.trim()} ${caveat}`.slice(0, BODY_MAX);
  }

  return {
    title: `${plugin} · ${datumText}`.slice(0, 64),
    body: body.slice(0, BODY_MAX),
    /* The brain, where the plugin that made this claim can be asked again. The
       app is a HashRouter, so a bare path would open nothing. */
    url: '/#/intent',
    tag: `fbt-plugin-${String(subject?.value || datum || 'watch').slice(0, 40)}`,
    tone,
    stage: tone === 'alert' ? 'alert' : 'info',
    value: Number.isFinite(Number(verdict?.metric)) ? fmt(verdict.metric, digits, L).slice(0, 14) : '',
    label: datumText.slice(0, 24),
    kicker: plugin.slice(0, 24),
    lang: L,
    /* A high-risk verdict is the one card that should not slide away in four
       seconds while the phone is face-down; a rate move should not pin itself. */
    requireInteraction: level === 'danger',
    data: {
      schema: PLUGIN_WATCH_SCHEMA,
      slug: String(slug || ''),
      level,
      reason: metricMove ? 'metric' : 'key',
      subject: subject ? String(subject.value || '').slice(0, 64) : '',
      /* Whether the plugin's own limit made it into the body — a card that had
         to drop it should be diagnosable from the payload, not guessed at. */
      caveat: Boolean(caveat)
    }
  };
}

/* -------------------------------------------------------------------------- */
/* the cycle                                                                   */
/* -------------------------------------------------------------------------- */

/** The watch vocabulary lives beside the catalog that declares it, and is loaded
 *  lazily: `app.js` imports this module statically, and the 1 400-line agent
 *  module must not be pulled into boot for a cron that may never run. */
let vocab = null;
async function watchVocabulary() {
  if (vocab) return vocab;
  const agents = await import('./native/agents.js');
  const data = await import('./native/data.js');
  vocab = {
    subjectToMessage: agents.subjectToMessage,
    subjectRoundTrips: agents.subjectRoundTrips,
    extractRequest: data.extractRequest
  };
  return vocab;
}
/** Test seam. */
export function resetPluginWatchCache() { vocab = null; }

/** Run one watch. The plugin is chosen BY ID, so the sentence only carries the
 *  subject and can never change which plugin answers. */
async function defaultRun(row) {
  return attachPluginAnswer({
    message: String(row.message || ''),
    locale: String(row.lang || 'fa'),
    owner: String(row.owner || ''),
    timeoutMs: PLUGIN_WATCH_RUN_TIMEOUT_MS,
    agentId: pluginAgentId(String(row.slug))
  });
}

function isDue(row, now) {
  if (Number.isFinite(Number(row.lastNotifiedAt)) && now - Number(row.lastNotifiedAt) < COOLDOWN_MS) return false;
  /* A notice that could not be delivered is due on the NEXT cycle, not on the
     next recheck window. The fact is already known and the phone was the only
     thing that failed, so making it wait six hours would be a second failure the
     user cannot see. */
  if (row.pendingRetry === true) return true;
  if (Number.isFinite(Number(row.lastRunAt)) && now - Number(row.lastRunAt) < RECHECK_MIN_MS) return false;
  return true;
}

/**
 * One cycle. Pure enough to test with an injected `run`, bounded enough to ride
 * a shared 60-second function, and silent by construction: every path that does
 * not deliver a notice says why in its counters.
 */
export async function runPluginWatchCycle(send, now = Date.now(), deps = {}) {
  if (!watchEnabled(deps.env || process.env)) {
    return { checked: 0, ran: 0, fired: 0, delivered: 0, skipped: 'PLUGIN_WATCH_DISABLED', durable: storeDurable() };
  }
  if (!attachEnabled(deps.env || process.env)) {
    /* The watch runs THROUGH the attach, so an off attach is not a reason to
       report zero checks as though nothing were armed. */
    return { checked: 0, ran: 0, fired: 0, delivered: 0, skipped: 'PLUGIN_ATTACH_DISABLED', durable: storeDurable() };
  }
  const rows = await (deps.read || readPluginWatches)();
  const live = rows.filter((r) => now - (Number(r.at) || 0) < MAX_AGE);
  let changed = live.length !== rows.length;
  if (!live.length) {
    if (changed) await (deps.write || writePluginWatches)(live);
    return { checked: 0, ran: 0, fired: 0, delivered: 0, incomplete: 0, due: 0, durable: storeDurable() };
  }

  const due = live.filter((r) => isDue(r, now)).sort((a, b) => (Number(a.lastRunAt) || 0) - (Number(b.lastRunAt) || 0));
  const run = deps.run || defaultRun;
  const next = new Map(live.map((r) => [rowId(r), r]));
  let ran = 0;
  let fired = 0;
  let delivered = 0;
  let incomplete = 0;

  for (const row of due) {
    if (ran >= MAX_RUNS_PER_CYCLE) break;
    ran += 1;
    const current = next.get(rowId(row)) || row;
    let out = null;
    try { out = await run(current, now); } catch (err) { out = { ok: false, code: 'PLUGIN_RUN_THREW', detail: String(err?.message || err).slice(0, 120) }; }
    current.lastRunAt = now;
    changed = true;

    const verdict = out && out.ok === true ? out.verdict : null;
    /* GUARD 1 — silence is never a trigger and never a baseline. */
    if (!verdict || verdict.complete !== true || String(verdict.level) === 'unknown' || verdict.key == null) {
      incomplete += 1;
      current.lastSkip = String(out?.code || (verdict ? 'INCOMPLETE_READ' : 'NO_VERDICT'));
      next.set(rowId(current), current);
      continue;
    }
    current.lastSkip = null;
    const spec = { fires: String(current.fires || 'key'), thresholdPct: Number(current.thresholdPct) };
    const mayKey = spec.fires.includes('key');
    const mayMetric = spec.fires.includes('metric') && Number.isFinite(spec.thresholdPct) && spec.thresholdPct > 0;

    /* GUARD 2 — the first complete read arms the baseline and says nothing. */
    const base = current.baseline;
    if (!base || base.key == null) {
      current.baseline = { key: String(verdict.key), level: String(verdict.level), metric: verdict.metric, unit: verdict.unit, seen: now };
      next.set(rowId(current), current);
      continue;
    }
    /* GUARD 3 — a stale baseline re-arms silently. */
    if (Number.isFinite(Number(base.seen)) && now - Number(base.seen) > STALE_BASELINE_MS) {
      current.baseline = { key: String(verdict.key), level: String(verdict.level), metric: verdict.metric, unit: verdict.unit, seen: now };
      next.set(rowId(current), current);
      continue;
    }

    const keyChanged = mayKey && String(verdict.key) !== String(base.key);
    const prevMetric = Number(base.metric);
    const curMetric = Number(verdict.metric);
    const movePct = mayMetric && Number.isFinite(prevMetric) && Number.isFinite(curMetric) && prevMetric !== 0
      ? ((curMetric - prevMetric) / Math.abs(prevMetric)) * 100
      : null;
    const metricCrossed = movePct != null && Math.abs(movePct) >= spec.thresholdPct;
    if (!keyChanged && !metricCrossed) {
      current.baseline = { ...base, metric: Number.isFinite(curMetric) ? curMetric : base.metric, seen: now };
      next.set(rowId(current), current);
      continue;
    }

    fired += 1;
    const alert = buildPluginWatchAlert({
      slug: current.slug,
      name: current.name || current.slug,
      nameFa: current.nameFa || current.name || current.slug,
      datum: current.datum,
      datumFa: current.datumFa,
      datumEn: current.datumEn,
      subject: current.subject,
      verdict: { ...verdict, slug: current.slug },
      previous: base,
      reason: keyChanged ? 'key' : 'metric',
      movePct,
      lang: current.lang
    });
    let ok = false;
    try { ok = await send(current.identity, alert); } catch { ok = false; }
    /* GUARD 4 — the baseline and the cooldown move only on a DELIVERED notice. */
    if (ok === true) {
      delivered += 1;
      current.baseline = { key: String(verdict.key), level: String(verdict.level), metric: verdict.metric, unit: verdict.unit, seen: now };
      current.lastNotifiedAt = now;
      current.pendingRetry = false;
      current.retryAttempts = 0;
    } else {
      /* The OLD baseline stays, so the same change is still a change next cycle. */
      current.baseline = { ...base, seen: now };
      current.retryAttempts = (Number(current.retryAttempts) || 0) + 1;
      if (current.retryAttempts >= MAX_DELIVERY_ATTEMPTS) {
        current.baseline = { key: String(verdict.key), level: String(verdict.level), metric: verdict.metric, unit: verdict.unit, seen: now };
        current.lastSkip = 'DELIVERY_FAILED';
        current.pendingRetry = false;
        current.retryAttempts = 0;
      } else {
        current.pendingRetry = true;
      }
    }
    next.set(rowId(current), current);
  }

  if (changed) await (deps.write || writePluginWatches)([...next.values()]);
  return {
    checked: live.length,
    due: due.length,
    ran,
    fired,
    delivered,
    incomplete,
    /* What the cap left for the next cycle — the honest half of a bounded run. */
    remainingDue: Math.max(0, due.length - ran),
    durable: storeDurable()
  };
}

/* -------------------------------------------------------------------------- */
/* tick + status                                                               */
/* -------------------------------------------------------------------------- */

let lastTickAt = 0;

export async function pluginWatchTickStatus() {
  const stored = Number(await storeGet(TICK_KEY, 0)) || 0;
  const last = Math.max(stored, lastTickAt);
  return { lastTickAt: last || null, minIntervalMs: PLUGIN_WATCH_TICK_MIN_MS };
}

/** Throttled entry point, mirroring `maybePriceWatchTick`. */
export async function maybePluginWatchTick({ send, now = Date.now(), force = false, deps = {} } = {}) {
  if (typeof send !== 'function') return { skipped: 'NO_SENDER' };
  const { lastTickAt: last } = await pluginWatchTickStatus();
  const since = last ? now - last : Infinity;
  if (!force && since < PLUGIN_WATCH_TICK_MIN_MS) return { skipped: 'THROTTLED', sinceMs: since };
  lastTickAt = now;
  await storeSet(TICK_KEY, now);
  const out = await runPluginWatchCycle(send, now, deps);
  return { ...out, sinceMs: Number.isFinite(since) ? since : null };
}

/**
 * The counters that answer «چرا نوتیفیکیشن نمیاد؟» for this alerter: how many
 * rows exist, how many are armed, how many could never be read completely, and
 * what the cap makes one row's real cadence. A status that reports the mechanism
 * as `Boolean(engine)` would be the same darkness in costume.
 */
export async function pluginWatchStatus() {
  const rows = await readPluginWatches();
  const owners = new Set(rows.map((r) => String(r.owner)));
  const armed = rows.filter((r) => r.baseline && r.baseline.key != null).length;
  const neverRead = rows.filter((r) => !r.baseline || r.baseline.key == null).length;
  const skips = rows.map((r) => r.lastSkip).filter(Boolean);
  return {
    enabled: watchEnabled(),
    attachEnabled: attachEnabled(),
    rows: rows.length,
    owners: owners.size,
    armed,
    neverRead,
    capPerOwner: MAX_PER_OWNER,
    capTotal: MAX_TOTAL,
    runsPerCycle: MAX_RUNS_PER_CYCLE,
    runTimeoutMs: PLUGIN_WATCH_RUN_TIMEOUT_MS,
    recheckMinMs: RECHECK_MIN_MS,
    cooldownMs: COOLDOWN_MS,
    /* With every row due and the cap binding, this is how long one row waits. */
    worstCaseRecheckMs: Math.max(RECHECK_MIN_MS, Math.ceil(rows.length / MAX_RUNS_PER_CYCLE) * PLUGIN_WATCH_TICK_MIN_MS),
    lastSkips: skips.slice(0, 5),
    durable: storeDurable()
  };
}

export default runPluginWatchCycle;
