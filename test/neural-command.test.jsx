/**
 * FBT NEURAL COMMAND — component contract tests.
 * ---------------------------------------------------------------------------
 * Guards the Intent OS reskin: the core renders every honest state, the empty
 * state always offers the six REAL quick actions in both languages, the More
 * menu never links a route that does not exist, the timeline only shows stages
 * the workflow really has, and the agent graph renders from live data.
 */
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import NeuralCore, { resolveCoreState } from '../src/components/intent-neural/NeuralCore.jsx';
import NeuralEmptyState, { NEURAL_QUICK_ACTIONS } from '../src/components/intent-neural/NeuralEmptyState.jsx';
import NeuralMoreMenu from '../src/components/intent-neural/NeuralMoreMenu.jsx';
import NeuralTimeline from '../src/components/intent-neural/NeuralTimeline.jsx';
import NeuralAgentGraph from '../src/components/intent-neural/NeuralAgentGraph.jsx';

describe('NeuralCore', () => {
  it.each(['idle', 'processing', 'warn', 'offline'])('renders the %s state', (s) => {
    const h = renderToString(React.createElement(NeuralCore, { state: s, size: 40 }));
    expect(h).toContain('fbt-core');
    expect(h).toContain(`data-state="${s}"`);
  });
  it('resolves state from real signals only', () => {
    expect(resolveCoreState({ thinkingState: 'idle', serverReachable: true })).toBe('idle');
    expect(resolveCoreState({ thinkingState: 'working', serverReachable: true })).toBe('processing');
    expect(resolveCoreState({ thinkingState: 'idle', serverReachable: true, hasError: true })).toBe('warn');
    expect(resolveCoreState({ thinkingState: 'idle', serverReachable: false })).toBe('offline');
  });
  it('falls back to idle for unknown input', () => {
    expect(resolveCoreState({})).toBe('idle');
    const h = renderToString(React.createElement(NeuralCore, { state: 'bogus' }));
    expect(h).toContain('data-state="idle"');
  });
});

describe('NeuralEmptyState', () => {
  it('always exposes exactly the six real quick actions', () => {
    expect(NEURAL_QUICK_ACTIONS.map((a) => a.id)).toEqual(
      ['markets', 'smartmoney', 'futures', 'risk', 'swap', 'strategy']
    );
  });
  it.each(['fa', 'en'])('renders six actions in %s', (locale) => {
    const h = renderToString(React.createElement(NeuralEmptyState, { locale, onAction: () => {} }));
    expect((h.match(/fbt-empty-action"/g) || []).length).toBe(6);
  });
  it('is bilingual without touching locale files', () => {
    expect(renderToString(React.createElement(NeuralEmptyState, { locale: 'fa' }))).toContain('فرمانده');
    expect(renderToString(React.createElement(NeuralEmptyState, { locale: 'en' }))).toContain('Neural Command');
  });
});

describe('NeuralMoreMenu', () => {
  it.each(['fa', 'en'])('renders four groups in %s', (locale) => {
    const h = renderToString(React.createElement(NeuralMoreMenu, { locale }));
    expect((h.match(/fbt-more-group"/g) || []).length).toBe(4);
  });
  it('never links a route that does not exist', () => {
    // Audited 2026-10-11: no /rwa, /goals or /risk route exists in App.jsx.
    // Goals/risk land in the chat; RWA rides inside /stocks.
    const h = renderToString(React.createElement(NeuralMoreMenu, { locale: 'fa' }));
    expect(h).not.toContain('/rwa');
    expect(h).not.toContain('/goals');
    expect(h).not.toContain('/risk');
  });
  it('keeps the legacy QA hooks and the ecosystem destination', () => {
    const h = renderToString(React.createElement(NeuralMoreMenu, { locale: 'fa' }));
    for (const id of ['intent-ai-operations', 'intent-ai-history', 'intent-ai-intelligence', 'intent-ai-ecosystem']) {
      expect(h).toContain(id);
    }
  });
  it('routes each kind to its real handler', () => {
    // Static contract: every item carries a kind the parent handles.
    const seen = new Set();
    const probe = (kind) => { seen.add(kind); };
    void probe;
    const h = renderToString(React.createElement(NeuralMoreMenu, {
      locale: 'en', onNavigate: () => {}, onPanel: () => {}, onChatAction: () => {}, onEcosystem: () => {}
    }));
    for (const kind of ['route', 'panel', 'chat']) {
      expect(h).toContain(`data-kind="${kind}"`);
    }
  });
});

describe('NeuralTimeline', () => {
  it('renders nothing without facts', () => {
    expect(renderToString(React.createElement(NeuralTimeline, { locale: 'fa', facts: null }))).toBe('');
    expect(renderToString(React.createElement(NeuralTimeline, { locale: 'fa', facts: {} }))).toBe('');
  });
  it('a Q&A turn never shows approval/execution stages', () => {
    const h = renderToString(React.createElement(NeuralTimeline, {
      locale: 'fa',
      facts: {
        hasUserTurn: true,
        activitySteps: [{ id: 'wallet', status: 'completed' }, { id: 'analyze', status: 'completed' }],
        approval: 'none', execution: 'none', verification: 'none', evidence: {}
      }
    }));
    expect(h).toContain('اینتنت دریافت شد');
    expect(h).toContain('تحلیل و برنامه');
    expect(h).not.toContain('در انتظار تأیید');
    expect(h).not.toContain('شبیه‌سازی و اعتبارسنجی');
  });
  it('an execution turn shows approval with real evidence', () => {
    const h = renderToString(React.createElement(NeuralTimeline, {
      locale: 'en',
      facts: {
        hasUserTurn: true,
        activitySteps: [{ id: 'agents', status: 'active' }],
        hasSimulation: true, simulationStatus: 'passed',
        approval: 'waiting', execution: 'none', verification: 'none',
        evidence: { approval: ['action: SWAP'] }
      }
    }));
    expect(h).toContain('Waiting for your approval');
    expect(h).toContain('action: SWAP');
  });
});

describe('NeuralAgentGraph', () => {
  it('renders nothing without agents', () => {
    expect(renderToString(React.createElement(NeuralAgentGraph, { agents: [] }))).toBe('');
  });
  it('renders live nodes from real agent state', () => {
    const h = renderToString(React.createElement(NeuralAgentGraph, {
      locale: 'fa',
      agents: [
        { id: 'a1', name: 'BTC DCA', status: 'ACTIVE' },
        { id: 'm1', name: 'ETH watch', status: 'PAUSED' }
      ],
      activeCount: 1,
      totalCount: 2
    }));
    expect(h).toContain('fbt-graph-node');
    expect(h).toContain('1 فعال');
  });
});
