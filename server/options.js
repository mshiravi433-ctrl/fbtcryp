import express from 'express';

export function optionsRouter() {
  const router = express.Router();

  router.get('/chain', (req, res) => {
    res.json({ ok: false, status: 'UNAVAILABLE', error: 'PROVIDER_REQUIRED', message: 'Options chain requires Deribit or Lyra provider integration.' });
  });

  router.post('/execute', (req, res) => {
    res.json({ ok: false, status: 'UNAVAILABLE', error: 'PROVIDER_REQUIRED', message: 'Options execution requires a live provider.' });
  });

  return router;
}
