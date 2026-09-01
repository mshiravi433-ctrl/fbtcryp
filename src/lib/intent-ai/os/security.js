/**
 * FBT INTENT OS — Security & Performance
 * Spec §37 + §36
 * AI must not see Private Key, Seed Phrase, etc.
 * Only Wallet Address, Balance, Public Position
 */

export const SECURITY_SCHEMA = 'fbt.security.v1';

const FORBIDDEN_KEYS = Object.freeze([
  'privateKey',
  'private_key',
  'seedPhrase',
  'seed_phrase',
  'mnemonic',
  'secret',
  'password',
  'recoveryPhrase',
  'recovery_phrase',
  'rawSecret',
  'raw_secret',
  'keystore',
  'privateKeyHex',
  'passphrase'
]);

const FORBIDDEN_PATTERNS = [
  /0x[a-fA-F0-9]{64}/,
  /[a-z]+\s+[a-z]+\s+[a-z]+\s+[a-z]+\s+[a-z]+\s+[a-z]+\s+[a-z]+\s+[a-z]+\s+[a-z]+\s+[a-z]+\s+[a-z]+\s+[a-z]+/
];

export function containsForbiddenData(obj) {
  if (!obj || typeof obj !== 'object') {
    if (typeof obj === 'string') {
      for (const pat of FORBIDDEN_PATTERNS) {
        if (pat.test(obj) && obj.length > 50) return true;
      }
      return false;
    }
    return false;
  }
  if (Array.isArray(obj)) {
    return obj.some(containsForbiddenData);
  }
  for (const key of Object.keys(obj)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_KEYS.some(f => lower.includes(f.toLowerCase()))) return true;
    if (containsForbiddenData(obj[key])) return true;
  }
  return false;
}

export function sanitizeForAI(data) {
  if (!data || typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map(sanitizeForAI);
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_KEYS.some(f => lower.includes(f.toLowerCase()))) continue;
    out[key] = typeof value === 'object' && value !== null ? sanitizeForAI(value) : value;
  }
  return out;
}

export function sanitizeForLogging(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeForLogging);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const lower = k.toLowerCase();
    if (FORBIDDEN_KEYS.some(fk => lower.includes(fk.toLowerCase()))) {
      out[k] = '[REDACTED]';
    } else if (v && typeof v === 'object') {
      out[k] = sanitizeForLogging(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function assertNoPrivateData(context) {
  if (containsForbiddenData(context)) {
    throw new Error('SECURITY_VIOLATION: Private key material detected');
  }
  return true;
}

export function assertNoSecrets(context) {
  return assertNoPrivateData(context);
}

export function getSafeWalletContext(wallet) {
  if (!wallet) return null;
  return {
    connected: Boolean(wallet.connected),
    canSign: Boolean(wallet.canSign),
    evmAddresses: wallet.evmAddresses || [],
    solanaAddresses: wallet.solanaAddresses || [],
    address: wallet.address ? `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}` : null,
    chains: wallet.chains || [],
    balances: (wallet.balances || []).map(b => ({
      symbol: b.symbol,
      amount: b.amount,
      valueUsd: b.valueUsd,
      chainId: b.chainId
    })),
    totalValueUsd: wallet.totalValueUsd || null
  };
}

// Performance: Lazy context, caching, parallel reads (Spec §36)
export function createLazyContext(loader) {
  let cached = null;
  let loading = null;
  return {
    async get() {
      if (cached) return cached;
      if (loading) return loading;
      loading = (async () => {
        try {
          cached = await loader();
          return cached;
        } finally {
          loading = null;
        }
      })();
      return loading;
    },
    clear() { cached = null; },
    isCached() { return Boolean(cached); }
  };
}

export function parallelWithLimit(tasks, limit = 4) {
  return new Promise((resolve) => {
    const results = new Array(tasks.length);
    let running = 0;
    let idx = 0;
    let completed = 0;
    const runNext = () => {
      if (completed === tasks.length) { resolve(results); return; }
      while (running < limit && idx < tasks.length) {
        const currentIdx = idx;
        const task = tasks[currentIdx];
        idx += 1;
        running += 1;
        Promise.resolve()
          .then(() => typeof task === 'function' ? task() : task)
          .then(res => { results[currentIdx] = { ok: true, value: res }; })
          .catch(err => { results[currentIdx] = { ok: false, error: err.message }; })
          .finally(() => { running -= 1; completed += 1; runNext(); });
      }
    };
    runNext();
  });
}
