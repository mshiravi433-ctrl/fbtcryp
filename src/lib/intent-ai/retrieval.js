/**
 * FBT INTENT OS — LIGHTWEIGHT RETRIEVAL (BM25, zero dependencies)
 * ---------------------------------------------------------------------------
 * The one idea worth taking from LlamaIndex (run-llama/llama_index, MIT) for
 * a Node app that must stay dependency-light: retrieve a few relevant,
 * VERIFIED passages per question and hand only those to the model, with
 * their ids, so the answer can cite what it stands on.
 *
 * Why not LlamaIndex itself: it is a Python platform (the TS port is archived)
 * and would mean a second runtime and a vector database for ~50 documents.
 * BM25 over a small curated corpus is deterministic, instant, offline,
 * reproducible in tests — and at this corpus size it is as good as dense
 * embeddings, because the vocabulary users type is the vocabulary we wrote.
 *
 * Corpus (both already hand-checked against the code — nothing new claimed):
 *   · knowledgeCenter FBT_KNOWLEDGE — verified product facts (fa/en)
 *   · faqLocal KB — the 36 Help-screen answers (fa/en/ar), fee-filled
 *
 * Improvements over the existing token-overlap search:
 *   · BM25 weighting: rare, specific words («اسلیپیج», "revoke") outrank
 *     common ones («چطور», "how")
 *   · Persian/Arabic normalisation (ي→ی, ك→ک, ZWNJ, diacritics, digits) via
 *     the same normaliser the intent engine uses
 *   · light Persian suffix stemming («کیف‌پولم» → «کیف پول»)
 *   · cross-language: a Persian question can match an English-keyworded FAQ
 *     entry through its multilingual keyword list
 *   · a minimum-score floor, so "no good match" returns nothing instead of
 *     the least-bad passage
 */

import { normalizeUpgrade4 } from './os/intentUnderstandingEngine.js';
import { FBT_KNOWLEDGE } from './os/knowledgeCenter.js';
import { faqCorpus } from '../faqLocal.js';

export const RETRIEVAL_SCHEMA = 'fbt.retrieval.bm25.v1';

const K1 = 1.4;
const B = 0.72;
/** Below this, a hit is noise — callers get nothing rather than a guess. */
export const MIN_SCORE = 1.6;
/** A multi-word question must have at least this share of its words matched:
 *  one rare word («امروز») out of three is a coincidence, not an answer. */
export const MIN_COVERAGE = 0.5;
/** Extra weight for a query word that is in the passage's title/keywords. */
const FIELD_BOOST = 0.9;

const STOP = new Set([
  // fa
  'این', 'اون', 'آن', 'که', 'را', 'رو', 'با', 'از', 'به', 'در', 'برای', 'چی', 'چیه', 'چه', 'است', 'هست', 'میشه', 'می', 'من', 'تو', 'ما',
  'یک', 'یه', 'هم', 'اگر', 'اگه', 'باید', 'کنم', 'کنید', 'کن', 'شد', 'شده', 'بود', 'دارم', 'داره', 'چطور', 'چگونه', 'کجا', 'چرا', 'آیا',
  'چطوره', 'چطوری', 'چقدر', 'چقدره', 'چیست', 'کنه', 'میکنه', 'میکنم', 'بگو', 'لطفا', 'لطفاً', 'خب', 'واقعا',
  'نمیشه', 'میشه', 'نمی', 'نیست', 'هستش', 'کسی', 'چیزی', 'رو', 'تا', 'بعد', 'قبل', 'الان', 'خیلی',
  // en
  'the', 'a', 'an', 'is', 'are', 'was', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'it', 'my', 'me', 'i', 'you', 'how', 'what', 'why',
  'can', 'do', 'does', 'this', 'that', 'with', 'be', 'where', 'when', 'will', 'your', 'from', 'at', 'as', 'by',
  'not', 'no', 'dont', 'wont', 'cant', 'doesnt', 'isnt', 'didnt', 'im', 'please', 'there', 'any', 'get',
  // ar
  'في', 'من', 'على', 'هل', 'ما', 'كيف', 'هذا'
]);

/* Persian inflection: possessives, plurals, verb endings. Longest first. */
const FA_SUFFIXES = ['هایم', 'هایت', 'هایش', 'هامون', 'هاتون', 'هاشون', 'هایی', 'های', 'ها', 'ام', 'ات', 'اش', 'مان', 'تان', 'شان', 'یم', 'ید', 'ند', 'م', 'ت', 'ش', 'ی'];

function stem(word) {
  if (/^[\u0600-\u06FF]+$/.test(word) && word.length >= 4) {
    for (const s of FA_SUFFIXES) {
      if (word.length - s.length >= 3 && word.endsWith(s)) return word.slice(0, -s.length);
    }
  }
  if (/^[a-z]+$/.test(word) && word.length > 4) {
    return word.replace(/(ing|ed|es|s)$/, '');
  }
  return word;
}

export function tokenize(text) {
  return normalizeUpgrade4(String(text || ''))
    .replace(/\u200c/g, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length >= 2 && !STOP.has(w))
    .map(stem);
}

/* ------------------------------- the index -------------------------------- */

function buildDocs() {
  const docs = [];
  for (const item of FBT_KNOWLEDGE) {
    if (item.status === 'deprecated') continue;
    docs.push({
      id: item.id,
      kind: 'knowledge',
      category: item.category,
      status: item.status,
      confidence: item.confidence,
      source: item.source,
      title: { fa: item.titleFa, en: item.titleEn },
      body: { fa: item.bodyFa, en: item.bodyEn },
      /* Title words get a field bonus at query time — they say what the
         passage is ABOUT. Not repeated in the text: repetition inflates
         document length, which BM25 then penalises. */
      keys: `${item.titleFa} ${item.titleEn}`,
      text: `${item.titleFa} ${item.titleEn} ${item.bodyFa} ${item.bodyEn} ${item.category}`
    });
  }
  for (const f of faqCorpus()) {
    const kw = f.keywords.join(' ');
    docs.push({
      id: `faq.${f.id}`,
      kind: 'faq',
      category: 'FAQ',
      status: 'verified',
      confidence: 95,
      source: 'fbt-help',
      title: { fa: f.id, en: f.id },
      body: f.answers,
      /* Keywords are the questions users actually type → field bonus. */
      keys: kw,
      text: `${kw} ${f.answers.fa || ''} ${f.answers.en || ''}`
    });
  }
  return docs;
}

let INDEX = null;

export function buildIndex() {
  const docs = buildDocs();
  const df = new Map();
  let totalLen = 0;
  for (const d of docs) {
    const tokens = tokenize(d.text);
    d.len = tokens.length;
    totalLen += d.len;
    d.tf = new Map();
    for (const t of tokens) d.tf.set(t, (d.tf.get(t) || 0) + 1);
    for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    d.keySet = new Set(tokenize(d.keys || ''));
  }
  INDEX = { docs, df, N: docs.length, avgLen: docs.length ? totalLen / docs.length : 1, builtAt: Date.now() };
  return INDEX;
}

function index() { return INDEX || buildIndex(); }

function idf(term) {
  const { df, N } = index();
  const n = df.get(term) || 0;
  return Math.log(1 + (N - n + 0.5) / (n + 0.5));
}

/**
 * Retrieve the top passages for `query`.
 * @returns {Array<{id, kind, category, status, confidence, source, title, body, score}>}
 */
export function retrieve(query, { locale = 'fa', limit = 3, kinds = null, minScore = MIN_SCORE } = {}) {
  const q = [...new Set(tokenize(query))];
  if (!q.length) return [];
  const { docs, avgLen } = index();
  const lang = String(locale || 'fa').slice(0, 2);
  const totalIdf = q.reduce((sum, t) => sum + idf(t), 0) || 1;
  const scored = [];
  for (const d of docs) {
    if (kinds && !kinds.includes(d.kind)) continue;
    let score = 0;
    let matchedIdf = 0;
    for (const t of q) {
      const f = d.tf.get(t);
      if (!f) continue;
      const w = idf(t);
      matchedIdf += w;
      score += w * ((f * (K1 + 1)) / (f + K1 * (1 - B + B * (d.len / avgLen))));
      if (d.keySet.has(t)) score += w * FIELD_BOOST;
    }
    if (score < minScore) continue;
    /* IDF-weighted coverage: the share of the question's INFORMATION this
       passage explains. A rare unmatched word («هوا» — not in the corpus at
       all) weighs a lot; a common unmatched word («کار») weighs little. So
       «هوا امروز» ↛ a passage that happens to say «امروز», while
       «بریج … کار» still → the bridge passage. */
    if (q.length >= 2 && matchedIdf / totalIdf < MIN_COVERAGE) continue;
    scored.push({
      schema: RETRIEVAL_SCHEMA,
      id: d.id,
      kind: d.kind,
      category: d.category,
      status: d.status,
      confidence: d.confidence,
      source: d.source,
      title: d.title[lang] || d.title.en || d.title.fa,
      body: d.body[lang] || d.body.en || d.body.fa,
      score: Math.round(score * 100) / 100
    });
  }
  return scored
    .sort((a, b) => (b.score - a.score) || a.id.localeCompare(b.id))
    .slice(0, Math.min(8, Math.max(1, Number(limit) || 3)));
}

/** Compact grounding block for a prompt, with citable ids. */
export function groundingBlock(passages = [], { maxChars = 1400 } = {}) {
  if (!passages.length) return '';
  const lines = ['VERIFIED FBT KNOWLEDGE (cite the [id] you rely on; do not contradict it):'];
  let used = lines[0].length;
  for (const p of passages) {
    const line = `- [${p.id}] ${p.title}: ${String(p.body).replace(/\s+/g, ' ').slice(0, 420)}`;
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length;
  }
  return lines.join('\n');
}

export function retrievalStats() {
  const { docs, df, N, avgLen, builtAt } = index();
  return {
    schema: RETRIEVAL_SCHEMA,
    documents: N,
    knowledge: docs.filter((d) => d.kind === 'knowledge').length,
    faq: docs.filter((d) => d.kind === 'faq').length,
    vocabulary: df.size,
    avgLength: Math.round(avgLen),
    builtAt
  };
}
