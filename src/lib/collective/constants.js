/**
 * The server's verified activation/status payload is the source of truth for
 * Collective chain metadata. Keep this module free of baked-in chain IDs so a
 * testnet snapshot cannot silently become a mainnet wallet target.
 */
export function collectiveChainFromPayload(payload) {
  const chain = payload?.chain;
  const id = Number(chain?.id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return Object.freeze({
    id,
    name: String(chain?.name || ''),
    explorer: String(chain?.explorer || ''),
    testnet: chain?.testnet === true,
    supported: chain?.supported === true
  });
}
