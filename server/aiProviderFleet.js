/**
 * The AI PROVIDER FLEET — which providers this deployment is allowed to call.
 * ---------------------------------------------------------------------------
 * Reality on the deployment: three keys work. OpenRouter, Groq and Cloudflare
 * Workers AI. The other seven providers registered in `aiGateway.js` either
 * have no key or carry one that the account has since let expire — and a key
 * that is PRESENT but DEAD is the worst of both worlds: `isProviderConfigured`
 * says yes, so every request pays for the round-trip, the failover trail fills
 * with 401/402/403 rows, and the panel shows a fleet where most seats cannot
 * answer.
 *
 * There is no way to tell a working key from an expired one without calling
 * it, and calling it on every request is exactly the cost we are removing. So
 * the fleet is declared, not discovered:
 *
 *   FBT_AI_PROVIDERS=openrouter,groq,workersai   (the default)
 *   FBT_AI_PROVIDERS=all                          (no restriction — every key
 *                                                  that is present is used)
 *
 * Rules that keep this honest:
 *   • `internal` (the deterministic rule engine) is never excluded — the
 *     assistant must always have a seat that needs no key.
 *   • An unusable value never widens the fleet: unknown tokens are reported in
 *     `rejected` and the default fleet stays in force.
 *   • An empty value means "the default", not "no providers".
 *   • Nothing here holds, logs or echoes a key. It reads one env var that names
 *     providers.
 */

export const PROVIDER_FLEET_SCHEMA = 'fbt.ai-provider-fleet.v1';

/** The providers this deployment holds working keys for. */
export const DEFAULT_PROVIDER_FLEET = Object.freeze(['openrouter', 'groq', 'workersai']);

/**
 * Every provider the gateway registers, plus the spellings an operator is
 * likely to type. Kept here (not imported from aiGateway) because the gateway
 * imports this module — a cycle would be paid on every cold start.
 */
export const PROVIDER_ALIASES = Object.freeze({
  openrouter: 'openrouter',
  'open-router': 'openrouter',
  'open_router': 'openrouter',
  or: 'openrouter',
  groq: 'groq',
  workersai: 'workersai',
  'workers-ai': 'workersai',
  workers_ai: 'workersai',
  workers: 'workersai',
  cloudflare: 'workersai',
  'cloudflare-workers-ai': 'workersai',
  'cloudflare_workers_ai': 'workersai',
  cf: 'workersai',
  openai: 'openai',
  'open-ai': 'openai',
  anthropic: 'anthropic',
  claude: 'anthropic',
  gemini: 'gemini',
  google: 'gemini',
  xai: 'xai',
  grok: 'xai',
  deepseek: 'deepseek',
  mistral: 'mistral',
  aimlapi: 'aimlapi',
  internal: 'internal'
});

/** A value meaning "do not restrict": every key present is used. */
const ALL_TOKENS = new Set(['all', '*', 'any', 'every']);

/**
 * Turn a raw `FBT_AI_PROVIDERS` value into a fleet.
 *
 * Returns `{ schema, providers, source, restricted, raw, rejected }`.
 * `providers: null` means "no restriction" (only `all` produces it).
 */
export function resolveProviderFleet(raw = process.env.FBT_AI_PROVIDERS) {
  const text = String(raw ?? '').trim();
  const base = {
    schema: PROVIDER_FLEET_SCHEMA,
    defaultFleet: DEFAULT_PROVIDER_FLEET.slice()
  };

  if (!text) {
    return {
      ...base,
      providers: DEFAULT_PROVIDER_FLEET.slice(),
      source: 'default',
      restricted: true,
      raw: '',
      rejected: []
    };
  }

  const tokens = text.split(/[\s,;]+/).filter(Boolean);
  if (tokens.some((t) => ALL_TOKENS.has(t.toLowerCase()))) {
    return { ...base, providers: null, source: 'env', restricted: false, raw: text, rejected: [] };
  }

  const providers = [];
  const rejected = [];
  for (const token of tokens) {
    const id = PROVIDER_ALIASES[token.toLowerCase()];
    if (!id) {
      rejected.push(token);
      continue;
    }
    if (!providers.includes(id)) providers.push(id);
  }

  /* A value that names nothing usable must not empty the fleet and must not
     widen it either: keep the default and say what was ignored. */
  if (!providers.length) {
    return {
      ...base,
      providers: DEFAULT_PROVIDER_FLEET.slice(),
      source: 'default',
      restricted: true,
      raw: text,
      rejected
    };
  }

  /* Stable, predictable order: the declared order first, then anything else
     the operator added — never sorted alphabetically behind their back. */
  return { ...base, providers, source: 'env', restricted: true, raw: text, rejected };
}

/** Is this provider allowed to be called at all? `internal` always is. */
export function isProviderInFleet(providerId) {
  if (providerId === 'internal') return true;
  const { providers } = resolveProviderFleet();
  if (!providers) return true;
  return providers.includes(providerId);
}

/**
 * Why a provider was excluded, for diagnostics: `NOT_IN_FLEET` or `null`.
 * Key presence is the gateway's business; this only answers the fleet question.
 */
export function providerFleetExclusion(providerId) {
  return isProviderInFleet(providerId) ? null : 'NOT_IN_FLEET';
}

/** The fleet, in the shape a panel or an endpoint can print. */
export function describeProviderFleet() {
  const fleet = resolveProviderFleet();
  return {
    schema: PROVIDER_FLEET_SCHEMA,
    /* `providers: null` = unrestricted; print `all` so no UI has to infer it. */
    providers: fleet.providers ? fleet.providers.slice() : 'all',
    restricted: fleet.restricted,
    source: fleet.source,
    raw: fleet.raw,
    rejected: fleet.rejected.slice(),
    defaultFleet: DEFAULT_PROVIDER_FLEET.slice(),
    envVar: 'FBT_AI_PROVIDERS',
    /* Naming a provider is not authority to move money. */
    authority: { canExecute: false, canSign: false, canMoveFunds: false }
  };
}

export default resolveProviderFleet;
