/**
 * scripts/solana-replay-fetch.mjs — operational fetch for missing Solana fixtures.
 *
 * Usage: node scripts/solana-replay-fetch.mjs <signature> [--draft]
 *
 * Uses a public Solana RPC outside the production path, validates the direct
 * getTransaction result with the production normalizer/decoder, and only writes
 * raw fixture + manifest drafts when the explicit --draft flag is supplied.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  normalizeSolanaTransactionPayload,
  sha256Hex
} from '../server/smartMoney/solanaReplay.js';
import { decodeSolanaSwap } from '../server/smartMoney/solanaSwaps.js';

const RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const SIG = process.argv[2];
const DRAFT = process.argv.includes('--draft');
const SOL_SIG = /^[1-9A-HJ-NP-Za-km-z]{80,90}$/;

if (!SIG || !SOL_SIG.test(SIG)) {
  console.error('Usage: node scripts/solana-replay-fetch.mjs <base58-signature> [--draft]');
  process.exit(1);
}

async function fetchTx(sig) {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getTransaction',
    params: [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]
  });
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  });
  if (!res.ok) throw new Error('RPC HTTP ' + res.status);
  const data = await res.json();
  if (data.error) throw new Error('RPC error: ' + JSON.stringify(data.error));
  return data.result;
}

function signerOwnedWallets(tx) {
  const keys = tx?.transaction?.message?.accountKeys || tx?.message?.accountKeys || [];
  const signerKeys = keys.filter((key) => key && typeof key === 'object' && key.signer === true)
    .map((key) => String(key.pubkey || key.address || ''));
  // Parsed RPC results normally annotate signers. If a provider returned plain
  // keys, only the fee payer (key 0) is considered; arbitrary token owners are
  // not guessed as the trader.
  if (!signerKeys.length && keys.length) {
    const first = keys[0];
    signerKeys.push(String(typeof first === 'string' ? first : first?.pubkey || first?.address || ''));
  }
  const owners = new Set([
    ...(tx?.meta?.preTokenBalances || []),
    ...(tx?.meta?.postTokenBalances || [])
  ].map((row) => String(row?.owner || '')).filter(Boolean));
  return [...new Set(signerKeys)].filter((address) => owners.has(address));
}

async function main() {
  console.log('Fetching signature:', SIG, 'from', RPC);
  const result = await fetchTx(SIG);
  if (!result) throw new Error('No transaction result for signature');

  const normalized = normalizeSolanaTransactionPayload(result);
  if (!normalized) throw new Error('Transaction payload normalization failed closed');
  const actualSignature = normalized.transaction?.signatures?.[0];
  if (actualSignature !== SIG) throw new Error('Fetched transaction signature does not match requested signature');

  const decoded = signerOwnedWallets(normalized).map((wallet) => {
    try { return decodeSolanaSwap(normalized, wallet, { now: Date.now() + 60_000 }); }
    catch { return null; }
  }).filter(Boolean);
  const decodeResult = decoded.length === 1 ? decoded[0] : null;
  const walletAmbiguous = decoded.length > 1;
  const hash = sha256Hex(JSON.stringify(result, null, 2) + '\n');

  let fixturePath = null;
  let manifestDraftPath = null;
  if (DRAFT) {
    const fixtureName = `draft-${SIG.slice(0, 16)}.json`;
    fixturePath = path.join('test', 'fixtures', 'solana-replay', fixtureName);
    writeFileSync(fixturePath, JSON.stringify(result, null, 2) + '\n');
    const fileHash = sha256Hex(readFileSync(fixturePath));
    const draftManifest = {
      id: `draft-${SIG.slice(0, 16)}`,
      file: fixturePath,
      sha256: fileHash,
      signature: SIG,
      wallet: decodeResult?.wallet || null,
      dexProgram: decodeResult?.dexProgram || null,
      dex: decodeResult?.dex || null,
      encoding: 'jsonParsed',
      corroborated: decodeResult?.instructionCorroborated === true,
      source: {
        repository: 'direct-rpc-fetch',
        commit: 'live-mainnet',
        path: `getTransaction/${SIG}`,
        license: 'NOASSERTION',
        url: `https://solscan.io/tx/${SIG}`
      },
      normalization: 'Direct getTransaction jsonParsed result; raw payload and provenance must be manually verified before pinning.',
      expected: decodeResult ? {
        side: decodeResult.side,
        token: decodeResult.token,
        amount: decodeResult.amount,
        amountRaw: String(decodeResult.amountRaw || ''),
        tokenDecimals: decodeResult.tokenDecimals,
        quoteToken: decodeResult.quoteToken,
        quoteSymbol: decodeResult.quoteSymbol,
        quoteAmount: decodeResult.quoteAmount,
        quoteAmountRaw: String(decodeResult.quoteAmountRaw || ''),
        quoteDecimals: decodeResult.quoteDecimals,
        valueUsd: decodeResult.valueUsd,
        timestamp: decodeResult.timestamp,
        instructionFillCount: decodeResult.instructionFillCount,
        instructionTransfers: decodeResult.instructionTransfers
      } : null
    };
    manifestDraftPath = path.join('test', 'fixtures', 'solana-replay', `draft-manifest-${SIG.slice(0, 16)}.json`);
    writeFileSync(manifestDraftPath, JSON.stringify(draftManifest, null, 2) + '\n');
  }

  console.log('Signature matched:', true);
  console.log('Signer-owned wallets with decoded swaps:', decoded.length);
  console.log('Unique decoded swap:', !!decodeResult, walletAmbiguous ? '(ambiguous wallet set)' : '');
  if (decodeResult) {
    console.log('DEX:', decodeResult.dex, decodeResult.dexProgram);
    console.log('Instruction corroborated:', decodeResult.instructionCorroborated);
    console.log('Wallet:', decodeResult.wallet);
  }
  console.log('SHA-256:', DRAFT ? sha256Hex(readFileSync(fixturePath)) : hash);
  if (DRAFT) {
    console.log('Draft fixture:', fixturePath);
    console.log('Draft manifest:', manifestDraftPath);
  } else {
    console.log('No files written. Pass --draft to save unverified review drafts.');
  }
  console.log('Promotion enabled?', process.env.SM_SOLANA_VERIFIED_PROMOTION === '1');
  console.log('NOTE: A draft is not a verified replay fixture. Confirm source license, wallet, DEX, decoder output, and provenance before pinning.');
}

main().catch((err) => {
  console.error('Fetch/decode failed:', err.message);
  process.exit(1);
});
