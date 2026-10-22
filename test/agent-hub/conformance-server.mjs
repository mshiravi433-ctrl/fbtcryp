/**
 * A2A CONFORMANCE SERVER — the test double for the agent-hub adapter.
 * ---------------------------------------------------------------------------
 * This is the ONLY kind of fake agent this project permits: a local server that
 * speaks the A2A wire format so the adapter, the broker and the UI can be
 * tested without calling a real provider (and without a cent of spend). It is
 * never imported by production code, it binds to 127.0.0.1 only, and every
 * response it produces is labelled as a conformance fixture by the tests that
 * use it.
 *
 * It implements the subset the adapter claims: card discovery, `message/send`,
 * `tasks/get`, `tasks/cancel`. Behaviour is selected by keywords in the task
 * text so one server can drive every branch:
 *
 *   instant  → completes immediately, with an artifact + a citation
 *   slow     → `working` first, completes after ~600 ms
 *   message  → answers with a bare Message (no task id) — the honest
 *              "acknowledged but untrackable" case
 *   fail     → failed state
 *   input    → input-required
 *   hold     → stays `submitted` until cancelled
 *   drop     → creates the task, then kills the socket (lost response)
 *   boom     → HTTP 500 (provider outage)
 */
import http from 'node:http';

const json = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
};

const readBody = async (req, limit = 200_000) => {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw new Error('BODY_TOO_LARGE');
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

export async function startConformanceServer({ port = 0 } = {}) {
  const tasks = new Map();
  const byMessageId = new Map();
  const calls = { card: 0, send: 0, get: 0, cancel: 0, token: 0 };
  let sequence = 0;

  const card = {
    name: 'Conformance Research Agent',
    description: 'A local A2A conformance fixture used by the agent-hub tests.',
    version: '1.2.0',
    protocolVersion: '0.3.0',
    capabilities: { streaming: false, pushNotifications: true },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [
      { id: 'token-research', name: 'Token research', description: 'Source-backed token research with citations.', tags: ['research', 'token'], examples: ['Summarise the last week of ETH flows'] },
      { id: 'wallet-risk', name: 'Wallet risk review', description: 'Public-address concentration and exposure review.', tags: ['wallet', 'risk'] }
    ]
  };

  const makeTask = (text, behavior) => {
    const id = `task-${++sequence}`;
    const task = { id, contextId: `ctx-${sequence}`, status: { state: 'submitted', timestamp: new Date().toISOString() }, artifacts: [] };
    tasks.set(id, { task, text, behavior, createdAt: Date.now() });
    return tasks.get(id);
  };

  const complete = (entry) => {
    entry.task.status = { state: 'completed', timestamp: new Date().toISOString() };
    entry.task.artifacts = [{
      artifactId: `art-${entry.task.id}`,
      name: 'research.md',
      parts: [{
        kind: 'text',
        mimeType: 'text/plain',
        text: [
          `# Result for: ${entry.text}`,
          '',
          'BTC dominance rose 1.2% over the window. Source: https://example.com/market/btc-dominance',
          '',
          'This is a conformance fixture, not market advice.'
        ].join('\n')
      }]
    }];
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');

    if (req.method === 'GET' && (url.pathname === '/.well-known/agent-card.json' || url.pathname === '/card')) {
      calls.card += 1;
      return json(res, 200, card);
    }

    if (req.method === 'POST' && url.pathname === '/oauth/token') {
      calls.token += 1;
      const body = await readBody(req);
      if (body.grant_type !== 'authorization_code' || !body.code_verifier) {
        return json(res, 400, { error: 'invalid_request' });
      }
      return json(res, 200, {
        access_token: `tok_${Math.random().toString(36).slice(2, 12)}`,
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'agent.read agent.task',
        account_label: 'conformance-user'
      });
    }

    if (req.method === 'POST' && url.pathname === '/rpc') {
      const body = await readBody(req);
      const { method, params, id: rpcId } = body;

      if (method === 'message/send') {
        calls.send += 1;
        const text = params?.message?.parts?.[0]?.text || '';
        const messageId = params?.message?.messageId || null;

        /* A conformant provider dedupes on messageId. The Hub relies on its own
           claim, but the double must not create a second task either, or a
           duplicated create would look like success in the test. */
        if (messageId && byMessageId.has(messageId)) {
          return json(res, 200, { jsonrpc: '2.0', id: rpcId, result: byMessageId.get(messageId).task });
        }

        if (/boom/i.test(text)) return json(res, 500, { error: 'upstream exploded' });

        const behavior = /drop/i.test(text) ? 'drop'
          : /message/i.test(text) ? 'message'
          : /slow/i.test(text) ? 'slow'
            : /fail/i.test(text) ? 'fail'
              : /input/i.test(text) ? 'input'
                : /hold/i.test(text) ? 'hold'
                  : 'instant';

        const entry = makeTask(text, behavior);
        if (messageId) byMessageId.set(messageId, entry);

        if (behavior === 'drop') {
          /* The response is lost after the task exists: the exact case where a
             second create would double-charge. */
          req.socket.destroy();
          return undefined;
        }
        if (behavior === 'message') {
          return json(res, 200, {
            jsonrpc: '2.0',
            id: rpcId,
            result: { kind: 'message', messageId: `msg-${sequence}`, role: 'agent', parts: [{ kind: 'text', text: 'Accepted; this provider cannot expose a task id.' }] }
          });
        }
        if (behavior === 'instant') {
          complete(entry);
          return json(res, 200, { jsonrpc: '2.0', id: rpcId, result: entry.task });
        }
        if (behavior === 'fail') {
          entry.task.status = { state: 'failed', timestamp: new Date().toISOString() };
          return json(res, 200, { jsonrpc: '2.0', id: rpcId, result: entry.task });
        }
        if (behavior === 'input') {
          entry.task.status = { state: 'input-required', message: { parts: [{ kind: 'text', text: 'Which chain?' }] } };
          return json(res, 200, { jsonrpc: '2.0', id: rpcId, result: entry.task });
        }
        if (behavior === 'slow') {
          entry.task.status = { state: 'working', timestamp: new Date().toISOString() };
          setTimeout(() => complete(entry), 600);
          return json(res, 200, { jsonrpc: '2.0', id: rpcId, result: entry.task });
        }
        return json(res, 200, { jsonrpc: '2.0', id: rpcId, result: entry.task });
      }

      if (method === 'tasks/get') {
        calls.get += 1;
        const entry = tasks.get(String(params?.id));
        if (!entry) return json(res, 200, { jsonrpc: '2.0', id: rpcId, error: { code: -32001, message: 'Task not found' } });
        return json(res, 200, { jsonrpc: '2.0', id: rpcId, result: entry.task });
      }

      if (method === 'tasks/cancel') {
        calls.cancel += 1;
        const entry = tasks.get(String(params?.id));
        if (!entry) return json(res, 200, { jsonrpc: '2.0', id: rpcId, error: { code: -32001, message: 'Task not found' } });
        entry.task.status = { state: 'canceled', timestamp: new Date().toISOString() };
        return json(res, 200, { jsonrpc: '2.0', id: rpcId, result: entry.task });
      }

      return json(res, 200, { jsonrpc: '2.0', id: rpcId, error: { code: -32601, message: `Method not found: ${method}` } });
    }

    return json(res, 404, { error: 'not_found', path: url.pathname });
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  return {
    base,
    cardUrl: `${base}/.well-known/agent-card.json`,
    rpcUrl: `${base}/rpc`,
    tokenUrl: `${base}/oauth/token`,
    calls,
    tasks,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

/** Direct-run convenience: `node test/agent-hub/conformance-server.mjs` */
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = await startConformanceServer({ port: Number(process.env.PORT) || 0 });
  console.log(`conformance A2A server: ${server.base}`);
  console.log(`  card: ${server.cardUrl}`);
  console.log(`  rpc:  ${server.rpcUrl}`);
}
