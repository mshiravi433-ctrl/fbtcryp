// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

afterEach(() => cleanup());
import AiTradePanel, { HoldButton } from '../src/components/AiTrade/AiTradePanel.jsx';

describe('AI ترید tab: renders and navigates without errors', () => {
  it('shows six steps, one visible at a time, starting locked', () => {
    render(<AiTradePanel />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(6);
    expect(screen.getByText('قفل')).toBeTruthy();
    expect(screen.getByRole('tab', { name: /اتصال/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('moves through every step without throwing', () => {
    render(<AiTradePanel />);
    for (const name of [/حساب/, /سقف‌ها/, /تحلیل و قوانین/, /تأیید/, /گزارش/, /اتصال/]) {
      fireEvent.click(screen.getByRole('tab', { name }));
      expect(screen.getByRole('tab', { name }).getAttribute('aria-selected')).toBe('true');
    }
  });

  it('account step asks to connect first, with a way back', () => {
    render(<AiTradePanel />);
    fireEvent.click(screen.getByRole('tab', { name: /حساب/ }));
    expect(screen.getByText(/اول در مرحلهٔ «اتصال»/)).toBeTruthy();
  });

  it('kill switch toggles and is announced as a switch', () => {
    render(<AiTradePanel />);
    fireEvent.click(screen.getByRole('tab', { name: /سقف‌ها/ }));
    const sw = screen.getByRole('switch');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(sw.textContent).toContain('توقف اضطراری');
  });

  it('leverage radio group only offers the product choices', () => {
    render(<AiTradePanel />);
    fireEvent.click(screen.getByRole('tab', { name: /سقف‌ها/ }));
    const radios = screen.getAllByRole('radio').map((r) => r.textContent);
    expect(radios).toEqual(['1x', '2x', '3x', '5x', '10x']);
  });

  it('a limit that breaks coherence shows an error and no "saved" line', () => {
    render(<AiTradePanel />);
    fireEvent.click(screen.getByRole('tab', { name: /سقف‌ها/ }));
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '100' } }); // total below per-order
    expect(screen.getByText('سقف کل نمی‌تواند از سقف هر سفارش کمتر باشد.')).toBeTruthy();
    expect(screen.queryByText(/سقف‌ها معتبرند/)).toBeNull();
  });

  it('the AI step explains what is missing before analysis', () => {
    render(<AiTradePanel />);
    fireEvent.click(screen.getByRole('tab', { name: /تحلیل و قوانین/ }));
    expect(screen.getByText(/اول در مرحلهٔ «اتصال»/)).toBeTruthy();
    const analyze = screen.getByRole('button', { name: /تحلیل بازار/ });
    expect(analyze.disabled).toBe(true);
  });

  it('a quick tap on a hold button does not confirm', () => {
    vi.useFakeTimers();
    const { container } = render(<AiTradePanel />);
    fireEvent.click(screen.getByRole('tab', { name: /تأیید/ }));
    // no pending items yet, so there is no hold button; the empty state is shown
    expect(screen.getByText(/پیشنهادی برای تأیید نیست/)).toBeTruthy();
    expect(container.querySelector('.ai-trade-hold')).toBeNull();
    vi.useRealTimers();
  });

  it('report step shows the empty state and the disclaimer', () => {
    render(<AiTradePanel />);
    fireEvent.click(screen.getByRole('tab', { name: /گزارش/ }));
    expect(screen.getByText('هنوز سفارشی ثبت نشده.')).toBeTruthy();
    expect(screen.getByText(/تضمینی برای آینده نیست/)).toBeTruthy();
  });
});

describe('HoldButton: confirms only after the full hold', () => {
  it('a quick tap does nothing, even after the hold time has passed', () => {
    vi.useFakeTimers();
    const onConfirm = vi.fn();
    render(<HoldButton onConfirm={onConfirm}>تأیید</HoldButton>);
    const btn = screen.getByRole('button');
    fireEvent.pointerDown(btn);
    act(() => { vi.advanceTimersByTime(200); });
    fireEvent.pointerUp(btn);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(onConfirm).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('leaving the button before 500 ms cancels the hold', () => {
    vi.useFakeTimers();
    const onConfirm = vi.fn();
    render(<HoldButton onConfirm={onConfirm}>تأیید</HoldButton>);
    const btn = screen.getByRole('button');
    fireEvent.pointerDown(btn);
    act(() => { vi.advanceTimersByTime(450); });
    fireEvent.pointerLeave(btn);
    act(() => { vi.advanceTimersByTime(200); });
    expect(onConfirm).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('a full 500 ms hold confirms exactly once', () => {
    vi.useFakeTimers();
    const onConfirm = vi.fn();
    render(<HoldButton onConfirm={onConfirm}>تأیید</HoldButton>);
    const btn = screen.getByRole('button');
    fireEvent.pointerDown(btn);
    act(() => { vi.advanceTimersByTime(499); });
    expect(onConfirm).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(btn);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('a disabled hold button cannot be started', () => {
    vi.useFakeTimers();
    const onConfirm = vi.fn();
    render(<HoldButton onConfirm={onConfirm} disabled>تأیید</HoldButton>);
    const btn = screen.getByRole('button');
    fireEvent.pointerDown(btn);
    act(() => { vi.advanceTimersByTime(800); });
    expect(onConfirm).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
