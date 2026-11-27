// @vitest-environment jsdom
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/components/MoreSheet', () => ({
  default: ({ open }) => <div data-testid="more-sheet">{open ? 'open' : 'closed'}</div>
}));
import LazyMoreSheet from '../src/components/LazyMoreSheet';

describe('lazy More menu', () => {
  it('does not mount before opening and stays mounted on close for its exit animation', async () => {
    const { rerender } = render(<LazyMoreSheet open={false} onClose={() => {}} />);
    expect(screen.queryByTestId('more-sheet')).toBeNull();
    rerender(<LazyMoreSheet open onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('more-sheet').textContent).toBe('open'));
    rerender(<LazyMoreSheet open={false} onClose={() => {}} />);
    expect(screen.getByTestId('more-sheet').textContent).toBe('closed');
  });
});
