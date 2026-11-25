// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import TokenIcon, { iconCandidates } from '../src/lib/tokenIcon.jsx';

afterEach(() => cleanup());

describe('token icon offline fallback', () => {
  it('uses the local SVG for a known RWA mark when no logo URL exists', () => {
    const { container } = render(<TokenIcon token={{ symbol: 'CFG' }} size={40} />);
    const image = container.querySelector('img');
    if (image) fireEvent.error(image);
    const svg = container.querySelector('.tok-icon-svg svg');
    expect(svg).toBeTruthy();
    expect(svg.getAttribute('width')).toBe('100%');
    expect(container.querySelector('img')).toBeNull();
  });

  it('only applies branded fallback to matching registered contracts', () => {
    const fake = { symbol: 'USDT', address: '0x1111111111111111111111111111111111111111' };
    expect(iconCandidates(fake, 1).some((url) => url.includes('Tether.png'))).toBe(false);
    const real = { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' };
    expect(iconCandidates(real, 1).some((url) => url.includes('Tether.png'))).toBe(true);
    expect(iconCandidates({ symbol: 'USDT', mint: 'fakeMint' }, 1).some((url) => url.includes('Tether.png'))).toBe(false);
  });

  it('does not give an unknown contract a known RWA logo after remote logos fail', async () => {
    const token = { symbol: 'PAXG', address: '0x1111111111111111111111111111111111111111' };
    const { container } = render(<TokenIcon token={token} chainId={1} size={40} />);
    const trustWalletLogo = container.querySelector('img');
    expect(trustWalletLogo.getAttribute('src')).toContain('assets-cdn.trustwallet.com');

    fireEvent.error(trustWalletLogo);
    await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toContain('raw.githubusercontent.com'));
    fireEvent.error(container.querySelector('img'));

    await waitFor(() => expect(container.querySelector('img')).toBeNull());
    expect(container.querySelector('.tok-icon-svg svg')).toBeNull();
    expect(container.textContent).toContain('PAX');
  });
});
