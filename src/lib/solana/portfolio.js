/**
 * SOLANA PORTFOLIO — a client-side holdings read.
 *
 * The swap balance reader is pair-scoped on purpose. This one is the wallet
 * page's view: native SOL plus every non-zero token account on Tokenkeg and
 * Token-2022. It walks the same relay-aware candidate list as the rest of the
 * app (`solanaRpcCandidates({ relay: true })`) and never invents a zero when
 * a node does not answer.
 */
import { findAsset } from '../solanaAssets.js';
import { SOL_MINT, USDC_MINT, USDT_MINT, fromBaseUnits, isSolanaAddress } from '../solana.js';
import { readSolanaNetworkSettings, solanaRpcCall, solanaRpcCandidates } from '../solanaRpc.js';

export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

const KNOWN = Object.freeze({
  [SOL_MINT]: { symbol: 'SOL', name: 'Solana', decimals: 9 },
  [USDC_MINT]: { symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  [USDT_MINT]: { symbol: 'USDT', name: 'Tether USD', decimals: 6 }
});

/** Lamports live on `result.value` for getBalance. A bare number is accepted. */
export function parseLamports(result) {
  const value = result && typeof result === 'object' && 'value' in result ? result.value : result;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return BigInt(Math.trunc(value));
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  return null;
}

/**
 * jsonParsed getTokenAccountsByOwner. Returns `{ ok:false }` when the shape is
 * not an account list — that is a failed read, not an empty wallet.
 */
export function parseTokenAccounts(result) {
  const list = Array.isArray(result) ? result : result?.value;
  if (!Array.isArray(list)) return { ok: false, rows: [] };
  const rows = [];
  for (const row of list) {
    const info = row?.account?.data?.parsed?.info;
    const amount = info?.tokenAmount;
    const mint = String(info?.mint || '');
    const raw = String(amount?.amount ?? '');
    if (!isSolanaAddress(mint) || !/^\d+$/.test(raw) || raw === '0') continue;
    const decimals = Number(amount?.decimals);
    rows.push({
      mint,
      raw,
      decimals: Number.isInteger(decimals) ? decimals : null
    });
  }
  return { ok: true, rows };
}

async function callFirst(method, params) {
  const settings = await readSolanaNetworkSettings();
  const urls = solanaRpcCandidates({ ...settings, relay: true });
  let last = null;
  for (const url of urls) {
    const res = await solanaRpcCall(url, method, params);
    if (res.ok) return { ok: true, result: res.result };
    last = res;
  }
  return { ok: false, code: last?.reason || 'RPC_UNAVAILABLE' };
}

function labelFor(mint, decimals) {
  const known = KNOWN[mint];
  const asset = known ? null : findAsset(mint);
  const symbol = known?.symbol || asset?.symbol || `${mint.slice(0, 4)}…${mint.slice(-4)}`;
  const name = known?.name || asset?.name || '';
  const scale = Number.isInteger(decimals)
    ? decimals
    : (Number.isInteger(known?.decimals) ? known.decimals : (Number.isInteger(asset?.decimals) ? asset.decimals : null));
  return {
    symbol,
    name,
    decimals: scale,
    icon: asset?.icon || asset?.logoURI || null
  };
}

/**
 * @returns {Promise<{ok:boolean, code?:string, partial?:boolean, holdings:Array}>}
 */
export async function readSolanaPortfolio(owner) {
  if (!isSolanaAddress(owner)) return { ok: false, code: 'NO_WALLET', holdings: [] };

  const [native, classic, token2022] = await Promise.all([
    callFirst('getBalance', [owner]),
    callFirst('getTokenAccountsByOwner', [owner, { programId: TOKEN_PROGRAM_ID }, { encoding: 'jsonParsed' }]),
    callFirst('getTokenAccountsByOwner', [owner, { programId: TOKEN_2022_PROGRAM_ID }, { encoding: 'jsonParsed' }])
  ]);

  if (!native.ok && !classic.ok && !token2022.ok) {
    return { ok: false, code: native.code || classic.code || 'RPC_UNAVAILABLE', holdings: [] };
  }

  const holdings = [];
  if (native.ok) {
    const lamports = parseLamports(native.result);
    if (lamports == null) {
      holdings.push({
        mint: SOL_MINT, symbol: 'SOL', name: 'Solana', native: true, amount: null, unread: true
      });
    } else if (lamports > 0n) {
      holdings.push({
        mint: SOL_MINT,
        symbol: 'SOL',
        name: 'Solana',
        native: true,
        decimals: 9,
        raw: lamports.toString(),
        amount: fromBaseUnits(lamports.toString(), 9)
      });
    }
  } else {
    holdings.push({
      mint: SOL_MINT, symbol: 'SOL', name: 'Solana', native: true, amount: null, unread: true
    });
  }

  if (!classic.ok && !token2022.ok) {
    return { ok: false, code: classic.code || token2022.code || 'RPC_UNAVAILABLE', holdings };
  }

  const parsed = [];
  for (const leg of [classic, token2022]) {
    if (!leg.ok) continue;
    const accounts = parseTokenAccounts(leg.result);
    if (!accounts.ok) return { ok: false, code: 'RPC_UNAVAILABLE', holdings };
    parsed.push(...accounts.rows);
  }

  const seen = new Set();
  for (const row of parsed) {
    if (seen.has(row.mint)) continue;
    seen.add(row.mint);
    const meta = labelFor(row.mint, row.decimals);
    const decimals = Number.isInteger(meta.decimals) ? meta.decimals : null;
    holdings.push({
      mint: row.mint,
      symbol: meta.symbol,
      name: meta.name,
      icon: meta.icon,
      native: false,
      decimals,
      raw: row.raw,
      amount: Number.isInteger(decimals) ? fromBaseUnits(row.raw, decimals) : null
    });
  }

  return {
    ok: true,
    partial: !native.ok || !classic.ok || !token2022.ok,
    holdings
  };
}
