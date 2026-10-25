import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { base58Encode, base58Decode } from '../../src/lib/launch/solana/launchlab.js';
import {
  SOLANA_BALANCE_ONLY_DECODE,
  SOLANA_DEX_PROGRAMS,
  SOLANA_INSTRUCTION_CORROBORATED_DECODE,
  assessSolanaSwapLedger,
  decodeSolanaSwap,
  isInstructionCorroboratedSolanaSwap
} from './solanaSwaps.js';
import {
  SOLANA_REPLAY_FIXTURES,
  SOLANA_REPLAY_NOW,
  coverageForSolanaProgram
} from './solanaReplayManifest.js';

export const SOLANA_REPLAY_VERSION = 'solana-real-transaction-replay-v1';
export const SOLANA_PROMOTION_ENV = 'SM_SOLANA_VERIFIED_PROMOTION';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
let executedCorpusCache = null;

const unique = (values) => [...new Set(values.filter(Boolean))];
const finiteClose = (actual, expected) => Number.isFinite(Number(actual))
  && Math.abs(Number(actual) - Number(expected)) <= Math.max(1e-9, Math.abs(Number(expected)) * 1e-12);

export function solanaVerifiedPromotionEnabled(env = process.env) {
  return String(env?.[SOLANA_PROMOTION_ENV] ?? '0') === '1';
}

/** Accept the envelopes real RPC tooling actually stores, but return only a
 * direct transaction result. A recursive search for transaction-shaped keys
 * anywhere in an arbitrary object would eventually find the wrong thing. */
export function normalizeSolanaTransactionPayload(payload, depth = 0) {
  if (depth > 5 || payload == null) return null;
  if (Array.isArray(payload)) {
    return payload.length === 1 ? normalizeSolanaTransactionPayload(payload[0], depth + 1) : null;
  }
  if (typeof payload !== 'object') return null;
  // Wire-format base64 envelopes from solana-tx-parser fixtures
  if (payload.transaction && Array.isArray(payload.transaction)
      && payload.transaction.length === 2 && payload.transaction[1] === 'base64') {
    return normalizeSolanaWireTransaction(payload);
  }
  if (payload.transaction && payload.meta) return payload;
  if (payload.result != null) return normalizeSolanaTransactionPayload(payload.result, depth + 1);
  return null;
}

export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function assessSolanaReplayCorpus(fixtures = SOLANA_REPLAY_FIXTURES) {
  const rows = Array.isArray(fixtures) ? fixtures : [];
  const programs = Object.entries(SOLANA_DEX_PROGRAMS).map(([programId, dex]) => {
    const programFixtures = rows.filter((fixture) => fixture.dexProgram === programId);
    const corroboratedFixtures = programFixtures.filter((fixture) => fixture.expected && fixture.corroborated === true).length;
    const balanceOnlyFixtures = programFixtures.filter((fixture) => fixture.expected && fixture.corroborated !== true).length;
    const negativeFixtures = programFixtures.filter((fixture) => fixture.expected == null).length;
    return {
      programId,
      dex,
      fixtures: programFixtures.length,
      corroboratedFixtures,
      balanceOnlyFixtures,
      negativeFixtures,
      status: corroboratedFixtures ? 'instruction-corroborated-replay'
        : balanceOnlyFixtures ? 'balance-delta-replay-only'
          : 'missing-replay-fixture'
    };
  });
  const missingCorroboratedPrograms = programs
    .filter((program) => !program.corroboratedFixtures)
    .map((program) => program.programId);
  const balanceReplayPrograms = programs
    .filter((program) => program.corroboratedFixtures || program.balanceOnlyFixtures)
    .map((program) => program.programId);
  const corroboratedPrograms = programs
    .filter((program) => program.corroboratedFixtures)
    .map((program) => program.programId);
  return {
    version: SOLANA_REPLAY_VERSION,
    status: missingCorroboratedPrograms.length ? 'partial-real-transaction-replay' : 'complete-real-transaction-replay',
    executionStatus: 'not-executed',
    executed: false,
    complete: missingCorroboratedPrograms.length === 0,
    supportedPrograms: programs.length,
    fixtureCount: rows.length,
    positiveFixtures: rows.filter((fixture) => fixture.expected).length,
    negativeFixtures: rows.filter((fixture) => fixture.expected == null).length,
    corroboratedPrograms: corroboratedPrograms.length,
    corroboratedProgramIds: corroboratedPrograms,
    balanceReplayPrograms: balanceReplayPrograms.length,
    balanceReplayProgramIds: balanceReplayPrograms,
    missingCorroboratedPrograms,
    programs,
    basis: missingCorroboratedPrograms.length
      ? 'Real mainnet payloads currently corroborate only part of the supported-program set; the remaining programs stay blocked rather than inheriting Jupiter v6 evidence.'
      : 'Every supported program has at least one pinned real-transaction fixture whose parsed SPL fills corroborate its balance-delta decode.'
  };
}

function compareExpected(fixture, actual) {
  const mismatches = [];
  const expected = fixture.expected;
  if (expected == null) {
    if (actual != null) mismatches.push('expected-null-decode');
    return mismatches;
  }
  if (!actual) return ['missing-decode'];
  const exactFields = [
    'wallet', 'signature', 'dexProgram', 'dex', 'side', 'token', 'amountRaw',
    'tokenDecimals', 'quoteToken', 'quoteSymbol', 'quoteAmountRaw', 'quoteDecimals',
    'timestamp', 'instructionFillCount'
  ];
  for (const field of exactFields) {
    const wanted = field === 'wallet' ? fixture.wallet
      : field === 'signature' ? fixture.signature
        : field === 'dexProgram' ? fixture.dexProgram
          : field === 'dex' ? fixture.dex
            : expected[field];
    if (actual[field] !== wanted) mismatches.push(`${field}-mismatch`);
  }
  for (const field of ['amount', 'quoteAmount', 'valueUsd']) {
    if (!finiteClose(actual[field], expected[field])) mismatches.push(`${field}-mismatch`);
  }
  const wantedMethod = fixture.corroborated
    ? SOLANA_INSTRUCTION_CORROBORATED_DECODE
    : SOLANA_BALANCE_ONLY_DECODE;
  if (actual.decodeMethod !== wantedMethod) mismatches.push('decodeMethod-mismatch');
  if (actual.instructionCorroborated !== fixture.corroborated) mismatches.push('instructionCorroborated-mismatch');
  if (actual.instructionTransfers?.target !== expected.instructionTransfers?.target
    || actual.instructionTransfers?.quote !== expected.instructionTransfers?.quote) {
    mismatches.push('instructionTransfers-mismatch');
  }
  if (fixture.corroborated && !isInstructionCorroboratedSolanaSwap(actual)) {
    mismatches.push('corroborated-shape-invalid');
  }
  return mismatches;
}

export function verifySolanaReplayFixture(fixture, payload, { now = SOLANA_REPLAY_NOW, sha256 = null } = {}) {
  const transaction = normalizeSolanaTransactionPayload(payload);
  const signature = transaction?.transaction?.signatures?.[0] || null;
  const actual = transaction ? decodeSolanaSwap(transaction, fixture.wallet, { now }) : null;
  const mismatches = [];
  if (!transaction) mismatches.push('payload-not-a-transaction-result');
  if (signature !== fixture.signature) mismatches.push('payload-signature-mismatch');
  if (sha256 != null && sha256 !== fixture.sha256) mismatches.push('payload-sha256-mismatch');
  mismatches.push(...compareExpected(fixture, actual));
  return {
    id: fixture.id,
    file: fixture.file,
    signature: fixture.signature,
    wallet: fixture.wallet,
    dexProgram: fixture.dexProgram,
    dex: fixture.dex,
    encoding: fixture.encoding,
    corroborated: fixture.corroborated === true,
    expected: fixture.expected,
    actual,
    sha256,
    passed: mismatches.length === 0,
    mismatches: unique(mismatches)
  };
}

export function runSolanaReplayFixtures({
  fixtures = SOLANA_REPLAY_FIXTURES,
  rootDir = REPO_ROOT,
  readFile = null,
  now = SOLANA_REPLAY_NOW
} = {}) {
  const results = fixtures.map((fixture) => {
    try {
      const bytes = typeof readFile === 'function'
        ? readFile(fixture.file, fixture)
        : readFileSync(path.join(rootDir, fixture.file));
      const text = Buffer.isBuffer(bytes) || bytes instanceof Uint8Array
        ? Buffer.from(bytes).toString('utf8') : String(bytes);
      return verifySolanaReplayFixture(fixture, JSON.parse(text), {
        now,
        sha256: sha256Hex(bytes)
      });
    } catch (error) {
      return {
        id: fixture.id,
        file: fixture.file,
        signature: fixture.signature,
        wallet: fixture.wallet,
        dexProgram: fixture.dexProgram,
        dex: fixture.dex,
        encoding: fixture.encoding,
        corroborated: fixture.corroborated === true,
        expected: fixture.expected,
        actual: null,
        sha256: null,
        passed: false,
        mismatches: [`fixture-read-failed:${String(error?.code || error?.message || 'unknown').slice(0, 80)}`]
      };
    }
  });
  const passed = results.length > 0 && results.every((result) => result.passed);
  const declaredCorpus = assessSolanaReplayCorpus(fixtures);
  const corpus = {
    ...declaredCorpus,
    executed: true,
    executionStatus: passed ? 'passed' : 'failed',
    executedFixtures: results.length,
    passedFixtures: results.filter((result) => result.passed).length,
    failedFixtures: results.filter((result) => !result.passed).length
  };
  return { version: SOLANA_REPLAY_VERSION, executed: true, passed, results, corpus };
}

/** Execute the committed corpus once per process. If a deployment does not
 * ship test fixtures, the gate reports that honestly and promotion remains
 * closed; it does not fall back to trusting manifest declarations alone. */
export function getExecutedSolanaReplayCorpus({ refresh = false, rootDir = REPO_ROOT } = {}) {
  if (!executedCorpusCache || refresh) {
    executedCorpusCache = runSolanaReplayFixtures({ rootDir });
  }
  return executedCorpusCache;
}

function parseRaw(value) {
  if (!/^-?\d+$/.test(String(value ?? ''))) return null;
  try { return BigInt(String(value)); } catch { return null; }
}

function balanceMap(balances, blockers) {
  const byMint = new Map();
  for (const row of (Array.isArray(balances) ? balances : [])) {
    const token = String(row?.token || row?.mint || '');
    const raw = parseRaw(row?.amountRaw);
    const decimals = Number(row?.decimals);
    if (!SOL_ADDR.test(token)) continue;
    if (raw == null || raw < 0n || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
      blockers.add('token-balance-raw-amount-missing');
      continue;
    }
    const previous = byMint.get(token);
    if (previous && previous.decimals !== decimals) {
      blockers.add('token-balance-decimals-mismatch');
      continue;
    }
    byMint.set(token, {
      token,
      symbol: row?.symbol || previous?.symbol || null,
      amountRaw: (previous?.amountRaw || 0n) + raw,
      decimals
    });
  }
  return byMint;
}

/**
 * Run the decoded Solana ledger as a quantity-only FIFO and compare its open
 * raw-unit inventory with an independent current SPL balance read.
 *
 * This is deliberately not a P&L engine: the result contains no score, no
 * realized/unrealized profit and no qualification. Its job is narrower and,
 * for admission, more useful — prove that the wallet's decoded buys/sells can
 * actually explain the target-mint quantities it holds now. A mismatch means
 * an unobserved transfer, a missing history segment or a decoding error; all
 * three keep promotion closed.
 */
export function reconcileSolanaShadowFifo({
  swaps = [],
  balances = [],
  balanceCoverage = {},
  signatureCoverage = {},
  transactionCoverage = {},
  ledgerAssessment = null,
  now = Date.now()
} = {}) {
  const blockers = new Set();
  const ledger = ledgerAssessment || assessSolanaSwapLedger({
    swaps, signatureCoverage, transactionCoverage, now
  });
  for (const blocker of ledger.blockers || []) blockers.add(blocker);
  if (ledger.shadowEligible !== true) blockers.add('shadow-ledger-not-ready');

  if (balanceCoverage?.dataStatus !== 'live') blockers.add('token-balance-read-unavailable');
  if (balanceCoverage?.complete !== true || balanceCoverage?.truncated === true) {
    blockers.add('token-balance-read-incomplete');
  }

  const current = balanceMap(balances, blockers);
  const rows = (Array.isArray(swaps) ? swaps : [])
    .slice()
    .sort((a, b) => Number(a?.timestamp || 0) - Number(b?.timestamp || 0)
      || String(a?.id || '').localeCompare(String(b?.id || '')));
  const lots = new Map();
  const symbols = new Map();
  const decimalsByMint = new Map();
  let closedTrades = 0;
  let unmatchedExits = 0;

  for (const swap of rows) {
    const token = String(swap?.token || '');
    const raw = parseRaw(swap?.amountRaw);
    const decimals = Number(swap?.tokenDecimals);
    if (!SOL_ADDR.test(token) || raw == null || raw <= 0n
      || !Number.isInteger(decimals) || decimals < 0 || decimals > 18
      || !['BUY', 'SELL'].includes(swap?.side)) {
      blockers.add('swap-raw-amount-missing');
      continue;
    }
    if (decimalsByMint.has(token) && decimalsByMint.get(token) !== decimals) {
      blockers.add('swap-decimals-mismatch');
      continue;
    }
    decimalsByMint.set(token, decimals);
    if (swap.symbol && !symbols.has(token)) symbols.set(token, swap.symbol);
    const queue = lots.get(token) || [];
    if (swap.side === 'BUY') {
      queue.push(raw);
    } else {
      let remaining = raw;
      let matched = 0n;
      while (remaining > 0n && queue.length) {
        const take = queue[0] < remaining ? queue[0] : remaining;
        queue[0] -= take;
        remaining -= take;
        matched += take;
        if (queue[0] === 0n) queue.shift();
      }
      if (matched > 0n) closedTrades++;
      if (remaining > 0n) unmatchedExits++;
    }
    lots.set(token, queue);
  }
  if (unmatchedExits) blockers.add('unmatched-sell-inventory');

  const checked = [...decimalsByMint.keys()].sort().map((token) => {
    const expectedRaw = (lots.get(token) || []).reduce((sum, value) => sum + value, 0n);
    const currentRow = current.get(token) || null;
    const currentRaw = currentRow?.amountRaw ?? 0n;
    const decimals = decimalsByMint.get(token);
    if (currentRow && currentRow.decimals !== decimals) blockers.add('token-balance-decimals-mismatch');
    const matches = currentRow?.decimals === decimals || !currentRow
      ? expectedRaw === currentRaw : false;
    if (!matches) blockers.add('current-balance-mismatch');
    return {
      token,
      symbol: symbols.get(token) || currentRow?.symbol || null,
      decimals,
      expectedAmountRaw: expectedRaw.toString(),
      expectedAmount: Number(expectedRaw) / (10 ** decimals),
      currentAmountRaw: currentRaw.toString(),
      currentAmount: Number(currentRaw) / (10 ** decimals),
      matches
    };
  });

  const reconciled = blockers.size === 0;
  return {
    version: 'solana-shadow-fifo-reconciliation-v1',
    status: reconciled ? 'reconciled-shadow-fifo' : 'shadow-fifo-blocked',
    reconciled,
    promoted: false,
    swaps: rows.length,
    corroboratedSwaps: rows.filter(isInstructionCorroboratedSolanaSwap).length,
    closedTrades,
    unmatchedExits,
    checkedMints: checked.length,
    matchedMints: checked.filter((row) => row.matches).length,
    mismatchedMints: checked.filter((row) => !row.matches).length,
    openPositions: checked.filter((row) => row.expectedAmountRaw !== '0'),
    checks: checked,
    blockers: [...blockers],
    basis: reconciled
      ? 'Raw-unit FIFO inventory from the corroborated decoded ledger exactly matches an untruncated legacy-SPL + Token-2022 current-balance read for every traded target mint.'
      : 'Shadow FIFO remains diagnostic only until complete history/detail coverage, fully corroborated raw legs and exact current-balance agreement are all present.'
  };
}

function corpusOf(input) {
  if (!input) return assessSolanaReplayCorpus();
  return input.corpus || input;
}

function hasPromotionRawFields(swap) {
  return parseRaw(swap?.amountRaw) > 0n
    && parseRaw(swap?.quoteAmountRaw) > 0n
    && Number.isInteger(swap?.tokenDecimals)
    && Number.isInteger(swap?.quoteDecimals);
}

/**
 * The reversible phase-5 admission gate. Evidence eligibility and the deploy
 * switch are reported separately: an operator can see that a wallet would be
 * promotable without a disabled flag being mistaken for a decoding failure.
 */
export function assessSolanaVerifiedPromotion({
  swaps = [],
  ledgerAssessment = null,
  reconciliation = null,
  replayCorpus = null,
  env = process.env,
  now = Date.now()
} = {}) {
  const corpus = corpusOf(replayCorpus);
  const ledger = ledgerAssessment || assessSolanaSwapLedger({ swaps, now });
  const blockers = new Set(ledger.blockers || []);
  const rows = Array.isArray(swaps) ? swaps : [];
  const ids = new Set();

  if (!rows.length) blockers.add('no-decoded-swaps');
  for (const swap of rows) {
    if (!isInstructionCorroboratedSolanaSwap(swap)) blockers.add('uncorroborated-or-invalid-swap');
    if (!hasPromotionRawFields(swap)) blockers.add('swap-raw-amount-missing');
    const id = String(swap?.id || '');
    if (!id || ids.has(id)) blockers.add('duplicate-or-missing-swap-id');
    ids.add(id);
  }
  if (ledger.shadowEligible !== true) blockers.add('shadow-ledger-not-ready');
  if (!reconciliation) blockers.add('shadow-fifo-reconciliation-missing');
  else {
    for (const blocker of reconciliation.blockers || []) blockers.add(blocker);
    if (reconciliation.reconciled !== true || reconciliation.status !== 'reconciled-shadow-fifo') {
      blockers.add('shadow-fifo-not-reconciled');
    }
  }

  if (corpus.executed !== true || corpus.executionStatus !== 'passed') {
    blockers.add('replay-corpus-not-executed-or-failed');
  }
  if (corpus.complete !== true) blockers.add('replay-corpus-incomplete');
  const corroborated = new Set(corpus.corroboratedProgramIds || []);
  const programsInSample = unique(rows.map((swap) => swap?.dexProgram));
  const sampleProgramsMissingReplay = programsInSample.filter((program) => !corroborated.has(program));
  if (sampleProgramsMissingReplay.length) blockers.add('sample-program-missing-corroborated-replay');

  const evidenceEligible = blockers.size === 0;
  const switchEnabled = solanaVerifiedPromotionEnabled(env);
  if (!switchEnabled) blockers.add('promotion-switch-disabled');
  const promoted = evidenceEligible && switchEnabled;

  return {
    version: 'solana-verified-promotion-gate-v1',
    status: promoted ? 'verified-promotion-enabled'
      : evidenceEligible ? 'evidence-ready-promotion-disabled'
        : 'promotion-blocked',
    evidenceEligible,
    switchEnabled,
    promoted,
    swaps: rows.length,
    verifiedSwaps: promoted ? rows.length : 0,
    programsInSample,
    sampleProgramsMissingReplay,
    replayStatus: corpus.status || null,
    replayExecutionStatus: corpus.executionStatus || null,
    replayComplete: corpus.complete === true,
    corroboratedPrograms: corpus.corroboratedPrograms ?? corroborated.size,
    supportedPrograms: corpus.supportedPrograms ?? Object.keys(SOLANA_DEX_PROGRAMS).length,
    missingCorroboratedPrograms: corpus.missingCorroboratedPrograms || [],
    reconciliationStatus: reconciliation?.status || null,
    blockers: [...blockers],
    basis: promoted
      ? 'Separate promotion switch is on, the executed real-transaction replay corpus covers every supported program, the wallet ledger is complete and corroborated, and raw FIFO inventory reconciles with current SPL balances.'
      : evidenceEligible
        ? 'All evidence gates pass, but the separate reversible promotion switch remains off.'
        : 'Verified Solana score, P&L, qualification and consensus remain closed while any replay, coverage, corroboration or balance-reconciliation gate is open.'
  };
}

export function promoteSolanaSwaps({ swaps = [], assessment = null, reconciliation = null } = {}) {
  if (!assessment?.promoted) return [];
  return (Array.isArray(swaps) ? swaps : []).map((swap) => ({
    ...swap,
    classification: 'verified',
    admission: 'verified-score-and-consensus',
    replayValidation: {
      version: SOLANA_REPLAY_VERSION,
      status: assessment.replayStatus,
      executionStatus: assessment.replayExecutionStatus,
      program: coverageForSolanaProgram(swap.dexProgram).status
    },
    balanceReconciliation: {
      status: reconciliation?.status || assessment.reconciliationStatus,
      reconciled: reconciliation?.reconciled === true
    }
  }));
}

function readShortvec(buf, pos) {
  let val = 0, shift = 0, i = 0;
  while (true) {
    if (pos + i >= buf.length) return null;
    const b = buf[pos + i];
    val |= (b & 0x7f) << shift;
    i++;
    if ((b & 0x80) === 0) break;
    shift += 7;
    if (i > 10) return null;
  }
  return { val, next: pos + i };
}

const SPL_PROGS = new Set([
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
]);

function parseSplData(dataBase58) {
  try {
    const data = Buffer.from(base58Decode(dataBase58));
    if (!data || data.length === 0) return null;
    const tag = data[0];
    if (tag === 3 && data.length >= 9) {
      const amount = data.readBigUInt64LE(1);
      return { tag, amount: amount.toString(), decimals: null };
    }
    if (tag === 12 && data.length >= 10) {
      const amount = data.readBigUInt64LE(1);
      return { tag, amount: amount.toString(), decimals: Number(data[9]) };
    }
  } catch (e) {}
  return null;
}

function buildParsedInstruction(ix, keys) {
  if (!SPL_PROGS.has(ix.programId)) return null;
  const parsedData = parseSplData(ix.data);
  if (!parsedData) return null;
  const accounts = (ix.accounts || []).map(idx => keys[idx] || null).filter(Boolean);
  if (parsedData.tag === 3) {
    return {
      type: 'transfer',
      info: {
        source: accounts[0] || '',
        destination: accounts[1] || '',
        authority: accounts[2] || '',
        tokenAmount: {
          amount: parsedData.amount,
          decimals: parsedData.decimals,
          uiAmountString: null,
          uiAmount: null
        }
      }
    };
  }
  if (parsedData.tag === 12) {
    return {
      type: 'transferChecked',
      info: {
        source: accounts[0] || '',
        mint: accounts[1] || '',
        destination: accounts[2] || '',
        authority: accounts[3] || '',
        tokenAmount: {
          amount: parsedData.amount,
          decimals: parsedData.decimals,
          uiAmountString: null,
          uiAmount: null
        }
      }
    };
  }
  return null;
}

export function normalizeSolanaWireTransaction(payload) {
  if (!payload || typeof payload !== 'object') { return null; }
  const txArr = payload.transaction;
  if (!Array.isArray(txArr) || txArr.length !== 2 || txArr[1] !== 'base64') { return null; }
  let wire;
  try { wire = Buffer.from(txArr[0], 'base64'); } catch (e) { return null; }
  if (!wire || wire.length === 0) { return null; }

  let offset = 0;
  const sigRes = readShortvec(wire, offset);
  if (!sigRes) { return null; }
  const sigCount = sigRes.val;
  offset = sigRes.next;
  if (offset + sigCount * 64 > wire.length) { return null; }
  const signatures = [];
  for (let i = 0; i < sigCount; i++) {
    signatures.push(base58Encode(wire.subarray(offset, offset + 64)));
    offset += 64;
  }

  let version = null;
  let msgOff = offset;
  if (wire[msgOff] & 0x80) {
    version = wire[msgOff] & 0x7f;
    if (version !== 0) return null; // Only version-0 address-table messages are supported.
    msgOff += 1;
  }

  if (msgOff + 3 > wire.length) { return null; }
  msgOff += 3;

  const keyRes = readShortvec(wire, msgOff);
  if (!keyRes) { return null; }
  const keyCount = keyRes.val;
  msgOff = keyRes.next;
  if (msgOff + keyCount * 32 > wire.length) { return null; }
  const staticKeys = [];
  for (let i = 0; i < keyCount; i++) {
    staticKeys.push(base58Encode(wire.subarray(msgOff, msgOff + 32)));
    msgOff += 32;
  }

  if (msgOff + 32 > wire.length) { return null; }
  const recentBlockhash = base58Encode(wire.subarray(msgOff, msgOff + 32));
  msgOff += 32;

  const ixRes = readShortvec(wire, msgOff);
  if (!ixRes) { return null; }
  const ixCount = ixRes.val;
  msgOff = ixRes.next;

  const instructions = [];
  for (let i = 0; i < ixCount; i++) {
    if (msgOff >= wire.length) { return null; }
    const programIdIndex = wire[msgOff++];
    const accRes = readShortvec(wire, msgOff);
    if (!accRes) { return null; }
    const accCount = accRes.val;
    msgOff = accRes.next;
    const accounts = [];
    for (let j = 0; j < accCount; j++) {
      if (msgOff >= wire.length) { return null; }
      accounts.push(wire[msgOff++]);
    }
    const dataRes = readShortvec(wire, msgOff);
    if (!dataRes) { return null; }
    const dataLen = dataRes.val;
    msgOff = dataRes.next;
    if (msgOff + dataLen > wire.length) { return null; }
    const dataBase58 = base58Encode(wire.subarray(msgOff, msgOff + dataLen));
    msgOff += dataLen;
    instructions.push({ programIdIndex, accounts, data: dataBase58 });
  }

  if (version === 0) {
    const lookupRes = readShortvec(wire, msgOff);
    if (lookupRes && lookupRes.val > 0) {
      msgOff = lookupRes.next;
      for (let i = 0; i < lookupRes.val; i++) {
        // Each address-table lookup starts with its 32-byte account key,
        // followed by shortvec lists of writable and readonly indexes.
        if (msgOff + 32 > wire.length) return null;
        msgOff += 32;
        const wRes = readShortvec(wire, msgOff);
        if (!wRes) { msgOff = wire.length; break; }
        msgOff = wRes.next + wRes.val;
        const rRes = readShortvec(wire, msgOff);
        if (!rRes) { msgOff = wire.length; break; }
        msgOff = rRes.next + rRes.val;
      }
    } else {
      msgOff = wire.length;
    }
  }

  if (msgOff !== wire.length) { return null; }

  // Build full key list
  const meta = payload.meta || {};
  const loaded = meta.loadedAddresses || {};
  const writableLoaded = Array.isArray(loaded.writable) ? loaded.writable.map(k => String(typeof k === 'string' ? k : (k?.pubkey || k?.toString?.() || ''))).filter(Boolean) : [];
  const readonlyLoaded = Array.isArray(loaded.readonly) ? loaded.readonly.map(k => String(typeof k === 'string' ? k : (k?.pubkey || k?.toString?.() || ''))).filter(Boolean) : [];
  const allKeys = [...staticKeys, ...writableLoaded, ...readonlyLoaded];

  // Build message instructions with resolved keys and parsed SPL
  const messageInstructions = instructions.map(ix => {
    const keys = allKeys;
    const programId = (Number.isInteger(ix.programIdIndex) && keys[ix.programIdIndex]) ? keys[ix.programIdIndex] : null;
    const accKeys = ix.accounts.map(idx => (Number.isInteger(idx) && keys[idx]) ? keys[idx] : null).filter(Boolean);
    const parsed = buildParsedInstruction({ programId, accounts: ix.accounts, data: ix.data }, allKeys);
    const result = {
      programIdIndex: ix.programIdIndex,
      accounts: ix.accounts,
      data: ix.data,
      stackHeight: 1,
      programId
    };
    if (parsed) result.parsed = parsed;
    return result;
  });

  // Process meta innerInstructions similarly
  const metaCopy = JSON.parse(JSON.stringify(meta));
  if (Array.isArray(metaCopy.innerInstructions)) {
    for (const group of metaCopy.innerInstructions) {
      if (Array.isArray(group.instructions)) {
        for (const ix of group.instructions) {
          const parsed = buildParsedInstruction({ programId: (typeof ix.programId === 'string' ? ix.programId : (Number.isInteger(ix.programIdIndex) ? allKeys[ix.programIdIndex] : null)), accounts: Array.isArray(ix.accounts) ? ix.accounts : [], data: ix.data || '' }, allKeys);
          if (parsed) ix.parsed = parsed;
          // Ensure programId resolved if index given
          if (typeof ix.programId !== 'string' && Number.isInteger(ix.programIdIndex)) {
            ix.programId = (allKeys[ix.programIdIndex]) || ix.programId;
          }
        }
      }
    }
  }

  // Build transaction object compatible with replay
  const transaction = {
    signatures,
    message: {
      // Keep static keys here: Solana accountIndex references resolve as
      // static keys + loaded writable + loaded readonly. accountKeyStrings()
      // appends meta.loadedAddresses, so embedding them here would duplicate
      // the lookup-table keys and misattribute token-account owners.
      accountKeys: staticKeys,
      recentBlockhash,
      instructions: messageInstructions,
      addressTableLookups: version === 0 ? [] : undefined
    }
  };

  return {
    slot: payload.slot ?? null,
    blockTime: payload.blockTime ?? payload.timestampSeconds ?? null,
    transaction,
    meta: metaCopy
  };
}
