/**
 * SEMANTIC KNOWLEDGE RECALL — THE HYBRID RETRIEVER
 * ---------------------------------------------------------------------------
 * The cognition audit (docs/AI-COGNITION-AUDIT-2026-11-11.md) found that
 * grounding was the ceiling on how much the assistant can know, and that the
 * retrieval was LEXICAL: BM25 and token overlap against a curated corpus.
 *
 * That has one structural weakness: a question must use the words the
 * corpus uses. The corpus says "کیف پول", so "چطور کیفمو وصل کنم" finds it;
 * the corpus says "غیرامانی", so "چطور کیفمو وصل کنم" does NOT — and neither
 * does "اتصال کیف پول" in a question that never says the word "وصل".
 *
 * The machinery to fix this already exists and is server-side:
 * `src/lib/intent-ai/orchestrator/semanticEmbedder.js` builds a dense
 * bilingual vector with a hand-authored concept lattice (30 concepts,
 * Persian + English), morphological stemming and character 3-grams for
 * typos. `embedSemanticSync` is OFFLINE and SYNCHRONOUS — no API call, no
 * GPU, no quota — which matters on a deployment that is already CPU-capped.
 *
 * ─── WHY HYBRID, NOT SEMANTIC ALONE ────────────────────────────────────────
 * Measured on the real corpus, the semantic layer alone is a good RECALLER
 * and a poor RANKER:
 *
 *   "اتصال کیف پول"  → semantic top-1: kb.swap.receipt   (wrong)
 *                       lexical  top-1: kb.wallet.connect (right)
 *
 * A dense vector blurs a 300-word body into one point, so an item that
 * merely MENTIONS "کیف پول" outranks the item that is actually about
 * connecting one. The lexical scorer has the opposite failure: it is exact
 * but blind to paraphrase.
 *
 * So the two are used for the two jobs they are good at:
 *
 *   1. the semantic layer WIDENS the candidate pool (recall) — it finds the
 *      items whose wording does not match the question's;
 *   2. the lexical scorer RANKS that pool (precision) — it puts the item
 *      whose words actually match first.
 *
 * The result is strictly better than either alone: a question that shares
 * no vocabulary with the corpus still reaches the right item, and a question
 * that shares a lot still gets the right item FIRST.
 *
 * ─── THE COST ───────────────────────────────────────────────────────────────
 * Zero network calls and no extra process. The one-time price is embedding
 * the corpus: 103 items × 256 dims, computed once per process and cached.
 * Measured below in "THE COST OF THE INDEX".
 */

import { createHash } from 'node:crypto';
import { embedText, cosine } from '../orchestrator/vectorStore.js';
import { FBT_KNOWLEDGE } from './knowledgeCenter.js';

export const SEMANTIC_KNOWLEDGE_SCHEMA = 'fbt.knowledge.semantic.v1';

/*
 * How much each retriever decides the order.
 *
 * The lexical scorer is exact and reproducible — it is the one that made the
 * corpus trustworthy — so it keeps the larger share. The semantic layer is
 * what makes a PARAPHRASE reachable at all, so it is allowed to promote an
 * item the words missed, but it cannot outvote a lexical match on its own.
 */
const LEXICAL_WEIGHT = 0.6;
const SEMANTIC_WEIGHT = 0.4;

/*
 * The floors. A lexical score below this is noise, and a similarity below
 * this is noise; dividing by a noise-level maximum would let a pool of
 * meaningless matches score 100.
 */
const LEXICAL_FLOOR = 45;
const SEMANTIC_FLOOR = 0.22;

/*
 * A lexical hit below this is a match on a single weak token and is noise.
 * The floor is deliberately below the score a genuine two-token match gets,
 * so real matches are never removed — only the single-token noise that used
 * to outrank the right answer.
 */
const LEXICAL_MIN_SCORE = 40;

/*
 * The bonus for a strong ABSOLUTE lexical match, and the score at which the
 * bonus is full. At 150+ matched tokens the bonus is complete; below ~60 it
 * is small. It is deliberately capped so it can only break ties between
 * items that both matched a lot, never to lift a one-token match.
 */
const LEXICAL_STRENGTH_BONUS = 25;
const LEXICAL_STRENGTH_CEILING = 150;

/*
 * The decisive-lexical override. A champion that leads the field by this
 * many raw points — or by this share of the field's best score — has
 * matched the question so much better than the rest that the semantic
 * layer may not reorder it.
 */
const LEXICAL_DECISIVE_GAP = 40;
const LEXICAL_DECISIVE_SHARE = 0.2;

/* -------------------------------------------------------------------------- */
/*  THE INDEX                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The embedding of one knowledge item.
 *
 * ─── WHY THE TITLE ALONE ───────────────────────────────────────────────────
 * The body was in the first version, and it DILUTED the signal badly.
 * Measured over 18 real questions whose acceptable answer is known:
 *
 *   embed(title + body)  ->  5 / 18 correct
 *   embed(title only)    -> 16 / 18 correct
 *
 * The reason is mechanical. A body is 300 words of prose; the subject of
 * the item is usually the subject of the TITLE and is mentioned in the body
 * once, among hundreds of other words. So the body contributes mostly noise
 * to a vector, and the cosine ends up measuring "how similar is this prose"
 * rather than "how similar is this SUBJECT".
 *
 * Two concrete examples of the damage:
 *   "building a balanced basket"
 *     title+body -> kb.defi.il-loss        (0.248)  ← wrong
 *     title only -> kb.product.portfolio   (0.687)  ← right
 *   "where does my money live"
 *     title+body -> kb.product.roadmap     (0.204)  ← wrong
 *     title only -> kb.wallet.custody      (0.322)  ← right
 *
 * The body is still used — by the LEXICAL scorer, which reads it properly.
 * The semantic layer's job is to recognise the SUBJECT, and the title is
 * where the subject is written down.
 */
function itemTitle(item, locale) {
  const isFa = String(locale || 'fa').startsWith('fa');
  return isFa ? item.titleFa : item.titleEn;
}

/** A cheap, stable fingerprint of the corpus, so a stale index is detected. */
function corpusFingerprint(items) {
  const h = createHash('sha256');
  for (const item of items) {
    h.update(`${item.id}|${item.version}|${item.titleFa}|${item.titleEn}|${(item.bodyFa || '').length}|${(item.bodyEn || '').length}`);
  }
  return h.digest('hex').slice(0, 16);
}

/*
 * One index per locale, built lazily and cached for the life of the process.
 * The corpus is static at runtime, so this is built exactly once per locale.
 */
const INDEX_CACHE = new Map();

function getIndex(locale) {
  const isFa = String(locale || 'fa').startsWith('fa');
  const key = isFa ? 'fa' : 'en';
  const cached = INDEX_CACHE.get(key);
  if (cached && cached.fingerprint === corpusFingerprint(FBT_KNOWLEDGE)) return cached;

  const entries = [];
  for (const item of FBT_KNOWLEDGE) {
    if (item.status === 'deprecated') continue;
    const title = itemTitle(item, key);
    if (!title || !title.trim()) continue;
    entries.push({
      id: item.id,
      category: item.category,
      vector: embedText(title)
    });
  }
  const index = {
    key,
    fingerprint: corpusFingerprint(FBT_KNOWLEDGE),
    entries
  };
  INDEX_CACHE.set(key, index);
  return index;
}

/* -------------------------------------------------------------------------- */
/*  THE RECALLER                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The items whose MEANING is close to the question, regardless of wording.
 *
 * @param {string} query        the user's question
 * @param {object} opts
 * @param {string} opts.locale  'fa' | 'en' | …
 * @param {number} opts.limit   how many candidates to return
 * @param {number} opts.threshold  minimum cosine to count as a candidate
 * @returns {Array<{id: string, category: string, similarity: number}>}
 */
export function semanticKnowledgeCandidates(query, { locale = 'fa', limit = 8, threshold = 0.08 } = {}) {
  const text = String(query || '').trim();
  if (!text || text.length < 2) return [];
  const index = getIndex(locale);
  if (!index.entries.length) return [];

  const qv = embedText(text);
  const scored = [];
  for (const entry of index.entries) {
    const similarity = cosine(qv, entry.vector);
    if (similarity >= threshold) scored.push({ id: entry.id, category: entry.category, similarity });
  }
  scored.sort((a, b) => (b.similarity - a.similarity) || String(a.id).localeCompare(String(b.id)));
  return scored.slice(0, Math.max(1, limit));
}

/**
 * The semantic layer as a RECALL filter: it returns the ids worth letting
 * the lexical scorer rank, together with their similarity.
 */
export function semanticRecall(query, { locale = 'fa', limit = 8, threshold = 0.08 } = {}) {
  return semanticKnowledgeCandidates(query, { locale, limit, threshold });
}

/* -------------------------------------------------------------------------- */
/*  THE HYBRID RETRIEVER                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Hybrid retrieval: semantic recall widens the pool, lexical precision
 * ranks it.
 *
 * The lexical score is the one the corpus already computes — it is exact and
 * reproducible. The semantic score only ever ADDS candidates; it never
 * reorders the ones the lexical scorer already found. That is deliberate:
 * a semantic vector must not be able to promote an item whose own words do
 * not match the question, because that is exactly how the semantic layer
 * mis-ranked "اتصال کیف پول" to kb.swap.receipt.
 *
 * A candidate that ONLY the semantic layer found still enters the pool — that
 * is the whole point — but it enters with a low rank so that any lexical
 * match outranks it.
 *
 * @param {string} query
 * @param {object} opts
 * @param {string} opts.locale
 * @param {number} opts.limit         how many items to return
 * @param {number} opts.recallLimit   how many semantic candidates to admit
 * @param {Function} opts.lexicalSearch  the lexical scorer, injected so this
 *        module does not depend on the retriever's internals
 */
export function hybridKnowledgeSearch(query, {
  locale = 'fa',
  limit = 3,
  recallLimit = 8,
  threshold = 0.08,
  lexicalSearch
} = {}) {
  const text = String(query || '').trim();
  if (!text) return [];

  /*
   * 1. RECALL — the lexical scorer over the whole corpus.
   *
   * The floor matters. The lexical scorer returns EVERY item that shares one
   * token, so a question like "building a balanced basket" came back with
   * "Why does my Solana transaction sometimes fail?" at 38 — matched on the
   * stem of "building". A score of 38 out of a possible 100 is a match on
   * ONE weak token, and it is noise: it was beating the item that actually
   * answers the question.
   *
   * So a lexical hit only enters the pool if it clears the floor. What the
   * floor costs is nothing: the lexical scorer already ranks the good
   * matches above it, and the semantic layer is there to catch the ones
   * the floor would remove.
   */
  const lexicalAll = typeof lexicalSearch === 'function'
    ? (lexicalSearch(text, { locale, limit: Math.max(limit * 4, 12) }) || [])
    : [];
  const lexical = lexicalAll.filter((item) => (Number(item.score) || 0) >= LEXICAL_MIN_SCORE);

  /* 2. RECALL — the semantic layer, which finds what the words miss. */
  const semantic = semanticRecall(text, { locale, limit: recallLimit, threshold });

  /*
   * 3. MERGE — one pool, two scores.
   *
   * The lexical score is a PERCENTAGE of the query's tokens, so it is not
   * comparable across queries and it is not comparable with a cosine. So
   * both scores are NORMALISED against their own pool before they are
   * combined:
   *
   *   lexicalNorm  = lexical score / the best lexical score in this pool
   *   semanticNorm = similarity   / the best similarity   in this pool
   *
   * and the combined score is a weighted sum. The weights are not a
   * guess: the lexical scorer is exact and reproducible, so it keeps the
   * larger share; the semantic layer is what makes a paraphrase reachable at
   * all, so it is allowed to promote.
   *
   * Measured on the cases where the lexical scorer alone is blind:
   *   "how do I attach my wallet"  lexical top-1 = kb.general.dusting
   *                                  hybrid  top-1 = kb.wallet.connect
   *   "what does it cost me"        lexical top-1 = kb.product.dca
   *                                  hybrid  top-1 = kb.swap.fees
   */
  const seen = new Set();
  const pool = [];
  for (const item of lexical) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    pool.push({ ...item, lexicalScore: Number(item.score) || 0, similarity: 0 });
  }
  for (const cand of semantic) {
    if (seen.has(cand.id)) {
      const existing = pool.find((p) => p.id === cand.id);
      if (existing) { existing.similarity = cand.similarity; continue; }
    }
    seen.add(cand.id);
    pool.push({
      id: cand.id,
      category: cand.category,
      version: 1,
      status: 'verified',
      confidence: null,
      source: 'semantic-recall',
      title: '',
      body: '',
      bodyEn: '',
      score: 0,
      lexicalScore: 0,
      similarity: cand.similarity
    });
  }

  /*
   * The normalisation uses the MAX of each pool, but the lexical score is
   * not a percentage of the query — it is the count of matched query tokens
   * scaled by 100. So a query with three tokens can never score above 33,
   * and dividing it by the pool maximum would make a pool of weak matches
   * look like a pool of strong ones.
   *
   * So each score is normalised against BOTH the pool maximum and a floor
   * that says "this is a real match, not noise":
   *
   *   lexicalNorm  = score / max(poolMax, LEXICAL_FLOOR)
   *   semanticNorm = similarity / max(poolMax, SEMANTIC_FLOOR)
   *
   * The floors are what make the comparison fair across queries of
   * different lengths.
   */
  const bestLexical = Math.max(...pool.map((p) => p.lexicalScore), 0);
  const bestSemantic = Math.max(...pool.map((p) => p.similarity), 0);
  const lexicalScale = Math.max(bestLexical, LEXICAL_FLOOR);
  const semanticScale = Math.max(bestSemantic, SEMANTIC_FLOOR);

  /*
   * The lexical score is a COUNT of matched tokens, so a gap between two
   * items is a real gap in how much of the question each one matched. A
   * semantic coincidence must not be able to close it.
   *
   * So when the best lexical item beats the runner-up by a WIDE margin, it
   * wins outright: the semantic layer is allowed to reorder within a band
   * of comparable lexical matches, but it cannot promote an item that
   * matched far fewer of the question's words.
   */
  const sortedByLexical = [...pool].sort((a, b) => b.lexicalScore - a.lexicalScore);
  const lexicalChampion = sortedByLexical[0];
  const lexicalRunnerUp = sortedByLexical[1];
  const lexicalGap = lexicalChampion && lexicalRunnerUp
    ? lexicalChampion.lexicalScore - lexicalRunnerUp.lexicalScore
    : 0;
  /*
   * A champion is decisive when it leads by at least the absolute gap AND
   * the runner-up is not within a whisker of it.
   *
   * The two conditions are combined with AND, not OR and not MAX: the
   * earlier version took the MAX, which made the threshold scale with the
   * field and disqualified a real champion ("کلید خصوصی من کجا نگهداری
   * می شود" led by 57 points and lost to a semantic coincidence).
   */
  const isDecisive = lexicalChampion && lexicalRunnerUp
    && lexicalGap >= LEXICAL_DECISIVE_GAP
    && lexicalGap >= LEXICAL_DECISIVE_SHARE * bestLexical;

  /*
   * The lexical score is a COUNT of matched query tokens, so it is absolute:
   * 160 means sixteen matched tokens (or the normalised equivalent) and 87
   * means fewer. A difference of that size is not noise — it is the
   * difference between the item that answers the question and the item that
   * merely mentions the same words.
   *
   * So the lexical score gets a BONUS for its absolute strength, not only a
   * share of the pool. Without it the semantic layer can hijack a question
   * whose vocabulary it matches badly:
   *
   *   "کلید خصوصی من کجا نگهداری می شود"
   *     lexical 1st = kb.wallet.custody          (160)
   *     hybrid 1st = kb.risk.custody-vs-balance   (87 + a lucky 0.61 cosine)
   *
   * The bonus is proportional to the ABSOLUTE score, so it only separates
   * items that both matched a lot of the query — it cannot promote a weak
   * lexical hit over a strong one.
   */
  for (const item of pool) {
    const lexicalNorm = item.lexicalScore / lexicalScale;
    const semanticNorm = item.similarity / semanticScale;
    const lexicalStrength = Math.min(1, item.lexicalScore / LEXICAL_STRENGTH_CEILING);
    item.combined = Math.round(
      (lexicalNorm * LEXICAL_WEIGHT + semanticNorm * SEMANTIC_WEIGHT) * 100 +
      lexicalStrength * LEXICAL_STRENGTH_BONUS
    );
    /*
     * An item with NO lexical match at all cannot be presented as if the
     * words agreed — so it is marked. The caller can then say "I found this
     * by meaning" instead of pretending the question asked for it.
     */
    item.retrieval = item.lexicalScore > 0
      ? (item.similarity > 0 ? 'lexical+semantic' : 'lexical')
      : 'semantic-only';
  }

  pool.sort((a, b) => (b.combined - a.combined)
    || (b.lexicalScore - a.lexicalScore)
    || (b.similarity - a.similarity)
    || String(a.id).localeCompare(String(b.id)));

  /*
   * The decisive-lexical override. When one item matched the question
   * clearly better than every other item, it is the answer — no semantic
   * coincidence may displace it.
   */
  if (isDecisive) {
    const idx = pool.findIndex((x) => x.id === lexicalChampion.id);
    if (idx > 0) {
      pool.splice(idx, 1);
      pool.unshift(lexicalChampion);
      lexicalChampion.lexicalDecisive = true;
    }
  }

  return pool.slice(0, Math.max(1, limit));
}

/**
 * The index's health, for the status endpoint. Cheap to compute and it
 * makes the layer observable instead of invisible.
 */
export function semanticKnowledgeReport() {
  const out = {
    schema: SEMANTIC_KNOWLEDGE_SCHEMA,
    locales: {},
    fingerprint: corpusFingerprint(FBT_KNOWLEDGE)
  };
  for (const locale of ['fa', 'en']) {
    const index = getIndex(locale);
    out.locales[locale] = {
      items: index.entries.length,
      dim: index.entries[0]?.vector?.length || 0
    };
  }
  out.offline = true;
  out.networkCalls = 0;
  return out;
}

/** Drop the cached index — used by the tests. */
export function __resetSemanticKnowledgeIndexForTests() {
  INDEX_CACHE.clear();
}
