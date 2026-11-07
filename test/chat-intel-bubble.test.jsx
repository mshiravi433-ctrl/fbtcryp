// @vitest-environment jsdom
/**
 * THE BUBBLE CARRIES THE ROOM
 * ---------------------------------------------------------------------------
 * The human layer (proved in test/chat-intel-rooms.test.mjs) attaches a room
 * card; the room itself is proved in test/chat-intel-rooms.test.jsx. This file
 * closes the gap between them: the conversation row really mounts the room for
 * each card kind, marks the bubble as an intelligence answer, and — because a
 * long thread must not poll for every old answer — leaves every room but the
 * latest COLLAPSED (no request, no body).
 */
import { describe, expect, it, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('../src/context/WalletContext', () => ({ useWallet: () => ({ isConnected: false, address: null }) }));
vi.mock('../src/context/TelegramContext', () => ({ useTelegram: () => ({ haptic: () => {} }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k, i18n: { language: 'en' } }) }));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_, tag) => ({ children, ...props }) => {
      const Tag = String(tag);
      const clean = Object.fromEntries(Object.entries(props).filter(([k]) => !['initial', 'animate', 'exit', 'transition', 'whileTap', 'whileHover', 'layout', 'layoutId', 'variants'].includes(k)));
      return <Tag {...clean}>{children}</Tag>;
    }
  }),
  AnimatePresence: ({ children }) => children,
  useReducedMotion: () => true
}));

import { ConversationRow } from '../src/components/IntentAIUnified';

const rowProps = (m, isLatest = false) => ({
  m,
  isLatest,
  t: (key) => key,
  locale: 'en',
  onConnectWallet: () => {}, onChoose: () => {}, onMonitorAction: () => {},
  onMonitorOpportunity: () => {}, onFeedback: () => {}, onOpenRoute: () => {},
  onGoalExecute: () => {}, onStrategyExecute: () => {}, onStrategyMonitor: () => {},
  onStrategyRevise: () => {}, strategyLive: false, autonomyEngine: null,
  autonomyStrategies: [], onAutonomyArm: () => {}, onAutonomyDisarm: () => {},
  onAutonomyMode: () => {}, onAutonomyStart: () => {}, onAutonomyStop: () => {},
  onAutonomyTick: () => {}
});

const answer = (card, ui = 'TEXT') => ({
  id: 'm1', role: 'ai', kind: 'assistant', content: '…', ui: { type: ui }, card
});

describe('an intelligence answer carries its room in the bubble', () => {
  it('mounts the market room for a MARKET card', () => {
    const { container } = render(<ConversationRow {...rowProps(answer({ kind: 'MARKET', room: 'overview' }, 'MARKET_CARD'))} />);
    expect(container.querySelector('[data-testid="intent-ai-market-room"]')).toBeTruthy();
    expect(container.querySelector('.iaos-msg.iaos-has-intel')).toBeTruthy();
    cleanup();
  });

  it('mounts the token room for a TOKEN card, next to the compact read', () => {
    const { container } = render(<ConversationRow {...rowProps(answer({ kind: 'TOKEN', coinId: 'bitcoin', symbol: 'BTC', priceUsd: 61234.5 }, 'TOKEN_CARD'))} />);
    expect(container.querySelector('[data-testid="intent-ai-token-card"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="intent-ai-token-room"]')).toBeTruthy();
    cleanup();
  });

  it('mounts the portfolio room for a PORTFOLIO card', () => {
    const { container } = render(<ConversationRow {...rowProps(answer({ kind: 'PORTFOLIO', status: 'live', rows: [] }, 'PORTFOLIO_CARD'))} />);
    expect(container.querySelector('[data-testid="intent-ai-portfolio-room"]')).toBeTruthy();
    cleanup();
  });

  it('keeps older rooms collapsed — only the latest answer opens its body', () => {
    const card = { kind: 'MARKET', room: 'overview' };
    const old = render(<ConversationRow {...rowProps(answer(card, 'MARKET_CARD'), false)} />);
    expect(old.container.querySelector('[data-testid="intent-ai-market-room"]')?.className).not.toContain('is-open');
    expect(old.container.querySelector('.aix-room-body')).toBeNull();
    cleanup();

    const latest = render(<ConversationRow {...rowProps(answer(card, 'MARKET_CARD'), true)} />);
    expect(latest.container.querySelector('[data-testid="intent-ai-market-room"]')?.className).toContain('is-open');
    cleanup();
  });

  it('leaves a plain text answer exactly as it was', () => {
    const { container } = render(<ConversationRow {...rowProps({ id: 'm2', role: 'ai', kind: 'assistant', content: 'Hello.', ui: { type: 'TEXT' } })} />);
    expect(container.querySelector('.iaos-msg')?.className).not.toContain('iaos-has-intel');
    expect(container.querySelector('.iaos-msg-text')?.textContent).toBe('Hello.');
    cleanup();
  });
});
