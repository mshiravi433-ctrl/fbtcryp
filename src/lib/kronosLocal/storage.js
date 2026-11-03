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
 *
 * Cache keys are absolute. A relative name (`tokenizer-encode.onnx`) resolves
 * against the caller's base URL — the page for the downloader, the worker
 * script for the engine — so the two sides would never see the same entry and
 * every successful download would then be reported as «دانلود کامل نشد».
 */

import { MANIFEST_FILE, cacheName, modelBaseCandidates, modelBaseUrl } from './config.js';

const MANIFEST_STORE = 'fbt.kronos.manifest.v1';
const IDB_NAME = 'fbt-kronos-models';
const IDB_STORE = 'files';
const RANGE_CHUNK = 1024 * 1024;
const FILE_ATTEMPTS = 3;
const CONNECT_TIMEOUT_MS = 8000;

/** Stable Cache Storage key. Same string on the page and in the worker. */
export const MODEL_CACHE_PREFIX = '/__fbt_kronos__/';

export function modelCacheOrigin() {
  try {
    const origin = globalThis.location?.origin;
    if (origin && origin !== 'null') return origin;
  } catch { /* a sandboxed worker can throw on location */ }
  try {
    const origin = globalThis.window?.location?.origin;
    if (origin && origin !== 'null') return origin;
  } catch { /* ignore */ }
  return 'https://local.invalid';
}

export function modelCacheKey(name, origin = modelCacheOrigin()) {
  const file = encodeURIComponent(String(name || '').split('/').filter(Boolean).pop() || 'model');
  return `${String(origin).replace(/\/$/, '')}${MODEL_CACHE_PREFIX}${file}`;
}

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

function exactBuffer(bytes) {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) return bytes.buffer;
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
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

function abortError() {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

function isUserAbort(error, signal) {
  return signal?.aborted || error?.name === 'AbortError';
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

function looksLikeHtml(bytes) {
  const head = new TextDecoder().decode(bytes.subarray(0, 80)).trim().toLowerCase();
  return head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<head');
}

function isHtmlResponse(res) {
  const type = res.headers?.get?.('content-type') || '';
  return /text\/html/i.test(type);
}

function sameOriginAsPage(url) {
  try {
    const origin = globalThis.location?.origin || globalThis.window?.location?.origin;
    if (!origin || origin === 'null') return false;
    return new URL(url).origin === origin;
  } catch { return false; }
}

/**
 * Download the manifest (a ~1 KB JSON) and remember it locally.
 *
 * Tries every candidate host in order (the configured one, then the app's own
 * origin, then the published raw copy). The error that surfaces is the LAST
 * one only if every candidate failed — and it remembers which base answered,
 * so the four graphs do not each have to rediscover the host.
 */
export async function fetchManifest({ base = '', signal } = {}) {
  /* An explicit `base` is a first preference, not the only option: the caller
     that names a host still wants the app's own copy tried if that host is
     dead. (Passing '' asks for the default order.) */
  const preferred = base ? withTrailingSlash(base) : '';
  const candidates = modelBaseCandidates().filter((url) => url !== preferred);
  if (preferred) candidates.unshift(preferred);
  if (!candidates.length) throw new KronosStorageError('MODEL_NOT_HOSTED');
  let lastError = null;
  for (const candidate of candidates) {
    try {
      const manifest = await fetchManifestFrom(candidate, signal);
      rememberHost(candidate);
      return manifest;
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      lastError = error;
    }
  }
  throw lastError || new KronosStorageError('MODEL_NOT_HOSTED');
}

async function fetchManifestFrom(base, signal) {
  const url = `${base}${MANIFEST_FILE}`;
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (signal?.aborted) throw abortError();
    let res;
    try {
      res = await fetch(url, {
        signal,
        cache: 'no-store',
        credentials: 'omit'
      });
    } catch (error) {
      if (isUserAbort(error, signal)) throw abortError();
      lastError = new KronosStorageError('MANIFEST_UNREACHABLE', String(error?.message || ''));
      if (attempt === 0) {
        await delay(200, signal);
        continue;
      }
      throw lastError;
    }
    if (!res.ok || isHtmlResponse(res)) throw new KronosStorageError(`MANIFEST_HTTP_${res.ok ? 404 : res.status}`);
    let manifest;
    try {
      manifest = await res.json();
    } catch (error) {
      throw new KronosStorageError('MANIFEST_INVALID', String(error?.message || ''));
    }
    if (!manifest || manifest.schema !== 'fbt.kronos.browser.v1' || !Array.isArray(manifest.files)) {
      throw new KronosStorageError('MANIFEST_INVALID');
    }
    writeStoredManifest(manifest);
    return manifest;
  }
  throw lastError || new KronosStorageError('MANIFEST_UNREACHABLE');
}

/**
 * Which base actually answered. Persisted for the session only: a host that
 * works from one network may not work from another, and a stale choice would
 * make the next visit look broken for no reason.
 */
let resolvedHost = '';
function rememberHost(base) { resolvedHost = withTrailingSlash(base); }
function withTrailingSlash(url) {
  const value = String(url || '');
  if (!value) return '';
  return value.endsWith('/') ? value : `${value}/`;
}

/** The base to download files from (the one that served the manifest). */
export function modelHost() {
  return resolvedHost || withTrailingSlash(modelBaseUrl());
}

export function hasResolvedModelHost() {
  return Boolean(resolvedHost);
}

export function rememberedManifest() {
  const stored = readStoredManifest();
  return stored && stored.schema === 'fbt.kronos.browser.v1' ? stored : null;
}

function uniqueBases(urls) {
  const out = [];
  for (const url of urls) {
    const normalized = withTrailingSlash(url);
    if (!normalized || normalized === '/' || out.includes(normalized)) continue;
    out.push(normalized);
  }
  return out;
}

function legacyKeys(name, pageUrl) {
  const keys = [name];
  const bases = [];
  if (pageUrl) bases.push(pageUrl);
  try { if (globalThis.location?.href) bases.push(globalThis.location.href); } catch { /* ignore */ }
  try { if (globalThis.window?.location?.href) bases.push(globalThis.window.location.href); } catch { /* ignore */ }
  for (const base of bases) {
    try { keys.push(new URL(name, base).href); } catch { /* ignore */ }
  }
  return keys;
}

async function safeMatch(cache, key) {
  try { return await cache.match(key); } catch { return null; }
}

/** Find the stable key, or a legacy relative put, and copy the latter across. */
async function matchModel(cache, name, pageUrl) {
  const key = modelCacheKey(name);
  let hit = await safeMatch(cache, key);
  if (hit) return hit;
  for (const legacy of legacyKeys(name, pageUrl)) {
    if (!legacy || legacy === key) continue;
    hit = await safeMatch(cache, legacy);
    if (!hit) continue;
    try { await cache.put(key, hit.clone()); } catch { /* still readable via the legacy key */ }
    return hit;
  }
  return null;
}

function pageUrlDefault() {
  try { return globalThis.location?.href || globalThis.window?.location?.href || ''; } catch { return ''; }
}

/** Is a complete, verified copy of `manifest` already on this device? */
export async function cachedModelState(manifest, { pageUrl = pageUrlDefault() } = {}) {
  const api = cachesApi();
  if (!api || !manifest) return { downloaded: false, bytes: 0 };
  try {
    const cache = await api.open(cacheName(manifest));
    let bytes = 0;
    for (const file of manifest.files) {
      const hit = await matchModel(cache, file.name, pageUrl) || await idbGet(file.name);
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
 * A remembered manifest does not know which host is alive this session
 * (`resolvedHost` is not persisted). The preferred base is tried first — that
 * is the host that just served the manifest, when we have one — and every
 * other candidate is tried on a network or HTTP failure. A SHA mismatch is
 * not retried and does not hop hosts: the bytes we got were the wrong file.
 *
 * @param {object} manifest
 * @param {object} opts
 * @param {(state: {loaded: number, total: number, file: string, index: number, count: number}) => void} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{bytes: number, verified: boolean}>}
 */
export async function downloadModel(manifest, { onProgress = () => {}, signal, base = modelHost() } = {}) {
  const api = cachesApi();
  if (!api) throw new KronosStorageError('CACHE_UNAVAILABLE');
  const total = manifest.files.reduce((sum, f) => sum + f.bytes, 0);
  const name = cacheName(manifest);
  // A fresh bucket per download: a half-written cache must never look complete.
  await api.delete(name).catch(() => {});
  const cache = await api.open(name);
  const bases = uniqueBases([base, modelHost(), ...modelBaseCandidates()]);
  if (!bases.length) throw new KronosStorageError('MODEL_FILE_UNREACHABLE');
  let completed = 0;

  for (let index = 0; index < manifest.files.length; index += 1) {
    const file = manifest.files[index];
    if (signal?.aborted) throw abortError();
    let stored = false;
    let lastError = null;
    for (const host of bases) {
      try {
        const bytes = await fetchFileWithRetry(`${host}${file.name}`, file, {
          signal,
          onChunk: (n) => onProgress({
            loaded: completed + n,
            total,
            file: file.name,
            index,
            count: manifest.files.length
          })
        });
        await storeFile(cache, file.name, bytes);
        rememberHost(host);
        stored = true;
        break;
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        lastError = error;
        if (error instanceof KronosStorageError
          && (error.code === 'MODEL_FILE_CORRUPT' || error.code === 'MODEL_FILE_TRUNCATED')) {
          await api.delete(name).catch(() => {});
          throw error;
        }
      }
    }
    if (!stored) {
      await api.delete(name).catch(() => {});
      throw lastError || new KronosStorageError('MODEL_FILE_UNREACHABLE', file.name);
    }
    completed += file.bytes;
    onProgress({ loaded: completed, total, file: file.name, index, count: manifest.files.length });
  }
  writeStoredManifest(manifest);
  return { bytes: completed, verified: true };
}

async function fetchFileWithRetry(url, file, hooks) {
  let last = null;
  for (let attempt = 0; attempt < FILE_ATTEMPTS; attempt += 1) {
    try {
      return await fetchFileOnce(url, file, hooks);
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      last = error;
      const code = error?.code || '';
      const retryable = !(error instanceof KronosStorageError) || code === 'MODEL_FILE_UNREACHABLE';
      if (!retryable) throw error;
      if (attempt === FILE_ATTEMPTS - 1) break;
      await delay(200 * (attempt + 1), hooks.signal);
    }
  }
  if (last instanceof KronosStorageError) throw last;
  throw new KronosStorageError('MODEL_FILE_UNREACHABLE', file.name);
}

async function fetchFileOnce(url, file, { signal, onChunk }) {
  const ranged = file.bytes > RANGE_CHUNK;
  const res = await fetchResponse(url, {
    signal,
    headers: ranged ? { Range: `bytes=0-${RANGE_CHUNK - 1}` } : undefined,
    connectTimeoutMs: sameOriginAsPage(url) ? 0 : CONNECT_TIMEOUT_MS
  });
  if (res.status === 206) {
    try {
      return await readRanged(url, file, res, { signal, onChunk });
    } catch (error) {
      if (error?.name === 'AbortError' || error?.code === 'MODEL_FILE_CORRUPT') throw error;
      if (error instanceof KronosStorageError && error.code.startsWith('MODEL_FILE_HTTP_')) throw error;
      const full = await fetchResponse(url, { signal, connectTimeoutMs: 0 });
      return readFull(full, file, { signal, onChunk });
    }
  }
  if (!res.ok) throw new KronosStorageError(`MODEL_FILE_HTTP_${res.status}`, file.name);
  if (isHtmlResponse(res)) throw new KronosStorageError('MODEL_FILE_HTTP_404', file.name);
  return readFull(res, file, { signal, onChunk });
}

async function fetchResponse(url, { signal, headers, connectTimeoutMs = 0 } = {}) {
  if (signal?.aborted) throw abortError();
  const timed = new AbortController();
  const timer = connectTimeoutMs > 0 ? setTimeout(() => timed.abort(), connectTimeoutMs) : null;
  const onAbort = () => timed.abort();
  signal?.addEventListener?.('abort', onAbort);
  try {
    return await fetch(url, {
      signal: timer || signal ? timed.signal : signal,
      headers,
      credentials: 'omit',
      cache: 'no-store'
    });
  } catch (error) {
    if (signal?.aborted || (error?.name === 'AbortError' && signal?.aborted)) throw abortError();
    if (error?.name === 'AbortError') throw new KronosStorageError('MODEL_FILE_UNREACHABLE', url);
    throw new KronosStorageError('MODEL_FILE_UNREACHABLE', String(error?.message || url));
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }
}

async function readFull(res, file, { signal, onChunk }) {
  const chunks = [];
  let received = 0;
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    for (;;) {
      if (signal?.aborted) throw abortError();
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      onChunk?.(received);
    }
  } else {
    const buffer = await res.arrayBuffer();
    chunks.push(new Uint8Array(buffer));
    received = buffer.byteLength;
    onChunk?.(received);
  }
  const bytes = concat(chunks, received);
  if (looksLikeHtml(bytes)) throw new KronosStorageError('MODEL_FILE_HTTP_404', file.name);
  if (bytes.byteLength !== file.bytes) throw new KronosStorageError('MODEL_FILE_TRUNCATED', file.name);
  if (await sha256Hex(exactBuffer(bytes)) !== file.sha256) {
    throw new KronosStorageError('MODEL_FILE_CORRUPT', file.name);
  }
  return bytes;
}

async function readRanged(url, file, first, { signal, onChunk }) {
  const parts = [new Uint8Array(await first.arrayBuffer())];
  let received = parts[0].byteLength;
  onChunk?.(received);
  let start = received;
  while (start < file.bytes) {
    if (signal?.aborted) throw abortError();
    const end = Math.min(file.bytes, start + RANGE_CHUNK) - 1;
    const res = await fetchResponse(url, {
      signal,
      headers: { Range: `bytes=${start}-${end}` },
      connectTimeoutMs: sameOriginAsPage(url) ? 0 : CONNECT_TIMEOUT_MS
    });
    if (res.status !== 206) throw new KronosStorageError('MODEL_FILE_TRUNCATED', file.name);
    const chunk = new Uint8Array(await res.arrayBuffer());
    if (!chunk.byteLength) throw new KronosStorageError('MODEL_FILE_TRUNCATED', file.name);
    parts.push(chunk);
    received += chunk.byteLength;
    start += chunk.byteLength;
    onChunk?.(Math.min(received, file.bytes));
  }
  if (received !== file.bytes) throw new KronosStorageError('MODEL_FILE_TRUNCATED', file.name);
  const bytes = concat(parts, file.bytes);
  if (looksLikeHtml(bytes)) throw new KronosStorageError('MODEL_FILE_HTTP_404', file.name);
  if (await sha256Hex(exactBuffer(bytes)) !== file.sha256) {
    throw new KronosStorageError('MODEL_FILE_CORRUPT', file.name);
  }
  return bytes;
}

function concat(chunks, length) {
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    const view = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    const room = length - offset;
    if (room <= 0) break;
    bytes.set(view.subarray(0, room), offset);
    offset += Math.min(view.byteLength, room);
  }
  return bytes;
}

async function storeFile(cache, name, bytes) {
  const copy = new Uint8Array(exactBuffer(bytes));
  try {
    await cache.put(modelCacheKey(name), new Response(copy.slice(), {
      headers: { 'content-type': 'application/octet-stream' }
    }));
  } catch {
    await idbPut(name, copy.buffer);
  }
}

/** Read one model file as an ArrayBuffer, verifying it against the manifest. */
export async function readModelFile(manifest, name, { pageUrl = pageUrlDefault() } = {}) {
  const api = cachesApi();
  if (!api) throw new KronosStorageError('CACHE_UNAVAILABLE');
  const file = manifest.files.find((f) => f.name === name);
  if (!file) throw new KronosStorageError('MODEL_FILE_UNKNOWN', name);
  const cache = await api.open(cacheName(manifest));
  const hit = await matchModel(cache, name, pageUrl);
  let buffer = hit ? await hit.arrayBuffer() : null;
  if (!buffer) {
    const stored = await idbGet(name);
    buffer = stored?.bytes || null;
  }
  if (!buffer) throw new KronosStorageError('MODEL_NOT_DOWNLOADED', name);
  const digest = await sha256Hex(buffer);
  if (digest !== file.sha256 || buffer.byteLength !== file.bytes) {
    throw new KronosStorageError('MODEL_FILE_CORRUPT', name);
  }
  return buffer;
}

function idbOpen() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('NO_IDB'));
      return;
    }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(name, buffer) {
  const db = await idbOpen();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put({ bytes: buffer, sha256: '' }, name);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function idbGet(name) {
  if (!globalThis.indexedDB) return null;
  let db;
  try { db = await idbOpen(); } catch { return null; }
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(name);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  } finally {
    db.close();
  }
}

async function idbClear() {
  if (!globalThis.indexedDB) return;
  let db;
  try { db = await idbOpen(); } catch { return; }
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* the cache buckets are the primary store */ } finally {
    db.close();
  }
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
  await idbClear();
  writeStoredManifest(null);
  resolvedHost = '';
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
