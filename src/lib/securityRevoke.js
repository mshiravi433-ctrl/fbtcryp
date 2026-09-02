/**
 * SECURITY REVOKE — the only state-changing action the Security Center offers.
 *
 * ─── WHY THIS IS NOT AN API CALL ────────────────────────────────────────────
 * An allowance lives on the token contract. Only the owner's key can change
 * it. So the revoke is an ordinary `approve(spender, 0)` the user signs in
 * their own connected wallet — the exact plumbing the swap flow already uses
 * for approvals (see lib/swap.js `approveToken`), just pointed at zero. The
 * backend never sees a private key, never pre-signs, and has no endpoint that
 * could cancel anything on the user's behalf.
 *
 * ─── AVAILABILITY IS REAL, NOT ASPIRATIONAL ─────────────────────────────────
 * canRevoke() returns false unless a signer is actually attached AND the
 * wallet is on the same chain as the approval. The UI must only render the
 * Revoke button when this says true — the product rule is that a button
 * without a real transaction behind it does not get built.
 */

const loadEthers = () => import('ethers');

const ERC20_MIN_ABI = [
  'function approve(address spender, uint256 value) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)'
];

const isAddr = (a) => /^0x[a-fA-F0-9]{40}$/.test(String(a || ''));

/** True when this approval can be revoked right now, and why not otherwise. */
export function revokeEligibility({ wallet, approvalChainId }) {
  if (!wallet?.isConnected) return { ok: false, code: 'NO_WALLET' };
  if (wallet.locked) return { ok: false, code: 'LOCKED' };
  if (Number(wallet.chainId) !== Number(approvalChainId)) return { ok: false, code: 'WRONG_NETWORK', chainId: Number(approvalChainId) };
  const signer = typeof wallet.getSigner === 'function' ? wallet.getSigner() : null;
  if (!signer) return { ok: false, code: 'NO_SIGNER' };
  return { ok: true };
}

/**
 * Build and submit the revoke. `onStatus` receives 'confirm' (wallet prompt
 * shown) then 'submitted' with the hash, so the UI can say what stage it is
 * at instead of looking frozen while the user reads the signature prompt.
 * Throws with `.code` on failure — the caller maps it to localized copy.
 */
export async function revokeApproval({ wallet, token, spender, onStatus = () => {} }) {
  const eligibility = revokeEligibility({ wallet, approvalChainId: wallet.chainId });
  if (!eligibility.ok) {
    const err = new Error(eligibility.code);
    err.code = eligibility.code;
    throw err;
  }
  if (!isAddr(token) || !isAddr(spender)) {
    const err = new Error('BAD_ADDRESS');
    err.code = 'BAD_ADDRESS';
    throw err;
  }
  const { Contract } = await loadEthers();
  const signer = wallet.getSigner();
  const owner = await signer.getAddress();
  const c = new Contract(token, ERC20_MIN_ABI, signer);
  // Read first: if it is already zero, we say so instead of wasting a fee.
  try {
    const current = await c.allowance(owner, spender);
    if (current === 0n) return { status: 'already-zero' };
  } catch {
    /* allowance() not readable (non-standard token): proceed — approve(0) is
       still the correct and only way to clear a real allowance. */
  }
  onStatus('confirm');
  let tx;
  try {
    tx = await c.approve(spender, 0n);
  } catch (err) {
    const code = err?.code === 'ACTION_REJECTED' || /reject|denied|user rejected/i.test(String(err?.message)) ? 'REJECTED' : 'SIGN_FAILED';
    const wrapped = new Error(code);
    wrapped.code = code;
    throw wrapped;
  }
  onStatus('submitted', tx.hash);
  return { status: 'submitted', hash: tx.hash, wait: () => tx.wait() };
}
