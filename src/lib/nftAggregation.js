/**
 * All-network NFT reads are only useful if one provider failure cannot wipe
 * out the networks that answered. The viewer fetches every indexed chain in
 * parallel, tags each item with the chain it came from and hands the settled
 * results here.
 *
 * No chain ID or item is invented: the caller supplies both the requested IDs
 * and Promise.allSettled's results in exactly the same order.
 */
export function aggregateNftResults(ids = [], results = []) {
  const items = [];
  const failed = [];
  ids.forEach((id, i) => {
    const result = results[i];
    if (result?.status === 'fulfilled' && Array.isArray(result.value)) {
      for (const nft of result.value) items.push({ ...nft, _chainId: id });
    } else {
      failed.push(id);
    }
  });
  return { items, failed, allFailed: ids.length > 0 && failed.length === ids.length };
}
