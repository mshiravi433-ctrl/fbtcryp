/**
 * Wallet backup — export the encrypted vault to a file on the phone.
 *
 * ─── WHAT IS AND ISN'T EXPORTED ───────────────────────────────────────────
 * The exported file contains the SAME AES-GCM ciphertext that sits in local
 * storage: the seed phrase encrypted under the user's password with PBKDF2 at
 * 310k iterations. The plaintext seed is never written to disk.
 *
 * That means the backup file alone is useless without the password — which is
 * exactly the property we want, because a file in the Downloads folder is
 * readable by any app with storage access, gets swept into cloud photo/file
 * sync, and often ends up in a chat app.
 *
 * It also means: LOSE THE PASSWORD AND THE BACKUP IS WORTHLESS. The UI has to
 * say this loudly, because a user who backs up the file but forgets the
 * password has lost their funds just as completely as one who backed up
 * nothing.
 *
 * The written seed phrase on paper remains the primary backup. This file is a
 * convenience for moving between devices, not a replacement for it.
 * ──────────────────────────────────────────────────────────────────────────
 */

import { loadVault, saveVault } from './localWallet';

const isNative = () => typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();

/** Human-readable location, so we can tell the user exactly where it went. */
export const BACKUP_FILENAME = 'fbt-wallet-backup.json';

function buildPayload() {
  const vault = loadVault();
  if (!vault) throw new Error('NO_VAULT');

  return JSON.stringify(
    {
      _type: 'fbt-swap-wallet-backup',
      _version: 1,
      _warning:
        'This file contains an ENCRYPTED wallet. It is useless without the password you set in the app. ' +
        'Anyone who has BOTH this file and that password controls the funds. Store it offline.',
      address: vault.address,
      createdAt: vault.createdAt,
      exportedAt: Date.now(),
      // the encrypted blob, byte-for-byte as stored
      kdf: vault.kdf,
      iterations: vault.iterations,
      salt: vault.salt,
      iv: vault.iv,
      ct: vault.ct,
      v: vault.v
    },
    null,
    2
  );
}

/**
 * Save the backup to the device.
 *
 * On Android we write into the app's Documents directory, which is visible in
 * the Files app but not world-readable, then offer a share sheet so the user
 * can move it somewhere durable. On web we trigger a normal download.
 *
 * Returns a description of where the file landed.
 */
export async function exportWallet() {
  const json = buildPayload();

  if (isNative()) {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');

    await Filesystem.writeFile({
      path: BACKUP_FILENAME,
      data: json,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
      recursive: true
    });

    const { uri } = await Filesystem.getUri({
      directory: Directory.Documents,
      path: BACKUP_FILENAME
    });

    return {
      ok: true,
      native: true,
      path: `Documents/${BACKUP_FILENAME}`,
      uri,
      // Where a user will actually find it in the Files app
      hint: 'Files → Documents'
    };
  }

  // Browser / Telegram Mini App
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = BACKUP_FILENAME;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);

  return { ok: true, native: false, path: BACKUP_FILENAME, hint: 'Downloads' };
}

/** Offer the OS share sheet so the file can go to a password manager, etc. */
export async function shareWalletBackup() {
  if (!isNative()) return { ok: false, reason: 'NOT_NATIVE' };

  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');

  await Filesystem.writeFile({
    path: BACKUP_FILENAME,
    data: buildPayload(),
    directory: Directory.Documents,
    encoding: Encoding.UTF8,
    recursive: true
  });

  const { uri } = await Filesystem.getUri({ directory: Directory.Documents, path: BACKUP_FILENAME });

  await Share.share({
    title: 'FBT Swap wallet backup (encrypted)',
    text: 'Encrypted wallet backup. Useless without your password — store it offline.',
    url: uri,
    dialogTitle: 'Save your encrypted backup'
  });

  return { ok: true, uri };
}

/**
 * Restore from a backup file.
 *
 * Validated strictly: a malformed or foreign file must not overwrite an
 * existing wallet, because that is an unrecoverable data loss.
 */
export async function importWalletBackup(fileText) {
  let parsed;
  try {
    parsed = JSON.parse(fileText);
  } catch {
    throw new Error('BAD_FILE');
  }

  if (parsed?._type !== 'fbt-swap-wallet-backup') throw new Error('WRONG_FILE');
  if (!parsed.ct || !parsed.salt || !parsed.iv || !parsed.address) throw new Error('INCOMPLETE');

  const existing = loadVault();
  if (existing && existing.address?.toLowerCase() !== parsed.address?.toLowerCase()) {
    // Refuse to silently replace a different wallet — the caller must confirm.
    throw new Error('DIFFERENT_WALLET');
  }

  saveVault({
    v: parsed.v ?? 1,
    kdf: parsed.kdf ?? 'PBKDF2',
    iterations: parsed.iterations ?? 310000,
    salt: parsed.salt,
    iv: parsed.iv,
    ct: parsed.ct,
    address: parsed.address,
    createdAt: parsed.createdAt ?? Date.now()
  });

  return { ok: true, address: parsed.address };
}

/** Force-restore, used after the user confirms overwriting a different wallet. */
export async function forceImportWalletBackup(fileText) {
  const parsed = JSON.parse(fileText);
  saveVault({
    v: parsed.v ?? 1,
    kdf: parsed.kdf ?? 'PBKDF2',
    iterations: parsed.iterations ?? 310000,
    salt: parsed.salt,
    iv: parsed.iv,
    ct: parsed.ct,
    address: parsed.address,
    createdAt: parsed.createdAt ?? Date.now()
  });
  return { ok: true, address: parsed.address };
}
