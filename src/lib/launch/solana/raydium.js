/**
 * SOLANA LAUNCH — the DEX adapter boundary, and why it currently REFUSES.
 * ============================================================================
 *
 * The EVM side can afford to pin a V2 factory address and PROVE it at runtime
 * (`getPair` + `pair.factory()` + `router.factory()` before any signature),
 * because every V2 fork exposes the same three view calls. Raydium's AMM does
 * not: pool creation is a specific instruction with a specific account list
 * derived from constants inside Raydium's own program, and those constants
 * (program id, AMM config ids, fee destinations, authority PDAs) change with
 * each program version.
 *
 * So this adapter does the only honest thing until the official IDL is pinned
 * in this repository and reviewed:
 *
 *   · `status` says NOT_READY with the exact missing pieces,
 *   · `buildPoolPlan()` THROWS `RAYDIUM_IDL_NOT_PINNED` instead of inventing
 *     an account list, and
 *   · `verifyPool()` still exists — because the CHECK does not depend on the
 *     pool creation bytes at all: a pool is only acceptable when its on-chain
 *     account names the user's mint as one of its two tokens (`checkPoolTokens`
 *     in ./spl.js).
 *
 * Guessing here would not produce a revert — it would produce a transaction
 * that moves a user's tokens somewhere we cannot name. That is precisely the
 * failure mode this refusal exists to prevent.
 */

export const RAYDIUM_ADAPTER_ID = 'raydium-amm';

/* The one address we CAN state without an IDL: Raydium's AMM program id is a
   published, long-standing constant. Everything else it needs (AMM config,
   fee destination, authority PDA, the openbook market for the pair) is NOT
   pinned here — see the refusal below. */
export const RAYDIUM_AMM_PROGRAM_ID = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';

/** Parts of the Raydium flow and their honest state. */
export const RAYDIUM_PARTS = Object.freeze([
  { id: 'program-id', status: 'READY', detail: 'The AMM program id is a published constant.' },
  { id: 'idl', status: 'PENDING', detail: 'The official IDL (instruction discriminators + account layouts) is not pinned in this repository.' },
  { id: 'amm-config', status: 'PENDING', detail: 'The pool\'s AMM config id and fee destination are program-version specific and are not pinned.' },
  { id: 'market', status: 'PENDING', detail: 'An OpenBook market (or the CPMM path) for the pair must be chosen per launch; nothing is guessed.' }
]);

export function raydiumAdapterStatus() {
  const pending = RAYDIUM_PARTS.filter((p) => p.status !== 'READY').map((p) => p.id);
  return {
    id: RAYDIUM_ADAPTER_ID,
    programId: RAYDIUM_AMM_PROGRAM_ID,
    status: pending.length ? 'NOT_READY' : 'READY',
    pending,
    parts: RAYDIUM_PARTS.map((p) => ({ ...p })),
    statement: pending.length
      ? `Pool creation on Raydium is not buildable yet (${pending.join(', ')}). The adapter refuses to emit bytes it cannot derive from a pinned, reviewed IDL.`
      : 'Raydium pool creation is ready.'
  };
}

/**
 * The pool-creation plan. DELIBERATELY throws: see the header. A caller that
 * wants to know why should read `raydiumAdapterStatus().pending`.
 */
export function buildPoolPlan(_intent) {
  const err = new Error('RAYDIUM_IDL_NOT_PINNED');
  err.detail = raydiumAdapterStatus().pending;
  throw err;
}

/**
 * The verification half, which does not need the IDL: given a decoded pool
 * account, the pool is yours only if it references your mint.
 *
 * @param {object} pool { mintA, mintB } as read from the chain
 * @param {object} expected { mint }
 */
export function verifyPoolTokens(pool, { mint } = {}) {
  const mints = [pool?.mintA, pool?.mintB].filter(Boolean).map(String);
  if (!mints.length) return { ok: false, problems: ['POOL_TOKENS_UNREADABLE'] };
  if (!mints.includes(String(mint))) return { ok: false, problems: ['POOL_DOES_NOT_REFERENCE_MINT'] };
  return { ok: true, problems: [] };
}
