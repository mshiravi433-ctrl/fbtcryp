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
const WC_PROJECT_ID = '5997d5aee8bb42f43ddec4b1a5f94eb1';

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
  },
  /* What the Reown registry answered. Mutable on purpose: the interesting state
     of this project is «the dashboard has the domain» versus «it does not», and
     a test must be able to render the second one without a second module mock. */
  registryList: ['fbtswap.ir', 'https://localhost']
}));

/** Fake the network only: the panel's own sentences are what is asserted. */
vi.mock('../src/lib/wc', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    collectWalletHealth: async () => {
      const report = {
      at: '2026-09-18T12:00:00.000Z',
      origin: 'https://fbtswap.ir',
      /* A REAL-SHAPED id: the engine checks the 32-hex shape before any network
         call, so a fixture id of «pid» would make every verdict
         SDK_CONFIGURATION_ERROR and prove nothing about the flow. */
      projectId: WC_PROJECT_ID,
      userAgent: 'Mozilla/5.0 (Linux; Android 10; SM-A505F) SamsungBrowser/30.0',
      projectConfig: { ok: true, status: 200, error: null },
      allowedOrigins: {
        ok: true,
        status: 200,
        error: null,
        list: FIXTURE.registryList,
        emptyMeansAllowAll: FIXTURE.registryList.length === 0,
        originAllowed: FIXTURE.registryList.length === 0
          ? null
          : FIXTURE.registryList.some((entry) => entry === 'fbtswap.ir' || entry === 'https://fbtswap.ir'),
        currentOrigin: 'https://fbtswap.ir'
      },
      registry: {
        ok: true,
        status: 200,
        error: null,
        list: FIXTURE.registryList,
        originAllowed: FIXTURE.registryList.some((entry) => entry === 'fbtswap.ir' || entry === 'https://fbtswap.ir'),
        emptyMeansAllowAllForAppKit: FIXTURE.registryList.length === 0
      },
      verifyEnclave: { ok: true, status: 200, url: 'https://verify.walletconnect.org' },
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
      identity: {
        declared: 'https://fbtswap.ir',
        pageOrigin: 'https://fbtswap.ir',
        canonical: 'https://fbtswap.ir',
        packaged: false,
        matchesPage: true
      },
      metadata: {
        url: 'https://fbtswap.ir',
        verifyUrl: 'https://fbtswap.ir',
        iconUrl: 'https://fbtswap.ir/icon-512.png'
      },
      dashboardExpected: {
        origins: ['https://fbtswap.ir', 'https://www.fbtswap.ir', 'https://localhost'],
        appIds: ['ir.fbtswap.app']
      },
      /* The row the panel used to print is GONE on purpose: the
         `/.well-known/walletconnect.txt` file belongs to the deprecated DNS-TXT
         flow and the active attestation flow does not read it. A panel that
         still measured it would send the next support thread to add a file
         nobody fetches. */
      storage: FIXTURE.storage,
      shared: FIXTURE.shared,
      trace: []
      };
      /*
       * THE VERDICT AND THE TWO STATUS LINES COME FROM THE REAL ENGINE.
       *
       * Hand-writing them in a fixture is how a panel test starts agreeing with
       * a panel that is wrong: the panel prints what the report carries, so a
       * fabricated `diagnosis` proves only that JSX renders a string. Running
       * the same `classifyWalletConnectDiagnosis()` the CLI runs means this
       * test fails if the engine and the panel ever disagree about what a given
       * set of measurements means.
       */
      const diagnosis = actual.classifyWalletConnectDiagnosis({
        sdkConfig: actual.sdkConfigFacts({
          projectId: report.projectId,
          /* `metadata` on the report is the three fields the PANEL prints; the
             engine wants the proposal object the SDK ships, so it is rebuilt
             here rather than duplicated in the fixture (a fixture that drifts
             from `wcMetadata()` would make this test agree with a wrong panel). */
          metadata: {
            name: 'FBT Swap',
            description: 'Swap, bridge and earn across chains.',
            url: report.metadata.url,
            verifyUrl: report.metadata.verifyUrl,
            icons: [report.metadata.iconUrl]
          },
          declaredOrigins: report.dashboardExpected.origins
        }),
        pageOrigin: report.origin,
        declaredUrl: report.metadata.url,
        registry: report.registry,
        projectConfig: report.projectConfig,
        relay: { hosts: report.relays },
        verify: { enclave: report.verifyEnclave, attestation: null },
        projectId: report.projectId
      });
      return {
        ...report,
        diagnosis,
        ...actual.diagnosisStatuses(diagnosis, report.registry, report.origin)
      };
    }
  };
});

const { default: WalletHealthPanel } = await import('../src/components/WalletHealthPanel.jsx');

/** Run the check and hand back the rendered text. */
async function panelText() {
  const view = render(<WalletHealthPanel projectId={WC_PROJECT_ID} />);
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
    expect(text).toContain(`id=${WC_PROJECT_ID}`);
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

  it('prints the metadata the wallet will receive, including verifyUrl', async () => {
    const text = await panelText();
    expect(text).toContain(t('wallet.healthMetadata'));
    /* The verifyUrl travels WITH the metadata: a wallet that gets one on another
       host reads «UNKNOWN» for a page that is perfectly registered. */
    expect(text).toContain('verify URL=https://fbtswap.ir');
    expect(text).toContain('icon URL=https://fbtswap.ir/icon-512.png');
    /* …and the panel must NOT resurrect the deprecated file. The verification
       flow that is live (`verify.walletconnect.org` + the project registry) does
       not fetch `/.well-known/walletconnect.txt`; printing it as a row is how
       the next reader ends up adding a file no wallet asks for. */
    expect(text).not.toContain('walletconnect.txt');
    expect(text).not.toContain('verification file=');
  });

  it('prints the allowlist the dashboard must contain', async () => {
    const text = await panelText();
    expect(text).toContain(t('wallet.healthDashboardExpected'));
    expect(text).toContain('https://fbtswap.ir');
    expect(text).toContain('https://www.fbtswap.ir');
    expect(text).toContain('https://localhost');
    expect(text).toContain('App IDs: ir.fbtswap.app');
  });

  it('prints the verdict and both statuses, and names the dashboard as the owner', async () => {
    const text = await panelText();
    /* A registered domain on a healthy stack: the verdict is OK… */
    expect(text).toContain(t('wallet.healthDiagnosisOk'));
    expect(text).toContain('CODE STATUS: PASS');
    expect(text).toContain('DASHBOARD STATUS: REGISTERED');
  });

  it('says «the domain is not in the registry» when the registry answers empty', async () => {
    /* THE REPORTED BUG, RENDERED. An empty registry is what produces «Invalid
       domain / Unverified» in every wallet, and the panel's job is to say so
       instead of leaving the reader with «connection failed». Code status must
       stay PASS: nothing in this repository is wrong when the dashboard has not
       been clicked. */
    FIXTURE.registryList = [];
    try {
      const text = await panelText();
      expect(text).toContain(t('wallet.healthDiagnosisDomainNotRegistered'));
      expect(text).toContain('CODE STATUS: PASS');
      expect(text).toContain('DASHBOARD STATUS: DOMAIN NOT REGISTERED');
      /* And the row that tells the reader where to click. */
      expect(text).toContain('dashboard.reown.com');
    } finally {
      FIXTURE.registryList = ['fbtswap.ir', 'https://localhost'];
    }
  });
});
