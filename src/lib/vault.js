/**
 * OUR OWN LENDING VAULT — the one revenue source that recurs.
 * ---------------------------------------------------------------------------
 * Asked for directly:
 *
 *   «خزانه را نمیشه درست کرد که خودکار باشه یا چیزی شبیه ان بعنوان یک اپشن
 *    بعدا که اعتماد سازی بیشتر شد کاربر بیشتر میگرد اما از الان باشد بهتر است»
 *
 * — build it now as an option, so it is ready when trust and users arrive.
 * That is the correct instinct and this module is the answer to it.
 *
 * ─── WHY THIS IS NOT A REFERRAL LINK ────────────────────────────────────────
 * Every lending platform with a referral programme excludes us. CoinRabbit's
 * terms name the "Islamic Republic of Iran" verbatim; Nexo and YouHodler
 * require KYC that refuses the same passport; Aave and Compound have no
 * referral programme at all, for anyone.
 *
 * Morpho inverts the problem. Instead of being paid to send users to someone
 * else's lending product, we OWN the product. From Morpho's own terms of use:
 *
 *   "A Performance Fee may be set in the sole discretion of a Vault's Owner.
 *    The Performance Fee is calculated as a percentage (up to a limit of 50%)
 *    of the generated yield. Performance Fees can be claimed by a fee
 *    recipient address determined by the Vault's Owner."
 *
 * Confirmed in the contract source (morpho-org/metamorpho): "The vault owner
 * can set a performance fee, cutting up to 50% of the generated interest."
 *
 * No signup, no gatekeeper, no country. Blockworks: "Becoming a curator is
 * permissionless ... There is no gatekeeper."
 *
 * ─── AND WHY IT RECURS, WHICH IS THE POINT ──────────────────────────────────
 * A swap fee is earned once per trade. A performance fee is earned every year
 * the deposit stays. At the market-standard 10% on a vault holding $100k at
 * 6% APY that is $600/year, and it does not require the user to do anything
 * again. Nothing else in this app has that shape.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ─── EVERYTHING HERE IS OFF UNTIL A REAL VAULT EXISTS ───────────────────────
 * ═══════════════════════════════════════════════════════════════════════════
 * `vaultConfig()` returns null unless BOTH the address and the chain are set
 * and the address is well-formed. The UI renders nothing at all in that state.
 *
 * This is the GMX-referral pattern that already worked in this repo, and it is
 * deliberate: shipping the surface before the vault exists would be the
 * "wired to nothing" failure this project has now shipped three times (the
 * bridge, the gasless swap, the fiat integration). A card advertising a vault
 * that does not exist is worse than no card, because the person who taps it
 * learns the app lies.
 *
 * So the code ships today, dormant, and lights up the moment the owner
 * deploys. See docs/MORPHO-VAULT-FA.md for exactly what that costs.
 */

const env = (k) => (typeof import.meta !== 'undefined' ? import.meta.env?.[k] : undefined) || '';

/**
 * The deployed vault address.
 *
 * `VITE_` is correct and is NOT a leak. A vault address is public by
 * construction — it is on-chain, anyone can read it, and users must be able to
 * verify it independently. The rule this repo enforces is about SECRETS; this
 * is the opposite of one, exactly like the GMX referral code.
 */
const VAULT_ADDRESS = env('VITE_FBT_VAULT_ADDRESS');

/** Chain the vault is deployed on. A string in env, a number here. */
const VAULT_CHAIN = Number(env('VITE_FBT_VAULT_CHAIN'));

/**
 * The performance fee we charge, in percent, for DISPLAY only.
 *
 * ─── THIS NUMBER DOES NOT SET ANYTHING ──────────────────────────────────────
 * The real fee lives on-chain, set by the vault owner via `setFee`. This is a
 * label so the user can see it before depositing, and it exists as a separate
 * env var precisely so it can be corrected without a redeploy if the on-chain
 * value is ever changed.
 *
 * That is also its danger, and the reason for the check below: a label that
 * disagrees with the contract is worse than no label, because the user
 * discovers the difference after committing. `feeMatchesChain` is exported so
 * a future version can verify it against the contract and refuse to render
 * when they diverge.
 *
 * Clamped to 0–20 rather than the protocol's 50% maximum. Nobody credible
 * charges near 50 — Steakhouse runs under 3%, Gauntlet 10%, Re7 15% — and a
 * misplaced digit that quietly took half of somebody's yield would end the
 * product's reputation in a day.
 */
const FEE_DEFAULT = 10;
const FEE_MAX = 20;

export function vaultFeePercent() {
  const raw = env('VITE_FBT_VAULT_FEE');
  if (!raw) return FEE_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > FEE_MAX) return FEE_DEFAULT;
  return n;
}

/** Chains where Morpho Blue is deployed AND we would plausibly run a vault. */
export const VAULT_CHAINS = {
  8453: { name: 'Base', explorer: 'https://basescan.org' },
  1: { name: 'Ethereum', explorer: 'https://etherscan.io' },
  56: { name: 'BNB Chain', explorer: 'https://bscscan.com' },
  42161: { name: 'Arbitrum', explorer: 'https://arbiscan.io' }
};

/** A 20-byte hex address, checked shape-only. */
export function isValidVaultAddress(a) {
  return typeof a === 'string' && /^0x[a-fA-F0-9]{40}$/.test(a);
}

/**
 * The live vault, or null.
 *
 * Returns null — never a partially-filled object — when anything is missing or
 * malformed. A half-configured vault is the dangerous state: an address on the
 * wrong chain sends a deposit somewhere the user cannot withdraw from, and
 * "somewhere the user cannot withdraw from" is the only truly unrecoverable
 * outcome this app can produce.
 */
export function vaultConfig() {
  if (!isValidVaultAddress(VAULT_ADDRESS)) return null;
  const chain = VAULT_CHAINS[VAULT_CHAIN];
  if (!chain) return null;

  return {
    address: VAULT_ADDRESS,
    chainId: VAULT_CHAIN,
    chainName: chain.name,
    feePercent: vaultFeePercent(),
    /*
     * Morpho's own interface, not one of ours.
     *
     * ─── WHY WE DO NOT BUILD THE DEPOSIT FORM (YET) ───────────────────────
     * A deposit is an ERC-4626 `deposit()` — perfectly buildable. But the
     * user is handing over real money, and on Morpho's own app they get the
     * live APY, the current allocation across markets, the audited
     * interface, and a withdraw button that works whatever happens to us.
     *
     * Our own form would add a second place for a bug to live in the path
     * between a user and their savings, in exchange for a slightly shorter
     * journey. That trade is wrong at this stage. It becomes right when the
     * vault has a track record, and this comment is here so the next person
     * knows what changes the answer.
     */
    depositUrl: `https://app.morpho.org/vault?vault=${VAULT_ADDRESS}&network=${morphoNetworkSlug(VAULT_CHAIN)}`,
    explorerUrl: `${chain.explorer}/address/${VAULT_ADDRESS}`
  };
}

/**
 * Morpho's URL slug for a chain id.
 *
 * Pinned as literals rather than derived from a name, because these are
 * THEIR identifiers and a lower-cased chain name only coincidentally matches.
 * The same class of mistake made the LI.FI integrator id (`fbt-swap` vs
 * `fbtswap`) earn nothing until it was caught.
 */
function morphoNetworkSlug(chainId) {
  if (chainId === 8453) return 'base';
  if (chainId === 1) return 'mainnet';
  if (chainId === 56) return 'bnb';
  if (chainId === 42161) return 'arbitrum';
  return 'base';
}

/**
 * Is the vault live? The single question the UI should ask.
 *
 * A function rather than a constant so a test can change the environment and
 * observe the result, and so the answer is computed at call time rather than
 * frozen at module load.
 */
export const vaultIsLive = () => vaultConfig() !== null;

/**
 * Placeholder for verifying the displayed fee against the contract.
 *
 * Deliberately unimplemented and deliberately present. Reading `fee()` from
 * the vault needs an RPC call and a contract ABI, which is a server route
 * rather than a client concern — but the shape of the check belongs next to
 * the number it guards, so that whoever adds the RPC finds the requirement
 * already written down instead of discovering it after a user has been shown
 * a fee we do not charge.
 */
export function feeMatchesChain() {
  return null; // unknown until an on-chain read exists
}
