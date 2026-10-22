// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import en from '../src/i18n/locales/en.json';
import News from '../src/pages/News';

const mocks = vi.hoisted(() => ({ getNews: vi.fn(), playRadio: vi.fn() }));
const t = (key, values = {}) => {
  const text = key.split('.').reduce((row, part) => row?.[part], en) ?? values.defaultValue ?? key;
  return String(text).replace(/\{\{(\w+)\}\}/g, (_, name) => values[name] ?? '');
};

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t, i18n: { language: 'en' } }) }));
vi.mock('../src/hooks/useMarket', () => ({ useMarkets: () => ({ data: [], loading: false, updatedAt: Date.now() }) }));
vi.mock('../src/context/TelegramContext', () => ({ useTelegram: () => ({ haptic: vi.fn(), tg: null }) }));
vi.mock('../src/lib/news', () => ({ getNews: mocks.getNews }));
vi.mock('../src/lib/fbtRadioEngine', () => ({ play: mocks.playRadio }));
vi.mock('../src/lib/refresh', () => ({ onSoftRefresh: () => () => {} }));
vi.mock('../src/lib/notify', () => ({
  getNotifySettings: () => ({ news: false }),
  requestNotificationPermission: vi.fn(async () => 'granted'),
  registerPushAnywhere: vi.fn(async () => {}),
  setNotifySettings: vi.fn()
}));
vi.mock('../src/components/AdBanner', () => ({ default: () => null }));
vi.mock('../src/components/RadioPanel', () => ({ default: () => null }));
vi.mock('../src/components/FbtRadioBox', () => ({ default: () => null }));
vi.mock('../src/components/CommunityPanel', () => ({ default: () => null }));
vi.mock('../src/components/MarketInsightsPanel', () => ({ default: () => null }));
vi.mock('../src/components/WhaleTrackingPanel', () => ({ default: () => null }));
vi.mock('../src/components/CalmPanel', () => ({ default: () => <div data-testid="calm-tab-stub" /> }));
vi.mock('../src/components/SegIndicator', () => ({ default: () => <span className="seg-indicator" /> }));
vi.mock('../src/components/AnimatedIcon', () => ({
  AnimatedBell: () => <svg aria-hidden="true" />,
  AnimatedSearch: () => <svg aria-hidden="true" />,
  useStill: () => true
}));

const feed = {
  at: Date.now(),
  generated: false,
  items: [
    { id: 'one', title: 'Bitcoin liquidity reaches a new milestone', summary: 'A market summary', source: 'Desk One', lang: 'en', at: Date.now(), url: 'https://example.org/one', cats: ['events'] },
    { id: 'two', title: 'Ethereum developers ship an upgrade', summary: 'A protocol summary', source: 'Desk Two', lang: 'en', at: Date.now(), url: 'https://example.org/two', cats: ['future'] }
  ]
};

beforeEach(() => {
  mocks.getNews.mockReset();
  mocks.getNews.mockResolvedValue(feed);
  window.open = vi.fn();
});
afterEach(cleanup);

describe('modern News headline desk', () => {
  it('keeps navigation, search recovery, refresh and external reading operational', async () => {
    render(<MemoryRouter initialEntries={['/news']}><News /></MemoryRouter>);
    expect(await screen.findByText(feed.items[0].title)).toBeTruthy();
    expect(screen.getByText(en.news.topStory)).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(5);
    expect(document.querySelectorAll('.news-tab-icon svg')).toHaveLength(5);

    const search = screen.getByRole('searchbox', { name: en.news.search });
    fireEvent.change(search, { target: { value: 'not-present' } });
    fireEvent.click(screen.getByRole('button', { name: en.news.clearFilters }));
    expect(await screen.findByText(feed.items[0].title)).toBeTruthy();
    expect(search.value).toBe('');

    fireEvent.click(screen.getByRole('button', { name: en.news.refresh }));
    await waitFor(() => expect(mocks.getNews).toHaveBeenLastCalledWith(expect.objectContaining({ force: true })));

    const article = screen.getByText(feed.items[0].title).closest('article');
    fireEvent.keyDown(article, { key: 'Enter' });
    expect(window.open).toHaveBeenCalledWith(feed.items[0].url, '_blank', 'noopener,noreferrer');

    const calmTab = screen.getByRole('tab', { name: en.news.tab.calm });
    fireEvent.click(calmTab);
    expect(await screen.findByTestId('calm-tab-stub')).toBeTruthy();
    expect(calmTab.getAttribute('aria-selected')).toBe('true');
  });
});
