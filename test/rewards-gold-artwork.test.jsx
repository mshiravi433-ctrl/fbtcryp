// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import TierTotem from '../src/components/rewards/TierTotem';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key })
}));
afterEach(cleanup);

describe('gold lion artwork', () => {
  it.each([16, 30, 44, 58, 70])('uses a readable portrait at %ipx', (size) => {
    render(<TierTotem tier="gold" size={size} title="Gold lion" />);
    const image = screen.getByRole('img', { name: 'Gold lion' });
    expect(image.getAttribute('src')).toBe('/images/rewards/gold-lion-portrait.webp');
    expect(image.className).toContain('rwd-totem-artwork-portrait');
  });

  it.each([104, 112, 160])('preserves the full silhouette at %ipx', (size) => {
    render(<TierTotem tier="gold" size={size} />);
    const image = screen.getByRole('img');
    expect(image.getAttribute('src')).toBe('/images/rewards/gold-lion-full.webp');
    expect(image.getAttribute('width')).toBe('494');
    expect(image.getAttribute('height')).toBe('960');
  });

  it.each(['bronze', 'silver', 'platinum', 'diamond', 'legend'])('does not change %s artwork', (tier) => {
    render(<TierTotem tier={tier} />);
    expect(screen.getByRole('img').tagName.toLowerCase()).toBe('svg');
  });

  it('keeps locked styling, the rim and custom accessible labels', () => {
    const { container } = render(<TierTotem tier="gold" locked idle={false} medallion={false} title="شیر طلایی" />);
    expect(screen.getByRole('img', { name: 'شیر طلایی' })).toBeTruthy();
    expect(container.querySelector('.rwd-totem-locked')).toBeTruthy();
    expect(container.querySelector('.rwd-totem-idle')).toBeNull();
    expect(container.querySelector('.rwd-totem-medallion')).toBeNull();
    const css = readFileSync('src/styles/rewards.css', 'utf8');
    expect(css).toMatch(/\.rwd-totem-locked \.rwd-totem-artwork\s*\{[^}]*grayscale/);
  });

  it.each(['full', 'portrait'])('ships the %s WebP in the public directory', (crop) => {
    const file = readFileSync(`public/images/rewards/gold-lion-${crop}.webp`);
    expect(file.toString('ascii', 0, 4)).toBe('RIFF');
    expect(file.toString('ascii', 8, 12)).toBe('WEBP');
  });
});
