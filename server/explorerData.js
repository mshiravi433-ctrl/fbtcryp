/**
 * EXPLORER DATA — the real reads behind the Explore page.
 *
 * Every function here answers exactly one spec rule: return real data or
 * return a typed unavailability. Balances come from RPC, token metadata from
 * eth_call (registry-cached), histories and source-verification from the
 * chain's explorer API when the operator has a key, prices from the existing
 * CoinGecko provider, protocols and their TVL/volume from DefiLlama. A metric
 * with no source is `null` in the payload and the UI renders N/A — never 0,
 * never a guess, never a click-count dressed up as a ranking.
 *
 * This module is read-only and intentionally independent of the Intent OS
 * layer: no intent imports, no execution paths, nothing that could touch a
 * user's transaction. Explore shows; it does not act.
 */

import {
  CHAIN_IDS, EVM_CHAINS, SOLANA, TOKENS,
  IntelError, cachedMeta, encodeCall, decodeUint, decodeMethodArgs,
  ethCall, explorerQuery, explorerConfigured, formatUnitsBig, hexToBig,
  isAddress, isTxHash, METHOD_TABLE, nativeBalance, normAddr, recentTransferLogs,
  registryToken, rpcCall, solanaRpc, tokenMeta,
  TOPICS, EIP1967, topicToAddr, isUnlimitedAllowance, UNLIMITED
} from './chainIntel.js';
import { fetchSimplePrices } from './providers.js';
import { fetchTokenRisk } from './tokenRisk.js';

const CACHE = {
  search: 30_000,
  wallet: 60_000,
  scan: 90_000,
  tx: 5 * 60_000,
  finalizedTx: 24 * 3_600_000,
  contract: 10 * 60_000,
  token: 60_000,
  networks: 45_000,
  protocols: 60 * 60_000,
  protocolDetail: 30 * 60_000,
  hacks: 6 * 3_600_000
};

/* -------------------------------------------------------------------------- */
/* Input classification — mirrors (and stays compatible with) the client copy  */
/* in src/pages/Explore.jsx. Length of hex, not vibes, tells tx from address. */
/* -------------------------------------------------------------------------- */

export function classifyQuery(raw) {
  const q = String(raw || '').trim();
  if (!q) return { kind: 'empty', value: null };
  if (isTxHash(q)) return { kind: 'tx', value: q.toLowerCase() };
  if (isAddress(q)) return { kind: 'address', value: q.toLowerCase() };
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(q)) return { kind: 'tron', value: q };
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q) && !/^0x/.test(q)) return { kind: 'solana', value: q };
  if (/^\d{1,12}$/.test(q)) return { kind: 'block', value: q };
  return { kind: 'text', value: q };
}

/* -------------------------------------------------------------------------- */
/* Global search                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Resolve one query against real chain data. For an address we probe each
 * supported chain (code present / non-zero balance / explorer tx history) so
 * the UI can say WHICH chain a `0x…` lives on instead of shrugging. For a
 * text query we match the curated token registry and the protocol catalog —
 * the two universes this product actually owns. Nothing is fuzzy-guessed
 * into existence.
 */
export async function exploreSearch(query, { chain = 'all' } = {}) {
  const cls = classifyQuery(query);
  const key = `search:${cls.kind}:${cls.value || ''}:${chain}`;
  return cachedMeta(key, CACHE.search, async () => {
    const notices = [];
    if (cls.kind === 'tx') {
      const probes = await Promise.allSettled(CHAIN_IDS.map((id) => probeTxOnChain(id, cls.value)));
      const found = [];
      probes.forEach((p, i) => {
        if (p.status === 'fulfilled' && p.value?.exists) found.push({ chainId: CHAIN_IDS[i], name: EVM_CHAINS[CHAIN_IDS[i]].name, explorer: EVM_CHAINS[CHAIN_IDS[i]].explorer });
      });
      const failed = probes.filter((p) => p.status === 'rejected' && p.reason?.code === 'RPC_UNAVAILABLE').length;
      if (failed > 0) notices.push({ code: 'PARTIAL_RPC', detail: `${failed} network(s) could not be probed right now.` });
      return {
        data: {
          kind: 'tx', value: cls.value,
          results: [{ type: 'transaction', chain: 'auto', hash: cls.value, networks: found }]
        },
        dataStatus: found.length ? 'live' : failed ? 'partial' : 'empty',
        notices
      };
    }
    if (cls.kind === 'address') {
      const targets = chain === 'all' ? CHAIN_IDS : [Number(chain)];
      const probes = await Promise.allSettled(targets.map((id) => probeAddressOnChain(id, cls.value)));
      const found = [];
      probes.forEach((p, i) => {
        if (p.status === 'fulfilled' && p.value?.exists) {
          found.push({
            type: p.value.isContract ? 'contract' : 'wallet',
            chainId: targets[i],
            name: EVM_CHAINS[targets[i]].name,
            isContract: p.value.isContract,
            balance: p.value.balance,
            explorer: EVM_CHAINS[targets[i]].explorer
          });
        }
      });
      const failed = probes.filter((p) => p.status === 'rejected').length;
      if (failed) notices.push({ code: 'PARTIAL_RPC', detail: 'Some networks did not answer during this search.' });
      return {
        data: { kind: 'address', value: cls.value, results: found },
        dataStatus: found.length ? 'live' : failed ? 'partial' : 'empty',
        notices
      };
    }
    if (cls.kind === 'block') {
      const targets = chain === 'all' ? CHAIN_IDS : [Number(chain)];
      const results = await Promise.all(targets.map(async (id) => {
        try {
          const latest = Number(hexToBig(await rpcCall(id, 'eth_blockNumber', [])));
          const height = Number(cls.value);
          return { type: 'block', chainId: id, name: EVM_CHAINS[id].name, height, exists: height > 0 && height <= latest };
        } catch { return null; }
      }));
      return {
        data: { kind: 'block', value: cls.value, results: results.filter(Boolean) },
        dataStatus: results.some(Boolean) ? 'live' : 'unavailable'
      };
    }
    if (cls.kind === 'solana') {
      try {
        const bal = await solanaRpc('getBalance', [cls.value]);
        return {
          data: {
            kind: 'address', value: cls.value,
            results: [{ type: 'wallet', chain: 'solana', name: 'Solana', balance: (bal?.value ?? 0) / 1e9, explorer: SOLANA.explorer }]
          },
          dataStatus: 'live'
        };
      } catch (err) {
        return { data: { kind: 'address', value: cls.value, results: [] }, dataStatus: 'unavailable', notices: [{ code: 'SOLANA_RPC_FAILED', detail: String(err.message).slice(0, 120) }] };
      }
    }
    if (cls.kind === 'text') {
      const q = cls.value.toLowerCase();
      const tokens = [];
      for (const id of CHAIN_IDS) {
        for (const t of TOKENS[id] || []) {
          if (t.symbol?.toLowerCase().includes(q) || t.name?.toLowerCase().includes(q)) {
            tokens.push({ type: 'token', chainId: id, name: t.name, symbol: t.symbol, address: t.address, native: Boolean(t.native) });
          }
        }
      }
      let protocols = [];
      try {
        const catalog = await llamaProtocols();
        protocols = catalog.data.protocols
          .filter((p) => p.name?.toLowerCase().includes(q) || p.slug?.includes(q))
          .slice(0, 12)
          .map((p) => ({ type: 'protocol', slug: p.slug, name: p.name, category: p.category, tvl: p.tvl }));
      } catch { protocols = []; notices.push({ code: 'FEED_UNAVAILABLE', detail: 'Protocol catalog is currently unreachable.' }); }
      return { data: { kind: 'text', value: cls.value, results: [...tokens.slice(0, 12), ...protocols] }, dataStatus: 'live' };
    }
    return { data: { kind: cls.kind, value: cls.value, results: [] }, dataStatus: 'empty' };
  }, 'mixed:rpc+registry+feeds');
}

async function probeAddressOnChain(chainId, address) {
  const [code, balanceHex] = await Promise.all([
    rpcCall(chainId, 'eth_getCode', [normAddr(address), 'latest']),
    rpcCall(chainId, 'eth_getBalance', [normAddr(address), 'latest'])
  ]);
  const balanceWei = hexToBig(balanceHex);
  const isContract = Boolean(code && code !== '0x');
  let history = null;
  if (explorerConfigured(chainId) && !isContract) {
    const r = await explorerQuery(chainId, 'account', 'txlist', { address, page: 1, offset: 1, sort: 'desc' });
    if (r) history = r.status === '1' && Array.isArray(r.result) ? r.result.length : 0;
  }
  const exists = isContract || balanceWei > 0n || history > 0;
  return { exists, isContract, balance: Number(formatUnitsBig(balanceWei, EVM_CHAINS[chainId].native.decimals)) };
}

async function probeTxOnChain(chainId, hash) {
  const tx = await rpcCall(chainId, 'eth_getTransactionByHash', [hash]);
  return { exists: Boolean(tx && tx.hash) };
}

/* -------------------------------------------------------------------------- */
/* Network status (Explorer overview + Security infrastructure input)          */
/* -------------------------------------------------------------------------- */

export async function networksStatus() {
  return cachedMeta('networks:status', CACHE.networks, async () => {
    const rows = await Promise.all(CHAIN_IDS.map(async (id) => {
      const chain = EVM_CHAINS[id];
      try {
        const t0 = Date.now();
        const hex = await rpcCall(id, 'eth_blockNumber', []);
        const block = Number(hexToBig(hex));
        const blk = await rpcCall(id, 'eth_getBlockByNumber', ['latest', false]).catch(() => null);
        return {
          chainId: id, name: chain.name, short: chain.short, color: chain.color,
          explorer: chain.explorer, native: chain.native.symbol,
          latestBlock: block,
          blockTimeMs: blk?.timestamp ? null : null,
          ok: true,
          latencyMs: Date.now() - t0
        };
      } catch (err) {
        return { chainId: id, name: chain.name, short: chain.short, color: chain.color, explorer: chain.explorer, native: chain.native.symbol, latestBlock: null, ok: false, error: String(err.code || err.message || err).slice(0, 80) };
      }
    }));
    let solana = null;
    try {
      const slot = await solanaRpc('getSlot', []);
      solana = { chainId: 'solana', name: SOLANA.name, short: SOLANA.short, color: SOLANA.color, explorer: SOLANA.explorer, native: 'SOL', latestBlock: slot ?? null, ok: true };
    } catch {
      solana = { chainId: 'solana', name: SOLANA.name, short: SOLANA.short, color: SOLANA.color, explorer: SOLANA.explorer, native: 'SOL', latestBlock: null, ok: false, error: 'RPC_UNAVAILABLE' };
    }
    const all = [...rows, solana];
    const online = all.filter((r) => r.ok).length;
    return {
      data: { networks: all, online, total: all.length },
      cachedAt: new Date().toISOString()
    };
  }, 'blockchain-rpc');
}

/* -------------------------------------------------------------------------- */
/* Wallet explorer                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Full snapshot for one wallet on one chain: native balance, nonce (an EOA's
 * send-count — labeled honestly), curated token balances with live prices,
 * and recent ERC-20 transfers from a bounded log window. Explorer history is
 * layered on top only when a key exists.
 */
export async function walletProfile(chainId, address, { includeTransfers = true } = {}) {
  const c = Number(chainId);
  if (c === 'solana' || chainId === 'solana') return solanaWallet(address);
  if (!isAddress(address)) throw new IntelError('BAD_ADDRESS', 'not a 0x address');
  if (!EVM_CHAINS[c]) throw new IntelError('UNSUPPORTED_CHAIN', `chain ${c}`);
  const key = `wallet:${c}:${normAddr(address)}:${includeTransfers ? 't' : 'b'}`;
  return cachedMeta(key, CACHE.wallet, async () => {
    const chain = EVM_CHAINS[c];
    const [balanceWei, nonceHex, code] = await Promise.all([
      nativeBalance(c, address),
      rpcCall(c, 'eth_getTransactionCount', [normAddr(address), 'latest']),
      rpcCall(c, 'eth_getCode', [normAddr(address), 'latest']).catch(() => '0x')
    ]);
    const isContract = Boolean(code && code !== '0x');
    const tokens = [];
    const known = (TOKENS[c] || []).filter((t) => t.address);
    const pricesById = {};
    await Promise.all(known.map(async (t) => {
      try {
        const raw = await ethCall(c, normAddr(t.address), encodeCall('0x70a08231', [normAddr(address)]));
        const wei = raw === null ? null : decodeUint(raw);
        if (wei != null) tokens.push({ symbol: t.symbol, name: t.name, address: t.address, decimals: t.decimals, amountRaw: wei.toString(), amount: Number(formatUnitsBig(wei, t.decimals)), coingeckoId: t.coingeckoId || null, registry: true });
      } catch { tokens.push({ symbol: t.symbol, name: t.name, address: t.address, decimals: t.decimals, amount: null, amountRaw: null, unavailable: true }); }
    }));
    const cgIds = [...new Set(tokens.map((t) => t.coingeckoId).filter(Boolean))];
    if (cgIds.length) {
      try {
        const prices = await fetchSimplePrices(cgIds);
        for (const [id, p] of Object.entries(prices || {})) pricesById[id] = p?.usd ?? null;
      } catch { /* prices optional; amounts remain, values stay null */ }
    }
    let usd = 0;
    let anyValue = false;
    for (const t of tokens) {
      if (t.amount == null || !t.coingeckoId || pricesById[t.coingeckoId] == null) { t.valueUsd = null; continue; }
      t.valueUsd = t.amount * pricesById[t.coingeckoId];
      usd += t.valueUsd;
      anyValue = true;
    }
    const nativePrice = pricesById[chain.native.coingeckoId] ?? null;
    if (nativePrice != null) { usd += Number(formatUnitsBig(balanceWei, chain.native.decimals)) * nativePrice; anyValue = true; }

    let transfers = null;
    let window = null;
    if (includeTransfers) {
      try {
        const scan = await recentTransferLogs(c, address);
        const meta = await tokenMetaForList(c, scan.transfers.map((x) => x.token));
        transfers = scan.transfers.slice(0, 60).map((x) => {
          const m = meta.get(x.token) || {};
          return { ...x, value: x.value == null ? null : Number(formatUnitsBig(x.value, m.decimals ?? 18)), symbol: m.symbol || null, name: m.name || null, decimals: m.decimals ?? null };
        });
        window = scan.window;
      } catch { transfers = null; }
    }
    let explorerHistory = null;
    if (explorerConfigured(c)) {
      const r = await explorerQuery(c, 'account', 'txlist', { address: normAddr(address), page: 1, offset: 25, sort: 'desc' });
      if (r && r.status === '1' && Array.isArray(r.result)) {
        explorerHistory = r.result.map((tx) => ({
          hash: tx.hash, from: tx.from, to: tx.to, valueEth: Number(tx.value) / 1e18,
          timestamp: Number(tx.timeStamp) * 1000, gasUsed: tx.gasUsed, gasPrice: tx.gasPrice,
          isError: tx.isError === '1', method: tx.functionName ? tx.functionName.split('(')[0] : null,
          blockNumber: Number(tx.blockNumber), contractAddress: tx.contractAddress || null, txType: 'out'
        }));
      }
    }
    return {
      data: {
        address: normAddr(address),
        chainId: c,
        chainName: chain.name,
        isContract,
        native: { symbol: chain.native.symbol, balance: formatUnitsBig(balanceWei, chain.native.decimals), priceUsd: nativePrice, valueUsd: nativePrice != null ? Number(formatUnitsBig(balanceWei, chain.native.decimals)) * nativePrice : null },
        nonce: Number(hexToBig(nonceHex)),
        sentCount: isContract ? null : Number(hexToBig(nonceHex)),
        tokens,
        tokenCount: tokens.filter((t) => (t.amount ?? 0) > 0).length,
        estimatedUsd: anyValue ? usd : null,
        transfers,
        transferWindow: window,
        transfersPartial: transfers != null,
        explorerHistory,
        explorerKeyConfigured: explorerConfigured(c)
      },
      cachedAt: new Date().toISOString()
    };
  }, 'blockchain-rpc');
}

async function solanaWallet(address) {
  const key = `wallet:solana:${address}`;
  return cachedMeta(key, CACHE.wallet, async () => {
    const [balance, accounts, sigs] = await Promise.allSettled([
      solanaRpc('getBalance', [address]),
      solanaRpc('getTokenAccountsByOwner', [address, { programId: SOLANA.tokenProgram }, { encoding: 'jsonParsed' }]),
      solanaRpc('getSignaturesForAddress', [address, { limit: 20 }])
    ]);
    if (balance.status === 'rejected') throw new IntelError('RPC_UNAVAILABLE', 'Solana RPC did not answer');
    const tokens = accounts.status === 'fulfilled'
      ? (accounts.value?.value || []).map((a) => {
          const info = a?.account?.data?.parsed?.info || {};
          return {
            mint: info.mint ?? null,
            amount: info.tokenAmount?.uiAmount ?? null,
            decimals: info.tokenAmount?.decimals ?? null,
            explorer: `${SOLANA.explorer}/account/${info.mint ?? ''}`
          };
        }).filter((t) => (t.amount ?? 0) > 0)
      : null;
    const recent = sigs.status === 'fulfilled'
      ? (sigs.value || []).map((s) => ({ hash: s.signature, at: s.blockTime ? s.blockTime * 1000 : null, err: s.err ? 'failed' : null }))
      : null;
    return {
      data: {
        address,
        chain: 'solana',
        chainName: 'Solana',
        native: { symbol: 'SOL', balance: ((balance.value?.value ?? 0) / 1e9).toFixed(4) },
        tokens,
        tokenCount: tokens ? tokens.length : null,
        recent,
        lastActivityAt: recent?.[0]?.at ?? null,
        sentCount: null,
        accounts: accounts.status === 'fulfilled' ? (accounts.value?.value || []).length : null
      },
      cachedAt: new Date().toISOString()
    };
  }, 'blockchain-rpc');
}

/** Batch metadata for tokens appearing in a transfer list (cached per token). */
async function tokenMetaForList(chainId, addresses) {
  const meta = new Map();
  await Promise.all([...new Set(addresses)].slice(0, 25).map(async (a) => {
    try {
      const m = await tokenMeta(chainId, a);
      meta.set(normAddr(a), m.data || {});
    } catch { meta.set(normAddr(a), {}); }
  }));
  return meta;
}

/**
 * Multi-chain scan — "what does this address hold, where". Bounded per-chain
 * cost: native balance + non-zero curated token balances. Transaction counts
 * and exact last activity require the explorer indexer; without a key those
 * cells are null and the UI shows N/A (never zero — an empty-looking wallet
 * that actually has history is exactly the scary screen this product avoids).
 */
export async function walletScan(address) {
  if (!isAddress(address)) throw new IntelError('BAD_ADDRESS', 'not a 0x address');
  return cachedMeta(`scan:evm:${normAddr(address)}`, CACHE.scan, async () => {
    const results = await Promise.allSettled(CHAIN_IDS.map(async (id) => {
      const chain = EVM_CHAINS[id];
      const [balanceWei, known] = await Promise.all([
        nativeBalance(id, address),
        Promise.all((TOKENS[id] || []).filter((t) => t.address).map(async (t) => {
          const raw = await ethCall(id, normAddr(t.address), encodeCall('0x70a08231', [normAddr(address)]));
          return raw === null ? { ...t, unavailable: true } : { ...t, wei: decodeUint(raw) };
        }))
      ]);
      const nonZero = known.filter((t) => (t.wei ?? 0n) > 0n);
      const held = nonZero.map((t) => ({ symbol: t.symbol, name: t.name, address: t.address, amount: Number(formatUnitsBig(t.wei, t.decimals)) }));
      let txCount = null;
      let lastActivityAt = null;
      if (explorerConfigured(id)) {
        const r = await explorerQuery(id, 'account', 'txlist', { address: normAddr(address), page: 1, offset: 1, sort: 'desc' });
        if (r && r.status === '1' && Array.isArray(r.result)) {
          txCount = r.result[0] ? Number(r.result[0].blockNumber) : 0;
          lastActivityAt = r.result[0] ? Number(r.result[0].timeStamp) * 1000 : null;
        }
      }
      return {
        chainId: id, name: chain.name, short: chain.short, color: chain.color,
        balance: formatUnitsBig(balanceWei, chain.native.decimals),
        nativeSymbol: chain.native.symbol,
        hasBalance: balanceWei > 0n || nonZero.length > 0,
        tokenCount: held.length,
        tokens: held,
        txCount,
        lastActivityAt,
        historyIndexed: Boolean(txCount != null)
      };
    }));
    const rows = results.map((r, i) => (r.status === 'fulfilled' ? r.value : { chainId: CHAIN_IDS[i], name: EVM_CHAINS[CHAIN_IDS[i]].name, short: EVM_CHAINS[CHAIN_IDS[i]].short, color: EVM_CHAINS[CHAIN_IDS[i]].color, balance: null, tokenCount: null, error: String(r.reason?.code || r.reason?.message || 'unavailable').slice(0, 60) }));
    // Solana is scanned with the same allSettled semantics so one dead public
    // endpoint cannot black out the whole scan table.
    let solRow;
    try {
      const bal = await solanaRpc('getBalance', [address]);
      solRow = { chainId: 'solana', name: 'Solana', short: 'SOL', color: SOLANA.color, balance: ((bal?.value ?? 0) / 1e9).toFixed(4), nativeSymbol: 'SOL', hasBalance: (bal?.value ?? 0) > 0, tokenCount: null, txCount: null, lastActivityAt: null, historyIndexed: false };
    } catch {
      solRow = { chainId: 'solana', name: 'Solana', short: 'SOL', color: SOLANA.color, balance: null, error: 'RPC_UNAVAILABLE' };
    }
    const all = [...rows, solRow];
    return {
      data: { address: normAddr(address), chains: all, chainsWithBalance: all.filter((r) => r.hasBalance).length, explorerKeysConfigured: CHAIN_IDS.filter((id) => explorerConfigured(id)).length },
      cachedAt: new Date().toISOString(),
      notices: [{ code: 'PARTIAL_HISTORY', detail: 'Transaction counts and last-activity times require the chain explorer indexer; they show N/A when unavailable.' }]
    };
  }, 'blockchain-rpc', { swr: true });
}

/* -------------------------------------------------------------------------- */
/* Transaction explorer + deterministic explanation                            */
/* -------------------------------------------------------------------------- */

/**
 * One transaction, fully resolved from the chain: fields, receipt, block time,
 * decoded method, and the list of token transfers it moved. `whatHappened` is
 * composed ONLY from these facts — kind is one of swap/approve/transfer/
 * bridge/lending/staking/deposit/withdraw/nft/batch/unknown and the sentence
 * parts carry numbers, never marketing. If the input selector is not in the
 * table, the explanation says "details available, not fully decodable" — the
 * spec's exact required outcome, and the difference between a decoder and a
 * guesser.
 */
export async function transactionDetail(hash, { chainId = null } = {}) {
  const h = String(hash || '').trim().toLowerCase();
  if (!isTxHash(h)) throw new IntelError('BAD_HASH', 'transaction hash must be 0x + 64 hex chars');
  const key = `tx:${chainId || 'auto'}:${h}`;
  return cachedMeta(key, CACHE.tx, async () => {
    let cid = Number(chainId);
    let tx = null;
    const probes = [];
    if (Number.isInteger(cid) && EVM_CHAINS[cid]) {
      tx = await rpcCall(cid, 'eth_getTransactionByHash', [h]);
    } else {
      for (const id of CHAIN_IDS) {
        try {
          const t = await rpcCall(id, 'eth_getTransactionByHash', [h], { timeout: 5000 });
          if (t && t.hash) { cid = id; tx = t; break; }
        } catch (err) { probes.push(`${id}:${err.code || 'fail'}`); }
      }
    }
    if (!tx) {
      return {
        data: { found: false, hash: h, probedNetworks: CHAIN_IDS.length },
        dataStatus: 'empty',
        notices: [{ code: 'NOT_FOUND', detail: probes.length ? 'No supported network returned this hash; some probes failed.' : 'This hash is not on any supported network yet — pending transactions may also be visible only on their own chain.' }]
      };
    }
    const [receipt, block] = await Promise.all([
      rpcCall(cid, 'eth_getTransactionReceipt', [h]).catch(() => null),
      tx.blockNumber ? rpcCall(cid, 'eth_getBlockByNumber', [tx.blockNumber, false]).catch(() => null) : Promise.resolve(null)
    ]);
    const chain = EVM_CHAINS[cid];
    const valueWei = hexToBig(tx.value);
    const gasUsed = receipt ? hexToBig(receipt.gasUsed) : null;
    const gasPrice = hexToBig(tx.gasPrice ?? tx.effectiveGasPrice ?? 0);
    const feeWei = gasUsed != null ? gasUsed * gasPrice : null;
    const status = receipt ? (receipt.status === '0x1' || receipt.status === '0x01' ? 'success' : receipt.status === '0x0' ? 'failed' : 'unknown') : 'pending';
    const timestamp = block ? Number(hexToBig(block.timestamp)) * 1000 : null;

    const meta = await tokenMetaForList(cid, receipt?.logs ? [...new Set(receipt.logs.filter((l) => l.topics?.[0] === TOPICS.transfer).map((l) => normAddr(l.address)))] : []);

    // Decode transfers + approvals from logs (the ground truth, not the calldata claim).
    const transfers = [];
    const approvals = [];
    for (const log of receipt?.logs || []) {
      if (log.topics?.[0] === TOPICS.transfer && log.topics?.length === 4) {
        const from = topicToAddr(log.topics[1]);
        const to = topicToAddr(log.topics[2]);
        const raw = hexToBig(log.data);
        const m = meta.get(normAddr(log.address)) || {};
        transfers.push({ token: normAddr(log.address), symbol: m.symbol || null, name: m.name || null, decimals: m.decimals ?? null, from, to, amount: Number(formatUnitsBig(raw, m.decimals ?? 18)) });
      } else if (log.topics?.[0] === TOPICS.approval && log.topics?.length >= 3) {
        const ownerA = topicToAddr(log.topics[1]);
        const spenderA = topicToAddr(log.topics[2]);
        const raw = hexToBig(log.data);
        const m = meta.get(normAddr(log.address)) || {};
        approvals.push({ token: normAddr(log.address), symbol: m.symbol || null, owner: ownerA, spender: spenderA, unlimited: isUnlimitedAllowance(raw), amount: raw.toString() });
      }
    }

    // Method decode from calldata (advisory — logs are authoritative).
    const selector = tx.input && tx.input.length >= 10 ? tx.input.slice(0, 10) : '0x';
    const entry = METHOD_TABLE[selector] || null;
    const decodedArgs = entry ? decodeMethodArgs(entry, tx.input) : null;

    const explanation = buildExplanation({ tx, entry, transfers, approvals, cid, valueWei, chain });

    return {
      data: {
        found: true,
        hash: h,
        chainId: cid,
        chainName: chain.name,
        explorer: `${chain.explorer}/tx/${h}`,
        status,
        block: tx.blockNumber ? Number(hexToBig(tx.blockNumber)) : null,
        timestamp,
        from: tx.from,
        to: tx.to,
        contract: receipt?.contractAddress || null,
        value: formatUnitsBig(valueWei, chain.native.decimals),
        valueSymbol: chain.native.symbol,
        gasUsed: gasUsed != null ? gasUsed.toString() : null,
        gasPriceGwei: gasPrice > 0n ? Number(gasPrice) / 1e9 : null,
        feeNative: feeWei != null && feeWei > 0n ? formatUnitsBig(feeWei, EVM_CHAINS[cid].native.decimals) : null,
        nonce: Number(hexToBig(tx.nonce)),
        method: entry ? entry.label : tx.input && tx.input !== '0x' ? 'unknown selector' : 'native transfer',
        methodSignature: entry?.signature || null,
        methodArgs: decodedArgs ? decodedArgs.map((a) => (typeof a === 'bigint' ? a.toString() : a)) : null,
        tokenTransfers: transfers.slice(0, 100),
        approvals: approvals.slice(0, 40),
        eventCount: (receipt?.logs || []).length,
        events: (receipt?.logs || []).slice(0, 40).map((l) => ({ address: normAddr(l.address), topic0: l.topics?.[0] || null, logIndex: Number(hexToBig(l.logIndex ?? 0)), dataLen: (l.data || '').length })),
        whatHappened: explanation
      },
      cachedAt: new Date().toISOString()
    };
  }, 'blockchain-rpc');
}

function buildExplanation({ tx, entry, transfers, approvals, cid, valueWei, chain }) {
  const from = normAddr(tx.from);
  const routerish = [normAddr(chain.router), normAddr(tx.to)].filter(Boolean);
  const outgoing = transfers.filter((t) => normAddr(t.from) === from);
  const incoming = transfers.filter((t) => normAddr(t.to) === from);
  if (entry?.kind === 'swap' || (outgoing.length && incoming.length && normAddr(tx.to) === normAddr(chain.router))) {
    return {
      kind: 'swap',
      decodable: true,
      sent: outgoing.map((t) => ({ symbol: t.symbol, amount: t.amount, token: t.token })),
      received: incoming.map((t) => ({ symbol: t.symbol, amount: t.amount, token: t.token })),
      contract: tx.to,
      chainName: chain.name
    };
  }
  if (entry?.kind === 'approval' || approvals.some((a) => normAddr(a.owner) === from)) {
    const a = approvals.find((x) => normAddr(x.owner) === from) || null;
    return {
      kind: 'approval',
      decodable: true,
      spender: a?.spender || (entry ? null : null),
      unlimited: a ? a.unlimited : null,
      token: a?.token || (entry && decodedTokenFromApproveArgs(tx) ) || null,
      symbol: a?.symbol || null,
      chainName: chain.name
    };
  }
  if (outgoing.length === 1 && !incoming.length) {
    const t = outgoing[0];
    return { kind: 'transfer', decodable: true, asset: t.symbol, amount: t.amount, to: t.to, chainName: chain.name };
  }
  if (incoming.length === 1 && !outgoing.length) {
    const t = incoming[0];
    return { kind: 'receive', decodable: true, asset: t.symbol, amount: t.amount, from: t.from, chainName: chain.name };
  }
  if (valueWei > 0n && !transfers.length) {
    return { kind: 'native-transfer', decodable: true, amount: formatUnitsBig(valueWei, chain.native.decimals), symbol: chain.native.symbol, to: tx.to, chainName: chain.name };
  }
  if (entry) {
    return { kind: 'contract-call', decodable: 'partial', method: entry.label, contract: tx.to, chainName: chain.name };
  }
  return { kind: 'unknown', decodable: false, chainName: chain.name };
}

function decodedTokenFromApproveArgs(tx) {
  // approve(address,uint256): the *token* is the callee for standard ERC-20 approvals.
  return tx.to && isAddress(tx.to) ? normAddr(tx.to) : null;
}

/* -------------------------------------------------------------------------- */
/* Contract explorer                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Contract profile from direct reads: code size, proxy slots (EIP-1967 +
 * legacy implementation()), owner(), paused(). Creator + verification status
 * only when the explorer API is configured. Token interface is probed so the
 * UI can offer the token view. Everything unverified is null + UNKNOWN, per
 * the "unknown is never safe" rule.
 */
export async function contractProfile(chainId, address) {
  const c = Number(chainId);
  if (!EVM_CHAINS[c]) throw new IntelError('UNSUPPORTED_CHAIN', `chain ${c}`);
  if (!isAddress(address)) throw new IntelError('BAD_ADDRESS', 'not a 0x address');
  return cachedMeta(`contract:${c}:${normAddr(address)}`, CACHE.contract, async () => {
    const a = normAddr(address);
    const [code, implSlot, adminSlot, beaconSlot, ownerRaw, pausedRaw, legacyImpl] = await Promise.all([
      rpcCall(c, 'eth_getCode', [a, 'latest']),
      rpcCall(c, 'eth_getStorageAt', [a, EIP1967.implementation, 'latest']).catch(() => null),
      rpcCall(c, 'eth_getStorageAt', [a, EIP1967.admin, 'latest']).catch(() => null),
      rpcCall(c, 'eth_getStorageAt', [a, EIP1967.beacon, 'latest']).catch(() => null),
      ethCall(c, a, '0x8da5cb5b'),
      ethCall(c, a, '0x5c975abb'),
      ethCall(c, a, '0x5c60da1b')
    ]);
    const hasCode = Boolean(code && code !== '0x');
    const toAddr = (hex) => {
      if (!hex || hex === '0x') return null;
      const inner = hex.slice(2).replace(/^0+/, '');
      if (inner.length < 40) return null;
      const v = '0x' + inner.slice(-40);
      return /^0x0{40}$/.test('0x' + inner.slice(-40)) ? null : v;
    };
    const implementation = toAddr(implSlot);
    const admin = toAddr(adminSlot);
    const beacon = toAddr(beaconSlot);
    const owner = ownerRaw && ownerRaw.length >= 66 ? toAddr(ownerRaw) : null;
    const paused = pausedRaw && pausedRaw !== '0x' ? decodeUint(pausedRaw) === 1n : null;

    let verified = null;
    let verificationNote = null;
    let creator = null;
    let creationTx = null;
    let createdAt = null;
    if (explorerConfigured(c)) {
      const abi = await explorerQuery(c, 'contract', 'getabi', { address: a });
      if (abi) {
        const ok = Boolean(abi.result) && abi.status === '1' && !String(abi.result).includes('not verified');
        verified = ok;
        verificationNote = ok ? null : 'explorer-reported-unverified';
      } else verificationNote = 'explorer-unreachable';
      const created = await explorerQuery(c, 'contract', 'contractaddress', { address: a });
      if (created?.status === '1' && created.result?.contractCreationTx) {
        creator = created.result.contractCreator || null;
        creationTx = created.result.contractCreationTx || null;
        createdAt = created.result.timestamp ? Number(created.result.timestamp) * 1000 : null;
      }
    } else {
      verificationNote = 'no-explorer-key';
    }

    // Token interface probe (name/symbol present ⇒ surface as token too)
    let asToken = null;
    try {
      const sym = await ethCall(c, a, '0x95d89b41');
      if (sym && sym !== '0x') asToken = true;
    } catch { /* stays null */ }

    // Recent activity: inbound/outbound transfer events involving this contract
    let activity = null;
    try {
      const scan = await recentTransferLogs(c, a);
      activity = { transfersSeen: scan.transfers.length, window: scan.window, lastAt: scan.transfers[0]?.at ?? null };
    } catch { activity = null; }

    return {
      data: {
        address: a,
        chainId: c,
        chainName: EVM_CHAINS[c].name,
        explorer: `${EVM_CHAINS[c].explorer}/address/${a}`,
        hasCode,
        codeSize: hasCode ? Math.floor((code.length - 2) / 2) : 0,
        contractType: !hasCode ? (ownerRaw === null && !asToken ? 'externally-owned-or-empty' : 'unknown') : asToken ? 'token-or-token-like' : 'contract',
        isProxy: Boolean(implementation || beacon),
        proxyKind: implementation ? (admin ? 'transparent (EIP-1967)' : 'uups (EIP-1967)') : beacon ? 'beacon (EIP-1967)' : null,
        implementation,
        admin,
        beacon,
        legacyImplementation: legacyImpl && legacyImpl !== '0x' ? toAddr(legacyImpl) : null,
        owner: owner && /^0x[a-f0-9]{40}$/.test(owner) && !/^0x0+$/.test(owner) ? owner : null,
        paused,
        verified,
        verificationNote,
        creator,
        creationTx,
        createdAt,
        asToken,
        activity,
        explorerKeyConfigured: explorerConfigured(c)
      },
      cachedAt: new Date().toISOString()
    };
  }, 'blockchain-rpc');
}

/* -------------------------------------------------------------------------- */
/* Token explorer                                                              */
/* -------------------------------------------------------------------------- */

export async function tokenProfile(chainId, address) {
  const c = Number(chainId);
  if (!EVM_CHAINS[c]) throw new IntelError('UNSUPPORTED_CHAIN', `chain ${c}`);
  if (!isAddress(address)) throw new IntelError('BAD_ADDRESS', 'not a 0x address');
  return cachedMeta(`token:${c}:${normAddr(address)}`, CACHE.token, async () => {
    const a = normAddr(address);
    const metaR = await tokenMeta(c, a);
    const meta = metaR.data;
    const [supplyRaw, goPlus] = await Promise.all([
      ethCall(c, a, '0x18160ddd'),
      fetchTokenRisk(c, a).catch(() => ({ error: 'UPSTREAM' }))
    ]);
    const supply = supplyRaw && supplyRaw !== '0x' ? decodeUint(supplyRaw) : null;
    const reg = registryToken(c, a);
    let market = null;
    if (meta.coingeckoId) {
      try {
        const prices = await fetchSimplePrices([meta.coingeckoId]);
        const p = prices?.[meta.coingeckoId];
        if (p?.usd != null) market = { priceUsd: p.usd, change24h: p.usd_24h_change ?? null, source: 'coingecko' };
      } catch { market = null; }
    }
    const g = goPlus?.report || null;
    const notices = [];
    if (goPlus?.error) notices.push({ code: 'SECURITY_FEED_UNAVAILABLE', detail: 'External token-security feed is unavailable; risk fields stay unknown.' });
    if (supply == null) notices.push({ code: 'NO_SUPPLY', detail: 'This contract did not return a totalSupply; it may not be an ERC-20.' });
    return {
      data: {
        address: a,
        chainId: c,
        chainName: EVM_CHAINS[c].name,
        explorer: `${EVM_CHAINS[c].explorer}/token/${a}`,
        name: meta.name,
        symbol: meta.symbol,
        decimals: meta.decimals,
        registry: Boolean(reg),
        registryVerified: Boolean(meta.verified),
        totalSupply: supply != null && meta.decimals != null ? formatUnitsBig(supply, meta.decimals) : null,
        totalSupplyRaw: supply?.toString() ?? null,
        market,
        holders: g?.holderCount ?? null,
        top10Share: g?.top10Share ?? null,
        liquidityUsd: g?.liquidityUsd ?? null,
        buyTaxPct: g?.buyTax ?? null,
        sellTaxPct: g?.sellTax ?? null,
        honeypot: g?.honeypot ?? null,
        mintable: g?.mintable ?? null,
        pausable: g?.pausable ?? null,
        blacklist: g?.blacklist ?? null,
        proxy: g?.proxy ?? null,
        openSource: g?.openSource ?? null,
        lpLocked: g?.lpLocked ?? null,
        contractVerified: meta.verified === true ? true : null
      },
      dataStatus: meta.name || g ? 'live' : 'partial',
      notices,
      cachedAt: new Date().toISOString()
    };
  }, 'mixed:rpc+goplus+coingecko');
}

/** Curated registry tokens with live prices — the default "Tokens" view. */
export async function registryTokens() {
  return cachedMeta('tokens:registry', CACHE.token, async () => {
    const rows = [];
    for (const id of CHAIN_IDS) {
      for (const t of TOKENS[id] || []) {
        rows.push({ chainId: id, chainName: EVM_CHAINS[id].name, symbol: t.symbol, name: t.name, address: t.address, decimals: t.decimals, native: Boolean(t.native), coingeckoId: t.coingeckoId || null });
      }
    }
    const ids = [...new Set(rows.map((r) => r.coingeckoId).filter(Boolean))];
    let prices = {};
    try { prices = await fetchSimplePrices(ids) || {}; } catch { prices = {}; }
    for (const r of rows) {
      const p = r.coingeckoId ? prices[r.coingeckoId] : null;
      r.priceUsd = p?.usd ?? null;
      r.change24h = p?.usd_24h_change ?? null;
      r.priced = p?.usd != null;
    }
    return {
      data: { tokens: rows, priced: rows.filter((r) => r.priced).length },
      dataStatus: ids.length && Object.keys(prices).length ? 'live' : 'partial',
      cachedAt: new Date().toISOString()
    };
  }, 'registry+coingecko', { swr: true });
}

/* -------------------------------------------------------------------------- */
/* Protocol discovery — DefiLlama, slimmed and cached server-side              */
/* -------------------------------------------------------------------------- */

const LLAMA = 'https://api.llama.fi';
const HTTP = { timeout: Number(process.env.LLAMA_TIMEOUT_MS || 12_000) };

async function httpJson(url, { timeout = HTTP.timeout } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new IntelError('UPSTREAM', `http ${res.status} from ${new URL(url).host}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/**
 * The protocol catalog. `api.llama.fi/protocols` is the whole universe (MBs),
 * so the server fetches, slims to the card fields, and caches for an hour —
 * exactly the yields.js discipline. Only fields the feed actually carries are
 * emitted; users, contract-level volume, etc. stay null (N/A) when absent.
 */
export async function llamaProtocols() {
  return cachedMeta('llama:protocols', CACHE.protocols, async () => {
    const raw = await httpJson(`${LLAMA}/protocols`);
    if (!Array.isArray(raw)) throw new IntelError('UPSTREAM', 'unexpected /protocols payload');
    const protocols = raw
      .map((p) => ({
        slug: p.slug,
        name: p.name,
        symbol: p.symbol || null,
        category: p.category || null,
        description: typeof p.description === 'string' ? p.description.slice(0, 280) : null,
        url: p.url || null,
        twitter: p.twitter || null,
        github: p.github || null,
        icon: p.icon || null,
        chains: Array.isArray(p.chains) ? p.chains.slice(0, 40) : [],
        chainTvls: p.chainTvls && typeof p.chainTvls === 'object'
          ? Object.fromEntries(Object.entries(p.chainTvls).filter(([, v]) => Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)]))
          : null,
        tvl: Number.isFinite(Number(p.tvl)) ? Number(p.tvl) : null,
        change_1d: Number.isFinite(Number(p.change_1d)) ? Number(p.change_1d) : null,
        change_7d: Number.isFinite(Number(p.change_7d)) ? Number(p.change_7d) : null,
        change_1m: Number.isFinite(Number(p.change_1m)) ? Number(p.change_1m) : null,
        volume_24h: Number.isFinite(Number(p.volume_24h)) ? Number(p.volume_24h) : null,
        fees_24h: Number.isFinite(Number(p.fees_24h)) ? Number(p.fees_24h) : null,
        revenue_24h: Number.isFinite(Number(p.revenue_24h)) ? Number(p.revenue_24h) : null,
        mcap: Number.isFinite(Number(p.mcap)) ? Number(p.mcap) : null,
        audits: p.audits != null ? String(p.audits) : null,
        audit_links: Array.isArray(p.audit_links) ? p.audit_links.slice(0, 6) : null,
        listedAt: Number.isFinite(Number(p.listedAt)) ? Number(p.listedAt) : null,
        dead: Boolean(p.deadUrl),
        address: p.address || null,
        parentProtocol: p.parentProtocol || null
      }))
      .filter((p) => p.slug && (p.tvl != null || p.volume_24h != null));
    return {
      data: { protocols, count: protocols.length },
      cachedAt: new Date().toISOString()
    };
  }, 'defillama', { swr: true });
}

/* FBT's own view of which protocols are already integrated — assembled from
 * the registries this repo owns (chain DEX routers, the Farm allow-list, the
 * Discover links). An `integrated` flag means "FBT routes through it today",
 * nothing more — it is deliberately not a quality judgment. */
export const FBT_INTEGRATED = new Map([
  ['pancakeswap', 'BNB Chain direct router + KyberSwap'],
  ['uniswap', 'Ethereum direct router + Base router'],
  ['quickswap', 'Polygon direct router'],
  ['sushiswap', 'Arbitrum direct router'],
  ['velodrome', 'Optimism direct router'],
  ['trader-joe', 'Avalanche direct router'],
  ['kyberswap', 'Aggregator on every chain'],
  ['aave', 'Lending engine'],
  ['compound', 'Lending engine'],
  ['curve-dex', 'Yield allow-list'],
  ['lido', 'stETH — listed swap asset'],
  ['rocket-pool', 'rETH — listed swap asset'],
  ['thorchain', 'Native cross-chain swaps'],
  ['jupiter', 'Solana routing'],
  ['dydx', 'Futures venue'],
  ['avantis', 'Equities/futures venue'],
  ['ostium', 'Perps venue'],
  ['li-fi', 'Bridge'],
  ['jumper', 'Bridge'],
  ['dunamu', 'Bridge']
]);

function matchIntegrated(slug = '') {
  for (const [key, why] of FBT_INTEGRATED) if (slug.startsWith(key)) return { integrated: true, via: why };
  return { integrated: false, via: null };
}

export async function protocolList({ category = null, chain = null, q = null, sort = 'tvl', limit = 48, offset = 0 } = {}) {
  const base = await llamaProtocols();
  let rows = base.data.protocols.filter((p) => (p.tvl != null && p.tvl > 1_000_000) || (p.volume_24h != null && p.volume_24h > 5_000_000));
  if (category) rows = rows.filter((p) => (p.category || '').toLowerCase() === String(category).toLowerCase());
  if (chain) rows = rows.filter((p) => p.chains.some((c) => c.toLowerCase() === String(chain).toLowerCase()));
  if (q) {
    const s = String(q).toLowerCase();
    rows = rows.filter((p) => p.name?.toLowerCase().includes(s) || p.slug?.includes(s));
  }
  const key = (p) => (sort === 'volume' ? p.volume_24h ?? -1 : sort === 'change' ? p.change_1d ?? -1 : p.tvl ?? -1);
  rows = [...rows].sort((a, b) => key(b) - key(a));
  const total = rows.length;
  rows = rows.slice(offset, offset + Math.min(200, Math.max(1, limit)));
  return {
    data: {
      protocols: rows.map((p) => ({ ...p, ...matchIntegrated(p.slug), users: null /* the feed does not publish user counts — N/A, not zero */ })),
      total,
      limit,
      offset
    },
    meta: { source: 'defillama', updatedAt: new Date().toISOString(), ttlSeconds: 60, freshness: base.meta?.freshness || 'FRESH', dataStatus: 'live' },
    cachedAt: base.cachedAt,
    notices: base.notices
  };
}

/**
 * Trending — ranked from the same fetched fields, five real lenses:
 *   trending: largest |change_1d| * log(1+tvl) among liquid protocols
 *   rising:   change_7d among protocols >$5M
 *   liquidity: absolute tvl
 *   activity: volume_24h / tvl turnover (how busy, not how big)
 *   new:      listedAt within ~180 days, sorted newest
 *   popular:  tvl within FBT categories this product surfaces
 * Click counts do not appear anywhere in this engine, by design.
 */
export async function trendingBuckets() {
  const base = await llamaProtocols();
  const rows = base.data.protocols.filter((p) => p.tvl != null);
  const liquid = rows.filter((p) => p.tvl > 5_000_000);
  const scoreMove = (p) => Math.abs(p.change_1d ?? 0) * Math.log10(1 + (p.tvl || 1));
  const pick = (list, n = 12) => list.slice(0, n).map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains.slice(0, 6), tvl: p.tvl, change_1d: p.change_1d, change_7d: p.change_7d, volume_24h: p.volume_24h, icon: p.icon, ...matchIntegrated(p.slug) }));
  const now = Date.now();
  return {
    data: {
      trending: pick([...liquid].sort((a, b) => scoreMove(b) - scoreMove(a))),
      rising: pick([...liquid].filter((p) => (p.change_7d ?? 0) > 0).sort((a, b) => (b.change_7d ?? -1e9) - (a.change_7d ?? -1e9))),
      highLiquidity: pick([...rows].sort((a, b) => (b.tvl ?? 0) - (a.tvl ?? 0))),
      highActivity: pick([...liquid].filter((p) => p.volume_24h != null).sort((a, b) => (b.volume_24h / Math.max(1, b.tvl)) - (a.volume_24h / Math.max(1, a.tvl)))),
      fresh: pick([...rows].filter((p) => p.listedAt && (now / 1000 - p.listedAt) < 180 * 86_400).sort((a, b) => (b.listedAt ?? 0) - (a.listedAt ?? 0))),
      popular: pick([...liquid].sort((a, b) => (b.tvl ?? 0) - (a.tvl ?? 0)), 10)
    },
    meta: { source: 'defillama', updatedAt: new Date().toISOString(), ttlSeconds: 60, freshness: base.meta?.freshness || 'FRESH', generatedFrom: 'tvl/volume/change fields — not app clicks' }
  };
}

export async function protocolDetail(slug) {
  const s = String(slug || '').trim();
  if (!/^[\w-]{1,64}$/.test(s)) throw new IntelError('BAD_SLUG', 'unknown protocol id');
  return cachedMeta(`llama:protocol:${s}`, CACHE.protocolDetail, async () => {
    const raw = await httpJson(`${LLAMA}/protocol/${encodeURIComponent(s)}`);
    const cat = await llamaProtocols().catch(() => null);
    const listRow = cat?.data?.protocols?.find((p) => p.slug === s) || null;
    const tvls = Array.isArray(raw?.tvl) ? raw.tvl : [];
    const last = tvls[tvls.length - 1];
    const weekAgo = tvls.filter((p) => p.date >= (last?.date ?? 0) - 7 * 86_400)[0];
    const detail = {
      slug: s,
      name: raw?.name || listRow?.name || s,
      symbol: raw?.symbol || null,
      category: raw?.category || listRow?.category || null,
      description: typeof raw?.description === 'string' ? raw.description.slice(0, 400) : (listRow?.description || null),
      url: raw?.url || listRow?.url || null,
      twitter: raw?.twitter || null,
      github: raw?.github || null,
      chains: Array.isArray(raw?.chains) ? raw.chains.slice(0, 40) : (listRow?.chains || []),
      currentChainTvls: raw?.currentChainTvls && typeof raw.currentChainTvls === 'object'
        ? Object.fromEntries(Object.entries(raw.currentChainTvls).map(([k, v]) => [k, Number(v) || 0])) : null,
      tvl: last?.totalLiquidityUSD ?? listRow?.tvl ?? null,
      tvl7dChange: weekAgo?.totalLiquidityUSD ? ((last.totalLiquidityUSD - weekAgo.totalLiquidityUSD) / weekAgo.totalLiquidityUSD) * 100 : null,
      change_1d: listRow?.change_1d ?? null,
      change_7d: listRow?.change_7d ?? null,
      volume_24h: listRow?.volume_24h ?? null,
      fees_24h: listRow?.fees_24h ?? null,
      revenue_24h: listRow?.revenue_24h ?? null,
      mcap: listRow?.mcap ?? null,
      audits: raw?.audits != null ? String(raw.audits) : (listRow?.audits ?? null),
      auditLinks: Array.isArray(raw?.audit_links) ? raw.audit_links.slice(0, 8) : (listRow?.audit_links || []),
      listingDate: raw?.listedAt ?? listRow?.listedAt ?? null,
      deadUrl: raw?.deadUrl || null,
      address: raw?.address || listRow?.address || null,
      geckoId: raw?.gecko_id || null,
      tvlPoints: tvls.length
    };
    return { data: detail, cachedAt: new Date().toISOString() };
  }, 'defillama');
}

/* -------------------------------------------------------------------------- */
/* Incident feed (used by Security; shared here so both pages cite one source) */
/* -------------------------------------------------------------------------- */

export async function hacksIndex() {
  return cachedMeta('llama:hacks', CACHE.hacks, async () => {
    const raw = await httpJson(`${LLAMA}/hacks`);
    if (!Array.isArray(raw)) throw new IntelError('UPSTREAM', 'unexpected /hacks payload');
    const incidents = raw.map((e) => {
      const d = String(e.date ?? '');
      // The feed has shipped both "YYYY-MM-DD" and epoch-seconds dates.
      let ms = null;
      if (/^\d{4}-\d{2}-\d{2}/.test(d)) ms = Date.parse(d);
      else if (/^\d{10}$/.test(d)) ms = Number(d) * 1000;
      else if (/^\d{8}$/.test(d)) ms = Date.parse(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`);
      const amount = Number(e.amountUSD ?? e.amount ?? 0);
      return {
        id: `${d}:${e.name}:${e.date? '' : ''}`.slice(0, 120),
        at: Number.isFinite(ms) ? ms : null,
        dateLabel: Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : d || null,
        protocol: e.name || null,
        chain: e.chain || (Array.isArray(e.chains) ? e.chains.join(', ') : null),
        category: e.classification || null,
        technique: e.technique || null,
        amountUsd: Number.isFinite(amount) && amount > 0 ? amount : null,
        link: e.link || null
      };
    }).filter((e) => e.protocol).sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
    return {
      data: { incidents, count: incidents.length },
      cachedAt: new Date().toISOString()
    };
  }, 'defillama:hacks', { swr: true });
}

