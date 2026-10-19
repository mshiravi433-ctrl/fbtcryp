const ROOT = '/api/collective';

async function getJson(path, { signal } = {}) {
  let response;
  try {
    response = await fetch(`${ROOT}${path}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal
    });
  } catch (cause) {
    throw Object.assign(new Error('COLLECTIVE_API_UNAVAILABLE'), { code: 'COLLECTIVE_API_UNAVAILABLE', cause });
  }
  let body = null;
  try { body = await response.json(); } catch { /* use the stable HTTP code below */ }
  if (!response.ok) {
    const code = String(body?.error || `HTTP_${response.status}`);
    throw Object.assign(new Error(code), { code, status: response.status });
  }
  return body;
}

export const collectiveApi = Object.freeze({
  status: (options) => getJson('/status', options),
  vaults: (options) => getJson('/vaults', options),
  vault: (address, options) => getJson(`/vault/${encodeURIComponent(address)}`, options),
  position: (vaultAddress, walletAddress, options) => getJson(
    `/vault/${encodeURIComponent(vaultAddress)}/position/${encodeURIComponent(walletAddress)}`,
    options
  ),
  events: (vaultAddress, params = {}, options) => {
    const query = new URLSearchParams();
    if (params.fromBlock != null) query.set('fromBlock', String(params.fromBlock));
    if (params.toBlock != null) query.set('toBlock', String(params.toBlock));
    if (params.wallet) query.set('wallet', String(params.wallet));
    const suffix = query.size ? `?${query}` : '';
    return getJson(`/vault/${encodeURIComponent(vaultAddress)}/events${suffix}`, options);
  },
  proposals: (vaultAddress, options) => getJson(`/vault/${encodeURIComponent(vaultAddress)}/proposals`, options)
});
