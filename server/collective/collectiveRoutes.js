/**
 * Express router for /api/collective (ESM)
 */
import express from 'express';
import aiService from './aiStrategyService.js';
import keeper from './collectiveKeeper.js';

const router = express.Router();

const VAULTS = [
  {
    id: 'vault-stable-01',
    name: 'Robinhood USDG Stable Yield',
    symbol: 'fbtUSDG',
    vaultType: 'stable',
    chain: 'Robinhood Chain',
    chainId: 4663,
    assetSymbol: 'USDG',
    assetAddress: '0x2514d344B6F77B0aC18903e144aC6f5F31Bfa924',
    totalAssets: 485200.0,
    sharePrice: 1.054,
    monthlyApy: 8.65,
    lastMonthProfitUSDT: 3490.5,
    userShares: 0,
    claimableRewardUSDT: 0,
    riskLevel: 'Low',
    status: 'Active'
  },
  {
    id: 'vault-farm-02',
    name: 'Robinhood LP Farming & Liquidity',
    symbol: 'fbtFARM',
    vaultType: 'farming',
    chain: 'Robinhood Chain',
    chainId: 4663,
    assetSymbol: 'HOOD-USDG LP',
    assetAddress: '0x3785a9B501B6eF52a420D9Db3038D64a4411132B',
    totalAssets: 320400.0,
    sharePrice: 1.142,
    monthlyApy: 21.4,
    lastMonthProfitUSDT: 5610.0,
    userShares: 0,
    claimableRewardUSDT: 0,
    riskLevel: 'Medium',
    status: 'Active'
  },
  {
    id: 'vault-stocks-03',
    name: 'Robinhood Tokenized Equities Trading',
    symbol: 'fbtSTOCK',
    vaultType: 'stock_trading',
    chain: 'Robinhood Chain',
    chainId: 4663,
    assetSymbol: 'USDG / Equities',
    assetAddress: '0x2514d344B6F77B0aC18903e144aC6f5F31Bfa924',
    totalAssets: 195000.0,
    sharePrice: 1.098,
    monthlyApy: 16.2,
    lastMonthProfitUSDT: 2840.25,
    userShares: 0,
    claimableRewardUSDT: 0,
    riskLevel: 'Medium',
    status: 'Active'
  }
];

router.get('/vaults', (req, res) => {
  res.json({ success: true, vaults: VAULTS });
});

router.get('/ai-radar', async (req, res) => {
  const opportunities = await aiService.scanOpportunities();
  const proposals = aiService.getProposals();
  res.json({ success: true, opportunities, proposals });
});

router.get('/epoch-status', (req, res) => {
  const status = keeper.getKeeperStatus();
  res.json({ success: true, status });
});

router.post('/deposit', (req, res) => {
  const { vaultId, amount } = req.body;
  const numAmount = parseFloat(amount) || 0;
  const vault = VAULTS.find(v => v.id === vaultId);
  if (!vault) return res.status(404).json({ success: false, error: 'Vault not found' });

  vault.totalAssets += numAmount;
  vault.userShares += numAmount / vault.sharePrice;

  res.json({
    success: true,
    message: 'Deposit recorded successfully',
    userShares: vault.userShares,
    totalAssets: vault.totalAssets
  });
});

router.post('/withdraw-request', (req, res) => {
  const { vaultId, shares } = req.body;
  const numShares = parseFloat(shares) || 0;
  const vault = VAULTS.find(v => v.id === vaultId);
  if (!vault) return res.status(404).json({ success: false, error: 'Vault not found' });
  if (vault.userShares < numShares) {
    return res.status(400).json({ success: false, error: 'Insufficient user shares' });
  }

  vault.userShares -= numShares;
  res.json({
    success: true,
    message: 'Withdrawal request queued for the end of the monthly epoch.',
    remainingShares: vault.userShares
  });
});

router.post('/claim', (req, res) => {
  const { vaultId } = req.body;
  const vault = VAULTS.find(v => v.id === vaultId);
  if (!vault) return res.status(404).json({ success: false, error: 'Vault not found' });

  const claimed = vault.claimableRewardUSDT;
  vault.claimableRewardUSDT = 0;
  res.json({ success: true, claimedAmount: claimed, token: 'USDT' });
});

export default router;
