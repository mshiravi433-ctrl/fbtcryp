import express from 'express';

export function structuredProductsRouter() {
  const router = express.Router();

  router.get('/products', (req, res) => {
    res.json({
      ok: true,
      data: [
        { id: 'sp-1', type: 'principal_protected', asset: 'USDC', expectedReturn: 0.08, lockPeriod: '30d', status: 'IMPLEMENTED_NOT_CONNECTED' },
        { id: 'sp-2', type: 'dual_investment', asset: 'BTC/USDT', expectedReturn: 0.15, lockPeriod: '7d', status: 'IMPLEMENTED_NOT_CONNECTED' }
      ]
    });
  });

  router.post('/invest', (req, res) => {
    res.json({ ok: false, status: 'UNAVAILABLE', error: 'PROVIDER_REQUIRED', message: 'Execution requires a live structured product provider.' });
  });

  return router;
}
