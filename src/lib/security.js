/**
 * TOTP 2FA + WebAuthn biometrics.
 *
 * SCOPE — read this so you don't over-trust it:
 * On a non-custodial DEX, 2FA and biometrics gate the *local UI*. They do not
 * protect on-chain funds: anyone holding the seed phrase can spend from any
 * other wallet app, regardless of what this app enforces. They are genuinely
 * useful against someone who picks up an unlocked phone, and that's the claim
 * the UI makes — nothing stronger.
 *
 * The real protection for funds remains: the seed phrase, and the wallet
 * password that encrypts it.
 */

/* -------------------------------------------------------------------------- */
/* Base32 (RFC 4648) — required for TOTP secrets                              */
/* -------------------------------------------------------------------------- */

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = str.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('BAD_BASE32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/* -------------------------------------------------------------------------- */
/* TOTP (RFC 6238)                                                            */
/* -------------------------------------------------------------------------- */

export function generateTotpSecret(bytes = 20) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base32Encode(buf);
}

/** Compute the 6-digit code for a given time step. */
export async function totpCode(secretBase32, timestamp = Date.now(), step = 30, digits = 6) {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(timestamp / 1000 / step);

  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint32(0, Math.floor(counter / 2 ** 32));
  view.setUint32(4, counter >>> 0);

  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, buf));

  // dynamic truncation
  const offset = sig[sig.length - 1] & 0x0f;
  const code =
    ((sig[offset] & 0x7f) << 24) | ((sig[offset + 1] & 0xff) << 16) | ((sig[offset + 2] & 0xff) << 8) | (sig[offset + 3] & 0xff);

  return String(code % 10 ** digits).padStart(digits, '0');
}

/** Verify with a ±1 step window to tolerate clock drift. */
export async function verifyTotp(secretBase32, input, window = 1) {
  const clean = String(input).replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  for (let i = -window; i <= window; i++) {
    const code = await totpCode(secretBase32, Date.now() + i * 30000);
    // constant-time-ish compare
    if (code.length === clean.length) {
      let diff = 0;
      for (let j = 0; j < code.length; j++) diff |= code.charCodeAt(j) ^ clean.charCodeAt(j);
      if (diff === 0) return true;
    }
  }
  return false;
}

/** otpauth:// URI for Google Authenticator / Authy QR codes. */
export function totpUri(secret, account, issuer = 'FBT Swap') {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account || 'wallet')}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/** Single-use recovery codes, shown once at setup. */
export function generateRecoveryCodes(count = 6) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    const buf = new Uint8Array(5);
    crypto.getRandomValues(buf);
    codes.push(base32Encode(buf).slice(0, 8).replace(/(.{4})/, '$1-'));
  }
  return codes;
}

/* -------------------------------------------------------------------------- */
/* WebAuthn / biometrics                                                      */
/* -------------------------------------------------------------------------- */

/** True inside the packaged native app rather than a browser. */
function isNative() {
  return typeof window !== 'undefined' && Boolean(window.Capacitor?.isNativePlatform?.());
}

/*
 * ─── WHY THE NATIVE APP CANNOT USE WebAuthn ─────────────────────────────────
 * A Capacitor WebView serves the page from https://localhost, so
 * `window.location.hostname` is "localhost" and WebAuthn's Relying Party id
 * becomes "localhost". Android refuses to create a platform credential for a
 * relying party it cannot verify by domain, so registration fails — and it
 * fails at the OS layer, well after our checks pass, which is why the toggle
 * looked available and then simply did nothing.
 *
 * Raising the app's hostname to the real domain would not help either: the
 * origin still would not match, because the page is not actually served from
 * there.
 *
 * So on native we use the OS biometric prompt directly (BiometricAuth), which
 * is what a native app is supposed to use. It is also strictly better here:
 * WebAuthn on a local origin proves possession of a browser-scoped key, while
 * the native API asks the fingerprint sensor.
 *
 * Both paths gate the SAME thing — unlocking the local UI — so they are
 * interchangeable for our purposes. Neither protects funds on-chain; that is
 * the wallet's job and is stated in the UI.
 */

export function biometricsSupported() {
  if (typeof window === 'undefined') return false;
  // Native: the OS prompt does not care about origins at all.
  if (isNative()) return true;
  // WebAuthn is hard-gated to secure contexts. Over plain http:// the API
  // exists but every call throws SecurityError, which looks like a broken
  // feature rather than a misconfiguration — so check it explicitly.
  if (!window.isSecureContext) return false;
  return Boolean(window.PublicKeyCredential) && Boolean(navigator.credentials);
}

/** Why biometrics are unavailable, for an actionable error message. */
export function biometricUnavailableReason() {
  if (typeof window === 'undefined') return 'UNSUPPORTED';
  if (isNative()) return null;
  if (!window.isSecureContext) return 'INSECURE_ORIGIN';
  if (!window.PublicKeyCredential) return 'UNSUPPORTED';
  return null;
}

export async function platformAuthenticatorAvailable() {
  if (isNative()) {
    try {
      const { NativeBiometric } = await import('capacitor-native-biometric');
      const res = await NativeBiometric.isAvailable();
      return Boolean(res?.isAvailable);
    } catch {
      // Plugin missing or no enrolled fingerprint — either way, unavailable.
      return false;
    }
  }
  if (!biometricsSupported()) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/**
 * Register the device's fingerprint/face as a local unlock factor.
 * Returns a credential id to store; there is no server-side attestation check
 * here because this is a local gate, not a login.
 */
export async function registerBiometric(username = 'wallet') {
  /*
   * Native: there is nothing to "register". The OS already holds the enrolled
   * fingerprint; we just confirm one exists and that the user can pass it
   * once, so enabling the toggle proves the sensor works rather than failing
   * later at unlock time.
   */
  if (isNative()) {
    const { NativeBiometric } = await import('capacitor-native-biometric');
    const avail = await NativeBiometric.isAvailable();
    if (!avail?.isAvailable) throw new Error('UNSUPPORTED');
    await NativeBiometric.verifyIdentity({
      reason: 'Enable unlock for FBT Swap',
      title: 'FBT Swap',
      subtitle: 'Confirm it is you'
    });
    // A stable marker instead of a credential id — the OS owns the key.
    return { id: 'native', rawId: 'native' };
  }

  if (!biometricsSupported()) throw new Error('UNSUPPORTED');
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));

  const cred = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: 'FBT Swap', id: window.location.hostname },
      user: { id: userId, name: username, displayName: username },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 }, // ES256
        { type: 'public-key', alg: -257 } // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred'
      },
      timeout: 60000,
      attestation: 'none'
    }
  });

  if (!cred) throw new Error('CANCELLED');
  return { id: cred.id, rawId: btoa(String.fromCharCode(...new Uint8Array(cred.rawId))) };
}

/** Prompt for the stored biometric. Resolves true only on a real verification. */
export async function verifyBiometric(credentialId) {
  if (isNative()) {
    const { NativeBiometric } = await import('capacitor-native-biometric');
    /*
     * verifyIdentity RESOLVES on success and REJECTS on failure or cancel.
     * Returning true unconditionally after the call would make a cancelled
     * prompt read as a successful unlock — so the rejection must propagate.
     */
    await NativeBiometric.verifyIdentity({
      reason: 'Unlock FBT Swap',
      title: 'FBT Swap',
      subtitle: 'Confirm it is you'
    });
    return true;
  }

  if (!biometricsSupported()) throw new Error('UNSUPPORTED');
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const allowCredentials = credentialId
    ? [
        {
          type: 'public-key',
          id: Uint8Array.from(atob(credentialId), (c) => c.charCodeAt(0))
        }
      ]
    : undefined;

  const assertion = await navigator.credentials.get({
    publicKey: { challenge, allowCredentials, userVerification: 'required', timeout: 60000 }
  });
  return Boolean(assertion);
}
