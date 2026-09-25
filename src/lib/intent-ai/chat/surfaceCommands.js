/**
 * FBT INTENT OS — PHASE 213: ONE DOOR FOR CHAT COMMANDS
 * ---------------------------------------------------------------------------
 * `IntentAIUnified.sendMessage` is already 900 lines of pipeline. Adding four
 * more branches inline would make it un-reviewable, so the four commands this
 * phase introduces live here as pure functions with injected I/O:
 *
 *   «چه کارهایی می‌تونی؟»            → the whole Intent OS catalog
 *   «جستجو کن …» / «search for …»    → a real, cited web search
 *   «با ایجنت مذاکره کن» / «توافق»…  → negotiation / agreement / conflict
 *   anything else                    → null (the normal pipeline owns it)
 *
 * Everything is injected (`research`, `context`) so the node probe can run all
 * of it with no network and no React.
 */

import { catalogMessage, parseCatalogRequest, SURFACE_KINDS, surfaceMessage } from './osSurface.js';
import { negotiationToChatMessage, negotiationQuestion, parseNegotiationRequest, runChatNegotiation } from './negotiationChat.js';
import { parseSearchRequest, runChatSearch, searchToMessage } from './searchChat.js';

export const SURFACE_COMMAND_SCHEMA = 'fbt.chat-surface-command.v1';

/** Context the negotiation engines need, read from what the app already has. */
export function buildNegotiationContext({ wallet = null, portfolio = null, conversationState = null, services = null, extra = {} } = {}) {
  const slots = conversationState?.collectedSlots || {};
  const amountUsd = Number(slots.amountUsd ?? slots.amount ?? NaN);
  const asset = slots.token || slots.asset || null;
  const hasProposal = asset || Number.isFinite(amountUsd);
  return {
    proposal: hasProposal
      ? {
          id: `ctx_${Date.now().toString(36)}`,
          action: slots.action || extra.action || 'rebalance',
          asset,
          amountUsd: Number.isFinite(amountUsd) ? amountUsd : null,
          chainId: slots.chainId ?? null,
          risk: slots.riskProfile || extra.risk || null,
          evidenceComplete: true
        }
      : (extra.proposal || null),
    riskDecision: extra.riskDecision || null,
    guardianApproved: extra.guardianApproved !== false,
    plans: Array.isArray(extra.plans) ? extra.plans : [],
    votes: extra.votes || {},
    automations: services?.automations || extra.automations || null,
    monitors: services?.monitors || extra.monitors || null,
    counterparty: extra.counterparty || null,
    deadlineDays: extra.deadlineDays ?? null,
    externalAgent: extra.externalAgent || null,
    externalVerified: extra.externalVerified === true,
    externalView: extra.externalView || null,
    options: extra.options || null,
    walletConnected: Boolean(wallet?.address || wallet?.connected),
    portfolioValueUsd: Number(portfolio?.totalValueUsd ?? NaN)
  };
}

/**
 * Try the phase-213 commands. Returns:
 *   { handled:false }                        → normal pipeline
 *   { handled:true, message, question? }     → append the message; if a
 *                                              `question` is present it must be
 *                                              registered in the ledger
 */
export async function runSurfaceCommand(text, {
  locale = 'fa',
  context = {},
  research = null,
  conversationId = null
} = {}) {
  const raw = String(text || '').trim();
  if (!raw) return { handled: false };

  /* 1. The catalog — "what can you do". */
  if (parseCatalogRequest(raw)) {
    const catalog = catalogMessage({ locale });
    return {
      handled: true,
      command: 'CATALOG',
      message: surfaceMessage({
        kind: SURFACE_KINDS.CATALOG,
        title: catalog.title,
        lines: catalog.lines,
        chips: catalog.chips,
        payload: { entries: catalog.entries.map((e) => ({ id: e.id, kind: e.kind, title: e.title })) }
      }),
      chips: catalog.chips,
      question: null
    };
  }

  /* 2. Web search — an explicit door to the same engine the server uses. */
  const search = parseSearchRequest(raw, { locale });
  if (search) {
    const result = await runChatSearch({ query: search.query, locale, research });
    return {
      handled: true,
      command: 'SEARCH',
      message: searchToMessage(result, { query: search.query, locale }),
      search: result,
      question: null
    };
  }

  /* 3. Coordination — the human↔human / human↔agent / agent↔agent doors. */
  const negotiation = parseNegotiationRequest(raw, { locale });
  if (negotiation) {
    const result = runChatNegotiation({
      mode: negotiation.mode,
      intent: negotiation.intent,
      subject: negotiation.subject,
      context,
      locale
    });
    const question = negotiationQuestion(result, locale);
    return {
      handled: true,
      command: 'NEGOTIATION',
      message: negotiationToChatMessage(result, { locale }),
      negotiation: result,
      question: question ? { ...question, conversationId } : null
    };
  }

  return { handled: false };
}

export const SURFACE_COMMANDS_INFO = Object.freeze({
  schema: SURFACE_COMMAND_SCHEMA,
  commands: ['CATALOG', 'SEARCH', 'NEGOTIATION'],
  coordinationModes: ['human-human', 'human-agent', 'agent-agent', 'fbt-external-agent', 'emergency']
});
