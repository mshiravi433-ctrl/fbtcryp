export const COLLECTIVE_ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)'
];

export const COLLECTIVE_VAULT_ABI = [
  'function asset() view returns (address)',
  'function balanceOf(address) view returns (uint256)',
  'function previewRedeem(uint256) view returns (uint256)',
  'function previewWithdraw(uint256) view returns (uint256)',
  'function deposit(uint256,address) returns (uint256)',
  'function requestWithdrawal(uint256) returns (uint256)',
  'function claimIncome(uint8) returns (uint256)',
  'function processWithdrawals(uint256) returns (uint256,uint256)',
  'function startFirstEpoch()',
  'function settleEpoch() returns (uint64,uint256)'
];
