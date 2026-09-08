import express from 'express';

export function paymentsOsRouter() {
  const router = express.Router();

  router.post('/send', (req, res) => {
    res.json({ ok: false, status: 'UNAVAILABLE', error: 'WALLET_REQUIRED', message: 'Send requires wallet signature.' });
  });

  router.get('/merchant/quote', (req, res) => {
    res.json({ ok: false, status: 'UNAVAILABLE', error: 'PROVIDER_REQUIRED', message: 'Merchant payments require a live payment gateway.' });
  });

  router.post('/card/issue', (req, res) => {
    res.json({ ok: false, status: 'UNAVAILABLE', error: 'PROVIDER_REQUIRED', message: 'Card issuance requires a BIN sponsor (e.g. Stripe, BaaS provider).' });
  });

  return router;
}
