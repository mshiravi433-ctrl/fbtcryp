// @vitest-environment jsdom
/**
 * WALLET HEALTH PANEL — THE PROJECT ROW.
 *
 * The bug this locks is a LABEL, not a calculation: the panel printed
 * «email=false socials=0» for a device whose dashboard answer was
 * `{ isEnabled:true, config:null }` — the answer that makes AppKit ignore the
 * dashboard entirely and use OUR `features`. A support thread then went hunting
 * a switch nobody had flipped.
 *
 * So the numbers here come from the REAL `summarizeProjectConfig()` (only the
 * network is faked), and what is asserted is the sentence a human reads: which
 * source produced the number, and which provider AppKit's platform filter hid.
 * The stack's own suite (`test/walletconnect-stack-probe.mjs`) covers the
 * arithmetic; this file covers the thing the arithmetic is for.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import en from '../src/i18n/locales/en.json';

const t = (key, values = {}) => {
  const text = key.split('.').reduce((o, k) => o?.[k], en) ?? key;
  return String(text).replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? '');
};
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t, i18n: { language: 'en' } }) }));

/** The answers the endpoint really sends, plus the phone that sent one. */
const FIXTURE = vi.hoisted(() => ({
  /* Samsung Internet 30 / Android 10 — the report that started this. */
  android: {
    userAgent: 'Mozilla/5.0 (Linux; Android 10; SM-A505F) AppleWebKit/537.36'
      + ' (KHTML, like Gecko) SamsungBrowser/30.0 Chrome/122.0.0.0 Mobile Safari/537.36',
    pointerCoarse: true
  },
  desktop: {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      + ' (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
  },
  withheld: { features: [{ id: 'social_login', isEnabled: true, config: null }] },
  list: { features: [{ id: 'social_login', isEnabled: true, config: ['email', 'google', 'x'] }] },
  absent: { features: [{ id: 'social_login', isEnabled: true }] },
  /* What the next check should answer with — read when the panel runs. */
  payload: { features: [{ id: 'social_login', isEnabled: true, config: null }] },
  env: {
    userAgent: 'Mozilla/5.0 (Linux; Android 10; SM-A505F) AppleWebKit/537.36'
      + ' (KHTML, like Gecko) SamsungBrowser/30.0 Chrome/122.0.0.0 Mobile Safari/537.36',
    pointerCoarse: true
  }
}));

/** Fake the network only: the summary inside the report is the real function. */
vi.mock('../src/lib/wc', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    collectWalletHealth: async () => ({
      at: '2026-09-17T12:00:00.000Z',
      origin: 'https://fbtswap.ir',
      projectId: 'pid',
      userAgent: FIXTURE.env.userAgent,
      projectConfig: {
        ok: true,
        status: 200,
        error: null,
        features: actual.summarizeProjectConfig(FIXTURE.payload, FIXTURE.env)
      },
      allowedOrigins: {
        ok: true, status: 200, error: null, list: ['fbtswap.ir'],
        emptyMeansAllowAll: false, originAllowed: true, currentOrigin: 'https://fbtswap.ir'
      },
      relay: { url: 'wss://relay.walletconnect.org', ok: true, ms: 312 },
      relays: [],
      relayVerdict: 'OPEN',
      secureSite: { ok: true, ms: 90 },
      storage: {
        sdkLoginMarker: false, ourMarker: false, wcSessionKeys: 0,
        appkitConnectionKeys: 0, orphanKeys: false
      },
      trace: []
    })
  };
});

const { default: WalletHealthPanel } = await import('../src/components/WalletHealthPanel.jsx');

/** Run the check against one answer and hand back the rendered text. */
async function panelText(payload, env) {
  FIXTURE.payload = payload;
  FIXTURE.env = env;
  const view = render(<WalletHealthPanel projectId="pid" />);
  fireEvent.click(screen.getByText(t('wallet.healthRun')));
  /* The button's label flips back to «Run check» once the report lands, so the
     thing to wait for is the report itself. */
  await waitFor(() => expect(view.container.textContent).toContain('email='));
  return view.container.textContent;
}

afterEach(cleanup);

describe('the project row of the health panel', () => {
  it('says the local settings are the source when the dashboard withheld the list', async () => {
    const text = await panelText(FIXTURE.withheld, FIXTURE.android);
    /* The number is what AppKit will really use — email on, our own providers. */
    expect(text).toContain('email=true');
    expect(text).not.toContain('email=false');
    expect(text).toContain(t('wallet.healthProjectSourceLocal'));
    expect(text).not.toContain(t('wallet.healthProjectSourceDashboard'));
  });

  it('names the provider the platform filter hid on this phone', async () => {
    const text = await panelText(FIXTURE.withheld, FIXTURE.android);
    /* Android is mobile, and every mobile browser loses facebook. */
    expect(text).toContain('socials=6');
    expect(text).toContain(t('wallet.healthProjectPlatformFiltered', { removed: 'facebook' }));
  });

  it('credits the dashboard when the dashboard really sent the list', async () => {
    const text = await panelText(FIXTURE.list, FIXTURE.desktop);
    expect(text).toContain('email=true');
    expect(text).toContain(t('wallet.healthProjectSourceDashboard'));
    expect(text).not.toContain(t('wallet.healthProjectSourceLocal'));
  });

  it('says why the feature is off when the answer carries no config field', async () => {
    const text = await panelText(FIXTURE.absent, FIXTURE.desktop);
    expect(text).toContain('email=false');
    expect(text).toContain(t('wallet.healthProjectSourceOff'));
    /* The two look identical in JSON but mean opposite things — the panel must
       not describe an absent config as a withheld one. */
    expect(text).not.toContain(t('wallet.healthProjectSourceLocal'));
  });
});
