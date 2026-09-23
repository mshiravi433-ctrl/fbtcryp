/**
 * Solana lending client — Kamino KLend on Solana mainnet.
 *
 * Solana is not an EVM chain. It has no ERC-20 allowance, uint256 calldata,
 * EVM gas or Aave pool, so it intentionally lives outside src/lib/lending.js.
 * This module keeps the same boundary as the EVM client: reads come from the
 * protocol, transactions are built locally and the user's Solana wallet is the
 * only signer/broadcaster.
 */

import { Connection, PublicKey } from '@solana/web3.js';

export const SOLANA_LENDING_CHAIN_ID = 900001;
export const KAMINO_MAIN_MARKET = '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF';
export const KAMINO_LENDING_PROGRAM = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
export const SOLANA_LENDING_RPC = 'https://api.mainnet-beta.solana.com';
export const SOLANA_LENDING_EXPLORER = 'https://solscan.io';

/**
 * Which node the lending reads go through.
 *
 * This used to be the hardcoded Foundation endpoint — `api.mainnet-beta.solana.com`
 * answers a busy browser with HTTP 429 and is frequently unreachable on
 * Iranian mobile networks, which is why the loan page's Solana panel sat on
 * «RPC سولانا یا بازار Kamino خوانده نشد» while the Solana swap screen on the
 * same phone worked. The app already owns a probed, multi-endpoint RPC layer
 * (src/lib/solanaRpc.js): the user's own RPC first, then the community nodes,
 * with the winner cached for the session. The lending path now uses it too.
 * An explicit `rpcUrl` still wins — tests and the panel may pin one.
 */
async function resolveLendingRpc(rpcUrl) {
  if (rpcUrl) return rpcUrl;
  try {
    const { getSolanaRpcUrl } = await import('./solanaRpc.js');
    return await getSolanaRpcUrl();
  } catch {
    return SOLANA_LENDING_RPC;
  }
}

/**
 * Every node a lending read may try, in order: the caller's pinned URL wins,
 * otherwise the user's own RPC first and then the public list — the SAME
 * order the swap screen probes, so the two can never disagree about which
 * node is usable.
 *
 * 2026-09-22: reads used to take ONE URL (`getSolanaRpcUrl()`, which returns
 * the Foundation endpoint even when its own probe just proved every candidate
 * dead) and a single 429 / blocked host turned the whole Solana panel into
 * «market unavailable» + BALANCE_UNKNOWN. Every read below now walks this
 * list until one node answers.
 */
async function lendingRpcCandidates(rpcUrl) {
  if (rpcUrl) return [rpcUrl];
  try {
    const { solanaRpcCandidates, readSolanaNetworkSettings } = await import('./solanaRpc.js');
    const settings = await readSolanaNetworkSettings();
    const list = solanaRpcCandidates(settings).filter(Boolean);
    return list.length ? [...new Set(list)] : [SOLANA_LENDING_RPC];
  } catch {
    return [SOLANA_LENDING_RPC];
  }
}

const shortHost = (url) => {
  try { return new URL(url).hostname; } catch { return String(url || '?').slice(0, 40); }
};

/** A fetch-level failure: no HTTP status at all, the request never came back. */
/* A failure that says «I could not reach the network» — no status code, no
   node words, just the transport. Every spelling that reaches us is here:
   fetch/XHR, the Chrome and Safari connection errors, DNS, sockets. It is
   deliberately NOT a catch-all: `econnreset` is a dead network path, while
   «the account did not decode» is a node that ANSWERED. */
const NETWORK_FAILURE_RE = /\bfetch\b|networkerror|network error|failed to fetch|err_connection|err_name|err_internet|err_network|enotfound|econn|etimedout|socket|timeout|timed out|unreachable|connection (?:refused|reset|closed)|offline|abort/i;

/**
 * Name ONE node's refusal from the node's own words.
 *
 * WHY THIS IS STATUS-FIRST (report 2026-09-23)
 * -------------------------------------------
 * The old rule was a single regex over every attempt glued together:
 * `/429|rate.?limit/i.test(haystack)` → RPC_RATE_LIMITED. Two ways that lied:
 *
 *   · `7u3He…: Error: 403 : {"jsonrpc":"2.0","error":{` — the Foundation node
 *     REFUSED the request with a 403 (region/provider block). The word
 *     «rate limit» is not in that text, yet the user was shown
 *     «گره شبکه موقتاً محدودیت نرخ دارد» — «the node is temporarily rate
 *     limiting» — because a DIFFERENT candidate (a community node) answered
 *     429 and the two were merged into one haystack.
 *   · «rate limit» appears in more places than 429 does (a WAF body that says
 *     "Rate limit exceeded" while returning 403), so the word alone cannot
 *     decide.
 *
 * So: read the HTTP status when the text carries one and let it decide —
 * 429 is throttling (retry later), 401/403/451 is a REFUSAL (retry will not
 * help; another node will). Only when no status is present does the wording
 * get a vote. Returns null when the text says nothing useful, so callers keep
 * their own default instead of being handed a guess.
 */
/**
 * What a node's refusal MEANS, from the node's own words.
 *
 * Status first, wording second — and the wording is only consulted when there
 * is no status at all, because a block page frequently contains the words
 * «rate limit» (the exact text that produced the reported
 * «RPC_RATE_LIMITED» for a 403). A bare number in a message is not a status
 * unless it is written like one (`Error: 403 :`, `HTTP 403`, `status: 403`),
 * which keeps a slot or a block height from inventing a cause.
 *
 * Exported for the contract test.
 *
 * @param {string} text
 * @returns {'RPC_BLOCKED'|'RPC_RATE_LIMITED'|null}
 */
export function classifyNodeFailure(text) {
  const raw = String(text || '');
  if (!raw) return null;
  /* A status has to LOOK like a status: `Error: 403 : {…}` (what web3.js
     throws), `HTTP 403`, `status 403`, `403 Forbidden`. A bare number is not
     enough — `slot 403` and a signature containing 403 are not HTTP, and
     guessing a cause from them is exactly the bug this function replaces. */
  const m = raw.match(/(?:\b(?:http(?:\s+status)?|status(?:\s+code)?|error|code)\b\s*[:=]?\s*|\bHTTP\/1\.[01]\s+)(401|403|429|451)\b|\b(401|403|429|451)\s*:/i);
  const status = (m && (m[1] || m[2])) || '';
  if (status === '429') return 'RPC_RATE_LIMITED';
  if (status) return 'RPC_BLOCKED';
  if (/rate.?limit|too many requests|throttl/i.test(raw)) return 'RPC_RATE_LIMITED';
  if (/forbidden|blocked|denied|unauthori[sz]ed|restricted|not allowed|access control|country|region|sanction/i.test(raw)) return 'RPC_BLOCKED';
  return null;
}

/**
 * Name a total failover failure.
 *
 * Precedence, in the order a user can act on it:
 *   1. any node REFUSED us (401/403/451) → RPC_BLOCKED. Retrying hits the same
 *      wall; the fix is another endpoint (Settings → Networks), and the summary
 *      below names which host refused, so support sees it too.
 *   2. otherwise any throttling (429 / "rate limit") → RPC_RATE_LIMITED, which
 *      a retry genuinely fixes.
 *   3. every attempt a fetch-level failure → RPC_ERROR (network path).
 *   4. anything else — e.g. every node answered but the market account would not
 *      decode — stays KAMINO_MARKET_UNAVAILABLE. Never guessed into a cause.
 *
 * The per-host summary is kept as detail (§28) and now carries the class, so a
 * report reads `api.mainnet-beta.solana.com:RPC_BLOCKED |
 * solana-rpc.publicnode.com:RPC_RATE_LIMITED` instead of one merged sentence.
 */
/**
 * Exported for the contract test (test/loan-solana-rpc-sign.test.js): this
 * function is the whole translation of «every node failed» into the ONE code
 * the panel shows, so its precedence is behaviour, not an implementation
 * detail.
 */
export function lendingRpcFailure(attempts) {
  const list = attempts || [];
  const parts = list.map((a) => {
    const text = `${a.code || ''} ${a.error || ''}`.trim();
    const cls = classifyNodeFailure(text);
    return {
      url: shortHost(a.url),
      rawUrl: a.url,
      text,
      cls,
      /* What the row MEANS, in the vocabulary the UI has sentences for. */
      reason: cls || (NETWORK_FAILURE_RE.test(text) ? 'RPC_ERROR' : 'RPC_UNAVAILABLE')
    };
  });
  const summary = parts
    .map((p) => `${p.url}:${p.reason}`)
    .join(' | ')
    .slice(0, 180);
  const blocked = parts.some((p) => p.cls === 'RPC_BLOCKED');
  const rateLimited = parts.some((p) => p.cls === 'RPC_RATE_LIMITED');
  const allUnreachable = parts.length > 0 && parts.every((p) => p.reason === 'RPC_ERROR');
  const code = blocked ? 'RPC_BLOCKED'
    : rateLimited ? 'RPC_RATE_LIMITED'
      : allUnreachable ? 'RPC_ERROR'
        : 'KAMINO_MARKET_UNAVAILABLE';
  const error = new Error(code);
  error.code = code;
  error.detail = summary || 'all Solana RPC candidates failed';
  error.attempts = list;
  /* Per-host list for the panel: it renders «host → localized reason» from
     this, instead of the raw English transport text. */
  error.hosts = parts.map((p) => ({ host: p.url, reason: p.reason }));
  /* And teach the RPC layer, so the next read does not start with the host that
     just refused us (see noteSolanaRpcFailure in solanaRpc.js). */
  noteRefusedCandidates(parts);
  return error;
}

/**
 * Push this failure back into the RPC layer's cooldown map.
 *
 * Fire-and-forget BY DESIGN: a cooldown is an optimisation for the next read,
 * never a reason to delay or fail this one — and the module it lives in is
 * imported dynamically so the lending client stays usable in tests that stub
 * the RPC layer out entirely.
 */
function noteRefusedCandidates(parts) {
  const refusals = (parts || []).filter((p) => p.rawUrl && (p.cls === 'RPC_BLOCKED' || p.cls === 'RPC_RATE_LIMITED'));
  if (!refusals.length) return;
  import('./solanaRpc.js').then(({ noteSolanaRpcFailure }) => {
    for (const p of refusals) noteSolanaRpcFailure(p.rawUrl, p.cls === 'RPC_BLOCKED' ? 'BLOCKED' : 'RATE_LIMITED');
  }).catch(() => { /* the next read simply starts in the configured order */ });
}

async function resetRememberedSolanaRpc() {
  try {
    const { resetSolanaRpcChoice } = await import('./solanaRpc.js');
    resetSolanaRpcChoice();
  } catch { /* the reset is hygiene, never load-bearing */ }
}

/** Wrap a raw connection failure in the engine's named codes (§28). */
function solanaReadError(cause, code = 'RPC_ERROR') {
  const raw = String(cause?.message || cause || '');
  /* Same status-first rule as `lendingRpcFailure`: a refusal must never be
     dressed up as throttling, and wording only decides when no status is in
     the text. A code a lower layer already named always wins. */
  const named = classifyNodeFailure(raw);
  const finalCode = cause?.code || named
    || (NETWORK_FAILURE_RE.test(raw) ? 'RPC_ERROR' : code);
  const error = new Error(finalCode);
  error.code = finalCode;
  error.detail = raw.slice(0, 160);
  return error;
}

const KAMINO_VENDOR_PATH = 'vendor/kamino-klend-sdk.js';
const KAMINO_VENDOR_MANIFEST = 'vendor/kamino-klend-sdk.manifest.json';
/* Bumped 2026-09-22 (2 -> 3): the rev-2 bundle threw `ReferenceError: Buffer
   is not defined` at module init in EVERY real browser — the Node-only check
   script passed it because Node has a global Buffer — so the panel could only
   answer «ماژول Kamino اجرا نشد» (KAMINO_SDK_FAILED) and no Solana loan could
   ever be built. scripts/vendor-kamino.mjs now prepends a Buffer shim to the
   emitted file and scripts/check-kamino-bundle.mjs hides the Node globals, so
   a bundle that cannot start in a browser fails the BUILD instead of the user.
   The query string is the only cache-buster on this file: any vendor-bundle
   change bumps this again, and it must match VENDOR_REV in the vendor script
   (asserted by test/solana-lending-precision.test.js). */
const KAMINO_VENDOR_REV = '3';

/**
 * Where the vendored Kamino bundle may live, in order. The build always emits
 * it to `<BASE_URL>/vendor/…`, but the page can be served under a different
 * base than the build assumed (CDN rewrites, the native shell, a cached
 * index.html from a previous deploy) — a single hardcoded URL turns any of
 * those into KAMINO_SDK_UNAVAILABLE. Each candidate is tried in turn.
 *
 * Each path is offered BOTH with the `?v=` cache-buster and bare: an edge
 * cache or a proxy that ignores/rewrites query strings is a real deployment
 * shape, and the bare URL is the one a stuck CDN would keep serving correctly.
 */
function kaminoVendorCandidates() {
  const rawBase = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
  const base = String(rawBase || '/');
  const withSlash = base.endsWith('/') ? base : `${base}/`;
  const paths = [`${withSlash}${KAMINO_VENDOR_PATH}`];
  if (withSlash !== '/') paths.push(`/${KAMINO_VENDOR_PATH}`);
  const urls = [];
  for (const path of paths) {
    urls.push(`${path}?v=${KAMINO_VENDOR_REV}`, path);
  }
  return [...new Set(urls)];
}

/** Same base resolution as the bundle itself, for its integrity manifest. */
function kaminoManifestCandidates() {
  const rawBase = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
  const base = String(rawBase || '/');
  const withSlash = base.endsWith('/') ? base : `${base}/`;
  const paths = [`${withSlash}${KAMINO_VENDOR_MANIFEST}`];
  if (withSlash !== '/') paths.push(`/${KAMINO_VENDOR_MANIFEST}`);
  return [...new Set(paths)];
}

function kaminoLoadError(code, cause, detail) {
  const error = new Error(code);
  error.code = code;
  error.cause = cause || null;
  if (detail) error.detail = String(detail).slice(0, 200);
  else if (cause) error.detail = String(cause?.message || cause).slice(0, 200);
  return error;
}

/* One warn line per failure, so a user's console (or a screenshot of it) names
   the exact reason the panel is about to show a sentence for. */
function kaminoDiagnostic(code, info) {
  try {
    if (typeof console === 'undefined' || typeof console.warn !== 'function') return;
    console.warn(`[kamino] ${code}`, JSON.stringify(info || {}));
  } catch { /* diagnostics must never be the thing that throws */ }
}

/** HTTP status/headers/body of the bundle URL — the evidence fetch. */
async function fetchKaminoVendor(url, { reload = false } = {}) {
  if (typeof fetch !== 'function') return null;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { accept: '*/*' },
      /* `default` lets a healthy HTTP cache answer instantly; `reload` is the
         second attempt after a short/HTML body, which is what a half-cached
         or truncated response needs. */
      cache: reload ? 'reload' : 'default'
    });
    const type = String(res?.headers?.get?.('content-type') || '');
    if (!res?.ok) return { ok: false, status: Number(res?.status ?? 0), contentType: type, url };
    const text = await res.text();
    return { ok: true, status: Number(res.status), contentType: type, text, bytes: text.length, url };
  } catch (cause) {
    return { ok: false, status: 0, error: String(cause?.message || cause).slice(0, 120), url };
  }
}

/** A server that answers a missing module with its SPA shell (or a captive
    portal) returns HTML — importing that is a MIME error, not a broken SDK. */
const looksLikeHtml = (text) => /^\s*(<!doctype|<html|<head|<body|<\?xml)/i.test(String(text || '').slice(0, 240));

let manifestPromise = null;
/**
 * The build writes `kamino-klend-sdk.manifest.json` next to the bundle (byte
 * length + sha256 + rev). It is what turns "KAMINO_SDK_FAILED" into an honest
 * «the download was 1.2 MB of 5.6 MB» on a flaky mobile link, and it catches a
 * stale edge copy from a previous deploy (rev mismatch) too.
 */
async function kaminoVendorManifest() {
  if (!manifestPromise) {
    manifestPromise = (async () => {
      for (const url of kaminoManifestCandidates()) {
        try {
          const res = await fetch(url, { headers: { accept: 'application/json' } });
          if (!res?.ok) continue;
          const json = await res.json();
          if (json && Number(json.bytes) > 0) return json;
        } catch { /* older deploys have no manifest — that is not an error */ }
      }
      return null;
    })();
  }
  return manifestPromise;
}

/** Evaluate bundle TEXT as a module. Used when the direct import failed for a
    transport reason (HTML body, wrong MIME) rather than a code reason. */
async function importKaminoFromText(text) {
  if (typeof Blob !== 'function' || typeof URL?.createObjectURL !== 'function') return null;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
  try {
    const mod = await import(/* @vite-ignore */ url);
    return mod;
  } finally {
    /* Revoking immediately is safe (the module is already evaluated) but a
       timer keeps a debugger's Sources panel readable. */
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* ignore */ } }, 10_000);
  }
}

/** The exports this app actually calls — missing ones fail HERE, by name. */
function kaminoModuleFailures(mod) {
  const missing = ['KaminoMarket', 'KaminoAction', 'VanillaObligation']
    .filter((name) => typeof mod?.[name] !== 'function');
  if (typeof mod?.KaminoMarket?.load !== 'function') missing.push('KaminoMarket.load');
  for (const builder of ['buildDepositTxns', 'buildBorrowTxns', 'buildWithdrawTxns', 'buildRepayTxns']) {
    if (typeof mod?.KaminoAction?.[builder] !== 'function') missing.push(`KaminoAction.${builder}`);
  }
  if (String(mod?.PROGRAM_ID || '').length < 32) missing.push('PROGRAM_ID');
  return missing;
}

/**
 * Name the failure from the EVIDENCE (pure, so the branches are testable).
 *
 * `evidence` is what a plain fetch of the bundle URL saw, `manifest` what the
 * build published for it, `initCause` the error the module threw while
 * starting (when it got that far), `lastCause` the direct-import error.
 *
 * The four outcomes have four different fixes, which is the whole point of not
 * collapsing them into one sentence:
 *   MISSING       → the file is not in this build (404, or an HTML page: an
 *                   SPA fallback answering for a missing file, a captive
 *                   portal, a stale edge copy). Update/redeploy.
 *   TRUNCATED     → fewer bytes than the manifest says: a cut-off transfer.
 *                   Retry.
 *   INIT_FAILED   → the real module, and it threw on start (the 2026-09-22
 *                   `Buffer is not defined` class). Ship a fixed bundle.
 *   FAILED        → downloaded and plausible, with no better explanation.
 *   UNAVAILABLE   → nothing was reachable at all.
 */
export function classifyKaminoFailure({ evidence, manifest = null, initCause = null, lastCause = null, expectedRev = KAMINO_VENDOR_REV } = {}) {
  const expectedBytes = Number(manifest?.bytes) || 0;
  const staleRev = Boolean(manifest && String(manifest.rev || '') && String(manifest.rev) !== String(expectedRev));
  const where = evidence?.url || 'the vendor bundle';
  const cause = String(lastCause?.message || lastCause || '').slice(0, 140);
  if (!evidence) return { code: 'KAMINO_SDK_UNAVAILABLE', detail: 'the vendor bundle URL could not be requested' };
  if (!evidence.ok && !evidence.status) {
    return { code: 'KAMINO_SDK_UNAVAILABLE', detail: String(evidence.error || cause || 'the vendor bundle could not be fetched').slice(0, 160) };
  }
  if (evidence.ok && looksLikeHtml(evidence.text)) {
    return {
      code: 'KAMINO_SDK_MISSING',
      detail: `${where} answered with an HTML page (${evidence.bytes} bytes, ${evidence.contentType || 'no content-type'}) instead of the module${staleRev ? ` — the server still serves rev ${manifest.rev}` : ''}`
    };
  }
  if (!evidence.ok) {
    return { code: 'KAMINO_SDK_MISSING', detail: `HTTP ${evidence.status || 'fetch-failed'} for ${where} — the vendor bundle is not in this build` };
  }
  if (expectedBytes && evidence.bytes < expectedBytes) {
    return { code: 'KAMINO_SDK_TRUNCATED', detail: `downloaded ${evidence.bytes} of ${expectedBytes} bytes from ${where} — the transfer was cut off` };
  }
  const initMessage = String(initCause?.message || initCause || '').slice(0, 160);
  /* A "failed to fetch/import the module" message is transport noise, not an
     init failure — it must not be reported as one. */
  if (initMessage && !/dynamically imported module|importing a module|failed to fetch/i.test(initMessage)) {
    return { code: 'KAMINO_SDK_INIT_FAILED', detail: initMessage };
  }
  if (staleRev) {
    return { code: 'KAMINO_SDK_MISSING', detail: `the server serves vendor rev ${manifest.rev}, this app expects rev ${expectedRev} — a stale deploy is behind the page` };
  }
  return { code: 'KAMINO_SDK_FAILED', detail: initMessage || cause };
}

let sdkModulePromise = null;

/**
 * Load the vendored Kamino bundle, and when it cannot be loaded, say WHICH of
 * the four distinct failures happened (they have four different fixes):
 *
 *   KAMINO_SDK_MISSING    the module is not in this build — the URL 404s, or
 *                         the server answered with its index.html (a missing
 *                         file behind an SPA fallback, a captive portal, a
 *                         stale deploy). Updating/redeploying fixes it.
 *   KAMINO_SDK_TRUNCATED  the file downloaded but is SHORTER than the
 *                         manifest says — a cut-off transfer on a filtered or
 *                         flaky link. Retrying fixes it.
 *   KAMINO_SDK_INIT_FAILED the bytes are the real module and they THREW while
 *                         initializing (this is exactly the 2026-09-22
 *                         `Buffer is not defined` class of bug). The message
 *                         is carried in `detail`. Shipping a fixed bundle
 *                         fixes it — until then the panel must not pretend.
 *   KAMINO_SDK_FAILED      downloaded, looked like the module, and no
 *                         transport/init explanation was available.
 *   KAMINO_SDK_UNAVAILABLE nothing was reachable at all (offline).
 */
async function sdkPromise() {
  if (!sdkModulePromise) {
    sdkModulePromise = (async () => {
      const candidates = kaminoVendorCandidates();
      let lastCause = null;
      /* 1 — the normal path: import the module the way the app always has. */
      for (const url of candidates) {
        try {
          const mod = await import(/* @vite-ignore */ url);
          const missing = kaminoModuleFailures(mod);
          if (!missing.length) return mod;
          /* A half-cached or truncated bundle can import "successfully" with
             exports missing — that must fail here with a name, not pages
             later as `KaminoMarket.load is not a function`. */
          throw new Error(`incomplete bundle (missing: ${missing.join(', ')})`);
        } catch (cause) {
          lastCause = cause;
        }
      }

      /* 2 — every direct import failed. Fetch the bytes and name the reason. */
      let evidence = null;
      for (const url of candidates) {
        const attempt = await fetchKaminoVendor(url);
        if (attempt?.ok) { evidence = attempt; break; }
        if (attempt && !evidence) evidence = attempt;
      }
      const manifest = await kaminoVendorManifest();
      const expectedBytes = Number(manifest?.bytes) || 0;
      const diagnose = ({ initCause = null } = {}) => {
        const verdict = classifyKaminoFailure({ evidence, manifest, initCause, lastCause });
        kaminoDiagnostic(verdict.code, {
          url: evidence?.url || candidates[0],
          status: evidence?.status ?? null,
          contentType: evidence?.contentType || '',
          bytes: evidence?.bytes ?? null,
          expectedBytes: expectedBytes || null,
          manifestRev: manifest?.rev || null,
          wantsRev: KAMINO_VENDOR_REV,
          detail: verdict.detail,
          cause: String(lastCause?.message || lastCause || '').slice(0, 120)
        });
        return kaminoLoadError(verdict.code, lastCause, verdict.detail);
      };

      /* Nothing fetched at all — offline, or the host is unreachable. */
      if (!evidence || (!evidence.ok && !evidence.status)) throw diagnose();
      if (evidence.ok && looksLikeHtml(evidence.text)) throw diagnose();
      if (!evidence.ok) throw diagnose();
      if (expectedBytes && evidence.bytes < expectedBytes) {
        /* A short body is a cut-off transfer, not a broken SDK: retry once
           past the HTTP cache before deciding (this is the flaky-mobile-link
           case, and a retry is the whole fix). */
        const retry = await fetchKaminoVendor(evidence.url, { reload: true });
        if (retry?.ok && retry.bytes >= expectedBytes) evidence = retry;
        else throw diagnose();
      }

      /* 3 — the bytes look like a module. Evaluate them directly (a Blob URL
         sidesteps a WRONG content-type, which browsers refuse to import) so a
         transport-level MIME problem is not reported as a broken SDK. */
      let blobCause = null;
      if (!/javascript|ecmascript|text\/plain|octet-stream|^$/i.test(evidence.contentType)) {
        kaminoDiagnostic('KAMINO_SDK_MIME', { url: evidence.url, contentType: evidence.contentType });
      }
      try {
        const mod = await importKaminoFromText(evidence.text);
        if (mod) {
          const missing = kaminoModuleFailures(mod);
          if (!missing.length) {
            kaminoDiagnostic('KAMINO_SDK_RECOVERED', {
              url: evidence.url,
              bytes: evidence.bytes,
              via: 'blob',
              /* WHY the direct import failed — the difference matters: a MIME
                 refusal is transport, a throw here is the same init error the
                 blob path would have hit. */
              directCause: String(lastCause?.message || lastCause || '').slice(0, 140)
            });
            return mod;
          }
          throw new Error(`incomplete bundle (missing: ${missing.join(', ')})`);
        }
      } catch (cause) {
        blobCause = cause;
      }

      /* The module parsed but threw while starting — the honest, actionable
         case, and the one the panel used to report as a generic "update the
         app". `detail` carries the engine's own message. */
      const blobMessage = String(blobCause?.message || '');
      const transportNoise = /dynamically imported module|importing a module|failed to fetch/i.test(blobMessage);
      throw diagnose({ initCause: transportNoise ? null : blobCause });
    })().catch((error) => {
      /* A failed load must never poison later retries: the panel's retry
         button (and the next mount) re-runs the whole candidate list. */
      sdkModulePromise = null;
      throw error;
    });
  }
  return sdkModulePromise;
}

const asNumber = (value, fallback = null) => {
  try {
    const n = typeof value?.toNumber === 'function' ? value.toNumber() : Number(value);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
};

const decimalToNumber = (value, decimals = 0) => {
  const n = asNumber(value);
  if (n == null) return null;
  return n / (10 ** Number(decimals));
};

/** Exact decimal-string → base units conversion. Floats are never signed. */
export function toSolanaUnits(value, decimals) {
  const text = String(value ?? '').trim().replace(',', '.');
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > decimals) return null;
  try { return BigInt(`${whole}${fraction.padEnd(decimals, '0')}`); } catch { return null; }
}

export function fromSolanaUnits(value, decimals) {
  try {
    const raw = BigInt(value ?? 0).toString().padStart(Number(decimals) + 1, '0');
    const split = raw.length - Number(decimals);
    const whole = raw.slice(0, split);
    const fraction = raw.slice(split).replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : whole;
  } catch { return '0'; }
}

/** Uint8Array → base64, in chunks so a long transaction never blows the stack. */
export function bytesToBase64(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? []);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < arr.length; i += CHUNK) {
    binary += String.fromCharCode(...arr.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** The SPL Token program — the owner of every non-native Kamino reserve account. */
const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
/** Wrapped-SOL mint: the one reserve whose spendable balance is the native account. */
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';

/**
 * The wallet's SPENDABLE balance per Kamino reserve, in base units.
 *
 * One getParsedTokenAccountsByOwner call answers every SPL mint at once
 * (grouped by mint here); wSOL takes its real balance from the native account
 * — that is the account a SOL deposit actually spends, so reading the ATA
 * alone would report «BALANCE_UNKNOWN» for users who hold plain SOL.
 *
 * A failed read returns `{}` — handled downstream as BALANCE_UNKNOWN, never
 * as zero (§37).
 *
 * 2026-09-22: the two reads (native balance, parsed token accounts) each walk
 * the RPC candidate list until one node answers. A success — even an EMPTY
 * token-account list, which is a real answer for a fresh wallet — stops its
 * own walk; only a THROWN call moves to the next node.
 */
export async function readSolanaLendingBalances({ wallet, assets = [], rpcUrl = null } = {}) {
  if (!wallet) return {};
  const candidates = await lendingRpcCandidates(rpcUrl);
  const balances = {};
  const byMint = new Map(assets.filter((a) => a?.address).map((a) => [String(a.address), a]));
  const wantNative = byMint.has(WSOL_MINT);
  let nativeLamports = null;
  let nativeDone = !wantNative;
  let tokenDone = false;

  const fillTokenAccounts = (response) => {
    for (const entry of response?.value ?? []) {
      const info = entry?.account?.data?.parsed?.info;
      const mint = String(info?.mint || '');
      const asset = byMint.get(mint);
      if (!asset) continue;
      const raw = info?.tokenAmount?.amount;
      if (raw == null) continue;
      const current = balances[asset.id] ? BigInt(balances[asset.id]) : 0n;
      balances[asset.id] = (current + BigInt(raw)).toString();
    }
  };

  for (const url of candidates) {
    if (nativeDone && tokenDone) break;
    const connection = new Connection(url, { commitment: 'confirmed' });
    if (!nativeDone) {
      try {
        nativeLamports = BigInt(await connection.getBalance(new PublicKey(wallet)));
        nativeDone = true;
      } catch { nativeLamports = null; }
    }
    if (!tokenDone) {
      try {
        const response = await connection.getParsedTokenAccountsByOwner(
          new PublicKey(wallet),
          { programId: new PublicKey(SPL_TOKEN_PROGRAM_ID) }
        );
        fillTokenAccounts(response);
        tokenDone = true;
      } catch {
        /* Next candidate; the fall-through state stays `{}` — failure is
           reported downstream as BALANCE_UNKNOWN, never faked as zero. */
      }
    }
  }
  if (!nativeDone || !tokenDone) await resetRememberedSolanaRpc();
  if (nativeLamports != null && byMint.has(WSOL_MINT)) {
    const asset = byMint.get(WSOL_MINT);
    const wrapped = balances[asset.id] ? BigInt(balances[asset.id]) : 0n;
    /* Native + wrapped: both are spendable for a SOL deposit. Native wins the
       MAX amount display either way because Kamino unwraps. */
    balances[asset.id] = (wrapped + nativeLamports).toString();
  }
  return balances;
}

/**
 * §7/§9 — PREFLIGHT before the wallet is ever shown a transaction.
 *
 * Pure over an already-read market snapshot: the answer decides whether the
 * panel blocks the tap with a named reason instead of letting the wallet
 * pop up for a transaction the chain would refuse anyway.
 *
 * @returns {{ok:boolean, code:string|null, reason:string|null, amountWei:string|null}}
 */
export function preflightSolanaAction({ action, asset, amount, snapshot } = {}) {
  const finish = (ok, code = null, amountWei = null) => ({ ok, code, reason: code, amountWei });
  if (!asset) return finish(false, 'SOLANA_ASSET_REQUIRED');
  const decimals = Number(asset.decimals ?? 0);
  const amountWei = toSolanaUnits(amount, decimals);
  if (amountWei == null || amountWei <= 0n) return finish(false, 'AMOUNT_REQUIRED');
  const amountWeiString = amountWei.toString();

  const balances = snapshot?.balances || {};
  const walletWei = balances[asset.id] != null ? BigInt(balances[asset.id]) : null;
  const position = snapshot?.positions?.[asset.id] || null;
  /** Display-unit strings of the CDC position, converted to base units. */
  const suppliedWei = position?.supplied != null ? toSolanaUnits(position.supplied, decimals) : null;
  const borrowedWei = position?.borrowed != null ? toSolanaUnits(position.borrowed, decimals) : null;

  if (action === 'supply') {
    if (walletWei == null) {
      /* Unknown is not zero: block the popup rather than burn the user's
         network fee on a transaction the chain will refuse. The retry button
         re-reads the balance. */
      return finish(false, 'BALANCE_UNKNOWN', amountWeiString);
    }
    if (amountWei > walletWei) return finish(false, 'INSUFFICIENT_BALANCE', amountWeiString);
    return finish(true, null, amountWeiString);
  }
  if (action === 'withdraw') {
    if (suppliedWei == null || suppliedWei <= 0n) return finish(false, 'SOLANA_POSITION_REQUIRED', amountWeiString);
    if (amountWei > suppliedWei) return finish(false, 'INSUFFICIENT_BALANCE', amountWeiString);
    return finish(true, null, amountWeiString);
  }
  if (action === 'repay') {
    if (borrowedWei == null || borrowedWei <= 0n) return finish(false, 'SOLANA_POSITION_REQUIRED', amountWeiString);
    if (amountWei > borrowedWei) return finish(false, 'EXCEEDS_DEBT', amountWeiString);
    if (walletWei == null) return finish(false, 'BALANCE_UNKNOWN', amountWeiString);
    if (amountWei > walletWei) return finish(false, 'INSUFFICIENT_BALANCE', amountWeiString);
    return finish(true, null, amountWeiString);
  }
  if (action === 'borrow') {
    /* Borrowing power is tracked server-side by Kamino's own obligation
       refresh — when available, check the human-typed amount against it
       before the popup; the SDK build remains the final arbiter. */
    const availableUsd = Number(snapshot?.account?.availableBorrowsUsd);
    const priceUsd = Number(asset.priceUsd);
    if (Number.isFinite(availableUsd) && Number.isFinite(priceUsd) && priceUsd > 0) {
      const amountUsd = Number(amount) * priceUsd;
      if (Number.isFinite(amountUsd) && amountUsd > availableUsd && availableUsd >= 0) {
        return finish(false, 'BORROW_LIMIT_EXCEEDED', amountWeiString);
      }
      if (availableUsd <= 0 && amountUsd > 0) return finish(false, 'BORROW_LIMIT_EXCEEDED', amountWeiString);
    }
    return finish(true, null, amountWeiString);
  }
  return finish(false, 'UNKNOWN_ACTION');
}

/**
 * Call one SDK/reserve accessor and swallow its throw: a single method that
 * reverts or throws reads as `null` — the same shape an absent field already
 * produces — instead of taking the whole market read down with it. (§28: a
 * partial read is labelled, it never becomes a fatal one.)
 */
const safeCall = (fn) => {
  try { return typeof fn === 'function' ? fn() : null; } catch { return null; }
};

const reserveToView = (reserve, slot) => {
  const stats = reserve?.stats || {};
  const decimals = asNumber(stats.decimals, 0);
  const address58 = safeCall(() => reserve.address?.toBase58?.());
  const mint = safeCall(() => reserve?.getLiquidityMint?.())?.toBase58?.() || stats.mintAddress?.toBase58?.() || null;
  /* The APY getters take the CURRENT SLOT. Feeding them `null` (the market
     read's slot can be unavailable when that one call is throttled) computes
     NaN and the panel loses both APY figures; with no slot known, the honest
     answer is '—', not a number derived from a slot of zero. */
  const apySlot = Number.isFinite(Number(slot)) ? Number(slot) : null;
  const supplyApy = apySlot == null ? null : asNumber(safeCall(() => reserve.totalSupplyAPY?.(apySlot)));
  const borrowApy = apySlot == null ? null : asNumber(safeCall(() => reserve.totalBorrowAPY?.(apySlot)));
  return {
    id: address58 || mint || reserve.symbol,
    symbol: reserve.symbol || stats.symbol || 'TOKEN',
    name: reserve.symbol || stats.symbol || 'Solana asset',
    address: mint,
    chain: SOLANA_LENDING_CHAIN_ID,
    decimals,
    listed: true,
    status: String(stats.status || 'Active').toLowerCase(),
    supplyApyPct: supplyApy,
    borrowApyPct: borrowApy,
    loanToValuePct: asNumber(stats.loanToValue) == null ? null : asNumber(stats.loanToValue) * 100,
    liquidationThresholdPct: asNumber(stats.liquidationThreshold) == null ? null : asNumber(stats.liquidationThreshold) * 100,
    availableLiquidity: decimalToNumber(safeCall(() => reserve.getLiquidityAvailableAmount?.()), decimals),
    borrowed: decimalToNumber(safeCall(() => reserve.getBorrowedAmount?.()), decimals),
    supplyCap: decimalToNumber(stats.reserveDepositLimit, decimals),
    borrowCap: decimalToNumber(stats.reserveBorrowLimit, decimals),
    /* Kamino's own oracle-derived price (USD). Used ONLY to compare a typed
       borrow amount against the wallet's USD borrow limit before a wallet
       popup — never displayed as a market price, never a risk input
       elsewhere.
       2026-09-22: this read `stats.priceUSD`, which does not exist on the
       klend-sdk v5 reserve stats (ReserveDataType has no price field), so the
       value was ALWAYS null and the borrow preflight silently let any amount
       through. `getOracleMarketPrice()` is the v5 accessor. */
    priceUsd: (() => {
      const price = asNumber(safeCall(() => reserve.getOracleMarketPrice?.()));
      return Number.isFinite(price) && price > 0 ? price : null;
    })(),
    reserve
  };
};


/**
 * Read Kamino reserves and the wallet's vanilla obligation. The SDK does the
 * protocol/account decoding; this function only serializes values for React.
 * The node it reads from is the app's probed RPC layer by default — not the
 * Foundation's most-throttled endpoint (see `resolveLendingRpc`).
 *
 * @returns the market snapshot. A failure is THROWN as a coded error
 *   (KAMINO_SDK_UNAVAILABLE / KAMINO_MARKET_UNAVAILABLE / RPC_ERROR /
 *   RPC_RATE_LIMITED) so the panel can explain WHICH thing is down instead of
 *   collapsing every cause into one sentence (§28).
 */
export async function readSolanaLendingMarket({ wallet = null, rpcUrl = null } = {}) {
  const candidates = await lendingRpcCandidates(rpcUrl);
  const { KaminoMarket, DEFAULT_RECENT_SLOT_DURATION_MS } = await sdkPromise();
  const attempts = [];
  let market = null;
  let url = candidates[0];
  let slot = null;
  /* The market load is the expensive call (dozens of accounts), so the walk
     stops at the first node that answers it — later reads reuse the winner. */
  for (const candidate of candidates) {
    const connection = new Connection(candidate, { commitment: 'confirmed' });
    try {
      market = await KaminoMarket.load(
        connection,
        new PublicKey(KAMINO_MAIN_MARKET),
        DEFAULT_RECENT_SLOT_DURATION_MS || 450,
        new PublicKey(KAMINO_LENDING_PROGRAM)
      );
    } catch (cause) {
      attempts.push({ url: candidate, code: cause?.code || null, error: String(cause?.message || cause || '').slice(0, 120) });
      market = null;
      continue;
    }
    if (!market) {
      attempts.push({ url: candidate, error: 'empty market' });
      continue;
    }
    url = candidate;
    try { slot = await connection.getSlot('processed'); } catch { slot = null; }
    break;
  }
  if (!market) {
    await resetRememberedSolanaRpc();
    throw lendingRpcFailure(attempts);
  }

  /* The reserve LIST itself failing is a market failure — the SDK decoded
     the market but its reserve accessor threw — so it is thrown as a coded
     error, never as an empty market pretending to be healthy. */
  let rawReserves = [];
  try {
    rawReserves = market.getReserves();
  } catch (cause) {
    throw solanaReadError(cause, 'KAMINO_MARKET_UNAVAILABLE');
  }

  /* ONE corrupted/throwing reserve must not kill the whole market (the
     EVM engine already works this way): each reserve is converted inside its
     own try/catch — a failure is SKIPPED and named in `failures` so the panel
     can say a market is PARTIALLY read rather than down. */
  const reserves = [];
  const reserveFailures = [];
  for (const reserve of Array.isArray(rawReserves) ? rawReserves : []) {
    try {
      const view = reserveToView(reserve, slot);
      if (view.status !== 'hidden' && view.status !== 'obsolete') reserves.push(view);
    } catch (cause) {
      reserveFailures.push({
        reserve: safeCall(() => reserve?.address?.toBase58?.()) || reserve?.symbol || 'unknown',
        error: String(cause?.message || cause || '').slice(0, 120)
      });
    }
  }

  /* A failed obligation read is NOT "no position": it is unknown, and the
     panel must say so instead of showing an empty position with $0s. */
  let obligation = null;
  let obligationUnknown = false;
  if (wallet) {
    try {
      obligation = await market.getUserVanillaObligation(new PublicKey(wallet));
    } catch {
      obligation = null;
      obligationUnknown = true;
    }
  }

  /* The wallet's spendable balance per reserve (§7 preflight input), with its
     own failover across every candidate — NOT pinned to the market winner, so
     a node that serves the market but throttles parsed-account reads cannot
     single-handedly force BALANCE_UNKNOWN. A failed read stays empty — the
     panel reports BALANCE_UNKNOWN and refuses to open the wallet for a
     transaction it cannot pre-check. */
  let balances = {};
  let balancesUnknown = false;
  if (wallet) {
    try {
      balances = await readSolanaLendingBalances({ wallet, assets: reserves });
      balancesUnknown = Object.keys(balances || {}).length === 0;
    } catch { balances = {}; balancesUnknown = true; }
  }

  const positions = {};
  for (const asset of reserves) {
    const reserve = asset.reserve;
    /* A throwing obligation accessor reads as "no position here", not as a
       failed market read — the obligation read itself already reports
       `unknown` separately when it fails wholesale. */
    const deposit = safeCall(() => obligation?.getDepositByReserve?.(reserve.address));
    const borrow = safeCall(() => obligation?.getBorrowByReserve?.(reserve.address));
    const decimals = asset.decimals;
    const walletWei = balances[asset.id];
    positions[asset.id] = {
      supplied: deposit ? String(decimalToNumber(deposit.amount, decimals)) : '0',
      borrowed: borrow ? String(decimalToNumber(borrow.amount, decimals)) : '0',
      suppliedUsd: deposit ? asNumber(deposit.marketValueRefreshed) : 0,
      borrowedUsd: borrow ? asNumber(borrow.marketValueRefreshed) : 0,
      walletBalance: walletWei != null ? fromSolanaUnits(walletWei, decimals) : null
    };
  }

  const stats = obligation?.refreshedStats;
  const totalCollateralUsd = asNumber(stats?.userTotalDeposit, 0);
  const totalDebtUsd = asNumber(stats?.userTotalBorrow, 0);
  const borrowLimitUsd = asNumber(stats?.borrowLimit, 0);
  return {
    ok: true,
    chainId: SOLANA_LENDING_CHAIN_ID,
    protocol: 'kamino-klend',
    marketAddress: KAMINO_MAIN_MARKET,
    rpcUrl: url,
    slot,
    readAt: new Date().toISOString(),
    dataStatus: 'live',
    assets: reserves.map(({ reserve: _reserve, ...view }) => view),
    reserves,
    positions,
    balances,
    account: {
      ok: Boolean(obligation),
      /* When the obligation could not be read, every figure below is a
         placeholder zero — the panel renders '—' and a retry, not $0.00. */
      unknown: obligationUnknown,
      balancesUnknown,
      totalCollateralUsd,
      totalDebtUsd,
      availableBorrowsUsd: obligationUnknown ? null : Math.max(0, borrowLimitUsd - totalDebtUsd),
      healthFactor: totalDebtUsd > 0 && asNumber(stats?.borrowLiquidationLimit) != null
        ? asNumber(stats.borrowLiquidationLimit) / totalDebtUsd
        : null,
      ltvPct: totalCollateralUsd > 0 ? (totalDebtUsd / totalCollateralUsd) * 100 : 0,
      liquidationThresholdPct: totalCollateralUsd > 0 && asNumber(stats?.borrowLiquidationLimit) != null
        ? (asNumber(stats.borrowLiquidationLimit) / totalCollateralUsd) * 100
        : null
    },
    /* Reserves that could not be read at all — named, so a PARTIAL market
       read is visible as one (§28) instead of silently shrinking the list. */
    failures: reserveFailures
  };
}

/** Build one or more unsigned Kamino transactions for the connected wallet. */
/**
 * ─── THE klend-sdk v5 CALL MAP (verified, 2026-09-22) ───────────────────────
 *
 * The panel's Solana loan was written against an OLDER klend build, so its
 * calls did not match the ^5.0.0 dependency this app installs. Read from
 * node_modules/@kamino-finance/klend-sdk@5.15.4/dist/classes/action.d.ts —
 * where `.d.ts` is the contract — the signatures are:
 *
 *   buildDepositTxns(market, amount, mint, owner, obligation, useV2Ixs,
 *                    scopeRefreshConfig, extraComputeBudget?, includeAtaIxs?,
 *                    requestElevationGroup?, initUserMetadata?, referrer?,
 *                    currentSlot?, overrideElevationGroupRequest?)
 *   buildBorrowTxns(… same …)      buildWithdrawTxns(… same …)
 *   buildRepayTxns(market, amount, mint, owner, obligation, useV2Ixs,
 *                  scopeRefreshConfig, currentSlot, payer?,
 *                  extraComputeBudget?, includeAtaIxs?, …)
 *
 * and `getTransactions()` resolves to ONE `Transaction` — NOT the
 * `{ preLendingTxn, lendingTxn, postLendingTxn }` object of the older API.
 *
 * What the old call sites actually passed, per action, and why each was wrong:
 *
 *   supply   (…, 0, true, false, false) → useV2Ixs=0, scopeRefreshConfig=TRUE
 *            (an object is expected — `scopeRefreshConfig.scope` would be
 *            undefined), includeAtaIxs=FALSE (no wSOL ATA is created or
 *            closed, so a SOL deposit cannot work).
 *   borrow   same, plus no compute-budget ix (extraComputeBudget=0).
 *   withdraw same, includeAtaIxs=FALSE.
 *   repay    (…, slot, undefined, 0, true, false, false) → useV2Ixs=SLOT (a
 *            truthy number!), currentSlot=0, payer=true (a boolean where a
 *            PublicKey goes).
 *
 * `scopeRefreshConfig: undefined` is deliberate: pushing Scope prices inside
 * the transaction needs the Scope SDK's price feeds, which this app does not
 * load — Kamino's own on-chain refresh instructions are enough.
 *
 * Kept as a separate, SDK-parameterised function so a test can pin the exact
 * argument list against a stub, and so a future SDK bump fails in the test
 * suite (test/solana-lending-precision.test.js reads the installed `.d.ts`).
 */
export const KAMINO_ACTION_CALL = {
  /* The classic instruction set. `useV2Ixs` swaps in the newer
     `addDepositIxV2`/`addBorrowIxV2` variants; both exist on-chain and the
     classic path is the conservative choice — nothing here needs V2, and
     opting in should be a deliberate, tested step, not a default. */
  useV2Ixs: false,
  /* No in-transaction Scope price push: that needs the Scope SDK's price
     feeds, which this app does not load. Kamino's own refresh instructions
     are what the transaction relies on. */
  scopeRefreshConfig: undefined,
  /* > 0 adds the compute-budget instruction (the SDK's own default). */
  extraComputeBudget: 1_000_000,
  /* Create/close the wSOL and token ATAs. Without this a SOL deposit or
     withdrawal builds a transaction that cannot run. */
  includeAtaIxs: true
};

export async function buildKaminoActionTransactions({ sdk, action, market, mint, owner, obligationOrPda, amountWei, slot, BN } = {}) {
  const { KaminoAction } = sdk || {};
  if (typeof KaminoAction !== 'object' && typeof KaminoAction !== 'function') return { ok: false, code: 'KAMINO_SDK_FAILED' };
  const amount = new BN(amountWei.toString());
  const { useV2Ixs, scopeRefreshConfig, extraComputeBudget, includeAtaIxs } = KAMINO_ACTION_CALL;
  const common = [market, amount, mint, owner, obligationOrPda, useV2Ixs, scopeRefreshConfig, extraComputeBudget, includeAtaIxs];
  try {
    if (action === 'supply') return { ok: true, built: await KaminoAction.buildDepositTxns(...common) };
    if (action === 'borrow') return { ok: true, built: await KaminoAction.buildBorrowTxns(...common) };
    if (action === 'withdraw') return { ok: true, built: await KaminoAction.buildWithdrawTxns(...common) };
    if (action === 'repay') {
      /* buildRepayTxns takes the CURRENT SLOT as its 8th argument (the older
         API took it after `obligation`; the new one takes useV2Ixs and the
         scope config first). `payer`/`referrer` are left to their defaults. */
      return {
        ok: true,
        built: await KaminoAction.buildRepayTxns(market, amount, mint, owner, obligationOrPda, useV2Ixs, scopeRefreshConfig, Number.isFinite(slot) ? slot : 0, undefined, extraComputeBudget, includeAtaIxs)
      };
    }
  } catch (cause) {
    const code = String(cause?.code || cause?.message || '').trim();
    return { ok: false, code: /KAMINO|RPC|429/.test(code) ? code : 'KAMINO_TX_BUILD_FAILED', detail: String(cause?.message || cause || '').slice(0, 160) };
  }
  return { ok: false, code: 'UNKNOWN_ACTION' };
}

/**
 * A built Kamino action → the ordered list of unsigned transactions, in the
 * shape the panel signs.
 *
 * klend-sdk v5 returns ONE legacy `Transaction` from `getTransactions()`. The
 * older API (and the panel's own header comment) returned
 * `{ preLendingTxn, lendingTxn, postLendingTxn }`. Both are accepted, because
 * the failure mode of guessing wrong is the worst one available: every entry
 * is `undefined`, the list filters down to empty, and the panel reports
 * SUCCESS having never asked the wallet for anything. An empty result is
 * therefore an explicit, named failure.
 *
 * `versioned` travels WITH each transaction: v5 builds legacy transactions and
 * the panel used to hand every one of them to the wallet as
 * `{ versioned: true }`, i.e. `VersionedTransaction.deserialize()` on legacy
 * bytes — which throws before the user ever sees a signature request.
 */
export async function collectKaminoTransactions(built, action) {
  const produced = typeof built?.getTransactions === 'function' ? await built.getTransactions() : null;
  const entries = [];
  const push = (id, tx) => { if (tx) entries.push({ id, tx }); };
  if (produced && typeof produced.serialize === 'function') {
    /* v5: a single transaction (all instructions, including the ATA setup and
       cleanup, already inside it). */
    push(action, produced);
  } else if (Array.isArray(produced)) {
    produced.forEach((tx, index) => push(index === 0 ? action : `${action}-${index + 1}`, tx));
  } else if (produced && typeof produced === 'object') {
    push('preparing', produced.preLendingTxn);
    push(action, produced.lendingTxn);
    push('cleanup', produced.postLendingTxn);
  }
  if (!entries.length && typeof built?.getVersionedTransactions === 'function') {
    const versioned = await built.getVersionedTransactions();
    if (versioned && typeof versioned.serialize === 'function') push(action, versioned);
    else if (versioned && typeof versioned === 'object') {
      push('preparing', versioned.preLendingTxn);
      push(action, versioned.lendingTxn);
      push('cleanup', versioned.postLendingTxn);
    }
  }
  return entries;
}

/** Legacy `Transaction` vs `VersionedTransaction`, without importing either. */
export function isVersionedTransaction(tx) {
  try {
    if (!tx) return false;
    if (typeof tx.version === 'number') return true;
    return typeof tx?.message?.version === 'number';
  } catch { return false; }
}

/** Build one or more unsigned Kamino transactions for the connected wallet. */
export async function buildSolanaLendingTransactions({ action, asset, amount, wallet, rpcUrl = null } = {}) {
  if (!wallet) return { ok: false, code: 'SOLANA_WALLET_REQUIRED' };
  if (!asset?.address) return { ok: false, code: 'SOLANA_ASSET_REQUIRED' };
  const amountWei = toSolanaUnits(amount, Number(asset.decimals));
  if (amountWei == null || amountWei <= 0n) return { ok: false, code: 'AMOUNT_REQUIRED' };

  const candidates = await lendingRpcCandidates(rpcUrl);
  const [sdk, { default: BN }] = await Promise.all([sdkPromise(), import('bn.js')]);
  const { KaminoMarket, VanillaObligation, PROGRAM_ID, DEFAULT_RECENT_SLOT_DURATION_MS } = sdk;
  const owner = new PublicKey(wallet);
  const mint = new PublicKey(asset.address);

  /* The whole build is unsigned, so retrying it on the next node is safe: no
     signature exists yet to duplicate. A node that 429s mid-build must not be
     the reason a valid action dies. */
  const attempts = [];
  let entries = null;
  let builtUrl = null;
  for (const url of candidates) {
    const connection = new Connection(url, { commitment: 'confirmed' });
    try {
      const market = await KaminoMarket.load(
        connection,
        new PublicKey(KAMINO_MAIN_MARKET),
        DEFAULT_RECENT_SLOT_DURATION_MS || 450,
        PROGRAM_ID
      );
      if (!market) throw new Error('KAMINO_MARKET_UNAVAILABLE');

      let obligation = null;
      let obligationFailed = false;
      try {
        obligation = await market.getUserVanillaObligation(owner);
      } catch {
        obligation = null;
        obligationFailed = true;
      }
      /* An obligation READ failure is a network failure, not "no position":
         answering borrow with SOLANA_COLLATERAL_REQUIRED here would send a
         user with real collateral to deposit more of it. */
      if (!obligation && obligationFailed && action !== 'supply') {
        throw new Error('RPC_ERROR');
      }
      const obligationOrPda = obligation || new VanillaObligation(PROGRAM_ID);
      const slot = action === 'repay' ? await connection.getSlot('processed') : undefined;

      if (action === 'borrow' && !obligation) return { ok: false, code: 'SOLANA_COLLATERAL_REQUIRED' };
      if ((action === 'withdraw' || action === 'repay') && !obligation) return { ok: false, code: 'SOLANA_POSITION_REQUIRED' };

      const result = await buildKaminoActionTransactions({
        sdk, action, market, mint, owner,
        obligationOrPda: action === 'supply' ? obligationOrPda : obligation,
        amountWei, slot, BN
      });
      if (!result.ok) {
        /* An SDK-side refusal (bad amount, no collateral, …) is final for this
           action; only transport failures are worth retrying on another node. */
        if (result.code !== 'KAMINO_TX_BUILD_FAILED') return result;
        throw new Error(result.detail || result.code);
      }

      entries = await collectKaminoTransactions(result.built, action);
      if (!entries.length) {
        return {
          ok: false,
          code: 'KAMINO_TX_BUILD_EMPTY',
          detail: 'the SDK returned no transaction for this action — the klend-sdk API changed shape'
        };
      }
      builtUrl = url;
      break;
    } catch (cause) {
      attempts.push({ url, code: cause?.code || null, error: String(cause?.message || cause || '').slice(0, 120) });
    }
  }
  if (!entries) {
    await resetRememberedSolanaRpc();
    const failure = lendingRpcFailure(attempts);
    return { ok: false, code: failure.code === 'KAMINO_MARKET_UNAVAILABLE' ? 'KAMINO_MARKET_UNAVAILABLE' : failure.code, detail: failure.detail };
  }
  void builtUrl;
  /* `Buffer.from(...)` was a Node-ism: the browser has no Buffer global (it is
     only polyfilled lazily by the dYdX path, which a lending-only user never
     opens), so every transaction build threw ReferenceError before a wallet
     was ever asked — «Solana deposit does not work» in production. */
  const encode = (tx) => tx ? bytesToBase64(tx.serialize({ requireAllSignatures: false, verifySignatures: false })) : null;
  const transactions = entries
    .map(({ id, tx }) => ({
      id,
      transaction: encode(tx),
      /* Per-transaction, not per-panel: the wallet layer maps `versioned: true`
         to transaction VERSION 0 and `false` to 'legacy' — deserialising one
         as the other throws. */
      versioned: isVersionedTransaction(tx)
    }))
    .filter((entry) => entry.transaction);
  if (!transactions.length) {
    return { ok: false, code: 'KAMINO_TX_BUILD_EMPTY', detail: 'the built transactions could not be serialized' };
  }
  return {
    ok: true,
    action,
    amount: String(amount),
    amountWei: amountWei.toString(),
    transactions,
    protocol: 'kamino-klend',
    chainId: SOLANA_LENDING_CHAIN_ID
  };
}

export async function getSolanaLendingTransactionStatus(signature, { rpcUrl = null } = {}) {
  const candidates = await lendingRpcCandidates(rpcUrl);
  const attempts = [];
  for (const url of candidates) {
    try {
      const connection = new Connection(url, { commitment: 'confirmed' });
      const result = await connection.getSignatureStatuses([signature]);
      const status = result?.value?.[0];
      if (!status) return { ok: false, code: 'TRANSACTION_NOT_FOUND' };
      if (status.err) return { ok: false, code: 'TRANSACTION_FAILED', error: status.err };
      return { ok: true, confirmed: Boolean(status.confirmationStatus), slot: status.slot };
    } catch (cause) {
      attempts.push({ url, code: cause?.code || null, error: String(cause?.message || cause || '').slice(0, 120) });
    }
  }
  /* Every node refused the question — that is a network failure, NOT "this
     transaction does not exist". */
  const failure = lendingRpcFailure(attempts);
  return { ok: false, code: failure.code === 'KAMINO_MARKET_UNAVAILABLE' ? 'RPC_ERROR' : failure.code, detail: failure.detail };
}

/**
 * Do not show a successful loan until the Solana cluster has acknowledged it.
 *
 * 2026-09-22: a poll that THROWS (a node going down mid-confirmation) used to
 * reject the whole wait — the user's transaction was fine, but the panel
 * reported a failure. Poll errors now rotate to the next candidate and keep
 * waiting until the deadline; only the deadline itself is a timeout.
 */
export async function waitForSolanaLendingTransaction(signature, { rpcUrl = null, timeoutMs = 20_000 } = {}) {
  const candidates = await lendingRpcCandidates(rpcUrl);
  let index = 0;
  let connection = new Connection(candidates[index], { commitment: 'confirmed' });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let result = null;
    try {
      result = await connection.getSignatureStatuses([signature]);
    } catch {
      /* Rotate to the next node and keep waiting — the transaction may be
         confirming fine while this one node is down. */
      index = (index + 1) % candidates.length;
      connection = new Connection(candidates[index], { commitment: 'confirmed' });
      await new Promise((resolve) => setTimeout(resolve, 700));
      continue;
    }
    const status = result?.value?.[0];
    if (status?.err) return { ok: false, code: 'TRANSACTION_FAILED', error: status.err };
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
      return { ok: true, confirmed: true, slot: status.slot };
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  return { ok: false, code: 'SOLANA_CONFIRMATION_TIMEOUT' };
}
