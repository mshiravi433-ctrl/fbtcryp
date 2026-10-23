/**
 * EXTERNAL AGENT HUB — the agent the user is talking to, in the CHAT.
 * ---------------------------------------------------------------------------
 * Before this file existed, an agent could only work inside the hub panel: you
 * opened Agents → external agents → an agent → typed → got a result, then went
 * back. The chat — the place the product is actually used — knew nothing about
 * it, so its suggestion chips kept offering generic intents that had nothing to
 * do with the agent the user had just activated.
 *
 * This module is the smallest bridge that fixes that without touching the
 * intent engine:
 *
 *   · ONE active agent, stored by a stable snapshot (never the whole provider
 *     object, never a credential). It survives a reload.
 *   · A subscription, so the hub panel, the chat dock and the suggestion row
 *     all read the same value at the same time.
 *   · A one-slot prompt queue: a suggestion chip in the main chat can hand a
 *     prompt to the dock without either component owning the other.
 *
 * Nothing here executes anything. Activating an agent is a UI fact; every run
 * still goes through the same broker, consent composer and kill switches.
 */

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'fbt.agentHub.active.v1';
const ACTIVE_EVENT = 'fbt:agent-hub-active';
const PROMPT_EVENT = 'fbt:agent-hub-prompt';

/** Only these fields are stored. Anything absent is re-read from the catalogue. */
const KEEP = [
  'id', 'providerId', 'providerName', 'source', 'name', 'nameFa', 'summary',
  'summaryFa', 'examples', 'examplesFa', 'category', 'native', 'status',
  'dataSources', 'dataDisclosure', 'accessModel', 'costSummary', 'requiresAccount', 'requiresPayment',
  'paidInvocationEnabled'
];

const storage = () => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

/** A stored snapshot is only usable if it still names an agent and a provider. */
export function isUsableAgent(agent) {
  return Boolean(agent && typeof agent.id === 'string' && agent.id.trim() && typeof agent.providerId === 'string' && agent.providerId.trim());
}

function trimForStorage(agent) {
  const out = { activatedAt: Date.now() };
  for (const key of KEEP) {
    const value = agent?.[key];
    if (value === undefined || value === null) continue;
    if (key === 'dataDisclosure' && Array.isArray(value)) {
      out[key] = value.slice(0, 8).filter((row) => row && typeof row === 'object').map((row) => ({
        source: String(row.source || '').slice(0, 80),
        en: String(row.en || '').slice(0, 500),
        fa: String(row.fa || '').slice(0, 500)
      }));
    } else {
      out[key] = Array.isArray(value) ? value.slice(0, 8).map((v) => String(v).slice(0, 240)) : value;
    }
  }
  const provider = agent?.provider && typeof agent.provider === 'object' ? agent.provider : null;
  if (provider) {
    out.provider = {};
    for (const key of ['websiteUrl', 'documentationUrl', 'termsUrl', 'privacyUrl', 'supportUrl', 'reviewedAt']) {
      if (provider[key]) out.provider[key] = String(provider[key]).slice(0, 300);
    }
    if (provider.dataPolicy && typeof provider.dataPolicy === 'object') {
      out.provider.dataPolicy = {
        promptTraining: provider.dataPolicy.promptTraining ? String(provider.dataPolicy.promptTraining).slice(0, 160) : null,
        dataRetention: provider.dataPolicy.dataRetention ? String(provider.dataPolicy.dataRetention).slice(0, 160) : null
      };
    }
  }
  return out;
}

const validSnapshot = (value) => (isUsableAgent(value) ? value : null);

/** The agent the chat is currently pointed at, or null. Never throws. */
export function readActiveAgent() {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return null;
    return validSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}

function emit(name, detail) {
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof window.CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent(name, { detail }));
    }
  } catch {
    /* A blocked CustomEvent must not break activation. */
  }
}

/** Activate `agent` for the chat. Returns the stored snapshot. */
export function setActiveAgent(agent) {
  if (!isUsableAgent(agent)) throw new Error('ACTIVE_AGENT_INVALID');
  const snapshot = trimForStorage(agent);
  const store = storage();
  try {
    if (store) store.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    /* Private mode / quota: the in-memory value still works for this tab. */
  }
  emit(ACTIVE_EVENT, snapshot);
  return snapshot;
}

export function clearActiveAgent() {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  emit(ACTIVE_EVENT, null);
}

/** Subscribe to activation changes. Returns the unsubscriber. */
export function subscribeActiveAgent(listener) {
  if (typeof window === 'undefined' || typeof listener !== 'function') return () => {};
  const handler = () => listener(readActiveAgent());
  const storageHandler = (event) => {
    /* Another tab changed the active agent. */
    if (event?.key === STORAGE_KEY) handler();
  };
  window.addEventListener(ACTIVE_EVENT, handler);
  window.addEventListener('storage', storageHandler);
  return () => {
    window.removeEventListener(ACTIVE_EVENT, handler);
    window.removeEventListener('storage', storageHandler);
  };
}

/** React binding: one value, every subscriber re-renders together. */
export function useActiveAgent() {
  const [agent, setAgent] = useState(() => readActiveAgent());
  useEffect(() => subscribeActiveAgent((next) => setAgent(next)), []);
  return agent;
}

/* ── one-slot prompt hand-off between the chat row and the dock ───────────── */

let pendingPrompt = null;

export function requestAgentPrompt(prompt, meta = {}) {
  const value = typeof prompt === 'string' ? prompt : String(prompt?.prompt || '');
  if (!value.trim()) return;
  pendingPrompt = { prompt: value.slice(0, 2000), ...meta };
  emit(PROMPT_EVENT, pendingPrompt);
}

export function consumeAgentPrompt() {
  const value = pendingPrompt;
  pendingPrompt = null;
  return value;
}

export function subscribeAgentPrompt(listener) {
  if (typeof window === 'undefined' || typeof listener !== 'function') return () => {};
  const handler = (event) => {
    const value = event?.detail || consumeAgentPrompt();
    if (value) listener(value);
  };
  window.addEventListener(PROMPT_EVENT, handler);
  return () => window.removeEventListener(PROMPT_EVENT, handler);
}

/**
 * Chips for the main chat row, derived ONLY from the agent's own examples.
 * An agent with no examples yields no chips — the row never invents a prompt
 * the agent has not advertised.
 */
export function agentChatChips(agent, fa = false) {
  if (!isUsableAgent(agent)) return [];
  const examples = (fa
    ? (agent.examplesFa?.length ? agent.examplesFa : agent.examples)
    : (agent.examples?.length ? agent.examples : agent.examplesFa)) || [];
  return examples
    .filter((example) => typeof example === 'string' && example.trim())
    .slice(0, 4)
    .map((example, index) => ({
      id: `agent-chip-${agent.id}-${index}`,
      label: example.slice(0, 64),
      prompt: example,
      agentPrompt: true
    }));
}

/** Test/dev hook: drop the pending prompt. */
export function _resetAgentPrompt() {
  pendingPrompt = null;
}
