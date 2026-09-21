/**
 * FBT INTENT PROTOCOL — MERKLE EVIDENCE & VERIFICATION SYSTEM
 * ---------------------------------------------------------------------------
 * Spec §17: Merkle trees, published roots, and transparent proof separation:
 *   OBSERVED -> OPERATOR_REPORTED -> CRYPTOGRAPHICALLY_VERIFIED -> ON_CHAIN_VERIFIED
 */

import { keccak256, toUtf8Bytes } from 'ethers';
import { EVIDENCE_TIERS } from './types.js';
import { canonicalJson } from './intentHashing.js';

/**
 * Hash single evidence event leaf.
 */
export function hashEvidenceLeaf(event) {
  const leafPayload = canonicalJson({
    eventId: event.eventId || event.receiptId || event.intentId,
    type: event.type || 'EXECUTION_RECEIPT',
    data: event
  });
  return keccak256(toUtf8Bytes(leafPayload));
}

/**
 * Combines two hashes deterministically.
 */
function hashPair(left, right) {
  if (!right) return left;
  const sorted = [left, right].sort();
  return keccak256(toUtf8Bytes(sorted[0] + sorted[1]));
}

/**
 * Computes Merkle root and proofs for a list of evidence items.
 */
export class ProtocolMerkleTree {
  constructor(items = []) {
    this.leaves = items.map((item) => (typeof item === 'string' && item.startsWith('0x') ? item : hashEvidenceLeaf(item)));
    this.layers = [];
    this._buildTree();
  }

  _buildTree() {
    if (this.leaves.length === 0) {
      this.root = '0x' + '0'.repeat(64);
      this.layers = [[]];
      return;
    }

    let currentLayer = [...this.leaves];
    this.layers = [currentLayer];

    while (currentLayer.length > 1) {
      const nextLayer = [];
      for (let i = 0; i < currentLayer.length; i += 2) {
        const left = currentLayer[i];
        const right = i + 1 < currentLayer.length ? currentLayer[i + 1] : left;
        nextLayer.push(hashPair(left, right));
      }
      this.layers.push(nextLayer);
      currentLayer = nextLayer;
    }

    this.root = currentLayer[0];
  }

  getRoot() {
    return this.root;
  }

  getProof(leafIndex) {
    if (leafIndex < 0 || leafIndex >= this.leaves.length) {
      return null;
    }

    const proof = [];
    let idx = leafIndex;

    for (let layerIdx = 0; layerIdx < this.layers.length - 1; layerIdx++) {
      const layer = this.layers[layerIdx];
      const isRight = idx % 2 === 1;
      const pairIdx = isRight ? idx - 1 : idx + 1;

      if (pairIdx < layer.length) {
        proof.push(layer[pairIdx]);
      } else {
        proof.push(layer[idx]);
      }

      idx = Math.floor(idx / 2);
    }

    return {
      leaf: this.leaves[leafIndex],
      index: leafIndex,
      root: this.root,
      proof
    };
  }
}

/**
 * Verifies Merkle proof against a known published root.
 */
export function verifyMerkleProof(leaf, proof, root) {
  if (!leaf || !proof || !root) return false;

  let current = leaf;
  for (const sibling of proof) {
    current = hashPair(current, sibling);
  }

  return current.toLowerCase() === root.toLowerCase();
}

/**
 * Classifies evidence tier with strict criteria (never overclaiming).
 */
export function classifyEvidenceTier({
  hasLocalObservation = false,
  hasOperatorSignature = false,
  hasCryptographicProof = false,
  hasConfirmedTxReceipt = false
}) {
  if (hasConfirmedTxReceipt) return EVIDENCE_TIERS.ON_CHAIN_VERIFIED;
  if (hasCryptographicProof) return EVIDENCE_TIERS.CRYPTOGRAPHICALLY_VERIFIED;
  if (hasOperatorSignature) return EVIDENCE_TIERS.OPERATOR_REPORTED;
  return EVIDENCE_TIERS.OBSERVED;
}
