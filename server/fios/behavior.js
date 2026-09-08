/**
 * FBT FINANCIAL INTELLIGENCE OS — Behaviour Model (§9).
 * ---------------------------------------------------------------------------
 * Analyses VERIFIED history only. An action that was proposed, quoted or even
 * signed but never confirmed on-chain is not behaviour, and recording it would
 * let a failed transaction teach the model the wrong lesson.
 *
 * Every signal carries `samples` and `ratio`, and nothing is published below
 * MIN_BEHAVIOR_EVENTS — "the user rejected leverage twice" is an anecdote, not
 * a pattern. Signals are written to Memory 2.0 as USER_BEHAVIOR (or
 * AI_INFERRED when the pattern is a conclusion rather than a count), which
 * means an explicit statement still outranks them.
 */

export const BEHAVIOR_SCHEMA = 'fbt.fi.behavior.v1';

export const BEHAVIOR_SIGNALS = Object.freeze([
  'REJECTS_LEVERAGE', 'ACCEPTS_LEVERAGE',
  'PREFERS_LOW_FEE_ROUTES', 'PREFERS_FAST_ROUTES',
  'PREFERS_DCA', 'PREFERS_LUMP_SUM',
  'REJECTS_HIGH_RISK_PROTOCOLS', 'ACCEPTS_NEW_PROTOCOLS',
  'PREFERS_STABLES', 'PREFERS_MAJOR_ASSETS',
  'USES_CROSS_CHAIN_OFTEN', 'AVOIDS_CROSS_CHAIN',
  'CANCELS_AT_CONFIRMATION', 'CONFIRMS_QUICKLY'
]);

export const MIN_BEHAVIOR_EVENTS = 3;
const MAX_EVENTS = 80;
const ROW_ID = 'behavior-v1';

/** Event kinds this model understands. Anything else is stored but not scored. */
export const BEHAVIOR_EVENT_KINDS = Object.freeze([
  'PROPOSAL_ACCEPTED', 'PROPOSAL_REJECTED', 'EXECUTION_CONFIRMED',
  'EXECUTION_CANCELLED', 'ROUTE_CHOSEN', 'STRATEGY_CHOSEN', 'CONFIRMATION_LATENCY'
]);

const emptyRow = () => ({ schema: BEHAVIOR_SCHEMA, id: ROW_ID, events: [], signals: {}, updatedAt: 0 });

export function createBehaviorModel({ collections, memory = null, observability = null, log = () => {}, now = () => Date.now() } = {}) {
  async function load(owner) {
    const { ok, rows, code } = await collections.read('behavior_signals', owner);
    if (!ok) return { ok: false, code, row: emptyRow() };
    const row = rows.find((r) => r?.id === ROW_ID);
    return { ok: true, row: row ? { ...emptyRow(), ...row } : emptyRow() };
  }

  /** Record one verified observation. */
  async function ingest(owner, event = {}, { correlationId = null } = {}) {
    const kind = String(event.kind || '').toUpperCase();
    if (!BEHAVIOR_EVENT_KINDS.includes(kind)) return { ok: false, code: 'UNKNOWN_BEHAVIOR_EVENT', allowed: BEHAVIOR_EVENT_KINDS };
    /* Verified-only. A choice the user made with their own hands (accepting or
       declining a proposal, picking a route or a strategy, cancelling at the
       confirmation card) is verified by the act itself; everything that claims
       an on-chain effect must carry `verified: true` from the receipt path. */
    const VERIFIED_BY_THE_USER = ['PROPOSAL_REJECTED', 'PROPOSAL_ACCEPTED', 'EXECUTION_CANCELLED', 'ROUTE_CHOSEN', 'STRATEGY_CHOSEN', 'CONFIRMATION_LATENCY'];
    const verificationOk = VERIFIED_BY_THE_USER.includes(kind) || event.verified === true;
    if (!verificationOk) return { ok: false, code: 'EVENT_NOT_VERIFIED', detail: 'only verified actions may shape the behaviour model' };

    const loaded = await load(owner);
    if (!loaded.ok) return { ok: false, code: loaded.code };
    const row = loaded.row;
    row.events = [{
      kind,
      module: event.module ? String(event.module).slice(0, 40) : null,
      asset: event.asset ? String(event.asset).slice(0, 20) : null,
      chain: event.chain ? String(event.chain).slice(0, 24) : null,
      protocol: event.protocol ? String(event.protocol).slice(0, 40) : null,
      strategyKind: event.strategyKind ? String(event.strategyKind).slice(0, 40) : null,
      leveraged: event.leveraged === true,
      feesUsd: Number.isFinite(Number(event.feesUsd)) ? Number(event.feesUsd) : null,
      routeFeeRank: Number.isFinite(Number(event.routeFeeRank)) ? Number(event.routeFeeRank) : null,
      latencyMs: Number.isFinite(Number(event.latencyMs)) ? Number(event.latencyMs) : null,
      riskLevel: event.riskLevel ? String(event.riskLevel).slice(0, 16) : null,
      at: now()
    }, ...(row.events || [])].slice(0, MAX_EVENTS);

    const { signals, basis } = computeSignals(row.events);
    row.signals = signals;
    row.updatedAt = now();
    const res = await collections.put('behavior_signals', owner, row);

    /* Publish the durable patterns into Memory 2.0 so the preference model and
       the genome see them through one channel. */
    if (memory) {
      for (const [name, sig] of Object.entries(signals)) {
        if (sig.memoryKey) {
          await memory.remember(owner, {
            key: sig.memoryKey, value: sig.memoryValue, provenance: 'USER_BEHAVIOR',
            note: `${name}: ${sig.samples} samples, ratio ${sig.ratio}`, correlationId
          });
        }
      }
    }
    if (observability) observability.emit({ type: 'learning.completed', owner, correlationId, payload: { engine: 'behavior', kind, signals: Object.keys(signals) } });
    return { ok: true, signals, basis, events: row.events.length, durable: res.durable ?? collections.durable() };
  }

  async function signals(owner) {
    const loaded = await load(owner);
    if (!loaded.ok) return { ok: false, code: loaded.code, signals: {} };
    return { ok: true, signals: loaded.row.signals || {}, events: (loaded.row.events || []).length, minSamples: MIN_BEHAVIOR_EVENTS };
  }

  return { schema: BEHAVIOR_SCHEMA, ingest, signals, compute: (events) => computeSignals(events), BEHAVIOR_SIGNALS };
}

/**
 * Pure scoring over an event list. Deterministic and exported so the probes can
 * pin the arithmetic without touching storage.
 */
export function computeSignals(events = []) {
  const rows = Array.isArray(events) ? events : [];
  const signals = {};
  const basis = [];
  const count = (fn) => rows.filter(fn).length;

  const proposals = rows.filter((r) => r.kind === 'PROPOSAL_ACCEPTED' || r.kind === 'PROPOSAL_REJECTED');
  const levProposals = proposals.filter((r) => r.leveraged === true);
  const levRejected = levProposals.filter((r) => r.kind === 'PROPOSAL_REJECTED').length;
  if (levProposals.length >= MIN_BEHAVIOR_EVENTS) {
    const ratio = levRejected / levProposals.length;
    basis.push({ signal: 'REJECTS_LEVERAGE', samples: levProposals.length, ratio: Number(ratio.toFixed(2)) });
    if (ratio >= 0.66) signals.REJECTS_LEVERAGE = { samples: levProposals.length, ratio: Number(ratio.toFixed(2)), memoryKey: 'leverageTolerance', memoryValue: 'NONE' };
    else if (ratio <= 0.2) signals.ACCEPTS_LEVERAGE = { samples: levProposals.length, ratio: Number((1 - ratio).toFixed(2)), memoryKey: 'leverageTolerance', memoryValue: 'MODERATE' };
  }

  const routes = rows.filter((r) => r.kind === 'ROUTE_CHOSEN' && Number.isFinite(r.routeFeeRank));
  if (routes.length >= MIN_BEHAVIOR_EVENTS) {
    const cheap = routes.filter((r) => r.routeFeeRank <= 2).length;
    const ratio = cheap / routes.length;
    basis.push({ signal: 'PREFERS_LOW_FEE_ROUTES', samples: routes.length, ratio: Number(ratio.toFixed(2)) });
    if (ratio >= 0.66) signals.PREFERS_LOW_FEE_ROUTES = { samples: routes.length, ratio: Number(ratio.toFixed(2)), memoryKey: 'feeSensitivity', memoryValue: 'HIGH' };
  }

  const strategyChoices = rows.filter((r) => r.kind === 'STRATEGY_CHOSEN');
  if (strategyChoices.length >= MIN_BEHAVIOR_EVENTS) {
    const dca = strategyChoices.filter((r) => /dca|recurring/i.test(String(r.strategyKind || ''))).length;
    const ratio = dca / strategyChoices.length;
    basis.push({ signal: 'PREFERS_DCA', samples: strategyChoices.length, ratio: Number(ratio.toFixed(2)) });
    if (ratio >= 0.66) signals.PREFERS_DCA = { samples: strategyChoices.length, ratio: Number(ratio.toFixed(2)), memoryKey: 'preferredExecutionStyle', memoryValue: 'DCA' };
    else if (ratio <= 0.2) signals.PREFERS_LUMP_SUM = { samples: strategyChoices.length, ratio: Number((1 - ratio).toFixed(2)) };
  }

  const riskProps = proposals.filter((r) => r.riskLevel);
  if (riskProps.length >= MIN_BEHAVIOR_EVENTS) {
    const highRejected = riskProps.filter((r) => ['HIGH', 'CRITICAL'].includes(String(r.riskLevel).toUpperCase()) && r.kind === 'PROPOSAL_REJECTED').length;
    const highTotal = riskProps.filter((r) => ['HIGH', 'CRITICAL'].includes(String(r.riskLevel).toUpperCase())).length;
    if (highTotal >= MIN_BEHAVIOR_EVENTS) {
      const ratio = highRejected / highTotal;
      basis.push({ signal: 'REJECTS_HIGH_RISK_PROTOCOLS', samples: highTotal, ratio: Number(ratio.toFixed(2)) });
      if (ratio >= 0.66) signals.REJECTS_HIGH_RISK_PROTOCOLS = { samples: highTotal, ratio: Number(ratio.toFixed(2)), memoryKey: 'riskTolerance', memoryValue: 'CONSERVATIVE' };
    }
  }

  const fills = rows.filter((r) => r.kind === 'EXECUTION_CONFIRMED');
  if (fills.length >= MIN_BEHAVIOR_EVENTS) {
    const stables = fills.filter((r) => ['USDC', 'USDT', 'DAI'].includes(String(r.asset || '').toUpperCase())).length;
    if (stables / fills.length >= 0.5) signals.PREFERS_STABLES = { samples: fills.length, ratio: Number((stables / fills.length).toFixed(2)) };
    const majors = fills.filter((r) => ['BTC', 'ETH', 'SOL'].includes(String(r.asset || '').toUpperCase())).length;
    if (majors / fills.length >= 0.66) signals.PREFERS_MAJOR_ASSETS = { samples: fills.length, ratio: Number((majors / fills.length).toFixed(2)) };
    const bridges = fills.filter((r) => String(r.module || '').toLowerCase().includes('bridge')).length;
    if (bridges / fills.length >= 0.5) signals.USES_CROSS_CHAIN_OFTEN = { samples: fills.length, ratio: Number((bridges / fills.length).toFixed(2)) };
    else if (bridges === 0 && fills.length >= MIN_BEHAVIOR_EVENTS * 2) signals.AVOIDS_CROSS_CHAIN = { samples: fills.length, ratio: 0 };
  }

  const cancels = rows.filter((r) => r.kind === 'EXECUTION_CANCELLED').length;
  const confirmations = rows.filter((r) => r.kind === 'EXECUTION_CONFIRMED').length;
  if (cancels + confirmations >= MIN_BEHAVIOR_EVENTS) {
    const ratio = cancels / (cancels + confirmations);
    basis.push({ signal: 'CANCELS_AT_CONFIRMATION', samples: cancels + confirmations, ratio: Number(ratio.toFixed(2)) });
    if (ratio >= 0.4) signals.CANCELS_AT_CONFIRMATION = { samples: cancels + confirmations, ratio: Number(ratio.toFixed(2)) };
  }

  const latencies = rows.filter((r) => r.kind === 'CONFIRMATION_LATENCY' && Number.isFinite(r.latencyMs));
  if (latencies.length >= MIN_BEHAVIOR_EVENTS) {
    const mean = latencies.reduce((a, r) => a + r.latencyMs, 0) / latencies.length;
    if (mean < 15_000) signals.CONFIRMS_QUICKLY = { samples: latencies.length, ratio: 1, meanLatencyMs: Math.round(mean) };
  }

  return { signals, basis };
}
