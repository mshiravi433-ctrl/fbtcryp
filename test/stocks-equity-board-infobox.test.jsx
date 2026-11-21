// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setLanguage } from '../src/i18n';
import EquityBoard from '../src/components/stocks/EquityBoard';

beforeAll(async () => {
  await setLanguage('fa');
});

afterEach(cleanup);

describe('EquityBoard collapsible real asset explanation', () => {
  it('renders "این‌ها دقیقاً چه هستند" in a collapsible InfoBox defaulting to closed', () => {
    const { container } = render(
      <MemoryRouter>
        <EquityBoard
          equities={[]}
          favs={[]}
          toggleFav={() => {}}
          buy={() => {}}
          filteredEquities={[]}
          EQ_PAGE={12}
          eqShowAll={false}
          setEqShowAll={() => {}}
          THIN_ASSETS={new Set()}
          AMOUNTS={[50, 100, 200]}
          visibleEquities={[]}
          SECTOR_ORDER={[]}
          EQ_SORTS={[]}
          held={{ status: 'idle', rows: [], totalUsd: 0 }}
        />
      </MemoryRouter>
    );

    // Should find the InfoBox title button
    const titleBtn = screen.getByRole('button', { name: /این‌ها دقیقاً چه هستند/i });
    expect(titleBtn).toBeTruthy();
    expect(titleBtn.getAttribute('aria-expanded')).toBe('false');

    // Body should not be in document initially
    expect(screen.queryByText(/پشت هر توکن یک سهم واقعی است/i)).toBeNull();

    // Clicking expands the InfoBox
    fireEvent.click(titleBtn);
    expect(titleBtn.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/پشت هر توکن یک سهم واقعی است/i)).toBeTruthy();

    // Clicking again collapses it
    fireEvent.click(titleBtn);
    expect(titleBtn.getAttribute('aria-expanded')).toBe('false');
  });
});
