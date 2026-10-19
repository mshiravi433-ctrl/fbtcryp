import express from 'express';
import { defaultCollectiveReader } from './reader.js';
import { defaultCollectiveActivationStatus } from './activation.js';

const noStore = (_req, res, next) => {
  res.set('cache-control', 'no-store, max-age=0');
  res.set('pragma', 'no-cache');
  next();
};

function publicFailure(res, cause) {
  const code = String(cause?.code || 'COLLECTIVE_READ_FAILED');
  const status = Number(cause?.status) || (['BAD_VAULT_ADDRESS', 'BAD_WALLET_ADDRESS', 'BAD_BLOCK_RANGE', 'BLOCK_RANGE_TOO_LARGE', 'BLOCK_RANGE_BEFORE_DEPLOYMENT', 'BLOCK_RANGE_AFTER_HEAD'].includes(code) ? 400 : code === 'VAULT_NOT_REGISTERED' ? 404 : 503);
  return res.status(status).json({ error: code, available: false });
}

function route(handler) {
  return async (req, res) => {
    try {
      const payload = await handler(req);
      return res.json(payload);
    } catch (cause) {
      return publicFailure(res, cause);
    }
  };
}

export function createCollectiveRouter({
  reader = defaultCollectiveReader,
  activation = defaultCollectiveActivationStatus
} = {}) {
  const router = express.Router();
  router.use(noStore);

  // Public, read-only activation status. It answers "is the keyless pipeline
  // actually green, and what is the single next step?" without exposing a key,
  // an RPC credential or any server secret. See server/collective/activation.js.
  router.get('/activation', route(() => activation.get()));

  router.get('/status', route(() => reader.status()));
  router.get('/vaults', route(() => reader.listVaults().then((vaults) => ({
    schema: 'fbt.collective.vault-list.v1',
    count: vaults.length,
    vaults
  }))));
  router.get('/vault/:address', route((req) => reader.getVault(req.params.address)));
  router.get('/vault/:address/position/:wallet', route((req) => reader.getPosition(req.params.address, req.params.wallet)));
  router.get('/vault/:address/events', route((req) => reader.getEvents(req.params.address, {
    fromBlock: req.query.fromBlock,
    toBlock: req.query.toBlock,
    walletAddress: req.query.wallet
  })));
  router.get('/vault/:address/proposals', route((req) => reader.getProposals(req.params.address)));

  // All transaction-producing paths are wallet/keeper-signed and on-chain.
  // The API intentionally has no write, broadcast, or private-key endpoint.
  return router;
}

export function registerCollectiveRoutes(app, options = {}) {
  app.use('/api/collective', createCollectiveRouter(options));
}
