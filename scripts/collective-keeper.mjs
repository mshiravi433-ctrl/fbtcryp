#!/usr/bin/env node
/**
 * One-shot, fail-closed Collective keeper. Default mode is read-only. Execution
 * is opt-in through BOTH --execute and COLLECTIVE_KEEPER_ENABLED=true, uses an
 * environment-only key, and can send only the fixed, policy-generated vault
 * actions. It cannot choose a target, router, token, recipient, or raw calldata.
 */
import { Contract, Wallet } from 'ethers';
import { readCollectiveConfig } from '../server/collective/config.js';
import { createCollectiveReader } from '../server/collective/reader.js';
import { VAULT_ABI } from '../server/collective/abi.js';
import { buildCollectiveProposals, isAllowedKeeperAction } from '../server/collective/strategyPolicy.js';

const executeRequested = process.argv.includes('--execute');
const config = readCollectiveConfig();
const reader = createCollectiveReader({ config });
const output = { schema: 'fbt.collective.keeper-run.v1', mode: 'dry-run', startedAt: new Date().toISOString(), vaults: [] };

function safeErrorCode(cause) {
  const code = String(cause?.code || cause?.shortMessage || cause?.message || 'KEEPER_RUN_FAILED');
  return /^[A-Z0-9_:-]{1,80}$/.test(code) ? code : 'KEEPER_RUN_FAILED';
}

async function run() {
  if (!config.configured) throw Object.assign(new Error('COLLECTIVE_NOT_CONFIGURED'), { code: 'COLLECTIVE_NOT_CONFIGURED' });
  const status = await reader.status();
  if (!status.ready) throw Object.assign(new Error(status.reason || 'COLLECTIVE_NOT_READY'), { code: status.reason || 'COLLECTIVE_NOT_READY' });

  const snapshots = await reader.listVaults();
  if (executeRequested && !config.keeperEnabled) {
    throw Object.assign(new Error('KEEPER_EXECUTION_DISABLED'), { code: 'KEEPER_EXECUTION_DISABLED' });
  }
  const secret = String(process.env.COLLECTIVE_KEEPER_PRIVATE_KEY || '').trim();
  let signer = null;
  let provider = await reader.getProvider();
  if (executeRequested) {
    if (!secret) throw Object.assign(new Error('KEEPER_KEY_MISSING'), { code: 'KEEPER_KEY_MISSING' });
    signer = new Wallet(secret, provider);
    if (Number((await provider.getNetwork()).chainId) !== config.chainId) {
      throw Object.assign(new Error('CHAIN_ID_MISMATCH'), { code: 'CHAIN_ID_MISMATCH' });
    }
  }

  output.mode = executeRequested ? 'execute' : 'dry-run';
  for (const snapshot of snapshots) {
    const plan = buildCollectiveProposals(snapshot);
    const entry = { vault: snapshot.address, status: plan.status, reason: plan.reason, proposals: plan.proposals };
    if (executeRequested && plan.proposals.length) {
      const proposal = plan.proposals[0];
      if (!isAllowedKeeperAction(proposal.action)) {
        entry.execution = { status: 'skipped', reason: 'ACTION_NOT_ALLOWLISTED' };
      } else if (['invest', 'liquidateStrategy'].includes(proposal.action) && !(await reader.isKeeper(await signer.getAddress()))) {
        entry.execution = { status: 'skipped', reason: 'KEEPER_ROLE_MISSING' };
      } else {
        const vault = new Contract(snapshot.address, VAULT_ABI, signer);
        const method = vault[proposal.action];
        if (typeof method !== 'function') throw Object.assign(new Error('ACTION_ABI_MISSING'), { code: 'ACTION_ABI_MISSING' });
        const args = proposal.args.map((value) => /^\d+$/.test(value) ? BigInt(value) : value);
        // Estimate against current chain state immediately before sending. This
        // is a simulation only; all contract constraints are checked again.
        const estimate = await method.estimateGas(...args);
        const gasLimit = estimate * 120n / 100n;
        const tx = await method(...args, { gasLimit });
        const receipt = await tx.wait(1);
        entry.execution = {
          status: Number(receipt.status) === 1 ? 'confirmed' : 'failed',
          transactionHash: tx.hash,
          blockNumber: Number(receipt.blockNumber),
          gasUsed: String(receipt.gasUsed || 0n)
        };
      }
    }
    output.vaults.push(entry);
  }
  output.finishedAt = new Date().toISOString();
  console.log(JSON.stringify(output, null, 2));
}

run().catch((cause) => {
  // Never print provider URLs, environment values, or signer material.
  console.error(JSON.stringify({ error: safeErrorCode(cause), mode: executeRequested ? 'execute' : 'dry-run' }));
  process.exitCode = 1;
});
