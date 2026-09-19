// @vitest-environment jsdom
/**
 * NETWORK SELECT — the wallet page's network picker.
 *
 * The report: «در صفحه کیف مول بخش تمامی شبکه‌ها که انتخاب نمیکنی شبکه را داخل
 * باکس بازشونده مدرن بزار با لوگو مدرن هر شبکه و هیلی قشنگ و برای هر دو تم».
 * The hero used to draw sixteen chips — a 7px dot and a three-letter code each,
 * four ragged lines deep on a phone, with «همه شبکه‌ها» as a button that did
 * nothing at all.
 *
 * What is locked here is the behaviour that made it a control rather than a
 * block of grey pills:
 *
 *   1. every chain the registry ships is reachable, and «همه شبکه‌ها» is a real
 *      option that can be chosen (it used to be inert);
 *   2. each row carries the network's own artwork — offline SVG, so a phone
 *      that cannot reach a CDN still sees sixteen faces, not sixteen holes;
 *   3. it answers a keyboard (↑/↓/Enter/Escape), because a picker that only
 *      answers a mouse is a decoration;
 *   4. Escape and an outside pointer close WITHOUT selecting.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import NetworkSelect from '../src/components/NetworkSelect';
import { EVM_CHAIN_ORDER, EVM_CHAINS } from '../src/lib/chains';
import en from '../src/i18n/locales/en.json';

const t = (key, values = {}) => {
  const text = key.split('.').reduce((o, k) => o?.[k], en) ?? key;
  return String(text).replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? '');
};

const baseProps = {
  value: 'all',
  onChange: () => {},
  activeChainId: 56,
  label: 'Network',
  allLabel: en.wallet.allNetworks,
  assetsLabel: en.wallet.assetsUnit,
  activeLabel: en.wallet.active.title,
  searchLabel: en.wallet.netSearch
};

const openList = () => {
  fireEvent.click(screen.getByRole('button', { name: /Network/i }));
  return screen.getByRole('listbox');
};

afterEach(cleanup);

describe('the network picker', () => {
  it('shows the selected network on the trigger, not a three-letter code', () => {
    render(<NetworkSelect {...baseProps} value={42161} />);
    expect(screen.getByRole('button', { name: /Network/i }).textContent)
      .toContain(EVM_CHAINS[42161].name);
  });

  it('shows «All networks» when that is what is selected', () => {
    render(<NetworkSelect {...baseProps} value="all" />);
    expect(screen.getByRole('button', { name: /Network/i }).textContent)
      .toContain(en.wallet.allNetworks);
  });

  it('offers every chain in the registry — none of them hidden behind a "more" tap', () => {
    render(<NetworkSelect {...baseProps} />);
    const list = openList();
    const options = within(list).getAllByRole('option');
    expect(options.length).toBe(EVM_CHAIN_ORDER.length + 1);
    for (const cid of EVM_CHAIN_ORDER) {
      expect(within(list).getByText(EVM_CHAINS[cid].name)).toBeTruthy();
    }
  });

  it('gives every network its own artwork, offline', () => {
    const { container } = render(<NetworkSelect {...baseProps} />);
    openList();
    /* `AssetIcon chain=` renders the vendored SVG inline — no request, no
       broken image on a phone that cannot reach a CDN. */
    const marks = container.querySelectorAll('.net-select__opt-mark svg');
    expect(marks.length).toBe(EVM_CHAIN_ORDER.length + 1);
  });

  it('marks the chain the WALLET is on, which is not the same as the one being viewed', () => {
    render(<NetworkSelect {...baseProps} value={8453} activeChainId={56} />);
    const list = openList();
    const bsc = within(list).getByText(EVM_CHAINS[56].name).closest('li');
    expect(within(bsc).getByText(en.wallet.active.title)).toBeTruthy();
  });

  it('choosing a network reports it and closes', () => {
    const onChange = vi.fn();
    render(<NetworkSelect {...baseProps} onChange={onChange} />);
    const list = openList();
    fireEvent.click(within(list).getByText(EVM_CHAINS[8453].name));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe(8453);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('«All networks» is a real choice, not a label', () => {
    const onChange = vi.fn();
    render(<NetworkSelect {...baseProps} value={56} onChange={onChange} />);
    const list = openList();
    fireEvent.click(within(list).getByText(en.wallet.allNetworks));
    expect(onChange.mock.calls[0][0]).toBe('all');
  });

  it('answers a keyboard: open with ArrowDown, choose with Enter', () => {
    const onChange = vi.fn();
    render(<NetworkSelect {...baseProps} onChange={onChange} />);
    const trigger = screen.getByRole('button', { name: /Network/i });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const list = screen.getByRole('listbox');
    /* Cursor opens on the current selection, so Enter on an unchanged picker
       must not quietly change the network. */
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe(EVM_CHAIN_ORDER[0]);
  });

  it('Escape closes without choosing anything', () => {
    const onChange = vi.fn();
    render(<NetworkSelect {...baseProps} onChange={onChange} />);
    openList();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a pointer outside closes without choosing anything', () => {
    const onChange = vi.fn();
    render(<NetworkSelect {...baseProps} onChange={onChange} />);
    openList();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('focuses the search box on open, so the very first keypress answers', () => {
    render(<NetworkSelect {...baseProps} />);
    openList();
    const box = screen.getByPlaceholderText(en.wallet.netSearch);
    expect(document.activeElement).toBe(box);
  });

  it('navigates with the keyboard from the search box and chooses with Enter', () => {
    const onChange = vi.fn();
    render(<NetworkSelect {...baseProps} onChange={onChange} />);
    openList();
    const box = screen.getByPlaceholderText(en.wallet.netSearch);
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe(EVM_CHAIN_ORDER[1]);
  });

  it('searches by name, by short code and by chain id', () => {
    render(<NetworkSelect {...baseProps} />);
    openList();
    const box = screen.getByPlaceholderText(en.wallet.netSearch);
    fireEvent.change(box, { target: { value: 'zk' } });
    let options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options.length).toBe(1);
    expect(options[0].textContent).toContain(EVM_CHAINS[324].name);

    fireEvent.change(box, { target: { value: '4663' } });
    options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options.length).toBe(1);
    expect(options[0].textContent).toContain(EVM_CHAINS[4663].name);
  });

  it('shows the per-network figures the caller has, and nothing where it has none', () => {
    render(
      <NetworkSelect
        {...baseProps}
        chainMeta={{ 8453: { amount: '$1,204.00', assets: 3 } }}
        allMeta={`$9,001.00 · 12 ${en.wallet.assetsUnit}`}
      />
    );
    const list = openList();
    expect(within(list).getByText('$1,204.00')).toBeTruthy();
    /* A chain with no entry shows an empty slot, not a zero the user would
       read as a balance we measured. */
    const arb = within(list).getByText(EVM_CHAINS[42161].name).closest('li');
    expect(arb.querySelector('.net-select__opt-meta').textContent.trim()).toBe('');
  });

  it('names itself as a listbox so a screen reader is not guessing', () => {
    render(<NetworkSelect {...baseProps} value={56} />);
    const trigger = screen.getByRole('button', { name: /Network/i });
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    openList();
    expect(screen.getByRole('button', { name: /Network/i }).getAttribute('aria-expanded')).toBe('true');
    const selected = within(screen.getByRole('listbox'))
      .getByText(EVM_CHAINS[56].name)
      .closest('li');
    expect(selected.getAttribute('aria-selected')).toBe('true');
  });
});
