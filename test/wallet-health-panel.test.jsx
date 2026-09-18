// @vitest-environment jsdom
/**
 * WALLET HEALTH PANEL — WHAT IT PRINTS AFTER THE EMAIL/SOCIAL REMOVAL.
 *
 * The panel used to carry rows that only existed for the embedded wallet: the
 * secure frame at secure.walletconnect.org, the project usage limits AppKit
 * reads to disable its email input, and a project row whose whole job was to
 * explain a «email=false socials=0» number. That surface was removed on
 * 2026-09-18, so the panel measures the three hops a WalletConnect report is
 * actually about: does the dashboard know this project, does its allowlist
 * cover this origin, and does the relay socket open on this network.
 *
 * What is locked here is the thing a support thread reads. Two directions,
 * because both have burned this app: the three rows must carry their measured
 * numbers, and NOT ONE sentence about an email or social login may survive — a
 * diagnostic that still talks about a login the app no longer offers sends the
 * next report hunting a switch nobody can flip.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import en from '../src/i18n/locales/en.json';

const t = (key, values = {}) => {
  const text = key.split('.').reduce((o, k) => o?.[k], en) ?? key;
  return String(text).replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? '');
};
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t, i18n: { language: 'en' } }) }));

/** The report shape `collectWalletHealth()` answers with now. */
const FIXTURE = vi.hoisted(() => ({
  storage: {
    wcSessionKeys: 1,
    appkitConnectionKeys: 2,
    orphanKeys: false,
    connectionStatus: 'connected',
    storedConnectors: ['walletConnect'],
    appkitConnectionKeyNames: ['@appkit/recent_wallet', '@appkit/connections'],
    activeCaipNetworkId: 'eip155:56',
    legacyEmbeddedKeys: 0
  },
  shared: {
    available: true,
    isConnected: true,
    connectorId: 'walletConnect',
    view: 'Connect',
    noAdapters: true,
    modalOpen: false
  }
}));

/** Fake the network only: the panel's own sentences are what is asserted. */
vi.mock('../src/lib/wc', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    collectWalletHealth: async () => ({
      at: '2026-09-18T12:00:00.000Z',
      origin: 'https://fbtswap.ir',
      projectId: 'pid',
      userAgent: 'Mozilla/5.0 (Linux; Android 10; SM-A505F) SamsungBrowser/30.0',
      projectConfig: { ok: true, status: 200, error: null },
      allowedOrigins: {
        ok: true,
        status: 200,
        error: null,
        list: ['fbtswap.ir', 'https://localhost'],
        emptyMeansAllowAll: false,
        originAllowed: true,
        currentOrigin: 'https://fbtswap.ir'
      },
      relay: { url: 'wss://relay.walletconnect.org', ok: true, ms: 312 },
      relays: [
        { url: 'wss://relay.walletconnect.org', socket: { ok: true, ms: 312 }, https: { ok: true, ms: 90 } },
        { url: 'wss://relay.walletconnect.com', socket: { ok: false, error: 'TIMEOUT', ms: 8000 }, https: { ok: true, ms: 120 } }
      ],
      relayVerdict: 'OPEN',
      handoff: {
        channel: 'browser', android: false, ios: false, webview: false,
        telegram: false, intentCapable: false, javaBridge: false
      },
      storage: FIXTURE.storage,
      shared: FIXTURE.shared,
      trace: []
    })
  };
});

const { default: WalletHealthPanel } = await import('../src/components/WalletHealthPanel.jsx');

/** Run the check and hand back the rendered text. */
async function panelText() {
  const view = render(<WalletHealthPanel projectId="pid" />);
  fireEvent.click(screen.getByText(t('wallet.healthRun')));
  /* The report landing is what flips the button's label back, so wait on the
     project row rather than on the button. */
  await waitFor(() => expect(view.container.textContent).toContain(t('wallet.healthProject')));
  return view.container.textContent;
}

afterEach(cleanup);

describe('the health panel after the email/social removal', () => {
  it('prints the three hops a WalletConnect report is about', async () => {
    const text = await panelText();
    expect(text).toContain(t('wallet.healthProject'));
    expect(text).toContain('id=pid');
    expect(text).toContain(t('wallet.healthOrigins'));
    expect(text).toContain('fbtswap.ir');
    expect(text).toContain(t('wallet.healthRelay'));
    expect(text).toContain('relay.walletconnect.org · 312ms');
    expect(text).toContain(t('wallet.healthHandoff'));
  });

  it('measures every relay host, not just the one that answered', async () => {
    const text = await panelText();
    expect(text).toContain(t('wallet.healthRelayHosts'));
    expect(text).toContain(t('wallet.healthRelayOpen', { ms: 312 }));
    /* The second host is the shape ISP filtering takes: HTTPS answered, the
       socket did not — and the panel says exactly that instead of «blocked». */
    expect(text).toContain(t('wallet.healthRelayHttpsOnly', { ms: 120 }));
    expect(text).toContain(t('wallet.healthRelayVerdictOpen'));
  });

  it('carries no sentence about the retired email/social login', async () => {
    const text = await panelText();
    /* The rows themselves, and the numbers only they used to print. */
    expect(text).not.toContain('email=');
    expect(text).not.toContain('socials=');
    expect(text).not.toContain('sdk-login=');
    expect(text).not.toContain('fbt-marker=');
    expect(text).not.toContain('frame-chain=');
    expect(text).not.toContain('authConn=');
    expect(text).not.toContain('tier=');
    expect(text.toLowerCase()).not.toContain('social wallet frame');
  });

  it('prints the in-memory half the storage rows cannot show', async () => {
    const text = await panelText();
    expect(text).toContain('shared: conn=yes · connector=walletConnect');
    expect(text).toContain('noAdapters=true · view=Connect · modal=closed');
  });

  it('names the retired surface keys when a device still carries them', async () => {
    FIXTURE.storage = { ...FIXTURE.storage, legacyEmbeddedKeys: 3 };
    const text = await panelText();
    expect(text).toContain('legacy-email-keys=3');
    FIXTURE.storage = { ...FIXTURE.storage, legacyEmbeddedKeys: 0 };
  });

  it('says so when the storage is clean', async () => {
    const text = await panelText();
    expect(text).toContain('wc-sessions=1 · appkit-keys=2');
    expect(text).not.toContain('⚠️ orphan');
  });
});
