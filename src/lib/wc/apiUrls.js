/**
 * THE TWO REOWN API URLS, BUILT ONCE.
 * ---------------------------------------------------------------------------
 * `ApiController.fetchProjectConfig()` and `checkAllowedOrigins()` are the two
 * server calls whose answers decide a connect:
 *
 *   GET /appkit/v1/config       — does this project id exist at all?
 *   GET /projects/v1/origins    — which domains is it allowed to attest?
 *
 * They used to live in health.js, which was fine while health.js was the only
 * reader. The diagnostic engine (diagnostics.js) reads the same two endpoints,
 * and health.js has to import the engine to attach its verdict — so the URL
 * builders moved HERE, below both, instead of health.js and the engine each
 * growing a copy that can drift from the SDK's own query string.
 *
 * Everything in this file is a pure function of (projectId, sdkVersion).
 */

import { HEALTH_SDK_VERSION, W3M_API_URL } from './config.js';

function apiUrl(path, projectId, sdkVersion) {
  const url = new URL(`${W3M_API_URL}${path}`);
  url.searchParams.set('projectId', String(projectId || ''));
  url.searchParams.set('st', 'appkit');
  url.searchParams.set('sv', sdkVersion);
  return url.toString();
}

/** `GET /appkit/v1/config` — mirrors `ApiController.fetchProjectConfig()`. */
export function configProbeUrl(projectId, sdkVersion = HEALTH_SDK_VERSION) {
  return apiUrl('/appkit/v1/config', projectId, sdkVersion);
}

/** `GET /projects/v1/origins` — the list `checkAllowedOrigins()` reads. */
export function originsProbeUrl(projectId, sdkVersion = HEALTH_SDK_VERSION) {
  return apiUrl('/projects/v1/origins', projectId, sdkVersion);
}
