/**
 * WALLETCONNECT EVENT TRACE
 * ---------------------------------------------------------------------------
 * The answer to "it disconnected by itself" is evidence, not a guess. This is
 * a bounded ring buffer of lifecycle event NAMES and small numbers.
 *
 * WHAT IS DELIBERATELY NOT RECORDED: the pairing URI (a live QR secret),
 * session topics, addresses, chain payloads, or any string a relay could put
 * data in. This buffer is designed to be pasted into a support message, and a
 * log that can leak a pairing URI is one copy-paste away from a session
 * hijack. The shape below is a contract, not a style choice.
 */

const MAX = 40;

/** @type {Array<{ at: number, event: string, n?: number, ok?: boolean }>} */
const trace = [];

/** Append an event. `extra` accepts only a finite number or a boolean. */
export function wcEvent(event, extra) {
  const entry = { at: Date.now(), event: String(event).slice(0, 48) };
  if (typeof extra === 'number' && Number.isFinite(extra)) entry.n = extra;
  if (typeof extra === 'boolean') entry.ok = extra;
  trace.push(entry);
  if (trace.length > MAX) trace.splice(0, trace.length - MAX);
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
    // eslint-disable-next-line no-console
    console.info(`[wc] ${entry.event}`, entry.n ?? entry.ok ?? '');
  }
}

/** Snapshot for the health panel / a support export. Returns a copy. */
export function wcTraceSnapshot() {
  return trace.map((entry) => ({ ...entry }));
}

/** Test hook: empty the buffer. */
export function wcTraceReset() {
  trace.length = 0;
}
