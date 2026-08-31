/**
 * INTENT ANCHOR FAIL-SAFE PROBE (Track A / Phase 6)
 * ---------------------------------------------------------------------------
 * Locks the additive, fail-safe contract of the optional on-chain anchors:
 *
 *   · network config parsing is fail-closed: empty env, invalid chainId,
 *     non-https RPC, zero-address contract and duplicate chains all vanish
 *     instead of half-configuring anything, and the public projection never
 *     leaks the server-side rpcUrl
 *   · an anchor claim verifies ONLY against a successful receipt, the exact
 *     configured contract, the exact event tuple, a plausible block and the
 *     configured confirmation threshold — anything else returns a typed
 *     refusal, never a partial "verified"
 *   · RPC outage, a failed receipt, an unmined tx, a foreign contract, a
 *     mismatching event, a reorg-shaped block response and an insufficient
 *     confirmation count each fail with their own code
 *   · a FAILED anchor never invalidates the signed auction close — the close
 *     still verifies and the auction state stays closed
 *   · anchor storage is idempotent: a duplicate submit returns the stored
 *     record (alreadyAnchored) instead of a second, conflicting document
 *   · the Merkle-root anchor obeys the same rules end to end
 *
 * Everything runs in-process against the real modules with an injected fake
 * RPC. No network, no real chain, no keys beyond throwaway Ed25519 test keys.
 */

import { Interface } from 'ethers';
import {
  generateSolverKeyPair,
  signSolverCommitment
} from '../server/intentSignatures.js';
import { appendSignedCommitment, merkleRoot } from '../server/intentTransparency.js';
import {
  AUCTION_POLICY,
  closeAuction,
  readAuction,
  storeAuctionAnchor,
  verifyAuctionClose
} from '../server/intentAuctions.js';
import {
  AUCTION_ANCHOR_CLAIM_SCHEMA,
  INTENT_ANCHOR_ABI,
  buildAnchorCalldata,
  parseAnchorNetworks,
  publicAnchorNetworks,
  verifyAnchorClaim
} from '../server/intentAnchors.js';
import {
  MERKLE_ROOT_ANCHOR_CLAIM_SCHEMA,
  buildMerkleRootManifest,
  parseMerkleAnchorNetworks,
  publicMerkleAnchorNetworks,
  readMerkleRootAnchor,
  storeMerkleRootAnchor,
  verifyMerkleRootAnchorClaim
} from '../server/intentRootAnchors.js';

const CONTRACT = `0x${'ab'.repeat(20)}`;
const OTHER_CONTRACT = `0x${'cd'.repeat(20)}`;
const ANCHORER = `0x${'ee'.repeat(20)}`;
const TX = `0x${'42'.repeat(32)}`;
const BLOCK_HASH = `0x${'43'.repeat(32)}`;

const networksFor = (minConfirmations = 2) => new Map([[8453, {
  chainId: 8453,
  name: 'Probe Base',
  contract: CONTRACT,
  rpcUrl: 'https://rpc.invalid',
  explorerBaseUrl: 'https://explorer.invalid',
  minConfirmations
}]]);

/** Fake RPC factory: receipt + head are injectable per scenario. */
const rpcWith = (receipt, headHex = '0x70') => async (_network, method) => {
  if (method === 'eth_blockNumber') return headHex;
  if (method === 'eth_getTransactionReceipt') return receipt;
  throw new Error(`unexpected method ${method}`);
};

const goodReceipt = (logs) => ({
  status: '0x1',
  transactionHash: TX,
  blockNumber: '0x64',
  blockHash: BLOCK_HASH,
  logs
});

export default async function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);

  /* ------------------- 1. fail-closed network config parsing ------------- */
  {
    t('an empty anchor env parses to zero networks (the honest default)',
      parseAnchorNetworks('').size === 0 && parseMerkleAnchorNetworks('').size === 0);
    t('malformed JSON parses to zero networks instead of throwing',
      parseAnchorNetworks('{nope').size === 0 && parseMerkleAnchorNetworks('[[[').size === 0);
    const row = { chainId: 8453, name: 'Base', contract: CONTRACT, rpcUrl: 'https://rpc.example', minConfirmations: 12 };
    t('a well-formed row configures exactly one network with its confirmation floor', (() => {
      const parsed = parseAnchorNetworks(JSON.stringify([row]));
      const network = parsed.get(8453);
      return parsed.size === 1 && network.minConfirmations === 12 && network.contract.toLowerCase() === CONTRACT;
    })());
    t('simple deployed anchor env infers one configured network', (() => {
      const old = {
        address: process.env.INTENT_ANCHOR_ADDRESS,
        chain: process.env.INTENT_ANCHOR_CHAIN_ID,
        rpc: process.env.INTENT_ANCHOR_RPC_URL
      };
      process.env.INTENT_ANCHOR_ADDRESS = CONTRACT;
      process.env.INTENT_ANCHOR_CHAIN_ID = '8453';
      process.env.INTENT_ANCHOR_RPC_URL = 'https://rpc.example';
      const parsed = parseAnchorNetworks('');
      if (old.address === undefined) delete process.env.INTENT_ANCHOR_ADDRESS; else process.env.INTENT_ANCHOR_ADDRESS = old.address;
      if (old.chain === undefined) delete process.env.INTENT_ANCHOR_CHAIN_ID; else process.env.INTENT_ANCHOR_CHAIN_ID = old.chain;
      if (old.rpc === undefined) delete process.env.INTENT_ANCHOR_RPC_URL; else process.env.INTENT_ANCHOR_RPC_URL = old.rpc;
      const network = parsed.get(8453);
      return parsed.size === 1 && network?.contract.toLowerCase() === CONTRACT && /basescan/.test(network?.explorerBaseUrl || '') && network?.minConfirmations === 12;
    })());
    t('an unsupported chainId is dropped, not half-configured',
      parseAnchorNetworks(JSON.stringify([{ ...row, chainId: 424242 }])).size === 0
        && parseMerkleAnchorNetworks(JSON.stringify([{ ...row, chainId: 424242 }])).size === 0);
    t('a non-integer chainId is dropped',
      parseAnchorNetworks(JSON.stringify([{ ...row, chainId: '8453.5' }])).size === 0);
    t('a plain-http RPC url is refused (secrets and receipts ride https only)',
      parseAnchorNetworks(JSON.stringify([{ ...row, rpcUrl: 'http://rpc.example' }])).size === 0);
    t('the zero address can never be configured as an anchor contract',
      parseAnchorNetworks(JSON.stringify([{ ...row, contract: `0x${'0'.repeat(40)}` }])).size === 0);
    t('a duplicate chainId keeps the first row instead of silently replacing it', (() => {
      const parsed = parseAnchorNetworks(JSON.stringify([row, { ...row, contract: OTHER_CONTRACT }]));
      return parsed.size === 1 && parsed.get(8453).contract.toLowerCase() === CONTRACT;
    })());
    t('confirmation floors are clamped into [1,128] rather than trusted raw', (() => {
      const low = parseAnchorNetworks(JSON.stringify([{ ...row, minConfirmations: -5 }])).get(8453);
      const high = parseAnchorNetworks(JSON.stringify([{ ...row, minConfirmations: 100000 }])).get(8453);
      return low.minConfirmations === 1 && high.minConfirmations === 128;
    })());
    t('the public network projection never leaks the server-side rpcUrl', (() => {
      const auction = publicAnchorNetworks(parseAnchorNetworks(JSON.stringify([row])));
      const merkle = publicMerkleAnchorNetworks(parseMerkleAnchorNetworks(JSON.stringify([row])));
      return auction.length === 1 && !('rpcUrl' in auction[0])
        && merkle.length === 1 && !('rpcUrl' in merkle[0]);
    })());
  }

  /* -------- 2. a real signed close, then every anchor failure mode ------- */
  {
    const nowMs = Date.now();
    const now = Math.floor(nowMs / 1000);
    const keys = generateSolverKeyPair();
    const solver = { id: 'anchor-probe-solver', name: 'Anchor Probe Solver', publicKey: keys.publicKey, active: true };
    const registry = new Map([[solver.id, solver]]);
    const intentHash = `0x${'a7'.repeat(32)}`;

    const prevId = process.env.INTENT_COORDINATOR_ID;
    const prevKey = process.env.INTENT_COORDINATOR_PRIVATE_KEY;
    process.env.INTENT_COORDINATOR_ID = 'anchor-probe-coordinator';
    process.env.INTENT_COORDINATOR_PRIVATE_KEY = keys.privateKey;
    try {
      const commitment = signSolverCommitment({
        schema: 'fbt.solver-quote.v1', intentHash, solverId: solver.id,
        chainId: 8453, amountOut: '1000', maxGas: '250000', feeBps: 70, slippageBps: 50,
        executable: true, issuedAt: now, validUntil: now + 90,
        nonce: `0x${'a8'.repeat(16)}`, routeCommitment: `0x${'a9'.repeat(32)}`
      }, keys.privateKey);
      const appended = await appendSignedCommitment(commitment, { registry, now: nowMs });
      const closed = await closeAuction({
        schema: 'fbt.auction-close-request.v1',
        intentHash,
        policy: { id: AUCTION_POLICY, chainId: 8453, maxFeeBps: 70, maxSlippageBps: 50 }
      }, { now: nowMs });
      t('the probe auction closes with a coordinator-signed receipt',
        appended.ok && closed.ok && verifyAuctionClose(closed.close));
      const close = closed.close;
      const networks = networksFor(2);
      const iface = new Interface(INTENT_ANCHOR_ABI);
      const exactEvent = iface.encodeEventLog(iface.getEvent('AuctionRootAnchored'), [
        close.closeId, close.intentHash, close.logRoot,
        BigInt(close.logSize), BigInt(close.closedAt), ANCHORER
      ]);
      const exactLog = { address: CONTRACT, topics: exactEvent.topics, data: exactEvent.data };
      const claim = { schema: AUCTION_ANCHOR_CLAIM_SCHEMA, chainId: 8453, txHash: TX };

      /* -- calldata is only built for configured networks ----------------- */
      t('anchor calldata refuses an unconfigured chain',
        buildAnchorCalldata(close, 1, networks).code === 'ANCHOR_NETWORK_NOT_CONFIGURED');
      t('anchor calldata for the configured chain binds the exact contract', (() => {
        const calldata = buildAnchorCalldata(close, 8453, networks);
        return calldata.ok && calldata.to.toLowerCase() === CONTRACT && calldata.externallyAnchored === false;
      })());

      /* -- claim shape is fail-closed ------------------------------------- */
      t('an unknown claim field is refused rather than ignored',
        (await verifyAnchorClaim(close, { ...claim, gasRefund: true }, { networks, rpc: rpcWith(goodReceipt([exactLog])) })).code === 'UNKNOWN_ANCHOR_FIELD');
      t('a claim for an unconfigured chain is refused before any RPC call',
        (await verifyAnchorClaim(close, { ...claim, chainId: 1 }, {
          networks, rpc: async () => { throw new Error('must not be called'); }
        })).code === 'ANCHOR_NETWORK_NOT_CONFIGURED');
      t('a malformed transaction hash is refused before any RPC call',
        (await verifyAnchorClaim(close, { ...claim, txHash: '0x1234' }, {
          networks, rpc: async () => { throw new Error('must not be called'); }
        })).code === 'BAD_ANCHOR_TX');

      /* -- RPC outage ------------------------------------------------------ */
      const outage = await verifyAnchorClaim(close, claim, {
        networks, rpc: async () => { throw new Error('ECONNRESET'); }
      });
      t('an RPC outage is a typed retryable refusal, never a verified anchor',
        outage.code === 'ANCHOR_RPC_UNAVAILABLE' && !outage.ok);

      /* -- unmined / failed / mismatching receipts ------------------------- */
      t('an unmined transaction stays pending (ANCHOR_NOT_MINED)',
        (await verifyAnchorClaim(close, claim, { networks, rpc: rpcWith(null) })).code === 'ANCHOR_NOT_MINED');
      t('a reverted transaction is refused (receipt status 0x0)',
        (await verifyAnchorClaim(close, claim, {
          networks, rpc: rpcWith({ ...goodReceipt([exactLog]), status: '0x0' })
        })).code === 'ANCHOR_TX_FAILED');
      t('a receipt for a different transaction hash is refused',
        (await verifyAnchorClaim(close, claim, {
          networks, rpc: rpcWith({ ...goodReceipt([exactLog]), transactionHash: `0x${'99'.repeat(32)}` })
        })).code === 'ANCHOR_TX_MISMATCH');

      /* -- wrong contract / wrong event / wrong tuple ---------------------- */
      t('the exact event from a FOREIGN contract address does not count',
        (await verifyAnchorClaim(close, claim, {
          networks, rpc: rpcWith(goodReceipt([{ ...exactLog, address: OTHER_CONTRACT }]))
        })).code === 'ANCHOR_EVENT_MISMATCH');
      t('a receipt with no logs at all is an event mismatch',
        (await verifyAnchorClaim(close, claim, {
          networks, rpc: rpcWith(goodReceipt([]))
        })).code === 'ANCHOR_EVENT_MISMATCH');
      const wrongSize = iface.encodeEventLog(iface.getEvent('AuctionRootAnchored'), [
        close.closeId, close.intentHash, close.logRoot,
        BigInt(close.logSize) + 1n, BigInt(close.closedAt), ANCHORER
      ]);
      t('an event whose logSize differs from the signed close is refused',
        (await verifyAnchorClaim(close, claim, {
          networks, rpc: rpcWith(goodReceipt([{ address: CONTRACT, topics: wrongSize.topics, data: wrongSize.data }]))
        })).code === 'ANCHOR_EVENT_MISMATCH');
      const wrongTime = iface.encodeEventLog(iface.getEvent('AuctionRootAnchored'), [
        close.closeId, close.intentHash, close.logRoot,
        BigInt(close.logSize), BigInt(close.closedAt) + 1n, ANCHORER
      ]);
      t('an event whose closedAt differs from the signed close is refused',
        (await verifyAnchorClaim(close, claim, {
          networks, rpc: rpcWith(goodReceipt([{ address: CONTRACT, topics: wrongTime.topics, data: wrongTime.data }]))
        })).code === 'ANCHOR_EVENT_MISMATCH');
      t('a removed (reorged-out) log is ignored',
        (await verifyAnchorClaim(close, claim, {
          networks, rpc: rpcWith(goodReceipt([{ ...exactLog, removed: true }]))
        })).code === 'ANCHOR_EVENT_MISMATCH');

      /* -- reorg-shaped block data + confirmation floor -------------------- */
      t('a head BEHIND the receipt block (reorg shape) is refused, not counted',
        (await verifyAnchorClaim(close, claim, {
          networks, rpc: rpcWith(goodReceipt([exactLog]), '0x10')
        })).code === 'ANCHOR_BLOCK_INVALID');
      t('a receipt without a block hash is refused',
        (await verifyAnchorClaim(close, claim, {
          networks, rpc: rpcWith({ ...goodReceipt([exactLog]), blockHash: null })
        })).code === 'ANCHOR_BLOCK_INVALID');
      const early = await verifyAnchorClaim(close, claim, {
        networks: networksFor(12), rpc: rpcWith(goodReceipt([exactLog]), '0x66')
      });
      t('3 of 12 required confirmations is honestly ANCHOR_NOT_FINAL',
        early.code === 'ANCHOR_NOT_FINAL' && early.confirmations === 3 && early.requiredConfirmations === 12);

      /* -- the one honest success path -------------------------------------- */
      const verified = await verifyAnchorClaim(close, claim, {
        networks: networksFor(12), rpc: rpcWith(goodReceipt([exactLog]), '0x6f'), now: nowMs
      });
      t('receipt + exact contract + exact event + 12 confirmations verifies',
        verified.ok && verified.anchor.verified === true
          && verified.anchor.confirmationsAtVerification === 12
          && verified.anchor.contract.toLowerCase() === CONTRACT
          && verified.anchor.anchorer === ANCHORER);

      /* -- FAIL-SAFE: a failed anchor never touches the signed close -------- */
      t('after every failed anchor attempt the signed close still verifies',
        verifyAuctionClose(close));
      const state = await readAuction(intentHash);
      t('the auction stays closed and unanchored after anchor failures',
        state.status === 'closed' && state.close.closeId === close.closeId && !state.externallyAnchored);

      /* -- idempotent storage: retries converge on ONE record --------------- */
      t('an unverified record can never be stored as an anchor',
        (await storeAuctionAnchor(close, { ...verified.anchor, verified: false })).code === 'BAD_ANCHOR_RECORD');
      const first = await storeAuctionAnchor(close, verified.anchor);
      const retry = await storeAuctionAnchor(close, verified.anchor);
      t('the first verified anchor stores exactly once',
        first.ok && first.alreadyAnchored === false);
      t('a duplicate submit is idempotent: alreadyAnchored, same stored record',
        retry.ok && retry.alreadyAnchored === true
          && retry.anchor.txHash === first.anchor.txHash
          && retry.anchor.closeId === close.closeId);
      const anchoredState = await readAuction(intentHash);
      t('the stored anchor surfaces on auction state without altering the close',
        anchoredState.externallyAnchored === true
          && verifyAuctionClose(anchoredState.close));
    } finally {
      if (prevId === undefined) delete process.env.INTENT_COORDINATOR_ID;
      else process.env.INTENT_COORDINATOR_ID = prevId;
      if (prevKey === undefined) delete process.env.INTENT_COORDINATOR_PRIVATE_KEY;
      else process.env.INTENT_COORDINATOR_PRIVATE_KEY = prevKey;
    }
  }

  /* ----------- 3. the Merkle-root anchor obeys the same contract --------- */
  {
    const hashes = [`0x${'61'.repeat(32)}`, `0x${'62'.repeat(32)}`];
    const log = {
      schema: 'fbt.transparency-log.v1',
      intentHash: `0x${'63'.repeat(32)}`,
      root: merkleRoot(hashes),
      size: hashes.length,
      entries: hashes.map((entryHash) => ({ entryHash }))
    };
    const built = buildMerkleRootManifest(log);
    t('a manifest only builds from a recomputed, matching transparency log',
      built.ok && buildMerkleRootManifest({ ...log, size: 3 }).ok === false);
    const manifest = built.manifest;
    const networks = networksFor(2);
    const claim = {
      schema: MERKLE_ROOT_ANCHOR_CLAIM_SCHEMA,
      rootId: manifest.rootId,
      chainId: 8453,
      txHash: TX
    };
    const iface = new Interface([
      'event MerkleRootAnchored(bytes32 indexed rootId, bytes32 indexed intentHash, bytes32 indexed merkleRoot, uint64 logSize, address anchorer)'
    ]);
    const exact = iface.encodeEventLog(iface.getEvent('MerkleRootAnchored'), [
      manifest.rootId, manifest.intentHash, manifest.merkleRoot, BigInt(manifest.logSize), ANCHORER
    ]);
    const exactLog = { address: CONTRACT, topics: exact.topics, data: exact.data };

    t('a Merkle claim with a foreign rootId is refused before any RPC call',
      (await verifyMerkleRootAnchorClaim(manifest, { ...claim, rootId: `0x${'99'.repeat(32)}` }, {
        networks, rpc: async () => { throw new Error('must not be called'); }
      })).code === 'BAD_MERKLE_ANCHOR_CLAIM');
    t('a Merkle-anchor RPC outage is typed and retryable',
      (await verifyMerkleRootAnchorClaim(manifest, claim, {
        networks, rpc: async () => { throw new Error('ETIMEDOUT'); }
      })).code === 'MERKLE_ANCHOR_RPC_UNAVAILABLE');
    t('a reverted Merkle-anchor transaction is refused',
      (await verifyMerkleRootAnchorClaim(manifest, claim, {
        networks, rpc: rpcWith({ ...goodReceipt([exactLog]), status: '0x0' })
      })).code === 'MERKLE_ANCHOR_TX_FAILED');
    t('the exact Merkle event from a foreign contract does not count',
      (await verifyMerkleRootAnchorClaim(manifest, claim, {
        networks, rpc: rpcWith(goodReceipt([{ ...exactLog, address: OTHER_CONTRACT }]))
      })).code === 'MERKLE_ANCHOR_EVENT_MISMATCH');
    const short = await verifyMerkleRootAnchorClaim(manifest, claim, {
      networks: networksFor(12), rpc: rpcWith(goodReceipt([exactLog]), '0x66')
    });
    t('a Merkle anchor below its confirmation floor stays MERKLE_ANCHOR_NOT_FINAL',
      short.code === 'MERKLE_ANCHOR_NOT_FINAL' && short.requiredConfirmations === 12);
    const verified = await verifyMerkleRootAnchorClaim(manifest, claim, {
      networks, rpc: rpcWith(goodReceipt([exactLog]), '0x70')
    });
    t('the honest Merkle success path still refuses completeness claims',
      verified.ok && verified.anchor.externallyAnchored === true
        && verified.anchor.claims.completenessProven === false
        && verified.anchor.claims.custody === false);
    const first = await storeMerkleRootAnchor(manifest, verified.anchor);
    const retry = await storeMerkleRootAnchor(manifest, verified.anchor);
    t('Merkle anchor storage is idempotent under duplicate submits',
      first.ok && first.alreadyAnchored === false && retry.ok && retry.alreadyAnchored === true);
    const readBack = await readMerkleRootAnchor(manifest);
    t('the stored Merkle anchor reads back as the exact stored record',
      readBack.anchor && readBack.anchor.txHash === TX.toLowerCase());
  }

  return rows;
}
