/**
 * FBT INTENT OS — Security
 * Spec §37: AI must not see Private Key, Seed Phrase, etc.
 * Only Wallet Address, Balance, Public Position
 */

export const SECURITY_SCHEMA = 'fbt.security.v1';

const FORBIDDEN_KEYS = [
  'privateKey',
  'private_key',
  'seedPhrase',
  'seed_phrase',
  'mnemonic',
  'recoveryPhrase',
  'recovery_phrase',
  'secret',
  'password',
  'passphrase',
  'keystore',
  'rawSecret',
  'privateKeyHex'
];

const FORBIDDEN_PATTERNS = [
  /0x[a-fA-F0-9]{64}/, // raw private key hex
  /[a-z]+\s+[a-z]+\s+[a-z]+\s+[a-z]+\s+[a-z]+\s+[a-z]+\s+[a-z]+\s+[a-z]+\s+[a-z]+\s+[a-z]+\s+[a-z]+\s+[a-z]+/ // 12 words
];

export function containsForbiddenData(obj) {
  if (!obj || typeof obj !== 'object') {
    if (typeof obj === 'string') {
      // Check patterns
      for (const pat of FORBIDDEN_PATTERNS) {
        if (pat.test(obj) && obj.length > 50) return true;
      }
      return false;
    }
    return false;
  }
  
  for (const key of Object.keys(obj)) {
    const lower = key.toLowerCase();
    for (const forbidden of FORBIDDEN_KEYS) {
      if (lower.includes(forbidden.toLowerCase())) return true;
    }
    if (containsForbiddenData(obj[key])) return true;
  }
  
  return false;
}

export function sanitizeForAI(data) {
  if (!data || typeof data !== 'object') return data;
  
  if (Array.isArray(data)) {
    return data.map(sanitizeForAI);
  }
  
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    const lower = key.toLowerCase();
    const isForbidden = FORBIDDEN_KEYS.some(f => lower.includes(f.toLowerCase()));
    
    if (isForbidden) {
      // Never include
      continue;
    }
    
    if (typeof value === 'object' && value !== null) {
      out[key] = sanitizeForAI(value);
    } else {
      out[key] = value;
    }
  }
  
  return out;
}

export function assertNoSecrets(context) {
  if (containsForbiddenData(context)) {
    throw new Error('SECURITY_VIOLATION: Forbidden data in AI context');
  }
  return true;
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
