/**
 * THE REASONING LEDGER
 * ---------------------------------------------------------------------------
 * Lever #4 of docs/AI-COGNITION-AUDIT-2026-11-11.md — the OPEN lever.
 *
 * ─── THE FINDING ────────────────────────────────────────────────────────────
 * The pipeline ASKED for reasoning and then THREW IT AWAY.
 *
 * `deepReasoning` (server/aiCollaboration.js) says, in the smartest mode:
 *
 *     "before answering, identify the 2-3 facts that actually decide this
 *      question and reason from them. Name the strongest counter-argument
 *      against your own conclusion."
 *
 * That instruction is real, and it is good. But it goes into the SYSTEM
 * PROMPT as prose, while the JSON SHAPE the model must answer is:
 *
 *     { "answer": "your analysis, 2-5 sentences",
 *       "claims": [...],
 *       "uncertainty": "..." }
 *
 * So the model reasons — and the reasoning is discarded, because the schema
 * has nowhere to put it. Only the CONCLUSION comes back.
 *
 * And that is precisely the state in which a weaker seat looks exactly like a
 * stronger one. A 27B model asked to "reason from the deciding facts" and
 * then report only its conclusion produces a fluent, plausible, *unverifiable*
 * conclusion. The pipeline cannot tell it apart from a 550B model's
 * conclusion, because it never sees the path.
 *
 * The evidence the analysis produced is not the same as the evidence the
 * conclusion rests on. When the path is never captured, the pipeline cannot
 * check that the "2-3 deciding facts" it was told to use actually appear in
 * the answer — and it cannot cross-check one seat's reasoning against
 * another's.
 *
 * ─── WHAT THIS DOES ─────────────────────────────────────────────────────────
 * It gives the reasoning somewhere to GO.
 *
 * 1. The JSON shape gains an optional `"reasoning"` field: the deciding
 *    facts and the inference from them, in the model's own words.
 * 2. The reasoning is captured per role, and carried into the synthesis as a
 *    separate block — so the final synthesiser sees not just five
 *    conclusions but five PATHS.
 * 3. The reasoning is checked against the answer it produced: a conclusion
 *    that cites facts which never appear in the reasoning is a conclusion
 *    the pipeline can now FLAG rather than trust.
 *
 * ─── WHY IT IS NOT A PROMPT TWEAK ───────────────────────────────────────────
 * Adding "think step by step" to a prompt makes a model produce more text;
 * it does not make the pipeline able to USE what the model thought. The
 * difference between the two is measurable: with the ledger, the answer's
 * claims can be traced to a deciding fact; without it, they cannot.
 *
 * The cost is one optional JSON field. A seat that does not fill it behaves
 * exactly as it does today — which is why this is safe to ship: it can only
 * add evidence, never remove it.
 */

export const REASONING_LEDGER_SCHEMA = 'fbt.ai.reasoning-ledger.v1';

/* -------------------------------------------------------------------------- */
/*  THE SCHEMA                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The optional reasoning field, added to the analysis JSON shape.
 *
 * It is OPTIONAL on purpose. A seat that answers without it still works; the
 * ledger then simply has one fewer path to check. Forcing it would make a
 * weaker seat emit a fake path, which is worse than no path.
 */
export const REASONING_FIELD_SHAPE = `
"reasoning": {
  "decidingFacts": ["the 2-3 facts that actually decide this question, each quoted or named from the provided evidence"],
  "inference": "the step from those facts to your conclusion, in one or two sentences"
}`;

/**
 * The instruction that goes with the field. It is a CONTRACT, not a hint:
 * the facts must come from the provided evidence, and the inference must be
 * the actual derivation.
 */
export const REASONING_CONTRACT = `
REASONING (required in the "reasoning" field, and it is checked):
- "decidingFacts": the 2-3 facts that ACTUALLY DECIDE this question. Each one must be
  present in the evidence you were given — quote it or name it exactly. Do not list facts
  that are merely related. If the evidence is thin, say so and name the reading that would settle it.
- "inference": the step FROM those facts TO your conclusion. If you cannot write that step
  without inventing something, your conclusion is not supported — say what is missing instead.
This field is not decoration: your answer's claims are checked against it. A claim your
reasoning does not support will be removed.`;

/* -------------------------------------------------------------------------- */
/*  THE CAPTURE                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Read the reasoning out of a parsed role response.
 *
 * It is forgiving on purpose. A model may return the facts as strings, as
 * objects, as a single string, or not at all — and a partially usable path
 * is still a path worth checking. What is NOT forgiven is a fact that is
 * empty or is a placeholder.
 *
 * It also accepts an ALREADY-CAPTURED reasoning object, so the function is
 * idempotent: capturing twice returns the same thing. That matters because
 * the ledger is built from analyses whose reasoning was captured once at the
 * role call, and re-capturing must not silently return null.
 */
export function captureReasoning(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;

  /* Already captured? Return it as it is. */
  if (parsed.decidingFacts || parsed.deciding_facts) {
    const facts = Array.isArray(parsed.decidingFacts)
      ? parsed.decidingFacts
          .map((f) => {
            if (typeof f === 'string') return f.trim();
            if (f && typeof f === 'object') return String(f.fact || f.text || f.claim || '').trim();
            return '';
          })
          .filter(Boolean)
          .slice(0, 5)
      : [];
    const inference = String(parsed.inference ?? '').trim().slice(0, 600);
    if (!facts.length && !inference) return null;
    return {
      decidingFacts: facts,
      inference,
      usable: facts.length >= 1 && inference.length >= 12
    };
  }

  const raw = parsed.reasoning;
  if (!raw || typeof raw !== 'object') return null;

  let facts = [];
  let inference = '';

  if (Array.isArray(raw)) {
    /* Some models return the reasoning as an array of steps. */
    facts = raw
      .map((s) => {
        if (typeof s === 'string') return s.trim();
        if (s && typeof s === 'object') return String(s.fact || s.text || s.step || '').trim();
        return '';
      })
      .filter(Boolean);
    inference = facts.join(' ');
  } else {
    const list = raw.decidingFacts ?? raw.deciding_facts ?? raw.facts ?? raw.keyFacts ?? raw.reasoning;
    if (Array.isArray(list)) {
      /*
       * A fact may be a plain string OR an object with the fact inside it.
       * The string case must be handled FIRST — `f?.fact` on a string is
       * undefined, so a plain-string fact would fall through to the empty
       * fallback and be silently dropped. That is how the canonical shape
       * ended up with zero facts.
       */
      facts = list
        .map((f) => {
          if (typeof f === 'string') return f.trim();
          if (f && typeof f === 'object') return String(f.fact || f.text || f.claim || f.value || '').trim();
          return '';
        })
        .filter(Boolean);
    } else if (typeof list === 'string') {
      facts = list.split(/\n+/).map((s) => s.replace(/^[-*\d.)\s]+/, '').trim()).filter(Boolean);
    }
    inference = String(raw.inference ?? raw.conclusion ?? raw.reasoning ?? raw.step ?? '').trim();
  }

  facts = facts.filter((f) => f.length >= 3 && !/^(n\/?a|none|unknown|todo|\.+|-)$/i.test(f)).slice(0, 5);
  if (!facts.length && !inference) return null;

  return {
    decidingFacts: facts,
    inference: inference.slice(0, 600),
    /* A path needs at least one fact AND the inference, or it is not a path —
       it is a restatement of the answer. */
    usable: facts.length >= 1 && inference.length >= 12
  };
}

/* -------------------------------------------------------------------------- */
/*  THE CHECK                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Does the answer actually use the facts its own reasoning named?
 *
 * This is the part that makes the ledger more than bookkeeping. A seat that
 * was told to reason from the deciding facts, and then produced a conclusion
 * that mentions none of them, has not reasoned — it has asserted. The
 * pipeline can now SEE that, and the verifier can be told.
 *
 * The comparison is deliberately forgiving: a fact may be paraphrased in the
 * answer, so the test is on the LONGEST tokens of the fact, not the whole
 * string. It looks for substance, not for a copied sentence.
 */
export function checkReasoningSupportsAnswer(reasoning, answer) {
  if (!reasoning || !reasoning.usable) {
    return { checked: false, supported: null, unsupportedClaims: [], note: 'no reasoning captured' };
  }
  const text = String(answer || '').toLowerCase();
  if (!text) return { checked: false, supported: null, unsupportedClaims: [], note: 'empty answer' };

  const contentTokens = new Set(
    text.replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((t) => t.length >= 4)
  );

  const used = [];
  const unused = [];
  for (const fact of reasoning.decidingFacts) {
    const tokens = fact
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .split(' ')
      .filter((t) => t.length >= 4)
      .map((t) => t.toLowerCase());
    if (!tokens.length) continue;
    /* A fact counts as USED when a meaningful share of its distinctive words
       appears in the answer. One shared word is a coincidence; most of them
       is the fact being carried through. */
    const hits = tokens.filter((t) => contentTokens.has(t)).length;
    const ratio = hits / tokens.length;
    if (ratio >= 0.34 || hits >= 2) used.push(fact);
    else unused.push(fact);
  }

  const supported = unused.length === 0 ? true : (used.length > 0 ? 'partial' : false);
  return {
    checked: true,
    supported,
    usedFacts: used,
    unusedFacts: unused,
    unsupportedClaims: unused,
    note: supported === true
      ? 'the answer carries the facts its own reasoning named'
      : supported === 'partial'
        ? 'the answer drops some of the facts its reasoning named'
        : 'the answer does not carry the facts its reasoning named'
  };
}

/* -------------------------------------------------------------------------- */
/*  THE LEDGER                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The ledger for one turn: every role's reasoning path, and every check of
 * whether that role's answer carries its own path.
 */
export function buildReasoningLedger(analyses = []) {
  const paths = [];
  for (const a of analyses) {
    if (!a || !a.ok) continue;
    const reasoning = captureReasoning(a.reasoning) || captureReasoning(a);
    if (!reasoning) continue;
    const check = checkReasoningSupportsAnswer(reasoning, a.answer);
    paths.push({
      role: a.role,
      provider: a.provider || null,
      model: a.model || null,
      decidingFacts: reasoning.decidingFacts,
      inference: reasoning.inference,
      usable: reasoning.usable,
      check
    });
  }

  const checked = paths.filter((p) => p.check.checked);
  const unsupported = checked.filter((p) => p.check.supported === false);
  const partial = checked.filter((p) => p.check.supported === 'partial');

  return {
    schema: REASONING_LEDGER_SCHEMA,
    paths,
    stats: {
      rolesWithReasoning: paths.length,
      rolesChecked: checked.length,
      fullySupported: checked.length - unsupported.length - partial.length,
      partiallySupported: partial.length,
      unsupported: unsupported.length
    }
  };
}

/**
 * Render the ledger for the SYNTHESIS prompt.
 *
 * The point is that the synthesiser sees the PATHS, not only the
 * conclusions. Two analysts that reached the same answer by different routes
 * are corroborating; two that reached it by the same route are not — and
 * without the paths the synthesiser cannot tell those apart.
 *
 * It is deliberately compact. The digest already carries the conclusions;
 * this adds the deciding facts and the inference, which is what a conclusion
 * cannot be checked against on its own.
 */
export function renderReasoningLedger(ledger, { maxPaths = 4, maxChars = 2600 } = {}) {
  if (!ledger || !Array.isArray(ledger.paths) || !ledger.paths.length) return '';

  const usable = ledger.paths.filter((p) => p.decidingFacts?.length || p.inference);
  if (!usable.length) return '';

  const lines = [];
  lines.push('REASONING PATHS (how each specialist reached its conclusion — use these to judge, not just to repeat):');
  for (const p of usable.slice(0, maxPaths)) {
    const facts = (p.decidingFacts || []).slice(0, 3).map((f) => `- ${f}`).join('\n');
    const inference = p.inference ? `\n  inference: ${p.inference.slice(0, 260)}` : '';
    const flag = p.check?.checked && p.check.supported === false
      ? '\n  [WARNING: this conclusion does not carry the facts its own reasoning named — treat it as asserted, not reasoned]'
      : '';
    lines.push(`\n[${p.role}]${facts}${inference}${flag}`);
  }

  /* The unsupported conclusions are the valuable part — they are the seats
     whose path does not support their claim, and the synthesiser must be
     told to qualify them rather than launder them. */
  const unsupported = usable.filter((p) => p.check?.checked && p.check.supported === false);
  if (unsupported.length) {
    lines.push(
      `\nHARD RULE: ${unsupported.length} conclusion(s) above are not supported by their own ` +
      'reasoning. Do not carry their claims forward unqualified — state the uncertainty instead.'
    );
  }

  const text = lines.join('\n');
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…` : text;
}

/* -------------------------------------------------------------------------- */
/*  THE LAST TURN — for the status endpoint                                    */
/* -------------------------------------------------------------------------- */

/*
 * The ledger of the most recent turn, so an operator can see it without
 * reading the answer. It is ONE record, not a history: the point is to make
 * the layer observable, and a bounded "last turn" is observable without
 * becoming a store.
 */
let LAST_LEDGER = null;

/** Record the ledger of the turn that just finished. */
export function recordReasoningLedger(ledger) {
  LAST_LEDGER = ledger ? reasoningLedgerSummary(ledger) : null;
  return LAST_LEDGER;
}

/** The last turn's ledger summary, or null if no turn has been recorded. */
export function lastReasoningLedger() {
  return LAST_LEDGER;
}

/**
 * A one-line summary for the status endpoint and the benchmark record.
 */
export function reasoningLedgerSummary(ledger) {
  if (!ledger) return null;
  const s = ledger.stats || {};
  return {
    schema: ledger.schema,
    rolesWithReasoning: s.rolesWithReasoning ?? 0,
    rolesChecked: s.rolesChecked ?? 0,
    fullySupported: s.fullySupported ?? 0,
    partiallySupported: s.partiallySupported ?? 0,
    unsupported: s.unsupported ?? 0,
    paths: (ledger.paths || []).map((p) => ({
      role: p.role,
      model: p.model,
      facts: (p.decidingFacts || []).length,
      supported: p.check?.supported ?? null
    }))
  };
}
