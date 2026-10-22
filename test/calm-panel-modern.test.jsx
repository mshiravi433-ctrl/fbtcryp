// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import en from '../src/i18n/locales/en.json';
import CalmPanel from '../src/components/CalmPanel';

const mocks = vi.hoisted(() => ({
  getCalm: vi.fn(),
  toggleTrack: vi.fn(),
  openUrl: vi.fn(),
  state: { track: null, playing: false }
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, values = {}) => {
      const text = key.split('.').reduce((row, part) => row?.[part], en) ?? values.defaultValue ?? key;
      return String(text).replace(/\{\{(\w+)\}\}/g, (_, name) => values[name] ?? '');
    }
  })
}));
vi.mock('../src/lib/audio', () => ({
  getCalm: mocks.getCalm,
  fmtDuration: (seconds) => seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : ''
}));
vi.mock('../src/lib/refresh', () => ({ onSoftRefresh: () => () => {} }));
vi.mock('../src/lib/browser', () => ({ openUrl: mocks.openUrl }));
vi.mock('../src/store/useRadioStore', () => ({
  useRadioStore: (selector) => selector({
    track: mocks.state.track,
    playing: mocks.state.playing,
    toggleTrack: mocks.toggleTrack
  })
}));

const tracks = [
  { id: 'one', title: 'Quiet Horizon', stationName: 'A. Composer', licence: 'CC BY', durationSec: 125, pageUrl: 'https://example.org/one', streamUrl: 'https://example.org/one.mp3' },
  { id: 'two', title: 'Still Water', stationName: 'B. Composer', licence: 'CC0', durationSec: 180, pageUrl: 'https://example.org/two', streamUrl: 'https://example.org/two.mp3' }
];

beforeEach(() => {
  mocks.getCalm.mockReset();
  mocks.toggleTrack.mockReset();
  mocks.openUrl.mockReset();
  mocks.state.track = null;
  mocks.state.playing = false;
  mocks.getCalm.mockResolvedValue({ items: tracks });
});
afterEach(cleanup);

describe('modern Calm listening room', () => {
  it('uses the real shared-audio queue for the hero and keeps source attribution actionable', async () => {
    render(<CalmPanel />);
    expect(await screen.findByText('Quiet Horizon')).toBeTruthy();
    expect(screen.getByText('CC BY')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: en.calm.playAll }));
    expect(mocks.toggleTrack).toHaveBeenCalledWith(tracks[0], tracks);

    fireEvent.click(screen.getAllByRole('button', { name: en.calm.source })[0]);
    expect(mocks.openUrl).toHaveBeenCalledWith(tracks[0].pageUrl);
  });

  it('keeps loading failure distinct and retries the real catalogue request', async () => {
    mocks.getCalm.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ items: tracks });
    render(<CalmPanel />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText(en.calm.empty)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: en.common.retry }));
    expect(await screen.findByText('Quiet Horizon')).toBeTruthy();
    expect(mocks.getCalm).toHaveBeenCalledTimes(2);
    expect(mocks.getCalm).toHaveBeenLastCalledWith({ force: true });
  });
});
