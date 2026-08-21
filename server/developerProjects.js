import { randomUUID } from 'node:crypto';
import { blobConfigured } from './blobCache.js';
import { storeGet, storeSet } from './store.js';
export const PROJECT_SCHEMA = 'fbt.developer-project.v1';
const NAME = /^[\w .-]{1,48}$/u;
/*
 * Scopes a project may hold. `manage_listings` is the only state-changing one
 * and it reaches exactly one surface: the self-reported ecosystem catalog.
 * There is deliberately no scope that can sign, execute, settle or withdraw.
 */
const SCOPES = new Set(['read_network', 'create_intent', 'request_quote', 'request_simulation', 'manage_listings']);
const key = (owner) => `developer-projects:v1:${String(owner)}`;
export function validateProjectInput(input = {}) {
  const name = String(input.name || '').trim();
  const scopes = Array.isArray(input.scopes) ? [...new Set(input.scopes.filter((x) => SCOPES.has(x)))] : [];
  if (!NAME.test(name)) return { ok: false, code: 'INVALID_PROJECT_NAME' };
  if (input.environment !== 'sandbox') return { ok: false, code: 'SANDBOX_ONLY' };
  if (!scopes.length) return { ok: false, code: 'SCOPE_REQUIRED' };
  return { ok: true, value: { schema: PROJECT_SCHEMA, id: `prj_${randomUUID()}`, ownerRef: 'telegram-user', name, environment: 'sandbox', status: 'active', scopes, createdAt: Date.now(), updatedAt: Date.now() } };
}
export async function listProjects(owner) { if (!blobConfigured()) return { ok: false, code: 'PROJECT_STORE_UNAVAILABLE' }; const rows = await storeGet(key(owner), []); return { ok: true, projects: Array.isArray(rows) ? rows : [] }; }
export async function createProject(owner, input) { if (!blobConfigured()) return { ok: false, code: 'PROJECT_STORE_UNAVAILABLE' }; const valid = validateProjectInput(input); if (!valid.ok) return valid; const current = await listProjects(owner); if (!current.ok) return current; if (current.projects.some((p) => p.name.toLowerCase() === valid.value.name.toLowerCase())) return { ok: false, code: 'DUPLICATE_PROJECT' }; const projects = [valid.value, ...current.projects].slice(0, 20); await storeSet(key(owner), projects); return { ok: true, project: valid.value }; }
export async function ownedProject(owner, projectId) { const result = await listProjects(owner); if (!result.ok) return result; return { ok: true, project: result.projects.find((p) => p.id === projectId) || null }; }
export const projectScopes = () => [...SCOPES];
