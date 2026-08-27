/**
 * SEND HISTORY — the counterparty record the address shield reads.
 * ---------------------------------------------------------------------------
 * Address poisoning only works against a wallet that cannot tell a stranger
 * from a counterparty. To tell them apart we need a record of who has actually
 * been paid before, so this keeps a small, local, per-wallet list of
 * successful outgoing transfers.
 *
 * It is deliberately minimal:
 *   · addresses, direction, value and time — nothing that identifies a person
 *   · local only; it is never sent anywhere
 *   · a read failure returns an empty list, and an empty list makes every
 *     recipient a first-time recipient, which is the SAFE direction to fail
 */

const KEY = 'fbt.send.history.v1';
const MAX_ROWS = 200;
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

const norm = (a) => (typeof a === 'string' && ADDRESS.test(a.trim()) ? a.trim().toLowerCase() : null);

function store() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Everything we know about who this wallet has transacted with. */
export function readSendHistory(owner = null) {
  const ls = store();
  if (!ls) return [];
  let rows = [];
  try {
    const raw = JSON.parse(ls.getItem(KEY) || '[]');
    rows = Array.isArray(raw) ? raw : [];
  } catch {
    // A corrupt record is an empty record, never a trusted one.
    return [];
  }
  const me = norm(owner);
  return rows
    .map((row) => ({
      address: norm(row?.address),
      owner: norm(row?.owner),
      direction: row?.direction === 'in' ? 'in' : 'out',
      valueUsd: Number.isFinite(Number(row?.valueUsd)) ? Number(row.valueUsd) : null,
      at: Number.isFinite(Number(row?.at)) ? Number(row.at) : null,
      chainId: Number.isFinite(Number(row?.chainId)) ? Number(row.chainId) : null
    }))
    .filter((row) => row.address && (me === null || row.owner === null || row.owner === me));
}

/** Record a transfer that actually happened. */
export function recordSend({ owner = null, address = null, direction = 'out', valueUsd = null, chainId = null, at = Date.now() } = {}) {
  const ls = store();
  const to = norm(address);
  if (!ls || !to) return false;
  try {
    const raw = JSON.parse(ls.getItem(KEY) || '[]');
    const rows = Array.isArray(raw) ? raw : [];
    rows.unshift({
      owner: norm(owner),
      address: to,
      direction: direction === 'in' ? 'in' : 'out',
      valueUsd: Number.isFinite(Number(valueUsd)) ? Number(valueUsd) : null,
      chainId: Number.isFinite(Number(chainId)) ? Number(chainId) : null,
      at
    });
    ls.setItem(KEY, JSON.stringify(rows.slice(0, MAX_ROWS)));
    return true;
  } catch {
    return false;
  }
}

/** Has this wallet ever deliberately paid this address before? */
export function isKnownRecipient(owner, address) {
  const to = norm(address);
  if (!to) return false;
  return readSendHistory(owner).some((row) => row.address === to && row.direction === 'out');
}
