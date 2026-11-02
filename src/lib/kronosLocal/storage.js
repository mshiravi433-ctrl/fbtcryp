/**
 * KHRONOS LOCAL — model files on the device.
 * ==========================================
 *
 * Two things are stored, both of them optional and both removable by the user:
 *
 *   1. The ONNX graph files in Cache Storage (a normal browser cache: it
 *      survives reloads, is counted against the site's quota and is cleared
 *      when the user clears site data — which is why every load re-verifies).
 *   2. The manifest that describes them, so the UI can show "33.4 MB on this
 *      device" without a network round-trip.
 *
 * Integrity: every file's SHA-256 is checked against the manifest after the
 * download and again whenever it is read back from a cache that might have
 * been produced from a half-written response. A mismatch is treated as "not
 * downloaded" — never as "close enough".
 */

import { MANIFEST_FILE, cacheName, modelBaseUrl } from './config.js';

const MANIFEST_STORE = 'fbt.kronos.manifest.v1';

function cachesApi() {
  return typeof caches !== 'undefined' ? caches : null;
}

export function sha256Hex(buffer) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return Promise.reject(new Error('CRYPTO_UNAVAILABLE'));
  return subtle.digest('SHA-256', buffer).then((digest) => {
    const bytes = new Uint8Array(digest);
    let out = '';
    for (let i = 0; i < bytes.length; i += 1) out += bytes[i].toString(16).padStart(2, '0');
    return out;
  });
}

function readStoredManifest() {
  try {
    const raw = globalThis.localStorage?.getItem(MANIFEST_STORE);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeStoredManifest(manifest) {
  try {
    if (manifest) globalThis.localStorage?.setItem(MANIFEST_STORE, JSON.stringify(manifest));
    else globalThis.localStorage?.removeItem(MANIFEST_STORE);
  } catch { /* private mode: the cache still works, only the fast path is lost */ }
}

/** Download the manifest (a ~1 KB JSON) and remember it locally. */
export async function fetchManifest({ base = modelBaseUrl(), signal } = {}) {
  if (!base) throw new KronosStorageError('MODEL_NOT_HOSTED');
  const url = `${base}${MANIFEST_FILE}`;
  let res;
  try {
    res = await fetch(url, { signal, cache: 'no-cache', credentials: 'omit' });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new KronosStorageError('MANIFEST_UNREACHABLE', String(error?.message || ''));
  }
  if (!res.ok) throw new KronosStorageError(`MANIFEST_HTTP_${res.status}`);
  const manifest = await res.json();
  if (!manifest || manifest.schema !== 'fbt.kronos.browser.v1' || !Array.isArray(manifest.files)) {
    throw new KronosStorageError('MANIFEST_INVALID');
  }
  writeStoredManifest(manifest);
  return manifest;
}

export function rememberedManifest() {
  const stored = readStoredManifest();
  return stored && stored.schema === 'fbt.kronos.browser.v1' ? stored : null;
}

/** Is a complete, verified copy of `manifest` already on this device? */
export async function cachedModelState(manifest) {
  const api = cachesApi();
  if (!api || !manifest) return { downloaded: false, bytes: 0 };
  try {
    const cache = await api.open(cacheName(manifest));
    let bytes = 0;
    for (const file of manifest.files) {
      const hit = await cache.match(file.name);
      if (!hit) return { downloaded: false, bytes: 0, partial: bytes > 0 };
      bytes += Number(file.bytes) || 0;
    }
    return { downloaded: true, bytes };
  } catch {
    return { downloaded: false, bytes: 0 };
  }
}

/**
 * Download every model file into Cache Storage, reporting byte progress.
 *
 * @param {object} manifest
 * @param {object} opts
 * @param {(state: {loaded: number, total: number, file: string, index: number, count: number}) => void} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{bytes: number, verified: boolean}>}
 */
export async function downloadModel(manifest, { onProgress = () => {}, signal, base = modelBaseUrl() } = {}) {
  const api = cachesApi();
  if (!api) throw new KronosStorageError('CACHE_UNAVAILABLE');
  const total = manifest.files.reduce((sum, f) => sum + f.bytes, 0);
  const name = cacheName(manifest);
  // A fresh bucket per download: a half-written cache must never look complete.
  await api.delete(name).catch(() => {});
  const cache = await api.open(name);
  let loaded = 0;

  for (let index = 0; index < manifest.files.length; index += 1) {
    const file = manifest.files[index];
    const url = `${base}${file.name}`;
    let res;
    try {
      res = await fetch(url, { signal, credentials: 'omit' });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw new KronosStorageError('MODEL_FILE_UNREACHABLE', file.name);
    }
    if (!res.ok) throw new KronosStorageError(`MODEL_FILE_HTTP_${res.status}`, file.name);

    const chunks = [];
    let fileLoaded = 0;
    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        fileLoaded += value.byteLength;
        loaded += value.byteLength;
        onProgress({ loaded, total, file: file.name, index, count: manifest.files.length });
      }
    } else {
      const buffer = await res.arrayBuffer();
      chunks.push(new Uint8Array(buffer));
      fileLoaded = buffer.byteLength;
      loaded += fileLoaded;
      onProgress({ loaded, total, file: file.name, index, count: manifest.files.length });
    }
    const bytes = new Uint8Array(fileLoaded);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (bytes.byteLength !== file.bytes) {
      await api.delete(name).catch(() => {});
      throw new KronosStorageError('MODEL_FILE_TRUNCATED', file.name);
    }
    const digest = await sha256Hex(bytes.buffer);
    if (digest !== file.sha256) {
      await api.delete(name).catch(() => {});
      throw new KronosStorageError('MODEL_FILE_CORRUPT', file.name);
    }
    await cache.put(file.name, new Response(bytes, {
      headers: { 'content-type': 'application/octet-stream', 'content-length': String(file.bytes) }
    }));
  }
  writeStoredManifest(manifest);
  return { bytes: loaded, verified: true };
}

/** Read one model file as an ArrayBuffer, verifying it against the manifest. */
export async function readModelFile(manifest, name) {
  const api = cachesApi();
  if (!api) throw new KronosStorageError('CACHE_UNAVAILABLE');
  const file = manifest.files.find((f) => f.name === name);
  if (!file) throw new KronosStorageError('MODEL_FILE_UNKNOWN', name);
  const cache = await api.open(cacheName(manifest));
  const hit = await cache.match(name);
  if (!hit) throw new KronosStorageError('MODEL_NOT_DOWNLOADED', name);
  const buffer = await hit.arrayBuffer();
  const digest = await sha256Hex(buffer);
  if (digest !== file.sha256) throw new KronosStorageError('MODEL_FILE_CORRUPT', name);
  return buffer;
}

/** Remove every model file for this manifest (and any stale version). */
export async function deleteModel(manifest) {
  const api = cachesApi();
  if (!api) return { removed: false };
  const names = new Set([cacheName(manifest)]);
  try {
    for (const key of await api.keys()) {
      if (String(key).startsWith('fbt-kronos-')) names.add(String(key));
    }
  } catch { /* keys() is not available everywhere; the primary bucket still goes */ }
  for (const key of names) await api.delete(key).catch(() => {});
  writeStoredManifest(null);
  return { removed: true };
}

/** Free space on the device, when the browser is willing to tell us. */
export async function storageEstimate() {
  try {
    const estimate = await globalThis.navigator?.storage?.estimate?.();
    if (!estimate) return null;
    return { quota: estimate.quota || 0, usage: estimate.usage || 0, available: Math.max(0, (estimate.quota || 0) - (estimate.usage || 0)) };
  } catch { return null; }
}

export class KronosStorageError extends Error {
  constructor(code, detail) {
    super(code);
    this.name = 'KronosStorageError';
    this.code = code;
    this.detail = detail || '';
  }
}
