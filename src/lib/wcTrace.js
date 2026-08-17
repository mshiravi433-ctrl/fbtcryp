/**
 * WALLETCONNECT EVENT TRACE
 * ---------------------------------------------------------------------------
 * Answers the recurring report "Trust Wallet disconnected by itself a few
 * minutes after connecting" with evidence instead of guesses.
 *
 * Records the LAST handful of lifecycle events — names and timestamps ONLY.
 * What is deliberately NOT recorded, because this buffer could be read by a
 * support screenshot: the pairing URI (a live QR secret), session topics,
 * accounts, chain payloads, or any error string a relay might embed data in.
 * An event log that can leak a pairing URI is one log line away from a
 * session hijack, so the shape below is a contract, not a style choice.
 *
 * Printing happens only in development builds. In production the trace sits
 * in memory for a support export and never touches the console.
 */

const MAX = 40;

/** @type {Array<{ at: number, event: string }>} */
const trace = [];

/** Append an event. `extra` is sanitized to a small set of safe primitives. */
export function wcEvent(event, extra) {
  const entry = { at: Date.now(), event: String(event).slice(0, 48) };
  /* Only explicitly-whitelisted scalar facts may ride along — an event name
     and a number. Never a string payload: URIs, topics and addresses are all
     strings, and all of them stay out of the trace. */
  if (typeof extra === 'number' && Number.isFinite(extra)) entry.n = extra;
  if (typeof extra === 'boolean') entry.ok = extra;
  trace.push(entry);
  if (trace.length > MAX) trace.splice(0, trace.length - MAX);

  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
    // eslint-disable-next-line no-console
    console.info(`[wc] ${entry.event}`, entry.n ?? entry.ok ?? '');
  }
}

/** Snapshot for diagnostics / support export. Returns a copy. */
export function wcTraceSnapshot() {
  return trace.map((e) => ({ ...e }));
}

/** Test hook: empty the buffer. */
export function wcTraceReset() {
  trace.length = 0;
}
