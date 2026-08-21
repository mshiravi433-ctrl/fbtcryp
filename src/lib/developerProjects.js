/** Local sandbox project drafts. This is intentionally not an API-key or account registry. */
export const PROJECT_SCHEMA = 'fbt.developer-project.v1';
const KEY = 'fbt-developer-project-drafts-v1';
const NAME = /^[\w .-]{1,48}$/u;
export const PROJECT_SCOPES = Object.freeze(['read_network', 'create_intent', 'request_quote', 'request_simulation']);
export function validateProject(input = {}) {
  const name = String(input.name || '').trim();
  if (!NAME.test(name)) return { ok: false, code: 'INVALID_PROJECT_NAME' };
  if (input.environment !== 'sandbox') return { ok: false, code: 'SANDBOX_ONLY' };
  const scopes = Array.isArray(input.scopes) ? input.scopes.filter((s) => PROJECT_SCOPES.includes(s)) : [];
  if (!scopes.length) return { ok: false, code: 'SCOPE_REQUIRED' };
  return { ok: true, value: { schema: PROJECT_SCHEMA, id: `sandbox-${crypto.randomUUID()}`, ownerRef: 'local-device', name, environment: 'sandbox', status: 'active', scopes, createdAt: Date.now(), updatedAt: Date.now() } };
}
export function loadProjectDrafts(storage = globalThis.localStorage) { try { const rows = JSON.parse(storage?.getItem(KEY) || '[]'); return Array.isArray(rows) ? rows : []; } catch { return []; } }
export function saveProjectDraft(project, storage = globalThis.localStorage) { const rows = loadProjectDrafts(storage); const next = [project, ...rows.filter((x) => x.id !== project.id)].slice(0, 10); try { storage?.setItem(KEY, JSON.stringify(next)); } catch { /* local storage is optional */ } return next; }
export function createSandboxProject(input, storage = globalThis.localStorage) { const result = validateProject(input); return result.ok ? { ok: true, projects: saveProjectDraft(result.value, storage), project: result.value } : result; }
