// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import TierTotem, { ARTWORK, TIER_ANIMALS } from '../src/components/rewards/TierTotem';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key })
}));
afterEach(cleanup);

const ART_TIERS = ['bronze', 'silver', 'gold', 'diamond', 'legend'];

describe('tier artwork', () => {
  it.each(ART_TIERS)('renders the supplied artwork for %s', (tier) => {
    render(<TierTotem tier={tier} size={58} title={`${tier} animal`} />);
    const image = screen.getByRole('img', { name: `${tier} animal` });
    expect(image.tagName.toLowerCase()).toBe('img');
    expect(image.getAttribute('src')).toBe(ARTWORK[TIER_ANIMALS[tier]]);
    // one square, one frame: nothing is cropped per tier
    expect(image.getAttribute('width')).toBe('400');
    expect(image.getAttribute('height')).toBe('400');
  });

  it('keeps the SVG eagle for platinum until artwork is supplied', () => {
    render(<TierTotem tier="platinum" />);
    expect(screen.getByRole('img').tagName.toLowerCase()).toBe('svg');
    expect(ARTWORK.eagle).toBeUndefined();
  });

  it('points every artwork at a real, square transparent WebP', () => {
    for (const [animal, src] of Object.entries(ARTWORK)) {
      const file = readFileSync(`public${src}`);
      expect(file.toString('ascii', 0, 4), animal).toBe('RIFF');
      expect(file.toString('ascii', 8, 12), animal).toBe('WEBP');
      // 400×400, lossy WebP with alpha: the VP8X chunk appears in the header
      expect(file[12], animal).toBe(0x56); // 'V'
      expect(file.length, animal).toBeGreaterThan(4_000);
    }
    expect(Object.keys(ARTWORK).sort()).toEqual(['dragon', 'lion', 'phoenix', 'turtle', 'wolf']);
  });

  it('never labels a medal with a missing animal key', () => {
    for (const tier of ART_TIERS) {
      render(<TierTotem tier={tier} size={40} />);
      expect(screen.getByRole('img').getAttribute('aria-label') || screen.getByRole('img').getAttribute('alt')).toContain(
        'rewards.v2.animals.'
      );
      cleanup();
    }
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

  it('frames every medal with the same rim geometry and only the colour differs', () => {
    const { container: bronze } = render(<TierTotem tier="bronze" size={64} idle={false} />);
    const rim = bronze.querySelector('.rwd-totem-medallion');
    expect(rim).toBeTruthy();
    expect(rim.querySelector('.rwd-totem-orbit')).toBeTruthy();
    // the artwork sits inside a fixed 84% inset, so no tier can touch the rim
    const css = readFileSync('src/styles/rewards.css', 'utf8');
    expect(css).toMatch(/\.rwd-totem-float\s*\{[^}]*width: 84%/);
    expect(css).toMatch(/\.rwd-totem-float\s*\{[^}]*height: 84%/);
  });
});
