/**
 * THE THREE PROGRAM IDS THE SPL PATH IS BUILT ON.
 * ---------------------------------------------------------------------------
 * Fixed by the Solana protocol. They are NOT configuration: a "wrong" token
 * program would sign a transfer of somebody else's asset, so they live in one
 * file, are asserted in the probe, and are never read from a setting.
 *
 * WHY THIS FILE EXISTS
 * `portfolio.js` carried two of these and the SPL transfer path now needs the
 * third (the Associated Token Account program) plus the system program. Two
 * copies of a program address is how a codebase ends up with a transfer that
 * looks right and spends a different asset on one of its two paths, so the
 * addresses live here once and everything imports them.
 */
export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';

/** Both token programs hold balances in the same account shape, so reads walk
    both — a Token-2022 mint funded on the old program alone reads as zero. */
export const TOKEN_PROGRAMS = Object.freeze([TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]);

/** Which program owns this mint, when the caller knows; the classic program is
    the safe default, and a Token-2022 mint always reports itself first. */
export function tokenProgramFor(programId) {
  return programId === TOKEN_2022_PROGRAM_ID ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
}
