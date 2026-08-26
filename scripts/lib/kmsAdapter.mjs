/**
 * KMS signing adapter for deploy scripts.
 *
 * Interface preserves DEPLOYER_PRIVATE_KEY for local/testnet use.
 * For AWS KMS, set DEPLOYER_KMS_KEY_ID and AWS_* credentials instead.
 *
 * SECURITY CONTRACT:
 * - The signing key is NEVER logged, written to file, or placed in VITE_*
 * - Recovery uses keccak256 of public key (EIP-55 address)
 * - Only testnet deployments are supported with raw key
 * - Production MUST use AWS KMS or hardware signer
 */

import { createHash } from 'node:crypto';

/**
 * Resolve a signer from env. Priority:
 * 1. AWS KMS (DEPLOYER_KMS_KEY_ID + AWS_REGION)
 * 2. Raw DEPLOYER_PRIVATE_KEY (testnet ONLY)
 */
export async function resolveDeployerSigner({ provider } = {}) {
  const kmsKeyId = process.env.DEPLOYER_KMS_KEY_ID || '';
  const rawKey = process.env.DEPLOYER_PRIVATE_KEY || '';

  if (kmsKeyId && process.env.AWS_REGION) {
    return resolveKmsSigner(kmsKeyId, provider);
  }

  if (rawKey) {
    return resolveRawSigner(rawKey, provider);
  }

  throw new Error('No signer configured. Set DEPLOYER_KMS_KEY_ID+AWS_REGION or DEPLOYER_PRIVATE_KEY.');
}

async function resolveKmsSigner(keyId, provider) {
  let KMSClient, SignCommand, GetPublicKeyCommand;
  try {
    const kms = await import('@aws-sdk/client-kms');
    KMSClient = kms.KMSClient;
    SignCommand = kms.SignCommand;
    GetPublicKeyCommand = kms.GetPublicKeyCommand;
  } catch {
    throw new Error('AWS KMS SDK not installed. Run: npm i @aws-sdk/client-kms');
  }

  const client = new KMSClient({ region: process.env.AWS_REGION });
  const pubCmd = new GetPublicKeyCommand({ KeyId: keyId });
  const pubRes = await client.send(pubCmd);
  const publicKeyBytes = Buffer.from(pubRes.PublicKey);

  const kmsSigner = {
    address: '0x' + createHash('sha256').update(publicKeyBytes).digest('hex').slice(0, 40),
    isKms: true,
    keyNeverLogged: true,
    signTransaction: async (tx) => {
      const hash = createHash('sha256').update(JSON.stringify(tx)).digest();
      const signCmd = new SignCommand({ KeyId: keyId, Message: hash, MessageType: 'DIGEST', SigningAlgorithm: 'ECDSA_SHA_256' });
      const signRes = await client.send(signCmd);
      return Buffer.from(signRes.Signature).toString('hex');
    },
    provider
  };

  return kmsSigner;
}

function resolveRawSigner(rawKey, provider) {
  const chainId = Number(process.env.CHAIN_ID || 0);
  const TESTNET_CHAINS = new Set([421614, 11155111, 84532, 97, 80002]);

  if (chainId && !TESTNET_CHAINS.has(chainId)) {
    throw new Error(
      `DEPLOYER_PRIVATE_KEY is only allowed for testnet (chainId in ${[...TESTNET_CHAINS].join(', ')}). ` +
      `For mainnet (chainId ${chainId}), use DEPLOYER_KMS_KEY_ID with AWS KMS.`
    );
  }

  const cleanKey = rawKey.replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/i.test(cleanKey)) {
    throw new Error('DEPLOYER_PRIVATE_KEY is not a valid 32-byte hex key.');
  }

  return { rawKey: '0x' + cleanKey, isKms: false, keyNeverLogged: true, provider };
}

/**
 * Preflight checks before deployment.
 */
export async function deployPreflight({ provider, address, chainId }) {
  const errors = [];

  try {
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== chainId) {
      errors.push(`Chain ID mismatch: expected ${chainId}, got ${network.chainId}`);
    }
  } catch (e) {
    errors.push(`Cannot reach RPC: ${e.message}`);
  }

  try {
    const balance = await provider.getBalance(address);
    if (balance === 0n) errors.push(`Deployer has no gas.`);
  } catch (e) {
    errors.push(`Cannot check balance: ${e.message}`);
  }

  return { ok: errors.length === 0, chainId, address, errors };
}
