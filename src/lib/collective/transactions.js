import { Contract, getAddress, parseUnits } from 'ethers';
import { COLLECTIVE_CHAIN_ID } from './constants.js';
import { COLLECTIVE_ERC20_ABI, COLLECTIVE_VAULT_ABI } from './abi.js';

const isAddress = (value) => typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value);

async function resolveSigner(wallet) {
  if (!wallet?.isConnected || !wallet?.address) throw new Error('WALLET_NOT_CONNECTED');
  const signer = await wallet.ensureSigner?.() || wallet.getSigner?.();
  if (!signer?.provider) throw new Error('WALLET_SIGNER_UNAVAILABLE');
  const network = await signer.provider.getNetwork();
  if (Number(network.chainId) !== COLLECTIVE_CHAIN_ID) throw new Error('WRONG_CHAIN');
  const owner = await signer.getAddress();
  if (String(owner).toLowerCase() !== String(wallet.address).toLowerCase()) throw new Error('WALLET_ACCOUNT_MISMATCH');
  return { signer, owner: getAddress(owner) };
}

async function waitConfirmed(tx) {
  const receipt = await tx.wait(1);
  if (!receipt || Number(receipt.status) !== 1) throw new Error('TRANSACTION_FAILED');
  return { hash: tx.hash, blockNumber: Number(receipt.blockNumber) };
}

export function parseCollectiveAmount(value, decimals) {
  const input = String(value ?? '').trim();
  if (!/^(?:\d+)(?:\.\d*)?$/.test(input)) throw new Error('INVALID_AMOUNT');
  const parsed = parseUnits(input, Number(decimals));
  if (parsed <= 0n) throw new Error('INVALID_AMOUNT');
  return parsed;
}

/** Exact approval only. A pre-existing nonzero allowance is reset before use. */
export async function depositIntoCollective({ wallet, assetAddress, vaultAddress, amountRaw }) {
  if (!isAddress(assetAddress) || !isAddress(vaultAddress)) throw new Error('BAD_CONTRACT_ADDRESS');
  const amount = BigInt(amountRaw);
  if (amount <= 0n) throw new Error('INVALID_AMOUNT');
  const { signer, owner } = await resolveSigner(wallet);
  const asset = new Contract(assetAddress, COLLECTIVE_ERC20_ABI, signer);
  const vault = new Contract(vaultAddress, COLLECTIVE_VAULT_ABI, signer);
  const onchainAsset = await vault.asset();
  if (String(onchainAsset).toLowerCase() !== assetAddress.toLowerCase()) throw new Error('VAULT_ASSET_MISMATCH');

  let allowance = await asset.allowance(owner, vaultAddress);
  const approvals = [];
  if (allowance !== amount) {
    if (allowance > 0n) approvals.push(await waitConfirmed(await asset.approve(vaultAddress, 0n)));
    approvals.push(await waitConfirmed(await asset.approve(vaultAddress, amount)));
    allowance = await asset.allowance(owner, vaultAddress);
  }
  if (allowance < amount) throw new Error('ALLOWANCE_NOT_SET');

  const deposit = await waitConfirmed(await vault.deposit(amount, owner));
  return { approvals, deposit, amountRaw: amount.toString() };
}

export async function previewCollectiveWithdrawal({ wallet, vaultAddress, assetsRaw }) {
  if (!isAddress(vaultAddress)) throw new Error('BAD_CONTRACT_ADDRESS');
  const assets = BigInt(assetsRaw);
  if (assets <= 0n) throw new Error('INVALID_AMOUNT');
  const { signer } = await resolveSigner(wallet);
  const vault = new Contract(vaultAddress, COLLECTIVE_VAULT_ABI, signer);
  const shares = await vault.previewWithdraw(assets);
  const quotedAssets = await vault.previewRedeem(shares);
  return { sharesRaw: shares.toString(), quotedAssetsRaw: quotedAssets.toString() };
}

export async function requestCollectiveWithdrawal({ wallet, vaultAddress, sharesRaw }) {
  if (!isAddress(vaultAddress)) throw new Error('BAD_CONTRACT_ADDRESS');
  const shares = BigInt(sharesRaw);
  if (shares <= 0n) throw new Error('INVALID_SHARES');
  const { signer } = await resolveSigner(wallet);
  const vault = new Contract(vaultAddress, COLLECTIVE_VAULT_ABI, signer);
  const tx = await vault.requestWithdrawal(shares);
  return { request: await waitConfirmed(tx), sharesRaw: shares.toString() };
}

export async function claimCollectiveIncome({ wallet, vaultAddress, maxEpochs = 12 }) {
  if (!isAddress(vaultAddress)) throw new Error('BAD_CONTRACT_ADDRESS');
  const batch = Math.max(1, Math.min(12, Number(maxEpochs) || 12));
  const { signer } = await resolveSigner(wallet);
  const vault = new Contract(vaultAddress, COLLECTIVE_VAULT_ABI, signer);
  return waitConfirmed(await vault.claimIncome(batch));
}

export async function processCollectiveWithdrawals({ wallet, vaultAddress, maxItems = 20 }) {
  if (!isAddress(vaultAddress)) throw new Error('BAD_CONTRACT_ADDRESS');
  const batch = Math.max(1, Math.min(20, Number(maxItems) || 20));
  const { signer } = await resolveSigner(wallet);
  const vault = new Contract(vaultAddress, COLLECTIVE_VAULT_ABI, signer);
  return waitConfirmed(await vault.processWithdrawals(batch));
}

export async function startCollectiveEpoch({ wallet, vaultAddress }) {
  if (!isAddress(vaultAddress)) throw new Error('BAD_CONTRACT_ADDRESS');
  const { signer } = await resolveSigner(wallet);
  const vault = new Contract(vaultAddress, COLLECTIVE_VAULT_ABI, signer);
  return waitConfirmed(await vault.startFirstEpoch());
}

export async function settleCollectiveEpoch({ wallet, vaultAddress }) {
  if (!isAddress(vaultAddress)) throw new Error('BAD_CONTRACT_ADDRESS');
  const { signer } = await resolveSigner(wallet);
  const vault = new Contract(vaultAddress, COLLECTIVE_VAULT_ABI, signer);
  return waitConfirmed(await vault.settleEpoch());
}
