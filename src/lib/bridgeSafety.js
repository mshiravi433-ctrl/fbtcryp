/** Structural checks, NOT a reputation service. Never suppress wallet warnings.
 * The ERC-20 is the target of approve(), not the bridge's deposit recipient.
 * A quote that asks us to send directly to that token must fail before approval.
 */
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO = /^0x0{40}$/i;
const same = (a, b) => Boolean(a && b) && String(a).toLowerCase() === String(b).toLowerCase();
const valid = (a) => ADDRESS.test(a || '') && !ZERO.test(a);
const DIRECT_TOKEN_METHODS = new Set(['0xa9059cbb', '0x23b872dd', '0x095ea7b3']);

export function validateBridgeRequest({ token, spender, transaction, chainId, sender, recipient, native = false }) {
  const tx = transaction;
  if (!tx || !valid(tx.to) || !valid(sender) || !valid(recipient)) return false;
  if (tx.chainId != null && Number(tx.chainId) !== Number(chainId)) return false;
  if (tx.from != null && !same(tx.from, sender)) return false;
  if (same(tx.to, sender) || same(tx.to, recipient)) return false;
  if (!/^0x(?:[a-fA-F0-9]{2}){4,}$/.test(tx.data || '')) return false;
  if (DIRECT_TOKEN_METHODS.has(tx.data.slice(0, 10).toLowerCase())) return false;
  try { if (BigInt(tx.value ?? 0) < 0n) return false; } catch { return false; }
  if (!native && (!valid(token) || !valid(spender) || same(token, tx.to)
      || same(token, spender) || same(spender, sender) || same(spender, recipient))) return false;
  return true;
}

/** Re-check the actual signer after any review / chain switch, before signing. */
export async function assertBridgeSigner(signer, chainId, sender) {
  const network = await signer.provider.getNetwork();
  if (Number(network.chainId) !== Number(chainId)) throw new Error('WRONG_NETWORK');
  if (!same(await signer.getAddress(), sender)) throw new Error('BRIDGE_ACCOUNT_CHANGED');
}

export async function assertBridgeContracts(provider, addresses) {
  for (const address of new Set(addresses.filter(Boolean).map((a) => a.toLowerCase()))) {
    const code = await provider.getCode(address);
    if (!code || /^0x0*$/i.test(code)) throw new Error('UNSAFE_BRIDGE_REQUEST');
  }
}
