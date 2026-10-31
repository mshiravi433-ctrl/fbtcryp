import { apiBase } from './apiBase.js';

const DEVICE_KEY = 'fbt.mission.device.v1';
export function missionDeviceId() {
  if (typeof localStorage === 'undefined' || !globalThis.crypto?.randomUUID) throw new Error('SECURE_DEVICE_STORAGE_REQUIRED');
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id || !/^[a-f0-9]{64}$/.test(id)) {
    id = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}
export async function missionCall(path, { method = 'GET', body, signal } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(`${apiBase()}/v1/missions${path}`, {
      method,
      credentials: 'same-origin',
      signal: ctrl.signal,
      headers: { accept: 'application/json', 'x-fbt-mission-device': missionDeviceId(), 'x-fbt-mission-request': '1', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.ok === false) { const e = new Error(json.error?.message || json.error || `HTTP_${res.status}`); e.status = res.status; e.code = json.error?.code; throw e; }
    const { ok: _ok, ...data } = json; return data;
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error(signal?.aborted ? 'ABORTED' : 'TIMEOUT');
    throw err;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
}
export const missionApi = {
  status: (signal) => missionCall('/status', { signal }),
  list: (signal) => missionCall('/missions', { signal }),
  detail: (id, signal) => missionCall(`/missions/${encodeURIComponent(id)}`, { signal }),
  create: (body) => missionCall('/missions', { method: 'POST', body }),
  command: (id, action, version, extra = {}) => missionCall(`/missions/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: { version, ...extra } }),
  opportunities: (signal) => missionCall('/opportunities', { signal }),
  learning: (signal) => missionCall('/learning', { signal }),
  events: (signal) => missionCall('/events?limit=30', { signal }),
  emergency: (reason) => missionCall('/emergency-stop', { method: 'POST', body: { reason, scope: 'global' } }),
  release: () => missionCall('/emergency-stop/release', { method: 'POST', body: { confirm: true } })
};
