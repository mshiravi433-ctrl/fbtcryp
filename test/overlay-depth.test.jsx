// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import FullScreenSheet from '../src/components/FullScreenSheet';
import Sheet from '../src/components/Sheet';

vi.mock('../src/components/AnimatedIcon', async (original) => ({
  ...await original(),
  useStill: () => true
}));

afterEach(cleanup);

describe('portal overlay depth', () => {
  it('keeps a transaction Sheet above its parent full-screen analysis Sheet', () => {
    render(
      <FullScreenSheet open onClose={() => {}} title="Pool analysis" testId="parent-sheet">
        <Sheet open onClose={() => {}} title="Confirm transaction" testId="child-sheet">
          <p>Transaction content</p>
        </Sheet>
      </FullScreenSheet>
    );

    const backdrop = document.body.querySelector('.sheet-backdrop');
    const layer = document.body.querySelector('.sheet-layer');
    expect(backdrop).toBeTruthy();
    expect(layer).toBeTruthy();
    // Full-screen sheets use 230/231 in fullscreen-sheet.css. A nested Sheet
    // must be explicitly above both, even though its portal is a body sibling.
    expect(Number(backdrop.style.zIndex)).toBeGreaterThan(231);
    expect(Number(layer.style.zIndex)).toBeGreaterThan(Number(backdrop.style.zIndex));
    expect(document.body.querySelector('[data-testid="child-sheet"]')).toBeTruthy();
  });

  it('leaves ordinary Sheets on the original CSS stacking contract', () => {
    render(<Sheet open onClose={() => {}} title="Ordinary modal"><p>Body</p></Sheet>);
    expect(document.body.querySelector('.sheet-backdrop').style.zIndex).toBe('');
    expect(document.body.querySelector('.sheet-layer').style.zIndex).toBe('');
  });
});
