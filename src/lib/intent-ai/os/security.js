/**
 * FBT INTENT OS — Security Layer
 * Spec §37: Never see Private Key, Seed Phrase, Recovery Phrase, Raw Secret
 * Only Wallet Address, Balance, Public Position
 * Signature always by wallet
 */

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
  'apiSecret',
  'api_secret',
  'rawSecret',
  'raw_secret'
];

const FORBIDDEN_PATTERNS = [
  /private\s*key/i,
  /seed\s*phrase/i,
  /recovery\s*phrase/i,
  /mnemonic/i
];

export function containsForbiddenData(obj) {
  if (!obj || typeof obj !== 'object') return false;
  
  const str = JSON.stringify(obj);
  for (const key of FORBIDDEN_KEYS) {
    if (str.toLowerCase().includes(key.toLowerCase())) return true;
  }
  for (const pat of FORBIDDEN_PATTERNS) {
    if (pat.test(str)) return true;
  }
  return false;
}

export function sanitizeForAI(data) {
  if (!data) return data;
  if (typeof data === 'string') return data;
  
  if (Array.isArray(data)) {
    return data.map(sanitizeForAI);
  }
  
  if (typeof data === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(data)) {
      const lower = k.toLowerCase();
      if (FORBIDDEN_KEYS.some(fk => lower.includes(fk.toLowerCase()))) {
        continue; // Skip forbidden
      }
      if (typeof v === 'object' && v !== null) {
        if (containsForbiddenData(v)) continue;
        out[k] = sanitizeForAI(v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }
  
  return data;
}

export function assertNoSecrets(data, context = 'unknown') {
  if (containsForbiddenData(data)) {
    console.error(`[Security] Forbidden data detected in ${context} — blocked`);
    throw new Error('SECURITY_VIOLATION: Raw secret detected');
  }
  return true;
}

// Wallet signing — always via wallet, never AI
export function createSigningRequest({ action, walletAddress, chainId } = {}) {
  if (!walletAddress) throw new Error('NO_WALLET_ADDRESS');
  
  return {
    action,
    walletAddress,
    chainId,
    requiresWalletSignature: true,
    signedBy: 'wallet', // Never AI
    timestamp: Date.now()
  };
}

export const SECURITY_RULES = Object.freeze({
  aiCannotSign: true,
  aiCannotSeePrivateKey: true,
  aiCannotSeeSeedPhrase: true,
  walletSignsAlways: true,
  onlyPublicData: ['address', 'balance', 'positions', 'holdings', 'orders']
});
