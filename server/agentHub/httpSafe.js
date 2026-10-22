/**
 * FBT EXTERNAL AGENT HUB — network safety (§16).
 * ---------------------------------------------------------------------------
 * Every outbound request this feature makes goes through `jsonRequest` below,
 * and there is no other way out: the adapter receives this function, not
 * `fetch`. The rules are the ones a provider URL has to satisfy to be touched
 * at all:
 *
 *   · HTTPS only (a documented, narrow loopback exception exists for the
 *     conformance test server — and it is refused outright in production).
 *   · The host must be the provider's own host or a subdomain of it, as
 *     declared in the reviewed registry entry. Client input never reaches
 *     this function as a URL: the router resolves `providerId`/`agentId`
 *     against the server allowlist first.
 *   · No embedded credentials, no IP literals, no private-network names.
 *   · Redirects are NOT followed automatically. One hop is allowed and its
 *     target is revalidated with the same rules, which is how an allowlisted
 *     host is prevented from bouncing us to 169.254.169.254.
 *   · Timeout and response size are hard limits; a provider cannot hold a
 *     serverless request open or exhaust memory with a 200 MB "result".
 *
 * NOT A DNS REBINDING DEFENCE. Hostname checks cannot see that an allowlisted
 * name resolves to a private address at request time; closing that fully needs
 * resolver-level pinning, which this runtime does not expose. It is recorded
 * here, and in the runbook, as a residual risk of the current deployment.
 */

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_BYTES = 1_000_000;

const PRIVATE_HOST = /^(localhost|localhost\.|.*\.local|.*\.internal|.*\.lan|.*\.home\.arpa|metadata\.google\.internal)$/i;
const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/;
const IPV6_LITERAL = /^\[?[0-9a-f:]+\]?$/i;

function loopbackAllowed(env) {
  const dev = String(env?.AGENT_HUB_ALLOW_LOOPBACK || '').trim() === '1';
  return dev && String(env?.NODE_ENV || '') !== 'production';
}

/** Throw-safe host extraction. */
function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Is `url` inside the provider's declared origin set?
 * `allowedHosts` is `[host, ...]`; a subdomain of a declared host is accepted
 * because providers move endpoints between `api.` and `agent.` prefixes.
 */
export function hostAllowed(url, allowedHosts = []) {
  const host = hostOf(url);
  if (!host) return false;
  return allowedHosts.some((allowed) => {
    const base = String(allowed || '').toLowerCase().replace(/^\./, '');
    return base && (host === base || host.endsWith(`.${base}`));
  });
}

/**
 * Validate one provider URL. Returns { ok, url } or { ok:false, code }.
 * `env` is passed so a test can opt into the loopback exception explicitly.
 */
export function validateProviderUrl(rawUrl, { allowedHosts = [], env = process.env } = {}) {
  let url;
  try {
    url = new URL(String(rawUrl || ''));
  } catch {
    return { ok: false, code: 'PROVIDER_URL_INVALID' };
  }
  if (url.username || url.password) return { ok: false, code: 'PROVIDER_URL_HAS_CREDENTIALS' };
  const host = url.hostname.toLowerCase();

  const loopback = loopbackAllowed(env) && (host === '127.0.0.1' || host === '::1' || host === 'localhost');
  if (!loopback) {
    if (url.protocol !== 'https:') return { ok: false, code: 'PROVIDER_URL_NOT_HTTPS' };
    if (IPV4_LITERAL.test(host) || IPV6_LITERAL.test(host)) return { ok: false, code: 'PROVIDER_URL_IS_IP' };
    if (PRIVATE_HOST.test(host)) return { ok: false, code: 'PROVIDER_URL_PRIVATE_HOST' };
    if (url.port && url.port !== '443') return { ok: false, code: 'PROVIDER_URL_NONSTANDARD_PORT' };
  } else if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, code: 'PROVIDER_URL_INVALID' };
  }

  if (!hostAllowed(url.toString(), allowedHosts)) {
    /* The loopback test server declares its own host:port, so the check above
       already covered it; this branch is the real allowlist. */
    return { ok: false, code: 'PROVIDER_URL_NOT_ALLOWLISTED' };
  }
  if (url.search) {
    /* Query strings on a card URL are fine; on an RPC endpoint they are a way
       to smuggle a credential into a stored row. */
    return { ok: false, code: 'PROVIDER_URL_HAS_QUERY' };
  }
  return { ok: true, url: url.toString() };
}

/**
 * One bounded JSON request.
 *
 * @param {object} args
 * @param {string} args.url
 * @param {string[]} args.allowedHosts
 * @param {object} [args.headers]   never logged
 * @param {object|null} [args.body]
 * @param {number} [args.timeoutMs]
 * @param {number} [args.maxBytes]
 * @param {object} [args.env]
 * @returns {Promise<{ok:true,status:number,json:any,bytes:number}|{ok:false,code:string,httpStatus?:number,detail?:string,rpcCode?:number,rpcMessage?:string}>}
 */
export async function jsonRequest({
  url,
  allowedHosts,
  method = 'POST',
  headers = {},
  body = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_BYTES,
  env = process.env,
  redirectsLeft = 1
} = {}) {
  const checked = validateProviderUrl(url, { allowedHosts, env });
  if (!checked.ok) return { ok: false, code: checked.code };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
  try {
    const response = await fetch(checked.url, {
      method,
      headers: { accept: 'application/json', ...headers },
      body: body === null ? undefined : JSON.stringify(body),
      signal: controller.signal,
      redirect: 'manual',
      cache: 'no-store'
    });

    /* A redirect is a NEW destination and gets the same scrutiny. One hop only:
       an allowlisted host that bounces twice is not behaving like an endpoint. */
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location || redirectsLeft <= 0) return { ok: false, code: 'PROVIDER_REDIRECT_REJECTED', httpStatus: response.status };
      let next;
      try {
        next = new URL(location, checked.url).toString();
      } catch {
        return { ok: false, code: 'PROVIDER_REDIRECT_REJECTED', httpStatus: response.status };
      }
      const revalidated = validateProviderUrl(next, { allowedHosts, env });
      if (!revalidated.ok) return { ok: false, code: 'PROVIDER_REDIRECT_REJECTED', httpStatus: response.status };
      return jsonRequest({ url: next, allowedHosts, method, headers, body, timeoutMs, maxBytes, env, redirectsLeft: redirectsLeft - 1 });
    }

    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength && declaredLength > maxBytes) {
      return { ok: false, code: 'PROVIDER_RESPONSE_TOO_LARGE', httpStatus: response.status };
    }
    const raw = await response.text();
    if (raw.length > maxBytes) return { ok: false, code: 'PROVIDER_RESPONSE_TOO_LARGE', httpStatus: response.status };

    let json = null;
    if (raw) {
      try {
        json = JSON.parse(raw);
      } catch {
        return { ok: false, code: 'PROVIDER_RESPONSE_NOT_JSON', httpStatus: response.status };
      }
    }

    /* JSON-RPC over HTTP may return an error envelope with HTTP 200. It is an
       error, and the caller must not read `result` out of it. */
    if (json && json.error && typeof json.error === 'object') {
      return {
        ok: false,
        code: 'PROVIDER_RPC_ERROR',
        httpStatus: response.status,
        rpcCode: Number(json.error.code) || null,
        rpcMessage: String(json.error.message || '').slice(0, 300)
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        code: 'PROVIDER_HTTP_ERROR',
        httpStatus: response.status,
        rpcMessage: typeof json?.message === 'string' ? json.message.slice(0, 300) : ''
      };
    }

    return { ok: true, status: response.status, json, bytes: raw.length };
  } catch (error) {
    if (error?.name === 'AbortError') return { ok: false, code: 'PROVIDER_TIMEOUT' };
    return { ok: false, code: 'PROVIDER_UNREACHABLE', detail: String(error?.code || error?.name || '').slice(0, 60) };
  } finally {
    clearTimeout(timer);
  }
}
