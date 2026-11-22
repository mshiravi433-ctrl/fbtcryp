/** Retry a transient chat transport failure once, without rerunning local agents.
 * Never retry a throttle or an application error. The chat endpoint stages
 * actions but does not sign or execute them. */
export async function chatWithTransientRetry(request, send, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
  const first = await send(request);
  const status = Number(first?.status || 0);
  const canRetry = first?.ok !== true && status !== 429 &&
    (status === 0 || status === 408 || status === 502 || status === 503 || status === 504);
  if (!canRetry) return first;
  await wait(800);
  return send({ ...request, retry: true });
}
