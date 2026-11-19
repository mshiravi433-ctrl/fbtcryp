// @vitest-environment jsdom
/**
 * External agents — the key popup and the connection it claims.
 *
 * The complaint this feature answers was precise: a directory card opened the
 * vendor's website and stopped. So the assertions here are about behaviour, not
 * decoration:
 *
 *   · every external card has a key/connection entry point;
 *   · a connect attempt is a REAL request to the hub, carrying the pasted key
 *     exactly once, and the success text only appears when the server said ok;
 *   · a rejection is never dressed as success;
 *   · a vendor with no key bridge says so and shows no key field;
 *   · a connected AI seat can be asked a domain question and the answer carries
 *     the provider's own name.
 *
 * `fetch` is stubbed at the transport boundary; the component, the client and
 * the state machine are the real ones.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ConnectKeyDialog from '../../src/components/AgentHub/ConnectKeyDialog.jsx';
import RecommendedAgents from '../../src/components/AgentHub/RecommendedAgents.jsx';
import { RECOMMENDED_EXTERNAL_AGENTS } from '../../src/lib/intent-ai/agentHub/recommendations.js';

const KEY = 'sk-test-key-abcdef123456';

const providersPayload = (overrides = {}) => ({
  ok: true,
  status: 200,
  providers: [
    {
      id: 'openai',
      name: 'OpenAI',
      vendor: 'OpenAI',
      kind: 'ai',
      requiresModel: true,
      docsUrl: 'https://platform.openai.com/docs',
      siteUrl: 'https://openai.com',
      keyUrl: 'https://platform.openai.com/api-keys',
      authLabel: 'authorization: …',
      defaultModel: 'gpt-4o-mini',
      domainUse: { fa: 'پرسش تحلیلی بازار', en: 'Market analysis questions' },
      connected: false,
      status: 'UNCONNECTED',
      ...overrides
    },
    {
      id: 'coingecko',
      name: 'CoinGecko',
      vendor: 'CoinGecko',
      kind: 'data',
      requiresModel: false,
      docsUrl: 'https://docs.coingecko.com',
      siteUrl: 'https://www.coingecko.com',
      keyUrl: 'https://www.coingecko.com/en/developers/dashboard',
      proofLabel: { fa: 'پاسخ زندهٔ CoinGecko', en: 'Live CoinGecko reply' },
      domainUse: { fa: 'قیمت', en: 'Prices' },
      connected: false,
      status: 'UNCONNECTED'
    }
  ]
});

function stubFetch({ list = providersPayload(), connect = null, ask = null } = {}) {
  const calls = [];
  global.fetch = vi.fn(async (url, init = {}) => {
    const target = String(url);
    calls.push({ url: target, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    let payload;
    if (target.endsWith('/provider-keys')) payload = list;
    else if (target.includes('/connect')) {
      payload =
        connect ||
        {
          ok: true,
          status: 200,
          provider: { ...providersPayload().providers[0], connected: true, status: 'ACTIVE', hint: '••••3456', model: 'gpt-4o-mini-2024-07-18' },
          verified: { latencyMs: 412, modelCount: 51, proof: null }
        };
    } else if (target.includes('/ask')) {
      payload = ask || { ok: true, status: 200, answer: 'بازار لانگ شلوغ است.', model: 'gpt-4o-mini', attribution: 'OpenAI · gpt-4o-mini', latencyMs: 880, asksRemaining: 19 };
    } else payload = { ok: false, status: 404, code: 'NOT_FOUND' };
    const status = payload.status || 200;
    return {
      ok: status < 400,
      status,
      async text() {
        return JSON.stringify(payload);
      }
    };
  });
  return calls;
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('every external card has a key entry point', () => {
  it('renders a key/connection button on each directory card and hands the card to the dialog', () => {
    stubFetch();
    const onOpenKey = vi.fn();
    render(<RecommendedAgents fa onOpenKey={onOpenKey} nativeAgents={[]} />);
    const first = RECOMMENDED_EXTERNAL_AGENTS[0];
    const id = String(first.id).replace(/[^A-Za-z0-9_-]+/g, '-');
    const button = screen.getByTestId(`agent-hub-recommendation-key-${id}`);
    expect(button).toBeTruthy();
    fireEvent.click(button);
    expect(onOpenKey).toHaveBeenCalledTimes(1);
    expect(onOpenKey.mock.calls[0][0].id).toBe(first.id);
    /* Every rendered card must have one — a card with only an outbound link is
       the regression this feature exists to prevent. */
    for (const agent of RECOMMENDED_EXTERNAL_AGENTS.slice(0, 8)) {
      expect(screen.getByTestId(`agent-hub-recommendation-key-${String(agent.id).replace(/[^A-Za-z0-9_-]+/g, '-')}`)).toBeTruthy();
    }
  });
});

describe('connect a third-party key', () => {
  it('posts the pasted key once, then reports the verified seat', async () => {
    const calls = stubFetch();
    const onChanged = vi.fn();
    render(<ConnectKeyDialog fa target={{ id: 'chatgpt', name: 'ChatGPT', vendor: 'OpenAI', mark: 'AI', bridgeId: 'openai' }} onChanged={onChanged} />);

    const input = await screen.findByTestId('agent-hub-key-input');
    fireEvent.change(input, { target: { value: KEY } });
    const button = screen.getByTestId('agent-hub-key-connect');
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);

    await waitFor(() => expect(screen.getByTestId('agent-hub-key-verified')).toBeTruthy());
    const posted = calls.filter((call) => call.url.includes('/connect'));
    expect(posted).toHaveLength(1);
    expect(posted[0].url).toContain('/ai/agent-hub/provider-keys/openai/connect');
    expect(posted[0].body).toEqual({ secret: KEY });
    expect(input.value).toBe('', 'the pasted key is cleared from the field after a successful connect');
    expect(screen.getByTestId('agent-hub-key-verified').textContent).toContain('412ms');
    expect(onChanged).toHaveBeenCalled();
  });

  it('never dresses a rejected key as success', async () => {
    stubFetch({
      connect: { ok: false, status: 502, code: 'PROVIDER_REJECTED_KEY', detail: 'invalid api key provided' }
    });
    render(<ConnectKeyDialog fa target={{ id: 'chatgpt', name: 'ChatGPT', vendor: 'OpenAI', bridgeId: 'openai' }} />);
    fireEvent.change(await screen.findByTestId('agent-hub-key-input'), { target: { value: KEY } });
    fireEvent.click(screen.getByTestId('agent-hub-key-connect'));
    const error = await screen.findByTestId('agent-hub-key-error');
    expect(error.textContent).toContain('PROVIDER_REJECTED_KEY');
    expect(screen.queryByTestId('agent-hub-key-verified')).toBeNull();
    expect(screen.getByTestId('agent-hub-key-status').textContent).toContain('کلید ذخیره نشده');
  });

  it('does not ask for a key on a vendor with no bridge, and says why', async () => {
    stubFetch();
    render(
      <ConnectKeyDialog
        fa
        target={{ id: '1inch', name: '1inch', vendor: '1inch Network', productUrl: 'https://1inch.io', docsUrl: 'https://docs.1inch.io', bridgeId: null }}
      />
    );
    expect(await screen.findByTestId('agent-hub-key-no-bridge')).toBeTruthy();
    expect(screen.queryByTestId('agent-hub-key-input')).toBeNull();
    expect(screen.queryByTestId('agent-hub-key-connect')).toBeNull();
  });
});

describe('ask through the connected seat', () => {
  it('shows the answer with its provider attribution', async () => {
    const calls = stubFetch({
      list: providersPayload({
        connected: true,
        status: 'ACTIVE',
        hint: '••••3456',
        model: 'gpt-4o-mini-2024-07-18'
      })
    });
    render(<ConnectKeyDialog fa target={{ id: 'chatgpt', name: 'ChatGPT', vendor: 'OpenAI', bridgeId: 'openai' }} />);

    const box = await screen.findByTestId('agent-hub-key-question');
    fireEvent.change(box, { target: { value: 'ریسک لانگ ETH؟' } });
    fireEvent.click(screen.getByTestId('agent-hub-key-ask'));

    const answer = await screen.findByTestId('agent-hub-key-answer');
    expect(answer.textContent).toContain('OpenAI · gpt-4o-mini');
    const posted = calls.filter((call) => call.url.includes('/ask'));
    expect(posted).toHaveLength(1);
    expect(posted[0].body).toEqual({ question: 'ریسک لانگ ETH؟', context: '' });
  });

  it('does not offer a text question on a data-only seat', async () => {
    stubFetch({ list: providersPayload() });
    stubFetch({
      list: {
        ok: true,
        status: 200,
        providers: [
          { ...providersPayload().providers[1], connected: true, status: 'ACTIVE', hint: '••••1234', proof: '(V3) To the Moon!' }
        ]
      }
    });
    render(<ConnectKeyDialog fa target={{ id: 'coingecko', name: 'CoinGecko', vendor: 'CoinGecko', bridgeId: 'coingecko' }} />);
    await waitFor(() => expect(screen.getByTestId('agent-hub-key-status').textContent).toContain('متصل'));
    expect(screen.queryByTestId('agent-hub-key-question')).toBeNull();
    /* The live value the vendor returned is the proof the key works. */
    expect(screen.getByTestId('agent-hub-key-dialog-coingecko').textContent).toContain('(V3) To the Moon!');
  });
});
