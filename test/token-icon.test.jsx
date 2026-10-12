// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import TokenIcon from '../src/lib/tokenIcon.jsx';

afterEach(() => cleanup());

describe('token icon offline fallback', () => {
  it('uses the local SVG for a known RWA mark when no logo URL exists', () => {
    const { container } = render(<TokenIcon token={{ symbol: 'CFG' }} size={40} />);
    const svg = container.querySelector('.tok-icon-svg svg');
    expect(svg).toBeTruthy();
    expect(svg.getAttribute('width')).toBe('100%');
    expect(container.querySelector('img')).toBeNull();
  });

  it('falls back to local RWA artwork after remote catalog logos fail', async () => {
    const token = { symbol: 'PAXG', address: '0x1111111111111111111111111111111111111111' };
    const { container } = render(<TokenIcon token={token} chainId={1} size={40} />);
    const trustWalletLogo = container.querySelector('img');
    expect(trustWalletLogo.getAttribute('src')).toContain('assets-cdn.trustwallet.com');

    fireEvent.error(trustWalletLogo);
    await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toContain('raw.githubusercontent.com'));
    fireEvent.error(container.querySelector('img'));

    await waitFor(() => expect(container.querySelector('.tok-icon-svg svg')).toBeTruthy());
    expect(container.querySelector('img')).toBeNull();
  });
});
