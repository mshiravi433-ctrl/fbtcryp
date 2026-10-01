// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import ar from '../src/i18n/locales/ar.json';
import en from '../src/i18n/locales/en.json';
import es from '../src/i18n/locales/es.json';
import fa from '../src/i18n/locales/fa.json';
import fr from '../src/i18n/locales/fr.json';
import hi from '../src/i18n/locales/hi.json';
import id from '../src/i18n/locales/id.json';
import pt from '../src/i18n/locales/pt.json';
import ru from '../src/i18n/locales/ru.json';
import tr from '../src/i18n/locales/tr.json';
import ur from '../src/i18n/locales/ur.json';
import zh from '../src/i18n/locales/zh.json';
import IntentSwapQuoteReview, { formatRawTokenAmount, quoteReviewSummary } from '../src/components/IntentSwapQuoteReview.jsx';

const testI18n = i18next.createInstance();

beforeAll(async () => {
  await testI18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    resources: Object.fromEntries(Object.entries({ ar, en, es, fa, fr, hi, id, pt, ru, tr, ur, zh })
      .map(([language, resource]) => [language, { translation: resource }])),
    interpolation: { escapeValue: false }
  });
});
beforeEach(async () => testI18n.changeLanguage('en'));
afterEach(() => cleanup());

const review = {
  schema: 'fbt.ai-swap-quote-review.v1',
  status: 'live',
  quotedAt: 1_790_850_000_000,
  expiresAt: 1_790_850_030_000,
  chainId: 1,
  networkName: 'Ethereum',
  from: 'USDC',
  to: 'WETH',
  amountIn: '10',
  amountInWei: '10000000',
  amountOut: 0.005,
  amountOutWei: '5000000000000000',
  minOut: 0.004975,
  minOutWei: '4975000000000000',
  fromDecimals: 6,
  toDecimals: 18,
  fromAddress: '0x1111111111111111111111111111111111111111',
  toAddress: '0x2222222222222222222222222222222222222222',
  fromNative: false,
  toNative: false,
  routeSource: 'aggregator',
  solver: 'kyberswap',
  routesChecked: 2,
  hops: 2,
  feeBps: 70,
  platformFee: 0.07,
  platformFeeWei: '70000',
  slippage: 0.5,
  gasUsd: 0.42,
  priceImpactPct: 0.03,
  mevStatus: 'unverified'
};

function renderReview(props = {}) {
  return render(
    <I18nextProvider i18n={testI18n}>
      <IntentSwapQuoteReview review={review} locale="en" t={testI18n.t} {...props} />
    </I18nextProvider>
  );
}

describe('Intent AI swap quote review', () => {
  it('shows exact token quantities, route, fees, price impact, and the MEV evidence limit', () => {
    renderReview();
    expect(screen.getByTestId('intent-ai-quote-review')).toBeTruthy();
    expect(screen.getByText('10 USDC')).toBeTruthy();
    expect(screen.getByText('0.005 WETH')).toBeTruthy();
    expect(screen.getByText('0.004975 WETH')).toBeTruthy();
    expect(screen.getByText(/aggregator · kyberswap/)).toBeTruthy();
    expect(screen.getByText(/2 quote sources compared/)).toBeTruthy();
    expect(screen.getByText('Not independently verified')).toBeTruthy();
    expect(screen.getByText('$0.42')).toBeTruthy();
    expect(screen.getByText('0.03%')).toBeTruthy();
  });

  it('exposes token contract addresses only when the user opens the disclosure', () => {
    renderReview();
    fireEvent.click(screen.getByText('Token contract addresses'));
    expect(screen.getByText(review.fromAddress)).toBeTruthy();
    expect(screen.getByText(review.toAddress)).toBeTruthy();
  });

  it('marks expired terms and offers a non-signing quote refresh action', () => {
    const onRefresh = vi.fn();
    renderReview({ expired: true, onRefresh });
    expect(screen.getByText('This quote has expired. Refresh it before confirming.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh quote' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('provides quote-review labels and a translated summary in every supported locale', async () => {
    const englishSummary = quoteReviewSummary(review, 'en', testI18n.t);
    for (const language of ['ar', 'en', 'es', 'fa', 'fr', 'hi', 'id', 'pt', 'ru', 'tr', 'ur', 'zh']) {
      await testI18n.changeLanguage(language);
      expect(testI18n.t('intentAIOS.quoteReview.warning')).not.toBe('intentAIOS.quoteReview.warning');
      const summary = quoteReviewSummary(review, language, testI18n.t);
      expect(summary).toContain('WETH');
      expect(summary).toContain('Ethereum');
      if (language !== 'en') expect(summary).not.toBe(englishSummary);
    }
  });

  it('localizes values and layout for Persian and keeps the exact quote summary', async () => {
    await testI18n.changeLanguage('fa');
    render(
      <I18nextProvider i18n={testI18n}>
        <IntentSwapQuoteReview review={review} locale="fa-IR" t={testI18n.t} />
      </I18nextProvider>
    );
    const card = screen.getByTestId('intent-ai-quote-review');
    expect(card.getAttribute('dir')).toBe('rtl');
    expect(card.textContent).toContain('بررسی نرخ تبدیل');
    expect(card.textContent).toContain('مستقلانه تأیید نشده');
    expect(formatRawTokenAmount('10000000', 6, 'fa')).toBe('۱۰');
    expect(quoteReviewSummary(review, 'en')).toContain('minimum 0.004975 WETH');
  });
});
