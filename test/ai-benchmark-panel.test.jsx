// @vitest-environment jsdom
/**
 * AI BENCHMARK DASHBOARD — render contract
 * ---------------------------------------------------------------------------
 * The panel's whole reason to exist is that a saved setting is not a
 * connection. These tests pin the three visible consequences:
 *
 *   1. a configured provider that has never answered says
 *      «کلید دارد · متصل نیست» and its row carries data-connected="false";
 *   2. tokens, error rate, failover and the last health check are rendered
 *      from the payload, not invented;
 *   3. a lab run and a benchmark run are POSTed and their real response is
 *      what appears — including SKIPPED as skipped, never as a pass.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

import AiBenchmarkPanel from '../src/components/ai/AiBenchmarkPanel.jsx';

const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);

const status = {
  ok: true,
  suite: {
    version: '1.0.0',
    size: 100,
    categories: [{ id: 'market', count: 10 }],
    flags: { needsLiveData: 40, execution: 5, multiModel: 5 }
  },
  providers: [
    {
      id: 'openai', name: 'OpenAI GPT', configured: true, connected: true, verdict: 'HEALTHY',
      modelId: 'gpt-4o-mini', lastSuccessfulRequest: new Date(NOW).toISOString(),
      lastHealthCheck: NOW, responseLatencyMs: 1200, tokensIn: 100, tokensOut: 50,
      errorRate: 0.1, failover: { circuitOpen: false, reason: null }
    },
    {
      id: 'xai', name: 'xAI Grok', configured: true, connected: false, verdict: 'ERROR:AUTH',
      modelId: 'grok-4-fast', lastSuccessfulRequest: null, lastHealthCheck: null,
      responseLatencyMs: null, tokensIn: 0, tokensOut: 0, errorRate: 1,
      failover: { circuitOpen: true, reason: 'AUTH' }
    },
    {
      id: 'gemini', name: 'Google Gemini', configured: false, connected: false, verdict: 'NEEDS_KEY',
      modelId: 'gemini-2.5-flash', tokensIn: 0, tokensOut: 0, failover: { circuitOpen: false }
    }
  ],
  benchmark: {
    lastRun: {
      mode: 'single',
      startedAt: NOW,
      summary: { passed: 4, questions: 5, errors: 1, totalTokens: 150, avgScore: 78 },
      leaderboard: [{ provider: 'openai', avgScore: 78, passRate: 0.8, questions: 5, costEstimateUsd: 0.01 }]
    }
  },
  lab: null
};

const labReport = {
  ok: true,
  report: {
    summary: { passed: 1, failed: 0, skipped: 1, inconclusive: 0, executed: 1, connectedProviders: [] },
    tests: [
      { id: 'gpt', fa: 'تست GPT', en: 'GPT direct test', method: 'LIVE', status: 'PASS', model: 'gpt-4o-mini', latencyMs: 900 },
      { id: 'grok', fa: 'تست Grok', en: 'Grok direct test', method: 'LIVE', status: 'SKIPPED', reasonCode: 'NEEDS_KEY' }
    ]
  }
};

const runReport = {
  ok: true,
  run: {
    mode: 'single',
    startedAt: NOW,
    summary: { passed: 8, questions: 10, errors: 0, totalTokens: 900, avgScore: 81 },
    aggregate: {
      leaderboard: [{ provider: 'openai', avgScore: 81, passRate: 0.8, questions: 10, costEstimateUsd: 0.02 }]
    }
  }
};

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body)
  };
}

let calls;
function stubFetch() {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    if (String(url).includes('/intelligence/status')) return jsonResponse(status);
    if (String(url).includes('/lab/run')) return jsonResponse(labReport);
    if (String(url).includes('/benchmark/run')) return jsonResponse(runReport);
    return jsonResponse({ ok: false, error: 'UNEXPECTED_ROUTE' });
  }));
}

beforeEach(() => { stubFetch(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('AI benchmark dashboard', () => {
  it('counts the suite and separates "answered" from "key present"', async () => {
    render(<AiBenchmarkPanel locale="fa" />);
    await screen.findByTestId('ai-benchmark-panel');

    expect(screen.getByText('100')).toBeTruthy();
    expect(screen.getByTestId('iab-provider-openai').getAttribute('data-connected')).toBe('true');
    expect(screen.getByTestId('iab-provider-xai').getAttribute('data-connected')).toBe('false');
    expect(screen.getByText('کلید دارد · متصل نیست')).toBeTruthy();
    expect(screen.getByText('قطع')).toBeTruthy();
  });

  it('renders token, latency, error rate and failover evidence from the payload', async () => {
    render(<AiBenchmarkPanel locale="en" />);
    await screen.findByTestId('ai-benchmark-panel');
    const openai = screen.getByTestId('iab-provider-openai');
    expect(openai.textContent).toContain('100 / 50');
    expect(openai.textContent).toContain('1.2kms');
    expect(openai.textContent).toContain('10%');
    expect(openai.textContent).toContain('Connected');
    const xai = screen.getByTestId('iab-provider-xai');
    expect(xai.textContent).toContain('Parked');
    expect(xai.textContent).toContain('AUTH');
  });

  it('runs the lab and shows SKIPPED as skipped, not as a pass', async () => {
    render(<AiBenchmarkPanel locale="fa" />);
    await screen.findByTestId('ai-benchmark-panel');
    fireEvent.click(screen.getByTestId('iab-run-lab'));

    await screen.findByTestId('iab-lab-gpt');
    expect(screen.getByTestId('iab-lab-gpt').getAttribute('data-status')).toBe('PASS');
    expect(screen.getByTestId('iab-lab-grok').getAttribute('data-status')).toBe('SKIPPED');
    const post = calls.find((c) => c.url.includes('/lab/run'));
    expect(post?.method).toBe('POST');
  });

  it('runs a smoke benchmark and renders the real leaderboard it returned', async () => {
    render(<AiBenchmarkPanel locale="en" />);
    await screen.findByTestId('ai-benchmark-panel');
    fireEvent.click(screen.getByTestId('iab-run-benchmark'));

    await waitFor(() => {
      expect(screen.getByTestId('iab-score-openai')).toBeTruthy();
    });
    expect(screen.getByTestId('iab-score-openai').textContent).toContain('81');
    const post = calls.find((c) => c.url.includes('/benchmark/run'));
    expect(post?.method).toBe('POST');
    expect(post?.body?.smoke).toBe(true);
    expect(post?.body?.mode).toBe('single');
  });

  it('never fabricates a benchmark when the read fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, text: async () => JSON.stringify({ error: 'BOOM' }) })));
    render(<AiBenchmarkPanel locale="fa" />);
    await screen.findByTestId('iab-read-error');
    expect(screen.getByTestId('iab-no-run')).toBeTruthy();
  });
});
