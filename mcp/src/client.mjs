/**
 * FBT-MCP HTTP CLIENT — the only way the bridge talks to the FBT API.
 * ---------------------------------------------------------------------------
 * Three properties are deliberate, and each one exists because the opposite
 * has already gone wrong somewhere in this project:
 *
 *   1. SECRETS NEVER LEAVE THIS MODULE UNREDACTED. The API key goes in the
 *      Authorization header and into no other place — not a query string, not
 *      a log line, not a tool result. Every payload that will be handed to a
 *      language model passes through `redactSecrets` first, so even an
 *      upstream that echoed a credential back could not leak it into a
 *      conversation transcript.
 *
 *   2. SCOPES ARE SERVER TRUTH, NOT LOCAL OPINION. A tool that needs the
 *      `request_quote` scope asks `identity()`, which resolves the presented
 *      key through GET /api/developer/whoami. If the server says the key is
 *      revoked, every scoped tool fails closed — the bridge never keeps
 *      operating on remembered permissions.
 *
 *   3. PUBLIC TOOLS STAY PUBLIC. The no-scope tools send NO Authorization
 *      header at all. They hit exactly the endpoints the web app serves
 *      anonymously; the bridge is a thinner client of them, never a wider one.
 */

const DEFAULT_BASE_URL = 'https://fbtswap.ir';
const DEFAULT_TIMEOUT_MS = 20_000;
/* Generous enough for /api/markets with 250 rows, small enough that a runaway
   upstream cannot push a model past its context window. */
export const MAX_RESULT_CHARS = 200_000;

const SECRET_PATTERNS = [
  /fbt_sandbox_[A-Za-z0-9_-]{8,}/g,
  /qd_agent_[A-Za-z0-9_-]{8,}/g,
  /("?(?:secret|token|api[_-]?key|authorization|password|mnemonic|seed(?:Phrase)?|private[_-]?key)"?\s*[:=]\s*")[^"]*(")/gi
];

/** Best-effort scrub of anything credential-shaped. Cheap insurance. */
export function redactSecrets(text) {
  let out = String(text ?? '');
  out = out.replace(SECRET_PATTERNS[0], 'fbt_sandbox_[REDACTED]');
  out = out.replace(SECRET_PATTERNS[1], 'qd_agent_[REDACTED]');
  out = out.replace(SECRET_PATTERNS[2], '$1[REDACTED]$2');
  return out;
}

/** Serialize a tool payload for the model: JSON, redacted, size-capped. */
export function renderResult(value) {
  let text;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  } catch {
    text = JSON.stringify({ error: 'UNSERIALIZABLE_RESULT' });
  }
  text = redactSecrets(text);
  if (text.length > MAX_RESULT_CHARS) {
    text = `${text.slice(0, MAX_RESULT_CHARS)}\n…[truncated at ${MAX_RESULT_CHARS} characters]`;
  }
  return text;
}

export function createClient({
  baseUrl = process.env.FBT_BASE_URL || DEFAULT_BASE_URL,
  apiKey = process.env.FBT_API_KEY || '',
  timeoutMs = Number(process.env.FBT_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
  fetchImpl = globalThis.fetch
} = {}) {
  const root = String(baseUrl).replace(/\/+$/, '');
  /* Only ever shown as a prefix — enough to tell two keys apart in a config
     debug, never enough to reconstruct one. */
  const keyPrefix = apiKey ? `${apiKey.slice(0, 16)}…` : null;
  let identityCache = null;

  async function request(method, path, { query, body, scope = 'public', idempotencyKey } = {}) {
    const url = new URL(`${root}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
      }
    }
    const headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (idempotencyKey) headers['idempotency-key'] = String(idempotencyKey);
    if (scope !== 'public' && apiKey) headers.authorization = `Bearer ${apiKey}`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal
      });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 2000) }; }
      return { ok: res.ok, status: res.status, data };
    } catch (err) {
      const reason = err?.name === 'AbortError' ? 'UPSTREAM_TIMEOUT' : String(err?.message || 'UPSTREAM_FAILED').slice(0, 160);
      return { ok: false, status: 0, data: { error: reason } };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Server-truth identity. Cached for the session: whoami is a network call
      and every tool call would otherwise pay it. Revocation is therefore
      honoured within one MCP session, exactly like a browser session token. */
  async function identity({ force = false } = {}) {
    if (!apiKey) return { ok: false, code: 'NEEDS_API_KEY', identity: null };
    if (identityCache && !force) return identityCache;
    const res = await request('GET', '/api/developer/whoami', { scope: 'scoped' });
    if (!res.ok) {
      identityCache = {
        ok: false,
        code: res.status === 401 ? (res.data?.error?.code === 'API_KEY_REVOKED' ? 'API_KEY_REVOKED' : 'API_KEY_INVALID') : res.data?.error?.code || 'WHOAMI_FAILED',
        identity: null
      };
    } else {
      identityCache = { ok: true, code: null, identity: res.data?.data || null };
    }
    return identityCache;
  }

  /** Fail closed: a scoped tool needs BOTH a configured key and the scope the
      server says that key holds. `manage_listings` writes are additionally
      enforced by the API routes themselves — this check only makes the refusal
      arrive with an explanation instead of a bare 401. */
  async function ensureScope(scope) {
    if (scope === 'public') return { ok: true };
    const who = await identity();
    if (!who.ok) {
      return {
        ok: false,
        error: who.code,
        detail: who.code === 'NEEDS_API_KEY'
          ? 'This tool needs a developer API key (FBT_API_KEY). Mint one with POST /api/developer/projects/{id}/keys from the Developers page of the app; the secret is shown once.'
          : 'The configured API key was rejected by the server; revoke and mint a new one from the Developers page.'
      };
    }
    const scopes = Array.isArray(who.identity?.scopes) ? who.identity.scopes : [];
    if (!scopes.includes(scope)) {
      return { ok: false, error: 'SCOPE_NOT_ALLOWED', detail: `This key holds [${scopes.join(', ') || 'none'}] but the tool requires the '${scope}' scope.` };
    }
    return { ok: true, identity: who.identity };
  }

  return {
    baseUrl: root,
    keyConfigured: Boolean(apiKey),
    keyPrefix,
    request,
    identity,
    ensureScope,
    get: (path, opts) => request('GET', path, opts),
    post: (path, body, opts = {}) => request('POST', path, { ...opts, body })
  };
}

/**
 * Bind one tool's scope onto a client so EVERY request it makes is classified
 * the same way. A tool that verified `request_quote` and then issued a bare
 * `client.get(...)` (scope defaulting to `public`, header never attached) is
 * exactly the kind of half-applied auth that reads as "working" until a real
 * key exists — the probe caught it, this seam makes it unrepresentable.
 */
export function withDefaultScope(client, scope) {
  return {
    ...client,
    get: (path, opts = {}) => client.get(path, { scope, ...opts }),
    post: (path, body, opts = {}) => client.post(path, body, { scope, ...opts })
  };
}
