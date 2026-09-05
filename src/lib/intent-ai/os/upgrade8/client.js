import { createIntentOSState } from './contracts.js';

const BASE = '/api/v1/ai/os';
const DEVICE_KEY = 'fbt.intent-os.device-id';

function getDeviceId() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const existing = window.localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const generated = `web_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(DEVICE_KEY, generated);
    return generated;
  } catch {
    return null;
  }
}

async function call(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  const deviceId = getDeviceId();
  if (deviceId) headers['x-fbt-device'] = deviceId;
  const response = await fetch(`${BASE}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin'
  });
  if (!response.ok) {
    const text = await response.text().catch(() => 'request failed');
    throw new Error(text || `Intent OS request failed (${response.status})`);
  }
  return response.json();
}

export async function getIntentOSState() {
  const data = await call('/state');
  return createIntentOSState(data?.state || data || {});
}

export async function saveIntentOSState(state) {
  const data = await call('/state', {
    method: 'POST',
    body: { state: createIntentOSState(state || {}) }
  });
  return createIntentOSState(data?.state || state || {});
}

export async function postIntentOSRecord(path, payload) {
  return call(path, { method: 'POST', body: payload });
}

export async function patchIntentOSRecord(path, payload) {
  return call(path, { method: 'PATCH', body: payload });
}
