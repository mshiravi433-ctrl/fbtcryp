/**
 * SOLANA LAUNCH — the DEX adapter boundary (Raydium LaunchLab).
 * ============================================================================
 *
 * HISTORY: this adapter used to target Raydium AMM v4 pool creation and
 * REFUSED to emit bytes, because that path needs an OpenBook market plus
 * program-version-specific config accounts — none of it pinnable or provable
 * here. Guessing would have produced "a transaction that moves a user's
 * tokens somewhere we cannot name", so `buildPoolPlan` threw
 * RAYDIUM_IDL_NOT_PINNED and the UI showed COMING_SOON.
 *
 * WHAT CHANGED (2026-09-14): the adapter now targets Raydium LAUNCHLAB, the
 * launchpad-native path, with every byte derived from pinned, reviewed
 * sources — see the pin list in ./launchlab.js. The refusal philosophy is
 * unchanged, only the verdict: every input the flow cannot derive is still a
 * NAMED error (unknown config values, unreadable platform, unproven
 * simulation), and NOTHING is guessed to fill a gap.
 *
 * The adapter stays dependency-light: it delegates to ./launchlab.js, which
 * dynamic-imports @solana/web3.js only inside the async builders.
 */

import {
  LAUNCHLAB_PROGRAM_ID,
  LAUNCHLAB_SOL_CONFIG_MAINNET,
  RAYDIUM_PLATFORM_ID,
  buildLaunchlabPlan
} from './launchlab.js';

export const RAYDIUM_ADAPTER_ID = 'raydium-launchlab';

/**
 * Pinned addresses. The program id is the docs' canonical table value,
 * cross-checked against the published IDL's own `address` field; the config
 * is Raydium's API-published SOL curve; the platform is Raydium's default.
 * All three are RE-DERIVED and RE-READ live at runtime — pins are the
 * expectation, the chain is the authority.
 */
export const LAUNCHLAB_PINNED = Object.freeze({
  programId: LAUNCHLAB_PROGRAM_ID,
  solConfig: LAUNCHLAB_SOL_CONFIG_MAINNET,
  platformId: RAYDIUM_PLATFORM_ID
});

/** Parts of the Raydium flow and their honest state. */
export const RAYDIUM_PARTS = Object.freeze([
  {
    id: 'program-id',
    status: 'READY',
    detail: 'LaunchLab program id pinned from the docs’ canonical table and the published IDL (both agree).'
  },
  {
    id: 'idl',
    status: 'READY',
    detail: 'Instruction discriminators + account lists pinned from the official SDK source (the docs’ canonical interface), cross-checked against the published IDL; the config-PDA derivation reproduces Raydium’s API-published config address.'
  },
  {
    id: 'curve-config',
    status: 'READY',
    detail: 'The SOL bonding-curve config is derived (never chosen) and its values are read live and range-checked before anything is signed.'
  },
  {
    id: 'pool-bytes',
    status: 'READY',
    detail: 'initialize_v2 + buy_exact_in bytes are built from the pinned layouts and decoded by hand in the probe; every transaction is simulated on the user’s cluster before any wallet prompt.'
  }
]);

export function raydiumAdapterStatus() {
  const pending = RAYDIUM_PARTS.filter((p) => p.status !== 'READY').map((p) => p.id);
  return {
    id: RAYDIUM_ADAPTER_ID,
    programId: LAUNCHLAB_PROGRAM_ID,
    status: pending.length ? 'NOT_READY' : 'READY',
    pending,
    parts: RAYDIUM_PARTS.map((p) => ({ ...p })),
    statement: pending.length
      ? `Pool creation on Raydium is not buildable yet (${pending.join(', ')}). The adapter refuses to emit bytes it cannot derive from a pinned, reviewed IDL.`
      : 'Raydium LaunchLab pool creation is ready: pinned instruction layouts, live config reads, and pre-signature simulation.'
  };
}

/**
 * The pool-creation plan. Now BUILDS (via ./launchlab.js) — and still refuses
 * with NAMED errors whenever an input is missing, unreadable, or outside the
 * live config's bounds. See buildLaunchlabPlan for the full contract.
 */
export async function buildPoolPlan(intent) {
  return buildLaunchlabPlan(intent);
}

/**
 * The verification half: given a decoded pool account, the pool is yours
 * only if it references your mint. (The full back-check with all seven
 * fields is verifyPoolState in ./launchlab.js; this stays as the simple,
 * IDL-independent statement of the rule.)
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
