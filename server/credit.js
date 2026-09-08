import express from 'express';

export function creditRouter() {
  const router = express.Router();

  router.get('/score/:address', (req, res) => {
    res.json({ ok: false, status: 'UNAVAILABLE', error: 'PROVIDER_REQUIRED', message: 'On-chain credit scoring requires integration with a credit oracle (e.g. Spectral, Cred Protocol).' });
  });

  return router;
}
