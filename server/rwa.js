import express from 'express';

export function rwaRouter() {
  const router = express.Router();

  router.get('/marketplace', (req, res) => {
    res.json({ ok: false, status: 'UNAVAILABLE', error: 'PROVIDER_REQUIRED', message: 'RWA Marketplace requires Centrifuge, Ondo, or similar integration.' });
  });

  router.post('/tokenize', (req, res) => {
    res.json({ ok: false, status: 'UNAVAILABLE', error: 'PROVIDER_REQUIRED', message: 'Tokenization factory requires legal wrapper and SPV provider.' });
  });

  return router;
}
