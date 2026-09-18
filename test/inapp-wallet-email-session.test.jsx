// @vitest-environment jsdom
/**
 * «وصل شده ولی به کیف پول روی اپ ما وصل نشد» — the 2026-09-18 Telegram report,
 * cold-start half. The device ended in exactly this shape:
 *
 *   ourMarker: false · connectionStatus: 'connected' · storedConnectors: ['AUTH']
 *
 * The login had finished AFTER the wait gave up; the marker was released, and
 * from then on nothing in the app knew a session was owed:
 *
 *   1. the boot hygiene saw the @appkit/* keys, found no marker, and PURGED
 *      them — a live session the user is owed, destroyed on every boot after
 *      it (a silent logout);
 *   2. the restore gate keyed on the marker alone, so the email restore never
 *      ran and the app never attached the session it was owed.
 *
 * Both locks are exercised here against the REAL context code: the SDK's own
 * witnesses (`sdkSessionFacts`) gate the purge and the restore. Only the
 * network-reach `restoreEmbeddedWallet` is stubbed (jsdom has no secure
 * frame); the stub answers PENDING, which is what the real one answers for a
 * session it cannot rehydrate in time — the marker must survive it.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, cleanup } from '@testing-library/react';

vi.mock('../src/context/TelegramContext', () => ({ useTelegram: () => ({ haptic: () => {} }) }));

vi.mock('../src/lib/wc', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    restoreEmbeddedWallet: vi.fn(async () => ({ ok: false, code: 'PENDING' }))
  };
});

import { WalletProvider } from '../src/context/WalletContext';
import { wcTraceReset, wcTraceSnapshot } from '../src/lib/wc';

const VAULT_ADDRESS = '0x66c14A85E3f0ab12508F5289A3041BEdE1EaE1DE';

const mount = () => render(<WalletProvider><div data-testid="probe" /></WalletProvider>);

const events = () => wcTraceSnapshot().map((entry) => entry.event);

beforeEach(() => {
  localStorage.clear();
  wcTraceReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the cold start and a live email session that lost our marker', () => {
  it("keeps a live session's keys (email_orphan_kept) and re-arms the claim (email_late_attach)", async () => {
    /* The exact state the 2026-09-18 device report carried: our marker gone,
       the frame's session alive in the SDK's own keys. */
    localStorage.setItem('@appkit/connection_status', 'connected');
    localStorage.setItem('@appkit/connections', JSON.stringify({
      eip155: [{ connectorId: 'AUTH', accounts: [{ address: VAULT_ADDRESS }] }]
    }));
    localStorage.setItem('@appkit-wallet/EMAIL_LOGIN_USED_KEY', 'true');

    await act(async () => { mount(); });

    /* The purge refused to log the user out of a wallet they are owed. */
    expect(localStorage.getItem('@appkit/connection_status')).toBe('connected');
    expect(JSON.parse(localStorage.getItem('@appkit/connections'))).toBeTruthy();
    expect(events()).toContain('email_orphan_kept');
    expect(events()).not.toContain('orphan_storage_purged');

    /* And the claim is RE-ARMED from the SDK's evidence, so the next foreground
       return / boot retries the attach instead of probing WalletConnect over
       empty storage — the session is attached by the app, not by a re-tap. */
    expect(localStorage.getItem('fbt_email_social_connected')).toBe('1');
    expect(events()).toContain('email_late_attach');
  });

  it('still purges true residue when the SDK holds no session', async () => {
    /* Residue without a session behind it: the SDK says 'disconnected' and
       keeps no connection — exactly what the hygiene exists to clean. */
    localStorage.setItem('@appkit/connection_status', 'disconnected');
    localStorage.setItem('@appkit/recent_wallet', '{"name":"probe"}');

    await act(async () => { mount(); });

    expect(localStorage.getItem('@appkit/recent_wallet')).toBeNull();
    /* 'disconnected' is not connection state (every clean boot writes it), so
       it is never counted and never removed. */
    expect(localStorage.getItem('@appkit/connection_status')).toBe('disconnected');
    expect(events()).toContain('orphan_storage_purged');
    expect(events()).not.toContain('email_orphan_kept');
    expect(events()).not.toContain('email_late_attach');
  });
});
