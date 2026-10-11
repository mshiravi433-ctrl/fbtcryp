// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NeuralCore from '../src/components/chat/NeuralCore.jsx';
import { AIActivityTimeline } from '../src/components/ai/ThinkingOrb.jsx';

describe('Neural Command presentation reads real state', () => {
  it('reflects processing and failed connectivity without inventing health', () => {
    const { container, rerender } = render(<NeuralCore state="processing" />);
    expect(container.querySelector('.nc-core').dataset.state).toBe('processing');
    rerender(<NeuralCore state="warning" />);
    expect(container.querySelector('.nc-core').dataset.state).toBe('warning');
    expect(container.querySelector('.nc-core').getAttribute('aria-hidden')).toBe('true');
  });
  it('does not turn pending analysis or execution into completion', () => {
    render(<AIActivityTimeline locale="en" steps={[
      { id: 'analysis', labelEn: 'Analysis', status: 'completed' },
      { id: 'approval', labelEn: 'Awaiting approval', status: 'active' },
      { id: 'execution', labelEn: 'Execution', status: 'pending' }
    ]} defaultOpen />);
    expect(screen.getByTestId('ai-activity-timeline').textContent).toContain('1/3');
    expect(screen.getByText('Execution').closest('.ai-timeline-step').dataset.status).toBe('pending');
    fireEvent.click(screen.getByTestId('ai-activity-timeline-toggle'));
    expect(screen.getByTestId('ai-activity-timeline-toggle').getAttribute('aria-expanded')).toBe('false');
  });
});
