/**
 * scripts/solana-replay-fetch.mjs — operational fetch for missing Solana fixtures.
 *
 * Usage: node scripts/solana-replay-fetch.mjs <signature> [--draft]
 *
 * Uses a public Solana RPC (outside production path) to fetch getTransaction
 * with jsonParsed + maxSupportedTransactionVersion: 0, validates via the
 * existing decoder (solanaReplay / solanaSwaps), and writes a fixture draft
 * + manifest draft input.
 *
 * Prefers direct instruction (programId == destination program, not aggregator).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  normalizeSolanaTransactionPayload,
  decodeSolanaSwap,
  sha256Hex
} from '../server/smartMoney/solanaReplay.js';

const RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const SIG = process.argv[2];
const DRAFT = process.argv.includes('--draft');

if (!SIG) {
  console.error('Usage: node scripts/solana-replay-fetch.mjs <signature> [--draft]');
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

async function main() {
  console.log('Fetching sig:', SIG, 'from', RPC);
  const result = await fetchTx(SIG);
  if (!result) throw new Error('No result for signature');

  // Build draft payload (same shape as fixtures: raw envelope or direct result)
  const draftPayload = result;

  // Validate with existing decoder (fail-closed)
  const normalized = normalizeSolanaTransactionPayload(draftPayload);
  if (!normalized) {
    console.error('FAIL: normalizeSolanaTransactionPayload returned null (fail-closed)');
    process.exit(1);
  }

  // Try to decode swap; failure here is acceptable for draft (needs wallet + timing)
  let decodeResult = null;
  try {
    decodeResult = decodeSolanaSwap(normalized, null, { now: Date.parse('2027-01-01T00:00:00.000Z') });
  } catch (e) {
    // Expected when wallet unknown; draft is still valid
  }

  // Write draft fixture (raw result saved with indent=2)
  const fixtureName = `draft-${SIG.slice(0, 16)}.json`;
  const fixturePath = path.join('test', 'fixtures', 'solana-replay', fixtureName);
  writeFileSync(fixturePath, JSON.stringify(result, null, 2) + '\n');
  const hash = sha256Hex(readFileSync(fixturePath));

  // Write draft manifest snippet
  const draftManifest = {
    id: `draft-${SIG.slice(0, 16)}`,
    file: fixturePath,
    sha256: hash,
    signature: SIG,
    wallet: null,
    dexProgram: decodeResult?.dexProgram || null,
    dex: decodeResult?.dex || null,
    encoding: 'jsonParsed', // production encoding; wire fixtures use base64 separately
    corroborated: false,
    source: {
      repository: 'direct-rpc-fetch',
      commit: 'live-mainnet',
      path: `getTransaction/${SIG}`,
      license: 'NOASSERTION',
      url: `https://solscan.io/tx/${SIG}`
    },
    normalization: 'Direct getTransaction jsonParsed result; not pinned until manually verified.',
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

  const manifestDraftPath = path.join('test', 'fixtures', 'solana-replay', `draft-manifest-${SIG.slice(0, 16)}.json`);
  writeFileSync(manifestDraftPath, JSON.stringify(draftManifest, null, 2) + '\n');

  console.log('Draft fixture:', fixturePath);
  console.log('Draft manifest:', manifestDraftPath);
  console.log('SHA-256:', hash);
  console.log('Decode result present:', !!decodeResult);
  console.log('Promotion enabled?', process.env.SM_SOLANA_VERIFIED_PROMOTION === '1');
  console.log('NOTE: This is an operational draft; not a verified replay fixture.');
  console.log('Before promoting to SOLANA_REPLAY_FIXTURES, verify:');
  console.log('  - wallet matches fixture.wallet');
  console.log('  - instruction-corroborated (if corroborated=true)');
  console.log('  - source repository / commit / license clear');
}

main().catch(err => {
  console.error('Fetch/decode failed:', err.message);
  process.exit(1);
});
