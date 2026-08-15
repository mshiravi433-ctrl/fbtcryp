/**
 * useLearningParams — the client half of the hot-path loader.
 * ---------------------------------------------------------------------------
 * Fetches /api/learning/params ONCE on mount, stale-while-revalidate style:
 *
 *   1. sessionStorage copy (if any) is surfaced IMMEDIATELY — first render
 *      is never blocked, the badge appears without a network round-trip;
 *   2. one background fetch refreshes it (module-memoized, so five panels
 *      on one screen still make one request);
 *   3. on any failure the hook simply stays/returns null and every consumer
 *      falls back to hardcoded behaviour — "offline" rather than broken.
 *
 * The endpoint itself is edge-cached (s-maxage=3600), so even the refresh
 * is usually a CDN hit that never wakes the server.
 */

import { useEffect, useState } from 'react';

const CACHE_KEY = 'fbt-learning-params-v1';
const PARAMS_URL = '/api/learning/params';

let memo = null; // module-level: one fetch per session
let inflight = null;

function fromSession() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function toSession(data) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    /* private mode: no session cache, hook still works from memory */
  }
}

export function fetchLearningParams() {
  if (memo) return Promise.resolve(memo);
  if (inflight) return inflight;
  inflight = fetch(PARAMS_URL, { headers: { accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((data) => {
      if (data && typeof data === 'object') {
        memo = data;
        toSession(data);
      }
      return memo;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Test/logout hook: drop the in-memory copy. */
export function _resetLearningParams() {
  memo = null;
  inflight = null;
}

/**
 * @returns {{ model:boolean, params:object|null, manifest:object|null }|null}
 *   null while nothing is known (first paint, offline, feature off).
 */
export default function useLearningParams() {
  const [data, setData] = useState(() => memo ?? fromSession());

  useEffect(() => {
    let alive = true;
    fetchLearningParams().then((d) => {
      if (alive && d) setData(d);
    });
    return () => {
      alive = false;
    };
  }, []);

  return data;
}
