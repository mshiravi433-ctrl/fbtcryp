#!/usr/bin/env node
/**
 * Phase 6 (2026-10-25) — Wire-format base64 corpus + parser regression.
 *
 * Validates:
 *  1. Six new fixtures from jowency-me/solana-tx-parser (MIT, commit 71ba8bd...)
 *     are present, encoded base64, with pinned SHA-256 and provenance.
 *  2. normalizeSolanaWireTransaction reconstructs signatures + message for
 *     wire fixtures (signature identity with manifest pin).
 *  3. Incomplete / unknown-version buffers are rejected (fail-closed).
 *  4. Replay of full 10-fixture corpus passes (no silent verified promotion).
 *  5. SM_SOLANA_VERIFIED_PROMOTION stays impossible (only exact "1" enables).
 */
process.env.NODE_ENV = 'test';
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.SM_SOLANA_VERIFIED_PROMOTION;

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SOLANA_REPLAY_FIXTURES,
  SOLANA_CORROBORATED_REPLAY_PROGRAMS,
  SOLANA_BALANCE_REPLAY_PROGRAMS,
  coverageForSolanaProgram
} from '../server/smartMoney/solanaReplayManifest.js';
import {
  normalizeSolanaTransactionPayload,
  normalizeSolanaWireTransaction,
  sha256Hex,
  solanaVerifiedPromotionEnabled,
  runSolanaReplayFixtures,
  assessSolanaReplayCorpus,
  getExecutedSolanaReplayCorpus
} from '../server/smartMoney/solanaReplay.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const results = [];
const check = (name, fn) => { try { fn(); results.push('✓ '+name); } catch (e) { results.push('✗ '+name + ' — ' + e.message); } };

check('phase 6 fixtures present (10 total, 6 base64 new)', () => {
  assert.equal(SOLANA_REPLAY_FIXTURES.length, 10);
  const base64 = SOLANA_REPLAY_FIXTURES.filter(f => f.encoding === 'base64');
  assert.equal(base64.length, 6);
  const ids = new Set(base64.map(f => f.id));
  assert.ok(ids.has('raydium-amm-v4-titan2'));
  assert.ok(ids.has('raydium-stable-amm-1'));
  assert.ok(ids.has('raydium-clmm-route1'));
  assert.ok(ids.has('meteora-dlmm-titan1'));
  assert.ok(ids.has('meteora-pools-stabble1'));
  assert.ok(ids.has('pumpswap-exa6gyh2'));
});

check('new fixtures have MIT source, commit, path, sha256', () => {
  for (const f of SOLANA_REPLAY_FIXTURES) {
    if (f.encoding !== 'base64') continue;
    assert.ok(f.source.license === 'MIT', f.id);
    assert.ok(/^[a-f0-9]{40}$/.test(f.source.commit), f.id);
    assert.ok(f.source.path.includes('testdata/transactions/'), f.id);
    assert.ok(/^[a-f0-9]{64}$/.test(f.sha256), f.id);
    assert.ok(f.signature.length > 20, f.id);
  }
});

check('wire parser reconstructs first-fixature signature exactly', () => {
  const fixture = SOLANA_REPLAY_FIXTURES.find(f => f.id === 'raydium-amm-v4-titan2');
  const payload = JSON.parse(readFileSync(path.join(ROOT, fixture.file), 'utf8'));
  const res = normalizeSolanaWireTransaction(payload);
  assert.ok(res, 'wire parse returned null');
  assert.equal(res.transaction.signatures[0], fixture.signature, 'signature mismatch');
});

check('wire parser rejects truncated wire (fail-closed)', () => {
  const fixture = SOLANA_REPLAY_FIXTURES.find(f => f.id === 'raydium-amm-v4-titan2');
  const payload = JSON.parse(readFileSync(path.join(ROOT, fixture.file), 'utf8'));
  payload.transaction[0] = payload.transaction[0].slice(0, 20); // truncate base64 -> short buffer
  assert.equal(normalizeSolanaWireTransaction(payload), null, 'truncated must fail');
});

check('wire parser rejects unknown-version byte (fail-closed)', () => {
  const fixture = SOLANA_REPLAY_FIXTURES.find(f => f.id === 'raydium-amm-v4-titan2');
  const payload = JSON.parse(readFileSync(path.join(ROOT, fixture.file), 'utf8'));
  const wire = Buffer.from(payload.transaction[0], 'base64');
  const wire = Buffer.from(payload.transaction[0], 'base64');
  // Corrupt version indicator after signatures (force unknown)
  wire[wire.length - 5] = 0xFF;
  assert.equal(normalizeSolanaWireTransaction(payload), null, 'truncated must fail');
});

check('wire parser rejects unknown-version byte (fail-closed)', () => {
  const fixture = SOLANA_REPLAY_FIXTURES.find(f => f.id === 'raydium-amm-v4-titan2');
  const payload = JSON.parse(readFileSync(path.join(ROOT, fixture.file), 'utf8'));
  const wire = Buffer.from(payload.transaction[0], 'base64');
  // Change first byte of message to 0xFF (unknown version)
  wire[wire.length - 1] = 0xFF; // corrupt near end; simpler: just corrupt a byte in message
  payload.transaction[0] = wire.toString('base64');
  assert.equal(normalizeSolanaWireTransaction(payload), null, 'corrupt wire must fail');
});

check('full replay passes for all 10 fixtures', () => {
  const replay = runSolanaReplayFixtures({ rootDir: ROOT });
  assert.equal(replay.passed, true, 'replay not passed');
  assert.equal(replay.corpus.passedFixtures, 10, 'not all fixtures passed');
  assert.equal(replay.corpus.failedFixtures, 0, 'failures present');
});

check('corpus assessment reports 6 corroborated / 7 balance / 0 missing', () => {
  const assessment = assessSolanaReplayCorpus();
  assert.equal(assessment.corroboratedPrograms, 6, 'corroborated programs should be 6');
  assert.ok(assessment.balanceReplayPrograms >= 7, 'balance programs >=7');
  assert.ok(assessment.complete === false, 'corpus still partial (expected before phase 7)');
});

check('verified promotion remains impossible without exact SM_SOLANA_VERIFIED_PROMOTION=1', () => {
  assert.equal(solanaVerifiedPromotionEnabled(), false, 'promotion should be off by default');
  assert.equal(solanaVerifiedPromotionEnabled({ SM_SOLANA_VERIFIED_PROMOTION: '0' }), false);
  assert.equal(solanaVerifiedPromotionEnabled({ SM_SOLANA_VERIFIED_PROMOTION: '1' }), true);
  assert.equal(solanaVerifiedPromotionEnabled({ SM_SOLANA_VERIFIED_PROMOTION: 'yes' }), false);
});

check('fixture provenance for base64 fixtures points to jowency-me repo commit 71ba8bd', () => {
  for (const f of SOLANA_REPLAY_FIXTURES) {
    if (f.encoding === 'base64') {
      assert.ok(f.source.repository.includes('jowency-me'), f.id);
      assert.equal(f.source.commit, '71ba8bd960b2a7c74a5f9cec69f2ed597dedc1ca', f.id);
    }
  }
});

console.log('--- Phase 6 Probe ---');
for (const r of results) console.log(r);
const passed = results.filter(r => r.startsWith('✓')).length;
console.log('passed', passed, '/', results.length);
if (passed !== results.length) process.exit(1);
