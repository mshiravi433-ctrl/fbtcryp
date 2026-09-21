#!/usr/bin/env node
/**
 * FEE MONITOR — did the platform fee actually arrive on-chain?
 * ---------------------------------------------------------------------------
 *
 * WHY THIS EXISTS
 * The revenue rail today is a set of fee fields handed to third parties
 * (KyberSwap feeReceiver, OpenOcean/De¹ referrer, dLN feePercent) plus an
 * optional self-deployed FeeRouter. Every one of those is verified at
 * SIGNING time — the quote echoes the fee, the client checks it — but nobody
 * watches the RECEIVING side. "Verified at signing" and "money actually
 * landed" are different claims, and the KyberSwap fee bug in this repo's
 * history was exactly a fee that looked fine on the wire and never arrived.
 *
 * So this script is the missing receiving-side half:
 *
 *   • For every EVM chain in the app's own registry (src/lib/chains.js —
 *     ONE source of truth, no duplicated chain list) it reads the payout
 *     wallet's native balance and scans recent ERC-20 Transfer logs TO that
 *     address. Fees are paid in whatever token the user sold, so the log
 *     scan is unfiltered by token contract.
 *   • On Solana it reads the payout wallet's SOL + SPL balances.
 *   • If FEE_ROUTER_ADDRESS is set, it calls the live contract's feeBps()
 *     and feeRecipient() so a misconfigured deployment is visible next to
 *     the revenue it should have produced.
 *
 * WHAT IT IS HONEST ABOUT
 *   • Balances are totals, not "revenue today": anything else that lands in
 *     the payout wallet counts too. The log window (default 2000 blocks) is
 *     the closer-to-revenue signal, bounded because public RPCs reject wide
 *     eth_getLogs ranges.
 *   • Public RPCs rate-limit and geo-filter; a chain that answers "logs
 *     unavailable" still reports its balance. A chain that answers nothing
 *     is reported as unreachable, never silently skipped.
 *   • Tron is not monitored (TronGrid needs an API key we don't hold); the
 *     Tron payout address in lib/payout.js is used by the dLN rail today.
 *
 * USAGE
 *   node scripts/fee-monitor.mjs                 # human table
 *   node scripts/fee-monitor.mjs --json          # machine-readable (cron)
 *   node scripts/fee-monitor.mjs --chain 56      # one chain only
 *   node scripts/fee-monitor.mjs --blocks 5000   # wider log window
 *   node scripts/fee-monitor.mjs --no-logs       # balances only (fastest)
 *
 * ENV OVERRIDES
 *   FEE_MONITOR_EVM      EVM payout address (default: app's own payout.js)
 *   FEE_MONITOR_SOLANA   Solana payout address  (default: app's own payout.js)
 *   FEE_ROUTER_ADDRESS   deployed FeeRouter → reads feeBps()/feeRecipient()
 *   RPC_URL              force a single RPC for --chain runs
 *
 * EXIT CODES
 *   0  at least one source answered
 *   1  every source failed (network down / wrong addresses) — CI notices
 *
 * CRON (server or GitHub Actions):
 *   17 * * * *  cd /srv/fbt && node scripts/fee-monitor.mjs --json >> /var/log/fbt-fees.jsonl
 * A missing hourly line, or a line with zero fee transfers on a busy chain,
 * is the alarm. Alerting wiring belongs to the ops cron, not this script.
 */

import { EVM_CHAINS, EVM_CHAIN_ORDER } from '../src/lib/chains.js';
import { PAYOUT_ADDRESSES } from '../src/lib/payout.js';

/* ─── CLI ──────────────────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const JSON_OUT = flag('json');
const NO_LOGS = flag('no-logs');
const ONLY_CHAIN = opt('chain', null);
const LOG_BLOCKS = Math.max(1, Number(opt('blocks', 2000)));

/* keccak256("Transfer(address,address,uint256)") — constant, no crypto dep. */
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const evmRecipient = process.env.FEE_MONITOR_EVM || PAYOUT_ADDRESSES.evm;
const solanaRecipient = process.env.FEE_MONITOR_SOLANA || PAYOUT_ADDRESSES.solana;

if (!/^0x[a-fA-F0-9]{40}$/.test(String(evmRecipient || ''))) {
  console.error('✗ FEE_MONITOR_EVM / PAYOUT_ADDRESSES.evm is not a valid EVM address');
  process.exit(1);
}

/* ─── tiny JSON-RPC client (no deps) ───────────────────────────────────── */

async function rpcFetch(url, method, params, timeoutMs = 12_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error.message?.slice(0, 120) || 'RPC error');
    return json.result;
  } finally {
    clearTimeout(t);
  }
}

/** Pick the first RPC in the chain's own ordered list that answers chainId. */
async function connectChain(cfg) {
  const urls = process.env.RPC_URL ? [process.env.RPC_URL] : cfg.rpc.slice(0, 3);
  for (const url of urls) {
    try {
      const id = await rpcFetch(url, 'eth_chainId', []);
      if (typeof id === 'string' && BigInt(id) === BigInt(cfg.id)) return url;
    } catch {
      /* try the next endpoint in the registry's own priority order */
    }
  }
  return null;
}

/* ─── EVM per-chain read ───────────────────────────────────────────────── */

const padTopic = (addr) => `0x${String(addr).replace(/^0x/, '').toLowerCase().padStart(64, '0')}`;

async function readErc20(url, token, selector) {
  try {
    const out = await rpcFetch(url, 'eth_call', [{ to: token, data: selector }, 'latest'], 8000);
    return out;
  } catch {
    return null;
  }
}

/** decimals() and symbol() for at most MAX_TOKENS distinct fee tokens. */
const MAX_TOKENS = 20;
async function describeTokens(url, tokens) {
  const info = {};
  for (const token of tokens.slice(0, MAX_TOKENS)) {
    const [decRaw, symRaw] = await Promise.all([
      readErc20(url, token, '0x313ce567'), // decimals()
      readErc20(url, token, '0x95d89b41') // symbol()
    ]);
    let decimals = null;
    let symbol = null;
    try {
      decimals = decRaw && decRaw !== '0x' ? Number(BigInt(decRaw)) : null;
    } catch {
      /* some tokens return bytes32 symbols etc. — raw display is fine */
    }
    if (symRaw && symRaw !== '0x' && symRaw.length >= 2 + 64) {
      try {
        const bytes = Buffer.from(symRaw.slice(2), 'hex');
        symbol = bytes.filter((b) => b >= 32 && b < 127).toString('ascii').trim();
      } catch {
        /* non-ascii symbol: leave null */
      }
    }
    info[token] = { decimals, symbol: symbol || null };
  }
  return info;
}

async function monitorEvmChain(chainId, recipient) {
  const cfg = EVM_CHAINS[chainId];
  if (!cfg) return { chainId, ok: false, error: 'CHAIN_NOT_IN_REGISTRY' };

  const url = await connectChain(cfg);
  if (!url) return { chainId, name: cfg.name, ok: false, error: 'RPC_UNREACHABLE' };

  const out = {
    chainId,
    name: cfg.name,
    ok: true,
    rpc: url.replace(/^https:\/\//, ''),
    native: { symbol: cfg.native.symbol, balanceRaw: '0', balance: 0 },
    feeTransfers: { available: false }
  };

  const [balance, blockHex] = await Promise.all([
    rpcFetch(url, 'eth_getBalance', [recipient, 'latest']).catch(() => '0x0'),
    rpcFetch(url, 'eth_blockNumber', []).catch(() => null)
  ]);
  out.native.balanceRaw = String(balance);
  out.native.balance = Number(BigInt(balance)) / 1e18;

  if (!NO_LOGS && blockHex) {
    const latest = BigInt(blockHex);
    const from = latest > BigInt(LOG_BLOCKS) ? latest - BigInt(LOG_BLOCKS) + 1n : 1n;
    const topics = [TRANSFER_TOPIC, null, padTopic(recipient)];
    let logs = null;
    let triedWindow = LOG_BLOCKS;
    /* Public nodes reject wide getLogs ranges; one shrink-and-retry on the
       most common case. A hard "no logs" answer is reported, not faked. */
    for (const window of [LOG_BLOCKS, 500]) {
      try {
        logs = await rpcFetch(
          url,
          'eth_getLogs',
          [{ fromBlock: `0x${(latest - BigInt(window) + 1n > 0n ? latest - BigInt(window) + 1n : 1n).toString(16)}`, toBlock: blockHex, topics }],
          20_000
        );
        triedWindow = window;
        break;
      } catch {
        logs = null;
      }
    }
    if (Array.isArray(logs)) {
      const byToken = {};
      const txs = new Set();
      for (const log of logs) {
        const token = log.address?.toLowerCase();
        if (!token) continue;
        const valHex = log.data;
        let value = null;
        try {
          value = BigInt(valHex);
        } catch {
          continue;
        }
        byToken[token] = (byToken[token] || 0n) + value;
        if (log.transactionHash) txs.add(log.transactionHash);
      }
      const info = await describeTokens(url, Object.keys(byToken));
      out.feeTransfers = {
        available: true,
        windowBlocks: triedWindow,
        fromBlock: Number(from),
        toBlock: Number(latest),
        transferCount: logs.length,
        distinctTx: txs.size,
        byToken: Object.fromEntries(
          Object.entries(byToken).map(([token, raw]) => {
            const d = info[token]?.decimals;
            return [
              token,
              {
                symbol: info[token]?.symbol || '?',
                raw: raw.toString(),
                amount: d !== null ? Number(raw) / 10 ** d : null
              }
            ];
          })
        )
      };
    } else {
      out.feeTransfers = { available: false, reason: 'RPC_REJECTED_LOGS' };
    }
  }

  return out;
}

/* ─── Solana read ──────────────────────────────────────────────────────── */

async function monitorSolana(recipient) {
  const url = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const out = { chain: 'solana', ok: false };
  try {
    const bal = await rpcFetch(url, 'getBalance', [recipient, { commitment: 'confirmed' }]);
    out.ok = true;
    out.sol = { lamports: bal.value, sol: bal.value / 1e9 };
    const tokens = await rpcFetch(url, 'getTokenAccountsByOwner', [
      recipient,
      { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
      { encoding: 'jsonParsed' }
    ]).catch(() => null);
    if (Array.isArray(tokens?.value)) {
      out.spl = tokens.value
        .map((t) => {
          const info = t.account?.data?.parsed?.info;
          const amount = Number(info?.tokenAmount?.uiAmount ?? 0);
          const mint = info?.mint || '?';
          return { mint, amount: amount > 0 ? amount : null };
        })
        .filter((t) => t.amount !== null && t.amount > 0);
    }
  } catch (e) {
    out.error = String(e.message || e).slice(0, 120);
  }
  return out;
}

/* ─── FeeRouter config read (only on the chain it belongs to) ──────────── */

async function readFeeRouterConfig(chainId) {
  const router = process.env.FEE_ROUTER_ADDRESS;
  if (!router || !/^0x[a-fA-F0-9]{40}$/.test(router)) return null;
  const cfg = EVM_CHAINS[chainId];
  if (!cfg) return null;
  const url = await connectChain(cfg);
  if (!url) return { address: router, error: 'RPC_UNREACHABLE' };
  const [bps, recip] = await Promise.all([
    rpcFetch(url, 'eth_call', [{ to: router, data: '0x24a9d853' }, 'latest']).catch(() => null), // feeBps()
    rpcFetch(url, 'eth_call', [{ to: router, data: '0x46904840' }, 'latest']).catch(() => null) // feeRecipient()
  ]);
  const config = { address: router };
  if (bps) {
    try {
      config.feeBps = Number(BigInt(bps));
    } catch {
      /* not a FeeRouter at this address */
    }
  }
  if (recip && recip.length >= 66) {
    const addr = '0x' + recip.slice(-40);
    if (/^0x[a-fA-F0-9]{40}$/.test(addr)) config.feeRecipient = addr;
  }
  return config;
}

/* ─── run ──────────────────────────────────────────────────────────────── */

const chainIds = ONLY_CHAIN
  ? [Number(ONLY_CHAIN)]
  : EVM_CHAIN_ORDER.filter((id) => EVM_CHAINS[id]);

const t0 = Date.now();
const [evmResults, solana, routerConfig] = await Promise.all([
  Promise.all(chainIds.map((id) => monitorEvmChain(id, evmRecipient))),
  monitorSolana(solanaRecipient),
  readFeeRouterConfig(Number(ONLY_CHAIN || 56))
]);

const failed = evmResults.filter((r) => !r.ok).length;
const answered = evmResults.length - failed + (solana.ok ? 1 : 0);

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        tookMs: Date.now() - t0,
        logWindowBlocks: NO_LOGS ? 0 : LOG_BLOCKS,
        payout: { evm: evmRecipient, solana: solanaRecipient },
        evm: evmResults,
        solana,
        feeRouter: routerConfig,
        answered,
        failed
      },
      null,
      2
    )
  );
} else {
  const short = (a) => (a ? `${a.slice(0, 8)}…${a.slice(-6)}` : '-');
  console.log('\nFBT fee monitor — receiving side of the revenue rail');
  console.log('='.repeat(72));
  console.log(`payout (evm)    : ${evmRecipient}`);
  console.log(`payout (solana) : ${solanaRecipient}`);
  if (routerConfig) {
    console.log(
      `feeRouter (56)  : ${routerConfig.address}` +
        (routerConfig.feeBps !== undefined
          ? ` · feeBps=${routerConfig.feeBps} (${(routerConfig.feeBps / 100).toFixed(2)}%) · recipient=${short(routerConfig.feeRecipient)}`
          : routerConfig.error
            ? ` · ${routerConfig.error}`
            : ' · no response (not deployed here?)')
    );
  }
  console.log('-'.repeat(72));
  for (const r of evmResults) {
    if (!r.ok) {
      console.log(`${(r.name || `chain ${r.chainId}`).padEnd(14)} ✗ ${r.error}`);
      continue;
    }
    const fees = r.feeTransfers?.available
      ? `${r.feeTransfers.transferCount} transfers / ${r.feeTransfers.distinctTx} txs in last ${r.feeTransfers.windowBlocks} blocks`
      : 'logs unavailable';
    const tokens = r.feeTransfers?.available
      ? Object.entries(r.feeTransfers.byToken)
          .slice(0, 5)
          .map(([, v]) => (v.amount !== null ? `${v.amount} ${v.symbol}` : `${v.raw.slice(0, 12)}… raw`))
          .join(', ')
      : '';
    console.log(
      `${r.name.padEnd(14)} ${r.native.balance.toFixed(6)} ${r.native.symbol.padEnd(5)} │ ${fees}${tokens ? ` │ ${tokens}` : ''}`
    );
  }
  console.log('-'.repeat(72));
  if (solana.ok) {
    console.log(
      `solana         ${solana.sol.sol.toFixed(6)} SOL`.padEnd(30) +
        (solana.spl?.length ? ` │ ${solana.spl.length} SPL accounts with balance` : ' │ no SPL balances')
    );
  } else {
    console.log(`solana         ✗ ${solana.error}`);
  }
  console.log('-'.repeat(72));
  console.log(
    `answered: ${answered}/${evmResults.length + 1} sources · ${failed} chain(s) unreachable · ${Date.now() - t0}ms`
  );
  console.log('  (balances are totals, not "revenue today"; log window is the revenue signal)\n');
}

process.exit(answered > 0 ? 0 : 1);
