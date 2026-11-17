// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ConversationRow } from '../../src/components/IntentAIUnified.jsx';
import { runChatNegotiation, negotiationToChatMessage } from '../../src/lib/intent-ai/chat/negotiationChat.js';
import { resolveNegotiationAction } from '../../src/lib/intent-ai/chat/negotiationActions.js';

afterEach(cleanup);
const mountChatMessage = (message, onOsChip = vi.fn()) => render(
  <ConversationRow m={message} locale="en" t={(key) => key} onOsChip={onOsChip} />
);
const freshNow = () => Date.now() + 1;
const proposal = { id: 'collab-proposal', action: 'risk-review', asset: 'BTC', amountUsd: 500, evidenceComplete: true };

describe('mounted chat collaboration lifecycle', () => {
  it('renders bounded participants, assignments and results, then separates review, consent, and plan hand-off', () => {
    const now = Date.now();
    const initial = negotiationToChatMessage(runChatNegotiation({
      mode: 'agent-agent', subject: 'Review BTC risk', context: { proposal }, locale: 'en', now
    }), { locale: 'en' });
    const onOsChip = vi.fn();
    const view = mountChatMessage(initial, onOsChip);
    const card = screen.getByTestId('intent-os-collaboration');
    expect(card.textContent).toContain('FBT execution engine');
    expect(card.textContent).toContain('FBT rule-based council');
    expect(card.textContent).toContain('Independent proposal challenge');
    expect(card.textContent).toContain('Bounded internal council');
    expect(card.textContent).toContain('Awaiting review');
    expect(card.textContent).toContain('No execution or external contact is authorized.');

    fireEvent.click(screen.getByRole('button', { name: 'Review draft' }));
    expect(onOsChip).toHaveBeenCalledOnce();
    const reviewed = resolveNegotiationAction({
      event: initial.osEvent, chipId: 'collab-review-accept', now: freshNow(), locale: 'en'
    });
    expect(reviewed.message.osEvent.payload.collaboration.review.status).toBe('REVIEWED');
    expect(reviewed.message.osEvent.payload.collaboration.consent.local.status).toBe('NOT_RECORDED');

    view.rerender(<ConversationRow m={reviewed.message} locale="en" t={(key) => key} onOsChip={onOsChip} />);
    expect(screen.getByRole('button', { name: 'Consent to planning' })).toBeTruthy();
    const consented = resolveNegotiationAction({
      event: reviewed.message.osEvent, chipId: 'collab-consent', now: freshNow(), locale: 'en'
    });
    expect(consented.message.osEvent.payload.collaboration.consent.local.scope).toBe('planning-only');
    expect(consented.message.osEvent.payload.collaboration.executionAuthorized).toBe(false);

    view.rerender(<ConversationRow m={consented.message} locale="en" t={(key) => key} onOsChip={onOsChip} />);
    fireEvent.click(screen.getByRole('button', { name: 'Build plan draft' }));
    const handoff = resolveNegotiationAction({
      event: consented.message.osEvent, chipId: 'collab-build-plan', now: freshNow(), locale: 'en'
    });
    expect(handoff.message.strategyRequest || handoff.intake).toBeTruthy();
    expect(handoff.additionalMessages).toHaveLength(1);
    const handoffSession = handoff.additionalMessages[0].osEvent.payload.collaboration;
    expect(handoffSession.planDraftState).toBe('REQUESTED');
    expect(handoffSession.state).toBe('PLAN_REQUESTED');
    expect(handoffSession.executed).toBe(false);
    expect(handoffSession.contactedCounterparty).toBe(false);
    expect(handoffSession.agreementReached).toBe(false);

    view.rerender(<ConversationRow m={handoff.additionalMessages[0]} locale="en" t={(key) => key} onOsChip={onOsChip} />);
    expect(screen.getByText('Plan requested')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Build plan draft' })).toBeNull();
  });

  it('records a human risk choice and displays a counterparty report as unverified', () => {
    const now = Date.now();
    const humanAgent = negotiationToChatMessage(runChatNegotiation({
      mode: 'human-agent', subject: 'Review BTC risk', context: { proposal }, locale: 'en', now
    }), { locale: 'en' });
    const view = mountChatMessage(humanAgent);
    expect(screen.getByTestId('intent-os-collaboration').textContent).toContain('Awaiting your input');
    const selected = resolveNegotiationAction({
      event: humanAgent.osEvent, chipId: 'pick_balanced', now: freshNow(), locale: 'en'
    });
    const selectedSession = selected.message.osEvent.payload.collaboration;
    expect(selectedSession.tasks.find((task) => task.id === 'risk-choice').result.text).toBe('balanced');
    expect(selectedSession.tasks.find((task) => task.id === 'risk-choice').status).toBe('COMPLETED');
    view.rerender(<ConversationRow m={selected.message} locale="en" t={(key) => key} onOsChip={vi.fn()} />);
    expect(screen.getByTestId('intent-os-collaboration').textContent).toContain('balanced');
    expect(screen.getByRole('button', { name: 'Review draft' })).toBeTruthy();

    const terms = negotiationToChatMessage(runChatNegotiation({
      mode: 'human-human', subject: 'OTC BTC terms',
      context: { proposal: { ...proposal, action: 'agreement' }, counterparty: { label: 'Alex' }, deadlineDays: 7 },
      locale: 'en', now
    }), { locale: 'en' });
    view.rerender(<ConversationRow m={terms} locale="en" t={(key) => key} onOsChip={vi.fn()} />);
    const reviewed = resolveNegotiationAction({
      event: terms.osEvent, chipId: 'collab-review-accept', now: freshNow(), locale: 'en'
    });
    const localAcceptance = resolveNegotiationAction({
      event: reviewed.message.osEvent, chipId: 'h2h-confirm', now: freshNow(), locale: 'en'
    });
    expect(localAcceptance.message.osEvent.payload.collaboration.consent.local.status).toBe('LOCAL_ACCEPTANCE_ONLY');
    expect(localAcceptance.message.osEvent.payload.collaboration.consent.counterparty.status).toBe('NOT_VERIFIED');
    expect(localAcceptance.message.osEvent.payload.collaboration.consent.mutual).toBe(false);

    const question = resolveNegotiationAction({
      event: localAcceptance.message.osEvent, chipId: 'collab-counterparty-report', now: freshNow(), locale: 'en'
    });
    expect(question.question.expectedType).toBe('text');
    const report = resolveNegotiationAction({
      event: question.message.osEvent,
      text: 'Alex reportedly agreed to the draft',
      context: { answerToNegotiation: true }, now: freshNow(), locale: 'en'
    });
    const reportSession = report.message.osEvent.payload.collaboration;
    const counterpartyTask = reportSession.tasks.find((task) => task.id === 'counterparty-review');
    expect(counterpartyTask.status).toBe('REPORTED_UNVERIFIED');
    expect(counterpartyTask.result.verified).toBe(false);
    expect(reportSession.consent.counterparty.status).toBe('NOT_VERIFIED');
    expect(reportSession.executionAuthorized).toBe(false);

    view.rerender(<ConversationRow m={report.message} locale="en" t={(key) => key} onOsChip={vi.fn()} />);
    expect(screen.getByTestId('intent-os-collaboration').textContent).toContain('Reported — unverified');
    expect(screen.getByTestId('intent-os-collaboration').textContent).toMatch(/Not verified/i);
  });

  it('renders blocked external gates even when the caller pastes verification flags and a view', () => {
    const message = negotiationToChatMessage(runChatNegotiation({
      mode: 'fbt-external-agent', locale: 'en', now: Date.now(),
      context: {
        externalVerified: true, externalConsent: true,
        externalAgent: { id: 'outside-agent', securityStatus: 'verified' },
        externalView: 'Bullish analysis', runtime: { attested: true, operational: true }
      }
    }), { locale: 'en' });
    mountChatMessage(message);
    const gates = screen.getByTestId('intent-os-external-gate');
    expect(gates.querySelectorAll('[data-gate-status="blocked"]')).toHaveLength(3);
    expect(screen.queryByText('Bullish analysis')).toBeNull();
    expect(message.osEvent.payload.agreement).not.toBe(true);
  });
});
