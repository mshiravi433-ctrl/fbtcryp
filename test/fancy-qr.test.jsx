// @vitest-environment jsdom
/**
 * FANCY QR — the styled surface must still be a scannable QR.
 * ---------------------------------------------------------------------------
 * FancyQr dresses the receive QR («فوق‌العاده و خاص») with an aurora halo, a
 * rotating energy ring, viewfinder brackets, a scan beam and a medallion. All
 * of that is allowed ONLY because none of it touches what a camera samples.
 * This suite pins both halves of that contract:
 *
 *   1. THE CODE. The matrix is encoded by qrMatrix() — the same function the
 *      component paints — and the painted <path> is rasterised and pushed
 *      through jsQR, the independent decoder the app's own scanner uses. In
 *      this test the modules are painted INFLATED by the stroke width the
 *      component draws on top (a rounded stroke grows every module by half
 *      its width; the round joins only remove ink from those corners), so
 *      decodability of the pessimistic inflated surface proves the real
 *      surface decodes too. A QR that decodes to the wrong characters sends
 *      a deposit to an address nobody controls — this is the money check.
 *
 *   2. THE DECOR. Every decorative layer is aria-hidden, sits OUTSIDE the
 *      plate (or at scan-safe alpha inside it), and the medallion overlaps
 *      only the quiet-zone padding — asserted structurally here because the
 *      repo has already shipped one "pretty" QR that would not scan.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import jsQR from 'jsqr';
import FancyQr, { qrMatrix } from '../src/components/FancyQr';

/** Rasterise the painted path into RGBA and decode it with jsQR.
 *  `inflate` is the module growth the rounded stroke adds (component uses
 *  strokeWidth 0.2 → +0.1 per side); squares are the pessimistic outer bound
 *  of the stroke's rounded joins. */
function decodePaintedQr(pathEl, { scale = 6, inflate = 0 } = {}) {
  const d = pathEl.getAttribute('d') || '';
  const modules = [...d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map((m) => [Number(m[1]), Number(m[2])]);
  expect(modules.length).toBeGreaterThan(50);
  const count = Math.max(...modules.map(([x]) => x)) + 1;
  const quiet = 4;
  const size = (count + quiet * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  const px = (n) => Math.round(n * scale);
  for (const [mx, my] of modules) {
    const x0 = px(mx + quiet - inflate / 2);
    const y0 = px(my + quiet - inflate / 2);
    const x1 = px(mx + quiet + 1 + inflate / 2);
    const y1 = px(my + quiet + 1 + inflate / 2);
    for (let y = Math.max(0, y0); y < Math.min(size, y1); y += 1) {
      for (let x = Math.max(0, x0); x < Math.min(size, x1); x += 1) {
        const i = (y * size + x) * 4;
        data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255;
      }
    }
  }
  return jsQR(data, size, size);
}

const SOL = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const EVM = '0x66c14A85E3f0ab12508F5289A3041BEdE1EaE1DE';

afterEach(() => cleanup());

describe('FancyQr', () => {
  it('qrMatrix round-trips through the independent decoder', () => {
    const m = qrMatrix(EVM);
    expect(m).toBeTruthy();
    expect(m.count).toBeGreaterThan(20);
    // The format the whole test family parses: unit squares, one per module.
    expect([...m.d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].length).toBeGreaterThan(50);
  });

  it('painted code decodes to the exact address — even inflated by the styling stroke', () => {
    render(
      <FancyQr
        value={EVM}
        label="Receive"
        className="recv-qr"
        badge={<span data-testid="medal">◎</span>}
      />
    );
    const path = document.body.querySelector('.fqr-plate svg path');
    expect(path).toBeTruthy();

    // As painted by the encoder…
    const plain = decodePaintedQr(path, { inflate: 0 });
    expect(plain?.data).toBe(EVM);

    // …and as PAINTED ON SCREEN (stroke 0.2 widens every module by 0.1 a
    // side; the rounded joins only shave ink from the inflated square).
    const styled = decodePaintedQr(path, { inflate: 0.2 });
    expect(styled, 'the styled surface must stay scannable').toBeTruthy();
    expect(styled.data).toBe(EVM);

    // Extra pessimism: even a fatter stroke must not bridge modules apart.
    const fat = decodePaintedQr(path, { inflate: 0.35 });
    expect(fat?.data).toBe(EVM);
  });

  it('keeps dark modules on a white plate — in both themes', () => {
    render(<FancyQr value={EVM} label="Receive" className="recv-qr" />);
    const plate = document.body.querySelector('.fqr-plate');
    expect(plate.classList.contains('recv-qr')).toBe(true);
    // Ink is a dark gradient, never theme-coloured: the fill is a gradient
    // reference whose stops are the near-black ink (see FancyQr.jsx).
    const fill = document.body.querySelector('.fqr-plate svg path').getAttribute('fill');
    expect(fill).toMatch(/^url\(#fqrInk/);
  });

  it('puts every decorative layer outside the decoded matrix', () => {
    render(
      <FancyQr
        value={SOL}
        label="Receive SOL"
        accent={['#9945FF', '#14F195', '#9945FF']}
        badge={<span data-testid="medal">◎</span>}
      />
    );
    // The Solana surface is a sibling of the EVM one: same component, chain
    // accents, same scannability contract.
    const plain = decodePaintedQr(document.body.querySelector('.fqr-plate svg path'), { inflate: 0.2 });
    expect(plain?.data).toBe(SOL);

    for (const cls of ['fqr-halo', 'fqr-ring', 'fqr-brackets', 'fqr-beam']) {
      const el = document.body.querySelector(`.${cls}`);
      expect(el, `${cls} decor exists`).toBeTruthy();
      expect(el.getAttribute('aria-hidden'), `${cls} is hidden from screen readers`).toBe('true');
      // Decor never lives inside the plate's SVG…
      expect(el.closest('svg'), `${cls} stays outside the code`).toBeNull();
    }
    // …and the medallion is a sibling of the plate, not painted over it. Its
    // visual dip covers only the plate's quiet-zone PADDING (fancy-qr.css
    // pins the geometry); structurally it must never be a plate descendant.
    const medal = screen.getByTestId('medal');
    expect(medal.closest('.fqr-plate')).toBeNull();
    expect(medal.closest('.fqr-badge')).toBeTruthy();

    // Chain accent travels as CSS custom properties on the stage.
    const stage = document.body.querySelector('.fqr-stage');
    expect(stage.getAttribute('style')).toContain('--fqr-a: #9945FF');
  });

  it('renders nothing (never a broken frame) for an empty payload', () => {
    const { container } = render(<FancyQr value="" label="x" />);
    expect(container.querySelector('.fqr-stage')).toBeNull();
  });
});
