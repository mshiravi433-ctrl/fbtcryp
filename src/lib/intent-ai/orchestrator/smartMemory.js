/**
 * FBT AI — SMART LONG-TERM SEMANTIC MEMORY ENGINE (Section 3A)
 * ---------------------------------------------------------------------------
 * Operational, Qdrant-backed (with embedded vector mirror + durable KV snapshot)
 * long-term semantic memory system supporting all 8 required capabilities:
 *
 *   1. User Conversation Recall (`rememberConversation`, `recallConversations`)
 *   2. User Goals & Preferences (`setGoal`, `setPreference`, `extractUserTraits`, `getUserProfile`)
 *   3. Past Decisions Recall (`rememberDecision`, `recallDecisions`)
 *   4. Semantic Search Across Historical Data (`semanticSearch`)
 *   5. Dedicated Private Memory per Agent (`rememberAgentPrivate`, `recallAgentPrivate`)
 *   6. Controlled Shared Memory Across Agents (`publishSharedMemory`, `readSharedMemory` with ACL + evidence gate + TTL)
 *   7. Successful & Unsuccessful Experiences (`recordExperience`, `recallExperiences`)
 *   8. Timely Contextual Retrieval (`contextualRecall`)
 *
 * Safety & Governance Laws:
 *   • Strict owner isolation (`owner` mandatory on every read/write).
 *   • Strict secret refusal (`containsSensitiveKeyOrPhrase` + `redactSecrets`).
 *   • Provenance hierarchy (`USER_SAID > USER_PREFERRED > OBSERVED_BEHAVIOR > AI_INFERRED`):
 *     AI inferences can NEVER overwrite explicit user-stated preferences.
 *   • Private agent memory enforces `agentId` isolation; shared agent memory
 *     enforces `allowedReaders` ACL, TTL expiry, and `verificationStatus`.
 */

import { createVectorStore, tokenize } from './vectorStore.js';
import { clipDeep, containsSensitiveKeyOrPhrase, redactSecrets } from './redact.js';

export const SMART_MEMORY_SCHEMA = 'fbt.smart-memory.v1';

export const SMART_COLLECTIONS = Object.freeze({
  user: 'fbt_smart_user_memory',
  agentPrivate: 'fbt_smart_agent_private',
  agentShared: 'fbt_smart_agent_shared'
});

export const PROVENANCE_RANK = Object.freeze({
  AI_INFERRED: 1,
  OBSERVED_BEHAVIOR: 2,
  USER_PREFERRED: 3,
  USER_SAID: 4
});

export const MEMORY_TYPES = Object.freeze({
  CONVERSATION: 'conversation',
  GOAL: 'goal',
  PREFERENCE: 'preference',
  DECISION: 'decision',
  EXPERIENCE: 'experience'
});

const HALF_LIFE_MS = 14 * 24 * 3600 * 1000; // 14-day soft recency boost

function cleanStr(v, max = 900) {
  const s = String(redactSecrets(String(v ?? ''))).trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function lexicalOverlap(queryTokens, docText) {
  if (!queryTokens.length || !docText) return 0;
  const docTokens = new Set(tokenize(docText));
  if (!docTokens.size) return 0;
  let hits = 0;
  for (const qt of queryTokens) if (docTokens.has(qt)) hits += 1;
  return hits / Math.max(1, Math.min(queryTokens.length, 12));
}

function recencyBoost(atMs, nowMs) {
  const age = Math.max(0, nowMs - Number(atMs || 0));
  return Math.exp(-Math.LN2 * (age / HALF_LIFE_MS));
}

/**
 * Extract explicit user financial goals & preferences from natural Persian or
 * English conversation turns (deterministic, zero-hallucination pattern parser).
 */
export function extractUserTraitsFromMessage(rawMessage = '') {
  const msg = String(rawMessage || '').trim();
  if (!msg || containsSensitiveKeyOrPhrase(msg)) return { goals: [], preferences: [] };
  const norm = msg
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  const lower = norm.toLowerCase();

  const preferences = [];
  const goals = [];

  // Risk tolerance detection
  if (/(ریسک[\s\u200c]*(?:کم|پایین|گریز)|محافظه[\s\u200c]*کار|کم[\s\u200c]*خطر|حفظ\s*(?:اصل\s*)?سرمایه|low[\s-]*risk|risk[\s-]*averse|conservative|capital\s*preservation)/i.test(norm)) {
    preferences.push({ key: 'riskTolerance', value: 'CONSERVATIVE', provenance: 'USER_SAID', note: cleanStr(msg, 220) });
  } else if (/(ریسک[\s\u200c]*متوسط|متعادل|moderate[\s-]*risk|balanced\s*risk)/i.test(norm)) {
    preferences.push({ key: 'riskTolerance', value: 'MODERATE', provenance: 'USER_SAID', note: cleanStr(msg, 220) });
  } else if (/(ریسک[\s\u200c]*(?:بالا|زیاد)|تهاجمی|پرریسک|high[\s-]*risk|aggressive)/i.test(norm) && !/(نمی|بدون|پرهیز|متنفر|no\s+high|avoid)/i.test(norm)) {
    preferences.push({ key: 'riskTolerance', value: 'AGGRESSIVE', provenance: 'USER_SAID', note: cleanStr(msg, 220) });
  }

  // Leverage constraint detection
  if (/(بدون\s*(?:اهرم|لوریج|مارجین)|هرگز.*(?:اهرم|لوریج|فیوچرز)|از\s*(?:اهرم|لوریج).*(?:استفاده\s*نمی|متنفر|پرهیز)|فقط\s*اسپات|no\s*leverage|never\s*(?:use\s*)?leverage|avoid\s*(?:leverage|margin|futures)|spot\s*only)/i.test(norm)) {
    preferences.push({ key: 'leveragePolicy', value: 'NO_LEVERAGE_SPOT_ONLY', provenance: 'USER_SAID', note: cleanStr(msg, 220) });
  }

  // Strategy style preference
  if (/(خرید\s*پله[\s\u200c]*ای|دی[\s\u200c]*سی[\s\u200c]*ای|\bdca\b|dollar[\s-]*cost)/i.test(norm)) {
    preferences.push({ key: 'strategyStyle', value: 'DCA_STAGED', provenance: 'USER_PREFERRED', note: cleanStr(msg, 220) });
  }

  // Preferred networks / chains
  const chainMatches = [];
  for (const [chain, re] of [
    ['Ethereum', /(?:شبکه\s*اتریوم|\bethereum\b|\ mainnet\b)/i],
    ['Arbitrum', /(?:آربیتروم|\barbitrum\b)/i],
    ['Base', /(?:شبکه\s*بیس|\bbase\s+chain\b|\bon\s+base\b)/i],
    ['Solana', /(?:شبکه\s*سولانا|\bsolana\b)/i],
    ['Polygon', /(?:پالیگان|\bpolygon\b)/i],
    ['Optimism', /(?:اپتیمیزم|\boptimism\b)/i]
  ]) {
    if (re.test(norm) && /(ترجیح|علاقه|دوست\s*دارم|فقط\s*روی|prefer|favorite|mainly\s*on)/i.test(norm)) {
      chainMatches.push(chain);
    }
  }
  if (chainMatches.length) {
    preferences.push({ key: 'preferredChains', value: chainMatches, provenance: 'USER_PREFERRED', note: cleanStr(msg, 220) });
  }

  // Explicit financial goal detection
  if (/(هدف(?:م|\s*من)?|می[\s\u200c]*خواهم.*پس[\s\u200c]*انداز|برنامه[\s\u200c]*ام\s*رسیدن\s*به|my\s+goal\s+is|target\s+is\s+to\s+(?:save|reach|grow)|saving\s+for)/i.test(norm)) {
    let targetUsd = null;
    const usdMatch = lower.match(/\$\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(k|هزار)?/) || lower.match(/([0-9][0-9,]*(?:\.[0-9]+)?)\s*(هزار\s*)?(?:دلار|usd|usdt)/);
    if (usdMatch) {
      const baseNum = Number(String(usdMatch[1]).replace(/,/g, ''));
      const mult = usdMatch[2] ? 1000 : 1;
      if (Number.isFinite(baseNum) && baseNum > 0) targetUsd = baseNum * mult;
    }
    let horizonMonths = null;
    const monthMatch = lower.match(/([0-9]+)\s*(?:ماه|month)/);
    const yearMatch = lower.match(/([0-9]+)\s*(?:سال|year)/);
    if (monthMatch) horizonMonths = Number(monthMatch[1]);
    else if (yearMatch) horizonMonths = Number(yearMatch[1]) * 12;

    goals.push({
      title: cleanStr(msg, 180),
      targetUsd,
      horizonMonths,
      provenance: 'USER_SAID'
    });
  }

  return { goals, preferences };
}

/**
 * Create the Long-Term Semantic Memory Engine.
 */
export function createSmartMemory({
  vector = null,
  persist = null, // optional { load: async () => snap, save: async (snap) => void }
  maxUserRecordsPerOwner = 300,
  maxAgentRecordsPerAgent = 120,
  defaultSharedTtlMs = 6 * 3600 * 1000,
  minVerifiedConfidence = 0.55,
  now = () => Date.now()
} = {}) {
  const store = vector || createVectorStore();
  let seq = 0;
  let initialized = false;
  let persistLoaded = false;

  // Fast structured caches synced with vector store for O(1) profile reads
  // Map<owner, { goals: Map<goalId, obj>, preferences: Map<key, obj> }>
  const profileIndex = new Map();

  const metrics = {
    conversationsStored: 0,
    goalsStored: 0,
    preferencesStored: 0,
    decisionsStored: 0,
    experiencesStored: 0,
    agentPrivateWrites: 0,
    agentSharedPublishes: 0,
    semanticSearches: 0,
    contextualRecalls: 0,
    aclBlocks: 0,
    provenanceProtections: 0
  };

  function ensureOwnerProfile(owner) {
    let p = profileIndex.get(owner);
    if (!p) {
      p = { goals: new Map(), preferences: new Map() };
      profileIndex.set(owner, p);
    }
    return p;
  }

  async function ensureInitialized() {
    if (!initialized) {
      await Promise.all([
        store.createCollection(SMART_COLLECTIONS.user, {}),
        store.createCollection(SMART_COLLECTIONS.agentPrivate, {}),
        store.createCollection(SMART_COLLECTIONS.agentShared, {})
      ]);
      initialized = true;
    }
    if (persist && !persistLoaded) {
      persistLoaded = true;
      try {
        const snap = await persist.load?.();
        if (snap?.vectorState) await store.importState(snap.vectorState);
        if (snap?.profiles && typeof snap.profiles === 'object') {
          for (const [owner, data] of Object.entries(snap.profiles)) {
            const p = ensureOwnerProfile(owner);
            for (const g of data.goals || []) p.goals.set(g.goalId, g);
            for (const pref of data.preferences || []) p.preferences.set(pref.key, pref);
          }
        }
      } catch { /* persistence load failure never crashes turn */ }
    }
  }

  async function flushPersist() {
    if (!persist?.save) return;
    try {
      const profiles = {};
      for (const [owner, p] of profileIndex.entries()) {
        profiles[owner] = {
          goals: [...p.goals.values()],
          preferences: [...p.preferences.values()]
        };
      }
      await persist.save({
        schema: SMART_MEMORY_SCHEMA,
        at: now(),
        vectorState: store.exportState(),
        profiles
      });
    } catch { /* non-fatal */ }
  }

  async function enforceCap(collectionName, filter, maxKeep) {
    if (typeof store.scroll !== 'function') return { pruned: 0 };
    const scrolled = await store.scroll(collectionName, {
      filter,
      limit: Math.max(250, maxKeep * 2),
      withPayload: true,
      withVector: false
    });
    if (!scrolled?.ok || !Array.isArray(scrolled.points) || scrolled.points.length <= maxKeep) {
      return { pruned: 0 };
    }
    const sorted = [...scrolled.points].sort((a, b) => {
      // Never prune active explicit goals/preferences before transient turns
      const impA = Number(a.payload?.importance || 0.5);
      const impB = Number(b.payload?.importance || 0.5);
      if (Math.abs(impA - impB) > 0.35) return impB - impA;
      return Number(b.payload?.at || 0) - Number(a.payload?.at || 0);
    });
    const toDelete = sorted.slice(maxKeep).map((pt) => pt.id);
    if (toDelete.length) await store.delete(collectionName, toDelete);
    return { pruned: toDelete.length };
  }

  return {
    schema: SMART_MEMORY_SCHEMA,
    collections: SMART_COLLECTIONS,
    vector: store,

    /* ── 1. User Conversations ─────────────────────────────────────────── */
    async rememberConversation({
      owner,
      userMessage = '',
      assistantReply = '',
      intentType = 'GENERAL',
      assets = [],
      sessionId = null,
      lang = 'fa',
      autoExtractTraits = true
    } = {}) {
      if (!owner) return { ok: false, error: 'OWNER_REQUIRED' };
      if (containsSensitiveKeyOrPhrase(`${userMessage} ${assistantReply}`)) {
        return { ok: false, error: 'SENSITIVE_CONTENT_REFUSED' };
      }
      await ensureInitialized();

      const q = cleanStr(userMessage, 450);
      const a = cleanStr(assistantReply, 700);
      if (!q && !a) return { ok: false, error: 'EMPTY_CONVERSATION' };

      const combinedText = `${q}\n${a}`.trim();
      const ts = now();

      // Deduplicate near-identical recent conversation turns
      const near = await store.search(SMART_COLLECTIONS.user, {
        query: combinedText,
        limit: 1,
        filter: {
          must: [
            { key: 'owner', match: owner },
            { key: 'memoryType', match: MEMORY_TYPES.CONVERSATION }
          ]
        }
      });
      if (near?.rows?.[0]?.score >= 0.94) {
        const hit = near.rows[0];
        await store.upsert(SMART_COLLECTIONS.user, [{
          id: hit.id,
          text: combinedText,
          payload: {
            ...hit.payload,
            at: ts,
            repeatCount: Number(hit.payload?.repeatCount || 1) + 1
          }
        }]);
        return { ok: true, id: hit.id, deduped: true };
      }

      seq += 1;
      const id = `conv:${owner}:${ts.toString(36)}:${seq}`;
      const assetList = Array.isArray(assets) ? assets.map((x) => String(x).toUpperCase()).slice(0, 8) : [];
      await store.upsert(SMART_COLLECTIONS.user, [{
        id,
        text: combinedText,
        payload: {
          owner,
          kind: 'smart_memory',
          memoryType: MEMORY_TYPES.CONVERSATION,
          scope: 'user',
          userMessage: q,
          assistantReply: a,
          text: combinedText,
          intentType: String(intentType || 'GENERAL'),
          assets: assetList,
          sessionId: sessionId ? String(sessionId).slice(0, 64) : null,
          lang: String(lang || 'fa').slice(0, 8),
          importance: 0.5,
          at: ts
        }
      }]);
      metrics.conversationsStored += 1;

      let extracted = { goals: [], preferences: [] };
      if (autoExtractTraits && q) {
        extracted = extractUserTraitsFromMessage(userMessage);
        for (const g of extracted.goals) {
          await this.setGoal({ owner, ...g });
        }
        for (const pref of extracted.preferences) {
          await this.setPreference({ owner, ...pref });
        }
      }

      await enforceCap(SMART_COLLECTIONS.user, { must: [{ key: 'owner', match: owner }] }, maxUserRecordsPerOwner);
      await flushPersist();
      return { ok: true, id, deduped: false, extractedTraits: extracted };
    },

    async recallConversations({ owner, query = '', limit = 5 } = {}) {
      if (!owner) return { ok: false, error: 'OWNER_REQUIRED', rows: [] };
      await ensureInitialized();
      if (!String(query || '').trim()) {
        const scrolled = await store.scroll(SMART_COLLECTIONS.user, {
          filter: {
            must: [
              { key: 'owner', match: owner },
              { key: 'memoryType', match: MEMORY_TYPES.CONVERSATION }
            ]
          },
          limit: Math.max(10, limit * 3)
        });
        const rows = (scrolled.points || [])
          .sort((a, b) => Number(b.payload?.at || 0) - Number(a.payload?.at || 0))
          .slice(0, limit)
          .map((pt) => ({ id: pt.id, score: 1, ...pt.payload }));
        return { ok: true, rows };
      }
      return this.semanticSearch({
        owner,
        query,
        memoryTypes: [MEMORY_TYPES.CONVERSATION],
        limit
      });
    },

    /* ── 2. User Goals & Preferences ───────────────────────────────────── */
    async setGoal({
      owner,
      goalId = null,
      title,
      targetUsd = null,
      horizonMonths = null,
      category = 'wealth',
      priority = 'HIGH',
      provenance = 'USER_SAID'
    } = {}) {
      if (!owner) return { ok: false, error: 'OWNER_REQUIRED' };
      if (!title || containsSensitiveKeyOrPhrase(title)) return { ok: false, error: 'INVALID_OR_SENSITIVE_GOAL' };
      await ensureInitialized();

      const ts = now();
      seq += 1;
      const cleanTitle = cleanStr(title, 300);
      const id = goalId || `goal:${owner}:${ts.toString(36)}:${seq}`;
      const record = {
        goalId: id,
        owner,
        title: cleanTitle,
        targetUsd: Number.isFinite(Number(targetUsd)) && Number(targetUsd) > 0 ? Number(targetUsd) : null,
        horizonMonths: Number.isFinite(Number(horizonMonths)) && Number(horizonMonths) > 0 ? Number(horizonMonths) : null,
        category: String(category || 'wealth').slice(0, 40),
        priority: String(priority || 'HIGH').toUpperCase(),
        provenance: PROVENANCE_RANK[provenance] ? provenance : 'USER_SAID',
        at: ts
      };

      const prof = ensureOwnerProfile(owner);
      prof.goals.set(id, record);

      const embedStr = `User financial goal هدف مالی کاربر: ${cleanTitle} ${record.targetUsd ? `$${record.targetUsd}` : ''} ${record.horizonMonths ? `${record.horizonMonths} months ماه` : ''}`.trim();
      await store.upsert(SMART_COLLECTIONS.user, [{
        id,
        text: embedStr,
        payload: {
          ...record,
          kind: 'smart_memory',
          memoryType: MEMORY_TYPES.GOAL,
          scope: 'user',
          text: embedStr,
          importance: 0.95
        }
      }]);
      metrics.goalsStored += 1;
      await flushPersist();
      return { ok: true, goal: record };
    },

    async setPreference({
      owner,
      key,
      value,
      provenance = 'USER_SAID',
      note = ''
    } = {}) {
      if (!owner) return { ok: false, error: 'OWNER_REQUIRED' };
      const prefKey = String(key || '').trim().slice(0, 64);
      if (!prefKey) return { ok: false, error: 'PREFERENCE_KEY_REQUIRED' };
      if (containsSensitiveKeyOrPhrase(`${prefKey} ${JSON.stringify(value)} ${note}`)) {
        return { ok: false, error: 'SENSITIVE_CONTENT_REFUSED' };
      }
      await ensureInitialized();

      const prof = ensureOwnerProfile(owner);
      const existing = prof.preferences.get(prefKey);
      const incomingRank = PROVENANCE_RANK[provenance] || PROVENANCE_RANK.USER_PREFERRED;
      const existingRank = existing ? (PROVENANCE_RANK[existing.provenance] || 1) : 0;

      // Never allow lower-authority inference to overwrite explicit USER_SAID preference!
      if (existing && incomingRank < existingRank) {
        metrics.provenanceProtections += 1;
        return {
          ok: false,
          protected: true,
          error: 'HIGHER_PROVENANCE_EXISTS',
          existing
        };
      }

      const ts = now();
      const id = `pref:${owner}:${prefKey}`;
      const cleanVal = clipDeep(redactSecrets(value), 240);
      const record = {
        id,
        owner,
        key: prefKey,
        value: cleanVal,
        provenance: PROVENANCE_RANK[provenance] ? provenance : 'USER_PREFERRED',
        note: cleanStr(note, 240),
        at: ts
      };
      prof.preferences.set(prefKey, record);

      const valStr = typeof cleanVal === 'string' ? cleanVal : JSON.stringify(cleanVal);
      const embedStr = `User preference ترجیح کاربر ${prefKey}: ${valStr}. ${record.note}`.trim();
      await store.upsert(SMART_COLLECTIONS.user, [{
        id,
        text: embedStr,
        payload: {
          ...record,
          kind: 'smart_memory',
          memoryType: MEMORY_TYPES.PREFERENCE,
          scope: 'user',
          text: embedStr,
          importance: 0.95
        }
      }]);
      metrics.preferencesStored += 1;
      await flushPersist();
      return { ok: true, preference: record };
    },

    async getUserProfile(owner) {
      if (!owner) return { ok: false, error: 'OWNER_REQUIRED' };
      await ensureInitialized();
      const prof = ensureOwnerProfile(owner);

      // Hydrate from Qdrant/VectorStore if in-memory index is empty (e.g. cold serverless start with remote Qdrant)
      if (prof.goals.size === 0 && prof.preferences.size === 0 && typeof store.scroll === 'function') {
        const scrolled = await store.scroll(SMART_COLLECTIONS.user, {
          filter: {
            must: [{ key: 'owner', match: owner }],
            should: [
              { key: 'memoryType', match: MEMORY_TYPES.GOAL },
              { key: 'memoryType', match: MEMORY_TYPES.PREFERENCE }
            ]
          },
          limit: 100
        });
        for (const pt of scrolled.points || []) {
          const pl = pt.payload || {};
          if (pl.memoryType === MEMORY_TYPES.GOAL && pl.goalId) prof.goals.set(pl.goalId, pl);
          if (pl.memoryType === MEMORY_TYPES.PREFERENCE && pl.key) prof.preferences.set(pl.key, pl);
        }
      }

      const preferencesObj = {};
      for (const [k, v] of prof.preferences.entries()) preferencesObj[k] = v.value;

      return {
        ok: true,
        owner,
        goals: [...prof.goals.values()].sort((a, b) => (b.at || 0) - (a.at || 0)),
        preferences: [...prof.preferences.values()].sort((a, b) => (b.at || 0) - (a.at || 0)),
        preferencesMap: preferencesObj
      };
    },

    /* ── 3. Past Decisions Recall ──────────────────────────────────────── */
    async rememberDecision({
      owner,
      decisionId = null,
      question = '',
      assets = [],
      verdict = 'ANSWER',
      stance = 'neutral',
      confidence = 50,
      summary = '',
      reasons = [],
      entryPrice = null,
      specialists = []
    } = {}) {
      if (!owner) return { ok: false, error: 'OWNER_REQUIRED' };
      if (containsSensitiveKeyOrPhrase(`${question} ${summary}`)) {
        return { ok: false, error: 'SENSITIVE_CONTENT_REFUSED' };
      }
      await ensureInitialized();

      const ts = now();
      seq += 1;
      const id = decisionId || `dec:${owner}:${ts.toString(36)}:${seq}`;
      const cleanQ = cleanStr(question, 350);
      const cleanSum = cleanStr(summary, 500);
      const cleanReasons = (Array.isArray(reasons) ? reasons : []).slice(0, 6).map((r) => cleanStr(r, 180));
      const assetList = (Array.isArray(assets) ? assets : []).map((a) => String(a).toUpperCase()).slice(0, 8);
      const embedStr = `Decision تصمیم قبلی [${assetList.join(', ')}] ${cleanQ} -> ${verdict} (${stance}, ${confidence}%): ${cleanSum} ${cleanReasons.join('; ')}`.trim();

      const payload = {
        owner,
        decisionId: id,
        kind: 'smart_memory',
        memoryType: MEMORY_TYPES.DECISION,
        scope: 'user',
        question: cleanQ,
        assets: assetList,
        verdict: String(verdict),
        stance: String(stance),
        confidence: Math.round(Number(confidence) || 0),
        summary: cleanSum,
        reasons: cleanReasons,
        entryPrice: entryPrice !== null && entryPrice !== undefined && Number.isFinite(Number(entryPrice)) ? Number(entryPrice) : null,
        specialists: (Array.isArray(specialists) ? specialists : []).slice(0, 8).map(String),
        text: embedStr,
        importance: 0.75,
        at: ts
      };

      await store.upsert(SMART_COLLECTIONS.user, [{ id, text: embedStr, payload }]);
      metrics.decisionsStored += 1;
      await flushPersist();
      return { ok: true, id, decision: payload };
    },

    async recallDecisions({ owner, query = '', asset = null, limit = 5 } = {}) {
      if (!owner) return { ok: false, error: 'OWNER_REQUIRED', rows: [] };
      await ensureInitialized();
      const searchQ = [query, asset].filter(Boolean).join(' ').trim();
      if (!searchQ) {
        const scrolled = await store.scroll(SMART_COLLECTIONS.user, {
          filter: {
            must: [
              { key: 'owner', match: owner },
              { key: 'memoryType', match: MEMORY_TYPES.DECISION }
            ]
          },
          limit: Math.max(10, limit * 3)
        });
        const rows = (scrolled.points || [])
          .filter((pt) => !asset || (pt.payload?.assets || []).includes(String(asset).toUpperCase()))
          .sort((a, b) => Number(b.payload?.at || 0) - Number(a.payload?.at || 0))
          .slice(0, limit)
          .map((pt) => ({ id: pt.id, score: 1, ...pt.payload }));
        return { ok: true, rows };
      }
      const res = await this.semanticSearch({
        owner,
        query: searchQ,
        memoryTypes: [MEMORY_TYPES.DECISION],
        limit: limit * 2
      });
      const rows = asset
        ? res.rows.filter((r) => (r.assets || []).includes(String(asset).toUpperCase())).slice(0, limit)
        : res.rows.slice(0, limit);
      return { ok: true, rows };
    },

    /* ── 4. Hybrid Semantic Search Over Historical Information ─────────── */
    async semanticSearch({
      owner,
      query,
      memoryTypes = null, // array of MEMORY_TYPES or null for all user memories
      outcome = null,
      limit = 8,
      minScore = 0.08
    } = {}) {
      if (!owner) return { ok: false, error: 'OWNER_REQUIRED', rows: [] };
      const q = cleanStr(query, 600);
      if (!q) return { ok: false, error: 'QUERY_REQUIRED', rows: [] };
      await ensureInitialized();
      metrics.semanticSearches += 1;

      const must = [{ key: 'owner', match: owner }];
      if (Array.isArray(memoryTypes) && memoryTypes.length === 1) {
        must.push({ key: 'memoryType', match: memoryTypes[0] });
      } else if (Array.isArray(memoryTypes) && memoryTypes.length > 1) {
        must.push({ key: 'memoryType', match: { any: memoryTypes } });
      }
      if (outcome) must.push({ key: 'outcome', match: String(outcome).toUpperCase() });

      const vecRes = await store.search(SMART_COLLECTIONS.user, {
        query: q,
        limit: Math.max(12, limit * 3),
        filter: { must },
        scoreThreshold: -0.1
      });

      const qTokens = tokenize(q);
      const ts = now();
      const ranked = (vecRes.rows || [])
        .map((r) => {
          const pl = r.payload || {};
          const lex = lexicalOverlap(qTokens, pl.text || '');
          const rec = recencyBoost(pl.at, ts);
          const imp = Number(pl.importance || 0.5);
          // Hybrid semantic score: 68% dense semantic vector + 17% lexical precision + 10% recency + 5% importance
          const hybridScore = Math.max(0, r.score) * 0.68 + lex * 0.17 + rec * 0.10 + imp * 0.05;
          return {
            id: r.id,
            score: Math.round(hybridScore * 10000) / 10000,
            vectorScore: Math.round(r.score * 10000) / 10000,
            lexicalScore: Math.round(lex * 10000) / 10000,
            ...pl
          };
        })
        .filter((r) => r.score >= minScore && r.vectorScore > 0.01)
        .sort((a, b) => b.score - a.score);

      return {
        ok: true,
        query: q,
        count: Math.min(limit, ranked.length),
        backend: vecRes.backend || store.kind,
        rows: ranked.slice(0, limit)
      };
    },

    /* ── 5. Dedicated Private Memory per Agent (`agentId`-isolated) ────── */
    async rememberAgentPrivate({
      owner,
      agentId,
      note,
      topic = 'observation',
      assets = [],
      confidence = 0.7,
      data = null
    } = {}) {
      if (!owner) return { ok: false, error: 'OWNER_REQUIRED' };
      const cleanAgent = String(agentId || '').trim().toLowerCase();
      if (!cleanAgent) return { ok: false, error: 'AGENT_ID_REQUIRED' };
      if (!note || containsSensitiveKeyOrPhrase(`${note} ${JSON.stringify(data || {})}`)) {
        return { ok: false, error: 'INVALID_OR_SENSITIVE_AGENT_NOTE' };
      }
      await ensureInitialized();

      const ts = now();
      seq += 1;
      const id = `agpriv:${owner}:${cleanAgent}:${ts.toString(36)}:${seq}`;
      const cleanNote = cleanStr(note, 500);
      const assetList = (Array.isArray(assets) ? assets : []).map((a) => String(a).toUpperCase()).slice(0, 6);
      const embedStr = `[${cleanAgent}] ${topic} ${assetList.join(' ')}: ${cleanNote}`;

      const payload = {
        owner,
        agentId: cleanAgent,
        kind: 'agent_private_memory',
        memoryType: 'agent_private',
        scope: 'agent_private',
        topic: String(topic).slice(0, 64),
        assets: assetList,
        note: cleanNote,
        confidence: Math.max(0, Math.min(1, Number(confidence) || 0.7)),
        data: data ? clipDeep(redactSecrets(data), 240) : null,
        text: embedStr,
        at: ts
      };

      await store.upsert(SMART_COLLECTIONS.agentPrivate, [{ id, text: embedStr, payload }]);
      metrics.agentPrivateWrites += 1;
      await enforceCap(
        SMART_COLLECTIONS.agentPrivate,
        { must: [{ key: 'owner', match: owner }, { key: 'agentId', match: cleanAgent }] },
        maxAgentRecordsPerAgent
      );
      await flushPersist();
      return { ok: true, id, agentId: cleanAgent, entry: payload };
    },

    async recallAgentPrivate({
      owner,
      agentId,
      requesterAgentId = null,
      query = '',
      limit = 5
    } = {}) {
      if (!owner) return { ok: false, error: 'OWNER_REQUIRED', rows: [] };
      const targetAgent = String(agentId || '').trim().toLowerCase();
      if (!targetAgent) return { ok: false, error: 'AGENT_ID_REQUIRED', rows: [] };
      // Strict isolation: another agent cannot read `targetAgent`'s private memory!
      if (requesterAgentId && String(requesterAgentId).trim().toLowerCase() !== targetAgent) {
        metrics.aclBlocks += 1;
        return { ok: false, error: 'AGENT_PRIVATE_MEMORY_ISOLATED', rows: [] };
      }
      await ensureInitialized();

      const filter = {
        must: [
          { key: 'owner', match: owner },
          { key: 'agentId', match: targetAgent }
        ]
      };

      if (!String(query || '').trim()) {
        const scrolled = await store.scroll(SMART_COLLECTIONS.agentPrivate, { filter, limit: limit * 2 });
        const rows = (scrolled.points || [])
          .sort((a, b) => Number(b.payload?.at || 0) - Number(a.payload?.at || 0))
          .slice(0, limit)
          .map((pt) => ({ id: pt.id, score: 1, ...pt.payload }));
        return { ok: true, agentId: targetAgent, rows };
      }

      const res = await store.search(SMART_COLLECTIONS.agentPrivate, {
        query: cleanStr(query, 400),
        limit,
        filter
      });
      return {
        ok: true,
        agentId: targetAgent,
        rows: (res.rows || []).map((r) => ({ id: r.id, score: r.score, ...r.payload }))
      };
    },

    /* ── 6. Controlled Shared Memory Across Agents ─────────────────────── */
    async publishSharedMemory({
      owner,
      publisherAgentId,
      claim,
      topic = 'finding',
      assets = [],
      confidence = 0.7,
      evidenceRefs = [],
      allowedReaders = ['*'],
      sessionId = null,
      ttlMs = defaultSharedTtlMs
    } = {}) {
      if (!owner) return { ok: false, error: 'OWNER_REQUIRED' };
      const pubAgent = String(publisherAgentId || '').trim().toLowerCase();
      if (!pubAgent) return { ok: false, error: 'PUBLISHER_AGENT_REQUIRED' };
      if (!claim || containsSensitiveKeyOrPhrase(claim)) {
        return { ok: false, error: 'INVALID_OR_SENSITIVE_SHARED_CLAIM' };
      }
      await ensureInitialized();

      const ts = now();
      seq += 1;
      const id = `agshared:${owner}:${pubAgent}:${ts.toString(36)}:${seq}`;
      const conf = Math.max(0, Math.min(1, Number(confidence) || 0));
      const refs = (Array.isArray(evidenceRefs) ? evidenceRefs : []).slice(0, 8).map((r) => String(r).slice(0, 80));
      // Controlled verification gate: unverified low-confidence claims are quarantined as UNVERIFIED_HYPOTHESIS
      const verificationStatus = (conf >= minVerifiedConfidence && refs.length > 0)
        ? 'EVIDENCE_BACKED'
        : 'UNVERIFIED_HYPOTHESIS';
      const readers = Array.isArray(allowedReaders) && allowedReaders.length
        ? allowedReaders.map((r) => String(r).trim().toLowerCase())
        : ['*'];

      const cleanClaim = cleanStr(claim, 500);
      const assetList = (Array.isArray(assets) ? assets : []).map((a) => String(a).toUpperCase()).slice(0, 6);
      const payload = {
        owner,
        publisherAgentId: pubAgent,
        agentId: pubAgent,
        kind: 'agent_shared_memory',
        memoryType: 'agent_shared',
        scope: 'agent_shared',
        topic: String(topic).slice(0, 64),
        assets: assetList,
        claim: cleanClaim,
        confidence: conf,
        evidenceRefs: refs,
        verificationStatus,
        allowedReaders: readers,
        sessionId: sessionId ? String(sessionId).slice(0, 64) : null,
        expiresAt: ts + Math.max(10_000, Number(ttlMs) || defaultSharedTtlMs),
        text: `${topic} ${assetList.join(' ')}: ${cleanClaim}`,
        at: ts
      };

      await store.upsert(SMART_COLLECTIONS.agentShared, [{ id, text: payload.text, payload }]);
      metrics.agentSharedPublishes += 1;
      await flushPersist();
      return { ok: true, id, verificationStatus, entry: payload };
    },

    async readSharedMemory({
      owner,
      readerAgentId,
      query = '',
      sessionId = null,
      verifiedOnly = false,
      limit = 8
    } = {}) {
      if (!owner) return { ok: false, error: 'OWNER_REQUIRED', rows: [] };
      const reader = String(readerAgentId || '').trim().toLowerCase();
      if (!reader) return { ok: false, error: 'READER_AGENT_REQUIRED', rows: [] };
      await ensureInitialized();

      const ts = now();
      const must = [
        { key: 'owner', match: owner },
        { key: 'expiresAt', range: { gt: ts } }
      ];
      if (sessionId) must.push({ key: 'sessionId', match: String(sessionId).slice(0, 64) });
      if (verifiedOnly) must.push({ key: 'verificationStatus', match: 'EVIDENCE_BACKED' });

      let candidates = [];
      if (String(query || '').trim()) {
        const res = await store.search(SMART_COLLECTIONS.agentShared, {
          query: cleanStr(query, 400),
          limit: limit * 3,
          filter: { must }
        });
        candidates = (res.rows || []).map((r) => ({ id: r.id, score: r.score, ...r.payload }));
      } else {
        const scrolled = await store.scroll(SMART_COLLECTIONS.agentShared, {
          filter: { must },
          limit: limit * 3
        });
        candidates = (scrolled.points || [])
          .sort((a, b) => Number(b.payload?.at || 0) - Number(a.payload?.at || 0))
          .map((pt) => ({ id: pt.id, score: 1, ...pt.payload }));
      }

      // Enforce controlled ACL check per entry
      const authorized = [];
      for (const item of candidates) {
        const readers = Array.isArray(item.allowedReaders) ? item.allowedReaders : ['*'];
        const allowed = readers.includes('*') || readers.includes(reader) || item.publisherAgentId === reader;
        if (!allowed) {
          metrics.aclBlocks += 1;
          continue;
        }
        authorized.push(item);
        if (authorized.length >= limit) break;
      }

      return { ok: true, readerAgentId: reader, rows: authorized };
    },

    /* ── 7. Successful & Unsuccessful Experiences ──────────────────────── */
    async recordExperience({
      owner,
      outcome, // 'SUCCESS' | 'FAILURE' | 'PARTIAL'
      taskType = 'ANALYSIS',
      asset = null,
      strategy = '',
      summary = '',
      whatWorked = '',
      whatFailed = '',
      rootCause = null,
      errorPct = null,
      lesson = '',
      agentsInvolved = [],
      modelsUsed = []
    } = {}) {
      if (!owner) return { ok: false, error: 'OWNER_REQUIRED' };
      const normOutcome = ['SUCCESS', 'FAILURE', 'PARTIAL'].includes(String(outcome).toUpperCase())
        ? String(outcome).toUpperCase()
        : 'PARTIAL';
      if (containsSensitiveKeyOrPhrase(`${summary} ${whatWorked} ${whatFailed} ${lesson}`)) {
        return { ok: false, error: 'SENSITIVE_CONTENT_REFUSED' };
      }
      await ensureInitialized();

      const ts = now();
      seq += 1;
      const id = `exp:${owner}:${normOutcome.toLowerCase()}:${ts.toString(36)}:${seq}`;
      const sym = asset ? String(asset).toUpperCase().slice(0, 16) : null;
      const cleanSummary = cleanStr(summary, 350);
      const cleanLesson = cleanStr(lesson || (normOutcome === 'FAILURE' ? whatFailed : whatWorked), 350);
      const embedStr = `Experience تجربه ${normOutcome === 'SUCCESS' ? 'موفق' : normOutcome === 'FAILURE' ? 'ناموفق اشتباه' : 'نسبی'} [${sym || taskType}] ${strategy}: ${cleanSummary}. Lesson درس: ${cleanLesson}. ${rootCause || ''}`.trim();

      const payload = {
        owner,
        experienceId: id,
        kind: 'smart_memory',
        memoryType: MEMORY_TYPES.EXPERIENCE,
        scope: 'user',
        outcome: normOutcome,
        taskType: String(taskType || 'ANALYSIS'),
        asset: sym,
        strategy: cleanStr(strategy, 160),
        summary: cleanSummary,
        whatWorked: cleanStr(whatWorked, 260),
        whatFailed: cleanStr(whatFailed, 260),
        rootCause: rootCause ? String(rootCause).slice(0, 80) : null,
        errorPct: errorPct !== null && errorPct !== undefined && Number.isFinite(Number(errorPct)) ? Math.round(Number(errorPct) * 100) / 100 : null,
        lesson: cleanLesson,
        agentsInvolved: (Array.isArray(agentsInvolved) ? agentsInvolved : []).slice(0, 8).map(String),
        modelsUsed: (Array.isArray(modelsUsed) ? modelsUsed : []).slice(0, 8).map(String),
        text: embedStr,
        importance: normOutcome === 'FAILURE' ? 0.9 : 0.8,
        at: ts
      };

      await store.upsert(SMART_COLLECTIONS.user, [{ id, text: embedStr, payload }]);
      metrics.experiencesStored += 1;
      await flushPersist();
      return { ok: true, id, experience: payload };
    },

    async recallExperiences({ owner, query = '', outcome = null, asset = null, limit = 6 } = {}) {
      if (!owner) return { ok: false, error: 'OWNER_REQUIRED', rows: [] };
      await ensureInitialized();
      const searchQ = [query, asset, outcome].filter(Boolean).join(' ').trim();
      if (!searchQ) {
        const must = [
          { key: 'owner', match: owner },
          { key: 'memoryType', match: MEMORY_TYPES.EXPERIENCE }
        ];
        if (outcome) must.push({ key: 'outcome', match: String(outcome).toUpperCase() });
        if (asset) must.push({ key: 'asset', match: String(asset).toUpperCase() });
        const scrolled = await store.scroll(SMART_COLLECTIONS.user, { filter: { must }, limit: limit * 2 });
        const rows = (scrolled.points || [])
          .sort((a, b) => Number(b.payload?.at || 0) - Number(a.payload?.at || 0))
          .slice(0, limit)
          .map((pt) => ({ id: pt.id, score: 1, ...pt.payload }));
        return { ok: true, rows };
      }
      const res = await this.semanticSearch({
        owner,
        query: searchQ,
        memoryTypes: [MEMORY_TYPES.EXPERIENCE],
        outcome,
        limit: limit * 2
      });
      const rows = asset
        ? res.rows.filter((r) => !r.asset || r.asset === String(asset).toUpperCase()).slice(0, limit)
        : res.rows.slice(0, limit);
      return { ok: true, rows };
    },

    /* ── 8. Timely Contextual Retrieval (`contextualRecall`) ───────────── */
    async contextualRecall({
      owner,
      query = '',
      intentType = 'GENERAL',
      entities = {},
      activeAgents = [],
      sessionId = null,
      limitPerKind = 3
    } = {}) {
      if (!owner) return { ok: false, error: 'OWNER_REQUIRED' };
      await ensureInitialized();
      metrics.contextualRecalls += 1;

      const assets = Array.isArray(entities?.tokens)
        ? entities.tokens
        : (Array.isArray(entities?.assets) ? entities.assets : []);
      const primaryAsset = assets[0] ? String(assets[0]).toUpperCase() : null;
      const enrichedQuery = [query, primaryAsset, intentType].filter(Boolean).join(' ').trim();

      const [profile, conversations, decisions, experiences, agentBundles] = await Promise.all([
        this.getUserProfile(owner),
        enrichedQuery ? this.recallConversations({ owner, query: enrichedQuery, limit: limitPerKind }) : Promise.resolve({ rows: [] }),
        enrichedQuery ? this.recallDecisions({ owner, query: enrichedQuery, asset: primaryAsset, limit: limitPerKind }) : Promise.resolve({ rows: [] }),
        enrichedQuery ? this.recallExperiences({ owner, query: enrichedQuery, asset: primaryAsset, limit: limitPerKind * 2 }) : Promise.resolve({ rows: [] }),
        Promise.all((Array.isArray(activeAgents) ? activeAgents : []).slice(0, 8).map(async (agId) => {
          const [priv, shared] = await Promise.all([
            this.recallAgentPrivate({ owner, agentId: agId, requesterAgentId: agId, query: enrichedQuery, limit: 2 }),
            this.readSharedMemory({ owner, readerAgentId: agId, query: enrichedQuery, sessionId, limit: 4 })
          ]);
          return [agId, { private: priv.rows || [], shared: shared.rows || [] }];
        }))
      ]);

      const expRows = experiences.rows || [];
      const successes = expRows.filter((e) => e.outcome === 'SUCCESS').slice(0, limitPerKind);
      const failures = expRows.filter((e) => e.outcome === 'FAILURE').slice(0, limitPerKind);
      const warnings = failures.map((f) => ({
        experienceId: f.experienceId || f.id,
        asset: f.asset,
        rootCause: f.rootCause || 'PAST_FAILURE',
        warning: f.lesson || f.whatFailed || f.summary
      }));

      const agentContext = Object.fromEntries(agentBundles);

      // Build compact, prompt-ready summary for Central Brain & Council seats
      const summaryLines = [];
      if (profile.goals?.length) {
        summaryLines.push(`اهداف کاربر (User Goals): ${profile.goals.slice(0, 3).map((g) => g.title).join(' | ')}`);
      }
      if (profile.preferences?.length) {
        summaryLines.push(`ترجیحات کاربر (User Preferences): ${profile.preferences.map((p) => `${p.key}=${JSON.stringify(p.value)}`).join(', ')}`);
      }
      if (decisions.rows?.length) {
        summaryLines.push(`تصمیم‌های مرتبط قبلی (Past Decisions): ${decisions.rows.slice(0, 2).map((d) => `[${(d.assets || []).join(',') || 'GEN'}] ${d.verdict} (${d.confidence}%): ${d.summary}`).join(' | ')}`);
      }
      if (warnings.length) {
        summaryLines.push(`هشدار تجربه‌های ناموفق قبلی (Past Failure Warnings): ${warnings.map((w) => `[${w.asset || 'GEN'}/${w.rootCause}] ${w.warning}`).join(' | ')}`);
      }
      if (successes.length) {
        summaryLines.push(`الگوهای موفق قبلی (Past Successes): ${successes.map((s) => s.lesson || s.summary).join(' | ')}`);
      }
      if (conversations.rows?.length) {
        summaryLines.push(`مکالمات قبلی مرتبط (Prior Conversations): ${conversations.rows.slice(0, 2).map((c) => `Q: ${c.userMessage}`).join(' | ')}`);
      }

      return {
        ok: true,
        schema: SMART_MEMORY_SCHEMA,
        owner,
        userProfile: {
          goals: profile.goals || [],
          preferences: profile.preferences || [],
          preferencesMap: profile.preferencesMap || {}
        },
        relevantConversations: conversations.rows || [],
        pastDecisions: decisions.rows || [],
        relevantExperiences: {
          successes,
          failures,
          warnings
        },
        agentMemories: agentContext,
        promptSummary: summaryLines.join('\n'),
        hasRelevantContext: summaryLines.length > 0
      };
    },

    async stats(owner = null) {
      await ensureInitialized();
      const filter = owner ? { must: [{ key: 'owner', match: owner }] } : null;
      const [uCount, pCount, sCount, health] = await Promise.all([
        store.count(SMART_COLLECTIONS.user, { filter }),
        store.count(SMART_COLLECTIONS.agentPrivate, { filter }),
        store.count(SMART_COLLECTIONS.agentShared, { filter }),
        store.health()
      ]);
      return {
        ok: true,
        schema: SMART_MEMORY_SCHEMA,
        counts: {
          userMemories: uCount.count || 0,
          agentPrivateMemories: pCount.count || 0,
          agentSharedMemories: sCount.count || 0
        },
        metrics: { ...metrics },
        vectorBackend: health
      };
    },

    exportSnapshot() {
      const profiles = {};
      for (const [owner, p] of profileIndex.entries()) {
        profiles[owner] = {
          goals: [...p.goals.values()],
          preferences: [...p.preferences.values()]
        };
      }
      return {
        schema: SMART_MEMORY_SCHEMA,
        at: now(),
        vectorState: store.exportState(),
        profiles
      };
    },

    async importSnapshot(snap = {}) {
      if (snap?.schema !== SMART_MEMORY_SCHEMA) return { ok: false, error: 'SCHEMA_MISMATCH' };
      await ensureInitialized();
      if (snap.vectorState) await store.importState(snap.vectorState);
      profileIndex.clear();
      for (const [owner, data] of Object.entries(snap.profiles || {})) {
        const p = ensureOwnerProfile(owner);
        for (const g of data.goals || []) p.goals.set(g.goalId, g);
        for (const pref of data.preferences || []) p.preferences.set(pref.key, pref);
      }
      return { ok: true };
    }
  };
}

export default createSmartMemory;
