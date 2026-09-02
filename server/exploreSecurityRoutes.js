/**
 * ROUTE MOUNTS — Explore + Security Center HTTP surface.
 *
 * Shape contract shared by every endpoint here:
 *   200 { data, meta }                      — meta.source / updatedAt / freshness
 *   200 { data, meta, dataStatus:'empty'|'partial'|'unavailable', notices }
 *   400 { error: { code, retryable:false } } — bad input
 *   503 { error: { code, retryable:true } }  — every upstream failed
 *
 * Rules enforced by construction:
 *   · GET only — no POST/PUT/DELETE routes exist in this file. These pages
 *     observe; they never act. Revoke (the one state-changing action the
 *     Security UI offers) is signed by the user's own wallet through the
 *     existing swap-layer plumbing, NOT here.
 *   · No Intent OS module is imported; nothing under /api/v1/security feeds
 *     any execution path — the pages are clients of these routes, not the
 *     other way round.
 *   · Errors carry machine codes the client maps to localized copy; no raw
 *     upstream message is surfaced to the user, and no secret/host config is
 *     echoed.
 *   · Failures degrade the affected rows to `unavailable` with a `notices`
 *     entry, so "provider down" never renders as a confident zero or a fake
 *     "safe".
 */

import {
  CHAIN_IDS, IntelError, isAddress, isTxHash, recordIntelEvent
} from './chainIntel.js';
import {
  classifyQuery, contractProfile, exploreSearch, networksStatus, protocolDetail,
  protocolList, registryTokens, tokenProfile, transactionDetail, trendingBuckets,
  walletProfile, walletScan
} from './explorerData.js';
import {
  analyzeContract, analyzeProtocol, analyzeToken, approvalsForWallet,
  securityActivity, securityAlerts, securityOverview, securityScoreQuery
} from './securityIntel.js';

const ok = (res, out, { maxAge = 20 } = {}) => {
  const secs = Math.min(3600, maxAge);
  res.set('cache-control', `public, max-age=${secs}, s-maxage=${secs}, stale-while-revalidate=${secs * 4}`);
  return res.json(out);
};

const fail = (res, err) => {
  const code = err?.code || (err?.name === 'AbortError' ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_FAILED');
  if (code === 'BAD_ADDRESS' || code === 'BAD_HASH' || code === 'BAD_SLUG' || code === 'BAD_INPUT' || code === 'UNSUPPORTED_CHAIN' || code === 'NO_WALLET') {
    return res.status(400).json({ error: { code, retryable: false } });
  }
  return res.status(503).json({ error: { code: code === 'RPC_UNAVAILABLE' ? 'DATA_TEMPORARILY_UNAVAILABLE' : 'DATA_SOURCE_UNAVAILABLE', retryable: true, detail: String(err?.detail || '').slice(0, 120) || undefined } });
};

const needChain = (req, res) => {
  const c = Number(req.query.chain);
  if (!Number.isInteger(c) || !CHAIN_IDS.includes(c)) {
    res.status(400).json({ error: { code: 'UNSUPPORTED_CHAIN', retryable: false, supported: CHAIN_IDS } });
    return null;
  }
  return c;
};

export function registerExploreRoutes(app) {
  /* ------------------------------ Search -------------------------------- */
  app.get('/api/v1/explore/search', async (req, res) => {
    try {
      const q = String(req.query.q || '');
      if (!q.trim()) return ok(res, { data: { kind: 'empty', results: [] }, meta: { source: 'none', updatedAt: new Date().toISOString(), freshness: 'EXACT' } }, { maxAge: 5 });
      const out = await exploreSearch(q, { chain: req.query.chain === 'all' ? 'all' : req.query.chain ? Number(req.query.chain) : 'all' });
      return ok(res, out, { maxAge: 15 });
    } catch (err) { return fail(res, err); }
  });

  app.get('/api/v1/explore/classify', (req, res) => {
    return res.json({ data: classifyQuery(req.query.q || '') });
  });

  /* ---------------------------- Networks -------------------------------- */
  app.get('/api/v1/explore/networks', async (_req, res) => {
    try {
      const out = await networksStatus();
      return ok(res, out, { maxAge: 30 });
    } catch (err) { return fail(res, err); }
  });

  /* ----------------------------- Wallets -------------------------------- */
  app.get('/api/v1/explore/wallet/:address', async (req, res) => {
    try {
      if (!isAddress(req.params.address)) return fail(res, new IntelError('BAD_ADDRESS', 'address must be 0x + 40 hex'));
      if (req.query.scope === 'scan') {
        const out = await walletScan(req.params.address);
        return ok(res, out, { maxAge: 30 });
      }
      const chain = req.query.chain === 'solana' ? 'solana' : needChain(req, res);
      if (chain === null) return undefined;
      const out = await walletProfile(chain === 'solana' ? 'solana' : chain, req.params.address, { includeTransfers: req.query.transfers !== '0' });
      return ok(res, out, { maxAge: 30 });
    } catch (err) { return fail(res, err); }
  });

  /* ------------------------- Transactions ------------------------------- */
  app.get('/api/v1/explore/transactions/:hash', async (req, res) => {
    try {
      if (!isTxHash(req.params.hash)) return fail(res, new IntelError('BAD_HASH', 'hash must be 0x + 64 hex'));
      const chain = req.query.chain ? Number(req.query.chain) : null;
      if (chain != null && !CHAIN_IDS.includes(chain)) return fail(res, new IntelError('UNSUPPORTED_CHAIN', 'chain not in registry'));
      const out = await transactionDetail(req.params.hash, { chainId: chain });
      return ok(res, out, { maxAge: chain ? 60 : 20 });
    } catch (err) { return fail(res, err); }
  });

  /* -------------------------- Contract profile --------------------------- */
  app.get('/api/v1/explore/contracts/:address', async (req, res) => {
    try {
      const chain = needChain(req, res);
      if (chain === null) return undefined;
      if (!isAddress(req.params.address)) return fail(res, new IntelError('BAD_ADDRESS', 'address must be 0x + 40 hex'));
      const out = await contractProfile(chain, req.params.address);
      return ok(res, out, { maxAge: 60 });
    } catch (err) { return fail(res, err); }
  });

  /* ---------------------------- Token profile ---------------------------- */
  app.get('/api/v1/explore/tokens/:address', async (req, res) => {
    try {
      const chain = needChain(req, res);
      if (chain === null) return undefined;
      if (!isAddress(req.params.address)) return fail(res, new IntelError('BAD_ADDRESS', 'address must be 0x + 40 hex'));
      const out = await tokenProfile(chain, req.params.address);
      return ok(res, out, { maxAge: 30 });
    } catch (err) { return fail(res, err); }
  });

  app.get('/api/v1/explore/tokens', async (_req, res) => {
    try {
      const out = await registryTokens();
      return ok(res, out, { maxAge: 45 });
    } catch (err) { return fail(res, err); }
  });

  /* ----------------------------- Protocols ------------------------------- */
  app.get('/api/v1/explore/protocols', async (req, res) => {
    try {
      const out = await protocolList({
        category: req.query.category || null,
        chain: req.query.chain || null,
        q: req.query.q || null,
        sort: ['tvl', 'volume', 'change'].includes(req.query.sort) ? req.query.sort : 'tvl',
        limit: Math.max(1, Math.min(200, Number(req.query.limit) || 48)),
        offset: Math.max(0, Number(req.query.offset) || 0)
      });
      return ok(res, out, { maxAge: 300 });
    } catch (err) { return fail(res, err); }
  });

  app.get('/api/v1/explore/protocols/:id', async (req, res) => {
    try {
      const out = await protocolDetail(req.params.id);
      return ok(res, out, { maxAge: 300 });
    } catch (err) { return fail(res, err); }
  });

  app.get('/api/v1/explore/trending', async (_req, res) => {
    try {
      const out = await trendingBuckets();
      return ok(res, out, { maxAge: 120 });
    } catch (err) { return fail(res, err); }
  });

  recordIntelEvent('routes.mounted', 'explore routes registered (read-only)', 'explore');
}

export function registerSecurityRoutes(app) {
  app.get('/api/v1/security/overview', async (_req, res) => {
    try {
      const out = await securityOverview();
      return ok(res, out, { maxAge: 15 });
    } catch (err) { return fail(res, err); }
  });

  app.get('/api/v1/security/score', async (req, res) => {
    try {
      const chain = req.query.chain ? Number(req.query.chain) : null;
      if (chain != null && !CHAIN_IDS.includes(chain)) return fail(res, new IntelError('UNSUPPORTED_CHAIN', 'chain not in registry'));
      const out = await securityScoreQuery({ chain, address: req.query.address || null, protocol: req.query.protocol || null });
      return ok(res, out, { maxAge: 15 });
    } catch (err) { return fail(res, err); }
  });

  app.get('/api/v1/security/contract/:address', async (req, res) => {
    try {
      const chain = needChain(req, res);
      if (chain === null) return undefined;
      if (!isAddress(req.params.address)) return fail(res, new IntelError('BAD_ADDRESS', 'address must be 0x + 40 hex'));
      recordIntelEvent('analysis.contract', `${chain}/${req.params.address.slice(0, 10)}…`, 'security');
      const out = await analyzeContract(chain, req.params.address);
      return ok(res, out, { maxAge: 30 });
    } catch (err) { return fail(res, err); }
  });

  app.get('/api/v1/security/token/:address', async (req, res) => {
    try {
      const chain = needChain(req, res);
      if (chain === null) return undefined;
      if (!isAddress(req.params.address)) return fail(res, new IntelError('BAD_ADDRESS', 'address must be 0x + 40 hex'));
      recordIntelEvent('analysis.token', `${chain}/${req.params.address.slice(0, 10)}…`, 'security');
      const out = await analyzeToken(chain, req.params.address);
      return ok(res, out, { maxAge: 30 });
    } catch (err) { return fail(res, err); }
  });

  app.get('/api/v1/security/protocol/:id', async (req, res) => {
    try {
      const out = await analyzeProtocol(req.params.id);
      return ok(res, out, { maxAge: 60 });
    } catch (err) { return fail(res, err); }
  });

  app.get('/api/v1/security/approvals/:wallet', async (req, res) => {
    try {
      const chain = needChain(req, res);
      if (chain === null) return undefined;
      if (!isAddress(req.params.wallet)) return fail(res, new IntelError('BAD_ADDRESS', 'wallet must be 0x + 40 hex'));
      const out = await approvalsForWallet(chain, req.params.wallet);
      return ok(res, out, { maxAge: 30 });
    } catch (err) { return fail(res, err); }
  });

  app.get('/api/v1/security/alerts', async (req, res) => {
    try {
      const wallet = isAddress(req.query.wallet || '') ? String(req.query.wallet) : null;
      const chain = req.query.chain ? Number(req.query.chain) : null;
      if (chain != null && !CHAIN_IDS.includes(chain)) return fail(res, new IntelError('UNSUPPORTED_CHAIN', 'chain not in registry'));
      const out = await securityAlerts({ wallet, chainId: chain, limit: Math.max(1, Math.min(200, Number(req.query.limit) || 40)) });
      return ok(res, out, { maxAge: 10 });
    } catch (err) { return fail(res, err); }
  });

  app.get('/api/v1/security/incidents', async (req, res) => {
    try {
      const { hacksIndex } = await import('./explorerData.js');
      const out = await hacksIndex();
      const needle = String(req.query.protocol || '').toLowerCase();
      if (needle && out.data?.incidents) {
        out.data = { ...out.data, incidents: out.data.incidents.filter((h) => (h.protocol || '').toLowerCase().includes(needle)).slice(0, 50) };
      }
      return ok(res, out, { maxAge: 600 });
    } catch (err) { return fail(res, err); }
  });

  app.get('/api/v1/security/activity', async (req, res) => {
    try {
      const out = await securityActivity({ limit: Number(req.query.limit) || 40 });
      return ok(res, out, { maxAge: 5 });
    } catch (err) { return fail(res, err); }
  });

  recordIntelEvent('routes.mounted', 'security routes registered (read-only, advisory)', 'security');
}
