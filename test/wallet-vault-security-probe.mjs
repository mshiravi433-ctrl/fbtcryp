import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};

const { importWalletBackup, forceImportWalletBackup } = await import('../src/lib/walletBackup.js');
const { createVaultWithSigner } = await import('../src/lib/localWallet.js');
const b64 = (size) => Buffer.alloc(size, 7).toString('base64');
const valid = {
  _type: 'fbt-swap-wallet-backup', _version: 1, v: 1, kdf: 'PBKDF2',
  iterations: 250_000, salt: b64(16), iv: b64(12), ct: b64(64),
  address: '0x1111111111111111111111111111111111111111', createdAt: Date.now()
};

await importWalletBackup(JSON.stringify(valid));
assert.equal(JSON.parse(storage.get('fbt-wallet-v1')).iterations, 250_000);

for (const patch of [
  { iterations: 1 },
  { iterations: 9_000_000_000 },
  { salt: b64(8) },
  { iv: 'not base64' },
  { ct: b64(5000) },
  { kdf: 'none' },
  { address: '0x1234' }
]) {
  await assert.rejects(() => forceImportWalletBackup(JSON.stringify({ ...valid, ...patch })));
}
await assert.rejects(() => forceImportWalletBackup('{broken'), /BAD_FILE/);

const mnemonic = 'test test test test test test test test test test test junk';
await assert.rejects(() => createVaultWithSigner(mnemonic, ''), /PASSWORD_TOO_SHORT/);
await assert.rejects(() => createVaultWithSigner('not a mnemonic', 'long-enough-password'), /BAD_MNEMONIC/);

console.log('✓ wallet vault rejects weak creation credentials and hostile backup metadata');
