/**
 * Phase-2 stand-in for Secret Manager. Holds opaque handles only.
 * Phase 3 should swap this for a real KMS / Secret Manager.
 */
const map = new Map();

export function putSecret(handle, meta = {}) {
  if (!handle) return false;
  map.set(String(handle), { meta: { ...meta }, storedAt: Date.now() });
  return true;
}

export function hasSecret(handle) {
  return map.has(String(handle));
}

export function deleteSecret(handle) {
  return map.delete(String(handle));
}

export function neverExpose() {
  return null;
}
