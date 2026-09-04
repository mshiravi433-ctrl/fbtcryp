/**
 * FBT INTENT OS — Intent Session & Multi-Turn Context Continuity (Upgrade 4)
 * ---------------------------------------------------------------------------
 * Maintains active multi-turn intent state across user messages:
 *   - Current primary and secondary intents
 *   - Extracted entities (assets, amounts, network, timeframe, risk, target)
 *   - Missing critical fields ranked by priority
 *   - Assumptions made by the reasoning engine
 *   - Active confirmation status
 *   - User corrections history
 *   - Safety: NEVER stores private keys, seed phrases, passwords or tokens
 */

export const INTENT_SESSION_SCHEMA = 'fbt.intent-session.v4';
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

const sessionStore = new Map();

export class IntentSession {
  constructor(conversationId = 'default', initialProps = {}) {
    this.schema = INTENT_SESSION_SCHEMA;
    this.conversationId = conversationId;
    this.id = initialProps.id || `isess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    this.currentIntent = initialProps.currentIntent || null;
    this.previousIntent = null;
    this.activeEntities = { ...(initialProps.entities || {}) };
    this.entities = this.activeEntities;
    this.missingFields = Array.isArray(initialProps.missingFields) ? [...initialProps.missingFields] : [];
    this.assumptions = Array.isArray(initialProps.assumptions) ? [...initialProps.assumptions] : [];
    this.confidence = Number(initialProps.confidence) || 0;
    this.pendingConfirmation = Boolean(initialProps.pendingConfirmation);
    this.turnCount = initialProps.turnCount || 0;
    this.history = [];
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
    this.expiresAt = Date.now() + SESSION_TTL_MS;
  }

  updateTurn({ userMessage, intent, plan, isCorrection = false } = {}) {
    this.turnCount += 1;
    this.updatedAt = Date.now();
    this.expiresAt = Date.now() + SESSION_TTL_MS;

    if (intent) {
      if (intent.type && intent.type !== this.currentIntent) {
        this.previousIntent = this.currentIntent;
        this.currentIntent = intent.type;
      }
      if (intent.entities) {
        this.activeEntities = {
          ...this.activeEntities,
          ...intent.entities
        };
        this.entities = this.activeEntities;
      }
      if (intent.missingFields) this.missingFields = intent.missingFields;
      if (intent.assumptions) this.assumptions = intent.assumptions;
      if (intent.confidence != null) this.confidence = intent.confidence;
    }

    if (isCorrection) {
      this.lastCorrection = {
        at: Date.now(),
        from: this.previousIntent,
        to: this.currentIntent
      };
    }

    this.history.push({
      userMessage,
      intent: intent?.type || intent?.primaryIntent || this.currentIntent,
      at: Date.now()
    });

    saveIntentSession(this);
    return this;
  }

  resolveSlot(slotName) {
    return this.activeEntities[slotName] ?? null;
  }
}

export function getIntentSession(conversationId) {
  const cid = String(conversationId || 'default');
  let session = sessionStore.get(cid);
  if (!session) {
    session = new IntentSession(cid);
    sessionStore.set(cid, session);
  }
  return session;
}

export function saveIntentSession(session) {
  if (session && session.conversationId) {
    sessionStore.set(session.conversationId, session);
  }
}

export function createIntentSession({
  id = null,
  conversationId = null,
  currentIntent = null,
  entities = {},
  missingFields = [],
  assumptions = [],
  confidence = 0,
  pendingConfirmation = false,
  ttlMs = SESSION_TTL_MS
} = {}) {
  const cid = String(conversationId || 'default');
  return new IntentSession(cid, {
    id,
    currentIntent,
    entities,
    missingFields,
    assumptions,
    confidence,
    pendingConfirmation,
    ttlMs
  });
}

export function getOrCreateIntentSession(conversationId, initialProps = {}) {
  const cid = String(conversationId || 'default');
  const now = Date.now();
  
  // Clean up expired sessions periodically
  if (sessionStore.size > 200) {
    for (const [k, sess] of sessionStore.entries()) {
      if (sess.expiresAt < now) sessionStore.delete(k);
    }
  }

  let session = sessionStore.get(cid);
  if (!session || session.expiresAt < now) {
    session = new IntentSession(cid, initialProps);
    sessionStore.set(cid, session);
  }
  return session;
}

export function updateIntentSession(conversationId, updates = {}) {
  const cid = String(conversationId || 'default');
  const session = getOrCreateIntentSession(cid);
  const now = Date.now();

  if (updates.currentIntent && updates.currentIntent !== session.currentIntent) {
    session.previousIntent = session.currentIntent;
    session.currentIntent = updates.currentIntent;
  }

  if (updates.entities && typeof updates.entities === 'object') {
    session.activeEntities = {
      ...session.activeEntities,
      ...updates.entities
    };
    session.entities = session.activeEntities;
  }

  if (updates.missingFields) session.missingFields = updates.missingFields;
  if (updates.assumptions) session.assumptions = updates.assumptions;
  if (updates.confidence != null) session.confidence = Number(updates.confidence);
  if (updates.pendingConfirmation != null) session.pendingConfirmation = Boolean(updates.pendingConfirmation);
  if (updates.lastCorrection) session.lastCorrection = updates.lastCorrection;
  if (updates.isCorrection) {
    session.lastCorrection = {
      at: now,
      from: session.previousIntent,
      to: session.currentIntent
    };
  }

  session.turnCount = (session.turnCount || 0) + 1;
  session.updatedAt = now;
  session.expiresAt = now + SESSION_TTL_MS;

  sessionStore.set(cid, session);
  return session;
}

export function clearIntentSession(conversationId) {
  const cid = String(conversationId || 'default');
  sessionStore.delete(cid);
}

export function getSessionOperationalSlots(conversationId) {
  const cid = String(conversationId || 'default');
  const sess = sessionStore.get(cid);
  if (!sess) return {};

  const ent = sess.activeEntities || sess.entities || {};
  return {
    asset: ent.token || ent.symbol || ent.fromToken || ent.toToken || null,
    token: ent.token || ent.symbol || null,
    fromToken: ent.fromToken || null,
    toToken: ent.toToken || null,
    amount: ent.amount || ent.amountUsd || null,
    network: ent.network || ent.chainId || null,
    intent: sess.currentIntent || null,
    timeframe: ent.timeframe || null,
    riskPreference: ent.riskPreference || null,
    targetReturn: ent.targetReturn || null
  };
}
