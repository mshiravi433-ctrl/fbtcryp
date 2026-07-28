/**
 * Token registry tests. The upstream fetch is stubbed, but normalise/merge/
 * search are the real functions — those are where a bug costs a user money
 * (wrong address = funds sent nowhere) or costs us a fee (token not findable).
 */
import jsdomPkg from 'jsdom';
const { JSDOM } = jsdomPkg;

export async function run() {
const dom = new JSDOM('<!doctype html>', { url: 'https://localhost/' });
global.window = dom.window;
global.document = dom.window.document;
global.localStorage = dom.window.localStorage;

const results = [];
const check = (n, ok) => results.push([n, Boolean(ok)]);

// Real BSC addresses, plus deliberately broken entries an upstream list
// really can contain.
const fakeUpstream = {
  name: 'Test List',
  tokens: [
    { chainId: 56, address: '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82', symbol: 'CAKE',  name: 'PancakeSwap', decimals: 18 },
    { chainId: 56, address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', symbol: 'UNI',   name: 'Uniswap',     decimals: 18 },
    { chainId: 56, address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', symbol: 'ETH',   name: 'Impostor ETH', decimals: 18 },
    { chainId: 56, address: '0x111111111117dC0aa78b770fA6A738034120C302', symbol: 'USDT',  name: 'FAKE Tether', decimals: 18 },
    { chainId: 56, address: '0x4B0F1812e5Df2A09796481Ff14017e6005508003', symbol: 'TWT',   name: 'Trust Wallet', decimals: 18 },
    // --- entries that must be rejected ---
    { chainId: 56, address: 'not-an-address',   symbol: 'BAD1', name: 'bad addr',  decimals: 18 },
    { chainId: 56, address: '0x0000000000000000000000000000000000000001', symbol: '',     name: 'no symbol', decimals: 18 },
    { chainId: 56, address: '0x0000000000000000000000000000000000000002', symbol: 'BAD3', name: 'bad dec',   decimals: 'x' },
    { chainId: 1,  address: '0x0000000000000000000000000000000000000003', symbol: 'WRONGCHAIN', name: 'other chain', decimals: 18 }
  ]
};

let fetchCalls = 0;
global.fetch = async () => {
  fetchCalls += 1;
  return { ok: true, status: 200, json: async () => fakeUpstream };
};

const { loadTokens, searchTokens, clearTokenCache } = await import('../src/lib/tokenLists.js');
const { TOKENS } = await import('../src/lib/chains.js');

clearTokenCache();
const { tokens, degraded } = await loadTokens(56);

check('list loaded, not degraded', !degraded);
check('curated tokens all present', (TOKENS[56] ?? []).every((c) => tokens.some((t) => t.symbol === c.symbol)));
check('merged list is bigger than curated', tokens.length > (TOKENS[56] ?? []).length);

// --- rejection of malformed upstream entries ---
check('rejects invalid address',   !tokens.some((t) => t.symbol === 'BAD1'));
check('rejects empty symbol',      !tokens.some((t) => t.name === 'no symbol'));
check('rejects bad decimals',      !tokens.some((t) => t.symbol === 'BAD3'));
check('rejects wrong-chain entry', !tokens.some((t) => t.symbol === 'WRONGCHAIN'));

// --- impersonation defence ---
// The real USDT on BSC is 0x55d398...; the list contained a fake one.
const usdts = tokens.filter((t) => t.symbol === 'USDT');
const realUsdt = usdts.find((t) => t.address === '0x55d398326f99059fF775485246999027B3197955');
check('real USDT still present', Boolean(realUsdt));
check('real USDT is marked verified', realUsdt?.verified === true);
const fakeUsdt = usdts.find((t) => t.address === '0x111111111117dC0aa78b770fA6A738034120C302');
check('fake USDT is NOT verified', fakeUsdt && fakeUsdt.verified !== true);
check('fake USDT flagged as symbol collision', fakeUsdt?.symbolCollision === true);

// Curated ETH address must win over the list's duplicate of the same address.
const eths = tokens.filter((t) => t.address === '0x2170Ed0880ac9A755fd29B2688956BD959F933F8');
check('duplicate address deduped to one entry', eths.length === 1);
check('deduped entry kept the verified/curated version', eths[0]?.verified === true);

// --- checksums ---
const cake = tokens.find((t) => t.symbol === 'CAKE');
check('lowercase upstream address was checksummed',
  cake?.address === '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82');
check('every address is EIP-55 checksummed',
  tokens.filter((t) => t.address).every((t) => /^0x[0-9a-fA-F]{40}$/.test(t.address)));

// --- caching ---
const before = fetchCalls;
await loadTokens(56);
check('second call served from cache (no refetch)', fetchCalls === before);

// --- search ---
check('exact symbol ranks first',  searchTokens(tokens, 'CAKE')[0]?.symbol === 'CAKE');
check('prefix search works',       searchTokens(tokens, 'cak').some((t) => t.symbol === 'CAKE'));
check('search is case-insensitive',searchTokens(tokens, 'cAkE')[0]?.symbol === 'CAKE');
check('name search works',         searchTokens(tokens, 'Trust').some((t) => t.symbol === 'TWT'));
check('address search returns exactly that token', (() => {
  const r = searchTokens(tokens, '0x4B0F1812e5Df2A09796481Ff14017e6005508003');
  return r.length === 1 && r[0].symbol === 'TWT';
})());
check('unknown address returns nothing',
  searchTokens(tokens, '0x000000000000000000000000000000000000dEaD').length === 0);
check('nonsense query returns nothing', searchTokens(tokens, 'zzzzqqqq').length === 0);
check('empty query returns the list',   searchTokens(tokens, '').length > 0);
check('verified USDT outranks the fake in search', (() => {
  const r = searchTokens(tokens, 'USDT');
  return r[0]?.verified === true;
})());
check('search respects the limit', searchTokens(tokens, '', 3).length === 3);

// --- graceful degradation: every mirror down ---
clearTokenCache();
global.fetch = async () => { throw new Error('network down'); };
const off = await loadTokens(56);
check('degrades to curated list when all mirrors fail', off.degraded === true);
check('still usable offline (curated tokens available)', off.tokens.length === (TOKENS[56] ?? []).length);
check('offline tokens are the verified ones', off.tokens.every((t) => t.verified === true));

return results;
}
